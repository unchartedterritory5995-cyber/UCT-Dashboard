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
import builtins
import os
import time
from fastapi import APIRouter, Depends, HTTPException, Response
from api.middleware.auth_middleware import (
    get_current_user_with_plan,
    is_paid_user,
    require_admin,
)
from api.services.cache import cache
from api.services.serve_stale import (
    TIER_BUILD, ServeStale, serve_with_tier, server_timing,
)
import api.services.theme_performance as svc

router = APIRouter()

# TERM-082 (census rank 4): the live overlay lives on a 10 s TTL
# (`svc._LIVE_1D_TTL`) and every connected Theme Tracker polls it. A miss
# rebuilds the overlay: two Massive batch-snapshot maps over ~2,050 holdings
# (~11 chunks each, ~22 calls) plus the ~345 KB taxonomy enrichment. There was
# no single-flight, so N requests landing on the expiry each fired their own
# ~22 calls. The last COMPLETE overlay is now served while ONE refresh runs
# behind the callers, and a cold herd collapses onto one build.
#
# Bound: 30 s = 3x the TTL = the tracker's own poll interval. The slot's age
# counts from the build, so it is already ~10 s old when the TTL lapses; a
# stale answer can therefore be at most one poll older than what the member
# already has on screen. Past the bound (a refresh that keeps raising, or a lone
# poller whose next poll lands after it) the route builds synchronously as
# before. `live_as_of` in the payload still says when its prices were applied.
# A refresh that returns a PARTIAL overlay (a live map dropped a chunk or lost
# its client) is served from the cache on the live TTL and never remembered.
#
# Router-level on purpose, like movers and earnings: `svc.get_theme_performance`
# has other callers (voice tools, theme_index's quotes, rotation signals, the
# lifespan dashboard warm). They keep their behaviour: a cache hit, else a
# synchronous build. Never a served-stale overlay.
# 2026-10-09: raised 30 -> 300 s. Measured on prod: past the 30 s bound a request rebuilt the
# overlay synchronously (7-18 s, ~22 Massive calls), so any member arriving after a 30 s lull
# in polling waited for it -- all session, not only after a deploy. With 5 min the lone
# visitor gets the last COMPLETE overlay at once while ONE refresh runs behind them, and the
# tracker's own 30 s poll then brings the fresh one. `live_as_of` still states the price
# time. No extra Massive calls: refreshes stay demand-driven and single-flight.
THEME_STALE_MAX_AGE = 300
# Perf wave 2: while no US session can print (svc.prices_moving() is False) the snapshot does
# not move, so the last complete overlay stays servable for 15 min and is refreshed behind the
# caller; a lone off-hours visitor no longer pays the ~7 s rebuild.
THEME_STALE_QUIET_MAX_AGE = 900
_THEME_KEY = "theme_performance_overlaid"      # one global key, = svc._OVERLAID_KEY
_THEME_STALE = ServeStale("theme_performance", max_age_seconds=THEME_STALE_MAX_AGE, max_keys=2)


def _fresh_theme():
    hit = cache.get(svc._OVERLAID_KEY)
    # (payload, complete): the slot must know whether a payload was complete,
    # which the payload cannot say. A fresh cache hit is never judged.
    return None if hit is None else (hit, True)


def _good(result) -> bool:
    # Only a COMPLETE overlay becomes the fallback (cache_policy's rule): a
    # dropped chunk, a lost client, an unapplied overlay or the "computing"
    # stub is served on its own terms but never remembered.
    return bool(result) and result[1] is True


def _build_theme():
    return svc.build_theme_performance()


def serve_theme_performance(refresh: bool = False):
    """The route's read: `(payload, tier, stale_age_s)`.

    `refresh=True` (the footer's manual refresh) wants live prices applied NOW,
    so it bypasses the slot: the overlay caches are dropped and this caller
    builds synchronously, exactly as before. A complete result still refreshes
    the slot."""
    if refresh:
        cache.invalidate(svc._OVERLAID_KEY)
        cache.invalidate(svc._LIVE_1D_KEY)
        built = _build_theme()
        if _good(built):
            _THEME_STALE.remember(_THEME_KEY, built)
        return built[0], TIER_BUILD, None
    _THEME_STALE.max_age = float(THEME_STALE_MAX_AGE if svc.prices_moving() else THEME_STALE_QUIET_MAX_AGE)
    served, tier, age = serve_with_tier(
        _THEME_STALE, _THEME_KEY,
        fresh=_fresh_theme, build=_build_theme, good=_good,
    )
    return served[0], tier, age


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


# Perf wave 2: the route sent ~985 KB uncompressed. These fields are written by the service for
# its own Python callers but read by NO browser consumer (verified 2026-10-08 against every
# fetch of /api/theme-performance in app/src: the Dashboard ThemeTracker tile, ThemeTrackerPage,
# and the terminal IMOV panel). Stripped from the WIRE copy only; svc.get_theme_performance()
# and its Python callers (voice tools, theme_index, rotation, warms) still get everything.
_WIRE_DROP_THEME = ("sector_id", "sub_themes")
_WIRE_DROP_HOLDING = ("weight_pct", "tier", "sub_theme_id")
_WIRE_DROP_PERIODS = ("5d", "30d", "60d", "90d")
_wire_memo: tuple = (None, None)          # (source payload, its wire copy) — one entry


def wire_payload(result):
    """A slimmed COPY of `result` for the browser; never mutates the shared payload."""
    if not isinstance(result, dict) or not isinstance(result.get("themes"), list):
        return result
    out = {k: v for k, v in result.items() if k not in ("theme_set", "all_themes")}
    themes = []
    for t in result["themes"]:
        if not isinstance(t, dict):
            themes.append(t)
            continue
        nt = {k: v for k, v in t.items() if k not in _WIRE_DROP_THEME}
        hs = []
        for h in t.get("holdings") or []:
            if not isinstance(h, dict):
                hs.append(h)
                continue
            nh = {k: v for k, v in h.items() if k not in _WIRE_DROP_HOLDING}
            for blk in ("returns", "ref_prices"):
                if isinstance(nh.get(blk), dict):
                    nh[blk] = {k: v for k, v in nh[blk].items() if k not in _WIRE_DROP_PERIODS}
            hs.append(nh)
        if "holdings" in t:
            nt["holdings"] = hs
        themes.append(nt)
    out["themes"] = themes
    return out


def _wire_shared(result):
    """wire_payload memoized on the shared overlay object (reused for its whole live window)."""
    global _wire_memo
    src, slim = _wire_memo
    if src is result:
        return slim
    slim = wire_payload(result)
    _wire_memo = (result, slim)
    return slim


@router.get("/api/theme-performance")
def get_theme_performance(response: Response = None, refresh: bool = False,
                          set: str | None = None,
                          user: dict = Depends(require_paid)):
    global _last_theme_warm
    t0 = time.perf_counter()
    try:
        # Manual footer refresh: bust the 10s live-overlay caches so the response is re-overlaid
        # with fresh live prices (re-ranks the themes NOW). Cheap in-memory work — deliberately
        # does NOT trigger the admin-only full base recompute (the cost-bearing 6-worker pool).
        result, tier, age = serve_theme_performance(refresh=refresh)
        # PROD-C7: a served-stale overlay says so on the response, in /api/bars'
        # Server-Timing shape (`desc="stale-swr"` + the overlay's age). `None`
        # when this function is called directly (the lifespan warm), not routed.
        if response is not None:
            response.headers["Server-Timing"] = server_timing(
                "theme-performance", tier, (time.perf_counter() - t0) * 1000.0, age)
        # Personal theme set: overlay this user's private diff on a COPY of the shared result.
        # Never mutates the shared base; owner taxonomy / sizing / watermark are untouched.
        if set:
            try:
                from api.services import theme_sets as ts_svc
                if ts_svc.enabled():
                    set_def = ts_svc.get_set(user["id"], set)
                    if set_def:
                        result = svc.apply_theme_set(result, set_def)
            except Exception:
                pass  # fail-soft: a bad set never breaks the shared tracker
        try:
            now = time.monotonic()
            if (now - _last_theme_warm) >= _THEME_WARM_INTERVAL:
                from api.routers.bars import warm_bars_async
                tickers: list[str] = []
                # ⛔ `set` is this route's query parameter (the personal theme set, 614235fd8), so
                # the bare builtin is SHADOWED here: `set()` raised TypeError, the except below
                # swallowed it, and this warm silently never ran from 2026-09-05. Reach the builtin.
                seen: set[str] = builtins.set()
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
        return wire_payload(result) if set else _wire_shared(result)
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
