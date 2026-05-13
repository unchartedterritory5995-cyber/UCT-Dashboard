"""Morning Star fixture generator. 15 fixtures total.

3-bar pattern:
  Bar 1 (N-2): LONG RED (body_pct >= 0.40)
  Bar 2 (N-1): small body (<= 30% of bar 1 body) - the "star"
  Bar 3 (N):   LONG GREEN (body_pct >= 0.40), close above bar 1's midpoint
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
    """15-bar downtrend, LONG RED, gap-down star, LONG GREEN closing above midpoint."""
    bars = _downtrend(15, 60.0, 50.0, vol=1500.0)
    t = _last_t(bars)
    # Bar 1: LONG RED. open 50.50, close 49.00, body 1.50, range 1.55
    bars.append(_bar(t, 50.50, 50.55, 49.00, 49.00, 1800.0))
    t += DT
    # Bar 2: star (gapped down). open 48.80, close 48.70 - tiny body 0.10. body_ratio 0.067
    bars.append(_bar(t, 48.80, 48.90, 48.60, 48.70, 700.0))  # contracted volume
    t += DT
    # Bar 3: LONG GREEN closing above bar 1 midpoint (50.50+49.00)/2 = 49.75
    # open 48.80, close 50.00 - body 1.20, range 1.30 -> body_pct 0.923
    bars.append(_bar(t, 48.80, 50.10, 48.75, 50.00, 2200.0))  # expanded volume
    return bars


def _dramatic_engulfment():
    """Bar 3 closes very close to bar 1's open - near-complete reversal."""
    bars = _downtrend(15, 60.0, 50.0, vol=1500.0)
    t = _last_t(bars)
    # LONG RED body 1.50
    bars.append(_bar(t, 50.50, 50.55, 49.00, 49.00, 1800.0))
    t += DT
    # Star: tiny body
    bars.append(_bar(t, 48.85, 48.95, 48.70, 48.80, 600.0))
    t += DT
    # LONG GREEN closes at 50.40 (just below bar 1 open of 50.50). MP penetration ~85%
    bars.append(_bar(t, 48.85, 50.50, 48.80, 50.40, 2400.0))
    return bars


def _doji_middle():
    """Middle bar is a true doji - the textbook 'doji star' variant."""
    bars = _downtrend(15, 60.0, 50.0, vol=1500.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.50, 50.55, 49.00, 49.00, 1800.0))
    t += DT
    # Doji: open ~= close
    bars.append(_bar(t, 48.85, 48.95, 48.75, 48.86, 700.0))  # body 0.01 - tiny doji
    t += DT
    bars.append(_bar(t, 48.85, 50.10, 48.80, 50.00, 2200.0))
    return bars


def _strong_dcr_close():
    """Bar 3 DCR ~0.95 - institutional buying signature."""
    bars = _downtrend(15, 60.0, 50.0, vol=1500.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.50, 50.55, 49.00, 49.00, 1800.0))
    t += DT
    bars.append(_bar(t, 48.85, 48.95, 48.70, 48.80, 700.0))
    t += DT
    # Bar 3: range 48.75->50.10, close 50.08 -> DCR (50.08-48.75)/(50.10-48.75) = 0.985
    bars.append(_bar(t, 48.85, 50.10, 48.75, 50.08, 2200.0))
    return bars


def _perfect_context_alignment():
    """20-bar weak-close distribution decline + clean morning star."""
    bars, t = [], T0
    price = 65.0
    for i in range(20):
        o = price
        h = price + 0.30
        l = price - 1.30
        c = price - 1.20
        bars.append(_bar(t, o, h, l, c, 1500.0))
        price -= 0.80
        t += DT
    # LONG RED + star + LONG GREEN
    bars.append(_bar(t, 50.50, 50.55, 49.00, 49.00, 1800.0))
    t += DT
    bars.append(_bar(t, 48.85, 48.95, 48.70, 48.80, 700.0))
    t += DT
    bars.append(_bar(t, 48.85, 50.10, 48.75, 50.00, 2200.0))
    return bars


# ============== NEGATIVE ==============

def _no_pattern_continuation():
    """Continues lower - no morning star."""
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.50, 50.55, 49.00, 49.00, 1500.0))  # LONG RED
    t += DT
    bars.append(_bar(t, 48.95, 49.00, 47.50, 47.55, 1700.0))  # red continuation, not a star
    t += DT
    bars.append(_bar(t, 47.55, 47.60, 46.00, 46.10, 1600.0))  # more red
    return bars


def _wrong_bar_count_red_red_green():
    """Bar 1 red, bar 2 red (not a star - too large), bar 3 green - star ratio fails."""
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.50, 50.55, 49.00, 49.00, 1500.0))  # LONG RED 1.50 body
    t += DT
    bars.append(_bar(t, 49.00, 49.05, 47.50, 47.60, 1700.0))  # red but body 1.40 - WAY too big for star
    t += DT
    bars.append(_bar(t, 47.65, 49.00, 47.60, 48.95, 1500.0))  # green
    return bars


def _star_body_too_big():
    """Middle bar body is 40% of bar 1 body - fails 30% max."""
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.50, 50.55, 49.00, 49.00, 1500.0))  # body 1.50
    t += DT
    bars.append(_bar(t, 48.85, 49.50, 48.70, 49.50, 1000.0))  # body 0.65 (43% of prev) - too big
    t += DT
    bars.append(_bar(t, 49.50, 50.10, 49.45, 50.00, 1500.0))
    return bars


def _wrong_direction_evening_star():
    """3-bar evening-star structure (green/star/red) - should NOT fire as morning_star."""
    bars = _uptrend(15, 50.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.00, 61.55, 59.95, 61.50, 1500.0))  # LONG GREEN
    t += DT
    bars.append(_bar(t, 61.65, 61.75, 61.55, 61.60, 700.0))   # star
    t += DT
    bars.append(_bar(t, 61.55, 61.60, 60.10, 60.20, 1500.0))  # LONG RED - evening, not morning
    return bars


def _midpoint_not_penetrated():
    """Bar 3 green closes BELOW bar 1 midpoint - fails the half-reversal rule."""
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.50, 50.55, 49.00, 49.00, 1500.0))  # mid = 49.75
    t += DT
    bars.append(_bar(t, 48.85, 48.95, 48.70, 48.80, 700.0))
    t += DT
    # Bar 3 green but closes at 49.50 (below midpoint 49.75)
    bars.append(_bar(t, 48.90, 49.55, 48.85, 49.50, 1500.0))
    return bars


def _bar1_too_short():
    """Bar 1 body_pct only 0.30 - not a 'long' bar."""
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    # body 0.30, range 1.00 -> body_pct 0.30 (below 0.40)
    bars.append(_bar(t, 50.50, 51.00, 50.00, 50.20, 1500.0))
    t += DT
    bars.append(_bar(t, 50.00, 50.10, 49.85, 49.95, 700.0))
    t += DT
    bars.append(_bar(t, 49.95, 50.85, 49.90, 50.80, 1500.0))
    return bars


def _in_chop_no_swing():
    """3-bar structure mid-chop with weak DCR + neutral context."""
    bars, t = [], T0
    for i in range(25):
        if i % 2 == 0:
            bars.append(_bar(t, 52.0, 53.0, 51.0, 52.5, 1200.0))
        else:
            bars.append(_bar(t, 52.5, 53.0, 51.5, 52.0, 1200.0))
        t += DT
    # Weak structure: bar 1 body_pct ~0.45 (near floor)
    bars.append(_bar(t, 52.70, 52.75, 51.80, 51.85, 1200.0))  # body 0.85, range 0.95 -> body_pct 0.89
    # adjust to body_pct 0.45: body 0.45, range 1.00
    bars[-1] = _bar(t, 52.50, 53.00, 52.00, 52.05, 1200.0)  # body 0.45, range 1.00 -> 0.45
    t += DT
    bars.append(_bar(t, 51.90, 52.00, 51.80, 51.95, 1200.0))  # star body 0.05, ratio 0.11
    t += DT
    # Bar 3 green but DCR weak, body_pct just above floor
    # body 0.45, range 1.00, close near mid -> DCR moderate
    bars.append(_bar(t, 51.85, 52.40, 51.50, 52.30, 1200.0))  # closes above bar 1 mid (52.275)
    return bars


def _weak_volume_no_confirmation():
    """All 3 bars on low volume, no decline context - confirmation lacking."""
    bars = _uptrend(30, 40.0, 55.0)
    t = _last_t(bars)
    # Bar 1 small body relative
    bars.append(_bar(t, 55.50, 55.80, 54.50, 54.55, 800.0))  # body 0.95, range 1.30 -> 0.73 (good geom)
    # Reduce body_pct: body 0.45 range 1.00 -> 0.45
    bars[-1] = _bar(t, 55.45, 56.00, 55.00, 55.00, 800.0)  # body 0.45, range 1.00 -> 0.45
    t += DT
    bars.append(_bar(t, 54.90, 55.00, 54.80, 54.95, 800.0))  # star body 0.05, ratio 0.11
    t += DT
    # bar 3 green with low volume, body close to floor, no midpoint penetration
    # bar 1 mid = (55.45+55.00)/2 = 55.225
    # close at 55.30 - just barely above midpoint (mp 0.11)
    bars.append(_bar(t, 54.95, 55.35, 54.90, 55.30, 700.0))  # body 0.35, range 0.45 -> 0.78 (good)
    # adjust to body_pct 0.45: body 0.40, range 0.90
    bars[-1] = _bar(t, 54.95, 55.45, 54.55, 55.30, 700.0)  # body 0.35, range 0.90 -> 0.39 - fails!
    # need body_pct >= 0.40. body 0.40, range 0.95: close 55.35 instead
    bars[-1] = _bar(t, 54.95, 55.45, 54.50, 55.36, 700.0)  # body 0.41, range 0.95 -> 0.43
    return bars


# ============== EDGE ==============

def _boundary_body_size():
    """Star body at 28% of bar 1 (close to 30% max)."""
    bars = _downtrend(15, 60.0, 50.0, vol=1500.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.50, 50.55, 49.00, 49.00, 1500.0))  # body 1.50
    t += DT
    # star body 0.42 (28% of 1.50)
    bars.append(_bar(t, 48.80, 49.30, 48.75, 49.22, 800.0))
    t += DT
    bars.append(_bar(t, 48.85, 50.10, 48.80, 50.00, 1500.0))
    return bars


def _boundary_midpoint_penetration():
    """Bar 3 close just barely above bar 1 midpoint (10% penetration)."""
    bars = _downtrend(15, 60.0, 50.0, vol=1500.0)
    t = _last_t(bars)
    bars.append(_bar(t, 50.50, 50.55, 49.00, 49.00, 1500.0))  # mid = 49.75
    t += DT
    bars.append(_bar(t, 48.85, 48.95, 48.70, 48.80, 700.0))
    t += DT
    # Bar 3 closes at 49.90 (10% penetration past mid)
    # body 49.90 - 48.90 = 1.00, range 1.20 -> body_pct 0.833
    bars.append(_bar(t, 48.90, 50.00, 48.80, 49.90, 1500.0))
    return bars


GOOD_CONTEXT = {
    "trend_stage": 4,
    "rs_trend": "down",
    "ma_alignment": "stacked_bearish",
    "volume_signature": "neutral",
    "regime": "bearish",
    "nearest_resistance": 60.0,
    "nearest_support": 48.5,
    "days_to_earnings": None,
    "sector_strength_rank": None,
    "recent_dcr_avg": 0.20,
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
    _write("clean_textbook", "positive", _clean_textbook(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("dramatic_engulfment", "positive", _dramatic_engulfment(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("doji_middle", "positive", _doji_middle(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("strong_dcr_close", "positive", _strong_dcr_close(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("perfect_context_alignment", "positive", _perfect_context_alignment(),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    # 8 NEGATIVE
    _write("no_pattern_continuation", "negative", _no_pattern_continuation(),
           GOOD_CONTEXT, {"fires": False})
    _write("wrong_bar_count_red_red_green", "negative",
           _wrong_bar_count_red_red_green(), GOOD_CONTEXT, {"fires": False})
    _write("star_body_too_big", "negative", _star_body_too_big(), GOOD_CONTEXT,
           {"fires": False})
    _write("wrong_direction_evening_star", "negative", _wrong_direction_evening_star(),
           UPTREND_CONTEXT, {"fires": False})
    _write("midpoint_not_penetrated", "negative", _midpoint_not_penetrated(),
           GOOD_CONTEXT, {"fires": False})
    _write("bar1_too_short", "negative", _bar1_too_short(), GOOD_CONTEXT,
           {"fires": False})
    _write("in_chop_no_swing", "negative", _in_chop_no_swing(), NEUTRAL_CONTEXT,
           {"fires": False})
    _write("weak_volume_no_confirmation", "negative", _weak_volume_no_confirmation(),
           UPTREND_CONTEXT, {"fires": False})

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
