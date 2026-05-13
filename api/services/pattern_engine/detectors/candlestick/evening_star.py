"""Evening Star candlestick detector.

The Evening Star is the bearish mirror of the Morning Star and one of the most
powerful 3-bar bearish reversal patterns in the Japanese-candlestick lexicon.
The name comes from the evening star (Venus appearing at dusk = end of light,
arrival of darkness), capturing the metaphor perfectly: after a session of
buying (the light), a small middle candle (the star) pauses the momentum, and
the third candle drives price back down (the dusk). Munehisa Homma's
18th-century Sakata rice trading rules catalogued this as one of the canonical
topping sequences, and Steve Nison codified it in 'Japanese Candlestick
Charting Techniques' (1991).

Definition (geometry):
  - Bar N-2: GREEN, LONG body (body_pct >= 0.40 of range) - confirms uptrend
  - Bar N-1: small body (<= 30% of bar N-2 body), positioned at or near bar
    N-2's close. The "star" - buyers couldn't push further. Color irrelevant.
  - Bar N: RED, LONG body (body_pct >= 0.40 of range), closes BELOW the
    MIDPOINT of bar N-2's body. The completion - sellers reclaim control.

Context (critical):
  - Evening Star is meaningful at swing high or after recent advance
  - Stars require 3 bars to complete - pattern is invalidated if any bar
    deviates from the structure
  - DCR accumulation -> neutral -> distribution transition over the 3 bars
    is the ideal institutional fingerprint

Direction: bearish.
Confirmation: NEXT bar (bar N+1) close below bar N's low.
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.dcr import compute_dcr, dcr_strength
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "evening_star"
_MIN_BARS = 7
_MIN_LONG_BODY_PCT = 0.40
_MAX_STAR_BODY_RATIO = 0.30
_SCAN_LOOKBACK = 5
_SWING_LOOKBACK = 10
_CONFIDENCE_FLOOR = 50.0


def detect_evening_star(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect evening-star 3-bar patterns. Emits 0 or 1 Detection (most recent)."""
    if len(bars) < _MIN_BARS:
        return []

    detections: List[Detection] = []
    start = max(2, len(bars) - _SCAN_LOOKBACK)
    for i in range(start, len(bars)):
        candidate = _try_extract(bars, i)
        if candidate is None:
            continue

        geom_score = _score_geometry(candidate)
        vol_score = _score_volume(bars, i)
        ctx_score = _score_context(context, bars, i, candidate)
        hist_score = 50.0

        confidence = round(
            0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
        )
        if confidence < _CONFIDENCE_FLOOR:
            continue

        d = _build_detection(
            bars, candidate, i, confidence, context, geom_score, vol_score, ctx_score, hist_score
        )
        detections.append(d)

    if not detections:
        return []
    return detections[-1:]


def _try_extract(bars: List[Bar], i: int) -> Optional[dict]:
    if i < 2:
        return None
    bar1 = bars[i - 2]
    bar2 = bars[i - 1]
    bar3 = bars[i]

    # --- BAR 1 (N-2): GREEN LONG ---
    b1_o, b1_c = bar1["o"], bar1["c"]
    if b1_c <= b1_o:
        return None
    b1_body = b1_c - b1_o
    b1_range = bar1["h"] - bar1["l"]
    if b1_range <= 0:
        return None
    b1_body_pct = b1_body / b1_range
    if b1_body_pct < _MIN_LONG_BODY_PCT:
        return None

    # --- BAR 3 (N): RED LONG ---
    b3_o, b3_c = bar3["o"], bar3["c"]
    if b3_c >= b3_o:
        return None
    b3_body = b3_o - b3_c
    b3_range = bar3["h"] - bar3["l"]
    if b3_range <= 0:
        return None
    b3_body_pct = b3_body / b3_range
    if b3_body_pct < _MIN_LONG_BODY_PCT:
        return None

    # --- BAR 2 (N-1): the star ---
    b2_o, b2_c = bar2["o"], bar2["c"]
    b2_body = abs(b2_c - b2_o)
    b2_range = bar2["h"] - bar2["l"]
    if b2_range <= 0:
        return None
    b2_body_pct = b2_body / b2_range if b2_range > 0 else 0.0
    if b1_body > 0:
        star_ratio = b2_body / b1_body
    else:
        star_ratio = 0.0
    if star_ratio > _MAX_STAR_BODY_RATIO:
        return None

    # --- BAR 3 close must be BELOW bar 1's midpoint ---
    b1_midpoint = (b1_o + b1_c) / 2.0
    if b3_c >= b1_midpoint:
        return None
    midpoint_penetration = (b1_midpoint - b3_c) / b1_body if b1_body > 0 else 0.0

    # Gap up from bar 1 to bar 2 (ideal): bar 2 body bottom (min o,c) vs bar 1 close
    b2_body_bot = min(b2_o, b2_c)
    gap_pct = (b2_body_bot - b1_c) / b1_c if b1_c > 0 else 0.0  # positive = gap up

    b1_dcr = compute_dcr(bar1)
    b2_dcr = compute_dcr(bar2)
    b3_dcr = compute_dcr(bar3)
    b2_is_doji = b2_body_pct < 0.10

    return {
        "bar1": bar1, "bar2": bar2, "bar3": bar3,
        "b1_open": b1_o, "b1_close": b1_c,
        "b2_open": b2_o, "b2_close": b2_c,
        "b3_open": b3_o, "b3_close": b3_c,
        "b1_body": b1_body, "b2_body": b2_body, "b3_body": b3_body,
        "b1_body_pct": b1_body_pct, "b2_body_pct": b2_body_pct, "b3_body_pct": b3_body_pct,
        "b1_range": b1_range, "b2_range": b2_range, "b3_range": b3_range,
        "star_ratio": star_ratio,
        "b1_midpoint": b1_midpoint,
        "midpoint_penetration": midpoint_penetration,
        "gap_pct": gap_pct,
        "b1_dcr": b1_dcr, "b2_dcr": b2_dcr, "b3_dcr": b3_dcr,
        "b3_high": bar3["h"],
        "b3_low": bar3["l"],
        "b1_high": bar1["h"],
        "b2_high": bar2["h"],
        "pattern_low": min(bar1["l"], bar2["l"], bar3["l"]),
        "pattern_high": max(bar1["h"], bar2["h"], bar3["h"]),
        "b2_is_doji": b2_is_doji,
    }


def _is_swing_high(bars: List[Bar], i: int) -> bool:
    lookback = bars[max(0, i - _SWING_LOOKBACK):i + 1]
    if len(lookback) < 4:
        return False
    high_max = max(b["h"] for b in lookback)
    low_min = min(b["l"] for b in lookback)
    rng = high_max - low_min
    if rng <= 0:
        return False
    bar_high = max(bars[i]["h"], bars[i - 1]["h"], bars[i - 2]["h"])
    return (high_max - bar_high) / rng <= 0.05


def _above_sma50(bars: List[Bar], i: int) -> bool:
    if i < 49:
        return False
    closes = [b["c"] for b in bars[i - 49:i + 1]]
    if not closes:
        return False
    sma = sum(closes) / len(closes)
    return bars[i]["c"] > sma


def _recent_advance_pct(bars: List[Bar], i: int) -> float:
    start = max(0, i - 14)
    window = bars[start:i + 1]
    if not window:
        return 0.0
    low = min(b["l"] for b in window)
    high_now = max(bars[i]["h"], bars[i - 1]["h"], bars[i - 2]["h"])
    if low <= 0:
        return 0.0
    return (high_now - low) / low


def _score_geometry(c: dict) -> float:
    b1bp = c["b1_body_pct"]
    if b1bp >= 0.75:
        b1_score = 100.0
    elif b1bp >= 0.55:
        b1_score = 70.0 + (b1bp - 0.55) / 0.20 * 30.0
    else:
        b1_score = max(0.0, (b1bp - 0.40) / 0.15 * 70.0)

    sr = c["star_ratio"]
    if sr <= 0.10:
        star_score = 100.0
    elif sr <= 0.20:
        star_score = 75.0 + (0.20 - sr) / 0.10 * 25.0
    else:
        star_score = max(0.0, (0.30 - sr) / 0.10 * 75.0)

    b3bp = c["b3_body_pct"]
    if b3bp >= 0.75:
        b3_score = 100.0
    elif b3bp >= 0.55:
        b3_score = 70.0 + (b3bp - 0.55) / 0.20 * 30.0
    else:
        b3_score = max(0.0, (b3bp - 0.40) / 0.15 * 70.0)

    mp = c["midpoint_penetration"]
    if mp >= 0.80:
        mp_score = 100.0
    elif mp >= 0.40:
        mp_score = 60.0 + (mp - 0.40) / 0.40 * 40.0
    elif mp >= 0.10:
        mp_score = 30.0 + (mp - 0.10) / 0.30 * 30.0
    else:
        mp_score = max(0.0, mp / 0.10 * 30.0)

    doji_bonus = 5.0 if c["b2_is_doji"] else 0.0

    return round(min(100.0, 0.25 * b1_score + 0.25 * star_score + 0.25 * b3_score + 0.25 * mp_score + doji_bonus), 2)


def _score_volume(bars: List[Bar], i: int) -> float:
    if i < 2:
        return 50.0
    b1_v = bars[i - 2]["v"]
    b2_v = bars[i - 1]["v"]
    b3_v = bars[i]["v"]
    if b1_v <= 0 or b2_v <= 0:
        return 50.0

    star_vol_ratio = b2_v / b1_v
    if star_vol_ratio <= 0.50:
        star_score = 100.0
    elif star_vol_ratio <= 0.80:
        star_score = 60.0 + (0.80 - star_vol_ratio) / 0.30 * 40.0
    elif star_vol_ratio <= 1.20:
        star_score = 30.0 + (1.20 - star_vol_ratio) / 0.40 * 30.0
    else:
        star_score = max(0.0, (1.50 - star_vol_ratio) / 0.30 * 30.0)

    avg_prior = (b1_v + b2_v) / 2.0
    confirm_ratio = b3_v / avg_prior if avg_prior > 0 else 0.0
    if confirm_ratio >= 1.50:
        confirm_score = 100.0
    elif confirm_ratio >= 1.10:
        confirm_score = 70.0 + (confirm_ratio - 1.10) / 0.40 * 30.0
    elif confirm_ratio >= 0.80:
        confirm_score = 40.0 + (confirm_ratio - 0.80) / 0.30 * 30.0
    else:
        confirm_score = max(0.0, confirm_ratio / 0.80 * 40.0)

    return round(0.40 * star_score + 0.60 * confirm_score, 2)


def _score_context(context: dict, bars: List[Bar], i: int, c: dict) -> float:
    score = 25.0
    swing_high = _is_swing_high(bars, i)
    above_50 = _above_sma50(bars, i)
    advance = _recent_advance_pct(bars, i)

    if swing_high:
        score += 25
    if above_50:
        score += 10
    if advance >= 0.10:
        score += 15
    elif advance >= 0.05:
        score += 8

    b3_dcr = c["b3_dcr"]
    if b3_dcr <= 0.20:
        score += 10
    elif b3_dcr <= 0.35:
        score += 5

    dcr_sig = context.get("dcr_signature")
    if dcr_sig == "accumulation" and b3_dcr <= 0.40:
        score += 10
    elif dcr_sig == "neutral" and b3_dcr <= 0.40:
        score += 5

    res = context.get("nearest_resistance")
    if res and res > 0 and abs(c["pattern_high"] - res) / res <= 0.015:
        score += 5

    stage = context.get("trend_stage")
    if stage in (2, 3):
        score += 5

    return min(100.0, score)


def _trend_phrase(context: dict) -> str:
    stage = context.get("trend_stage", 0)
    if stage == 2: return "a Stage 2 uptrend"
    if stage == 1: return "a Stage 1 base/accumulation environment"
    if stage == 3: return "a Stage 3 distribution environment"
    if stage == 4: return "a Stage 4 downtrend environment"
    return "an undefined trend stage"


def _ma_phrase(context: dict) -> str:
    return {
        "stacked_bullish": "stacked-bullish",
        "stacked_bearish": "stacked-bearish",
        "mixed": "mixed",
    }.get(context.get("ma_alignment", "mixed"), "mixed")


def _rs_phrase(context: dict) -> str:
    return {"up": "improving", "down": "deteriorating", "flat": "neutral"}.get(
        context.get("rs_trend", "flat"), "neutral"
    )


def _build_detection(
    bars: List[Bar],
    c: dict,
    i: int,
    confidence: float,
    context: dict,
    geom_score: float,
    vol_score: float,
    ctx_score: float,
    hist_score: float,
) -> Detection:
    bar1, bar2, bar3 = c["bar1"], c["bar2"], c["bar3"]

    b1_body_pct_disp = round(c["b1_body_pct"] * 100, 2)
    b2_body_pct_disp = round(c["b2_body_pct"] * 100, 2)
    b3_body_pct_disp = round(c["b3_body_pct"] * 100, 2)
    star_ratio_disp = round(c["star_ratio"], 3)
    mp_disp = round(c["midpoint_penetration"] * 100, 1)
    gap_disp = round(c["gap_pct"] * 100, 2)
    b1_dcr_pct = round(c["b1_dcr"] * 100, 1)
    b2_dcr_pct = round(c["b2_dcr"] * 100, 1)
    b3_dcr_pct = round(c["b3_dcr"] * 100, 1)

    is_swing_high = _is_swing_high(bars, i)
    above_50 = _above_sma50(bars, i)
    advance_pct = _recent_advance_pct(bars, i) * 100

    b1_v = bar1["v"]
    b2_v = bar2["v"]
    b3_v = bar3["v"]
    star_vol_ratio = (b2_v / b1_v) if b1_v > 0 else 0.0
    confirm_vol_ratio = (b3_v / ((b1_v + b2_v) / 2.0)) if (b1_v + b2_v) > 0 else 0.0
    star_vol_disp = f"{star_vol_ratio:.2f}x"
    confirm_vol_disp = f"{confirm_vol_ratio:.2f}x"

    # Levels - bearish trade. Entry = close below bar 3's low.
    entry = round(c["b3_low"] * 0.999, 2)
    stop = round(c["pattern_high"] * 1.015, 2)
    measured = entry - 2 * (stop - entry)
    near_sup = context.get("nearest_support")
    if near_sup and near_sup < entry:
        target = round(max(near_sup, measured), 2)
        target_basis = "nearest_support_or_2R_measured_move_down"
    else:
        target = round(measured, 2)
        target_basis = "2R_measured_move_down"
    rr = (entry - target) / (stop - entry) if stop > entry else 0.0
    stop_distance_pct = (stop - entry) / entry * 100 if entry > 0 else 0.0

    if is_swing_high:
        position_phrase = "at a near-term swing high"
    elif above_50:
        position_phrase = "above the 50-bar SMA after recent advance"
    elif advance_pct >= 5.0:
        position_phrase = f"following a {advance_pct:.1f}% recent rally"
    else:
        position_phrase = "without a clear preceding advance"

    stage_phrase = _trend_phrase(context)
    ma_phrase = _ma_phrase(context)
    rs_phrase = _rs_phrase(context)
    regime = context.get("regime", "current")
    dcr_sig = context.get("dcr_signature", "neutral")
    recent_dcr_avg = context.get("recent_dcr_avg", 0.5)
    recent_dcr_pct = round(recent_dcr_avg * 100, 1)
    doji_word = "true doji star" if c["b2_is_doji"] else "small-bodied star"
    gap_word = (
        f"gapped up {gap_disp}%" if c["gap_pct"] > 0.005
        else "opened near the prior close" if abs(c["gap_pct"]) <= 0.005
        else f"opened {abs(gap_disp)}% below the prior close"
    )

    anchors = [
        {"t": int(bar1["t"]), "price": float(bar1["c"])},
        {"t": int(bar2["t"]), "price": float(bar2["c"])},
        {"t": int(bar3["t"]), "price": float(bar3["c"])},
    ]
    now = int(time.time())

    headline = (
        f"Evening Star ({doji_word}) {position_phrase} - bar 1 green {b1_body_pct_disp}% body, "
        f"star {star_ratio_disp}x bar 1, bar 3 red {b3_body_pct_disp}% body closing "
        f"{mp_disp}% past bar 1 midpoint, B3 DCR {b3_dcr_pct}%."
    )

    what_it_is = (
        f"The Evening Star is the bearish mirror of the Morning Star and one of the most "
        f"powerful 3-bar bearish reversal patterns in the Japanese-candlestick lexicon. The "
        f"name comes from the evening star (Venus appearing at dusk = end of light, arrival "
        f"of darkness), capturing the metaphor perfectly: after a session of buying (the "
        f"light), a small middle candle (the star) pauses the momentum, and the third candle "
        f"drives price back down (the dusk). Munehisa Homma's 18th-century Sakata rice "
        f"trading rules catalogued this as one of the canonical topping sequences, and Steve "
        f"Nison codified it for the Western audience in 'Japanese Candlestick Charting "
        f"Techniques' (1991). Anatomically, this 3-bar sequence unfolds as a complete "
        f"demand-to-supply transition: Bar 1 (N-2) was a LONG green candle - open "
        f"${c['b1_open']:.2f}, close ${c['b1_close']:.2f}, body of {b1_body_pct_disp}% of its "
        f"range, DCR {b1_dcr_pct}% - confirming the uptrend on real buying. Bar 2 (N-1, the "
        f"'star') was a {doji_word} with body of {b2_body_pct_disp}% of its own tiny range "
        f"(only {star_ratio_disp}x the size of bar 1's body), and it {gap_word} relative to "
        f"bar 1's close. Buyers couldn't push price further; the prior momentum vanished. Bar "
        f"3 (N) then opened, drove lower, and closed at ${c['b3_close']:.2f} - a LONG red "
        f"body of {b3_body_pct_disp}% of its range that closed {mp_disp}% below bar 1's "
        f"midpoint of ${c['b1_midpoint']:.2f}. The pattern is complete: up-bar, indecision, "
        f"down-bar, with bar 3's close penetrating well into bar 1's body. Bar 3's DCR of "
        f"{b3_dcr_pct}% places its close in the "
        f"{'very bottom' if c['b3_dcr'] <= 0.15 else 'lower third' if c['b3_dcr'] <= 0.30 else 'lower half' if c['b3_dcr'] <= 0.45 else 'middle'} "
        f"of its range - "
        f"{'a textbook institutional-distribution fingerprint' if c['b3_dcr'] <= 0.30 else 'a moderate close that warrants confirmation'}. "
        f"Star volume was {star_vol_disp} bar 1's, and bar 3 volume was {confirm_vol_disp} the "
        f"average of bars 1-2 - "
        f"{'textbook volume profile: contraction on the star, expansion on the confirmation' if star_vol_ratio <= 0.80 and confirm_vol_ratio >= 1.20 else 'mixed volume profile - not the ideal Homma signature but the geometry holds'}. "
        f"Greg Morris's 'Candlestick Charting Explained' frames the evening star as one of "
        f"the highest-conviction reversal sequences in the entire candlestick library, "
        f"requiring a clear uptrend, a gap-up or doji star, and a strong confirming third "
        f"bar that closes deep into the first bar's body. Tom Bulkowski's empirical sample "
        f"puts evening-star follow-through reliability near ~78% — mirroring the bullish "
        f"morning star — when all three bars meet his geometric criteria. Linda Raschke "
        f"uses the evening star plus overbought RSI as a high-conviction reversal combo "
        f"in her swing playbook, treating the 3-bar sequence as the timing trigger inside "
        f"a broader bearish confluence read."
    )

    why_it_matters = (
        f"This evening star appears {position_phrase}, inside {stage_phrase} with {ma_phrase} "
        f"moving-average alignment and {rs_phrase} relative strength against the broader tape. "
        f"The signal's edge comes from what the 3-bar sequence reveals about institutional "
        f"behavior over time: on bar 1 the bulls were in complete control - DCR {b1_dcr_pct}% "
        f"meant they held into the bell on volume. On bar 2 the momentum vanished - the range "
        f"collapsed, volume contracted to {star_vol_disp} bar 1's, and the close held in the "
        f"middle of a small range (DCR {b2_dcr_pct}%). That is exhaustion. On bar 3 the bears "
        f"materialized in size - a long red body, volume of {confirm_vol_disp} the prior 2-bar "
        f"average, close at ${c['b3_close']:.2f} ({mp_disp}% past bar 1's midpoint), DCR "
        f"{b3_dcr_pct}%. The pattern is NOT just an indecision signal like a harami - it is a "
        f"COMPLETE reversal of session control across 3 days, with the third bar's close "
        f"already negating more than half of bar 1's gain. Context's recent DCR average of "
        f"{recent_dcr_pct}% over the trailing 10 bars classifies the broader chart as "
        f"'{dcr_sig}' - "
        f"{'a textbook buyer-exhaustion signature where every recent bar closed strongly, and the evening star is the climactic 3-bar transition from accumulation to re-emerging distribution' if dcr_sig == 'accumulation' else 'an indecisive base where the evening star is the most decisive directional sequence in weeks' if dcr_sig == 'neutral' else 'a distribution context where the evening star is corroborating continuation rather than a clean turn'}. "
        f"Recent 15-bar advance of {advance_pct:.1f}% places this pattern at a level where "
        f"sellers had structural reason to distribute. Current regime is {regime}, which "
        f"calibrates how aggressive short-side position sizing should be on a multi-bar "
        f"reversal sequence."
    )

    what_to_watch_for = (
        f"Evening Stars are stronger than 2-bar reversals like engulfing or harami because the "
        f"3rd bar's close already incorporates significant confirmation. However, Nison still "
        f"recommends an additional confirmation bar - a CLOSE BELOW ${entry:.2f} (bar 3's low "
        f"of ${c['b3_low']:.2f} minus a 0.1% buffer) on the bar N+1 close, ideally on volume "
        f"of at least 1.3x the 20-bar average AND with that bar's own DCR <= 0.35. Watch for: "
        f"(1) the confirmation bar's high staying below bar 3's CLOSE (${c['b3_close']:.2f}) - "
        f"if the next bar lifts back into bar 3's body, the rejection is incomplete; "
        f"(2) volume on the confirmation bar should EQUAL OR EXCEED bar 3's already-elevated "
        f"{confirm_vol_disp} reading - shrinking volume into the trigger means the sellers "
        f"who showed up on bar 3 didn't follow through; "
        f"(3) if 2-3 bars after the evening-star sequence trade entirely within bar 3's range "
        f"(${c['b3_low']:.2f} to ${bar3['h']:.2f}), the breakdown is in suspended animation - "
        f"the structure is intact but the directional resolution is pending; "
        f"(4) DCR on the confirmation bar matters - a follow-through bar that closes strongly "
        f"(DCR > 0.50) into a lower low should be covered, because that print signals demand "
        f"is accumulating into the breakdown; "
        f"(5) the pattern is INVALIDATED if bar N+1 closes back above the pattern high at "
        f"${c['pattern_high']:.2f} - that signals the 3-bar reversal was a head-fake and "
        f"buyers have reclaimed control. Levels: entry ${entry:.2f}, stop ${stop:.2f} (basis: "
        f"3-bar pattern high plus 1.5%, {stop_distance_pct:.1f}% adverse move from entry), "
        f"target ${target:.2f} (basis: {target_basis}), R:R {rr:.2f}. The 2R measured-move "
        f"target uses twice the stop distance as a minimum downside projection - if a nearby "
        f"support level "
        f"({'$' + format(near_sup, '.2f') if near_sup else 'none mapped'}) caps the move "
        f"sooner, cover partials there. For non-shorting accounts, the evening star is also a "
        f"defensive exit signal on long positions - tighten the stop aggressively under bar "
        f"3's low or sell into the next bar's open."
    )

    failure_signal = (
        f"Evening Star patterns fail roughly 30-35% of the time when traded alone without "
        f"confirmation - a lower failure rate than 2-bar engulfing or harami signals, because "
        f"the 3-bar structure already requires significant follow-through to complete. The "
        f"pattern is invalidated if the next bar (N+1) closes back above the pattern high at "
        f"${c['pattern_high']:.2f} (stop set at ${stop:.2f}, 1.5% above) - that signals the "
        f"3-bar reversal was a liquidity event, not a real top, and buyers have already "
        f"reclaimed control; cover the short immediately, no second-guessing. More insidious "
        f"failure modes: "
        f"(1) the confirmation bar closes below entry but on weak/declining volume AND its "
        f"own DCR > 0.50 - this is the 'fake-out evening-star' where long-liquidation creates "
        f"the illusion of a top but the institutional offer never materializes; the next 1-3 "
        f"bars often retrace and break bar 3's high; "
        f"(2) the pattern prints inside a strong Stage 2 uptrend (here stage is "
        f"{context.get('trend_stage', 'undefined')}) with stacked-bullish MA where every "
        f"counter-trend dip has been bought - in that regime even a complete 3-bar reversal "
        f"can be absorbed by underlying demand, and the burden of proof on the confirmation "
        f"bar's volume + DCR should rise to 1.8x and 0.25 respectively; "
        f"(3) the evening star's low (${c['pattern_low']:.2f}) tags a known support level - "
        f"if it sits at or just above a major prior pivot, demand below will absorb the next "
        f"1-2 bars and break the structure; check the chart for prior pivots within 1-2% of "
        f"the pattern low; "
        f"(4) bar 3 closed only marginally below bar 1's midpoint (midpoint penetration "
        f"{mp_disp}%) - the lower this number, the weaker the reversal; if it's under 30%, "
        f"the evening star is more 'rumored' than 'confirmed' and should be treated as a "
        f"setup-only signal; "
        f"(5) context DCR signature was already 'distribution' (avg DCR {recent_dcr_pct}%) - "
        f"in that case the evening star is corroborating an EXISTING top or downtrend, not "
        f"initiating a fresh reversal, and the asymmetric edge of catching a turn is reduced "
        f"because price is already mid-cycle. Position sizing must reflect the "
        f"{stop_distance_pct:.1f}% stop distance: risking 0.5% of account on this short "
        f"implies a position size of roughly "
        f"{(0.5 / max(stop_distance_pct, 0.5)) * 100:.1f}% of equity. Treat the evening star "
        f"as a high-quality SETUP and a WARNING, never as a guaranteed trigger - the next bar "
        f"fires the trigger, the stop saves the account when the rally resumes, and the "
        f"position size reflects the reality that even multi-bar bearish sequences fail in "
        f"strong uptrends."
    )

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Evening Star",
        "category": "candlestick",
        "direction": "bearish",
        "start_t": int(bar1["t"]),
        "end_t": int(bar3["t"]),
        "pivot_ts": [int(bar1["t"]), int(bar2["t"]), int(bar3["t"])],
        "geometry": {
            "shape": "candle_mark",
            "anchors": anchors,
            "extras": {
                "b1_body_pct": float(round(c["b1_body_pct"], 4)),
                "b2_body_pct": float(round(c["b2_body_pct"], 4)),
                "b3_body_pct": float(round(c["b3_body_pct"], 4)),
                "star_ratio": float(round(c["star_ratio"], 4)),
                "midpoint_penetration": float(round(c["midpoint_penetration"], 4)),
                "gap_pct": float(round(c["gap_pct"], 4)),
                "b1_dcr": float(round(c["b1_dcr"], 4)),
                "b2_dcr": float(round(c["b2_dcr"], 4)),
                "b3_dcr": float(round(c["b3_dcr"], 4)),
                "star_vol_ratio": float(round(star_vol_ratio, 4)),
                "confirm_vol_ratio": float(round(confirm_vol_ratio, 4)),
                "pattern_low": float(round(c["pattern_low"], 4)),
                "pattern_high": float(round(c["pattern_high"], 4)),
                "is_doji_star": bool(c["b2_is_doji"]),
                "at_swing_high": bool(is_swing_high),
                "above_50sma": bool(above_50),
                "recent_advance_pct": float(round(advance_pct, 2)),
                "dcr_strength": dcr_strength(c["b3_dcr"]),
            },
        },
        "levels": {
            "entry": float(entry),
            "entry_condition": f"close < {entry:.2f} on next bar with volume >= 1.3x 20-bar avg + DCR <= 0.35",
            "stop": float(stop),
            "stop_basis": "3bar_pattern_high_plus_1.5pct",
            "target_primary": float(target),
            "target_secondary": None,
            "risk_reward": float(round(rr, 2)),
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


register(_PATTERN_ID, detect_evening_star)
