"""Verify the 4 pattern recognition tables exist after init_db() runs."""
from api.services.auth_db import get_connection, init_db


def test_pattern_tables_exist_after_init():
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


def test_pattern_detections_indexes_exist():
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
