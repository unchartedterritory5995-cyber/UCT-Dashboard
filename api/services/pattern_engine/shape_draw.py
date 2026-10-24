"""Shape drawings for the named bases: saucer, ascending base, double bottom (and the experimental IPO base).

DISPLAY ONLY. Nothing here is read by any detector, confidence, HIST_SCORE or `confirmed_only`, and
nothing here changes when base_catalog's structures fire: a drawing is attempted only where the
structure's OWN state function (base_catalog.saucer_state / ascending_base_state / double_bottom_state)
fires on the same context base_geometry builds, and it reuses that state's numbers. What this module
adds is the DRAWING -- the bar indices of the base's own points (the state functions return prices
only), the extent, the base low -- and a set of draw-gate WITHHOLDS: a fire whose drawing would show
the wrong base (see each function) is not drawn at all.

`*_drawing(bars, i)` reads bars[:i+1] only (no lookahead) and returns the drawing or None. Bars are
{t, o, h, l, c, v} dicts, oldest first. Each drawing carries its own round (`*_DRAW_ROUND`); the member
set serves a round only when auto_structures' MEMBER_<SHAPE>_ROUND literal names it (all None today:
admin-only until blind-judged).
"""
from __future__ import annotations

from typing import Optional

#: The drawing round this code IS, per shape. Bump with every change to that shape's drawing. Round 1 was the
#: state functions' raw geometry (lab base_shapes pilot p0, never served): it drew the double bottom from a minor
#: swing high mid-decline with lows a few bars apart, the saucer from an old high the stock had long since
#: cleared (a trend, not a base), and the ascending base after it had already broken out and run. Round 2 adds
#: the withholds below.
SAUCER_DRAW_ROUND = 2
ASCENDING_BASE_DRAW_ROUND = 2
DOUBLE_BOTTOM_DRAW_ROUND = 2
#: The labels the drawing shows.
PIVOT_LABEL = "pivot"
LOW_LABEL = "base low"

#: Bars handed to base_catalog (base_geometry reads a 400-bar working window off this).
WINDOW = 600


def _atr(bars, n=14):
    k = min(n, len(bars))
    trs = []
    for j in range(len(bars) - k, len(bars)):
        h, lo = float(bars[j]["h"]), float(bars[j]["l"])
        if j > 0:
            pc = float(bars[j - 1]["c"])
            trs.append(max(h, pc) - min(lo, pc))
        else:
            trs.append(h - lo)
    a = sum(trs) / len(trs) if trs else 0.0
    return a if a > 0 else None


def _context(bars, i, min_bars=60):
    """(ctx, work, atr) for bars[:i+1], exactly as base_geometry builds it, or (None, None, None)."""
    from api.services.screener import base_geometry as _bg
    b = list(bars[max(0, i + 1 - WINDOW):i + 1])
    if len(b) < min_bars:
        return None, None, None
    ctx, work = _bg._ctx(b)
    if not work:
        return None, None, None
    return ctx, work, _atr(work)


def _hi(work, s, e):
    """Index of the highest high in work[s..e] (first on ties)."""
    return max(range(s, e + 1), key=lambda k: (float(work[k]["h"]), -k))


def _lo(work, s, e):
    """Index of the lowest low in work[s..e] (first on ties)."""
    return min(range(s, e + 1), key=lambda k: (float(work[k]["l"]), k))


def _closed_above(work, s, e, level):
    """Index of the first close in work[s..e] above `level`, or None."""
    for k in range(s, e + 1):
        if float(work[k]["c"]) > level:
            return k
    return None


def _out(shape, rnd, work, start, piv, low, low_i, atr, marks, extra):
    n = len(work)
    close = float(work[-1]["c"])
    return {
        "shape": shape,
        "draw_round": rnd,
        "start_t": int(work[start]["t"]),
        "end_t": int(work[-1]["t"]),
        "pivot": round(float(piv), 6),
        "low": round(float(low), 6),
        "low_t": int(work[low_i]["t"]),
        "atr": round(float(atr), 6),
        "label": PIVOT_LABEL,
        "low_label": LOW_LABEL,
        "len": n - 1 - start,
        "depth": round((float(piv) - float(low)) / float(piv), 6),
        "close_minus_pivot_atr": round((close - float(piv)) / float(atr), 6),
        "marks": [{"t": int(work[k]["t"]), "price": round(float(p), 6), "kind": kind} for k, p, kind in marks],
        **extra,
    }


#: A pivot / lip high more than this many ATR(14) above every candle BODY top within SPIKE_BARS bars of it is
#: an isolated spike, not the base's top (lab cup_draw_v4's spike_lip withhold, same number).
SPIKE_ATR = 1.2
SPIKE_BARS = 5


def _spike(work, k, atr):
    """True when work[k]'s high stands more than SPIKE_ATR ATR above every body top within SPIKE_BARS bars."""
    s, e = max(0, k - SPIKE_BARS), min(len(work) - 1, k + SPIKE_BARS)
    body = max(max(float(work[j]["o"]), float(work[j]["c"])) for j in range(s, e + 1))
    return float(work[k]["h"]) - body > SPIKE_ATR * atr


def _say(why, reason):
    if why is not None:
        why.append(reason)
    return None


# ------------------------------------------------------------------------------------------ double bottom
#: The W's left lip is the highest high this many bars before its first low (not the last minor swing high).
DBL_LIP_LOOK = 60
#: The two lows at least this many bars apart (a W, not a two-bar spike reversal).
DBL_MIN_SEP = 10
#: The middle peak rises at least this many ATR(14) above the first low.
DBL_MID_RISE_ATR = 2.0
#: The decline from the lip into the first low is at least this many ATR.
DBL_LIP_DROP_ATR = 2.0
#: The middle peak sits no more than this many ATR above the lip (the W hangs from the base's top).
DBL_MID_OVER_LIP_ATR = 0.5
#: The second low may sit this many ATR ABOVE the first and still count (IBD wants an undercut; a hair over is
#: the same low on a daily chart).
DBL_LOW2_OVER_ATR = 0.25
#: The right side has come back at least this share of the way from the second low to the pivot.
DBL_RIGHT_SHARE = 0.6
#: The middle peak recovers at least this share of the drop from the lip to the first low (a W, not a bounce in
#: a downtrend).
DBL_MID_SHARE = 0.35
#: Bars after the second low before the as-of bar (the right side has started).
DBL_RIGHT_BARS = 2


def double_bottom_drawing(bars, i, _why=None) -> Optional[dict]:
    """The IBD double bottom ("W") as of bars[i], or None.

    Starts from base_catalog.double_bottom_state (it must fire) and its two confirmed swing lows, then snaps the
    drawing to the TRUE extremes (lab geometry_eval v2/v3: the classical drawing failed blind at 0.55 because
    its anchors skipped the true low, and at 1.10 because its two lows and tops did not match): the lip is the
    highest high before the first low, each low is the lowest low of its leg, the middle peak the highest high
    between them. Withheld when the snapped W is not one: lows too close, a flat middle, a middle peak above the
    lip, a right side that has not turned up, a breakout that already failed."""
    from api.services.screener import base_catalog as bc
    ctx, work, atr = _context(bars, i)
    if ctx is None or atr is None:
        return _say(_why, "no_context")
    st = bc.double_bottom_state(ctx)
    if st is None:
        return _say(_why, "no_state")
    lows, highs = ctx.lows, ctx.highs
    l1, l2 = lows[-2], lows[-1]
    if (l1["price"], l2["price"]) != (st["low1"], st["low2"]):
        return _say(_why, "state_mismatch")
    n = len(work)
    mid = [h for h in highs if l1["bar_index"] < h["bar_index"] < l2["bar_index"]]
    if not mid:
        return _say(_why, "no_middle")
    mp0 = max(mid, key=lambda h: h["price"])["bar_index"]
    lip = _hi(work, max(0, l1["bar_index"] - DBL_LIP_LOOK), l1["bar_index"])
    if lip >= mp0 - 1:
        return _say(_why, "no_lip")
    a = _lo(work, lip + 1, mp0 - 1)
    b = _lo(work, mp0 + 1, n - 1)
    if b - a < DBL_MIN_SEP:
        return _say(_why, "lows_close")
    mp = _hi(work, a + 1, b - 1)
    lip_h, mp_h = float(work[lip]["h"]), float(work[mp]["h"])
    la, lb = float(work[a]["l"]), float(work[b]["l"])
    if la <= 0 or lb <= 0 or lip_h <= 0:
        return _say(_why, "bad_prices")
    if lb > la + DBL_LOW2_OVER_ATR * atr or (la - lb) / la > bc.DBL_MAX_UNDERCUT:
        return _say(_why, "lows_mismatch")
    if mp_h - la < DBL_MID_RISE_ATR * atr:
        return _say(_why, "flat_middle")
    if lip_h - la < DBL_LIP_DROP_ATR * atr:
        return _say(_why, "no_decline")
    if mp_h > lip_h + DBL_MID_OVER_LIP_ATR * atr:
        return _say(_why, "middle_over_lip")
    if mp_h - la < DBL_MID_SHARE * (lip_h - la):
        return _say(_why, "weak_middle")
    if _spike(work, mp, atr):
        return _say(_why, "spike_pivot")
    low = min(la, lb)
    if (lip_h - low) / lip_h > bc.DBL_MAX_DEPTH:
        return _say(_why, "too_deep")
    if (n - 1) - b < DBL_RIGHT_BARS:
        return _say(_why, "no_right_side")
    piv = mp_h + bc.DBL_PIVOT_PAD
    close = float(work[-1]["c"])
    if close < lb + DBL_RIGHT_SHARE * (piv - lb):
        return _say(_why, "right_side_low")
    if close > piv * (1.0 + bc.IBD_BUY_ZONE):
        return _say(_why, "extended")
    if close < piv and _closed_above(work, b + 1, n - 2, piv) is not None:
        return _say(_why, "failed_breakout")
    marks = [(lip, lip_h, "lip"), (a, la, "low1"), (mp, mp_h, "middle_peak"), (b, lb, "low2")]
    low_i = a if la <= lb else b
    return _out("double-bottom", DOUBLE_BOTTOM_DRAW_ROUND, work, lip, piv, low, low_i, atr, marks,
                {"state_pivot": round(float(st["pivot"]), 6), "pivot_from_t": int(work[mp]["t"]), "path": True,
                 "top": round(max(lip_h, piv), 6)})


# ----------------------------------------------------------------------------------------- ascending base
#: Each pullback (high to low) and each recovery (low to the next high) spans at least this many bars.
ASC_MIN_LEG_BARS = 3
#: The whole staircase, pivot to its lowest low, at most this deep (each pullback is 10-20%; a staircase that
#: spans more is an advance off a bottom with pullbacks in it, not a base).
ASC_MAX_DEPTH = 0.30
#: The as-of close has come back at least this share of the way from the third low to the pivot.
ASC_RIGHT_SHARE = 0.5


def ascending_base_drawing(bars, i, _why=None) -> Optional[dict]:
    """The IBD ascending base (three rising 10-20% pullbacks) as of bars[i], or None.

    The state's own staircase and pivot (the high the third pullback began from). Withheld when a pullback is a
    one- or two-bar spike, when price has already run past the buy zone after the third low and come back (the
    base resolved), or when it has closed under the third low (the staircase broke)."""
    from api.services.screener import base_catalog as bc
    ctx, work, atr = _context(bars, i)
    if ctx is None or atr is None:
        return _say(_why, "no_context")
    st = bc.ascending_base_state(ctx)
    if st is None:
        return _say(_why, "no_state")
    sw = ctx.swings
    pairs = []
    for a, b in zip(sw, sw[1:]):
        if a["type"] == "high" and b["type"] == "low":
            hi, lo = a["price"], b["price"]
            if hi > 0 and lo > 0 and lo < hi:
                pairs.append((a, b))
    step = pairs[-bc.ASC_PULLBACKS:]
    if [x[0]["price"] for x in step] != st["highs"] or [x[1]["price"] for x in step] != st["lows"]:
        return _say(_why, "state_mismatch")
    for k, (h, lo) in enumerate(step):
        if lo["bar_index"] - h["bar_index"] < ASC_MIN_LEG_BARS:
            return _say(_why, "spike_pullback")
        if k + 1 < len(step) and step[k + 1][0]["bar_index"] - lo["bar_index"] < ASC_MIN_LEG_BARS:
            return _say(_why, "spike_recovery")
    n = len(work)
    piv = float(st["pivot"])
    l3 = step[-1][1]
    after = range(l3["bar_index"] + 1, n - 1)
    if any(float(work[k]["c"]) > piv * (1.0 + bc.ASC_BUY_ZONE) for k in after):
        return _say(_why, "resolved")
    if any(float(work[k]["c"]) < float(l3["price"]) for k in after):
        return _say(_why, "staircase_broken")
    if float(work[-1]["c"]) < float(l3["price"]) + ASC_RIGHT_SHARE * (piv - float(l3["price"])):
        return _say(_why, "right_side_low")
    start = step[0][0]["bar_index"]
    marks = []
    for k, (h, lo) in enumerate(step):
        marks.append((h["bar_index"], h["price"], "high%d" % (k + 1)))
        marks.append((lo["bar_index"], lo["price"], "low%d" % (k + 1)))
    low_i = _lo(work, start, n - 1)
    if (piv - float(work[low_i]["l"])) / piv > ASC_MAX_DEPTH:
        return _say(_why, "too_deep")
    return _out("ascending-base", ASCENDING_BASE_DRAW_ROUND, work, start, piv, float(work[low_i]["l"]),
                low_i, atr, marks, {"pivot_from_t": int(work[step[-1][0]["bar_index"]]["t"]), "path": True})


# ------------------------------------------------------------------------------------------------ saucer
#: The last this-many bars may close above the lip (a breakout in progress); no close before them may.
SAUCER_BREAK_BARS = 3
#: The low of the saucer sits between these shares of the span (rounded and roughly symmetric, not a slide).
SAUCER_LOW_POS = (0.2, 0.8)
#: The as-of close has come back at least this share of the way from the low to the lip.
SAUCER_RIGHT_SHARE = 0.6
#: The lip follows an advance: the close at the lip at least this much above the low of the prior 120 bars.
SAUCER_PRIOR_ADVANCE = 0.20


def saucer_drawing(bars, i, _why=None) -> Optional[dict]:
    """The IBD saucer as of bars[i], or None.

    The state's lip (its highest swing high 7 weeks to a year back) and low. The PIVOT is the lip -- the top a
    breakout must clear -- not the state's 10-bar high (which is a handle high only once there is a handle, and
    in round 1 sat wherever the last fortnight happened to peak). Withheld when the stock already closed above
    the lip (a trend that left the 'base' behind), when the low sits at either end (a slide, not a saucer),
    when the right side has not come back into the upper part, or when no advance led into the lip."""
    from api.services.screener import base_catalog as bc
    ctx, work, atr = _context(bars, i)
    if ctx is None or atr is None:
        return _say(_why, "no_context")
    st = bc.saucer_state(ctx)
    if st is None:
        return _say(_why, "no_state")
    n = len(work)
    cands = [h for h in ctx.highs if bc.SAUCER_MIN_BARS <= (n - 1) - h["bar_index"] <= bc.SAUCER_MAX_BARS]
    top = max(cands, key=lambda h: h["price"])
    if top["price"] != st["top"]:
        return _say(_why, "state_mismatch")
    lip = top["bar_index"]
    lip_h = float(top["price"])
    if _spike(work, lip, atr):
        return _say(_why, "spike_lip")
    if _closed_above(work, lip + 1, n - 1 - SAUCER_BREAK_BARS, lip_h) is not None:
        return _say(_why, "cleared_lip")
    close = float(work[-1]["c"])
    if close > lip_h * (1.0 + bc.IBD_BUY_ZONE):
        return _say(_why, "extended")
    low_i = _lo(work, lip, n - 1)
    low = float(work[low_i]["l"])
    span = (n - 1) - lip
    pos = (low_i - lip) / span if span else 0.0
    if not (SAUCER_LOW_POS[0] <= pos <= SAUCER_LOW_POS[1]):
        return _say(_why, "low_at_edge")
    if close < low + SAUCER_RIGHT_SHARE * (lip_h - low):
        return _say(_why, "right_side_low")
    adv = bc._prior_advance(work, n - lip, look=120)
    if (adv or 0.0) < SAUCER_PRIOR_ADVANCE:
        return _say(_why, "no_advance")
    rh = _hi(work, low_i, n - 2) if low_i < n - 2 else n - 1
    marks = [(lip, lip_h, "lip"), (low_i, low, "low"), (rh, float(work[rh]["h"]), "right_high")]
    return _out("saucer", SAUCER_DRAW_ROUND, work, lip, lip_h, low, low_i, atr, marks,
                {"lip": lip_h, "state_pivot": round(float(st["pivot"]), 6), "pivot_from_t": int(work[lip]["t"]),
                 "path": False})


# ---------------------------------------------------------------------------------------------- IPO base
#: The IPO base drawing round (EXPERIMENTAL; base_catalog.IPO_BASE is outside the member structures). The default
#: stays round 1 (what AUTO_STRUCTURES_SHAPES_ENABLED draws, unchanged); round 3 is drawn only when asked for.
IPO_BASE_DRAW_ROUND = 1
#: The round the rare-pattern admin preview draws (lab shapes_r3: round 1 plus the `_ipo_r3_why` gate; judged
#: 2.77 on 17 held-out cases, 100% >= 2, too few cases to pass a 2 x 25 packet).
IPO_PREVIEW_ROUND = 3
#: The IPO base rounds this module can draw (`rnd=1` is round 1 byte for byte).
IPO_ROUNDS = (1, 3)
#: The as-of close has come back at least this share of the way from the base low to the pivot.
IPO_RIGHT_SHARE = 0.5

# Round 3. Round 1 drew pivots on a lone listing-day spike wick, drew a later base rather than the first one,
# drew thin / gappy series (often a flat line near an issue price), and took a store's backfilled history
# start for a listing.
#: Top to lowest low, at least this deep: a flat line a few percent wide is not a base.
IPO_R3_MIN_DEPTH = 0.08
#: Consecutive stored bars more than this many calendar days apart are a missing session ...
IPO_R3_GAP_DAYS = 4
#: ... and a series since the listing with more than this many such gaps is too thin to draw.
IPO_R3_MAX_GAPS = 2
#: Bars with no range (high == low) or no volume, at most this share of the series since the listing.
IPO_R3_MAX_FLAT_SHARE = 0.05
#: Median close x volume over the base, at least this many dollars a day.
IPO_R3_MIN_DOLLAR_VOL = 1_000_000.0
#: The base top standing more than this many median true ranges (of the base) above every other high in the
#: base is a one-bar spike, not the top of a consolidation.
IPO_R3_SPIKE_TR = 1.0


def _median(xs):
    s = sorted(xs)
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2.0


def _median_tr(work, s, e):
    """Median true range of work[s..e] (s >= 1), or None."""
    trs = []
    for k in range(max(1, s), e + 1):
        h, lo, pc = float(work[k]["h"]), float(work[k]["l"]), float(work[k - 1]["c"])
        trs.append(max(h, pc) - min(lo, pc))
    m = _median(trs) if trs else 0.0
    return m if m > 0 else None


def _ymd_ordinal(t):
    import datetime
    s = "%08d" % int(t)
    return datetime.date(int(s[:4]), int(s[4:6]), int(s[6:8])).toordinal()


def _ipo_r3_why(work, top_i, top, low, n, first_t_shared):
    """The round-3 reason a round-1 IPO base is not drawn, or None (it passes)."""
    from api.services.screener import base_catalog as bc
    if bc.ipo_listing_is_backfill(first_t_shared):
        return "r3_backfill_listing"
    if (top - low) / top < IPO_R3_MIN_DEPTH:
        return "r3_too_shallow"
    try:
        days = [_ymd_ordinal(work[k]["t"]) for k in range(n)]
    except (TypeError, ValueError):
        return "r3_bad_dates"
    if sum(1 for k in range(1, n) if days[k] - days[k - 1] > IPO_R3_GAP_DAYS) > IPO_R3_MAX_GAPS:
        return "r3_gappy"
    flat = sum(1 for k in range(n) if float(work[k]["h"]) <= float(work[k]["l"]) or not float(work[k]["v"] or 0))
    if flat > IPO_R3_MAX_FLAT_SHARE * n:
        return "r3_flat_bars"
    if _median([float(work[k]["c"]) * float(work[k]["v"] or 0) for k in range(top_i, n)]) < IPO_R3_MIN_DOLLAR_VOL:
        return "r3_illiquid"
    mtr = _median_tr(work, max(1, top_i), n - 1)
    if mtr is None:
        return "r3_no_range"
    others = [float(work[k]["h"]) for k in range(top_i, n) if k != top_i]
    if not others or top - max(others) > IPO_R3_SPIKE_TR * mtr:
        return "r3_spike_top"
    if bc.ipo_earlier_base(work, top_i) is not None:
        return "r3_later_base"
    return None


def ipo_base_drawing(bars, i, first_t=None, _why=None, rnd=None, first_t_shared=None) -> Optional[dict]:
    """The first base after a listing (base_catalog.ipo_base_state) as of bars[i], or None.

    `first_t` is the series' first stored bar; without it the listing age is the window's first bar, which is
    only the listing when the window holds the whole history (see the IPO Base note in base_catalog). The
    region runs from the post-listing high to the as-of bar, the pivot is that high. Withheld when the high is
    an isolated spike or the right side has not come back into the upper half of the base.

    `rnd` (default IPO_BASE_DRAW_ROUND = 1): 1 draws round 1 exactly; 3 additionally withholds (`_ipo_r3_why`) a
    listing that is a store backfill boundary (`first_t_shared`, how many tickers in the store start on the
    same first date; unknown fails closed), a base shallower than IPO_R3_MIN_DEPTH, a thin / gappy / flat /
    illiquid series, a top that is a one-bar spike above every other high of the base, and a base preceded by
    an earlier base since the listing (base_catalog.ipo_earlier_base)."""
    from api.services.screener import base_catalog as bc
    rnd = IPO_BASE_DRAW_ROUND if rnd is None else rnd
    if rnd not in IPO_ROUNDS:
        raise ValueError("IPO base round %r is not drawable" % (rnd,))
    ctx, work, atr = _context(bars, i, min_bars=bc.IPO_MIN_BARS + 2)
    if ctx is None or atr is None:
        return _say(_why, "no_context")
    st = bc.ipo_base_state(ctx, first_t=first_t)
    if st is None:
        return _say(_why, "no_state")
    full = ctx.bars_full
    if full is not work and len(full) != len(work):
        return _say(_why, "window_mismatch")
    n = len(work)
    top_i = int(st["top_index"])
    top = float(st["top"])
    if _spike(work, top_i, atr):
        return _say(_why, "spike_pivot")
    low_i = _lo(work, top_i, n - 1)
    low = float(work[low_i]["l"])
    if float(work[-1]["c"]) < low + IPO_RIGHT_SHARE * (top - low):
        return _say(_why, "right_side_low")
    if rnd >= 3:
        r3 = _ipo_r3_why(work, top_i, top, low, n, first_t_shared)
        if r3 is not None:
            return _say(_why, r3)
    marks = [(0, float(work[0]["o"]), "listing"), (top_i, top, "base_top"), (low_i, low, "low")]
    return _out("ipo-base", rnd, work, top_i, top, low, low_i, atr, marks,
                {"listing_t": int(st["listing_t"]), "pivot_from_t": int(work[top_i]["t"]), "path": False})
