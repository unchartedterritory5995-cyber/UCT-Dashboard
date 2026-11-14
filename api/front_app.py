"""The front door: serves the built frontend itself, passes everything else to `web`.

WHY. `web` is one container with its data disk attached, so it cannot overlap with its
replacement: every deploy is 40 to 75 seconds of 502 for members, and a frontend-only
change restarts it just the same. This app holds no data. Run as its own service (no
disk, more than one copy) it can be replaced with no gap, so a frontend release stops
being an outage, and the app shell keeps loading while `web` restarts.

    member -> Cloudflare -> THIS APP --built frontend--> answered here, from its own build
                               |
                               +--everything else--> `web`, over the private network

WHAT IT SERVES ITSELF is exactly what `api/main.py` serves from `app/dist`, declared the
same way so that it behaves the same way, quirks included:
  * `/assets` and `/fonts`, through the SAME class `web` uses (`ImmutableStaticFiles`);
  * the root files in `ROOT_FILES`, each with the media type and cache header `web` sends;
  * the live-trading-room pages, their slash redirects and their folder;
  * the app shell for every other GET or HEAD, with the same headers.

⛔ IT NEVER SERVES "ANY FILE THAT EXISTS IN THE BUILD". The build folder also holds files
`web` does not hand out freely: `Darkpool-data.csv` and `Indexes-data.csv` are served by
`web` only behind its open-reads gate, and `.vite/manifest.json` is not served at all. The
authority is `web`'s route table. `tests/test_front_app.py` walks `api.main`'s routes and
fails if a route outside `/api` is neither served here nor in `PROXY_PATHS`.

WHAT IT PASSES THROUGH: `/api/*`, the paths in `PROXY_PATHS`, and every method other than
GET and HEAD. Bytes are forwarded as they arrive in both directions (streams stay streams,
compressed stays compressed). Request headers go through untouched, including `Host`,
`X-Forwarded-For`, `X-Real-IP` and `CF-Connecting-IP`: Railway's edge wrote them, and
`api/services/request_ip.py` on `web` reads them exactly as it does today.

⛔ IT NEVER RETRIES AND NEVER HOLDS A REQUEST. If `web` cannot be reached within
`CONNECT_TIMEOUT_S` the answer is 502, which is what members get today and what the
in-app "Updating" banner (`app/src/lib/serverGap.js`) keys on. A held request would show
stale numbers as if they were live.

Start it with:  uvicorn api.front_app:app --host 0.0.0.0 --port $PORT
(no `--proxy-headers`: this app forwards the edge's headers, it does not interpret them).
Environment: `FRONT_UPSTREAM` = `host:port` of `web` (required), `RAILWAY_GIT_COMMIT_SHA`.
"""
from __future__ import annotations

import contextlib
import logging
import os
import time

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response, StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.staticfiles import StaticFiles

from api.services import build_manifest
from api.services.static_assets import ImmutableStaticFiles

logger = logging.getLogger("uct.front")

DEFAULT_DIST = os.path.join(os.path.dirname(__file__), "..", "app", "dist")

#: Seconds to wait for a connection to `web` before answering 502.
CONNECT_TIMEOUT_S = 5.0

#: path, file inside the build, media type, Cache-Control (None = none sent).
#: Mirrors the `FileResponse` routes in `api/main.py`. `tests/test_front_app.py` serves the
#: same temp build through both apps and compares every one of these.
ROOT_FILES = (
    ("/manifest.json", "manifest.json", "application/json", None),
    ("/sw.js", "sw.js", "application/javascript; charset=utf-8", None),
    ("/push-sw.js", "push-sw.js", "application/javascript; charset=utf-8", "no-cache"),
    ("/favicon.svg", "favicon.svg", "image/svg+xml", None),
    ("/vite.svg", "vite.svg", "image/svg+xml", None),
    ("/og-image.png", "og-image.png", "image/png", "public, max-age=86400"),
    ("/og-coming-soon.png", "og-coming-soon.png", "image/png", "public, max-age=86400"),
    ("/q1-probe.html", "q1-probe.html", "text/html; charset=utf-8", "no-store"),
    ("/robots.txt", "robots.txt", "text/plain; charset=utf-8", None),
    ("/sitemap.xml", "sitemap.xml", "application/xml", None),
)

LIVE_TRADING_ROOM_PATH = "/live-trading-room"
LIVE_TRADING_ROOM_DIR = "live-trading-room"
#: path suffix -> file. Each is served GET/HEAD with `public, max-age=300`, and the same
#: path with a trailing slash redirects to it (301).
LIVE_TRADING_ROOM_PAGES = (("", "index.html"), ("/terms", "terms.html"), ("/privacy", "privacy.html"))

#: Routes `web` registers OUTSIDE `/api` that are not files in the build. Passed through
#: for every method. The CSVs are in the build folder and are listed here ON PURPOSE:
#: `web` decides who may read them.
PROXY_PATHS = (
    "/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc",
    "/Darkpool-data.csv", "/Indexes-data.csv",
    "/pip-embed",
)

PUBLIC_NOTE_PATH_PREFIXES = ("/share/n", "/p")
PUBLIC_NOTE_HEADERS = {"X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer"}

ALL_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
#: Folders this app serves through a mount. A mount answers any method itself, so OPTIONS
#: under each is routed to `web` explicitly, ahead of the mount.
OPTIONS_TO_WEB_PREFIXES = ("/assets", "/fonts", LIVE_TRADING_ROOM_PATH)
NON_READ_METHODS = ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]

#: RFC 9110 hop-by-hop headers: meaningful for one connection only, never forwarded.
#: `Host` and `Content-Length` are NOT here: `web` must see the public host, and the body
#: is forwarded byte for byte, so its length is still true.
HOP_BY_HOP = frozenset({
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailer", "trailers", "transfer-encoding", "upgrade", "proxy-connection",
})


def is_public_note_path(full_path: str) -> bool:
    path = "/" + (full_path or "").lstrip("/")
    return any(path == p or path.startswith(p + "/") for p in PUBLIC_NOTE_PATH_PREFIXES)


def upstream_base(value: str | None) -> str:
    """`host:port` (or a full `http://` URL) -> `http://host:port`, no trailing slash."""
    value = (value or "").strip().rstrip("/")
    if not value:
        raise RuntimeError("FRONT_UPSTREAM is not set: the front door has nowhere to pass requests")
    return value if value.startswith(("http://", "https://")) else "http://" + value


def path_class(path: str) -> str:
    """The first two path segments, for logs. Paths carry tickers and share tokens; logs must not."""
    parts = [p for p in path.split("/") if p][:2]
    return "/" + "/".join(parts) if parts else "/"


#: What `web` wraps every answer in, outermost first (api/main.py): gzip, then CORS. The
#: front door wraps what it answers ITSELF in the same two library classes with the same
#: settings, so neither a browser nor Cloudflare can tell which of the two sent an answer.
#: Measured 2026-11-14 without them: 46 of 192 comparisons differed (Railway's edge was
#: compressing in the front door's place, and never a PNG or a 91-byte file), and no answer
#: to a request carrying `Origin` had `Access-Control-Allow-Origin`.
#: `tests/test_front_app_parity.py` reads both settings out of `api.main:app`.
GZIP_LEVEL = 5
#: `web` declares a 1000-byte floor and it never applies: the layers inside its gzip layer
#: hand every answer on as a stream, and the gzip class has no floor for a stream. What `web`
#: really does is compress every answer that HAS a body. Measured on production 2026-11-14:
#: a 91-byte /build.json arrives gzip-encoded; an empty 301 and a HEAD do not. Answers are
#: not streams here, so a floor of one byte is that same rule.
GZIP_MINIMUM_SIZE = 1
CORS_OPTIONS = {"allow_origins": ["*"], "allow_methods": ["*"], "allow_headers": ["*"]}

_PASSED_THROUGH = "uct.front.passed_through"
_RAW_SEND = "uct.front.raw_send"


def is_gzip_exempt(path: str) -> bool:
    """Hashed assets and fonts are not compressed here, as on `web`: they ship precompressed."""
    return path.startswith("/assets/") or path.startswith("/fonts/")


class _GZipLocal(GZipMiddleware):
    async def __call__(self, scope, receive, send):
        if is_gzip_exempt(scope.get("path") or ""):
            await self.app(scope, receive, send)
        else:
            await super().__call__(scope, receive, send)


class LocalAnswerLayers:
    """gzip and CORS for what the front door answers itself, and for nothing else.

    A passed-through answer is never touched. `web` has already compressed it and added its
    own CORS headers; a compressor in front of a stream holds events back, and a second CORS
    layer would overwrite the origin `web` chose to allow.

    Which answers are passed through is NOT restated here as a list of paths: `proxy` marks
    the request, and this reads the mark when the first message of the answer is sent.

    An OPTIONS request is never answered here. Every one goes to `web`, whose own CORS layer
    answers a preflight.
    """

    def __init__(self, app):
        self.app = app

        async def answered(scope, receive, layered_send):
            raw_send = scope[_RAW_SEND]

            async def send(message):
                await (raw_send if scope.get(_PASSED_THROUGH) else layered_send)(message)

            await app(scope, receive, send)

        self.layers = _GZipLocal(CORSMiddleware(answered, **CORS_OPTIONS),
                                 minimum_size=GZIP_MINIMUM_SIZE, compresslevel=GZIP_LEVEL)

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or scope.get("method") == "OPTIONS":
            await self.app(scope, receive, send)
            return
        scope[_RAW_SEND] = send
        await self.layers(scope, receive, send)


def create_app(dist: str | None = None, upstream: str | None = None,
               transport: httpx.AsyncBaseTransport | None = None) -> FastAPI:
    """Build the front-door application.

    `dist` is the built frontend (default: `app/dist` beside this package). `upstream` is
    `web`'s address (default: `$FRONT_UPSTREAM`). `transport` exists for tests.
    """
    dist = os.path.abspath(dist or DEFAULT_DIST)
    state: dict = {"link": None}

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI):
        if not os.path.isfile(os.path.join(dist, "index.html")):
            raise RuntimeError(f"no built frontend at {dist}: the front door has nothing to serve")
        app.state.upstream = upstream_base(upstream if upstream is not None else os.environ.get("FRONT_UPSTREAM"))
        app.state.client = httpx.AsyncClient(
            transport=transport,
            timeout=httpx.Timeout(connect=CONNECT_TIMEOUT_S, read=None, write=60.0, pool=CONNECT_TIMEOUT_S),
            limits=httpx.Limits(max_connections=2000, max_keepalive_connections=200),
            follow_redirects=False,
            trust_env=False,
        )
        # httpx adds its own Accept, Accept-Encoding and User-Agent to any request that lacks
        # them. A pass-through must not: an Accept-Encoding the member never sent would make
        # `web` compress an answer for a client that cannot read it.
        for _default in ("accept", "accept-encoding", "user-agent"):
            app.state.client.headers.pop(_default, None)
        logger.info("[front] serving %s, passing the rest to %s", dist, app.state.upstream)
        try:
            yield
        finally:
            await app.state.client.aclose()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(LocalAnswerLayers)

    def commit() -> str:
        return os.environ.get("RAILWAY_GIT_COMMIT_SHA") or ""

    def link_header() -> str:
        if state["link"] is None:
            state["link"] = build_manifest.early_hint_link(dist)
        return state["link"]

    # ── this app's own answers ────────────────────────────────────────────────
    @app.get("/__front/health", include_in_schema=False)
    def front_health():
        """Up means THIS app can serve. It never depends on `web`: a restart of `web` must
        not take the front door out of rotation with it."""
        return JSONResponse({"status": "ok", "role": "front", **build_manifest.build_info(dist, commit())},
                            headers={"Cache-Control": "no-store"})

    @app.get("/build.json", include_in_schema=False)
    def build_json():
        """The frontend's identity. Whoever serves the built frontend answers this."""
        return JSONResponse(build_manifest.build_info(dist, commit()), headers={"Cache-Control": "no-store"})

    # ── pass-through ──────────────────────────────────────────────────────────
    async def proxy(request: Request) -> Response:
        client: httpx.AsyncClient = request.app.state.client
        scope = request.scope
        scope[_PASSED_THROUGH] = True   # read by LocalAnswerLayers: this answer is `web`'s, leave it alone
        raw_path = scope.get("raw_path") or scope["path"].encode("utf-8")
        target = request.app.state.upstream + raw_path.decode("latin-1")
        if scope.get("query_string"):
            target += "?" + scope["query_string"].decode("latin-1")

        headers = [(k, v) for k, v in request.headers.raw if k.decode("latin-1").lower() not in HOP_BY_HOP]
        has_body = (request.headers.get("transfer-encoding") is not None
                    or (request.headers.get("content-length") or "0").strip() not in ("", "0"))
        started = time.perf_counter()
        try:
            upstream = await client.send(
                client.build_request(request.method, target, headers=headers,
                                     content=request.stream() if has_body else None),
                stream=True,
            )
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout) as exc:
            logger.warning("[front] %s %s -> unreachable (%s) after %.0f ms", request.method,
                           path_class(scope["path"]), type(exc).__name__, (time.perf_counter() - started) * 1000)
            return Response("upstream unreachable", status_code=502, media_type="text/plain",
                            headers={"X-UCT-Front": "upstream-unreachable", "Cache-Control": "no-store"})
        except httpx.HTTPError as exc:
            logger.warning("[front] %s %s -> upstream error (%s)", request.method,
                           path_class(scope["path"]), type(exc).__name__)
            return Response("upstream error", status_code=502, media_type="text/plain",
                            headers={"X-UCT-Front": "upstream-error", "Cache-Control": "no-store"})
        waited_ms = (time.perf_counter() - started) * 1000

        async def body():
            try:
                async for chunk in upstream.aiter_raw():
                    yield chunk
            finally:
                await upstream.aclose()
                logger.info("[front] %s %s %s upstream_ms=%.0f total_ms=%.0f", request.method,
                            path_class(scope["path"]), upstream.status_code, waited_ms,
                            (time.perf_counter() - started) * 1000)

        response = StreamingResponse(body(), status_code=upstream.status_code)
        # Replace Starlette's default headers wholesale: the upstream's own, minus hop-by-hop.
        # `Date` and `Server` are left out too: this server stamps its own, and two of each
        # is what a careless proxy looks like.
        response.raw_headers = [(k, v) for k, v in upstream.headers.raw
                                if k.decode("latin-1").lower() not in HOP_BY_HOP
                                and k.decode("latin-1").lower() not in ("date", "server")]
        return response

    app.add_api_route("/api/{rest:path}", proxy, methods=ALL_METHODS, include_in_schema=False)
    for _path in PROXY_PATHS:
        app.add_api_route(_path, proxy, methods=ALL_METHODS, include_in_schema=False)

    # Every OPTIONS goes to `web`. A folder mount below would otherwise answer one itself (405),
    # where `web`'s CORS layer answers a preflight.
    for _prefix in OPTIONS_TO_WEB_PREFIXES:
        app.add_api_route(_prefix + "/{rest:path}", proxy, methods=["OPTIONS"], include_in_schema=False)

    # ── the built frontend, declared the way api/main.py declares it ──────────
    assets_dir = os.path.join(dist, "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", ImmutableStaticFiles(directory=assets_dir), name="assets")
    fonts_dir = os.path.join(dist, "fonts")
    if os.path.isdir(fonts_dir):
        app.mount("/fonts", ImmutableStaticFiles(directory=fonts_dir), name="fonts")

    def _root_file(filename: str, media_type: str, cache_control: str | None):
        def serve():
            headers = {"Cache-Control": cache_control} if cache_control else None
            return FileResponse(os.path.join(dist, filename), media_type=media_type, headers=headers)
        return serve

    for _path, _file, _media, _cache in ROOT_FILES:
        # GET only, as in api/main.py (`@app.get`): a HEAD falls to the catch-all there, and here.
        app.add_api_route(_path, _root_file(_file, _media, _cache), methods=["GET"], include_in_schema=False)

    def _ltr_page(filename: str):
        def serve():
            return FileResponse(os.path.join(dist, LIVE_TRADING_ROOM_DIR, filename),
                                media_type="text/html; charset=utf-8",
                                headers={"Cache-Control": "public, max-age=300"})
        return serve

    def _ltr_redirect(target: str):
        def redirect():
            return RedirectResponse(target, status_code=301)
        return redirect

    for _suffix, _file in LIVE_TRADING_ROOM_PAGES:
        _page = LIVE_TRADING_ROOM_PATH + _suffix
        app.add_api_route(_page, _ltr_page(_file), methods=["GET", "HEAD"], include_in_schema=False)
        app.add_api_route(_page + "/", _ltr_redirect(_page), methods=["GET", "HEAD"], include_in_schema=False)
    ltr_dir = os.path.join(dist, LIVE_TRADING_ROOM_DIR)
    if os.path.isdir(ltr_dir):
        app.mount(LIVE_TRADING_ROOM_PATH, StaticFiles(directory=ltr_dir), name="live-trading-room")

    # ── everything else ───────────────────────────────────────────────────────
    def shell(full_path: str):
        """The app shell, exactly as `spa_index_response` in api/main.py builds it."""
        headers = {"Cache-Control": "no-cache, no-store, must-revalidate"}
        hints = link_header()
        if hints:
            headers["Link"] = hints
        if is_public_note_path(full_path):
            headers.update(PUBLIC_NOTE_HEADERS)
        return FileResponse(os.path.join(dist, "index.html"), headers=headers)

    app.add_api_route("/{full_path:path}", shell, methods=["GET", "HEAD"], include_in_schema=False)
    app.add_api_route("/{full_path:path}", proxy, methods=NON_READ_METHODS, include_in_schema=False)
    return app


def __getattr__(name: str):
    """`uvicorn api.front_app:app` builds the app on first use, so importing this module in
    a test (or in `web`) never needs a built frontend or `FRONT_UPSTREAM`."""
    if name == "app":
        application = create_app()
        globals()["app"] = application
        return application
    raise AttributeError(name)
