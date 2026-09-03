import time
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
        # Recent, not a 2023 literal: get_active_detections windows on
        # detected_at (ACTIVE_WINDOW_SECS) since 2026-08-26, so a historic
        # timestamp here would silently empty every active-read assertion.
        "detected_at": int(time.time()) - 60, "last_seen_at": int(time.time()) - 60,
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


# ---------------------------------------------------------------------------
# Active window + retention sweep (added 2026-08-26 with the Patterns page
# retirement — before this, "active" had no time bound on the per-symbol read
# and the store had no prune at all; prod hit 13.57 GB in six weeks).
# ---------------------------------------------------------------------------


def test_get_active_detections_windows_on_detected_at():
    """A stale 'ready' row is NOT active — statuses freeze once a row ages past
    track_outcomes' 48h lookback, so recency is part of the definition."""
    init_db()
    now = int(time.time())
    stale = now - memory.ACTIVE_WINDOW_SECS - 3600
    memory.store_detection(_detection(id="det-win-old", sym="WNDW",
                                      start_t=1, end_t=2,
                                      detected_at=stale, last_seen_at=stale))
    memory.store_detection(_detection(id="det-win-new", sym="WNDW",
                                      start_t=3, end_t=4,
                                      detected_at=now - 60, last_seen_at=now - 60))
    rows = memory.get_active_detections("WNDW", "D")
    ids = {r["id"] for r in rows}
    assert "det-win-new" in ids
    assert "det-win-old" not in ids


def test_prune_old_deletes_past_retention_and_orphans():
    init_db()
    now = int(time.time())
    old_ts = now - (memory.PRUNE_RETENTION_DAYS + 2) * 86400
    memory.store_detection(_detection(id="det-prune-old", sym="PRNE",
                                      start_t=1, end_t=2,
                                      detected_at=old_ts, last_seen_at=old_ts))
    memory.store_detection(_detection(id="det-prune-new", sym="PRNE",
                                      start_t=3, end_t=4,
                                      detected_at=now - 60, last_seen_at=now - 60))
    # An outcome row attached to the old detection must go with it.
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO pattern_outcomes"
            " (detection_id, entry_hit, stop_hit, target_hit, resolved_at)"
            " VALUES (?, 1, 0, 1, ?)",
            ("det-prune-old", old_ts),
        )
        conn.commit()
    finally:
        conn.close()

    result = memory.prune_old()
    assert result["deleted"] >= 1
    assert result["orphan_outcomes"] >= 1

    assert memory.get_detection_by_id("det-prune-old") is None
    assert memory.get_detection_by_id("det-prune-new") is not None
    conn = get_connection()
    try:
        left = conn.execute(
            "SELECT COUNT(*) FROM pattern_outcomes WHERE detection_id = ?",
            ("det-prune-old",),
        ).fetchone()[0]
    finally:
        conn.close()
    assert left == 0


def test_prune_old_is_a_noop_on_fresh_rows():
    """Control: a store holding only in-window rows loses nothing."""
    init_db()
    now = int(time.time())
    memory.store_detection(_detection(id="det-prune-keep", sym="KEEP",
                                      start_t=9, end_t=10,
                                      detected_at=now - 3600, last_seen_at=now - 3600))
    memory.prune_old()
    assert memory.get_detection_by_id("det-prune-keep") is not None


def test_detected_at_index_exists():
    """The window/prune queries lean on idx_pd_detected; without it every
    7-day read full-scanned the table (the prod 13.6 GB lesson)."""
    init_db()
    conn = get_connection()
    try:
        names = {r[1] for r in conn.execute("PRAGMA index_list(pattern_detections)")}
    finally:
        conn.close()
    assert "idx_pd_detected" in names


# ---------------------------------------------------------------------------
# Phase 3B: historical-score data-foundation prerequisite correction
# (2026-09-03). Prior production behavior: track_outcomes() was called with a
# hardcoded lookback_hours=72 (api/main.py's scheduled job) and
# PRUNE_RETENTION_DAYS defaulted to 10 — together this meant a detection
# whose pattern took longer than 3 days to resolve (nearly all
# classical/structure/uct-family patterns; candlesticks were mostly fine) was
# NEVER re-evaluated by track_outcomes() past 72h, then silently deleted by
# prune_old() at day 10 with pattern_outcomes never populated. Confirmed
# against real production data (`C:\data\patterns.db`, a local read-only
# mirror): candlestick-family resolution 21-77%, classical/structure/uct-
# family 0.0-0.5% (vcp itself: 515 detections, 0 resolved).
# ---------------------------------------------------------------------------


def test_old_72h_lookback_would_abandon_a_slow_resolving_detection():
    """Reproduction of the PRIOR production defect: a detection detected 4
    days ago (older than the old hardcoded 72h window, younger than the new
    90-day default) with forward bars that WOULD resolve it (target hit) is
    invisible to track_outcomes() at the old lookback_hours=72 — it falls
    outside the `WHERE detected_at >= cutoff` clause entirely, so it is never
    even considered, regardless of what the forward bars show."""
    init_db()
    now = int(time.time())
    four_days_ago = now - 4 * 86400  # > 72h, < new 90-day default
    d = _detection(
        id="old-defect-repro", sym="OLDDEF_TEST",
        start_t=1700000000, end_t=1700100000,
        detected_at=four_days_ago, last_seen_at=four_days_ago,
    )
    d["levels"] = {**d["levels"], "entry": 100.0, "stop": 95.0, "target_primary": 110.0}
    memory.store_detection(d)

    from api.services import bars_sqlite
    with unittest.mock.patch.object(bars_sqlite, "get_bars_since") as mock_bars:
        mock_bars.return_value = [
            (1700110000, 100, 105, 99, 103, 1000),
            (1700120000, 103, 112, 102, 111, 1500),  # would hit target if ever checked
        ]
        memory.track_outcomes(lookback_hours=72)

    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM pattern_outcomes WHERE detection_id = ?",
            ("old-defect-repro",),
        ).fetchone()
    finally:
        conn.close()
    assert row is None, "old 72h lookback should not have resolved a 4-day-old detection"


def test_corrected_default_lookback_resolves_the_same_detection():
    """The SAME shape of detection as the reproduction above, resolved with
    the corrected default (no explicit lookback_hours — uses
    memory.TRACK_OUTCOMES_LOOKBACK_HOURS, 90 days) DOES get picked up and
    resolved. This is the fix, proven the same way the defect was proven."""
    init_db()
    now = int(time.time())
    four_days_ago = now - 4 * 86400
    d = _detection(
        id="old-defect-fixed", sym="FIXDEF_TEST",
        start_t=1700000000, end_t=1700100000,
        detected_at=four_days_ago, last_seen_at=four_days_ago,
    )
    d["levels"] = {**d["levels"], "entry": 100.0, "stop": 95.0, "target_primary": 110.0}
    memory.store_detection(d)

    from api.services import bars_sqlite
    with unittest.mock.patch.object(bars_sqlite, "get_bars_since") as mock_bars:
        mock_bars.return_value = [
            (1700110000, 100, 105, 99, 103, 1000),
            (1700120000, 103, 112, 102, 111, 1500),
        ]
        n = memory.track_outcomes()  # corrected default, no explicit override

    assert n >= 1
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM pattern_outcomes WHERE detection_id = ?",
            ("old-defect-fixed",),
        ).fetchone()
        assert row is not None
        assert row["target_hit"] == 1
    finally:
        conn.close()


def test_track_outcomes_lookback_default_is_90_days():
    """Pin the corrected default value itself, not just its effect."""
    assert memory.TRACK_OUTCOMES_LOOKBACK_HOURS == 90 * 24


def test_prune_retention_default_is_120_days():
    """Pin the corrected default value itself, not just its effect."""
    assert memory.PRUNE_RETENTION_DAYS == 120


def test_prune_retention_exceeds_track_outcomes_lookback_with_margin():
    """The retention window must outlive the lookback window, or prune_old()
    can delete a detection before track_outcomes() ever gets a chance to
    re-check it — exactly the defect this phase fixes. Assert a real margin,
    not just 'greater than', so recompute_stats() has time to aggregate a
    freshly-resolved row before it's pruned."""
    lookback_days = memory.TRACK_OUTCOMES_LOOKBACK_HOURS / 24
    assert memory.PRUNE_RETENTION_DAYS > lookback_days
    assert memory.PRUNE_RETENTION_DAYS - lookback_days >= 14


def test_prune_old_still_survives_past_the_old_10_day_window():
    """A detection 15 days old — past the OLD 10-day retention, well inside
    the NEW 120-day one — must survive prune_old(). Proves the window
    actually widened, not merely that the test follows whatever the constant
    currently says."""
    init_db()
    now = int(time.time())
    fifteen_days_ago = now - 15 * 86400
    memory.store_detection(_detection(
        id="det-widened-retention", sym="WIDEN",
        start_t=5, end_t=6,
        detected_at=fifteen_days_ago, last_seen_at=fifteen_days_ago,
    ))
    memory.prune_old()
    assert memory.get_detection_by_id("det-widened-retention") is not None, (
        "a 15-day-old row must survive under the corrected 120-day retention "
        "(it would have been deleted under the old 10-day retention)"
    )


def test_track_outcomes_lookback_env_override(monkeypatch):
    """PATTERN_TRACK_OUTCOMES_LOOKBACK_HOURS is honored on (re)import —
    the reversible-extension knob B2 calls for."""
    import importlib
    monkeypatch.setenv("PATTERN_TRACK_OUTCOMES_LOOKBACK_HOURS", "48")
    try:
        importlib.reload(memory)
        assert memory.TRACK_OUTCOMES_LOOKBACK_HOURS == 48
    finally:
        monkeypatch.delenv("PATTERN_TRACK_OUTCOMES_LOOKBACK_HOURS", raising=False)
        importlib.reload(memory)  # restore the real default for later tests


def test_prune_retention_env_override(monkeypatch):
    """PATTERN_PRUNE_RETENTION_DAYS is honored on (re)import."""
    import importlib
    monkeypatch.setenv("PATTERN_PRUNE_RETENTION_DAYS", "5")
    try:
        importlib.reload(memory)
        assert memory.PRUNE_RETENTION_DAYS == 5
    finally:
        monkeypatch.delenv("PATTERN_PRUNE_RETENTION_DAYS", raising=False)
        importlib.reload(memory)
