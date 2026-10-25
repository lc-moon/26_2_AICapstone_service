"""격자 보간 (AGENTS.md 계산 규칙, shared/mockup/index.html과 같은 식)."""
import math

KX = 111.32 * math.cos(math.radians(37.45))  # 경도 1도 → km
KY = 110.57                                  # 위도 1도 → km


def idw(centers, inputs):
    """centers: [(lon, lat)], inputs: [(lon, lat, pm25)] → 칸별 값(소수 첫째 자리)."""
    out = []
    for x, y in centers:
        s = ws = 0.0
        for lon, lat, pm in inputs:
            d2 = ((x - lon) * KX) ** 2 + ((y - lat) * KY) ** 2
            w = 1 / (d2 + 0.05)
            s += w * pm
            ws += w
        out.append(round(s / ws, 1))
    return out
