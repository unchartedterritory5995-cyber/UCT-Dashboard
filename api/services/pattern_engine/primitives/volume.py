"""Volume primitives: signature classification, contraction score, accumulation/distribution.

All inputs accept OHLCV bars; only `c`, `o`, `v` are read here.
"""
from __future__ import annotations

import math
from typing import List, Literal

from api.services.pattern_engine.types import Bar


VolumeSignature = Literal["contracting", "expanding", "neutral"]


def volume_signature(bars: List[Bar], lookback: int = 10) -> VolumeSignature:
    """Classify recent volume trend versus the preceding window.

    Compares mean volume of the last `lookback` bars to the mean of the previous
    `lookback` bars. Ratio:
      < 0.75 → contracting
      > 1.30 → expanding
      else   → neutral

    Returns "neutral" if bars are shorter than 2 * lookback.
    """
    if len(bars) < 2 * lookback:
        return "neutral"

    recent  = [b["v"] for b in bars[-lookback:]]
    prior   = [b["v"] for b in bars[-2 * lookback:-lookback]]

    mean_recent = sum(recent) / lookback
    mean_prior  = sum(prior) / lookback if prior else 0

    if mean_prior <= 0:
        return "neutral"

    ratio = mean_recent / mean_prior
    if ratio < 0.75:
        return "contracting"
    if ratio > 1.30:
        return "expanding"
    return "neutral"


def contraction_score(bars: List[Bar], window: int = 10) -> float:
    """Score 0-1 measuring how much the recent volume window is contracting
    relative to the preceding window of the same size.

    1.0 = recent volume is ~0 vs prior; 0.0 = recent volume >= prior.
    """
    if len(bars) < 2 * window:
        return 0.0
    recent_mean = sum(b["v"] for b in bars[-window:]) / window
    prior_mean  = sum(b["v"] for b in bars[-2 * window:-window]) / window
    if prior_mean <= 0:
        return 0.0
    ratio = recent_mean / prior_mean
    if ratio >= 1.0:
        return 0.0
    return 1.0 - ratio


def accumulation_distribution(bars: List[Bar], lookback: int = 10) -> float:
    """Signed score: positive = accumulation, negative = distribution.

    Sums volume * sign(close - open) over the last `lookback` bars, then
    normalizes by total volume in the window. Range approximately [-1, 1].

    Returns 0.0 if lookback exceeds series length.
    """
    if len(bars) < lookback:
        return 0.0
    window = bars[-lookback:]
    total_vol = sum(b["v"] for b in window)
    if total_vol <= 0:
        return 0.0
    signed = 0.0
    for b in window:
        sign = 1 if b["c"] > b["o"] else (-1 if b["c"] < b["o"] else 0)
        signed += b["v"] * sign
    return signed / total_vol
