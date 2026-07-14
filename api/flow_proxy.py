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
import json
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
# CORRECTED after the P5 code review: only prefixes whose data is genuinely in
# flow.db (the DB that moves to the worker) OR the OPRA consumer's in-process
# state. Endpoints with their OWN web-local store were REMOVED — proxying them
# would serve an empty DB on the worker:
#   /api/darkpool        -> darkpool.db (web-only, CSV-seeded)
#   /api/top-flow        -> /data/top_flow_picks.json (web-only)
#   /api/flow-scoreboard -> reads top_flow_picks.json (web-only)
#   /api/flow-explain    -> flow_explain.db (web-only) + per-user auth (auth.db)
# Those stay web-local. flow-explain still needs flow.db post-cutover — tracked
# as the auth-at-proxy remaining work, NOT proxied blindly here.
PROXY_PREFIXES = (
    "/api/flow",              # flow_router + flow_summary (flow.db)
    "/api/flow-gap-fill",     # heals flow.db
    "/api/flow-backup",       # backs up flow.db
    "/api/flow-reconcile",    # reconciles flow.db
    "/api/dealer-positioning",  # flow.db
    "/api/notable-flow",      # flow.db (primary read)
    "/api/oi-snapshot",       # flow.db
    "/api/liveflow",          # OPRA consumer in-process state
    "/api/live/massive",      # OPRA consumer state + flow.db
)

# RFC 7230 6.1 hop-by-hop headers + framing headers we must not pass through.
# NOTE: content-encoding is PRESERVED (not stripped) — see _proxy: we forward the
# worker's already-gzipped bytes RAW (aiter_raw) and keep Content-Encoding: gzip so
# (a) web's GZipMiddleware skips re-compressing (no double-gzip on the shared loop)
# and (b) the buffered Response carries a Content-Length, keeping /api/flow/data
# Cloudflare-edge-cacheable (the whole point of Option B). Only framing headers +
# content-length (Response recomputes it from the buffered body) are stripped.
_HOP = frozenset({
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "host",
    "content-length",
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


def _inject_proxy_auth(request: Request, fwd_headers: dict) -> None:
    """Web-side: validate the uct_session cookie against web's auth.db and, if
    valid, vouch for the user to the worker via HMAC-signed headers (the worker
    trusts them only under FLOW_PROXY_TRUST=1). Best-effort: on any failure we
    simply don't inject and the worker rejects auth'd endpoints. The caller has
    already stripped any client-supplied x-uct-proxy-* headers, so these can't
    be forged from outside."""
    try:
        cookie = request.cookies.get("uct_session")
        if not cookie:
            return
        from api.services.auth_service import validate_session
        from api.flow_admin_auth import proxy_sign_user
        user = validate_session(cookie)
        if not user:
            return
        payload = json.dumps(
            {"id": user.get("id"), "email": user.get("email"),
             "role": user.get("role"), "plan": user.get("plan")},
            separators=(",", ":"), sort_keys=True)
        fwd_headers["x-uct-proxy-user"] = payload
        fwd_headers["x-uct-proxy-sig"] = proxy_sign_user(payload)
    except Exception as e:  # noqa: BLE001
        logger.warning("[flow-proxy] auth inject skipped: %s", e)


async def _proxy(request: Request):
    if not WORKER_INTERNAL_URL:
        return Response("flow proxy enabled but WORKER_INTERNAL_URL unset",
                        status_code=503)

    target = WORKER_INTERNAL_URL + request.url.path
    if request.url.query:
        target += "?" + request.url.query

    # Strip any client-supplied proxy-auth headers (never trust them), then let
    # web validate the cookie and inject its own signed vouch.
    fwd_headers = {k: v for k, v in request.headers.items()
                   if k.lower() not in _HOP
                   and k.lower() not in ("x-uct-proxy-user", "x-uct-proxy-sig")}
    _inject_proxy_auth(request, fwd_headers)
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

    # Buffer the RAW (still-encoded) upstream bytes — do NOT decode. This
    # preserves the worker's gzip so web never gunzips+regzips the ~60MB CSV on
    # the shared event loop (the 524 surface), and a buffered Response gets a
    # Content-Length so Cloudflare edge-caches it (proxy hop happens only on
    # cache-miss). Flow responses are bounded (JSON/CSV), so buffering is safe.
    # SSE passthrough (2026-07-08): an event-stream body NEVER ends, so the
    # buffered join below would hang forever + leak the held connection. Stream
    # these chunks straight through. Covers /api/live/massive/stream (the flow
    # tape) so the instant tape survives the P5 cutover -- the tailer runs on the
    # worker (where flow.db lives post-flip), reached via this proxy.
    _ctype = upstream.headers.get("content-type", "")
    if "text/event-stream" in _ctype or request.url.path.endswith("/massive/stream"):
        async def _sse_passthrough():
            try:
                async for chunk in upstream.aiter_raw():
                    yield chunk
            finally:
                await upstream.aclose()
        return StreamingResponse(
            _sse_passthrough(),
            status_code=upstream.status_code,
            headers={k: v for k, v in upstream.headers.items() if k.lower() not in _HOP},
            media_type=_ctype or "text/event-stream",
        )

    try:
        raw = b"".join([chunk async for chunk in upstream.aiter_raw()])
    finally:
        await upstream.aclose()

    resp_headers = {k: v for k, v in upstream.headers.items()
                    if k.lower() not in _HOP}

    return Response(
        content=raw,
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


def register_on(app) -> bool:
    """Mount the read-proxy on web. MUST be called BEFORE the local flow
    routers are included (FastAPI resolves first match), so when the flag is
    on the proxy wins and web's frozen flow.db is never consulted. Off by
    default -> zero change. Returns True iff registered."""
    if not (PROXY_ENABLED and WORKER_INTERNAL_URL):
        return False
    app.include_router(build_flow_proxy_router())
    logger.info("[flow-proxy] READ PROXY ACTIVE -> %s (prefixes: %s)",
                WORKER_INTERNAL_URL, ", ".join(PROXY_PREFIXES))
    return True
