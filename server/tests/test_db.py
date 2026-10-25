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
    assert init(db) == {"grid_cells": 388, "cameras": 20, "stations": 53, "model_versions": 2}
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
