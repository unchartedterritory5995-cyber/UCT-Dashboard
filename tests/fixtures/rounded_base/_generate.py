"""One-shot generator for the rounded_base fixture battery.

Run: python tests/fixtures/rounded_base/_generate.py

Rounded Base = slow U-shape consolidation WITHOUT a handle. The right
side rallies cleanly back to the prior high without a small pullback.
"""
import json
import math
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _build_bars(bars_count, left_rim, base_bottom, right_rim=None,
                volume_pattern="rounded", preamble_bars=8,
                v_shape=False, has_handle=False, no_curve=False,
                shallow=False, too_deep=False, choppy=False,
                already_broken=False, rim_mismatch=False,
                inverted=False, seed=42):
    """Synthetic OHLCV with a rounded U-shape base.

    Uses a quadratic curve from left_rim -> base_bottom -> right_rim,
    with bars distributed slowly across the curve so the bottom is wide.
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000

    if right_rim is None:
        right_rim = left_rim
    if rim_mismatch:
        right_rim = left_rim * 0.85  # 15% off - too far apart

    # Preamble (uptrend into the left rim)
    preamble_vol = 1500.0
    for i in range(preamble_bars):
        prog = i / max(preamble_bars - 1, 1)
        start = left_rim * 0.85
        target = start + (left_rim - start) * prog
        c = target + rng.uniform(-0.3, 0.3)
        o = target + rng.uniform(-0.3, 0.3)
        h = max(c, o) + abs(rng.uniform(0, 0.4))
        l = min(c, o) - abs(rng.uniform(0, 0.4))
        v = preamble_vol * rng.uniform(0.9, 1.2)
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += 86400

    # Pattern bars: quadratic curve from left_rim through base_bottom to right_rim
    # Use a -> b parameterization where x in [0, 1]
    mid = bars_count / 2.0
    for i in range(bars_count):
        x = i
        # Quadratic: y = A*(x - mid)^2 + base_bottom; tuned so y(0) = left_rim
        if mid > 0:
            A_left = (left_rim - base_bottom) / (mid ** 2)
            A_right = (right_rim - base_bottom) / ((bars_count - 1 - mid) ** 2)
        else:
            A_left = A_right = 0
        if x <= mid:
            y = A_left * (x - mid) ** 2 + base_bottom
        else:
            y = A_right * (x - mid) ** 2 + base_bottom

        if v_shape:
            # V-shape: linear decline then linear rise
            if x <= mid:
                y = left_rim + (base_bottom - left_rim) * (x / max(mid, 1))
            else:
                y = base_bottom + (right_rim - base_bottom) * ((x - mid) / max(bars_count - 1 - mid, 1))

        if inverted:
            # Flip into an inverted-U (rounded TOP) for the "wrong shape" test
            y = left_rim + base_bottom - y

        if no_curve:
            # Flat noise around the average
            y = (left_rim + base_bottom + right_rim) / 3.0 + rng.uniform(-2.0, 2.0)

        c = y + rng.uniform(-0.2, 0.2)
        o = y + rng.uniform(-0.2, 0.2)
        h = max(c, o) + abs(rng.uniform(0, 0.3))
        l = min(c, o) - abs(rng.uniform(0, 0.3))

        if choppy:
            # Random walk decoupled from the curve - destroys roundness
            if not hasattr(rng, '_cw'):
                rng._cw = (left_rim + base_bottom) / 2.0
            rng._cw += rng.uniform(-4.5, 4.5)
            c = rng._cw + rng.uniform(-1.5, 1.5)
            o = rng._cw + rng.uniform(-1.5, 1.5)
            h = max(c, o) + abs(rng.uniform(1.0, 3.0))
            l = min(c, o) - abs(rng.uniform(1.0, 3.0))

        # Volume: dry through middle, expand on right side
        if volume_pattern == "rounded":
            third = bars_count // 3
            if i < third:
                v_factor = 1.0
            elif i < 2 * third:
                v_factor = 0.55
            else:
                v_factor = 1.4
        elif volume_pattern == "expanding":
            v_factor = 0.6 + (i / max(bars_count - 1, 1)) * 1.0
        else:
            v_factor = 1.0
        v = preamble_vol * v_factor * rng.uniform(0.9, 1.1)

        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += 86400

    if has_handle:
        # Add a small pullback handle AFTER the right rim
        handle_low = right_rim * 0.92  # 8% pullback
        handle_bars = 10
        for i in range(handle_bars):
            prog = i / max(handle_bars - 1, 1)
            # Carve a small V-shape pullback
            if i < handle_bars // 2:
                y = right_rim + (handle_low - right_rim) * (i / max(handle_bars // 2 - 1, 1))
            else:
                y = handle_low + (right_rim * 0.97 - handle_low) * \
                    ((i - handle_bars // 2) / max(handle_bars // 2 - 1, 1))
            c = y + rng.uniform(-0.2, 0.2)
            o = y + rng.uniform(-0.2, 0.2)
            h = max(c, o) + abs(rng.uniform(0, 0.3))
            l = min(c, o) - abs(rng.uniform(0, 0.3))
            v = preamble_vol * 0.7 * rng.uniform(0.8, 1.1)
            bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
            t += 86400

    if already_broken:
        for i in range(5):
            new_c = right_rim * (1.0 + 0.025 * (i + 1)) + rng.uniform(-0.2, 0.2)
            new_o = new_c + rng.uniform(-0.3, 0.3)
            new_h = max(new_c, new_o) + abs(rng.uniform(0.3, 0.8))
            new_l = min(new_c, new_o) - abs(rng.uniform(0, 0.3))
            v = preamble_vol * 2.0
            bars.append({"t": t, "o": round(new_o, 2), "h": round(new_h, 2),
                         "l": round(new_l, 2), "c": round(new_c, 2), "v": round(v, 0)})
            t += 86400
        return bars

    if has_handle or already_broken:
        return bars

    # Default tail: a few flat bars just below the right rim so that right_rim
    # registers as a local-maximum swing-high pivot. The bars are clearly
    # within the 6% "no handle" tolerance so the detector still treats this
    # as a clean rounded base.
    tail_bars = 4
    tail_target = right_rim * 0.985  # 1.5% below rim - within no-handle tolerance
    for i in range(tail_bars):
        c = tail_target + rng.uniform(-0.15, 0.15)
        o = tail_target + rng.uniform(-0.15, 0.15)
        h = max(c, o) + abs(rng.uniform(0, 0.25))
        l = min(c, o) - abs(rng.uniform(0, 0.25))
        v = preamble_vol * 1.2 * rng.uniform(0.9, 1.1)
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
    _write("clean_rounded_base", "positive",
           dict(bars_count=60, left_rim=100.0, base_bottom=80.0, right_rim=100.0,
                seed=1),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "cup_curve"})

    _write("longer_base", "positive",
           dict(bars_count=90, left_rim=80.0, base_bottom=64.0, right_rim=80.0,
                seed=2),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("textbook_depth", "positive",
           dict(bars_count=60, left_rim=120.0, base_bottom=96.0, right_rim=120.0,
                seed=3),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("deep_base", "positive",
           dict(bars_count=70, left_rim=60.0, base_bottom=42.0, right_rim=60.0,
                seed=4),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("perfect_setup", "positive",
           dict(bars_count=55, left_rim=200.0, base_bottom=160.0, right_rim=200.0,
                seed=5),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})

    # NEGATIVE -------------------------------------------------------------------
    _write("v_shape_not_rounded", "negative",
           dict(bars_count=60, left_rim=100.0, base_bottom=80.0, right_rim=100.0,
                v_shape=True, seed=10),
           {"fires": False})

    _write("has_handle", "negative",
           dict(bars_count=55, left_rim=100.0, base_bottom=80.0, right_rim=100.0,
                has_handle=True, seed=11),
           {"fires": False})

    _write("no_curve", "negative",
           dict(bars_count=60, left_rim=100.0, base_bottom=85.0, right_rim=100.0,
                no_curve=True, seed=12),
           {"fires": False})

    _write("shallow_depth", "negative",
           dict(bars_count=60, left_rim=100.0, base_bottom=95.0, right_rim=100.0,
                shallow=True, seed=13),
           {"fires": False})

    _write("pattern_too_short", "negative",
           dict(bars_count=20, left_rim=100.0, base_bottom=80.0, right_rim=100.0,
                seed=14),
           {"fires": False})

    _write("choppy_no_structure", "negative",
           dict(bars_count=60, left_rim=100.0, base_bottom=80.0, right_rim=100.0,
                choppy=True, seed=15),
           {"fires": False})

    _write("rim_mismatch", "negative",
           dict(bars_count=60, left_rim=100.0, base_bottom=80.0, right_rim=100.0,
                rim_mismatch=True, seed=16),
           {"fires": False})

    _write("inverted_shape", "negative",
           dict(bars_count=60, left_rim=100.0, base_bottom=80.0, right_rim=100.0,
                inverted=True, seed=17),
           {"fires": False})

    # EDGE -----------------------------------------------------------------------
    _write("boundary_min_bars", "edge",
           dict(bars_count=32, left_rim=100.0, base_bottom=85.0, right_rim=100.0,
                seed=20),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0})

    _write("near_max_length", "edge",
           dict(bars_count=115, left_rim=50.0, base_bottom=40.0, right_rim=50.0,
                seed=21),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
