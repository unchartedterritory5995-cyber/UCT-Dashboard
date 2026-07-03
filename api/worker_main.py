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


def _process_rss_mb():
    """Current resident-set memory in MB, or None if unavailable (non-Linux).

    Same /proc read as api.main._process_rss_mb (duplicated — worker_main
    must not import api.main, which builds the whole web app at import).
    Added for the 2026-06-10 worker SIGSEGV incident: Railway metrics showed
    3-23 GB RSS sawtooth during prewarm with the crash at the pass tail, and
    MALLOC_ARENA_MAX=2 did NOT shrink it — so the [mem] log line below exists
    to correlate RSS against prewarm progress and name the allocation phase."""
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return round(int(line.split()[1]) / 1024, 1)  # kB -> MB
    except Exception:
        pass
    return None


def _start_memwatch():
    """Log RSS + thread count every 60s so log timestamps line up with
    [prewarm] progress lines and the uploader's snapshot/delta lines."""
    def loop():
        while True:
            rss = _process_rss_mb()
            if rss is not None:
                log.info(f"[mem] rss_mb={rss} threads={threading.active_count()}")
            time.sleep(60)

    threading.Thread(target=loop, daemon=True, name="memwatch").start()


def _start_prewarmer():
    from api.services.bars_prewarm import run_prewarmer_forever
    log.info("starting prewarmer thread")
    threading.Thread(target=run_prewarmer_forever, daemon=True, name="prewarm").start()


def _start_massive_ws():
    """Start the Massive WebSocket flow consumer thread.

    Massive enforces ONE concurrent WS connection per account (see comment
    in api.main lifespan). As of 2026-07-01 this moved from api.main's
    FastAPI lifespan to this worker entry point so that main.py edits
    (which restart the web service on every backend push once watch paths
    are cleared) no longer interrupt live flow ingest.

    Gated by MASSIVE_WS_ENABLED env var inside massive_ws_worker.start().
    REQUIRED: set MASSIVE_WS_ENABLED=0 on the WEB service before deploying
    this change. Otherwise both pods race for the single Massive connection
    and one kicks the other off in a loop.
    """
    try:
        from api.massive_ws_worker import start as _ws_start
        if _ws_start():
            log.info("Massive WS consumer started")
        else:
            log.info("Massive WS consumer not started (MASSIVE_WS_ENABLED=0 or no MASSIVE_API_KEY)")
    except Exception as e:
        log.exception(f"Massive WS consumer failed to start (non-fatal): {e}")


def _start_uploader():
    """Push a snapshot to R2 every SNAPSHOT_INTERVAL_SECONDS."""
    from api.services import data_sync

    # In delta mode the worker ships ONE full base per ET calendar day (cold-
    # start seed + drift backstop) and a tiny windowed delta every other cycle.
    # Seeded from a volume marker so restarts/redeploys within the same ET
    # day don't re-build + re-ship the multi-GB base — on busy deploy nights
    # the in-process-only tracker re-uploaded a ~2.4 GB base per push.
    _last_base_day = {"d": data_sync.get_last_base_day()}
    if _last_base_day["d"]:
        log.info(f"base snapshot already shipped for {_last_base_day['d']} (marker)")

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
                            data_sync.set_last_base_day(today)
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


# ── Down-alert: the worker watches the public site and pings the owner ───────
# The keep-warm loop already hits https://uctintelligence.com/api/health every
# ~60s from a SEPARATE always-on process (the worker). That's the ideal probe:
# it goes through Cloudflare (catches 502/524 origin failures) and keeps working
# even when the web pod is dead. We turn that probe into a down-alert: fire a
# Discord ping on DOWN (after N consecutive failures, to ignore blips) and again
# on recovery, with a re-nag cooldown while it stays down. Pure decision fn below
# is unit-tested. (2026-07-01)
DOWN_ALERT_FAILS = 2            # consecutive bad probes before declaring DOWN
DOWN_ALERT_RENAG_SECONDS = 1800  # re-nag every 30 min while still down
DOWN_ALERT_SLOW_MS = 12000      # a 200 slower than this counts as a (soft) failure


def _down_alert_decision(prev, ok, now, *, down_after=DOWN_ALERT_FAILS,
                         renag_s=DOWN_ALERT_RENAG_SECONDS):
    """Pure state machine for the down-alert.

    prev/return state: {"fails": int, "down": bool, "last_alert_at": float|None}.
    Returns (new_state, event) where event ∈ {None, "down", "still_down", "up"}.
    """
    fails = 0 if ok else prev.get("fails", 0) + 1
    down = prev.get("down", False)
    last = prev.get("last_alert_at")
    event = None
    if not down and fails >= down_after:
        down, event, last = True, "down", now
    elif down and ok:
        down, event, last = False, "up", now
    elif down and not ok and (last is None or now - last >= renag_s):
        event, last = "still_down", now
    return {"fails": fails, "down": down, "last_alert_at": last}, event


def _post_discord(webhook, content):
    """Best-effort Discord webhook post. Never raises."""
    try:
        import json as _json
        import urllib.request as _u
        data = _json.dumps({"content": content}).encode()
        req = _u.Request(webhook, data=data,
                         headers={"Content-Type": "application/json",
                                  "User-Agent": "uct-worker-alert/1"})
        with _u.urlopen(req, timeout=10) as r:
            r.read(64)
        return True
    except Exception as e:
        log.warning(f"down-alert Discord post failed: {type(e).__name__}: {e}")
        return False


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

    # Down-alert config: reuse the same probe to notify the owner via Discord.
    _alert_webhook = os.environ.get("DISCORD_WEBHOOK_URL")
    _alert_enabled = bool(_alert_webhook) and os.environ.get("DOWN_ALERT_ENABLED", "1") == "1"
    _alert_site = base  # public URL the user actually visits
    _alert_state = {"fails": 0, "down": False, "last_alert_at": None}
    if _alert_enabled:
        log.info(f"down-alert enabled -> Discord (site {_alert_site})")

    def _probe():
        """Return (ok, detail). ok=False on exception, non-200, or slow response."""
        start = time.monotonic()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "uct-worker-keepwarm/1"})
            with urllib.request.urlopen(req, timeout=20) as r:
                status = getattr(r, "status", 200)
                r.read(64)  # drain a little so the conn closes cleanly
            elapsed_ms = int((time.monotonic() - start) * 1000)
            if status != 200:
                return False, f"HTTP {status} in {elapsed_ms}ms"
            if elapsed_ms > DOWN_ALERT_SLOW_MS:
                return False, f"slow: {elapsed_ms}ms (>{DOWN_ALERT_SLOW_MS}ms)"
            return True, f"{elapsed_ms}ms"
        except Exception as e:
            return False, f"{type(e).__name__}: {e}"

    def loop():
        while True:
            if (not _market_hours_only) or _ds.in_active_data_window():
                ok, detail = _probe()
                if not ok:
                    log.warning(f"keep-warm ping failed ({url}): {detail}")
                if _alert_enabled:
                    new_state, event = _down_alert_decision(_alert_state, ok, time.time())
                    _alert_state.update(new_state)
                    if event == "down":
                        _post_discord(_alert_webhook,
                                      f"🔴 **UCT Intelligence is DOWN** — {_alert_site} is not responding "
                                      f"({detail}). I'll ping again when it recovers.")
                    elif event == "still_down":
                        _post_discord(_alert_webhook,
                                      f"🔴 Still down — {_alert_site} ({detail}).")
                    elif event == "up":
                        _post_discord(_alert_webhook,
                                      f"🟢 **Recovered** — {_alert_site} is back up ({detail}).")
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
            # Pod resource observability (2026-06-10 SIGSEGV incident).
            "thread_count": threading.active_count(),
            "rss_mb": _process_rss_mb(),
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

    # Purge stale Monday-keyed weekly rows (content-based, idempotent).
    # CRITICAL that this runs on the worker and not only in api.main's
    # lifespan: the worker's bars.db is the R2 snapshot source of truth — the
    # 2026-07-02 duplicate-weekly-candle incident happened because the
    # web-only one-shot heal never touched this DB, and every snapshot
    # re-poisoned the web pod.
    #
    # It MUST NOT run inline before uvicorn: the DISTINCT scan has no
    # tf-leading index and takes minutes on the worker's multi-GB ohlcv
    # table, so an inline purge kept /api/health from ever coming up and
    # Railway's 600s healthcheck FAILED every worker deploy (2026-07-02).
    # Background thread instead — and the uploader starts from the SAME
    # thread, after the purge, so no R2 snapshot is ever taken while the
    # stale Monday rows are still present.
    def _purge_then_start_uploader():
        # Intentionally the SYNC purge, NOT purge_mis_keyed_weekly_rows_async().
        # bars_sqlite's docstring says boot callers "MUST use the _async variant" —
        # that contract is for INLINE/main-thread callers (it keeps the healthcheck
        # unblocked). Here we are ALREADY on a dedicated daemon thread, and we need
        # the call to BLOCK so _start_uploader() runs strictly AFTER the purge. The
        # _async variant returns immediately, which would start the uploader before
        # the purge finished and re-open the 2026-07-02 snapshot-poisoning window.
        # Do NOT "fix" this to _async.
        try:
            _wk = _bs.purge_mis_keyed_weekly_rows()
            log.info(f"weekly key purge: removed {_wk} mis-keyed weekly rows")
        except Exception as e:
            log.warning(f"weekly key purge failed (non-fatal): {e}")
        _start_uploader()

    threading.Thread(
        target=_purge_then_start_uploader, name="weekly-purge", daemon=True
    ).start()

    _start_prewarmer()
    _start_massive_ws()
    _start_keepwarm()
    _start_memwatch()

    port = int(os.environ.get("PORT", "8080"))
    log.info(f"worker HTTP listening on :{port} (healthcheck only)")
    uvicorn.run(_build_app(), host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    main()
