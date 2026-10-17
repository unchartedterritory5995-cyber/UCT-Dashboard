"""UCT MA Reclaim detector - pattern_id `uct_ma_reclaim`. INTERNAL (admin-only).

A moving-average reclaim is the session that closes back above the 50-day or
the 200-day simple average after price had been living under it: the prior
session closed at or below the average, this one closes above it, not far
past it, and price had closed under it on at least three of the twenty
sessions before.

This is a NEW detector beside `remount`; it does not change it. It is a port
of the offline lab's team-setup recognition rule `ma_reclaim`
(feats_ma_reclaim / decide_ma_reclaim), at the grid point chosen on the DEV
half of the traders' scored calls by a selection rule written down before the
grid ran, and frozen before the TEST half ran. TEST half: recall 32.8% at a
dense random ticker-day fire rate of 3.88% (lift 8.46; production `remount`:
23.0% at 7.28%, lift 3.15). Judged on charts that draw the 200 SMA where the
reader checks the cross, two fresh blind packets of 25 fires each read
15 yes / 4 no and 19 yes / 3 no: pooled precision of decided 82.9% (Wilson 95%
CI 69-91). The remaining misses are chop around a FLAT average; no flatness
gate is part of this rule. The lab's shared falling-200-SMA guard is NOT
applied: reclaiming the 200 from below is by definition under it, so that
guard removes the setup itself.

The rule at session i (uses bars[:i+1] only). ATR = 14-session simple average
true range; s50 / s200 are simple averages; M below is s50, then s200.
  * i >= 65, ATR > 0, the 50 SMA exists                (the lab's shared warm-up)
  * an average is considered only if it existed 23 sessions back (M[i-23])
  * d = the first k in 0, 1, 2 with every close from i-k to i above M and the
    close at i-k-1 at or below M (None when there is none)
  * below = closes strictly under M in the 20 sessions before i-d (before i+1
    when d is None)
  * pos = (close[i] - M[i]) / ATR
  * fire on the first average (s50 first) with below >= 3, d == 0 and
    pos <= 2.0: variant `reclaim_s50` or `reclaim_s200`
Frozen grid point: within 0, below 3, press None, vol None.

Levels: the reclaim session's close is the entry (the reclaim has happened on
the close); the stop is the session's low; the pivot is the reclaimed average.
Neither was tested as a risk anchor in the lab: they are drawn levels.
Geometry is the shared UCT idiom: a `candle_mark` whose two anchors (with
`anchor_roles`) are the reclaimed average and the session's low on the marked
session, plus display-only `geometry.secondary` lines for the average and the
stop.

Wrapper (shared with the other UCT trader-setup detectors, not part of the lab
rule): the liquidity floor, the newest of the last `MAX_TRIGGER_AGE` sessions
that qualifies, and a prior-session trigger is reported only while no later
session has traded through its stop. The parity test pins the rule itself
against the lab code, bar for bar.

History depth: the 200 SMA branch needs the 200 SMA 23 sessions back, so
session i needs i >= 222. The detector declares `MIN_BARS` (225, so the two
prior trigger sessions are evaluable too); the daily scan hands it its own
225-bar slice. Every input of this rule is a windowed average or ATR, so a
225-bar slice reproduces the lab's full-history answer exactly. A shorter
history still answers on the 50 SMA alone, exactly as the lab does.
"""
from __future__ import annotations

from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.liquidity import liquidity_floor


_PATTERN_ID = "uct_ma_reclaim"
_PATTERN_NAME = "UCT MA Reclaim"

# Lab constants (team_rules.py [P] values + the frozen tune result). Do not
# tune here; the parity test pins them to the lab.
MR_MAS = ("s50", "s200")    # [P] the averages, in the order they are tried
MR_PRIOR = 20               # [P] closes below the MA counted over the 20 sessions before
MR_LOOKBACK = 3             # [P] the cross is searched 0..2 sessions back (range(0, 3))
MR_EXT_ATR = 2.0            # [P] the close no more than 2 ATR above the average
MR_WITHIN = 0               # frozen: the cross is on session i itself
MR_BELOW = 3                # frozen: >= 3 closes below in the prior 20
MR_PRESS = None             # frozen: no "pressing from below" variant
MR_VOL = None               # frozen: no volume gate

_WARMUP = 65                # the lab's shared warm-up (_base: i >= 65)
_MIN_IDX = 199 + MR_PRIOR + MR_LOOKBACK   # the 200 SMA branch is evaluable
_MIN_BARS = _WARMUP + 1     # the rule itself answers from here (50 SMA branch)
#: History declared to the scan (registry `min_bars`): enough for the 200 SMA
#: branch at the newest session AND the two prior sessions the wrapper may
#: report (MAX_TRIGGER_AGE).
MIN_BARS = _MIN_IDX + 1 + U.MAX_TRIGGER_AGE - 1


def features(bars: list, S: dict, i: int) -> Optional[dict]:
    """The lab's feats_ma_reclaim at session i: None when the core
    precondition fails, else {'s50': {...}, 's200': {...}} (either may be
    absent)."""
    if i < 0 or i >= len(bars):
        return None
    a = S["atr"][i]
    if i < _WARMUP or a is None or a <= 0 or S["s50"][i] is None:
        return None
    out = {}
    c = bars[i]["c"]
    for m in MR_MAS:
        M = S[m]
        k0 = i - MR_PRIOR - MR_LOOKBACK
        if k0 < 0 or M[k0] is None:
            continue
        d = None
        for k in range(0, MR_LOOKBACK):
            j = i - k
            if all(bars[q]["c"] > M[q] for q in range(j, i + 1)) and bars[j - 1]["c"] <= M[j - 1]:
                d = k
                break
        ref = i - d if d is not None else i + 1
        below = sum(bars[q]["c"] < M[q] for q in range(ref - MR_PRIOR, ref))
        v50 = S["v50"][i - d] if d is not None else None
        v = bars[i - d]["v"] / v50 if d is not None and v50 else None
        out[m] = {"days": d, "below": below, "pos": (c - M[i]) / a, "vol": v}
    return out or None


def decide(f: dict) -> Optional[str]:
    """The lab's decide_ma_reclaim at the frozen grid point."""
    for m in MR_MAS:
        x = f.get(m)
        if not x or x["below"] < MR_BELOW:
            continue
        if x["days"] is not None and x["days"] <= MR_WITHIN and x["pos"] <= MR_EXT_ATR and (
                MR_VOL is None or (x["vol"] or 0) >= MR_VOL):
            return "reclaim_" + m
    if MR_PRESS is not None:
        for m in MR_MAS:
            x = f.get(m)
            if x and x["below"] >= MR_BELOW and -MR_PRESS <= x["pos"] <= 0:
                return "pressing_" + m
    return None


def evaluate(bars: list, S: dict, i: int) -> Optional[dict]:
    """The lab rule at session i. Returns a candidate dict or None."""
    f = features(bars, S, i)
    if f is None:
        return None
    v = decide(f)
    if v is None:
        return None
    m = v.split("_", 1)[1]
    x = f[m]
    b = bars[i]
    ma = S[m][i]
    v50 = S["v50"][i]
    # the earliest close under the average in the counted window (display only)
    ref = i - x["days"] if x["days"] is not None else i + 1
    under = [q for q in range(ref - MR_PRIOR, ref) if bars[q]["c"] < S[m][q]]
    return {
        "idx": i, "variant": v, "ma": m, "facts": f,
        "ma_value": ma, "ma_prev": S[m][i - 1], "below": x["below"],
        "pos_atr": round(x["pos"], 2), "close": b["c"], "low": b["l"],
        "prior_close": bars[i - 1]["c"], "first_under_idx": under[0] if under else i - 1,
        "rvol50": round(S["v"][i] / v50, 2) if v50 else None,
        "trigger": b["c"], "stop": b["l"],
    }


def lab_facts(c: dict) -> dict:
    """The candidate in the lab's own result shape (team_rules.rule)."""
    return {"variant": c["variant"], "facts": c["facts"]}


def _geometry_score(c: dict) -> float:
    g = 70.0
    g += 5.0 if c["ma"] == "s200" else 0.0
    g += 5.0 if c["below"] >= 10 else 0.0
    g += 5.0 if c["ma_value"] >= c["ma_prev"] else 0.0
    return round(min(100.0, g), 2)


def detect_uct_ma_reclaim(bars: List[dict], context: dict) -> List[dict]:
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


_MA_NAME = {"s50": "50-day SMA", "s200": "200-day SMA"}


def _build(bars, c, context, geom, vol, ctx) -> dict:
    i, k0 = c["idx"], c["first_under_idx"]
    ma, low = float(c["ma_value"]), float(c["stop"])
    name = _MA_NAME[c["ma"]]
    levels = U.make_levels(
        c["trigger"], low, "bullish",
        entry_condition=f"closed back above the {name} ({ma:.2f}) this session",
        stop_basis="below_marked_session_low")
    levels["pivot"] = round(ma, 2)
    anchors = [{"t": int(bars[i]["t"]), "price": ma},
               {"t": int(bars[i]["t"]), "price": low}]
    secondary = [U.hline(bars, k0, i, ma, "reclaimed_ma", f"{name} {ma:.2f}"),
                 U.hline(bars, k0, i, low, "stop", f"Session low {low:.2f}")]
    extras = {
        "variant": c["variant"], "fired_variants": [c["variant"]], "label_variants": [],
        "reclaimed_ma": c["ma"], "ma_value": round(ma, 2), "closes_below_prior20": c["below"],
        "pos_atr": c["pos_atr"], "prior_close": round(float(c["prior_close"]), 2),
        "rvol50": c["rvol50"],
        "lab_rule": "team_rules.ma_reclaim",
    }
    return U.build_detection(
        pattern_id=_PATTERN_ID, pattern_name=_PATTERN_NAME, direction="bullish",
        bars=bars, trig_idx=i, start_idx=k0, anchors=anchors,
        anchor_roles=["reclaimed_ma", "session_low"], extras=extras,
        levels=levels, context=context, narrative=_narrative(c, levels, context),
        geom=geom, vol=vol, ctx=ctx, secondary=secondary)


def _narrative(c, levels, context) -> dict:
    name = _MA_NAME[c["ma"]]
    ma = c["ma_value"]
    headline = (
        f"UCT MA Reclaim - closed back above the {name} (${ma:.2f}) after {c['below']} closes under "
        f"it in the prior 20 sessions. Entry ${levels['entry']:.2f}, stop ${levels['stop']:.2f}."
    )
    what_it_is = (
        f"The prior session closed at ${c['prior_close']:.2f}, at or below the {name}; this session "
        f"closed at ${c['close']:.2f}, {c['pos_atr']:.1f} ATR above it. Price had closed under the "
        f"average on {c['below']} of the 20 sessions before, so this is a reclaim of a lost average, "
        f"not a stock that never left it. {U.PROVENANCE_NOTE}"
    )
    why_it_matters = (
        f"A stock taking back a major average it had lost says the selling that pushed it under has "
        f"been absorbed. The setup forms in {U.context_phrase(context)}. This detector is "
        f"experimental and admin-only: two blind reviews of its fires on random days judged most of "
        f"them real, on small samples; chop around a flat average was the usual miss."
    )
    what_to_watch_for = (
        f"Follow-through that holds above the {name} (${ma:.2f}). Targets are in R from the session "
        f"low: ${levels['target_primary']:.2f} (2R) and ${levels['target_secondary']:.2f} (3R)."
    )
    failure_signal = (
        f"A close back below the {name} (${ma:.2f}) undoes the reclaim; a trade below "
        f"${levels['stop']:.2f} is the stop."
    )
    return {"headline": headline, "what_it_is": what_it_is, "why_it_matters": why_it_matters,
            "what_to_watch_for": what_to_watch_for, "failure_signal": failure_signal}


register(_PATTERN_ID, detect_uct_ma_reclaim, min_bars=MIN_BARS)
