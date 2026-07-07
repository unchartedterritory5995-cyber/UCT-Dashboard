"""Flow read reverse-proxy (web -> worker) for the P5 consumer migration.

Background: after P5, the Massive OPRA consumer runs on the WORKER service and
owns flow.db on the worker's Railway volume. But the frontend still talks to
WEB. Railway volumes are single-attach, so web can no longer open flow.db
directly. This module lets web transparently forward the flow-family read (and
the T+1 upload) endpoints to the worker over Railway private networking, so the
UI is unchanged and flow.db keeps a single writer + all readers on one volume.

Design:
- Explicit catch-all routes per flow prefix (NOT a BaseHTTPMiddleware -- that
  buffers bodies and mishandles large streamed responses). Registered on web
  AHEAD of the local flow routers, so when enabled they win; when disabled the
  router simply isn't registered and web serves locally exactly as today.
- Content is forwarded DECODED (httpx aiter_bytes); web's own GZip middleware
  re-compresses to the client. Hop-by-hop + content-length/encoding stripped.
- Honest failure: when proxying is ON, local flow.db is stale, so an upstream
  error returns 502 (never a silent stale local response) so the monitor/UI can
  detect it.

Fully gated: FLOW_READS_PROXY_ENABLED=1 AND WORKER_INTERNAL_URL set. Off by
default -> zero behavior change. This ships dark and is flipped only at cutover.
"""
import os
import logging

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import Response, StreamingResponse

logger = logging.getLogger(__name__)

# Railway private-networking base, e.g. "http://worker.railway.internal:8080".
WORKER_INTERNAL_URL = os.environ.get("WORKER_INTERNAL_URL", "").rstrip("/")
PROXY_ENABLED = os.environ.get("FLOW_READS_PROXY_ENABLED", "0") == "1"

# Path prefixes whose data lives in flow.db or the OPRA consumer's in-process
# state -- after P5 these are owned by the WORKER, so web forwards them.
# IMPORTANT: /api/live (Bullflow alerts, live_alerts.db) is deliberately NOT
# here -- that consumer stays on web. /api/live/massive (Massive OPRA consumer
# state) IS. Matching is per-segment so /api/flow never captures a hypothetical
# unrelated /api/flowXYZ, and each -scoreboard/-explain/-gap-fill/-backup prefix
# is listed explicitly.
PROXY_PREFIXES = (
    "/api/flow",
    "/api/flow-scoreboard",
    "/api/flow-explain",
    "/api/flow-gap-fill",
    "/api/flow-backup",
    "/api/flow-reconcile",
    "/api/darkpool",
    "/api/dealer-positioning",
    "/api/notable-flow",
    "/api/top-flow",
    "/api/oi-snapshot",
    "/api/liveflow",
    "/api/live/massive",
)

# RFC 7230 6.1 hop-by-hop headers + framing headers we must not pass through.
_HOP = frozenset({
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "host",
    "content-length", "content-encoding",
})

_TIMEOUT = httpx.Timeout(
    connect=float(os.environ.get("FLOW_PROXY_CONNECT_TIMEOUT", "5")),
    read=float(os.environ.get("FLOW_PROXY_READ_TIMEOUT", "120")),  # /api/flow/data can be 50-70MB
    write=30.0,
    pool=5.0,
)

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    """Lazily create a pooled client bound to the running loop."""
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=False)
    return _client


async def _proxy(request: Request):
    if not WORKER_INTERNAL_URL:
        return Response("flow proxy enabled but WORKER_INTERNAL_URL unset",
                        status_code=503)

    target = WORKER_INTERNAL_URL + request.url.path
    if request.url.query:
        target += "?" + request.url.query

    fwd_headers = {k: v for k, v in request.headers.items()
                   if k.lower() not in _HOP}
    body = await request.body()  # empty for GET; buffered for the rare T+1 upload

    client = _get_client()
    try:
        upstream = await client.send(
            client.build_request(request.method, target,
                                 headers=fwd_headers, content=body),
            stream=True,
        )
    except Exception as e:  # noqa: BLE001 - surface any transport failure honestly
        logger.warning("[flow-proxy] %s %s -> worker error: %s",
                       request.method, request.url.path, e)
        return Response(f"flow proxy upstream error: {e}", status_code=502)

    resp_headers = {k: v for k, v in upstream.headers.items()
                    if k.lower() not in _HOP}

    async def _body():
        try:
            async for chunk in upstream.aiter_bytes():  # decoded; web re-gzips
                yield chunk
        finally:
            await upstream.aclose()

    return StreamingResponse(
        _body(),
        status_code=upstream.status_code,
        headers=resp_headers,
        media_type=upstream.headers.get("content-type"),
    )


def build_flow_proxy_router() -> APIRouter:
    """Router with a catch-all forwarder per flow prefix.

    Register this on web BEFORE the local flow routers so its routes win. Only
    call when PROXY_ENABLED (the caller gates it) -- otherwise local serves.
    """
    router = APIRouter()
    methods = ["GET", "POST", "PUT", "DELETE", "PATCH"]
    for prefix in PROXY_PREFIXES:
        router.add_api_route(prefix, _proxy, methods=methods)              # exact
        router.add_api_route(prefix + "/{path:path}", _proxy, methods=methods)  # sub-paths
    return router
