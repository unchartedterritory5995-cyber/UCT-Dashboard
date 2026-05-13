"""One-shot generator for the rectangle (trading range) fixture battery.

Rectangle = flat resistance ceiling + flat support floor (parallel boundaries,
no convergence). Continuation in prior trend direction.
"""
import json
import math
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _build_bars(bars_count, upper_price, lower_price,
                volume_pattern="contracting",
                prior_trend_pct=0.20, prior_bars=50,
                noisy_top=False, noisy_bottom=False,
                converging=False, diverging=False,
                choppy=False, flat_noise=False, too_deep=False,
                too_shallow=False, seed=42):
    """Build a synthetic OHLCV series for a rectangle candidate.

    Args:
      upper_price: ceiling price
      lower_price: floor price
      prior_trend_pct: fraction price moved BEFORE the rectangle
                       (positive = uptrend, negative = downtrend)
      prior_bars: bars of prior trend
      noisy_top: highs cluster span > 2.5%
      noisy_bottom: lows cluster span > 2.5%
      converging: triangle-like converging boundaries (invalid for rectangle)
      diverging: broadening pattern
      choppy: random walk
      too_deep / too_shallow: depth violations
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000

    if bars_count <= 1:
        bars_count = 2
    if too_deep:
        upper_price = lower_price * 1.40  # 40% depth
    if too_shallow:
        upper_price = lower_price * 1.02  # 2% depth

    # Prior trend bars
    mid_price = (upper_price + lower_price) / 2.0
    prior_start_price = mid_price / (1.0 + prior_trend_pct)
    preamble_vol = 1500.0
    for i in range(prior_bars):
        prog = i / max(prior_bars - 1, 1)
        target = prior_start_price + (mid_price - prior_start_price) * prog
        c = target + rng.uniform(-0.40, 0.40)
        o = target + rng.uniform(-0.40, 0.40)
        h = max(c, o) + abs(rng.uniform(0, 0.50))
        l = min(c, o) - abs(rng.uniform(0, 0.50))
        v = preamble_vol * rng.uniform(0.8, 1.2)
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += 86400

    if flat_noise:
        # Strong rising trend — no flat boundaries form because price moves
        # decisively higher throughout the window.
        start_p = mid_price * 0.85
        end_p = mid_price * 1.15
        for i in range(bars_count):
            prog = i / max(bars_count - 1, 1)
            target = start_p + (end_p - start_p) * prog
            c = target + rng.uniform(-1.0, 1.0)
            o = target + rng.uniform(-1.0, 1.0)
            h = max(c, o) + abs(rng.uniform(0, 1.0))
            l = min(c, o) - abs(rng.uniform(0, 1.0))
            v = preamble_vol * rng.uniform(0.7, 1.3)
            bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
            t += 86400
        return bars

    if choppy:
        # Strong drifting random walk — large directional moves so no flat
        # ceiling/floor forms within 2% bands.
        price = mid_price
        for i in range(bars_count):
            drift = rng.uniform(-5.0, 5.0)
            price += drift
            c = price + rng.uniform(-2.5, 2.5)
            o = price + rng.uniform(-2.5, 2.5)
            h = max(c, o) + abs(rng.uniform(1.0, 3.5))
            l = min(c, o) - abs(rng.uniform(1.0, 3.5))
            v = preamble_vol * rng.uniform(0.7, 1.5)
            bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
            t += 86400
        return bars

    if volume_pattern == "contracting":
        vol_start = preamble_vol * 1.2
        vol_end = preamble_vol * 0.65
    elif volume_pattern == "expanding":
        vol_start = preamble_vol * 0.7
        vol_end = preamble_vol * 1.5
    else:
        vol_start = preamble_vol
        vol_end = preamble_vol

    for i in range(bars_count):
        frac = i / max(bars_count - 1, 1)
        upper_i = upper_price
        lower_i = lower_price
        if converging:
            # narrow channel toward end — aggressive 70% shrink so upper line
            # ends well below the start (clearly a triangle, not a rectangle).
            shrink = (upper_price - lower_price) * 0.70 * frac
            upper_i = upper_price - shrink / 2
            lower_i = lower_price + shrink / 2
        if diverging:
            grow = (upper_price - lower_price) * 0.30 * frac
            upper_i = upper_price + grow / 2
            lower_i = lower_price - grow / 2

        if noisy_top:
            wave = math.sin(i * 0.5) * 0.08 * upper_price
            upper_i = upper_price + wave
        if noisy_bottom:
            wave = math.sin(i * 0.5) * 0.08 * lower_price
            lower_i = lower_price + wave

        phase = i % 4
        if phase == 1:
            mid = (upper_i + lower_i) / 2
            c = mid + rng.uniform(-0.10, 0.10)
            o = mid + rng.uniform(-0.10, 0.10)
            h = upper_i + abs(rng.uniform(0, 0.05))
            l = min(c, o) - abs(rng.uniform(0, 0.10))
            v_factor = 1.2
        elif phase == 3:
            mid = (upper_i + lower_i) / 2
            c = mid + rng.uniform(-0.10, 0.10)
            o = mid + rng.uniform(-0.10, 0.10)
            h = max(c, o) + abs(rng.uniform(0, 0.10))
            l = lower_i - abs(rng.uniform(0, 0.05))
            v_factor = 1.1
        else:
            mid = (upper_i + lower_i) / 2
            c = mid + rng.uniform(-0.15, 0.15)
            o = mid + rng.uniform(-0.15, 0.15)
            h = max(c, o) + abs(rng.uniform(0, 0.15))
            l = min(c, o) - abs(rng.uniform(0, 0.15))
            v_factor = 1.0

        v = (vol_start * (1 - frac) + vol_end * frac) * v_factor * rng.uniform(0.9, 1.1)

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
    # POSITIVE -------------------------------------------------------------------
    _write("clean_bullish_continuation", "positive",
           dict(bars_count=30, upper_price=110.0, lower_price=100.0,
                volume_pattern="contracting", prior_trend_pct=0.25, seed=1),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "trendline_pair"})

    _write("clean_bearish_continuation", "positive",
           dict(bars_count=30, upper_price=110.0, lower_price=100.0,
                volume_pattern="contracting", prior_trend_pct=-0.25, seed=2),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("neutral_range", "positive",
           dict(bars_count=30, upper_price=110.0, lower_price=100.0,
                volume_pattern="contracting", prior_trend_pct=0.0, seed=3),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})

    _write("longer_rectangle", "positive",
           dict(bars_count=45, upper_price=80.0, lower_price=72.0,
                volume_pattern="contracting", prior_trend_pct=0.20, seed=4),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("perfect_continuation", "positive",
           dict(bars_count=28, upper_price=120.0, lower_price=108.0,
                volume_pattern="contracting", prior_trend_pct=0.30, seed=5),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})

    # NEGATIVE -------------------------------------------------------------------
    _write("noisy_top", "negative",
           dict(bars_count=30, upper_price=110.0, lower_price=100.0,
                volume_pattern="contracting", noisy_top=True, seed=10),
           {"fires": False})

    _write("noisy_bottom", "negative",
           dict(bars_count=30, upper_price=110.0, lower_price=100.0,
                volume_pattern="contracting", noisy_bottom=True, seed=11),
           {"fires": False})

    _write("converging_triangle", "negative",
           dict(bars_count=30, upper_price=115.0, lower_price=95.0,
                volume_pattern="contracting", converging=True, seed=12),
           {"fires": False})

    _write("pattern_too_short", "negative",
           dict(bars_count=10, upper_price=110.0, lower_price=100.0,
                volume_pattern="contracting", seed=13),
           {"fires": False})

    _write("strong_trend_no_range", "negative",
           dict(bars_count=30, upper_price=110.0, lower_price=100.0,
                flat_noise=True, seed=14),
           {"fires": False})

    _write("too_deep", "negative",
           dict(bars_count=30, upper_price=140.0, lower_price=100.0,
                volume_pattern="contracting", too_deep=True, seed=15),
           {"fires": False})

    _write("too_shallow", "negative",
           dict(bars_count=30, upper_price=102.0, lower_price=100.0,
                volume_pattern="contracting", too_shallow=True, seed=16),
           {"fires": False})

    _write("choppy_no_structure", "negative",
           dict(bars_count=30, upper_price=110.0, lower_price=100.0,
                choppy=True, seed=17),
           {"fires": False})

    # EDGE -----------------------------------------------------------------------
    _write("boundary_min_bars", "edge",
           dict(bars_count=17, upper_price=110.0, lower_price=100.0,
                volume_pattern="contracting", prior_trend_pct=0.20, seed=20),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0})

    _write("boundary_deep_range", "edge",
           dict(bars_count=30, upper_price=120.0, lower_price=100.0,
                volume_pattern="contracting", prior_trend_pct=0.20, seed=21),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
