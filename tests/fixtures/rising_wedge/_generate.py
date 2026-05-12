"""One-shot generator for the rising_wedge fixture battery.

Run: python tests/fixtures/rising_wedge/_generate.py

A rising wedge is a consolidation where BOTH trendlines slope UP, with the
upper line rising LESS STEEPLY than the lower, so they converge upward
toward an apex. Bearish reversal/continuation.

Generator builds a synthetic OHLCV series with:
  preamble (a few bars of context) -> wedge_bars ascending channel with
  controllable upper/lower slope %s and convergence ratio.
"""
import json
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _build_bars(bars_count, start_low, depth_pct, convergence_ratio,
                upper_slope_pct_per_bar=None, lower_slope_pct_per_bar=None,
                volume_pattern="contracting", preamble_bars=10,
                upper_negative=False, lower_negative=False,
                channel_parallel=False, choppy=False, flat=False,
                seed=42):
    """Build a synthetic OHLCV series for a rising-wedge candidate.

    Args:
      bars_count: number of wedge bars (the consolidation period)
      start_low: bottom of the wedge at start (the lower trendline's start price)
      depth_pct: (end_high - start_low) / start_low; controls overall range
      convergence_ratio: width_end / width_start
      upper_slope_pct_per_bar: if provided, overrides the upper slope.
                                Positive = rising. As fraction of start_low.
      lower_slope_pct_per_bar: same, for lower line. Rising wedge: must be
                                more positive than upper_slope.
      volume_pattern: "contracting" / "expanding" / "flat"
      preamble_bars: bars before the wedge (provides pivot context)
      upper_negative: force upper slope < 0 (invalid for rising wedge)
      lower_negative: force lower slope << 0 (invalid)
      channel_parallel: upper.slope == lower.slope (a channel, not wedge)
      choppy: add large noise to bodies
      flat: produce purely flat noisy data (no wedge structure)
      seed: RNG seed
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000

    # Compute end_high from depth_pct
    end_high = start_low * (1.0 + depth_pct)

    # Width at start (defines upper_at_start). Pick a reasonable starting width.
    width_start = start_low * 0.10
    upper_at_start = start_low + width_start

    # Auto-compute slopes for clean wedge if not provided.
    # Lower line goes from start_low -> some end_low.
    # Upper line goes from upper_at_start -> end_high.
    # width_end = end_high - end_low = convergence_ratio * width_start
    # so end_low = end_high - convergence_ratio * width_start
    width_end = convergence_ratio * width_start
    end_low_default = end_high - width_end

    if bars_count <= 1:
        bars_count = 2
    if upper_slope_pct_per_bar is None:
        # default slope per bar (price units per bar / start_low)
        upper_slope = (end_high - upper_at_start) / (bars_count - 1)
    else:
        upper_slope = upper_slope_pct_per_bar * start_low

    if lower_slope_pct_per_bar is None:
        lower_slope = (end_low_default - start_low) / (bars_count - 1)
    else:
        lower_slope = lower_slope_pct_per_bar * start_low

    if upper_negative:
        upper_slope = -abs(upper_slope_pct_per_bar or 0.003) * start_low
    if lower_negative:
        lower_slope = -abs(lower_slope_pct_per_bar or 0.005) * start_low
    if channel_parallel:
        # Force both slopes equal -> parallel channel (not converging).
        lower_slope = upper_slope

    # 1. Preamble: a few bars of context below the wedge bottom to provide pivots.
    preamble_price = start_low * 0.96
    preamble_vol = 1500.0
    for i in range(preamble_bars):
        # mild ascent toward wedge start
        target = start_low * 0.96 + (start_low - start_low * 0.96) * (i / max(preamble_bars - 1, 1))
        c = target + rng.uniform(-0.20, 0.20)
        o = target + rng.uniform(-0.20, 0.20)
        h = max(c, o) + abs(rng.uniform(0, 0.30))
        l = min(c, o) - abs(rng.uniform(0, 0.30))
        v = preamble_vol * rng.uniform(0.8, 1.2)
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += 86400

    if flat:
        # produce noisy flat data instead of a wedge
        for i in range(bars_count):
            base = start_low
            c = base + rng.uniform(-1.5, 1.5)
            o = base + rng.uniform(-1.5, 1.5)
            h = max(c, o) + abs(rng.uniform(0, 0.8))
            l = min(c, o) - abs(rng.uniform(0, 0.8))
            v = preamble_vol * rng.uniform(0.7, 1.3)
            bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
            t += 86400
        return bars

    # 2. Wedge bars
    if volume_pattern == "contracting":
        vol_start = preamble_vol * 1.5
        vol_end = preamble_vol * 0.4
    elif volume_pattern == "expanding":
        vol_start = preamble_vol * 0.5
        vol_end = preamble_vol * 1.5
    elif volume_pattern == "strong_contracting":
        vol_start = preamble_vol * 2.0
        vol_end = preamble_vol * 0.2
    else:
        vol_start = preamble_vol
        vol_end = preamble_vol

    # We need swing pivots to land on the trendlines. We'll do that by making
    # specific bars touch the lines (oscillating bars hit upper, others hit
    # lower) so detect_pivots finds them.
    for i in range(bars_count):
        upper_i = upper_at_start + upper_slope * i
        lower_i = start_low + lower_slope * i

        # Alternate which line the bar touches, so we get a clear zig-zag with
        # pivots on both lines. Bars at indices 1,5,9... touch upper; 3,7,11... touch lower.
        phase = i % 4
        if phase == 1:
            # touch upper: bar high = upper_i, body mid-channel
            mid = (upper_i + lower_i) / 2
            c = mid + rng.uniform(-0.05, 0.05)
            o = mid + rng.uniform(-0.05, 0.05)
            h = upper_i + abs(rng.uniform(0, 0.02))
            l = min(c, o) - abs(rng.uniform(0, 0.05))
            v_factor = 1.2
        elif phase == 3:
            # touch lower: bar low = lower_i
            mid = (upper_i + lower_i) / 2
            c = mid + rng.uniform(-0.05, 0.05)
            o = mid + rng.uniform(-0.05, 0.05)
            h = max(c, o) + abs(rng.uniform(0, 0.05))
            l = lower_i - abs(rng.uniform(0, 0.02))
            v_factor = 1.1
        else:
            mid = (upper_i + lower_i) / 2
            c = mid + rng.uniform(-0.10, 0.10)
            o = mid + rng.uniform(-0.10, 0.10)
            h = max(c, o) + abs(rng.uniform(0, 0.10))
            l = min(c, o) - abs(rng.uniform(0, 0.10))
            v_factor = 1.0

        if choppy:
            c += rng.uniform(-2.5, 2.5)
            o += rng.uniform(-2.5, 2.5)
            h = max(h, c, o) + abs(rng.uniform(0, 1.0))
            l = min(l, c, o) - abs(rng.uniform(0, 1.0))
            v_factor *= rng.uniform(0.5, 1.5)

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
    # 5 POSITIVE -----------------------------------------------------------------
    _write("clean_textbook", "positive",
           dict(bars_count=40, start_low=100.0, depth_pct=0.25,
                convergence_ratio=0.40, volume_pattern="contracting", seed=1),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "trendline_pair"})

    _write("tight_wedge", "positive",
           dict(bars_count=30, start_low=80.0, depth_pct=0.30,
                convergence_ratio=0.30, volume_pattern="contracting", seed=2),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("long_wedge", "positive",
           dict(bars_count=55, start_low=120.0, depth_pct=0.20,
                convergence_ratio=0.50, volume_pattern="contracting", seed=3),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("shallow_wedge", "positive",
           dict(bars_count=25, start_low=60.0, depth_pct=0.12,
                convergence_ratio=0.45, volume_pattern="contracting", seed=4),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})

    _write("strong_volume_contraction", "positive",
           dict(bars_count=40, start_low=150.0, depth_pct=0.25,
                convergence_ratio=0.35, volume_pattern="strong_contracting", seed=5),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})

    # 8 NEGATIVE ------------------------------------------------------------------
    _write("no_wedge", "negative",
           dict(bars_count=40, start_low=100.0, depth_pct=0.0,
                convergence_ratio=1.0, volume_pattern="flat", flat=True, seed=10),
           {"fires": False})

    _write("depth_too_shallow", "negative",
           dict(bars_count=40, start_low=100.0, depth_pct=0.05,
                convergence_ratio=0.50, volume_pattern="contracting", seed=11),
           {"fires": False})

    _write("depth_too_deep", "negative",
           dict(bars_count=40, start_low=100.0, depth_pct=0.70,
                convergence_ratio=0.40, volume_pattern="contracting", seed=12),
           {"fires": False})

    _write("parallel_not_converging", "negative",
           dict(bars_count=40, start_low=100.0, depth_pct=0.25,
                convergence_ratio=1.0, channel_parallel=True,
                volume_pattern="contracting", seed=13),
           {"fires": False})

    _write("upper_falling", "negative",
           dict(bars_count=40, start_low=100.0, depth_pct=0.20,
                convergence_ratio=0.40, upper_negative=True,
                upper_slope_pct_per_bar=0.003,
                volume_pattern="contracting", seed=14),
           {"fires": False})

    _write("lower_falling_steeply", "negative",
           dict(bars_count=40, start_low=100.0, depth_pct=0.20,
                convergence_ratio=0.40, lower_negative=True,
                lower_slope_pct_per_bar=0.005,
                volume_pattern="contracting", seed=15),
           {"fires": False})

    _write("wedge_too_short", "negative",
           dict(bars_count=15, start_low=100.0, depth_pct=0.20,
                convergence_ratio=0.40, volume_pattern="contracting", seed=16),
           {"fires": False})

    _write("choppy_noise", "negative",
           dict(bars_count=40, start_low=100.0, depth_pct=0.25,
                convergence_ratio=0.50, choppy=True,
                volume_pattern="expanding", seed=17),
           {"fires": False})

    # 2 EDGE ---------------------------------------------------------------------
    _write("boundary_min_depth", "edge",
           dict(bars_count=40, start_low=100.0, depth_pct=0.105,
                convergence_ratio=0.50, volume_pattern="contracting", seed=20),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 85.0})

    _write("boundary_min_convergence", "edge",
           dict(bars_count=40, start_low=100.0, depth_pct=0.20,
                convergence_ratio=0.68, volume_pattern="contracting", seed=21),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 85.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
