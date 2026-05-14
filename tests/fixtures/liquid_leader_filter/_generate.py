"""One-shot generator for liquid_leader_filter fixtures.

Builds a stock near 52w high with high volume + Stage 2 + stacked bullish + RS up.
"""
import json
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _bar(t, mid, vol, rng, noise=0.20):
    o = mid + rng.uniform(-noise, noise)
    c = mid + rng.uniform(-noise, noise)
    h = max(o, c) + abs(rng.uniform(0, noise * 1.2))
    l = min(o, c) - abs(rng.uniform(0, noise * 1.2))
    return {"t": t, "o": round(o, 2), "h": round(h, 2),
            "l": round(l, 2), "c": round(c, 2),
            "v": round(vol * rng.uniform(0.85, 1.15), 0)}


def _build_leader(
    avg_vol=1_500_000,
    n_bars=120,
    advance_pct=0.50,
    seed=1,
):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 20.0
    rate = (1.0 + advance_pct) ** (1.0 / n_bars)
    for i in range(n_bars):
        price *= rate
        bars.append(_bar(t, price, avg_vol, rng, noise=0.20))
        t += DT
    return bars


def _build_extended(seed=10):
    """Same shape but extended >5% off 52w high."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 20.0
    # Big run then 10% pullback
    rate = 1.012
    for i in range(80):
        price *= rate
        bars.append(_bar(t, price, 1_500_000, rng))
        t += DT
    for i in range(40):
        price *= 0.997
        bars.append(_bar(t, price, 1_300_000, rng))
        t += DT
    return bars


def _build_low_volume(seed=11):
    return _build_leader(avg_vol=200_000, seed=seed)


def _build_short(n_bars=30, seed=12):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    for i in range(n_bars):
        price *= 1.005
        bars.append(_bar(t, price, 1_000_000, rng))
        t += DT
    return bars


def _build_downtrend(seed=13):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 100.0
    for i in range(120):
        price *= 0.995
        bars.append(_bar(t, price, 1_500_000, rng))
        t += DT
    return bars


GOOD = {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
        "volume_signature": "expanding", "regime": "bull",
        "nearest_resistance": None, "nearest_support": None,
        "days_to_earnings": None, "sector_strength_rank": 2,
        "recent_dcr_avg": 0.7, "dcr_signature": "accumulation",
        "can_slim_grade": "A", "can_slim_score": 85}

STAGE1_CTX = {**GOOD, "trend_stage": 1}
MIXED_MA_CTX = {**GOOD, "ma_alignment": "mixed"}
FLAT_RS_CTX = {**GOOD, "rs_trend": "flat"}
DOWN_RS_CTX = {**GOOD, "rs_trend": "down"}
STAGE4_CTX = {"trend_stage": 4, "rs_trend": "down", "ma_alignment": "stacked_bearish",
              "volume_signature": "expanding", "regime": "bear",
              "nearest_resistance": None, "nearest_support": None,
              "days_to_earnings": None, "sector_strength_rank": 10,
              "recent_dcr_avg": 0.3, "dcr_signature": "distribution",
              "can_slim_grade": "D", "can_slim_score": 35}


def _write(name, category, bars, context, expected):
    payload = {"name": name, "category": category, "expected": expected,
               "context": context, "bars": bars}
    path = os.path.join(_OUT_DIR, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {path}  ({len(bars)} bars)")


def main():
    # ===== 5 POSITIVE =====
    _write("clean_textbook", "positive", _build_leader(seed=1),
           GOOD, {"fires": True, "min_confidence": 60.0, "max_confidence": 95.0,
                  "geometry_shape": "candle_mark"})
    _write("mega_leader", "positive",
           _build_leader(avg_vol=10_000_000, advance_pct=0.80, seed=2),
           GOOD, {"fires": True, "min_confidence": 70.0, "max_confidence": 95.0})
    _write("strong_leader", "positive",
           _build_leader(avg_vol=5_000_000, seed=3),
           GOOD, {"fires": True, "min_confidence": 65.0, "max_confidence": 95.0})
    _write("mid_cap_leader", "positive",
           _build_leader(avg_vol=1_000_000, seed=4),
           GOOD, {"fires": True, "min_confidence": 60.0, "max_confidence": 95.0})
    _write("liquid_leader_b_grade", "positive",
           _build_leader(seed=5),
           {**GOOD, "can_slim_grade": "B", "can_slim_score": 72},
           {"fires": True, "min_confidence": 60.0, "max_confidence": 95.0})

    # ===== 8 NEGATIVE =====
    _write("extended_from_high", "negative", _build_extended(seed=10),
           GOOD, {"fires": False})
    _write("low_volume", "negative", _build_low_volume(seed=11),
           GOOD, {"fires": False})
    _write("stage1_ctx", "negative", _build_leader(seed=12),
           STAGE1_CTX, {"fires": False})
    _write("mixed_ma_ctx", "negative", _build_leader(seed=13),
           MIXED_MA_CTX, {"fires": False})
    _write("flat_rs", "negative", _build_leader(seed=14),
           FLAT_RS_CTX, {"fires": False})
    _write("down_rs", "negative", _build_leader(seed=15),
           DOWN_RS_CTX, {"fires": False})
    _write("downtrend", "negative", _build_downtrend(seed=16),
           STAGE4_CTX, {"fires": False})
    _write("too_short", "negative", _build_short(n_bars=30, seed=17),
           GOOD, {"fires": False})

    # ===== 2 EDGE =====
    _write("boundary_volume", "edge",
           _build_leader(avg_vol=520_000, seed=21),
           GOOD, {"fires": True, "min_confidence": 60.0, "max_confidence": 95.0})
    _write("boundary_high", "edge", _build_leader(advance_pct=0.30, seed=22),
           GOOD, {"fires": True, "min_confidence": 60.0, "max_confidence": 95.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
