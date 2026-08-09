import os
import json
import logging
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime
from zoneinfo import ZoneInfo

# APScheduler trap: a pre-built CronTrigger(...) resolves tzlocal (UTC on
# Railway), NOT the scheduler's timezone -- every trigger below must carry
# an explicit timezone or its "ET" schedule silently fires 4h early.
_ET = ZoneInfo("America/New_York")

# Process boot time -- exposed via /api/health so an operator can tell a
# healthy long-lived pod (uptime climbs steadily) from a silently
# restarting / idle-respawning one (uptime keeps resetting). The 12s
# cold-start that makes the first chart load slow shows up here as a
# freshly-reset uptime.
_APP_BOOT_TS = time.time()

# Configure logging early -- before any service imports -- so that INFO messages
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

from fastapi import FastAPI, Request, Depends
from api.middleware.auth_middleware import get_current_user, require_admin
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, Response
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
import sentry_sdk
from api.limiter import limiter
from api.routers import snapshot, movers, engine_data, earnings, news, screener, traders, push, charts, calendar as calendar_router, bars as bars_router
from api.routers import cot as cot_router
from api.routers import render_panels as render_panels_router
from api.routers import live_prices as live_prices_router
from api.routers import ticker_meta as ticker_meta_router
from api.routers import ticker_search as ticker_search_router
from api.routers import breadth_monitor as breadth_monitor_router
from api.routers import theme_performance as theme_performance_router
from api.routers import groups as groups_router
from api.routers import sector_strength as sector_strength_router
from api.services import cot_service as _cot_service
from api.top_flow_router import router as top_flow_router
from api.flow_scoreboard import router as flow_scoreboard_router
from api.flow_explain import router as flow_explain_router
from api import top_flow_tracker as _top_flow_tracker
from api.schwab_router import router as schwab_router
from api.routers import insider as insider_router
from api.routers import auth as auth_router
from api.routers import support_status as support_status_router
from api.routers import avatar as avatar_router
from api.routers import webhooks as webhooks_router
from api.routers import alerts as alerts_router
from api.routers import journal_two as journal_two_router
from api.routers import community as community_router
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
from api.routers import signature as signature_router
from api.routers import backtest as backtest_router
from api.routers import patterns as patterns_router
from api.routers import admin_patterns as admin_patterns_router
from api.routers import tweets as tweets_router
from api.routers import admin_twitter as admin_twitter_router
from api.routers import admin_purge as admin_purge_router
from api.routers import desk as desk_router
from api.routers import admin_api_health as admin_api_health_router
from api.routers import provider_coverage as provider_coverage_router
from api.routers import catalysts as catalysts_router
from api.routers import wire_feedback as wire_feedback_router
from api.routers import modelbook as modelbook_router
from api.routers import news_catalysts as news_catalysts_router
from api.routers import stock_brief as stock_brief_router
from api.routers import charts_layouts as charts_layouts_router
from api.routers import user_definitions as user_definitions_router
from api.routers import theme_index as theme_index_router
from api.routers import theme_engine as theme_engine_router
from api.routers import ai_search as ai_search_router
from api.routers import user_playbook as user_playbook_router
from api.routers import education as education_router
from api.routers import fundamentals as fundamentals_router
from api.routers import analyst as analyst_router
from api.routers import filings as filings_router
from api.routers import research as research_router
from api.routers import expected_move as expected_move_router
from api.routers import earnings_intel as earnings_intel_router
from api.routers import ticker_logos as ticker_logos_router
from api.routers import broker_sync as broker_sync_router  # broker-sync (SnapTrade) -- MERGE AS A UNIT with include_router + scheduler below
from api.routers import desk_zoom_webhook as desk_zoom_webhook_router
from api.routers import single_stock_etfs as single_stock_etfs_router
from api.routers import waitlist as waitlist_router  # pre-launch COMING SOON capture
# landing_analytics existed but was never mounted, so the landing page's track()
# calls and the /admin/landing-analytics page had no backend at all.
from api.routers import landing_analytics as landing_analytics_router
from api.flow_router import flow_router
from api.flow_summary import flow_summary_router
from api.oi_snapshot_router import router as oi_snapshot_router
from api.notable_flow_router import router as notable_flow_router
from api.liveflow_router import router as liveflow_router
from api.routers.liveflow_health import router as liveflow_health_router
from api.live_massive_router import router as live_massive_router
from api.routers.massive_stream_router import router as massive_stream_router  # flow SSE (dark)
from api.alert_tester import router as alert_tester_router
from api.csv_ingest import router as csv_ingest_router
from api.darkpool_router import router as darkpool_router
from api.discord_watchlist import register_discord_routes
from api.services.auth_db import init_db as _init_auth_db
from api.services.voice_audio_cache import purge_expired as _voice_cache_purge
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse as StarletteJSONResponse
from api.gex_router import router as gex_router
from api.dealer_positioning_router import router as dealer_positioning_router
from api.watchlist_router import router as watchlist_router
from api import watchlist_tracker as _watchlist_tracker

_SENTRY_DSN = os.environ.get("SENTRY_DSN")

# -- Maintenance mode --------------------------------------------------------
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


class CompassPaywallMiddleware(BaseHTTPMiddleware):
    """Gate every Compass / AI-coach endpoint to paid users + admins.

    All Compass endpoints live under /api/j2 and contain a '/coach' path
    segment (plus the two /api/j2/unified-coach routes). Gating by path here
    is authoritative and automatically covers any future /coach endpoint --
    no per-route dependency to forget. Voice + TTS are already gated at the
    router level (requires_voice_access -> 402), so this only adds Compass.
    """

    def _is_compass_path(self, path: str) -> bool:
        if not path.startswith("/api/j2"):
            return False
        return "/coach" in path or path.endswith("/unified-coach")

    async def dispatch(self, request, call_next):
        if self._is_compass_path(request.url.path):
            from api.services.auth_service import validate_session, get_user_plan
            user = validate_session(request.cookies.get("uct_session"))
            if not user:
                return StarletteJSONResponse(
                    status_code=401, content={"detail": "Not authenticated"}
                )
            is_admin = user.get("role") == "admin"
            if not is_admin and get_user_plan(user["id"]) not in {"pro", "premium", "lifetime"}:
                return StarletteJSONResponse(
                    status_code=402,
                    content={"detail": "Compass requires a paid plan"},
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
        print(f"[startup] COT initial seed complete -- {n} records inserted")
    except Exception as e:
        print(f"[startup] COT seed failed: {e}")


def _cot_catchup_background():
    """Run if we missed the Friday 3:45 PM scheduled refresh (e.g. Railway redeployed after it)."""
    try:
        n = _cot_service.refresh_from_current()
        print(f"[startup] COT catch-up refresh complete -- {n} records upserted")
    except Exception as e:
        print(f"[startup] COT catch-up refresh failed: {e}")


def _implied_capture_catchup_background():
    """Startup catch-up for implied_store.run_nightly_capture — fired when a
    fresh process boots past the 16:35 ET trigger with nothing captured yet
    tonight (see the IMPLIED_STORE_ENABLED startup block below and
    implied_store.py's "startup catch-up" section for the full incident
    writeup — 2026-08-05, a redeploy landing right after the trigger silently
    lost the whole night since a memory jobstore has no record of a missed
    fire time). Safe to race the 16:35 ET scheduled job if it also fires:
    record_implied is first-write-wins per (sym, report_date) and
    run_nightly_capture skips any (sym, report_date) already captured."""
    try:
        from api.services import implied_store
        n = implied_store.run_nightly_capture()
        print(f"[startup] implied-move catch-up capture complete -- {n}")
    except Exception as e:
        print(f"[startup] implied-move catch-up capture failed: {e}")


def _grade_snapshot_catchup_background():
    """Startup catch-up for setup_grade.run_daily_grade_snapshot — same
    incident/shape as _implied_capture_catchup_background, 5 minutes later
    (16:40 ET trigger). record_grade is INSERT OR REPLACE keyed on
    (sym, date, surface), so re-running (or racing the 16:40 ET scheduled
    job) is idempotent — same-day rows just get overwritten with an
    equivalent/fresher grade, never duplicated."""
    try:
        from api.services import setup_grade
        n = setup_grade.run_daily_grade_snapshot()
        print(f"[startup] setup-grade catch-up snapshot complete -- {n}")
    except Exception as e:
        print(f"[startup] setup-grade catch-up snapshot failed: {e}")


# -- Pattern engine learning-loop jobs (Phase 6) -----------------------------
# Scheduled by APScheduler alongside the existing COT scheduler. All three
# wrappers catch every exception and log/print -- a failed pattern job must
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


# ---------------------------------------------------------------------------
# RTH gate — used by the intraday pass inside _run_patterns_universe_scan
#
# RESTORED 2026-07-23. Shipped in 208d6297, then removed wholesale on 2026-05-21
# by 7b787e46 ("Update main.py") — a 186-line deletion carrying the GitHub-web-UI
# default message, alongside _add_compass_job/_voice_window_scan which were later
# restored. This pass never was, so the scheduler stored NO intraday detections
# for two months and /patterns, /admin/patterns and Compass's pattern tools went
# daily-only. Guarded by tests/test_patterns_intraday_scan.py.
# ---------------------------------------------------------------------------

_INTRADAY_PATTERN_IDS = ["lance_opening_drive", "opening_range_breakout", "opening_range_breakdown"]


def _is_rth_now() -> bool:
    """Return True iff the current time is Mon-Fri 09:30–16:00 ET (inclusive)."""
    try:
        import datetime as _dt
        now = _dt.datetime.now(ZoneInfo("America/New_York"))
        if now.weekday() >= 5:          # Saturday=5, Sunday=6
            return False
        t = now.time()
        return _dt.time(9, 30) <= t <= _dt.time(16, 0)
    except Exception:
        return False


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

        # -----------------------------------------------------------------------
        # Intraday pass — leader-only, RTH-gated
        # Runs AFTER the daily pass, ONLY Mon-Fri 09:30-16:00 ET.
        # Scans lance_opening_drive + opening_range_breakout + opening_range_breakdown
        # against 5-min bars for the leader universe only.
        # Context (trend stage / MA alignment) is built from daily bars so that
        # the intraday detectors benefit from meaningful higher-TF context.
        # ORB/ORBD receive only today's session bars (bars[:6] == first 30 min).
        # Lance receives the full 5000-bar intraday series (it partitions sessions
        # internally and needs 20+ prior sessions for its trailing-volume average).
        #
        # Reads bars from LOCAL SQLite only — no network fetches, no LLM calls.
        # Kill switch: PATTERNS_INTRADAY_SCAN_ENABLED=0.
        # -----------------------------------------------------------------------
        if (os.environ.get("PATTERNS_INTRADAY_SCAN_ENABLED", "1") == "1"
                and _is_rth_now() and leader_tickers):
            intra_scanned = 0
            intra_stored = 0
            for sym in leader_tickers:
                try:
                    # --- daily bars for context ---
                    try:
                        daily_raw = bars_sqlite.get_bars(sym, "D", 200)
                    except Exception as _be:
                        _plog.debug("[patterns] intraday: get_bars(D) failed for %s: %s", sym, _be)
                        continue
                    if not daily_raw or len(daily_raw) < 30:
                        continue
                    daily_bars_list = [
                        {"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}
                        for r in daily_raw
                    ]
                    try:
                        ctx = build_context(daily_bars_list, sym=sym)
                    except Exception as _ce:
                        _plog.debug("[patterns] intraday: build_context failed for %s: %s", sym, _ce)
                        continue

                    # --- intraday bars (5-min) ---
                    try:
                        intra_raw = bars_sqlite.get_bars(sym, "5", 5000)
                    except Exception as _ibe:
                        _plog.debug("[patterns] intraday: get_bars(5) failed for %s: %s", sym, _ibe)
                        continue
                    if not intra_raw or len(intra_raw) < 9:
                        continue
                    intra_bars = [
                        {"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}
                        for r in intra_raw
                    ]

                    # --- Lance: full intraday series (partitions sessions itself) ---
                    try:
                        lance_dets = detect_all(intra_bars, ctx, pattern_ids=["lance_opening_drive"])
                    except Exception as _ld:
                        _plog.debug("[patterns] intraday: lance failed for %s: %s", sym, _ld)
                        lance_dets = []

                    # --- ORB/ORBD: today's session slice only ---
                    # Walk backward from the end to find the current session start
                    # (first index where gap to prior bar > 4 hours = 14400s).
                    orb_dets: list = []
                    try:
                        session_start_idx = 0
                        for i in range(len(intra_bars) - 1, 0, -1):
                            if intra_bars[i]["t"] - intra_bars[i - 1]["t"] > 14400:
                                session_start_idx = i
                                break
                        today_session = intra_bars[session_start_idx:]
                        if len(today_session) >= 9:
                            orb_dets = detect_all(
                                today_session, ctx,
                                pattern_ids=["opening_range_breakout", "opening_range_breakdown"],
                            )
                    except Exception as _od:
                        _plog.debug("[patterns] intraday: ORB/ORBD failed for %s: %s", sym, _od)

                    intra_scanned += 1
                    for d in lance_dets + orb_dets:
                        try:
                            d["sym"] = sym
                            d["tf"] = "5"
                            d.setdefault("geometry", {}).setdefault("extras", {})["from_leader_universe"] = True
                            memory.store_detection(d)
                            intra_stored += 1
                        except Exception as _se:
                            _plog.debug("[patterns] intraday: store failed for %s: %s", sym, _se)

                except Exception as _ticker_err:
                    _plog.debug("[patterns] intraday: ticker loop error for %s: %s", sym, _ticker_err)
                    continue

            _plog.info("[patterns] intraday pass: scanned=%d stored=%d", intra_scanned, intra_stored)
            print(f"[patterns] intraday pass: scanned={intra_scanned} stored={intra_stored}")
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


# Module-level imports for hot tier warm helpers -- bound at module scope so
# tests can patch via `api.main.bars_disk_cache.get` and `api.main.bars_hot_tier.set`.
from api.services import bars_hot_tier, bars_disk_cache  # noqa: E402
from api.services import readiness  # noqa: E402


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
    # Cap to 500 -- capacity of the hot tier
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
        # readiness gate: charts are cold until this finishes (see readiness.py)
        with readiness.gate("hot_tier"):
            _warm_hot_tier_now()
    threading.Thread(target=_delayed, daemon=True, name="hot-tier-warmer").start()


def _start_dashboard_warm_background(delay_seconds: int = 20) -> None:
    """Pre-warm the dashboard/landing-facing caches shortly after boot.

    The in-memory TTLCache resets on every deploy; without this the FIRST users
    after a deploy eat the 3-5s cold recompute on the busiest pages (movers,
    themes, news, breadth, calendar). Warming them ~20s post-boot moves that cost
    off the user and onto a background thread. Each step is independent + best-
    effort so one failure never blocks the rest.
    """
    import threading

    def _delayed():
        import time
        time.sleep(delay_seconds)
        log = logging.getLogger(__name__)

        def _warm(label, fn):
            try:
                fn()
                log.info("[dashboard-warm] %s ok", label)
            except Exception:
                log.exception("[dashboard-warm] %s failed", label)

        def _movers():
            from api.services.massive import get_movers
            get_movers()

        def _themes():
            from api.routers.theme_performance import get_theme_performance
            get_theme_performance()

        def _news():
            from api.services.engine import get_news
            get_news()

        def _breadth():
            from api.routers.breadth_monitor import get_breadth_history
            get_breadth_history(days=90)

        def _breadth_live():
            # Intraday breadth compares one market snapshot against reference
            # levels derived from ~1M daily bars. That derivation is seconds of
            # blocking SQLite + numpy; warming it here keeps it off a request
            # (and off one of the pod's bounded threadpool workers).
            from api.services.breadth_live import warm
            log.info("[dashboard-warm] breadth-live %s", warm())

        def _calendar():
            from api.routers.calendar import get_calendar
            get_calendar()

        def _enrichment():
            # `_calendar()` above warms the base week payload, but its
            # enrichment OVERLAY (beat_history/hist_stats/expected_move —
            # what the earnings modal's Earnings History section reads via
            # useWeekEnrichment) is a SEPARATE cold path:
            # /api/calendar/enrichment-batch fans out per reporter to
            # Finnhub/FMP, and since _backfill_past_days can put 100-200+
            # symbols on a single past day, a cold compute for the current
            # week's 5 days was measured taking 60-100+ SECONDS (see
            # calendar.py::_build_enrichment_for_date). Without this warm,
            # the first user to open the calendar after every deploy pays
            # that cost synchronously inside the earnings modal's own
            # fetch — long enough that the request is still in flight when
            # anyone inspects it, and long enough that no real browser
            # session waits it out (P2 Task 12: this, not a frontend bug,
            # is why a freshly-reported symbol's Earnings History rendered
            # "No reported quarters yet" against a just-restarted stack —
            # useWeekEnrichment's fetch had genuinely not resolved yet).
            from api.routers.calendar import get_enrichment_batch, _week_dates
            dates = ",".join(d.isoformat() for d in _week_dates())
            get_enrichment_batch(dates=dates)

        def _earnings_previews():
            # Warm the AI preview for the week's reporters (ranked by who users
            # actually track, then market cap) + the analysis for names that just
            # reported, so the modal is instant on click. Skip-if-stable +
            # disk-persisted → cheap after the first run (zero re-burn on redeploy).
            from api.services.earnings_preview_warm import (
                warm_week_previews, warm_reported_analyses,
            )
            warm_week_previews()
            warm_reported_analyses()

        def _flow_tape_critical():
            # The surfaces users hit FIRST — default ALL FLOW tape + market-read
            # hero. Fills the /recent snapshot cache + warms the flow.db OS page
            # cache so the first user after a deploy isn't hit by the cold
            # wide-scan read (~20-30s cold vs ~1.5s warm). flow.db is WAL so this
            # read never stalls the WS writer. See _recent_cache in
            # live_massive_router. Runs FIRST (before the dashboard warms) so the
            # tape is hot in seconds, not behind everything else.
            # NOTE: when FLOW_READS_PROXY_ENABLED=1 (prod), /recent is served by
            # the flow-worker, so THIS (web) cache is bypassed — the authoritative
            # warm runs in flow_worker_main._start_recent_cache_warmer. This warm
            # still matters when the proxy is off (local / fallback). Use
            # warm_recent (SYNCHRONOUS fill) because recent_massive_alerts now
            # returns a non-blocking "warming" stub on a cold key.
            from api.live_massive_router import warm_recent, day_stats
            warm_recent(limit=10000, min_grade="D", target_date=None,
                        sort_by="recent", tier=None, curated=False)
            day_stats(target_date=None, exclude_algo=False)

        def _flow_tape_curated():
            # Curated scans the whole day (~80K rows) — heavy, so pre-warm it LAST.
            # NOTE (2026-07-20): curated is the DEFAULT view (LiveFlowMassive.jsx
            # defaults curated ON), NOT an opt-in mode — the prior "opt-in, one
            # cold load acceptable" assumption was wrong and left the default view
            # cold. Also: limit MUST equal the frontend's default (10000). The old
            # limit=5000 warmed a DIFFERENT cache key (key includes limit), so the
            # user's exact request never hit a warm entry.
            from api.live_massive_router import warm_recent
            warm_recent(limit=10000, min_grade="D", target_date=None,
                        sort_by="recent", tier=None, curated=True)

        # readiness gate: these are the "sections" that read cold-slow (3-5s
        # recompute each) until this block finishes (see readiness.py).
        with readiness.gate("dashboard"):
            _warm("flow-tape", _flow_tape_critical)   # FIRST — the tape is the priority surface
            _warm("movers", _movers)
            _warm("themes", _themes)
            _warm("news", _news)
            _warm("breadth", _breadth)
            _warm("breadth-live", _breadth_live)
            _warm("calendar", _calendar)
            _warm("enrichment", _enrichment)  # after calendar (it reads the week's day-list)
            _warm("earnings-previews", _earnings_previews)  # after calendar (it reads the week)
            _warm("flow-curated", _flow_tape_curated)  # LAST — heavy 100K scan, non-critical

    threading.Thread(target=_delayed, daemon=True, name="dashboard-warmer").start()


def _start_calendar_enrichment_warm_background(delay_seconds: int = 90) -> None:
    """Keep the CURRENT WEEK's earnings enrichment permanently hot.

    THE PROBLEM THIS SOLVES
        `_ENRICH_TTL` is 300s on a hard clock over a provider fan-out measured
        at 18-25s for ONE day and 60-100s for a cold week. The boot warm in
        `_start_dashboard_warm_background` is ONE-SHOT, so it covers only the
        first five minutes of a pod's life. After that, every single 5-minute
        window hands the full cold recompute to whichever user opens the
        calendar first -- and that user sits on a spinner in the earnings
        modal's Setup / Earnings History / Brief sections while it runs.
        Measured on prod 2026-08-08: enrichment cold 17.9s, warm 0.14s; the
        whole-week batch cold 24.8s, warm 0.22s. A 130x cliff, re-armed every
        five minutes, is why a dozen sampled tickers each took about a minute.

    THE SHAPE IS THE RS WARMER'S, deliberately: re-warm on a loop just UNDER
    the cache TTL so the recompute is always absorbed by this background thread
    and never lands on a request. That pattern already removed the identical
    hourly cliff from RS rankings.

    This does NOT add provider load in the steady state. The same compute
    already ran once per TTL expiry -- triggered by a user, on the request
    path, inside the anyio threadpool. This moves it off that path and makes
    it predictable; it does not make it more frequent.
    """
    import threading

    def _delayed():
        import time
        time.sleep(delay_seconds)
        # Rotates one NEIGHBOURING week per cycle. The current week has to be
        # re-warmed every cycle (300s TTL), but the surrounding weeks hold 4h
        # (future) / 12h (past) TTLs, so refreshing one per 240s cycle keeps all
        # four hot at ~16-minute intervals without ever warming 25 days at once.
        neighbour_offsets = [-2, -1, 1, 2]
        turn = 0
        while True:
            try:
                from api.routers.calendar import (
                    get_enrichment_batch, _week_dates, _week_dates_for,
                    _current_week_monday, _today_et,
                )
                from datetime import timedelta

                dates = ",".join(d.isoformat() for d in _week_dates())
                out = get_enrichment_batch(dates=dates)

                # Browsing to the previous or next week used to fall straight
                # through to a 33-57s cold build (measured: 120 reporters =
                # 57.2s, 67 reporters = 33.3s) because this warmer only ever
                # covered the CURRENT week. `_ENRICH_WINDOW_DAYS` is 14, so
                # anything past +/-2 weeks returns {} instantly and needs no
                # warm -- these four offsets are the entire remaining surface.
                offset = neighbour_offsets[turn % len(neighbour_offsets)]
                turn += 1
                monday = _current_week_monday(_today_et()) + timedelta(weeks=offset)
                nbr = ",".join(d.isoformat() for d in _week_dates_for(monday))
                nbr_out = get_enrichment_batch(dates=nbr)

                logging.getLogger(__name__).info(
                    "[calendar-enrich-warm] current week %d day(s)/%d syms; "
                    "week%+d %d day(s)/%d syms",
                    len(out or {}), sum(len(v or {}) for v in (out or {}).values()),
                    offset,
                    len(nbr_out or {}), sum(len(v or {}) for v in (nbr_out or {}).values()),
                )
            except Exception:
                logging.getLogger(__name__).exception("[calendar-enrich-warm] failed")
            # 240s, under the 300s _ENRICH_TTL. The margin has to exceed the
            # compute itself (~25s) or the entry expires while the warm that
            # would have refreshed it is still running, and a user walks into
            # the gap -- which is the whole defect, reintroduced.
            time.sleep(240)

    threading.Thread(target=_delayed, daemon=True,
                     name="calendar-enrichment-warmer").start()


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
        # Re-warm on a loop just UNDER the 1h cache TTL so the ~17s recompute is
        # always absorbed by this background thread and never lands on a real
        # user request (previously every hour the first requester ate the full
        # cold recompute). force=True after the initial populate.
        first = True
        while True:
            try:
                from api.services import rs_ranking
                rankings = rs_ranking.compute_rs_scores(force=not first)
                logging.getLogger(__name__).info(
                    "[rs-rankings] warmed: %d entries", len(rankings)
                )
                first = False
            except Exception:
                logging.getLogger(__name__).exception("[rs-rankings] warm failed")
            finally:
                # Release the readiness gate after the FIRST attempt (success or
                # not). Later iterations are re-warms, not boot readiness.
                # mark_done is idempotent, so calling it each loop is harmless.
                readiness.mark_done("rs_rankings")
            time.sleep(3000)  # 50 min, under the 3600s cache TTL
    threading.Thread(target=_delayed, daemon=True, name="rs-rankings-warmer").start()


def _start_industry_map_background(delay_seconds: int = 75) -> None:
    """Prewarm the universe industry map (Finviz bulk) so the breadth drill
    "group by industry" view classifies every mover from the first open.

    One Finviz Elite export (~11k rows) populates the persisted map. Delayed so
    it doesn't compete with bar warmers at boot; self-heals on request if empty.
    """
    import threading
    def _delayed():
        import time
        time.sleep(delay_seconds)
        try:
            from api.services import industry_map
            industry_map.prewarm()
        except Exception:
            logging.getLogger(__name__).exception("[startup] industry-map prewarm failed")
    threading.Thread(target=_delayed, daemon=True, name="industry-map-warmer").start()


def _start_darkpool_prewarm_background(delay_seconds: int = 60) -> None:
    """Prewarm the dark-pool aggregation cache on boot so the first visitor lands
    on a warm 90d window (the page default) instead of paying the multi-million-
    row rebuild.

    Usually a no-op: the aggregation is disk-cached on the /data volume and
    survives redeploys, so this only rebuilds when the cache is genuinely cold
    (a data upload that didn't run the prebuild, or a fresh volume). Delayed so
    it doesn't compete with the bar warmers at boot.
    """
    import threading
    def _delayed():
        import time
        time.sleep(delay_seconds)
        try:
            from api.darkpool_aggregator import prewarm_if_cold
            prewarm_if_cold()
        except Exception:
            logging.getLogger(__name__).exception("[startup] darkpool prewarm failed")
    threading.Thread(target=_delayed, daemon=True, name="darkpool-prewarm-warmer").start()


def _thread_groups() -> dict:
    """Normalized thread-name histogram. Shared by /api/health/threads and
    the burst watchdog below -- see the endpoint docstring for the rules."""
    import re as _re
    from collections import Counter
    groups = Counter()
    for t in threading.enumerate():
        name = t.name or "unnamed"
        toks = [tok for tok in _re.split(r"[-_ ]+", name)
                if tok and not tok.isdigit() and not _re.fullmatch(r"[A-Z.]{1,6}", tok)]
        key = "-".join(toks[:2]) or name
        groups[key] += 1
    return {"total": threading.active_count(), "groups": dict(groups.most_common(25))}


def _start_thread_burst_watch() -> None:
    """Self-capture for the recurring thread burst (2026-06-09/10 incident:
    ~58->931 threads in minutes for ~25 min, then self-heals; during the
    window sync endpoints + catalyst refresh threads can't start). Nobody is
    awake to curl /api/health/threads mid-burst, so the pod samples itself:
    every 30s, when active_count crosses THREAD_BURST_LOG_THRESHOLD (default
    200), log the histogram -- at most once a minute while it lasts, plus a
    final line when it subsides so the burst duration is in the logs too."""
    try:
        threshold = int(os.environ.get("THREAD_BURST_LOG_THRESHOLD", "200"))
    except ValueError:
        threshold = 200
    if threshold <= 0:
        print("[startup] thread-burst watch disabled (threshold<=0)")
        return
    log = logging.getLogger("thread_burst")

    def _loop():
        import json as _json
        in_burst = False
        last_logged = 0.0
        while True:
            n = threading.active_count()
            now = time.time()
            if n > threshold:
                if not in_burst or (now - last_logged) >= 60:
                    in_burst = True
                    last_logged = now
                    log.warning(f"[thread-burst] {_json.dumps(_thread_groups())}")
            elif in_burst:
                in_burst = False
                log.warning(f"[thread-burst] subsided: {n} threads")
            time.sleep(30)

    threading.Thread(target=_loop, daemon=True, name="thread-burst-watch").start()


def start_screener_snapshot_warm():
    """Top up the stalest screener rows shortly after boot, OFF the critical path.

    The snapshot is rebuilt nightly at 03:00 ET, so a pod that boots after that
    build — a deploy, a Railway restart — serves whatever `screener.db` was last
    written until the NEXT 03:00. Up to a full day of stale rows with no top-up.
    `snapshot_builder._stalest` orders never-built/oldest tickers first, so even
    a small run refreshes exactly the rows that are worst.

    ⚠️ BOUNDED AND DELAYED ON PURPOSE — the naive version of this is a
    cold-start herd. `run_build` is sequential over the universe and its
    `_read_fundamentals` calls `massive.get_market_cap` -> `get_ticker_details`,
    which is **UNCACHED**: one Massive REST round-trip per ticker, plus a
    `ticker_meta` miss can reach yfinance/Finnhub. Uncapped that is ~4,000
    outbound calls racing the boot warmers on a single-process web pod — the
    `bars_prewarm` failure that saturated Massive, starved the web pod, and was
    reverted in `68392f4`. So:

      * **Nothing touches the boot path.** `.start()` returns immediately and
        the thread sleeps first, so readiness and the healthcheck are never
        behind this. Even the `count_rows` gate lives inside the thread — the
        registration that owns the nightly job must not do I/O for a warm.
      * **A plain daemon thread**, deliberately not the 64-slot anyio pool and
        not an APScheduler executor slot — the warm can never take a worker the
        request path or another job needs.
      * **Capped** well under the nightly's 4,000, via
        `SCREENER_SNAPSHOT_WARM_MAX_PER_RUN`.
      * **Counted and logged** via `run_build`'s own `{built, skipped, errors}`.

    Returns the started `threading.Thread`, or None when disabled. Never raises
    — including on a malformed env value, which falls back to its default. The
    caller registers the wire watchdog inside the SAME `try` as the screener
    jobs, so an exception escaping here would silently unregister an unrelated
    job.
    """
    if os.environ.get("SCREENER_SNAPSHOT_WARM_ENABLED", "1") != "1":
        return None

    def _num(name, default, cast):
        try:
            return cast(os.environ[name])
        except (KeyError, TypeError, ValueError):
            return default

    delay = _num("SCREENER_SNAPSHOT_WARM_DELAY_SECS", 120.0, float)
    warm_min = _num("SCREENER_SNAPSHOT_WARM_MIN", 3000, int)
    cap = _num("SCREENER_SNAPSHOT_WARM_MAX_PER_RUN", 500, int)

    def _warm():
        try:
            time.sleep(delay)
            # Imported HERE, not closed over from the caller. The previous cut
            # of this block referenced a `snapshot_builder` bound in another
            # function; when it was orphaned it would have raised NameError
            # straight into a bare `except` and printed "skipped" forever.
            from api.services.screener import snapshot_db, snapshot_builder
            snapshot_db.init_db()
            rows = snapshot_db.count_rows()
            if rows >= warm_min:
                print(f"[startup] screener self-warm: not needed "
                      f"(rows={rows} >= warm_min={warm_min})")
                return
            stats = snapshot_builder.run_build(max_tickers=cap)
            print(f"[startup] screener self-warm: rows_before={rows} cap={cap} "
                  f"built={stats.get('built')} skipped={stats.get('skipped')} "
                  f"errors={stats.get('errors')}")
        except Exception as e:
            # Counted as a failure of the whole warm, and NAMED — never `pass`.
            print(f"[startup] screener self-warm FAILED: {type(e).__name__}: {e}")

    t = threading.Thread(target=_warm, daemon=True, name="screener-warm")
    t.start()
    return t


def register_screener_jobs(scheduler):
    """Register the nightly full-market screener snapshot build (03:00 ET, after
    the ratings nightly at 02:30). Gated by SCREENER_SNAPSHOT_ENABLED (default on).
    Also kicks the bounded boot self-warm (`start_screener_snapshot_warm`) so a
    freshly-deployed pod does not serve a stale snapshot until the next 03:00.
    Returns True if the job was registered."""
    import os
    if os.environ.get("SCREENER_SNAPSHOT_ENABLED", "1") != "1":
        return False
    from apscheduler.triggers.cron import CronTrigger
    from api.services.screener import snapshot_builder

    def _run():
        try:
            snapshot_builder.run_build()
        except Exception as e:
            print(f"[scheduler] screener snapshot build error: {e}")
    scheduler.add_job(_run, trigger=CronTrigger(hour=3, minute=0, timezone=_ET),
                      id="screener_snapshot_nightly", max_instances=1,
                      replace_existing=True)

    # -- the scan sweep: a SEPARATE job at a LATER hour ------------------------
    #
    # ⛔ NOT A CALL APPENDED TO `run_build`, and both reasons are measured.
    # `run_build` is capped at SCREENER_SNAPSHOT_MAX_PER_RUN = 4000 and its
    # DURATION IS NOT MEASURED ANYWHERE (GT §6.4 names it the one number most
    # worth having) — so chaining would put an unmeasured job behind an
    # unmeasured job in one `max_instances=1` slot. And the sweep's own
    # precondition is that the snapshot is CURRENT, which it cannot assert about
    # a build it is running inside.
    #
    # ⏳ THE HOUR IS THE OWNER'S (design §8.5) and lives in exactly ONE place:
    # `scan_evaluator.SWEEP_HOUR_ET`. Read, never retyped.
    #
    # ⭐ AND ONE HOUR IS ENOUGH TODAY BECAUSE THE CEILING IS A PROPERTY OF THE
    # TREE, NOT OF THIS SCHEDULE. All 54 declared scalars are `cadence: nightly`
    # out of `screener_rows` (measured over the manifest), so a scan naming any of
    # them re-read at noon returns the same answer off the same 03:00 snapshot —
    # a true number implying something false. `scan_evaluator.cadence_ceiling`
    # derives that per definition from the manifest's own declarations; adding an
    # intraday job would only ever be honest for bars-only trees.
    #
    # ⛔ AND IT IS OFF BY DEFAULT IN CODE WHILE IT IS **ON IN PRODUCTION**.
    # `scan_evaluator.enabled()` reads `SCAN_SWEEP_ENABLED`, default "0", and
    # `railway variables --service web --kv` reports `SCAN_SWEEP_ENABLED=1`
    # (read live 2026-08-09). A local run and production therefore DIVERGE on
    # this switch: set it before reproducing a prod behaviour, and do not read
    # the default as "the sweep is dark".
    #
    # ⚰️ THIS SAID "E-4 has not wired a surface to these results, so a sweep
    # that ran by default would spend the pod's night writing rows nothing can
    # read." **That is false, and it has already cost two agents an hour each
    # this week** -- both stopped mid-task to work out whether the comment or
    # the code was right. The surface shipped: `/screener` -> `pages/Screener.jsx`
    # -> `components/screener/SavedScreensPanel.jsx` -> `ScanResults.jsx` ->
    # `CoverageLine.jsx`, reading `GET /api/scans/definition-results`
    # (`api/routers/scan_results.py`, mounted below), with
    # `components/screener/reachable.test.js` and
    # `app/src/pages/Screener.scanmount.test.jsx` as the standing rails.
    #
    # ⛔ THE SAME FALSE SENTENCE IS ALSO IN `scan_evaluator.enabled()`'s OWN
    # DOCSTRING, and that is why it survived every reading: each copy looked
    # like corroboration of the other. That file belongs to another lane right
    # now, so this is the copy this file owns -- correct BOTH or neither, since
    # one fixed copy beside one stale copy is the second-authority defect again.
    from api.services.screener import scan_evaluator

    def _run_scan_sweep():
        try:
            scan_evaluator.sweep_job()
        except Exception as e:
            print(f"[scheduler] screener scan sweep error: {e}")

    if scan_evaluator.enabled():
        scheduler.add_job(
            _run_scan_sweep,
            trigger=CronTrigger(hour=scan_evaluator.SWEEP_HOUR_ET,
                                minute=scan_evaluator.SWEEP_MINUTE_ET,
                                timezone=_ET),
            id="screener_scan_sweep", max_instances=1, replace_existing=True)

    start_screener_snapshot_warm()
    return True


def register_signature_sweep_job(scheduler):
    """Register the nightly closed-bar UCT Signature sweep (20:05 ET weekdays).

    The sweep evaluates the session's FINAL daily bar — the one thing the
    request path must never do — which is what makes the signal ledger accrue
    from launch day for every symbol on the list, whether or not anybody opened
    its chart.

    **20:05, not 16:45.** `bars.db` holds today's *evolving* partial daily bar
    and refreshes it from user fetches, not from a clock; `_needs_fresh` keeps
    re-fetching it through extended hours, which run to 20:00 ET. Sweeping at
    16:45 would read a bar still being written. The sweep has its own freshness
    gate as well (`sweep._expected_session`), so a store that is still behind
    just yields a `stale` count instead of a wrong signal — but the schedule
    should not be creating that condition on purpose. 20:05 also sits after the
    house settle line: dark-pool ingest 19:20, side heal 19:30.

    `timezone=_ET` is load-bearing, not decoration: a naive/UTC cron passes
    every structural check and then runs an hour off for half the year
    (lesson_apscheduler_cron_utc_trap). Returns True if the job was registered.
    """
    from apscheduler.triggers.cron import CronTrigger
    from api.services.signature.sweep import sweep_job

    scheduler.add_job(
        sweep_job,
        trigger=CronTrigger(day_of_week="mon-fri", hour=20, minute=5, timezone=_ET),
        id="signature_sweep", max_instances=1, replace_existing=True,
    )
    return True


# ── the nightly split back-adjustment sweep ──────────────────────────
from datetime import timedelta as _timedelta  # noqa: E402  (local to this block)

#: ⏰ THE ONLY CLOCK NUMBER THIS SCHEDULE DECLARES: how long BEFORE the regular
#: session opens the sweep STARTS. ⛔ THE OPEN ITSELF IS NOT WRITTEN HERE.
#: `scan_evaluator.market_open_et` derives it from
#: `bars_fetch.bucket_60_et_unix_seconds` -- the function CLAUDE.md names the
#: single source of truth for session alignment, and the one 09:30 the REST
#: resample path and the WebSocket rollup path already share. Spelling 09:30
#: again here would be the FIFTH copy (`bars_liveness.is_market_open`,
#: `live_massive_router._MARKET_OPEN_ET_MIN`, `flow_gap_autofill`, the anchor
#: itself) -- `lesson_probe_names_must_be_derived_not_typed`, and the shape that
#: has already cost this repo three outages.
#:
#: ⭐ WHY SEVEN HOURS (= 02:30 ET today). The sweep must land BEFORE the two
#: nightly readers of the same store: `screener_snapshot_nightly` at 03:00 ET
#: and `screener_scan_sweep` at `scan_evaluator.SWEEP_HOUR_ET` (05:00 ET). Both
#: read `bars_sqlite` directly, so a split healed after them is a split their
#: rows spend the whole day not having. Heal first, then let them read.
_SPLIT_SWEEP_LEAD_BEFORE_OPEN = _timedelta(hours=7)

#: How many tickers ONE run walks -- and therefore how many cold corporate-action
#: fetches it makes, because it warms exactly what it walks. The cursor below
#: advances by this much per night, so the whole store is covered in ~8 nights
#: and then repeats. Anything a member actually charts is healed immediately by
#: `bars_sanitize`'s serve-path hand-off, so this bounds the latency on the tail
#: NOBODY looks at -- which is the only part that needed a schedule.
_SPLIT_SWEEP_MAX_TICKERS = int(os.environ.get("BARS_SPLIT_SWEEP_MAX_TICKERS", "500"))

#: Resume point, so consecutive nights walk DIFFERENT tickers instead of
#: re-sweeping the head of the alphabet forever. Per-PROCESS state on a
#: deliberately single-process web pod; losing it on a redeploy costs a repeated
#: slice, never a wrong answer.
_split_sweep_cursor = 0


def _run_bars_split_repair_sweep() -> dict:
    """One night's slice of the un-back-adjusted-split heal. Never raises.

    🔴 WHY THIS EXISTS AT ALL. `bars_split_repair` shipped in `61f3b33b`
    with a serve-path hand-off (a charted ticker heals itself) and a manual tool
    -- and NO scheduler entry, because `api/main.py` was held by another lane.
    Its own report says so: *"NOT wired: a scheduled sweep."* So the un-charted
    tail of the universe healed nowhere, while `snapshot_builder`,
    `scan_evaluator` and the alert lane all read those rows. This repo has
    already paid for that exact gap once: the Desk session-insights pass was
    written, documented as scheduled, wired into no scheduler, and its deferred
    Zoom deletes had no collector for weeks.

    ⛔ THE METADATA IS FETCHED HERE, NOT READ OUT OF A WARM CACHE AND HOPED
    FOR. `bars_split_repair._splits_for` reads `bars_sanitize`'s CACHE ONLY -- a
    deliberate serve-path invariant (no unbounded external call one thread from
    a request). That cache is the shared 1,000-entry LRU, so a metadata key
    written at 02:30 is long evicted by the next 02:30, and a sweep that only
    READ it would report "no splits" for the entire universe forever while
    logging a clean line. That is the sweep tool's own concern 7 ("not a failure
    mode the tool can detect for you"), and it IS detectable here: this runs on
    a BackgroundScheduler worker thread, off the event loop and off the request
    path, which is the one context where the bounded FMP call is allowed. The
    answer is still written back to the cache so the serve path benefits, but
    this run does not DEPEND on it surviving.

    ⭐ SEPARATE COUNTS, NOT ONE TOTAL -- the `CoverageLine` idiom. "no splits
    declared", "could not ask the provider", "asked and the repair threw" and
    "asked and healed" are different facts, and collapsing them is how a sweep
    that reached nothing reads as a quiet night. (Deliberately no number here:
    read the keys of the dict it returns.)

    ⛔ AND IT DOES NOT RE-DERIVE THE SPLIT JUDGEMENT. Whether a boundary is
    unadjusted is `bars_sanitize.unadjusted_splits`, reached through
    `bars_split_repair.repair_all_tfs`. This function decides WHICH tickers to
    ask about and WHEN to stop -- nothing else.
    """
    from api.services import bars_sanitize as _san
    from api.services import bars_split_repair, bars_sqlite
    from api.services.cache import cache
    from api.services.screener import scan_evaluator

    global _split_sweep_cursor
    log = logging.getLogger(__name__)
    summary = {"considered": 0, "no_splits": 0, "meta_failed": 0, "failed": 0,
               "repaired": 0, "rows": 0, "boundaries": [], "stopped_early": False}

    if not bars_split_repair.enabled():
        log.info("[split-sweep] BARS_SPLIT_REPAIR_ENABLED=0 -- skipped")
        return summary

    # 🔴 THE VACUITY GUARD. Without a key `_fmp_get` returns None,
    # `_fetch_meta` answers `{"splits": []}` WITHOUT raising, and every ticker in
    # the universe reads as "nothing to adjust" -- a green log line over a sweep
    # structurally incapable of finding anything
    # (`lesson_health_check_reads_a_proxy_not_the_artifact`).
    if not (os.environ.get("FMP_API_KEY") or "").strip():
        log.error("[split-sweep] FMP_API_KEY is unset. Corporate-action metadata "
                  "cannot be fetched, so every ticker would report 'no splits' and "
                  "this sweep would heal nothing while looking healthy. REFUSING.")
        summary["meta_failed"] = -1
        return summary

    try:
        deadline = scan_evaluator.sweep_deadline()
    except Exception as e:                                     # noqa: BLE001
        log.warning("[split-sweep] no session-derived deadline (%s); unbounded", e)
        deadline = None

    try:
        universe = sorted({t for t, _tf in (bars_sqlite.get_all_tickers() or [])})
    except Exception as e:                                     # noqa: BLE001
        log.warning("[split-sweep] could not read the store's ticker list: %s", e)
        return summary
    if not universe:
        log.info("[split-sweep] the store holds no tickers -- nothing to sweep")
        return summary

    # ⚠️ `min(..., n)` IS LOAD-BEARING. A wrap-around slice that ran past the
    # universe length would visit the same ticker twice in one night -- harmless
    # for the repair (it is idempotent) and NOT harmless for the counts: the
    # second visit reads the metadata this run just cached and reports it as a
    # clean `no_splits`, so a provider outage would show up as "nothing to
    # adjust" on the very run that failed to ask.
    n = len(universe)
    take = min(_SPLIT_SWEEP_MAX_TICKERS, n)
    start = _split_sweep_cursor % n
    slice_ = [universe[(start + i) % n] for i in range(take)]
    _split_sweep_cursor = (start + take) % n

    for ticker in slice_:
        if deadline is not None and datetime.now(_ET) >= deadline:
            summary["stopped_early"] = True
            break
        summary["considered"] += 1
        key = _san._META_KEY.format(ticker)
        meta = cache.get(key)
        if meta is None:
            try:
                meta = _san._fetch_meta(ticker)
                cache.set(key, meta, ttl=_san._META_TTL)
            except Exception:                                  # noqa: BLE001
                cache.set(key, {"ipo": None, "splits": []}, ttl=_san._META_FAIL_TTL)
                summary["meta_failed"] += 1
                continue
            time.sleep(0.05)          # provider politeness, not a rate limit
        splits = list((meta or {}).get("splits") or [])
        if not splits:
            summary["no_splits"] += 1
            continue
        # ⚠️ ONE TICKER'S EXCEPTION MUST NOT END THE NIGHT.
        # `bars_split_repair.sweep()` isolates per ticker; `repair_all_tfs` --
        # which is what this calls, because it already holds the splits and must
        # not re-read the cache for them -- does NOT. A locked bars.db on ticker
        # 40 of 500 would otherwise repair 39 and log a successful run.
        try:
            results = bars_split_repair.repair_all_tfs(ticker, apply=True,
                                                       splits=splits)
        except Exception as e:                                 # noqa: BLE001
            log.warning("[split-sweep] %s failed: %s", ticker, e)
            summary["failed"] += 1
            continue
        for res in results:
            if res.get("boundaries"):
                summary["boundaries"].append((res["ticker"], res["tf"], res["boundaries"]))
            if res.get("written"):
                summary["repaired"] += 1
                summary["rows"] += int(res["written"])

    log.info("[split-sweep] slice=%d/%d considered=%d no_splits=%d meta_failed=%d "
             "failed=%d repaired=%d rows=%d stopped_early=%s boundaries=%s",
             len(slice_), n, summary["considered"], summary["no_splits"],
             summary["meta_failed"], summary["failed"], summary["repaired"],
             summary["rows"], summary["stopped_early"], summary["boundaries"][:10])
    return summary


def register_bars_split_repair_sweep(scheduler):
    """Register the nightly split back-adjustment sweep. True if registered.

    ⭐ THE HOUR IS DERIVED, NOT TYPED -- see `_SPLIT_SWEEP_LEAD_BEFORE_OPEN`.
    The cron fires DAILY (not `mon-fri`): a split's ex-date is a trading day, but
    the heal is a repair of STORED ROWS, and a weekend run is what lets the
    cursor keep covering the universe on the two days nothing else competes for
    the pod.

    ⛔ NO NEW FLAG. `bars_split_repair.enabled()` (`BARS_SPLIT_REPAIR_ENABLED`,
    default ON) already gates the serve-path hand-off; a second switch over one
    feature is the second-authority defect this repo keeps re-committing.
    """
    from apscheduler.triggers.cron import CronTrigger
    from api.services import bars_split_repair
    from api.services.screener import scan_evaluator

    if not bars_split_repair.enabled():
        return False

    fire_at = (scan_evaluator.market_open_et(datetime.now(_ET).date())
               - _SPLIT_SWEEP_LEAD_BEFORE_OPEN)
    scheduler.add_job(
        _run_bars_split_repair_sweep,
        trigger=CronTrigger(hour=fire_at.hour, minute=fire_at.minute, timezone=_ET),
        id="bars_split_repair_sweep", max_instances=1, coalesce=True,
        replace_existing=True, misfire_grace_time=3600,
    )
    return True


def register_logo_miss_retry_job(scheduler):
    """Register the daily ticker-logo miss-retry pass (03:25 ET).

    `ticker_logos.resolve_and_cache()` writes a `.miss` sentinel whenever
    every source in the logo chain fails for a ticker -- up to a 7-day retry
    TTL for a genuine "no logo anywhere" verdict (a provider hiccup instead
    gets a much shorter TTL, see `ticker_logos._MISS_TRANSIENT_TTL`).
    `run_miss_retry()` is the ONLY thing that ever clears a `.miss` file
    early, and until this registration it had no scheduler entry at all --
    a logo that failed once during a provider blip stayed a monogram for the
    full retry window even after every source recovered, because nothing
    was ever calling the retry pass. Gated by `LOGO_MISS_RETRY_ENABLED`
    (default on). Low concurrency (<=2 workers, 1s inter-attempt sleep
    inside `run_miss_retry`) so it never contends with request-path logo
    fetches; safe against overlap -- a second call while one is running
    returns `{"skipped": True}` immediately. Returns True if registered.
    """
    import os
    if os.environ.get("LOGO_MISS_RETRY_ENABLED", "1") != "1":
        return False
    from apscheduler.triggers.cron import CronTrigger

    def _run():
        try:
            from api.services import ticker_logos
            stats = ticker_logos.run_miss_retry()
            print(f"[scheduler] logo_miss_retry: {stats}")
        except Exception as e:
            print(f"[scheduler] logo_miss_retry error (non-fatal): {e}")

    scheduler.add_job(
        _run,
        trigger=CronTrigger(hour=3, minute=25, timezone=_ET),
        id="logo_miss_retry", max_instances=1, replace_existing=True,
    )
    return True


def register_wire_watchdog_job(scheduler):
    """Server-side missed-run watchdog for the morning wire (review-panel fix).

    The wire runs on the owner's laptop — if the machine is off/asleep on a
    trading day, NOTHING alerts (the engine's own publish gate only fires when
    the engine RUNS). This job runs on Railway at 9:05 AM ET on weekdays: if
    the served wire_data still carries a pre-today date, fire a Discord ops
    alert. Disable with WIRE_WATCHDOG_ENABLED=0.
    """
    import os
    if os.environ.get("WIRE_WATCHDOG_ENABLED", "1") != "1":
        return False
    from apscheduler.triggers.cron import CronTrigger

    def _check():
        try:
            from api.routers.engine_data import _expected_wire_date
            from api.services.engine import _load_wire_data
            from api.services.alerts import add_alert
            wire = _load_wire_data() or {}
            wire_date = str(wire.get("date") or "")[:10]
            expected = _expected_wire_date().isoformat()
            if wire_date < expected:
                add_alert(
                    alert_type="wire_missed",
                    severity="critical",         # critical => Discord webhook fires
                    title="Morning wire MISSED its run",
                    message=(f"UCT20/wire payload is dated {wire_date or 'unknown'} but a "
                             f"{expected} run was expected — the engine laptop is likely "
                             f"off/asleep. Members are seeing yesterday's list."),
                )
        except Exception as e:
            print(f"[scheduler] wire watchdog error: {e}")

    scheduler.add_job(_check,
                      trigger=CronTrigger(day_of_week="mon-fri", hour=9, minute=5, timezone=_ET),
                      id="wire_freshness_watchdog", max_instances=1,
                      replace_existing=True)
    return True


def _resolve_active_set_for_patterns() -> list[str]:
    """Active set for the vision judge: the curated leader_universe (same active
    set the pattern scan prioritizes), falling back to the head of cap_universe.
    Kept small + curated so the Opus judge never runs the full ~3,700 universe."""
    tickers: list[str] = []
    for fname in ("leader_universe.json", "cap_universe.json"):
        path = os.path.join(os.path.dirname(__file__), "data", fname)
        if not os.path.exists(path):
            path = os.path.join("api", "data", fname)
        if not os.path.exists(path):
            continue
        try:
            with open(path) as f:
                data = json.load(f)
        except Exception:
            continue
        if isinstance(data, dict):
            tickers = [t for t in data.get("tickers", []) if isinstance(t, str)]
        elif isinstance(data, list):
            tickers = [t for t in data if isinstance(t, str)]
        if tickers:
            break
    # de-dup, preserve order
    seen, out = set(), []
    for t in tickers:
        u = t.upper()
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def register_call_recap_warm_jobs(scheduler):
    """Pre-generate call recaps so the modal is a point-read, not a ~39s wait.

    Runs FOUR times on weekdays rather than once, because a reader opening a
    name that reported this morning should not wait for tonight:
      07:30 ET — before the open, covers last night's AMC calls
      12:30 ET — midday, covers this morning's BMO calls
      17:15 ET — after the close, ahead of the 18:30 keyword scan
      21:30 ET — late sweep for anything that published slowly
    Each sweep is incremental (`store.has` skips a stored call before spending),
    so the extra runs cost time, not money.

    Returns True if the jobs were registered.
    """
    import os
    if os.environ.get("CALL_RECAP_WARM_ENABLED", "").strip() != "1":
        return False
    from apscheduler.triggers.cron import CronTrigger

    _wlog = logging.getLogger(__name__)

    def _run_warm_sweep():
        try:
            from api.services import call_recap_warmer as warmer
            from api.services import transcript_keyword_alerts as ka
            from api.services.engine import get_earnings
            # Today's buckets lead — a name that reported this morning is the one
            # most likely to be opened — then the recent tape behind it. Today's
            # calendar ALONE is not a queue: a Wednesday reporter would never be
            # swept again and its recap would stay cold for good.
            syms = list(ka.reporters_from_earnings(get_earnings() or {}))
            seen = set(syms)
            for s in warmer.recent_reporters():
                if s not in seen:
                    seen.add(s)
                    syms.append(s)
            if not syms:
                _wlog.info("[recap_warm] no reporters; nothing to warm")
                return
            _wlog.info("[recap_warm] %s", warmer.run_sweep(syms))
        except Exception as exc:
            _wlog.warning("[recap_warm] sweep failed: %s", exc)

    # Every day, not mon-fri: a Friday-evening call can publish on Saturday, and
    # a weekend deploy must not leave every recap cold until Monday.
    for hour, minute in ((7, 30), (12, 30), (17, 15), (21, 30)):
        scheduler.add_job(
            _run_warm_sweep,
            trigger=CronTrigger(hour=hour, minute=minute, timezone=_ET),
            id=f"call_recap_warm_{hour:02d}{minute:02d}", replace_existing=True)

    # Prime shortly after boot instead of waiting for the next cron. Sweeps are
    # incremental (`store.has` skips a stored call before spending), so a
    # redeploy re-runs this for pennies rather than paying for the set again.
    from datetime import datetime as _dt, timedelta as _td
    scheduler.add_job(
        _run_warm_sweep, trigger="date",
        run_date=_dt.now(_ET) + _td(seconds=120),
        id="call_recap_warm_boot", replace_existing=True)
    return True


def register_transcript_index_jobs(scheduler):
    """Keep the cross-company transcript search corpus current.

    FMP Ultimate is uncapped, so the only cost is wall-clock and disk — which
    is why this runs on a schedule rather than on the request path, and why the
    index is pruned to a retention window instead of growing forever on a
    shared volume.

    Twice daily plus a one-shot after boot: transcripts publish through the
    evening, and a deploy should not leave search a day stale.
    """
    import os
    if os.environ.get("TRANSCRIPT_INDEX_ENABLED", "").strip() != "1":
        return False
    from apscheduler.triggers.cron import CronTrigger

    _ilog = logging.getLogger(__name__)

    def _run_index_sweep():
        try:
            from api.services import transcript_index as ix
            from api.services import transcript_indexer as ixr
            _ilog.info("[tindex] %s", ixr.run_index_sweep())
            dropped = ix.prune()
            if dropped:
                _ilog.info("[tindex] pruned %s calls past the retention window", dropped)
        except Exception as exc:
            _ilog.warning("[tindex] sweep failed: %s", exc)

    for hour, minute in ((6, 45), (20, 45)):
        scheduler.add_job(
            _run_index_sweep,
            trigger=CronTrigger(hour=hour, minute=minute, timezone=_ET),
            id=f"transcript_index_{hour:02d}{minute:02d}", replace_existing=True)

    from datetime import datetime as _dt2, timedelta as _td2
    scheduler.add_job(
        _run_index_sweep, trigger="date",
        run_date=_dt2.now(_ET) + _td2(seconds=180),
        id="transcript_index_boot", replace_existing=True)
    return True


def register_transcript_keyword_jobs(scheduler):
    """Cross-company transcript keyword alerts — "tell anyone who follows the word
    'tariff' when any company says it on a call".

    18:30 ET weekdays: after AMC calls have published (FMP posts within ~2h) and
    clear of the 16:35 capture / 16:40 grade / 21:00 backfill window those jobs
    already contend for. Double-gated — the flag here AND `run_scan`'s own check
    — so a half-configured deploy stays inert rather than half-firing.

    Returns True if the job was registered.
    """
    import os
    if os.environ.get("TRANSCRIPT_KEYWORD_ALERTS_ENABLED", "").strip() != "1":
        return False
    # Imported inside the function like every other registrar here — see the
    # module-header note on the APScheduler tz trap.
    from apscheduler.triggers.cron import CronTrigger

    _kwlog = logging.getLogger(__name__)

    def _run_keyword_alert_scan():
        try:
            from api.services import transcript_keyword_alerts as ka
            from api.services.engine import get_earnings
            syms = ka.reporters_from_earnings(get_earnings() or {})
            if not syms:
                _kwlog.info("[kw_alerts] no reporters today; nothing to scan")
                return
            # Log the WORK DONE (scanned / fired), not merely that we ran — a
            # count-based monitor cannot tell a hang from a finish.
            _kwlog.info("[kw_alerts] %s over %d reporters", ka.run_scan(syms), len(syms))
        except Exception as exc:
            _kwlog.warning("[kw_alerts] scan failed: %s", exc)

    scheduler.add_job(
        _run_keyword_alert_scan,
        trigger=CronTrigger(day_of_week="mon-fri", hour=18, minute=30, timezone=_ET),
        id="transcript_keyword_alerts", replace_existing=True)
    return True


def register_pattern_vision_jobs(scheduler):
    """Register the hourly Opus-vision pattern judge over the active set.
    Gated by PATTERN_VISION_ENABLED (default on). Capped per run by
    PATTERN_VISION_MAX_PER_RUN. Returns True if registered."""
    import os
    if os.environ.get("PATTERN_VISION_ENABLED", "1") != "1":
        return False
    from apscheduler.triggers.cron import CronTrigger
    from api.services.pattern_vision import orchestrator as pv_orch

    def _run():
        try:
            cap = int(os.environ.get("PATTERN_VISION_MAX_PER_RUN", "150"))
            for t in _resolve_active_set_for_patterns()[:cap]:
                pv_orch.judge_ticker(t)
        except Exception as e:
            print(f"[scheduler] pattern_vision job error: {e}")

    # Cost tightening: only judge during regular market hours on weekdays
    # (was hourly, 24x/day → most runs happened overnight/weekends when charts
    # don't change). Scheduler TZ is America/New_York, so 9-16 = 9am-4pm ET.
    scheduler.add_job(_run,
                      trigger=CronTrigger(day_of_week="mon-fri", hour="9-16", minute=0, timezone=_ET),
                      id="pattern_vision_judge", max_instances=1,
                      replace_existing=True)
    return True


def idb_cache_logic_version(src_path: str | None = None) -> int | None:
    """`CACHE_LOGIC_VERSION` as it is DECLARED in `app/src/utils/barsIDB.js`.

    ⛔ THE FINGERPRINT USED TO CARRY A HARDCODED `idb_cache_logic_version=4` AND
    THE CONSTANT HAD BEEN 5 SINCE 2026-07-14. That line exists, in CLAUDE.md's
    own words, "for grep verification" — so the designated verification artifact
    confirmed a stale number, and an agent told to "bump to 5 or higher" to
    invalidate poisoned browser caches would bump it TO THE VALUE ALREADY LIVE,
    invalidate nothing, and then grep this line and read green. A fingerprint
    that can disagree with the thing it fingerprints is worse than no
    fingerprint.

    Returns `None` when the source file is not on disk (a runtime image that
    ships only `app/dist`), and also when the declaration is absent or
    AMBIGUOUS, so the fingerprint can say `unreadable` — which is a true
    statement — rather than a number nobody checked.

    ⚠️ IT READS THE DECLARATION, NOT A MENTION. The first cut of this function
    was `re.search(r"CACHE_LOGIC_VERSION\\s*=\\s*(\\d+)")` over the whole file
    and its own control caught it: `barsIDB.js` explains the constant in the
    COMMENT BLOCK ABOVE IT, so a prose sentence naming an old value would be
    read as the value. Same defect as the `(\\d+) passed` regexes in
    `tools/*_mutations.py` — a scan that reads prose answers a different
    question than the one it was asked.
    """
    import re as _re
    from pathlib import Path as _Path
    path = _Path(src_path) if src_path else (
        _Path(__file__).resolve().parents[1] / "app" / "src" / "utils" / "barsIDB.js")
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    found = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith(("//", "*", "/*")):
            continue
        m = _re.match(r"(?:export\s+)?const\s+CACHE_LOGIC_VERSION\s*=\s*(\d+)\b",
                      stripped)
        if m:
            found.append(int(m.group(1)))
    # Exactly one declaration, or we do not know. Two declarations means the
    # answer depends on which one the bundler picks, and guessing there is how a
    # fingerprint starts lying again.
    return found[0] if len(found) == 1 else None


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

    # Self-logging burst capture (2026-06-09/10 thread-exhaustion incident).
    try:
        _start_thread_burst_watch()
    except Exception as e:
        print(f"[startup] thread-burst watch failed to start (non-fatal): {e}")

    try:
        _init_auth_db()
    except Exception as e:
        print(f"[startup] Auth DB init error (non-fatal): {e}")

    # Promote any ADMIN_EMAILS user already in the DB to role='admin' on boot,
    # so admin grants take effect immediately without requiring the user to
    # log out and back in (login/signup auto-promote is the other path).
    try:
        from api.routers.auth import ADMIN_EMAILS
        from api.services.auth_db import get_connection
        conn = get_connection()
        try:
            cur = conn.execute(
                "UPDATE users SET role = 'admin' "
                "WHERE email IN ({}) AND (role IS NULL OR role != 'admin')".format(
                    ",".join("?" * len(ADMIN_EMAILS))
                ),
                tuple(ADMIN_EMAILS),
            )
            conn.commit()
            if cur.rowcount:
                print(f"[startup] Promoted {cur.rowcount} ADMIN_EMAILS user(s) to admin")
        finally:
            conn.close()
    except Exception as e:
        print(f"[startup] Admin promotion (non-fatal): {e}")

    # 7/8 one-shot migration — purge any reconcile_* rows from flow.db. These
    # were inserted via the (now-removed) /api/flow-reconcile/insert endpoint
    # as manual BBS backfills. Principle established 7/7 session: Massive is
    # the source of truth for LiveFlow migration; every reconcile row papers
    # over a real pipeline gap. Router mount + source_clause read paths were
    # removed in the same commit as this migration. Idempotent — DELETE with
    # no matches on subsequent boots is a no-op. Safe to leave in indefinitely
    # as a defensive belt against any accidental future reinsertion.
    try:
        import sqlite3 as _sq
        with _sq.connect("/data/flow.db", timeout=30) as _conn:
            _cur = _conn.execute(
                "SELECT COUNT(*) FROM flow WHERE source LIKE 'reconcile_%'"
            )
            _n_before = _cur.fetchone()[0]
            if _n_before:
                _cur = _conn.execute(
                    "DELETE FROM flow WHERE source LIKE 'reconcile_%'"
                )
                _conn.commit()
                print(f"[startup] Purged {_cur.rowcount} reconcile_* row(s) "
                      f"from flow.db (one-shot 7/8 migration)")
            else:
                # Post-first-run steady state — leave a quiet trace to confirm
                # the migration is still wired without spamming logs.
                pass
    except Exception as e:
        print(f"[startup] Reconcile purge migration (non-fatal): {e}")

    # Initialize tweets.db schema unconditionally -- the schema is tiny and
    # idempotent. Frontend tweet UI (VITE_TWITTER_UI_ENABLED, default ON)
    # fires requests on every page load; without a schema, the read
    # endpoints would 500 on "no such table". Polling itself is still
    # gated separately by TWITTERAPI_IO_ENABLED below, so a missing key
    # results in an empty DB rather than crashes.
    try:
        from api.services import tweet_store
        tweet_store._init_db()
        tweet_store.ensure_default_accounts()
        tweet_store.ensure_official_accounts()  # firm's own accounts -> Desk Posts
        print("[startup] tweets.db initialized")
    except Exception as e:
        print(f"[startup] tweet_store init failed (non-fatal): {e}")

    # Initialize desk.db schema unconditionally (The Desk hub -- Substack
    # articles + Team members). Tiny + idempotent; the Desk reads 500 without it.
    try:
        from api.services import desk_store
        desk_store._init_db()
        desk_store.ensure_default_publications()  # firm's Substack feed
        desk_store.ensure_default_team()          # firm's traders ("Meet the Team")
        print("[startup] desk.db initialized")
        # Fire an initial Substack poll in the background so Articles isn't empty
        # before the hourly job's first :07 run. Best-effort, never blocks boot.
        if os.environ.get("SUBSTACK_ENABLED", "1").lower() in ("1", "true", "yes"):
            import threading as _desk_threading
            from api.services.substack_poller import poll_all as _substack_poll_once
            _desk_threading.Thread(target=_substack_poll_once, daemon=True,
                                   name="substack-initial-poll").start()
    except Exception as e:
        print(f"[startup] desk_store init failed (non-fatal): {e}")

    # Initialize catalysts.db schema unconditionally (same pattern as tweets.db).
    # Frontend tile fires /api/catalysts/today on every page load; without
    # schema, it would 500 on missing table.
    try:
        from api.services.catalyst import store as _cat_store
        _cat_store._init_db()
        print("[startup] catalysts.db initialized")
    except Exception as e:
        print(f"[startup] catalyst_store init failed (non-fatal): {e}")

    # Premarket startup catch-up: a redeploy DURING the premarket window (e.g. a
    # 7:15am deploy skips the 7:00 cron) would otherwise leave the board stale
    # until the next cron or a user's tile load. On boot, if it's a weekday
    # 6am-9:30am ET and today's board is empty or stale, kick a refresh now so
    # it's fresh BEFORE the trader sits down. Mirrors the COT startup catch-up.
    try:
        if os.environ.get("CATALYST_ENGINE_ENABLED", "").lower() in ("1", "true", "yes"):
            from zoneinfo import ZoneInfo as _Z
            _net = datetime.now(_Z("America/New_York"))
            _premkt = _net.weekday() < 5 and (6 <= _net.hour < 10)
            if _premkt:
                from api.services.catalyst import store as _cs
                _md = _net.date().isoformat()
                _rows = _cs.get_for_date(_md, ranked_only=True)
                _ref = _cs.last_refresh_for_date(_md)
                _stale = (_ref is None) or ((time.time() - _ref) / 60.0 > 45)
                if not _rows or _stale:
                    from api.services.catalyst.engine import run_refresh as _crf
                    # Feed-only: a deploy must not consume the day's deep sweep
                    # early — the 8:00 ET hunt tick owns it (schedule v5).
                    threading.Thread(target=lambda: _crf(hunt=False), daemon=True,
                                     name="catalyst-startup-catchup").start()
                    print("[startup] catalyst premarket catch-up refresh kicked")
    except Exception as e:
        print(f"[startup] catalyst premarket catch-up failed (non-fatal): {e}")

    try:
        from api.services import wire_feedback_store as _wf_store
        _wf_store._init_db()
        print("[startup] wire_feedback.db initialized")
    except Exception as e:
        print(f"[startup] wire_feedback_store init failed (non-fatal): {e}")

    # Initialize modelbook.db schema unconditionally (same pattern as above).
    # The Model Book page fires /api/modelbook/years on load; without a schema
    # the read endpoints would 500 on "no such table".
    try:
        from api.services import modelbook_service
        modelbook_service._init_db()
        modelbook_service.seed_initial()  # one-time bootstrap (flag-gated)
        modelbook_service.migrate_dollar_volume()  # recompute avg_vol as $ volume
        modelbook_service.regen_descriptions("prompt_v3")  # rewrite narratives (less repetitive)
        modelbook_service.regen_catalysts("bullish_v1")  # drop old AI catalysts -> regen bullish/stock-specific
        modelbook_service.heal_custom_bars_derived("custom_bars_v1")  # recompute stats/catalysts from uploaded bars (YELL=YRCW etc.)
        modelbook_service.regen_year_recaps("len_v2")  # rebuild recaps without the 1200-char mid-word cut
        print("[startup] modelbook.db initialized")
        # Background pre-warm of year-gain stats so the gallery loads instantly.
        import threading as _mb_threading
        from api.routers import modelbook as _mb_router
        _mb_threading.Thread(target=_mb_router.warm_all_stats, daemon=True,
                             name="modelbook-stats-warm").start()
    except Exception as e:
        print(f"[startup] modelbook init failed (non-fatal): {e}")

    # News & Catalysts widget cache DB (independent of modelbook init above).
    try:
        from api.services.news_catalysts import store as _nc_store
        _nc_store._init_db()
        print("[startup] news_catalysts.db initialized")
    except Exception as e:
        print(f"[startup] news_catalysts init failed (non-fatal): {e}")

    # Stock Profile widget cache DB (AI company description + YTD narrative).
    try:
        from api.services.stock_brief import store as _sb_store
        _sb_store._init_db()
        print("[startup] stock_brief.db initialized")
    except Exception as e:
        print(f"[startup] stock_brief init failed (non-fatal): {e}")

    # Initialize charts_layouts.db schema unconditionally (same pattern). The
    # Charts workspace fires /api/charts/layouts on load; without a schema the
    # read endpoint would 500 on "no such table".
    try:
        from api.services import charts_layout_service
        charts_layout_service._init_db()
        print("[startup] charts_layouts.db initialized")
    except Exception as e:
        print(f"[startup] charts_layouts init failed (non-fatal): {e}")

    # Initialize user_definitions.db schema unconditionally (same pattern). It is
    # its OWN file rather than a `chart_settings` key because `mergeChartSettings`
    # is a hard allow-list that DESTROYS an unknown top-level key on every read.
    try:
        from api.services import user_definitions
        user_definitions._init_db()
        print("[startup] user_definitions.db initialized")
    except Exception as e:
        print(f"[startup] user_definitions init failed (non-fatal): {e}")

    # Initialize education.db schema unconditionally (same pattern as above).
    # The Educational Videos page fires /api/education/videos on load; without a
    # schema the read endpoint would 500 on "no such table".
    try:
        from api.services import education_service
        education_service._init_db()
        education_service.ensure_default_videos()  # firm workshop library (idempotent)
        education_service.ensure_default_paths()  # six Learning Paths → edu_paths (one-shot)
        print("[startup] education.db initialized")
    except Exception as e:
        print(f"[startup] education init failed (non-fatal): {e}")

    try:
        from api.services import desk_session_jobs as _dsj_boot
        _dsj_boot._init_db()
    except Exception as _e:
        print(f"[startup] desk_session_jobs init skipped: {_e}")

    try:
        from api.services import community_store
        community_store._init_db()
        logging.getLogger(__name__).info("community store ready")
    except Exception as e:
        logging.getLogger(__name__).exception(f"community store init failed: {e}")

    # Live-chat presence: coalesced snapshot broadcast every ~8s (ephemeral frames).
    # Single web process → the in-memory chat hub needs no external pub/sub.
    try:
        import asyncio as _asyncio_chat
        from api import chat_stream as _chat_hub

        async def _chat_presence_loop():
            while True:
                await _asyncio_chat.sleep(8)
                try:
                    _chat_hub.get_hub().broadcast_presence_all()
                except Exception:
                    pass

        _asyncio_chat.create_task(_chat_presence_loop())
        logging.getLogger(__name__).info("chat presence broadcaster started")
    except Exception as e:
        logging.getLogger(__name__).warning(f"chat presence broadcaster skip: {e}")

    # Load ticker baselines (per-ticker premium percentiles) into in-memory
    # cache for fast lookup by the LiveFlow worker's gate-check logic. Data
    # lives in /data/flow.db (the OptionsFlow store) -- populated by the
    # admin /refresh-baselines endpoint when fresh CSVs are uploaded.
    # On a cold restart this just reads the existing ticker_baselines table;
    # no recomputation, ~50ms. If the table doesn't exist yet (first deploy
    # before any refresh), init_db creates it empty and load_baselines
    # returns 0 -- harmless, gate-check code falls back to static thresholds.
    try:
        from api import baselines as _baselines
        _baselines.init_db()
        loaded = _baselines.load_baselines()
        print(f"[startup] ticker baselines loaded ({loaded} tickers)")
    except Exception as e:
        # Try root-level import as fallback for filesystem layouts that
        # don't have an `api` package wrapping standalone modules.
        try:
            import baselines as _baselines
            _baselines.init_db()
            loaded = _baselines.load_baselines()
            print(f"[startup] ticker baselines loaded ({loaded} tickers, root import)")
        except Exception as e2:
            print(f"[startup] baselines load failed (non-fatal): {e} / {e2}")

    # Chart-health bootstrap: init quarantine + audit schemas synchronously so
    # the tables exist before any /api/bars handler runs, then spawn a daemon
    # thread to scan existing cache files for corruption (slow -- up to ~18,425
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
        from api.services import alert_rev_migration as _alert_rev
        indicator_alert_service.init_schema()
        # ⭐ AT BOOT, NOT ON THE FIRST ALERT. `alert_rev_migration.init_schema()`
        # ALTERs `indicator_alert_rev` to add `def_hash`, and it had no startup
        # caller — so the column would have appeared on whichever request first
        # touched the alert lane, i.e. inside a member's call rather than during
        # a deploy. Idempotent and additive (the ALTER is skipped once present),
        # so running it here costs a no-op on every boot after the first.
        _alert_rev.init_schema()
        indicator_alert_evaluator.start_evaluator(interval_sec=60)
        logging.getLogger(__name__).info("[startup] indicator alert evaluator started")
    except Exception:
        logging.getLogger(__name__).exception("[startup] indicator alert evaluator failed to start")

    # Awareness Engine (M1): durable regime-label ledger. Cheap + idempotent;
    # initialized unconditionally (like indicator_alert_service) so local
    # dev/tests never need AWARENESS_ENGINE_ENABLED=1 just to read/write it.
    try:
        from api.services.awareness import regime_snapshots as _awareness_regime_snapshots
        _awareness_regime_snapshots.init_schema()
        logging.getLogger(__name__).info("[startup] awareness regime_snapshots schema ready")
    except Exception:
        logging.getLogger(__name__).exception(
            "[startup] awareness regime_snapshots schema init failed"
        )

    try:
        _start_priority_audit_background()
        logging.getLogger(__name__).info("[startup] priority audit scheduled (~30s after boot)")
    except Exception as e:
        logging.getLogger(__name__).exception("[startup] failed to schedule priority audit: %s", e)

    # Readiness gates -- /api/ready (railway.json healthcheckPath) stays 503
    # until each of these warmers finishes, so Railway keeps serving from the
    # OLD warm pod instead of cutting traffic to a cold one. Each gate is
    # registered immediately before its warmer starts and released in the
    # `except` if the warmer could not even be scheduled, so a scheduling
    # failure can never hold a deploy hostage.
    try:
        readiness.register("hot_tier")
        _start_hot_tier_warm_background()
        logging.getLogger(__name__).info("[startup] hot tier warm scheduled (~45s after boot)")
    except Exception:
        readiness.mark_done("hot_tier")
        logging.getLogger(__name__).exception("[startup] failed to schedule hot tier warm")

    try:
        readiness.register("dashboard")
        _start_dashboard_warm_background()
        _start_calendar_enrichment_warm_background()
        logging.getLogger(__name__).info(
            "[startup] dashboard warm scheduled (~20s after boot); "
            "calendar-enrichment re-warm every 240s (under the 300s TTL)")
    except Exception:
        readiness.mark_done("dashboard")
        logging.getLogger(__name__).exception("[startup] failed to schedule dashboard warm")

    try:
        readiness.register("rs_rankings")
        _start_rs_rankings_warm_background()
        logging.getLogger(__name__).info("[startup] rs-rankings warm scheduled (~120s after boot)")
    except Exception:
        readiness.mark_done("rs_rankings")
        logging.getLogger(__name__).exception("[startup] failed to schedule rs-rankings warm")

    try:
        _start_industry_map_background()
        logging.getLogger(__name__).info("[startup] industry-map prewarm scheduled (~75s after boot)")
    except Exception:
        logging.getLogger(__name__).exception("[startup] failed to schedule industry-map prewarm")

    try:
        _start_darkpool_prewarm_background()
        logging.getLogger(__name__).info("[startup] darkpool prewarm scheduled (~60s after boot)")
    except Exception:
        logging.getLogger(__name__).exception("[startup] failed to schedule darkpool prewarm")

    # One-shot backfill of company NAMES for disk-cached ticker-meta entries that
    # the old partial-yfinance bug poisoned with name=None (sector/industry present
    # but no name → missing company name in the chart header + watermark). Self-
    # gates on a flag file + spawns its own rate-limited daemon thread.
    try:
        from api.services import ticker_meta as _ticker_meta
        _ticker_meta.heal_nameless_names()
        logging.getLogger(__name__).info("[startup] ticker-meta name-heal scheduled (one-shot)")
    except Exception:
        logging.getLogger(__name__).exception("[startup] failed to schedule ticker-meta name-heal")

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

    # Start the reconciliation worker -- diffs SQLite vs Polygon canonical
    # periodically, auto-heals any drift. Structural safety net behind every
    # chart correctness invariant. Runs HERE on the web pod (on by default;
    # RECONCILE_ENABLED=0 to disable): the worker->web R2 merge is INSERT OR
    # IGNORE and can't overwrite bad rows, so the heal must run where users
    # read. Massive is flat-rate, so canonical fetches cost nothing.
    try:
        from api.services import bars_reconciliation
        bars_reconciliation.start()
        logging.getLogger(__name__).info("[startup] bars_reconciliation started")
    except Exception:
        logging.getLogger(__name__).exception("[startup] bars_reconciliation start failed")

    # Fundamentals-accuracy monitor (web-side, same cache-locality reasoning as
    # bars_reconciliation). No-ops unless FUNDAMENTALS_MONITOR_ENABLED=1.
    try:
        from api.services import fundamentals_monitor
        fundamentals_monitor.start()
        logging.getLogger(__name__).info("[startup] fundamentals_monitor started")
    except Exception:
        logging.getLogger(__name__).exception("[startup] fundamentals_monitor start failed")

    # Provider-coverage monitor (Task 22/23, 2026-08-05 data-dependability
    # migration) — generalizes fundamentals_monitor's detect->self-heal->alert
    # pattern to per-FIELD fill rate across research/earnings surfaces (the
    # two Finnhub endpoints that 403'd on every call for months were a 200
    # response with an empty field, not a down endpoint — this catches that
    # class). Web-side for the same reason: self-heal is a cache invalidation
    # and the cache users read is web-local. No-ops unless
    # PROVIDER_COVERAGE_MONITOR_ENABLED=1.
    try:
        from api.services import provider_coverage_monitor
        provider_coverage_monitor.start()
        logging.getLogger(__name__).info("[startup] provider_coverage_monitor started")
    except Exception:
        logging.getLogger(__name__).exception("[startup] provider_coverage_monitor start failed")

    # Volume-level disk watchdog. Runs on EVERY service (web/worker/flow-worker)
    # because the 2026-07-23 incident proved per-feature disk guards can't see
    # the neighbour that's actually eating the volume. DISK_WATCHDOG_ENABLED=0
    # to disable.
    try:
        from api.services import disk_watchdog
        if disk_watchdog.start():
            logging.getLogger(__name__).info(
                "[startup] disk_watchdog started (warn=%s%% crit=%s%% every %ss)",
                disk_watchdog.WARN_PCT, disk_watchdog.CRIT_PCT,
                disk_watchdog.CHECK_SECONDS)
    except Exception:
        logging.getLogger(__name__).exception("[startup] disk_watchdog start failed")

    try:
        from api.services import realtime_candle
        import asyncio
        asyncio.create_task(realtime_candle.reconciliation_worker())
        logging.getLogger(__name__).info("[startup] realtime_candle reconciliation_worker scheduled")
    except Exception as e:
        logging.getLogger(__name__).exception("[startup] failed to schedule reconciliation_worker: %s", e)

    # Live options-flow SSE tailer (2026-07-08) — the instant-tape backend.
    # Reads flow.db for new prints and pushes them to connected browsers. Inert
    # unless MASSIVE_STREAM_ENABLED=1 (dark by default); decoupled from the OPRA
    # write path. start() is a no-op without a running loop or when disabled.
    try:
        from api import massive_stream
        massive_stream.start()
    except Exception as e:
        logging.getLogger(__name__).exception("[startup] massive_stream start failed: %s", e)

    # Curated-tape SSE tailer (2026-08-03) — the curated twin of the above.
    # Pushes newly-CURATED alerts to /api/live/massive/curated-stream so the
    # curated feed surfaces instantly instead of on the 20s poll. Inert unless
    # MASSIVE_CURATED_STREAM_ENABLED=1 (dark by default). Started on both pods
    # for parity with massive_stream; when flow reads are proxied the curated
    # SSE forwards to flow-worker, so web's tailer stays idle (no subscribers).
    try:
        from api import massive_curated_stream
        massive_curated_stream.start()
    except Exception as e:
        logging.getLogger(__name__).exception("[startup] massive_curated_stream start failed: %s", e)

    # Live Flow worker -- RE-ENABLED 2026-06-17 with thread isolation (Option 2).
    # Previously disabled because the in-process SSE consumer was starving
    # FastAPI's main event loop (Cloudflare 524s, 19s CSV loads). The fix:
    # run liveflow_worker.run_forever() inside a dedicated daemon thread with
    # its own asyncio loop, so httpx SSE reads (timeout=None) can never block
    # request-handling. See api/liveflow_worker_threaded.py.
    # If perf regresses (CSV fetch >5s on /options-flow), wrap this block in
    # `if False:` to disable and ping the dev channel.
    try:
        from api import liveflow_worker_threaded
        liveflow_worker_threaded.start()
        logging.getLogger(__name__).info(
            "[startup] liveflow_worker started in isolated thread"
        )
    except Exception as e:
        logging.getLogger(__name__).exception(
            "[startup] failed to start liveflow_worker thread: %s", e
        )

    # SQLite integrity check -- heavy on 58M rows, run in background
    def _integrity_check_bg():
        try:
            from api.services import bars_sqlite as _bs_check
            import time as _ic_t
            _ic_t0 = _ic_t.time()
            if not _bs_check.integrity_ok():
                print(f"[startup] bars.db failed PRAGMA integrity_check after {_ic_t.time()-_ic_t0:.1f}s -- pulling fresh snapshot from R2")
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

    # Pre-build the by-date daily index (once per volume) off the boot path so the
    # pre-~2004 Custom-Period Sort is instant on first use instead of triggering a
    # ~1-2 min build under the user. Delayed so it doesn't fight the startup warms.
    def _build_bydate_index_bg():
        try:
            import time as _t
            _t.sleep(90)
            from api.services import bars_sqlite as _bs
            _bs.ensure_daily_bydate_index()
            # Then pre-warm the shared ticker-reuse map (its whole-universe scan was the
            # 3-5-min-per-range cost for pre-2004 sorts) so it's ready before anyone sorts.
            from api.services import scan_period as _sp
            _sp.warm_reuse_map()
        except Exception as e:
            print(f"[startup] by-date daily index / reuse-map pre-build error (non-fatal): {e}")
    threading.Thread(target=_build_bydate_index_bg, daemon=True, name="sqlite-bydate-index").start()

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

    # -- FMP timezone-bug heal (one-shot, gated by flag) ---------------------
    # Commit 87b7d88 fixed _fetch_intraday_fmp which had stored bars at
    # timestamps shifted by the ET-UTC offset (FMP returns ET text; the
    # naive .strptime + .timestamp() round-tripped through the container's
    # UTC clock, landing every FMP-sourced row 4-5 hours BEHIND its true
    # moment). New writes are correct, but the bug's poisoned rows sit at
    # WRONG ts values -- INSERT OR REPLACE on a *correct* ts touches a
    # different primary-key tuple, so Massive's later good writes never
    # overwrite the bad rows and the chart stays corrupt.
    #
    # Surgical heal: drop intraday rows from the last 14 days only. That's
    # the window where the bug actively wrote (older bars are immutable
    # history that pre-dates the bug being live on this code path, and
    # wiping deep intraday would lose months of chart context for nothing).
    # The next user request on each chart triggers a Massive refetch under
    # the fixed FMP fallback path and refills correctly. Daily/Weekly/Monthly
    # are untouched -- the bug was intraday-only.
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

    # -- Strict-> heal (one-shot, gated by flag) --------------------------------
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

    # -- Intraday heal v3: 60-day deep history wipe (one-shot, gated by flag) --
    # v1 + v2 covered the last 14 days. Bars older than 14 days could still
    # carry legacy artifacts from pre-fix code: FMP-shifted timestamps,
    # partial-bar storage frozen by the prior strict-> filter, validation
    # rejections that left gaps which never refilled. Extending the wipe to
    # 60 days clears the bulk of accumulated muscle memory and lets the now-
    # correct fetch+resample paths rebuild from Polygon canonical.
    # Trade-off: more cold-load slowness on the long tail of tickers for ~1-2
    # hours after deploy as the cache repopulates. Acceptable since markets
    # are closed (weekend) -- heals before Tuesday open with zero user impact.
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

    # ── Weekly close-date heal (one-shot, gated by flag) ───────────────────────
    # Weekly candles were re-dated from the week's OPEN (first trading day of
    # the ISO week, usually Monday) to its CLOSE (Friday of the ISO week) so the
    # latest weekly bar reads e.g. 2026-06-19 for the 6/15-6/19 week instead of
    # the confusing 6/15. The bar's date IS its SQLite primary key (ts), so every
    # already-stored weekly row sits at the OLD Monday key. New fetches write the
    # Friday key → both would coexist and the chart would show TWO candles per
    # week until the stale rows age out. Surgical heal: drop ALL weekly rows once;
    # the next weekly chart load on each ticker repopulates clean under the new
    # Friday keys. Daily/intraday/monthly are untouched (monthly dating unchanged).
    # Browser IndexedDB self-heals separately: the D/W/M fetch path is always a
    # full no-`since` fetch that OVERWRITES the cached weekly array with the
    # authoritative server response, so no client-side cache bump is needed.
    try:
        _heal_flag_wk = os.path.join(os.environ.get("DATA_DIR", "/data"), ".weekly_close_date_heal_v1")
        if not os.path.exists(_heal_flag_wk):
            import sqlite3 as _heal_sqlite_wk
            db_path_wk = os.path.join(os.environ.get("DATA_DIR", "/data"), "bars.db")
            if os.path.exists(db_path_wk):
                conn = _heal_sqlite_wk.connect(db_path_wk, timeout=30)
                try:
                    conn.execute("PRAGMA busy_timeout=30000")
                    cur = conn.execute("DELETE FROM ohlcv WHERE tf = 'W'")
                    deleted_wk = cur.rowcount
                    conn.commit()
                    print(f"[startup] weekly_close_date_heal: removed {deleted_wk} weekly rows; next chart load on each ticker refills with Friday-dated candles")
                finally:
                    conn.close()
                try:
                    from api.services import bars_sqlite as _heal_bs_wk
                    _heal_bs_wk.bump_db_epoch()
                except Exception:
                    pass
                # Clear in-memory + disk JSON caches for weekly so they don't keep
                # serving the old Monday-dated payload until SQLite repopulates.
                try:
                    from api.services.cache import cache as _heal_mem_wk
                    _heal_mem_wk.delete_prefix("bars_")
                except Exception:
                    pass
                try:
                    _disk_dir_wk = os.path.join(os.environ.get("DATA_DIR", "/data"), "bars_cache")
                    if os.path.isdir(_disk_dir_wk):
                        _dn_wk = 0
                        for _fn in os.listdir(_disk_dir_wk):
                            if not _fn.endswith(".json"):
                                continue
                            _parts = _fn[:-5].split("_")
                            # bars_cache filenames: "{SYM}_{tf}_{bars}.json"
                            if len(_parts) >= 2 and _parts[1] == "W":
                                try:
                                    os.remove(os.path.join(_disk_dir_wk, _fn))
                                    _dn_wk += 1
                                except OSError:
                                    pass
                        print(f"[startup] weekly_close_date_heal: removed {_dn_wk} weekly disk-cache files")
                except Exception:
                    pass
            try:
                with open(_heal_flag_wk, "w") as _f:
                    _f.write("done")
            except OSError:
                pass
    except Exception as e:
        print(f"[startup] weekly_close_date_heal error (non-fatal): {e}")

    # ── Weekly key purge (content-based, EVERY boot, background) ────────────
    # The flag-gated heal above ran once per volume — but the worker's bars.db
    # never ran it (worker_main doesn't execute this lifespan), so its R2
    # snapshots kept the old Monday-keyed weekly rows and force_resync restored
    # them onto the web pod with the flag file blocking a re-heal (observed
    # 2026-07-02: every week duplicated product-wide). Keyed on CONTENT (a
    # weekly row not dated the Friday of its ISO week is always stale) and
    # idempotent. MUST stay async — its discovery pass scans the ~58M-row
    # table, and running it inline at boot blew the worker's 600s healthcheck
    # (2026-07-03 failed deploy). The serve-time weekly guard in
    # _fmt_sqlite_bars keeps charts clean until the purge lands.
    try:
        from api.services import bars_sqlite as _wk_bs
        _wk_bs.purge_mis_keyed_weekly_rows_async()
        print("[startup] weekly_key_purge: scheduled (background)")
    except Exception as e:
        print(f"[startup] weekly_key_purge error (non-fatal): {e}")

    # Chart pipeline mode fingerprint -- one line so a grep on Tuesday morning
    # tells the operator EXACTLY which fixes are active in this deploy.
    # `idb_cache_logic_version` is READ from barsIDB.js, never typed -- see
    # `idb_cache_logic_version()` for the stale-4-vs-live-5 defect that caused it.
    _idb_ver = idb_cache_logic_version()
    print(
        "[startup] chart-realtime-mode: "
        "fmp_tz_fix=on yfinance_tz_fix=on heal_v1=ran-once heal_v2=ran-once heal_v3_60day=ran-once "
        "needs_fresh_post_market=on "
        "swr_refresh_interval=30s_intraday "
        "tf60_ws_streaming=on bucket_canonical=bars_fetch.bucket_60_et_unix_seconds "
        f"delta_intraday_filter=>= idb_cache_logic_version={_idb_ver if _idb_ver is not None else 'unreadable'} "
        "weekly_dating=friday-close heal_weekly_close=ran-once "
        f"reconciliation_worker={'on' if os.environ.get('RECONCILE_ENABLED', '1') != '0' else 'off'}"
    )

    # Phase C bars-push rail fingerprint — grep-able state of the streaming feed.
    print(
        "[startup] bars-push-rail: "
        f"stream_bars_enabled={'on' if os.environ.get('STREAM_BARS_ENABLED') == '1' else 'off'} "
        "keyed_dispatch=on single_writer_arbitration=on delivering_recency=120s/300s_hysteresis "
        "heartbeat=named watchdog_renotify=10s idle_sleep=250ms "
        "status_endpoint=/api/admin/bars-stream-status (frontend rollout% in StockChart.BARS_PUSH_ROLLOUT_PCT)"
    )

    # Auth-surface audit — does THIS RUNNING app gate its mutating flow routes?
    # tests/test_flow_auth_surface.py proves the source is right; its own
    # docstring names what it cannot prove ("NOT that production is protected"),
    # because the flow surface is proxied and a web deploy does not reach the
    # flow-worker's copy. This inspects the mounted route objects — no request is
    # sent, since an anonymous probe of a mutating endpoint is only safe when the
    # gate works, and RUNS the handler in the one case it exists to catch.
    try:
        from api.auth_surface_check import run_startup_audit
        run_startup_audit(app, service="web")
    except Exception as e:
        print(f"[startup] auth-surface audit skipped: {e}")

    # SIP trade-condition filter — keep ghost prints (odd-lot / out-of-sequence /
    # form-T / average-priced) out of the live candle's high/low + last, on both
    # the Massive push feed and the Finnhub fallback. Best-effort load of the
    # provider's authoritative update_rules in a daemon thread (non-blocking).
    try:
        from api.services import trade_conditions
        trade_conditions.start_background_load()
        print(
            "[startup] trade-condition-filter: "
            f"enabled={'on' if trade_conditions.FILTER_ENABLED else 'off'} "
            "(env TRADE_CONDITION_FILTER_ENABLED) applied_to=massive_push+finnhub "
            "authoritative_rules=loading|fallback"
        )
    except Exception as _tce:
        print(f"[startup] trade-condition-filter init failed (non-fatal): {_tce}")

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
                        _pl = {"ticker": sym, "tf": tf, "bars": _fmt_sqlite_bars(_rows, tf, sym)}
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

                # Pass 2 (universe-wide D/W memory warm) REMOVED 2026-06-15.
                # It looped get_all_tickers() (~3,700 names) and warmed D+W for
                # each into `cache` -- but `cache` is the shared TTLCache bounded
                # at _MAX_SIZE=500 with LRU eviction. So pass 2 was net-negative:
                #   1. it EVICTED pass-1's curated hot set (Tier1 + breadth
                #      movers -- the series users actually want instant) and
                #      replaced them with arbitrary get_all_tickers() order;
                #   2. of the ~7,400 series it touched, only the last 500
                #      survived eviction -- the rest were warmed then immediately
                #      dropped;
                #   3. it churned ~1.8GB of transient bar payloads, which glibc
                #      keeps resident as arena fragmentation (MALLOC_ARENA_MAX is
                #      unset), inflating web-pod RSS toward ~2.4GB.
                # The hot set from pass 1 fits the cache; everything else is
                # served correct+instant on demand (synchronous cold-stale fetch
                # + frontend optimistic bar) and from the disk/worker-snapshot
                # layers. Dropping pass 2 lowers RSS AND improves cache quality.

            except Exception as _e:
                print(f"[startup] Memory pre-warm failed (non-fatal): {_e}")
        threading.Thread(target=_memory_prewarm_background, daemon=True, name="memory-prewarm").start()
        print("[startup] Memory pre-warm scheduled (background thread)")

    # Web-pod memory watch -- the worker has had a [mem] line since the 2026-06-10
    # SIGSEGV work; the web pod only exposed RSS via /api/health (point-in-time),
    # so there was no trend to tell a genuine leak from a large-but-stable
    # working set. Log RSS + thread count every 60s so the 2.4GB observation
    # (2026-06-15) can be confirmed as a plateau (post pass-2 removal) vs. a
    # climb -- the prerequisite for any further memory work.
    def _web_memwatch():
        import time as _mw_time
        while True:
            try:
                _rss = _process_rss_mb()
                if _rss is not None:
                    print(f"[mem] rss_mb={_rss} threads={threading.active_count()}")
            except Exception:
                pass
            _mw_time.sleep(60)
    threading.Thread(target=_web_memwatch, daemon=True, name="web-memwatch").start()

    if os.environ.get("USE_REMOTE_BARS") == "1":
        print("[startup] USE_REMOTE_BARS=1 -- skipping in-process prewarmer/seeder; pulling snapshot from worker via R2")
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
    # fresh entries on each boot. Daemon thread -- never blocks startup.
    try:
        from api.services.ticker_names_prewarm import start_async as _names_start
        _names_start()
        print("[startup] ticker-names prewarm scheduled")
    except Exception as e:
        print(f"[startup] ticker-names prewarm scheduling failed (non-fatal): {e}")

    # One-shot hi-res logo upgrade: re-cache ~3,600 existing 96px logos at 256px.
    # Flag-gated so it runs exactly once; background + low-concurrency so it never
    # hammers upstream. Mirrors the .fmp_tz_heal_v1 startup-heal pattern.
    try:
        _logo_hires_flag = os.path.join(os.environ.get("DATA_DIR", "/data"), ".logo_hires_v1")
        if not os.path.exists(_logo_hires_flag):
            def _logo_hires_runner():
                import time as _t
                _t.sleep(90)  # let startup + names/bars prewarm settle first
                try:
                    from api.services import ticker_logos as _tl
                    _tl.run_hires_upgrade()
                    with open(_logo_hires_flag, "w"):
                        pass
                    print("[startup] logo_hires_v1: upgrade pass complete")
                except Exception as _e:
                    print(f"[startup] logo_hires_v1 error (non-fatal): {_e}")

            import threading as _threading
            _threading.Thread(target=_logo_hires_runner, daemon=True,
                              name="logo-hires-startup").start()
            print("[startup] logo_hires_v1: upgrade scheduled (~90s after boot)")
    except Exception as e:
        print(f"[startup] logo_hires_v1 scheduling failed (non-fatal): {e}")

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
                        print(f"[startup] Skipping boot R2 pull -- local SQLite has "
                              f"{_local_count:,} bars already; preserving local writes "
                              f"(set FORCE_BOOT_R2_PULL=1 to override)")
            except Exception as _e:
                print(f"[startup] Local SQLite probe failed (will pull from R2): {_e}")

            if os.environ.get("FORCE_BOOT_R2_PULL") == "1":
                _skip_boot_pull = False
                print("[startup] FORCE_BOOT_R2_PULL=1 -- pulling boot snapshot regardless")

            if not _skip_boot_pull:
                def _initial_pull():
                    import time as _t
                    _t0 = _t.time()
                    try:
                        # Delta mode: install latest base + apply any deltas now
                        # so a fresh pod is fully current at boot (not one cycle
                        # behind). Falls back to plain full install otherwise.
                        if data_sync.DELTA_ENABLED:
                            ts = data_sync.sync_with_deltas()
                        else:
                            ts = data_sync.sync_if_newer()
                        elapsed = _t.time() - _t0
                        if ts:
                            print(f"[startup] Initial snapshot pull complete in {elapsed:.1f}s "
                                  f"-- cache warm, serving from snapshot {ts}")
                        else:
                            print(f"[startup] Initial snapshot already current ({elapsed:.1f}s) -- cache warm")
                    except Exception as e:
                        elapsed = _t.time() - _t0
                        print(f"[startup] Initial snapshot pull FAILED after {elapsed:.1f}s "
                              f"(non-fatal): {e} -- proceeding with cold cache")
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
                    if data_sync.DELTA_ENABLED:
                        ts = data_sync.sync_with_deltas()
                        if ts:
                            print(f"[data_sync] synced via base+deltas through {ts}")
                    elif _legacy_replace:
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

    # Brain Pack: nightly uct-intelligence code+KB from R2 (flag-off by default)
    if os.environ.get("BRAIN_PACK_ENABLED", "0") == "1":
        try:
            from api.services import brain_sync as _brain_sync
            from api.services import brain_kb_service as _brain_kb
            _brain_sync.on_install(lambda: _brain_kb.reindex())
            _brain_sync.start_background_sync()
            _intel = os.environ.get("UCT_INTEL_PATH")
            if not _intel:
                os.environ["UCT_INTEL_PATH"] = _brain_sync.brain_dir()
            logging.getLogger(__name__).info(
                "brain pack sync enabled; UCT_INTEL_PATH=%s", os.environ.get("UCT_INTEL_PATH")
            )
        except Exception:
            logging.getLogger(__name__).exception("brain pack sync failed to start")

    if os.environ.get("STREAM_BARS_ENABLED") == "1":
        from api.services import bar_stream, bar_broadcaster
        bb = bar_broadcaster.init_broadcaster(
            on_first_subscribe=bar_stream.subscribe_symbols_one,
            on_last_unsubscribe=bar_stream.unsubscribe_symbols_one,
        )
        bar_stream.start_stream(on_bar=bb.push_aggregate)
        print("[startup] Bar stream thread started (Massive WS -> BarBroadcaster, AM+A channels)")

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

    from api.services.theme_db import init_theme_tables, seed_from_json_safe
    init_theme_tables()
    seed_from_json_safe()

    # Theme Membership Engine — overlay tables + crash recovery. Guarded: the
    # engine is additive and must never block boot. abort_stale_runs closes
    # engine_runs rows left open >3h by a mid-run deploy/crash so /status and
    # the nightly job never see a phantom "still running" run.
    try:
        from api.services.theme_engine import store as theme_engine_store
        theme_engine_store.init_engine_tables()
        _stale = theme_engine_store.abort_stale_runs(3)
        if _stale:
            print(f"[startup] theme-engine: aborted {_stale} stale run(s)")
    except Exception as e:
        print(f"[startup] theme-engine init failed (non-fatal): {e}")

    from api.services.theme_performance import load_persisted_on_startup
    load_persisted_on_startup()

    # ── Warm dashboard caches after a deploy ────────────────────────────────
    # Every Railway deploy spins up a fresh container with an empty in-memory
    # TTLCache, so the FIRST user to hit /dashboard would otherwise pay the
    # full cold-compute cost on every tile at once (news ~3-4s, theme-perf
    # rebuild, snapshot/movers fetches, leadership). This pre-populates those
    # caches in the background so that first post-deploy load is warm. Fully
    # best-effort — any failure is swallowed and the endpoints just compute
    # lazily as before.
    def _warm_dashboard_caches():
        import time as _wt
        _wt.sleep(8)  # let the rest of startup settle first
        from api.services import engine as _eng
        from api.services import theme_performance as _tp
        from api.services import massive as _mv
        warmers = [
            ("snapshot", _mv.get_snapshot),
            ("movers", _mv.get_movers),
            ("news", _eng.get_news),
            ("theme-performance", _tp.get_theme_performance),
            ("leadership", _eng.get_leadership),
            ("breadth", _eng.get_breadth),
            ("earnings", _eng.get_earnings),
        ]
        for name, fn in warmers:
            try:
                fn()
                print(f"[warm] dashboard cache warmed: {name}")
            except Exception as e:
                print(f"[warm] {name} warm failed (non-fatal): {e}")

    threading.Thread(target=_warm_dashboard_caches, daemon=True,
                     name="dashboard-cache-warm").start()

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

    # -- Flow DB: auto-seed from static CSVs if DB is empty ------------------
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
                        print(f"[startup] Flow DB stocks: {_flow_stats['stocks_rows']:,} rows, {_flow_stats['stock_days']} days -- up to date")

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
                        print(f"[startup] Flow DB indexes: {_flow_stats['indexes_rows']:,} rows, {_flow_stats['index_days']} days -- up to date")

            # Auto-prune expired
            _pruned = _flow_db.prune_expired(buffer_days=1)
            if _pruned:
                print(f"[startup] Flow DB pruned {_pruned} expired rows")
        except Exception as e:
            print(f"[startup] Flow DB auto-seed error (non-fatal): {e}")
    threading.Thread(target=_flow_db_seed_background, daemon=True, name="flow-db-seed").start()

    # -- Darkpool DB: auto-seed from static CSV if available ----------------
    def _darkpool_db_seed_background():
        try:
            import hashlib
            from api import darkpool_db
            _stats = darkpool_db.get_stats()
            _public_dir = os.path.join(os.path.dirname(__file__), "..", "app", "public")
            _dp_csv = os.path.join(_public_dir, "Darkpool-data.csv")
            # Persist the last-merged CSV content hash on the /data volume so a
            # plain code deploy (identical CSV) SKIPS the merge entirely and never
            # touches the live table. Content hash — not mtime — because the file
            # is rewritten on every git checkout, so mtime always looks "changed".
            _sig_path = os.path.join(
                os.environ.get("RAILWAY_VOLUME_MOUNT_PATH", "/data"), "darkpool_csv.sha")

            def _csv_sha(path):
                _h = hashlib.sha256()
                with open(path, "rb") as _b:
                    for _chunk in iter(lambda: _b.read(1 << 20), b""):
                        _h.update(_chunk)
                return _h.hexdigest()

            def _read_sig():
                try:
                    with open(_sig_path, "r") as _s:
                        return _s.read().strip()
                except Exception:
                    return None

            if not os.path.exists(_dp_csv):
                print(f"[startup] Darkpool DB: no Darkpool-data.csv found at {_dp_csv}")
            else:
                _sha = _csv_sha(_dp_csv)
                if _stats["total_rows"] > 0 and _sha == _read_sig():
                    # DB already holds this exact CSV — skip so a code deploy can't
                    # re-parse, re-insert, or re-import anything. Only a genuinely
                    # changed CSV (new hash) re-merges; the insert-guard keeps
                    # NULL/<=0-notional junk out on that merge.
                    print(f"[startup] Darkpool DB: {_stats['total_rows']:,} rows, "
                          f"{_stats['trading_days']} days -- CSV unchanged, skip seed")
                else:
                    with open(_dp_csv, "r", encoding="utf-8-sig") as _f:
                        _result = darkpool_db.insert_csv_rows(_f.read())
                    try:
                        with open(_sig_path, "w") as _s:
                            _s.write(_sha)
                    except Exception as _we:
                        print(f"[startup] Darkpool DB: could not write CSV sig: {_we}")
                    _skipped = _result.get("skipped_invalid", 0)
                    print(f"[startup] Darkpool DB seeded/merged: +{_result['inserted']:,} new, "
                          f"{_result['duplicates']:,} dupes, {_skipped:,} skipped-invalid "
                          f"({_result['total']:,} in file)")

            # Auto-prune to 120 trading days (matches darkpool retention policy)
            _pruned = darkpool_db.prune_old_data(keep_days=120)
            if _pruned:
                print(f"[startup] Darkpool DB pruned {_pruned} rows beyond 120-day window")
        except Exception as e:
            print(f"[startup] Darkpool DB auto-seed error (non-fatal): {e}")
    threading.Thread(target=_darkpool_db_seed_background, daemon=True, name="darkpool-db-seed").start()

    # Seed the prebuilt watchlists (Liquid Major ETFs; deletes retired lists like Delisted
    # Legends). Idempotent + self-healing; deferred so the admin user + watchlists table are
    # ready; background so it never blocks boot.
    def _seed_prebuilt_bg():
        try:
            import time as _t
            _t.sleep(25)
            from api.services.watchlist_prebuilt import seed_prebuilt_watchlists
            seed_prebuilt_watchlists()
            # Auto-management catch-up: liquidity re-rank + delisted prune if the durable
            # overlay is missing or stale (monthly cron keeps it fresh thereafter).
            import os as _os_pb
            if _os_pb.environ.get("PREBUILT_REFRESH_ENABLED", "1") != "0":
                from api.services import watchlist_prebuilt_refresh as _pbr
                _pbr.maybe_startup_catchup()
        except Exception:
            pass
    threading.Thread(target=_seed_prebuilt_bg, daemon=True, name="prebuilt-watchlists-seed").start()

    try:
        _cot_service.init_db()
        if _cot_service.is_empty():
            print("[startup] COT table empty -- seeding from CFTC historical archive (background)...")
            threading.Thread(target=_cot_seed_background, daemon=True, name="cot-seed").start()
        else:
            from datetime import date as _date
            now_et = datetime.now(ZoneInfo("America/New_York"))
            latest_iso = _cot_service.get_latest_date()
            expected = _cot_service.expected_latest_report_date(now_et)
            if latest_iso and _date.fromisoformat(latest_iso) < expected:
                days_old = (now_et.date() - _date.fromisoformat(latest_iso)).days
                print(
                    f"[startup] COT data stale -- latest={latest_iso} expected={expected} "
                    f"({days_old}d old) -- running catch-up refresh..."
                )
                threading.Thread(target=_cot_catchup_background, daemon=True, name="cot-catchup").start()
            else:
                print(f"[startup] COT database ready (latest: {latest_iso}).")
    except Exception as e:
        print(f"[startup] COT init error (non-fatal): {e}")

    # -- Implied-move nightly capture + §12 grade snapshot: startup catch-up --
    # Same shape as the COT catch-up above (2026-08-05 incident): a Railway
    # redeploy landing at/after a job's trigger time causes the freshly
    # re-created APScheduler MemoryJobStore to schedule that job's next run
    # for the trigger's NEXT occurrence — tomorrow — silently skipping
    # tonight with nothing in the logs but "Added job". Unlike COT (which can
    # always re-download the same historical data), a missed implied-move
    # capture is UNRECONSTRUCTABLE once the report happens — see
    # implied_store.py's module docstring and its "startup catch-up" section
    # for the full write-up. All local SQLite reads here (`latest_capture_date`
    # / `latest_grade_date`) — only the actual capture/snapshot (network-bound)
    # is deferred to a background thread, exactly like the COT catch-up.
    if os.environ.get("IMPLIED_STORE_ENABLED") == "1":
        try:
            from api.services import implied_store as _implied_store_boot
            from api.services import setup_grade as _setup_grade_boot
            now_et = datetime.now(ZoneInfo("America/New_York"))
            today_iso = now_et.date().isoformat()

            if _implied_store_boot.capture_due_by(now_et):
                latest_capture = _implied_store_boot.latest_capture_date()
                if latest_capture != today_iso:
                    print(
                        f"[startup] implied-move capture stale -- latest={latest_capture} "
                        f"today={today_iso} -- running catch-up capture..."
                    )
                    threading.Thread(target=_implied_capture_catchup_background, daemon=True,
                                      name="implied-capture-catchup").start()
                else:
                    print(f"[startup] implied-move capture already ran today ({today_iso}).")

            if _setup_grade_boot.grade_snapshot_due_by(now_et):
                latest_grade = _implied_store_boot.latest_grade_date(_setup_grade_boot.SURFACE)
                if latest_grade != today_iso:
                    print(
                        f"[startup] setup-grade snapshot stale -- latest={latest_grade} "
                        f"today={today_iso} -- running catch-up snapshot..."
                    )
                    threading.Thread(target=_grade_snapshot_catchup_background, daemon=True,
                                      name="grade-snapshot-catchup").start()
                else:
                    print(f"[startup] setup-grade snapshot already ran today ({today_iso}).")
        except Exception as e:
            print(f"[startup] implied-store catch-up init error (non-fatal): {e}")

    # -- Ratings percentile (Phase 2): startup catch-up if distributions stale --
    # Gated off by default; when enabled, warms the universe percentile DB in the
    # background so /research ratings show true 1-99 ranks. Never blocks boot.
    if os.environ.get("RATINGS_PERCENTILE_ENABLED", "0").lower() in ("1", "true", "yes"):
        try:
            from api.services.research import ratings_universe as _ratings_universe
            _ratings_universe.ratings_db.init_db()
            if _ratings_universe.distributions_stale():
                print("[startup] ratings percentile distributions stale -- running catch-up refresh...")
                threading.Thread(target=_ratings_universe.nightly_job, daemon=True,
                                 name="ratings-percentile-catchup").start()
            else:
                print("[startup] ratings percentile distributions ready.")
        except Exception as e:
            print(f"[startup] ratings percentile init error (non-fatal): {e}")

    from api.services.scheduler_lock import acquire_scheduler_lock
    _scheduler = None
    if acquire_scheduler_lock():
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.cron import CronTrigger
        from apscheduler.triggers.interval import IntervalTrigger
        from api.services.auth_service import cleanup_expired_sessions, cleanup_expired_tokens, record_mrr_snapshot
        _scheduler = BackgroundScheduler(timezone=ZoneInfo("America/New_York"))

        # -- Compass automation master switch ------------------------------
        # Pauses ALL automated (scheduled) Compass + voice LLM interactions
        # to prevent accidental token burn. Manual / on-demand Compass
        # surfaces are UNAFFECTED -- those are always user-initiated:
        #   - Compass chat (text + voice)
        #   - Pre-Trade Verdict + Per-Trade Post-Mortem buttons
        #   - "Generate EOD recap / weekly review now" endpoints
        #   - Manual voice scan / consolidate endpoints
        #   - Rule-based real-time intervention banners (no LLM tokens)
        #
        # Paused 2026-05-18 at user request. Default = OFF, so automation
        # stays paused across Railway redeploys until explicitly resumed.
        # Resume by EITHER:
        #   - setting Railway env var  COMPASS_AUTOMATION_ENABLED=1,  or
        #   - flipping the default below to "1" and redeploying.
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
                    f"[startup] Compass automation PAUSED -- skipping "
                    f"job '{kwargs.get('id', '?')}' "
                    f"(set COMPASS_AUTOMATION_ENABLED=1 to resume)"
                )

        # -- The Floor: UCT Mentor daily heartbeat (weekday ~9:20 AM ET) -------
        # One 'UCT Mentor' system post into #trading-floor each morning so the
        # live room is never a dead room. Self-gates on COMMUNITY_CHAT_ENABLED at
        # run time (no-op while dark) — NOT a Compass LLM job, so registered directly.
        try:
            from api.services import community_heartbeat
            _scheduler.add_job(
                community_heartbeat.post_daily_heartbeat,
                CronTrigger(day_of_week="mon-fri", hour=9, minute=20, timezone=_ET),
                id="floor_daily_heartbeat", replace_existing=True, max_instances=1)
        except Exception as _e_hb:
            print(f"[startup] floor heartbeat job skip: {_e_hb}")

        # UCT Signal auto-posts (flow sweeps + regime flips) → #trading-floor every
        # 30 min during market hours. Self-gates on COMMUNITY_CHAT_ENABLED +
        # COMMUNITY_SIGNALS_ENABLED (owner opt-in), so it's a no-op unless both are set.
        try:
            from api.services import community_signals
            _scheduler.add_job(
                community_signals.run_signal_cycle,
                CronTrigger(day_of_week="mon-fri", hour="9-16", minute="0,30", timezone=_ET),
                id="floor_signal_cycle", replace_existing=True, max_instances=1)
            _scheduler.add_job(
                community_signals.post_premarket_brief,
                CronTrigger(day_of_week="mon-fri", hour=8, minute=45, timezone=_ET),
                id="floor_premarket_brief", replace_existing=True, max_instances=1)
        except Exception as _e_sig:
            print(f"[startup] floor signal job skip: {_e_sig}")

        # -- Prebuilt ETF watchlists: monthly liquidity re-rank + delisted prune ----
        # 'Liquid Major ETFs' is re-ranked from live Massive dollar volume and any ticker
        # that stopped trading is pruned from every list — while the curated theme lists
        # (Sector SPDRs, Commodities, Bonds…) stay hand-authored. Writes a durable /data
        # overlay. Disable with PREBUILT_REFRESH_ENABLED=0. Startup catch-up lives in the
        # _seed_prebuilt_bg thread so it goes live soon after a deploy, not a month later.
        import os as _os_pbr
        if _os_pbr.environ.get("PREBUILT_REFRESH_ENABLED", "1") != "0":
            try:
                from api.services import watchlist_prebuilt_refresh as _pbr_sched
                _scheduler.add_job(
                    _pbr_sched.run_scheduled_refresh,
                    CronTrigger(day=1, hour=6, minute=0, timezone=_ET),
                    id="prebuilt_watchlists_refresh", replace_existing=True, max_instances=1)
            except Exception as _e_pbr:
                print(f"[startup] prebuilt refresh job skip: {_e_pbr}")

        # -- Indicator alerts: the CLOSED-BAR SHADOW LANE (Phase C Task 6) ------
        # ⭐ BOTH LANES RUN, ONE LANE DELIVERS. The live evaluator
        # (`indicator_alert_evaluator.start_evaluator`, its own daemon thread,
        # started far above) is untouched and delivers on whichever lane
        # `eval_mode()` names AT CALL TIME — the CLOSED lane since the 2026-08-08
        # cutover, and the forming lane only if `ALERT_EVAL_MODE` is rolled back.
        # (This said "keeps delivering on the FORMING lane", which was true when
        # it was written and became false at the cutover. Read the running answer
        # from `GET /api/indicator-alerts/latency`, never from this comment.)
        # This job evaluates the SAME alerts on the SAME bars through the
        # closed lane and writes what it WOULD have fired to its own database —
        # no delivery, no record_trigger, no record_evaluation, no ledger, no
        # email. Its worst failure mode is a wasted cycle.
        #
        # ⛔ ITS OWN JOB, NOT A SECOND BRANCH INSIDE `_run_one_cycle`. Two jobs can
        # be disabled independently; a branch cannot — turning the shadow off
        # would mean touching the code path that DELIVERS, which is the one thing
        # a soak must never be able to do. `ALERT_SHADOW_ENABLED=1` is what
        # registers it (default off) AND `run_shadow_cycle` re-checks the same
        # flag, so a manual call from a REPL obeys the switch too.
        #
        # 60s to match the live evaluator's interval, so the two lanes see the
        # same tape at the same cadence and the daily comparison of the shadow log
        # against `indicator_alerts.triggered_at` is like-for-like.
        try:
            if os.environ.get("ALERT_SHADOW_ENABLED", "0") == "1":
                from api.services import alert_shadow_log as _alert_shadow
                _alert_shadow.init_schema()
                _scheduler.add_job(
                    _alert_shadow.run_shadow_cycle,
                    trigger=IntervalTrigger(seconds=60),
                    id="indicator_alert_shadow_cycle", max_instances=1,
                    coalesce=True, replace_existing=True, misfire_grace_time=30)
                print("[startup] indicator alert SHADOW lane scheduled (every 60s, "
                      "writes alert_shadow.db only)")
            else:
                print("[startup] indicator alert shadow lane OFF "
                      "(set ALERT_SHADOW_ENABLED=1 to soak the closed lane)")
        except Exception as _e_shadow:
            print(f"[startup] indicator alert shadow job skip: {_e_shadow}")

        # -- Indicator alerts: THE SILENCE SWEEP (Phase C Task 11) -------------
        # ⭐ AN ALERT THAT IS ON AND SAYS NOTHING IS THE ONE FAILURE A USER
        # CANNOT REPORT. `compute_vwap` RAISES when the IANA tz database is
        # missing (deliberately — a silent UTC fallback is the retired
        # VWAP_SESSION_ANCHOR defect), `_evaluate_one` catches and logs, and
        # `_run_one_cycle` then skips the alert WITHOUT WRITING ANYTHING — so a
        # permanently broken alert and a healthy quiet one look identical on
        # every surface. This sweep gives the broken one a `needs_attention`
        # state carrying the raising exception's own message.
        #
        # ⛔ ITS OWN JOB, NOT A WRITE FROM `list_active()`. The Task 6 shadow
        # lane reads that same function and may not change the observed.
        #
        # NOT flag-gated: it delivers nothing, it writes one column on rows that
        # are already broken, and on a box with no alerts (which is production
        # today) it is a single indexed SELECT returning nothing. 5 minutes so a
        # fault is visible within one coffee, not one session.
        try:
            from api.services import indicator_alert_service as _ias_sweep
            _scheduler.add_job(
                _ias_sweep.sweep_silent_alerts,
                trigger=IntervalTrigger(seconds=300),
                id="indicator_alert_silence_sweep", max_instances=1,
                coalesce=True, replace_existing=True, misfire_grace_time=60)
        except Exception as _e_sweep:
            print(f"[startup] indicator alert silence sweep skip: {_e_sweep}")

        # -- Indicator alerts: THE ARMED SET PULLS ITS OWN BARS ---------------
        # ⭐ MEASURED ON THIS POD, 2026-08-07 09:56 ET, 26 MINUTES AFTER THE OPEN,
        # WITH 31 ALERTS ARMED:
        #
        #     GROUP SPY/5  alerts=31  newest_bar_ET=2026-08-07 09:15  stale=41.1 min
        #
        # Thirty-one live alerts deciding against a PRE-MARKET bar.
        # `_fetch_bars_for_alert` reads `bars_sqlite` directly and therefore
        # inherits NONE of `/api/bars`' freshness logic (`_needs_fresh`,
        # `_is_cold_stale_intraday`, the synchronous first-paint delta). The
        # store is freshened by an on-demand chart view or the worker's R2
        # merge -- and in COMING SOON mode nobody opens a chart. So the alert
        # lane depended on somebody else's chart traffic to have data from this
        # hour, which for an alerts product is the wrong dependency direction.
        #
        # This job turns it around: the ARMED groups pull their own bars,
        # through `bars_fetch`'s own delta functions and `bars_sqlite.put_bars`.
        # No second fetcher, no new SQL, no new staleness rule.
        #
        # ⛔ ON THE BACKGROUNDSCHEDULER, NOT THE EVENT LOOP. This pod is ONE
        # uvicorn process; the 2026-07-01 outage was anyio-threadpool
        # exhaustion. A BackgroundScheduler job costs one of APScheduler's OWN
        # ten worker slots and ZERO anyio slots, and `max_instances=1` means a
        # slow sweep queues behind itself instead of fanning out. The module
        # additionally REFUSES to run if it ever finds a running event loop in
        # the calling thread, so a future wrong call site costs a log line.
        #
        # Bounded by construction: only `list_active()` groups (ONE today),
        # capped at MAX_GROUPS per sweep stalest-first, <=MAX_WORKERS in flight,
        # fetch starts paced >=MIN_GAP apart, whole sweep under DEADLINE_SECONDS.
        # An unpaced sweep once 429'd on its FIRST call, engaged a 20s shared
        # cooldown and then raced through everything empty reporting success --
        # so an empty read here is never written, never counted as a refresh and
        # never stamps the success clock, which is what makes the next sweep
        # retry THROUGH a cooldown instead of past it.
        #
        # 60s to match the evaluator's own interval, so the bars are never more
        # than one cycle behind what the alert lane is about to read.
        # NOT market-hours-gated here on purpose: `_needs_fresh` is already
        # session- and holiday-aware and returns False overnight and at weekends
        # once the last session is covered, so this job self-gates to zero
        # upstream calls off-market. A second calendar would be a second thing
        # to keep in sync with NYSE.
        #
        # Kill switch: ALERT_BARS_REFRESH_ENABLED=0 (default ON -- a flag that
        # defaulted off would not have fixed anything, and setting a Railway
        # variable auto-redeploys).
        try:
            from api.services import alert_bars_freshness as _alert_bars
            _scheduler.add_job(
                _alert_bars.run_scheduled_sweep,
                trigger=IntervalTrigger(seconds=60),
                id="alert_bars_freshness", max_instances=1,
                coalesce=True, replace_existing=True, misfire_grace_time=30)
            print("[startup] alert bars freshness scheduled (every 60s, armed "
                  "groups only)")
        except Exception as _e_abf:
            print(f"[startup] alert bars freshness job skip: {_e_abf}")

        # -- Dark pool: nightly Massive ingest (2026-07-24) --------------------
        # Replaces the manual BBS CSV loop (download -> app/public -> redeploy).
        # 19:20 ET weekdays: after the 19:00 window close, so the full session
        # incl. the closing cross is settled. Runs on WEB because web owns
        # /data/darkpool.db and is the only service serving /api/darkpool/*.
        # Self-gates on DARKPOOL_MASSIVE_INGEST_ENABLED=1 — a deploy alone will
        # not start pulling. Bounded by ticker cap + page cap + wall clock.
        try:
            from api.darkpool_massive_ingest import scheduled_run as _dp_ingest_run
            _scheduler.add_job(
                _dp_ingest_run,
                trigger=CronTrigger(day_of_week="mon-fri", hour=19, minute=20, timezone=_ET),
                id="darkpool_massive_ingest", max_instances=1, replace_existing=True,
                misfire_grace_time=3600)
            print("[startup] darkpool Massive ingest scheduled (weekdays 19:20 ET)")
        except Exception as _e_dpi:
            print(f"[startup] darkpool Massive ingest job skip: {_e_dpi}")

        # -- Dark pool: intraday live-preview poller (2026-07-27) ---------------
        # Near-real-time (~3 min) companion to the nightly ingest above. Polls
        # off-exchange prints INCREMENTALLY during market hours into the
        # EPHEMERAL darkpool_today table (never darkpool_trades — writing there
        # every few minutes would invalidate + rebuild every historical
        # aggregation window; see darkpool_intraday_ingest's docstring), so the
        # Dark Pool page can show "today so far". Self-gates on
        # DARKPOOL_INTRADAY_ENABLED=1. Every 3 min, weekdays, 9-16 ET (the tail
        # hours catch the 16:00 closing-cross prints as they settle).
        try:
            from api.darkpool_intraday_ingest import (
                scheduled_run as _dp_intraday_run,
                roll_session as _dp_roll_session,
            )
            _scheduler.add_job(
                _dp_intraday_run,
                trigger=CronTrigger(day_of_week="mon-fri", hour="9-16",
                                    minute="*/3", timezone=_ET),
                id="darkpool_intraday_ingest", max_instances=1,
                replace_existing=True, misfire_grace_time=120)
            # Roll the preview after the close (well after the 19:20 nightly folds
            # the authoritative session into darkpool_trades) so the live strip
            # doesn't linger overnight. Harmless no-op when the table is empty.
            _scheduler.add_job(
                _dp_roll_session,
                trigger=CronTrigger(day_of_week="mon-fri", hour=20, minute=30,
                                    timezone=_ET),
                id="darkpool_intraday_roll", max_instances=1,
                replace_existing=True, misfire_grace_time=3600)
            print("[startup] darkpool intraday poller scheduled (weekdays every 3m, 9-16 ET)")
        except Exception as _e_dpint:
            print(f"[startup] darkpool intraday poller job skip: {_e_dpint}")

        # -- Dark pool: EOD / EOW summary card to Discord (2026-08-09) ----------
        # By-market-cap dark-pool summary, styled like the Top Flow options card.
        # EOD weekdays 20:10 ET — a safe margin AFTER the 19:20 nightly ingest has
        # folded the authoritative session into darkpool_trades (which the card
        # reads via get_aggregated). EOW additionally on Friday (the week view).
        # SELF-GATED: run_eod_summary is a no-op unless DARKPOOL_EOD_ENABLED=1, so
        # registering these is dark — they build + post nothing until armed. Posts
        # to the same Discord channel as the options EOD (see darkpool_eod._webhook).
        try:
            import functools as _functools
            from api.darkpool_eod import run_eod_summary as _dp_eod
            _scheduler.add_job(
                _dp_eod,   # defaults: force=False, post=True, weekly=False
                trigger=CronTrigger(day_of_week="mon-fri", hour=20, minute=10, timezone=_ET),
                id="darkpool_eod", max_instances=1, replace_existing=True,
                misfire_grace_time=3600)
            _scheduler.add_job(
                _functools.partial(_dp_eod, weekly=True),
                trigger=CronTrigger(day_of_week="fri", hour=20, minute=15, timezone=_ET),
                id="darkpool_eow", max_instances=1, replace_existing=True,
                misfire_grace_time=3600)
            print("[startup] darkpool EOD/EOW summary scheduled (EOD 20:10 ET weekdays, "
                  "EOW 20:15 ET Fri) — dark until DARKPOOL_EOD_ENABLED=1")
        except Exception as _e_dpeod:
            print(f"[startup] darkpool EOD summary job skip: {_e_dpeod}")

        # -- Dark pool: nightly-ingest startup catch-up (2026-07-27) ------------
        # APScheduler here has no jobstore, so a 19:20 ET run missed because the
        # pod was mid-redeploy (or down) at fire time is LOST — misfire_grace only
        # covers an in-process pause, not a restart. If we boot after 19:20 ET on
        # a weekday and today's session isn't in darkpool_trades yet, fire the
        # ingest once (re-runs are dedup-safe). Same flag as the cron job.
        def _dp_nightly_catchup():
            try:
                time.sleep(90)  # let the DB seed + scheduler settle first
                if os.environ.get("DARKPOOL_MASSIVE_INGEST_ENABLED", "0") != "1":
                    return
                now_et = datetime.now(_ET)
                if now_et.weekday() > 4:                 # Sat/Sun — no session
                    return
                if (now_et.hour, now_et.minute) < (19, 20):
                    return
                from api import darkpool_db
                today = f"{now_et.month}/{now_et.day}/{now_et.year}"
                if today in set(darkpool_db.get_available_dates()):
                    return
                from api.darkpool_massive_ingest import run_ingest_background
                print(f"[startup] darkpool nightly catch-up firing for {today} "
                      "(missed the 19:20 run)")
                run_ingest_background()
            except Exception as _e_cu:
                print(f"[startup] darkpool nightly catch-up skip: {_e_cu}")
        threading.Thread(target=_dp_nightly_catchup, daemon=True,
                         name="darkpool-nightly-catchup").start()

        # -- Nightly T+1 side-heal (2026-07-25) --------------------------------
        # After the close (and after the 19:20 darkpool ingest), re-side the
        # day's blank prints at EXACT-ns via REST /v3/quotes, reading ts_ns
        # straight from flow.db. Writes flow.db, so it MUST run on the service
        # that owns it (flow-worker) — self-gates on MASSIVE_NIGHTLY_HEAL_ENABLED
        # (set =1 on flow-worker ONLY; on any other service scheduled_run()
        # returns before touching FlowDB). Automated replacement for the manual
        # Colab t1_side_heal script.
        try:
            from api.nightly_side_heal import scheduled_run as _nightly_heal_run
            _scheduler.add_job(
                _nightly_heal_run,
                trigger=CronTrigger(day_of_week="mon-fri", hour=19, minute=30, timezone=_ET),
                id="nightly_side_heal", max_instances=1, replace_existing=True,
                misfire_grace_time=3600)
            print("[startup] nightly side-heal scheduled (weekdays 19:30 ET)")
        except Exception as _e_nsh:
            print(f"[startup] nightly side-heal job skip: {_e_nsh}")

        # 🔴 THE SCHEDULE ITS DOCSTRING ALREADY CLAIMED.
        # `ipo_maintenance.run_ipo_maintenance` says *"Runs on a schedule
        # (weekly)"* and was in NO scheduler with ZERO callers — reachability
        # audit §3e, and a verbatim repeat of the session-insights precedent
        # (defined, never wired, work silently uncollected for weeks). Only the
        # module's `IPO_DATES` constant was ever consumed.
        # ⛔ Sunday, deliberately clear of the 08:00 ET Compass weekly digest.
        # The job is a taxonomy READ plus an operator ping; it mutates nothing
        # (the removal it asks for is a manual edit to the owner's
        # `themes_taxonomy.json` baseline) and it is inert without
        # DISCORD_WEBHOOK_URL. Rail: tests/test_ipo_maintenance_scheduled.py.
        def _ipo_maintenance_job():
            try:
                from api.services import ipo_maintenance as _ipo
                _ipo.run_ipo_maintenance()
            except Exception as _e_ipo:
                print(f"[ipo] weekly maintenance failed (non-fatal): {_e_ipo}")

        _scheduler.add_job(
            _ipo_maintenance_job,
            trigger=CronTrigger(day_of_week="sun", hour=8, minute=30, timezone=_ET),
            id="ipo_maintenance_weekly", max_instances=1, replace_existing=True)

        _scheduler.add_job(_cot_service.refresh_from_current, trigger=CronTrigger(day_of_week="fri", hour=15, minute=50, timezone=_ET), id="cot_weekly_refresh", max_instances=1, replace_existing=True)
        _scheduler.add_job(_cot_service.refresh_if_stale, trigger=CronTrigger(day_of_week="fri", hour=16, minute=15, timezone=_ET), id="cot_weekly_retry_1", max_instances=1, replace_existing=True)
        _scheduler.add_job(_cot_service.refresh_if_stale, trigger=CronTrigger(day_of_week="fri", hour=16, minute=45, timezone=_ET), id="cot_weekly_retry_2", max_instances=1, replace_existing=True)

        # Implied-move nightly capture (post-close, pre-report snapshot for the
        # history hero). Gated -- ONLY the scheduler job; the read endpoint is
        # always mounted. 16:35 ET = post options settle (~16:15), pre any
        # evening maintenance; weekday-only; a holiday yields zero reporters
        # -> natural no-op. Trigger hour/minute reference implied_store's own
        # constants (not hardcoded here a second time) so the startup
        # catch-up block above can never drift out of sync with this cron.
        # misfire_grace_time=3600: confirmed against the installed
        # apscheduler (3.11.2) that this genuinely matters here -- the
        # scheduler's job_defaults default misfire_grace_time to 1 SECOND
        # (schedulers/base.py `_configure`), and executors/base.py skips
        # (EVENT_JOB_MISSED, job.func never called) any due run whose trigger
        # time is more than misfire_grace_time behind "now" when the
        # scheduler's check loop gets to it -- a live process whose check
        # loop is delayed by more than a second (GIL/thread contention) would
        # otherwise silently drop the run. This does NOT cover the restart
        # case above (a fresh MemoryJobStore never has a past-due
        # next_run_time to begin with -- see the startup catch-up docstring
        # in implied_store.py) -- it only widens the grace window for an
        # already-running process.
        if os.environ.get("IMPLIED_STORE_ENABLED") == "1":
            from api.services import implied_store as _implied_store
            _scheduler.add_job(
                _implied_store.run_nightly_capture,
                trigger=CronTrigger(hour=_implied_store.CAPTURE_HOUR_ET,
                                     minute=_implied_store.CAPTURE_MINUTE_ET,
                                     day_of_week="mon-fri", timezone=_ET),
                id="implied_move_nightly", max_instances=1, coalesce=True, replace_existing=True,
                misfire_grace_time=3600,
            )

            # §12 accountability record: one persisted Setup Grade per upcoming
            # reporter per day. 16:40 ET = 5 min after the implied capture, so
            # the grade is scored against that evening's freshly-stored implied.
            # SAME flag as the capture on purpose — they write the same store in
            # the same nightly window; a second flag would let the accountability
            # record silently diverge from the data it grades.
            from api.services import setup_grade as _setup_grade
            _scheduler.add_job(
                _setup_grade.run_daily_grade_snapshot,
                trigger=CronTrigger(hour=_setup_grade.GRADE_SNAPSHOT_HOUR_ET,
                                     minute=_setup_grade.GRADE_SNAPSHOT_MINUTE_ET,
                                     day_of_week="mon-fri", timezone=_ET),
                id="setup_grade_daily", max_instances=1, coalesce=True, replace_existing=True,
                misfire_grace_time=3600,
            )

            # Historical backfill sweep — 17:00 ET, AFTER the close and AFTER
            # both jobs above. Reconstructs the pre-earnings straddle for past
            # quarters so the RICH/CHEAP verdict has paired history to compare
            # against, instead of waiting a year for nightly capture to build it.
            #
            # SAME flag, for the same reason setup_grade shares it: all three
            # write the same store in the same nightly window, and a separate
            # flag would let this silently diverge from the data it extends.
            #
            # 17:00 rather than alongside them because they contend for ONE
            # process-wide Finnhub budget that is also shared with live member
            # traffic. Run at the open, this sweep managed 1 row per 20 seconds
            # and spent its time in rate-limit cooldowns; the capture has a
            # deadline and this does not, so this yields.
            #
            # Incremental by construction (`_has_snapshot` skips what it already
            # captured) and wall-clock bounded, so an interrupted night simply
            # continues the next one — no babysitting, no manual relaunch.
            from api.services import implied_backfill as _implied_backfill
            _scheduler.add_job(
                _implied_backfill.run_backfill_sweep,
                trigger=CronTrigger(hour=_implied_backfill.SWEEP_HOUR_ET,
                                     minute=_implied_backfill.SWEEP_MINUTE_ET,
                                     day_of_week="mon-fri", timezone=_ET),
                id="implied_backfill_sweep", max_instances=1, coalesce=True,
                replace_existing=True, misfire_grace_time=3600,
            )

        # Ticker-type sync (2026-07-09) — keep the Massive ETF/stock reference
        # (ticker_types table) fresh so the flow write path classifies new ETFs
        # correctly (fixed SPCX/DRAM-class mislabels + auto-picks-up new launches
        # so a hardcoded list never goes stale again). 5:30 AM ET: before the
        # pre-market tape, outside the deploy blackout. Fail-soft + gated.
        if os.environ.get("TICKER_TYPES_SYNC_ENABLED", "1") == "1":
            def _ticker_types_sync():
                try:
                    from api import ticker_types
                    ticker_types.sync_from_massive("stocks")
                    ticker_types.sync_from_massive("indices")
                    ticker_types.refresh_class_sets()
                except Exception as _e:
                    logging.getLogger(__name__).warning("[ticker_types] daily sync failed: %s", _e)
            _scheduler.add_job(_ticker_types_sync, trigger=CronTrigger(hour=5, minute=30, timezone=_ET),
                               id="ticker_types_daily_sync", max_instances=1, replace_existing=True)

        # Breadth live -- rebuild the day's reference levels BEFORE the open.
        #
        # Levels are cached per session day, keyed on the last completed
        # session. The boot warm covers a deploy, but the pod does not reboot
        # overnight, so at 09:30 the key rolls to yesterday's date and the cache
        # misses. Deriving levels reads ~1M daily bars -- seconds of blocking
        # SQLite and numpy -- and without this the FIRST person to open Breadth
        # after the bell pays it, at the busiest moment of the day. The
        # herd-collapse lock means the rest queue behind them rather than each
        # paying it, which is better and still not good.
        #
        # 09:05 ET: after the prior session is settled in bars.db, comfortably
        # before the open. Mirrors the RS-rankings warmer, which re-warms under
        # its own TTL for the same reason.
        try:
            def _breadth_live_daily_warm():
                try:
                    from api.services.breadth_live import warm
                    logging.getLogger(__name__).info(
                        "[breadth-live] pre-open warm %s", warm())
                except Exception as _e:
                    logging.getLogger(__name__).warning(
                        "[breadth-live] pre-open warm failed: %s", _e)

            _scheduler.add_job(
                _breadth_live_daily_warm,
                trigger=CronTrigger(day_of_week="mon-fri", hour=9, minute=5, timezone=_ET),
                id="breadth_live_preopen_warm", max_instances=1, replace_existing=True)
            logging.getLogger(__name__).info(
                "[startup] breadth-live pre-open warm scheduled (weekdays 9:05 ET)")
        except Exception:
            logging.getLogger(__name__).exception(
                "[startup] failed to schedule breadth-live pre-open warm")

        # Dividend basis for the breadth levels. The sweep is ~9 minutes of
        # paged vendor calls, so it runs well before the 09:05 level warm that
        # consumes it — a level built from a half-swept store under-adjusts the
        # oldest part of every 52-week window rather than failing.
        #
        # 04:40 ET daily (not weekdays-only): ex-dates are assigned on calendar
        # days, and a Monday level frame reaches back through the weekend.
        try:
            def _breadth_dividends_refresh():
                try:
                    from api.services import breadth_dividends as bdiv
                    h = bdiv.refresh()
                    log = logging.getLogger(__name__)
                    log.info("[breadth-live] dividend sweep rows=%s tickers=%s truncated=%s",
                             h.get("rows"), h.get("tickers"), h.get("truncated"))
                    if h.get("truncated"):
                        log.warning("[breadth-live] dividend sweep TRUNCATED — levels "
                                    "will under-adjust older windows")
                except Exception as _e:
                    logging.getLogger(__name__).warning(
                        "[breadth-live] dividend sweep failed: %s", _e)

            _scheduler.add_job(
                _breadth_dividends_refresh,
                trigger=CronTrigger(hour=4, minute=40, timezone=_ET),
                id="breadth_dividends_refresh", max_instances=1, replace_existing=True)
            logging.getLogger(__name__).info(
                "[startup] breadth dividend sweep scheduled (daily 4:40 ET)")
        except Exception:
            logging.getLogger(__name__).exception(
                "[startup] failed to schedule breadth dividend sweep")

        # Breadth live -- sample the session's shape on a CLOCK, not on traffic.
        #
        # The intraday store only recorded when someone called the endpoint, so
        # the session path was a record of who happened to be looking rather
        # than of the market. Observed on the first live session: six points in
        # an hour, with a 47-minute hole spanning the stretch nobody opened the
        # page. Post-launch traffic would have hidden this without fixing it —
        # a quiet twenty minutes still leaves a gap, and the whole point of the
        # path is that it is continuous.
        #
        # compute_live() is cached ~55s and record() enforces its own minimum
        # interval, so a per-minute tick costs exactly one real computation a
        # minute (~0.6s) and is idempotent against any user traffic that also
        # arrives. Confined to regular hours: outside them the read is
        # correctly withheld and the call is a no-op.
        try:
            def _breadth_live_sample():
                try:
                    from api.routers.breadth_monitor import get_breadth_live
                    get_breadth_live()
                except Exception as _e:
                    logging.getLogger(__name__).debug(
                        "[breadth-live] sample tick skipped: %s", _e)

            _scheduler.add_job(
                _breadth_live_sample,
                trigger=CronTrigger(day_of_week="mon-fri", hour="9-16", minute="*",
                                    timezone=_ET),
                id="breadth_live_intraday_sample", max_instances=1,
                coalesce=True, misfire_grace_time=30, replace_existing=True)
            logging.getLogger(__name__).info(
                "[startup] breadth-live intraday sampler scheduled (weekdays 9-16 ET, 1/min)")
        except Exception:
            logging.getLogger(__name__).exception(
                "[startup] failed to schedule breadth-live intraday sampler")

        # Broker Sync -- background incremental sync across all connected users.
        # Gated by BROKER_SYNC_ENABLED (default OFF -> fully inert). Runs on the
        # web pod (auth.db is web-local). Bounded async concurrency inside the
        # job keeps it light on the 512MB pod.
        if os.getenv("BROKER_SYNC_ENABLED") == "1":
            from api.services.journal_two.broker import sync as _broker_sync_engine
            # Scheduler TICK (how often we check for due accounts) — the
            # actual per-account cadence lives in sync._default_interval_min
            # (default: once per account per 24h, SnapTrade polling-cap
            # compliance; BROKER_SYNC_MODE=legacy restores 20-min syncs).
            # jitter: both this interval and the hourly patterns scan are
            # boot-anchored; without jitter ticks align ("locked" 7/13-15).
            _bs_tick = int(os.getenv("BROKER_SYNC_TICK_MIN", "20"))
            _scheduler.add_job(
                _broker_sync_engine.run_due_sync_blocking,
                trigger=IntervalTrigger(minutes=_bs_tick, jitter=120),
                id="broker_sync_due", max_instances=1, replace_existing=True,
            )
            # Recent Orders poll — free real-time trade capture (SnapTrade's
            # documented alternative to paid TRADE_DETECTION): every 5 min
            # per account during market hours, executed equity fills become
            # provisional journal trades within minutes. Self-gates on
            # market window + BROKER_RECENT_ORDERS_ENABLED.
            from api.services.journal_two.broker import recent_orders as _broker_recent
            _scheduler.add_job(
                _broker_recent.run_poll_blocking,
                trigger=IntervalTrigger(minutes=5, jitter=20),
                id="broker_recent_orders_poll", max_instances=1, replace_existing=True,
            )
            # Nightly full reconcile (corrections/voids outside the window).
            _scheduler.add_job(
                _broker_sync_engine.run_nightly_reconcile_blocking,
                trigger=CronTrigger(hour=2, minute=30, timezone=_ET),
                id="broker_sync_nightly_reconcile", max_instances=1, replace_existing=True,
            )
            # Import warming — short full re-syncs after a connect until
            # SnapTrade's async backfill settles. Self-limiting (clears on 2
            # stable ticks or a 2h window) + cheap no-op when nobody's warming.
            _bs_warm_interval = int(os.getenv("BROKER_WARMING_INTERVAL_MIN", "3"))
            _scheduler.add_job(
                _broker_sync_engine.run_warming_sync_blocking,
                trigger=IntervalTrigger(minutes=_bs_warm_interval),
                id="broker_sync_warming", max_instances=1, replace_existing=True,
            )
            # Fleet monitor — hourly sweep for stuck member connections
            # (stranded connect / stale sync / still-broken / SnapTrade
            # heartbeat) → owner Discord digest. Cron :37 keeps it OFF the
            # boot-anchored interval jobs (auth.db contention hygiene).
            from api.services.journal_two.broker import fleet_monitor as _broker_fleet
            _scheduler.add_job(
                _broker_fleet.run_fleet_check_blocking,
                trigger=CronTrigger(minute=37, timezone=_ET),
                id="broker_fleet_monitor", max_instances=1, replace_existing=True,
            )
            # Synthetic canary — nightly end-to-end pipeline proof on the
            # robot user's test-brokerage connection. No-op until
            # BROKER_CANARY_USER_ID is set.
            _scheduler.add_job(
                _broker_fleet.run_canary_sync_blocking,
                trigger=CronTrigger(hour=3, minute=10, timezone=_ET),
                id="broker_canary_sync", max_instances=1, replace_existing=True,
            )
            # Fidelity audit — nightly reconciliation of every synced account
            # against the broker's OWN reported numbers (equity, position
            # quantities, unknown activity types) → Discord on divergence.
            # 3:40am ET: after the 2:30 nightly reconcile + 3:10 canary.
            from api.services.journal_two.broker import fidelity_audit as _broker_fidelity
            _scheduler.add_job(
                _broker_fidelity.run_fidelity_audits_blocking,
                trigger=CronTrigger(hour=3, minute=40, timezone=_ET),
                id="broker_fidelity_audit", max_instances=1, replace_existing=True,
            )
            print(f"[startup] Broker sync scheduler ON (tick {_bs_tick}m, per-account cadence "
                  f"{_broker_sync_engine._default_interval_min()}m; recent-orders poll 5m mkt-hours; "
                  "nightly reconcile 2:30am ET; fleet monitor :37 hourly)")

        def _cot_daily_catchup():
            try:
                from datetime import date as _dt
                from zoneinfo import ZoneInfo as _ZI
                latest = _cot_service.get_latest_date()
                if latest:
                    import datetime as _dtm
                    days_old = (_dtm.datetime.now(_ZI("America/New_York")).date() - _dt.fromisoformat(latest)).days
                    if days_old >= 8:
                        print(f"[scheduler] COT daily catchup: data is {days_old}d stale -- refreshing...")
                        _cot_service.refresh_from_current()
                    else:
                        print(f"[scheduler] COT daily catchup: data is {days_old}d old -- fresh, skipping")
            except Exception as e:
                print(f"[scheduler] COT daily catchup error: {e}")

        _scheduler.add_job(_cot_daily_catchup, trigger=CronTrigger(hour=18, minute=0, timezone=_ET), id="cot_daily_catchup", max_instances=1, replace_existing=True)
        _scheduler.add_job(cleanup_expired_sessions, trigger=CronTrigger(hour=3, minute=0, timezone=_ET), id="session_cleanup", max_instances=1, replace_existing=True)

        # -- Ticker logo miss-retry (2026-08-05 cache-poison sweep) ----------
        try:
            register_logo_miss_retry_job(_scheduler)
            print("[startup] logo miss-retry scheduled (daily 3:25am ET)")
        except Exception as e:
            print(f"[scheduler] logo miss-retry registration error: {e}")

        # -- auth.db continuous backup to R2 (DARK, env-gated) ----------------
        # auth.db is the crown-jewel DB and web-local (single web pod volume).
        # Ships a gzipped SQLite-BACKUP-API snapshot to R2 on the shared
        # data-sync rail. DARK: AUTHDB_BACKUP_ENABLED=1 to arm (owner flips it).
        # BackgroundScheduler runs the job on a worker THREAD (off the event
        # loop) and authdb_backup.run_backup is wholly exception-contained.
        if os.getenv("AUTHDB_BACKUP_ENABLED") == "1":
            from api.services import authdb_backup as _authdb_backup
            _scheduler.add_job(
                _authdb_backup.run_backup,
                trigger=IntervalTrigger(hours=6),
                id="authdb_backup_6h", max_instances=1, replace_existing=True,
            )
            _scheduler.add_job(
                _authdb_backup.run_backup,
                trigger=CronTrigger(hour=2, minute=55, timezone=_ET),
                id="authdb_backup_nightly", max_instances=1, replace_existing=True,
            )
            print("[startup] auth.db R2 backup scheduler ON (every 6h + daily 2:55am ET)")

        # -- Full-market screener nightly snapshot build (spec 2026-06-19) --
        try:
            register_screener_jobs(_scheduler)
            if register_call_recap_warm_jobs(_scheduler):
                logging.getLogger(__name__).info(
                    "[startup] call-recap warm sweeps: 07:30/12:30/17:15/21:30 ET")
            if register_transcript_keyword_jobs(_scheduler):
                logging.getLogger(__name__).info("[startup] transcript keyword alerts: 18:30 ET weekdays")
            if register_transcript_index_jobs(_scheduler):
                logging.getLogger(__name__).info(
                    "[startup] transcript search index: 06:45/20:45 ET + boot")
            register_wire_watchdog_job(_scheduler)
        except Exception as e:
            print(f"[scheduler] screener job registration error: {e}")

        # -- Nightly closed-bar Signature sweep (Phase A) -------------------
        try:
            register_signature_sweep_job(_scheduler)
            print("[startup] signature sweep scheduled (weekdays 20:05 ET)")
        except Exception as e:
            print(f"[scheduler] signature sweep registration error: {e}")

        # -- Nightly split back-adjustment sweep (`61f3b33b`) ----------------
        # ⛔ THE HALF THAT WAS MISSING. The repair shipped with a serve-path
        # hand-off and a manual tool and NO schedule, so nothing healed the
        # tickers nobody charts. The hour is derived from the session anchor,
        # never typed -- see `_SPLIT_SWEEP_LEAD_BEFORE_OPEN`.
        try:
            if register_bars_split_repair_sweep(_scheduler):
                _sj = _scheduler.get_job("bars_split_repair_sweep")
                print(f"[startup] bars split-repair sweep scheduled ({_sj.trigger} ET, "
                      f"{_SPLIT_SWEEP_MAX_TICKERS} tickers/run)")
            else:
                print("[startup] bars split-repair sweep OFF "
                      "(BARS_SPLIT_REPAIR_ENABLED=0)")
        except Exception as e:
            print(f"[scheduler] bars split-repair sweep registration error: {e}")

        # -- Opus-vision pattern judge (spec 2026-06-19) -------------------
        try:
            if register_pattern_vision_jobs(_scheduler):
                import os as _os
                print(
                    "[startup] pattern-vision: on model=claude-opus-4-8 "
                    f"cost_hard_cap=${_os.environ.get('PATTERN_VISION_COST_HARD_CAP', '10.0')} "
                    f"max_per_run={_os.environ.get('PATTERN_VISION_MAX_PER_RUN', '150')} "
                    "active_set_only=on skip_if_stable=on confirmed_only=on"
                )
        except Exception as e:
            print(f"[scheduler] pattern_vision job registration error: {e}")

        # -- Twitter News Ingestion (spec 2026-05-25) ----------------------
        # Burst windows (every 2 min) cover the high-value pre-market and
        # post-close trading hours; regular cadence handles mid-day; slow
        # hourly job is a safety net (since_id makes overlap free).
        if os.environ.get("TWITTERAPI_IO_ENABLED", "").lower() in ("1", "true", "yes"):
            from api.services.tweet_poller import poll_all_accounts as _tw_poll
            from api.services.tweet_cleanup import run_cleanup as _tw_cleanup

            _scheduler.add_job(_tw_poll, trigger=CronTrigger(day_of_week="mon-fri", hour="4-9", minute="*/2", timezone=_ET),
                               id="tweet_poll_burst_premarket", max_instances=1, replace_existing=True)
            _scheduler.add_job(_tw_poll, trigger=CronTrigger(day_of_week="mon-fri", hour="9", minute="30-58/2", timezone=_ET),
                               id="tweet_poll_burst_open", max_instances=1, replace_existing=True)
            _scheduler.add_job(_tw_poll, trigger=CronTrigger(day_of_week="mon-fri", hour="15", minute="30-58/2", timezone=_ET),
                               id="tweet_poll_burst_close", max_instances=1, replace_existing=True)
            _scheduler.add_job(_tw_poll, trigger=CronTrigger(day_of_week="mon-fri", hour="16-19", minute="*/2", timezone=_ET),
                               id="tweet_poll_burst_amc", max_instances=1, replace_existing=True)
            _scheduler.add_job(_tw_poll, trigger=CronTrigger(day_of_week="mon-fri", hour="10-15", minute="*/15", timezone=_ET),
                               id="tweet_poll_regular_midday", max_instances=1, replace_existing=True)
            # Slow safety-net -- overlap with burst is intentional; since_id
            # makes duplicate fetches free.
            _scheduler.add_job(_tw_poll, trigger=CronTrigger(minute="0", timezone=_ET),
                               id="tweet_poll_slow", max_instances=1, replace_existing=True)
            _scheduler.add_job(_tw_cleanup, trigger=CronTrigger(hour=3, minute=0, timezone=_ET),
                               id="tweet_cleanup_daily", max_instances=1, replace_existing=True)
            print("[scheduler] tweet poll jobs registered")

        # -- The Desk -> Substack articles poller -------------------------------
        # Pulls each configured Substack RSS feed hourly. Free (no API cost), so
        # gated ON by default; set SUBSTACK_ENABLED=0 to disable.
        if os.environ.get("SUBSTACK_ENABLED", "1").lower() in ("1", "true", "yes"):
            from api.services.substack_poller import poll_all as _substack_poll
            _scheduler.add_job(_substack_poll, trigger=CronTrigger(minute="7", timezone=_ET),
                               id="substack_poll_hourly", max_instances=1, replace_existing=True)
            # Sunday-afternoon burst: posts usually drop ~2 PM ET on Sundays, so
            # poll every 10 min 1-5 PM ET that day -> a fresh article lands within
            # minutes (the hourly job above stays the off-schedule safety net).
            _scheduler.add_job(_substack_poll,
                               trigger=CronTrigger(day_of_week="sun", hour="13-17", minute="*/10", timezone=_ET),
                               id="substack_poll_sunday_burst", max_instances=1, replace_existing=True)
            print("[scheduler] substack poll job registered (hourly + Sunday burst)")

        # -- The Desk: Daily Sessions auto-publish (v2: Zoom cloud record) --
        _desk_sessions_on = os.environ.get("DESK_DAILY_SESSION_ENABLED", "0") == "1"
        if _desk_sessions_on:
            from api.services import desk_daily_session as _dds
            from api.services import desk_session_jobs as _dsj
            try:
                _dsj._init_db()
            except Exception as e:
                print(f"[desk-sessions] jobs db init error: {e}")

            def _dds_process():
                try:
                    out = _dds.process_pending_jobs()
                    if out:
                        print(f"[desk-sessions] published {len(out)} session(s)")
                except Exception as e:
                    print(f"[desk-sessions] process error (non-fatal): {e}")

            def _dds_safety():
                try:
                    _dds.check_missing_session_alert()
                except Exception as e:
                    print(f"[desk-sessions] safety-net error (non-fatal): {e}")

            def _dds_insights():
                try:
                    from api.services import desk_session_insights as _dsi
                    out = _dsi.process_pending_session_insights()
                    if out:
                        print(f"[desk-sessions] insights pass handled {len(out)} video(s)")
                except Exception as e:
                    print(f"[desk-sessions] insights error (non-fatal): {e}")

            # Drain the recording queue every 5 min (a recording usually finishes
            # processing on Zoom's side a few minutes after the webinar ends).
            _scheduler.add_job(_dds_process, trigger=CronTrigger(minute="*/5", timezone=_ET),
                id="desk_daily_session_process", max_instances=1, replace_existing=True)
            _scheduler.add_job(_dds_safety,
                trigger=CronTrigger(day_of_week="mon-fri", hour=18, minute=0, timezone=_ET),
                id="desk_daily_session_safety", max_instances=1, replace_existing=True)
            # Chapters/transcript + deferred Zoom-trash backfill (self-gated by
            # DESK_SESSION_CHAPTERS_ENABLED). Offset from the */5 drain so a fresh
            # publish gets its transcript pass a couple of minutes later.
            _scheduler.add_job(_dds_insights, trigger=CronTrigger(minute="7/15", timezone=_ET),
                id="desk_session_insights", max_instances=1, replace_existing=True)
            print("[startup] Desk Daily Sessions auto-publish ENABLED (v2 cloud-record)")

        # -- Morning Catalyst Engine (spec 2026-05-25) ---------------------
        # Schedule v5 2026-07-02 (user-defined hunt anchors): the expensive
        # Hunter fires when traders actually check the board.
        #   - 6:00-7:30 AM ET every 30 min -- feed-only warm-up (no hunt)
        #   - 8:00 / 8:30 / 8:45 AM ET -- PRIMARY hunts (deep at 8:00)
        #   - 9:00 / 9:10 / 9:20 / 9:30 ET -- feed refreshes into the open
        #   - 4:00-4:30 PM ET every 5 min -- AMC burst (hunts 4:00 + 4:30 only)
        # Everything outside these windows is manual-only via the tile button.
        # Scheduler timezone is America/New_York (set at BackgroundScheduler init).
        # -- Ratings percentile nightly gather (Phase 2) -----------------------
        # 2:30 AM ET daily -- off-market, low load. Incremental + capped so each
        # run refreshes a bounded slice of cap_universe; distributions rebuild
        # every run. Gated off by default (RATINGS_PERCENTILE_ENABLED).
        if os.environ.get("RATINGS_PERCENTILE_ENABLED", "0").lower() in ("1", "true", "yes"):
            from api.services.research.ratings_universe import nightly_job as _ratings_pct_nightly
            _scheduler.add_job(_ratings_pct_nightly,
                trigger=CronTrigger(hour=2, minute=30, timezone=_ET),
                id="ratings_percentile_nightly", max_instances=1, replace_existing=True)

        # -- Earnings preview warm ------------------------------------------------
        # Pre-generate the AI preview for the week's biggest reporters (top-N by
        # market cap, current + next week) so the modal is instant on click.
        # Generate-ONCE (disk-persisted, survives redeploys) + BOUNDED → cheap:
        # a run after the first skips every already-warm name with zero token
        # spend. Weekday cadence catches new names + report-date shifts. The boot
        # warm (_start_dashboard_warm_background) covers the post-deploy first run.
        if os.environ.get("EARNINGS_WARM_ENABLED", "1").lower() in ("1", "true", "yes"):
            from api.services.earnings_preview_warm import (
                warm_week_previews as _earn_warm,
                warm_reported_analyses as _earn_analysis_warm,
            )
            # Pending previews: pre-market + through the day (new names + report-
            # date shifts). Skip-if-stable makes repeat runs near-free.
            _scheduler.add_job(_earn_warm,
                trigger=CronTrigger(day_of_week="mon-fri", hour="6,10,14,18", minute=20, timezone=_ET),
                id="earnings_preview_warm", max_instances=1, replace_existing=True)
            # Reported analyses: after the close, when AMC names print — so the
            # post-earnings read is instant, not a cold 24s wait for the first viewer.
            _scheduler.add_job(_earn_analysis_warm,
                trigger=CronTrigger(day_of_week="mon-fri", hour="16,17,20", minute=35, timezone=_ET),
                id="earnings_analysis_warm", max_instances=1, replace_existing=True)

        # -- Earnings wire detector (Phase 1) -------------------------------
        # Ships DARK. Polls one full-market snapshot per tick inside the print
        # windows and upserts detected prints; GET /api/calendar/wire only reads
        # the table. max_instances=1 so a slow tick can never stack on the next.
        if _wire_enabled():
            from api.services.wire import store as _wire_store
            _wire_store._init_db()

            def _wire_tick_job():
                try:
                    from api.services.wire.detector import run_wire_tick
                    run_wire_tick()
                except Exception as _e:
                    print(f"[scheduler] wire detector error: {_e}")

            # 20s cadence inside the two print windows (BMO 6-9 ET, AMC 16 ET).
            _scheduler.add_job(
                _wire_tick_job,
                trigger=CronTrigger(day_of_week="mon-fri", hour="6-9,16",
                                    second="*/20", timezone=_ET),
                id="wire_detector", max_instances=1, replace_existing=True)
            # Hourly safety net so a print outside the windows still lands.
            _scheduler.add_job(
                _wire_tick_job,
                trigger=CronTrigger(day_of_week="mon-fri", minute=5, timezone=_ET),
                id="wire_detector_slow", max_instances=1, replace_existing=True)
            print("[scheduler] earnings wire detector registered (20s in print windows)")

        if os.environ.get("CATALYST_ENGINE_ENABLED", "").lower() in ("1", "true", "yes"):
            from api.services.catalyst.engine import run_refresh as _cat_refresh

            # Hunter cost gating (2026-07-02): the Opus+web-search Hunter ran on
            # every refresh tick (~17/day) and dominated API spend (~$28/day).
            # Feed refreshes stay on every tick (cheap, skip-if-stable); the
            # Hunter fires only on hunt=True ticks.
            # Hunt times (user-defined 2026-07-02): traders check the board at
            # 8:00 / 8:30 / 8:45 AM ET — the deep sweep lands at 8:00 (first
            # hunt of the day) with light follow-ups at 8:30 + 8:45, then the
            # 4:00 + 4:30 PM AMC hunts. 5 hunts/day total.

            # Primary hunt ticks: 8:00 (deep — first of day), 8:30, 8:45 ET
            _scheduler.add_job(_cat_refresh,
                trigger=CronTrigger(day_of_week="mon-fri", hour="8", minute="0,30,45", timezone=_ET),
                kwargs={"hunt": True},
                id="catalyst_premarket_hunt", max_instances=1, replace_existing=True)

            # Early feed-only ticks keep the board warm for early birds:
            # 6:00, 6:30, 7:00, 7:30 ET
            _scheduler.add_job(_cat_refresh,
                trigger=CronTrigger(day_of_week="mon-fri", hour="6-7", minute="0,30", timezone=_ET),
                kwargs={"hunt": False},
                id="catalyst_premarket", max_instances=1, replace_existing=True)

            # Late pre-market feed-only ticks: 9:00 + 9:30 ET
            _scheduler.add_job(_cat_refresh,
                trigger=CronTrigger(day_of_week="mon-fri", hour="9", minute="0,30", timezone=_ET),
                kwargs={"hunt": False},
                id="catalyst_premarket_late", max_instances=1, replace_existing=True)

            # Pre-open burst: 9:10 + 9:20 ET — a fresh pull right before the
            # 9:30 open so the board is current while the trader is prepping.
            # Cheap: skip-if-stable reuses unchanged theses, so on a quiet
            # morning these are near-$0 but still re-stamp refreshed_at + catch
            # any late-breaking pre-open catalyst.
            _scheduler.add_job(_cat_refresh,
                trigger=CronTrigger(day_of_week="mon-fri", hour="9", minute="10,20", timezone=_ET),
                kwargs={"hunt": False},
                id="catalyst_preopen", max_instances=1, replace_existing=True)

            # AMC earnings burst — the EOD focus window is 4:00-5:00 PM ET
            # (user-defined 2026-07-08): hunts at 4:00 + 4:30 + a final 5:00
            # sweep; feed-only ticks fill the gaps (every 5min to 4:25, every
            # 10min to 4:55). Anything that breaks after 5:00 PM is deliberately
            # left for the premarket sweeps to catch.
            _scheduler.add_job(_cat_refresh,
                trigger=CronTrigger(day_of_week="mon-fri", hour="16", minute="0,30", timezone=_ET),
                kwargs={"hunt": True},
                id="catalyst_amc_burst_hunt", max_instances=1, replace_existing=True)
            _scheduler.add_job(_cat_refresh,
                trigger=CronTrigger(day_of_week="mon-fri", hour="16", minute="5-25/5,35,45,55", timezone=_ET),
                kwargs={"hunt": False},
                id="catalyst_amc_burst", max_instances=1, replace_existing=True)
            # Final EOD hunt: 5:00 PM ET — catches the 4:30-5:00 AMC stragglers
            # (late reporters, post-close guidance) before the engine goes
            # quiet for the evening.
            _scheduler.add_job(_cat_refresh,
                trigger=CronTrigger(day_of_week="mon-fri", hour="17", minute="0", timezone=_ET),
                kwargs={"hunt": True},
                id="catalyst_eod_final_hunt", max_instances=1, replace_existing=True)

            # Coverage self-audit: 8:15 PM ET weekdays -- after the AMC burst +
            # any post-close moves have settled. Classifies the day's biggest
            # movers vs what the tile showed (ranked/hidden/excluded/missed);
            # a 'missed' big mover means a source is blind. Report at
            # GET /api/admin/catalyst-coverage. Best-effort -- never blocks.
            def _cat_audit():
                from api.services.catalyst import coverage_audit
                import datetime as _d
                from zoneinfo import ZoneInfo as _Z
                coverage_audit.run_audit(
                    _d.datetime.now(_Z("America/New_York")).date().isoformat())
            _scheduler.add_job(_cat_audit,
                trigger=CronTrigger(day_of_week="mon-fri", hour="20", minute="15", timezone=_ET),
                id="catalyst_coverage_audit", max_instances=1, replace_existing=True)

            # Nightly rule-learner: 8:30 PM ET weekdays — after the AMC burst +
            # coverage audit, so all of the day's owner notes are in. Distills
            # recurring themes in the trader's free-text notes into DURABLE
            # curator rules (stored in the DB, applied at runtime, revertible
            # without a deploy). Honors CATALYST_RULE_LEARNER_ENABLED; wrapped so
            # a failure never breaks the scheduler.
            def _cat_rule_learn():
                try:
                    from api.services.catalyst import rule_learner
                    rule_learner.run_learn()
                except Exception as _e:
                    print(f"[scheduler] catalyst rule-learner failed (non-fatal): {_e}")
            _scheduler.add_job(_cat_rule_learn,
                trigger=CronTrigger(day_of_week="mon-fri", hour="20", minute="30", timezone=_ET),
                id="catalyst_rule_learner", max_instances=1, replace_existing=True)

            # Evidence-based auto-tune: once daily at 5:00 AM ET. Reviews recent
            # catalyst outcomes and nudges scoring/gate thresholds. run_autotune()
            # itself honors CATALYST_AUTOTUNE_ENABLED, so this is a no-op when
            # that's off; wrapped so a failure never breaks the scheduler.
            def _cat_autotune():
                try:
                    from api.services.catalyst import tuning
                    tuning.run_autotune()
                except Exception as _e:
                    print(f"[scheduler] catalyst autotune failed (non-fatal): {_e}")
            _scheduler.add_job(_cat_autotune,
                trigger=CronTrigger(day_of_week="mon-fri", hour="5", minute="0", timezone=_ET),
                id="catalyst_autotune", max_instances=1, replace_existing=True)

            # Premarket health check: 7:00, 8:00, 9:00 ET — distinguishes a
            # broken pipeline from a quiet morning -> pings the operator
            # (Discord/email, deduped once per day) AND force-refreshes. 7am
            # gives runway to fix; 9am is the final pre-open gate. Honors
            # CATALYST_HEALTH_ALERTS_ENABLED.
            def _cat_health():
                try:
                    from api.services.catalyst import health
                    health.run_premarket_health_check()
                except Exception as _e:
                    print(f"[scheduler] catalyst health check failed (non-fatal): {_e}")
            _scheduler.add_job(_cat_health,
                trigger=CronTrigger(day_of_week="mon-fri", hour="7,8,9", minute="0", timezone=_ET),
                id="catalyst_premarket_health", max_instances=1, replace_existing=True)

            print("[scheduler] catalyst engine jobs registered (premarket 6-9:30 ET every 30m + pre-open burst 9:10/9:20 ET + premarket health 7/8/9 AM ET + AMC burst 4-4:30 ET every 5m + coverage audit 8:15 PM ET + rule-learner 8:30 PM ET + autotune 5 AM ET)")

        # -- Morning Catalyst Digest (the brief reaches you) ---------------
        # One consolidated A/B brief pushed to operators at 8 AM ET weekdays
        # via Discord + email + AlertBell. Gated on CATALYST_DIGEST_ENABLED.
        if os.environ.get("CATALYST_DIGEST_ENABLED", "0").lower() in ("1", "true", "yes"):
            from api.services.catalyst.digest import send_digest as _cat_digest
            _scheduler.add_job(
                lambda: _cat_digest(),
                trigger=CronTrigger(day_of_week="mon-fri", hour=8, minute=0, timezone=_ET),
                id="catalyst_morning_digest", max_instances=1, replace_existing=True)
            print("[scheduler] catalyst morning digest registered (8 AM ET weekdays)")

        # -- Weekly calendar cards -> Discord ------------------------------
        # Saturday 4:30 AM ET: render the week-ahead earnings + economic-events
        # cards and post both in ONE message to #event-calendar.
        # Pinned to America/New_York so it stays 4:30 LOCAL across the DST flip
        # instead of drifting an hour in summer (lesson_apscheduler_cron_utc_trap).
        if os.environ.get("CALENDAR_WEEK_POST_ENABLED", "0").lower() in ("1", "true", "yes"):
            def _calendar_week_post_job():
                try:
                    from api.services.calendar_week_poster import run_scheduled_post
                    run_scheduled_post()
                except Exception as _e:
                    print(f"[scheduler] weekly calendar post error: {_e}")

            _scheduler.add_job(
                _calendar_week_post_job,
                trigger=CronTrigger(day_of_week="sat", hour=4, minute=30, timezone=_ET),
                id="calendar_week_post", max_instances=1, replace_existing=True)
            print("[scheduler] weekly calendar Discord post registered (Sat 4:30 AM ET)")

        # -- Pre-report Earnings Alerts (Phase E1) -------------------------
        # Gated on CALENDAR_ALERTS_ENABLED=1. Fires two windows:
        #   - Evening ~6 PM ET -- alert for tomorrow's BMO reporters
        #   - Morning ~7 AM ET -- alert for today's BMO reporters (pre-open)
        if os.environ.get("CALENDAR_ALERTS_ENABLED", "0").lower() in ("1", "true", "yes"):
            def _calendar_alert_job_evening():
                # Evening job: alert for TOMORROW's reporters (next trading day)
                try:
                    from api.services.calendar_alerts import run_prereport_alerts
                    from datetime import date as _date, timedelta as _td
                    tomorrow = (_date.today() + _td(days=1)).isoformat()
                    run_prereport_alerts(tomorrow)
                except Exception as _e:
                    print(f"[scheduler] calendar alert job (evening) error: {_e}")

            def _calendar_alert_job_morning():
                # Morning job: alert for TODAY's reporters (pre-market)
                try:
                    from api.services.calendar_alerts import run_prereport_alerts
                    from datetime import date as _date
                    run_prereport_alerts(_date.today().isoformat())
                except Exception as _e:
                    print(f"[scheduler] calendar alert job (morning) error: {_e}")

            _scheduler.add_job(
                _calendar_alert_job_evening,
                trigger=CronTrigger(hour=18, minute=0, timezone=_ET),
                id="calendar_alerts_evening",
                max_instances=1,
                replace_existing=True,
            )
            _scheduler.add_job(
                _calendar_alert_job_morning,
                trigger=CronTrigger(hour=7, minute=0, timezone=_ET),
                id="calendar_alerts_morning",
                max_instances=1,
                replace_existing=True,
            )
            print("[scheduler] calendar pre-report alert jobs registered (7 AM + 6 PM ET daily)")

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

        _scheduler.add_job(_check_churn_risk, trigger=CronTrigger(hour=9, minute=0, timezone=_ET), id="churn_risk_check", max_instances=1, replace_existing=True)
        _scheduler.add_job(record_mrr_snapshot, trigger=CronTrigger(hour=23, minute=59, timezone=_ET), id="mrr_snapshot", max_instances=1, replace_existing=True)
        try:
            record_mrr_snapshot()
        except Exception as e:
            print(f"[startup] MRR snapshot error (non-fatal): {e}")

        from api.services.watchlist_digest import run_daily_digests, run_weekly_digests
        _scheduler.add_job(run_daily_digests, trigger=CronTrigger(hour=17, minute=0, timezone=_ET), id="watchlist_daily_digest", max_instances=1, replace_existing=True)
        _scheduler.add_job(run_weekly_digests, trigger=CronTrigger(day_of_week="fri", hour=17, minute=5, timezone=_ET), id="watchlist_weekly_digest", max_instances=1, replace_existing=True)

        def _nightly_bar_refresh():
            try:
                from api.services.bars_seeder import seed_full_universe
                import threading as _th
                _th.Thread(target=seed_full_universe, daemon=True, name="bars-nightly").start()
            except Exception as e:
                print(f"[scheduler] nightly bar refresh error: {e}")

        _scheduler.add_job(_nightly_bar_refresh, trigger=CronTrigger(day_of_week="mon-fri", hour=16, minute=15, timezone=_ET), id="bars_nightly_refresh", max_instances=1, replace_existing=True)

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
                                               hour="7-9", minute="*/15", timezone=_ET),
                           id="voice_proactive_premarket",
                           max_instances=1, replace_existing=True)
        _add_compass_job(lambda: _voice_window_scan("rth"),
                           trigger=CronTrigger(day_of_week="mon-fri",
                                               hour="9-15", minute="*/30", timezone=_ET),
                           id="voice_proactive_scan",
                           max_instances=1, replace_existing=True)
        _add_compass_job(lambda: _voice_window_scan("after_hours"),
                           trigger=CronTrigger(day_of_week="mon-fri",
                                               hour="16-20", minute="*/30", timezone=_ET),
                           id="voice_proactive_after_hours",
                           max_instances=1, replace_existing=True)

        def _awareness_engine_scan():
            import os as _os_aw
            if _os_aw.environ.get("AWARENESS_ENGINE_ENABLED", "0") != "1":
                print("[awareness] AWARENESS_ENGINE_ENABLED not set -- skipping scan "
                      "(set AWARENESS_ENGINE_ENABLED=1 alongside COMPASS_AUTOMATION_ENABLED=1)")
                return
            try:
                from api.services.awareness.engine import run_awareness_scan
                result = run_awareness_scan()
                print(f"[awareness] scan complete: {result}")
            except Exception as e:
                print(f"[awareness] scan failed: {e}")

        # Calm/surgical cadence: every 20 minutes, weekday market-adjacent
        # hours only. Daily caps + per-symbol cooldowns (existing
        # add_insight) do the rest of the noise control. Single-flight is
        # load-bearing: run_awareness_scan does a read-then-append on the
        # regime_snapshots ledger, so max_instances=1 must stay 1.
        _add_compass_job(_awareness_engine_scan,
                           trigger=CronTrigger(day_of_week="mon-fri",
                                               hour="4-20", minute="*/20", timezone=_ET),
                           id="awareness_engine_scan",
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
                                               hour=7, minute=30, timezone=_ET),
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
                           trigger=CronTrigger(hour=3, minute=30, timezone=_ET),
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

        _scheduler.add_job(_nightly_flow_prune, trigger=CronTrigger(hour=20, minute=0, timezone=_ET), id="flow_nightly_prune", max_instances=1, replace_existing=True)

        # Single-stock ETF family map: nightly rebuild (spec: docs/superpowers/
        # specs/2026-07-21-single-stock-etf-switcher-design.md §3.4). Weekdays
        # 20:30 ET; self-heals on lookup if this ever misses.
        def _ssetf_nightly():
            import os as _os
            if _os.environ.get("SINGLE_STOCK_ETFS_ENABLED", "1") != "1":
                return
            from api.services import single_stock_etfs as _ss
            _ss.rebuild(trigger="cron")
        _scheduler.add_job(_ssetf_nightly,
                           trigger=CronTrigger(day_of_week="mon-fri", hour=20, minute=30, timezone=_ET),
                           id="ssetf_nightly_rebuild", max_instances=1, replace_existing=True)

        # -- Daily OI snapshot for retroactive flow confirmation ----------
        # Captures Schwab live OI for every contract with flow in the past
        # 30 days. Runs at 5:30 AM ET -- well before market open, off-peak
        # for Schwab API rate limits. Day-over-day OI deltas let us
        # retroactively confirm B-side trades as real positioning once
        # OI growth proves they were institutional opens (vs churn).
        try:
            from api.oi_snapshots import daily_snapshot_job, init_db as _init_oi_snapshots
            _init_oi_snapshots()  # ensure table exists
            # Trade-aware dealer positioning -- derived from oi_snapshots +
            # flow data. init_db only creates the table; population happens
            # via the backfill endpoint (one-time) and the daily_snapshot_job
            # hook (every day after OI lands).
            try:
                from api.dealer_positioning import init_db as _init_dealer_positioning
                _init_dealer_positioning()
                print("[startup] dealer_positioning table initialized")
            except Exception as _e:
                print(f"[startup] dealer_positioning init failed (non-fatal): {_e}")
            # Post-P5-cutover: the Schwab consumer + on-demand OI fetch + flow.db
            # live on the FLOW-WORKER now, so the daily OI snapshot cron runs
            # THERE (see flow_worker_main._start_flow_schedulers). Registering it
            # on web too would write to web's frozen flow.db AND refresh-race the
            # shared Schwab token. Gate it to where the consumer runs.
            if os.getenv("MASSIVE_WS_ENABLED") == "1":
                # timezone EXPLICIT (2026-07-16): a pre-built CronTrigger defaults
                # to the SERVER-LOCAL tz (UTC on Railway), NOT the scheduler's ET —
                # this job had been firing at 5:30 UTC = 1:30 AM ET.
                _scheduler.add_job(
                    daily_snapshot_job,
                    trigger=CronTrigger(day_of_week="mon-fri", hour=5, minute=30,
                                        timezone=ZoneInfo("America/New_York")),
                    id="oi_snapshot_daily",
                    max_instances=1,
                    replace_existing=True,
                    coalesce=True,
                )
                print("[scheduler] OI snapshot job registered (5:30 AM ET, Mon-Fri)")
            else:
                print("[scheduler] OI snapshot cron NOT registered here (MASSIVE_WS_ENABLED!=1 — runs on flow-worker)")
        except Exception as e:
            print(f"[scheduler] OI snapshot job registration failed: {e}")

        _scheduler.add_job(_voice_cache_purge, trigger=CronTrigger(hour=3, minute=30, timezone=_ET), id="voice_audio_cache_purge", max_instances=1, replace_existing=True)

        def _compass_eod_job():
            import os as _os
            # Per-surface kill switch (default OFF) -- paused 2026-05-27 at user request for cost.
            # Belt-and-suspenders even if COMPASS_AUTOMATION_ENABLED is flipped on.
            if _os.environ.get("COMPASS_EOD_RECAP_ENABLED", "0") != "1":
                print("[scheduler] Compass EOD: paused via COMPASS_EOD_RECAP_ENABLED=0 -- no tokens spent")
                return
            if not _os.environ.get("ANTHROPIC_API_KEY"):
                print("[scheduler] Compass EOD: ANTHROPIC_API_KEY missing -- skipping batch")
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
            trigger=CronTrigger(day_of_week="mon-fri", hour=16, minute=30, timezone=_ET),
            id="compass_eod_recap",
            max_instances=1,
            replace_existing=True,
        )

        def _compass_weekly_email_job():
            import os as _os
            # Per-surface kill switch (default OFF) -- paused 2026-05-27 at user request for cost.
            # Belt-and-suspenders even if COMPASS_AUTOMATION_ENABLED is flipped on.
            if _os.environ.get("COMPASS_WEEKLY_DIGEST_ENABLED", "0") != "1":
                print("[scheduler] Compass weekly digest: paused via COMPASS_WEEKLY_DIGEST_ENABLED=0 -- no tokens spent")
                return
            if not _os.environ.get("ANTHROPIC_API_KEY"):
                print("[scheduler] Compass weekly email: ANTHROPIC_API_KEY missing -- skipping batch")
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
            trigger=CronTrigger(day_of_week="sun", hour=8, minute=0, timezone=_ET),
            id="compass_weekly_email_digest",
            max_instances=1,
            replace_existing=True,
        )

        # Compass Health — weekly owner ops email. NOT under _add_compass_job
        # (that gates on the paused COMPASS_AUTOMATION_ENABLED); this is cheap
        # SQL + email with no LLM, gated by its own COMPASS_HEALTH_EMAIL_ENABLED.
        def _compass_health_email_job():
            if _os.environ.get("COMPASS_HEALTH_EMAIL_ENABLED", "0") != "1":
                return
            try:
                from api.services import compass_health
                r = compass_health.send_weekly_health_email(days=7)
                print(f"[scheduler] Compass Health email: sent={r['sent']} "
                      f"recipients={r['recipients']} error={r.get('error')}")
            except Exception as e:  # noqa: BLE001
                print(f"[scheduler] Compass Health email error: {e}")

        _scheduler.add_job(
            _compass_health_email_job,
            trigger=CronTrigger(day_of_week="mon", hour=13, minute=30, timezone=_ET),
            id="compass_health_email",
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

        # Discord flow watchlist -- manual push only (no scheduled jobs)

        # -- Fundamentals widget warm (densifies estimate-revision snapshots) --
        # Daily 5:30 AM ET: warm the earnings table for user-tracked tickers +
        # leadership so forward-estimate snapshots accrue (keeps the ▲/▼ revision
        # markers accurate) and those stocks are pre-fresh during earnings season.
        # The widget works fully without this -- load-driven freshness still
        # covers every stock; this only densifies snapshot history. Best-effort.
        if os.environ.get("FUNDAMENTALS_WARM_ENABLED", "").lower() in ("1", "true", "yes"):
            def _fundamentals_warm_job():
                import logging as _lg
                import time as _t
                log = _lg.getLogger("fundamentals.warm")
                try:
                    from api.services.earnings_table import get_earnings_table
                    from api.services import fundamentals_estimates_store as _store
                    syms: set[str] = set()
                    # User-tracked tickers (watchlists + flagged), best-effort.
                    try:
                        from api.services.watchlist_service import all_tracked_symbols
                        syms.update(all_tracked_symbols())
                    except Exception:
                        pass
                    # Leadership (UCT20), best-effort.
                    try:
                        from api.services import engine as _engine
                        for row in (_engine.get_leadership() or []):
                            sym = (row.get("symbol") or row.get("ticker") or "").upper()
                            if sym:
                                syms.add(sym)
                    except Exception:
                        pass
                    syms = {s for s in syms if s}
                    log.info("fundamentals warm: %d tickers", len(syms))
                    for s in sorted(syms):
                        try:
                            get_earnings_table(s)
                        except Exception as e:
                            log.debug("warm %s failed: %s", s, e)
                        _t.sleep(0.25)  # polite to yfinance/FMP
                    try:
                        _store.prune()
                    except Exception:
                        pass
                except Exception as e:
                    log.warning("fundamentals warm job crashed: %s", e)

            _scheduler.add_job(
                _fundamentals_warm_job,
                trigger=CronTrigger(hour=5, minute=30, timezone=_ET),
                id="fundamentals_warm",
                max_instances=1,
                replace_existing=True,
            )
            print("[startup] Fundamentals warm scheduled -- daily at 5:30 AM ET")

        # -- Earnings-day reporters auto-refresh (fundamentals widget freshness) --
        # Weekdays every 15 min through the print windows (6-9:xx AM BMO,
        # 4-7:xx PM ET AMC): rebuild the earnings-table snapshot for today's
        # reporters — clearing the inner per-year cache — so a just-released
        # quarter is live server-side within minutes, with zero user traffic.
        # Bounded (≤40 tickers, skip when <10 min stale). Default ON; opt out
        # with FUNDAMENTALS_REPORTERS_WARM_DISABLED=1.
        if os.environ.get("FUNDAMENTALS_REPORTERS_WARM_DISABLED", "").lower() not in ("1", "true", "yes"):
            def _fundamentals_reporters_warm_job():
                import logging as _lg
                log = _lg.getLogger("fundamentals.reporters_warm")
                try:
                    from api.services.earnings_table import refresh_now
                    from api.services import engine as _rw_engine
                    syms: list[str] = []
                    try:
                        earn = _rw_engine.get_earnings() or {}
                        # amc = yesterday's after-close reporters (BMO-morning recap);
                        # amc_tonight = TONIGHT's reporters — the ones printing live
                        # during the 4-8 PM window.
                        for bucket in ("bmo", "amc", "amc_tonight"):
                            for row in (earn.get(bucket) or []):
                                s = (row.get("sym") or "").upper().strip()
                                if s and s not in syms:
                                    syms.append(s)
                    except Exception:
                        pass
                    refreshed = 0
                    for s in syms[:40]:
                        try:
                            if refresh_now(s, max_age=600):
                                refreshed += 1
                        except Exception as e:
                            log.debug("reporters warm %s failed: %s", s, e)
                    if refreshed:
                        log.info("reporters warm: refreshed %d/%d", refreshed, len(syms))
                except Exception as e:
                    log.warning("reporters warm job crashed: %s", e)

            _scheduler.add_job(
                _fundamentals_reporters_warm_job,
                trigger=CronTrigger(day_of_week="mon-fri", hour="6-9,16-19", minute="*/15", timezone=_ET),
                id="fundamentals_reporters_warm",
                max_instances=1,
                replace_existing=True,
            )
            print("[startup] Fundamentals reporters warm scheduled -- every 15 min in earnings windows")

        # -- Theme Membership Engine (nightly orphan sweep + weekly improve) --
        # Gated: no THEME_ENGINE_ENABLED=1, no jobs — the engine ships inert.
        # See api/routers/theme_engine.py for the activation runbook (incl. the
        # MANDATORY clear-decisions step between validation dry-run and go-live).
        if os.environ.get("THEME_ENGINE_ENABLED") == "1":
            def _theme_engine_orphans_job():
                res = None
                try:
                    from api.services.theme_engine import orphans as _te_orphans
                    res = _te_orphans.run_orphan_batch()
                    print(f"[scheduler] theme-engine orphan batch: {res}")
                except Exception as e:  # noqa: BLE001
                    print(f"[scheduler] theme-engine orphan batch error: {e}")
                # Daily digest -> Discord (guarded; a post failure never masks the
                # batch, and _send_webhook itself never raises). Posts every night,
                # including "No new memberships tonight," so the owner sees the
                # engine ran each day.
                if res is not None:
                    try:
                        from api.services.theme_engine import orphans as _te_orphans
                        from api.services.discord_notify import _send_webhook
                        _send_webhook({
                            "title": "🧬 Theme Engine — Tonight",
                            "description": _te_orphans.daily_report_text(res)[:4000],
                            "color": 0xC9A84C,  # UCT gold
                        })
                    except Exception as e:  # noqa: BLE001
                        print(f"[scheduler] theme-engine daily report post error: {e}")

            def _theme_engine_improve_job():
                from api.services.theme_engine import improve as _te_improve
                try:
                    res = _te_improve.run_improve()
                    print(f"[scheduler] theme-engine improve: {res}")
                except Exception as e:  # noqa: BLE001
                    print(f"[scheduler] theme-engine improve error: {e}")
                try:
                    audit = _te_improve.comovement_audit()
                    print(f"[scheduler] theme-engine comovement audit: {audit}")
                except Exception as e:  # noqa: BLE001
                    print(f"[scheduler] theme-engine comovement audit error: {e}")
                # Weekly report -> Discord (guarded; _send_webhook never raises).
                try:
                    from api.services.discord_notify import _send_webhook
                    _send_webhook({
                        "title": "🧬 Theme Engine — Weekly Report",
                        "description": _te_improve.weekly_report_text()[:4000],
                        "color": 0xC9A84C,  # UCT gold
                    })
                except Exception as e:  # noqa: BLE001
                    print(f"[scheduler] theme-engine weekly report post error: {e}")

            _scheduler.add_job(
                _theme_engine_orphans_job,
                trigger=CronTrigger(day_of_week="mon-fri", hour=23, minute=0, timezone=_ET),
                id="theme_engine_orphans",
                max_instances=1,
                replace_existing=True,
            )
            _scheduler.add_job(
                _theme_engine_improve_job,
                trigger=CronTrigger(day_of_week="sat", hour=10, minute=0, timezone=_ET),
                id="theme_engine_improve",
                max_instances=1,
                replace_existing=True,
            )
            print("[startup] Theme engine scheduled -- orphans Mon-Fri 11 PM ET; improve Sat 10 AM ET")

        _scheduler.start()
        print("[startup] COT scheduler running -- Fridays at 3:50 PM ET (retries 4:15, 4:45); daily catchup at 6 PM ET")
        print("[startup] Session cleanup scheduled -- daily at 3:00 AM ET")
        print("[startup] Churn risk check scheduled -- daily at 9:00 AM ET")
        print("[startup] MRR snapshot scheduled -- daily at 11:59 PM ET")
        if _compass_automation_on:
            print("[startup] Compass automation ENABLED -- proactive scans, daily focus, EOD recap, weekly digest scheduled")
        else:
            print("[startup] Compass automation PAUSED -- all scheduled Compass/voice jobs skipped; manual surfaces unaffected (set COMPASS_AUTOMATION_ENABLED=1 to resume)")
        print("[startup] Pattern engine jobs scheduled -- outcomes (4h interval), stats (06:00 UTC daily), universe scan (1h interval)")

        # -- Massive WebSocket consumer (Phase 1: feeds OptionsFlow page) ----
        # Guarded by acquire_scheduler_lock() above -- Massive enforces ONE
        # concurrent options WS connection per account, so only the lock
        # holder may connect. Other uvicorn workers skip it silently.
        # Set MASSIVE_WS_DRY_RUN=1 on first deploy to verify behavior without
        # writing to FlowDB; flip to 0 once /api/massive/status shows healthy
        # counters during market hours.
        try:
            from api.massive_ws_worker import start as _start_massive_ws
            if _start_massive_ws():
                print("[startup] Massive WS consumer started")
            else:
                print("[startup] Massive WS consumer not started (disabled or no MASSIVE_API_KEY)")
        except Exception as e:
            # Never let WS failure block boot -- OptionsFlow falls back to
            # whatever's already in FlowDB from prior BBS uploads.
            print(f"[startup] Massive WS consumer failed to start (non-fatal): {e}")

        # -- Tape-freeze watchdog (7/14 incident): separate OS thread that
        # force-exits the process if flow.db inserts stop during market hours
        # (consumer loop wedged). Self-gated on MASSIVE_WS_ENABLED=1, so it's
        # a no-op whenever this service doesn't own the consumer.
        try:
            from api import flow_watchdog
            if flow_watchdog.start("web"):
                print("[startup] flow freeze-watchdog armed")
        except Exception as e:
            print(f"[startup] flow freeze-watchdog failed to start (non-fatal): {e}")

        # -- Massive Flat Files daily ingester (T+1 batch fallback / archive) -
        # Runs alongside the WS consumer. WS provides intraday rows; Flat Files
        # backfills yesterday's full archive overnight. Both write to the same
        # FlowDB table; dedup_key handles overlap. Independent failure modes:
        # if WS is locked out (e.g. max_connections), Flat Files still populates
        # the page each morning, so the manual /options-flow-admin upload can
        # be retired regardless of WS status.
        try:
            from api import massive_flatfiles_worker
            if massive_flatfiles_worker.register_jobs(_scheduler):
                print("[startup] Massive Flat Files cron registered (11:30/12:00/12:30 PM ET Mon-Fri)")
            else:
                print("[startup] Massive Flat Files cron NOT registered (disabled or no S3 keys)")
        except Exception as e:
            print(f"[startup] Massive Flat Files cron registration failed (non-fatal): {e}")
        # T+1 flow gap-autofill (deploy-survival P2) — post-close self-healing
        # of live-flow write gaps from Massive's flat file. Ships dark
        # (FLOW_GAP_AUTOFILL_ENABLED=0); startup_check re-bumps the flow CSV
        # cache version after a recent fill (the offset is process-local).
        try:
            from api import flow_gap_autofill
            flow_gap_autofill.startup_check()
            if flow_gap_autofill.register_jobs(_scheduler):
                print("[startup] Flow gap-autofill cron registered (16:45/21:00/08:00 ET Mon-Fri)")
        except Exception as e:
            print(f"[startup] Flow gap-autofill registration failed (non-fatal): {e}")
        # Tape-spool gap sweeps (only where the spool/consumer runs; the module
        # gates itself on FLOW_TAPE_SPOOL/REPLAY_ENABLED).
        try:
            from api import flow_tape_spool
            if flow_tape_spool.register_jobs(_scheduler):
                print("[startup] tape-spool gap sweeps registered")
        except Exception as e:
            print(f"[startup] tape-spool sweep registration failed (non-fatal): {e}")
        # Nightly offsite backup of flow.db to R2 (deploy-survival B4). Ships
        # dark (FLOW_BACKUP_ENABLED=0); 02:30 ET Mon-Sat. flow.db currently has
        # backups only on the same volume = no corruption/loss recovery.
        try:
            from api import flow_backup
            if flow_backup.register_jobs(_scheduler):
                print("[startup] Flow DB backup cron registered (02:30 ET Mon-Sat)")
        except Exception as e:
            print(f"[startup] Flow DB backup registration failed (non-fatal): {e}")
        # Nightly offsite backup of the J2 image-attachments tree to R2 (gates
        # the P1b screenshots feature). Ships dark (J2_ATTACHMENT_BACKUP_ENABLED=0);
        # 02:45 ET Mon-Sat. Attachments live only on the WEB volume = no recovery
        # path without this — which is why it registers in the web scheduler.
        try:
            from api import j2_attachments_backup
            if j2_attachments_backup.register_jobs(_scheduler):
                print("[startup] j2 attachments backup registered (02:45 ET Mon-Sat)")
        except Exception as e:
            print(f"[startup] j2 attachments backup registration failed (non-fatal): {e}")
        # Nightly closed-trade excursion (MFE/MAE/exit-efficiency) backfill
        # (Journal A+ Phase 2). Ships dark (EXCURSION_ENGINE_ENABLED=0);
        # 03:10 ET Mon-Sat. Idempotent (skips already-computed trade_refs);
        # commits per row so its writer locks on auth.db stay short.
        try:
            from api.services.journal_two import excursion_jobs
            if excursion_jobs.register_jobs(_scheduler):
                print("[startup] j2 excursion backfill registered (03:10 ET Mon-Sat)")
        except Exception as e:
            print(f"[startup] j2 excursion backfill registration failed (non-fatal): {e}")
    else:
        print("[startup] APScheduler skipped -- lock held by another uvicorn worker (multi-worker mode)")

    # flow.db boot integrity probe (deploy-survival B4) — runs on EVERY web pod
    # in a daemon thread so a multi-second PRAGMA scan on the ~800MB DB never
    # delays healthcheck readiness. Alerts Discord on corruption.
    try:
        import threading as _thr
        def _flow_integrity_probe():
            try:
                from api import flow_backup
                _fb = flow_backup.startup_integrity_check()
                if not _fb.get("ok"):
                    print(f"[startup] FLOW DB INTEGRITY FAILED: {_fb.get('detail')}")
            except Exception as _e:
                print(f"[startup] flow.db integrity check failed (non-fatal): {_e}")
        _thr.Thread(target=_flow_integrity_probe, name="flow-integrity-probe",
                    daemon=True).start()
    except Exception as _e:
        print(f"[startup] flow.db integrity probe thread failed to start: {_e}")

    # Event-loop wedge watchdog (audit B3) — the single web process's loop is
    # the whole site's liveness. Ships DARK: does nothing unless WATCHDOG_OBSERVE=1
    # (measure baseline lag) or WATCHDOG_ENABLED=1 (arm the force-restart on a
    # sustained wedge). Captures the running loop; must start before yield.
    try:
        from api import event_loop_watchdog
        event_loop_watchdog.start_watchdog()
    except Exception as _e:
        print(f"[startup] event-loop watchdog failed to start (non-fatal): {_e}")

    yield
    # -- Massive WS graceful stop (deploy-survival P1) ---------------------
    # Runs on SIGTERM during the Railway drain window. Sends a clean WS close
    # so Massive frees the OPRA slot in seconds and the replacement deploy
    # doesn't hit max_connections. Defensive getattr: if this deploys before
    # the massive_ws_worker patch, it's a no-op (dangling-import playbook --
    # merge order can't crash boot OR shutdown).
    try:
        import asyncio as _aio
        from api import massive_ws_worker as _mww
        _mww_stop = getattr(_mww, "stop", None)
        if callable(_mww_stop):
            # stop() blocks up to ~5s in thread.join -- run in a worker thread
            # so the event loop keeps servicing uvicorn's shutdown work.
            _clean = await _aio.to_thread(_mww_stop, 5.0)
            print(f"[shutdown] Massive WS consumer stop: "
                  f"{'clean' if _clean else 'join timed out (daemon finishing in drain window)'}")
        else:
            print("[shutdown] Massive WS stop() not present -- skipping (pre-patch module)")
    except Exception as e:
        print(f"[shutdown] Massive WS stop failed (non-fatal): {e}")
    # Graceful Bullflow SSE worker stop — same pattern, same reason (clean
    # close so the day's alert state survives via DB rehydration on boot).
    try:
        from api import liveflow_worker_threaded as _lf_threaded
        _lf_stop = getattr(_lf_threaded, "stop", None)
        if callable(_lf_stop):
            _lf_clean = await _aio.to_thread(_lf_stop, 5.0)
            print(f"[shutdown] Bullflow SSE worker stop: "
                  f"{'clean' if _lf_clean else 'join timed out (daemon finishing in drain window)'}")
    except Exception as e:
        print(f"[shutdown] Bullflow worker stop failed (non-fatal): {e}")
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
    stop_snapshot_scheduler()

app = FastAPI(title="UCT Dashboard", lifespan=lifespan)
app.add_middleware(MaintenanceMiddleware)
app.add_middleware(CompassPaywallMiddleware)
# 🔴 THE FAIL-CLOSED ADMIN GATE. `api/middleware/admin_guard.py` shipped
# complete, fails closed, and carried 8 passing tests — and this line did not
# exist, on this branch or on origin/master, so the ~30 destructive ops under
# `/api/admin/{massive,oi,ticker-types,flow}/*`, `/api/admin/alert-tester` and
# `/api/live/admin/*` answered ANY caller. Built, tested, green and connected to
# nothing, in its most expensive form: the unreachable thing was a security
# guard. The 8 tests could not see it because `tests/test_launch_hardening.py`
# builds its OWN FastAPI app and adds the middleware itself — both halves of a
# severed wire stay individually correct.
# ⛔ DO NOT DELETE WITHOUT DELETING THE MODULE. The rail is
# `tests/test_admin_guard_registered.py`, which drives the REAL `api.main:app`,
# and `auth_surface_check.audit_routes`, which reads `app.user_middleware` at
# boot and reports every guarded admin route as UNGATED the moment this line
# goes away.
# ⭐ ORDER: added AFTER CompassPaywall and BEFORE CORS, so it runs INSIDE the
# CORS layer (a browser still gets CORS headers on the 403) and OUTSIDE the
# paywall/maintenance layers (an anonymous caller is refused before either does
# any work). Starlette prepends, so the execution order is
# GZip → CORS → AdminGuard → CompassPaywall → Maintenance → router.
from api.middleware.admin_guard import AdminGuardMiddleware as _AdminGuard
app.add_middleware(_AdminGuard)
from starlette.middleware.cors import CORSMiddleware as _CORS
app.add_middleware(_CORS, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
from starlette.middleware.gzip import GZipMiddleware as _GZipBase
from starlette.types import ASGIApp, Receive, Scope, Send

def _is_gzip_exempt(path: str) -> bool:
    """Paths that must NEVER be gzip-buffered. SSE endpoints in particular: GZip
    buffers the whole body, so an event-stream never flushes and no events reach
    the client (caught live 2026-07-11 on the Floor chat stream). Keep every SSE
    route here. Testable so a main.py refactor can't silently drop one."""
    return (
        path.startswith("/api/stream")
        or path.startswith("/api/live/massive/stream")  # flow SSE
        or path == "/api/community/chat/stream"          # Floor live-chat SSE
        or path == "/api/ai-search/stream"               # AI Search token stream
        or path.startswith("/assets/")
        or path.startswith("/fonts/")   # .woff2 is already compressed
    )


class _GZipSkipSSE(_GZipBase):
    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        path = scope.get("path") or ""
        if scope.get("type") == "http" and _is_gzip_exempt(path):
            await self.app(scope, receive, send)
        else:
            await super().__call__(scope, receive, send)

# compresslevel=5 (default is 9): on the ~1.4 MB deep-bar payloads this serves,
# level 9 burns materially more CPU per request on the single shared event loop
# for a <3% size gain over level 5. Level 5 is the throughput/size sweet spot;
# combined with orjson's already-smaller output the wire stays tiny. SSE + hashed
# /assets/ keep bypassing gzip (unchanged).
app.add_middleware(_GZipSkipSSE, minimum_size=1000, compresslevel=5)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.get("/api/maintenance")
def get_maintenance():
    return {"maintenance": _MAINTENANCE_MODE}

def _process_rss_mb():
    """Current resident-set memory in MB, or None if unavailable (non-Linux).

    Read straight from /proc so it adds no dependency. Paired with
    thread_count below to diagnose the 2026-06-09 "can't start new thread"
    outage: a climbing thread_count points to a thread leak; flat threads
    with climbing rss_mb points to memory pressure (stack alloc failing)."""
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return round(int(line.split()[1]) / 1024, 1)  # kB -> MB
    except Exception:
        pass
    return None


@app.get("/api/health")
def health():
    from api.services.cache import cache
    wire = cache.get("wire_data")
    wire_date = wire.get("date") if wire else None
    return {
        "status": "ok",
        "wire_date": wire_date,
        "uptime_seconds": int(time.time() - _APP_BOOT_TS),
        # Pod resource observability (2026-06-09 thread-exhaustion incident).
        "thread_count": threading.active_count(),
        "rss_mb": _process_rss_mb(),
    }


@app.get("/api/ready")
def ready():
    """Readiness probe -- railway.json `healthcheckPath` points here.

    Returns 503 until every warm gate has finished, so Railway holds live
    traffic on the OLD (already warm) pod instead of cutting over to a cold
    one. See api/services/readiness.py for the full why.

    This is deliberately SEPARATE from /api/health (liveness): that route is
    polled by worker_main's down-alert monitor, which posts a red "site down"
    alert to Discord, and must not fail during a normal warm window.
    """
    snap = readiness.snapshot()
    return JSONResponse(status_code=200 if snap["ready"] else 503, content=snap)


# ── The diagnostic health family is ADMIN-ONLY (2026-08-09) ─────────────────
# 🔴 THESE THREE ANSWERED ANONYMOUS CALLERS. `/api/health/thread-stacks`
# returned 2,841 bytes of LIVE PYTHON STACK TRACES -- absolute module paths,
# function names and line numbers for every running thread -- to anyone on the
# internet; `/threads` names every background subsystem this pod runs; `/cache`
# reports the R2 bars-snapshot sync state. They were out of scope for the
# 2026-08-09 auth sweep only because they are declared here rather than in a
# router, which is not a security property.
#
# ⛔ NOT `AdminGuardMiddleware`. That middleware matches on `/api/admin/*` and
# `/api/live/admin/*` prefixes; widening its tuple to swallow `/api/health/*`
# would put the LIVENESS probes (`/api/health`, `/api/ready`) one prefix-typo
# away from a 403 -- and Railway's `healthcheckPath` is `/api/health` while
# `worker_main`'s down-alert monitor polls the same route and posts a red "site
# down" to Discord when it fails. A per-route `Depends` cannot reach them.
#
# ⭐ AND THE ONES THAT STAY OPEN STAY OPEN ON PURPOSE. `/api/health`,
# `/api/ready`, `/api/watchdog/status`, `/api/admin/bars-stream-status` and
# `/api/admin/reconciliation-status` are documented no-auth and were re-verified
# clean (counters only -- no market data, no universe size, no symbol lists). A
# gate that blocks everyone is not a fix;
# `tests/test_health_routes_admin_gated.py` asserts both directions.
@app.get("/api/health/threads")
def health_threads(_admin: dict = Depends(require_admin)):
    """Live thread-name histogram -- names WHAT is spawning the periodic burst
    (2026-06-10: 58->931 threads in 6 min). Names are normalized by prefix
    (digits + ticker-ish tokens stripped) so e.g. 'bars-bg-NVDA-5-partial' and
    'cat-src_3' collapse to 'bars-bg' / 'cat-src'. Hit this DURING a burst to
    see which group dominates the count. The burst watchdog
    (_start_thread_burst_watch) logs this same histogram automatically when
    the count crosses THREAD_BURST_LOG_THRESHOLD, so unattended bursts
    self-document in the Railway logs."""
    return _thread_groups()


@app.get("/api/health/thread-stacks")
def health_thread_stacks(_admin: dict = Depends(require_admin)):
    """Companion to /threads: dump WHERE each thread is stuck (deepest app-level
    stack frame) so a thread / anyio-worker burst can be pinned to the exact
    blocking call site. Hit this DURING a burst. Read-only, cheap.

    ADMIN ONLY -- see the block comment above `/api/health/threads`. This is the
    route that was handing out live stack traces with file paths and line
    numbers to unauthenticated callers. Read-only is not the same property as
    harmless."""
    import sys as _sys
    import traceback as _tb
    from collections import Counter as _Counter
    frames = _sys._current_frames()
    hist = _Counter()
    samples: dict = {}
    for t in threading.enumerate():
        fr = frames.get(t.ident)
        if fr is None:
            continue
        stack = _tb.extract_stack(fr)
        app_frame = None
        for f in reversed(stack):
            fn = f.filename.replace("\\", "/")
            if "/api/" in fn or fn.endswith("/main.py"):
                app_frame = f
                break
        ref = app_frame or (stack[-1] if stack else None)
        key = f"{ref.filename.replace(chr(92), '/').split('/')[-1]}:{ref.lineno}:{ref.name}" if ref else "?"
        grp = (t.name or "unnamed").split("-")[0].split("_")[0]
        hist[f"{grp} @ {key}"] += 1
        if key not in samples and stack:
            samples[key] = [f"{s.filename.replace(chr(92), '/').split('/')[-1]}:{s.lineno}:{s.name}"
                            for s in stack[-6:]]
    return {"total": threading.active_count(),
            "by_location": dict(hist.most_common(30)),
            "samples": samples}


@app.get("/api/health/cache")
def health_cache(_admin: dict = Depends(require_admin)):
    """Bars-snapshot sync freshness (the R2 rail). ADMIN ONLY -- see the block
    comment above `/api/health/threads`."""
    from api.services.data_sync import get_local_sync_state
    state = get_local_sync_state()
    return {
        "use_remote_bars": os.environ.get("USE_REMOTE_BARS") == "1",
        "snapshot_ts": state["snapshot_ts"],
        "synced_at": state["synced_at"],
        "seconds_since_sync": state["seconds_since_sync"],
    }

from api import debug_dump_router as _debug_dump_router
app.include_router(_debug_dump_router.router)
app.include_router(render_panels_router.router)
app.include_router(snapshot.router)
app.include_router(movers.router)
app.include_router(engine_data.router)
app.include_router(earnings.router)
app.include_router(news.router)
app.include_router(screener.router)
from api.routers import scans as scans_router
app.include_router(scans_router.router)
# ── THE SURFACE E-2's `join_clause` REACHES (Phase E, E4-A5) ─────────────────
# Its OWN module and its own route rather than a `filters.FILTERS` entry or a
# new filter type inside `query.run_scan` — a `def_hash` is not a column, and a
# nightly scan receipt and a live screener query are different freshness stories
# a member must be able to tell apart. Reasoning in the module docstring.
# ⛔ REGISTERED, so E-7's derived census walks it off `router.routes` rather than
# typing the path.
from api.routers import scan_results as scan_results_router
app.include_router(scan_results_router.router)
# RETIRED 2026-08-09 -- the /api/trades personal trade log was deprecated
# 2026-06-02 when Model Book was rebuilt as a curated library of top stocks
# (api/routers/modelbook.py). It was kept unmounted as a rollback backup on a
# documented "~30d then remove" plan; that window closed 68 days ago, so
# api/routers/trades.py and tests/api/test_trades.py are now deleted. Its
# `data/trades.json` was gitignored runtime data and never existed in the repo.
# ⚠️ NOT the same thing as `traders` below (/api/traders, live) or
# `api/services/journal_two/test_trades.py` (Journal 2.0, live).
app.include_router(traders.router)
app.include_router(push.router)
app.include_router(charts.router)
app.include_router(bars_router.router)
app.include_router(cot_router.router)
app.include_router(breadth_monitor_router.router)
app.include_router(theme_performance_router.router)
app.include_router(groups_router.router)
app.include_router(sector_strength_router.router)
# Flow read-proxy (P5 cutover): registered BEFORE every local flow-family
# router so, when FLOW_READS_PROXY_ENABLED=1, all flow.db-backed reads are
# forwarded to the flow-worker (the single writer+reader of flow.db) and
# web's local copy is never consulted. Dark by default.
try:
    from api import flow_proxy as _flow_proxy
    if _flow_proxy.register_on(app):
        print("[startup] flow read-proxy ACTIVE -> flow-worker")
except Exception as _e:  # noqa: BLE001
    print(f"[startup] flow read-proxy registration failed (non-fatal): {_e}")

app.include_router(top_flow_router)
app.include_router(flow_scoreboard_router)
app.include_router(flow_explain_router)
app.include_router(schwab_router)
app.include_router(calendar_router.router)
from api.routers import wire as wire_router          # earnings wire (Phase 1)
app.include_router(wire_router.router)


def _wire_enabled() -> bool:
    """The earnings wire ships DARK.

    Strict `== "1"` rather than the looser ("1","true","yes") idiom used
    elsewhere: this job polls providers every 20s during market hours, so the
    failure direction must be OFF. A typo enables nothing.
    """
    return os.environ.get("WIRE_ENABLED", "") == "1"
app.include_router(insider_router.router)
app.include_router(auth_router.router)
app.include_router(waitlist_router.router)
app.include_router(landing_analytics_router.router)
app.include_router(support_status_router.router)
app.include_router(avatar_router.router)
app.include_router(webhooks_router.router)
app.include_router(alerts_router.router)
app.include_router(journal_two_router.router)
app.include_router(community_router.router)
app.include_router(watchlists_router.router)
app.include_router(ticker_tags_router.router)
app.include_router(watchlist_alerts_router.router)
app.include_router(stream_router.router)
app.include_router(live_prices_router.router)
app.include_router(ticker_meta_router.router)
app.include_router(ticker_search_router.router)
from api.routers import delisted as delisted_router
app.include_router(delisted_router.router)
app.include_router(single_stock_etfs_router.router)
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
app.include_router(dealer_positioning_router)
app.include_router(watchlist_router)
app.include_router(flow_router)
app.include_router(flow_summary_router)
try:
    from api.flow_gap_autofill import router as flow_gap_autofill_router
    app.include_router(flow_gap_autofill_router)
except Exception as _e:
    print(f"[startup] flow_gap_autofill router not mounted (non-fatal): {_e}")
try:
    from api.flow_backup import router as flow_backup_router
    app.include_router(flow_backup_router)
except Exception as _e:
    print(f"[startup] flow_backup router not mounted (non-fatal): {_e}")
try:
    from api.event_loop_watchdog import router as event_loop_watchdog_router
    app.include_router(event_loop_watchdog_router)
except Exception as _e:
    print(f"[startup] event_loop_watchdog router not mounted (non-fatal): {_e}")
app.include_router(oi_snapshot_router)
app.include_router(notable_flow_router)
app.include_router(liveflow_router)
app.include_router(liveflow_health_router)
app.include_router(live_massive_router)
app.include_router(massive_stream_router)  # /api/live/massive/stream — flow SSE (dark)
app.include_router(alert_tester_router)
app.include_router(csv_ingest_router)
app.include_router(darkpool_router)
app.include_router(tweets_router.router)
app.include_router(admin_twitter_router.router)
app.include_router(admin_purge_router.router)
app.include_router(desk_router.router)
app.include_router(admin_api_health_router.router)
app.include_router(provider_coverage_router.router)  # /api/admin/provider-coverage — Task 22/23
app.include_router(catalysts_router.router)
app.include_router(wire_feedback_router.router)
app.include_router(modelbook_router.router)
app.include_router(news_catalysts_router.router)
app.include_router(stock_brief_router.router)
app.include_router(charts_layouts_router.router)
app.include_router(user_definitions_router.router)  # /api/user-definitions/* — Phase D
app.include_router(theme_index_router.router)
app.include_router(theme_engine_router.router)  # Theme Membership Engine admin ops
app.include_router(ai_search_router.router)
app.include_router(user_playbook_router.router)  # My Playbook /api/upb/*
app.include_router(education_router.router)
app.include_router(fundamentals_router.router)
app.include_router(analyst_router.router)
app.include_router(filings_router.router)
app.include_router(research_router.router)
app.include_router(expected_move_router.router)
app.include_router(earnings_intel_router.router)
app.include_router(ticker_logos_router.router)
app.include_router(broker_sync_router.router)  # broker-sync (SnapTrade) /api/j2/broker/*
app.include_router(desk_zoom_webhook_router.router)
app.include_router(signature_router.router)  # UCT Signature indicators /api/signature/*


# -- Massive WS consumer health endpoint --------------------------------
# Lightweight status route so an operator can verify the consumer thread
# is alive, connected, and ingesting trades. Wire to a uptime check or
# just curl it during the first-deploy validation window.
@app.get("/api/massive/status")
async def _massive_ws_status():
    """Live counters from the Massive WebSocket consumer thread."""
    try:
        from api.massive_ws_worker import get_status
        return get_status()
    except Exception as e:
        return {"error": str(e), "available": False}


# -- Massive Flat Files: status + manual backfill -----------------------
# Status route mirrors the WS one -- last run timestamp, success/fail counts,
# row counts written. The backfill route is for the operator to manually
# ingest a specific date (or range) -- useful for filling gaps if the cron
# failed, or for seeding history for baselines.
@app.get("/api/massive/flatfiles/status")
async def _massive_flatfiles_status():
    """Last-run state of the daily Flat Files ingester."""
    try:
        from api import massive_flatfiles_worker
        return massive_flatfiles_worker.get_status()
    except Exception as e:
        return {"error": str(e), "available": False}


@app.post("/api/admin/massive/flatfiles/run")
async def _massive_flatfiles_manual_run(date: str = None, force: bool = False):
    """Manually trigger Flat Files ingestion for a single date.

    date format: YYYY-MM-DD. If omitted, runs the standard daily walk
    (yesterday -> backwards LOOKBACK_DAYS).

    force=true ingests even if the date already has rows in FlowDB.
    The FlowDB dedup_key UNIQUE constraint silently handles overlap, so
    this is safe but wastes CPU.

    TODO: wrap with admin-role check (e.g. require_admin dependency)
    before exposing publicly. For now, ops-only -- don't link from UI.
    """
    try:
        from api import massive_flatfiles_worker
        if date is None:
            return massive_flatfiles_worker.daily_job()
        import datetime as _dt
        try:
            d = _dt.date.fromisoformat(date)
        except ValueError:
            return {"error": f"bad date format (want YYYY-MM-DD): {date!r}"}
        return massive_flatfiles_worker.process_date(d, force=force)
    except Exception as e:
        return {"error": str(e)}


@app.post("/api/admin/massive/flatfiles/backfill")
async def _massive_flatfiles_backfill(start: str, end: str, force: bool = False):
    """Backfill a date range. start/end are YYYY-MM-DD, inclusive.

    Synchronous -- for ranges over ~5 days this can take many minutes.
    Use sparingly (e.g. for initial baselines population).
    """
    try:
        from api import massive_flatfiles_worker
        import datetime as _dt
        try:
            s = _dt.date.fromisoformat(start)
            e = _dt.date.fromisoformat(end)
        except ValueError:
            return {"error": f"bad date format (want YYYY-MM-DD): start={start!r} end={end!r}"}
        return massive_flatfiles_worker.backfill_range(s, e, force=force)
    except Exception as e:
        return {"error": str(e)}

# Discord flow watchlist -- manual trigger endpoint
register_discord_routes(app)

# --- CSV routes: serve from app/public/ directly (fallback for legacy paths) --
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

@app.get("/api/admin/massive/diagnose")
async def _massive_diagnose():
    """One-shot diagnostic for the Massive enrichment pipeline.

    Returns: counts of OI snapshots per recent date, sample contract keys
    from the snapshot table, and the last 5 flow rows written by Massive
    sources (to verify MktCap/Sector/Color/OI are actually persisted).

    Use this after a deploy to verify enrichment is flowing end-to-end.
    """
    import sqlite3
    out = {}
    try:
        from api.flow_db import FlowDB
        db = FlowDB()
        with sqlite3.connect(db.db_path, timeout=10) as conn:
            # 1. OI snapshot counts per day (last 5 days)
            cur = conn.execute(
                "SELECT snap_date, COUNT(*) FROM contract_oi_snapshots "
                "GROUP BY snap_date ORDER BY snap_date DESC LIMIT 5"
            )
            out["oi_snapshots_by_date"] = [
                {"snap_date": r[0], "count": r[1]} for r in cur.fetchall()
            ]
            # 2. Sample contract keys from most recent snapshot date
            if out["oi_snapshots_by_date"]:
                latest = out["oi_snapshots_by_date"][0]["snap_date"]
                cur = conn.execute(
                    "SELECT contract_key, oi FROM contract_oi_snapshots "
                    "WHERE snap_date = ? ORDER BY oi DESC LIMIT 5",
                    (latest,)
                )
                out["oi_sample_keys"] = [
                    {"key": r[0], "oi": r[1]} for r in cur.fetchall()
                ]
            else:
                out["oi_sample_keys"] = []
            # 3. Last 5 flow rows (most recent writes)
            cur = conn.execute(
                "SELECT source, CreatedDate, CreatedTime, Symbol, CallPut, "
                "Strike, ExpirationDate, Volume, Premium, Color, MktCap, "
                "Sector, OI FROM flow ORDER BY id DESC LIMIT 5"
            )
            out["recent_flow_rows"] = []
            for r in cur.fetchall():
                out["recent_flow_rows"].append({
                    "source": r[0], "CreatedDate": r[1], "CreatedTime": r[2],
                    "Symbol": r[3], "CallPut": r[4], "Strike": r[5],
                    "ExpirationDate": r[6], "Volume": r[7], "Premium": r[8],
                    "Color": r[9], "MktCap": r[10], "Sector": r[11], "OI": r[12],
                })
            # 4. Color distribution today
            cur = conn.execute(
                "SELECT Color, COUNT(*) FROM flow WHERE CreatedDate = ? "
                "GROUP BY Color",
                (f"{__import__('datetime').date.today().month}/"
                 f"{__import__('datetime').date.today().day}/"
                 f"{__import__('datetime').date.today().year}",)
            )
            out["color_distribution_today"] = {
                r[0] or "(blank)": r[1] for r in cur.fetchall()
            }
    except Exception as e:
        out["error"] = str(e)
    return out


# -- Flow DB perf diagnostics + one-shot optimizer -----------------------
# Added 2026-07-01 during post-market debug of /api/live/massive/recent
# slowness (single-call 4s, diagnostic 43s for 11K rows). Suspicion: stale
# query-planner stats and/or bloated WAL. These two endpoints let an
# operator inspect and (POST) fix without shell access to the DB.
#
# /plan   -- READ-ONLY. Reports row count, EXPLAIN QUERY PLAN for the
#            /recent-style filter, and the current index list. Safe to
#            call any time. Use this first to confirm the diagnosis
#            (planner not using idx_flow_source_date -> SCAN TABLE flow).
#
# /optimize -- WRITES. Runs PRAGMA wal_checkpoint(TRUNCATE) then ANALYZE.
#              Both are safe operations that block briefly but do not
#              modify data. WAL checkpoint truncates the WAL file back
#              into the main DB (fixes bloat). ANALYZE rebuilds sqlite_stat1
#              (fixes stale planner stats). Idempotent; safe to re-run.
@app.get("/api/admin/flow/plan")
async def _flow_plan():
    """Read-only. Inspect DB size, query plan, and indexes on the flow table."""
    import sqlite3, time
    out = {}
    try:
        t0 = time.time()
        with sqlite3.connect("/data/flow.db", timeout=30) as conn:
            cur = conn.execute("SELECT COUNT(*) FROM flow")
            out["total_rows"] = cur.fetchone()[0]
            cur = conn.execute(
                "EXPLAIN QUERY PLAN SELECT * FROM flow "
                "WHERE source='stocks' AND CreatedDate='6/30/2026' "
                "AND Color IN ('MAGENTA','YELLOW')"
            )
            out["plan_recent_style"] = [list(r) for r in cur.fetchall()]
            cur = conn.execute(
                "EXPLAIN QUERY PLAN SELECT id, CreatedDate, CreatedTime "
                "FROM flow WHERE source='stocks' ORDER BY id DESC LIMIT 1"
            )
            out["plan_worker_status"] = [list(r) for r in cur.fetchall()]
            cur = conn.execute(
                "SELECT name, sql FROM sqlite_master "
                "WHERE type='index' AND tbl_name='flow'"
            )
            out["indexes"] = [{"name": r[0], "sql": r[1]} for r in cur.fetchall()]
            cur = conn.execute("PRAGMA journal_mode")
            out["journal_mode"] = cur.fetchone()[0]
            cur = conn.execute("PRAGMA page_size")
            out["page_size"] = cur.fetchone()[0]
            cur = conn.execute("PRAGMA page_count")
            out["page_count"] = cur.fetchone()[0]
            out["db_size_mb"] = round(out["page_size"] * out["page_count"] / (1024*1024), 1)
        out["elapsed_sec"] = round(time.time() - t0, 2)
    except Exception as e:
        out["error"] = str(e)
    return out


@app.post("/api/admin/flow/optimize")
async def _flow_optimize():
    """One-shot: checkpoint WAL, run ANALYZE, then re-inspect plan.

    Safe to re-run. No data mutation. Blocks briefly (typically <10s each).
    Report includes timings and the post-optimize query plan so you can
    verify at a glance whether the planner now uses idx_flow_source_date.
    """
    import sqlite3, time
    out = {}
    try:
        with sqlite3.connect("/data/flow.db", timeout=120) as conn:
            t0 = time.time()
            cur = conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            out["checkpoint_result"] = list(cur.fetchone() or [])
            out["checkpoint_sec"] = round(time.time() - t0, 2)

            t1 = time.time()
            conn.execute("ANALYZE")
            out["analyze_sec"] = round(time.time() - t1, 2)

            cur = conn.execute("SELECT COUNT(*) FROM flow")
            out["total_rows"] = cur.fetchone()[0]

            cur = conn.execute(
                "EXPLAIN QUERY PLAN SELECT * FROM flow "
                "WHERE source='stocks' AND CreatedDate='6/30/2026' "
                "AND Color IN ('MAGENTA','YELLOW')"
            )
            out["plan_recent_style"] = [list(r) for r in cur.fetchall()]

            cur = conn.execute(
                "EXPLAIN QUERY PLAN SELECT id, CreatedDate, CreatedTime "
                "FROM flow WHERE source='stocks' ORDER BY id DESC LIMIT 1"
            )
            out["plan_worker_status"] = [list(r) for r in cur.fetchall()]

            cur = conn.execute("PRAGMA page_count")
            out["page_count_post"] = cur.fetchone()[0]
    except Exception as e:
        out["error"] = str(e)
    return out


@app.post("/api/admin/massive/backfill-ticktest")
async def _massive_backfill_ticktest(target_date: str = None):
    """Apply tick-test classification retroactively to flow rows with Side=''.

    For each contract on target_date, walks chronologically and compares each
    event's Price to the previous event's Price. Uptick -> Side='A', downtick
    -> Side='B'. Also recomputes Color for rows that were stuck at WHITE
    because their OI was 0 at write time but Phase 1 has since backfilled it.

    Idempotent: only touches rows with Side=''. Safe to run multiple times.

    target_date: 'M/D/YYYY' format (e.g. '6/26/2026'). Defaults to today.
    """
    try:
        from api.backfill_ticktest import run_backfill
        stats = run_backfill(target_date)
        return {"ok": True, "stats": stats}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"ok": False, "error": str(e)}


@app.post("/api/admin/massive/rollback-gap-fill")
async def _massive_rollback_gap_fill(source: str = "indexes",
                                      target_date: str = "6/26/2026"):
    """Roll back rows previously inserted by /apply-gap-fill.

    Targets rows with the gap-fill fingerprint: empty enrichment fields
    (Spot=0, MktCap=0, Sector empty, OI=0). Worker writes always have at
    least some enrichment populated, so the fingerprint cleanly identifies
    gap-fill inserts without touching worker rows.

    Use when offline aggregation produced different bucket boundaries than
    the worker (especially on ultra-high-frequency contracts like SPX/SPXW
    where aggregation timing can split a burst into different-sized events).

    source: stocks or indexes
    target_date: M/D/YYYY
    """
    try:
        from api.rollback_gap_fill import run_rollback_gap_fill
        stats = run_rollback_gap_fill(source, target_date)
        try:
            from api.flow_router import bump_data_version
            stats["new_data_version"] = bump_data_version()
        except Exception as bump_err:
            stats["bump_warning"] = f"version bump failed: {bump_err}"
        return {"ok": True, "stats": stats}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"ok": False, "error": str(e)}


@app.post("/api/admin/massive/apply-gap-fill")
async def _massive_apply_gap_fill(fill_file: str = "fill-6-26-stocks.csv",
                                   source: str = "stocks"):
    """Apply gap-fill CSV to FlowDB — insert events the worker missed.

    Companion to build_gap_fill_csv.py. The script generates a BBS-format CSV
    offline from Massive's T+1 flat file using the same aggregation logic as
    the production worker. This endpoint reads that CSV and inserts only the
    rows that aren't already in FlowDB (matched by Symbol + CP + Strike +
    Exp + CreatedTime within ±60s).

    Rationale: WebSocket disconnects during market hours cause permanent data
    loss because Massive doesn't replay historical trades. A 30s disconnect
    can drop 50-100 events on liquid tickers and entire bursts on illiquid
    ones (e.g. the TWST 11:25 burst on 6/26 — $984K of bullish CALL flow
    missed entirely). The T+1 flat file is the same OPRA tape, delivered as
    a static file after close, and we can backfill from it.

    Workflow:
      1. Download T+1 flat file from Massive (~80MB gzipped)
      2. Run: python build_gap_fill_csv.py raw.csv.gz YYYY-MM-DD out.csv
         -> produces out-stocks.csv and out-indexes.csv
      3. Commit both CSVs to api/ in the repo
      4. POST this endpoint twice (source=stocks, source=indexes)
      5. Run /rebuild-color and /apply-cancel-patches to enrich the new rows

    New rows are inserted with empty Side and Color=WHITE — Phase 2i Side
    classification (build_patches.py) and rebuild-color handle enrichment.

    Idempotent: re-runs skip everything that's already there.

    fill_file: filename within /app/api/ directory
    source: 'stocks' or 'indexes' (use _stocks.csv with stocks, _indexes.csv with indexes)
    """
    try:
        import os
        api_dir = os.path.dirname(os.path.abspath(__file__))
        full_path = os.path.join(api_dir, fill_file)
        if not os.path.exists(full_path):
            return {"ok": False, "error": f"fill file not found: {full_path}",
                    "tip": "Commit the fill CSV to api/ directory"}
        if source not in ("stocks", "indexes"):
            return {"ok": False, "error": "source must be 'stocks' or 'indexes'"}
        from api.apply_gap_fill import run_apply_gap_fill
        stats = run_apply_gap_fill(full_path, source=source)
        # Make the dates set JSON-serializable
        if isinstance(stats.get("dates_touched"), set):
            stats["dates_touched"] = sorted(list(stats["dates_touched"]))
        try:
            from api.flow_router import bump_data_version
            stats["new_data_version"] = bump_data_version()
        except Exception as bump_err:
            stats["bump_warning"] = f"version bump failed: {bump_err}"
        return {"ok": True, "stats": stats}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"ok": False, "error": str(e)}


@app.post("/api/admin/massive/reclassify-source")
async def _massive_reclassify_source(target_date: str = "7/8/2026"):
    """Re-stamp source (+ StockEtf) for a date's rows using the SAME
    authoritative classifier the live worker uses: is_index_source(), which
    checks the Massive ticker_types cache first and falls back to the broad
    INDEX_SYMBOLS set.

    Fixes gap-filled days where ETFs (SPY/QQQ/IWM/TQQQ/SMH...) landed under
    source='stocks' because build_gap_fill_csv.py's INDEX_SYMBOLS is a stale,
    pure-index-only subset that never got the ETF additions massive_processor
    has. After this runs, backfilled rows match live classification exactly:
    SPY -> indexes, SPCX -> stocks (ticker_types overrides the stale
    INDEX_SYMBOLS entry), new ETFs like DRAM -> indexes. Run it right after
    apply-gap-fill (before rebuild-color is fine too; order doesn't matter).

    Idempotent -- only rewrites rows whose source/StockEtf is already wrong.
    """
    try:
        import sqlite3
        from api.massive_processor import is_index_source
        from api.flow_db import FlowDB
    except Exception as e:
        return {"ok": False, "error": f"import failed: {e}"}

    today = target_date
    stats = {"target_date": today, "symbols_seen": 0,
             "rows_moved_to_indexes": 0, "rows_moved_to_stocks": 0,
             "rows_updated": 0}
    try:
        db = FlowDB()
        with sqlite3.connect(db.db_path, timeout=30) as conn:
            syms = [r[0] for r in conn.execute(
                "SELECT DISTINCT Symbol FROM flow WHERE CreatedDate = ?",
                (today,)).fetchall() if r[0]]
            stats["symbols_seen"] = len(syms)
            for sym in syms:
                want_source = "indexes" if is_index_source(sym) else "stocks"
                want_etf = "ETF" if want_source == "indexes" else "STOCK"
                upd = conn.execute(
                    "UPDATE flow SET source = ?, StockEtf = ? "
                    "WHERE CreatedDate = ? AND Symbol = ? "
                    "AND (source != ? OR StockEtf != ?)",
                    (want_source, want_etf, today, sym, want_source, want_etf),
                )
                if upd.rowcount:
                    stats["rows_updated"] += upd.rowcount
                    if want_source == "indexes":
                        stats["rows_moved_to_indexes"] += upd.rowcount
                    else:
                        stats["rows_moved_to_stocks"] += upd.rowcount
            conn.commit()
    except Exception as e:
        import traceback
        return {"ok": False, "error": str(e),
                "traceback": traceback.format_exc().splitlines()[-4:]}
    return {"ok": True, "stats": stats}


@app.post("/api/admin/massive/backfill-mktcap")
async def _massive_backfill_mktcap(target_date: str = "7/10/2026"):
    """Fill missing/zero MktCap on a date's rows from the ticker's most-recent
    known cap in FlowDB history -- the SAME source the worker uses
    (_load_ticker_metadata / the get_mktcap_batch pattern).

    Fixes the permissive-default bug: _cap_band_key maps a missing cap to the
    'mid_small' band (lowest floors), which under-gates large/mega names whose
    cap didn't land at ingest -- e.g. a $499K RMD print clearing the $250K
    mid_small floor instead of its $500K large floor. Tier/premium-floor gating
    is computed at READ time from MktCap, so corrected caps take effect on the
    next read; no rebuild needed.

    Self-referential: a ticker's cap comes from any prior row where it was
    populated (BBS upload, earlier session). Fresh IPOs with no cap anywhere
    (e.g. CRCL) can't be resolved and stay 0 -- reported in unresolved_sample;
    those remain mid_small until a cap source populates them.

    Idempotent -- only writes rows whose MktCap is currently missing/0.
    """
    try:
        import sqlite3
        from api.flow_db import FlowDB
    except Exception as e:
        return {"ok": False, "error": f"import failed: {e}"}

    today = target_date
    stats = {"target_date": today, "symbols_missing": 0, "symbols_resolved": 0,
             "symbols_unresolved": 0, "rows_updated": 0, "unresolved_sample": []}
    try:
        db = FlowDB()
        with sqlite3.connect(db.db_path, timeout=30) as conn:
            missing = [r[0] for r in conn.execute(
                "SELECT DISTINCT Symbol FROM flow "
                "WHERE CreatedDate = ? AND Symbol IS NOT NULL AND Symbol != '' "
                "AND (MktCap IS NULL OR MktCap = '' OR MktCap = '0')",
                (today,)).fetchall() if r[0]]
            stats["symbols_missing"] = len(missing)
            if not missing:
                return {"ok": True, "stats": stats}

            # Most-recent NON-ZERO cap per symbol from FlowDB history (worker's
            # _load_ticker_metadata mc_sql pattern, verbatim).
            placeholders = ",".join("?" for _ in missing)
            mc_sql = f"""
                SELECT f.Symbol, f.MktCap
                FROM flow f
                INNER JOIN (
                    SELECT Symbol, MAX(id) AS max_id
                    FROM flow
                    WHERE Symbol IN ({placeholders})
                      AND MktCap IS NOT NULL AND MktCap != '' AND MktCap != '0'
                    GROUP BY Symbol
                ) latest ON f.id = latest.max_id
            """
            resolved = {}
            for sym, mc_raw in conn.execute(mc_sql, missing):
                if not sym:
                    continue
                try:
                    mc = int(float((mc_raw or "0").strip()))
                except (ValueError, TypeError):
                    mc = 0
                if mc > 0:
                    resolved[sym.strip().upper()] = mc

            for sym in missing:
                cap = resolved.get((sym or "").strip().upper())
                if not cap:
                    stats["symbols_unresolved"] += 1
                    if len(stats["unresolved_sample"]) < 15:
                        stats["unresolved_sample"].append(sym)
                    continue
                upd = conn.execute(
                    "UPDATE flow SET MktCap = ? "
                    "WHERE CreatedDate = ? AND Symbol = ? "
                    "AND (MktCap IS NULL OR MktCap = '' OR MktCap = '0')",
                    (str(cap), today, sym))
                if upd.rowcount:
                    stats["symbols_resolved"] += 1
                    stats["rows_updated"] += upd.rowcount
            conn.commit()
    except Exception as e:
        import traceback
        return {"ok": False, "error": str(e),
                "traceback": traceback.format_exc().splitlines()[-4:]}
    return {"ok": True, "stats": stats}


@app.post("/api/admin/massive/apply-cancel-patches")
async def _massive_apply_cancel_patches(patches_file: str = "patches-6-26-cancels.json",
                                         target_date: str = "6/26/2026"):
    """Apply cancel-class patches to FlowDB — tag matching rows as Color='ARB'.

    Companion to /backfill-from-patches but DISPOSITIVE: overwrites Color to
    'ARB' regardless of current value, because the cancel pattern wins over
    any prior WHITE/YELLOW/MAGENTA classification.

    Patches file is generated offline by build_cancel_patches.py which scans
    raw OPRA for:
      - cond in {202, 204}: always cancel-class
      - cond=231 on a contract that ALSO has cond=202/204: late report
        cascade (per coaching: 'use 231 as late report')
      - cond=231 on clean contracts (no 202/204 ever): preserved as BLOCK

    Output of build run for 6/26: 305 patches covering 160 contaminated
    contracts and ~$621M of cancel-class notional (including CAPR $4M
    14:06:30 'Correction' and the XLV cancel cascade).

    Matching: Symbol + CallPut + Strike (normalized) + ExpirationDate +
    CreatedTime within ±60s of patch time. Idempotent.

    patches_file: filename within /app/api/ directory (commit alongside repo)
    target_date: 'M/D/YYYY' format
    """
    try:
        import os
        api_dir = os.path.dirname(os.path.abspath(__file__))
        full_path = os.path.join(api_dir, patches_file)
        if not os.path.exists(full_path):
            return {"ok": False, "error": f"patches file not found: {full_path}",
                    "tip": "Commit the patches JSON to api/ directory"}
        from api.apply_cancel_patches import run_apply_cancel_patches
        stats = run_apply_cancel_patches(full_path, target_date)
        try:
            from api.flow_router import bump_data_version
            stats["new_data_version"] = bump_data_version()
        except Exception as bump_err:
            stats["bump_warning"] = f"version bump failed: {bump_err}"
        return {"ok": True, "stats": stats}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"ok": False, "error": str(e)}


@app.post("/api/admin/massive/backfill-from-patches")
async def _massive_backfill_from_patches(patches_file: str = "patches-6-25.json",
                                          target_date: str = "6/25/2026"):
    """Apply offline-computed patches to production FlowDB.

    The patches JSON is generated offline by reprocessing raw OPRA with
    Phase 2i (raw T-print tick test) for higher Side classification
    accuracy (96% vs ~70% with event-to-event). The patches contain the
    optimal Side and Color for each event, keyed by Symbol|CP|Strike|Exp|Time.

    This endpoint reads the patches file from /app/api/ (committed to repo)
    and applies updates to matching production rows within a 60-sec window.

    Validated 6/25 offline: production page should jump from 210 confirmed
    to ~2,400 confirmed after running this.

    Idempotent: only upgrades Side/Color (never downgrades).

    patches_file: filename within /app/api/ directory
    target_date: 'M/D/YYYY' format
    """
    try:
        import os
        # Look for the patches file in api/ directory
        api_dir = os.path.dirname(os.path.abspath(__file__))
        full_path = os.path.join(api_dir, patches_file)
        if not os.path.exists(full_path):
            return {"ok": False, "error": f"patches file not found: {full_path}",
                    "tip": "Commit the patches JSON to api/ directory in your repo"}
        from api.backfill_from_patches import run_patches_backfill
        stats = run_patches_backfill(full_path, target_date)
        try:
            from api.flow_router import bump_data_version
            stats["new_data_version"] = bump_data_version()
        except Exception as bump_err:
            stats["bump_warning"] = f"version bump failed: {bump_err}"
        return {"ok": True, "stats": stats}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"ok": False, "error": str(e)}


@app.post("/api/admin/massive/rebuild-color")
async def _massive_rebuild_color(target_date: str = "6/26/2026"):
    """Recompute Color for rows that landed WHITE because OI was 0 at write time.

    Production worker writes flow rows in real time; OI is fetched on-demand by
    oi_fetch_manager and may lag the write by 20+s. Rows that land with OI=0
    stay Color=WHITE forever, even if by EOD their OI has been backfilled AND
    cumulative volume on the contract has long since exceeded OI.

    This endpoint walks every row on target_date, groups by contract, sorts
    chronologically, computes running cumulative volume, and upgrades Color:
      cum >= 1.5 * OI  ->  MAGENTA
      cum  >    OI     ->  YELLOW
      otherwise         ->  WHITE (no change)

    Idempotent: only upgrades (WHITE -> YELLOW/MAGENTA). Never downgrades.
    Safe to re-run.

    target_date: 'M/D/YYYY' format (e.g. '6/26/2026'). Required.
    """
    try:
        from api.color_rebuild import run_color_rebuild
        stats = run_color_rebuild(target_date)
        try:
            from api.flow_router import bump_data_version
            stats["new_data_version"] = bump_data_version()
        except Exception as bump_err:
            stats["bump_warning"] = f"version bump failed: {bump_err}"
        return {"ok": True, "stats": stats}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"ok": False, "error": str(e)}


@app.post("/api/admin/massive/normalize-sweep-sides")
async def _massive_normalize_sweep_sides(target_date: str = None):
    """Normalize empty-side SWEEP rows to Side='A' (Option 3 at storage).

    Rationale: A SWEEP is by definition an aggressive market order that
    crosses the spread. Market microstructure makes them ~85%+ buyer-
    initiated. When the live NBBO tick-test can't classify (fast markets,
    quote gaps), rows land in flow.db with Side='' but should still surface
    as directional bull signal.

    The /live-massive path handles this via _derive_direction's Option 3
    rescue rule (added 2026-07-03). But OptionsFlow's client-side clustering
    reads Side directly from flow.db raw -- it never sees the read-time
    rescue. Normalizing at storage keeps both views consistent without
    duplicating rescue logic in JavaScript.

    Only applies to Type=SWEEP. BLOCKs stay empty -- an unclassifiable
    BLOCK could be dealer facilitation, portfolio rebalance, or hedge,
    not necessarily directional signal.

    Idempotent: only updates empty->A (never overwrites A, AA, B, BB).
    Safe to re-run.

    target_date: 'M/D/YYYY' format (e.g. '7/2/2026'). If omitted,
    normalizes across ALL dates in flow.db.
    """
    try:
        import sqlite3, os
        db_path = os.environ.get("FLOW_DB_PATH", "/data/flow.db")
        conn = sqlite3.connect(db_path, timeout=30)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        if target_date:
            cursor = conn.execute("""
                UPDATE flow SET Side = 'A'
                WHERE Type = 'SWEEP'
                  AND (Side = '' OR Side IS NULL)
                  AND CreatedDate = ?
            """, (target_date,))
        else:
            cursor = conn.execute("""
                UPDATE flow SET Side = 'A'
                WHERE Type = 'SWEEP'
                  AND (Side = '' OR Side IS NULL)
            """)
        rows_updated = cursor.rowcount
        conn.commit()
        conn.close()
        # Bump data-version so client caches invalidate
        try:
            from api.flow_router import bump_data_version
            new_ver = bump_data_version()
        except Exception:
            new_ver = None
        return {
            "ok": True,
            "stats": {
                "target_date": target_date or "ALL",
                "rows_normalized": rows_updated,
                "new_data_version": new_ver,
            }
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"ok": False, "error": str(e)}


@app.post("/api/admin/massive/filter-arb")
async def _massive_filter_arb(target_date: str = "6/26/2026"):
    """Tag arbitrage clusters as Color='ARB'.

    The rule: group rows by (Symbol, CreatedDate, CreatedTime [exact second]).
    If a group has n>=4 events AND >=2 distinct (CallPut, Strike, Exp) combos,
    every row in the group is tagged Color='ARB'.

    Catches structured noise like:
      - SPX box spreads ($1.1B at 11:35:15 — mixed CP across strikes)
      - LULU multi-strike position management ($54M at 15:46:16, 5 PUT strikes)
      - MU same-instant CALL/PUT structures ($386M at 12:28:19)

    Preserves legitimate same-contract sweeps that fragment across exchange
    venues — those have only ONE distinct (CP, Strike, Exp) tuple even at 8+
    same-second prints (e.g. QQQ PUT $630 8/21 at 11:26:21).

    Idempotent. Dispositive: overwrites prior YELLOW/MAGENTA classifications
    since the cluster pattern wins over per-row volume vs OI.

    Recommended order:
      1. POST /api/admin/massive/filter-arb?target_date=X     (this endpoint)
      2. POST /api/admin/massive/rebuild-color?target_date=X  (touches WHITE only)

    target_date: 'M/D/YYYY' format. Required.
    """
    try:
        from api.cluster_filter import run_cluster_filter
        stats = run_cluster_filter(target_date)
        try:
            from api.flow_router import bump_data_version
            stats["new_data_version"] = bump_data_version()
        except Exception as bump_err:
            stats["bump_warning"] = f"version bump failed: {bump_err}"
        return {"ok": True, "stats": stats}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"ok": False, "error": str(e)}


@app.get("/api/admin/massive/cluster-debug")
async def _massive_cluster_debug(target_date: str = "6/26/2026",
                                  symbol: str = "LULU",
                                  hour: int = 15,
                                  minute_start: int = 45,
                                  minute_end: int = 47):
    """Diagnostic for cluster_filter misses.

    Dumps every flow row for `symbol` on `target_date` between
    `hour:minute_start` and `hour:minute_end` so we can see exactly what
    landed in FlowDB and why the cluster filter did or didn't catch it.

    Default args reproduce the LULU 15:46 investigation.

    Returns row-by-row CreatedTime/CallPut/Strike/Exp/Color/Volume so we
    can manually verify the (Symbol, CreatedTime) grouping the filter uses.
    """
    import sqlite3
    out = {"target_date": target_date, "symbol": symbol,
           "window": f"{hour}:{minute_start:02d}-{hour}:{minute_end:02d}"}
    try:
        from api.flow_db import FlowDB
        db = FlowDB()
        with sqlite3.connect(db.db_path, timeout=10) as conn:
            cur = conn.cursor()
            # Pull all rows for this symbol on this date
            cur.execute("""
                SELECT id, CreatedTime, CallPut, Strike, ExpirationDate,
                       Color, Volume, OI, Side, Type, Premium
                FROM flow
                WHERE CreatedDate = ? AND Symbol = ?
                ORDER BY CreatedTime, id
            """, (target_date, symbol))

            all_rows = []
            for r in cur.fetchall():
                t_str = r[1] or ""
                # Try to parse hour from "H:MM:SS AM/PM"
                try:
                    parts = t_str.strip().split(":")
                    h = int(parts[0])
                    m = int(parts[1])
                    is_pm = t_str.upper().endswith("PM")
                    is_am = t_str.upper().endswith("AM")
                    if is_pm and h != 12: h += 12
                    elif is_am and h == 12: h = 0
                except (ValueError, IndexError):
                    h = -1
                    m = -1
                all_rows.append({
                    "id": r[0], "time": t_str, "hour": h, "min": m,
                    "cp": r[2], "strike": r[3], "exp": r[4],
                    "color": r[5], "volume": r[6], "oi": r[7],
                    "side": r[8], "type": r[9], "premium": r[10],
                })

            out["total_rows_on_date"] = len(all_rows)

            # Filter to window
            in_window = [r for r in all_rows
                         if r["hour"] == hour
                         and minute_start <= r["min"] <= minute_end]
            out["rows_in_window"] = len(in_window)
            out["window_detail"] = in_window

            # Group by exact CreatedTime within the window and report cluster math
            from collections import defaultdict
            groups = defaultdict(list)
            for r in in_window:
                groups[r["time"]].append(r)
            out["groups_in_window"] = []
            for t, rows in sorted(groups.items()):
                # Compute the cluster filter's distinct count
                contracts = set()
                for rr in rows:
                    try:
                        sk = float(rr["strike"]) if rr["strike"] else 0.0
                    except (ValueError, TypeError):
                        sk = 0.0
                    contracts.add((rr["cp"], sk, rr["exp"]))
                out["groups_in_window"].append({
                    "time": t,
                    "n_rows": len(rows),
                    "n_distinct_contracts": len(contracts),
                    "would_be_tagged_arb": len(rows) >= 4 and len(contracts) >= 2,
                    "row_ids": [rr["id"] for rr in rows],
                    "row_colors": [rr["color"] for rr in rows],
                })

    except Exception as e:
        import traceback
        traceback.print_exc()
        out["error"] = str(e)
    return out


@app.get("/api/admin/massive/color-debug")
async def _massive_color_debug(target_date: str = "6/26/2026"):
    """Diagnostic for why rebuild-color produced zero upgrades.

    Returns:
      - Per-row summary: rows scanned, Color distribution, Volume parse stats
      - Top contracts by SUM(Volume) and their OI / cum/OI ratio
      - 3 known-large contracts (MU PUT 1000 8/21, TSM PUT 400 9/18, BE CALL 420 12/18)
        with their full row-by-row Volume + OI listing
    """
    import sqlite3
    out = {"target_date": target_date}
    try:
        from api.flow_db import FlowDB
        db = FlowDB()
        with sqlite3.connect(db.db_path, timeout=10) as conn:
            cur = conn.cursor()
            # 1. Row count + Color distribution
            cur.execute("SELECT COUNT(*) FROM flow WHERE CreatedDate = ?", (target_date,))
            out["total_rows"] = cur.fetchone()[0]

            cur.execute(
                "SELECT Color, COUNT(*) FROM flow WHERE CreatedDate = ? GROUP BY Color",
                (target_date,)
            )
            out["color_distribution"] = {(r[0] or "(blank)"): r[1] for r in cur.fetchall()}

            # 2. Volume column parse stats — how many are blank/zero/positive?
            cur.execute("""
                SELECT
                    SUM(CASE WHEN Volume IS NULL OR TRIM(Volume) = '' THEN 1 ELSE 0 END) AS blank_vol,
                    SUM(CASE WHEN CAST(Volume AS INTEGER) = 0 THEN 1 ELSE 0 END) AS zero_vol,
                    SUM(CASE WHEN CAST(Volume AS INTEGER) > 0 THEN 1 ELSE 0 END) AS positive_vol,
                    SUM(CAST(Volume AS INTEGER)) AS total_volume,
                    AVG(CAST(Volume AS REAL)) AS avg_volume,
                    MAX(CAST(Volume AS INTEGER)) AS max_volume
                FROM flow WHERE CreatedDate = ?
            """, (target_date,))
            r = cur.fetchone()
            out["volume_stats"] = {
                "blank": r[0], "zero": r[1], "positive": r[2],
                "total_volume_sum": r[3], "avg_volume": round(r[4] or 0, 2),
                "max_volume": r[5],
            }

            # 3. OI column parse stats
            cur.execute("""
                SELECT
                    SUM(CASE WHEN OI IS NULL OR TRIM(OI) = '' THEN 1 ELSE 0 END) AS blank_oi,
                    SUM(CASE WHEN CAST(OI AS INTEGER) = 0 THEN 1 ELSE 0 END) AS zero_oi,
                    SUM(CASE WHEN CAST(OI AS INTEGER) > 0 THEN 1 ELSE 0 END) AS positive_oi
                FROM flow WHERE CreatedDate = ?
            """, (target_date,))
            r = cur.fetchone()
            out["oi_stats"] = {"blank": r[0], "zero": r[1], "positive": r[2]}

            # 4. Source breakdown
            cur.execute(
                "SELECT source, COUNT(*) FROM flow WHERE CreatedDate = ? GROUP BY source",
                (target_date,)
            )
            out["source_distribution"] = {r[0]: r[1] for r in cur.fetchall()}

            # 5. Top 10 contracts by SUM(Volume) — see if cum vol is actually meaningful
            cur.execute("""
                SELECT Symbol, CallPut, Strike, ExpirationDate,
                       COUNT(*) AS n_rows,
                       SUM(CAST(Volume AS INTEGER)) AS cum_vol,
                       MAX(CAST(OI AS INTEGER)) AS oi_max,
                       MIN(CAST(OI AS INTEGER)) AS oi_min
                FROM flow
                WHERE CreatedDate = ?
                GROUP BY Symbol, CallPut, Strike, ExpirationDate
                ORDER BY cum_vol DESC
                LIMIT 15
            """, (target_date,))
            out["top_contracts_by_cum_volume"] = []
            for r in cur.fetchall():
                ratio = (r[5] / r[6]) if r[6] and r[6] > 0 else None
                out["top_contracts_by_cum_volume"].append({
                    "symbol": r[0], "cp": r[1], "strike": r[2], "exp": r[3],
                    "n_rows": r[4], "cum_volume": r[5],
                    "oi_max": r[6], "oi_min": r[7],
                    "cum_over_oi_ratio": round(ratio, 3) if ratio is not None else None,
                })

            # 6. Inspect 3 known large-flow contracts row by row
            samples = [
                ("MU", "PUT", "1000", "8/21/2026"),
                ("TSM", "PUT", "400", "9/18/2026"),
                ("BE", "CALL", "420", "12/18/2026"),
            ]
            out["sample_contracts"] = {}
            for sym, cp, strike, exp in samples:
                key = f"{sym} {cp} {strike} {exp}"
                cur.execute("""
                    SELECT CreatedTime, Volume, OI, Color, Side, Type
                    FROM flow
                    WHERE CreatedDate = ?
                      AND Symbol = ? AND CallPut = ?
                      AND CAST(Strike AS REAL) = CAST(? AS REAL)
                      AND ExpirationDate = ?
                    ORDER BY CreatedTime
                """, (target_date, sym, cp, strike, exp))
                rows = cur.fetchall()
                cum = 0
                detail = []
                for rr in rows:
                    vol = 0
                    try: vol = int(float(rr[1])) if rr[1] not in (None, "") else 0
                    except: pass
                    cum += vol
                    oi = 0
                    try: oi = int(float(rr[2])) if rr[2] not in (None, "") else 0
                    except: pass
                    detail.append({
                        "time": rr[0], "vol": rr[1], "vol_int": vol, "cum": cum,
                        "OI": rr[2], "color": rr[3], "side": rr[4], "type": rr[5],
                    })
                out["sample_contracts"][key] = {
                    "n_rows": len(rows),
                    "total_cum_volume": cum,
                    "rows": detail,
                }

    except Exception as e:
        import traceback
        traceback.print_exc()
        out["error"] = str(e)
    return out


@app.post("/api/admin/ticker-types/sync")
async def _ticker_types_sync(market: str = "stocks"):
    """Sync ticker reference data from Massive into the local cache.

    Pulls all active tickers for the given market (paginated), normalizes
    each ticker's type to STOCK/ETF/INDEX/OTHER, and upserts into the
    ticker_types table.

    market: 'stocks' (default — includes CS, ETF, ETN, ADRC, etc.) or
            'indices' (for SPX/NDX/RUT and other indices)

    Run BOTH markets for full coverage:
      POST /api/admin/ticker-types/sync?market=stocks
      POST /api/admin/ticker-types/sync?market=indices

    Idempotent — re-running updates existing rows with latest data.
    Requires MASSIVE_API_KEY env var.
    """
    try:
        from api.ticker_types import sync_from_massive
        stats = sync_from_massive(market=market)
        return {"ok": True, "stats": stats}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"ok": False, "error": str(e)}


@app.post("/api/admin/ticker-types/backfill")
async def _ticker_types_backfill(target_date: str = None):
    """Apply cached ticker classifications to existing flow rows.

    Updates the `source` column on flow rows:
      asset_type == ETF/INDEX  -> source = 'indexes'
      asset_type == STOCK      -> source = 'stocks'

    target_date: 'M/D/YYYY' to limit scope, or omit for all-time.

    This is the migration that moves DRAM/AAL/etc. into their correct tabs
    after the cache is populated by /api/admin/ticker-types/sync.

    Idempotent — safe to re-run. Returns count of moved rows by direction.
    """
    try:
        from api.ticker_types import backfill_flow_source
        stats = backfill_flow_source(target_date=target_date)
        try:
            from api.flow_router import bump_data_version
            stats["new_data_version"] = bump_data_version()
        except Exception as bump_err:
            stats["bump_warning"] = f"version bump failed: {bump_err}"
        return {"ok": True, "stats": stats}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"ok": False, "error": str(e)}


@app.get("/api/admin/ticker-types/lookup")
async def _ticker_types_lookup(ticker: str):
    """Look up a single ticker's classification.

    Returns the raw cache row including asset_type, raw_type, name, etc.
    Useful for spot-checking the sync results or debugging misclassifications.
    """
    import sqlite3
    try:
        from api.ticker_types import DB_PATH, ensure_schema
        conn = sqlite3.connect(DB_PATH, timeout=10)
        try:
            ensure_schema(conn)
            cur = conn.execute("""
                SELECT ticker, asset_type, raw_type, name, primary_exchange,
                       market, active, last_synced
                FROM ticker_types WHERE ticker = ?
            """, (ticker.upper().strip(),))
            row = cur.fetchone()
            if not row:
                return {"ok": True, "ticker": ticker.upper(), "found": False,
                        "asset_type": "UNKNOWN"}
            return {
                "ok": True, "found": True,
                "ticker": row[0], "asset_type": row[1], "raw_type": row[2],
                "name": row[3], "primary_exchange": row[4], "market": row[5],
                "active": bool(row[6]), "last_synced": row[7],
            }
        finally:
            conn.close()
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"ok": False, "error": str(e)}


@app.get("/api/admin/ticker-types/stats")
async def _ticker_types_stats():
    """Cache health: counts by asset_type + most recent sync time."""
    import sqlite3
    try:
        from api.ticker_types import DB_PATH, ensure_schema
        conn = sqlite3.connect(DB_PATH, timeout=10)
        try:
            ensure_schema(conn)
            cur = conn.execute("""
                SELECT asset_type, COUNT(*) FROM ticker_types
                GROUP BY asset_type ORDER BY COUNT(*) DESC
            """)
            by_type = {r[0]: r[1] for r in cur.fetchall()}
            cur = conn.execute("SELECT MAX(last_synced) FROM ticker_types")
            last_synced = cur.fetchone()[0]
            cur = conn.execute("SELECT COUNT(*) FROM ticker_types")
            total = cur.fetchone()[0]
            return {
                "ok": True,
                "total_tickers": total,
                "by_asset_type": by_type,
                "last_synced": last_synced,
            }
        finally:
            conn.close()
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"ok": False, "error": str(e)}


# ── Bulk ETF/INDEX symbol list ────────────────────────────────────────────────
# Public, cacheable list of every ticker classified as ETF or INDEX in the
# ticker_types cache. Used by the OptionsFlow frontend to filter ETFs out of
# the Stocks tab (and vice versa) without maintaining a hardcoded list.
#
# Payload shape:
#   {"ok": True, "symbols": ["SPY","QQQ",...], "count": N, "last_synced": "..."}
#
# Response is small (~150KB gzipped for ~18k symbols) and stable between sync
# runs, so we set an aggressive Cache-Control header to let Cloudflare cache
# it at the edge. Invalidation happens naturally when the next sync bumps
# last_synced -- clients can key off that if they need to force-refresh.
_ETF_INDEX_SYMBOLS_CACHE = {"payload": None, "cached_at": None}

@app.get("/api/ticker-types/etf-index-symbols")
async def _ticker_types_etf_index_symbols():
    """Return every ticker classified as ETF or INDEX (bulk).

    Cached in-process for 5 minutes to avoid hitting SQLite on every page
    load. Cache invalidates on sync/backfill or via ?fresh=1.
    """
    import sqlite3, time
    from fastapi.responses import JSONResponse
    try:
        # In-process cache: 5min TTL
        now = time.time()
        cached = _ETF_INDEX_SYMBOLS_CACHE.get("payload")
        cached_at = _ETF_INDEX_SYMBOLS_CACHE.get("cached_at") or 0
        if cached is not None and (now - cached_at) < 300:
            resp = JSONResponse(cached)
            resp.headers["Cache-Control"] = "public, max-age=300"
            return resp

        from api.ticker_types import DB_PATH, ensure_schema
        conn = sqlite3.connect(DB_PATH, timeout=10)
        try:
            ensure_schema(conn)
            cur = conn.execute("""
                SELECT ticker FROM ticker_types
                WHERE asset_type IN ('ETF', 'INDEX')
                ORDER BY ticker
            """)
            symbols = [r[0] for r in cur.fetchall()]
            cur = conn.execute("SELECT MAX(last_synced) FROM ticker_types")
            last_synced = cur.fetchone()[0]
            payload = {
                "ok": True,
                "symbols": symbols,
                "count": len(symbols),
                "last_synced": last_synced,
            }
            _ETF_INDEX_SYMBOLS_CACHE["payload"] = payload
            _ETF_INDEX_SYMBOLS_CACHE["cached_at"] = now
            resp = JSONResponse(payload)
            resp.headers["Cache-Control"] = "public, max-age=300"
            return resp
        finally:
            conn.close()
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"ok": False, "error": str(e), "symbols": []}


@app.get("/api/admin/oi/lookup-key")
async def _oi_lookup_key(key: str):
    """Look up all snapshots for a specific contract_key. Debugging tool
    to verify the exact format the endpoint should be matching against.

    Example: /api/admin/oi/lookup-key?key=BE|C|370.0|9/18/2026

    Also tries LIKE variations to catch near-misses (different case,
    missing decimals, etc.)
    """
    import sqlite3
    from fastapi.responses import JSONResponse
    if not key:
        return {"ok": False, "error": "key parameter required"}
    out = {"query_key": key}
    try:
        from api.flow_db import FlowDB
        db = FlowDB()
        with sqlite3.connect(db.db_path, timeout=15) as conn:
            conn.execute("PRAGMA query_only = 1")
            # Exact match
            cur = conn.execute(
                "SELECT snap_date, oi FROM contract_oi_snapshots "
                "WHERE contract_key = ? ORDER BY snap_date",
                (key,)
            )
            exact = [{"snap_date": r[0], "oi": r[1]} for r in cur.fetchall()]
            out["exact_match"] = {"count": len(exact), "rows": exact}

            # LIKE fuzzy match — extract prefix before the strike
            parts = key.split("|")
            if len(parts) >= 3:
                sym_cp = f"{parts[0]}|{parts[1]}|"
                strike_prefix = parts[2].split(".")[0] if "." in parts[2] else parts[2]
                # Look for any keys starting with SYM|CP| and containing strike
                cur = conn.execute(
                    "SELECT DISTINCT contract_key FROM contract_oi_snapshots "
                    "WHERE contract_key LIKE ? "
                    "AND contract_key LIKE ? "
                    "LIMIT 20",
                    (f"{sym_cp}%", f"%{strike_prefix}%")
                )
                out["similar_keys"] = [r[0] for r in cur.fetchall()]
        return JSONResponse(out)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"ok": False, "error": str(e), "partial": out}


@app.get("/api/admin/oi/zero-analysis")
async def _oi_zero_analysis(ticker: str = ""):
    """Analyze OI=0 patterns in contract_oi_snapshots.

    Some tickers have all-zero OI in snapshots (BE, FRMI observed) while
    others populate correctly (SPCX, MU). This helps identify whether the
    zero writes are:
      - Concentrated on specific tickers (systemic issue for those tickers)
      - Concentrated on specific dates (cron misfire on those days)
      - Concentrated on specific strike types (deep OTM/ITM issue)

    Query params:
      ?ticker=BE  → focus analysis on one ticker
      (default)   → aggregate stats across the whole table

    URL: /api/admin/oi/zero-analysis?ticker=BE
    """
    import sqlite3
    from fastapi.responses import JSONResponse
    out = {}
    try:
        from api.flow_db import FlowDB
        db = FlowDB()
        with sqlite3.connect(db.db_path, timeout=30) as conn:
            conn.execute("PRAGMA query_only = 1")
            # Overall zero rate
            cur = conn.execute(
                "SELECT COUNT(*), SUM(CASE WHEN oi=0 THEN 1 ELSE 0 END) "
                "FROM contract_oi_snapshots"
            )
            total, zeros = cur.fetchone()
            out["overall"] = {
                "total_rows": total,
                "zero_oi_rows": zeros,
                "zero_pct": round(zeros / total * 100, 1) if total else 0,
            }

            # If ticker filter specified, focus on it
            if ticker:
                t = ticker.upper().strip()
                cur = conn.execute(
                    "SELECT contract_key, snap_date, oi FROM contract_oi_snapshots "
                    "WHERE contract_key LIKE ? "
                    "ORDER BY snap_date DESC, contract_key LIMIT 30",
                    (f"{t}|%",)
                )
                out["ticker_samples"] = [
                    {"key": r[0], "snap_date": r[1], "oi": r[2]}
                    for r in cur.fetchall()
                ]
                cur = conn.execute(
                    "SELECT COUNT(*), SUM(CASE WHEN oi=0 THEN 1 ELSE 0 END) "
                    "FROM contract_oi_snapshots WHERE contract_key LIKE ?",
                    (f"{t}|%",)
                )
                t_total, t_zeros = cur.fetchone()
                out["ticker_stats"] = {
                    "ticker": t,
                    "total_rows": t_total,
                    "zero_oi_rows": t_zeros,
                    "zero_pct": round(t_zeros / t_total * 100, 1) if t_total else 0,
                }
            else:
                # Aggregate: which tickers have >90% zero-OI?
                cur = conn.execute("""
                    SELECT
                        substr(contract_key, 1, instr(contract_key, '|') - 1) AS ticker,
                        COUNT(*) AS total,
                        SUM(CASE WHEN oi=0 THEN 1 ELSE 0 END) AS zeros,
                        ROUND(SUM(CASE WHEN oi=0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS zero_pct
                    FROM contract_oi_snapshots
                    GROUP BY ticker
                    HAVING zero_pct >= 90
                    ORDER BY zero_pct DESC, total DESC
                    LIMIT 30
                """)
                out["all_zero_tickers"] = [
                    {"ticker": r[0], "total": r[1], "zeros": r[2], "zero_pct": r[3]}
                    for r in cur.fetchall()
                ]
                # Also: which tickers are healthy (< 10% zero)?
                cur = conn.execute("""
                    SELECT
                        substr(contract_key, 1, instr(contract_key, '|') - 1) AS ticker,
                        COUNT(*) AS total,
                        SUM(CASE WHEN oi=0 THEN 1 ELSE 0 END) AS zeros,
                        ROUND(SUM(CASE WHEN oi=0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS zero_pct
                    FROM contract_oi_snapshots
                    GROUP BY ticker
                    HAVING zero_pct < 10 AND total > 50
                    ORDER BY total DESC
                    LIMIT 15
                """)
                out["healthy_tickers"] = [
                    {"ticker": r[0], "total": r[1], "zeros": r[2], "zero_pct": r[3]}
                    for r in cur.fetchall()
                ]

            return JSONResponse(out)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"ok": False, "error": str(e), "partial": out}


@app.get("/api/admin/oi/table-diagnose")
async def _oi_table_diagnose():
    """Lightweight diagnostic for contract_oi_snapshots — replaces the slower
    massive/diagnose for this specific table.

    Returns row count, existing indexes, and a few sample contract_key values
    so we can see what format they're stored in. All queries use ~30s timeout
    so we don't hit Cloudflare's 100s limit even on locked/slow DBs.

    URL: /api/admin/oi/table-diagnose
    """
    import sqlite3
    from fastapi.responses import JSONResponse
    out = {}
    try:
        from api.flow_db import FlowDB
        db = FlowDB()
        # Longer timeout in case cron is holding a write lock
        with sqlite3.connect(db.db_path, timeout=30) as conn:
            # Read-only optimization
            conn.execute("PRAGMA query_only = 1")
            # 1. Row count (this is the query most likely to be slow if
            #    the table is huge — do it first so we know if it hangs)
            try:
                cur = conn.execute("SELECT COUNT(*) FROM contract_oi_snapshots")
                out["row_count"] = cur.fetchone()[0]
            except Exception as e:
                out["row_count_error"] = str(e)

            # 2. Existing indexes on the table
            try:
                cur = conn.execute(
                    "SELECT name, sql FROM sqlite_master "
                    "WHERE type='index' AND tbl_name='contract_oi_snapshots'"
                )
                out["indexes"] = [{"name": r[0], "sql": r[1]} for r in cur.fetchall()]
            except Exception as e:
                out["indexes_error"] = str(e)

            # 3. Sample contract_key values (5 recent) — critical for format
            #    detection. Order by snap_date DESC so we see fresh snapshots.
            try:
                cur = conn.execute(
                    "SELECT contract_key, snap_date, oi "
                    "FROM contract_oi_snapshots "
                    "ORDER BY snap_date DESC LIMIT 5"
                )
                out["sample_keys"] = [
                    {"key": r[0], "snap_date": r[1], "oi": r[2]}
                    for r in cur.fetchall()
                ]
            except Exception as e:
                out["sample_keys_error"] = str(e)

            # 4. Distinct snap_dates (how far back does data go)
            try:
                cur = conn.execute(
                    "SELECT snap_date, COUNT(*) FROM contract_oi_snapshots "
                    "GROUP BY snap_date ORDER BY snap_date DESC LIMIT 10"
                )
                out["snap_dates"] = [
                    {"snap_date": r[0], "count": r[1]} for r in cur.fetchall()
                ]
            except Exception as e:
                out["snap_dates_error"] = str(e)

        return JSONResponse(out)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"ok": False, "error": str(e), "partial": out}


@app.post("/api/admin/oi/create-indexes")
async def _oi_create_indexes():
    """One-shot: create missing indexes on contract_oi_snapshots for fast lookup.

    Safe to call multiple times — uses CREATE INDEX IF NOT EXISTS. Only
    creates the indexes we know we need for the /api/oi/confirmation-map
    endpoint to work fast.

    URL: POST /api/admin/oi/create-indexes
    """
    import sqlite3, time
    from fastapi.responses import JSONResponse
    try:
        from api.flow_db import FlowDB
        db = FlowDB()
        with sqlite3.connect(db.db_path, timeout=60) as conn:
            results = []
            for idx_name, ddl in [
                ("idx_oi_snapshots_key",
                 "CREATE INDEX IF NOT EXISTS idx_oi_snapshots_key "
                 "ON contract_oi_snapshots(contract_key)"),
                ("idx_oi_snapshots_key_date",
                 "CREATE INDEX IF NOT EXISTS idx_oi_snapshots_key_date "
                 "ON contract_oi_snapshots(contract_key, snap_date)"),
            ]:
                t0 = time.time()
                try:
                    conn.execute(ddl)
                    conn.commit()
                    results.append({
                        "index": idx_name, "ok": True,
                        "elapsed_sec": round(time.time() - t0, 2),
                    })
                except Exception as e:
                    results.append({
                        "index": idx_name, "ok": False, "error": str(e),
                        "elapsed_sec": round(time.time() - t0, 2),
                    })
            # Confirm what's there now
            cur = conn.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='index' AND tbl_name='contract_oi_snapshots'"
            )
            existing = [r[0] for r in cur.fetchall()]
            return JSONResponse({
                "ok": True,
                "created": results,
                "indexes_now": existing,
            })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"ok": False, "error": str(e)}


@app.post("/api/oi/confirmation-map")
async def _oi_confirmation_map(request: Request,
                               _user: dict = Depends(get_current_user)):
    # Gated 2026-07-26 (boot-time auth-surface audit). Read-only and already
    # bounded at 5,000 contracts, so this is not the flow-reconcile class of
    # hole — but it is a members-only Search feature that was answering batched
    # OI-snapshot queries for anonymous callers, and there is no reason for it
    # to be public. The caller is OptionsFlow's Search tab, which is behind
    # AuthGuard and issues a same-origin fetch (cookies sent by default), so
    # the session cookie is always present for a legitimate user.
    """Return OI-growth confirmation status for a batch of contracts.

    Used by Search to filter historical flow to only trades whose contract
    had subsequent OI growth (i.e. real position adds vs same-day churn).
    For each contract, we look at OI snapshots within `window_days` of the
    trade's `first_trade_date` and flag as confirmed if peak OI grew by
    `threshold_pct` or more from the earliest snapshot in the window.

    Request body:
        {
            "contracts": [
                {"sym": "BE", "cp": "C", "strike": 370,
                 "expiry": "9/18/2026", "first_trade_date": "7/2/2026"},
                ...
            ],
            "window_days": 5,        # default 5
            "threshold_pct": 10      # default 10 (i.e. 10% growth)
        }

    Response:
        {
            "ok": true,
            "confirmations": {
                "BE|C|370|9/18/2026": {
                    "confirmed": true,
                    "first_oi": 21823,
                    "peak_oi": 26430,
                    "pct_change": 21.1,
                    "snapshots_found": 3
                },
                ...
            },
            "total": 240,
            "confirmed_count": 42,
            "no_snapshots_count": 30,
            "matched_variant_examples": ["BE|C|370|9/18/2026"]
        }

    Contract-key format detection: because the storage format of
    contract_key in `contract_oi_snapshots` is set by api/oi_snapshots.py
    (not in this file), we try several plausible formats and use whichever
    matches. `matched_variant_examples` in the response shows what worked
    so we can standardize on it later.
    """
    import sqlite3
    from datetime import datetime, timedelta
    from fastapi.responses import JSONResponse

    body = await request.json()
    contracts = body.get("contracts") or []
    window_days = int(body.get("window_days") or 5)
    threshold_pct = float(body.get("threshold_pct") or 10)

    if not contracts:
        return {"ok": False, "error": "No contracts provided"}
    if len(contracts) > 5000:
        return {"ok": False, "error": "Too many contracts (limit 5000)"}

    def _iso(date_str):
        s = (date_str or "").strip()
        if not s:
            return ""
        parts = s.split("/")
        if len(parts) == 3:
            m, d, y = parts[0], parts[1], parts[2]
            if len(y) == 2:
                y = "20" + y
            try:
                return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
            except Exception:
                return s
        return s

    def _key_variants(c):
        """Candidate storage formats for contract_key."""
        sym = str(c.get("sym") or "").upper().strip()
        cp = str(c.get("cp") or "").upper().strip()
        cp_letter = cp[0] if cp else ""
        cp_word = "CALL" if cp_letter == "C" else "PUT" if cp_letter == "P" else cp
        strike = c.get("strike")
        # Strike format: `XOM|P|140.0|8/21/2026` — one decimal place always.
        # Try both "140.0" (verified format) and "140" (integer fallback) plus
        # the raw incoming string in case it has cents like "140.5".
        try:
            strike_num = float(strike)
            if strike_num == int(strike_num):
                strike_1dp = f"{int(strike_num)}.0"   # 140 -> "140.0"
                strike_int = f"{int(strike_num)}"      # 140 -> "140"
            else:
                strike_1dp = f"{strike_num}"           # 140.5 -> "140.5"
                strike_int = f"{strike_num}"
        except (TypeError, ValueError):
            strike_1dp = str(strike) if strike is not None else ""
            strike_int = strike_1dp
        expiry_raw = str(c.get("expiry") or "").strip()
        expiry_iso = _iso(expiry_raw)
        # Verified format first (matches sample_keys from oi/table-diagnose):
        return [
            f"{sym}|{cp_letter}|{strike_1dp}|{expiry_raw}",   # e.g. "XOM|P|140.0|8/21/2026"
            f"{sym}|{cp_letter}|{strike_int}|{expiry_raw}",   # "XOM|P|140|8/21/2026" fallback
            f"{sym}|{cp_word}|{strike_1dp}|{expiry_raw}",
            f"{sym}|{cp_letter}|{strike_1dp}|{expiry_iso}",
            f"{sym}|{cp_word}|{strike_int}|{expiry_raw}",
            f"{sym} {cp_letter} {strike_1dp} {expiry_raw}",
            f"{sym}_{cp_letter}_{strike_1dp}_{expiry_iso}",
        ]

    def _orig_key(c):
        return f"{c.get('sym','')}|{c.get('cp','')}|{c.get('strike','')}|{c.get('expiry','')}"

    # Init confirmations for every requested contract (default = unconfirmed)
    confirmations = {}
    for c in contracts:
        confirmations[_orig_key(c)] = {
            "confirmed": False,
            "first_oi": 0,
            "peak_oi": 0,
            "pct_change": 0,
            "snapshots_found": 0,
        }

    matched_variant_examples = []
    try:
        from api.flow_db import FlowDB
        db = FlowDB()
        with sqlite3.connect(db.db_path, timeout=10) as conn:
            # ── Step 1: Detect actual contract_key format from a single sample
            # Instead of trying all 7 variants for every contract (which was
            # timing out at Cloudflare's 100s limit on large ticker searches),
            # we detect the format once by looking up the first contract with
            # each variant format, then use only the winning format for the
            # batch query. If no format matches, we return early with
            # matched_variant_examples=[] so the caller can diagnose.
            detected_format = None
            if contracts:
                sample_c = contracts[0]
                sample_variants = _key_variants(sample_c)
                # Also try a broader sample — a few random contracts — because
                # the first one might be a new contract with no snapshots.
                probe_contracts = contracts[:min(20, len(contracts))]
                for probe in probe_contracts:
                    if detected_format is not None:
                        break
                    for i, v in enumerate(_key_variants(probe)):
                        cur = conn.execute(
                            "SELECT 1 FROM contract_oi_snapshots "
                            "WHERE contract_key = ? LIMIT 1",
                            (v,),
                        )
                        if cur.fetchone():
                            detected_format = i  # index into _key_variants()
                            matched_variant_examples.append(v)
                            break

            if detected_format is None:
                # No format matched any probe — return early with diagnostics
                confirmed_count = 0
                no_snapshots = len(confirmations)
                resp = JSONResponse({
                    "ok": True,
                    "confirmations": confirmations,
                    "total": len(confirmations),
                    "confirmed_count": confirmed_count,
                    "no_snapshots_count": no_snapshots,
                    "matched_variant_examples": [],
                    "window_days": window_days,
                    "threshold_pct": threshold_pct,
                    "note": "Could not detect contract_key format from any of the "
                            "7 candidates on 20 probe contracts. Hit /api/admin/"
                            "massive/diagnose and share oi_sample_keys.",
                })
                resp.headers["Cache-Control"] = "private, max-age=60"
                return resp

            # ── Step 2: Build the ONE key variant per contract using detected format
            key_to_orig = {}
            for c in contracts:
                variants = _key_variants(c)
                if detected_format < len(variants):
                    k = variants[detected_format]
                    key_to_orig[k] = _orig_key(c)

            # ── Step 3: Batch-fetch snapshots using only the winning format
            rows_by_key = {}
            key_list = list(key_to_orig.keys())
            BATCH = 400
            for i in range(0, len(key_list), BATCH):
                batch = key_list[i:i + BATCH]
                placeholders = ",".join(["?"] * len(batch))
                cur = conn.execute(
                    f"SELECT contract_key, snap_date, oi FROM contract_oi_snapshots "
                    f"WHERE contract_key IN ({placeholders}) "
                    f"ORDER BY contract_key, snap_date",
                    batch,
                )
                for r in cur.fetchall():
                    k, sd, oi = r[0], r[1], int(r[2] or 0)
                    rows_by_key.setdefault(k, []).append((sd, oi))

            # ── Step 4: Compute confirmation per requested contract
            for c in contracts:
                original = _orig_key(c)
                trade_date_raw = str(c.get("first_trade_date") or "").strip()
                try:
                    parts = trade_date_raw.split("/")
                    if len(parts) == 3:
                        m, d, y = parts[0], parts[1], parts[2]
                        if len(y) == 2:
                            y = "20" + y
                        trade_dt = datetime(int(y), int(m), int(d))
                    else:
                        trade_dt = None
                except Exception:
                    trade_dt = None

                if trade_dt is None:
                    continue

                variants = _key_variants(c)
                if detected_format >= len(variants):
                    continue
                match_rows = rows_by_key.get(variants[detected_format])
                if not match_rows:
                    continue

                # Two-phase baseline strategy for sparse snapshot data:
                #   1. Prefer pre-trade OI as baseline (closest snapshot AT or
                #      BEFORE trade_date within a 10d lookback). This measures
                #      the true "did OI grow after the trade" signal.
                #   2. Fallback: earliest snapshot IN the forward window as
                #      baseline. Weaker signal but still usable — captures OI
                #      change across days after the trade if pre-trade data
                #      isn't available.
                # Peak: max OI across snapshots in the forward window.
                window_end = trade_dt + timedelta(days=window_days)
                lookback_start = trade_dt - timedelta(days=10)
                # Parse all snapshot dates once
                parsed_rows = []
                for sd, oi in match_rows:
                    snap_dt = None
                    try:
                        snap_dt = datetime.strptime(sd, "%Y-%m-%d")
                    except Exception:
                        try:
                            parts = sd.split("/")
                            if len(parts) == 3:
                                mm, dd, yy = parts[0], parts[1], parts[2]
                                if len(yy) == 2:
                                    yy = "20" + yy
                                snap_dt = datetime(int(yy), int(mm), int(dd))
                        except Exception:
                            continue
                    if snap_dt is None:
                        continue
                    parsed_rows.append((snap_dt, oi))

                # Baseline candidate: latest snapshot in [lookback_start, trade_dt]
                pre_trade = [(dt, oi) for dt, oi in parsed_rows
                             if lookback_start <= dt <= trade_dt]
                pre_trade.sort(key=lambda x: x[0])
                # Forward-window snapshots (trade_dt < dt <= window_end)
                # Note: strict > trade_dt if we have pre-trade baseline, so we
                # don't double-count trade_dt in both baseline and peak.
                post_trade = [(dt, oi) for dt, oi in parsed_rows
                              if trade_dt < dt <= window_end]
                post_trade.sort(key=lambda x: x[0])

                if pre_trade and post_trade:
                    # Best case: baseline from pre-trade, peak from post-trade
                    baseline_dt, baseline_oi = pre_trade[-1]  # most recent pre-trade
                    peak_oi = max(oi for _, oi in post_trade)
                    snapshots_used = len(pre_trade) + len(post_trade)
                    baseline_source = "pre_trade"
                elif post_trade and len(post_trade) >= 2:
                    # Fallback: first vs peak within forward window
                    baseline_oi = post_trade[0][1]
                    peak_oi = max(oi for _, oi in post_trade)
                    snapshots_used = len(post_trade)
                    baseline_source = "forward_window"
                elif pre_trade and len(pre_trade) >= 2:
                    # Pre-trade accumulation signal: contract was being built
                    # BEFORE the flow event. Baseline = earliest pre-trade,
                    # peak = latest pre-trade. Different semantic than post-
                    # trade confirmation (measures pre-flow accumulation vs
                    # post-flow adds), but equally actionable — flow event
                    # was a continuation of an existing accumulation trend.
                    # Example: BE 9/18 $370c snapshots at 6/25 (306), 6/26
                    # (306), 6/29 (6574) — 21x growth in 4 days leading up
                    # to the 7/2 flow. Strong signal even without post-trade
                    # data yet.
                    baseline_oi = pre_trade[0][1]
                    peak_oi = max(oi for _, oi in pre_trade)
                    snapshots_used = len(pre_trade)
                    baseline_source = "pre_trade_accumulation"
                else:
                    # Not enough data — need at minimum a baseline + comparison
                    # Include trade_dt itself as candidate baseline if present.
                    same_day = [(dt, oi) for dt, oi in parsed_rows if dt == trade_dt]
                    forward = [(dt, oi) for dt, oi in parsed_rows if dt > trade_dt and dt <= window_end]
                    if same_day and forward:
                        baseline_oi = same_day[0][1]
                        peak_oi = max(oi for _, oi in forward)
                        snapshots_used = 1 + len(forward)
                        baseline_source = "same_day"
                    else:
                        # Record the snapshot count so caller can see coverage
                        confirmations[original]["snapshots_found"] = len(parsed_rows)
                        continue

                pct = ((peak_oi - baseline_oi) / baseline_oi * 100.0) if baseline_oi > 0 else 0
                # When baseline_oi is 0 but peak_oi > 0, the contract went from
                # no open interest to some — a NEW position being established.
                # That's a strong confirmation signal (institutional opening
                # trades). Flag as confirmed if peak > some minimum threshold.
                # We use 50 contracts as a floor to filter out trivial noise.
                if baseline_oi == 0 and peak_oi >= 50:
                    confirmations[original] = {
                        "confirmed": True,
                        "first_oi": 0,
                        "peak_oi": peak_oi,
                        "pct_change": 100,  # sentinel for "new position opened"
                        "snapshots_found": snapshots_used,
                        "baseline_source": baseline_source + "_new_position",
                    }
                    continue
                confirmations[original] = {
                    "confirmed": pct >= threshold_pct,
                    "first_oi": baseline_oi,
                    "peak_oi": peak_oi,
                    "pct_change": round(pct, 1),
                    "snapshots_found": snapshots_used,
                    "baseline_source": baseline_source,
                }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"ok": False, "error": str(e), "confirmations": confirmations}

    confirmed_count = sum(1 for v in confirmations.values() if v["confirmed"])
    no_snapshots = sum(1 for v in confirmations.values() if v["snapshots_found"] == 0)
    resp = JSONResponse({
        "ok": True,
        "confirmations": confirmations,
        "total": len(confirmations),
        "confirmed_count": confirmed_count,
        "no_snapshots_count": no_snapshots,
        "matched_variant_examples": matched_variant_examples,
        "window_days": window_days,
        "threshold_pct": threshold_pct,
    })
    # Cache for 60s so repeated toggle-on/off doesn't re-query
    resp.headers["Cache-Control"] = "private, max-age=60"
    return resp


@app.post("/api/admin/flow/delete-by-date")
async def _flow_delete_by_date(
    target_date: str,
    source: str = "",
    tickers: str = "",
    confirm: bool = False,
):
    """Delete all flow rows for a given date. Destructive; used when a date's
    data needs to be rebuilt clean (e.g. 7/2/2026 had V1+V2+V3 backfills
    inserted while iterating on Fix 1+2+3 in the 7/3 session — duplicate
    rows produced 1000+ curated alerts vs. the ~30-50 the tune expects).

    Recommended workflow after delete:
      1. POST this endpoint with confirm=true
      2. Re-apply the fill:
         POST /api/admin/massive/apply-gap-fill?fill_file=fill-7-2-stocks.csv&source=stocks
         POST /api/admin/massive/apply-gap-fill?fill_file=fill-7-2-indexes.csv&source=indexes
      3. Re-apply patches:
         POST /api/admin/massive/backfill-from-patches?patches_file=patches-7-2.json&target_date=7/2/2026
      4. Rebuild color:
         POST /api/admin/massive/rebuild-color?target_date=7/2/2026
      5. Normalize sweep sides:
         POST /api/admin/massive/normalize-sweep-sides?target_date=7/2/2026

    target_date: 'M/D/YYYY' (required, no default — safety)
    source: 'stocks' | 'indexes' | '' for both (default: both)
    tickers: optional comma-separated ticker list to restrict deletion to
             (e.g. 'SPY,QQQ,IWM,SMH,SLV'). If provided, only rows matching
             these tickers are deleted. Useful for cleaning up ETFs
             misrouted into source='stocks' by upstream Massive classifier.
    confirm: must be true to actually delete (default: false → returns preview count)

    Preview mode (confirm=false): returns the count that WOULD be deleted
    without touching the data. Use this first to verify scope.

    Only touches the `flow` table. contract_oi_snapshots, aggregates, etc.
    are untouched — their per-date rows remain valid.
    """
    try:
        import sqlite3, os
        if not target_date:
            return {"ok": False, "error": "target_date is required (M/D/YYYY format)"}

        # Basic format validation
        parts = target_date.split("/")
        if len(parts) != 3:
            return {"ok": False, "error": f"target_date must be M/D/YYYY, got: {target_date!r}"}

        # Source filter validation
        if source and source not in ("stocks", "indexes"):
            return {"ok": False, "error": f"source must be 'stocks', 'indexes', or empty; got: {source!r}"}

        # Ticker filter parse (uppercase, dedupe, strip whitespace)
        ticker_list = []
        if tickers:
            ticker_list = sorted(set(
                t.strip().upper() for t in tickers.split(",") if t.strip()
            ))
            if not ticker_list:
                return {"ok": False, "error": f"tickers parsed to empty list from: {tickers!r}"}

        db_path = os.environ.get("FLOW_DB_PATH", "/data/flow.db")
        conn = sqlite3.connect(db_path, timeout=30)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")

        # Build WHERE clause dynamically
        where = ["CreatedDate = ?"]
        params = [target_date]
        if source:
            where.append("source = ?")
            params.append(source)
        if ticker_list:
            placeholders = ",".join(["?"] * len(ticker_list))
            where.append(f"Symbol IN ({placeholders})")
            params.extend(ticker_list)
        where_sql = " AND ".join(where)

        # Count first — always safe, no mutation
        cur = conn.execute(
            f"SELECT COUNT(*) FROM flow WHERE {where_sql}",
            params
        )
        row_count = cur.fetchone()[0]

        # Preview mode — no mutation
        if not confirm:
            conn.close()
            return {
                "ok": True,
                "preview": True,
                "stats": {
                    "target_date": target_date,
                    "source": source or "ALL",
                    "tickers": ticker_list or "ALL",
                    "would_delete": row_count,
                    "message": "Preview only. Pass confirm=true to actually delete.",
                }
            }

        # Live mode — perform the delete
        cursor = conn.execute(
            f"DELETE FROM flow WHERE {where_sql}",
            params
        )
        rows_deleted = cursor.rowcount
        conn.commit()
        conn.close()

        # Bump data-version so client caches invalidate
        try:
            from api.flow_router import bump_data_version
            new_ver = bump_data_version()
        except Exception:
            new_ver = None

        return {
            "ok": True,
            "preview": False,
            "stats": {
                "target_date": target_date,
                "source": source or "ALL",
                "tickers": ticker_list or "ALL",
                "rows_deleted": rows_deleted,
                "new_data_version": new_ver,
            }
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"ok": False, "error": str(e)}


def serve_csv():
    return _csv_response(os.path.join(PUBLIC, "flow-data.csv"), "flow-data.csv")

@app.get("/Darkpool-data.csv")
def serve_darkpool_csv():
    return _csv_response(os.path.join(PUBLIC, "Darkpool-data.csv"), "Darkpool-data.csv")

@app.get("/Indexes-data.csv")
def serve_indexes_csv():
    return _csv_response(os.path.join(PUBLIC, "Indexes-data.csv"), "Indexes-data.csv")

# --- Serve React build (JS/CSS assets + SPA fallback) ------------------------
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

    # ── The brand + CHART AXIS font, self-hosted (app/public/fonts → dist/fonts).
    # 🔴 THIS MOUNT IS LOAD-BEARING, NOT A NICETY. The SPA catch-all at the bottom
    # of this block answers ANY unmatched path with index.html, so without a route
    # here the browser is handed HTML for a `.woff2`, every @font-face in
    # app/index.html fails, and lightweight-charts BAKES A FALLBACK FACE into
    # every chart axis it draws — including the headless Morning Wire → Substack
    # renderer. That is precisely the failure mode self-hosting was adopted to
    # remove, so deleting this mount would re-create it in a worse form (a font
    # that can never load, rather than one that sometimes loads late).
    # `immutable` is safe because the filename carries the UPSTREAM version
    # (`-v4-`): a font update lands under a NEW filename, never over this one.
    _FONTS_DIR = os.path.join(DIST, "fonts")
    if os.path.exists(_FONTS_DIR):
        app.mount("/fonts", _ImmutableStaticFiles(directory=_FONTS_DIR), name="fonts")

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

    # Root-level public/ files are NOT covered by the /assets mount, so each
    # needs an explicit route or the SPA catch-all serves index.html instead —
    # the OG card silently never renders and crawlers get HTML for robots/sitemap.
    @app.get("/og-image.png", include_in_schema=False)
    def _serve_og_image():
        return FileResponse(
            os.path.join(DIST, "og-image.png"),
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=86400"},
        )

    # Pre-launch social card (app/public/og-coming-soon.png). Referenced by the
    # meta tags only while VITE_COMING_SOON=1; needs its own route for exactly
    # the reason above. Regenerate with tools/make_og_coming_soon.py.
    @app.get("/og-coming-soon.png", include_in_schema=False)
    def _serve_og_coming_soon():
        return FileResponse(
            os.path.join(DIST, "og-coming-soon.png"),
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=86400"},
        )

    @app.get("/robots.txt", include_in_schema=False)
    def _serve_robots():
        return FileResponse(os.path.join(DIST, "robots.txt"), media_type="text/plain; charset=utf-8")

    @app.get("/sitemap.xml", include_in_schema=False)
    def _serve_sitemap():
        return FileResponse(os.path.join(DIST, "sitemap.xml"), media_type="application/xml")

    @app.get("/pip-embed", include_in_schema=False)
    def _serve_pip_embed(v: str = "", t: int = 0):
        # Same-origin shim for the Desk video pop-out (Document Picture-in-Picture).
        # A YouTube /embed iframe loaded straight into the PiP window's about:blank
        # document sends NO HTTP Referer, so YouTube rejects it with Error 153
        # (embedder.identity.missing.referrer) — referrerpolicy can't help because
        # about:blank has no URL to derive a referrer from. Interposing THIS real
        # same-origin page gives the nested embed a valid https referrer. See
        # app/src/components/video/documentPip.js.
        import re as _re
        vid = _re.sub(r"[^A-Za-z0-9_-]", "", v or "")[:24]
        try:
            start = max(0, int(t))
        except (TypeError, ValueError):
            start = 0
        if not vid:
            return Response(content="missing v", media_type="text/plain", status_code=400)
        qs = "autoplay=1&rel=0&modestbranding=1&playsinline=1&fs=1"
        if start:
            qs += f"&start={start}"
        src = f"https://www.youtube.com/embed/{vid}?{qs}"
        html = (
            "<!doctype html><html><head><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
            "<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}"
            "iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style></head>"
            "<body><iframe src='" + src + "' "
            "allow='autoplay; encrypted-media; picture-in-picture; fullscreen' "
            "allowfullscreen referrerpolicy='strict-origin-when-cross-origin'></iframe>"
            "</body></html>"
        )
        return Response(
            content=html,
            media_type="text/html; charset=utf-8",
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        return FileResponse(
            os.path.join(DIST, "index.html"),
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )
