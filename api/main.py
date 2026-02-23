import os
import json
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from api.routers import snapshot, movers, engine_data, earnings, news, screener, trades, traders, push, charts

PERSISTENT_WIRE_DATA_FILE = "/data/wire_data.json"


def _seed_cache_from_volume():
    """On startup, load persisted wire_data from Railway volume into cache."""
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
    yield


app = FastAPI(title="UCT Dashboard", lifespan=lifespan)

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

# Serve React build — must come AFTER all /api routes
DIST = os.path.join(os.path.dirname(__file__), "..", "app", "dist")
if os.path.exists(DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(DIST, "assets")), name="assets")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        return FileResponse(os.path.join(DIST, "index.html"))
