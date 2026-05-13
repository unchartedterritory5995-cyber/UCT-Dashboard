"""Hanging man fixture generator. 15 fixtures total.

Anatomy: same as hammer (long lower wick, small body, suppressed upper wick).
Context: at swing high OR (above 50sma AND recent 20-bar high made within last 5 bars)
         OR (recent advance >= 10% AND trend_stage in (2,3)).
"""
import json
import os

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))
T0 = 1700000000
DT = 86400


def _bar(t, o, h, l, c, v=1000.0):
    return {"t": t, "o": round(o, 2), "h": round(h, 2),
            "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)}


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


# ============== POSITIVE ==============

def _hanging_man_at_swing_high():
    """Sustained uptrend, hanging man right at the swing high."""
    bars = _uptrend(25, 50.0, 65.0)
    t = _last_t(bars)
    # body 0.30, lower wick 1.50 (5x), upper wick 0.05
    bars.append(_bar(t, 64.90, 65.00, 63.30, 64.60, 1500.0))
    return bars


def _red_hanging_man_after_run():
    """Red hanging man (close < open) after a big advance."""
    bars = _uptrend(25, 40.0, 60.0)
    t = _last_t(bars)
    # body 0.40 red (c<o), lower wick 2.00 (5x), upper wick 0.05
    bars.append(_bar(t, 60.20, 60.30, 57.80, 59.80, 2000.0))
    return bars


def _green_hanging_man_above_50sma():
    """Hanging man above 50SMA with recent 20-bar high."""
    # 55 bars uptrend ensures both 50sma calc and 20-bar high context
    bars = _uptrend(55, 30.0, 65.0)
    t = _last_t(bars)
    bars.append(_bar(t, 64.95, 65.10, 62.90, 65.05, 1800.0))
    return bars


def _hanging_man_at_resistance():
    """Hanging man tagging a nearest_resistance level (~64.5).
    o=64.50, c=64.20, body=0.30 (red); upper=0.10, lower=1.30 (4.3x body)
    body_top=64.50, body_bot=64.20, h=64.60, l=62.90
    """
    bars = _uptrend(25, 50.0, 64.5)
    t = _last_t(bars)
    bars.append(_bar(t, 64.50, 64.60, 62.90, 64.20, 2000.0))
    return bars


def _hanging_man_after_strong_advance():
    """Hanging man after a ~15% advance in 15 bars.
    o=60.10, c=59.80, body=0.30, upper=0.05, lower=1.50 (5x body)
    """
    bars = _uptrend(15, 50.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.10, 60.15, 58.30, 59.80, 1800.0))
    return bars


# ============== NEGATIVE ==============

def _hanging_man_anatomy_in_downtrend():
    """Hanging man anatomy in a downtrend - context gate rejects."""
    bars = _downtrend(20, 60.0, 50.0)
    t = _last_t(bars)
    # This is actually a hammer in this context — context_gate should reject
    bars.append(_bar(t, 50.10, 50.15, 48.40, 50.05, 1500.0))
    return bars


def _big_body_not_hanging_man():
    """Body too large."""
    bars = _uptrend(20, 50.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.40, 60.50, 58.80, 59.00, 1500.0))
    return bars


def _upper_wick_too_large():
    """Upper wick > 0.5x body."""
    bars = _uptrend(20, 50.0, 60.0)
    t = _last_t(bars)
    # body 0.30, upper 0.40 (> 0.15 = 0.5*body)
    bars.append(_bar(t, 60.00, 60.80, 58.50, 60.30, 1500.0))
    return bars


def _lower_wick_too_small():
    """Lower wick < 2x body."""
    bars = _uptrend(20, 50.0, 60.0)
    t = _last_t(bars)
    # body 0.40, lower 0.60 (1.5x), upper 0.05
    bars.append(_bar(t, 60.00, 60.45, 59.30, 60.40, 1500.0))
    return bars


def _hanging_man_in_chop_no_advance():
    """Hanging man anatomy at a swing LOW (not high) in chop - gate rejects.

    The bar's high is well inside the chop range so swing_high is False.
    The bar's low is below the chop floor so this is actually a swing-LOW
    hammer setup, not a hanging man. Context gate must reject.
    """
    bars = []
    t = T0
    # Wide chop with random highs 51-52, lows 48-49 — keeps bar high inside range
    for i in range(20):
        bars.append(_bar(t, 50.0, 52.0, 48.5, 50.5, 2000.0))
        t += DT
    # Last bar: hanging-man anatomy at the LOW (low 47.5 < chop floor 48.5)
    # high 50.5 = inside the chop range (not a swing high)
    bars.append(_bar(t, 50.0, 50.5, 47.5, 50.3, 1500.0))
    return bars


def _short_series():
    return _flat(4, 60.0)


def _no_hanging_man_in_last_5():
    """Hanging man anatomy 8 bars back, last 5 are normal trend bars."""
    bars = _uptrend(20, 50.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.10, 60.20, 58.40, 60.05, 1800.0))  # hanging man
    t += DT
    for _ in range(5):
        bars.append(_bar(t, 60.10, 60.30, 60.00, 60.25, 1200.0))
        t += DT
    return bars


def _doji_not_hanging_man():
    """Body = 0 - doji territory, not hanging man."""
    bars = _uptrend(20, 50.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.00, 60.05, 58.50, 60.00, 1500.0))
    return bars


# ============== EDGE ==============

def _boundary_lower_wick_exactly_2x():
    """Lower wick exactly 2x body.
    o=60.30, c=59.80, body=0.50 (red); body_top=60.30, body_bot=59.80
    upper_wick = h - 60.30 = 0.10 -> h=60.40
    lower_wick = 59.80 - l = 1.00 -> l=58.80
    """
    bars = _uptrend(20, 50.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.30, 60.40, 58.80, 59.80, 1800.0))
    return bars


def _boundary_body_to_range_35pct():
    """Body 35% of range - boundary.
    body 0.35, lower 0.70 (2x), upper 0.05; range 1.10, b/r = 32%
    o=60.35, c=60.00, low=59.30, high=60.40
    """
    bars = _uptrend(20, 50.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.35, 60.40, 59.30, 60.00, 1800.0))
    return bars


UPTREND_CONTEXT = {
    "trend_stage": 2,
    "rs_trend": "up",
    "ma_alignment": "stacked_bullish",
    "volume_signature": "neutral",
    "regime": "bullish",
    "nearest_resistance": 64.5,
    "nearest_support": 55.0,
    "days_to_earnings": None,
    "sector_strength_rank": None,
}

DOWNTREND_CONTEXT = {
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


def _write(name, category, bars, context, expected):
    payload = {"name": name, "category": category, "expected": expected,
               "context": context, "bars": bars}
    path = os.path.join(_OUT_DIR, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {path}  ({len(bars)} bars)")


def main():
    # 5 POSITIVE
    _write("hanging_man_swing_high", "positive",
           _hanging_man_at_swing_high(), UPTREND_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("red_hanging_man_after_run", "positive",
           _red_hanging_man_after_run(), UPTREND_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("green_hanging_man_above_50sma", "positive",
           _green_hanging_man_above_50sma(), UPTREND_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("hanging_man_at_resistance", "positive",
           _hanging_man_at_resistance(), UPTREND_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("hanging_man_after_advance", "positive",
           _hanging_man_after_strong_advance(), UPTREND_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    # 8 NEGATIVE
    _write("hanging_man_anatomy_in_downtrend", "negative",
           _hanging_man_anatomy_in_downtrend(), DOWNTREND_CONTEXT,
           {"fires": False})

    _write("big_body_not_hanging_man", "negative",
           _big_body_not_hanging_man(), UPTREND_CONTEXT, {"fires": False})

    _write("upper_wick_too_large", "negative",
           _upper_wick_too_large(), UPTREND_CONTEXT, {"fires": False})

    _write("lower_wick_too_small", "negative",
           _lower_wick_too_small(), UPTREND_CONTEXT, {"fires": False})

    _write("hanging_man_in_chop_no_advance", "negative",
           _hanging_man_in_chop_no_advance(), NEUTRAL_CONTEXT, {"fires": False})

    _write("short_series", "negative",
           _short_series(), NEUTRAL_CONTEXT, {"fires": False})

    _write("no_hanging_man_in_last_5", "negative",
           _no_hanging_man_in_last_5(), UPTREND_CONTEXT, {"fires": False})

    _write("doji_not_hanging_man", "negative",
           _doji_not_hanging_man(), UPTREND_CONTEXT, {"fires": False})

    # 2 EDGE
    _write("boundary_lower_wick_2x", "edge",
           _boundary_lower_wick_exactly_2x(), UPTREND_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("boundary_body_to_range_35pct", "edge",
           _boundary_body_to_range_35pct(), UPTREND_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    print("\nDone — 15 fixtures written.")


if __name__ == "__main__":
    main()
