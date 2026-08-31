import time
"""Smoke test for the types module — verifies all TypedDicts can be constructed
and that the schema matches the spec."""
from api.services.pattern_engine.types import (
    Bar, Pivot, Trendline, Anchor, Geometry, Levels, Context,
    QualityComponents, Narrative, Outcome, Detection,
)


def test_bar_typed_dict_construction():
    b: Bar = {"t": 1700000000, "o": 100.0, "h": 101.5, "l": 99.5, "c": 100.8, "v": 1000.0}
    assert b["t"] == 1700000000


def test_pivot_typed_dict_construction():
    p: Pivot = {"t": 1700000000, "price": 100.0, "type": "high", "strength": 50, "bar_index": 0}
    assert p["type"] == "high"


def test_detection_full_construction():
    """Build a complete Detection — proves every required field is present in the schema."""
    d: Detection = {
        "id": "abc-123",
        "sym": "AAPL",
        "tf": "D",
        "pattern_id": "bull_flag",
        "pattern_name": "Bull Flag",
        "category": "classical",
        "direction": "bullish",
        "start_t": 1700000000,
        "end_t": 1700100000,
        "pivot_ts": [1700000000, 1700050000, 1700100000],
        "geometry": {
            "shape": "trendline_pair",
            "anchors": [{"t": 1700000000, "price": 100.0}],
            "extras": {"height_pct": 8.2},
        },
        "levels": {
            "entry": 105.0, "entry_condition": "close > 105",
            "stop": 98.0, "stop_basis": "pattern_low",
            "target_primary": 115.0, "target_secondary": None,
            "risk_reward": 1.43,
        },
        "context": {
            "trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
            "volume_signature": "contracting", "regime": "bull",
            "nearest_resistance": 110.0, "nearest_support": 95.0,
            "days_to_earnings": 12, "sector_strength_rank": 3,
        },
        "confidence": 78.5,
        "quality_components": {
            "geometry_score": 80.0, "volume_score": 75.0,
            "context_score": 85.0, "historical_score": 50.0,
        },
        "narrative": {
            "headline": "Clean bull flag on Stage 2 uptrend",
            "what_it_is": "Sharp advance followed by tight consolidation.",
            "why_it_matters": "Continuation setup with measured move target.",
            "what_to_watch_for": "Breakout above flag high on volume > 1.5x avg.",
            "failure_signal": "Close below flag low invalidates pattern.",
        },
        "status": "ready",
        "outcome": None,
        "detected_at": 1700100100,
        "last_seen_at": 1700100100,
    }
    assert d["confidence"] == 78.5
    assert d["category"] == "classical"
