"""api/routers/breadth_monitor.py

GET  /api/breadth-monitor         — history (last 90 rows)
GET  /api/breadth-monitor/latest  — most recent row
POST /api/breadth-monitor/push    — store new snapshot (auth required)
"""

import os
from fastapi import APIRouter, HTTPException, Request
from api.services import breadth_monitor as svc
from api.services.breadth_analogues import find_analogues, invalidate_cache as invalidate_analogues_cache

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


@router.get("/api/breadth-monitor/analogues")
def get_breadth_analogues():
    """Return top 5 historical dates most similar to current breadth regime."""
    try:
        result = find_analogues()
        return result
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

    invalidate_analogues_cache()
    return {"status": "ok", "date": date_str, "keys": len(metrics)}


@router.delete("/api/breadth-monitor/{date_str}")
async def delete_breadth_snapshot(date_str: str, request: Request):
    _check_auth(request)
    ok = svc.delete_snapshot(date_str)
    if not ok:
        raise HTTPException(status_code=404, detail=f"No snapshot for {date_str}")
    return {"status": "deleted", "date": date_str}


@router.get("/api/breadth-monitor/{date_str}/drill/{metric_key}")
def get_drill_list(date_str: str, metric_key: str):
    items = svc.get_drill_list(date_str, metric_key)
    if items is None:
        raise HTTPException(status_code=404, detail=f"No data for {date_str}/{metric_key}")
    return {"date": date_str, "metric": metric_key, "items": items}


@router.patch("/api/breadth-monitor/{date_str}/field")
async def patch_breadth_field(date_str: str, request: Request):
    _check_auth(request)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    key = body.get("key")
    value = body.get("value")
    if not key:
        raise HTTPException(status_code=400, detail="'key' required")
    ok = svc.patch_field(date_str, key, value)
    if not ok:
        raise HTTPException(status_code=404, detail=f"No snapshot for {date_str}")
    return {"status": "ok", "date": date_str, "key": key, "value": value}
