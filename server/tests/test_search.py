"""GET /api/search (NEXT.md F2). 진짜 카카오는 부르지 않는다(httpx.MockTransport). DB 필요 없음."""
import logging

import httpx
import pytest

from conftest import mock

INHA = {"place_name": "인하대학교", "road_address_name": "", "address_name": "인천 미추홀구 용현동 253",
        "x": "126.6537", "y": "37.4502"}
GATE = {"place_name": "인하대학교 용현캠퍼스 정문", "road_address_name": "", "address_name": "인천 미추홀구 용현동 253",
        "x": "126.6546", "y": "37.4489"}
GANGHWA = {"place_name": "강화군청", "road_address_name": "", "address_name": "인천 강화군 강화읍 관청리 360",
           "x": "126.4878", "y": "37.7466"}
SEOUL = {"place_name": "서울역", "road_address_name": "서울 용산구 한강대로 405", "address_name": "서울 용산구 동자동 43-205",
         "x": "126.9706", "y": "37.5547"}


def respond(monkeypatch, handler):
    import app
    monkeypatch.setattr(app, "kakao_client", lambda: httpx.Client(transport=httpx.MockTransport(handler)))


@pytest.fixture
def kakao(client, monkeypatch):
    monkeypatch.setenv("KAKAO_REST_KEY", "test-key")
    seen = []

    def call(q, address=(), keyword=()):
        def handler(request):
            seen.append(request)
            return httpx.Response(200, json={"documents": list(address if request.url.path.endswith("address.json") else keyword)})
        respond(monkeypatch, handler)
        return client.get("/api/search", params={"q": q})
    call.seen = seen
    return call


def test_place_name_ok(kakao):
    r = kakao("인하대학교", keyword=[INHA, GATE])
    assert r.status_code == 200 and r.json() == mock("next/search_ok.json")
    addr, key = kakao.seen                                   # 주소 검색 먼저, 없어서 키워드 검색
    assert addr.url.path == "/v2/local/search/address.json" and addr.url.params["query"] == "인하대학교"
    assert key.url.path == "/v2/local/search/keyword.json" and key.url.params["size"] == "15"
    assert len(key.url.params["rect"].split(",")) == 4       # 서비스 범위 안부터
    assert addr.headers["authorization"] == "KakaoAK test-key"


def keyword_by_area(client, monkeypatch, in_area, nationwide):
    """서비스 범위 검색(rect 있음)과 전국 검색에 다른 결과를 준다"""
    monkeypatch.setenv("KAKAO_REST_KEY", "test-key")
    seen = []

    def handler(request):
        seen.append(request)
        if request.url.path.endswith("address.json"):
            return httpx.Response(200, json={"documents": []})
        return httpx.Response(200, json={"documents": list(in_area if "rect" in request.url.params else nationwide)})
    respond(monkeypatch, handler)
    return seen


def test_common_name_found_in_area_first(client, monkeypatch):
    # 전국 상위 5개가 모두 인천 밖이어도 범위 안 결과를 쓴다
    seen = keyword_by_area(client, monkeypatch, [INHA], [SEOUL] * 5)
    got = client.get("/api/search", params={"q": "홈플러스"}).json()
    assert got["status"] == "ok" and got["results"][0]["name"] == "인하대학교" and len(seen) == 2   # 전국 검색은 안 함


@pytest.mark.parametrize("q, doc, status", [("서울역", SEOUL, "outside_incheon"), ("강화도", GANGHWA, "outside_area")])
def test_nationwide_only_when_area_has_nothing(client, monkeypatch, q, doc, status):
    seen = keyword_by_area(client, monkeypatch, [], [doc])
    assert client.get("/api/search", params={"q": q}).json()["status"] == status
    assert len(seen) == 3 and seen[2].url.params["size"] == "5" and "rect" not in seen[2].url.params


def test_lot_number_uses_address_search(kakao):
    doc = {"address_name": "인천 미추홀구 용현동 88-16", "x": "126.6476", "y": "37.4545", "road_address": None}
    got = kakao("용현동 88-16", address=[doc], keyword=[GANGHWA]).json()
    want = mock("next/search_address_ok.json")
    # 예시의 name은 "용현동 88-16"이지만 규칙은 name = 카카오 address_name
    want["results"][0]["name"] = doc["address_name"]
    assert got == want and len(kakao.seen) == 1              # 주소 검색에 결과가 있으면 키워드 검색 안 함


def test_road_address_preferred(kakao):
    doc = {"address_name": "인천 미추홀구 용현동 253", "x": "126.6537", "y": "37.4502",
           "road_address": {"address_name": "인천 미추홀구 인하로 100"}}
    r = kakao("인하로 100", address=[doc]).json()["results"][0]
    assert (r["name"], r["address"]) == ("인천 미추홀구 용현동 253", "인천 미추홀구 인하로 100")


def test_empty(kakao):
    assert kakao("ㅁㄴㅇㄹ").json() == mock("next/search_empty.json")


def test_outside_incheon(kakao):
    assert kakao("서울역", keyword=[SEOUL]).json() == mock("next/search_outside_incheon.json")


def test_outside_area(kakao):
    assert kakao("강화도", keyword=[GANGHWA]).json() == mock("next/search_outside_area.json")


def test_ok_keeps_only_inside_and_at_most_five(kakao):
    got = kakao("인하", keyword=[GANGHWA, SEOUL, *[INHA] * 7]).json()
    assert got["status"] == "ok" and len(got["results"]) == 5 and all(r["inside"] for r in got["results"])


def test_no_key_503(client, monkeypatch):
    monkeypatch.delenv("KAKAO_REST_KEY", raising=False)
    assert client.get("/api/search", params={"q": "인하대"}).status_code == 503


def boom(request):
    raise httpx.ReadTimeout("timed out", request=request)


@pytest.mark.parametrize("handler", [
    boom,                                                  # 시간 초과
    lambda r: httpx.Response(401, json={"errorType": "x"}),
    lambda r: httpx.Response(200, text="not json"),
    lambda r: httpx.Response(200, json={"meta": {}}),      # documents 없음
    lambda r: httpx.Response(200, json={"documents": [{"address_name": "인천 x", "x": "abc", "y": "37"}]}),
])
def test_kakao_failure_503_without_query_in_log(client, monkeypatch, caplog, handler):
    monkeypatch.setenv("KAKAO_REST_KEY", "test-key")
    respond(monkeypatch, handler)
    with caplog.at_level(logging.INFO):
        assert client.get("/api/search", params={"q": "비밀검색어"}).status_code == 503
    assert "카카오 검색 실패" in caplog.text               # 대조: 로그 자체는 남는다
    assert "비밀검색어" not in caplog.text and "%EB%B9%84" not in caplog.text and "test-key" not in caplog.text


def test_timeout_is_five_seconds():
    import app
    with app.kakao_client() as c:
        assert c.timeout.read == 5


@pytest.mark.parametrize("q, status", [("", 422), ("   ", 422), ("a" * 101, 422), ("a" * 100, 200)])
def test_query_validated(kakao, q, status):
    assert kakao(q).status_code == status


def test_missing_q_422(client):
    assert client.get("/api/search").status_code == 422


def test_access_log_hides_query():
    import app
    record = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d',
                               ("1.2.3.4", "GET", "/api/search?q=%EC%9D%B8%ED%95%98", "1.1", 200), None)
    assert app.HideSearchQuery().filter(record)
    assert record.getMessage() == '1.2.3.4 - "GET /api/search HTTP/1.1" 200'
    other = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d',
                              ("1.2.3.4", "GET", "/api/point?lon=1&lat=2", "1.1", 200), None)
    assert app.HideSearchQuery().filter(other) and "lon=1" in other.getMessage()
