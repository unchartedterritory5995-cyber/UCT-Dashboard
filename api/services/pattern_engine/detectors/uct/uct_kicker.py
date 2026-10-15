"""UCT Kicker candle detector — pattern_id `uct_kicker`.

A kicker is a one-session change of character: the prior day closes weak, the
next session gaps up over that close and trades through the prior high, so
everyone who sold the weak close is wrong at the open.

Fires (the core rule, kept after blind adjudication):
  K1 weak prior close: prior day's DCR <= 0.35, OR the prior day was red AND
     its DCR <= 0.60 (a red day that closed near its high is not weak)
  K2 gap up: open > prior close                                  [trader rule]
     AND the gap is at least 0.10 x the prior day's range (blind review round 2)
  K3 break of the prior high: high > prior high                  [trader rule]

Labels only (recorded in geometry.extras, never a reason to fire):
  K4 push: close > open AND close > prior high
  M1 MA reclaim: prior close under EMA8 and EMA21, close back over both
  M2 refined: prior close under EMA21 and the open gaps over the prior high
  V5 textbook: prior red, open above the prior open, green session
  plus support/undercut context, character change vs the 50/200 SMAs, a rising
  200 SMA, "close to the MAs", gap %, relative volume.

Entry: the prior high if the open is below it, else the open. Stop: the
trigger session's low (low of day).

Scoring (canonical engine composite, historical 50):
  geometry: 70 base, +10 K4 held, +10 gap over the prior high, +5 very weak
            prior close (DCR <= 0.20), +5 strong close (DCR >= 0.70)
  volume:   relative volume vs the 50-bar average
  context:  trend stage / MA stack / RS, floored at 40
"""
from __future__ import annotations

from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.liquidity import liquidity_floor


_PATTERN_ID = "uct_kicker"
_PATTERN_NAME = "UCT Kicker"

# [P] proposed defaults (the only lab-tunable values)
KICKER_WEAK_DCR = 0.35
KICKER_RED_DCR = 0.60
KICKER_MIN_GAP_RANGE = 0.10       # K2: gap >= this x the prior day's range (blind round 2)
KICKER_SUPPORT_ATR_BAND = 0.5
KICKER_CLOSE_TO_MA_ATR = 1.0
KICKER_SMA200_SLOPE_BARS = 10
_MIN_BARS = 23


def evaluate(bars: list, S: dict, i: int) -> Optional[dict]:
    """The lab rule at session i. Returns a candidate dict or None."""
    if i < 22:
        return None
    b, p, p2 = bars[i], bars[i - 1], bars[i - 2]
    if not (U.valid_bar(b) and U.valid_bar(p) and U.valid_bar(p2)):
        return None
    o, h, l, c, v = b["o"], b["h"], b["l"], b["c"], float(b["v"] or 0.0)
    o1, h1, l1, c1 = p["o"], p["h"], p["l"], p["c"]
    dcr1 = U.dcr(p)
    e8, e21 = S["e8"], S["e21"]
    k1 = dcr1 <= KICKER_WEAK_DCR or (c1 < o1 and dcr1 <= KICKER_RED_DCR)
    k2 = (o - c1) >= KICKER_MIN_GAP_RANGE * max(h1 - l1, 1e-9) and o > c1
    k3 = h > h1
    if not (k1 and k2 and k3):
        return None
    k4 = c > o and c > h1
    m1 = c1 < e8[i - 1] and c1 < e21[i - 1] and c > e8[i] and c > e21[i]
    m2 = c1 < e21[i - 1] and o > h1
    v5 = c1 < o1 and o > o1 and c > o
    a = S["atr"][i]
    s50, s200 = S["s50"], S["s200"]
    m3 = bool(s50[i - 1] and s200[i - 1] and s50[i] and s200[i]
              and c1 < s50[i - 1] and c1 < s200[i - 1] and o > max(s50[i], s200[i]))
    j = i - KICKER_SMA200_SLOPE_BARS
    m4 = bool(s200[i] and j >= 0 and s200[j] and s200[i] > s200[j])
    sup = U.near(l1, (("ema20", S["e20"][i - 1]), ("ema21", e21[i - 1]), ("sma50", s50[i - 1])),
                 KICKER_SUPPORT_ATR_BAND * a if a else None)
    v50 = S["v50"][i]
    rvol = round(v / v50, 2) if v50 else None
    labels = [n for n, f in (("push_held_k4", k4), ("gap_over_high_below_ema21_m2", m2),
                             ("ma_reclaim_m1", m1), ("textbook_v5", v5)) if f]
    return {
        "idx": i, "variant": "core", "label_variants": labels,
        "dcr1": round(dcr1, 3), "dcr": round(U.dcr(b), 3),
        "gap_pct": round((o / c1 - 1) * 100.0, 2), "gap_over_high": o > h1,
        "k4_held": k4, "rvol50": rvol, "character_change_m3": m3,
        "sma200_rising_m4": m4,
        "close_to_mas": bool(a and (o - max(e8[i], e21[i])) <= KICKER_CLOSE_TO_MA_ATR * a),
        "support_or_undercut": sup + (["undercut"] if l1 < p2["l"] else []),
        "prior_high": h1, "prior_close": c1, "prior_low": l1,
        "trigger": h1 if o <= h1 else o, "stop": l,
        "open": o, "high": h, "low": l, "close": c,
    }


def _geometry_score(c: dict) -> float:
    g = 70.0
    g += 10.0 if c["k4_held"] else 0.0
    g += 10.0 if c["gap_over_high"] else 0.0
    g += 5.0 if c["dcr1"] <= 0.20 else 0.0
    g += 5.0 if c["dcr"] >= 0.70 else 0.0
    return round(min(100.0, g), 2)


def detect_uct_kicker(bars: List[dict], context: dict) -> List[dict]:
    if len(bars) < _MIN_BARS or not liquidity_floor(bars).passes:
        return []
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
    levels = U.make_levels(
        c["trigger"], c["stop"], "bullish",
        entry_condition=(f"trade above {c['trigger']:.2f} "
                         + ("(prior high)" if c["trigger"] == c["prior_high"] else "(gap open)")),
        stop_basis="trigger_session_low")
    anchors = [
        {"t": int(bars[i - 1]["t"]), "price": float(c["prior_close"])},
        {"t": int(bars[i]["t"]), "price": float(c["close"])},
    ]
    extras = {
        "variant": c["variant"], "label_variants": c["label_variants"],
        "prior_dcr": c["dcr1"], "trigger_dcr": c["dcr"], "gap_pct": c["gap_pct"],
        "gap_over_high": c["gap_over_high"], "push_held_k4": c["k4_held"],
        "rvol50": c["rvol50"], "character_change_m3": c["character_change_m3"],
        "sma200_rising_m4": c["sma200_rising_m4"], "close_to_mas": c["close_to_mas"],
        "support_or_undercut": c["support_or_undercut"],
        "prior_high": round(c["prior_high"], 2), "prior_close": round(c["prior_close"], 2),
    }
    narrative = _narrative(c, levels, context)
    return U.build_detection(
        pattern_id=_PATTERN_ID, pattern_name=_PATTERN_NAME, direction="bullish",
        bars=bars, trig_idx=i, start_idx=i - 1, anchors=anchors,
        anchor_roles=["weak_prior_close", "kicker_session"], extras=extras,
        levels=levels, context=context, narrative=narrative,
        geom=geom, vol=vol, ctx=ctx)


def _narrative(c, levels, context) -> dict:
    held = "and held it into the close" if c["k4_held"] else "but closed back under it"
    rv = f"{c['rvol50']:.1f}x" if c["rvol50"] is not None else "unmeasured"
    labels = ", ".join(c["label_variants"]) or "none"
    headline = (
        f"UCT Kicker - weak prior close (DCR {c['dcr1']:.2f}) followed by a {c['gap_pct']:.1f}% gap "
        f"up through the prior high ${c['prior_high']:.2f}; entry ${levels['entry']:.2f}, "
        f"stop ${levels['stop']:.2f} at the low of day."
    )
    what_it_is = (
        f"A kicker is a one-session change of character. The prior session closed weak, with its "
        f"close sitting {c['dcr1'] * 100:.0f}% of the way up its range at ${c['prior_close']:.2f}, "
        f"which is where short-term sellers felt in control. The next session opened at "
        f"${c['open']:.2f}, a {c['gap_pct']:.1f}% gap above that weak close, and traded up through "
        f"the prior high of ${c['prior_high']:.2f} {held}. Everyone who sold or shorted the weak "
        f"close is offside from the first print, and the gap itself is the evidence that demand "
        f"arrived overnight rather than drifting in. The rule that fires here is the core rule kept "
        f"after a blind review: a weak prior close (DCR at or below 0.35, or a red day closing in the "
        f"lower 60% of its range), an open above the prior close by at least a tenth of the prior day's range, and a break of the prior high. "
        f"Looser readings are recorded as labels only; the labels present on this session are: "
        f"{labels}. {U.PROVENANCE_NOTE}"
    )
    why_it_matters = (
        f"The trigger session printed relative volume of {rv} its 50-bar average and closed with a "
        f"DCR of {c['dcr']:.2f}. The setup is forming in {U.context_phrase(context)}. Kickers carry "
        f"the most weight when they launch off support (a pullback into the 20/21-day EMA or the "
        f"50-day SMA) rather than out of nowhere, and when the gap clears the prior high outright, "
        f"because that leaves no overhead supply from the prior session. Here the gap "
        f"{'did' if c['gap_over_high'] else 'did not'} open above the prior high, and the support "
        f"context reads {', '.join(c['support_or_undercut']) or 'no nearby moving-average support'}. "
        f"A kicker that holds its gap tends to resolve quickly, which is why the stop can be tight: "
        f"the low of day is the level the whole thesis depends on, and the reward is measured in "
        f"multiples of that small risk rather than in a distant price target."
    )
    what_to_watch_for = (
        f"The entry is a trade through ${levels['entry']:.2f}, which is the prior session's high "
        f"when the open was below it, or the open itself when the stock gapped clean over it. "
        f"Ideally the session closes in the upper part of its range and above the prior high, "
        f"confirming the push; follow-through over the next one to three sessions should come on "
        f"volume at or above average. Watch whether the stock holds the gap on any intraday dip; "
        f"a fill of the gap back to the prior close of ${c['prior_close']:.2f} is the first warning. "
        f"Targets are expressed in R: the first at ${levels['target_primary']:.2f} (2R) and the "
        f"second at ${levels['target_secondary']:.2f} (3R), measured from the low-of-day stop. "
        f"Trailing a stop under each higher low or under the 10-day average keeps a winner open "
        f"while protecting the initial edge once price moves away from the entry area."
    )
    failure_signal = (
        f"The setup fails if price trades below the trigger session's low of ${levels['stop']:.2f}. "
        f"That is the level the kicker was built on: if the gap cannot hold the low of the day it "
        f"opened, the change of character did not happen and the weak close of the prior session "
        f"is back in charge. An earlier warning is a close back under the prior close of "
        f"${c['prior_close']:.2f}, which fills the gap and erases the overnight demand that made "
        f"the pattern meaningful. Because the stop is the low of day, risk is usually small and "
        f"should be sized so a loss is routine; do not widen the stop, do not add to a position "
        f"that has filled its gap, and treat a failed kicker as information about the tape rather "
        f"than as a reason to try again on the same name the following session."
    )
    return {"headline": headline, "what_it_is": what_it_is, "why_it_matters": why_it_matters,
            "what_to_watch_for": what_to_watch_for, "failure_signal": failure_signal}


register(_PATTERN_ID, detect_uct_kicker)
