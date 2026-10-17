"""UCT Undercut & Reclaim detector - pattern_id `uct_undercut_reclaim`. INTERNAL (admin-only).

An undercut-and-reclaim session trades BELOW a level the market was leaning on
and closes back ABOVE it the same day, in the upper half of its range, inside an
uptrend. The flush through the level runs the obvious stops; the close back over
it says the sellers who did that could not hold the price down.

This is a NEW detector beside `u_and_r` (which requires a red close below
support after a consolidation) and `wyckoff_spring`; it does not change either.
It is a port of the offline lab rule `undercut_reclaim_v2` (detector recall v2,
2026-10-16), written on the dev half of the traders' scored calls and frozen
before the test half ran. On the test half it lifted recall 11.7% -> 22.9% while
the fire rate on random ticker-days FELL 13.3% -> 9.5%; a blind review of its
fires on random days judged 14 yes / 3 no / 8 ambiguous, and 0 of 10 decoys yes.

The rule at session i (uses bars[:i+1] only):
  * close > SMA50                     (uptrend gate, record t12516)
  * close in the upper half of the session's range (DCR >= 0.5)
  * a candidate level L with low < L < close, from:
      prior_day_low   the previous session's low            (record t14711)
      range_low_10    the lowest low of the 10 prior sessions (record t18279)
      e21 / s50       the prior session's EMA21 / SMA50, only when the prior
                      session CLOSED above it (a level that held; record t4922)
    A wick-only undercut that closed back above counts; a red close is not required.
  The variant is the LAST level hit in that order; every level hit is listed.

Levels: entry = the close; pivot = the reclaimed level; stop = the undercut low
(the session's low). Geometry is the shared UCT idiom: a `candle_mark` whose two
anchors (with `anchor_roles`) are the reclaimed level at the bar it comes from
and the undercut low on the reclaim session, plus display-only
`geometry.secondary` horizontal lines for the reclaimed level and the stop.

Wrapper (shared with the other UCT trader-setup detectors, not part of the lab
rule): the liquidity floor, the newest of the last `MAX_TRIGGER_AGE` sessions
that qualifies, and a prior-session trigger is reported only while no later
session has traded through its stop. The parity test pins the rule itself
against the lab code, bar for bar.
"""
from __future__ import annotations

from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.liquidity import liquidity_floor


_PATTERN_ID = "uct_undercut_reclaim"
_PATTERN_NAME = "UCT Undercut & Reclaim"

# Lab constants (recall_v2.py, frozen before the test half ran). Do not tune here.
UR_RANGE_N = 10                # [P] range low = lowest low of the 10 sessions before
UR_MAS = ("e21", "s50")        # [T] a held 21 EMA / 50 SMA is a level (t4922)
UR_DCR = 0.5                   # [P] reclaim = close in the upper half of the range
UR_ABOVE_S50 = True            # [T] in an uptrend: close above the 50 SMA (t12516)
_MIN_IDX = 61                  # the lab's warm-up (SMA50 + slack)
_MIN_BARS = _MIN_IDX + 1

_LEVEL_LABEL = {
    "prior_day_low": "the prior session's low",
    "range_low_%d" % UR_RANGE_N: f"the {UR_RANGE_N}-session range low",
    "e21": "the 21-day EMA",
    "s50": "the 50-day SMA",
}


def evaluate(bars: list, S: dict, i: int) -> Optional[dict]:
    """The lab rule at session i. Returns a candidate dict or None.

    Mirrors `undercut_reclaim_v2(b, i)` exactly: same gates, same order, same
    level set. Reads bars[:i+1] only (S is causal)."""
    if i < _MIN_IDX or i >= len(bars) or S["s50"][i] is None or not S["atr"][i]:
        return None
    b = bars[i]
    h, l, c = b["h"], b["l"], b["c"]
    if UR_ABOVE_S50 and c <= S["s50"][i]:
        return None
    if h - l <= 0 or (c - l) < UR_DCR * (h - l):
        return None
    prev = bars[i - 1]
    window = bars[i - UR_RANGE_N:i]
    rlow = min(x["l"] for x in window)
    rlow_idx = max(k for k in range(i - UR_RANGE_N, i) if bars[k]["l"] == rlow)
    levels = [("prior_day_low", prev["l"], i - 1),
              ("range_low_%d" % UR_RANGE_N, rlow, rlow_idx)]
    for m in UR_MAS:
        if S[m][i - 1] is not None and prev["c"] > S[m][i - 1]:
            levels.append((m, S[m][i - 1], i - 1))
    hit = [(n, lv, k) for n, lv, k in levels if l < lv < c]
    if not hit:
        return None
    name, level, origin = hit[-1]
    a = S["atr"][i]
    v50 = S["v50"][i]
    rng = h - l
    return {
        "idx": i, "variant": name, "levels_hit": [n for n, _, _ in hit],
        "level_prices": {n: round(lv, 4) for n, lv, _ in hit},
        "level": level, "level_origin_idx": origin,
        "undercut_low": l, "undercut_depth_atr": round((level - l) / a, 2),
        "dcr": round((c - l) / rng, 3), "close": c, "open": b["o"],
        "wick_only": b["o"] >= level, "above_e21": S["e21"][i] is not None and c > S["e21"][i],
        "sma50": S["s50"][i], "rvol50": round(S["v"][i] / v50, 2) if v50 else None,
        "trigger": c, "stop": l,
    }


def _geometry_score(c: dict) -> float:
    g = 70.0
    g += min(15.0, 5.0 * (len(c["levels_hit"]) - 1))
    g += 5.0 if c["dcr"] >= 0.75 else 0.0
    g += 5.0 if c["above_e21"] else 0.0
    return round(min(100.0, g), 2)


def detect_uct_undercut_reclaim(bars: List[dict], context: dict) -> List[dict]:
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
    lvl_txt = _LEVEL_LABEL.get(c["variant"], c["variant"])
    levels = U.make_levels(c["trigger"], c["stop"], "bullish",
                           entry_condition=f"hold above {c['level']:.2f} ({lvl_txt}, reclaimed)",
                           stop_basis="below_undercut_low")
    levels["pivot"] = round(c["level"], 2)
    level, low, o = float(c["level"]), float(c["undercut_low"]), c["level_origin_idx"]
    anchors = [{"t": int(bars[o]["t"]), "price": level},
               {"t": int(bars[i]["t"]), "price": low}]
    secondary = [U.hline(bars, o, i, level, "pivot", f"Reclaimed {lvl_txt} {level:.2f}"),
                 U.hline(bars, o, i, low, "stop", f"Undercut low {low:.2f}")]
    extras = {
        "variant": c["variant"], "fired_variants": [c["variant"]], "label_variants": [],
        "levels_hit": c["levels_hit"], "level_prices": c["level_prices"],
        "reclaimed_level": round(level, 2), "undercut_low": round(c["undercut_low"], 2),
        "undercut_depth_atr": c["undercut_depth_atr"], "dcr": c["dcr"],
        "wick_only": c["wick_only"], "above_e21": c["above_e21"],
        "sma50": round(c["sma50"], 2), "rvol50": c["rvol50"],
        "lab_rule": "recall_v2.undercut_reclaim_v2",
    }
    det = U.build_detection(
        pattern_id=_PATTERN_ID, pattern_name=_PATTERN_NAME, direction="bullish",
        bars=bars, trig_idx=i, start_idx=min(o, i), anchors=anchors,
        anchor_roles=["reclaimed_level", "undercut_low"], extras=extras,
        levels=levels, context=context, narrative=_narrative(c, levels, context, lvl_txt),
        geom=geom, vol=vol, ctx=ctx, secondary=secondary)
    return det


def _narrative(c, levels, context, lvl_txt) -> dict:
    others = [n for n in c["levels_hit"] if n != c["variant"]]
    also = (" It also reclaimed " + ", ".join(_LEVEL_LABEL.get(n, n) for n in others) + "."
            if others else "")
    headline = (
        f"UCT Undercut & Reclaim - traded {c['undercut_depth_atr']:.1f} ATR under {lvl_txt} "
        f"(${c['level']:.2f}) and closed back above it; entry ${levels['entry']:.2f}, "
        f"stop ${levels['stop']:.2f} under the undercut low."
    )
    what_it_is = (
        f"The session traded below {lvl_txt} at ${c['level']:.2f}, down to ${c['undercut_low']:.2f}, "
        f"then closed at ${c['close']:.2f}, back above the level and in the upper part of its range "
        f"(closing range {c['dcr']:.2f}). Price is above its 50-day average, so this is a flush inside "
        f"an uptrend rather than a break of one.{also} {U.PROVENANCE_NOTE}"
    )
    why_it_matters = (
        f"A dip through an obvious level triggers the stops parked under it; when price recovers the "
        f"level by the close, the selling that drove the undercut was absorbed. The setup forms in "
        f"{U.context_phrase(context)}. This detector is experimental and admin-only: on random days "
        f"most fires were judged real, but a meaningful share were ambiguous."
    )
    what_to_watch_for = (
        f"Follow-through above the session high, and pullbacks that hold the reclaimed level at "
        f"${levels['pivot']:.2f}. Targets are in R from the undercut low: "
        f"${levels['target_primary']:.2f} (2R) and ${levels['target_secondary']:.2f} (3R)."
    )
    failure_signal = (
        f"A trade below the undercut low at ${levels['stop']:.2f} means the reclaim failed and the "
        f"level is now resistance. A close back under ${levels['pivot']:.2f} is the early warning."
    )
    return {"headline": headline, "what_it_is": what_it_is, "why_it_matters": why_it_matters,
            "what_to_watch_for": what_to_watch_for, "failure_signal": failure_signal}


register(_PATTERN_ID, detect_uct_undercut_reclaim)
