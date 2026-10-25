# 작업 안내 (사람과 LLM 공통)

이 저장소에서 일하는 사람과 AI 도구가 먼저 읽는 파일입니다. 사람이 읽기 좋게 정리한 같은 내용이 [Notion 가이드](https://app.notion.com/p/A-B-3fd4a3212e4f81458cd8f40cff41cad5)에 있습니다.

## 진행 방식

- 조원 2명이 **A(백엔드)**와 **B(프론트)** 중 하나씩 맡습니다. 둘은 아래 API 약속만 지키면 서로 기다리지 않습니다
- 할 일을 위에서부터 되는 데까지 하고 **PR**을 올리면 팀장이 확인 후 머지합니다. 방법은 [CONTRIBUTING.md](CONTRIBUTING.md)
- 첫 마감 **2026-10-26** (그때까지 된 만큼 PR, 팀장이 발표자료 제작), 교내 전시 **2026-11-11**
- **A는 `server/`만, B는 `web/`만** 고칩니다. `shared/`는 팀장이 만든 공통 자료라 고치지 않습니다(필요하면 팀장에게 요청)
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

### A 백엔드·DB (`server/`)
- [ ] 로컬 PostgreSQL에 `shared/schema.sql` 실행, 공통 자료(격자·카메라·측정소) 넣기
- [ ] `POST /api/ingest/estimates` — 받아서 저장
- [ ] 격자 계산(아래 계산 규칙) → `frames` 저장. `shared/mock/ingest_estimates.json`을 넣어 `shared/mock/frames_latest.json`과 값이 같으면 정답
- [ ] `GET /api/grid`, `GET /api/frames/latest`
- [ ] 에어코리아 매시 수집 → `observations`
- [ ] `GET /api/point`, `GET /api/health`
- [ ] 빈 회차·밤 처리
- [ ] VM 배포: Caddy + DuckDNS(무료 도메인) + HTTPS, B의 화면 파일도 같은 VM에서
- [ ] (여유) `GET /api/frames` 기간 조회, `daily_metrics`

### B 프론트 (`web/`)
- [ ] `shared/mockup/index.html` 열어 보고 코드 읽기 — 팀장이 만들어 본 참고 시안. 이런 느낌이면 좋지만 더 나은 방향이 있으면 그쪽으로
- [ ] `shared/mock/` 응답으로 첫 화면: 지도 + 구름 + 인천 밖 가림 + 범례 + 기준 시각
- [ ] 클릭 → 확대 + 패널(`/api/point`), 범위 밖 클릭 안내
- [ ] 밤 표시, 오래된 값 경고
- [ ] A의 API에 연결
- [ ] (여유) 지난 N일 애니메이션, 장소 검색

## API

공통: JSON, 시각은 `2026-10-16T13:20:00+09:00` 형식, 단위 ㎍/㎥, 값이 없으면 `null`. **전체 예시는 `shared/mock/`** (파일 대응은 `shared/README.md`).

| 주소 | 용도 | 응답 요약 |
|---|---|---|
| `GET /api/grid` | 격자·경계 (처음 한 번) | `cells[]`(grid_id, row, col, center, gu), `boundary`. cells 순서 = values 순서 |
| `GET /api/frames/latest` | 최신 농도 | `slot`, `source`(cctv/station), `basis_time`(밤일 때), `values[]`, `updated_at` |
| `GET /api/point?lon=&lat=` | 클릭한 곳 | `inside`, `gu`, `estimate`(pm25, grade, slot), `station`(name, distance_km, pm25, period). 범위 밖은 `inside:false`만 |
| `GET /api/health` | 상태 | `last_slot`, `stale` |
| `GET /api/frames?from=&to=` | (여유) 애니메이션 | `frames[]` |
| `POST /api/ingest/estimates` | 추정기 → 백엔드 | `Authorization: Bearer 토큰`, `rows[]`. 같은 (camera_id, slot)이면 덮어쓰기 |

등급: 좋음 0~15 · 보통 16~35 · 나쁨 36~75 · 매우나쁨 76~ (반올림 후 판정)

## 계산 규칙 (A)

- 격자 1km, 인천 내륙 + 송도 388칸(`shared/grid_cells.geojson`). 응답 시각은 항상 `+09:00` (DB 기본값 UTC에 주의)
- 보간: IDW, 가중치 `1/(d²+0.05)`, d는 km. 그 회차에 값이 있는 카메라 전부(103번 포함 — 화면 범위 밖이지만 입력으로는 씀)
- **같은 회차 값이 나눠서 옵니다.** 추정기가 1분마다 돌아 한 회차 20대가 여러 번(대개 회차 5~6분 뒤에 대부분, 습도가 끝내 안 올라온 "습도 결측" 행은 약 1시간 뒤) 나뉘어 옵니다. 값이 올 때마다 그 회차 프레임을 다시 계산 (`shared/mock/ingest_2026-10-16.json`으로 시험)
- 빠진 카메라(`pm25_est: null`, 비·습도·고장)는 빼고 계산. 전부 빠지거나 밤이면 측정소 값으로 같은 방식 보간(`source: station`, `basis_time` 채움)
- 밤 = 인천에서 태양고도 0° 미만. 밤에는 매시 실측을 받은 뒤 측정소 프레임을 만듦
- 다른 시각 값으로 빈칸을 메우지 않음. 에어코리아 13:00 값 = 12~13시 평균
- 에어코리아 "시도별 실시간 측정정보"(`getCtprvnRltmMesureDnsty`)를 매시 50분에 인천·경기 1번씩(게시가 매시 15~40분). 값이 나중에 고쳐질 수 있어 같은 시각은 덮어씀
  - `dataTime`에 `24:00`이 나옴(다음 날 00:00 = 23~24시 평균). 그대로 날짜로 바꾸면 오류
  - 빈칸이나 `-`는 측정 안 됨 → `null`
  - `shared/stations.json`에 있는 측정소만 저장 (`observations`가 `stations`를 참조)
- `stale`: 낮에 2회차(40분) 연속 추정값이 하나도 안 오면 true. 밤은 제외
- 인증키(에어코리아, 수신 토큰)는 `.env`에만. 에어코리아 키는 A가 [공공데이터포털](https://www.data.go.kr/data/15073861/openapi.do)에서 "한국환경공단_에어코리아_대기오염정보"를 활용신청해 직접 받음(개발계정 자동 승인, 하루 500건). 발급 직후엔 한동안 '등록되지 않은 키' 오류가 날 수 있음. 수신 토큰은 A가 정해 팀장에게 따로 알려 줌

## 화면 규칙 (B)

- 시안과 아래 규칙은 방향입니다. 더 나은 표현이 있으면 바꿔도 되고, PR에 이유를 적어 주세요
- MapLibre GL JS + OpenFreeMap Liberty 스타일(무료, 키 없음)
- 첫 화면: 인천 내륙이 꽉 차게, 40° 기울임. **격자는 안 보이게**, 이어 칠하고 흐리게 해서 구름처럼
- 구름 그리기: 시안은 카메라 값으로 직접 계산하지만, 실제로는 API의 **격자값(`values`)**으로 그림. `row`·`col`로 2차원 배열을 만들어 칸마다 색을 칠한 작은 이미지를 만들고, 흐리게 해서 지도에 올림
- 색: 등급 4색 파스텔(값은 시안 코드), 같은 등급 안에서도 명암. 확대할수록 옅게
- 인천 밖: 옅게 가리고 글자 숨김, 도로 번호 표지 제거
  - 가림막을 "큰 사각형에 구멍 뚫은 도형"으로 그리면 가끔 구멍이 메워져 내륙이 가려짐. 시안처럼 이미지로
  - 글자 거르기(`within`)에는 `shared/boundary.geojson`의 `simple`, 테두리 선에는 `outline`
- 화면에 두는 것: 기준 시각, 범례, 출처(OpenStreetMap·에어코리아·행정경계 통계청 SGIS — 표기 의무). CCTV·측정소 위치와 CCTV 사진은 표시하지 않음
- 클릭: 확대(3D 건물) + 패널(추정, 등급, 측정소 실측, 각각의 기준 시각). 패널을 먼저 띄우고 응답으로 채우면 렉이 없음
- 갱신: 1분마다 `/api/frames/latest`를 다시 받고 `slot`이나 `updated_at`이 바뀌면 다시 그림. 한 회차 값이 나뉘어 와서 같은 `slot`도 몇 분 뒤 값이 채워짐
- 밤: "밤 · 측정소 실측 · 21시 기준"처럼 구분. `stale`이면 "40분 전 값" 경고
- 로컬에서 `shared/mock/`을 fetch하려면 간단한 웹서버 필요(예: `python -m http.server`). 더블클릭(file://)으로는 브라우저가 막음
- 3D가 버벅이면 Chrome 하드웨어 가속 확인: `chrome://gpu`에서 WebGL이 `Hardware accelerated`여야 함

## 배포 (A)

- VM 한 대에 API·DB·화면 파일을 함께(GCP e2-micro 1GB, 스왑 1~2GB). GCP 계정은 팀장이 정함
- 브라우저가 API를 직접 부르므로 페이지가 https면 API도 https여야 함 → DuckDNS + Caddy(인증서 자동)
- 같은 주소라 CORS 불필요(로컬 개발 때만 localhost 허용)
- **배포 절차는 A가 정해 `server/README.md`에 적습니다**: VM에 이 저장소를 받아 두고 `main`이 바뀌면 어떻게 반영하는지(예: `git pull` 후 재시작),
  B의 화면 파일을 어느 폴더에서 내보내는지. B는 그 문서에 맞춰 화면 파일을 둡니다(빌드 도구를 쓰면 빌드 결과 위치도 맞추기)

## 나중에 (여유 있으면)

지난 N일 애니메이션(낮↔밤 전환 표시 필요), 장소 검색, 휴대폰용 2D 화면, 내 위치 버튼
