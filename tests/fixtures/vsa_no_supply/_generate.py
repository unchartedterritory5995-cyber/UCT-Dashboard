"""One-shot generator for vsa_no_supply fixtures (mirror of no_demand)."""
import json
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _bar(t, mid, vol, rng, noise=0.30, force_close=None, force_open=None,
         force_high=None, force_low=None):
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


def _build_no_supply_setup(seed=1, no_supply_vol_ratio=0.4,
                            no_supply_range_ratio=0.25,
                            distance_from_low=0.01):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 120.0
    # Downtrend for 50 bars
    for _ in range(50):
        price -= 0.3 + rng.uniform(-0.2, 0.2)
        bars.append(_bar(t, price, 2000, rng, noise=0.5))
        t += DT
    recent_low = min(b["l"] for b in bars[-30:])

    # Position price slightly above recent low
    target_price = recent_low * (1.0 + distance_from_low)

    while price < target_price - 0.5:
        price += 0.1
        bars.append(_bar(t, price, 2000, rng, noise=0.4))
        t += DT

    avg_range = sum(b["h"] - b["l"] for b in bars[-20:]) / 20
    avg_vol = sum(b["v"] for b in bars[-20:]) / 20

    # Prior bar — moderate volume
    prior_close = price
    prior_open = price + 0.3
    prior_bar = _bar(t, price + 0.3, 2200, rng, noise=0.4,
                     force_open=prior_open, force_close=prior_close)
    bars.append(prior_bar)
    t += DT

    # No-Supply bar: narrow range DOWN bar on low volume
    ns_open = prior_close - 0.02
    ns_close = prior_close - 0.12  # down bar
    ns_range = avg_range * no_supply_range_ratio
    ns_high = ns_open + ns_range * 0.5
    ns_low = ns_close - ns_range * 0.25
    ns_vol = avg_vol * no_supply_vol_ratio
    bars.append({"t": t,
                 "o": round(ns_open, 2),
                 "h": round(ns_high, 2),
                 "l": round(ns_low, 2),
                 "c": round(ns_close, 2),
                 "v": round(ns_vol, 0)})
    return bars


def _build_downtrend_no_signal(seed=10):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 120.0
    for _ in range(80):
        price -= 0.3 + rng.uniform(-0.2, 0.2)
        bars.append(_bar(t, price, 2000, rng, noise=0.5))
        t += DT
    return bars


def _build_up_bar_at_low(seed=20):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 120.0
    for _ in range(60):
        price -= 0.3 + rng.uniform(-0.2, 0.2)
        bars.append(_bar(t, price, 2000, rng, noise=0.5))
        t += DT
    avg_vol = sum(b["v"] for b in bars[-20:]) / 20
    final_open = price
    final_close = price + 0.05  # up bar
    bars.append({"t": t,
                 "o": round(final_open, 2),
                 "h": round(final_close + 0.05, 2),
                 "l": round(final_open - 0.05, 2),
                 "c": round(final_close, 2),
                 "v": round(avg_vol * 0.4, 0)})
    return bars


def _build_wide_range_down_bar(seed=30):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 120.0
    for _ in range(60):
        price -= 0.3 + rng.uniform(-0.2, 0.2)
        bars.append(_bar(t, price, 2000, rng, noise=0.5))
        t += DT
    avg_range = sum(b["h"] - b["l"] for b in bars[-20:]) / 20
    avg_vol = sum(b["v"] for b in bars[-20:]) / 20
    final_open = price + 0.5
    final_close = price - 0.5  # down bar but wide
    bars.append({"t": t,
                 "o": round(final_open, 2),
                 "h": round(final_open + avg_range * 0.4, 2),
                 "l": round(final_close - avg_range * 0.4, 2),
                 "c": round(final_close, 2),
                 "v": round(avg_vol * 0.4, 0)})
    return bars


def _build_high_volume_down_bar(seed=40):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 120.0
    for _ in range(60):
        price -= 0.3 + rng.uniform(-0.2, 0.2)
        bars.append(_bar(t, price, 2000, rng, noise=0.5))
        t += DT
    avg_range = sum(b["h"] - b["l"] for b in bars[-20:]) / 20
    avg_vol = sum(b["v"] for b in bars[-20:]) / 20
    final_open = price - 0.02
    final_close = price - 0.10
    ns_range = avg_range * 0.25
    bars.append({"t": t,
                 "o": round(final_open, 2),
                 "h": round(final_open + ns_range * 0.5, 2),
                 "l": round(final_close - ns_range * 0.25, 2),
                 "c": round(final_close, 2),
                 "v": round(avg_vol * 2.0, 0)})  # HIGH volume
    return bars


def _build_far_from_low(seed=50):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 100.0
    # First go down
    for _ in range(30):
        price -= 0.3 + rng.uniform(-0.2, 0.2)
        bars.append(_bar(t, price, 2000, rng, noise=0.5))
        t += DT
    # Then rally hard
    for _ in range(30):
        price += 0.3 + rng.uniform(-0.2, 0.2)
        bars.append(_bar(t, price, 2000, rng, noise=0.5))
        t += DT
    avg_range = sum(b["h"] - b["l"] for b in bars[-20:]) / 20
    avg_vol = sum(b["v"] for b in bars[-20:]) / 20
    final_open = price
    final_close = price - 0.10
    ns_range = avg_range * 0.25
    bars.append({"t": t,
                 "o": round(final_open, 2),
                 "h": round(final_open + ns_range * 0.5, 2),
                 "l": round(final_close - ns_range * 0.25, 2),
                 "c": round(final_close, 2),
                 "v": round(avg_vol * 0.4, 0)})
    return bars


BOTTOM_ACCUMULATION = {
    "trend_stage": 1, "rs_trend": "up", "ma_alignment": "mixed",
    "volume_signature": "contracting", "regime": "transition",
    "nearest_resistance": None, "nearest_support": None,
    "days_to_earnings": None, "sector_strength_rank": 5,
    "recent_dcr_avg": 0.55, "dcr_signature": "accumulation",
    "can_slim_grade": "B", "can_slim_score": 60}

BEAR_AT_BOTTOM = {
    "trend_stage": 4, "rs_trend": "flat", "ma_alignment": "stacked_bearish",
    "volume_signature": "contracting", "regime": "bear",
    "nearest_resistance": None, "nearest_support": None,
    "days_to_earnings": None, "sector_strength_rank": 9,
    "recent_dcr_avg": 0.45, "dcr_signature": "neutral",
    "can_slim_grade": "C", "can_slim_score": 45}

BEAR = {"trend_stage": 4, "rs_trend": "down", "ma_alignment": "stacked_bearish",
        "volume_signature": "expanding", "regime": "bear",
        "nearest_resistance": None, "nearest_support": None,
        "days_to_earnings": None, "sector_strength_rank": 10,
        "recent_dcr_avg": 0.30, "dcr_signature": "distribution",
        "can_slim_grade": "D", "can_slim_score": 35}

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
    _write("clean_no_supply", "positive",
           _build_no_supply_setup(seed=1),
           BOTTOM_ACCUMULATION, {"fires": True, "min_confidence": 50.0,
                                  "max_confidence": 100.0,
                                  "geometry_shape": "candle_mark"})
    _write("very_low_vol_no_supply", "positive",
           _build_no_supply_setup(seed=2, no_supply_vol_ratio=0.30),
           BOTTOM_ACCUMULATION, {"fires": True, "min_confidence": 55.0,
                                  "max_confidence": 100.0})
    _write("very_narrow_no_supply", "positive",
           _build_no_supply_setup(seed=3, no_supply_range_ratio=0.15),
           BOTTOM_ACCUMULATION, {"fires": True, "min_confidence": 55.0,
                                  "max_confidence": 100.0})
    _write("right_at_low_no_supply", "positive",
           _build_no_supply_setup(seed=4, distance_from_low=0.005),
           BEAR_AT_BOTTOM, {"fires": True, "min_confidence": 50.0,
                             "max_confidence": 100.0})
    _write("moderate_no_supply", "positive",
           _build_no_supply_setup(seed=5, no_supply_vol_ratio=0.50,
                                   no_supply_range_ratio=0.35),
           BOTTOM_ACCUMULATION, {"fires": True, "min_confidence": 50.0,
                                  "max_confidence": 100.0})

    # ===== 8 NEGATIVE =====
    _write("downtrend_no_signal", "negative",
           _build_downtrend_no_signal(seed=10),
           BEAR, {"fires": False})
    _write("up_bar_at_low", "negative",
           _build_up_bar_at_low(seed=20),
           BEAR, {"fires": False})
    _write("wide_range_down_bar", "negative",
           _build_wide_range_down_bar(seed=30),
           BEAR, {"fires": False})
    _write("high_volume_down_bar", "negative",
           _build_high_volume_down_bar(seed=40),
           BEAR, {"fires": False})
    _write("far_from_low", "negative",
           _build_far_from_low(seed=50),
           NEUTRAL, {"fires": False})
    _write("downtrend_no_signal_2", "negative",
           _build_downtrend_no_signal(seed=11),
           BEAR, {"fires": False})
    _write("too_short", "negative",
           _build_downtrend_no_signal(seed=12)[:30],
           NEUTRAL, {"fires": False})
    _write("high_vol_down_bar_2", "negative",
           _build_high_volume_down_bar(seed=41),
           BEAR, {"fires": False})

    # ===== 2 EDGE =====
    _write("borderline_volume_ratio", "edge",
           _build_no_supply_setup(seed=21, no_supply_vol_ratio=0.85),
           BOTTOM_ACCUMULATION, {"fires": True, "min_confidence": 50.0,
                                  "max_confidence": 95.0})
    _write("borderline_range_ratio", "edge",
           _build_no_supply_setup(seed=22, no_supply_range_ratio=0.45),
           BOTTOM_ACCUMULATION, {"fires": True, "min_confidence": 50.0,
                                  "max_confidence": 95.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
