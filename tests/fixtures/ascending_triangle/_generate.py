"""One-shot generator for the ascending_triangle fixture battery.

Run: python tests/fixtures/ascending_triangle/_generate.py

Ascending triangle = flat horizontal resistance top + rising support trendline,
converging toward an apex. Bullish continuation.
"""
import json
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _build_bars(bars_count, flat_top, lower_start, lower_end,
                volume_pattern="contracting", preamble_bars=10,
                no_flat_top=False, both_rising=False, choppy=False,
                flat_noise=False, already_broken=False, descending=False,
                seed=42):
    """Build a synthetic OHLCV series for an ascending-triangle candidate.

    Args:
      bars_count: pattern bars
      flat_top: horizontal resistance price
      lower_start: support price at start of pattern
      lower_end: support price at end of pattern (must be > lower_start
                 for rising)
      volume_pattern: contracting / expanding / flat / strong_contracting
      no_flat_top: highs vary widely instead of clustering
      both_rising: makes upper line also rise (a channel, not triangle)
      choppy: large noise on bodies
      flat_noise: pure noisy flat data (no structure)
      already_broken: last 3 bars break above flat_top
      descending: mirror geometry (flat bottom + falling resistance)
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000

    if bars_count <= 1:
        bars_count = 2

    upper_slope = 0.0
    if both_rising:
        upper_slope = (flat_top * 0.20) / (bars_count - 1)  # 20% rise = clearly rising channel

    lower_slope = (lower_end - lower_start) / max(bars_count - 1, 1)

    # 1. Preamble: a few bars BELOW the pattern entry area
    preamble_base = lower_start * 0.92
    preamble_target = (flat_top + lower_start) / 2.0
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
            base = (flat_top + lower_start) / 2.0
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
        # Pure random-walk choppy data — no embedded triangle structure.
        price = (flat_top + lower_start) / 2.0
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

    # 2. Pattern bars: alternate touches on the flat top and on the rising support
    for i in range(bars_count):
        upper_i = flat_top + upper_slope * i
        if descending:
            # Descending: flat bottom + falling resistance
            falling_top = flat_top - (i / max(bars_count - 1, 1)) * (flat_top - lower_end) * 1.0
            upper_i = falling_top
            lower_i = lower_start  # acts as flat bottom
        else:
            lower_i = lower_start + lower_slope * i

        if no_flat_top:
            # Highs follow a deterministic stair-step pattern that ensures no
            # two consecutive swing-high pivots land within 2% of each other.
            # Use a wide sine envelope so highs roller-coaster between 80% and
            # 115% of flat_top.
            import math
            wave = math.sin(i * 0.5) * 0.15
            upper_i = flat_top * (1.0 + wave + rng.uniform(-0.03, 0.03))

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

        if choppy:
            c += rng.uniform(-3.5, 3.5)
            o += rng.uniform(-3.5, 3.5)
            h = max(h, c, o) + abs(rng.uniform(0, 1.0))
            l = min(l, c, o) - abs(rng.uniform(0, 1.0))
            v_factor *= rng.uniform(0.5, 1.5)

        frac = i / max(bars_count - 1, 1)
        v = (vol_start * (1 - frac) + vol_end * frac) * v_factor * rng.uniform(0.9, 1.1)

        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += 86400

    if already_broken:
        # Long, strong rip above the flat top - plants new staircase pivots
        # well above the original flat top so the highest-cluster is no longer
        # flat (and the lower-trendline-to-flat-top gap math no longer holds).
        last_c = bars[-1]["c"]
        for i in range(15):
            # Staircase up: each bar zigzags upward by ~3-5% per pair
            zig = 1.5 if i % 2 == 0 else -0.5
            step = (flat_top * 0.08) * (i + 1) / 5.0
            new_c = flat_top + step + zig + rng.uniform(-0.20, 0.20)
            new_o = new_c + rng.uniform(-0.30, 0.30)
            new_h = max(new_c, new_o) + abs(rng.uniform(0.5, 1.2))
            new_l = min(new_c, new_o) - abs(rng.uniform(0, 0.40))
            v = preamble_vol * 2.5
            bars.append({"t": t, "o": round(new_o, 2), "h": round(new_h, 2),
                         "l": round(new_l, 2), "c": round(new_c, 2), "v": round(v, 0)})
            last_c = new_c
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
           dict(bars_count=40, flat_top=100.0, lower_start=90.0, lower_end=98.5,
                volume_pattern="contracting", seed=1),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "trendline_pair"})

    _write("longer_pattern", "positive",
           dict(bars_count=55, flat_top=120.0, lower_start=104.0, lower_end=117.0,
                volume_pattern="contracting", seed=2),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("tight_convergence", "positive",
           dict(bars_count=35, flat_top=80.0, lower_start=72.0, lower_end=79.0,
                volume_pattern="contracting", seed=3),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("strong_volume_contraction", "positive",
           dict(bars_count=40, flat_top=150.0, lower_start=135.0, lower_end=148.0,
                volume_pattern="strong_contracting", seed=4),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})

    _write("perfect_setup", "positive",
           dict(bars_count=30, flat_top=60.0, lower_start=53.0, lower_end=58.8,
                volume_pattern="strong_contracting", seed=5),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})

    # NEGATIVE -------------------------------------------------------------------
    _write("no_flat_top", "negative",
           dict(bars_count=40, flat_top=100.0, lower_start=90.0, lower_end=98.0,
                volume_pattern="contracting", no_flat_top=True, seed=10),
           {"fires": False})

    _write("no_rising_lows", "negative",
           dict(bars_count=40, flat_top=100.0, lower_start=92.0, lower_end=92.0,
                volume_pattern="contracting", seed=11),
           {"fires": False})

    _write("both_lines_rising", "negative",
           dict(bars_count=40, flat_top=100.0, lower_start=92.0, lower_end=99.0,
                volume_pattern="contracting", both_rising=True, seed=12),
           {"fires": False})

    _write("pattern_too_short", "negative",
           dict(bars_count=12, flat_top=100.0, lower_start=92.0, lower_end=98.5,
                volume_pattern="contracting", seed=13),
           {"fires": False})

    _write("no_pattern_flat", "negative",
           dict(bars_count=40, flat_top=100.0, lower_start=92.0, lower_end=98.0,
                flat_noise=True, seed=14),
           {"fires": False})

    _write("descending_shape", "negative",
           dict(bars_count=40, flat_top=100.0, lower_start=92.0, lower_end=88.0,
                volume_pattern="contracting", descending=True, seed=15),
           {"fires": False})

    _write("choppy_no_structure", "negative",
           dict(bars_count=40, flat_top=100.0, lower_start=92.0, lower_end=98.0,
                volume_pattern="expanding", choppy=True, seed=16),
           {"fires": False})

    _write("already_broken_out", "negative",
           dict(bars_count=40, flat_top=100.0, lower_start=92.0, lower_end=99.0,
                volume_pattern="contracting", already_broken=True, seed=17),
           {"fires": False})

    # EDGE -----------------------------------------------------------------------
    _write("boundary_min_touches", "edge",
           dict(bars_count=22, flat_top=100.0, lower_start=92.0, lower_end=98.5,
                volume_pattern="contracting", seed=20),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0})

    _write("boundary_wider_gap", "edge",
           dict(bars_count=35, flat_top=100.0, lower_start=88.0, lower_end=96.0,
                volume_pattern="contracting", seed=21),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
