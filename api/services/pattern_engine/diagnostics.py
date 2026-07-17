"""Diagnostic snapshot of the pattern engine state.

Pure read functions, no side effects. Consumed by /api/admin/patterns/health.
"""
from __future__ import annotations

import time

from api.services.pattern_engine.pattern_db import get_connection, init_db


def collect_health() -> dict:
    """Build a single dict snapshotting the engine state."""
    from api.routers import patterns as _patterns  # noqa: F401
    from api.services.pattern_engine.detectors.registry import list_pattern_ids

    init_db()

    registered = list_pattern_ids()

    conn = get_connection()
    try:
        row = conn.execute("SELECT COUNT(*) AS n FROM pattern_detections").fetchone()
        total = row["n"] if row else 0

        rows = conn.execute(
            "SELECT pattern_id, COUNT(*) AS n FROM pattern_detections GROUP BY pattern_id"
        ).fetchall()
        by_pattern = {r["pattern_id"]: r["n"] for r in rows}

        rows = conn.execute(
            "SELECT status, COUNT(*) AS n FROM pattern_detections GROUP BY status"
        ).fetchall()
        by_status = {r["status"]: r["n"] for r in rows}

        now = int(time.time())
        cutoff = now - 86400
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM pattern_detections WHERE detected_at >= ?",
            (cutoff,),
        ).fetchone()
        recent = row["n"] if row else 0

        row = conn.execute(
            "SELECT MAX(detected_at) AS t FROM pattern_detections"
        ).fetchone()
        last_detected_at = row["t"] if row and row["t"] else None
    finally:
        conn.close()

    return {
        "generated_at": int(time.time()),
        "detector_count": len(registered),
        "registered_detectors": registered,
        "stored_detections_total": total,
        "stored_by_pattern": by_pattern,
        "stored_by_status": by_status,
        "recent_24h_count": recent,
        "last_detected_at": last_detected_at,
        "schema_version": "phase_0",
    }
