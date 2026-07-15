"""Thematic equal-weight index ("thematic ETF") endpoint.

GET /api/theme-index/{slug}?tf=D  -> equal-weight candlestick series for a theme,
in the standard /api/bars shape so the frontend renders it as a normal chart.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from api.middleware.auth_middleware import get_current_user
from api.services import theme_index as svc

router = APIRouter(prefix="/api/theme-index", tags=["theme-index"])


@router.get("/{slug}")
def theme_index(slug: str, tf: str = Query("D"), user: dict = Depends(get_current_user)):
    return svc.get_theme_index(slug, tf=tf)
