"""W3 — the 15 admin routes wrapped in `run_in_threadpool`, smoke-checked.

These are diagnostic/maintenance tools with no prior test coverage; the fix here
is purely mechanical (the existing body moved into a `def _sync():` closure,
called via `run_in_threadpool` instead of running inline on the loop — see
`tests/test_oi44_loop_blockers_gate.py` for the loop-safety proof). This file
checks the mechanical move itself didn't introduce a scoping bug: every route
still answers (never a bare 500 from an escaped exception), against an empty
throwaway `flow.db`/`contract_oi_snapshots` so no route touches real data.
"""
import sqlite3

import pytest
from fastapi.testclient import TestClient

from api.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    db_path = str(tmp_path / "flow.db")
    conn = sqlite3.connect(db_path)
    conn.execute(
        "CREATE TABLE flow (id INTEGER PRIMARY KEY, source TEXT, CreatedDate TEXT, "
        "CreatedTime TEXT, Symbol TEXT, CallPut TEXT, Strike REAL, ExpirationDate TEXT, "
        "Volume INTEGER, Premium REAL, Color TEXT, MktCap REAL, Sector TEXT, OI INTEGER, "
        "Side TEXT)"
    )
    conn.execute(
        "CREATE TABLE contract_oi_snapshots (contract_key TEXT, snap_date TEXT, oi INTEGER)"
    )
    conn.commit()
    conn.close()
    monkeypatch.setenv("FLOW_DB_PATH", db_path)
    import api.flow_db as flow_db
    monkeypatch.setattr(flow_db.FlowDB.__init__, "__defaults__", (db_path,))
    # These 15 routes are gated by AdminGuardMiddleware (session cookie -> admin role),
    # not a per-route Depends -- patch the name it actually calls (bound at import into
    # its own module namespace), so the real gate logic still runs on a real admin user.
    import api.middleware.admin_guard as admin_guard
    monkeypatch.setattr(admin_guard, "validate_session",
                        lambda token: {"id": 1, "role": "admin", "email": "admin@test"})
    c = TestClient(app)
    c.cookies.set("uct_session", "fake-admin-session-for-this-test-only")
    return c


ROUTES = [
    ("GET", "/api/admin/massive/diagnose", None),
    ("GET", "/api/admin/flow/plan", None),
    ("POST", "/api/admin/flow/optimize", None),
    ("POST", "/api/admin/massive/reclassify-source", None),
    ("POST", "/api/admin/massive/backfill-mktcap", None),
    ("POST", "/api/admin/massive/normalize-sweep-sides", None),
    ("GET", "/api/admin/massive/cluster-debug", None),
    ("GET", "/api/admin/massive/color-debug", None),
    ("GET", "/api/admin/ticker-types/lookup", {"ticker": "NVDA"}),
    ("GET", "/api/admin/ticker-types/stats", None),
    ("GET", "/api/admin/oi/lookup-key", {"key": "NVDA|C|100.0|1/1/2027"}),
    ("GET", "/api/admin/oi/zero-analysis", None),
    ("GET", "/api/admin/oi/table-diagnose", None),
    ("POST", "/api/admin/oi/create-indexes", None),
    ("POST", "/api/admin/flow/delete-by-date", {"target_date": "1/1/2026", "confirm": False}),
]


@pytest.mark.parametrize("method,path,params", ROUTES, ids=[p for _, p, _ in ROUTES])
def test_route_answers_without_a_bare_500(client, method, path, params):
    resp = client.request(method, path, params=params)
    assert resp.status_code != 500, (
        f"{method} {path} raised past its own try/except — likely a scoping bug "
        f"from the run_in_threadpool move: {resp.text[:500]}"
    )
    # A route that used to answer 200/JSON before the move must still be
    # well-formed JSON after it -- the wrap must not change the response shape.
    resp.json()


def test_flow_delete_by_date_confirm_false_never_mutates(client, tmp_path):
    """The one destructive route in the batch: confirm=False must stay preview-only
    through the run_in_threadpool move, or a smoke/diagnostic call could delete rows."""
    db_path = str(tmp_path / "flow.db")
    conn = sqlite3.connect(db_path)
    conn.execute("INSERT INTO flow (source, CreatedDate, Symbol) VALUES ('stocks','1/1/2026','NVDA')")
    conn.commit()
    conn.close()
    resp = client.post("/api/admin/flow/delete-by-date",
                       params={"target_date": "1/1/2026", "confirm": False})
    assert resp.json().get("preview") is True
    conn = sqlite3.connect(db_path)
    count = conn.execute("SELECT COUNT(*) FROM flow").fetchone()[0]
    conn.close()
    assert count == 1, "confirm=False deleted a row -- the preview gate broke in the move"
