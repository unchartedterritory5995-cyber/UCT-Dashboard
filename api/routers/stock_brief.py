"""Stock Profile widget endpoint.

GET /api/stock-brief/{sym} → a per-stock dossier for the current (YTD) year:
YTD performance stats + the last 4 reported earnings + an AI company description
and this-year thematic narrative (see api/services/stock_brief/service.py).
Reuses the Model Book's own data generation; the profile is generated once per
(symbol, year) in the background, cached, and refreshed periodically.

🔴 PAID since 2026-08-09. It was `get_current_user` only, and signup is open and
free. The brief is not a relay of anything: it is an **LLM-authored** company
description and this-year thematic narrative generated on the firm's Anthropic
key, on top of the Model Book's own generation pipeline. A free account asking
for an uncached symbol spent our tokens; asking for many spent many.
"""
from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.stock_brief import service as brief_service

router = APIRouter(tags=["stock-brief"])


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the Stock Profile brief.

    ⛔ Defined HERE, never imported from a sibling — one 402 sentence per surface.
    """
    if not is_paid_user(user):
        raise HTTPException(status_code=402,
                            detail="Stock profiles require a paid plan")
    return user


@router.get("/api/stock-brief/{sym}")
def stock_brief_endpoint(sym: str, _user: dict = Depends(require_paid)):
    return brief_service.brief(sym)
