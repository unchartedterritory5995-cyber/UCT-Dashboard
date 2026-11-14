"""`api.front_app`: the front door serves the built frontend and passes the rest to `web`.

Everything here runs over real sockets: a stand-in for `web` on one port, the front door on
another, and a real HTTP client. An in-process transport buffers a streamed response, and
streaming is one of the things this has to prove.

This file imports nothing from `api.main` (that needs every dependency of the application).
What must agree with `api.main` is pinned in `tests/test_front_app_parity.py`.

Mutation proof (run before calling these done):
    1. serve any file found in the build        -> test_the_app_shell_answers_every_other_read RED
       (the two gated CSVs are covered separately: test_files_in_the_build_are_not_served_from_disk)
    2. buffer the upstream body                 -> test_a_stream_arrives_as_it_is_produced RED
    3. retry a failed connect                   -> test_an_unreachable_upstream_is_a_fast_502 RED
    4. add httpx's default Accept-Encoding      -> test_no_headers_are_invented RED
    5. drop the public-note headers             -> test_public_note_pages_are_not_indexed RED
    6. let the app shell answer a missing asset -> test_a_missing_asset_is_404_never_the_shell RED
    7. GZIP_MINIMUM_SIZE = 0                    -> test_an_answer_with_no_body_is_not_compressed RED
    8. GZIP_MINIMUM_SIZE = 1000                 -> test_local_answers_are_gzipped_however_small RED
    9. is_gzip_exempt returns False             -> test_hashed_assets_and_fonts_are_never_recompressed RED
   10. proxy stops marking the request          -> test_a_passed_through_answer_is_not_compressed_or_cors_marked_here,
                                                   test_the_cors_answer_web_chose_arrives_as_web_wrote_it and the
                                                   browser case of test_a_stream_arrives_as_it_is_produced RED
   11. let the layers see an OPTIONS            -> test_every_options_request_goes_to_web RED (preflight cases)
   12. drop the OPTIONS_TO_WEB_PREFIXES routes  -> test_every_options_request_goes_to_web RED (folder cases)
   13. drop the CORS layer                      -> test_local_answers_carry_the_cors_header_web_adds RED
   14. /__front/edge reports the TCP peer       -> test_front_edge_reads_the_callers_address_the_way_web_does RED
   15. /__front/edge drops `no-store`           -> test_front_edge_reads_the_callers_address_the_way_web_does RED
   16. proxy drops X-Real-IP                    -> test_front_edge_and_web_are_handed_the_same_three_headers RED
   17. no keepalive_expiry on the client        -> test_an_idle_connection_to_web_is_dropped_before_web_drops_it RED
"""
from __future__ import annotations

import asyncio
import gzip
import hashlib
import json
import socket
import threading
import time

import httpx
import pytest
import uvicorn

from api import front_app

ENTRY = "assets/index-abc123.js"
SHELL = b"<!doctype html><title>shell</title><script type=module src=/assets/index-abc123.js></script>"
JS = b"console.log('entry');" * 40
GZ_BODY = gzip.compress(b"{\"rows\": [" + b"1," * 5000 + b"1]}")


# ── a build folder ────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def dist(tmp_path_factory):
    d = tmp_path_factory.mktemp("dist")
    (d / "index.html").write_bytes(SHELL)
    (d / ".vite").mkdir()
    (d / ".vite" / "manifest.json").write_text(json.dumps({
        "index.html": {"file": ENTRY, "isEntry": True, "imports": ["_v.js"], "css": ["assets/index-DDD.css"]},
        "_v.js": {"file": "assets/vendor-BBB.js"},
    }), encoding="utf-8")
    (d / "assets").mkdir()
    (d / "assets" / "index-abc123.js").write_bytes(JS)
    (d / "assets" / "index-abc123.js.br").write_bytes(b"BR-" + JS[:20])
    (d / "assets" / "index-abc123.js.gz").write_bytes(gzip.compress(JS))
    (d / "assets" / "logo-zzz.webp").write_bytes(b"RIFFxxxxWEBP")
    (d / "fonts").mkdir()
    (d / "fonts" / "a.woff2").write_bytes(b"wOF2font")
    for _path, name, _media, _cache in front_app.ROOT_FILES:
        (d / name).write_bytes(("file:" + name).encode())
    ltr = d / "live-trading-room"
    ltr.mkdir()
    for name in ("index.html", "terms.html", "privacy.html"):
        (ltr / name).write_bytes(("ltr:" + name).encode())
    (ltr / "email").mkdir()
    (ltr / "email" / "f04.jpg").write_bytes(b"\xff\xd8jpeg")
    # In the build folder, and NOT to be served from it:
    (d / "Darkpool-data.csv").write_bytes(b"gated,rows\n")
    (d / "Indexes-data.csv").write_bytes(b"gated,rows\n")
    (d / "OptionsFlow.csv").write_bytes(b"no,route\n")
    return d


# ── a stand-in for `web` ──────────────────────────────────────────────────────

#: token -> {"gone": bool}: whether the reader of a stand-in stream has gone away.
STREAMS: dict = {}


async def _upstream_app(scope, receive, send):
    if scope["type"] == "lifespan":
        while True:
            msg = await receive()
            if msg["type"] == "lifespan.startup":
                await send({"type": "lifespan.startup.complete"})
            elif msg["type"] == "lifespan.shutdown":
                await send({"type": "lifespan.shutdown.complete"})
                return
    path = scope["path"]
    body = b""
    while True:
        msg = await receive()
        body += msg.get("body", b"")
        if not msg.get("more_body"):
            break

    async def reply(status, headers, chunks):
        await send({"type": "http.response.start", "status": status, "headers": headers})
        for i, c in enumerate(chunks):
            await send({"type": "http.response.body", "body": c, "more_body": i < len(chunks) - 1})

    if path == "/api/stream":
        await send({"type": "http.response.start", "status": 200,
                    "headers": [(b"content-type", b"text/event-stream"), (b"cache-control", b"no-store")]})
        for i in range(3):
            await send({"type": "http.response.body", "body": b"data: %d\n\n" % i, "more_body": True})
            await asyncio.sleep(0.4)
        await send({"type": "http.response.body", "body": b"", "more_body": False})
        return
    if path in ("/api/forever", "/api/silent", "/api/slow-stream"):
        # A stream that ends only when whoever is reading it goes away. "forever" keeps sending;
        # "silent" sends one event and then nothing, like a quiet market. Either way the moment
        # the reader's connection closes is recorded under the caller's token.
        token = scope["query_string"].decode()
        STREAMS[token] = {"gone": False}
        if path == "/api/slow-stream":
            await asyncio.sleep(0.8)   # still working on the answer: no status line yet
            STREAMS[token] = {"gone": False, "answered": True}
        await send({"type": "http.response.start", "status": 200,
                    "headers": [(b"content-type", b"text/event-stream"), (b"cache-control", b"no-store")]})
        await send({"type": "http.response.body", "body": b"data: first\n\n", "more_body": True})

        async def reader_left():
            while (await receive())["type"] != "http.disconnect":
                pass

        left = asyncio.ensure_future(reader_left())
        try:
            while not left.done():
                if path == "/api/forever":
                    await send({"type": "http.response.body", "body": b"data: more\n\n", "more_body": True})
                await asyncio.wait({left}, timeout=0.2)
        finally:
            left.cancel()
            STREAMS[token] = dict(STREAMS[token], gone=True)
        return
    if path == "/api/stream-state":
        out = json.dumps(STREAMS.get(scope["query_string"].decode(), {"gone": None})).encode()
        return await reply(200, [(b"content-type", b"application/json")], [out])
    if path == "/api/gzip":
        return await reply(200, [(b"content-type", b"application/json"), (b"content-encoding", b"gzip"),
                                 (b"content-length", str(len(GZ_BODY)).encode()), (b"vary", b"Accept-Encoding")],
                           [GZ_BODY])
    if path == "/api/cookies":
        return await reply(200, [(b"content-type", b"text/plain"), (b"set-cookie", b"a=1; Path=/"),
                                 (b"set-cookie", b"b=2; Path=/; HttpOnly")], [b"ok"])
    if path == "/api/cors":
        return await reply(200, [(b"content-type", b"text/plain"),
                                 (b"access-control-allow-origin", b"https://chosen-by-web.example"),
                                 (b"access-control-allow-credentials", b"true"), (b"vary", b"Origin")], [b"ok"])
    if path == "/api/redirect":
        return await reply(302, [(b"location", b"/login?next=%2Fcharts"), (b"content-length", b"0")], [b""])
    if path == "/api/big":
        return await reply(200, [(b"content-type", b"application/octet-stream")], [b"x" * 65536] * 48)
    if path.startswith("/api/status/"):
        return await reply(int(path.rsplit("/", 1)[1]), [(b"content-type", b"text/plain")], [b"status"])
    echo = {
        "method": scope["method"],
        "raw_path": scope.get("raw_path", b"").decode("latin-1"),
        "query": scope["query_string"].decode("latin-1"),
        "headers": [[k.decode("latin-1"), v.decode("latin-1")] for k, v in scope["headers"]],
        "body_len": len(body),
        "body_sha": hashlib.sha256(body).hexdigest(),
        "from": "upstream",
        "peer_port": (scope.get("client") or (None, None))[1],
    }
    out = json.dumps(echo).encode()
    await reply(200, [(b"content-type", b"application/json"), (b"content-length", str(len(out)).encode()),
                      (b"x-upstream", b"1")], [out])


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class _Server:
    def __init__(self, app):
        self.port = _free_port()
        self.server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=self.port, log_level="warning",
                                                    timeout_graceful_shutdown=1))
        self.thread = threading.Thread(target=self.server.run, daemon=True)

    def __enter__(self):
        self.thread.start()
        deadline = time.time() + 15
        while not self.server.started and time.time() < deadline:
            time.sleep(0.02)
        assert self.server.started, "server did not start"
        return f"http://127.0.0.1:{self.port}"

    def __exit__(self, *exc):
        self.server.should_exit = True
        self.thread.join(timeout=15)


@pytest.fixture(scope="module")
def upstream():
    with _Server(_upstream_app) as url:
        yield url


@pytest.fixture(scope="module")
def front(dist, upstream):
    with _Server(front_app.create_app(dist=str(dist), upstream=upstream)) as url:
        yield url


@pytest.fixture()
def http():
    # No default headers of its own, so what the front door forwards is what the test sent.
    with httpx.Client(timeout=20, follow_redirects=False, trust_env=False) as c:
        for h in ("accept", "accept-encoding", "user-agent"):
            c.headers.pop(h, None)
        yield c


# ── small pure pieces ─────────────────────────────────────────────────────────

def test_upstream_base():
    assert front_app.upstream_base("web.railway.internal:8080") == "http://web.railway.internal:8080"
    assert front_app.upstream_base("http://127.0.0.1:9/") == "http://127.0.0.1:9"
    with pytest.raises(RuntimeError):
        front_app.upstream_base("")
    with pytest.raises(RuntimeError):
        front_app.upstream_base(None)


def test_path_class_drops_tickers_and_tokens():
    assert front_app.path_class("/api/bars/NVDA") == "/api/bars"
    assert front_app.path_class("/share/n/SECRETTOKEN") == "/share/n"
    assert front_app.path_class("/") == "/"


def test_the_app_refuses_to_start_without_a_build_or_an_upstream(tmp_path, dist):
    async def start(app):
        async with app.router.lifespan_context(app):
            pass

    with pytest.raises(RuntimeError, match="no built frontend"):
        asyncio.run(start(front_app.create_app(dist=str(tmp_path), upstream="127.0.0.1:1")))
    with pytest.raises(RuntimeError, match="FRONT_UPSTREAM"):
        asyncio.run(start(front_app.create_app(dist=str(dist), upstream="")))


# ── what it serves itself ─────────────────────────────────────────────────────

def test_health_does_not_depend_on_the_upstream(dist):
    """A restart of `web` must not take the front door out of rotation."""
    dead = f"127.0.0.1:{_free_port()}"
    with _Server(front_app.create_app(dist=str(dist), upstream=dead)) as url:
        r = httpx.get(url + "/__front/health", timeout=10)
        assert r.status_code == 200
        assert r.json() == {"status": "ok", "role": "front", "build_id": ENTRY, "commit": ""}
        assert r.headers["cache-control"] == "no-store"


def test_build_json_is_the_frontends_identity(front, http, monkeypatch):
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", "cafe1234")
    r = http.get(front + "/build.json")
    assert r.status_code == 200
    assert r.json() == {"build_id": ENTRY, "commit": "cafe1234"}
    assert r.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("path", ["/", "/charts", "/journal/notebook", "/settings/integrations", "/api", "/.env",
                                  "/OptionsFlow.csv", "/.vite/manifest.json", "/assets"])
def test_the_app_shell_answers_every_other_read(front, http, path):
    r = http.get(front + path)
    assert r.status_code == 200
    assert r.content == SHELL
    assert r.headers["cache-control"] == "no-cache, no-store, must-revalidate"
    assert r.headers["link"] == (
        "</assets/index-abc123.js>; rel=preload; as=script; crossorigin, "
        "</assets/vendor-BBB.js>; rel=preload; as=script; crossorigin, "
        "</assets/index-DDD.css>; rel=preload; as=style; crossorigin")
    assert "x-robots-tag" not in r.headers


@pytest.mark.parametrize("path,noindex", [("/share/n", True), ("/share/n/tok", True), ("/p", True), ("/p/slug", True),
                                          ("/pricing", False), ("/share/notes", False), ("/portfolio-heat", False)])
def test_public_note_pages_are_not_indexed(front, http, path, noindex):
    r = http.get(front + path)
    assert r.status_code == 200 and r.content == SHELL
    assert (r.headers.get("x-robots-tag") == "noindex, nofollow") is noindex
    assert (r.headers.get("referrer-policy") == "no-referrer") is noindex


def test_hashed_assets_are_immutable_and_precompressed(front, http):
    plain = http.get(front + "/" + ENTRY)
    assert plain.status_code == 200 and plain.content == JS
    assert plain.headers["cache-control"] == "public, max-age=31536000, immutable, no-transform"
    assert plain.headers["vary"] == "Accept-Encoding"
    assert "content-encoding" not in plain.headers

    with http.stream("GET", front + "/" + ENTRY, headers={"Accept-Encoding": "br, gzip"}) as br:
        assert br.headers["content-encoding"] == "br"
        assert b"".join(br.iter_raw()) == b"BR-" + JS[:20]
    with http.stream("GET", front + "/" + ENTRY, headers={"Accept-Encoding": "gzip"}) as gz:
        assert gz.headers["content-encoding"] == "gzip"
        assert gzip.decompress(b"".join(gz.iter_raw())) == JS

    img = http.get(front + "/assets/logo-zzz.webp")
    assert img.headers["cache-control"] == "public, max-age=31536000, immutable, no-transform"
    font = http.get(front + "/fonts/a.woff2")
    assert font.status_code == 200 and font.headers["cache-control"].startswith("public, max-age=31536000, immutable")


@pytest.mark.parametrize("path", ["/assets/index-GONE.js", "/assets/index-abc123.js.br", "/assets/index-abc123.js.gz",
                                  "/fonts/missing.woff2", "/assets/..%2Findex.html", "/assets/%2e%2e%2f.vite%2fmanifest.json"])
def test_a_missing_asset_is_404_never_the_shell(front, http, path):
    r = http.get(front + path)
    assert r.status_code == 404, (path, r.status_code)
    assert r.content != SHELL


@pytest.mark.parametrize("path,name,media,cache", front_app.ROOT_FILES)
def test_root_files(front, http, path, name, media, cache):
    r = http.get(front + path)
    assert r.status_code == 200
    assert r.content == ("file:" + name).encode()
    assert r.headers["content-type"] == media
    assert r.headers.get("cache-control") == cache


def test_live_trading_room_pages_redirects_and_folder(front, http):
    for suffix, name in front_app.LIVE_TRADING_ROOM_PAGES:
        r = http.get(front + "/live-trading-room" + suffix)
        assert (r.status_code, r.content) == (200, ("ltr:" + name).encode())
        assert r.headers["cache-control"] == "public, max-age=300"
        assert r.headers["content-type"] == "text/html; charset=utf-8"
        slash = http.get(front + "/live-trading-room" + suffix + "/")
        assert slash.status_code == 301 and slash.headers["location"] == "/live-trading-room" + suffix
    assert http.get(front + "/live-trading-room/email/f04.jpg").content == b"\xff\xd8jpeg"


@pytest.mark.parametrize("path", ["/Darkpool-data.csv", "/Indexes-data.csv"])
def test_files_in_the_build_are_not_served_from_disk(front, http, path):
    """They sit in the build folder. `web` decides who may read them; this app must ask it."""
    r = http.get(front + path)
    assert r.json()["from"] == "upstream"
    assert b"gated" not in r.content


# ── what it passes through ────────────────────────────────────────────────────

def _headers(echo) -> dict:
    out = {}
    for k, v in echo["headers"]:
        out.setdefault(k, []).append(v)
    return out


def test_the_request_arrives_unchanged(front, http):
    sent = {
        "Host": "uctintelligence.com",
        "X-Forwarded-For": "172.70.1.9, 100.64.0.3",
        "X-Real-IP": "203.0.113.50",
        "CF-Connecting-IP": "203.0.113.50",
        "X-Forwarded-Proto": "https",
        "Cookie": "uct_session=abc; theme=oled",
        "Authorization": "Bearer t",
        "Origin": "https://uctintelligence.com",
    }
    r = http.get(front + "/api/bars/BRK%2EB?tf=D&since=1%2B2&x=a%20b", headers=sent)
    echo = r.json()
    assert echo["method"] == "GET"
    assert echo["raw_path"] == "/api/bars/BRK%2EB"            # not decoded and re-encoded
    assert echo["query"] == "tf=D&since=1%2B2&x=a%20b"
    got = _headers(echo)
    for name, value in sent.items():
        assert got[name.lower()] == [value], name
    assert r.headers["x-upstream"] == "1"


def test_no_headers_are_invented(front, http):
    """A client that sent no Accept-Encoding must not have one sent on its behalf."""
    got = _headers(http.get(front + "/api/echo").json())
    assert "accept-encoding" not in got
    assert "user-agent" not in got
    assert "x-forwarded-for" not in got and "forwarded" not in got and "via" not in got


def test_hop_by_hop_headers_stop_here(front, http):
    got = _headers(http.get(front + "/api/echo", headers={"Connection": "keep-alive, X-Secret-Hop",
                                                         "Keep-Alive": "timeout=5", "TE": "trailers",
                                                         "Upgrade": "h2c"}).json())
    for name in ("keep-alive", "te", "upgrade", "proxy-connection"):
        assert name not in got, name


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_bodies_arrive_byte_for_byte(front, http, method):
    body = bytes(range(256)) * 4096          # 1 MiB, every byte value
    echo = http.request(method, front + "/api/j2/notes/1", content=body,
                        headers={"Content-Type": "application/octet-stream"}).json()
    assert echo["method"] == method
    assert echo["body_len"] == len(body)
    assert echo["body_sha"] == hashlib.sha256(body).hexdigest()
    assert _headers(echo)["content-length"] == [str(len(body))]


def test_a_chunked_upload_arrives_whole(front, http):
    def parts():
        for i in range(50):
            yield bytes([i]) * 1000

    echo = http.post(front + "/api/upload", content=parts()).json()
    assert echo["body_len"] == 50_000
    assert echo["body_sha"] == hashlib.sha256(b"".join(parts())).hexdigest()


@pytest.mark.parametrize("path", ["/any/page", "/charts", "/api/x", "/pip-embed", "/openapi.json", "/docs"])
def test_writes_and_listed_paths_go_to_the_upstream(front, http, path):
    assert http.post(front + path, content=b"x").json()["from"] == "upstream"
    if path in front_app.PROXY_PATHS or path.startswith("/api/"):
        assert http.get(front + path).json()["from"] == "upstream"


def test_compressed_answers_are_forwarded_as_they_are(front, http):
    with http.stream("GET", front + "/api/gzip", headers={"Accept-Encoding": "gzip"}) as r:
        raw = b"".join(r.iter_raw())
        assert r.headers["content-encoding"] == "gzip"
        assert r.headers["content-length"] == str(len(GZ_BODY))
        assert r.headers["vary"] == "Accept-Encoding"
    assert raw == GZ_BODY


def test_every_set_cookie_survives(front, http):
    r = http.get(front + "/api/cookies")
    assert r.headers.get_list("set-cookie") == ["a=1; Path=/", "b=2; Path=/; HttpOnly"]


def test_a_redirect_is_passed_on_not_followed(front, http):
    r = http.get(front + "/api/redirect")
    assert r.status_code == 302 and r.headers["location"] == "/login?next=%2Fcharts"


@pytest.mark.parametrize("status", [204, 304, 401, 403, 404, 409, 429, 500, 503])
def test_statuses_pass_through(front, http, status):
    assert http.get(front + f"/api/status/{status}").status_code == status


def test_one_date_and_one_server_header(front, http):
    r = http.get(front + "/api/echo")
    assert len(r.headers.get_list("date")) == 1
    assert len(r.headers.get_list("server")) == 1


def test_a_large_answer_arrives_whole(front, http):
    r = http.get(front + "/api/big")
    assert len(r.content) == 65536 * 48


@pytest.mark.parametrize("headers", [{}, {"Accept-Encoding": "gzip", "Origin": "https://elsewhere.example"}])
def test_a_stream_arrives_as_it_is_produced(front, http, headers):
    """The stand-in sends three events 0.4 s apart. A proxy that buffers delivers all three
    at the end; one that streams delivers the first long before the last. The second case is
    a browser: it accepts gzip, and a compressor in the way would hold the events back."""
    arrivals = []
    start = time.perf_counter()
    with http.stream("GET", front + "/api/stream", headers=headers) as r:
        assert "content-encoding" not in r.headers
        assert r.headers["content-type"].startswith("text/event-stream")
        for chunk in r.iter_raw():
            if chunk:
                arrivals.append((time.perf_counter() - start, chunk))
    body = b"".join(c for _, c in arrivals)
    assert body == b"data: 0\n\ndata: 1\n\ndata: 2\n\n"
    first, last = arrivals[0][0], arrivals[-1][0]
    # The events leave 0.8 s apart, first to last. Buffered, they arrive in the same instant.
    # No deadline on the first one: this gates promotion, and a shared runner that stalls for
    # half a second must not read as a broken proxy. The spread is what tells the two apart.
    assert len(arrivals) >= 2, "the three events arrived as one piece: the stream was buffered"
    assert last - first > 0.25, f"events arrived together ({first:.2f}s, {last:.2f}s): the stream was buffered"


def test_a_head_request_has_headers_and_no_body(front, http):
    r = http.head(front + "/api/echo")
    assert r.status_code == 200 and r.content == b"" and r.headers["x-upstream"] == "1"


# ── gzip and CORS: on what this app answers itself, never on what it passes on ─
#
# `web` wraps every answer in gzip (outside) and CORS (inside). These prove the front door
# does the same to its own answers; tests/test_front_app_parity.py proves the settings are
# `web`'s. Measured on production 2026-11-14: `web` compresses every answer that has a
# body, however small, and no answer that has none.

ELSEWHERE = "https://elsewhere.example"


def _get_raw(http, url, headers):
    with http.stream("GET", url, headers=headers) as r:
        return r, b"".join(r.iter_raw())


@pytest.mark.parametrize("path,body", [
    ("/", SHELL), ("/charts", SHELL), ("/share/n/tok", SHELL),
    ("/robots.txt", b"file:robots.txt"), ("/og-image.png", b"file:og-image.png"),
    ("/live-trading-room/terms", b"ltr:terms.html"), ("/live-trading-room/email/f04.jpg", b"\xff\xd8jpeg"),
])
def test_local_answers_are_gzipped_however_small(front, http, path, body):
    r, raw = _get_raw(http, front + path, {"Accept-Encoding": "gzip"})
    assert r.headers.get("content-encoding") == "gzip", path
    assert r.headers["vary"] == "Accept-Encoding"
    assert gzip.decompress(raw) == body
    plain, raw_plain = _get_raw(http, front + path, {})
    assert "content-encoding" not in plain.headers and raw_plain == body


def test_build_json_is_gzipped_though_it_is_tiny(front, http):
    r, raw = _get_raw(http, front + "/build.json", {"Accept-Encoding": "gzip"})
    assert r.headers.get("content-encoding") == "gzip" and r.headers["vary"] == "Accept-Encoding"
    assert json.loads(gzip.decompress(raw))["build_id"] == ENTRY
    assert r.headers["cache-control"] == "no-store"


def test_an_answer_with_no_body_is_not_compressed(front, http):
    """A redirect and a HEAD have no body. gzip of nothing is 20 bytes of body where there
    must be none."""
    r, raw = _get_raw(http, front + "/live-trading-room/", {"Accept-Encoding": "gzip"})
    assert r.status_code == 301 and raw == b"" and "content-encoding" not in r.headers
    h = http.head(front + "/", headers={"Accept-Encoding": "gzip"})
    assert h.status_code == 200 and "content-encoding" not in h.headers
    assert h.headers["content-length"] == str(len(SHELL))


def test_hashed_assets_and_fonts_are_never_recompressed(front, http):
    for path, body in (("/assets/logo-zzz.webp", b"RIFFxxxxWEBP"), ("/fonts/a.woff2", b"wOF2font")):
        r, raw = _get_raw(http, front + path, {"Accept-Encoding": "gzip"})
        assert "content-encoding" not in r.headers and raw == body, path


@pytest.mark.parametrize("path", ["/", "/charts", "/build.json", "/robots.txt", "/og-image.png", "/" + ENTRY,
                                  "/fonts/a.woff2", "/live-trading-room", "/live-trading-room/email/f04.jpg"])
def test_local_answers_carry_the_cors_header_web_adds(front, http, path):
    r = http.get(front + path, headers={"Origin": ELSEWHERE})
    assert r.status_code == 200 and r.headers.get_list("access-control-allow-origin") == ["*"]
    assert "access-control-allow-origin" not in http.get(front + path).headers


def test_cors_with_a_cookie_names_the_origin_and_varies_on_it(front, http):
    """`web` answers a request that carries a cookie with the origin itself, never `*`."""
    r, _raw = _get_raw(http, front + "/", {"Origin": ELSEWHERE, "Cookie": "a=1", "Accept-Encoding": "gzip"})
    assert r.headers.get_list("access-control-allow-origin") == [ELSEWHERE]
    assert r.headers["vary"] == "Origin, Accept-Encoding"
    assert r.headers.get("content-encoding") == "gzip"


def test_a_passed_through_answer_is_not_compressed_or_cors_marked_here(front, http):
    """The stand-in for `web` neither compresses /api/echo nor adds a CORS header to it. If
    either shows up, this app added it."""
    r, raw = _get_raw(http, front + "/api/echo", {"Accept-Encoding": "gzip", "Origin": ELSEWHERE, "Cookie": "a=1"})
    assert json.loads(raw)["from"] == "upstream"
    for added in ("content-encoding", "access-control-allow-origin", "vary"):
        assert added not in r.headers, added
    assert r.headers["content-length"] == str(len(raw))


def test_the_cors_answer_web_chose_arrives_as_web_wrote_it(front, http):
    r = http.get(front + "/api/cors", headers={"Origin": ELSEWHERE})
    assert r.headers.get_list("access-control-allow-origin") == ["https://chosen-by-web.example"]
    assert r.headers.get_list("access-control-allow-credentials") == ["true"]
    assert r.headers.get_list("vary") == ["Origin"]


@pytest.mark.parametrize("path", ["/", "/charts", "/build.json", "/robots.txt", "/" + ENTRY, "/assets/index-GONE.js",
                                  "/fonts/a.woff2", "/live-trading-room", "/live-trading-room/terms",
                                  "/live-trading-room/email/f04.jpg", "/api/echo", "/openapi.json"])
@pytest.mark.parametrize("preflight", [True, False])
def test_every_options_request_goes_to_web(front, http, path, preflight):
    """`web`'s own CORS layer answers a preflight. This app never does: the stand-in adds no
    CORS header, so one in the answer would have been made here."""
    headers = {"Origin": ELSEWHERE, "Access-Control-Request-Method": "GET"} if preflight else {}
    r = http.request("OPTIONS", front + path, headers=headers)
    assert r.status_code == 200 and r.json()["from"] == "upstream" and r.json()["method"] == "OPTIONS"
    assert "access-control-allow-origin" not in r.headers and "access-control-allow-methods" not in r.headers


# ── /__front/edge: what the edge said about the caller, read the way `web` reads it ─
#
# `web` limits by client address, derived from three headers Railway's edge writes. The
# front door forwards them untouched (test_the_request_arrives_unchanged). This endpoint
# applies `web`'s own function to them HERE, so one request without a login shows what
# `web` will see for traffic that comes through this service.

CF_EDGE = "173.245.48.5"        # inside Cloudflare's published ranges
RAILWAY_PROXY = "100.64.0.9"


@pytest.mark.parametrize("headers,expected", [
    # through Cloudflare: the edge that connected is Cloudflare's, so CF-Connecting-IP is the member
    ({"X-Forwarded-For": f"{CF_EDGE}, {RAILWAY_PROXY}", "X-Real-IP": "198.51.100.7", "CF-Connecting-IP": "198.51.100.7"},
     {"client_ip": "198.51.100.7", "edge_wrote_x_forwarded_for": True, "x_forwarded_for_entries": 2,
      "connecting_address_in_cloudflare": True, "x_real_ip_present": True, "cf_connecting_ip_present": True}),
    # straight at the origin with a forged CF-Connecting-IP: Railway's X-Real-IP wins
    ({"X-Forwarded-For": f"203.0.113.50, {RAILWAY_PROXY}", "X-Real-IP": "203.0.113.50", "CF-Connecting-IP": "8.8.4.4"},
     {"client_ip": "203.0.113.50", "edge_wrote_x_forwarded_for": True, "x_forwarded_for_entries": 2,
      "connecting_address_in_cloudflare": False, "x_real_ip_present": True, "cf_connecting_ip_present": True}),
    # no edge in front at all (this test): the peer, and the endpoint says so
    ({},
     {"client_ip": "127.0.0.1", "edge_wrote_x_forwarded_for": False, "x_forwarded_for_entries": 0,
      "connecting_address_in_cloudflare": False, "x_real_ip_present": False, "cf_connecting_ip_present": False}),
])
def test_front_edge_reads_the_callers_address_the_way_web_does(front, http, headers, expected):
    r = http.get(front + "/__front/edge", headers=headers)
    assert r.status_code == 200 and r.json() == expected
    assert r.headers["cache-control"] == "no-store", "one caller's address must never be cached for another"


def test_front_edge_and_web_are_handed_the_same_three_headers(front, http):
    """The endpoint is only evidence about `web` if `web` gets the same headers. Same request,
    once to the endpoint and once passed through: the stand-in for `web` echoes what arrived."""
    sent = {"X-Forwarded-For": f"{CF_EDGE}, {RAILWAY_PROXY}", "X-Real-IP": "198.51.100.7",
            "CF-Connecting-IP": "198.51.100.7"}
    here = http.get(front + "/__front/edge", headers=sent).json()
    arrived = _headers(http.get(front + "/api/echo", headers=sent).json())
    for name, value in sent.items():
        assert arrived[name.lower()] == [value], name
    assert here["client_ip"] == arrived["cf-connecting-ip"][0]


# ── connections to `web` ──────────────────────────────────────────────────────

def test_an_idle_connection_to_web_is_dropped_before_web_drops_it(front, http):
    """The stand-in for `web` reports the port each request arrived from, which names the
    connection. Back to back, two requests share one (connections ARE reused). After the front
    door's idle limit has passed, the next request must arrive on a new one: the front door let
    go first, well inside `web`'s own 5 s, so it never writes into a connection `web` is closing."""
    first = http.get(front + "/api/echo").json()["peer_port"]
    again = http.get(front + "/api/echo").json()["peer_port"]
    assert first == again, "two back-to-back requests did not share a connection: nothing is being reused"
    time.sleep(front_app.UPSTREAM_KEEPALIVE_EXPIRY_S + 0.5)
    later = http.get(front + "/api/echo").json()["peer_port"]
    assert later != first, "an idle connection outlived the front door's limit"
    assert front_app.UPSTREAM_KEEPALIVE_EXPIRY_S + 0.5 < 5, "the wait above must stay inside web's own idle limit"


# ── when the member leaves ────────────────────────────────────────────────────

@pytest.mark.parametrize("kind", ["forever", "silent"])
def test_when_the_member_leaves_a_stream_the_connection_to_web_is_dropped(front, http, kind):
    """A closed tab must end the stream on `web` too. If the front door kept its side open,
    `web` would go on producing a stream nobody reads and the front door would hold one of
    its connections to `web` for as long as that lasted; enough closed tabs and there are
    none left for anyone. "silent" is the hard case: with nothing left to send, nothing ever
    fails, so the front door has to notice the member leaving by watching for it."""
    token = f"{kind}-{time.time_ns()}"
    with http.stream("GET", front + f"/api/{kind}?{token}") as r:
        events = r.iter_raw()   # held in a name: letting go of this iterator is itself a disconnect
        first = next(events)
        assert first.startswith(b"data: first"), first
        assert http.get(front + f"/api/stream-state?{token}").json() == {"gone": False}   # live through both hops
    # leaving the block closes the member's connection mid-stream, as closing a tab does
    deadline = time.time() + 5
    state = None
    while time.time() < deadline:
        state = http.get(front + f"/api/stream-state?{token}").json()
        if state["gone"]:
            break
        time.sleep(0.1)
    assert state == {"gone": True}, "5 s after the member left, `web` was still streaming to them"


def test_a_member_who_left_before_the_answer_started_does_not_leave_a_stream_open(front, http):
    """The member asks, `web` takes 0.8 s to begin answering, and the member is gone after
    0.2 s. When `web`'s stream finally starts there is nobody to give it to. Nothing has been
    sent yet, so nothing has failed, and a pass-through that only cleans up from inside its
    streaming loop never gets there. The connection to `web` must still be dropped."""
    token = f"slow-{time.time_ns()}"
    host, port = front.replace("http://", "").split(":")
    s = socket.create_connection((host, int(port)), timeout=5)
    s.sendall(f"GET /api/slow-stream?{token} HTTP/1.1\r\nHost: {host}\r\n\r\n".encode())
    time.sleep(0.2)
    s.close()                                                # gone before any answer
    deadline = time.time() + 6
    state = {}
    while time.time() < deadline:
        state = http.get(front + f"/api/stream-state?{token}").json()
        if state.get("answered") and state.get("gone"):
            break
        time.sleep(0.1)
    assert state.get("answered"), "the stand-in never got as far as answering: the test proved nothing"
    assert state.get("gone"), "`web` began a stream for a member who had already left, and it was never closed"


# ── when `web` is not there ───────────────────────────────────────────────────

def test_an_unreachable_upstream_is_a_fast_502(dist, http):
    """What members get today while `web` restarts, and what the in-app banner keys on.
    Fast: no retry, no holding the request."""
    dead = f"127.0.0.1:{_free_port()}"
    with _Server(front_app.create_app(dist=str(dist), upstream=dead)) as url:
        started = time.perf_counter()
        r = http.get(url + "/api/auth/me")
        elapsed = time.perf_counter() - started
        assert r.status_code == 502
        assert r.headers["x-uct-front"] == "upstream-unreachable"
        assert r.headers["cache-control"] == "no-store"
        assert elapsed < front_app.CONNECT_TIMEOUT_S + 2, f"took {elapsed:.1f}s"
        # and the frontend still loads
        assert http.get(url + "/charts").content == SHELL
        assert http.get(url + "/" + ENTRY).content == JS
        assert http.get(url + "/build.json").json()["build_id"] == ENTRY


# ── the service's own configuration ───────────────────────────────────────────

def test_the_service_config_starts_this_app_with_no_disk_and_two_copies():
    """`front/service.json` is the Railway config for the front-door service. It must start
    THIS app, run more than one copy (that is what makes a release gapless), check a health
    path that does not depend on `web`, and never be picked up by `web`'s own watch list."""
    import os

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(root, "front", "service.json"), encoding="utf-8") as f:
        cfg = json.load(f)
    deploy, build = cfg["deploy"], cfg["build"]
    # ⚰️ The first version was a bare `uvicorn ... --port $PORT`. For a Dockerfile service Railway runs
    # the start command in EXEC form: no shell, so `$PORT` stays the literal text "$PORT" and uvicorn
    # refuses to start (Railway docs, "Build and Start Commands"). The command must go through a shell,
    # and `exec` hands the process over so uvicorn receives the stop signal itself.
    import shlex

    argv = shlex.split(deploy["startCommand"])
    assert argv[:2] == ["/bin/sh", "-c"] and len(argv) == 3, argv
    assert argv[2].startswith("exec uvicorn api.front_app:app --host 0.0.0.0 --port ${PORT:-8080}"), argv[2]
    import shutil
    import subprocess

    sh = shutil.which("sh")
    if sh:   # run the real line in a real shell, with uvicorn replaced by echo: the port must be a number
        script = argv[2].replace("exec uvicorn ", "echo ")
        out = subprocess.run([sh, "-c", script], capture_output=True, text=True, env={"PORT": "9123", "PATH": os.environ.get("PATH", "")}).stdout
        assert "--port 9123" in out and "$" not in out, out
    assert "--proxy-headers" not in deploy["startCommand"], "the front door forwards the edge's headers, it does not interpret them"
    assert "--no-access-log" in deploy["startCommand"], "uvicorn's access log prints raw URLs (tickers, share tokens)"
    assert deploy["numReplicas"] >= 2
    assert deploy["healthcheckPath"] == "/__front/health"
    assert "volumes" not in json.dumps(cfg).lower() and "requiredMountPath" not in deploy
    assert build["dockerfilePath"] == "Dockerfile.web", "one image, one frontend build stage, one VITE_* list"
    assert "app/**" in build["watchPatterns"]
    with open(os.path.join(root, "railway.web.json"), encoding="utf-8") as f:
        web_patterns = json.load(f)["build"]["watchPatterns"]
    import fnmatch
    assert not any(fnmatch.fnmatch("front/service.json", p) for p in web_patterns), (
        "a change to the front door's config would restart web")
