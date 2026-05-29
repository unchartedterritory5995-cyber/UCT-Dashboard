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
from fastapi.responses import FileResponse, JSONResponse, Response
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
import sentry_sdk
from api.limiter import limiter
from api.routers import snapshot, movers, engine_data, earnings, news, screener, trades, traders, push, charts, calendar as calendar_router, bars as bars_router
from api.routers import cot as cot_router
from api.routers import live_prices as live_prices_router
from api.routers import ticker_meta as ticker_meta_router
from api.routers import ticker_search as ticker_search_router
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
from api.routers import rs_ranking as rs_ranking_router
from api.routers import intelligence as intelligence_router
from api.routers import transcripts as transcripts_router
from api.routers import voice as voice_router
from api.routers import regime as regime_router
from api.routers import admin_chart_health as admin_chart_health_router
from api.routers import chart_news as chart_news_router
from api.routers import indicator_alerts as indicator_alerts_router
from api.routers import backtest as backtest_router
from api.routers import patterns as patterns_router
from api.routers import admin_patterns as admin_patterns_router
from api.routers import tweets as tweets_router
from api.routers import admin_twitter as admin_twitter_router
from api.routers import admin_api_health as admin_api_health_router
from api.routers import catalysts as catalysts_router
from api.flow_router import flow_router
from api.darkpool_router import router as darkpool_router
from api.discord_watchlist import register_discord_routes
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
        if _MAINTENANCE_MODE and not request.url.path.startswith("/api/auth") and request.url.path != "/api/maintenance" and request.url.path != "/api/health":
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


# ── Pattern engine learning-loop jobs (Phase 6) ─────────────────────────────
# Scheduled by APScheduler alongside the existing COT scheduler. All three
# wrappers catch every exception and log/print — a failed pattern job must
# NEVER crash the FastAPI app or trip the Railway healthcheck.

def _run_patterns_track_outcomes():
    """APScheduler job: resolve open pattern detections (entry/stop/target hits)."""
    _plog = logging.getLogger(__name__)
    try:
        from api.services.pattern_engine.memory import track_outcomes
        n = track_outcomes(lookback_hours=72)
        _plog.info("[patterns] track_outcomes: resolved %d detections", n)
        print(f"[patterns] track_outcomes: resolved {n} detections")
    except Exception as e:
        _plog.exception("[patterns] track_outcomes failed: %s", e)
        print(f"[patterns] track_outcomes failed: {e}")


def _run_patterns_recompute_stats():
    """APScheduler job: aggregate outcomes into pattern_stats nightly."""
    _plog = logging.getLogger(__name__)
    try:
        from api.services.pattern_engine.memory import recompute_stats
        n = recompute_stats()
        _plog.info("[patterns] recompute_stats: updated %d stat rows", n)
        print(f"[patterns] recompute_stats: updated {n} stat rows")
    except Exception as e:
        _plog.exception("[patterns] recompute_stats failed: %s", e)
        print(f"[patterns] recompute_stats failed: {e}")


def _run_patterns_universe_scan():
    """APScheduler job: scan leaders + a rotating chunk of cap_universe, store detections.

    Strategy:
      - Leader universe (curated ~80-200 liquid thematic stocks) scanned EVERY run.
      - Cap universe rotates through 4 chunks; one chunk per hourly run.
      - Each detection tagged with `from_leader_universe` flag for downstream filtering.

    Populates pattern_detections so the admin dashboard /admin/patterns has data
    for Gate 5 operator review and the /patterns scanner page can filter to leaders.
    """
    _plog = logging.getLogger(__name__)
    try:
        import time as _time
        from api.services import bars_sqlite
        from api.services.pattern_engine import detect_all
        from api.services.pattern_engine import memory
        from api.services.pattern_engine.primitives.context import build_context
        # Importing patterns router triggers detector registration:
        from api.routers import patterns as _patterns  # noqa: F401

        # Resolve leader_universe path
        leader_path = os.path.join(
            os.path.dirname(__file__), "data", "leader_universe.json"
        )
        if not os.path.exists(leader_path):
            leader_path = os.path.join("api", "data", "leader_universe.json")

        leader_tickers: list[str] = []
        if os.path.exists(leader_path):
            try:
                with open(leader_path) as f:
                    leader_data = json.load(f)
                leader_tickers = leader_data.get("tickers", []) if isinstance(leader_data, dict) else []
            except Exception as le:
                _plog.warning("[patterns] universe_scan: failed to load leader_universe: %s", le)

        # Resolve the cap_universe path
        universe_path = os.path.join(
            os.path.dirname(__file__), "data", "cap_universe.json"
        )
        if not os.path.exists(universe_path):
            universe_path = os.path.join("api", "data", "cap_universe.json")
        if not os.path.exists(universe_path):
            _plog.warning(
                "[patterns] universe_scan: cap_universe.json not found at %s",
                universe_path,
            )
            print(f"[patterns] universe_scan: cap_universe.json not found at {universe_path}")
            return

        with open(universe_path) as f:
            data = json.load(f)
        if isinstance(data, list):
            cap_tickers = [t for t in data if isinstance(t, str)]
        else:
            cap_tickers = data.get("tickers", []) if isinstance(data, dict) else []

        # Rotate through cap_universe in 4 chunks: one chunk per hourly run.
        hour_index = (int(_time.time()) // 3600) % 4
        cap_chunk_size = max(1, len(cap_tickers) // 4)
        cap_start = hour_index * cap_chunk_size
        cap_end = cap_start + cap_chunk_size
        cap_to_scan = cap_tickers[cap_start:cap_end]

        leader_set = {t for t in leader_tickers if isinstance(t, str)}

        timeframes = ["D"]
        scanned = 0
        stored = 0
        leader_stored = 0

        def _scan_one(sym: str, from_leader: bool) -> tuple[int, int]:
            """Scan a single sym; return (scanned, stored)."""
            s_scanned = 0
            s_stored = 0
            for tf in timeframes:
                try:
                    bars = bars_sqlite.get_bars(sym, tf, 200)
                except Exception as bars_err:
                    _plog.debug("[patterns] get_bars failed for %s %s: %s", sym, tf, bars_err)
                    continue
                if not bars or len(bars) < 30:
                    continue
                bars_list = [
                    {"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}
                    for r in bars
                ]
                try:
                    ctx = build_context(bars_list, sym=sym)
                    detections = detect_all(bars_list, ctx)
                    for d in detections:
                        d["sym"] = sym
                        d["tf"] = tf
                        # Tag detection origin (leader vs cap rotation)
                        try:
                            geom = d.setdefault("geometry", {})
                            extras = geom.setdefault("extras", {})
                            extras["from_leader_universe"] = bool(from_leader)
                        except Exception:
                            pass
                        try:
                            memory.store_detection(d)
                            s_stored += 1
                        except Exception as store_err:
                            _plog.debug("[patterns] store failed for %s: %s", sym, store_err)
                    s_scanned += 1
                except Exception as scan_err:
                    _plog.debug("[patterns] scan failed for %s %s: %s", sym, tf, scan_err)
            return s_scanned, s_stored

        # Scan leaders FIRST (every run)
        for sym in leader_tickers:
            sc, st = _scan_one(sym, from_leader=True)
            scanned += sc
            stored += st
            leader_stored += st

        # Scan rotating cap_universe chunk (skipping symbols already scanned as leaders)
        for sym in cap_to_scan:
            if sym in leader_set:
                continue
            sc, st = _scan_one(sym, from_leader=False)
            scanned += sc
            stored += st

        _plog.info(
            "[patterns] universe_scan: scanned %d symbol-TFs (leaders=%d, cap chunk %d/4), stored %d (leader %d)",
            scanned, len(leader_tickers), hour_index + 1, stored, leader_stored,
        )
        print(
            f"[patterns] universe_scan: scanned {scanned} symbol-TFs "
            f"(leaders={len(leader_tickers)}, cap chunk {hour_index + 1}/4), "
            f"stored {stored} detections ({leader_stored} from leader universe)"
        )
    except Exception as e:
        _plog.exception("[patterns] universe_scan failed: %s", e)
        print(f"[patterns] universe_scan failed: {e}")


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

    # Initialize tweets.db schema unconditionally — the schema is tiny and
    # idempotent. Frontend tweet UI (VITE_TWITTER_UI_ENABLED, default ON)
    # fires requests on every page load; without a schema, the read
    # endpoints would 500 on "no such table". Polling itself is still
    # gated separately by TWITTERAPI_IO_ENABLED below, so a missing key
    # results in an empty DB rather than crashes.
    try:
        from api.services import tweet_store
        tweet_store._init_db()
        print("[startup] tweets.db initialized")
    except Exception as e:
        print(f"[startup] tweet_store init failed (non-fatal): {e}")

    # Initialize catalysts.db schema unconditionally (same pattern as tweets.db).
    # Frontend tile fires /api/catalysts/today on every page load; without
    # schema, it would 500 on missing table.
    try:
        from api.services.catalyst import store as _cat_store
        _cat_store._init_db()
        print("[startup] catalysts.db initialized")
    except Exception as e:
        print(f"[startup] catalyst_store init failed (non-fatal): {e}")

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

    try:
        _start_priority_audit_background()
        logging.getLogger(__name__).info("[startup] priority audit scheduled (~30s after boot)")
    except Exception as e:
        logging.getLogger(__name__).exception("[startup] failed to schedule priority audit: %s", e)

    try:
        _start_hot_tier_warm_background()
        logging.getLogger(__name__).info("[startup] hot tier warm scheduled (~45s after boot)")
    except Exception:
        logging.getLogger(__name__).exception("[startup] failed to schedule hot tier warm")

    try:
        _start_rs_rankings_warm_background()
        logging.getLogger(__name__).info("[startup] rs-rankings warm scheduled (~120s after boot)")
    except Exception:
        logging.getLogger(__name__).exception("[startup] failed to schedule rs-rankings warm")

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

    # Start the reconciliation worker — diffs SQLite vs Polygon canonical
    # periodically, auto-heals any drift. Structural safety net behind every
    # chart correctness invariant. Only active on the worker pod
    # (RECONCILE_ENABLED=1) so the web pod doesn't compete on Polygon quota.
    try:
        from api.services import bars_reconciliation
        bars_reconciliation.start()
        logging.getLogger(__name__).info("[startup] bars_reconciliation started")
    except Exception:
        logging.getLogger(__name__).exception("[startup] bars_reconciliation start failed")

    try:
        from api.services import realtime_candle
        import asyncio
        asyncio.create_task(realtime_candle.reconciliation_worker())
        logging.getLogger(__name__).info("[startup] realtime_candle reconciliation_worker scheduled")
    except Exception as e:
        logging.getLogger(__name__).exception("[startup] failed to schedule reconciliation_worker: %s", e)

    # SQLite integrity check — heavy on 58M rows, run in background
    def _integrity_check_bg():
        try:
            from api.services import bars_sqlite as _bs_check
            import time as _ic_t
            _ic_t0 = _ic_t.time()
            if not _bs_check.integrity_ok():
                print(f"[startup] bars.db failed PRAGMA integrity_check after {_ic_t.time()-_ic_t0:.1f}s — pulling fresh snapshot from R2")
                try:
                    from api.services import data_sync as _ds_check
                    if _ds_check.force_resync():
                        print("[startup] bars.db restored from R2 snapshot")
                    else:
                        print("[startup] bars.db restore from R2 FAILED")
                except Exception as e:
                    print(f"[startup] force_resync error (non-fatal): {e}")
            else:
                print(f"[startup] bars.db integrity check passed ({_ic_t.time()-_ic_t0:.1f}s)")
        except Exception as e:
            print(f"[startup] bars.db integrity_check error (non-fatal): {e}")
    threading.Thread(target=_integrity_check_bg, daemon=True, name="sqlite-integrity").start()

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

    # ── FMP timezone-bug heal (one-shot, gated by flag) ─────────────────────
    # Commit 87b7d88 fixed _fetch_intraday_fmp which had stored bars at
    # timestamps shifted by the ET-UTC offset (FMP returns ET text; the
    # naive .strptime + .timestamp() round-tripped through the container's
    # UTC clock, landing every FMP-sourced row 4-5 hours BEHIND its true
    # moment). New writes are correct, but the bug's poisoned rows sit at
    # WRONG ts values — INSERT OR REPLACE on a *correct* ts touches a
    # different primary-key tuple, so Massive's later good writes never
    # overwrite the bad rows and the chart stays corrupt.
    #
    # Surgical heal: drop intraday rows from the last 14 days only. That's
    # the window where the bug actively wrote (older bars are immutable
    # history that pre-dates the bug being live on this code path, and
    # wiping deep intraday would lose months of chart context for nothing).
    # The next user request on each chart triggers a Massive refetch under
    # the fixed FMP fallback path and refills correctly. Daily/Weekly/Monthly
    # are untouched — the bug was intraday-only.
    try:
        _heal_flag = os.path.join(os.environ.get("DATA_DIR", "/data"), ".fmp_tz_heal_v1")
        if not os.path.exists(_heal_flag):
            import sqlite3 as _heal_sqlite
            import time as _heal_t
            db_path = os.path.join(os.environ.get("DATA_DIR", "/data"), "bars.db")
            if os.path.exists(db_path):
                cutoff = int(_heal_t.time()) - 14 * 86400  # 14 days back
                conn = _heal_sqlite.connect(db_path, timeout=30)
                try:
                    conn.execute("PRAGMA busy_timeout=30000")
                    cur = conn.execute(
                        "DELETE FROM ohlcv WHERE tf IN ('1','5','15','30','60') AND ts > ?",
                        (cutoff,),
                    )
                    deleted = cur.rowcount
                    conn.commit()
                    print(f"[startup] fmp_tz_heal: removed {deleted} intraday rows from last 14d; next chart load on each ticker refills clean")
                finally:
                    conn.close()
                # Bump epoch so all thread-local connections see the fresh state.
                try:
                    from api.services import bars_sqlite as _heal_bs
                    _heal_bs.bump_db_epoch()
                except Exception:
                    pass
                # Also clear in-memory + disk JSON cache for intraday so they
                # don't keep serving the corrupt payload until SQLite repopulates.
                try:
                    from api.services.cache import cache as _heal_mem
                    _mem_deleted = _heal_mem.delete_prefix("bars_")
                    print(f"[startup] fmp_tz_heal: cleared {_mem_deleted} in-memory bars cache entries")
                except Exception:
                    pass
                try:
                    _disk_dir = os.path.join(os.environ.get("DATA_DIR", "/data"), "bars_cache")
                    if os.path.isdir(_disk_dir):
                        _dn = 0
                        for _fn in os.listdir(_disk_dir):
                            # bars_cache filenames: "{SYM}_{tf}_{bars}.json"
                            if not _fn.endswith(".json"):
                                continue
                            _parts = _fn[:-5].split("_")
                            if len(_parts) >= 2 and _parts[1] in ("1", "5", "15", "30", "60"):
                                try:
                                    os.remove(os.path.join(_disk_dir, _fn))
                                    _dn += 1
                                except OSError:
                                    pass
                        print(f"[startup] fmp_tz_heal: removed {_dn} intraday disk-cache files")
                except Exception:
                    pass
            try:
                with open(_heal_flag, "w") as _f:
                    _f.write("done")
            except OSError:
                pass
    except Exception as e:
        print(f"[startup] fmp_tz_heal error (non-fatal): {e}")

    # ── Strict-> heal (one-shot, gated by flag) ────────────────────────────────
    # Companion to the `>=` filter relaxation in _delta_intraday (commit shipped
    # alongside this). The prior strict-> filter left a class of permanently
    # wrong rows in SQLite: any chart loaded mid-hour during 5/8-5/22 would
    # write a partial in-progress bar (e.g. BB 5/21 13:00 ET stored at the
    # 13:15 ET snapshot value C=6.47 V=738K), and the strict-> filter prevented
    # any later delta from overwriting it even after the source 30min closed.
    # Heal v1 (.fmp_tz_heal_v1) was supposed to clear these but either didn't
    # run cleanly or got re-poisoned by an in-session refetch. This v2 wipes
    # the same 14-day window again with a fresh flag so it definitively fires
    # once. With `>=` now in effect, the next chart load on each ticker
    # repopulates from Massive's authoritative closed-bar data.
    try:
        _heal_flag_v2 = os.path.join(os.environ.get("DATA_DIR", "/data"), ".strict_gt_heal_v2")
        if not os.path.exists(_heal_flag_v2):
            import sqlite3 as _heal_sqlite_v2
            import time as _heal_t_v2
            db_path_v2 = os.path.join(os.environ.get("DATA_DIR", "/data"), "bars.db")
            if os.path.exists(db_path_v2):
                cutoff_v2 = int(_heal_t_v2.time()) - 14 * 86400  # last 14 days
                conn_v2 = _heal_sqlite_v2.connect(db_path_v2, timeout=30)
                try:
                    conn_v2.execute("PRAGMA busy_timeout=30000")
                    cur_v2 = conn_v2.execute(
                        "DELETE FROM ohlcv WHERE tf IN ('1','5','15','30','60') AND ts >= ?",
                        (cutoff_v2,),
                    )
                    deleted_v2 = cur_v2.rowcount
                    conn_v2.commit()
                    print(f"[startup] strict_gt_heal_v2: removed {deleted_v2} intraday rows from last 14d (companion to >= filter relaxation)")
                finally:
                    conn_v2.close()
                try:
                    from api.services import bars_sqlite as _heal_bs_v2
                    _heal_bs_v2.bump_db_epoch()
                except Exception:
                    pass
                try:
                    from api.services.cache import cache as _heal_mem_v2
                    _mem_deleted_v2 = _heal_mem_v2.delete_prefix("bars_")
                    print(f"[startup] strict_gt_heal_v2: cleared {_mem_deleted_v2} in-memory bars cache entries")
                except Exception:
                    pass
                try:
                    _disk_dir_v2 = os.path.join(os.environ.get("DATA_DIR", "/data"), "bars_cache")
                    if os.path.isdir(_disk_dir_v2):
                        _dn_v2 = 0
                        for _fn_v2 in os.listdir(_disk_dir_v2):
                            if not _fn_v2.endswith(".json"):
                                continue
                            _parts_v2 = _fn_v2[:-5].split("_")
                            if len(_parts_v2) >= 2 and _parts_v2[1] in ("1", "5", "15", "30", "60"):
                                try:
                                    os.remove(os.path.join(_disk_dir_v2, _fn_v2))
                                    _dn_v2 += 1
                                except OSError:
                                    pass
                        print(f"[startup] strict_gt_heal_v2: removed {_dn_v2} intraday disk-cache files")
                except Exception:
                    pass
            try:
                with open(_heal_flag_v2, "w") as _f:
                    _f.write("done")
            except OSError:
                pass
    except Exception as e:
        print(f"[startup] strict_gt_heal_v2 error (non-fatal): {e}")

    # ── Intraday heal v3: 60-day deep history wipe (one-shot, gated by flag) ──
    # v1 + v2 covered the last 14 days. Bars older than 14 days could still
    # carry legacy artifacts from pre-fix code: FMP-shifted timestamps,
    # partial-bar storage frozen by the prior strict-> filter, validation
    # rejections that left gaps which never refilled. Extending the wipe to
    # 60 days clears the bulk of accumulated muscle memory and lets the now-
    # correct fetch+resample paths rebuild from Polygon canonical.
    # Trade-off: more cold-load slowness on the long tail of tickers for ~1-2
    # hours after deploy as the cache repopulates. Acceptable since markets
    # are closed (weekend) — heals before Tuesday open with zero user impact.
    # The reconciliation worker (shipped alongside) then keeps it clean going
    # forward without ever needing another mass-wipe.
    try:
        _heal_flag_v3 = os.path.join(os.environ.get("DATA_DIR", "/data"), ".intraday_heal_v3_60day")
        if not os.path.exists(_heal_flag_v3):
            import sqlite3 as _heal_sqlite_v3
            import time as _heal_t_v3
            db_path_v3 = os.path.join(os.environ.get("DATA_DIR", "/data"), "bars.db")
            if os.path.exists(db_path_v3):
                cutoff_v3 = int(_heal_t_v3.time()) - 60 * 86400  # last 60 days
                conn_v3 = _heal_sqlite_v3.connect(db_path_v3, timeout=60)
                try:
                    conn_v3.execute("PRAGMA busy_timeout=60000")
                    cur_v3 = conn_v3.execute(
                        "DELETE FROM ohlcv WHERE tf IN ('1','5','15','30','60') AND ts >= ?",
                        (cutoff_v3,),
                    )
                    deleted_v3 = cur_v3.rowcount
                    conn_v3.commit()
                    print(f"[startup] intraday_heal_v3_60day: removed {deleted_v3} intraday rows from last 60d")
                finally:
                    conn_v3.close()
                try:
                    from api.services import bars_sqlite as _heal_bs_v3
                    _heal_bs_v3.bump_db_epoch()
                except Exception:
                    pass
                try:
                    from api.services.cache import cache as _heal_mem_v3
                    _mem_deleted_v3 = _heal_mem_v3.delete_prefix("bars_")
                    print(f"[startup] intraday_heal_v3_60day: cleared {_mem_deleted_v3} in-memory bars cache entries")
                except Exception:
                    pass
                try:
                    _disk_dir_v3 = os.path.join(os.environ.get("DATA_DIR", "/data"), "bars_cache")
                    if os.path.isdir(_disk_dir_v3):
                        _dn_v3 = 0
                        for _fn_v3 in os.listdir(_disk_dir_v3):
                            if not _fn_v3.endswith(".json"):
                                continue
                            _parts_v3 = _fn_v3[:-5].split("_")
                            if len(_parts_v3) >= 2 and _parts_v3[1] in ("1", "5", "15", "30", "60"):
                                try:
                                    os.remove(os.path.join(_disk_dir_v3, _fn_v3))
                                    _dn_v3 += 1
                                except OSError:
                                    pass
                        print(f"[startup] intraday_heal_v3_60day: removed {_dn_v3} intraday disk-cache files")
                except Exception:
                    pass
            try:
                with open(_heal_flag_v3, "w") as _f:
                    _f.write("done")
            except OSError:
                pass
    except Exception as e:
        print(f"[startup] intraday_heal_v3_60day error (non-fatal): {e}")

    # Chart pipeline mode fingerprint — one line so a grep on Tuesday morning
    # tells the operator EXACTLY which fixes are active in this deploy.
    print(
        "[startup] chart-realtime-mode: "
        "fmp_tz_fix=on yfinance_tz_fix=on heal_v1=ran-once heal_v2=ran-once heal_v3_60day=ran-once "
        "needs_fresh_post_market=on "
        "swr_refresh_interval=30s_intraday "
        "tf60_ws_streaming=on bucket_canonical=bars_fetch.bucket_60_et_unix_seconds "
        "delta_intraday_filter=>= idb_cache_logic_version=4 "
        f"reconciliation_worker={'on' if os.environ.get('RECONCILE_ENABLED') == '1' else 'off'}"
    )

    if os.environ.get("USE_REMOTE_BARS") == "1":
        print("[startup] Memory pre-warm skipped (USE_REMOTE_BARS=1); cache populates lazily after snapshot pull")
    else:
        def _memory_prewarm_background():
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
        threading.Thread(target=_memory_prewarm_background, daemon=True, name="memory-prewarm").start()
        print("[startup] Memory pre-warm scheduled (background thread)")

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

    # Slow background backfill: warm the ticker_meta disk cache for every
    # cap_universe ticker so /api/ticker-search autocomplete shows company
    # names for any ticker, not just ones previously viewed. Skips already-
    # fresh entries on each boot. Daemon thread — never blocks startup.
    try:
        from api.services.ticker_names_prewarm import start_async as _names_start
        _names_start()
        print("[startup] ticker-names prewarm scheduled")
    except Exception as e:
        print(f"[startup] ticker-names prewarm scheduling failed (non-fatal): {e}")

    if os.environ.get("USE_REMOTE_BARS") == "1":
        from api.services import data_sync

        try:
            _skip_boot_pull = False
            try:
                import sqlite3 as _sqlite_probe
                _db_probe_path = os.path.join(os.environ.get("DATA_DIR", "/data"), "bars.db")
                if os.path.exists(_db_probe_path):
                    _pc = _sqlite_probe.connect(_db_probe_path, timeout=5)
                    try:
                        _row = _pc.execute("SELECT COUNT(*) FROM (SELECT 1 FROM ohlcv LIMIT 1000)").fetchone()
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

            if not _skip_boot_pull:
                def _initial_pull():
                    import time as _t
                    _t0 = _t.time()
                    try:
                        ts = data_sync.sync_if_newer()
                        elapsed = _t.time() - _t0
                        if ts:
                            print(f"[startup] Initial snapshot pull complete in {elapsed:.1f}s "
                                  f"— cache warm, serving from snapshot {ts}")
                        else:
                            print(f"[startup] Initial snapshot already current ({elapsed:.1f}s) — cache warm")
                    except Exception as e:
                        elapsed = _t.time() - _t0
                        print(f"[startup] Initial snapshot pull FAILED after {elapsed:.1f}s "
                              f"(non-fatal): {e} — proceeding with cold cache")
                threading.Thread(target=_initial_pull, daemon=True, name="initial_snapshot_pull").start()
                print("[startup] R2 initial snapshot pull started (background thread)")
        except Exception as e:
            print(f"[startup] Initial snapshot pull error (non-fatal): {e}")

        _legacy_replace = os.environ.get("R2_PERIODIC_PULL_LEGACY_REPLACE") == "1"

        def _s3_pull_loop():
            import time as _t
            while True:
                _t.sleep(data_sync.SNAPSHOT_INTERVAL_SECONDS)
                try:
                    if _legacy_replace:
                        ts = data_sync.sync_if_newer()
                        if ts:
                            print(f"[data_sync] (legacy replace) pulled snapshot {ts}")
                    else:
                        ts = data_sync.sync_if_newer_merge()
                        if ts:
                            print(f"[data_sync] merged snapshot {ts} (newer-wins)")
                except Exception as e:
                    print(f"[data_sync] pull error (non-fatal): {e}")

        threading.Thread(target=_s3_pull_loop, daemon=True, name="s3_pull").start()
        print(
            f"[startup] S3 periodic puller started "
            f"({data_sync.SNAPSHOT_INTERVAL_SECONDS // 60}-min cadence; mode="
            f"{'LEGACY-REPLACE' if _legacy_replace else 'newer-wins-merge'})"
        )

        # P-2: publish the web-recorded intraday hot-set to R2 so the
        # WORKER's prewarmer (separate process, can't see web memory)
        # prioritises the tickers users actually open. ~1 tiny PUT/2min.
        def _hotset_push_loop():
            import time as _t
            from api.services.bars_fetch import get_hot_intraday_tickers
            while True:
                _t.sleep(120)
                try:
                    hs = get_hot_intraday_tickers(500)
                    if hs:
                        data_sync.put_hotset(hs)
                except Exception as e:
                    print(f"[hotset] push error (non-fatal): {e}")

        threading.Thread(target=_hotset_push_loop, daemon=True, name="hotset_push").start()
        print("[startup] hot-set push loop started (web -> R2, 2-min cadence)")

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

    try:
        from api.services.voice_kb_service import seed_on_startup as _kb_seed
        import threading as _t
        _t.Thread(target=_kb_seed, daemon=True, name="voice-kb-seed").start()
    except Exception as e:
        print(f"[startup] Voice KB seed scheduling failed (non-fatal): {e}")

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
    def _flow_db_seed_background():
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
    threading.Thread(target=_flow_db_seed_background, daemon=True, name="flow-db-seed").start()

    # ── Darkpool DB: auto-seed from static CSV if available ────────────────
    def _darkpool_db_seed_background():
        try:
            from api import darkpool_db
            _stats = darkpool_db.get_stats()
            _public_dir = os.path.join(os.path.dirname(__file__), "..", "app", "public")
            _dp_csv = os.path.join(_public_dir, "Darkpool-data.csv")

            if _stats["total_rows"] == 0:
                if os.path.exists(_dp_csv):
                    with open(_dp_csv, "r", encoding="utf-8-sig") as _f:
                        _result = darkpool_db.insert_csv_rows(_f.read())
                    print(f"[startup] Darkpool DB seeded: {_result['inserted']:,} new rows from Darkpool-data.csv ({_result['total']:,} total in file)")
                else:
                    print(f"[startup] Darkpool DB: no Darkpool-data.csv found at {_dp_csv}")
            else:
                if os.path.exists(_dp_csv):
                    with open(_dp_csv, "r", encoding="utf-8-sig") as _f:
                        _result = darkpool_db.insert_csv_rows(_f.read())
                    if _result["inserted"] > 0:
                        print(f"[startup] Darkpool DB: +{_result['inserted']:,} new rows, {_result['duplicates']:,} dupes skipped")
                    else:
                        print(f"[startup] Darkpool DB: {_stats['total_rows']:,} rows, {_stats['trading_days']} days — up to date")

            # Auto-prune to 120 trading days (matches darkpool retention policy)
            _pruned = darkpool_db.prune_old_data(keep_days=120)
            if _pruned:
                print(f"[startup] Darkpool DB pruned {_pruned} rows beyond 120-day window")
        except Exception as e:
            print(f"[startup] Darkpool DB auto-seed error (non-fatal): {e}")
    threading.Thread(target=_darkpool_db_seed_background, daemon=True, name="darkpool-db-seed").start()

    try:
        _cot_service.init_db()
        if _cot_service.is_empty():
            print("[startup] COT table empty — seeding from CFTC historical archive (background)...")
            threading.Thread(target=_cot_seed_background, daemon=True, name="cot-seed").start()
        else:
            from datetime import date as _date
            now_et = datetime.now(ZoneInfo("America/New_York"))
            latest_iso = _cot_service.get_latest_date()
            expected = _cot_service.expected_latest_report_date(now_et)
            if latest_iso and _date.fromisoformat(latest_iso) < expected:
                days_old = (now_et.date() - _date.fromisoformat(latest_iso)).days
                print(
                    f"[startup] COT data stale — latest={latest_iso} expected={expected} "
                    f"({days_old}d old) — running catch-up refresh..."
                )
                threading.Thread(target=_cot_catchup_background, daemon=True, name="cot-catchup").start()
            else:
                print(f"[startup] COT database ready (latest: {latest_iso}).")
    except Exception as e:
        print(f"[startup] COT init error (non-fatal): {e}")

    from api.services.scheduler_lock import acquire_scheduler_lock
    _scheduler = None
    if acquire_scheduler_lock():
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.cron import CronTrigger
        from apscheduler.triggers.interval import IntervalTrigger
        from api.services.auth_service import cleanup_expired_sessions, cleanup_expired_tokens, record_mrr_snapshot
        _scheduler = BackgroundScheduler(timezone=ZoneInfo("America/New_York"))

        # ── Compass automation master switch ──────────────────────────────
        # Pauses ALL automated (scheduled) Compass + voice LLM interactions
        # to prevent accidental token burn. Manual / on-demand Compass
        # surfaces are UNAFFECTED — those are always user-initiated:
        #   • Compass chat (text + voice)
        #   • Pre-Trade Verdict + Per-Trade Post-Mortem buttons
        #   • "Generate EOD recap / weekly review now" endpoints
        #   • Manual voice scan / consolidate endpoints
        #   • Rule-based real-time intervention banners (no LLM tokens)
        #
        # Paused 2026-05-18 at user request. Default = OFF, so automation
        # stays paused across Railway redeploys until explicitly resumed.
        # Resume by EITHER:
        #   • setting Railway env var  COMPASS_AUTOMATION_ENABLED=1,  or
        #   • flipping the default below to "1" and redeploying.
        import os as _os_ca
        _compass_automation_on = (
            _os_ca.environ.get("COMPASS_AUTOMATION_ENABLED", "0") == "1"
        )

        def _add_compass_job(*args, **kwargs):
            """Register a job ONLY if Compass automation is enabled.

            All automated Compass/voice LLM jobs go through this instead of
            ``_scheduler.add_job`` so a single switch governs them. The
            scheduler uses the in-memory jobstore, so a job that is not
            re-added here simply does not exist after restart."""
            if _compass_automation_on:
                _scheduler.add_job(*args, **kwargs)
            else:
                print(
                    f"[startup] Compass automation PAUSED — skipping "
                    f"job '{kwargs.get('id', '?')}' "
                    f"(set COMPASS_AUTOMATION_ENABLED=1 to resume)"
                )

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

        # ── Twitter News Ingestion (spec 2026-05-25) ──────────────────────
        # Burst windows (every 2 min) cover the high-value pre-market and
        # post-close trading hours; regular cadence handles mid-day; slow
        # hourly job is a safety net (since_id makes overlap free).
        if os.environ.get("TWITTERAPI_IO_ENABLED", "").lower() in ("1", "true", "yes"):
            from api.services.tweet_poller import poll_all_accounts as _tw_poll
            from api.services.tweet_cleanup import run_cleanup as _tw_cleanup

            _scheduler.add_job(_tw_poll, trigger=CronTrigger(day_of_week="mon-fri", hour="4-9", minute="*/2"),
                               id="tweet_poll_burst_premarket", max_instances=1, replace_existing=True)
            _scheduler.add_job(_tw_poll, trigger=CronTrigger(day_of_week="mon-fri", hour="9", minute="30-58/2"),
                               id="tweet_poll_burst_open", max_instances=1, replace_existing=True)
            _scheduler.add_job(_tw_poll, trigger=CronTrigger(day_of_week="mon-fri", hour="15", minute="30-58/2"),
                               id="tweet_poll_burst_close", max_instances=1, replace_existing=True)
            _scheduler.add_job(_tw_poll, trigger=CronTrigger(day_of_week="mon-fri", hour="16-19", minute="*/2"),
                               id="tweet_poll_burst_amc", max_instances=1, replace_existing=True)
            _scheduler.add_job(_tw_poll, trigger=CronTrigger(day_of_week="mon-fri", hour="10-15", minute="*/15"),
                               id="tweet_poll_regular_midday", max_instances=1, replace_existing=True)
            # Slow safety-net — overlap with burst is intentional; since_id
            # makes duplicate fetches free.
            _scheduler.add_job(_tw_poll, trigger=CronTrigger(minute="0"),
                               id="tweet_poll_slow", max_instances=1, replace_existing=True)
            _scheduler.add_job(_tw_cleanup, trigger=CronTrigger(hour=3, minute=0),
                               id="tweet_cleanup_daily", max_instances=1, replace_existing=True)
            print("[scheduler] tweet poll jobs registered")

        # ── Morning Catalyst Engine (spec 2026-05-25) ─────────────────────
        # Schedule v3 2026-05-27 evening (user-defined): two focused windows
        # mirroring the user's actual trading workflow. Everything outside
        # these windows is manual-only via the ↻ Refresh button on the tile.
        #   • 6:00–9:30 AM ET every 30 min — pre-market discovery (8 fires)
        #   • 4:00–4:30 PM ET every 5 min — AMC earnings burst (7 fires)
        # Total 15 auto refreshes/day on weekdays (mon-fri).
        # Scheduler timezone is America/New_York (set at BackgroundScheduler init).
        if os.environ.get("CATALYST_ENGINE_ENABLED", "").lower() in ("1", "true", "yes"):
            from api.services.catalyst.engine import run_refresh as _cat_refresh

            # Pre-market: 6:00, 6:30, 7:00, 7:30, 8:00, 8:30, 9:00, 9:30 ET
            _scheduler.add_job(_cat_refresh,
                trigger=CronTrigger(day_of_week="mon-fri", hour="6-9", minute="0,30"),
                id="catalyst_premarket", max_instances=1, replace_existing=True)

            # AMC earnings burst: 4:00, 4:05, 4:10, 4:15, 4:20, 4:25, 4:30 PM ET
            _scheduler.add_job(_cat_refresh,
                trigger=CronTrigger(day_of_week="mon-fri", hour="16", minute="0-30/5"),
                id="catalyst_amc_burst", max_instances=1, replace_existing=True)

            print("[scheduler] catalyst engine jobs registered (premarket 6-9:30 ET every 30m + AMC burst 4-4:30 ET every 5m)")

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

        def _voice_window_scan(window: str):
            try:
                from api.services.auth_db import get_connection as _gc
                from api.services.voice_proactive_service import (
                    scan_for_opportunities, maybe_emit_regime_shift,
                    scan_premarket, scan_after_hours,
                )
                from api.services.voice_drift_detector import emit_drift_insights
                conn = _gc()
                try:
                    rows = conn.execute(
                        """SELECT DISTINCT vs.user_id FROM voice_settings vs
                           WHERE vs.enabled = 1"""
                    ).fetchall()
                finally:
                    conn.close()
                for r in rows:
                    uid = r["user_id"]
                    try:
                        if window == "premarket":
                            scan_premarket(uid)
                            maybe_emit_regime_shift(uid)
                        elif window == "rth":
                            scan_for_opportunities(uid)
                            maybe_emit_regime_shift(uid)
                            emit_drift_insights(uid)
                        elif window == "after_hours":
                            scan_after_hours(uid)
                    except Exception as e:
                        print(f"[voice_proactive] {window} user={uid} failed: {e}")
            except Exception as e:
                print(f"[voice_proactive] {window} outer error: {e}")

        _add_compass_job(lambda: _voice_window_scan("premarket"),
                           trigger=CronTrigger(day_of_week="mon-fri",
                                               hour="7-9", minute="*/15"),
                           id="voice_proactive_premarket",
                           max_instances=1, replace_existing=True)
        _add_compass_job(lambda: _voice_window_scan("rth"),
                           trigger=CronTrigger(day_of_week="mon-fri",
                                               hour="9-15", minute="*/30"),
                           id="voice_proactive_scan",
                           max_instances=1, replace_existing=True)
        _add_compass_job(lambda: _voice_window_scan("after_hours"),
                           trigger=CronTrigger(day_of_week="mon-fri",
                                               hour="16-20", minute="*/30"),
                           id="voice_proactive_after_hours",
                           max_instances=1, replace_existing=True)

        def _compass_daily_focus_run():
            try:
                from api.services.voice_daily_focus import run_for_all_enabled_users
                report = run_for_all_enabled_users()
                print(f"[compass_daily_focus] posted={report['posted']} "
                      f"skipped={report['skipped']}")
            except Exception as e:
                print(f"[compass_daily_focus] outer error: {e}")
        _add_compass_job(_compass_daily_focus_run,
                           trigger=CronTrigger(day_of_week="mon-fri",
                                               hour=7, minute=30),
                           id="compass_daily_focus",
                           max_instances=1, replace_existing=True)

        def _voice_nightly_consolidate():
            try:
                from api.services.auth_db import get_connection as _gc
                from api.services.voice_active_learning import consolidate_memory
                conn = _gc()
                try:
                    rows = conn.execute(
                        """SELECT DISTINCT user_id FROM voice_settings
                            WHERE enabled = 1"""
                    ).fetchall()
                finally:
                    conn.close()
                for r in rows:
                    try:
                        consolidate_memory(r["user_id"])
                    except Exception as e:
                        print(f"[voice_consolidate] user={r['user_id']} failed: {e}")
            except Exception as e:
                print(f"[voice_consolidate] outer error: {e}")
        _add_compass_job(_voice_nightly_consolidate,
                           trigger=CronTrigger(hour=3, minute=30),
                           id="voice_nightly_consolidate",
                           max_instances=1, replace_existing=True)

        def _nightly_flow_prune():
            try:
                from api.flow_db import FlowDB
                pruned = FlowDB().prune_expired(buffer_days=1)
                if pruned:
                    print(f"[scheduler] Flow DB pruned {pruned} expired rows")
            except Exception as e:
                print(f"[scheduler] Flow DB prune error: {e}")

        _scheduler.add_job(_nightly_flow_prune, trigger=CronTrigger(hour=20, minute=0), id="flow_nightly_prune", max_instances=1, replace_existing=True)

        _scheduler.add_job(_voice_cache_purge, trigger=CronTrigger(hour=3, minute=30), id="voice_audio_cache_purge", max_instances=1, replace_existing=True)

        def _compass_eod_job():
            import os as _os
            # Per-surface kill switch (default OFF) — paused 2026-05-27 at user request for cost.
            # Belt-and-suspenders even if COMPASS_AUTOMATION_ENABLED is flipped on.
            if _os.environ.get("COMPASS_EOD_RECAP_ENABLED", "0") != "1":
                print("[scheduler] Compass EOD: paused via COMPASS_EOD_RECAP_ENABLED=0 — no tokens spent")
                return
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

        _add_compass_job(
            _compass_eod_job,
            trigger=CronTrigger(day_of_week="mon-fri", hour=16, minute=30),
            id="compass_eod_recap",
            max_instances=1,
            replace_existing=True,
        )

        def _compass_weekly_email_job():
            import os as _os
            # Per-surface kill switch (default OFF) — paused 2026-05-27 at user request for cost.
            # Belt-and-suspenders even if COMPASS_AUTOMATION_ENABLED is flipped on.
            if _os.environ.get("COMPASS_WEEKLY_DIGEST_ENABLED", "0") != "1":
                print("[scheduler] Compass weekly digest: paused via COMPASS_WEEKLY_DIGEST_ENABLED=0 — no tokens spent")
                return
            if not _os.environ.get("ANTHROPIC_API_KEY"):
                print("[scheduler] Compass weekly email: ANTHROPIC_API_KEY missing — skipping batch")
                return
            try:
                from api.services.journal_two.coach_email_digest import (
                    run_for_all_enabled_accounts as _run,
                    run_unified_for_all_users as _run_unified,
                )
                report = _run()
                print(f"[scheduler] Compass weekly email batch: "
                      f"sent={report['sent']} skipped={report['skipped']} "
                      f"errors={report['errors']}")
                ureport = _run_unified()
                print(f"[scheduler] Compass unified weekly email batch: "
                      f"sent={ureport['sent']} skipped={ureport['skipped']} "
                      f"errors={ureport['errors']}")
            except Exception as e:  # noqa: BLE001
                print(f"[scheduler] Compass weekly email batch error: {e}")

        _add_compass_job(
            _compass_weekly_email_job,
            trigger=CronTrigger(day_of_week="sun", hour=8, minute=0),
            id="compass_weekly_email_digest",
            max_instances=1,
            replace_existing=True,
        )

        _scheduler.add_job(
            _run_patterns_track_outcomes,
            trigger=IntervalTrigger(hours=4),
            id="patterns_track_outcomes",
            max_instances=1,
            replace_existing=True,
        )
        _scheduler.add_job(
            _run_patterns_recompute_stats,
            trigger=CronTrigger(hour=6, minute=0, timezone="UTC"),
            id="patterns_recompute_stats",
            max_instances=1,
            replace_existing=True,
        )
        _scheduler.add_job(
            _run_patterns_universe_scan,
            trigger=IntervalTrigger(hours=1),
            id="patterns_universe_scan",
            max_instances=1,
            replace_existing=True,
        )

        # Discord flow watchlist — manual push only (no scheduled jobs)

        _scheduler.start()
        print("[startup] COT scheduler running — Fridays at 3:50 PM ET (retries 4:15, 4:45); daily catchup at 6 PM ET")
        print("[startup] Session cleanup scheduled — daily at 3:00 AM ET")
        print("[startup] Churn risk check scheduled — daily at 9:00 AM ET")
        print("[startup] MRR snapshot scheduled — daily at 11:59 PM ET")
        if _compass_automation_on:
            print("[startup] Compass automation ENABLED — proactive scans, daily focus, EOD recap, weekly digest scheduled")
        else:
            print("[startup] Compass automation PAUSED — all scheduled Compass/voice jobs skipped; manual surfaces unaffected (set COMPASS_AUTOMATION_ENABLED=1 to resume)")
        print("[startup] Pattern engine jobs scheduled — outcomes (4h interval), stats (06:00 UTC daily), universe scan (1h interval)")
    else:
        print("[startup] APScheduler skipped — lock held by another uvicorn worker (multi-worker mode)")

    yield
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
    stop_snapshot_scheduler()

app = FastAPI(title="UCT Dashboard", lifespan=lifespan)
app.add_middleware(MaintenanceMiddleware)
from starlette.middleware.cors import CORSMiddleware as _CORS
app.add_middleware(_CORS, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
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
app.include_router(live_prices_router.router)
app.include_router(ticker_meta_router.router)
app.include_router(ticker_search_router.router)
app.include_router(rs_ranking_router.router)
app.include_router(intelligence_router.router)
app.include_router(transcripts_router.router)
app.include_router(voice_router.router)
app.include_router(regime_router.router)
app.include_router(admin_chart_health_router.router)
app.include_router(chart_news_router.router)
app.include_router(indicator_alerts_router.router)
app.include_router(backtest_router.router)
app.include_router(patterns_router.router)
app.include_router(admin_patterns_router.router)
app.include_router(gex_router)
app.include_router(watchlist_router)
app.include_router(flow_router)
app.include_router(darkpool_router)
app.include_router(tweets_router.router)
app.include_router(admin_twitter_router.router)
app.include_router(admin_api_health_router.router)
app.include_router(catalysts_router.router)

# Discord flow watchlist — manual trigger endpoint
register_discord_routes(app)

# ─── CSV routes: serve from app/public/ directly (fallback for legacy paths) ──
PUBLIC = os.path.join(os.path.dirname(__file__), "..", "app", "public")

_CSV_CACHE_HEADERS = {
    "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    "Vary": "Accept-Encoding",
}

def _csv_response(csv_path: str, filename: str):
    if os.path.exists(csv_path):
        with open(csv_path, "rb") as f:
            content = f.read()
        return Response(content=content, media_type="text/csv", headers={
            **_CSV_CACHE_HEADERS,
            "Content-Disposition": f'inline; filename="{filename}"',
        })
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
