"""api/routers/sector_strength.py

GET /api/sector-strength?period=Today — the 11 SPDR Select Sector ETFs ranked
strongest-first by period return ('Today' / '1W' / '1M' / '3M'). Thin wrapper
over the already-built, cached + single-flight `get_sector_strength` service.

🔴 WAS ANONYMOUS (auth/paywall sweep, 2026-08-09). The inputs are public ETF
prices, but what ships is the firm's RANKING of them over four windows, computed
and cached on the single web pod, and its only consumer is the Dashboard's
SectorRotation tile — a paid surface. Owner ruling 2026-08-06: *"everything is
paid, almost nothing is accessible for free."*
"""
from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.sector_strength import get_sector_strength

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the sector-strength ranking.

    ⛔ Defined HERE, not imported from a sibling. Every router that gates on
    `require_paid` defines its own with its OWN 402 sentence, so "which surface
    locked me out" is answerable from the message alone. The rail is
    `tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER…`,
    which walks `api/routers/` by AST and fails on a shared import.
    """
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Sector strength requires a paid plan")
    return user



@router.get("/api/sector-strength")
def sector_strength(period: str = "Today",
                    _user: dict = Depends(require_paid)):
    return {"period": period, "sectors": get_sector_strength(period)}
