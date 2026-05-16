"""Golden Cross fixture generator. 15 fixtures total.

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
Negative (>=8): cross >5 bars old, 50SMA below 200SMA (no cross),
  MAs declining, 200SMA slope < -0.5%, death-cross direction,
  insufficient bars, flat-chop intertwined MAs, stale cross 30 bars ago.
Edge (>=2): cross exactly 5 bars ago (age boundary), volume = exactly 0.5x
  average (the inclusive volume-gate boundary >= 0.5).
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

def _cross_exactly_5_bars_ago():
    """Cross at exactly age=5 — the inclusive boundary of _MAX_CROSS_AGE.

    The detector scans backwards from last_idx to
    max(last_idx - _MAX_CROSS_AGE, _MA200_PERIOD - 1) exclusive.
    Age=5 means cross_idx = last_idx - 5, which is included in the scan.
    This verifies the off-by-one is correct (inclusive boundary).
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

    # ---- 2 EDGE ----
    _write("gc_edge_cross_age_5", "edge",
           _cross_exactly_5_bars_ago(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("gc_edge_volume_half_avg", "edge",
           _volume_exactly_half_avg(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    print("\nDone — 15 fixtures written.")


if __name__ == "__main__":
    main()
