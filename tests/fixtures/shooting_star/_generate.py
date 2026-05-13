"""Shooting Star fixture generator. 15 fixtures total.

Anatomy: upper_wick >= 2x body, lower_wick <= 0.5x body, body_to_range <= 0.35.
Context: at swing high OR after a sustained advance.
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

def _shooting_star_swing_high():
    """Sustained uptrend, shooting star at swing high.
    o=64.80, c=64.40, body=0.40 red; upper=1.50 (3.75x), lower=0.05
    body_top=64.80, body_bot=64.40, h=66.30, l=64.35
    body_to_range = 0.40 / 1.95 = 0.205 (under 0.35)
    """
    bars = _uptrend(25, 50.0, 65.0)
    t = _last_t(bars)
    bars.append(_bar(t, 64.80, 66.30, 64.35, 64.40, 2200.0))
    return bars


def _red_shooting_star_after_run():
    """Red shooting star after a big advance.
    o=60.20, c=59.80, body=0.40 red; upper=1.80 (4.5x), lower=0.05
    body_top=60.20, body_bot=59.80, h=62.00, l=59.75
    body_to_range = 0.40 / 2.25 = 0.178
    """
    bars = _uptrend(25, 40.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.20, 62.00, 59.75, 59.80, 2200.0))
    return bars


def _shooting_star_above_50sma():
    """Above 50SMA with fresh 20-bar high.
    o=64.80, c=65.10, body=0.30 green; upper=1.20 (4x), lower=0.05
    body_top=65.10, body_bot=64.80, h=66.30, l=64.75
    body_to_range = 0.30 / 1.55 = 0.194
    """
    bars = _uptrend(55, 30.0, 65.0)
    t = _last_t(bars)
    bars.append(_bar(t, 64.80, 66.30, 64.75, 65.10, 2000.0))
    return bars


def _shooting_star_at_resistance():
    """Shooting star tagging a resistance level.
    o=64.40, c=64.10, body=0.30 red; upper=1.50 (5x), lower=0.05
    body_top=64.40, body_bot=64.10, h=65.90, l=64.05
    body_to_range = 0.30 / 1.85 = 0.162
    """
    bars = _uptrend(25, 50.0, 64.5)
    t = _last_t(bars)
    bars.append(_bar(t, 64.40, 65.90, 64.05, 64.10, 2400.0))
    return bars


def _shooting_star_after_advance():
    """Shooting star after a 20% advance.
    o=59.90, c=59.60, body=0.30 red; upper=1.50 (5x), lower=0.05
    body_top=59.90, body_bot=59.60, h=61.40, l=59.55
    body_to_range = 0.30 / 1.85 = 0.162
    """
    bars = _uptrend(15, 50.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 59.90, 61.40, 59.55, 59.60, 2000.0))
    return bars


# ============== NEGATIVE ==============

def _shooting_star_anatomy_in_downtrend():
    """Shooting star anatomy in a downtrend - context gate rejects."""
    bars = _downtrend(20, 60.0, 50.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.20, 51.70, 50.15, 50.00, 1500.0))
    return bars


def _big_body_not_shooting_star():
    """Body too large."""
    bars = _uptrend(20, 50.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.50, 61.00, 58.80, 59.00, 1500.0))
    return bars


def _lower_wick_too_large():
    """Lower wick > 0.5x body - fails the suppressed-lower-wick gate.
    o=60.20, c=60.50, body=0.30 green; upper=0.70 (>2x), lower=0.40 (>0.15)
    """
    bars = _uptrend(20, 50.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.20, 61.20, 59.80, 60.50, 1500.0))
    return bars


def _upper_wick_too_small():
    """Upper wick < 2x body - not a shooting star.
    body=0.40, upper=0.60 (1.5x), lower=0.05
    """
    bars = _uptrend(20, 50.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.00, 60.60, 59.55, 59.60, 1500.0))
    return bars


def _shooting_star_in_chop_no_advance():
    """Anatomy in chop with no advance — gate rejects."""
    bars = []
    t = T0
    for i in range(20):
        bars.append(_bar(t, 50.0, 52.0, 48.5, 50.5, 2000.0))
        t += DT
    # Anatomy at a HIGH that is INSIDE the chop range (not a swing high)
    bars.append(_bar(t, 50.50, 51.80, 50.45, 50.20, 1500.0))
    return bars


def _short_series():
    return _flat(4, 60.0)


def _no_shooting_star_in_last_5():
    """Shooting star 8 bars back, last 5 are normal trend bars."""
    bars = _uptrend(20, 50.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 59.90, 61.40, 59.55, 59.60, 2000.0))  # shooting star
    t += DT
    for _ in range(5):
        bars.append(_bar(t, 59.90, 60.10, 59.80, 60.05, 1200.0))
        t += DT
    return bars


def _doji_not_shooting_star():
    """Body = 0 - doji territory."""
    bars = _uptrend(20, 50.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.00, 61.50, 59.95, 60.00, 1500.0))
    return bars


# ============== EDGE ==============

def _boundary_upper_wick_exactly_2x():
    """Upper wick just above 2x body — boundary anatomy.
    o=60.20, c=59.80, body=0.40 red; upper=0.82 (2.05x), lower=0.05
    body_top=60.20, body_bot=59.80, h=61.02, l=59.75
    body_to_range = 0.40 / 1.27 = 0.315
    """
    bars = _uptrend(20, 50.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.20, 61.02, 59.75, 59.80, 1800.0))
    return bars


def _boundary_body_to_range_35pct():
    """Body just under 35% of range — boundary.
    o=60.35, c=60.00, body=0.35 red; upper=0.72 (2.05x), lower=0.05
    body_top=60.35, body_bot=60.00, h=61.07, l=59.95
    body_to_range = 0.35 / 1.12 = 0.313
    """
    bars = _uptrend(20, 50.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.35, 61.07, 59.95, 60.00, 1800.0))
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
    _write("shooting_star_swing_high", "positive",
           _shooting_star_swing_high(), UPTREND_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("red_shooting_star_after_run", "positive",
           _red_shooting_star_after_run(), UPTREND_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("shooting_star_above_50sma", "positive",
           _shooting_star_above_50sma(), UPTREND_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("shooting_star_at_resistance", "positive",
           _shooting_star_at_resistance(), UPTREND_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("shooting_star_after_advance", "positive",
           _shooting_star_after_advance(), UPTREND_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    # 8 NEGATIVE
    _write("shooting_star_in_downtrend", "negative",
           _shooting_star_anatomy_in_downtrend(), DOWNTREND_CONTEXT,
           {"fires": False})

    _write("big_body_not_shooting_star", "negative",
           _big_body_not_shooting_star(), UPTREND_CONTEXT, {"fires": False})

    _write("lower_wick_too_large", "negative",
           _lower_wick_too_large(), UPTREND_CONTEXT, {"fires": False})

    _write("upper_wick_too_small", "negative",
           _upper_wick_too_small(), UPTREND_CONTEXT, {"fires": False})

    _write("shooting_star_in_chop_no_advance", "negative",
           _shooting_star_in_chop_no_advance(), NEUTRAL_CONTEXT,
           {"fires": False})

    _write("short_series", "negative",
           _short_series(), NEUTRAL_CONTEXT, {"fires": False})

    _write("no_shooting_star_in_last_5", "negative",
           _no_shooting_star_in_last_5(), UPTREND_CONTEXT, {"fires": False})

    _write("doji_not_shooting_star", "negative",
           _doji_not_shooting_star(), UPTREND_CONTEXT, {"fires": False})

    # 2 EDGE
    _write("boundary_upper_wick_2x", "edge",
           _boundary_upper_wick_exactly_2x(), UPTREND_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("boundary_body_to_range_35pct", "edge",
           _boundary_body_to_range_35pct(), UPTREND_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    print("\nDone — 15 fixtures written.")


if __name__ == "__main__":
    main()
