# api/routers/alerts.py — Alert REST endpoints
#
# ⭐ EVERY ROUTE HERE IS AUTHENTICATED, AND EVERY ROUTE IS SCOPED TO THE CALLER.
#
# Until 2026-08-06 `GET /api/alerts` had no `Depends` at all: an unauthenticated
# request from the public internet returned HTTP 200 and the alert feed, which
# by then was one global list carrying member-delivered alerts. Adding the
# dependency is only half — the store is scoped per member as well (see the
# audience contract at the top of `api/services/alerts.py`), because on a single
# global list every logged-in member would still read every other member's
# alerts.
#
# ⛔ A NEW ROUTE ON THIS ROUTER MUST TAKE `user: dict = Depends(get_current_user)`
# AND PASS `user["id"]` DOWN. `tests/test_alerts_privacy.py` walks this module's
# AST and fails on any router-decorated function without it.
from fastapi import APIRouter, Depends, Query

from api.middleware.auth_middleware import get_current_user
from api.services.alerts import get_alerts, mark_read, mark_all_read

router = APIRouter()


@router.get("/api/alerts")
def list_alerts(
    limit: int = Query(50, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    """Return the caller's recent alerts (their own + broadcast), newest first."""
    return get_alerts(limit, user_id=user["id"])


@router.post("/api/alerts/{alert_id}/read")
def read_alert(alert_id: str, user: dict = Depends(get_current_user)):
    """Mark a single alert read for the caller. False if it isn't theirs."""
    ok = mark_read(alert_id, user["id"])
    return {"ok": ok}


@router.post("/api/alerts/read-all")
def read_all(user: dict = Depends(get_current_user)):
    """Mark the caller's own feed read. Never touches another member's."""
    count = mark_all_read(user["id"])
    return {"ok": True, "marked": count}
