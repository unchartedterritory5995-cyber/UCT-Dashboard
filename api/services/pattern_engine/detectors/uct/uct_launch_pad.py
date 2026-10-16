"""UCT Launch Pad detector — pattern_id `uct_launch_pad`. INTERNAL (admin-only).

A launch pad is a stock whose short and intermediate moving averages have
converged into one tight cluster, with the 50-day average flat to curling up,
and price sitting just above that cluster rather than stretched away from it.
The averages agree on where fair value is, so a move out of the cluster starts
from a level the whole market is anchored to.

Fires (the variants kept after blind adjudication):
  strict      EMA8, EMA21 and SMA50 within 3.5% of price of each other; close
              above the cluster by at most 1 ATR; SMA50 rising over 5 bars or
              its slope turning up, and not still falling (10-bar change >= -1%)
  four_ma     EMA9, EMA20, SMA50 and SMA200 within 3.5% of price of each other,
              close above the cluster by at most 1 ATR (needs SMA200 history)

Labels only (geometry.extras, never a reason to fire):
  pinch_50_200     price between converging SMA50/SMA200 with the EMAs inside
  loose_on_cluster converged EMA8/EMA21/SMA50 with price on or just above them
  stack grade A/B/C (A = 8 > 21 > 50 > 200), near the 200, tight 6-bar range

Entry: the close. Stop: min(EMA21, SMA50) - 0.25 ATR.

History: production's daily scan passes 200 bars, so SMA200 exists only on the
newest of them; the four-MA variant and the 200-based labels are simply
unavailable on earlier sessions rather than guessed.
"""
from __future__ import annotations

from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.liquidity import liquidity_floor


_PATTERN_ID = "uct_launch_pad"
_PATTERN_NAME = "UCT Launch Pad"

# [P] proposed defaults (the only lab-tunable values)
LP_SPREAD_PCT = 0.035          # MA convergence: (max - min) / close <= this
LP_S50_MIN_SLOPE = -0.01       # SMA50 10-bar change >= this (not still falling)
LP_ABOVE_ATR = 1.0             # close above the cluster by at most this x ATR
LP_S50_SLOPE_BARS = 5          # "curling up": SMA50 vs 5 bars back
LP_TIGHT_BARS = 6              # tight-range label window
LP_TIGHT_ATR = 2.0             # ... range <= this x ATR
LP_NEAR200_PCT = 0.05          # near-200 label
LP_PINCH_PCT = 0.06            # pinch label: |SMA50 - SMA200| / close <= this
_MIN_IDX = 2 * LP_S50_SLOPE_BARS + 50
_MIN_BARS = _MIN_IDX + 1


def _converged(vals, c) -> bool:
    return (max(vals) - min(vals)) / c <= LP_SPREAD_PCT


def _s50_curling(S, i) -> bool:
    s50, s50b, s50c = S["s50"][i], S["s50"][i - LP_S50_SLOPE_BARS], S["s50"][i - 2 * LP_S50_SLOPE_BARS]
    if s50 is None or s50b is None or s50c is None:
        return False
    return ((s50 > s50b or (s50 - s50b) > (s50b - s50c))
            and s50 / s50c - 1 >= LP_S50_MIN_SLOPE)


def evaluate(bars: list, S: dict, i: int) -> Optional[dict]:
    """The adjudicated rule at session i. Returns a candidate dict or None."""
    if i < _MIN_IDX or not U.valid_bar(bars[i]):
        return None
    a, c = S["atr"][i], S["c"][i]
    e8, e9, e20, e21, s50, s200 = (S[k][i] for k in ("e8", "e9", "e20", "e21", "s50", "s200"))
    if not a or s50 is None:
        return None
    seg = bars[i - LP_TIGHT_BARS + 1:i + 1]
    tight = max(b["h"] for b in seg) - min(b["l"] for b in seg) <= LP_TIGHT_ATR * a

    trio = (e8, e21, s50)
    trio_conv = _converged(trio, c)
    above = c > max(trio) and c - max(trio) <= LP_ABOVE_ATR * a
    strict = trio_conv and above and _s50_curling(S, i)

    four_ma = pinch = False
    if s200 is not None:
        quad = (e9, e20, s50, s200)
        four_ma = _converged(quad, c) and c > max(quad) and c - max(quad) <= LP_ABOVE_ATR * a
        lo, hi = min(s50, s200), max(s50, s200)
        pinch = (lo < c < hi and abs(s50 - s200) / c <= LP_PINCH_PCT
                 and lo <= e8 <= hi and lo <= e21 <= hi)
    loose = trio_conv and min(trio) <= c <= max(trio) + LP_ABOVE_ATR * a

    fired = [n for n, f in (("strict", strict), ("four_ma", four_ma)) if f]
    if not fired:
        return None
    labels = [n for n, f in (("pinch_50_200", pinch), ("loose_on_cluster", loose)) if f]
    if s200 is not None:
        grade = "A" if e8 > e21 > s50 > s200 else "B" if e8 > e21 > s50 else "C"
    else:
        grade = "B" if e8 > e21 > s50 else "C"
    v50 = S["v50"][i]
    return {
        "idx": i, "variant": fired[0], "fired_variants": fired, "label_variants": labels,
        "spread_pct": round((max(trio) - min(trio)) / c * 100.0, 2),
        "above_cluster_atr": round((c - max(trio)) / a, 2),
        "stack_grade": grade, "tight_6bar": tight,
        "near_200": None if s200 is None else abs(s50 - s200) / c <= LP_NEAR200_PCT,
        "above_200": None if s200 is None else c > s200,
        "ema8": e8, "ema21": e21, "sma50": s50,
        "rvol50": round(S["v"][i] / v50, 2) if v50 else None,
        "trigger": c, "stop": min(e21, s50) - 0.25 * a, "close": c,
    }


def _geometry_score(c: dict) -> float:
    g = 70.0
    g += {"A": 10.0, "B": 5.0}.get(c["stack_grade"], 0.0)
    g += 5.0 if c["tight_6bar"] else 0.0
    g += 5.0 if c["near_200"] else 0.0
    g += 5.0 if len(c["fired_variants"]) > 1 else 0.0
    g += 5.0 if c["spread_pct"] <= 1.5 else 0.0
    return round(min(100.0, g), 2)


def detect_uct_launch_pad(bars: List[dict], context: dict) -> List[dict]:
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
    levels = U.make_levels(c["trigger"], c["stop"], "bullish",
                           entry_condition=f"hold above {c['trigger']:.2f} (close over the cluster)",
                           stop_basis="below_ema21_sma50_cluster")
    anchors = [{"t": int(bars[i]["t"]), "price": float(c["close"])}]
    extras = {
        "variant": c["variant"], "fired_variants": c["fired_variants"],
        "label_variants": c["label_variants"], "spread_pct": c["spread_pct"],
        "above_cluster_atr": c["above_cluster_atr"], "stack_grade": c["stack_grade"],
        "tight_6bar": c["tight_6bar"], "near_200": c["near_200"], "above_200": c["above_200"],
        "rvol50": c["rvol50"], "ema8": round(c["ema8"], 2), "ema21": round(c["ema21"], 2),
        "sma50": round(c["sma50"], 2),
    }
    return U.build_detection(
        pattern_id=_PATTERN_ID, pattern_name=_PATTERN_NAME, direction="bullish",
        bars=bars, trig_idx=i, start_idx=max(0, i - LP_TIGHT_BARS + 1), anchors=anchors,
        anchor_roles=["launch_pad_session"], extras=extras, levels=levels, context=context,
        narrative=_narrative(c, levels, context), geom=geom, vol=vol, ctx=ctx)


def _narrative(c, levels, context) -> dict:
    labels = ", ".join(c["label_variants"]) or "none"
    which = ("the eight, twenty-one and fifty-day averages" if c["variant"] == "strict"
             else "the nine, twenty, fifty and two-hundred-day averages")
    headline = (
        f"UCT Launch Pad - moving averages converged within {c['spread_pct']:.1f}% of price with the "
        f"close {c['above_cluster_atr']:.1f} ATR above the cluster; entry ${levels['entry']:.2f}, "
        f"stop ${levels['stop']:.2f} under the 21/50 cluster."
    )
    what_it_is = (
        f"A launch pad is a stock whose short and intermediate moving averages have come together into "
        f"one tight cluster. Here {which} sit within {c['spread_pct']:.1f}% of price of one another, and "
        f"the close of ${c['close']:.2f} is {c['above_cluster_atr']:.1f} ATR above the top of that "
        f"cluster, which is the 'sitting just above the averages' condition rather than a stock already "
        f"stretched away from them. The rule that fires also requires the 50-day average to be flat or "
        f"curling up and not still falling, because a tight cluster inside a falling 50-day is a "
        f"downtrend pausing, not a base. The stack grade is {c['stack_grade']} (A means the 8, 21, 50 "
        f"and 200 are in rising order). Looser readings are recorded as labels only; the labels present "
        f"here are: {labels}. {U.PROVENANCE_NOTE}"
    )
    why_it_matters = (
        f"When several averages converge, the market's short-term and intermediate views of value agree, "
        f"and volatility has usually contracted to get there. The setup is forming in "
        f"{U.context_phrase(context)}. A launch pad is a STATE more than a trigger: on a typical day a "
        f"meaningful share of liquid stocks will show converged averages, so the condition alone says "
        f"where risk is defined, not that a move is imminent. What separates the good ones is what the "
        f"traders who use it watch for next: a tight range above the cluster (here "
        f"{'present' if c['tight_6bar'] else 'not present'}), proximity to a rising 200-day "
        f"({'yes' if c['near_200'] else 'no' if c['near_200'] is not None else 'not measurable on this window'}), "
        f"and an expansion in range and volume out of the cluster. Relative volume today is "
        f"{c['rvol50'] if c['rvol50'] is not None else 'unmeasured'}x its 50-bar average."
    )
    what_to_watch_for = (
        f"The entry here is the close, ${levels['entry']:.2f}, with the idea that price holds above the "
        f"cluster and expands away from it. A stronger trigger many traders use is a break of a recent "
        f"high on rising volume after the averages have pinched, which turns the state into a move. "
        f"Watch whether the 8-day average stays above the 21-day and whether pullbacks hold the top of "
        f"the cluster; a tight, quiet drift above converged averages is constructive, a wide bar back "
        f"into them is not. Targets are expressed in R from a stop under the cluster: the first at "
        f"${levels['target_primary']:.2f} (2R) and the second at ${levels['target_secondary']:.2f} (3R). "
        f"Trailing under the rising 21-day average or under each higher low keeps a winner open while "
        f"locking in the part of the move that the cluster made possible in the first place."
    )
    failure_signal = (
        f"The setup fails on a trade below ${levels['stop']:.2f}, a quarter ATR under the lower of the "
        f"21-day and 50-day averages. A close back inside or under the cluster means the averages are no "
        f"longer support and the agreement between them is breaking in the wrong direction. A stock that "
        f"sits on converged averages for weeks without expanding is also a quiet failure: the longer it "
        f"goes nowhere the more the cluster flattens into a range, and the original reason to own it at "
        f"this level fades. Because the stop sits just under the averages the risk is usually modest; "
        f"keep it there rather than widening it, and treat a failure as information that buyers did not "
        f"defend the level the whole market was anchored to. A failed launch pad also tells you something "
        f"about the averages themselves: the cluster that was support becomes the first place sellers "
        f"lean on the way back up, so a quick reclaim is needed before it is worth another look."
    )
    return {"headline": headline, "what_it_is": what_it_is, "why_it_matters": why_it_matters,
            "what_to_watch_for": what_to_watch_for, "failure_signal": failure_signal}


register(_PATTERN_ID, detect_uct_launch_pad)
