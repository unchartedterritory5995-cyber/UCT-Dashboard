import unittest.mock

from api.services.pattern_engine import memory
from api.services.pattern_engine.pattern_db import init_db, get_connection


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


# ───────── Phase 6: Outcome tracker + stats recompute ─────────


def _fresh_detection(detection_id: str, **overrides):
    """Build a detection with detected_at = now so lookback_hours always catches it."""
    import time as _time
    now = int(_time.time())
    base_overrides = {
        "id": detection_id,
        "detected_at": now,
        "last_seen_at": now,
    }
    base_overrides.update(overrides)
    return _detection(**base_overrides)


def test_track_outcomes_resolves_target_hit():
    """A detection where forward bars show target hit should mark completed."""
    init_db()
    d = _fresh_detection(
        "track-target", sym="TGT_TEST",
        start_t=1700000000, end_t=1700100000,
    )
    d["levels"] = {**d["levels"], "entry": 100.0, "stop": 95.0, "target_primary": 110.0}
    memory.store_detection(d)

    from api.services import bars_sqlite
    with unittest.mock.patch.object(bars_sqlite, "get_bars_since") as mock_bars:
        mock_bars.return_value = [
            (1700110000, 100, 105, 99, 103, 1000),
            (1700120000, 103, 112, 102, 111, 1500),  # high >= 110 = target hit
        ]
        n = memory.track_outcomes(lookback_hours=99999)

    assert n >= 1

    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM pattern_outcomes WHERE detection_id = ?", ("track-target",)
        ).fetchone()
        assert row is not None
        assert row["target_hit"] == 1
        assert row["stop_hit"] == 0
        assert row["entry_hit"] == 1
        det = conn.execute(
            "SELECT status FROM pattern_detections WHERE id = ?", ("track-target",)
        ).fetchone()
        assert det["status"] == "completed"
    finally:
        conn.close()


def test_track_outcomes_resolves_stop_hit():
    """A detection where forward bars show stop hit should mark failed."""
    init_db()
    d = _fresh_detection(
        "track-stop", sym="STOP_TEST",
        start_t=1700000000, end_t=1700100000,
    )
    d["levels"] = {**d["levels"], "entry": 100.0, "stop": 95.0, "target_primary": 110.0}
    memory.store_detection(d)

    from api.services import bars_sqlite
    with unittest.mock.patch.object(bars_sqlite, "get_bars_since") as mock_bars:
        # First bar: triggers entry (high >= 100). Second bar: hits stop (low <= 95).
        mock_bars.return_value = [
            (1700110000, 99, 101, 98, 100, 1000),  # entry triggered (h=101 >= 100)
            (1700120000, 100, 102, 94, 96, 1200),  # stop hit (l=94 <= 95)
        ]
        n = memory.track_outcomes(lookback_hours=99999)

    assert n >= 1

    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM pattern_outcomes WHERE detection_id = ?", ("track-stop",)
        ).fetchone()
        assert row is not None
        assert row["stop_hit"] == 1
        assert row["target_hit"] == 0
        assert row["entry_hit"] == 1
        det = conn.execute(
            "SELECT status FROM pattern_detections WHERE id = ?", ("track-stop",)
        ).fetchone()
        assert det["status"] == "failed"
    finally:
        conn.close()


def test_track_outcomes_skips_unresolved():
    """A detection with no forward bars (or insufficient) should NOT update status."""
    init_db()
    # Clean any leftover row from a prior test invocation so the assertion that
    # "no outcome row exists yet" is meaningful.
    conn = get_connection()
    try:
        conn.execute("DELETE FROM pattern_outcomes WHERE detection_id = ?", ("track-open",))
        conn.commit()
    finally:
        conn.close()

    d = _fresh_detection(
        "track-open", sym="OPEN_TEST",
        start_t=1700000000, end_t=1700100000,
    )
    d["levels"] = {**d["levels"], "entry": 100.0, "stop": 95.0, "target_primary": 110.0}
    memory.store_detection(d)
    # Reset status to 'ready' in case a prior run left it completed/failed/expired
    # (which would cause track_outcomes to skip it via the status-IN clause).
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE pattern_detections SET status='ready' WHERE id=?", ("track-open",)
        )
        conn.commit()
    finally:
        conn.close()

    from api.services import bars_sqlite
    with unittest.mock.patch.object(bars_sqlite, "get_bars_since") as mock_bars:
        # Empty forward bars — nothing to resolve.
        mock_bars.return_value = []
        n_empty = memory.track_outcomes(lookback_hours=99999)

    # Verify no outcome row written and status still 'ready'.
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM pattern_outcomes WHERE detection_id = ?", ("track-open",)
        ).fetchone()
        assert row is None
        det = conn.execute(
            "SELECT status FROM pattern_detections WHERE id = ?", ("track-open",)
        ).fetchone()
        assert det["status"] == "ready"
    finally:
        conn.close()

    # Now try with a few bars that neither hit entry/stop/target — still "open"
    with unittest.mock.patch.object(bars_sqlite, "get_bars_since") as mock_bars:
        # Entry=100, stop=95, target=110. Bars stay in 96-99 range — never trigger entry.
        mock_bars.return_value = [
            (1700110000, 97, 99, 96, 98, 1000),
            (1700120000, 98, 99, 97, 98, 1100),
        ]
        n_open = memory.track_outcomes(lookback_hours=99999)

    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM pattern_outcomes WHERE detection_id = ?", ("track-open",)
        ).fetchone()
        assert row is None
        det = conn.execute(
            "SELECT status FROM pattern_detections WHERE id = ?", ("track-open",)
        ).fetchone()
        assert det["status"] == "ready"
    finally:
        conn.close()


def test_recompute_stats_populates_table():
    """After running, pattern_stats should have rows aggregated from detections."""
    init_db()

    # Clear pre-existing data so the test is deterministic about row counts.
    conn = get_connection()
    try:
        conn.execute("DELETE FROM pattern_outcomes")
        conn.execute("DELETE FROM pattern_feedback")
        conn.execute("DELETE FROM pattern_detections")
        conn.execute("DELETE FROM pattern_stats")
        conn.commit()
    finally:
        conn.close()

    # Two detections, same pattern + tf + regime.
    d1 = _fresh_detection("rs-1", sym="RS_T1", start_t=1700000000, end_t=1700100000)
    d2 = _fresh_detection("rs-2", sym="RS_T2", start_t=1700200000, end_t=1700300000)
    memory.store_detection(d1)
    memory.store_detection(d2)

    n = memory.recompute_stats()
    assert n >= 1

    conn = get_connection()
    try:
        rows = conn.execute("SELECT * FROM pattern_stats").fetchall()
        assert len(rows) >= 1
        # Should bucket as (bull_flag, D, bull)
        match = [r for r in rows if r["pattern_id"] == "bull_flag" and r["tf"] == "D"]
        assert len(match) == 1
        assert match[0]["regime_bucket"] == "bull"
        assert match[0]["n_total"] == 2
        assert match[0]["n_resolved"] == 0  # no outcomes stored yet
    finally:
        conn.close()


def test_recompute_stats_hit_rate_correct():
    """Verify hit_rate math: 2 resolved detections, 1 target_hit → hit_rate = 0.5."""
    init_db()

    conn = get_connection()
    try:
        conn.execute("DELETE FROM pattern_outcomes")
        conn.execute("DELETE FROM pattern_feedback")
        conn.execute("DELETE FROM pattern_detections")
        conn.execute("DELETE FROM pattern_stats")
        conn.commit()
    finally:
        conn.close()

    d1 = _fresh_detection("hr-1", sym="HR_T1", start_t=1700000000, end_t=1700100000)
    d2 = _fresh_detection("hr-2", sym="HR_T2", start_t=1700200000, end_t=1700300000)
    memory.store_detection(d1)
    memory.store_detection(d2)

    # Manually insert outcomes: one target_hit, one stop_hit.
    conn = get_connection()
    try:
        conn.execute("""
            INSERT INTO pattern_outcomes (
                detection_id, entry_hit, entry_hit_t, stop_hit, stop_hit_t,
                target_hit, target_hit_t, mfe_pct, mae_pct,
                bars_to_resolve, resolved_at
            ) VALUES (?, 1, 1700110000, 0, NULL, 1, 1700120000, 10.0, 2.0, 5, ?)
        """, ("hr-1", int(__import__("time").time())))
        conn.execute("""
            INSERT INTO pattern_outcomes (
                detection_id, entry_hit, entry_hit_t, stop_hit, stop_hit_t,
                target_hit, target_hit_t, mfe_pct, mae_pct,
                bars_to_resolve, resolved_at
            ) VALUES (?, 1, 1700210000, 1, 1700220000, 0, NULL, 1.5, 5.0, 7, ?)
        """, ("hr-2", int(__import__("time").time())))
        conn.commit()
    finally:
        conn.close()

    n = memory.recompute_stats()
    assert n >= 1

    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM pattern_stats WHERE pattern_id = 'bull_flag' AND tf = 'D'"
        ).fetchone()
        assert row is not None
        assert row["n_total"] == 2
        assert row["n_resolved"] == 2
        assert row["n_target_hit"] == 1
        assert row["n_stop_hit"] == 1
        assert abs(row["hit_rate"] - 0.5) < 1e-6
        # expectancy = 0.5*2 - 0.5*1 = 0.5
        assert abs(row["expectancy_R"] - 0.5) < 1e-6
    finally:
        conn.close()


def test_recompute_stats_clears_before_rewrite():
    """Running twice should be idempotent — same input produces same row count."""
    init_db()

    conn = get_connection()
    try:
        conn.execute("DELETE FROM pattern_outcomes")
        conn.execute("DELETE FROM pattern_feedback")
        conn.execute("DELETE FROM pattern_detections")
        conn.execute("DELETE FROM pattern_stats")
        conn.commit()
    finally:
        conn.close()

    memory.store_detection(_fresh_detection("idem-1", sym="IDEM_T1",
                                            start_t=1700000000, end_t=1700100000))
    memory.store_detection(_fresh_detection("idem-2", sym="IDEM_T2",
                                            start_t=1700200000, end_t=1700300000))

    n1 = memory.recompute_stats()
    n2 = memory.recompute_stats()

    assert n1 == n2

    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM pattern_stats WHERE pattern_id = 'bull_flag' AND tf = 'D'"
        ).fetchall()
        # Should still be exactly one row — not duplicated.
        assert len(rows) == 1
        assert rows[0]["n_total"] == 2
    finally:
        conn.close()
