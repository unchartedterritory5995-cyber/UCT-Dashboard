import os
import json
import logging
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime
from zoneinfo import ZoneInfo

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

from fastapi import FastAPI, Request
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
from api.routers import backtest as backtest_router
from api.routers import patterns as patterns_router
from api.routers import admin_patterns as admin_patterns_router
from api.routers import tweets as tweets_router
from api.routers import admin_twitter as admin_twitter_router
from api.routers import desk as desk_router
from api.routers import admin_api_health as admin_api_health_router
from api.routers import catalysts as catalysts_router
from api.routers import wire_feedback as wire_feedback_router
from api.routers import modelbook as modelbook_router
from api.routers import charts_layouts as charts_layouts_router
from api.routers import theme_index as theme_index_router
from api.routers import ai_search as ai_search_router
from api.routers import user_playbook as user_playbook_router
from api.routers import education as education_router
from api.routers import fundamentals as fundamentals_router
from api.routers import analyst as analyst_router
from api.routers import filings as filings_router
from api.routers import research as research_router
from api.routers import earnings_intel as earnings_intel_router
from api.routers import ticker_logos as ticker_logos_router
from api.routers import broker_sync as broker_sync_router  # broker-sync (SnapTrade) -- MERGE AS A UNIT with include_router + scheduler below
from api.routers import desk_zoom_webhook as desk_zoom_webhook_router
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


# Module-level imports for hot tier warm helpers -- bound at module scope so
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

        def _calendar():
            from api.routers.calendar import get_calendar
            get_calendar()

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
            from api.live_massive_router import recent_massive_alerts, day_stats
            recent_massive_alerts(limit=10000, min_grade="D", target_date=None,
                                  sort_by="recent", tier=None, curated=False)
            day_stats(target_date=None, exclude_algo=False)

        def _flow_tape_curated():
            # Curated (the Discord feed) scans the whole day (~100K rows) — heavy,
            # so pre-warm it LAST, after the critical ALL FLOW warm, so it never
            # delays the tape users see first. Curated is a less-frequent, opt-in
            # mode; one cold load there is acceptable, and the snapshot cache
            # covers every subsequent read.
            from api.live_massive_router import recent_massive_alerts
            recent_massive_alerts(limit=5000, min_grade="D", target_date=None,
                                  sort_by="recent", tier=None, curated=True)

        _warm("flow-tape", _flow_tape_critical)   # FIRST — the tape is the priority surface
        _warm("movers", _movers)
        _warm("themes", _themes)
        _warm("news", _news)
        _warm("breadth", _breadth)
        _warm("calendar", _calendar)
        _warm("earnings-previews", _earnings_previews)  # after calendar (it reads the week)
        _warm("flow-curated", _flow_tape_curated)  # LAST — heavy 100K scan, non-critical

    threading.Thread(target=_delayed, daemon=True, name="dashboard-warmer").start()


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


def register_screener_jobs(scheduler):
    """Register the nightly full-market screener snapshot build (03:00 ET, after
    the ratings nightly at 02:30). Gated by SCREENER_SNAPSHOT_ENABLED (default on).
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

    scheduler.add_job(_run, trigger=CronTrigger(hour=3, minute=0),
                      id="screener_snapshot_nightly", max_instances=1,
                      replace_existing=True)


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
                      trigger=CronTrigger(day_of_week="mon-fri", hour="9-16", minute=0),
                      id="pattern_vision_judge", max_instances=1,
                      replace_existing=True)
    return True

    # Self-warm on deploy: if the snapshot is under-filled, build (up to
    # SCREENER_SNAPSHOT_MAX_PER_RUN, default 4000) in the background so the page
    # has the full universe without waiting for 03:00 ET. run_build picks the
    # stalest tickers first, so this tops up an incomplete snapshot each boot
    # until the universe is covered.
    try:
        from api.services.screener import snapshot_db
        snapshot_db.init_db()
        warm_min = int(os.environ.get("SCREENER_SNAPSHOT_WARM_MIN", "3000"))
        if snapshot_db.count_rows() < warm_min:
            import threading
            threading.Thread(target=snapshot_builder.run_build,
                             daemon=True, name="screener-warm").start()
    except Exception as e:
        print(f"[scheduler] screener self-warm skipped: {e}")
    return True


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

    # Initialize charts_layouts.db schema unconditionally (same pattern). The
    # Charts workspace fires /api/charts/layouts on load; without a schema the
    # read endpoint would 500 on "no such table".
    try:
        from api.services import charts_layout_service
        charts_layout_service._init_db()
        print("[startup] charts_layouts.db initialized")
    except Exception as e:
        print(f"[startup] charts_layouts init failed (non-fatal): {e}")

    # Initialize education.db schema unconditionally (same pattern as above).
    # The Educational Videos page fires /api/education/videos on load; without a
    # schema the read endpoint would 500 on "no such table".
    try:
        from api.services import education_service
        education_service._init_db()
        education_service.ensure_default_videos()  # firm workshop library (idempotent)
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
        indicator_alert_service.init_schema()
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

    try:
        _start_hot_tier_warm_background()
        logging.getLogger(__name__).info("[startup] hot tier warm scheduled (~45s after boot)")
    except Exception:
        logging.getLogger(__name__).exception("[startup] failed to schedule hot tier warm")

    try:
        _start_dashboard_warm_background()
        logging.getLogger(__name__).info("[startup] dashboard warm scheduled (~20s after boot)")
    except Exception:
        logging.getLogger(__name__).exception("[startup] failed to schedule dashboard warm")

    try:
        _start_rs_rankings_warm_background()
        logging.getLogger(__name__).info("[startup] rs-rankings warm scheduled (~120s after boot)")
    except Exception:
        logging.getLogger(__name__).exception("[startup] failed to schedule rs-rankings warm")

    try:
        _start_industry_map_background()
        logging.getLogger(__name__).info("[startup] industry-map prewarm scheduled (~75s after boot)")
    except Exception:
        logging.getLogger(__name__).exception("[startup] failed to schedule industry-map prewarm")

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
    print(
        "[startup] chart-realtime-mode: "
        "fmp_tz_fix=on yfinance_tz_fix=on heal_v1=ran-once heal_v2=ran-once heal_v3_60day=ran-once "
        "needs_fresh_post_market=on "
        "swr_refresh_interval=30s_intraday "
        "tf60_ws_streaming=on bucket_canonical=bars_fetch.bucket_60_et_unix_seconds "
        "delta_intraday_filter=>= idb_cache_logic_version=4 "
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

    from api.services.theme_db import init_theme_tables, seed_from_json
    init_theme_tables()
    seed_from_json()

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
                        print(f"[startup] Darkpool DB: {_stats['total_rows']:,} rows, {_stats['trading_days']} days -- up to date")

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
                CronTrigger(day_of_week="mon-fri", hour=9, minute=20),
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
                CronTrigger(day_of_week="mon-fri", hour="9-16", minute="0,30"),
                id="floor_signal_cycle", replace_existing=True, max_instances=1)
            _scheduler.add_job(
                community_signals.post_premarket_brief,
                CronTrigger(day_of_week="mon-fri", hour=8, minute=45),
                id="floor_premarket_brief", replace_existing=True, max_instances=1)
        except Exception as _e_sig:
            print(f"[startup] floor signal job skip: {_e_sig}")

        _scheduler.add_job(_cot_service.refresh_from_current, trigger=CronTrigger(day_of_week="fri", hour=15, minute=50), id="cot_weekly_refresh", max_instances=1, replace_existing=True)
        _scheduler.add_job(_cot_service.refresh_if_stale, trigger=CronTrigger(day_of_week="fri", hour=16, minute=15), id="cot_weekly_retry_1", max_instances=1, replace_existing=True)
        _scheduler.add_job(_cot_service.refresh_if_stale, trigger=CronTrigger(day_of_week="fri", hour=16, minute=45), id="cot_weekly_retry_2", max_instances=1, replace_existing=True)

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
            _scheduler.add_job(_ticker_types_sync, trigger=CronTrigger(hour=5, minute=30),
                               id="ticker_types_daily_sync", max_instances=1, replace_existing=True)

        # Broker Sync -- background incremental sync across all connected users.
        # Gated by BROKER_SYNC_ENABLED (default OFF -> fully inert). Runs on the
        # web pod (auth.db is web-local). Bounded async concurrency inside the
        # job keeps it light on the 512MB pod.
        if os.getenv("BROKER_SYNC_ENABLED") == "1":
            from api.services.journal_two.broker import sync as _broker_sync_engine
            _bs_interval = int(os.getenv("BROKER_SYNC_INTERVAL_MIN", "20"))
            # Incremental sync -- runs only inside the active market-data window
            # (the runner self-gates), so overnight/weekend ticks are no-ops.
            # jitter: both this interval and the hourly patterns_universe_scan
            # (an auth.db WRITER) are boot-anchored, so without jitter every
            # 3rd sync tick lands inside the scan's write window and loses the
            # 3s auth.db lock wait ("database is locked" hourly — prod 7/13-15).
            _scheduler.add_job(
                _broker_sync_engine.run_due_sync_blocking,
                trigger=IntervalTrigger(minutes=_bs_interval, jitter=120),
                id="broker_sync_due", max_instances=1, replace_existing=True,
            )
            # Nightly full reconcile (corrections/voids outside the window).
            _scheduler.add_job(
                _broker_sync_engine.run_nightly_reconcile_blocking,
                trigger=CronTrigger(hour=2, minute=30),
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
                trigger=CronTrigger(minute=37),
                id="broker_fleet_monitor", max_instances=1, replace_existing=True,
            )
            # Synthetic canary — nightly end-to-end pipeline proof on the
            # robot user's test-brokerage connection. No-op until
            # BROKER_CANARY_USER_ID is set.
            _scheduler.add_job(
                _broker_fleet.run_canary_sync_blocking,
                trigger=CronTrigger(hour=3, minute=10),
                id="broker_canary_sync", max_instances=1, replace_existing=True,
            )
            # Fidelity audit — nightly reconciliation of every synced account
            # against the broker's OWN reported numbers (equity, position
            # quantities, unknown activity types) → Discord on divergence.
            # 3:40am ET: after the 2:30 nightly reconcile + 3:10 canary.
            from api.services.journal_two.broker import fidelity_audit as _broker_fidelity
            _scheduler.add_job(
                _broker_fidelity.run_fidelity_audits_blocking,
                trigger=CronTrigger(hour=3, minute=40),
                id="broker_fidelity_audit", max_instances=1, replace_existing=True,
            )
            print(f"[startup] Broker sync scheduler ON (every {_bs_interval}m, market-hours; nightly reconcile 2:30am ET; fleet monitor :37 hourly)")

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

        _scheduler.add_job(_cot_daily_catchup, trigger=CronTrigger(hour=18, minute=0), id="cot_daily_catchup", max_instances=1, replace_existing=True)
        _scheduler.add_job(cleanup_expired_sessions, trigger=CronTrigger(hour=3, minute=0), id="session_cleanup", max_instances=1, replace_existing=True)

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
                trigger=CronTrigger(hour=2, minute=55),
                id="authdb_backup_nightly", max_instances=1, replace_existing=True,
            )
            print("[startup] auth.db R2 backup scheduler ON (every 6h + daily 2:55am ET)")

        # -- Full-market screener nightly snapshot build (spec 2026-06-19) --
        try:
            register_screener_jobs(_scheduler)
        except Exception as e:
            print(f"[scheduler] screener job registration error: {e}")

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
            # Slow safety-net -- overlap with burst is intentional; since_id
            # makes duplicate fetches free.
            _scheduler.add_job(_tw_poll, trigger=CronTrigger(minute="0"),
                               id="tweet_poll_slow", max_instances=1, replace_existing=True)
            _scheduler.add_job(_tw_cleanup, trigger=CronTrigger(hour=3, minute=0),
                               id="tweet_cleanup_daily", max_instances=1, replace_existing=True)
            print("[scheduler] tweet poll jobs registered")

        # -- The Desk -> Substack articles poller -------------------------------
        # Pulls each configured Substack RSS feed hourly. Free (no API cost), so
        # gated ON by default; set SUBSTACK_ENABLED=0 to disable.
        if os.environ.get("SUBSTACK_ENABLED", "1").lower() in ("1", "true", "yes"):
            from api.services.substack_poller import poll_all as _substack_poll
            _scheduler.add_job(_substack_poll, trigger=CronTrigger(minute="7"),
                               id="substack_poll_hourly", max_instances=1, replace_existing=True)
            # Sunday-afternoon burst: posts usually drop ~2 PM ET on Sundays, so
            # poll every 10 min 1-5 PM ET that day -> a fresh article lands within
            # minutes (the hourly job above stays the off-schedule safety net).
            _scheduler.add_job(_substack_poll,
                               trigger=CronTrigger(day_of_week="sun", hour="13-17", minute="*/10"),
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
            _scheduler.add_job(_dds_process, trigger=CronTrigger(minute="*/5"),
                id="desk_daily_session_process", max_instances=1, replace_existing=True)
            _scheduler.add_job(_dds_safety,
                trigger=CronTrigger(day_of_week="mon-fri", hour=18, minute=0),
                id="desk_daily_session_safety", max_instances=1, replace_existing=True)
            # Chapters/transcript + deferred Zoom-trash backfill (self-gated by
            # DESK_SESSION_CHAPTERS_ENABLED). Offset from the */5 drain so a fresh
            # publish gets its transcript pass a couple of minutes later.
            _scheduler.add_job(_dds_insights, trigger=CronTrigger(minute="7/15"),
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
                trigger=CronTrigger(hour=2, minute=30),
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
                trigger=CronTrigger(day_of_week="mon-fri", hour="6,10,14,18", minute=20),
                id="earnings_preview_warm", max_instances=1, replace_existing=True)
            # Reported analyses: after the close, when AMC names print — so the
            # post-earnings read is instant, not a cold 24s wait for the first viewer.
            _scheduler.add_job(_earn_analysis_warm,
                trigger=CronTrigger(day_of_week="mon-fri", hour="16,17,20", minute=35),
                id="earnings_analysis_warm", max_instances=1, replace_existing=True)

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
                trigger=CronTrigger(day_of_week="mon-fri", hour="8", minute="0,30,45"),
                kwargs={"hunt": True},
                id="catalyst_premarket_hunt", max_instances=1, replace_existing=True)

            # Early feed-only ticks keep the board warm for early birds:
            # 6:00, 6:30, 7:00, 7:30 ET
            _scheduler.add_job(_cat_refresh,
                trigger=CronTrigger(day_of_week="mon-fri", hour="6-7", minute="0,30"),
                kwargs={"hunt": False},
                id="catalyst_premarket", max_instances=1, replace_existing=True)

            # Late pre-market feed-only ticks: 9:00 + 9:30 ET
            _scheduler.add_job(_cat_refresh,
                trigger=CronTrigger(day_of_week="mon-fri", hour="9", minute="0,30"),
                kwargs={"hunt": False},
                id="catalyst_premarket_late", max_instances=1, replace_existing=True)

            # Pre-open burst: 9:10 + 9:20 ET — a fresh pull right before the
            # 9:30 open so the board is current while the trader is prepping.
            # Cheap: skip-if-stable reuses unchanged theses, so on a quiet
            # morning these are near-$0 but still re-stamp refreshed_at + catch
            # any late-breaking pre-open catalyst.
            _scheduler.add_job(_cat_refresh,
                trigger=CronTrigger(day_of_week="mon-fri", hour="9", minute="10,20"),
                kwargs={"hunt": False},
                id="catalyst_preopen", max_instances=1, replace_existing=True)

            # AMC earnings burst — the EOD focus window is 4:00-5:00 PM ET
            # (user-defined 2026-07-08): hunts at 4:00 + 4:30 + a final 5:00
            # sweep; feed-only ticks fill the gaps (every 5min to 4:25, every
            # 10min to 4:55). Anything that breaks after 5:00 PM is deliberately
            # left for the premarket sweeps to catch.
            _scheduler.add_job(_cat_refresh,
                trigger=CronTrigger(day_of_week="mon-fri", hour="16", minute="0,30"),
                kwargs={"hunt": True},
                id="catalyst_amc_burst_hunt", max_instances=1, replace_existing=True)
            _scheduler.add_job(_cat_refresh,
                trigger=CronTrigger(day_of_week="mon-fri", hour="16", minute="5-25/5,35,45,55"),
                kwargs={"hunt": False},
                id="catalyst_amc_burst", max_instances=1, replace_existing=True)
            # Final EOD hunt: 5:00 PM ET — catches the 4:30-5:00 AMC stragglers
            # (late reporters, post-close guidance) before the engine goes
            # quiet for the evening.
            _scheduler.add_job(_cat_refresh,
                trigger=CronTrigger(day_of_week="mon-fri", hour="17", minute="0"),
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
                trigger=CronTrigger(day_of_week="mon-fri", hour="20", minute="15"),
                id="catalyst_coverage_audit", max_instances=1, replace_existing=True)

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
                trigger=CronTrigger(day_of_week="mon-fri", hour="5", minute="0"),
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
                trigger=CronTrigger(day_of_week="mon-fri", hour="7,8,9", minute="0"),
                id="catalyst_premarket_health", max_instances=1, replace_existing=True)

            print("[scheduler] catalyst engine jobs registered (premarket 6-9:30 ET every 30m + pre-open burst 9:10/9:20 ET + premarket health 7/8/9 AM ET + AMC burst 4-4:30 ET every 5m + coverage audit 8:15 PM ET + autotune 5 AM ET)")

        # -- Morning Catalyst Digest (the brief reaches you) ---------------
        # One consolidated A/B brief pushed to operators at 8 AM ET weekdays
        # via Discord + email + AlertBell. Gated on CATALYST_DIGEST_ENABLED.
        if os.environ.get("CATALYST_DIGEST_ENABLED", "0").lower() in ("1", "true", "yes"):
            from api.services.catalyst.digest import send_digest as _cat_digest
            _scheduler.add_job(
                lambda: _cat_digest(),
                trigger=CronTrigger(day_of_week="mon-fri", hour=8, minute=0),
                id="catalyst_morning_digest", max_instances=1, replace_existing=True)
            print("[scheduler] catalyst morning digest registered (8 AM ET weekdays)")

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
                trigger=CronTrigger(hour=18, minute=0),
                id="calendar_alerts_evening",
                max_instances=1,
                replace_existing=True,
            )
            _scheduler.add_job(
                _calendar_alert_job_morning,
                trigger=CronTrigger(hour=7, minute=0),
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
                                               hour="4-20", minute="*/20"),
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

        _scheduler.add_job(_voice_cache_purge, trigger=CronTrigger(hour=3, minute=30), id="voice_audio_cache_purge", max_instances=1, replace_existing=True)

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
            trigger=CronTrigger(day_of_week="mon-fri", hour=16, minute=30),
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
            trigger=CronTrigger(day_of_week="sun", hour=8, minute=0),
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
            trigger=CronTrigger(day_of_week="mon", hour=13, minute=30),
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
                trigger=CronTrigger(hour=5, minute=30),
                id="fundamentals_warm",
                max_instances=1,
                replace_existing=True,
            )
            print("[startup] Fundamentals warm scheduled -- daily at 5:30 AM ET")

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
        or path.startswith("/assets/")
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


@app.get("/api/health/threads")
def health_threads():
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
def health_thread_stacks():
    """Companion to /threads: dump WHERE each thread is stuck (deepest app-level
    stack frame) so a thread / anyio-worker burst can be pinned to the exact
    blocking call site. Hit this DURING a burst. Read-only, cheap."""
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
def health_cache():
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
app.include_router(snapshot.router)
app.include_router(movers.router)
app.include_router(engine_data.router)
app.include_router(earnings.router)
app.include_router(news.router)
app.include_router(screener.router)
# DEPRECATED 2026-06-02 -- Model Book is no longer a trade log (rebuilt as a
# curated library of top stocks; see api/routers/modelbook.py). The /api/trades
# endpoints + data/trades.json are kept as a rollback backup; schedule a manual
# removal after ~30d of green prod. No UI references /api/trades anymore.
# app.include_router(trades.router)
app.include_router(traders.router)
app.include_router(push.router)
app.include_router(charts.router)
app.include_router(bars_router.router)
app.include_router(cot_router.router)
app.include_router(breadth_monitor_router.router)
app.include_router(theme_performance_router.router)
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
app.include_router(insider_router.router)
app.include_router(auth_router.router)
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
app.include_router(desk_router.router)
app.include_router(admin_api_health_router.router)
app.include_router(catalysts_router.router)
app.include_router(wire_feedback_router.router)
app.include_router(modelbook_router.router)
app.include_router(charts_layouts_router.router)
app.include_router(theme_index_router.router)
app.include_router(ai_search_router.router)
app.include_router(user_playbook_router.router)  # My Playbook /api/upb/*
app.include_router(education_router.router)
app.include_router(fundamentals_router.router)
app.include_router(analyst_router.router)
app.include_router(filings_router.router)
app.include_router(research_router.router)
app.include_router(earnings_intel_router.router)
app.include_router(ticker_logos_router.router)
app.include_router(broker_sync_router.router)  # broker-sync (SnapTrade) /api/j2/broker/*
app.include_router(desk_zoom_webhook_router.router)


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
        from api.backfill_tick_test import run_backfill
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
async def _oi_confirmation_map(request: Request):
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
