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
    if path == "/api/gzip":
        return await reply(200, [(b"content-type", b"application/json"), (b"content-encoding", b"gzip"),
                                 (b"content-length", str(len(GZ_BODY)).encode()), (b"vary", b"Accept-Encoding")],
                           [GZ_BODY])
    if path == "/api/cookies":
        return await reply(200, [(b"content-type", b"text/plain"), (b"set-cookie", b"a=1; Path=/"),
                                 (b"set-cookie", b"b=2; Path=/; HttpOnly")], [b"ok"])
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


def test_a_stream_arrives_as_it_is_produced(front, http):
    """The stand-in sends three events 0.4 s apart. A proxy that buffers delivers all three
    at the end; one that streams delivers the first long before the last."""
    arrivals = []
    start = time.perf_counter()
    with http.stream("GET", front + "/api/stream") as r:
        assert r.headers["content-type"].startswith("text/event-stream")
        for chunk in r.iter_raw():
            if chunk:
                arrivals.append((time.perf_counter() - start, chunk))
    body = b"".join(c for _, c in arrivals)
    assert body == b"data: 0\n\ndata: 1\n\ndata: 2\n\n"
    first, last = arrivals[0][0], arrivals[-1][0]
    assert first < 0.35, f"first event took {first:.2f}s: the stream was buffered"
    assert last - first > 0.5, f"events arrived together ({first:.2f}s, {last:.2f}s)"


def test_a_head_request_has_headers_and_no_body(front, http):
    r = http.head(front + "/api/echo")
    assert r.status_code == 200 and r.content == b"" and r.headers["x-upstream"] == "1"


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
