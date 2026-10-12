"""COV-12 / FT-067 congressional trades -- two read routes over
`api/services/congress_trades.py` (FMP only, owner approval 2026-10-12).

  GET /api/research/congress-trades/{sym}    both chambers for one symbol
  GET /api/research/congress-latest           the newest disclosures, every symbol

DARK behind CONGRESS_TRADES_ENABLED, read per request by the service's own
`is_enabled()`: unset, both routes answer FastAPI's 404 before identity is
read, exactly like the Research > Depth surfaces. Paid, like the rest of the
research reads.

Its own router rather than a row in research_depth.py, because that router's
contract is "no handler calls a vendor" and these do: a cache miss reads FMP
(through fmp_client's shared token bucket) on the request path, the same way
GET /api/insider/{ticker} does. Both handlers are plain `def` -- the FMP read
is blocking I/O and must not run on the event loop
(tests/test_async_routes_do_not_block.py).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter(tags=["congress-trades"])


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate. Defined HERE (each router owns its own 402 sentence)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Congressional trades require a paid plan")
    return user


def _armed() -> None:
    from api.services import congress_trades
    if not congress_trades.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


@router.get("/api/research/congress-latest", dependencies=[Depends(_armed)])
def congress_latest_route(_user: dict = Depends(require_paid)):
    from api.services import congress_trades as svc
    return svc.latest()


@router.get("/api/research/congress-trades/{sym}", dependencies=[Depends(_armed)])
def congress_trades_route(sym: str, _user: dict = Depends(require_paid)):
    from api.services import congress_trades as svc
    from api.services.ticker_resolver import require_route_symbol
    return svc.for_symbol(require_route_symbol(sym))
