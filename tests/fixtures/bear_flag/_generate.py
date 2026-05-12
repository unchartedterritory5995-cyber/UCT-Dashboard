"""One-shot generator for the bear_flag fixture battery.

Run: python tests/fixtures/bear_flag/_generate.py
"""
import json
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _build_bars(base_price, base_bars, pole_pct, pole_bars,
                flag_retrace_pct, flag_bars, flag_slope_pct_per_bar,
                flag_volume_ratio=0.4, descending_flag=False, choppy_flag=False,
                pole_volume_ramp=True, seed=42):
    """Build a synthetic OHLCV series with a clean base-pole-flag (bear) structure.

    `pole_pct` is the DECLINE expressed as a positive fraction (e.g. 0.18 = -18% drop).
    Pass 0.0 (or negative) to skip the pole.

    `flag_retrace_pct` is interpreted in detector terms: the fraction of the pole's
    height the flag's highest high rallies back up from the pole bottom.
    flag_high = pole_bottom + retrace * pole_height.
    The generator anchors the flag channel around this exact flag_high so the
    detector's measured retrace matches the input target.
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    price = base_price
    base_vol = 1000.0

    # 1. Base consolidation (deliberately tight so its highs do NOT overshoot the pole base)
    for _ in range(base_bars):
        c = price + rng.uniform(-0.15, 0.15)
        h = c + abs(rng.uniform(0, 0.18))
        l = c - abs(rng.uniform(0, 0.18))
        o = price + rng.uniform(-0.10, 0.10)
        v = base_vol * rng.uniform(0.8, 1.2)
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += 86400

    # 2. Pole (downward — decline of pole_pct from start)
    pole_start_price = bars[-1]["c"] if bars else base_price
    if pole_bars > 0 and pole_pct > 0:
        pole_end_price = pole_start_price * (1.0 - pole_pct)
        pole_step = (pole_end_price - pole_start_price) / pole_bars  # negative
        for i in range(pole_bars):
            c = pole_start_price + pole_step * (i + 1) + rng.uniform(-0.05, 0.05)
            o = pole_start_price + pole_step * i + rng.uniform(-0.05, 0.05)
            h = max(c, o) + abs(rng.uniform(0, 0.10))
            l = min(c, o) - abs(rng.uniform(0, 0.10))
            v = base_vol * (2 + i * 0.3) if pole_volume_ramp else base_vol * 2.5
            bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
            t += 86400
        pole_bottom_price = bars[-1]["c"]
    else:
        pole_bottom_price = pole_start_price

    # 3. Flag — anchored so retrace measured at detector-time matches the input
    # detector retrace = (flag_high - pole_bottom_price) / (pole_base_price - pole_bottom_price)
    # pole_base_price ~= pole_start_price (the highest point right before the pole)
    pole_height = pole_start_price - pole_bottom_price
    if pole_height > 0:
        target_flag_high = pole_bottom_price + flag_retrace_pct * pole_height
    else:
        # No pole or negative pole: just nudge up a fixed amount
        target_flag_high = pole_bottom_price * (1.0 + flag_retrace_pct * 0.1)
    flag_low = pole_bottom_price
    pole_avg_vol = base_vol * 2.5

    # Channel center drifts according to flag_slope_pct_per_bar; midline at i=mid stays at the channel center
    mid_i = (flag_bars - 1) / 2.0 if flag_bars > 0 else 0.0

    for i in range(flag_bars):
        # i-th bar center shifted by slope.
        slope_offset = flag_low * flag_slope_pct_per_bar * (i - mid_i)
        upper = target_flag_high + slope_offset
        lower = flag_low + slope_offset
        if descending_flag:
            upper -= i * 0.2
            lower -= i * 0.2
        # body inside the channel
        c = rng.uniform(lower + 0.02, upper - 0.02) if upper - lower > 0.05 else (upper + lower) / 2.0
        o = rng.uniform(lower + 0.02, upper - 0.02) if upper - lower > 0.05 else (upper + lower) / 2.0
        if choppy_flag:
            c += rng.uniform(-1.5, 1.5)
            o += rng.uniform(-1.5, 1.5)
        h = max(c, o, upper) + abs(rng.uniform(0, 0.05))
        l = min(c, o, lower) - abs(rng.uniform(0, 0.05))
        v = pole_avg_vol * flag_volume_ratio * rng.uniform(0.8, 1.2)
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += 86400

    return bars


def _write(name, category, gen_params, expected):
    bars = _build_bars(**gen_params)
    payload = {
        "name": name,
        "category": category,
        "_generation": gen_params,
        "expected": expected,
        "bars": bars,
    }
    path = os.path.join(_OUT_DIR, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {path}  ({len(bars)} bars)")


def main():
    # 5 POSITIVE - must fire with confidence in expected band
    _write("clean_textbook", "positive",
           dict(base_price=50.0, base_bars=20, pole_pct=0.18, pole_bars=10,
                flag_retrace_pct=0.35, flag_bars=7, flag_slope_pct_per_bar=0.001,
                flag_volume_ratio=0.35, seed=1),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0,
            "geometry_shape": "trendline_pair"})

    _write("tight_consolidation", "positive",
           dict(base_price=80.0, base_bars=20, pole_pct=0.22, pole_bars=12,
                flag_retrace_pct=0.25, flag_bars=8, flag_slope_pct_per_bar=0.0,
                flag_volume_ratio=0.3, seed=2),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})

    _write("ascending_flag", "positive",
           dict(base_price=30.0, base_bars=20, pole_pct=0.25, pole_bars=8,
                flag_retrace_pct=0.40, flag_bars=10, flag_slope_pct_per_bar=0.003,
                flag_volume_ratio=0.4, seed=3),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("shallow_pullback", "positive",
           dict(base_price=120.0, base_bars=25, pole_pct=0.30, pole_bars=14,
                flag_retrace_pct=0.20, flag_bars=6, flag_slope_pct_per_bar=0.0005,
                flag_volume_ratio=0.5, seed=4),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("strong_volume_contraction", "positive",
           dict(base_price=200.0, base_bars=20, pole_pct=0.20, pole_bars=10,
                flag_retrace_pct=0.35, flag_bars=8, flag_slope_pct_per_bar=0.001,
                flag_volume_ratio=0.20, seed=5),
           {"fires": True, "min_confidence": 65.0, "max_confidence": 100.0})

    # 8 NEGATIVE - must NOT fire (or fire <50)
    _write("no_pole", "negative",
           dict(base_price=50.0, base_bars=40, pole_pct=0.0, pole_bars=0,
                flag_retrace_pct=0.5, flag_bars=10, flag_slope_pct_per_bar=0.001,
                flag_volume_ratio=0.5, seed=10),
           {"fires": False})

    _write("pole_too_small", "negative",
           dict(base_price=50.0, base_bars=20, pole_pct=0.04, pole_bars=10,
                flag_retrace_pct=0.35, flag_bars=8, flag_slope_pct_per_bar=0.001,
                flag_volume_ratio=0.4, seed=11),
           {"fires": False})

    _write("flag_too_deep", "negative",
           dict(base_price=50.0, base_bars=20, pole_pct=0.20, pole_bars=10,
                flag_retrace_pct=0.85, flag_bars=10, flag_slope_pct_per_bar=0.001,
                flag_volume_ratio=0.5, seed=12),
           {"fires": False})

    _write("flag_too_wide", "negative",
           dict(base_price=50.0, base_bars=20, pole_pct=0.20, pole_bars=10,
                flag_retrace_pct=0.40, flag_bars=40, flag_slope_pct_per_bar=0.001,
                flag_volume_ratio=0.5, seed=13),
           {"fires": False})

    _write("wide_choppy", "negative",
           dict(base_price=50.0, base_bars=20, pole_pct=0.18, pole_bars=10,
                flag_retrace_pct=0.40, flag_bars=10, flag_slope_pct_per_bar=0.001,
                flag_volume_ratio=1.2, choppy_flag=True, seed=14),
           {"fires": False})

    # An UPWARD pole — the bear_flag detector should NOT fire on this (the
    # candidate pole-bottom logic would not find a swing low at the end of an
    # uptrend). Mirror of bull_flag's "ascending_flag_in_downtrend" negative.
    _write("descending_flag_in_uptrend", "negative",
           dict(base_price=100.0, base_bars=20, pole_pct=-0.15, pole_bars=10,
                flag_retrace_pct=0.30, flag_bars=8, flag_slope_pct_per_bar=-0.002,
                descending_flag=True, flag_volume_ratio=0.6, seed=15),
           {"fires": False})

    _write("extended_flag_too_long", "negative",
           dict(base_price=50.0, base_bars=20, pole_pct=0.18, pole_bars=10,
                flag_retrace_pct=0.30, flag_bars=30, flag_slope_pct_per_bar=0.001,
                flag_volume_ratio=0.5, seed=16),
           {"fires": False})

    _write("volume_expanding", "negative",
           dict(base_price=50.0, base_bars=20, pole_pct=0.18, pole_bars=10,
                flag_retrace_pct=0.35, flag_bars=8, flag_slope_pct_per_bar=0.001,
                flag_volume_ratio=1.5, seed=17),
           {"fires": False})

    # 2 EDGE - boundary of validity
    _write("boundary_min_pole", "edge",
           dict(base_price=50.0, base_bars=20, pole_pct=0.085, pole_bars=10,
                flag_retrace_pct=0.35, flag_bars=7, flag_slope_pct_per_bar=0.001,
                flag_volume_ratio=0.4, seed=20),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 80.0})

    _write("boundary_max_retrace", "edge",
           dict(base_price=50.0, base_bars=20, pole_pct=0.20, pole_bars=10,
                flag_retrace_pct=0.46, flag_bars=8, flag_slope_pct_per_bar=0.001,
                flag_volume_ratio=0.5, seed=21),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 80.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
