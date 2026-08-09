"""The Traders surface — each desk trader's curated basket.

🔴 WAS ANONYMOUS (auth/paywall sweep, 2026-08-09). It is a hand-curated list of
which names each named trader is watching — editorial output, not market data.

⚠️ `app/src/pages/Traders.jsx` is currently reachable from NO route (recorded in
CLAUDE.md's unreachable table), so this endpoint serves nobody today. Gated
anyway: an orphaned page is a reason to close the door, not to leave it open —
the day a route is added, it lands paid instead of arriving open.
"""
from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the Traders surface.

    ⛔ Defined HERE, not imported from a sibling. Every router that gates on
    `require_paid` defines its own with its OWN 402 sentence, so "which surface
    locked me out" is answerable from the message alone. The rail is
    `tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER…`,
    which walks `api/routers/` by AST and fails on a shared import.
    """
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The Traders surface requires a paid plan")
    return user


TRADERS = [
    {
        "id": "tsdr",
        "name": "TSDR",
        "color": "#3cb868",
        "tickers": ["NVDA", "META", "GOOGL", "AMZN", "MSFT", "AAPL", "AMD", "TSM", "AVGO", "ARM"],
    },
    {
        "id": "bracco",
        "name": "Bracco",
        "color": "#e74c3c",
        "tickers": ["SMCI", "PLTR", "IONQ", "RGTI", "ACHR", "JOBY", "RKLB", "LUNR", "TDW", "PRFX"],
    },
    {
        "id": "qullamaggie",
        "name": "Qullamaggie",
        "color": "#6ba3be",
        "tickers": ["CELH", "AXON", "ANET", "TTD", "MNDY", "DUOL", "IOT", "SMAR", "GTLB", "DDOG"],
    },
    {
        "id": "manrav",
        "name": "Manrav",
        "color": "#c9a84c",
        "tickers": ["CRS", "FIX", "EQIX", "MCK", "TOL", "GLW", "STX", "MU", "SNDK", "LITE"],
    },
]


@router.get("/api/traders")
def get_traders(_user: dict = Depends(require_paid)):
    return TRADERS
