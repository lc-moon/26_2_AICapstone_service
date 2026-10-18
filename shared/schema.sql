-- 인천 초미세먼지 지도 DB (PostgreSQL)
-- 고정 정보
CREATE TABLE grid_cells (
  grid_id    integer PRIMARY KEY,   -- frames.values 배열의 순서(0부터)
  row integer, col integer,
  center_lon double precision, center_lat double precision,
  geom       jsonb NOT NULL,        -- GeoJSON. 화면엔 안 그리고 계산·클릭 판정용
  gu         text                   -- 클릭 패널의 "연수구 송도동 부근"
);
CREATE TABLE cameras (
  camera_id text PRIMARY KEY,       -- fitic 관리번호. 이름으로 잇지 않는다
  name text NOT NULL, lat double precision, lon double precision,
  grid_id integer REFERENCES grid_cells, active boolean DEFAULT true
);
CREATE TABLE stations (
  station_name text PRIMARY KEY, sido text,
  network text,                     -- 도시대기/도로변대기/항만 …
  lat double precision, lon double precision,
  use_for_compare boolean           -- 클릭 패널 비교·밤 보간에 쓸지
);
CREATE TABLE model_versions (       -- 어느 모델이 낸 값인지
  model text PRIMARY KEY, deployed_at timestamptz,
  cv_mae real, test_mae real, note text
);

-- 시계열
CREATE TABLE estimates (
  camera_id text REFERENCES cameras,
  slot timestamptz,                 -- :00/:20/:40 회차
  captured_at timestamptz,          -- 실제 촬영 시각(13:20:07)
  pm25_est real,                    -- 추정 안 했으면 NULL (메우지 않는다)
  status text NOT NULL,             -- 정상 / 비 / 습도 / 결측 …
  humidity real, rain_60m real,
  model text REFERENCES model_versions,
  estimated_at timestamptz, received_at timestamptz DEFAULT now(),
  PRIMARY KEY (camera_id, slot)
);
CREATE TABLE observations (
  station_name text REFERENCES stations,
  data_time timestamptz,            -- 구간 끝. 13:00 = 12~13시 평균
  pm25 real, pm10 real, pm25_flag text,
  fetched_at timestamptz, updated_at timestamptz,  -- 값이 나중에 고쳐지면 덮어쓰기
  PRIMARY KEY (station_name, data_time)
);
CREATE TABLE frames (               -- 애니메이션·지도용. 위 두 표로 언제든 다시 계산 가능
  slot timestamptz PRIMARY KEY,     -- 낮은 20분, 밤은 정시
  source text CHECK (source IN ('cctv','station')),
  basis_time timestamptz,           -- 밤이면 어느 시간 실측인지
  n_inputs smallint, inputs text[], -- 쓴 카메라·측정소
  values real[] NOT NULL,           -- grid_cells 순서
  method text, model text, created_at timestamptz DEFAULT now()
);
CREATE TABLE daily_metrics (        -- 하루 단위 추정 대 실측 (실측 대조 자동화)
  day date, camera_id text, station_name text, model text,
  n integer, mae real, bias real,
  PRIMARY KEY (day, camera_id)
);
CREATE TABLE ingest_log (           -- 로그
  id bigserial PRIMARY KEY,
  source text,                      -- estimator / airkorea
  started_at timestamptz, rows_in integer, rows_upserted integer, error text
);

-- estimates.model이 참조하므로 먼저 넣어 둔다. 수치는 교차검증·시험 A의 MAE (docs/현황.md §7)
INSERT INTO model_versions (model, deployed_at, cv_mae, test_mae, note) VALUES
  ('mixed_top60_w-hum', NULL, 3.54, 2.48, '인천+베이징 ver. 10/13~10/15 11:25 서비스'),
  ('incheon_log_top60', '2026-10-15 11:25:22+09', 3.37, 2.46, '인천 ver');
