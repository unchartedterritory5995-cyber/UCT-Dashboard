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
from api.services.pattern_engine.detectors.classical import bear_flag as _bear_flag  # noqa: F401
from api.services.pattern_engine.detectors.classical import pennant as _pennant  # noqa: F401
from api.services.pattern_engine.detectors.classical import falling_wedge as _falling_wedge  # noqa: F401
from api.services.pattern_engine.detectors.classical import rising_wedge as _rising_wedge  # noqa: F401
from api.services.pattern_engine.detectors.classical import head_shoulders as _head_shoulders  # noqa: F401
from api.services.pattern_engine.detectors.classical import inverse_head_shoulders as _inverse_head_shoulders  # noqa: F401
from api.services.pattern_engine.detectors.classical import double_top as _double_top  # noqa: F401
from api.services.pattern_engine.detectors.classical import double_bottom as _double_bottom  # noqa: F401
from api.services.pattern_engine.detectors.classical import cup_handle as _cup_handle  # noqa: F401
from api.services.pattern_engine.detectors.classical import inverse_cup_handle as _inverse_cup_handle  # noqa: F401
from api.services.pattern_engine.detectors.uct import vcp as _vcp  # noqa: F401
from api.services.pattern_engine.detectors.uct import high_tight_flag as _high_tight_flag  # noqa: F401
from api.services.pattern_engine.detectors.uct import episodic_pivot as _episodic_pivot  # noqa: F401
from api.services.pattern_engine.detectors.uct import power_earnings_gap as _power_earnings_gap  # noqa: F401
from api.services.pattern_engine.detectors.uct import flat_base as _flat_base  # noqa: F401
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
    "bear_flag": {
        "name": "Bear Flag",
        "category": "classical",
        "direction": "bearish",
        "description": "Sharp decline (pole) followed by tight parallel-channel rally (flag). Continuation pattern.",
    },
    "pennant": {
        "name": "Pennant",
        "category": "classical",
        "direction": "neutral",  # emits both bullish + bearish
        "description": "Sharp move (pole) followed by converging triangle consolidation. Continuation pattern in either direction.",
    },
    "falling_wedge": {
        "name": "Falling Wedge",
        "category": "classical",
        "direction": "bullish",
        "description": "Both trendlines slope down, converging downward. Bullish reversal/continuation pattern.",
    },
    "rising_wedge": {
        "name": "Rising Wedge",
        "category": "classical",
        "direction": "bearish",
        "description": "Both trendlines slope up, converging upward. Bearish reversal pattern.",
    },
    "head_shoulders": {
        "name": "Head and Shoulders",
        "category": "classical",
        "direction": "bearish",
        "description": "Three peaks with the middle (head) highest. Neckline connects the two troughs. Bearish reversal pattern.",
    },
    "inverse_head_shoulders": {
        "name": "Inverse Head and Shoulders",
        "category": "classical",
        "direction": "bullish",
        "description": "Three troughs with the middle (head) lowest. Neckline connects the two peaks. Bullish reversal pattern.",
    },
    "double_top": {
        "name": "Double Top",
        "category": "classical",
        "direction": "bearish",
        "description": "Two peaks at similar heights with a retrace trough between. Bearish reversal pattern.",
    },
    "double_bottom": {
        "name": "Double Bottom",
        "category": "classical",
        "direction": "bullish",
        "description": "Two troughs at similar lows with a rally peak between. Bullish reversal pattern.",
    },
    "cup_handle": {
        "name": "Cup with Handle",
        "category": "classical",
        "direction": "bullish",
        "description": "Rounded U-shaped consolidation (cup) followed by tight pullback (handle). Bullish continuation pattern (O'Neil).",
    },
    "inverse_cup_handle": {
        "name": "Inverse Cup with Handle",
        "category": "classical",
        "direction": "bearish",
        "description": "Inverted rounded dome followed by a small failing rally (handle). Bearish reversal pattern.",
    },
    "vcp": {
        "name": "Volatility Contraction Pattern (VCP)",
        "category": "uct",
        "direction": "bullish",
        "description": "Successive shallower pullbacks with drying volume into a tight pivot. Minervini's signature institutional accumulation pattern.",
    },
    "high_tight_flag": {
        "name": "High Tight Flag (Powerplay)",
        "category": "uct",
        "direction": "bullish",
        "description": "Near-vertical 90%+ advance followed by tight orderly consolidation. The rarest, most explosive continuation pattern (O'Neil / Bonde).",
    },
    "episodic_pivot": {
        "name": "Episodic Pivot",
        "category": "uct",
        "direction": "bullish",
        "description": "A single bar of 2x+ range and volume that breaks out of a multi-week base. Bonde's signature regime-change signal.",
    },
    "power_earnings_gap": {
        "name": "Power Earnings Gap (PEG)",
        "category": "uct",
        "direction": "bullish",
        "description": "Significant gap-up (>=4%) on 3x+ volume that holds with tight post-gap consolidation. Bonde's signature post-earnings continuation setup.",
    },
    "flat_base": {
        "name": "Flat Base Breakout",
        "category": "uct",
        "direction": "bullish",
        "description": "Tight horizontal consolidation (<=12% depth) after a 25%+ prior advance, with drying volume. O'Neil/Stockbee continuation pattern.",
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
