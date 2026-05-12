"""One-shot generator for the high_tight_flag fixture battery.

Run: python tests/fixtures/high_tight_flag/_generate.py

An HTF (Powerplay) is a near-vertical advance (>=90% in <=8 weeks)
followed by a tight orderly consolidation (<=25 bars, <=25% retrace)
with dramatic volume contraction (flag avg <=60% of pole avg).
"""
import json
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _build_bars(base_price, base_bars, pole_pct, pole_bars,
                flag_retrace_pct, flag_bars, flag_slope_pct_per_bar=0.0,
                flag_volume_ratio=0.40, ascending_flag=False, choppy_flag=False,
                pole_volume_ramp=True, sustained_above_flag_high_bars=0,
                seed=42):
    """Build a synthetic OHLCV series with a high-tight-flag structure.

    `flag_retrace_pct`: fraction of pole height the flag's deepest low
    retraces (matches the detector's measurement).
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    base_vol = 1000.0

    # 1. Base consolidation (tight)
    price = base_price
    for _ in range(base_bars):
        c = price + rng.uniform(-0.15, 0.15)
        h = c + abs(rng.uniform(0, 0.18))
        l = c - abs(rng.uniform(0, 0.18))
        o = price + rng.uniform(-0.10, 0.10)
        v = base_vol * rng.uniform(0.8, 1.2)
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += DT

    # 2. Pole — vertical advance
    pole_start_price = bars[-1]["c"] if bars else base_price
    if pole_bars > 0:
        pole_end_price = pole_start_price * (1.0 + pole_pct)
        pole_step = (pole_end_price - pole_start_price) / pole_bars
        for i in range(pole_bars):
            c = pole_start_price + pole_step * (i + 1) + rng.uniform(-0.10, 0.10)
            o = pole_start_price + pole_step * i + rng.uniform(-0.10, 0.10)
            h = max(c, o) + abs(rng.uniform(0, 0.18))
            l = min(c, o) - abs(rng.uniform(0, 0.18))
            # Pole volume: heavy, ramping if requested
            v = base_vol * (3.0 + i * 0.4) if pole_volume_ramp else base_vol * 4.0
            v *= rng.uniform(0.85, 1.15)
            bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
            t += DT
        pole_top_price = bars[-1]["c"]
    else:
        pole_top_price = pole_start_price

    # 3. Flag — anchored so retrace measured at detector-time matches input
    pole_height = pole_top_price - pole_start_price
    if pole_height > 0:
        target_flag_low = pole_top_price - flag_retrace_pct * pole_height
    else:
        target_flag_low = pole_top_price * 0.98
    flag_high_target = pole_top_price

    # Pole average volume for flag-volume calibration
    if pole_bars > 0:
        pole_avg_vol = sum(b["v"] for b in bars[-pole_bars:]) / pole_bars
    else:
        pole_avg_vol = base_vol * 3.5

    mid_i = (flag_bars - 1) / 2.0 if flag_bars > 0 else 0.0

    for i in range(flag_bars):
        slope_offset = flag_high_target * flag_slope_pct_per_bar * (i - mid_i)
        upper = flag_high_target + slope_offset
        lower = target_flag_low + slope_offset
        if ascending_flag:
            upper += i * 0.30
            lower += i * 0.30
        if upper - lower > 0.05:
            c = rng.uniform(lower + 0.05, upper - 0.05)
            o = rng.uniform(lower + 0.05, upper - 0.05)
        else:
            c = (upper + lower) / 2.0
            o = (upper + lower) / 2.0
        if choppy_flag:
            c += rng.uniform(-2.5, 2.5)
            o += rng.uniform(-2.5, 2.5)
        h = max(c, o, upper) + abs(rng.uniform(0, 0.10))
        l = min(c, o, lower) - abs(rng.uniform(0, 0.10))
        v = pole_avg_vol * flag_volume_ratio * rng.uniform(0.80, 1.20)
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += DT

    # Optional: append bars sustained above flag high (for "already broken")
    if sustained_above_flag_high_bars > 0:
        last_flag_high = max(b["h"] for b in bars[-flag_bars:])
        for i in range(sustained_above_flag_high_bars):
            mid = last_flag_high * (1.04 + 0.005 * i)
            c = mid + rng.uniform(-0.10, 0.10)
            o = mid - 0.15 + rng.uniform(-0.05, 0.05)
            h = max(c, o) + abs(rng.uniform(0, 0.18))
            l = min(c, o) - abs(rng.uniform(0, 0.18))
            v = pole_avg_vol * 0.9
            bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
            t += DT

    return bars


def _build_drift_bars(n_bars=80, base_price=50.0, seed=1):
    """Slow upward drift — no pole, no flag."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = base_price
    for i in range(n_bars):
        price *= (1.0 + rng.uniform(-0.005, 0.008))
        c = price + rng.uniform(-0.20, 0.20)
        h = c + abs(rng.uniform(0, 0.30))
        l = c - abs(rng.uniform(0, 0.30))
        o = c + rng.uniform(-0.15, 0.15)
        v = 1000 * rng.uniform(0.8, 1.2)
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += DT
    return bars


GOOD_CONTEXT = {
    "trend_stage": 2,
    "rs_trend": "up",
    "ma_alignment": "stacked_bullish",
    "volume_signature": "contracting",
    "regime": "bullish",
    "nearest_resistance": None,
    "nearest_support": None,
    "days_to_earnings": None,
    "sector_strength_rank": None,
}


def _write(name, category, gen_params_or_bars, expected, context=None,
           prebuilt=False):
    if prebuilt:
        bars = gen_params_or_bars
        generation_info = {"prebuilt": True}
    else:
        bars = _build_bars(**gen_params_or_bars)
        generation_info = gen_params_or_bars
    payload = {
        "name": name,
        "category": category,
        "_generation": generation_info,
        "expected": expected,
        "bars": bars,
    }
    if context is not None:
        payload["context"] = context
    path = os.path.join(_OUT_DIR, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {path}  ({len(bars)} bars)")


def main():
    # ===== 5 POSITIVE — must fire with confidence in band =====
    _write("clean_textbook", "positive",
           dict(base_price=10.0, base_bars=15, pole_pct=1.00, pole_bars=30,
                flag_retrace_pct=0.18, flag_bars=6,
                flag_slope_pct_per_bar=-0.001,
                flag_volume_ratio=0.30, seed=1),
           {"fires": True, "min_confidence": 65.0, "max_confidence": 100.0,
            "geometry_shape": "trendline_pair"},
           context=GOOD_CONTEXT)

    _write("extreme_pole", "positive",
           dict(base_price=8.0, base_bars=15, pole_pct=1.50, pole_bars=25,
                flag_retrace_pct=0.15, flag_bars=8,
                flag_slope_pct_per_bar=-0.0005,
                flag_volume_ratio=0.25, seed=2),
           {"fires": True, "min_confidence": 70.0, "max_confidence": 100.0,
            "geometry_shape": "trendline_pair"},
           context=GOOD_CONTEXT)

    _write("tight_flag_short", "positive",
           dict(base_price=12.0, base_bars=15, pole_pct=0.95, pole_bars=22,
                flag_retrace_pct=0.12, flag_bars=4,
                flag_slope_pct_per_bar=0.0,
                flag_volume_ratio=0.35, seed=3),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0},
           context=GOOD_CONTEXT)

    _write("longer_pole_acceptable", "positive",
           dict(base_price=15.0, base_bars=15, pole_pct=0.95, pole_bars=38,
                flag_retrace_pct=0.20, flag_bars=10,
                flag_slope_pct_per_bar=-0.0008,
                flag_volume_ratio=0.40, seed=4),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0},
           context=GOOD_CONTEXT)

    _write("dramatic_volume_contraction", "positive",
           dict(base_price=20.0, base_bars=15, pole_pct=1.10, pole_bars=28,
                flag_retrace_pct=0.16, flag_bars=8,
                flag_slope_pct_per_bar=-0.001,
                flag_volume_ratio=0.18, seed=5),
           {"fires": True, "min_confidence": 70.0, "max_confidence": 100.0},
           context=GOOD_CONTEXT)

    # ===== 8 NEGATIVE — must NOT fire (or <50) =====
    _write("pole_too_small", "negative",
           dict(base_price=50.0, base_bars=20, pole_pct=0.60, pole_bars=20,
                flag_retrace_pct=0.20, flag_bars=8,
                flag_slope_pct_per_bar=-0.001,
                flag_volume_ratio=0.35, seed=10),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("pole_too_slow", "negative",
           dict(base_price=30.0, base_bars=20, pole_pct=0.90, pole_bars=60,
                flag_retrace_pct=0.18, flag_bars=8,
                flag_slope_pct_per_bar=-0.001,
                flag_volume_ratio=0.35, seed=11),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("flag_too_deep", "negative",
           dict(base_price=15.0, base_bars=15, pole_pct=1.00, pole_bars=28,
                flag_retrace_pct=0.40, flag_bars=8,
                flag_slope_pct_per_bar=-0.001,
                flag_volume_ratio=0.40, seed=12),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("flag_too_wide", "negative",
           dict(base_price=18.0, base_bars=15, pole_pct=1.00, pole_bars=28,
                flag_retrace_pct=0.18, flag_bars=35,
                flag_slope_pct_per_bar=-0.001,
                flag_volume_ratio=0.40, seed=13),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("volume_not_contracting", "negative",
           dict(base_price=10.0, base_bars=15, pole_pct=1.00, pole_bars=28,
                flag_retrace_pct=0.18, flag_bars=8,
                flag_slope_pct_per_bar=-0.001,
                flag_volume_ratio=0.90, seed=14),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("choppy_flag", "negative",
           dict(base_price=10.0, base_bars=15, pole_pct=1.10, pole_bars=28,
                flag_retrace_pct=0.18, flag_bars=10,
                flag_slope_pct_per_bar=-0.001,
                flag_volume_ratio=0.50, choppy_flag=True, seed=15),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("no_pole_just_drift", "negative",
           _build_drift_bars(n_bars=80, base_price=50.0, seed=16),
           {"fires": False},
           context=GOOD_CONTEXT,
           prebuilt=True)

    _write("already_broken", "negative",
           dict(base_price=10.0, base_bars=15, pole_pct=1.00, pole_bars=28,
                flag_retrace_pct=0.18, flag_bars=8,
                flag_slope_pct_per_bar=-0.001,
                flag_volume_ratio=0.30,
                sustained_above_flag_high_bars=6, seed=17),
           {"fires": False},
           context=GOOD_CONTEXT)

    # ===== 2 EDGE — boundary of validity =====
    _write("boundary_min_pole", "edge",
           dict(base_price=15.0, base_bars=15, pole_pct=0.905, pole_bars=38,
                flag_retrace_pct=0.20, flag_bars=8,
                flag_slope_pct_per_bar=-0.001,
                flag_volume_ratio=0.45, seed=20),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0},
           context=GOOD_CONTEXT)

    _write("boundary_max_retrace", "edge",
           dict(base_price=15.0, base_bars=15, pole_pct=1.00, pole_bars=28,
                flag_retrace_pct=0.235, flag_bars=8,
                flag_slope_pct_per_bar=-0.001,
                flag_volume_ratio=0.45, seed=21),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0},
           context=GOOD_CONTEXT)

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
