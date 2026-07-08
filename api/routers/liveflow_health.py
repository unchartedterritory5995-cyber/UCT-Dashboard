"""
liveflow_health.py — consumer-state endpoint for the live-flow monitor.

GET /api/liveflow/consumer-state — sanitized in-process snapshot of the
Massive OPRA WS consumer (massive_ws_worker.get_status()). The worker-service
liveflow monitor cross-checks this on every DOWN evaluation to distinguish
"consumer down (deploy / cooldown)" from "WS connected but zero prints
(upstream OPRA outage or dead-quiet tape)". Also the deploy drill's instrument.

Deliberately a NEW /api/liveflow prefix — the partner's /api/live/massive
namespace is untouched. Precedent for the in-process import: the /restart-log
endpoint already reads massive_ws_worker.get_status() in-process.

Part of the deploy-survival P3 layer:
docs/superpowers/specs/2026-07-06-liveflow-worker-deploy-survival-design.md
"""
import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/liveflow", tags=["liveflow-health"])

log = logging.getLogger(__name__)

# Whitelist — keep the surface small and guaranteed JSON-safe regardless of
# what future fields land in massive_ws_worker._state (the pre-P1 module has
# no loop/root_task handles; the P1 patch adds them but pops them in
# get_status; this whitelist makes us immune either way).
_FIELDS = (
    "connected", "running", "started_at", "uptime_sec", "enabled", "dry_run",
    "reconnect_count", "clean_reconnects", "maxconn_strikes",
    "last_cooldown_sec", "stop_requested", "sessions_started",
    "last_error", "last_trade_ts", "last_write_ts",
    "trades_received", "events_written_stocks", "events_written_indexes",
    "min_reconnect_gap", "graceful_stop",
    # write-pipeline depth (Ravi 2026-07-08): surface the drain backlog so a
    # queue-lag (like this morning's) is visible/alarmable, not silent.
    "write_queue_depth", "last_write_drained_batches",
)


@router.get("/consumer-state")
def consumer_state():
    """In-process state of the Massive OPRA WS consumer on THIS pod.

    On the web service (where the consumer runs) this is live truth. On any
    pod where the consumer never started (worker: MASSIVE_WS_ENABLED=0) it
    reports enabled=false/running=false — callers should hit the web origin.
    """
    try:
        from api.massive_ws_worker import get_status
        s = get_status()
    except Exception as e:  # never 500 — the monitor treats errors as blind
        log.warning("[liveflow-health] get_status failed: %s", e)
        return JSONResponse({"ok": False, "error": str(e)[:200]}, status_code=200)

    out = {k: s.get(k) for k in _FIELDS if k in s}
    out["ok"] = True
    return JSONResponse(out, headers={"Cache-Control": "no-store, max-age=0"})
