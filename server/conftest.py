import json
import os

import pytest
from fastapi.testclient import TestClient

from init_db import SHARED

TOKEN = "test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


def mock(name):
    return json.loads((SHARED / "mock" / name).read_text(encoding="utf-8"))


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("INGEST_TOKEN", TOKEN)
    from app import app
    return TestClient(app)


@pytest.fixture
def db(client, monkeypatch):
    """TEST_DATABASE_URL(이름이 _test로 끝나는 DB)이 있을 때만. 매번 테이블을 지우고 새로 만든다."""
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL 없음 — 실제 DB 테스트 건너뜀")
    if not url.rsplit("?", 1)[0].endswith("_test"):
        pytest.exit("TEST_DATABASE_URL의 DB 이름은 _test로 끝나야 합니다 (테이블을 모두 지움)")
    monkeypatch.setenv("DATABASE_URL", url)
    from init_db import connect, init
    with connect() as conn:
        conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public")
        init(conn)
        yield conn
