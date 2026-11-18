"""P0a — the chart-data monitor's heartbeat door on the WEB pod (feeds the dead-man).

The worker-side monitor (``api/services/chart_monitor/runner.py``) POSTs here after every cycle;
``chart_monitor.deadman`` pages ops when the beats stop. Service callers only: the existing
``PUSH_SECRET`` bearer (``require_push_secret``) — no member path, no new secret. The body is
a few counters and timestamps; nothing a member could read or use.
"""
from __future__ import annotations

from fastapi import APIRouter, Body, Depends, Header, HTTPException

from api.flow_admin_auth import _push_secret_ok
from api.services.chart_monitor import deadman

router = APIRouter(prefix="/api/internal/chart-monitor", tags=["chart-monitor"])


def require_push_secret(authorization: str = Header(default="")) -> dict:
    """Service callers only (the repo's one-copy-per-router idiom, a GUARD_NAMES gate):
    401 on a blank or wrong bearer, and on a pod with no PUSH_SECRET configured."""
    if _push_secret_ok(authorization):
        return {"via": "push_secret"}
    raise HTTPException(status_code=401, detail="Not authenticated")


@router.post("/heartbeat")
def heartbeat(payload: dict = Body(default_factory=dict), _svc: dict = Depends(require_push_secret)):
    beat = deadman.record(payload if isinstance(payload, dict) else {})
    return {"ok": True, "next_due_s": beat["next_due_s"]}


@router.get("/status")
def monitor_status(_svc: dict = Depends(require_push_secret)):
    return deadman.status()
