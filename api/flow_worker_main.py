"""Dedicated options-flow worker entry point.

Run with: python -m api.flow_worker_main  (Railway: FLOW_WORKER_ENABLED=1)

A THIRD Railway service — separate from `web` and the bars `worker` — that runs
ONLY the Massive OPRA consumer + the flow read/upload routers, owning flow.db on
its own volume. This is what makes "deploy all day, zero gap" real: web deploys
and bars-worker deploys never touch this service, so the options-flow feed never
gaps for them. Only THIS service's own (narrow-watch-path) deploys restart the
consumer, and those are rare — and become zero-gap once Massive grants the 2nd
concurrent connection.

Deliberately NOT started here (they belong to the bars `worker`): the bars
pre-warmer, the R2 data_sync uploader, keep-warm. This pod's only job is flow.

Invariants (mirror the web/worker deploy-survival contract):
  - uvicorn gets timeout_graceful_shutdown=5 so lifespan.shutdown -> consumer
    stop() (clean OPRA slot release) runs within Railway's 30s drain.
  - `exec` in railway.json makes this PID 1 so it receives SIGTERM.
  - Nothing slow runs before uvicorn.run (the 2026-07-02 boot-purge class):
    the consumer starts as a background thread; the router mount is import-only.

Required env on this service: FLOW_WORKER_ENABLED=1, MASSIVE_WS_ENABLED=1,
MASSIVE_WS_DRY_RUN=0, FLOW_PROXY_TRUST=1 (trust web's vouched auth), PUSH_SECRET
(shared with web), and its OWN /data volume holding flow.db.
"""
import os
import asyncio
import threading
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
import uvicorn

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(name)s] %(message)s")
for _noisy in ("httpx", "httpcore", "websockets.client", "websockets.server",
               "websockets.protocol", "asyncio", "uvicorn.access"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)
log = logging.getLogger("flow-worker")


def _consumer_snapshot() -> dict:
    """Best-effort OPRA consumer status for the health endpoint. Never raises."""
    try:
        from api.massive_ws_worker import get_status
        s = get_status() or {}
        return {
            "connected": bool(s.get("connected")),
            "running": bool(s.get("running")),
            "uptime_sec": s.get("uptime_sec"),
            "reconnect_count": s.get("reconnect_count"),
            "maxconn_strikes": s.get("maxconn_strikes"),
        }
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)[:120]}


@asynccontextmanager
async def _lifespan(app):
    yield
    # Clean OPRA slot release on SIGTERM (the P1 contract) so the next process's
    # consumer doesn't hit max_connections. Bounded, idempotent, defensive.
    try:
        from api import massive_ws_worker
        stop = getattr(massive_ws_worker, "stop", None)
        if callable(stop):
            await asyncio.to_thread(stop)
            log.info("OPRA consumer stop() complete")
    except Exception as e:  # noqa: BLE001
        log.warning("consumer stop failed: %s", e)


def _build_app() -> FastAPI:
    app = FastAPI(title="UCT Flow Worker", docs_url=None, redoc_url=None,
                  lifespan=_lifespan)

    def _health():
        return {
            "alive": True,
            "service": "flow-worker",
            "thread_count": threading.active_count(),
            "consumer": _consumer_snapshot(),
        }

    # /api/health satisfies the shared railway.json healthcheckPath.
    @app.get("/api/health")
    def health():
        return _health()

    @app.get("/internal/health")
    def internal_health():
        return _health()

    # Mount every flow.db / consumer-state router (reuses the reviewed mounter).
    from api.worker_main import _mount_flow_routers
    _mount_flow_routers(app)
    return app


def _start_consumer():
    try:
        from api.massive_ws_worker import start as _ws_start
        log.info("starting Massive OPRA consumer")
        if _ws_start():
            log.info("Massive OPRA consumer started")
        else:
            log.info("consumer not started (MASSIVE_WS_ENABLED=0 or no key)")
    except Exception as e:  # noqa: BLE001
        log.exception("consumer failed to start (non-fatal): %s", e)


def main():
    # This pod OWNS the consumer + flow.db and serves the flow routers.
    os.environ.setdefault("WORKER_SERVES_FLOW", "1")
    log.info("[startup] flow-worker: consumer + flow routers only (no bars prewarm)")
    _start_consumer()
    app = _build_app()
    port = int(os.environ.get("PORT", "8080"))
    # timeout_graceful_shutdown=5 mirrors web/worker: reach lifespan.shutdown ->
    # consumer stop() within Railway's 30s drain instead of a SIGKILL.
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info",
                timeout_graceful_shutdown=5)


if __name__ == "__main__":
    main()
