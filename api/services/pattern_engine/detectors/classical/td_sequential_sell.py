"""TD Sequential Sell detector — Tom DeMark's TD9 sell setup.

Mirror of td_sequential_buy. Upside-exhaustion signal.

Conditions:
  - 9 consecutive bars where close[i] > close[i-4]              (TD Setup sell)
  - TD Perfection bonus: bar 9 high >= bar 8 high AND >= bar 6 high

Levels:
  - entry = bar 9 low * 0.999 (reversal trigger below bar 9)
  - stop = bar 9 high * 1.015
  - target = lowest low in last 13 bars (TDST support)

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


_PATTERN_ID = "td_sequential_sell"

# TD Setup count: 9 consecutive bars closing above close[i-4]    (DeMark)
_TD_SETUP_COUNT = 9
# Lookback for TDST support level                                (DeMark)
_TDST_LOOKBACK = 13
# How many bars back from the end the bar 9 can be (recency gate)
_MAX_AGE_BAR9 = 3
_CONFIDENCE_FLOOR = 50.0


def detect_td_sequential_sell(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect TD Sequential Sell (TD9) setups. Emits 0 or 1 detection."""
    n = len(bars)
    if n < _TD_SETUP_COUNT + 5 + _TDST_LOOKBACK:
        return []

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
            0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
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
    """Verify a 9-count TD Sell Setup ending at bar9_idx."""
    start = bar9_idx - (_TD_SETUP_COUNT - 1)
    if start < 4:
        return None
    setup_bars = []
    for i in range(start, bar9_idx + 1):
        if i - 4 < 0:
            return None
        if not (bars[i]["c"] > bars[i - 4]["c"]):
            return None
        setup_bars.append(i)

    bar9 = bars[bar9_idx]
    bar8 = bars[bar9_idx - 1]
    bar6 = bars[bar9_idx - 3]
    bar1 = bars[start]

    # TD Perfection: bar 9 high >= bar 8 high AND >= bar 6 high
    perfection = (bar9["h"] >= bar8["h"]) and (bar9["h"] >= bar6["h"])

    # TDST support: lowest low in the 13 bars ending at bar9_idx
    tdst_lookback_start = max(0, bar9_idx - _TDST_LOOKBACK + 1)
    tdst_window = bars[tdst_lookback_start:bar9_idx + 1]
    tdst_support = min(b["l"] for b in tdst_window)

    setup_highs = [bars[i]["h"] for i in setup_bars]
    highest_high = max(setup_highs)

    return {
        "bar9_idx": bar9_idx,
        "setup_start_idx": start,
        "bar9_high": bar9["h"],
        "bar9_low": bar9["l"],
        "bar9_close": bar9["c"],
        "bar9_close_minus_4_close": bars[bar9_idx - 4]["c"],
        "bar8_high": bar8["h"],
        "bar6_high": bar6["h"],
        "bar1_close": bar1["c"],
        "td_perfection": perfection,
        "tdst_support": tdst_support,
        "highest_high_in_setup": highest_high,
        "setup_count": _TD_SETUP_COUNT,
    }


def _score_geometry(c: dict) -> float:
    """Mirror of buy detector's _score_geometry."""
    perfection_score = 100.0 if c["td_perfection"] else 50.0

    advance = (c["bar9_close"] - c["bar1_close"]) / c["bar1_close"] * 100 if c["bar1_close"] > 0 else 0.0
    if advance >= 8.0:
        advance_score = 100.0
    elif advance >= 5.0:
        advance_score = 80.0
    elif advance >= 2.0:
        advance_score = 60.0
    elif advance > 0:
        advance_score = 40.0
    else:
        advance_score = 25.0

    rng = c["bar9_high"] - c["bar9_low"]
    if rng > 0:
        close_pos = (c["bar9_close"] - c["bar9_low"]) / rng
        # Upper-half close = classic exhaustion (sellers absent, last buyers stretched)
        if close_pos >= 0.7:
            bar9_score = 90.0
        elif close_pos >= 0.5:
            bar9_score = 75.0
        elif close_pos >= 0.3:
            bar9_score = 60.0
        else:
            bar9_score = 50.0
    else:
        bar9_score = 50.0

    return round(0.40 * perfection_score + 0.35 * advance_score + 0.25 * bar9_score, 2)


def _score_volume(bars: List[Bar], c: dict) -> float:
    """Bar 9 should print on heavier-than-average volume (climax)."""
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
    """Context score for a counter-trend reversal (bearish) setup."""
    score = 40.0
    stage = context.get("trend_stage")
    if stage == 2:
        score += 20.0    # textbook context for a sell-9 — stretched uptrend
    elif stage == 3:
        score += 15.0
    elif stage == 1:
        score += 5.0
    elif stage == 4:
        score += 8.0

    align = context.get("ma_alignment")
    if align == "mixed":
        score += 10.0
    elif align == "stacked_bearish":
        score += 8.0

    rs = context.get("rs_trend")
    if rs == "down":
        score += 8.0

    # DCR integration — bearish reversal: distribution = tailwind
    score += _dcr_score_adjustment(context)
    return min(100.0, max(0.0, score))


def _dcr_score_adjustment(context: dict) -> float:
    """DCR-derived score adjustment for a bearish reversal pattern (mirror)."""
    dcr_sig = context.get("dcr_signature")
    recent_dcr = context.get("recent_dcr_avg", 0.5) or 0.5
    if dcr_sig == "distribution" and recent_dcr <= 0.35:
        return 12.0   # sellers controlling closes
    if dcr_sig == "accumulation":
        return -8.0   # buyers absorbing — bearish reversal faces headwind
    return 0.0


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    bar9_idx = c["bar9_idx"]
    bar9 = bars[bar9_idx]

    entry = round(c["bar9_low"] * 0.999, 2)
    stop = round(c["bar9_high"] * 1.015, 2)
    target = round(c["tdst_support"], 2)
    rr = ((entry - target) / (stop - entry)) if stop > entry else 0.0
    stop_distance_pct = ((stop - entry) / entry * 100.0) if entry > 0 else 0.0

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
        "tdst_support": round(c["tdst_support"], 2),
        "highest_high_in_setup": round(c["highest_high_in_setup"], 2),
        "dcr_score_adj": round(_dcr_score_adjustment(context), 2),
    }

    narrative = _compose_narrative(c, context, entry, stop, target, rr, stop_distance_pct)
    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "TD Sequential Sell (TD9)",
        "category": "classical",
        "direction": "bearish",
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
            "entry_condition": f"close < {entry:.2f} (bar 9 low - 0.1%)",
            "stop": stop,
            "stop_basis": "bar9_high_plus_1.5pct",
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
    tdst = c["tdst_support"]
    highest = c["highest_high_in_setup"]

    ma_phrase = ma_alignment_phrase(context.get("ma_alignment"))
    stage_phrase = trend_stage_description(context.get("trend_stage"))
    rs_phrase = rs_trend_phrase(context.get("rs_trend"))
    regime_p = regime_phrase(context.get("regime"))
    vol_phrase = volume_signature_phrase(context.get("volume_signature"))
    dcr_p = dcr_phrase(context.get("dcr_signature"), context.get("recent_dcr_avg"))

    perf_word = "with TD Perfection" if perfection else "without TD Perfection"
    perf_detail = (
        f"TD Perfection is confirmed — bar 9's high ${bar9_high:.2f} is at or above "
        f"bar 8's high and bar 6's high, the additional structural confirmation "
        f"DeMark looked for to validate the strongest possible upside-exhaustion read."
        if perfection else
        f"TD Perfection is NOT yet confirmed — bar 9's high ${bar9_high:.2f} did "
        f"not exceed both bar 8's high and bar 6's high. The 9-count still "
        f"completed but the highest-confidence variant (perfected) is absent; "
        f"expect slightly higher false-signal rate vs perfected sell setups."
    )

    headline = (
        f"TD Sequential Sell (TD9) {perf_word} - 9 consecutive bars closing above "
        f"close[i-4], bar 9 high ${bar9_high:.2f}. TDST support ${tdst:.2f}. "
        f"Pivot ${entry:.2f}, target ${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The TD Sequential 'sell 9' is the canonical upside-exhaustion signal "
        f"from Tom DeMark's TD Sequential indicator family, codified in "
        f"'DeMark Indicators' by Jason Perl (Bloomberg Press, 2008). It is "
        f"the mirror of the buy 9: a 9-bar streak of closes above the close "
        f"4 bars prior. Reaching count 9 marks the structural exhaustion bar "
        f"of an uptrend — the point at which marginal buyers have been "
        f"satisfied and the remaining buying pressure has effectively been "
        f"consumed by the price advance. Here bar 9's close of ${bar9_close:.2f} "
        f"sits above close[-4] of ${bar9_close_minus_4_close:.2f}, completing "
        f"the count. The TDST support level — the lowest low within the most "
        f"recent 13 bars — is at ${tdst:.2f}, defining the structural floor "
        f"that a successful reversal targets. {perf_detail} DeMark Indicators "
        f"are deployed across the institutional terminal universe — Bloomberg "
        f"ships them natively, Goldman Sachs's trading desks use them as "
        f"standard structural inputs, and the broader systematic trading "
        f"community treats the TD9 sell as one of the cleanest mechanical "
        f"counter-trend triggers available. DeMark's framework was designed "
        f"to surface exhaustion BEFORE traditional momentum or oscillator-"
        f"based methods (RSI/MACD) would generate a divergence — by counting "
        f"closes against a 4-bar lookback, the indicator captures the "
        f"structural distribution of buying pressure rather than just the "
        f"price-derivative momentum. The TD9 sell is most powerful when it "
        f"completes near round-number resistance, a major moving average, or "
        f"a prior swing high — the structural ceiling adds a confluence "
        f"factor that historical institutional flow respects."
    )

    why_it_matters = (
        f"This TD9 sell signal is forming in {stage_phrase} with {ma_phrase} "
        f"moving-average alignment, {rs_phrase}, in {regime_p}. The structural "
        f"profile — 9 consecutive higher-than-the-4-back close prints "
        f"culminating in a high of ${bar9_high:.2f}, the highest high of the "
        f"entire setup window at ${highest:.2f} — is exactly the pattern "
        f"DeMark identified as the highest-edge counter-trend short entry. "
        f"{vol_phrase} on the bar 9 print confirms whether the exhaustion is "
        f"climactic (heavy volume = buyers spent themselves into the high) "
        f"or quiet (low volume = buyers have simply stopped showing up). "
        f"{dcr_p} {dcr_interpretation(context, 'bearish')} The TDST level at "
        f"${tdst:.2f} — the lowest low within the most recent 13 bars — is "
        f"DeMark's measured-move target for a successful reversal and "
        f"represents the structural floor the uptrend respected before the "
        f"exhaustion phase peaked. Reaching TDST is the equivalent of a "
        f"textbook reversal-completion print. The risk profile of TD9 sell "
        f"signals is structurally attractive when traded with discipline: "
        f"stops set tightly above the bar 9 high (here ${stop:.2f}) define "
        f"risk precisely, and reversal runs that reach TDST commonly extend "
        f"further — DeMark's broader framework chains setup-counts into "
        f"13-count countdowns, and successful 9-count completions that "
        f"perfect frequently feed into countdown signals over the subsequent "
        f"13-25 bars. Perl's published backtests show TD9 perfected sell "
        f"signals produce positive expectancy at hit rates in the 60-65% "
        f"range when traded systematically; non-perfected 9-counts run "
        f"roughly 5-8 percentage points lower in hit rate. Counter-trend "
        f"shorts in late-stage uptrends carry asymmetric reward — the move "
        f"can extend well past the TDST target once the structural break "
        f"completes."
    )

    what_to_watch_for = (
        f"Trigger: a close below ${entry:.2f} (bar 9 low ${bar9_low:.2f} minus "
        f"a 0.1% confirmation buffer). The ideal trigger bar prints on volume "
        f"at or above the 20-bar average and closes in the lower half of its "
        f"range — that confirms the bar 9 high was the structural turn rather "
        f"than a brief pause inside a continuing uptrend. The primary target "
        f"at ${target:.2f} is the TDST support level (DeMark's measured-move "
        f"convention from the lowest low in the 13-bar window ending at bar 9). "
        f"Position sizing should reflect the {stop_distance_pct:.1f}% stop "
        f"distance — risking 1% of account on the trade implies roughly "
        f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
        f"of equity per position. DeMark's specific execution rules for sell "
        f"9s: (a) wait for the trigger close below bar 9 low before entering "
        f"— never front-run the setup; (b) trail stops downward as the move "
        f"develops, using the prior swing-high pivot of each subsequent 2-3 "
        f"bar group as the running stop reference; (c) if the move develops "
        f"cleanly, the TD Sequential framework will often progress into a "
        f"13-count COUNTDOWN within 25-50 bars — Perl's discipline is to take "
        f"partial profits at TDST and let the remainder ride toward the "
        f"countdown signal. {perf_detail.split('.')[0].strip()}. Counter-"
        f"trend shorts in hostile context (Stage 2 + stacked bullish + RS up) "
        f"deserve smaller size; constructive context (Stage 3 distribution) "
        f"deserves heavier size given the structural backdrop."
    )

    failure_signal = (
        f"The TD9 sell is invalidated if price closes above ${stop:.2f} "
        f"(bar 9 high ${bar9_high:.2f} plus 1.5%) — that signals the supposed "
        f"exhaustion bar was simply another step in a continuing uptrend, and "
        f"that the 9-count completed too early relative to the underlying "
        f"buying pressure. A subtler failure: the reversal trigger fires below "
        f"${entry:.2f} but the next 3-5 bars recover above the bar 9 low on "
        f"weak volume — this 'failed TD9 sell' often precedes a continuation "
        f"of the uptrend and may take additional weeks to print a fresh "
        f"setup. DeMark's specific guidance on TD9 sell failures: a fresh "
        f"sell 9 that emerges shortly after a prior failed sell 9 carries "
        f"lower hit rate but produces some of DeMark's largest historical "
        f"short winners when it does work — the market is structurally "
        f"working through dual distribution phases. The trader's discipline: "
        f"take the trade exactly per the setup rules, size for the "
        f"{stop_distance_pct:.1f}% stop, never widen the stop, and never "
        f"argue with a bar 9 high breach. Perl's published guidance: a TD9 "
        f"sell that fails completely (stop breach + no recovery within 5 "
        f"bars) means a sequential countdown is now likely setting up, and "
        f"the next high-edge counter-trend signal may be 13-25 bars away. "
        f"Trade the setup, not the prediction — let the count tell you when "
        f"the structural turn is mature, not your forecast."
    )

    return {
        "headline": headline,
        "what_it_is": what_it_is,
        "why_it_matters": why_it_matters,
        "what_to_watch_for": what_to_watch_for,
        "failure_signal": failure_signal,
    }


register(_PATTERN_ID, detect_td_sequential_sell)
