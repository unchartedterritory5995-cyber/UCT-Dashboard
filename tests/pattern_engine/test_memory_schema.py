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
        assert names == {"idx_pd_sym_tf", "idx_pd_pattern", "idx_pd_status"}
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
