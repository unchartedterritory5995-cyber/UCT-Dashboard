"""UCT High-Volume-Edge bar detector — pattern_id `uct_hve`.

A high-volume-edge (HVE) bar is a session whose volume is the highest of the
prior N sessions, N = min(252, available prior bars) and at least 190
(`U.HVE_DETECTOR_MIN_PRIOR`). Production's daily scan passes 200 bars, so N is
199 there; the narrative and geometry.extras.lookback_sessions state the N used. Its close — the high-volume close (HVC) — is
a level where the largest participants of that period committed, and traders
watch it as support/resistance for weeks afterwards.

Fires (the bar itself, on a recent session):
  volume > the maximum volume of the prior N sessions            [trader rule: N=252]
  close > 3                                                      [trader rule]
  at least 190 prior sessions exist (fewer is not enough history to call a record)

Labels only (geometry.extras):
  26-week variant: volume >= the prior 130 sessions' max, > 250K shares, up
                   close (a second trader's scan)
  hve_252 (only when >= 252 prior sessions exist), highest volume in all
  available data,
  high close (DCR >= 0.70), up/down day.

Direction follows the bar: an up close (close > prior close) is bullish with the
stop at the bar's low; a down close is bearish with the stop at the bar's high.
Entry is the HVC. The later trades OFF the level (day-2 open above, undercut and
reclaim, hold/test) are not separate detections here.
"""
from __future__ import annotations

from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.liquidity import liquidity_floor


_PATTERN_ID = "uct_hve"
_PATTERN_NAME = "UCT High-Volume Edge"
_MIN_BARS = U.HVE_DETECTOR_MIN_PRIOR + 1


def evaluate(bars: list, S: dict, i: int) -> Optional[dict]:
    if not U.valid_bar(bars[i]) or not U.valid_bar(bars[i - 1]):
        return None
    hb = U.hve_bar(bars, S, i)
    if hb is None or not hb["a1_252"] or hb["lookback"] < U.HVE_DETECTOR_MIN_PRIOR:
        return None
    direction = "bullish" if hb["up_day"] else "bearish"
    v50 = S["v50"][i]
    labels = [n for n, f in (("hve_252", hb["full_252_history"]),
                             ("hve_26wk", hb["a26_26wk"]),
                             ("ever_in_data", hb["ever_in_data"]),
                             ("high_close", hb["high_close"])) if f]
    b = bars[i]
    return {
        **hb, "variant": f"hve_{hb['lookback']}", "label_variants": labels, "direction": direction,
        "rvol50": round(S["v"][i] / v50, 2) if v50 else None,
        "edge_ratio": round(S["v"][i] / hb["prior_max_volume"], 2) if hb["prior_max_volume"] else None,
        "trigger": b["c"], "stop": b["l"] if direction == "bullish" else b["h"],
        "close": b["c"], "low": b["l"], "high": b["h"],
    }


def _geometry_score(c: dict) -> float:
    g = 70.0
    g += 10.0 if c["high_close"] or (c["direction"] == "bearish" and c["dcr"] <= 0.30) else 0.0
    g += 10.0 if c["ever_in_data"] else 0.0
    g += 5.0 if c["full_252_history"] else 0.0
    g += 5.0 if c["a26_26wk"] else 0.0
    return round(min(100.0, g), 2)


def detect_uct_hve(bars: List[dict], context: dict) -> List[dict]:
    if len(bars) < _MIN_BARS or not liquidity_floor(bars).passes:
        return []
    S = U.series(bars)
    n = len(bars)
    for off in range(U.MAX_TRIGGER_AGE):
        i = n - 1 - off
        if i < _MIN_BARS - 1:
            break
        cand = evaluate(bars, S, i)
        if cand is None or U.stopped_out_since(bars, i, cand["stop"], cand["direction"]):
            continue
        geom = _geometry_score(cand)
        vol = U.volume_score(cand["rvol50"])
        ctx = U.context_score(context, cand["direction"])
        if U.confidence(geom, vol, ctx) < U.CONFIDENCE_FLOOR:
            continue
        return [_build(bars, cand, context, geom, vol, ctx)]
    return []


def _build(bars, c, context, geom, vol, ctx) -> dict:
    i = c["idx"]
    d = c["direction"]
    levels = U.make_levels(
        c["trigger"], c["stop"], d,
        entry_condition=(f"hold above the high-volume close {c['trigger']:.2f}" if d == "bullish"
                         else f"stay below the high-volume close {c['trigger']:.2f}"),
        stop_basis="hve_bar_low" if d == "bullish" else "hve_bar_high")
    anchors = [{"t": int(bars[i]["t"]), "price": float(c["close"])}]
    extras = {
        "variant": c["variant"], "label_variants": c["label_variants"],
        "hvc": round(c["hvc"], 2), "hve_low": round(c["hvl"], 2), "hve_high": round(c["hvh"], 2),
        "lookback_sessions": c["lookback"],
        "hve_26wk": c["a26_26wk"], "full_252_history": c["full_252_history"],
        "ever_in_data": c["ever_in_data"], "bar_dcr": c["dcr"], "high_close": c["high_close"],
        "up_day": c["up_day"], "rvol50": c["rvol50"], "edge_ratio_vs_prior_max": c["edge_ratio"],
    }
    # The level runs to the newest bar the detector read: it already checked
    # every later bar (stopped_out_since) to report the setup as intact.
    secondary = [U.hline(bars, i, len(bars) - 1, c["hvc"], "hve_close",
                         f"HVE close {c['hvc']:.2f}")]
    return U.build_detection(
        pattern_id=_PATTERN_ID, pattern_name=_PATTERN_NAME, direction=d,
        bars=bars, trig_idx=i, start_idx=i, anchors=anchors,
        anchor_roles=["high_volume_close"], extras=extras, levels=levels,
        context=context, narrative=_narrative(c, levels, context),
        geom=geom, vol=vol, ctx=ctx, secondary=secondary)


def _narrative(c, levels, context) -> dict:
    d = c["direction"]
    labels = ", ".join(c["label_variants"]) or "none"
    rv = f"{c['rvol50']:.1f}x" if c["rvol50"] is not None else "an unmeasured multiple of"
    er = f"{c['edge_ratio']:.2f}x" if c["edge_ratio"] is not None else "above"
    side = "support" if d == "bullish" else "resistance"
    headline = (
        f"UCT High-Volume Edge - the highest volume in the last {c['lookback']} sessions "
        f"({er} the prior max, "
        f"{rv} the 50-day average) on a {'up' if d == 'bullish' else 'down'} close at "
        f"${c['hvc']:.2f}; that close is now a {side} level."
    )
    what_it_is = (
        f"A high-volume-edge bar is a session whose volume beats every session in a long lookback; "
        f"here that lookback is the last {c['lookback']} sessions of daily data on file. "
        f"This one traded {er} the largest volume of those {c['lookback']} sessions and closed at "
        f"${c['hvc']:.2f}, with a range from ${c['hvl']:.2f} to ${c['hvh']:.2f}. Volume that large "
        f"means the biggest participants of that period were active on one day, and the close they "
        f"left behind - the high-volume close - becomes a reference level: buyers who paid it "
        f"tend to defend it, and a stock that later reclaims it from below often moves quickly. "
        f"The rule requires a close above $3 so thin, low-priced issues do not qualify. A second "
        f"scan's 26-week reading, and the full 252-session reading when that much history exists, are carried as labels; labels present on this session: {labels}. "
        f"{U.PROVENANCE_NOTE}"
    )
    why_it_matters = (
        f"The bar closed with a DCR of {c['dcr']:.2f}"
        f"{' - in the top 30% of its range' if c['high_close'] else ''} on a "
        f"{'higher' if c['up_day'] else 'lower'} close than the prior session, in "
        f"{U.context_phrase(context)}. "
        f"{'It is also the highest volume in all the data on file. ' if c['ever_in_data'] else ''}"
        f"An up-close edge bar after a base often marks the start of institutional accumulation, "
        f"and the edge close tends to act as {side} for weeks; a down-close edge bar marks heavy "
        f"distribution and the close tends to cap rallies. Traders watch several follow-up events "
        f"off the level within roughly 25 sessions: a next-day open above the close, an undercut "
        f"of the close that is reclaimed the same day, a reclaim from below, and a pullback that "
        f"tests and holds it - each a lower-risk entry than chasing the edge day itself. The level stays "
        f"relevant long after the window closes, so it is worth marking on the chart now."
    )
    what_to_watch_for = (
        f"The level to watch is the high-volume close at ${levels['entry']:.2f}. "
        + (f"For the bullish read, the stock should hold above it on the next sessions; a dip "
           f"that undercuts it by no more than about half an ATR and closes back above is a "
           f"classic entry, as is a pullback of three or more sessions that tests the level and "
           f"holds. " if d == "bullish" else
           f"For the bearish read, rallies back toward the level should fail beneath it; a "
           f"reclaim and hold above it would neutralise the distribution signal. ")
        + f"The stop for a position taken on the edge day is the bar's "
          f"{'low' if d == 'bullish' else 'high'} at ${levels['stop']:.2f}; targets in R are "
          f"${levels['target_primary']:.2f} (2R) and ${levels['target_secondary']:.2f} (3R). "
          f"A bar with this much volume rarely stays irrelevant: either price respects the close "
          f"and trends away from it, or it slices through and the level flips to the other side. "
          f"Record the level now: the high-volume close of ${c['hvc']:.2f} and the bar's range of "
          f"${c['hvl']:.2f} to ${c['hvh']:.2f} are the reference points for every later test, and "
          f"the first return to them, often weeks later, is usually the cleanest decision point."
    )
    failure_signal = (
        f"The level fails when price trades through the edge bar's "
        f"{'low' if d == 'bullish' else 'high'} at ${levels['stop']:.2f}: the participants who "
        f"made the volume are then offside, and their exit tends to accelerate the move against "
        f"the setup. A softer warning is repeated closes on the wrong side of the high-volume "
        f"close of ${c['hvc']:.2f} without a reclaim. Edge bars driven by an acquisition "
        f"announcement - after which the stock pins in a tiny range near the deal price - are "
        f"not trading signals at all and should be ignored. Size so the stop is a routine loss, "
        f"never widen it, and remember that the level remains useful for months even after a "
        f"failed first test: the next test from the other side is information, not a repeat. Treat the edge bar "
        f"as a map of where the large participants stand, and let price tell you which side holds."
    )
    return {"headline": headline, "what_it_is": what_it_is, "why_it_matters": why_it_matters,
            "what_to_watch_for": what_to_watch_for, "failure_signal": failure_signal}


register(_PATTERN_ID, detect_uct_hve)
