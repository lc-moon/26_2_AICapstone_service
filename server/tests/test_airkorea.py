"""에어코리아 수집. 실제 API는 부르지 않는다(httpx.MockTransport)."""
import asyncio
from datetime import datetime

import httpx
import pytest
from fastapi.testclient import TestClient

import airkorea
from airkorea import KST, AirKoreaError, fetch, parse_time, parse_value, seconds_until_next_run, to_rows

KEY = "fake-key-123"


def item(name, time="2026-10-16 13:00", pm25="11", pm10="25", flag=None):
    return {"stationName": name, "dataTime": time, "pm25Value": pm25, "pm10Value": pm10, "pm25Flag": flag}


def ok(items):
    return httpx.Response(200, json={"response": {
        "header": {"resultCode": "00", "resultMsg": "NORMAL_CODE"},
        "body": {"totalCount": len(items), "items": items, "pageNo": 1, "numOfRows": 1000}}})


def client_for(by_sido, calls=None):
    """sidoName별 응답(Response 또는 예외)을 돌려주는 가짜 클라이언트."""
    def handler(req):
        sido = req.url.params["sidoName"]
        assert req.url.params["serviceKey"] == KEY and req.url.params["returnType"] == "json"
        if calls is not None:
            calls.append(sido)
        r = by_sido[sido]
        if isinstance(r, Exception):
            raise r
        return r
    return httpx.Client(transport=httpx.MockTransport(handler))


# ── 값·시각 파싱 ──────────────────────────────────────────────

@pytest.mark.parametrize("s,want", [("12", 12.0), (" 7 ", 7.0), ("0", 0.0), ("3.5", 3.5), (5, 5.0),
                                    ("", None), ("-", None), (None, None), ("통신장애", None),
                                    ("nan", None), ("-3", None)])
def test_parse_value(s, want):
    assert parse_value(s) == want


@pytest.mark.parametrize("s,want", [
    ("2026-10-16 13:00", datetime(2026, 10, 16, 13, tzinfo=KST)),
    ("2026-10-16 24:00", datetime(2026, 10, 17, 0, tzinfo=KST)),
    ("2026-12-31 24:00", datetime(2027, 1, 1, 0, tzinfo=KST)),
    ("2026-10-16 00:00", datetime(2026, 10, 16, 0, tzinfo=KST)),
])
def test_parse_time(s, want):
    assert parse_time(s) == want


@pytest.mark.parametrize("s", ["", None, "-", "2026-10-16", "2026-10-16 25:00", "2026-10-16 24:30",
                               "2026-13-01 10:00", "16/10/2026 13:00", "2026-10-16 ab:00"])
def test_parse_time_invalid(s):
    assert parse_time(s) is None


def test_to_rows_filters_and_counts():
    rows, stats = to_rows([item("주안"), item(" 부평 ", pm25="-"), item("서울어딘가"), item("검단", time="bad"),
                           item("연희", time="2026-10-16 24:00", pm25="", flag="점검및교정")], {"주안", "부평", "검단", "연희"})
    assert sorted(n for n, _ in rows) == ["부평", "연희", "주안"]
    assert rows[("부평", datetime(2026, 10, 16, 13, tzinfo=KST))][2] is None
    assert rows[("연희", datetime(2026, 10, 17, tzinfo=KST))][2:] == (None, 25.0, "점검및교정")
    assert stats == {"unknown_station": 1, "bad_time": 1, "pm25_null": 2}


# ── API 호출 ──────────────────────────────────────────────────

def test_fetch_ok_and_sido_param():
    calls = []
    c = client_for({"인천": ok([item("주안")]), "경기": ok([item("소사본동")])}, calls)
    assert [i["stationName"] for i in fetch(c, "인천", KEY)] == ["주안"]
    assert [i["stationName"] for i in fetch(c, "경기", KEY)] == ["소사본동"]
    assert calls == ["인천", "경기"]


@pytest.mark.parametrize("resp,msg", [
    (httpx.Response(500, text="err"), "HTTP 500"),
    (httpx.ReadTimeout("timed out"), "시간 초과"),
    (httpx.ConnectError("refused"), "연결 실패"),
    (httpx.Response(200, text="<OpenAPI_ServiceResponse><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR"
                              f"</returnAuthMsg><key>{KEY}</key></OpenAPI_ServiceResponse>"), "SERVICE_KEY_IS_NOT_REGISTERED"),
    (httpx.Response(200, text="{broken json"), "JSON 아님"),
    (httpx.Response(200, json={"response": {"header": {"resultCode": "30", "resultMsg": "등록되지 않은 키"},
                                            "body": {}}}), "결과 코드 30"),
    (httpx.Response(200, json={"unexpected": 1}), "응답 구조"),
])
def test_fetch_errors(resp, msg):
    with pytest.raises(AirKoreaError) as e:
        fetch(client_for({"인천": resp}), "인천", KEY)
    assert msg in str(e.value) and KEY not in str(e.value)


def test_fetch_empty_items_is_not_error():
    assert fetch(client_for({"인천": ok([])}), "인천", KEY) == []


# ── 스케줄 ────────────────────────────────────────────────────

@pytest.mark.parametrize("now,secs", [((13, 20, 0), 30 * 60), ((13, 50, 0), 3600), ((13, 55, 30), 54 * 60 + 30),
                                      ((23, 59, 0), 51 * 60)])
def test_seconds_until_next_run(now, secs):
    h, m, s = now
    assert seconds_until_next_run(datetime(2026, 10, 16, h, m, s, tzinfo=KST)) == secs


def test_lifespan_registers_and_cancels(monkeypatch):
    started = []

    async def fake_loop():
        started.append(1)
        await asyncio.Event().wait()

    monkeypatch.setenv("AIRKOREA_API_KEY", KEY)
    monkeypatch.setattr(airkorea, "run_hourly", fake_loop)
    from app import app
    with TestClient(app):
        task = app.state.airkorea_task
        assert task is not None and not task.done() and started == [1]
    assert task.cancelled()


def test_lifespan_without_key_does_not_schedule(monkeypatch):
    monkeypatch.delenv("AIRKOREA_API_KEY", raising=False)
    monkeypatch.setattr(airkorea, "run_hourly", lambda: pytest.fail("키가 없으면 돌면 안 됨"))
    from app import app
    with TestClient(app):
        assert app.state.airkorea_task is None


def test_run_hourly_survives_failures(monkeypatch):
    calls = []

    def fake_collect():
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("DB 끊김")

    monkeypatch.setattr(airkorea, "seconds_until_next_run", lambda now: 0)
    monkeypatch.setattr(airkorea, "collect", fake_collect)

    async def go():
        t = asyncio.create_task(airkorea.run_hourly())
        while len(calls) < 3:
            await asyncio.sleep(0.01)
        t.cancel()

    asyncio.run(asyncio.wait_for(go(), 5))
    assert len(calls) >= 3


# ── DB (TEST_DATABASE_URL 있을 때만) ──────────────────────────

def obs(db):
    return {(n, t.astimezone(KST).strftime("%m-%d %H:%M")): (p, f)
            for n, t, p, f in db.execute("SELECT station_name, data_time, pm25, pm25_flag FROM observations")}


def last_log(db):
    return db.execute("SELECT source, rows_in, rows_upserted, error FROM ingest_log ORDER BY id DESC LIMIT 1").fetchone()


def test_collect_saves_known_stations(db, monkeypatch):
    monkeypatch.setenv("AIRKOREA_API_KEY", KEY)
    calls = []
    c = client_for({"인천": ok([item("주안"), item("부평", pm25="-"), item("연희", time="2026-10-16 24:00"),
                                item("모르는곳")]),
                    "경기": ok([item("소사본동", pm25="", flag="통신장애")])}, calls)
    res = airkorea.collect(c)
    assert calls == ["인천", "경기"] and res["errors"] == [] and res["upserted"] == 4
    assert obs(db) == {("주안", "10-16 13:00"): (11.0, None), ("부평", "10-16 13:00"): (None, None),
                       ("연희", "10-17 00:00"): (11.0, None), ("소사본동", "10-16 13:00"): (None, "통신장애")}
    assert last_log(db) == ("airkorea", 5, 4, None)
    assert "검단" in res["missing_stations"] and "주안" not in res["missing_stations"]


def test_collect_again_overwrites_without_duplicates(db, monkeypatch):
    monkeypatch.setenv("AIRKOREA_API_KEY", KEY)
    airkorea.collect(client_for({"인천": ok([item("주안", pm25="11")]), "경기": ok([])}))
    first = db.execute("SELECT updated_at FROM observations").fetchone()[0]
    airkorea.collect(client_for({"인천": ok([item("주안", pm25="11")]), "경기": ok([])}))
    assert db.execute("SELECT updated_at FROM observations").fetchone()[0] == first   # 값이 같으면 그대로
    airkorea.collect(client_for({"인천": ok([item("주안", pm25="14")]), "경기": ok([])}))   # 나중에 고쳐짐
    assert obs(db) == {("주안", "10-16 13:00"): (14.0, None)}
    assert db.execute("SELECT updated_at FROM observations").fetchone()[0] > first


def test_api_failure_saves_nothing(db, monkeypatch):
    monkeypatch.setenv("AIRKOREA_API_KEY", KEY)
    res = airkorea.collect(client_for({"인천": httpx.ReadTimeout("t"), "경기": httpx.Response(500)}))
    assert res["upserted"] == 0 and len(res["errors"]) == 2
    assert obs(db) == {}
    src, rows_in, up, err = last_log(db)
    assert (rows_in, up) == (0, 0) and "시간 초과" in err and "HTTP 500" in err and KEY not in err


def test_one_sido_fails_other_saved(db, monkeypatch):
    monkeypatch.setenv("AIRKOREA_API_KEY", KEY)
    res = airkorea.collect(client_for({"인천": ok([item("주안")]), "경기": httpx.Response(503)}))
    assert res["upserted"] == 1 and res["errors"] == ["경기: HTTP 503"]
    assert list(obs(db)) == [("주안", "10-16 13:00")]


def test_missing_key(db, monkeypatch):
    monkeypatch.delenv("AIRKOREA_API_KEY", raising=False)
    res = airkorea.collect(client_for({}))
    assert res["upserted"] == 0 and "AIRKOREA_API_KEY" in res["errors"][0]
    assert "AIRKOREA_API_KEY" in last_log(db)[3]


def test_db_error_is_logged_not_raised(db, monkeypatch):
    monkeypatch.setenv("AIRKOREA_API_KEY", KEY)
    t = datetime(2026, 10, 16, 13, tzinfo=KST)
    # stations에 없는 이름 → 외래 키 위반. 같은 묶음의 정상 행도 함께 되돌려야 함
    monkeypatch.setattr(airkorea, "to_rows", lambda items, known: (
        {1: ("주안", t, 10.0, None, None), 2: ("없는측정소", t, 1.0, None, None)}, {}))
    res = airkorea.collect(client_for({"인천": ok([]), "경기": ok([])}))
    assert res["upserted"] == 0 and res["errors"][0].startswith("DB: ForeignKeyViolation")
    assert obs(db) == {}
    assert last_log(db)[3].startswith("DB: ForeignKeyViolation")


def test_concurrent_run_skipped(db, monkeypatch):
    monkeypatch.setenv("AIRKOREA_API_KEY", KEY)
    from init_db import connect
    with connect() as other:
        other.execute("SELECT pg_advisory_lock(2050)")
        assert airkorea.collect(client_for({})) == {"skipped": True}
    assert airkorea.collect(client_for({"인천": ok([]), "경기": ok([])}))["errors"] == []
