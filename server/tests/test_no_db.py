"""DB 없이 도는 테스트: 보간 식, 인증, 요청 검증."""
from collections import defaultdict

import pytest

from conftest import AUTH, mock
from idw import idw

CAMS = {c["camera_id"]: c for c in mock("../cameras.json")["cameras"]}
CENTERS = [c["center"] for c in mock("grid.json")["cells"]]


def compute(rows):
    return idw(CENTERS, [(CAMS[r["camera_id"]]["lon"], CAMS[r["camera_id"]]["lat"], r["pm25_est"])
                         for r in rows if r["pm25_est"] is not None])


def test_idw_matches_frames_latest():
    assert compute(mock("ingest_estimates.json")["rows"]) == mock("frames_latest.json")["values"]


def test_idw_matches_whole_day():
    by_slot = defaultdict(list)
    for r in mock("ingest_2026-10-16.json")["rows"]:
        by_slot[r["slot"]].append(r)
    frames = mock("frames_2026-10-16.json")["frames"]
    assert len(frames) == len(by_slot) == 33
    for f in frames:
        assert compute(by_slot[f["slot"]]) == f["values"], f["slot"]


def row(**kw):
    return {**mock("ingest_estimates.json")["rows"][0], **kw}


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer wrong"}, {"Authorization": "test-token"},
                                     {"Authorization": "Basic test-token"}])
def test_auth_fails(client, headers):
    assert client.post("/api/ingest/estimates", json={"rows": [row()]}, headers=headers).status_code == 401


def test_auth_checked_before_body(client):
    assert client.post("/api/ingest/estimates", json={"bad": 1}).status_code == 401


def test_no_token_configured_rejects_all(client, monkeypatch):
    monkeypatch.delenv("INGEST_TOKEN")
    assert client.post("/api/ingest/estimates", json={"rows": [row()]}, headers=AUTH).status_code == 401


@pytest.mark.parametrize("body", [
    {},
    {"rows": []},
    {"rows": "x"},
    {"rows": [row(pm25_est="12.0")]},                    # 문자열 숫자
    {"rows": [row(pm25_est=-1)]},
    {"rows": [row(humidity=120)]},
    {"rows": [row(camera_id=121)]},                      # 숫자 id
    {"rows": [row(camera_id="")]},
    {"rows": [row(status=None)]},
    {"rows": [row(slot="2026-10-16T13:20:00")]},         # 시간대 없음
    {"rows": [row(slot="2026-10-16T13:25:00+09:00")]},   # 회차 아님
    {"rows": [row(slot="not a time")]},
    {"rows": [{k: v for k, v in row().items() if k != "pm25_est"}]},  # null은 되지만 빠지면 안 됨
])
def test_invalid_body_422(client, body):
    assert client.post("/api/ingest/estimates", json=body, headers=AUTH).status_code == 422


def test_point_outside_needs_no_db(client):
    assert client.get("/api/point", params={"lon": 126.40, "lat": 37.45}).json() == {"inside": False}   # 영종 앞바다


@pytest.mark.parametrize("params", [{}, {"lon": 126.7}, {"lon": "x", "lat": 37.4}, {"lon": 200, "lat": 37.4}])
def test_point_bad_params_422(client, params):
    assert client.get("/api/point", params=params).status_code == 422


def test_grade_rounds_first():
    from app import grade
    assert [grade(v) for v in (None, 15.49, 15.5, 35.5, 75.49, 75.5)] == [None, "좋음", "보통", "나쁨", "나쁨", "매우나쁨"]


def test_day_night():
    from datetime import datetime, timedelta, timezone
    from sun import is_day
    kst = timezone(timedelta(hours=9))
    assert is_day(datetime(2026, 10, 16, 13, 20, tzinfo=kst))
    assert not is_day(datetime(2026, 10, 16, 22, 0, tzinfo=kst))


# ── 로컬 개발용 CORS (DB 없는 /openapi.json으로) ──────────────

ACAO = "access-control-allow-origin"


@pytest.mark.parametrize("origin", ["http://localhost:8766", "http://127.0.0.1:8766", "http://localhost"])
def test_cors_allows_local(client, origin):
    assert client.get("/openapi.json", headers={"Origin": origin}).headers.get(ACAO) == origin


@pytest.mark.parametrize("origin", ["http://evil.example", "http://localhost.evil.example", "http://localhost:8766.evil.example",
                                    "https://incheon-air.duckdns.org", "http://192.168.0.5:8766", "null"])
def test_cors_blocks_others(client, origin):
    assert ACAO not in client.get("/openapi.json", headers={"Origin": origin}).headers


def test_cors_preflight_get_only(client):
    pre = {"Origin": "http://localhost:8766", "Access-Control-Request-Method": "GET"}
    r = client.options("/api/grid", headers=pre)
    assert r.status_code == 200 and r.headers[ACAO] == "http://localhost:8766"
    assert client.options("/api/ingest/estimates", headers={**pre, "Access-Control-Request-Method": "POST"}).status_code == 400
    assert ACAO not in client.options("/api/grid", headers={**pre, "Origin": "http://evil.example"}).headers
