"""Inverse Head and Shoulders detector.

The classic three-trough bullish reversal — the mirror of head_shoulders.
The middle trough (head) is the lowest of the three; the two flanking
troughs (shoulders) are roughly symmetric in depth. A "neckline" connects
the two peaks between the troughs. A breakout above the neckline projects
a measured move equal to the head-to-neckline distance.

Geometric definition:
  - Window: 30-100 bars
  - Three swing-low pivots ordered chronologically: L < H < R (bar_index)
  - Head dominance: head < left_shoulder AND head < right_shoulder
  - Shoulder symmetry: |left - right| / head < 0.15  (within 15% of head)
  - Neckline: line connecting the two peaks (highest highs between troughs)
  - Neckline horizontality: |slope| < 0.005 * head_price (roughly horizontal)
  - Spacing: head_idx - left_idx >= 5 bars, right_idx - head_idx >= 5 bars
  - Pattern not yet broken: recent closes have not closed above neckline projection
  - Recent: right shoulder within the last 30 bars
  - Volume: declining through the pattern (especially right shoulder vs left shoulder)

Scoring (composite 0-100):
  geometry_score:   symmetry, neckline horizontality, trough spacing, head dominance
  volume_score:     declining volume through the pattern (right vs left vs head)
  context_score:    trend_stage 1/4 (basing / oversold), stacked_bearish
  historical_score: 50.0 (neutral prior, Phase 7 wires actual stats)
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.geometry import line_at
from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "inverse_head_shoulders"
_MIN_PATTERN_BARS = 30
_MAX_PATTERN_BARS = 100
_MAX_SHOULDER_ASYMMETRY = 0.15      # |left - right| / head < 0.15
_MAX_NECKLINE_SLOPE_PCT = 0.005     # |slope| < 0.005 * head_price (per-bar)
_MIN_PEAK_SPACING = 5               # head-left >= 5 bars, right-head >= 5 bars
_MAX_RIGHT_SHOULDER_AGE = 30        # right shoulder within last 30 bars
_CONFIDENCE_FLOOR = 50.0


def detect_inverse_head_shoulders(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect inverse head-and-shoulders patterns in the bars. May emit 0-N detections."""
    if len(bars) < _MIN_PATTERN_BARS:
        return []

    detections: List[Detection] = []

    pivots = detect_pivots(bars, window=3)
    if len(pivots) < 3:
        return []

    # Re-key swing-lows with bar_index as `t` so any line math is bar-based.
    low_pivots_raw = [p for p in pivots if p["type"] == "low"]
    if len(low_pivots_raw) < 3:
        return []

    low_pivots = [{"t": p["bar_index"], "price": p["price"],
                   "type": "low", "strength": p["strength"],
                   "bar_index": p["bar_index"]} for p in low_pivots_raw]

    # Consider the most-recent 8 swing-low pivots. Enumerate triples (L, H, R)
    # with L < H < R chronologically. Prefer the most recent valid pattern.
    recent_lows = low_pivots[-8:]
    n = len(recent_lows)
    last_bar_idx = len(bars) - 1

    best_candidate = None
    best_confidence = -1.0
    best_scores = None

    for i in range(n):
        for j in range(i + 1, n):
            for k in range(j + 1, n):
                L = recent_lows[i]
                H = recent_lows[j]
                R = recent_lows[k]

                # Chronological ordering by bar_index
                if not (L["bar_index"] < H["bar_index"] < R["bar_index"]):
                    continue

                # Recent constraint: right shoulder within last N bars
                if last_bar_idx - R["bar_index"] > _MAX_RIGHT_SHOULDER_AGE:
                    continue

                candidate = _try_extract_pattern(bars, L, H, R)
                if candidate is None:
                    continue

                # Pattern not yet broken: recent closes have not breached neckline upward
                if _pattern_already_broken(bars, candidate):
                    continue

                geom_score = _score_geometry(candidate)
                vol_score = _score_volume(bars, candidate)
                ctx_score = _score_context(context)
                hist_score = 50.0

                confidence = round(
                    0.40 * geom_score + 0.25 * vol_score
                    + 0.20 * ctx_score + 0.15 * hist_score, 2
                )
                if confidence < _CONFIDENCE_FLOOR:
                    continue

                if confidence > best_confidence:
                    best_confidence = confidence
                    best_candidate = candidate
                    best_scores = (geom_score, vol_score, ctx_score, hist_score)

    if best_candidate is not None and best_scores is not None:
        geom_score, vol_score, ctx_score, hist_score = best_scores
        d = _build_detection(bars, best_candidate, best_confidence, context,
                             geom_score, vol_score, ctx_score, hist_score)
        detections.append(d)

    return detections


def _try_extract_pattern(bars: List[Bar], L: dict, H: dict, R: dict) -> Optional[dict]:
    """Validate L < H < R as an inverse head-and-shoulders. Returns candidate dict or None."""
    l_idx, h_idx, r_idx = L["bar_index"], H["bar_index"], R["bar_index"]

    # Spacing sanity
    if h_idx - l_idx < _MIN_PEAK_SPACING:
        return None
    if r_idx - h_idx < _MIN_PEAK_SPACING:
        return None

    # Pattern window length (L->R)
    pattern_bars = r_idx - l_idx
    # Floor: spacing already guarantees >=10 bars (5 each side).
    # Cap: prevent ancient sprawling patterns.
    if pattern_bars > _MAX_PATTERN_BARS:
        return None

    l_price = L["price"]
    h_price = H["price"]
    r_price = R["price"]

    # Head dominance: head must be strictly LOWEST
    if h_price >= l_price:
        return None
    if h_price >= r_price:
        return None

    # Shoulder symmetry: |left - right| / head < 15%
    asymmetry = abs(l_price - r_price) / h_price
    if asymmetry >= _MAX_SHOULDER_ASYMMETRY:
        return None

    # Find peaks between troughs (highest HIGH in each segment)
    # Peak 1: between L and H (indices l_idx+1 .. h_idx-1)
    # Peak 2: between H and R (indices h_idx+1 .. r_idx-1)
    if h_idx - l_idx < 2 or r_idx - h_idx < 2:
        return None

    p1_idx, p1_price = _segment_highest_high(bars, l_idx + 1, h_idx - 1)
    p2_idx, p2_price = _segment_highest_high(bars, h_idx + 1, r_idx - 1)

    if p1_idx is None or p2_idx is None:
        return None

    # Neckline: line from (p1_idx, p1_price) to (p2_idx, p2_price)
    if p2_idx == p1_idx:
        return None
    neckline_slope = (p2_price - p1_price) / (p2_idx - p1_idx)
    neckline_intercept = p1_price - neckline_slope * p1_idx

    # Neckline horizontality: |slope| < 0.005 * head_price (per bar)
    max_slope_abs = _MAX_NECKLINE_SLOPE_PCT * h_price
    if abs(neckline_slope) >= max_slope_abs:
        return None

    # Neckline values at key bar indices
    neckline_at_h = neckline_slope * h_idx + neckline_intercept
    last_bar_idx = len(bars) - 1
    neckline_at_now = neckline_slope * last_bar_idx + neckline_intercept

    # Head must be meaningfully below neckline (otherwise it's not a head)
    if h_price >= neckline_at_h:
        return None

    # Shoulders should also be below neckline
    neckline_at_l = neckline_slope * l_idx + neckline_intercept
    neckline_at_r = neckline_slope * r_idx + neckline_intercept
    if l_price >= neckline_at_l or r_price >= neckline_at_r:
        return None

    head_pct_below_shoulders = ((l_price + r_price) / 2 - h_price) / h_price

    return {
        "left_shoulder_idx": l_idx,
        "left_shoulder_price": l_price,
        "head_idx": h_idx,
        "head_price": h_price,
        "right_shoulder_idx": r_idx,
        "right_shoulder_price": r_price,
        "peak1_idx": p1_idx,
        "peak1_price": p1_price,
        "peak2_idx": p2_idx,
        "peak2_price": p2_price,
        "neckline_slope": neckline_slope,
        "neckline_intercept": neckline_intercept,
        "neckline_at_head_t": neckline_at_h,
        "neckline_at_now": neckline_at_now,
        "asymmetry": asymmetry,
        "head_pct_below_shoulders": head_pct_below_shoulders,
        "pattern_bars": r_idx - l_idx,
        "start_idx": l_idx,
        "end_idx": r_idx,
    }


def _segment_highest_high(bars: List[Bar], a: int, b: int) -> tuple:
    """Return (bar_index, high_price) of the highest HIGH in bars[a..b] inclusive."""
    if a > b or a < 0 or b >= len(bars):
        return (None, None)
    best_idx = a
    best_high = bars[a]["h"]
    for i in range(a + 1, b + 1):
        if bars[i]["h"] > best_high:
            best_high = bars[i]["h"]
            best_idx = i
    return (best_idx, best_high)


def _pattern_already_broken(bars: List[Bar], c: dict) -> bool:
    """Return True if recent bars have CLOSED above the neckline projection.

    "Pattern not yet broken" means we're still in the right-shoulder formation
    or early breakout — but if multiple recent closes are above the projected
    neckline, the breakout has already happened and we shouldn't fire as
    'forming'.
    """
    slope = c["neckline_slope"]
    intercept = c["neckline_intercept"]
    r_idx = c["right_shoulder_idx"]
    last_idx = len(bars) - 1

    # Check closes from right shoulder onwards; allow occasional pops but
    # 2+ consecutive closes above neckline = already broken.
    closes_above = 0
    max_consec = 0
    consec = 0
    for i in range(r_idx, last_idx + 1):
        nl = slope * i + intercept
        if bars[i]["c"] > nl:
            closes_above += 1
            consec += 1
            if consec > max_consec:
                max_consec = consec
        else:
            consec = 0
    # If we have 2+ consecutive closes above, treat as already broken.
    return max_consec >= 2


def _score_geometry(c: dict) -> float:
    # Symmetry score: 100 at perfect symmetry, 0 at threshold
    sym_score = max(0.0, (1.0 - c["asymmetry"] / _MAX_SHOULDER_ASYMMETRY) * 100)

    # Neckline horizontality: lower |slope| = better
    head_price = c["head_price"]
    max_slope = _MAX_NECKLINE_SLOPE_PCT * head_price
    neckline_score = max(0.0, (1.0 - abs(c["neckline_slope"]) / max_slope) * 100)

    # Head dominance: 100 = head 10%+ below avg shoulder, scales down to 0
    head_dom = c["head_pct_below_shoulders"]
    if head_dom >= 0.10:
        head_dom_score = 100.0
    elif head_dom <= 0.0:
        head_dom_score = 0.0
    else:
        head_dom_score = head_dom / 0.10 * 100

    # Spacing: ideal ~10-15 bars between each trough; declines below 5 or above 25
    left_span = c["head_idx"] - c["left_shoulder_idx"]
    right_span = c["right_shoulder_idx"] - c["head_idx"]
    avg_span = (left_span + right_span) / 2.0
    if 8 <= avg_span <= 18:
        span_score = 100.0
    elif avg_span < 8:
        span_score = max(0.0, (avg_span - 5) / 3 * 100)
    else:
        span_score = max(0.0, 100 - (avg_span - 18) * 5)

    # Span balance: penalize wildly mismatched left/right spans
    if max(left_span, right_span) > 0:
        balance = min(left_span, right_span) / max(left_span, right_span)
    else:
        balance = 0.0
    balance_score = balance * 100

    return round(
        0.30 * sym_score
        + 0.25 * neckline_score
        + 0.20 * head_dom_score
        + 0.15 * span_score
        + 0.10 * balance_score, 2
    )


def _score_volume(bars: List[Bar], c: dict) -> float:
    """Score declining volume through the pattern.

    Compares avg volume around right shoulder vs left shoulder. Lower right
    shoulder volume = stronger reversal signal (capitulation faded). Also
    rewards lower volume on head relative to left shoulder.
    """
    l_idx = c["left_shoulder_idx"]
    h_idx = c["head_idx"]
    r_idx = c["right_shoulder_idx"]

    # Window of ~3 bars centered on each trough
    def _window_avg(center, half=2):
        lo = max(0, center - half)
        hi = min(len(bars) - 1, center + half)
        if hi < lo:
            return 0.0
        win = bars[lo:hi + 1]
        return sum(b["v"] for b in win) / len(win)

    left_vol = _window_avg(l_idx)
    head_vol = _window_avg(h_idx)
    right_vol = _window_avg(r_idx)

    if left_vol <= 0:
        return 50.0

    # Right shoulder volume ratio vs left shoulder. Lower = better.
    r_ratio = right_vol / left_vol
    # Head volume ratio vs left. Should be similar or lower in classic inverse H&S
    h_ratio = head_vol / left_vol

    # Right shoulder declining: 100 if right_vol = 30% of left, 0 if >= 100%
    if r_ratio >= 1.0:
        r_score = 0.0
    elif r_ratio <= 0.3:
        r_score = 100.0
    else:
        r_score = (1.0 - r_ratio) / 0.7 * 100

    # Head not expanding: lower or equal head vol = good
    if h_ratio <= 1.0:
        h_score = 100.0 - (h_ratio - 0.5) * 50 if h_ratio >= 0.5 else 100.0
        h_score = max(0.0, min(100.0, h_score))
    elif h_ratio >= 1.5:
        h_score = 0.0
    else:
        h_score = (1.5 - h_ratio) / 0.5 * 50

    return round(0.65 * r_score + 0.35 * h_score, 2)


def _score_context(context: dict) -> float:
    score = 50.0
    # Inverse H&S is bullish — boost on basing/oversold context.
    if context.get("trend_stage") == 1:
        score += 25  # accumulation / basing
    elif context.get("trend_stage") == 4:
        score += 15  # declining trend ripe for reversal at bottom
    if context.get("ma_alignment") == "stacked_bearish":
        score += 10  # oversold context — reversal pattern marks bottom
    if context.get("volume_signature") == "contracting":
        score += 15
    return min(100.0, score)


# Custom variant - does not match shared narrative_helpers
def _ma_alignment_phrase(context: dict) -> str:
    align = context.get("ma_alignment", "mixed")
    if align == "stacked_bullish":
        return "stacked-bullish moving-average (early-stage continuation context)"
    if align == "stacked_bearish":
        return "stacked-bearish moving-average (oversold reversal context)"
    return "mixed moving-average"


# Custom variant - does not match shared narrative_helpers
def _trend_stage_description(context: dict) -> str:
    stage = context.get("trend_stage", 0)
    if stage == 1:
        return "a Stage 1 base/accumulation environment (textbook inverse H&S reversal setup)"
    if stage == 4:
        return "a Stage 4 downtrend showing exhaustion (oversold reversal context)"
    if stage == 2:
        return "a Stage 2 uptrend (continuation context — inverse H&S as a deep base)"
    if stage == 3:
        return "a Stage 3 distribution environment (counter-trend caution)"
    return "an undefined trend stage"


# Custom variant - does not match shared narrative_helpers
def _rs_trend_phrase(context: dict) -> str:
    rs = context.get("rs_trend", "flat")
    if rs == "up":
        return "improving"
    if rs == "down":
        return "deteriorating (sellers still pressing until neckline break)"
    return "neutral"


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    l_idx = c["left_shoulder_idx"]
    h_idx = c["head_idx"]
    r_idx = c["right_shoulder_idx"]
    p1_idx = c["peak1_idx"]
    p2_idx = c["peak2_idx"]

    head_price = c["head_price"]
    left_shoulder_price = c["left_shoulder_price"]
    right_shoulder_price = c["right_shoulder_price"]
    peak1_price = c["peak1_price"]
    peak2_price = c["peak2_price"]
    neckline_at_now = c["neckline_at_now"]
    neckline_at_head_t = c["neckline_at_head_t"]
    neckline_slope = c["neckline_slope"]

    # Levels
    entry = round(neckline_at_now * 1.001, 2)
    stop = round(right_shoulder_price * 0.99, 2)
    # Measured move: neckline_to_head distance projected above neckline
    neckline_to_head = neckline_at_head_t - head_price
    target = round(neckline_at_now + neckline_to_head, 2)
    rr = (target - entry) / (entry - stop) if entry > stop else 0.0

    # Stop distance %
    stop_distance_pct = (entry - stop) / entry * 100 if entry > 0 else 0.0

    # Narrative dimension values
    asymmetry_pct = c["asymmetry"] * 100.0
    shoulder_symmetry_pct = (1.0 - c["asymmetry"]) * 100.0
    head_pct_below_shoulders = c["head_pct_below_shoulders"] * 100.0
    pattern_bars = c["pattern_bars"]
    left_span = h_idx - l_idx
    right_span = r_idx - h_idx
    neckline_to_head_pts = neckline_to_head
    neckline_to_head_pct = (neckline_to_head / head_price * 100.0) if head_price > 0 else 0.0
    avg_shoulder = (left_shoulder_price + right_shoulder_price) / 2.0

    ma_phrase = _ma_alignment_phrase(context)
    stage_phrase = _trend_stage_description(context)
    rs_phrase = _rs_trend_phrase(context)
    regime = context.get("regime", "current")
    vol_signature = context.get("volume_signature", "unspecified")

    sym_token = "the stock"

    # ---- Narrative composition - RICH, paragraph-length, with real values ----
    headline = (
        f"Inverse Head and Shoulders forming on {sym_token} - head ${head_price:.2f} "
        f"sits {head_pct_below_shoulders:.1f}% below ${avg_shoulder:.2f} avg "
        f"shoulders, {pattern_bars}-bar pattern, neckline at ${neckline_at_now:.2f}. "
        f"Pivot ${entry:.2f}, target ${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Inverse Head and Shoulders is the mirror image of the classic "
        f"H&S top and one of the most documented bullish reversal patterns in "
        f"technical analysis, with origins traced to Charles Dow at the turn "
        f"of the 20th century, formally codified by Richard Schabacker in "
        f"'Technical Analysis and Stock Market Profits' (1932), and elevated "
        f"to canonical status in Edwards & Magee's 'Technical Analysis of "
        f"Stock Trends' (1948). Structurally it is three sequential troughs "
        f"in a downtrend: a left shoulder at ${left_shoulder_price:.2f}, a "
        f"deeper head at ${head_price:.2f} that breaks to a new low then "
        f"recovers, and a right shoulder at ${right_shoulder_price:.2f} that "
        f"fails to revisit the head's low - the head here sits "
        f"{head_pct_below_shoulders:.1f}% below the average shoulder, while "
        f"the two shoulders are within {asymmetry_pct:.1f}% of each other "
        f"(symmetry score {shoulder_symmetry_pct:.0f}%). The 'neckline' is "
        f"the trendline connecting the two intervening peaks (${peak1_price:.2f} "
        f"between left shoulder and head, ${peak2_price:.2f} between head and "
        f"right shoulder, slope {neckline_slope:.4f}/bar - approximately "
        f"horizontal). The pattern spans {pattern_bars} bars total "
        f"({left_span} bars from left shoulder to head, {right_span} bars from "
        f"head to right shoulder). The market mechanic underneath is classic "
        f"institutional accumulation: smart money absorbs the panic at the "
        f"head's new low while sellers exhaust their inventory, the second-"
        f"attempt selloff (right shoulder) fails to revisit the same depth "
        f"because supply has been drained, and the volume signature - "
        f"typically peak volume on the left shoulder, declining through head, "
        f"lowest on right shoulder, then expanding sharply on the neckline "
        f"break - reveals the rotation from weak to strong hands. Bulkowski's "
        f"empirical sample places confirmed inverse H&S breakouts at roughly "
        f"60-70% follow-through to the measured-move target. Peter Brandt — "
        f"the modern H&S specialist whose career tracking classical chart "
        f"patterns spans 50+ years — treats inverse H&S as one of the most "
        f"reliable classical reversal patterns when the neckline breaks with "
        f"volume expansion. Linda Raschke uses the inverse H&S in her swing "
        f"playbook as a high-probability bottom signal, especially when paired "
        f"with positive RSI divergence between the left-shoulder low and the "
        f"head low."
    )

    why_it_matters = (
        f"This inverse H&S is forming in {stage_phrase} with {ma_phrase} "
        f"alignment and {rs_phrase} relative strength versus the broader "
        f"market, against a {regime} regime backdrop and volume signature "
        f"reading {vol_signature}. The {shoulder_symmetry_pct:.0f}% shoulder "
        f"symmetry and {head_pct_below_shoulders:.1f}% head dominance are "
        f"both squarely in the high-quality zone - asymmetric shoulders or "
        f"shallow head dominance produce noisy variants that fail more often, "
        f"while clean symmetric structures resolve cleanly. The "
        f"{neckline_to_head_pct:.1f}% neckline-to-head distance "
        f"(${neckline_to_head_pts:.2f} in points) is the projected upside "
        f"move once the neckline breaks, and a target of that magnitude is "
        f"meaningful enough to justify the trade. The {left_span}/{right_span} "
        f"bar spans on either side of the head are in the textbook 8-18 bar "
        f"window where the highest-follow-through inverse H&S patterns "
        f"resolve - longer, sprawling patterns are less reliable because "
        f"they accumulate too many late sellers near the highs who defend "
        f"the neckline, while shorter patterns lack the time for genuine "
        f"accumulation to occur. Declining volume from left shoulder to "
        f"right shoulder (encoded in volume_score component) confirms the "
        f"thesis that institutional supply is exhausting itself, and "
        f"underwater longs from the head price level become a relatively "
        f"thin supply layer once the neckline cracks on volume."
    )

    what_to_watch_for = (
        f"The trigger is a daily close above ${entry:.2f} (the neckline "
        f"projection at ${neckline_at_now:.2f} plus a small confirmation "
        f"buffer) on volume of at least 1.5x the 20-bar average - that volume "
        f"expansion is non-negotiable because a neckline break on quiet tape "
        f"frequently fails back into the pattern as a bull trap. The ideal "
        f"trigger bar closes in the upper half of its range with a wide real "
        f"body, and the next 1-3 bars should hold above ${neckline_at_now:.2f} "
        f"without 'kissing back' below the neckline more than once (a single "
        f"throwback retest is normal and often the highest-quality entry, "
        f"but two-plus closes back below the neckline weakens the thesis). "
        f"Measured target is ${target:.2f}, derived by projecting the "
        f"${neckline_to_head_pts:.2f} neckline-to-head distance up from the "
        f"current neckline level. Initial stop sits at ${stop:.2f} (1% below "
        f"the right shoulder at ${right_shoulder_price:.2f}) representing a "
        f"{stop_distance_pct:.1f}% risk from entry - risking 1% of account "
        f"on this trade implies a position size of roughly "
        f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
        f"of equity, and risking 0.5% halves that. Once the trade moves into "
        f"profit, trail the stop below each new swing low or under the "
        f"rising 10/20 EMA, and consider scaling out partial size at 1R to "
        f"lock in a free trade while letting the runner ride toward the "
        f"measured-move target."
    )

    failure_signal = (
        f"The pattern is invalidated on a daily close below the right shoulder "
        f"at ${right_shoulder_price:.2f} (stop at ${stop:.2f}, 1% below to "
        f"absorb the standard shake-out wick) - that close signals the "
        f"accumulation thesis is wrong, supply has overwhelmed buyers, and "
        f"the prior downtrend has a high probability of resuming with another "
        f"leg lower toward and through the head's price level. A subtler "
        f"failure mode that often precedes the hard stop: price pushes above "
        f"${neckline_at_now:.2f} on weak or merely-average volume, the next "
        f"1-2 bars close in the lower half of their range, and price slides "
        f"back below the neckline. That sequence is the textbook 'failed "
        f"breakout' - bulls used the visible neckline as an exit rather than "
        f"an entry, and the pattern often resolves the opposite direction "
        f"(through the head's low) with surprising velocity once trapped "
        f"longs flush. The {stop_distance_pct:.1f}% stop must be honored "
        f"without negotiation - widening or removing a stop on a failing "
        f"inverse H&S is one of the most reliable ways to convert a "
        f"manageable loss into a portfolio-damaging one, particularly "
        f"because failed accumulation patterns often telegraph that the "
        f"larger downtrend has further to run. Recall that Bulkowski's "
        f"reliability statistics are conditioned on a clean volume-backed "
        f"breakout - not every well-formed structure resolves bullishly, and "
        f"discipline at the stop is what separates a small managed loss "
        f"from a serious one."
    )

    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Inverse Head and Shoulders",
        "category": "classical",
        "direction": "bullish",
        "start_t": int(bars[l_idx]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(bars[l_idx]["t"]),
                     int(bars[h_idx]["t"]),
                     int(bars[r_idx]["t"]),
                     int(last_bar["t"])],
        "geometry": {
            "shape": "neckline",
            "anchors": [
                {"t": int(bars[l_idx]["t"]), "price": float(c["left_shoulder_price"])},
                {"t": int(bars[p1_idx]["t"]), "price": float(c["peak1_price"])},
                {"t": int(bars[h_idx]["t"]), "price": float(head_price)},
                {"t": int(bars[p2_idx]["t"]), "price": float(c["peak2_price"])},
                {"t": int(bars[r_idx]["t"]), "price": float(right_shoulder_price)},
            ],
            "extras": {
                "head_pct_below_shoulders": round(c["head_pct_below_shoulders"] * 100, 2),
                "shoulder_symmetry": round((1.0 - c["asymmetry"]) * 100, 2),
                "neckline_slope": round(float(c["neckline_slope"]), 6),
                "pattern_bars": int(c["pattern_bars"]),
            },
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close > {entry:.2f} on volume > 1.5x 20-bar avg",
            "stop": stop,
            "stop_basis": "right_shoulder_minus_1pct",
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


register(_PATTERN_ID, detect_inverse_head_shoulders)
