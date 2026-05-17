"""Death Cross detector — 50SMA crosses below 200SMA.

The Death Cross is the bearish mirror of the Golden Cross: the 50-day SMA
crosses BELOW the 200-day SMA with both MAs declining. Stan Weinstein's
"Secrets for Profiting in Bull and Bear Markets" (1988) identifies this as
the archetypal Stage 4 transition signal — the chart's announcement that a
stock has entered a confirmed downtrend. Institutions use the 200-day MA as
a long-side filter; when the Death Cross fires, systematic strategies flip
from long to neutral/short, creating mechanical selling pressure.

Important caveat for short-side operators: Death Cross trades require
verified locate/borrow availability before entry. Stocks in Stage 4 decline
often see borrow rates spike as short interest grows — confirm borrow cost
and availability with your prime broker before sizing a short position.

Conditions:
  - ma50[current] < ma200[current]
  - ma50 >= ma200 on the bar immediately before the detected cross
    (cross within last 5 bars)
  - Both MAs declining over 20-bar lookback
  - 200SMA slope declining or flat (slope <= +0.5%, inclusive with float epsilon)
  - Volume: hard floor of 0.5x 20-bar average (bars below 0.5x are rejected
    as illiquid artifacts); above 0.5x the ratio is a soft, score-contributing gate

Levels:
  - entry = close * 0.999 (short entry slightly below current close)
  - stop = ma50 + 1 ATR(14)  (above the 50-day MA)
  - target = 52w low (or entry * 0.80)

Geometry: candle_mark at cross bar.

Attribution: Dow Theory (Charles Dow, 1900s), Weinstein Stage 4.
Stan Weinstein, "Secrets for Profiting in Bull and Bear Markets" (1988).
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.narrative_helpers import (
    dcr_phrase, dcr_interpretation, ma_alignment_phrase, regime_phrase,
    rs_trend_phrase, trend_stage_description,
)
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "death_cross"

_MA50_PERIOD = 50
_MA200_PERIOD = 200
_MAX_CROSS_AGE = 5
_SLOPE_BARS = 20
_ATR_PERIOD = 14
_CONFIDENCE_FLOOR = 50.0
_EPS = 1e-9            # defensive epsilon for the +0.005 slope gate; belt-and-suspenders, not
                       # load-bearing for current inputs: the boundary series produces
                       # slope = -0.00551 << +0.005 (passes the plain gate already).
                       # The natural death-cross construction (flat phase + decline) cannot
                       # land the slope exactly at +0.005 — the flat phase drops the 200SMA
                       # slope to around -0.005 to -0.015. Kept because: (a) non-integer
                       # price series on other hardware could accumulate different float
                       # residue at the exact threshold, and (b) future refactors might
                       # introduce exact-boundary inputs.


def _sma(bars: List[Bar], end_idx: int, period: int) -> Optional[float]:
    if end_idx < period - 1 or end_idx >= len(bars):
        return None
    return sum(bars[i]["c"] for i in range(end_idx - period + 1, end_idx + 1)) / period


def _atr(bars: List[Bar]) -> float:
    if len(bars) < 2:
        return 0.0
    window = bars[-_ATR_PERIOD - 1:] if len(bars) > _ATR_PERIOD else bars
    trs = []
    for i in range(1, len(window)):
        b = window[i]
        pc = window[i - 1]["c"]
        tr = max(b["h"] - b["l"], abs(b["h"] - pc), abs(b["l"] - pc))
        trs.append(tr)
    return sum(trs) / len(trs) if trs else 0.0


def detect_death_cross(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect 50/200 Death Cross. Returns 0 or 1 detection."""
    n = len(bars)
    if n < _MA200_PERIOD + _MAX_CROSS_AGE + 5:
        return []

    last_idx = n - 1

    ma50_now = _sma(bars, last_idx, _MA50_PERIOD)
    ma200_now = _sma(bars, last_idx, _MA200_PERIOD)
    if ma50_now is None or ma200_now is None:
        return []

    # Must be in bearish-cross territory now
    if ma50_now >= ma200_now:
        return []

    # Find cross within last MAX_CROSS_AGE bars
    cross_idx = None
    for i in range(last_idx, max(last_idx - _MAX_CROSS_AGE, _MA200_PERIOD - 1), -1):
        ma50_i = _sma(bars, i, _MA50_PERIOD)
        ma50_prev = _sma(bars, i - 1, _MA50_PERIOD)
        ma200_i = _sma(bars, i, _MA200_PERIOD)
        ma200_prev = _sma(bars, i - 1, _MA200_PERIOD)
        if any(v is None for v in (ma50_i, ma50_prev, ma200_i, ma200_prev)):
            continue
        if ma50_prev >= ma200_prev and ma50_i < ma200_i:
            cross_idx = i
            break

    if cross_idx is None:
        return []

    ma50_cross = _sma(bars, cross_idx, _MA50_PERIOD)
    ma200_cross = _sma(bars, cross_idx, _MA200_PERIOD)
    ma50_pre_cross = _sma(bars, cross_idx - 1, _MA50_PERIOD) if cross_idx > 0 else None
    ma200_pre_cross = _sma(bars, cross_idx - 1, _MA200_PERIOD) if cross_idx > 0 else None

    if any(v is None for v in (ma50_cross, ma200_cross)):
        return []

    slope_start = max(0, cross_idx - _SLOPE_BARS)
    ma50_old = _sma(bars, slope_start, _MA50_PERIOD)
    ma200_old = _sma(bars, slope_start, _MA200_PERIOD)
    if ma50_old is None or ma200_old is None:
        return []

    # Both MAs declining
    ma50_declining = ma50_cross < ma50_old
    ma200_slope = (ma200_cross - ma200_old) / ma200_old if ma200_old > 0 else 0.0
    # 200SMA: allow flat or slightly rising (<= +0.5% inclusive — use EPS to absorb float residue)
    ma200_ok = ma200_slope <= 0.005 + _EPS

    if not (ma50_declining and ma200_ok):
        return []

    cross_bar = bars[cross_idx]
    vol_window = bars[max(0, cross_idx - 20):cross_idx]
    avg_vol = sum(b["v"] for b in vol_window) / len(vol_window) if vol_window else 0.0
    volume_ratio = cross_bar["v"] / avg_vol if avg_vol > 0 else 1.0
    if volume_ratio < 0.5:
        return []

    # 52w low for target
    lookback_52w = bars[max(0, last_idx - 252):]
    low_52w = min(b["l"] for b in lookback_52w)
    current_close = bars[last_idx]["c"]
    atr14 = _atr(bars)

    candidate = {
        "cross_idx": cross_idx,
        "days_since_cross": last_idx - cross_idx,
        "ma50_current": ma50_now,
        "ma200_current": ma200_now,
        "ma50_pre_cross": ma50_pre_cross,
        "ma200_pre_cross": ma200_pre_cross,
        "ma200_slope_20bars": ma200_slope,
        "ma50_declining": ma50_declining,
        "volume_ratio": volume_ratio,
        "low_52w": low_52w,
        "current_close": current_close,
        "atr14": atr14,
        "cross_bar": cross_bar,
        "avg_vol": avg_vol,
    }

    geom_score = _score_geometry(candidate)
    vol_score = _score_volume(candidate)
    ctx_score = _score_context(context)
    hist_score = 50.0

    confidence = round(
        0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
    )
    if confidence < _CONFIDENCE_FLOOR:
        return []

    return [_build_detection(bars, candidate, confidence, context,
                             geom_score, vol_score, ctx_score, hist_score)]


def _score_geometry(c: dict) -> float:
    spread = (c["ma200_current"] - c["ma50_current"]) / c["ma200_current"] if c["ma200_current"] > 0 else 0.0
    if spread >= 0.02:
        spread_score = 100.0
    elif spread >= 0.01:
        spread_score = 75.0
    else:
        spread_score = 55.0

    age = c["days_since_cross"]
    freshness = max(55.0, 100.0 - age * 9.0)

    slope = c["ma200_slope_20bars"]
    if slope <= -0.005:
        slope_score = 100.0
    elif slope <= 0.0:
        slope_score = 75.0
    else:
        slope_score = 55.0

    return round(min(100.0, 0.40 * spread_score + 0.35 * freshness + 0.25 * slope_score), 2)


def _score_volume(c: dict) -> float:
    vr = c["volume_ratio"]
    if vr >= 2.0:
        return 100.0
    if vr >= 1.5:
        return 80.0
    if vr >= 1.0:
        return 65.0
    return 50.0


def _score_context(context: dict) -> float:
    score = 50.0
    stage = context.get("trend_stage")
    if stage == 4:
        score += 20.0
    elif stage == 3:
        score += 12.0
    elif stage == 2:
        score -= 15.0  # bull market death cross = counter-trend
    align = context.get("ma_alignment")
    if align == "stacked_bearish":
        score += 12.0
    elif align == "mixed":
        score += 5.0
    rs = context.get("rs_trend")
    if rs == "down":
        score += 10.0
    dcr_sig = context.get("dcr_signature")
    if dcr_sig == "distribution":
        score += 8.0
    elif dcr_sig == "accumulation":
        score -= 8.0
    return min(100.0, max(0.0, score))


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    cross_bar = c["cross_bar"]
    last_bar = bars[-1]
    current_close = c["current_close"]
    ma50 = c["ma50_current"]
    ma200 = c["ma200_current"]
    atr14 = c["atr14"]
    low_52w = c["low_52w"]

    entry = round(current_close * 0.999, 2)  # short entry slightly below close
    stop = round(min(ma50 + atr14, current_close * 1.08), 2)  # above 50-day MA
    target = round(min(low_52w, entry * 0.80), 2)
    rr = (entry - target) / (stop - entry) if stop > entry else 0.0
    stop_pct = (stop - entry) / entry * 100 if entry > 0 else 0.0

    anchors = [{"t": int(cross_bar["t"]), "price": float(cross_bar["c"])}]
    extras = {
        "ma50_current": round(ma50, 2),
        "ma200_current": round(ma200, 2),
        "ma50_pre_cross": round(c["ma50_pre_cross"], 2) if c["ma50_pre_cross"] else None,
        "ma200_pre_cross": round(c["ma200_pre_cross"], 2) if c["ma200_pre_cross"] else None,
        "ma200_slope_20bars": round(c["ma200_slope_20bars"], 5),
        "days_since_cross": int(c["days_since_cross"]),
        "volume_ratio": round(c["volume_ratio"], 2),
        "low_52w": round(low_52w, 2),
        "atr14": round(atr14, 2),
    }

    narrative = _compose_narrative(c, context, entry, stop, target, rr, stop_pct)
    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Death Cross (50/200 SMA)",
        "category": "classical",
        "direction": "bearish",
        "start_t": int(cross_bar["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(cross_bar["t"]), int(last_bar["t"])],
        "geometry": {"shape": "candle_mark", "anchors": anchors, "extras": extras},
        "levels": {
            "entry": entry,
            "entry_condition": f"short below {entry:.2f}. Verify borrow/locate before entry.",
            "stop": stop,
            "stop_basis": "ma50_plus_1_atr",
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
        "status": "ready",
        "outcome": None,
        "detected_at": now,
        "last_seen_at": now,
    }


def _compose_narrative(c, context, entry, stop, target, rr, stop_pct) -> dict:
    ma50 = c["ma50_current"]
    ma200 = c["ma200_current"]
    age = c["days_since_cross"]
    vol_ratio = c["volume_ratio"]
    ma200_slope = c["ma200_slope_20bars"]
    low_52w = c["low_52w"]
    current_close = c["current_close"]

    ma_phrase = ma_alignment_phrase(context.get("ma_alignment"))
    stage_phrase = trend_stage_description(context.get("trend_stage"))
    rs_phrase = rs_trend_phrase(context.get("rs_trend"))
    regime_p = regime_phrase(context.get("regime"))
    dcr_p = dcr_phrase(context.get("dcr_signature"), context.get("recent_dcr_avg"))
    dcr_read = dcr_interpretation(context, "bearish")

    headline = (
        f"Death Cross (50/200 SMA) — 50-day SMA (${ma50:.2f}) crossed BELOW "
        f"200-day SMA (${ma200:.2f}) {age} bar(s) ago, {vol_ratio:.1f}x volume. "
        f"Short entry ${entry:.2f}, stop ${stop:.2f}, target ${target:.2f}, R:R {rr:.1f}. "
        f"Confirm borrow availability before entry."
    )

    what_it_is = (
        f"The Death Cross is the bearish mirror of the Golden Cross and the "
        f"archetypal Stage 4 transition signal in Stan Weinstein's framework: "
        f"the 50-day SMA crossing BELOW the 200-day SMA with both averages "
        f"declining. The signal carries the same institutional weight as the "
        f"Golden Cross in reverse — systematic strategies that use the 200-day "
        f"MA as a long-side filter will flip from full-weight long to "
        f"neutral/short simultaneously when the Death Cross fires, creating a "
        f"mechanical selling wave. Weinstein documented in 'Secrets for "
        f"Profiting in Bull and Bear Markets' (1988) that Stage 4 declinesAfter "
        f"a Death Cross confirmation produce the most sustained and largest "
        f"drawdowns in equity markets — this is the phase where the stock's "
        f"fundamentals have deteriorated enough that institutions are actively "
        f"liquidating, not just underweighting. Here, the 50-day SMA at "
        f"${ma50:.2f} crossed below the 200-day SMA at ${ma200:.2f} just "
        f"{age} bar(s) ago, with the 200-day SMA "
        f"{'declining (' + str(round(ma200_slope * 100, 2)) + '% over 20 bars) — full Stage 4 configuration' if ma200_slope < -0.002 else 'approximately flat (' + str(round(ma200_slope * 100, 2)) + '%) — Stage 3/4 transition'} "
        f"over the past 20 bars. The 52-week low at ${low_52w:.2f} is the "
        f"natural target: Weinstein's Stage 4 thesis holds that once both MAs "
        f"are aligned bearishly, the dominant move is toward prior support "
        f"levels — in extended declines, prior yearly lows are frequently "
        f"violated as institutional holders exhaust their liquidation. "
        f"CRITICAL OPERATIONAL NOTE: short-side Death Cross trades require "
        f"confirmed locate and borrow availability BEFORE entry. Stocks in "
        f"Stage 4 decline often see short interest grow rapidly, borrow rates "
        f"spike (1-15% annualized or higher), and locate availability shrink. "
        f"Operators who enter the short without confirming borrow face "
        f"forced-buy-in risk at the worst possible moment."
    )

    why_it_matters = (
        f"This Death Cross is forming in {stage_phrase} with {ma_phrase} MA "
        f"alignment and {rs_phrase}, in {regime_p}. Key reads: "
        f"(1) Cross freshness — {age} bar(s) ago. The highest-edge short "
        f"entry comes within the first 5 bars of the confirmed Death Cross, "
        f"before systematic funds have fully rotated short — "
        f"{'this is within the ideal window' if age <= 5 else 'slightly past the prime window but Stage 4 declines typically run for months'}. "
        f"(2) The 200-day MA slope is "
        f"{str(round(ma200_slope * 100, 2)) + '%'} over 20 bars — "
        f"{'declining, confirming Stage 4 quality' if ma200_slope < -0.002 else 'flat; adequate but lower-conviction than a clearly declining 200-day MA'}. "
        f"(3) Volume at the cross: {vol_ratio:.1f}x 20-bar average — "
        f"{'above average: institutional distribution confirmed' if vol_ratio >= 1.0 else 'below average; systematic, not panic-driven'}. "
        f"(4) Spread: 50-day at ${ma50:.2f} vs 200-day at ${ma200:.2f} = "
        f"${ma200 - ma50:.2f} separation ({(ma200 - ma50) / ma200 * 100:.1f}%). "
        f"{dcr_read} {dcr_p}."
    )

    what_to_watch_for = (
        f"Short entry ${entry:.2f} (current close ${current_close:.2f} minus "
        f"0.1%). MANDATORY pre-trade check: verify borrow availability and "
        f"confirm locate with your prime broker BEFORE entering the short. "
        f"Death Cross short trades on liquid names typically have HTB (hard-"
        f"to-borrow) rates of 0.5-5% annualized; on thinly-traded Stage 4 "
        f"names, rates can exceed 20% and locate may be unavailable entirely. "
        f"Stop at ${stop:.2f} — the 50-day SMA (${ma50:.2f}) plus one ATR "
        f"buffer. Structural rationale: a close above the 50-day MA after a "
        f"confirmed Death Cross re-invalidates the Stage 4 thesis. Primary "
        f"target: ${target:.2f} (52-week low at ${low_52w:.2f}). Weinstein's "
        f"Stage 4 thesis: Stage 4 declines systematically revisit prior yearly "
        f"lows before recovering. Trail the stop using the 50-day SMA as a "
        f"dynamic cover level — cover when price closes above the 50-day MA "
        f"(potential Stage 1 re-base). Position sizing: {stop_pct:.1f}% stop "
        f"from entry implies risking 1% of account requires approximately "
        f"{100.0 / stop_pct if stop_pct > 0 else 0:.1f}% of equity. Note: "
        f"borrow cost reduces the effective R:R — at 5% annualized borrow "
        f"on a 90-day hold, the effective cost is ~1.25% of position size, "
        f"which must be subtracted from the target return. R:R of {rr:.1f} "
        f"should be evaluated net of borrow cost."
    )

    failure_signal = (
        f"The Death Cross fails in two primary modes. Failure Mode 1 — the "
        f"whipsaw cross: the 50-day MA crosses below the 200-day MA but "
        f"reverses above it within 10-20 bars (producing a Golden Cross "
        f"shortly after). This occurs roughly 15-20% of the time and is "
        f"most frequent when the 200-day MA is still rising at the time of "
        f"the cross — a Death Cross into a still-rising 200-day MA is much "
        f"weaker. The diagnostic: price rallies above the 200-day MA "
        f"(${ma200:.2f}) within 2-3 bars of the cross. Cover immediately on "
        f"that close above the 200-day — do not hold for the structural stop "
        f"at ${stop:.2f}. Failure Mode 2 — the oversold bounce: the Death "
        f"Cross fires after an already-extended decline (price already well "
        f"below both MAs), and the cross coincides with a massive oversold "
        f"bounce that carries price back above both MAs within 20-40 bars. "
        f"The diagnostic: if price is more than 20% below the 200-day MA at "
        f"the time of the cross, the risk of a violent short-covering rally "
        f"is elevated. In this case the Death Cross is a confirmation of an "
        f"existing trend, NOT a fresh entry signal, and the risk-adjusted "
        f"entry is lower quality. Structural stop: a daily close above "
        f"${stop:.2f} confirms Stage 4 failure — cover immediately, no "
        f"averaging up. BORROW REMINDER: short-sellers must have confirmed "
        f"locate before entry — forced buy-in during an adverse move is "
        f"the most catastrophic failure mode for short-side Death Cross "
        f"trades. {dcr_p}."
    )

    return {
        "headline": headline,
        "what_it_is": what_it_is,
        "why_it_matters": why_it_matters,
        "what_to_watch_for": what_to_watch_for,
        "failure_signal": failure_signal,
    }


register(_PATTERN_ID, detect_death_cross)
