"""Shared helpers for wiring structure-quality boosts (higher-low + MA-pullback)
into continuation detectors.

Provides:
  compute_structure_quality(bars, pullback_low_idx) -> dict with
    "hl_result", "ma_result" — pre-computed at candidate extraction.

  structure_geom_boost(c) -> float
    Returns the additive geometry-score boost for a candidate dict that has
    "hl_result" and "ma_result" populated. 0 if missing.

  structure_extras(c) -> dict
    Returns the extras keys to merge into geometry.extras.

  structure_narrative_sentence(c) -> str
    Returns a ready-to-weave-in sentence for narrative.why_it_matters. May be empty.
"""
from __future__ import annotations

from typing import Optional

from api.services.pattern_engine.primitives.structure_quality import (
    is_higher_low,
    nearest_rising_ma_alignment,
)


def compute_structure_quality(bars: list[dict], pullback_low_idx: Optional[int],
                              pullback_low_price: Optional[float] = None) -> dict:
    """Compute higher-low + MA-alignment quality for a continuation pattern.

    Args:
      bars: full bars list
      pullback_low_idx: index of the pullback's low bar (or None to skip HL check)
      pullback_low_price: low price to test MA alignment against. Defaults to
                          bars[pullback_low_idx]["l"] when not provided.

    Returns:
      dict with "hl_result" and "ma_result" — always present, always shaped
      the same so callers can chain without None-checks.
    """
    if pullback_low_idx is None or not bars:
        return {
            "hl_result": {
                "is_higher_low": False,
                "prior_low_price": None,
                "prior_low_bar_index": None,
                "lift_pct": 0.0,
                "narrative_phrase": "",
            },
            "ma_result": {
                "aligned_ma": None,
                "ma_value": None,
                "distance_pct": 0.0,
                "score_boost": 0,
                "narrative_phrase": "",
            },
        }

    if pullback_low_price is None:
        if 0 <= pullback_low_idx < len(bars):
            pullback_low_price = bars[pullback_low_idx]["l"]
        else:
            pullback_low_price = 0.0

    hl = is_higher_low(bars, pullback_low_idx)
    ma = nearest_rising_ma_alignment(bars, pullback_low_price)
    return {"hl_result": hl, "ma_result": ma}


def structure_geom_boost(c: dict) -> float:
    """Compute the geometry-score boost for a candidate with structure quality.

    +8 for a confirmed higher low + the rising-MA score_boost (0/10/15/18/22).
    """
    boost = 0.0
    hl = c.get("hl_result") or {}
    if hl.get("is_higher_low"):
        boost += 8.0
    ma = c.get("ma_result") or {}
    boost += float(ma.get("score_boost", 0) or 0)
    return boost


def structure_extras(c: dict) -> dict:
    """Extras keys to merge into geometry.extras for downstream inspection."""
    hl = c.get("hl_result") or {}
    ma = c.get("ma_result") or {}
    return {
        "higher_low": bool(hl.get("is_higher_low")),
        "higher_low_lift_pct": float(hl.get("lift_pct", 0.0) or 0.0),
        "aligned_ma": ma.get("aligned_ma"),
        "ma_distance_pct": float(ma.get("distance_pct", 0.0) or 0.0),
    }


def structure_narrative_sentence(c: dict) -> str:
    """Return a ready-to-weave-in sentence for why_it_matters (may be empty)."""
    hl = c.get("hl_result") or {}
    ma = c.get("ma_result") or {}
    phrases = []
    if hl.get("is_higher_low") and hl.get("narrative_phrase"):
        phrases.append(hl["narrative_phrase"])
    if ma.get("aligned_ma") and ma.get("narrative_phrase"):
        phrases.append(ma["narrative_phrase"])
    return " ".join(phrases)
