"""One-shot generator for wyckoff_spring fixtures."""
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


def _build_spring(
    range_bars=25,
    range_height_pct=0.08,
    spring_depth_pct=0.015,
    accumulation_vol_decline=0.6,   # second half / first half — declining = accumulation
    reclaim_vol_mult=2.0,
    seed=1,
):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400

    # Pre-range — gentle approach to the range
    base = 50.0
    range_low = base
    range_high = base * (1.0 + range_height_pct)
    mid_range = (range_low + range_high) / 2

    # Build a 50-bar pre-context that brings price down to the range
    for i in range(50):
        price = base * 1.20 - (base * 0.20) * (i / 50)
        bars.append(_bar(t, price, 1500, rng, noise=0.30))
        t += DT

    # Build the trading range — bars oscillate inside [range_low, range_high]
    # with declining volume signature
    for i in range(range_bars):
        progress = i / range_bars
        # vol declines from 1.5x to 1.5x * accumulation_vol_decline over the range
        vol = 1500 * (1.0 + (accumulation_vol_decline - 1.0) * progress)
        mid = mid_range + rng.uniform(-(range_height_pct * base * 0.30),
                                       range_height_pct * base * 0.30)
        b = _bar(t, mid, vol, rng, noise=0.12)
        # Clamp bar low and high to stay roughly inside range
        b["l"] = max(b["l"], range_low + 0.05)
        b["h"] = min(b["h"], range_high - 0.05)
        bars.append(b)
        t += DT

    # Spring bar: low below range_low by spring_depth_pct
    spring_low = range_low * (1.0 - spring_depth_pct)
    # Spring volume moderate (not panic)
    spring_vol = 1500 * 0.9
    spring_close = range_low - 0.05  # spring closes below support
    spring_bar = _bar(t, spring_low + 0.10, spring_vol, rng, noise=0.10,
                      force_low=spring_low,
                      force_close=spring_close,
                      force_open=range_low + 0.05)
    bars.append(spring_bar)
    t += DT

    # Reclaim bar: closes back above range_low on expanding volume
    reclaim_close = range_low + (range_high - range_low) * 0.30
    reclaim_vol = spring_vol * reclaim_vol_mult
    reclaim_bar = _bar(t, reclaim_close, reclaim_vol, rng, noise=0.12,
                       force_close=reclaim_close,
                       force_open=range_low)
    bars.append(reclaim_bar)

    return bars


def _build_chop(n=80, seed=10):
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


def _build_strong_downtrend(n=80, seed=11):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 100.0
    rate = 0.50 ** (1.0 / n)
    for i in range(n):
        price *= rate
        bars.append(_bar(t, price, 2000, rng, noise=0.30))
        t += DT
    return bars


GOOD = {"trend_stage": 1, "rs_trend": "up", "ma_alignment": "mixed",
        "volume_signature": "contracting", "regime": "transition",
        "nearest_resistance": None, "nearest_support": None,
        "days_to_earnings": None, "sector_strength_rank": 4,
        "recent_dcr_avg": 0.65, "dcr_signature": "accumulation",
        "can_slim_grade": "B", "can_slim_score": 72}

GREAT = {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
         "volume_signature": "contracting", "regime": "bull",
         "nearest_resistance": None, "nearest_support": None,
         "days_to_earnings": None, "sector_strength_rank": 2,
         "recent_dcr_avg": 0.7, "dcr_signature": "accumulation",
         "can_slim_grade": "A", "can_slim_score": 85}

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
    _write("clean_textbook", "positive", _build_spring(seed=1),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
                  "geometry_shape": "horizontal_line"})
    _write("deep_range_with_dcr", "positive",
           _build_spring(seed=2, range_bars=35, range_height_pct=0.10),
           GREAT, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("strong_sos", "positive",
           _build_spring(seed=3, reclaim_vol_mult=3.0),
           GREAT, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("strong_accumulation", "positive",
           _build_spring(seed=4, accumulation_vol_decline=0.45),
           GOOD, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("longer_range", "positive",
           _build_spring(seed=5, range_bars=40, range_height_pct=0.07),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})

    # ===== 8 NEGATIVE =====
    _write("chop_no_range", "negative", _build_chop(n=80, seed=10),
           NEUTRAL, {"fires": False})
    _write("strong_downtrend_hostile", "negative",
           _build_strong_downtrend(n=80, seed=11),
           BEARISH, {"fires": False})
    _write("no_reclaim", "negative",
           _build_spring(seed=12, reclaim_vol_mult=0.5),  # vol below 1.2 threshold
           GOOD, {"fires": False})
    _write("expanding_range_vol", "negative",
           _build_spring(seed=13, accumulation_vol_decline=3.0),  # distribution sig
           GOOD, {"fires": False})
    _write("chop_alt", "negative", _build_chop(n=100, seed=14),
           NEUTRAL, {"fires": False})
    _write("downtrend_alt", "negative",
           _build_strong_downtrend(n=100, seed=15),
           BEARISH, {"fires": False})
    _write("too_short", "negative",
           _build_chop(n=30, seed=16),
           NEUTRAL, {"fires": False})
    _write("longer_chop", "negative", _build_chop(n=120, seed=17),
           NEUTRAL, {"fires": False})

    # ===== 2 EDGE =====
    _write("shallow_spring", "edge",
           _build_spring(seed=21, spring_depth_pct=0.008),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})
    _write("borderline_sos", "edge",
           _build_spring(seed=22, reclaim_vol_mult=1.3),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
