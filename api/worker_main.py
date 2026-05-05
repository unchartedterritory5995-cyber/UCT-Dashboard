"""Worker service entry point.

Run with: python -m api.worker_main

This is a separate Railway service from the web app. It runs:
  - The bars pre-warmer (api.services.bars_prewarm.run_prewarmer_forever)
  - The bars seeder (api.services.bars_seeder.start_background_seeder)
  - A periodic S3 uploader that snapshots /data and pushes to R2

Exposes only /internal/health on its HTTP port for Railway's healthcheck.
Never serves user requests."""
import os
import sys
import threading
import time
import logging

from fastapi import FastAPI
import uvicorn

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(message)s",
)
log = logging.getLogger("worker")


def _start_prewarmer():
    from api.services.bars_prewarm import run_prewarmer_forever
    log.info("starting prewarmer thread")
    threading.Thread(target=run_prewarmer_forever, daemon=True, name="prewarm").start()


def _start_seeder():
    try:
        from api.services.bars_seeder import start_background_seeder
        log.info("starting bars seeder")
        start_background_seeder()
    except Exception as e:
        log.exception(f"seeder start failed (non-fatal): {e}")


def _start_uploader():
    """Push a snapshot to R2 every 5 minutes."""
    from api.services import data_sync

    def loop():
        while True:
            try:
                ts = data_sync.upload_snapshot()
                if ts:
                    log.info(f"uploaded snapshot {ts}")
            except Exception as e:
                log.exception(f"upload error (non-fatal): {e}")
            time.sleep(300)

    log.info("starting S3 uploader thread (5-min cadence)")
    threading.Thread(target=loop, daemon=True, name="s3_upload").start()


def _build_app() -> FastAPI:
    app = FastAPI(title="UCT Worker", docs_url=None, redoc_url=None)

    def _health_payload():
        from api.services.data_sync import get_local_sync_state
        state = get_local_sync_state()
        return {
            "alive": True,
            "service": "worker",
            "snapshot_ts": state["snapshot_ts"],
            "synced_at": state["synced_at"],
            "seconds_since_sync": state["seconds_since_sync"],
        }

    # /api/health is exposed so the worker satisfies the shared
    # healthcheckPath in railway.json (set for the web service).
    # /internal/health is the worker-native path.
    @app.get("/internal/health")
    def health():
        return _health_payload()

    @app.get("/api/health")
    def health_alias():
        return _health_payload()

    return app


def main():
    log.info("worker boot starting")
    # Bring up SQLite (needed by both prewarmer and seeder)
    try:
        from api.services import bars_sqlite as _bs
        _bs.init_db()
        log.info("bars SQLite ready")
    except Exception as e:
        log.exception(f"bars SQLite init failed: {e}")
        sys.exit(1)

    _start_prewarmer()
    # Seeder disabled in worker: it competes with the prewarmer for SQLite
    # writes during boot and produces a flood of "database is locked" errors
    # because both try to fan out concurrent writes to bars.db. The prewarmer
    # alone covers the same ticker set (and refreshes every 5 min instead of
    # one-shot at boot), so the seeder is redundant here.
    # _start_seeder()
    _start_uploader()

    port = int(os.environ.get("PORT", "8080"))
    log.info(f"worker HTTP listening on :{port} (healthcheck only)")
    uvicorn.run(_build_app(), host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    main()
