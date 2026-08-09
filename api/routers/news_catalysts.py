"""News & Catalysts widget endpoint.

GET /api/news-catalysts/{sym} → a newest-first merged feed of high-impact
catalysts + earnings + breaking wire news for one symbol (see
api/services/news_catalysts/service.py). Reads already-collected data; the
historical AI catalysts are generated once per stock in the background.

🔴 PAID since 2026-08-09. It was `get_current_user` only, and signup is open and
free. This is not a news relay: it is the **merged, ranked** feed — the Model
Book's AI-generated historical catalysts, the firm's earnings collection and the
wire's breaking-news store, joined and ordered by our impact judgement. The
merge and the ranking are the product; the underlying headlines are not what a
member comes here for. `/api/catalysts/*` (Stock Catalysts) is deliberately NOT
gated — see `api/routers/catalysts.py` — because that one renders on the free
Morning Wire page. This one does not: its consumers are research/chart surfaces.
"""
from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import (
    get_current_user_with_plan, is_paid_user, require_admin,
)
from api.services.news_catalysts import service as news_service

router = APIRouter(tags=["news-catalysts"])


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the News & Catalysts feed.

    ⛔ Defined HERE, never imported from a sibling — one 402 sentence per surface.
    """
    if not is_paid_user(user):
        raise HTTPException(status_code=402,
                            detail="The news & catalysts feed requires a paid plan")
    return user


@router.get("/api/news-catalysts/{sym}")
def news_catalysts_endpoint(sym: str, _user: dict = Depends(require_paid)):
    return news_service.feed(sym)


@router.get("/api/news-catalysts/{sym}/debug")
def news_catalysts_debug(sym: str, _admin: dict = Depends(require_admin)):
    """Admin-only: live (uncached) web-catalyst search result for diagnosing coverage."""
    return news_service.debug_web(sym)
