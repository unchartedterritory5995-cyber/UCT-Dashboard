# api/routers/alerts.py — Alert REST endpoints
from fastapi import APIRouter, Query
from api.services.alerts import get_alerts, mark_read, mark_all_read

router = APIRouter()


@router.get("/api/alerts")
def list_alerts(limit: int = Query(50, ge=1, le=100)):
    """Return recent alerts, newest first."""
    return get_alerts(limit)


@router.post("/api/alerts/{alert_id}/read")
def read_alert(alert_id: str):
    """Mark a single alert as read."""
    ok = mark_read(alert_id)
    return {"ok": ok}


@router.post("/api/alerts/read-all")
def read_all():
    """Mark all alerts as read."""
    count = mark_all_read()
    return {"ok": True, "marked": count}
