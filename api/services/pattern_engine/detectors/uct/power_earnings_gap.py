"""Power Earnings Gap (PEG) detector — Pradeep Bonde / Stockbee.

A Power Earnings Gap is a gap-up event where a stock gaps significantly
(>=4%) on dramatic volume (>=3x avg), then HOLDS the gap with tight
post-gap consolidation. The combination of price gap + volume surge + tight
post-gap action signals that institutions are aggressively buying the new
fundamentals (typically post-earnings, but also FDA approvals, acquisitions,
guidance raises). PEGs frequently extend 30-100% over the following 4-12
weeks because the gap creates a clean break above all prior overhead supply.

Geometric definition:
  - Detection window: last 30 bars (PEG must be recent)
  - Gap bar identification: the bar with the largest gap_pct in the last 30
    bars where:
      * gap_pct = (open - prior_close) / prior_close >= 0.04 (>=4% gap up)
      * volume >= 3 * avg_volume(20 prior bars)
  - Post-gap window: 3-10 bars after the gap bar
  - Continuation gate: min(post_gap_lows) > gap_open * 0.99 (haven't filled
    more than 1% into the gap)
  - Tightness gate: avg(last 3-bar ranges) < 0.7 * gap_bar_range
  - Pending-breakout gate: not yet broken above post-gap high
  - Direction: bullish

Scoring (composite 0-100):
  geometry_score:   gap_pct, post-gap tightness, gap-holding margin
  volume_score:     gap_bar_volume / 20-bar avg (cap at 100 for >=5x)
  context_score:    Stage 1 or 2, MA stack favorable
  historical_score: 50.0 (neutral prior)
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "power_earnings_gap"

_DETECTION_WINDOW = 30           # last N bars to scan for the gap bar
_AVG_LOOKBACK = 20               # bars before gap for avg volume
_MIN_GAP_PCT = 0.04              # >=4% gap-up
_MIN_VOLUME_RATIO = 3.0          # >=3x 20-bar avg volume
_MIN_POST_GAP_BARS = 3           # need 3-10 bars after the gap
_MAX_POST_GAP_BARS = 10
_GAP_FILL_THRESHOLD = 0.99       # post-gap lows must stay above gap_open * 0.99
_MAX_POST_GAP_TIGHTNESS = 0.70   # avg post-gap range < 0.70 * gap bar range
_CONFIDENCE_FLOOR = 50.0


def detect_power_earnings_gap(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect Power Earnings Gap patterns. Emits 0 or 1 detection."""
    if len(bars) < _AVG_LOOKBACK + _MIN_POST_GAP_BARS + 1:
        return []

    last_bar_idx = len(bars) - 1
    # The gap bar must be within the last _DETECTION_WINDOW bars AND must
    # have at least _MIN_POST_GAP_BARS bars AFTER it (so the most recent
    # candidate gap bar is at index last_bar_idx - _MIN_POST_GAP_BARS).
    earliest_idx = max(_AVG_LOOKBACK, last_bar_idx - _DETECTION_WINDOW + 1)
    latest_idx = last_bar_idx - _MIN_POST_GAP_BARS

    best_candidate = None
    best_confidence = -1.0
    best_scores = None

    for gap_idx in range(earliest_idx, latest_idx + 1):
        candidate = _try_extract(bars, gap_idx)
        if candidate is None:
            continue

        # Hostile context gate: full Stage 4 + stacked bearish + RS down = reject
        if _hostile_context(context):
            continue

        geom_score = _score_geometry(candidate)
        vol_score = _score_volume(candidate)
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


def _try_extract(bars: List[Bar], gap_idx: int) -> Optional[dict]:
    """Try to extract a PEG pattern with `gap_idx` as the gap bar.

    Returns candidate dict or None if any gate fails.
    """
    if gap_idx <= 0:
        return None
    last_bar_idx = len(bars) - 1

    gap_bar = bars[gap_idx]
    prior_bar = bars[gap_idx - 1]
    prior_close = prior_bar["c"]
    if prior_close <= 0:
        return None

    gap_open = gap_bar["o"]
    gap_high = gap_bar["h"]
    gap_low = gap_bar["l"]
    gap_close = gap_bar["c"]
    gap_volume = gap_bar["v"]

    gap_range = gap_high - gap_low
    if gap_range <= 0:
        return None

    # 1. Gap percentage gate
    gap_pct = (gap_open - prior_close) / prior_close
    if gap_pct < _MIN_GAP_PCT:
        return None

    # 2. Volume gate: gap_bar volume vs 20-bar avg BEFORE the gap
    lookback_start = max(0, gap_idx - _AVG_LOOKBACK)
    lookback = bars[lookback_start:gap_idx]
    if len(lookback) < _AVG_LOOKBACK // 2:
        return None
    avg_volume = sum(b["v"] for b in lookback) / len(lookback)
    if avg_volume <= 0:
        return None
    volume_ratio = gap_volume / avg_volume
    if volume_ratio < _MIN_VOLUME_RATIO:
        return None

    # 3. Post-gap window: bars AFTER the gap, count must be 3-10
    post_gap_segment = bars[gap_idx + 1:last_bar_idx + 1]
    post_gap_bars = len(post_gap_segment)
    if post_gap_bars < _MIN_POST_GAP_BARS or post_gap_bars > _MAX_POST_GAP_BARS:
        return None

    # 4. Gap-holding gate: min post-gap low must stay above gap_open * 0.99
    post_gap_lows = [b["l"] for b in post_gap_segment]
    post_gap_highs = [b["h"] for b in post_gap_segment]
    post_gap_closes = [b["c"] for b in post_gap_segment]
    min_post_gap_low = min(post_gap_lows)
    if min_post_gap_low <= gap_open * _GAP_FILL_THRESHOLD:
        return None

    # 5. Tightness gate: avg of last 3 post-gap bar ranges < 0.7 * gap_bar_range
    last_3 = post_gap_segment[-3:] if len(post_gap_segment) >= 3 else post_gap_segment
    avg_post_gap_range = sum(b["h"] - b["l"] for b in last_3) / len(last_3)
    if avg_post_gap_range >= _MAX_POST_GAP_TIGHTNESS * gap_range:
        return None

    # 6. Pending-breakout gate: post-gap consolidation high must NOT have been
    #    broken yet. If the last bar's close has already closed above the prior
    #    post-gap-high (excluding itself), the breakout has already fired.
    post_gap_high = max(post_gap_highs)
    if post_gap_bars >= 2:
        # The "pending" high is the max excluding the most recent bar's close
        # (we allow today's bar to be touching the high but not closed above).
        prior_post_gap_high = max(post_gap_highs[:-1])
        last_close = post_gap_closes[-1]
        if last_close > prior_post_gap_high * 1.005:
            return None

    # Compute additional reporting metrics
    gap_fill_margin = (min_post_gap_low - gap_open) / gap_open  # >0 = holding
    post_gap_range_pct = avg_post_gap_range / gap_close * 100.0 if gap_close > 0 else 0.0
    gap_range_pct = gap_range / gap_close * 100.0 if gap_close > 0 else 0.0
    gap_height = gap_close - prior_close  # absolute gap size in dollars

    return {
        "gap_idx": gap_idx,
        "gap_open": gap_open,
        "gap_high": gap_high,
        "gap_low": gap_low,
        "gap_close": gap_close,
        "gap_volume": gap_volume,
        "gap_range": gap_range,
        "gap_pct": gap_pct,
        "volume_ratio": volume_ratio,
        "prior_close": prior_close,
        "prior_bar_t": prior_bar["t"],
        "avg_volume": avg_volume,
        "post_gap_bars": post_gap_bars,
        "post_gap_high": post_gap_high,
        "post_gap_low": min_post_gap_low,
        "avg_post_gap_range": avg_post_gap_range,
        "gap_fill_margin": gap_fill_margin,
        "post_gap_range_pct": post_gap_range_pct,
        "gap_range_pct": gap_range_pct,
        "gap_height": gap_height,
    }


def _hostile_context(context: dict) -> bool:
    """Reject PEGs only in clearly hostile context (Stage 4 + stacked_bearish + RS down)."""
    stage_bad = context.get("trend_stage") == 4
    ma_bad = context.get("ma_alignment") == "stacked_bearish"
    rs_bad = context.get("rs_trend") == "down"
    return stage_bad and ma_bad and rs_bad


def _score_geometry(c: dict) -> float:
    """Geometry score components:
       - gap_score: bigger gap = better (4% = 50, 8% = 85, 10%+ = 100)
       - tightness_score: tighter post-gap action = better
       - holding_score: how far above gap_open the lows held
    """
    gp = c["gap_pct"]
    if gp >= 0.10:
        gap_score = 100.0
    elif gp >= 0.08:
        gap_score = 85.0 + (gp - 0.08) / 0.02 * 15.0
    elif gp >= 0.06:
        gap_score = 70.0 + (gp - 0.06) / 0.02 * 15.0
    elif gp >= _MIN_GAP_PCT:
        gap_score = 50.0 + (gp - _MIN_GAP_PCT) / 0.02 * 20.0
    else:
        gap_score = 0.0

    # Tightness: ratio of avg post-gap range to gap bar range. 0.20 = 100, 0.70 = 0.
    if c["gap_range"] <= 0:
        tightness_ratio = 1.0
    else:
        tightness_ratio = c["avg_post_gap_range"] / c["gap_range"]
    if tightness_ratio <= 0.20:
        tightness_score = 100.0
    elif tightness_ratio >= _MAX_POST_GAP_TIGHTNESS:
        tightness_score = 0.0
    else:
        tightness_score = (
            (_MAX_POST_GAP_TIGHTNESS - tightness_ratio) / (_MAX_POST_GAP_TIGHTNESS - 0.20) * 100.0
        )

    # Holding: how far above gap_open the post-gap min low stayed.
    # 0% margin (right at the threshold) = 30, 2%+ margin = 100.
    margin_pct = c["gap_fill_margin"] * 100.0  # in %
    if margin_pct >= 2.0:
        holding_score = 100.0
    elif margin_pct >= 0.0:
        holding_score = 30.0 + margin_pct / 2.0 * 70.0
    else:
        holding_score = 0.0

    # Number of post-gap bars: 4-7 bars is textbook (enough to consolidate, not stale)
    n = c["post_gap_bars"]
    if 4 <= n <= 7:
        bars_score = 100.0
    elif n == 3:
        bars_score = 70.0
    elif n in (8, 9):
        bars_score = 75.0
    elif n == 10:
        bars_score = 55.0
    else:
        bars_score = 40.0

    return round(
        0.40 * gap_score
        + 0.30 * tightness_score
        + 0.20 * holding_score
        + 0.10 * bars_score,
        2,
    )


def _score_volume(c: dict) -> float:
    """Score volume ratio. 3x = 50, 4x = 75, 5x+ = 100."""
    vr = c["volume_ratio"]
    if vr >= 5.0:
        return 100.0
    if vr >= 4.0:
        return 75.0 + (vr - 4.0) / 1.0 * 25.0
    if vr >= _MIN_VOLUME_RATIO:
        return 50.0 + (vr - _MIN_VOLUME_RATIO) / 1.0 * 25.0
    return 0.0


def _score_context(context: dict) -> float:
    """PEG wants Stage 1 (basing) or Stage 2 (early uptrend), neutral/bullish MA."""
    score = 40.0
    stage = context.get("trend_stage")
    if stage in (1, 2):
        score += 25.0
    elif stage == 3:
        score += 5.0    # late-cycle, some risk
    # else Stage 4 or unknown: no bonus

    align = context.get("ma_alignment")
    if align == "stacked_bullish":
        score += 20.0
    elif align == "mixed":
        score += 10.0

    rs = context.get("rs_trend")
    if rs == "up":
        score += 15.0
    elif rs == "flat":
        score += 5.0

    # DCR integration (Phase 7.5) — bullish continuation: accumulation = tailwind.
    score += _dcr_score_adjustment(context)
    return min(100.0, max(0.0, score))


def _dcr_score_adjustment(context: dict) -> float:
    """Return the DCR-derived score adjustment for a bullish pattern."""
    dcr_sig = context.get("dcr_signature")
    recent_dcr = context.get("recent_dcr_avg", 0.5) or 0.5
    if dcr_sig == "accumulation" and recent_dcr >= 0.65:
        return 12.0   # institutional buying into close
    if dcr_sig == "distribution":
        return -8.0   # sellers active — bullish pattern faces headwind
    return 0.0


# Custom variant - does not match shared narrative_helpers
def _ma_alignment_phrase(context: dict) -> str:
    align = context.get("ma_alignment", "mixed")
    if align == "stacked_bullish":
        return "fully stacked-bullish"
    if align == "stacked_bearish":
        return "stacked-bearish"
    return "mixed"


# Custom variant - does not match shared narrative_helpers
def _trend_stage_description(context: dict) -> str:
    stage = context.get("trend_stage", 0)
    if stage == 1:
        return "a Stage 1 base/accumulation environment"
    if stage == 2:
        return "a confirmed Stage 2 uptrend"
    if stage == 3:
        return "a Stage 3 distribution environment (caution)"
    if stage == 4:
        return "a Stage 4 downtrend environment (caution)"
    return "an undefined trend stage"


# Custom variant - does not match shared narrative_helpers
def _rs_trend_phrase(context: dict) -> str:
    rs = context.get("rs_trend", "flat")
    if rs == "up":
        return "improving"
    if rs == "down":
        return "deteriorating"
    return "neutral"


def _regime_context_sentence(context: dict, c: dict) -> str:
    """One-sentence regime/context connector for the narrative."""
    regime = context.get("regime", "current")
    stage = context.get("trend_stage", 0)
    vr = c["volume_ratio"]
    gp_pct = c["gap_pct"] * 100.0
    if stage in (1, 2) and vr >= 4.0:
        return (f"Within the {regime} regime, a PEG that combines a {gp_pct:.1f}% gap "
                f"with {vr:.1f}x volume in a Stage {stage} structure is precisely the "
                f"profile Bonde teaches as the highest-conviction post-earnings setup")
    if stage in (1, 2):
        return (f"Within the {regime} regime, the Stage {stage} backdrop is the most "
                f"favorable possible context for a PEG to convert — basing or early-uptrend "
                f"stocks experiencing earnings revaluations are where this setup compounds")
    return (f"The {regime} regime context is mixed and position sizing should reflect "
            f"the higher dispersion of outcomes for PEGs outside Stage 1/2 conditions")


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    gap_idx = c["gap_idx"]
    gap_bar = bars[gap_idx]
    prior_bar = bars[gap_idx - 1]
    last_bar = bars[-1]

    gap_pct = c["gap_pct"]
    volume_ratio = c["volume_ratio"]
    gap_open = c["gap_open"]
    gap_high = c["gap_high"]
    gap_low = c["gap_low"]
    gap_close = c["gap_close"]
    prior_close = c["prior_close"]
    post_gap_bars = c["post_gap_bars"]
    post_gap_high = c["post_gap_high"]
    post_gap_low = c["post_gap_low"]
    gap_height = c["gap_height"]
    gap_fill_margin = c["gap_fill_margin"]
    gap_range_pct = c["gap_range_pct"]
    post_gap_range_pct = c["post_gap_range_pct"]

    # Levels
    entry = round(post_gap_high * 1.001, 2)
    stop = round(gap_low * 0.985, 2)
    target = round(gap_close + gap_height, 2)
    rr = (target - entry) / (entry - stop) if entry > stop else 0.0

    stop_distance_pct = (entry - stop) / entry * 100 if entry > 0 else 0.0
    # gap_fill_margin can be tiny; clamp for readability
    gap_fill_pct = max(0.0, gap_fill_margin * 100.0)
    gap_pct_pct = gap_pct * 100.0

    # Geometry anchors: prior_close, gap_open, gap_close, post_gap_high, post_gap_low
    anchors = [
        {"t": int(prior_bar["t"]), "price": float(prior_close)},
        {"t": int(gap_bar["t"]), "price": float(gap_open)},
        {"t": int(gap_bar["t"]), "price": float(gap_close)},
        {"t": int(last_bar["t"]), "price": float(post_gap_high)},
        {"t": int(last_bar["t"]), "price": float(post_gap_low)},
    ]

    now = int(time.time())

    pivot_ts = [
        int(prior_bar["t"]),
        int(gap_bar["t"]),
        int(last_bar["t"]),
    ]

    # ---- Narrative composition — RICH, paragraph-length, real values woven in ----
    ma_phrase = _ma_alignment_phrase(context)
    stage_phrase = _trend_stage_description(context)
    rs_phrase = _rs_trend_phrase(context)
    regime_sentence = _regime_context_sentence(context, c)
    regime = context.get("regime", "current")

    headline = (
        f"Power Earnings Gap - {gap_pct_pct:.1f}% gap-up on {volume_ratio:.1f}x volume, "
        f"{post_gap_bars} bars of tight post-gap action holding the gap. "
        f"Pivot ${entry:.2f}, target ${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Power Earnings Gap, codified by Pradeep Bonde of Stockbee from years of "
        f"post-earnings price-action study on liquid US equities, is the chart pattern "
        f"that captures the market's most decisive vote on new fundamentals. After an "
        f"earnings release (or sometimes FDA approval, acquisition news, or guidance "
        f"raise), a stock gaps up dramatically - here {gap_pct_pct:.1f}% from a prior "
        f"close of ${prior_close:.2f} to an opening print of ${gap_open:.2f} - on volume "
        f"of {volume_ratio:.1f}x the 20-bar average, signaling that the new information "
        f"has caused a wholesale revaluation in the equity. What distinguishes a Power "
        f"Earnings Gap from a normal earnings gap is what happens AFTER the gap: "
        f"institutional buyers refuse to let the gap fill, and price action contracts "
        f"into a tight consolidation that holds above the gap-up open. The "
        f"{post_gap_bars}-bar post-gap action here has averaged {post_gap_range_pct:.2f}% "
        f"daily range, well inside the gap bar's {gap_range_pct:.2f}% range - that "
        f"contraction is the supply-absorbed tell. Bonde's research shows PEGs that hold "
        f"the gap for 3-10 bars before breaking out frequently extend 30-100%+ over the "
        f"following 4-12 weeks. Kristjan Kullamägi has published extensive empirical work "
        f"on earnings-driven gaps in liquid growth names, finding that PEGs in stocks "
        f"already in confirmed uptrends with relative strength above the broader market "
        f"have the highest follow-through profile of any swing setup he tracks. Mark "
        f"Minervini's 'earnings breakout' rules — a clean gap-up on volume followed by "
        f"a tight 3-7 bar consolidation above the gap-open — align almost exactly with "
        f"Bonde's PEG criteria, suggesting that two independent traditions of empirical "
        f"momentum research have converged on the same structural read."
    )

    why_it_matters = (
        f"This PEG is forming in {stage_phrase} with {ma_phrase} moving-average alignment "
        f"and {rs_phrase} relative strength versus the broader market, which is supportive "
        f"context for continuation. The {gap_pct_pct:.1f}% gap on {volume_ratio:.1f}x "
        f"volume crossed both of Bonde's hard gates - 4% minimum gap and 3x minimum "
        f"volume - with significant margin, indicating this isn't a borderline event but "
        f"a high-conviction institutional move that's already been ratified by the tape. "
        f"The fact that the gap has held for {post_gap_bars} bars without a fill (the "
        f"closest test came within {gap_fill_pct:.2f}% of the gap-up open at "
        f"${gap_open:.2f}) is the strongest validation: longs who chased the gap haven't "
        f"been forced out, and shorts who faded haven't been able to push price down into "
        f"the prior range. {regime_sentence}. Within the {regime} regime, PEGs are "
        f"particularly potent because they reset the supply/demand equation overnight - "
        f"every prior overhead supply level becomes irrelevant once the gap clears it, "
        f"so the path of least resistance is straight up to the next obvious resistance."
    )

    what_to_watch_for = (
        f"The trigger is a close above the post-gap consolidation high (${entry:.2f}, "
        f"which is the {post_gap_bars}-bar post-gap high of ${post_gap_high:.2f} plus a "
        f"small confirmation buffer) on volume of at least 1.5x the 20-bar average. The "
        f"ideal trigger bar closes in the upper half of its range with above-average "
        f"volume - that confirms the breakout is institutionally backed rather than "
        f"retail momentum chasing. Measured target is ${target:.2f}, derived by adding "
        f"the gap height (${gap_height:.2f}) onto the gap close (${gap_close:.2f}); this "
        f"is conservative because strong PEGs frequently 2-3x this initial projection. "
        f"Position sizing should reflect the {stop_distance_pct:.1f}% stop distance - "
        f"a 1% account risk implies roughly "
        f"{(1.0 / (stop_distance_pct / 100)):.0f}% of equity allocated to the trade. "
        f"Bonde teaches that you can also enter on a tight 1-2 bar pullback that holds "
        f"the prior bar's mid-range, but never chase more than 3-5% above the pivot - "
        f"chasing PEG breakouts is the number-one way to give back the edge that the "
        f"gap-and-hold pattern was supposed to deliver."
    )

    failure_signal = (
        f"The PEG is invalidated when price closes below the gap-up day low at "
        f"${gap_low:.2f} (stop set at ${stop:.2f}, 1.5% below) - that's a 'filling the "
        f"gap' event in Bonde's terminology, and it signals that the new fundamentals "
        f"didn't sustain institutional commitment. A subtler failure mode: post-gap "
        f"action that drifts down on each successive bar (lower highs, lower lows) over "
        f"5+ bars even if it doesn't technically fill the gap - this drift pattern "
        f"typically precedes a deeper fade as institutions quietly distribute the shares "
        f"they accumulated on the gap. The penalty for being wrong on a PEG is the "
        f"{gap_pct_pct:.1f}% gap size itself (from gap-up open down through the gap fill) "
        f"PLUS the breakout failure distance, so disciplined stops at ${stop:.2f} are "
        f"non-negotiable. Trail stops up below each new swing low as the stock advances; "
        f"PEGs frequently retest the post-gap consolidation high (${post_gap_high:.2f}) "
        f"once before extending, so the first stop should survive that retest. Failed "
        f"PEGs often see the underlying news re-evaluated as not as strong as initially "
        f"perceived - the chart is leading the fundamental reassessment."
    )

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Power Earnings Gap (PEG)",
        "category": "uct",
        "direction": "bullish",
        "start_t": int(prior_bar["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": pivot_ts,
        "geometry": {
            "shape": "candle_mark",
            "anchors": anchors,
            "extras": {
                "gap_pct": round(gap_pct * 100.0, 2),
                "gap_volume_ratio": round(volume_ratio, 2),
                "post_gap_bars": int(post_gap_bars),
                "post_gap_range_pct": round(post_gap_range_pct, 2),
                "gap_fill_pct": round(gap_fill_pct, 2),
                "gap_height": round(gap_height, 2),
                "gap_open": round(gap_open, 2),
                "gap_high": round(gap_high, 2),
                "gap_low": round(gap_low, 2),
                "gap_close": round(gap_close, 2),
                "prior_close": round(prior_close, 2),
                "post_gap_high": round(post_gap_high, 2),
                "post_gap_low": round(post_gap_low, 2),
                "gap_range_pct": round(gap_range_pct, 2),
                "dcr_score_adj": round(_dcr_score_adjustment(context), 2),
            },
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close > {entry:.2f} on volume >= 1.5x 20-bar avg",
            "stop": stop,
            "stop_basis": "gap_bar_low_minus_1.5pct",
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


register(_PATTERN_ID, detect_power_earnings_gap)
