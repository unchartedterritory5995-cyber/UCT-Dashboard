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
    try:
        # Instant-tape SSE tailer (self-gated on MASSIVE_STREAM_ENABLED):
        # broadcasts newly-classified flow.db rows to /api/live/massive/stream.
        # MUST start here — start() creates its task on the RUNNING loop
        # (calling it pre-uvicorn logs "no running loop" and silently no-ops,
        # leaving the stream connected-but-empty). Mirrors web's lifespan call.
        from api import massive_stream
        massive_stream.start()
    except Exception as e:  # noqa: BLE001
        log.exception("massive_stream tailer start failed (non-fatal): %s", e)
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

    # Thread stack-dump diagnostics (7/14 incident: "which line is the hot
    # thread on" took an hour to infer from /proc; this answers it in one call).
    from api import debug_dump_router
    app.include_router(debug_dump_router.router)
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
    # Tape-freeze watchdog (7/14 incident): out-of-band thread, force-exits on
    # a wedged consumer so restartPolicy=ALWAYS recovers the tape in ~60s.
    # Self-gated on MASSIVE_WS_ENABLED=1.
    try:
        from api import flow_watchdog
        if flow_watchdog.start("flow-worker"):
            log.info("flow freeze-watchdog armed")
    except Exception as e:  # noqa: BLE001
        log.warning("flow freeze-watchdog failed to start (non-fatal): %s", e)


def _start_flow_schedulers():
    """flow.db lives on THIS pod now, so its safety nets must run HERE — the R2
    backup (a snapshot of the ONLY, non-replayable copy) and the T+1 gap-fill
    heal. On web those jobs run against web's now-frozen copy, so they must be
    DISABLED on web at cutover (unset FLOW_BACKUP_ENABLED / FLOW_GAP_AUTOFILL_
    ENABLED there) and set HERE. Each is internally flag-gated. Returned handle
    kept alive by main()'s local scope. Matches web's scheduler config."""
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from zoneinfo import ZoneInfo
        sched = BackgroundScheduler(timezone=ZoneInfo("America/New_York"))
        n = 0
        try:
            from api import flow_gap_autofill
            flow_gap_autofill.startup_check()
            if flow_gap_autofill.register_jobs(sched):
                n += 1
        except Exception as e:  # noqa: BLE001
            log.warning("gap-fill scheduling failed: %s", e)
        try:
            from api import flow_backup
            if flow_backup.register_jobs(sched):
                n += 1
            # Integrity probe in a daemon thread (mirrors api/main.py): the
            # PRAGMA scan runs ~9 min on the ~800MB flow.db — inline it sat
            # between boot and uvicorn.run racing the 600s healthcheck, and a
            # lost race strands this volume service (stop-then-start: the old
            # deployment is already gone). Readiness must never wait on it.
            threading.Thread(target=flow_backup.startup_integrity_check,
                             name="flow-integrity-probe", daemon=True).start()
        except Exception as e:  # noqa: BLE001
            log.warning("backup scheduling failed: %s", e)
        try:
            # T+1 flat-files archive ingest (11:30/12:00/12:30 ET) writes to
            # flow.db, so at cutover it must run HERE, not against web's frozen
            # copy. Self-gated on MASSIVE_FLATFILES_ENABLED + MASSIVE_S3_* creds.
            from api import massive_flatfiles_worker
            if massive_flatfiles_worker.register_jobs(sched):
                n += 1
                log.info("[startup] flat-files T+1 cron registered on flow-worker")
        except Exception as e:  # noqa: BLE001
            log.warning("flat-files scheduling failed: %s", e)

        def _nightly_flow_prune():
            # Mirrors web's 20:00 ET job (api/main.py): expired contracts must
            # be pruned from the LIVE flow.db, which lives here post-cutover.
            try:
                from api.flow_db import FlowDB
                pruned = FlowDB().prune_expired(buffer_days=1)
                if pruned:
                    log.info("[scheduler] Flow DB pruned %d expired rows", pruned)
            except Exception as e:  # noqa: BLE001
                log.warning("[scheduler] Flow DB prune error: %s", e)

        try:
            from apscheduler.triggers.cron import CronTrigger
            sched.add_job(_nightly_flow_prune, trigger=CronTrigger(hour=20, minute=0),
                          id="flow_nightly_prune", max_instances=1,
                          replace_existing=True)
            n += 1
        except Exception as e:  # noqa: BLE001
            log.warning("nightly prune scheduling failed: %s", e)
        if n:
            sched.start()
            log.info("[startup] flow-worker schedulers started (%d job group(s): "
                     "backup + gap-fill + flat-files + prune own flow.db here now)", n)
        else:
            log.info("[startup] no flow schedulers enabled "
                     "(FLOW_BACKUP_ENABLED / FLOW_GAP_AUTOFILL_ENABLED off)")
        return sched
    except Exception as e:  # noqa: BLE001
        log.exception("flow scheduler start failed (non-fatal): %s", e)
        return None


def main():
    # This pod OWNS the consumer + flow.db and serves the flow routers.
    os.environ.setdefault("WORKER_SERVES_FLOW", "1")
    log.info("[startup] flow-worker: consumer + flow routers only (no bars prewarm)")
    _start_consumer()
    _sched = _start_flow_schedulers()  # noqa: F841 - held alive for process lifetime
    app = _build_app()
    port = int(os.environ.get("PORT", "8080"))
    # timeout_graceful_shutdown=5 mirrors web/worker: reach lifespan.shutdown ->
    # consumer stop() within Railway's 30s drain instead of a SIGKILL.
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info",
                timeout_graceful_shutdown=5)


if __name__ == "__main__":
    main()
