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
| `AIRKOREA_API_KEY` | 에어코리아 일반 인증키(Encoding·Decoding 둘 다 됨). 비어 있으면 매시 수집을 켜지 않음(나머지 API는 정상) |

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
- 에어코리아 테스트(`tests/test_airkorea.py`)는 가짜 응답(`httpx.MockTransport`)만 씁니다. 테스트 중에 실제 API는 부르지 않습니다

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

## 에어코리아 실측 수집 (`airkorea.py`)

"시도별 실시간 측정정보"(`getCtprvnRltmMesureDnsty`)를 **매시 50분**에 **인천·경기 1번씩**(하루 48건, 한도 500건) 불러
`observations`에 넣습니다. 서버(`uvicorn`)가 켜져 있는 동안 저절로 돌고, 서버를 끄면 같이 멈춥니다.

- `shared/stations.json`(= `stations` 표)에 있는 측정소만 저장. 응답에 없는 측정소는 만들지 않고 개수만 로그에 남김
- 시각은 응답의 `dataTime`(한국 시간). `24:00`은 다음 날 00:00. 형식이 틀린 행은 버림
- `pm25`·`pm10`이 빈칸·`-`·숫자 아님이면 `null`(0으로 메우지 않음). `pm25Flag`(점검및교정·통신장애 등)는 `pm25_flag`에
- 같은 (측정소, 시각)은 덮어씀(값이 나중에 고쳐짐). `fetched_at` = 마지막으로 받은 시각, `updated_at` = 값이 마지막으로 바뀐 시각
- API 실패(키 오류·HTTP 오류·시간 초과·JSON 아님)는 **결측과 구분**합니다. 실패한 시도는 아무것도 저장하지 않고 오류로 남깁니다. 한 시도만 실패하면 다른 시도는 저장
- DB 저장이 실패하면 그 회 전체를 되돌리고 오류로 남깁니다. 서버는 멈추지 않고 다음 정각 50분에 다시 시도
- 워커를 여러 개 띄워도(`--workers 2`) DB 잠금(`pg_try_advisory_lock`)으로 한 곳만 수집합니다. 다른 워커는 그 회를 건너뜀

**키 발급 후 설정** — [공공데이터포털](https://www.data.go.kr/data/15073861/openapi.do)에서 "한국환경공단_에어코리아_대기오염정보"를 활용신청하고,
마이페이지의 **일반 인증키**(Encoding·Decoding 어느 쪽이든)를 **`.env`**의 `AIRKOREA_API_KEY=`에 넣습니다.
`.env.example`에 넣으면 git에 올라가니 넣지 마세요. 발급 직후 한동안은 `SERVICE_KEY_IS_NOT_REGISTERED_ERROR`가 날 수 있습니다(몇 시간 기다리기).

**손으로 한 번 돌려 보기** (정각 50분을 기다리지 않고):

```bash
python airkorea.py      # 결과 요약 출력. 실제 API를 1회(인천·경기 = 2건) 부름
```

**결과·오류 확인**

- 서버 로그: `에어코리아: 받은 N건, 저장 N건, PM2.5 결측 N, 응답에 없는 측정소 N곳, 오류 …`
- DB: `SELECT * FROM ingest_log WHERE source = 'airkorea' ORDER BY id DESC LIMIT 5;` — `rows_in` 받은 행, `rows_upserted` 저장한 행, `error` API·DB 오류(정상이면 비어 있음)
- 키나 DB 비밀번호는 로그에 남기지 않습니다

**키가 없거나 안 될 때 볼 것**

- 서버 시작 로그에 `AIRKOREA_API_KEY가 없어 에어코리아 매시 수집을 켜지 않습니다`가 보이면 `.env`의 위치(저장소 루트)와 이름 확인
- `ingest_log.error`에 `SERVICE_KEY_IS_NOT_REGISTERED`나 `HTTP 403`이 있으면 키 승인 대기 중이거나 키를 잘못 복사한 것
- `결과 코드 22` = 하루 호출 한도 초과

**실제 API 확인 (2026-10-27)**: 실제 키로 인천(43건)·경기(126건) 모두 `resultCode 00`. 응답 필드(`stationName`, `dataTime`,
`pm25Value`, `pm10Value`, `pm25Flag`)는 코드와 일치. 53곳 중 52곳 저장(운서는 응답에 시각·값이 비어 있어 건너뜀), 두 번 돌려도 중복 없음.
공식 기술문서(zip)와의 대조는 아직입니다. 정상이면 `python airkorea.py`의 `upserted`가 50건 안팎입니다.

## 로컬 개발용 CORS

화면을 `http://localhost:8766/web/?api=http://localhost:8000`처럼 다른 포트에서 띄워 API를 부를 수 있게,
`http://localhost:포트`와 `http://127.0.0.1:포트`에서 오는 `GET`만 허용합니다(`*`는 쓰지 않음). 배포 서버는 화면과 API가 같은 주소라 상관없습니다.

아직: `/api/point`의 `station`, 밤·빈 회차 → **이어서 할 일은 [NEXT.md](NEXT.md)**

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

