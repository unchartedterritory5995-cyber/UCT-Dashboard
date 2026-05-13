"""Dark Cloud Cover candlestick detector.

Dark Cloud Cover is the bearish-reversal mirror of the Piercing Pattern - a
2-bar bearish reversal less aggressive than the Bearish Engulfing. Documented
by Steve Nison in 'Japanese Candlestick Charting Techniques' (1991), rooted in
Munehisa Homma's 18th-century Sakata trading rules, the dark cloud captures
the moment a sustained advance meets unexpected supply that pierces - but does
not fully engulf - the prior gain. Where bearish engulfing demands the red bar
overrun the entire prior green body, dark cloud asks only that the red bar
pierce more than 50% of the way down into it.

Definition (geometry):
  - Bar N-1: long green bar (body_pct >= 0.40 of its range)
  - Bar N: red bar
  - Bar N opens ABOVE bar N-1's high (gap-up open)
  - Bar N closes BELOW bar N-1's midpoint ((prev_open + prev_close) / 2)
  - Bar N closes ABOVE bar N-1's open (does NOT fully engulf to the downside)

Context (critical):
  - Dark Cloud is meaningful at a swing high OR after a recent advance
  - Bar N's DCR <= 0.4 indicates sellers held into the bell rather than fading
  - Context's DCR signature == "accumulation" + bar N DCR <= 0.30 = top transition

Direction: bearish.
Confirmation: the NEXT bar must close lower (below bar N's low).
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.dcr import compute_dcr, dcr_strength
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "dark_cloud_cover"
_MIN_BARS = 6
_MIN_PREV_BODY_PCT = 0.40
_SCAN_LOOKBACK = 5
_SWING_LOOKBACK = 10
_CONFIDENCE_FLOOR = 50.0


def detect_dark_cloud_cover(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect dark-cloud-cover 2-bar bearish reversals. Emits 0 or 1 Detection (most recent)."""
    if len(bars) < _MIN_BARS:
        return []

    detections: List[Detection] = []
    start = max(1, len(bars) - _SCAN_LOOKBACK)
    for i in range(start, len(bars)):
        candidate = _try_extract(bars, i)
        if candidate is None:
            continue

        geom_score = _score_geometry(candidate)
        vol_score = _score_volume(bars, i)
        ctx_score = _score_context(context, bars, i, candidate)
        hist_score = 50.0

        confidence = round(
            0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
        )
        if confidence < _CONFIDENCE_FLOOR:
            continue

        d = _build_detection(
            bars, candidate, i, confidence, context, geom_score, vol_score, ctx_score, hist_score
        )
        detections.append(d)

    if not detections:
        return []
    return detections[-1:]


def _try_extract(bars: List[Bar], i: int) -> Optional[dict]:
    if i < 1:
        return None
    prev_bar = bars[i - 1]
    curr_bar = bars[i]

    prev_o, prev_c, prev_h, prev_l = prev_bar["o"], prev_bar["c"], prev_bar["h"], prev_bar["l"]
    curr_o, curr_c = curr_bar["o"], curr_bar["c"]

    # Bar N-1: GREEN
    if prev_c <= prev_o:
        return None
    # Bar N: RED
    if curr_c >= curr_o:
        return None

    prev_body = prev_c - prev_o
    curr_body = curr_o - curr_c
    if prev_body <= 0 or curr_body <= 0:
        return None

    # Bar N-1 must be a LONG bar
    prev_range = prev_h - prev_l
    if prev_range <= 0:
        return None
    prev_body_pct = prev_body / prev_range
    if prev_body_pct < _MIN_PREV_BODY_PCT:
        return None

    # Bar N must GAP UP on open (open above prev high)
    if curr_o <= prev_h:
        return None

    # Bar N must close BELOW the midpoint of bar N-1's body
    midpoint = (prev_o + prev_c) / 2.0
    if curr_c >= midpoint:
        return None

    # Bar N must close ABOVE bar N-1's open (NOT fully engulfing — that's bearish engulfing)
    if curr_c <= prev_o:
        return None

    # Penetration: how far DOWN through the prior body did curr_close get?
    # 0% = at midpoint, 100% = at prev_open (full close-the-gap to the downside)
    penetration_pct = (midpoint - curr_c) / max(midpoint - prev_o, 0.0001)

    curr_range = curr_bar["h"] - curr_bar["l"]
    curr_body_pct = curr_body / curr_range if curr_range > 0 else 0.0

    gap_up_pct = (curr_o - prev_h) / max(prev_h, 0.0001)

    curr_dcr = compute_dcr(curr_bar)
    prev_dcr = compute_dcr(prev_bar)

    return {
        "prev_bar": prev_bar,
        "curr_bar": curr_bar,
        "prev_idx": i - 1,
        "curr_idx": i,
        "prev_open": prev_o,
        "prev_close": prev_c,
        "prev_high": prev_h,
        "prev_low": prev_l,
        "curr_open": curr_o,
        "curr_close": curr_c,
        "curr_high": curr_bar["h"],
        "curr_low": curr_bar["l"],
        "prev_body": prev_body,
        "curr_body": curr_body,
        "prev_body_pct": prev_body_pct,
        "curr_body_pct": curr_body_pct,
        "midpoint": midpoint,
        "penetration_pct": penetration_pct,
        "gap_up_pct": gap_up_pct,
        "curr_dcr": curr_dcr,
        "prev_dcr": prev_dcr,
    }


def _is_swing_high(bars: List[Bar], i: int) -> bool:
    lookback = bars[max(0, i - _SWING_LOOKBACK):i + 1]
    if len(lookback) < 4:
        return False
    high_max = max(b["h"] for b in lookback)
    low_min = min(b["l"] for b in lookback)
    rng = high_max - low_min
    if rng <= 0:
        return False
    bar_high = max(bars[i]["h"], bars[i - 1]["h"])
    return (high_max - bar_high) / rng <= 0.05


def _above_sma50(bars: List[Bar], i: int) -> bool:
    if i < 49:
        return False
    closes = [b["c"] for b in bars[i - 49:i + 1]]
    if not closes:
        return False
    sma = sum(closes) / len(closes)
    return bars[i]["c"] > sma


def _recent_advance_pct(bars: List[Bar], i: int) -> float:
    start = max(0, i - 14)
    window = bars[start:i + 1]
    if not window:
        return 0.0
    low = min(b["l"] for b in window)
    high_now = bars[i]["h"]
    if low <= 0:
        return 0.0
    return (high_now - low) / low


def _score_geometry(c: dict) -> float:
    pen = c["penetration_pct"]
    if pen >= 0.85:
        pen_score = 100.0
    elif pen >= 0.65:
        pen_score = 70.0 + (pen - 0.65) / 0.20 * 30.0
    elif pen >= 0.35:
        pen_score = 40.0 + (pen - 0.35) / 0.30 * 30.0
    elif pen >= 0.0:
        pen_score = pen / 0.35 * 40.0
    else:
        pen_score = 0.0

    cbp = c["curr_body_pct"]
    if cbp >= 0.65:
        body_score = 100.0
    elif cbp >= 0.45:
        body_score = 60.0 + (cbp - 0.45) / 0.20 * 40.0
    elif cbp >= 0.30:
        body_score = 30.0 + (cbp - 0.30) / 0.15 * 30.0
    else:
        body_score = max(0.0, cbp / 0.30 * 30.0)

    gap = c["gap_up_pct"]
    if gap >= 0.020:
        gap_score = 100.0
    elif gap >= 0.010:
        gap_score = 60.0 + (gap - 0.010) / 0.010 * 40.0
    elif gap >= 0.0:
        gap_score = 30.0 + gap / 0.010 * 30.0
    else:
        gap_score = 0.0

    return round(min(100.0, 0.50 * pen_score + 0.30 * body_score + 0.20 * gap_score), 2)


def _score_volume(bars: List[Bar], i: int) -> float:
    if i < 1:
        return 50.0
    prev_v = bars[i - 1]["v"]
    curr_v = bars[i]["v"]
    if prev_v <= 0:
        return 50.0
    ratio = curr_v / prev_v
    if ratio >= 2.0:
        return 100.0
    if ratio >= 1.5:
        return 75.0 + (ratio - 1.5) / 0.5 * 25.0
    if ratio >= 1.0:
        return 50.0 + (ratio - 1.0) / 0.5 * 25.0
    if ratio >= 0.7:
        return 25.0 + (ratio - 0.7) / 0.3 * 25.0
    return 25.0 * ratio / 0.7


def _score_context(context: dict, bars: List[Bar], i: int, c: dict) -> float:
    score = 25.0
    swing_high = _is_swing_high(bars, i)
    above_50 = _above_sma50(bars, i)
    advance = _recent_advance_pct(bars, i)

    if swing_high:
        score += 25
    if above_50:
        score += 10
    if advance >= 0.10:
        score += 15
    elif advance >= 0.05:
        score += 8

    curr_dcr = c["curr_dcr"]
    if curr_dcr <= 0.20:
        score += 15
    elif curr_dcr <= 0.40:
        score += 10
    elif curr_dcr <= 0.55:
        score += 5

    dcr_sig = context.get("dcr_signature")
    if dcr_sig == "accumulation" and curr_dcr <= 0.40:
        score += 10
    elif dcr_sig == "neutral" and curr_dcr <= 0.40:
        score += 5

    res = context.get("nearest_resistance")
    if res and res > 0 and abs(c["curr_high"] - res) / res <= 0.015:
        score += 5

    stage = context.get("trend_stage")
    if stage in (2, 3):
        score += 5

    return min(100.0, score)


def _trend_phrase(context: dict) -> str:
    stage = context.get("trend_stage", 0)
    if stage == 2: return "a Stage 2 uptrend"
    if stage == 1: return "a Stage 1 base/accumulation environment"
    if stage == 3: return "a Stage 3 distribution environment"
    if stage == 4: return "a Stage 4 downtrend environment"
    return "an undefined trend stage"


def _ma_phrase(context: dict) -> str:
    return {
        "stacked_bullish": "stacked-bullish",
        "stacked_bearish": "stacked-bearish",
        "mixed": "mixed",
    }.get(context.get("ma_alignment", "mixed"), "mixed")


def _rs_phrase(context: dict) -> str:
    return {"up": "improving", "down": "deteriorating", "flat": "neutral"}.get(
        context.get("rs_trend", "flat"), "neutral"
    )


def _build_detection(
    bars: List[Bar],
    c: dict,
    i: int,
    confidence: float,
    context: dict,
    geom_score: float,
    vol_score: float,
    ctx_score: float,
    hist_score: float,
) -> Detection:
    prev_bar = c["prev_bar"]
    curr_bar = c["curr_bar"]

    prev_body_pct_disp = round(c["prev_body_pct"] * 100, 2)
    curr_body_pct_disp = round(c["curr_body_pct"] * 100, 2)
    penetration_disp = round(c["penetration_pct"] * 100, 1)
    gap_disp = round(c["gap_up_pct"] * 100, 2)
    curr_dcr_pct = round(c["curr_dcr"] * 100, 1)
    prev_dcr_pct = round(c["prev_dcr"] * 100, 1)

    is_swing_high = _is_swing_high(bars, i)
    above_50 = _above_sma50(bars, i)
    advance_pct = _recent_advance_pct(bars, i) * 100

    prev_v = prev_bar["v"]
    curr_v = curr_bar["v"]
    vol_ratio = (curr_v / prev_v) if prev_v > 0 else 0.0
    vol_ratio_disp = f"{vol_ratio:.2f}x"

    # Levels — bearish trade
    pattern_high = max(curr_bar["h"], prev_bar["h"])
    pattern_low = min(curr_bar["l"], prev_bar["l"])
    entry = round(pattern_low * 0.999, 2)
    stop = round(pattern_high * 1.015, 2)
    measured = entry - 2 * (stop - entry)
    near_sup = context.get("nearest_support")
    if near_sup and near_sup < entry:
        target = round(max(near_sup, measured), 2)
        target_basis = "nearest_support_or_2R_measured_move_down"
    else:
        target = round(measured, 2)
        target_basis = "2R_measured_move_down"
    rr = (entry - target) / (stop - entry) if stop > entry else 0.0
    stop_distance_pct = (stop - entry) / entry * 100 if entry > 0 else 0.0

    if is_swing_high:
        position_phrase = "at a near-term swing high"
    elif above_50:
        position_phrase = "above the 50-bar SMA after recent advance"
    elif advance_pct >= 5.0:
        position_phrase = f"following a {advance_pct:.1f}% recent rally"
    else:
        position_phrase = "without a clear preceding advance"

    stage_phrase = _trend_phrase(context)
    ma_phrase = _ma_phrase(context)
    rs_phrase = _rs_phrase(context)
    regime = context.get("regime", "current")
    dcr_sig = context.get("dcr_signature", "neutral")
    recent_dcr_avg = context.get("recent_dcr_avg", 0.5)
    recent_dcr_pct = round(recent_dcr_avg * 100, 1)

    if c["curr_dcr"] <= 0.15:
        dcr_position = "the very bottom"
    elif c["curr_dcr"] <= 0.30:
        dcr_position = "the lower third"
    elif c["curr_dcr"] <= 0.45:
        dcr_position = "the lower half"
    else:
        dcr_position = "the middle"

    anchors = [
        {"t": int(prev_bar["t"]), "price": float(prev_bar["c"])},
        {"t": int(curr_bar["t"]), "price": float(curr_bar["c"])},
    ]
    now = int(time.time())

    headline = (
        f"Dark Cloud Cover {position_phrase} - bar N gapped up {gap_disp}% then closed "
        f"{penetration_disp}% through the prior {prev_body_pct_disp}% green body, DCR "
        f"{curr_dcr_pct}%, volume {vol_ratio_disp} prior bar."
    )

    what_it_is = (
        f"Dark Cloud Cover is the bearish-reversal mirror of the Piercing Pattern - a 2-bar "
        f"bearish reversal less aggressive than the Bearish Engulfing. Steve Nison documented "
        f"it in 'Japanese Candlestick Charting Techniques' (1991), tracing the pattern back "
        f"to Munehisa Homma's 18th-century Sakata rice trading rules. The pattern captures "
        f"the moment a sustained advance meets unexpected supply that pierces - but does not "
        f"fully engulf - the prior gain. Here, bar N-1 was a LONG green candle (body "
        f"{prev_body_pct_disp}% of its range, well above the 40% threshold for a 'long bar'), "
        f"opening at ${c['prev_open']:.2f} and closing at ${c['prev_close']:.2f}, extending "
        f"the uptrend with conviction. Bar N then GAPPED UP on the open to "
        f"${c['curr_open']:.2f} - {gap_disp}% above the prior bar's high of ${c['prev_high']:.2f} - "
        f"signaling continued bullish momentum, then REVERSED through the session and closed "
        f"at ${c['curr_close']:.2f}: {penetration_disp}% of the way DOWN through bar N-1's "
        f"body (measured from the midpoint ${c['midpoint']:.2f} toward the prior open "
        f"${c['prev_open']:.2f}). Crucially, the close is BELOW the prior midpoint (qualifying "
        f"as dark cloud) but ABOVE the prior open (if it had cleared that, this would be a "
        f"full bearish engulfing - a stronger signal but more demanding to set up). The "
        f"current bar's body of {curr_body_pct_disp}% of range with a DCR of {curr_dcr_pct}% "
        f"(close in {dcr_position} of the session) indicates "
        f"{'institutional sellers held into the bell against late-session demand' if c['curr_dcr'] <= 0.40 else 'moderate selling that warrants confirmation'}. "
        f"Volume on bar N was {vol_ratio_disp} the prior bar. Greg Morris's 'Candlestick "
        f"Charting Explained' frames dark cloud cover as a meaningful but not as decisive "
        f"reversal as the bearish engulfing — the close below the midpoint communicates "
        f"intent, but the failure to clear the prior open leaves room for further "
        f"accumulation. Adam Grimes's empirical probability research on dark cloud cover "
        f"emphasizes that follow-through edge is meaningfully higher when the second bar's "
        f"close pushes deep into the lower third of the prior bar's range rather than "
        f"barely scraping below the midpoint."
    )

    why_it_matters = (
        f"This dark cloud cover appears {position_phrase}, inside {stage_phrase} with "
        f"{ma_phrase} moving-average alignment and {rs_phrase} relative strength. The "
        f"signal's edge comes from the psychology of the gap-up failure: on bar N-1 the "
        f"bulls extended gains on a long-body candle (DCR {prev_dcr_pct}%, a strong close "
        f"into the session) - the kind of print that screams 'buy more tomorrow'. Bar N "
        f"opened with that expectation - the {gap_disp}% gap up to ${c['curr_open']:.2f} is "
        f"the bulls' best chance to confirm continuation, often on premarket news or FOMO "
        f"chase. Instead, sellers showed up intraday with enough force to reverse price "
        f"BACK through the gap and well into bar N-1's body, closing at ${c['curr_close']:.2f} - "
        f"{penetration_disp}% of the way down through the prior body. That is a structural "
        f"change in the supply profile: real sellers distributed into the morning enthusiasm "
        f"and then continued to hit bids all session long. The current bar's DCR of "
        f"{curr_dcr_pct}% confirms that sellers held into the bell rather than fading - a "
        f"critical detail because pure morning-spike-fade rebounds that recover into the "
        f"close are NOT dark cloud covers in spirit. Context's recent DCR average of "
        f"{recent_dcr_pct}% over the trailing 10 bars classifies the broader chart as "
        f"'{dcr_sig}' - "
        f"{'a textbook buyer-exhaustion setup where sellers are first appearing in size after a string of strong closes - the cleanest top transition' if dcr_sig == 'accumulation' else 'an indecisive base where bar N is the first decisive sell print after consolidation' if dcr_sig == 'neutral' else 'a distribution context where the dark cloud is corroborating continuation rather than initiating a top'}. "
        f"The dark cloud is the less aggressive sibling of the bearish engulfing - the close "
        f"didn't fully reverse the prior session, just pierced more than 50% down through it - "
        f"which means the failure rate is higher and confirmation is even more critical. "
        f"Recent 15-bar advance of {advance_pct:.1f}% places this pattern at a level where "
        f"sellers had structural reason to distribute. Current regime is {regime}."
    )

    what_to_watch_for = (
        f"Dark cloud cover REQUIRES next-bar bearish confirmation - more so than engulfing, "
        f"because the current bar's close didn't fully reverse the prior session. The trigger "
        f"is a close BELOW ${entry:.2f} (the lower of bar N or bar N-1 low, minus a 0.1% "
        f"buffer) on the next bar, ideally on volume of at least 1.3x the 20-bar average AND "
        f"with that bar's own DCR <= 0.35. Watch for: "
        f"(1) the confirmation bar's high staying below bar N's CLOSE (${c['curr_close']:.2f}) - "
        f"if the next bar lifts back into the dark cloud's body, the bearish read is "
        f"incomplete and the short is suspect; "
        f"(2) volume on the confirmation bar should be EQUAL TO OR GREATER THAN bar N's "
        f"{vol_ratio_disp}-vs-prior reading - shrinking volume means sellers from bar N "
        f"didn't follow through, and dark clouds with fading volume have one of the highest "
        f"failure rates in the bearish-candlestick taxonomy; "
        f"(3) ideally the confirmation bar's close undercuts bar N-1's OPEN (${c['prev_open']:.2f}) - "
        f"this is the 'belated engulfing' completion that turns a marginal dark cloud into "
        f"a high-conviction reversal; "
        f"(4) if 1-2 bars after the dark cloud trade entirely within bar N's range "
        f"(${c['curr_low']:.2f} to ${c['curr_high']:.2f}), the signal is suspended - don't "
        f"preempt the confirmation; "
        f"(5) DCR on the confirmation bar - a follow-through bar that prints a lower low "
        f"but DCR > 0.60 should be covered, because that signals buyers are accumulating "
        f"into the decline. Levels: entry ${entry:.2f}, stop ${stop:.2f} (basis: pattern "
        f"high plus 1.5%, {stop_distance_pct:.1f}% adverse move from entry), target "
        f"${target:.2f} (basis: {target_basis}), R:R {rr:.2f}. The 2R measured-move target "
        f"uses twice the stop distance as a minimum downside projection - if a nearby "
        f"support level ({'$' + format(near_sup, '.2f') if near_sup else 'none mapped'}) "
        f"caps the move sooner, cover partials there. For non-shorting accounts, the dark "
        f"cloud cover is also a defensive exit signal on long positions - sell into the "
        f"next bar's open or tighten the stop under bar N's low aggressively."
    )

    failure_signal = (
        f"Dark cloud cover patterns fail roughly 40-45% of the time when traded alone "
        f"without confirmation - a higher failure rate than the bearish engulfing because "
        f"the reversal is INCOMPLETE by definition: the close didn't fully reverse the "
        f"prior session, it just pierced more than halfway down. The pattern is invalidated "
        f"if the next bar closes back above bar N's high at ${c['curr_high']:.2f} (stop set "
        f"at ${stop:.2f}, 1.5% above the pattern high) - that signals the morning enthusiasm "
        f"reversal was a one-day liquidity event, not a true supply transition. More "
        f"insidious failure modes: "
        f"(1) the confirmation bar closes below entry but on weak volume AND DCR > 0.50 - "
        f"this is the 'fake dark cloud' where long liquidation creates the illusion of a "
        f"top but the institutional offer never materializes; supply re-emerges as demand "
        f"within 2-3 bars; "
        f"(2) the dark cloud prints inside a strong Stage 2 uptrend (here stage is "
        f"{context.get('trend_stage', 'undefined')}) with stacked-bullish MA where every "
        f"counter-trend dip has been bought - the burden of proof should rise to a "
        f"confirmation bar DCR <= 0.25 and volume >= 1.8x; "
        f"(3) the dark cloud's low tags a known support shelf - if pattern_low "
        f"${pattern_low:.2f} sits at or just above a prior pivot, demand below will absorb "
        f"the next 1-2 bars and break the structure; check the chart for prior pivots "
        f"within 1-2% before shorting; "
        f"(4) context DCR signature was already 'distribution' (avg DCR {recent_dcr_pct}%) - "
        f"in that case the dark cloud is corroborating an existing downtrend, not initiating "
        f"a reversal, and the asymmetric edge of catching a top is reduced; "
        f"(5) bar N's DCR was above 0.45 even though the close pierced the midpoint - this "
        f"is the 'dark cloud on a bounce' which has the worst statistical follow-through of "
        f"any dark cloud variant, because sellers didn't hold into the bell. Position sizing "
        f"must reflect the {stop_distance_pct:.1f}% stop distance: risking 0.5% of account "
        f"implies a position size of roughly {(0.5 / max(stop_distance_pct, 0.5)) * 100:.1f}% "
        f"of equity. Treat the dark cloud as a WARNING and a SETUP, never as a trigger - "
        f"the next bar fires the trigger, the stop saves the account when the rally resumes, "
        f"and the position size reflects the reality that 2-bar incomplete bearish reversals "
        f"in strong uptrends fail more often than they succeed."
    )

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Dark Cloud Cover",
        "category": "candlestick",
        "direction": "bearish",
        "start_t": int(prev_bar["t"]),
        "end_t": int(curr_bar["t"]),
        "pivot_ts": [int(prev_bar["t"]), int(curr_bar["t"])],
        "geometry": {
            "shape": "candle_mark",
            "anchors": anchors,
            "extras": {
                "prev_bar_body_pct": float(round(c["prev_body_pct"], 4)),
                "curr_bar_body_pct": float(round(c["curr_body_pct"], 4)),
                "penetration_pct": float(round(c["penetration_pct"], 4)),
                "gap_up_pct": float(round(c["gap_up_pct"], 4)),
                "curr_bar_dcr": float(round(c["curr_dcr"], 4)),
                "prev_bar_dcr": float(round(c["prev_dcr"], 4)),
                "volume_ratio": float(round(vol_ratio, 4)),
                "pattern_high": float(round(pattern_high, 4)),
                "pattern_low": float(round(pattern_low, 4)),
                "midpoint": float(round(c["midpoint"], 4)),
                "at_swing_high": bool(is_swing_high),
                "above_50sma": bool(above_50),
                "recent_advance_pct": float(round(advance_pct, 2)),
                "dcr_strength": dcr_strength(c["curr_dcr"]),
            },
        },
        "levels": {
            "entry": float(entry),
            "entry_condition": f"close < {entry:.2f} on next bar with volume >= 1.3x 20-bar avg + DCR <= 0.35",
            "stop": float(stop),
            "stop_basis": "pattern_high_plus_1.5pct",
            "target_primary": float(target),
            "target_secondary": None,
            "risk_reward": float(round(rr, 2)),
        },
        "context": context,
        "confidence": confidence,
        "quality_components": {
            "geometry_score": geom_score,
            "volume_score": vol_score,
            "context_score": ctx_score,
            "historical_score": hist_score,
        },
        "narrative": {
            "headline": headline,
            "what_it_is": what_it_is,
            "why_it_matters": why_it_matters,
            "what_to_watch_for": what_to_watch_for,
            "failure_signal": failure_signal,
        },
        "status": "ready",
        "outcome": None,
        "detected_at": now,
        "last_seen_at": now,
    }


register(_PATTERN_ID, detect_dark_cloud_cover)
