"""stream-gateway: the live bar stream (/api/stream/bars) in a process of its own (2026-11-17).

WHY. Until now the bar stream ran inside `web`, on the one event loop that also serves every page
request and shares the interpreter with web's background warm-ups. Measured on production
2026-11-17: in the ~5 minutes after each web restart (three that afternoon, all other sessions'
merges) the live candles fell 2-12 s behind for every member (trade -> browser p50 6.3 s and 12.5 s,
bar messages 4-8/s against a normal ~25/s), while stream-ingest stayed at p90 250 ms. The boot
probe showed why: 130-147% CPU for minutes, the busy threads web's warm-ups (RS ranking, theme
indexes, calendar earnings, dashboard warmers), the event loop at 11-24% of it, and stall captures
in plain request handling (route matching over ~1,000 routes). A web deploy or a page-load burst
must not be able to touch a live candle.

WHAT. Exactly the code web runs for the bar stream, nothing re-written: the feed client and the
RemoteBroadcaster (feed_client.start_remote, here without web's side feeds, under its own client
id: stream-ingest serves many clients) and the `stream_bars` route itself (api/routers/stream.py).
The one difference is entitlement: this process has no member database, so the route's
`require_bars_access` is replaced by the signed chart cookie the edge already checks for /api/bars
and /api/hist (`uct_chart_edge`, api/chart_edge_token.py, minted at sign-in for entitled members),
or the service header. The edge Worker sends a request here only when it carries a valid cookie,
and falls back to web on any failure; this check is the second line, for anyone who finds the
service's own address.

It never restarts with web (its own narrow watch paths) and, like the rest of the data platform,
is not released during market hours.
"""
from __future__ import annotations

import asyncio
import logging
import os
import socket
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from api import chart_edge_token as cet
from api.bars_auth import require_bars_access
from api.routers import stream as stream_routes
from api.services import feed_client, feed_protocol as fp

log = logging.getLogger("api.stream_gateway")

SERVICE_HEADER = "x-chart-edge-token"
_started = time.time()


def gateway_client_id() -> str:
    rid = os.environ.get("RAILWAY_REPLICA_ID") or socket.gethostname() or "1"
    return f"gw-{rid}"[: fp.MAX_ID_LEN]


def edge_entitled(request: Request) -> dict:
    """The gateway's `require_bars_access`: a valid member chart cookie (ent=bars) or a valid
    service token in the header. 401 otherwise; nothing here reads a member database."""
    cookie = request.cookies.get(cet.COOKIE_NAME)
    if cookie:
        cls, payload = cet.verify(cookie, expect=cet.ENTITLEMENT_BARS)
        if cls == "VALID":
            return {"edge": "member", "exp": (payload or {}).get("exp")}
    header = request.headers.get(SERVICE_HEADER)
    if header:
        cls, payload = cet.verify(header, expect=cet.ENTITLEMENT_SERVICE)
        if cls == "VALID":
            return {"edge": "service", "exp": (payload or {}).get("exp")}
    raise HTTPException(status_code=401, detail="not_entitled")


def feed_ready(_entitled: dict = Depends(edge_entitled)) -> None:
    """503 while this process's own feed is not connected: the edge then sends the member to web,
    which streams from its own connection, instead of opening a stream that would stay silent.
    Depends on the entitlement, so an unentitled caller always gets 401 first and learns nothing."""
    st = feed_client.status() or {}
    if not st.get("connected"):
        raise HTTPException(status_code=503, detail="feed_not_connected")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # The route answers 503 unless bar streaming is on; this process exists only for it.
    os.environ.setdefault("STREAM_BARS_ENABLED", "1")
    feed_client.start_remote(side_feeds=False, client_id=gateway_client_id())
    log.info("[stream-gateway] feed client started as %s", gateway_client_id())
    try:
        yield
    finally:
        await feed_client.stop_remote()


def create_app() -> FastAPI:
    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.add_api_route("/api/stream/bars", stream_routes.stream_bars, methods=["GET"],
                      dependencies=[Depends(feed_ready)])
    app.dependency_overrides[require_bars_access] = edge_entitled

    @app.get("/api/health")
    def health():
        st = feed_client.status() or {}
        return {"status": "ok", "service": "stream-gateway", "uptime_seconds": int(time.time() - _started),
                "feed_connected": bool(st.get("connected")),
                "subscribers": stream_routes.subscriber_count("bars")}

    @app.get("/api/stream/gateway-status")
    def gateway_status():
        st = feed_client.status() or {}
        return JSONResponse({"connected": bool(st.get("connected")), "counters": st.get("counters") or {},
                             "subscribers": stream_routes.subscriber_count("bars"),
                             "uptime_seconds": int(time.time() - _started)})

    return app


app = create_app()


def main() -> None:
    import uvicorn
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT") or 8080),
                proxy_headers=True, forwarded_allow_ips="*", timeout_graceful_shutdown=5)


if __name__ == "__main__":
    main()
