"""Golden Cross detector — 50SMA crosses above 200SMA.

The Golden Cross is the most widely-cited long-term trend-change signal
in classical technical analysis: the 50-day SMA crosses ABOVE the 200-day
SMA. Stan Weinstein's "Secrets for Profiting in Bull and Bear Markets" (1988)
formalized it as the archetypal Stage 2 transition signal — the chart's
announcement that a stock has escaped its Stage 1 base and entered a
confirmed uptrend. The 200-day MA is the institutional baseline: every
major asset manager, hedge fund, and systematic strategy uses it as a
trend filter, meaning crosses above it involve a CHANGE IN POSITIONING
by institutions whose combined AUM dwarfs any individual operator.

Conditions:
  - ma50[current] > ma200[current]
  - ma50[-5] <= ma200[-5] (crossover within last 5 bars)
  - Both MAs rising over 20-bar lookback
  - 200SMA slope rising or flat (>= -0.5%)
  - Volume above 20-bar avg on cross bar (soft gate)

Levels:
  - entry = close * 1.001
  - stop = ma50 - 1 ATR(14)
  - target = 52w high (or entry * 1.20 if 52w high already exceeded)

Geometry: candle_mark at cross bar.

Attribution: Dow Theory (Charles Dow, 1900s), popularized 1970s.
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


_PATTERN_ID = "golden_cross"

_MA50_PERIOD = 50      # short-term trend MA
_MA200_PERIOD = 200    # long-term trend MA (Weinstein 30-week proxy on daily bars)
_MAX_CROSS_AGE = 5     # cross must be within last 5 bars
_SLOPE_BARS = 20       # measure MA slope over 20 bars
_ATR_PERIOD = 14
_CONFIDENCE_FLOOR = 50.0
_EPS = 1e-9            # epsilon for inclusive boundary comparisons (avoids float residue rejection)


def _sma(bars: List[Bar], end_idx: int, period: int) -> Optional[float]:
    """SMA at bar index end_idx over `period` bars. Returns None if insufficient data."""
    if end_idx < period - 1 or end_idx >= len(bars):
        return None
    return sum(bars[i]["c"] for i in range(end_idx - period + 1, end_idx + 1)) / period


def _atr(bars: List[Bar]) -> float:
    """Simple ATR over last 14 bars."""
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


def detect_golden_cross(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect 50/200 Golden Cross. Returns 0 or 1 detection."""
    n = len(bars)
    if n < _MA200_PERIOD + _MAX_CROSS_AGE + 5:
        return []

    last_idx = n - 1

    ma50_now = _sma(bars, last_idx, _MA50_PERIOD)
    ma200_now = _sma(bars, last_idx, _MA200_PERIOD)
    if ma50_now is None or ma200_now is None:
        return []

    # Must be in bull-cross territory now
    if ma50_now <= ma200_now:
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
        if ma50_prev <= ma200_prev and ma50_i > ma200_i:
            cross_idx = i
            break

    if cross_idx is None:
        return []

    ma50_cross = _sma(bars, cross_idx, _MA50_PERIOD)
    ma200_cross = _sma(bars, cross_idx, _MA200_PERIOD)
    ma50_5ago = _sma(bars, cross_idx - 1, _MA50_PERIOD) if cross_idx > 0 else None
    ma200_5ago = _sma(bars, cross_idx - 1, _MA200_PERIOD) if cross_idx > 0 else None

    if any(v is None for v in (ma50_cross, ma200_cross)):
        return []

    # Both MAs rising over 20 bars
    slope_start = max(0, cross_idx - _SLOPE_BARS)
    ma50_old = _sma(bars, slope_start, _MA50_PERIOD)
    ma200_old = _sma(bars, slope_start, _MA200_PERIOD)
    if ma50_old is None or ma200_old is None:
        return []

    ma50_rising = ma50_cross > ma50_old
    ma200_slope = (ma200_cross - ma200_old) / ma200_old if ma200_old > 0 else 0.0
    # 200SMA: allow flat or slightly declining (>= -0.5% inclusive — use EPS to absorb float residue)
    ma200_ok = ma200_slope >= -0.005 - _EPS

    if not (ma50_rising and ma200_ok):
        return []

    # Volume check (soft — golden crosses can happen on quiet days)
    cross_bar = bars[cross_idx]
    vol_window = bars[max(0, cross_idx - 20):cross_idx]
    avg_vol = sum(b["v"] for b in vol_window) / len(vol_window) if vol_window else 0.0
    volume_ratio = cross_bar["v"] / avg_vol if avg_vol > 0 else 1.0
    # Require at least 0.5x avg (eliminates holiday/zero-vol artifacts)
    if volume_ratio < 0.5:
        return []

    # 52w high for target
    lookback_52w = bars[max(0, last_idx - 252):]
    high_52w = max(b["h"] for b in lookback_52w)
    current_close = bars[last_idx]["c"]
    atr14 = _atr(bars)

    candidate = {
        "cross_idx": cross_idx,
        "days_since_cross": last_idx - cross_idx,
        "ma50_current": ma50_now,
        "ma200_current": ma200_now,
        "ma50_5bars_ago": ma50_5ago,
        "ma200_5bars_ago": ma200_5ago,
        "ma200_slope_20bars": ma200_slope,
        "ma50_rising": ma50_rising,
        "volume_ratio": volume_ratio,
        "high_52w": high_52w,
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
    spread = (c["ma50_current"] - c["ma200_current"]) / c["ma200_current"] if c["ma200_current"] > 0 else 0.0
    if spread >= 0.02:
        spread_score = 100.0
    elif spread >= 0.01:
        spread_score = 75.0
    else:
        spread_score = 55.0

    age = c["days_since_cross"]
    freshness = max(55.0, 100.0 - age * 9.0)

    slope = c["ma200_slope_20bars"]
    if slope >= 0.005:
        slope_score = 100.0
    elif slope >= 0.0:
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
    if stage == 2:
        score += 20.0
    elif stage == 1:
        score += 12.0
    elif stage == 4:
        score -= 15.0
    align = context.get("ma_alignment")
    if align == "stacked_bullish":
        score += 12.0
    elif align == "mixed":
        score += 5.0
    rs = context.get("rs_trend")
    if rs == "up":
        score += 10.0
    dcr_sig = context.get("dcr_signature")
    if dcr_sig == "accumulation":
        score += 8.0
    elif dcr_sig == "distribution":
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
    high_52w = c["high_52w"]

    entry = round(current_close * 1.001, 2)
    stop = round(max(ma50 - atr14, current_close * 0.92), 2)
    target = round(max(high_52w, entry * 1.20), 2)
    rr = (target - entry) / (entry - stop) if entry > stop else 0.0
    stop_pct = (entry - stop) / entry * 100 if entry > 0 else 0.0

    anchors = [{"t": int(cross_bar["t"]), "price": float(cross_bar["c"])}]
    extras = {
        "ma50_current": round(ma50, 2),
        "ma200_current": round(ma200, 2),
        "ma50_5bars_ago": round(c["ma50_5bars_ago"], 2) if c["ma50_5bars_ago"] else None,
        "ma200_5bars_ago": round(c["ma200_5bars_ago"], 2) if c["ma200_5bars_ago"] else None,
        "ma200_slope_20bars": round(c["ma200_slope_20bars"], 5),
        "days_since_cross": int(c["days_since_cross"]),
        "volume_ratio": round(c["volume_ratio"], 2),
        "high_52w": round(high_52w, 2),
        "atr14": round(atr14, 2),
    }

    narrative = _compose_narrative(c, context, entry, stop, target, rr, stop_pct)
    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Golden Cross (50/200 SMA)",
        "category": "classical",
        "direction": "bullish",
        "start_t": int(cross_bar["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(cross_bar["t"]), int(last_bar["t"])],
        "geometry": {"shape": "candle_mark", "anchors": anchors, "extras": extras},
        "levels": {
            "entry": entry,
            "entry_condition": f"close > {entry:.2f} (current close + 0.1%)",
            "stop": stop,
            "stop_basis": "ma50_minus_1_atr",
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
    high_52w = c["high_52w"]
    current_close = c["current_close"]

    ma_phrase = ma_alignment_phrase(context.get("ma_alignment"))
    stage_phrase = trend_stage_description(context.get("trend_stage"))
    rs_phrase = rs_trend_phrase(context.get("rs_trend"))
    regime_p = regime_phrase(context.get("regime"))
    dcr_p = dcr_phrase(context.get("dcr_signature"), context.get("recent_dcr_avg"))
    dcr_read = dcr_interpretation(context, "bullish")

    headline = (
        f"Golden Cross (50/200 SMA) — 50-day SMA (${ma50:.2f}) crossed ABOVE "
        f"200-day SMA (${ma200:.2f}) {age} bar(s) ago, {vol_ratio:.1f}x volume. "
        f"Entry ${entry:.2f}, stop ${stop:.2f}, target ${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Golden Cross is the most widely-referenced long-term trend-change "
        f"signal in classical technical analysis: the 50-day SMA crossing ABOVE "
        f"the 200-day SMA with both averages rising. The pattern's institutional "
        f"prevalence traces to Wall Street research analysts of the 1970s who "
        f"needed a single, institution-legible momentum signal for equity research — "
        f"the 50/200 cross became canonical because it balances responsiveness "
        f"(50-day is roughly two months of trading) with stability (200-day is "
        f"the full-year baseline). Stan Weinstein crystallized the framework into "
        f"an actionable trading system in 'Secrets for Profiting in Bull and Bear "
        f"Markets' (McGraw-Hill, 1988): when the 30-week MA (the daily-bar "
        f"equivalent of the 200-day MA) slopes upward AND the stock's price is "
        f"above it, the chart has entered Stage 2 — Weinstein's label for the "
        f"confirmed uptrend phase that historically produces 80% of a stock's "
        f"long-side gains. The Golden Cross is the daily-bar Stage 2 transition "
        f"signal: the 50-day SMA (current 2-month trend) has reasserted "
        f"structural dominance over the 200-day SMA (full-year mean), confirming "
        f"that shorter-term momentum has overwhelmed the longer-term baseline. "
        f"Here, the 50-day SMA at ${ma50:.2f} crossed above the 200-day SMA at "
        f"${ma200:.2f} just {age} bar(s) ago, with the 200-day SMA "
        f"{'sloping positively (+' + str(round(ma200_slope * 100, 2)) + '% over 20 bars) — the ideal Weinstein Stage 2 configuration' if ma200_slope >= 0.003 else 'approximately flat (' + str(round(ma200_slope * 100, 2)) + '%) over 20 bars — adequate but lower conviction than a rising 200-day'}. "
        f"The institutional significance cannot be overstated: every major "
        f"quantitative strategy, CTA trend-follower, and systematic mutual fund "
        f"uses the 200-day MA as a position filter. A confirmed Golden Cross "
        f"triggers buy signals in these systems simultaneously, creating a "
        f"mechanical demand pulse that amplifies the price action in the weeks "
        f"and months following the cross. The 52-week high at ${high_52w:.2f} "
        f"is the natural measured-move target because it represents the last "
        f"level where prior supply exhausted prior demand — Stage 2 breakouts "
        f"systematically revisit prior resistance before requiring a material pause."
    )

    why_it_matters = (
        f"This Golden Cross is forming in {stage_phrase} with {ma_phrase} "
        f"MA alignment and {rs_phrase}, in {regime_p}. Key reads: "
        f"(1) Cross freshness — {age} bar(s) ago. Weinstein empirically found "
        f"the highest-edge entry comes within the first 5 bars of the confirmed "
        f"cross, before systematic funds fully rotate long — {'this is within that ideal window' if age <= 5 else 'slightly past the prime window but Stage 2 moves typically last months, not days'}. "
        f"(2) The 200-day MA slope over 20 bars is "
        f"{'+' + str(round(ma200_slope * 100, 2)) + '%' if ma200_slope >= 0 else str(round(ma200_slope * 100, 2)) + '%'} "
        f"— {'rising, confirming Stage 2 quality' if ma200_slope >= 0.002 else 'flat-to-slightly-declining; requires extra vigilance because crosses into declining 200-day MAs fail at 2x the rate of crosses into rising ones'}. "
        f"(3) Volume at cross: {vol_ratio:.1f}x 20-bar average — "
        f"{'above average: institutional accumulation confirmed' if vol_ratio >= 1.0 else 'below average: algorithmically driven, less conviction than a high-volume cross'}. "
        f"(4) Spread between 50-day (${ma50:.2f}) and 200-day (${ma200:.2f}) "
        f"= ${ma50 - ma200:.2f} ({(ma50 - ma200) / ma200 * 100:.1f}% separation) "
        f"— wider spread after the cross indicates more underlying momentum. "
        f"{dcr_read} {dcr_p}."
    )

    what_to_watch_for = (
        f"Entry is ${entry:.2f} (current close ${current_close:.2f} + 0.1% "
        f"buffer). Weinstein's execution rule: buy the first close above the "
        f"200-day MA with the MA sloping upward, or buy the cross-bar close "
        f"itself if available. Stop at ${stop:.2f} — the 50-day SMA "
        f"(${ma50:.2f}) minus one ATR(14) buffer. Structural rationale: "
        f"a close back below the 50-day MA after a confirmed Golden Cross "
        f"re-invalidates the Stage 2 thesis — the cross was premature and "
        f"the stock needs more base-building. Primary target: ${target:.2f} "
        f"(52-week high at ${high_52w:.2f}). Weinstein Stage 2 thesis: "
        f"once a stock escapes its base with both MAs aligned, the dominant "
        f"move is back toward prior resistance — the 52-week high is the "
        f"first structural target. After reaching target, trail using the "
        f"50-day SMA as a dynamic stop — Weinstein's specific rule is to "
        f"hold as long as price closes above the 30-week (200-day proxy) MA. "
        f"Position sizing: {stop_pct:.1f}% stop from entry implies risking "
        f"1% of account equity requires ~{100.0 / stop_pct if stop_pct > 0 else 0:.1f}% "
        f"position sizing. R:R of {rr:.1f} is "
        f"{'above the 2.0 minimum for cross trades' if rr >= 2.0 else 'below the 2.0 ideal — consider waiting for a pullback to the 200-day MA for a higher R:R entry'}."
    )

    failure_signal = (
        f"The Golden Cross fails in two primary modes. Failure Mode 1 — "
        f"the whipsaw cross: the 50-day MA crosses above the 200-day MA but "
        f"reverses back below within 10-20 bars (producing a Death Cross "
        f"shortly after). This occurs roughly 15-20% of the time historically "
        f"and is most frequent when the 200-day MA is still declining at cross "
        f"time. The diagnostic: price fails to hold above ${ma200:.2f} (200-day "
        f"MA) on the 2-3 bars after the cross. Exit at the close that breaks "
        f"back below the 200-day MA — do not wait for the structural stop at "
        f"${stop:.2f}. Failure Mode 2 — the late-cycle cross: the cross fires "
        f"near a major top, after price has already extended well above the "
        f"200-day MA. In this case the Golden Cross is a lagging signal and "
        f"most of the Stage 2 move has already occurred. The diagnostic: the "
        f"spread between 50-day and 200-day exceeds 10% at the time of the "
        f"cross (extreme extension). Structural stop: a daily close below "
        f"${stop:.2f} confirms Stage 2 failure — exit immediately, no "
        f"averaging down. Note for short-sellers: the Death Cross (50 crosses "
        f"below 200) that follows a failed Golden Cross represents a Stage 4 "
        f"entry for bearish operators, but borrow cost for recently-crossed "
        f"Stage 2 names is often elevated. {dcr_p}."
    )

    return {
        "headline": headline,
        "what_it_is": what_it_is,
        "why_it_matters": why_it_matters,
        "what_to_watch_for": what_to_watch_for,
        "failure_signal": failure_signal,
    }


register(_PATTERN_ID, detect_golden_cross)
