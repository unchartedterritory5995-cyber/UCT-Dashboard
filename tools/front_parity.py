"""Compare two origins path class by path class: does B answer the way A does?

Built for one job: before any member traffic is sent to the front door
(`api/front_app.py`), prove over the real network that it answers like `web`.

    python tools/front_parity.py --a https://<web origin> --b https://<front door origin>
    python tools/front_parity.py --self-check

For every path class (app shell, public-note pages, hashed assets, fonts, root files,
live-trading-room pages, a missing asset, the passed-through API) it requests the same
path from both origins, once per `Accept-Encoding` in (br, gzip, none) and with and
without an `Origin` header (Cloudflare caches the `Origin` variant of a module script as a
separate object, so a difference there reaches members even when the plain request
matches), and compares: status, content-type, cache-control, content-encoding, vary,
link, x-robots-tag, referrer-policy, location, and a SHA-256 of the body (of what a gzip
stream contains, since gzip embeds a timestamp; of the bytes as sent otherwise).

Exit codes, three different facts:
    0  every comparison matched
    1  a MEASURED difference (printed: path, variant, field, A, B)
    2  INCONCLUSIVE: an origin could not be reached, no assets were discovered, or a
       class had nothing to compare. Never a pass.

What it deliberately does not compare, and says so in its report:
  * etag, last-modified, date, server, and anything a CDN or platform adds (cf-*, x-railway-*);
  * the app shell's bytes, the Link header and hashed-asset BYTES when the two origins
    carry different builds (their entry scripts differ). Two images built separately may
    not be byte-identical; each origin's shell then points at its own files, which is
    correct. Headers are still compared, using each origin's own files.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import re
import sys
import urllib.error
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/130.0.0.0 Safari/537.36 uct-front-parity/1")
ORIGIN = "https://uctintelligence.com"
COMPARED = ("content-type", "cache-control", "content-encoding", "vary", "link",
            "x-robots-tag", "referrer-policy", "location")
IGNORED = ("etag", "last-modified", "date", "server", "content-length", "cf-*", "x-railway-*")
ENCODINGS = (("br", "br"), ("gzip", "gzip"), ("none", None))

SHELL_PATHS = ("/", "/charts", "/journal/notebook", "/zz-no-such-page")
PUBLIC_NOTE_PATHS = ("/share/n/zz-parity", "/p/zz-parity")
ROOT_FILES = ("/manifest.json", "/sw.js", "/push-sw.js", "/favicon.svg", "/vite.svg", "/og-image.png",
              "/og-coming-soon.png", "/q1-probe.html", "/robots.txt", "/sitemap.xml")
LIVE_TRADING_ROOM = ("/live-trading-room", "/live-trading-room/", "/live-trading-room/terms",
                     "/live-trading-room/privacy")
MISSING = ("/assets/index-ZZNOSUCHFILE.js", "/fonts/zz-no-such-font.woff2")
PASSED_THROUGH = ("/api/health", "/build.json", "/Darkpool-data.csv", "/openapi.json")

_ASSET_RE = re.compile(r"""(?:src|href)=["'](/(?:assets|fonts)/[^"'?#]+)["']""")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **kw):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def fetch(base: str, path: str, encoding: str | None, with_origin: bool, timeout: float = 30.0):
    """(status, {lower header: value}, sha256 of the body as sent) or raises OSError."""
    req = urllib.request.Request(base.rstrip("/") + path, headers={"User-Agent": UA, "Accept": "*/*"})
    if encoding:
        req.add_header("Accept-Encoding", encoding)
    if with_origin:
        req.add_header("Origin", ORIGIN)
    try:
        resp = _OPENER.open(req, timeout=timeout)
    except urllib.error.HTTPError as exc:      # 3xx/4xx/5xx are answers, not failures
        resp = exc
    body = resp.read()
    headers = {k.lower(): v for k, v in resp.headers.items()}
    # A gzip stream carries a timestamp, so the same answer compressed in two different
    # seconds is two different byte strings (measured 2026-11-14: the live origin "differed"
    # from itself on 5 of 192 comparisons, all gzip). Hash what gzip CONTAINS. Brotli here is
    # only ever a file compressed at build time, so its bytes are compared as sent.
    hashed = body
    if headers.get("content-encoding") == "gzip":
        try:
            hashed = gzip.decompress(body)
        except (OSError, EOFError):
            hashed = body
    return (resp.status if hasattr(resp, "status") else resp.code, headers,
            hashlib.sha256(hashed).hexdigest(), body)


def discover_assets(base: str):
    """The hashed assets and fonts the origin's own app shell refers to, entry script first."""
    _status, _headers, _sha, body = fetch(base, "/", None, False)
    found = []
    for m in _ASSET_RE.finditer(body.decode("utf-8", "replace")):
        if m.group(1) not in found:
            found.append(m.group(1))
    return found


#: Answers that mean "the server behind this origin is not there right now" (a restart, a
#: deploy). They are not a property of either origin, so a run that sees one has no verdict.
GATEWAY_STATUSES = (502, 503, 504)


def _compare(path_a: str, path_b: str, a_base: str, b_base: str, *, body: bool, skip=(), seen=None):
    """Yield (path, variant, field, value at A, value at B) for every difference.
    `seen` collects (origin, path, status) for every answer, so the caller can tell a
    measured difference from an origin that was restarting."""
    for label, coding in ENCODINGS:
        for with_origin in (False, True):
            variant = f"accept-encoding={label}, origin={'yes' if with_origin else 'no'}"
            sa, ha, xa, _ = fetch(a_base, path_a, coding, with_origin)
            sb, hb, xb, _ = fetch(b_base, path_b, coding, with_origin)
            if seen is not None:
                seen.append(("A", path_a, sa))
                seen.append(("B", path_b, sb))
            if sa != sb:
                yield (path_a, variant, "status", sa, sb)
            for name in COMPARED:
                if name not in skip and ha.get(name) != hb.get(name):
                    yield (path_a, variant, name, ha.get(name), hb.get(name))
            if body and xa != xb:
                yield (path_a, variant, "body sha256", xa[:16], xb[:16])


#: A server that booted less than this many seconds ago is still warming: answers are slow
#: and some time out. Comparing then measures the warm-up, and adds load to it.
MIN_UPTIME_S = 300


def uptime_seconds(base: str):
    """`uptime_seconds` from the origin's /api/health, or None when it does not report one."""
    import json

    try:
        _status, _headers, _sha, body = fetch(base, "/api/health", None, False, timeout=15.0)
        value = json.loads(body.decode("utf-8", "replace")).get("uptime_seconds")
        return value if isinstance(value, (int, float)) else None
    except (OSError, ValueError, AttributeError):
        return None


def run(a_base: str, b_base: str, out=print, min_uptime: float = MIN_UPTIME_S) -> int:
    # ⚰️ 2026-11-14: a run started 60 s after a restart got through one class, then the origin
    # stopped answering for 12 s at a time. It was warming up, and the run was extra load on it.
    for label, base in (("A", a_base), ("B", b_base)):
        up = uptime_seconds(base)
        if up is not None and up < min_uptime:
            out(f"INCONCLUSIVE: the server behind {label} booted {up:.0f} s ago and is still warming. "
                f"Wait until it has been up {min_uptime:.0f} s, then run again.")
            return 2
    try:
        assets_a, assets_b = discover_assets(a_base), discover_assets(b_base)
    except OSError as exc:
        out(f"INCONCLUSIVE: an origin could not be reached: {exc!r}")
        return 2
    if not assets_a or not assets_b:
        out(f"INCONCLUSIVE: no assets discovered in the app shell (A: {len(assets_a)}, B: {len(assets_b)})")
        return 2
    same_build = assets_a == assets_b
    out(f"A = {a_base}\nB = {b_base}")
    out(f"assets discovered: A {len(assets_a)}, B {len(assets_b)}; "
        + ("same build (bytes compared)" if same_build else
           "DIFFERENT builds: shell bytes, Link and asset bytes are not compared, headers still are"))
    out(f"compared: status, {', '.join(COMPARED)}, body sha256. ignored: {', '.join(IGNORED)}")

    diffs, compared, seen = [], 0, []
    try:
        classes = [
            ("app shell", [(p, p) for p in SHELL_PATHS], same_build, () if same_build else ("link",)),
            ("public-note pages", [(p, p) for p in PUBLIC_NOTE_PATHS], same_build, () if same_build else ("link",)),
            ("root files", [(p, p) for p in ROOT_FILES], True, ()),
            ("live-trading-room", [(p, p) for p in LIVE_TRADING_ROOM], True, ()),
            ("missing files", [(p, p) for p in MISSING], False, ()),
            ("passed through", [(p, p) for p in PASSED_THROUGH], False, ()),
        ]
        if same_build:
            classes.insert(2, ("hashed assets and fonts", [(p, p) for p in assets_a], True, ()))
        else:   # each origin's own entry script and first font: same header policy expected
            pairs = [(assets_a[0], assets_b[0])]
            fa = [p for p in assets_a if p.startswith("/fonts/")]
            fb = [p for p in assets_b if p.startswith("/fonts/")]
            if fa and fb:
                pairs.append((fa[0], fb[0]))
            classes.insert(2, ("hashed assets and fonts (headers only)", pairs, False, ()))
        for name, pairs, body, skip in classes:
            if not pairs:
                out(f"INCONCLUSIVE: nothing to compare in class '{name}'")
                return 2
            found = []
            for pa, pb in pairs:
                found += list(_compare(pa, pb, a_base, b_base, body=body, skip=skip, seen=seen))
                compared += len(ENCODINGS) * 2
            out(f"  {'DIFFERENT' if found else 'same     '}  {name} ({len(pairs)} paths)")
            diffs += found
    except OSError as exc:
        out(f"INCONCLUSIVE: an origin stopped answering part way: {exc!r}")
        return 2

    gateway = sorted({(o, p, st) for o, p, st in seen if st in GATEWAY_STATUSES})
    if gateway:
        # ⚰️ 2026-11-14: the first real run compared the live origin with ITSELF and reported 95
        # "differences". The server restarted mid-run: one fetch got a 502, the next got the page.
        out(f"INCONCLUSIVE: {len(gateway)} answer(s) were gateway errors, so an origin was restarting "
            f"or down during the run. Run again when both are steady. First: {gateway[:3]}")
        return 2
    after = uptime_seconds(a_base)
    if after is not None and after < min_uptime:
        out(f"INCONCLUSIVE: the server behind A restarted during the run (up {after:.0f} s). Run again.")
        return 2
    for path, variant, field, va, vb in diffs:
        out(f"    {path} [{variant}] {field}: A={va!r} B={vb!r}")
    if diffs:
        out(f"RESULT: {len(diffs)} difference(s) across {compared} comparisons")
        return 1
    out(f"RESULT: identical across {compared} comparisons")
    return 0


def self_check(out=print) -> int:
    """Prove the tool can report each of its three answers, against real local servers."""
    import contextlib
    import os
    import socket
    import tempfile
    import threading
    import time

    import uvicorn

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from api import front_app

    def build(folder, shell_extra=b""):
        os.makedirs(os.path.join(folder, ".vite"))
        os.makedirs(os.path.join(folder, "assets"))
        os.makedirs(os.path.join(folder, "fonts"))
        os.makedirs(os.path.join(folder, "live-trading-room"))
        open(os.path.join(folder, "index.html"), "wb").write(
            b'<script type="module" src="/assets/index-abc123.js"></script>'
            b'<link rel="preload" href="/fonts/a.woff2">' + shell_extra)
        open(os.path.join(folder, ".vite", "manifest.json"), "w").write(
            '{"index.html": {"file": "assets/index-abc123.js", "isEntry": true}}')
        open(os.path.join(folder, "assets", "index-abc123.js"), "wb").write(b"console.log(1)")
        open(os.path.join(folder, "fonts", "a.woff2"), "wb").write(b"font")
        for name in [f.lstrip("/") for f in ROOT_FILES] + ["live-trading-room/index.html",
                                                          "live-trading-room/terms.html",
                                                          "live-trading-room/privacy.html"]:
            open(os.path.join(folder, name), "wb").write(name.encode())

    async def upstream(scope, receive, send):
        if scope["type"] != "http":
            return
        await send({"type": "http.response.start", "status": 200, "headers": [(b"content-type", b"text/plain")]})
        await send({"type": "http.response.body", "body": b"upstream"})

    def with_header_changed(app, path, name, value):
        async def wrapped(scope, receive, send):
            async def patched(message):
                if message["type"] == "http.response.start" and scope.get("path") == path:
                    message = dict(message, headers=[(k, v) for k, v in message["headers"] if k != name]
                                   + [(name, value)])
                await send(message)
            await app(scope, receive, patched if scope["type"] == "http" else send)
        return wrapped

    @contextlib.contextmanager
    def serve(app):
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error",
                                               timeout_graceful_shutdown=1))
        t = threading.Thread(target=server.run, daemon=True)
        t.start()
        deadline = time.time() + 15
        while not server.started and time.time() < deadline:
            time.sleep(0.02)
        try:
            yield f"http://127.0.0.1:{port}"
        finally:
            server.should_exit = True
            t.join(timeout=15)

    quiet = lambda *_a, **_k: None   # noqa: E731
    results = []
    with tempfile.TemporaryDirectory() as tmp:
        d1, d2 = os.path.join(tmp, "one"), os.path.join(tmp, "two")
        os.makedirs(d1), os.makedirs(d2)
        build(d1), build(d2)
        with serve(upstream) as up:
            a = front_app.create_app(dist=d1, upstream=up)
            b = front_app.create_app(dist=d2, upstream=up)
            wrong = with_header_changed(front_app.create_app(dist=d2, upstream=up), "/og-image.png",
                                        b"cache-control", b"public, max-age=1")
            with serve(a) as ua, serve(b) as ub, serve(wrong) as uw:
                results.append(("two identical origins -> 0", run(ua, ub, quiet), 0))
                lines = []
                results.append(("one header differs -> 1", run(ua, uw, lines.append), 1))
                named = any("/og-image.png" in ln and "cache-control" in ln for ln in lines)
                results.append(("...and the report names the path and the field", 0 if named else 1, 0))
                dead = socket.socket()
                dead.bind(("127.0.0.1", 0))
                port = dead.getsockname()[1]
                dead.close()
                results.append(("an unreachable origin -> 2", run(ua, f"http://127.0.0.1:{port}", quiet), 2))
                def restarting(app):
                    async def wrapped(scope, receive, send):
                        if scope["type"] == "http" and scope.get("path") == "/og-image.png":
                            await send({"type": "http.response.start", "status": 502,
                                        "headers": [(b"content-type", b"application/json")]})
                            await send({"type": "http.response.body", "body": b'{"status":"error","code":502}'})
                            return
                        await app(scope, receive, send)
                    return wrapped

                with serve(restarting(front_app.create_app(dist=d2, upstream=up))) as ur:
                    results.append(("an origin answering 502 mid-run -> 2, never 1", run(ua, ur, quiet), 2))

                async def young(scope, receive, send):
                    if scope["type"] != "http":
                        return
                    await send({"type": "http.response.start", "status": 200,
                                "headers": [(b"content-type", b"application/json")]})
                    await send({"type": "http.response.body", "body": b'{"status":"ok","uptime_seconds":42}'})

                with serve(young) as uy, serve(front_app.create_app(dist=d1, upstream=uy)) as uay,                         serve(front_app.create_app(dist=d2, upstream=uy)) as uby:
                    results.append(("a server that booted 42 s ago -> 2 before any comparison",
                                    run(uay, uby, quiet), 2))
                    results.append(("...and the same pair compares clean when the caller lowers the floor",
                                    run(uay, uby, quiet, min_uptime=10), 0))
        empty = os.path.join(tmp, "empty")
        os.makedirs(empty)
        open(os.path.join(empty, "index.html"), "wb").write(b"<title>no scripts</title>")
        with serve(upstream) as up, serve(front_app.create_app(dist=d1, upstream=up)) as ua, \
                serve(front_app.create_app(dist=empty, upstream=up)) as ue:
            results.append(("a shell with no assets -> 2", run(ua, ue, quiet), 2))
    ok = True
    for label, got, want in results:
        ok &= got == want
        out(f"  {'ok  ' if got == want else 'FAIL'} {label} (got {got})")
    out("self-check passed" if ok else "self-check FAILED")
    return 0 if ok else 1


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--a", help="the reference origin (web)")
    p.add_argument("--b", help="the origin under test (the front door)")
    p.add_argument("--self-check", action="store_true", help="prove the tool can report 0, 1 and 2")
    p.add_argument("--min-uptime", type=float, default=MIN_UPTIME_S,
                   help=f"refuse to run against a server up for fewer seconds than this (default {MIN_UPTIME_S})")
    args = p.parse_args(argv)
    if args.self_check:
        return self_check()
    if not (args.a and args.b):
        p.error("--a and --b are required (or --self-check)")
    return run(args.a, args.b, min_uptime=args.min_uptime)


if __name__ == "__main__":
    sys.exit(main())
