import os
import json
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
import sentry_sdk
from api.limiter import limiter
from api.routers import snapshot, movers, engine_data, earnings, news, screener, trades, traders, push, charts
from api.schwab_router import router as schwab_router
from api.routers import cot as cot_router
from api.routers import breadth_monitor as breadth_monitor_router
from api.services import cot_service as _cot_service
from api.top_flow_router import router as top_flow_router
from api import top_flow_tracker as _top_flow_tracker
from api.uw_router import router as uw_router
from api.uw_ws_router import router as ws_router
from api.uw_websocket import start_uw_listener

_SENTRY_DSN = os.environ.get("SENTRY_DSN")
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
    _seed_cache_from_volume()
    from api.schwab_service import start_auto_refresh, stop_auto_refresh, refresh_access_token, is_authenticated, load_tokens
    tokens = load_tokens()
    if tokens and "refresh_token" in tokens:
        print("[startup] Found Schwab refresh token on disk, refreshing access token...")
        try:
            result = await refresh_access_token()
            if result:
                print("[startup] Schwab access token refreshed — API ready for all users.")
            else:
                print("[startup] Schwab token refresh FAILED — re-auth needed at /api/schwab/login")
        except Exception as e:
            print(f"[startup] Schwab token refresh error: {e}")
    else:
        print("[startup] No Schwab tokens found. Admin must visit /api/schwab/login once to connect.")
    start_auto_refresh()
    from api.daily_tracker import start_snapshot_scheduler, stop_snapshot_scheduler
    start_snapshot_scheduler()

    _top_flow_tracker.init()
    _top_flow_tracker.archive_expired()
    print(f"[startup] Top Flow tracker: {len(_top_flow_tracker.get_all()['active'])} active, {len(_top_flow_tracker.get_all()['archived'])} archived.")

    try:
        _cot_service.init_db()
        if _cot_service.is_empty():
            import threading
            print("[startup] COT table empty — seeding from CFTC historical archive (background)...")
            threading.Thread(target=_cot_seed_background, daemon=True, name="cot-seed").start()
        else:
            print("[startup] COT database ready.")
    except Exception as e:
        print(f"[startup] COT init error (non-fatal): {e}")

    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.cron import CronTrigger
    from zoneinfo import ZoneInfo
    _scheduler = BackgroundScheduler(timezone=ZoneInfo("America/New_York"))
    _scheduler.add_job(
        _cot_service.refresh_from_current,
        trigger=CronTrigger(day_of_week="fri", hour=15, minute=45),
        id="cot_weekly_refresh",
        max_instances=1,
        replace_existing=True,
    )
    _scheduler.start()
    print("[startup] COT scheduler running — refreshes every Friday at 3:45 PM ET")

    try:
        start_uw_listener()
        print("[startup] UW WebSocket listener started")
    except Exception as e:
        print(f"[startup] UW WebSocket listener failed (non-fatal): {e}")

    yield
    _scheduler.shutdown(wait=False)
    stop_auto_refresh()
    stop_snapshot_scheduler()

app = FastAPI(title="UCT Dashboard", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

@app.get("/api/health")
def health():
    return {"status": "ok"}

@app.get("/api/test-uw-fields")
async def test_uw_fields():
    import httpx
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://api.unusualwhales.com/api/option-trades/flow-alerts",
            headers={
                "Authorization": f"Bearer {os.getenv('UW_API_KEY', '')}",
                "UW-CLIENT-API-ID": "100001",
            },
            params={"limit": 1},
        )
        return resp.json()

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
app.include_router(schwab_router)
app.include_router(cot_router.router)
app.include_router(breadth_monitor_router.router)
app.include_router(top_flow_router)
app.include_router(uw_router)
app.include_router(ws_router)

DIST = os.path.join(os.path.dirname(__file__), "..", "app", "dist")
if os.path.exists(DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(DIST, "assets")), name="assets")

    @app.get("/flow-data.csv")
    def serve_csv():
        csv_path = os.path.join(DIST, "flow-data.csv")
        if os.path.exists(csv_path):
            return FileResponse(csv_path, media_type="text/csv")
        return JSONResponse(status_code=404, content={"error": "flow-data.csv not found"})

    @app.get("/Darkpool-data.csv")
    def serve_darkpool_csv():
        csv_path = os.path.join(DIST, "Darkpool-data.csv")
        if os.path.exists(csv_path):
            return FileResponse(csv_path, media_type="text/csv")
        return JSONResponse(status_code=404, content={"error": "Darkpool-data.csv not found"})

    @app.get("/Indexes-data.csv")
    def serve_indexes_csv():
        csv_path = os.path.join(DIST, "Indexes-data.csv")
        if os.path.exists(csv_path):
            return FileResponse(csv_path, media_type="text/csv")
        return JSONResponse(status_code=404, content={"error": "Indexes-data.csv not found"})

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        return FileResponse(os.path.join(DIST, "index.html"))
