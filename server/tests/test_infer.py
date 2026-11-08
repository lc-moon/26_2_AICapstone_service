"""POST /api/infer (NEXT.md S5). 실제 사진·모델 대신 tests/fake_infer.py를 INFER_CMD로 쓴다. 카메라 확인에 DB가 필요."""
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path

import pytest

from conftest import mock

FAKE = f'"{Path(sys.executable).as_posix()}" "{(Path(__file__).parent / "fake_infer.py").as_posix()}"'


@pytest.fixture
def infer(client, db, monkeypatch):
    import app
    monkeypatch.setattr(app, "infer_cache", {})
    clock = [app.now()]
    monkeypatch.setattr(app, "now", lambda: clock[0])

    def call(camera_id="10042", args=""):
        monkeypatch.setenv("INFER_CMD", f"{FAKE} {args}")
        return client.post("/api/infer", params={"camera_id": camera_id})
    call.clock = clock
    return call


def test_ok_matches_mock_and_saves_nothing(infer, db):
    r = infer()
    assert r.status_code == 200
    got, want = r.json(), mock("infer_ok.json")
    assert {k: v for k, v in got.items() if k != "elapsed_s"} == {k: v for k, v in want.items() if k != "elapsed_s"}
    assert isinstance(got["elapsed_s"], float) and got["elapsed_s"] >= 0
    assert db.execute("SELECT (SELECT count(*) FROM estimates) + (SELECT count(*) FROM frames)").fetchone()[0] == 0


def test_rain_has_null_grade(infer):
    got, want = infer("10042", "--rain").json(), mock("infer_rain.json")
    assert (got["pm25"], got["grade"], got["status"]) == (None, None, want["status"])


@pytest.mark.parametrize("camera_id", ["999", "10042; rm -rf /", "../10042"])
def test_unknown_camera_404(infer, camera_id):
    assert infer(camera_id).status_code == 404


def test_bad_camera_param_422(client):
    assert client.post("/api/infer").status_code == 422
    assert client.post("/api/infer", params={"camera_id": "1" * 21}).status_code == 422


def test_concurrent_one_is_409(infer):
    with ThreadPoolExecutor(2) as ex:
        a = ex.submit(infer, "10042", "--sleep 1.5")
        time.sleep(0.5)
        b = ex.submit(infer, "113", "--sleep 1.5")
        codes = sorted([a.result().status_code, b.result().status_code])
    assert codes == [200, 409]
    assert b.result().json() == mock("infer_busy.json")


def test_cached_within_60s(infer):
    first = infer().json()
    again = infer("10042", "--exit 1")            # 60초 안: 명령을 다시 돌리지 않는다(돌렸다면 503)
    assert again.status_code == 200 and again.json() == {**first, "cached": True}
    assert infer("113", "--exit 1").status_code == 503   # 다른 카메라는 따로
    infer.clock[0] += timedelta(seconds=61)
    assert infer("10042", "--exit 1").status_code == 503  # 60초 지나면 다시 돈다


def test_exit_75_is_busy(infer):
    r = infer("10042", "--exit 75")
    assert r.status_code == 409 and r.json() == mock("infer_busy.json")
    assert infer().status_code == 200   # 잠금이 풀렸다


@pytest.mark.parametrize("args", ["--exit 1", "--exit 2"])
def test_command_failure_503(infer, args):
    assert infer("10042", args).status_code == 503
    assert infer().status_code == 200   # 실패 뒤에도 잠금이 풀렸다(실패는 캐시하지 않음)


def test_timeout_503(infer, monkeypatch):
    import app
    monkeypatch.setattr(app, "INFER_TIMEOUT", 0.5)
    assert infer("10042", "--sleep 3").status_code == 503


@pytest.mark.parametrize("line, status", [
    ('{"camera_id": "10042", "captured_at": "x", "pm25": 1}', 200),     # 대조: 약속대로면 통과
    ("not json", 503),
    ("{}", 503),                                                       # 필드 없음
    ('{"camera_id": "113", "captured_at": "x", "pm25": 1}', 503),      # 다른 카메라 결과
    ('{"camera_id": "10042", "captured_at": "x", "pm25": "12"}', 503),  # 숫자 아님
    ('{"camera_id": "10042", "captured_at": "x", "pm25": -1}', 503),
    ('[1, 2]', 503),
])
def test_output_checked(infer, client, monkeypatch, line, status):
    import shlex
    py = Path(sys.executable).as_posix()
    monkeypatch.setenv("INFER_CMD", f'"{py}" -c {shlex.quote(f"print({line!r})")}')
    assert client.post("/api/infer", params={"camera_id": "10042"}).status_code == status


def test_no_infer_cmd_503(client, db, monkeypatch):
    monkeypatch.delenv("INFER_CMD", raising=False)
    assert client.post("/api/infer", params={"camera_id": "10042"}).status_code == 503


def test_other_api_responds_during_infer(infer, client):
    done = threading.Event()
    with ThreadPoolExecutor(1) as ex:
        f = ex.submit(lambda: (infer("10042", "--sleep 2"), done.set())[0])
        time.sleep(0.5)
        t = time.monotonic()
        assert client.get("/api/frames/latest").status_code == 404   # 프레임 없음 — 막히지 않고 바로 답함
        assert time.monotonic() - t < 1 and not done.is_set()
        assert f.result().status_code == 200
