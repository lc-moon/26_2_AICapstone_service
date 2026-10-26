"""실제 PostgreSQL 테스트. TEST_DATABASE_URL이 없으면 건너뛴다."""
from collections import defaultdict

from conftest import AUTH, mock
from init_db import init

URL = "/api/ingest/estimates"


def post(client, rows):
    r = client.post(URL, json={"rows": rows}, headers=AUTH)
    assert r.status_code == 200, r.text
    return r.json()


def count(db, sql, *args):
    return db.execute(sql, args).fetchone()[0]


def test_init_is_idempotent(db):
    db.execute("INSERT INTO estimates (camera_id, slot, status) VALUES ('121', '2026-10-16T13:20+09', '정상')")
    assert init(db) == {"grid_cells": 456, "cameras": 20, "stations": 53, "model_versions": 2}
    assert count(db, "SELECT count(*) FROM estimates") == 1   # 시계열은 지우지 않는다


def test_grid_matches_mock(client, db):
    assert client.get("/api/grid").json() == mock("grid.json")


def test_frames_latest_empty_404(client, db):
    assert client.get("/api/frames/latest").status_code == 404


def test_ingest_matches_frames_latest(client, db):
    rows = mock("ingest_estimates.json")["rows"]
    res = post(client, rows)
    assert res["rows_upserted"] == 19 and res["frames"] == [{"slot": "2026-10-16T13:20:00+09:00", "n_inputs": 19}]
    got, want = client.get("/api/frames/latest").json(), mock("frames_latest.json")
    assert {k: got[k] for k in ("slot", "source", "basis_time", "n_inputs", "values")} == \
           {k: want[k] for k in ("slot", "source", "basis_time", "n_inputs", "values")}
    assert got["updated_at"].endswith("+09:00")
    assert count(db, "SELECT rows_upserted FROM ingest_log") == 19


def test_repeat_ingest_no_duplicates(client, db):
    rows = mock("ingest_estimates.json")["rows"]
    post(client, rows)
    post(client, rows)
    assert count(db, "SELECT count(*) FROM estimates") == 19
    assert count(db, "SELECT count(*) FROM frames") == 1


def test_overwrite_same_camera_slot(client, db):
    rows = mock("ingest_estimates.json")["rows"]
    post(client, rows)
    post(client, [{**rows[0], "pm25_est": 99.0}])
    assert count(db, "SELECT pm25_est FROM estimates WHERE camera_id = %s", rows[0]["camera_id"]) == 99.0
    assert client.get("/api/frames/latest").json()["values"] != mock("frames_latest.json")["values"]


def test_split_arrival_keeps_earlier_rows(client, db):
    rows = mock("ingest_estimates.json")["rows"]
    assert post(client, rows[:8])["frames"][0]["n_inputs"] == 8
    assert post(client, rows[8:])["frames"][0]["n_inputs"] == 19
    assert client.get("/api/frames/latest").json()["values"] == mock("frames_latest.json")["values"]


def test_whole_day_out_of_order_chunks(client, db):
    rows = mock("ingest_2026-10-16.json")["rows"]
    chunks = [rows[i:i + 7] for i in range(0, len(rows), 7)]   # 회차를 가로질러 나눔
    for c in reversed(chunks):                                   # 늦게 오는 값
        post(client, c)
    got = dict(db.execute("SELECT to_char(slot AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD\"T\"HH24:MI:SS+09:00'),"
                          " values::float8[] FROM frames").fetchall())
    want = mock("frames_2026-10-16.json")["frames"]
    assert len(got) == len(want) == 33
    for f in want:
        assert [round(v, 1) for v in got[f["slot"]]] == f["values"], f["slot"]
    latest = client.get("/api/frames/latest").json()
    assert latest["slot"] == want[-1]["slot"] and latest["values"] == want[-1]["values"]
    # 103번이 습도로 빠진 07:40은 그 카메라 없이 계산
    by_slot = defaultdict(int)
    for r in rows:
        by_slot[r["slot"]] += r["pm25_est"] is not None
    assert count(db, "SELECT n_inputs FROM frames WHERE slot = '2026-10-16T07:40+09'") == by_slot["2026-10-16T07:40:00+09:00"]


def test_unknown_camera_skipped_and_logged(client, db):
    rows = mock("ingest_estimates.json")["rows"]
    res = post(client, [*rows, {**rows[0], "camera_id": "999"}])
    assert res["unknown_cameras"] == ["999"] and res["rows_upserted"] == 19
    assert "999" in count(db, "SELECT error FROM ingest_log")


def test_new_model_registered(client, db):
    rows = [{**r, "model": "new_model_v2"} for r in mock("ingest_estimates.json")["rows"]]
    assert post(client, rows)["new_models"] == ["new_model_v2"]
    assert count(db, "SELECT count(*) FROM estimates WHERE model = 'new_model_v2'") == 19


def test_all_null_slot_has_no_frame(client, db):
    rows = mock("ingest_estimates.json")["rows"]
    post(client, rows)
    res = post(client, [{**r, "pm25_est": None, "status": "비"} for r in rows])
    assert res["frames"][0]["n_inputs"] == 0
    assert count(db, "SELECT count(*) FROM frames") == 0
    assert count(db, "SELECT count(*) FROM estimates") == 19


def test_point_matches_mock(client, db):
    post(client, mock("ingest_estimates.json")["rows"])
    want = mock("point_inside.json")
    got = client.get("/api/point", params={"lon": 126.6395, "lat": 37.3935}).json()   # 송도 센트럴파크 (mock과 같은 점)
    assert got["inside"] and got["gu"] == want["gu"] and got["grid_id"] == want["grid_id"]
    assert got["estimate"] == want["estimate"]
    assert got["station"] is None   # 에어코리아 수집 전


def test_point_every_cell_center_has_value(client, db):
    post(client, mock("ingest_estimates.json")["rows"])
    values = mock("frames_latest.json")["values"]
    for c in mock("grid.json")["cells"][::25]:
        lon, lat = c["center"]
        got = client.get("/api/point", params={"lon": lon, "lat": lat}).json()
        if got["inside"]:   # 칸 중심이 바다인 해안 칸은 범위 밖일 수 있다
            assert got["grid_id"] == c["grid_id"] and got["estimate"]["pm25"] == values[c["grid_id"]]


def test_point_before_any_frame(client, db):
    got = client.get("/api/point", params={"lon": 126.6395, "lat": 37.3935}).json()
    assert got["inside"] and got["estimate"] is None


def test_health(client, db, monkeypatch):
    from datetime import datetime, timedelta, timezone
    import app
    kst = timezone(timedelta(hours=9))
    at = lambda *a: monkeypatch.setattr(app, "now", lambda: datetime(*a, tzinfo=kst))

    at(2026, 10, 16, 13, 50)
    assert client.get("/api/health").json() == {"last_slot": None, "last_received_at": None, "stale": True}

    post(client, mock("ingest_estimates.json")["rows"])
    db.execute("UPDATE estimates SET received_at = '2026-10-16T13:25:00+09'")
    want = {"last_slot": "2026-10-16T13:20:00+09:00", "last_received_at": "2026-10-16T13:25:00+09:00"}
    assert client.get("/api/health").json() == {**want, "stale": False}   # 25분 전
    at(2026, 10, 16, 14, 10)
    assert client.get("/api/health").json() == {**want, "stale": True}    # 45분 전, 낮
    at(2026, 10, 16, 22, 0)
    assert client.get("/api/health").json()["stale"] is False             # 밤
    at(2026, 10, 17, 6, 50)
    assert client.get("/api/health").json()["stale"] is False             # 해 뜬 직후 40분은 기다린다


def test_cors_on_real_endpoint(client, db):
    # NEXT.md 1번 완료 기준: 프레임이 없을 때(404)도 허용된 출처면 헤더가 붙어야 화면이 404를 읽을 수 있음
    r = client.get("/api/frames/latest", headers={"Origin": "http://localhost:8766"})
    assert r.status_code == 404 and r.headers["access-control-allow-origin"] == "http://localhost:8766"
    assert "access-control-allow-origin" not in client.get("/api/frames/latest", headers={"Origin": "http://evil.example"}).headers
