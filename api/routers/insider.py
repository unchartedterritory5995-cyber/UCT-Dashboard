"""Insider activity endpoints.

GET /api/insider/feed         — notable insider buys across the market (last 7 days)
GET /api/insider/feed?scope=market - open-market purchases market-wide (Form 4, last 7 days)
GET /api/insider/clusters     — insider cluster buys from the SEC's own Form 4 filings (INS CLUSTER)
GET /api/insider/{ticker}     — insider transactions for a single stock
GET /api/insider/{ticker}/has-buy — quick boolean check for recent insider buy

🔴 ALL THREE WERE ANONYMOUS (auth/paywall sweep, 2026-08-09). Form 4 filings are
public record, but `/feed` is not a relay of them: it is a market-wide sweep of
~55 Finnhub calls (parallelised 10-wide, because it is expensive), filtered to
NOTABLE buys — the firm's selection, on the firm's paid Finnhub quota. Leaving it
open let an anonymous caller spend that quota. Its only consumer is `UCT20.jsx`,
a paid page. `/{ticker}` and `/{ticker}/has-buy` share the same per-ticker cache
and the same quota, so they are gated with it rather than left as the cheap loop
around the expensive door.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.insider import (
    get_insider_activity,
    get_market_insider_buys,
    get_recent_insider_buys,
    has_recent_insider_buy,
)

router = APIRouter(prefix="/api/insider", tags=["insider"])


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for insider activity.

    ⛔ Defined HERE, not imported from a sibling. Every router that gates on
    `require_paid` defines its own with its OWN 402 sentence, so "which surface
    locked me out" is answerable from the message alone. The rail is
    `tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER…`,
    which walks `api/routers/` by AST and fails on a shared import.
    """
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Insider activity requires a paid plan")
    return user



@router.get("/feed")
def insider_feed(scope: Optional[str] = None, _user: dict = Depends(require_paid)):
    """Notable insider buys (last 7 days).

    No `scope`: the UCT 20 + large-cap watchlist feed, unchanged (UCT20.jsx
    reads it). `scope=market`: open-market purchases across the whole market
    from Form 4 filings (the terminal's INS panel). Anything else is a 400.
    """
    if scope is None:
        return get_recent_insider_buys()
    if scope == "market":
        return get_market_insider_buys()
    raise HTTPException(status_code=400, detail="scope must be 'market' or absent")


# ⛔ Declared ABOVE `/{ticker}`: FastAPI answers on the first match, so below it `clusters` would
# be read as a ticker symbol.
@router.get("/clusters")
def insider_clusters(_user: dict = Depends(require_paid)):
    """Insider cluster buys (the Terminal's `INS CLUSTER`): stocks in which three or more insiders
    bought on the open market within ten business days, built from the SEC's own Form 4 filings
    (`api/services/insider_clusters_sec.py`). Answers ONLY from what the nightly read holds: the SEC
    is never asked on a member's request. `status: not_built` until the first night has run. Plain
    `def`: memory, a lock and (once per process) one local file."""
    from api.services import insider_clusters_sec
    return insider_clusters_sec.get_clusters()


@router.get("/{ticker}")
def insider_for_ticker(ticker: str, _user: dict = Depends(require_paid)):
    """All insider transactions for a single stock."""
    return get_insider_activity(ticker.upper())


@router.get("/{ticker}/has-buy")
def insider_has_buy(ticker: str, days: int = 30,
                    _user: dict = Depends(require_paid)):
    """Quick check: any insider buy in the last N days?"""
    return {"symbol": ticker.upper(), "has_buy": has_recent_insider_buy(ticker.upper(), days)}
