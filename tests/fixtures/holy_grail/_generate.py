"""One-shot generator for holy_grail (Raschke) fixtures.

Builds an uptrend with rising 20-EMA + a 2-3 bar pullback INTO the 20-EMA +
contracting volume + ADX>30. The detector then triggers on the reclaim.
"""
import json
import os
import random
import math

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


def _build_holy_grail(
    trend_bars=80,
    trend_pct=0.40,   # strong trend
    pullback_depth_pct=0.04,
    pullback_bars=2,
    pullback_vol_ratio=0.5,
    seed=1,
):
    """Build trend then a 2-3 bar pullback into 20-EMA + reclaim bar."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    rate = (1.0 + trend_pct) ** (1.0 / trend_bars)
    for i in range(trend_bars):
        price *= rate
        bars.append(_bar(t, price, 1500, rng, noise=0.20))
        t += DT

    # Pullback into 20-EMA: drop price by pullback_depth_pct over pullback_bars
    pullback_low = price * (1.0 - pullback_depth_pct)
    for i in range(pullback_bars):
        mid = price - (price - pullback_low) * (i + 1) / pullback_bars
        v = 1500 * pullback_vol_ratio * rng.uniform(0.85, 1.15)
        bars.append(_bar(t, mid, v, rng, noise=0.15))
        t += DT

    # Reclaim bar - close back above the prior bar's range
    reclaim_price = price * 1.005  # back above prior trend
    bars.append(_bar(t, reclaim_price, 1800, rng, noise=0.20))
    return bars


def _build_chop(n_bars=80, seed=10):
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


def _build_downtrend(n_bars=80, seed=11):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 100.0
    rate = 0.60 ** (1.0 / n_bars)
    for i in range(n_bars):
        price *= rate
        bars.append(_bar(t, price, 1500, rng, noise=0.30))
        t += DT
    return bars


GOOD = {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
        "volume_signature": "contracting", "regime": "bull",
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
    _write("clean_textbook", "positive", _build_holy_grail(seed=1),
           GOOD, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
                  "geometry_shape": "horizontal_line"})
    _write("strong_trend", "positive",
           _build_holy_grail(trend_pct=0.80, pullback_depth_pct=0.05, seed=2),
           GOOD, {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})
    _write("tight_pullback", "positive",
           _build_holy_grail(pullback_depth_pct=0.03, pullback_vol_ratio=0.35, seed=3),
           GOOD, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("three_bar_pullback", "positive",
           _build_holy_grail(pullback_bars=3, seed=4),
           GOOD, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("dry_volume", "positive",
           _build_holy_grail(pullback_vol_ratio=0.25, seed=5),
           GOOD, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    # ===== 8 NEGATIVE =====
    _write("no_trend_chop", "negative", _build_chop(seed=10),
           NEUTRAL, {"fires": False})
    _write("downtrend", "negative", _build_downtrend(seed=11),
           BEARISH, {"fires": False})
    _write("vol_expanding", "negative",
           _build_holy_grail(pullback_vol_ratio=1.5, seed=12),
           GOOD, {"fires": False})
    _write("weak_trend", "negative",
           _build_holy_grail(trend_pct=0.05, seed=13),
           GOOD, {"fires": False})
    _write("no_pullback", "negative",
           _build_holy_grail(pullback_depth_pct=0.0001, seed=14),
           GOOD, {"fires": False})
    # vol expanding twice — the volume gate is reused intentionally to
    # cover a different failure mode (expanding-vol pullback rejection).
    _write("vol_strongly_expanding", "negative",
           _build_holy_grail(pullback_vol_ratio=2.5, seed=15),
           GOOD, {"fires": False})
    _write("flat_ema", "negative", _build_chop(n_bars=100, seed=16),
           GOOD, {"fires": False})
    _write("falling_trend", "negative", _build_downtrend(seed=17),
           NEUTRAL, {"fires": False})

    # ===== 2 EDGE =====
    _write("boundary_trend", "edge",
           _build_holy_grail(trend_pct=0.30, pullback_depth_pct=0.04, seed=21),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})
    _write("boundary_pullback", "edge",
           _build_holy_grail(pullback_depth_pct=0.06, pullback_vol_ratio=0.85, seed=22),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
