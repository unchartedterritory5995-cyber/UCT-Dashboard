"""RS Ranking endpoints — IBD-style Relative Strength percentile rankings.

GET /api/rs-rankings       → full ranked list
GET /api/rs-rankings/{ticker} → single stock RS data

🔴 BOTH WERE ANONYMOUS (auth/paywall sweep, 2026-08-09). `/api/rs-rankings`
returns the 1-99 percentile ranking of the ENTIRE ~3,685-ticker cap universe —
a ~17s recompute the firm pays for and re-warms every 50 minutes so no member
ever waits on it. That whole table left in one unauthenticated GET.

`/{ticker}` is gated with it: it is a pure lookup into the same cached table, so
an open singular is the bulk route with extra steps.
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.rs_ranking import compute_rs_scores, get_rs_for_ticker

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the RS ranking surface.

    ⛔ Defined HERE, not imported from a sibling. Every router that gates on
    `require_paid` defines its own with its OWN 402 sentence, so "which surface
    locked me out" is answerable from the message alone. The rail is
    `tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER…`,
    which walks `api/routers/` by AST and fails on a shared import.
    """
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="RS rankings require a paid plan")
    return user


@router.get("/api/rs-rankings")
def rs_rankings(_user: dict = Depends(require_paid)):
    """Return full RS-ranked stock list (1-99 percentile, best first)."""
    try:
        data = compute_rs_scores()
        return JSONResponse(content=data)
    except Exception as e:
        return JSONResponse(
            status_code=503,
            content={"error": f"RS ranking unavailable: {e}"},
        )


@router.get("/api/rs-rankings/{ticker}")
def rs_ranking_single(ticker: str, _user: dict = Depends(require_paid)):
    """Return RS data for a single ticker."""
    try:
        data = get_rs_for_ticker(ticker)
        if data is None:
            return JSONResponse(
                status_code=404,
                content={"error": f"No RS data for {ticker.upper()}"},
            )
        return JSONResponse(content=data)
    except Exception as e:
        return JSONResponse(
            status_code=503,
            content={"error": f"RS ranking unavailable: {e}"},
        )
