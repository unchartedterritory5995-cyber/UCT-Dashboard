"""Per-case pipeline trace for pullback_to_21ema.py (Minervini SEPA).

Re-uses the detector's OWN private helpers (`_ema`, `_atr`) directly -- not a
reimplementation -- and re-derives its exact gate order so every corpus case
(fired or not) can be attributed to the SPECIFIC gate it passed/failed,
because `detect_pullback_to_21ema` itself only returns [] or [detection] with
no reason code. This mirrors the bull_flag/hammer lab programs' `trace.py`
pattern exactly.

Read-only, diagnostic only. No detector code is modified.
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from api.services.pattern_engine.detectors.uct import pullback_to_21ema as pb


def trace_pullback_21ema(bars: list[dict], context: dict) -> dict:
    """Walk the exact gate order `detect_pullback_to_21ema` uses and record
    where this (bars, context) pair passes or fails. Returns a dict with every
    intermediate value plus `final_fired`/`final_confidence`/`reject_reason`."""
    out: dict = {
        "n_bars": len(bars),
        "trend_stage": context.get("trend_stage"),
        "ma_alignment": context.get("ma_alignment"),
        "rs_trend": context.get("rs_trend"),
    }

    n = len(bars)
    if n < pb._EMA_PERIOD * 4:
        out["reject_reason"] = "too_few_bars"
        out["final_fired"] = False
        return out

    if context.get("trend_stage") != 2:
        out["reject_reason"] = "not_stage_2"
        out["final_fired"] = False
        return out
    if context.get("ma_alignment") != "stacked_bullish":
        out["reject_reason"] = "not_stacked_bullish"
        out["final_fired"] = False
        return out
    if context.get("rs_trend") != "up":
        out["reject_reason"] = "rs_trend_not_up"
        out["final_fired"] = False
        return out

    closes = [b["c"] for b in bars]
    ema21 = pb._ema(closes, pb._EMA_PERIOD)
    if ema21 is None:
        out["reject_reason"] = "ema_none"
        out["final_fired"] = False
        return out
    out["ema_21"] = round(ema21, 4)

    ema_past = pb._ema(closes[:-10], pb._EMA_PERIOD) if n >= 31 else None
    if ema_past is None or ema_past >= ema21:
        out["reject_reason"] = "ema_not_rising"
        out["ema_past"] = ema_past
        out["final_fired"] = False
        return out
    ema_slope_pct_per_bar = (ema21 - ema_past) / ema_past * 100.0 / 10.0
    out["ema_slope_pct_per_bar"] = round(ema_slope_pct_per_bar, 4)
    if ema_slope_pct_per_bar < pb._MIN_EMA_SLOPE_PCT_PER_BAR:
        out["reject_reason"] = "ema_slope_too_flat"
        out["final_fired"] = False
        return out

    pullback_bar_idx = None
    pullback_low = None
    for back in range(pb._PULLBACK_LOOKBACK):
        idx = n - 1 - back
        if idx < pb._EMA_PERIOD:
            break
        b = bars[idx]
        body_low = min(b["o"], b["c"])
        if body_low <= ema21 * (1.0 + pb._EMA_TOUCH_TOLERANCE_PCT) and b["l"] <= ema21 * (1.0 + pb._EMA_TOUCH_TOLERANCE_PCT):
            pullback_bar_idx = idx
            pullback_low = b["l"]
            break
    out["pullback_bars_checked"] = list(range(max(0, n - pb._PULLBACK_LOOKBACK), n))
    if pullback_bar_idx is None:
        out["reject_reason"] = "no_pullback_bar_touching_ema"
        out["final_fired"] = False
        return out
    out["pullback_bar_idx"] = pullback_bar_idx
    out["pullback_bar_t"] = int(bars[pullback_bar_idx]["t"])
    out["distance_to_ema_pct"] = round((pullback_low - ema21) / ema21 * 100.0, 3)

    pullback_bar = bars[pullback_bar_idx]
    reclaim_bar_idx = None
    for j in range(pullback_bar_idx, min(pullback_bar_idx + 1 + pb._RECLAIM_LAG, n)):
        if bars[j]["c"] > ema21:
            reclaim_bar_idx = j
            break
    if reclaim_bar_idx is None:
        out["reject_reason"] = "no_reclaim_within_lag"
        out["final_fired"] = False
        return out
    out["reclaim_bar_idx"] = reclaim_bar_idx
    out["reclaim_bar_t"] = int(bars[reclaim_bar_idx]["t"])
    out["bars_since_reclaim"] = (n - 1) - reclaim_bar_idx

    lookback_start = max(0, pullback_bar_idx - 20)
    lookback = bars[lookback_start:pullback_bar_idx]
    if not lookback:
        out["reject_reason"] = "no_volume_lookback"
        out["final_fired"] = False
        return out
    avg_vol = sum(b["v"] for b in lookback) / len(lookback)
    if avg_vol <= 0:
        out["reject_reason"] = "zero_avg_volume"
        out["final_fired"] = False
        return out
    pullback_vol_ratio = pullback_bar["v"] / avg_vol
    out["pullback_volume_ratio"] = round(pullback_vol_ratio, 4)
    if pullback_vol_ratio >= 1.1:
        out["reject_reason"] = "volume_not_contracted"
        out["final_fired"] = False
        return out

    atr14 = pb._atr(bars[-15:])
    if atr14 <= 0:
        out["reject_reason"] = "atr_zero"
        out["final_fired"] = False
        return out
    out["atr14"] = round(atr14, 4)

    # Full run through the real function to get the real confidence + grade
    # (avoids re-deriving the scoring formulas a second time, which would risk
    # silently diverging from the source).
    detections = pb.detect_pullback_to_21ema(bars, context)
    if not detections:
        out["reject_reason"] = "confidence_below_floor"
        out["final_fired"] = False
        return out

    d = detections[0]
    out["reject_reason"] = None
    out["final_fired"] = True
    out["final_confidence"] = d["confidence"]
    out["minervini_sepa_grade"] = d["geometry"]["extras"]["minervini_sepa_grade"]
    out["geom_score"] = d["quality_components"]["geometry_score"]
    out["vol_score"] = d["quality_components"]["volume_score"]
    out["ctx_score"] = d["quality_components"]["context_score"]
    return out
