"""Textbook (IBD-style) numbers beside the base drawing -- display only, dark.

Behind AUTO_STRUCTURES_TEXTBOOK_NUMBERS_ENABLED (read per call in auto_structures; it rides
AUTO_STRUCTURES_METRICS_ENABLED, so it does nothing unless the base metrics are on too). While off,
nothing here runs and every payload is byte-identical to before.

For a base row that already carries base metrics (`extras.metrics`, api/services/base_metrics.py) this adds
`extras.metrics_textbook` + `extras.metrics_textbook_round`:

    buy_point           the IBD-style buy point: the base's pivot HIGH (a wick high, not a body) + $0.10
    base_high           the base's highest high (what the buy point and depth are measured from)
    depth_pct           (base_high - base low) / base_high, in % (1 decimal)
    length_weeks        the base metrics' own length (trading bars of the drawn base span / 5)
    buy_zone_top        buy_point x (1 + IBD_BUY_ZONE): the buy zone runs to 5% above the buy point
    pct_from_buy_point  (as-of close - buy_point) / buy_point, in % (1 decimal)
    stage               the base count (see below); omitted whenever it cannot be read reliably
    line                bc:base only: where the base's top line is drawn, buy_point - $0.10 (see below)
    volume              {vol_pct, breakout, light} (see below); omitted when there is nothing to say

THE LINE (round 2). In round 1 the bc:base line stayed on the base's highest BODY (draw_base.pivot) while the
printed buy point was the ceiling bar's WICK high + $0.10, up to SPIKE_MAX_ATR ATR over that line, so a close
could sit visibly through the line while the label said "-2.3% from buy point" (prod eye audit 2026-10-23: 25 of
64 member bases had the buy point more than 0.5 ATR over the line, 13 closed between the two). Round 2 stamps
`line` = buy_point - $0.10 (the base high, the textbook pivot line an IBD chart shows) on every bc:base row, and
the chart draws the base's top line there, labelled "Buy point". One price, one authority. draw_base.pivot is
untouched: it still selects the ceiling bars (`ceiling_bar`) and is what a row without textbook numbers draws.

Which high is the buy point (the textbook pivot placement: a consolidation, flat base or cup without a handle
pivots on its left-side high; anything with a handle on the handle peak):
    bc:base             the base's highest high (a consolidation pivots on its left-side high; when the
                        drawn base sits under a higher left-side high it is the right side / handle of that
                        larger correction, and its own high is the handle peak)
    bc:flat-base        the highest high over the drawn pivot span
    bc:cup-with-handle  the handle's highest high when the row carries a handle, else the rim (left-side) high
The as-of bar itself is never part of the base (it may be the breakout bar).

ONLY A CEILING BAR'S HIGH (`ceiling_bar`, `pivot_high`). The drawing's top is a line on the candle BODIES, and
wicks may poke through it. A high counts toward the buy point only when its bar is part of that ceiling: the
bar's body top within base_draw.TOUCH ATR under the drawn pivot (the bars the drawing itself counts as touches)
AND its high no more than SPIKE_MAX_ATR ATR over the drawn pivot. A long wick on a bar whose body sits down in
the base, or a wick far over every body, is a spike through the base, not its top. (PLSE as of 2026-10-22: the
drawn pivot 55.20, ATR 3.47; one session's wick to 58.90 from a body topping at 52.97 printed "Buy point 59.00",
over every other price in the base. The ceiling bars top out at 57.94: buy point 58.04.) The base high (depth)
leaves out the same rejected bars. GUARD (`buy_point_justified`): the printed buy point must be a ceiling bar's
high inside the pivot window + $0.10; when it is not, or the drawn pivot / ATR cannot be read, or no bar of the
window is a ceiling bar, the textbook numbers are WITHHELD (None) and the chart keeps the old confirmed label.

TOO SHALLOW: when base_metrics.too_shallow says the base is too shallow to label (under 3% deep, or a range
under 1.5 ATR), the textbook numbers are withheld too (the old label withholds on the same predicate).

STAGE (base count). Every base type counts, because the walk below is shape-agnostic: from the start of the
series, a stretch from a running high to the next bar that clears it is a BASE when it lasts at least five
weeks (PRIOR_BASE_MIN_BARS) and corrects at least PRIOR_BASE_MIN_DEPTH; it RESETS the count when it corrects
more than BASE_MAX_DEPTH or lasts more than BASE_MAX_BARS (a decline, not a base). Then, base by base:
    the first base after a reset (or after the listing, when the series is the full history) is stage 1;
    a base whose low undercuts the prior base's low (any bar since the prior breakout) is stage 1;
    a base forming ABOVE the prior buy point after a gain of 20% or more from the prior buy point to its
        left-side high is the next stage;
    anything else is a base-on-base: the same stage.
The count is printed only when the walk is ANCHORED (a reset, an undercut, or the listing inside the
series); a chain that runs off the start of the history without one is unknown and prints nothing.
Approximation, stated: a prior base's buy point is taken as its left-side high + $0.10, which for a prior
cup with a handle is a little above the textbook handle pivot (it can only hold a count back, never add one).

VOLUME. Only on a COMPLETED as-of session (never a forming bar): the as-of volume against the average of the
50 sessions before it. When the as-of close is at or above the buy point, the readout is the breakout volume,
and a breakout under BREAKOUT_VOLUME_MIN_PCT (40% above average, the IBD deck's minimum) is marked light.
Below the buy point it is shown only when notable (at least NOTABLE_VOLUME_PCT above or below average).

NO LOOKAHEAD: every number reads only bars with t <= the row's as-of bar. Pure functions except for the
`asof_complete` callable the caller passes. Never raises.
"""
from __future__ import annotations

from typing import Callable, Optional

from api.services import base_metrics

#: Stamped on every row this computes as `extras.metrics_textbook_round`. A member sees the textbook numbers
#: only while auto_structures.MEMBER_TEXTBOOK_ROUND (a literal, set by hand after a blind check) equals it.
TEXTBOOK_ROUND = 2

#: The IBD convention: the buy point is the pivot high plus ten cents.
BUY_POINT_TICK = 0.10
#: Breakout volume at least this % above the 50-day average (the IBD-style minimum; some texts ask 50%).
BREAKOUT_VOLUME_MIN_PCT = 40.0
#: Below the buy point, a volume this far from average (either way) is notable enough to print.
NOTABLE_VOLUME_PCT = 40.0
#: The average volume window.
VOLUME_AVG_BARS = 50
#: Above the buy zone (buy point + 5%) the label says "extended".
EXTENDED_PCT = 5.0
#: A ceiling bar's high may stand at most this many ATR(14) over the drawn pivot; a higher wick is a spike.
#: On the 30 judged charts of 2026-10-22 the ceiling bars' highest high sat 0.0-1.05 ATR over the drawn pivot on
#: 29; the 30th (one session's wick) 2.86 ATR over it.
SPIKE_MAX_ATR = 1.5

# -- the stage walk --
#: A prior base lasts at least five weeks (the shortest textbook base, the flat base) ...
PRIOR_BASE_MIN_BARS = 25
#: ... and corrects at least this much (ours: a smaller wiggle is a pause in the advance, not a base).
PRIOR_BASE_MIN_DEPTH = 0.08
#: A correction deeper than this is a decline: the count resets (the bc:base drawing's own ceiling).
BASE_MAX_DEPTH = 0.50
#: A stretch longer than this (65 weeks, the longest textbook cup) is not a base: the count resets.
BASE_MAX_BARS = 325
#: The gain from the prior buy point to the new left-side high that opens a new stage.
NEW_STAGE_GAIN = 0.20


def _num(v) -> Optional[float]:
    return base_metrics._num(v)


def _int(v) -> Optional[int]:
    return base_metrics._int(v)


def buy_point(base_high) -> Optional[float]:
    """base_high + $0.10, rounded to cents; None unless base_high is a positive finite number."""
    h = _num(base_high)
    if h is None or h <= 0:
        return None
    return round(h + BUY_POINT_TICK, 2)


# ================================================================ the base span

def _spans(row, asof: int):
    """(span_start_t, pivot_start_t, pivot_end_t) for the row: the whole drawn base (depth, length, stage)
    and the part whose highest high is the buy point. None when the row draws no base."""
    pid = (row or {}).get("pattern_id")
    ex = ((row or {}).get("geometry") or {}).get("extras") or {}
    if pid == "bc:base":
        bd = ex.get("draw_base")
        if not isinstance(bd, dict):
            return None
        return bd.get("start_t"), bd.get("start_t"), asof
    pv = ex.get("draw_pivot")
    if not isinstance(pv, dict):
        return None
    if pid == "bc:cup-with-handle":
        rim = ex.get("draw_rim_ref") if isinstance(ex.get("draw_rim_ref"), dict) else pv
        h = ex.get("draw_handle")
        if isinstance(h, dict) and _int(h.get("start_t")) is not None and _int(h.get("end_t")) is not None:
            return rim.get("start_t"), h.get("start_t"), h.get("end_t")
        return rim.get("start_t"), rim.get("start_t"), asof
    return pv.get("start_t"), pv.get("start_t"), pv.get("end_t")


def _hi(b) -> float:
    return float(b["h"])


def _lo(b) -> float:
    return float(b["l"])


def ceiling_bar(x, pivot: float, atr: float) -> bool:
    """True when bar `x` is part of the drawn base's ceiling: its body top within base_draw.TOUCH ATR under the
    drawn `pivot` and its high no more than SPIKE_MAX_ATR ATR over it. Only such a bar's high is a pivot high."""
    from api.services.pattern_engine import base_draw
    return base_draw._bt(x) >= pivot - base_draw.TOUCH * atr and _hi(x) <= pivot + SPIKE_MAX_ATR * atr


def pivot_high(window, pivot: float, atr: float) -> Optional[float]:
    """The highest high of the ceiling bars of `window` (the bars the buy point is read from), or None."""
    hs = [_hi(x) for x in window if ceiling_bar(x, pivot, atr)]
    return max(hs) if hs else None


def buy_point_justified(window, bp, pivot: float, atr: float) -> bool:
    """THE GUARD on the printed number: `bp` is the high of a ceiling bar inside `window`, + $0.10."""
    return bp is not None and any(ceiling_bar(x, pivot, atr) and buy_point(_hi(x)) == bp for x in window)


# ================================================================ the stage walk

def _close_stretch(bars, s: int, j: int, high: float):
    """The stretch from the running high at bars[s] to bars[j] (the bar that cleared it): a base, a reset,
    or None (a pause in the advance)."""
    if j - s < 2:
        return None
    lows = [_lo(bars[m]) for m in range(s + 1, j)]
    low = min(lows)
    depth = (high - low) / high if high > 0 else 0.0
    if depth > BASE_MAX_DEPTH or j - s > BASE_MAX_BARS:
        return {"kind": "reset", "at": j}
    if j - s >= PRIOR_BASE_MIN_BARS and depth >= PRIOR_BASE_MIN_DEPTH:
        return {"kind": "base", "lh": high, "low": low, "start": s, "bo": j}
    return None


def _chain(bars, end: int):
    """Bases and resets in bars[:end], oldest first, plus the open stretch's running high and its index.

    A stretch whose drawdown passes BASE_MAX_DEPTH, or that runs past BASE_MAX_BARS, RESETS the count the
    moment it does (not when price finally clears the old high, which may be never). After a decline the
    running high follows each new low down (the next base starts from the bottom, not from the old peak)
    until price clears the high of the bar that made the low."""
    events = []
    if end < 1:
        return events, None, None
    high, hi_i = _hi(bars[0]), 0
    run_low = _lo(bars[0])
    decline = False
    for j in range(1, end):
        h, l = _hi(bars[j]), _lo(bars[j])
        if decline and l < run_low:
            high, hi_i, run_low = h, j, l          # still falling: the stretch restarts at the new low
            continue
        if h > high:
            ev = _close_stretch(bars, hi_i, j, high)
            if ev is not None:
                events.append(ev)
            high, hi_i, run_low, decline = h, j, l, False
            continue
        run_low = min(run_low, l)
        if (high - run_low) / high > BASE_MAX_DEPTH or j - hi_i > BASE_MAX_BARS:
            events.append({"kind": "reset", "at": j})
            high, hi_i, run_low, decline = h, j, l, True
    return events, high, hi_i


def _next_stage(stage, prev, base, seg_low):
    """The stage of `base` given the stage and record of the base before it (None = unknown)."""
    if prev is None:
        return 1 if stage == 0 else None
    if seg_low < prev["low"]:
        return 1                                    # an undercut of the prior base resets the count
    if stage is None:
        return None
    prior_bp = prev["lh"] + BUY_POINT_TICK
    if base["low"] > prior_bp and base["lh"] >= prior_bp * (1.0 + NEW_STAGE_GAIN):
        return stage + 1
    return stage                                    # base-on-base: one stage


def stage_count(bars, start_i: int, full_history: bool = False) -> Optional[int]:
    """The textbook stage of the base that spans bars[start_i : len(bars)-1] (the last bar is the as-of
    bar, not part of the base), or None when the count is not anchored or cannot be read. Never raises."""
    try:
        n = len(bars)
        asof_i = n - 1
        if not (0 <= start_i < asof_i):
            return None
        events, high, hi_i = _chain(bars, start_i)
        span_lows = [_lo(bars[m]) for m in range(start_i, asof_i)]
        span_high = max(_hi(bars[m]) for m in range(start_i, asof_i))
        if high is None or span_high >= high:
            # the drawn base reaches the running high: the stretch before it closes at its start
            if high is not None:
                ev = _close_stretch(bars, hi_i, start_i, high)
                if ev is not None:
                    events.append(ev)
            cur = {"lh": span_high, "low": min(span_lows), "start": start_i, "bo": asof_i}
        else:
            # the drawn base sits under a higher left-side high: the base is the whole correction from it
            low = min(_lo(bars[m]) for m in range(hi_i + 1, asof_i))
            if (high - low) / high > BASE_MAX_DEPTH or asof_i - hi_i > BASE_MAX_BARS:
                events.append({"kind": "reset", "at": start_i})
                cur = {"lh": span_high, "low": min(span_lows), "start": start_i, "bo": asof_i}
            else:
                cur = {"lh": high, "low": low, "start": hi_i, "bo": asof_i}
        stage = 0 if full_history else None
        prev = None
        for ev in events + [dict(cur, kind="base")]:
            if ev["kind"] == "reset":
                stage, prev = 0, None
                continue
            seg_from = prev["bo"] if prev is not None else 0
            seg = [_lo(bars[m]) for m in range(seg_from, ev["bo"])]
            seg_low = min(seg) if seg else ev["low"]
            stage = _next_stage(stage, prev, ev, seg_low)
            prev = ev
        return stage if type(stage) is int and stage >= 1 else None
    except (KeyError, TypeError, ValueError, ZeroDivisionError, IndexError):
        return None


# ================================================================ volume

def volume_readout(bars, buy_pt: float, asof_complete: bool) -> Optional[dict]:
    """{vol_pct, breakout, light} for the as-of bar (bars[-1]) against the average of the VOLUME_AVG_BARS
    sessions before it, or None: never on a forming (or unconfirmed) bar, never without a full average,
    and below the buy point only when notable. Never raises."""
    try:
        if not asof_complete or len(bars) < VOLUME_AVG_BARS + 1:
            return None
        prior = [_num(b.get("v")) for b in bars[-VOLUME_AVG_BARS - 1:-1]]
        v = _num(bars[-1].get("v"))
        if v is None or v < 0 or any(x is None or x < 0 for x in prior):
            return None
        avg = sum(prior) / len(prior)
        if avg <= 0:
            return None
        pct = int(round((v / avg - 1.0) * 100.0))
        c = _num(bars[-1].get("c"))
        if c is None:
            return None
        if c >= buy_pt:
            return {"vol_pct": pct, "breakout": True, "light": pct < BREAKOUT_VOLUME_MIN_PCT}
        if abs(pct) >= NOTABLE_VOLUME_PCT:
            return {"vol_pct": pct, "breakout": False, "light": False}
        return None
    except (KeyError, TypeError, ValueError, ZeroDivisionError, IndexError, AttributeError):
        return None


# ================================================================ the row

def compute(row, bars, *, asof_complete: Optional[Callable] = None, full_history: bool = False) -> Optional[dict]:
    """The textbook numbers for one base row from daily `bars` ({t,o,h,l,c,v}, oldest first), or None.

    `asof_complete(t) -> bool` answers whether the as-of session has closed (None, or a failing answer,
    means NOT complete: no volume). `full_history` says the series starts at the listing (the stage walk is
    then anchored at its first bar). Reads only bars up to the row's as-of bar. Never raises."""
    try:
        if (row or {}).get("pattern_id") not in base_metrics.METRIC_IDS:
            return None
        asof = base_metrics._asof_t(row)
        if asof is None:
            return None
        b = [x for x in bars or [] if _int(x.get("t")) is not None and _int(x.get("t")) <= asof]
        if len(b) < 3 or _int(b[-1].get("t")) != asof:
            return None
        spans = _spans(row, asof)
        if spans is None:
            return None
        s_t, p_s, p_e = (_int(v) for v in spans)
        if s_t is None or p_s is None or p_e is None:
            return None
        ts = [_int(x["t"]) for x in b]
        if s_t not in ts:
            return None
        start_i = ts.index(s_t)
        asof_i = len(b) - 1
        # the base's own bars end before its as-of bar; a breakout-state base (base_draw.breakout_drawing)
        # ends before base_end_t, the bar it was drawn at, so the bars since the breakout are never the base
        end_i = asof_i
        be = _int(((((row.get("geometry") or {}).get("extras") or {}).get("draw_base") or {})
                   .get("base_end_t")) if row.get("pattern_id") == "bc:base" else None)
        if be is not None:
            if be not in ts:
                return None
            end_i = ts.index(be)
        if start_i >= end_i:
            return None
        span = b[start_i:end_i]
        piv = [x for x in span if p_s <= _int(x["t"]) <= p_e]
        if not piv:
            return None
        # the window's geometry: the drawn pivot (the ceiling line) and ATR(14) at the as-of bar
        drawn = base_metrics._drawn(row)
        dpiv = _num(drawn[0]) if drawn else None
        atr = base_metrics.asof_atr(row, b)
        if dpiv is None or dpiv <= 0 or atr is None:
            return None
        plain = _plain_draw(row)
        tick = BUY_POINT_TICK
        if plain is not None and _plain_pivot_line(plain):
            # the PLAIN base, round 7 (base_draw.PLAIN_PIVOT_ROUND): its drawing already chose the buy line (the
            # base high, or the right-side ceiling when the high is a one-session spike) and the buy point IS that
            # line, with no +$0.10; the depth is still read from the base's own highest high
            ph = dpiv
            bp = round(ph, 2)
            tick = 0.0
            base_high = max(_hi(x) for x in span)
        elif plain is not None:
            # the PLAIN base (base_draw.plain_drawing, round 6): its geometry already chose the ceiling -- the
            # highest high of the base's own bars, the left-side high -- so the buy point is that high + $0.10 and
            # no ceiling-bar reselection runs (that reselection is what put the old line on a mid-base spike)
            ph = max(_hi(x) for x in span)
            bp = buy_point(ph)
            base_high = ph
        else:
            ph = pivot_high(piv, dpiv, atr)
            if ph is None:
                return None
            bp = buy_point(ph)
            if not buy_point_justified(piv, bp, dpiv, atr):
                return None                                 # the guard: withheld, the old label stays
            # the base high leaves out the window bars the pivot test rejected (a spike is not the base's top)
            rejected = {id(x) for x in piv if not ceiling_bar(x, dpiv, atr)}
            base_high = max(_hi(x) for x in span if id(x) not in rejected)
        base_low = min(_lo(x) for x in span)
        dp = base_metrics.depth_pct(base_high, base_low)
        if base_metrics.too_shallow(dp, (base_high - base_low) / atr):
            return None                                 # too shallow to label
        # the base's length is the base metrics' own count (one authority over one number)
        old = ((row.get("geometry") or {}).get("extras") or {}).get("metrics")
        weeks = _num(old.get("length_weeks")) if isinstance(old, dict) else None
        if weeks is None:
            weeks = base_metrics.length_weeks(b, s_t, _int(b[end_i]["t"]) if be is not None else asof)
        if bp is None or dp is None or weeks is None:
            return None
        bz = round(bp * (1.0 + _buy_zone()), 2)
        pfb = base_metrics.pct_from_pivot(b[-1].get("c"), bp)
        if pfb is None:
            return None
        out = {"buy_point": bp, "base_high": round(base_high, 4), "asof_t": asof, "depth_pct": dp,
               "length_weeks": weeks, "buy_zone_top": bz, "pct_from_buy_point": pfb,
               "extended": pfb > EXTENDED_PCT}
        if row.get("pattern_id") == "bc:base":
            out["line"] = round(bp - tick, 2)   # the drawn top line: one price with the buy point
        # a breakout-state base counts its stage on its OWN bars (the base drawn at base_end_t), not on the
        # bars since the breakout
        if plain is not None:
            # the plain base counts its own stage on the judged frame (base_draw.plain_stage), stamped on the drawing
            st = _int(plain.get("stage"))
            st = st if st is not None and st >= 1 else None
        else:
            st = stage_count(b[:end_i + 1] if be is not None else b, start_i, full_history=bool(full_history))
        if st is not None:
            out["stage"] = st
        complete = False
        if asof_complete is not None:
            try:
                complete = bool(asof_complete(asof))
            except Exception:  # noqa: BLE001 -- an unreadable clock is not a completed session
                complete = False
        vol = volume_readout(b, bp, complete)
        bo = _int(((((row.get("geometry") or {}).get("extras") or {}).get("draw_base") or {})
                   .get("breakout_t")) if row.get("pattern_id") == "bc:base" else None)
        if bo is not None and bo in ts:
            # a breakout-state base: the volume is the BREAKOUT session's (a closed session), not the as-of one
            # a breakout bar that IS the as-of bar keeps the as-of bar's own completeness answer
            vol = volume_readout(b[:ts.index(bo) + 1], bp, complete if bo == asof else True)
        if vol is not None and plain is not None and vol.get("breakout") is not True:
            vol = None          # the plain base prints volume only on its breakout session (a below-buy-point
            #                     volume line reads as a breakout that is not there)
        if vol is not None:
            out["volume"] = vol
        return out
    except Exception:  # noqa: BLE001 -- textbook numbers never break a row
        return None


def _plain_draw(row):
    """The draw_base of a PLAIN base row (bc:base drawn by base_draw.plain_drawing: it carries an int plain_round and
    no state), else None."""
    if (row or {}).get("pattern_id") != "bc:base":
        return None
    bd = (((row.get("geometry") or {}).get("extras") or {}).get("draw_base"))
    if not isinstance(bd, dict) or "state" in bd or type(bd.get("plain_round")) is not int:
        return None
    return bd


def _plain_pivot_line(plain) -> bool:
    """True for a plain base drawn by round 7 (base_draw.PLAIN_PIVOT_ROUND): its buy point is its drawn line, no
    +$0.10."""
    from api.services.pattern_engine import base_draw
    pr = plain.get("plain_round")
    return type(pr) is int and pr == base_draw.PLAIN_PIVOT_ROUND


def _buy_zone() -> float:
    from api.services.screener.base_catalog import IBD_BUY_ZONE
    return IBD_BUY_ZONE


def with_textbook(rows, bars, *, asof_complete: Optional[Callable] = None, full_history: bool = False) -> list:
    """`rows` with `extras.metrics_textbook` + `extras.metrics_textbook_round` on every row that already
    carries base metrics and computes here. Returns NEW row dicts for those rows (a cached row is never
    mutated); every other row is passed through as the same object. Order is kept. Never raises."""
    out = []
    for r in rows or []:
        ex = ((r or {}).get("geometry") or {}).get("extras") or {}
        m = None
        if isinstance(ex.get("metrics"), dict):
            m = compute(r, bars, asof_complete=asof_complete, full_history=full_history)
        if m is None:
            out.append(r)
            continue
        geo = r.get("geometry") or {}
        nex = {**ex, "metrics_textbook": m, "metrics_textbook_round": TEXTBOOK_ROUND}
        out.append({**r, "geometry": {**geo, "extras": nex}})
    return out
