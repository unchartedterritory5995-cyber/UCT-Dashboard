"""One-shot generator for the channel fixture battery.

Run: python tests/fixtures/channel/_generate.py

Channel = two parallel trendlines (both rising / both falling / both flat)
containing sustained price action. Direction follows slope.
"""
import json
import math
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _build_bars(bars_count, start_upper, start_lower, end_upper, end_lower,
                volume_pattern="contracting", preamble_bars=10,
                noisy_outside=False, diverging=False, narrow=False,
                deep_violations=False, choppy=False, only_one_side=False,
                seed=42):
    """Synthetic OHLCV with two parallel-ish lines bounding the bars.

    Pattern bars oscillate between the upper and lower line.
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000

    if bars_count <= 1:
        bars_count = 2

    # 1. Preamble
    pre_target = (start_upper + start_lower) / 2.0
    preamble_vol = 1500.0
    for i in range(preamble_bars):
        c = pre_target + rng.uniform(-0.4, 0.4)
        o = pre_target + rng.uniform(-0.4, 0.4)
        h = max(c, o) + abs(rng.uniform(0, 0.4))
        l = min(c, o) - abs(rng.uniform(0, 0.4))
        v = preamble_vol * rng.uniform(0.8, 1.2)
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += 86400

    if volume_pattern == "contracting":
        vol_start = preamble_vol * 1.3
        vol_end = preamble_vol * 0.7
    elif volume_pattern == "expanding":
        vol_start = preamble_vol * 0.6
        vol_end = preamble_vol * 1.5
    else:
        vol_start = preamble_vol
        vol_end = preamble_vol

    upper_slope = (end_upper - start_upper) / max(bars_count - 1, 1)
    lower_slope = (end_lower - start_lower) / max(bars_count - 1, 1)

    for i in range(bars_count):
        upper_i = start_upper + upper_slope * i
        lower_i = start_lower + lower_slope * i
        if diverging:
            # Widen the lower line downward to break parallelism
            lower_i = start_lower - i * 0.4
        if narrow:
            # Reduce channel width to fall under depth threshold
            mid = (upper_i + lower_i) / 2.0
            half = (upper_i - lower_i) / 2.0
            upper_i = mid + half * 0.3
            lower_i = mid - half * 0.3

        phase = i % 4
        if phase == 0:
            # Touch upper
            mid = (upper_i + lower_i) / 2.0
            c = mid + rng.uniform(-0.2, 0.2)
            o = mid + rng.uniform(-0.2, 0.2)
            h = upper_i + abs(rng.uniform(-0.05, 0.05))
            l = min(c, o) - abs(rng.uniform(0, 0.1))
            v_factor = 1.1
        elif phase == 2:
            # Touch lower
            mid = (upper_i + lower_i) / 2.0
            c = mid + rng.uniform(-0.2, 0.2)
            o = mid + rng.uniform(-0.2, 0.2)
            h = max(c, o) + abs(rng.uniform(0, 0.1))
            l = lower_i - abs(rng.uniform(-0.05, 0.05))
            v_factor = 1.1
        else:
            mid = (upper_i + lower_i) / 2.0
            c = mid + rng.uniform(-0.3, 0.3)
            o = mid + rng.uniform(-0.3, 0.3)
            h = max(c, o) + abs(rng.uniform(0, 0.2))
            l = min(c, o) - abs(rng.uniform(0, 0.2))
            v_factor = 1.0

        if noisy_outside:
            # Most bars wildly violate the channel envelope
            if i % 2 == 0:
                h = upper_i + abs(rng.uniform(4.0, 8.0))
                c = upper_i + abs(rng.uniform(2.0, 4.0))
            if i % 3 == 0:
                l = lower_i - abs(rng.uniform(4.0, 8.0))
                c = lower_i - abs(rng.uniform(2.0, 4.0))
            o = c + rng.uniform(-0.5, 0.5)

        if deep_violations:
            if i % 3 == 0:
                h = upper_i + abs(rng.uniform(5.0, 10.0))
                c = h - 0.3

        if choppy:
            # Random walk - decouple from the channel structure entirely.
            if not hasattr(rng, '_choppy_price'):
                rng._choppy_price = (start_upper + start_lower) / 2.0
            rng._choppy_price += rng.uniform(-3.5, 3.5)
            c = rng._choppy_price + rng.uniform(-1.5, 1.5)
            o = rng._choppy_price + rng.uniform(-1.5, 1.5)
            h = max(c, o) + abs(rng.uniform(1.0, 4.0))
            l = min(c, o) - abs(rng.uniform(1.0, 4.0))
            v_factor *= rng.uniform(0.4, 1.8)

        if only_one_side:
            # Force highs/lows to only touch the upper line, never the lower
            l = (upper_i + lower_i) / 2.0 - 0.1
            c = (upper_i + lower_i) / 2.0
            o = c + rng.uniform(-0.1, 0.1)

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
    _write("clean_ascending", "positive",
           dict(bars_count=50, start_upper=100.0, start_lower=90.0,
                end_upper=115.0, end_lower=105.0, seed=1),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "trendline_pair"})

    _write("clean_descending", "positive",
           dict(bars_count=50, start_upper=120.0, start_lower=110.0,
                end_upper=105.0, end_lower=95.0, seed=2),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("clean_horizontal", "positive",
           dict(bars_count=50, start_upper=100.0, start_lower=90.0,
                end_upper=100.2, end_lower=90.2, seed=3),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("longer_ascending", "positive",
           dict(bars_count=70, start_upper=80.0, start_lower=72.0,
                end_upper=98.0, end_lower=90.0, seed=4),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("tight_horizontal_band", "positive",
           dict(bars_count=45, start_upper=200.0, start_lower=180.0,
                end_upper=200.0, end_lower=180.0, seed=5),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    # NEGATIVE -------------------------------------------------------------------
    _write("pattern_too_short", "negative",
           dict(bars_count=15, start_upper=100.0, start_lower=90.0,
                end_upper=110.0, end_lower=100.0, seed=10),
           {"fires": False})

    _write("diverging_lines", "negative",
           dict(bars_count=50, start_upper=100.0, start_lower=92.0,
                end_upper=115.0, end_lower=80.0, diverging=True, seed=11),
           {"fires": False})

    _write("too_narrow", "negative",
           dict(bars_count=50, start_upper=100.0, start_lower=99.5,
                end_upper=101.0, end_lower=100.5, narrow=True, seed=12),
           {"fires": False})

    _write("noisy_outside", "negative",
           dict(bars_count=50, start_upper=100.0, start_lower=90.0,
                end_upper=110.0, end_lower=100.0, noisy_outside=True,
                deep_violations=True, seed=13),
           {"fires": False})

    _write("choppy_no_structure", "negative",
           dict(bars_count=50, start_upper=100.0, start_lower=90.0,
                end_upper=110.0, end_lower=100.0, choppy=True, seed=14),
           {"fires": False})

    _write("only_upper_tested", "negative",
           dict(bars_count=50, start_upper=100.0, start_lower=80.0,
                end_upper=110.0, end_lower=90.0, only_one_side=True, seed=15),
           {"fires": False})

    _write("opposite_slopes", "negative",
           dict(bars_count=50, start_upper=100.0, start_lower=80.0,
                end_upper=85.0, end_lower=95.0, seed=16),
           {"fires": False})

    _write("too_wide_pattern", "negative",
           dict(bars_count=50, start_upper=100.0, start_lower=20.0,
                end_upper=110.0, end_lower=30.0, seed=17),
           {"fires": False})

    # EDGE -----------------------------------------------------------------------
    _write("boundary_min_bars", "edge",
           dict(bars_count=26, start_upper=100.0, start_lower=92.0,
                end_upper=108.0, end_lower=100.0, seed=20),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0})

    _write("max_length_pattern", "edge",
           dict(bars_count=78, start_upper=50.0, start_lower=45.0,
                end_upper=60.0, end_lower=55.0, seed=21),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
