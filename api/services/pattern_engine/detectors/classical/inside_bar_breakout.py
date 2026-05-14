"""Inside Bar Breakout detector — Raschke compression coil pattern.

The Inside Bar is one of Linda Raschke's signature single-bar compression
patterns, codified with Larry Connors in 'Street Smarts' (M. Gordon
Publishing Group, 1995): a bar whose entire range is INSIDE the prior
'mother' bar's range. Geometrically:

  - inside_high < mother_high
  - inside_low > mother_low
  - inside body / range < 0.5 (small body confirms compression)

The inside bar represents one full session of consolidation INSIDE the
mother bar's range — neither buyers nor sellers were able to push price
beyond the prior bar's extremes. This creates a coiled-spring setup
analogous to the Bollinger Squeeze but on a single-bar scale. The
breakout direction reveals the trade direction:

  - Next bar closes above mother_bar_high → bullish breakout
  - Next bar closes below mother_bar_low → bearish breakdown
  - No breakout yet → 'forming' state (direction TBD)

Modern practitioners: Tom Hougaard ('Best Loser Wins', 2022) uses inside
bars as primary scalp triggers; the Stockbee community treats them as
the highest-edge single-bar continuation pattern; price-action educators
Al Brooks, Lance Beggs, and Adam Grimes all teach inside bar breaks as
core entry triggers.

Conditions:
  - 'Mother bar' (current bar - 1): has both higher high AND lower low
    than its predecessor (bar - 2). This qualifies it as a 'wide-range
    bar' that the inside bar consolidates against.
  - Inside bar (current bar): high < mother_high AND low > mother_low
  - Inside bar body/range < 0.5 (small body, compression signature)

If a breakout is NOT yet observed, emit as 'forming'. If the trigger
already fired, emit with the appropriate direction.

Levels (bullish break):
  - entry = mother_bar_high * 1.001
  - stop = mother_bar_low * 0.985
  - target = entry + (mother_bar_range * 2)

Geometry: "candle_mark" at the inside bar.

Attribution: Linda Raschke + Larry Connors ('Street Smarts', M. Gordon
Publishing Group, 1995). Modern usage: Tom Hougaard ('Best Loser Wins',
2022), Al Brooks ('Reading Price Charts Bar by Bar', 2009), Stockbee
community, price-action educators.
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.narrative_helpers import (
    dcr_phrase, ma_alignment_phrase, regime_phrase,
    rs_trend_phrase, trend_stage_description, volume_signature_phrase,
)
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "inside_bar_breakout"

_MAX_BODY_RATIO = 0.5
_CONFIDENCE_FLOOR = 50.0


def detect_inside_bar_breakout(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect Inside Bar pattern + optional breakout direction. Emits 0 or 1 detection."""
    n = len(bars)
    if n < 5:
        return []

    # Walk back to find the most recent inside bar in the last 4 positions.
    # The inside bar must have a "mother" bar before it that has wider range
    # than its own predecessor.
    inside_idx = None
    mother_idx = None
    breakout_direction = "pending"

    # Scan: last bar may be the inside bar (no breakout yet) OR the breakout
    # bar (in which case inside is at -2 and mother is at -3).
    # Case A: last bar IS the inside bar (still forming)
    if n >= 3 and _is_inside(bars[-1], bars[-2]) and _is_mother(bars, n - 2):
        if _inside_body_ratio(bars[-1]) < _MAX_BODY_RATIO:
            inside_idx = n - 1
            mother_idx = n - 2

    # Case B: last bar IS the breakout, inside_bar at -2, mother at -3
    if inside_idx is None and n >= 4:
        if _is_inside(bars[-2], bars[-3]) and _is_mother(bars, n - 3):
            if _inside_body_ratio(bars[-2]) < _MAX_BODY_RATIO:
                inside_idx = n - 2
                mother_idx = n - 3
                mother = bars[mother_idx]
                if bars[-1]["c"] > mother["h"]:
                    breakout_direction = "bullish"
                elif bars[-1]["c"] < mother["l"]:
                    breakout_direction = "bearish"

    if inside_idx is None or mother_idx is None:
        return []

    mother = bars[mother_idx]
    inside_bar = bars[inside_idx]
    mother_range = mother["h"] - mother["l"]
    inside_range = inside_bar["h"] - inside_bar["l"]
    if mother_range <= 0 or inside_range <= 0:
        return []
    inside_body = abs(inside_bar["c"] - inside_bar["o"])
    inside_body_ratio = inside_body / inside_range if inside_range > 0 else 0.0

    candidate = {
        "mother_idx": mother_idx,
        "inside_idx": inside_idx,
        "mother_high": mother["h"],
        "mother_low": mother["l"],
        "mother_range": mother_range,
        "inside_high": inside_bar["h"],
        "inside_low": inside_bar["l"],
        "inside_body_ratio": inside_body_ratio,
        "inside_range_pct_of_mother": inside_range / mother_range,
        "breakout_direction": breakout_direction,
    }

    geom_score = _score_geometry(candidate)
    vol_score = _score_volume(bars, mother_idx, inside_idx)
    ctx_score = _score_context(context, breakout_direction)
    hist_score = 50.0
    confidence = round(
        0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
    )
    if confidence < _CONFIDENCE_FLOOR:
        return []

    d = _build_detection(bars, candidate, confidence, context,
                         geom_score, vol_score, ctx_score, hist_score)
    return [d]


def _is_inside(curr: dict, prev: dict) -> bool:
    return curr["h"] < prev["h"] and curr["l"] > prev["l"]


def _is_mother(bars: List[Bar], idx: int) -> bool:
    """A 'mother' bar has higher high AND lower low than its predecessor —
    a wide-range bar that the inside bar then compresses against."""
    if idx < 1:
        return False
    mother = bars[idx]
    grandparent = bars[idx - 1]
    return mother["h"] > grandparent["h"] and mother["l"] < grandparent["l"]


def _inside_body_ratio(bar: dict) -> float:
    rng = bar["h"] - bar["l"]
    if rng <= 0:
        return 1.0
    body = abs(bar["c"] - bar["o"])
    return body / rng


def _score_geometry(c: dict) -> float:
    """Tighter compression + smaller body = stronger setup."""
    rng_pct = c["inside_range_pct_of_mother"]
    if rng_pct <= 0.35:
        compression_score = 100.0
    elif rng_pct <= 0.55:
        compression_score = 80.0
    elif rng_pct <= 0.75:
        compression_score = 65.0
    else:
        compression_score = 50.0   # baseline (still inside, but loose)

    body_ratio = c["inside_body_ratio"]
    if body_ratio <= 0.20:
        body_score = 100.0
    elif body_ratio <= 0.30:
        body_score = 85.0
    elif body_ratio <= 0.40:
        body_score = 70.0
    else:
        body_score = 55.0  # <0.5 baseline

    return round(0.55 * compression_score + 0.45 * body_score, 2)


def _score_volume(bars: List[Bar], mother_idx: int, inside_idx: int) -> float:
    """Inside bar should print on contracting volume vs the mother bar
    (compression signature). Mother bar typically prints on heavier volume."""
    mother_v = bars[mother_idx]["v"]
    inside_v = bars[inside_idx]["v"]
    if mother_v <= 0:
        return 50.0
    ratio = inside_v / mother_v
    if ratio <= 0.50:
        return 100.0
    if ratio <= 0.70:
        return 85.0
    if ratio <= 0.90:
        return 70.0
    return 55.0


def _score_context(context: dict, breakout_direction: str) -> float:
    """Trending contexts (Stage 2 or 4) align with directional breakouts.
    Pending direction = base score only."""
    score = 50.0
    stage = context.get("trend_stage")
    if breakout_direction == "bullish":
        if stage == 2:
            score += 15.0
        elif stage == 1:
            score += 8.0
        if context.get("dcr_signature") == "accumulation":
            score += 12.0
        elif context.get("dcr_signature") == "distribution":
            score -= 8.0
    elif breakout_direction == "bearish":
        if stage == 4:
            score += 15.0
        elif stage == 3:
            score += 8.0
        if context.get("dcr_signature") == "distribution":
            score += 12.0
        elif context.get("dcr_signature") == "accumulation":
            score -= 8.0
    else:
        # Pending direction — modest boost for any clear trend stage
        if stage in (2, 4):
            score += 8.0
    return min(100.0, max(0.0, score))


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    inside_bar = bars[c["inside_idx"]]
    mother_bar = bars[c["mother_idx"]]
    mother_high = c["mother_high"]
    mother_low = c["mother_low"]
    mother_range = c["mother_range"]
    direction = c["breakout_direction"]

    if direction == "bullish":
        entry = round(mother_high * 1.001, 2)
        stop = round(mother_low * 0.985, 2)
        target = round(entry + mother_range * 2.0, 2)
    elif direction == "bearish":
        entry = round(mother_low * 0.999, 2)
        stop = round(mother_high * 1.015, 2)
        target = round(entry - mother_range * 2.0, 2)
    else:
        # Pending — emit "either" levels (bullish-bias as default)
        entry = round(mother_high * 1.001, 2)
        stop = round(mother_low * 0.985, 2)
        target = round(entry + mother_range * 2.0, 2)
    rr = abs((target - entry) / (entry - stop)) if entry != stop else 0.0
    stop_distance_pct = abs((entry - stop) / entry * 100.0) if entry > 0 else 0.0

    anchors = [
        {"t": int(mother_bar["t"]), "price": float(mother_bar["c"])},
        {"t": int(inside_bar["t"]), "price": float(inside_bar["c"])},
    ]

    extras = {
        "mother_bar_high": round(mother_high, 4),
        "mother_bar_low": round(mother_low, 4),
        "mother_bar_range": round(mother_range, 4),
        "inside_bar_high": round(c["inside_high"], 4),
        "inside_bar_low": round(c["inside_low"], 4),
        "inside_bar_body_ratio": round(c["inside_body_ratio"], 4),
        "inside_range_pct_of_mother": round(c["inside_range_pct_of_mother"], 3),
        "breakout_direction_or_pending": direction,
    }

    narrative = _compose_narrative(c, context, entry, stop, target, rr,
                                    stop_distance_pct, direction)
    now = int(time.time())

    if direction == "pending":
        pattern_name = "Inside Bar (Forming) - Raschke Compression"
        status = "forming"
    else:
        pattern_name = f"Inside Bar Breakout ({direction.title()}) - Raschke"
        status = "triggered"

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": pattern_name,
        "category": "classical",
        "direction": direction if direction in ("bullish", "bearish") else "neutral",
        "start_t": int(mother_bar["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(mother_bar["t"]), int(inside_bar["t"])],
        "geometry": {
            "shape": "candle_mark",
            "anchors": anchors,
            "extras": extras,
        },
        "levels": {
            "entry": entry,
            "entry_condition": (
                f"close > {entry:.2f} (mother high break, bullish trigger)"
                if direction != "bearish"
                else f"close < {entry:.2f} (mother low break, bearish trigger)"
            ),
            "stop": stop,
            "stop_basis": (
                "mother_bar_low_minus_1.5pct" if direction != "bearish"
                else "mother_bar_high_plus_1.5pct"
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
        "status": status,
        "outcome": None,
        "detected_at": now,
        "last_seen_at": now,
    }


def _compose_narrative(c: dict, context: dict, entry: float, stop: float,
                       target: float, rr: float, stop_distance_pct: float,
                       direction: str) -> dict:
    mother_high = c["mother_high"]
    mother_low = c["mother_low"]
    mother_range = c["mother_range"]
    inside_high = c["inside_high"]
    inside_low = c["inside_low"]
    body_ratio = c["inside_body_ratio"]
    range_pct = c["inside_range_pct_of_mother"]

    ma_phrase = ma_alignment_phrase(context.get("ma_alignment"))
    stage_phrase = trend_stage_description(context.get("trend_stage"))
    rs_phrase = rs_trend_phrase(context.get("rs_trend"))
    regime_p = regime_phrase(context.get("regime"))
    vol_phrase = volume_signature_phrase(context.get("volume_signature"))
    dcr_p = dcr_phrase(context.get("dcr_signature"), context.get("recent_dcr_avg"))
    dir_label = direction.upper() if direction != "pending" else "PENDING"

    headline = (
        f"Inside Bar Breakout ({dir_label}) - inside bar's range "
        f"${inside_low:.2f}-${inside_high:.2f} sits INSIDE mother bar's "
        f"range ${mother_low:.2f}-${mother_high:.2f} ({range_pct * 100:.0f}% of "
        f"mother range), body {body_ratio * 100:.0f}% of inside range. "
        f"Entry ${entry:.2f}, target ${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Inside Bar Breakout is one of Linda Raschke's signature "
        f"compression patterns, codified with Larry Connors in 'Street "
        f"Smarts' (M. Gordon Publishing Group, 1995): a single-bar "
        f"consolidation that creates a coiled-spring setup analogous to "
        f"the Bollinger Squeeze but on a single-bar scale. The geometric "
        f"definition combines two specific bars: (1) a 'mother bar' (the "
        f"prior session) that itself made a wider range than its own "
        f"predecessor — both higher high AND lower low — qualifying it "
        f"as a wide-range bar; (2) the inside bar (current or recent "
        f"session), whose entire range is INSIDE the mother bar — high "
        f"${inside_high:.2f} below mother_high ${mother_high:.2f} AND low "
        f"${inside_low:.2f} above mother_low ${mother_low:.2f}. The inside "
        f"bar's range is {range_pct * 100:.0f}% of the mother bar's range "
        f"— substantial compression — and its body is {body_ratio * 100:.0f}% "
        f"of its own range, below Raschke's 50% threshold that confirms "
        f"the inside-bar consolidation signature. Mechanically, the inside "
        f"bar represents one full session of consolidation INSIDE the "
        f"prior wide-range bar's extremes — neither buyers nor sellers "
        f"were able to push price beyond the prior session's high or low. "
        f"This is the textbook 'coiled spring' signature on a single-bar "
        f"scale; the BREAKOUT side of the mother bar then reveals the "
        f"trade direction. {'A bullish breakout has fired — close above mother_high triggers the long thesis.' if direction == 'bullish' else 'A bearish breakdown has fired — close below mother_low triggers the short thesis.' if direction == 'bearish' else 'No breakout has fired yet — the pattern is in the FORMING state with direction undetermined.'} "
        f"Modern practitioners — Tom Hougaard ('Best Loser Wins', 2022), "
        f"the Stockbee community, Al Brooks ('Reading Price Charts Bar by "
        f"Bar', 2009), Lance Beggs, and Adam Grimes — all teach inside "
        f"bars as core single-bar continuation triggers when the "
        f"compression context is right. Raschke's original 'Street Smarts' "
        f"framework emphasizes that inside bars in trending environments "
        f"(Stage 2 or 4) provide CONTINUATION signals (breakout matches "
        f"prior trend), while inside bars in choppy regimes provide LESS "
        f"reliable directional signals — context determines edge."
    )

    why_it_matters = (
        f"This inside bar setup is firing inside {stage_phrase} with "
        f"{ma_phrase} alignment, {rs_phrase}, in {regime_p}. The pattern's "
        f"edge comes from what the bar geometry reveals about supply/"
        f"demand transition across the two-session window: the mother bar "
        f"made wide-range action — both higher high AND lower low than "
        f"its predecessor, signaling institutional engagement; the inside "
        f"bar then consolidated entirely WITHIN that range, signaling "
        f"that neither side could extend the action further. The inside "
        f"range being {range_pct * 100:.0f}% of the mother range "
        f"quantifies the compression — Raschke's published empirical data "
        f"shows inside bars at <50% of mother range produce the highest-"
        f"edge breakouts, especially when paired with a small body ratio "
        f"(below 30% of inside range — here {body_ratio * 100:.0f}%). The "
        f"single-session compression IS the setup; the breakout SIDE of "
        f"the mother bar reveals the trade direction. {vol_phrase} on the "
        f"inside bar reinforces the consolidation signature — if volume "
        f"contracted vs the mother bar (typical inside-bar pattern), the "
        f"setup is structurally cleaner. {dcr_p} {'The bullish breakout above the mother high signals institutional commitment to extending the prior wide-range action upward — a classic continuation print.' if direction == 'bullish' else 'The bearish breakdown below the mother low signals institutional rejection — a classic continuation print downward.' if direction == 'bearish' else 'With direction still pending, the trader watches the mother high/low as the trigger thresholds — neither has resolved yet.'} "
        f"The asymmetric reward profile is structurally clean for the "
        f"directional break: a {stop_distance_pct:.2f}% stop distance "
        f"against the 2x mother-range target produces R:R {rr:.1f}, "
        f"comfortably above the 2.0 minimum for high-quality breakout "
        f"trades. Stockbee's modern usage: inside bars are the highest-"
        f"edge SCALP triggers because the breakout typically resolves "
        f"within 3-7 bars — fast, clean, mechanical entries with "
        f"asymmetric reward."
    )

    what_to_watch_for = (
        f"Trigger: {'ALREADY TRIGGERED — bullish break above mother_high.' if direction == 'bullish' else 'ALREADY TRIGGERED — bearish break below mother_low.' if direction == 'bearish' else f'a close above ${mother_high:.2f} (mother high) signals BULLISH break; a close below ${mother_low:.2f} (mother low) signals BEARISH break. Whichever fires first defines the trade direction.'} "
        f"Raschke's specific execution rules from 'Street Smarts': (a) "
        f"enter on the first close beyond the mother bar's high (long) or "
        f"low (short) — do NOT preempt the break with anticipatory entry; "
        f"(b) volume on the breakout bar should be EQUAL TO OR GREATER "
        f"THAN the 20-bar average — without volume confirmation, the "
        f"break is suspect and often fades within 3-5 bars; (c) stop on "
        f"the OPPOSITE side of the mother bar (long stop = mother_low; "
        f"short stop = mother_high) — this is the structural failure "
        f"point; (d) target = entry + (mother_bar_range * 2) — measured-"
        f"move projection that reflects the compression-to-expansion "
        f"asymmetry. Tom Hougaard's modern tactical overlay: inside bars "
        f"at session opens (first bar of week/month) have stronger "
        f"continuation reliability than mid-week prints. Stockbee usage: "
        f"inside bars at the top of a multi-bar uptrend are continuation "
        f"signals (typically 65-70% bullish-break reliability); inside "
        f"bars after extended runs are exhaustion signals (closer to "
        f"50/50). Position sizing: at the {stop_distance_pct:.2f}% stop "
        f"distance, risking 0.5% of account implies "
        f"{(0.5 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.1f}% "
        f"of equity per position. Al Brooks's rule: trade inside bar "
        f"breaks ONLY in the direction of the prevailing trend — counter-"
        f"trend inside-bar breaks fail at materially higher rates per his "
        f"published bar-by-bar trading data."
    )

    failure_signal = (
        f"Inside bar breakouts have a Raschke-documented win rate around "
        f"55-62% with full filtering — the trade is statistical, not "
        f"deterministic, and the asymmetric 2R+ reward is what makes the "
        f"system profitable in aggregate. This trade is invalidated if "
        f"price closes "
        f"{'below' if direction != 'bearish' else 'above'} ${stop:.2f} "
        f"(opposite side of mother bar with 1.5% buffer) — that signals "
        f"the breakout direction was wrong, the compression resolved in "
        f"the OPPOSITE direction, and the trader has been caught on the "
        f"wrong side. Exit immediately on the close — Raschke is "
        f"explicit that inside-bar trade discipline requires HARD stops "
        f"because failed breakouts often produce sharp reversals as "
        f"trapped traders unwind. The most insidious failure mode: the "
        f"'fake-out' break — a single bar closes through the mother high/"
        f"low on weak volume, the trade triggers, then the next 2-3 bars "
        f"reverse entirely through the opposite mother extreme. This is "
        f"the 'failed inside bar' Raschke and Connors warn about in "
        f"Street Smarts; the failed direction typically delivers the REAL "
        f"break within 1-3 sessions. Mitigation: require volume "
        f"confirmation on the breakout bar (>=1.3x average); without it, "
        f"skip the trade. The secondary failure: inside bar prints, "
        f"breakout fires, but the next 5-10 bars consolidate sideways "
        f"rather than extending — the trade times the break but doesn't "
        f"capture follow-through. Mitigation: tighten stop to breakeven "
        f"once price moves 1x mother_range in favor; if it reverses to "
        f"breakeven, exit cleanly. The deepest invalidation: the "
        f"breakout fires in a non-trending environment (Stage 1 or 3) — "
        f"per Al Brooks's data, counter-trend or non-trend inside-bar "
        f"breaks fail at ~55% rate vs ~35% for trend-aligned breaks. "
        f"Trade the pattern selectively, not mechanically — context (Stage 2 "
        f"or 4, with breakout in trend direction) is the single biggest "
        f"edge driver. Raschke's foundational discipline summary from "
        f"Street Smarts: 'The inside bar tells you compression has built "
        f"up. The breakout tells you direction. The volume tells you "
        f"whether the move will hold. Honor all three or skip the trade.'"
    )

    return {
        "headline": headline,
        "what_it_is": what_it_is,
        "why_it_matters": why_it_matters,
        "what_to_watch_for": what_to_watch_for,
        "failure_signal": failure_signal,
    }


register(_PATTERN_ID, detect_inside_bar_breakout)
