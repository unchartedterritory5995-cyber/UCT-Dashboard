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

_SENTRY_DSN = os.environ.get("SENTRY_DSN")
if _SENTRY_DSN:
    sentry_sdk.init(
        dsn=_SENTRY_DSN,
        traces_sample_rate=0.1,
        environment=os.environ.get("RAILWAY_ENVIRONMENT", "development"),
    )

PERSISTENT_WIRE_DATA_FILE = "/data/wire_data.json"

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
    # Schwab: refresh access token immediately on startup, then auto-refresh every 25 min
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
    yield
    stop_auto_refresh()

app = FastAPI(title="UCT Dashboard", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

@app.get("/api/health")
def health():
    return {"status": "ok"}

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

# Serve React build — must come AFTER all /api routes
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

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        return FileResponse(os.path.join(DIST, "index.html"))
