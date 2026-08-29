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
import asyncio
import threading
import time
import logging
from contextlib import asynccontextmanager

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
    # SUPERVISED: run_prewarmer_supervised restarts the loop (bounded backoff) if it
    # ever exits/raises, so warming can't stop permanently from a single unhandled
    # error the way it did for a week on 2026-08-11. The loop body is itself guarded.
    from api.services.bars_prewarm import run_prewarmer_supervised
    log.info("starting prewarmer thread (supervised)")
    threading.Thread(target=run_prewarmer_supervised, daemon=True, name="prewarm").start()


def _start_universe_crawler():
    # GENTLE universe 5m warm (instant-origin Phase 2 v2). Single-threaded, rate-limited,
    # skip-fresh — the anti-thrash replacement for the boot-bulk approach that saturated
    # the provider + write-lock on 2026-08-19. Supervised; no-ops unless
    # BARS_UNIVERSE_CRAWLER_ENABLED=1. See bars_universe_crawler.py header.
    from api.services.bars_universe_crawler import run_universe_crawler_supervised
    log.info("starting universe-5m-crawler thread (supervised)")
    threading.Thread(target=run_universe_crawler_supervised, daemon=True, name="uni-crawler").start()


def _start_deep_history_warm():
    """One-time deep D/W/M history warm for the whole universe (flag-gated,
    worker-only). Runs in its own daemon thread so it never blocks boot; no-ops
    unless DEEP_HISTORY_WARM_ENABLED=1 and the done-marker is absent."""
    from api.services.deep_history_warm import deep_warm_history_once
    log.info("starting deep-history-warm thread")
    threading.Thread(target=deep_warm_history_once, daemon=True, name="deep-warm").start()


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


def _start_breadth_backfill():
    """Deep breadth-history recompute — runs HERE (worker), not on the web pod.

    The close-basis recompute is a multi-minute CPU sweep that starves the web
    pod's single shared event loop → Railway health-check kill (proven 3×, incl.
    a 502 mid-sweep after a memory rewrite). The worker has no user event loop to
    starve, so it grinds the history here and ships the tiny resulting DB to R2;
    the web pod gap-fill-merges it (breadth_ohlc_sync) and serves it — never
    running the recompute itself.

    ONE bounded chunk per tick via the already-restart-safe backfill_tick + its
    durable floor marker; uploads after any chunk that wrote rows; idles when the
    marker is absent. Gated by BREADTH_HISTORY_BACKFILL_ENABLED (default OFF).
    Design: docs/superpowers/specs/2026-08-11-breadth-deep-history-worker-bridge-design.md
    """
    if os.environ.get("BREADTH_HISTORY_BACKFILL_ENABLED") != "1":
        log.info("breadth history backfill not started (BREADTH_HISTORY_BACKFILL_ENABLED=0)")
        return

    chunk_days = int(os.environ.get("BREADTH_BACKFILL_CHUNK_DAYS", "365"))
    pause = int(os.environ.get("BREADTH_BACKFILL_PAUSE_SECS", "90"))
    idle = int(os.environ.get("BREADTH_BACKFILL_IDLE_SECS", "300"))

    def loop():
        import gc
        from api.services import breadth_history_recon as recon
        from api.services import breadth_ohlc_sync as sync
        # Arm from env when there's no durable floor marker yet. The worker has its
        # OWN /data volume, so the web /history/backfill-schedule endpoint (which
        # writes the marker on the WEB volume) can't reach this thread — env is the
        # clean cross-pod arming channel. Safe to re-seed after completion: once
        # coverage reaches the floor, backfill_tick clears the marker and a re-seed
        # just re-checks and immediately completes as a no-op. To STOP mid-grind,
        # set BREADTH_HISTORY_BACKFILL_ENABLED=0 (this thread then never starts).
        env_floor = os.environ.get("BREADTH_BACKFILL_FLOOR")
        if env_floor and recon.get_backfill_floor() != env_floor:
            # env is AUTHORITATIVE: re-assert the target floor on every boot, so
            # deepening the grind (e.g. 2023-10 -> 2008) is just an env change +
            # redeploy. Idempotent — coverage is tracked in the OHLC store, so a
            # completed grind re-checks and clears again in one cheap no-op tick.
            recon.set_backfill_floor(env_floor)
            log.info(f"breadth backfill floor set from BREADTH_BACKFILL_FLOOR={env_floor}")
        while True:
            slept = idle
            try:
                res = recon.backfill_tick(chunk_days=chunk_days) or {}
                if res.get("idle") or res.get("complete"):
                    slept = idle                       # floor absent or reached → idle-poll
                elif res.get("busy"):
                    slept = pause
                elif res.get("ok"):
                    wrote = int(res.get("rows") or 0)
                    log.info(f"breadth backfill tick: {res}")
                    if wrote:
                        gc.collect()                   # return the frame's memory before we ship
                        up = sync.upload(force=True)
                        log.info(f"breadth ohlc upload after tick ({wrote} rows): {up}")
                        slept = pause                  # short pause, then the next chunk
                    else:
                        slept = idle                   # nothing written (e.g. empty chunk) → back off
                else:
                    log.warning(f"breadth backfill tick returned error: {res}")
                    slept = idle
            except Exception as e:
                log.exception(f"breadth backfill tick error (non-fatal): {e}")
                slept = idle
            time.sleep(slept)

    log.info(f"starting breadth history backfill thread (chunk={chunk_days}d pause={pause}s)")
    threading.Thread(target=loop, daemon=True, name="breadth_backfill").start()


def _start_wick_backfill():
    """Phase-3 wick grind (WORKER): reconstruct real intraday high/low for past days
    from Massive stocks minute flat files and ship them via the R2 bridge (they upgrade
    the body-only close_recon candles to true wicks; never overwrite real 'live' rows).
    Runs the env-configured range once, then idles. Gated by BREADTH_WICKS_ENABLED=1 +
    BREADTH_WICKS_FROM/TO (YYYY-MM-DD). Resumable — days already carrying intraday_recon
    are skipped. Design: docs/superpowers/specs/2026-08-11-breadth-historical-wicks-phase3-design.md
    """
    if os.environ.get("BREADTH_WICKS_ENABLED") != "1":
        log.info("breadth wick backfill not started (BREADTH_WICKS_ENABLED=0)")
        return
    frm = os.environ.get("BREADTH_WICKS_FROM")
    to = os.environ.get("BREADTH_WICKS_TO")
    if not (frm and to):
        log.info("breadth wick backfill: set BREADTH_WICKS_FROM/TO to run; idle")
        return
    upload_every = int(os.environ.get("BREADTH_WICKS_UPLOAD_EVERY", "10"))
    # RESWEEP=1 forces re-processing days that already carry intraday_recon — needed
    # to propagate a method CORRECTION (e.g. the seeded-open wick fix) over old rows.
    skip_done = os.environ.get("BREADTH_WICKS_RESWEEP") != "1"

    def run():
        time.sleep(30)                              # let boot settle
        from api.services import breadth_wick_recon as wr
        log.info(f"breadth wick sweep starting {frm}..{to} "
                 f"(upload_every={upload_every}, skip_done={skip_done})")
        try:
            res = wr.sweep_wicks(frm, to, upload_every=upload_every, skip_done=skip_done)
            log.info(f"breadth wick sweep DONE: {res}")
        except Exception as e:
            log.exception(f"breadth wick sweep failed: {e}")

    threading.Thread(target=run, daemon=True, name="wick_backfill").start()
    log.info(f"breadth wick backfill armed: {frm}..{to}")


def _probe_flatfile_access():
    """One-shot boot diagnostic: can THIS (worker) pod read Massive STOCKS flat files?
    Phase-3 wick reconstruction needs us_stocks_sip minute aggs; the web pod + local
    both 403. Isolated from the Options Flow system — just a HEAD. Logs the result for
    a recent stocks + options key so we can settle whether the worker's origin has
    flat-file access (unblocks Phase 3 without any Massive change if so)."""
    try:
        import os as _os, boto3
        from datetime import date as _date, timedelta as _td
        ak = _os.environ.get("MASSIVE_S3_ACCESS_KEY")
        sk = _os.environ.get("MASSIVE_S3_SECRET")
        ep = _os.environ.get("MASSIVE_S3_ENDPOINT") or "https://files.massive.com"
        bk = _os.environ.get("MASSIVE_S3_BUCKET") or "flatfiles"
        if not (ak and sk):
            log.info("[flatfile-probe] MASSIVE_S3 creds not set"); return
        cl = boto3.client("s3", region_name="us-east-1", aws_access_key_id=ak,
                          aws_secret_access_key=sk, endpoint_url=ep)
        d = _date.today() - _td(days=3)          # T-3, safely published
        while d.weekday() >= 5:
            d -= _td(days=1)
        ds = d.strftime("%Y/%m/%Y-%m-%d")
        log.info(f"[flatfile-probe] endpoint={ep} bucket={bk} date={ds}")
        for lbl, key in (("stocks", f"us_stocks_sip/minute_aggs_v1/{ds}.csv.gz"),
                         ("options", f"us_options_opra/trades_v1/{ds}.csv.gz")):
            try:
                h = cl.head_object(Bucket=bk, Key=key)
                log.info(f"[flatfile-probe] {lbl} HEAD OK bytes={h.get('ContentLength')}")
            except Exception as e:
                log.info(f"[flatfile-probe] {lbl} HEAD FAIL {type(e).__name__}: {str(e)[:130]}")
    except Exception as e:
        log.warning(f"[flatfile-probe] failed: {e}")


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


# ── Bars freshness watchdog: catch a frozen store + a dead prewarmer ─────────
# The one failure mode the existing (web-side, intraday-only) watchdog is blind to:
# the worker's own DAILY store frozen because the prewarmer thread died. This runs
# ON THE WORKER, checks the prewarmer heartbeat + a direct daily-freshness sample,
# and pages Discord (the existing alert channel) — the delivery the in-memory
# chart_health_alerts deque never had.
BARS_FRESHNESS_CHECK_SECONDS = int(os.environ.get("BARS_FRESHNESS_CHECK_SECONDS", "900"))
BARS_FRESHNESS_RENAG_SECONDS = int(os.environ.get("BARS_FRESHNESS_RENAG_SECONDS", "1800"))


def _prewarm_health() -> dict:
    try:
        from api.services.bars_prewarm import prewarm_heartbeat
        return prewarm_heartbeat()
    except Exception as e:
        return {"error": str(e)[:120]}


def _universe_crawler_health() -> dict:
    try:
        from api.services.bars_universe_crawler import crawler_heartbeat
        return crawler_heartbeat()
    except Exception as e:
        return {"error": str(e)[:120]}


def _bars_daily_health() -> dict:
    try:
        from api.services.bars_prewarm import daily_freshness_report
        return daily_freshness_report()
    except Exception as e:
        return {"error": str(e)[:120]}


def _bars_freshness_decision(prev, healthy, now, *, renag_s=BARS_FRESHNESS_RENAG_SECONDS):
    """Pure state machine for the freshness watchdog. prev/return:
    {"bad": bool, "last_alert_at": float|None}; event ∈ {None,'stale','still_stale','recovered'}."""
    bad = prev.get("bad", False)
    last = prev.get("last_alert_at")
    event = None
    if not healthy and not bad:
        bad, event, last = True, "stale", now
    elif healthy and bad:
        bad, event, last = False, "recovered", now
    elif not healthy and bad and (last is None or now - last >= renag_s):
        event, last = "still_stale", now
    return {"bad": bad, "last_alert_at": last}, event


def _bars_alert_text(event, hb, fr):
    """Render the page.

    ⛔ THE REMEDY USED TO BE UNCONDITIONAL, AND IT WAS THE BUG. Every alert ended
    "Warming has stopped; a worker redeploy revives it." — but the most common way
    to see this alert is DURING the boot pass, and a redeploy restarts that pass
    from zero. On 2026-08-18 that advice, followed, would have looped forever.
    The tail is now derived from what the prewarmer is actually doing.
    """
    if event == "recovered":
        return (f"🟢 **Bars store recovered** — prewarmer alive, daily fresh "
                f"(newest {fr.get('newest_session')}, expected {fr.get('expected_session')}).")
    head = "🔴 **Bars store STALE**" if event == "stale" else "🔴 **Bars store STILL stale**"
    reasons = []
    if not hb.get("alive"):
        age = hb.get("age_seconds")
        reasons.append(f"prewarmer DEAD (last beat {int(age)}s ago)" if age else "prewarmer never started")
    if fr.get("stale"):
        reasons.append(f"daily {fr.get('days_behind')}d behind "
                       f"(newest {fr.get('newest_session')} vs expected {fr.get('expected_session')})")
    if hb.get("last_error"):
        reasons.append(f"last error: {hb.get('last_error')}")

    if hb.get("phase") == "disabled":
        tail = ("The prewarmer is DISABLED (BARS_PREWARM_ENABLED != 1) — "
                "no redeploy can start it; set the flag.")
    elif not hb.get("alive"):
        tail = "Warming has stopped; a worker redeploy revives it."
    elif hb.get("phase") == "boot":
        tail = (f"Warming is RUNNING — boot pass {hb.get('boot_done')}/{hb.get('boot_total')}; "
                f"a redeploy would restart that pass from zero, so let it finish.")
    else:
        tail = "Warming is running; the store should catch up on the next refresh cycle."
    return f"{head} — " + "; ".join(reasons or ["unknown"]) + ". " + tail


def _start_bars_freshness_watchdog():
    """Daemon: page Discord when the worker's daily store goes stale or its
    prewarmer dies. Disable with BARS_FRESHNESS_WATCHDOG_ENABLED=0."""
    if os.environ.get("BARS_FRESHNESS_WATCHDOG_ENABLED", "1") != "1":
        return
    webhook = os.environ.get("DISCORD_WEBHOOK_URL")

    def _loop():
        state = {"bad": False, "last_alert_at": None}
        time.sleep(600)  # let the boot warm establish a heartbeat first
        while True:
            try:
                hb = _prewarm_health()
                fr = _bars_daily_health()
                healthy = bool(hb.get("alive")) and not fr.get("stale")
                state, event = _bars_freshness_decision(state, healthy, time.time())
                if event:
                    msg = _bars_alert_text(event, hb, fr)
                    log.warning(f"[bars-watchdog] {event}: {msg}")
                    if webhook:
                        _post_discord(webhook, msg)
            except Exception as e:
                log.warning(f"[bars-watchdog] check failed (non-fatal): {e}")
            time.sleep(BARS_FRESHNESS_CHECK_SECONDS)

    threading.Thread(target=_loop, daemon=True, name="bars-freshness-watchdog").start()
    log.info("[bars-watchdog] started (check=%ss, renag=%ss, discord=%s)",
             BARS_FRESHNESS_CHECK_SECONDS, BARS_FRESHNESS_RENAG_SECONDS, bool(webhook))


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


@asynccontextmanager
async def _worker_lifespan(app):
    """Worker app lifespan. On SIGTERM shutdown, gracefully stop the OPRA
    consumer so the Massive slot is released with a clean close frame (the P1
    contract) — required for a zero-gap handoff once P5 moves the consumer here.
    Mirrors main.py's teardown: defensive getattr, idempotent, and a safe no-op
    before cutover (the worker's consumer isn't connected while MASSIVE_WS_ENABLED=0)."""
    yield
    try:
        from api import massive_ws_worker
        stop = getattr(massive_ws_worker, "stop", None)
        if callable(stop):
            await asyncio.to_thread(stop)
            logging.getLogger("uvicorn.error").info("[worker] OPRA consumer stop() complete")
    except Exception as e:  # noqa: BLE001
        logging.getLogger("uvicorn.error").warning("[worker] consumer stop failed: %s", e)


def _build_app() -> FastAPI:
    app = FastAPI(title="UCT Worker", docs_url=None, redoc_url=None,
                  lifespan=_worker_lifespan)

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
            # PREWARMER liveness + DAILY store freshness — the signals whose absence
            # let the 2026-08-11 week-long freeze go undetected. `prewarm.alive`
            # false or `bars_daily.stale` true means warming has stopped.
            "prewarm": _prewarm_health(),
            "bars_daily": _bars_daily_health(),
            "universe_crawler": _universe_crawler_health(),
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

    # ⚰️ This said "railway.json (SHARED by web + worker + flow-worker) points
    # healthcheckPath at /api/ready". It does NOT, and must not: gating the
    # healthcheck on readiness caused a ~3 min site outage on 2026-07-26 (see
    # api/services/readiness.py). The shared healthcheckPath is /api/health,
    # which this app answers above. Route kept anyway — it costs nothing, it
    # keeps the three entrypoints symmetric, and it means a future
    # healthcheckPath change cannot fail THIS service for a missing route.
    @app.get("/api/ready")
    def ready():
        return {"ready": True, "service": "worker", "pending": []}

    # P5 (dark): once this worker owns the Massive consumer + flow.db, serve the
    # flow-family read/upload endpoints locally so web can reverse-proxy them.
    # Gated (WORKER_SERVES_FLOW=1) + lazy-imported so the worker's boot path is
    # UNCHANGED until cutover (honors "nothing slow before uvicorn"). /api/live
    # (Bullflow) is intentionally NOT mounted here — that consumer stays on web.
    if os.environ.get("WORKER_SERVES_FLOW", "0") == "1":
        from api.flow_router_mount import mount_flow_routers
        mount_flow_routers(app)

    return app


# _mount_flow_routers moved to api/flow_router_mount.py (2026-07-17) so
# flow_worker_main.py imports the mounter from a flow-worker-only file instead
# of this shared bars-worker entry point (which was causing false mid-session
# flow-worker redeploys). Thin re-export kept for any external caller.
from api.flow_router_mount import mount_flow_routers as _mount_flow_routers  # noqa: E402,F401


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

    # Volume watchdog (see api/services/disk_watchdog.py). This pod holds the
    # 12GB bars.db plus the bars_cache trees, so it has the most room to run away.
    try:
        from api.services import disk_watchdog
        if disk_watchdog.start():
            log.info("disk_watchdog started (warn=%s%% crit=%s%%)",
                     disk_watchdog.WARN_PCT, disk_watchdog.CRIT_PCT)
    except Exception as e:
        log.warning(f"disk_watchdog start failed: {e}")

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
    _start_universe_crawler()
    _start_bars_freshness_watchdog()
    _start_deep_history_warm()
    _start_massive_ws()
    _start_keepwarm()
    # Live-flow outage monitor + daily scorecard (deploy-survival P3).
    # Independent oracle: watches the WEB pod's OPRA write freshness from
    # this separate process/volume. Gated by LIVEFLOW_MONITOR_ENABLED=1 +
    # a Discord webhook. Daemon thread; nothing slow before uvicorn.
    try:
        from api.services.liveflow_monitor import start_liveflow_monitor
        start_liveflow_monitor()
    except Exception as e:
        log.warning(f"liveflow monitor failed to start (non-fatal): {e}")
    _start_breadth_backfill()
    _probe_flatfile_access()
    _start_wick_backfill()
    _start_memwatch()
    # Universe Bars Pack builder — once/ET-day, repackages local bars.db D/W/M
    # into a static R2 artifact so browsers pre-seed IndexedDB for instant
    # first-view charts. Dark until BARSPACK_ENABLED=1; zero provider cost.
    try:
        from api.services.barspack import start_barspack_builder
        start_barspack_builder()
    except Exception as e:
        log.warning(f"barspack builder failed to start (non-fatal): {e}")

    # Intraday Bars Pack builder (Phase 4) — packs PRIOR CLOSED 5m/60m sessions for
    # the universe so intraday scroll-back is instant too; today's session rides the
    # live feed. Dark until INTRADAYPACK_ENABLED=1; zero provider cost.
    try:
        from api.services.intradaypack import start_intradaypack_builder
        start_intradaypack_builder()
    except Exception as e:
        log.warning(f"intradaypack builder failed to start (non-fatal): {e}")

    # Boot fingerprint — one grep-able line so an operator can confirm which
    # data-integrity guards are live in this worker deploy (mirrors the web's
    # "[startup] chart-realtime-mode:" line). The R2 upload integrity gate
    # (data_sync._assert_shippable_db) is THE guard that stops a corrupt/empty
    # worker DB from poisoning the fleet's snapshot (2026-07-03 outage class);
    # log its floor so "is the gate active + at what threshold" is answerable
    # from the worker log alone.
    try:
        from api.services import data_sync as _ds_fp
        log.info(
            "worker-integrity: r2_upload_gate=on "
            f"snapshot_min_ohlcv_rows={_ds_fp.SNAPSHOT_MIN_OHLCV_ROWS} "
            "weekly_key_purge=on(boot,blocking) delta_gate=on"
        )
    except Exception as e:
        log.warning(f"worker-integrity fingerprint failed (non-fatal): {e}")

    port = int(os.environ.get("PORT", "8080"))
    log.info(f"worker HTTP listening on :{port} (healthcheck only)")
    # timeout_graceful_shutdown=5 mirrors the web branch's --timeout-graceful-shutdown 5:
    # bounds in-flight (proxied flow) requests so uvicorn reaches lifespan.shutdown ->
    # massive_ws_worker.stop() (clean OPRA slot release) within Railway's 30s drain,
    # instead of a SIGKILL that skips the clean close and gaps the next consumer.
    uvicorn.run(_build_app(), host="0.0.0.0", port=port, log_level="info",
                timeout_graceful_shutdown=5)


if __name__ == "__main__":
    main()
