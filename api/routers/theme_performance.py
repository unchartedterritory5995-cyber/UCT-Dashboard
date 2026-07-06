"""api/routers/theme_performance.py

GET /api/theme-performance — returns all themes with per-holding
multi-period returns (1D/1W/1M/3M/1Y/YTD).
"""
import os
import time
from fastapi import APIRouter, HTTPException
import api.services.theme_performance as svc

router = APIRouter()

# This endpoint is polled every 30s by the Dashboard ThemeTracker tile for EVERY user.
# The old code re-submitted a warm for the WHOLE theme universe (~1,900 tickers) on every
# request — 60x over warm_bars_async's documented ≤30 contract — flooding the 4-worker,
# unbounded-queue bars warm pool at launch scale (~200 users → OOM/524 class). Bound it:
# warm at most once per interval, and cap the list so a single warm can't swamp the pool.
_last_theme_warm = 0.0
_THEME_WARM_INTERVAL = float(os.environ.get("THEME_WARM_INTERVAL_SECONDS", "600"))  # 10min
_COLD_TAIL_CAP = int(os.environ.get("THEME_WARM_CAP", "30"))


@router.get("/api/theme-performance")
def get_theme_performance():
    global _last_theme_warm
    try:
        result = svc.get_theme_performance()
        try:
            now = time.monotonic()
            if (now - _last_theme_warm) >= _THEME_WARM_INTERVAL:
                from api.routers.bars import warm_bars_async
                tickers: list[str] = []
                seen: set[str] = set()
                themes = result if isinstance(result, list) else (result.get("themes") or [])
                for theme in themes:
                    etf = theme.get("ticker")
                    if etf and etf != "UCT20" and svc.looks_like_ticker(etf.upper()) and etf.upper() not in seen:
                        seen.add(etf.upper())
                        tickers.append(etf.upper())
                    for h in (theme.get("holdings") or []):
                        sym = h.get("sym") if isinstance(h, dict) else (h if isinstance(h, str) else None)
                        if sym and sym.upper() not in seen:
                            seen.add(sym.upper())
                            tickers.append(sym.upper())
                if tickers:
                    _last_theme_warm = now
                    warm_bars_async(tickers[:_COLD_TAIL_CAP], tf="D", bars=8000)
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
