"""One-shot generator for the symmetrical_triangle fixture battery.

Symmetrical triangle = falling upper trendline + rising lower trendline,
both converging toward an apex. Direction = neutral (breakout side decides).
"""
import json
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _build_bars(bars_count, mid_price, half_width_start, half_width_end,
                volume_pattern="contracting", preamble_bars=10,
                upper_flat=False, lower_flat=False, both_rising=False,
                both_falling=False, parallel=False, choppy=False,
                flat_noise=False, no_convergence=False, seed=42):
    """Build a synthetic OHLCV series for a symmetrical-triangle candidate.

    Args:
      mid_price: center price of the triangle
      half_width_start: half-width at start (upper = mid+hw, lower = mid-hw)
      half_width_end: half-width at end (must be < start for convergence)
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000

    if bars_count <= 1:
        bars_count = 2

    upper_start = mid_price + half_width_start
    upper_end = mid_price + half_width_end
    lower_start = mid_price - half_width_start
    lower_end = mid_price - half_width_end

    if upper_flat:
        upper_end = upper_start
    if lower_flat:
        lower_end = lower_start
    if both_rising:
        upper_end = upper_start + half_width_start * 0.6
        lower_end = lower_start + half_width_start * 0.6
    if both_falling:
        upper_end = upper_start - half_width_start * 0.6
        lower_end = lower_start - half_width_start * 0.6
    if parallel:
        # parallel channel: lines stay same width apart
        upper_end = upper_start - half_width_start * 0.4
        lower_end = lower_start - half_width_start * 0.4
    if no_convergence:
        upper_end = upper_start
        lower_end = lower_start

    upper_slope = (upper_end - upper_start) / max(bars_count - 1, 1)
    lower_slope = (lower_end - lower_start) / max(bars_count - 1, 1)

    preamble_base = mid_price - half_width_start * 1.4
    preamble_vol = 1500.0
    for i in range(preamble_bars):
        prog = i / max(preamble_bars - 1, 1)
        target = preamble_base + (mid_price - preamble_base) * prog
        c = target + rng.uniform(-0.30, 0.30)
        o = target + rng.uniform(-0.30, 0.30)
        h = max(c, o) + abs(rng.uniform(0, 0.40))
        l = min(c, o) - abs(rng.uniform(0, 0.40))
        v = preamble_vol * rng.uniform(0.8, 1.2)
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += 86400

    if flat_noise:
        for i in range(bars_count):
            c = mid_price + rng.uniform(-3.0, 3.0)
            o = mid_price + rng.uniform(-3.0, 3.0)
            h = max(c, o) + abs(rng.uniform(0, 1.5))
            l = min(c, o) - abs(rng.uniform(0, 1.5))
            v = preamble_vol * rng.uniform(0.7, 1.3)
            bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
            t += 86400
        return bars

    if choppy:
        price = mid_price
        for i in range(bars_count):
            drift = rng.uniform(-2.5, 2.5)
            price += drift
            c = price + rng.uniform(-1.5, 1.5)
            o = price + rng.uniform(-1.5, 1.5)
            h = max(c, o) + abs(rng.uniform(0.5, 2.0))
            l = min(c, o) - abs(rng.uniform(0.5, 2.0))
            v = preamble_vol * rng.uniform(0.7, 1.5)
            bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
            t += 86400
        return bars

    if volume_pattern == "contracting":
        vol_start = preamble_vol * 1.5
        vol_end = preamble_vol * 0.45
    elif volume_pattern == "strong_contracting":
        vol_start = preamble_vol * 2.0
        vol_end = preamble_vol * 0.20
    elif volume_pattern == "expanding":
        vol_start = preamble_vol * 0.5
        vol_end = preamble_vol * 1.7
    else:
        vol_start = preamble_vol
        vol_end = preamble_vol

    for i in range(bars_count):
        upper_i = upper_start + upper_slope * i
        lower_i = lower_start + lower_slope * i

        phase = i % 4
        if phase == 1:
            # touch upper
            mid = (upper_i + lower_i) / 2
            c = mid + rng.uniform(-0.10, 0.10)
            o = mid + rng.uniform(-0.10, 0.10)
            h = upper_i + abs(rng.uniform(0, 0.05))
            l = min(c, o) - abs(rng.uniform(0, 0.10))
            v_factor = 1.2
        elif phase == 3:
            # touch lower
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

        frac = i / max(bars_count - 1, 1)
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
    _write("clean_textbook", "positive",
           dict(bars_count=40, mid_price=100.0, half_width_start=8.0,
                half_width_end=2.5, volume_pattern="contracting", seed=1),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "trendline_pair"})

    _write("longer_pattern", "positive",
           dict(bars_count=55, mid_price=80.0, half_width_start=10.0,
                half_width_end=3.0, volume_pattern="contracting", seed=2),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("tight_convergence", "positive",
           dict(bars_count=35, mid_price=60.0, half_width_start=6.0,
                half_width_end=1.2, volume_pattern="contracting", seed=3),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("strong_volume_contraction", "positive",
           dict(bars_count=40, mid_price=150.0, half_width_start=12.0,
                half_width_end=3.5, volume_pattern="strong_contracting", seed=4),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})

    _write("perfect_apex", "positive",
           dict(bars_count=30, mid_price=120.0, half_width_start=10.0,
                half_width_end=2.0, volume_pattern="strong_contracting", seed=5),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})

    # NEGATIVE -------------------------------------------------------------------
    _write("upper_flat", "negative",
           dict(bars_count=40, mid_price=100.0, half_width_start=8.0,
                half_width_end=3.0, volume_pattern="contracting",
                upper_flat=True, seed=10),
           {"fires": False})

    _write("lower_flat", "negative",
           dict(bars_count=40, mid_price=100.0, half_width_start=8.0,
                half_width_end=3.0, volume_pattern="contracting",
                lower_flat=True, seed=11),
           {"fires": False})

    _write("both_rising", "negative",
           dict(bars_count=40, mid_price=100.0, half_width_start=8.0,
                half_width_end=3.0, volume_pattern="contracting",
                both_rising=True, seed=12),
           {"fires": False})

    _write("both_falling", "negative",
           dict(bars_count=40, mid_price=100.0, half_width_start=8.0,
                half_width_end=3.0, volume_pattern="contracting",
                both_falling=True, seed=13),
           {"fires": False})

    _write("parallel_channel", "negative",
           dict(bars_count=40, mid_price=100.0, half_width_start=8.0,
                half_width_end=8.0, volume_pattern="contracting",
                parallel=True, seed=14),
           {"fires": False})

    _write("pattern_too_short", "negative",
           dict(bars_count=12, mid_price=100.0, half_width_start=8.0,
                half_width_end=3.0, volume_pattern="contracting", seed=15),
           {"fires": False})

    _write("no_convergence", "negative",
           dict(bars_count=40, mid_price=100.0, half_width_start=8.0,
                half_width_end=8.0, volume_pattern="contracting",
                no_convergence=True, seed=16),
           {"fires": False})

    _write("choppy_no_structure", "negative",
           dict(bars_count=40, mid_price=100.0, half_width_start=8.0,
                half_width_end=3.0, volume_pattern="expanding",
                choppy=True, seed=17),
           {"fires": False})

    # EDGE -----------------------------------------------------------------------
    _write("boundary_min_bars", "edge",
           dict(bars_count=22, mid_price=100.0, half_width_start=8.0,
                half_width_end=3.5, volume_pattern="contracting", seed=20),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0})

    _write("boundary_wider_apex", "edge",
           dict(bars_count=35, mid_price=100.0, half_width_start=10.0,
                half_width_end=4.0, volume_pattern="contracting", seed=21),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
