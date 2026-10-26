"""태양고도. 수집기(26_2_AICapstone Collector/collect_cctv.py)와 같은 간이식이라 낮·밤 판정이 수집기와 일치한다."""
import math
from datetime import datetime, timezone

INCHEON = (37.4563, 126.7052)   # 인천시청 (위도, 경도)


def sun_altitude(when, lat=INCHEON[0], lon=INCHEON[1]):
    """when(시간대 있는 datetime)의 태양고도(도). 오차 0.1도 수준"""
    d = (when.astimezone(timezone.utc) - datetime(2000, 1, 1, 12, tzinfo=timezone.utc)).total_seconds() / 86400.0
    g = math.radians((357.529 + 0.98560028 * d) % 360)                       # 평균 근점이각
    q = (280.459 + 0.98564736 * d) % 360                                     # 평균 황경
    lam = math.radians((q + 1.915 * math.sin(g) + 0.020 * math.sin(2 * g)) % 360)
    eps = math.radians(23.439 - 0.00000036 * d)                              # 황도경사
    ra = math.atan2(math.cos(eps) * math.sin(lam), math.cos(lam))            # 적경
    dec = math.asin(math.sin(eps) * math.sin(lam))                           # 적위
    gmst = (18.697374558 + 24.06570982441908 * d) % 24                       # 그리니치 항성시
    ha = math.radians((gmst * 15 + lon) % 360) - ra                          # 시간각
    phi = math.radians(lat)
    return math.degrees(math.asin(math.sin(phi) * math.sin(dec) + math.cos(phi) * math.cos(dec) * math.cos(ha)))


def is_day(when):
    """AGENTS.md: 밤 = 인천에서 태양고도 0° 미만"""
    return sun_altitude(when) >= 0
