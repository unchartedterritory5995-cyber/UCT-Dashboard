"""R45 — the owner can read what the store holds, from a phone, without reading anything private.

⛔⛔ THE HAZARD THIS GUARDS. `/api/admin/wisdom` is NOT covered by `AdminGuardMiddleware`
(`api/middleware/admin_guard.py:27-34` lists the guarded prefixes and this is not among them), so
the `Depends(require_admin)` on the route IS the only gate. A status route that forgot it would be
PUBLIC, and it reads the store.

⭐ And the second hazard is subtler: a status endpoint is exactly where "just one more field" turns
into a member's sentence on a screen. This route answers **how much is in there**, never **what**.
The AST test below reads the route module and refuses any SELECT of a text-bearing column.

⚠️ No new route was added. The counts extend the EXISTING `GET /api/admin/wisdom/core/status`,
so the pinned 27-route list and the dark-check walk are untouched — a promotion that adds no
surface is a promotion with less to argue about.
"""
from __future__ import annotations

import ast
import pathlib
import re

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
ROUTE_FILE = REPO / "api" / "routers" / "wisdom_core.py"


def _source() -> str:
    return ROUTE_FILE.read_text(encoding="utf-8")


def test_the_status_route_still_carries_the_admin_dependency():
    """⛔ The dependency is the ONLY gate on this prefix."""
    src = _source()
    block = src.split('@router.get("/status")', 1)[1].split("@router.get", 1)[0]
    assert "Depends(require_admin)" in block, "the status route lost its only gate"
    assert "from api.middleware.auth_middleware import require_admin" in src


def test_every_route_in_this_module_is_guarded():
    """Non-vacuity for the check above: it must hold for the whole module, not one route.

    ⛔ AST, NEVER A REGEX. The first version of this matched the signature up to the first `)`,
    so a MULTI-LINE signature was truncated and its guard — on the second line — was invisible:
    it reported `wisdom_runs` unguarded when `wisdom_runs` is guarded at wisdom_core.py:121.
    A check that reports a property of its own pattern is the defect this repo lists six times.
    """
    tree = ast.parse(_source())
    routes = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef):
            continue
        decorated = any(isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute)
                        and getattr(d.func.value, "id", None) == "router" for d in node.decorator_list)
        if not decorated:
            continue
        args = [a.arg for a in node.args.args + node.args.kwonlyargs]
        defaults = ast.unparse(node.args)
        routes.append((node.name, args, defaults))
    assert routes, "the route scan matched nothing — it cannot have proved anything"
    for name, _args, defaults in routes:
        assert "require_admin" in defaults or "require_owner" in defaults, f"{name} is unguarded"


def test_the_counted_tables_are_declared_once_and_are_all_wisdom_tables():
    from api.routers import wisdom_core

    assert wisdom_core.STATUS_COUNT_TABLES, "nothing is counted"
    for table in wisdom_core.STATUS_COUNT_TABLES:
        assert table.startswith("wisdom_"), table
    assert len(set(wisdom_core.STATUS_COUNT_TABLES)) == len(wisdom_core.STATUS_COUNT_TABLES)


def test_a_missing_table_reports_null_rather_than_killing_the_route():
    """⚠️ A status route that 503s because one table is absent tells the owner nothing."""
    import sqlite3

    from api.routers import wisdom_core

    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE wisdom_records (a INTEGER)")
    conn.execute("INSERT INTO wisdom_records VALUES (1)")
    counts = wisdom_core._row_counts(conn)
    assert counts["wisdom_records"] == 1
    assert counts["wisdom_segments"] is None, "an absent table must read null, not 0"


def test_an_absent_table_is_not_reported_as_zero():
    """⛔ THE DISTINCTION. 0 means 'measured, empty'; null means 'could not measure'. Collapsing
    them is the CoverageLine defect — the owner would read a missing table as an empty store."""
    import sqlite3

    from api.routers import wisdom_core

    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE wisdom_records (a INTEGER)")          # present, empty
    counts = wisdom_core._row_counts(conn)
    assert counts["wisdom_records"] == 0
    assert counts["wisdom_segments"] is None


def test_the_route_reads_no_text_bearing_column():
    """⛔⛔ §0.4f. Counts only. An AST walk over every string constant in the module's own status
    helpers, refusing any SELECT that names a column known to carry extracted text."""
    text_columns = ("quote", "statement", "name", "summary", "text", "notes", "title",
                    "market_signal_json", "fields")
    tree = ast.parse(_source())
    offenders = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef) or node.name not in (
                "_row_counts", "_floored_stability", "_records_pending"):
            continue
        for sub in ast.walk(node):
            if isinstance(sub, ast.Constant) and isinstance(sub.value, str):
                sql = sub.value.lower()
                if "select" not in sql:
                    continue
                for column in text_columns:
                    if re.search(rf"\b{column}\b", sql):
                        offenders.append((node.name, column, sql[:60]))
    assert not offenders, offenders


def test_the_text_column_check_can_actually_fire():
    """The control. The same predicate must catch a planted violation."""
    text_columns = ("quote", "statement")
    planted = "SELECT quote FROM wisdom_records"
    assert any(re.search(rf"\b{c}\b", planted.lower()) for c in text_columns)


def test_the_floored_stability_reader_groups_by_counts_only():
    import sqlite3

    from api.routers import wisdom_core

    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE wisdom_records (record_type TEXT, stability REAL, stability_runs INT)")
    conn.executemany("INSERT INTO wisdom_records VALUES (?,?,?)",
                     [("PRINCIPLE", 1.0, 3), ("PRINCIPLE", 1.0, 3), ("MARKET_SIGNAL", None, None)])
    out = wisdom_core._floored_stability(conn)
    assert out["PRINCIPLE"]["1.0000/3"] == 2
    assert out["MARKET_SIGNAL"]["unscored"] == 1
    for bucket in out.values():
        for value in bucket.values():
            assert isinstance(value, int)


def test_the_records_pending_reader_groups_by_counts_only():
    """R79: the status route's PENDING gauge, read fresh from the real floor module."""
    import sqlite3

    from api.routers import wisdom_core

    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE wisdom_records (record_id TEXT, record_type TEXT, stability REAL, "
                 "stability_runs INT)")
    conn.executemany("INSERT INTO wisdom_records VALUES (?,?,?,?)",
                     [("p1", "PRINCIPLE", None, None), ("p2", "PRINCIPLE", 1.0, 1),
                      ("ok", "PRINCIPLE", 1.0, 3), ("blocked", "CALL", 0.4, 5)])
    out = wisdom_core._records_pending(conn)
    assert out == {"records_pending": 2, "records_pending_by_type": {"PRINCIPLE": 2}}


def test_a_records_pending_failure_reports_null_rather_than_killing_the_route():
    """⚠️ Same defensive shape as `_row_counts` — a status route must not 500 over one query."""
    import sqlite3

    from api.routers import wisdom_core

    conn = sqlite3.connect(":memory:")   # no wisdom_records table at all
    out = wisdom_core._records_pending(conn)
    assert out == {"records_pending": None, "records_pending_by_type": {}}


def test_no_new_route_was_added_so_the_pinned_list_is_untouched():
    """⭐ R45 extends an existing route on purpose. If this ever becomes a 28th route, the pinned
    EXPECTED_GET_ROUTES and the literal 27 must both move — and this test is the reminder."""
    floor_tests = (REPO / "tests" / "test_wisdom_item3_floor.py").read_text(encoding="utf-8")
    assert "== 27" in floor_tests, "the route count pin moved; R45's no-new-surface claim is stale"
