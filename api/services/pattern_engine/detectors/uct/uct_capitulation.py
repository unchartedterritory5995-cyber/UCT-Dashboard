"""UCT Capitulation detector — pattern_id `uct_capitulation`. INTERNAL (admin-only).

A rubber-band long: a stock that has been liquidated so hard and so fast that it
is stretched far below its own volatility band, on the kind of range and volume
that marks forced selling rather than an orderly decline.

Fires (the variants kept after blind adjudication):
  setup_day   on session i:
                C1 close more than 1 ATR below the lower Bollinger band (20, 2)
                C2 range of at least 2 ATR, or a drop from the prior close of 2 ATR
                C7 a prior cascade: the 3 sessions before fell >= 1.5 ATR (blind
                   review: one-day shocks out of nowhere were judged no)
                and at least one of: C3 accelerating losses over 3 down closes
                (each larger than the last), C4 record volume (beats every prior
                session in the lookback), or 2x average volume rising across 3
                down days
              vetoed by a steady decline on falling volume unless volume is a record
  gap_below   the session after a setup day opens below that day's low

Labels only: a 3-day 15% drop from above the 50-day, a stretch past the lower
band with range expansion or -4 ATR from the 50-day, a 0-5 star count, open
down-gaps in the last 10 sessions, extension from the 50-day in ATRs.

Entry: the close. Stop: the session low.

Record volume needs history: it is judged over the prior min(252, available)
sessions and only when at least 190 exist (the same floor as uct_hve), and the
lookback used is reported.
"""
from __future__ import annotations

from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.liquidity import liquidity_floor


_PATTERN_ID = "uct_capitulation"
_PATTERN_NAME = "UCT Capitulation"

# [P] proposed defaults (the only lab-tunable values)
CAP_RANGE_ATR = 2.0
CAP_STREAK = 3
CAP_SOFT_VOL_X = 2.0
CAP_EXT_ATR = -4.0
CAP_GAP_LOOKBACK = 10
CAP_JERSACE_DROP = 0.85
CAP_CASCADE_ATR = 1.5
CAP_VOL_SLOPE_BARS = 5
_RECORD_LOOKBACK = 252
_MIN_IDX = 60
_MIN_BARS = _MIN_IDX + 1


def _cap_day(bars, S, d) -> Optional[dict]:
    """Setup-day conditions on day d (bars <= d)."""
    b = bars[d]
    o, h, l, c, v = b["o"], b["h"], b["l"], b["c"], float(b["v"] or 0.0)
    c1 = S["c"][d - 1]
    a1, a = S["atr"][d - 1], S["atr"][d]
    bbl, s50 = S["bbl"][d], S["s50"][d]
    if not (a and a1 and bbl and s50):
        return None
    gate = l < bbl
    c1_ = c < bbl - 1.0 * a
    c2 = (h - l) >= CAP_RANGE_ATR * a1 or (c1 - l) >= CAP_RANGE_ATR * a1
    rets = [S["c"][d - k] / S["c"][d - k - 1] - 1 for k in range(CAP_STREAK)]
    c3 = all(r < 0 for r in rets) and all(abs(rets[k]) > abs(rets[k + 1]) for k in range(CAP_STREAK - 1))
    prior = S["v"][max(0, d - _RECORD_LOOKBACK):d]
    c4_hard = len(prior) >= U.HVE_DETECTOR_MIN_PRIOR and v >= max(prior)
    v50 = S["v50"][d - 1]
    downs = [k for k in range(d - 2, d + 1) if S["c"][k] < S["c"][k - 1]]
    rising = len(downs) == 3 and S["v"][d - 2] < S["v"][d - 1] < S["v"][d]
    c4_soft = bool(v50) and v >= CAP_SOFT_VOL_X * v50 and rising
    gaps = 0
    for k in range(d - CAP_GAP_LOOKBACK + 1, d + 1):
        if bars[k]["h"] < bars[k - 1]["l"] and all(bars[j]["h"] < bars[k - 1]["l"] for j in range(k, d + 1)):
            gaps += 1
    ext = (c - s50) / a
    n = CAP_VOL_SLOPE_BARS
    ys = S["v"][d - n + 1:d + 1]
    mx, my = (n - 1) / 2.0, sum(ys) / n
    falling_vol = sum((x - mx) * (y - my) for x, y in zip(range(n), ys)) < 0
    casc = (S["c"][d - 4] - S["c"][d - 1]) / a1 >= CAP_CASCADE_ATR
    c3d, s3d = S["c"][d - 3], S["s50"][d - 3]
    jers = bool(c3d and c < c3d * CAP_JERSACE_DROP and s3d and c3d > s3d)
    return {"gate": gate, "c1": c1_, "c2": c2, "c3": c3, "c4_hard": c4_hard, "c4_soft": c4_soft,
            "gaps": gaps, "ext": ext, "ext_deep": ext <= CAP_EXT_ATR, "falling_vol": falling_vol,
            "cascade": casc, "jersace": jers, "record_lookback": len(prior)}


def _is_setup(d: dict, cascade: bool) -> bool:
    return d["c1"] and d["c2"] and cascade and (d["c3"] or d["c4_hard"] or d["c4_soft"])


def evaluate(bars: list, S: dict, i: int) -> Optional[dict]:
    if i < _MIN_IDX or not (U.valid_bar(bars[i]) and U.valid_bar(bars[i - 1])):
        return None
    if "bbl" not in S:
        S["bbl"] = U.bb_lower(S["c"])
    d = _cap_day(bars, S, i)
    if d is None:
        return None
    setup_day = _is_setup(d, d["cascade"]) and not (d["falling_vol"] and not d["c4_hard"])
    y = _cap_day(bars, S, i - 1)
    gap_below = (bool(y) and _is_setup(y, d["cascade"] or y["cascade"])
                 and bars[i]["o"] < bars[i - 1]["l"])
    fired = [n for n, f in (("setup_day", setup_day), ("gap_below", gap_below)) if f]
    if not fired:
        return None
    loose = (d["gate"] and d["c2"]) or (d["gate"] and d["ext_deep"])
    labels = [n for n, f in (("three_day_drop_from_trend", d["jersace"]), ("loose_stretch", loose)) if f]
    stars = sum([d["c1"], d["c2"], d["c3"] or d["c4_hard"], d["gaps"] >= 2, d["ext_deep"]])
    v50 = S["v50"][i]
    b = bars[i]
    return {
        "idx": i, "variant": fired[0], "fired_variants": fired, "label_variants": labels,
        "stars": stars, "ext_atr": round(d["ext"], 2), "open_gaps": d["gaps"],
        "record_volume": d["c4_hard"], "record_lookback": d["record_lookback"],
        "accelerating": d["c3"], "falling_volume": d["falling_vol"],
        "gap_below_pct": round((bars[i - 1]["l"] / b["o"] - 1) * 100.0, 2) if gap_below else None,
        "rvol50": round(S["v"][i] / v50, 2) if v50 else None,
        "bb_lower": S["bbl"][i], "trigger": b["c"], "stop": b["l"], "close": b["c"], "low": b["l"],
    }


def _geometry_score(c: dict) -> float:
    return round(min(100.0, 60.0 + 8.0 * c["stars"]), 2)


def detect_uct_capitulation(bars: List[dict], context: dict) -> List[dict]:
    if len(bars) < _MIN_BARS or not liquidity_floor(bars).passes:
        return []
    S = U.series(bars)
    S["bbl"] = U.bb_lower(S["c"])
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
                           entry_condition=f"reversal from {c['close']:.2f} after the flush",
                           stop_basis="session_low")
    anchors = [{"t": int(bars[i]["t"]), "price": float(c["low"])}]
    extras = {
        "variant": c["variant"], "fired_variants": c["fired_variants"],
        "label_variants": c["label_variants"], "stars": c["stars"], "ext_atr": c["ext_atr"],
        "open_gaps": c["open_gaps"], "record_volume": c["record_volume"],
        "record_lookback": c["record_lookback"], "accelerating": c["accelerating"],
        "falling_volume": c["falling_volume"], "gap_below_pct": c["gap_below_pct"],
        "rvol50": c["rvol50"], "bb_lower": round(c["bb_lower"], 2),
    }
    return U.build_detection(
        pattern_id=_PATTERN_ID, pattern_name=_PATTERN_NAME, direction="bullish",
        bars=bars, trig_idx=i, start_idx=max(0, i - 4), anchors=anchors,
        anchor_roles=["capitulation_session"], extras=extras, levels=levels, context=context,
        narrative=_narrative(c, levels, context), geom=geom, vol=vol, ctx=ctx)


def _narrative(c, levels, context) -> dict:
    labels = ", ".join(c["label_variants"]) or "none"
    how = ("a session that closed more than one ATR under its lower Bollinger band on a wide range "
           "after a multi-day cascade" if c["variant"] == "setup_day" else
           f"a gap below the prior session's low ({c['gap_below_pct']:.1f}%) the day after such a flush")
    fuel = ", ".join(x for x, f in (("record volume", c["record_volume"]),
                                    ("losses accelerating day over day", c["accelerating"])) if f) \
        or "heavy, rising volume across the down days"
    headline = (
        f"UCT Capitulation - {c['stars']}-star flush, {c['ext_atr']:.1f} ATR from the 50-day after a "
        f"multi-day cascade; entry ${levels['entry']:.2f}, stop ${levels['stop']:.2f} at the low of day."
    )
    what_it_is = (
        f"This is a rubber-band setup: the stock has been sold so hard and so fast that it is stretched "
        f"far outside its normal volatility. The rule fired on {how}. The selling carried {fuel}, which "
        f"is what separates forced liquidation from an orderly decline. A slow grind lower on fading "
        f"volume is vetoed by the rule, because that is distribution, not capitulation. The close of "
        f"${c['close']:.2f} sits {c['ext_atr']:.1f} ATR from the 50-day average, and the star count of "
        f"{c['stars']} out of 5 tallies how many of the extremes are present at once. Looser readings "
        f"are labels only; present here: {labels}. {U.PROVENANCE_NOTE}"
    )
    why_it_matters = (
        f"When sellers are forced rather than willing, the selling exhausts itself, and the snapback "
        f"can be sharp because there is nobody left who has to sell. That is the whole edge: it is a "
        f"trade against an extreme, not with a trend, and it is rare by construction. The setup is "
        f"forming in {U.context_phrase(context)}, which matters more here than for any trend setup - a "
        f"flush inside a broad market liquidation can keep going. Relative volume is "
        f"{c['rvol50'] if c['rvol50'] is not None else 'unmeasured'}x the 50-bar average, and "
        f"{c['open_gaps']} unfilled down-gaps sit above price from the last ten sessions; those gaps "
        f"are often where a snapback runs into supply. The more extremes line up at once (the star "
        f"count), the more likely the selling was forced; a single extreme on its own is just a bad day."
    )
    what_to_watch_for = (
        f"Traders who play this usually wait for the turn rather than catching the bar: an open below "
        f"the flush day's low that then reverses, or a reclaim of the prior day's low intraday. The "
        f"entry here is the close, ${levels['entry']:.2f}, with the low of the day as the line in the "
        f"sand. The first targets are the open down-gaps and the lower band itself, which is where the "
        f"rubber band snaps back to; in R terms ${levels['target_primary']:.2f} (2R) and "
        f"${levels['target_secondary']:.2f} (3R). These are short-duration trades: if the snapback does "
        f"not come within a few sessions the reason to hold it is gone, and taking profits into the "
        f"first strong bounce is part of the plan rather than a failure of nerve. A second flush lower that holds above this "
        f"low on lighter volume is the classic higher-low confirmation many traders wait for before "
        f"committing full size."
    )
    failure_signal = (
        f"The setup fails on a trade below ${levels['stop']:.2f}, the low of the flush. A new low after "
        f"a capitulation day means the selling was not exhausted, and the next leg can be as violent as "
        f"the last one. Stay out of averaging down into it: the stop exists precisely because a stretched "
        f"stock can stay stretched. A bounce that stalls immediately and closes weak is the early "
        f"warning. Size this smaller than a trend trade, because the range that creates the opportunity "
        f"also makes the stop wide in dollars, and treat a failure as the market telling you the "
        f"liquidation has further to run rather than as a price that has become cheaper. Wait for a "
        f"fresh flush and a fresh turn before looking at the name again, rather than buying the next "
        f"red day on the strength of the last one."
    )
    return {"headline": headline, "what_it_is": what_it_is, "why_it_matters": why_it_matters,
            "what_to_watch_for": what_to_watch_for, "failure_signal": failure_signal}


register(_PATTERN_ID, detect_uct_capitulation)
