"""Bearish Harami fixture generator. 15 fixtures total.

Geometry: bar N-1 LONG GREEN (body_pct >= 0.5), bar N small body ENTIRELY INSIDE
bar N-1's body (both o and c between prev_open and prev_close), body_ratio <= 0.5.
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
    """15-bar uptrend, then LONG GREEN bar + small red inside body. Textbook geometry."""
    bars = _uptrend(15, 50.0, 60.0, vol=1500.0)
    t = _last_t(bars)
    # Bar N-1: LONG GREEN. open 60.00, close 61.50 -> body 1.50, range 1.55 -> body_pct 0.968
    bars.append(_bar(t, 60.00, 61.50, 59.95, 61.50, 1800.0))
    t += DT
    # Bar N: small red inside body. open 61.00, close 60.50 (both inside [60.00, 61.50]).
    # body 0.50, ratio 0.33. weak DCR.
    bars.append(_bar(t, 61.00, 61.05, 60.45, 60.50, 900.0))  # vol contraction, weak DCR
    return bars


def _dramatic_inside():
    """Bar N body only 10% of bar N-1 - dramatic indecision after long green buying."""
    bars = _uptrend(15, 50.0, 65.0, vol=1500.0)
    t = _last_t(bars)
    # LONG GREEN: body 2.00, body_pct ~0.95
    bars.append(_bar(t, 64.00, 66.00, 63.95, 66.00, 2000.0))
    t += DT
    # tiny inside body 0.20 (10% of prior body). open 65.10, close 64.90
    # range 64.80->65.20, close 64.90 -> DCR (64.90-64.80)/(65.20-64.80) = 0.25
    bars.append(_bar(t, 65.10, 65.20, 64.80, 64.90, 600.0))
    return bars


def _green_inside_bar():
    """Inside bar is GREEN (looser variant) but still valid bearish harami."""
    bars = _uptrend(15, 50.0, 60.0, vol=1500.0)
    t = _last_t(bars)
    # LONG GREEN
    bars.append(_bar(t, 60.00, 61.50, 59.95, 61.50, 1800.0))
    t += DT
    # green inside body. open 60.50, close 61.00 (both inside [60.00, 61.50]). body 0.50.
    bars.append(_bar(t, 60.50, 61.05, 60.45, 61.00, 800.0))
    return bars


def _weak_dcr_close():
    """Bar N closes very weakly (DCR ~0.1) - re-emerging supply."""
    bars = _uptrend(15, 50.0, 60.0, vol=1500.0)
    t = _last_t(bars)
    # LONG GREEN
    bars.append(_bar(t, 60.00, 61.50, 59.95, 61.50, 1800.0))
    t += DT
    # inside body with low DCR. range 60.30->61.20, close 60.42
    # DCR = (60.42-60.30)/(61.20-60.30) = 0.133. body: open 60.90 close 60.42 = 0.48
    bars.append(_bar(t, 60.90, 61.20, 60.30, 60.42, 700.0))
    return bars


def _perfect_context_alignment():
    """20-bar strong-close advance (DCR accumulation), then textbook bearish harami."""
    bars, t = [], T0
    price = 45.0
    for i in range(20):
        # strong close every bar. DCR very high.
        o = price
        h = price + 1.30
        l = price - 0.30
        c = price + 1.20
        bars.append(_bar(t, o, h, l, c, 1500.0))
        price += 0.85
        t += DT
    # Now LONG GREEN bar N-1 + inside bar
    bars.append(_bar(t, 60.00, 61.50, 59.95, 61.50, 1800.0))
    t += DT
    bars.append(_bar(t, 61.00, 61.10, 60.40, 60.50, 700.0))  # red inside, low DCR
    return bars


# ============== NEGATIVE ==============

def _no_pattern_continuation():
    """Continuation - bar N drives further up, no inside structure."""
    bars = _uptrend(15, 50.0, 60.0)
    t = _last_t(bars)
    # LONG GREEN
    bars.append(_bar(t, 60.00, 61.50, 59.95, 61.50, 1500.0))
    t += DT
    # green bar that continues higher - NOT inside
    bars.append(_bar(t, 61.50, 63.00, 61.45, 62.95, 1700.0))
    return bars


def _bar_N_body_too_big():
    """Inside bar exists but body is 60% of prior body - fails 50% max."""
    bars = _uptrend(15, 50.0, 60.0)
    t = _last_t(bars)
    # LONG GREEN body 1.50
    bars.append(_bar(t, 60.00, 61.50, 59.95, 61.50, 1500.0))
    t += DT
    # red inside body 1.00 (66% of prior) - fails 50% gate
    bars.append(_bar(t, 61.25, 61.30, 60.20, 60.25, 1200.0))
    return bars


def _not_inside():
    """Bar N body extends BELOW bar N-1 body - outside bar, not harami."""
    bars = _uptrend(15, 50.0, 60.0)
    t = _last_t(bars)
    bars.append(_bar(t, 60.00, 61.50, 59.95, 61.50, 1500.0))
    t += DT
    # red bar that opens 61.30, closes 59.20 (below prev_open 60.00) - NOT inside
    bars.append(_bar(t, 61.30, 61.35, 59.10, 59.20, 1200.0))
    return bars


def _wrong_direction():
    """Bar N-1 is RED, not green - this would be bullish harami territory."""
    bars = _downtrend(15, 60.0, 50.0)
    t = _last_t(bars)
    # LONG RED (wrong color for bearish harami)
    bars.append(_bar(t, 50.50, 50.55, 49.00, 49.00, 1800.0))
    t += DT
    bars.append(_bar(t, 49.50, 50.10, 49.45, 50.00, 800.0))
    return bars


def _prev_bar_not_long():
    """Bar N-1 is green but body only 20% of range - not a 'long' bar."""
    bars = _uptrend(15, 50.0, 60.0)
    t = _last_t(bars)
    # green but small body relative to range. body 0.20, range 1.00 -> body_pct 0.20
    bars.append(_bar(t, 60.30, 60.80, 59.80, 60.50, 1500.0))
    t += DT
    bars.append(_bar(t, 60.40, 60.45, 60.32, 60.32, 800.0))  # inside but parent not long
    return bars


def _in_chop_no_swing():
    """Harami anatomy mid-chop, near-max body_ratio, weak context."""
    bars, t = [], T0
    # 25-bar choppy sideways NOT at ceiling
    for i in range(25):
        if i % 2 == 0:
            bars.append(_bar(t, 52.0, 53.0, 51.0, 52.5, 1200.0))
        else:
            bars.append(_bar(t, 52.5, 53.0, 51.5, 52.0, 1200.0))
        t += DT
    # LONG GREEN in middle of chop - body_pct ~0.55 (close to floor)
    # open 51.50, close 52.45 -> body 0.95, range 53.20-51.30 = 1.90 -> body_pct 0.50
    bars.append(_bar(t, 51.50, 53.20, 51.30, 52.45, 1200.0))
    t += DT
    # inside body 0.42 (44% of prev body). open 51.85, close 52.27 inside [51.50, 52.45]
    # range 51.50->53.00, close 52.27 -> DCR (52.27-51.50)/(53.00-51.50) = 0.513
    bars.append(_bar(t, 51.85, 53.00, 51.50, 52.27, 1800.0))  # higher vol, mid DCR
    return bars


def _weak_dcr_accumulation():
    """Bearish harami fires geometrically but bar N has high DCR + downtrend context - no edge.

    body_pct just above floor + body_ratio near max + accumulation context that's wrong-direction.
    """
    bars = _downtrend(20, 65.0, 53.0)
    t = _last_t(bars)
    # LONG GREEN one-bar bounce. body_pct ~0.53 (near floor): body 0.90, range 1.70
    bars.append(_bar(t, 52.00, 53.20, 51.50, 52.90, 1500.0))
    t += DT
    # inside body 0.42 (47% of prev body). open 52.20, close 52.62 - green inside [52.00, 52.90]
    # range 52.00->52.95, close 52.62 -> DCR (52.62-52.00)/(52.95-52.00) = 0.653 (strong, wrong direction)
    bars.append(_bar(t, 52.20, 52.95, 52.00, 52.62, 1500.0))
    return bars


def _high_volume_invalidation():
    """Volume 3.5x prior - violates contraction signature; mid-chop + weak geom."""
    bars, t = [], T0
    for i in range(25):
        if i % 2 == 0:
            bars.append(_bar(t, 52.0, 53.0, 51.0, 52.5, 1000.0))
        else:
            bars.append(_bar(t, 52.5, 53.0, 51.5, 52.0, 1000.0))
        t += DT
    # LONG GREEN body_pct near floor
    bars.append(_bar(t, 51.50, 52.50, 51.35, 52.05, 1000.0))  # body 0.55, range 1.15 -> 0.478? need>0.5
    # Fix: body 0.55 / range 1.00 -> 0.55
    bars[-1] = _bar(t, 51.50, 52.50, 51.50, 52.05, 1000.0)  # range 1.00, body 0.55, body_pct 0.55
    t += DT
    # inside body ~48% ratio, high vol, strong DCR (wrong direction)
    bars.append(_bar(t, 51.65, 52.10, 51.50, 51.95, 3500.0))  # body 0.30/0.55=0.55 - too big
    # Adjust: body 0.25 (45% of 0.55). open 51.80, close 51.95 (green inside [51.50, 52.05])
    bars[-1] = _bar(t, 51.80, 52.05, 51.50, 51.95, 3500.0)
    return bars


# ============== EDGE ==============

def _boundary_body_size():
    """Inside body exactly at 48% of prior body - boundary geometry pass."""
    bars = _uptrend(15, 50.0, 60.0, vol=1500.0)
    t = _last_t(bars)
    # LONG GREEN body 1.00. open 60.00, close 61.00
    bars.append(_bar(t, 60.00, 61.05, 59.95, 61.00, 1500.0))
    t += DT
    # inside body 0.48 (48% of prior). open 60.52, close 60.99 - green inside
    # Wait, both inside [60.00, 61.00]: open 60.52 inside ok, close 60.99 inside ok. body 0.47.
    bars.append(_bar(t, 60.52, 61.00, 60.45, 60.99, 900.0))
    return bars


def _boundary_minimum_long_bar():
    """Prior bar body_pct exactly at 0.55 (just above 0.50 floor)."""
    bars = _uptrend(15, 50.0, 60.0, vol=1500.0)
    t = _last_t(bars)
    # body 0.55, range 1.00 -> body_pct 0.55
    bars.append(_bar(t, 60.05, 60.85, 60.00, 60.60, 1500.0))
    # Verify: o=60.05, c=60.60 -> body 0.55, range 0.85 -> body_pct 0.647
    # Need range 1.00: l=59.85, h=60.85: body_pct = 0.55/1.00 = 0.55
    bars[-1] = _bar(t, 60.05, 60.85, 59.85, 60.60, 1500.0)
    t += DT
    # inside body 0.20, ratio 0.36
    bars.append(_bar(t, 60.40, 60.55, 60.10, 60.20, 800.0))  # red inside, must be inside [60.05, 60.60]
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
    _write("dramatic_inside", "positive", _dramatic_inside(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("green_inside_bar", "positive", _green_inside_bar(), GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})
    _write("weak_dcr_close", "positive", _weak_dcr_close(), GOOD_CONTEXT,
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
    _write("wrong_direction", "negative", _wrong_direction(), DOWNTREND_CONTEXT,
           {"fires": False})
    _write("prev_bar_not_long", "negative", _prev_bar_not_long(), GOOD_CONTEXT,
           {"fires": False})
    _write("in_chop_no_swing", "negative", _in_chop_no_swing(), NEUTRAL_CONTEXT,
           {"fires": False})
    _write("weak_dcr_accumulation", "negative", _weak_dcr_accumulation(),
           DOWNTREND_CONTEXT, {"fires": False})
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
