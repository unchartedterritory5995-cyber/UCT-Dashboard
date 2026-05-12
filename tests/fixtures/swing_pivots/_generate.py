"""One-shot generator for the swing_pivots fixture battery.

Run: python tests/fixtures/swing_pivots/_generate.py

Structure detector - always fires when >=3 pivots exist in the recent
60-bar window. The fixtures exercise:
  - varying pivot density (positive cases)
  - geometries that produce zero/one/two pivots (negative cases)
  - boundary geometries at exactly 3 pivots (edge cases)
"""
import json
import math
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))

T0 = 1700000000
DT = 86400


def _make_bar(t, mid_price, vol, rng, noise=0.20, force_low=None, force_high=None):
    """Build a generic OHLC bar centered on mid_price."""
    o = mid_price + rng.uniform(-noise, noise)
    c = mid_price + rng.uniform(-noise, noise)
    h = max(o, c) + abs(rng.uniform(0, noise * 1.2))
    l = min(o, c) - abs(rng.uniform(0, noise * 1.2))
    if force_high is not None:
        h = max(h, force_high)
    if force_low is not None:
        l = min(l, force_low)
    return {
        "t": t,
        "o": round(o, 2),
        "h": round(h, 2),
        "l": round(l, 2),
        "c": round(c, 2),
        "v": round(vol * rng.uniform(0.85, 1.15), 0),
    }


def _build_oscillating_bars(n_bars, base=100.0, amplitude=5.0, period=10.0, seed=1):
    """Sine-wave-style oscillation - generates many alternating pivots."""
    rng = random.Random(seed)
    bars = []
    t = T0
    for i in range(n_bars):
        mid = base + amplitude * math.sin(i * (2 * math.pi / period)) + rng.uniform(-0.20, 0.20)
        bars.append(_make_bar(t, mid, 1000, rng, noise=0.30))
        t += DT
    return bars


def _build_explicit_pivot_bars(pivot_positions, n_bars, base=100.0, seed=1):
    """Place explicit forced highs/lows at specified bar indexes.

    pivot_positions: list of (idx, type, delta) - delta added/subtracted from base.
      Non-pivot bars are UNIFORMLY FLAT (every bar h=base+0.5, l=base-0.5, equal),
      so the swing-pivot detector's strict-greater check cannot fire on them.
    """
    rng = random.Random(seed)
    bars = []
    t = T0
    # Map idx -> (type, delta)
    pmap = {idx: (ptype, delta) for idx, ptype, delta in pivot_positions}
    # Use IDENTICAL flat highs/lows for non-pivot bars so swing-pivot detector
    # (which requires strict-greater / strict-less than all neighbors) cannot
    # accidentally find pivots in noise.
    flat_h = base + 0.5
    flat_l = base - 0.5
    for i in range(n_bars):
        if i in pmap:
            ptype, delta = pmap[i]
            if ptype == "high":
                pivot_h = base + delta
                pivot_l = flat_l
            else:
                pivot_h = flat_h
                pivot_l = base - delta
            bars.append({
                "t": t,
                "o": round(base, 2),
                "h": round(pivot_h, 2),
                "l": round(pivot_l, 2),
                "c": round(base, 2),
                "v": 1500.0,
            })
        else:
            bars.append({
                "t": t,
                "o": round(base, 2),
                "h": round(flat_h, 2),
                "l": round(flat_l, 2),
                "c": round(base, 2),
                "v": 1000.0,
            })
        t += DT
    return bars


def _build_flat_bars(n_bars=70, price=50.0, seed=1):
    """Truly flat - no pivots (all bars within tiny noise band)."""
    rng = random.Random(seed)
    bars = []
    t = T0
    for i in range(n_bars):
        mid = price
        # Quantize to make highs/lows equal between many neighbors
        h = price + 0.01
        l = price - 0.01
        bars.append({
            "t": t,
            "o": price,
            "h": h,
            "l": l,
            "c": price,
            "v": 1000.0,
        })
        t += DT
    return bars


def _build_monotonic(n_bars, start=50.0, end=100.0, seed=1):
    """Monotonic price advance - no swing pivots."""
    rng = random.Random(seed)
    bars = []
    t = T0
    step = (end - start) / n_bars
    for i in range(n_bars):
        mid = start + step * (i + 1)
        o = mid - 0.10
        c = mid + 0.10
        h = c + 0.05
        l = o - 0.05
        bars.append({
            "t": t,
            "o": round(o, 2),
            "h": round(h, 2),
            "l": round(l, 2),
            "c": round(c, 2),
            "v": 1000.0,
        })
        t += DT
    return bars


def _build_old_pivots_only(n_bars=80, seed=1):
    """All pivots are >60 bars old; the recent 60 bars are flat."""
    rng = random.Random(seed)
    bars = []
    t = T0
    # First 20 bars: oscillate to produce pivots
    for i in range(20):
        mid = 50.0 + 5.0 * math.sin(i * 0.7)
        bars.append(_make_bar(t, mid, 1000, rng, noise=0.30))
        t += DT
    # Next 60 bars: monotonic uptrend (no pivots in recent window)
    for i in range(60):
        mid = 60.0 + 0.20 * i
        o = mid - 0.10
        c = mid + 0.10
        h = c + 0.05
        l = o - 0.05
        bars.append({
            "t": t,
            "o": round(o, 2),
            "h": round(h, 2),
            "l": round(l, 2),
            "c": round(c, 2),
            "v": 1000.0,
        })
        t += DT
    return bars


def _build_one_pivot_only(seed=1):
    """Produce a series with exactly 1 swing pivot in the window.

    Single bump in an otherwise monotonic series.
    """
    rng = random.Random(seed)
    bars = []
    t = T0
    # 30 bars uptrend
    for i in range(30):
        mid = 50.0 + 0.20 * i
        o = mid - 0.10
        c = mid + 0.10
        h = c + 0.05
        l = o - 0.05
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": 1000.0})
        t += DT
    return bars


def _build_two_pivots_only(seed=1):
    """Produce a series with exactly 2 swing pivots in the window.

    One up-bump, then one down-dip, then quiet.
    """
    rng = random.Random(seed)
    n_bars = 60
    # Just place 2 explicit pivots and keep rest quiet
    pivots = [
        (20, "high", 5.0),
        (40, "low",  5.0),
    ]
    return _build_explicit_pivot_bars(pivots, n_bars, base=100.0, seed=seed)


def _build_short_series(seed=1):
    """Too few bars for the pivot detector to work (n < 2*window+1 = 7)."""
    rng = random.Random(seed)
    bars = []
    t = T0
    for i in range(5):
        mid = 50.0 + i
        bars.append(_make_bar(t, mid, 1000, rng, noise=0.30))
        t += DT
    return bars


def _build_balanced_pivots(seed=1):
    """5 swing-highs + 5 swing-lows over 60 bars."""
    # Use a longer-period sine to get cleaner alternation
    return _build_oscillating_bars(60, base=100.0, amplitude=5.0, period=12.0, seed=seed)


def _build_mostly_highs(seed=1):
    """8 highs, 2 lows - asymmetric: place explicit highs more frequently."""
    pivots = []
    # Place 8 highs at well-spaced indexes
    high_idxs = [8, 14, 20, 26, 32, 38, 44, 50]
    low_idxs = [11, 47]
    for idx in high_idxs:
        pivots.append((idx, "high", 4.0))
    for idx in low_idxs:
        pivots.append((idx, "low", 4.0))
    return _build_explicit_pivot_bars(pivots, n_bars=60, base=100.0, seed=seed)


def _build_many_pivots(seed=1):
    """15+ alternating pivots in 60 bars - dense oscillation."""
    return _build_oscillating_bars(60, base=100.0, amplitude=6.0, period=7.0, seed=seed)


def _build_few_pivots(seed=1):
    """Exactly 4 pivots over 60 bars - sparse."""
    pivots = [
        (10, "high", 5.0),
        (24, "low",  5.0),
        (38, "high", 5.0),
        (52, "low",  5.0),
    ]
    return _build_explicit_pivot_bars(pivots, n_bars=60, base=100.0, seed=seed)


def _build_exactly_3_pivots(seed=1):
    """Exactly 3 pivots - the minimum threshold."""
    pivots = [
        (12, "high", 5.0),
        (30, "low",  5.0),
        (48, "high", 5.0),
    ]
    return _build_explicit_pivot_bars(pivots, n_bars=60, base=100.0, seed=seed)


def _build_boundary_3_strong(seed=1):
    """3 pivots with very large delta -> high strength scores (>=80)."""
    pivots = [
        (12, "high", 20.0),
        (30, "low",  20.0),
        (48, "high", 20.0),
    ]
    return _build_explicit_pivot_bars(pivots, n_bars=60, base=100.0, seed=seed)


def _build_only_1_recent_pivot(seed=1):
    """Plenty of pivots historically but only 1 in the recent 60-bar window.

    We need len(bars) > 60 so the window-filter actually triggers.
    """
    rng = random.Random(seed)
    bars = []
    t = T0
    # First 30 bars: heavily oscillating (creates many pivots outside window)
    for i in range(30):
        mid = 100.0 + 5.0 * math.sin(i * 0.9)
        bars.append(_make_bar(t, mid, 1000, rng, noise=0.30))
        t += DT
    # Next 60 bars: place exactly 1 pivot in the middle, otherwise monotonic
    # We want a single high spike in the middle of the recent window.
    for i in range(60):
        if i == 30:
            # spike high at this bar (which will be ~30 bars from end -> within window)
            mid = 100.0
            h = mid + 3.0
            l = mid - 0.05
            bars.append({"t": t, "o": round(mid, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(mid, 2), "v": 1500.0})
        else:
            mid = 100.0 + 0.05 * i  # very gradual creep
            o = mid - 0.08
            c = mid + 0.08
            h = c + 0.03
            l = o - 0.03
            bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(c, 2), "v": 1000.0})
        t += DT
    return bars


def _build_boundary_60_bar_window(seed=1):
    """Pivots near bar 0, ~30, and ~59 - testing 60-bar window edges."""
    # Series length = 60 so window covers all of it. Place pivots at:
    # idx 6 (just inside window=3 left edge), idx 30 (middle), idx 53 (just inside right edge)
    pivots = [
        (6,  "high", 6.0),
        (30, "low",  6.0),
        (53, "high", 6.0),
    ]
    return _build_explicit_pivot_bars(pivots, n_bars=60, base=100.0, seed=seed)


def _write(name, category, bars, context, expected):
    payload = {
        "name": name,
        "category": category,
        "expected": expected,
        "context": context,
        "bars": bars,
    }
    path = os.path.join(_OUT_DIR, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {path}  ({len(bars)} bars)")


GOOD_CONTEXT = {
    "trend_stage": 2,
    "rs_trend": "up",
    "ma_alignment": "stacked_bullish",
    "volume_signature": "neutral",
    "regime": "bullish",
    "nearest_resistance": None,
    "nearest_support": None,
    "days_to_earnings": None,
    "sector_strength_rank": None,
}


def main():
    # ===== 5 POSITIVE - must fire =====
    _write("many_pivots", "positive",
           _build_many_pivots(seed=1),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 100.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("few_pivots", "positive",
           _build_few_pivots(seed=2),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 100.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("balanced_pivots", "positive",
           _build_balanced_pivots(seed=3),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 100.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("mostly_highs", "positive",
           _build_mostly_highs(seed=4),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 100.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("exactly_3_minimum", "positive",
           _build_exactly_3_pivots(seed=5),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 100.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    # ===== 8 NEGATIVE - must NOT fire =====
    _write("flat_data", "negative",
           _build_flat_bars(n_bars=70, seed=10),
           GOOD_CONTEXT,
           {"fires": False})

    _write("monotonic_uptrend", "negative",
           _build_monotonic(n_bars=70, start=50.0, end=100.0, seed=11),
           GOOD_CONTEXT,
           {"fires": False})

    _write("monotonic_downtrend", "negative",
           _build_monotonic(n_bars=70, start=100.0, end=50.0, seed=12),
           GOOD_CONTEXT,
           {"fires": False})

    _write("1_pivot_only", "negative",
           _build_one_pivot_only(seed=13),
           GOOD_CONTEXT,
           {"fires": False})

    _write("2_pivots_only", "negative",
           _build_two_pivots_only(seed=14),
           GOOD_CONTEXT,
           {"fires": False})

    _write("short_series", "negative",
           _build_short_series(seed=15),
           GOOD_CONTEXT,
           {"fires": False})

    _write("all_pivots_outside_window", "negative",
           _build_old_pivots_only(seed=16),
           GOOD_CONTEXT,
           {"fires": False})

    _write("only_1_recent_pivot", "negative",
           _build_only_1_recent_pivot(seed=17),
           GOOD_CONTEXT,
           {"fires": False})

    # ===== 2 EDGE =====
    _write("boundary_3_pivots_strong", "edge",
           _build_boundary_3_strong(seed=20),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 100.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("boundary_60_bar_window", "edge",
           _build_boundary_60_bar_window(seed=21),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 100.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
