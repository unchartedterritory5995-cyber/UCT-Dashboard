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
        result = svc.get_theme_performance()
        try:
            from api.routers.bars import warm_bars_async
            tickers: set[str] = set()
            themes = result if isinstance(result, list) else (result.get("themes") or [])
            for theme in themes:
                etf = theme.get("ticker")
                if etf and etf != "UCT20":
                    tickers.add(etf.upper())
                for h in (theme.get("holdings") or []):
                    sym = h.get("sym") if isinstance(h, dict) else (h if isinstance(h, str) else None)
                    if sym:
                        tickers.add(sym.upper())
            if tickers:
                warm_bars_async(list(tickers), tf="D", bars=8000)
        except Exception:
            pass
        return result
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
