"""Bullish Engulfing fixture generator. 15 fixtures total.

Geometry: bar N-1 red, bar N green, curr.open <= prev.close, curr.close >= prev.open,
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


def _flat(n, price, vol=1000.0, t_start=T0):
    bars, t = [], t_start
    for _ in range(n):
        bars.append(_bar(t, price - 0.05, price + 0.10, price - 0.10, price + 0.05, vol))
        t += DT
    return bars


def _last_t(bars):
    return bars[-1]["t"] + DT


# ============== POSITIVE ==============

def _clean_at_swing_low():
    """15-bar downtrend, then small red bar + large green engulfing."""
    bars = _downtrend(15, 60.0, 50.0, vol=1000.0)
    t = _last_t(bars)
    # Bar N-1: small red. open 50.30, close 49.95, body 0.35
    bars.append(_bar(t, 50.30, 50.40, 49.85, 49.95, 1000.0))
    t += DT
    # Bar N: large green engulfing. open 49.90, close 50.50, body 0.60. DCR high.
    # body ratio 0.60/0.35 = 1.71x. close above prev_open (50.30). open below prev_close (49.95).
    bars.append(_bar(t, 49.90, 50.55, 49.85, 50.50, 1600.0))
    return bars


def _large_engulfment_3x():
    """Massive 3x engulfment with great DCR."""
    bars = _downtrend(15, 65.0, 50.0, vol=1000.0)
    t = _last_t(bars)
    # small red, body 0.30
    bars.append(_bar(t, 50.20, 50.30, 49.80, 49.90, 1100.0))
    t += DT
    # large green body 1.00 (3.3x). open 49.85, close 50.85. DCR ~96%.
    bars.append(_bar(t, 49.85, 50.90, 49.80, 50.85, 2200.0))
    return bars


def _high_volume_reversal():
    """Volume on bar N is 2.5x prior — strong reversal signature."""
    bars = _downtrend(15, 60.0, 50.0, vol=1200.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.30, 50.40, 49.80, 49.95, 1200.0))
    t += DT
    bars.append(_bar(t, 49.90, 50.55, 49.85, 50.50, 3000.0))  # 2.5x volume
    return bars


def _dcr_strong_close():
    """DCR on bar N at 0.95 — institutional close."""
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.35, 50.45, 49.85, 49.95, 1100.0))
    t += DT
    # Range 49.85->50.60, close 50.58 → DCR (50.58-49.85)/(50.60-49.85) = 0.973
    bars.append(_bar(t, 49.90, 50.60, 49.85, 50.58, 1800.0))
    return bars


def _after_decline_distribution_signature():
    """15-bar decline (distribution DCR) then bullish engulfing - the gold setup."""
    # Build a longer downtrend with weak closes (low DCR) so context = distribution
    bars, t = [], T0
    price = 70.0
    for i in range(20):
        # Each bar opens near mid, drops, closes at low. DCR ~0.05
        o = price
        h = price + 0.30
        l = price - 1.20
        c = price - 1.10
        bars.append(_bar(t, o, h, l, c, 1500.0))
        price -= 0.80
        t += DT
    # Now bar N-1 small red, bar N strong green engulfing
    bars.append(_bar(t, 53.30, 53.40, 52.90, 53.00, 1500.0))
    t += DT
    bars.append(_bar(t, 52.95, 53.85, 52.90, 53.80, 2600.0))  # large body, high DCR
    return bars


# ============== NEGATIVE ==============

def _no_engulfment():
    """Bar N green but doesn't engulf prior body (close below prev_open)."""
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.50, 50.60, 49.90, 50.00, 1000.0))  # red body 0.50
    t += DT
    # green bar that closes BELOW prev_open (50.50) - no engulfment
    bars.append(_bar(t, 50.05, 50.40, 50.00, 50.35, 1200.0))
    return bars


def _partial_overlap():
    """Bar N green opens above prev_close — fails 'open <= prev_close' gate."""
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.30, 50.40, 49.85, 49.95, 1000.0))  # red
    t += DT
    # bar N opens at 50.05 (ABOVE prev_close 49.95) - disqualifies
    bars.append(_bar(t, 50.05, 50.60, 50.00, 50.55, 1500.0))
    return bars


def _wrong_direction_red_engulfs_green():
    """Bar N-1 green, bar N red engulfing — that's BEARISH engulfing, not bullish."""
    bars = _uptrend(15, 50.0, 60.0)
    t = _last_t(bars)
    # green
    bars.append(_bar(t, 60.05, 60.45, 60.00, 60.40, 1000.0))
    t += DT
    # red engulfing green - bearish engulfing, NOT bullish
    bars.append(_bar(t, 60.50, 60.60, 59.85, 59.95, 1500.0))
    return bars


def _prev_bar_too_large():
    """Bar N green but only 1.05x prev body — fails 1.2x minimum."""
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    # large red body 0.80
    bars.append(_bar(t, 50.45, 50.50, 49.60, 49.65, 1000.0))
    t += DT
    # green body 0.84 (only 1.05x) - fails 1.2x gate
    bars.append(_bar(t, 49.60, 50.50, 49.55, 50.44, 1200.0))
    return bars


def _in_uptrend_no_swing_low():
    """Bullish engulfing anatomy mid-uptrend, weak DCR — geom not enough."""
    bars = _uptrend(40, 40.0, 65.0)
    t = _last_t(bars)
    # tiny red consolidation bar
    bars.append(_bar(t, 65.30, 65.35, 65.15, 65.20, 800.0))
    t += DT
    # green engulfing but with weak close (DCR ~0.4) — fading buyers
    # range 65.10 → 65.80, close 65.38. DCR = (65.38-65.10)/(65.80-65.10) = 0.40
    # body = 65.38 - 65.15 = 0.23, prev body = 0.10. ratio 2.3x ok.
    # open below prev_close (65.20), close above prev_open (65.30).
    bars.append(_bar(t, 65.15, 65.80, 65.10, 65.38, 700.0))  # also low volume
    return bars


def _weak_dcr_under_0_4():
    """Bar N is green engulfing but closes WEAKLY (DCR < 0.4) — fading buyers.

    Combined with mid-range chop (no swing low) and low volume, should not fire.
    """
    # 30-bar choppy sideways with the low NOT at the floor (no swing-low qualifier)
    bars, t = [], T0
    for i in range(30):
        # Tight chop between 51-53
        if i % 2 == 0:
            bars.append(_bar(t, 52.0, 53.0, 51.0, 52.5, 1500.0))
        else:
            bars.append(_bar(t, 52.5, 53.0, 51.5, 52.0, 1500.0))
        t += DT
    # bar N-1: small red, NOT at the floor
    bars.append(_bar(t, 52.30, 52.45, 51.90, 51.95, 1000.0))
    t += DT
    # Green engulfing but DCR ~0.30 (weak close, fading buyers). Big range, close low.
    # Range 51.85 → 53.50, close 52.34. DCR = (52.34-51.85)/(53.50-51.85) = 0.297
    # body 52.34 - 51.90 = 0.44, prev body 0.35. Ratio 1.26x.
    bars.append(_bar(t, 51.90, 53.50, 51.85, 52.34, 700.0))  # also low volume
    return bars


def _low_volume():
    """Engulfing pattern but volume only 0.3x prior AND in mid-range chop — no conviction.

    Avoid putting it at a swing low or after a decline so context doesn't rescue it.
    """
    # Choppy sideways environment, low NOT at the floor
    bars, t = [], T0
    for i in range(25):
        if i % 2 == 0:
            bars.append(_bar(t, 52.0, 53.0, 51.0, 52.5, 2500.0))
        else:
            bars.append(_bar(t, 52.5, 53.0, 51.5, 52.0, 2500.0))
        t += DT
    # bar N-1: small red, NOT at the chop floor
    bars.append(_bar(t, 52.30, 52.45, 51.85, 51.95, 2500.0))
    t += DT
    # green engulfing but only 600 vol (0.24x) — extreme volume contraction signals no conviction
    bars.append(_bar(t, 51.90, 52.55, 51.85, 52.50, 600.0))
    return bars


def _very_small_engulfing_body():
    """Curr body only 1.15x prev — fails 1.2x minimum."""
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.40, 50.50, 49.95, 50.00, 1000.0))  # red body 0.40
    t += DT
    # green body 0.46 (1.15x) - fails
    bars.append(_bar(t, 49.95, 50.50, 49.90, 50.41, 1200.0))
    return bars


# ============== EDGE ==============

def _boundary_engulfment_1_2x():
    """Bar N body just above 1.2x prior — boundary geometry pass.

    Use a tiny safety margin so floating-point arithmetic doesn't trip the gate.
    """
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.40, 50.50, 49.85, 50.00, 1100.0))  # red body 0.40
    t += DT
    # body 0.50 (1.25x). open below prev_close (50.00). close above prev_open (50.40).
    bars.append(_bar(t, 49.95, 50.55, 49.90, 50.45, 1300.0))
    return bars


def _boundary_dcr_0_55():
    """DCR right around 0.55 - boundary for moderate score."""
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.30, 50.40, 49.85, 49.95, 1100.0))  # red
    t += DT
    # engulf with DCR ~0.55: range 49.85->50.70, close 50.32. DCR = (50.32-49.85)/(50.70-49.85) = 0.553
    # body = 50.32 - 49.90 = 0.42 (1.2x prev_body 0.35 = 1.2x). close above prev_open (50.30).
    bars.append(_bar(t, 49.90, 50.70, 49.85, 50.32, 1400.0))
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
    _write("clean_at_swing_low", "positive", _clean_at_swing_low(),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("large_engulfment_3x", "positive", _large_engulfment_3x(),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("high_volume_reversal", "positive", _high_volume_reversal(),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("dcr_strong_close", "positive", _dcr_strong_close(),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("after_decline_distribution_signature", "positive",
           _after_decline_distribution_signature(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    # 8 NEGATIVE
    _write("no_engulfment", "negative", _no_engulfment(), GOOD_CONTEXT,
           {"fires": False})
    _write("partial_overlap", "negative", _partial_overlap(), GOOD_CONTEXT,
           {"fires": False})
    _write("wrong_direction_red_engulfs_green", "negative",
           _wrong_direction_red_engulfs_green(), UPTREND_CONTEXT, {"fires": False})
    _write("prev_bar_too_large", "negative", _prev_bar_too_large(), GOOD_CONTEXT,
           {"fires": False})
    _write("in_uptrend_no_swing_low", "negative", _in_uptrend_no_swing_low(),
           UPTREND_CONTEXT, {"fires": False})
    _write("weak_dcr_under_0_4", "negative", _weak_dcr_under_0_4(),
           NEUTRAL_CONTEXT, {"fires": False})
    _write("low_volume", "negative", _low_volume(), NEUTRAL_CONTEXT,
           {"fires": False})
    _write("very_small_engulfing_body", "negative", _very_small_engulfing_body(),
           GOOD_CONTEXT, {"fires": False})

    # 2 EDGE
    _write("boundary_engulfment_1_2x", "edge", _boundary_engulfment_1_2x(),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("boundary_dcr_0_55", "edge", _boundary_dcr_0_55(),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    print("\nDone — 15 fixtures written.")


if __name__ == "__main__":
    main()
