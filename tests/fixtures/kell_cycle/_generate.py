"""One-shot generator for kell_cycle fixtures.

kell_cycle is a META/STAGE-CLASSIFIER detector that always emits one Detection
classifying the chart into one of 5 Kell stages (1-5). Fixtures verify the
emit STRUCTURE rather than fire/no-fire bands.

5 classes covered (positive shapes), plus negative (insufficient bars) and edge.

Run: python tests/fixtures/kell_cycle/_generate.py
"""
import json
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _bar(t, mid, vol, rng, noise=0.20, force_high=None, force_low=None,
         force_open=None, force_close=None):
    o = mid + rng.uniform(-noise, noise) if force_open is None else force_open
    c = mid + rng.uniform(-noise, noise) if force_close is None else force_close
    h = max(o, c) + abs(rng.uniform(0, noise * 1.2))
    l = min(o, c) - abs(rng.uniform(0, noise * 1.2))
    if force_high is not None:
        h = max(h, force_high)
    if force_low is not None:
        l = min(l, force_low)
    return {"t": t, "o": round(o, 2), "h": round(h, 2),
            "l": round(l, 2), "c": round(c, 2),
            "v": round(vol * rng.uniform(0.85, 1.15), 0)}


def _build_uptrend_then_base(n_bars=60, base_bars=20, seed=1):
    """Stage 5 prototype: prior uptrend + tight base near recent highs."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    n_drift = n_bars - base_bars
    for i in range(n_drift):
        price *= 1.013   # ~80% over 40 bars
        bars.append(_bar(t, price, 1000, rng, noise=0.15))
        t += DT
    base_mid = price
    half_range = base_mid * 0.025  # 5% range
    for i in range(base_bars):
        mid = base_mid + rng.uniform(-half_range, half_range)
        bars.append(_bar(t, mid, 800, rng, noise=0.10))
        t += DT
    return bars


def _build_parabolic(n_bars=60, seed=2):
    """Stage 3 prototype: parabolic run with range expansion in last 10 bars."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    for i in range(n_bars - 10):
        price *= 1.005
        bars.append(_bar(t, price, 1000, rng, noise=0.20))
        t += DT
    # Parabolic last 10 bars: 30%+ gain on range expansion
    for i in range(10):
        price *= 1.035
        bars.append(_bar(t, price, 2000, rng, noise=0.60))
        t += DT
    return bars


def _build_reversal(n_bars=60, seed=3):
    """Stage 1 prototype: sustained uptrend then sharp -10% break in last 5 bars."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    for i in range(n_bars - 5):
        price *= 1.015
        bars.append(_bar(t, price, 1200, rng, noise=0.20))
        t += DT
    for i in range(5):
        price *= 0.978
        bars.append(_bar(t, price, 2200, rng, noise=0.50))
        t += DT
    return bars


def _build_wedge_drop(n_bars=60, seed=4):
    """Stage 4 prototype: parabolic run 10-20 bars ago, then 5-bar consolidation."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    # Slow drift
    for i in range(n_bars - 18):
        price *= 1.007
        bars.append(_bar(t, price, 1000, rng, noise=0.20))
        t += DT
    # Parabolic 10 bars
    for i in range(10):
        price *= 1.032
        bars.append(_bar(t, price, 1800, rng, noise=0.40))
        t += DT
    # Pullback / wedge drop 8 bars (mild bearish chop)
    peak = price
    for i in range(8):
        price *= rng.uniform(0.985, 1.005)
        bars.append(_bar(t, price, 1200, rng, noise=0.30))
        t += DT
    return bars


def _build_wedge_pop(n_bars=60, seed=5):
    """Stage 2 prototype: prior reversal 12-15 bars ago, then tight consolidation."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    for i in range(n_bars - 20):
        price *= 1.013
        bars.append(_bar(t, price, 1200, rng, noise=0.20))
        t += DT
    # Reversal break -8%
    for i in range(5):
        price *= 0.984
        bars.append(_bar(t, price, 2000, rng, noise=0.40))
        t += DT
    # Tight consolidation (wedge pop forming)
    mid = price
    for i in range(15):
        price = mid + rng.uniform(-mid * 0.015, mid * 0.015)
        bars.append(_bar(t, price, 700, rng, noise=0.10))
        t += DT
    return bars


def _build_random_walk(n_bars=80, seed=10):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    for i in range(n_bars):
        price += rng.uniform(-1.5, 1.5)
        bars.append(_bar(t, price, 1000, rng, noise=0.40))
        t += DT
    return bars


def _build_short_series(n_bars=20, seed=11):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    for i in range(n_bars):
        price += rng.uniform(-0.5, 0.5)
        bars.append(_bar(t, price, 1000, rng, noise=0.30))
        t += DT
    return bars


GOOD = {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
        "volume_signature": "neutral", "regime": "bull",
        "nearest_resistance": None, "nearest_support": None,
        "days_to_earnings": None, "sector_strength_rank": None,
        "recent_dcr_avg": 0.6, "dcr_signature": "neutral",
        "can_slim_grade": "B", "can_slim_score": 70}

NEUTRAL = {"trend_stage": 1, "rs_trend": "flat", "ma_alignment": "mixed",
           "volume_signature": "neutral", "regime": "transition",
           "nearest_resistance": None, "nearest_support": None,
           "days_to_earnings": None, "sector_strength_rank": None,
           "recent_dcr_avg": 0.5, "dcr_signature": "neutral",
           "can_slim_grade": "C", "can_slim_score": 50}


def _write(name, category, bars, context, expected):
    payload = {"name": name, "category": category, "expected": expected,
               "context": context, "bars": bars}
    path = os.path.join(_OUT_DIR, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {path}  ({len(bars)} bars)")


def main():
    # ===== 10 POSITIVE shapes covering all stages =====
    _write("stage5_clean_base", "positive", _build_uptrend_then_base(seed=1),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
                  "geometry_shape": "candle_mark"})
    _write("stage5_long_base", "positive", _build_uptrend_then_base(n_bars=80, base_bars=30, seed=11),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})
    _write("stage5_tight_base", "positive", _build_uptrend_then_base(n_bars=60, base_bars=20, seed=12),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})
    _write("stage3_parabolic", "positive", _build_parabolic(seed=2),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})
    _write("stage3_dramatic", "positive", _build_parabolic(n_bars=80, seed=22),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})
    _write("stage1_reversal", "positive", _build_reversal(seed=3),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})
    _write("stage4_wedge_drop", "positive", _build_wedge_drop(seed=4),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})
    _write("stage2_wedge_pop", "positive", _build_wedge_pop(seed=5),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})
    _write("stage5_random_seed", "positive", _build_uptrend_then_base(seed=33),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})
    _write("stage5_neutral_ctx", "positive", _build_uptrend_then_base(seed=44),
           NEUTRAL, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})

    # ===== 3 NEGATIVE: bars too short =====
    _write("too_few_bars", "negative", _build_short_series(n_bars=10, seed=50),
           GOOD, {"fires": False})
    _write("very_short_bars", "negative", _build_short_series(n_bars=15, seed=51),
           GOOD, {"fires": False})
    _write("minimal_bars", "negative", _build_short_series(n_bars=20, seed=52),
           GOOD, {"fires": False})

    # ===== 2 EDGE: random walk shapes =====
    _write("random_walk_short", "edge", _build_random_walk(n_bars=40, seed=60),
           NEUTRAL, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})
    _write("random_walk_long", "edge", _build_random_walk(n_bars=80, seed=61),
           NEUTRAL, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
