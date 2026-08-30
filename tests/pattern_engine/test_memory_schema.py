"""Verify the 4 pattern tables exist in the DEDICATED pattern DB (patterns.db,
not auth.db — moved 2026-07-16 to stop the universe scan starving broker syncs
of auth.db's write lock), and that legacy auth.db rows migrate one-shot."""
import os
import sqlite3

from api.services import auth_db
from api.services.pattern_engine import pattern_db
from api.services.pattern_engine.pattern_db import get_connection, init_db


def _isolate(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    pattern_db._initialized_paths.clear()


def test_pattern_tables_exist_after_init(tmp_path, monkeypatch):
    _isolate(tmp_path, monkeypatch)
    init_db()
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'pattern_%'"
        ).fetchall()
        names = sorted([r["name"] for r in rows])
        assert names == [
            "pattern_detections",
            "pattern_feedback",
            "pattern_outcomes",
            "pattern_stats",
        ]
    finally:
        conn.close()


def test_pattern_detections_indexes_exist(tmp_path, monkeypatch):
    _isolate(tmp_path, monkeypatch)
    init_db()
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_pd_%'"
        ).fetchall()
        names = {r["name"] for r in rows}
        # ⛔ A SUBSET, NOT AN EQUALITY. This asserted an exact three-name set
        # and went stale the day `idx_pd_detected` landed (2026-08-26, with the
        # Patterns-page retirement: the nightly prune and the windowed
        # active-read both need it). A hand-typed set beside the schema it
        # describes is this repo's most repeated defect -- the writer-index
        # FOUR, the COT router's "4 routes", `len(failures) == 6`. The property
        # actually under test is that the REQUIRED indexes exist; a legitimate
        # new one must not turn this red.
        required = {"idx_pd_sym_tf", "idx_pd_pattern", "idx_pd_status"}
        assert required <= names, sorted(required - names)
        # ...and the probe is not vacuous: it can see a name that is not there.
        assert "idx_pd_definitely_not_a_real_index" not in names
    finally:
        conn.close()


def test_pattern_db_lives_next_to_auth_db(tmp_path, monkeypatch):
    _isolate(tmp_path, monkeypatch)
    init_db()
    assert os.path.exists(tmp_path / "patterns.db")


def test_legacy_auth_db_rows_migrate_once(tmp_path, monkeypatch):
    _isolate(tmp_path, monkeypatch)
    # Simulate a pre-move auth.db that still holds a detection.
    legacy = sqlite3.connect(tmp_path / "auth.db")
    legacy.execute("""CREATE TABLE pattern_detections (
        id TEXT PRIMARY KEY, sym TEXT NOT NULL, tf TEXT NOT NULL,
        pattern_id TEXT NOT NULL, category TEXT NOT NULL, direction TEXT NOT NULL,
        start_t INTEGER NOT NULL, end_t INTEGER NOT NULL, confidence REAL NOT NULL,
        quality_json TEXT NOT NULL, geometry_json TEXT NOT NULL,
        levels_json TEXT NOT NULL, context_json TEXT NOT NULL,
        narrative_json TEXT NOT NULL, status TEXT NOT NULL,
        detected_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
        hash_key TEXT NOT NULL UNIQUE)""")
    legacy.execute(
        "INSERT INTO pattern_detections VALUES ('d1','AAPL','D','bull_flag',"
        "'classical','bullish',1,2,75,'{}','{}','{}','{}','{}','ready',10,10,'hk1')")
    legacy.commit()
    legacy.close()

    init_db()
    conn = get_connection()
    try:
        row = conn.execute("SELECT sym FROM pattern_detections WHERE id='d1'").fetchone()
        assert row is not None and row["sym"] == "AAPL"
    finally:
        conn.close()


def test_huge_legacy_detections_skip_bulk_but_copy_small_tables(tmp_path, monkeypatch):
    """Prod regression 2026-07-17: a 2.37M-row legacy table must NOT be bulk
    copied (it built a 10 GB WAL in-request). Stats/feedback still migrate."""
    _isolate(tmp_path, monkeypatch)
    monkeypatch.setattr(pattern_db, "_MIGRATE_MAX_ROWS", 1)
    legacy = sqlite3.connect(tmp_path / "auth.db")
    legacy.execute("""CREATE TABLE pattern_detections (
        id TEXT PRIMARY KEY, sym TEXT NOT NULL, tf TEXT NOT NULL,
        pattern_id TEXT NOT NULL, category TEXT NOT NULL, direction TEXT NOT NULL,
        start_t INTEGER NOT NULL, end_t INTEGER NOT NULL, confidence REAL NOT NULL,
        quality_json TEXT NOT NULL, geometry_json TEXT NOT NULL,
        levels_json TEXT NOT NULL, context_json TEXT NOT NULL,
        narrative_json TEXT NOT NULL, status TEXT NOT NULL,
        detected_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
        hash_key TEXT NOT NULL UNIQUE)""")
    for i in range(3):  # 3 rows > cap of 1
        legacy.execute(
            "INSERT INTO pattern_detections VALUES (?,?,'D','bull_flag','classical',"
            "'bullish',1,2,75,'{}','{}','{}','{}','{}','ready',10,10,?)",
            (f"d{i}", "AAPL", f"hk{i}"))
    legacy.execute("""CREATE TABLE pattern_stats (
        pattern_id TEXT NOT NULL, tf TEXT NOT NULL, regime_bucket TEXT NOT NULL,
        n_total INTEGER NOT NULL DEFAULT 0, n_resolved INTEGER NOT NULL DEFAULT 0,
        n_entry_hit INTEGER NOT NULL DEFAULT 0, n_target_hit INTEGER NOT NULL DEFAULT 0,
        n_stop_hit INTEGER NOT NULL DEFAULT 0, avg_mfe_pct REAL, avg_mae_pct REAL,
        median_bars INTEGER, hit_rate REAL, expectancy_R REAL,
        last_updated INTEGER NOT NULL, PRIMARY KEY (pattern_id, tf, regime_bucket))""")
    legacy.execute(
        "INSERT INTO pattern_stats VALUES ('bull_flag','D','bull',5,4,3,2,1,"
        "2.0,-1.0,4,0.5,0.8,100)")
    legacy.commit()
    legacy.close()

    init_db()
    conn = get_connection()
    try:
        assert conn.execute("SELECT COUNT(*) FROM pattern_detections").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM pattern_stats").fetchone()[0] == 1
    finally:
        conn.close()
