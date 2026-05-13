"""Dark Cloud Cover fixture generator. 15 fixtures total.

Geometry: prev green long-body, curr red, curr.open > prev.high (gap up),
curr.close < midpoint, curr.close > prev.open (not full engulf).
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

def _clean_at_swing_high():
    """Long green bar then red dark cloud.

    prev: open 50.0, close 52.0, body 2.0, range 49.9->52.1, body 91%.
    midpoint = 51.0
    curr: open 52.5 (above prev_high 52.1), close 50.5 (below midpoint 51.0, above prev_open 50.0).
    """
    bars = _uptrend(15, 40.0, 50.0)
    t = _last_t(bars)
    # Long green
    bars.append(_bar(t, 50.00, 52.10, 49.90, 52.00, 1500.0))
    t += DT
    # Gap-up red dark cloud
    bars.append(_bar(t, 52.50, 52.50, 50.40, 50.50, 2000.0))
    return bars


def _deep_penetration():
    """Penetration close to 90% — curr close near prev_open."""
    bars = _uptrend(15, 40.0, 50.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.00, 52.10, 49.90, 52.00, 1500.0))
    t += DT
    # midpoint 51.0, prev_open 50.0. close 50.15 = ~85% penetration down
    bars.append(_bar(t, 52.50, 52.55, 50.10, 50.15, 2200.0))
    return bars


def _high_volume_distribution():
    """Volume 2.5x prior — strong distribution signature."""
    bars = _uptrend(15, 40.0, 50.0, vol=1200.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.00, 52.10, 49.90, 52.00, 1500.0))
    t += DT
    bars.append(_bar(t, 52.50, 52.50, 50.40, 50.50, 3800.0))
    return bars


def _weak_dcr_close():
    """DCR ~0.05 — close near bottom of range."""
    bars = _uptrend(15, 40.0, 50.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.00, 52.10, 49.90, 52.00, 1500.0))
    t += DT
    # range 50.30 → 52.70, close 50.35. DCR (50.35-50.30)/(52.70-50.30) = 0.021
    # close 50.35 < midpoint 51.0, > prev_open 50.0. open 52.60 > prev_high 52.10.
    bars.append(_bar(t, 52.60, 52.70, 50.30, 50.35, 2100.0))
    return bars


def _after_advance_accumulation_signature():
    """Long advance with strong closes then dark cloud."""
    bars, t = [], T0
    price = 32.0
    for i in range(20):
        # strong closes → accumulation signature
        o = price
        h = price + 1.50
        l = price - 0.30
        c = price + 1.30
        bars.append(_bar(t, o, h, l, c, 1500.0))
        price += 1.00
        t += DT
    # Long green
    bars.append(_bar(t, 50.00, 52.10, 49.90, 52.00, 1500.0))
    t += DT
    # Dark cloud
    bars.append(_bar(t, 52.50, 52.50, 50.40, 50.50, 2500.0))
    return bars


# ============== NEGATIVE ==============

def _no_gap_up():
    """Curr opens at/below prev_high — fails gap-up gate."""
    bars = _uptrend(15, 40.0, 50.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.00, 52.10, 49.90, 52.00, 1500.0))
    t += DT
    # opens at 52.05 (<= prev_high 52.10)
    bars.append(_bar(t, 52.05, 52.15, 50.40, 50.50, 1500.0))
    return bars


def _close_above_midpoint():
    """Curr closes above midpoint — fails < midpoint gate."""
    bars = _uptrend(15, 40.0, 50.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.00, 52.10, 49.90, 52.00, 1500.0))  # midpoint 51.0
    t += DT
    # closes at 51.20 (above midpoint)
    bars.append(_bar(t, 52.50, 52.55, 51.15, 51.20, 1500.0))
    return bars


def _full_engulf_not_dark_cloud():
    """Curr closes below prev_open — this is full bearish engulfing, not dark cloud."""
    bars = _uptrend(15, 40.0, 50.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.00, 52.10, 49.90, 52.00, 1500.0))
    t += DT
    # closes at 49.80 (below prev_open 50.0) - bearish engulfing
    bars.append(_bar(t, 52.50, 52.55, 49.75, 49.80, 1500.0))
    return bars


def _prev_bar_too_short():
    """Prev body < 40% of range — fails long-bar gate."""
    bars = _uptrend(15, 40.0, 50.0)
    t = _last_t(bars)
    # body 0.40, range 2.0 → 20%
    bars.append(_bar(t, 50.60, 52.00, 50.00, 51.00, 1500.0))
    t += DT
    bars.append(_bar(t, 52.50, 52.55, 50.65, 50.70, 1500.0))
    return bars


def _wrong_direction():
    """Prev red, curr green — that's piercing, not dark cloud."""
    bars = _downtrend(15, 60.0, 52.0)
    t = _last_t(bars)
    bars.append(_bar(t, 52.00, 52.10, 49.90, 50.00, 1500.0))
    t += DT
    bars.append(_bar(t, 49.50, 51.60, 49.50, 51.50, 1500.0))
    return bars


def _strong_dcr_above_0_5():
    """Bar N red dark cloud but closes STRONGLY (DCR > 0.5) AND mid-range chop."""
    bars, t = [], T0
    for i in range(30):
        if i % 2 == 0:
            bars.append(_bar(t, 56.0, 57.0, 55.0, 56.5, 1500.0))
        else:
            bars.append(_bar(t, 56.5, 57.0, 55.5, 56.0, 1500.0))
        t += DT
    # Long green bar (body large, NOT at peak)
    bars.append(_bar(t, 55.50, 56.60, 55.40, 56.50, 1000.0))  # body 1.0, range 1.2 = 83%
    t += DT
    # midpoint 56.0. open 56.65 (> prev_high 56.60) gap up.
    # close 55.95 (< midpoint 56.0, > prev_open 55.50). DCR ~0.5.
    # range 55.35 → 56.70. DCR = (55.95-55.35)/(56.70-55.35) = 0.444
    # body 56.65 - 55.95 = 0.70.
    bars.append(_bar(t, 56.65, 56.70, 55.35, 55.95, 700.0))  # low vol
    return bars


def _low_volume():
    """Dark cloud but volume only 0.3x — no conviction."""
    bars, t = [], T0
    for i in range(25):
        if i % 2 == 0:
            bars.append(_bar(t, 56.0, 57.0, 55.0, 56.5, 2500.0))
        else:
            bars.append(_bar(t, 56.5, 57.0, 55.5, 56.0, 2500.0))
        t += DT
    bars.append(_bar(t, 55.50, 56.60, 55.40, 56.50, 2500.0))
    t += DT
    bars.append(_bar(t, 56.65, 56.70, 55.65, 55.70, 600.0))
    return bars


# ============== EDGE ==============

def _boundary_penetration_50pct():
    """Penetration just above 50% — just qualifies."""
    bars = _uptrend(15, 40.0, 50.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.00, 52.10, 49.90, 52.00, 1500.0))  # midpoint 51.0
    t += DT
    # close at 50.85 (just below midpoint), open 52.50 (gap)
    bars.append(_bar(t, 52.50, 52.55, 50.80, 50.85, 1500.0))
    return bars


def _boundary_prev_body_40pct():
    """Prev body just at 40% of range — minimum long-bar threshold."""
    bars = _uptrend(15, 40.0, 50.0)
    t = _last_t(bars)
    # body 0.85, range 2.0 → 42.5%
    bars.append(_bar(t, 50.35, 52.00, 50.00, 51.20, 1500.0))  # midpoint 50.775
    t += DT
    # open 52.50 (> prev_high 52.00). close 50.50 (< midpoint 50.775, > prev_open 50.35).
    bars.append(_bar(t, 52.50, 52.55, 50.45, 50.50, 1500.0))
    return bars


GOOD_CONTEXT = {
    "trend_stage": 2,
    "rs_trend": "up",
    "ma_alignment": "stacked_bullish",
    "volume_signature": "neutral",
    "regime": "bullish",
    "nearest_resistance": 60.0,
    "nearest_support": 50.0,
    "days_to_earnings": None,
    "sector_strength_rank": None,
    "recent_dcr_avg": 0.75,
    "dcr_signature": "accumulation",
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

DOWNTREND_CONTEXT = {
    "trend_stage": 4,
    "rs_trend": "down",
    "ma_alignment": "stacked_bearish",
    "volume_signature": "neutral",
    "regime": "bearish",
    "nearest_resistance": None,
    "nearest_support": None,
    "days_to_earnings": None,
    "sector_strength_rank": None,
    "recent_dcr_avg": 0.30,
    "dcr_signature": "distribution",
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
    _write("clean_at_swing_high", "positive", _clean_at_swing_high(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("deep_penetration", "positive", _deep_penetration(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("high_volume_distribution", "positive", _high_volume_distribution(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("weak_dcr_close", "positive", _weak_dcr_close(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("after_advance_accumulation_signature", "positive",
           _after_advance_accumulation_signature(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    # 8 NEGATIVE
    _write("no_gap_up", "negative", _no_gap_up(), GOOD_CONTEXT, {"fires": False})
    _write("close_above_midpoint", "negative", _close_above_midpoint(), GOOD_CONTEXT, {"fires": False})
    _write("full_engulf_not_dark_cloud", "negative", _full_engulf_not_dark_cloud(), GOOD_CONTEXT, {"fires": False})
    _write("prev_bar_too_short", "negative", _prev_bar_too_short(), GOOD_CONTEXT, {"fires": False})
    _write("wrong_direction", "negative", _wrong_direction(), DOWNTREND_CONTEXT, {"fires": False})
    _write("strong_dcr_above_0_5", "negative", _strong_dcr_above_0_5(), NEUTRAL_CONTEXT, {"fires": False})
    _write("low_volume", "negative", _low_volume(), NEUTRAL_CONTEXT, {"fires": False})
    _write("short_series", "negative", _uptrend(4, 50.0, 52.0), NEUTRAL_CONTEXT, {"fires": False})

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
