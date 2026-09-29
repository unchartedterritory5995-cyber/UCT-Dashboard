import time

from fastapi import APIRouter, Depends, HTTPException, Response
from api.middleware.auth_middleware import get_current_user
from api.services.cache import cache
from api.services.massive import get_snapshot, get_ticker_snapshot, snapshot_complete
from api.services.serve_stale import ServeStale, serve_with_tier, server_timing

router = APIRouter()

# TERM-082: `/api/snapshot` is polled every 10-15s by every dashboard page
# (FuturesStrip, MorningWireIndexes, MARelationship) against a 15s TTL, and a
# miss runs four sequential Massive snapshots plus two yfinance quotes capped at
# 12s each. So one member in every 15s window paid that rebuild. The last
# COMPLETE payload is served instead while one refresh runs behind the caller.
# Bounded at 8x the TTL: past that a failing refresh degrades to the old
# synchronous build rather than pinning everyone to two-minute-old quotes.
SNAPSHOT_STALE_MAX_AGE = 120
_SNAPSHOT_KEY = "snapshot"          # one global key — the massive.get_snapshot cache key
_SNAPSHOT_STALE = ServeStale("snapshot", max_age_seconds=SNAPSHOT_STALE_MAX_AGE, max_keys=4)


@router.get("/api/snapshot")
def snapshot(response: Response, user: dict = Depends(get_current_user)):
    t0 = time.perf_counter()
    try:
        data, tier, age = serve_with_tier(
            _SNAPSHOT_STALE, _SNAPSHOT_KEY,
            fresh=lambda: cache.get(_SNAPSHOT_KEY),
            build=lambda: get_snapshot(),
            # Only a snapshot with every leg priced becomes the fallback; a
            # partial is still served, on massive's short partial TTL.
            good=snapshot_complete,
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
    # PROD-C7: a served-stale payload says so on the response, in /api/bars'
    # Server-Timing shape (`desc="stale-swr"` + the payload's age).
    response.headers["Server-Timing"] = server_timing(
        "snapshot", tier, (time.perf_counter() - t0) * 1000.0, age)
    return data


@router.get("/api/snapshot/{ticker}")
def ticker_snapshot(ticker: str, user: dict = Depends(get_current_user)):
    try:
        data = get_ticker_snapshot(ticker.upper())
        return data if data else {}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
