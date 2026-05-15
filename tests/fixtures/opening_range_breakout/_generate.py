"""One-shot generator for opening_range_breakout fixtures.

ORB takes intraday bars. The detector treats the FIRST 6 bars as the opening
range, then looks for a breakout within the next 1-3 bars. We need at least
9 bars total. Fixtures use synthetic 5min bars (300s spacing).
"""
import json
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _bar(t, mid, vol, rng, noise=0.10, force_close=None, force_high=None,
         force_low=None):
    o = mid + rng.uniform(-noise, noise)
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


def _build_clean_orb_long(seed=1, or_width_pct=0.012, breakout_pct=0.005,
                          vol_ratio=2.0, breakout_age=0, post_bars=2):
    """Build 6-bar opening range + breakout bar at position (6 + breakout_age).

    Each bar is 5min. Default: 6 OR bars + 1 breakout bar + post_bars trail.
    """
    rng = random.Random(seed)
    bars = []
    t = 1700050800  # arbitrary start
    DT = 300  # 5min
    price = 50.0
    # 6 opening-range bars within a tight band
    or_low = price - price * or_width_pct / 2
    or_high = price + price * or_width_pct / 2
    for i in range(6):
        mid = price + rng.uniform(-or_width_pct * price * 0.4,
                                   or_width_pct * price * 0.4)
        mid = max(or_low + 0.01, min(or_high - 0.01, mid))
        bars.append(_bar(t, mid, 1500, rng, noise=0.08,
                          force_high=or_high if i == 0 else None,
                          force_low=or_low if i == 1 else None))
        t += DT

    # Recompute actual OR bounds from the bars we made
    actual_or_high = max(b["h"] for b in bars)

    # Optional pre-breakout filler bars (if breakout_age > 0)
    for _ in range(breakout_age):
        mid = price + rng.uniform(-0.05, 0.05)
        bars.append(_bar(t, mid, 1200, rng, noise=0.06))
        t += DT

    # Breakout bar: closes above OR high by `breakout_pct`
    breakout_close = actual_or_high * (1.0 + breakout_pct)
    bars.append(_bar(t, breakout_close, 1500 * vol_ratio, rng, noise=0.08,
                      force_close=breakout_close,
                      force_high=breakout_close * 1.002))
    t += DT

    # Optional post-breakout bars
    for _ in range(post_bars):
        mid = breakout_close + rng.uniform(-0.05, 0.10)
        bars.append(_bar(t, mid, 1300, rng, noise=0.07))
        t += DT

    return bars


def _build_no_breakout(seed=10):
    rng = random.Random(seed)
    bars = []
    t = 1700050800
    DT = 300
    price = 50.0
    for _ in range(12):
        mid = price + rng.uniform(-0.15, 0.15)
        bars.append(_bar(t, mid, 1500, rng, noise=0.08))
        t += DT
    return bars


def _build_too_tight_range(seed=20):
    """OR width below 0.3% — noise zone."""
    rng = random.Random(seed)
    bars = []
    t = 1700050800
    DT = 300
    price = 50.0
    for i in range(6):
        mid = price + rng.uniform(-0.05, 0.05)
        bars.append(_bar(t, mid, 1500, rng, noise=0.03))
        t += DT
    # breakout bar
    bars.append(_bar(t, price + 0.10, 3000, rng, noise=0.03,
                      force_close=price + 0.10, force_high=price + 0.12))
    return bars


def _build_too_wide_range(seed=30):
    """OR width above 2.5% — exhaustion zone."""
    rng = random.Random(seed)
    bars = []
    t = 1700050800
    DT = 300
    price = 50.0
    bars.append(_bar(t, price + 1.5, 1500, rng, noise=0.10,
                      force_high=price + 2.0))
    t += DT
    bars.append(_bar(t, price - 1.5, 1500, rng, noise=0.10,
                      force_low=price - 2.0))
    t += DT
    for _ in range(4):
        mid = price + rng.uniform(-0.5, 0.5)
        bars.append(_bar(t, mid, 1500, rng, noise=0.10))
        t += DT
    # breakout
    bars.append(_bar(t, price + 2.5, 3000, rng, noise=0.10,
                      force_close=price + 2.5))
    return bars


def _build_low_volume_breakout(seed=40):
    """Breakout occurs but volume insufficient."""
    return _build_clean_orb_long(seed=seed, vol_ratio=0.9)


BULL = {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
        "volume_signature": "expanding", "regime": "bull",
        "nearest_resistance": None, "nearest_support": None,
        "days_to_earnings": None, "sector_strength_rank": 3,
        "recent_dcr_avg": 0.65, "dcr_signature": "accumulation",
        "can_slim_grade": "B", "can_slim_score": 72}

NEUTRAL = {"trend_stage": 1, "rs_trend": "flat", "ma_alignment": "mixed",
           "volume_signature": "neutral", "regime": "transition",
           "nearest_resistance": None, "nearest_support": None,
           "days_to_earnings": None, "sector_strength_rank": None,
           "recent_dcr_avg": 0.5, "dcr_signature": "neutral",
           "can_slim_grade": "C", "can_slim_score": 50}

BEAR = {"trend_stage": 4, "rs_trend": "down", "ma_alignment": "stacked_bearish",
        "volume_signature": "expanding", "regime": "bear",
        "nearest_resistance": None, "nearest_support": None,
        "days_to_earnings": None, "sector_strength_rank": 10,
        "recent_dcr_avg": 0.30, "dcr_signature": "distribution",
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
    _write("clean_orb_breakout", "positive",
           _build_clean_orb_long(seed=1),
           BULL, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
                  "geometry_shape": "rectangle"})
    _write("high_vol_orb_breakout", "positive",
           _build_clean_orb_long(seed=2, vol_ratio=3.5),
           BULL, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("strong_orb_breakout", "positive",
           _build_clean_orb_long(seed=3, breakout_pct=0.012, vol_ratio=2.5),
           BULL, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("orb_breakout_age_2", "positive",
           _build_clean_orb_long(seed=4, breakout_age=2),
           BULL, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})
    _write("mid_width_orb_breakout", "positive",
           _build_clean_orb_long(seed=5, or_width_pct=0.010, vol_ratio=2.0),
           BULL, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})

    # ===== 8 NEGATIVE =====
    _write("no_breakout_chop", "negative",
           _build_no_breakout(seed=10),
           NEUTRAL, {"fires": False})
    _write("too_tight_range", "negative",
           _build_too_tight_range(seed=20),
           BULL, {"fires": False})
    _write("too_wide_range", "negative",
           _build_too_wide_range(seed=30),
           BULL, {"fires": False})
    _write("low_volume_breakout", "negative",
           _build_low_volume_breakout(seed=40),
           BULL, {"fires": False})
    _write("no_breakout_2", "negative",
           _build_no_breakout(seed=11),
           NEUTRAL, {"fires": False})
    _write("no_breakout_3", "negative",
           _build_no_breakout(seed=12),
           BEAR, {"fires": False})
    _write("too_short", "negative",
           _build_clean_orb_long(seed=50)[:7],
           BULL, {"fires": False})
    _write("low_vol_2", "negative",
           _build_low_volume_breakout(seed=41),
           BULL, {"fires": False})

    # ===== 2 EDGE =====
    _write("borderline_volume", "edge",
           _build_clean_orb_long(seed=21, vol_ratio=1.75),
           NEUTRAL, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})
    _write("borderline_range_width", "edge",
           _build_clean_orb_long(seed=22, or_width_pct=0.0035, vol_ratio=1.8),
           NEUTRAL, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
