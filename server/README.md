# server — A 백엔드·DB

할 일·API·계산 규칙은 [AGENTS.md](../AGENTS.md). Python 3.11+ · FastAPI · PostgreSQL · psycopg 3.

## 처음 한 번

```bash
cd server
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

**환경변수** — 저장소 루트의 `.env.example`을 `.env`로 복사해 채웁니다(`.env`는 커밋 안 됨). 셸 환경변수로 줘도 됩니다.

| 이름 | 내용 |
|---|---|
| `DATABASE_URL` | 예: `postgresql://postgres:비밀번호@localhost:5432/pm_map` |
| `INGEST_TOKEN` | 추정기가 `Authorization: Bearer …`로 보낼 토큰. 비어 있으면 수신을 전부 거절 |
| `AIRKOREA_API_KEY` | (다음 PR) 에어코리아 수집용 |

**PostgreSQL 준비** — DB만 만들면 테이블은 다음 단계가 만듭니다.

```bash
createdb -U postgres pm_map     # Windows: "C:\Program Files\PostgreSQL\15\bin\createdb.exe"
```

**DB 초기화** — 테이블이 없으면 `shared/schema.sql`을 실행하고, 격자 456칸·카메라 20대·측정소 53곳을 넣습니다.
여러 번 실행해도 안전합니다(공통 자료는 덮어쓰고, 추정값·프레임 같은 시계열은 건드리지 않음). `shared/`가 바뀌면 다시 실행하세요.

```bash
python init_db.py
```

## 실행

```bash
uvicorn app:app --reload --port 8000     # server/ 에서
```

`http://localhost:8000/docs`에서 API를 눌러 볼 수 있습니다. 시험으로 값 넣기:

```bash
curl -X POST http://localhost:8000/api/ingest/estimates -H "Authorization: Bearer <INGEST_TOKEN>" \
     -H "Content-Type: application/json" --data-binary @../shared/mock/ingest_estimates.json
```

## 테스트

```bash
pytest                                      # DB 없이 도는 것만 (보간 식, 인증, 요청 검증). DB 테스트는 skip
createdb -U postgres pm_map_test
TEST_DATABASE_URL=postgresql://postgres:비밀번호@localhost:5432/pm_map_test pytest   # 실제 DB까지
```

- PowerShell: `$env:TEST_DATABASE_URL="postgresql://..."; pytest`
- DB 테스트는 **테이블을 모두 지우고 새로 만듭니다.** 그래서 DB 이름이 `_test`로 끝나야만 돕니다
- `shared/mock/ingest_estimates.json` → `frames_latest.json`, `ingest_2026-10-16.json`(일부러 쪼개고 거꾸로 보냄) → `frames_2026-10-16.json` 33회차가 소수 첫째 자리까지 같은지 확인합니다

## 구현된 API

| 주소 | 내용 |
|---|---|
| `POST /api/ingest/estimates` | 토큰이 틀리면 401, 형식이 틀리면 422(시각은 `+09:00` 같은 시간대 필수, `slot`은 :00/:20/:40). 같은 (camera_id, slot)은 덮어쓰고, 들어온 회차의 프레임을 그 회차 값 전부로 다시 계산 |
| `GET /api/grid` | `shared/mock/grid.json`과 같은 모양. `boundary`는 `shared/boundary.geojson`의 `area` |
| `GET /api/frames/latest` | 가장 최근 회차. 프레임이 하나도 없으면 404 |
| `GET /api/point?lon=&lat=` | 범위 밖(`boundary.geojson`의 `area` 밖)이면 `{"inside": false}`. 안이면 그 칸의 최신 프레임 값·등급·회차·가장 가까운 CCTV 거리. 프레임이 없으면 `estimate: null`. **`station`은 아직 `null`**(에어코리아 수집 뒤 채움) |
| `GET /api/health` | `last_slot`, `last_received_at`, `stale`. stale = 낮에 40분 넘게 추정값이 안 옴(밤과 해 뜬 직후 40분은 false). 낮·밤은 `sun.py`(수집기와 같은 식) |

수신 응답 예: `{"rows_in":19, "rows_upserted":19, "unknown_cameras":[], "new_models":[], "frames":[{"slot":"2026-10-16T13:20:00+09:00","n_inputs":19}]}`

- `cameras`에 없는 카메라 행은 저장하지 않고 `unknown_cameras`와 `ingest_log.error`에 남깁니다
- 처음 보는 `model`은 `model_versions`에 자동 등록합니다(값을 버리지 않으려고). 응답 `new_models`로 알 수 있음
- 한 회차의 값이 전부 `null`이면 그 회차 CCTV 프레임을 만들지 않습니다(`n_inputs: 0`). 측정소로 메우는 것은 다음 PR

아직: CORS, 에어코리아 수집, `/api/point`의 `station`, 밤·빈 회차 → **이어서 할 일은 [NEXT.md](NEXT.md)**
