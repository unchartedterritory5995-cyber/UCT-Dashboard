"""Single-stock leveraged/inverse ETF family endpoints.

ROUTE ORDER MATTERS: /status is declared BEFORE /{symbol} — FastAPI matches in
declaration order, and the wildcard would otherwise capture 'status' as a
symbol (same lesson as cot.py + journal psychology routes).
"""
import threading

from fastapi import APIRouter, Depends, Query

from api.middleware.auth_middleware import get_current_user, require_admin
from api.services import single_stock_etfs as ss

router = APIRouter()


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
def ssetf_lookup(symbol: str, user: dict = Depends(get_current_user)):
    if not ss._enabled():
        return dict(ss._EMPTY_FAMILY)
    return ss.lookup(symbol)
