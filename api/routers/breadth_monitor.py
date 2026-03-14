"""api/routers/breadth_monitor.py

GET  /api/breadth-monitor         — history (last 90 rows)
GET  /api/breadth-monitor/latest  — most recent row
POST /api/breadth-monitor/push    — store new snapshot (auth required)
"""

import os
from fastapi import APIRouter, HTTPException, Request
from api.services import breadth_monitor as svc

router = APIRouter()

_PUSH_SECRET = os.environ.get("PUSH_SECRET", "")


def _check_auth(request: Request) -> None:
    if not _PUSH_SECRET:
        raise HTTPException(status_code=500, detail="PUSH_SECRET not configured")
    auth = request.headers.get("Authorization", "")
    if auth != f"Bearer {_PUSH_SECRET}":
        raise HTTPException(status_code=401, detail="Unauthorized")


# ── Init DB on import ──────────────────────────────────────────────────────────
try:
    svc.init_db()
except Exception as _e:
    print(f"[breadth_monitor] DB init warning: {_e}")


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/api/breadth-monitor")
def get_breadth_history(days: int = 90):
    try:
        return {"rows": svc.get_history(days), "days": days}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/breadth-monitor/latest")
def get_breadth_latest():
    row = svc.get_latest()
    if row is None:
        raise HTTPException(status_code=404, detail="No breadth data yet")
    return row


@router.post("/api/breadth-monitor/push")
async def push_breadth_snapshot(request: Request):
    _check_auth(request)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    date_str = body.get("date")
    metrics = body.get("metrics") or body  # accept flat payload too

    if not date_str:
        raise HTTPException(status_code=400, detail="'date' field required")

    ok = svc.store_snapshot(date_str, metrics)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to store snapshot")

    return {"status": "ok", "date": date_str, "keys": len(metrics)}
