"""로컬 개발·테스트용 가짜 INFER_CMD (실제 사진·추정 없음). shared/mock/infer_ok.json(--rain이면 infer_rain.json)을 JSON 한 줄로 출력.

    INFER_CMD="python tests/fake_infer.py"                  # 정상
    INFER_CMD="python tests/fake_infer.py --sleep 12"       # 실제처럼 12초
    INFER_CMD="python tests/fake_infer.py --exit 75"        # 정기 추정기가 도는 중
"""
import argparse
import json
import sys
import time
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("camera_id")
p.add_argument("--sleep", type=float, default=0)
p.add_argument("--exit", type=int, default=0)
p.add_argument("--rain", action="store_true")
a = p.parse_args()

time.sleep(a.sleep)
if a.exit:
    print("가짜 실패", file=sys.stderr)
    sys.exit(a.exit)
mock = Path(__file__).resolve().parents[2] / "shared" / "mock" / ("infer_rain.json" if a.rain else "infer_ok.json")
m = json.loads(mock.read_text(encoding="utf-8"))
out = {"camera_id": a.camera_id, "requested_at": m["requested_at"], "captured_at": m["captured_at"],
       "pm25": m["pm25"], "status": m["status"], "photo_url": f"/cam/live/{a.camera_id}.jpg?v=20261016133305"}
sys.stdout.buffer.write((json.dumps(out, ensure_ascii=False) + "\n").encode())   # 윈도에서도 UTF-8
