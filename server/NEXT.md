# A 백엔드 — 이어서 할 일 (2026-11-08 기준)

사람이 읽어도 되고, AI 코딩 도구에 **이 파일과 [AGENTS.md](../AGENTS.md)를 같이 읽히고** "NEXT.md의 1번부터 해 줘"라고 시키면 됩니다.

**이번에는 한 브랜치에서 항목마다 커밋 하나, PR은 하나로** 올려 주세요(#17처럼). 앞 PR 위에 쌓는 PR은 squash 머지 때 브랜치가 지워지면서 닫혀 버립니다(#15·#16).
일정은 따로 없습니다. 위에서부터.

## 지금 상태

| 된 것 | 누가 |
|---|---|
| S1 `/api/point`의 `station` | 승진 (#8) |
| S2 밤·빈 회차 측정소 지도, S3 근거 사진 `camera`, S5 `POST /api/infer`, S10 `?source=cctv` | 승진 (#17) |
| F10 밤 직접 해보기(사진 없이 사유만 오는 응답 받기), F11 최신 지도 = 자료 시각이 가장 늦은 것(같으면 CCTV), F12 유효 CCTV 10대(`MIN_CCTV`) 미만이면 측정소 지도 | 팀장 (11/8 PR) |

## 동시에 일하기 위한 약속 (중요)

- **`server/`만 고칩니다.** 같은 시간에 금혁 님이 `web/`을 고치고 있습니다
- 새 응답 모양은 팀장이 **`shared/mock/next/`**에 먼저 만들어 두었습니다. 화면은 이 예시로 동시에 만들고 있으니 **필드 이름·값을 바꾸지 마세요.** 바꿔야 하면 팀장에게 먼저
- `shared/`(mock 포함)는 고치지 않습니다. 테스트는 `shared/mock/next/`의 파일과 비교하세요. 두 사람 PR이 다 머지되면 팀장이 `next/`를 `mock/`에 합칩니다
- 서버는 CCTV 수집기와 같이 쓰는 메모리 1GB 서버라 **무거운 라이브러리는 넣지 않습니다**(지금 `requirements.txt`의 `httpx`로 충분)

## 할 일 (위에서부터)

### 1. `/api/frames/latest`에 지도 상태 `reason`·`cctv` 더하기 (F13)

- 왜: 화면이 "비 때문에 측정소로 보여 줌", "밤이라서", "CCTV 19대 중 17대로 추정"을 한 줄로 띄웁니다. 지금은 측정소 지도면 이유를 구분할 수 없습니다
- 약속: `shared/mock/next/frames_latest.json`(정상) · `frames_latest_night.json` · `frames_latest_rain.json` · `frames_latest_few.json`. 기존 필드는 그대로, 두 필드만 더합니다
  - `reason`: `"normal"` | `"night"` | `"rain"` | `"humidity"` | `"few_cameras"` | `"no_data"`
  - `cctv`: `{"valid": 그 회차 카메라 중 값이 있는 수, "total": 전체 카메라 수}` — #21부터 지도 계산과 같이 103번(강화)도 세어 20대 기준이다. 밤이면 `null`
  - `camera_ids`: 그 회차에 값이 있는 카메라 id 목록(11/9 추가, 첫 화면 카메라 점 흐림용). 밤이면 `[]`
- 정하는 법(조회할 때 계산, `frames` 표에 칸을 더하지 않음 — 회차당 estimates가 20행이라 가볍다)
  - CCTV 지도 → `normal`
  - 측정소 지도 + `is_day(slot)`가 false → `night`, `cctv: null`
  - 측정소 지도 + 낮 → 그 회차(`slot`)의 화면 범위 카메라 estimates를 본다
    - 값 있는 카메라가 1대 이상(= `MIN_CCTV` 미만이라 측정소로 간 것) → `few_cameras`
    - 0대면 `status`로 가장 많은 이유: `비`로 시작 → `rain`, `습도 95% 이상` → `humidity`, 그 밖(`습도 결측`, `사진 읽기 실패`) 또는 행이 없음 → `no_data`. 같은 수면 `rain` > `humidity` > `no_data`
- `?source=cctv`도 같은 필드를 줍니다(항상 `normal`)
- 완료 기준(테스트): ① 정상 19/19 → `normal` ② 밤 → `night`·`null` ③ 전부 비 → `rain`·`{valid:0,total:19}` ④ 전부 습도 95% 이상 → `humidity` ⑤ 유효 9대 → `few_cameras`·`{valid:9,...}` ⑥ 전부 습도 결측 → `no_data` ⑦ 응답 키가 `next/` 예시와 같음

### 2. 근거 패널을 지도와 같은 재료로 + 건너뛴 이유 (F14)

- 왜: 지도 값은 그 회차에 **값이 있는 카메라(측정소) 전부**로 계산하니 먹통인 곳은 저절로 빠지는데, 패널은 값이 없어도 가장 가까운 곳을 보여 줍니다(옛 사진, 빈 값). 패널도 지도와 같은 재료를 쓰고, 가장 가까운 곳을 건너뛰었으면 **왜 건너뛰었는지**를 함께 줍니다. 문구는 화면이 만듭니다(백엔드는 코드만)
- 약속: `shared/mock/next/point_inside.json`(건너뛴 것 없음) · `point_fallback.json`(둘 다 건너뜀). `camera`·`station`에 세 필드를 더합니다
  - `lon`, `lat`: 그 카메라·측정소 위치(화면이 지도에 위치 핀을 그림, F8)
  - `nearest`: 가장 가까운 곳을 그대로 썼으면 `null`. 건너뛰었으면 그 곳 `{이름, distance_km, reason, lon, lat}`(카메라는 `camera_id`·`since`도)
- **카메라** (`nearest_camera`)
  - 지금 고른 지도(`/api/point`가 쓰는 그 지도 — F11 규칙, `?source=cctv`면 그 CCTV 지도)가 **CCTV 지도면**: 그 지도의 `frames.inputs`(값을 낸 카메라) 중 화면 범위에서 가장 가까운 카메라. 사진·값은 그 카메라의 **그 회차** estimates 행
  - 가장 가까운 화면 범위 카메라가 `inputs`에 없으면 `nearest`에 그 카메라. `reason`은 그 카메라의 그 회차 행으로
    - 행 없음 → `"no_feed"` (같은 회차에 다른 카메라 사진은 왔으니 영상 제공 쪽 문제로 본다. 드문 수집 지연·저장 실패도 전시 전에는 여기에 묶는다 — 팀장 결정)
    - `status`가 `비`로 시작 → `"rain"`, `습도 95% 이상` → `"humidity"`, `습도 결측` → `"weather_missing"`, `사진 읽기 실패` → `"photo_error"`
    - `since`: 그 카메라가 마지막으로 값을 낸 회차 + 20분(그날 값이 없으면 `null`). 화면이 "13:20부터"라고 씁니다
  - **측정소 지도면**(밤·비 등): 지금처럼 가장 가까운 카메라의 가장 최근 행, `nearest: null`
- **측정소** (`nearest_station`)
  - 기준 시각 = 비교용(`use_for_compare`) 측정소 중 PM2.5 값이 하나라도 있는 가장 최근 `data_time`
  - 그 시각에 값이 있는 비교용 측정소 중 가장 가까운 곳. **다른 시각 값으로 메우지 않습니다**(장소만 바꾸고 거리를 보임)
  - 가장 가까운 비교용 측정소가 그 시각 값이 없으면 `nearest`에 그 곳. `reason` = 그 행의 `pm25_flag` 그대로(에어코리아 사유 문구, 예: `"통신장애"`), 행이 없거나 사유가 비었으면 `null`
- 완료 기준(테스트): ① 다 정상 → 둘 다 `nearest: null`, 가장 가까운 곳 ② 가장 가까운 카메라 행 없음 → 다음 카메라 + `no_feed` + `since` ③ 가장 가까운 카메라가 비 → `rain` ④ 측정소 지도(밤)면 카메라는 지금처럼 ⑤ 가장 가까운 측정소 빈 값 + `통신장애` → 다음 측정소 + 사유 ⑥ 다른 시각 값으로 메우지 않음 ⑦ 응답 키가 `next/` 예시와 같음

### 3. 장소 검색 `GET /api/search?q=` (F2 백엔드)

- 왜: 지금 검색(Nominatim)은 지번 주소("용현동 88-16")를 못 찾고 동으로 떨어집니다. 카카오 로컬 검색으로 바꿉니다. **키는 화면 코드에 넣으면 누구나 볼 수 있어서** 백엔드가 키를 들고 대신 묻습니다(화면은 금혁 님이 이 주소로 바꿈)
- 약속: `shared/mock/next/search_ok.json` · `search_address_ok.json` · `search_empty.json` · `search_outside_area.json` · `search_outside_incheon.json`
  - 응답: `{"query", "status", "results": [{"name", "address", "lon", "lat", "inside"}]}`, 결과는 최대 5개
  - `status`: `"ok"` | `"empty"` | `"outside_incheon"` | `"outside_area"`
- 키: `.env`의 `KAKAO_REST_KEY`(팀장이 서버에 넣음, 루트 `.env.example`에 이름만 추가). **없으면 503.** 요청 헤더 `Authorization: KakaoAK {키}`
- 묻는 곳(카카오 로컬 API 두 가지)
  - 주소 검색 `https://dapi.kakao.com/v2/local/search/address.json?query=` — 지번·도로명. 결과가 있으면 이걸 씀(`name` = `address_name`)
  - 없으면 키워드 검색 `https://dapi.kakao.com/v2/local/search/keyword.json?query=&size=5` — 장소 이름(`name` = `place_name`)
  - 공통: `address` = 도로명 주소가 있으면 그것, 없으면 지번 주소 / `lon` = `x`, `lat` = `y`(문자열 → 숫자) / `inside` = 기존 `inside_area(lon, lat)`
- 상태 정하기: 결과 0개 → `empty` / 주소가 `인천`으로 시작하는 결과가 없음 → `outside_incheon`(`results: []`) / 인천 결과는 있는데 모두 `inside: false`(강화·영종·섬) → `outside_area`(인천 결과를 줌) / 그 밖 → `ok`(`inside: true`인 것만)
- 규칙
  - **검색 결과를 저장(캐시)하지 않습니다**(카카오 이용 조건). 로그에 검색어를 남기지 않습니다
  - `q`는 1~100자(공백만이면 안 됨), 아니면 422. 카카오 응답 5초 초과·오류는 503
  - 테스트는 **진짜 키 없이** 가짜 응답으로(에어코리아 테스트처럼 `httpx`를 바꿔 끼움). 직접 불러 보고 싶으면 본인 카카오 계정으로 키를 따로 받으세요(팀장 키는 서버에만)
- 완료 기준(테스트): ① 장소 이름 → `ok` ② 지번 주소 → 주소 검색 결과 `ok` ③ 결과 없음 → `empty` ④ 서울 → `outside_incheon` ⑤ 강화 → `outside_area` ⑥ 키 없음 503 ⑦ 카카오 시간 초과 503 ⑧ `q` 빈칸·101자 422 ⑨ 응답 키가 `next/` 예시와 같음

## 개발할 때

```bash
cd server
pytest                                   # DB 없이 도는 것만
TEST_DATABASE_URL=postgresql://postgres:비밀번호@localhost:5432/pm_map_test pytest   # DB까지 (DB 이름은 _test로 끝나야 함)
```

- 응답 시각은 항상 `+09:00`(`app.py`의 `iso()`), 값이 없으면 `null`
- 머지·배포는 팀장이 합니다. 3번은 서버에 `KAKAO_REST_KEY`가 들어간 뒤에 반영합니다
