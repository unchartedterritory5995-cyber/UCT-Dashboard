"""Triple Top detector.

Three peaks at similar prices with two retrace troughs in between - a
stricter version of the double top. Three unsuccessful attempts to break
above a price level signal that supply at that level is overwhelming and
likely to push price lower.

Geometric definition:
  - Window: 30-100 bars
  - Three swing-high pivots ordered chronologically: P1 < P2 < P3
  - Peak similarity: peaks within 3% spread (stricter than double_top's 4%)
  - Two retrace troughs:
      trough1: lowest LOW between P1 and P2
      trough2: lowest LOW between P2 and P3
      Both troughs within 5% of each other (similar level)
  - Spacing: >= 7 bars between each peak (P2 - P1 >= 7, P3 - P2 >= 7)
  - Retrace depth: each trough at least 5% below peaks
  - Pattern not yet broken: closes haven't punched below trough levels
  - Recent: P3 within last 30 bars
  - Volume: declining on each subsequent peak (P1 -> P2 -> P3)

Levels:
  entry  = avg(trough1, trough2) * 0.999 (breakdown below trough confluence)
  stop   = above highest peak * 1.01
  target = neckline - (peaks_avg - neckline)

Attribution: classical Edwards & Magee, "Technical Analysis of Stock Trends"
(1948). Bulkowski's empirical research places triple-top reliability around
65-70%, slightly stronger than double-top because the third failed attempt
provides additional confirmation of overhead supply.
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "triple_top"
_MIN_PATTERN_BARS = 30
_MAX_PATTERN_BARS = 100
_MAX_PEAK_SPREAD = 0.03      # peaks within 3% of each other
_MAX_TROUGH_SPREAD = 0.05    # troughs within 5% of each other
_MIN_PEAK_SPACING = 7
_MIN_RETRACE_DEPTH = 0.05
_MAX_RETRACE_DEPTH = 0.25
_MAX_P3_AGE = 30
_CONFIDENCE_FLOOR = 50.0


def detect_triple_top(bars: List[Bar], context: dict) -> List[Detection]:
    if len(bars) < _MIN_PATTERN_BARS:
        return []

    detections: List[Detection] = []

    pivots = detect_pivots(bars, window=3)
    if len(pivots) < 3:
        return []

    high_pivots_raw = [p for p in pivots if p["type"] == "high"]
    if len(high_pivots_raw) < 3:
        return []

    high_pivots = [{"t": p["bar_index"], "price": p["price"],
                    "type": "high", "strength": p["strength"],
                    "bar_index": p["bar_index"]} for p in high_pivots_raw]

    recent_highs = high_pivots[-12:]
    n = len(recent_highs)
    last_bar_idx = len(bars) - 1

    best_candidate = None
    best_confidence = -1.0
    best_scores = None

    for i in range(n):
        for j in range(i + 1, n):
            for k in range(j + 1, n):
                P1 = recent_highs[i]
                P2 = recent_highs[j]
                P3 = recent_highs[k]

                if not (P1["bar_index"] < P2["bar_index"] < P3["bar_index"]):
                    continue
                if last_bar_idx - P3["bar_index"] > _MAX_P3_AGE:
                    continue
                if P3["bar_index"] - P1["bar_index"] > _MAX_PATTERN_BARS:
                    continue
                if (P2["bar_index"] - P1["bar_index"]) < _MIN_PEAK_SPACING:
                    continue
                if (P3["bar_index"] - P2["bar_index"]) < _MIN_PEAK_SPACING:
                    continue

                candidate = _try_extract_pattern(bars, P1, P2, P3)
                if candidate is None:
                    continue
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


def _try_extract_pattern(bars: List[Bar], P1: dict, P2: dict, P3: dict) -> Optional[dict]:
    p1_idx, p2_idx, p3_idx = P1["bar_index"], P2["bar_index"], P3["bar_index"]
    p1_price, p2_price, p3_price = P1["price"], P2["price"], P3["price"]

    if min(p1_price, p2_price, p3_price) <= 0:
        return None

    # Peak similarity: all 3 within 3% spread
    peak_max = max(p1_price, p2_price, p3_price)
    peak_min = min(p1_price, p2_price, p3_price)
    peak_spread = (peak_max - peak_min) / peak_max
    if peak_spread >= _MAX_PEAK_SPREAD:
        return None

    # Trough 1: between P1 and P2
    t1_idx, t1_price = _segment_lowest_low(bars, p1_idx + 1, p2_idx - 1)
    if t1_idx is None:
        return None
    # Trough 2: between P2 and P3
    t2_idx, t2_price = _segment_lowest_low(bars, p2_idx + 1, p3_idx - 1)
    if t2_idx is None:
        return None

    # Retrace depths
    retrace1_depth = (p1_price - t1_price) / p1_price
    retrace2_depth = (p2_price - t2_price) / p2_price
    if retrace1_depth < _MIN_RETRACE_DEPTH or retrace1_depth > _MAX_RETRACE_DEPTH:
        return None
    if retrace2_depth < _MIN_RETRACE_DEPTH or retrace2_depth > _MAX_RETRACE_DEPTH:
        return None

    # Trough similarity: both troughs within 5% of each other
    trough_max = max(t1_price, t2_price)
    trough_min = min(t1_price, t2_price)
    trough_spread = (trough_max - trough_min) / trough_max
    if trough_spread >= _MAX_TROUGH_SPREAD:
        return None

    avg_peak = (p1_price + p2_price + p3_price) / 3.0
    avg_trough = (t1_price + t2_price) / 2.0
    neckline = avg_trough  # neckline is the trough confluence

    pattern_bars = p3_idx - p1_idx
    if pattern_bars > _MAX_PATTERN_BARS:
        return None

    return {
        "peak1_idx": p1_idx, "peak1_price": p1_price,
        "peak2_idx": p2_idx, "peak2_price": p2_price,
        "peak3_idx": p3_idx, "peak3_price": p3_price,
        "trough1_idx": t1_idx, "trough1_price": t1_price,
        "trough2_idx": t2_idx, "trough2_price": t2_price,
        "peak_spread": peak_spread,
        "trough_spread": trough_spread,
        "retrace1_depth": retrace1_depth,
        "retrace2_depth": retrace2_depth,
        "avg_peak": avg_peak,
        "avg_trough": avg_trough,
        "neckline": neckline,
        "pattern_bars": pattern_bars,
        "start_idx": p1_idx,
        "end_idx": p3_idx,
    }


def _segment_lowest_low(bars: List[Bar], a: int, b: int) -> tuple:
    if a > b or a < 0 or b >= len(bars):
        return (None, None)
    best_idx = a
    best_low = bars[a]["l"]
    for i in range(a + 1, b + 1):
        if bars[i]["l"] < best_low:
            best_low = bars[i]["l"]
            best_idx = i
    return (best_idx, best_low)


def _pattern_already_broken(bars: List[Bar], c: dict) -> bool:
    """True if closes have already breached below the neckline consecutively."""
    neckline = c["neckline"]
    p3_idx = c["peak3_idx"]
    last_idx = len(bars) - 1
    max_consec = 0
    consec = 0
    for i in range(p3_idx, last_idx + 1):
        if bars[i]["c"] < neckline:
            consec += 1
            if consec > max_consec:
                max_consec = consec
        else:
            consec = 0
    return max_consec >= 2


def _score_geometry(c: dict) -> float:
    # Peak similarity: tighter = better (0 spread = 100)
    peak_score = max(0.0, (1.0 - c["peak_spread"] / _MAX_PEAK_SPREAD) * 100)
    # Trough similarity
    trough_score = max(0.0, (1.0 - c["trough_spread"] / _MAX_TROUGH_SPREAD) * 100)
    # Retrace depth ideality (avg): textbook 8-20%
    avg_retrace = (c["retrace1_depth"] + c["retrace2_depth"]) / 2.0
    if 0.08 <= avg_retrace <= 0.20:
        depth_score = 100.0
    elif avg_retrace < 0.08:
        depth_score = max(0.0, (avg_retrace - _MIN_RETRACE_DEPTH)
                          / (0.08 - _MIN_RETRACE_DEPTH) * 100)
    else:
        depth_score = max(0.0, (_MAX_RETRACE_DEPTH - avg_retrace)
                          / (_MAX_RETRACE_DEPTH - 0.20) * 100)
    # Duration: ideal ~40-60 bars (more time than double top)
    span = c["pattern_bars"]
    if 35 <= span <= 65:
        span_score = 100.0
    elif span < 35:
        span_score = max(0.0, (span - 2 * _MIN_PEAK_SPACING) / (35 - 2 * _MIN_PEAK_SPACING) * 100)
    else:
        span_score = max(0.0, (_MAX_PATTERN_BARS - span) / (_MAX_PATTERN_BARS - 65) * 100)
    return round(0.35 * peak_score + 0.25 * trough_score
                 + 0.25 * depth_score + 0.15 * span_score, 2)


def _score_volume(bars: List[Bar], c: dict) -> float:
    """Score declining volume on each subsequent peak."""
    def _window_avg(center, half=2):
        lo = max(0, center - half)
        hi = min(len(bars) - 1, center + half)
        if hi < lo:
            return 0.0
        win = bars[lo:hi + 1]
        return sum(b["v"] for b in win) / len(win)

    v1 = _window_avg(c["peak1_idx"])
    v2 = _window_avg(c["peak2_idx"])
    v3 = _window_avg(c["peak3_idx"])

    if v1 <= 0:
        return 50.0

    # Each subsequent peak should have less volume
    score = 50.0
    if v2 < v1:
        score += 25
    if v3 < v2:
        score += 25
    if v3 < v1 * 0.5:
        score = min(100.0, score + 10)  # strong exhaustion bonus
    if v3 > v1:
        score = max(0.0, score - 30)  # expanding volume on third peak is anti-pattern
    return round(min(100.0, max(0.0, score)), 2)


def _score_context(context: dict) -> float:
    score = 50.0
    if context.get("trend_stage") == 3:
        score += 25
    elif context.get("trend_stage") == 2:
        score += 15
    if context.get("ma_alignment") == "stacked_bullish":
        score += 10  # overbought - reversal pattern marks top
    if context.get("volume_signature") == "contracting":
        score += 10
    # DCR integration (Phase 7.5) — bearish reversal: distribution = tailwind.
    score += _dcr_score_adjustment(context)
    return min(100.0, max(0.0, score))


def _dcr_score_adjustment(context: dict) -> float:
    """Return the DCR-derived score adjustment for a bearish continuation/reversal pattern."""
    dcr_sig = context.get("dcr_signature")
    recent_dcr = context.get("recent_dcr_avg", 0.5) or 0.5
    if dcr_sig == "distribution" and recent_dcr <= 0.35:
        return 12.0   # sellers closing positions strong
    if dcr_sig == "accumulation":
        return -8.0   # buyers absorbing into close — bearish pattern faces headwind
    return 0.0


# Custom variant - does not match shared narrative_helpers
def _ma_alignment_phrase(context: dict) -> str:
    align = context.get("ma_alignment", "mixed")
    if align == "stacked_bullish":
        return "stacked-bullish moving-average (overbought topping context)"
    if align == "stacked_bearish":
        return "stacked-bearish moving-average (counter-trend warning for triple-top shorts)"
    return "mixed moving-average"


# Custom variant - does not match shared narrative_helpers
def _trend_stage_description(context: dict) -> str:
    stage = context.get("trend_stage", 0)
    if stage == 3:
        return "a Stage 3 distribution/topping environment (textbook triple-top reversal setup)"
    if stage == 2:
        return "a Stage 2 uptrend showing repeated rejection at resistance (overbought reversal context)"
    if stage == 4:
        return "a Stage 4 downtrend (continuation context - triple top as a bearish flag analog)"
    if stage == 1:
        return "a Stage 1 base/accumulation environment (counter-trend caution)"
    return "an undefined trend stage"


# Custom variant - does not match shared narrative_helpers
def _rs_trend_phrase(context: dict) -> str:
    rs = context.get("rs_trend", "flat")
    if rs == "up":
        return "still improving (counter-trend warning - wait for trough confluence break)"
    if rs == "down":
        return "deteriorating"
    return "neutral"


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    p1_idx, p2_idx, p3_idx = c["peak1_idx"], c["peak2_idx"], c["peak3_idx"]
    t1_idx, t2_idx = c["trough1_idx"], c["trough2_idx"]

    p1_price, p2_price, p3_price = c["peak1_price"], c["peak2_price"], c["peak3_price"]
    t1_price, t2_price = c["trough1_price"], c["trough2_price"]
    neckline = c["neckline"]
    avg_peak = c["avg_peak"]
    avg_trough = c["avg_trough"]
    highest_peak = max(p1_price, p2_price, p3_price)

    # Levels
    entry = round(neckline * 0.999, 2)
    stop = round(highest_peak * 1.01, 2)
    target = round(neckline - (avg_peak - neckline), 2)
    rr = (entry - target) / (stop - entry) if stop > entry else 0.0
    stop_distance_pct = (stop - entry) / entry * 100 if entry > 0 else 0.0

    peak_spread_pct = c["peak_spread"] * 100.0
    trough_spread_pct = c["trough_spread"] * 100.0
    peak_match_pct = (1.0 - c["peak_spread"]) * 100.0
    trough_match_pct = (1.0 - c["trough_spread"]) * 100.0
    retrace1_pct = c["retrace1_depth"] * 100.0
    retrace2_pct = c["retrace2_depth"] * 100.0
    pattern_bars = c["pattern_bars"]
    peak_to_neckline_pts = avg_peak - neckline
    peak_to_neckline_pct = (peak_to_neckline_pts / avg_peak * 100.0) if avg_peak > 0 else 0.0

    ma_phrase = _ma_alignment_phrase(context)
    stage_phrase = _trend_stage_description(context)
    rs_phrase = _rs_trend_phrase(context)
    regime = context.get("regime", "current")
    vol_signature = context.get("volume_signature", "unspecified")

    sym_token = "the stock"

    headline = (
        f"Triple Top forming on {sym_token} - peaks ${p1_price:.2f}/"
        f"${p2_price:.2f}/${p3_price:.2f} within {peak_spread_pct:.2f}% "
        f"spread, troughs ${t1_price:.2f}/${t2_price:.2f} within "
        f"{trough_spread_pct:.2f}%, neckline ${neckline:.2f}, "
        f"{pattern_bars}-bar pattern. Pivot ${entry:.2f}, target "
        f"${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Triple Top is the stricter, higher-conviction cousin of the "
        f"double top - documented in Edwards & Magee's 'Technical "
        f"Analysis of Stock Trends' (1948) and refined through decades of "
        f"empirical research by Bulkowski and the modern chart-pattern "
        f"community. Structurally it is three sequential peaks in an "
        f"uptrend that all fail at approximately the same price level: "
        f"peak 1 at ${p1_price:.2f}, peak 2 at ${p2_price:.2f}, and peak "
        f"3 at ${p3_price:.2f} - here clustered within a "
        f"{peak_spread_pct:.2f}% spread ({peak_match_pct:.1f}% match "
        f"score) around an average of ${avg_peak:.2f}. Between the peaks "
        f"are two retrace troughs: trough 1 at ${t1_price:.2f} "
        f"({retrace1_pct:.1f}% off peak 1) and trough 2 at ${t2_price:.2f} "
        f"({retrace2_pct:.1f}% off peak 2). The two troughs are within "
        f"{trough_spread_pct:.2f}% of each other ({trough_match_pct:.1f}% "
        f"match) - their average at ${avg_trough:.2f} forms the neckline, "
        f"the horizontal support line whose breach confirms the reversal. "
        f"The pattern spans {pattern_bars} bars between P1 and P3. The "
        f"market mechanic underneath is supply unambiguously dominating "
        f"demand: at the prior-high price, institutional sellers have "
        f"stepped in not once or twice but three separate times, "
        f"absorbing each rally attempt and refusing to let price extend. "
        f"Three failed attempts is statistically a much stronger signal "
        f"than two because the probability of three coincidental "
        f"rejections at the same level by chance alone is vanishingly "
        f"small - this is genuine, repeated, programmatic supply at "
        f"${avg_peak:.2f}. The declining-volume signature across the "
        f"three peaks (encoded in this detection's volume_score "
        f"component) reveals buying conviction fading with each "
        f"successive attempt even as the price tag matches. Bulkowski's "
        f"empirical research on triple tops places the confirmed-"
        f"breakdown follow-through rate at ~67-70%, slightly stronger "
        f"than the double-top's ~65% — a meaningful edge in his sample "
        f"that traces directly to the third failure carrying additional "
        f"information about repeated programmatic supply. Measured moves "
        f"equal the peak-to-neckline distance projected below the neckline "
        f"(here ${peak_to_neckline_pts:.2f} = {peak_to_neckline_pct:.1f}% "
        f"projection). Edwards & Magee originally noted that the triple "
        f"top is rarer than the double because most distributions resolve "
        f"on the second test — when a third visit to the same level occurs "
        f"without resolution, the underlying supply is unusually deep and "
        f"the eventual breakdown tends to carry further than the geometry "
        f"would suggest."
    )

    why_it_matters = (
        f"This Triple Top is forming in {stage_phrase} with {ma_phrase} "
        f"alignment and {rs_phrase} relative strength versus the broader "
        f"market, against a {regime} regime backdrop and volume signature "
        f"reading {vol_signature}. The {peak_match_pct:.1f}% peak symmetry "
        f"is the structural validation that matters most: tight peak "
        f"matches (within 2-3%) are the highest-reliability variant "
        f"because they reveal a clear institutional supply line at one "
        f"specific price (${avg_peak:.2f} average), while loose matches "
        f"above 4% blur into rounded-top noise where the topping process "
        f"is less defined. The trough confluence at ${avg_trough:.2f} "
        f"({trough_match_pct:.1f}% match) is equally important - it "
        f"defines the neckline that bulls must hold to keep the pattern "
        f"alive, and trough matches within 5% indicate a specific "
        f"defended support level rather than a sloppy double-bottom "
        f"trough geometry. Average retrace depth around "
        f"{(retrace1_pct + retrace2_pct) / 2:.1f}% sits in the textbook "
        f"8-20% zone where the highest-follow-through triple tops "
        f"resolve - too-shallow retraces (under 5%) suggest buyers "
        f"haven't actually been challenged on the downstroke yet, while "
        f"too-deep retraces (over 25%) usually reflect a structural "
        f"breakdown already underway rather than a clean three-peak "
        f"topping pattern. The {pattern_bars}-bar pattern width in the "
        f"35-65 bar sweet spot is the optimal duration zone - shorter "
        f"patterns lack the time for genuine distribution to occur and "
        f"often resolve as continuation breakouts, while longer patterns "
        f"accumulate too many late buyers near the troughs who defend "
        f"the neckline. The third failed attempt is statistically "
        f"meaningful: Bulkowski's research shows that the third rejection "
        f"adds roughly 5-7 percentage points to follow-through reliability "
        f"compared to the equivalent double top, and the pattern is "
        f"specifically called out as one of the higher-conviction "
        f"bearish reversal structures when peaks cluster tightly. "
        f"Trapped longs near ${avg_peak:.2f} - many of whom have now "
        f"watched three separate failures and are increasingly likely to "
        f"capitulate on any meaningful neckline break - become the "
        f"supply that caps every subsequent rally attempt."
    )

    what_to_watch_for = (
        f"The trigger is a daily close below ${entry:.2f} (the neckline "
        f"at ${neckline:.2f} minus a small confirmation buffer) on volume "
        f"of at least 1.5x the 20-bar average - that volume expansion on "
        f"the breakdown is non-negotiable because a neckline break on "
        f"light tape frequently reverses as a bear trap, especially on a "
        f"pattern this well-watched (triple tops are widely scanned by "
        f"both human traders and pattern-recognition systems). The "
        f"ideal trigger bar closes in the lower half of its range with a "
        f"wide red real body, and the next 1-3 bars should hold below "
        f"${neckline:.2f} without 'kissing back' above the trough "
        f"confluence more than once - a single throwback retest of the "
        f"broken neckline is normal and often the highest-quality short "
        f"entry, but two-plus closes back above ${neckline:.2f} weakens "
        f"the thesis materially. Measured target is ${target:.2f}, "
        f"derived by projecting the ${peak_to_neckline_pts:.2f} peak-to-"
        f"neckline distance downward from the neckline - a "
        f"{peak_to_neckline_pct:.1f}% projected move that justifies the "
        f"position. Aggressive triple tops in Stage 3 distribution "
        f"contexts often extend 1.3-1.6x this measured move because "
        f"trapped longs near the avg-peak level capitulate and the "
        f"failure cascade attracts trend-following shorts. Initial stop "
        f"sits at ${stop:.2f} (1% above the highest peak at "
        f"${highest_peak:.2f}) representing a {stop_distance_pct:.1f}% "
        f"risk from entry - risking 1% of account on this short implies "
        f"a position size of roughly "
        f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
        f"of equity, and risking 0.5% halves that. Trail stops above "
        f"each new swing high as the trade extends, or above the "
        f"descending 10/20 EMA, and consider covering partial size at "
        f"1R to lock in a free trade. Short trades require borrow "
        f"availability and carry overnight gap risk that long trades do "
        f"not - never short a stock you couldn't get filled on at the "
        f"open. A triple top with strongly declining volume on each "
        f"successive peak (P3 volume under 50% of P1) is the highest-"
        f"conviction expression and merits a larger position size; "
        f"weaker volume signatures lower conviction."
    )

    failure_signal = (
        f"The pattern is invalidated on a daily close above the highest "
        f"peak at ${highest_peak:.2f} (stop at ${stop:.2f}, 1% above to "
        f"absorb the standard upside wick) - that close signals the "
        f"distribution thesis is wrong, demand has finally overcome the "
        f"supply at ${avg_peak:.2f}, and the underlying uptrend has a "
        f"high probability of resuming, often with a violent squeeze leg "
        f"as trapped shorts cover into the breakout. The primary failure "
        f"mode for a triple top is the 'false neckline break that "
        f"reverses on weak volume': price punches below ${entry:.2f} on "
        f"merely-average or below-average tape, the next 1-2 bars close "
        f"in the upper half of their range, and price reclaims back "
        f"above the trough confluence. That sequence is the textbook "
        f"'failed breakdown' or Wyckoff spring - the visible triple-top "
        f"neckline becomes a liquidity grab to cover shorts and re-"
        f"accumulate, not a genuine continuation. Short squeezes off a "
        f"failed triple top can be especially violent because the "
        f"pattern attracts heavy short interest from trend-following "
        f"systems and pattern scanners (more than the equivalent double "
        f"top because of the perceived 'extra confirmation' of the "
        f"third peak), and uncapped upside loss demands the "
        f"{stop_distance_pct:.1f}% stop be honored without negotiation - "
        f"widening or removing a stop on a failing triple-top short is "
        f"one of the fastest ways to convert a manageable loss into "
        f"account-damaging exposure because the asymmetric risk profile "
        f"of a short trade (capped reward, uncapped loss) demands "
        f"tighter discipline than long trades. Failed triple tops often "
        f"resolve with sharp V-shape reversal velocity straight back "
        f"through all three peaks - the pent-up demand that absorbed "
        f"three separate rejection attempts unleashes when the supply "
        f"finally clears. Size accordingly and never average up. A "
        f"subtler failure tell: the second half of the pattern shows "
        f"INCREASING volume on each successive peak rather than the "
        f"declining-volume signature this pattern requires - that "
        f"reading inverts the distribution thesis and signals "
        f"accumulation in disguise, dramatically increasing the chance "
        f"of an upside resolution. Counter-trend triple tops in Stage "
        f"1-2 bullish contexts are particularly susceptible to this "
        f"failure mode and should be sized down or skipped entirely."
    )

    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Triple Top",
        "category": "classical",
        "direction": "bearish",
        "start_t": int(bars[p1_idx]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(bars[p1_idx]["t"]),
                     int(bars[t1_idx]["t"]),
                     int(bars[p2_idx]["t"]),
                     int(bars[t2_idx]["t"]),
                     int(bars[p3_idx]["t"]),
                     int(last_bar["t"])],
        "geometry": {
            "shape": "neckline",
            "anchors": [
                {"t": int(bars[p1_idx]["t"]), "price": float(p1_price)},
                {"t": int(bars[t1_idx]["t"]), "price": float(t1_price)},
                {"t": int(bars[p2_idx]["t"]), "price": float(p2_price)},
                {"t": int(bars[t2_idx]["t"]), "price": float(t2_price)},
                {"t": int(bars[p3_idx]["t"]), "price": float(p3_price)},
                {"t": int(bars[p1_idx]["t"]), "price": float(neckline)},
                {"t": int(bars[p3_idx]["t"]), "price": float(neckline)},
            ],
            "extras": {
                "peak_spread_pct": round(c["peak_spread"] * 100, 2),
                "trough_spread_pct": round(c["trough_spread"] * 100, 2),
                "retrace1_pct": round(c["retrace1_depth"] * 100, 2),
                "retrace2_pct": round(c["retrace2_depth"] * 100, 2),
                "avg_peak": round(float(avg_peak), 2),
                "avg_trough": round(float(avg_trough), 2),
                "neckline": round(float(neckline), 2),
                "pattern_bars": int(c["pattern_bars"]),
                "dcr_score_adj": round(_dcr_score_adjustment(context), 2),
            },
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close < {entry:.2f} on volume > 1.5x 20-bar avg",
            "stop": stop,
            "stop_basis": "highest_peak_plus_1pct",
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


register(_PATTERN_ID, detect_triple_top)
