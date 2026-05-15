"""One-shot generator for vsa_no_demand fixtures."""
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


def _build_no_demand_setup(seed=1, no_demand_vol_ratio=0.4,
                            no_demand_range_ratio=0.25,
                            distance_from_high=0.01):
    """Build chart: uptrend → near recent high → narrow-range up bar on low volume.

    The detector requires:
      - up bar (close > open)
      - bar range < 0.5 * 20-bar avg range
      - bar volume < prior volume AND < 20-bar avg volume
      - within 7% of recent 30-bar high
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 80.0
    # Uptrend for 50 bars
    for _ in range(50):
        price += 0.3 + rng.uniform(-0.2, 0.2)
        bars.append(_bar(t, price, 2000, rng, noise=0.5))
        t += DT
    # Recent high
    recent_high = max(b["h"] for b in bars[-30:])

    # Position price slightly below recent high
    target_price = recent_high * (1.0 - distance_from_high)

    # Drift down slightly to near recent high
    while price > target_price + 0.5:
        price -= 0.1
        bars.append(_bar(t, price, 2000, rng, noise=0.4))
        t += DT

    avg_range = sum(b["h"] - b["l"] for b in bars[-20:]) / 20
    avg_vol = sum(b["v"] for b in bars[-20:]) / 20

    # Prior bar — moderate volume
    prior_close = price
    prior_open = price - 0.3
    prior_bar = _bar(t, price - 0.3, 2200, rng, noise=0.4,
                     force_open=prior_open, force_close=prior_close)
    bars.append(prior_bar)
    t += DT

    # No-Demand bar: narrow range up bar on low volume
    nd_open = prior_close + 0.02
    nd_close = prior_close + 0.12  # up bar
    nd_range = avg_range * no_demand_range_ratio
    nd_high = nd_close + nd_range * 0.25
    nd_low = nd_open - nd_range * 0.5
    nd_vol = avg_vol * no_demand_vol_ratio
    bars.append({"t": t,
                 "o": round(nd_open, 2),
                 "h": round(nd_high, 2),
                 "l": round(nd_low, 2),
                 "c": round(nd_close, 2),
                 "v": round(nd_vol, 0)})
    return bars


def _build_uptrend_no_signal(seed=10):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 80.0
    for _ in range(80):
        price += 0.3 + rng.uniform(-0.2, 0.2)
        bars.append(_bar(t, price, 2000, rng, noise=0.5))
        t += DT
    return bars


def _build_down_bar_at_high(seed=20):
    """At recent high but bar is DOWN, not UP — should not fire."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 80.0
    for _ in range(60):
        price += 0.3 + rng.uniform(-0.2, 0.2)
        bars.append(_bar(t, price, 2000, rng, noise=0.5))
        t += DT
    # Final bar: DOWN narrow low vol
    avg_range = sum(b["h"] - b["l"] for b in bars[-20:]) / 20
    avg_vol = sum(b["v"] for b in bars[-20:]) / 20
    final_open = price
    final_close = price - 0.05  # down bar
    bars.append({"t": t,
                 "o": round(final_open, 2),
                 "h": round(final_open + 0.05, 2),
                 "l": round(final_close - 0.05, 2),
                 "c": round(final_close, 2),
                 "v": round(avg_vol * 0.4, 0)})
    return bars


def _build_wide_range_up_bar(seed=30):
    """Wide-range up bar — not narrow enough."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 80.0
    for _ in range(60):
        price += 0.3 + rng.uniform(-0.2, 0.2)
        bars.append(_bar(t, price, 2000, rng, noise=0.5))
        t += DT
    avg_range = sum(b["h"] - b["l"] for b in bars[-20:]) / 20
    avg_vol = sum(b["v"] for b in bars[-20:]) / 20
    # Wide-range up bar on low volume
    final_open = price - 0.5
    final_close = price + 0.5  # up bar but wide
    bars.append({"t": t,
                 "o": round(final_open, 2),
                 "h": round(final_close + avg_range * 0.4, 2),
                 "l": round(final_open - avg_range * 0.4, 2),
                 "c": round(final_close, 2),
                 "v": round(avg_vol * 0.4, 0)})
    return bars


def _build_high_volume_up_bar(seed=40):
    """Narrow up bar but HIGH volume — supplies demand, not absence of it."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 80.0
    for _ in range(60):
        price += 0.3 + rng.uniform(-0.2, 0.2)
        bars.append(_bar(t, price, 2000, rng, noise=0.5))
        t += DT
    avg_range = sum(b["h"] - b["l"] for b in bars[-20:]) / 20
    avg_vol = sum(b["v"] for b in bars[-20:]) / 20
    final_open = price + 0.02
    final_close = price + 0.10
    nd_range = avg_range * 0.25
    bars.append({"t": t,
                 "o": round(final_open, 2),
                 "h": round(final_close + nd_range * 0.25, 2),
                 "l": round(final_open - nd_range * 0.5, 2),
                 "c": round(final_close, 2),
                 "v": round(avg_vol * 2.0, 0)})  # HIGH volume
    return bars


def _build_far_from_high(seed=50):
    """Narrow up bar but far below the recent high — not in distribution zone."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 80.0
    for _ in range(30):
        price += 0.3 + rng.uniform(-0.2, 0.2)
        bars.append(_bar(t, price, 2000, rng, noise=0.5))
        t += DT
    high_peak = price
    # Crash 15%
    for _ in range(30):
        price -= 0.3 + rng.uniform(-0.2, 0.2)
        bars.append(_bar(t, price, 2000, rng, noise=0.5))
        t += DT
    avg_range = sum(b["h"] - b["l"] for b in bars[-20:]) / 20
    avg_vol = sum(b["v"] for b in bars[-20:]) / 20
    # Final bar — way below high
    final_open = price
    final_close = price + 0.10
    nd_range = avg_range * 0.25
    bars.append({"t": t,
                 "o": round(final_open, 2),
                 "h": round(final_close + nd_range * 0.25, 2),
                 "l": round(final_open - nd_range * 0.5, 2),
                 "c": round(final_close, 2),
                 "v": round(avg_vol * 0.4, 0)})
    return bars


TOP_DISTRIBUTION = {
    "trend_stage": 3, "rs_trend": "down", "ma_alignment": "mixed",
    "volume_signature": "contracting", "regime": "transition",
    "nearest_resistance": None, "nearest_support": None,
    "days_to_earnings": None, "sector_strength_rank": 8,
    "recent_dcr_avg": 0.40, "dcr_signature": "distribution",
    "can_slim_grade": "C", "can_slim_score": 50}

BULL_AT_TOP = {
    "trend_stage": 2, "rs_trend": "flat", "ma_alignment": "stacked_bullish",
    "volume_signature": "contracting", "regime": "bull",
    "nearest_resistance": None, "nearest_support": None,
    "days_to_earnings": None, "sector_strength_rank": 5,
    "recent_dcr_avg": 0.55, "dcr_signature": "neutral",
    "can_slim_grade": "B", "can_slim_score": 60}

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


def _write(name, category, bars, context, expected):
    payload = {"name": name, "category": category, "expected": expected,
               "context": context, "bars": bars}
    path = os.path.join(_OUT_DIR, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {path}  ({len(bars)} bars)")


def main():
    # ===== 5 POSITIVE =====
    _write("clean_no_demand", "positive",
           _build_no_demand_setup(seed=1),
           TOP_DISTRIBUTION, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
                              "geometry_shape": "candle_mark"})
    _write("very_low_vol_no_demand", "positive",
           _build_no_demand_setup(seed=2, no_demand_vol_ratio=0.30),
           TOP_DISTRIBUTION, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("very_narrow_no_demand", "positive",
           _build_no_demand_setup(seed=3, no_demand_range_ratio=0.15),
           TOP_DISTRIBUTION, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("right_at_high_no_demand", "positive",
           _build_no_demand_setup(seed=4, distance_from_high=0.005),
           BULL_AT_TOP, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})
    _write("moderate_no_demand", "positive",
           _build_no_demand_setup(seed=5, no_demand_vol_ratio=0.50,
                                   no_demand_range_ratio=0.35),
           TOP_DISTRIBUTION, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})

    # ===== 8 NEGATIVE =====
    _write("uptrend_no_signal", "negative",
           _build_uptrend_no_signal(seed=10),
           BULL, {"fires": False})
    _write("down_bar_at_high", "negative",
           _build_down_bar_at_high(seed=20),
           BULL, {"fires": False})
    _write("wide_range_up_bar", "negative",
           _build_wide_range_up_bar(seed=30),
           BULL, {"fires": False})
    _write("high_volume_up_bar", "negative",
           _build_high_volume_up_bar(seed=40),
           BULL, {"fires": False})
    _write("far_from_high", "negative",
           _build_far_from_high(seed=50),
           NEUTRAL, {"fires": False})
    _write("uptrend_no_signal_2", "negative",
           _build_uptrend_no_signal(seed=11),
           BULL, {"fires": False})
    _write("too_short", "negative",
           _build_uptrend_no_signal(seed=12)[:30],
           NEUTRAL, {"fires": False})
    _write("high_vol_up_bar_2", "negative",
           _build_high_volume_up_bar(seed=41),
           BULL, {"fires": False})

    # ===== 2 EDGE =====
    _write("borderline_volume_ratio", "edge",
           _build_no_demand_setup(seed=21, no_demand_vol_ratio=0.85),
           TOP_DISTRIBUTION, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})
    _write("borderline_range_ratio", "edge",
           _build_no_demand_setup(seed=22, no_demand_range_ratio=0.45),
           TOP_DISTRIBUTION, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
