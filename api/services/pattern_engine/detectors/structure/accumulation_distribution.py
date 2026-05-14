"""Accumulation/Distribution Phase detector - structure detector.

Williams Accumulation/Distribution Line (Larry Williams, 1972) measures
where each bar closes within its range, weighted by volume. The signal
philosophy: in a bullish bar that closes near its high, buyers were in
control - that volume goes 'into' the A/D line. In a bearish bar that
closes near its low, sellers were in control - that volume goes 'out'
of the line. Summed and normalized across a window, the result is a
single number that captures the net institutional fingerprint.

Combined with Richard Wyckoff's 5-phase accumulation/distribution cycle
(Phase A = preliminary support/supply, B = institutional buying/selling,
C = test, D = sign of strength/weakness, E = markup/markdown), the A/D
classification provides a foundational structural read on whether the
market is being absorbed (accumulation), distributed (distribution), or
neither (neutral two-sided flow).

Geometric definition:
  - Window: last 30 bars
  - Per bar money_flow = ((close - low) - (high - close)) / (high - low) * volume
    Range [-volume, +volume]. Positive on bullish close, negative on bearish.
  - Sum money flow over 30 bars.
  - Normalize: ad_score = sum_money_flow / sum_volume_30bars
    Range approximately [-1, 1].

Classification:
  ad_score > 0.30  -> 'accumulation' (bullish)
  ad_score < -0.30 -> 'distribution' (bearish)
  else              -> 'neutral'

Divergence detection:
  - Compare price's net change over the 30-bar window with A/D line's
    net change. If price trends up but A/D doesn't (or vice versa),
    flag as bullish or bearish divergence.

Output:
  - ALWAYS emits exactly ONE Detection summarizing the current phase.
  - Geometry shape: 'candle_mark' at the last bar.

Levels:
  - accumulation: entry = current close (zone reference, no specific trigger),
                  stop = recent swing low * 0.985
  - distribution: entry = current close (zone reference),
                  stop = recent swing high * 1.015
  - neutral: entry/stop/target all None (no actionable trade)

Attribution: Larry Williams ("How I Made One Million Dollars Last Year
Trading Commodities", 1973, and the original Williams A/D Line, 1972).
Richard Wyckoff (1908-1930s) provided the 5-phase cycle taxonomy
(Phases A-E). Pete Steidlmayer's Market Profile (1980s) integrated
volume-at-price into the classification.
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional, Tuple

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "accumulation_distribution"
_WINDOW_BARS = 30
_ACC_THRESHOLD = 0.30
_DIST_THRESHOLD = -0.30
_DIVERGENCE_MIN_PRICE_CHANGE_PCT = 5.0


def detect_accumulation_distribution(bars: List[Bar], context: dict) -> List[Detection]:
    """Classify the current A/D phase across the last 30 bars."""
    if len(bars) < _WINDOW_BARS:
        return []

    window = bars[-_WINDOW_BARS:]
    last_bar = bars[-1]

    sum_money_flow = 0.0
    sum_volume = 0.0
    bullish_bars = 0
    bearish_bars = 0
    ad_line_series = []  # cumulative A/D for divergence
    cum = 0.0

    for b in window:
        bar_high = float(b["h"])
        bar_low = float(b["l"])
        bar_close = float(b["c"])
        bar_volume = float(b["v"])
        rng = bar_high - bar_low
        if rng <= 0 or bar_volume <= 0:
            ad_line_series.append(cum)
            continue
        clv = ((bar_close - bar_low) - (bar_high - bar_close)) / rng
        money_flow = clv * bar_volume
        sum_money_flow += money_flow
        sum_volume += bar_volume
        cum += money_flow
        ad_line_series.append(cum)
        if clv > 0:
            bullish_bars += 1
        elif clv < 0:
            bearish_bars += 1

    if sum_volume <= 0:
        return []

    ad_score = sum_money_flow / sum_volume

    # Classify phase
    if ad_score > _ACC_THRESHOLD:
        phase = "accumulation"
        direction = "bullish"
    elif ad_score < _DIST_THRESHOLD:
        phase = "distribution"
        direction = "bearish"
    else:
        phase = "neutral"
        direction = "neutral"

    # Confidence reflects classification strength
    abs_score = abs(ad_score)
    if abs_score >= 0.60:
        confidence = 90.0
    elif abs_score >= 0.45:
        confidence = 80.0
    elif abs_score >= _ACC_THRESHOLD:
        confidence = 70.0
    elif abs_score >= 0.20:
        confidence = 60.0
    else:
        confidence = 55.0

    # Divergence detection: compare price net change vs A/D line net change
    first_close = float(window[0]["c"])
    last_close = float(window[-1]["c"])
    price_change_pct = ((last_close - first_close) / first_close * 100.0) if first_close > 0 else 0.0

    ad_first = ad_line_series[0] if ad_line_series else 0.0
    ad_last = ad_line_series[-1] if ad_line_series else 0.0
    ad_net_change = ad_last - ad_first

    divergence_type = "none"
    if abs(price_change_pct) >= _DIVERGENCE_MIN_PRICE_CHANGE_PCT:
        if price_change_pct > 0 and ad_net_change < 0:
            divergence_type = "bearish"  # price up, A/D down = bearish (distribution into rally)
        elif price_change_pct < 0 and ad_net_change > 0:
            divergence_type = "bullish"  # price down, A/D up = bullish (accumulation into decline)

    # Levels per phase
    current_close = float(last_bar["c"])

    if phase == "accumulation":
        recent_low = min(float(b["l"]) for b in bars[-15:])
        entry = round(current_close, 2)
        entry_condition = (
            f"accumulation phase active - reference long entry zone at "
            f"${current_close:.2f}; ad_score={ad_score:.3f}"
        )
        stop = round(recent_low * 0.985, 2)
        stop_basis = "1.5% below recent 15-bar swing low"
        target_primary = None
        target_secondary = None
    elif phase == "distribution":
        recent_high = max(float(b["h"]) for b in bars[-15:])
        entry = round(current_close, 2)
        entry_condition = (
            f"distribution phase active - reference short entry zone at "
            f"${current_close:.2f}; ad_score={ad_score:.3f}"
        )
        stop = round(recent_high * 1.015, 2)
        stop_basis = "1.5% above recent 15-bar swing high"
        target_primary = None
        target_secondary = None
    else:
        entry = None
        entry_condition = (
            f"neutral A/D phase - ad_score={ad_score:.3f}, neither "
            "accumulation nor distribution; no actionable trade levels"
        )
        stop = None
        stop_basis = ""
        target_primary = None
        target_secondary = None

    rr = 0.0  # No measured target

    last_bar_t = int(last_bar["t"])
    window_start_t = int(window[0]["t"])

    # Geometry
    anchors = [{"t": last_bar_t, "price": current_close}]

    extras = {
        "ad_score": round(float(ad_score), 4),
        "phase": phase,
        "divergence_type": divergence_type,
        "money_flow_30bar_sum": round(float(sum_money_flow), 2),
        "volume_30bar_sum": round(float(sum_volume), 2),
        "bullish_bars": int(bullish_bars),
        "bearish_bars": int(bearish_bars),
        "neutral_bars": int(_WINDOW_BARS - bullish_bars - bearish_bars),
        "price_change_pct_30bar": round(float(price_change_pct), 3),
        "ad_net_change": round(float(ad_net_change), 2),
        "window_bars": _WINDOW_BARS,
        "current_close": round(float(current_close), 4),
        "first_close": round(float(first_close), 4),
        "dcr_score_adj": 0.0,
    }

    # ---- Narrative ----
    regime = context.get("regime", "current")
    rs_trend = context.get("rs_trend", "flat")
    vol_signature = context.get("volume_signature", "neutral")

    headline = _compose_headline(phase, ad_score, divergence_type,
                                  bullish_bars, bearish_bars,
                                  price_change_pct, current_close)
    what_it_is, why_it_matters, what_to_watch_for, failure_signal = _compose_body(
        phase=phase,
        ad_score=ad_score,
        divergence_type=divergence_type,
        bullish_bars=bullish_bars,
        bearish_bars=bearish_bars,
        sum_money_flow=sum_money_flow,
        sum_volume=sum_volume,
        price_change_pct=price_change_pct,
        ad_net_change=ad_net_change,
        current_close=current_close,
        first_close=first_close,
        regime=regime,
        rs_trend=rs_trend,
        volume_signature=vol_signature,
        entry=entry,
        stop=stop,
    )

    now = int(time.time())

    return [{
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Accumulation/Distribution Phase",
        "category": "structure",
        "direction": direction,
        "start_t": window_start_t,
        "end_t": last_bar_t,
        "pivot_ts": [window_start_t, last_bar_t],
        "geometry": {
            "shape": "candle_mark",
            "anchors": anchors,
            "extras": extras,
        },
        "levels": {
            "entry": entry,
            "entry_condition": entry_condition,
            "stop": stop,
            "stop_basis": stop_basis,
            "target_primary": target_primary,
            "target_secondary": target_secondary,
            "risk_reward": round(rr, 2),
        },
        "context": context,
        "confidence": round(float(confidence), 2),
        "quality_components": {
            "geometry_score": round(float(min(100.0, abs(ad_score) * 100.0 + 50.0)), 2),
            "volume_score": round(float(min(100.0, abs(ad_score) * 100.0 + 50.0)), 2),
            "context_score": 50.0,
            "historical_score": 50.0,
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
    }]


def _compose_headline(phase: str, ad_score: float, divergence_type: str,
                      bullish_bars: int, bearish_bars: int,
                      price_change_pct: float, current_close: float) -> str:
    div_phrase = ""
    if divergence_type == "bullish":
        div_phrase = " | BULLISH DIVERGENCE (price down, A/D up)"
    elif divergence_type == "bearish":
        div_phrase = " | BEARISH DIVERGENCE (price up, A/D down)"

    return (
        f"A/D Phase: {phase.upper()} - ad_score {ad_score:+.3f}, "
        f"{bullish_bars} bullish-close bars vs {bearish_bars} bearish-close "
        f"bars over 30 bars, price {price_change_pct:+.1f}%, close "
        f"${current_close:.2f}{div_phrase}."
    )


def _phase_descriptor(phase: str) -> str:
    return {
        "accumulation": "ACCUMULATION (institutional buying signature - "
                        "money flowing into the stock)",
        "distribution": "DISTRIBUTION (institutional selling signature - "
                        "money flowing out of the stock)",
        "neutral": "NEUTRAL (no clear directional money-flow dominance - "
                   "two-sided rotation)",
    }[phase]


def _wyckoff_phase_mapping(phase: str, divergence_type: str) -> str:
    if phase == "accumulation":
        if divergence_type == "bullish":
            return (
                "Wyckoff Phase C-to-D (Spring/Test followed by Sign of "
                "Strength) - the most aggressive accumulation read"
            )
        return (
            "Wyckoff Phase B-to-C (institutional acquisition transitioning "
            "to the final test before markup)"
        )
    if phase == "distribution":
        if divergence_type == "bearish":
            return (
                "Wyckoff Phase C-to-D (Upthrust followed by Sign of Weakness) "
                "- the most aggressive distribution read"
            )
        return (
            "Wyckoff Phase B-to-C (institutional unloading transitioning to "
            "the final test before markdown)"
        )
    return (
        "transitional / pre-phase-A territory (the cycle is between active "
        "accumulation and distribution states)"
    )


def _compose_body(
    phase: str,
    ad_score: float,
    divergence_type: str,
    bullish_bars: int,
    bearish_bars: int,
    sum_money_flow: float,
    sum_volume: float,
    price_change_pct: float,
    ad_net_change: float,
    current_close: float,
    first_close: float,
    regime: str,
    rs_trend: str,
    volume_signature: str,
    entry: Optional[float],
    stop: Optional[float],
) -> Tuple[str, str, str, str]:
    phase_desc = _phase_descriptor(phase)
    wyckoff_phase = _wyckoff_phase_mapping(phase, divergence_type)
    flow_pct = abs(ad_score) * 100.0
    neutral_bars = 30 - bullish_bars - bearish_bars

    if phase == "accumulation":
        what_it_is = (
            f"The 30-bar Williams Accumulation/Distribution score reads "
            f"{ad_score:+.3f}, well above the {_ACC_THRESHOLD:+.2f} "
            f"accumulation threshold. This means that on a volume-weighted "
            f"basis, {flow_pct:.1f}% of every dollar that changed hands "
            f"over the last 30 bars flowed INTO the stock rather than out - "
            f"the textbook fingerprint of institutional buying. The math "
            f"underneath: each bar contributes a 'close location value' "
            f"(CLV) defined as ((close - low) - (high - close)) / (high - "
            f"low), which is +1 for a bar that closes at its high, -1 for "
            f"a bar that closes at its low, and 0 for a bar that closes "
            f"mid-range. That CLV is then multiplied by the bar's volume "
            f"to produce the bar's money flow, and 30 bars of money flow "
            f"are summed and normalized against 30 bars of total volume to "
            f"produce the {ad_score:+.3f} reading. Larry Williams "
            f"introduced this construction in 1972 as a way to extract the "
            f"institutional fingerprint from raw OHLCV data without "
            f"requiring tape, time-and-sales, or order-book access - the "
            f"close-within-range tells you who was in control, the volume "
            f"weight tells you how much capital was actually deployed. "
            f"Across the 30-bar window {bullish_bars} bars closed in the "
            f"upper half of their range (bullish closes), {bearish_bars} "
            f"closed in the lower half (bearish closes), and "
            f"{neutral_bars} closed mid-range. The Wyckoff overlay "
            f"classifies this read as {wyckoff_phase}, mapping the "
            f"Williams quant signal onto the 5-phase accumulation cycle "
            f"(Phase A preliminary support, B institutional acquisition, "
            f"C spring/test, D sign of strength, E markup) that Richard "
            f"Wyckoff documented over the 1908-1930s period and that "
            f"institutional money managers still use as their foundational "
            f"market-structure framework. Mark Ritchie II's modern "
            f"post-IPO playbook uses A/D scoring as a core filter — he "
            f"treats sustained accumulation in a recently-public liquid "
            f"name as one of the highest-edge confluence reads for entering "
            f"a fresh-leadership long. Adam Grimes's empirical work on "
            f"accumulation/distribution patterns in 'The Art and Science of "
            f"Technical Analysis' updates the classical interpretation "
            f"with probability statistics around the volume-weighted close "
            f"signature."
        )
        why_it_matters = (
            f"This is {phase_desc} reading. In a {regime} regime with "
            f"{rs_trend} relative strength and {volume_signature} volume "
            f"signature, an ad_score of {ad_score:+.3f} carries direct "
            f"trading-decision weight: it tells you institutional money "
            f"is being committed at this price band even when the visible "
            f"price action looks ambiguous or sideways. Accumulation "
            f"readings during sideways price ranges are particularly "
            f"valuable because they reveal the 'composite operator' "
            f"(Wyckoff's term for the aggregated institutional bid) is "
            f"quietly absorbing supply at a fixed range. The "
            f"{price_change_pct:+.1f}% price change over the 30-bar "
            f"window juxtaposed with the {ad_score:+.3f} A/D reading "
            f"reveals the rate-of-return on capital flowing in vs the "
            f"price markup actually achieved - in efficient markets these "
            f"correlate, but in real markets a positive A/D paired with "
            f"flat or negative price is one of the most reliable bullish "
            f"divergence signatures in technical analysis. "
            f"{('That divergence IS firing here - price has fallen but ' if divergence_type == 'bullish' else '')}"
            f"{('A/D is rising, indicating the visible decline has been ' if divergence_type == 'bullish' else '')}"
            f"{('absorbed by institutional buying rather than confirmed by ' if divergence_type == 'bullish' else '')}"
            f"{('institutional selling. ' if divergence_type == 'bullish' else '')}"
            f"For practical position sizing: accumulation readings paired "
            f"with rising relative strength and Stage 1/Stage 2 trend "
            f"context support larger-than-baseline long exposure; "
            f"accumulation against a Stage 3/Stage 4 context is more "
            f"speculative and should be sized down until the broader "
            f"regime confirms. Bonde and the UCT methodology specifically "
            f"weight A/D positive readings as a confirming filter for "
            f"high-tight flag and VCP setups - the accumulation reading "
            f"is the institutional fingerprint that distinguishes a "
            f"high-conviction base from a graveyard one."
        )
        wtw_div = ""
        if divergence_type == "bullish":
            wtw_div = (
                "The active bullish divergence (price down, A/D up) is "
                "the highest-conviction expression of this phase - watch "
                "for the first sign of price catching up to the rising "
                "A/D, typically a wide-range bullish bar that closes "
                "above the 20-EMA on volume. "
            )
        what_to_watch_for = (
            f"With ad_score {ad_score:+.3f} and {bullish_bars} of 30 bars "
            f"closing bullishly, the structural read is that buyers are "
            f"in control even if the price action looks sideways. "
            f"{wtw_div}The trade application is NOT a single-bar trigger - "
            f"accumulation is a STATE, not a signal. Use it to weight long "
            f"setup conviction: any base breakout, VCP, flag, or remount "
            f"that fires in an accumulation context inherits a higher "
            f"prior probability of follow-through. Reference long entry "
            f"zone at ${entry:.2f} (current close), stop "
            f"at ${stop:.2f} (1.5% below the recent 15-bar swing low). "
            f"For trade construction: enter long on any standard setup "
            f"that fires within this 30-bar accumulation window; size up "
            f"if the A/D score climbs further (ad_score >0.50 is "
            f"institutional-grade accumulation); size down if A/D begins "
            f"to deteriorate. Watch the 30-bar window roll forward - the "
            f"strongest accumulation readings are 3-6 consecutive 30-bar "
            f"windows all reporting ad_score >0.30, which signals "
            f"sustained institutional engagement rather than a transient "
            f"single-window read. Pair this with the volume-profile "
            f"detector and the support/resistance detector: HVNs that "
            f"form WITHIN an accumulation window become the highest-"
            f"conviction long-entry reference levels because they pin the "
            f"exact prices where institutional capital is being deployed. "
            f"In Wyckoff terms, watch for a 'Sign of Strength' (a wide-"
            f"range bullish bar on heavy volume that breaks above a prior "
            f"trading range high) as the Phase D -> Phase E transition "
            f"signal."
        )
        failure_signal = (
            f"The accumulation reading is invalidated when ad_score falls "
            f"below {_ACC_THRESHOLD:+.2f} on two consecutive 30-bar window "
            f"rolls - that's the textbook signal that the institutional "
            f"bid has stepped aside and the prior accumulation phase has "
            f"completed or aborted. The more severe failure: ad_score "
            f"crossing into negative territory (below 0) on a fresh "
            f"30-bar window, indicating the institutional flow has "
            f"reversed from absorbing to distributing. From the current "
            f"{ad_score:+.3f} reading, a drop to neutral or distribution "
            f"would require ~{int((ad_score - _DIST_THRESHOLD) * sum_volume / 30 / abs(sum_money_flow / 30) * 100 if sum_money_flow != 0 else 100):.0f}% "
            f"deterioration in the per-bar money-flow rate over the next "
            f"few bars - achievable on a series of bearish-close bars on "
            f"heavy volume. Common false-positive failure modes: (a) the "
            f"accumulation reading is being driven by a SINGLE outlier "
            f"bar (a 5x-volume bullish wide-range bar) rather than "
            f"distributed across many bars - check the bullish_bars vs "
            f"bearish_bars count to see whether the read is well-"
            f"distributed; (b) the accumulation is happening at an "
            f"already-extended price level (10-25% above 50-SMA) where "
            f"residual buying interest is exhausted; (c) the accumulation "
            f"is happening against deteriorating relative strength - true "
            f"accumulation usually shows up in RS BEFORE absolute price, "
            f"so {rs_trend} rs_trend would be a confirming factor. The "
            f"single most important Wyckoff failure signal: 'No Demand' "
            f"bars - narrow-range bars on light volume that fail to "
            f"extend in either direction, signaling the accumulation "
            f"thesis is being challenged by absent follow-through buyers."
        )
    elif phase == "distribution":
        what_it_is = (
            f"The 30-bar Williams Accumulation/Distribution score reads "
            f"{ad_score:+.3f}, well below the {_DIST_THRESHOLD:+.2f} "
            f"distribution threshold. This means that on a volume-weighted "
            f"basis, {flow_pct:.1f}% of every dollar that changed hands "
            f"over the last 30 bars flowed OUT of the stock - the textbook "
            f"fingerprint of institutional selling. The math underneath: "
            f"each bar contributes a 'close location value' (CLV) defined "
            f"as ((close - low) - (high - close)) / (high - low), which is "
            f"+1 for a bar that closes at its high, -1 for a bar that "
            f"closes at its low, and 0 for a mid-range close. That CLV is "
            f"multiplied by volume to produce per-bar money flow, summed "
            f"and normalized across the window. Larry Williams introduced "
            f"this in 1972 as a way to extract the institutional "
            f"fingerprint from raw OHLCV data: the close-within-range "
            f"tells you who was in control, the volume weight tells you "
            f"how much capital was actually committed. Across the 30-bar "
            f"window {bearish_bars} bars closed in the lower half of "
            f"their range (bearish closes), only {bullish_bars} closed "
            f"in the upper half, and {neutral_bars} closed mid-range. The "
            f"Wyckoff overlay classifies this as {wyckoff_phase}, mapping "
            f"the Williams signal onto the 5-phase distribution cycle "
            f"(PSY preliminary supply, BC buying climax, AR automatic "
            f"reaction, ST secondary test, SOW sign of weakness, LPSY "
            f"last point of supply, then markdown) that Richard Wyckoff "
            f"documented over the 1908-1930s period and that institutional "
            f"money managers use as their distribution-cycle framework. "
            f"Mark Ritchie II uses sustained distribution readings as one "
            f"of his hard-exit triggers on long positions — when A/D "
            f"flips negative against price still grinding higher, his "
            f"playbook calls for harvesting gains rather than waiting for "
            f"the price-action confirmation. Adam Grimes's empirical work "
            f"in 'The Art and Science of Technical Analysis' frames the "
            f"close-within-range signature as one of the most reliable "
            f"early warnings of an institutional regime change."
        )
        why_it_matters = (
            f"This is {phase_desc}. In a {regime} regime with {rs_trend} "
            f"relative strength and {volume_signature} volume signature, an "
            f"ad_score of {ad_score:+.3f} carries direct trading-decision "
            f"weight: it tells you institutional money is being WITHDRAWN "
            f"at this price band even when the price action still looks "
            f"benign or sideways. Distribution readings during sideways "
            f"or even rising price ranges are particularly valuable "
            f"because they reveal the composite operator is quietly "
            f"unloading into retail demand at a fixed range while the "
            f"tape looks healthy. The {price_change_pct:+.1f}% price "
            f"change over the 30-bar window juxtaposed with the "
            f"{ad_score:+.3f} A/D reading reveals the disconnect between "
            f"visible price and underlying flow - in efficient markets "
            f"these correlate, but in real markets a negative A/D paired "
            f"with flat or rising price is one of the most reliable "
            f"bearish divergence signatures in technical analysis. "
            f"{('That divergence IS firing here - price has risen but ' if divergence_type == 'bearish' else '')}"
            f"{('A/D is falling, indicating the visible rally has been ' if divergence_type == 'bearish' else '')}"
            f"{('distributed into rather than confirmed by institutional ' if divergence_type == 'bearish' else '')}"
            f"{('buying. This is the textbook Wyckoff Upthrust scenario. ' if divergence_type == 'bearish' else '')}"
            f"For practical position sizing: distribution readings paired "
            f"with deteriorating relative strength and Stage 3/Stage 4 "
            f"trend context support short exposure and require trimming "
            f"any remaining long positions; distribution against a Stage "
            f"1/Stage 2 context is a yellow-flag warning that the "
            f"institutional bid is fading and trend continuation is at "
            f"risk. The reverse of the accumulation playbook: any "
            f"continuation-pattern long setup (VCP, flat base, flag) "
            f"that fires in a distribution context inherits a LOWER prior "
            f"probability of follow-through and frequently fails as a "
            f"'bull trap' breakout."
        )
        wtw_div = ""
        if divergence_type == "bearish":
            wtw_div = (
                "The active bearish divergence (price up, A/D down) is "
                "the highest-conviction expression of this phase - watch "
                "for the first sign of price catching down to the falling "
                "A/D, typically a wide-range bearish bar that closes "
                "below the 20-EMA on volume. "
            )
        what_to_watch_for = (
            f"With ad_score {ad_score:+.3f} and {bearish_bars} of 30 bars "
            f"closing bearishly, the structural read is that sellers are "
            f"in control even if the price action looks sideways. "
            f"{wtw_div}The trade application is NOT a single-bar trigger - "
            f"distribution is a STATE, not a signal. Use it to weight "
            f"short setup conviction and trim long exposure: any top "
            f"pattern, head-and-shoulders, double top, or rising wedge "
            f"that fires in a distribution context inherits a higher "
            f"prior probability of follow-through. Reference short entry "
            f"zone at ${entry:.2f} (current close), stop at ${stop:.2f} "
            f"(1.5% above the recent 15-bar swing high). For trade "
            f"construction: enter short on any standard top setup that "
            f"fires within this 30-bar distribution window; size up if "
            f"ad_score falls further (ad_score <-0.50 is institutional-"
            f"grade distribution); size down if A/D begins to recover. "
            f"Watch the 30-bar window roll forward - the strongest "
            f"distribution readings are 3-6 consecutive 30-bar windows "
            f"all reporting ad_score <-0.30, which signals sustained "
            f"institutional unwinding rather than a transient single-"
            f"window read. In Wyckoff terms, watch for a 'Sign of "
            f"Weakness' (a wide-range bearish bar on heavy volume that "
            f"breaks below a prior trading range low) as the Phase D -> "
            f"Phase E transition signal. Pair this with the volume-"
            f"profile detector: HVNs that form WITHIN a distribution "
            f"window become the highest-conviction short-entry reference "
            f"levels because they pin the exact prices where "
            f"institutional capital is being unloaded."
        )
        failure_signal = (
            f"The distribution reading is invalidated when ad_score "
            f"rises above {_DIST_THRESHOLD:+.2f} on two consecutive "
            f"30-bar window rolls - that's the textbook signal that the "
            f"institutional supply has been exhausted and the prior "
            f"distribution phase has completed. The more severe failure: "
            f"ad_score crossing into positive territory (above 0) on a "
            f"fresh 30-bar window, indicating the institutional flow has "
            f"reversed from distributing to absorbing. From the current "
            f"{ad_score:+.3f} reading, a rise to neutral or accumulation "
            f"would require sustained bullish-close bars on heavy volume "
            f"over the next 10-15 bars. Common false-positive failure "
            f"modes: (a) the distribution reading is driven by a SINGLE "
            f"outlier bar (a 5x-volume bearish wide-range bar) rather "
            f"than distributed across the full window - check the "
            f"bullish_bars vs bearish_bars count for distribution "
            f"breadth; (b) the distribution is happening at an oversold "
            f"price level (well below 50-SMA) where residual selling "
            f"interest is exhausted and a reversal becomes asymmetric; "
            f"(c) the distribution is happening against improving "
            f"relative strength - true distribution usually shows up in "
            f"RS BEFORE absolute price, so {rs_trend} rs_trend "
            f"contradicts the read. The Wyckoff equivalent of an "
            f"invalidated distribution is 'No Supply' - narrow-range "
            f"bars on light volume that fail to extend lower, signaling "
            f"the distribution thesis is being challenged by absent "
            f"follow-through sellers. Short positions taken on a "
            f"distribution thesis must respect the asymmetric risk of "
            f"short trades (capped reward, uncapped loss) - the "
            f"${stop:.2f} stop is the line in the sand and widening it "
            f"on a failing thesis is the fastest way to convert a "
            f"manageable loss into account-damaging exposure."
        )
    else:  # neutral
        what_it_is = (
            f"The 30-bar Williams Accumulation/Distribution score reads "
            f"{ad_score:+.3f}, between the {_DIST_THRESHOLD:+.2f} "
            f"distribution and {_ACC_THRESHOLD:+.2f} accumulation "
            f"thresholds. This means the volume-weighted close-location "
            f"analysis across the last 30 bars shows neither clear "
            f"institutional buying nor clear institutional selling - the "
            f"flow is balanced. The math underneath: per-bar money flow "
            f"is computed as ((close - low) - (high - close)) / (high - "
            f"low) * volume, which is +volume on a bar closing at its "
            f"high and -volume on a bar closing at its low. Summed and "
            f"normalized across 30 bars, the {ad_score:+.3f} reading "
            f"means roughly {flow_pct:.1f}% of dollar flow tilted to the "
            f"{('buy side' if ad_score >= 0 else 'sell side')} - well "
            f"below the {30:.0f}% threshold that would qualify as a "
            f"definitive accumulation or distribution read. Across the "
            f"30-bar window {bullish_bars} bars closed bullishly, "
            f"{bearish_bars} closed bearishly, and {neutral_bars} closed "
            f"mid-range - a roughly two-sided distribution of intent. The "
            f"Wyckoff cycle overlay classifies this as {wyckoff_phase}, "
            f"meaning the institutional flow is in transition between "
            f"accumulation and distribution states rather than active "
            f"deployment in either direction. Neutral A/D readings are "
            f"the default state of markets that are between trends - "
            f"rotation, chop, and indecisive auction flow all produce "
            f"this kind of balanced two-sided read. Larry Williams's "
            f"original A/D Line was specifically designed to filter OUT "
            f"this state, surfacing only the high-conviction "
            f"accumulation/distribution windows. Adam Grimes's modern "
            f"empirical research treats the neutral A/D zone as the "
            f"default for stocks in Weinstein Stage 1 or Stage 3 "
            f"transitions — most useful as a screening filter (skip "
            f"neutral, focus on directional readings) rather than as a "
            f"standalone trade signal. Mark Ritchie II uses the neutral "
            f"reading as a 'wait' state in his post-IPO playbook — he "
            f"requires a directional A/D confirmation before sizing into "
            f"a newly-public name."
        )
        why_it_matters = (
            f"This is {phase_desc}. In a {regime} regime with {rs_trend} "
            f"relative strength and {volume_signature} volume signature, a "
            f"neutral A/D reading is itself a meaningful signal: it tells "
            f"you institutional money is NOT actively deployed in either "
            f"direction at this price band, which has direct implications "
            f"for any setup you might be considering. Trend-continuation "
            f"setups (VCP, flat base, flag, breakout) that fire in a "
            f"neutral A/D context inherit baseline (50%) prior probability "
            f"of follow-through rather than the elevated probability "
            f"granted by an aligned A/D reading - they need to clear a "
            f"higher bar (heavy breakout volume, strong relative strength "
            f"confirmation, multiple-timeframe alignment) before they "
            f"deserve full position size. Reversal setups (double top/"
            f"bottom, triple top/bottom, head-and-shoulders) in a neutral "
            f"context are particularly likely to misfire because the "
            f"institutional signature that confirms reversals (sudden "
            f"flip from one A/D state to the opposite) is precisely "
            f"what's MISSING. The {price_change_pct:+.1f}% price change "
            f"over the 30-bar window with a flat {ad_score:+.3f} A/D "
            f"reading is the structural definition of a 'fair value' "
            f"or 'value-finding' phase - the market is auctioning to "
            f"locate equilibrium rather than trending. For positioning: "
            f"reduce gross exposure, tighten stops, avoid initiating "
            f"large new positions, and wait for the A/D to break decisively "
            f"out of the neutral band (above +0.30 or below -0.30) before "
            f"committing to a directional thesis. Neutral A/D windows "
            f"can persist for many weeks during sideways trading ranges "
            f"and represent the institutional 'pause' between active "
            f"deployment cycles."
        )
        what_to_watch_for = (
            f"With ad_score {ad_score:+.3f} sitting between the "
            f"{_DIST_THRESHOLD:+.2f}/{_ACC_THRESHOLD:+.2f} thresholds, "
            f"the actionable signal is the BREAKOUT direction of the A/D "
            f"reading itself, not any single-bar price trigger. Watch for "
            f"the 30-bar rolling A/D to cross above +0.30 (would signal "
            f"transition to accumulation) or below -0.30 (transition to "
            f"distribution) - those crosses are the high-conviction signals "
            f"that allow you to re-engage with directional setups. While "
            f"the reading remains neutral, focus on: (a) volume of "
            f"bullish-close bars vs bearish-close bars - the "
            f"{bullish_bars}-vs-{bearish_bars} mix here is "
            f"{('approximately balanced' if abs(bullish_bars - bearish_bars) <= 3 else 'tilted but inconclusive')} "
            f"and roughly tracks the {ad_score:+.3f} score; (b) the price "
            f"range across the 30-bar window - tight ranges in neutral "
            f"A/D contexts often resolve as compression-then-expansion "
            f"setups, while wide ranges signal pure chop; (c) the "
            f"interaction with HVNs from the volume-profile detector - "
            f"neutral A/D readings WITHIN an HVN value-zone are typical "
            f"and self-explanatory (the market is at fair value), while "
            f"neutral readings OUTSIDE any HVN reference are structurally "
            f"unusual and often resolve quickly. No specific trade "
            f"levels apply in this state - the structural reference is "
            f"current close at ${current_close:.2f}, but no entry or "
            f"stop is recommended until the A/D classification changes. "
            f"The most important thing to watch is when the neutral "
            f"reading ENDS - the direction of the breakout from this "
            f"balanced state is itself one of the cleanest leading "
            f"indicators of the next directional move."
        )
        failure_signal = (
            f"A neutral A/D reading does not 'fail' in the conventional "
            f"sense - it's a description of the current state, not a "
            f"thesis. The relevant question for risk management is when "
            f"the neutral reading will RESOLVE and in which direction. "
            f"The transition signals: (a) ad_score crossing above "
            f"{_ACC_THRESHOLD:+.2f} on the rolling 30-bar window resolves "
            f"to accumulation - confirming bullish bias; (b) ad_score "
            f"crossing below {_DIST_THRESHOLD:+.2f} resolves to "
            f"distribution - confirming bearish bias. False signals "
            f"around the thresholds: a brief excursion above +0.30 or "
            f"below -0.30 that immediately reverts to neutral within 5-10 "
            f"bars is a 'flicker' that should be IGNORED rather than "
            f"acted on - the {ad_score:+.3f} reading currently is the "
            f"average state, not the breakout state. Sustained "
            f"persistence in the neutral band is itself important "
            f"information: prolonged neutrality (4-8+ consecutive 30-bar "
            f"windows all reading between -0.30 and +0.30) is the "
            f"structural signature of an extended rotation or value-area "
            f"range, and is the textbook setup for an eventual expansive "
            f"breakout in whichever direction first commits institutional "
            f"flow. Risk-management posture during sustained neutral "
            f"reads: reduce position sizing across the board (the "
            f"institutional signal is absent), tighten stops on all "
            f"existing positions, lengthen time-horizon expectations "
            f"(neutrality often resolves slowly), and watch the related "
            f"detectors (volume profile, S/R, stage analysis) for "
            f"complementary confirmation when the A/D finally breaks out "
            f"of the neutral band."
        )
    return what_it_is, why_it_matters, what_to_watch_for, failure_signal


register(_PATTERN_ID, detect_accumulation_distribution)
