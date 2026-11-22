"""One reader for the Vite manifest, and `/build.json`: the frontend's identity.

`/api/health` `build_id` has always been the web process's own bundled frontend.
That stops being the members' frontend the day the built frontend is served by a
different process than the API, so the frontend's identity gets its own answer:
`GET /build.json` -> `{"build_id": "assets/index-<hash>.js", "commit": "<sha>"}`.

`api/services/build_manifest.py` is the one place that reads
`<dist>/.vite/manifest.json`. It imports only `json` and `os`, so a process that
must not pay for `import api.main` (a static front end) can use it too.

Mutation proof (run before calling these done):
    1. make `entry_build_id` return the leading-slash form  -> test_entry_build_id_reads_the_entry_row RED
    2. change the route's Cache-Control to `no-cache`         -> test_build_json_route RED
    3. drop `commit` from the health body                     -> test_health_reports_commit RED
"""
from __future__ import annotations

import json

import pytest
from httpx import ASGITransport, AsyncClient

from api.services import build_manifest

ENTRY = "assets/index-abc123.js"

MANIFEST = {
    "index.html": {"file": ENTRY, "isEntry": True, "src": "index.html",
                   "imports": ["_vendor-react-BBB.js", "_vendor-swr-CCC.js"],
                   "css": ["assets/index-DDD.css"], "dynamicImports": ["src/pages/X.jsx"]},
    "_vendor-react-BBB.js": {"file": "assets/vendor-react-BBB.js"},
    "_vendor-swr-CCC.js": {"file": "assets/vendor-swr-CCC.js"},
    "src/pages/X.jsx": {"file": "assets/X-EEE.js", "isDynamicEntry": True},
}


def _write_manifest(dist, rows=None, raw=None):
    vite = dist / ".vite"
    vite.mkdir(parents=True, exist_ok=True)
    text = raw if raw is not None else json.dumps(MANIFEST if rows is None else rows)
    (vite / "manifest.json").write_text(text, encoding="utf-8")


# ── the module ────────────────────────────────────────────────────────────────

def test_entry_build_id_reads_the_entry_row(tmp_path):
    _write_manifest(tmp_path)
    assert build_manifest.entry_build_id(str(tmp_path)) == ENTRY


def test_entry_build_id_strips_a_leading_slash(tmp_path):
    _write_manifest(tmp_path, {"index.html": {"file": "/" + ENTRY, "isEntry": True}})
    assert build_manifest.entry_build_id(str(tmp_path)) == ENTRY


def test_entry_build_id_is_empty_without_a_manifest(tmp_path):
    assert build_manifest.entry_build_id(str(tmp_path)) == ""


def test_entry_build_id_is_empty_on_malformed_json(tmp_path):
    _write_manifest(tmp_path, raw="{not json")
    assert build_manifest.entry_build_id(str(tmp_path)) == ""


def test_entry_build_id_is_empty_when_the_row_is_not_an_entry(tmp_path):
    _write_manifest(tmp_path, {"index.html": {"file": ENTRY}})
    assert build_manifest.entry_build_id(str(tmp_path)) == ""


def test_early_hint_link_lists_entry_vendors_then_css(tmp_path):
    _write_manifest(tmp_path)
    assert build_manifest.early_hint_link(str(tmp_path)) == (
        "</assets/index-abc123.js>; rel=preload; as=script; crossorigin, "
        "</assets/vendor-react-BBB.js>; rel=preload; as=script; crossorigin, "
        "</assets/vendor-swr-CCC.js>; rel=preload; as=script; crossorigin, "
        "</assets/index-DDD.css>; rel=preload; as=style; crossorigin"
    )


def test_early_hint_link_is_empty_without_a_manifest(tmp_path):
    assert build_manifest.early_hint_link(str(tmp_path)) == ""


def test_early_hint_link_matches_main(tmp_path, monkeypatch):
    """Two processes will send this header; they must send the same one."""
    import api.main as main
    _write_manifest(tmp_path)
    monkeypatch.setattr(main, "DIST", str(tmp_path))
    monkeypatch.setattr(main, "_EARLY_HINTS_CACHE", None)
    try:
        assert main.early_hint_link_header() == build_manifest.early_hint_link(str(tmp_path))
        assert main.early_hint_link_header() != ""
    finally:
        main._EARLY_HINTS_CACHE = None


def test_build_info_shape(tmp_path):
    _write_manifest(tmp_path)
    assert build_manifest.build_info(str(tmp_path), "abc") == {"build_id": ENTRY, "commit": "abc"}


def test_build_info_without_a_commit_or_a_build(tmp_path):
    assert build_manifest.build_info(str(tmp_path), None) == {"build_id": "", "commit": ""}


def test_the_module_stays_importable_without_the_app():
    """A static front end imports this; it must never pull in the API."""
    import ast
    import inspect

    tree = ast.parse(inspect.getsource(build_manifest))
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom):
            imported.add((node.module or "").split(".")[0])
    assert imported <= {"json", "os", "__future__"}, imported


# ── the routes ────────────────────────────────────────────────────────────────

@pytest.fixture
def main_with_dist(tmp_path, monkeypatch):
    import api.main as main
    _write_manifest(tmp_path)
    monkeypatch.setattr(main, "DIST", str(tmp_path))
    monkeypatch.setattr(main, "_BUILD_ID_CACHE", None, raising=False)
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", "deadbeef")
    yield main
    main._BUILD_ID_CACHE = None


async def _get(main, path):
    async with AsyncClient(transport=ASGITransport(app=main.app), base_url="http://test") as ac:
        return await ac.get(path)


async def test_build_json_route(main_with_dist):
    r = await _get(main_with_dist, "/build.json")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-store"
    assert r.headers["content-type"].startswith("application/json")
    assert r.json() == {"build_id": ENTRY, "commit": "deadbeef"}


async def test_build_json_route_without_a_build(tmp_path, monkeypatch):
    import api.main as main
    monkeypatch.setattr(main, "DIST", str(tmp_path))          # no manifest here
    monkeypatch.setattr(main, "_BUILD_ID_CACHE", None, raising=False)
    monkeypatch.delenv("RAILWAY_GIT_COMMIT_SHA", raising=False)
    try:
        r = await _get(main, "/build.json")
        assert r.status_code == 200
        assert r.json() == {"build_id": "", "commit": ""}
    finally:
        main._BUILD_ID_CACHE = None


async def test_build_json_agrees_with_health(main_with_dist):
    """Until the frontend is served elsewhere, both answers name the same build."""
    b = (await _get(main_with_dist, "/build.json")).json()
    h = (await _get(main_with_dist, "/api/health")).json()
    assert b["build_id"] == h["build_id"] == ENTRY


async def test_health_reports_commit(main_with_dist):
    r = await _get(main_with_dist, "/api/health")
    assert r.status_code == 200
    assert r.json()["commit"] == "deadbeef"
