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
# Quiet the per-request httpx/httpcore noise. The prewarmer fires thousands
# of Massive aggs requests per pass; at INFO each one logs a "GET … 200 OK"
# line. Railway tags all worker stderr as severity=error, so that firehose
# masquerades as an "error flood" in the log viewer (it isn't — they're 200s).
# Mirrors the web service's logging config (api/main.py) so both pods are quiet.
for _noisy in ("httpx", "httpcore", "websockets.client", "websockets.server",
               "websockets.protocol", "asyncio", "uvicorn.access"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)
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

    # In delta mode the worker ships ONE full base per ET calendar day (cold-
    # start seed + drift backstop) and a tiny windowed delta every other cycle.
    # Tracked across iterations so we only build the big base once/day.
    _last_base_day = {"d": None}

    def _et_today() -> str:
        import datetime as _dt
        from zoneinfo import ZoneInfo
        return _dt.datetime.now(ZoneInfo("America/New_York")).date().isoformat()

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
                elif data_sync.DELTA_ENABLED:
                    # One full base per ET day; deltas the rest of the time.
                    today = _et_today()
                    if _last_base_day["d"] != today:
                        ts = data_sync.upload_snapshot(force=True)  # full base
                        if ts and ts != data_sync.SNAPSHOT_UNCHANGED:
                            _last_base_day["d"] = today
                            outcome = "base"
                            log.info(f"uploaded base snapshot {ts}")
                        else:
                            outcome = "no_data"
                    else:
                        ts = data_sync.upload_delta()
                        if ts:
                            outcome = "delta"
                            log.info(f"uploaded delta {ts}")
                        else:
                            outcome = "unchanged"  # nothing in the window
                else:
                    ts = data_sync.upload_snapshot()
                    if ts == data_sync.SNAPSHOT_UNCHANGED:
                        outcome = "unchanged"  # source data hasn't moved — no tarball built
                    elif ts:
                        outcome = "success"
                        log.info(f"uploaded snapshot {ts}")
                    else:
                        outcome = "no_data"
            except Exception as e:
                log.exception(f"upload error (non-fatal): {e}")
            with _uploader_state_lock:
                _uploader_state["last_attempt_at"] = int(time.time())
                _uploader_state["last_outcome"] = outcome
            # Adaptive cadence: 5 min in the active data window, slow overnight/
            # weekends. With skip-if-unchanged this drops the round-the-clock
            # 688 MB upload firehose to near-zero when the market's closed.
            time.sleep(data_sync.snapshot_interval_seconds())

    log.info(
        f"starting R2 uploader thread "
        f"({data_sync.SNAPSHOT_INTERVAL_SECONDS // 60}-min cadence)"
    )
    threading.Thread(target=loop, daemon=True, name="s3_upload").start()


def _start_keepwarm():
    """Ping the web pod's /api/health on a fixed cadence so Railway never
    idle-spins it down.

    WHY this lives on the worker: a measured cold web pod adds ~12s to the
    FIRST request after idle. Stacked under a cold long-tail intraday fetch
    that's enough to blow Railway's gateway timeout (502) and blank the
    chart. A pod cannot keep ITSELF warm — when Railway suspends an idle
    container its own threads freeze too, so the wake-up ping must come from
    a different, always-active process. The worker is exactly that (it runs
    the prewarmer + R2 uploader continuously and is never request-idle).

    Pings the public custom domain by default (confirmed reachable); override
    with KEEPWARM_URL (e.g. a Railway-internal URL). Disable with
    KEEPWARM_ENABLED=0. Failures are logged and never fatal.
    """
    if os.environ.get("KEEPWARM_ENABLED", "1") != "1":
        log.info("keep-warm pinger disabled (KEEPWARM_ENABLED!=1)")
        return
    import urllib.request

    base = (os.environ.get("KEEPWARM_URL") or "https://uctintelligence.com").rstrip("/")
    url = f"{base}/api/health"
    try:
        interval = max(15, int(os.environ.get("KEEPWARM_INTERVAL_SECONDS", "60")))
    except ValueError:
        interval = 60

    from api.services import data_sync as _ds

    # DEFAULT: keep the web pod warm 24/7 so charts are instant whenever the
    # user sits down — including evening/weekend watchlist scanning, which is a
    # primary use case (off-hours stock scanning + watchlist prep). Keeping the
    # pod awake also keeps its APScheduler running (Sunday 8am weekly email,
    # overnight Twitter polling stay reliable).
    #
    # OPT-IN cost saving: set KEEPWARM_MARKET_HOURS_ONLY=1 to ping only during
    # the active data window (weekday 4am-8pm ET) and let Railway idle-sleep the
    # pod overnight/weekends — saves compute but reintroduces off-hours cold
    # starts AND freezes the scheduler while asleep.
    #
    # NOTE: the snapshot-upload throttle + prewarmer market-hours gating are
    # independent of this and stay on — they're background worker→R2 work that
    # doesn't affect how fast the web pod serves a chart, so the bulk of the
    # cost savings is retained either way.
    _market_hours_only = os.environ.get("KEEPWARM_MARKET_HOURS_ONLY") == "1"

    def loop():
        while True:
            if (not _market_hours_only) or _ds.in_active_data_window():
                try:
                    req = urllib.request.Request(url, headers={"User-Agent": "uct-worker-keepwarm/1"})
                    with urllib.request.urlopen(req, timeout=20) as r:
                        r.read(64)  # drain a little so the conn closes cleanly
                except Exception as e:
                    log.warning(f"keep-warm ping failed ({url}): {type(e).__name__}: {e}")
            time.sleep(interval)

    log.info(f"starting keep-warm pinger -> {url} every {interval}s")
    threading.Thread(target=loop, daemon=True, name="keepwarm").start()


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
    # Keep Model Book daily/weekly bars permanently warm; the worker's cache is
    # shipped to web via the R2 snapshot, so first-view chart loads are instant.
    try:
        from api.services.modelbook_bars_prewarm import start_async as _mb_bars_start
        _mb_bars_start()
    except Exception as e:
        log.warning(f"Model Book bar warmer start failed (non-fatal): {e}")
    _start_uploader()
    _start_keepwarm()

    port = int(os.environ.get("PORT", "8080"))
    log.info(f"worker HTTP listening on :{port} (healthcheck only)")
    uvicorn.run(_build_app(), host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    main()
