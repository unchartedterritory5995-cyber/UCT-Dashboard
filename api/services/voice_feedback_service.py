"""
Voice feedback service — store thumbs and corrections per turn so the
assistant can learn from mistakes.

Corrections are injected into the next session's system prompt so the
assistant carries forward what the user has explicitly taught it.
"""

import logging
from datetime import datetime, timezone, timedelta

from api.services.auth_db import get_connection

_log = logging.getLogger(__name__)

# How many most-recent corrections to inject into a fresh session.
MAX_CORRECTIONS_INJECTED = 12

# Corrections older than this fall out of the injection window.
CORRECTION_TTL_DAYS = 60


def record_feedback(
    user_id: str,
    *,
    rating: str,
    session_id: int | None = None,
    turn_text: str | None = None,
    correction_text: str | None = None,
) -> dict:
    """Store a thumbs up/down plus optional correction."""
    if rating not in ("up", "down"):
        raise ValueError("rating must be 'up' or 'down'")
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            INSERT INTO voice_feedback
              (user_id, session_id, rating, turn_text, correction_text)
            VALUES (?, ?, ?, ?, ?)
            """,
            (user_id, session_id, rating, turn_text, correction_text),
        )
        conn.commit()
        return {
            "id": cur.lastrowid,
            "user_id": user_id,
            "rating": rating,
            "session_id": session_id,
            "turn_text": turn_text,
            "correction_text": correction_text,
        }
    finally:
        conn.close()


def list_corrections(user_id: str, limit: int = MAX_CORRECTIONS_INJECTED) -> list[dict]:
    """Recent corrections for a user (correction_text NOT NULL), newest first."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=CORRECTION_TTL_DAYS)).isoformat()
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT id, rating, turn_text, correction_text, created_at
              FROM voice_feedback
             WHERE user_id = ?
               AND correction_text IS NOT NULL
               AND correction_text != ''
               AND created_at >= ?
             ORDER BY created_at DESC, id DESC
             LIMIT ?
            """,
            (user_id, cutoff, limit),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def list_feedback(user_id: str, limit: int = 100) -> list[dict]:
    """All feedback for a user, newest first."""
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT id, session_id, rating, turn_text, correction_text, created_at
              FROM voice_feedback
             WHERE user_id = ?
             ORDER BY created_at DESC
             LIMIT ?
            """,
            (user_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def build_corrections_block(user_id: str) -> str:
    """Compose the corrections section that gets appended to memory_context."""
    corrections = list_corrections(user_id)
    if not corrections:
        return ""
    lines = ["Corrections the user has previously given you (apply these going forward):"]
    for c in corrections:
        if c.get("correction_text"):
            lines.append(f"  - {c['correction_text']}")
    return "\n".join(lines)


# ── Tool call audit ────────────────────────────────────────────────────────

def record_tool_call(
    user_id: str,
    *,
    tool_name: str,
    args: dict | None,
    ok: bool,
    error: str | None = None,
    latency_ms: int | None = None,
    session_id: int | None = None,
) -> None:
    """Log a tool dispatch — fire-and-forget. Failures here never bubble."""
    import json
    try:
        args_json = json.dumps(args) if args else None
    except (TypeError, ValueError):
        args_json = None
    conn = get_connection()
    try:
        conn.execute(
            """
            INSERT INTO voice_tool_calls
              (user_id, session_id, tool_name, args_json, ok, error, latency_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (user_id, session_id, tool_name, args_json,
             1 if ok else 0, (error or "")[:500], latency_ms),
        )
        conn.commit()
    except Exception as e:  # noqa: BLE001
        _log.warning("[voice_feedback] record_tool_call failed: %s", e)
    finally:
        conn.close()


def detect_failure_patterns(
    user_id: str,
    *,
    window: int = 20,
    min_calls: int = 5,
    failure_threshold: float = 0.30,
) -> list[dict]:
    """
    Surface tools that are misbehaving for this user. A "pattern" is a tool
    that:
      - has been called >= `min_calls` times in the last `window` invocations
      - has a failure rate >= `failure_threshold`

    Returns one entry per offending tool, newest-failure-first within each.
    """
    conn = get_connection()
    try:
        # Per-tool window stats over the last N calls per tool
        rows = conn.execute(
            """
            WITH ranked AS (
              SELECT tool_name, ok, error,
                     ROW_NUMBER() OVER (
                       PARTITION BY tool_name
                       ORDER BY id DESC
                     ) AS rn
                FROM voice_tool_calls
               WHERE user_id = ?
            )
            SELECT tool_name,
                   COUNT(*)         AS total,
                   SUM(ok)          AS success,
                   SUM(1 - ok)      AS failures
              FROM ranked
             WHERE rn <= ?
             GROUP BY tool_name
            HAVING total >= ?
            """,
            (user_id, window, min_calls),
        ).fetchall()

        patterns = []
        for r in rows:
            total = r["total"] or 0
            failures = r["failures"] or 0
            rate = failures / total if total else 0.0
            if rate < failure_threshold:
                continue
            # Pull sample errors for context (most recent 3)
            sample = conn.execute(
                """
                SELECT error, args_json, created_at
                  FROM voice_tool_calls
                 WHERE user_id = ? AND tool_name = ? AND ok = 0
                 ORDER BY id DESC LIMIT 3
                """,
                (user_id, r["tool_name"]),
            ).fetchall()
            patterns.append({
                "tool_name": r["tool_name"],
                "total_in_window": total,
                "failures_in_window": failures,
                "failure_rate": round(rate, 3),
                "sample_errors": [
                    {"error": s["error"], "args_json": s["args_json"],
                     "created_at": s["created_at"]}
                    for s in sample
                ],
            })
        # Worst first
        patterns.sort(key=lambda p: p["failure_rate"], reverse=True)
        return patterns
    finally:
        conn.close()


def get_tool_call_stats(user_id: str, limit: int = 100) -> dict:
    """Return per-tool success/failure counts and recent failures."""
    conn = get_connection()
    try:
        per_tool = conn.execute(
            """
            SELECT tool_name,
                   COUNT(*) AS total,
                   SUM(ok)  AS success,
                   AVG(latency_ms) AS avg_latency_ms
              FROM voice_tool_calls
             WHERE user_id = ?
             GROUP BY tool_name
             ORDER BY total DESC
            """,
            (user_id,),
        ).fetchall()
        recent_failures = conn.execute(
            """
            SELECT tool_name, args_json, error, created_at
              FROM voice_tool_calls
             WHERE user_id = ? AND ok = 0
             ORDER BY created_at DESC
             LIMIT ?
            """,
            (user_id, limit),
        ).fetchall()
        return {
            "by_tool": [dict(r) for r in per_tool],
            "recent_failures": [dict(r) for r in recent_failures],
        }
    finally:
        conn.close()
