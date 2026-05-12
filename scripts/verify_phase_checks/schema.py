"""Verify the 4 pattern_* tables + their indexes exist in auth.db."""
from __future__ import annotations

from api.services.auth_db import get_connection, init_db


_EXPECTED_TABLES = {"pattern_detections", "pattern_outcomes", "pattern_stats", "pattern_feedback"}
_EXPECTED_INDEXES = {"idx_pd_sym_tf", "idx_pd_pattern", "idx_pd_status", "idx_pf_detection"}


def run() -> dict:
    init_db()
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'pattern_%'"
        ).fetchall()
        tables = {r["name"] for r in rows}

        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_p%'"
        ).fetchall()
        indexes = {r["name"] for r in rows}

        missing_tables = _EXPECTED_TABLES - tables
        missing_indexes = _EXPECTED_INDEXES - indexes

        if missing_tables or missing_indexes:
            details_lines = []
            if missing_tables:
                details_lines.append(f"Missing tables: {sorted(missing_tables)}")
            if missing_indexes:
                details_lines.append(f"Missing indexes: {sorted(missing_indexes)}")
            return {"status": "FAIL", "summary": "schema incomplete",
                    "details": "\n".join(details_lines)}

        cols = conn.execute("PRAGMA table_info(pattern_detections)").fetchall()
        col_names = [c["name"] for c in cols]
        has_hash_key = "hash_key" in col_names

        details = (
            f"Tables: {sorted(tables)}\n"
            f"Indexes: {sorted(indexes)}\n"
            f"pattern_detections has hash_key column: {has_hash_key}"
        )
        return {"status": "PASS", "summary": "all 4 tables + 4 indexes present",
                "details": details}
    finally:
        conn.close()
