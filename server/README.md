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
| `AIRKOREA_API_KEY` | 에어코리아 일반 인증키(Decoding). 비어 있으면 매시 수집을 켜지 않음(나머지 API는 정상) |

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
마이페이지의 **일반 인증키(Decoding)**를 `.env`의 `AIRKOREA_API_KEY=`에 넣습니다. 발급 직후 한동안은 `SERVICE_KEY_IS_NOT_REGISTERED_ERROR`가 날 수 있습니다(몇 시간 기다리기).

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
- `ingest_log.error`에 `SERVICE_KEY_IS_NOT_REGISTERED`가 있으면 키 승인 대기 중이거나, Encoding 키를 넣은 것(Decoding 키를 넣어야 함)
- `결과 코드 22` = 하루 호출 한도 초과

**실제 API 검증 상태**: 이 PR은 가짜 응답으로만 시험했습니다. 요청 파라미터(`sidoName`, `returnType=json`, `numOfRows=1000`, `ver=1.3`)와
응답 필드(`stationName`, `dataTime`, `pm25Value`, `pm10Value`, `pm25Flag`)는 널리 쓰이는 형식을 따랐고, 공식 기술문서(zip)로는 아직 대조하지 못했습니다.
키를 받으면 `python airkorea.py`로 한 번 돌려 `저장` 건수가 50건 안팎인지 확인해 주세요.

아직: `/api/point`, `/api/health`, 밤·빈 회차(측정소 프레임), 배포
