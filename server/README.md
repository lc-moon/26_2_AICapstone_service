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

## 배포 (2026-10-27, 팀장)

10/29 시연용으로 **CCTV 수집 VM**(`cctv-collector`, GCP e2-micro 1GB, Ubuntu 24.04)에 같이 올렸습니다. 주소 **https://incheon-air.duckdns.org**

| 구성 | 위치 | 비고 |
|---|---|---|
| 저장소 | `/srv/incheon-air` (`main`) | `.env`는 서버에만(권한 600). DB 비밀번호·수신 토큰은 서버에서 만들어 넣음 |
| PostgreSQL 16 | DB `pm_map`, 사용자 `pm_map` | localhost만. 메모리 작게(`/etc/postgresql/16/main/conf.d/small.conf`) |
| API | `incheon-air-api.service` → `127.0.0.1:8001` | uvicorn 1개, `MemoryMax=200M`, 재부팅 시 자동 시작 |
| Caddy | `/etc/caddy/Caddyfile` | HTTPS 자동. `/api/*`는 API로, `/web/`과 `/shared/boundary.geojson`만 파일로, 나머지는 `/web/`으로 돌림 |
| 추정기 → API | 수집기 저장소 `.env`의 `SERVICE_API_URL=http://127.0.0.1:8001` | 같은 서버라 인터넷을 거치지 않음 |
| 방화벽 | GCP `allow-web`(tcp 80·443, 태그 `web`) | DB·API 포트는 밖에서 안 열림 |

**`main`이 바뀌면 (팀장이 반영)**

```bash
cd /srv/incheon-air && git pull
/srv/incheon-air/.venv/bin/pip install -q -r server/requirements.txt   # requirements가 바뀌었을 때만
cd server && /srv/incheon-air/.venv/bin/python init_db.py              # shared/가 바뀌었을 때만
sudo systemctl restart incheon-air-api                                 # server/가 바뀌었을 때. web/만 바뀌면 재시작 필요 없음
```

- 확인: `curl -s localhost:8001/api/health`, `systemctl status incheon-air-api caddy`
- 수집기와 메모리를 나눠 써서 서버에 무거운 라이브러리를 넣지 않습니다. 수집기가 우선입니다(메모리가 모자라면 API가 먼저 정리됨)

