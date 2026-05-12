"""Pattern recognition REST endpoints.

Phase 0 surfaces three endpoints:
  - GET /api/patterns/types
  - GET /api/patterns/{sym}?tf=&types=&min_conf=
  - POST /api/patterns/{detection_id}/feedback

Note: detectors must be imported at module load so they register themselves.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

# Importing the detector modules triggers self-registration with the registry.
from api.services.pattern_engine.detectors.classical import bull_flag as _bull_flag  # noqa: F401
from api.services.pattern_engine import memory
from api.services.pattern_engine.detectors.registry import list_pattern_ids


router = APIRouter(prefix="/api/patterns", tags=["patterns"])


_PATTERN_METADATA = {
    "bull_flag": {
        "name": "Bull Flag",
        "category": "classical",
        "direction": "bullish",
        "description": "Sharp advance (pole) followed by tight parallel-channel pullback (flag). Continuation pattern.",
    },
}


@router.get("/types")
def list_types():
    """Return all registered pattern types with metadata."""
    ids = list_pattern_ids()
    out = []
    for pid in ids:
        meta = _PATTERN_METADATA.get(pid, {})
        out.append({
            "id": pid,
            "name": meta.get("name", pid.replace("_", " ").title()),
            "category": meta.get("category", "uncategorized"),
            "direction": meta.get("direction", "neutral"),
            "description": meta.get("description", ""),
        })
    return {"patterns": out}


@router.get("/{sym}")
def get_detections(
    sym: str,
    tf: str = Query(default="D"),
    types: Optional[str] = Query(default=None, description="comma-separated pattern_ids to filter"),
    min_conf: float = Query(default=50.0, ge=0.0, le=100.0),
):
    """Return active detections for a symbol (status NOT in completed/failed/expired)."""
    pattern_ids = [t.strip() for t in types.split(",")] if types else None
    rows = memory.get_active_detections(sym.upper(), tf, pattern_ids=pattern_ids, min_conf=min_conf)
    return {"sym": sym.upper(), "tf": tf, "detections": rows, "count": len(rows)}


class FeedbackBody(BaseModel):
    rating: str
    user_id: str
    note: Optional[str] = None


@router.post("/{detection_id}/feedback")
def post_feedback(detection_id: str, body: FeedbackBody):
    """Record user feedback on a detection. Returns the new feedback row id."""
    try:
        fb_id = memory.record_feedback(detection_id, body.user_id, body.rating, body.note)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "feedback_id": fb_id}
