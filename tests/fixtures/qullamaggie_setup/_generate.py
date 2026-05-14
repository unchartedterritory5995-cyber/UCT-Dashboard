"""One-shot generator for qullamaggie_setup fixtures.

Builds prior uptrend (so MA stack + 52w high) + 4-6 week consolidation +
ATR-thrust trigger bar with DCR + volume confirmation.
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
    if force_high is not None: h = max(h, force_high)
    if force_low is not None: l = min(l, force_low)
    return {"t": t, "o": round(o, 2), "h": round(h, 2),
            "l": round(l, 2), "c": round(c, 2),
            "v": round(vol * rng.uniform(0.85, 1.15), 0)}


def _build_qullamaggie(
    drift_bars=90,
    drift_pct=0.80,
    base_bars=22,
    base_depth=0.08,
    atr_thrust=2.0,
    trigger_dcr=0.85,
    trigger_vol_ratio=2.5,
    seed=1,
):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400

    # Prior drift up — 80% over drift_bars to ensure near 52w high + stacked MA
    price = 30.0
    step_pct = (1.0 + drift_pct) ** (1.0 / drift_bars)
    for i in range(drift_bars):
        price *= step_pct
        bars.append(_bar(t, price, 1500, rng, noise=0.20))
        t += DT

    # Base near recent highs
    base_mid = price
    half_range = base_mid * base_depth / 2.0
    for i in range(base_bars):
        mid = base_mid + rng.uniform(-half_range, half_range)
        bars.append(_bar(t, mid, 800, rng, noise=0.10))
        t += DT

    # Compute the base ATR so we can craft a trigger bar with atr_thrust ratio.
    # recent_atr is computed over the last 5 bars (4 base bars + 1 trigger), so
    # the trigger range needs to be ~(5*atr_thrust - 4) * base_avg_range for the
    # mean to come out to atr_thrust * base_avg_range.
    base_seg = bars[-base_bars:]
    base_high = max(b["h"] for b in base_seg)
    base_low = min(b["l"] for b in base_seg)
    avg_range = sum(b["h"] - b["l"] for b in base_seg) / len(base_seg)

    trig_low = base_high * 1.005
    trig_range = avg_range * max(2.0, 5.0 * atr_thrust - 4.0) * 1.15  # buffer
    trig_high = trig_low + trig_range
    trig_close = trig_low + trig_range * trigger_dcr
    trig_open = trig_low + trig_range * max(0.05, trigger_dcr - 0.4)
    avg_vol = sum(b["v"] for b in base_seg[-20:]) / max(1, min(20, len(base_seg)))
    bars.append({"t": t, "o": round(trig_open, 2), "h": round(trig_high, 2),
                 "l": round(trig_low, 2), "c": round(trig_close, 2),
                 "v": round(avg_vol * trigger_vol_ratio, 0)})
    return bars


def _build_downtrend(n_bars=120, seed=10):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 100.0
    for i in range(n_bars):
        price *= 0.99
        bars.append(_bar(t, price, 1200, rng, noise=0.40))
        t += DT
    return bars


def _build_random(n_bars=120, seed=20):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    for i in range(n_bars):
        price += rng.uniform(-1, 1)
        bars.append(_bar(t, price, 1000, rng, noise=0.40))
        t += DT
    return bars


GOOD = {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
        "volume_signature": "contracting", "regime": "bull",
        "nearest_resistance": None, "nearest_support": None,
        "days_to_earnings": None, "sector_strength_rank": 2,
        "recent_dcr_avg": 0.7, "dcr_signature": "accumulation",
        "can_slim_grade": "A", "can_slim_score": 82}

NEUTRAL = {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
           "volume_signature": "neutral", "regime": "bull",
           "nearest_resistance": None, "nearest_support": None,
           "days_to_earnings": None, "sector_strength_rank": None,
           "recent_dcr_avg": 0.55, "dcr_signature": "neutral",
           "can_slim_grade": "C", "can_slim_score": 60}

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
    _write("clean_textbook", "positive", _build_qullamaggie(seed=1),
           GOOD, {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0,
                  "geometry_shape": "rectangle"})
    _write("dramatic_thrust", "positive",
           _build_qullamaggie(atr_thrust=2.8, trigger_dcr=0.92, trigger_vol_ratio=3.5, seed=2),
           GOOD, {"fires": True, "min_confidence": 65.0, "max_confidence": 100.0})
    _write("short_base", "positive",
           _build_qullamaggie(base_bars=15, base_depth=0.06, atr_thrust=2.3, seed=3),
           GOOD, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("long_base", "positive",
           _build_qullamaggie(base_bars=28, base_depth=0.10, atr_thrust=1.8, seed=4),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})
    _write("tight_base", "positive",
           _build_qullamaggie(base_bars=20, base_depth=0.05, atr_thrust=2.2, seed=5),
           GOOD, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    # ===== 8 NEGATIVE =====
    _write("base_too_deep", "negative",
           _build_qullamaggie(base_bars=20, base_depth=0.25, seed=11),
           GOOD, {"fires": False})
    _write("atr_thrust_low", "negative",
           _build_qullamaggie(atr_thrust=1.2, seed=12),
           GOOD, {"fires": False})
    _write("trigger_vol_low", "negative",
           _build_qullamaggie(trigger_vol_ratio=1.0, seed=13),
           GOOD, {"fires": False})
    _write("dcr_too_weak", "negative",
           _build_qullamaggie(trigger_dcr=0.4, seed=14),
           GOOD, {"fires": False})
    _write("downtrend", "negative", _build_downtrend(seed=15),
           BEARISH, {"fires": False})
    _write("random_walk", "negative", _build_random(seed=16),
           NEUTRAL, {"fires": False})
    _write("base_too_short", "negative",
           _build_qullamaggie(drift_bars=50, base_bars=10, atr_thrust=1.8,
                              trigger_dcr=0.5, trigger_vol_ratio=1.3, seed=17),
           GOOD, {"fires": False})
    _write("no_volume_confirmation", "negative",
           _build_qullamaggie(trigger_vol_ratio=1.2, atr_thrust=1.8, seed=18),
           GOOD, {"fires": False})

    # ===== 2 EDGE =====
    _write("boundary_atr_thrust", "edge",
           _build_qullamaggie(atr_thrust=1.8, trigger_dcr=0.75, trigger_vol_ratio=1.55, seed=21),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})
    _write("boundary_min_base", "edge",
           _build_qullamaggie(base_bars=15, atr_thrust=1.9, trigger_dcr=0.75, trigger_vol_ratio=2.2, seed=22),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
