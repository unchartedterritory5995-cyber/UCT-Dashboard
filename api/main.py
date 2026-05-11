import os
import json
import logging
import threading
from contextlib import asynccontextmanager
from datetime import datetime
from zoneinfo import ZoneInfo

# Configure logging early — before any service imports — so that INFO messages
# from api.services.* loggers (bar_stream, realtime_stream, etc.) reach stdout.
# Default Python root logger is WARNING, which silently drops INFO and we lose
# operational visibility on background services. force=True overrides any prior
# config (e.g. an early-import that called basicConfig with defaults).
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    force=True,
)
# Quiet down third-party libs that flood INFO with request-level noise.
for _noisy in ("httpx", "httpcore", "websockets.client", "websockets.server",
               "websockets.protocol", "asyncio", "uvicorn.access"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
import sentry_sdk
from api.limiter import limiter
from api.routers import snapshot, movers, engine_data, earnings, news, screener, trades, traders, push, charts, calendar as calendar_router, bars as bars_router
from api.routers import cot as cot_router
from api.routers import live_prices as live_prices_router
from api.routers import breadth_monitor as breadth_monitor_router
from api.routers import theme_performance as theme_performance_router
from api.services import cot_service as _cot_service
from api.top_flow_router import router as top_flow_router
from api import top_flow_tracker as _top_flow_tracker
from api.schwab_router import router as schwab_router
from api.routers import insider as insider_router
from api.routers import auth as auth_router
from api.routers import avatar as avatar_router
from api.routers import webhooks as webhooks_router
from api.routers import alerts as alerts_router
from api.routers import journal_two as journal_two_router
from api.routers import watchlists as watchlists_router
from api.routers import ticker_tags as ticker_tags_router
from api.routers import watchlist_alerts as watchlist_alerts_router
from api.routers import stream as stream_router
from api.routers import community as community_router
from api.routers import rs_ranking as rs_ranking_router
from api.routers import intelligence as intelligence_router
from api.routers import transcripts as transcripts_router
from api.routers import voice as voice_router
from api.routers import admin_chart_health as admin_chart_health_router
from api.routers import chart_news as chart_news_router
from api.routers import indicator_alerts as indicator_alerts_router
from api.routers import backtest as backtest_router
from api.flow_router import flow_router
from api.services.auth_db import init_db as _init_auth_db
from api.services.voice_audio_cache import purge_expired as _voice_cache_purge
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse as StarletteJSONResponse
from api.gex_router import router as gex_router
from api.watchlist_router import router as watchlist_router
from api import watchlist_tracker as _watchlist_tracker

_SENTRY_DSN = os.environ.get("SENTRY_DSN")

# ── Maintenance mode ────────────────────────────────────────────────────────
_MAINTENANCE_MODE = False


class MaintenanceMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        global _MAINTENANCE_MODE
        if _MAINTENANCE_MODE and not request.url.path.startswith("/api/auth") and request.url.path != "/api/maintenance":
            return StarletteJSONResponse(
                status_code=503,
                content={"detail": "Under maintenance", "maintenance": True},
            )
        return await call_next(request)
if _SENTRY_DSN:
    sentry_sdk.init(
        dsn=_SENTRY_DSN,
        traces_sample_rate=0.1,
        environment=os.environ.get("RAILWAY_ENVIRONMENT", "development"),
    )

PERSISTENT_WIRE_DATA_FILE = "/data/wire_data.json"

def _cot_seed_background():
    try:
        n = _cot_service.seed_from_historical()
        print(f"[startup] COT initial seed complete — {n} records inserted")
    except Exception as e:
        print(f"[startup] COT seed failed: {e}")


def _cot_catchup_background():
    """Run if we missed the Friday 3:45 PM scheduled refresh (e.g. Railway redeployed after it)."""
    try:
        n = _cot_service.refresh_from_current()
        print(f"[startup] COT catch-up refresh complete — {n} records upserted")
    except Exception as e:
        print(f"[startup] COT catch-up refresh failed: {e}")


def _seed_cache_from_volume():
    if not os.path.exists(PERSISTENT_WIRE_DATA_FILE):
        return
    try:
        with open(PERSISTENT_WIRE_DATA_FILE, encoding="utf-8") as f:
            data = json.load(f)
        from api.services.cache import cache
        cache.set("wire_data", data, ttl=82800)
        print(f"[startup] Loaded wire_data from volume (date={data.get('date', '?')})")
    except Exception as e:
        print(f"[startup] Could not load wire_data from volume: {e}")


def _resolve_priority_tickers() -> list[str]:
    """Resolve UCT20 + watchlists + candidates + theme core tier into a deduped sorted ticker list.

    Returns empty list if no subsystems are available (e.g., wire_data not yet pushed).
    """
    tickers: set[str] = set()

    # UCT20 + candidates from wire_data
    try:
        from api.services import engine
        wd = engine._load_wire_data() or {}
        uct20 = wd.get("uct20") or {}
        for sym in uct20.get("symbols", []) or []:
            if sym:
                tickers.add(sym.upper())
        # Pullback candidates if present
        candidates = wd.get("candidates") or {}
        for bucket_name in ("pullback_ma", "remount", "gappers"):
            bucket = candidates.get(bucket_name) or []
            for c in bucket:
                sym = c.get("sym") if isinstance(c, dict) else None
                if sym:
                    tickers.add(sym.upper())
    except Exception:
        pass

    # Public watchlists
    try:
        from api.services import watchlist_service
        for wl in (watchlist_service.list_public_watchlists() or []):
            items = wl.get("items", []) if isinstance(wl, dict) else []
            for item in items:
                sym = item.get("sym") if isinstance(item, dict) else None
                if sym:
                    tickers.add(sym.upper())
    except Exception:
        pass

    return sorted(tickers)


def _run_priority_audit_now() -> None:
    """Resolve priority tickers and trigger an audit. Synchronous (for tests).

    Production callers should wrap in a thread (see _start_priority_audit_background).
    """
    try:
        tickers = _resolve_priority_tickers()
    except Exception:
        logging.getLogger(__name__).exception("[startup] priority resolver failed")
        return
    if not tickers:
        return
    try:
        from api.services import bars_audit
        bars_audit.audit_universe(
            tickers,
            tfs=["5", "30", "60", "D"],
            bars_counts=[5000],
            parallelism=4,
            scope="priority",
        )
    except Exception:
        logging.getLogger(__name__).exception("[startup] priority audit run failed")


def _start_priority_audit_background(delay_seconds: int = 30) -> None:
    """Spawn a daemon thread that runs the priority audit after `delay_seconds`."""
    import threading
    def _delayed():
        import time
        time.sleep(delay_seconds)
        _run_priority_audit_now()
    threading.Thread(target=_delayed, daemon=True, name="startup-priority-audit").start()


_DEPLOY_SMOKE_FIXTURE = ["QQQ", "SPY", "IWM", "AAPL", "NVDA", "TSLA",
                         "AMZN", "GOOGL", "META", "MSFT"]


def _run_deploy_smoke_now() -> None:
    """Run a small validation smoke audit ~30s after every deploy."""
    try:
        from api.services import bars_audit
        bars_audit.audit_universe(_DEPLOY_SMOKE_FIXTURE, scope="deploy-smoke")
    except Exception:
        logging.getLogger(__name__).exception("[startup] deploy smoke failed")


def _start_deploy_smoke_background(delay_seconds: int = 30) -> None:
    """Spawn a daemon thread that runs the deploy smoke after `delay_seconds`."""
    import threading
    def _delayed():
        import time
        time.sleep(delay_seconds)
        _run_deploy_smoke_now()
    threading.Thread(target=_delayed, daemon=True, name="deploy-smoke").start()


# Module-level imports for hot tier warm helpers — bound at module scope so
# tests can patch via `api.main.bars_disk_cache.get` and `api.main.bars_hot_tier.set`.
from api.services import bars_hot_tier, bars_disk_cache  # noqa: E402


def _warm_hot_tier_now() -> None:
    """Synchronously pre-load the hot tier with top-priority tickers' bars.

    Used by tests + the background warm helper.
    """
    try:
        tickers = _resolve_priority_tickers()
    except Exception:
        logging.getLogger(__name__).exception("[startup] hot tier warm: resolve failed")
        return
    if not tickers:
        return
    # Cap to 500 — capacity of the hot tier
    tickers = tickers[:500]
    for sym in tickers:
        for tf in ("5", "30", "60", "D"):
            try:
                payload = bars_disk_cache.get(sym, tf, 5000)
                if payload:
                    bars_hot_tier.set(sym, tf, 5000, payload)
            except Exception:
                pass
    try:
        size = bars_hot_tier.size()
        logging.getLogger(__name__).info("[startup] hot tier warmed: %d entries", size)
    except Exception:
        pass


def _start_hot_tier_warm_background(delay_seconds: int = 45) -> None:
    """Spawn a daemon thread that warms the hot tier after `delay_seconds`."""
    import threading
    def _delayed():
        import time
        time.sleep(delay_seconds)
        _warm_hot_tier_now()
    threading.Thread(target=_delayed, daemon=True, name="hot-tier-warmer").start()


def _start_rs_rankings_warm_background(delay_seconds: int = 120) -> None:
    """Pre-compute RS rankings ~120s after startup so first user request is hot.

    The compute reads 6 months of daily bars for the cap_universe (~3,685
    tickers) and takes ~17s cold. Delaying 120s lets the hot-tier warm,
    priority audit, and deploy smoke run first so this doesn't compete with
    other startup workers for bar I/O.
    """
    import threading
    def _delayed():
        import time
        time.sleep(delay_seconds)
        try:
            from api.services import rs_ranking
            rankings = rs_ranking.compute_rs_scores()
            logging.getLogger(__name__).info(
                "[startup] rs-rankings warmed: %d entries", len(rankings)
            )
        except Exception:
            logging.getLogger(__name__).exception("[startup] rs-rankings warm failed")
    threading.Thread(target=_delayed, daemon=True, name="rs-rankings-warmer").start()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Bump the anyio/starlette thread pool so sync endpoints don't queue
    try:
        import anyio
        limiter = anyio.to_thread.current_default_thread_limiter()
        limiter.total_tokens = 64
        print(f"[startup] anyio thread limiter set to {limiter.total_tokens}")
    except Exception as e:
        print(f"[startup] anyio thread-pool tuning failed (non-fatal): {e}")

    try:
        _init_auth_db()
    except Exception as e:
        print(f"[startup] Auth DB init error (non-fatal): {e}")

    # Chart-health bootstrap: init quarantine + audit schemas synchronously so
    # the tables exist before any /api/bars handler runs, then spawn a daemon
    # thread to scan existing cache files for corruption (slow — up to ~18,425
    # files). The scan must NOT block startup or Railway healthchecks fail.
    try:
        from api.services import bar_quarantine, bar_audit_bootstrap, bars_audit, bar_provenance
        bar_quarantine.init_schema()
        bars_audit._init_audit_runs_table()
        bar_provenance.init_schema()

        def _bootstrap_scan():
            try:
                n = bar_audit_bootstrap.scan_and_quarantine_existing_cache()
                logging.getLogger(__name__).info(
                    "[startup] quarantined %d bars from existing cache", n
                )
            except Exception as _e:
                logging.getLogger(__name__).exception(
                    "[startup] bootstrap scan failed: %s", _e
                )

        threading.Thread(
            target=_bootstrap_scan, daemon=True, name="chart-health-bootstrap"
        ).start()
    except Exception as e:
        logging.getLogger(__name__).exception(
            "[startup] chart-health bootstrap failed: %s", e
        )

    # Indicator alerts: init schema + start the background evaluator. The
    # evaluator polls active alerts every 60s, reads bars from the persistent
    # SQLite store (no remote fetch in-loop), and dispatches triggered alerts
    # through the existing watchlist-alert delivery pipeline.
    try:
        from api.services import indicator_alert_service, indicator_alert_evaluator
        indicator_alert_service.init_schema()
        indicator_alert_evaluator.start_evaluator(interval_sec=60)
        logging.getLogger(__name__).info("[startup] indicator alert evaluator started")
    except Exception:
        logging.getLogger(__name__).exception("[startup] indicator alert evaluator failed to start")

    # Fire-and-forget priority audit ~30s after boot so the admin chart-health
    # dashboard has a baseline run on every redeploy without manual operator
    # intervention. Helper is a no-op if no priority tickers are resolvable
    # (e.g. wire_data not yet pushed on a fresh volume).
    try:
        _start_priority_audit_background()
        logging.getLogger(__name__).info("[startup] priority audit scheduled (~30s after boot)")
    except Exception as e:
        logging.getLogger(__name__).exception("[startup] failed to schedule priority audit: %s", e)

    # Hot tier warm — pre-load top-priority tickers' bars into RAM 45s after
    # boot so the first chart request lands in the hot tier (no disk hop).
    try:
        _start_hot_tier_warm_background()
        logging.getLogger(__name__).info("[startup] hot tier warm scheduled (~45s after boot)")
    except Exception:
        logging.getLogger(__name__).exception("[startup] failed to schedule hot tier warm")

    # RS rankings warm — compute IBD-style relative strength rankings for the
    # cap_universe (~3,685 tickers) 120s after boot so the first
    # /api/rs-rankings request after a redeploy hits the cache instead of
    # taking ~17s. Staggered after hot-tier warm and priority audit to avoid
    # contending for bar I/O during startup.
    try:
        _start_rs_rankings_warm_background()
        logging.getLogger(__name__).info("[startup] rs-rankings warm scheduled (~120s after boot)")
    except Exception:
        logging.getLogger(__name__).exception("[startup] failed to schedule rs-rankings warm")

    # Deploy-smoke audit — small fixture run ~30s after every deploy so admins
    # can verify nothing broke in the chart pipeline without manual operator
    # intervention. Independent of the priority audit (which depends on
    # wire_data being pushed); this always runs.
    try:
        _start_deploy_smoke_background()
        logging.getLogger(__name__).info("[startup] deploy smoke audit scheduled")
    except Exception:
        logging.getLogger(__name__).exception("[startup] failed to schedule deploy smoke")

    # Start continuous audit thread (5min/1hr/24hr cadences)
    try:
        from api.services import bars_continuous_audit
        bars_continuous_audit.start()
        logging.getLogger(__name__).info("[startup] bars_continuous_audit started")
    except Exception:
        logging.getLogger(__name__).exception("[startup] bars_continuous_audit start failed")

    # Start realtime_candle reconciliation worker — runs every 60s in the same
    # event loop as the FastAPI app. Compares the in-memory developing candle
    # to a REST snapshot (fetch_minute_snapshot) and emits bar_correction
    # events when WS state disagrees with the authoritative provider.
    try:
        from api.services import realtime_candle
        import asyncio
        asyncio.create_task(realtime_candle.reconciliation_worker())
        logging.getLogger(__name__).info("[startup] realtime_candle reconciliation_worker scheduled")
    except Exception as e:
        logging.getLogger(__name__).exception("[startup] failed to schedule reconciliation_worker: %s", e)

    # Integrity check BEFORE init_db: if /data/bars.db is malformed (which
    # happens when the previous run was killed mid-write or replaced with
    # stale WAL/SHM sidecars hanging around), every put_bars at runtime
    # would fail with "disk image is malformed" and the chart would freeze
    # at whatever bars were cached before the corruption. Detect it here
    # and pull a fresh R2 snapshot before any handler can hit the bad file.
    try:
        from api.services import bars_sqlite as _bs_check
        if not _bs_check.integrity_ok():
            print("[startup] bars.db failed PRAGMA integrity_check — pulling fresh snapshot from R2")
            try:
                from api.services import data_sync as _ds_check
                if _ds_check.force_resync():
                    print("[startup] bars.db restored from R2 snapshot")
                else:
                    print("[startup] bars.db restore from R2 FAILED — init_db will create empty DB")
            except Exception as e:
                print(f"[startup] force_resync error (non-fatal): {e}")
    except Exception as e:
        print(f"[startup] bars.db integrity_check error (non-fatal): {e}")

    try:
        from api.services import bars_sqlite as _bars_sqlite
        _bars_sqlite.init_db()
        print("[startup] SQLite bar store ready")
    except Exception as e:
        print(f"[startup] SQLite bar store init error (non-fatal): {e}")

    try:
        for _flag_name in (".tf60_purged_2f42e55", ".tf60_purged_3cbe1cf_src_cap"):
            _flag_path = os.path.join(os.environ.get("DATA_DIR", "/data"), _flag_name)
            if not os.path.exists(_flag_path):
                _cd = os.path.join(os.environ.get("DATA_DIR", "/data"), "bars_cache")
                n = 0
                if os.path.isdir(_cd):
                    for _f in os.listdir(_cd):
                        if "_60_" in _f and _f.endswith(".json"):
                            try:
                                os.remove(os.path.join(_cd, _f))
                                n += 1
                            except OSError:
                                pass
                print(f"[startup] {_flag_name}: purged {n} tf=60 disk-cache files")
                try:
                    with open(_flag_path, "w") as _f:
                        _f.write("done")
                except OSError:
                    pass
    except Exception as e:
        print(f"[startup] tf=60 disk purge error (non-fatal): {e}")

    # Skip the memory pre-warm entirely when this web service pulls bars
    # from a remote worker via R2 (USE_REMOTE_BARS=1). Reason: the pre-warm
    # loads bars from /data/bars.db into the in-process TTL cache. With
    # USE_REMOTE_BARS=1, the snapshot puller hasn't run yet at this point
    # in startup, so /data/bars.db is whatever the last deploy left behind
    # (potentially empty, definitely stale). Loading that into memory and
    # then having the puller replace the disk file leaves memory permanently
    # disagreeing with disk for up to _CACHE_TTL[tf] seconds — users see
    # stale bars on every fresh deploy. The first SQLite read per ticker
    # after a pull is ~1-2ms on local disk, so skipping pre-warm is a
    # near-free trade for correctness.
    if os.environ.get("USE_REMOTE_BARS") == "1":
        print("[startup] Memory pre-warm skipped (USE_REMOTE_BARS=1); cache populates lazily after snapshot pull")
    else:
        try:
            from api.services import bars_sqlite as _pbs
            from api.services.cache import cache as _pcache
            from api.routers.bars import _fmt_sqlite_bars, _CACHE_TTL
            from api.services.bars_seeder import _TIER1_BASE
            _pw = 0
            _pw_syms: set[str] = set()

            def _warm_sym_into_memory(sym: str, tf: str):
                nonlocal _pw
                _bc = 8000 if tf in ('D', 'W') else 5000
                try:
                    _lt = _pbs.get_last_ts(sym, tf)
                    if _lt is None:
                        return
                    _rows = _pbs.get_bars(sym, tf, _bc)
                    if not _rows:
                        return
                    _pl = {"ticker": sym, "tf": tf, "bars": _fmt_sqlite_bars(_rows, tf)}
                    _pcache.set(f"bars_{sym}_{tf}_{_bc}", _pl, ttl=_CACHE_TTL.get(tf, 300))
                    _pw += 1
                except Exception:
                    pass

            for _sym in _TIER1_BASE:
                _pw_syms.add(_sym)
                for _tf in ('D', 'W', '5', '15', '30', '60'):
                    _warm_sym_into_memory(_sym, _tf)

            try:
                from api.services import breadth_monitor as _bm
                _latest = _bm.get_latest()
                if _latest:
                    for _k, _v in _latest.items():
                        if not _k.endswith('_list') or not isinstance(_v, list):
                            continue
                        for _item in _v:
                            _s = _item.get('t') if isinstance(_item, dict) else None
                            if _s and _s.upper() not in _pw_syms:
                                _pw_syms.add(_s.upper())
                                for _tf in ('D', 'W'):
                                    _warm_sym_into_memory(_s.upper(), _tf)
            except Exception:
                pass

            print(f"[startup] Memory pre-warm pass 1: {_pw} bar series loaded from SQLite ({len(_pw_syms)} tickers)")

            try:
                from api.services.bars_sqlite import get_all_tickers as _gat
                _p2_before = _pw
                for _sym, _tf in _gat():
                    if _tf in ('D', 'W') and _sym not in _pw_syms:
                        _pw_syms.add(_sym)
                        _warm_sym_into_memory(_sym, 'D')
                        _warm_sym_into_memory(_sym, 'W')
                print(f"[startup] Memory pre-warm pass 2: +{_pw - _p2_before} series ({len(_pw_syms)} total tickers, {_pw} total series)")
            except Exception as _e2:
                print(f"[startup] Memory pre-warm pass 2 failed (non-fatal): {_e2}")

        except Exception as _e:
            print(f"[startup] Memory pre-warm failed (non-fatal): {_e}")

    # USE_REMOTE_BARS=1 tells this web service that a separate worker is
    # producing the bars snapshot, so we should NOT run our own prewarmer or
    # seeder; instead we pull the snapshot from R2 every 5 min.
    #
    # NOTE: do NOT use WORKER_ENABLED here. WORKER_ENABLED is consumed by
    # railway.json's startCommand to decide whether to run worker_main vs
    # the full uvicorn web app. If we keyed both decisions off the same
    # variable, setting it on the web service would replace the website
    # with the tiny worker-only app. Two different decisions = two vars.
    if os.environ.get("USE_REMOTE_BARS") == "1":
        print("[startup] USE_REMOTE_BARS=1 — skipping in-process prewarmer/seeder; pulling snapshot from worker via R2")
    else:
        try:
            from api.services.bars_seeder import start_background_seeder
            start_background_seeder()
        except Exception as e:
            print(f"[startup] Bar seeder start error (non-fatal): {e}")

    _seed_cache_from_volume()

    if os.environ.get("USE_REMOTE_BARS") != "1":
        from api.services.bars_prewarm import run_prewarmer_forever
        threading.Thread(target=run_prewarmer_forever, daemon=True, name="prewarm").start()

    # When the worker service is producing snapshots, pull them on a fixed
    # cadence (see SNAPSHOT_INTERVAL_SECONDS in api.services.data_sync).
    if os.environ.get("USE_REMOTE_BARS") == "1":
        from api.services import data_sync
        import time as _t

        # Phase 4.7: pull the initial snapshot synchronously so /api/bars serves
        # warm-cache responses from the moment the deploy goes Active. Without this,
        # the first chart load after every deploy waits ~20s for the puller daemon
        # to do its first sync. The hard timeout ensures we don't hang Railway's
        # healthcheck if R2 is unreachable.
        #
        # IMPORTANT: skip the boot pull if local SQLite already has data. After a
        # restart with persistent volume, the local cache is intact and may have
        # FRESHER data than the worker's snapshot (the worker can be stuck or
        # running behind). Pulling unconditionally would replace fresh local
        # writes with potentially-stale snapshot. The boot pull only matters
        # for cold-start (first deploy on an empty volume).
        _initial_pull_timeout = float(os.environ.get("INITIAL_SNAPSHOT_TIMEOUT_SEC", "60"))
        _t0 = _t.time()
        try:
            # Probe local SQLite size — skip pull if data already present.
            _skip_boot_pull = False
            try:
                import sqlite3 as _sqlite_probe
                _db_probe_path = os.path.join(os.environ.get("DATA_DIR", "/data"), "bars.db")
                if os.path.exists(_db_probe_path):
                    _pc = _sqlite_probe.connect(_db_probe_path, timeout=5)
                    try:
                        _row = _pc.execute("SELECT COUNT(*) FROM ohlcv").fetchone()
                        _local_count = int(_row[0]) if _row else 0
                    finally:
                        _pc.close()
                    if _local_count >= 1000:
                        _skip_boot_pull = True
                        print(f"[startup] Skipping boot R2 pull — local SQLite has "
                              f"{_local_count:,} bars already; preserving local writes "
                              f"(set FORCE_BOOT_R2_PULL=1 to override)")
            except Exception as _e:
                print(f"[startup] Local SQLite probe failed (will pull from R2): {_e}")

            if os.environ.get("FORCE_BOOT_R2_PULL") == "1":
                _skip_boot_pull = False
                print("[startup] FORCE_BOOT_R2_PULL=1 — pulling boot snapshot regardless")

            if _skip_boot_pull:
                _result = {"ts": None, "err": None}
                _initial_thread = None
            else:
                # data_sync.sync_if_newer() is synchronous and may take 5-30s for a
                # full snapshot pull. We can't easily inject a timeout into it without
                # refactoring data_sync, so we run it on a thread with a join timeout.
                # If the join times out, we proceed with a cold cache (existing behavior)
                # rather than hang the deploy.
                _result = {"ts": None, "err": None}
                def _initial_pull():
                    try:
                        _result["ts"] = data_sync.sync_if_newer()
                    except Exception as e:
                        _result["err"] = e
                _initial_thread = threading.Thread(target=_initial_pull, name="initial_snapshot_pull")
                _initial_thread.start()
                _initial_thread.join(timeout=_initial_pull_timeout)
            if _initial_thread is None:
                # Skipped pull entirely (local already has data); nothing to log.
                pass
            elif _initial_thread.is_alive():
                elapsed = _t.time() - _t0
                print(f"[startup] Initial snapshot pull TIMED OUT after {elapsed:.1f}s "
                      f"(limit={_initial_pull_timeout}s) — proceeding with cold cache; "
                      f"daemon puller will sync on next interval")
                # Note: thread is still running; it'll complete in the background and
                # update the cache. The daemon puller loop below also keeps trying.
            elif _result["err"] is not None:
                elapsed = _t.time() - _t0
                print(f"[startup] Initial snapshot pull FAILED after {elapsed:.1f}s "
                      f"(non-fatal): {_result['err']} — proceeding with cold cache")
            else:
                elapsed = _t.time() - _t0
                ts = _result["ts"]
                if ts:
                    print(f"[startup] Initial snapshot pull complete in {elapsed:.1f}s "
                          f"— cache warm, serving from snapshot {ts}")
                else:
                    # sync_if_newer returns None when no new snapshot is available
                    # (existing local snapshot is current). Cache should still be warm.
                    print(f"[startup] Initial snapshot already current ({elapsed:.1f}s) — cache warm")
        except Exception as e:
            elapsed = _t.time() - _t0
            print(f"[startup] Initial snapshot pull error after {elapsed:.1f}s "
                  f"(non-fatal): {e} — proceeding with cold cache")

        # Periodic R2 sync: REPLACES the entire local bars.db with worker's
        # snapshot every 5 minutes. This was DESIGNED to keep web in sync
        # with worker's prewarmer, but in practice it overwrites the web's
        # fresh delta-fetch writes with whatever stale state the worker has.
        # User report 2026-05-07: charts show correct data after a refresh,
        # then revert to stale within 5 min — exactly matching this loop.
        # Gated behind R2_PERIODIC_PULL_ENABLED (default OFF) so the boot-
        # time initial pull happens (still useful for cold-start), but the
        # periodic overwrite stops. Web's local writes become authoritative
        # once the deploy is up. Re-enable by setting the env var to "1"
        # when worker's prewarmer is verified to produce fresh data.
        if os.environ.get("R2_PERIODIC_PULL_ENABLED") == "1":
            def _s3_pull_loop():
                import time as _t
                while True:
                    _t.sleep(data_sync.SNAPSHOT_INTERVAL_SECONDS)  # sleep first; initial pull just happened
                    try:
                        ts = data_sync.sync_if_newer()
                        if ts:
                            print(f"[data_sync] pulled snapshot {ts}")
                    except Exception as e:
                        print(f"[data_sync] pull error (non-fatal): {e}")
            threading.Thread(target=_s3_pull_loop, daemon=True, name="s3_pull").start()
            print(f"[startup] S3 snapshot puller thread started ({data_sync.SNAPSHOT_INTERVAL_SECONDS // 60}-min cadence)")
        else:
            print("[startup] S3 periodic puller DISABLED (R2_PERIODIC_PULL_ENABLED!=1) — "
                  "web's local writes are authoritative; only the boot-time pull happened. "
                  "Set R2_PERIODIC_PULL_ENABLED=1 to re-enable periodic R2 overrides.")

    # Real-time bar streaming (Phase 4): Massive WS → BarBroadcaster → SSE.
    # Off by default; flip STREAM_BARS_ENABLED=1 to enable.
    if os.environ.get("STREAM_BARS_ENABLED") == "1":
        from api.services import bar_stream, bar_broadcaster
        bb = bar_broadcaster.init_broadcaster(
            on_first_subscribe=bar_stream.subscribe_symbols_one,
            on_last_unsubscribe=bar_stream.unsubscribe_symbols_one,
        )
        bar_stream.start_stream(on_bar=bb.push_aggregate)
        print("[startup] Bar stream thread started (Massive WS → BarBroadcaster, AM+A channels)")

    def _build_deep_cache():
        if os.environ.get("DEEP_CACHE_ENABLED", "0") != "1":
            print("[deep-cache] Skipped (set DEEP_CACHE_ENABLED=1 to enable).")
            return
        deep_dir = os.path.join(os.environ.get("DATA_DIR", "/data"), "bars_cache_deep")
        _60_purge_flag = os.path.join(os.environ.get("DATA_DIR", "/data"), ".60min_purged_v1")
        if not os.path.exists(_60_purge_flag):
            _cache_dir = os.path.join(os.environ.get("DATA_DIR", "/data"), "bars_cache")
            if os.path.isdir(_cache_dir):
                purged_60 = 0
                for f in os.listdir(_cache_dir):
                    if '_60_' in f and f.endswith('.json'):
                        try: os.remove(os.path.join(_cache_dir, f)); purged_60 += 1
                        except OSError: pass
                if purged_60: print(f"[prewarm] Purged {purged_60} old 60min cache files")
            try:
                with open(_60_purge_flag, 'w') as f: f.write("done")
            except Exception: pass
        flag = os.path.join(os.environ.get("DATA_DIR", "/data"), ".deep_cache_built_v4")
        if os.path.exists(flag):
            count = len([f for f in os.listdir(deep_dir) if f.endswith('.json')]) if os.path.isdir(deep_dir) else 0
            print(f"[deep-cache] Already built ({count} files)")
            return
        print("[deep-cache] Building from S3 minute files...")
        try:
            from api.services.build_intraday_cache import build_cache
            build_cache(days=160, timeframes=[15, 30, 60], output_dir=deep_dir)
            with open(flag, 'w') as f: f.write("done")
            print("[deep-cache] Build complete")
        except Exception as e:
            print(f"[deep-cache] Build failed: {e}")
    threading.Thread(target=_build_deep_cache, daemon=True, name="deep-cache-builder").start()

    from api.services.theme_db import init_theme_tables, seed_from_json
    init_theme_tables()
    seed_from_json()

    from api.services.theme_performance import load_persisted_on_startup
    load_persisted_on_startup()

    from api.services.realtime_stream import start_stream
    try:
        start_stream()
    except Exception as e:
        print(f"[startup] WebSocket stream failed (non-fatal): {e}")
    from api.daily_tracker import start_snapshot_scheduler, stop_snapshot_scheduler
    start_snapshot_scheduler()

    _top_flow_tracker.init()
    _top_flow_tracker.archive_expired()
    print(f"[startup] Top Flow tracker: {len(_top_flow_tracker.get_all()['active'])} active, {len(_top_flow_tracker.get_all()['archived'])} archived.")

    _watchlist_tracker.init()
    print(f"[startup] Watchlist tracker: {len(_watchlist_tracker.get_recent_dates())} saved days.")

    # ── Flow DB: auto-seed from static CSVs if DB is empty ──────────────────
    try:
        from api.flow_db import FlowDB
        _flow_db = FlowDB()
        _flow_stats = _flow_db.stats()
        _public_dir = os.path.join(os.path.dirname(__file__), "..", "app", "public")

        # Seed stocks
        if _flow_stats["stocks_rows"] == 0:
            _stock_csv = os.path.join(_public_dir, "flow-data.csv")
            if os.path.exists(_stock_csv):
                with open(_stock_csv, "r", encoding="utf-8-sig") as _f:
                    _result = _flow_db.insert_csv(_f.read(), source="stocks")
                print(f"[startup] Flow DB seeded stocks: {_result['inserted']:,} rows from flow-data.csv ({len(_result['dates'])} dates)")
            else:
                print("[startup] Flow DB: no flow-data.csv found to seed")
        else:
            # Check if CSV has newer data than DB
            _stock_csv = os.path.join(_public_dir, "flow-data.csv")
            if os.path.exists(_stock_csv):
                with open(_stock_csv, "r", encoding="utf-8-sig") as _f:
                    _result = _flow_db.insert_csv(_f.read(), source="stocks")
                if _result["inserted"] > 0:
                    print(f"[startup] Flow DB stocks: +{_result['inserted']:,} new rows, {_result['skipped']:,} dupes skipped")
                else:
                    print(f"[startup] Flow DB stocks: {_flow_stats['stocks_rows']:,} rows, {_flow_stats['stock_days']} days — up to date")

        # Seed indexes
        if _flow_stats["indexes_rows"] == 0:
            _idx_csv = os.path.join(_public_dir, "Indexes-data.csv")
            if os.path.exists(_idx_csv):
                with open(_idx_csv, "r", encoding="utf-8-sig") as _f:
                    _result = _flow_db.insert_csv(_f.read(), source="indexes")
                print(f"[startup] Flow DB seeded indexes: {_result['inserted']:,} rows from Indexes-data.csv ({len(_result['dates'])} dates)")
            else:
                print("[startup] Flow DB: no Indexes-data.csv found to seed")
        else:
            _idx_csv = os.path.join(_public_dir, "Indexes-data.csv")
            if os.path.exists(_idx_csv):
                with open(_idx_csv, "r", encoding="utf-8-sig") as _f:
                    _result = _flow_db.insert_csv(_f.read(), source="indexes")
                if _result["inserted"] > 0:
                    print(f"[startup] Flow DB indexes: +{_result['inserted']:,} new rows, {_result['skipped']:,} dupes skipped")
                else:
                    print(f"[startup] Flow DB indexes: {_flow_stats['indexes_rows']:,} rows, {_flow_stats['index_days']} days — up to date")

        # Auto-prune expired
        _pruned = _flow_db.prune_expired(buffer_days=1)
        if _pruned:
            print(f"[startup] Flow DB pruned {_pruned} expired rows")
    except Exception as e:
        print(f"[startup] Flow DB auto-seed error (non-fatal): {e}")

    try:
        _cot_service.init_db()
        if _cot_service.is_empty():
            print("[startup] COT table empty — seeding from CFTC historical archive (background)...")
            threading.Thread(target=_cot_seed_background, daemon=True, name="cot-seed").start()
        else:
            from datetime import date as _date
            now_et = datetime.now(ZoneInfo("America/New_York"))
            status = _cot_service.get_status()
            last_updated = status.get("last_updated")
            already_ran_today = (
                last_updated is not None
                and last_updated[:10] == now_et.date().isoformat()
            )
            if not already_ran_today:
                latest_date = _cot_service.get_latest_date()
                days_old = (now_et.date() - _date.fromisoformat(latest_date)).days if latest_date else 999
                if days_old >= 8:
                    print(f"[startup] COT data is {days_old}d stale — running catch-up refresh...")
                    threading.Thread(target=_cot_catchup_background, daemon=True, name="cot-catchup").start()
                elif now_et.weekday() == 4 and now_et.hour >= 17:
                    print("[startup] COT catch-up: Friday refresh missed — running now...")
                    threading.Thread(target=_cot_catchup_background, daemon=True, name="cot-catchup").start()
                else:
                    print(f"[startup] COT database ready (latest: {latest_date}, {days_old}d old).")
            else:
                print("[startup] COT database ready.")
    except Exception as e:
        print(f"[startup] COT init error (non-fatal): {e}")

    # Cross-worker lock: only the first uvicorn worker in this container
    # starts APScheduler. Without this, --workers 2 (Phase 2) would
    # double-fire every cron job — COT refreshes twice, MRR snapshots
    # twice, etc. The lock auto-releases when the holding process exits.
    # See api/services/scheduler_lock.py for mechanism.
    from api.services.scheduler_lock import acquire_scheduler_lock
    _scheduler = None
    if acquire_scheduler_lock():
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.cron import CronTrigger
        from api.services.auth_service import cleanup_expired_sessions, cleanup_expired_tokens, record_mrr_snapshot
        _scheduler = BackgroundScheduler(timezone=ZoneInfo("America/New_York"))
        _scheduler.add_job(_cot_service.refresh_from_current, trigger=CronTrigger(day_of_week="fri", hour=15, minute=50), id="cot_weekly_refresh", max_instances=1, replace_existing=True)
        _scheduler.add_job(_cot_service.refresh_if_stale, trigger=CronTrigger(day_of_week="fri", hour=16, minute=15), id="cot_weekly_retry_1", max_instances=1, replace_existing=True)
        _scheduler.add_job(_cot_service.refresh_if_stale, trigger=CronTrigger(day_of_week="fri", hour=16, minute=45), id="cot_weekly_retry_2", max_instances=1, replace_existing=True)

        def _cot_daily_catchup():
            try:
                from datetime import date as _dt
                from zoneinfo import ZoneInfo as _ZI
                latest = _cot_service.get_latest_date()
                if latest:
                    import datetime as _dtm
                    days_old = (_dtm.datetime.now(_ZI("America/New_York")).date() - _dt.fromisoformat(latest)).days
                    if days_old >= 8:
                        print(f"[scheduler] COT daily catchup: data is {days_old}d stale — refreshing...")
                        _cot_service.refresh_from_current()
                    else:
                        print(f"[scheduler] COT daily catchup: data is {days_old}d old — fresh, skipping")
            except Exception as e:
                print(f"[scheduler] COT daily catchup error: {e}")

        _scheduler.add_job(_cot_daily_catchup, trigger=CronTrigger(hour=18, minute=0), id="cot_daily_catchup", max_instances=1, replace_existing=True)
        _scheduler.add_job(cleanup_expired_sessions, trigger=CronTrigger(hour=3, minute=0), id="session_cleanup", max_instances=1, replace_existing=True)

        def _check_churn_risk():
            try:
                from api.services.auth_db import get_connection
                from api.services.discord_notify import notify_churn_risk
                conn = get_connection()
                rows = conn.execute(
                    "SELECT u.email, u.last_login_at FROM users u "
                    "JOIN subscriptions s ON u.id = s.user_id "
                    "WHERE s.status IN ('active', 'trialing') "
                    "AND u.last_login_at IS NOT NULL "
                    "AND u.last_login_at < datetime('now', '-7 days')"
                ).fetchall()
                conn.close()
                for r in rows:
                    from datetime import datetime, timezone
                    last = datetime.fromisoformat(r["last_login_at"].replace("Z", "+00:00"))
                    days = (datetime.now(timezone.utc) - last).days
                    notify_churn_risk(r["email"], days)
                if rows:
                    print(f"[churn] Alerted {len(rows)} churn risk users")
            except Exception as e:
                print(f"[churn] Error checking churn risk: {e}")

        _scheduler.add_job(_check_churn_risk, trigger=CronTrigger(hour=9, minute=0), id="churn_risk_check", max_instances=1, replace_existing=True)
        _scheduler.add_job(record_mrr_snapshot, trigger=CronTrigger(hour=23, minute=59), id="mrr_snapshot", max_instances=1, replace_existing=True)
        try:
            record_mrr_snapshot()
        except Exception as e:
            print(f"[startup] MRR snapshot error (non-fatal): {e}")

        from api.services.watchlist_digest import run_daily_digests, run_weekly_digests
        _scheduler.add_job(run_daily_digests, trigger=CronTrigger(hour=17, minute=0), id="watchlist_daily_digest", max_instances=1, replace_existing=True)
        _scheduler.add_job(run_weekly_digests, trigger=CronTrigger(day_of_week="fri", hour=17, minute=5), id="watchlist_weekly_digest", max_instances=1, replace_existing=True)

        def _nightly_bar_refresh():
            try:
                from api.services.bars_seeder import seed_full_universe
                import threading as _th
                _th.Thread(target=seed_full_universe, daemon=True, name="bars-nightly").start()
            except Exception as e:
                print(f"[scheduler] nightly bar refresh error: {e}")

        _scheduler.add_job(_nightly_bar_refresh, trigger=CronTrigger(day_of_week="mon-fri", hour=16, minute=15), id="bars_nightly_refresh", max_instances=1, replace_existing=True)

        # Nightly flow DB prune — remove expired contracts (buffer_days=1)
        def _nightly_flow_prune():
            try:
                from api.flow_db import FlowDB
                pruned = FlowDB().prune_expired(buffer_days=1)
                if pruned:
                    print(f"[scheduler] Flow DB pruned {pruned} expired rows")
            except Exception as e:
                print(f"[scheduler] Flow DB prune error: {e}")

        _scheduler.add_job(_nightly_flow_prune, trigger=CronTrigger(hour=20, minute=0), id="flow_nightly_prune", max_instances=1, replace_existing=True)

        # Voice TTS cache cleanup — daily at 3:30 AM ET.
        _scheduler.add_job(_voice_cache_purge, trigger=CronTrigger(hour=3, minute=30), id="voice_audio_cache_purge", max_instances=1, replace_existing=True)

        # Compass EOD recap — auto-generate at 4:30 PM ET, Mon-Fri.
        # Iterates every j2_account with compass_enabled=1 and calls
        # coach.generate_eod_recap. Skips accounts with no activity.
        def _compass_eod_job():
            import os as _os
            if not _os.environ.get("ANTHROPIC_API_KEY"):
                print("[scheduler] Compass EOD: ANTHROPIC_API_KEY missing — skipping batch")
                return

            try:
                from datetime import datetime as _dt
                from api.services.auth_db import get_connection as _get_conn
                from api.services.journal_two import coach as _coach

                et = ZoneInfo("America/New_York")
                today_iso = _dt.now(et).date().isoformat()

                conn = _get_conn()
                try:
                    rows = conn.execute(
                        "SELECT id, user_id FROM j2_accounts WHERE compass_enabled = 1",
                    ).fetchall()
                    print(f"[scheduler] Compass EOD batch: {len(rows)} eligible accounts on {today_iso}")
                    for row in rows:
                        account_id = row["id"]
                        user_id = row["user_id"]
                        try:
                            result = _coach.generate_eod_recap(
                                user_id=user_id, account_id=account_id, day=today_iso,
                                conn=conn,
                            )
                            if result.get("skipped"):
                                print(f"[scheduler] EOD skipped for account {account_id}: {result.get('reason')}")
                            else:
                                print(f"[scheduler] EOD generated for account {account_id} (id={result.get('id')})")
                        except Exception as job_err:  # noqa: BLE001
                            print(f"[scheduler] EOD generation failed for account {account_id}: {job_err}")
                finally:
                    conn.close()
            except Exception as e:  # noqa: BLE001
                print(f"[scheduler] Compass EOD batch error: {e}")

        _scheduler.add_job(
            _compass_eod_job,
            trigger=CronTrigger(day_of_week="mon-fri", hour=16, minute=30),
            id="compass_eod_recap",
            max_instances=1,
            replace_existing=True,
        )

        _scheduler.start()
        print("[startup] COT scheduler running — Fridays at 3:50 PM ET (retries 4:15, 4:45); daily catchup at 6 PM ET")
        print("[startup] Session cleanup scheduled — daily at 3:00 AM ET")
        print("[startup] Churn risk check scheduled — daily at 9:00 AM ET")
        print("[startup] MRR snapshot scheduled — daily at 11:59 PM ET")
        print("[startup] Compass EOD recap scheduled — Mon-Fri at 4:30 PM ET")
    else:
        print("[startup] APScheduler skipped — lock held by another uvicorn worker (multi-worker mode)")

    yield
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
    stop_snapshot_scheduler()

app = FastAPI(title="UCT Dashboard", lifespan=lifespan)
app.add_middleware(MaintenanceMiddleware)
from starlette.middleware.gzip import GZipMiddleware as _GZipBase
from starlette.types import ASGIApp, Receive, Scope, Send

class _GZipSkipSSE(_GZipBase):
    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        path = scope.get("path") or ""
        if scope.get("type") == "http" and (
            path.startswith("/api/stream") or path.startswith("/assets/")
        ):
            await self.app(scope, receive, send)
        else:
            await super().__call__(scope, receive, send)

app.add_middleware(_GZipSkipSSE, minimum_size=1000)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.get("/api/maintenance")
def get_maintenance():
    return {"maintenance": _MAINTENANCE_MODE}

@app.get("/api/health")
def health():
    from api.services.cache import cache
    wire = cache.get("wire_data")
    wire_date = wire.get("date") if wire else None
    return {"status": "ok", "wire_date": wire_date}


@app.get("/api/health/cache")
def health_cache():
    """Reports staleness of the bars snapshot pulled from the worker service.

    On the web service: snapshot_ts and synced_at come from data_sync's local
    marker (written every time we successfully pull from R2). On the worker
    service or when USE_REMOTE_BARS is unset, this endpoint still works but
    snapshot_ts will be None (no syncing happens)."""
    from api.services.data_sync import get_local_sync_state
    state = get_local_sync_state()
    return {
        "use_remote_bars": os.environ.get("USE_REMOTE_BARS") == "1",
        "snapshot_ts": state["snapshot_ts"],
        "synced_at": state["synced_at"],
        "seconds_since_sync": state["seconds_since_sync"],
    }

app.include_router(snapshot.router)
app.include_router(movers.router)
app.include_router(engine_data.router)
app.include_router(earnings.router)
app.include_router(news.router)
app.include_router(screener.router)
app.include_router(trades.router)
app.include_router(traders.router)
app.include_router(push.router)
app.include_router(charts.router)
app.include_router(bars_router.router)
app.include_router(cot_router.router)
app.include_router(breadth_monitor_router.router)
app.include_router(theme_performance_router.router)
app.include_router(top_flow_router)
app.include_router(schwab_router)
app.include_router(calendar_router.router)
app.include_router(insider_router.router)
app.include_router(auth_router.router)
app.include_router(avatar_router.router)
app.include_router(webhooks_router.router)
app.include_router(alerts_router.router)
app.include_router(journal_two_router.router)
app.include_router(watchlists_router.router)
app.include_router(ticker_tags_router.router)
app.include_router(watchlist_alerts_router.router)
app.include_router(stream_router.router)
app.include_router(community_router.router)
app.include_router(live_prices_router.router)
app.include_router(rs_ranking_router.router)
app.include_router(intelligence_router.router)
app.include_router(transcripts_router.router)
app.include_router(voice_router.router)
app.include_router(admin_chart_health_router.router)
app.include_router(chart_news_router.router)
app.include_router(indicator_alerts_router.router)
app.include_router(backtest_router.router)
app.include_router(gex_router)
app.include_router(watchlist_router)
app.include_router(flow_router)

# ─── CSV routes: serve from app/public/ directly (fallback for legacy paths) ──
PUBLIC = os.path.join(os.path.dirname(__file__), "..", "app", "public")

# Cacheable static-on-deploy CSV files. 5-min max-age bounds staleness if
# someone hot-swaps the file; SWR makes the next mount-after-expiry instant
# while Cloudflare refreshes asynchronously.
_CSV_CACHE_HEADERS = {
    "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    "Vary": "Accept-Encoding",
}

def _csv_response(csv_path: str, filename: str):
    if os.path.exists(csv_path):
        return FileResponse(csv_path, media_type="text/csv", headers=_CSV_CACHE_HEADERS)
    return JSONResponse(status_code=404, content={"error": f"{filename} not found"})

@app.get("/flow-data.csv")
def serve_csv():
    return _csv_response(os.path.join(PUBLIC, "flow-data.csv"), "flow-data.csv")

@app.get("/Darkpool-data.csv")
def serve_darkpool_csv():
    return _csv_response(os.path.join(PUBLIC, "Darkpool-data.csv"), "Darkpool-data.csv")

@app.get("/Indexes-data.csv")
def serve_indexes_csv():
    return _csv_response(os.path.join(PUBLIC, "Indexes-data.csv"), "Indexes-data.csv")

# ─── Serve React build (JS/CSS assets + SPA fallback) ────────────────────────
class _ImmutableStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = (
                "public, max-age=31536000, immutable, no-transform"
            )
        return response

DIST = os.path.join(os.path.dirname(__file__), "..", "app", "dist")
if os.path.exists(DIST):
    app.mount("/assets", _ImmutableStaticFiles(directory=os.path.join(DIST, "assets")), name="assets")

    @app.get("/manifest.json", include_in_schema=False)
    def _serve_manifest():
        return FileResponse(os.path.join(DIST, "manifest.json"), media_type="application/json")

    @app.get("/sw.js", include_in_schema=False)
    def _serve_sw():
        return FileResponse(os.path.join(DIST, "sw.js"), media_type="application/javascript; charset=utf-8")

    @app.get("/favicon.svg", include_in_schema=False)
    def _serve_favicon():
        return FileResponse(os.path.join(DIST, "favicon.svg"), media_type="image/svg+xml")

    @app.get("/vite.svg", include_in_schema=False)
    def _serve_vite_svg():
        return FileResponse(os.path.join(DIST, "vite.svg"), media_type="image/svg+xml")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        return FileResponse(
            os.path.join(DIST, "index.html"),
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )
