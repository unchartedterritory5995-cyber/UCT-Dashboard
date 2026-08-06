"""Watchlist alerts API — per-symbol price / line / trendline alerts."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.middleware.auth_middleware import get_current_user
from api.services import watchlist_alert_service

router = APIRouter()


class AlertCreate(BaseModel):
    sym: str
    target_price: float
    direction: str  # 'above' or 'below'
    alert_type: str = "price"  # 'price' | 'line' | 'trendline'
    # Trendline anchors (two chart points as unix-seconds + price); ignored otherwise.
    anchor_t1: Optional[int] = None
    anchor_p1: Optional[float] = None
    anchor_t2: Optional[int] = None
    anchor_p2: Optional[float] = None


@router.get("/api/watchlist-alerts")
def list_alerts(active_only: bool = True, user: dict = Depends(get_current_user)):
    # active_only defaults True (back-compat with the bell + useWatchlistAlerts hook);
    # the Alerts widget passes active_only=false to also show recently-triggered rows.
    return watchlist_alert_service.list_user_alerts(user["id"], active_only=active_only)


@router.post("/api/watchlist-alerts")
def create_alert(body: AlertCreate, user: dict = Depends(get_current_user)):
    if body.direction not in ("above", "below"):
        raise HTTPException(status_code=400, detail="direction must be 'above' or 'below'")
    alert_type = body.alert_type if body.alert_type in ("price", "line", "trendline") else "price"
    anchors = None
    if alert_type == "trendline" and None not in (body.anchor_t1, body.anchor_p1, body.anchor_t2, body.anchor_p2):
        anchors = (body.anchor_t1, body.anchor_p1, body.anchor_t2, body.anchor_p2)
    return watchlist_alert_service.create_alert(
        user["id"], body.sym, body.target_price, body.direction,
        alert_type=alert_type, anchors=anchors,
    )


@router.delete("/api/watchlist-alerts/{alert_id}")
def delete_alert(alert_id: str, user: dict = Depends(get_current_user)):
    if not watchlist_alert_service.delete_alert(user["id"], alert_id):
        raise HTTPException(status_code=404, detail="Alert not found")
    return {"ok": True}
