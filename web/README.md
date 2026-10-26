# 인천 에어맵 — B 프론트

빌드 없는 HTML/CSS/ES modules + MapLibre GL JS 4.7.1 / OpenFreeMap Liberty.
`web/`만 수정했으며 `shared/`를 읽어서 사용합니다. CCTV 사진·카메라/측정소 위치 마커는 표시하지 않습니다.

## 실행

저장소 루트에서:

```sh
python3 -m http.server 8766 --bind 127.0.0.1
```

- 낮 mock: http://localhost:8766/web/?mode=mock
- 밤 mock: http://localhost:8766/web/?mode=mock&scenario=night
- 갱신 지연: http://localhost:8766/web/?mode=mock&scenario=stale
- 아직 값 없음: http://localhost:8766/web/?mode=mock&scenario=empty
- 실제 API: http://localhost:8766/web/?api=http://localhost:8000

실제 API 모드는 CORS 허용 후 사용합니다. 기본 `/web/`는 동일 출처 `/api`를 호출합니다.
실패해도 mock으로 자동 전환하지 않습니다. 환경변수/인증키/설치 과정은 없습니다.
`file://`로는 모듈/fetch를 사용할 수 없습니다. 지도·라이브러리 CDN에 인터넷이 필요합니다.
내 위치는 HTTPS 또는 localhost에서 사용자 권한 허용 후 동작합니다.

## 화면과 데이터

- 388개 API 격자를 row/col 배열로 만든 뒤 메르카토르 좌표에 칠하고 blur 처리.
- 경계로 자르며 null 셀은 투명하게 유지. 카메라 값 재보간은 하지 않음.
- 인천 밖 이미지 가림막, simple 경계로 라벨 필터, outline 테두리, 도로 shield 제거.
- 처음 40° 기울임, 클릭하면 확대·3D 건물 및 상세 패널. 모바일 상세는 하단 패널.
- 1분마다 최신 프레임/health 확인. slot 또는 updated_at 변경 시 다시 그림.
- latest 404는 '아직 값 없음'. 통신 오류는 마지막 정상값과 갱신 실패 안내.
- `source: station`은 밤뿐 아니라 낮 결측 대체도 가능하므로 실제 모드에서는 '밤·결측 대체'로 표시.
  정확한 야간 여부는 현 API에 없어서 source만으로 밤이라고 단정하지 않음.
- health stale 경고, health 미구현/실패는 상태 확인 불가. point 404는 상세 정보 준비 중.
- 빠른 연속 클릭/닫기 후 늦게 도착한 응답은 무시. 패널 내용은 textContent로 출력.
- mock 상세는 클릭한 격자의 농도. 측정소 예시 응답은 해당 fixture의 grid_id(38)에만 표시하며
  다른 위치에 가짜 관측값/거리를 만들어 붙이지 않습니다. 실제 모드는 point 응답을 사용.
- 등급은 반올림 후 15/35/75 경계로 판정. 모든 시각은 Asia/Seoul로 표시.

## 배포 연결(A 담당자 참고)

빌드 결과 없이 `web/` 정적 파일을 그대로 제공합니다. `/web/`와 `/shared/boundary.geojson`이
같은 상대 경로 구조로 접근 가능해야 합니다. mock 시연 시 `/shared/mock/`도 필요합니다.
실제 운영은 `/api/*`를 백엔드로 라우팅하고 `/web/`를 화면 진입점으로 사용합니다.
저장소 전체를 무차별 공개하지 말고 web 및 필요한 shared JSON/GeoJSON만 제공하세요.
Caddy/VM 설정은 A 담당 범위이며 이 PR에서는 수정하지 않았습니다.

## 검증

```sh
node --test web/core.test.mjs
node --check web/app.mjs
node --check web/render.mjs
```

단위 검증: 388개 격자 좌표 매칭, 낮/밤 응답, 반올림 경계, 경계 구멍/범위 밖,
동일 회차 수정, null/잘못된 데이터, 한국 시간 표시.
브라우저: 낮 구름 지도, 클릭 확대와 실제 3D 건물, 밤/지연/빈값 및 모바일 확인.
실제 DB/API 통합은 CORS와 point/health 구현 후 별도 확인이 필요합니다.

여유 기능인 기간 애니메이션/장소 검색은 이 PR에 포함하지 않았습니다.
