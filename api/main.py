import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from api.routers import snapshot, movers, engine_data

app = FastAPI(title="UCT Dashboard")

@app.get("/api/health")
def health():
    return {"status": "ok"}

app.include_router(snapshot.router)
app.include_router(movers.router)
app.include_router(engine_data.router)

# Serve React build — must come AFTER all /api routes
DIST = os.path.join(os.path.dirname(__file__), "..", "app", "dist")
if os.path.exists(DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(DIST, "assets")), name="assets")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        return FileResponse(os.path.join(DIST, "index.html"))
