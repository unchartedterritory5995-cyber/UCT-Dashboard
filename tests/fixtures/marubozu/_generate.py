"""Marubozu fixture generator. 17 fixtures total (5 positive + 9 negative + 3 edge).

Spec (docstring ground truth):
  - body |close-open| >= 90% of range (high-low)
  - upper wick <= 5% of range  AND  lower wick <= 5% of range
  - range >= 1.2x 20-bar average range
  - volume >= 1.3x 20-bar average volume
  - Bullish: up bar (close>open) AND DCR >= 0.95
  - Bearish: down bar (close<open) AND DCR <= 0.05
  - Lookback: bars[-21:-1]  (the 20 bars before the last bar)

Bar construction notes
----------------------
For a BULLISH marubozu with range R, price level P (mid):
  high  = P + uw        (uw = upper wick, must be <= 0.05*R)
  close = high - uw     (= P)
  open  = close - body  (body >= 0.90*R)
  low   = open - lw     (lw = lower wick, must be <= 0.05*R)
  range = high - low  = uw + body + lw

Convenience: set uw = lw = 0.02*R (2% each), body = 0.96*R.
  -> total = 0.02 + 0.96 + 0.02 = 1.0 * R  ✓

DCR = (close - low) / range = (P - (P - 0.96*R - 0.02*R)) / R
     = (0.98*R) / R = 0.98  >= 0.95  ✓

For a BEARISH marubozu with range R, price level P:
  low   = P - uw        (uw = upper wick on the high side, but "upper" is distance from high to open)
  open  = high - uw
  close = open - body   (down bar, body = open - close >= 0.90*R)
  high  = P + uw

  Actually for bearish: upper_wick = high - open, lower_wick = close - low
  Set uw = 0.02*R, lw = 0.02*R, body = 0.96*R.
  high  = P + uw
  open  = high - uw = P
  close = open - body = P - 0.96*R
  low   = close - lw = P - 0.96*R - 0.02*R = P - 0.98*R

  DCR = (close - low) / range = (P - 0.96*R - (P - 0.98*R)) / R = 0.02 = 0.02 <= 0.05  ✓
"""
import json
import os

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))
T0 = 1700000000
DT = 86400

# ─────────────────────────────────────────────
# Contexts
# ─────────────────────────────────────────────
BULL_TREND_CONTEXT = {
    "trend_stage": 2,
    "rs_trend": "up",
    "ma_alignment": "stacked_bullish",
    "volume_signature": "expanding",
    "regime": "bullish",
    "nearest_resistance": None,
    "nearest_support": None,
    "days_to_earnings": None,
    "sector_strength_rank": None,
    "dcr_signature": "accumulation",
    "recent_dcr_avg": 0.72,
}

BEAR_TREND_CONTEXT = {
    "trend_stage": 4,
    "rs_trend": "down",
    "ma_alignment": "stacked_bearish",
    "volume_signature": "contracting",
    "regime": "bearish",
    "nearest_resistance": None,
    "nearest_support": None,
    "days_to_earnings": None,
    "sector_strength_rank": None,
    "dcr_signature": "distribution",
    "recent_dcr_avg": 0.32,
}

NEUTRAL_CONTEXT = {
    "trend_stage": 1,
    "rs_trend": "flat",
    "ma_alignment": "mixed",
    "volume_signature": "neutral",
    "regime": "choppy",
    "nearest_resistance": None,
    "nearest_support": None,
    "days_to_earnings": None,
    "sector_strength_rank": None,
    "dcr_signature": "neutral",
    "recent_dcr_avg": None,
}


# ─────────────────────────────────────────────
# Low-level bar builder
# ─────────────────────────────────────────────
def _bar(t, o, h, l, c, v=1000.0):
    return {
        "t": t,
        "o": round(float(o), 4),
        "h": round(float(h), 4),
        "l": round(float(l), 4),
        "c": round(float(c), 4),
        "v": round(float(v), 0),
    }


def _last_t(bars):
    return bars[-1]["t"] + DT


# ─────────────────────────────────────────────
# Background bar helpers (20-bar lookback window)
# ─────────────────────────────────────────────
def _background_bars(n=22, avg_range=1.0, avg_vol=1000.0, price=100.0, t_start=T0):
    """Generate n bars with average range ~avg_range and avg volume ~avg_vol.

    Each background bar is a slightly green candle with range = avg_range and
    body = 60% of range (well below 90%, so no background bar triggers marubozu).
    """
    bars = []
    t = t_start
    for i in range(n):
        # Gently trending up 0.01 per bar so bars look natural
        mid = price + i * 0.01
        rng = avg_range
        body = rng * 0.60          # 60% body -- explicitly NOT a marubozu
        half_wick = (rng - body) / 2
        o = mid - body / 2
        c = mid + body / 2
        h = c + half_wick
        l = o - half_wick
        bars.append(_bar(t, o, h, l, c, avg_vol))
        t += DT
    return bars


def _make_bullish_marubozu_bar(t, mid_price, bar_range, vol,
                                uw_frac=0.02, lw_frac=0.02):
    """Build a single bullish marubozu bar.

    uw_frac: upper wick as fraction of bar_range  (must be <= 0.05)
    lw_frac: lower wick as fraction of bar_range  (must be <= 0.05)
    body = bar_range * (1 - uw_frac - lw_frac)  -> guaranteed >= 0.90 when uw+lw <= 0.10

    DCR = (close - low) / range = (1 - uw_frac) which must be >= 0.95
          -> uw_frac <= 0.05  ✓
    """
    uw = uw_frac * bar_range
    lw = lw_frac * bar_range
    body = bar_range - uw - lw          # = bar_range * (1 - uw_frac - lw_frac)
    h = mid_price + uw
    c = mid_price                       # close = high - uw
    o = c - body
    l = o - lw
    return _bar(t, o, h, l, c, vol)


def _make_bearish_marubozu_bar(t, mid_price, bar_range, vol,
                                uw_frac=0.02, lw_frac=0.02):
    """Build a single bearish marubozu bar.

    For bearish: upper_wick = high - open, lower_wick = close - low
    uw_frac: upper wick as fraction of range  (must be <= 0.05)
    lw_frac: lower wick as fraction of range  (must be <= 0.05)
    body = bar_range * (1 - uw_frac - lw_frac)

    DCR = (close - low) / range = lw_frac which must be <= 0.05  ✓
    """
    uw = uw_frac * bar_range
    lw = lw_frac * bar_range
    body = bar_range - uw - lw
    h = mid_price + uw
    o = h - uw                          # open = high - upper_wick
    c = o - body                        # close = open - body  (down bar)
    l = c - lw
    return _bar(t, o, h, l, c, vol)


# ─────────────────────────────────────────────
# Helper: full series (background + signal bar)
# ─────────────────────────────────────────────
def _bullish_series(avg_range=1.0, avg_vol=1000.0, price=100.0,
                    range_mult=1.5, vol_mult=2.0,
                    uw_frac=0.02, lw_frac=0.02):
    """Return 23-bar series ending in a bullish marubozu signal bar.

    background: 22 bars with avg_range and avg_vol
    signal bar: range = avg_range * range_mult, vol = avg_vol * vol_mult
    The lookback for the detector is bars[-21:-1] = 20 bars before the last.
    """
    bars = _background_bars(22, avg_range=avg_range, avg_vol=avg_vol,
                             price=price, t_start=T0)
    t = _last_t(bars)
    signal_range = avg_range * range_mult
    signal_vol = avg_vol * vol_mult
    bar = _make_bullish_marubozu_bar(t, price + 22 * 0.01, signal_range, signal_vol,
                                      uw_frac=uw_frac, lw_frac=lw_frac)
    bars.append(bar)
    return bars


def _bearish_series(avg_range=1.0, avg_vol=1000.0, price=100.0,
                    range_mult=1.5, vol_mult=2.0,
                    uw_frac=0.02, lw_frac=0.02):
    """Return 23-bar series ending in a bearish marubozu signal bar."""
    bars = _background_bars(22, avg_range=avg_range, avg_vol=avg_vol,
                             price=price, t_start=T0)
    t = _last_t(bars)
    signal_range = avg_range * range_mult
    signal_vol = avg_vol * vol_mult
    bar = _make_bearish_marubozu_bar(t, price + 22 * 0.01, signal_range, signal_vol,
                                      uw_frac=uw_frac, lw_frac=lw_frac)
    bars.append(bar)
    return bars


# ─────────────────────────────────────────────
# POSITIVE FIXTURES  (≥5 required)
# ─────────────────────────────────────────────

def _clean_bullish_marubozu():
    """Clean bullish marubozu: 2% wicks, 1.5x range, 2x volume, bull trend context."""
    return _bullish_series(avg_range=2.0, avg_vol=5000.0, price=150.0,
                            range_mult=1.5, vol_mult=2.0,
                            uw_frac=0.02, lw_frac=0.02)


def _clean_bearish_marubozu():
    """Clean bearish marubozu: 2% wicks, 1.6x range, 1.8x volume, bear trend context."""
    return _bearish_series(avg_range=2.0, avg_vol=5000.0, price=150.0,
                            range_mult=1.6, vol_mult=1.8,
                            uw_frac=0.02, lw_frac=0.02)


def _near_zero_wick_bullish():
    """Bullish marubozu with ~zero wicks (1% each): near-perfect bar."""
    return _bullish_series(avg_range=2.0, avg_vol=3000.0, price=80.0,
                            range_mult=1.8, vol_mult=2.5,
                            uw_frac=0.01, lw_frac=0.01)


def _high_volume_bullish():
    """Bullish marubozu with very high volume (3x avg) — institutional conviction."""
    return _bullish_series(avg_range=1.5, avg_vol=2000.0, price=50.0,
                            range_mult=2.0, vol_mult=3.0,
                            uw_frac=0.02, lw_frac=0.03)


def _bearish_after_rally():
    """Bearish marubozu after a rally — conviction selling on expanded range."""
    return _bearish_series(avg_range=1.0, avg_vol=10000.0, price=200.0,
                            range_mult=1.4, vol_mult=1.5,
                            uw_frac=0.03, lw_frac=0.02)


# ─────────────────────────────────────────────
# NEGATIVE FIXTURES  (≥8 required)
# ─────────────────────────────────────────────

def _upper_wick_too_large():
    """FAIL: upper wick = 6% of range (> 5% threshold).

    Bullish bar: uw_frac=0.06 -> body_pct = 1 - 0.06 - 0.02 = 0.92 (passes body check)
    but upper_wick_pct = 0.06 > 0.05  -> REJECTED.
    """
    return _bullish_series(avg_range=2.0, avg_vol=5000.0, price=100.0,
                            range_mult=1.5, vol_mult=2.0,
                            uw_frac=0.06, lw_frac=0.02)


def _lower_wick_too_large():
    """FAIL: lower wick = 7% of range (> 5% threshold).

    Bullish bar: lw_frac=0.07 -> body_pct = 1 - 0.02 - 0.07 = 0.91 (passes body check)
    but lower_wick_pct = 0.07 > 0.05  -> REJECTED.
    """
    return _bullish_series(avg_range=2.0, avg_vol=5000.0, price=100.0,
                            range_mult=1.5, vol_mult=2.0,
                            uw_frac=0.02, lw_frac=0.07)


def _neg_body_and_wick_both_fail():
    """FAIL: body < 90% of range AND both wicks > 5% — both gates fail simultaneously.

    uw_frac=0.055, lw_frac=0.055 -> body_pct = 0.89 < 0.90 (body gate fails first),
    AND upper_wick_pct = 0.055 > 0.05, lower_wick_pct = 0.055 > 0.05 (wick gate also fails).
    Math: body + uw + lw = range → uw + lw = 11% of range → body = 89% < 90%.
    Because uw + lw >= 10% ensures body <= 90%, these two failures are mathematically linked
    — the honest fixture name reflects that both gates fail, body gate fires first.
    """
    bars = _background_bars(22, avg_range=2.0, avg_vol=5000.0, price=100.0)
    t = _last_t(bars)
    signal_range = 2.0 * 1.5   # = 3.0 (passes range gate)
    signal_vol = 5000.0 * 2.0  # passes volume gate
    # uw=lw=5.5% of range -> body = 1 - 0.055 - 0.055 = 0.89 < 0.90
    uw_frac = 0.055
    lw_frac = 0.055
    bar = _make_bullish_marubozu_bar(t, 100.0, signal_range, signal_vol,
                                      uw_frac=uw_frac, lw_frac=lw_frac)
    bars.append(bar)
    return bars


def _range_below_1p2x_avg():
    """FAIL: signal bar range = 1.1× avg (below 1.2× threshold)."""
    return _bullish_series(avg_range=2.0, avg_vol=5000.0, price=100.0,
                            range_mult=1.1, vol_mult=2.0,
                            uw_frac=0.02, lw_frac=0.02)


def _volume_below_1p3x_avg():
    """FAIL: signal bar volume = 1.1× avg (below 1.3× threshold)."""
    return _bullish_series(avg_range=2.0, avg_vol=5000.0, price=100.0,
                            range_mult=1.5, vol_mult=1.1,
                            uw_frac=0.02, lw_frac=0.02)


def _bullish_bar_dcr_too_low():
    """FAIL: up bar but DCR < 0.95 (close in bottom half of range).

    We construct a bar manually: open < close (up bar) but upper wick is so
    large that DCR is low. However we need body >= 90% of range AND upper wick
    <= 5% of range for the wick check to pass — those two constraints force DCR
    to be >= 0.95 for a bullish bar. So we can't have an up bar that passes
    geometry but fails DCR with this detector design.

    Instead: force an up bar with uw_frac=0.08 — wick gate fires before DCR.
    The fixture still represents "DCR failure path" conceptually even though the
    wick gate fires first. This is still a valid negative.

    A cleaner approach: use a bar where close > open but close is near the open
    (not near the high). body = 0.95 * range but positioned mid-range.
    That requires custom construction.

    Manual construction:
      range = 3.0
      high = 103.0
      low  = 100.0
      open = 100.05  (near low)
      close = 102.90 (close > open, up bar, but uw = 103.0 - 102.90 = 0.10 = 3.3% of range)
              body = 102.90 - 100.05 = 2.85 = 95% of range  (passes body gate)
              lw = 100.05 - 100.0 = 0.05 = 1.7% of range    (passes lw gate)
              uw = 0.10 = 3.3% of range                       (passes uw gate)
      DCR = (102.90 - 100.0) / 3.0 = 2.90 / 3.0 = 0.967  -> >= 0.95  PASSES!

    So a valid up bar with body>=90% and wicks<=5% ALWAYS has DCR >= 0.95
    for bullish because DCR = (close - low) / range = (1 - uw_frac) >= 0.95.
    This means the DCR filter for bullish is REDUNDANT given the wick constraints.
    We cannot build a fixture that passes all geometry gates but fails DCR for bullish.

    Resolution: test the DCR-bearish failure instead (bearish bar with DCR > 0.05).
    A down bar (close < open) with lw_frac = 0.10 > 0.05 fails the lower wick gate
    and has DCR = lw_frac = 0.10 > 0.05 (also fails DCR). Both gates fire.

    Or: build a down bar with valid geometry (wicks pass) where we somehow get DCR > 0.05.
    For bearish: DCR = lw_frac. If lw_frac <= 0.05, DCR <= 0.05. So bearish DCR < 0.05
    is ALSO redundant. The wick constraints entirely determine DCR for perfect marubozus.

    Therefore: to test "bullish bar DCR too low path", we must construct a bar where
    close > open (up bar) with specific positioning. The only way DCR < 0.95 while
    body >= 90% is if the body is positioned LOW in the range — but that means upper
    wick is large (> 5%). So upper wick gate fires first.

    We'll build a fixture that tests the "bullish up bar but poor upper wick + DCR" combo.
    """
    bars = _background_bars(22, avg_range=2.0, avg_vol=5000.0, price=100.0)
    t = _last_t(bars)
    signal_range = 3.0   # 1.5x avg
    signal_vol = 10000.0  # 2x avg
    # up bar, body at bottom of range: high much above close
    # uw = 0.40 * range = 1.2  (way above 5% threshold - fails wick gate)
    # body = 0.55 * range = 1.65 (below 90% - fails body gate too)
    # lw = 0.05 * range = 0.15
    h = 100.0 + signal_range        # = 103.0
    l = 100.0
    o = l + 0.15                    # low lw
    c = o + signal_range * 0.55     # body < 90% of range, close well below high
    bar = _bar(t, o, h, l, c, signal_vol)
    bars.append(bar)
    return bars


def _bearish_bar_dcr_too_high():
    """FAIL: down bar but DCR > 0.05 (close NOT in bottom 5% of range).

    For a bearish bar with uw_frac=0.02, lw_frac=0.10:
      DCR = lw_frac = 0.10 > 0.05 -> fails DCR gate AND lw gate.
    The lower wick gate fires first. Still valid negative for 'bearish DCR fail'.
    """
    return _bearish_series(avg_range=2.0, avg_vol=5000.0, price=100.0,
                            range_mult=1.5, vol_mult=2.0,
                            uw_frac=0.02, lw_frac=0.10)


def _ordinary_mixed_candle():
    """FAIL: ordinary candle with wicks > 10% on both sides, body ~60% of range."""
    bars = _background_bars(22, avg_range=2.0, avg_vol=5000.0, price=100.0)
    t = _last_t(bars)
    signal_range = 2.0 * 1.5
    signal_vol = 5000.0 * 2.0
    # body = 60% of range, wicks 20% each -> far from marubozu
    uw_frac = 0.20
    lw_frac = 0.20
    bar = _make_bullish_marubozu_bar(t, 100.0, signal_range, signal_vol,
                                      uw_frac=uw_frac, lw_frac=lw_frac)
    bars.append(bar)
    return bars


def _too_few_bars():
    """FAIL: only 21 bars total — below the _AVG_LOOKBACK + 2 = 22 minimum."""
    bars = _background_bars(20, avg_range=2.0, avg_vol=5000.0, price=100.0)
    t = _last_t(bars)
    # Even if the last bar is a perfect marubozu, n < 22 so detector returns []
    bar = _make_bullish_marubozu_bar(t, 100.0, 4.0, 10000.0,
                                      uw_frac=0.02, lw_frac=0.02)
    bars.append(bar)
    return bars   # 21 bars total


# ─────────────────────────────────────────────
# EDGE FIXTURES  (≥2 required)
# ─────────────────────────────────────────────

def _body_exactly_90pct():
    """EDGE: body exactly 90% of range (boundary condition).

    uw_frac = 0.05, lw_frac = 0.05 -> body = 0.90 * range (exact minimum).
    DCR = (close - low) / range = 1 - uw_frac = 0.95 (exactly at bull DCR minimum).
    This is a double boundary: body == 90% AND DCR == 0.95 — both at exact threshold.
    Should fire (>= comparisons are inclusive).
    """
    return _bullish_series(avg_range=2.0, avg_vol=5000.0, price=100.0,
                            range_mult=1.5, vol_mult=2.0,
                            uw_frac=0.05, lw_frac=0.05)


def _wick_exactly_5pct():
    """EDGE: both wicks exactly 5% of range (upper boundary of allowed wick).

    Same as body_exactly_90pct in terms of math — uw=lw=5% -> body=90%.
    Use a bearish bar this time to demonstrate the bearish boundary:
    uw_frac=0.05, lw_frac=0.05 -> body=0.90, DCR=lw_frac=0.05 (exactly at max).
    Should fire.
    """
    return _bearish_series(avg_range=2.0, avg_vol=5000.0, price=100.0,
                            range_mult=1.5, vol_mult=2.0,
                            uw_frac=0.05, lw_frac=0.05)


def _float_residual_body_boundary():
    """EDGE: body_pct = 0.8999999... (strict float-residual below 90% boundary).

    This fixture is the critical proof that the scoring-tier EPS fix is load-bearing.
    It targets a bar where:
      - body_pct passes the GATE   (body_pct >= _MIN_BODY_PCT - _EPS  ✓)
      - body_pct is strictly < 0.90 in Python floats due to 4-dp rounding
      - WITHOUT the _EPS guard in _score_geometry, body_pct falls into the
        else: body_score = 0.0 branch → geom_score collapses
      - WITH the _EPS guard, body_pct >= 0.90 - 1e-9 → body_score = 65.0

    Construction:
      avg_range = 2.0, signal_range = 2.0 * 1.21 = 2.42
        → range_ratio = 1.21 (≥ 1.20, barely passes range gate)
      uw_frac = lw_frac = 0.05 (exactly at wick boundary)
        → uw = 0.05 * 2.42 = 0.121  → rounded: 0.121
        → lw = 0.121
        → After _bar() rounding, body_pct = (c - o) / (h - l) = 0.899999999999998
           (verified: body_pct < 0.90 is True in Python floats at 64-bit precision)
      vol_mult = 1.35 → vol_ratio = 1.35 (≥ 1.30, minimum passing, → vol_score = 55.0)
      Context = NEUTRAL (stage=1, dcr_sig=neutral, ma=mixed → ctx_score = 60.0)

    Score proof:
      WITHOUT fix: body_score = 0.0 → geom_score = 40.50
        confidence = 0.40*40.50 + 0.25*55.0 + 0.20*60.0 + 0.15*50.0 = 49.45 < 50 → NO FIRE
      WITH fix:    body_score = 65.0 → geom_score = 63.25
        confidence = 0.40*63.25 + 0.25*55.0 + 0.20*60.0 + 0.15*50.0 = 58.55 ≥ 50 → FIRES ✓

    Expected: fires with confidence >= 50.0 (requires the scoring-tier EPS fix).
    """
    bars = _background_bars(22, avg_range=2.0, avg_vol=5000.0, price=100.0)
    t = _last_t(bars)
    # range_mult=1.21 → signal_range = 2.0 * 1.21 = 2.42
    # After _make_bullish_marubozu_bar + _bar() rounding to 4dp:
    #   uw = 0.05 * 2.42 = 0.121, lw = 0.121, body = 2.178
    #   bar: o=97.822, h=100.121, l=97.701, c=100.0
    #   actual h-l = 2.42 exactly, c-o = 2.178, body_pct = 2.178/2.42 = 0.899999...
    signal_range = 2.0 * 1.21   # = 2.42
    signal_vol = 5000.0 * 1.35  # = 6750.0  → vol_ratio = 1.35 (minimum passing)
    bar = _make_bullish_marubozu_bar(t, 100.0, signal_range, signal_vol,
                                      uw_frac=0.05, lw_frac=0.05)
    bars.append(bar)
    return bars


# ─────────────────────────────────────────────
# Writer
# ─────────────────────────────────────────────
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
    # ── 5 POSITIVE ──────────────────────────────────────────
    _write(
        "bullish_clean_uptrend", "positive",
        _clean_bullish_marubozu(), BULL_TREND_CONTEXT,
        {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
         "geometry_shape": "candle_mark"},
    )

    _write(
        "bearish_clean_downtrend", "positive",
        _clean_bearish_marubozu(), BEAR_TREND_CONTEXT,
        {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
         "geometry_shape": "candle_mark"},
    )

    _write(
        "bullish_near_zero_wicks", "positive",
        _near_zero_wick_bullish(), BULL_TREND_CONTEXT,
        {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
         "geometry_shape": "candle_mark"},
    )

    _write(
        "bullish_high_volume", "positive",
        _high_volume_bullish(), BULL_TREND_CONTEXT,
        {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
         "geometry_shape": "candle_mark"},
    )

    _write(
        "bearish_after_rally", "positive",
        _bearish_after_rally(), BEAR_TREND_CONTEXT,
        {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
         "geometry_shape": "candle_mark"},
    )

    # ── 9 NEGATIVE ──────────────────────────────────────────
    _write(
        "neg_upper_wick_too_large", "negative",
        _upper_wick_too_large(), BULL_TREND_CONTEXT,
        {"fires": False},
    )

    _write(
        "neg_lower_wick_too_large", "negative",
        _lower_wick_too_large(), BULL_TREND_CONTEXT,
        {"fires": False},
    )

    _write(
        "neg_body_and_wick_both_fail", "negative",
        _neg_body_and_wick_both_fail(), BULL_TREND_CONTEXT,
        {"fires": False},
    )

    _write(
        "neg_range_below_1p2x", "negative",
        _range_below_1p2x_avg(), BULL_TREND_CONTEXT,
        {"fires": False},
    )

    _write(
        "neg_volume_below_1p3x", "negative",
        _volume_below_1p3x_avg(), BULL_TREND_CONTEXT,
        {"fires": False},
    )

    _write(
        "neg_bullish_bar_bad_positioning", "negative",
        _bullish_bar_dcr_too_low(), BULL_TREND_CONTEXT,
        {"fires": False},
    )

    _write(
        "neg_bearish_bar_dcr_too_high", "negative",
        _bearish_bar_dcr_too_high(), BEAR_TREND_CONTEXT,
        {"fires": False},
    )

    _write(
        "neg_ordinary_mixed_candle", "negative",
        _ordinary_mixed_candle(), NEUTRAL_CONTEXT,
        {"fires": False},
    )

    _write(
        "neg_too_few_bars", "negative",
        _too_few_bars(), NEUTRAL_CONTEXT,
        {"fires": False},
    )

    # ── 2 EDGE ──────────────────────────────────────────────
    _write(
        "edge_body_exactly_90pct", "edge",
        _body_exactly_90pct(), BULL_TREND_CONTEXT,
        {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
         "geometry_shape": "candle_mark"},
    )

    _write(
        "edge_wick_exactly_5pct_bearish", "edge",
        _wick_exactly_5pct(), BEAR_TREND_CONTEXT,
        {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
         "geometry_shape": "candle_mark"},
    )

    _write(
        "edge_float_residual_body_boundary", "edge",
        _float_residual_body_boundary(), NEUTRAL_CONTEXT,
        {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
         "geometry_shape": "candle_mark"},
    )

    print("\nDone — 17 fixtures written.")


if __name__ == "__main__":
    main()
