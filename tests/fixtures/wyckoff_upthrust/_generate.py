"""One-shot generator for wyckoff_upthrust fixtures (mirror of Spring)."""
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


def _build_upthrust(
    range_bars=25,
    range_height_pct=0.08,
    upthrust_depth_pct=0.015,
    distribution_vol_rise=1.5,    # second half / first half — rising = distribution
    reclaim_vol_mult=2.0,
    seed=1,
):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400

    base = 100.0
    range_low = base
    range_high = base * (1.0 + range_height_pct)
    mid_range = (range_low + range_high) / 2

    # Pre-range — uptrend approach
    for i in range(50):
        price = base * 0.80 + (base * 0.20) * (i / 50)
        bars.append(_bar(t, price, 1500, rng, noise=0.30))
        t += DT

    # Trading range — bars oscillate, distribution volume rising
    for i in range(range_bars):
        progress = i / range_bars
        # vol rises from 1500 to 1500 * distribution_vol_rise
        vol = 1500 * (1.0 + (distribution_vol_rise - 1.0) * progress)
        mid = mid_range + rng.uniform(-(range_height_pct * base * 0.30),
                                       range_height_pct * base * 0.30)
        b = _bar(t, mid, vol, rng, noise=0.12)
        b["l"] = max(b["l"], range_low + 0.05)
        b["h"] = min(b["h"], range_high - 0.05)
        bars.append(b)
        t += DT

    # Upthrust bar: high above range_high
    upthrust_high = range_high * (1.0 + upthrust_depth_pct)
    upthrust_vol = 1500 * 0.9
    upthrust_close = range_high + 0.05
    upthrust_bar = _bar(t, upthrust_high - 0.10, upthrust_vol, rng, noise=0.10,
                         force_high=upthrust_high,
                         force_close=upthrust_close,
                         force_open=range_high - 0.05)
    bars.append(upthrust_bar)
    t += DT

    # Reclaim bar: closes back below range_high on expanding volume
    reclaim_close = range_high - (range_high - range_low) * 0.30
    reclaim_vol = upthrust_vol * reclaim_vol_mult
    reclaim_bar = _bar(t, reclaim_close, reclaim_vol, rng, noise=0.12,
                        force_close=reclaim_close,
                        force_open=range_high)
    bars.append(reclaim_bar)

    return bars


def _build_chop(n=80, seed=10):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 100.0
    for i in range(n):
        price += rng.uniform(-0.3, 0.3)
        bars.append(_bar(t, price, 1500, rng, noise=0.30))
        t += DT
    return bars


def _build_strong_uptrend(n=80, seed=11):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    rate = 2.0 ** (1.0 / n)
    for i in range(n):
        price *= rate
        bars.append(_bar(t, price, 2000, rng, noise=0.30))
        t += DT
    return bars


GOOD = {"trend_stage": 3, "rs_trend": "down", "ma_alignment": "mixed",
        "volume_signature": "expanding", "regime": "transition",
        "nearest_resistance": None, "nearest_support": None,
        "days_to_earnings": None, "sector_strength_rank": 8,
        "recent_dcr_avg": 0.3, "dcr_signature": "distribution",
        "can_slim_grade": "C", "can_slim_score": 45}

GREAT = {"trend_stage": 4, "rs_trend": "down", "ma_alignment": "stacked_bearish",
         "volume_signature": "expanding", "regime": "bear",
         "nearest_resistance": None, "nearest_support": None,
         "days_to_earnings": None, "sector_strength_rank": 10,
         "recent_dcr_avg": 0.25, "dcr_signature": "distribution",
         "can_slim_grade": "D", "can_slim_score": 30}

NEUTRAL = {"trend_stage": 1, "rs_trend": "flat", "ma_alignment": "mixed",
           "volume_signature": "neutral", "regime": "transition",
           "nearest_resistance": None, "nearest_support": None,
           "days_to_earnings": None, "sector_strength_rank": None,
           "recent_dcr_avg": 0.5, "dcr_signature": "neutral",
           "can_slim_grade": "C", "can_slim_score": 50}

BULL = {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
        "volume_signature": "contracting", "regime": "bull",
        "nearest_resistance": None, "nearest_support": None,
        "days_to_earnings": None, "sector_strength_rank": 2,
        "recent_dcr_avg": 0.7, "dcr_signature": "accumulation",
        "can_slim_grade": "A", "can_slim_score": 85}


def _write(name, category, bars, context, expected):
    payload = {"name": name, "category": category, "expected": expected,
               "context": context, "bars": bars}
    path = os.path.join(_OUT_DIR, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {path}  ({len(bars)} bars)")


def main():
    # ===== 5 POSITIVE =====
    _write("clean_textbook", "positive", _build_upthrust(seed=1),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
                  "geometry_shape": "horizontal_line"})
    _write("deep_range_with_dcr", "positive",
           _build_upthrust(seed=2, range_bars=35, range_height_pct=0.10),
           GREAT, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("strong_sow", "positive",
           _build_upthrust(seed=3, reclaim_vol_mult=3.0),
           GREAT, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("strong_distribution", "positive",
           _build_upthrust(seed=4, distribution_vol_rise=2.0),
           GOOD, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("longer_range", "positive",
           _build_upthrust(seed=5, range_bars=40, range_height_pct=0.07),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})

    # ===== 8 NEGATIVE =====
    _write("chop_no_range", "negative", _build_chop(n=80, seed=10),
           NEUTRAL, {"fires": False})
    _write("strong_uptrend_hostile", "negative",
           _build_strong_uptrend(n=80, seed=11),
           BULL, {"fires": False})
    _write("no_reclaim", "negative",
           _build_upthrust(seed=12, reclaim_vol_mult=0.5),
           GOOD, {"fires": False})
    _write("declining_range_vol", "negative",
           _build_upthrust(seed=13, distribution_vol_rise=0.3),  # accumulation sig
           GOOD, {"fires": False})
    _write("chop_alt", "negative", _build_chop(n=100, seed=14),
           NEUTRAL, {"fires": False})
    _write("uptrend_alt", "negative",
           _build_strong_uptrend(n=100, seed=15),
           BULL, {"fires": False})
    _write("too_short", "negative",
           _build_chop(n=30, seed=16),
           NEUTRAL, {"fires": False})
    _write("longer_chop", "negative", _build_chop(n=120, seed=17),
           NEUTRAL, {"fires": False})

    # ===== 2 EDGE =====
    _write("shallow_upthrust", "edge",
           _build_upthrust(seed=21, upthrust_depth_pct=0.008),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})
    _write("borderline_sow", "edge",
           _build_upthrust(seed=22, reclaim_vol_mult=1.3),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
