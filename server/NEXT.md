# A 백엔드 — 이어서 할 일 (2026-10-27 기준)

사람이 읽어도 되고, AI 코딩 도구에 **이 파일과 [AGENTS.md](../AGENTS.md)를 같이 읽히고** "NEXT.md의 1번부터 해 줘"라고 시키면 됩니다.
한 번에 한 항목씩, 항목마다 PR 하나가 좋습니다(브랜치·PR 방법은 [CONTRIBUTING.md](../CONTRIBUTING.md)).

## 지금 상태

| 된 것 | 파일 | 누가 |
|---|---|---|
| DB 초기화(격자 456칸·카메라 20·측정소 53) | `init_db.py` | 승진 (PR #2) |
| `POST /api/ingest/estimates`, 회차 격자 계산 | `app.py`, `idw.py` | 승진 (PR #2) |
| `GET /api/grid`, `GET /api/frames/latest` | `app.py` | 승진 (PR #2) |
| `GET /api/point`(추정값까지, `station`은 `null`), `GET /api/health` | `app.py`, `sun.py` | 팀장 (10/27, 시험기간이라 대신) |
| 테스트 43개 | `tests/` | |

- **배포는 팀장이 수집 VM에 올립니다**(`https://incheon-air.duckdns.org`, 10/29 교수님 시연용). `main`에 머지되면 팀장이 서버에서 받아 재시작합니다.
  그 서버는 CCTV 수집기와 같이 쓰는 메모리 1GB 서버라, **무거운 라이브러리(pandas, numpy, ORM 등)는 넣지 말아 주세요.** 지금 의존성(`requirements.txt`)이면 충분합니다
- 화면(`web/`)은 완성돼 있어서, 아래 API가 생기면 화면 쪽은 손대지 않아도 자동으로 보입니다

## 할 일 (위에서부터)

### 1. 로컬 개발용 CORS
- 왜: 금혁 님이 로컬에서 화면(`http://localhost:8766/web/?api=http://localhost:8000`)을 띄워 이 API를 부르면 브라우저가 막습니다. 배포 서버는 같은 주소라 필요 없습니다
- 어떻게: FastAPI `CORSMiddleware`, `allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?"`, `allow_methods=["GET"]`. **`*`(모두 허용)는 쓰지 않습니다**
- 완료 기준: `Origin: http://localhost:8766`으로 `GET /api/frames/latest`를 부르면 응답에 `access-control-allow-origin`이 붙고, 다른 Origin에는 안 붙는 테스트

### 2. 에어코리아 매시 수집 → `observations`
- 규칙은 [AGENTS.md](../AGENTS.md) "계산 규칙"에 다 있습니다. 요약:
  - "시도별 실시간 측정정보"(`getCtprvnRltmMesureDnsty`)를 **매시 50분에 인천·경기 1번씩**(하루 48건, 한도 500)
  - `dataTime`의 `24:00`은 다음 날 `00:00`으로 바꿔야 함(그대로 날짜 변환하면 오류). 13:00 값 = 12~13시 평균
  - 빈칸·`-`는 `null`. `stations` 표에 있는 측정소만 저장. 같은 (측정소, 시각)은 덮어씀(값이 나중에 고쳐짐)
  - 받은 결과를 `ingest_log`에 `source='airkorea'`로 한 줄씩
  - 키는 `.env`의 `AIRKOREA_API_KEY`(이름은 `.env.example`에 이미 있음)
- 구조 제안: `airkorea.py`에 "받기 → 정리 → 저장" 함수와 `python airkorea.py`로 한 번 돌리는 입구. 매시 실행은 배포 서버에서 systemd timer로 팀장이 붙입니다(필요한 실행 명령만 README에)
- 완료 기준
  - 실제 응답 하나를 `tests/`에 예시 파일로 저장해 두고, 그걸로 `24:00`·`-`·목록에 없는 측정소·덮어쓰기를 확인하는 테스트(네트워크 없이 돎)
  - 응답 필드 이름은 **실제 응답으로 확인**하고 쓰기(문서와 다를 수 있음)

### 3. `/api/point`의 `station` 채우기
- 클릭한 점에서 가장 가까운 `use_for_compare = true` 측정소의 **가장 최근** 실측값
- 모양은 `shared/mock/point_inside.json`의 `station`: `name`, `distance_km`(소수 첫째 자리, 거리는 `idw.py`의 `KX`·`KY`로), `pm25`, `data_time`(+09:00), `period`(예: `"12~13시 평균"`)
- 그 측정소 값이 비어 있으면(`null`) `pm25: null`로. 다른 측정소나 다른 시각으로 메우지 않습니다
- 지금 코드: `app.py`의 `point()` 맨 끝 `"station": None` 자리
- 완료 기준: 측정값을 몇 개 넣고 `/api/point`가 가까운 측정소·최근 시각을 고르는 테스트

### 4. 밤·빈 회차를 측정소 값으로
- 지금: 회차 값이 전부 `null`이면 그 회차 프레임을 안 만듭니다. 밤에는 추정기가 쉬어서 마지막 낮 값이 남아 있습니다(화면에 "n시간 전"으로 보임)
- 할 것(AGENTS.md "계산 규칙"):
  - 밤(`sun.py`의 `is_day()`가 false)에는 매시 실측을 받은 뒤 **정시 슬롯**으로 측정소 프레임을 만듦: `source='station'`, `basis_time`=그 실측의 `data_time`
  - 낮인데 회차 값이 전부 null이면 그 회차를 측정소 값으로(`basis_time` 채움)
  - 보간은 CCTV와 같은 IDW, 입력은 그 시각에 값이 있는 측정소들
- 화면은 이미 `source: station`을 "밤·결측 대체 · 측정소 실측 기반"으로 그립니다. 정확히 "밤"이라고 쓰고 싶으면 응답에 밤 여부를 더하는 것을 금혁 님·팀장과 정하고 AGENTS.md부터 고칩니다
- 완료 기준: `shared/mock/frames_latest_night.json`과 같은 모양의 프레임이 생기고 `/api/frames/latest`에 나오는 테스트

### (여유) `GET /api/frames?from=&to=`, `daily_metrics`

## 개발할 때

```bash
cd server
pytest                                   # DB 없이 도는 것만
TEST_DATABASE_URL=postgresql://postgres:비밀번호@localhost:5432/pm_map_test pytest   # DB까지 (DB 이름은 _test로 끝나야 함)
```

- 격자가 456칸으로 바뀌었으니 로컬 DB는 `python init_db.py`를 한 번 다시 돌립니다
- 응답 시각은 항상 `+09:00`(`app.py`의 `iso()`), 값이 없으면 `null`
- `shared/`는 고치지 않습니다. 필요한 게 있으면 팀장에게
