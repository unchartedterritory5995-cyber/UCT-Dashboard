"""UCT Signature: Dark-Pool Reclaim Confluence (dpc-v1). Daily timeframe.

The thesis: a dark-pool level is a level of institutional interest. When price
RECLAIMS that level on a daily close and HOLDS above it, WITH confirming call
flow, that's a high-confluence long — best on names showing BOTH unusual dark
pools and unusual flow. The mirror: price LOSES the level on a daily close +
holds below + put flow = short. Only fires when price is within a proximity
band of the level (a fresh reclaim, not an extended runaway).

Pure/testable: all I/O (dark-pool levels, daily bars, flow join) is the router's
job. This module just composes the three, exactly like flow_breakout.fcb_signals
composes bars + a flow join.

Bars are the closed-bar dicts {t,o,h,l,c,v} that signature._fetch_bars yields
(ascending by time). `by_date` is the {iso_date: [flow rows]} map from
flow_breakout.flow_by_date. `levels` are darkpool_levels.cluster_levels output
({price, lo, hi, notional, rank, printCount, lastDate}).
"""
from __future__ import annotations

import math

from api.services.signature import rules
from api.services.signature.flow_breakout import _bar_date_iso, flow_confirms


def _trailing_hold(bars, ok) -> int:
    """Count of consecutive MOST-RECENT closes for which ok(close) is True."""
    n = 0
    for b in reversed(bars):
        if ok(b["c"]):
            n += 1
        else:
            break
    return n


def _signal(direction, lv, close, dist_pct, hold, conf):
    prem = conf["callPrem"] if direction == "bull" else conf["putPrem"]
    # Rank by dark-pool conviction (notional $) × dominant flow ($, log-compressed
    # so one giant print doesn't swamp everything) × a small hold bonus.
    score = round((lv["notional"] / 1e6) * math.log1p(prem / 1e6) * (1.0 + 0.2 * hold), 1)
    return {
        "direction": direction,
        "close": round(close, 2),
        "level": round(lv["price"], 2),
        "lo": round(lv["lo"], 2), "hi": round(lv["hi"], 2),
        "notional": round(lv["notional"]),
        "rank": lv.get("rank"), "printCount": lv.get("printCount"),
        "lastDate": lv.get("lastDate"),
        "pctFromLevel": dist_pct, "holdDays": hold,
        "callPrem": round(conf["callPrem"]), "putPrem": round(conf["putPrem"]),
        "score": score,
        "version": rules.VERSIONS["dpc"],
    }


def evaluate(levels, bars, by_date, *, lookback=None, prox_pct=None,
             hold_min=None, flow_window=None):
    """Return the confluence signals over these dark-pool levels + daily bars +
    flow join, ranked by score (best first). Empty when nothing lines up."""
    lookback = rules.DPC_LOOKBACK if lookback is None else lookback
    prox_pct = rules.DPC_PROX_PCT if prox_pct is None else prox_pct
    hold_min = rules.DPC_HOLD_MIN if hold_min is None else hold_min
    flow_window = rules.DPC_FLOW_WINDOW if flow_window is None else flow_window

    if not levels or not bars:
        return []
    close = bars[-1]["c"]
    if not (close > 0):
        return []

    # Flow over the last `flow_window` closed sessions (union), for the
    # call/put dominance test. by_date keyed by the SAME ISO the bar side uses.
    recent_isos = {_bar_date_iso(b["t"]) for b in bars[-flow_window:]}
    recent_rows = [r for iso in recent_isos for r in (by_date.get(iso) or [])]

    # Closes to look back over for "was on the other side of the zone" — excludes
    # the latest bar (that's "now"). A genuine reclaim came FROM below the zone.
    win = bars[-(lookback + 1):-1] if len(bars) > 1 else []

    out = []
    for lv in levels:
        lo, hi, price = lv["lo"], lv["hi"], lv["price"]
        if not (price > 0):
            continue
        near = abs(close - price) <= prox_pct * price
        if not near:
            continue
        dist_pct = round((close - price) / price * 100, 1)

        if close > hi:                                  # reclaimed above the zone
            if any(b["c"] < lo for b in win):           # was below it recently
                hold = _trailing_hold(bars, lambda c: c > hi)
                if hold >= hold_min:
                    conf = flow_confirms(recent_rows, "bull")
                    if conf["confirmed"]:
                        out.append(_signal("bull", lv, close, dist_pct, hold, conf))
        elif close < lo:                                # lost the zone
            if any(b["c"] > hi for b in win):           # was above it recently
                hold = _trailing_hold(bars, lambda c: c < lo)
                if hold >= hold_min:
                    conf = flow_confirms(recent_rows, "bear")
                    if conf["confirmed"]:
                        out.append(_signal("bear", lv, close, dist_pct, hold, conf))

    out.sort(key=lambda s: s["score"], reverse=True)
    return out
