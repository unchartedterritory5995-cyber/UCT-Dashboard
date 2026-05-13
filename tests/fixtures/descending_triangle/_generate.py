"""One-shot generator for the descending_triangle fixture battery.

Descending triangle = flat horizontal support bottom + falling resistance
trendline, converging toward an apex. Bearish continuation.
"""
import json
import math
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _build_bars(bars_count, flat_bottom, upper_start, upper_end,
                volume_pattern="contracting", preamble_bars=10,
                no_flat_bottom=False, both_falling=False, choppy=False,
                flat_noise=False, already_broken=False, ascending=False,
                seed=42):
    """Build a synthetic OHLCV series for a descending-triangle candidate."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000

    if bars_count <= 1:
        bars_count = 2

    lower_slope = 0.0
    if both_falling:
        lower_slope = -(flat_bottom * 0.20) / (bars_count - 1)

    upper_slope = (upper_end - upper_start) / max(bars_count - 1, 1)

    # 1. Preamble: a few bars ABOVE the pattern area (downtrend leading in)
    preamble_base = upper_start * 1.08
    preamble_target = (flat_bottom + upper_start) / 2.0
    preamble_vol = 1500.0
    for i in range(preamble_bars):
        prog = i / max(preamble_bars - 1, 1)
        target = preamble_base + (preamble_target - preamble_base) * prog
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
            base = (flat_bottom + upper_start) / 2.0
            c = base + rng.uniform(-3.0, 3.0)
            o = base + rng.uniform(-3.0, 3.0)
            h = max(c, o) + abs(rng.uniform(0, 1.5))
            l = min(c, o) - abs(rng.uniform(0, 1.5))
            v = preamble_vol * rng.uniform(0.7, 1.3)
            bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
            t += 86400
        return bars

    if choppy:
        price = (flat_bottom + upper_start) / 2.0
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
        if ascending:
            # Ascending mirror: flat top + rising support
            upper_i = upper_start  # acts as flat top
            lower_i = flat_bottom + ((upper_end - flat_bottom) / max(bars_count - 1, 1)) * i
        else:
            lower_i = flat_bottom + lower_slope * i

        if no_flat_bottom:
            wave = math.sin(i * 0.5) * 0.15
            lower_i = flat_bottom * (1.0 + wave + rng.uniform(-0.03, 0.03))

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

        frac = i / max(bars_count - 1, 1)
        v = (vol_start * (1 - frac) + vol_end * frac) * v_factor * rng.uniform(0.9, 1.1)

        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += 86400

    if already_broken:
        # Strong drop below the flat bottom
        last_c = bars[-1]["c"]
        for i in range(15):
            zig = -1.5 if i % 2 == 0 else 0.5
            step = (flat_bottom * 0.08) * (i + 1) / 5.0
            new_c = flat_bottom - step + zig + rng.uniform(-0.20, 0.20)
            new_o = new_c + rng.uniform(-0.30, 0.30)
            new_l = min(new_c, new_o) - abs(rng.uniform(0.5, 1.2))
            new_h = max(new_c, new_o) + abs(rng.uniform(0, 0.40))
            v = preamble_vol * 2.5
            bars.append({"t": t, "o": round(new_o, 2), "h": round(new_h, 2),
                         "l": round(new_l, 2), "c": round(new_c, 2), "v": round(v, 0)})
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
           dict(bars_count=40, flat_bottom=80.0, upper_start=92.0, upper_end=82.5,
                volume_pattern="contracting", seed=1),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "trendline_pair"})

    _write("longer_pattern", "positive",
           dict(bars_count=55, flat_bottom=100.0, upper_start=115.0, upper_end=103.0,
                volume_pattern="contracting", seed=2),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("tight_convergence", "positive",
           dict(bars_count=35, flat_bottom=60.0, upper_start=68.0, upper_end=61.5,
                volume_pattern="contracting", seed=3),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("strong_volume_contraction", "positive",
           dict(bars_count=40, flat_bottom=120.0, upper_start=138.0, upper_end=123.0,
                volume_pattern="strong_contracting", seed=4),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})

    _write("perfect_setup", "positive",
           dict(bars_count=30, flat_bottom=50.0, upper_start=57.0, upper_end=51.5,
                volume_pattern="strong_contracting", seed=5),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})

    # NEGATIVE -------------------------------------------------------------------
    _write("no_flat_bottom", "negative",
           dict(bars_count=40, flat_bottom=80.0, upper_start=92.0, upper_end=83.0,
                volume_pattern="contracting", no_flat_bottom=True, seed=10),
           {"fires": False})

    _write("no_falling_highs", "negative",
           dict(bars_count=40, flat_bottom=80.0, upper_start=92.0, upper_end=92.0,
                volume_pattern="contracting", seed=11),
           {"fires": False})

    _write("both_lines_falling", "negative",
           dict(bars_count=40, flat_bottom=80.0, upper_start=92.0, upper_end=82.0,
                volume_pattern="contracting", both_falling=True, seed=12),
           {"fires": False})

    _write("pattern_too_short", "negative",
           dict(bars_count=12, flat_bottom=80.0, upper_start=92.0, upper_end=82.5,
                volume_pattern="contracting", seed=13),
           {"fires": False})

    _write("no_pattern_flat", "negative",
           dict(bars_count=40, flat_bottom=80.0, upper_start=92.0, upper_end=82.0,
                flat_noise=True, seed=14),
           {"fires": False})

    _write("ascending_shape", "negative",
           dict(bars_count=40, flat_bottom=80.0, upper_start=92.0, upper_end=96.0,
                volume_pattern="contracting", ascending=True, seed=15),
           {"fires": False})

    _write("choppy_no_structure", "negative",
           dict(bars_count=40, flat_bottom=80.0, upper_start=92.0, upper_end=82.0,
                volume_pattern="expanding", choppy=True, seed=16),
           {"fires": False})

    _write("already_broken_down", "negative",
           dict(bars_count=40, flat_bottom=80.0, upper_start=92.0, upper_end=82.0,
                volume_pattern="contracting", already_broken=True, seed=17),
           {"fires": False})

    # EDGE -----------------------------------------------------------------------
    _write("boundary_min_touches", "edge",
           dict(bars_count=22, flat_bottom=80.0, upper_start=92.0, upper_end=82.5,
                volume_pattern="contracting", seed=20),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0})

    _write("boundary_wider_gap", "edge",
           dict(bars_count=35, flat_bottom=80.0, upper_start=96.0, upper_end=83.5,
                volume_pattern="contracting", seed=21),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
