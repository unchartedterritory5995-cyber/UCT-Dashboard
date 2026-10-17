"""UCT Inside Day detector - pattern_id `uct_inside_day`. INTERNAL (admin-only).

An inside day is a session whose whole range sits inside the prior session's
range: a pause. Its meaning comes from the trend it pauses in, so this
detector only counts a small inside day resting inside a stacked uptrend
(close above a rising stack of the 8 EMA, the 21 EMA and the 50 SMA).

This is a NEW detector beside `inside_bar_breakout` and `nr7`; it does not
change either. It is a port of the offline lab's team-setup recognition rule
`inside_day` (feats_inside_day / decide_inside_day), whose grid point was
chosen on the DEV half of the traders' scored calls by a selection rule written
down before the grid ran, and frozen before the TEST half ran. TEST half: recall
18.1% at a dense random ticker-day fire rate of 2.06% (lift 8.79; the
production inside_bar_breakout / nr7 pair: 28.8% at 17.40%, lift 1.66). Two
independent blind packets of 25 fires each were judged 19 yes / 2 no in both;
pooled precision of decided 90.5% (Wilson 95% CI 78-96).

The rule at session i (uses bars[:i+1] only). ATR = 14-session simple average
true range; e8 / e21 are EMAs, s50 a simple average.
  * i >= 65, ATR > 0, the 50 SMA exists                (the lab's shared warm-up)
  * session i is inside session i-1: high <= prior high and low >= prior low
  * close > e8 > e21 > s50                             (frozen trend gate "stack")
  * the inside session's range (high - low) <= 0.7 ATR (frozen tightness cap)
  The variant is `double_inside` when session i-1 was itself inside session
  i-2, else `inside`.
Frozen grid point: which = "i0" (the marked session itself is the inside day),
trend = "stack", tight = 0.7. No other gate. In particular the shared
falling-200-SMA / pinned-price guard the lab tried afterwards is NOT part of
this rule: it was measured post hoc and never pre-registered for it.

Levels: entry = the inside day's high (its trigger is a break of that high);
stop = the inside day's low; pivot = the entry. Neither level was tested as a
risk anchor in the lab: they are drawn levels. Geometry is the shared UCT
idiom: a `candle_mark` whose two anchors (with `anchor_roles`) are the inside
day's high and low on the marked session, plus display-only
`geometry.secondary` horizontal lines for the two levels, drawn from the
prior (mother) session.

Wrapper (shared with the other UCT trader-setup detectors, not part of the lab
rule): the liquidity floor, the newest of the last `MAX_TRIGGER_AGE` sessions
that qualifies, and a prior-session trigger is reported only while no later
session has traded through its stop. The parity test pins the rule itself
against the lab code, bar for bar.

History depth: the rule needs 66 bars, so the scan's base 200 is enough and no
`min_bars` is declared. The lab computed its EMAs over each ticker's whole
history; the scan hands this detector the trailing 200 bars, so the 8 / 21
EMAs are seeded at a different first bar. After 135+ bars that difference is
far below a cent, but a near-tie in the e8 > e21 > s50 stack can resolve
differently from the lab.
"""
from __future__ import annotations

from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.liquidity import liquidity_floor


_PATTERN_ID = "uct_inside_day"
_PATTERN_NAME = "UCT Inside Day"

# Lab constants (team_rules.py + the frozen tune result). Do not tune here;
# the parity test pins them to the lab.
ID_WHICH = "i0"         # frozen: the marked session is the inside day
ID_TREND = "stack"      # frozen: close > e8 > e21 > s50
ID_TIGHT_ATR = 0.7      # frozen: inside-day range <= 0.7 ATR
ID_E21_UP_BARS = 5      # lab fact only (c > rising 21 EMA, vs 5 sessions back)

_MIN_IDX = 65           # the lab's shared warm-up (_base: i >= 65)
_MIN_BARS = _MIN_IDX + 1


def _inside(bars, k: int) -> bool:
    return bars[k]["h"] <= bars[k - 1]["h"] and bars[k]["l"] >= bars[k - 1]["l"]


def features(bars: list, S: dict, i: int) -> Optional[dict]:
    """The lab's feats_inside_day at session i: None when the core
    precondition fails, else the raw measurements (bars[:i+1] only)."""
    if i < 0 or i >= len(bars):
        return None
    a = S["atr"][i]
    if i < _MIN_IDX or a is None or a <= 0 or S["s50"][i] is None:
        return None
    i0, i1 = _inside(bars, i), _inside(bars, i - 1)
    if not (i0 or i1):
        return None
    c = bars[i]["c"]
    return {"i0": i0, "i1": i1,
            "rng0": (bars[i]["h"] - bars[i]["l"]) / a,
            "rng1": (bars[i - 1]["h"] - bars[i - 1]["l"]) / a,
            "c>s50": c > S["s50"][i],
            "c>e21_up": c > S["e21"][i] and S["e21"][i] > S["e21"][i - ID_E21_UP_BARS],
            "stack": c > S["e8"][i] > S["e21"][i] > S["s50"][i]}


def decide(f: dict) -> Optional[str]:
    """The lab's decide_inside_day at the frozen grid point."""
    if f["i0"]:
        v, rng = ("double_inside" if f["i1"] else "inside"), f["rng0"]
    elif ID_WHICH == "i0|i1":
        v, rng = "inside_yesterday", f["rng1"]
    else:
        return None
    if ID_TREND is not None and not f[ID_TREND]:
        return None
    if ID_TIGHT_ATR is not None and rng > ID_TIGHT_ATR:
        return None
    return v


def evaluate(bars: list, S: dict, i: int) -> Optional[dict]:
    """The lab rule at session i. Returns a candidate dict or None."""
    f = features(bars, S, i)
    if f is None:
        return None
    v = decide(f)
    if v is None:
        return None
    b, p = bars[i], bars[i - 1]
    v50 = S["v50"][i]
    return {
        "idx": i, "variant": v, "facts": f,
        "high": b["h"], "low": b["l"], "close": b["c"],
        "mother_high": p["h"], "mother_low": p["l"],
        "range_atr": round(f["rng0"], 2),
        "e8": S["e8"][i], "e21": S["e21"][i], "s50": S["s50"][i],
        "rvol50": round(S["v"][i] / v50, 2) if v50 else None,
        "trigger": b["h"], "stop": b["l"],
    }


def lab_facts(c: dict) -> dict:
    """The candidate in the lab's own result shape (team_rules.rule)."""
    return {"variant": c["variant"], "facts": c["facts"]}


def _geometry_score(c: dict) -> float:
    g = 70.0
    g += 10.0 if c["variant"] == "double_inside" else 0.0
    g += 5.0 if c["range_atr"] <= 0.5 else 0.0
    g += 5.0 if c["facts"]["c>e21_up"] else 0.0
    return round(min(100.0, g), 2)


def detect_uct_inside_day(bars: List[dict], context: dict) -> List[dict]:
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
        "inside_high": round(hi, 2), "inside_low": round(lo, 2),
        "mother_high": round(float(c["mother_high"]), 2),
        "mother_low": round(float(c["mother_low"]), 2),
        "range_atr": c["range_atr"], "rvol50": c["rvol50"],
        "ema8": round(c["e8"], 2), "ema21": round(c["e21"], 2), "sma50": round(c["s50"], 2),
        "lab_rule": "team_rules.inside_day",
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
    headline = (
        f"UCT Inside Day - {kind} ({c['range_atr']:.1f} ATR range) resting in a stacked uptrend; "
        f"entry ${levels['entry']:.2f} on a break of its high, stop ${levels['stop']:.2f} under its low."
    )
    what_it_is = (
        f"The session traded entirely inside the prior session's range (${c['mother_low']:.2f} - "
        f"${c['mother_high']:.2f}) and its own range was only {c['range_atr']:.2f} ATR. The close of "
        f"${c['close']:.2f} sits above the 8-day EMA, which is above the 21-day EMA, which is above the "
        f"50-day SMA, so this is a pause inside an uptrend rather than indecision in a downtrend. "
        f"{U.PROVENANCE_NOTE}"
    )
    why_it_matters = (
        f"A tight inside day after a move is the market resting; the break of its high is a "
        f"low-risk trigger with the inside day's low as the line in the sand. The setup forms in "
        f"{U.context_phrase(context)}. This detector is experimental and admin-only: two blind "
        f"reviews of its fires on random days judged most of them real, on small samples."
    )
    what_to_watch_for = (
        f"A break above ${levels['entry']:.2f} with the moving averages still stacked under price. "
        f"Targets are in R from the inside day's low: ${levels['target_primary']:.2f} (2R) and "
        f"${levels['target_secondary']:.2f} (3R)."
    )
    failure_signal = (
        f"A trade below the inside day's low at ${levels['stop']:.2f} resolves the pause downward. "
        f"A close back under the 21-day EMA (${c['e21']:.2f}) is the trend breaking."
    )
    return {"headline": headline, "what_it_is": what_it_is, "why_it_matters": why_it_matters,
            "what_to_watch_for": what_to_watch_for, "failure_signal": failure_signal}


register(_PATTERN_ID, detect_uct_inside_day)
