"""TypedDict definitions for the pattern recognition engine.

These are the source-of-truth shapes for everything the engine emits.
Consumers (detectors, memory, API, UI) all import from here.
"""
from __future__ import annotations

from typing import Literal, TypedDict


class Bar(TypedDict):
    t: int    # unix seconds, bar start
    o: float
    h: float
    l: float
    c: float
    v: float


class Anchor(TypedDict):
    t: int
    price: float


class Pivot(TypedDict):
    t: int
    price: float
    type: Literal["high", "low"]
    strength: int   # 0-100, how dominant relative to neighbors
    bar_index: int  # index into the bars list it came from


class Trendline(TypedDict):
    p1: Anchor
    p2: Anchor
    slope: float       # price per bar
    r_squared: float   # 0-1 fit quality
    touches: int       # number of pivots near the line
    validity: float    # 0-1 composite quality


class Geometry(TypedDict):
    shape: Literal[
        "trendline_pair", "neckline", "cup_curve",
        "rectangle", "candle_mark", "horizontal_line",
    ]
    anchors: list[Anchor]
    extras: dict   # pattern-specific extras (height_pct, depth_pct, etc.)


class Levels(TypedDict):
    entry: float
    entry_condition: str
    stop: float
    stop_basis: str
    target_primary: float
    target_secondary: float | None
    risk_reward: float


class Context(TypedDict):
    trend_stage: int                                            # Weinstein 1-4
    rs_trend: Literal["up", "flat", "down"]
    ma_alignment: Literal["stacked_bullish", "mixed", "stacked_bearish"]
    volume_signature: Literal["contracting", "expanding", "neutral"]
    regime: str
    nearest_resistance: float | None
    nearest_support: float | None
    days_to_earnings: int | None
    sector_strength_rank: int | None


class QualityComponents(TypedDict):
    geometry_score: float       # 0-100
    volume_score: float
    context_score: float
    historical_score: float


class Narrative(TypedDict):
    headline: str
    what_it_is: str
    why_it_matters: str
    what_to_watch_for: str
    failure_signal: str


class Outcome(TypedDict):
    entry_hit: bool
    stop_hit: bool
    target_hit: bool
    max_favorable_excursion_pct: float
    max_adverse_excursion_pct: float
    bars_to_resolution: int
    resolved_at: int | None


class Detection(TypedDict):
    id: str
    sym: str
    tf: str
    pattern_id: str
    pattern_name: str
    category: Literal["classical", "candlestick", "uct", "structure"]
    direction: Literal["bullish", "bearish", "neutral"]
    start_t: int
    end_t: int
    pivot_ts: list[int]
    geometry: Geometry
    levels: Levels
    context: Context
    confidence: float                # 0-100
    quality_components: QualityComponents
    narrative: Narrative
    status: Literal["forming", "ready", "triggered", "completed", "failed", "expired"]
    outcome: Outcome | None
    detected_at: int
    last_seen_at: int
