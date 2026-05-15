"""One-shot generator for opening_range_breakdown fixtures."""
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


def _build_clean_orb_short(seed=1, or_width_pct=0.012, breakdown_pct=0.005,
                            vol_ratio=2.0, breakdown_age=0, post_bars=2):
    rng = random.Random(seed)
    bars = []
    t = 1700050800
    DT = 300
    price = 50.0
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

    actual_or_low = min(b["l"] for b in bars)

    for _ in range(breakdown_age):
        mid = price + rng.uniform(-0.05, 0.05)
        bars.append(_bar(t, mid, 1200, rng, noise=0.06))
        t += DT

    # Breakdown bar
    breakdown_close = actual_or_low * (1.0 - breakdown_pct)
    bars.append(_bar(t, breakdown_close, 1500 * vol_ratio, rng, noise=0.08,
                      force_close=breakdown_close,
                      force_low=breakdown_close * 0.998))
    t += DT

    for _ in range(post_bars):
        mid = breakdown_close + rng.uniform(-0.10, 0.05)
        bars.append(_bar(t, mid, 1300, rng, noise=0.07))
        t += DT

    return bars


def _build_no_breakdown(seed=10):
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
    rng = random.Random(seed)
    bars = []
    t = 1700050800
    DT = 300
    price = 50.0
    for i in range(6):
        mid = price + rng.uniform(-0.05, 0.05)
        bars.append(_bar(t, mid, 1500, rng, noise=0.03))
        t += DT
    bars.append(_bar(t, price - 0.10, 3000, rng, noise=0.03,
                      force_close=price - 0.10, force_low=price - 0.12))
    return bars


def _build_too_wide_range(seed=30):
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
    bars.append(_bar(t, price - 2.5, 3000, rng, noise=0.10,
                      force_close=price - 2.5))
    return bars


def _build_low_vol_breakdown(seed=40):
    return _build_clean_orb_short(seed=seed, vol_ratio=0.9)


BEAR = {"trend_stage": 4, "rs_trend": "down", "ma_alignment": "stacked_bearish",
        "volume_signature": "expanding", "regime": "bear",
        "nearest_resistance": None, "nearest_support": None,
        "days_to_earnings": None, "sector_strength_rank": 10,
        "recent_dcr_avg": 0.30, "dcr_signature": "distribution",
        "can_slim_grade": "D", "can_slim_score": 35}

TOPPING = {"trend_stage": 3, "rs_trend": "down", "ma_alignment": "mixed",
           "volume_signature": "expanding", "regime": "transition",
           "nearest_resistance": None, "nearest_support": None,
           "days_to_earnings": None, "sector_strength_rank": 8,
           "recent_dcr_avg": 0.40, "dcr_signature": "distribution",
           "can_slim_grade": "C", "can_slim_score": 50}

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
    _write("clean_orb_breakdown", "positive",
           _build_clean_orb_short(seed=1),
           BEAR, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
                  "geometry_shape": "rectangle"})
    _write("high_vol_orb_breakdown", "positive",
           _build_clean_orb_short(seed=2, vol_ratio=3.5),
           BEAR, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("strong_orb_breakdown", "positive",
           _build_clean_orb_short(seed=3, breakdown_pct=0.012, vol_ratio=2.5),
           BEAR, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("orb_breakdown_age_2", "positive",
           _build_clean_orb_short(seed=4, breakdown_age=2),
           BEAR, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})
    _write("mid_width_breakdown", "positive",
           _build_clean_orb_short(seed=5, or_width_pct=0.010, vol_ratio=2.0),
           TOPPING, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})

    # ===== 8 NEGATIVE =====
    _write("no_breakdown_chop", "negative",
           _build_no_breakdown(seed=10),
           NEUTRAL, {"fires": False})
    _write("too_tight_range", "negative",
           _build_too_tight_range(seed=20),
           BEAR, {"fires": False})
    _write("too_wide_range", "negative",
           _build_too_wide_range(seed=30),
           BEAR, {"fires": False})
    _write("low_volume_breakdown", "negative",
           _build_low_vol_breakdown(seed=40),
           BEAR, {"fires": False})
    _write("no_breakdown_2", "negative",
           _build_no_breakdown(seed=11),
           NEUTRAL, {"fires": False})
    _write("no_breakdown_3", "negative",
           _build_no_breakdown(seed=12),
           BULL, {"fires": False})
    _write("too_short", "negative",
           _build_clean_orb_short(seed=50)[:7],
           BEAR, {"fires": False})
    _write("low_vol_2", "negative",
           _build_low_vol_breakdown(seed=41),
           BEAR, {"fires": False})

    # ===== 2 EDGE =====
    _write("borderline_volume", "edge",
           _build_clean_orb_short(seed=21, vol_ratio=1.75),
           NEUTRAL, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})
    _write("borderline_range_width", "edge",
           _build_clean_orb_short(seed=22, or_width_pct=0.0035, vol_ratio=1.8),
           NEUTRAL, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
