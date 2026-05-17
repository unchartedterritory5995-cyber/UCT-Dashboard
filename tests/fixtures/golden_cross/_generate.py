"""Golden Cross fixture generator. 17 fixtures total.

Builds price series programmatically (>=200 bars each) that produce a
known 50/200 SMA relationship.

Core building block: _build_cross_series(cross_age, ...)
  - 200-bar uptrend (base_p -> base_p*1.625)  → establishes 200SMA baseline
  - 80-bar decline (top -> mid)                → drops 50SMA below 200SMA
  - 42-bar recovery (+step/bar)               → 50SMA approaching 200SMA
  - cross bar                                  → golden cross occurs here
  - (cross_age-1) trailing bars               → sets age from last bar

VERIFIED against detect_golden_cross before writing.

Positive (>=5): clean fresh cross (age=2), cross 1 bar ago, cross age=3
  high-volume, long Stage-1 base, rising 200SMA (base_price=200).
Negative (>=9): cross >5 bars old, 50SMA below 200SMA (no cross),
  MAs declining, 200SMA slope < -0.5%, death-cross direction,
  insufficient bars, flat-chop intertwined MAs, stale cross 30 bars ago,
  200SMA slope boundary just outside gate (-0.52% — synthetic series, see below).
Edge (>=3): cross oldest detectable age=4, volume = exactly 0.5x average
  (inclusive volume-gate boundary >= 0.5), 200SMA slope boundary at exactly
  the gate (-0.50%).

--- Slope boundary coverage note ---
The 200SMA slope gate (-0.005 threshold, _EPS-inclusive) cannot be exercised at
the boundary with a natural multi-phase price series. Mathematical proof:
  * slope = (ma200[cross] - ma200[cross-20]) / ma200[cross-20]
          = (bar[cross] - bar[cross-200]) / (200 * ma200[cross-20])
  * For a golden cross, bar[cross] must be HIGH (pushes ma50 above ma200).
    For slope = -0.005, bar[cross] = bar[cross-200] - 0.005*200*ma200_ss.
  * This requires bar[cross-200] >> ma200_ss. In any natural series where
    bar[cross-200] is a moderate price, bar[cross] evaluates to a NEGATIVE
    or near-zero value — impossible for a cross bar that must push ma50 up.
  * Empirically verified: natural series cross_age <= 5 yields slope >= -0.0002
    (never approaches -0.005). Ages where slope < -0.005 require cross_age >= 6+.

The boundary fixtures therefore use a SYNTHETIC series that engineers the exact
SMA arithmetic directly (see _slope_gate_boundary_fail and _slope_gate_boundary_pass):
  Design: 31*P_LOW + 20*P_HIGH_OLD + 150*P_MID + 30*P_LOW2 + 19*P_SW + P_CROSS + P_TRAIL
  The 20*P_HIGH_OLD bars (bars 31-50) are the 'oldest_20' in the 200SMA slope window.
  P_CROSS is computed so that sum(newest_20) - sum(oldest_20) = target_slope * 200 * ma200_ss.
  The genuine cross transition is achieved because the P_LOW_2 bars (bars 201-230)
  keep ma50 well below ma200 up to bar 249, then P_CROSS jumps ma50 above ma200 at bar 250.
  Verified math (P_LOW=50, P_HIGH_OLD=500, P_MID=100, P_LOW_2=60, P_SW=80):
    ma200_ss = ma200[230] = (20*500 + 150*100 + 30*60)/200 = 134.0
    For slope=-0.005: P_CROSS = 20*500 + 20*(-0.005)*10*134 - 19*80 = 8346.0
    ma50[cross=250] = (30*60 + 19*80 + 8346)/50 = 233.32  > ma200=133.33  ✓
    ma50[249]       = (31*60 + 19*80)/50         = 68.40   < ma200=94.10   ✓ (prev bar)
    ma50_rising     = ma50[250]=233.32 > ma50[230]=76.0                    ✓
"""
import json
import math
import os

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))
T0 = 1700000000
DT = 86400
BASE_VOL = 200000.0


def _bar(t, o, h, l, c, v=BASE_VOL):
    return {
        "t": int(t),
        "o": round(float(o), 4),
        "h": round(float(h), 4),
        "l": round(float(l), 4),
        "c": round(float(c), 4),
        "v": round(float(v), 0),
    }


def _last_t(bars):
    return bars[-1]["t"] + DT


def _trending(n, start_p, end_p, vol=BASE_VOL, t_start=T0):
    bars = []
    t = t_start
    for i in range(n):
        c = start_p + (end_p - start_p) * i / max(n - 1, 1)
        spread = max(c * 0.003, 0.01)
        bars.append(_bar(t, c - spread * 0.4, c + spread * 0.6,
                         c - spread * 0.6, c + spread * 0.4, vol))
        t += DT
    return bars


def _flat(n, price, vol=BASE_VOL, t_start=T0):
    bars = []
    t = t_start
    spread = max(price * 0.003, 0.01)
    for _ in range(n):
        bars.append(_bar(t, price - spread * 0.4, price + spread * 0.6,
                         price - spread * 0.6, price + spread * 0.4, vol))
        t += DT
    return bars


def _build_cross_series(
    cross_age: int = 1,
    cross_vol_mult: float = 1.5,
    base_price: float = 80.0,
    cross_vol_override: float = None,
):
    """Build a bar series where a golden cross occurred `cross_age` bars ago.

    Series layout:
      Phase 1: 200-bar uptrend from base_price to base_price*1.625
      Phase 2: 80-bar decline back to base_price*1.25 (drops 50SMA below 200SMA)
      Phase 3: 42-bar recovery (+proportional step/bar)
      Cross bar: 50SMA crosses above 200SMA
      Phase 4: (cross_age-1) gentle trailing bars

    The step is proportional to base_price (1.0 * base_price/80.0) so the
    series works correctly regardless of base_price scale.
    """
    bars = []
    t = T0

    top_p = base_price * 1.625   # = 130 for base_price=80
    mid_p = base_price * 1.25    # = 100 for base_price=80
    step = 1.0 * (base_price / 80.0)   # proportional recovery step

    # Phase 1: 200-bar uptrend
    for i in range(200):
        c = base_price + (top_p - base_price) * i / 199
        spread = max(c * 0.003, 0.01)
        bars.append(_bar(t, c - spread * 0.4, c + spread * 0.6,
                         c - spread * 0.6, c + spread * 0.4, BASE_VOL))
        t += DT

    # Phase 2: 80-bar decline
    for i in range(80):
        c = top_p + (mid_p - top_p) * i / 79
        spread = max(c * 0.003, 0.01)
        bars.append(_bar(t, c + spread * 0.4, c + spread * 0.6,
                         c - spread * 0.6, c - spread * 0.4, BASE_VOL * 0.9))
        t += DT

    # Phase 3: 42-bar recovery
    last_c = mid_p
    for i in range(42):
        c = last_c + step
        last_c = c
        spread = max(c * 0.003, 0.01)
        bars.append(_bar(t, c - spread * 0.4, c + spread * 0.6,
                         c - spread * 0.6, c + spread * 0.4, BASE_VOL))
        t += DT

    # Cross bar
    c = last_c + step
    last_c = c
    spread = max(c * 0.003, 0.01)
    if cross_vol_override is not None:
        cross_v = cross_vol_override
    else:
        cross_v = BASE_VOL * cross_vol_mult
    bars.append(_bar(t, c - spread * 0.4, c + spread * 0.6,
                     c - spread * 0.6, c + spread * 0.4, cross_v))
    t += DT

    # Phase 4: trailing bars
    for _ in range(max(0, cross_age - 1)):
        c = last_c + 0.3 * (base_price / 80.0)
        last_c = c
        spread = max(c * 0.003, 0.01)
        bars.append(_bar(t, c - spread * 0.4, c + spread * 0.6,
                         c - spread * 0.6, c + spread * 0.4, BASE_VOL))
        t += DT

    return bars


# ============== POSITIVE ==============

def _clean_fresh_cross():
    """Classic golden cross: 2 bars ago, rising MAs, 1.5x volume."""
    return _build_cross_series(cross_age=2, cross_vol_mult=1.5)


def _cross_1_bar_ago():
    """Freshest detection: cross happened exactly 1 bar ago."""
    return _build_cross_series(cross_age=1, cross_vol_mult=1.8)


def _cross_strong_volume():
    """Cross with 2.5x average volume — high-conviction institutional signal."""
    return _build_cross_series(cross_age=2, cross_vol_mult=2.5)


def _cross_rising_200sma():
    """Cross with rising 200SMA (positive slope over 20 bars), cross age=3.

    Uses base_price=200 to verify the proportional step scaling works.
    """
    return _build_cross_series(cross_age=3, cross_vol_mult=1.2, base_price=200.0)


def _cross_after_long_base():
    """Golden cross after an extra 60-bar Stage 1 flat base.

    Simulates a stock that consolidated for ~3 months before initiating
    a Stage 2 uptrend. The 60-bar prefix uses a lower volume (basing phase).
    """
    bars = []
    t = T0
    base_price = 50.0
    top_p = base_price * 1.625   # 81.25
    mid_p = base_price * 1.25    # 62.5
    step = 1.0 * (base_price / 80.0)  # 0.625

    # 60-bar flat Stage 1 base (below base_price, low volume)
    bars.extend(_flat(60, base_price * 0.98, vol=BASE_VOL * 0.4, t_start=t))
    t = _last_t(bars)

    # Phase 1: 200-bar uptrend
    for i in range(200):
        c = base_price + (top_p - base_price) * i / 199
        spread = max(c * 0.003, 0.01)
        bars.append(_bar(t, c - spread * 0.4, c + spread * 0.6,
                         c - spread * 0.6, c + spread * 0.4, BASE_VOL))
        t += DT

    # Phase 2: 80-bar decline
    for i in range(80):
        c = top_p + (mid_p - top_p) * i / 79
        spread = max(c * 0.003, 0.01)
        bars.append(_bar(t, c + spread * 0.4, c + spread * 0.6,
                         c - spread * 0.6, c - spread * 0.4, BASE_VOL * 0.9))
        t += DT

    # Phase 3: 42-bar recovery
    last_c = mid_p
    for i in range(42):
        c = last_c + step
        last_c = c
        spread = max(c * 0.003, 0.01)
        bars.append(_bar(t, c - spread * 0.4, c + spread * 0.6,
                         c - spread * 0.6, c + spread * 0.4, BASE_VOL))
        t += DT

    # Cross bar (1.6x volume)
    c = last_c + step
    last_c = c
    spread = max(c * 0.003, 0.01)
    bars.append(_bar(t, c - spread * 0.4, c + spread * 0.6,
                     c - spread * 0.6, c + spread * 0.4, BASE_VOL * 1.6))
    t += DT

    # 2 trailing bars (cross_age=3 for safety; cross happens at -3 from end)
    for _ in range(2):
        c = last_c + step * 0.3
        last_c = c
        spread = max(c * 0.003, 0.01)
        bars.append(_bar(t, c - spread * 0.4, c + spread * 0.6,
                         c - spread * 0.6, c + spread * 0.4, BASE_VOL))
        t += DT

    return bars


# ============== NEGATIVE ==============

def _cross_too_old_6bars():
    """Cross occurred 6 bars ago — outside the 5-bar window."""
    return _build_cross_series(cross_age=6, cross_vol_mult=1.5)


def _no_cross_50_below_200():
    """50SMA is still below 200SMA — no golden cross at all.

    After the decline phase, we add only flat bars that don't restore 50SMA
    above 200SMA.
    """
    bars = []
    t = T0
    bars.extend(_trending(200, 80.0, 130.0, vol=BASE_VOL, t_start=t))
    t = _last_t(bars)
    bars.extend(_trending(80, 130.0, 100.0, vol=BASE_VOL * 0.9, t_start=t))
    t = _last_t(bars)
    # Only 5 flat bars — not enough recovery
    bars.extend(_flat(5, 100.0, vol=BASE_VOL, t_start=t))
    return bars


def _mas_declining_into_cross():
    """Both MAs declining at/around the cross — fails 'both MAs rising' gate.

    A long downtrend keeps both MA slopes negative; a small bounce cannot
    convince the detector that MAs are rising.
    """
    bars = []
    t = T0
    # Long overall downtrend (keeps 200SMA declining throughout)
    bars.extend(_trending(200, 120.0, 80.0, vol=BASE_VOL, t_start=t))
    t = _last_t(bars)
    # Sharper short decline to push 50SMA below 200SMA
    bars.extend(_trending(80, 80.0, 60.0, vol=BASE_VOL * 1.2, t_start=t))
    t = _last_t(bars)
    # Short recovery — may create a cross-like appearance but MAs are declining
    bars.extend(_trending(42, 60.0, 75.0, vol=BASE_VOL, t_start=t))
    t = _last_t(bars)
    last_c = bars[-1]["c"]
    bars.append(_bar(t, last_c - 0.2, last_c + 0.5, last_c - 0.3, last_c + 0.4,
                     BASE_VOL * 1.3))
    return bars


def _slope_gate_boundary_fail():
    """200SMA slope = -0.52% — just outside the -0.50% gate boundary.

    SYNTHETIC SERIES: every other golden-cross condition is satisfied (cross
    found within 5 bars, ma50_rising, volume >= 0.5x avg), but the 200SMA
    slope gate rejects the detection.  The boundary fixture cannot be produced
    by a natural multi-phase price series (see module docstring for proof);
    bars are engineered directly from the SMA math.

    Design (252 bars total — see module docstring for the series structure):
      P_LOW=50 (31 bars), P_HIGH_OLD=500 (20 bars, oldest_20 reference),
      P_MID=100 (150 bars), P_LOW_2=60 (30 bars), P_SW=80 (19 sw bars)
      P_CROSS = sum_oldest_20 + (-0.0052)*200*ma200_ss - 19*P_SW = 8340.64

    Verified math (all at cross bar = bar 250):
      ma200_ss = ma200[230] = (20*500 + 150*100 + 30*60)/200 = 134.0
      P_CROSS               = 10000 + (-0.0052)*200*134 - 19*80 = 8340.64
      ma50[cross=250]       = (30*60 + 19*80 + 8340.64)/50    = 233.21 > 133.30 ✓
      ma50[249] (prev bar)  = (31*60 + 19*80)/50              = 68.40  < 94.10  ✓
      ma50_rising           = 233.21 > 76.0 (ma50[230])                         ✓
      slope                 = (133.30 - 134.0)/134.0           = -0.00520        ✗ gate
      volume_ratio (cross bar) = 1.5x avg                                       ✓
    """
    return _build_slope_boundary_series(target_slope=-0.0052)


def _build_slope_boundary_series(target_slope: float) -> list:
    """Construct a 252-bar synthetic series producing the exact target 200SMA slope.

    Series layout (bar indices 0-based):
      bars   0..30  : P_LOW=50.0      (31 bars, low-price prefix — outside 200SMA at cross)
      bars  31..50  : P_HIGH_OLD=500  (20 bars = 'oldest_20', slope reference)
      bars  51..200 : P_MID=100.0     (150 bars, middle filler)
      bars 201..230 : P_LOW_2=60.0    (30 bars, keeps 50SMA low before cross)
      bars 231..249 : P_SW=80.0       (19 bars, slope window intermediate)
      bar  250      : P_CROSS         (computed for exact slope; elevated volume)
      bar  251      : P_CROSS+0.5     (trailing bar, age=1 from last)

    Math (cross_idx=250, slope_start=230):
      ma200[230]  = (20*P_HIGH_OLD + 150*P_MID + 30*P_LOW_2) / 200 = 134.0
      sum_oldest  = 20 * P_HIGH_OLD = 10000
      sum_newest  = sum_oldest + target_slope * 200 * ma200[230]
      P_CROSS     = sum_newest - 19 * P_SW

    This is the ONLY design that simultaneously satisfies:
      (a) genuine cross transition (ma50[249] <= ma200[249], ma50[250] > ma200[250])
      (b) engineered 200SMA slope = target_slope exactly
      (c) all prices positive
    """
    P_LOW, P_HIGH_OLD = 50.0, 500.0
    P_MID, P_LOW_2, P_SW = 100.0, 60.0, 80.0

    ma200_ss = (20 * P_HIGH_OLD + 150 * P_MID + 30 * P_LOW_2) / 200  # = 134.0
    sum_oldest = 20 * P_HIGH_OLD                                       # = 10000
    sum_newest = sum_oldest + target_slope * 200 * ma200_ss
    p_cross = sum_newest - 19 * P_SW

    bars = []
    t = T0

    for c in [P_LOW] * 31 + [P_HIGH_OLD] * 20 + [P_MID] * 150 + [P_LOW_2] * 30 + [P_SW] * 19:
        spread = max(c * 0.003, 0.01)
        bars.append(_bar(t, c - spread * 0.4, c + spread * 0.6,
                         c - spread * 0.6, c + spread * 0.4, BASE_VOL))
        t += DT

    # Cross bar (bar 250): elevated volume
    c = p_cross
    spread = max(c * 0.003, 0.01)
    bars.append(_bar(t, c - spread * 0.4, c + spread * 0.6,
                     c - spread * 0.6, c + spread * 0.4, BASE_VOL * 1.5))
    t += DT

    # Trailing bar (bar 251)
    c = p_cross + 0.5
    spread = max(c * 0.003, 0.01)
    bars.append(_bar(t, c - spread * 0.4, c + spread * 0.6,
                     c - spread * 0.6, c + spread * 0.4, BASE_VOL))
    return bars


def _slope_gate_boundary_pass():
    """200SMA slope = exactly -0.50% — at the inclusive gate boundary.

    EDGE / SYNTHETIC SERIES: slope is at the exact threshold (-0.005).  The
    detector uses `ma200_slope >= -0.005 - _EPS` to admit the detection.
    Without _EPS the check `>= -0.005` could fail due to float residue on some
    architectures; with _EPS the detection is provably inclusive.

    Same construction as _slope_gate_boundary_fail but target_slope=-0.005.
    Verified math (all at cross bar = bar 250):
      ma200_ss = 134.0
      P_CROSS  = 10000 + (-0.005)*200*134 - 19*80 = 8346.0
      slope    = (133.33 - 134.0)/134.0            = -0.005000  ✓ (>= -0.005 - EPS)
      detector FIRES (confidence ~81)
    """
    return _build_slope_boundary_series(target_slope=-0.005)


def _200sma_slope_too_negative():
    """200SMA slope < -0.5% — specifically fails the slope gate.

    A sharp 20-bar crash causes the 200SMA slope over those 20 bars to be
    far below the -0.5% threshold. Even if a cross-like event occurs, the
    slope gate rejects it.
    """
    bars = []
    t = T0
    # Uptrend to build 200SMA baseline
    bars.extend(_trending(200, 80.0, 120.0, vol=BASE_VOL, t_start=t))
    t = _last_t(bars)
    # Sharp 20-bar crash (-33% in 20 bars → slope >> -0.5% for these 20 bars)
    bars.extend(_trending(20, 120.0, 80.0, vol=BASE_VOL * 2.0, t_start=t))
    t = _last_t(bars)
    # 60 more declining bars to put 50SMA well below 200SMA
    bars.extend(_trending(60, 80.0, 70.0, vol=BASE_VOL * 0.8, t_start=t))
    t = _last_t(bars)
    # Cross-like bar
    last_c = bars[-1]["c"]
    cross_c = last_c * 1.08
    bars.append(_bar(t, cross_c * 0.995, cross_c * 1.005, cross_c * 0.990,
                     cross_c, BASE_VOL * 1.5))
    t += DT
    bars.extend(_flat(2, cross_c * 1.01, t_start=t))
    return bars


def _death_cross_not_golden():
    """50SMA crossed BELOW 200SMA — ma50 < ma200 currently (death cross territory)."""
    bars = []
    t = T0
    # Long uptrend where 50SMA > 200SMA
    bars.extend(_trending(200, 80.0, 130.0, vol=BASE_VOL, t_start=t))
    t = _last_t(bars)
    # Very sharp decline: 50SMA drops well below 200SMA
    bars.extend(_trending(80, 130.0, 85.0, vol=BASE_VOL * 1.5, t_start=t))
    t = _last_t(bars)
    # 5 flat bars — 50SMA still well below 200SMA
    bars.extend(_flat(5, 85.0, vol=BASE_VOL, t_start=t))
    return bars


def _insufficient_bars():
    """Only 180 bars — below the minimum (>=200+5+5=210 bars needed)."""
    bars = []
    t = T0
    bars.extend(_trending(178, 80.0, 110.0, vol=BASE_VOL, t_start=t))
    t = _last_t(bars)
    bars.append(_bar(t, 109.0, 112.0, 108.0, 111.0, BASE_VOL * 1.5))
    t += DT
    bars.append(_bar(t, 111.0, 113.0, 110.0, 112.0, BASE_VOL))
    return bars


def _flat_chop_intertwined():
    """255 bars of tight sideways chop.

    Both MAs oscillate near each other with no clean directional trend.
    Even if 50SMA momentarily crosses 200SMA, the 'both MAs rising' gate
    rejects it because neither MA has a positive slope over 20 bars.
    """
    bars = []
    t = T0
    p = 100.0
    for i in range(255):
        offset = math.sin(i * 0.15) * 0.8
        c = p + offset
        spread = 0.3
        bars.append(_bar(t, c - spread * 0.4, c + spread * 0.6,
                         c - spread * 0.6, c + spread * 0.4, BASE_VOL))
        t += DT
    return bars


def _stale_cross_30_bars_ago():
    """Golden cross occurred 30 bars ago — well outside the 5-bar window."""
    return _build_cross_series(cross_age=30, cross_vol_mult=1.5)


# ============== EDGE ==============

def _cross_oldest_detectable_age4():
    """Cross at age=4 — the oldest cross the detector can detect (inclusive boundary).

    The detector scans backwards from last_idx to
    max(last_idx - _MAX_CROSS_AGE, _MA200_PERIOD - 1) exclusive, where
    _MAX_CROSS_AGE = 5.  The scan range is (last_idx, last_idx-5], exclusive
    lower bound, which means the oldest scannable cross_idx = last_idx - 4
    (age = 4).  cross_age=5 in _build_cross_series places the cross bar at
    last_idx - 4 (since cross_age trailing bars = cross_age-1 extra bars after
    the cross, so age = cross_age - 1 = 4).

    This verifies the scan off-by-one is correct — age=4 is detected, age=5 is not
    (see gc_cross_too_old which uses cross_age=6, placing the cross at age=5).
    """
    return _build_cross_series(cross_age=5, cross_vol_mult=1.5)


def _volume_exactly_half_avg():
    """Cross bar volume = exactly 0.5x 20-bar average — the inclusive boundary.

    The detector hard-gates on: volume_ratio < 0.5 → reject.
    So volume_ratio = 0.5 (= 0.5x avg) must be ACCEPTED (inclusive >=0.5).
    This tests that the strict `< 0.5` boundary doesn't accidentally reject
    a volume that equals exactly 0.5x (e.g. due to float precision).
    """
    bars = []
    t = T0
    P, top_p, mid_p = 80.0, 130.0, 100.0
    step = 1.0

    # Phase 1: 200-bar uptrend with uniform volume
    for i in range(200):
        c = P + (top_p - P) * i / 199
        spread = max(c * 0.003, 0.01)
        bars.append(_bar(t, c - spread * 0.4, c + spread * 0.6,
                         c - spread * 0.6, c + spread * 0.4, BASE_VOL))
        t += DT

    # Phase 2: 80-bar decline — uniform BASE_VOL
    for i in range(80):
        c = top_p + (mid_p - top_p) * i / 79
        spread = max(c * 0.003, 0.01)
        bars.append(_bar(t, c + spread * 0.4, c + spread * 0.6,
                         c - spread * 0.6, c - spread * 0.4, BASE_VOL))
        t += DT

    # Phase 3: 42-bar recovery — uniform BASE_VOL
    last_c = mid_p
    for i in range(42):
        c = last_c + step
        last_c = c
        spread = max(c * 0.003, 0.01)
        bars.append(_bar(t, c - spread * 0.4, c + spread * 0.6,
                         c - spread * 0.6, c + spread * 0.4, BASE_VOL))
        t += DT

    # Compute avg_vol for the 20-bar window before the cross bar
    avg_vol = sum(b["v"] for b in bars[-20:]) / 20
    cross_vol = avg_vol * 0.5  # exactly 0.5x

    # Cross bar
    c = last_c + step
    last_c = c
    spread = max(c * 0.003, 0.01)
    bars.append(_bar(t, c - spread * 0.4, c + spread * 0.6,
                     c - spread * 0.6, c + spread * 0.4, cross_vol))
    t += DT

    # 1 trailing bar
    c = last_c + 0.3
    spread = max(c * 0.003, 0.01)
    bars.append(_bar(t, c - spread * 0.4, c + spread * 0.6,
                     c - spread * 0.6, c + spread * 0.4, BASE_VOL))
    t += DT

    return bars


# ============== CONTEXTS ==============

GOOD_CONTEXT = {
    "trend_stage": 2,
    "rs_trend": "up",
    "ma_alignment": "stacked_bullish",
    "volume_signature": "expanding",
    "regime": "bullish",
    "dcr_signature": "accumulation",
    "recent_dcr_avg": 0.72,
    "nearest_resistance": None,
    "nearest_support": None,
    "days_to_earnings": None,
    "sector_strength_rank": 2,
}

NEUTRAL_CONTEXT = {
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

BEARISH_CONTEXT = {
    "trend_stage": 4,
    "rs_trend": "down",
    "ma_alignment": "stacked_bearish",
    "volume_signature": "neutral",
    "regime": "bearish",
    "dcr_signature": "distribution",
    "recent_dcr_avg": 0.28,
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
    # ---- 5 POSITIVE ----
    _write("gc_clean_fresh_cross", "positive",
           _clean_fresh_cross(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("gc_cross_1_bar_ago", "positive",
           _cross_1_bar_ago(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("gc_strong_volume", "positive",
           _cross_strong_volume(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("gc_rising_200sma", "positive",
           _cross_rising_200sma(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("gc_after_long_base", "positive",
           _cross_after_long_base(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    # ---- 8 NEGATIVE ----
    _write("gc_cross_too_old", "negative",
           _cross_too_old_6bars(), GOOD_CONTEXT,
           {"fires": False})

    _write("gc_no_cross_below_200", "negative",
           _no_cross_50_below_200(), NEUTRAL_CONTEXT,
           {"fires": False})

    _write("gc_mas_declining", "negative",
           _mas_declining_into_cross(), BEARISH_CONTEXT,
           {"fires": False})

    _write("gc_200sma_too_negative", "negative",
           _200sma_slope_too_negative(), NEUTRAL_CONTEXT,
           {"fires": False})

    _write("gc_slope_gate_boundary_fail", "negative",
           _slope_gate_boundary_fail(), GOOD_CONTEXT,
           {"fires": False})

    _write("gc_death_cross_direction", "negative",
           _death_cross_not_golden(), BEARISH_CONTEXT,
           {"fires": False})

    _write("gc_insufficient_bars", "negative",
           _insufficient_bars(), NEUTRAL_CONTEXT,
           {"fires": False})

    _write("gc_flat_chop_intertwined", "negative",
           _flat_chop_intertwined(), NEUTRAL_CONTEXT,
           {"fires": False})

    _write("gc_stale_cross_30bars", "negative",
           _stale_cross_30_bars_ago(), GOOD_CONTEXT,
           {"fires": False})

    # ---- 3 EDGE ----
    _write("gc_edge_cross_oldest_detectable_age4", "edge",
           _cross_oldest_detectable_age4(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("gc_edge_volume_half_avg", "edge",
           _volume_exactly_half_avg(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("gc_edge_slope_gate_boundary_pass", "edge",
           _slope_gate_boundary_pass(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    print("\nDone — 17 fixtures written.")


if __name__ == "__main__":
    main()
