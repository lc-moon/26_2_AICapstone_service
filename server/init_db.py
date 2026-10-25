"""DB 초기화: 테이블이 없으면 shared/schema.sql 실행, 공통 자료(격자·카메라·측정소)는 덮어쓰기로 넣는다.

여러 번 실행해도 안전하다. 시계열(estimates·frames 등)은 건드리지 않는다.
    python init_db.py
"""
import json
import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv

SHARED = Path(__file__).resolve().parent.parent / "shared"
load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def connect():
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL이 설정되지 않았습니다 (.env 확인)")
    # 묶어야 할 쓰기는 conn.transaction()으로 명시한다
    return psycopg.connect(url, autocommit=True)


def load(name):
    return json.loads((SHARED / name).read_text(encoding="utf-8"))


def init(conn):
    with conn.transaction():
        if conn.execute("SELECT to_regclass('public.grid_cells')").fetchone()[0] is None:
            conn.execute((SHARED / "schema.sql").read_text(encoding="utf-8"))

        cells = load("grid_cells.geojson")["features"]
        with conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO grid_cells (grid_id, row, col, center_lon, center_lat, geom, gu)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (grid_id) DO UPDATE SET row = EXCLUDED.row, col = EXCLUDED.col,
                     center_lon = EXCLUDED.center_lon, center_lat = EXCLUDED.center_lat,
                     geom = EXCLUDED.geom, gu = EXCLUDED.gu""",
                [(p["grid_id"], p["row"], p["col"], *p["center"], json.dumps(f["geometry"]), p["gu"])
                 for f in cells for p in [f["properties"]]],
            )
            cur.executemany(
                """INSERT INTO cameras (camera_id, name, lat, lon, grid_id) VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT (camera_id) DO UPDATE SET name = EXCLUDED.name, lat = EXCLUDED.lat,
                     lon = EXCLUDED.lon, grid_id = EXCLUDED.grid_id""",
                [(c["camera_id"], c["name"], c["lat"], c["lon"], c["grid_id"])
                 for c in load("cameras.json")["cameras"]],
            )
            cur.executemany(
                """INSERT INTO stations (station_name, sido, network, lat, lon, use_for_compare)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   ON CONFLICT (station_name) DO UPDATE SET sido = EXCLUDED.sido, network = EXCLUDED.network,
                     lat = EXCLUDED.lat, lon = EXCLUDED.lon, use_for_compare = EXCLUDED.use_for_compare""",
                [(s["station_name"], s["sido"], s["network"], s["lat"], s["lon"], s["use_for_compare"])
                 for s in load("stations.json")["stations"]],
            )
    counts = {t: conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
              for t in ("grid_cells", "cameras", "stations", "model_versions")}
    return counts


if __name__ == "__main__":
    with connect() as conn:
        print(init(conn))
