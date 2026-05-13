"""Bullish Harami fixture generator. 15 fixtures total.

Geometry: bar N-1 LONG RED (body_pct >= 0.5), bar N small body ENTIRELY INSIDE
bar N-1's body (open > prev_close, close < prev_open if bar N green; or
both o and c between prev_close and prev_open more generally), body_ratio <= 0.5.
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
    """15-bar downtrend, then LONG RED bar + small green inside body. Textbook geometry."""
    bars = _downtrend(15, 60.0, 50.0, vol=1500.0)
    t = _last_t(bars)
    # Bar N-1: LONG RED. open 50.50, close 49.00, body 1.50, range 1.55 -> body_pct 0.968
    bars.append(_bar(t, 50.50, 50.55, 49.00, 49.00, 1800.0))
    t += DT
    # Bar N: small green inside body. open 49.50, close 50.00 (both INSIDE [49.00, 50.50]).
    # body 0.50, ratio 0.33. DCR high.
    bars.append(_bar(t, 49.50, 50.05, 49.45, 50.00, 900.0))  # volume contraction
    return bars


def _dramatic_inside():
    """Bar N body only 10% of bar N-1 - dramatic indecision after long red selling."""
    bars = _downtrend(15, 65.0, 50.0, vol=1500.0)
    t = _last_t(bars)
    # LONG RED: body 2.00, body_pct 0.95
    bars.append(_bar(t, 51.00, 51.10, 49.00, 49.00, 2000.0))
    t += DT
    # tiny inside body 0.20 (10% of prior body). open 49.90, close 50.10, DCR 0.7
    bars.append(_bar(t, 49.90, 50.20, 49.80, 50.10, 600.0))
    return bars


def _red_inside_bar():
    """Inside bar is RED (looser variant) but still valid harami."""
    bars = _downtrend(15, 60.0, 50.0, vol=1500.0)
    t = _last_t(bars)
    # LONG RED bar N-1
    bars.append(_bar(t, 50.50, 50.55, 49.00, 49.00, 1800.0))
    t += DT
    # red inside body. open 50.00, close 49.50 (both inside [49.00, 50.50]). body 0.50.
    bars.append(_bar(t, 50.00, 50.10, 49.45, 49.50, 800.0))
    return bars


def _strong_dcr_close():
    """Bar N closes very strongly (DCR ~0.9) - re-emerging demand."""
    bars = _downtrend(15, 60.0, 50.0, vol=1500.0)
    t = _last_t(bars)
    # LONG RED
    bars.append(_bar(t, 50.50, 50.55, 49.00, 49.00, 1800.0))
    t += DT
    # inside body with high DCR. range 49.30->50.20, close 50.10 -> DCR (50.10-49.30)/(50.20-49.30) = 0.889
    # body 50.10-49.60 = 0.50 inside [49.00, 50.50]. body 0.50, ratio 0.33.
    bars.append(_bar(t, 49.60, 50.20, 49.30, 50.10, 700.0))
    return bars


def _perfect_context_alignment():
    """20-bar weak-close decline (DCR distribution), then textbook harami."""
    bars, t = [], T0
    price = 65.0
    for i in range(20):
        # Each bar opens, drops, weak close. DCR very low.
        o = price
        h = price + 0.30
        l = price - 1.30
        c = price - 1.20
        bars.append(_bar(t, o, h, l, c, 1500.0))
        price -= 0.85
        t += DT
    # Now LONG RED bar N-1 + inside bar
    bars.append(_bar(t, 50.50, 50.55, 49.00, 49.00, 1800.0))
    t += DT
    bars.append(_bar(t, 49.50, 50.10, 49.40, 50.00, 700.0))  # green inside, high DCR
    return bars


# ============== NEGATIVE ==============

def _no_pattern_continuation():
    """Continuation - bar N drives further down, no inside structure."""
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    # LONG RED
    bars.append(_bar(t, 50.50, 50.55, 49.00, 49.00, 1500.0))
    t += DT
    # red bar that continues lower - NOT inside
    bars.append(_bar(t, 49.00, 49.05, 47.50, 47.60, 1700.0))
    return bars


def _bar_N_body_too_big():
    """Inside bar exists but body is 60% of prior body - fails 50% max."""
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    # LONG RED body 1.50
    bars.append(_bar(t, 50.50, 50.55, 49.00, 49.00, 1500.0))
    t += DT
    # green inside, body 1.00 (66% of prior) - fails 50% gate
    bars.append(_bar(t, 49.25, 50.30, 49.20, 50.25, 1200.0))
    return bars


def _not_inside():
    """Bar N body extends ABOVE bar N-1 body - outside bar, not harami."""
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    # LONG RED
    bars.append(_bar(t, 50.50, 50.55, 49.00, 49.00, 1500.0))
    t += DT
    # green bar that opens 49.20, closes 50.80 (above prev_open 50.50) - NOT inside
    bars.append(_bar(t, 49.20, 50.85, 49.15, 50.80, 1200.0))
    return bars


def _wrong_direction():
    """Bar N-1 is GREEN, not red - this would be bearish harami territory."""
    bars = _uptrend(15, 50.0, 60.0)
    t = _last_t(bars)
    # LONG GREEN (wrong color for bullish harami)
    bars.append(_bar(t, 60.00, 61.55, 59.95, 61.50, 1800.0))
    t += DT
    # inside body
    bars.append(_bar(t, 60.50, 61.00, 60.45, 60.90, 800.0))
    return bars


def _prev_bar_not_long():
    """Bar N-1 is red but body only 30% of range - not a 'long' bar."""
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    # red but small body relative to range. open 50.30, close 50.10 (body 0.20), range 50.50-49.50 (1.00)
    # body_pct = 0.20 (well below 0.5)
    bars.append(_bar(t, 50.30, 50.50, 49.50, 50.10, 1500.0))
    t += DT
    bars.append(_bar(t, 50.15, 50.20, 50.05, 50.20, 800.0))  # inside body but parent isn't long
    return bars


def _in_chop_no_swing():
    """Harami anatomy mid-chop, weak DCR, near-max body_ratio (~45%) - no context support."""
    bars, t = [], T0
    # 25-bar choppy sideways NOT at floor
    for i in range(25):
        if i % 2 == 0:
            bars.append(_bar(t, 52.0, 53.0, 51.0, 52.5, 1200.0))
        else:
            bars.append(_bar(t, 52.5, 53.0, 51.5, 52.0, 1200.0))
        t += DT
    # LONG RED in middle of chop - body 1.25, range 1.40 -> body_pct 0.89 (long enough)
    # but BARELY long; reduce its body_pct to ~0.55 (closer to 0.50 floor) to soften long_score
    # open 52.80, close 51.85 -> body 0.95, range 52.90-51.50 = 1.40 -> body_pct 0.68
    bars.append(_bar(t, 52.80, 52.90, 51.50, 51.85, 1200.0))
    t += DT
    # inside body near 45% ratio with high volume + weak DCR
    # body 0.42 = 0.44x prev body, range 51.60->52.65, close 51.78. open 52.20, close 51.78
    # body 0.42, prev_body 0.95 -> ratio 0.44
    # need inside [51.85, 52.80]: open 52.20 ok, close 51.78 - actually below 51.85, FAILS inside
    # adjust close to 51.90: body = 52.20 - 51.90 = 0.30. body_ratio = 0.32 (too clean).
    # Make body larger: open 52.60, close 51.90 - body 0.70. ratio 0.70/0.95 = 0.74 - FAILS 0.50.
    # We want ratio ~0.45: open 52.30, close 51.88 - body 0.42, ratio 0.44. inside [51.85, 52.80]. OK.
    # DCR: range 51.50->52.50, close 51.88 -> (51.88-51.50)/(52.50-51.50) = 0.38 (weak)
    bars.append(_bar(t, 52.30, 52.50, 51.50, 51.88, 1800.0))  # higher volume, weak DCR, body close to max
    return bars


def _weak_dcr_distribution():
    """Harami fires geometrically but bar N has body_ratio near max (~48%) + weak DCR + accumulation context.

    Geometry is borderline AND context is wrong-direction - confidence should fall below 50.
    """
    bars = _uptrend(20, 40.0, 52.0)
    t = _last_t(bars)
    # LONG RED with body_pct only ~0.56 (just above 0.50 floor)
    # open 53.00, close 52.10 -> body 0.90, range 53.20-51.50 = 1.70 -> body_pct 0.53
    bars.append(_bar(t, 53.00, 53.20, 51.50, 52.10, 1500.0))
    t += DT
    # inside body 0.42 (47% of prev body 0.90). open 52.80, close 52.38 - red inside [52.10, 53.00]
    # range 52.20->53.00, close 52.38 -> DCR (52.38-52.20)/(53.00-52.20) = 0.225 (weak)
    bars.append(_bar(t, 52.80, 53.00, 52.20, 52.38, 1500.0))
    return bars


def _high_volume_invalidation():
    """Volume on bar N is 3.5x prior - violates expected contraction signature.

    Combined with mid-chop placement, near-max body_ratio (~48%), weak DCR -> shouldn't fire.
    """
    bars, t = [], T0
    for i in range(25):
        if i % 2 == 0:
            bars.append(_bar(t, 52.0, 53.0, 51.0, 52.5, 1000.0))
        else:
            bars.append(_bar(t, 52.5, 53.0, 51.5, 52.0, 1000.0))
        t += DT
    # LONG RED with body_pct near floor: body 0.55, range 1.00 -> 0.55
    bars.append(_bar(t, 52.50, 52.65, 51.50, 51.95, 1000.0))
    t += DT
    # body_ratio ~48% (0.26 / 0.55), HIGH volume (3.5x), weak DCR, mid-chop, no swing
    # inside body: open 52.40, close 52.14 - both inside [51.95, 52.50]
    # range 52.00->52.65, close 52.14 -> DCR (52.14-52.00)/(52.65-52.00) = 0.215 (weak)
    bars.append(_bar(t, 52.40, 52.65, 52.00, 52.14, 3500.0))
    return bars


# ============== EDGE ==============

def _boundary_body_size():
    """Inside body exactly at 50% of prior body - boundary geometry pass."""
    bars = _downtrend(15, 60.0, 50.0, vol=1500.0)
    t = _last_t(bars)
    # LONG RED body 1.00. open 50.50, close 49.50
    bars.append(_bar(t, 50.50, 50.55, 49.00, 49.50, 1500.0))
    t += DT
    # inside body 0.48 (48% of prior). open 50.00, close 49.52 - red inside [49.50, 50.50]
    bars.append(_bar(t, 50.00, 50.10, 49.50, 49.52, 900.0))
    return bars


def _boundary_minimum_long_bar():
    """Prior bar body_pct exactly at 0.55 (just above 0.50 floor)."""
    bars = _downtrend(15, 60.0, 50.0, vol=1500.0)
    t = _last_t(bars)
    # body 0.55, range 1.00 -> body_pct 0.55
    bars.append(_bar(t, 50.50, 50.75, 49.75, 49.95, 1500.0))
    t += DT
    # inside body, body 0.20, ratio 0.36
    bars.append(_bar(t, 50.20, 50.30, 50.00, 50.40, 800.0))
    return bars


GOOD_CONTEXT = {
    "trend_stage": 4,
    "rs_trend": "down",
    "ma_alignment": "stacked_bearish",
    "volume_signature": "neutral",
    "regime": "bearish",
    "nearest_resistance": 60.0,
    "nearest_support": 49.5,
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
    _write("dramatic_inside", "positive", _dramatic_inside(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("red_inside_bar", "positive", _red_inside_bar(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("strong_dcr_close", "positive", _strong_dcr_close(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("perfect_context_alignment", "positive", _perfect_context_alignment(),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    # 8 NEGATIVE
    _write("no_pattern_continuation", "negative", _no_pattern_continuation(),
           GOOD_CONTEXT, {"fires": False})
    _write("bar_N_body_too_big", "negative", _bar_N_body_too_big(), GOOD_CONTEXT,
           {"fires": False})
    _write("not_inside", "negative", _not_inside(), GOOD_CONTEXT, {"fires": False})
    _write("wrong_direction", "negative", _wrong_direction(), UPTREND_CONTEXT,
           {"fires": False})
    _write("prev_bar_not_long", "negative", _prev_bar_not_long(), GOOD_CONTEXT,
           {"fires": False})
    _write("in_chop_no_swing", "negative", _in_chop_no_swing(), NEUTRAL_CONTEXT,
           {"fires": False})
    _write("weak_dcr_distribution", "negative", _weak_dcr_distribution(),
           UPTREND_CONTEXT, {"fires": False})
    _write("high_volume_invalidation", "negative", _high_volume_invalidation(),
           NEUTRAL_CONTEXT, {"fires": False})

    # 2 EDGE
    _write("boundary_body_size", "edge", _boundary_body_size(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("boundary_minimum_long_bar", "edge", _boundary_minimum_long_bar(),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    print("\nDone — 15 fixtures written.")


if __name__ == "__main__":
    main()
