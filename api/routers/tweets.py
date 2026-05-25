"""Read-only tweet endpoints surfaced to the React frontend.

Auth: requires login (matches the project's auth pattern used by other
read endpoints). Uses api.middleware.auth_middleware.get_current_user.
"""
from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import get_current_user
from api.services import tweet_store

router = APIRouter(prefix="/api/tweets", tags=["tweets"])


def _current_mover_symbols() -> set[str]:
    """Pull the current MoversSidebar symbol set so /tape can exclude them.
    Wrapped so tests can monkeypatch it without standing up the full movers stack."""
    try:
        from api.services.massive import get_movers
        movers = get_movers() or {}
        out: set[str] = set()
        for item in (movers.get("ripping") or []):
            out.add((item.get("sym") or "").upper())
        for item in (movers.get("drilling") or []):
            out.add((item.get("sym") or "").upper())
        return out
    except Exception:
        return set()


@router.get("/ticker/{sym}")
def tweets_for_ticker(sym: str,
                      hours: int = Query(24, ge=1, le=168),
                      user=Depends(get_current_user)):
    sym = sym.upper().strip()
    if not sym or not sym.isalpha() or len(sym) > 6:
        raise HTTPException(400, "invalid ticker")
    return tweet_store.tweets_for_ticker(sym, hours=hours)


@router.get("/tape")
def tape(hours: int = Query(12, ge=1, le=72),
         limit: int = Query(15, ge=1, le=100),
         user=Depends(get_current_user)):
    # Over-fetch so we have enough rows left after filtering out movers
    rows = tweet_store.tape(hours=hours, limit=limit * 3)
    movers = _current_mover_symbols()
    filtered = [r for r in rows if r["ticker"] not in movers]
    return filtered[:limit]


@router.get("/has-tweets-batch")
def has_tweets_batch(tickers: str = Query(..., description="comma-separated tickers"),
                     hours: int = Query(24, ge=1, le=168),
                     user=Depends(get_current_user)):
    tlist = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not tlist:
        return {}
    if len(tlist) > 200:
        raise HTTPException(400, "max 200 tickers per batch")
    return tweet_store.batch_counts(tlist, hours=hours)
