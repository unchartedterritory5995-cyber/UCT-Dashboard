"""Thematic equal-weight index ("thematic ETF") endpoint.

GET /api/theme-index/{slug}?tf=D  -> equal-weight candlestick series for a theme,
in the standard /api/bars shape so the frontend renders it as a normal chart.

🔴 PAID since 2026-08-09. It was `get_current_user` only, and signup is open and
free. The bars are generic; **the basket is not**. A theme index is the firm's
own taxonomy (`themes_taxonomy.json` + the engine overlay) priced as an
equal-weight series — which holdings belong to a theme, and at which tier, is the
research, and this route publishes it in tradeable form. `/api/theme-performance`
and `/api/groups` were paywalled for the same reason on 2026-08-09; this is the
same taxonomy through a different door.

Its only caller is `hooks/useThemeIndexBars.js`, which fires **only** for a
`$IDX:<slug>` pseudo-ticker — the theme widget on `/charts` and
`ThemeTrackerPage`, both paid. A normal ticker never reaches it, so nothing on
`/morning-wire` touches this route.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import theme_index as svc

router = APIRouter(prefix="/api/theme-index", tags=["theme-index"])


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for thematic indexes.

    ⛔ Defined HERE, never imported from a sibling — one 402 sentence per surface.
    """
    if not is_paid_user(user):
        raise HTTPException(status_code=402,
                            detail="Thematic indexes require a paid plan")
    return user


@router.get("/{slug}")
def theme_index(slug: str, tf: str = Query("D"), user: dict = Depends(require_paid)):
    return svc.get_theme_index(slug, tf=tf)
