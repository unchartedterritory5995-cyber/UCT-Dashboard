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
    # MOB-05 — bind this alert to a chart drawing ("follow this line"). NULL/absent
    # is a FIXED level: snapshotted at creation and thereafter independent of the
    # drawing, which is exactly what the seeded price-context alerts are.
    drawing_id: Optional[str] = None


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
        alert_type=alert_type, anchors=anchors, drawing_id=body.drawing_id,
    )


class BoundGeometry(BaseModel):
    """The new shape of a bound line, as the chart measures it."""
    target_price: float
    alert_type: str = "trendline"
    anchor_t1: Optional[int] = None
    anchor_p1: Optional[float] = None
    anchor_t2: Optional[int] = None
    anchor_p2: Optional[float] = None


# ⛔ DECLARED BEFORE `/{alert_id}`. FastAPI answers on FIRST MATCH, and
# `/api/watchlist-alerts/{alert_id}` matches the literal string "bound" as an id —
# registered the other way round, every bound delete would 404 while looking
# entirely correct in review. Same trap as the COT live-drill route.
@router.patch("/api/watchlist-alerts/bound/{drawing_id}")
def resync_bound(drawing_id: str, body: BoundGeometry, user: dict = Depends(get_current_user)):
    """Re-point the alerts bound to a drawing after the user moved it."""
    alert_type = body.alert_type if body.alert_type in ("price", "line", "trendline") else "line"
    anchors = None
    if alert_type == "trendline" and None not in (body.anchor_t1, body.anchor_p1, body.anchor_t2, body.anchor_p2):
        anchors = (body.anchor_t1, body.anchor_p1, body.anchor_t2, body.anchor_p2)
    n = watchlist_alert_service.resync_bound_alerts(
        user["id"], drawing_id, target_price=body.target_price,
        alert_type=alert_type, anchors=anchors,
    )
    # ⛔ 0 IS NOT AN ERROR. The chart pushes on any move of a line it has seen; a
    # line with no bound alert is the common case, and a 404 there would turn
    # ordinary drawing into a stream of console noise.
    return {"ok": True, "updated": n}


@router.delete("/api/watchlist-alerts/bound/{drawing_id}")
def delete_bound(drawing_id: str, user: dict = Depends(get_current_user)):
    """The drawing is gone — take its still-armed alerts with it."""
    return {"ok": True, "deleted": watchlist_alert_service.delete_bound_alerts(user["id"], drawing_id)}


@router.delete("/api/watchlist-alerts/{alert_id}")
def delete_alert(alert_id: str, user: dict = Depends(get_current_user)):
    if not watchlist_alert_service.delete_alert(user["id"], alert_id):
        raise HTTPException(status_code=404, detail="Alert not found")
    return {"ok": True}
