"""News & Catalysts widget endpoint.

GET /api/news-catalysts/{sym} → a newest-first merged feed of high-impact
catalysts + earnings + breaking wire news for one symbol (see
api/services/news_catalysts/service.py). Reads already-collected data; the
historical AI catalysts are generated once per stock in the background.
"""
from fastapi import APIRouter, Depends

from api.middleware.auth_middleware import get_current_user, require_admin
from api.services.news_catalysts import service as news_service

router = APIRouter(tags=["news-catalysts"])


@router.get("/api/news-catalysts/{sym}")
def news_catalysts_endpoint(sym: str, _user: dict = Depends(get_current_user)):
    return news_service.feed(sym)


@router.get("/api/news-catalysts/{sym}/debug")
def news_catalysts_debug(sym: str, _admin: dict = Depends(require_admin)):
    """Admin-only: live (uncached) web-catalyst search result for diagnosing coverage."""
    return news_service.debug_web(sym)
