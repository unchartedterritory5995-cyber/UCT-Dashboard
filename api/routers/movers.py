import time

from fastapi import APIRouter, Depends, HTTPException, Response
from api.middleware.auth_middleware import get_current_user
from api.services.cache import cache
from api.services.massive import build_movers, get_extended_movers
from api.services.serve_stale import ServeStale, serve_with_tier, server_timing

router = APIRouter()

# TERM-082: the Movers sidebar polls `/api/movers` every 30s during market
# hours against a 30s TTL, and a miss can run two sequential Finviz Elite
# exports (15s timeout each) plus a Massive batch snapshot — measured 3.3s
# cold. The last COMPLETE payload is served instead while one refresh runs
# behind the caller. Bounded at 6x the TTL, so a failing refresh degrades to
# the old synchronous build rather than pinning the list to stale names.
#
# Router-level on purpose: `massive.get_movers()` has other callers (the
# catalyst engine, which WRITES catalyst rows from it; Compass tools; the tape
# route). They keep their exact behaviour and never see a served-stale list.
MOVERS_STALE_MAX_AGE = 180
_MOVERS_KEY = "movers"              # one global key — the massive.get_movers cache key
_MOVERS_STALE = ServeStale("movers", max_age_seconds=MOVERS_STALE_MAX_AGE, max_keys=4)


def _fresh_movers():
    hit = cache.get(_MOVERS_KEY)
    # (payload, complete): the slot must know whether a payload was complete,
    # which the payload itself cannot say. A fresh cache hit is never judged.
    return None if hit is None else (hit, True)


@router.get("/api/movers")
def movers(response: Response, user: dict = Depends(get_current_user)):
    t0 = time.perf_counter()
    try:
        served, tier, age = serve_with_tier(
            _MOVERS_STALE, _MOVERS_KEY,
            fresh=_fresh_movers,
            build=build_movers,
            # Only a complete rebuild becomes the fallback (cache_policy's
            # rule): a Finviz or Massive failure is served on the short TTL
            # but never remembered as last-good.
            good=lambda r: bool(r) and r[1] is True,
        )
        result = served[0]
        try:
            from api.routers.bars import warm_bars_async
            tickers = []
            for bucket in ("ripping", "drilling"):
                for item in (result.get(bucket) or []):
                    sym = item.get("sym") if isinstance(item, dict) else None
                    if sym:
                        tickers.append(sym.upper())
            if tickers:
                warm_bars_async(tickers, tf="D", bars=8000)
        except Exception:
            pass
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
    # PROD-C7: a served-stale list says so on the response, in /api/bars'
    # Server-Timing shape (`desc="stale-swr"` + the list's age).
    response.headers["Server-Timing"] = server_timing(
        "movers", tier, (time.perf_counter() - t0) * 1000.0, age)
    return result


@router.get("/api/extended-movers")
def extended_movers(user: dict = Depends(get_current_user)):
    try:
        return get_extended_movers()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
