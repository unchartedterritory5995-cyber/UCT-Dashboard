"""Worker service entry point.

Run with: python -m api.worker_main

This is a separate Railway service from the web app. It runs:
  - The bars pre-warmer (api.services.bars_prewarm.run_prewarmer_forever)
  - A periodic R2 uploader that snapshots /data and pushes to R2

Exposes /internal/health (worker-native) and /api/health (alias so the
shared railway.json healthcheckPath works) on its HTTP port. Never serves
user requests.

Note: the bars seeder (api.services.bars_seeder.start_background_seeder)
is intentionally NOT started here. It competes with the prewarmer for
SQLite writes during boot and produces a flood of "database is locked"
errors. The prewarmer covers the same ticker universe and refreshes
every 5 min (vs one-shot at boot), so the seeder is redundant in the
worker context.
"""
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

# Liveness signal for the uploader thread. Updated at the top of every
# loop iteration regardless of upload outcome — so if this stops moving,
# the thread is dead even if R2 has been unreachable for a while.
# Lock-guarded so the health endpoint sees a consistent snapshot.
_uploader_state = {
    "last_attempt_at": None,   # int unix seconds, or None before first loop
    "last_outcome": None,      # "success" | "no_data" | "error" | None
}
_uploader_state_lock = threading.Lock()


def _start_prewarmer():
    from api.services.bars_prewarm import run_prewarmer_forever
    log.info("starting prewarmer thread")
    threading.Thread(target=run_prewarmer_forever, daemon=True, name="prewarm").start()


def _start_uploader():
    """Push a snapshot to R2 every SNAPSHOT_INTERVAL_SECONDS."""
    from api.services import data_sync

    def loop():
        while True:
            # Default to "error" so an exception below leaves the right
            # signal in the health endpoint even if logging fails.
            outcome = "error"
            try:
                # Distinguish misconfiguration from "no data yet" — both
                # would otherwise return None and look identical in health.
                if not data_sync.credentials_ok():
                    outcome = "no_credentials"
                else:
                    ts = data_sync.upload_snapshot()
                    outcome = "success" if ts else "no_data"
                    if ts:
                        log.info(f"uploaded snapshot {ts}")
            except Exception as e:
                log.exception(f"upload error (non-fatal): {e}")
            with _uploader_state_lock:
                _uploader_state["last_attempt_at"] = int(time.time())
                _uploader_state["last_outcome"] = outcome
            time.sleep(data_sync.SNAPSHOT_INTERVAL_SECONDS)

    log.info(
        f"starting R2 uploader thread "
        f"({data_sync.SNAPSHOT_INTERVAL_SECONDS // 60}-min cadence)"
    )
    threading.Thread(target=loop, daemon=True, name="s3_upload").start()


def _build_app() -> FastAPI:
    app = FastAPI(title="UCT Worker", docs_url=None, redoc_url=None)

    def _health_payload():
        # The worker NEVER pulls (it's the producer), so .last_sync_ts is
        # always empty here. We expose .last_upload_ts instead so an
        # operator can confirm uploads are flowing without grepping logs.
        from api.services.data_sync import (
            get_local_upload_state,
            SNAPSHOT_INTERVAL_SECONDS,
        )
        upload = get_local_upload_state()

        with _uploader_state_lock:
            last_attempt_at = _uploader_state["last_attempt_at"]
            last_outcome = _uploader_state["last_outcome"]
        seconds_since_attempt = (
            int(time.time()) - last_attempt_at
            if last_attempt_at is not None else None
        )
        # Compute liveness server-side so callers don't have to know the
        # threshold. "Alive" means the uploader has attempted recently
        # (within 2 cadences). Strictly informational — Railway's
        # healthcheck only checks that this endpoint returns 200.
        uploader_alive = (
            seconds_since_attempt is not None
            and seconds_since_attempt < 2 * SNAPSHOT_INTERVAL_SECONDS
        )

        return {
            "alive": True,
            "service": "worker",
            # Most-recent successful upload (timestamp embedded in tarball
            # key + latest.txt). None until the first success.
            "last_upload_ts": upload["snapshot_ts"],
            "last_upload_at": upload["synced_at"],
            "seconds_since_last_upload": upload["seconds_since_sync"],
            # Liveness signal for the uploader thread itself. Stays fresh
            # even when R2 is unreachable.
            "uploader_alive": uploader_alive,
            "uploader_last_attempt_at": last_attempt_at,
            "uploader_last_outcome": last_outcome,
            "uploader_seconds_since_attempt": seconds_since_attempt,
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
    # Bring up SQLite (needed by the prewarmer)
    try:
        from api.services import bars_sqlite as _bs
        _bs.init_db()
        log.info("bars SQLite ready")
    except Exception as e:
        log.exception(f"bars SQLite init failed: {e}")
        sys.exit(1)

    _start_prewarmer()
    _start_uploader()

    port = int(os.environ.get("PORT", "8080"))
    log.info(f"worker HTTP listening on :{port} (healthcheck only)")
    uvicorn.run(_build_app(), host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    main()
