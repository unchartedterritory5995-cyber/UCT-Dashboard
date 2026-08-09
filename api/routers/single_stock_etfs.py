"""Single-stock leveraged/inverse ETF family endpoints.

ROUTE ORDER MATTERS: /status is declared BEFORE /{symbol} — FastAPI matches in
declaration order, and the wildcard would otherwise capture 'status' as a
symbol (same lesson as cot.py + journal psychology routes).

🔴 `/{symbol}` IS PAID since 2026-08-09. It was `get_current_user` only, and
signup is open and free. `/status` and `/rebuild` were already admin-gated.

The lookup answers "which leveraged/inverse single-stock ETFs exist for this
name, and how do they relate" — a family map the firm BUILDS and rebuilds
(`ss.rebuild`) rather than fetches. It is curated reference data, so it is paid,
in the same class as `/api/groups` and `/api/delisted/list`.
"""
import threading

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import (
    get_current_user_with_plan, is_paid_user, require_admin,
)
from api.services import single_stock_etfs as ss

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the single-stock ETF family map.

    ⛔ Defined HERE, never imported from a sibling — one 402 sentence per surface.
    """
    if not is_paid_user(user):
        raise HTTPException(status_code=402,
                            detail="Single-stock ETF families require a paid plan")
    return user


@router.get("/api/single-stock-etfs/status")
def ssetf_status(user: dict = Depends(require_admin)):
    return ss.status()


@router.post("/api/single-stock-etfs/rebuild")
def ssetf_rebuild(force_shrink: bool = Query(default=False),
                  user: dict = Depends(require_admin)):
    if not ss._enabled():
        return {"status": "disabled"}
    threading.Thread(
        target=lambda: ss.rebuild(force_shrink=force_shrink, trigger="admin"),
        daemon=True, name="ssetf-admin-rebuild",
    ).start()
    return {"status": "started"}


@router.get("/api/single-stock-etfs/{symbol}")
def ssetf_lookup(symbol: str, user: dict = Depends(require_paid)):
    if not ss._enabled():
        return dict(ss._EMPTY_FAMILY)
    return ss.lookup(symbol)
