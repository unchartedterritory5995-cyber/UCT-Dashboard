"""Tweezer Bottom fixture generator. 17 fixtures total (6 pos / 8 neg / 3 edge).

Anatomy: two consecutive candles whose lows match within _MATCH_TOL_PCT = 0.0015
         (0.15% of the matched low).

Context gate: must have reversal context (at swing low OR below 50SMA OR
         recent_decline_pct >= 5%). A tweezer mid-uptrend is NOT a reversal —
         the hard gate rejects it unconditionally, regardless of geometry/volume.

Positive (6):
  1. textbook_bearish_a_bullish_b       — bearish A + bullish B at clear swing low
  2. tweezer_after_decline              — tweezer after a measured 10%+ recent decline
  3. tweezer_at_support                 — tweezer at mapped nearest_support level
  4. same_direction_both_bearish        — both bars bearish at a low (valid, weaker)
  5. high_volume_bar_b                  — high-volume bar B (strong reversal signal)
  6. strong_geometry_with_context       — tight lows + full handoff + 2× vol + real swing low
                                          (paired control for neg_tweezer_mid_uptrend: same
                                          geometry is allowed precisely because context IS present)

Negative (8), each isolating ONE failure:
  1. lows_dont_match               — diff > tolerance (geometry gate fails)
  2. series_too_short              — only one bar (< _MIN_BARS)
  3. tweezer_mid_uptrend           — tight lows + full handoff + 2× vol, but clean Stage-2
                                      uptrend (no swing low / not below 50SMA / decline<5%) →
                                      hard reversal-context gate rejects unconditionally
  4. highs_match_not_lows          — tweezer TOP territory, not bottom
  5. non_consecutive_lows          — matching lows but bars not adjacent (gap bar between)
  6. no_context_flat_chop          — matching lows but flat chop (no swing-low/decline)
  7. single_hammer_bar             — single bar (not a 2-bar tweezer)
  8. pair_outside_scan_window      — matching pair is too far back, outside scan window

Edge (3):
  1. exact_tolerance_must_fire     — abs(low_a - low_b) == _MATCH_TOL (inclusive, MUST fire)
  2. just_over_tolerance_no_fire   — abs(low_a - low_b) just over _MATCH_TOL (MUST NOT fire)
  3. extreme_swing_low_boundary    — pair at the very swing-low extreme (context boundary)
"""
import json
import os

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))
T0 = 1700000000
DT = 86400

# These constants MUST match the detector
_MATCH_TOL_PCT = 0.0015   # 0.15% of matched_low
_EPS = 1e-9


def _bar(t, o, h, l, c, v=1000.0):
    return {"t": t, "o": round(o, 4), "h": round(h, 4),
            "l": round(l, 4), "c": round(c, 4), "v": round(v, 0)}


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

def _textbook_bearish_a_bullish_b():
    """Classic textbook tweezer: bearish A + bullish B at a clear swing low.

    Bar A (bearish): o=50.50, h=50.55, l=48.00, c=50.00
    Bar B (bullish): o=50.00, h=51.20, l=48.02, c=51.10
    matched_low ≈ 48.00
    _MATCH_TOL = 0.0015 * 48.00 = 0.072
    abs(48.00 - 48.02) = 0.02 << 0.072 → passes
    Bar A is bearish (c < o), Bar B is bullish (c > o) → reversal_handoff = True
    """
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    # Bar A: bearish, low=48.00
    bars.append(_bar(t, 50.50, 50.55, 48.00, 50.00, 1500.0))
    t += DT
    # Bar B: bullish, low=48.02 (diff=0.02, tol=0.072 → passes)
    bars.append(_bar(t, 50.00, 51.20, 48.02, 51.10, 2000.0))
    return bars


def _tweezer_after_decline():
    """Tweezer pair after a measured recent decline (>10%).

    Downtrend 60→48 then tweezer. recent_decline_pct ≈ (60-48)/60 = 20%.
    Bar A (bearish): o=48.30, h=48.40, l=48.00, c=48.20 (red)
    Bar B (bullish): o=48.20, h=49.50, l=48.01, c=49.40 (green)
    diff = 0.01, tol = 0.0015*48.00 = 0.072 → passes
    """
    bars = _downtrend(15, 60.0, 48.0)
    t = _last_t(bars)
    bars.append(_bar(t, 48.30, 48.40, 48.00, 48.20, 1200.0))
    t += DT
    bars.append(_bar(t, 48.20, 49.50, 48.01, 49.40, 1800.0))
    return bars


def _tweezer_at_support():
    """Tweezer pair right at nearest_support level.

    nearest_support = 48.00 in context. Both lows ≈ 48.00.
    Bar A (bearish): o=49.00, h=49.10, l=48.00, c=48.50 (red)
    Bar B (bullish): o=48.50, h=50.20, l=47.99, c=50.10 (green)
    diff = 0.01, tol = 0.0015*48.00 = 0.072 → passes
    """
    bars = _downtrend(15, 62.0, 49.0)
    t = _last_t(bars)
    bars.append(_bar(t, 49.00, 49.10, 48.00, 48.50, 1400.0))
    t += DT
    bars.append(_bar(t, 48.50, 50.20, 47.99, 50.10, 2200.0))
    return bars


def _same_direction_both_bearish():
    """Both bars bearish (A red, B also red) at swing low — valid but weaker.

    No reversal handoff but lows match. reversal_handoff = False.
    Bar A (bearish): o=50.40, h=50.50, l=48.00, c=50.10 (red)
    Bar B (bearish): o=50.10, h=50.30, l=48.03, c=49.80 (red)
    diff = 0.03, tol = 0.0015*48.00 = 0.072 → passes
    """
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.40, 50.50, 48.00, 50.10, 1200.0))
    t += DT
    bars.append(_bar(t, 50.10, 50.30, 48.03, 49.80, 1400.0))
    return bars


def _high_volume_bar_b():
    """High-volume bar B tweezer — strongest reversal signal.

    Volume on bar B is 3.5x average → vol_score near 100.
    Bar A (bearish): o=50.50, h=50.60, l=47.80, c=50.20 (red)
    Bar B (bullish): o=50.20, h=52.00, l=47.82, c=51.80 (green, vol=3500)
    diff = 0.02, tol = 0.0015*47.80 = 0.0717 → passes
    """
    bars = _downtrend(15, 60.0, 50.0, vol=1000.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.50, 50.60, 47.80, 50.20, 1200.0))
    t += DT
    bars.append(_bar(t, 50.20, 52.00, 47.82, 51.80, 3500.0))
    return bars


def _strong_geometry_with_context():
    """Paired positive control for neg_tweezer_mid_uptrend.

    IDENTICAL strong geometry: diff=0 (perfect tight lows), bar A bearish + bar B
    bullish (full reversal handoff), bar B vol = 2× avg. The ONLY difference from
    the negative fixture is genuine reversal context — a real 20-bar downtrend that
    places the pair at a swing low with a >5% recent decline.

    This fixture proves the reversal-context gate is context-selective (not a
    blanket suppressor). Same geometry that is REJECTED in the uptrend case is
    ACCEPTED here because reversal context is present.

    Verification:
      - is_swing_low: bar_b.l=48.00 = window minimum → ratio=0.0 ≤ 0.05 → True
      - recent_decline_pct: 15-bar high ≈ 59.6, bar_b.l=48.00
          decline ≈ (59.6-48.0)/59.6 = 19.5% >> 5% → True
      - has_reversal_context = True → gate PASSES

    Expected confidence ≈ 88.5:
      geom=100 (diff=0, handoff), vol=100 (ratio=2.0≥1.8), ctx=80 (swing_low+35
        + decline>10%+15 + base=30), hist=50
      0.40*100 + 0.25*100 + 0.20*80 + 0.15*50 = 40+25+16+7.5 = 88.5
    """
    bars = _downtrend(20, 65.0, 50.0, vol=1000.0)
    t = _last_t(bars)
    # Bar A: bearish (c < o), low=48.00 — full handoff
    bars.append(_bar(t, 49.80, 50.10, 48.00, 49.20, 1000.0))
    t += DT
    # Bar B: bullish (c > o), low=48.00 (diff=0), 2× avg volume
    bars.append(_bar(t, 49.20, 51.50, 48.00, 51.20, 2000.0))
    return bars


# ============================================================
# NEGATIVE FIXTURES
# ============================================================

def _lows_dont_match():
    """Lows differ by more than _MATCH_TOL — geometry gate fails.

    Bar A low = 48.00, Bar B low = 49.00.
    diff = 1.00, tol = 0.0015*48.00 = 0.072 → 1.00 >> 0.072 → fails.
    """
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.50, 50.60, 48.00, 50.20, 1200.0))
    t += DT
    bars.append(_bar(t, 50.20, 51.00, 49.00, 50.80, 1500.0))
    return bars


def _series_too_short():
    """Only one bar — series shorter than _MIN_BARS (7). Cannot form a tweezer pair."""
    return [_bar(T0, 50.0, 51.0, 49.0, 50.5, 1000.0)]


def _tweezer_mid_uptrend():
    """ADVERSARIAL negative: strongest possible geometry + volume, but clean uptrend.

    This is the exact adversarial construction the spec reviewer proved must fire
    WITHOUT the context gate (confidence = 78.5), and must return 0 detections
    WITH the gate. It is the anti-fixture-masking guard.

    Geometry: PERFECT — tight lows, diff=0 (tightest possible), tightness_ratio=0
      → tightness_score=100. Bar A bearish + bar B bullish = full reversal handoff
      → handoff_bonus=15. geom = min(100, 115) = 100.

    Volume: bar B vol = 2× 20-bar avg → ratio=2.0 >= 1.8 → vol_score=100.

    Context gate check (ALL THREE must be False):
      - is_swing_low: 50-bar uptrend from 60→100. In the 10-bar lookback the
        OLDER bars have LOWER lows (~93-99). bar_b.l=99.00 sits at the TOP of
        the window → ratio ≈ 0.79 >> 0.05 → False.
      - below_50sma: bar_b.c≈100.30, SMA50≈81.7 → False.
      - recent_decline_pct: 15-bar high≈100.5, bar_b.l=99.00
          decline ≈ (100.5-99.0)/100.5 = 1.49% << 5% → False.

    All three False → has_reversal_context=False → DISCARDED by gate unconditionally.
    0 detections. NOT because geometry was weakened.

    BEFORE gate (for documentation): conf=78.5
      geom=100, vol=100, ctx=30 (base only), hist=50
      0.40*100 + 0.25*100 + 0.20*30 + 0.15*50 = 40+25+6+7.5 = 78.5

    Paired positive control: pos_strong_geometry_with_context uses identical
    geometry + volume but with a genuine swing low after a >5% decline —
    that fixture MUST fire strongly to prove the gate is context-selective,
    not a blanket suppressor.
    """
    bars = _uptrend(50, 60.0, 100.0)
    t = _last_t(bars)
    # Bar A: bearish (c < o) — full reversal handoff setup
    bars.append(_bar(t, 99.80, 100.10, 99.00, 99.40, 1000.0))
    t += DT
    # Bar B: bullish (c > o), diff=0, 2× avg volume — strongest possible geometry
    bars.append(_bar(t, 99.40, 100.50, 99.00, 100.30, 2000.0))
    return bars


def _highs_match_not_lows():
    """Highs are similar but lows don't match — that's tweezer TOP territory.

    high_a = 55.00, high_b = 55.02 (very close)
    low_a = 53.00, low_b = 51.00 (differ by 2.00 >> tol=0.0795)
    Lows don't match → tweezer BOTTOM gate fails.
    """
    bars = _downtrend(15, 65.0, 54.0)
    t = _last_t(bars)
    bars.append(_bar(t, 54.80, 55.00, 53.00, 54.20, 1200.0))
    t += DT
    bars.append(_bar(t, 54.20, 55.02, 51.00, 54.80, 1400.0))
    return bars


def _non_consecutive_lows():
    """Matching lows but bars are not consecutive — a gap bar separates them.

    The detector scans consecutive pairs (i, i+1). Two bars with matching lows
    at positions i and i+2 (with a different bar between them) do NOT form a pair.
    """
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    # Bar A: low=48.00
    bars.append(_bar(t, 50.50, 50.60, 48.00, 50.10, 1200.0))
    t += DT
    # Gap bar (very different low)
    bars.append(_bar(t, 50.10, 51.00, 50.00, 50.80, 900.0))
    t += DT
    # Bar C: low=48.01 (matches Bar A but not consecutive with it)
    bars.append(_bar(t, 50.80, 51.20, 48.01, 51.10, 1500.0))
    return bars


def _no_context_flat_chop():
    """Matching lows in flat choppy price action — no swing-low/decline context.

    Isolates the 'no reversal context' failure via WEAK geometry + VERY low volume.
    All other consecutive bar pairs have lows that differ >> _MATCH_TOL (no accidental
    valid pairs in the non-intended region).

    Math for the intended pair (low_a=50.20, low_b=50.267):
      diff = 0.067, matched_low=50.20, tol=0.0015*50.20=0.0753
      tightness_ratio = 0.067/0.0753 = 0.890
      tightness_score = 30+(1.0-0.890)/0.5*40 = 30+8.8 = 38.8
      No reversal handoff (both bullish) -> geom = 38.8

    Volume design: bar B vol=1, avg of preceding 10 bars = 1000.
      ratio = 1/1000 = 0.001 -> vol_score = 30*0.001/0.7 = 0.043

    Context: alternating-low chop bars ensure the 10-bar window has lows of 48.00
      (well below 50.20) so bar_b.l is NOT the window minimum.
      is_swing_low: (50.267 - 48.00) / (52.0 - 48.00) = 0.567 >> 0.05 -> False
      15-bar max_h = 52.0, pair_b.l=50.267, decline=(52.0-50.267)/52.0=3.3% < 5%
      ctx_score = 30 (base) + 5 (stage=1) = 35

    conf = 0.4*38.8 + 0.25*0.043 + 0.2*35 + 0.15*50
         = 15.52 + 0.011 + 7.0 + 7.5 = 30.03 << 50 CONFIRMED.

    Chop bars use ALTERNATING lows (adjacent differences >> tol):
      lows: 50.20, 48.00, 51.50, 47.50, 52.00, 48.50, 51.00, 49.00, 50.80, 48.00
      Adjacent deltas: 2.20, 3.50, 4.00, 4.50, 3.50, 2.50, 2.00, 1.80, 2.80
      All >> 0.075 -> no accidental tweezer pairs.
    Then the intended pair follows: low_a=50.20, low_b=50.267 (diff=0.067 < tol=0.075).
    """
    bars = []
    t = T0
    # 10 chop bars with ALTERNATING lows >> tol apart (no consecutive matching)
    chop_data = [
        (50.50, 52.00, 50.20, 51.80),   # l=50.20
        (51.80, 52.00, 48.00, 51.90),   # l=48.00  (delta=2.20)
        (51.90, 52.00, 51.50, 51.80),   # l=51.50  (delta=3.50)
        (51.80, 52.00, 47.50, 51.90),   # l=47.50  (delta=4.00)
        (51.90, 52.00, 51.20, 51.80),   # l=51.20  (delta=3.70)
        (51.80, 52.00, 48.50, 51.90),   # l=48.50  (delta=2.70)
        (51.90, 52.00, 51.00, 51.80),   # l=51.00  (delta=2.50)
        (51.80, 52.00, 49.00, 51.90),   # l=49.00  (delta=2.00)
        (51.90, 52.00, 50.80, 51.80),   # l=50.80  (delta=1.80)
        (51.80, 52.00, 48.00, 51.90),   # l=48.00  (delta=2.80)
    ]
    for (o, h, l, c) in chop_data:
        bars.append(_bar(t, o, h, l, c, 1000.0))
        t += DT
    # Intended pair: both bullish, LOW_B near tol boundary, EXTREMELY low vol on bar B
    bars.append(_bar(t, 50.60, 51.90, 50.20, 51.70, 1000.0))    # bar A (bullish)
    t += DT
    bars.append(_bar(t, 51.70, 52.00, 50.267, 51.90, 1.0))       # bar B (bullish, vol=1)
    return bars


def _single_hammer_bar():
    """Single hammer-like bar — not a 2-bar tweezer (only one bar in scan window)."""
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    # One hammer-like bar, no second bar to form a pair
    bars.append(_bar(t, 50.10, 50.45, 48.60, 50.40, 1800.0))
    return bars


def _pair_outside_scan_window():
    """Matching pair is too far back — outside the scan window.

    The detector scans the last _SCAN_LOOKBACK=6 bars for pairs (bar B at index i,
    bar A at index i-1). A qualifying pair at position (pair_a=idx, pair_b=idx+1)
    is only found if pair_b >= len(bars) - _SCAN_LOOKBACK.

    After the valid tweezer pair, add STRICTLY VARYING chop bars whose adjacent
    lows CANNOT match each other (differ by more than _MATCH_TOL). This prevents
    any new valid pairs from forming in the chop region.

    Chop bars use alternating lows: 53.00, 51.00, 54.00, 50.00, 52.00, 55.00...
    Adjacent differences: 2.00 >> tol ≈ 0.0765 (0.15% of 51) → no pairs form.
    """
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    # Valid tweezer pair (pair_b will be pushed outside scan window)
    bars.append(_bar(t, 50.50, 50.55, 48.00, 50.00, 1500.0))
    t += DT
    bars.append(_bar(t, 50.00, 51.20, 48.02, 51.10, 2000.0))
    t += DT
    # Add 8 strictly non-matching chop bars (adjacent lows differ >> tol)
    # Alternating between HIGH and LOW inside a range, so no adjacent pair matches
    chop_lows = [53.00, 50.50, 54.00, 50.00, 53.50, 49.50, 52.00, 51.00]
    chop_highs = [55.00, 52.00, 56.00, 52.00, 55.50, 51.50, 54.00, 53.00]
    for lo, hi in zip(chop_lows, chop_highs):
        bars.append(_bar(t, lo + 1.0, hi, lo, hi - 0.5, 1200.0))
        t += DT
    return bars


# ============================================================
# EDGE FIXTURES
# ============================================================

def _exact_tolerance_must_fire():
    """abs(low_a - low_b) EXACTLY == _MATCH_TOL (nominal) — inclusive boundary, MUST fire.

    matched_low = 50.00
    _MATCH_TOL = 0.0015 * 50.00 = 0.075
    low_a = 50.00, low_b = 50.075

    IEEE 754 / _EPS truth (established by Python computation):
      50.075 is NOT exactly representable in IEEE 754 double.
      The nearest double is 50.07500000000000284... (stores ABOVE nominal 50.075).

      Computed values:
        low_a  = 50.00  (exactly representable)
        low_b  = 50.075 (stored as 50.07500000000000284...)
        diff   = abs(50.075 - 50.00) = 0.07500000000000284  (> 0.075 by ~2.84e-15)
        tol    = 0.0015 * 50.00     = 0.075                 (exact for this price)

      diff > tol by ~2.84e-15. WITHOUT _EPS the gate:
          diff <= tol  →  0.07500000000000284 <= 0.075  →  FALSE → WRONGLY REJECTED.
      WITH _EPS = 1e-9:
          diff <= tol + 1e-9  →  True → CORRECTLY ACCEPTED.

      Conclusion: _EPS IS LOAD-BEARING. It is not merely defensive — the exact-
      tolerance pair would be wrongly rejected without it. _EPS = 1e-9 >> 2.84e-15
      provides the necessary correction for this IEEE 754 boundary case.
    """
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    low_a = 50.00
    # Set low_b exactly at the tolerance boundary
    matched_low = low_a
    tol = _MATCH_TOL_PCT * matched_low   # = 0.0015 * 50.00 = 0.075 (approximately)
    low_b = low_a + tol                   # = 50.075 (approximately; IEEE 754 inexact)
    # Bar A: bearish, low=low_a
    bars.append(_bar(t, 50.80, 50.90, low_a, 50.40, 1500.0))
    t += DT
    # Bar B: bullish, low=low_b (right at tolerance)
    bars.append(_bar(t, 50.40, 52.00, round(low_b, 4), 51.80, 2000.0))
    return bars


def _just_over_tolerance_no_fire():
    """abs(low_a - low_b) just OVER _MATCH_TOL — MUST NOT fire.

    matched_low = 50.00
    _MATCH_TOL = 0.0015 * 50.00 ≈ 0.075
    We use low_b = low_a + 0.10 (diff = 0.10 >> tol = 0.075) — well over.
    Using a clean 0.10 delta avoids any float-residue ambiguity:
      diff = 0.10 > 0.075 + 1e-9 → gate rejects.
    """
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    low_a = 50.00
    low_b = 50.10   # diff = 0.10, tol ≈ 0.075 → 0.10 > 0.075 → fails
    # Bar A: bearish, low=low_a
    bars.append(_bar(t, 50.80, 50.90, low_a, 50.40, 1500.0))
    t += DT
    # Bar B: bullish, low=low_b
    bars.append(_bar(t, 50.40, 52.00, low_b, 51.80, 2000.0))
    return bars


def _extreme_swing_low_boundary():
    """Tweezer pair exactly at the swing-low extreme — context boundary test.

    A steep 20-bar downtrend places the pair at the absolute bottom.
    Both bars have nearly identical lows. Tests that the context logic
    recognizes an extreme swing low even when the downtrend is very steep.
    Bar A: bearish, low=45.00
    Bar B: bullish, low=45.03 (diff=0.03, tol=0.0015*45.00=0.0675 → passes)
    """
    bars = _downtrend(20, 65.0, 45.0)
    t = _last_t(bars)
    bars.append(_bar(t, 46.00, 46.20, 45.00, 45.50, 1600.0))
    t += DT
    bars.append(_bar(t, 45.50, 47.00, 45.03, 46.80, 2400.0))
    return bars


# ============================================================
# CONTEXT DEFINITIONS
# ============================================================

BEARISH_CONTEXT = {
    "trend_stage": 4,
    "rs_trend": "down",
    "ma_alignment": "stacked_bearish",
    "volume_signature": "neutral",
    "regime": "bearish",
    "nearest_resistance": 60.0,
    "nearest_support": 48.00,
    "days_to_earnings": None,
    "sector_strength_rank": None,
}

DECLINE_CONTEXT = {
    "trend_stage": 4,
    "rs_trend": "down",
    "ma_alignment": "stacked_bearish",
    "volume_signature": "neutral",
    "regime": "bearish",
    "nearest_resistance": 65.0,
    "nearest_support": None,
    "days_to_earnings": None,
    "sector_strength_rank": None,
}

SUPPORT_CONTEXT = {
    "trend_stage": 4,
    "rs_trend": "down",
    "ma_alignment": "stacked_bearish",
    "volume_signature": "neutral",
    "regime": "bearish",
    "nearest_resistance": 65.0,
    "nearest_support": 48.00,    # pair is right at this level
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

UPTREND_CONTEXT = {
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

# Context for the strong-geometry-with-context paired positive control.
# Stage 4 downtrend, bearish regime, no mapped support (swing low provides context).
STRONG_GEOM_REVERSAL_CONTEXT = {
    "trend_stage": 4,
    "rs_trend": "down",
    "ma_alignment": "stacked_bearish",
    "volume_signature": "neutral",
    "regime": "bearish",
    "nearest_resistance": 65.0,
    "nearest_support": None,
    "days_to_earnings": None,
    "sector_strength_rank": None,
}

EDGE_CONTEXT = {
    "trend_stage": 4,
    "rs_trend": "down",
    "ma_alignment": "stacked_bearish",
    "volume_signature": "neutral",
    "regime": "bearish",
    "nearest_resistance": 60.0,
    "nearest_support": 50.0,
    "days_to_earnings": None,
    "sector_strength_rank": None,
}

STEEP_DOWN_CONTEXT = {
    "trend_stage": 4,
    "rs_trend": "down",
    "ma_alignment": "stacked_bearish",
    "volume_signature": "neutral",
    "regime": "bearish",
    "nearest_resistance": 65.0,
    "nearest_support": 45.0,
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
    _write("pos_textbook_bearish_a_bullish_b", "positive",
           _textbook_bearish_a_bullish_b(), BEARISH_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("pos_tweezer_after_decline", "positive",
           _tweezer_after_decline(), DECLINE_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("pos_tweezer_at_support", "positive",
           _tweezer_at_support(), SUPPORT_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("pos_same_direction_both_bearish", "positive",
           _same_direction_both_bearish(), BEARISH_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("pos_high_volume_bar_b", "positive",
           _high_volume_bar_b(), BEARISH_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    # Paired positive control: identical strong geometry as neg_tweezer_mid_uptrend
    # but WITH reversal context. Proves the gate is context-selective.
    _write("pos_strong_geometry_with_context", "positive",
           _strong_geometry_with_context(), STRONG_GEOM_REVERSAL_CONTEXT,
           {"fires": True, "min_confidence": 80.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    # ── 8 NEGATIVE ──────────────────────────────────────────────────────
    _write("neg_lows_dont_match", "negative",
           _lows_dont_match(), BEARISH_CONTEXT, {"fires": False})

    _write("neg_series_too_short", "negative",
           _series_too_short(), NEUTRAL_CONTEXT, {"fires": False})

    _write("neg_tweezer_mid_uptrend", "negative",
           _tweezer_mid_uptrend(), UPTREND_CONTEXT, {"fires": False})

    _write("neg_highs_match_not_lows", "negative",
           _highs_match_not_lows(), BEARISH_CONTEXT, {"fires": False})

    _write("neg_non_consecutive_lows", "negative",
           _non_consecutive_lows(), BEARISH_CONTEXT, {"fires": False})

    _write("neg_no_context_flat_chop", "negative",
           _no_context_flat_chop(), NEUTRAL_CONTEXT, {"fires": False})

    _write("neg_single_hammer_bar", "negative",
           _single_hammer_bar(), BEARISH_CONTEXT, {"fires": False})

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

    _write("edge_extreme_swing_low_boundary", "edge",
           _extreme_swing_low_boundary(), STEEP_DOWN_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    print("\nDone — 17 fixtures written (6 pos / 8 neg / 3 edge).")


if __name__ == "__main__":
    main()
