"""An `async def` route that never awaits runs ON the event loop -- one blocking call inside it
(SQLite, a sync HTTP client, file I/O) freezes every request on the pod. A plain `def` runs on
the threadpool instead.

⚰️ Captured live 2026-09-29 by the event-loop watchdog: a 5,019 ms stall 58 s after boot, the
loop thread inside `desk_zoom_webhook.insights_status` -> `education_service.list_videos()` ->
`fetchall()` (and the pod's max lag that session: 13.6 s). Both desk diagnostics are now `def`.

The census is SHRINK-ONLY: a new handler of this shape fails by name; one converted (or given a
real await) must leave the baseline in the same change. Keyed on `file::function`, never a line
number, so an unrelated edit cannot make it flap. The 60-odd survivors are worked down BY
EVIDENCE -- the watchdog's `/api/watchdog/stacks` names the one that actually stalled -- never
by a mass conversion, which would move all of them onto the one shared threadpool at once.
"""
from __future__ import annotations

import ast
import json
import pathlib
import textwrap

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASELINE = pathlib.Path(__file__).with_name("async_route_no_await_baseline.json")
ROUTE_METHODS = {"get", "post", "put", "patch", "delete", "api_route"}


def census(root: pathlib.Path) -> set[str]:
    out = set()
    for p in sorted(root.rglob("*.py")):
        try:
            tree = ast.parse(p.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.AsyncFunctionDef):
                continue
            if not any(isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute)
                       and d.func.attr in ROUTE_METHODS for d in node.decorator_list):
                continue
            if not any(isinstance(n, (ast.Await, ast.AsyncFor, ast.AsyncWith)) for n in ast.walk(node)):
                out.add(f"{p.relative_to(root.parent).as_posix()}::{node.name}")
    return out


def test_no_new_async_route_that_never_awaits():
    now = census(ROOT / "api")
    base = set(json.loads(BASELINE.read_text(encoding="utf-8"))["handlers"])
    assert len(now) > 20, "the census found almost nothing -- a broken scan passes everything"
    new = sorted(now - base)
    assert not new, ("async route handlers that never await (they run ON the event loop): "
                     f"{new} -- declare them `def`, or await something real")
    stale = sorted(base - now)
    assert not stale, f"converted or removed -- take these off {BASELINE.name}: {stale}"


def test_the_two_desk_diagnostics_that_stalled_the_loop_are_plain_def():
    now = census(ROOT / "api")
    assert "api/routers/desk_zoom_webhook.py::insights_status" not in now
    assert "api/routers/desk_zoom_webhook.py::sessions_status" not in now


def test_the_census_sees_the_shape_and_only_the_shape(tmp_path):
    pkg = tmp_path / "api"
    pkg.mkdir()
    (pkg / "r.py").write_text(textwrap.dedent('''
        @router.get("/a")
        async def blocks():
            return list_videos()

        @router.get("/b")
        async def awaits(request):
            return await request.json()

        @router.get("/c")
        def threadpool():
            return list_videos()

        async def not_a_route():
            return 1
    '''), encoding="utf-8")
    assert census(pkg) == {"api/r.py::blocks"}
