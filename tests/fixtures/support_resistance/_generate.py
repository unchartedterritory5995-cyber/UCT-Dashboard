"""One-shot generator for the support_resistance fixture battery.

Run: python tests/fixtures/support_resistance/_generate.py

Unlike single-Detection-emitting detectors, support_resistance emits ONE
Detection per active level (a chart with 3 S/R levels -> 3 Detections).
The expected block per fixture therefore looks different:

  expected = {
    "fires": true/false,
    "min_count": int,           // minimum Detections expected
    "max_count": int,           // maximum Detections expected
    "min_confidence": float,    // every emitted Detection's confidence >= this
    "max_confidence": float,    // every emitted Detection's confidence <= this
    "expected_levels": [        // optional - check at least these levels emit
      {"approx_price": 100.0, "type": "support", "tolerance_pct": 1.5}
    ]
  }

The battery exercises:
  - Clean S/R configurations (positive)
  - No pivots / single pivot / scattered pivots (negative)
  - Boundary at exactly minimum touches / exact 2% cluster band (edge)
"""
import json
import math
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))

T0 = 1700000000
DT = 86400


def _bar(t, o, h, l, c, v):
    return {
        "t": int(t),
        "o": round(float(o), 2),
        "h": round(float(h), 2),
        "l": round(float(l), 2),
        "c": round(float(c), 2),
        "v": round(float(v), 0),
    }


def _flat_bar(t, base, v=1000.0):
    """A truly flat bar that the pivot detector cannot register as a pivot."""
    return _bar(t, base, base + 0.5, base - 0.5, base, v)


def _build_explicit_levels(level_specs, n_bars=60, base=100.0, seed=1, v=1000.0):
    """Place explicit forced touches at specified bar indexes.

    level_specs: list of dicts with keys:
      - idx: bar index to place the touch
      - type: 'high' or 'low'
      - price: the touch price.

    CONSTRAINT: every high-spec price must be > base, every low-spec
    price must be < base, AND no two specs may be within +/-3 bars of
    each other (so pivots don't dominate each other within the window=3
    neighborhood). This is the caller's responsibility.

    Non-pivot bars all use a uniform flat band [base-0.2, base+0.2] so
    no spurious swing pivots are detected and every spec price stands
    out from its neighbors strictly-greater or strictly-less.
    """
    rng = random.Random(seed)
    pmap = {spec["idx"]: spec for spec in level_specs}
    bars = []
    t = T0
    flat_h = base + 0.2
    flat_l = base - 0.2

    for i in range(n_bars):
        if i in pmap:
            spec = pmap[i]
            if spec["type"] == "high":
                # Must be > flat_h to register as swing-high
                pivot_h = max(float(spec["price"]), flat_h + 0.5)
                pivot_l = flat_l
            else:
                pivot_l = min(float(spec["price"]), flat_l - 0.5)
                pivot_h = flat_h
            bars.append(_bar(t, base, pivot_h, pivot_l, base, 1500.0))
        else:
            bars.append(_bar(t, base, flat_h, flat_l, base, 1000.0))
        t += DT
    return bars


# ===================================================================
# Positive fixtures
# ===================================================================

def _build_clean_sr(seed=1):
    """3 support touches at $100, 2 resistance touches at $115.

    Base is $107.5 (midway between 100 and 115) so flat band is
    [$107.3, $107.7]. Lows ($100) are below the flat band; highs
    ($115) are above. Specs are spaced >= 6 bars apart.
    """
    specs = [
        # 3 support touches at $100
        {"idx": 7,  "type": "low",  "price": 100.0},
        {"idx": 25, "type": "low",  "price": 100.2},
        {"idx": 45, "type": "low",  "price": 99.9},
        # 2 resistance touches at $115
        {"idx": 15, "type": "high", "price": 115.0},
        {"idx": 35, "type": "high", "price": 115.3},
    ]
    return _build_explicit_levels(specs, n_bars=60, base=107.5, seed=seed)


def _build_many_levels(seed=2):
    """4+ distinct S/R levels.

    Design constraints (per _build_explicit_levels): all highs ABOVE base,
    all lows BELOW base, and no two specs within +/-3 bars. So we need
    4-5 distinct price levels that are either all >= base or all < base,
    with at least 2 touches each.

    Strategy: place 3 support levels (80, 90, 99) below base and 2
    resistance levels (115, 130) above base. base = 105 (so flat band
    [104.8, 105.2] is between $99 support and $115 resistance).
    """
    specs = [
        # Support at $80 (2 touches)
        {"idx": 5,  "type": "low",  "price": 80.0},
        {"idx": 12, "type": "low",  "price": 80.3},
        # Support at $90 (2 touches)
        {"idx": 19, "type": "low",  "price": 90.0},
        {"idx": 26, "type": "low",  "price": 90.3},
        # Support at $99 (2 touches)
        {"idx": 33, "type": "low",  "price": 99.0},
        {"idx": 40, "type": "low",  "price": 99.2},
        # Resistance at $115 (2 touches)
        {"idx": 9,  "type": "high", "price": 115.0},
        {"idx": 47, "type": "high", "price": 115.3},
        # Resistance at $130 (2 touches)
        {"idx": 22, "type": "high", "price": 130.0},
        {"idx": 54, "type": "high", "price": 130.3},
    ]
    return _build_explicit_levels(specs, n_bars=60, base=105.0, seed=seed)


def _build_single_strong_support(seed=3):
    """4 touches at $80 (strong support), no other meaningful level."""
    specs = [
        {"idx": 8,  "type": "low", "price": 80.0},
        {"idx": 22, "type": "low", "price": 80.3},
        {"idx": 38, "type": "low", "price": 79.9},
        {"idx": 52, "type": "low", "price": 80.2},
    ]
    return _build_explicit_levels(specs, n_bars=60, base=85.0, seed=seed)


def _build_cluster_zone(seed=4):
    """Two nearby support levels within 3% of each other (cluster zone).

    Two clusters of 2+ touches at $100 and $103.
    """
    specs = [
        # Cluster A around $100 (within 2% band)
        {"idx": 8,  "type": "low", "price": 100.0},
        {"idx": 22, "type": "low", "price": 100.3},
        # Cluster B around $103 (2.5% above A - distinct cluster)
        {"idx": 35, "type": "low", "price": 103.0},
        {"idx": 48, "type": "low", "price": 103.2},
    ]
    return _build_explicit_levels(specs, n_bars=60, base=108.0, seed=seed)


def _build_psychological_round_number(seed=5):
    """$50 level (psychological round number) with 3 touches."""
    specs = [
        {"idx": 10, "type": "low", "price": 50.0},
        {"idx": 28, "type": "low", "price": 50.2},
        {"idx": 46, "type": "low", "price": 49.9},
    ]
    return _build_explicit_levels(specs, n_bars=60, base=55.0, seed=seed)


# ===================================================================
# Negative fixtures
# ===================================================================

def _build_no_pivots_flat(seed=10):
    """Completely flat - the pivot detector cannot find any pivots."""
    bars = []
    t = T0
    for i in range(70):
        bars.append(_flat_bar(t, 50.0))
        t += DT
    return bars


def _build_single_pivot(seed=11):
    """One isolated pivot - no clustering possible."""
    specs = [{"idx": 30, "type": "high", "price": 110.0}]
    return _build_explicit_levels(specs, n_bars=60, base=100.0, seed=seed)


def _build_2_pivots_far_apart(seed=12):
    """Two pivots, but not within 2% - cannot cluster.

    One pivot at $100, one at $130 (30% apart). Each is alone.
    """
    specs = [
        {"idx": 20, "type": "low",  "price": 100.0},
        {"idx": 40, "type": "high", "price": 130.0},
    ]
    return _build_explicit_levels(specs, n_bars=60, base=115.0, seed=seed)


def _build_all_pivots_one_side_no_repeats(seed=13):
    """5 pivots, all swing-highs at unique price levels, none repeating.

    Pivots at $100, $107, $114, $121, $128 - all in increasing sequence,
    each separated by 7% from the next. None can cluster within 2%.
    """
    specs = [
        {"idx": 8,  "type": "high", "price": 100.0},
        {"idx": 18, "type": "high", "price": 107.0},
        {"idx": 28, "type": "high", "price": 114.0},
        {"idx": 38, "type": "high", "price": 121.0},
        {"idx": 48, "type": "high", "price": 128.0},
    ]
    return _build_explicit_levels(specs, n_bars=60, base=95.0, seed=seed)


def _build_trending_uptrend(seed=14):
    """Each high/low advances each cycle - no repeats, no clustering."""
    rng = random.Random(seed)
    bars = []
    t = T0
    # 60 bars of monotonic advance with periodic small oscillation
    for i in range(60):
        mid = 50.0 + 1.0 * i  # advance $1/bar -> $50 to $110
        # tiny swing so the pivot detector finds reversals but at new levels each cycle
        wobble = 1.5 * math.sin(i * 0.7)
        o = mid - 0.10
        c = mid + 0.10
        h = c + 0.50 + max(0, wobble)
        l = o - 0.50 + min(0, wobble)
        bars.append(_bar(t, o, h, l, c, 1000.0))
        t += DT
    return bars


def _build_chaotic(seed=15):
    """Pivots scattered widely - no two pivots within 2% of each other.

    Uses explicit levels at well-separated prices so no clustering occurs.
    Each pivot is unique, with the nearest neighbor at least 5% away.
    """
    specs = [
        # Each price > 5% apart from every other - cannot cluster within 2%.
        {"idx": 7,  "type": "low",  "price": 70.0},
        {"idx": 14, "type": "low",  "price": 78.0},
        {"idx": 21, "type": "low",  "price": 87.0},
        {"idx": 28, "type": "low",  "price": 97.0},
        # Highs above base, also widely scattered
        {"idx": 35, "type": "high", "price": 138.0},
        {"idx": 42, "type": "high", "price": 150.0},
        {"idx": 49, "type": "high", "price": 163.0},
        {"idx": 56, "type": "high", "price": 178.0},
    ]
    return _build_explicit_levels(specs, n_bars=65, base=115.0, seed=seed)


def _build_few_pivots_window(seed=16):
    """Series too short for pivots (< 2*window+1 = 7 bars)."""
    rng = random.Random(seed)
    bars = []
    t = T0
    for i in range(5):
        mid = 50.0 + i * 0.5
        bars.append(_bar(t, mid - 0.10, mid + 0.20, mid - 0.20, mid + 0.10, 1000.0))
        t += DT
    return bars


def _build_all_pivots_outside_window(seed=17):
    """Pivots only in older bars; the recent 60-bar window has no pivots."""
    rng = random.Random(seed)
    bars = []
    t = T0
    # First 30 bars: oscillation -> pivots
    for i in range(30):
        mid = 50.0 + 5.0 * math.sin(i * 0.7) + rng.uniform(-0.20, 0.20)
        o = mid + rng.uniform(-0.20, 0.20)
        c = mid + rng.uniform(-0.20, 0.20)
        h = max(o, c) + 0.30
        l = min(o, c) - 0.30
        bars.append(_bar(t, o, h, l, c, 1000.0))
        t += DT
    # Next 65 bars: monotonic (no pivots) - drives the older pivots outside
    # the recent 60-bar window.
    for i in range(65):
        mid = 60.0 + 0.20 * i
        o = mid - 0.10
        c = mid + 0.10
        h = c + 0.05
        l = o - 0.05
        bars.append(_bar(t, o, h, l, c, 1000.0))
        t += DT
    return bars


def _build_two_isolated_clusters_negative(seed=18):
    """Negative: only one pivot per attempted cluster zone."""
    specs = [
        {"idx": 15, "type": "low",  "price": 80.0},
        {"idx": 35, "type": "high", "price": 120.0},
    ]
    return _build_explicit_levels(specs, n_bars=60, base=100.0, seed=seed)


# ===================================================================
# Edge fixtures
# ===================================================================

def _build_boundary_2_touches(seed=20):
    """Exactly 2 touches at the same price - the minimum for a level."""
    specs = [
        {"idx": 15, "type": "low", "price": 100.0},
        {"idx": 40, "type": "low", "price": 100.2},
    ]
    return _build_explicit_levels(specs, n_bars=60, base=108.0, seed=seed)


def _build_boundary_2pct_cluster_band(seed=21):
    """Touches spread at exactly the 2% cluster band edge.

    Place 3 touches: $100, $101, $101.99 - cluster band is just under 2%,
    so all three should cluster.
    """
    specs = [
        {"idx": 10, "type": "low", "price": 100.0},
        {"idx": 25, "type": "low", "price": 101.0},
        {"idx": 45, "type": "low", "price": 101.95},
    ]
    return _build_explicit_levels(specs, n_bars=60, base=108.0, seed=seed)


# ===================================================================
# Writer
# ===================================================================

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


def main():
    # ===== 5 POSITIVE =====
    _write("clean_support_resistance", "positive",
           _build_clean_sr(seed=1),
           GOOD_CONTEXT,
           {
               "fires": True,
               "min_count": 2,
               "max_count": 3,
               "min_confidence": 50.0,
               "max_confidence": 100.0,
               "expected_levels": [
                   {"approx_price": 100.0, "type": "support",   "tolerance_pct": 1.5},
                   {"approx_price": 115.0, "type": "resistance","tolerance_pct": 1.5},
               ],
           })

    _write("many_levels", "positive",
           _build_many_levels(seed=2),
           GOOD_CONTEXT,
           {
               "fires": True,
               "min_count": 5,
               "max_count": 6,
               "min_confidence": 50.0,
               "max_confidence": 100.0,
               "expected_levels": [
                   {"approx_price": 80.15, "type": "support",   "tolerance_pct": 1.5},
                   {"approx_price": 90.15, "type": "support",   "tolerance_pct": 1.5},
                   {"approx_price": 99.1,  "type": "support",   "tolerance_pct": 1.5},
                   {"approx_price": 115.15,"type": "resistance","tolerance_pct": 1.5},
                   {"approx_price": 130.15,"type": "resistance","tolerance_pct": 1.5},
               ],
           })

    _write("single_strong_support", "positive",
           _build_single_strong_support(seed=3),
           GOOD_CONTEXT,
           {
               "fires": True,
               "min_count": 1,
               "max_count": 1,
               "min_confidence": 70.0,
               "max_confidence": 100.0,
               "expected_levels": [
                   {"approx_price": 80.1, "type": "support", "tolerance_pct": 2.0},
               ],
           })

    _write("cluster_zone", "positive",
           _build_cluster_zone(seed=4),
           GOOD_CONTEXT,
           {
               "fires": True,
               "min_count": 2,
               "max_count": 3,
               "min_confidence": 50.0,
               "max_confidence": 100.0,
               "expected_levels": [
                   {"approx_price": 100.15, "type": "support", "tolerance_pct": 2.0},
                   {"approx_price": 103.1,  "type": "support", "tolerance_pct": 2.0},
               ],
           })

    _write("psychological_round_number", "positive",
           _build_psychological_round_number(seed=5),
           GOOD_CONTEXT,
           {
               "fires": True,
               "min_count": 1,
               "max_count": 1,
               "min_confidence": 60.0,
               "max_confidence": 100.0,
               "expected_levels": [
                   {"approx_price": 50.0, "type": "support", "tolerance_pct": 2.0},
               ],
           })

    # ===== 8 NEGATIVE =====
    _write("no_pivots", "negative",
           _build_no_pivots_flat(seed=10),
           GOOD_CONTEXT,
           {"fires": False, "min_count": 0, "max_count": 0,
            "min_confidence": 0.0, "max_confidence": 100.0})

    _write("single_pivot", "negative",
           _build_single_pivot(seed=11),
           GOOD_CONTEXT,
           {"fires": False, "min_count": 0, "max_count": 0,
            "min_confidence": 0.0, "max_confidence": 100.0})

    _write("2_pivots_far_apart", "negative",
           _build_2_pivots_far_apart(seed=12),
           GOOD_CONTEXT,
           {"fires": False, "min_count": 0, "max_count": 0,
            "min_confidence": 0.0, "max_confidence": 100.0})

    _write("all_pivots_one_side_no_repeats", "negative",
           _build_all_pivots_one_side_no_repeats(seed=13),
           GOOD_CONTEXT,
           {"fires": False, "min_count": 0, "max_count": 0,
            "min_confidence": 0.0, "max_confidence": 100.0})

    _write("trending_uptrend", "negative",
           _build_trending_uptrend(seed=14),
           GOOD_CONTEXT,
           {"fires": False, "min_count": 0, "max_count": 0,
            "min_confidence": 0.0, "max_confidence": 100.0})

    _write("chaotic", "negative",
           _build_chaotic(seed=15),
           GOOD_CONTEXT,
           {"fires": False, "min_count": 0, "max_count": 0,
            "min_confidence": 0.0, "max_confidence": 100.0})

    _write("few_pivots_window", "negative",
           _build_few_pivots_window(seed=16),
           GOOD_CONTEXT,
           {"fires": False, "min_count": 0, "max_count": 0,
            "min_confidence": 0.0, "max_confidence": 100.0})

    _write("all_pivots_outside_window", "negative",
           _build_all_pivots_outside_window(seed=17),
           GOOD_CONTEXT,
           {"fires": False, "min_count": 0, "max_count": 0,
            "min_confidence": 0.0, "max_confidence": 100.0})

    # ===== 2 EDGE =====
    _write("boundary_2_touches", "edge",
           _build_boundary_2_touches(seed=20),
           GOOD_CONTEXT,
           {
               "fires": True,
               "min_count": 1,
               "max_count": 1,
               "min_confidence": 50.0,
               "max_confidence": 100.0,
               "expected_levels": [
                   {"approx_price": 100.1, "type": "support", "tolerance_pct": 2.0},
               ],
           })

    _write("boundary_2pct_cluster_band", "edge",
           _build_boundary_2pct_cluster_band(seed=21),
           GOOD_CONTEXT,
           {
               "fires": True,
               "min_count": 1,
               "max_count": 2,
               "min_confidence": 50.0,
               "max_confidence": 100.0,
               "expected_levels": [],
           })

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
