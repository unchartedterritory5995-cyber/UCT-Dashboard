"""Base metrics -- MarketSurge-style numbers printed beside a base drawing (display only).

For the base drawings Auto Structures serves (bc:base, bc:flat-base, bc:cup-with-handle) this computes
`geometry.extras.metrics`:

    depth_pct       how deep the base is, top to low, in % of the top (1 decimal)
    length_weeks    trading bars of the drawn base span / 5 (1 decimal)
    stage           base_catalog.base_stage_count at the as-of bar -- an ESTIMATE (the client prints it as
                    "stage N (est.)"); omitted whenever the count is 0 / unreadable, never guessed
    buy_zone_top    pivot * (1 + base_catalog.IBD_BUY_ZONE)
    pct_from_pivot  (as-of close - pivot) / pivot * 100 (1 decimal)
    pivot, asof_t   the drawn pivot the numbers are measured from, and the as-of bar (YYYYMMDD)

NO LOOKAHEAD: every number reads only bars with t <= the row's as-of bar (bc:base: draw_base.end_t; a cup
carrying the cup tier stamp: cup_tier.asof_t; any other box: the row's own end_t, the last bar the box was
read from). Appending later bars never changes a metric (tests/test_base_metrics.py).

The pivot is the one the row DRAWS: draw_base.pivot for bc:base, draw_pivot.price otherwise (a member's cup
row carries the cup tier's pivot there). A row without a drawn pivot gets no metrics.

Depth:
    bc:base             (draw_base.pivot - draw_base.low) / draw_base.pivot
    bc:flat-base        (extras.top - extras.floor) / extras.top  (base_catalog's box numbers)
    bc:cup-with-handle  the cup detector's own depth (primitives.cup.cup_with_handle_state, re-read on the
                        bars up to the as-of bar); when it does not fire there, the cup sub-box (rim - low)/rim

TOO SHALLOW TO LABEL: a drawn base whose depth is under MIN_LABEL_DEPTH_PCT, or whose top-to-low range is
under MIN_LABEL_RANGE_ATR x ATR(14) at the as-of bar, gets NO metrics (`too_shallow`): a gap-then-flat range
that prints "0% deep" is not a base a number can describe. The textbook label (textbook_numbers) asks the same
predicate, so the old label and the new one withhold together. Only the LABEL is withheld; the drawing is not
this module's to change.

Pure functions; nothing here reads an env var, the database or the clock. Never raises.
"""
from __future__ import annotations

from typing import Optional

#: The metrics code's own round, stamped on every row it computes as `extras.metrics_round`. Members see
#: metrics only while auto_structures.MEMBER_METRICS_ROUND (a literal, set by hand after a blind packet)
#: equals this stamp.
METRICS_ROUND = 1

#: The base-drawing row ids that carry metrics.
METRIC_IDS = frozenset({"bc:base", "bc:flat-base", "bc:cup-with-handle"})

#: Trading days per week.
BARS_PER_WEEK = 5

#: The cup detector's working window (base_geometry.WORKING_BARS: the window the box was read on).
_CUP_WORKING_BARS = 400

#: A base shallower than this (%, top to low) is not labelled. The shallowest textbook base is the flat base,
#: about 10-15% deep; 3% is far under it and only catches a range that is not a base at all (measured on the
#: 30-chart judged sample of 2026-10-22: the shallowest real base was 5.5% deep, the one under 3% read "0%").
MIN_LABEL_DEPTH_PCT = 3.0
#: ... nor one whose top-to-low range is under this many ATR(14) at the as-of bar (the bc:base drawing's own
#: pullback floor, base_draw.MIN_DEPTH_ATR, restated as a label floor for every base row).
MIN_LABEL_RANGE_ATR = 1.5


def _num(v) -> Optional[float]:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if x != x or x in (float("inf"), float("-inf")):
        return None
    return x


def _int(v) -> Optional[int]:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def depth_pct(top, low) -> Optional[float]:
    """(top - low) / top * 100, rounded to 1 decimal; None unless 0 < low < top, all finite."""
    t, lo = _num(top), _num(low)
    if t is None or lo is None or not (t > lo > 0):
        return None
    return round((t - lo) / t * 100.0, 1)


def length_weeks(bars, start_t, end_t) -> Optional[float]:
    """Trading bars of `bars` with start_t <= t <= end_t, / BARS_PER_WEEK, rounded to 1 decimal."""
    s, e = _int(start_t), _int(end_t)
    if s is None or e is None or s > e:
        return None
    n = sum(1 for b in bars or [] if s <= _int(b.get("t")) <= e) if bars else 0
    if n <= 0:
        return None
    return round(n / BARS_PER_WEEK, 1)


def too_shallow(depth, range_atr) -> bool:
    """True when a base is too shallow to label: `depth` (%, as depth_pct gives it) missing or under
    MIN_LABEL_DEPTH_PCT, or `range_atr` (top-to-low range in ATR; None = not readable, not checked) under
    MIN_LABEL_RANGE_ATR. The ONE predicate both labels (old metrics, textbook numbers) ask."""
    d = _num(depth)
    if d is None or d < MIN_LABEL_DEPTH_PCT:
        return True
    r = _num(range_atr)
    return r is not None and r < MIN_LABEL_RANGE_ATR


def asof_atr(row, bars) -> Optional[float]:
    """ATR(14) at the as-of bar (the last of `bars`): the bc:base drawing's own `draw_base.atr` when it
    carries one, else base_draw's ATR over `bars` (the same computation the drawing reads). None if unreadable."""
    try:
        ex = ((row or {}).get("geometry") or {}).get("extras") or {}
        a = _num((ex.get("draw_base") or {}).get("atr")) if (row or {}).get("pattern_id") == "bc:base" else None
        if a is None:
            from api.services.pattern_engine import base_draw
            a = _num(base_draw._atr(list(bars), len(bars) - 1)) if bars and len(bars) >= 2 else None
        return a if a is not None and a > 0 else None
    except Exception:  # noqa: BLE001 -- an unreadable ATR is None, never a guess
        return None


def buy_zone_top(pivot) -> Optional[float]:
    from api.services.screener.base_catalog import IBD_BUY_ZONE
    p = _num(pivot)
    if p is None or p <= 0:
        return None
    return round(p * (1.0 + IBD_BUY_ZONE), 2)


def pct_from_pivot(close, pivot) -> Optional[float]:
    c, p = _num(close), _num(pivot)
    if c is None or p is None or p <= 0:
        return None
    return round((c - p) / p * 100.0, 1)


def stage_est(bars) -> Optional[int]:
    """base_catalog.base_stage_count on `bars`, or None when it is 0 (no qualifying stack) or fails."""
    try:
        from api.services.screener.base_catalog import base_stage_count
        n = base_stage_count(list(bars))
    except Exception:  # noqa: BLE001 -- an unreadable count is omitted, never guessed
        return None
    return n if type(n) is int and n >= 1 else None


def _asof_t(row) -> Optional[int]:
    pid = (row or {}).get("pattern_id")
    ex = ((row or {}).get("geometry") or {}).get("extras") or {}
    if pid == "bc:base":
        return _int((ex.get("draw_base") or {}).get("end_t"))
    ct = ex.get("cup_tier")
    if pid == "bc:cup-with-handle" and isinstance(ct, dict) and ct.get("asof_t") is not None:
        return _int(ct.get("asof_t"))
    return _int((row or {}).get("end_t"))


def _drawn(row):
    """(pivot price, span start_t, span end_t) the row draws, or None."""
    pid = (row or {}).get("pattern_id")
    ex = ((row or {}).get("geometry") or {}).get("extras") or {}
    if pid == "bc:base":
        bd = ex.get("draw_base")
        if not isinstance(bd, dict):
            return None
        # a breakout-state base (base_draw.breakout_drawing) ends at base_end_t; its end_t is the as-of bar
        end = bd.get("base_end_t") if bd.get("base_end_t") is not None else bd.get("end_t")
        return _num(bd.get("pivot")), bd.get("start_t"), end
    pv = ex.get("draw_pivot")
    if not isinstance(pv, dict):
        return None
    # a cup pivoting at the handle high keeps the rim as a reference: the base spans from the rim's lip
    span = ex.get("draw_rim_ref") if isinstance(ex.get("draw_rim_ref"), dict) else pv
    return _num(pv.get("price")), span.get("start_t"), span.get("end_t")


def _cup_depth(row, bars) -> Optional[float]:
    try:
        from api.services.pattern_engine.primitives import cup
        from api.services.screener.technicals import usable_bars
        st = cup.cup_with_handle_state(usable_bars(list(bars))[-_CUP_WORKING_BARS:])
        d = _num((st or {}).get("depth"))
        if d is not None and d > 0:
            return round(d * 100.0, 1)
    except Exception:  # noqa: BLE001 -- fall back to the box's own cup numbers
        pass
    ex = ((row or {}).get("geometry") or {}).get("extras") or {}
    subs = ex.get("sub_boxes") or []
    cup_box = subs[0] if len(subs) >= 2 and isinstance(subs[0], dict) else {"top": ex.get("top"),
                                                                            "floor": ex.get("floor")}
    return depth_pct(cup_box.get("top"), cup_box.get("floor"))


def compute(row, bars) -> Optional[dict]:
    """The metrics dict for one base row from daily `bars` ({t,o,h,l,c,v}, oldest first), or None.

    Reads only bars up to the row's as-of bar; a row whose as-of bar is not in `bars`, or that has no
    drawn pivot or no readable depth, gets None. Never raises."""
    try:
        pid = (row or {}).get("pattern_id")
        if pid not in METRIC_IDS:
            return None
        asof = _asof_t(row)
        if asof is None:
            return None
        b = [x for x in bars or [] if _int(x.get("t")) is not None and _int(x.get("t")) <= asof]
        if not b or _int(b[-1].get("t")) != asof:
            return None
        drawn = _drawn(row)
        if drawn is None:
            return None
        pivot, s, e = drawn
        if pivot is None or pivot <= 0:
            return None
        ex = (row.get("geometry") or {}).get("extras") or {}
        rng = None                                    # (top, low) the range in ATR is read from
        if pid == "bc:base":
            bd = ex.get("draw_base") or {}
            # a round-7 plain base draws its line under its high (`ceiling_high`); the depth is read from the high
            top = _num(bd.get("ceiling_high")) if bd.get("ceiling_high") is not None else pivot
            rng = (top, _num(bd.get("low")))
            dp = depth_pct(*rng)
        elif pid == "bc:flat-base":
            rng = (_num(ex.get("top")), _num(ex.get("floor")))
            dp = depth_pct(*rng)
        else:
            dp = _cup_depth(row, b)
        if dp is None:
            return None
        a = asof_atr(row, b)
        r_atr = (rng[0] - rng[1]) / a if rng and None not in rng and a else None
        if too_shallow(dp, r_atr):
            return None                               # too shallow to label: no metrics, the drawing stays
        end = asof if _int(e) is None else min(_int(e), asof)
        weeks = length_weeks(b, s, end)
        if weeks is None:
            return None
        bz = buy_zone_top(pivot)
        pfp = pct_from_pivot(b[-1].get("c"), pivot)
        if bz is None or pfp is None:
            return None
        out = {"pivot": round(pivot, 4), "asof_t": asof, "depth_pct": dp, "length_weeks": weeks,
               "buy_zone_top": bz, "pct_from_pivot": pfp}
        # a breakout-state base counts its stage on its own bars (through base_end_t), not the bars since
        state_base = pid == "bc:base" and (ex.get("draw_base") or {}).get("base_end_t") is not None
        stage = stage_est([x for x in b if _int(x.get("t")) <= end] if state_base else b)
        if stage is not None:
            out["stage"] = stage
        return out
    except Exception:  # noqa: BLE001 -- metrics never break a row
        return None


def with_metrics(rows, bars) -> list:
    """`rows` with `extras.metrics` and `extras.metrics_round` on every base row the metrics compute for.
    Returns NEW row dicts for those rows (a cached row is never mutated); every other row is passed
    through as the same object. Order is kept. Never raises."""
    out = []
    for r in rows or []:
        m = compute(r, bars) if (r or {}).get("pattern_id") in METRIC_IDS else None
        if m is None:
            out.append(r)
            continue
        geo = r.get("geometry") or {}
        ex = {**(geo.get("extras") or {}), "metrics": m, "metrics_round": METRICS_ROUND}
        out.append({**r, "geometry": {**geo, "extras": ex}})
    return out
