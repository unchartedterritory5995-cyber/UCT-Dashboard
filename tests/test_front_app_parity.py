"""The front door and `web` must describe the built frontend identically.

`api/front_app.py` serves what `api/main.py` serves from `app/dist`. Its own tests
(`tests/test_front_app.py`) prove it behaves as IT declares. This file proves its
declarations are `web`'s:

  * the hashed-asset server is the same class object, not a copy;
  * the root-file table equals the one read out of `api/main.py`'s source;
  * the app shell and the live-trading-room pages produce the same answer from the same
    build folder through both;
  * every route `web` registers outside `/api` is accounted for: served by the front door
    or passed through to `web`. A route that is neither would be answered with the app
    shell, or (for a file in the build) could be served without `web`'s permission.

A read of `api/main.py` by AST is used where `web`'s routes exist only when a build folder
does: they are registered at import, under `if os.path.exists(DIST):`.

Mutation proof (run before calling these done):
    1. change one cache header in front_app.ROOT_FILES       -> test_root_file_table_matches_main RED
    2. remove "/pip-embed" from front_app.PROXY_PATHS         -> test_every_dist_block_route_is_accounted_for RED
    3. remove "/Darkpool-data.csv" from front_app.PROXY_PATHS -> test_every_runtime_route_outside_api_is_passed_through RED
    4. drop the Link header from front_app's shell            -> test_the_shell_is_the_same_answer RED
"""
from __future__ import annotations

import ast
import asyncio
import json
import os

import pytest

import api.main as main
from api import front_app

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATCH_ALL = "/{full_path:path}"


# ── reading api/main.py's static block ────────────────────────────────────────

def _dist_block() -> ast.If:
    """The `if os.path.exists(DIST):` block that registers the frontend's routes."""
    with open(os.path.join(ROOT, "api", "main.py"), encoding="utf-8") as f:
        tree = ast.parse(f.read())
    blocks = [n for n in tree.body if isinstance(n, ast.If)
              and ast.unparse(n.test).replace(" ", "") == "os.path.exists(DIST)"]
    blocks = [b for b in blocks if "/manifest.json" in ast.unparse(b)]
    assert len(blocks) == 1, f"expected one frontend block in api/main.py, found {len(blocks)}"
    return blocks[0]


def _value(node: ast.AST):
    """Evaluate a small expression from api/main.py in its own namespace (path constants)."""
    return eval(compile(ast.Expression(node), "api/main.py", "eval"), vars(main))  # noqa: S307 - our own source


def _route_decorators(block: ast.If):
    """(path, methods, function) for every `@app.get/post/api_route(...)` in the block."""
    out = []
    for node in ast.walk(block):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for dec in node.decorator_list:
            if not (isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute)
                    and isinstance(dec.func.value, ast.Name) and dec.func.value.id == "app"):
                continue
            verb = dec.func.attr
            path = _value(dec.args[0])
            if verb == "api_route":
                kw = {k.arg: k.value for k in dec.keywords}
                methods = tuple(sorted(_value(kw["methods"])))
            else:
                methods = (verb.upper(),)
            out.append((path, methods, node))
    return out


def _mounts(block: ast.If):
    paths = []
    for node in ast.walk(block):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "mount"
                and isinstance(node.func.value, ast.Name) and node.func.value.id == "app"):
            paths.append(_value(node.args[0]))
    return paths


def _root_files_in_main(block: ast.If):
    """(path, file, media type, Cache-Control) for every route that returns a file straight
    out of DIST: `FileResponse(os.path.join(DIST, "<file>"), media_type=..., headers=...)`."""
    rows = set()
    for path, methods, fn in _route_decorators(block):
        for ret in [n for n in ast.walk(fn) if isinstance(n, ast.Return)]:
            call = ret.value
            if not (isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id == "FileResponse"):
                continue
            first = call.args[0]
            if not (isinstance(first, ast.Call) and ast.unparse(first.func) == "os.path.join"
                    and isinstance(first.args[0], ast.Name) and first.args[0].id == "DIST"
                    and len(first.args) == 2 and isinstance(first.args[1], ast.Constant)):
                continue
            kw = {k.arg: k.value for k in call.keywords}
            media = _value(kw["media_type"]) if "media_type" in kw else None
            headers = _value(kw["headers"]) if "headers" in kw else {}
            assert set(headers) <= {"Cache-Control"}, (path, headers)
            assert methods == ("GET",), (path, methods)
            rows.add((path, first.args[1].value, media, headers.get("Cache-Control")))
    return rows


# ── a build folder both apps can serve ────────────────────────────────────────

@pytest.fixture()
def dist(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_bytes(b"<!doctype html><title>shell</title>")
    (tmp_path / ".vite").mkdir()
    (tmp_path / ".vite" / "manifest.json").write_text(json.dumps({
        "index.html": {"file": "assets/index-abc123.js", "isEntry": True, "imports": ["_v.js"],
                       "css": ["assets/index-DDD.css"]},
        "_v.js": {"file": "assets/vendor-BBB.js"},
    }), encoding="utf-8")
    ltr = tmp_path / main.LIVE_TRADING_ROOM_DIR
    ltr.mkdir()
    for name in ("index.html", "terms.html", "privacy.html"):
        (ltr / name).write_bytes(("ltr:" + name).encode())
    monkeypatch.setattr(main, "DIST", str(tmp_path))
    monkeypatch.setattr(main, "_EARLY_HINTS_CACHE", None)
    monkeypatch.setattr(main, "_BUILD_ID_CACHE", None, raising=False)
    yield tmp_path
    main._EARLY_HINTS_CACHE = None
    main._BUILD_ID_CACHE = None


def _front_route(app, path: str, method: str = "GET"):
    """The front door's endpoint function for an exact path."""
    for r in app.routes:
        if getattr(r, "path", None) == path and method in (getattr(r, "methods", None) or ()):
            return r.endpoint
    raise AssertionError(f"the front door has no {method} route {path}")


def _answer(resp) -> dict:
    """What a browser and a CDN can tell apart: status, the file, and the headers that matter."""
    keep = ("cache-control", "content-type", "link", "x-robots-tag", "referrer-policy", "location")
    with open(resp.path, "rb") as f:
        body = f.read()
    return {"status": resp.status_code, "body": body, **{k: resp.headers.get(k) for k in keep}}


# ── the same code, the same tables ────────────────────────────────────────────

def test_hashed_assets_are_served_by_the_same_class():
    assert front_app.ImmutableStaticFiles is main._ImmutableStaticFiles


def test_public_note_rules_are_the_same():
    assert front_app.PUBLIC_NOTE_PATH_PREFIXES == main.PUBLIC_NOTE_PATH_PREFIXES
    assert front_app.PUBLIC_NOTE_HEADERS == main.PUBLIC_NOTE_HEADERS
    for path in ("share/n", "share/n/tok", "p", "p/slug", "pricing", "share/notes", "", "portfolio-heat"):
        assert front_app.is_public_note_path(path) == main.is_public_note_path(path), path


def test_root_file_table_matches_main():
    in_main = _root_files_in_main(_dist_block())
    assert len(in_main) >= 8, f"the reader found only {len(in_main)} file routes in api/main.py: it has gone blind"
    assert set(front_app.ROOT_FILES) == in_main, (
        "front_app.ROOT_FILES and api/main.py's file routes differ:\n"
        f"  only in the front door: {sorted(set(front_app.ROOT_FILES) - in_main)}\n"
        f"  only in api/main.py:    {sorted(in_main - set(front_app.ROOT_FILES))}")


def test_live_trading_room_table_matches_main():
    assert front_app.LIVE_TRADING_ROOM_PATH == main.LIVE_TRADING_ROOM_PATH
    assert front_app.LIVE_TRADING_ROOM_DIR == main.LIVE_TRADING_ROOM_DIR
    pages = {front_app.LIVE_TRADING_ROOM_PATH + suffix for suffix, _ in front_app.LIVE_TRADING_ROOM_PAGES}
    assert pages == {main.LIVE_TRADING_ROOM_PATH, main.LIVE_TRADING_ROOM_TERMS_PATH, main.LIVE_TRADING_ROOM_PRIVACY_PATH}


@pytest.mark.parametrize("path", ["", "charts", "journal/notebook", "share/n/tok", "p/slug", "pricing", ".env"])
def test_the_shell_is_the_same_answer(dist, path):
    app = front_app.create_app(dist=str(dist), upstream="127.0.0.1:1")
    front = _front_route(app, CATCH_ALL)(path)
    web = main.spa_index_response(path)
    assert _answer(front) == _answer(web)
    assert _answer(web)["link"], "the build fixture produced no Link header: the comparison would be empty"


def test_live_trading_room_pages_are_the_same_answer(dist):
    app = front_app.create_app(dist=str(dist), upstream="127.0.0.1:1")
    for path, web_fn in ((main.LIVE_TRADING_ROOM_PATH, main.live_trading_room_response),
                         (main.LIVE_TRADING_ROOM_TERMS_PATH, main.live_trading_room_terms_response),
                         (main.LIVE_TRADING_ROOM_PRIVACY_PATH, main.live_trading_room_privacy_response)):
        assert _answer(_front_route(app, path)()) == _answer(web_fn()), path
        redirect = _front_route(app, path + "/")()
        assert (redirect.status_code, redirect.headers["location"]) == (301, path)


def test_build_json_is_the_same_answer(dist, monkeypatch):
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", "cafe1234")
    app = front_app.create_app(dist=str(dist), upstream="127.0.0.1:1")
    front = _front_route(app, "/build.json")()
    web = main.build_json()
    assert json.loads(front.body) == json.loads(web.body) == {"build_id": "assets/index-abc123.js", "commit": "cafe1234"}
    assert front.headers["cache-control"] == web.headers["cache-control"] == "no-store"


# ── every route outside /api is accounted for ─────────────────────────────────

def _front_serves():
    served = {p for p, *_ in front_app.ROOT_FILES}
    for suffix, _ in front_app.LIVE_TRADING_ROOM_PAGES:
        served |= {front_app.LIVE_TRADING_ROOM_PATH + suffix, front_app.LIVE_TRADING_ROOM_PATH + suffix + "/"}
    return served


def _unaccounted(paths, *, proxy_paths=front_app.PROXY_PATHS):
    ok = _front_serves() | set(proxy_paths) | {"/build.json", CATCH_ALL}
    return sorted(p for p in paths if not (p == "/api" or p.startswith("/api/")) and p not in ok)


def test_every_dist_block_route_is_accounted_for():
    """The routes `web` registers only when a build exists (read from source)."""
    block = _dist_block()
    paths = [p for p, _m, _fn in _route_decorators(block)]
    assert CATCH_ALL in paths and "/pip-embed" in paths, "the reader no longer sees the block's routes"
    assert _unaccounted(paths) == [], (
        "api/main.py registers these outside /api and the front door neither serves them nor "
        "passes them to web, so it would answer them with the app shell: add each to "
        f"front_app.ROOT_FILES (a plain file) or front_app.PROXY_PATHS (anything else): {_unaccounted(paths)}")
    assert set(_mounts(block)) == {"/assets", "/fonts", main.LIVE_TRADING_ROOM_PATH}, _mounts(block)


def test_every_runtime_route_outside_api_is_passed_through():
    """The routes `web` registers with or without a build (read from the live app)."""
    paths = {getattr(r, "path", None) for r in main.app.routes} - {None}
    assert "/api/health" in paths and "/build.json" in paths, "the route table looks empty"
    assert _unaccounted(paths) == [], (
        "web has routes outside /api that the front door would answer with the app shell: "
        f"add each to front_app.PROXY_PATHS: {_unaccounted(paths)}")


def test_the_accounting_can_fail():
    """Controls: an unlisted server page, and a listed one removed, are both reported."""
    assert _unaccounted(["/api/x", "/manifest.json", "/zz-new-server-page"]) == ["/zz-new-server-page"]
    without = tuple(p for p in front_app.PROXY_PATHS if p != "/pip-embed")
    assert _unaccounted(["/pip-embed", "/docs"], proxy_paths=without) == ["/pip-embed"]
    assert _unaccounted(["/api", "/api/anything/at/all"]) == []


def test_files_web_gates_are_passed_through_not_served():
    """Both CSVs are files in the build folder. They are in PROXY_PATHS so that `web`
    decides who reads them; neither may ever appear in the table of files served from disk."""
    served = _front_serves()
    for gated in ("/Darkpool-data.csv", "/Indexes-data.csv"):
        assert gated in front_app.PROXY_PATHS
        assert gated not in served


def test_the_front_door_declares_routes_the_way_main_does(dist):
    """Same shape, so the same quirks: file routes answer GET only (a HEAD falls to the
    catch-all, as it does on `web`), and the catch-all answers GET and HEAD."""
    app = front_app.create_app(dist=str(dist), upstream="127.0.0.1:1")
    by_path = {}
    for r in app.routes:
        if getattr(r, "path", None) and getattr(r, "methods", None):
            by_path.setdefault(r.path, []).append(tuple(sorted(r.methods)))
    for path, *_ in front_app.ROOT_FILES:
        assert by_path[path] == [("GET",)], (path, by_path[path])
    assert ("GET", "HEAD") in by_path[CATCH_ALL]
    in_main = {p: m for p, m, _fn in _route_decorators(_dist_block())}
    assert in_main[CATCH_ALL] == ("GET", "HEAD")
