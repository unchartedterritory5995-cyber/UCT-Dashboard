"""Outside Bar / Key Reversal detector — Larry Williams + Tom Bulkowski.

The Outside Bar (also called 'engulfing bar' for its range — not body — or
'key reversal' in Larry Williams's vocabulary) is a one-bar pattern in
which the current bar's RANGE fully engulfs the prior bar's range:

  - current_high > prior_high
  - current_low < prior_low

Larry Williams popularized the term 'Key Reversal' in 'Long-Term Secrets
to Short-Term Trading' (Wiley, 1999): a bar whose range engulfs the prior
bar AND closes near an extreme (top or bottom) of its own range signals
a reversal of the prevailing trend. Tom Bulkowski's 'Encyclopedia of
Chart Patterns' (2nd ed., Wiley 2005) catalogues outside bars
statistically — when accompanied by above-average volume (>=1.3x prior
bar), they show approximately 62% follow-through reliability in the
direction of the close.

Direction inferred from close position within the bar's range:
  - Close in upper third (DCR >= 0.67) → bullish key reversal up
  - Close in lower third (DCR <= 0.33) → bearish key reversal down
  - Middle → neutral (low-signal outside bar, often skipped)

Conditions:
  - Current bar's HIGH > prior bar's HIGH
  - Current bar's LOW < prior bar's LOW
  - Volume on outside bar >= 1.3× prior bar's volume

Levels (bullish key reversal):
  - entry = bar high * 1.001
  - stop = bar low * 0.99
  - target = prior swing high + ATR(14)

Geometry: "candle_mark" at the outside bar.

Attribution: Larry Williams ("Long-Term Secrets to Short-Term Trading",
Wiley 1999 — popularized 'Key Reversal' terminology) + Tom Bulkowski
("Encyclopedia of Chart Patterns", 2nd ed. Wiley 2005 — statistical
reliability evidence). Modern practitioners: Linda Raschke, Adam Grimes
('The Art and Science of Technical Analysis', 2012) use outside bars as
core single-bar reversal triggers.
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.narrative_helpers import (
    dcr_phrase, dcr_interpretation, ma_alignment_phrase, regime_phrase,
    rs_trend_phrase, trend_stage_description, volume_signature_phrase,
)
from api.services.pattern_engine.primitives.dcr import compute_dcr
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "outside_bar"

_MIN_VOLUME_RATIO = 1.3
_DCR_UPPER_THIRD = 0.67
_DCR_LOWER_THIRD = 0.33
_ATR_PERIOD = 14
_SWING_LOOKBACK = 20
_CONFIDENCE_FLOOR = 50.0


def detect_outside_bar(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect Outside Bar / Key Reversal. Emits 0 or 1 detection."""
    n = len(bars)
    if n < _ATR_PERIOD + _SWING_LOOKBACK + 2:
        return []

    prev = bars[-2]
    curr = bars[-1]

    # Range engulfment
    if curr["h"] <= prev["h"]:
        return []
    if curr["l"] >= prev["l"]:
        return []

    # Volume confirmation
    prev_v = prev["v"]
    if prev_v <= 0:
        return []
    vol_ratio = curr["v"] / prev_v
    if vol_ratio < _MIN_VOLUME_RATIO:
        return []

    dcr = compute_dcr(curr)
    curr_range = curr["h"] - curr["l"]
    if curr_range <= 0:
        return []
    prev_range = prev["h"] - prev["l"] if prev["h"] > prev["l"] else 0.001
    range_ratio = curr_range / prev_range

    # Direction inference from close
    if dcr >= _DCR_UPPER_THIRD:
        direction = "bullish"
    elif dcr <= _DCR_LOWER_THIRD:
        direction = "bearish"
    else:
        direction = "neutral"

    atr14 = _atr(bars[-_ATR_PERIOD - 1:])
    if atr14 <= 0:
        return []

    swing_window = bars[-_SWING_LOOKBACK - 1:-1]
    prior_swing_high = max(b["h"] for b in swing_window)
    prior_swing_low = min(b["l"] for b in swing_window)

    candidate = {
        "prev_bar": prev,
        "curr_bar": curr,
        "prev_high": prev["h"],
        "prev_low": prev["l"],
        "current_high": curr["h"],
        "current_low": curr["l"],
        "current_close": curr["c"],
        "current_open": curr["o"],
        "dcr": dcr,
        "range_ratio_to_prior": range_ratio,
        "volume_ratio": vol_ratio,
        "direction_inferred": direction,
        "atr14": atr14,
        "prior_swing_high": prior_swing_high,
        "prior_swing_low": prior_swing_low,
    }

    geom_score = _score_geometry(candidate)
    vol_score = _score_volume(candidate)
    ctx_score = _score_context(context, direction)
    hist_score = 50.0
    confidence = round(
        0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
    )
    if confidence < _CONFIDENCE_FLOOR:
        return []

    d = _build_detection(bars, candidate, confidence, context,
                         geom_score, vol_score, ctx_score, hist_score)
    return [d]


def _atr(bars: List[Bar]) -> float:
    if len(bars) < 2:
        return 0.0
    trs = []
    for i in range(1, len(bars)):
        b = bars[i]
        pc = bars[i - 1]["c"]
        tr = max(b["h"] - b["l"], abs(b["h"] - pc), abs(b["l"] - pc))
        trs.append(tr)
    return sum(trs) / len(trs) if trs else 0.0


def _score_geometry(c: dict) -> float:
    """Stronger engulfment (range_ratio) + cleaner DCR position = higher."""
    rr = c["range_ratio_to_prior"]
    if rr >= 2.5:
        range_score = 100.0
    elif rr >= 1.8:
        range_score = 85.0
    elif rr >= 1.4:
        range_score = 70.0
    else:
        range_score = 55.0  # >=1.0 baseline

    dcr = c["dcr"]
    # Extreme DCR = clean directional bias
    if dcr >= 0.85 or dcr <= 0.15:
        dcr_score = 100.0
    elif dcr >= 0.75 or dcr <= 0.25:
        dcr_score = 85.0
    elif dcr >= _DCR_UPPER_THIRD or dcr <= _DCR_LOWER_THIRD:
        dcr_score = 70.0
    else:
        dcr_score = 50.0

    return round(0.55 * range_score + 0.45 * dcr_score, 2)


def _score_volume(c: dict) -> float:
    """Heavier volume on outside bar = institutional commitment."""
    ratio = c["volume_ratio"]
    if ratio >= 2.5:
        return 100.0
    if ratio >= 2.0:
        return 85.0
    if ratio >= 1.6:
        return 70.0
    return 55.0  # >=1.3 baseline


def _score_context(context: dict, direction: str) -> float:
    score = 50.0
    stage = context.get("trend_stage")
    if direction == "bullish":
        if stage in (1, 4):
            score += 15.0   # outside bar reversal at bottom-of-decline = highest edge
        # DCR: +12 accumulation / -8 distribution (bullish detector)
        if context.get("dcr_signature") == "accumulation":
            score += 12.0
        elif context.get("dcr_signature") == "distribution":
            score -= 8.0
    elif direction == "bearish":
        if stage in (2, 3):
            score += 15.0   # outside bar reversal at top-of-advance = highest edge
        if context.get("dcr_signature") == "distribution":
            score += 12.0
        elif context.get("dcr_signature") == "accumulation":
            score -= 8.0
    else:
        score += 0.0   # neutral direction = no context boost
    return min(100.0, max(0.0, score))


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    curr_bar = c["curr_bar"]
    prev_bar = c["prev_bar"]
    atr14 = c["atr14"]
    direction = c["direction_inferred"]
    current_high = c["current_high"]
    current_low = c["current_low"]

    if direction == "bullish":
        entry = round(current_high * 1.001, 2)
        stop = round(current_low * 0.99, 2)
        target = round(c["prior_swing_high"] + atr14, 2)
        if target <= entry:
            target = round(entry + 2.0 * (entry - stop), 2)  # 2R fallback
    elif direction == "bearish":
        entry = round(current_low * 0.999, 2)
        stop = round(current_high * 1.01, 2)
        target = round(c["prior_swing_low"] - atr14, 2)
        if target >= entry:
            target = round(entry - 2.0 * (stop - entry), 2)
    else:
        # Neutral outside bar: emit but with the midpoint anchor
        entry = round(current_high * 1.001, 2)
        stop = round(current_low * 0.99, 2)
        target = round(entry + 2.0 * (entry - stop), 2)

    rr = abs((target - entry) / (entry - stop)) if entry != stop else 0.0
    stop_distance_pct = abs((entry - stop) / entry * 100.0) if entry > 0 else 0.0

    anchors = [
        {"t": int(prev_bar["t"]), "price": float(prev_bar["c"])},
        {"t": int(curr_bar["t"]), "price": float(curr_bar["c"])},
    ]

    extras = {
        "prior_high": round(c["prev_high"], 4),
        "prior_low": round(c["prev_low"], 4),
        "current_high": round(current_high, 4),
        "current_low": round(current_low, 4),
        "current_close": round(c["current_close"], 4),
        "current_open": round(c["current_open"], 4),
        "dcr": round(c["dcr"], 4),
        "range_ratio_to_prior": round(c["range_ratio_to_prior"], 3),
        "volume_ratio": round(c["volume_ratio"], 3),
        "direction_inferred": direction,
        "atr14": round(atr14, 4),
    }

    narrative = _compose_narrative(c, context, entry, stop, target, rr,
                                    stop_distance_pct, atr14, direction)
    now = int(time.time())

    pattern_name = "Outside Bar / Key Reversal"
    if direction == "bullish":
        pattern_name = "Outside Bar / Key Reversal Up (Williams)"
    elif direction == "bearish":
        pattern_name = "Outside Bar / Key Reversal Down (Williams)"

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": pattern_name,
        "category": "classical",
        "direction": direction,
        "start_t": int(prev_bar["t"]),
        "end_t": int(curr_bar["t"]),
        "pivot_ts": [int(prev_bar["t"]), int(curr_bar["t"])],
        "geometry": {
            "shape": "candle_mark",
            "anchors": anchors,
            "extras": extras,
        },
        "levels": {
            "entry": entry,
            "entry_condition": (
                f"close {'>' if direction != 'bearish' else '<'} {entry:.2f} "
                "(outside bar high/low + 0.1% buffer)"
            ),
            "stop": stop,
            "stop_basis": (
                "outside_bar_low_minus_1pct" if direction == "bullish"
                else "outside_bar_high_plus_1pct"
            ),
            "target_primary": target,
            "target_secondary": None,
            "risk_reward": round(rr, 2),
        },
        "context": context,
        "confidence": confidence,
        "quality_components": {
            "geometry_score": geom_score,
            "volume_score": vol_score,
            "context_score": ctx_score,
            "historical_score": hist_score,
        },
        "narrative": narrative,
        "status": "ready",
        "outcome": None,
        "detected_at": now,
        "last_seen_at": now,
    }


def _compose_narrative(c: dict, context: dict, entry: float, stop: float,
                       target: float, rr: float, stop_distance_pct: float,
                       atr14: float, direction: str) -> dict:
    prior_high = c["prev_high"]
    prior_low = c["prev_low"]
    current_high = c["current_high"]
    current_low = c["current_low"]
    current_close = c["current_close"]
    dcr = c["dcr"]
    range_ratio = c["range_ratio_to_prior"]
    vol_ratio = c["volume_ratio"]

    ma_phrase = ma_alignment_phrase(context.get("ma_alignment"))
    stage_phrase = trend_stage_description(context.get("trend_stage"))
    rs_phrase = rs_trend_phrase(context.get("rs_trend"))
    regime_p = regime_phrase(context.get("regime"))
    vol_phrase = volume_signature_phrase(context.get("volume_signature"))
    dcr_p = dcr_phrase(context.get("dcr_signature"), context.get("recent_dcr_avg"))

    dir_label = direction.upper() if direction != "neutral" else "NEUTRAL"
    dir_word = "bullish" if direction == "bullish" else "bearish" if direction == "bearish" else "neutral"

    headline = (
        f"Outside Bar / Key Reversal ({dir_label}) - current bar's range "
        f"${current_low:.2f}-${current_high:.2f} fully engulfs prior bar's "
        f"range ${prior_low:.2f}-${prior_high:.2f} ({range_ratio:.2f}x). "
        f"DCR {dcr * 100:.0f}% (close at ${current_close:.2f}), volume "
        f"{vol_ratio:.2f}x prior. Entry ${entry:.2f}, target ${target:.2f}, "
        f"R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Outside Bar (also called the 'engulfing bar' for its RANGE "
        f"rather than its body, or 'key reversal' in Larry Williams's "
        f"vocabulary) is one of the cleanest one-bar reversal patterns in "
        f"classical technical analysis. The geometric definition is "
        f"unambiguous: the current bar's HIGH (${current_high:.2f}) exceeds "
        f"the prior bar's high (${prior_high:.2f}) AND the current bar's "
        f"LOW (${current_low:.2f}) is below the prior bar's low "
        f"(${prior_low:.2f}). The current bar's range "
        f"(${(current_high - current_low):.2f}) is {range_ratio:.2f}x the "
        f"prior bar's range — the size dominance that distinguishes a "
        f"genuine outside bar from an ordinary minor range expansion. "
        f"Larry Williams popularized the term 'Key Reversal' in 'Long-Term "
        f"Secrets to Short-Term Trading' (Wiley, 1999): a bar that engulfs "
        f"the prior bar AND closes near an EXTREME of its own range "
        f"signals a directional reversal of the prevailing trend. Tom "
        f"Bulkowski's 'Encyclopedia of Chart Patterns' (2nd ed., Wiley "
        f"2005) catalogues outside bars statistically — when paired with "
        f"above-average volume (>=1.3x prior bar — here we see "
        f"{vol_ratio:.2f}x), Bulkowski's empirical reliability is "
        f"approximately 62% follow-through in the direction implied by "
        f"the close. The direction here is {dir_word} because the close "
        f"at ${current_close:.2f} prints with DCR {dcr * 100:.0f}% — "
        f"{'in the upper third (key reversal UP signature: buyers in control through close)' if direction == 'bullish' else 'in the lower third (key reversal DOWN signature: sellers in control through close)' if direction == 'bearish' else 'in the middle of the range (mixed signal — direction is weak)'}. "
        f"Modern practitioners — Linda Raschke (Street Smarts, 1995), "
        f"Adam Grimes ('The Art and Science of Technical Analysis', 2012), "
        f"and Tom Hougaard ('Best Loser Wins', 2022) — use outside bars "
        f"as core single-bar triggers when the range engulfment + close-"
        f"position + volume signature align."
    )

    why_it_matters = (
        f"This {dir_word} key reversal is firing inside {stage_phrase} with "
        f"{ma_phrase} alignment, {rs_phrase}, in {regime_p}. The pattern's "
        f"edge comes from what the bar geometry reveals about supply/demand "
        f"transition in a single session: the current bar opened, made BOTH "
        f"a new high (${current_high:.2f} above the prior bar's high) AND "
        f"a new low (${current_low:.2f} below the prior bar's low), then "
        f"closed at ${current_close:.2f} — placing the close at "
        f"{dcr * 100:.0f}% of the bar's range. Mechanically, the bar made "
        f"the FULL round trip — every prior-bar buyer below "
        f"${current_high:.2f} and every prior-bar seller above "
        f"${current_low:.2f} is now offside or in profit depending on the "
        f"close direction. The {range_ratio:.2f}x range expansion vs the "
        f"prior bar signals institutional commitment — the same bar size "
        f"signature Bulkowski's data attributes to genuine reversal moves "
        f"rather than noise. {vol_phrase} on the outside bar at "
        f"{vol_ratio:.2f}x prior reinforces the institutional-participation "
        f"signature. {dcr_p} {dcr_interpretation(context, dir_word) if dir_word in ('bullish', 'bearish') else 'DCR signal is informational only for neutral outside bars.'} "
        f"The structural edge of the outside bar specifically: it provides "
        f"a SINGLE-BAR sentiment-reversal signature with explicit volume "
        f"confirmation in one trading session — no multi-bar pattern "
        f"required. This is why Williams, Bulkowski, Raschke, and Grimes "
        f"all treat it as a primary tactical trigger. The asymmetric reward "
        f"profile is clean: a {stop_distance_pct:.2f}% stop distance "
        f"against the prior-swing-{'high' if direction == 'bullish' else 'low'}-"
        f"plus-ATR target produces R:R {rr:.1f}."
    )

    what_to_watch_for = (
        f"Trigger: a close {'above' if direction != 'bearish' else 'below'} "
        f"${entry:.2f} (the outside bar's "
        f"{'high' if direction != 'bearish' else 'low'} plus a 0.1% buffer) "
        f"on the next bar. Williams's specific execution discipline: (a) "
        f"the confirmation bar must close in the direction of the outside "
        f"bar's DCR — if DCR was 75%+ (bullish) but next bar closes red "
        f"and inside the outside bar's range, the signal is suspect; (b) "
        f"the confirmation bar's volume should be equal to or greater than "
        f"the outside bar's already-elevated reading; (c) the outside bar's "
        f"own low/high becomes the structural stop reference — break it "
        f"and the entire one-bar reversal thesis is invalidated. "
        f"Bulkowski's data adds nuance: outside bars in already-trending "
        f"environments (Stage 2 or 4) often signal CONTINUATION rather "
        f"than reversal — the bar is the start of a new leg in the "
        f"existing direction rather than a reversal. In counter-trend "
        f"contexts (Stage 1 or 4 with a bullish-DCR outside bar, OR Stage "
        f"2/3 with a bearish-DCR outside bar), the reversal interpretation "
        f"dominates. The ATR(14) of {atr14:.4f} sets the target reference: "
        f"prior swing {'high' if direction == 'bullish' else 'low'} plus "
        f"one ATR is the minimum projection; clean outside-bar reversals "
        f"often extend 2-3x ATR in the implied direction within 5-10 bars. "
        f"Position sizing: at the {stop_distance_pct:.2f}% stop distance, "
        f"risking 0.5% of account implies "
        f"{(0.5 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.1f}% "
        f"of equity per position. Adam Grimes's added rule: if the outside "
        f"bar prints inside a clear chart structure (at support for "
        f"bullish, at resistance for bearish), the edge is meaningfully "
        f"higher than the same bar mid-range. Williams's tactical note: "
        f"outside bars at session boundaries (last bar of week / month) "
        f"have empirically stronger follow-through than mid-session bars "
        f"in his proprietary backtests."
    )

    failure_signal = (
        f"Outside bars fail approximately 38% of the time even with full "
        f"filtering — Bulkowski's published reliability is ~62%. The "
        f"asymmetric reward must offset the 38% miss rate, which is why "
        f"the target should always exceed 2R minimum. This trade is "
        f"invalidated if price closes "
        f"{'below' if direction == 'bullish' else 'above'} ${stop:.2f} "
        f"(outside bar "
        f"{'low minus 1%' if direction == 'bullish' else 'high plus 1%'}) "
        f"— that signals the one-bar reversal thesis is broken and the "
        f"prior trend has resumed. The most common failure mode: the "
        f"confirmation bar closes against the outside bar's DCR direction, "
        f"meaning the bar that triggered the signal already had the "
        f"reversal IN it, and there's no follow-through to capture. "
        f"Williams's mitigation: NEVER chase the trigger mid-bar — wait "
        f"for the close-confirmation on the NEXT session before sizing in. "
        f"The secondary failure: the outside bar triggers and runs 1-2 ATR "
        f"in favor, then reverses entirely back through the outside bar's "
        f"opposite extreme. This 'failed key reversal' often precedes a "
        f"sharp extension in the OPPOSITE direction (Bulkowski's reversed-"
        f"signal pattern) because the failed reversal traps short-term "
        f"traders who entered on the signal. Mitigation: tighten stop to "
        f"breakeven once price moves 1.5 ATR in favor; if it reverses to "
        f"breakeven, exit cleanly rather than waiting for the structural "
        f"stop. The deepest invalidation: a NEUTRAL outside bar (DCR "
        f"between 0.33 and 0.67) often represents indecision rather than "
        f"reversal — these bars are statistically lower-edge and frequently "
        f"resolve in EITHER direction with reduced follow-through. Treat "
        f"a neutral outside bar as informational only, not as a trade "
        f"trigger. Williams's discipline summary: 'the outside bar tells "
        f"you sentiment FLIPPED in one session, but the next session tells "
        f"you whether the flip holds.' Honor that two-bar confirmation "
        f"requirement and the outside-bar edge becomes structural; ignore "
        f"it and the failure rate doubles."
    )

    return {
        "headline": headline,
        "what_it_is": what_it_is,
        "why_it_matters": why_it_matters,
        "what_to_watch_for": what_to_watch_for,
        "failure_signal": failure_signal,
    }


register(_PATTERN_ID, detect_outside_bar)
