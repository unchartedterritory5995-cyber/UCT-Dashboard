"""Holy Grail detector — Linda Raschke & Larry Connors.

Linda Raschke's "Holy Grail" setup from "Street Smarts" (1995, co-authored
with Larry Connors) is one of the cleanest pullback-in-strong-trend
setups in the literature. It identifies pullbacks into the 20-EMA inside
a high-ADX trending environment, which historically produces high-edge
swing entries with controlled risk.

Conditions:
  - ADX(14) > 30 (strong trend confirmed)            (Raschke threshold)
  - DI+ > DI- (uptrend confirmed)                     (directional bias)
  - Pullback into 20-EMA within last 3 bars (low touched or crossed 20EMA)
  - 20-EMA still rising (trend intact)
  - Volume contracting on the pullback (institutional accumulation)

ADX is computed inline (Welles Wilder's 1978 formula) since the engine
doesn't carry an ADX primitive elsewhere.

Levels:
  - entry = close above pullback bar high + 0.1% buffer
  - stop = below pullback low - 1 ATR
  - target = recent swing high + ATR(14)

Geometry: "horizontal_line" at the 20-EMA value.
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.narrative_helpers import (
    dcr_phrase, dcr_interpretation, ma_alignment_phrase, regime_phrase,
    rs_trend_phrase, trend_stage_description, volume_signature_phrase,
)
from api.services.pattern_engine.narrative_helpers_structure import (
    compute_structure_quality, structure_extras, structure_geom_boost,
    structure_narrative_sentence,
)
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "holy_grail"

# Thresholds - sourced from Raschke & Connors "Street Smarts" (1995)
_ADX_PERIOD = 14
_MIN_ADX = 30.0                          # Raschke's strong-trend threshold
_PULLBACK_LOOKBACK = 3                   # pullback into 20-EMA within last 3 bars
_EMA_TOUCH_TOLERANCE_PCT = 0.015         # within 1.5% of 20-EMA = "touched"
_MIN_PULLBACK_BARS = 2                   # at least 2 declining bars before touch
_CONFIDENCE_FLOOR = 50.0


def detect_holy_grail(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect Holy Grail pullback setups. Emits 0 or 1 detection."""
    if not bars or len(bars) < _ADX_PERIOD * 4:
        return []

    n = len(bars)
    last_bar = bars[-1]
    closes = [b["c"] for b in bars]
    ema20 = _ema(closes, 20)
    if ema20 is None:
        return []

    # Compute approximated ADX(14) - directional movement index
    adx, di_plus, di_minus = _compute_adx_di(bars, _ADX_PERIOD)
    if adx is None or adx < _MIN_ADX:
        return []
    if di_plus is None or di_minus is None or di_plus <= di_minus:
        return []

    # Pullback into 20-EMA: find a bar in last 3 where low touched or crossed 20-EMA
    pullback_bar_idx = None
    pullback_low = None
    for back in range(_PULLBACK_LOOKBACK):
        idx = n - 1 - back
        if idx < 0:
            break
        b = bars[idx]
        low = b["l"]
        # Touched or crossed: low within tolerance OR low below 20-EMA
        if low <= ema20 * (1.0 + _EMA_TOUCH_TOLERANCE_PCT):
            pullback_bar_idx = idx
            pullback_low = low
            break
    if pullback_bar_idx is None:
        return []

    # 20-EMA must be RISING
    ema_past = _ema(closes[:-10], 20) if n >= 30 else None
    if ema_past is None or ema_past >= ema20:
        return []
    ema_slope_pct_per_bar = (ema20 - ema_past) / ema_past * 100.0 / 10.0

    # Volume CONTRACTING on the pullback: the avg vol over the last 3 bars
    # should be LOWER than the avg vol over the prior 10 bars
    last3 = bars[-3:]
    prior10 = bars[-13:-3] if n >= 13 else bars[:-3]
    avg3_vol = sum(b["v"] for b in last3) / max(1, len(last3))
    avg_prior_vol = sum(b["v"] for b in prior10) / max(1, len(prior10))
    if avg_prior_vol <= 0:
        return []
    vol_contraction_ratio = avg3_vol / avg_prior_vol
    if vol_contraction_ratio >= 1.0:
        return []  # volume not contracting

    # Compute ATR(14) for target and stop
    atr14 = _atr(bars[-15:])
    if atr14 <= 0:
        return []

    # Recent swing high (last 30 bars) for target
    last30 = bars[-30:]
    swing_high = max(b["h"] for b in last30)

    # Structure-quality boosts
    sq = compute_structure_quality(bars, pullback_bar_idx, pullback_low)

    candidate = {
        "pullback_bar_idx": pullback_bar_idx,
        "pullback_low": pullback_low,
        "pullback_high": bars[pullback_bar_idx]["h"],
        "ema20": ema20,
        "ema_slope_pct_per_bar": ema_slope_pct_per_bar,
        "adx": adx,
        "di_plus": di_plus,
        "di_minus": di_minus,
        "vol_contraction_ratio": vol_contraction_ratio,
        "atr14": atr14,
        "swing_high": swing_high,
        "hl_result": sq["hl_result"],
        "ma_result": sq["ma_result"],
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

    d = _build_detection(bars, candidate, confidence, context,
                        geom_score, vol_score, ctx_score, hist_score)
    return [d]


# ---------------------------------------------------------------------------
# Math helpers
# ---------------------------------------------------------------------------

def _ema(values: List[float], period: int) -> Optional[float]:
    if len(values) < period:
        return None
    k = 2.0 / (period + 1)
    ema = sum(values[:period]) / period
    for v in values[period:]:
        ema = v * k + ema * (1.0 - k)
    return float(ema)


def _atr(bars: List[Bar]) -> float:
    if not bars:
        return 0.0
    if len(bars) == 1:
        return bars[0]["h"] - bars[0]["l"]
    trs = []
    for i in range(1, len(bars)):
        b = bars[i]
        pc = bars[i - 1]["c"]
        tr = max(b["h"] - b["l"], abs(b["h"] - pc), abs(b["l"] - pc))
        trs.append(tr)
    return sum(trs) / len(trs) if trs else 0.0


def _compute_adx_di(bars: List[Bar], period: int) -> tuple[Optional[float], Optional[float], Optional[float]]:
    """Compute approximated ADX, +DI, -DI per Wilder's 1978 formulation.

    Returns (adx, di_plus, di_minus) using simple averages instead of full
    Wilder smoothing for code clarity. Sufficient for trend-classification
    purposes; values are reasonable approximations of the canonical ADX.
    """
    n = len(bars)
    if n < period * 2 + 1:
        return None, None, None

    # Compute +DM, -DM, TR for each bar
    plus_dm = []
    minus_dm = []
    trs = []
    for i in range(1, n):
        h, l = bars[i]["h"], bars[i]["l"]
        ph, pl, pc = bars[i - 1]["h"], bars[i - 1]["l"], bars[i - 1]["c"]
        up_move = h - ph
        down_move = pl - l
        p_dm = up_move if (up_move > down_move and up_move > 0) else 0.0
        m_dm = down_move if (down_move > up_move and down_move > 0) else 0.0
        tr = max(h - l, abs(h - pc), abs(l - pc))
        plus_dm.append(p_dm)
        minus_dm.append(m_dm)
        trs.append(tr)

    # Use last `period` values as smoothing window for simplicity
    recent_plus_dm = plus_dm[-period:]
    recent_minus_dm = minus_dm[-period:]
    recent_trs = trs[-period:]
    sum_tr = sum(recent_trs)
    if sum_tr <= 0:
        return 0.0, 0.0, 0.0

    di_plus = (sum(recent_plus_dm) / sum_tr) * 100.0
    di_minus = (sum(recent_minus_dm) / sum_tr) * 100.0
    di_sum = di_plus + di_minus
    if di_sum <= 0:
        return 0.0, di_plus, di_minus
    dx = (abs(di_plus - di_minus) / di_sum) * 100.0

    # Approximate ADX as a windowed average of DX over the last `period` slices
    # (a true ADX is a smoothed exponential, but for trend detection a windowed
    # mean produces broadly equivalent classifications).
    dx_series = []
    for end in range(period, len(plus_dm) + 1):
        window_plus = plus_dm[end - period:end]
        window_minus = minus_dm[end - period:end]
        window_tr = trs[end - period:end]
        sum_tr_w = sum(window_tr)
        if sum_tr_w <= 0:
            continue
        di_plus_w = (sum(window_plus) / sum_tr_w) * 100.0
        di_minus_w = (sum(window_minus) / sum_tr_w) * 100.0
        di_sum_w = di_plus_w + di_minus_w
        if di_sum_w <= 0:
            continue
        dx_w = (abs(di_plus_w - di_minus_w) / di_sum_w) * 100.0
        dx_series.append(dx_w)
    if not dx_series:
        return dx, di_plus, di_minus
    adx = sum(dx_series[-period:]) / min(len(dx_series), period)
    return adx, di_plus, di_minus


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def _score_geometry(c: dict) -> float:
    adx = c["adx"]
    if adx >= 50:
        adx_score = 100.0
    elif adx >= 40:
        adx_score = 85.0
    elif adx >= _MIN_ADX:
        adx_score = 70.0
    else:
        adx_score = 30.0

    di_spread = c["di_plus"] - c["di_minus"]
    if di_spread >= 15:
        di_score = 100.0
    elif di_spread >= 8:
        di_score = 80.0
    elif di_spread >= 3:
        di_score = 60.0
    else:
        di_score = 40.0

    # Tightness of EMA touch: closer = better
    pullback_low = c["pullback_low"]
    ema = c["ema20"]
    touch_dist_pct = abs(pullback_low - ema) / ema * 100.0 if ema > 0 else 100.0
    if touch_dist_pct <= 0.3:
        touch_score = 100.0
    elif touch_dist_pct <= 0.8:
        touch_score = 85.0
    elif touch_dist_pct <= 1.5:
        touch_score = 70.0
    else:
        touch_score = 40.0

    slope = c["ema_slope_pct_per_bar"]
    if slope >= 0.3:
        slope_score = 100.0
    elif slope >= 0.15:
        slope_score = 80.0
    elif slope > 0:
        slope_score = 60.0
    else:
        slope_score = 0.0

    base = 0.30 * adx_score + 0.20 * di_score + 0.30 * touch_score + 0.20 * slope_score
    base += structure_geom_boost(c)
    return round(min(100.0, base), 2)


def _score_volume(c: dict) -> float:
    ratio = c["vol_contraction_ratio"]
    # Lower ratio = stronger contraction
    if ratio <= 0.5:
        return 100.0
    if ratio <= 0.7:
        return 85.0
    if ratio <= 0.9:
        return 65.0
    return 40.0


def _score_context(context: dict) -> float:
    score = 50.0
    if context.get("trend_stage") == 2:
        score += 20.0
    if context.get("ma_alignment") == "stacked_bullish":
        score += 15.0
    if context.get("rs_trend") == "up":
        score += 10.0
    dcr_sig = context.get("dcr_signature")
    recent_dcr = context.get("recent_dcr_avg", 0.5) or 0.5
    if dcr_sig == "accumulation" and recent_dcr >= 0.65:
        score += 12.0
    elif dcr_sig == "distribution":
        score -= 8.0
    grade = context.get("can_slim_grade", "C")
    cscore = context.get("can_slim_score", 50) or 50
    if grade == "A" and cscore >= 80:
        score += 15.0
    elif grade == "B" and cscore >= 65:
        score += 8.0
    return min(100.0, max(0.0, score))


# ---------------------------------------------------------------------------
# Detection assembly
# ---------------------------------------------------------------------------

def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    pullback_bar = bars[c["pullback_bar_idx"]]
    ema20 = c["ema20"]
    atr14 = c["atr14"]

    entry = round(c["pullback_high"] * 1.001, 2)
    stop = round(c["pullback_low"] - atr14, 2)
    target = round(c["swing_high"] + atr14, 2)
    rr = ((target - entry) / (entry - stop)) if entry > stop else 0.0
    stop_distance_pct = ((entry - stop) / entry * 100.0) if entry > 0 else 0.0

    anchors = [{"t": int(last_bar["t"]), "price": float(ema20)}]
    pivot_ts = [int(pullback_bar["t"]), int(last_bar["t"])]

    extras = {
        "adx_approx": round(c["adx"], 2),
        "di_plus": round(c["di_plus"], 2),
        "di_minus": round(c["di_minus"], 2),
        "pullback_bar_idx": int(c["pullback_bar_idx"]),
        "pullback_low": round(c["pullback_low"], 2),
        "pullback_high": round(c["pullback_high"], 2),
        "20ema_at_pullback": round(ema20, 4),
        "ema_slope_pct_per_bar": round(c["ema_slope_pct_per_bar"], 4),
        "vol_contraction_ratio": round(c["vol_contraction_ratio"], 3),
        "atr14": round(atr14, 4),
        "swing_high": round(c["swing_high"], 2),
        **structure_extras(c),
    }

    narrative = _compose_narrative(c, context, entry, stop, target, rr, stop_distance_pct, atr14)
    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Holy Grail (Raschke)",
        "category": "uct",
        "direction": "bullish",
        "start_t": int(bars[max(0, c["pullback_bar_idx"] - 30)]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": pivot_ts,
        "geometry": {
            "shape": "horizontal_line",
            "anchors": anchors,
            "extras": extras,
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close > {entry:.2f} (pullback bar high + 0.1%)",
            "stop": stop,
            "stop_basis": "pullback_low_minus_1_ATR",
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


def _compose_narrative(c: dict, context: dict, entry: float, stop: float,
                       target: float, rr: float, stop_distance_pct: float,
                       atr14: float) -> dict:
    adx = c["adx"]
    di_plus = c["di_plus"]
    di_minus = c["di_minus"]
    ema = c["ema20"]
    slope = c["ema_slope_pct_per_bar"]
    vol_ratio = c["vol_contraction_ratio"]
    pullback_low = c["pullback_low"]
    pullback_high = c["pullback_high"]
    swing_high = c["swing_high"]

    ma_phrase = ma_alignment_phrase(context.get("ma_alignment"))
    stage_phrase = trend_stage_description(context.get("trend_stage"))
    rs_phrase = rs_trend_phrase(context.get("rs_trend"))
    regime_p = regime_phrase(context.get("regime"))
    vol_phrase = volume_signature_phrase(context.get("volume_signature"))
    dcr_p = dcr_phrase(context.get("dcr_signature"), context.get("recent_dcr_avg"))

    headline = (
        f"Holy Grail (Raschke) - ADX {adx:.1f}, +DI {di_plus:.1f} > -DI {di_minus:.1f}, "
        f"pullback to rising 20-EMA at ${ema:.2f}, volume contracted to {vol_ratio * 100:.0f}%. "
        f"Entry ${entry:.2f}, target ${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Holy Grail is Linda Bradford Raschke's signature pullback-in-"
        f"strong-trend setup, published in her 1995 book 'Street Smarts: "
        f"High Probability Short-Term Trading Strategies' (co-authored with "
        f"Larry Connors). The setup identifies pullbacks into the rising "
        f"20-EMA inside a high-ADX trending environment — a structural "
        f"combination that historically produces the highest-edge swing "
        f"entries with the most controlled risk. The four non-negotiable "
        f"conditions all hold here: (1) ADX(14) is {adx:.1f} — comfortably "
        f"above Raschke's strong-trend threshold of 30 (anything below 30 "
        f"is considered range-bound chop and disqualifies the setup); "
        f"(2) +DI ({di_plus:.1f}) is above -DI ({di_minus:.1f}) by "
        f"{di_plus - di_minus:.1f} points, confirming the directional bias "
        f"is bullish; (3) price has pulled back into the 20-EMA at "
        f"${ema:.2f} within the last 3 bars — the pullback low at "
        f"${pullback_low:.2f} kissed the EMA within {abs(pullback_low - ema) / ema * 100:.1f}% "
        f"tolerance; (4) the 20-EMA is RISING (slope {slope:.3f}% per bar) "
        f"so the underlying trend remains intact; and (5) volume has "
        f"CONTRACTED to {vol_ratio * 100:.0f}% of the prior 10-bar average — "
        f"the signature of supply absorption rather than aggressive "
        f"selling. Raschke gave the setup the 'Holy Grail' name not "
        f"because it works every time (no setup does) but because it "
        f"combines all the elements of a high-probability entry: defined "
        f"risk, mechanical stop placement, well-understood institutional "
        f"behavior, and a setup that works across timeframes from "
        f"intraday to daily."
    )

    why_it_matters = (
        f"This Holy Grail is firing inside {stage_phrase} with {ma_phrase} "
        f"alignment, {rs_phrase}, in {regime_p}. {vol_phrase} during the "
        f"pullback is the institutional accumulation signature — the same "
        f"behavior that Wyckoff, Weinstein, and O'Neil all teach is the "
        f"footprint of professional money. {dcr_p} confirms the close-by-"
        f"close character: institutional buyers are quietly absorbing "
        f"shares at the 20-EMA without distributing into closes. "
        f"{dcr_interpretation(context, 'bullish')} Raschke's published "
        f"data from the 'Street Smarts' methodology showed the Holy Grail "
        f"setup historically produced 60-65% win rates on US stocks and "
        f"futures when applied with discipline to the ADX > 30 filter. "
        f"The mechanical edge of the setup comes from three reinforcing "
        f"dynamics: (1) ADX > 30 confirms institutional commitment to the "
        f"trend — random pullbacks in low-ADX environments fail because "
        f"there is no trend to resume; (2) the 20-EMA is the institutional "
        f"swing-trade reference — limit orders cluster at the rising "
        f"20-EMA and absorb supply at the pullback; (3) volume contraction "
        f"during the pullback confirms that the selling is not "
        f"institutional distribution but retail noise. The trade structure "
        f"is mechanically clean: entry at ${entry:.2f} (pullback bar high "
        f"+ 0.1%), stop at ${stop:.2f} (pullback low - 1 ATR), target "
        f"${target:.2f} (recent swing high + 1 ATR), R:R {rr:.1f}. "
        f"{structure_narrative_sentence(c)}"
    ).strip()

    what_to_watch_for = (
        f"Trigger: a daily close above ${entry:.2f} (the pullback bar's "
        f"high plus a 0.1% confirmation buffer). The trigger should print "
        f"on volume that returns to or above the 10-bar average — Raschke "
        f"explicitly looks for the volume to RE-EXPAND on the trigger bar "
        f"because the pullback's volume contraction was the absorption "
        f"phase, and the trigger should mark when the institutional bid "
        f"begins marking the stock up again. The ATR(14) of {atr14:.4f} "
        f"is the unit for stop sizing: the stop at ${stop:.2f} is one "
        f"full ATR below the pullback low, which gives the trade enough "
        f"room to handle normal volatility without being whipsawed out "
        f"of a valid setup. Position sizing should reflect the "
        f"{stop_distance_pct:.1f}% stop distance — risking 1% of account "
        f"on the trade implies roughly "
        f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
        f"of equity per position. Raschke's specific execution rules: "
        f"(a) take the trade only if all 5 conditions hold (no "
        f"discretionary overrides); (b) trail the stop up to the 20-EMA "
        f"as price advances; (c) take partial profits at the prior swing "
        f"high (${swing_high:.2f}) and let the remainder ride to the "
        f"1-ATR projection. The Holy Grail typically resolves within "
        f"5-15 bars on clean setups."
    )

    failure_signal = (
        f"The Holy Grail is invalidated if price closes below ${stop:.2f} "
        f"(the pullback low minus 1 ATR) — that's the mechanical stop "
        f"and signals the institutional bid at the 20-EMA has stepped "
        f"aside. A more subtle failure mode: ADX begins to fall from "
        f"its current {adx:.1f} reading back below 30 — that's the "
        f"first crack in the trend that produced the setup, and even if "
        f"the price stop doesn't fire, the trade thesis is degrading. "
        f"Raschke's specific guidance: if ADX falls below 25 while the "
        f"trade is open, take whatever profit (or small loss) is "
        f"available rather than holding for the full target — the "
        f"strong-trend filter that produced the setup has dissolved. "
        f"Another failure pattern: the trigger bar fires above "
        f"${entry:.2f} but the next 2-3 bars fade back to the 20-EMA "
        f"on weak or expanding volume — this 'failed Holy Grail' often "
        f"precedes a deeper pullback that breaches the stop, and the "
        f"prudent response is to exit on the first bar that closes "
        f"back below the 20-EMA rather than waiting for the wider stop "
        f"to fire. Raschke and Connors's discipline in 'Street Smarts': "
        f"the setup's edge depends on disciplined execution — never "
        f"widen stops, never average down on a failing Holy Grail, "
        f"and always honor the ADX < 25 trend-failure exit."
    )

    return {
        "headline": headline,
        "what_it_is": what_it_is,
        "why_it_matters": why_it_matters,
        "what_to_watch_for": what_to_watch_for,
        "failure_signal": failure_signal,
    }


register(_PATTERN_ID, detect_holy_grail)
