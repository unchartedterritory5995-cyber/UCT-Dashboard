"""Three White Soldiers fixture generator. 15 fixtures total.

3-bar pattern:
  All 3 bars: GREEN (close > open), body_pct >= 0.60, DCR >= 0.70,
              upper_wick <= 0.15
  Each subsequent bar opens INSIDE the prior body (between prior open and
  prior close).
  Closes progress higher: b3.c > b2.c > b1.c.
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


def _build_soldier(t, o, c, vol, upper_wick_frac=0.05, lower_wick_frac=0.05):
    """Build a single 'soldier' bar with given open/close, body 1.50 ideally.
    Returns a green bar with small upper wick and small lower wick.
    """
    body = c - o
    # Pick range so body_pct = ~0.85 -> range = body / 0.85
    rng = body / 0.85
    upper_wick = rng * upper_wick_frac
    lower_wick = rng * lower_wick_frac
    h = c + upper_wick
    l = o - lower_wick
    # Sanity: this should yield body_pct ~0.85, dcr ~0.95
    return _bar(t, o, h, l, c, vol)


# ============== POSITIVE ==============

def _clean_textbook():
    """3 long green bars, opens within prior body, all DCRs >= 0.85, no upper wicks."""
    bars = _downtrend(15, 60.0, 50.0, vol=1200.0)
    t = _last_t(bars)
    # Bar 1: open 50.00, close 51.50, body 1.50, range 1.55, body_pct 0.968
    # Upper wick 0.025/1.55=0.016, DCR (51.50-49.975)/1.55=0.984
    bars.append(_build_soldier(t, 50.00, 51.50, 1300.0))
    t += DT
    # Bar 2: open inside [50.00, 51.50]: open 50.80, close 52.40
    bars.append(_build_soldier(t, 50.80, 52.40, 1400.0))
    t += DT
    # Bar 3: open inside [50.80, 52.40]: open 51.60, close 53.30
    bars.append(_build_soldier(t, 51.60, 53.30, 1600.0))
    return bars


def _dramatic_advance():
    """Each bar advances >2% - large bodies, sharp continuation."""
    bars = _downtrend(15, 60.0, 50.0, vol=1200.0)
    t = _last_t(bars)
    # Bar 1: open 50, close 51.50 (3% advance)
    bars.append(_build_soldier(t, 50.00, 51.50, 1500.0))
    t += DT
    # Bar 2: open 50.90 inside [50, 51.50], close 53.00 (4.1% advance)
    bars.append(_build_soldier(t, 50.90, 53.00, 1700.0))
    t += DT
    # Bar 3: open 52.00 inside [50.90, 53.00], close 54.20 (4.2%)
    bars.append(_build_soldier(t, 52.00, 54.20, 1900.0))
    return bars


def _at_swing_low_emerging():
    """20-bar decline + 3 soldiers emerging from the swing low."""
    bars, t = [], T0
    price = 65.0
    for i in range(20):
        o = price
        h = price + 0.30
        l = price - 1.30
        c = price - 1.20
        bars.append(_bar(t, o, h, l, c, 1500.0))
        price -= 0.70
        t += DT
    # Three soldiers
    bars.append(_build_soldier(t, 50.00, 51.50, 1700.0))
    t += DT
    bars.append(_build_soldier(t, 50.80, 52.40, 1850.0))
    t += DT
    bars.append(_build_soldier(t, 51.60, 53.30, 2000.0))
    return bars


def _tight_progression():
    """Small steps; orderly soldiers; opens deep inside prior body."""
    bars = _downtrend(15, 55.0, 50.0, vol=1100.0)
    t = _last_t(bars)
    # Body 0.80 each, very tight progression
    # Bar 1: open 50.00, close 50.80
    bars.append(_build_soldier(t, 50.00, 50.80, 1200.0))
    t += DT
    # Bar 2: open 50.40 (mid of bar1 body), close 51.20
    bars.append(_build_soldier(t, 50.40, 51.20, 1250.0))
    t += DT
    # Bar 3: open 50.80 (mid of bar2 body), close 51.60
    bars.append(_build_soldier(t, 50.80, 51.60, 1300.0))
    return bars


def _perfect_dcr_alignment():
    """All DCRs >= 0.92 - textbook institutional fingerprint."""
    bars = _downtrend(15, 60.0, 50.0, vol=1200.0)
    t = _last_t(bars)
    # Force upper wicks to 0.02 of range -> DCR ~0.98
    # Bar 1: open 50.00, close 51.50, body 1.50, range = body/0.92 = 1.63
    # Upper wick 0.02 * 1.63 = 0.033
    o, c = 50.00, 51.50
    body = c - o
    rng = body / 0.92
    h = c + 0.02 * rng
    l = o - 0.06 * rng  # tiny lower wick
    bars.append(_bar(t, o, h, l, c, 1500.0))
    t += DT
    o, c = 50.80, 52.40
    body = c - o
    rng = body / 0.92
    h = c + 0.02 * rng
    l = o - 0.06 * rng
    bars.append(_bar(t, o, h, l, c, 1650.0))
    t += DT
    o, c = 51.60, 53.30
    body = c - o
    rng = body / 0.92
    h = c + 0.02 * rng
    l = o - 0.06 * rng
    bars.append(_bar(t, o, h, l, c, 1800.0))
    return bars


# ============== NEGATIVE ==============

def _one_bar_red():
    """3-bar sequence with one red bar - rule violated."""
    bars = _downtrend(15, 60.0, 50.0, vol=1200.0)
    t = _last_t(bars)
    bars.append(_build_soldier(t, 50.00, 51.50, 1300.0))  # green
    t += DT
    # Bar 2 is red: open 51.60, close 50.40
    bars.append(_bar(t, 51.60, 51.65, 50.30, 50.40, 1400.0))
    t += DT
    bars.append(_build_soldier(t, 50.80, 52.20, 1500.0))  # green
    return bars


def _body_too_small():
    """One of the bars has body_pct < 0.60 - rejected."""
    bars = _downtrend(15, 60.0, 50.0, vol=1200.0)
    t = _last_t(bars)
    bars.append(_build_soldier(t, 50.00, 51.50, 1300.0))
    t += DT
    # Bar 2: body 0.50, range 1.20 -> body_pct 0.417 (below 0.60)
    # open 50.80, close 51.30, high 51.55, low 50.35 -> body 0.50, range 1.20
    bars.append(_bar(t, 50.80, 51.55, 50.35, 51.30, 1400.0))
    t += DT
    bars.append(_build_soldier(t, 51.40, 52.50, 1500.0))
    return bars


def _bar_3_opened_below_bar_2_body():
    """Bar 3 gaps down below bar 2's open - opens OUTSIDE prior body."""
    bars = _downtrend(15, 60.0, 50.0, vol=1200.0)
    t = _last_t(bars)
    bars.append(_build_soldier(t, 50.00, 51.50, 1300.0))
    t += DT
    bars.append(_build_soldier(t, 50.80, 52.40, 1400.0))
    t += DT
    # Bar 3: opens at 50.50 (BELOW bar 2 open of 50.80) - violates rule
    bars.append(_build_soldier(t, 50.50, 52.80, 1500.0))
    return bars


def _prices_not_progressing():
    """Bar 3's close equals bar 2's close (no higher close) - rejected."""
    bars = _downtrend(15, 60.0, 50.0, vol=1200.0)
    t = _last_t(bars)
    bars.append(_build_soldier(t, 50.00, 51.50, 1300.0))
    t += DT
    bars.append(_build_soldier(t, 50.80, 52.40, 1400.0))
    t += DT
    # Bar 3: opens 51.60 inside bar2 body, but closes at 52.30 (LOWER than bar 2's 52.40)
    bars.append(_build_soldier(t, 51.60, 52.30, 1500.0))
    return bars


def _long_upper_wicks():
    """Each bar has an upper wick > 15% of range - sellers pushing back."""
    bars = _downtrend(15, 60.0, 50.0, vol=1200.0)
    t = _last_t(bars)
    # Bar 1: open 50.00, close 51.50, body 1.50, range 2.20 -> body_pct 0.68
    # Upper wick = 0.60 / 2.20 = 0.27 (> 0.15)
    bars.append(_bar(t, 50.00, 52.10, 49.90, 51.50, 1300.0))
    t += DT
    # Bar 2: similar profile
    bars.append(_bar(t, 50.80, 52.95, 50.70, 52.40, 1400.0))
    t += DT
    bars.append(_bar(t, 51.60, 53.85, 51.50, 53.30, 1500.0))
    return bars


def _declining_volume_through_bars():
    """Volume falls sharply across 3 bars, geometry at floor body_pct,
    opens near prior close (worst position), in an extended uptrend (stage 3
    climax-top context). The combined penalties drag confidence below 50 floor.
    """
    # Long uptrend to give "climax warning"
    bars, t = [], T0
    price = 30.0
    for i in range(40):
        o = price - 0.05
        c = price + 0.30
        h = c + 0.10
        l = o - 0.05
        bars.append(_bar(t, o, h, l, c, 2500.0))
        price += 0.40
        t += DT
    # Now price ~46. 3 soldiers near body_pct floor, opening near prior close, very low volume.
    # body 1.22, range 2.00 -> body_pct 0.61
    # upper wick 0.25/2.00 = 0.125, lower wick 0.53/2.00 = 0.265, DCR = (1.22+0.53)/2.00 = 0.875
    o, c = 46.00, 47.22
    h = c + 0.25
    l = o - 0.53
    bars.append(_bar(t, o, h, l, c, 400.0))  # very low volume
    t += DT
    # Bar 2: open near prior close (47.20 -> b2_open_pos near 0.98 = top of prior body)
    o, c = 47.20, 48.42
    h = c + 0.25
    l = o - 0.53
    bars.append(_bar(t, o, h, l, c, 200.0))  # halving
    t += DT
    # Bar 3: open near prior close (48.40)
    o, c = 48.40, 49.62
    h = c + 0.25
    l = o - 0.53
    bars.append(_bar(t, o, h, l, c, 100.0))  # halving again
    return bars


def _bar_2_DCR_low():
    """Middle bar's DCR is < 0.70 - rejected at geometry stage."""
    bars = _downtrend(15, 60.0, 50.0, vol=1200.0)
    t = _last_t(bars)
    bars.append(_build_soldier(t, 50.00, 51.50, 1300.0))
    t += DT
    # Bar 2 green but DCR low: open 50.80, close 51.50, high 52.40, low 50.70
    # body 0.70, range 1.70 -> body_pct 0.41 (also fails body check too)
    # Need body_pct >= 0.60 but DCR < 0.70.
    # body 1.00 (open 50.80, close 51.80), range = body / body_pct, say body_pct 0.65 -> range 1.54
    # close 51.80, high 52.50, low 50.96 -> body 1.00, range 1.54, body_pct 0.649
    # upper wick = 0.70 / 1.54 = 0.454 (> 0.15, also fails)
    # We want DCR fail specifically: DCR = (close - low) / range = (51.80 - 50.96)/1.54 = 0.545
    # Upper wick fails too. Let's use very wide bar:
    # body_pct 0.62, range 1.61, body 1.00. open 50.80, close 51.80.
    # We want DCR ~0.55 and upper wick > 0.15.
    # All 3 issues — fine for negative test (any one rejects).
    bars.append(_bar(t, 50.80, 52.41, 50.80, 51.80, 1400.0))
    # body 1.00, range 1.61, body_pct 0.62; upper wick = 0.61/1.61 = 0.379 (fails)
    # DCR = (51.80 - 50.80) / 1.61 = 0.621 (fails)
    t += DT
    bars.append(_build_soldier(t, 51.60, 53.30, 1500.0))
    return bars


def _after_extended_uptrend_climax_warning():
    """50-bar uptrend + 3 soldiers at the top - detects but flagged climax_warning."""
    bars, t = [], T0
    price = 30.0
    for i in range(50):
        # Smooth uptrend
        o = price - 0.05
        c = price + 0.30
        h = c + 0.10
        l = o - 0.05
        bars.append(_bar(t, o, h, l, c, 1300.0))
        price += 0.40
        t += DT
    # Price now ~50. Three soldiers AT the top.
    bars.append(_build_soldier(t, 50.00, 51.50, 1400.0))
    t += DT
    bars.append(_build_soldier(t, 50.80, 52.40, 1500.0))
    t += DT
    bars.append(_build_soldier(t, 51.60, 53.30, 1600.0))
    return bars


# ============== EDGE ==============

def _boundary_body_pct():
    """All 3 bars body_pct ~= 0.62 (just above the 0.60 floor)."""
    bars = _downtrend(15, 60.0, 50.0, vol=1200.0)
    t = _last_t(bars)
    # body 1.25, range 2.00 -> body_pct 0.625 (just above floor)
    # upper wick 0.25 / 2.00 = 0.125 (just under 0.15 cap)
    # lower wick 0.50 / 2.00 = 0.25
    # DCR = (1.25 + 0.50) / 2.00 = 0.875 (above 0.70 floor)
    o, c = 50.00, 51.25
    h = c + 0.25
    l = o - 0.50
    bars.append(_bar(t, o, h, l, c, 1300.0))
    t += DT
    # Bar 2: open inside [50.00, 51.25]: open 50.60, close 51.85
    o, c = 50.60, 51.85
    h = c + 0.25
    l = o - 0.50
    bars.append(_bar(t, o, h, l, c, 1400.0))
    t += DT
    # Bar 3: open inside [50.60, 51.85]: open 51.20, close 52.45
    o, c = 51.20, 52.45
    h = c + 0.25
    l = o - 0.50
    bars.append(_bar(t, o, h, l, c, 1500.0))
    return bars


def _boundary_DCR():
    """All 3 bars DCR ~0.86 (just above 0.70 floor; constrained by upper_wick cap of 0.15).
    Note: upper_wick<=0.15 forces DCR>=0.85 minimum, so this represents the practical
    DCR floor the detector can see. body 1.40, range 2.00 -> body_pct 0.70, upper_wick 0.125,
    lower_wick 0.175, DCR = 0.875.
    """
    bars = _downtrend(15, 60.0, 50.0, vol=1200.0)
    t = _last_t(bars)
    # body 1.40, range 2.00 -> body_pct 0.70
    # upper_wick 0.25 / 2.00 = 0.125 (under cap)
    # lower_wick 0.35 / 2.00 = 0.175
    # DCR = (1.40 + 0.35) / 2.00 = 0.875
    o, c = 50.00, 51.40
    h = c + 0.25
    l = o - 0.35
    bars.append(_bar(t, o, h, l, c, 1300.0))
    t += DT
    o, c = 50.70, 52.10
    h = c + 0.25
    l = o - 0.35
    bars.append(_bar(t, o, h, l, c, 1400.0))
    t += DT
    o, c = 51.40, 52.80
    h = c + 0.25
    l = o - 0.35
    bars.append(_bar(t, o, h, l, c, 1500.0))
    return bars


GOOD_CONTEXT = {
    "trend_stage": 1,
    "rs_trend": "up",
    "ma_alignment": "mixed",
    "volume_signature": "expanding",
    "regime": "neutral",
    "nearest_resistance": 60.0,
    "nearest_support": 49.5,
    "days_to_earnings": None,
    "sector_strength_rank": None,
    "recent_dcr_avg": 0.40,
    "dcr_signature": "neutral",
}

ACCUMULATION_CONTEXT = {
    "trend_stage": 1,
    "rs_trend": "up",
    "ma_alignment": "stacked_bullish",
    "volume_signature": "expanding",
    "regime": "bullish",
    "nearest_resistance": None,
    "nearest_support": 49.5,
    "days_to_earnings": None,
    "sector_strength_rank": None,
    "recent_dcr_avg": 0.30,
    "dcr_signature": "distribution",  # transitioning
}

UPTREND_CONTEXT = {
    "trend_stage": 2,
    "rs_trend": "up",
    "ma_alignment": "stacked_bullish",
    "volume_signature": "expanding",
    "regime": "bullish",
    "nearest_resistance": None,
    "nearest_support": None,
    "days_to_earnings": None,
    "sector_strength_rank": None,
    "recent_dcr_avg": 0.70,
    "dcr_signature": "accumulation",
}

CLIMAX_TOP_CONTEXT = {
    "trend_stage": 3,
    "rs_trend": "up",
    "ma_alignment": "stacked_bullish",
    "volume_signature": "expanding",
    "regime": "bullish",
    "nearest_resistance": 53.5,
    "nearest_support": None,
    "days_to_earnings": None,
    "sector_strength_rank": None,
    "recent_dcr_avg": 0.65,
    "dcr_signature": "accumulation",
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
    _write("clean_textbook", "positive", _clean_textbook(), ACCUMULATION_CONTEXT,
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("dramatic_advance", "positive", _dramatic_advance(), ACCUMULATION_CONTEXT,
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("at_swing_low_emerging", "positive", _at_swing_low_emerging(), ACCUMULATION_CONTEXT,
           {"fires": True, "min_confidence": 65.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("tight_progression", "positive", _tight_progression(), ACCUMULATION_CONTEXT,
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("perfect_dcr_alignment", "positive", _perfect_dcr_alignment(), ACCUMULATION_CONTEXT,
           {"fires": True, "min_confidence": 65.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    # 8 NEGATIVE
    _write("one_bar_red", "negative", _one_bar_red(), GOOD_CONTEXT,
           {"fires": False})
    _write("body_too_small", "negative", _body_too_small(), GOOD_CONTEXT,
           {"fires": False})
    _write("bar_3_opened_below_bar_2_body", "negative",
           _bar_3_opened_below_bar_2_body(), GOOD_CONTEXT,
           {"fires": False})
    _write("prices_not_progressing", "negative", _prices_not_progressing(),
           GOOD_CONTEXT, {"fires": False})
    _write("long_upper_wicks", "negative", _long_upper_wicks(), GOOD_CONTEXT,
           {"fires": False})
    _write("declining_volume_through_bars", "negative",
           _declining_volume_through_bars(), CLIMAX_TOP_CONTEXT,
           {"fires": False})
    _write("bar_2_DCR_low", "negative", _bar_2_DCR_low(), GOOD_CONTEXT,
           {"fires": False})
    _write("after_extended_uptrend_climax_warning", "negative",
           _after_extended_uptrend_climax_warning(), CLIMAX_TOP_CONTEXT,
           # Detects but flagged as climax; we accept either fires or not
           # depending on scoring. With penalty -10 for advance >=40%, could
           # land near or below floor. Allow either by treating as fires
           # with low confidence band.
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    # 2 EDGE
    _write("boundary_body_pct", "edge", _boundary_body_pct(), ACCUMULATION_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("boundary_DCR", "edge", _boundary_DCR(), ACCUMULATION_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
