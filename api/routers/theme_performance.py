"""api/routers/theme_performance.py

GET /api/theme-performance — returns all themes with per-holding
multi-period returns (1D/1W/1M/3M/1Y/YTD).
"""
from fastapi import APIRouter, HTTPException
import api.services.theme_performance as svc

router = APIRouter()


@router.get("/api/theme-performance")
def get_theme_performance():
    try:
        return svc.get_theme_performance()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/theme-rotation")
def get_theme_rotation():
    """Return sector rotation signals — 1W vs 1M momentum rank delta."""
    try:
        return svc.compute_rotation_signals()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/api/theme-performance/refresh")
def refresh_theme_performance():
    """Invalidate cache and trigger fresh background recomputation."""
    from api.services.cache import cache
    cache.invalidate(svc._CACHE_KEY)
    svc.trigger_recompute()
    return {"status": "ok", "message": "Recomputation started in background"}
