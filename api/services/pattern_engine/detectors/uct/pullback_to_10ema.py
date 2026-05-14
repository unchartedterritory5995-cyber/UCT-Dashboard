"""Pullback to 10-EMA detector — Raschke fast-pullback + Bonde first-pullback.

Linda Bradford Raschke's fast-pullback entry framework (refined for the
modern tape in 'Street Smarts' 1995 and her decades of seminar work) and
Pradeep Bonde's 'first pullback' trade (Stockbee playbook) both center
on the rising 10-EMA as the institutional swing-trade reference for
high-momentum stocks in confirmed Stage 2 uptrends. The 10-EMA is the
FASTEST stop-loss reference that still tracks the underlying trend —
pullbacks that hold the 10-EMA define the tightest risk geometry and
the highest reward-to-risk ratios for trend-following swing entries.

Conditions:
  - Stage 2 uptrend confirmed (context.trend_stage == 2)
  - 10-EMA rising over last 10 bars
  - Most recent bar's LOW touches/crosses 10-EMA (within 1%)
  - That same bar OR next bar closes back ABOVE the 10-EMA
  - Volume on the pullback bar is moderate/contracting (NOT expanding selling)
  - Stacked bullish MA alignment

Levels:
  - entry = pullback_bar_high * 1.001 (break above pullback bar high)
  - stop = pullback_low - 0.5 * ATR(14)
  - target = recent swing high + ATR(14)

Geometry: "horizontal_line" at 10-EMA value at pullback.
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


_PATTERN_ID = "pullback_to_10ema"

_EMA_PERIOD = 10                       # 10-EMA primary reference
_PULLBACK_LOOKBACK = 3                 # most recent N bars to find the pullback bar
_EMA_TOUCH_TOLERANCE_PCT = 0.01        # within 1% of EMA = "touched"
_MIN_EMA_SLOPE_PCT_PER_BAR = 0.05      # 10-EMA must be rising (>=0.05% per bar)
_RECLAIM_LAG = 1                       # close back above EMA within next 1 bar
_CONFIDENCE_FLOOR = 50.0


def detect_pullback_to_10ema(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect pullback-to-10-EMA setups. Emits 0 or 1 detection."""
    n = len(bars)
    if n < _EMA_PERIOD * 4:
        return []

    # Hard context gate: Stage 2 + stacked bullish (this is a TIGHT continuation
    # setup; if the broader trend isn't constructively bullish, the 10-EMA
    # pullback edge degrades sharply).
    if context.get("trend_stage") != 2:
        return []
    if context.get("ma_alignment") != "stacked_bullish":
        return []

    closes = [b["c"] for b in bars]
    ema10 = _ema(closes, _EMA_PERIOD)
    if ema10 is None:
        return []

    # 10-EMA must be RISING
    ema_past = _ema(closes[:-10], _EMA_PERIOD) if n >= 30 else None
    if ema_past is None or ema_past >= ema10:
        return []
    ema_slope_pct_per_bar = (ema10 - ema_past) / ema_past * 100.0 / 10.0
    if ema_slope_pct_per_bar < _MIN_EMA_SLOPE_PCT_PER_BAR:
        return []

    # Find the pullback bar: in last _PULLBACK_LOOKBACK bars, find one whose
    # LOW touched/crossed the 10-EMA (within tolerance OR below).
    pullback_bar_idx = None
    pullback_low = None
    for back in range(_PULLBACK_LOOKBACK):
        idx = n - 1 - back
        if idx < _EMA_PERIOD:
            break
        b = bars[idx]
        # The bar's low must come within tolerance of EMA OR go below it
        if b["l"] <= ema10 * (1.0 + _EMA_TOUCH_TOLERANCE_PCT):
            pullback_bar_idx = idx
            pullback_low = b["l"]
            break
    if pullback_bar_idx is None:
        return []

    # Reclaim: the pullback bar OR the next bar must close ABOVE the 10-EMA.
    pullback_bar = bars[pullback_bar_idx]
    reclaim_bar_idx = None
    if pullback_bar["c"] > ema10:
        reclaim_bar_idx = pullback_bar_idx
    elif pullback_bar_idx + 1 < n and bars[pullback_bar_idx + 1]["c"] > ema10:
        reclaim_bar_idx = pullback_bar_idx + 1
    if reclaim_bar_idx is None:
        return []

    # Volume gate: pullback bar volume must NOT be wildly expanding (panic selling).
    # Compare pullback bar volume to 20-bar average ending before the pullback.
    lookback_start = max(0, pullback_bar_idx - 20)
    lookback = bars[lookback_start:pullback_bar_idx]
    if not lookback:
        return []
    avg_vol = sum(b["v"] for b in lookback) / len(lookback)
    if avg_vol <= 0:
        return []
    pullback_vol_ratio = pullback_bar["v"] / avg_vol
    # If volume is expanding hard (>1.5x), it's panic selling — reject.
    if pullback_vol_ratio > 1.5:
        return []

    # ATR(14) for stop/target sizing
    atr14 = _atr(bars[-15:])
    if atr14 <= 0:
        return []

    # Recent swing high for target
    last30 = bars[-30:]
    swing_high = max(b["h"] for b in last30)

    sq = compute_structure_quality(bars, pullback_bar_idx, pullback_low)

    candidate = {
        "pullback_bar_idx": pullback_bar_idx,
        "pullback_low": pullback_low,
        "pullback_high": pullback_bar["h"],
        "pullback_close": pullback_bar["c"],
        "reclaim_bar_idx": reclaim_bar_idx,
        "ema_10": ema10,
        "ema_slope_pct_per_bar": ema_slope_pct_per_bar,
        "distance_to_ema_pct": (pullback_low - ema10) / ema10 * 100.0,
        "pullback_volume_ratio": pullback_vol_ratio,
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


def _score_geometry(c: dict) -> float:
    """Components: touch tightness, EMA slope strength, reclaim quality."""
    dist = abs(c["distance_to_ema_pct"])
    if dist <= 0.3:
        touch_score = 100.0
    elif dist <= 0.6:
        touch_score = 85.0
    elif dist <= 1.0:
        touch_score = 70.0
    else:
        touch_score = 50.0

    slope = c["ema_slope_pct_per_bar"]
    if slope >= 0.3:
        slope_score = 100.0
    elif slope >= 0.15:
        slope_score = 80.0
    elif slope >= _MIN_EMA_SLOPE_PCT_PER_BAR:
        slope_score = 60.0
    else:
        slope_score = 30.0

    # Reclaim quality: same-bar reclaim is the strongest (intra-bar shakeout)
    same_bar = c["reclaim_bar_idx"] == c["pullback_bar_idx"]
    reclaim_score = 100.0 if same_bar else 75.0

    base = 0.40 * touch_score + 0.30 * slope_score + 0.30 * reclaim_score
    base += structure_geom_boost(c)
    return round(min(100.0, base), 2)


def _score_volume(c: dict) -> float:
    """Score volume contraction on pullback (lower ratio = stronger setup)."""
    ratio = c["pullback_volume_ratio"]
    if ratio <= 0.6:
        return 100.0
    if ratio <= 0.85:
        return 85.0
    if ratio <= 1.05:
        return 70.0
    if ratio <= 1.3:
        return 50.0
    return 30.0


def _score_context(context: dict) -> float:
    """Pullback to 10EMA wants Stage 2 + stacked bullish + RS up."""
    score = 50.0
    if context.get("rs_trend") == "up":
        score += 15.0
    elif context.get("rs_trend") == "flat":
        score += 5.0

    score += _dcr_score_adjustment(context)
    score += _can_slim_score_adjustment(context)
    return min(100.0, max(0.0, score))


def _can_slim_score_adjustment(context: dict) -> float:
    """CAN SLIM boost for continuation patterns (pullbacks)."""
    grade = context.get("can_slim_grade", "C")
    score = context.get("can_slim_score", 50) or 50
    if grade == "A" and score >= 80:
        return 15.0
    if grade == "B" and score >= 65:
        return 8.0
    return 0.0


def _dcr_score_adjustment(context: dict) -> float:
    """DCR-derived score adjustment for bullish continuation pattern."""
    dcr_sig = context.get("dcr_signature")
    recent_dcr = context.get("recent_dcr_avg", 0.5) or 0.5
    if dcr_sig == "accumulation" and recent_dcr >= 0.65:
        return 12.0
    if dcr_sig == "distribution":
        return -8.0
    return 0.0


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    pullback_bar = bars[c["pullback_bar_idx"]]
    ema10 = c["ema_10"]
    atr14 = c["atr14"]

    entry = round(c["pullback_high"] * 1.001, 2)
    stop = round(c["pullback_low"] - 0.5 * atr14, 2)
    target = round(c["swing_high"] + atr14, 2)
    rr = ((target - entry) / (entry - stop)) if entry > stop else 0.0
    stop_distance_pct = ((entry - stop) / entry * 100.0) if entry > 0 else 0.0

    anchors = [{"t": int(last_bar["t"]), "price": float(ema10)}]
    pivot_ts = [int(pullback_bar["t"]), int(last_bar["t"])]

    extras = {
        "ema_10_value": round(ema10, 4),
        "pullback_bar_idx": int(c["pullback_bar_idx"]),
        "pullback_bar_low": round(c["pullback_low"], 2),
        "pullback_bar_high": round(c["pullback_high"], 2),
        "pullback_bar_close": round(c["pullback_close"], 2),
        "distance_to_ema_pct": round(c["distance_to_ema_pct"], 3),
        "ema_slope_pct_per_bar": round(c["ema_slope_pct_per_bar"], 4),
        "pullback_volume_ratio": round(c["pullback_volume_ratio"], 3),
        "atr14": round(atr14, 4),
        "swing_high": round(c["swing_high"], 2),
        "reclaim_bar_idx": int(c["reclaim_bar_idx"]),
        "dcr_score_adj": round(_dcr_score_adjustment(context), 2),
        **structure_extras(c),
    }

    narrative = _compose_narrative(c, context, entry, stop, target, rr, stop_distance_pct, atr14)
    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Pullback to 10-EMA",
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
            "stop_basis": "pullback_low_minus_half_ATR",
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
    ema10 = c["ema_10"]
    slope = c["ema_slope_pct_per_bar"]
    vol_ratio = c["pullback_volume_ratio"]
    pullback_low = c["pullback_low"]
    pullback_high = c["pullback_high"]
    pullback_close = c["pullback_close"]
    swing_high = c["swing_high"]
    dist = c["distance_to_ema_pct"]

    ma_phrase = ma_alignment_phrase(context.get("ma_alignment"))
    stage_phrase = trend_stage_description(context.get("trend_stage"))
    rs_phrase = rs_trend_phrase(context.get("rs_trend"))
    regime_p = regime_phrase(context.get("regime"))
    vol_phrase = volume_signature_phrase(context.get("volume_signature"))
    dcr_p = dcr_phrase(context.get("dcr_signature"), context.get("recent_dcr_avg"))

    headline = (
        f"Pullback to 10-EMA - rising 10-EMA at ${ema10:.2f} (slope "
        f"{slope:.3f}% per bar), pullback low ${pullback_low:.2f} reclaimed "
        f"on volume {vol_ratio * 100:.0f}% of 20-bar avg. Pivot ${entry:.2f}, "
        f"target ${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Pullback to 10-EMA is the fastest-stop continuation entry in "
        f"the trend-following literature, refined by Linda Bradford Raschke "
        f"(through her 'Street Smarts' framework and decades of seminar "
        f"work) and Pradeep Bonde's 'first pullback' trade in the Stockbee "
        f"playbook. The setup identifies a pullback into the rising 10-EMA "
        f"in a confirmed Stage 2 uptrend with stacked-bullish MA alignment "
        f"— the structural combination that captures the highest reward-"
        f"to-risk swing entry available in trend-following. Here the "
        f"10-EMA sits at ${ema10:.2f} and is rising at {slope:.3f}% per "
        f"bar (a meaningful slope that confirms the underlying trend is "
        f"intact, not fading). The pullback bar's low at ${pullback_low:.2f} "
        f"touched the 10-EMA (distance {dist:.2f}% — within the 1% tolerance "
        f"window), and the reclaim closed above the EMA on volume "
        f"{vol_ratio * 100:.0f}% of the 20-bar average — moderate to "
        f"contracting volume that signals the pullback was supply absorption "
        f"rather than panic selling. The 10-EMA is the institutional swing-"
        f"trade reference for high-momentum stocks: it's the fastest moving "
        f"average that still tracks the underlying trend (vs the 5-EMA which "
        f"whipsaws too easily, or the 20-EMA which lags too far). Raschke "
        f"teaches the 10-EMA pullback as the tightest stop-loss reference "
        f"in trend-following — pullbacks that hold the 10-EMA define the "
        f"tightest mechanical risk geometry and the highest reward-to-risk "
        f"ratios. Pradeep Bonde's Stockbee playbook treats the FIRST pullback "
        f"to the 10-EMA after a momentum thrust as one of his highest-edge "
        f"continuation triggers because the institutional accumulation that "
        f"drove the prior thrust hasn't yet stopped — the 10-EMA touch "
        f"simply gives professional capital a tighter entry. Mark Minervini's "
        f"fast-pullback variant in SEPA shares this principle but uses the "
        f"21-EMA as primary reference for slightly longer-horizon trades."
    )

    why_it_matters = (
        f"This 10-EMA pullback is firing inside {stage_phrase} with {ma_phrase} "
        f"alignment, {rs_phrase}, in {regime_p}. {vol_phrase} on the pullback "
        f"is the institutional absorption signature — the same behavior "
        f"Wyckoff, Weinstein, and O'Neil all teach is the footprint of "
        f"professional money quietly accumulating at the technical reference. "
        f"{dcr_p} {dcr_interpretation(context, 'bullish')} The 10-EMA's "
        f"reference value comes from three reinforcing dynamics: (1) limit "
        f"orders from institutional desks cluster at the rising 10-EMA on "
        f"liquid momentum names — every retail/algorithmic system that "
        f"reads the 10-EMA contributes flow at the level; (2) the 10-EMA "
        f"is the fastest stop-loss reference that survives normal "
        f"intra-trend pullbacks without whipsawing — tighter MAs (5-EMA) "
        f"produce false breaks; (3) the asymmetric reward profile is "
        f"structurally clean — a {stop_distance_pct:.2f}% stop distance "
        f"against a target at the recent swing high (${swing_high:.2f}) + "
        f"1 ATR produces an R:R of {rr:.1f}. Raschke's published guidance "
        f"on 10-EMA pullbacks: the setup's edge depends on the trend being "
        f"genuinely intact (rising 10-EMA AND rising 20-EMA AND rising "
        f"50-SMA — the stacked-bullish stack confirmed here) — pullbacks "
        f"in degrading stacks fail at much higher rates because the "
        f"underlying trend is fading. Pradeep Bonde's Stockbee backtests "
        f"on liquid US momentum names show first-pullback-to-10-EMA setups "
        f"in confirmed Stage 2 uptrends deliver positive expectancy at "
        f"hit rates in the 65-75% range when traded with discipline. "
        f"{structure_narrative_sentence(c)}"
    ).strip()

    what_to_watch_for = (
        f"Trigger: a close above ${entry:.2f} (pullback bar high "
        f"${pullback_high:.2f} plus a 0.1% confirmation buffer). The "
        f"ideal trigger bar prints on volume returning to or above the "
        f"20-bar average — the volume contraction during the pullback "
        f"was the absorption phase, and the trigger should mark volume "
        f"RE-EXPANDING as the institutional bid begins marking the stock "
        f"up again. The ATR(14) of {atr14:.4f} is the unit for stop "
        f"sizing: the stop at ${stop:.2f} sits half an ATR below the "
        f"pullback low, which gives the trade enough room to handle normal "
        f"intra-trend volatility without being whipsawed. Position sizing "
        f"should reflect the {stop_distance_pct:.2f}% stop distance — "
        f"risking 1% of account on the trade implies roughly "
        f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
        f"of equity per position, which is COMFORTABLY SIZED for a 10-EMA "
        f"pullback (the tight structural stop allows larger size than "
        f"comparable setups with looser geometry). Raschke's specific "
        f"execution rules: (a) wait for the trigger close above the pullback "
        f"bar high before entering — never front-run the reclaim; (b) trail "
        f"the stop upward to the 10-EMA as price advances (Raschke uses a "
        f"trailing 10-EMA stop on these setups); (c) take partial profits "
        f"at the recent swing high (${swing_high:.2f}) and let the remainder "
        f"ride toward the 1-ATR projection at ${target:.2f}; (d) clean "
        f"10-EMA pullbacks typically resolve within 3-10 bars — if the "
        f"setup hasn't extended within 10 bars, the trend may be losing "
        f"momentum and tighter trail-stop discipline is warranted."
    )

    failure_signal = (
        f"The 10-EMA pullback is invalidated if price closes below "
        f"${stop:.2f} (pullback low minus 0.5 ATR) — that signals the "
        f"institutional bid at the 10-EMA has stepped aside and the "
        f"continuation thesis is broken. A subtler failure: the trigger "
        f"bar fires above ${entry:.2f} but the next 2-3 bars fade back "
        f"below the 10-EMA on weak or expanding volume — this 'failed "
        f"first pullback' often precedes a deeper retest of the 20-EMA "
        f"or 50-SMA, and the prudent response is to exit on the first "
        f"bar that closes back below the 10-EMA rather than waiting for "
        f"the wider stop to fire. Raschke's discipline: the setup's "
        f"edge depends on the trend being intact — if the 10-EMA slope "
        f"flattens or rolls negative while the trade is open, reduce "
        f"size or exit even if the price stop hasn't triggered. Another "
        f"failure pattern: the pullback bar's volume was expanding "
        f"meaningfully (>1.5x 20-bar avg) — that signals panic-style "
        f"selling rather than absorption, and the setup is filtered out "
        f"at the detector level. Mark Minervini's broader fast-pullback "
        f"discipline applies: take the trade exactly per the setup rules, "
        f"size for the {stop_distance_pct:.2f}% stop, never widen the "
        f"stop, and never average down on a failing pullback. The trader "
        f"who treats the 10-EMA stop as 'flexible' will give back all of "
        f"the asymmetric reward this setup offers over the long run."
    )

    return {
        "headline": headline,
        "what_it_is": what_it_is,
        "why_it_matters": why_it_matters,
        "what_to_watch_for": what_to_watch_for,
        "failure_signal": failure_signal,
    }


register(_PATTERN_ID, detect_pullback_to_10ema)
