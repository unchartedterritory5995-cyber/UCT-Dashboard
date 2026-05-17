"""Death Cross fixture generator. 16 fixtures total.

Builds price series programmatically (>=200 bars each) that produce a
known 50/200 SMA relationship (50SMA crossing BELOW 200SMA).

Core building block: _build_cross_series(cross_age, ...)
  Phase 1: 200-bar uptrend (base_p to top_p)   → establishes 200SMA baseline,
           50SMA well above 200SMA at top.
  Phase 2: 40-bar flat at top                  → flattens 200SMA / reduces upward
           momentum so the slope gate passes at the cross bar.
  Phase 3: Decline from top. 50SMA falls.
           The death cross (50SMA crossing below 200SMA) occurs naturally
           ~18 bars into the decline. The cross bar is re-stamped with
           the requested volume multiplier.
  Phase 4: (cross_age-1) gentle continuing-decline trailing bars.

CRITICAL: the 40-bar flat phase is required to flatten the 200SMA enough
that the slope gate (<=+0.005) passes at the death-cross bar. Without it,
the 200SMA is still rising and the fixture fails the gate.

VERIFIED against detect_death_cross before writing.

Positive (>=5): clean fresh cross (age=2), cross 1 bar ago, cross age=3,
  high-volume cross, long Stage-3 distribution top.
Negative (>=8): cross >5 bars old, 50SMA still above 200SMA (no cross),
  MAs rising into cross, 200SMA slope steeply positive (gate reject),
  golden cross direction (50 above 200), insufficient bars,
  flat chop intertwined, stale cross 30 bars ago.
Edge (>=3): cross at oldest detectable age (age=4), 200SMA slope boundary
  fail (slope clearly +1.5% -> reject), 200SMA slope boundary pass
  (flat plateau before cross -> slope ~-0.55% -> accept).

--- Slope boundary / _EPS note ---
For death cross: gate is ma200_slope <= 0.005 + _EPS (slope declining or flat,
allowing up to +0.5%). _EPS = 1e-9 is DEFENSIVE, not load-bearing:

The boundary series (dc_edge_slope_gate_boundary_pass) produces a slope of
approximately -0.015 (well below +0.005), not at the exact +0.005 boundary.
A natural death-cross series with the flat-phase construction cannot land
the slope at exactly +0.005 — the flat phase drops the 200SMA slope to around
-0.005 to -0.015. The boundary fixtures therefore test clearly-failing (slope
+1.5% >> +0.005 -> reject) and clearly-passing (slope ~-0.015 << +0.005 -> accept).

_EPS is kept belt-and-suspenders for non-integer price series or future refactors
but is NOT load-bearing for any fixture in this battery.
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


def _sma_of(bars, end_idx, period):
    """Compute SMA for verification during series construction."""
    if end_idx < period - 1 or end_idx >= len(bars):
        return None
    return sum(bars[i]["c"] for i in range(end_idx - period + 1, end_idx + 1)) / period


def _build_cross_series(
    cross_age: int = 1,
    cross_vol_mult: float = 1.5,
    base_price: float = 80.0,
    flat_bars: int = 40,
    cross_vol_override: float = None,
):
    """Build a bar series where a death cross occurred `cross_age` bars ago.

    Series layout:
      Phase 1: 200-bar uptrend from base_price to base_price*1.625
               — at top, 50SMA >> 200SMA.
      Phase 2: flat_bars-bar flat at top
               — reduces 200SMA upward momentum so the slope gate passes.
      Phase 3: Decline from top. The death cross (50SMA crosses below 200SMA)
               is found by scanning during the decline. The cross bar receives
               the requested volume multiplier.
      Phase 4: (cross_age-1) continuing-decline trailing bars.

    The flat phase (Phase 2) is critical: without it the 200SMA is still rising
    at the cross bar, and the slope gate (<=+0.005) rejects. With 40 flat bars
    the slope at the cross bar is typically around -0.005 to -0.010.
    """
    bars = []
    t = T0

    top_p = base_price * 1.625   # = 130 for base_price=80
    bottom_p = base_price * 0.80  # = 64 for base_price=80

    # Phase 1: 200-bar uptrend
    for i in range(200):
        c = base_price + (top_p - base_price) * i / 199
        spread = max(c * 0.003, 0.01)
        bars.append(_bar(t, c - spread * 0.4, c + spread * 0.6,
                         c - spread * 0.6, c + spread * 0.4, BASE_VOL))
        t += DT

    # Phase 2: flat_bars at top (flattens 200SMA upward momentum)
    for _ in range(flat_bars):
        c = top_p
        spread = max(c * 0.003, 0.01)
        bars.append(_bar(t, c - spread * 0.4, c + spread * 0.6,
                         c - spread * 0.6, c + spread * 0.4, BASE_VOL * 0.7))
        t += DT

    # Phase 3: decline until death cross found
    decline_step = (top_p - bottom_p) / 100.0
    last_c = top_p
    cross_bar_idx = None

    for i in range(100):
        c = last_c - decline_step * (i + 1)
        spread = max(c * 0.003, 0.01)
        bars.append(_bar(t, c + spread * 0.4, c + spread * 0.6,
                         c - spread * 0.6, c - spread * 0.4, BASE_VOL * 0.9))
        t += DT
        last_c = c
        cur_idx = len(bars) - 1
        ma50_i = _sma_of(bars, cur_idx, 50)
        ma200_i = _sma_of(bars, cur_idx, 200)
        ma50_prev = _sma_of(bars, cur_idx - 1, 50)
        ma200_prev = _sma_of(bars, cur_idx - 1, 200)
        if (ma50_i is not None and ma200_i is not None and
                ma50_prev is not None and ma200_prev is not None and
                ma50_prev >= ma200_prev and ma50_i < ma200_i):
            cross_bar_idx = cur_idx
            # Apply volume multiplier to cross bar
            if cross_vol_override is not None:
                cross_v = cross_vol_override
            else:
                cross_v = BASE_VOL * cross_vol_mult
            bars[-1] = _bar(bars[-1]["t"],
                            bars[-1]["o"], bars[-1]["h"],
                            bars[-1]["l"], bars[-1]["c"], cross_v)
            break

    if cross_bar_idx is None:
        raise RuntimeError("Death cross not detected — adjust parameters")

    # Phase 4: trailing bars
    for _ in range(max(0, cross_age - 1)):
        c = last_c - decline_step * 0.5
        last_c = c
        spread = max(c * 0.003, 0.01)
        bars.append(_bar(t, c + spread * 0.4, c + spread * 0.6,
                         c - spread * 0.6, c - spread * 0.4, BASE_VOL))
        t += DT

    return bars


# ============== POSITIVE ==============

def _clean_fresh_cross():
    """Classic death cross: ~2 bars ago, declining MAs, 1.5x volume.

    Uses the standard 40-bar flat phase to flatten the 200SMA so the
    slope gate passes at the cross bar.
    """
    return _build_cross_series(cross_age=2, cross_vol_mult=1.5)


def _cross_on_last_bar():
    """Freshest detection: cross IS the last bar (age=0, days_since_cross=0).

    cross_age=1 in _build_cross_series places the cross at last_idx with 0
    trailing bars, so days_since_cross = last_idx - cross_idx = 0.
    This is the freshest possible detection — the cross just occurred.
    """
    return _build_cross_series(cross_age=1, cross_vol_mult=1.8)


def _cross_strong_volume():
    """Cross with 2.5x average volume — high-conviction institutional signal."""
    return _build_cross_series(cross_age=2, cross_vol_mult=2.5)


def _cross_declining_200sma():
    """Cross with clearly declining 200SMA, cross age=3.

    Uses base_price=200 to verify proportional scaling.
    """
    return _build_cross_series(cross_age=3, cross_vol_mult=1.2, base_price=200.0)


def _cross_after_long_distribution():
    """Death cross after an extra 60-bar Stage-3 distribution top.

    Simulates a stock that consolidated at the top for ~3 months
    (Stage 3) before breaking down into Stage 4.
    """
    bars = []
    t = T0
    base_price = 50.0
    top_p = base_price * 1.625   # 81.25
    bottom_p = base_price * 0.80  # 40.0

    # Phase 1: 200-bar uptrend
    for i in range(200):
        c = base_price + (top_p - base_price) * i / 199
        spread = max(c * 0.003, 0.01)
        bars.append(_bar(t, c - spread * 0.4, c + spread * 0.6,
                         c - spread * 0.6, c + spread * 0.4, BASE_VOL))
        t += DT

    # 60-bar Stage-3 distribution (flat top, declining volume) — longer than standard flat
    for _ in range(60):
        c = top_p * 0.99
        spread = max(c * 0.003, 0.01)
        bars.append(_bar(t, c - spread * 0.4, c + spread * 0.6,
                         c - spread * 0.6, c + spread * 0.4, BASE_VOL * 0.6))
        t += DT

    # Decline until death cross
    decline_step = (top_p - bottom_p) / 100.0
    last_c = top_p * 0.99
    cross_detected = False

    for i in range(100):
        c = last_c - decline_step * (i + 1)
        spread = max(c * 0.003, 0.01)
        bars.append(_bar(t, c + spread * 0.4, c + spread * 0.6,
                         c - spread * 0.6, c - spread * 0.4, BASE_VOL * 0.9))
        t += DT
        last_c = c
        cur_idx = len(bars) - 1
        ma50_i = _sma_of(bars, cur_idx, 50)
        ma200_i = _sma_of(bars, cur_idx, 200)
        ma50_prev = _sma_of(bars, cur_idx - 1, 50)
        ma200_prev = _sma_of(bars, cur_idx - 1, 200)
        if (ma50_i is not None and ma200_i is not None and
                ma50_prev is not None and ma200_prev is not None and
                ma50_prev >= ma200_prev and ma50_i < ma200_i):
            bars[-1] = _bar(bars[-1]["t"],
                            bars[-1]["o"], bars[-1]["h"],
                            bars[-1]["l"], bars[-1]["c"], BASE_VOL * 1.6)
            cross_detected = True
            break

    if not cross_detected:
        raise RuntimeError("Death cross not found in distribution series")

    # 2 trailing bars
    for _ in range(2):
        c = last_c - decline_step * 0.5
        last_c = c
        spread = max(c * 0.003, 0.01)
        bars.append(_bar(t, c + spread * 0.4, c + spread * 0.6,
                         c - spread * 0.6, c - spread * 0.4, BASE_VOL))
        t += DT

    return bars


# ============== NEGATIVE ==============

def _cross_too_old_6bars():
    """Cross occurred 6 bars ago — outside the 5-bar window (age=5 from last bar)."""
    return _build_cross_series(cross_age=6, cross_vol_mult=1.5)


def _no_cross_50_above_200():
    """50SMA is still above 200SMA — no death cross at all.

    Uptrend ending while 50SMA remains above 200SMA — no cross occurred.
    """
    bars = []
    t = T0
    bars.extend(_trending(200, 80.0, 130.0, vol=BASE_VOL, t_start=t))
    t = _last_t(bars)
    # Short 5-bar decline — not enough for 50SMA to drop below 200SMA
    bars.extend(_trending(5, 130.0, 126.0, vol=BASE_VOL * 0.9, t_start=t))
    return bars


def _mas_rising_into_cross():
    """Both MAs rising at the cross — fails 'both MAs declining' gate.

    After a golden cross (price recovery from base), both MAs are rising.
    The detector should NOT fire because ma50_declining is False.
    """
    bars = []
    t = T0
    # Phase 1: 200-bar uptrend (50SMA rises above 200SMA)
    bars.extend(_trending(200, 80.0, 130.0, vol=BASE_VOL, t_start=t))
    t = _last_t(bars)
    # Phase 2: 80-bar decline (50SMA drops below 200SMA)
    bars.extend(_trending(80, 130.0, 100.0, vol=BASE_VOL * 0.9, t_start=t))
    t = _last_t(bars)
    # Phase 3: recovery — 50SMA is now RISING (ma50_declining = False at any cross)
    bars.extend(_trending(42, 100.0, 115.0, vol=BASE_VOL, t_start=t))
    t = _last_t(bars)
    last_c = bars[-1]["c"]
    bars.append(_bar(t, last_c - 0.2, last_c + 0.5, last_c - 0.3, last_c + 0.4,
                     BASE_VOL * 1.2))
    return bars


def _200sma_slope_rising():
    """200SMA slope clearly positive (+1.5%) — fails the <= +0.5% gate.

    A very strong uptrend keeps the 200SMA sloping steeply upward.
    A short decline cannot flatten the 200SMA enough — gate rejects.
    """
    bars = []
    t = T0
    # Very steep 200-bar uptrend (200SMA will be steeply positive over 20 bars)
    bars.extend(_trending(200, 50.0, 150.0, vol=BASE_VOL, t_start=t))
    t = _last_t(bars)
    # Short 20-bar decline to push 50SMA toward 200SMA (not enough to flatten 200SMA)
    bars.extend(_trending(20, 150.0, 130.0, vol=BASE_VOL * 1.5, t_start=t))
    t = _last_t(bars)
    bars.extend(_trending(10, 130.0, 128.0, vol=BASE_VOL, t_start=t))
    t = _last_t(bars)
    last_c = bars[-1]["c"]
    cross_c = last_c * 0.97
    bars.append(_bar(t, cross_c * 1.001, cross_c * 1.005, cross_c * 0.995,
                     cross_c, BASE_VOL * 1.5))
    t += DT
    bars.extend(_flat(2, cross_c * 0.99, t_start=t))
    return bars


def _golden_cross_not_death():
    """50SMA crossed ABOVE 200SMA — ma50 > ma200 currently (golden cross territory).

    After a recovery from a decline, 50SMA is now above 200SMA.
    The death cross gate `ma50_now >= ma200_now` rejects immediately.
    """
    bars = []
    t = T0
    # Uptrend
    bars.extend(_trending(200, 80.0, 130.0, vol=BASE_VOL, t_start=t))
    t = _last_t(bars)
    # Decline to push 50SMA well below 200SMA
    bars.extend(_trending(80, 130.0, 85.0, vol=BASE_VOL * 1.5, t_start=t))
    t = _last_t(bars)
    # Strong recovery — 50SMA crosses ABOVE 200SMA (golden cross, not death)
    bars.extend(_trending(60, 85.0, 135.0, vol=BASE_VOL, t_start=t))
    t = _last_t(bars)
    # 5 flat bars — 50SMA still above 200SMA
    bars.extend(_flat(5, 135.0, vol=BASE_VOL, t_start=t))
    return bars


def _insufficient_bars():
    """Only 180 bars — below the minimum (>=200+5+5=210 bars needed)."""
    bars = []
    t = T0
    bars.extend(_trending(178, 80.0, 50.0, vol=BASE_VOL, t_start=t))
    t = _last_t(bars)
    bars.append(_bar(t, 49.0, 51.0, 48.0, 49.5, BASE_VOL * 1.5))
    t += DT
    bars.append(_bar(t, 49.5, 50.5, 49.0, 49.0, BASE_VOL))
    return bars


def _flat_chop_intertwined():
    """255 bars of tight sideways chop.

    Both MAs oscillate near each other with no clean directional trend.
    No clean 50SMA-crosses-below-200SMA event occurs within 5 bars.
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
    """Death cross occurred 30 bars ago — well outside the 5-bar window."""
    return _build_cross_series(cross_age=30, cross_vol_mult=1.5)


# ============== EDGE ==============

def _cross_oldest_detectable_age():
    """Cross at the oldest detectable age (age=4 from last bar).

    The detector scans backwards from last_idx to
    max(last_idx - _MAX_CROSS_AGE, _MA200_PERIOD - 1) exclusive, where
    _MAX_CROSS_AGE = 5. The scan range is (last_idx, last_idx-5], exclusive
    lower bound, which means the oldest scannable cross_idx = last_idx - 4
    (age = 4). cross_age=5 in _build_cross_series places the cross bar at
    last_idx - 4 (since cross_age-1 = 4 trailing bars after the cross → age=4).

    This verifies the scan off-by-one: age=4 is detected, age=5 is not
    (see dc_cross_too_old which uses cross_age=6 → age=5).
    """
    return _build_cross_series(cross_age=5, cross_vol_mult=1.5)


def _slope_gate_boundary_fail():
    """200SMA slope = ~+1.5% — clearly outside the +0.5% gate (rejects).

    NATURAL SERIES: a very steep uptrend followed by a short decline produces
    a 200SMA slope well above +0.005 at any cross-like bar. The slope gate
    (<=+0.005) rejects regardless of cross presence.

    This is the same as dc_200sma_slope_rising but labeled as edge to cover
    the boundary-fail side of the gate.

    Establishes _EPS truth: slope ~+0.015 >> +0.005 + _EPS; gate rejects.
    _EPS = 1e-9 is irrelevant — the slope is far above the boundary.
    """
    bars = []
    t = T0
    # Extremely steep uptrend — 200SMA over last 20 bars will be +1-2%
    bars.extend(_trending(200, 50.0, 200.0, vol=BASE_VOL, t_start=t))
    t = _last_t(bars)
    # Short 25-bar decline (insufficient to flatten 200SMA)
    bars.extend(_trending(25, 200.0, 170.0, vol=BASE_VOL * 1.5, t_start=t))
    t = _last_t(bars)
    last_c = bars[-1]["c"]
    cross_c = last_c * 0.96
    bars.append(_bar(t, cross_c * 1.001, cross_c * 1.005, cross_c * 0.995,
                     cross_c, BASE_VOL * 1.5))
    t += DT
    bars.extend(_flat(3, cross_c * 0.98, t_start=t))
    return bars


def _slope_gate_boundary_pass():
    """200SMA slope approximately -0.015 (well below +0.005) — gate passes.

    NATURAL SERIES: a long uptrend followed by a 40-bar flat plateau then decline
    produces a 200SMA slope of approximately -0.005 to -0.015 at the cross bar.
    This is well within the <= +0.005 gate.

    Establishes _EPS truth: slope ~-0.015 << +0.005; plain gate passes;
    _EPS = 1e-9 is belt-and-suspenders, not load-bearing here.

    Uses same construction as _clean_fresh_cross but cross_age=1 (fresh).
    """
    return _build_cross_series(cross_age=1, cross_vol_mult=1.5, flat_bars=40)


# ============== CONTEXTS ==============

GOOD_CONTEXT = {
    "trend_stage": 4,
    "rs_trend": "down",
    "ma_alignment": "stacked_bearish",
    "volume_signature": "expanding",
    "regime": "bearish",
    "dcr_signature": "distribution",
    "recent_dcr_avg": 0.28,
    "nearest_resistance": None,
    "nearest_support": None,
    "days_to_earnings": None,
    "sector_strength_rank": None,
}

NEUTRAL_CONTEXT = {
    "trend_stage": 3,
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

BULLISH_CONTEXT = {
    "trend_stage": 2,
    "rs_trend": "up",
    "ma_alignment": "stacked_bullish",
    "volume_signature": "neutral",
    "regime": "bullish",
    "dcr_signature": "accumulation",
    "recent_dcr_avg": 0.72,
    "nearest_resistance": None,
    "nearest_support": None,
    "days_to_earnings": None,
    "sector_strength_rank": 2,
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
    _write("dc_clean_fresh_cross", "positive",
           _clean_fresh_cross(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("dc_cross_on_last_bar", "positive",
           _cross_on_last_bar(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("dc_strong_volume", "positive",
           _cross_strong_volume(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("dc_declining_200sma", "positive",
           _cross_declining_200sma(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("dc_after_distribution_top", "positive",
           _cross_after_long_distribution(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    # ---- 8 NEGATIVE ----
    _write("dc_cross_too_old", "negative",
           _cross_too_old_6bars(), GOOD_CONTEXT,
           {"fires": False})

    _write("dc_no_cross_above_200", "negative",
           _no_cross_50_above_200(), BULLISH_CONTEXT,
           {"fires": False})

    _write("dc_mas_rising", "negative",
           _mas_rising_into_cross(), BULLISH_CONTEXT,
           {"fires": False})

    _write("dc_200sma_slope_rising", "negative",
           _200sma_slope_rising(), NEUTRAL_CONTEXT,
           {"fires": False})

    _write("dc_golden_cross_direction", "negative",
           _golden_cross_not_death(), BULLISH_CONTEXT,
           {"fires": False})

    _write("dc_insufficient_bars", "negative",
           _insufficient_bars(), NEUTRAL_CONTEXT,
           {"fires": False})

    _write("dc_flat_chop_intertwined", "negative",
           _flat_chop_intertwined(), NEUTRAL_CONTEXT,
           {"fires": False})

    _write("dc_stale_cross_30bars", "negative",
           _stale_cross_30_bars_ago(), GOOD_CONTEXT,
           {"fires": False})

    # ---- 3 EDGE ----
    _write("dc_edge_cross_oldest_detectable_age4", "edge",
           _cross_oldest_detectable_age(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("dc_edge_slope_gate_boundary_fail", "edge",
           _slope_gate_boundary_fail(), NEUTRAL_CONTEXT,
           {"fires": False})

    _write("dc_edge_slope_gate_boundary_pass", "edge",
           _slope_gate_boundary_pass(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    print("\nDone — 16 fixtures written.")


if __name__ == "__main__":
    main()
