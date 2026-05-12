"""One-shot generator for the pennant fixture battery.

Run: python tests/fixtures/pennant/_generate.py

Pennants are converging triangles. The generator builds:
  base -> pole (up OR down) -> pennant whose upper line slopes down + lower line
  slopes up, with controllable convergence (width_end / width_start).
"""
import json
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _build_bars(base_price, base_bars, pole_pct, pole_bars, pole_direction,
                pennant_bars, width_start_pct, width_end_pct,
                pennant_volume_ratio=0.4, choppy_pennant=False,
                parallel=False, ascending_lines=False, descending_lines=False,
                pole_volume_ramp=True, seed=42):
    """Build a synthetic OHLCV series with base + pole + converging pennant.

    Args:
      pole_direction: "up" or "down"
      pole_pct: positive fraction (e.g. 0.18 = 18% move in pole_direction)
      width_start_pct: pennant width at first pennant bar, as fraction of pole_apex_price
      width_end_pct: pennant width at last pennant bar, as fraction of pole_apex_price
                     Must be < width_start_pct for convergence.
      parallel: if True, force width_end = width_start (a flag, not a pennant)
      ascending_lines: if True, both upper and lower slope up (an upward channel)
      descending_lines: if True, both upper and lower slope down (a downward channel)
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    base_vol = 1000.0

    # 1. Base
    price = base_price
    for _ in range(base_bars):
        c = price + rng.uniform(-0.15, 0.15)
        h = c + abs(rng.uniform(0, 0.18))
        l = c - abs(rng.uniform(0, 0.18))
        o = price + rng.uniform(-0.10, 0.10)
        v = base_vol * rng.uniform(0.8, 1.2)
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += 86400

    pole_start_price = bars[-1]["c"] if bars else base_price

    # 2. Pole
    if pole_bars > 0 and pole_pct > 0:
        sign = 1.0 if pole_direction == "up" else -1.0
        pole_end_price = pole_start_price * (1.0 + sign * pole_pct)
        pole_step = (pole_end_price - pole_start_price) / pole_bars
        for i in range(pole_bars):
            c = pole_start_price + pole_step * (i + 1) + rng.uniform(-0.05, 0.05)
            o = pole_start_price + pole_step * i + rng.uniform(-0.05, 0.05)
            h = max(c, o) + abs(rng.uniform(0, 0.10))
            l = min(c, o) - abs(rng.uniform(0, 0.10))
            v = base_vol * (2 + i * 0.3) if pole_volume_ramp else base_vol * 2.5
            bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
            t += 86400
        pole_apex_price = bars[-1]["c"]
    else:
        pole_apex_price = pole_start_price

    # 3. Pennant — designed channel.
    # Widths are scaled by the LARGER of (pole_height, pole_apex_price * width_start_pct)
    # so the pennant never spans more than the pole itself. This avoids creating
    # synthetic pivots BELOW the pole base (bullish) or ABOVE the pole base (bearish)
    # which would otherwise mislead the detector for tiny-pole negative fixtures.
    pole_height = abs(pole_apex_price - pole_start_price)
    natural_unit = pole_apex_price * width_start_pct
    # Clamp: width_s never exceeds the pole's own height (forces small width
    # for small poles).
    if pole_height > 0:
        width_s = min(natural_unit, pole_height * 0.55)
    else:
        width_s = natural_unit
    if parallel:
        width_e = width_s
    else:
        # scale width_e proportionally so the ratio is preserved
        target_ratio = width_end_pct / width_start_pct if width_start_pct > 0 else 0.5
        width_e = width_s * target_ratio

    pennant_avg_vol = base_vol * 2.5 * pennant_volume_ratio

    for i in range(pennant_bars):
        frac = i / max(pennant_bars - 1, 1)
        width_i = width_s * (1 - frac) + width_e * frac

        # Anchor the pennant slightly INSIDE the pole's apex range so that the
        # final pole bar is preserved as a swing pivot. For UP pole, keep upper
        # line a small margin below pole_apex_price (otherwise pennant bar 0's
        # high may exceed it and the swing-high pivot lands on bar 0 of the
        # pennant rather than at the pole top — which still works for bullish
        # but breaks bearish). For DOWN pole, keep lower line a margin above
        # pole_apex_price.
        anchor_margin = pole_apex_price * 0.005
        if pole_direction == "up":
            # Upper line starts at pole_apex_price - margin (so highs stay <= pole top).
            # Lower line starts ~width_s below.
            upper_at_start = pole_apex_price - anchor_margin
            lower_at_start = pole_apex_price - width_s
            upper_at_end   = pole_apex_price - anchor_margin - (width_s - width_e) / 2.0
            lower_at_end   = pole_apex_price - width_s + (width_s - width_e) / 2.0
        else:
            # Pole down: pole_apex_price = pole bottom.
            # Lower line starts at pole_apex + margin, slopes UP. Upper at ~width_s above.
            upper_at_start = pole_apex_price + width_s
            lower_at_start = pole_apex_price + anchor_margin
            upper_at_end   = pole_apex_price + width_s - (width_s - width_e) / 2.0
            lower_at_end   = pole_apex_price + anchor_margin + (width_s - width_e) / 2.0

        upper = upper_at_start * (1 - frac) + upper_at_end * frac
        lower = lower_at_start * (1 - frac) + lower_at_end * frac

        if ascending_lines:
            shift = pole_apex_price * 0.005 * i
            upper += shift
            lower += shift
        elif descending_lines:
            shift = pole_apex_price * 0.005 * i
            upper -= shift
            lower -= shift

        # body inside the channel
        if upper - lower > 0.05:
            c = rng.uniform(lower + 0.02, upper - 0.02)
            o = rng.uniform(lower + 0.02, upper - 0.02)
        else:
            c = (upper + lower) / 2.0
            o = (upper + lower) / 2.0

        if choppy_pennant:
            c += rng.uniform(-1.5, 1.5)
            o += rng.uniform(-1.5, 1.5)

        h = max(c, o, upper) + abs(rng.uniform(0, 0.04))
        l = min(c, o, lower) - abs(rng.uniform(0, 0.04))
        v = pennant_avg_vol * rng.uniform(0.8, 1.2)
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
    # 5 POSITIVE
    _write("bullish_clean", "positive",
           dict(base_price=50.0, base_bars=20, pole_pct=0.18, pole_bars=10, pole_direction="up",
                pennant_bars=7, width_start_pct=0.10, width_end_pct=0.04,
                pennant_volume_ratio=0.35, seed=1),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "trendline_pair"})

    _write("bearish_clean", "positive",
           dict(base_price=100.0, base_bars=20, pole_pct=0.18, pole_bars=10, pole_direction="down",
                pennant_bars=7, width_start_pct=0.10, width_end_pct=0.04,
                pennant_volume_ratio=0.35, seed=2),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("bullish_tight", "positive",
           dict(base_price=80.0, base_bars=20, pole_pct=0.22, pole_bars=12, pole_direction="up",
                pennant_bars=8, width_start_pct=0.08, width_end_pct=0.02,
                pennant_volume_ratio=0.3, seed=3),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})

    _write("bullish_extended_pole", "positive",
           dict(base_price=30.0, base_bars=20, pole_pct=0.28, pole_bars=14, pole_direction="up",
                pennant_bars=6, width_start_pct=0.09, width_end_pct=0.03,
                pennant_volume_ratio=0.4, seed=4),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})

    _write("bearish_volume_contraction", "positive",
           dict(base_price=200.0, base_bars=20, pole_pct=0.20, pole_bars=10, pole_direction="down",
                pennant_bars=8, width_start_pct=0.10, width_end_pct=0.035,
                pennant_volume_ratio=0.20, seed=5),
           {"fires": True, "min_confidence": 65.0, "max_confidence": 100.0})

    # 8 NEGATIVE
    _write("no_pole", "negative",
           dict(base_price=50.0, base_bars=40, pole_pct=0.0, pole_bars=0, pole_direction="up",
                pennant_bars=8, width_start_pct=0.10, width_end_pct=0.04,
                pennant_volume_ratio=0.5, seed=10),
           {"fires": False})

    _write("pole_too_small", "negative",
           dict(base_price=50.0, base_bars=20, pole_pct=0.04, pole_bars=10, pole_direction="up",
                pennant_bars=8, width_start_pct=0.10, width_end_pct=0.04,
                pennant_volume_ratio=0.4, seed=11),
           {"fires": False})

    _write("parallel_not_converging", "negative",
           dict(base_price=50.0, base_bars=20, pole_pct=0.18, pole_bars=10, pole_direction="up",
                pennant_bars=8, width_start_pct=0.10, width_end_pct=0.10,
                parallel=True, pennant_volume_ratio=0.4, seed=12),
           {"fires": False})

    # apex_too_far: very gentle convergence (large width_end) so apex is many bars ahead
    _write("apex_too_far", "negative",
           dict(base_price=50.0, base_bars=20, pole_pct=0.18, pole_bars=10, pole_direction="up",
                pennant_bars=5, width_start_pct=0.10, width_end_pct=0.085,
                pennant_volume_ratio=0.4, seed=13),
           {"fires": False})

    # apex_already_passed: huge convergence so lines cross before the last bar
    _write("apex_already_passed", "negative",
           dict(base_price=50.0, base_bars=20, pole_pct=0.18, pole_bars=10, pole_direction="up",
                pennant_bars=15, width_start_pct=0.12, width_end_pct=-0.04,
                pennant_volume_ratio=0.4, seed=14),
           {"fires": False})

    _write("too_wide", "negative",
           dict(base_price=50.0, base_bars=20, pole_pct=0.18, pole_bars=10, pole_direction="up",
                pennant_bars=8, width_start_pct=0.10, width_end_pct=0.075,
                pennant_volume_ratio=0.4, seed=15),
           {"fires": False})

    _write("choppy", "negative",
           dict(base_price=50.0, base_bars=20, pole_pct=0.18, pole_bars=10, pole_direction="up",
                pennant_bars=10, width_start_pct=0.12, width_end_pct=0.05,
                choppy_pennant=True, pennant_volume_ratio=1.2, seed=16),
           {"fires": False})

    _write("extended_pennant", "negative",
           dict(base_price=50.0, base_bars=20, pole_pct=0.18, pole_bars=10, pole_direction="up",
                pennant_bars=40, width_start_pct=0.10, width_end_pct=0.04,
                pennant_volume_ratio=0.5, seed=17),
           {"fires": False})

    # 2 EDGE
    _write("boundary_min_convergence", "edge",
           dict(base_price=50.0, base_bars=20, pole_pct=0.18, pole_bars=10, pole_direction="up",
                pennant_bars=8, width_start_pct=0.10, width_end_pct=0.052,
                pennant_volume_ratio=0.4, seed=20),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 85.0})

    _write("boundary_apex_at_30", "edge",
           dict(base_price=50.0, base_bars=20, pole_pct=0.18, pole_bars=10, pole_direction="up",
                pennant_bars=6, width_start_pct=0.10, width_end_pct=0.05,
                pennant_volume_ratio=0.4, seed=21),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 85.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
