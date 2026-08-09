"""api/routers/theme_performance.py

GET  /api/theme-performance          — every theme, per-holding multi-period
                                       returns (1D/1W/1M/3M/1Y/YTD)   — PAID
GET  /api/theme-rotation             — 1W-vs-1M momentum rank delta    — PAID
POST /api/theme-performance/refresh  — invalidate + recompute         — ADMIN

🔴 ALL THREE WERE ANONYMOUS until 2026-08-09.

The two reads ARE the theme taxonomy's output — which themes lead, which lag, and
the per-holding returns underneath — computed off the firm's own 112-theme
taxonomy. Consumers are the Dashboard ThemeTracker tile and ThemeTrackerPage,
both paid surfaces.

`POST /refresh` is the cost-bearing one: it invalidates the cache and kicks a
recompute across a 6-worker pool over ~2,000 holdings on the SINGLE web pod. An
anonymous caller could hold that pool down indefinitely by re-firing it — and
because the read path is `memory cache → disk → {status: "computing"}`, every
member would see "computing" for as long as the attacker kept going. ADMIN.
"""
import os
import time
from fastapi import APIRouter, Depends, HTTPException
from api.middleware.auth_middleware import (
    get_current_user_with_plan,
    is_paid_user,
    require_admin,
)
import api.services.theme_performance as svc

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the theme-performance surface.

    ⛔ Defined HERE, not imported from a sibling. Every router that gates on
    `require_paid` defines its own with its OWN 402 sentence, so "which surface
    locked me out" is answerable from the message alone. The rail is
    `tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER…`,
    which walks `api/routers/` by AST and fails on a shared import.
    """
    if not is_paid_user(user):
        raise HTTPException(status_code=402,
                            detail="Theme performance requires a paid plan")
    return user

# This endpoint is polled every 30s by the Dashboard ThemeTracker tile for EVERY user.
# The old code re-submitted a warm for the WHOLE theme universe (~1,900 tickers) on every
# request — 60x over warm_bars_async's documented ≤30 contract — flooding the 4-worker,
# unbounded-queue bars warm pool at launch scale (~200 users → OOM/524 class). Bound it:
# warm at most once per interval, and cap the list so a single warm can't swamp the pool.
_last_theme_warm = 0.0
_THEME_WARM_INTERVAL = float(os.environ.get("THEME_WARM_INTERVAL_SECONDS", "600"))  # 10min
_COLD_TAIL_CAP = int(os.environ.get("THEME_WARM_CAP", "30"))


@router.get("/api/theme-performance")
def get_theme_performance(_user: dict = Depends(require_paid)):
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
def get_theme_rotation(_user: dict = Depends(require_paid)):
    """Return sector rotation signals — 1W vs 1M momentum rank delta."""
    try:
        return svc.compute_rotation_signals()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/api/theme-performance/refresh")
def refresh_theme_performance(_admin: dict = Depends(require_admin)):
    """Invalidate cache and trigger fresh background recomputation."""
    from api.services.cache import cache
    cache.invalidate(svc._CACHE_KEY)
    svc.trigger_recompute()
    return {"status": "ok", "message": "Recomputation started in background"}
