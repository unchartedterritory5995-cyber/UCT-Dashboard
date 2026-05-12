from api.services.pattern_engine import diagnostics
from api.services.pattern_engine import memory
from api.services.auth_db import init_db


def _det(**overrides):
    base = {
        "id": "diag-1", "sym": "DIAG", "tf": "D",
        "pattern_id": "bull_flag", "pattern_name": "Bull Flag",
        "category": "classical", "direction": "bullish",
        "start_t": 1700000000, "end_t": 1700100000,
        "pivot_ts": [],
        "geometry": {"shape": "trendline_pair", "anchors": [], "extras": {}},
        "levels": {"entry": 100, "entry_condition": "", "stop": 95, "stop_basis": "",
                   "target_primary": 110, "target_secondary": None, "risk_reward": 2.0},
        "context": {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
                    "volume_signature": "contracting", "regime": "bull",
                    "nearest_resistance": None, "nearest_support": None,
                    "days_to_earnings": None, "sector_strength_rank": None},
        "confidence": 75.0,
        "quality_components": {"geometry_score": 80.0, "volume_score": 75.0,
                               "context_score": 70.0, "historical_score": 50.0},
        "narrative": {"headline": "", "what_it_is": "", "why_it_matters": "",
                      "what_to_watch_for": "", "failure_signal": ""},
        "status": "ready", "outcome": None,
        "detected_at": 1700100100, "last_seen_at": 1700100100,
    }
    base.update(overrides)
    return base


def test_collect_returns_required_top_level_keys():
    init_db()
    h = diagnostics.collect_health()
    for key in ("detector_count", "stored_detections_total", "stored_by_pattern",
                "stored_by_status", "recent_24h_count", "registered_detectors"):
        assert key in h


def test_stored_by_pattern_counts():
    init_db()
    memory.store_detection(_det(id="diag-1", sym="AAAA", start_t=1, end_t=2))
    memory.store_detection(_det(id="diag-2", sym="BBBB", start_t=3, end_t=4))
    h = diagnostics.collect_health()
    assert h["stored_by_pattern"].get("bull_flag", 0) >= 2


def test_registered_detectors_includes_bull_flag():
    h = diagnostics.collect_health()
    assert "bull_flag" in h["registered_detectors"]
