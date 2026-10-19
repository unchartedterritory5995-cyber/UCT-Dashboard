"""UCT Flat-Top Breakout ftb4 detector - pattern_id `uct_flat_top_breakout_ftb4`. INTERNAL (admin-only).

A recall variant of `uct_flat_top_breakout` (the offline lab's recall v4 rule
`ftb4`). It fires everywhere `uct_flat_top_breakout` fires, with the same rule
(ceiling window L = 40), and ALSO on a second, gated point the base rule
misses: the same frozen flat-top decision at a ceiling window of L = 25 or
L = 60 sessions, but only when the ceiling is mature, not nested inside a
larger base, and the 200 SMA is rising. `uct_flat_top_breakout` itself is
unchanged.

The rule at session i (uses bars[:i+1] only). ATR = 14-session simple average
true range; s50 / s200 simple averages.
  BASE  uct_flat_top_breakout's rule at L = 40 (tol 0.5, depth 0.35, near 1.0,
        trend c>s50>s200).
  NEW   (only when BASE does not fire; L tried in the order 25, then 60)
        the same decision at window L (ceiling H_L = highest high of the L
          sessions before i; touches within 0.5 ATR; >= 2 groups; first touch
          >= 10 sessions back; depth <= 0.35; -1.0 <= pos <= 2.0 ATR)
        the ceiling is mature: its first touch >= 15 sessions before i
        not nested: the highest high of the 120 sessions before i <= H_L + 0.5 ATR
        the 200 SMA is rising: s200[i] > s200[i-20]
  `extras.ftb4_branch` says which branch fired, `extras.base_window` its L.

Lab evidence (recall v4, pre-registered before its test half ran): TEST recall
27.0% against the base rule's 23.0% (paired gain +3.9 points, 95% CI +1.8 to
+6.5) at a random-day fire share of 5.74% (enrichment 4.7x). Two blind packets
of 25 fires: 12 / 15 and 13 / 15 of decided judged yes. NEW-branch fires alone
in a separate pre-registered confirmation (recall_v4_ftb4,
two fresh packets of 25 new-only fires): 13 / 16 and 15 / 16 of decided, pooled
28 / 32 (87.5%); all 20 decoys judged no. The L = 25 point is the weaker one
(6 / 10 of decided; the 60-session point 22 / 22). Small
samples; experimental.

Wrapper (shared with the other UCT trader-setup detectors, not part of the lab
rule): the liquidity floor, the newest of the last `MAX_TRIGGER_AGE` sessions
that qualifies, and a prior-session trigger is reported only while no later
session has traded through its stop.

History depth: the NEW branch reads the 200 SMA 20 sessions back, so it needs
220 bars at the marked session; the detector declares 222 (the two prior
trigger sessions too). With less history only the base branch can fire (as in
the lab, where s200[i-20] does not exist). Every input is a windowed average
or extreme, so the declared slice reproduces the lab's full-history values.
"""
from __future__ import annotations

from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.detectors.uct import uct_flat_top_breakout as FT
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.liquidity import liquidity_floor


_PATTERN_ID = "uct_flat_top_breakout_ftb4"
_PATTERN_NAME = "UCT Flat-Top Breakout (recall v4)"

# Lab constants (recall_v4/v4_rules.py). Do not tune here; the parity test
# pins them to the lab.
NEW_LENS = (25, 60)         # added ceiling windows, tried in this order
NEW_GROUPS = 2              # >= 2 touch groups within FT_TOL_ATR of the ceiling
NEW_AGE = 15                # first touch >= 15 sessions before session i
NEST_LB = 120               # "larger base" lookback, sessions before session i
NEST_ATR = 0.5              # the 120-session high may exceed the ceiling by <= 0.5 ATR
S200_LAG = 20               # the 200 SMA is rising when s200[i] > s200[i-20]

_MIN_BARS = FT._MIN_BARS
#: History declared to the scan: the 200 SMA 20 sessions back on the newest
#: session and on the two prior sessions the wrapper may report.
MIN_BARS = 199 + S200_LAG + 1 + U.MAX_TRIGGER_AGE - 1


def features_at(bars: list, S: dict, i: int, L: int) -> Optional[dict]:
    """The lab's feats_flat_top_breakout row for window L at tol FT_TOL_ATR."""
    a = S["atr"][i]
    lo = i - L
    if lo < 0:
        return None
    H = max(x["h"] for x in bars[lo:i])
    if H <= 0:
        return None
    depth = (H - min(x["l"] for x in bars[lo:i])) / H
    idx = [j for j in range(lo, i) if bars[j]["h"] >= H - FT.FT_TOL_ATR * a]
    groups, last = 0, -99
    for j in idx:
        if j - last >= FT.FT_GAP:
            groups += 1
        last = j
    return {"s50_gt_s200": S["s200"][i] is not None and S["s50"][i] > S["s200"][i],
            "depth": depth, "groups": groups, "age": i - idx[0], "pos": (bars[i]["c"] - H) / a,
            "ceiling": H, "first_touch_idx": idx[0], "touch_idx": idx}


def _s200_rising(S: dict, i: int) -> bool:
    m = S["s200"]
    return (i - S200_LAG >= 0 and m[i] is not None and m[i - S200_LAG] is not None
            and m[i] > m[i - S200_LAG])


def _new_ok(bars: list, S: dict, i: int, f: dict) -> bool:
    if f["groups"] < NEW_GROUPS or f["age"] < NEW_AGE:
        return False
    nest = max(x["h"] for x in bars[i - NEST_LB:i])
    return nest <= f["ceiling"] + NEST_ATR * S["atr"][i]


def evaluate(bars: list, S: dict, i: int) -> Optional[dict]:
    """The lab rule ftb4 at session i. Returns a candidate dict or None."""
    f40 = FT.features(bars, S, i)
    if f40 is None:
        return None
    v = FT.decide(f40)
    if v is not None:
        f, L, new = f40, FT.FT_L, False
    else:
        if i - NEST_LB < 0 or not _s200_rising(S, i):
            return None
        for L in NEW_LENS:
            f = features_at(bars, S, i, L)
            if f is None:
                continue
            v = FT.decide(f)
            if v is not None and _new_ok(bars, S, i, f):
                break
        else:
            return None
        new = True
    b = bars[i]
    H = f["ceiling"]
    v50 = S["v50"][i]
    return {
        "idx": i, "variant": v, "new": new, "L": L, "facts": f,
        "ceiling": H, "first_touch_idx": f["first_touch_idx"],
        "touch_groups": f["groups"], "base_depth": round(f["depth"], 4),
        "pos_atr": round(f["pos"], 2), "close": b["c"], "low": b["l"],
        "s50": S["s50"][i], "s200": S["s200"][i],
        "rvol50": round(S["v"][i] / v50, 2) if v50 else None,
        "trigger": H if v == "at_line" else b["c"], "stop": b["l"],
    }


def lab_facts(c: dict) -> dict:
    """The candidate in the lab's own result shape (v4_rules.ftb4)."""
    return {"variant": c["variant"], "L": c["L"], "new": c["new"]}


def _geometry_score(c: dict) -> float:
    g = 70.0
    g += 10.0 if c["variant"] == "breakout" else 0.0
    g += min(10.0, 5.0 * (c["touch_groups"] - 2))
    g += 5.0 if c["base_depth"] <= 0.20 else 0.0
    return round(min(100.0, g), 2)


def detect_uct_flat_top_breakout_ftb4(bars: List[dict], context: dict) -> List[dict]:
    if len(bars) < _MIN_BARS or not liquidity_floor(bars).passes:
        return []
    context = context or {}
    S = U.series(bars)
    n = len(bars)
    for off in range(U.MAX_TRIGGER_AGE):
        cand = evaluate(bars, S, n - 1 - off)
        if cand is None or U.stopped_out_since(bars, cand["idx"], cand["stop"]):
            continue
        geom = _geometry_score(cand)
        vol = U.volume_score(cand["rvol50"])
        ctx = U.context_score(context, "bullish")
        if U.confidence(geom, vol, ctx) < U.CONFIDENCE_FLOOR:
            continue
        return [_build(bars, cand, context, geom, vol, ctx)]
    return []


def _build(bars, c, context, geom, vol, ctx) -> dict:
    i, k0 = c["idx"], c["first_touch_idx"]
    H, low = float(c["ceiling"]), float(c["stop"])
    at_line = c["variant"] == "at_line"
    levels = U.make_levels(
        c["trigger"], low, "bullish",
        entry_condition=(f"break above the flat ceiling ({H:.2f})" if at_line
                         else f"hold above the flat ceiling ({H:.2f}), broken this session"),
        stop_basis="below_marked_session_low")
    levels["pivot"] = round(H, 2)
    anchors = [{"t": int(bars[k0]["t"]), "price": H},
               {"t": int(bars[i]["t"]), "price": low}]
    secondary = [U.hline(bars, k0, i, H, "ceiling", f"Flat ceiling {H:.2f}"),
                 U.hline(bars, k0, i, low, "stop", f"Session low {low:.2f}")]
    extras = {
        "variant": c["variant"], "fired_variants": [c["variant"]], "label_variants": [],
        "ftb4_branch": "new" if c["new"] else "base",
        "ceiling": round(H, 2), "touch_groups": c["touch_groups"],
        "first_touch_t": int(bars[k0]["t"]), "base_window": c["L"],
        "base_depth": c["base_depth"], "pos_atr": c["pos_atr"],
        "sma50": round(c["s50"], 2), "sma200": round(c["s200"], 2), "rvol50": c["rvol50"],
        "lab_rule": "recall_v4.ftb4",
    }
    return U.build_detection(
        pattern_id=_PATTERN_ID, pattern_name=_PATTERN_NAME, direction="bullish",
        bars=bars, trig_idx=i, start_idx=k0, anchors=anchors,
        anchor_roles=["ceiling", "session_low"], extras=extras,
        levels=levels, context=context, narrative=_narrative(c, levels, context),
        geom=geom, vol=vol, ctx=ctx, secondary=secondary)


def _narrative(c, levels, context) -> dict:
    H, L = c["ceiling"], c["L"]
    if c["variant"] == "breakout":
        where = f"closed {c['pos_atr']:.1f} ATR through it"
        watch = (f"Follow-through above the session high, and any retest holding the ceiling at "
                 f"${H:.2f}.")
    else:
        where = f"closed {abs(c['pos_atr']):.1f} ATR under it, pressing the line"
        watch = f"A close through the ceiling at ${H:.2f}."
    trend = ("the 50-day is above the 200-day" if not c["new"] else
             "the 50-day is above a rising 200-day, and no higher high sits in the prior 120 sessions")
    headline = (
        f"UCT Flat-Top Breakout (recall v4) - a {L}-session base under a flat ceiling at ${H:.2f}, "
        f"touched {c['touch_groups']} times; price {where}. Entry ${levels['entry']:.2f}, stop "
        f"${levels['stop']:.2f}."
    )
    what_it_is = (
        f"Over the last {L} sessions the highs kept stalling at the same level (${H:.2f}), in "
        f"{c['touch_groups']} separate touches, the first well before this session. The base is "
        f"{c['base_depth'] * 100:.0f}% deep, price is above its 50-day SMA and {trend}, so this is a "
        f"flat base inside an uptrend. {U.PROVENANCE_NOTE}"
    )
    why_it_matters = (
        f"A ceiling that has rejected price more than once collects the supply of everyone selling "
        f"there; a close through it says that supply is gone. The setup forms in "
        f"{U.context_phrase(context)}. This detector is experimental and admin-only: a wider "
        f"variant of the flat-top rule (25- and 60-session ceilings, gated), checked in blind "
        f"reviews on small samples."
    )
    what_to_watch_for = (
        f"{watch} Targets are in R from the stop: ${levels['target_primary']:.2f} (2R) and "
        f"${levels['target_secondary']:.2f} (3R)."
    )
    failure_signal = (
        f"A close back inside the base, under ${H:.2f}, after a break is the first warning; a trade "
        f"below ${levels['stop']:.2f} is the stop."
    )
    return {"headline": headline, "what_it_is": what_it_is, "why_it_matters": why_it_matters,
            "what_to_watch_for": what_to_watch_for, "failure_signal": failure_signal}


register(_PATTERN_ID, detect_uct_flat_top_breakout_ftb4, min_bars=MIN_BARS)
