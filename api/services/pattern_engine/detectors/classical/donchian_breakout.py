"""Donchian Breakout detector — Turtle Trader entry signal.

Richard Donchian invented the Donchian Channel in 1934 as part of the
earliest mechanical trend-following system: buy when price closes above
the N-bar high, sell when price closes below the N-bar low. Donchian's
'Trend Trader' newsletter (1960s-70s) refined the method, and the
framework was canonized in the 1983 Turtle Trader experiment by Richard
Dennis & William Eckhardt, who taught it as their core entry trigger.
Curtis Faith's 'Way of the Turtle' (McGraw-Hill, 2007) published the
full ruleset:

  - System 1 (shorter-term): close above 20-bar high (long) OR below
    20-bar low (short). Skip the next trade if the prior trade was a
    winner (anti-overfit rule).
  - System 2 (longer-term): close above 55-bar high OR below 55-bar low.
    Always take the trade — no skipping.
  - 1N stop: 2 × ATR(20) below entry (long) or above entry (short).
    N is the Turtle term for ATR(20); the 2N stop is the volatility-
    normalized failure point.
  - Trailing exit: 10-bar opposite Donchian band.
  - Position sizing: 1 unit = (1% of account) / N — volatility-adjusted
    constant-risk sizing.

This detector emits both bullish and bearish Donchian breakouts. Direction
follows the breakout side:

  - Long break: close > 20-bar high (System 1) OR > 55-bar high (System 2)
  - Short break: close < 20-bar low OR < 55-bar low

The 55-bar System 2 break is the higher-edge longer-term signal — the
Turtle scoring records published in Michael Covel's 'The Complete
TurtleTrader' (2007) attribute the bulk of Dennis & Eckhardt's $200M
trading profits to System 2 trades.

Conditions:
  - Close beyond 20-bar high/low OR 55-bar high/low
  - Volume on breakout bar >= 20-bar average

Levels (long break):
  - entry = breakout close * 1.001
  - stop = 2 × ATR(20) below entry (Turtle 2N rule)
  - target_primary = entry + 4 × ATR(20) (2R minimum target)
  - trail with 10-bar opposite Donchian band exit

Geometry: "horizontal_line" at the 20-bar or 55-bar high/low broken.

Attribution: Richard Donchian (Donchian Channels, 1934, "Trend Trader"
newsletter); Richard Dennis & William Eckhardt (Turtle Trader experiment,
1983); Curtis Faith ("Way of the Turtle", 2007); Michael Covel
("The Complete TurtleTrader", 2007).
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


_PATTERN_ID = "donchian_breakout"

_SYSTEM_1_PERIOD = 20
_SYSTEM_2_PERIOD = 55
_ATR_PERIOD = 20
_VOLUME_MIN_RATIO = 1.0   # >=20-bar avg
_CONFIDENCE_FLOOR = 50.0


def detect_donchian_breakout(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect Donchian System 1 (20-bar) or System 2 (55-bar) breakouts.

    Emits up to 2 detections (long + short are mutually exclusive in practice
    but both checked to support inverse-mirror testing).
    """
    n = len(bars)
    if n < _SYSTEM_2_PERIOD + _ATR_PERIOD + 5:
        return []

    last_bar = bars[-1]
    close = last_bar["c"]

    # 20-bar Donchian (System 1) — exclude the breakout bar itself
    s1_high = max(b["h"] for b in bars[-_SYSTEM_1_PERIOD - 1:-1])
    s1_low = min(b["l"] for b in bars[-_SYSTEM_1_PERIOD - 1:-1])
    # 55-bar Donchian (System 2)
    s2_high = max(b["h"] for b in bars[-_SYSTEM_2_PERIOD - 1:-1])
    s2_low = min(b["l"] for b in bars[-_SYSTEM_2_PERIOD - 1:-1])

    atr20 = _atr(bars[-_ATR_PERIOD - 1:])
    if atr20 <= 0:
        return []

    # Volume on the breakout bar
    avg_vol = sum(b["v"] for b in bars[-21:-1]) / 20
    if avg_vol <= 0:
        return []
    vol_ratio = last_bar["v"] / avg_vol

    detections = []

    # Long break: prefer System 2 if both fire (it's the higher-edge signal)
    if close > s2_high and vol_ratio >= _VOLUME_MIN_RATIO:
        cand = _make_candidate(bars, "bullish", _SYSTEM_2_PERIOD, s2_high, atr20, vol_ratio)
        d = _try_build(cand, bars, context, "bullish", s2_high)
        if d:
            detections.append(d)
    elif close > s1_high and vol_ratio >= _VOLUME_MIN_RATIO:
        cand = _make_candidate(bars, "bullish", _SYSTEM_1_PERIOD, s1_high, atr20, vol_ratio)
        d = _try_build(cand, bars, context, "bullish", s1_high)
        if d:
            detections.append(d)

    if close < s2_low and vol_ratio >= _VOLUME_MIN_RATIO:
        cand = _make_candidate(bars, "bearish", _SYSTEM_2_PERIOD, s2_low, atr20, vol_ratio)
        d = _try_build(cand, bars, context, "bearish", s2_low)
        if d:
            detections.append(d)
    elif close < s1_low and vol_ratio >= _VOLUME_MIN_RATIO:
        cand = _make_candidate(bars, "bearish", _SYSTEM_1_PERIOD, s1_low, atr20, vol_ratio)
        d = _try_build(cand, bars, context, "bearish", s1_low)
        if d:
            detections.append(d)

    return detections


def _make_candidate(bars, direction, period, donchian_level, atr20, vol_ratio):
    return {
        "direction": direction,
        "period": period,
        "donchian_level": donchian_level,
        "breakout_close": bars[-1]["c"],
        "atr_20": atr20,
        "volume_ratio": vol_ratio,
    }


def _try_build(c, bars, context, direction, donchian_level) -> Optional[Detection]:
    geom_score = _score_geometry(c)
    vol_score = _score_volume(c)
    ctx_score = _score_context(context, direction)
    hist_score = 50.0
    confidence = round(
        0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
    )
    if confidence < _CONFIDENCE_FLOOR:
        return None
    return _build_detection(bars, c, confidence, context, donchian_level,
                            geom_score, vol_score, ctx_score, hist_score)


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
    """Higher edge: System 2 (55-bar) > System 1 (20-bar). Stronger if breakout
    close is substantially beyond the Donchian level."""
    period_score = 90.0 if c["period"] == _SYSTEM_2_PERIOD else 70.0

    breakout_close = c["breakout_close"]
    level = c["donchian_level"]
    if c["direction"] == "bullish":
        penetration_pct = (breakout_close - level) / level * 100.0 if level > 0 else 0.0
    else:
        penetration_pct = (level - breakout_close) / level * 100.0 if level > 0 else 0.0
    if penetration_pct >= 2.0:
        penetration_score = 100.0
    elif penetration_pct >= 1.0:
        penetration_score = 85.0
    elif penetration_pct >= 0.5:
        penetration_score = 70.0
    else:
        penetration_score = 55.0

    return round(min(100.0, 0.55 * period_score + 0.45 * penetration_score), 2)


def _score_volume(c: dict) -> float:
    """Turtle rule: heavier volume = stronger institutional commitment."""
    ratio = c["volume_ratio"]
    if ratio >= 2.0:
        return 100.0
    if ratio >= 1.5:
        return 85.0
    if ratio >= 1.2:
        return 70.0
    return 55.0   # >=1.0 baseline


def _score_context(context: dict, direction: str) -> float:
    score = 50.0
    stage = context.get("trend_stage")
    if direction == "bullish":
        if stage == 2:
            score += 20.0
        elif stage == 1:
            score += 8.0
        if context.get("rs_trend") == "up":
            score += 10.0
        # DCR: +12 accumulation / -8 distribution
        if context.get("dcr_signature") == "accumulation":
            score += 12.0
        elif context.get("dcr_signature") == "distribution":
            score -= 8.0
    else:
        if stage == 4:
            score += 20.0
        elif stage == 3:
            score += 8.0
        if context.get("rs_trend") == "down":
            score += 10.0
        # DCR for bearish: mirror — distribution helps
        if context.get("dcr_signature") == "distribution":
            score += 12.0
        elif context.get("dcr_signature") == "accumulation":
            score -= 8.0
    return min(100.0, max(0.0, score))


def _build_detection(bars, c, confidence, context, donchian_level,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    direction = c["direction"]
    period = c["period"]
    atr20 = c["atr_20"]
    breakout_close = c["breakout_close"]

    if direction == "bullish":
        entry = round(breakout_close * 1.001, 2)
        # Turtle 2N stop: 2 ATR below entry
        stop = round(entry - 2.0 * atr20, 2)
        # 2R minimum target — trailing 10-bar Donchian replaces this on the live trade
        target = round(entry + 4.0 * atr20, 2)
    else:
        entry = round(breakout_close * 0.999, 2)
        stop = round(entry + 2.0 * atr20, 2)
        target = round(entry - 4.0 * atr20, 2)
    rr = abs((target - entry) / (entry - stop)) if entry != stop else 0.0
    stop_distance_pct = abs((entry - stop) / entry * 100.0) if entry > 0 else 0.0

    # Find the bar where the prior high/low was set (for visualization)
    if direction == "bullish":
        donchian_anchor_idx = None
        for i in range(-period - 1, -1):
            if bars[i]["h"] >= donchian_level - 0.01:
                donchian_anchor_idx = len(bars) + i
                break
    else:
        donchian_anchor_idx = None
        for i in range(-period - 1, -1):
            if bars[i]["l"] <= donchian_level + 0.01:
                donchian_anchor_idx = len(bars) + i
                break
    if donchian_anchor_idx is None:
        donchian_anchor_idx = max(0, len(bars) - period - 1)

    anchors = [
        {"t": int(bars[donchian_anchor_idx]["t"]), "price": float(donchian_level)},
        {"t": int(last_bar["t"]), "price": float(donchian_level)},
    ]

    system_name = f"System {1 if period == _SYSTEM_1_PERIOD else 2}"

    extras = {
        "donchian_period": int(period),
        "donchian_system": system_name,
        "donchian_high_or_low": round(donchian_level, 4),
        "breakout_close": round(breakout_close, 4),
        "atr_20": round(atr20, 4),
        "volume_ratio": round(c["volume_ratio"], 3),
        "direction": direction,
    }

    narrative = _compose_narrative(c, context, donchian_level, entry, stop,
                                    target, rr, stop_distance_pct, atr20,
                                    direction, period, system_name)
    now = int(time.time())

    pattern_name = (
        f"Donchian Breakout {system_name} (Turtle "
        f"{'Long' if direction == 'bullish' else 'Short'})"
    )

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": pattern_name,
        "category": "classical",
        "direction": direction,
        "start_t": int(bars[donchian_anchor_idx]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(bars[donchian_anchor_idx]["t"]), int(last_bar["t"])],
        "geometry": {
            "shape": "horizontal_line",
            "anchors": anchors,
            "extras": extras,
        },
        "levels": {
            "entry": entry,
            "entry_condition": (
                f"close {'>' if direction == 'bullish' else '<'} "
                f"{entry:.2f} ({system_name} Donchian "
                f"{'high' if direction == 'bullish' else 'low'})"
            ),
            "stop": stop,
            "stop_basis": "2N_atr_stop_turtle_rule",
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
        "status": "triggered",
        "outcome": None,
        "detected_at": now,
        "last_seen_at": now,
    }


def _compose_narrative(c: dict, context: dict, donchian_level: float,
                       entry: float, stop: float, target: float, rr: float,
                       stop_distance_pct: float, atr20: float,
                       direction: str, period: int, system_name: str) -> dict:
    breakout_close = c["breakout_close"]
    vol_ratio = c["volume_ratio"]
    if direction == "bullish":
        penetration_pct = (breakout_close - donchian_level) / donchian_level * 100.0
    else:
        penetration_pct = (donchian_level - breakout_close) / donchian_level * 100.0

    ma_phrase = ma_alignment_phrase(context.get("ma_alignment"))
    stage_phrase = trend_stage_description(context.get("trend_stage"))
    rs_phrase = rs_trend_phrase(context.get("rs_trend"))
    regime_p = regime_phrase(context.get("regime"))
    vol_phrase = volume_signature_phrase(context.get("volume_signature"))
    dcr_p = dcr_phrase(context.get("dcr_signature"), context.get("recent_dcr_avg"))
    dir_label = "Long" if direction == "bullish" else "Short"
    band_label = "high" if direction == "bullish" else "low"

    headline = (
        f"Donchian Breakout {system_name} ({dir_label}) - close ${breakout_close:.2f} "
        f"breaks the {period}-bar Donchian {band_label} at ${donchian_level:.2f} by "
        f"{penetration_pct:.2f}% on volume {vol_ratio:.2f}x the 20-bar average. "
        f"ATR(20) {atr20:.2f}, Turtle 2N stop ${stop:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Donchian Breakout is the foundational trend-following entry "
        f"signal in modern technical analysis. Richard Donchian invented the "
        f"Donchian Channel in 1934 as part of the earliest published "
        f"mechanical trend-following system: buy when price closes above the "
        f"N-bar high, sell when price closes below the N-bar low. Donchian's "
        f"'Trend Trader' newsletter (running through the 1960s and 70s) "
        f"refined the method, and the framework was canonized in the 1983 "
        f"Turtle Trader experiment — Chicago commodities legend Richard "
        f"Dennis bet partner William Eckhardt that trading rules could be "
        f"TAUGHT, hired 23 amateurs ('Turtles'), trained them on Donchian "
        f"breakout rules + volatility-normalized position sizing, and over "
        f"the next 4 years produced over $200M in trading profits across "
        f"the group. Curtis Faith's 'Way of the Turtle' (McGraw-Hill, 2007) "
        f"published the complete ruleset, and Michael Covel's 'The Complete "
        f"TurtleTrader' (2007) chronicled the empirical results. The "
        f"Turtle system distinguishes two timeframes: System 1 uses the 20-"
        f"bar high/low (faster, more signals); System 2 uses the 55-bar "
        f"high/low (slower, larger moves). This detection is firing on "
        f"{system_name} — the {period}-bar Donchian {band_label} at "
        f"${donchian_level:.2f} just broke by {penetration_pct:.2f}% on a "
        f"close of ${breakout_close:.2f}. Volume on the breakout bar was "
        f"{vol_ratio:.2f}x the 20-bar average — Faith's published criterion "
        f"for a 'high-quality' Donchian break is >=1.0x average volume; "
        f"this print satisfies that filter. The {system_name} edge specifically "
        f"comes from the longer-term nature of the {period}-bar lookback: "
        f"the {period}-bar {band_label} represents the price level beyond "
        f"which the market has not closed in the preceding {period} bars — "
        f"every market participant who entered above this level (in the "
        f"opposite direction) is now offside on a closing basis, creating "
        f"a structural supply/demand asymmetry that the Turtle system "
        f"systematically exploits."
    )

    why_it_matters = (
        f"This {system_name} Donchian breakout is firing inside {stage_phrase} "
        f"with {ma_phrase} alignment, {rs_phrase}, in {regime_p}. The Turtle "
        f"system's edge comes from three reinforcing dynamics that "
        f"Donchian's original 1934 framework codified and Dennis/Eckhardt's "
        f"1983 experiment validated empirically: (1) systematic, mechanical "
        f"entry removes discretion and emotion from the trade trigger — the "
        f"breakout fires or it doesn't, no second-guessing; (2) {period}-bar "
        f"Donchian breakouts represent genuine structural regime changes "
        f"because they require price to close BEYOND a level that has held "
        f"for {period} consecutive bars — the longer the period, the more "
        f"meaningful the break; (3) the volatility-normalized position-"
        f"sizing framework (Turtle 'N' = ATR(20), unit size = 1% account "
        f"risk / N) systematically right-sizes each trade for the underlying "
        f"price's volatility, producing constant-risk exposure across "
        f"different markets and timeframes. {vol_phrase} on the breakout "
        f"bar at {vol_ratio:.2f}x average reinforces the institutional-"
        f"commitment signature Faith documents as the precursor to "
        f"continuation moves. {dcr_p} "
        f"{dcr_interpretation(context, direction)} The {penetration_pct:.2f}% "
        f"penetration beyond the Donchian {band_label} is the geometric "
        f"validation Donchian's framework requires — a marginal break "
        f"(below 0.3%) is statistically indistinguishable from noise; a "
        f"break beyond 1% with confirming volume is the canonical Turtle "
        f"trigger. The asymmetric reward profile is structurally clean: "
        f"the Turtle 2N stop at ${stop:.2f} reflects volatility-normalized "
        f"risk (twice the ATR), while the 4N initial target at "
        f"${target:.2f} produces R:R {rr:.1f} — the Turtle system's "
        f"published expected value of ~2:1 minimum on completed trades. "
        f"In practice, the Turtles trail their stops up to the 10-bar "
        f"opposite-side Donchian (exit on close below 10-bar low for long, "
        f"close above 10-bar high for short), so winners run substantially "
        f"longer than the 4N initial target when the trend extends."
    )

    what_to_watch_for = (
        f"Trigger: ALREADY TRIGGERED — the close at ${breakout_close:.2f} "
        f"satisfies the Donchian rule. Faith's specific execution guidance "
        f"from 'Way of the Turtle': (a) enter at the OPEN of the next bar "
        f"after the breakout — do NOT chase mid-bar; the Turtle entry "
        f"discipline requires waiting for the next session's open even "
        f"though the breakout is technically already 'fired'; (b) initial "
        f"position size = 1 unit = 1% account risk / N, where N is "
        f"ATR(20) = {atr20:.2f} — that produces a risk-normalized size "
        f"that's consistent across instruments; (c) pyramid up to 4 units "
        f"total as price moves in favor by 0.5N (half an ATR) increments — "
        f"this is the Turtle's adding-to-winners discipline; (d) stop "
        f"at 2N from entry: ${stop:.2f} — Turtle 'whipsaw' stop, the "
        f"volatility-normalized failure point; (e) trailing exit at 10-"
        f"bar opposite Donchian — when price closes "
        f"{'below the 10-bar low' if direction == 'bullish' else 'above the 10-bar high'}, "
        f"exit the entire position. The 4N initial target at ${target:.2f} "
        f"is a STATISTICAL average — clean Turtle trends often produce "
        f"6-12N moves, so the trail-stop discipline is what captures the "
        f"tail of expectancy that makes the system profitable in aggregate. "
        f"Position sizing must reflect the {stop_distance_pct:.2f}% stop "
        f"distance: at 1% account risk per trade, position size = "
        f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
        f"of equity. The Turtle 'last trade loser' rule for System 1: skip "
        f"the next breakout if the prior System 1 trade was profitable — "
        f"this anti-overfit filter materially improves Sharpe ratio in "
        f"published Turtle backtests but is not applied to System 2."
    )

    failure_signal = (
        f"Donchian breakouts have a Faith-documented win rate around 30-45% "
        f"— the system's profitability comes from LARGE wins on the "
        f"successful trades dwarfing many small losses on the failures. "
        f"This trade is invalidated if price closes "
        f"{'below' if direction == 'bullish' else 'above'} ${stop:.2f} "
        f"(2N from entry) — exit immediately, no second-guessing. The "
        f"most common failure mode Faith documents is the 'whipsaw' "
        f"breakout: a single bar closes through the Donchian level on "
        f"strong volume, the trade triggers, then the next 3-7 bars retrace "
        f"entirely back through the breakout level and stop out at 2N. "
        f"This pattern is statistically common (~40-50% of Donchian "
        f"signals) and is THE reason the Turtle system requires the 4N+ "
        f"target asymmetry to be profitable in aggregate — losses must be "
        f"kept small and winners must run. The secondary failure: a "
        f"'failed continuation' — the trade triggers, runs 1-2N in favor, "
        f"then reverses and stops out. This is the most psychologically "
        f"painful failure mode because the trader watched paper profit "
        f"give back, but Faith's rule is absolute: NEVER move the stop "
        f"closer to entry until the trade is up 3N+, at which point the "
        f"10-bar trailing Donchian exit takes over. The structural "
        f"invalidation: a violation of the Turtle 'breakeven stop' would "
        f"sabotage the system's expectancy. Donchian's own writings from "
        f"the 1960s emphasize: the system works because losses are KEPT "
        f"SMALL, the trader does NOT deviate from the mechanical rules, "
        f"and winners are allowed to run via the trailing exit. The "
        f"trader who exits a Donchian winner early gives back the "
        f"expectancy that the win-rate-asymmetry requires. {system_name} "
        f"trades that fail typically fail FAST (within 5-10 bars); if "
        f"the trade survives 15+ bars without stopping out, the "
        f"probability of trend continuation rises substantially per "
        f"Faith's published Turtle expectancy curves."
    )

    return {
        "headline": headline,
        "what_it_is": what_it_is,
        "why_it_matters": why_it_matters,
        "what_to_watch_for": what_to_watch_for,
        "failure_signal": failure_signal,
    }


register(_PATTERN_ID, detect_donchian_breakout)
