"""Horizontal Support/Resistance Level detector - structure detector.

Where swing_pivots maps the raw scaffolding of recent reversal points, the
support_resistance detector goes one step further: it clusters those pivots
into the price levels that have been DEFENDED MULTIPLE TIMES. A level
defended twice or more becomes a reference price for entries, stops, and
targets that institutional traders watch in real time.

Unlike trade-setup detectors (one Detection per fire) and unlike
swing_pivots (one Detection containing every pivot in the window), this
detector emits ONE Detection PER ACTIVE LEVEL. A chart with three clean
support and resistance levels will return three Detections in a single call.

Geometric definition:
  - Window: the most recent 60 bars (or all bars if series < 60)
  - Pivot extraction: detect_pivots(bars, window=3)
  - Cluster pivots whose prices are within 2% of each other (greedy clustering)
  - For each cluster with >=2 touches, emit one Detection
  - Type: "resistance" if majority of touches are swing-highs, else "support"
  - Direction (per Detection): "neutral" (a level is a reference, not a bias)

Levels (structural - the entry/stop is the trading application of the level):
  - For support: entry = level*1.005, stop = level*0.985,
                 target = nearest resistance above (if any)
  - For resistance: entry = level*0.995, stop = level*1.015,
                    target = nearest support below (if any)

Confidence formula (level strength):
  confidence = min(100, 50 + 10*(touch_count - 2) + (avg_strength - 50)*0.5)

So:
  - 2 touches, avg strength 50 -> 50 (minimum)
  - 3 touches, avg strength 70 -> 70
  - 4 touches, avg strength 80 -> 80
  - 5+ touches, avg strength 90+ -> 100
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "support_resistance"
_WINDOW_BARS = 60
_PIVOT_WINDOW = 3
_MIN_TOUCHES = 2
_CLUSTER_BAND_PCT = 0.02       # 2% price band defines a cluster
_PSYCH_TOLERANCE_PCT = 0.015   # within 1.5% of a $5/$10/$25/$50/$100 grid line


def detect_support_resistance(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect horizontal S/R levels by clustering recent swing pivots.

    Emits 0..N Detections, one per active level with >= _MIN_TOUCHES.
    """
    if len(bars) < 2 * _PIVOT_WINDOW + 1:
        return []

    all_pivots = detect_pivots(bars, window=_PIVOT_WINDOW)
    if not all_pivots:
        return []

    last_bar_idx = len(bars) - 1
    window_start = max(0, last_bar_idx - _WINDOW_BARS + 1)
    window_bars_actual = min(_WINDOW_BARS, len(bars))

    # Filter pivots to recent window
    recent_pivots = [p for p in all_pivots if p["bar_index"] >= window_start]
    if len(recent_pivots) < _MIN_TOUCHES:
        return []

    # Cluster pivots by price proximity (within 2% band)
    clusters = _cluster_pivots_by_price(recent_pivots)

    # Filter to clusters with >= _MIN_TOUCHES, then build per-level summaries
    levels: List[dict] = []
    for cluster in clusters:
        if len(cluster) < _MIN_TOUCHES:
            continue
        levels.append(_summarize_cluster(cluster, last_bar_idx))

    if not levels:
        return []

    # 2nd pass: assign targets using OTHER levels
    _assign_targets(levels)

    # Build detections
    detections: List[Detection] = []
    current_close = float(bars[-1]["c"])
    for lvl in levels:
        d = _build_detection(
            bars=bars,
            level=lvl,
            all_levels=levels,
            context=context,
            window_bars=window_bars_actual,
            current_close=current_close,
            last_bar_idx=last_bar_idx,
        )
        detections.append(d)

    return detections


# ---------------------------------------------------------------------------
# Clustering
# ---------------------------------------------------------------------------

def _cluster_pivots_by_price(pivots: List[dict]) -> List[List[dict]]:
    """Greedy clustering of pivots within a 2% price band.

    Sort pivots ascending by price. Walk the sorted list and grow a cluster
    while each new pivot's price is within _CLUSTER_BAND_PCT of the cluster's
    running average price. When the gap exceeds the band, start a fresh
    cluster.
    """
    if not pivots:
        return []

    sorted_pivots = sorted(pivots, key=lambda p: p["price"])
    clusters: List[List[dict]] = []
    current: List[dict] = [sorted_pivots[0]]
    current_sum = float(sorted_pivots[0]["price"])

    for p in sorted_pivots[1:]:
        avg = current_sum / len(current)
        # within 2% of running average? add to cluster
        if avg > 0 and abs(p["price"] - avg) / avg <= _CLUSTER_BAND_PCT:
            current.append(p)
            current_sum += float(p["price"])
        else:
            clusters.append(current)
            current = [p]
            current_sum = float(p["price"])
    clusters.append(current)
    return clusters


def _summarize_cluster(cluster: List[dict], last_bar_idx: int) -> dict:
    """Compute level price, type, touch count, avg strength, age metrics."""
    n = len(cluster)
    avg_price = sum(float(p["price"]) for p in cluster) / n
    high_count = sum(1 for p in cluster if p["type"] == "high")
    low_count = n - high_count
    level_type = "resistance" if high_count >= low_count else "support"

    avg_strength = sum(float(p["strength"]) for p in cluster) / n

    # Oldest and most-recent touches by bar_index
    sorted_by_bar = sorted(cluster, key=lambda p: p["bar_index"])
    oldest = sorted_by_bar[0]
    most_recent = sorted_by_bar[-1]
    age_bars = last_bar_idx - oldest["bar_index"]
    most_recent_age_bars = last_bar_idx - most_recent["bar_index"]

    # Cluster band: actual spread within the cluster (max - min) / avg
    prices = [float(p["price"]) for p in cluster]
    cluster_band_pct = (max(prices) - min(prices)) / avg_price if avg_price > 0 else 0.0

    return {
        "level_price": avg_price,
        "level_type": level_type,
        "touch_count": n,
        "high_count": high_count,
        "low_count": low_count,
        "avg_strength": avg_strength,
        "oldest_t": int(oldest["t"]),
        "oldest_bar_idx": int(oldest["bar_index"]),
        "most_recent_t": int(most_recent["t"]),
        "most_recent_bar_idx": int(most_recent["bar_index"]),
        "age_bars": int(age_bars),
        "most_recent_age_bars": int(most_recent_age_bars),
        "cluster_band_pct": float(cluster_band_pct),
        "touches": cluster,  # the underlying pivots
    }


def _assign_targets(levels: List[dict]) -> None:
    """For each level, set 'target_price' to the nearest opposite-side level.

    Support levels target the nearest resistance ABOVE.
    Resistance levels target the nearest support BELOW.
    Mutates each level dict in place; target_price is None if no candidate exists.
    """
    for lvl in levels:
        price = lvl["level_price"]
        if lvl["level_type"] == "support":
            candidates = [
                o for o in levels
                if o is not lvl and o["level_type"] == "resistance"
                and o["level_price"] > price
            ]
            if candidates:
                nearest = min(candidates, key=lambda o: o["level_price"] - price)
                lvl["target_price"] = nearest["level_price"]
            else:
                lvl["target_price"] = None
        else:  # resistance
            candidates = [
                o for o in levels
                if o is not lvl and o["level_type"] == "support"
                and o["level_price"] < price
            ]
            if candidates:
                nearest = min(candidates, key=lambda o: price - o["level_price"])
                lvl["target_price"] = nearest["level_price"]
            else:
                lvl["target_price"] = None


# ---------------------------------------------------------------------------
# Confidence / scoring
# ---------------------------------------------------------------------------

def _compute_confidence(touch_count: int, avg_strength: float) -> float:
    raw = 50.0 + 10.0 * (touch_count - 2) + (avg_strength - 50.0) * 0.5
    return float(min(100.0, max(0.0, raw)))


def _compute_geometry_score(touch_count: int, avg_strength: float,
                            cluster_band_pct: float) -> float:
    """Geometry quality: more touches + tighter band + stronger pivots = better."""
    # Touch component: 2->40, 3->60, 4->75, 5+->100
    if touch_count >= 5:
        touch_comp = 100.0
    elif touch_count == 4:
        touch_comp = 75.0
    elif touch_count == 3:
        touch_comp = 60.0
    else:
        touch_comp = 40.0

    # Tightness component: band <=0.5%->100, >=2%->20
    if cluster_band_pct <= 0.005:
        tight_comp = 100.0
    elif cluster_band_pct >= 0.02:
        tight_comp = 20.0
    else:
        # linear between 0.5% (100) and 2% (20)
        tight_comp = 100.0 - (cluster_band_pct - 0.005) / 0.015 * 80.0

    strength_comp = float(min(100.0, max(0.0, avg_strength)))

    return round(0.45 * touch_comp + 0.30 * tight_comp + 0.25 * strength_comp, 2)


def _compute_volume_score(bars: List[Bar], touches: List[dict]) -> float:
    """Average volume at the touch bars relative to the session average.

    Cap at 100 when avg-touch-volume is >= 1.5x the session avg over the
    full series length.
    """
    if not bars:
        return 50.0
    session_avg = sum(float(b["v"]) for b in bars) / len(bars)
    if session_avg <= 0:
        return 50.0
    touch_vols = []
    for p in touches:
        idx = int(p["bar_index"])
        if 0 <= idx < len(bars):
            touch_vols.append(float(bars[idx]["v"]))
    if not touch_vols:
        return 50.0
    avg_touch_v = sum(touch_vols) / len(touch_vols)
    ratio = avg_touch_v / session_avg
    if ratio >= 1.5:
        return 100.0
    if ratio <= 0.5:
        return 30.0
    # linear 0.5 -> 30 .. 1.5 -> 100
    return round(30.0 + (ratio - 0.5) * 70.0, 2)


def _is_psychologically_meaningful(level_price: float) -> bool:
    """Heuristic: is level_price within 1.5% of a $5/$10/$25/$50/$100 grid line?"""
    if level_price <= 0:
        return False
    grids = (5.0, 10.0, 25.0, 50.0, 100.0)
    for grid in grids:
        nearest = round(level_price / grid) * grid
        if nearest <= 0:
            continue
        if abs(level_price - nearest) / nearest <= _PSYCH_TOLERANCE_PCT:
            return True
    return False


def _compute_context_score(level_price: float) -> float:
    """70 if psychologically meaningful (round number), 50 otherwise."""
    return 70.0 if _is_psychologically_meaningful(level_price) else 50.0


# ---------------------------------------------------------------------------
# Narrative helpers
# ---------------------------------------------------------------------------

def _touch_count_descriptor(n: int) -> str:
    if n >= 5:
        return "institutional-grade conviction (5+ touches over the window)"
    if n >= 3:
        return "confirmed (3-4 touches make this a tested reference level)"
    return "nascent / still-forming (2 touches is the minimum threshold)"


def _strength_descriptor(avg: float) -> str:
    if avg >= 85:
        return "exceptionally strong"
    if avg >= 70:
        return "high-quality"
    if avg >= 60:
        return "solid"
    if avg >= 50:
        return "average"
    return "modest"


def _freshness_descriptor(age_bars: int) -> str:
    if age_bars <= 5:
        return "very fresh (most recent touch was within the last week of action)"
    if age_bars <= 15:
        return "recent (within the last three weeks)"
    if age_bars <= 30:
        return "moderately aged (1-1.5 months since the last touch)"
    return "older (more than 1.5 months since the last test - reliability decays with age)"


def _immediacy_descriptor(distance_pct: float, level_type: str) -> str:
    abs_d = abs(distance_pct)
    if abs_d <= 1.0:
        return "an immediate and actionable reference level - price is right at it now"
    if abs_d <= 3.0:
        return "a near-term reference level that price can reach in 1-2 sessions"
    if abs_d <= 6.0:
        return "a mid-distance reference level - relevant for swing-trade horizons but not for same-day positioning"
    return "a more distant reference level - useful for stop/target framing but not for immediate trade triggers"


def _trading_application_descriptor(level_type: str, regime: str) -> str:
    if level_type == "support":
        return (
            "a potential buy zone when in an uptrend, a defensible long entry "
            "with tight stop placement, and the natural location to add to "
            "winning positions on healthy pullbacks"
        )
    return (
        "a potential short zone or take-profit target when in a downtrend, "
        "and a level where long positions should book partial gains or trim risk"
    )


def _regime_volume_context_sentence(regime: str, volume_score: float) -> str:
    if volume_score >= 80:
        vol_phrase = "above-average volume at the touch bars confirms institutional defense - this is not a noise level"
    elif volume_score >= 60:
        vol_phrase = "decent volume at the touches suggests real participation rather than thin-tape rejection"
    else:
        vol_phrase = "below-average volume at the touch bars is a minor caution - the level is geometrically real but lightly defended"
    return f"In a {regime} regime, {vol_phrase}"


def _stage_descriptor(context: dict) -> str:
    stage = context.get("trend_stage", 0)
    if stage == 2:
        return "a Stage 2 uptrend"
    if stage == 1:
        return "a Stage 1 basing / accumulation environment"
    if stage == 3:
        return "a Stage 3 distribution environment"
    if stage == 4:
        return "a Stage 4 downtrend"
    return "an undefined trend stage"


# ---------------------------------------------------------------------------
# Detection builder
# ---------------------------------------------------------------------------

def _build_detection(
    bars: List[Bar],
    level: dict,
    all_levels: List[dict],
    context: dict,
    window_bars: int,
    current_close: float,
    last_bar_idx: int,
) -> Detection:
    level_price = level["level_price"]
    level_type = level["level_type"]
    touch_count = level["touch_count"]
    avg_strength = level["avg_strength"]
    age_bars = level["age_bars"]
    most_recent_age_bars = level["most_recent_age_bars"]
    cluster_band_pct = level["cluster_band_pct"]
    target_price = level.get("target_price")

    # Levels
    if level_type == "support":
        entry = round(level_price * 1.005, 2)
        stop = round(level_price * 0.985, 2)
        entry_condition = (
            f"buy zone near support at ${level_price:.2f} - "
            f"long entry with stop below ${stop:.2f}"
        )
        stop_basis = "1.5% below the support level"
        break_threshold = 1.5
        stop_buffer_pct = 1.5
    else:
        entry = round(level_price * 0.995, 2)
        stop = round(level_price * 1.015, 2)
        entry_condition = (
            f"short zone near resistance at ${level_price:.2f} - "
            f"short entry with stop above ${stop:.2f}"
        )
        stop_basis = "1.5% above the resistance level"
        break_threshold = 1.5
        stop_buffer_pct = 1.5

    target = round(float(target_price), 2) if target_price is not None else None
    if target is not None:
        denom = abs(entry - stop)
        rr = round(abs(target - entry) / denom, 2) if denom > 0 else 0.0
    else:
        rr = 0.0

    # Distance from current price
    if current_close > 0:
        distance_from_current_pct = (level_price - current_close) / current_close * 100.0
    else:
        distance_from_current_pct = 0.0
    above_or_below = "above" if distance_from_current_pct >= 0 else "below"

    # Scoring
    confidence = _compute_confidence(touch_count, avg_strength)
    geometry_score = _compute_geometry_score(touch_count, avg_strength, cluster_band_pct)
    volume_score = _compute_volume_score(bars, level["touches"])
    context_score = _compute_context_score(level_price)
    historical_score = 50.0

    # Anchors: oldest_touch + most_recent_touch, both at the level price
    anchors = [
        {"t": int(level["oldest_t"]), "price": float(level_price)},
        {"t": int(level["most_recent_t"]), "price": float(level_price)},
    ]
    pivot_ts = [int(p["t"]) for p in level["touches"]]

    last_bar = bars[-1]
    now = int(time.time())

    # ---------- Narrative composition (rich, paragraph-length, real values) ----------
    level_type_capitalized = level_type.capitalize()
    touch_desc = _touch_count_descriptor(touch_count)
    strength_desc = _strength_descriptor(avg_strength)
    freshness_desc = _freshness_descriptor(most_recent_age_bars)
    immediacy_desc = _immediacy_descriptor(distance_from_current_pct, level_type)
    regime = context.get("regime", "current")
    stage_desc = _stage_descriptor(context)
    trading_app_desc = _trading_application_descriptor(level_type, regime)
    regime_vol_sentence = _regime_volume_context_sentence(regime, volume_score)

    if avg_strength >= 80:
        failure_likelihood_desc = "below-average"
    elif avg_strength >= 65:
        failure_likelihood_desc = "moderate"
    else:
        failure_likelihood_desc = "elevated"

    headline = (
        f"{level_type_capitalized} at ${level_price:.2f} - "
        f"{touch_count} touches over {age_bars} bars, "
        f"avg strength {avg_strength:.0f}/100."
    )

    what_it_is = (
        f"This {level_type} level at ${level_price:.2f} is identified by "
        f"clustering swing pivots in the recent {window_bars}-bar window into "
        f"price zones where reversals have repeatedly occurred. "
        f"{touch_count} significant pivots have printed at or near this price "
        f"(within a {cluster_band_pct*100:.2f}% spread, inside the 2% clustering "
        f"band), making it a high-conviction reference level for any participant "
        f"who reads horizontal structure. The touch count of {touch_count} is "
        f"{touch_desc}, which reflects how reliably {('buyers' if level_type == 'support' else 'sellers')} "
        f"have defended this price across {age_bars} bars of action. Each pivot "
        f"in the cluster also carries a strength score (0-100) based on how "
        f"dominantly that pivot stood out from its neighbors; the average "
        f"strength of touches at this level is {avg_strength:.1f}/100, indicating "
        f"{strength_desc} reversal quality. Horizontal {level_type} levels are "
        f"the foundational tool of technical analysis - they identify the price "
        f"zones where supply and demand have repeatedly intersected, providing "
        f"reference points for entries, stops, and targets that institutional "
        f"traders watch in real time and that algorithmic systems pre-position "
        f"around well in advance of the level being tested. Richard Wyckoff "
        f"first formalized this reading in his accumulation/distribution "
        f"schematics — a level becomes structurally significant once it has "
        f"been tested at least three times. Tom Bulkowski's empirical "
        f"touch-rate research quantifies the read: support/resistance levels "
        f"with 3+ touches hold on retest roughly 70% of the time, with hit "
        f"rate climbing further as touch count and time spent at the level "
        f"grow. Adam Grimes's modern S/R probability statistics in 'The Art "
        f"and Science of Technical Analysis' refine the picture further with "
        f"explicit decay curves: a fresh level holds better than an aged "
        f"level, and a recent fast-rejection touch carries more information "
        f"than an old slow-grind touch."
    )

    target_phrase = (
        f"the projected target is the opposite-side level at ${target:.2f} "
        f"(yielding a risk/reward of approximately {rr:.1f}:1)"
        if target is not None else
        "no opposite-side level was found in the current window, so traders "
        "should manually identify a higher-timeframe target"
    )

    why_it_matters = (
        f"The {level_type} at ${level_price:.2f} is currently "
        f"{abs(distance_from_current_pct):.2f}% {above_or_below} the most recent "
        f"close (${current_close:.2f}), which positions it as {immediacy_desc}. "
        f"Within a {regime} regime and {stage_desc} context, this level serves "
        f"as {trading_app_desc} - and for trade construction, {target_phrase}. "
        f"The {touch_count} historical touches give this level statistical "
        f"validity: institutional studies of horizontal S/R show that levels "
        f"with 3+ touches over a multi-week window have approximately 60-70% "
        f"historical hold rates on first retest, with the hold rate climbing "
        f"further as touch counts increase. Broken levels also flip role - "
        f"former support becomes resistance and former resistance becomes "
        f"support - which is one of the most reliable principles in technical "
        f"analysis and explains why this exact zone will continue to matter "
        f"even if price eventually clears it. {regime_vol_sentence}. The "
        f"freshness of touches matters too: the most recent touch was "
        f"{most_recent_age_bars} bars ago, making this a {freshness_desc} "
        f"reference."
    )

    what_to_watch_for = (
        f"Watch how price interacts with ${level_price:.2f} as it approaches: "
        f"a clean rejection (immediate reversal with above-average volume on the "
        f"touch bar) confirms the level's continued validity and offers the "
        f"highest-quality {('long' if level_type == 'support' else 'short')} "
        f"trade entries, while a penetration on weak volume often signals the "
        f"level is weakening even if price hasn't decisively closed through. "
        f"For this {level_type}: the ideal trade is to enter within 1-2% of the "
        f"level (planned entry: ${entry:.2f}) with a stop just "
        f"{('below' if level_type == 'support' else 'above')} the level "
        f"(${stop:.2f}, a {stop_buffer_pct:.1f}% buffer). Volume on the rejection "
        f"bar should be >=1.5x the 20-bar average - heavy volume at the "
        f"rejection confirms institutional defense; light volume suggests algos "
        f"or passive flow only. Cluster zones - groups of levels within ~3% of "
        f"each other - act as 'walls' that are progressively harder to break; "
        f"isolated levels are easier to penetrate. As new bars print near "
        f"${level_price:.2f}, watch the pattern of OHLC interaction: repeated "
        f"wicks AT the level (rejecting touches with closes back above for "
        f"support, below for resistance) signal it is holding firm, while "
        f"repeated full-bar closes through it on rising volume signal it is "
        f"failing and a regime shift to the opposite role is imminent. "
        f"Watch DCR on the bar that interacts with this level - strong DCR "
        f"(>=0.7) on a bounce confirms institutional defense of "
        f"{('support' if level_type == 'support' else 'resistance')}, "
        f"weak DCR (<=0.3) on a touch signals supply overhead and a likely "
        f"failure of the level. Recent 10-bar DCR average is "
        f"{(context.get('recent_dcr_avg', 0.5) or 0.5) * 100:.0f}% with "
        f"signature: {context.get('dcr_signature', 'neutral')}."
    )

    failure_signal = (
        f"A {level_type} level fails when price closes through it on volume "
        f"meaningfully above average (>1.5x the 20-bar average) AND fails to "
        f"recover within 3 bars. Broken support becomes resistance on retest, "
        f"and broken resistance becomes support - this 'role reversal' "
        f"phenomenon is one of the most reliable technical principles, and it "
        f"means even after this level breaks, the same price zone will continue "
        f"to attract reactive flow in the opposite direction. For the level at "
        f"${level_price:.2f}: a sustained close "
        f"{('below' if level_type == 'support' else 'above')} by more than "
        f"{break_threshold:.1f}% on heavy volume signals failure, with the "
        f"specific stop trigger placed at ${stop:.2f}. Stops on trades using "
        f"this level should be set {stop_buffer_pct:.1f}% beyond the level - "
        f"too tight and noise alone will shake you out, too loose and you give "
        f"back significant value when the level genuinely fails. The level's "
        f"{touch_count}-touch history and the {freshness_desc} of recent tests "
        f"together suggest {failure_likelihood_desc} probability of failure "
        f"in the near term: a more strongly defended (high touch count + "
        f"recent touches) level is far less likely to fail than a "
        f"lightly-tested (2 touches + older) one. Risk management around this "
        f"level should reflect that asymmetry."
    )

    detection: Detection = {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Support / Resistance Level",
        "category": "structure",
        "direction": "neutral",
        "start_t": int(bars[level["oldest_bar_idx"]]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": pivot_ts,
        "geometry": {
            "shape": "horizontal_line",
            "anchors": anchors,
            "extras": {
                "level_type": str(level_type),
                "level_price": round(float(level_price), 2),
                "touch_count": int(touch_count),
                "high_count": int(level["high_count"]),
                "low_count": int(level["low_count"]),
                "age_bars": int(age_bars),
                "avg_strength": round(float(avg_strength), 2),
                "most_recent_touch_age_bars": int(most_recent_age_bars),
                "distance_from_current_pct": round(float(distance_from_current_pct), 2),
                "cluster_band_pct": round(float(cluster_band_pct * 100.0), 3),
                "window_bars": int(window_bars),
                "dcr_score_adj": 0.0,
            },
        },
        "levels": {
            "entry": entry,
            "entry_condition": entry_condition,
            "stop": stop,
            "stop_basis": stop_basis,
            "target_primary": target,
            "target_secondary": None,
            "risk_reward": rr,
        },
        "context": context,
        "confidence": confidence,
        "quality_components": {
            "geometry_score": geometry_score,
            "volume_score": volume_score,
            "context_score": context_score,
            "historical_score": historical_score,
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
    return detection


register(_PATTERN_ID, detect_support_resistance)
