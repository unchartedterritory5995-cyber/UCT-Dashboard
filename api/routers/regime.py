"""
Live market regime endpoint — exposes the voice regime classifier
output as a public-ish read for the Dashboard's regime panel.

GET /api/regime  →  {regime, label, confidence, reasons[], signals{}, narration}
"""

from fastapi import APIRouter

router = APIRouter()


@router.get("/api/regime")
def regime_get(fresh: bool = False):
    """Return the current market regime classification. 15-min cached
    server-side; pass ?fresh=1 to force a recompute."""
    try:
        from api.services.voice_regime_classifier import get_current_regime
        return get_current_regime(fresh=fresh)
    except Exception as e:  # noqa: BLE001
        # Graceful fallback so the panel can render an empty/error state
        return {
            "regime": "unknown",
            "label": "Unknown",
            "confidence": 0.0,
            "reasons": [],
            "signals": {},
            "narration": "Regime classifier unavailable.",
            "error": str(e),
        }
