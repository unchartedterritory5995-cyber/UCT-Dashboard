from api.services.pattern_engine import memory
from api.services.auth_db import init_db


def _detection(**overrides):
    """Minimal valid Detection for testing."""
    base = {
        "id": "det-1",
        "sym": "AAPL", "tf": "D",
        "pattern_id": "bull_flag", "pattern_name": "Bull Flag",
        "category": "classical", "direction": "bullish",
        "start_t": 1700000000, "end_t": 1700100000,
        "pivot_ts": [1700000000, 1700100000],
        "geometry": {"shape": "trendline_pair", "anchors": [], "extras": {}},
        "levels": {"entry": 100.0, "entry_condition": "", "stop": 95.0, "stop_basis": "",
                   "target_primary": 110.0, "target_secondary": None, "risk_reward": 2.0},
        "context": {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
                    "volume_signature": "contracting", "regime": "bull",
                    "nearest_resistance": 110.0, "nearest_support": 95.0,
                    "days_to_earnings": None, "sector_strength_rank": None},
        "confidence": 75.0,
        "quality_components": {"geometry_score": 80.0, "volume_score": 75.0,
                               "context_score": 70.0, "historical_score": 50.0},
        "narrative": {"headline": "test", "what_it_is": "", "why_it_matters": "",
                      "what_to_watch_for": "", "failure_signal": ""},
        "status": "ready", "outcome": None,
        "detected_at": 1700100100, "last_seen_at": 1700100100,
    }
    base.update(overrides)
    return base


def test_store_detection_inserts_row():
    init_db()
    d = _detection(id="det-store-1")
    memory.store_detection(d)
    got = memory.get_detection_by_id("det-store-1")
    assert got is not None
    assert got["sym"] == "AAPL"
    assert got["confidence"] == 75.0


def test_store_detection_dedups_by_hash():
    """Storing the same detection twice (same sym/tf/pattern_id/start_t/end_t)
    should UPSERT — second call updates last_seen_at, not create a new row."""
    init_db()
    d1 = _detection(id="det-dedup-1", confidence=70.0, last_seen_at=1000)
    d2 = _detection(id="det-dedup-2", confidence=80.0, last_seen_at=2000)  # different id
    memory.store_detection(d1)
    memory.store_detection(d2)
    rows = memory.get_active_detections("AAPL", "D")
    matching = [r for r in rows if r["pattern_id"] == "bull_flag"
                                 and r["start_t"] == d1["start_t"]
                                 and r["end_t"] == d1["end_t"]]
    assert len(matching) == 1
    assert matching[0]["confidence"] == 80.0
    assert matching[0]["last_seen_at"] == 2000


def test_get_active_detections_filters_by_pattern():
    init_db()
    memory.store_detection(_detection(id="det-flag-1", pattern_id="bull_flag", start_t=1, end_t=2))
    memory.store_detection(_detection(id="det-cup-1", pattern_id="cup_handle", start_t=1, end_t=2))
    flags = memory.get_active_detections("AAPL", "D", pattern_ids=["bull_flag"])
    assert all(r["pattern_id"] == "bull_flag" for r in flags)


def test_record_feedback_inserts_row():
    init_db()
    # Use unique start_t/end_t so the UPSERT creates a fresh row with id="det-fb-1"
    # (avoids hash collision with earlier tests that share the default 1700000000/1700100000 window)
    memory.store_detection(_detection(id="det-fb-1", start_t=1799000000, end_t=1799100000))
    memory.record_feedback("det-fb-1", user_id="user-1", rating="great", note="clean setup")
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM pattern_feedback WHERE detection_id = ?", ("det-fb-1",)
        ).fetchone()
        assert row is not None
        assert row["rating"] == "great"
        assert row["user_id"] == "user-1"
    finally:
        conn.close()


def test_track_outcomes_stub_returns_zero():
    """Phase 0 stub: track_outcomes is schema-ready but does no work yet."""
    n = memory.track_outcomes(lookback_hours=48)
    assert n == 0


def test_recompute_stats_stub_returns_zero():
    n = memory.recompute_stats()
    assert n == 0
