"""Insider activity endpoints.

GET /api/insider/feed         — notable insider buys across the market (last 7 days)
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

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.insider import get_insider_activity, get_recent_insider_buys, has_recent_insider_buy

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
def insider_feed(_user: dict = Depends(require_paid)):
    """Notable insider buys across the market (last 7 days)."""
    return get_recent_insider_buys()


@router.get("/{ticker}")
def insider_for_ticker(ticker: str, _user: dict = Depends(require_paid)):
    """All insider transactions for a single stock."""
    return get_insider_activity(ticker.upper())


@router.get("/{ticker}/has-buy")
def insider_has_buy(ticker: str, days: int = 30,
                    _user: dict = Depends(require_paid)):
    """Quick check: any insider buy in the last N days?"""
    return {"symbol": ticker.upper(), "has_buy": has_recent_insider_buy(ticker.upper(), days)}
