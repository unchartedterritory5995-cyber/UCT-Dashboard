"""UCT Launch Pad v4 detector - pattern_id `uct_launch_pad_v4`. INTERNAL (admin-only).

A launch pad is a session that closes just above a tight cluster of the 8 EMA,
21 EMA and 50 SMA: the three averages sit within 0.6 ATR of each other, the
close is above all three and no more than 1 ATR above the highest of them, and
the 200 SMA is not falling overhead.

This is a NEW detector; it changes no other detector. In particular it is NOT
`uct_launch_pad` (a different, earlier internal detector with its own rule,
untouched). It is a port of the offline lab's team-setup recognition rule
`launch_pad_v4` (team_rules_r6.feats/decide_launch_pad_v4, which reuses
team_rules_r2.launch_pad_v2 and team_rules.launch_pad unchanged), at the one
tuned number chosen on the DEV half by a selection rule written down before the
tune ran: spread S = 0.6 ATR (out_recall_v2/tune_launch_pad_v4.json). TEST
half, run once: recall 23.5% at a dense random ticker-day fire rate of 3.53%
(lift 6.66). Two fresh blind packets of 25 fires each read 14 yes / 3 no and
14 yes / 3 no: pooled precision of decided 82.4% (Wilson 95% CI 66.5-91.7).
The remaining misses are mostly a FALLING 50 SMA; no 50-slope gate is part of
this rule (the team's own calls often come before the 50 turns up), and the
lab's shared guard is not applied.

The rule at session i (uses bars[:i+1] only). ATR = 14-session simple average
true range; e8 / e21 are EMAs seeded at the series' first close; s50 / s200 are
simple averages; pad = max(e8, e21, s50):
  * i >= 65, ATR > 0, the 50 SMA exists                (the lab's shared warm-up)
  * spread = (max - min of e8, e21, s50) / ATR; spread > 1.5 -> no answer
  * above = (close - pad) / ATR
  * falling 200 overhead = close < s200[i] < s200[i-20] (False when the 200 SMA
    or its value 20 sessions back does not exist)
  * fire when above <= 1.0, not falling-200-overhead, above <= 2.0,
    spread <= 0.6 and above > 0 (close above all three)
  * variant `stacked` when e8 > e21 > s50, else `converged`
Frozen: spread 0.6; [P] above 1.0, mode close-above-all-three, no 5-day
tightness gate, no 50-slope gate; v2's [P] pad cap 2.0 and 200-slope window 20.

Levels: the session's close is the entry; the stop is the bottom of the average
cluster (a close below the cluster invalidates the pad); the pivot is the pad.
Neither was tested as a risk anchor in the lab: they are drawn levels.
Geometry is the shared UCT idiom: a `candle_mark` whose two anchors (with
`anchor_roles`) are the pad and the cluster floor on the marked session, plus
display-only `geometry.secondary` lines for both.

Wrapper (shared with the other UCT trader-setup detectors, not part of the lab
rule): the liquidity floor, the newest of the last `MAX_TRIGGER_AGE` sessions
that qualifies, and a prior-session trigger is reported only while no later
session has traded through its stop.

History depth: the falling-200 gate reads the 200 SMA 20 sessions back, so
session i needs i >= 219 for the gate to be evaluable. With less history the lab
rule silently answers WITHOUT that gate, which is not the rule that was judged,
so the detector refuses a history under `_MIN_BARS` (220) and declares
`MIN_BARS` (222) so the two prior trigger sessions are evaluable too. The 8 and
21 EMAs are seeded at the slice's first bar; over 222 bars the residual against
the full history is below floating-point noise in practice, and the parity test
measures it.
"""
from __future__ import annotations

from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.liquidity import liquidity_floor


_PATTERN_ID = "uct_launch_pad_v4"
_PATTERN_NAME = "UCT Launch Pad v4"

# Lab constants. Do not tune here; the parity test pins them to the lab.
LP_SPREAD = 0.6             # frozen: the one tuned number (tune_launch_pad_v4.json)
LP_ABOVE_MAX = 1.0          # [P] v4: close at most 1.0 ATR above the pad
LP_MODE = "c>all3"          # [P] v4: close above all three averages
LP_TIGHT = None             # [P] v4: no 5-day tightness gate
LP_CURL = None              # [P] v4: no 50-SMA slope gate
LP_PAD_MAX = 2.0            # [P] v2: close at most 2 ATR above the pad
LP_S200_SLOPE = 20          # [P] v2: the 200 SMA is "falling" when s200[i] < s200[i-20]
LP_CORE_SPREAD = 1.5        # [P] round 1: no answer when the spread exceeds 1.5 ATR
LP_S50_SLOPE = 10           # round 1: the 50 slope window (a fact; gated only when LP_CURL is set)
LP_TIGHT_N = 5              # round 1: the tightness window (a fact; gated only when LP_TIGHT is set)

_WARMUP = 65                # the lab's shared warm-up (team_rules._base: i >= 65)
_MIN_BARS = 199 + LP_S200_SLOPE + 1     # 220: the falling-200 gate is evaluable at the newest session
#: History declared to the scan (registry `min_bars`): the gate is evaluable
#: at the newest session AND the two prior sessions the wrapper may report.
MIN_BARS = _MIN_BARS + U.MAX_TRIGGER_AGE - 1


def falling_200_overhead(bars: list, S: dict, i: int) -> bool:
    """team_rules_r2.falling_200_overhead."""
    m = S["s200"]
    if i - LP_S200_SLOPE < 0 or m[i] is None or m[i - LP_S200_SLOPE] is None:
        return False                                # no 200 SMA yet -> cannot be "overhead"
    return bars[i]["c"] < m[i] and m[i] < m[i - LP_S200_SLOPE]


def features(bars: list, S: dict, i: int) -> Optional[dict]:
    """The lab's feats_launch_pad_v4 (= feats_launch_pad_v2) at session i: None
    when the core precondition fails, else the lab's facts dict."""
    if i < 0 or i >= len(bars):
        return None
    a = S["atr"][i]
    if i < _WARMUP or a is None or a <= 0 or S["s50"][i] is None:
        return None
    m3 = (S["e8"][i], S["e21"][i], S["s50"][i])
    sp = (max(m3) - min(m3)) / a
    if sp > LP_CORE_SPREAD:
        return None
    c = bars[i]["c"]
    w = bars[i - LP_TIGHT_N + 1:i + 1]
    f = {"spread": sp, "above": (c - max(m3)) / a, "c_ge_e21_s50": c >= max(S["e21"][i], S["s50"][i]),
         "tight5": (max(x["h"] for x in w) - min(x["l"] for x in w)) / a,
         "s50_slope": (S["s50"][i] - S["s50"][i - LP_S50_SLOPE]) / a,
         "stack": S["e8"][i] > S["e21"][i] > S["s50"][i]}
    f["f200_over"] = falling_200_overhead(bars, S, i)
    return f


def decide(f: dict) -> Optional[str]:
    """The lab's decide_launch_pad_v4 at the frozen spread."""
    if f["above"] > LP_ABOVE_MAX:                               # v4 gate
        return None
    if f["f200_over"] or f["above"] > LP_PAD_MAX:               # v2 gate
        return None
    if f["spread"] > LP_SPREAD or f["above"] > LP_ABOVE_MAX:    # round-1 decide
        return None
    if LP_MODE == "c>all3" and f["above"] <= 0:
        return None
    if LP_MODE == "c>=e21,s50" and not f["c_ge_e21_s50"]:
        return None
    if LP_TIGHT is not None and f["tight5"] > LP_TIGHT:
        return None
    if LP_CURL is not None and f["s50_slope"] < LP_CURL:
        return None
    return "stacked" if f["stack"] else "converged"


def evaluate(bars: list, S: dict, i: int) -> Optional[dict]:
    """The lab rule at session i. Returns a candidate dict or None."""
    f = features(bars, S, i)
    if f is None:
        return None
    v = decide(f)
    if v is None:
        return None
    b = bars[i]
    m3 = (S["e8"][i], S["e21"][i], S["s50"][i])
    v50 = S["v50"][i]
    return {
        "idx": i, "variant": v, "facts": f,
        "pad": max(m3), "floor": min(m3), "e8": m3[0], "e21": m3[1], "s50": m3[2],
        "close": b["c"], "low": b["l"],
        "rvol50": round(S["v"][i] / v50, 2) if v50 else None,
        "trigger": b["c"], "stop": min(m3),
    }


def lab_facts(c: dict) -> dict:
    """The candidate in the lab's own result shape (team_rules.rule)."""
    return {"variant": c["variant"], "facts": c["facts"]}


def _geometry_score(c: dict) -> float:
    f = c["facts"]
    g = 70.0
    g += 5.0 if c["variant"] == "stacked" else 0.0
    g += 5.0 if f["spread"] <= 0.3 else 0.0
    g += 5.0 if f["s50_slope"] >= 0 else 0.0
    return round(min(100.0, g), 2)


def detect_uct_launch_pad_v4(bars: List[dict], context: dict) -> List[dict]:
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
    i = c["idx"]
    k0 = max(0, i - 10)
    pad, floor = float(c["pad"]), float(c["floor"])
    f = c["facts"]
    levels = U.make_levels(
        c["trigger"], floor, "bullish",
        entry_condition=f"closed just above the 8/21/50 average cluster (pad {pad:.2f}) this session",
        stop_basis="below_average_cluster")
    levels["pivot"] = round(pad, 2)
    anchors = [{"t": int(bars[i]["t"]), "price": pad},
               {"t": int(bars[i]["t"]), "price": floor}]
    secondary = [U.hline(bars, k0, i, pad, "pad", f"Pad (top of 8/21/50) {pad:.2f}"),
                 U.hline(bars, k0, i, floor, "stop", f"Cluster floor {floor:.2f}")]
    extras = {
        "variant": c["variant"], "fired_variants": [c["variant"]], "label_variants": [],
        "spread_atr": round(f["spread"], 3), "above_pad_atr": round(f["above"], 3),
        "s50_slope_atr": round(f["s50_slope"], 3), "tight5_atr": round(f["tight5"], 3),
        "e8": round(float(c["e8"]), 2), "e21": round(float(c["e21"]), 2), "s50": round(float(c["s50"]), 2),
        "rvol50": c["rvol50"],
        "lab_rule": "team_rules_r6.launch_pad_v4",
    }
    return U.build_detection(
        pattern_id=_PATTERN_ID, pattern_name=_PATTERN_NAME, direction="bullish",
        bars=bars, trig_idx=i, start_idx=k0, anchors=anchors,
        anchor_roles=["pad", "cluster_floor"], extras=extras,
        levels=levels, context=context, narrative=_narrative(c, levels, context),
        geom=geom, vol=vol, ctx=ctx, secondary=secondary)


def _narrative(c, levels, context) -> dict:
    f = c["facts"]
    shape = "stacked 8 over 21 over 50" if c["variant"] == "stacked" else "converged"
    headline = (
        f"UCT Launch Pad v4 - closed just above a tight 8/21/50 average cluster ({shape}). "
        f"Entry ${levels['entry']:.2f}, stop ${levels['stop']:.2f}."
    )
    what_it_is = (
        f"The 8 EMA, 21 EMA and 50 SMA sit within {f['spread']:.2f} ATR of each other, and this "
        f"session closed at ${c['close']:.2f}, {f['above']:.2f} ATR above the highest of them, with "
        f"no falling 200 SMA overhead. {U.PROVENANCE_NOTE}"
    )
    why_it_matters = (
        f"Averages that have converged under price mark a base where short- and medium-term trend "
        f"agree; a close just above them is the launch point before expansion. The setup forms in "
        f"{U.context_phrase(context)}. This detector is experimental and admin-only: two blind "
        f"reviews of its fires judged most of them real, on small samples; a falling 50 SMA was "
        f"the usual miss."
    )
    what_to_watch_for = (
        f"Expansion away from the cluster on rising volume. Targets are in R from the cluster "
        f"floor: ${levels['target_primary']:.2f} (2R) and ${levels['target_secondary']:.2f} (3R)."
    )
    failure_signal = (
        f"A close back below the 21/50 cluster undoes the pad; a trade below ${levels['stop']:.2f} "
        f"is the stop."
    )
    return {"headline": headline, "what_it_is": what_it_is, "why_it_matters": why_it_matters,
            "what_to_watch_for": what_to_watch_for, "failure_signal": failure_signal}


register(_PATTERN_ID, detect_uct_launch_pad_v4, min_bars=MIN_BARS)
