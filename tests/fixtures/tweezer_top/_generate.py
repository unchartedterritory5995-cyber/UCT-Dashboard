"""Tweezer Top fixture generator. 17 fixtures total (6 pos / 8 neg / 3 edge).

Anatomy: two consecutive candles whose highs match within _MATCH_TOL_PCT = 0.0015
         (0.15% of the matched high).

Context gate: must have topping context (at swing high OR above 50SMA OR
         recent_advance_pct >= 5%). A tweezer mid-downtrend is NOT a reversal —
         the hard gate rejects it unconditionally, regardless of geometry/volume.

Positive (6):
  1. textbook_bullish_a_bearish_b       — bullish A + bearish B at clear swing high
  2. tweezer_after_advance              — tweezer after a measured 10%+ recent advance
  3. tweezer_at_resistance              — tweezer at mapped nearest_resistance level
  4. same_direction_both_bullish        — both bars bullish at a high (valid, weaker)
  5. high_volume_bar_b                  — high-volume bar B (strong distribution signal)
  6. strong_geometry_with_context       — tight highs + full handoff + 2x vol + real swing high
                                          (paired control for neg_tweezer_mid_downtrend: same
                                          geometry is allowed precisely because context IS present)

Negative (8), each isolating ONE failure:
  1. highs_dont_match               — diff > tolerance (geometry gate fails)
  2. series_too_short               — only one bar (< _MIN_BARS)
  3. tweezer_mid_downtrend          — tight highs + full handoff + 2x vol, but clean Stage-4
                                       downtrend (no swing high / not above 50SMA / advance<5%)
                                       → hard reversal-context gate rejects unconditionally
  4. lows_match_not_highs           — tweezer BOTTOM territory, not top
  5. non_consecutive_highs          — matching highs but bars not adjacent (gap bar between)
  6. flat_chop_multi_suppressor     — flat chop failing on weak geometry + near-zero vol +
                                       absent reversal context (multi-condition suppressor;
                                       gate-only isolation is neg_tweezer_mid_downtrend)
  7. single_shooting_star_bar       — single bar (not a 2-bar tweezer)
  8. pair_outside_scan_window       — matching pair is too far back, outside scan window

Edge (3):
  1. exact_tolerance_must_fire     — abs(high_a - high_b) == _MATCH_TOL (inclusive, MUST fire)
  2. just_over_tolerance_no_fire   — abs(high_a - high_b) just over _MATCH_TOL (MUST NOT fire)
  3. extreme_swing_high_boundary   — pair at the very swing-high extreme (context boundary)
"""
import json
import os

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))
T0 = 1700000000
DT = 86400

# These constants MUST match the detector
_MATCH_TOL_PCT = 0.0015   # 0.15% of matched_high
_EPS = 1e-9


def _bar(t, o, h, l, c, v=1000.0):
    return {"t": t, "o": round(o, 4), "h": round(h, 4),
            "l": round(l, 4), "c": round(c, 4), "v": round(v, 0)}


def _uptrend(n, start_p, end_p, vol=1000.0, t_start=T0):
    bars = []
    t = t_start
    step = (end_p - start_p) / max(n - 1, 1)
    for i in range(n):
        mid = start_p + step * i
        o = mid - 0.10
        c = mid + 0.10
        h = c + 0.05
        l = o - 0.05
        bars.append(_bar(t, o, h, l, c, vol))
        t += DT
    return bars


def _downtrend(n, start_p, end_p, vol=1000.0, t_start=T0):
    bars = []
    t = t_start
    step = (end_p - start_p) / max(n - 1, 1)
    for i in range(n):
        mid = start_p + step * i
        o = mid + 0.10
        c = mid - 0.10
        h = o + 0.05
        l = c - 0.05
        bars.append(_bar(t, o, h, l, c, vol))
        t += DT
    return bars


def _flat(n, price, vol=1000.0, t_start=T0):
    bars = []
    t = t_start
    for _ in range(n):
        bars.append(_bar(t, price - 0.05, price + 0.10, price - 0.10, price + 0.05, vol))
        t += DT
    return bars


def _last_t(bars):
    return bars[-1]["t"] + DT


# ============================================================
# POSITIVE FIXTURES
# ============================================================

def _textbook_bullish_a_bearish_b():
    """Classic textbook tweezer top: bullish A + bearish B at a clear swing high.

    Bar A (bullish): o=49.50, h=52.00, l=49.45, c=51.80
    Bar B (bearish): o=51.80, h=51.98, l=49.50, c=50.10
    matched_high = 52.00
    _MATCH_TOL = 0.0015 * 52.00 = 0.078
    abs(52.00 - 51.98) = 0.02 << 0.078 -> passes
    Bar A is bullish (c > o), Bar B is bearish (c < o) -> reversal_handoff = True
    """
    bars = _uptrend(15, 40.0, 50.0)
    t = _last_t(bars)
    # Bar A: bullish, high=52.00
    bars.append(_bar(t, 49.50, 52.00, 49.45, 51.80, 1500.0))
    t += DT
    # Bar B: bearish, high=51.98 (diff=0.02, tol=0.078 -> passes)
    bars.append(_bar(t, 51.80, 51.98, 49.50, 50.10, 2000.0))
    return bars


def _tweezer_after_advance():
    """Tweezer pair after a measured recent advance (>10%).

    Uptrend 40->52 then tweezer. recent_advance_pct ~= (52-40)/40 = 30%.
    Bar A (bullish): o=51.70, h=52.00, l=51.60, c=51.80 (green)
    Bar B (bearish): o=51.80, h=51.99, l=50.50, c=50.60 (red)
    diff = 0.01, tol = 0.0015*52.00 = 0.078 -> passes
    """
    bars = _uptrend(15, 40.0, 51.0)
    t = _last_t(bars)
    bars.append(_bar(t, 51.70, 52.00, 51.60, 51.80, 1200.0))
    t += DT
    bars.append(_bar(t, 51.80, 51.99, 50.50, 50.60, 1800.0))
    return bars


def _tweezer_at_resistance():
    """Tweezer pair right at nearest_resistance level.

    nearest_resistance = 52.00 in context. Both highs ~= 52.00.
    Bar A (bullish): o=51.00, h=52.00, l=50.90, c=51.50 (green)
    Bar B (bearish): o=51.50, h=52.01, l=50.00, c=50.10 (red)
    diff = 0.01, tol = 0.0015*52.01 = 0.0780 -> passes
    """
    bars = _uptrend(15, 38.0, 51.0)
    t = _last_t(bars)
    bars.append(_bar(t, 51.00, 52.00, 50.90, 51.50, 1400.0))
    t += DT
    bars.append(_bar(t, 51.50, 52.01, 50.00, 50.10, 2200.0))
    return bars


def _same_direction_both_bullish():
    """Both bars bullish (A green, B also green) at swing high — valid but weaker.

    No reversal handoff but highs match. reversal_handoff = False.
    Bar A (bullish): o=49.60, h=52.00, l=49.50, c=51.90 (green: c > o)
    Bar B (bullish): o=50.70, h=51.97, l=50.60, c=51.70 (green: c > o)
    diff = 0.03, tol = 0.0015*52.00 = 0.078 -> passes
    reversal_handoff = (c_a > o_a) and (c_b < o_b) = True and False = False
    """
    bars = _uptrend(15, 40.0, 50.0)
    t = _last_t(bars)
    bars.append(_bar(t, 49.60, 52.00, 49.50, 51.90, 1200.0))
    t += DT
    bars.append(_bar(t, 50.70, 51.97, 50.60, 51.70, 1400.0))
    return bars


def _high_volume_bar_b():
    """High-volume bar B tweezer top — strongest distribution signal.

    Volume on bar B is 3.5x average -> vol_score near 100.
    Bar A (bullish): o=49.40, h=52.20, l=49.30, c=52.00 (green)
    Bar B (bearish): o=52.00, h=52.18, l=50.00, c=50.20 (red, vol=3500)
    diff = 0.02, tol = 0.0015*52.20 = 0.0783 -> passes
    """
    bars = _uptrend(15, 40.0, 50.0, vol=1000.0)
    t = _last_t(bars)
    bars.append(_bar(t, 49.40, 52.20, 49.30, 52.00, 1200.0))
    t += DT
    bars.append(_bar(t, 52.00, 52.18, 50.00, 50.20, 3500.0))
    return bars


def _strong_geometry_with_context():
    """Paired positive control for neg_tweezer_mid_downtrend.

    IDENTICAL strong geometry: diff=0 (perfect tight highs), bar A bullish + bar B
    bearish (full reversal handoff), bar B vol = 2x avg. The ONLY difference from
    the negative fixture is genuine topping context — a real 20-bar uptrend that
    places the pair at a swing high with a >5% recent advance.

    This fixture proves the reversal-context gate is context-selective (not a
    blanket suppressor). Same geometry that is REJECTED in the downtrend case is
    ACCEPTED here because topping context is present.

    Verification:
      - is_swing_high: bar_b.h=52.00 = window maximum -> ratio=0.0 <= 0.05 -> True
      - recent_advance_pct: 15-bar low ~= 40.1, bar_b.h=52.00
          advance ~= (52.0-40.1)/40.1 = 29.7% >> 5% -> True
      - has_reversal_context = True -> gate PASSES

    Expected confidence ~= 89.5:
      geom=100 (diff=0, handoff), vol=100 (ratio=2.0>=1.8), ctx=85 (swing_high+35
        + advance>10%+15 + stage=2+5 + base=30), hist=50
      0.40*100 + 0.25*100 + 0.20*85 + 0.15*50 = 40+25+17+7.5 = 89.5
    """
    bars = _uptrend(20, 35.0, 50.0, vol=1000.0)
    t = _last_t(bars)
    # Bar A: bullish (c > o), high=52.00 — full handoff
    bars.append(_bar(t, 50.20, 52.00, 50.10, 51.80, 1000.0))
    t += DT
    # Bar B: bearish (c < o), high=52.00 (diff=0), 2x avg volume
    bars.append(_bar(t, 51.80, 52.00, 50.00, 50.20, 2000.0))
    return bars


# ============================================================
# NEGATIVE FIXTURES
# ============================================================

def _highs_dont_match():
    """Highs differ by more than _MATCH_TOL — geometry gate fails.

    Bar A high = 52.00, Bar B high = 51.00.
    diff = 1.00, tol = 0.0015*52.00 = 0.078 -> 1.00 >> 0.078 -> fails.
    """
    bars = _uptrend(15, 40.0, 50.0)
    t = _last_t(bars)
    bars.append(_bar(t, 49.50, 52.00, 49.40, 51.80, 1200.0))
    t += DT
    bars.append(_bar(t, 51.80, 51.00, 49.00, 49.50, 1500.0))
    return bars


def _series_too_short():
    """Only one bar — series shorter than _MIN_BARS (7). Cannot form a tweezer pair."""
    return [_bar(T0, 50.0, 51.0, 49.0, 50.5, 1000.0)]


def _tweezer_mid_downtrend():
    """ADVERSARIAL negative: strongest possible geometry + volume, but clean downtrend.

    This is the exact adversarial construction the spec requires must fire
    WITHOUT the context gate (confidence = 78.5), and must return 0 detections
    WITH the gate. It is the anti-fixture-masking guard.

    Geometry: PERFECT — tight highs, diff=0 (tightest possible), tightness_ratio=0
      -> tightness_score=100. Bar A bullish + bar B bearish = full reversal handoff
      -> handoff_bonus=15. geom = min(100, 115) = 100.

    Volume: bar B vol = 2x 20-bar avg -> ratio=2.0 >= 1.8 -> vol_score=100.

    Context gate check (ALL THREE must be False):
      - is_swing_high: 50-bar downtrend from 100->60. In the 10-bar lookback the
        OLDER bars have HIGHER highs (~64-69). bar_b.h=61.00 sits at the BOTTOM of
        the window -> ratio ~= 0.79 >> 0.05 -> False.
      - above_50sma: bar_b.c~=60.30, SMA50~=80.0 -> False.
      - recent_advance_pct: 15-bar low~=59.5, bar_b.h=61.00
          advance ~= (61.0-59.5)/59.5 = 2.52% << 5% -> False.

    All three False -> has_reversal_context=False -> DISCARDED by gate unconditionally.
    0 detections. NOT because geometry was weakened.

    BEFORE gate (for documentation): conf=78.5
      geom=100, vol=100, ctx=30 (base only), hist=50
      0.40*100 + 0.25*100 + 0.20*30 + 0.15*50 = 40+25+6+7.5 = 78.5

    Paired positive control: pos_strong_geometry_with_context uses identical
    geometry + volume but with a genuine swing high after a >5% advance —
    that fixture MUST fire strongly to prove the gate is context-selective,
    not a blanket suppressor.
    """
    bars = _downtrend(50, 100.0, 60.0)
    t = _last_t(bars)
    # Bar A: bullish (c > o) — full reversal handoff setup
    bars.append(_bar(t, 60.20, 61.00, 59.80, 60.60, 1000.0))
    t += DT
    # Bar B: bearish (c < o), diff=0, 2x avg volume — strongest possible geometry
    bars.append(_bar(t, 60.60, 61.00, 59.50, 60.10, 2000.0))
    return bars


def _lows_match_not_highs():
    """Lows are similar but highs don't match — that's tweezer BOTTOM territory.

    low_a = 48.00, low_b = 48.02 (very close)
    high_a = 52.00, high_b = 54.00 (differ by 2.00 >> tol=0.081)
    Highs don't match -> tweezer TOP gate fails.
    """
    bars = _uptrend(15, 38.0, 51.0)
    t = _last_t(bars)
    bars.append(_bar(t, 49.00, 52.00, 48.00, 51.50, 1200.0))
    t += DT
    bars.append(_bar(t, 51.50, 54.00, 48.02, 53.80, 1400.0))
    return bars


def _non_consecutive_highs():
    """Matching highs but bars are not consecutive — a gap bar separates them.

    The detector scans consecutive pairs (i, i+1). Two bars with matching highs
    at positions i and i+2 (with a different bar between them) do NOT form a pair.
    """
    bars = _uptrend(15, 40.0, 50.0)
    t = _last_t(bars)
    # Bar A: high=52.00
    bars.append(_bar(t, 49.50, 52.00, 49.40, 51.80, 1200.0))
    t += DT
    # Gap bar (very different high)
    bars.append(_bar(t, 51.80, 53.00, 51.70, 52.90, 900.0))
    t += DT
    # Bar C: high=51.99 (matches Bar A but not consecutive with it)
    bars.append(_bar(t, 52.90, 51.99, 50.00, 50.20, 1500.0))
    return bars


def _flat_chop_multi_suppressor():
    """Flat-chop fixture that fails on MULTIPLE simultaneous conditions — not a clean isolation.

    This fixture suppresses firing via THREE conditions acting together:
      1. WEAK geometry  — tightness_ratio=0.861 -> tightness_score~=41; no reversal handoff
                          (both bars bearish). geom ~= 41.
      2. NEAR-ZERO volume — bar B vol=1 vs avg=1000 -> vol_score ~= 0.04.
      3. ABSENT reversal context — alternating-high chop keeps bar_b.h below the
                          10-bar window maximum (is_swing_high=False), advance_pct < 5%.

    Any one of the three would suppress or heavily penalise the detection; all three
    apply simultaneously here. This is flat-chop coverage, not a gate-only isolation.

    The rigorous context-gate-only isolation is neg_tweezer_mid_downtrend: that fixture
    uses PERFECT geometry (diff=0, full reversal handoff, 2x volume) and is rejected
    SOLELY by the has_reversal_context gate. Do NOT alter neg_tweezer_mid_downtrend.

    Math for the intended pair (high_a=51.80, high_b=51.867):
      diff = 0.067, matched_high=51.867, tol=0.0015*51.867=0.0778
      tightness_ratio = 0.067/0.0778 = 0.861
      tightness_score = 30+(1.0-0.861)/0.5*40 = 30+11.12 = 41.12
      No reversal handoff (both bearish) -> geom = 41.12

    Volume: bar B vol=1, avg of preceding 10 bars = 1000.
      ratio = 1/1000 = 0.001 -> vol_score = 30*0.001/0.7 ~= 0.04

    Context: alternating-high chop bars ensure the 10-bar window has highs of 54.0
      (well above 51.8) so bar_b.h is NOT the window maximum (is_swing_high=False).
      Lows kept high (>=50) so advance_pct = (51.867-50)/50 = 3.7% < 5% (False).

    Chop bars use ALTERNATING highs (adjacent differences >> tol):
      highs: 51.80, 54.00, 51.50, 54.50, 51.20, 54.00, 51.00, 53.50, 50.80, 54.00
      Adjacent deltas: 2.20, 2.50, 3.00, 3.30, 2.80, 3.00, 2.50, 2.70, 3.20
      All >> 0.078 -> no accidental tweezer-top pairs.
    Then the intended pair: high_a=51.80, high_b=51.867 (diff=0.067 < tol=0.078).
    """
    bars = []
    t = T0
    # 10 chop bars with ALTERNATING highs >> tol apart (no consecutive matching)
    chop_data = [
        (51.40, 51.80, 50.20, 51.60),   # h=51.80
        (51.60, 54.00, 50.50, 53.80),   # h=54.00  (delta=2.20)
        (53.80, 51.50, 50.30, 51.30),   # h=51.50  (delta=2.50)
        (51.30, 54.50, 50.40, 54.30),   # h=54.50  (delta=3.00)
        (54.30, 51.20, 50.10, 51.00),   # h=51.20  (delta=3.30)
        (51.00, 54.00, 50.50, 53.80),   # h=54.00  (delta=2.80)
        (53.80, 51.00, 50.20, 50.80),   # h=51.00  (delta=3.00)
        (50.80, 53.50, 50.30, 53.30),   # h=53.50  (delta=2.50)
        (53.30, 50.80, 50.10, 50.60),   # h=50.80  (delta=2.70)
        (50.60, 54.00, 50.40, 53.80),   # h=54.00  (delta=3.20)
    ]
    for (o, h, l, c) in chop_data:
        bars.append(_bar(t, o, h, l, c, 1000.0))
        t += DT
    # Intended pair: both bearish, HIGH_B near tol boundary, EXTREMELY low vol on bar B
    bars.append(_bar(t, 52.00, 51.80, 50.20, 50.40, 1000.0))    # bar A (bearish)
    t += DT
    bars.append(_bar(t, 50.40, 51.867, 50.10, 50.30, 1.0))       # bar B (bearish, vol=1)
    return bars


def _single_shooting_star_bar():
    """Single shooting-star-like bar — not a 2-bar tweezer (only one bar in scan window)."""
    bars = _uptrend(15, 40.0, 50.0)
    t = _last_t(bars)
    # One shooting-star-like bar, no second bar to form a pair
    bars.append(_bar(t, 49.90, 52.40, 49.80, 50.10, 1800.0))
    return bars


def _pair_outside_scan_window():
    """Matching pair is too far back — outside the scan window.

    The detector scans the last _SCAN_LOOKBACK=6 bars for pairs (bar B at index i,
    bar A at index i-1). A qualifying pair at position (pair_a=idx, pair_b=idx+1)
    is only found if pair_b >= len(bars) - _SCAN_LOOKBACK.

    After the valid tweezer pair, add STRICTLY VARYING chop bars whose adjacent
    highs CANNOT match each other (differ by more than _MATCH_TOL). This prevents
    any new valid pairs from forming in the chop region.

    Chop bars use alternating highs: 55.00, 51.00, 56.00, 50.00, 54.00, 57.00...
    Adjacent differences: 4.00 >> tol ~= 0.0795 (0.15% of 53) -> no pairs form.
    """
    bars = _uptrend(15, 40.0, 50.0)
    t = _last_t(bars)
    # Valid tweezer pair (pair_b will be pushed outside scan window)
    bars.append(_bar(t, 49.50, 52.00, 49.40, 51.80, 1500.0))
    t += DT
    bars.append(_bar(t, 51.80, 51.98, 49.50, 50.10, 2000.0))
    t += DT
    # Add 8 strictly non-matching chop bars (adjacent highs differ >> tol)
    # Alternating between HIGH and LOW highs, so no adjacent pair matches
    chop_highs = [55.00, 51.00, 56.00, 50.00, 55.50, 49.50, 54.00, 53.00]
    chop_lows  = [53.00, 49.00, 54.00, 48.00, 53.50, 47.50, 52.00, 51.00]
    for hi, lo in zip(chop_highs, chop_lows):
        bars.append(_bar(t, lo + 1.0, hi, lo, hi - 0.5, 1200.0))
        t += DT
    return bars


# ============================================================
# EDGE FIXTURES
# ============================================================

def _exact_tolerance_must_fire():
    """abs(high_a - high_b) EXACTLY == _MATCH_TOL (nominal) — inclusive boundary, MUST fire.

    matched_high = max(high_a, high_b) = 100.00  (high_a is the larger)
    _MATCH_TOL = 0.0015 * 100.00 (the matched_high) = 0.15 approximately
    high_a = 100.00, high_b = 99.85  (diff = 0.15 nominally; high_a > high_b)

    IEEE 754 / _EPS truth (established by Python computation):
      The tolerance is computed at the matched_high (the larger value = 100.00).
      100.00 is exactly representable, but tol = 0.0015 * 100.00 stores below nominal.

      Computed values:
        high_a = 100.00  (exactly representable; matched_high = 100.00)
        high_b = 99.85   (approximately representable)
        diff   = abs(100.00 - 99.85) = 0.15000000000000568  (> 0.15 by ~5.69e-15)
        tol    = 0.0015 * 100.00    = 0.14999999999999999  (< 0.15 by ~4.5e-18)

      diff > tol by ~5.69e-15. WITHOUT _EPS the gate:
          diff <= tol  ->  0.15000...568 <= 0.14999...999  ->  FALSE -> WRONGLY REJECTED.
      WITH _EPS = 1e-9:
          diff <= tol + 1e-9  ->  True -> CORRECTLY ACCEPTED.

      Conclusion: _EPS IS LOAD-BEARING. It is not merely defensive — the exact-
      tolerance pair would be wrongly rejected without it. _EPS = 1e-9 >> 5.69e-15
      provides the necessary correction for this IEEE 754 boundary case.

    The uptrend is capped at 92.0 so no uptrend bar's high reaches 99.85 or 100.00,
    preventing accidental pairs between uptrend bars and the intended pair.
    A transition bar at ~96.0 bridges without forming a match (transition h~=96.2,
    far from both 99.85 and 100.00).
    """
    bars = _uptrend(15, 80.0, 92.0)    # capped at 92.0 to prevent accidental pairs
    t = _last_t(bars)
    # Transition bar: bullish, h~96.2 (far from 99.85/100.00 — no accidental pair)
    bars.append(_bar(t, 94.50, 96.20, 94.40, 95.80, 1000.0))
    t += DT
    high_a = 100.00
    high_b = 99.85   # diff = 0.15 nominally; matched_high = max = 100.00
    # Bar A: bullish, high=high_a (this is the matched_high; _EPS is load-bearing here)
    bars.append(_bar(t, 97.20, high_a, 97.10, 99.60, 1500.0))
    t += DT
    # Bar B: bearish, high=high_b (just at boundary from below)
    bars.append(_bar(t, 99.60, high_b, 98.00, 98.20, 2000.0))
    return bars


def _just_over_tolerance_no_fire():
    """abs(high_a - high_b) just OVER _MATCH_TOL — MUST NOT fire.

    matched_high = 100.00
    _MATCH_TOL = 0.0015 * 100.00 ~= 0.15
    We use high_b = high_a + 0.20 (diff = 0.20 >> tol ~= 0.15) — well over.
    Using a clean 0.20 delta avoids any float-residue ambiguity:
      diff = 0.20 > 0.15 + 1e-9 -> gate rejects.

    The uptrend is capped at 94.0 so no uptrend bar reaches 100.00+, preventing
    any accidental pair between uptrend bars and the intended high_a=100.00 bar.
    A transition bar at ~95.0 bridges the uptrend to the 100-level without
    forming a matching pair with high_a (transition bar high ~= 95.2, far from 100).
    """
    bars = _uptrend(15, 80.0, 92.0)   # top of uptrend = 92, not 100
    t = _last_t(bars)
    # Transition bar: bullish, mid-range high ~95.2 (far from 100.00 — no pair)
    bars.append(_bar(t, 93.50, 95.20, 93.40, 94.80, 1000.0))
    t += DT
    high_a = 100.00
    high_b = 100.20   # diff = 0.20, tol ~= 0.15 -> 0.20 > 0.15 -> fails
    # Bar A: bullish, high=high_a
    bars.append(_bar(t, 97.20, high_a, 97.10, 99.60, 1500.0))
    t += DT
    # Bar B: bearish, high=high_b — diff exceeds _MATCH_TOL, gate rejects
    bars.append(_bar(t, 99.60, high_b, 98.00, 98.20, 2000.0))
    return bars


def _extreme_swing_high_boundary():
    """Tweezer pair exactly at the swing-high extreme — context boundary test.

    A steep 20-bar uptrend places the pair at the absolute top.
    Both bars have nearly identical highs. Tests that the context logic
    recognizes an extreme swing high even when the uptrend is very steep.
    Bar A: bullish, high=55.00
    Bar B: bearish, high=55.03 (diff=0.03, tol=0.0015*55.03=0.0825 -> passes)
    """
    bars = _uptrend(20, 35.0, 55.0)
    t = _last_t(bars)
    bars.append(_bar(t, 54.00, 55.00, 53.80, 54.50, 1600.0))
    t += DT
    bars.append(_bar(t, 54.50, 55.03, 53.00, 53.20, 2400.0))
    return bars


# ============================================================
# CONTEXT DEFINITIONS
# ============================================================

BULLISH_CONTEXT = {
    "trend_stage": 2,
    "rs_trend": "up",
    "ma_alignment": "stacked_bullish",
    "volume_signature": "neutral",
    "regime": "bullish",
    "nearest_resistance": 52.00,
    "nearest_support": 40.00,
    "days_to_earnings": None,
    "sector_strength_rank": None,
}

ADVANCE_CONTEXT = {
    "trend_stage": 2,
    "rs_trend": "up",
    "ma_alignment": "stacked_bullish",
    "volume_signature": "neutral",
    "regime": "bullish",
    "nearest_resistance": 55.0,
    "nearest_support": None,
    "days_to_earnings": None,
    "sector_strength_rank": None,
}

RESISTANCE_CONTEXT = {
    "trend_stage": 2,
    "rs_trend": "up",
    "ma_alignment": "stacked_bullish",
    "volume_signature": "neutral",
    "regime": "bullish",
    "nearest_resistance": 52.00,   # pair is right at this level
    "nearest_support": 38.00,
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

DOWNTREND_CONTEXT = {
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

# Context for the strong-geometry-with-context paired positive control.
# Stage 2 uptrend, bullish regime, no mapped resistance (swing high provides context).
STRONG_GEOM_TOPPING_CONTEXT = {
    "trend_stage": 2,
    "rs_trend": "up",
    "ma_alignment": "stacked_bullish",
    "volume_signature": "neutral",
    "regime": "bullish",
    "nearest_resistance": None,
    "nearest_support": 35.0,
    "days_to_earnings": None,
    "sector_strength_rank": None,
}

EDGE_CONTEXT = {
    "trend_stage": 2,
    "rs_trend": "up",
    "ma_alignment": "stacked_bullish",
    "volume_signature": "neutral",
    "regime": "bullish",
    "nearest_resistance": 100.0,
    "nearest_support": 80.0,
    "days_to_earnings": None,
    "sector_strength_rank": None,
}

STEEP_UP_CONTEXT = {
    "trend_stage": 2,
    "rs_trend": "up",
    "ma_alignment": "stacked_bullish",
    "volume_signature": "neutral",
    "regime": "bullish",
    "nearest_resistance": 55.0,
    "nearest_support": 35.0,
    "days_to_earnings": None,
    "sector_strength_rank": None,
}


def _write(name, category, bars, context, expected):
    payload = {"name": name, "category": category, "expected": expected,
               "context": context, "bars": bars}
    path = os.path.join(_OUT_DIR, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {path}  ({len(bars)} bars)")


def main():
    # ── 6 POSITIVE ──────────────────────────────────────────────────────
    _write("pos_textbook_bullish_a_bearish_b", "positive",
           _textbook_bullish_a_bearish_b(), BULLISH_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("pos_tweezer_after_advance", "positive",
           _tweezer_after_advance(), ADVANCE_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("pos_tweezer_at_resistance", "positive",
           _tweezer_at_resistance(), RESISTANCE_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("pos_same_direction_both_bullish", "positive",
           _same_direction_both_bullish(), BULLISH_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("pos_high_volume_bar_b", "positive",
           _high_volume_bar_b(), BULLISH_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    # Paired positive control: identical strong geometry as neg_tweezer_mid_downtrend
    # but WITH topping context. Proves the gate is context-selective.
    _write("pos_strong_geometry_with_context", "positive",
           _strong_geometry_with_context(), STRONG_GEOM_TOPPING_CONTEXT,
           {"fires": True, "min_confidence": 80.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    # ── 8 NEGATIVE ──────────────────────────────────────────────────────
    _write("neg_highs_dont_match", "negative",
           _highs_dont_match(), BULLISH_CONTEXT, {"fires": False})

    _write("neg_series_too_short", "negative",
           _series_too_short(), NEUTRAL_CONTEXT, {"fires": False})

    _write("neg_tweezer_mid_downtrend", "negative",
           _tweezer_mid_downtrend(), DOWNTREND_CONTEXT, {"fires": False})

    _write("neg_lows_match_not_highs", "negative",
           _lows_match_not_highs(), BULLISH_CONTEXT, {"fires": False})

    _write("neg_non_consecutive_highs", "negative",
           _non_consecutive_highs(), BULLISH_CONTEXT, {"fires": False})

    _write("neg_flat_chop_multi_suppressor", "negative",
           _flat_chop_multi_suppressor(), NEUTRAL_CONTEXT, {"fires": False})

    _write("neg_single_shooting_star_bar", "negative",
           _single_shooting_star_bar(), BULLISH_CONTEXT, {"fires": False})

    _write("neg_pair_outside_scan_window", "negative",
           _pair_outside_scan_window(), NEUTRAL_CONTEXT, {"fires": False})

    # ── 3 EDGE ──────────────────────────────────────────────────────────
    _write("edge_exact_tolerance_must_fire", "edge",
           _exact_tolerance_must_fire(), EDGE_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("edge_just_over_tolerance_no_fire", "edge",
           _just_over_tolerance_no_fire(), EDGE_CONTEXT,
           {"fires": False})

    _write("edge_extreme_swing_high_boundary", "edge",
           _extreme_swing_high_boundary(), STEEP_UP_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    print("\nDone — 17 fixtures written (6 pos / 8 neg / 3 edge).")


if __name__ == "__main__":
    main()
