"""Channel detector (ascending / descending / horizontal).

A channel is two parallel trendlines bounding a sustained run of price action.
Both lines slope the same direction (or are both flat); the channel's direction
follows the slope:
  - Both slopes > 0 -> ascending channel (bullish trend channel)
  - Both slopes < 0 -> descending channel (bearish trend channel)
  - Both |slope| < 0.001 * mid_price -> horizontal channel (range-bound)

Geometric definition:
  - Window: 25-80 bars
  - Two trendlines fit through swing-high / swing-low pivots
  - Same slope sign (both positive, both negative, or both effectively zero)
  - Parallelism: channel_width_parallel_score >= 0.7
  - >=3 touches on each line
  - Channel depth: 5-25% of mid_price
  - Volume signature: variable (not a hard gate)
  - Re-key pivots to bar_index before fitting (`t = bar_index`)

Levels (ascending):
  entry = upper * 0.998 (continuation pullback to lower acts as buy; alternatively
                          buy on rejection of upper - we emit the conservative
                          pullback-buy entry just inside the upper line)
  stop  = lower * 0.985
  target = upper projection +10 bars

For descending: short the upper, target the lower. For horizontal: emit with
neutral direction and note that breakout direction is undetermined.

Attribution: Richard Donchian (1934 - Donchian channels), Andrew Cardwell,
Constance Brown for modern usage. Edwards & Magee folded channels into the
classical canon as "Trend Channels" in their 1948 work.
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.geometry import (
    channel_width_parallel_score,
    line_at,
)
from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.primitives.trendlines import fit_trendline
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "channel"
_MIN_BARS = 25
_MAX_BARS = 80
_MIN_TOUCHES = 3
_MIN_LINE_VALIDITY = 0.4
_MIN_PARALLEL_SCORE = 0.70
_MIN_DEPTH_PCT = 0.05
_MAX_DEPTH_PCT = 0.25
_HORIZONTAL_SLOPE_FRACTION = 0.001  # |slope| < 0.001 * mid_price -> horizontal
_CONFIDENCE_FLOOR = 50.0


def detect_channel(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect channel patterns in the bars. May emit 0-N detections."""
    if len(bars) < _MIN_BARS + 5:
        return []

    detections: List[Detection] = []

    pivots = detect_pivots(bars, window=3)
    if len(pivots) < 4:
        return []

    end_idx = len(bars) - 1
    seen_starts = set()
    for window_len in (50, 40, 60, 35, 45, 55, 70, 30, 80):
        start_idx = end_idx - window_len + 1
        if start_idx < 5:
            continue
        if start_idx in seen_starts:
            continue
        seen_starts.add(start_idx)
        candidate = _try_extract_pattern(bars, pivots, start_idx, end_idx)
        if candidate is None:
            continue

        geom_score = _score_geometry(candidate)
        vol_score = _score_volume(bars, candidate)
        ctx_score = _score_context(context, candidate["direction"])
        hist_score = 50.0

        confidence = round(
            0.40 * geom_score + 0.20 * vol_score + 0.25 * ctx_score + 0.15 * hist_score, 2
        )
        if confidence < _CONFIDENCE_FLOOR:
            continue

        d = _build_detection(bars, candidate, confidence, context,
                             geom_score, vol_score, ctx_score, hist_score)
        detections.append(d)
        break

    return detections


def _try_extract_pattern(bars, pivots, start_idx: int, end_idx: int) -> Optional[dict]:
    pattern_bars = bars[start_idx:end_idx + 1]
    bar_count = len(pattern_bars)
    if bar_count < _MIN_BARS or bar_count > _MAX_BARS:
        return None

    high_pivots_raw = [p for p in pivots
                       if p["type"] == "high" and start_idx <= p["bar_index"] <= end_idx]
    low_pivots_raw = [p for p in pivots
                      if p["type"] == "low" and start_idx <= p["bar_index"] <= end_idx]
    if len(high_pivots_raw) < _MIN_TOUCHES or len(low_pivots_raw) < _MIN_TOUCHES:
        return None

    # CRITICAL: re-key pivots so t = bar_index before fitting trendlines.
    high_pivots = [{"t": p["bar_index"], "price": p["price"],
                    "type": "high", "strength": p["strength"],
                    "bar_index": p["bar_index"]} for p in high_pivots_raw]
    low_pivots = [{"t": p["bar_index"], "price": p["price"],
                   "type": "low", "strength": p["strength"],
                   "bar_index": p["bar_index"]} for p in low_pivots_raw]

    try:
        upper_line = fit_trendline(high_pivots)
        lower_line = fit_trendline(low_pivots)
    except ValueError:
        return None

    if upper_line["touches"] < _MIN_TOUCHES or lower_line["touches"] < _MIN_TOUCHES:
        return None

    # Endpoint values at start/end bar indices
    upper_at_start = line_at((upper_line["p1"], upper_line["p2"]), start_idx)
    upper_at_end = line_at((upper_line["p1"], upper_line["p2"]), end_idx)
    lower_at_start = line_at((lower_line["p1"], lower_line["p2"]), start_idx)
    lower_at_end = line_at((lower_line["p1"], lower_line["p2"]), end_idx)

    if upper_at_start <= 0 or upper_at_end <= 0:
        return None
    if upper_at_start <= lower_at_start or upper_at_end <= lower_at_end:
        return None

    mid_price = (upper_at_start + upper_at_end + lower_at_start + lower_at_end) / 4.0
    if mid_price <= 0:
        return None

    upper_slope = upper_line["slope"]
    lower_slope = lower_line["slope"]
    horiz_threshold = _HORIZONTAL_SLOPE_FRACTION * mid_price
    is_horizontal = (abs(upper_slope) < horiz_threshold
                     and abs(lower_slope) < horiz_threshold)

    # Validity gate: regression r² is naturally low on near-flat data because
    # the signal-to-noise is small. Only enforce validity threshold for
    # genuinely sloped channels.
    if not is_horizontal:
        if upper_line["validity"] < _MIN_LINE_VALIDITY or lower_line["validity"] < _MIN_LINE_VALIDITY:
            return None

    if is_horizontal:
        direction = "neutral"
        channel_type = "horizontal"
    elif upper_slope > 0 and lower_slope > 0:
        direction = "bullish"
        channel_type = "ascending"
    elif upper_slope < 0 and lower_slope < 0:
        direction = "bearish"
        channel_type = "descending"
    else:
        # Slopes diverge in sign and neither is flat - not a channel.
        return None

    # Parallelism: width preservation across endpoints.
    pattern_high = max(b["h"] for b in pattern_bars)
    pattern_low = min(b["l"] for b in pattern_bars)
    parallel_score = channel_width_parallel_score(
        upper_line, lower_line, pattern_high, pattern_low
    )
    if parallel_score < _MIN_PARALLEL_SCORE:
        return None

    width_start = upper_at_start - lower_at_start
    width_end = upper_at_end - lower_at_end
    if width_start <= 0 or width_end <= 0:
        return None
    avg_width = (width_start + width_end) / 2.0
    depth_pct = avg_width / mid_price
    if depth_pct < _MIN_DEPTH_PCT or depth_pct > _MAX_DEPTH_PCT:
        return None

    # Sanity: the actual price action should mostly live within the channel.
    # Allow at most 10% of bars to spike materially outside the bands.
    bi_count = 0
    for offset, b in enumerate(pattern_bars):
        bi = start_idx + offset
        upper_here = line_at((upper_line["p1"], upper_line["p2"]), bi)
        lower_here = line_at((lower_line["p1"], lower_line["p2"]), bi)
        if upper_here <= 0:
            continue
        tol = 0.015 * upper_here  # 1.5% tolerance band
        if b["h"] > upper_here + tol or b["l"] < lower_here - tol:
            bi_count += 1
    if bi_count / max(bar_count, 1) > 0.10:
        return None

    return {
        "start_idx": start_idx,
        "end_idx": end_idx,
        "pattern_bars": pattern_bars,
        "pattern_count": bar_count,
        "pattern_low": pattern_low,
        "pattern_high": pattern_high,
        "upper_line": upper_line,
        "lower_line": lower_line,
        "upper_slope": upper_slope,
        "lower_slope": lower_slope,
        "upper_at_start": upper_at_start,
        "upper_at_end": upper_at_end,
        "lower_at_start": lower_at_start,
        "lower_at_end": lower_at_end,
        "width_start": width_start,
        "width_end": width_end,
        "avg_width": avg_width,
        "mid_price": mid_price,
        "depth_pct": depth_pct,
        "parallel_score": parallel_score,
        "upper_touches": upper_line["touches"],
        "lower_touches": lower_line["touches"],
        "direction": direction,
        "channel_type": channel_type,
    }


def _score_geometry(c: dict) -> float:
    # Parallelism: 100 at 1.0, 0 at the threshold.
    parallel = max(0.0, (c["parallel_score"] - _MIN_PARALLEL_SCORE)
                    / max(1.0 - _MIN_PARALLEL_SCORE, 1e-6)) * 100.0
    parallel = min(100.0, parallel)
    # Touch quality
    touch_score = (min(100.0, c["upper_touches"] * 25.0)
                   + min(100.0, c["lower_touches"] * 25.0)) / 2.0
    # Depth ideality - peaks around 10-15%
    depth = c["depth_pct"]
    if 0.08 <= depth <= 0.18:
        depth_score = 100.0
    elif depth < 0.08:
        depth_score = max(0.0, 50.0 + (depth - _MIN_DEPTH_PCT) * 1500.0)
    else:
        depth_score = max(0.0, 100.0 - (depth - 0.18) * 700.0)
    # Duration: ideal ~45-55 bars
    duration_score = max(0.0, 100.0 - abs(c["pattern_count"] - 50) * 2.5)
    # Line fit quality (r_squared on each line)
    rsq_score = (c["upper_line"].get("r_squared", 0.0)
                 + c["lower_line"].get("r_squared", 0.0)) / 2.0 * 100.0
    return round(0.30 * parallel + 0.20 * touch_score + 0.20 * depth_score
                 + 0.15 * duration_score + 0.15 * rsq_score, 2)


def _score_volume(bars: List[Bar], c: dict) -> float:
    pattern = c["pattern_bars"]
    if len(pattern) < 4:
        return 50.0
    half = len(pattern) // 2
    first_avg = sum(b["v"] for b in pattern[:half]) / max(half, 1)
    second_avg = sum(b["v"] for b in pattern[half:]) / max(len(pattern) - half, 1)
    if first_avg <= 0:
        return 50.0
    ratio = second_avg / first_avg
    # Channels are tolerant on volume — flat-to-contracting is acceptable.
    if ratio <= 0.7:
        return 100.0
    if ratio >= 1.4:
        return 25.0
    if ratio <= 1.0:
        return round(50.0 + (1.0 - ratio) / 0.3 * 50.0, 2)
    return round(50.0 - (ratio - 1.0) / 0.4 * 25.0, 2)


def _score_context(context: dict, direction: str) -> float:
    score = 50.0
    if direction == "bullish":
        if context.get("trend_stage") == 2:
            score += 25
        elif context.get("trend_stage") == 1:
            score += 12
        if context.get("ma_alignment") == "stacked_bullish":
            score += 15
        if context.get("rs_trend") == "up":
            score += 10
    elif direction == "bearish":
        if context.get("trend_stage") == 4:
            score += 25
        elif context.get("trend_stage") == 3:
            score += 12
        if context.get("ma_alignment") == "stacked_bearish":
            score += 15
        if context.get("rs_trend") == "down":
            score += 10
    else:
        # neutral / horizontal: modest credit for any defined stage
        if context.get("trend_stage") in (1, 2, 3, 4):
            score += 12
    # DCR integration (Phase 7.5) — direction-aware boost
    score += _dcr_score_adjustment(context, direction)
    return min(100.0, max(0.0, score))


def _dcr_score_adjustment(context: dict, direction: str) -> float:
    """Return the DCR-derived score adjustment for the given channel direction.

    Horizontal/neutral channels get no DCR adjustment (the breakout direction is undefined).
    """
    dcr_sig = context.get("dcr_signature")
    recent_dcr = context.get("recent_dcr_avg", 0.5) or 0.5
    if direction == "bullish":
        if dcr_sig == "accumulation" and recent_dcr >= 0.65:
            return 12.0
        if dcr_sig == "distribution":
            return -8.0
    elif direction == "bearish":
        if dcr_sig == "distribution" and recent_dcr <= 0.35:
            return 12.0
        if dcr_sig == "accumulation":
            return -8.0
    return 0.0


def _channel_type_phrase(channel_type: str, direction: str, upper_slope: float,
                         lower_slope: float, mid_price: float) -> str:
    if channel_type == "ascending":
        return (f"ascending channel (bullish trend channel - upper slope "
                f"{upper_slope:.4f}/bar, lower slope {lower_slope:.4f}/bar)")
    if channel_type == "descending":
        return (f"descending channel (bearish trend channel - upper slope "
                f"{upper_slope:.4f}/bar, lower slope {lower_slope:.4f}/bar)")
    return (f"horizontal channel (range-bound trading band - both slopes "
            f"within {_HORIZONTAL_SLOPE_FRACTION:.4f} of mid-price "
            f"${mid_price:.2f})")


# Custom variant - does not match shared narrative_helpers
def _ma_alignment_phrase(context: dict, direction: str) -> str:
    align = context.get("ma_alignment", "mixed")
    if align == "stacked_bullish":
        if direction == "bullish":
            return "fully stacked-bullish moving-average alignment (textbook ascending-channel trend backdrop)"
        return "stacked-bullish moving-average (counter-trend warning for this channel direction)"
    if align == "stacked_bearish":
        if direction == "bearish":
            return "stacked-bearish moving-average alignment (textbook descending-channel trend backdrop)"
        return "stacked-bearish moving-average (counter-trend warning for this channel direction)"
    return "mixed moving-average"


# Custom variant - does not match shared narrative_helpers
def _trend_stage_description(context: dict, direction: str) -> str:
    stage = context.get("trend_stage", 0)
    if direction == "bullish":
        if stage == 2:
            return "a confirmed Stage 2 uptrend (textbook ascending-channel environment)"
        if stage == 1:
            return "a Stage 1 base/accumulation environment (ascending channel as breakout structure)"
        if stage == 3:
            return "a Stage 3 distribution environment (caution - ascending channel may be late-cycle)"
        if stage == 4:
            return "a Stage 4 downtrend (counter-trend ascending channel - lower-odds setup)"
    elif direction == "bearish":
        if stage == 4:
            return "a confirmed Stage 4 downtrend (textbook descending-channel environment)"
        if stage == 3:
            return "a Stage 3 distribution environment (descending channel as topping structure)"
        if stage == 2:
            return "a Stage 2 uptrend (counter-trend descending channel - watch for trend resumption)"
        if stage == 1:
            return "a Stage 1 base environment (counter-trend caution)"
    else:
        if stage in (1, 2, 3, 4):
            return f"a Stage {stage} environment (horizontal channel - range-trade until break)"
    return "an undefined trend stage"


# Custom variant - does not match shared narrative_helpers
def _rs_trend_phrase(context: dict) -> str:
    rs = context.get("rs_trend", "flat")
    if rs == "up":
        return "improving"
    if rs == "down":
        return "deteriorating"
    return "neutral"


# Custom variant - does not match shared narrative_helpers
def _dcr_phrase(context: dict) -> str:
    sig = context.get("dcr_signature", "neutral")
    avg = context.get("recent_dcr_avg", 0.5)
    if sig == "accumulation":
        return f"accumulation-signature daily close ratio (recent avg {avg:.2f} - closes near highs)"
    if sig == "distribution":
        return f"distribution-signature daily close ratio (recent avg {avg:.2f} - closes near lows)"
    return f"neutral daily close ratio (avg {avg:.2f})"


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    end_idx = c["end_idx"]
    start_idx = c["start_idx"]

    upper_now = c["upper_at_end"]
    lower_now = c["lower_at_end"]
    upper_start = c["upper_at_start"]
    lower_start = c["lower_at_start"]
    direction = c["direction"]
    channel_type = c["channel_type"]
    avg_width = c["avg_width"]
    mid_price = c["mid_price"]
    pattern_count = c["pattern_count"]
    upper_slope = c["upper_slope"]
    lower_slope = c["lower_slope"]
    parallel_score = c["parallel_score"]

    # Project upper line +10 bars ahead for target reference
    upper_proj_idx = end_idx + 10
    lower_proj_idx = end_idx + 10
    upper_proj = line_at((c["upper_line"]["p1"], c["upper_line"]["p2"]), upper_proj_idx)
    lower_proj = line_at((c["lower_line"]["p1"], c["lower_line"]["p2"]), lower_proj_idx)

    # Levels per direction
    if direction == "bullish":
        # Continuation: buy pullbacks to LOWER, target the upper projection +10 bars
        entry = round(lower_now * 1.002, 2)
        stop = round(lower_now * 0.985, 2)
        target = round(upper_proj, 2)
        rr = (target - entry) / (entry - stop) if entry > stop else 0.0
        entry_condition = (
            f"long pullback to lower line ~${lower_now:.2f} on volume "
            f">= 0.8x 20-bar avg (channel-bottom buy)"
        )
        stop_basis = "lower_channel_minus_1.5pct"
        stop_distance_pct = (entry - stop) / entry * 100 if entry > 0 else 0.0
    elif direction == "bearish":
        # Continuation: short rallies to UPPER, target the lower projection +10 bars
        entry = round(upper_now * 0.998, 2)
        stop = round(upper_now * 1.015, 2)
        target = round(lower_proj, 2)
        rr = (entry - target) / (stop - entry) if stop > entry else 0.0
        entry_condition = (
            f"short rally to upper line ~${upper_now:.2f} on volume "
            f">= 0.8x 20-bar avg (channel-top short)"
        )
        stop_basis = "upper_channel_plus_1.5pct"
        stop_distance_pct = (stop - entry) / entry * 100 if entry > 0 else 0.0
    else:
        # Horizontal: emit with breakout-direction undetermined.
        # Conservative entry = mid-channel, structural breakout above upper.
        entry = round(upper_now * 1.001, 2)
        stop = round(lower_now * 0.985, 2)
        target = round(upper_now + avg_width, 2)
        rr = (target - entry) / (entry - stop) if entry > stop else 0.0
        entry_condition = (
            f"close > {entry:.2f} on volume > 1.5x 20-bar avg (range "
            f"breakout - direction undetermined until break)"
        )
        stop_basis = "lower_channel_minus_1.5pct"
        stop_distance_pct = (entry - stop) / entry * 100 if entry > 0 else 0.0

    # Volume context
    pattern = c["pattern_bars"]
    half = len(pattern) // 2
    if half > 0 and sum(b["v"] for b in pattern[:half]) > 0:
        vol_ratio = (sum(b["v"] for b in pattern[half:]) / max(len(pattern) - half, 1)) \
                    / (sum(b["v"] for b in pattern[:half]) / half)
    else:
        vol_ratio = 1.0
    vol_pct = vol_ratio * 100.0

    depth_pct_pct = c["depth_pct"] * 100.0
    parallel_pct = parallel_score * 100.0
    upper_touches = c["upper_touches"]
    lower_touches = c["lower_touches"]
    upper_r2 = c["upper_line"].get("r_squared", 0.0)
    lower_r2 = c["lower_line"].get("r_squared", 0.0)

    channel_phrase = _channel_type_phrase(channel_type, direction, upper_slope,
                                          lower_slope, mid_price)
    ma_phrase = _ma_alignment_phrase(context, direction)
    stage_phrase = _trend_stage_description(context, direction)
    rs_phrase = _rs_trend_phrase(context)
    dcr_phrase = _dcr_phrase(context)
    regime = context.get("regime", "current")
    vol_signature = context.get("volume_signature", "unspecified")

    sym_token = "the stock"
    direction_label = {
        "bullish": "Ascending Channel",
        "bearish": "Descending Channel",
        "neutral": "Horizontal Channel",
    }.get(direction, "Channel")

    headline = (
        f"{direction_label} forming on {sym_token} - upper line at "
        f"${upper_now:.2f} ({upper_touches} touches, r2 {upper_r2:.2f}), "
        f"lower line at ${lower_now:.2f} ({lower_touches} touches, r2 "
        f"{lower_r2:.2f}), parallel score {parallel_pct:.0f}%, "
        f"{depth_pct_pct:.1f}% channel width over {pattern_count} bars. "
        f"Pivot ${entry:.2f}, target ${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"A Channel is two parallel trendlines bounding a sustained run of "
        f"price action - the simplest and most enduring expression of trend "
        f"in classical charting. The concept was formalized by Richard "
        f"Donchian in 1934 (whose Donchian channels became the foundation of "
        f"the Turtle trader system) and was incorporated into Edwards & "
        f"Magee's 'Technical Analysis of Stock Trends' (1948) as 'Trend "
        f"Channels.' Andrew Cardwell and Constance Brown have refined modern "
        f"application of channels for swing-trading. This is a "
        f"{channel_phrase}, anchored by {upper_touches} swing-high touches on "
        f"the upper line (r-squared {upper_r2:.2f}) and {lower_touches} "
        f"swing-low touches on the lower line (r-squared {lower_r2:.2f}). The "
        f"two lines preserve their separation with a parallelism score of "
        f"{parallel_pct:.0f}% - width at start of pattern was "
        f"${c['width_start']:.2f}, width at end is ${c['width_end']:.2f}, and "
        f"the average channel depth is {depth_pct_pct:.1f}% of the "
        f"${mid_price:.2f} mid-price. The pattern spans {pattern_count} bars, "
        f"and the upper line currently sits at ${upper_now:.2f} versus a "
        f"lower line at ${lower_now:.2f}. The market mechanic underneath is a "
        f"durable supply-demand equilibrium with one side incrementally "
        f"winning: an ascending channel reflects buyers stepping up at "
        f"progressively higher levels while sellers cap each rally at "
        f"progressively higher resistance; a descending channel is the "
        f"mirror; a horizontal channel reflects two distinct levels of "
        f"institutional inventory - one defending the floor, one defending "
        f"the ceiling - until one side exhausts. Channels are tradeable in "
        f"three ways: (1) trend-following entries on pullbacks to the "
        f"trend-side boundary, (2) counter-trend reversion to the opposite "
        f"boundary as a profit-taking zone, and (3) breakout trades when the "
        f"channel finally fails. Nicolas Darvas's Box Theory — built during "
        f"his 1950s record-setting run trading from telegrams while touring "
        f"as a dancer — treats price channels as a stack of 'boxes' a stock "
        f"climbs through, with the buy trigger being the break of the current "
        f"box's upper boundary on volume and the stop being the break of the "
        f"box's lower boundary; this turns the channel from a passive "
        f"description into a mechanical pyramid-up trading system that modern "
        f"trend-followers have quietly re-adopted."
    )

    why_it_matters = (
        f"This channel is forming in {stage_phrase} with {ma_phrase} "
        f"alignment, {rs_phrase} relative strength versus the broader market, "
        f"and a {dcr_phrase}. The {regime} regime sets the macro backdrop "
        f"and the volume signature reads {vol_signature} (second-half volume "
        f"at {vol_pct:.0f}% of first-half average). A "
        f"{parallel_pct:.0f}% parallelism score is the structural validation "
        f"that matters most: a channel that preserves width across its "
        f"duration is a real behavioural pattern (two distinct order-flow "
        f"programs operating at the same separation), while a channel that "
        f"narrows or widens is on its way to becoming a wedge or megaphone "
        f"and signals an emerging regime shift. The {upper_touches}-touch "
        f"upper line and {lower_touches}-touch lower line are both well past "
        f"the minimum 3-touch validation threshold - each touch is a "
        f"separate auction where institutional inventory was deployed at the "
        f"same price (modulated by slope), and repeated success at the same "
        f"levels is the chart language of repeatable behaviour. The "
        f"{depth_pct_pct:.1f}% channel width sits in a tradable zone: too-"
        f"narrow channels (under 5%) get destroyed by noise on any single "
        f"news bar, while too-wide channels (over 25%) take so long to "
        f"traverse that the trader's edge over a buy-and-hold approach "
        f"disappears. Ascending channels in Stage 2 uptrends with rising RS "
        f"and stacked-bullish MA alignment are the highest-conviction "
        f"trend-following long environment in classical technical analysis; "
        f"descending channels in Stage 4 downtrends with falling RS and "
        f"stacked-bearish MA are the symmetric short setup. Horizontal "
        f"channels are direction-agnostic and are traded as range-bound "
        f"setups until one boundary fails."
    )

    if direction == "bullish":
        what_to_watch_for = (
            f"The primary trade is a long entry on a pullback to the lower "
            f"line at ${lower_now:.2f} - the channel has held {lower_touches} "
            f"prior swing-low touches at this level so it is a high-"
            f"reliability buy zone. Look for a rejection candle (lower wick, "
            f"close in upper third of range) within 0.5-1% of ${lower_now:.2f} "
            f"with volume at least 0.8x the 20-bar average, ideally with the "
            f"prior 1-2 bars showing the typical 'controlled pullback' "
            f"signature of declining volume. Entry trigger: long on close "
            f"above the rejection-bar high, with a small confirmation buffer "
            f"placed at ${entry:.2f}. Initial stop is ${stop:.2f} (1.5% below "
            f"the lower line), a {stop_distance_pct:.1f}% risk distance - "
            f"risking 1% of account implies a position size of roughly "
            f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
            f"of equity. First profit target is the upper line projected "
            f"+10 bars ahead at ${target:.2f} - a measured-channel-traverse "
            f"target of ${avg_width:.2f} (average channel width) above entry "
            f"on a normal channel rotation. Scale out partial size into the "
            f"upper line and let the runner ride if the channel extends. "
            f"Trail stops below each successive swing low or below the lower "
            f"line as the trade matures. Alternative interpretation: short "
            f"the upper line at ${upper_now:.2f} as a counter-trend mean-"
            f"reversion trade, target the lower line at ${lower_now:.2f}, "
            f"stop just above the upper line - this works in well-established "
            f"channels but carries trend-fighting risk; size smaller. Watch "
            f"for a clean breakout above the upper line on volume > 1.5x "
            f"20-bar average - that signals trend acceleration and the "
            f"channel may be widening into a new higher channel, justifying "
            f"a separate breakout-trade entry."
        )
    elif direction == "bearish":
        what_to_watch_for = (
            f"The primary trade is a short entry on a rally to the upper line "
            f"at ${upper_now:.2f} - the channel has held {upper_touches} "
            f"prior swing-high touches at this level so it is a high-"
            f"reliability short zone. Look for a rejection candle (upper "
            f"wick, close in lower third of range) within 0.5-1% of "
            f"${upper_now:.2f} with volume at least 0.8x the 20-bar average. "
            f"Entry trigger: short on close below the rejection-bar low, "
            f"with a small confirmation buffer placed at ${entry:.2f}. "
            f"Initial stop is ${stop:.2f} (1.5% above the upper line), a "
            f"{stop_distance_pct:.1f}% risk distance - risking 1% of account "
            f"implies a position size of roughly "
            f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
            f"of equity. First profit target is the lower line projected "
            f"+10 bars ahead at ${target:.2f} - a measured-channel-traverse "
            f"target of ${avg_width:.2f} (average channel width) below entry. "
            f"Cover partial size into the lower line and let the runner "
            f"continue if the channel extends. Trail stops above each new "
            f"swing high or above the upper line as the trade matures. "
            f"Alternative interpretation: long the lower line at "
            f"${lower_now:.2f} as a counter-trend mean-reversion trade - "
            f"size smaller because this fights the prevailing trend. Watch "
            f"for a clean breakdown below the lower line on volume > 1.5x "
            f"20-bar average - that signals trend acceleration and the "
            f"channel may be widening into a new lower channel, justifying "
            f"a separate breakdown-trade entry. Short trades require borrow "
            f"availability and carry overnight gap risk."
        )
    else:
        what_to_watch_for = (
            f"This is a horizontal channel - a range-bound trading band - so "
            f"the direction of resolution is not yet determined. Two trade "
            f"approaches are valid. (1) Range-trade: long the lower line at "
            f"${lower_now:.2f} with stop ${lower_now * 0.985:.2f} target "
            f"${upper_now:.2f}; short the upper line at ${upper_now:.2f} with "
            f"stop ${upper_now * 1.015:.2f} target ${lower_now:.2f}. Both "
            f"trades require a rejection-candle confirmation (wick + close "
            f"in opposite third of range) before entering. (2) Breakout-"
            f"wait: stand aside until the channel resolves with a close "
            f"beyond either boundary on volume > 1.5x the 20-bar average. "
            f"The conservative breakout level above the upper line is "
            f"${entry:.2f}; symmetric breakdown level below the lower line "
            f"is ${lower_now * 0.999:.2f}. Measured-move target is "
            f"${target:.2f} (channel width ${avg_width:.2f} projected in "
            f"the breakout direction), with stop at the opposite boundary "
            f"${stop:.2f}. The {stop_distance_pct:.1f}% stop distance "
            f"implies a position size of roughly "
            f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
            f"of equity per 1% account risk. Horizontal channels in "
            f"low-volatility regimes typically resolve in the direction of "
            f"the prior larger trend - check the 200-bar context for bias. "
            f"Range duration past 60 bars statistically favors a clean "
            f"breakout over a continued range, so longer-duration horizontal "
            f"channels approaching exhaustion deserve breakout sizing rather "
            f"than continued range-trades."
        )

    failure_signal = (
        f"Channel failure modes depend on the direction. For an ascending or "
        f"descending channel, the most dangerous failure is the 'channel "
        f"reverse breakout' - price decisively closes through the trend-side "
        f"boundary (lower in an ascending channel, upper in a descending "
        f"channel) on volume > 1.5x the 20-bar average, marking the end of "
        f"the trend regime and frequently launching a reversal of equal or "
        f"greater magnitude. For this pattern, that failure level is "
        f"${stop:.2f}; closing through it requires immediate exit of any "
        f"trend-following position. The {stop_distance_pct:.1f}% stop "
        f"distance must be honored without negotiation - widening or "
        f"removing a stop on a failing channel trade is one of the most "
        f"reliable ways to convert a manageable loss into account damage "
        f"because the breakdown momentum of a failed channel is "
        f"statistically larger than the channel's own swing magnitude. A "
        f"subtler failure: the channel begins to widen or narrow as new "
        f"swing pivots fall outside the prior boundaries - parallelism "
        f"score declining from {parallel_pct:.0f}% toward 60% or below "
        f"signals the channel is transitioning into a wedge (narrowing) or "
        f"megaphone (widening), both of which carry different trade "
        f"thresholds. A horizontal channel fails when it resolves with a "
        f"close beyond one boundary on weak volume, then 1-3 bars later "
        f"closes back inside the channel - the textbook Wyckoff upthrust "
        f"or spring liquidity grab. False breakouts on light tape resolve "
        f"violently in the OPPOSITE direction roughly 35-45% of the time, "
        f"so confirm volume before entering breakout trades. Channels in "
        f"counter-trend contexts (ascending channel in a Stage 4 market, "
        f"descending channel in Stage 2) carry below-average odds and "
        f"should be sized smaller; mean-reversion trades against the "
        f"larger trend are particularly susceptible to news-driven gap "
        f"failures that exceed channel tolerances entirely."
    )

    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": direction_label,
        "category": "classical",
        "direction": direction,
        "start_t": int(bars[start_idx]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(bars[start_idx]["t"]),
                     int(bars[end_idx]["t"]),
                     int(last_bar["t"])],
        "geometry": {
            "shape": "trendline_pair",
            "anchors": [
                {"t": int(c["upper_line"]["p1"]["t"]), "price": float(c["upper_line"]["p1"]["price"])},
                {"t": int(c["upper_line"]["p2"]["t"]), "price": float(c["upper_line"]["p2"]["price"])},
                {"t": int(c["lower_line"]["p1"]["t"]), "price": float(c["lower_line"]["p1"]["price"])},
                {"t": int(c["lower_line"]["p2"]["t"]), "price": float(c["lower_line"]["p2"]["price"])},
            ],
            "extras": {
                "pattern_bars": c["pattern_count"],
                "channel_type": channel_type,
                "upper_slope": round(float(upper_slope), 6),
                "lower_slope": round(float(lower_slope), 6),
                "r_squared_upper": round(float(upper_r2), 3),
                "r_squared_lower": round(float(lower_r2), 3),
                "touches_upper": int(upper_touches),
                "touches_lower": int(lower_touches),
                "parallel_score": round(float(parallel_score), 3),
                "depth_pct": round(float(c["depth_pct"]) * 100, 2),
                "avg_width": round(float(avg_width), 2),
                "mid_price": round(float(mid_price), 2),
                "dcr_score_adj": round(_dcr_score_adjustment(context, direction), 2),
            },
        },
        "levels": {
            "entry": entry,
            "entry_condition": entry_condition,
            "stop": stop,
            "stop_basis": stop_basis,
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


register(_PATTERN_ID, detect_channel)
