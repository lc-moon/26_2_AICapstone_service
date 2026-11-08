# 작업 안내 (사람과 LLM 공통)

이 저장소에서 일하는 사람과 AI 도구가 먼저 읽는 파일입니다.

## 진행 방식

- **A(백엔드) = 승진, B(프론트) = 금혁.** 둘은 아래 API 약속만 지키면 서로 기다리지 않습니다
- 할 일을 위에서부터 되는 데까지 하고 **PR**을 올리면 팀장이 확인 후 머지합니다. 방법은 [CONTRIBUTING.md](CONTRIBUTING.md)
- **교내 전시 2026-11-11(수).** 따로 일정을 두지 않고 할 일을 위에서부터 **최대한 빨리** 합니다. 전시 화면은 [11/3에 정한 전시 준비](#전시-준비-113-정함)를 따릅니다
- **A는 `server/`만, B는 `web/`만** 고칩니다. `shared/`는 팀장이 만든 공통 자료라 고치지 않습니다(필요하면 팀장에게 요청). 아직 만들어지지 않은 API의 응답 약속은 `shared/mock/next/`에 있습니다
- API를 바꾸고 싶으면 A·B·팀장이 합의한 뒤 이 파일을 먼저 고칩니다
- 팀장이 PR을 머지하면 단톡에 알립니다. 특히 A의 API가 머지되면 B는 `main`을 pull해서 연결해 볼 수 있습니다

## LLM·코딩 에이전트가 작업할 때 (꼭 지킬 것)

이 저장소에서 코드를 고치는 AI 도구는 아래 순서를 따릅니다. 사람이 git을 잘 몰라도 이대로 하면 됩니다.

1. 시작 전 `git status`와 `git branch --show-current`로 확인. **`main`이면 작업하지 말고** 최신을 받은 뒤 새 브랜치를 만든다
   (`git switch main && git pull && git switch -c server/할일이름` — B는 `web/할일이름`)
2. 맡은 역할의 폴더만 고친다(A `server/`, B `web/`). `shared/`, `AGENTS.md`, `.github/`는 고치지 않는다
3. `.env`와 인증키는 커밋하지 않는다. 키가 필요하면 `.env.example`에 이름만 적는다
4. 할 일 한두 개가 끝나면 커밋하고 `git push -u origin 브랜치이름`
5. PR을 만든다. `gh`가 있으면 `gh pr create`(양식은 `.github/pull_request_template.md`), 없으면 사람에게 GitHub 페이지의 **Compare & pull request** 버튼을 누르라고 안내한다
6. `main`에 직접 push하지 않는다(막혀 있음). 이미 `main`에서 커밋해 버렸다면 [CONTRIBUTING.md](CONTRIBUTING.md)의 "main에서 작업해 버렸다면"을 따른다
7. 실행 방법(설치, `.env`, 실행 명령)이 생기면 `server/README.md` 또는 `web/README.md`에 적는다

## 전체 구조

```
추정기(팀장, 이미 돌고 있음) ──POST /api/ingest/estimates──▶ A 백엔드 ──GET /api/...──▶ B 프론트(브라우저)
에어코리아 측정소 실측 ──매시──▶ A 백엔드
```

수집기와 추정기는 VM에서 20분마다 CCTV 사진을 찍고 카메라별 PM2.5를 추정합니다. 새로 만드는 것은 A와 B입니다.

## 할 일

**지금 할 일은 A는 [server/NEXT.md](server/NEXT.md), B는 [web/NEXT.md](web/NEXT.md)에 순서대로 있습니다(11/8 갱신).** 위에서부터 하나씩, **한 브랜치에서 항목마다 커밋 하나, PR은 하나.** 앞 PR 위에 쌓는 PR은 머지 때 닫히므로 쓰지 않습니다.
AI 도구에는 "AGENTS.md와 NEXT.md를 읽고 1번부터 해 줘"라고 시키면 됩니다.

### 전시 준비 (11/3 정함)

- 전시는 **노트북에 서비스를 띄워 관람객이 직접 만지는 것**입니다. 해가 진 뒤에도 화면이 돌아가야 합니다
- 지도를 누르면 패널에 **추정값 + 가까운 측정소 실측 + 가까운 CCTV 사진(가린 것)**이 나란히 나옵니다. "이 값이 어디서 나왔나"를 보여 주는 것이 목적
- **직접 해보기**: 버튼을 누르면 그 카메라가 지금 찍은 사진으로 추정합니다(33분에 누르면 33분 사진)
- **원리 페이지**: 질문·데이터·방법·결과·한계. 글과 그림은 팀장, 화면은 B
- **검색**: 장소 이름이나 주소로 이동
- 밤에는 실서비스 그대로(측정소 실측 IDW). 여유가 되면 전시용 주소(`?expo=1`)로 그날 마지막 낮 CCTV 회차를 보여 줍니다(맨 마지막 순위)

S1~S10(측정소 실측·밤 지도·근거 패널·직접 해보기·원리 페이지·검색·전시용 주소)은 **11/8에 모두 머지·서버 반영했습니다.** 지금 할 일은 위 `NEXT.md`입니다.

### 지난 할 일 (10/26까지, 끝남)

- A: DB·공통 자료, `POST /api/ingest/estimates`, 격자 계산, `GET /api/grid`·`frames/latest`·`point`·`health`, 로컬 CORS, 에어코리아 매시 수집, 배포
- B: 지도·구름·가림막·범례, 클릭 패널, 밤 표시·오래된 값 경고, 실제 API 연결

## API

공통: JSON, 시각은 `2026-10-16T13:20:00+09:00` 형식, 단위 ㎍/㎥, 값이 없으면 `null`. **전체 예시는 `shared/mock/`** (파일 대응은 `shared/README.md`).

| 주소 | 용도 | 응답 요약 |
|---|---|---|
| `GET /api/grid` | 격자·경계 (처음 한 번) | `cells[]`(grid_id, row, col, center, gu), `boundary`. cells 순서 = values 순서 |
| `GET /api/frames/latest` | 최신 농도 | `slot`, `source`(cctv/station), `basis_time`(측정소 지도일 때 쓴 실측 시각), `values[]`, `updated_at`. **만드는 중(F13)**: `reason`, `cctv` (`shared/mock/next/`) |
| `GET /api/point?lon=&lat=` | 클릭한 곳 | `inside`, `gu`, `estimate`(pm25, grade, slot), `station`(name, distance_km, pm25, period), `camera`(가까운 CCTV: camera_id, name, distance_km, slot, captured_at, pm25, status, photo_url). 범위 밖은 `inside:false`만. **만드는 중(F14)**: `camera`·`station`에 `lon`, `lat`, `nearest`(건너뛴 곳과 이유) (`shared/mock/next/`) |
| `POST /api/infer?camera_id=` | 직접 해보기 | 그 카메라를 **지금** 찍어 추정: `captured_at`, `pm25`, `grade`, `status`, `photo_url`, `cached`, `elapsed_s`. 진행 중이면 409 |
| `?source=cctv` | 전시용 (마지막) | `/api/frames/latest`와 `/api/point`에 붙이면 가장 최근 **CCTV** 회차 기준으로 답함(밤에도 낮 회차) |
| `/cam/{camera_id}.jpg` | 근거 사진 | API가 아니라 파일. 추정기가 회차마다 덮어쓰는 **가린** 사진(640×360). 즉석 추론 사진은 `/cam/live/{camera_id}.jpg` |
| `GET /api/search?q=` | **만드는 중(F2)** 장소 검색 | 백엔드가 카카오 로컬 검색을 중계: `status`(ok/empty/outside_incheon/outside_area), `results[]`(name, address, lon, lat, inside). 예시 `shared/mock/next/search_*.json` |
| `GET /api/health` | 상태 | `last_slot`, `stale` |
| `GET /api/frames?from=&to=` | (전시 뒤) 애니메이션 | `frames[]` |
| `POST /api/ingest/estimates` | 추정기 → 백엔드 | `Authorization: Bearer 토큰`, `rows[]`. 같은 (camera_id, slot)이면 덮어쓰기 |

등급: 좋음 0~15 · 보통 16~35 · 나쁨 36~75 · 매우나쁨 76~ (반올림 후 판정)

## 계산 규칙 (A)

- 격자 1km, 인천 내륙 + 송도 경계와 조금이라도 겹치는 칸 전부 456칸(`shared/grid_cells.geojson`). 경계에는 행정경계에 없는 매립지도 들어 있어, 누를 수 있는 땅은 항상 어느 칸에 듭니다. 응답 시각은 항상 `+09:00` (DB 기본값 UTC에 주의)
- 보간: IDW, 가중치 `1/(d²+0.05)`, d는 km. 그 회차에 값이 있는 카메라 전부(103번 포함 — 화면 범위 밖이지만 입력으로는 씀)
- **같은 회차 값이 나눠서 옵니다.** 추정기가 1분마다 돌아 한 회차 20대가 여러 번(대개 회차 5~6분 뒤에 대부분, 습도가 끝내 안 올라온 "습도 결측" 행은 약 1시간 뒤) 나뉘어 옵니다. 값이 올 때마다 그 회차 프레임을 다시 계산 (`shared/mock/ingest_2026-10-16.json`으로 시험)
- 빠진 카메라(`pm25_est: null`, 비·습도·고장)는 빼고 계산. 유효값이 `MIN_CCTV`(10)대 미만이거나 밤이면 측정소 값으로 같은 방식 보간(`source: station`, `basis_time` 채움)
- 최신 지도 = 자료 시각(측정소 지도는 `basis_time`, CCTV 지도는 `slot`)이 가장 늦은 것. 같으면 CCTV. `/api/frames/latest`와 `/api/point`가 같은 규칙
- 밤 = 인천에서 태양고도 0° 미만. 밤에는 매시 실측을 받은 뒤 측정소 프레임을 만듦
- 다른 시각 값으로 빈칸을 메우지 않음. 에어코리아 13:00 값 = 12~13시 평균
- 에어코리아 매시 수집은 이미 돌고 있음(`airkorea.py`, PR #6) → `observations`. 측정 안 된 값은 `null`
- `stale`: 낮에 2회차(40분) 연속 추정값이 하나도 안 오면 true. 밤은 제외
- 인증키(에어코리아, 수신 토큰, `KAKAO_REST_KEY`)와 `INFER_CMD`는 `.env`에만

## 화면 규칙 (B)

- 시안과 아래 규칙은 방향입니다. 더 나은 표현이 있으면 바꿔도 되고, PR에 이유를 적어 주세요
- MapLibre GL JS + OpenFreeMap Liberty 스타일(무료, 키 없음)
- 첫 화면: 인천 내륙이 꽉 차게, 40° 기울임. **격자는 안 보이게**, 이어 칠하고 흐리게 해서 구름처럼
- 지도·구름·가림막·범례·밤 표시는 이미 만들어져 있습니다(`web/README.md`). 새 기능은 그 위에 더합니다
- 화면에 두는 것: 기준 시각, 범례, 출처(OpenStreetMap·에어코리아·행정경계 통계청 SGIS — 표기 의무). 첫 화면에는 CCTV·측정소 위치 마커를 표시하지 않음(지점을 고른 뒤의 근거 위치 핀은 `web/NEXT.md` F8)
- **CCTV 사진은 `photo_url`(추정기가 가린 것)만 씁니다.** 위쪽 60%(모델이 보는 곳)는 그대로, 아래 40%는 굵은 모자이크. 화면에서는 위쪽 60%에 붉은 테두리와 좌상단 "ROI" 라벨을 겹쳐 그림. 원본 사진은 서버 밖으로 나가지 않고, 브라우저에서 따로 가리지 않습니다
- 검색: 지금은 브라우저에서 Nominatim을 직접 부르고, **백엔드 `GET /api/search`(카카오 로컬, 키는 백엔드에만)로 바꾸는 중**(`web/NEXT.md` 1번). **엔터를 쳤을 때만 검색**, 결과를 브라우저에 저장하지 않음(카카오 이용 조건)
- 클릭: 확대(3D 건물) + 패널(추정, 등급, 측정소 실측, CCTV 사진, 각각의 기준 시각). 패널을 먼저 띄우고 응답으로 채우면 렉이 없음
- 갱신: 1분마다 `/api/frames/latest`를 다시 받고 `slot`이나 `updated_at`이 바뀌면 다시 그림. 한 회차 값이 나뉘어 와서 같은 `slot`도 몇 분 뒤 값이 채워짐
- 지도 상태: 정상·밤·비·습도·카메라 부족을 제목 아래 한 줄로(`web/NEXT.md` F13). `stale`이면 "40분 전 값" 경고
- 로컬 실행 방법은 `web/README.md`

## 배포

- **팀장이 이미 수집 VM에 올려 두었습니다**: https://incheon-air.duckdns.org (구성은 `server/README.md` "배포"). `main`에 머지되면 팀장이 서버에 반영합니다. 조원은 배포를 하지 않습니다
- 같은 주소라 CORS 불필요(로컬 개발 때만 localhost 허용). `/cam/` 사진 파일 내보내기도 팀장이 서버에서 설정합니다
- 서버는 CCTV 수집기와 같이 쓰는 메모리 1GB라 **무거운 라이브러리(pandas, numpy, ORM 등)는 넣지 않습니다**

## 나중에 (전시 뒤)

지난 N일 애니메이션(낮↔밤 전환 표시 필요), 휴대폰용 2D 화면
