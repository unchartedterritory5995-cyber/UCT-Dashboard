"""Bearish Engulfing fixture generator. 15 fixtures total.

Geometry: bar N-1 green, bar N red, curr.open >= prev.close, curr.close <= prev.open,
curr.body >= 1.2x prev.body.
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
    """15-bar uptrend, small green + large red engulfing."""
    bars = _uptrend(15, 50.0, 60.0)
    t = _last_t(bars)
    # Bar N-1: small green. body 0.35
    bars.append(_bar(t, 60.05, 60.45, 60.00, 60.40, 1000.0))
    t += DT
    # Bar N: red engulfing. open 60.45, close 59.85. body 0.60 (1.71x).
    # open >= prev_close (60.40), close <= prev_open (60.05).
    bars.append(_bar(t, 60.45, 60.50, 59.80, 59.85, 1600.0))
    return bars


def _large_engulfment_3x():
    """Massive 3x engulfment with low DCR (sellers held into close)."""
    bars = _uptrend(15, 50.0, 65.0)
    t = _last_t(bars)
    bars.append(_bar(t, 64.95, 65.30, 64.90, 65.25, 1100.0))  # green body 0.30
    t += DT
    # large red body 1.00 (3.3x). open 65.30, close 64.30, DCR ~0.04 (close at floor)
    bars.append(_bar(t, 65.30, 65.35, 64.25, 64.30, 2200.0))
    return bars


def _high_volume_distribution():
    """Volume on bar N is 2.5x prior — strong distribution signature."""
    bars = _uptrend(15, 50.0, 60.0, vol=1200.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.05, 60.45, 60.00, 60.40, 1200.0))
    t += DT
    bars.append(_bar(t, 60.45, 60.50, 59.80, 59.85, 3000.0))
    return bars


def _dcr_weak_close():
    """DCR on bar N at 0.05 — institutional close at low."""
    bars = _uptrend(15, 50.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.05, 60.45, 60.00, 60.40, 1100.0))
    t += DT
    # Range 59.30 → 60.50, close 59.32. DCR (59.32-59.30)/(60.50-59.30) = 0.0167
    # Body 60.50 - 59.32 = 1.18 (3.4x prev 0.35).
    bars.append(_bar(t, 60.50, 60.50, 59.30, 59.32, 1800.0))
    return bars


def _after_advance_accumulation_signature():
    """20-bar advance with strong closes (accumulation DCR) then bearish engulfing top."""
    bars, t = [], T0
    price = 50.0
    for i in range(20):
        o = price
        h = price + 1.20
        l = price - 0.30
        c = price + 1.10
        bars.append(_bar(t, o, h, l, c, 1500.0))
        price += 0.80
        t += DT
    # bar N-1 small green
    bars.append(_bar(t, 66.05, 66.45, 66.00, 66.40, 1500.0))
    t += DT
    # bar N red engulfing, weak close. body 1.18 (3.4x).
    bars.append(_bar(t, 66.50, 66.55, 65.30, 65.35, 2600.0))
    return bars


# ============== NEGATIVE ==============

def _no_engulfment():
    """Bar N red but doesn't engulf (close above prev_open)."""
    bars = _uptrend(15, 50.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.00, 60.55, 59.95, 60.45, 1000.0))  # green body 0.45
    t += DT
    # red bar that closes ABOVE prev_open (60.00)
    bars.append(_bar(t, 60.40, 60.50, 60.05, 60.10, 1200.0))
    return bars


def _partial_overlap():
    """Bar N red opens below prev_close — fails 'open >= prev_close' gate."""
    bars = _uptrend(15, 50.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.05, 60.45, 60.00, 60.40, 1000.0))  # green
    t += DT
    # opens BELOW prev_close (60.35 < 60.40)
    bars.append(_bar(t, 60.35, 60.45, 59.85, 59.90, 1500.0))
    return bars


def _wrong_direction_green_engulfs_red():
    """Bar N-1 red, bar N green engulfing — that's BULLISH engulfing, not bearish."""
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.30, 50.40, 49.85, 49.95, 1000.0))  # red
    t += DT
    bars.append(_bar(t, 49.90, 50.55, 49.85, 50.50, 1500.0))  # green engulfing
    return bars


def _prev_bar_too_large():
    """Bar N red but only 1.05x prev body — fails 1.2x minimum."""
    bars = _uptrend(15, 50.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 59.55, 60.45, 59.50, 60.40, 1000.0))  # green body 0.85
    t += DT
    bars.append(_bar(t, 60.40, 60.50, 59.50, 59.51, 1200.0))  # red body 0.89 (1.05x)
    return bars


def _in_downtrend_no_swing_high():
    """Bearish engulfing anatomy in middle of clean downtrend — weak DCR fails it."""
    bars = _downtrend(40, 65.0, 40.0)
    t = _last_t(bars)
    # tiny green consolidation bar
    bars.append(_bar(t, 40.30, 40.45, 40.25, 40.40, 800.0))
    t += DT
    # red engulfing but DCR ~0.6 (sellers fading) - geom strong, ctx low
    # range 40.20→40.85, close 40.50 → DCR (40.50-40.20)/(40.85-40.20) = 0.46
    # body 40.45-40.21 = 0.24, prev body 0.10. 2.4x.
    # Wait — need open >= prev_close (40.40). Open=40.45.
    bars.append(_bar(t, 40.45, 40.85, 40.20, 40.21, 700.0))  # weak close low vol
    return bars


def _strong_dcr_above_0_6():
    """Bar N is red engulfing but closes STRONGLY (DCR > 0.6) — sellers fading.

    Combined with mid-range chop and low volume, should not fire.
    """
    bars, t = [], T0
    for i in range(30):
        if i % 2 == 0:
            bars.append(_bar(t, 52.0, 53.0, 51.0, 52.5, 1500.0))
        else:
            bars.append(_bar(t, 52.5, 53.0, 51.5, 52.0, 1500.0))
        t += DT
    # bar N-1: small green, NOT at chop high
    bars.append(_bar(t, 52.05, 52.45, 52.00, 52.40, 1000.0))
    t += DT
    # red engulfing but DCR ~0.65 (sellers fading)
    # range 51.50 → 52.55, close 52.15. DCR = (52.15-51.50)/(52.55-51.50) = 0.619
    # body 52.55 - 52.15 = 0.40. Wait need close < open: open=52.55, close=52.15. body 0.40.
    # prev body 0.35. ratio 1.14x — fails gate.
    # Need ratio >= 1.2 so curr body >= 0.42. open=52.55, close=52.13. body 0.42.
    # range 51.50→52.55. DCR (52.13-51.50)/(52.55-51.50) = 0.60.
    bars.append(_bar(t, 52.55, 52.55, 51.50, 52.13, 700.0))
    return bars


def _low_volume():
    """Engulfing pattern but volume only 0.3x prior AND mid-range chop."""
    bars, t = [], T0
    for i in range(25):
        if i % 2 == 0:
            bars.append(_bar(t, 52.0, 53.0, 51.0, 52.5, 2500.0))
        else:
            bars.append(_bar(t, 52.5, 53.0, 51.5, 52.0, 2500.0))
        t += DT
    bars.append(_bar(t, 52.05, 52.45, 52.00, 52.40, 2500.0))
    t += DT
    bars.append(_bar(t, 52.45, 52.50, 51.85, 51.90, 600.0))
    return bars


def _very_small_engulfing_body():
    """Curr body only 1.15x prev — fails 1.2x minimum."""
    bars = _uptrend(15, 50.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.00, 60.50, 59.95, 60.40, 1000.0))  # green body 0.40
    t += DT
    bars.append(_bar(t, 60.41, 60.45, 59.90, 59.95, 1200.0))  # red body 0.46 (1.15x)
    return bars


# ============== EDGE ==============

def _boundary_engulfment_1_2x():
    """Bar N body just above 1.2x prior — minimum geometry pass."""
    bars = _uptrend(15, 50.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.00, 60.50, 59.95, 60.40, 1100.0))  # green body 0.40
    t += DT
    # red body 0.50 (1.25x). open >= prev_close (60.40), close <= prev_open (60.00).
    bars.append(_bar(t, 60.45, 60.50, 59.85, 59.95, 1300.0))
    return bars


def _boundary_dcr_0_45():
    """DCR right around 0.45 - boundary for moderate score."""
    bars = _uptrend(15, 50.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.05, 60.45, 60.00, 60.40, 1100.0))
    t += DT
    # range 59.30→60.55, close 59.86. DCR (59.86-59.30)/(60.55-59.30) = 0.448
    # body 60.45 - 59.86 = 0.59 (1.69x prev 0.35). open 60.45 >= 60.40. close 59.86 < 60.05.
    bars.append(_bar(t, 60.45, 60.55, 59.30, 59.86, 1400.0))
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
    _write("large_engulfment_3x", "positive", _large_engulfment_3x(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("high_volume_distribution", "positive", _high_volume_distribution(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("dcr_weak_close", "positive", _dcr_weak_close(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("after_advance_accumulation_signature", "positive",
           _after_advance_accumulation_signature(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    # 8 NEGATIVE
    _write("no_engulfment", "negative", _no_engulfment(), GOOD_CONTEXT, {"fires": False})
    _write("partial_overlap", "negative", _partial_overlap(), GOOD_CONTEXT, {"fires": False})
    _write("wrong_direction_green_engulfs_red", "negative",
           _wrong_direction_green_engulfs_red(), DOWNTREND_CONTEXT, {"fires": False})
    _write("prev_bar_too_large", "negative", _prev_bar_too_large(), GOOD_CONTEXT, {"fires": False})
    _write("in_downtrend_no_swing_high", "negative", _in_downtrend_no_swing_high(),
           DOWNTREND_CONTEXT, {"fires": False})
    _write("strong_dcr_above_0_6", "negative", _strong_dcr_above_0_6(),
           NEUTRAL_CONTEXT, {"fires": False})
    _write("low_volume", "negative", _low_volume(), NEUTRAL_CONTEXT, {"fires": False})
    _write("very_small_engulfing_body", "negative", _very_small_engulfing_body(),
           GOOD_CONTEXT, {"fires": False})

    # 2 EDGE
    _write("boundary_engulfment_1_2x", "edge", _boundary_engulfment_1_2x(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("boundary_dcr_0_45", "edge", _boundary_dcr_0_45(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    print("\nDone — 15 fixtures written.")


if __name__ == "__main__":
    main()
