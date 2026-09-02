"""TypedDict definitions for the pattern recognition engine.

These are the source-of-truth shapes for everything the engine emits.
Consumers (detectors, memory, API, UI) all import from here.
"""
from __future__ import annotations

from typing import Literal, NotRequired, TypedDict


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
    """A fitted boundary line, TAGGED WITH THE SPACE IT WAS FITTED IN.

    ⛔ `space` IS LOAD-BEARING, NOT METADATA. `slope` carries a different
    UNIT in each space and `p1`/`p2` describe a different CURVE:

      - "price": slope is price-per-bar; the curve between p1 and p2 is the
                 straight line through them, so a linear read is exact.
      - "log":   slope is d(log price)/bar - a fractional growth rate per bar,
                 dimensionless. p1/p2 are exponentiated back into price for
                 drawing, but the curve BETWEEN them is exponential, so a
                 linear read between the endpoints is a CHORD, not the line.

    Read a price off a line with `geometry.price_at`, which respects this, and
    NEVER with `geometry.line_at`, which is unconditionally linear. Convert a
    slope to a comparable unit with `geometry.fractional_slope`.

    A line built by hand (a synthesized flat boundary, say) may omit `space`;
    every reader treats a missing value as "price", which is what such a line
    has always been. That is why it is NotRequired rather than defaulted at
    every construction site.
    """
    p1: Anchor
    p2: Anchor
    slope: float       # price per bar in "price" space; log-units per bar in "log"
    r_squared: float   # 0-1 fit quality
    touches: int       # number of pivots near the line
    validity: float    # 0-1 composite quality
    space: NotRequired[Literal["price", "log"]]   # absent == "price"


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
    # Phase 3 additions:
    recent_dcr_avg: float                                       # average DCR over last 10 bars, 0.0-1.0
    dcr_signature: Literal["accumulation", "distribution", "neutral"]  # trend-scale classifier
    # Phase 7.5 additions (CAN SLIM meta-pillar):
    can_slim_grade: Literal["A", "B", "C", "D"]                 # O'Neil 7-pillar composite grade
    can_slim_score: float                                       # 0-100 composite CAN SLIM score


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
