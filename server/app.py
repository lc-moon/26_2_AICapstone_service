"""인천 초미세먼지 지도 API. 실행: uvicorn app:app --reload (server/ 에서)"""
import asyncio
import hmac
import json
import logging
import math
import os
import shlex
import subprocess
import threading
import time
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Annotated, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import AwareDatetime, BaseModel, Field, field_validator

import airkorea
from idw import KX, KY, idw
from init_db import SHARED, connect
from sun import is_day

KST = timezone(timedelta(hours=9))
log = logging.getLogger("uvicorn.error")
METHOD = "idw 1/(d²+0.05)"
STALE_AFTER = timedelta(minutes=40)   # 낮에 2회차(40분) 동안 추정값이 하나도 안 오면 stale
GRADES = [(15, "좋음"), (35, "보통"), (75, "나쁨")]   # 반올림 후 판정, 그 위는 매우나쁨


@asynccontextmanager
async def lifespan(app):
    task = None
    if os.environ.get("AIRKOREA_API_KEY"):
        task = asyncio.create_task(airkorea.run_hourly(after=night_frame))
    else:
        airkorea.log.warning("AIRKOREA_API_KEY가 없어 에어코리아 매시 수집을 켜지 않습니다")
    app.state.airkorea_task = task
    yield
    if task:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(title="인천 초미세먼지 지도", lifespan=lifespan)
# 로컬 개발용: 화면(localhost:8766)이 API(localhost:8000)를 부를 때. 배포는 같은 주소라 필요 없음
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["GET", "POST"],   # POST = 직접 해보기(/api/infer)
)


def iso(dt):
    """응답 시각은 항상 +09:00 (DB는 UTC로 줄 수 있음)."""
    return dt.astimezone(KST).isoformat() if dt else None


Num = Annotated[float, Field(strict=True, allow_inf_nan=False)]


class EstimateRow(BaseModel):
    camera_id: str = Field(min_length=1)
    slot: AwareDatetime
    captured_at: Optional[AwareDatetime] = None
    pm25_est: Optional[Annotated[Num, Field(ge=0)]]   # null = 추정 안 함(비·습도·고장)
    status: str = Field(min_length=1)
    humidity: Optional[Annotated[Num, Field(ge=0, le=100)]] = None
    rain_60m: Optional[Annotated[Num, Field(ge=0)]] = None
    model: Optional[str] = Field(default=None, min_length=1)
    estimated_at: Optional[AwareDatetime] = None

    @field_validator("slot")
    @classmethod
    def on_slot(cls, v):
        k = v.astimezone(KST)
        if k.minute % 20 or k.second or k.microsecond:
            raise ValueError("slot은 :00/:20/:40 정각이어야 합니다")
        return v


class IngestBody(BaseModel):
    rows: list[EstimateRow] = Field(min_length=1)


def check_token(authorization: Optional[str] = Header(None)):
    token = os.environ.get("INGEST_TOKEN")
    scheme, _, given = (authorization or "").partition(" ")
    if not token or scheme != "Bearer" or not hmac.compare_digest(given.encode(), token.encode()):
        raise HTTPException(401, "인증 실패", headers={"WWW-Authenticate": "Bearer"})


def rebuild_frame(conn, slot):
    """그 회차에 값이 있는 카메라 전부로 프레임을 다시 계산해 덮어쓴다."""
    inputs = conn.execute(
        """SELECT e.camera_id, c.lon, c.lat, e.pm25_est, e.model
           FROM estimates e JOIN cameras c USING (camera_id)
           WHERE e.slot = %s AND e.pm25_est IS NOT NULL ORDER BY e.camera_id""",
        (slot,),
    ).fetchall()
    if not inputs:
        # 낮 빈 회차: CCTV 프레임을 지우고 그 회차 이전 가장 최근 실측으로 대신 만든다
        conn.execute("DELETE FROM frames WHERE slot = %s AND source = 'cctv'", (slot,))
        try:
            with conn.transaction():   # savepoint — 실패해도 추정값 수신은 그대로 성공
                basis = latest_obs_time(conn, slot)
                if basis:
                    station_frame(conn, slot, basis)
        except Exception:
            log.exception("빈 회차 측정소 프레임 실패 %s", slot)
        return 0
    centers = conn.execute("SELECT center_lon, center_lat FROM grid_cells ORDER BY grid_id").fetchall()
    values = idw(centers, [(lon, lat, pm) for _, lon, lat, pm, _ in inputs])
    models = sorted({m for *_, m in inputs if m})
    conn.execute(
        """INSERT INTO frames (slot, source, basis_time, n_inputs, inputs, values, method, model, created_at)
           VALUES (%s, 'cctv', NULL, %s, %s, %s, %s, %s, now())
           ON CONFLICT (slot) DO UPDATE SET source = EXCLUDED.source, basis_time = NULL,
             n_inputs = EXCLUDED.n_inputs, inputs = EXCLUDED.inputs, values = EXCLUDED.values,
             method = EXCLUDED.method, model = EXCLUDED.model, created_at = now()""",
        (slot, len(inputs), [i[0] for i in inputs], values, METHOD, ",".join(models) or None),
    )
    return len(inputs)


def latest_obs_time(conn, until=None):
    """PM2.5 값이 하나라도 있는 가장 최근 data_time(until 이하)"""
    return conn.execute("SELECT max(data_time) FROM observations WHERE pm25 IS NOT NULL"
                        " AND (%s::timestamptz IS NULL OR data_time <= %s)", (until, until)).fetchone()[0]


def station_frame(conn, slot, basis):
    """basis 시각에 값이 있는 측정소 전부로 IDW → slot 프레임(source='station').
    이미 CCTV 프레임이 있는 slot은 건드리지 않는다(CCTV가 이김). 넣었으면 측정소 수, 아니면 0"""
    inputs = conn.execute(
        """SELECT o.station_name, s.lon, s.lat, o.pm25 FROM observations o JOIN stations s USING (station_name)
           WHERE o.data_time = %s AND o.pm25 IS NOT NULL ORDER BY o.station_name""",
        (basis,),
    ).fetchall()
    if not inputs:
        return 0
    centers = conn.execute("SELECT center_lon, center_lat FROM grid_cells ORDER BY grid_id").fetchall()
    values = idw(centers, [(lon, lat, pm) for _, lon, lat, pm in inputs])
    cur = conn.execute(
        """INSERT INTO frames (slot, source, basis_time, n_inputs, inputs, values, method, model, created_at)
           VALUES (%s, 'station', %s, %s, %s, %s, %s, NULL, now())
           ON CONFLICT (slot) DO UPDATE SET basis_time = EXCLUDED.basis_time, n_inputs = EXCLUDED.n_inputs,
             inputs = EXCLUDED.inputs, values = EXCLUDED.values, method = EXCLUDED.method, created_at = now()
           WHERE frames.source = 'station'""",
        (slot, basis, len(inputs), [i[0] for i in inputs], values, METHOD),
    )
    return len(inputs) if cur.rowcount else 0


def night_frame():
    """매시 에어코리아 수집 뒤(airkorea.run_hourly). 밤이면 가장 최근 정시 실측으로 slot = basis_time 프레임"""
    if is_day(now()):
        return 0
    with connect() as conn, conn.transaction():
        t = latest_obs_time(conn)
        return station_frame(conn, t, t) if t else 0


def log_ingest(conn,started, rows_in, rows_upserted, error):
    conn.execute(
        "INSERT INTO ingest_log (source, started_at, rows_in, rows_upserted, error) VALUES ('estimator', %s, %s, %s, %s)",
        (started, rows_in, rows_upserted, error),
    )


@app.post("/api/ingest/estimates", dependencies=[Depends(check_token)])
def ingest_estimates(body: IngestBody):
    started = datetime.now(KST)
    with connect() as conn:
        try:
            with conn.transaction():
                # ponytail: 수신 전체를 한 줄로 세움(5분마다 1건이라 충분). 많아지면 회차별 잠금
                conn.execute("SELECT pg_advisory_xact_lock(2026)")
                known = {r[0] for r in conn.execute("SELECT camera_id FROM cameras")}
                rows = [r for r in body.rows if r.camera_id in known]
                unknown = sorted({r.camera_id for r in body.rows} - known)

                # 처음 보는 모델은 등록해 둔다(estimates.model 외래 키). 값을 버리지 않기 위해
                new_models = sorted(
                    m for m in {r.model for r in rows if r.model}
                    if conn.execute(
                        "INSERT INTO model_versions (model, note) VALUES (%s, '수신 중 자동 등록') ON CONFLICT DO NOTHING",
                        (m,),
                    ).rowcount
                )
                with conn.cursor() as cur:
                    cur.executemany(
                        """INSERT INTO estimates (camera_id, slot, captured_at, pm25_est, status, humidity,
                             rain_60m, model, estimated_at, received_at)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, now())
                           ON CONFLICT (camera_id, slot) DO UPDATE SET captured_at = EXCLUDED.captured_at,
                             pm25_est = EXCLUDED.pm25_est, status = EXCLUDED.status, humidity = EXCLUDED.humidity,
                             rain_60m = EXCLUDED.rain_60m, model = EXCLUDED.model,
                             estimated_at = EXCLUDED.estimated_at, received_at = now()""",
                        [(r.camera_id, r.slot, r.captured_at, r.pm25_est, r.status, r.humidity,
                          r.rain_60m, r.model, r.estimated_at) for r in rows],
                    )
                frames = [{"slot": iso(s), "n_inputs": rebuild_frame(conn, s)}
                          for s in sorted({r.slot for r in rows})]
        except Exception as e:
            log_ingest(conn, started, len(body.rows), 0, f"{type(e).__name__}: {e}"[:500])
            raise
        log_ingest(conn, started, len(body.rows), len(rows),
                   f"unknown cameras: {','.join(unknown)}" if unknown else None)
    return {
        "rows_in": len(body.rows),
        "rows_upserted": len(rows),
        "unknown_cameras": unknown,
        "new_models": new_models,
        "frames": frames,   # 다시 계산한 회차. n_inputs 0 = CCTV 유효값 없음(측정소 실측이 있으면 측정소 프레임으로 대신)
    }


@lru_cache
def boundary():
    feats = json.loads((SHARED / "boundary.geojson").read_text(encoding="utf-8"))["features"]
    return next(f["geometry"] for f in feats if f["properties"]["kind"] == "area")


def in_ring(x, y, ring):
    inside, j = False, len(ring) - 1
    for i in range(len(ring)):
        (xi, yi), (xj, yj) = ring[i], ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def inside_area(lon, lat):
    """서비스 범위(boundary.geojson의 area) 안인가. display(화면용)는 바다가 섞여 있어 쓰지 않는다"""
    g = boundary()
    polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
    return any(in_ring(lon, lat, p[0]) and not any(in_ring(lon, lat, h) for h in p[1:]) for p in polys)


def grade(v):
    return None if v is None else next((name for top, name in GRADES if round(v) <= top), "매우나쁨")


def now():
    return datetime.now(KST)   # 테스트에서 바꿔 끼운다


@app.get("/api/grid")
def grid():
    with connect() as conn:
        rows = conn.execute(
            "SELECT grid_id, row, col, center_lon, center_lat, gu FROM grid_cells ORDER BY grid_id"
        ).fetchall()
    cells = [{"grid_id": g, "row": r, "col": c, "center": [lon, lat], "gu": gu} for g, r, c, lon, lat, gu in rows]
    return {"cell_size_m": 1000, "count": len(cells), "cells": cells, "boundary": boundary()}


@app.get("/api/frames/latest")
def frames_latest():
    with connect() as conn:
        f = conn.execute(
            "SELECT slot, source, basis_time, n_inputs, values, created_at FROM frames ORDER BY slot DESC LIMIT 1"
        ).fetchone()
    if not f:
        raise HTTPException(404, "아직 프레임이 없습니다")
    slot, source, basis, n, values, updated = f
    return {
        "slot": iso(slot),
        "source": source,
        "basis_time": iso(basis),
        "n_inputs": n,
        # real(float4)은 14.399999…로 나오므로 소수 첫째 자리로 되돌린다
        "values": [None if v is None or math.isnan(v) else round(v, 1) for v in values],
        "updated_at": iso(updated),
    }


def cell_at(conn, lon, lat):
    """점이 든 1km 칸. 격자가 area를 빈틈없이 덮으므로 범위 안이면 반드시 있다(경계 반올림 대비 가장 가까운 칸)"""
    cells = conn.execute("SELECT grid_id, gu, center_lon, center_lat FROM grid_cells").fetchall()
    return min(cells, key=lambda c: max(abs(lon - c[2]) * KX, abs(lat - c[3]) * KY))


@app.get("/api/point")
def point(lon: float = Query(ge=-180, le=180), lat: float = Query(ge=-90, le=90)):
    if not inside_area(lon, lat):
        return {"inside": False}
    with connect() as conn:
        grid_id, gu, _, _ = cell_at(conn, lon, lat)
        f = conn.execute("SELECT slot, source, values[%s] FROM frames ORDER BY slot DESC LIMIT 1",
                         (grid_id + 1,)).fetchone()   # PostgreSQL 배열은 1부터
        cams = conn.execute("SELECT lon, lat FROM cameras").fetchall()
        station = nearest_station(conn, lon, lat)
        camera = nearest_camera(conn, lon, lat)
    estimate = None
    if f:
        slot, source, v = f
        v = None if v is None or math.isnan(v) else round(v, 1)
        estimate = {"pm25": v, "grade": grade(v), "slot": iso(slot), "source": source,
                    "nearest_cctv_km": round(min(math.hypot((lon - x) * KX, (lat - y) * KY) for x, y in cams), 1)}
    return {"inside": True, "gu": gu, "grid_id": grid_id, "estimate": estimate, "station": station, "camera": camera}


def nearest_camera(conn, lon, lat):
    """가장 가까운 화면 범위 카메라(grid_id 있음 — 103번 제외)의 가장 최근 estimates 한 줄(NEXT.md S3).
    사진 파일은 추정기가 /cam/{camera_id}.jpg로 덮어쓴다. 그 카메라 행이 없으면 None"""
    cams = conn.execute("SELECT camera_id, name, lon, lat FROM cameras WHERE grid_id IS NOT NULL").fetchall()
    if not cams:
        return None
    d, cid, name = min((math.hypot((lon - x) * KX, (lat - y) * KY), c, n) for c, n, x, y in cams)
    row = conn.execute("SELECT slot, captured_at, pm25_est, status FROM estimates WHERE camera_id = %s"
                       " ORDER BY slot DESC LIMIT 1", (cid,)).fetchone()
    if not row:
        return None
    slot, captured, pm, status = row
    # ?v= 는 브라우저 캐시 깨기용(한국 시각 숫자). captured_at이 비어 있으면 회차 시각으로
    v = (captured or slot).astimezone(KST).strftime("%Y%m%d%H%M%S")
    return {"camera_id": cid, "name": name, "distance_km": round(d, 1), "slot": iso(slot),
            "captured_at": iso(captured), "pm25": None if pm is None else round(pm, 1), "status": status,
            "photo_url": f"/cam/{cid}.jpg?v={v}"}


def period(t):
    """data_time(구간 끝) → '12~13시 평균'. 00:00은 전날 23~24시"""
    h = t.astimezone(KST).hour or 24
    return f"{h - 1}~{h}시 평균"


def nearest_station(conn, lon, lat):
    """가장 가까운 비교용 측정소의 가장 최근 실측 한 줄(NEXT.md S1).
    그 줄이 결측(null)이면 pm25 null — 더 이전 시각이나 다른 측정소로 메우지 않는다"""
    rows = conn.execute("SELECT station_name, lon, lat FROM stations WHERE use_for_compare").fetchall()
    if not rows:
        return None
    d, name = min((math.hypot((lon - x) * KX, (lat - y) * KY), n) for n, x, y in rows)
    t, pm = conn.execute("SELECT data_time, pm25 FROM observations WHERE station_name = %s"
                         " ORDER BY data_time DESC LIMIT 1", (name,)).fetchone() or (None, None)
    return {"name": name, "distance_km": round(d, 1),
            "pm25": None if pm is None or math.isnan(pm) else round(pm, 1),
            "data_time": iso(t), "period": period(t) if t else None}


@app.get("/api/health")
def health():
    with connect() as conn:
        last_slot, last_received = conn.execute("SELECT max(slot), max(received_at) FROM estimates").fetchone()
    t = now()
    # 밤에는 추정기가 쉬므로 제외. 해 뜬 직후 40분은 첫 회차를 기다리는 중이라 제외
    stale = is_day(t) and is_day(t - STALE_AFTER) and (last_received is None or t - last_received > STALE_AFTER)
    return {"last_slot": iso(last_slot), "last_received_at": iso(last_received), "stale": stale}


INFER_TIMEOUT = 30        # 초. VM 측정 약 12초
INFER_CACHE_FOR = 60      # 같은 카메라를 60초 안에 다시 누르면 지난 결과
BUSY = "다른 추정이 진행 중입니다. 잠시 뒤 다시 눌러 주세요"
UNAVAILABLE = "지금은 추정할 수 없습니다"
# ponytail: 프로세스 하나 안에서만 한 번에 하나. 워커를 여럿 띄우면 워커마다 하나씩(정기 추정기와의 충돌은 명령의 종료 코드 75가 막음)
infer_lock = threading.Lock()
infer_cache = {}          # camera_id → (끝난 시각, 응답)


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v >= 0


@app.post("/api/infer")
def infer(camera_id: str = Query(min_length=1, max_length=20)):
    """직접 해보기: INFER_CMD + 카메라 번호를 실행해 지금 사진으로 추정(NEXT.md S5). DB에는 넣지 않는다.
    보통 def라 FastAPI가 별도 스레드에서 돌려, 그동안 다른 API는 멈추지 않는다"""
    with connect() as conn:   # 공개 주소라 아무 문자열이나 온다 — 명령에 넘기기 전에 표에 있는지
        cam = conn.execute("SELECT name FROM cameras WHERE camera_id = %s", (camera_id,)).fetchone()
    if not cam:
        raise HTTPException(404, "없는 카메라입니다")
    cmd = os.environ.get("INFER_CMD", "").strip()
    if not cmd:
        log.warning("INFER_CMD가 없어 직접 해보기를 할 수 없습니다")
        raise HTTPException(503, UNAVAILABLE)

    hit = infer_cache.get(camera_id)
    if hit and (now() - hit[0]).total_seconds() < INFER_CACHE_FOR:
        return {**hit[1], "cached": True}
    if not infer_lock.acquire(blocking=False):
        raise HTTPException(409, BUSY)
    try:
        started = time.monotonic()
        try:
            r = subprocess.run([*shlex.split(cmd), camera_id], capture_output=True, timeout=INFER_TIMEOUT)
        except subprocess.TimeoutExpired:
            log.warning("직접 해보기 %s: %s초 넘음", camera_id, INFER_TIMEOUT)
            raise HTTPException(503, UNAVAILABLE) from None
        except OSError as e:
            log.warning("직접 해보기 %s: 명령 실행 실패 %s", camera_id, type(e).__name__)
            raise HTTPException(503, UNAVAILABLE) from None
        if r.returncode == 75:   # 정기 추정기가 도는 중
            raise HTTPException(409, BUSY)
        if r.returncode:
            log.warning("직접 해보기 %s: 종료 코드 %s %s", camera_id, r.returncode,
                        r.stderr.decode("utf-8", "replace")[-300:])
            raise HTTPException(503, UNAVAILABLE)
        try:
            out = json.loads(r.stdout.decode("utf-8").strip().splitlines()[-1])
            pm = out["pm25"]
            ok = (isinstance(out, dict) and str(out["camera_id"]) == camera_id and (pm is None or is_num(pm))
                  and isinstance(out["captured_at"], str))
        except (ValueError, IndexError, KeyError, TypeError):
            ok = False
        if not ok:
            log.warning("직접 해보기 %s: 출력이 약속과 다름 %r", camera_id, r.stdout[-300:])
            raise HTTPException(503, UNAVAILABLE)
        res = {**out, "name": cam[0], "grade": grade(pm), "cached": False,
               "elapsed_s": round(time.monotonic() - started, 1)}
        infer_cache[camera_id] = (now(), res)
        return res
    finally:
        infer_lock.release()
