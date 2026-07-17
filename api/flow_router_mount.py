"""
flow_router_mount.py — the flow.db / OPRA-consumer-state router mounter,
extracted from worker_main.py (2026-07-17).

WHY IT'S ITS OWN FILE: flow_worker_main.py needs this to mount the flow-family
routers, and it used to import it from worker_main.py — but worker_main.py is
ALSO the bars-worker's entry point, so a pure bars/charts change to that file
(e.g. deep-history-warm on 2026-07-17) triggered a flow-worker redeploy and
restarted the OPRA consumer MID-SESSION. Giving flow-worker a dedicated
dependency here (in the flow-worker watch paths) instead of the shared
worker_main.py removes that false trigger. worker_main.py can then be dropped
from the flow-worker watch paths.
"""
import logging
import os

logger = logging.getLogger("uvicorn.error")


def mount_flow_routers(app) -> None:
    """Include every flow.db / OPRA-consumer-state router on the app.

    Mirrors the web registrations exactly (same prefixes) so a request proxied
    to `http://<worker>.railway.internal:$PORT/api/flow/...` resolves the same
    way it did on web. Import failures are logged but non-fatal so a single bad
    router can't stop the pod from booting + serving /api/health.
    """
    def _try(desc, fn):
        try:
            fn()
        except Exception as e:  # noqa: BLE001
            logger.warning("[worker-flow] failed to mount %s: %s", desc, e)

    # Only flow.db-backed / OPRA-consumer-state routers. top-flow /
    # flow-scoreboard (top_flow_picks.json), darkpool (darkpool.db), and
    # flow-explain (flow_explain.db + per-user auth) have web-local backing
    # stores -> they stay on WEB, are NOT mounted here. Each mounted
    # independently so one bad import degrades only that endpoint.
    _MOUNTS = (
        ("flow_router", "api.flow_router", "flow_router"),
        ("flow_summary", "api.flow_summary", "flow_summary_router"),
        ("oi_snapshot", "api.oi_snapshot_router", "router"),
        ("notable_flow", "api.notable_flow_router", "router"),
        ("liveflow_health", "api.routers.liveflow_health", "router"),
        ("live_massive", "api.live_massive_router", "router"),
        ("dealer_positioning", "api.dealer_positioning_router", "router"),
        ("flow_reconcile", "api.flow_reconcile_router", "router"),
        # Instant-tape SSE: the proxy forwards /api/live/massive/stream here.
        # Route self-gates (503 enabled:false) unless MASSIVE_STREAM_ENABLED=1.
        ("massive_stream", "api.routers.massive_stream_router", "router"),
    )
    for _desc, _mod, _attr in _MOUNTS:
        _try(_desc, lambda m=_mod, a=_attr: app.include_router(
            getattr(__import__(m, fromlist=[a]), a)))

    if os.environ.get("FLOW_GAP_AUTOFILL_ENABLED", "0") == "1":
        _try("flow_gap_autofill_router", lambda: app.include_router(
            __import__("api.flow_gap_autofill", fromlist=["router"]).router))
    if os.environ.get("FLOW_BACKUP_ENABLED", "0") == "1":
        _try("flow_backup_router", lambda: app.include_router(
            __import__("api.flow_backup", fromlist=["router"]).router))

    logger.info("[worker-flow] flow routers mounted")
