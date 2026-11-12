"""실제 PostgreSQL 테스트. TEST_DATABASE_URL이 없으면 건너뛴다."""
from collections import defaultdict

import pytest

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


SONGDO = {"lon": 126.6395, "lat": 37.3935}   # 송도 센트럴파크 (mock과 같은 점). 비교용 측정소: 아암 1.43km, 송도 1.84km


def obs(db, *rows):
    """(측정소, data_time, pm25)"""
    with db.cursor() as cur:
        cur.executemany("INSERT INTO observations (station_name, data_time, pm25) VALUES (%s, %s, %s)", rows)


def station_at(client, params=SONGDO):
    return client.get("/api/point", params=params).json()["station"]


def test_point_matches_mock(client, db):
    post(client, mock("ingest_estimates.json")["rows"])
    obs(db, ("아암", "2026-10-16T13:00+09", 11), ("아암", "2026-10-16T12:00+09", 30))
    want = mock("next/point_inside.json")
    got = client.get("/api/point", params=SONGDO).json()
    assert got["inside"] and got["gu"] == want["gu"] and got["grid_id"] == want["grid_id"]
    assert got["estimate"] == want["estimate"]
    assert got["station"] == want["station"]   # 가장 가까운 측정소, 가장 최근 시각, 거리 1.43 → 1.4, nearest null
    # camera: mock은 모양 예시(10042, 실제 거리 2.88km). 규칙대로면 가장 가까운 113(2.43km)
    assert got.keys() == want.keys() and got["camera"].keys() == want["camera"].keys()
    assert got["camera"] == {"camera_id": "113", "name": "송도1교사거리", "distance_km": 2.4,
                             "slot": "2026-10-16T13:20:00+09:00", "captured_at": "2026-10-16T13:20:14+09:00",
                             "pm25": 9.2, "status": "정상", "photo_url": "/cam/113.jpg?v=20261016132014",
                             "lon": 126.666945, "lat": 37.392985, "nearest": None}


def test_point_camera_latest_row_and_null(client, db):
    rows = mock("ingest_estimates.json")["rows"]
    r113 = next(r for r in rows if r["camera_id"] == "113")
    assert client.get("/api/point", params=SONGDO).json()["camera"] is None   # 그 카메라 행이 하나도 없음
    post(client, [{**r113, "slot": "2026-10-16T13:00:00+09:00", "captured_at": "2026-10-16T13:00:09+09:00", "pm25_est": 30.0}])
    post(client, [{**r113, "slot": "2026-10-16T13:40:00+09:00", "captured_at": None, "pm25_est": None, "status": "습도 결측"}])
    c = client.get("/api/point", params=SONGDO).json()["camera"]
    # 가장 최근 회차(13:40) — 결측이어도 그 줄. captured_at이 없으면 ?v=는 회차 시각
    assert (c["slot"], c["captured_at"], c["pm25"], c["status"], c["photo_url"]) == \
           ("2026-10-16T13:40:00+09:00", None, None, "습도 결측", "/cam/113.jpg?v=20261016134000")
    # 다른 카메라 행만 있어도 가장 가까운 카메라 기준 (메우지 않음)
    db.execute("DELETE FROM estimates WHERE camera_id = '113'")
    post(client, [r for r in rows if r["camera_id"] == "10042"])
    assert client.get("/api/point", params=SONGDO).json()["camera"] is None


def test_point_camera_excludes_out_of_area(client, db):
    # 103번(강화, grid_id 없음) 바로 옆이 범위 안이어도 103은 고르지 않는다. 범위 밖이면 inside:false만
    post(client, mock("ingest_estimates.json")["rows"])
    near103 = {"lon": 126.532778, "lat": 37.627553}
    got = client.get("/api/point", params=near103).json()
    assert got == {"inside": False} or got["camera"]["camera_id"] != "103"
    db.execute("UPDATE cameras SET lon = 126.6395, lat = 37.3935 WHERE camera_id = '103'")   # 103을 송도로 옮겨도
    assert client.get("/api/point", params=SONGDO).json()["camera"]["camera_id"] == "113"


def test_point_station_skips_non_compare(client, db):
    db.execute("UPDATE stations SET use_for_compare = false WHERE station_name = '아암'")
    obs(db, ("아암", "2026-10-16T13:00+09", 11), ("송도", "2026-10-16T13:00+09", 14))
    s = station_at(client)
    assert (s["name"], s["distance_km"], s["pm25"]) == ("송도", 1.8, 14)


def flagged(db, name, t, flag):
    db.execute("UPDATE observations SET pm25_flag = %s WHERE station_name = %s AND data_time = %s", (flag, name, t))


def test_point_station_null_goes_to_next_same_time(client, db):
    # 아암의 13시가 결측이면 같은 13시에 값이 있는 송도로. 12시 아암 값으로 메우지 않는다(F14)
    obs(db, ("아암", "2026-10-16T12:00+09", 30), ("아암", "2026-10-16T13:00+09", None), ("송도", "2026-10-16T13:00+09", 14))
    assert station_at(client) == {"name": "송도", "distance_km": 1.8, "pm25": 14,
                                  "data_time": "2026-10-16T13:00:00+09:00", "period": "12~13시 평균",
                                  "lon": 126.654663, "lat": 37.382084,
                                  "nearest": {"name": "아암", "distance_km": 1.4, "reason": None,
                                              "lon": 126.63227, "lat": 37.40508}}


def test_point_station_reference_time_is_latest_compare_value(client, db):
    # 아암 마지막이 12시, 송도가 14시면 기준 시각 14시 → 송도. 행이 없는 아암은 reason null
    obs(db, ("아암", "2026-10-16T11:00+09", 20), ("아암", "2026-10-16T12:00+09", 30), ("송도", "2026-10-16T14:00+09", 14))
    s = station_at(client)
    assert (s["name"], s["pm25"], s["data_time"], s["period"], s["nearest"]["name"], s["nearest"]["reason"]) == \
           ("송도", 14, "2026-10-16T14:00:00+09:00", "13~14시 평균", "아암", None)
    # 비교용이 아닌 측정소(운서)의 더 최근 값은 기준 시각이 되지 않는다
    obs(db, ("운서", "2026-10-16T15:00+09", 5))
    assert station_at(client)["data_time"] == "2026-10-16T14:00:00+09:00"


def test_point_station_no_observations(client, db):
    assert station_at(client) == {"name": "아암", "distance_km": 1.4, "pm25": None, "data_time": None, "period": None,
                                  "lon": 126.63227, "lat": 37.40508, "nearest": None}


def test_point_station_kst_and_midnight(client, db):
    obs(db, ("아암", "2026-10-16T15:00Z", 8.25))   # UTC로 넣어도 응답은 +09:00, 17일 00:00 = 16일 23~24시
    s = station_at(client)
    assert (s["data_time"], s["period"], s["pm25"]) == ("2026-10-17T00:00:00+09:00", "23~24시 평균", 8.2)


def test_point_station_other_place(client, db):
    obs(db, ("송도", "2026-10-16T13:00+09", 14))
    # 송도 측정소 바로 옆을 누르면 송도, 거리 0.0
    assert station_at(client, {"lon": 126.654663, "lat": 37.382084})["name"] == "송도"
    assert station_at(client, {"lon": 126.654663, "lat": 37.382084})["distance_km"] == 0.0


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


# ── S2: 밤·빈 회차 = 측정소 프레임 ─────────────────────────────

NIGHT_OBS = [("아암", "2026-10-16T21:00+09", 12), ("송도", "2026-10-16T21:00+09", 10),
             ("동춘", "2026-10-16T21:00+09", None),   # 결측은 입력에서 뺀다
             ("아암", "2026-10-16T20:00+09", 40)]     # 다른 시각은 쓰지 않는다


def at(monkeypatch, *a):
    from datetime import datetime, timedelta, timezone
    import app
    monkeypatch.setattr(app, "now", lambda: datetime(*a, tzinfo=timezone(timedelta(hours=9))))


def frame(db, slot):
    return db.execute("SELECT source, basis_time, n_inputs, inputs FROM frames WHERE slot = %s", (slot,)).fetchone()


def test_night_station_frame_matches_mock_shape(client, db, monkeypatch):
    import app
    from idw import idw
    obs(db, *NIGHT_OBS)
    at(monkeypatch, 2026, 10, 16, 21, 50)
    assert app.night_frame() == 2
    got, want = client.get("/api/frames/latest").json(), mock("next/frames_latest_night.json")
    assert got.keys() == want.keys()
    assert (got["slot"], got["source"], got["basis_time"], got["n_inputs"]) == \
           ("2026-10-16T21:00:00+09:00", "station", "2026-10-16T21:00:00+09:00", 2)
    st = {n: (x, y) for n, x, y in db.execute("SELECT station_name, lon, lat FROM stations")}
    centers = [c["center"] for c in mock("grid.json")["cells"]]
    assert got["values"] == idw(centers, [(*st["송도"], 10), (*st["아암"], 12)])
    assert len(got["values"]) == 456 and got["updated_at"].endswith("+09:00")
    # 같은 시각에 다시 돌아도 한 줄
    assert app.night_frame() == 2 and count(db, "SELECT count(*) FROM frames") == 1


def test_night_frame_only_at_night(client, db, monkeypatch):
    import app
    obs(db, *NIGHT_OBS)
    at(monkeypatch, 2026, 10, 16, 13, 50)
    assert app.night_frame() == 0 and count(db, "SELECT count(*) FROM frames") == 0


def test_night_frame_without_observations(client, db, monkeypatch):
    import app
    at(monkeypatch, 2026, 10, 16, 21, 50)
    obs(db, ("아암", "2026-10-16T21:00+09", None))   # 결측뿐이어도 값을 만들지 않는다
    assert app.night_frame() == 0 and count(db, "SELECT count(*) FROM frames") == 0
    assert client.get("/api/frames/latest").status_code == 404


def test_station_frame_never_overwrites_cctv(client, db, monkeypatch):
    # 해 뜰 무렵 07:00 = 정시 측정소 슬롯이자 CCTV 회차
    import app
    rows = [{**r, "slot": "2026-10-16T07:00:00+09:00"} for r in mock("ingest_estimates.json")["rows"]]
    post(client, rows)
    before = db.execute("SELECT values::float8[] FROM frames").fetchone()[0]
    obs(db, ("아암", "2026-10-16T07:00+09", 50))
    assert app.station_frame(db, "2026-10-16T07:00+09", "2026-10-16T07:00+09") == 0
    at(monkeypatch, 2026, 10, 16, 21, 50)   # 밤 경로로 돌아도 (07:00이 가장 최근 실측)
    assert app.night_frame() == 0
    assert frame(db, "2026-10-16T07:00+09")[:3] == ("cctv", None, 19)
    assert db.execute("SELECT values::float8[] FROM frames").fetchone()[0] == before


def test_empty_day_slot_uses_latest_obs_then_cctv_wins(client, db):
    rows = mock("ingest_estimates.json")["rows"]   # 13:20 회차
    obs(db, ("아암", "2026-10-16T12:00+09", 30), ("아암", "2026-10-16T13:00+09", 11), ("송도", "2026-10-16T13:00+09", 9),
        ("아암", "2026-10-16T14:00+09", 99))   # 회차보다 뒤 시각은 쓰지 않는다
    res = post(client, [{**r, "pm25_est": None, "status": "비"} for r in rows])
    assert res["frames"] == [{"slot": "2026-10-16T13:20:00+09:00", "n_inputs": 0}]   # 수신 응답 모양은 그대로
    source, basis, n, inputs = frame(db, "2026-10-16T13:20+09")
    assert (source, client.get("/api/frames/latest").json()["basis_time"], n, inputs) == \
           ("station", "2026-10-16T13:00:00+09:00", 2, ["송도", "아암"])
    # 나중에 CCTV 값이 오면(습도 결측 행은 약 1시간 뒤) CCTV 프레임으로 바뀐다
    post(client, rows)
    assert frame(db, "2026-10-16T13:20+09")[:3] == ("cctv", None, 19)
    assert client.get("/api/frames/latest").json()["values"] == mock("frames_latest.json")["values"]
    # 다시 전부 null이 되면 측정소로 되돌아감. 회차당 한 줄
    post(client, [{**r, "pm25_est": None, "status": "비"} for r in rows])
    assert frame(db, "2026-10-16T13:20+09")[0] == "station" and count(db, "SELECT count(*) FROM frames") == 1


def test_station_frame_error_does_not_break_ingest(client, db, monkeypatch):
    import app
    obs(db, ("아암", "2026-10-16T13:00+09", 11))

    def boom(*a):
        raise RuntimeError("측정소 프레임 실패")
    monkeypatch.setattr(app, "station_frame", boom)
    rows = mock("ingest_estimates.json")["rows"]
    post(client, [{**r, "pm25_est": None, "status": "비"} for r in rows])   # 200
    assert count(db, "SELECT count(*) FROM estimates") == 19 and count(db, "SELECT count(*) FROM frames") == 0
    assert count(db, "SELECT error FROM ingest_log") is None


# ── S10: 전시용 ?source=cctv ───────────────────────────────────

def night_after_cctv(client, db, monkeypatch):
    """13:20 CCTV 회차 + 그보다 최근인 21:00 밤 측정소 프레임"""
    import app
    post(client, mock("ingest_estimates.json")["rows"])
    obs(db, *NIGHT_OBS)
    at(monkeypatch, 2026, 10, 16, 21, 50)
    assert app.night_frame() == 2


def test_source_cctv_skips_newer_station_frame(client, db, monkeypatch):
    night_after_cctv(client, db, monkeypatch)
    got = client.get("/api/frames/latest", params={"source": "cctv"}).json()
    want = mock("frames_latest.json")
    assert {k: got[k] for k in ("slot", "source", "basis_time", "n_inputs", "values")} == \
           {k: want[k] for k in ("slot", "source", "basis_time", "n_inputs", "values")}
    p = client.get("/api/point", params={**SONGDO, "source": "cctv"}).json()
    assert p["estimate"] == mock("point_inside.json")["estimate"]   # 13:20 CCTV 회차 값
    plain = client.get("/api/point", params=SONGDO).json()
    assert (p["station"], p["camera"]) == (plain["station"], plain["camera"])   # 실측·사진은 그대로


def test_no_source_unchanged(client, db, monkeypatch):
    night_after_cctv(client, db, monkeypatch)
    f = client.get("/api/frames/latest").json()
    assert (f["slot"], f["source"], f["basis_time"]) == \
           ("2026-10-16T21:00:00+09:00", "station", "2026-10-16T21:00:00+09:00")
    e = client.get("/api/point", params=SONGDO).json()["estimate"]
    assert (e["slot"], e["source"]) == ("2026-10-16T21:00:00+09:00", "station")


def test_source_cctv_without_cctv_frame(client, db, monkeypatch):
    import app
    obs(db, *NIGHT_OBS)
    at(monkeypatch, 2026, 10, 16, 21, 50)
    app.night_frame()   # 측정소 프레임만 있음 — 가짜 CCTV 값을 만들지 않는다
    assert client.get("/api/frames/latest").status_code == 200
    assert client.get("/api/frames/latest", params={"source": "cctv"}).status_code == 404
    assert client.get("/api/point", params={**SONGDO, "source": "cctv"}).json()["estimate"] is None
    assert client.get("/api/point", params=SONGDO).json()["estimate"]["source"] == "station"


# ── F12: 유효 CCTV가 MIN_CCTV(10)대 미만이면 측정소 지도 ─────────────

def test_few_cctv_values_use_station_frame(client, db):
    import app
    rows = mock("ingest_estimates.json")["rows"]   # 13:20 회차 19대
    obs(db, ("아암", "2026-10-16T13:00+09", 11), ("송도", "2026-10-16T13:00+09", 9))
    few = [r if i < app.MIN_CCTV - 1 else {**r, "pm25_est": None, "status": "비"} for i, r in enumerate(rows)]
    res = post(client, few)
    assert res["frames"] == [{"slot": "2026-10-16T13:20:00+09:00", "n_inputs": app.MIN_CCTV - 1}]   # 응답은 CCTV 유효값 수 그대로
    assert frame(db, "2026-10-16T13:20+09")[:2][0] == "station"
    # 한 대가 더 오면 MIN_CCTV대 → CCTV 지도
    post(client, [rows[app.MIN_CCTV - 1]])
    assert frame(db, "2026-10-16T13:20+09")[:3] == ("cctv", None, app.MIN_CCTV)


# ── F11: 최신 지도 = 자료 시각이 가장 늦은 것, 같으면 CCTV ─────────────

def at_slot(rows, slot):
    return [{**r, "slot": slot} for r in rows]


def latest(client):
    f = client.get("/api/frames/latest").json()
    e = client.get("/api/point", params=SONGDO).json()["estimate"]
    assert (e["slot"], e["source"]) == (f["slot"], f["source"])   # 지도와 지점 조회가 같은 지도를 고른다
    return f["slot"], f["source"], f["basis_time"]


def test_latest_empty_slot_with_newer_obs_wins(client, db):
    rows = mock("ingest_estimates.json")["rows"]
    post(client, at_slot(rows, "2026-10-16T12:40:00+09:00"))                     # CCTV 12:40
    obs(db, ("아암", "2026-10-16T13:00+09", 11), ("송도", "2026-10-16T13:00+09", 9))
    post(client, [{**r, "pm25_est": None, "status": "비"} for r in rows])         # 13:20 빈 회차 → 13:00 실측
    assert latest(client) == ("2026-10-16T13:20:00+09:00", "station", "2026-10-16T13:00:00+09:00")


def test_latest_stale_obs_does_not_push_out_newer_cctv(client, db):
    rows = mock("ingest_estimates.json")["rows"]
    post(client, at_slot(rows, "2026-10-16T12:40:00+09:00"))                     # CCTV 12:40
    obs(db, ("아암", "2026-10-15T13:00+09", 11), ("송도", "2026-10-15T13:00+09", 9))   # 에어코리아가 어제부터 멈춤
    post(client, [{**r, "pm25_est": None, "status": "비"} for r in rows])         # 13:20 빈 회차 → 어제 실측으로 채워짐
    assert frame(db, "2026-10-16T13:20+09")[0] == "station"
    assert latest(client) == ("2026-10-16T12:40:00+09:00", "cctv", None)


def test_latest_older_obs_than_cctv_loses(client, db):
    rows = mock("ingest_estimates.json")["rows"]
    post(client, rows)                                                            # CCTV 13:20
    obs(db, ("아암", "2026-10-16T13:00+09", 11), ("송도", "2026-10-16T13:00+09", 9))
    post(client, [{**r, "pm25_est": None, "status": "비"} for r in at_slot(rows, "2026-10-16T14:00:00+09:00")])
    assert frame(db, "2026-10-16T14:00+09")[0] == "station"                       # 14:00 빈 회차는 13:00 실측으로
    assert latest(client) == ("2026-10-16T13:20:00+09:00", "cctv", None)


def test_latest_tie_prefers_cctv(client, db):
    rows = mock("ingest_estimates.json")["rows"]
    post(client, at_slot(rows, "2026-10-16T13:00:00+09:00"))                     # CCTV 13:00
    obs(db, ("아암", "2026-10-16T13:00+09", 11), ("송도", "2026-10-16T13:00+09", 9))
    post(client, [{**r, "pm25_est": None, "status": "비"} for r in rows])         # 13:20 빈 회차 → 자료 시각 13:00 (동점)
    assert latest(client) == ("2026-10-16T13:00:00+09:00", "cctv", None)


# ── F13: /api/frames/latest의 reason·cctv ──────────────────────

RAIN, HUMID, WX_MISSING = "비(60분 강수량) — 추정 안 함", "습도 95% 이상 — 추정 안 함", "습도 결측"


def screen_rows(db, *groups):
    """화면 범위 카메라 19대의 13:20 행. groups = (대수, status, pm25). 대수를 다 못 채운 카메라는 행을 만들지 않음"""
    base = mock("ingest_estimates.json")["rows"][0]
    ids = iter(r[0] for r in db.execute("SELECT camera_id FROM cameras WHERE grid_id IS NOT NULL ORDER BY camera_id"))
    return [{**base, "camera_id": next(ids), "status": st, "pm25_est": pm} for n, st, pm in groups for _ in range(n)]


def state_of(client):
    f = client.get("/api/frames/latest").json()
    return f["source"], f["reason"], f["cctv"]


def test_state_normal_keys_match_next(client, db):
    post(client, screen_rows(db, (19, "정상", 10.0)))
    assert state_of(client) == ("cctv", "normal", {"valid": 19, "total": 20})
    assert client.get("/api/frames/latest").json().keys() == mock("next/frames_latest.json").keys()


def test_camera_ids_lists_only_cameras_with_a_value(client, db):
    rows = screen_rows(db, (17, "정상", 10.0), (2, RAIN, None))
    post(client, rows)
    f = client.get("/api/frames/latest").json()
    assert f["camera_ids"] == sorted(r["camera_id"] for r in rows if r["pm25_est"] is not None) and len(f["camera_ids"]) == 17


def test_state_night_is_null(client, db, monkeypatch):
    night_after_cctv(client, db, monkeypatch)
    f = client.get("/api/frames/latest").json()
    assert (f["source"], f["reason"], f["cctv"]) == ("station", "night", None)
    assert f.keys() == mock("next/frames_latest_night.json").keys()
    # ?source=cctv는 같은 필드, 항상 normal. 103번까지 세고 124번은 이 회차에 없어 19/20
    c = client.get("/api/frames/latest", params={"source": "cctv"}).json()
    assert (c["source"], c["reason"], c["cctv"]) == ("cctv", "normal", {"valid": 19, "total": 20})


@pytest.mark.parametrize("groups, reason, valid, example", [
    ([(19, RAIN, None)], "rain", 0, "frames_latest_rain.json"),
    ([(19, HUMID, None)], "humidity", 0, "frames_latest_rain.json"),
    ([(19, WX_MISSING, None)], "no_data", 0, "frames_latest_rain.json"),
    ([(19, "사진 읽기 실패", None)], "no_data", 0, "frames_latest_rain.json"),
    ([(9, "정상", 10.0), (10, RAIN, None)], "rain", 9, "frames_latest_few.json"),        # 몇 대 살아 있어도 빠진 이유가 비면 rain
    ([(3, "정상", 10.0), (16, HUMID, None)], "humidity", 3, "frames_latest_few.json"),   # 11/13 아침(습도 97%): "3대뿐" 대신 습도
    ([(9, "정상", 10.0), (10, "사진 읽기 실패", None)], "few_cameras", 9, "frames_latest_few.json"),
    ([(1, "정상", 10.0)], "few_cameras", 1, "frames_latest_few.json"),       # 나머지 18대는 행이 없음
    ([(3, "정상", 10.0), (8, HUMID, None)], "few_cameras", 3, "frames_latest_few.json"),  # 빠진 17대 중 습도 8 < 행 없음 9(103번 포함)
    ([(10, RAIN, None), (9, HUMID, None)], "rain", 0, "frames_latest_rain.json"),
    ([(5, RAIN, None), (14, HUMID, None)], "humidity", 0, "frames_latest_rain.json"),
    ([(7, RAIN, None), (7, HUMID, None), (5, WX_MISSING, None)], "rain", 0, "frames_latest_rain.json"),     # 같은 수: rain > humidity
    ([(4, RAIN, None), (8, HUMID, None), (7, WX_MISSING, None)], "humidity", 0, "frames_latest_rain.json"),  # 같은 수(103번 포함 no_data 8): humidity > no_data
    ([(5, RAIN, None), (5, HUMID, None)], "no_data", 0, "frames_latest_rain.json"),                         # 행이 없는 10대(103번 포함)는 no_data
])
def test_state_day_station(client, db, groups, reason, valid, example):
    obs(db, ("아암", "2026-10-16T13:00+09", 11))
    post(client, screen_rows(db, *groups))
    assert state_of(client) == ("station", reason, {"valid": valid, "total": 20})
    assert client.get("/api/frames/latest").json().keys() == mock("next/" + example).keys()


# ── F14: 근거 패널을 지도와 같은 재료로 + 건너뛴 이유 ────────────

def rows_without(*cameras):
    return [r for r in mock("ingest_estimates.json")["rows"] if r["camera_id"] not in cameras]


def r113(**kw):
    return {**next(r for r in mock("ingest_estimates.json")["rows"] if r["camera_id"] == "113"), **kw}


def point_at(client, **kw):
    return client.get("/api/point", params={**SONGDO, **kw}).json()


def test_fallback_matches_next_example(client, db):
    # 가장 가까운 113은 이 회차 행 없음(12:20이 마지막 값) → 10042 + no_feed + since 12:40. 아암은 빈 값 + 통신장애 → 송도
    post(client, [r113(slot="2026-10-16T12:20:00+09:00", captured_at="2026-10-16T12:20:14+09:00")])
    post(client, rows_without("113"))
    obs(db, ("아암", "2026-10-16T13:00+09", None), ("송도", "2026-10-16T13:00+09", 9))
    flagged(db, "아암", "2026-10-16T13:00+09", "통신장애")
    got, want = point_at(client), mock("next/point_fallback.json")
    assert got["camera"] == want["camera"] and got["station"] == want["station"]
    assert got.keys() == want.keys()


@pytest.mark.parametrize("status, reason", [
    (RAIN, "rain"), (HUMID, "humidity"), (WX_MISSING, "weather_missing"), ("사진 읽기 실패", "photo_error"),
])
def test_nearest_camera_skip_reason(client, db, status, reason):
    post(client, [*rows_without("113"), r113(pm25_est=None, status=status)])
    c = point_at(client)["camera"]
    assert (c["camera_id"], c["nearest"]["camera_id"], c["nearest"]["reason"]) == ("10042", "113", reason)
    assert c["nearest"]["since"] is None   # 그날 값을 낸 적 없음


def test_since_only_counts_same_day(client, db):
    post(client, [r113(slot="2026-10-15T23:40:00+09:00", captured_at="2026-10-15T23:40:14+09:00")])   # 전날 값
    post(client, rows_without("113"))
    assert point_at(client)["camera"]["nearest"]["since"] is None


def test_station_map_keeps_nearest_camera_latest_row(client, db, monkeypatch):
    # 밤 측정소 지도: 건너뛰지 않고 가장 가까운 113의 가장 최근 행
    post(client, [r113(slot="2026-10-16T12:20:00+09:00", captured_at="2026-10-16T12:20:14+09:00")])
    post(client, rows_without("113"))
    import app
    obs(db, *NIGHT_OBS)
    at(monkeypatch, 2026, 10, 16, 21, 50)
    assert app.night_frame() == 2
    p = point_at(client)
    assert (p["estimate"]["source"], p["camera"]["camera_id"], p["camera"]["slot"], p["camera"]["nearest"]) == \
           ("station", "113", "2026-10-16T12:20:00+09:00", None)
    # ?source=cctv면 그 CCTV 지도 기준으로 건너뜀
    c = point_at(client, source="cctv")["camera"]
    assert (c["camera_id"], c["slot"], c["nearest"]["reason"]) == ("10042", "2026-10-16T13:20:00+09:00", "no_feed")


def test_photo_hidden_when_file_is_newer_than_row(client, db):
    # 13:20 CCTV 지도 뒤 13:40이 비: 사진 파일은 13:40으로 덮였으므로 13:20 값·시각에 붙이지 않는다
    rows = mock("ingest_estimates.json")["rows"]
    post(client, rows)
    assert point_at(client, source="cctv")["camera"]["photo_url"]
    post(client, [{**r, "slot": "2026-10-16T13:40:00+09:00", "captured_at": "2026-10-16T13:40:14+09:00",
                   "pm25_est": None, "status": RAIN} for r in rows])
    c = point_at(client, source="cctv")["camera"]
    assert (c["slot"], c["pm25"], c["photo_url"]) == ("2026-10-16T13:20:00+09:00", 9.2, None)
