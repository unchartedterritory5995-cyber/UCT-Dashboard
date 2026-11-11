"""P0a — the chart-data monitor's heartbeat door on the WEB pod (feeds the dead-man).

The worker-side monitor (``api/services/chart_monitor/runner.py``) POSTs here after every cycle;
``chart_monitor.deadman`` pages ops when the beats stop. Service callers only: the existing
``PUSH_SECRET`` bearer via ``require_bars_service`` — no member path, no new secret. The body is
a few counters and timestamps; nothing a member could read or use.
"""
from __future__ import annotations

from fastapi import APIRouter, Body, Depends

from api.bars_auth import require_bars_service
from api.services.chart_monitor import deadman

router = APIRouter(prefix="/api/internal/chart-monitor", tags=["chart-monitor"])


@router.post("/heartbeat")
def heartbeat(payload: dict = Body(default_factory=dict), _svc: dict = Depends(require_bars_service)):
    beat = deadman.record(payload if isinstance(payload, dict) else {})
    return {"ok": True, "next_due_s": beat["next_due_s"]}


@router.get("/status")
def monitor_status(_svc: dict = Depends(require_bars_service)):
    return deadman.status()
