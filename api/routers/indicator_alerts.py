"""REST endpoints for chart indicator alerts.

Per-user CRUD over the ``indicator_alerts`` table. All endpoints require
an authenticated session via the canonical ``get_current_user`` dependency.

The background evaluator (started from the app lifespan) reads the same
table and dispatches deliveries through the watchlist-alert pipeline, so
these endpoints only need to manage the alert rows themselves.
"""
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.middleware.auth_middleware import get_current_user
from api.services import indicator_alert_service as ias


router = APIRouter(prefix="/api/indicator-alerts", tags=["indicator-alerts"])


class AlertCreate(BaseModel):
    sym: str
    indicator: str
    condition: str
    threshold: Optional[float] = None
    tf: str
    params: Optional[dict[str, Any]] = None


@router.get("")
def list_my_alerts(user: dict = Depends(get_current_user)):
    return {"alerts": ias.list_for_user(user["id"])}


@router.post("")
def create_alert(body: AlertCreate, user: dict = Depends(get_current_user)):
    alert_id = ias.create(
        user_id=user["id"],
        sym=body.sym.upper(),
        indicator=body.indicator,
        condition=body.condition,
        threshold=body.threshold,
        tf=body.tf,
        params_json=body.params,
    )
    return {"id": alert_id}


@router.delete("/{alert_id}")
def delete_alert(alert_id: int, user: dict = Depends(get_current_user)):
    alert = ias.get(alert_id)
    if not alert or alert["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Alert not found")
    ias.delete(alert_id)
    return {"ok": True}


@router.post("/{alert_id}/toggle")
def toggle_alert(alert_id: int, user: dict = Depends(get_current_user)):
    alert = ias.get(alert_id)
    if not alert or alert["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Alert not found")
    new_state = not alert["active"]
    ias.set_active(alert_id, new_state)
    return {"active": new_state}
