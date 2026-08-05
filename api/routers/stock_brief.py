"""Stock Profile widget endpoint.

GET /api/stock-brief/{sym} → a per-stock dossier for the current (YTD) year:
YTD performance stats + the last 4 reported earnings + an AI company description
and this-year thematic narrative (see api/services/stock_brief/service.py).
Reuses the Model Book's own data generation; the profile is generated once per
(symbol, year) in the background, cached, and refreshed periodically.
"""
from fastapi import APIRouter, Depends

from api.middleware.auth_middleware import get_current_user
from api.services.stock_brief import service as brief_service

router = APIRouter(tags=["stock-brief"])


@router.get("/api/stock-brief/{sym}")
def stock_brief_endpoint(sym: str, _user: dict = Depends(get_current_user)):
    return brief_service.brief(sym)
