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
from api.routers import correlation as correlation_router
from api.routers import insider as insider_router
from api.routers import auth as auth_router
from api.routers import avatar as avatar_router
from api.routers import webhooks as webhooks_router
from api.routers import alerts as alerts_router
from api.routers import journal as journal_router
from api.routers import watchlists as watchlists_router
from api.routers import community as community_router
from api.routers import rs_ranking as rs_ranking_router
from api.routers import sector_flow as sector_flow_router
from api.routers import intelligence as intelligence_router
from api.routers import transcripts as transcripts_router
from api.services.auth_db import init_db as _init_auth_db
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse as StarletteJSONResponse

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
    from api.services.theme_performance import load_persisted_on_startup
    load_persisted_on_startup()
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
            # Catch-up: if today is Friday and we haven't refreshed yet today, do it now.
            # This handles Railway redeploys that happen after the 4:30 PM scheduled window.
            now_et = datetime.now(ZoneInfo("America/New_York"))
            if now_et.weekday() == 4 and now_et.hour >= 17:  # Friday, past 5 PM ET
                status = _cot_service.get_status()
                last_updated = status.get("last_updated")
                already_ran_today = (
                    last_updated is not None
                    and last_updated[:10] == now_et.date().isoformat()
                )
                if not already_ran_today:
                    print("[startup] COT catch-up: Friday refresh missed — running now...")
                    threading.Thread(target=_cot_catchup_background, daemon=True, name="cot-catchup").start()
                else:
                    print("[startup] COT database ready.")
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

    _scheduler.start()
    print("[startup] COT scheduler running — Fridays at 3:50 PM ET (retries 4:15, 4:45 if stale)")
    print("[startup] Session cleanup scheduled — daily at 3:00 AM ET")
    print("[startup] Churn risk check scheduled — daily at 9:00 AM ET")
    print("[startup] MRR snapshot scheduled — daily at 11:59 PM ET")

    yield
    _scheduler.shutdown(wait=False)
    stop_snapshot_scheduler()

app = FastAPI(title="UCT Dashboard", lifespan=lifespan)
app.add_middleware(MaintenanceMiddleware)
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
app.include_router(watchlists_router.router)
app.include_router(community_router.router)
app.include_router(live_prices_router.router)
app.include_router(rs_ranking_router.router)
app.include_router(sector_flow_router.router)
app.include_router(correlation_router.router)
app.include_router(intelligence_router.router)
app.include_router(transcripts_router.router)

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
