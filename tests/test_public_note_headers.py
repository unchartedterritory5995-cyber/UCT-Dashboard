"""Seam S8-4 (wave 8) -- a public note page's HTML says noindex and sends no Referer.

A share link (`/share/n/<token>`) and a published page (`/p/...`) are client routes: the
server answers them with the SPA's `index.html` through `spa_fallback`, like every other
page. Two headers go on THAT response for those paths and no others:

  * `X-Robots-Tag: noindex, nofollow` -- a member's shared note must never be indexed
    (ruling D-B10: wave 8 is always noindex, with no toggle). The header is set by PATH,
    so the HTML cannot differ per publication; `robots.txt` must NOT disallow these paths,
    or a crawler never fetches the page and never sees this header.
  * `Referrer-Policy: no-referrer` -- the token IS the credential and it rides the path
    (ruling D-B1), so a click out of the page must not hand the URL to another site.

⛔ ONE FACT IN TWO LANGUAGES, PINNED. The public paths are declared in JS
(`SHARED_NOTE_PATH` in `lib/noteShareLink.js`, `PUBLISHED_PATH` in
`lib/notePublishLink.js`) and the header rule in Python (`PUBLIC_NOTE_PATH_PREFIXES` in
`api/main.py`). This file PARSES the two JS constants and requires the Python set to equal
them -- a copy of the paths here would be a third authority (the saved-views idiom).

WHY THIS RAIL SHAPE, and it was a choice: `spa_fallback` is registered only
`if os.path.exists(DIST)` (the React build), and `DIST` is fixed at import. This worktree,
like any unbuilt checkout, has no `app/dist`, so the real app has no catch-all to ask --
a rail that only asked the real app would be green by skipping. So:
  1. the REAL response builder (`api.main.spa_index_response`) is mounted as the
     catch-all of a throwaway app, with `api.main.DIST` pointed at a temp directory that
     holds an `index.html`, and asked over HTTP (GET and HEAD) -- the actual
     FileResponse, the actual headers;
  2. an AST check pins that the registered `spa_fallback` is exactly
     `return spa_index_response(full_path)`, on `/{full_path:path}` for GET and HEAD,
     inside the DIST guard -- so what (1) exercised is what production registers;
  3. when `app/dist` IS built (the gate builds it), the same questions are asked of the
     real app too.
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

REPO = Path(__file__).resolve().parents[1]
LIB = REPO / "app" / "src" / "pages" / "journal-2-0" / "lib"
SHARE_JS = LIB / "noteShareLink.js"
PUBLISH_JS = LIB / "notePublishLink.js"
MAIN = REPO / "api" / "main.py"

# The header VALUES are the specification (rulings D-B1, D-B10), so they are written here
# on purpose and compared against main.py's own dict -- two statements that must agree.
WANT = {"x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer"}
SPA_CACHE = "no-cache, no-store, must-revalidate"


def js_const(src: str, name: str) -> str:
    """The string value of `export const <name> = '<value>'`, which must appear exactly once."""
    hits = re.findall(rf"^export const {re.escape(name)}\s*=\s*(['\"])([^'\"]*)\1", src, re.M)
    assert len(hits) == 1, f"expected one `export const {name} = '...'`, found {len(hits)}"
    return hits[0][1]


def js_public_prefixes() -> set[str]:
    return {
        js_const(SHARE_JS.read_text(encoding="utf-8"), "SHARED_NOTE_PATH"),
        js_const(PUBLISH_JS.read_text(encoding="utf-8"), "PUBLISHED_PATH"),
    }


def _main():
    # Under pytest the repo-root conftest has pinned every /data path to a sandbox first.
    import api.main as main  # noqa: WPS433 -- deliberate late import
    return main


# ── the two files agree ─────────────────────────────────────────────────────

def test_the_python_prefixes_EQUAL_the_js_constants():
    want = js_public_prefixes()
    # NON-VACUITY: two distinct absolute paths were really read.
    assert len(want) == 2 and all(p.startswith("/") and len(p) > 1 for p in want), want
    got = _main().PUBLIC_NOTE_PATH_PREFIXES
    assert len(got) == len(set(got)), f"a prefix is listed twice: {got}"
    assert set(got) == want, (
        f"api/main.py marks {sorted(got)} as public-note paths but the client routes them at "
        f"{sorted(want)} -- a page would be served without noindex/no-referrer, or a header "
        "would land on a path that is not a public note")


def test_the_header_dict_is_the_specification():
    got = {k.lower(): v for k, v in _main().PUBLIC_NOTE_HEADERS.items()}
    assert got == WANT


def test_CONTROL_the_js_parser_reads_one_constant_and_refuses_ambiguity():
    assert js_const("export const X = '/a'\n", "X") == "/a"
    assert js_const('export const X = "/b"\n', "X") == "/b"
    with pytest.raises(AssertionError):
        js_const("// export const X = '/a'\n", "X")   # a comment is not a declaration
    with pytest.raises(AssertionError):
        js_const("export const X = '/a'\nexport const X = '/b'\n", "X")


# ── (1) the real response builder, over HTTP ────────────────────────────────

@pytest.fixture
def spa(tmp_path, monkeypatch):
    main = _main()
    (tmp_path / "index.html").write_text("<!doctype html><title>probe</title>", encoding="utf-8")
    monkeypatch.setattr(main, "DIST", str(tmp_path))
    fa = FastAPI()
    fa.api_route("/{full_path:path}", methods=["GET", "HEAD"])(main.spa_index_response)
    return TestClient(fa)


def _public_paths() -> list[str]:
    out = []
    for p in sorted(js_public_prefixes()):
        out += [p, p + "/", p + "/tok123", p + "/slug/n/pid9"]
    return out


def _near_misses() -> list[str]:
    """Paths that START with a public prefix's characters but are not under it -- the
    naive `startswith('/p')` would mark /pricing and /portfolio-heat -- plus ordinary pages."""
    out = ["/dashboard", "/", "/pricing", "/portfolio-heat", "/post-market", "/journal/notebook"]
    for p in sorted(js_public_prefixes()):
        out += [p + "x", p + "x/y", p.rsplit("/", 1)[0] or "/"]
    return out


@pytest.mark.parametrize("method", ["GET", "HEAD"])
def test_a_public_note_path_gets_BOTH_headers(spa, method):
    paths = _public_paths()
    assert len(paths) >= 8, "non-vacuity: the public path list collapsed"
    for path in paths:
        r = spa.request(method, path)
        assert r.status_code == 200, (path, r.status_code)
        for k, v in WANT.items():
            assert r.headers.get(k) == v, f"{method} {path}: {k}={r.headers.get(k)!r}, want {v!r}"
        assert r.headers.get("cache-control") == SPA_CACHE, f"{method} {path}: cache-control changed"
        if method == "GET":
            assert "<title>probe</title>" in r.text, f"{path} did not serve index.html"


@pytest.mark.parametrize("method", ["GET", "HEAD"])
def test_every_other_path_gets_NEITHER_header_and_the_old_response(spa, method):
    for path in _near_misses():
        r = spa.request(method, path)
        assert r.status_code == 200, (path, r.status_code)
        for k in WANT:
            assert k not in r.headers, f"{method} {path} carries {k} -- it is not a public note"
        assert r.headers.get("cache-control") == SPA_CACHE


# ── (2) what production registers is what (1) exercised ─────────────────────

def _spa_fallback_def():
    tree = ast.parse(MAIN.read_text(encoding="utf-8"))
    found = []
    for guard in ast.walk(tree):
        if not isinstance(guard, ast.If):
            continue
        cond = ast.unparse(guard.test)
        for node in guard.body:
            if isinstance(node, ast.FunctionDef) and node.name == "spa_fallback":
                found.append((cond, node))
    return found


def test_the_registered_spa_fallback_IS_the_builder_this_file_exercises():
    found = _spa_fallback_def()
    assert len(found) == 1, f"expected ONE spa_fallback inside an if-guard, found {len(found)}"
    cond, fn = found[0]
    assert cond == "os.path.exists(DIST)", f"spa_fallback's guard changed: {cond}"
    # the route it is registered on
    assert len(fn.decorator_list) == 1, "spa_fallback must carry exactly its route decorator"
    deco = fn.decorator_list[0]
    assert ast.unparse(deco.func) == "app.api_route", ast.unparse(deco)
    assert [ast.literal_eval(a) for a in deco.args] == ["/{full_path:path}"]
    methods = {kw.arg: ast.literal_eval(kw.value) for kw in deco.keywords}.get("methods")
    assert sorted(methods or []) == ["GET", "HEAD"], methods
    # …and its whole body is the builder, handed the path unchanged
    body = [n for n in fn.body if not (isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant))]
    assert len(body) == 1 and isinstance(body[0], ast.Return), ast.unparse(fn)
    assert ast.unparse(body[0].value) == "spa_index_response(full_path)", ast.unparse(body[0])


def test_CONTROL_the_ast_check_sees_a_handler_that_bypasses_the_builder():
    src = (
        "if os.path.exists(DIST):\n"
        "    @app.api_route('/{full_path:path}', methods=['GET', 'HEAD'])\n"
        "    def spa_fallback(full_path: str):\n"
        "        return FileResponse(os.path.join(DIST, 'index.html'))\n"
    )
    fn = next(n for n in ast.walk(ast.parse(src)) if isinstance(n, ast.FunctionDef))
    body = [n for n in fn.body if isinstance(n, ast.Return)]
    assert ast.unparse(body[0].value) != "spa_index_response(full_path)"


# ── (3) the real app, when the frontend is built ────────────────────────────

def test_on_the_REAL_app_when_app_dist_is_built():
    main = _main()
    if not any(getattr(r, "name", None) == "spa_fallback" for r in main.app.routes):
        pytest.skip("app/dist not built here, so the real app registers no SPA catch-all; "
                    "legs (1) and (2) above carry the proof (the gate builds dist and runs this leg)")
    client = TestClient(main.app)
    for path in _public_paths()[:3]:
        r = client.get(path)
        for k, v in WANT.items():
            assert r.headers.get(k) == v, (path, k, r.headers.get(k))
    r = client.get("/dashboard")
    assert all(k not in r.headers for k in WANT)
