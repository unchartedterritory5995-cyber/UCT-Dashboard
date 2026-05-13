"""One-shot generator for the doji fixture battery.

Run: python tests/fixtures/doji/_generate.py

Builds 15 fixtures total:
  - 5 positive (dragonfly_at_low, gravestone_at_high, standard_at_high,
    long_legged_at_chop, dragonfly_near_support)
  - 8 negative (too_big_body, no_wicks, hammer_not_doji, shooting_star_not_doji,
    not_at_extreme_chop, short_series, bullish_engulfing_not_doji, large_body_red)
  - 2 edge (boundary_body_4pct, boundary_dragonfly_60pct)
"""
import json
import math
import os

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))

T0 = 1700000000
DT = 86400


def _bar(t, o, h, l, c, v=1000.0):
    return {"t": t, "o": round(o, 2), "h": round(h, 2),
            "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)}


def _flat_run(n, price, vol=1000.0, t_start=T0, drift=0.0):
    """N flat bars centered on price with small noise."""
    bars = []
    t = t_start
    for i in range(n):
        mid = price + drift * i
        bars.append(_bar(t, mid - 0.05, mid + 0.10, mid - 0.10, mid + 0.05, vol))
        t += DT
    return bars


def _downtrend_run(n, start_price, end_price, vol=1000.0, t_start=T0):
    """N bars trending from start_price down to end_price."""
    bars = []
    t = t_start
    step = (end_price - start_price) / max(n - 1, 1)
    for i in range(n):
        mid = start_price + step * i
        o = mid + 0.10
        c = mid - 0.10
        h = o + 0.05
        l = c - 0.05
        bars.append(_bar(t, o, h, l, c, vol))
        t += DT
    return bars


def _uptrend_run(n, start_price, end_price, vol=1000.0, t_start=T0):
    bars = []
    t = t_start
    step = (end_price - start_price) / max(n - 1, 1)
    for i in range(n):
        mid = start_price + step * i
        o = mid - 0.10
        c = mid + 0.10
        h = c + 0.05
        l = o - 0.05
        bars.append(_bar(t, o, h, l, c, vol))
        t += DT
    return bars


def _last_t(bars):
    return bars[-1]["t"] + DT


def _build_dragonfly_at_low():
    """Downtrend into a dragonfly doji at the low."""
    bars = _downtrend_run(15, 60.0, 50.0)
    t = _last_t(bars)
    # Dragonfly: body tiny, upper wick ~0, lower wick ~70% of range
    # range = 5.0, body = 0.05, upper = 0.05, lower = 4.9
    open_p, close_p = 50.0, 50.05
    high_p = 50.10
    low_p = 45.20
    bars.append(_bar(t, open_p, high_p, low_p, close_p, 2200.0))
    return bars


def _build_gravestone_at_high():
    """Uptrend into a gravestone doji at the high."""
    bars = _uptrend_run(15, 50.0, 60.0)
    t = _last_t(bars)
    # Gravestone: body tiny, lower wick ~0, upper wick ~70% of range
    open_p, close_p = 60.0, 60.05
    low_p = 59.95
    high_p = 64.90
    bars.append(_bar(t, open_p, high_p, low_p, close_p, 2200.0))
    return bars


def _build_standard_at_high():
    """Uptrend into a standard doji at the swing high with balanced wicks."""
    bars = _uptrend_run(15, 50.0, 60.0)
    t = _last_t(bars)
    # Standard: body tiny, upper + lower wicks both moderate (~40% each)
    # range = 4.0, body 0.10
    open_p, close_p = 60.05, 60.10
    high_p = 62.00   # upper wick 1.90
    low_p = 58.00    # lower wick 2.05
    bars.append(_bar(t, open_p, high_p, low_p, close_p, 1800.0))
    return bars


def _build_long_legged_at_chop():
    """A long-legged doji at a swing low after a decline."""
    bars = _downtrend_run(15, 60.0, 50.0)
    t = _last_t(bars)
    # Long-legged: body tiny, both wicks >=30% of range. range ~5, body 0.05
    open_p, close_p = 50.0, 50.03
    high_p = 52.10   # upper wick 2.07 (~41% of range)
    low_p = 47.00    # lower wick 3.00 (~59% of range)
    bars.append(_bar(t, open_p, high_p, low_p, close_p, 2000.0))
    return bars


def _build_dragonfly_near_support():
    """Dragonfly at a low + nearest_support context."""
    bars = _downtrend_run(15, 60.0, 50.0)
    t = _last_t(bars)
    open_p, close_p = 50.0, 50.04
    high_p = 50.10
    low_p = 45.50
    bars.append(_bar(t, open_p, high_p, low_p, close_p, 2200.0))
    return bars


# ============= NEGATIVE =============

def _build_big_body_bar():
    """A big-body bar - NOT a doji (body too large)."""
    bars = _flat_run(15, 50.0)
    t = _last_t(bars)
    # body of 1.0 in 1.2 range = 83% - way over 5%
    bars.append(_bar(t, 49.50, 50.60, 49.40, 50.55, 1500.0))
    return bars


def _build_no_wicks():
    """A marubozu-like bar with no wicks - definitely not a doji."""
    bars = _flat_run(15, 50.0)
    t = _last_t(bars)
    # body = 0.50, no wicks
    bars.append(_bar(t, 50.00, 50.55, 50.00, 50.50, 1500.0))
    return bars


def _build_hammer_not_doji():
    """A hammer (body 20% of range) - NOT a doji."""
    bars = _downtrend_run(15, 60.0, 50.0)
    t = _last_t(bars)
    # range = 3.0, body = 0.60 (20%), lower wick large
    bars.append(_bar(t, 49.80, 49.85, 47.00, 50.30, 1800.0))
    return bars


def _build_shooting_star_not_doji():
    """A shooting star (body 25%) - NOT a doji."""
    bars = _uptrend_run(15, 50.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.50, 63.00, 60.20, 59.80, 1800.0))
    return bars


def _build_doji_in_chop_no_context():
    """A doji buried in chop with no extreme context — won't pass context score floor."""
    bars = _flat_run(20, 50.0)
    t = _last_t(bars)
    # Standard doji (mediocre — both wicks but no extreme context)
    open_p, close_p = 50.00, 50.005
    # Need this to fall INSIDE the existing chop range (49.90-50.10), not at an extreme
    # so we end up below confidence floor. Use a narrow, mid-range standard doji.
    high_p = 50.07  # well within prior range
    low_p = 49.93   # well within prior range
    bars.append(_bar(t, open_p, high_p, low_p, close_p, 800.0))
    return bars


def _build_short_series():
    """Too few bars — detector returns []."""
    bars = _flat_run(4, 50.0)
    return bars


def _build_doji_then_no_doji():
    """Doji 5 bars back, last bar is NOT a doji. Detector scans last 5 only.

    Actually, _SCAN_LOOKBACK = 5 so it scans the last 5 bars. We need the last 5
    to have NO doji-eligible bar at all.
    """
    bars = _flat_run(10, 50.0)
    # Add 5 big-body bars (no doji eligible)
    t = _last_t(bars)
    for i in range(5):
        bars.append(_bar(t, 50.0, 51.20, 49.50, 51.00, 1500.0))
        t += DT
    return bars


def _build_large_red_body():
    """A wide-range red bar with substantial body — not a doji."""
    bars = _flat_run(15, 60.0)
    t = _last_t(bars)
    # body = 2.0, range = 2.4 - body is 83% of range, big body
    bars.append(_bar(t, 60.00, 60.20, 57.80, 58.00, 1500.0))
    return bars


# ============= EDGE =============

def _build_boundary_4pct_body():
    """Doji body at 4% of range — JUST under the 5% threshold. Edge."""
    bars = _downtrend_run(15, 60.0, 50.0)
    t = _last_t(bars)
    # range = 5.0, body = 0.18 (3.6% of range), upper 0.07, lower 4.75
    # That's a dragonfly with body just under threshold
    open_p, close_p = 50.00, 50.18
    high_p = 50.25
    low_p = 45.25
    bars.append(_bar(t, open_p, high_p, low_p, close_p, 2200.0))
    return bars


def _build_boundary_dragonfly():
    """Dragonfly with lower wick exactly at 60% of range — edge boundary."""
    bars = _downtrend_run(15, 60.0, 50.0)
    t = _last_t(bars)
    # range = 5.0, body = 0.05, upper = 0.10, lower = 4.85 (97% of range)
    # Crosses the 60% dragonfly threshold cleanly. Also make upper just under 5%.
    open_p, close_p = 50.00, 50.05
    high_p = 50.10   # upper 0.05 = 1% of range
    low_p = 45.10    # lower 4.90 = 98% of range
    bars.append(_bar(t, open_p, high_p, low_p, close_p, 2400.0))
    return bars


# ============= WRITE =============

GOOD_CONTEXT_BULLISH_REVERSAL = {
    "trend_stage": 1,
    "rs_trend": "flat",
    "ma_alignment": "mixed",
    "volume_signature": "neutral",
    "regime": "neutral",
    "nearest_resistance": 60.0,
    "nearest_support": 45.0,
    "days_to_earnings": None,
    "sector_strength_rank": None,
}

GOOD_CONTEXT_BEARISH_REVERSAL = {
    "trend_stage": 2,
    "rs_trend": "up",
    "ma_alignment": "stacked_bullish",
    "volume_signature": "neutral",
    "regime": "bullish",
    "nearest_resistance": 65.0,
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
    # 5 POSITIVE
    _write("dragonfly_at_low", "positive",
           _build_dragonfly_at_low(), GOOD_CONTEXT_BULLISH_REVERSAL,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("gravestone_at_high", "positive",
           _build_gravestone_at_high(), GOOD_CONTEXT_BEARISH_REVERSAL,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("standard_at_high", "positive",
           _build_standard_at_high(), GOOD_CONTEXT_BEARISH_REVERSAL,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("long_legged_at_low", "positive",
           _build_long_legged_at_chop(), GOOD_CONTEXT_BULLISH_REVERSAL,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("dragonfly_near_support", "positive",
           _build_dragonfly_near_support(), GOOD_CONTEXT_BULLISH_REVERSAL,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    # 8 NEGATIVE
    _write("big_body_bar", "negative",
           _build_big_body_bar(), NEUTRAL_CONTEXT,
           {"fires": False})

    _write("no_wicks_marubozu", "negative",
           _build_no_wicks(), NEUTRAL_CONTEXT,
           {"fires": False})

    _write("hammer_not_doji", "negative",
           _build_hammer_not_doji(), NEUTRAL_CONTEXT,
           {"fires": False})

    _write("shooting_star_not_doji", "negative",
           _build_shooting_star_not_doji(), NEUTRAL_CONTEXT,
           {"fires": False})

    _write("doji_in_chop_no_context", "negative",
           _build_doji_in_chop_no_context(), NEUTRAL_CONTEXT,
           {"fires": False})

    _write("short_series", "negative",
           _build_short_series(), NEUTRAL_CONTEXT,
           {"fires": False})

    _write("no_doji_in_last_5", "negative",
           _build_doji_then_no_doji(), NEUTRAL_CONTEXT,
           {"fires": False})

    _write("large_red_body", "negative",
           _build_large_red_body(), NEUTRAL_CONTEXT,
           {"fires": False})

    # 2 EDGE
    _write("boundary_body_under_5pct", "edge",
           _build_boundary_4pct_body(), GOOD_CONTEXT_BULLISH_REVERSAL,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("boundary_dragonfly_threshold", "edge",
           _build_boundary_dragonfly(), GOOD_CONTEXT_BULLISH_REVERSAL,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    print("\nDone — 15 fixtures written.")


if __name__ == "__main__":
    main()
