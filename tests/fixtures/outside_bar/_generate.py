"""One-shot generator for outside_bar fixtures."""
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


def _build_outside_bar(direction="bullish", seed=1, range_ratio=1.8,
                        volume_ratio=1.6, lead_bars=40):
    """Build leadup bars then a single outside bar with the specified
    direction. range_ratio controls how much bigger the outside bar's range
    is vs the prior bar; direction controls close DCR position.
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    for i in range(lead_bars):
        price += rng.uniform(-0.3, 0.3)
        bars.append(_bar(t, price, 1500, rng, noise=0.30))
        t += DT
    # Build the "prior" bar — modest range
    prior_high = price + 0.6
    prior_low = price - 0.6
    prior_close = price
    prior_bar = {"t": t, "o": round(price - 0.2, 2),
                 "h": round(prior_high, 2), "l": round(prior_low, 2),
                 "c": round(prior_close, 2),
                 "v": round(1500 * rng.uniform(0.95, 1.05), 0)}
    bars.append(prior_bar)
    t += DT

    # Outside bar: range is (range_ratio * prior range), engulfs prior
    prior_range = prior_high - prior_low
    target_range = prior_range * range_ratio
    new_high = prior_high + (target_range - prior_range) * 0.5 + 0.10
    new_low = prior_low - (target_range - prior_range) * 0.5 - 0.10
    # Close position based on direction
    if direction == "bullish":
        new_close = new_low + (new_high - new_low) * 0.85   # upper portion
        new_open = new_low + (new_high - new_low) * 0.15
    elif direction == "bearish":
        new_close = new_low + (new_high - new_low) * 0.12   # lower portion
        new_open = new_low + (new_high - new_low) * 0.88
    else:
        new_close = new_low + (new_high - new_low) * 0.50   # middle
        new_open = new_low + (new_high - new_low) * 0.50

    outside_bar = {"t": t,
                   "o": round(new_open, 2),
                   "h": round(new_high, 2),
                   "l": round(new_low, 2),
                   "c": round(new_close, 2),
                   "v": round(prior_bar["v"] * volume_ratio, 0)}
    bars.append(outside_bar)
    return bars


def _build_no_engulfment(seed=10, n=60):
    """Normal chop, no outside-bar engulfment."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    for i in range(n):
        price += rng.uniform(-0.3, 0.3)
        bars.append(_bar(t, price, 1500, rng, noise=0.30))
        t += DT
    return bars


BULL = {"trend_stage": 1, "rs_trend": "up", "ma_alignment": "mixed",
        "volume_signature": "expanding", "regime": "transition",
        "nearest_resistance": None, "nearest_support": None,
        "days_to_earnings": None, "sector_strength_rank": 5,
        "recent_dcr_avg": 0.55, "dcr_signature": "accumulation",
        "can_slim_grade": "B", "can_slim_score": 65}

BEAR = {"trend_stage": 3, "rs_trend": "down", "ma_alignment": "mixed",
        "volume_signature": "expanding", "regime": "transition",
        "nearest_resistance": None, "nearest_support": None,
        "days_to_earnings": None, "sector_strength_rank": 10,
        "recent_dcr_avg": 0.45, "dcr_signature": "distribution",
        "can_slim_grade": "C", "can_slim_score": 50}

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
    # ===== 5 POSITIVE =====
    _write("bullish_outside_bar", "positive",
           _build_outside_bar(direction="bullish", seed=1),
           BULL, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
                  "geometry_shape": "candle_mark"})
    _write("bearish_outside_bar", "positive",
           _build_outside_bar(direction="bearish", seed=2),
           BEAR, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})
    _write("strong_bullish_high_volume", "positive",
           _build_outside_bar(direction="bullish", seed=3, range_ratio=2.6, volume_ratio=2.5),
           BULL, {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})
    _write("strong_bearish_high_volume", "positive",
           _build_outside_bar(direction="bearish", seed=4, range_ratio=2.6, volume_ratio=2.5),
           BEAR, {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})
    _write("neutral_outside_bar", "positive",
           _build_outside_bar(direction="neutral", seed=5),
           NEUTRAL, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})

    # ===== 8 NEGATIVE =====
    _write("no_engulfment_chop", "negative", _build_no_engulfment(seed=10),
           NEUTRAL, {"fires": False})
    _write("low_volume_outside", "negative",
           _build_outside_bar(direction="bullish", seed=11, volume_ratio=0.8),
           BULL, {"fires": False})
    _write("borderline_low_vol", "negative",
           _build_outside_bar(direction="bullish", seed=12, volume_ratio=1.1),
           BULL, {"fires": False})
    _write("no_engulfment_2", "negative", _build_no_engulfment(seed=13),
           BULL, {"fires": False})
    _write("no_engulfment_3", "negative", _build_no_engulfment(seed=14),
           BEAR, {"fires": False})
    _write("too_short", "negative", _build_no_engulfment(seed=15, n=20),
           NEUTRAL, {"fires": False})
    _write("no_engulfment_4", "negative", _build_no_engulfment(seed=16),
           NEUTRAL, {"fires": False})
    _write("no_engulfment_5", "negative", _build_no_engulfment(seed=17, n=50),
           NEUTRAL, {"fires": False})

    # ===== 2 EDGE =====
    _write("borderline_volume", "edge",
           _build_outside_bar(direction="bullish", seed=21, volume_ratio=1.35),
           BULL, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})
    _write("borderline_range", "edge",
           _build_outside_bar(direction="bullish", seed=22, range_ratio=1.20),
           BULL, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
