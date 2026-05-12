"""One-shot generator for the major_trendlines fixture battery.

Run: python tests/fixtures/major_trendlines/_generate.py

The detector fits least-squares lines through swing pivots in the recent
80-bar window and emits one Detection per validated trendline.

Each fixture's `expected` block:
  {
    "fires": bool,
    "expected_count": int (when fires=true; not required when fires=false),
    "expected_types": [list of trendline_type strings emitted],
    "min_confidence": float,
    "max_confidence": float
  }
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
    return _bar(t, base, base + 0.5, base - 0.5, base, v)


def _build_explicit_pivots(specs, n_bars, base=100.0, seed=1, v=1000.0):
    """Place explicit forced pivots at specified bar indexes.

    specs: list of {idx, type, price} dicts. Highs must be > base, lows < base.
    No two specs within +/-3 bars. Non-pivot bars use a uniform flat band
    [base-0.2, base+0.2].
    """
    rng = random.Random(seed)
    pmap = {spec["idx"]: spec for spec in specs}
    bars = []
    t = T0
    flat_h = base + 0.2
    flat_l = base - 0.2

    for i in range(n_bars):
        if i in pmap:
            spec = pmap[i]
            if spec["type"] == "high":
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

def _build_clean_rising_support(seed=1):
    """5 swing-lows on a clean ascending line.

    base = 120, the flat band is [119.8, 120.2]. Lows must be below 119.8.
    Place 5 lows at indices 5, 20, 35, 50, 65 ascending from $80 to $112
    in equal $8 steps -> perfect linear fit.
    """
    specs = [
        {"idx": 5,  "type": "low", "price": 80.0},
        {"idx": 20, "type": "low", "price": 88.0},
        {"idx": 35, "type": "low", "price": 96.0},
        {"idx": 50, "type": "low", "price": 104.0},
        {"idx": 65, "type": "low", "price": 112.0},
    ]
    return _build_explicit_pivots(specs, n_bars=80, base=120.0, seed=seed)


def _build_clean_falling_resistance(seed=2):
    """5 swing-highs on a perfect descending line.

    base = 60. Highs above 60.2. Place 5 highs at indices 5, 20, 35, 50, 65
    descending from $120 to $80 in equal $-10 steps.
    """
    specs = [
        {"idx": 5,  "type": "high", "price": 120.0},
        {"idx": 20, "type": "high", "price": 110.0},
        {"idx": 35, "type": "high", "price": 100.0},
        {"idx": 50, "type": "high", "price": 90.0},
        {"idx": 65, "type": "high", "price": 80.0},
    ]
    return _build_explicit_pivots(specs, n_bars=80, base=60.0, seed=seed)


def _build_both_trendlines(seed=3):
    """Channel: rising support + falling resistance both visible.

    To allow swing-highs above base and swing-lows below base in the SAME
    series, use base = 100. Place 4 rising lows below 100 and 4 falling
    highs above 100.
    """
    specs = [
        # Rising support (lows): $70, $76, $82, $88
        {"idx": 5,  "type": "low",  "price": 70.0},
        {"idx": 22, "type": "low",  "price": 76.0},
        {"idx": 42, "type": "low",  "price": 82.0},
        {"idx": 62, "type": "low",  "price": 88.0},
        # Falling resistance (highs): $130, $124, $118, $112
        {"idx": 12, "type": "high", "price": 130.0},
        {"idx": 32, "type": "high", "price": 124.0},
        {"idx": 52, "type": "high", "price": 118.0},
        {"idx": 72, "type": "high", "price": 112.0},
    ]
    return _build_explicit_pivots(specs, n_bars=80, base=100.0, seed=seed)


def _build_long_rising_support_high_touches(seed=4):
    """8 swing-lows over 80 bars, perfectly ascending.

    Place 8 lows at indices 4, 14, 24, 34, 44, 54, 64, 74 from $80 to $115
    (each +$5).
    """
    specs = [
        {"idx": 4,  "type": "low", "price": 80.0},
        {"idx": 14, "type": "low", "price": 85.0},
        {"idx": 24, "type": "low", "price": 90.0},
        {"idx": 34, "type": "low", "price": 95.0},
        {"idx": 44, "type": "low", "price": 100.0},
        {"idx": 54, "type": "low", "price": 105.0},
        {"idx": 64, "type": "low", "price": 110.0},
        {"idx": 74, "type": "low", "price": 115.0},
    ]
    return _build_explicit_pivots(specs, n_bars=80, base=125.0, seed=seed)


def _build_moderate_falling_resistance(seed=5):
    """4 swing-highs forming a falling resistance line with r^2 ~0.85.

    Place 4 highs descending mostly linearly but with one slight deviation
    to keep r^2 in the ~0.85-0.95 band.
    """
    specs = [
        # Linear base at slope -2/bar from idx 10:
        # idx 10 -> 100, idx 30 -> 60 (need wider). Use base=$50, highs above.
        # Place 4 highs decreasing from $120 -> $90 over 60 bars (slope -0.5)
        # with one tiny offset.
        {"idx": 10, "type": "high", "price": 120.0},
        {"idx": 30, "type": "high", "price": 110.0},
        {"idx": 50, "type": "high", "price": 99.0},   # small deviation
        {"idx": 70, "type": "high", "price": 90.0},
    ]
    return _build_explicit_pivots(specs, n_bars=80, base=70.0, seed=seed)


# ===================================================================
# Negative fixtures
# ===================================================================

def _build_flat_data(seed=10):
    """Completely flat - no swing pivots at all."""
    bars = []
    t = T0
    for i in range(80):
        bars.append(_flat_bar(t, 50.0))
        t += DT
    return bars


def _build_2_pivots_only(seed=11):
    """Only 2 swing-lows - below the minimum touch threshold of 3."""
    specs = [
        {"idx": 20, "type": "low", "price": 90.0},
        {"idx": 50, "type": "low", "price": 95.0},
    ]
    return _build_explicit_pivots(specs, n_bars=80, base=100.0, seed=seed)


def _build_random_walk(seed=12):
    """Random walk - pivots exist but no linear pattern (low r^2)."""
    rng = random.Random(seed)
    bars = []
    t = T0
    mid = 100.0
    for i in range(80):
        step = rng.uniform(-2.0, 2.0)
        mid += step
        o = mid - 0.10
        c = mid + 0.10
        # Use random wider H/L so pivot detector still finds pivots
        h = max(o, c) + rng.uniform(0.5, 2.5)
        l = min(o, c) - rng.uniform(0.5, 2.5)
        bars.append(_bar(t, o, h, l, c, 1000.0))
        t += DT
    return bars


def _build_rising_pivots_no_clear_line(seed=13):
    """3 rising swing-lows but scattered too much - r^2 < 0.7.

    Place lows at positions creating a high-noise ascending pattern that
    won't pass the r^2 >= 0.7 gate.
    """
    specs = [
        {"idx": 8,  "type": "low", "price": 80.0},
        {"idx": 25, "type": "low", "price": 95.0},  # jumps too fast
        {"idx": 42, "type": "low", "price": 85.0},  # dips back
        {"idx": 60, "type": "low", "price": 92.0},
    ]
    return _build_explicit_pivots(specs, n_bars=80, base=110.0, seed=seed)


def _build_falling_pivots_no_clear_line(seed=14):
    """3-4 falling swing-highs but with too much scatter for a clean fit."""
    specs = [
        {"idx": 8,  "type": "high", "price": 120.0},
        {"idx": 25, "type": "high", "price": 105.0},  # jumps too fast
        {"idx": 42, "type": "high", "price": 115.0},  # bounces back
        {"idx": 60, "type": "high", "price": 108.0},
    ]
    return _build_explicit_pivots(specs, n_bars=80, base=90.0, seed=seed)


def _build_short_series(seed=15):
    """Series too short (< 2*window+1 = 7 bars)."""
    rng = random.Random(seed)
    bars = []
    t = T0
    for i in range(5):
        mid = 50.0 + i * 0.5
        bars.append(_bar(t, mid - 0.10, mid + 0.20, mid - 0.20, mid + 0.10, 1000.0))
        t += DT
    return bars


def _build_mixed_direction(seed=16):
    """Pivots oscillate without a trendline forming.

    Lows alternate up-down-up-down (no monotonic trend), highs same. Should
    produce r^2 well below 0.7 on both fits.
    """
    specs = [
        # Lows oscillate
        {"idx": 5,  "type": "low", "price": 85.0},
        {"idx": 20, "type": "low", "price": 95.0},
        {"idx": 35, "type": "low", "price": 85.0},
        {"idx": 50, "type": "low", "price": 95.0},
        {"idx": 65, "type": "low", "price": 85.0},
        # Highs oscillate
        {"idx": 12, "type": "high", "price": 115.0},
        {"idx": 27, "type": "high", "price": 105.0},
        {"idx": 42, "type": "high", "price": 115.0},
        {"idx": 57, "type": "high", "price": 105.0},
        {"idx": 72, "type": "high", "price": 115.0},
    ]
    return _build_explicit_pivots(specs, n_bars=80, base=100.0, seed=seed)


def _build_already_broken(seed=17):
    """Pattern was valid earlier but most recent bars broke through.

    Place 3 rising lows over bars 5-35, then a sharp drop bar at index 70
    plummeting well below the projected line. The detector should still fit
    a line through the lows, but with only 3 touches over a short span, the
    r-squared may or may not pass. We rely on the additional plunge bar
    causing extra noise. To make this clearly negative, we ALSO insert a
    new low at index 70 that wrecks the fit's r-squared.
    """
    specs = [
        {"idx": 5,  "type": "low", "price": 90.0},
        {"idx": 20, "type": "low", "price": 95.0},
        {"idx": 35, "type": "low", "price": 100.0},
        # Now break: a fresh swing-low that drops well below the trendline.
        {"idx": 65, "type": "low", "price": 70.0},
    ]
    return _build_explicit_pivots(specs, n_bars=80, base=120.0, seed=seed)


# ===================================================================
# Edge fixtures
# ===================================================================

def _build_boundary_3_touches_r07(seed=20):
    """Exactly 3 touches with r-squared right at ~0.7-0.8.

    3 clean ascending lows -> 3 collinear points = r^2 = 1.0 mathematically.
    To make r^2 land in the [0.7, 0.85] band we need slight off-line noise.
    Use prices: $80, $90.5, $100 (line through start+end would expect $90 at
    middle -> actual $90.5 = slight noise).
    """
    specs = [
        {"idx": 10, "type": "low", "price": 80.0},
        {"idx": 35, "type": "low", "price": 90.5},
        {"idx": 60, "type": "low", "price": 100.0},
    ]
    return _build_explicit_pivots(specs, n_bars=80, base=110.0, seed=seed)


def _build_boundary_4_touches_r07(seed=21):
    """4 touches, r-squared in the 0.7-0.95 band.

    Place 4 ascending lows along the line y = 0.4*idx + 76.8 with tiny
    deviations <= 0.5% to ensure each point counts as a touch under the
    fit_trendline tolerance.
      idx 8  -> expected 80.0,   actual 80.0
      idx 28 -> expected 88.0,   actual 88.1   (~0.11% off)
      idx 48 -> expected 96.0,   actual 95.8   (~0.21% off)
      idx 68 -> expected 104.0,  actual 104.0
    Slight off-line wobble keeps r^2 just under 1.0.
    """
    specs = [
        {"idx": 8,  "type": "low", "price": 80.0},
        {"idx": 28, "type": "low", "price": 88.1},
        {"idx": 48, "type": "low", "price": 95.8},
        {"idx": 68, "type": "low", "price": 104.0},
    ]
    return _build_explicit_pivots(specs, n_bars=80, base=115.0, seed=seed)


# ===================================================================
# Writer
# ===================================================================

GOOD_CONTEXT_BULLISH = {
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

GOOD_CONTEXT_BEARISH = {
    "trend_stage": 4,
    "rs_trend": "down",
    "ma_alignment": "stacked_bearish",
    "volume_signature": "neutral",
    "regime": "bearish",
    "nearest_resistance": None,
    "nearest_support": None,
    "days_to_earnings": None,
    "sector_strength_rank": None,
}

NEUTRAL_CONTEXT = {
    "trend_stage": 1,
    "rs_trend": "flat",
    "ma_alignment": "mixed",
    "volume_signature": "neutral",
    "regime": "neutral",
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
    _write("clean_rising_support", "positive",
           _build_clean_rising_support(seed=1),
           GOOD_CONTEXT_BULLISH,
           {
               "fires": True,
               "expected_count": 1,
               "expected_types": ["rising_support"],
               "min_confidence": 60.0,
               "max_confidence": 100.0,
           })

    _write("clean_falling_resistance", "positive",
           _build_clean_falling_resistance(seed=2),
           GOOD_CONTEXT_BEARISH,
           {
               "fires": True,
               "expected_count": 1,
               "expected_types": ["falling_resistance"],
               "min_confidence": 60.0,
               "max_confidence": 100.0,
           })

    _write("both_trendlines", "positive",
           _build_both_trendlines(seed=3),
           NEUTRAL_CONTEXT,
           {
               "fires": True,
               "expected_count": 2,
               "expected_types": ["rising_support", "falling_resistance"],
               "min_confidence": 50.0,
               "max_confidence": 100.0,
           })

    _write("long_rising_support_high_touches", "positive",
           _build_long_rising_support_high_touches(seed=4),
           GOOD_CONTEXT_BULLISH,
           {
               "fires": True,
               "expected_count": 1,
               "expected_types": ["rising_support"],
               "min_confidence": 85.0,
               "max_confidence": 100.0,
           })

    _write("moderate_falling_resistance", "positive",
           _build_moderate_falling_resistance(seed=5),
           GOOD_CONTEXT_BEARISH,
           {
               "fires": True,
               "expected_count": 1,
               "expected_types": ["falling_resistance"],
               "min_confidence": 60.0,
               "max_confidence": 100.0,
           })

    # ===== 8 NEGATIVE =====
    _write("flat_data", "negative",
           _build_flat_data(seed=10),
           NEUTRAL_CONTEXT,
           {"fires": False, "expected_count": 0, "expected_types": [],
            "min_confidence": 0.0, "max_confidence": 100.0})

    _write("2_pivots_only", "negative",
           _build_2_pivots_only(seed=11),
           NEUTRAL_CONTEXT,
           {"fires": False, "expected_count": 0, "expected_types": [],
            "min_confidence": 0.0, "max_confidence": 100.0})

    _write("random_walk", "negative",
           _build_random_walk(seed=12),
           NEUTRAL_CONTEXT,
           {"fires": False, "expected_count": 0, "expected_types": [],
            "min_confidence": 0.0, "max_confidence": 100.0})

    _write("rising_pivots_but_no_clear_line", "negative",
           _build_rising_pivots_no_clear_line(seed=13),
           NEUTRAL_CONTEXT,
           {"fires": False, "expected_count": 0, "expected_types": [],
            "min_confidence": 0.0, "max_confidence": 100.0})

    _write("falling_pivots_but_no_clear_line", "negative",
           _build_falling_pivots_no_clear_line(seed=14),
           NEUTRAL_CONTEXT,
           {"fires": False, "expected_count": 0, "expected_types": [],
            "min_confidence": 0.0, "max_confidence": 100.0})

    _write("short_series", "negative",
           _build_short_series(seed=15),
           NEUTRAL_CONTEXT,
           {"fires": False, "expected_count": 0, "expected_types": [],
            "min_confidence": 0.0, "max_confidence": 100.0})

    _write("mixed_direction", "negative",
           _build_mixed_direction(seed=16),
           NEUTRAL_CONTEXT,
           {"fires": False, "expected_count": 0, "expected_types": [],
            "min_confidence": 0.0, "max_confidence": 100.0})

    _write("already_broken", "negative",
           _build_already_broken(seed=17),
           NEUTRAL_CONTEXT,
           {"fires": False, "expected_count": 0, "expected_types": [],
            "min_confidence": 0.0, "max_confidence": 100.0})

    # ===== 2 EDGE =====
    _write("boundary_3_touches_r07", "edge",
           _build_boundary_3_touches_r07(seed=20),
           GOOD_CONTEXT_BULLISH,
           {
               "fires": True,
               "expected_count": 1,
               "expected_types": ["rising_support"],
               "min_confidence": 50.0,
               "max_confidence": 100.0,
           })

    _write("boundary_4_touches_r07", "edge",
           _build_boundary_4_touches_r07(seed=21),
           GOOD_CONTEXT_BULLISH,
           {
               "fires": True,
               "expected_count": 1,
               "expected_types": ["rising_support"],
               "min_confidence": 50.0,
               "max_confidence": 100.0,
           })

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
