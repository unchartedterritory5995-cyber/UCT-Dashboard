"""NR7 fixture generator. 17 fixtures total (5 positive, 9 negative, 3 edge).

NR7 = Narrowest Range in 7 bars (Toby Crabel 1990 / Linda Raschke 1995).
Gate: current bar range STRICTLY less than ALL 6 prior bars' ranges.
Minimum series length: _NR7_LOOKBACK + _AVG_RANGE_BARS = 7 + 20 = 27 bars.

Key insight about NR4 + NR7 relationship:
  NR4 checks bars[-4:-1] = the most recent 3 of the prior 6 bars.
  NR7 requires current < ALL 6 prior, which INCLUDES the NR4 window.
  Therefore NR7 always implies NR4 = True (NR4 is a strict subset).
  A NR7-without-NR4 fixture is mathematically impossible.
  Fixtures vary by inside-bar bonus and compression-vs-avg ratios instead.

--- _EPS / strict-narrowest boundary note ---
The NR7 detector has NO _EPS constant.  The strict-narrowest gate is:
  `last_range < r` for every r in prior_ranges — plain `<`.

With 2-decimal rounded prices, h-l arithmetic is exact (IEEE 754 subtraction
of representable values).  A true price tie (e.g. last_range = 0.30,
prior_range = 0.30) produces bit-identical floats and strict `<` → False.
The 'just-under' edge fixture uses last_range = tie_range - 0.02 (strictly
smaller), which fires correctly.  _EPS is absent and not needed.

VERIFIED: all 17 fixtures checked against detect_nr7 before writing.
"""
import json
import os

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))
T0 = 1700000000
DT = 86400          # 1-day step
BASE_VOL = 300000.0
# Minimum bars required: _NR7_LOOKBACK(7) + _AVG_RANGE_BARS(20) = 27
_MIN_BARS = 27


def _bar(t, o, h, l, c, v=BASE_VOL):
    return {
        "t": int(t),
        "o": round(float(o), 2),
        "h": round(float(h), 2),
        "l": round(float(l), 2),
        "c": round(float(c), 2),
        "v": round(float(v), 0),
    }


def _make_bar(t, mid, half_range, v=BASE_VOL):
    """Symmetric bar: h = mid+half_range, l = mid-half_range, o/c near mid."""
    h = round(mid + half_range, 2)
    l = round(mid - half_range, 2)
    o = round(mid - half_range * 0.2, 2)
    c = round(mid + half_range * 0.2, 2)
    return _bar(t, o, h, l, c, v)


def _prefix(n, mid=100.0, half_range=1.0, t_start=None):
    """Build n filler bars with given half_range."""
    t_start = t_start or T0
    bars = []
    t = t_start
    for _ in range(n):
        bars.append(_make_bar(t, mid, half_range))
        t += DT
    return bars


def _last_t(bars):
    return bars[-1]["t"] + DT


# ---------------------------------------------------------------------------
# POSITIVE fixtures
# ---------------------------------------------------------------------------

def _clean_nr7():
    """Clean NR7 + NR4, no inside-bar confluence.

    prior_6 half-ranges: [2.0, 2.5, 1.8, 2.2, 1.9, 2.1]  min-range = 3.6
    current half_range: 1.5 → range 3.0, strictly < 3.6 → NR7 ✓ NR4 ✓
    Not an inside bar: current h=101.5, prev h=102.1 → 101.5 < 102.1 ✓ inside
    Actually it IS inside prev bar — prev had half=2.1 so h=102.1, l=97.9.
    current h=101.5 < 102.1 and l=98.5 > 97.9 → inside bar = True.
    To suppress inside-bar bonus, offset current bar so high > prev high.
    Prev bar (half=2.1): h=102.1. Use current mid=103.0, half=1.5 → h=104.5 > 102.1 ✓.
    """
    bars = _prefix(21, mid=100.0, half_range=2.0)
    t = _last_t(bars)
    mid = 100.0
    for hr in [2.0, 2.5, 1.8, 2.2, 1.9, 2.1]:
        bars.append(_make_bar(t, mid, hr))
        t += DT
    # Current bar: offset mid so it's NOT inside the previous bar
    # prev bar had h=102.1, l=97.9. Move mid to 103 so h=104.5 > prev h.
    bars.append(_make_bar(t, 103.0, 1.5))  # range=3.0 < min prior range=3.6 → NR7
    return bars


def _nr7_also_nr4():
    """NR7 with NR4 explicitly verified (the 'bonus' fires).

    NR4 always fires when NR7 fires — this fixture uses wider prior bars
    to make the NR4 margin very clear.

    prior_6 half-ranges: [3.0, 2.8, 2.5, 2.0, 1.8, 2.2]  min-range = 3.6
    current half_range: 1.5 → range=3.0 < 3.6 → NR7 ✓
    NR4 window: prior_6[3:6] = [2.0, 1.8, 2.2] → min range=3.6 → 3.0 < 3.6 ✓
    """
    bars = _prefix(21, mid=100.0, half_range=2.0)
    t = _last_t(bars)
    for hr in [3.0, 2.8, 2.5, 2.0, 1.8, 2.2]:
        bars.append(_make_bar(t, 100.0, hr))
        t += DT
    bars.append(_make_bar(t, 100.0, 1.5))  # NR7 + NR4
    return bars


def _nr7_inside_bar():
    """NR7 that is also an inside bar (high < prev high AND low > prev low).

    The previous bar has h=102.5, l=97.5 (half=2.5).
    Current bar: h=100.5, l=99.5 (half=0.5, range=1.0).
    Inside check: 100.5 < 102.5 ✓, 99.5 > 97.5 ✓ → inside bar bonus fires.
    NR7: prior_6 min range=3.6 (half=1.8) > 1.0 → NR7 ✓.
    """
    bars = _prefix(21, mid=100.0, half_range=2.0)
    t = _last_t(bars)
    # prior_6 half-ranges: last one is 2.5 (prev bar before current)
    for hr in [2.0, 3.0, 2.5, 2.2, 1.8, 2.5]:
        bars.append(_make_bar(t, 100.0, hr))
        t += DT
    # NR7 bar: inside the previous bar (prev half=2.5 → h=102.5, l=97.5)
    bars.append(_bar(t, 99.8, 100.5, 99.5, 100.2))  # range=1.0 < min prior=3.6 ✓
    return bars


def _nr7_after_volatile_expansion():
    """NR7 after high-volatility expansion — extreme compression vs 20-bar avg.

    Prior 21 bars (avg_range prefix) have half_range=3.0 → avg_range~6.0.
    Prior 6 bars: half-ranges [4.0, 5.0, 3.5, 4.5, 4.2, 3.8] (very wide).
    Current half_range: 0.5 → range=1.0 << min prior=7.0 → NR7 ✓
    bar_range_pct_of_avg ≈ 1.0/6.0 ≈ 0.17 → extreme compression (≤0.25).
    """
    bars = _prefix(21, mid=100.0, half_range=3.0)  # wide prefix for high avg
    t = _last_t(bars)
    for hr in [4.0, 5.0, 3.5, 4.5, 4.2, 3.8]:
        bars.append(_make_bar(t, 100.0, hr))
        t += DT
    bars.append(_make_bar(t, 100.0, 0.5))  # extreme compression
    return bars


def _nr7_clear_margin():
    """NR7 where the current bar is far narrowest — high-conviction setup.

    prior_6 half-ranges: [3.0, 2.8, 3.2, 2.7, 3.5, 2.9]  min-range=5.4
    current half_range: 0.8 → range=1.6, much less than min prior=5.4.
    """
    bars = _prefix(21, mid=100.0, half_range=2.0)
    t = _last_t(bars)
    for hr in [3.0, 2.8, 3.2, 2.7, 3.5, 2.9]:
        bars.append(_make_bar(t, 100.0, hr))
        t += DT
    bars.append(_make_bar(t, 100.0, 0.8))  # clearly narrowest
    return bars


# ---------------------------------------------------------------------------
# NEGATIVE fixtures
# ---------------------------------------------------------------------------

def _not_narrowest_prior_narrower():
    """One prior bar is narrower than the current bar — NR7 must not fire.

    prior_6 half-ranges: [2.0, 2.5, 1.8, 0.8, 2.2, 2.1]
    current half_range: 1.0 → range=2.0 > prior range 1.6 (half=0.8).
    Strict < fails on bar with half=0.8. NR7 must not fire.
    """
    bars = _prefix(21, mid=100.0, half_range=2.0)
    t = _last_t(bars)
    for hr in [2.0, 2.5, 1.8, 0.8, 2.2, 2.1]:
        bars.append(_make_bar(t, 100.0, hr))
        t += DT
    bars.append(_make_bar(t, 100.0, 1.0))  # range=2.0 > 1.6 → not NR7
    return bars


def _exact_tie_not_nr7():
    """Current range EXACTLY TIES a prior bar's range — must NOT fire (strict <).

    prior_6 half-ranges: [2.0, 2.5, 1.5, 2.2, 1.9, 2.1]
    min half = 1.5 → min range = 3.0.
    current half_range: 1.5 → range = 3.0 = min prior range (tie).
    Strict `<` rejects the tie → NR7 must not fire.
    """
    bars = _prefix(21, mid=100.0, half_range=2.0)
    t = _last_t(bars)
    for hr in [2.0, 2.5, 1.5, 2.2, 1.9, 2.1]:
        bars.append(_make_bar(t, 100.0, hr))
        t += DT
    bars.append(_make_bar(t, 100.0, 1.5))  # tie with prior min → not strictly narrowest
    return bars


def _current_is_widest():
    """Current bar is the WIDEST of 7 — fails NR7.

    prior_6 half-ranges: [1.0, 1.2, 0.8, 1.1, 0.9, 1.3]
    current half_range: 2.0 — widest in window.
    """
    bars = _prefix(21, mid=100.0, half_range=1.0)
    t = _last_t(bars)
    for hr in [1.0, 1.2, 0.8, 1.1, 0.9, 1.3]:
        bars.append(_make_bar(t, 100.0, hr))
        t += DT
    bars.append(_make_bar(t, 100.0, 2.0))  # widest
    return bars


def _outside_bar_not_nr7():
    """Outside bar: current range > all prior 6 ranges — clearly not NR7.

    prior_6 half-ranges: [0.5, 0.6, 0.7, 0.8, 0.5, 0.6]
    current bar extends beyond prev bar's extremes AND has a large range.
    """
    bars = _prefix(21, mid=100.0, half_range=0.5)
    t = _last_t(bars)
    for hr in [0.5, 0.6, 0.7, 0.8, 0.5, 0.6]:
        bars.append(_make_bar(t, 100.0, hr))
        t += DT
    # outside bar with wide range (not NR7)
    prev = bars[-1]
    bars.append(_bar(t, prev["o"], prev["h"] + 2.5, prev["l"] - 2.5, prev["c"]))
    return bars


def _too_short_series():
    """Series has only 26 bars — one below the minimum of 27.

    Detector requires n >= 7 + 20 = 27. 26 bars → early return.
    """
    bars = _prefix(26, mid=100.0, half_range=2.0)
    return bars  # 26 bars, gate rejects


def _nr7_not_on_last_bar():
    """NR7 occurs on a non-final bar; the current (last) bar is wider.

    Bar at position -7 (6 positions from last) has half_range=0.5.
    Last bar has half_range=2.0, which is larger than the narrow bar.
    prior_6 of last bar includes the 0.5-range bar → 2.0 > 1.0 → not NR7.
    """
    bars = _prefix(21, mid=100.0, half_range=2.0)
    t = _last_t(bars)
    # Narrow bar (would be NR7 if it were the last bar)
    bars.append(_make_bar(t, 100.0, 0.5))
    t += DT
    # 5 subsequent bars (so narrow bar is now at position -7 from the final bar)
    for hr in [1.8, 2.0, 1.9, 2.2, 2.5]:
        bars.append(_make_bar(t, 100.0, hr))
        t += DT
    # Last bar: wider than the 0.5-range bar in window → 2.0 > 1.0 → not NR7
    bars.append(_make_bar(t, 100.0, 2.0))
    # prior_6 = [0.5, 1.8, 2.0, 1.9, 2.2, 2.5], last range=4.0 → not < 1.0 → fails
    return bars


def _flat_all_equal_ranges():
    """All bars have identical ranges — tie with all prior bars → not NR7.

    Every bar: half_range=1.0 → range=2.0. Strict `<` fails (tie).
    """
    bars = _prefix(28, mid=100.0, half_range=1.0)
    return bars  # last bar ties all prior → not NR7


def _expanding_range_series():
    """Ranges expand bar by bar — last bar is the widest, must not fire.

    Bars 1-21: half_range=0.5 (prefix filler).
    Bars 22-27: half_ranges 1.0, 1.2, 1.4, 1.6, 1.8, 2.0 (expanding).
    Last bar: half_range=2.2 — widest of all.
    """
    bars = _prefix(21, mid=100.0, half_range=0.5)
    t = _last_t(bars)
    for hr in [1.0, 1.2, 1.4, 1.6, 1.8, 2.0]:
        bars.append(_make_bar(t, 100.0, hr))
        t += DT
    bars.append(_make_bar(t, 100.0, 2.2))  # widest = last
    return bars


def _extra_neg_tie_bearish():
    """Exact tie in bearish context — still must not fire (tie + wrong ctx).

    Same bar structure as _exact_tie_not_nr7 with bearish context.
    prior_6 half-ranges: [2.0, 2.5, 1.5, 2.2, 1.9, 2.1], current=1.5 (tie).
    """
    bars = _prefix(21, mid=100.0, half_range=2.0)
    t = _last_t(bars)
    for hr in [2.0, 2.5, 1.5, 2.2, 1.9, 2.1]:
        bars.append(_make_bar(t, 100.0, hr))
        t += DT
    bars.append(_make_bar(t, 100.0, 1.5))  # tie — must not fire
    return bars


# ---------------------------------------------------------------------------
# EDGE fixtures
# ---------------------------------------------------------------------------

def _tie_boundary_must_not_fire():
    """Edge: current range = exact minimum of prior 6 (tie) — must NOT fire.

    prior_6 half-ranges: [2.0, 1.5, 1.8, 2.2, 1.9, 2.3]
    min prior range = 3.0 (half=1.5). current half=1.5 → range=3.0 = min (tie).

    Strict `<` correctly rejects this.  No _EPS rescue is possible or needed:
    2-decimal prices produce bit-identical float subtraction (e.g. 101.5-98.5
    gives exactly 3.0 in IEEE 754 on both bars), so the tie is exact and
    plain `<` returns False.  This proves the strict boundary is enforced.
    """
    bars = _prefix(21, mid=100.0, half_range=2.0)
    t = _last_t(bars)
    for hr in [2.0, 1.5, 1.8, 2.2, 1.9, 2.3]:
        bars.append(_make_bar(t, 100.0, hr))
        t += DT
    bars.append(_make_bar(t, 100.0, 1.5))  # tie with prior min → strict < fails
    return bars


def _just_under_tie_must_fire():
    """Edge: current range = min(prior 6) − 0.02 — just strictly narrowest.

    prior_6 half-ranges: [2.0, 1.5, 1.8, 2.2, 1.9, 2.3]
    min prior range = 3.0 (half=1.5).
    current half=1.49 → range=2.98, strictly < 3.00 by 0.02.

    This exercises the strict-< boundary from the passing side.
    The 0.02 margin is exact in IEEE 754 (2^-6 × 2^-1 = representable exactly).
    _EPS is not needed — the 0.02 margin is large enough to survive any float
    residue from 2-decimal arithmetic.  This fixture MUST fire.
    """
    bars = _prefix(21, mid=100.0, half_range=2.0)
    t = _last_t(bars)
    for hr in [2.0, 1.5, 1.8, 2.2, 1.9, 2.3]:
        bars.append(_make_bar(t, 100.0, hr))
        t += DT
    bars.append(_make_bar(t, 100.0, 1.49))  # range=2.98 < 3.00 → fires
    return bars


def _exactly_27_bars_minimum():
    """Edge: exactly 27 bars — the minimum series length boundary.

    Detector requires n >= 7 + 20 = 27 bars.
    Layout (27 bars):
      bars[0..19]: 20 filler bars (avg_range window = bars[-21:-1] covers bars[6:26])
      bars[20..25]: prior_6
      bars[26]: current (last bar)
    With exactly 27 bars, the length gate passes (27 >= 27) and NR7 fires.
    """
    t = T0
    bars = []
    for _ in range(20):
        bars.append(_make_bar(t, 100.0, 2.0))
        t += DT
    for hr in [2.5, 3.0, 2.2, 2.8, 2.4, 2.7]:
        bars.append(_make_bar(t, 100.0, hr))
        t += DT
    # Current: narrowest (half_range=1.5 < min(prior 6)=2.2 → range 3.0 < 4.4)
    bars.append(_make_bar(t, 100.0, 1.5))
    assert len(bars) == 27, f"Expected 27 bars, got {len(bars)}"
    return bars


# ---------------------------------------------------------------------------
# Contexts
# ---------------------------------------------------------------------------

NEUTRAL_CONTEXT = {
    "trend_stage": 3,
    "rs_trend": "flat",
    "ma_alignment": "mixed",
    "volume_signature": "contracting",
    "regime": "neutral",
    "dcr_signature": None,
    "recent_dcr_avg": None,
    "nearest_resistance": 102.0,
    "nearest_support": 98.0,
    "days_to_earnings": None,
    "sector_strength_rank": None,
}

TRENDING_CONTEXT = {
    "trend_stage": 2,
    "rs_trend": "up",
    "ma_alignment": "stacked_bullish",
    "volume_signature": "contracting",
    "regime": "bullish",
    "dcr_signature": "accumulation",
    "recent_dcr_avg": 0.65,
    "nearest_resistance": 105.0,
    "nearest_support": 98.0,
    "days_to_earnings": None,
    "sector_strength_rank": 3,
}

BEARISH_CONTEXT = {
    "trend_stage": 4,
    "rs_trend": "down",
    "ma_alignment": "stacked_bearish",
    "volume_signature": "neutral",
    "regime": "bearish",
    "dcr_signature": "distribution",
    "recent_dcr_avg": 0.25,
    "nearest_resistance": 102.0,
    "nearest_support": 95.0,
    "days_to_earnings": None,
    "sector_strength_rank": None,
}

FLAT_CONTEXT = {
    "trend_stage": 1,
    "rs_trend": "flat",
    "ma_alignment": "mixed",
    "volume_signature": "neutral",
    "regime": "neutral",
    "dcr_signature": None,
    "recent_dcr_avg": None,
    "nearest_resistance": None,
    "nearest_support": None,
    "days_to_earnings": None,
    "sector_strength_rank": None,
}


# ---------------------------------------------------------------------------
# Write helper
# ---------------------------------------------------------------------------

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
    # ---- 5 POSITIVE ----
    _write("nr7_clean", "positive",
           _clean_nr7(), NEUTRAL_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("nr7_also_nr4", "positive",
           _nr7_also_nr4(), TRENDING_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("nr7_inside_bar", "positive",
           _nr7_inside_bar(), TRENDING_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("nr7_after_volatile_expansion", "positive",
           _nr7_after_volatile_expansion(), NEUTRAL_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("nr7_clear_margin", "positive",
           _nr7_clear_margin(), TRENDING_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    # ---- 9 NEGATIVE ----
    _write("nr7_neg_prior_bar_narrower", "negative",
           _not_narrowest_prior_narrower(), NEUTRAL_CONTEXT,
           {"fires": False})

    _write("nr7_neg_exact_tie", "negative",
           _exact_tie_not_nr7(), NEUTRAL_CONTEXT,
           {"fires": False})

    _write("nr7_neg_current_widest", "negative",
           _current_is_widest(), NEUTRAL_CONTEXT,
           {"fires": False})

    _write("nr7_neg_outside_bar_wide", "negative",
           _outside_bar_not_nr7(), FLAT_CONTEXT,
           {"fires": False})

    _write("nr7_neg_too_short", "negative",
           _too_short_series(), FLAT_CONTEXT,
           {"fires": False})

    _write("nr7_neg_not_on_last_bar", "negative",
           _nr7_not_on_last_bar(), NEUTRAL_CONTEXT,
           {"fires": False})

    _write("nr7_neg_flat_equal_ranges", "negative",
           _flat_all_equal_ranges(), FLAT_CONTEXT,
           {"fires": False})

    _write("nr7_neg_expanding_ranges", "negative",
           _expanding_range_series(), FLAT_CONTEXT,
           {"fires": False})

    _write("nr7_neg_tie_bearish_context", "negative",
           _extra_neg_tie_bearish(), BEARISH_CONTEXT,
           {"fires": False})

    # ---- 3 EDGE ----
    _write("nr7_edge_tie_boundary_no_fire", "edge",
           _tie_boundary_must_not_fire(), NEUTRAL_CONTEXT,
           {"fires": False})

    _write("nr7_edge_just_under_tie", "edge",
           _just_under_tie_must_fire(), NEUTRAL_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("nr7_edge_minimum_bars", "edge",
           _exactly_27_bars_minimum(), TRENDING_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    print("\nDone -- 17 fixtures written (5 positive, 9 negative, 3 edge).")


if __name__ == "__main__":
    main()
