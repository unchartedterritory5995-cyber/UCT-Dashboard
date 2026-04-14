"""Watchlist alerts API — per-symbol price alerts."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.middleware.auth_middleware import get_current_user
from api.services import watchlist_alert_service

router = APIRouter()


class AlertCreate(BaseModel):
    sym: str
    target_price: float
    direction: str  # 'above' or 'below'


@router.get("/api/watchlist-alerts")
def list_alerts(user: dict = Depends(get_current_user)):
    return watchlist_alert_service.list_user_alerts(user["id"])


@router.post("/api/watchlist-alerts")
def create_alert(body: AlertCreate, user: dict = Depends(get_current_user)):
    if body.direction not in ("above", "below"):
        raise HTTPException(status_code=400, detail="direction must be 'above' or 'below'")
    return watchlist_alert_service.create_alert(user["id"], body.sym, body.target_price, body.direction)


@router.delete("/api/watchlist-alerts/{alert_id}")
def delete_alert(alert_id: str, user: dict = Depends(get_current_user)):
    if not watchlist_alert_service.delete_alert(user["id"], alert_id):
        raise HTTPException(status_code=404, detail="Alert not found")
    return {"ok": True}
