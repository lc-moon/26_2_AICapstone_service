"""인천 초미세먼지 지도 API. 실행: uvicorn app:app --reload (server/ 에서)"""
import asyncio
import hmac
import json
import math
import os
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Annotated, Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import AwareDatetime, BaseModel, Field, field_validator

import airkorea
from idw import idw
from init_db import SHARED, connect

KST = timezone(timedelta(hours=9))
METHOD = "idw 1/(d²+0.05)"


@asynccontextmanager
async def lifespan(app):
    task = None
    if os.environ.get("AIRKOREA_API_KEY"):
        task = asyncio.create_task(airkorea.run_hourly())
    else:
        airkorea.log.warning("AIRKOREA_API_KEY가 없어 에어코리아 매시 수집을 켜지 않습니다")
    app.state.airkorea_task = task
    yield
    if task:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(title="인천 초미세먼지 지도", lifespan=lifespan)


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
        # 다른 시각 값으로 메우지 않는다. 측정소 프레임은 다음 PR(밤·빈 회차)
        conn.execute("DELETE FROM frames WHERE slot = %s AND source = 'cctv'", (slot,))
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


def log_ingest(conn, started, rows_in, rows_upserted, error):
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
        "frames": frames,   # 다시 계산한 회차. n_inputs 0 = 유효값 없어 프레임 없음
    }


@lru_cache
def boundary():
    feats = json.loads((SHARED / "boundary.geojson").read_text(encoding="utf-8"))["features"]
    return next(f["geometry"] for f in feats if f["properties"]["kind"] == "area")


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
