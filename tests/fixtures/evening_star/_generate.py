"""Evening Star fixture generator. 15 fixtures total.

3-bar pattern (bearish):
  Bar 1 (N-2): LONG GREEN (body_pct >= 0.40)
  Bar 2 (N-1): small body (<= 30% of bar 1 body) - the "star"
  Bar 3 (N):   LONG RED (body_pct >= 0.40), close below bar 1's midpoint
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

def _clean_textbook():
    """15-bar uptrend, LONG GREEN, gap-up star, LONG RED closing below midpoint."""
    bars = _uptrend(15, 50.0, 60.0, vol=1500.0)
    t = _last_t(bars)
    # Bar 1: LONG GREEN. open 60.00, close 61.50, body 1.50, range 1.55
    bars.append(_bar(t, 60.00, 61.50, 59.95, 61.50, 1800.0))
    t += DT
    # Bar 2: star (gapped up). open 61.70, close 61.80 - tiny body 0.10. body_ratio 0.067
    bars.append(_bar(t, 61.70, 61.90, 61.60, 61.80, 700.0))
    t += DT
    # Bar 3: LONG RED. midpoint of bar 1 = (60.00+61.50)/2 = 60.75
    # open 61.70, close 60.50 - body 1.20, range 61.75-60.45 = 1.30 -> body_pct 0.923
    bars.append(_bar(t, 61.70, 61.75, 60.45, 60.50, 2200.0))
    return bars


def _dramatic_engulfment():
    """Bar 3 closes near bar 1's open - near-complete reversal."""
    bars = _uptrend(15, 50.0, 60.0, vol=1500.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.00, 61.50, 59.95, 61.50, 1800.0))
    t += DT
    bars.append(_bar(t, 61.65, 61.85, 61.55, 61.70, 600.0))
    t += DT
    # Closes at 60.10 (just above bar 1 open of 60.00). MP penetration ~87%
    bars.append(_bar(t, 61.65, 61.70, 60.00, 60.10, 2400.0))
    return bars


def _doji_middle():
    """Middle bar is a true doji."""
    bars = _uptrend(15, 50.0, 60.0, vol=1500.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.00, 61.50, 59.95, 61.50, 1800.0))
    t += DT
    bars.append(_bar(t, 61.70, 61.85, 61.65, 61.71, 700.0))  # body 0.01
    t += DT
    bars.append(_bar(t, 61.70, 61.75, 60.45, 60.50, 2200.0))
    return bars


def _weak_dcr_close():
    """Bar 3 DCR ~0.05 - institutional distribution signature."""
    bars = _uptrend(15, 50.0, 60.0, vol=1500.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.00, 61.50, 59.95, 61.50, 1800.0))
    t += DT
    bars.append(_bar(t, 61.70, 61.85, 61.55, 61.70, 700.0))
    t += DT
    # Bar 3: range 60.40->61.75, close 60.42 -> DCR (60.42-60.40)/(61.75-60.40) = 0.015
    bars.append(_bar(t, 61.70, 61.75, 60.40, 60.42, 2200.0))
    return bars


def _perfect_context_alignment():
    """20-bar strong-close accumulation advance + clean evening star."""
    bars, t = [], T0
    price = 45.0
    for i in range(20):
        o = price
        h = price + 1.30
        l = price - 0.30
        c = price + 1.20
        bars.append(_bar(t, o, h, l, c, 1500.0))
        price += 0.85
        t += DT
    bars.append(_bar(t, 60.00, 61.50, 59.95, 61.50, 1800.0))
    t += DT
    bars.append(_bar(t, 61.70, 61.85, 61.55, 61.70, 700.0))
    t += DT
    bars.append(_bar(t, 61.70, 61.75, 60.45, 60.50, 2200.0))
    return bars


# ============== NEGATIVE ==============

def _no_pattern_continuation():
    """Continues higher - no evening star."""
    bars = _uptrend(15, 50.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.00, 61.55, 59.95, 61.50, 1500.0))  # LONG GREEN
    t += DT
    bars.append(_bar(t, 61.55, 63.00, 61.50, 62.95, 1700.0))  # continued up, not star
    t += DT
    bars.append(_bar(t, 62.95, 64.50, 62.90, 64.45, 1600.0))
    return bars


def _wrong_bar_count_green_green_red():
    """Bar 1 green, bar 2 green (too large for star), bar 3 red."""
    bars = _uptrend(15, 50.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.00, 61.55, 59.95, 61.50, 1500.0))  # body 1.50
    t += DT
    bars.append(_bar(t, 61.50, 63.00, 61.45, 62.90, 1700.0))  # body 1.40 - too big for star
    t += DT
    bars.append(_bar(t, 62.90, 62.95, 61.50, 61.55, 1500.0))
    return bars


def _star_body_too_big():
    """Star body is 40% of bar 1 body - fails 30% max."""
    bars = _uptrend(15, 50.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.00, 61.55, 59.95, 61.50, 1500.0))  # body 1.50
    t += DT
    bars.append(_bar(t, 61.55, 62.20, 61.50, 62.20, 1000.0))  # body 0.65 (43%) - too big
    t += DT
    bars.append(_bar(t, 62.20, 62.25, 60.50, 60.55, 1500.0))
    return bars


def _wrong_direction_morning_star():
    """3-bar morning-star structure - should NOT fire as evening star."""
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.50, 50.55, 49.00, 49.00, 1500.0))  # LONG RED
    t += DT
    bars.append(_bar(t, 48.85, 48.95, 48.70, 48.80, 700.0))   # star
    t += DT
    bars.append(_bar(t, 48.85, 50.10, 48.80, 50.00, 1500.0))  # LONG GREEN
    return bars


def _midpoint_not_penetrated():
    """Bar 3 red closes ABOVE bar 1 midpoint - fails the half-reversal rule."""
    bars = _uptrend(15, 50.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.00, 61.55, 59.95, 61.50, 1500.0))  # mid = 60.75
    t += DT
    bars.append(_bar(t, 61.70, 61.85, 61.55, 61.70, 700.0))
    t += DT
    # Bar 3 red but closes at 61.00 (above midpoint 60.75)
    bars.append(_bar(t, 61.55, 61.60, 60.90, 61.00, 1500.0))
    return bars


def _bar1_too_short():
    """Bar 1 body_pct only 0.30 - not a 'long' bar."""
    bars = _uptrend(15, 50.0, 60.0)
    t = _last_t(bars)
    # body 0.30, range 1.00 -> body_pct 0.30
    bars.append(_bar(t, 60.50, 61.00, 60.00, 60.80, 1500.0))
    t += DT
    bars.append(_bar(t, 60.85, 60.95, 60.75, 60.85, 700.0))  # star body 0
    t += DT
    bars.append(_bar(t, 60.85, 60.90, 60.05, 60.10, 1500.0))
    return bars


def _in_chop_no_swing():
    """3-bar structure mid-chop with weak context."""
    bars, t = [], T0
    for i in range(25):
        if i % 2 == 0:
            bars.append(_bar(t, 52.0, 53.0, 51.0, 52.5, 1200.0))
        else:
            bars.append(_bar(t, 52.5, 53.0, 51.5, 52.0, 1200.0))
        t += DT
    # Weak bar 1: body_pct 0.45
    bars.append(_bar(t, 51.85, 52.50, 51.50, 52.30, 1200.0))  # body 0.45, range 1.00
    # adjust: body 0.45 range 1.00: o=51.85 c=52.30 body=0.45, h=52.50 l=51.50 range=1.00 -> 0.45 ok
    t += DT
    bars.append(_bar(t, 52.40, 52.45, 52.32, 52.36, 1200.0))  # star body 0.04
    t += DT
    # Bar 3 red, body 0.45, range 1.00, closes 51.95 (below mid 52.075)
    bars.append(_bar(t, 52.40, 52.45, 51.40, 51.95, 1200.0))  # body 0.45 range 1.05 -> 0.43
    return bars


def _weak_volume_no_confirmation():
    """All 3 bars on low volume, downtrend context, weak geometry, moderate DCR - shouldn't fire."""
    bars = _downtrend(30, 55.0, 40.0)
    t = _last_t(bars)
    # Bar 1: body_pct 0.45, range 1.00
    bars.append(_bar(t, 40.00, 40.50, 39.50, 40.45, 800.0))
    t += DT
    bars.append(_bar(t, 40.50, 40.55, 40.45, 40.50, 800.0))  # star body 0
    t += DT
    # Bar 3 red with MODERATE DCR (~0.5) - no distribution-DCR bonus.
    # bar 1 mid = 40.225, close at 40.20. body 0.30, but need to keep DCR moderate
    # range 40.00->40.50, close 40.20. DCR = (40.20-40.00)/(40.50-40.00) = 0.40 (still low-ish)
    # Need DCR > 0.40 to avoid bonus. range 40.10->40.55, close 40.30. DCR = 0.444
    # body: open 40.50, close 40.30 = 0.20. range 0.45. body_pct 0.44
    bars.append(_bar(t, 40.50, 40.55, 40.10, 40.30, 700.0))
    return bars


# ============== EDGE ==============

def _boundary_body_size():
    """Star body at 28% of bar 1 (close to 30% max)."""
    bars = _uptrend(15, 50.0, 60.0, vol=1500.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.00, 61.55, 59.95, 61.50, 1500.0))  # body 1.50
    t += DT
    # star body 0.42 (28% of 1.50)
    bars.append(_bar(t, 61.70, 61.85, 61.55, 61.28, 800.0))
    # Wait - need open and close both in star territory. open 61.70, close 61.28.
    # body 0.42 (red star). Verify: 0.42/1.50=0.28
    t += DT
    bars.append(_bar(t, 61.30, 61.35, 60.45, 60.50, 1500.0))  # LONG RED close below mid 60.75
    return bars


def _boundary_midpoint_penetration():
    """Bar 3 close just barely below bar 1 midpoint (10% penetration)."""
    bars = _uptrend(15, 50.0, 60.0, vol=1500.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.00, 61.55, 59.95, 61.50, 1500.0))  # mid = 60.75
    t += DT
    bars.append(_bar(t, 61.70, 61.85, 61.55, 61.70, 700.0))
    t += DT
    # close at 60.60 (10% penetration past mid). body 1.10, range 1.30 -> 0.846
    bars.append(_bar(t, 61.70, 61.75, 60.55, 60.60, 1500.0))
    return bars


GOOD_CONTEXT = {
    "trend_stage": 2,
    "rs_trend": "up",
    "ma_alignment": "stacked_bullish",
    "volume_signature": "neutral",
    "regime": "bullish",
    "nearest_resistance": 61.5,
    "nearest_support": 50.0,
    "days_to_earnings": None,
    "sector_strength_rank": None,
    "recent_dcr_avg": 0.80,
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
    "recent_dcr_avg": 0.25,
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
    _write("clean_textbook", "positive", _clean_textbook(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("dramatic_engulfment", "positive", _dramatic_engulfment(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("doji_middle", "positive", _doji_middle(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("weak_dcr_close", "positive", _weak_dcr_close(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("perfect_context_alignment", "positive", _perfect_context_alignment(),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    # 8 NEGATIVE
    _write("no_pattern_continuation", "negative", _no_pattern_continuation(),
           GOOD_CONTEXT, {"fires": False})
    _write("wrong_bar_count_green_green_red", "negative",
           _wrong_bar_count_green_green_red(), GOOD_CONTEXT, {"fires": False})
    _write("star_body_too_big", "negative", _star_body_too_big(), GOOD_CONTEXT,
           {"fires": False})
    _write("wrong_direction_morning_star", "negative", _wrong_direction_morning_star(),
           DOWNTREND_CONTEXT, {"fires": False})
    _write("midpoint_not_penetrated", "negative", _midpoint_not_penetrated(),
           GOOD_CONTEXT, {"fires": False})
    _write("bar1_too_short", "negative", _bar1_too_short(), GOOD_CONTEXT,
           {"fires": False})
    _write("in_chop_no_swing", "negative", _in_chop_no_swing(), NEUTRAL_CONTEXT,
           {"fires": False})
    _write("weak_volume_no_confirmation", "negative", _weak_volume_no_confirmation(),
           DOWNTREND_CONTEXT, {"fires": False})

    # 2 EDGE
    _write("boundary_body_size", "edge", _boundary_body_size(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("boundary_midpoint_penetration", "edge", _boundary_midpoint_penetration(),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    print("\nDone — 15 fixtures written.")


if __name__ == "__main__":
    main()
