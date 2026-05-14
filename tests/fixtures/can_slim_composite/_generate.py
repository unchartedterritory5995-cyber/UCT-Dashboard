"""One-shot generator for can_slim_composite fixtures.

can_slim_composite is a META detector that ALWAYS emits one Detection per call
(when bars>=30), grading the chart A/B/C/D on the CAN SLIM 7-pillar framework.

Fixtures verify the emit structure across grade tiers + handle the <30 bars
negative case.
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


def _build_strong_leader(seed=1):
    """Strong uptrend - high A, N, S, L, M scores."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 20.0
    # 60% advance over 100 bars
    rate = (1.60) ** (1.0 / 100.0)
    for i in range(100):
        price *= rate
        # Strong closes (high DCR) + expanding vol
        bars.append(_bar(t, price, 2_000_000, rng, noise=0.15))
        t += DT
    # Last bar is near 52w high
    return bars


def _build_lagging(seed=2):
    """Sideways chop, mid-range from highs - Grade C profile."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    # Add a peak in early bars (52w high), then drift sideways below
    for i in range(20):
        price *= 1.005
        bars.append(_bar(t, price, 1_500_000, rng, noise=0.20))
        t += DT
    peak = price
    for i in range(70):
        price = peak * 0.85 + rng.uniform(-1, 1)
        bars.append(_bar(t, price, 1_500_000, rng, noise=0.30))
        t += DT
    return bars


def _build_weak(seed=3):
    """Downtrend - Grade D profile."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 100.0
    for i in range(100):
        price *= 0.992
        bars.append(_bar(t, price, 800_000, rng, noise=0.30))
        t += DT
    return bars


def _build_short_series(n_bars=10, seed=4):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    for i in range(n_bars):
        price += rng.uniform(-0.5, 0.5)
        bars.append(_bar(t, price, 1000, rng))
        t += DT
    return bars


GRADE_A_CTX = {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
               "volume_signature": "expanding", "regime": "bull",
               "nearest_resistance": None, "nearest_support": None,
               "days_to_earnings": None, "sector_strength_rank": 2,
               "recent_dcr_avg": 0.75, "dcr_signature": "accumulation",
               "can_slim_grade": "A", "can_slim_score": 88}

GRADE_B_CTX = {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
               "volume_signature": "neutral", "regime": "bull",
               "nearest_resistance": None, "nearest_support": None,
               "days_to_earnings": None, "sector_strength_rank": 5,
               "recent_dcr_avg": 0.6, "dcr_signature": "neutral",
               "can_slim_grade": "B", "can_slim_score": 72}

GRADE_C_CTX = {"trend_stage": 1, "rs_trend": "flat", "ma_alignment": "mixed",
               "volume_signature": "neutral", "regime": "transition",
               "nearest_resistance": None, "nearest_support": None,
               "days_to_earnings": None, "sector_strength_rank": None,
               "recent_dcr_avg": 0.5, "dcr_signature": "neutral",
               "can_slim_grade": "C", "can_slim_score": 55}

GRADE_D_CTX = {"trend_stage": 4, "rs_trend": "down", "ma_alignment": "stacked_bearish",
               "volume_signature": "expanding", "regime": "bear",
               "nearest_resistance": None, "nearest_support": None,
               "days_to_earnings": None, "sector_strength_rank": 10,
               "recent_dcr_avg": 0.35, "dcr_signature": "distribution",
               "can_slim_grade": "D", "can_slim_score": 35}


def _write(name, category, bars, context, expected):
    payload = {"name": name, "category": category, "expected": expected,
               "context": context, "bars": bars}
    path = os.path.join(_OUT_DIR, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {path}  ({len(bars)} bars)")


def main():
    # ===== 10 POSITIVE - varied chart shapes that emit different grades =====
    _write("grade_a_leader", "positive", _build_strong_leader(seed=1),
           GRADE_A_CTX, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
                         "geometry_shape": "candle_mark"})
    _write("grade_a_2", "positive", _build_strong_leader(seed=2),
           GRADE_A_CTX, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})
    _write("grade_b_solid", "positive", _build_strong_leader(seed=3),
           GRADE_B_CTX, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})
    _write("grade_b_2", "positive", _build_strong_leader(seed=4),
           GRADE_B_CTX, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})
    _write("grade_c_neutral", "positive", _build_lagging(seed=5),
           GRADE_C_CTX, {"fires": True, "min_confidence": 30.0, "max_confidence": 100.0})
    _write("grade_c_2", "positive", _build_lagging(seed=6),
           GRADE_C_CTX, {"fires": True, "min_confidence": 30.0, "max_confidence": 100.0})
    _write("grade_d_avoid", "positive", _build_weak(seed=7),
           GRADE_D_CTX, {"fires": True, "min_confidence": 0.0, "max_confidence": 100.0})
    _write("grade_d_2", "positive", _build_weak(seed=8),
           GRADE_D_CTX, {"fires": True, "min_confidence": 0.0, "max_confidence": 100.0})
    _write("mixed_ctx_leader", "positive", _build_strong_leader(seed=9),
           GRADE_B_CTX, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})
    _write("medium_chart", "positive", _build_lagging(seed=10),
           GRADE_C_CTX, {"fires": True, "min_confidence": 30.0, "max_confidence": 100.0})

    # ===== 3 NEGATIVE: bars too short =====
    _write("too_few_bars", "negative", _build_short_series(n_bars=10, seed=20),
           GRADE_A_CTX, {"fires": False})
    _write("short_series", "negative", _build_short_series(n_bars=20, seed=21),
           GRADE_A_CTX, {"fires": False})
    _write("min_bars_fail", "negative", _build_short_series(n_bars=25, seed=22),
           GRADE_C_CTX, {"fires": False})

    # ===== 2 EDGE =====
    _write("exactly_30_bars", "edge", _build_strong_leader(seed=30)[:30],
           GRADE_B_CTX, {"fires": True, "min_confidence": 30.0, "max_confidence": 100.0})
    _write("borderline_grade", "edge", _build_lagging(seed=31),
           GRADE_B_CTX, {"fires": True, "min_confidence": 30.0, "max_confidence": 100.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
