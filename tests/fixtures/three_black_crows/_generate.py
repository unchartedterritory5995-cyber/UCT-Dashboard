"""Three Black Crows fixture generator. 15 fixtures total.

3-bar pattern:
  All 3 bars: RED (close < open), body_pct >= 0.60, DCR <= 0.30,
              lower_wick <= 0.15
  Each subsequent bar opens INSIDE the prior body (between prior close and
  prior open - for red bars, top of body = open, bottom = close).
  Closes progress lower: b3.c < b2.c < b1.c.
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


def _flat(n, p, vol=1000.0, t_start=T0):
    bars, t = [], t_start
    for i in range(n):
        if i % 2 == 0:
            bars.append(_bar(t, p, p + 0.6, p - 0.4, p + 0.3, vol))
        else:
            bars.append(_bar(t, p + 0.3, p + 0.5, p - 0.5, p - 0.1, vol))
        t += DT
    return bars


def _last_t(bars):
    return bars[-1]["t"] + DT


def _build_crow(t, o, c, vol, lower_wick_frac=0.05, upper_wick_frac=0.05):
    """Build a single 'crow' bar with given open/close. Returns a red bar with
    small lower wick and small upper wick. body_pct ~0.85, DCR ~0.05.
    """
    body = o - c  # positive for red
    rng = body / 0.85
    lower_wick = rng * lower_wick_frac
    upper_wick = rng * upper_wick_frac
    h = o + upper_wick
    l = c - lower_wick
    return _bar(t, o, h, l, c, vol)


# ============== POSITIVE ==============

def _clean_textbook():
    """3 long red bars, opens within prior body, all DCRs <= 0.15, no lower wicks."""
    bars = _uptrend(15, 40.0, 50.0, vol=1200.0)
    t = _last_t(bars)
    # Bar 1: open 50.00, close 48.50, body 1.50
    bars.append(_build_crow(t, 50.00, 48.50, 1300.0))
    t += DT
    # Bar 2: open inside [48.50, 50.00] (red body runs from open top to close bottom):
    # open 49.20, close 47.70
    bars.append(_build_crow(t, 49.20, 47.70, 1400.0))
    t += DT
    # Bar 3: open inside [47.70, 49.20]: open 48.40, close 46.90
    bars.append(_build_crow(t, 48.40, 46.90, 1600.0))
    return bars


def _dramatic_decline():
    """Each bar declines >2% - large bodies, sharp continuation."""
    bars = _uptrend(15, 40.0, 50.0, vol=1200.0)
    t = _last_t(bars)
    # Bar 1: open 50, close 48.50 (3% decline)
    bars.append(_build_crow(t, 50.00, 48.50, 1500.0))
    t += DT
    # Bar 2: open 49.10 inside [48.50, 50.00], close 47.00 (4.3% decline)
    bars.append(_build_crow(t, 49.10, 47.00, 1700.0))
    t += DT
    # Bar 3: open 47.50 inside [47.00, 49.10], close 45.80 (3.6%)
    bars.append(_build_crow(t, 47.50, 45.80, 1900.0))
    return bars


def _at_swing_high_emerging():
    """20-bar advance + 3 crows rolling over from the swing high."""
    bars, t = [], T0
    price = 35.0
    for i in range(20):
        o = price
        l = price - 0.30
        h = price + 1.30
        c = price + 1.20
        bars.append(_bar(t, o, h, l, c, 1500.0))
        price += 0.70
        t += DT
    # Three crows at the top
    bars.append(_build_crow(t, 50.00, 48.50, 1700.0))
    t += DT
    bars.append(_build_crow(t, 49.20, 47.70, 1850.0))
    t += DT
    bars.append(_build_crow(t, 48.40, 46.90, 2000.0))
    return bars


def _tight_progression():
    """Small steps; orderly crows; opens deep inside prior body."""
    bars = _uptrend(15, 45.0, 50.0, vol=1100.0)
    t = _last_t(bars)
    # Bar 1: open 50.00, close 49.20 (body 0.80)
    bars.append(_build_crow(t, 50.00, 49.20, 1200.0))
    t += DT
    # Bar 2: open 49.60 (mid of bar1 body), close 48.80
    bars.append(_build_crow(t, 49.60, 48.80, 1250.0))
    t += DT
    # Bar 3: open 49.20 (mid of bar2 body), close 48.40
    bars.append(_build_crow(t, 49.20, 48.40, 1300.0))
    return bars


def _perfect_dcr_alignment():
    """All DCRs <= 0.08 - textbook institutional distribution fingerprint."""
    bars = _uptrend(15, 40.0, 50.0, vol=1200.0)
    t = _last_t(bars)
    # body_pct 0.92, lower_wick 0.02 of range -> DCR ~0.02
    # Bar 1: open 50.00, close 48.50, body 1.50, range = body/0.92 = 1.63
    # lower_wick = 0.02 * 1.63 = 0.033
    o, c = 50.00, 48.50
    body = o - c
    rng = body / 0.92
    l = c - 0.02 * rng
    h = o + 0.06 * rng  # tiny upper wick
    bars.append(_bar(t, o, h, l, c, 1500.0))
    t += DT
    o, c = 49.20, 47.70
    body = o - c
    rng = body / 0.92
    l = c - 0.02 * rng
    h = o + 0.06 * rng
    bars.append(_bar(t, o, h, l, c, 1650.0))
    t += DT
    o, c = 48.40, 46.90
    body = o - c
    rng = body / 0.92
    l = c - 0.02 * rng
    h = o + 0.06 * rng
    bars.append(_bar(t, o, h, l, c, 1800.0))
    return bars


# ============== NEGATIVE ==============

def _one_bar_green():
    """3-bar sequence with one green bar - rule violated."""
    bars = _uptrend(15, 40.0, 50.0, vol=1200.0)
    t = _last_t(bars)
    bars.append(_build_crow(t, 50.00, 48.50, 1300.0))  # red
    t += DT
    # Bar 2 is green: open 48.40, close 49.60
    bars.append(_bar(t, 48.40, 49.70, 48.30, 49.60, 1400.0))
    t += DT
    bars.append(_build_crow(t, 49.20, 47.80, 1500.0))  # red
    return bars


def _body_too_small():
    """One of the bars has body_pct < 0.60 - rejected."""
    bars = _uptrend(15, 40.0, 50.0, vol=1200.0)
    t = _last_t(bars)
    bars.append(_build_crow(t, 50.00, 48.50, 1300.0))
    t += DT
    # Bar 2: body 0.50, range 1.20 -> body_pct 0.417 (below 0.60)
    # open 49.20, close 48.70, high 49.35, low 48.15 -> body 0.50, range 1.20
    bars.append(_bar(t, 49.20, 49.35, 48.15, 48.70, 1400.0))
    t += DT
    bars.append(_build_crow(t, 48.60, 47.50, 1500.0))
    return bars


def _bar_3_opened_above_bar_2_body():
    """Bar 3 gaps up above bar 2's open - opens OUTSIDE prior body."""
    bars = _uptrend(15, 40.0, 50.0, vol=1200.0)
    t = _last_t(bars)
    bars.append(_build_crow(t, 50.00, 48.50, 1300.0))
    t += DT
    bars.append(_build_crow(t, 49.20, 47.70, 1400.0))
    t += DT
    # Bar 3: opens at 49.50 (ABOVE bar 2 open of 49.20) - violates rule
    bars.append(_build_crow(t, 49.50, 47.00, 1500.0))
    return bars


def _prices_not_progressing():
    """Bar 3's close equals or exceeds bar 2's close (no lower close) - rejected."""
    bars = _uptrend(15, 40.0, 50.0, vol=1200.0)
    t = _last_t(bars)
    bars.append(_build_crow(t, 50.00, 48.50, 1300.0))
    t += DT
    bars.append(_build_crow(t, 49.20, 47.70, 1400.0))
    t += DT
    # Bar 3: opens 48.40 inside bar2 body, but closes at 47.80 (HIGHER than bar 2's 47.70)
    bars.append(_build_crow(t, 48.40, 47.80, 1500.0))
    return bars


def _long_lower_wicks():
    """Each bar has a lower wick > 15% of range - buyers defending."""
    bars = _uptrend(15, 40.0, 50.0, vol=1200.0)
    t = _last_t(bars)
    # Bar 1: open 50.00, close 48.50, body 1.50, range 2.20 -> body_pct 0.68
    # Lower wick = 0.60 / 2.20 = 0.27 (> 0.15)
    bars.append(_bar(t, 50.00, 50.10, 47.90, 48.50, 1300.0))
    t += DT
    bars.append(_bar(t, 49.20, 49.30, 47.05, 47.70, 1400.0))
    t += DT
    bars.append(_bar(t, 48.40, 48.50, 46.20, 46.90, 1500.0))
    return bars


def _declining_volume_through_bars():
    """Volume falls hard across 3 bars in a STEEP climax-bottom context, with body
    at floor and worst-position open. Combined penalties drag confidence below 50.
    """
    # 30-bar STEEP decline (climax-bottom context: -10 penalty)
    bars, t = [], T0
    price = 100.0
    for i in range(30):
        o = price + 0.05
        c = price - 1.50
        h = o + 0.05
        l = c - 0.05
        bars.append(_bar(t, o, h, l, c, 2500.0))
        price -= 1.80
        t += DT
    # Now price ~46. 3 crows at boundary body_pct AND boundary DCR with low volume
    # body 1.25, range 2.10 -> body_pct 0.595? Need >= 0.60. Use 1.27/2.10 = 0.605
    # lower_wick 0.15/2.10 = 0.071 (under 0.15 cap)
    # upper_wick 0.68/2.10 = 0.324 (no cap on upper wick for crows, so OK)
    # DCR = lower_wick / range = 0.071
    # Hmm, DCR very low (strong bearish). Try DCR closer to 0.30 floor:
    # DCR = 0.14 needs lower_wick = 0.14 * range
    # body_pct 0.62, range 2.00, body 1.24, lower_wick 0.28, upper_wick 0.48
    # But lower_wick 0.28 > 0.15 cap → fails!
    # So lower_wick must <= 0.15 of range, which forces DCR <= 0.15.
    # Cannot make DCR weak. Body_pct must do the heavy lifting.
    # Use body_pct = 0.605 (right at floor), DCR ~0.06 (default low).
    body = 1.21
    rng = body / 0.605  # = 2.0
    lower_wick = rng * 0.06  # 0.12
    upper_wick = rng - body - lower_wick  # 0.67
    o = 46.00
    c = o - body
    h = o + upper_wick
    l = c - lower_wick
    bars.append(_bar(t, o, h, l, c, 400.0))
    t += DT
    o = 44.80  # near prior close
    c = o - body
    h = o + upper_wick
    l = c - lower_wick
    bars.append(_bar(t, o, h, l, c, 200.0))
    t += DT
    o = 43.60
    c = o - body
    h = o + upper_wick
    l = c - lower_wick
    bars.append(_bar(t, o, h, l, c, 100.0))
    return bars


def _bar_2_DCR_high():
    """Middle bar's DCR is > 0.30 - rejected at geometry stage."""
    bars = _uptrend(15, 40.0, 50.0, vol=1200.0)
    t = _last_t(bars)
    bars.append(_build_crow(t, 50.00, 48.50, 1300.0))
    t += DT
    # Bar 2: red but DCR high (long lower wick - close pulled away from low)
    # body 1.00, range 1.61, body_pct 0.62; lower wick > 0.30 (FAILS lower_wick check)
    # AND DCR > 0.30 too (fails). Either way, rejected.
    bars.append(_bar(t, 49.20, 49.20, 47.59, 48.20, 1400.0))
    t += DT
    bars.append(_build_crow(t, 48.40, 46.90, 1500.0))
    return bars


def _after_extended_downtrend_climax_warning():
    """50-bar downtrend + 3 crows at the bottom - detects but flagged as climax_warning."""
    bars, t = [], T0
    price = 70.0
    for i in range(50):
        # Smooth downtrend
        o = price + 0.05
        c = price - 0.30
        h = o + 0.10
        l = c - 0.05
        bars.append(_bar(t, o, h, l, c, 1300.0))
        price -= 0.40
        t += DT
    # Price now ~50. Three crows AT the bottom.
    bars.append(_build_crow(t, 50.00, 48.50, 1400.0))
    t += DT
    bars.append(_build_crow(t, 49.20, 47.70, 1500.0))
    t += DT
    bars.append(_build_crow(t, 48.40, 46.90, 1600.0))
    return bars


# ============== EDGE ==============

def _boundary_body_pct():
    """All 3 bars body_pct ~= 0.625 (just above the 0.60 floor)."""
    bars = _uptrend(15, 40.0, 50.0, vol=1200.0)
    t = _last_t(bars)
    # body 1.25, range 2.00 -> body_pct 0.625
    # lower wick 0.25 / 2.00 = 0.125 (under 0.15 cap)
    # upper wick 0.50 / 2.00 = 0.25
    # DCR = lower_wick / range = 0.125 (well under 0.30)
    o, c = 50.00, 48.75
    h = o + 0.50
    l = c - 0.25
    bars.append(_bar(t, o, h, l, c, 1300.0))
    t += DT
    # Bar 2: open inside [48.75, 50.00]: open 49.40, close 48.15
    o, c = 49.40, 48.15
    h = o + 0.50
    l = c - 0.25
    bars.append(_bar(t, o, h, l, c, 1400.0))
    t += DT
    # Bar 3: open inside [48.15, 49.40]: open 48.80, close 47.55
    o, c = 48.80, 47.55
    h = o + 0.50
    l = c - 0.25
    bars.append(_bar(t, o, h, l, c, 1500.0))
    return bars


def _boundary_DCR():
    """All 3 bars DCR ~0.125 (just under 0.30 floor; constrained by lower_wick cap of 0.15).
    body 1.40, range 2.00 -> body_pct 0.70, lower_wick 0.125, upper_wick 0.175.
    DCR = 0.25 / 2.00 = 0.125.
    """
    bars = _uptrend(15, 40.0, 50.0, vol=1200.0)
    t = _last_t(bars)
    o, c = 50.00, 48.60
    h = o + 0.35
    l = c - 0.25
    bars.append(_bar(t, o, h, l, c, 1300.0))
    t += DT
    o, c = 49.30, 47.90
    h = o + 0.35
    l = c - 0.25
    bars.append(_bar(t, o, h, l, c, 1400.0))
    t += DT
    o, c = 48.60, 47.20
    h = o + 0.35
    l = c - 0.25
    bars.append(_bar(t, o, h, l, c, 1500.0))
    return bars


GOOD_CONTEXT = {
    "trend_stage": 3,
    "rs_trend": "down",
    "ma_alignment": "mixed",
    "volume_signature": "expanding",
    "regime": "neutral",
    "nearest_resistance": 50.5,
    "nearest_support": 40.0,
    "days_to_earnings": None,
    "sector_strength_rank": None,
    "recent_dcr_avg": 0.60,
    "dcr_signature": "neutral",
}

DISTRIBUTION_CONTEXT = {
    "trend_stage": 3,
    "rs_trend": "down",
    "ma_alignment": "stacked_bearish",
    "volume_signature": "expanding",
    "regime": "bearish",
    "nearest_resistance": 50.5,
    "nearest_support": 40.0,
    "days_to_earnings": None,
    "sector_strength_rank": None,
    "recent_dcr_avg": 0.70,  # was accumulation, now flipping to distribution
    "dcr_signature": "accumulation",  # transitioning down
}

DOWNTREND_CONTEXT = {
    "trend_stage": 4,
    "rs_trend": "down",
    "ma_alignment": "stacked_bearish",
    "volume_signature": "expanding",
    "regime": "bearish",
    "nearest_resistance": None,
    "nearest_support": None,
    "days_to_earnings": None,
    "sector_strength_rank": None,
    "recent_dcr_avg": 0.30,
    "dcr_signature": "distribution",
}

CLIMAX_BOTTOM_CONTEXT = {
    "trend_stage": 4,
    "rs_trend": "down",
    "ma_alignment": "stacked_bearish",
    "volume_signature": "expanding",
    "regime": "bearish",
    "nearest_resistance": None,
    "nearest_support": 46.5,
    "days_to_earnings": None,
    "sector_strength_rank": None,
    "recent_dcr_avg": 0.35,
    "dcr_signature": "distribution",
}

CHOP_CONTEXT = {
    "trend_stage": 0,
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


def _write(name, category, bars, context, expected):
    payload = {"name": name, "category": category, "expected": expected,
               "context": context, "bars": bars}
    path = os.path.join(_OUT_DIR, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {path} ({len(bars)} bars)")


def main():
    # 5 POSITIVE
    _write("clean_textbook", "positive", _clean_textbook(), DISTRIBUTION_CONTEXT,
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("dramatic_decline", "positive", _dramatic_decline(), DISTRIBUTION_CONTEXT,
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("at_swing_high_emerging", "positive", _at_swing_high_emerging(),
           DISTRIBUTION_CONTEXT,
           {"fires": True, "min_confidence": 65.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("tight_progression", "positive", _tight_progression(), DISTRIBUTION_CONTEXT,
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("perfect_dcr_alignment", "positive", _perfect_dcr_alignment(),
           DISTRIBUTION_CONTEXT,
           {"fires": True, "min_confidence": 65.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    # 8 NEGATIVE
    _write("one_bar_green", "negative", _one_bar_green(), GOOD_CONTEXT,
           {"fires": False})
    _write("body_too_small", "negative", _body_too_small(), GOOD_CONTEXT,
           {"fires": False})
    _write("bar_3_opened_above_bar_2_body", "negative",
           _bar_3_opened_above_bar_2_body(), GOOD_CONTEXT,
           {"fires": False})
    _write("prices_not_progressing", "negative", _prices_not_progressing(),
           GOOD_CONTEXT, {"fires": False})
    _write("long_lower_wicks", "negative", _long_lower_wicks(), GOOD_CONTEXT,
           {"fires": False})
    _write("declining_volume_through_bars", "negative",
           _declining_volume_through_bars(), CHOP_CONTEXT,
           {"fires": False})
    _write("bar_2_DCR_high", "negative", _bar_2_DCR_high(), GOOD_CONTEXT,
           {"fires": False})
    _write("after_extended_downtrend_climax_warning", "negative",
           _after_extended_downtrend_climax_warning(), CLIMAX_BOTTOM_CONTEXT,
           # Detects but flagged as climax; allows fires=True with low confidence
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    # 2 EDGE
    _write("boundary_body_pct", "edge", _boundary_body_pct(), DISTRIBUTION_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("boundary_DCR", "edge", _boundary_DCR(), DISTRIBUTION_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
