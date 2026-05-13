"""Hammer fixture generator. 15 fixtures total.

Anatomy: lower_wick >= 2x body, upper_wick <= 0.5x body, body_to_range <= 0.35.
Context: at swing low OR after recent decline.
"""
import json
import os

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))
T0 = 1700000000
DT = 86400


def _bar(t, o, h, l, c, v=1000.0):
    return {"t": t, "o": round(o, 2), "h": round(h, 2),
            "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)}


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


# ============== POSITIVE ==============

def _classic_hammer_at_swing_low():
    """15-bar downtrend, then a textbook hammer."""
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    # body 0.30, lower wick 1.50 (5x), upper wick 0.05
    # range 1.85, body_to_range 16%
    bars.append(_bar(t, 50.10, 50.45, 48.60, 50.40, 1800.0))
    return bars


def _green_hammer_after_decline():
    """Decline + a strong green hammer."""
    bars = _downtrend(15, 70.0, 55.0)
    t = _last_t(bars)
    # body 0.50 (green, c > o), lower wick 2.00 (4x), upper wick 0.10
    bars.append(_bar(t, 55.00, 55.60, 53.00, 55.50, 2200.0))
    return bars


def _red_hammer_at_low():
    """Red hammer (close < open) - still valid."""
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    # body 0.20 red, lower wick 1.50 (7.5x), upper wick 0.05
    bars.append(_bar(t, 50.20, 50.30, 48.60, 50.00, 2000.0))
    return bars


def _hammer_at_support():
    """Hammer right at nearest_support level."""
    bars = _downtrend(15, 65.0, 50.0)
    t = _last_t(bars)
    # body 0.25, lower wick 1.75, upper wick 0.05
    bars.append(_bar(t, 50.05, 50.35, 48.30, 50.30, 2400.0))
    return bars


def _hammer_after_pullback():
    """Hammer after a sharp pullback inside a longer uptrend (close < SMA50)."""
    # 30 bars uptrend then 15 bars pullback
    bars = _uptrend(30, 40.0, 65.0)
    t = _last_t(bars)
    pullback = _downtrend(15, 65.0, 50.0, t_start=t)
    bars.extend(pullback)
    t = _last_t(bars)
    bars.append(_bar(t, 50.10, 50.40, 48.60, 50.35, 2000.0))
    return bars


# ============== NEGATIVE ==============

def _hammer_anatomy_no_context():
    """Hammer ANATOMY but at the TOP of a wide chop range (not at swing low),
    on low volume, with no recent decline. Context+volume gates floor it."""
    # Wide-range chop spanning 48-52 for 20 bars - many low pivots exist
    bars = []
    t = T0
    for i in range(20):
        # Alternate between chop highs and lows so the recent low is the FLOOR
        if i % 2 == 0:
            bars.append(_bar(t, 50.0, 52.0, 48.0, 51.0, 5000.0))  # high-vol high bar
        else:
            bars.append(_bar(t, 51.0, 51.5, 48.0, 50.0, 5000.0))
        t += DT
    # Last bar is a hammer ANATOMY but its low (49.50) is NOT below the chop floor (48.0)
    # AND volume is very thin, AND no recent decline
    bars.append(_bar(t, 50.95, 51.05, 49.50, 51.00, 400.0))
    return bars


def _big_body_not_hammer():
    """Body too large - body_to_range > 35%."""
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    # body 1.20, range 1.50 (80% body)
    bars.append(_bar(t, 51.20, 51.30, 49.80, 50.00, 1500.0))
    return bars


def _upper_wick_too_large():
    """Upper wick > 0.5x body - fails the suppressed-upper-wick gate."""
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    # body 0.30, lower wick 1.50, upper wick 0.40 (>15% of body=50%)
    bars.append(_bar(t, 50.00, 50.80, 48.50, 50.30, 1500.0))
    return bars


def _lower_wick_too_small():
    """Lower wick < 2x body - not a hammer."""
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    # body 0.40, lower wick 0.60 (1.5x), upper wick 0.05
    bars.append(_bar(t, 50.00, 50.45, 49.30, 50.40, 1500.0))
    return bars


def _hammer_in_uptrend():
    """Hammer anatomy in a clear uptrend - context score floors it."""
    bars = _uptrend(30, 40.0, 65.0)
    t = _last_t(bars)
    # Hammer-like at the top of an uptrend with NO recent decline. Context = 0
    bars.append(_bar(t, 65.00, 65.10, 63.30, 65.05, 1500.0))
    return bars


def _short_series():
    return _flat(4, 50.0)


def _no_hammer_in_last_5():
    """Hammer 8 bars back, last 5 are big-body bars."""
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.10, 50.45, 48.60, 50.40, 1800.0))  # hammer
    t += DT
    # 5 big-body bars after
    for _ in range(5):
        bars.append(_bar(t, 50.0, 51.50, 49.50, 51.00, 1500.0))
        t += DT
    return bars


def _doji_not_hammer():
    """Doji body (body < 5% range) - skipped because body is zero/tiny."""
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    # body 0.0, lower wick = total range = 1.50
    bars.append(_bar(t, 50.00, 50.05, 48.50, 50.00, 1500.0))
    return bars


# ============== EDGE ==============

def _boundary_lower_wick_exactly_2x():
    """Lower wick exactly 2x body - boundary anatomy.

    bar: open=50.30, close=49.80, body=0.50
    body_top=50.30, body_bot=49.80
    upper_wick = high - body_top = 50.40 - 50.30 = 0.10
    lower_wick = body_bot - low = 49.80 - 48.80 = 1.00  (= 2.0 x body)
    body_to_range = 0.50 / 1.60 = 31% (under 35%)
    """
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.30, 50.40, 48.80, 49.80, 1800.0))
    return bars


def _boundary_body_to_range_35pct():
    """Body to range exactly 35% - boundary."""
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    # body 0.35, lower wick 0.70 (2x), upper wick 0.05
    # range = 1.10, body_to_range = 32%
    bars.append(_bar(t, 50.00, 50.05, 48.95, 50.35, 1800.0))
    return bars


GOOD_CONTEXT = {
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


def _write(name, category, bars, context, expected):
    payload = {"name": name, "category": category, "expected": expected,
               "context": context, "bars": bars}
    path = os.path.join(_OUT_DIR, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {path}  ({len(bars)} bars)")


def main():
    # 5 POSITIVE
    _write("classic_hammer_swing_low", "positive",
           _classic_hammer_at_swing_low(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("green_hammer_after_decline", "positive",
           _green_hammer_after_decline(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("red_hammer_at_low", "positive",
           _red_hammer_at_low(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("hammer_at_support", "positive",
           _hammer_at_support(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("hammer_after_pullback", "positive",
           _hammer_after_pullback(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    # 8 NEGATIVE
    _write("hammer_no_context", "negative",
           _hammer_anatomy_no_context(), NEUTRAL_CONTEXT,
           {"fires": False})

    _write("big_body_not_hammer", "negative",
           _big_body_not_hammer(), GOOD_CONTEXT, {"fires": False})

    _write("upper_wick_too_large", "negative",
           _upper_wick_too_large(), GOOD_CONTEXT, {"fires": False})

    _write("lower_wick_too_small", "negative",
           _lower_wick_too_small(), GOOD_CONTEXT, {"fires": False})

    _write("hammer_in_uptrend", "negative",
           _hammer_in_uptrend(), UPTREND_CONTEXT, {"fires": False})

    _write("short_series", "negative",
           _short_series(), NEUTRAL_CONTEXT, {"fires": False})

    _write("no_hammer_in_last_5", "negative",
           _no_hammer_in_last_5(), GOOD_CONTEXT, {"fires": False})

    _write("doji_not_hammer", "negative",
           _doji_not_hammer(), GOOD_CONTEXT, {"fires": False})

    # 2 EDGE
    _write("boundary_lower_wick_2x", "edge",
           _boundary_lower_wick_exactly_2x(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("boundary_body_to_range_35pct", "edge",
           _boundary_body_to_range_35pct(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    print("\nDone — 15 fixtures written.")


if __name__ == "__main__":
    main()
