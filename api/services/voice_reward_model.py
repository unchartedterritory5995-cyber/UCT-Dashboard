"""
Reward modeling — aggregate user feedback into a per-prompt-variant
score so we can learn which system prompts produce better experiences.

Each session is tagged at mint time with a variant_id (e.g. 'v1' or
'v1_experimental'). Thumbs feedback on assistant turns flows into
voice_feedback (existing). This service joins them to compute:

  - per-variant: thumbs_up, thumbs_down, corrections, score (= up / (up+down))
  - per-agent-variant: same broken down by which agent the session ran in

Used by:
  - VoiceTelemetryPanel to show variant performance
  - Batch 13b A/B testing — sample variants weighted by score
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import Any

from api.services.auth_db import get_connection

_log = logging.getLogger(__name__)


def record_variant(session_id: int, user_id: str, *,
                   variant_id: str, agent_ctx: str | None = None) -> None:
    """Stamp the variant choice for a session at mint time."""
    if not session_id or not variant_id:
        return
    conn = get_connection()
    try:
        # UPSERT — UNIQUE on session_id
        conn.execute(
            """INSERT INTO voice_prompt_variants
                 (session_id, user_id, variant_id, agent_ctx)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(session_id) DO UPDATE
                   SET variant_id = excluded.variant_id,
                       agent_ctx = excluded.agent_ctx""",
            (session_id, user_id, variant_id, agent_ctx),
        )
        conn.commit()
    except Exception as e:  # noqa: BLE001
        _log.warning("[reward] record_variant failed: %s", e)
    finally:
        conn.close()


def get_session_variant(session_id: int) -> dict | None:
    if not session_id:
        return None
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT variant_id, agent_ctx FROM voice_prompt_variants WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def variant_scoreboard(user_id: str | None = None, *, days: int = 30) -> list[dict]:
    """
    Aggregate feedback per variant. If user_id is None, scope is global
    (across all users — useful for admin telemetry).

    Each row: {variant_id, total_sessions, thumbs_up, thumbs_down,
               corrections, score, agent_breakdown}.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max(1, int(days)))).isoformat()
    conn = get_connection()
    try:
        params: list[Any] = [cutoff]
        scope = ""
        if user_id:
            scope = " AND vpv.user_id = ?"
            params.append(user_id)

        sessions = conn.execute(
            f"""
            SELECT vpv.variant_id, vpv.agent_ctx, vpv.session_id
              FROM voice_prompt_variants vpv
             WHERE vpv.created_at >= ?{scope}
            """,
            params,
        ).fetchall()

        # Build session_id -> (variant_id, agent_ctx) map
        session_to_variant: dict[int, dict] = {}
        for r in sessions:
            session_to_variant[r["session_id"]] = {
                "variant_id": r["variant_id"],
                "agent_ctx": r["agent_ctx"],
            }
        if not session_to_variant:
            return []

        session_ids = list(session_to_variant.keys())
        placeholders = ",".join("?" * len(session_ids))

        # Pull all feedback rows tied to those sessions
        fb_rows = conn.execute(
            f"""
            SELECT session_id, rating, correction_text
              FROM voice_feedback
             WHERE session_id IN ({placeholders})
            """,
            session_ids,
        ).fetchall()
    finally:
        conn.close()

    from collections import defaultdict
    bucket: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "variant_id": None,
        "total_sessions": 0,
        "thumbs_up": 0,
        "thumbs_down": 0,
        "corrections": 0,
        "agent_breakdown": defaultdict(int),
    })
    session_counted: set[int] = set()
    for r in fb_rows:
        sid = r["session_id"]
        info = session_to_variant.get(sid)
        if not info:
            continue
        v = info["variant_id"]
        agent = info["agent_ctx"] or "global"
        b = bucket[v]
        b["variant_id"] = v
        if r["rating"] == "up":
            b["thumbs_up"] += 1
        elif r["rating"] == "down":
            b["thumbs_down"] += 1
        if r["correction_text"]:
            b["corrections"] += 1
        if sid not in session_counted:
            b["total_sessions"] += 1
            b["agent_breakdown"][agent] += 1
            session_counted.add(sid)

    # Count sessions that had no feedback at all
    for sid, info in session_to_variant.items():
        if sid in session_counted:
            continue
        v = info["variant_id"]
        agent = info["agent_ctx"] or "global"
        b = bucket[v]
        b["variant_id"] = v
        b["total_sessions"] += 1
        b["agent_breakdown"][agent] += 1
        session_counted.add(sid)

    out = []
    for b in bucket.values():
        up = b["thumbs_up"]
        down = b["thumbs_down"]
        total_fb = up + down
        score = (up / total_fb) if total_fb > 0 else None
        out.append({
            "variant_id": b["variant_id"],
            "total_sessions": b["total_sessions"],
            "thumbs_up": up,
            "thumbs_down": down,
            "corrections": b["corrections"],
            "score": round(score, 3) if score is not None else None,
            "feedback_volume": total_fb,
            "agent_breakdown": dict(b["agent_breakdown"]),
        })
    # Highest-score first (variants with no feedback at the end)
    out.sort(key=lambda r: (r["score"] is not None, r["score"] or 0), reverse=True)
    return out


def best_variant(user_id: str | None = None, *,
                 min_feedback: int = 5) -> str | None:
    """Return the highest-scoring variant with enough feedback volume.
    Used by Batch 13b to bias future session minting."""
    rows = variant_scoreboard(user_id=user_id, days=30)
    candidates = [r for r in rows
                   if r["score"] is not None
                   and r["feedback_volume"] >= min_feedback]
    if not candidates:
        return None
    return candidates[0]["variant_id"]
