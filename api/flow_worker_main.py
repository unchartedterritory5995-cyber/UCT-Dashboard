"""Dedicated options-flow worker entry point.

Run with: python -m api.flow_worker_main  (Railway: FLOW_WORKER_ENABLED=1)

DEPLOY NOTE (2026-07-17): the flow-worker service is GitHub-triggered on NARROW
watch paths set in the Railway service settings (never railway.json — that file
is shared by all three services): api/{massive_ws_worker,massive_processor,
flow_db,bs_iv,flow_worker_main,live_massive_router,flow_router,worker_main,
flow_heal_enrich,flow_gap_autofill,massive_flatfiles_worker,flow_watchdog,
oi_snapshots,massive_stream,flow_tape_spool,flow_backup,dealer_positioning}.py
+ railway.json + requirements.txt. Keep tools/git-hooks/pre-push's FLOW_WATCHED
list in sync. Until 2026-07-17 the patterns were effectively api/** — ANY web
push bounced the OPRA consumer mid-session (8 deploys / ~13.9k lost prints on
2026-07-16 alone); that is fixed at the source now. A push touching none of the
watched files is SKIPPED ("No changes to watched files"); a change to any other
flow module must touch a watched file (this note's edit history doubles as that
trigger). Flow-worker-touching pushes ship strictly outside Mon-Fri 9:15-16:20 ET
(pre-push hook enforces; UCT_FLOW_OVERRIDE=1 required on top of UCT_PUSH_OVERRIDE
for a true mid-session flow emergency).

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
import time
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
import uvicorn

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(name)s] %(message)s")

# Crash forensics (2026-07-17: three in-place CRASHes — 9:34/10:14/10:26 ET —
# left NO trace in logs). faulthandler catches C-level deaths (segfault/abort);
# threading.excepthook catches uncaught exceptions in worker threads, which
# otherwise print bare to a stderr that Railway's rate limiter was dropping.
import faulthandler
faulthandler.enable()


def _thread_excepthook(args):
    logging.getLogger("flow-worker").critical(
        "UNCAUGHT EXCEPTION in thread %s",
        getattr(args.thread, "name", "?"),
        exc_info=(args.exc_type, args.exc_value, args.exc_traceback),
    )


threading.excepthook = _thread_excepthook
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

    # railway.json (SHARED by web + worker + flow-worker) points healthcheckPath
    # at /api/ready. The flow-worker has no user-facing warm gates, so it is
    # ready as soon as it can answer. Without this route its deploys would fail
    # their healthcheck outright -- and a failed flow-worker deploy costs the
    # OPRA tape a WS handoff, which does not replay.
    @app.get("/api/ready")
    def ready():
        return {"ready": True, "service": "flow-worker", "pending": []}

    # Mount every flow.db / consumer-state router (reuses the reviewed mounter).
    # Dedicated module (2026-07-17) — NOT worker_main.py: importing the mounter
    # from the shared bars-worker entry made a pure-charts change to that file
    # restart the OPRA consumer mid-session. flow_router_mount.py is a
    # flow-worker-only dependency in the watch paths; worker_main.py is dropped.
    from api.flow_router_mount import mount_flow_routers
    mount_flow_routers(app)

    # Thread stack-dump diagnostics (7/14 incident: "which line is the hot
    # thread on" took an hour to infer from /proc; this answers it in one call).
    from api import debug_dump_router
    app.include_router(debug_dump_router.router)

    # Auth-surface audit. THIS pod is the one that matters: the flow surface is
    # proxied, so a gate added on web never reaches this router copy without its
    # own `railway up -s flow-worker`. Reads the mounted route objects only —
    # no request, no handler, no side effect (an anonymous probe would EXECUTE
    # the endpoint in exactly the case it exists to detect).
    #
    # The vouch endpoint mounts FIRST so it can serve whatever the audit finds:
    # web proxies this pod's flow routers to the internet and cannot see their
    # gates (they live here), so it classifies them DELEGATED and comes asking.
    # Answering is what makes that classification a check instead of a mute —
    # a web boot that gets no answer pages.
    try:
        from api.auth_surface_check import build_vouch_router, run_startup_audit
        app.include_router(build_vouch_router())
        run_startup_audit(app, service="flow-worker")
    except Exception as e:
        print(f"[startup] auth-surface audit skipped: {e}")
    return app


def _ensure_flow_indexes():
    """One-time (IF NOT EXISTS) index for the writer's OI stage-2 fallback.

    2026-07-17 write-profile: that stage probed flow with
    WHERE Symbol/CallPut/Strike/ExpirationDate ORDER BY id DESC per event —
    with no matching composite index a MISS scanned the whole table, and it
    was 86.7s of an 88.7s batch. Build takes seconds once at boot; probes
    become index seeks forever after.
    """
    try:
        import sqlite3
        from api.flow_db import FlowDB
        t0 = time.time()
        with sqlite3.connect(FlowDB().db_path, timeout=60) as conn:
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_flow_contract "
                "ON flow(Symbol, CallPut, Strike, ExpirationDate)")
            # Day-scoped index for the cumvol GROUP BY — created here so the
            # INDEXED BY hint in _load_cumulative_volume is guaranteed to
            # resolve (idx_flow_contract's shape otherwise seduces the planner
            # into scanning full symbol histories — the 11-98s/batch regression
            # seen the moment idx_flow_contract appeared on 7/17).
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_flow_created_symbol "
                "ON flow(CreatedDate, Symbol)")
        log.info("flow.db idx_flow_contract + idx_flow_created_symbol "
                 "ensured in %.1fs", time.time() - t0)
    except Exception as e:  # noqa: BLE001
        log.warning("idx_flow_contract create failed (non-fatal): %s", e)


def _start_consumer():
    _ensure_flow_indexes()
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
            from api import flow_tape_spool
            if flow_tape_spool.register_jobs(sched):
                n += 1
                log.info("[startup] tape-spool gap sweeps registered")
        except Exception as e:  # noqa: BLE001
            log.warning("tape-spool sweep scheduling failed: %s", e)
        # Volume watchdog — this is the pod that ran out of disk on 2026-07-23
        # while the only thing watching was the spool's own feature-scoped budget.
        try:
            from api.services import disk_watchdog
            if disk_watchdog.start():
                log.info("[startup] disk_watchdog started (warn=%s%% crit=%s%%)",
                         disk_watchdog.WARN_PCT, disk_watchdog.CRIT_PCT)
        except Exception as e:  # noqa: BLE001
            log.warning("disk_watchdog start failed: %s", e)
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
            # Retention on the LIVE flow.db, which lives here post-cutover.
            #
            # This used to prune by CONTRACT EXPIRY, which deleted a trade the
            # night its contract expired regardless of when it printed — so
            # historical days hollowed out to only their still-unexpired
            # contracts while still being advertised as complete sessions
            # (measured: a January day served 986 of ~96,178 rows). It now drops
            # WHOLE days past FLOW_RETAIN_TRADE_DAYS. Log the day list, not just
            # a row count — a count of 0 cannot distinguish "nothing to do" from
            # "never ran", and this job silently ate the tape for months.
            try:
                from api.flow_db import FlowDB, FLOW_RETAIN_TRADE_DAYS
                res = FlowDB().prune_old_trade_days()
                log.info("[scheduler] flow retention: armed=%s retain=%sd "
                         "cutoff=%s would_remove_days=%d rows=%d backlog=%d kept=%d",
                         res["armed"], FLOW_RETAIN_TRADE_DAYS, res["cutoff"],
                         len(res["days_removed"]), res["pruned"],
                         res["backlog_days"], res["days_kept"])
                if res["days_removed"]:
                    log.info("[scheduler] flow retention %s: %s",
                             "DROPPED" if res["armed"] else "would drop (UNARMED)",
                             ", ".join(res["days_removed"]))
            except Exception as e:  # noqa: BLE001
                log.warning("[scheduler] Flow DB prune error: %s", e)

        try:
            from apscheduler.triggers.cron import CronTrigger
            from zoneinfo import ZoneInfo
            # timezone EXPLICIT: pre-built CronTriggers default to server-local
            # UTC, not the scheduler's ET -- unpinned this fired 4 PM ET.
            sched.add_job(_nightly_flow_prune,
                          trigger=CronTrigger(hour=20, minute=0,
                                              timezone=ZoneInfo("America/New_York")),
                          id="flow_nightly_prune", max_instances=1,
                          replace_existing=True)
            n += 1
        except Exception as e:  # noqa: BLE001
            log.warning("nightly prune scheduling failed: %s", e)

        try:
            # Auto-push scanners — fire Discord alerts on a timer instead of on
            # page views. Before this, _apply_auto_push only ran inside /recent
            # and /by-contract, so no viewer = no push (7/15: laptop asleep all
            # afternoon, nothing fired; a browser opened at 8:06 PM ET then
            # flushed the day's backlog at once). By-Contract was worse:
            # accumulations only fired while that tab was open.
            #
            # MUST run here and ONLY here — web has a SEPARATE pushed.db, so a
            # second scanner there would double-post rather than dedup.
            #
            # Lighter than a browser: the tape polls /recent every 5s (12/min)
            # and By-Contract every 30s; these are 1/min and 0.2/min. If this
            # lets the tab stay closed, total load drops.
            #
            # max_instances=1 + coalesce: a scan slower than its interval must
            # never pile up — that's the read contention that starves the
            # consumer's writes.
            from apscheduler.triggers.interval import IntervalTrigger
            from api.live_massive_router import (auto_push_scan_single,
                                                 auto_push_scan_accum)
            sched.add_job(auto_push_scan_single,
                          trigger=IntervalTrigger(seconds=60),
                          id="auto_push_scan_single", max_instances=1,
                          coalesce=True, replace_existing=True)
            sched.add_job(auto_push_scan_accum,
                          trigger=IntervalTrigger(seconds=300),
                          id="auto_push_scan_accum", max_instances=1,
                          coalesce=True, replace_existing=True)
            n += 1
            log.info("[startup] auto-push scanners registered (single=60s, accum=300s)")
        except Exception as e:  # noqa: BLE001
            log.warning("auto-push scanner scheduling failed: %s", e)

        try:
            # Daily OI snapshot (5:30 AM ET) — captures Schwab live OI for
            # contracts with recent flow (retroactive B-side confirmation). Moved
            # from web at the P5 cutover: flow.db AND the Schwab OPRA consumer +
            # on-demand OI fetch live HERE now, so this cron must too. Gated on
            # Schwab creds being present on this pod (copied at cutover).
            if os.getenv("SCHWAB_APP_KEY"):
                from apscheduler.triggers.cron import CronTrigger as _OICron
                from api.oi_snapshots import daily_snapshot_job, init_db as _init_oi_snapshots
                _init_oi_snapshots()
                try:
                    from api.dealer_positioning import init_db as _init_dealer_positioning
                    _init_dealer_positioning()
                except Exception as _de:  # noqa: BLE001
                    log.warning("dealer_positioning init failed: %s", _de)
                # timezone EXPLICIT (2026-07-16): a pre-built CronTrigger defaults
                # to server-local UTC, not the scheduler's ET — this fired at
                # 1:30 AM ET, where it collided with overnight heal write-locks.
                sched.add_job(daily_snapshot_job,
                              trigger=_OICron(day_of_week="mon-fri", hour=5, minute=30,
                                              timezone=ZoneInfo("America/New_York")),
                              id="oi_snapshot_daily", max_instances=1,
                              replace_existing=True)
                n += 1
                log.info("[startup] OI snapshot 5:30am cron registered on flow-worker")
            else:
                log.info("[startup] OI snapshot cron skipped (SCHWAB_APP_KEY unset)")
        except Exception as e:  # noqa: BLE001
            log.warning("OI snapshot scheduling failed: %s", e)

        try:
            # End-of-day Alpha Gold summary → Discord image. Dark by default;
            # only registers when armed. Runs HERE (owns flow.db + the classifier
            # in-process). timezone EXPLICIT on the trigger (the recurring ET-vs-
            # UTC CronTrigger gotcha above). 16:05 ET so the day's tape is settled.
            #
            # ⚠ DEPLOY GOTCHA: api/alpha_gold_eod.py is NOT in the flow-worker's
            # Railway watch paths — a commit touching ONLY that file is SKIPPED
            # ("No changes to watched files") and the worker keeps the old code.
            # Edits to alpha_gold_eod.py must PIGGYBACK on a watched file (this one
            # / live_massive_router.py) or add it to the worker's watch paths.
            # (alpha_gold_eod.py edits piggyback on this file until it's added to
            # the flow-worker's Railway watch paths, after which this is moot.)
            if os.getenv("ALPHA_GOLD_EOD_ENABLED", "0") == "1":
                from apscheduler.triggers.cron import CronTrigger as _AGCron
                from api import alpha_gold_eod as _age
                sched.add_job(_age.run_eod_summary,
                              trigger=_AGCron(day_of_week="mon-fri", hour=16, minute=5,
                                              timezone=ZoneInfo("America/New_York")),
                              id="alpha_gold_eod_summary", max_instances=1,
                              coalesce=True, replace_existing=True)
                n += 1
                log.info("[startup] Alpha Gold EOD summary cron registered (16:05 ET weekdays)")
            else:
                log.info("[startup] Alpha Gold EOD summary disabled (ALPHA_GOLD_EOD_ENABLED != 1)")
        except Exception as e:  # noqa: BLE001
            log.warning("Alpha Gold EOD scheduling failed: %s", e)
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


def _start_recent_cache_warmer():
    """Keep the /recent snapshot cache HOT in THIS (flow-worker) process — the one
    that actually serves proxied /api/live/massive/recent. Without it the cache is
    cold on every restart and at each new trading day, so the FIRST user per key
    eats the full curated 80K-row scan (10-120s) = the "1-2 min to load on login"
    symptom. (The web service's dashboard warmer fills WEB's cache, which the flow
    read-proxy bypasses — so the warm MUST happen here.)

    Warms the EXACT default keys LiveFlowMassive.jsx requests: /recent (curated
    ON *and* OFF, limit=10000, min_grade=D, sort_by=recent, tier=None), /day-stats
    (the Market Read hero) and /by-contract (the accumulation view) on
    boot/new-day/stale-floor (traffic keeps them warm in between), PLUS
    /worker-history on boot/new-day ONLY (it's polled only every 180s so traffic
    can't keep it warm — a stale-floor re-warm of its 24-45s scan would starve
    the WS writer). /diagnostic is cached but NOT warmed (admin-only, never
    polled). The /recent+day-stats+by-contract group recomputes on a fresh boot,
    a new trading day, or when an entry
    drifts past the stale floor — it idles (near-zero load) when the tape is
    quiet and lets live traffic keep the caches fresh in between. Gated by
    MASSIVE_RECENT_WARM_ENABLED (default on); cadence
    MASSIVE_RECENT_WARM_INTERVAL (default 25s)."""
    if os.environ.get("MASSIVE_RECENT_WARM_ENABLED", "1") != "1":
        log.info("[recent-warmer] disabled (MASSIVE_RECENT_WARM_ENABLED!=1)")
        return
    interval = int(os.environ.get("MASSIVE_RECENT_WARM_INTERVAL", "10"))
    # While a viewer is active, the curated key is re-warmed EVERY cycle (below),
    # so cadence ~= curated-scan-time + interval. Lowered 25->10 so the feed stays
    # ~30s fresh instead of drifting to the 120s stale floor between viewer polls.
    viewer_window = int(os.environ.get("MASSIVE_RECENT_WARM_VIEWER_WINDOW", "90"))
    KEYS = [
        # curated first: it's the DEFAULT view and the expensive one.
        dict(limit=10000, min_grade="D", sort_by="recent", tier=None, curated=True),
        dict(limit=10000, min_grade="D", sort_by="recent", tier=None, curated=False),
    ]

    # Re-warm floor: the warmer's ONLY job is to keep the key non-COLD (present).
    # Freshness for actual viewers comes from the serve-stale background refresh
    # (user traffic) + the SSE stream, so we do NOT re-warm on every new print —
    # that would recompute both 80K scans every cycle all session with zero
    # viewers and compete with the WS writer. We only re-warm on boot / new day /
    # if the entry drifts older than this floor (a cheap freshness guarantee when
    # there is genuinely no traffic). Default 120s.
    stale_floor = int(os.environ.get("MASSIVE_RECENT_WARM_STALE", "120"))
    # Curated re-warm floor WHILE A VIEWER IS ACTIVE. The curated scan is ~70s at
    # mid-day, so re-warming every 10s cycle just ran back-to-back scans — no
    # freshness gain (age can't beat the scan time) but heavy flow-worker load that
    # starved OTHER flow.db reads (the 2026-07-30 /api/flow/data 502s + 1d-stale).
    # Gate on a short floor so the worker idles between scans; freshness is
    # unchanged. The real <30s fix is the incremental scan (deferred, flag-gated).
    curated_floor = int(os.environ.get("MASSIVE_RECENT_WARM_CURATED_FLOOR", "45"))
    # /api/flow/data (Market Read CSV) pre-warm cadence — heavy builds, less
    # time-sensitive than the tape; keeps 1/5/20d non-cold so users never eat a
    # cold build (502) and the uncapped 1d stays current, not the prior-day copy.
    flow_data_interval = int(os.environ.get("MASSIVE_FLOW_DATA_WARM_INTERVAL", "300"))

    def _loop():
        from api import live_massive_router as lmr
        # small settle so flow.db + indexes exist (mirrors _ensure_flow_indexes)
        time.sleep(int(os.environ.get("MASSIVE_RECENT_WARM_DELAY", "8")))
        last_day = None
        last_flow_data_warm = 0.0
        def _stale(entry):
            return entry is None or (time.time() - entry[0]) > stale_floor
        def _curated_stale(entry):
            return entry is None or (time.time() - entry[0]) > curated_floor
        while True:
            try:
                today = lmr._today_mdyyyy()
                new_day = (today != last_day)
                # (1) /recent default keys — the tape, loaded on every page view.
                # CURATED (the default feed, the 2026-07-30 wedge target): while a
                # viewer is active, refresh EVERY cycle via the UNBOUNDED lane
                # (bounded=False) so the shared 2-slot fill semaphore can never
                # starve it — the wedge was user-path fills logging "gave up waiting
                # 20s for a semaphore slot" while the feed served a 6-min-stale
                # snapshot. No viewers → fall back to the cheap 120s stale floor so
                # a quiet session doesn't scan flow.db forever and fight the writer.
                ck = (today, 10000, "D", "recent", None, True)   # the costly curated key
                nc = (today, 10000, "D", "recent", None, False)  # ALL FLOW (SSE keeps it live)
                viewer_active = (time.time() - lmr.last_recent_view_ts()) < viewer_window
                ck_entry = lmr._recent_cache.get(ck)
                # While viewed, re-warm on the SHORT curated floor (idle between the
                # ~70s scans); no viewer, fall back to the 120s stale floor.
                warm_curated = new_day or (_curated_stale(ck_entry) if viewer_active
                                           else _stale(ck_entry))
                if warm_curated:
                    try:
                        lmr.warm_recent(**KEYS[0], bounded=False)
                    except Exception:
                        log.exception("[recent-warmer] curated warm failed")
                if new_day or _stale(lmr._recent_cache.get(nc)):
                    try:
                        lmr.warm_recent(**KEYS[1], bounded=False)
                    except Exception:
                        log.exception("[recent-warmer] non-curated warm failed")
                # (2) /day-stats default key — the Market Read hero, also every page
                # view. Same cold-scan class as /recent (~14s cold). No auto-push,
                # so calling the route directly just fills its 30s cache.
                ds_key = (today, False, "all")
                if new_day or _stale(lmr._day_stats_cache.get(ds_key)):
                    try:
                        lmr.day_stats(target_date=None, exclude_algo=False, stock_etf="all")
                    except Exception:
                        log.exception("[recent-warmer] day-stats warm failed")
                # (3) /by-contract default key — the By-Contract accumulation view
                # (~16s cold). Call the ROUTE (not _build_by_contract) so its
                # accumulation auto-push stays intact — it's dedup-safe (POSTED
                # marks persist in the pushed DB), so warmer-triggered scans never
                # double-fire; they just keep the cache hot + pushes timely.
                bc_key = (today, "all", 3, True, 1)
                if new_day or _stale(lmr._by_contract_cache.get(bc_key)):
                    try:
                        lmr.by_contract(target_date=None, stock_etf="all", min_hits=3,
                                        exclude_algo=True, lookback_days=1)
                    except Exception:
                        log.exception("[recent-warmer] by-contract warm failed")
                # (4) /worker-history — was UNCACHED (24-45s); the frontend status
                # panel polls it every 180s. Warm ONLY on boot / new-day (NOT the
                # stale-floor): traffic can't keep it warm (its 180s poll exceeds
                # the 120s stale floor), so a stale-floor re-warm would recompute
                # this 24-45s scan continuously on the single flow-worker and
                # starve the OPRA WS writer. Its 300s TTL (> the 180s poll) lets
                # polls hit a warm entry between sparse poller-triggered recomputes.
                # (/diagnostic is deliberately NOT warmed — admin-only, never
                # polled by the page; its cache serves the rare hit instead.)
                if new_day:
                    try:
                        lmr.worker_history(target_date=None, min_gap_minutes=2)
                    except Exception:
                        log.exception("[recent-warmer] worker-history warm failed")
                # (5) /api/flow/data (Market Read CSV) default ranges 1/5/20d —
                # pre-build OFF the request path so users never eat a COLD build
                # after a restart (the 2026-07-30 502s) and the uncapped 1d stays
                # CURRENT instead of serving the stale prior-day copy (the 7/29
                # artifact). Reuses the router's own cache+build (no new query
                # logic). Throttled (flow_data_interval) — these are heavy builds.
                if new_day or (time.time() - last_flow_data_warm) > flow_data_interval:
                    try:
                        from api import flow_router as _fr
                        for _d in (1, 5, 20):
                            try:
                                _fr._get_cached_or_build("stocks", _d)
                            except Exception:
                                log.exception("[recent-warmer] flow/data warm failed: days=%s", _d)
                        last_flow_data_warm = time.time()
                    except Exception:
                        log.exception("[recent-warmer] flow/data warm import failed")
                last_day = today
            except Exception:
                log.exception("[recent-warmer] loop error")
            time.sleep(interval)

    threading.Thread(target=_loop, daemon=True, name="recent-warmer").start()
    log.info("[recent-warmer] armed (interval=%ss, viewer_window=%ss; curated "
             "key re-warmed EVERY cycle on the UNBOUNDED lane while viewed; "
             "warms /recent + /day-stats + /by-contract [+ /worker-history on new-day])",
             interval, viewer_window)


def _start_rest_side_heal():
    """Live REST NBBO side-heal for BIG blank-side prints — the Q-pool coverage
    floor. A whale sweep/block whose contract churned out of the 950-cap Q-pool (or
    whose NBBO went stale) lands blank-side -> "Not Clean" -> hidden from the
    directional tiers. This bypasses the Q-pool: for TODAY's recent still-blank
    prints >= MASSIVE_RESTHEAL_PREMIUM, it pulls the consolidated NBBO from Massive
    REST /v3/quotes at the print's stored ns (ts_ns = the cluster's first_ts_ns;
    leg-sum reconstruction only for pre-7/25 rows that lack it) and midpoint-classifies
    the real side (ASK *or* BID) into flow.db. Never guesses — only a fresh book
    yields a side; otherwise the row stays honestly blank.

    Gated by MASSIVE_RESTHEAL_ENABLED (default OFF — ships dark). Cadence
    MASSIVE_RESTHEAL_INTERVAL (default 60s). Idempotent: targets only still-blank
    rows, so a persistently-blank print gets re-tried until it heals or ages out of
    the recency window."""
    if os.environ.get("MASSIVE_RESTHEAL_ENABLED", "0") != "1":
        log.info("[restheal-live] disabled (MASSIVE_RESTHEAL_ENABLED!=1)")
        return
    interval = int(os.environ.get("MASSIVE_RESTHEAL_INTERVAL", "60"))
    sources = [s.strip() for s in
               os.environ.get("MASSIVE_RESTHEAL_SOURCES", "stocks").split(",") if s.strip()]

    def _loop():
        from api import backfill_rest as br
        time.sleep(int(os.environ.get("MASSIVE_RESTHEAL_DELAY", "20")))
        while True:
            try:
                for src in sources:
                    br.run_recent(source=src)
            except Exception:
                log.exception("[restheal-live] cycle failed")
            time.sleep(interval)

    threading.Thread(target=_loop, daemon=True, name="rest-side-heal").start()
    log.info("[restheal-live] armed (interval=%ss, sources=%s, floor=$%s, recency=%smin, "
             "staleness=%ss)",
             interval, sources, os.environ.get("MASSIVE_RESTHEAL_PREMIUM", "1000000"),
             os.environ.get("MASSIVE_RESTHEAL_RECENCY_MIN", "20"),
             os.environ.get("MASSIVE_RESTHEAL_STALENESS_SEC", "120"))


def main():
    # This pod OWNS the consumer + flow.db and serves the flow routers.
    os.environ.setdefault("WORKER_SERVES_FLOW", "1")
    log.info("[startup] flow-worker: consumer + flow routers only (no bars prewarm)")
    _start_consumer()
    _start_recent_cache_warmer()  # keep /recent snapshot cache hot (cold-load fix)
    _start_rest_side_heal()  # recover sides for big blank whales via REST NBBO (dark)
    _sched = _start_flow_schedulers()  # noqa: F841 - held alive for process lifetime
    app = _build_app()
    port = int(os.environ.get("PORT", "8080"))
    # timeout_graceful_shutdown=5 mirrors web/worker: reach lifespan.shutdown ->
    # consumer stop() within Railway's 30s drain instead of a SIGKILL.
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info",
                timeout_graceful_shutdown=5)


if __name__ == "__main__":
    main()
