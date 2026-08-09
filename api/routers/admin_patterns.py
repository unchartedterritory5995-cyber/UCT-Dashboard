"""Admin diagnostics + operator review for the pattern engine.

Phase 0.5 surfaces engine health as JSON.
Phase 5 adds /recent + /{id}/review for Gate 5 shadow-mode operator review.

🔴 EVERY ROUTE IN A ROUTER PREFIXED `/api/admin/` WAS OPEN TO THE INTERNET until
2026-08-09. `GET /api/admin/patterns/recent` answered an anonymous caller with
**3,908,605 bytes** — the largest single response in the whole auth/paywall
sweep: every detection the engine made in the window, with geometry, levels,
confidence components, narrative, AND the operator's accept/reject adjudication.
`POST /{detection_id}/review` let anyone WRITE that adjudication, and the
accept-rate it produces is the Gate-5 number that decides whether the engine
ships to members. `/health` publishes per-detector health across the universe.

`/api/admin` in the path was never a gate — it is a naming convention. All three
now carry `Depends(require_admin)`, which is the real one.
"""
from __future__ import annotations

import json
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from api.middleware.auth_middleware import require_admin

from api.services.pattern_engine.pattern_db import get_connection, init_db
from api.services.pattern_engine import memory
from api.services.pattern_engine.diagnostics import collect_health


router = APIRouter(prefix="/api/admin/patterns", tags=["admin-patterns"])


@router.get("/health")
def health(_admin: dict = Depends(require_admin)):
    return collect_health()


# ─── Gate 5 — Shadow-mode operator review ──────────────────────────────────
#
# The operator (admin) reviews live detections every trading day, marking
# each as accept / reject / flag. Target: ≥85% accept rate over 5 trading
# days before launching the UI to end users.
#
# The review payload reuses the existing pattern_feedback table:
#   action=accept → rating=great
#   action=reject → rating=wrong
#   action=flag   → rating=miss
# user_id is hardcoded as "admin_operator" so admin reviews don't mingle
# with end-user feedback in stats / training data.

_ADMIN_OPERATOR_USER_ID = "admin_operator"

_ACTION_TO_RATING = {
    "accept": "great",
    "reject": "wrong",
    "flag": "miss",
}


class ReviewBody(BaseModel):
    action: str   # "accept" | "reject" | "flag"
    note: Optional[str] = None


def _row_to_detection_with_review(row) -> dict:
    """Reconstitute a detection dict from a pattern_detections row joined
    with the operator's most recent pattern_feedback row.

    Mirrors memory._row_to_detection() but adds three review fields:
      reviewed (bool), reviewer_rating (str|None), reviewer_note (str|None).
    Also surfaces `from_leader_universe` for downstream sorting.
    """
    def _safe_json(blob, default):
        if blob is None:
            return default
        try:
            return json.loads(blob)
        except Exception:
            return default

    pattern_id = row["pattern_id"]
    geometry = _safe_json(row["geometry_json"], {})
    extras = geometry.get("extras") if isinstance(geometry, dict) else None
    from_leader_universe = bool((extras or {}).get("from_leader_universe", False))
    return {
        "id": row["id"],
        "sym": row["sym"],
        "tf": row["tf"],
        "pattern_id": pattern_id,
        "pattern_name": pattern_id.replace("_", " ").title(),
        "category": row["category"],
        "direction": row["direction"],
        "start_t": row["start_t"],
        "end_t": row["end_t"],
        "pivot_ts": [],
        "geometry": geometry,
        "levels": _safe_json(row["levels_json"], {}),
        "context": _safe_json(row["context_json"], {}),
        "confidence": row["confidence"],
        "quality_components": _safe_json(row["quality_json"], {}),
        "narrative": _safe_json(row["narrative_json"], {}),
        "status": row["status"],
        "outcome": None,
        "detected_at": row["detected_at"],
        "last_seen_at": row["last_seen_at"],
        "from_leader_universe": from_leader_universe,
        "reviewed": bool(row["reviewed"]) if "reviewed" in row.keys() else False,
        "reviewer_rating": row["reviewer_rating"] if "reviewer_rating" in row.keys() else None,
        "reviewer_note": row["reviewer_note"] if "reviewer_note" in row.keys() else None,
    }


@router.get("/recent")
def recent_detections(hours: int = Query(default=24, ge=1, le=168),
                      _admin: dict = Depends(require_admin)):
    """Return detections from the last N hours (default 24, max 7 days)
    with operator review status joined in.

    The join uses the OPERATOR's MOST RECENT feedback row per detection
    (a detection can be re-reviewed; the latest review wins).
    """
    init_db()
    conn = get_connection()
    try:
        cutoff = int(time.time()) - hours * 3600
        # LEFT JOIN against the operator's latest feedback row per detection.
        # SQLite groups + MAX gives us deterministic latest pick.
        rows = conn.execute("""
            SELECT pd.*,
                   pf.id IS NOT NULL AS reviewed,
                   pf.rating AS reviewer_rating,
                   pf.note AS reviewer_note
            FROM pattern_detections pd
            LEFT JOIN (
                SELECT detection_id, rating, note, id,
                       MAX(created_at) AS latest_at
                FROM pattern_feedback
                WHERE user_id = ?
                GROUP BY detection_id
            ) pf ON pf.detection_id = pd.id
            WHERE pd.detected_at >= ?
            ORDER BY pd.detected_at DESC
            LIMIT 500
        """, (_ADMIN_OPERATOR_USER_ID, cutoff)).fetchall()

        detections = [_row_to_detection_with_review(r) for r in rows]

        # Surface leader-universe detections first, then by detected_at desc.
        # The SQL already orders by detected_at DESC; this stable sort just
        # bubbles leader picks to the top of the list.
        detections.sort(
            key=lambda d: (0 if d.get("from_leader_universe") else 1, -int(d.get("detected_at") or 0)),
        )

        total = len(detections)
        reviewed_rows = [d for d in detections if d.get("reviewed")]
        leader_count = sum(1 for d in detections if d.get("from_leader_universe"))
        accepted = sum(1 for d in reviewed_rows if d["reviewer_rating"] == "great")
        rejected = sum(1 for d in reviewed_rows if d["reviewer_rating"] == "wrong")
        flagged = sum(1 for d in reviewed_rows if d["reviewer_rating"] == "miss")
        accept_rate = (accepted / len(reviewed_rows) * 100) if reviewed_rows else None

        return {
            "detections": detections,
            "count": total,
            "leader_universe_count": leader_count,
            "reviewed_count": len(reviewed_rows),
            "accepted": accepted,
            "rejected": rejected,
            "flagged": flagged,
            "accept_rate_pct": accept_rate,
            "hours_window": hours,
        }
    finally:
        conn.close()


@router.post("/{detection_id}/review")
def review_detection(detection_id: str, body: ReviewBody,
                     _admin: dict = Depends(require_admin)):
    """Operator records accept / reject / flag for a detection.

    Maps to the existing pattern_feedback table:
      action=accept → rating=great
      action=reject → rating=wrong
      action=flag   → rating=miss

    user_id is hardcoded as "admin_operator" so admin reviews stay separate
    from end-user feedback (Phase 7 trainer reads `user_id != 'admin_operator'`
    for the user-facing training pool; the operator pool feeds Gate 5 only).
    """
    if body.action not in _ACTION_TO_RATING:
        raise HTTPException(status_code=400, detail=f"invalid action: {body.action}")
    rating = _ACTION_TO_RATING[body.action]

    try:
        feedback_id = memory.record_feedback(
            detection_id, _ADMIN_OPERATOR_USER_ID, rating, body.note
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"ok": True, "feedback_id": feedback_id, "action": body.action}
