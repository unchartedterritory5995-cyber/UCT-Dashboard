"""Lance Opening Drive fixture generator — REBUILT for real multi-session computation.

16+ fixtures total: 5 positive, 8 negative, 3 edge.

All fixtures use genuine multi-session intraday bar series:
  - >= 21 prior sessions of >= 3 bars each (satisfies _SESSIONS_FOR_AVG=20)
  - >= 60 prior bars (satisfies _PRIOR_SESSION_BARS=60)
  - NO reliance on injected prev_session_close or avg_first3_volume context keys
  - Session detection uses overnight time gaps > 4h (_SESSION_GAP_SECONDS=14400)
  - The detector computes prev_session_close and trailing-20-session avg from bars

Session structure in these fixtures:
  - N_PRIOR_SESSIONS = 21 prior sessions, each with N_BARS_PER_SESSION bars
  - Each prior session uses 5-min bars (DT=300s) within the session
  - Overnight gap between sessions: OVERNIGHT_GAP = 16h (57600s) >> 4h threshold
  - Normal first-3-bar volume per prior session: NORMAL_VOL_PER_BAR = 100_000
    (so normal avg_first3 ≈ 300_000 per session)

The trailing-20-session average of first-3-bar volume is computed by the
detector as: mean over the last 20 qualifying prior sessions of (s[0].v + s[1].v + s[2].v).
With NORMAL_VOL_PER_BAR=100_000, each prior session's first-3 sum ≈ 300_000,
so trailing_avg_first3 ≈ 300_000.

For a drive to pass the volume gate (>= 2x), the current session's first-3 total
must be >= 600_000.  Positive fixtures use volume_multiplier >= 2.0 applied to the
trailing average.

Contexts use build_context()-shaped dicts (no injected prev_session_close /
avg_first3_volume).  Positive contexts supply trend_stage=2, stacked_bullish, etc.

--- _EPS boundary truth ---
The four inclusive gates use _EPS=1e-9.  Analysis for REAL multi-session fixtures:

Gate 1 — gap >= 1.00%  (gap = (bar1_open - prev_close) / prev_close):
  prev_close is computed as the last bar's close of the preceding session.
  With prev_close = 99.0, bar1_open = 100.00 (rounded):
    gap = (100.00 - 99.0) / 99.0 = 1.0/99.0
    In IEEE 754: 1.0/99.0 = 0.010101... which is well above 0.01; no _EPS needed here.
  With prev_close = 100.0, bar1_open = 101.0:
    gap = 1.0/100.0 = 0.01000000000000000020816... (above 0.01); _EPS defensive.
  Edge fixture uses prev_close=100.0, bar1_open=101.00 for the exact-1% case;
  _EPS is DEFENSIVE for this specific pair (result lands above threshold).
  For general arbitrary prev_close (non-power-of-2 denominator), _EPS IS load-bearing.

Gate 2 — bar1_dcr >= 0.70:
  (7.0/10.0 in IEEE 754 = 0.70 exactly on CPython 3.14; _EPS defensive for this pair.)
  For general prices, _EPS is load-bearing.

Gate 3 — bar3_dcr >= 0.60:
  1.2/2.0 = 0.6 exactly; _EPS defensive for this specific pair.

Gate 4 — volume_ratio >= 2.0:
  600000.0 / 300000.0 = 2.0 exactly (integer division); _EPS defensive.

Conclusion: _EPS is LOAD-BEARING for general float inputs, DEFENSIVE for the
specific round-number values chosen in these fixtures.  Both are correct.
_EPS is an honest guard that ensures inclusive-gate discipline throughout.

VERIFIED: all fixtures checked against detect_lance_opening_drive before writing.
"""
import json
import os

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# Session timing constants
_DT = 300              # 5-min bar spacing (seconds within a session)
_DT_15MIN = 900        # 15-min bar spacing
_OVERNIGHT_GAP = 57600  # 16 hours between sessions (>> 4h detection threshold)
_N_PRIOR_SESSIONS = 21  # how many prior sessions to generate (>= 20 required)
_N_BARS_PER_SESSION = 8  # bars per prior session (>= 3 required; 8 gives realistic depth)
_NORMAL_VOL_PER_BAR = 100_000.0  # "normal" volume for prior sessions' all bars

# The trailing-20-session first-3-bar volume average:
# Each prior session has first-3 volume = 3 * _NORMAL_VOL_PER_BAR = 300_000.
# The trailing avg = 300_000. For >= 2x gate, current session first-3 >= 600_000.
_NORMAL_FIRST3_SUM = _NORMAL_VOL_PER_BAR * 3.0   # = 300_000


def _bar(t, o, h, l, c, v):
    return {
        "t": int(t),
        "o": round(float(o), 2),
        "h": round(float(h), 2),
        "l": round(float(l), 2),
        "c": round(float(c), 2),
        "v": round(float(v), 0),
    }


def _make_normal_session(t_start, base_price, dt=_DT, n_bars=_N_BARS_PER_SESSION,
                          first3_vol_per_bar=_NORMAL_VOL_PER_BAR,
                          tail_vol_per_bar=_NORMAL_VOL_PER_BAR):
    """Build a single 'normal' prior session.

    First 3 bars: volume = first3_vol_per_bar each.
    Remaining bars: volume = tail_vol_per_bar each.
    Price drifts slightly to make realistic data.
    Returns (bars, last_close, next_t).
    """
    bars = []
    t = t_start
    price = base_price
    for i in range(n_bars):
        o = round(price + (0.05 if i % 2 == 0 else -0.02), 2)
        c = round(o + 0.04, 2)
        h = round(max(o, c) + 0.08, 2)
        l = round(min(o, c) - 0.05, 2)
        if h <= l:
            h = round(l + 0.15, 2)
        v = first3_vol_per_bar if i < 3 else tail_vol_per_bar
        bars.append(_bar(t, o, h, l, c, v))
        t += dt
        price = c
    last_close = bars[-1]["c"]
    next_t = t_start + n_bars * dt + _OVERNIGHT_GAP
    return bars, last_close, next_t


def _make_prior_sessions(n_sessions=_N_PRIOR_SESSIONS, base_price=50.0,
                          t0=1_700_000_000, dt=_DT, n_bars=_N_BARS_PER_SESSION,
                          first3_vol_per_bar=_NORMAL_VOL_PER_BAR):
    """Build N prior sessions, all with normal volume.

    Returns (all_bars, last_close_of_final_session, t_after_last_session).
    """
    all_bars = []
    t = t0
    price = base_price
    last_close = price
    for _ in range(n_sessions):
        sess_bars, last_close, t = _make_normal_session(
            t, price, dt=dt, n_bars=n_bars,
            first3_vol_per_bar=first3_vol_per_bar,
            tail_vol_per_bar=first3_vol_per_bar,
        )
        all_bars.extend(sess_bars)
        price = last_close
    return all_bars, last_close, t


def _make_drive_session(t_start, prev_close, gap_pct, bar1_dcr, bar2_delta, bar3_dcr,
                         volume_multiplier, bar3_is_session_high=True,
                         bar2_spike_high=None, n_extra=5, dt=_DT,
                         trailing_avg_first3=_NORMAL_FIRST3_SUM):
    """Build the current session with an opening drive.

    The volume for first 3 bars is set so that first3_total = volume_multiplier * trailing_avg.

    Returns list of bars.
    """
    target_first3_total = trailing_avg_first3 * volume_multiplier

    # --- Bar 1 ---
    bar1_open = round(prev_close * (1.0 + gap_pct), 2)
    bar1_range = 2.0
    bar1_l = round(bar1_open - bar1_range * (1.0 - bar1_dcr), 4)
    bar1_h = round(bar1_l + bar1_range, 4)
    bar1_c = round(bar1_l + bar1_range * bar1_dcr, 4)
    bar1_v = round(target_first3_total * 0.34, 0)

    # --- Bar 2 ---
    bar2_open = bar1_c
    bar2_c = round(bar1_c + bar2_delta, 4)
    bar2_natural_h = round(bar2_c + 0.08, 4)
    if bar2_spike_high is not None:
        bar2_h = round(bar2_spike_high, 4)
    else:
        bar2_h = bar2_natural_h
    bar2_l = round(bar2_open - 0.08, 4)
    bar2_v = round(target_first3_total * 0.33, 0)

    # --- Bar 3 ---
    bar3_open = bar2_c
    bar3_range = 1.5
    bar3_l = round(bar3_open - bar3_range * (1.0 - bar3_dcr), 4)
    bar3_h = round(bar3_l + bar3_range, 4)
    bar3_c = round(bar3_l + bar3_range * bar3_dcr, 4)

    # Ensure bar3_c > bar2_c
    if bar3_c <= bar2_c:
        diff = bar2_c - bar3_c + 0.01
        bar3_c = round(bar3_c + diff, 4)
        bar3_h = round(bar3_h + diff, 4)
        bar3_l = round(bar3_l + diff, 4)

    # Ensure bar3_h >= bar2_h (session high)
    if bar3_is_session_high and bar3_h < bar2_h:
        lift = bar2_h - bar3_h + 0.02
        bar3_h = round(bar3_h + lift, 4)
        # Recompute bar3_c to preserve DCR after lift
        bar3_c = round(bar3_l + bar3_range * bar3_dcr + lift * bar3_dcr, 4)

    bar3_v = round(target_first3_total * 0.33, 0)

    bars = [
        _bar(t_start + 0 * dt, bar1_open, bar1_h, bar1_l, bar1_c, bar1_v),
        _bar(t_start + 1 * dt, bar2_open, bar2_h, bar2_l, bar2_c, bar2_v),
        _bar(t_start + 2 * dt, bar3_open, bar3_h, bar3_l, bar3_c, bar3_v),
    ]

    # Extra bars
    last_c = bar3_c
    for i in range(n_extra):
        o = last_c
        c = round(o + 0.05, 4)
        h = round(c + 0.08, 4)
        l = round(o - 0.04, 4)
        bars.append(_bar(t_start + (3 + i) * dt, o, h, l, c,
                         round(_NORMAL_VOL_PER_BAR * 0.6, 0)))
        last_c = c
    return bars


def _build_full_series(gap_pct, bar1_dcr, bar2_delta, bar3_dcr,
                        volume_multiplier, base_price=50.0,
                        bar3_is_session_high=True, bar2_spike_high=None,
                        n_prior=_N_PRIOR_SESSIONS, dt=_DT):
    """Build a full multi-session series: N prior sessions + current drive session.

    Returns (bars, build_context()-compatible context).
    """
    prior_bars, last_close, t_next = _make_prior_sessions(
        n_sessions=n_prior, base_price=base_price, t0=1_700_000_000, dt=dt)

    drive_bars = _make_drive_session(
        t_start=t_next,
        prev_close=last_close,
        gap_pct=gap_pct,
        bar1_dcr=bar1_dcr,
        bar2_delta=bar2_delta,
        bar3_dcr=bar3_dcr,
        volume_multiplier=volume_multiplier,
        bar3_is_session_high=bar3_is_session_high,
        bar2_spike_high=bar2_spike_high,
        dt=dt,
        trailing_avg_first3=_NORMAL_FIRST3_SUM,
    )

    all_bars = prior_bars + drive_bars
    ctx = _ctx_bullish()
    return all_bars, ctx


def _ctx_bullish(stage=2, ma="stacked_bullish", rs="up",
                  grade="A", can_score=85):
    """build_context()-shaped context — no injected prev_session_close or avg_first3_volume."""
    return {
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


def _ctx_neutral():
    return {
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
    """Textbook Opening Drive: 2% gap, high DCRs (0.85/0.80), 3x real trailing avg."""
    bars, ctx = _build_full_series(
        gap_pct=0.020, bar1_dcr=0.85, bar2_delta=0.20, bar3_dcr=0.80,
        volume_multiplier=3.0)
    return bars, ctx


def _pos_minimum_passing():
    """Minimum-passing drive: 1.2% gap, DCRs just above thresholds, 2.2x real avg."""
    bars, ctx = _build_full_series(
        gap_pct=0.012, bar1_dcr=0.72, bar2_delta=0.10, bar3_dcr=0.62,
        volume_multiplier=2.2)
    ctx = _ctx_neutral()
    return bars, ctx


def _pos_prior_day_bonus():
    """Drive with prior-day-upper-third bonus context."""
    bars, ctx = _build_full_series(
        gap_pct=0.015, bar1_dcr=0.80, bar2_delta=0.15, bar3_dcr=0.75,
        volume_multiplier=2.5)
    # Add optional prev_session_high/low for the prior-day-strength bonus
    # These are optional extras that the detector uses but does NOT require
    # (they don't affect whether the detector fires — just score bonus).
    # Using the last bar of the prior sessions as prev_close context.
    ctx["prev_session_high"] = 51.5
    ctx["prev_session_low"] = 48.5
    return bars, ctx


def _pos_high_conviction():
    """High-conviction drive: 3.5% gap, bar1_dcr=0.95, 4x real avg."""
    bars, ctx = _build_full_series(
        gap_pct=0.035, bar1_dcr=0.95, bar2_delta=0.50, bar3_dcr=0.92,
        volume_multiplier=4.0, base_price=200.0)
    ctx["prev_session_high"] = 204.0
    ctx["prev_session_low"] = 196.0
    ctx["can_slim_grade"] = "A"
    ctx["can_slim_score"] = 92
    return bars, ctx


def _pos_15min_bars():
    """Opening drive with 15-min bars — session detection still works via timestamps.

    _SESSION_GAP_SECONDS = 14400s (4h). Within a 15-min session, bars are
    spaced 900s apart (< 4h). Between sessions, overnight gap = 57600s (> 4h).
    Session partitioning works identically to 5-min bars.
    """
    bars, ctx = _build_full_series(
        gap_pct=0.018, bar1_dcr=0.82, bar2_delta=0.12, bar3_dcr=0.78,
        volume_multiplier=2.8, dt=_DT_15MIN)
    return bars, ctx


# ---------------------------------------------------------------------------
# NEGATIVE fixtures (>=8 required)
# ---------------------------------------------------------------------------

def _neg_gap_too_small():
    """Gap only 0.5% — fails gap >= 1% gate."""
    bars, ctx = _build_full_series(
        gap_pct=0.005, bar1_dcr=0.85, bar2_delta=0.20, bar3_dcr=0.80,
        volume_multiplier=3.0)
    return bars, ctx


def _neg_bar1_dcr_too_low():
    """Bar 1 DCR = 0.50 — fails DCR >= 0.70 gate."""
    bars, ctx = _build_full_series(
        gap_pct=0.020, bar1_dcr=0.50, bar2_delta=0.20, bar3_dcr=0.80,
        volume_multiplier=3.0)
    return bars, ctx


def _neg_bar2_no_continuation():
    """Bar 2 close < Bar 1 close — fails bar2>bar1 gate.

    bar2_delta = -0.15 means bar2.c = bar1.c - 0.15 < bar1.c.
    """
    bars, ctx = _build_full_series(
        gap_pct=0.020, bar1_dcr=0.85, bar2_delta=-0.15, bar3_dcr=0.80,
        volume_multiplier=3.0)
    return bars, ctx


def _neg_bar3_no_continuation():
    """Bar 3 close < Bar 2 close — fails bar3>bar2 gate.

    We build prior sessions normally, then construct the current session
    manually with bar3_c < bar2_c despite bar2_c > bar1_c.
    """
    prior_bars, last_close, t_next = _make_prior_sessions(
        n_sessions=_N_PRIOR_SESSIONS, base_price=50.0)

    # Build a drive session manually to violate bar3>bar2
    t = t_next
    gap_pct = 0.020
    bar1_open = round(last_close * (1.0 + gap_pct), 2)
    bar1_range = 2.0
    bar1_dcr = 0.85
    bar1_l = round(bar1_open - bar1_range * (1.0 - bar1_dcr), 4)
    bar1_h = round(bar1_l + bar1_range, 4)
    bar1_c = round(bar1_l + bar1_range * bar1_dcr, 4)
    bar1_v = round(_NORMAL_FIRST3_SUM * 3.0 * 0.34, 0)

    bar2_c = round(bar1_c + 0.25, 4)
    bar2_h = round(bar2_c + 0.08, 4)
    bar2_l = round(bar1_c - 0.08, 4)
    bar2_v = round(_NORMAL_FIRST3_SUM * 3.0 * 0.33, 0)

    bar3_c = round(bar2_c - 0.15, 4)   # FAILS: bar3.c < bar2.c
    bar3_l = round(bar3_c - 0.30, 4)
    bar3_h = round(bar3_c + 0.10, 4)
    bar3_v = round(_NORMAL_FIRST3_SUM * 3.0 * 0.33, 0)

    drive = [
        _bar(t + 0 * _DT, bar1_open, bar1_h, bar1_l, bar1_c, bar1_v),
        _bar(t + 1 * _DT, bar2_c - 0.05, bar2_h, bar2_l, bar2_c, bar2_v),
        _bar(t + 2 * _DT, bar3_c - 0.05, bar3_h, bar3_l, bar3_c, bar3_v),
    ]
    last_c = bar3_c
    for i in range(5):
        o = last_c
        c = round(o + 0.02, 4)
        drive.append(_bar(t + (3 + i) * _DT, o, round(c + 0.03, 4),
                          round(o - 0.02, 4), c, round(_NORMAL_VOL_PER_BAR * 0.2, 0)))
        last_c = c

    bars = prior_bars + drive
    return bars, _ctx_bullish()


def _neg_bar3_dcr_too_low():
    """Bar 3 DCR = 0.35 — fails DCR >= 0.60 gate."""
    bars, ctx = _build_full_series(
        gap_pct=0.020, bar1_dcr=0.85, bar2_delta=0.20, bar3_dcr=0.35,
        volume_multiplier=3.0)
    return bars, ctx


def _neg_bar3_not_session_high():
    """Bar 2 spiked a higher high than bar 3 — fails session-high gate.

    Implemented by passing bar2_spike_high into the drive builder so that
    bar2.h = bar1_c + 5.00, far above any bar3.h.
    """
    prior_bars, last_close, t_next = _make_prior_sessions(
        n_sessions=_N_PRIOR_SESSIONS, base_price=50.0)

    t = t_next
    gap_pct = 0.020
    bar1_open = round(last_close * (1.0 + gap_pct), 2)
    bar1_range = 2.0
    bar1_dcr = 0.85
    bar1_l = round(bar1_open - bar1_range * (1.0 - bar1_dcr), 4)
    bar1_h = round(bar1_l + bar1_range, 4)
    bar1_c = round(bar1_l + bar1_range * bar1_dcr, 4)
    bar1_v = round(_NORMAL_FIRST3_SUM * 3.0 * 0.34, 0)

    bar2_c = round(bar1_c + 0.20, 4)
    bar2_h = round(bar2_c + 5.00, 4)   # SPIKE — far above any bar3.h
    bar2_l = round(bar1_c - 0.08, 4)
    bar2_v = round(_NORMAL_FIRST3_SUM * 3.0 * 0.33, 0)

    bar3_c = round(bar2_c + 0.10, 4)
    bar3_range = 1.5
    bar3_dcr = 0.80
    bar3_l_calc = round(bar3_c - bar3_range * bar3_dcr, 4)
    bar3_h_calc = round(bar3_c + bar3_range * (1.0 - bar3_dcr), 4)
    # bar3_h is well below bar2_h → session_high = bar2_h → bar3_h < session_high → FAILS
    bar3_v = round(_NORMAL_FIRST3_SUM * 3.0 * 0.33, 0)

    drive = [
        _bar(t + 0 * _DT, bar1_open, bar1_h, bar1_l, bar1_c, bar1_v),
        _bar(t + 1 * _DT, bar2_c - 0.05, bar2_h, bar2_l, bar2_c, bar2_v),
        _bar(t + 2 * _DT, bar3_c - 0.05, bar3_h_calc, bar3_l_calc, bar3_c, bar3_v),
    ]
    last_c = bar3_c
    for i in range(5):
        o = last_c
        c = round(o + 0.02, 4)
        drive.append(_bar(t + (3 + i) * _DT, o, round(c + 0.03, 4),
                          round(o - 0.02, 4), c, round(_NORMAL_VOL_PER_BAR * 0.2, 0)))
        last_c = c

    bars = prior_bars + drive
    return bars, _ctx_bullish()


def _neg_volume_too_low():
    """First-3-bar volume = 1.5x real trailing avg — fails volume >= 2x gate."""
    bars, ctx = _build_full_series(
        gap_pct=0.020, bar1_dcr=0.85, bar2_delta=0.20, bar3_dcr=0.80,
        volume_multiplier=1.5)  # FAILS: 1.5x < 2x
    return bars, ctx


def _neg_insufficient_history():
    """Genuinely too few prior sessions — fails the _SESSIONS_FOR_AVG=20 gate.

    Builds only 10 prior sessions (< 20 required), all with >= 3 bars.
    The detector returns [] at the history gate, NOT because of a missing
    context key. This is the genuine insufficient-history path.
    """
    n_sessions = 10  # < _SESSIONS_FOR_AVG=20
    prior_bars, last_close, t_next = _make_prior_sessions(
        n_sessions=n_sessions, base_price=50.0)

    drive_bars = _make_drive_session(
        t_start=t_next,
        prev_close=last_close,
        gap_pct=0.020,
        bar1_dcr=0.85,
        bar2_delta=0.20,
        bar3_dcr=0.80,
        volume_multiplier=3.0,
        trailing_avg_first3=_NORMAL_FIRST3_SUM,
    )
    bars = prior_bars + drive_bars
    return bars, _ctx_bullish()


# ---------------------------------------------------------------------------
# EDGE fixtures (>=3 required — exact-boundary cases MUST fire)
# ---------------------------------------------------------------------------

def _edge_exact_gap_1pct():
    """Gap EXACTLY 1.00% — inclusive gate MUST fire.

    We control prev_close by forcing the last prior session's final bar
    close = 100.00, then setting bar1_open = 101.00.

    With prev_close=100.0, bar1_open=101.0:
      gap = (101.0 - 100.0) / 100.0 = 1.0/100.0
      In IEEE 754: 1.0/100.0 = 0.01000000000000000020816... (slightly above 0.01)
      _EPS is DEFENSIVE for this specific pair.
      For general prev_close values, _EPS IS load-bearing.
    """
    # Build 21 prior sessions with the last session ending at close=100.00
    prior_bars, _, t_next = _make_prior_sessions(
        n_sessions=_N_PRIOR_SESSIONS, base_price=98.0)

    # Override the last bar of the final prior session to close at 100.0
    # to get a clean prev_close for gap arithmetic.
    last_idx = len(prior_bars) - 1
    last_bar = prior_bars[last_idx]
    prior_bars[last_idx] = _bar(
        last_bar["t"], last_bar["o"], max(last_bar["h"], 100.02),
        min(last_bar["l"], 99.90), 100.0, last_bar["v"]
    )
    prev_close = 100.0
    bar1_open = 101.0   # gap = exactly (101.0 - 100.0) / 100.0

    bar1_range = 2.0
    bar1_dcr = 0.82
    bar1_l = round(bar1_open - bar1_range * (1.0 - bar1_dcr), 4)
    bar1_h = round(bar1_l + bar1_range, 4)
    bar1_c = round(bar1_l + bar1_range * bar1_dcr, 4)
    bar1_v = round(_NORMAL_FIRST3_SUM * 3.0 * 0.34, 0)

    bar2_c = round(bar1_c + 0.20, 4)
    bar2_h = round(bar2_c + 0.08, 4)
    bar2_l = round(bar1_c - 0.08, 4)
    bar2_v = round(_NORMAL_FIRST3_SUM * 3.0 * 0.33, 0)

    bar3_range = 1.5
    bar3_dcr = 0.82
    bar3_l = round(bar2_c - bar3_range * (1.0 - bar3_dcr), 4)
    bar3_h = round(bar3_l + bar3_range, 4)
    bar3_c = round(bar3_l + bar3_range * bar3_dcr, 4)
    if bar3_c <= bar2_c:
        bar3_c = round(bar2_c + 0.01, 4)
    if bar3_h < bar2_h:
        bar3_h = round(bar2_h + 0.02, 4)
    bar3_v = round(_NORMAL_FIRST3_SUM * 3.0 * 0.33, 0)

    drive = [
        _bar(t_next + 0 * _DT, bar1_open, bar1_h, bar1_l, bar1_c, bar1_v),
        _bar(t_next + 1 * _DT, bar2_c - 0.05, bar2_h, bar2_l, bar2_c, bar2_v),
        _bar(t_next + 2 * _DT, bar3_c - 0.05, bar3_h, bar3_l, bar3_c, bar3_v),
    ]
    last_c = bar3_c
    for i in range(5):
        o = last_c
        c = round(o + 0.05, 4)
        drive.append(_bar(t_next + (3 + i) * _DT, o, round(c + 0.06, 4),
                          round(o - 0.03, 4), c, round(_NORMAL_VOL_PER_BAR * 0.3, 0)))
        last_c = c

    bars = prior_bars + drive
    return bars, _ctx_bullish()


def _edge_exact_dcr_thresholds():
    """Bar1 DCR exactly 0.70, Bar3 DCR exactly 0.60 — inclusive gates MUST fire.

    Bar1: l=101.0, h=111.0, c=108.0 → dcr = (108-101)/(111-101) = 7.0/10.0
    In IEEE 754, 7.0/10.0 = 0.6999999999999999555... The gate threshold is
    0.70 - 1e-9 = 0.69999999900. Since 0.699999... > 0.6999999990, the gate FIRES.
    _EPS IS load-bearing for bar1_dcr: without it, 7/10 < 0.70 → wrong reject.

    Bar3: l=111.0, h=113.0, c=112.2 → dcr = 1.2/2.0 = 0.6 exactly.
    _EPS is DEFENSIVE for bar3_dcr (result is exact).
    """
    prior_bars, _, t_next = _make_prior_sessions(
        n_sessions=_N_PRIOR_SESSIONS, base_price=95.0)

    # Set prev_close = 99.0 so gap = (101.0-99.0)/99.0 = 2/99 ≈ 2.02% > 1%
    last_idx = len(prior_bars) - 1
    last_bar = prior_bars[last_idx]
    prior_bars[last_idx] = _bar(
        last_bar["t"], last_bar["o"], max(last_bar["h"], 99.10),
        min(last_bar["l"], 98.90), 99.0, last_bar["v"]
    )

    bar1_v = round(_NORMAL_FIRST3_SUM * 3.0 * 0.34, 0)
    bar2_v = round(_NORMAL_FIRST3_SUM * 3.0 * 0.33, 0)
    bar3_v = round(_NORMAL_FIRST3_SUM * 3.0 * 0.33, 0)

    drive = [
        _bar(t_next + 0 * _DT, 101.0, 111.0, 101.0, 108.0, bar1_v),
        # bar2: c > bar1.c=108.0; h >= bar1.h = 111.0 (will be beaten by bar3)
        _bar(t_next + 1 * _DT, 108.0, 108.5, 107.9, 108.3, bar2_v),
        # bar3: l=111.0, h=113.0, c=112.2; h > bar2.h → bar3 IS session high
        _bar(t_next + 2 * _DT, 111.2, 113.0, 111.0, 112.2, bar3_v),
    ]
    last_c = 112.2
    for i in range(5):
        o = last_c
        c = round(o + 0.05, 4)
        drive.append(_bar(t_next + (3 + i) * _DT, o, round(c + 0.06, 4),
                          round(o - 0.03, 4), c, round(_NORMAL_VOL_PER_BAR * 0.3, 0)))
        last_c = c

    bars = prior_bars + drive
    return bars, _ctx_bullish()


def _edge_exact_volume_2x():
    """First-3-bar volume EXACTLY 2.00x real trailing avg — inclusive gate MUST fire.

    The trailing avg is computed by the detector from the 20 most recent prior
    sessions' first-3 sums.  Each prior session has first-3 volume = 3 * 100_000 = 300_000.
    Trailing avg ≈ 300_000.

    For exactly 2.00x, we need first3_total = 600_000.0.
    We use bar1_v=200_000, bar2_v=200_000, bar3_v=200_000 = 600_000 total.
    Since 600_000 / 300_000 = 2.0 exactly (integer division), _EPS is DEFENSIVE.

    The fixture proves the inclusive-gate discipline fires at the exact boundary.
    """
    prior_bars, last_close, t_next = _make_prior_sessions(
        n_sessions=_N_PRIOR_SESSIONS, base_price=50.0,
        first3_vol_per_bar=_NORMAL_VOL_PER_BAR)

    # Build current session: bar volumes exactly = 200_000 each = 600_000 total
    gap_pct = 0.015
    bar1_open = round(last_close * (1.0 + gap_pct), 2)
    bar1_range = 2.0
    bar1_dcr = 0.82
    bar1_l = round(bar1_open - bar1_range * (1.0 - bar1_dcr), 4)
    bar1_h = round(bar1_l + bar1_range, 4)
    bar1_c = round(bar1_l + bar1_range * bar1_dcr, 4)
    bar1_v = 200_000.0  # exact integer

    bar2_c = round(bar1_c + 0.15, 4)
    bar2_h = round(bar2_c + 0.08, 4)
    bar2_l = round(bar1_c - 0.08, 4)
    bar2_v = 200_000.0  # exact integer

    bar3_range = 1.5
    bar3_dcr = 0.80
    bar3_l = round(bar2_c - bar3_range * (1.0 - bar3_dcr), 4)
    bar3_h = round(bar3_l + bar3_range, 4)
    bar3_c = round(bar3_l + bar3_range * bar3_dcr, 4)
    if bar3_c <= bar2_c:
        bar3_c = round(bar2_c + 0.01, 4)
    if bar3_h < bar2_h:
        bar3_h = round(bar2_h + 0.02, 4)
    bar3_v = 200_000.0  # exact integer

    # Verify: total = 600_000 = 2 * 300_000
    assert bar1_v + bar2_v + bar3_v == 600_000.0, (
        f"Expected 600_000.0 but got {bar1_v + bar2_v + bar3_v}"
    )

    drive = [
        _bar(t_next + 0 * _DT, bar1_open, bar1_h, bar1_l, bar1_c, bar1_v),
        _bar(t_next + 1 * _DT, bar2_c - 0.05, bar2_h, bar2_l, bar2_c, bar2_v),
        _bar(t_next + 2 * _DT, bar3_c - 0.05, bar3_h, bar3_l, bar3_c, bar3_v),
    ]
    last_c = bar3_c
    for i in range(5):
        o = last_c
        c = round(o + 0.05, 4)
        drive.append(_bar(t_next + (3 + i) * _DT, o, round(c + 0.06, 4),
                          round(o - 0.03, 4), c, round(_NORMAL_VOL_PER_BAR * 0.3, 0)))
        last_c = c

    bars = prior_bars + drive
    return bars, _ctx_bullish()


# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------

def _verify_all():
    import sys
    repo_root = os.path.abspath(os.path.join(_OUT_DIR, "..", "..", ".."))
    sys.path.insert(0, repo_root)
    from api.services.pattern_engine.detectors.uct.lance_opening_drive import (
        detect_lance_opening_drive, _partition_sessions,
        _SESSIONS_FOR_AVG, _PRIOR_SESSION_BARS,
    )
    from api.services.pattern_engine.primitives.context import build_context

    results = []
    all_ok = True

    def check(name, cat, bars, ctx, should_fire):
        nonlocal all_ok
        # Verify series stats
        sessions = _partition_sessions(bars)
        prior_sessions = sessions[:-1]
        prior_bars = sum(len(s) for s in prior_sessions)
        qualifying = [s for s in prior_sessions if len(s) >= 3]
        results.append(
            f"  {name}: {len(sessions)} sessions, {len(prior_sessions)} prior, "
            f"{len(qualifying)} qualifying (need {_SESSIONS_FOR_AVG}), "
            f"{prior_bars} prior bars (need {_PRIOR_SESSION_BARS})"
        )
        dets = detect_lance_opening_drive(bars, ctx)
        fired = len(dets) > 0
        ok = fired == should_fire
        if not ok:
            all_ok = False
            reason = " — FIRED when should not" if fired else " — DID NOT FIRE when should"
            results.append(f"    FAIL: {name}{reason}")
        else:
            results.append(f"    OK: {name} ({'fired' if fired else 'silent'})")
        return ok

    check("pos_textbook", "positive", *_pos_textbook(), True)
    check("pos_minimum_passing", "positive", *_pos_minimum_passing(), True)
    check("pos_prior_day_bonus", "positive", *_pos_prior_day_bonus(), True)
    check("pos_high_conviction", "positive", *_pos_high_conviction(), True)
    check("pos_15min_bars", "positive", *_pos_15min_bars(), True)

    check("neg_gap_too_small", "negative", *_neg_gap_too_small(), False)
    check("neg_bar1_dcr_too_low", "negative", *_neg_bar1_dcr_too_low(), False)
    check("neg_bar2_no_continuation", "negative", *_neg_bar2_no_continuation(), False)
    check("neg_bar3_no_continuation", "negative", *_neg_bar3_no_continuation(), False)
    check("neg_bar3_dcr_too_low", "negative", *_neg_bar3_dcr_too_low(), False)
    check("neg_bar3_not_session_high", "negative", *_neg_bar3_not_session_high(), False)
    check("neg_volume_too_low", "negative", *_neg_volume_too_low(), False)
    check("neg_insufficient_history", "negative", *_neg_insufficient_history(), False)

    check("edge_exact_gap_1pct", "edge", *_edge_exact_gap_1pct(), True)
    check("edge_exact_dcr_thresholds", "edge", *_edge_exact_dcr_thresholds(), True)
    check("edge_exact_volume_2x", "edge", *_edge_exact_volume_2x(), True)

    for line in results:
        print(line)
    print()
    if all_ok:
        print("All 16 fixtures verified OK.")
    else:
        print("FAILURES — fix before writing.")
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
    n_prior = len([b for b in bars])  # total bars
    print(f"  wrote {path}  ({len(bars)} bars total)")


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
    _write("lance_neg_insufficient_history", "negative",
           *_neg_insufficient_history(), {"fires": False})

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
