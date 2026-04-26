import os
import json
import threading
from contextlib import asynccontextmanager
from datetime import datetime
from zoneinfo import ZoneInfo
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
from api.routers import journal as journal_router
from api.routers import journal_two as journal_two_router
from api.routers import watchlists as watchlists_router
from api.routers import ticker_tags as ticker_tags_router
from api.routers import watchlist_alerts as watchlist_alerts_router
from api.routers import stream as stream_router
from api.routers import community as community_router
from api.routers import rs_ranking as rs_ranking_router
from api.routers import intelligence as intelligence_router
from api.routers import transcripts as transcripts_router
from api.services.auth_db import init_db as _init_auth_db
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse as StarletteJSONResponse
from api.gex_router import router as gex_router

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

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Auth DB — separate from all other databases, safe to init
    try:
        _init_auth_db()
    except Exception as e:
        print(f"[startup] Auth DB init error (non-fatal): {e}")

    _seed_cache_from_volume()

    # Pre-warm bars disk cache — background thread fetches all commonly viewed
    # tickers so charts load instantly from disk cache. Runs on every startup,
    # skips tickers already cached on disk (survives Railway restarts).
    def _prewarm_bars():
        from api.services import bars_disk_cache as _disk
        from api.routers.bars import _fetch_daily
        import time as _t

        # Purge stale cache entries from prior bugs
        purged = _disk.purge_empty()
        if purged:
            print(f"[prewarm] Purged {purged} empty cache entries")
        # One-time nuke: delete entire bars cache directory (old 500-bar entries)
        _purge_flag = os.path.join(os.environ.get("DATA_DIR", "/data"), ".cache_nuked_v2")
        if not os.path.exists(_purge_flag):
            import shutil
            _cache_dir = os.path.join(os.environ.get("DATA_DIR", "/data"), "bars_cache")
            try:
                if os.path.isdir(_cache_dir):
                    shutil.rmtree(_cache_dir)
                    print(f"[prewarm] Nuked entire bars_cache directory")
            except Exception as e:
                print(f"[prewarm] Cache nuke failed: {e}")
            try:
                with open(_purge_flag, "w") as f:
                    f.write("done")
            except Exception:
                pass

        # Gather all tickers worth pre-caching
        tickers = set()

        # 1. Core market indices + mega caps (always needed)
        tickers.update(['SPY', 'QQQ', 'IWM', 'DIA', 'AAPL', 'NVDA', 'MSFT', 'TSLA',
                        'AMZN', 'META', 'GOOGL', 'AMD', 'AVGO', 'SMCI', 'PLTR', 'ARM',
                        'COIN', 'MSTR', 'HOOD', 'ANET', 'NFLX', 'CRM', 'ORCL', 'UBER'])

        # 2. Everything from wire_data — UCT20, scanner candidates, earnings, movers
        try:
            wd = cache.get("wire_data")
            if wd:
                # UCT20 / leadership
                for pick in (wd.get("uct20") or wd.get("leadership") or []):
                    sym = pick.get("ticker") or pick.get("sym")
                    if sym:
                        tickers.add(sym.upper())
                # Scanner candidates (pullback, remount, gapper)
                cands = wd.get("candidates") or {}
                for group in (cands.get("pullback_ma") or [], cands.get("remount") or [], cands.get("gapper_news") or []):
                    for c in (group if isinstance(group, list) else []):
                        sym = c.get("ticker") or c.get("sym")
                        if sym:
                            tickers.add(sym.upper())
                # Earnings (BMO + AMC)
                earn = wd.get("earnings") or {}
                for bucket in (earn.get("bmo") or [], earn.get("amc") or []):
                    for e in bucket:
                        sym = e.get("sym") or e.get("ticker")
                        if sym:
                            tickers.add(sym.upper())
        except Exception:
            pass

        # 2b. Watchlist + tagged tickers from auth DB
        try:
            from api.services.auth_db import get_db_path
            import sqlite3
            db = sqlite3.connect(get_db_path())
            for tbl, col in [("watchlist_items", "sym"), ("ticker_tags", "sym")]:
                try:
                    rows = db.execute(f"SELECT DISTINCT {col} FROM {tbl}").fetchall()
                    for (sym,) in rows:
                        if sym:
                            tickers.add(sym.upper())
                except Exception:
                    pass
            db.close()
        except Exception:
            pass

        # 4. Full $300M+ cap universe — the master list (3,685 tickers)
        try:
            cap_path = os.path.join(os.path.dirname(__file__), "data", "cap_universe.json")
            if os.path.exists(cap_path):
                with open(cap_path) as f:
                    cap_tickers = json.load(f)
                tickers.update(t.upper() for t in cap_tickers if t)
                print(f"[prewarm] Loaded {len(cap_tickers)} tickers from cap_universe.json")
        except Exception:
            pass

        # 3. ALL theme tracker tickers from taxonomy — every ETF + every holding (all tiers)
        try:
            taxonomy_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "themes_taxonomy.json")
            if os.path.exists(taxonomy_path):
                with open(taxonomy_path) as f:
                    themes = json.load(f)
                for theme in themes:
                    etf = theme.get("ticker")
                    if etf:
                        tickers.add(etf.upper())
                    for h in (theme.get("holdings") or []):
                        tickers.add(h["sym"].upper())
        except Exception:
            pass

        tickers.discard('')
        # Priority order: indices first, then UCT20, then themes, then rest
        _PRIORITY = ['SPY', 'QQQ', 'IWM', 'DIA', 'AAPL', 'NVDA', 'MSFT', 'TSLA',
                      'AMZN', 'META', 'GOOGL', 'AMD', 'AVGO', 'SMCI', 'PLTR', 'ARM',
                      'COIN', 'MSTR', 'HOOD', 'ANET', 'NFLX', 'CRM', 'ORCL', 'UBER']
        priority_set = set(_PRIORITY)

        # Fast-path: tickers actually present in the latest breadth snapshot's
        # drill lists. These are what the user scans on the Breadth page, so
        # we warm them BEFORE the long tail of the cap universe — typically
        # only a few hundred tickers, hot in 2-3 min instead of 30+.
        _FAST_PATH: list[str] = []
        try:
            from api.services import breadth_monitor as _bm
            latest = _bm.get_latest()
            if latest:
                seen: set[str] = set()
                for k, v in latest.items():
                    if not k.endswith('_list') or not isinstance(v, list):
                        continue
                    for item in v:
                        if isinstance(item, dict):
                            sym = item.get('t')
                            if sym and sym.upper() not in seen and sym.upper() not in priority_set:
                                seen.add(sym.upper())
                                _FAST_PATH.append(sym.upper())
        except Exception as e:
            print(f"[prewarm] Fast-path lookup failed: {e}")

        fast_path_set = set(_FAST_PATH)
        rest = sorted(tickers - priority_set - fast_path_set)
        ticker_list = _PRIORITY + _FAST_PATH + rest
        print(f"[prewarm] Order: {len(_PRIORITY)} priority + {len(_FAST_PATH)} breadth-list + {len(rest)} long-tail = {len(ticker_list)} tickers")

        # Parallel prewarm — 16 workers via ThreadPoolExecutor. The aggregates
        # endpoint at Massive is I/O-bound and supports this concurrency
        # comfortably; if rate limits ever bite, drop to 8.
        from concurrent.futures import ThreadPoolExecutor as _PrewarmTPE
        from api.routers.bars import _fetch_daily, _fetch_weekly, _fetch_monthly, _fetch_intraday

        # Intraday warming is only worthwhile for tickers users actually open
        # at minute-level granularity — leadership names, indices, watchlist.
        _INTRADAY_TICKERS = ticker_list[:200]
        _INTRADAY_TFS = ('60', '30', '15', '5', '1')

        def _warm_one(args):
            sym, tf, bar_count = args
            try:
                if _disk.get(sym, tf, bar_count) is not None:
                    return ('skipped', sym, tf)
                if tf == 'D':
                    bars = _fetch_daily(sym, bar_count)
                elif tf == 'W':
                    bars = _fetch_weekly(sym, bar_count)
                elif tf == 'M':
                    bars = _fetch_monthly(sym, bar_count)
                else:
                    bars = _fetch_intraday(sym, tf, bar_count)
                if bars:
                    payload = {"ticker": sym, "tf": tf, "bars": bars}
                    _disk.put(sym, tf, bar_count, payload)
                    cache.set(f"bars_{sym}_{tf}_{bar_count}", payload, ttl=300)
                    return ('warmed', sym, tf)
            except Exception:
                pass
            return ('failed', sym, tf)

        # Build job list — Daily first across the full universe so the
        # dominant scan TF is fully warm before secondary TFs are touched.
        jobs = []
        for sym in ticker_list:
            jobs.append((sym, 'D', 5000))
        for sym in ticker_list:
            jobs.append((sym, 'W', 5000))
        for sym in ticker_list:
            jobs.append((sym, 'M', 5000))
        for sym in _INTRADAY_TICKERS:
            for tf in _INTRADAY_TFS:
                jobs.append((sym, tf, 5000))

        print(f"[prewarm] {len(jobs)} jobs queued ({len(ticker_list)} tickers; "
              f"Daily/Weekly/Monthly all + {len(_INTRADAY_TICKERS)} for intraday)")

        warmed = 0
        skipped = 0
        fast_path_size_jobs = (len(_PRIORITY) + len(_FAST_PATH))  # Daily-only count for fast-path milestone
        # NOTE: 4 workers — keep prewarm gentle so the FastAPI request thread pool
        # and Massive upstream both have headroom for live user requests.
        with _PrewarmTPE(max_workers=4, thread_name_prefix="prewarm-bars") as ex:
            for i, (status, _sym, _tf) in enumerate(ex.map(_warm_one, jobs), start=1):
                if status == 'warmed':
                    warmed += 1
                elif status == 'skipped':
                    skipped += 1
                if i == fast_path_size_jobs:
                    print(f"[prewarm] ★ Fast-path complete ({i} jobs) — Breadth scanning is hot. Continuing with long-tail in background.")
                if i % 500 == 0:
                    print(f"[prewarm] Progress {i}/{len(jobs)} — {warmed} fetched, {skipped} cached")
        print(f"[prewarm] First pass complete: {warmed} fetched, {skipped} cached, {len(jobs)} total")

        # Continuous refresh — every 5 minutes, re-warm any entries that have
        # aged out of disk cache. Parallelized with the same worker pool so
        # the universe stays hot without thrashing the upstream API.
        while True:
            _t.sleep(300)
            refresh_jobs = [j for j in jobs if _disk.get(j[0], j[1], j[2]) is None]
            if not refresh_jobs:
                continue
            refreshed = 0
            with _PrewarmTPE(max_workers=4, thread_name_prefix="prewarm-refresh") as ex:
                for status, _sym, _tf in ex.map(_warm_one, refresh_jobs):
                    if status == 'warmed':
                        refreshed += 1
            if refreshed:
                print(f"[prewarm] Refresh pass: {refreshed} of {len(refresh_jobs)} entries refilled")
    threading.Thread(target=_prewarm_bars, daemon=True, name="bars-prewarm").start()

    # Build deep intraday cache from S3 minute files (one-time, ~30 min on Railway)
    # Saves incrementally so partial progress survives restarts.
    def _build_deep_cache():
        deep_dir = os.path.join(os.environ.get("DATA_DIR", "/data"), "bars_cache_deep")
        # Purge old clock-hour 60min cache files (now using TC2000-style resample)
        _60_purge_flag = os.path.join(os.environ.get("DATA_DIR", "/data"), ".60min_purged_v1")
        if not os.path.exists(_60_purge_flag):
            _cache_dir = os.path.join(os.environ.get("DATA_DIR", "/data"), "bars_cache")
            if os.path.isdir(_cache_dir):
                purged_60 = 0
                for f in os.listdir(_cache_dir):
                    if '_60_' in f and f.endswith('.json'):
                        try:
                            os.remove(os.path.join(_cache_dir, f))
                            purged_60 += 1
                        except OSError:
                            pass
                if purged_60:
                    print(f"[prewarm] Purged {purged_60} old 60min cache files")
            try:
                with open(_60_purge_flag, 'w') as f:
                    f.write("done")
            except Exception:
                pass

        flag = os.path.join(os.environ.get("DATA_DIR", "/data"), ".deep_cache_built_v4")
        if os.path.exists(flag):
            count = len([f for f in os.listdir(deep_dir) if f.endswith('.json')]) if os.path.isdir(deep_dir) else 0
            print(f"[deep-cache] Already built ({count} files)")
            return
        print("[deep-cache] Building from S3 minute files...")
        try:
            from api.services.build_intraday_cache import build_cache
            build_cache(days=160, timeframes=[15, 30, 60], output_dir=deep_dir)
            with open(flag, 'w') as f:
                f.write("done")
            print("[deep-cache] Build complete")
        except Exception as e:
            print(f"[deep-cache] Build failed: {e}")
    threading.Thread(target=_build_deep_cache, daemon=True, name="deep-cache-builder").start()

    # Seed theme taxonomy from JSON → SQLite
    from api.services.theme_db import init_theme_tables, seed_from_json
    init_theme_tables()
    seed_from_json()

    from api.services.theme_performance import load_persisted_on_startup
    load_persisted_on_startup()

    # Start real-time WebSocket stream (Massive/Polygon)
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

    try:
        _cot_service.init_db()
        if _cot_service.is_empty():
            print("[startup] COT table empty — seeding from CFTC historical archive (background)...")
            threading.Thread(target=_cot_seed_background, daemon=True, name="cot-seed").start()
        else:
            # Catch-up: trigger if data is stale (>=8 days old = missed at least one Friday refresh)
            # or if today is Friday past 5 PM ET and the scheduled 3:50 PM job was missed.
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
                elif now_et.weekday() == 4 and now_et.hour >= 17:  # Friday past 5 PM ET
                    print("[startup] COT catch-up: Friday refresh missed — running now...")
                    threading.Thread(target=_cot_catchup_background, daemon=True, name="cot-catchup").start()
                else:
                    print(f"[startup] COT database ready (latest: {latest_date}, {days_old}d old).")
            else:
                print("[startup] COT database ready.")
    except Exception as e:
        print(f"[startup] COT init error (non-fatal): {e}")

    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.cron import CronTrigger
    from api.services.auth_service import cleanup_expired_sessions, cleanup_expired_tokens, record_mrr_snapshot
    _scheduler = BackgroundScheduler(timezone=ZoneInfo("America/New_York"))
    # COT refresh: primary at 3:50 PM ET, retries at 4:15 PM and 4:45 PM if stale
    _scheduler.add_job(
        _cot_service.refresh_from_current,
        trigger=CronTrigger(day_of_week="fri", hour=15, minute=50),
        id="cot_weekly_refresh",
        max_instances=1,
        replace_existing=True,
    )
    _scheduler.add_job(
        _cot_service.refresh_if_stale,
        trigger=CronTrigger(day_of_week="fri", hour=16, minute=15),
        id="cot_weekly_retry_1",
        max_instances=1,
        replace_existing=True,
    )
    _scheduler.add_job(
        _cot_service.refresh_if_stale,
        trigger=CronTrigger(day_of_week="fri", hour=16, minute=45),
        id="cot_weekly_retry_2",
        max_instances=1,
        replace_existing=True,
    )
    # Daily safety-net: catches missed Friday refreshes. Runs at 6 PM ET every day.
    # Only downloads if latest DB record is >=8 days old (missed at least one Friday).
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

    _scheduler.add_job(
        _cot_daily_catchup,
        trigger=CronTrigger(hour=18, minute=0),
        id="cot_daily_catchup",
        max_instances=1,
        replace_existing=True,
    )
    _scheduler.add_job(
        cleanup_expired_sessions,
        trigger=CronTrigger(hour=3, minute=0),
        id="session_cleanup",
        max_instances=1,
        replace_existing=True,
    )
    # Churn risk check — daily at 9 AM ET, alerts on users inactive 7+ days
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

    _scheduler.add_job(
        _check_churn_risk,
        trigger=CronTrigger(hour=9, minute=0),
        id="churn_risk_check",
        max_instances=1,
        replace_existing=True,
    )
    # MRR snapshot — daily at 11:59 PM ET
    _scheduler.add_job(
        record_mrr_snapshot,
        trigger=CronTrigger(hour=23, minute=59),
        id="mrr_snapshot",
        max_instances=1,
        replace_existing=True,
    )
    # Record first snapshot on startup
    try:
        record_mrr_snapshot()
    except Exception as e:
        print(f"[startup] MRR snapshot error (non-fatal): {e}")

    # Watchlist digest emails
    from api.services.watchlist_digest import run_daily_digests, run_weekly_digests
    _scheduler.add_job(
        run_daily_digests,
        trigger=CronTrigger(hour=17, minute=0),
        id="watchlist_daily_digest",
        max_instances=1,
        replace_existing=True,
    )
    _scheduler.add_job(
        run_weekly_digests,
        trigger=CronTrigger(day_of_week="fri", hour=17, minute=5),
        id="watchlist_weekly_digest",
        max_instances=1,
        replace_existing=True,
    )

    _scheduler.start()
    print("[startup] COT scheduler running — Fridays at 3:50 PM ET (retries 4:15, 4:45); daily catchup at 6 PM ET")
    print("[startup] Session cleanup scheduled — daily at 3:00 AM ET")
    print("[startup] Churn risk check scheduled — daily at 9:00 AM ET")
    print("[startup] MRR snapshot scheduled — daily at 11:59 PM ET")

    yield
    _scheduler.shutdown(wait=False)
    stop_snapshot_scheduler()

app = FastAPI(title="UCT Dashboard", lifespan=lifespan)
app.add_middleware(MaintenanceMiddleware)
# Gzip responses >1KB — cuts ~200KB bar payloads to ~30KB on the wire.
# Excludes SSE streaming endpoints (real-time prices) to avoid buffering.
from starlette.middleware.gzip import GZipMiddleware as _GZipBase
from starlette.types import ASGIApp, Receive, Scope, Send

class _GZipSkipSSE(_GZipBase):
    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope.get("type") == "http" and (scope.get("path") or "").startswith("/api/stream"):
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
app.include_router(journal_router.router)
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
app.include_router(gex_router)

# ─── CSV routes: serve from app/public/ directly (bypasses Vite build cache) ──
PUBLIC = os.path.join(os.path.dirname(__file__), "..", "app", "public")

@app.get("/flow-data.csv")
def serve_csv():
    csv_path = os.path.join(PUBLIC, "flow-data.csv")
    if os.path.exists(csv_path):
        return FileResponse(csv_path, media_type="text/csv")
    return JSONResponse(status_code=404, content={"error": "flow-data.csv not found"})

@app.get("/Darkpool-data.csv")
def serve_darkpool_csv():
    csv_path = os.path.join(PUBLIC, "Darkpool-data.csv")
    if os.path.exists(csv_path):
        return FileResponse(csv_path, media_type="text/csv")
    return JSONResponse(status_code=404, content={"error": "Darkpool-data.csv not found"})

@app.get("/Indexes-data.csv")
def serve_indexes_csv():
    csv_path = os.path.join(PUBLIC, "Indexes-data.csv")
    if os.path.exists(csv_path):
        return FileResponse(csv_path, media_type="text/csv")
    return JSONResponse(status_code=404, content={"error": "Indexes-data.csv not found"})

# ─── Serve React build (JS/CSS assets + SPA fallback) ────────────────────────
DIST = os.path.join(os.path.dirname(__file__), "..", "app", "dist")
if os.path.exists(DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(DIST, "assets")), name="assets")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        return FileResponse(
            os.path.join(DIST, "index.html"),
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )
