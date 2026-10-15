"""UCT Oops Reversal detector — pattern_id `uct_oops_reversal`.

The oops reversal is a failed breakdown that reverses inside one session: the
stock opens below the prior close, trades under the prior session's low (the
"oops" — stops and late shorts are taken out), then reverses and closes back
above the prior close.

Fires (the scan variants kept after blind adjudication; both REQUIRE the undercut):
  v1 scan:            open < prior close, low < open, low < prior low,
                      close > prior close
  v2 scan:            v1 AND the prior session was itself down (prior close <
                      the close before it) — recorded as the primary variant
                      when it holds

Labels only (geometry.extras, never a reason to fire):
  v3 "no undercut" reading (o<c1, l<o, c>c1, c1<c2 without l<l1) — dropped as a
     trigger by the blind review, kept as a label
  v4 "reclaim the prior low" checklist minimum (o<c1, l<l1, c>l1)
  multi-day formation (undercut day 1-2 sessions back, reclaim today)
  intraday trigger traded (h > prior close but closed back under it)
  graded stage 1-6, strong close (DCR >= 0.90), series of red days, inside-day
  context, support at EMA9/20/21 or SMA50/200, trend, liquidity, extension.

The bearish mirror (gap above the prior close, trade over the prior high, close
back under the prior close) is NOT fired: the blind review measured only the
long side. Recorded here so its absence reads as a decision.

Entry: the prior close (the reclaim level, traded intraday by construction).
Stop: the trigger session's low (low of day).
"""
from __future__ import annotations

from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.liquidity import liquidity_floor


_PATTERN_ID = "uct_oops_reversal"
_PATTERN_NAME = "UCT Oops Reversal"

# [P] proposed defaults
OOPS_RED_STREAK_MIN = 2
OOPS_SUPPORT_ATR_BAND = 0.5
OOPS_EXTENDED_ATR = 5.0
OOPS_MULTIDAY_MAX_LAG = 2
OOPS_TREND_SMA50_SLOPE_BARS = 10
# [T] trader thresholds — not tunable
_OOPS_DCR_STRONG = 0.90
_OOPS_LIQ_PRICE, _OOPS_LIQ_MINV = 5, 500000
_MIN_BARS = 20


def evaluate(bars: list, S: dict, i: int) -> Optional[dict]:
    if i < 3:
        return None
    b, p, p2 = bars[i], bars[i - 1], bars[i - 2]
    if not (U.valid_bar(b) and U.valid_bar(p) and U.valid_bar(p2)):
        return None
    o, h, l, c = b["o"], b["h"], b["l"], b["c"]
    o1, h1, l1, c1 = p["o"], p["h"], p["l"], p["c"]
    c2 = p2["c"]
    v1 = o < c1 and l < l1 and l < o and c > c1
    if not v1:
        return None
    v2 = c1 < c2
    v3 = o < c1 and l < o and c > c1 and c1 < c2
    v4 = o < c1 and l < l1 and c > l1
    # multi-day formation [P]: undercut day j, first close over c[j-1] today
    multi = False
    for d in range(1, OOPS_MULTIDAY_MAX_LAG + 1):
        j = i - d
        if j < 1:
            break
        oj, lj, cprev, lprev = bars[j]["o"], bars[j]["l"], bars[j - 1]["c"], bars[j - 1]["l"]
        if not (oj < cprev and lj < lprev):
            continue
        if (c > cprev and min(x["l"] for x in bars[j + 1:i + 1]) >= lj
                and all(x["c"] <= cprev for x in bars[j:i])):
            multi = True
            break
    # graded stages 1-6
    s1 = o < c1
    s2 = s1 and l < l1
    s3 = s2 and c > l1
    s4 = s3 and c > c1
    s5 = s4 and c >= (h1 + l1) / 2
    s6 = s5 and (c > h1 or h > h1)
    stage = 6 if s6 else 5 if s5 else 4 if s4 else 3 if s3 else 2 if s2 else 1 if s1 else 0
    a = S["atr"][i]
    streak, k = 0, i - 1
    while k >= 1 and bars[k]["c"] < bars[k - 1]["c"]:
        streak += 1
        k -= 1
    inside1 = h1 <= p2["h"] and l1 >= p2["l"]
    inside2 = i >= 3 and p2["h"] <= bars[i - 3]["h"] and p2["l"] >= bars[i - 3]["l"]
    lows_at = U.near(l, (("ema9", S["e9"][i]), ("ema20", S["e20"][i]), ("ema21", S["e21"][i]),
                         ("sma50", S["s50"][i]), ("sma200", S["s200"][i])),
                     OOPS_SUPPORT_ATR_BAND * a if a else None)
    s50 = S["s50"][i]
    s50b = S["s50"][i - OOPS_TREND_SMA50_SLOPE_BARS] if i >= OOPS_TREND_SMA50_SLOPE_BARS else None
    s200 = S["s200"][i]
    minv3 = min(float(x["v"] or 0.0) for x in bars[i - 3:i])
    dcr = U.dcr(b)
    v50 = S["v50"][i]
    labels = [n for n, f in (("scan_v2_prior_down", v2), ("no_undercut_v3", v3),
                             ("reclaim_prior_low_v4", v4), ("multiday", multi)) if f]
    return {
        "idx": i, "variant": "scan_v2_prior_down" if v2 else "scan_v1",
        "label_variants": labels, "stage": stage, "dcr": round(dcr, 3),
        "strong_close": dcr >= _OOPS_DCR_STRONG, "prior_down": v2,
        "red_streak": streak, "series_of_red": streak >= OOPS_RED_STREAK_MIN,
        "at_support": lows_at, "after_inside_day": inside1,
        "double_inside": inside1 and inside2,
        "trend": bool((s200 and c > s200) or (s50 and s50b and s50 > s50b)),
        "liquid": c > _OOPS_LIQ_PRICE and minv3 > _OOPS_LIQ_MINV,
        "extended": bool(a and s50 and (c - s50) / a > OOPS_EXTENDED_ATR),
        "gap_below_low": o < l1, "super_oops_stage6": s6,
        "rvol50": round(float(b["v"] or 0.0) / v50, 2) if v50 else None,
        "undercut_pct": round((l1 - l) / l1 * 100.0, 2),
        "trigger": c1, "stop": l, "open": o, "high": h, "low": l, "close": c,
        "prior_close": c1, "prior_low": l1, "prior_high": h1,
    }


def _geometry_score(c: dict) -> float:
    g = 70.0
    g += 10.0 if c["prior_down"] else 0.0
    g += 10.0 if c["strong_close"] else (5.0 if c["dcr"] >= 0.70 else 0.0)
    g += 5.0 if c["stage"] >= 5 else 0.0
    g += 5.0 if c["super_oops_stage6"] else 0.0
    return round(min(100.0, g), 2)


def detect_uct_oops_reversal(bars: List[dict], context: dict) -> List[dict]:
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
                           entry_condition=f"reclaim of the prior close {c['trigger']:.2f}",
                           stop_basis="trigger_session_low")
    anchors = [
        {"t": int(bars[i - 1]["t"]), "price": float(c["prior_low"])},
        {"t": int(bars[i]["t"]), "price": float(c["low"])},
        {"t": int(bars[i]["t"]), "price": float(c["close"])},
    ]
    extras = {
        "variant": c["variant"], "label_variants": c["label_variants"],
        "oops_stage": c["stage"], "trigger_dcr": c["dcr"],
        "strong_close_dcr90": c["strong_close"], "red_streak": c["red_streak"],
        "series_of_red": c["series_of_red"], "at_support": c["at_support"],
        "after_inside_day": c["after_inside_day"], "double_inside": c["double_inside"],
        "trend": c["trend"], "liquid": c["liquid"], "extended_guard": c["extended"],
        "gap_below_low": c["gap_below_low"], "super_oops_stage6": c["super_oops_stage6"],
        "undercut_pct": c["undercut_pct"], "rvol50": c["rvol50"],
        "prior_close": round(c["prior_close"], 2), "prior_low": round(c["prior_low"], 2),
    }
    return U.build_detection(
        pattern_id=_PATTERN_ID, pattern_name=_PATTERN_NAME, direction="bullish",
        bars=bars, trig_idx=i, start_idx=i - 1, anchors=anchors,
        anchor_roles=["prior_low", "undercut_low", "reclaim_close"], extras=extras,
        levels=levels, context=context, narrative=_narrative(c, levels, context),
        geom=geom, vol=vol, ctx=ctx)


def _narrative(c, levels, context) -> dict:
    labels = ", ".join(c["label_variants"]) or "none"
    rv = f"{c['rvol50']:.1f}x" if c["rvol50"] is not None else "unmeasured"
    headline = (
        f"UCT Oops Reversal - opened under the prior close, undercut the prior low "
        f"${c['prior_low']:.2f} by {c['undercut_pct']:.1f}%, then closed back over "
        f"${c['prior_close']:.2f}; stage {c['stage']} of 6, stop ${levels['stop']:.2f}."
    )
    what_it_is = (
        f"An oops reversal is a failed breakdown that reverses inside a single session. The stock "
        f"opened at ${c['open']:.2f}, below the prior close of ${c['prior_close']:.2f}, then traded "
        f"down to ${c['low']:.2f}, under the prior session's low of ${c['prior_low']:.2f}. That "
        f"undercut is the point of the pattern: stops resting under an obvious low are triggered and "
        f"late sellers commit, and then the selling dries up. Price reversed and closed at "
        f"${c['close']:.2f}, back above the prior close, so every seller below that level is now "
        f"offside. The rule that fires is the scan kept after a blind review: an open below the "
        f"prior close, a low below both the open and the prior low, and a close above the prior "
        f"close. A version that skipped the undercut was dropped as a trigger and is kept only as a "
        f"label. Labels present on this session: {labels}. {U.PROVENANCE_NOTE}"
    )
    why_it_matters = (
        f"The session graded stage {c['stage']} of the six-step progression (open under the prior "
        f"close, undercut, reclaim of the prior low, reclaim of the prior close, close above the "
        f"prior midpoint, then a push over the prior high). It closed with a DCR of {c['dcr']:.2f}"
        f"{' - a strong close in the top tenth of the range' if c['strong_close'] else ''}, on "
        f"relative volume of {rv} its 50-bar average, in {U.context_phrase(context)}. The pattern "
        f"carries more weight after a series of red sessions (here {c['red_streak']} in a row), "
        f"after an inside day, or when the undercut lands on a moving average "
        f"({', '.join(c['at_support']) or 'none nearby'}), because each of those concentrates the "
        f"stops that the undercut sweeps. The stop is the low of the day, which is the precise "
        f"level the reversal is built on, so the risk is defined by the session itself."
    )
    what_to_watch_for = (
        f"The trigger is the reclaim of the prior close at ${levels['entry']:.2f}; the session "
        f"already traded through it, so a follow-through session that holds above it is the "
        f"confirmation. Ideally the next one to three sessions build above the trigger day's "
        f"midpoint without returning to the undercut low, and volume on up days stays at or above "
        f"average. A stage 5 or 6 session (a close above the prior midpoint or a push over the "
        f"prior high of ${c['prior_high']:.2f}) is the stronger form. Targets are in R from the "
        f"low-of-day stop: ${levels['target_primary']:.2f} (2R) and ${levels['target_secondary']:.2f} "
        f"(3R). Trailing under each higher low lets a reversal that becomes a trend keep working, "
        f"while the small initial risk keeps a failed attempt cheap and easy to repeat. A quiet, "
        f"inside-range session right after the trigger is acceptable; a wide red session is not."
    )
    failure_signal = (
        f"The setup fails on a trade below the trigger session's low of ${levels['stop']:.2f}. The "
        f"whole premise is that the undercut exhausted the sellers; if price returns under the "
        f"undercut low the breakdown was real and the reversal was only a pause. A softer warning "
        f"is a close back under the prior close of ${c['prior_close']:.2f} on the next session, "
        f"which hands control back to the sellers who were trapped. The extension flag reads "
        f"{'extended above the 50-day average' if c['extended'] else 'not extended'}; reversals "
        f"far above the 50-day average have less room before supply returns. Size so the "
        f"low-of-day stop is a routine loss, never widen it, and do not average down into a "
        f"failed reversal - the next valid signal is a fresh setup, not a rescue of this one. The "
        f"pattern is most reliable where the undercut low lines up with a well-watched level."
    )
    return {"headline": headline, "what_it_is": what_it_is, "why_it_matters": why_it_matters,
            "what_to_watch_for": what_to_watch_for, "failure_signal": failure_signal}


register(_PATTERN_ID, detect_uct_oops_reversal)
