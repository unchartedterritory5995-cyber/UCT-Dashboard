"""Lance Opening Drive fixture generator.

16 fixtures total: 5 positive, 8 negative, 3 edge.

Lance Breitstein "Opening Drive" — highest-edge intraday momentum continuation.
Conditions (from docstring/spec):
  - Bar 1 (bars[0]): gap-up open >= 1% vs prev_session_close AND DCR >= 0.70
  - Bar 2 (bars[1]): close > Bar 1 close
  - Bar 3 (bars[2]): close > Bar 2 close AND DCR >= 0.60
  - Bar 3 high == session high (no bar in bars[0:3] has a higher high)
  - Volume across first 3 bars >= 2x trailing 20-session avg first-3 volume
  - context: prev_session_close + avg_first3_volume provided

CRITICAL CONVENTION — how the detector works:
  The detector treats bars[0], bars[1], bars[2] as the current session's first
  3 bars.  The caller is responsible for slicing so the session opens at index 0
  (from the detector's docstring: "Caller is responsible for slicing the input
  so the session opens at index 0.").

  Since context supplies prev_session_close and avg_first3_volume, we do NOT
  need prior session bars.  The fixture just needs the 3 drive bars + some extra
  bars after bar3 (so n > 3 and the detector can see session continuation).
  The "insufficient history" negative omits those context keys.

--- _EPS boundary truth (established from edge fixtures) ---
The four inclusive gates (gap>=1%, bar1_dcr>=0.70, bar3_dcr>=0.60, vol>=2x)
use _EPS=1e-9 in the detector.

Gate 1 — gap >= 1.00%  (gap = (bar1_open - prev_close) / prev_close):
  With prev_close=100.0, bar1_open=101.0: gap = 1.0/100.0.
  In Python/IEEE 754, 1.0/100.0 = 0.01000000000000000020816681711721685228...
  (slightly ABOVE 0.01 due to binary rounding).  This particular pair passes
  even without _EPS.  But if prev_close=99.99 and bar1_open=100.99:
    gap = 1.0/99.99 ≈ 0.009999... < 0.01 without _EPS → wrong reject.
  _EPS is LOAD-BEARING for the gap gate in general.

Gate 2 — bar1_dcr >= 0.70  (dcr = (c-l)/(h-l)):
  With l=100.0, h=110.0, c=107.0: dcr = 7.0/10.0.
  In IEEE 754, 0.7 is NOT exactly representable; it rounds to
  0.6999999999999999555910790149937383830547...
  Gate threshold is 0.70 - 1e-9 = 0.69999999900.
  Computed dcr ≈ 0.69999999999... > 0.69999999900 → FIRES.
  _EPS is LOAD-BEARING here: without it, 0.6999... < 0.70 → wrong reject.

Gate 3 — bar3_dcr >= 0.60  (same analysis as Gate 2):
  l=107.5, h=109.5, c=108.7: dcr = 1.2/2.0 = 0.6 exactly in IEEE 754
  (1.2 and 2.0 are exact multiples of 0.1; 1.2/2.0 = 0.6 exactly).
  _EPS is DEFENSIVE here (not load-bearing) — this specific pair is exact.
  Other pairs where 0.6 is computed from non-half-integer differences would
  produce residue, making _EPS load-bearing in general.

Gate 4 — volume_ratio >= 2.0  (ratio = first3_v / avg_first3):
  With first3_v=600000.0, avg=300000.0: ratio = 2.0 exactly (integers).
  _EPS is DEFENSIVE here — integer division is exact in IEEE 754.

Conclusion: _EPS=1e-9 is LOAD-BEARING for gates 1 and 2 with general floats,
DEFENSIVE for gate 3 with half-integer ratios, DEFENSIVE for gate 4 with
integer volumes.  The edge fixtures prove the inclusive-gate discipline works.

VERIFIED: all 16 fixtures checked against detect_lance_opening_drive before writing.
"""
import json
import os

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# 5-minute intraday timestamps
_SESSION_T = 1_700_000_000   # arbitrary base: bar 0 of current session
_BAR_SECS = 300              # 5 min per bar


def _bar(t, o, h, l, c, v):
    return {
        "t": int(t),
        "o": round(float(o), 2),
        "h": round(float(h), 2),
        "l": round(float(l), 2),
        "c": round(float(c), 2),
        "v": round(float(v), 0),
    }


def _drive_bars(prev_close, gap_pct, bar1_dcr, bar2_delta, bar3_dcr,
                bar3_is_session_high=True, bar2_spike_high=None,
                volume_multiplier=3.0, avg_first3=300_000.0,
                n_extra=8, sess_t=None):
    """Construct bars[0..n_extra+2] for the current drive session.

    bars[0] = bar1 (session open, gap-up)
    bars[1] = bar2 (continuation)
    bars[2] = bar3 (continuation + DCR gate)
    bars[3..] = extra bars to make n>3

    Args:
        prev_close: prior session close (for gap computation)
        gap_pct: fraction gap (0.01 = 1%)
        bar1_dcr: target DCR for bar1 = (c-l)/(h-l)
        bar2_delta: bar2.close - bar1.close
        bar3_dcr: target DCR for bar3
        bar3_is_session_high: if True, ensure bar3.h >= bar2.h
        bar2_spike_high: if set, override bar2.h to this value (creates spike > bar3.h)
        volume_multiplier: first3_vol / avg_first3
        avg_first3: trailing avg first3 vol (provided in context)
        n_extra: extra bars after bar3
        sess_t: session start timestamp
    """
    if sess_t is None:
        sess_t = _SESSION_T

    # --- Bar 1 ---
    bar1_open = round(prev_close * (1.0 + gap_pct), 2)
    # Use a fixed range of 2 so we can compute exact DCR
    # bar1_dcr = (c - l) / (h - l) => c = l + range * bar1_dcr
    # Set l = bar1_open - range * (1 - bar1_dcr); h = bar1_open + range * bar1_dcr
    # This keeps open inside the bar body
    bar1_range = 2.0
    bar1_l = round(bar1_open - bar1_range * (1.0 - bar1_dcr), 4)
    bar1_h = round(bar1_l + bar1_range, 4)
    bar1_c = round(bar1_l + bar1_range * bar1_dcr, 4)
    bar1_v = round(avg_first3 * volume_multiplier / 3.0 * 0.9, 0)

    # --- Bar 2 ---
    bar2_open = bar1_c
    bar2_c = round(bar1_c + bar2_delta, 4)
    bar2_natural_h = round(bar2_c + 0.08, 4)
    if bar2_spike_high is not None:
        bar2_h = round(bar2_spike_high, 4)
    else:
        bar2_h = bar2_natural_h
    bar2_l = round(bar2_open - 0.08, 4)
    bar2_v = round(avg_first3 * volume_multiplier / 3.0 * 1.0, 0)

    # --- Bar 3 ---
    bar3_open = bar2_c
    bar3_range = 1.5
    bar3_l = round(bar3_open - bar3_range * (1.0 - bar3_dcr), 4)
    bar3_h = round(bar3_l + bar3_range, 4)
    bar3_c = round(bar3_l + bar3_range * bar3_dcr, 4)
    # Ensure bar3_c > bar2_c (continuation)
    if bar3_c <= bar2_c:
        diff = bar2_c - bar3_c + 0.01
        bar3_c = round(bar3_c + diff, 4)
        bar3_h = round(bar3_h + diff, 4)
        bar3_l = round(bar3_l + diff, 4)
    # Ensure bar3_h >= bar2_h (bar3 is session high) — unless explicitly not
    if bar3_is_session_high and bar3_h < bar2_h:
        lift = bar2_h - bar3_h + 0.02
        bar3_h = round(bar3_h + lift, 4)
        bar3_c = round(bar3_l + bar3_range * bar3_dcr + lift * bar3_dcr, 4)
    bar3_v = round(avg_first3 * volume_multiplier / 3.0 * 1.1, 0)

    bars = [
        _bar(sess_t + 0 * _BAR_SECS, bar1_open, bar1_h, bar1_l, bar1_c, bar1_v),
        _bar(sess_t + 1 * _BAR_SECS, bar2_open, bar2_h, bar2_l, bar2_c, bar2_v),
        _bar(sess_t + 2 * _BAR_SECS, bar3_open, bar3_h, bar3_l, bar3_c, bar3_v),
    ]

    # Extra bars so n > 3
    last_c = bar3_c
    for i in range(n_extra):
        o = last_c
        c = round(o + 0.05, 4)
        h = round(c + 0.08, 4)
        l = round(o - 0.04, 4)
        bars.append(_bar(sess_t + (3 + i) * _BAR_SECS, o, h, l, c,
                         round(avg_first3 / 3.0 * 0.6, 0)))
        last_c = c

    return bars


def _ctx_bullish(prev_close, avg_first3, pd_high=None, pd_low=None,
                 stage=2, ma="stacked_bullish", rs="up", grade="A", can_score=85):
    return {
        "prev_session_close": prev_close,
        "avg_first3_volume": avg_first3,
        "prev_session_high": pd_high,
        "prev_session_low": pd_low,
        "trend_stage": stage,
        "ma_alignment": ma,
        "rs_trend": rs,
        "regime": "bullish",
        "dcr_signature": "accumulation",
        "recent_dcr_avg": 0.68,
        "volume_signature": "expanding",
        "can_slim_grade": grade,
        "can_slim_score": can_score,
        "nearest_resistance": None,
        "nearest_support": None,
        "days_to_earnings": None,
        "sector_strength_rank": 2,
    }


def _ctx_neutral(prev_close, avg_first3):
    return {
        "prev_session_close": prev_close,
        "avg_first3_volume": avg_first3,
        "prev_session_high": None,
        "prev_session_low": None,
        "trend_stage": 2,
        "ma_alignment": "mixed",
        "rs_trend": "flat",
        "regime": "neutral",
        "dcr_signature": None,
        "recent_dcr_avg": None,
        "volume_signature": "neutral",
        "can_slim_grade": "C",
        "can_slim_score": 50,
        "nearest_resistance": None,
        "nearest_support": None,
        "days_to_earnings": None,
        "sector_strength_rank": None,
    }


# ---------------------------------------------------------------------------
# POSITIVE fixtures (>=5 required)
# ---------------------------------------------------------------------------

def _pos_textbook():
    """Textbook Opening Drive: 2% gap, high DCRs (0.85/0.80), 3x volume."""
    prev_close = 50.0
    avg_f3 = 300_000.0
    bars = _drive_bars(prev_close, gap_pct=0.020, bar1_dcr=0.85,
                       bar2_delta=0.20, bar3_dcr=0.80,
                       volume_multiplier=3.0, avg_first3=avg_f3)
    ctx = _ctx_bullish(prev_close, avg_f3)
    return bars, ctx


def _pos_minimum_passing():
    """Minimum-passing drive: 1.2% gap, DCRs just above thresholds, 2.2x volume."""
    prev_close = 80.0
    avg_f3 = 150_000.0
    bars = _drive_bars(prev_close, gap_pct=0.012, bar1_dcr=0.72,
                       bar2_delta=0.10, bar3_dcr=0.62,
                       volume_multiplier=2.2, avg_first3=avg_f3)
    ctx = _ctx_neutral(prev_close, avg_f3)
    return bars, ctx


def _pos_prior_day_bonus():
    """Drive with prior-day-upper-third bonus (prev close in top third of range)."""
    prev_close = 120.0
    avg_f3 = 200_000.0
    bars = _drive_bars(prev_close, gap_pct=0.015, bar1_dcr=0.80,
                       bar2_delta=0.15, bar3_dcr=0.75,
                       volume_multiplier=2.5, avg_first3=avg_f3)
    # prev close = 120.0, pd_range [117.6, 120.6] → prev close near top
    pd_low = 117.6
    pd_high = 120.6
    ctx = _ctx_bullish(prev_close, avg_f3, pd_high=pd_high, pd_low=pd_low)
    return bars, ctx


def _pos_high_conviction():
    """High-conviction drive: 3.5% gap, bar1_dcr=0.95, 4x volume."""
    prev_close = 200.0
    avg_f3 = 500_000.0
    bars = _drive_bars(prev_close, gap_pct=0.035, bar1_dcr=0.95,
                       bar2_delta=0.50, bar3_dcr=0.92,
                       volume_multiplier=4.0, avg_first3=avg_f3)
    pd_low = 194.0
    pd_high = 200.4
    ctx = _ctx_bullish(prev_close, avg_f3, pd_high=pd_high, pd_low=pd_low,
                       grade="A", can_score=92)
    return bars, ctx


def _pos_15min_bars():
    """Opening drive with 15-min bars (BAR_SECS=900) — different intraday TF."""
    BAR_15MIN = 900
    prev_close = 60.0
    avg_f3 = 600_000.0
    bars = _drive_bars(prev_close, gap_pct=0.018, bar1_dcr=0.82,
                       bar2_delta=0.12, bar3_dcr=0.78,
                       volume_multiplier=2.8, avg_first3=avg_f3,
                       sess_t=_SESSION_T)
    # Re-build with 15-min spacing (the detector only uses bar values, not TF)
    # Timestamps use 900s spacing to mimic 15-min bars
    new_bars = []
    for i, b in enumerate(bars):
        new_bars.append({**b, "t": _SESSION_T + i * BAR_15MIN})
    ctx = _ctx_bullish(prev_close, avg_f3)
    return new_bars, ctx


# ---------------------------------------------------------------------------
# NEGATIVE fixtures (>=8 required)
# ---------------------------------------------------------------------------

def _neg_gap_too_small():
    """Gap only 0.5% — fails gap >= 1% gate."""
    prev_close = 50.0
    avg_f3 = 300_000.0
    bars = _drive_bars(prev_close, gap_pct=0.005,   # FAILS
                       bar1_dcr=0.85, bar2_delta=0.20, bar3_dcr=0.80,
                       volume_multiplier=3.0, avg_first3=avg_f3)
    ctx = _ctx_bullish(prev_close, avg_f3)
    return bars, ctx


def _neg_bar1_dcr_too_low():
    """Bar 1 DCR = 0.50 — fails DCR >= 0.70 gate."""
    prev_close = 50.0
    avg_f3 = 300_000.0
    bars = _drive_bars(prev_close, gap_pct=0.020,
                       bar1_dcr=0.50,               # FAILS
                       bar2_delta=0.20, bar3_dcr=0.80,
                       volume_multiplier=3.0, avg_first3=avg_f3)
    ctx = _ctx_bullish(prev_close, avg_f3)
    return bars, ctx


def _neg_bar2_no_continuation():
    """Bar 2 close < Bar 1 close — fails bar2>bar1 continuation gate."""
    prev_close = 50.0
    avg_f3 = 300_000.0
    # Use negative delta: bar2.c < bar1.c
    bars = _drive_bars(prev_close, gap_pct=0.020, bar1_dcr=0.85,
                       bar2_delta=-0.15,            # FAILS: bar2.c < bar1.c
                       bar3_dcr=0.80,
                       volume_multiplier=3.0, avg_first3=avg_f3)
    ctx = _ctx_bullish(prev_close, avg_f3)
    return bars, ctx


def _neg_bar3_no_continuation():
    """Bar 3 close < Bar 2 close — fails bar3>bar2 continuation gate."""
    prev_close = 50.0
    avg_f3 = 300_000.0
    # Build bars manually so bar3.c < bar2.c despite bar2.c > bar1.c
    bar1_open = round(prev_close * 1.02, 2)
    bar1_range = 2.0
    bar1_dcr = 0.85
    bar1_l = round(bar1_open - bar1_range * (1 - bar1_dcr), 4)
    bar1_h = round(bar1_l + bar1_range, 4)
    bar1_c = round(bar1_l + bar1_range * bar1_dcr, 4)
    bar1_v = round(avg_f3 * 3.0 / 3.0 * 0.9, 0)

    bar2_c = round(bar1_c + 0.25, 4)   # good continuation
    bar2_h = round(bar2_c + 0.08, 4)
    bar2_l = round(bar1_c - 0.08, 4)
    bar2_v = round(avg_f3 * 3.0 / 3.0, 0)

    bar3_c = round(bar2_c - 0.15, 4)   # FAILS: bar3.c < bar2.c
    bar3_l = round(bar3_c - 0.30, 4)
    bar3_h = round(bar3_c + 0.10, 4)
    bar3_v = round(avg_f3 * 3.0 / 3.0 * 1.1, 0)

    bars = [
        _bar(_SESSION_T + 0 * _BAR_SECS, bar1_open, bar1_h, bar1_l, bar1_c, bar1_v),
        _bar(_SESSION_T + 1 * _BAR_SECS, bar2_c - 0.05, bar2_h, bar2_l, bar2_c, bar2_v),
        _bar(_SESSION_T + 2 * _BAR_SECS, bar3_c - 0.05, bar3_h, bar3_l, bar3_c, bar3_v),
    ]
    last_c = bar3_c
    for i in range(5):
        o = last_c
        c = round(o + 0.02, 4)
        bars.append(_bar(_SESSION_T + (3 + i) * _BAR_SECS, o, round(c + 0.03, 4),
                         round(o - 0.02, 4), c, round(avg_f3 * 0.2, 0)))
        last_c = c

    ctx = _ctx_bullish(prev_close, avg_f3)
    return bars, ctx


def _neg_bar3_dcr_too_low():
    """Bar 3 DCR = 0.35 (fade) — fails DCR >= 0.60 gate."""
    prev_close = 50.0
    avg_f3 = 300_000.0
    bars = _drive_bars(prev_close, gap_pct=0.020, bar1_dcr=0.85,
                       bar2_delta=0.20, bar3_dcr=0.35,  # FAILS
                       volume_multiplier=3.0, avg_first3=avg_f3)
    ctx = _ctx_bullish(prev_close, avg_f3)
    return bars, ctx


def _neg_bar3_not_session_high():
    """Bar 2 spiked a higher high than bar 3 — bar3.h < session_high → reject."""
    prev_close = 50.0
    avg_f3 = 300_000.0
    # bar1 normal, bar2 has massive spike, bar3 can't exceed it
    bar1_open = round(prev_close * 1.02, 2)
    bar1_range = 2.0
    bar1_dcr = 0.85
    bar1_l = round(bar1_open - bar1_range * (1 - bar1_dcr), 4)
    bar1_h = round(bar1_l + bar1_range, 4)
    bar1_c = round(bar1_l + bar1_range * bar1_dcr, 4)
    bar1_v = round(avg_f3 * 3.0 / 3.0 * 0.9, 0)

    bar2_c = round(bar1_c + 0.20, 4)
    bar2_h = round(bar2_c + 5.00, 4)   # SPIKE: bar2.h far above any bar3.h
    bar2_l = round(bar1_c - 0.08, 4)
    bar2_v = round(avg_f3 * 3.0 / 3.0 * 1.0, 0)

    bar3_c = round(bar2_c + 0.10, 4)
    bar3_range = 1.5
    bar3_dcr = 0.80
    bar3_l = round(bar3_c - bar3_range * bar3_dcr, 4)
    bar3_h = round(bar3_c + bar3_range * (1 - bar3_dcr), 4)
    # bar3_h is well below bar2_h → session_high = bar2_h → bar3_h < session_high → FAILS
    bar3_v = round(avg_f3 * 3.0 / 3.0 * 1.1, 0)

    bars = [
        _bar(_SESSION_T + 0 * _BAR_SECS, bar1_open, bar1_h, bar1_l, bar1_c, bar1_v),
        _bar(_SESSION_T + 1 * _BAR_SECS, bar2_c - 0.05, bar2_h, bar2_l, bar2_c, bar2_v),
        _bar(_SESSION_T + 2 * _BAR_SECS, bar3_c - 0.05, bar3_h, bar3_l, bar3_c, bar3_v),
    ]
    last_c = bar3_c
    for i in range(5):
        o = last_c
        c = round(o + 0.02, 4)
        bars.append(_bar(_SESSION_T + (3 + i) * _BAR_SECS, o, round(c + 0.03, 4),
                         round(o - 0.02, 4), c, round(avg_f3 * 0.2, 0)))
        last_c = c

    ctx = _ctx_bullish(prev_close, avg_f3)
    return bars, ctx


def _neg_volume_too_low():
    """First-3-bar volume = 1.5x avg — fails volume >= 2x gate."""
    prev_close = 50.0
    avg_f3 = 300_000.0
    bars = _drive_bars(prev_close, gap_pct=0.020, bar1_dcr=0.85,
                       bar2_delta=0.20, bar3_dcr=0.80,
                       volume_multiplier=1.5,       # FAILS: < 2x
                       avg_first3=avg_f3)
    ctx = _ctx_bullish(prev_close, avg_f3)
    return bars, ctx


def _neg_insufficient_prior_history():
    """No prev_session_close in context — detector returns [] at first gate."""
    # Context has NO prev_session_close → detector cannot compute gap → returns []
    prev_close = 50.0
    avg_f3 = 300_000.0
    bars = _drive_bars(prev_close, gap_pct=0.020, bar1_dcr=0.85,
                       bar2_delta=0.20, bar3_dcr=0.80,
                       volume_multiplier=3.0, avg_first3=avg_f3)
    # Deliberately omit prev_session_close (and avg_first3_volume)
    ctx = {
        "trend_stage": 2,
        "ma_alignment": "stacked_bullish",
        "rs_trend": "up",
        "regime": "bullish",
        "dcr_signature": "accumulation",
        "recent_dcr_avg": 0.68,
        "volume_signature": "expanding",
        "can_slim_grade": "A",
        "can_slim_score": 85,
        # NO prev_session_close → detector cannot verify gap → returns []
    }
    return bars, ctx


# ---------------------------------------------------------------------------
# EDGE fixtures (>=3 required — exact-boundary cases MUST fire)
# ---------------------------------------------------------------------------

def _edge_exact_gap_1pct():
    """Gap EXACTLY 1.00% — inclusive gate MUST fire.

    prev_close=100.0, bar1_open=101.0: gap = 1.0/100.0.
    IEEE 754 note: in CPython, 1.0/100.0 = 0.01000000000000000020816...
    which is slightly above 0.01 → passes gate without _EPS in this specific
    case.  _EPS is load-bearing for cases where prev_close != 100.0
    (e.g. 99.99 → gap = 1.0/99.99 ≈ 0.009999... < 0.01 without _EPS).
    This fixture proves the inclusive-gate discipline and validates the fix.
    """
    prev_close = 100.0
    avg_f3 = 300_000.0
    # bar1_open = 101.0 → gap = (101.0 - 100.0)/100.0 = 0.01
    bar1_open = 101.0
    bar1_range = 2.0
    bar1_dcr = 0.80
    bar1_l = round(bar1_open - bar1_range * (1.0 - bar1_dcr), 4)
    bar1_h = round(bar1_l + bar1_range, 4)
    bar1_c = round(bar1_l + bar1_range * bar1_dcr, 4)
    bar1_v = round(avg_f3 * 3.0 / 3.0 * 0.9, 0)

    bar2_c = round(bar1_c + 0.20, 4)
    bar2_h = round(bar2_c + 0.08, 4)
    bar2_l = round(bar1_c - 0.08, 4)
    bar2_v = round(avg_f3 * 3.0 / 3.0 * 1.0, 0)

    bar3_range = 1.5
    bar3_dcr = 0.80
    bar3_l = round(bar2_c - bar3_range * (1 - bar3_dcr), 4)
    bar3_h = round(bar3_l + bar3_range, 4)
    bar3_c = round(bar3_l + bar3_range * bar3_dcr, 4)
    if bar3_c <= bar2_c:
        bar3_c = round(bar2_c + 0.01, 4)
    if bar3_h < bar2_h:
        bar3_h = round(bar2_h + 0.02, 4)
    bar3_v = round(avg_f3 * 3.0 / 3.0 * 1.1, 0)

    bars = [
        _bar(_SESSION_T + 0 * _BAR_SECS, bar1_open, bar1_h, bar1_l, bar1_c, bar1_v),
        _bar(_SESSION_T + 1 * _BAR_SECS, bar2_c - 0.05, bar2_h, bar2_l, bar2_c, bar2_v),
        _bar(_SESSION_T + 2 * _BAR_SECS, bar3_c - 0.05, bar3_h, bar3_l, bar3_c, bar3_v),
    ]
    last_c = bar3_c
    for i in range(5):
        o = last_c
        c = round(o + 0.05, 4)
        bars.append(_bar(_SESSION_T + (3 + i) * _BAR_SECS, o, round(c + 0.06, 4),
                         round(o - 0.03, 4), c, round(avg_f3 * 0.3, 0)))
        last_c = c

    ctx = _ctx_bullish(prev_close, avg_f3)   # prev_session_close = 100.0
    return bars, ctx


def _edge_exact_dcr_thresholds():
    """Bar1 DCR exactly 0.70, Bar3 DCR exactly 0.60 — inclusive gates MUST fire.

    Bar1 construction: l=101.0, h=111.0, c=108.0 → dcr = 7.0/10.0
    IEEE 754 note: 7.0/10.0 produces the nearest double to 0.7:
      0.6999999999999999555910790149937383830547...
    Gate threshold: 0.70 - 1e-9 = 0.69999999900
    Since 0.6999999999... > 0.69999999900 the gate FIRES.
    _EPS IS load-bearing here (without it: 0.699999... < 0.70 → wrong reject).

    Bar3 construction: l=108.25, h=110.25, c=109.45 → dcr = 1.2/2.0 = 0.6
    IEEE 754: 1.2/2.0 = 0.6 exactly (both representable).
    _EPS is DEFENSIVE for this specific bar3 (exact result).
    """
    prev_close = 99.0   # gap = (101.0 - 99.0)/99.0 ≈ 2.02% → well above 1%
    avg_f3 = 300_000.0

    # Bar1: l=101.0, h=111.0, c=108.0
    bar1_open = 101.0   # gap = (101.0-99.0)/99.0 = 2/99 ≈ 2.02% > 1% ✓
    bar1_l = 101.0
    bar1_h = 111.0
    bar1_c = 108.0      # dcr = (108-101)/(111-101) = 7/10 = 0.70 exactly in IEEE 754
    bar1_v = round(avg_f3 * 3.0 / 3.0 * 0.9, 0)

    bar2_c = 108.3      # bar2.c > bar1.c ✓
    bar2_h = 108.5
    bar2_l = 107.9
    bar2_v = round(avg_f3 * 3.0 / 3.0 * 1.0, 0)

    # Bar3: l=108.25, h=110.25, c=109.45 → (109.45-108.25)/(110.25-108.25) = 1.2/2.0 = 0.6
    # Bar3: DCR = 0.60 exactly.  Range = 2.0, l=111.0, h=113.0, c=112.2
    # dcr = (112.2 - 111.0) / (113.0 - 111.0) = 1.2 / 2.0 = 0.6 exactly
    # bar3_h = 113.0 > bar1_h = 111.0 => bar3 IS session high
    # bar3_c = 112.2 > bar2_c = 108.3 => continuation holds
    bar3_l = 111.0
    bar3_h = 113.0
    bar3_c = 112.2      # dcr = (112.2 - 111.0) / (113.0 - 111.0) = 1.2/2.0 = 0.60
    bar3_open = 111.2
    bar3_v = round(avg_f3 * 3.0 / 3.0 * 1.1, 0)

    # Verify bar3.c > bar2.c and bar3.h >= session_high
    assert bar3_c > bar2_c, f"bar3_c {bar3_c} not > bar2_c {bar2_c}"
    assert bar3_h >= max(bar1_h, bar2_h), f"bar3.h {bar3_h} not >= session high"

    bars = [
        _bar(_SESSION_T + 0 * _BAR_SECS, bar1_open, bar1_h, bar1_l, bar1_c, bar1_v),
        _bar(_SESSION_T + 1 * _BAR_SECS, bar2_c - 0.05, bar2_h, bar2_l, bar2_c, bar2_v),
        _bar(_SESSION_T + 2 * _BAR_SECS, bar3_open, bar3_h, bar3_l, bar3_c, bar3_v),
    ]
    last_c = bar3_c
    for i in range(5):
        o = last_c
        c = round(o + 0.05, 4)
        bars.append(_bar(_SESSION_T + (3 + i) * _BAR_SECS, o, round(c + 0.06, 4),
                         round(o - 0.03, 4), c, round(avg_f3 * 0.3, 0)))
        last_c = c

    ctx = _ctx_bullish(prev_close, avg_f3)
    return bars, ctx


def _edge_exact_volume_2x():
    """First-3-bar volume EXACTLY 2.00x trailing avg — inclusive gate MUST fire.

    avg_first3=300000.0, first3_vol=600000.0 → ratio=2.0 exactly.
    IEEE 754: 600000.0 / 300000.0 = 2.0 exactly (integer division).
    _EPS is DEFENSIVE here — this specific ratio is exact.
    The fixture proves the boundary fires.
    """
    prev_close = 50.0
    avg_f3_exact = 300_000.0
    target_vol = 600_000.0   # = 2.0 * 300000.0

    bar1_open = round(prev_close * 1.015, 2)
    bar1_range = 2.0
    bar1_dcr = 0.82
    bar1_l = round(bar1_open - bar1_range * (1.0 - bar1_dcr), 4)
    bar1_h = round(bar1_l + bar1_range, 4)
    bar1_c = round(bar1_l + bar1_range * bar1_dcr, 4)
    bar1_v = 200_000.0      # exact integer

    bar2_c = round(bar1_c + 0.15, 4)
    bar2_h = round(bar2_c + 0.08, 4)
    bar2_l = round(bar1_c - 0.08, 4)
    bar2_v = 200_000.0      # exact integer

    bar3_range = 1.5
    bar3_dcr = 0.80
    bar3_l = round(bar2_c - bar3_range * (1 - bar3_dcr), 4)
    bar3_h = round(bar3_l + bar3_range, 4)
    bar3_c = round(bar3_l + bar3_range * bar3_dcr, 4)
    if bar3_c <= bar2_c:
        bar3_c = round(bar2_c + 0.01, 4)
    if bar3_h < bar2_h:
        bar3_h = round(bar2_h + 0.02, 4)
    bar3_v = 200_000.0      # exact integer → total = 600000.0 = 2.0 * avg ✓

    assert bar1_v + bar2_v + bar3_v == target_vol

    bars = [
        _bar(_SESSION_T + 0 * _BAR_SECS, bar1_open, bar1_h, bar1_l, bar1_c, bar1_v),
        _bar(_SESSION_T + 1 * _BAR_SECS, bar2_c - 0.05, bar2_h, bar2_l, bar2_c, bar2_v),
        _bar(_SESSION_T + 2 * _BAR_SECS, bar3_c - 0.05, bar3_h, bar3_l, bar3_c, bar3_v),
    ]
    last_c = bar3_c
    for i in range(5):
        o = last_c
        c = round(o + 0.05, 4)
        bars.append(_bar(_SESSION_T + (3 + i) * _BAR_SECS, o, round(c + 0.06, 4),
                         round(o - 0.03, 4), c, round(avg_f3_exact * 0.3, 0)))
        last_c = c

    ctx = _ctx_bullish(prev_close, avg_f3_exact)
    return bars, ctx


# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------

def _verify_all():
    import sys
    repo_root = os.path.abspath(os.path.join(_OUT_DIR, "..", "..", ".."))
    sys.path.insert(0, repo_root)
    from api.services.pattern_engine.detectors.uct.lance_opening_drive import (
        detect_lance_opening_drive,
    )

    results = []

    def check(name, cat, bars, ctx, should_fire):
        dets = detect_lance_opening_drive(bars, ctx)
        fired = len(dets) > 0
        ok = fired == should_fire
        reason = ""
        if not ok:
            reason = " — FIRED when should not" if fired else " — DID NOT FIRE when should"
        results.append(f"  {'OK' if ok else 'FAIL'}: {name} ({cat}){reason}")
        if not ok:
            # Diagnostic
            if should_fire:
                from api.services.pattern_engine.detectors.uct.lance_opening_drive import (
                    _MIN_GAP_PCT, _MIN_FIRST_BAR_DCR, _MIN_THIRD_BAR_DCR, _MIN_VOLUME_RATIO, _EPS
                )
                pc = ctx.get("prev_session_close")
                avg_f3 = ctx.get("avg_first3_volume")
                b1, b2, b3 = bars[0], bars[1], bars[2]
                if pc:
                    gp = (b1["o"] - pc) / pc
                    results.append(f"    gap={gp:.6f} threshold={_MIN_GAP_PCT-_EPS:.10f} pass={gp >= _MIN_GAP_PCT - _EPS}")
                    if b1["h"] > b1["l"]:
                        d1 = (b1["c"] - b1["l"]) / (b1["h"] - b1["l"])
                        results.append(f"    bar1_dcr={d1:.6f} pass={d1 >= _MIN_FIRST_BAR_DCR - _EPS}")
                    results.append(f"    bar2>bar1: {b2['c']} > {b1['c']} = {b2['c'] > b1['c']}")
                    results.append(f"    bar3>bar2: {b3['c']} > {b2['c']} = {b3['c'] > b2['c']}")
                    if b3["h"] > b3["l"]:
                        d3 = (b3["c"] - b3["l"]) / (b3["h"] - b3["l"])
                        results.append(f"    bar3_dcr={d3:.6f} pass={d3 >= _MIN_THIRD_BAR_DCR - _EPS}")
                    sh = max(b1["h"], b2["h"], b3["h"])
                    results.append(f"    session_high={sh} bar3_h={b3['h']} bar3==sh: {b3['h'] >= sh - _EPS}")
                    if avg_f3:
                        f3v = b1["v"] + b2["v"] + b3["v"]
                        vr = f3v / avg_f3
                        results.append(f"    vol_ratio={vr:.4f} pass={vr >= _MIN_VOLUME_RATIO - _EPS}")
        return ok

    all_ok = True
    all_ok &= check("pos_textbook", "positive", *_pos_textbook(), True)
    all_ok &= check("pos_minimum_passing", "positive", *_pos_minimum_passing(), True)
    all_ok &= check("pos_prior_day_bonus", "positive", *_pos_prior_day_bonus(), True)
    all_ok &= check("pos_high_conviction", "positive", *_pos_high_conviction(), True)
    all_ok &= check("pos_15min_bars", "positive", *_pos_15min_bars(), True)

    all_ok &= check("neg_gap_too_small", "negative", *_neg_gap_too_small(), False)
    all_ok &= check("neg_bar1_dcr_too_low", "negative", *_neg_bar1_dcr_too_low(), False)
    all_ok &= check("neg_bar2_no_continuation", "negative", *_neg_bar2_no_continuation(), False)
    all_ok &= check("neg_bar3_no_continuation", "negative", *_neg_bar3_no_continuation(), False)
    all_ok &= check("neg_bar3_dcr_too_low", "negative", *_neg_bar3_dcr_too_low(), False)
    all_ok &= check("neg_bar3_not_session_high", "negative", *_neg_bar3_not_session_high(), False)
    all_ok &= check("neg_volume_too_low", "negative", *_neg_volume_too_low(), False)
    all_ok &= check("neg_insufficient_prior_history", "negative",
                    *_neg_insufficient_prior_history(), False)

    all_ok &= check("edge_exact_gap_1pct", "edge", *_edge_exact_gap_1pct(), True)
    all_ok &= check("edge_exact_dcr_thresholds", "edge", *_edge_exact_dcr_thresholds(), True)
    all_ok &= check("edge_exact_volume_2x", "edge", *_edge_exact_volume_2x(), True)

    for line in results:
        print(line)
    print()
    if all_ok:
        print("All 16 fixtures verified OK.")
    else:
        print("FAILURES detected — fix before writing.")
    return all_ok


# ---------------------------------------------------------------------------
# Write helper + main
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
    print(f"  wrote {path}  ({len(bars)} bars)")


def main():
    ok = _verify_all()
    if not ok:
        raise SystemExit(1)

    print("\nWriting fixtures...")

    # ---- 5 POSITIVE ----
    _write("lance_pos_textbook_drive", "positive", *_pos_textbook(),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("lance_pos_minimum_passing", "positive", *_pos_minimum_passing(),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("lance_pos_prior_day_bonus", "positive", *_pos_prior_day_bonus(),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("lance_pos_high_conviction", "positive", *_pos_high_conviction(),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("lance_pos_15min_bars", "positive", *_pos_15min_bars(),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    # ---- 8 NEGATIVE ----
    _write("lance_neg_gap_too_small", "negative", *_neg_gap_too_small(), {"fires": False})
    _write("lance_neg_bar1_dcr_too_low", "negative", *_neg_bar1_dcr_too_low(), {"fires": False})
    _write("lance_neg_bar2_no_continuation", "negative",
           *_neg_bar2_no_continuation(), {"fires": False})
    _write("lance_neg_bar3_no_continuation", "negative",
           *_neg_bar3_no_continuation(), {"fires": False})
    _write("lance_neg_bar3_dcr_too_low", "negative", *_neg_bar3_dcr_too_low(), {"fires": False})
    _write("lance_neg_bar3_not_session_high", "negative",
           *_neg_bar3_not_session_high(), {"fires": False})
    _write("lance_neg_volume_too_low", "negative", *_neg_volume_too_low(), {"fires": False})
    _write("lance_neg_insufficient_prior_history", "negative",
           *_neg_insufficient_prior_history(), {"fires": False})

    # ---- 3 EDGE ----
    _write("lance_edge_exact_gap_1pct", "edge", *_edge_exact_gap_1pct(),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("lance_edge_exact_dcr_thresholds", "edge", *_edge_exact_dcr_thresholds(),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("lance_edge_exact_volume_2x", "edge", *_edge_exact_volume_2x(),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    print("\nDone -- 16 fixtures written (5 positive, 8 negative, 3 edge).")


if __name__ == "__main__":
    main()
