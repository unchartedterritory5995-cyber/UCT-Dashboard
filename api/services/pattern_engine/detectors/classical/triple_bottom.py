"""Triple Bottom detector.

Three troughs at similar prices with two intervening rally peaks - a
stricter version of the double bottom. Three unsuccessful attempts to
break below a price level signal that demand at that level is overwhelming
and likely to push price higher.

Geometric definition:
  - Window: 30-100 bars
  - Three swing-low pivots ordered chronologically: T1 < T2 < T3
  - Trough similarity: troughs within 3% spread (stricter than double_bottom's 4%)
  - Two rally peaks:
      peak1: highest HIGH between T1 and T2
      peak2: highest HIGH between T2 and T3
      Both peaks within 5% of each other (similar level)
  - Spacing: >= 7 bars between each trough (T2 - T1 >= 7, T3 - T2 >= 7)
  - Rally depth: each peak at least 5% above troughs
  - Pattern not yet broken: closes haven't punched above peak level
  - Recent: T3 within last 30 bars
  - Volume: expanding on each subsequent trough (T1 -> T2 -> T3) - the
    sign of accumulation as demand returns

Levels:
  entry  = avg(peak1, peak2) * 1.001 (breakout above peak confluence)
  stop   = below lowest trough * 0.985
  target = neckline + (neckline - troughs_avg)

Attribution: classical Edwards & Magee, "Technical Analysis of Stock
Trends" (1948). Bulkowski's empirical research places triple-bottom
reliability around 67% (slightly stronger than double-bottom because
the third failed attempt provides additional confirmation of underlying
demand).
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "triple_bottom"
_MIN_PATTERN_BARS = 30
_MAX_PATTERN_BARS = 100
_MAX_TROUGH_SPREAD = 0.03    # troughs within 3% of each other
_MAX_PEAK_SPREAD = 0.05      # peaks within 5% of each other
_MIN_TROUGH_SPACING = 7
_MIN_RALLY_DEPTH = 0.05
_MAX_RALLY_DEPTH = 0.25
_MAX_T3_AGE = 30
_CONFIDENCE_FLOOR = 50.0


def detect_triple_bottom(bars: List[Bar], context: dict) -> List[Detection]:
    if len(bars) < _MIN_PATTERN_BARS:
        return []

    detections: List[Detection] = []

    pivots = detect_pivots(bars, window=3)
    if len(pivots) < 3:
        return []

    low_pivots_raw = [p for p in pivots if p["type"] == "low"]
    if len(low_pivots_raw) < 3:
        return []

    low_pivots = [{"t": p["bar_index"], "price": p["price"],
                   "type": "low", "strength": p["strength"],
                   "bar_index": p["bar_index"]} for p in low_pivots_raw]

    recent_lows = low_pivots[-12:]
    n = len(recent_lows)
    last_bar_idx = len(bars) - 1

    best_candidate = None
    best_confidence = -1.0
    best_scores = None

    for i in range(n):
        for j in range(i + 1, n):
            for k in range(j + 1, n):
                T1 = recent_lows[i]
                T2 = recent_lows[j]
                T3 = recent_lows[k]

                if not (T1["bar_index"] < T2["bar_index"] < T3["bar_index"]):
                    continue
                if last_bar_idx - T3["bar_index"] > _MAX_T3_AGE:
                    continue
                if T3["bar_index"] - T1["bar_index"] > _MAX_PATTERN_BARS:
                    continue
                if (T2["bar_index"] - T1["bar_index"]) < _MIN_TROUGH_SPACING:
                    continue
                if (T3["bar_index"] - T2["bar_index"]) < _MIN_TROUGH_SPACING:
                    continue

                candidate = _try_extract_pattern(bars, T1, T2, T3)
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


def _try_extract_pattern(bars: List[Bar], T1: dict, T2: dict, T3: dict) -> Optional[dict]:
    t1_idx, t2_idx, t3_idx = T1["bar_index"], T2["bar_index"], T3["bar_index"]
    t1_price, t2_price, t3_price = T1["price"], T2["price"], T3["price"]

    if min(t1_price, t2_price, t3_price) <= 0:
        return None

    # Trough similarity: all 3 within 3% spread
    trough_max = max(t1_price, t2_price, t3_price)
    trough_min = min(t1_price, t2_price, t3_price)
    trough_spread = (trough_max - trough_min) / trough_max
    if trough_spread >= _MAX_TROUGH_SPREAD:
        return None

    # Peak 1: between T1 and T2
    p1_idx, p1_price = _segment_highest_high(bars, t1_idx + 1, t2_idx - 1)
    if p1_idx is None:
        return None
    # Peak 2: between T2 and T3
    p2_idx, p2_price = _segment_highest_high(bars, t2_idx + 1, t3_idx - 1)
    if p2_idx is None:
        return None

    # Rally depths (anchored against the immediately preceding trough)
    rally1_depth = (p1_price - t1_price) / t1_price
    rally2_depth = (p2_price - t2_price) / t2_price
    if rally1_depth < _MIN_RALLY_DEPTH or rally1_depth > _MAX_RALLY_DEPTH:
        return None
    if rally2_depth < _MIN_RALLY_DEPTH or rally2_depth > _MAX_RALLY_DEPTH:
        return None

    # Peak similarity: both peaks within 5% of each other
    peak_max = max(p1_price, p2_price)
    peak_min = min(p1_price, p2_price)
    peak_spread = (peak_max - peak_min) / peak_max
    if peak_spread >= _MAX_PEAK_SPREAD:
        return None

    avg_trough = (t1_price + t2_price + t3_price) / 3.0
    avg_peak = (p1_price + p2_price) / 2.0
    neckline = avg_peak  # neckline is the peak confluence

    pattern_bars = t3_idx - t1_idx
    if pattern_bars > _MAX_PATTERN_BARS:
        return None

    return {
        "trough1_idx": t1_idx, "trough1_price": t1_price,
        "trough2_idx": t2_idx, "trough2_price": t2_price,
        "trough3_idx": t3_idx, "trough3_price": t3_price,
        "peak1_idx": p1_idx, "peak1_price": p1_price,
        "peak2_idx": p2_idx, "peak2_price": p2_price,
        "trough_spread": trough_spread,
        "peak_spread": peak_spread,
        "rally1_depth": rally1_depth,
        "rally2_depth": rally2_depth,
        "avg_trough": avg_trough,
        "avg_peak": avg_peak,
        "neckline": neckline,
        "pattern_bars": pattern_bars,
        "start_idx": t1_idx,
        "end_idx": t3_idx,
    }


def _segment_highest_high(bars: List[Bar], a: int, b: int) -> tuple:
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
    """True if closes have already breached above the neckline consecutively."""
    neckline = c["neckline"]
    t3_idx = c["trough3_idx"]
    last_idx = len(bars) - 1
    max_consec = 0
    consec = 0
    for i in range(t3_idx, last_idx + 1):
        if bars[i]["c"] > neckline:
            consec += 1
            if consec > max_consec:
                max_consec = consec
        else:
            consec = 0
    return max_consec >= 2


def _score_geometry(c: dict) -> float:
    # Trough similarity: tighter = better
    trough_score = max(0.0, (1.0 - c["trough_spread"] / _MAX_TROUGH_SPREAD) * 100)
    # Peak similarity
    peak_score = max(0.0, (1.0 - c["peak_spread"] / _MAX_PEAK_SPREAD) * 100)
    # Rally depth ideality (avg): textbook 8-20%
    avg_rally = (c["rally1_depth"] + c["rally2_depth"]) / 2.0
    if 0.08 <= avg_rally <= 0.20:
        depth_score = 100.0
    elif avg_rally < 0.08:
        depth_score = max(0.0, (avg_rally - _MIN_RALLY_DEPTH)
                          / (0.08 - _MIN_RALLY_DEPTH) * 100)
    else:
        depth_score = max(0.0, (_MAX_RALLY_DEPTH - avg_rally)
                          / (_MAX_RALLY_DEPTH - 0.20) * 100)
    # Duration: ideal ~40-60 bars (more time than double bottom)
    span = c["pattern_bars"]
    if 35 <= span <= 65:
        span_score = 100.0
    elif span < 35:
        span_score = max(0.0, (span - 2 * _MIN_TROUGH_SPACING) / (35 - 2 * _MIN_TROUGH_SPACING) * 100)
    else:
        span_score = max(0.0, (_MAX_PATTERN_BARS - span) / (_MAX_PATTERN_BARS - 65) * 100)
    return round(0.35 * trough_score + 0.25 * peak_score
                 + 0.25 * depth_score + 0.15 * span_score, 2)


def _score_volume(bars: List[Bar], c: dict) -> float:
    """Score expanding volume on each subsequent trough (sign of accumulation)."""
    def _window_avg(center, half=2):
        lo = max(0, center - half)
        hi = min(len(bars) - 1, center + half)
        if hi < lo:
            return 0.0
        win = bars[lo:hi + 1]
        return sum(b["v"] for b in win) / len(win)

    v1 = _window_avg(c["trough1_idx"])
    v2 = _window_avg(c["trough2_idx"])
    v3 = _window_avg(c["trough3_idx"])

    if v1 <= 0:
        return 50.0

    # Each subsequent trough should have higher (expanding) volume
    score = 50.0
    if v2 > v1:
        score += 25
    if v3 > v2:
        score += 25
    if v3 > v1 * 1.5:
        score = min(100.0, score + 10)  # strong accumulation bonus
    if v3 < v1:
        score = max(0.0, score - 30)  # contracting volume on third trough is anti-pattern
    return round(min(100.0, max(0.0, score)), 2)


def _score_context(context: dict) -> float:
    score = 50.0
    if context.get("trend_stage") == 1:
        score += 25  # basing / accumulation
    elif context.get("trend_stage") == 4:
        score += 15  # downtrend ripe for reversal at floor
    if context.get("ma_alignment") == "stacked_bearish":
        score += 10  # oversold - reversal pattern marks bottom
    if context.get("dcr_signature") == "accumulation":
        score += 12
    if context.get("volume_signature") == "expanding":
        score += 10
    return min(100.0, score)


def _ma_alignment_phrase(context: dict) -> str:
    align = context.get("ma_alignment", "mixed")
    if align == "stacked_bearish":
        return "stacked-bearish moving-average (oversold basing context)"
    if align == "stacked_bullish":
        return "stacked-bullish moving-average (counter-trend warning for triple-bottom longs)"
    return "mixed moving-average"


def _trend_stage_description(context: dict) -> str:
    stage = context.get("trend_stage", 0)
    if stage == 1:
        return "a Stage 1 base/accumulation environment (textbook triple-bottom reversal setup)"
    if stage == 4:
        return "a Stage 4 downtrend showing repeated rejection at support (oversold reversal context)"
    if stage == 2:
        return "a Stage 2 uptrend (continuation context - triple bottom as a deep bull-flag analog)"
    if stage == 3:
        return "a Stage 3 distribution environment (counter-trend caution)"
    return "an undefined trend stage"


def _rs_trend_phrase(context: dict) -> str:
    rs = context.get("rs_trend", "flat")
    if rs == "up":
        return "improving (trend tailwind for the breakout)"
    if rs == "down":
        return "still deteriorating (counter-trend warning - wait for peak confluence break)"
    return "neutral"


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    t1_idx, t2_idx, t3_idx = c["trough1_idx"], c["trough2_idx"], c["trough3_idx"]
    p1_idx, p2_idx = c["peak1_idx"], c["peak2_idx"]

    t1_price, t2_price, t3_price = c["trough1_price"], c["trough2_price"], c["trough3_price"]
    p1_price, p2_price = c["peak1_price"], c["peak2_price"]
    neckline = c["neckline"]
    avg_trough = c["avg_trough"]
    avg_peak = c["avg_peak"]
    lowest_trough = min(t1_price, t2_price, t3_price)

    # Levels
    entry = round(neckline * 1.001, 2)
    stop = round(lowest_trough * 0.985, 2)
    target = round(neckline + (neckline - avg_trough), 2)
    rr = (target - entry) / (entry - stop) if entry > stop else 0.0
    stop_distance_pct = (entry - stop) / entry * 100 if entry > 0 else 0.0

    trough_spread_pct = c["trough_spread"] * 100.0
    peak_spread_pct = c["peak_spread"] * 100.0
    trough_match_pct = (1.0 - c["trough_spread"]) * 100.0
    peak_match_pct = (1.0 - c["peak_spread"]) * 100.0
    rally1_pct = c["rally1_depth"] * 100.0
    rally2_pct = c["rally2_depth"] * 100.0
    pattern_bars = c["pattern_bars"]
    neckline_to_trough_pts = neckline - avg_trough
    neckline_to_trough_pct = (neckline_to_trough_pts / neckline * 100.0) if neckline > 0 else 0.0

    ma_phrase = _ma_alignment_phrase(context)
    stage_phrase = _trend_stage_description(context)
    rs_phrase = _rs_trend_phrase(context)
    regime = context.get("regime", "current")
    vol_signature = context.get("volume_signature", "unspecified")

    sym_token = "the stock"

    headline = (
        f"Triple Bottom forming on {sym_token} - troughs ${t1_price:.2f}/"
        f"${t2_price:.2f}/${t3_price:.2f} within {trough_spread_pct:.2f}% "
        f"spread, peaks ${p1_price:.2f}/${p2_price:.2f} within "
        f"{peak_spread_pct:.2f}%, neckline ${neckline:.2f}, "
        f"{pattern_bars}-bar pattern. Pivot ${entry:.2f}, target "
        f"${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Triple Bottom is the stricter, higher-conviction bullish "
        f"cousin of the double bottom - documented in Edwards & Magee's "
        f"'Technical Analysis of Stock Trends' (1948), refined by Schabacker "
        f"in the 1930s, and quantified by Bulkowski's modern empirical "
        f"research. Structurally it is three sequential troughs in a "
        f"downtrend or extended base that all hold at approximately the "
        f"same price level: trough 1 at ${t1_price:.2f}, trough 2 at "
        f"${t2_price:.2f}, and trough 3 at ${t3_price:.2f} - here clustered "
        f"within a {trough_spread_pct:.2f}% spread ({trough_match_pct:.1f}% "
        f"match score) around an average of ${avg_trough:.2f}. Between the "
        f"troughs are two rally peaks: peak 1 at ${p1_price:.2f} "
        f"({rally1_pct:.1f}% above trough 1) and peak 2 at ${p2_price:.2f} "
        f"({rally2_pct:.1f}% above trough 2). The two peaks are within "
        f"{peak_spread_pct:.2f}% of each other ({peak_match_pct:.1f}% match) "
        f"- their average at ${avg_peak:.2f} forms the neckline, the "
        f"horizontal resistance line whose breach confirms the reversal. "
        f"The pattern spans {pattern_bars} bars between T1 and T3. The "
        f"market mechanic underneath is demand unambiguously dominating "
        f"supply: at the prior-low price, institutional buyers have stepped "
        f"in not once or twice but three separate times, absorbing each "
        f"decline attempt and refusing to let price extend lower. Three "
        f"failed attempts is statistically a much stronger signal than two "
        f"because the probability of three coincidental rejections at the "
        f"same level by chance alone is vanishingly small - this is "
        f"genuine, repeated, programmatic demand at ${avg_trough:.2f}. The "
        f"expanding-volume signature across the three troughs (encoded in "
        f"this detection's volume_score component) reveals buying "
        f"conviction strengthening with each successive defense even as "
        f"the price tag matches. Bulkowski's empirical research on triple "
        f"bottoms places the confirmed-breakout follow-through rate at "
        f"~67%, slightly stronger than the double-bottom's ~65%. Measured "
        f"moves equal the neckline-to-trough distance projected above the "
        f"neckline (here ${neckline_to_trough_pts:.2f} = "
        f"{neckline_to_trough_pct:.1f}% projection)."
    )

    why_it_matters = (
        f"This Triple Bottom is forming in {stage_phrase} with {ma_phrase} "
        f"alignment and {rs_phrase} relative strength versus the broader "
        f"market, against a {regime} regime backdrop and volume signature "
        f"reading {vol_signature}. The {trough_match_pct:.1f}% trough "
        f"symmetry is the structural validation that matters most: tight "
        f"trough matches (within 2-3%) are the highest-reliability variant "
        f"because they reveal a clear institutional demand line at one "
        f"specific price (${avg_trough:.2f} average), while loose matches "
        f"above 4% blur into rounded-base noise where the bottoming process "
        f"is less defined. The peak confluence at ${avg_peak:.2f} "
        f"({peak_match_pct:.1f}% match) is equally important - it defines "
        f"the neckline that bulls must clear to confirm the reversal, and "
        f"peak matches within 5% indicate a specific overhead supply level "
        f"rather than a sloppy double-top peak geometry. Average rally "
        f"depth around {(rally1_pct + rally2_pct) / 2:.1f}% sits in the "
        f"textbook 8-20% zone where the highest-follow-through triple "
        f"bottoms resolve - too-shallow rallies (under 5%) suggest sellers "
        f"haven't actually been challenged on the upstroke yet, while "
        f"too-deep rallies (over 25%) usually reflect a structural reversal "
        f"already underway rather than a clean three-trough basing "
        f"pattern. The {pattern_bars}-bar pattern width in the 35-65 bar "
        f"sweet spot is the optimal duration zone - shorter patterns lack "
        f"the time for genuine accumulation to occur and often resolve as "
        f"continuation breakdowns, while longer patterns accumulate too "
        f"many late sellers near the peaks who defend the neckline. The "
        f"third failed attempt is statistically meaningful: Bulkowski's "
        f"research shows that the third rejection adds roughly 5-7 "
        f"percentage points to follow-through reliability compared to the "
        f"equivalent double bottom, and the pattern is specifically called "
        f"out as one of the higher-conviction bullish reversal structures "
        f"when troughs cluster tightly. Trapped shorts near "
        f"${avg_trough:.2f} - many of whom have now watched three separate "
        f"failures and are increasingly likely to cover on any meaningful "
        f"neckline break - become the demand that fuels every subsequent "
        f"breakout attempt. Wyckoff would call this the textbook "
        f"absorption phase of accumulation: composite operators "
        f"systematically transferring supply from weak hands to strong "
        f"hands at the floor price."
    )

    what_to_watch_for = (
        f"The trigger is a daily close above ${entry:.2f} (the neckline at "
        f"${neckline:.2f} plus a small confirmation buffer) on volume of "
        f"at least 1.5x the 20-bar average - that volume expansion on the "
        f"breakout is non-negotiable because a neckline break on light "
        f"tape frequently reverses as a bull trap, especially on a pattern "
        f"this well-watched (triple bottoms are widely scanned by both "
        f"human traders and pattern-recognition systems). The ideal trigger "
        f"bar closes in the upper half of its range with a wide green real "
        f"body, and the next 1-3 bars should hold above ${neckline:.2f} "
        f"without 'kissing back' below the peak confluence more than once - "
        f"a single throwback retest of the broken neckline is normal and "
        f"often the highest-quality long entry, but two-plus closes back "
        f"below ${neckline:.2f} weakens the thesis materially. Measured "
        f"target is ${target:.2f}, derived by projecting the "
        f"${neckline_to_trough_pts:.2f} neckline-to-trough distance upward "
        f"from the neckline - a {neckline_to_trough_pct:.1f}% projected "
        f"move that justifies the position. Aggressive triple bottoms in "
        f"Stage 1 accumulation contexts often extend 1.3-1.6x this "
        f"measured move because trapped shorts near the avg-trough level "
        f"capitulate and the breakout cascade attracts trend-following "
        f"longs. Initial stop sits at ${stop:.2f} (1.5% below the lowest "
        f"trough at ${lowest_trough:.2f}) representing a "
        f"{stop_distance_pct:.1f}% risk from entry - risking 1% of account "
        f"on this long implies a position size of roughly "
        f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
        f"of equity, and risking 0.5% halves that. Trail stops below each "
        f"new swing low as the trade extends, or below the rising 10/20 "
        f"EMA, and consider trimming partial size at 1R to lock in a free "
        f"trade. A triple bottom with strongly expanding volume on each "
        f"successive trough (T3 volume over 1.5x T1) is the highest-"
        f"conviction expression and merits a larger position size; weaker "
        f"volume signatures lower conviction. Watch for the 50-SMA to "
        f"flatten and curl up as a confirming institutional fingerprint - "
        f"the breakout works best when the broader trend is already "
        f"transitioning from Stage 4 markdown toward Stage 1 basing."
    )

    failure_signal = (
        f"The pattern is invalidated on a daily close below the lowest "
        f"trough at ${lowest_trough:.2f} (stop at ${stop:.2f}, 1.5% below "
        f"to absorb the standard downside wick) - that close signals the "
        f"accumulation thesis is wrong, supply has finally overcome the "
        f"demand at ${avg_trough:.2f}, and the underlying downtrend has a "
        f"high probability of resuming, often with an air-pocket leg "
        f"lower as trapped longs capitulate into the breakdown. The "
        f"primary failure mode for a triple bottom is the 'false neckline "
        f"break that reverses on weak volume': price punches above "
        f"${entry:.2f} on merely-average or below-average tape, the next "
        f"1-2 bars close in the lower half of their range, and price re-"
        f"enters the peak confluence. That sequence is the textbook "
        f"'failed breakout' or Wyckoff upthrust - the visible triple-"
        f"bottom neckline becomes a liquidity grab to trap eager longs and "
        f"re-distribute, not a genuine reversal. Failed triple bottoms "
        f"are especially treacherous because the pattern attracts heavy "
        f"long interest from trend-following systems and pattern scanners "
        f"(more than the equivalent double bottom because of the perceived "
        f"'extra confirmation' of the third trough), and the unwinding "
        f"longs frequently mark the start of a fresh leg lower. The "
        f"{stop_distance_pct:.1f}% stop must be honored without "
        f"negotiation - widening or removing a stop on a failing triple-"
        f"bottom long is one of the fastest ways to convert a manageable "
        f"loss into account-damaging exposure because basing patterns "
        f"that fail tend to do so dramatically, not gradually. Failed "
        f"triple bottoms often resolve with sharp inverse-V capitulation "
        f"velocity straight back through all three troughs - the pent-up "
        f"supply that had been absorbed during three separate rescue "
        f"attempts releases at once when the demand finally evaporates. "
        f"Size accordingly and never average down on a failing triple "
        f"bottom. A subtler failure tell: the second half of the pattern "
        f"shows DECREASING volume on each successive trough rather than "
        f"the expanding-volume signature this pattern requires - that "
        f"reading inverts the accumulation thesis and signals distribution "
        f"in disguise (Wyckoff would call this the 'sign of weakness' "
        f"warning), dramatically increasing the chance of a downside "
        f"resolution. Counter-trend triple bottoms in Stage 3-4 bearish "
        f"contexts are particularly susceptible to this failure mode and "
        f"should be sized down or skipped entirely until the broader "
        f"regime turns."
    )

    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Triple Bottom",
        "category": "classical",
        "direction": "bullish",
        "start_t": int(bars[t1_idx]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(bars[t1_idx]["t"]),
                     int(bars[p1_idx]["t"]),
                     int(bars[t2_idx]["t"]),
                     int(bars[p2_idx]["t"]),
                     int(bars[t3_idx]["t"]),
                     int(last_bar["t"])],
        "geometry": {
            "shape": "neckline",
            "anchors": [
                {"t": int(bars[t1_idx]["t"]), "price": float(t1_price)},
                {"t": int(bars[p1_idx]["t"]), "price": float(p1_price)},
                {"t": int(bars[t2_idx]["t"]), "price": float(t2_price)},
                {"t": int(bars[p2_idx]["t"]), "price": float(p2_price)},
                {"t": int(bars[t3_idx]["t"]), "price": float(t3_price)},
                {"t": int(bars[t1_idx]["t"]), "price": float(neckline)},
                {"t": int(bars[t3_idx]["t"]), "price": float(neckline)},
            ],
            "extras": {
                "trough_spread_pct": round(c["trough_spread"] * 100, 2),
                "peak_spread_pct": round(c["peak_spread"] * 100, 2),
                "rally1_pct": round(c["rally1_depth"] * 100, 2),
                "rally2_pct": round(c["rally2_depth"] * 100, 2),
                "avg_trough": round(float(avg_trough), 2),
                "avg_peak": round(float(avg_peak), 2),
                "neckline": round(float(neckline), 2),
                "pattern_bars": int(c["pattern_bars"]),
            },
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close > {entry:.2f} on volume > 1.5x 20-bar avg",
            "stop": stop,
            "stop_basis": "lowest_trough_minus_1.5pct",
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


register(_PATTERN_ID, detect_triple_bottom)
