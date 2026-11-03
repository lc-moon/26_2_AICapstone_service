# A 백엔드 — 이어서 할 일 (2026-11-03 기준)

사람이 읽어도 되고, AI 코딩 도구에 **이 파일과 [AGENTS.md](../AGENTS.md)를 같이 읽히고** "NEXT.md의 1번부터 해 줘"라고 시키면 됩니다.
한 번에 한 항목씩, 항목마다 PR 하나가 좋습니다(브랜치·PR 방법은 [CONTRIBUTING.md](../CONTRIBUTING.md)).

**일정은 따로 없습니다. 위에서부터 최대한 빨리.** 1·2번이 먼저, 5번은 맨 마지막입니다.

## 지금 상태

| 된 것 | 파일 | 누가 |
|---|---|---|
| DB 초기화(격자 456칸·카메라 20·측정소 53) | `init_db.py` | 승진 (PR #2) |
| `POST /api/ingest/estimates`, 회차 격자 계산 | `app.py`, `idw.py` | 승진 (PR #2) |
| `GET /api/grid`, `GET /api/frames/latest` | `app.py` | 승진 (PR #2) |
| `GET /api/point`(추정값까지, `station`은 `null`), `GET /api/health` | `app.py`, `sun.py` | 팀장 (PR #5) |
| 에어코리아 매시 수집 → `observations`, 로컬 개발용 CORS | `airkorea.py`, `app.py` | 승진 (PR #6) |

- **배포는 팀장이 수집 VM에 올립니다**(`https://incheon-air.duckdns.org`). `main`에 머지되면 팀장이 서버에서 받아 재시작합니다.
  그 서버는 CCTV 수집기와 같이 쓰는 메모리 1GB 서버라, **무거운 라이브러리(pandas, numpy, ORM 등)는 넣지 말아 주세요.** 지금 의존성(`requirements.txt`)이면 충분합니다
- 응답 모양은 `shared/mock/`에 있습니다. 화면(B)은 이 예시로 먼저 만들고 있으니 **필드 이름을 바꾸지 마세요.** 바꿔야 하면 팀장에게 먼저

## 할 일 (위에서부터)

### 1. `/api/point`의 `station` 채우기 (S1)
- 클릭한 점에서 가장 가까운 `use_for_compare = true` 측정소의 **가장 최근** 실측값
- 모양은 `shared/mock/point_inside.json`의 `station`: `name`, `distance_km`(소수 첫째 자리, 거리는 `idw.py`의 `KX`·`KY`로), `pm25`, `data_time`(+09:00), `period`(예: `"12~13시 평균"`)
- 그 측정소 값이 비어 있으면(`null`) `pm25: null`로. 다른 측정소나 다른 시각으로 메우지 않습니다
- 지금 코드: `app.py`의 `point()` 맨 끝 `"station": None` 자리
- 완료 기준: 측정값을 몇 개 넣고 `/api/point`가 가까운 측정소·최근 시각을 고르는 테스트

### 2. 밤·빈 회차를 측정소 값으로 (S2) — **밤 화면의 안전장치라 꼭**
- 지금: 회차 값이 전부 `null`이면 그 회차 프레임을 안 만듭니다. 밤에는 추정기가 쉬어서 마지막 낮 값이 남아 있습니다(화면에 "n시간 전"으로 보임)
- 할 것(AGENTS.md "계산 규칙"):
  - 밤(`sun.py`의 `is_day()`가 false)에는 매시 실측을 받은 뒤(`airkorea.py`가 매시 50분에 받음) 측정소 프레임을 만듦: `slot` = `basis_time` = 그 실측의 `data_time`(정시), `source='station'`
  - 낮인데 회차 값이 전부 null이면 그 회차(`slot`은 그 20분 회차)를 그때 가장 최근 실측으로 계산하고 `basis_time`에 그 실측의 `data_time`
  - 보간은 CCTV와 같은 IDW, 입력은 그 시각에 값이 있는 측정소들
  - **주의: `frames`는 회차(`slot`)마다 한 줄뿐입니다.** CCTV 프레임과 측정소 프레임이 같은 `slot`을 두고 부딪칠 수 있습니다
    - CCTV가 이깁니다. 측정소로 대신 만든 낮 회차에 나중에 CCTV 값이 오면(습도 결측 행은 약 1시간 뒤에 옴) CCTV 프레임으로 바뀌어야 합니다. 지금 `rebuild_frame()`은 `ON CONFLICT (slot) DO UPDATE`라 이미 그렇게 됩니다. **이 부분은 바꾸지 마세요**
    - 반대로 **측정소 프레임을 넣는 코드는 이미 있는 CCTV 프레임을 덮어쓰면 안 됩니다**(예: 해 뜰 무렵 07:00은 정시 측정소 슬롯이자 CCTV 회차). `ON CONFLICT (slot) DO UPDATE ... WHERE frames.source = 'station'`처럼 측정소 프레임끼리만 덮어쓰기
    - 낮 빈 회차는 `rebuild_frame()`의 "값이 하나도 없음" 갈래(지금은 CCTV 프레임을 지우고 끝)에서 측정소 프레임을 만들면 됩니다
    - 이 처리는 추정값 수신(`/api/ingest/estimates`)과 같은 트랜잭션 안에서 돕니다. 여기서 오류가 나면 **수신 전체가 실패해 낮 지도가 멈춥니다**
  - 테스트에 꼭 넣을 것: ① 측정소 프레임이 있는 회차에 CCTV 값이 오면 CCTV로 바뀜 ② CCTV 프레임이 있는 회차에 측정소 프레임을 만들려 하면 CCTV가 그대로 ③ 둘 다 오류 없이
- 화면은 이미 `source: station`을 "밤·결측 대체 · 측정소 실측 기반"으로 그립니다. 정확히 "밤"이라고 쓰고 싶으면 응답에 밤 여부를 더하는 것을 금혁 님·팀장과 정하고 AGENTS.md부터 고칩니다
- 완료 기준: `shared/mock/frames_latest_night.json`과 같은 모양의 프레임이 생기고 `/api/frames/latest`에 나오는 테스트

### 3. `/api/point`에 가까운 CCTV `camera` 더하기 (S3)
- 왜: 패널에 "이 값의 근거 사진"을 보여 줍니다. 사진 파일은 팀장(추정기)이 회차마다 `/cam/{camera_id}.jpg`로 덮어써 두고, 백엔드는 **어느 카메라의 어떤 회차인지**만 알려 줍니다
- 모양: `shared/mock/point_inside.json`의 `camera`
  - `camera_id`, `name`: 클릭한 점에서 가장 가까운 카메라(`cameras` 표, **`grid_id`가 있는 카메라만** — 103번 강화는 범위 밖이라 제외). 거리는 `idw.py`의 `KX`·`KY`, 소수 첫째 자리
  - `slot`, `captured_at`, `pm25`(= `pm25_est`), `status`: 그 카메라의 **가장 최근** `estimates` 한 줄. 밤에는 마지막 낮 회차가 그대로 나옴(정상)
  - `photo_url`: `"/cam/{camera_id}.jpg?v={captured_at을 숫자만}"` (예: `/cam/10042.jpg?v=20261016132126`). `?v=`는 브라우저가 옛 사진을 캐시하지 않게(한국 시각 기준)
  - 그 카메라 행이 하나도 없으면 `camera: null`
- 같은 이유로 `estimate.nearest_cctv_km`는 그대로 둡니다(값이 같아도 됨)
- 완료 기준: 추정값 몇 줄을 넣고, 가장 가까운 카메라·가장 최근 행·`photo_url`을 고르는 테스트

### 4. 직접 해보기 `POST /api/infer?camera_id=` (S5)
- 왜: 전시에서 버튼을 누르면 그 카메라의 **지금** 사진으로 추정합니다. 실제 사진 찍기·추정은 팀장이 만드는 명령이 하고, 백엔드는 그 명령을 안전하게 부르는 입구입니다
- 명령 약속 (팀장이 만듦): `.env`의 `INFER_CMD`에 적힌 명령 뒤에 카메라 번호를 붙여 실행 → **표준출력에 JSON 한 줄**, 종료 코드 0
  - `INFER_CMD`는 `shlex.split()`으로 나눈 뒤 카메라 번호를 덧붙여 `subprocess`/`asyncio.create_subprocess_exec`로 실행(셸 안 씀)
  - 예: `INFER_CMD="/home/.../venv/bin/python /home/.../Estimator/infer_now.py"` → `... infer_now.py 10042`
  - 출력 필드: `camera_id`, `requested_at`, `captured_at`, `pm25`(없으면 null), `status`, `photo_url`. 비·습도·밤이면 `pm25: null`이고 `status`에 이유 문장
  - 종료 코드가 0이 아니면 실패(표준에러에 이유)
  - 로컬 개발용으로는 `tests/fake_infer.py`처럼 `shared/mock/infer_ok.json`을 그대로 출력하는 가짜 명령을 만들어 `INFER_CMD`에 넣고 개발
- 백엔드가 지킬 것:
  - `INFER_CMD` 이름을 `server/.env.example`에 더하기(값은 비워 둠)
  - `camera_id`는 `cameras` 표에 있는 것만(아니면 404). **명령에 넘기기 전에 반드시 확인**(공개 주소라 아무 문자열이나 들어올 수 있음). `shell=True` 쓰지 않기
  - **한 번에 하나만**: 진행 중이면 409 `{"detail": "다른 추정이 진행 중입니다. 잠시 뒤 다시 눌러 주세요"}` (`shared/mock/infer_busy.json`)
  - **같은 카메라를 60초 안에 다시 누르면 명령을 다시 돌리지 않고** 지난 결과를 `cached: true`로
  - 제한 시간 30초. 넘거나 실패하면 503
  - 응답 = 명령 출력 + `name`(카메라 이름) + `grade`(등급 규칙 그대로, `pm25`가 null이면 null) + `cached` + `elapsed_s`(소수 첫째 자리). 모양은 `shared/mock/infer_ok.json`·`infer_rain.json`
  - 결과는 DB(`estimates`, `frames`)에 **넣지 않습니다**(시연용)
  - 로컬 개발용 CORS가 지금 `GET`만 허용하면 `POST`를 더합니다
- 완료 기준: 가짜 명령으로 ① 정상 ② 없는 카메라 404 ③ 동시에 두 번 → 하나는 409 ④ 60초 안 재요청은 `cached: true` ⑤ 명령 실패 503 테스트
- 이 항목은 팀장이 VM에서 측정해 보고 너무 느리면 빠질 수 있습니다. 결과는 단톡에 알립니다

### 5. 전시용 `?source=cctv` (S10) — **맨 마지막. 못 해도 됩니다**
- 왜: 전시가 해 진 뒤라도 그날 마지막 낮 CCTV 회차를 보여 주려고. 실서비스 화면은 그대로입니다
- `GET /api/frames/latest?source=cctv`: `source='cctv'`인 프레임 중 가장 최근 것. `GET /api/point?...&source=cctv`도 `estimate`를 그 프레임에서
- `source`가 없으면 지금과 똑같이. `cctv` 말고 다른 값은 422
- 완료 기준: 밤 측정소 프레임이 더 최근이어도 `source=cctv`면 CCTV 프레임이 나오는 테스트

## 개발할 때

```bash
cd server
pytest                                   # DB 없이 도는 것만
TEST_DATABASE_URL=postgresql://postgres:비밀번호@localhost:5432/pm_map_test pytest   # DB까지 (DB 이름은 _test로 끝나야 함)
```

- 격자가 456칸으로 바뀌었으니 로컬 DB는 `python init_db.py`를 한 번 다시 돌립니다
- 응답 시각은 항상 `+09:00`(`app.py`의 `iso()`), 값이 없으면 `null`
- `shared/`는 고치지 않습니다. 필요한 게 있으면 팀장에게
