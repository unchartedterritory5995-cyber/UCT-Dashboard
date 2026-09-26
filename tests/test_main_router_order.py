"""Wave 6 controller wiring -- the mount ORDER in api/main.py is load-bearing.

`notebook_insights` serves `/api/j2/notes/tasks` and `/api/j2/notes/{id}/unlinked-mentions`;
`journal_two` serves `/api/j2/notes/{note_id}`. FastAPI answers on first match, so if
journal_two is mounted first, a request for `/api/j2/notes/tasks` is answered as a note
whose id is the string "tasks" (lane F's report, wave6-F-report.md). Lane F's own
`test_notebook_insights_router.py` proves the ROUTER behaves under both orders; this
file pins what main.py actually DOES.

Two checks, and they fail for different reasons:
- the AST check reads the statement order out of main.py's source and never imports it
  (cheap, and immune to a startup side effect masking the answer);
- the app check imports the real app under pytest's shared-data-root sandbox and walks
  its route table, so a mount that resolves to nothing (a typo'd module name that the AST
  would still "see") is caught.
Each carries a non-vacuity control: the probe must find BOTH statements / BOTH routes,
or an empty result would read as a pass (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
"""
from __future__ import annotations

import ast
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MAIN = REPO / "api" / "main.py"


def _include_router_lines() -> dict[str, int]:
    """{router alias: line} for every top-level `app.include_router(<alias>.router)`."""
    tree = ast.parse(MAIN.read_text(encoding="utf-8"))
    found: dict[str, int] = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        fn = node.func
        if not (isinstance(fn, ast.Attribute) and fn.attr == "include_router"):
            continue
        if not node.args:
            continue
        arg = node.args[0]
        if isinstance(arg, ast.Attribute) and isinstance(arg.value, ast.Name) and arg.attr == "router":
            found.setdefault(arg.value.id, node.lineno)
    return found


def test_notebook_insights_is_mounted_before_journal_two__by_source_order():
    lines = _include_router_lines()
    # Non-vacuity: the probe sees both mounts (a renamed alias would otherwise pass vacuously).
    assert "notebook_insights_router" in lines, f"notebook_insights mount not found; saw {sorted(lines)[:10]}..."
    assert "journal_two_router" in lines, "journal_two mount not found"
    assert lines["notebook_insights_router"] < lines["journal_two_router"], (
        f"notebook_insights (line {lines['notebook_insights_router']}) must be mounted BEFORE "
        f"journal_two (line {lines['journal_two_router']}), or /api/j2/notes/tasks is answered as a note")


def test_the_three_wave6_routers_are_mounted__by_source():
    lines = _include_router_lines()
    for alias in ("notebook_insights_router", "client_errors_router", "notebook_link_preview_router"):
        assert alias in lines, f"{alias} is imported but never mounted"


def test_the_routes_resolve_and_tasks_precedes_the_note_id_wildcard__on_the_real_app():
    # Under pytest the repo-root conftest has already pinned every /data path to a sandbox
    # and armed the tripwire, so importing the app is safe here (it is NOT safe bare).
    from api.main import app  # noqa: WPS433 -- deliberate late import, see above

    paths = [getattr(r, "path", None) for r in app.routes]
    paths = [p for p in paths if isinstance(p, str)]
    # Non-vacuity: the table is populated and holds the wildcard we compare against.
    assert len(paths) > 100
    assert "/api/j2/notes/{note_id}" in paths, "journal_two's note route is missing"
    assert "/api/j2/notes/tasks" in paths, "notebook_insights' tasks route did not mount"
    assert "/api/j2/link-preview" in paths, "notebook_link_preview did not mount"
    assert any(p.startswith("/api/client-errors") for p in paths), "client_errors did not mount"
    assert paths.index("/api/j2/notes/tasks") < paths.index("/api/j2/notes/{note_id}"), (
        "/api/j2/notes/tasks is shadowed by /api/j2/notes/{note_id}: a request for the tasks view "
        "would be answered as a note whose id is 'tasks'")
