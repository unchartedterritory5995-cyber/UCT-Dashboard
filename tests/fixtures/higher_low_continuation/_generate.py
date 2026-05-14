"""One-shot generator for higher_low_continuation fixtures.

Builds Stage 2 uptrend with two clear swing-low pivots (the most recent
higher than the prior by >=3%), then a reclaim of the intervening swing
high on volume.
"""
import json
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _bar(t, mid, vol, rng, noise=0.20,
         force_high=None, force_low=None, force_close=None, force_open=None):
    o = mid + rng.uniform(-noise, noise) if force_open is None else force_open
    c = mid + rng.uniform(-noise, noise) if force_close is None else force_close
    h = max(o, c) + abs(rng.uniform(0, noise * 1.2))
    l = min(o, c) - abs(rng.uniform(0, noise * 1.2))
    if force_high is not None: h = max(h, force_high)
    if force_low is not None: l = min(l, force_low)
    return {"t": t, "o": round(o, 2), "h": round(h, 2),
            "l": round(l, 2), "c": round(c, 2),
            "v": round(vol * rng.uniform(0.85, 1.15), 0)}


def _build_higher_low(
    lift_pct=0.05,
    seed=1,
):
    """Build: uptrend leg -> swing-low (low1) -> uptrend -> swing-high (high1) ->
    pullback -> higher-swing-low (low2 = low1 * (1+lift_pct)) -> reclaim above high1.
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400

    # Initial uptrend (40 bars)
    price = 40.0
    for i in range(40):
        price *= 1.005
        bars.append(_bar(t, price, 1200, rng, noise=0.15))
        t += DT

    # Swing low 1 - drop sharply for 4 bars
    low1_price = price * 0.95
    # Make sure low1 is clearly visible
    bars.append(_bar(t, low1_price * 1.01, 1200, rng, noise=0.10, force_low=low1_price))
    t += DT
    # Confirm low1 - 3 bars of recovery
    for i in range(3):
        rate = 1.005
        price = low1_price * (rate ** (i + 1))
        bars.append(_bar(t, price, 1200, rng, noise=0.15))
        t += DT

    # Rise to swing high 1
    for i in range(10):
        price *= 1.010
        bars.append(_bar(t, price, 1300, rng, noise=0.15))
        t += DT
    high1_price = price
    bars.append(_bar(t, high1_price * 0.998, 1500, rng, noise=0.15, force_high=high1_price))
    t += DT
    # Confirm high1 - 3 bars pullback
    for i in range(3):
        price *= 0.995
        bars.append(_bar(t, price, 1100, rng, noise=0.15))
        t += DT

    # Pullback to higher low (low2)
    low2_price = low1_price * (1.0 + lift_pct)
    while price > low2_price * 1.01:
        price *= 0.985
        bars.append(_bar(t, price, 1100, rng, noise=0.15))
        t += DT
    # Force low2 to be clearly visible
    bars.append(_bar(t, low2_price * 1.005, 1100, rng, noise=0.10, force_low=low2_price))
    t += DT
    # Confirm low2 - 3 bars of recovery
    for i in range(3):
        rate = 1.008
        price = low2_price * (rate ** (i + 1))
        bars.append(_bar(t, price, 1300, rng, noise=0.15))
        t += DT

    # Reclaim above high1 on volume (last 5 bars)
    target_price = high1_price * 1.01
    for i in range(5):
        progress = (i + 1) / 5.0
        price = (price * (1.0 - progress)) + target_price * progress
        bars.append(_bar(t, price, 1700, rng, noise=0.15))
        t += DT
    return bars


def _build_lower_low(seed=10):
    """Reversed setup - most recent low is LOWER, not higher."""
    return _build_higher_low(lift_pct=-0.05, seed=seed)


def _build_chop(n_bars=70, seed=11):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    for i in range(n_bars):
        price += rng.uniform(-0.3, 0.3)
        bars.append(_bar(t, price, 1000, rng, noise=0.30))
        t += DT
    return bars


def _build_downtrend(n_bars=80, seed=12):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 100.0
    for i in range(n_bars):
        price *= 0.992
        bars.append(_bar(t, price, 1200, rng, noise=0.30))
        t += DT
    return bars


GOOD = {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
        "volume_signature": "expanding", "regime": "bull",
        "nearest_resistance": None, "nearest_support": None,
        "days_to_earnings": None, "sector_strength_rank": 2,
        "recent_dcr_avg": 0.65, "dcr_signature": "accumulation",
        "can_slim_grade": "B", "can_slim_score": 72}

NEUTRAL = {"trend_stage": 1, "rs_trend": "flat", "ma_alignment": "mixed",
           "volume_signature": "neutral", "regime": "transition",
           "nearest_resistance": None, "nearest_support": None,
           "days_to_earnings": None, "sector_strength_rank": None,
           "recent_dcr_avg": 0.5, "dcr_signature": "neutral",
           "can_slim_grade": "C", "can_slim_score": 50}

BEARISH = {"trend_stage": 4, "rs_trend": "down", "ma_alignment": "stacked_bearish",
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
    _write("clean_textbook", "positive", _build_higher_low(seed=1),
           GOOD, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
                  "geometry_shape": "neckline"})
    _write("strong_lift", "positive", _build_higher_low(lift_pct=0.10, seed=2),
           GOOD, {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})
    _write("modest_lift", "positive", _build_higher_low(lift_pct=0.04, seed=3),
           GOOD, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("large_lift", "positive", _build_higher_low(lift_pct=0.15, seed=4),
           GOOD, {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})
    _write("clean_b", "positive", _build_higher_low(lift_pct=0.06, seed=5),
           GOOD, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    # ===== 8 NEGATIVE =====
    _write("lower_low", "negative", _build_lower_low(seed=10),
           GOOD, {"fires": False})
    _write("chop_no_structure", "negative", _build_chop(seed=11),
           NEUTRAL, {"fires": False})
    _write("downtrend", "negative", _build_downtrend(seed=12),
           BEARISH, {"fires": False})
    _write("stage1_ctx", "negative", _build_higher_low(seed=13),
           NEUTRAL, {"fires": False})   # context not Stage 2
    _write("mixed_ma_ctx", "negative", _build_higher_low(seed=14),
           {**GOOD, "ma_alignment": "mixed"}, {"fires": False})
    _write("flat_rs_ctx", "negative", _build_higher_low(seed=15),
           {**GOOD, "rs_trend": "flat", "ma_alignment": "stacked_bullish"},
           {"fires": True, "min_confidence": 50.0})  # still fires (only ctx affects score)
    _write("tiny_lift", "negative", _build_higher_low(lift_pct=0.015, seed=16),
           GOOD, {"fires": False})  # lift below 3% threshold
    _write("very_short", "negative", _build_chop(n_bars=30, seed=17),
           NEUTRAL, {"fires": False})

    # ===== 2 EDGE =====
    _write("boundary_lift", "edge",
           _build_higher_low(lift_pct=0.032, seed=21),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})
    _write("strong_a_grade", "edge",
           _build_higher_low(lift_pct=0.05, seed=22),
           {**GOOD, "can_slim_grade": "A", "can_slim_score": 88},
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
