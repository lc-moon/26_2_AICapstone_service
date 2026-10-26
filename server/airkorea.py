"""에어코리아 시도별 실시간 측정정보 → observations.

매시 50분에 인천·경기 1번씩 (AGENTS.md). 한 번 손으로 돌려 보기:
    python airkorea.py
"""
import asyncio
import logging
import math
import os
from datetime import datetime, timedelta, timezone

import httpx

from init_db import connect

KST = timezone(timedelta(hours=9))
URL = "https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty"
SIDOS = ("인천", "경기")   # stations.json에 있는 시도
RUN_MINUTE = 50           # 게시가 매시 15~40분
log = logging.getLogger("uvicorn.error.airkorea")   # uvicorn 로그에 같이 찍히도록


class AirKoreaError(Exception):
    """API 쪽 실패. 관측값 결측(null)과 다르다 — 이때는 아무것도 저장하지 않는다."""


def parse_value(s):
    """'12' → 12.0. 빈칸·'-'·None·숫자 아님·음수 → None (0으로 메우지 않는다)."""
    if s is None:
        return None
    try:
        v = float(str(s).strip())
    except ValueError:
        return None
    return v if math.isfinite(v) and v >= 0 else None


def parse_time(s):
    """'2026-10-16 13:00' → KST. '24:00'은 다음 날 00:00. 형식이 틀리면 None."""
    try:
        day, hm = str(s).strip().split(" ")
        h, m = hm.split(":")
        base = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=KST)
        h, m = int(h), int(m)
        if not (0 <= h <= 24 and 0 <= m < 60) or (h == 24 and m):
            return None
        return base + timedelta(hours=h, minutes=m)
    except (ValueError, AttributeError):
        return None


def fetch(client, sido, key):
    """한 시도의 items. 실패하면 AirKoreaError (메시지에 키가 들어가지 않게)."""
    params = {"serviceKey": key, "returnType": "json", "numOfRows": 1000, "pageNo": 1,
              "sidoName": sido, "ver": "1.3"}
    try:
        r = client.get(URL, params=params)
    except httpx.TimeoutException:
        raise AirKoreaError(f"{sido}: 시간 초과") from None
    except httpx.HTTPError as e:
        raise AirKoreaError(f"{sido}: 연결 실패 {type(e).__name__}") from None
    if r.status_code != 200:
        raise AirKoreaError(f"{sido}: HTTP {r.status_code}")
    try:
        data = r.json()
    except ValueError:
        # 키 오류 등은 returnType=json이어도 XML로 온다
        raise AirKoreaError(f"{sido}: JSON 아님 — {r.text[:200].replace(key, '***')}") from None
    try:
        header, body = data["response"]["header"], data["response"]["body"]
        if header.get("resultCode") != "00":
            raise AirKoreaError(f"{sido}: 결과 코드 {header.get('resultCode')} {header.get('resultMsg')}")
        items = body.get("items") or []
        if (body.get("totalCount") or 0) > len(items):
            log.warning("%s: totalCount %s > 받은 %s건", sido, body.get("totalCount"), len(items))
        return items
    except (KeyError, TypeError, AttributeError):
        raise AirKoreaError(f"{sido}: 응답 구조가 다름") from None


def to_rows(items, known):
    """items → {(측정소, 시각): 행}. 등록 안 된 측정소·시각 오류는 빼고 개수를 센다."""
    rows, stats = {}, {"unknown_station": 0, "bad_time": 0, "pm25_null": 0}
    for it in items:
        name = str(it.get("stationName") or "").strip()
        if name not in known:
            stats["unknown_station"] += 1
            continue
        t = parse_time(it.get("dataTime"))
        if t is None:
            stats["bad_time"] += 1
            continue
        pm25 = parse_value(it.get("pm25Value"))
        stats["pm25_null"] += pm25 is None
        flag = (it.get("pm25Flag") or "").strip() or None
        rows[(name, t)] = (name, t, pm25, parse_value(it.get("pm10Value")), flag)
    return rows, stats


def collect(client=None):
    """인천·경기를 받아 observations에 덮어쓴다. 결과 요약을 돌려주고 ingest_log에 남긴다."""
    started = datetime.now(KST)
    key = os.environ.get("AIRKOREA_API_KEY")
    errors, items_in, upserted, stats, missing = [], 0, 0, {}, []
    with connect() as conn:
        # 워커가 여럿이어도 한 번만 (먼저 잡은 쪽만 수집)
        if not conn.execute("SELECT pg_try_advisory_lock(2050)").fetchone()[0]:
            log.info("에어코리아: 다른 프로세스가 수집 중이라 건너뜀")
            return {"skipped": True}
        try:
            known = {r[0] for r in conn.execute("SELECT station_name FROM stations")}
            items = []
            if not key:
                errors.append("AIRKOREA_API_KEY가 설정되지 않았습니다")
            else:
                own = client is None
                client = client or httpx.Client(timeout=20)
                try:
                    for sido in SIDOS:
                        try:
                            items += fetch(client, sido, key)
                        except AirKoreaError as e:
                            errors.append(str(e))   # 한 시도가 실패해도 다른 시도는 저장
                finally:
                    if own:
                        client.close()
            items_in = len(items)
            rows, stats = to_rows(items, known)
            missing = sorted(known - {r[0] for r in rows.values()})
            if rows:
                try:
                    with conn.transaction(), conn.cursor() as cur:
                        cur.executemany(
                            """INSERT INTO observations (station_name, data_time, pm25, pm10, pm25_flag,
                                 fetched_at, updated_at)
                               VALUES (%s, %s, %s, %s, %s, now(), now())
                               ON CONFLICT (station_name, data_time) DO UPDATE SET
                                 pm25 = EXCLUDED.pm25, pm10 = EXCLUDED.pm10, pm25_flag = EXCLUDED.pm25_flag,
                                 fetched_at = now(),
                                 updated_at = CASE WHEN (observations.pm25, observations.pm10, observations.pm25_flag)
                                   IS DISTINCT FROM (EXCLUDED.pm25, EXCLUDED.pm10, EXCLUDED.pm25_flag)
                                   THEN now() ELSE observations.updated_at END""",
                            list(rows.values()),
                        )
                    upserted = len(rows)
                except Exception as e:
                    errors.append(f"DB: {type(e).__name__}: {e}"[:300])
            conn.execute(
                "INSERT INTO ingest_log (source, started_at, rows_in, rows_upserted, error) VALUES ('airkorea', %s, %s, %s, %s)",
                (started, items_in, upserted, "; ".join(errors)[:1000] or None),
            )
        finally:
            conn.execute("SELECT pg_advisory_unlock(2050)")
    result = {"items_in": items_in, "upserted": upserted, "missing_stations": missing, **stats, "errors": errors}
    (log.error if errors else log.info)(
        "에어코리아: 받은 %s건, 저장 %s건, PM2.5 결측 %s, 응답에 없는 측정소 %s곳, 오류 %s",
        items_in, upserted, stats.get("pm25_null", 0), len(missing), errors or "없음")
    return result


def seconds_until_next_run(now):
    nxt = now.replace(minute=RUN_MINUTE, second=0, microsecond=0)
    if nxt <= now:
        nxt += timedelta(hours=1)
    return (nxt - now).total_seconds()


async def run_hourly():
    """서버가 켜져 있는 동안 매시 50분에 collect. 실패해도 다음 시각에 다시 돈다."""
    while True:
        await asyncio.sleep(seconds_until_next_run(datetime.now(KST)))
        try:
            await asyncio.to_thread(collect)   # 한 번에 하나씩 — 앞 수집이 끝나야 다음 대기
        except Exception:
            log.exception("에어코리아 수집 실패")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(collect())
