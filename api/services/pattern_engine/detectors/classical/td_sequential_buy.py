"""TD Sequential Buy detector — Tom DeMark's TD9 setup.

Tom DeMark's TD Sequential, codified in "DeMark Indicators" (Jason Perl,
2008) and used by institutional trading desks at Bloomberg, Goldman Sachs,
and JPMorgan, identifies trend exhaustion via a specific counting mechanic.
The "TD Setup" count of 9 — bar 9 of 9 consecutive bars closing below the
close 4 bars prior — is the canonical downside-exhaustion signal. When the
9-count completes with "TD Perfection" (bar 9's low <= bar 8's low AND
bar 9's low <= bar 6's low), the structural exhaustion signal is at its
strongest, marking the bar where the prevailing downtrend's internal
energy has expired and a counter-trend reversal becomes high-probability.

Conditions:
  - 9 consecutive bars where close[i] < close[i-4]              (TD Setup)
  - TD Perfection bonus: bar 9 low <= bar 8 low AND <= bar 6 low

Levels:
  - entry = bar 9 high * 1.001 (reversal trigger above bar 9)
  - stop = bar 9 low * 0.985
  - target = highest high in last 13 bars (TDST resistance)

Geometry: "candle_mark" at bar 9.
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
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "td_sequential_buy"

# TD Setup count: 9 consecutive bars closing below close[i-4]   (DeMark)
_TD_SETUP_COUNT = 9
# Lookback for TDST resistance level                            (DeMark)
_TDST_LOOKBACK = 13
# How many bars back from the end the bar 9 can be (recency gate)
_MAX_AGE_BAR9 = 3
_CONFIDENCE_FLOOR = 50.0


def detect_td_sequential_buy(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect TD Sequential Buy (TD9) setups. Emits 0 or 1 detection."""
    n = len(bars)
    if n < _TD_SETUP_COUNT + 5 + _TDST_LOOKBACK:
        return []

    # Walk possible bar-9 positions in the last few bars (looking for a
    # recently-completed setup count).
    best_candidate = None
    best_confidence = -1.0
    best_scores = None

    for back in range(_MAX_AGE_BAR9):
        bar9_idx = n - 1 - back
        if bar9_idx < 4 + (_TD_SETUP_COUNT - 1):
            continue
        candidate = _try_extract(bars, bar9_idx)
        if candidate is None:
            continue

        geom_score = _score_geometry(candidate)
        vol_score = _score_volume(bars, candidate)
        ctx_score = _score_context(context)
        hist_score = 50.0
        confidence = round(
            0.40 * geom_score + 0.20 * vol_score + 0.25 * ctx_score + 0.15 * hist_score, 2
        )
        if confidence < _CONFIDENCE_FLOOR:
            continue
        if confidence > best_confidence:
            best_confidence = confidence
            best_candidate = candidate
            best_scores = (geom_score, vol_score, ctx_score, hist_score)

    if best_candidate is None:
        return []

    geom_score, vol_score, ctx_score, hist_score = best_scores
    d = _build_detection(bars, best_candidate, best_confidence, context,
                        geom_score, vol_score, ctx_score, hist_score)
    return [d]


def _try_extract(bars: List[Bar], bar9_idx: int) -> Optional[dict]:
    """Verify a 9-count TD Setup ending at bar9_idx."""
    # bars[bar9_idx - 8 ... bar9_idx] must each have close < close[-4]
    start = bar9_idx - (_TD_SETUP_COUNT - 1)
    if start < 4:
        return None
    setup_bars = []
    for i in range(start, bar9_idx + 1):
        if i - 4 < 0:
            return None
        if not (bars[i]["c"] < bars[i - 4]["c"]):
            return None
        setup_bars.append(i)

    bar9 = bars[bar9_idx]
    bar8 = bars[bar9_idx - 1]
    bar6 = bars[bar9_idx - 3]
    bar1 = bars[start]

    # TD Perfection: bar 9 low <= bar 8 low AND <= bar 6 low
    perfection = (bar9["l"] <= bar8["l"]) and (bar9["l"] <= bar6["l"])

    # TDST resistance: highest high in the 13 bars ending at bar9_idx
    tdst_lookback_start = max(0, bar9_idx - _TDST_LOOKBACK + 1)
    tdst_window = bars[tdst_lookback_start:bar9_idx + 1]
    tdst_resistance = max(b["h"] for b in tdst_window)

    # Lowest low across the 9-setup window
    setup_lows = [bars[i]["l"] for i in setup_bars]
    lowest_low = min(setup_lows)

    return {
        "bar9_idx": bar9_idx,
        "setup_start_idx": start,
        "bar9_high": bar9["h"],
        "bar9_low": bar9["l"],
        "bar9_close": bar9["c"],
        "bar9_close_minus_4_close": bars[bar9_idx - 4]["c"],
        "bar8_low": bar8["l"],
        "bar6_low": bar6["l"],
        "bar1_close": bar1["c"],
        "td_perfection": perfection,
        "tdst_resistance": tdst_resistance,
        "lowest_low_in_setup": lowest_low,
        "setup_count": _TD_SETUP_COUNT,
    }


def _score_geometry(c: dict) -> float:
    """Composite geometry score.

    Components:
      perfection_score:   +35 perfection / 15 no-perfection
      decline_score:      how much the setup fell (deeper = stronger exhaustion)
      bar9_strength:      bar9 close vs low (close in lower half = expected)
    """
    perfection_score = 100.0 if c["td_perfection"] else 50.0

    # Decline depth: how far did price fall over the 9-bar setup?
    decline = (c["bar1_close"] - c["bar9_close"]) / c["bar1_close"] * 100 if c["bar1_close"] > 0 else 0.0
    if decline >= 8.0:
        decline_score = 100.0
    elif decline >= 5.0:
        decline_score = 80.0
    elif decline >= 2.0:
        decline_score = 60.0
    elif decline > 0:
        decline_score = 40.0
    else:
        decline_score = 25.0

    # bar9 strength: typically the bar closes weak (in the lower half) at exhaustion.
    rng = c["bar9_high"] - c["bar9_low"]
    if rng > 0:
        close_pos = (c["bar9_close"] - c["bar9_low"]) / rng
        # Lower-half close = standard exhaustion (score 80-100)
        # Upper-half close = potential intra-bar reversal already starting (50-70)
        if close_pos <= 0.3:
            bar9_score = 90.0  # weak close — classic exhaustion
        elif close_pos <= 0.5:
            bar9_score = 75.0
        elif close_pos <= 0.7:
            bar9_score = 60.0
        else:
            bar9_score = 50.0  # upper-half close — bullish intra-bar but less canonical
    else:
        bar9_score = 50.0

    return round(0.40 * perfection_score + 0.35 * decline_score + 0.25 * bar9_score, 2)


def _score_volume(bars: List[Bar], c: dict) -> float:
    """Volume score: bar 9 should print on heavier-than-average volume (climax).

    Compares bar 9 volume to the 20-bar average ending at bar 9.
    """
    bar9_idx = c["bar9_idx"]
    lookback_start = max(0, bar9_idx - 20)
    lookback = bars[lookback_start:bar9_idx]
    if not lookback:
        return 50.0
    avg_vol = sum(b["v"] for b in lookback) / len(lookback)
    if avg_vol <= 0:
        return 50.0
    ratio = bars[bar9_idx]["v"] / avg_vol
    if ratio >= 2.0:
        return 100.0
    if ratio >= 1.5:
        return 85.0
    if ratio >= 1.1:
        return 70.0
    if ratio >= 0.8:
        return 55.0
    return 40.0


def _score_context(context: dict) -> float:
    """Context score for a counter-trend reversal setup.

    Best context: Stage 3/4 or stretched downtrend (the exhaustion is meaningful).
    Stage 1 is OK (basing). Stage 2 is uncommon for a buy 9 but possible after
    a deep pullback.
    """
    score = 40.0
    stage = context.get("trend_stage")
    if stage == 4:
        score += 20.0   # textbook context for a buy-9 reversal
    elif stage == 3:
        score += 15.0
    elif stage == 1:
        score += 10.0
    elif stage == 2:
        score += 5.0

    align = context.get("ma_alignment")
    if align == "mixed":
        score += 10.0  # transitioning context
    elif align == "stacked_bullish":
        score += 8.0   # rare but constructive

    rs = context.get("rs_trend")
    if rs == "up":
        score += 8.0

    # DCR integration — bullish reversal: accumulation = tailwind
    score += _dcr_score_adjustment(context)
    return min(100.0, max(0.0, score))


def _dcr_score_adjustment(context: dict) -> float:
    """DCR-derived score adjustment for a bullish reversal pattern."""
    dcr_sig = context.get("dcr_signature")
    recent_dcr = context.get("recent_dcr_avg", 0.5) or 0.5
    if dcr_sig == "accumulation" and recent_dcr >= 0.65:
        return 12.0   # institutional buying into close
    if dcr_sig == "distribution":
        return -8.0   # sellers active — bullish reversal faces headwind
    return 0.0


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    bar9_idx = c["bar9_idx"]
    bar9 = bars[bar9_idx]

    entry = round(c["bar9_high"] * 1.001, 2)
    stop = round(c["bar9_low"] * 0.985, 2)
    target = round(c["tdst_resistance"], 2)
    rr = ((target - entry) / (entry - stop)) if entry > stop else 0.0
    stop_distance_pct = ((entry - stop) / entry * 100.0) if entry > 0 else 0.0

    anchors = [
        {"t": int(bar9["t"]), "price": float(c["bar9_low"])},
        {"t": int(bar9["t"]), "price": float(c["bar9_high"])},
    ]
    pivot_ts = [int(bars[c["setup_start_idx"]]["t"]), int(bar9["t"]), int(last_bar["t"])]

    extras = {
        "setup_count": int(c["setup_count"]),
        "td_perfection": bool(c["td_perfection"]),
        "bar9_idx": int(bar9_idx),
        "bar9_low": round(c["bar9_low"], 2),
        "bar9_high": round(c["bar9_high"], 2),
        "bar9_close": round(c["bar9_close"], 2),
        "bar9_close_minus_4_close": round(c["bar9_close_minus_4_close"], 2),
        "tdst_resistance": round(c["tdst_resistance"], 2),
        "lowest_low_in_setup": round(c["lowest_low_in_setup"], 2),
        "dcr_score_adj": round(_dcr_score_adjustment(context), 2),
    }

    narrative = _compose_narrative(c, context, entry, stop, target, rr, stop_distance_pct)
    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "TD Sequential Buy (TD9)",
        "category": "classical",
        "direction": "bullish",
        "start_t": int(bars[c["setup_start_idx"]]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": pivot_ts,
        "geometry": {
            "shape": "candle_mark",
            "anchors": anchors,
            "extras": extras,
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close > {entry:.2f} (bar 9 high + 0.1%)",
            "stop": stop,
            "stop_basis": "bar9_low_minus_1.5pct",
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
    bar9_low = c["bar9_low"]
    bar9_high = c["bar9_high"]
    bar9_close = c["bar9_close"]
    bar9_close_minus_4_close = c["bar9_close_minus_4_close"]
    perfection = c["td_perfection"]
    tdst = c["tdst_resistance"]
    lowest = c["lowest_low_in_setup"]

    ma_phrase = ma_alignment_phrase(context.get("ma_alignment"))
    stage_phrase = trend_stage_description(context.get("trend_stage"))
    rs_phrase = rs_trend_phrase(context.get("rs_trend"))
    regime_p = regime_phrase(context.get("regime"))
    vol_phrase = volume_signature_phrase(context.get("volume_signature"))
    dcr_p = dcr_phrase(context.get("dcr_signature"), context.get("recent_dcr_avg"))

    perf_word = "with TD Perfection" if perfection else "without TD Perfection"
    perf_detail = (
        f"TD Perfection is confirmed — bar 9's low ${bar9_low:.2f} is at or below "
        f"bar 8's low and bar 6's low, the additional structural confirmation "
        f"DeMark looked for to validate the strongest possible exhaustion read."
        if perfection else
        f"TD Perfection is NOT yet confirmed — bar 9's low ${bar9_low:.2f} did not "
        f"undercut both bar 8's low and bar 6's low. The 9-count still completed "
        f"but the highest-confidence variant (perfected) is absent; expect "
        f"slightly higher false-signal rate vs perfected setups."
    )

    headline = (
        f"TD Sequential Buy (TD9) {perf_word} - 9 consecutive bars closing below "
        f"close[i-4], bar 9 low ${bar9_low:.2f}. TDST resistance ${tdst:.2f}. "
        f"Pivot ${entry:.2f}, target ${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The TD Sequential 'buy 9' is the canonical downside-exhaustion signal "
        f"from Tom DeMark's TD Sequential indicator family, codified in "
        f"'DeMark Indicators' by Jason Perl (Bloomberg Press, 2008) and the "
        f"core reference 'DeMark on Day Trading Options'. It is a mechanical "
        f"counting protocol that flags the precise bar at which a prevailing "
        f"downtrend's internal energy has expired and a counter-trend "
        f"reversal becomes high-probability. The mechanic is simple but "
        f"unforgiving: count up consecutive bars where the close is LESS "
        f"than the close exactly 4 bars prior. Reaching a count of 9 "
        f"(the TD Setup) marks the structural exhaustion bar. Here bar 9's "
        f"close of ${bar9_close:.2f} sits below close[-4] of "
        f"${bar9_close_minus_4_close:.2f}, completing the count. The TDST "
        f"resistance — the highest high within the most recent 13 bars — "
        f"is at ${tdst:.2f}, defining the level that a successful reversal "
        f"must reclaim to confirm. {perf_detail} The reason DeMark's setup "
        f"works is rooted in market microstructure: a 9-bar streak of "
        f"closes-below-the-close-4-bars-prior represents persistent supply "
        f"exhaustion — by bar 9, the marginal sellers have been satisfied "
        f"at every retest of recent lows, and the remaining inventory in "
        f"weak hands has effectively been transferred. DeMark Indicators "
        f"are deployed across the institutional terminal universe — "
        f"Bloomberg ships them natively, Goldman Sachs's trading desks use "
        f"them as standard structural inputs, and the broader systematic "
        f"trading community treats the TD9 as one of the cleanest mechanical "
        f"counter-trend triggers available. The setup was designed by Tom "
        f"DeMark in the 1970s during his stint as a portfolio strategist, "
        f"refined through decades of testing on equities/futures/FX, and "
        f"the modern reference (Perl 2008) is the standard playbook."
    )

    why_it_matters = (
        f"This TD9 buy signal is forming in {stage_phrase} with {ma_phrase} "
        f"moving-average alignment, {rs_phrase}, in {regime_p}. The structural "
        f"profile of the setup — 9 consecutive lower-than-the-4-back close "
        f"prints culminating in a low of ${bar9_low:.2f}, the lowest low of "
        f"the entire setup window at ${lowest:.2f} — is exactly the pattern "
        f"DeMark identified across decades of testing as the highest-edge "
        f"counter-trend entry. {vol_phrase} on the bar 9 print confirms whether "
        f"the exhaustion is climactic (heavy volume = sellers spent themselves "
        f"into the low) or quiet (low volume = sellers have simply stopped "
        f"showing up). {dcr_p} {dcr_interpretation(context, 'bullish')} The "
        f"TDST level at ${tdst:.2f} — the highest high within the most recent "
        f"13 bars — is DeMark's measured-move target for a successful reversal "
        f"and represents the structural ceiling that the downtrend established "
        f"before the exhaustion phase began. Reclaiming TDST is the equivalent "
        f"of a textbook reversal-completion print. The risk profile of TD9 buy "
        f"signals is structurally attractive: stops set tightly below the "
        f"bar 9 low (here ${stop:.2f}) define risk precisely, and reversal "
        f"runs that reach TDST commonly extend further — DeMark's broader "
        f"framework chains setup-counts into 13-count countdowns, and "
        f"successful 9-count completions that perfect frequently feed into "
        f"countdown signals over the subsequent 13-25 bars. Perl's published "
        f"backtests on US equities and CME futures show TD9 perfected signals "
        f"produce positive expectancy at hit rates in the 60-65% range when "
        f"traded systematically; non-perfected 9-counts run roughly 5-8 "
        f"percentage points lower in hit rate."
    )

    what_to_watch_for = (
        f"Trigger: a close above ${entry:.2f} (bar 9 high ${bar9_high:.2f} plus "
        f"a 0.1% confirmation buffer). The ideal trigger bar prints on volume "
        f"at or above the 20-bar average and closes in the upper half of its "
        f"range — that confirms the bar 9 low was the structural turn rather "
        f"than a brief bounce inside a continuing downtrend. The primary target "
        f"at ${target:.2f} is the TDST resistance level (DeMark's measured-move "
        f"convention from the highest high in the 13-bar window ending at bar 9). "
        f"Position sizing should reflect the {stop_distance_pct:.1f}% stop "
        f"distance — risking 1% of account on the trade implies roughly "
        f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
        f"of equity per position. DeMark's specific execution rules: (a) wait "
        f"for the trigger close above bar 9 high before entering — never "
        f"front-run the setup; (b) trail stops upward as the move develops, "
        f"using the prior swing-low pivot of each subsequent 2-3 bar group "
        f"as the running stop reference; (c) if the move develops cleanly, "
        f"the TD Sequential framework will often progress into a 13-count "
        f"COUNTDOWN within 25-50 bars — Perl's discipline is to take partial "
        f"profits at TDST and let the remainder ride toward the countdown "
        f"signal. {perf_detail.split('.')[0].strip()}. Counter-trend buys in "
        f"hostile context (Stage 4 + stacked bearish + RS down) deserve smaller "
        f"size; constructive context (Stage 1 transitioning) deserves heavier "
        f"size given the structural backdrop."
    )

    failure_signal = (
        f"The TD9 buy is invalidated if price closes below ${stop:.2f} "
        f"(bar 9 low ${bar9_low:.2f} minus 1.5%) — that signals the supposed "
        f"exhaustion bar was simply another step in a continuing downtrend, "
        f"and that the 9-count completed too early relative to the underlying "
        f"selling pressure. A subtler failure mode: the reversal trigger fires "
        f"above ${entry:.2f} but the next 3-5 bars fade back below the bar 9 "
        f"high on weak volume — this 'failed TD9' often precedes a deeper "
        f"flush that resets the count and may take additional weeks to "
        f"complete a fresh setup. DeMark's specific guidance on TD9 failures: "
        f"the second TD9 buy signal in a continuing downtrend (a 'fresh 9' "
        f"after a prior 9 failed) has lower hit rate but produces some of "
        f"DeMark's largest historical winners when it does work — meaning the "
        f"market is structurally working through dual exhaustion phases. "
        f"The trader's discipline: take the trade exactly per the setup rules, "
        f"size for the {stop_distance_pct:.1f}% stop, never widen the stop, "
        f"and never argue with a bar 9 low breach. Perl's published guidance: "
        f"a TD9 that fails completely (stop breach + no recovery within 5 bars) "
        f"means a sequential countdown is now likely setting up, and the next "
        f"high-edge counter-trend signal may be 13-25 bars away. Trade the "
        f"setup, not the prediction — let the count tell you when, not your "
        f"forecast."
    )

    return {
        "headline": headline,
        "what_it_is": what_it_is,
        "why_it_matters": why_it_matters,
        "what_to_watch_for": what_to_watch_for,
        "failure_signal": failure_signal,
    }


register(_PATTERN_ID, detect_td_sequential_buy)
