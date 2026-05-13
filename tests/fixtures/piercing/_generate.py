"""Piercing Pattern fixture generator. 15 fixtures total.

Geometry: prev red long-body, curr green, curr.open < prev.low (gap down),
curr.close > midpoint, curr.close < prev.open (not full engulf).
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
    bars, t = [], t_start
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
    bars, t = [], t_start
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


def _last_t(bars):
    return bars[-1]["t"] + DT


# ============== POSITIVE ==============

def _clean_at_swing_low():
    """Long red bar then green piercing.

    prev: open 52.0, close 50.0, body 2.0, range 52.1->49.9 = 2.2, body 91%.
    midpoint = 51.0
    curr: open 49.5 (below prev_low 49.9), close 51.5 (above midpoint, below prev_open 52.0).
    body 2.0. range 49.5->51.6.
    """
    bars = _downtrend(15, 60.0, 52.0)
    t = _last_t(bars)
    # Long red
    bars.append(_bar(t, 52.00, 52.10, 49.90, 50.00, 1500.0))
    t += DT
    # Gap-down green piercing
    bars.append(_bar(t, 49.50, 51.60, 49.50, 51.50, 2000.0))
    return bars


def _deep_penetration():
    """Penetration close to 90% (curr_close near prev_open)."""
    bars = _downtrend(15, 60.0, 52.0)
    t = _last_t(bars)
    bars.append(_bar(t, 52.00, 52.10, 49.90, 50.00, 1500.0))
    t += DT
    # midpoint 51.0, prev_open 52.0. close 51.85 = ~85% penetration
    bars.append(_bar(t, 49.50, 51.95, 49.50, 51.85, 2200.0))
    return bars


def _high_volume_piercing():
    """Volume 2.5x prior — strong reversal signature."""
    bars = _downtrend(15, 60.0, 52.0, vol=1200.0)
    t = _last_t(bars)
    bars.append(_bar(t, 52.00, 52.10, 49.90, 50.00, 1500.0))
    t += DT
    bars.append(_bar(t, 49.50, 51.60, 49.50, 51.50, 3800.0))
    return bars


def _strong_dcr_close():
    """DCR ~0.93 (near top of range)."""
    bars = _downtrend(15, 60.0, 52.0)
    t = _last_t(bars)
    bars.append(_bar(t, 52.00, 52.10, 49.90, 50.00, 1500.0))
    t += DT
    # range 49.30 → 51.70, close 51.65. DCR (51.65-49.30)/(51.70-49.30) = 0.979
    # close 51.65 > midpoint 51.0, < prev_open 52.0. open 49.40 < prev_low 49.90.
    bars.append(_bar(t, 49.40, 51.70, 49.30, 51.65, 2100.0))
    return bars


def _after_decline_distribution_signature():
    """Long decline with weak closes then piercing."""
    bars, t = [], T0
    price = 70.0
    for i in range(20):
        # weak closes → distribution signature
        o = price
        h = price + 0.30
        l = price - 1.50
        c = price - 1.30
        bars.append(_bar(t, o, h, l, c, 1500.0))
        price -= 1.00
        t += DT
    # Long red bar
    bars.append(_bar(t, 52.00, 52.10, 49.90, 50.00, 1500.0))
    t += DT
    # Piercing
    bars.append(_bar(t, 49.50, 51.60, 49.50, 51.50, 2500.0))
    return bars


# ============== NEGATIVE ==============

def _no_gap_down():
    """Curr opens at/above prev_low — fails gap-down gate."""
    bars = _downtrend(15, 60.0, 52.0)
    t = _last_t(bars)
    bars.append(_bar(t, 52.00, 52.10, 49.90, 50.00, 1500.0))
    t += DT
    # opens at 49.95 (>= prev_low 49.90)
    bars.append(_bar(t, 49.95, 51.60, 49.85, 51.50, 1500.0))
    return bars


def _close_below_midpoint():
    """Curr closes below midpoint — fails > midpoint gate."""
    bars = _downtrend(15, 60.0, 52.0)
    t = _last_t(bars)
    bars.append(_bar(t, 52.00, 52.10, 49.90, 50.00, 1500.0))  # midpoint 51.0
    t += DT
    # closes at 50.80 (below midpoint 51.0)
    bars.append(_bar(t, 49.50, 50.85, 49.50, 50.80, 1500.0))
    return bars


def _full_engulf_not_piercing():
    """Curr closes above prev_open — this is full engulfing, not piercing."""
    bars = _downtrend(15, 60.0, 52.0)
    t = _last_t(bars)
    bars.append(_bar(t, 52.00, 52.10, 49.90, 50.00, 1500.0))
    t += DT
    # closes at 52.20 (above prev_open 52.00) - full engulfing
    bars.append(_bar(t, 49.50, 52.30, 49.50, 52.20, 1500.0))
    return bars


def _prev_bar_too_short():
    """Prev body < 40% of range — fails long-bar gate."""
    bars = _downtrend(15, 60.0, 52.0)
    t = _last_t(bars)
    # body 0.40, range 2.0 → 20% body
    bars.append(_bar(t, 51.00, 52.00, 50.00, 50.60, 1500.0))
    t += DT
    bars.append(_bar(t, 49.50, 51.30, 49.50, 51.20, 1500.0))
    return bars


def _wrong_direction():
    """Prev green, curr red — that's dark cloud cover, not piercing."""
    bars = _uptrend(15, 50.0, 60.0)
    t = _last_t(bars)
    # Long green
    bars.append(_bar(t, 60.00, 62.10, 59.90, 62.00, 1500.0))
    t += DT
    bars.append(_bar(t, 62.50, 62.60, 60.50, 60.50, 1500.0))
    return bars


def _weak_dcr_under_0_5():
    """Bar N is green piercing but closes WEAKLY (DCR <0.5) AND mid-range chop."""
    bars, t = [], T0
    for i in range(30):
        if i % 2 == 0:
            bars.append(_bar(t, 56.0, 57.0, 55.0, 56.5, 1500.0))
        else:
            bars.append(_bar(t, 56.5, 57.0, 55.5, 56.0, 1500.0))
        t += DT
    # Long red bar (body large, NOT at floor)
    bars.append(_bar(t, 56.50, 56.60, 55.40, 55.50, 1000.0))  # body 1.0, range 1.2 = 83%
    t += DT
    # midpoint 56.0. Open 55.35 (< prev_low 55.40) gap down.
    # close 56.10 (> midpoint 56.0, < prev_open 56.50)
    # range 55.30 → 56.95. DCR = (56.10-55.30)/(56.95-55.30) = 0.485 (weak)
    bars.append(_bar(t, 55.35, 56.95, 55.30, 56.10, 700.0))  # low vol
    return bars


def _low_volume():
    """Piercing pattern but volume only 0.4x — no conviction."""
    bars, t = [], T0
    for i in range(25):
        if i % 2 == 0:
            bars.append(_bar(t, 56.0, 57.0, 55.0, 56.5, 2500.0))
        else:
            bars.append(_bar(t, 56.5, 57.0, 55.5, 56.0, 2500.0))
        t += DT
    bars.append(_bar(t, 56.50, 56.60, 55.40, 55.50, 2500.0))
    t += DT
    bars.append(_bar(t, 55.35, 56.30, 55.30, 56.25, 600.0))
    return bars


# ============== EDGE ==============

def _boundary_penetration_50pct():
    """Penetration just above 50% — just qualifies."""
    bars = _downtrend(15, 60.0, 52.0)
    t = _last_t(bars)
    bars.append(_bar(t, 52.00, 52.10, 49.90, 50.00, 1500.0))  # midpoint 51.0
    t += DT
    # close at 51.10 (just above midpoint)
    bars.append(_bar(t, 49.50, 51.20, 49.50, 51.10, 1500.0))
    return bars


def _boundary_prev_body_40pct():
    """Prev body exactly at 40% of range — minimum long-bar threshold."""
    bars = _downtrend(15, 60.0, 52.0)
    t = _last_t(bars)
    # body 0.85, range 2.0 → 42.5%
    bars.append(_bar(t, 51.50, 51.60, 49.60, 50.65, 1500.0))  # midpoint 51.075
    t += DT
    # open 49.50 (< prev_low 49.60). close 51.20 (> midpoint 51.075, < prev_open 51.50).
    bars.append(_bar(t, 49.50, 51.30, 49.50, 51.20, 1500.0))
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
    "recent_dcr_avg": 0.25,
    "dcr_signature": "distribution",
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
    "recent_dcr_avg": 0.50,
    "dcr_signature": "neutral",
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
    "recent_dcr_avg": 0.70,
    "dcr_signature": "accumulation",
}


def _write(name, category, bars, context, expected):
    payload = {"name": name, "category": category, "expected": expected,
               "context": context, "bars": bars}
    path = os.path.join(_OUT_DIR, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {path} ({len(bars)} bars)")


def main():
    # 5 POSITIVE
    _write("clean_at_swing_low", "positive", _clean_at_swing_low(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("deep_penetration", "positive", _deep_penetration(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("high_volume_piercing", "positive", _high_volume_piercing(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("strong_dcr_close", "positive", _strong_dcr_close(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("after_decline_distribution_signature", "positive",
           _after_decline_distribution_signature(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    # 8 NEGATIVE
    _write("no_gap_down", "negative", _no_gap_down(), GOOD_CONTEXT, {"fires": False})
    _write("close_below_midpoint", "negative", _close_below_midpoint(), GOOD_CONTEXT, {"fires": False})
    _write("full_engulf_not_piercing", "negative", _full_engulf_not_piercing(), GOOD_CONTEXT, {"fires": False})
    _write("prev_bar_too_short", "negative", _prev_bar_too_short(), GOOD_CONTEXT, {"fires": False})
    _write("wrong_direction", "negative", _wrong_direction(), UPTREND_CONTEXT, {"fires": False})
    _write("weak_dcr_under_0_5", "negative", _weak_dcr_under_0_5(), NEUTRAL_CONTEXT, {"fires": False})
    _write("low_volume", "negative", _low_volume(), NEUTRAL_CONTEXT, {"fires": False})
    _write("short_series", "negative", _downtrend(4, 50.0, 48.0), NEUTRAL_CONTEXT, {"fires": False})

    # 2 EDGE
    _write("boundary_penetration_50pct", "edge", _boundary_penetration_50pct(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("boundary_prev_body_40pct", "edge", _boundary_prev_body_40pct(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    print("\nDone — 15 fixtures written.")


if __name__ == "__main__":
    main()
