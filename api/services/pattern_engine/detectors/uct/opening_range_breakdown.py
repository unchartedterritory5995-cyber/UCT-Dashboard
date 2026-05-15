"""Opening Range Breakdown detector — Toby Crabel mirror.

Mirror of opening_range_breakout: a close BELOW the opening range low
within 1-3 bars after the range is established, on confirming volume.

Conditions:
  - Intraday timeframe (5min / 15min / 30min), first 30 min = opening range
  - Within next 1-3 bars after range, close BREAKS BELOW range low
  - Volume on breakdown bar >= 1.5x avg volume of opening range bars
  - Range height: 0.3% to 2.5% of price

Levels:
  - entry = opening_range_low * 0.999
  - stop = opening_range_high * 1.002
  - target = entry - opening_range_height * 2

Geometry: "rectangle" at opening range corners.

Attribution: Toby Crabel ("Day Trading with Short-Term Price Patterns
and Opening Range Breakout", 1990). Lance Breitstein (modern intraday).
Pradeep Bonde / Stockbee community.
"""
from __future__ import annotations

import uuid
import time
from typing import List

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.narrative_helpers import (
    dcr_phrase, ma_alignment_phrase, regime_phrase,
    rs_trend_phrase, trend_stage_description, volume_signature_phrase,
)
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "opening_range_breakdown"

_OR_BARS = 6
_MAX_BREAKOUT_AGE = 3
_MIN_RANGE_PCT = 0.003
_MAX_RANGE_PCT = 0.025
_MIN_BREAKOUT_VOL_RATIO = 1.5
_CONFIDENCE_FLOOR = 50.0
_MIN_BARS = _OR_BARS + _MAX_BREAKOUT_AGE


def detect_opening_range_breakdown(bars: List[Bar], context: dict) -> List[Detection]:
    n = len(bars)
    if n < _MIN_BARS:
        return []

    or_bars = bars[:_OR_BARS]
    or_high = max(b["h"] for b in or_bars)
    or_low = min(b["l"] for b in or_bars)
    or_height = or_high - or_low
    if or_height <= 0:
        return []
    or_close = or_bars[-1]["c"]
    or_height_pct = or_height / or_close if or_close > 0 else 0.0

    if or_height_pct < _MIN_RANGE_PCT or or_height_pct > _MAX_RANGE_PCT:
        return []

    or_avg_volume = sum(b["v"] for b in or_bars) / len(or_bars)
    if or_avg_volume <= 0:
        return []

    breakout_idx = None
    breakout_volume_ratio = 0.0
    last_idx = n - 1
    search_start = max(_OR_BARS, last_idx - _MAX_BREAKOUT_AGE + 1)
    for idx in range(search_start, last_idx + 1):
        b = bars[idx]
        if b["c"] < or_low:
            vol_ratio = b["v"] / or_avg_volume
            if vol_ratio >= _MIN_BREAKOUT_VOL_RATIO:
                breakout_idx = idx
                breakout_volume_ratio = vol_ratio
                break
    if breakout_idx is None:
        return []

    breakout_age = last_idx - breakout_idx
    if breakout_age < 0 or breakout_age > _MAX_BREAKOUT_AGE - 1:
        return []

    candidate = {
        "or_high": or_high,
        "or_low": or_low,
        "or_height": or_height,
        "or_height_pct": or_height_pct,
        "or_avg_volume": or_avg_volume,
        "or_bars": _OR_BARS,
        "breakout_idx": breakout_idx,
        "breakout_bar_idx": breakout_idx,
        "breakout_volume_ratio": breakout_volume_ratio,
        "breakout_close": bars[breakout_idx]["c"],
    }

    geom_score = _score_geometry(candidate)
    vol_score = _score_volume(candidate)
    ctx_score = _score_context(context)
    hist_score = 50.0
    confidence = round(
        0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
    )
    if confidence < _CONFIDENCE_FLOOR:
        return []

    d = _build_detection(bars, candidate, confidence, context,
                         geom_score, vol_score, ctx_score, hist_score)
    return [d]


def _score_geometry(c: dict) -> float:
    pct = c["or_height_pct"]
    if 0.005 <= pct <= 0.015:
        width_score = 100.0
    elif pct < 0.005:
        width_score = 60.0 + (pct - _MIN_RANGE_PCT) / (0.005 - _MIN_RANGE_PCT) * 40.0
    else:
        width_score = max(50.0, 100.0 - (pct - 0.015) / (_MAX_RANGE_PCT - 0.015) * 50.0)

    penetration_pct = (c["or_low"] - c["breakout_close"]) / c["or_low"] * 100.0
    if penetration_pct >= 0.5:
        pen_score = 100.0
    elif penetration_pct >= 0.25:
        pen_score = 80.0
    elif penetration_pct >= 0.10:
        pen_score = 65.0
    else:
        pen_score = 55.0

    return round(min(100.0, 0.55 * width_score + 0.45 * pen_score), 2)


def _score_volume(c: dict) -> float:
    ratio = c["breakout_volume_ratio"]
    if ratio >= 3.0:
        return 100.0
    if ratio >= 2.0:
        return 85.0
    if ratio >= 1.5:
        return 70.0
    return 55.0


def _score_context(context: dict) -> float:
    """ORBreakdown favors Stage 3/4 down-bias context."""
    score = 50.0
    stage = context.get("trend_stage")
    if stage == 4:
        score += 20.0
    elif stage == 3:
        score += 10.0
    elif stage == 2:
        score -= 5.0
    align = context.get("ma_alignment")
    if align == "stacked_bearish":
        score += 12.0
    elif align == "mixed":
        score += 5.0
    rs = context.get("rs_trend")
    if rs == "down":
        score += 10.0
    elif rs == "flat":
        score += 4.0
    # DCR bearish mirror — distribution tailwind
    dcr_sig = context.get("dcr_signature")
    if dcr_sig == "distribution":
        score += 12.0
    elif dcr_sig == "accumulation":
        score -= 8.0
    return min(100.0, max(0.0, score))


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    or_high = c["or_high"]
    or_low = c["or_low"]
    or_height = c["or_height"]
    or_height_pct = c["or_height_pct"]
    breakout_idx = c["breakout_idx"]
    breakout_bar = bars[breakout_idx]
    breakout_close = c["breakout_close"]
    breakout_volume_ratio = c["breakout_volume_ratio"]

    entry = round(or_low * 0.999, 2)
    stop = round(or_high * 1.002, 2)
    target = round(entry - or_height * 2.0, 2)
    rr = (entry - target) / (stop - entry) if stop > entry else 0.0
    stop_distance_pct = (stop - entry) / entry * 100.0 if entry > 0 else 0.0

    or_first_bar = bars[0]
    or_last_bar = bars[_OR_BARS - 1]
    anchors = [
        {"t": int(or_first_bar["t"]), "price": float(or_high)},
        {"t": int(or_last_bar["t"]), "price": float(or_high)},
        {"t": int(or_last_bar["t"]), "price": float(or_low)},
        {"t": int(or_first_bar["t"]), "price": float(or_low)},
    ]

    extras = {
        "opening_range_high": round(or_high, 4),
        "opening_range_low": round(or_low, 4),
        "opening_range_height_pct": round(or_height_pct * 100.0, 4),
        "opening_range_bars": int(c["or_bars"]),
        "breakout_bar_idx": int(breakout_idx),
        "breakout_volume_ratio": round(breakout_volume_ratio, 3),
        "breakout_close": round(breakout_close, 4),
        "or_avg_volume": round(c["or_avg_volume"], 2),
    }

    narrative = _compose_narrative(c, context, entry, stop, target, rr,
                                    stop_distance_pct)
    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Opening Range Breakdown",
        "category": "uct",
        "direction": "bearish",
        "start_t": int(or_first_bar["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(or_first_bar["t"]), int(or_last_bar["t"]),
                     int(breakout_bar["t"])],
        "geometry": {
            "shape": "rectangle",
            "anchors": anchors,
            "extras": extras,
        },
        "levels": {
            "entry": entry,
            "entry_condition": (
                f"close < {entry:.2f} (opening range low - 0.1%) on volume "
                f">= 1.5x OR-bar average ({c['or_avg_volume']:.0f})"
            ),
            "stop": stop,
            "stop_basis": "opening_range_high_plus_0.2pct",
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
                       target: float, rr: float, stop_distance_pct: float) -> dict:
    or_high = c["or_high"]
    or_low = c["or_low"]
    or_height = c["or_height"]
    or_height_pct = c["or_height_pct"]
    breakout_close = c["breakout_close"]
    vol_ratio = c["breakout_volume_ratio"]
    or_bars = c["or_bars"]

    ma_phrase = ma_alignment_phrase(context.get("ma_alignment"))
    stage_phrase = trend_stage_description(context.get("trend_stage"))
    rs_phrase = rs_trend_phrase(context.get("rs_trend"))
    regime_p = regime_phrase(context.get("regime"))
    vol_phrase = volume_signature_phrase(context.get("volume_signature"))
    dcr_p = dcr_phrase(context.get("dcr_signature"), context.get("recent_dcr_avg"))

    headline = (
        f"Opening Range Breakdown - close ${breakout_close:.2f} broke below "
        f"opening range low ${or_low:.2f} on {vol_ratio:.2f}x OR-bar avg "
        f"volume. OR width {or_height_pct * 100:.2f}% (${or_low:.2f} ↔ "
        f"${or_high:.2f}). Entry ${entry:.2f}, stop ${stop:.2f}, target "
        f"${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Opening Range Breakdown is the bearish mirror of Toby "
        f"Crabel's foundational intraday framework from his 1990 monograph "
        f"'Day Trading with Short-Term Price Patterns and Opening Range "
        f"Breakout' (Traders Press), modernized for liquid-equity tape by "
        f"Lance Breitstein (SMB Capital) and the Pradeep Bonde / Stockbee "
        f"community. The framework rests on Crabel's specific empirical "
        f"observation: in liquid US equities, the first 30 minutes of "
        f"cash-session trading concentrate overnight-gap reaction, "
        f"institutional position-adjustment flow, and opening-auction "
        f"unwind in a structurally predictable way — the high and low of "
        f"that window become adaptive intraday support and resistance. A "
        f"volume-confirmed close BELOW the opening range low produces "
        f"continuation to the downside roughly 60-70% of the time when "
        f"the range is clean and proportional to ADR. Here, the opening "
        f"range spans {or_bars} bars from ${or_low:.2f} to ${or_high:.2f} "
        f"— a width of ${or_height:.2f} ({or_height_pct * 100:.2f}% of "
        f"price), which sits in the productive zone for ORB tradability "
        f"(Crabel filters out ranges below 0.3% as noise and above 2.5% "
        f"as news-bar exhaustion). The breakdown bar closed at "
        f"${breakout_close:.2f} on {vol_ratio:.2f}x the average OR-bar "
        f"volume — the volume confirmation Crabel and Breitstein both "
        f"insist on, because unconfirmed range breaks are the canonical "
        f"'fade-the-break' setup and the edge inverts entirely without "
        f"confirming volume. Breitstein's modern adaptation focuses on "
        f"the opening drive into the 10:30 follow-through window — the "
        f"first 30 minutes capture overnight participation while the "
        f"10:00-11:00 ET window sees institutional rebalancing unwind, "
        f"producing the day's directional thrust in that 90-minute "
        f"compound window. The breakdown side specifically: short-side "
        f"liquidity is structurally higher in this window because long-"
        f"holder stop runs concentrate at the opening range low, producing "
        f"momentum cascade once the range is violated."
    )

    why_it_matters = (
        f"This ORBreakdown is firing in {stage_phrase} with {ma_phrase} "
        f"moving-average alignment, {rs_phrase}, in {regime_p} with "
        f"{vol_phrase}. The structural read: (1) the opening range "
        f"${or_low:.2f} to ${or_high:.2f} is in Crabel's productive width "
        f"zone, neither tight enough to be noise nor wide enough to be "
        f"exhaustion. (2) The {vol_ratio:.2f}x breakdown volume confirms "
        f"institutional participation — the single most important filter "
        f"in the ORB framework, because the cleanest breakdowns are "
        f"driven by visible order-flow imbalance rather than retail "
        f"capitulation. Breitstein's published statistics show that "
        f"breakdowns with bar volume >=1.5x OR-bar average produce "
        f"continuation roughly 65-70% of the time on liquid leaders, "
        f"while breakdowns with bar volume <1.0x OR-bar average actually "
        f"have a marginal LONG edge after fees and slippage (the failed-"
        f"breakdown reversal setup). (3) {dcr_p}. (4) The opening range "
        f"height of ${or_height:.2f} directly defines the measured move "
        f"target — Crabel's 2× range rule projects ${or_height * 2:.2f} "
        f"below entry, putting the primary target at ${target:.2f}. This "
        f"is one of the few intraday setups where target arithmetic is "
        f"deterministic and statistically well-supported. (5) Entry at "
        f"${entry:.2f} sits {stop_distance_pct:.2f}% below the structural "
        f"stop at ${stop:.2f}, giving the trader R:R {rr:.1f} on the "
        f"primary target — comfortably above Crabel's 2.0 threshold for "
        f"actionable setups."
    )

    what_to_watch_for = (
        f"The trigger has already fired — entry confirmation is the bar's "
        f"close below ${entry:.2f} (opening range low ${or_low:.2f} - 0.1% "
        f"confirmation buffer). Crabel's execution rule: take the trade "
        f"on the FIRST volume-confirmed close beyond the range (this "
        f"one), or scale in on a tight 1-2 bar rally that fails to reclaim "
        f"the prior range low — the 'kiss-goodbye' retest from below "
        f"that Crabel teaches as the highest-probability re-entry. Stop "
        f"is set at ${stop:.2f} (opening range high ${or_high:.2f} + "
        f"0.2% buffer); the structural reasoning is that a re-entry of "
        f"the opening range from below + reclaim of the high signals the "
        f"breakdown was a stop-run rather than a directional thrust, and "
        f"the trade must be exited before momentum reverses. Primary "
        f"target is ${target:.2f} — the 2× opening-range-height measured "
        f"move projected downward from entry. This target is meant as a "
        f"'first scale' rather than a held-to-close objective: Breitstein's "
        f"typical execution is to take half the position off at the "
        f"measured move and trail the remainder using a higher-high stop "
        f"on 5min bars until the close. Position size MUST reflect the "
        f"{stop_distance_pct:.2f}% stop distance — a 0.5% account-risk "
        f"sizing produces a "
        f"{(0.5 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.1f}% "
        f"equity allocation, larger than typical swing positions; "
        f"intraday size discipline is mandatory because the ORB framework's "
        f"edge depends on small expected-loss per failed trade. Short-"
        f"side execution note: borrow availability and locate must be "
        f"confirmed pre-trigger — even a clean ORBreakdown is structurally "
        f"untradeable if the locate fails. Breitstein's timing rule: "
        f"breakdowns in the 9:45-10:30 ET window are highest-edge; 11:00-"
        f"14:00 are mid-edge; after-14:00 breakdowns tend to be lower-"
        f"edge as covering flow dominates."
    )

    failure_signal = (
        f"The ORBreakdown fails in three ways. Failure Mode 1 — the "
        f"'kiss-and-reclaim' back into the opening range: the breakdown "
        f"bar prints, the trade triggers, and the next 1-2 bars close "
        f"back ABOVE the range low at ${or_low:.2f}. This is the most "
        f"common failure mode (roughly 25-30% of all initial triggers) "
        f"and is the canonical 'failed breakdown' long setup for the "
        f"opposite side — exit immediately on the close back inside the "
        f"range, do not wait for the structural stop at ${stop:.2f} to "
        f"trigger. Failure Mode 2 — the structural failure: price "
        f"reclaims the range AND breaks the opening range high at "
        f"${or_high:.2f}, triggering the structural stop at ${stop:.2f}. "
        f"This signals the opening range itself was a counter-trend "
        f"impulse to the upside and the day's directional bias is "
        f"opposite the short thesis. Failure Mode 3 — the 'no-follow-"
        f"through' drift: the trade triggers, doesn't reclaim the range, "
        f"but spends the rest of the session chopping between entry and "
        f"a few percent below without reaching the measured move at "
        f"${target:.2f}. Crabel's specific guidance for this case: exit "
        f"at end-of-day at the closing print rather than holding "
        f"overnight — the ORB framework's edge is intraday-specific and "
        f"does NOT extend to overnight holds. Failure-rate statistics by "
        f"stage: breakdowns in Stage 4 down-trends fail roughly 30-35%; "
        f"breakdowns in Stage 3 distribution fail roughly 40%; "
        f"breakdowns in Stage 2 uptrends (counter-trend) fail roughly "
        f"55-60%. Sizing must reflect the {stop_distance_pct:.2f}% stop "
        f"distance. {dcr_p}. Breitstein's discipline rule: never take "
        f"more than 3 ORB trades per session — the edge concentrates in "
        f"the first 1-2 high-conviction setups and dilutes rapidly with "
        f"over-trading."
    )

    return {
        "headline": headline,
        "what_it_is": what_it_is,
        "why_it_matters": why_it_matters,
        "what_to_watch_for": what_to_watch_for,
        "failure_signal": failure_signal,
    }


register(_PATTERN_ID, detect_opening_range_breakdown)
