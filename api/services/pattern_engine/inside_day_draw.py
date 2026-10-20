"""The member "inside day" drawing: the inside day, the bar it sits inside, its trigger and its stop.

DISPLAY ONLY. Nothing here is read by any detector, confidence, HIST_SCORE or `confirmed_only`, and
the inside-day detectors themselves (uct_inside_day, uct_inside_day_id4) are unchanged and stay
admin-only.

Recognition is the served uct_inside_day_id4 rule exactly as its detector wraps it: the liquidity
floor, the newest of the last MAX_TRIGGER_AGE sessions where `evaluate` fires, and a prior-session
fire only while no later session traded below its low. On that inside day (session k) the drawing is:
  * a light box over the MOTHER bar (the bar k sits inside; for a double inside the bar before it)
    through k, from the mother's low to the mother's high;
  * a solid "trigger" line at the inside day's HIGH, extended into the next session;
  * a dashed "stop" line at the inside day's LOW, to the as-of bar.
It is WITHHELD (None) when any of these holds:
  triggered  a later session already traded above the trigger;
  tiny       the inside range is under TINY_ATR x ATR(14), or ATR(14) / close is under MIN_ATR_PCT;
  rejection  the mother bar closed red in the lower REJ_POS of its range;
  supply     the mother bar's upper wick is over WICK_FRAC of its range;
  context    the close sits below CTX_POS of its CTX_LB-session high-low range (not resting near
             the top of a prior advance);
  wide       the inside range is over WIDE_RATIO of the mother's range, or the inside high is within
             GAP_ATR x ATR(14) of the mother high (the trigger would read as the mother's high).

The lab rule (lab id_draw_v2, draw round 3, pre-registered) passed two fresh blind packets of 25
charts, two judges each, AS DRAWN here: A2 2.56 [2.36, 2.74] with 96% of charts >= 2, B2 2.44
[2.28, 2.60] with 100% >= 2 (bar: mean >= 2.3 and >= 70% >= 2). The previous round (round 2, without
the context and wide withholds) failed its second packet, 1.98. The team axis was too thin to test
(reported only). The drawing is shown on about 11% of served inside-day fires (lab coverage sample).

`inside_day_drawing(bars, i)` reads bars[:i+1] only (no lookahead) and returns the drawing or None.
It is a verbatim port of the lab rule (parity-railed in tests/test_inside_day_draw_lab_parity.py).
Bars are {t, o, h, l, c, v} dicts, oldest first.
"""
from __future__ import annotations

from api.services.pattern_engine.detectors.uct import uct_inside_day as ID
from api.services.pattern_engine.detectors.uct import uct_inside_day_id4 as ID4
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives import liquidity as LQ

#: The inside-day drawing round this code IS (= the lab's DRAW_ROUND). A row drawn here carries
#: extras.draw_round = ID_DRAW_ROUND; members are served only the confirmed round
#: (auto_structures.MEMBER_INSIDE_DAY_ROUND, a literal). Bump it with every new drawing.
ID_DRAW_ROUND = 3
#: The labels the judges saw.
TRIGGER_LABEL = "trigger"
STOP_LABEL = "stop"

# -- the lab's frozen constants (lab id_draw rule_id.py + id_draw_v2 rule_id2.py; PREREG.hashes) --
#: A double inside's mother is at most this many bars before the inside day.
MAX_NEST = 2
#: Withheld when the inside range is under this many ATR(14) ...
TINY_ATR = 0.2
#: ... or ATR(14) / close is under this (a pinned, dead tape).
MIN_ATR_PCT = 0.01
#: Withheld when the mother bar closed red in the lower REJ_POS of its range.
REJ_POS = 0.4
#: Withheld when the mother's upper wick is over WICK_FRAC of its range.
WICK_FRAC = 0.5
#: Context window (sessions, the as-of bar included) and the minimum close position in its range.
CTX_LB = 60
CTX_POS = 0.80
#: Withheld when the inside range is over WIDE_RATIO of the mother's range ...
WIDE_RATIO = 0.70
#: ... or the inside high is within GAP_ATR x ATR(14) of the mother high.
GAP_ATR = 0.10


def _liquid(b, i) -> bool:
    """The served liquidity floor (primitives.liquidity defaults) at bar i, missing volume as 0."""
    w = b[max(0, i - LQ.DEFAULT_LOOKBACK + 1):i + 1]
    if float(b[i]["c"]) < LQ.DEFAULT_MIN_PRICE:
        return False
    dv = sum(float(x["c"]) * float(x["v"] or 0) for x in w) / len(w)
    return dv >= LQ.DEFAULT_MIN_AVG_DOLLAR_VOLUME


def served_fire(b, i):
    """(k, candidate) for the served uct_inside_day_id4 answer at as-of i on b[:i+1], else None:
    the newest of sessions i, i-1, i-2 where its `evaluate` fires, kept only while no later session
    (<= i) traded below that inside day's low."""
    b = b[:i + 1]
    if not _liquid(b, i):
        return None
    S = U.series(b)
    for off in range(U.MAX_TRIGGER_AGE):
        k = i - off
        if k < 1:
            break
        c = ID4.evaluate(b, S, k)
        if c is None:
            continue
        stop = b[k]["l"]
        if any(b[j]["l"] < stop for j in range(k + 1, i + 1)):
            continue
        return k, c
    return None


def _atr14(b, i, n=14):
    k = max(1, i - n + 1)
    trs = [max(b[j]["h"], b[j - 1]["c"]) - min(b[j]["l"], b[j - 1]["c"]) for j in range(k, i + 1)]
    return sum(trs) / len(trs) if trs else None


def _inside(b, j) -> bool:
    return b[j]["h"] <= b[j - 1]["h"] and b[j]["l"] >= b[j - 1]["l"]


def context_pos(b, i):
    """Where the close at i sits in the high-low range of the CTX_LB sessions ending at i (0..1)."""
    if i - CTX_LB + 1 < 0:
        return None
    w = b[i - CTX_LB + 1:i + 1]
    hh, ll = max(x["h"] for x in w), min(x["l"] for x in w)
    if hh <= ll:
        return None
    return (b[i]["c"] - ll) / (hh - ll)


def inside_day_drawing(bars: list, i: int):
    """The inside-day drawing at bar `i` from bars[:i+1] only, or None:
    {trigger, stop, mother_high, mother_low, start_t (the mother bar), inside_t (the inside day),
    end_t (bar i), age, variant, atr (ATR(14) at bar i), ctx_pos, inside_ratio, label, stop_label}."""
    try:
        if not isinstance(i, int) or isinstance(i, bool) or i < ID._MIN_IDX or i >= len(bars):
            return None
        b = bars[:i + 1]
        s = served_fire(b, i)
        if s is None:
            return None
        k, c = s
        trig, stop = float(b[k]["h"]), float(b[k]["l"])
        if any(b[j]["h"] > trig for j in range(k + 1, i + 1)):
            return None                                              # triggered
        m = k - 1
        if c["variant"] == "double_inside" and m - 1 >= 0 and _inside(b, m) and k - (m - 1) <= MAX_NEST:
            m -= 1
        a = _atr14(b, i)
        close = float(b[i]["c"])
        if not a or a <= 0 or (trig - stop) < TINY_ATR * a or a / close < MIN_ATR_PCT:
            return None                                              # tiny
        mo, mh, ml, mc = (float(b[m][x]) for x in ("o", "h", "l", "c"))
        mr = mh - ml
        if mr <= 0:
            return None
        if mc < mo and (mc - ml) / mr < REJ_POS:
            return None                                              # rejection
        if (mh - max(mo, mc)) / mr > WICK_FRAC:
            return None                                              # supply
        p = context_pos(b, i)
        if p is None or p < CTX_POS:
            return None                                              # context
        if (trig - stop) > WIDE_RATIO * mr or (mh - trig) < GAP_ATR * a:
            return None                                              # wide
        return {"trigger": trig, "stop": stop, "mother_high": mh, "mother_low": ml,
                "start_t": int(b[m]["t"]), "inside_t": int(b[k]["t"]), "end_t": int(b[i]["t"]),
                "age": i - k, "variant": c["variant"], "atr": float(a), "ctx_pos": float(p),
                "inside_ratio": (trig - stop) / mr, "label": TRIGGER_LABEL, "stop_label": STOP_LABEL}
    except (KeyError, TypeError, ValueError, ZeroDivisionError, IndexError):
        return None
