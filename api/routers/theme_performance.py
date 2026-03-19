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


@router.post("/api/theme-performance/refresh")
def refresh_theme_performance():
    """Bust the theme-performance cache so next GET recomputes."""
    from api.services.cache import cache
    cache.delete(svc._CACHE_KEY)
    return {"status": "ok"}
