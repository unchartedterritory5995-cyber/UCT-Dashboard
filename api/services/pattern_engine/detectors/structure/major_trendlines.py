"""Major Trendlines - structure detector.

Identifies the major rising-support and falling-resistance trendlines on the
chart by fitting trendlines through swing pivots and filtering for high
validity. A single chart typically has 0-2 major trendlines active at any
time. Each Detection represents ONE validated trendline (a chart with both
an uptrend support and a downtrend resistance would emit 2 Detections).

Geometric definition:
  - Window: the most recent 80 bars (longer than swing_pivots' 60 to give
    trendlines time to develop)
  - Pivot extraction: detect_pivots(bars, window=3) on the recent window
  - Rising support trendline: swing-low pivots fitted via fit_trendline().
    Slope > 0, r_squared >= 0.7, touches >= 3, validity > 0.6.
  - Falling resistance trendline: swing-high pivots fitted similarly.
    Slope < 0, r_squared >= 0.7, touches >= 3, validity > 0.6.
  - Horizontal channel (less common): slope ~= 0 (|slope| < 0.001 * mid_price)
    classifies as horizontal; allowed but not emphasized.
  - CRITICAL: re-key pivots so t = bar_index (not unix timestamp) before
    fitting (slope math breaks if t is in seconds).
  - Direction:
      Rising support      -> "bullish"
      Falling resistance  -> "bearish"
      Horizontal          -> "neutral"
  - Emit ONE Detection PER validated trendline (0, 1, or 2 typical).

Levels per Detection:
  Rising support (bullish):
    entry = line_at_now * 1.005, stop = line_at_now * 0.985,
    target = previous_high_in_uptrend or None
  Falling resistance (bearish):
    entry = line_at_now * 0.995, stop = line_at_now * 1.015,
    target = previous_low_in_downtrend or None
  Horizontal: entry = line_value, stop/target = None

Confidence:
  confidence = round(50 + 30*(touches-3)/4 + (r_squared-0.7)*100, 1),
  clamped to [50, 100].
    3 touches, r2=0.7     -> 50
    4 touches, r2=0.8     -> 80
    5+ touches, r2=0.9+   -> 100

Quality components:
  geometry_score:   r_squared * 100
  volume_score:     50 (not applicable for pure trendlines)
  context_score:    70 if trendline aligns with broader trend stage (rising
                    support in Stage 2 = aligned, falling resistance in
                    Stage 4 = aligned), else 40
  historical_score: 50
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.geometry import line_at
from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.primitives.trendlines import fit_trendline
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "major_trendlines"
_WINDOW_BARS = 80
_PIVOT_WINDOW = 3
_MIN_TOUCHES = 3
_MIN_R_SQUARED = 0.7
_MIN_VALIDITY = 0.6
_HORIZONTAL_SLOPE_FRACTION = 0.001  # |slope| < 0.001 * mid_price = horizontal


def detect_major_trendlines(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect major trendlines in the recent window. Emits 0..2 Detections."""
    if len(bars) < 2 * _PIVOT_WINDOW + 1:
        return []

    all_pivots = detect_pivots(bars, window=_PIVOT_WINDOW)
    if not all_pivots:
        return []

    last_bar_idx = len(bars) - 1
    window_start = max(0, last_bar_idx - _WINDOW_BARS + 1)
    window_bars_actual = min(_WINDOW_BARS, len(bars))

    # Filter to pivots within recent window
    recent_pivots = [p for p in all_pivots if p["bar_index"] >= window_start]
    if not recent_pivots:
        return []

    # Re-key pivots: t = bar_index (so trendline slope is price-per-bar).
    high_pivots = [
        {"t": p["bar_index"], "price": p["price"],
         "type": "high", "strength": p["strength"],
         "bar_index": p["bar_index"],
         "orig_t": p["t"]}
        for p in recent_pivots if p["type"] == "high"
    ]
    low_pivots = [
        {"t": p["bar_index"], "price": p["price"],
         "type": "low", "strength": p["strength"],
         "bar_index": p["bar_index"],
         "orig_t": p["t"]}
        for p in recent_pivots if p["type"] == "low"
    ]

    current_close = float(bars[-1]["c"])
    mid_price = current_close if current_close > 0 else 1.0
    horizontal_thresh = mid_price * _HORIZONTAL_SLOPE_FRACTION

    candidates: List[dict] = []

    # ---- Rising support candidate (low pivots) ----
    if len(low_pivots) >= _MIN_TOUCHES:
        try:
            low_line = fit_trendline(low_pivots)
        except ValueError:
            low_line = None
        if low_line is not None:
            cand = _classify_and_validate(
                line=low_line,
                pivots=low_pivots,
                bars=bars,
                last_bar_idx=last_bar_idx,
                horizontal_thresh=horizontal_thresh,
                kind="low",
            )
            if cand is not None:
                candidates.append(cand)

    # ---- Falling resistance candidate (high pivots) ----
    if len(high_pivots) >= _MIN_TOUCHES:
        try:
            high_line = fit_trendline(high_pivots)
        except ValueError:
            high_line = None
        if high_line is not None:
            cand = _classify_and_validate(
                line=high_line,
                pivots=high_pivots,
                bars=bars,
                last_bar_idx=last_bar_idx,
                horizontal_thresh=horizontal_thresh,
                kind="high",
            )
            if cand is not None:
                candidates.append(cand)

    if not candidates:
        return []

    detections: List[Detection] = []
    for cand in candidates:
        d = _build_detection(
            bars=bars,
            cand=cand,
            context=context,
            window_bars=window_bars_actual,
            current_close=current_close,
            last_bar_idx=last_bar_idx,
        )
        detections.append(d)
    return detections


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------

def _classify_and_validate(
    line: dict,
    pivots: List[dict],
    bars: List[Bar],
    last_bar_idx: int,
    horizontal_thresh: float,
    kind: str,
) -> Optional[dict]:
    """Classify the fitted line as rising_support / falling_resistance /
    horizontal and apply validation gates.

    Returns the candidate dict or None if it fails validation.
    """
    slope = float(line["slope"])
    r2 = float(line["r_squared"])
    touches = int(line["touches"])
    validity = float(line["validity"])

    if r2 < _MIN_R_SQUARED:
        return None
    if touches < _MIN_TOUCHES:
        return None
    if validity <= _MIN_VALIDITY:
        return None

    # Direction classification
    if abs(slope) < horizontal_thresh:
        if kind == "low":
            trendline_type = "horizontal_support"
            direction = "neutral"
        else:
            trendline_type = "horizontal_resistance"
            direction = "neutral"
    elif kind == "low":
        if slope <= 0:
            return None  # low pivots fitting downward is not a rising support
        trendline_type = "rising_support"
        direction = "bullish"
    else:  # kind == "high"
        if slope >= 0:
            return None  # high pivots fitting upward is not a falling resistance
        trendline_type = "falling_resistance"
        direction = "bearish"

    # Endpoints / values at start, end, now
    p1_t = int(line["p1"]["t"])
    p2_t = int(line["p2"]["t"])
    line_at_now = float(line_at((line["p1"], line["p2"]), last_bar_idx))
    span_bars = max(1, p2_t - p1_t)

    # Slope expressed as % per bar relative to the current line value
    if line_at_now > 0:
        slope_pct_per_bar = slope / line_at_now * 100.0
    else:
        slope_pct_per_bar = 0.0

    return {
        "line": line,
        "pivots": pivots,
        "kind": kind,
        "trendline_type": trendline_type,
        "direction": direction,
        "slope": slope,
        "r_squared": r2,
        "touches": touches,
        "validity": validity,
        "p1_t": p1_t,
        "p2_t": p2_t,
        "p1_price": float(line["p1"]["price"]),
        "p2_price": float(line["p2"]["price"]),
        "line_at_now": line_at_now,
        "span_bars": int(span_bars),
        "slope_pct_per_bar": float(slope_pct_per_bar),
    }


# ---------------------------------------------------------------------------
# Target derivation
# ---------------------------------------------------------------------------

def _derive_target(cand: dict, bars: List[Bar], last_bar_idx: int,
                   window_start: int) -> Optional[float]:
    """Derive a structural target.

    For rising support: previous swing-high *within the uptrend window*.
    For falling resistance: previous swing-low *within the downtrend window*.
    Horizontal: None.
    """
    tt = cand["trendline_type"]
    if tt == "rising_support":
        # Highest high in the window (above current price preferred)
        highs = [bars[i]["h"] for i in range(window_start, last_bar_idx + 1)]
        if not highs:
            return None
        target = max(highs)
        return float(target)
    if tt == "falling_resistance":
        lows = [bars[i]["l"] for i in range(window_start, last_bar_idx + 1)]
        if not lows:
            return None
        target = min(lows)
        return float(target)
    return None


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def _compute_confidence(touches: int, r_squared: float) -> float:
    raw = 50.0 + 30.0 * (touches - 3) / 4.0 + (r_squared - 0.7) * 100.0
    return float(round(min(100.0, max(50.0, raw)), 1))


def _compute_geometry_score(r_squared: float) -> float:
    return round(float(r_squared) * 100.0, 2)


def _compute_context_score(cand: dict, context: dict) -> float:
    stage = context.get("trend_stage", 0)
    tt = cand["trendline_type"]
    if tt == "rising_support" and stage == 2:
        return 70.0
    if tt == "falling_resistance" and stage == 4:
        return 70.0
    if tt in ("horizontal_support", "horizontal_resistance") and stage in (1, 3):
        return 70.0
    return 40.0


# ---------------------------------------------------------------------------
# Narrative helpers
# ---------------------------------------------------------------------------

def _trendline_type_capitalized(tt: str) -> str:
    return {
        "rising_support": "Rising Support",
        "falling_resistance": "Falling Resistance",
        "horizontal_support": "Horizontal Support",
        "horizontal_resistance": "Horizontal Resistance",
    }.get(tt, tt.replace("_", " ").title())


def _slope_interpretation(tt: str, slope_pct_per_bar: float) -> str:
    abs_pct = abs(slope_pct_per_bar)
    if tt == "rising_support":
        return (
            f"each successive swing-low pivot has formed approximately "
            f"{abs_pct:.3f}% higher than the prior one, indicating systematic "
            f"institutional accumulation that lifts the floor a measurable "
            f"amount with every reversal"
        )
    if tt == "falling_resistance":
        return (
            f"each successive swing-high pivot has formed approximately "
            f"{abs_pct:.3f}% lower than the prior one, indicating systematic "
            f"institutional distribution that drops the ceiling a measurable "
            f"amount with every rally rejection"
        )
    return (
        f"the level is essentially flat at {abs_pct:.4f}% per bar - a "
        f"horizontal reference rather than a trending one"
    )


def _pivot_type_descriptor(tt: str) -> str:
    if tt == "rising_support":
        return "swing-lows (reversal points where buyers stepped in)"
    if tt == "falling_resistance":
        return "swing-highs (rejection points where sellers stepped in)"
    return "pivots"


def _higher_or_lower(tt: str) -> str:
    if tt == "rising_support":
        return "higher"
    if tt == "falling_resistance":
        return "lower"
    return "stable"


def _accumulation_or_distribution(tt: str) -> str:
    if tt == "rising_support":
        return "accumulation"
    if tt == "falling_resistance":
        return "distribution"
    return "two-sided participation"


def _institutional_actors(tt: str) -> str:
    if tt == "rising_support":
        return "long-only institutional bidders and trend-following systems"
    if tt == "falling_resistance":
        return "trend-following short sellers and long-side risk reducers"
    return "two-sided systematic flow"


def _action_at_line(tt: str) -> str:
    if tt == "rising_support":
        return (
            "step in and defend, looking for absorption and rejection to "
            "the upside"
        )
    if tt == "falling_resistance":
        return (
            "fade by selling supply into the rally, looking for rejection "
            "and a fresh leg lower"
        )
    return "trade against the level in either direction"


def _alignment_with_stage_descriptor(cand: dict, context: dict) -> str:
    stage = context.get("trend_stage", 0)
    tt = cand["trendline_type"]
    stage_str = {
        1: "Stage 1 basing", 2: "Stage 2 uptrend",
        3: "Stage 3 distribution", 4: "Stage 4 downtrend",
    }.get(stage, "undefined-stage")
    if tt == "rising_support" and stage == 2:
        return f"aligns cleanly with the broader {stage_str} context"
    if tt == "falling_resistance" and stage == 4:
        return f"aligns cleanly with the broader {stage_str} context"
    if tt in ("horizontal_support", "horizontal_resistance") and stage in (1, 3):
        return (
            f"is consistent with the broader {stage_str} context where "
            f"horizontal action dominates"
        )
    return (
        f"is forming inside a {stage_str} environment - the trendline is "
        f"valid geometrically but the broader stage does not amplify its "
        f"institutional respect"
    )


def _touches_density_descriptor(touches: int, span_bars: int) -> str:
    if span_bars <= 0:
        return "a dense touch profile"
    density = touches / span_bars
    if density >= 0.10:
        return (
            f"a very dense touch profile (one touch every "
            f"{int(span_bars/touches)} bars on average)"
        )
    if density >= 0.05:
        return (
            f"a moderate touch profile (one touch every "
            f"{int(span_bars/touches)} bars on average)"
        )
    return (
        f"a sparse touch profile (one touch every "
        f"{int(span_bars/touches)} bars on average) - the trendline still "
        f"counts but each touch is precious"
    )


def _recency_descriptor(span_bars: int) -> str:
    if span_bars <= 20:
        return "very recent (last 4 weeks of daily action)"
    if span_bars <= 40:
        return "recent (1-2 months of action)"
    if span_bars <= 60:
        return "multi-month (2-3 months of action)"
    return "multi-quarter (3+ months of action)"


def _r_squared_quality_descriptor(r_squared: float) -> str:
    if r_squared >= 0.95:
        return "exceptional (near-perfect pivot alignment, institutional-grade)"
    if r_squared >= 0.85:
        return "strong (high-quality alignment, institutional algos trade against it)"
    if r_squared >= 0.75:
        return "solid (good alignment, well-respected by systematic flow)"
    return "adequate (passes the 0.7 quality bar, less institutionally weighted)"


def _trade_application_description(tt: str, line_at_now: float) -> str:
    if tt == "rising_support":
        return (
            f"to enter long on a touch and rejection of the rising support "
            f"line at ${line_at_now:.2f}, with a stop just below the line "
            f"and an upside target at the prior structural high inside the "
            f"uptrend"
        )
    if tt == "falling_resistance":
        return (
            f"to enter short on a touch and rejection of the falling "
            f"resistance line at ${line_at_now:.2f}, with a stop just "
            f"above the line and a downside target at the prior structural "
            f"low inside the downtrend"
        )
    return (
        f"to fade the horizontal level at ${line_at_now:.2f} on touches and "
        f"manage size as the range matures"
    )


def _through_direction(tt: str) -> str:
    if tt == "rising_support":
        return "below"
    if tt == "falling_resistance":
        return "above"
    return "through"


def _regime_context_sentence(context: dict, cand: dict) -> str:
    regime = context.get("regime", "current")
    if cand["trendline_type"] == "rising_support":
        return (
            f"In a {regime} regime, rising-support lines tend to attract "
            f"buy-the-dip flow on first touch, with the strongest hold rates "
            f"occurring when the broader tape is also trending up"
        )
    if cand["trendline_type"] == "falling_resistance":
        return (
            f"In a {regime} regime, falling-resistance lines tend to attract "
            f"fade-the-rally flow on first touch, with the strongest hold "
            f"rates occurring when the broader tape is also trending down"
        )
    return (
        f"In a {regime} regime, horizontal levels act as reference points "
        f"for two-sided positioning"
    )


# ---------------------------------------------------------------------------
# Detection builder
# ---------------------------------------------------------------------------

def _build_detection(
    bars: List[Bar],
    cand: dict,
    context: dict,
    window_bars: int,
    current_close: float,
    last_bar_idx: int,
) -> Detection:
    tt = cand["trendline_type"]
    direction = cand["direction"]
    line_at_now = cand["line_at_now"]
    touches = cand["touches"]
    r_squared = cand["r_squared"]
    validity = cand["validity"]
    span_bars = cand["span_bars"]
    slope_pct_per_bar = cand["slope_pct_per_bar"]
    slope = cand["slope"]
    pivots = cand["pivots"]

    window_start = max(0, last_bar_idx - _WINDOW_BARS + 1)

    # Levels
    if tt == "rising_support":
        entry = round(line_at_now * 1.005, 2)
        stop = round(line_at_now * 0.985, 2)
        target_raw = _derive_target(cand, bars, last_bar_idx, window_start)
        target = round(float(target_raw), 2) if target_raw is not None else None
        entry_condition = (
            f"long entry on touch and rejection of rising support at "
            f"${line_at_now:.2f}"
        )
        stop_basis = "1.5% below rising-support line"
        break_threshold = 1.0
    elif tt == "falling_resistance":
        entry = round(line_at_now * 0.995, 2)
        stop = round(line_at_now * 1.015, 2)
        target_raw = _derive_target(cand, bars, last_bar_idx, window_start)
        target = round(float(target_raw), 2) if target_raw is not None else None
        entry_condition = (
            f"short entry on touch and rejection of falling resistance at "
            f"${line_at_now:.2f}"
        )
        stop_basis = "1.5% above falling-resistance line"
        break_threshold = 1.0
    else:  # horizontal
        entry = round(line_at_now, 2)
        stop = None
        target = None
        entry_condition = (
            f"horizontal reference at ${line_at_now:.2f} - fade on touch, "
            f"manual stop placement required"
        )
        stop_basis = ""
        break_threshold = 1.0

    if target is not None and stop is not None:
        denom = abs(entry - stop)
        rr = round(abs(target - entry) / denom, 2) if denom > 0 else 0.0
    else:
        rr = 0.0

    # Distance from current close
    if current_close > 0:
        current_distance_pct_from_price = (
            (line_at_now - current_close) / current_close * 100.0
        )
    else:
        current_distance_pct_from_price = 0.0

    # Scoring
    confidence = _compute_confidence(touches, r_squared)
    geometry_score = _compute_geometry_score(r_squared)
    volume_score = 50.0
    context_score = _compute_context_score(cand, context)
    historical_score = 50.0

    # Anchors: p1, p2, plus current line value
    # NOTE: cand p1_t/p2_t are bar_index values (re-keyed). For chart rendering
    # we also pull the original t (unix seconds) by mapping back through bars.
    p1_bar_idx = int(cand["p1_t"])
    p2_bar_idx = int(cand["p2_t"])
    p1_t_unix = (
        int(bars[p1_bar_idx]["t"]) if 0 <= p1_bar_idx < len(bars)
        else int(bars[-1]["t"])
    )
    p2_t_unix = (
        int(bars[p2_bar_idx]["t"]) if 0 <= p2_bar_idx < len(bars)
        else int(bars[-1]["t"])
    )
    last_t_unix = int(bars[-1]["t"])
    anchors = [
        {"t": p1_t_unix, "price": float(cand["p1_price"])},
        {"t": p2_t_unix, "price": float(cand["p2_price"])},
        {"t": last_t_unix, "price": float(line_at_now)},
    ]
    pivot_ts = [int(p.get("orig_t", p.get("t", 0))) for p in pivots]

    last_bar = bars[-1]
    now = int(time.time())

    # Slope dollar value per bar
    slope_per_bar_dollars = slope  # price units per bar (re-keyed)

    # Annualized implied move (assuming 252 trading days)
    annualized_implied_move = slope_pct_per_bar * 252.0

    # Stop-related % buffer for narrative
    if tt == "rising_support":
        stop_buffer_pct = 1.5
    elif tt == "falling_resistance":
        stop_buffer_pct = 1.5
    else:
        stop_buffer_pct = 0.0

    # ---------- Narrative composition ----------
    tt_cap = _trendline_type_capitalized(tt)
    slope_interp = _slope_interpretation(tt, slope_pct_per_bar)
    pivot_desc = _pivot_type_descriptor(tt)
    h_or_l = _higher_or_lower(tt)
    acc_or_dist = _accumulation_or_distribution(tt)
    inst_actors = _institutional_actors(tt)
    action = _action_at_line(tt)
    alignment_desc = _alignment_with_stage_descriptor(cand, context)
    density_desc = _touches_density_descriptor(touches, span_bars)
    recency_desc = _recency_descriptor(span_bars)
    r2_desc = _r_squared_quality_descriptor(r_squared)
    trade_app = _trade_application_description(tt, line_at_now)
    through_dir = _through_direction(tt)
    regime_ctx = _regime_context_sentence(context, cand)

    headline = (
        f"{tt_cap} - {touches} touches over {span_bars} bars, "
        f"slope {slope_pct_per_bar:+.3f}%/bar, r2={r_squared:.3f}. "
        f"Current line value ${line_at_now:.2f}."
    )

    what_it_is = (
        f"This {tt.replace('_', ' ')} is identified by fitting a "
        f"least-squares regression line through {touches} swing pivots in "
        f"the recent {window_bars}-bar window. The line shows a slope of "
        f"{slope_pct_per_bar:+.4f}% per bar - for a {tt.replace('_', ' ')}, "
        f"this means {slope_interp}. The R-squared value of "
        f"{r_squared:.4f} reflects how cleanly the {touches} pivots align "
        f"with the fitted line; values above 0.8 indicate strong technical "
        f"validity, above 0.9 indicate exceptional alignment, and the "
        f"institutional-grade trendlines that algorithmic systems are "
        f"programmed to defend tend to cluster in the 0.85+ range. Major "
        f"trendlines are among the most-respected technical references "
        f"because they encode the directional bias of institutional "
        f"positioning: a {tt.replace('_', ' ')} indicates that "
        f"{pivot_desc} have systematically formed at progressively "
        f"{h_or_l} prices, demonstrating institutional {acc_or_dist} "
        f"into the move. The trendline's current value at "
        f"${line_at_now:.2f} represents the level that {inst_actors} will "
        f"likely {action}; price interacting with this line is one of the "
        f"highest-conviction reaction zones on the chart, and historical "
        f"studies of trendline interactions show first-touch hold rates of "
        f"55-70% rising to 75-85% on trendlines with r-squared above 0.85 "
        f"and four-plus touches."
    )

    why_it_matters = (
        f"This {tt.replace('_', ' ')} {alignment_desc} - when trendlines "
        f"align with the broader stage (rising support in Stage 2, falling "
        f"resistance in Stage 4), they receive the strongest institutional "
        f"respect because the line, the stage, and the systematic flow are "
        f"all pointing the same way. The {touches} touches over "
        f"{span_bars} bars represent {density_desc}, meaning the trendline "
        f"has been validated by {recency_desc} action and is therefore an "
        f"active reference rather than a stale relic. The R-squared of "
        f"{r_squared:.3f} is {r2_desc}, and the slope of "
        f"{slope_pct_per_bar:+.3f}%/bar implies an annualized "
        f"{annualized_implied_move:+.1f}% if extrapolated forward over 252 "
        f"trading days - useful context for setting realistic targets and "
        f"sanity-checking whether the trendline's pace is sustainable. "
        f"{regime_ctx}. Trendlines have a unique property compared to "
        f"horizontal support and resistance: they 'move' over time, meaning "
        f"the level they represent rises (for support) or falls (for "
        f"resistance) each bar - this creates dynamic reference levels that "
        f"institutional algos systematically buy or sell against, and it "
        f"also means a stop placed at today's line value is structurally "
        f"different from the same stop placed three sessions later."
    )

    target_phrase = (
        f"A measured target derived from prior structural extremes in the "
        f"current move sits at ${target:.2f} (risk/reward ~ {rr:.1f}:1)"
        if (target is not None and stop is not None) else
        "No structural target was derived inside the current window; "
        "consider higher-timeframe references"
    )

    what_to_watch_for = (
        f"For a {tt.replace('_', ' ')}: the ideal trade is {trade_app}. "
        f"Watch how price interacts with the line as it approaches: "
        f"rejection (immediate reversal with above-average volume on the "
        f"touch bar) confirms continued validity, while a clean break with "
        f"volume signals trend change. {target_phrase}. The line's slope of "
        f"{slope_pct_per_bar:+.3f}%/bar means the support/resistance level "
        f"changes by ~${abs(slope_per_bar_dollars):.4f}/bar - entries placed "
        f"today won't have the same reference price tomorrow, so trade "
        f"plans must refresh the line value each session. Use the line's "
        f"current value ${line_at_now:.2f} for fresh trades; do NOT use the "
        f"touch points from days ago because those bars have rolled off the "
        f"active reference. A break with weak volume often retests the line "
        f"from the other side ('throwback' or 'pullback') within 3-7 bars "
        f"and offers a second-chance entry in the new role; a break with "
        f"strong volume usually establishes the trend change immediately "
        f"and a throwback should NOT be expected. Watch for the line's "
        f"interaction with horizontal S/R levels - confluences where a "
        f"trendline meets a horizontal level are the strongest reaction "
        f"zones on the chart and produce the highest-probability trades."
    )

    failure_signal = (
        f"The trendline fails when price closes through it by ≥1% on "
        f"volume ≥1.5x the 20-bar average AND fails to recover within 3 "
        f"bars. Broken trendlines often act as the reverse role on retest "
        f"- broken support becomes resistance and broken resistance "
        f"becomes support - and this polarity inversion is one of the most "
        f"reliable phenomena in technical analysis. For this "
        f"{tt.replace('_', ' ')} at ${line_at_now:.2f}: a sustained close "
        f"{through_dir} the line by more than {break_threshold:.1f}% "
        f"confirms failure, with a tighter intraday trigger at the level "
        f"itself. Position sizing on trendline trades should reflect the "
        f"line's slope - wider stops are needed for high-slope lines (the "
        f"line moves quickly so stops on yesterday's level are vulnerable) "
        f"but the wider stop is compensated by faster target attainment "
        f"because the line itself is also moving toward the trade's profit "
        f"side. Trendline stops are not 'set and forget' - they require "
        f"manual adjustment each session to track the moving line value, "
        f"and a stop that is correct on Monday is too generous (or too "
        f"tight) by Friday. Failed trendlines, particularly those with "
        f"high touch counts ({touches} touches qualifies) and high "
        f"r-squared ({r_squared:.3f} qualifies), frequently produce strong "
        f"moves in the opposite direction because they trap the "
        f"institutional positioning that respected the line for weeks - "
        f"the failure itself becomes a setup for an aggressive counter-trend "
        f"trade."
    )

    extras = {
        "line_type": str(tt),
        "slope_pct_per_bar": round(float(slope_pct_per_bar), 4),
        "r_squared": round(float(r_squared), 4),
        "touches": int(touches),
        "validity": round(float(validity), 4),
        "span_bars": int(span_bars),
        "current_line_value": round(float(line_at_now), 4),
        "current_distance_pct_from_price": round(
            float(current_distance_pct_from_price), 3
        ),
        "raw_slope": round(float(slope), 6),
        "window_bars": int(window_bars),
    }

    detection: Detection = {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Major Trendline",
        "category": "structure",
        "direction": direction,
        "start_t": p1_t_unix,
        "end_t": int(last_bar["t"]),
        "pivot_ts": pivot_ts,
        "geometry": {
            "shape": "trendline_pair",
            "anchors": anchors,
            "extras": extras,
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


register(_PATTERN_ID, detect_major_trendlines)
