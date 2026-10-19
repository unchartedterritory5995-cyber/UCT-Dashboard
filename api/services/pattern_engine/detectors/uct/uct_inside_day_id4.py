"""UCT Inside Day id4 detector - pattern_id `uct_inside_day_id4`. INTERNAL (admin-only).

A recall variant of `uct_inside_day` (the offline lab's recall v4 rule `id4`).
It fires everywhere `uct_inside_day` fires, with the same rule, and ALSO on a
second, gated point that the base rule misses: an inside day resting above a
rising 21 EMA (instead of the full 8 > 21 > 50 stack), with a looser range
cap, but only inside a confirmed uptrend (the 50 SMA rising and the close
above the 200 SMA). `uct_inside_day` itself is unchanged.

The rule at session i (uses bars[:i+1] only). ATR = 14-session simple average
true range; e8 / e21 are EMAs, s50 / s200 simple averages.
  * i >= 65, ATR > 0, the 50 SMA exists                (the lab's shared warm-up)
  * session i is inside session i-1: high <= prior high and low >= prior low
  BASE  close > e8 > e21 > s50 and the inside range <= 0.7 ATR (= uct_inside_day)
  NEW   (only when BASE does not fire)
        close > e21 and e21 > e21 five sessions back   (a rising 21 EMA)
        the inside range <= 1.0 ATR
        s50 > s50 ten sessions back                    (the 50 SMA rising)
        close > s200 (the 200 SMA must exist)
  The variant is `double_inside` when session i-1 was itself inside session
  i-2, else `inside`; `extras.id4_branch` says which branch fired.

Lab evidence (recall v4, pre-registered before its test half ran): on the
traders' held-out calls the variant's recall was 42.8% against the base
rule's 23.5% (paired gain +19.3 points, 95% CI +14.8 to +24.1) at a random-
day fire share of 8.12% (enrichment 5.3x). Two fresh blind packets of 25
fires each: 21 / 21 and 15 / 17 of decided judged yes; the new-branch fires
alone, pooled, 12 / 14. Small samples; experimental.

Wrapper (shared with the other UCT trader-setup detectors, not part of the lab
rule): the liquidity floor, the newest of the last `MAX_TRIGGER_AGE` sessions
that qualifies, and a prior-session trigger is reported only while no later
session has traded through its stop.

History depth: the NEW branch needs the 200 SMA on the marked session, so the
detector declares 200 bars plus the two prior trigger sessions. With less
history only the base branch can fire (as in the lab). The 8 / 21 EMAs are
seeded at the window's first bar rather than the ticker's first bar; after
200 bars that difference is far below a cent.
"""
from __future__ import annotations

from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.detectors.uct import uct_inside_day as ID
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.liquidity import liquidity_floor


_PATTERN_ID = "uct_inside_day_id4"
_PATTERN_NAME = "UCT Inside Day (recall v4)"

# Lab constants (recall_v4/v4_rules.py). Do not tune here; the parity test
# pins them to the lab.
BASE_TREND = "stack"        # = uct_inside_day
BASE_TIGHT_ATR = 0.7        # = uct_inside_day
NEW_TREND = "c>e21_up"      # close above a rising 21 EMA
NEW_TIGHT_ATR = 1.0
S50_LAG = 10                # the 50 SMA is rising when s50[i] > s50[i-10]
NEED_ABOVE_S200 = True      # the close is above the 200 SMA

_MIN_BARS = ID._MIN_BARS
#: History declared to the scan: the 200 SMA on the newest session and on the
#: two prior sessions the wrapper may report.
MIN_BARS = 200 + U.MAX_TRIGGER_AGE - 1


def _decide(f: dict, trend: str, tight: float) -> Optional[str]:
    """The lab's decide_inside_day at which = 'i0' and the given trend / tight."""
    if not f["i0"]:
        return None
    v, rng = ("double_inside" if f["i1"] else "inside"), f["rng0"]
    if trend is not None and not f[trend]:
        return None
    if tight is not None and rng > tight:
        return None
    return v


def _uptrend(bars: list, S: dict, i: int) -> bool:
    s50, s200 = S["s50"], S["s200"]
    if i - S50_LAG < 0 or s50[i - S50_LAG] is None or not s50[i] > s50[i - S50_LAG]:
        return False
    if NEED_ABOVE_S200 and (s200[i] is None or not bars[i]["c"] > s200[i]):
        return False
    return True


def evaluate(bars: list, S: dict, i: int) -> Optional[dict]:
    """The lab rule id4 at session i. Returns a candidate dict or None."""
    f = ID.features(bars, S, i)
    if f is None:
        return None
    v = _decide(f, BASE_TREND, BASE_TIGHT_ATR)
    new = False
    if v is None:
        v = _decide(f, NEW_TREND, NEW_TIGHT_ATR)
        if v is None or not _uptrend(bars, S, i):
            return None
        new = True
    b, p = bars[i], bars[i - 1]
    v50 = S["v50"][i]
    return {
        "idx": i, "variant": v, "new": new, "facts": f,
        "high": b["h"], "low": b["l"], "close": b["c"],
        "mother_high": p["h"], "mother_low": p["l"],
        "range_atr": round(f["rng0"], 2),
        "e8": S["e8"][i], "e21": S["e21"][i], "s50": S["s50"][i], "s200": S["s200"][i],
        "rvol50": round(S["v"][i] / v50, 2) if v50 else None,
        "trigger": b["h"], "stop": b["l"],
    }


def lab_facts(c: dict) -> dict:
    """The candidate in the lab's own result shape (v4_rules.id4)."""
    return {"variant": c["variant"], "new": c["new"]}


def _geometry_score(c: dict) -> float:
    g = 70.0
    g += 10.0 if c["variant"] == "double_inside" else 0.0
    g += 5.0 if c["range_atr"] <= 0.5 else 0.0
    g += 5.0 if c["facts"]["stack"] else 0.0
    return round(min(100.0, g), 2)


def detect_uct_inside_day_id4(bars: List[dict], context: dict) -> List[dict]:
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
    hi, lo = float(c["high"]), float(c["low"])
    levels = U.make_levels(hi, lo, "bullish",
                           entry_condition=f"break above the inside day's high ({hi:.2f})",
                           stop_basis="below_inside_day_low")
    levels["pivot"] = round(hi, 2)
    anchors = [{"t": int(bars[i]["t"]), "price": hi},
               {"t": int(bars[i]["t"]), "price": lo}]
    secondary = [U.hline(bars, i - 1, i, hi, "trigger", f"Inside-day high {hi:.2f}"),
                 U.hline(bars, i - 1, i, lo, "stop", f"Inside-day low {lo:.2f}")]
    extras = {
        "variant": c["variant"], "fired_variants": [c["variant"]], "label_variants": [],
        "id4_branch": "new" if c["new"] else "base",
        "inside_high": round(hi, 2), "inside_low": round(lo, 2),
        "mother_high": round(float(c["mother_high"]), 2),
        "mother_low": round(float(c["mother_low"]), 2),
        "range_atr": c["range_atr"], "rvol50": c["rvol50"],
        "ema8": round(c["e8"], 2), "ema21": round(c["e21"], 2), "sma50": round(c["s50"], 2),
        "sma200": round(c["s200"], 2) if c["s200"] is not None else None,
        "lab_rule": "recall_v4.id4",
    }
    return U.build_detection(
        pattern_id=_PATTERN_ID, pattern_name=_PATTERN_NAME, direction="bullish",
        bars=bars, trig_idx=i, start_idx=i - 1, anchors=anchors,
        anchor_roles=["inside_high", "inside_low"], extras=extras,
        levels=levels, context=context, narrative=_narrative(c, levels, context),
        geom=geom, vol=vol, ctx=ctx, secondary=secondary)


def _narrative(c, levels, context) -> dict:
    kind = ("a second inside day in a row" if c["variant"] == "double_inside"
            else "an inside day")
    if c["new"]:
        trend = (f"above a rising 21-day EMA (${c['e21']:.2f}), with the 50-day SMA rising and the "
                 f"close above the 200-day SMA")
    else:
        trend = ("above the 8-day EMA, which is above the 21-day EMA, which is above the 50-day "
                 "SMA")
    headline = (
        f"UCT Inside Day (recall v4) - {kind} ({c['range_atr']:.1f} ATR range) resting in an uptrend; "
        f"entry ${levels['entry']:.2f} on a break of its high, stop ${levels['stop']:.2f} under its low."
    )
    what_it_is = (
        f"The session traded entirely inside the prior session's range (${c['mother_low']:.2f} - "
        f"${c['mother_high']:.2f}) and its own range was {c['range_atr']:.2f} ATR. The close of "
        f"${c['close']:.2f} sits {trend}, so this is a pause inside an uptrend. {U.PROVENANCE_NOTE}"
    )
    why_it_matters = (
        f"A small inside day after a move is the market resting; the break of its high is a "
        f"low-risk trigger with the inside day's low as the line in the sand. The setup forms in "
        f"{U.context_phrase(context)}. This detector is experimental and admin-only: a wider "
        f"variant of the inside-day rule, checked in two blind reviews on small samples."
    )
    what_to_watch_for = (
        f"A break above ${levels['entry']:.2f} with the 21-day EMA still rising under price. "
        f"Targets are in R from the inside day's low: ${levels['target_primary']:.2f} (2R) and "
        f"${levels['target_secondary']:.2f} (3R)."
    )
    failure_signal = (
        f"A trade below the inside day's low at ${levels['stop']:.2f} resolves the pause downward. "
        f"A close back under the 21-day EMA (${c['e21']:.2f}) is the trend breaking."
    )
    return {"headline": headline, "what_it_is": what_it_is, "why_it_matters": why_it_matters,
            "what_to_watch_for": what_to_watch_for, "failure_signal": failure_signal}


register(_PATTERN_ID, detect_uct_inside_day_id4, min_bars=MIN_BARS)
