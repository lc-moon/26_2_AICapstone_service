# shared — 공통 자료

A(백엔드)·B(프론트)가 같이 쓰는 파일입니다. 규칙과 할 일은 [AGENTS.md](../AGENTS.md) 또는 [Notion 가이드](https://app.notion.com/p/A-B-3fd4a3212e4f81458cd8f40cff41cad5)를 보세요.
팀장 저장소의 `Tools/make_service_shared.py`가 만든 것이라 **직접 고치지 말고** 필요하면 팀장에게 말해 주세요.

| 파일 | 내용 |
|---|---|
| `schema.sql` | DB 테이블 (PostgreSQL) |
| `boundary.geojson` | 인천 내륙 + 송도 경계(강화·옹진·영종 제외. 행정경계에 없는 매립지는 OSM으로 보탬). `kind`가 `area`(범위), `outline`(바깥 테두리 선), `simple`(꼭짓점을 줄인 것, 지도 글자 거르기용), `display`(화면용: 만 입구를 직선으로 메운 것. 가림막·구름에만) |
| `grid_cells.geojson` | 1km 격자 456칸 — 경계와 조금이라도 겹치는 칸 전부(칸 중심이 바다인 칸도 있음). `grid_id` 순서가 API `values` 배열의 순서 |
| `cameras.json` | 카메라 20대. `grid_id`가 null인 103번(강화)은 화면 범위 밖이지만 보간 입력으로는 쓴다 |
| `stations.json` | 인천과 인접 경기·서울의 도시대기 측정소. `use_for_compare`는 인천 내륙 안에 있는 곳 |
| `mock/` | API 응답 예시 (아래) |
| `mockup/` | 참고용 화면 시안. `index.html`을 더블클릭하면 열림 (인터넷 필요) |

## mock/

| 파일 | API |
|---|---|
| `grid.json` | `GET /api/grid` |
| `frames_latest.json` | `GET /api/frames/latest` — 낮 (10/16 13:20 실제 추정값) |
| `frames_latest_night.json` | `GET /api/frames/latest` — 밤 (측정소 기준, **값은 가짜**) |
| `frames_2026-10-16.json` | `GET /api/frames?from=&to=` — 10/16 낮 33회차 (실제) |
| `point_inside.json` · `point_outside.json` | `GET /api/point` — 측정소 실측 `pm25`는 **예시값**. `camera`는 11/3 추가(실제 10/16 13:20 값) |
| `infer_ok.json` · `infer_rain.json` · `infer_busy.json` | `POST /api/infer` — 정상 · 비로 추정 안 함 · 진행 중(409). **값은 예시** (11/3 추가) |
| `cam/10042.jpg` · `cam/live/10042.jpg` | `photo_url`이 가리키는 가린 사진의 모양 예시. 실제로는 `/cam/…`에 있음. **사진은 다른 날(10/9 13:00)** (11/3 추가) |

`mockup/roi_example.jpg`(11/3 추가)는 위 사진에 화면이 겹쳐 그릴 붉은 ROI 테두리·라벨을 얹은 **완성 모양 참고**입니다. API가 주는 사진(`cam/`)에는 테두리가 없습니다.
| `health.json` · `health_stale.json` | `GET /api/health` |
| `ingest_estimates.json` | `POST /api/ingest/estimates` 요청 본문 (10/16 13:20 실제) |
| `ingest_2026-10-16.json` | 같은 형식으로 10/16 하루치 (실제). 여러 회차·늦게 오는 값을 시험할 때 |

**A 계산 확인법**: `ingest_estimates.json`을 넣고 계산한 격자값이 `frames_latest.json`의 `values`와 같으면(소수 첫째 자리) 맞습니다.
124번 카메라는 이 회차에 사진이 없어서 빠져 있습니다. 실제로도 이렇게 빠지는 회차가 있습니다.

## 알아둘 것
- 시각은 모두 한국 시간(`+09:00`), 농도는 ㎍/㎥
- 경계와 `gu`(구 이름)는 2026-07-01 행정구역 개편(서해구·검단구·제물포구·영종구)이 반영된 2026-10-01판입니다
- 경계를 화면에 쓰면 출처를 표기합니다: "행정경계: 통계청 SGIS (vuski/admdongkor)" (CC BY 4.0)
- CCTV **원본** 사진은 어디에도 내보내지 않습니다(번호판). 화면에는 추정기가 아래 40%를 모자이크한 사진(`/cam/…`)만 씁니다
- 11/3에 추가한 mock(`camera`, `infer_*`, `cam/`)은 팀장이 직접 넣은 것이라 `make_service_shared.py`에는 없습니다
