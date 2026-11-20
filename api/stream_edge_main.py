"""stream-edge: serves the live chart stream (/api/stream/bars) to browsers.

docs/plans/2026-11-17-stream-edge.md. Measured 2026-11-17: since the stream-ingest
cutover data reaches the web pod ~1 s after the trade, but the web pod's interpreter
is shared with dozens of CPU-heavy jobs, so delivery to the browser paused 1.5-5 s
about every 6 s. This process has one job and nothing else to wait on.

    Massive -> stream-ingest -> stream-edge -> browser   (/api/stream/bars)
                             -> web                      (everything else)

* A second feed client of stream-ingest (feed_client.start_remote, no side feeds):
  the same RemoteBroadcaster mirror and the same SSE route code as web
  (api.routers.stream.stream_bars), so frames are byte-identical.
* Auth WITHOUT auth.db: the member's `uct_chart_edge` cookie (api/chart_edge_token.py,
  HMAC with CHART_EDGE_SECRET), verified exactly as the Cloudflare Worker does.
* No schedulers, no databases, no warm-ups: it is ready seconds after boot.

Run: python -m api.stream_edge_main   (PORT, default 8080)
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import APIRouter, Cookie, FastAPI, HTTPException
from fastapi.responses import JSONResponse

log = logging.getLogger("stream_edge")


def edge_access(uct_chart_edge: Optional[str] = Cookie(None)) -> dict:
    """The member chart entitlement, from the signed edge cookie (no session DB here)."""
    from api import chart_edge_token
    verdict, _payload = chart_edge_token.verify(uct_chart_edge)
    if verdict != "VALID":
        # 401 on MISSING/EXPIRED/INVALID. The Worker then serves the request from web
        # (session auth); the client keeps the token fresh (barsStreamManager re-mints via
        # /api/auth/me while a stream is open), so a member normally never lands here.
        raise HTTPException(status_code=401, detail={"error": "not_entitled", "reason": verdict.lower()})
    return {"via": "edge_token"}


def build_app(start_feed: bool = True) -> FastAPI:
    # The bars route refuses unless the bars stream is enabled; here it is the whole point.
    os.environ.setdefault("STREAM_BARS_ENABLED", "1")
    from api.bars_auth import require_bars_access
    from api.routers import stream as stream_router
    from api.services import feed_client

    @asynccontextmanager
    async def lifespan(_app):
        if start_feed:
            feed_client.start_remote(side_feeds=False, client_prefix="edge")
            log.info("[stream-edge] feed client started")
        try:
            yield
        finally:
            if start_feed:
                await feed_client.stop_remote()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    router = APIRouter()
    # ⭐ THE SAME ROUTE FUNCTION web serves: only its auth dependency is swapped below.
    router.add_api_route("/api/stream/bars", stream_router.stream_bars, methods=["GET"])

    @router.get("/healthz")
    def healthz():
        st = feed_client.status() or {}
        return {"ok": True, "feed_connected": bool(st.get("connected")),
                "streams": stream_router.subscriber_count("bars")}

    @router.get("/internal/status")
    def status():
        # Counters only: no prices, no symbols, no secrets.
        st = feed_client.status() or {}
        # No `last_error`: this is a public domain and exception text can name internal hosts.
        return JSONResponse({"feed": {k: st.get(k) for k in ("connected", "gen", "counters")},
                             "streams": stream_router.subscriber_count("bars")})

    app.include_router(router)
    app.dependency_overrides[require_bars_access] = edge_access
    return app


def main() -> None:
    import uvicorn
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    uvicorn.run(build_app(), host="0.0.0.0", port=int(os.environ.get("PORT", "8080")),
                log_level="info", access_log=False, timeout_graceful_shutdown=10)


if __name__ == "__main__":
    main()
