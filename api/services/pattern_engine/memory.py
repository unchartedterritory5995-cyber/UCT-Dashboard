"""Storage layer for pattern detections.

Responsibilities:
  - store_detection(d): UPSERT by stable hash of (sym, tf, pattern_id, start_t, end_t)
  - get_active_detections(sym, tf, pattern_ids=None): query for chart overlay
  - get_detection_by_id(id)
  - record_feedback(detection_id, user_id, rating, note=None)
  - track_outcomes(): Phase 7 stub (returns 0 in Phase 0)
  - recompute_stats(): Phase 7 stub (returns 0 in Phase 0)
"""
from __future__ import annotations

import hashlib
import json
import time
from typing import Optional

from api.services.auth_db import get_connection
from api.services.pattern_engine.types import Detection


_VALID_FEEDBACK_RATINGS = {"great", "good", "miss", "wrong"}


def _hash_key(sym: str, tf: str, pattern_id: str, start_t: int, end_t: int) -> str:
    """Stable hash for dedup. Identical pattern geometry on same symbol/TF/range
    collapses to one row regardless of how many times the engine fires."""
    raw = f"{sym}|{tf}|{pattern_id}|{start_t}|{end_t}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def store_detection(d: Detection) -> None:
    """UPSERT a detection. New shapes → INSERT. Recurrent same-shape → UPDATE
    last_seen_at + confidence + status (whichever the engine last computed)."""
    hk = _hash_key(d["sym"], d["tf"], d["pattern_id"], d["start_t"], d["end_t"])

    conn = get_connection()
    try:
        conn.execute("""
            INSERT INTO pattern_detections (
              id, sym, tf, pattern_id, category, direction,
              start_t, end_t, confidence,
              quality_json, geometry_json, levels_json, context_json, narrative_json,
              status, detected_at, last_seen_at, hash_key
            ) VALUES (
              ?, ?, ?, ?, ?, ?,
              ?, ?, ?,
              ?, ?, ?, ?, ?,
              ?, ?, ?, ?
            )
            ON CONFLICT(hash_key) DO UPDATE SET
              confidence    = excluded.confidence,
              quality_json  = excluded.quality_json,
              geometry_json = excluded.geometry_json,
              levels_json   = excluded.levels_json,
              context_json  = excluded.context_json,
              narrative_json = excluded.narrative_json,
              status        = excluded.status,
              last_seen_at  = excluded.last_seen_at
        """, (
            d["id"], d["sym"], d["tf"], d["pattern_id"], d["category"], d["direction"],
            d["start_t"], d["end_t"], d["confidence"],
            json.dumps(d["quality_components"]),
            json.dumps(d["geometry"]),
            json.dumps(d["levels"]),
            json.dumps(d["context"]),
            json.dumps(d["narrative"]),
            d["status"], d["detected_at"], d["last_seen_at"], hk,
        ))
        conn.commit()
    finally:
        conn.close()


def _row_to_detection(row) -> dict:
    """Reconstitute a Detection dict from a sqlite row."""
    return {
        "id": row["id"],
        "sym": row["sym"],
        "tf": row["tf"],
        "pattern_id": row["pattern_id"],
        "pattern_name": row["pattern_id"].replace("_", " ").title(),
        "category": row["category"],
        "direction": row["direction"],
        "start_t": row["start_t"],
        "end_t": row["end_t"],
        "pivot_ts": [],
        "geometry": json.loads(row["geometry_json"]),
        "levels": json.loads(row["levels_json"]),
        "context": json.loads(row["context_json"]),
        "confidence": row["confidence"],
        "quality_components": json.loads(row["quality_json"]),
        "narrative": json.loads(row["narrative_json"]),
        "status": row["status"],
        "outcome": None,
        "detected_at": row["detected_at"],
        "last_seen_at": row["last_seen_at"],
    }


def get_active_detections(
    sym: str,
    tf: str,
    pattern_ids: Optional[list[str]] = None,
    min_conf: float = 0.0,
) -> list[dict]:
    """Return detections for (sym, tf) with status not in ('completed', 'failed', 'expired'),
    sorted by detected_at desc."""
    conn = get_connection()
    try:
        sql = """
            SELECT * FROM pattern_detections
            WHERE sym = ? AND tf = ?
              AND status NOT IN ('completed', 'failed', 'expired')
              AND confidence >= ?
        """
        params: list = [sym.upper(), tf, min_conf]
        if pattern_ids:
            placeholders = ",".join(["?"] * len(pattern_ids))
            sql += f" AND pattern_id IN ({placeholders})"
            params.extend(pattern_ids)
        sql += " ORDER BY detected_at DESC"

        rows = conn.execute(sql, params).fetchall()
        return [_row_to_detection(r) for r in rows]
    finally:
        conn.close()


def get_detection_by_id(detection_id: str) -> Optional[dict]:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM pattern_detections WHERE id = ?", (detection_id,)
        ).fetchone()
        return _row_to_detection(row) if row else None
    finally:
        conn.close()


def record_feedback(detection_id: str, user_id: str, rating: str, note: Optional[str] = None) -> int:
    """Insert a feedback row. Returns the inserted row's id."""
    if rating not in _VALID_FEEDBACK_RATINGS:
        raise ValueError(f"invalid rating: {rating}. Must be one of {_VALID_FEEDBACK_RATINGS}")

    conn = get_connection()
    try:
        cursor = conn.execute("""
            INSERT INTO pattern_feedback (detection_id, user_id, rating, note, created_at)
            VALUES (?, ?, ?, ?, ?)
        """, (detection_id, user_id, rating, note, int(time.time())))
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()


def track_outcomes(lookback_hours: int = 48) -> int:
    """Stub. Phase 7 wires this up to walk forward bars and resolve open
    detections (entry hit / stop hit / target hit). Phase 0 does nothing."""
    return 0


def recompute_stats() -> int:
    """Stub. Phase 7 aggregates pattern_outcomes into pattern_stats nightly."""
    return 0
