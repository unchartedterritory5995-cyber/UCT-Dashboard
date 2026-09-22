"""Packet I CP1 -- GET /api/leader-persistence/{symbol}'s first-ever test
coverage. Signed by the owner 2026-09-22 (fingerprint 830cec48e).

⛔⛔ THIS ENDPOINT DOES A CROSS-REPO IMPORT (`uct_intelligence.api` /
`uct_intelligence.db`), resolved from `UCT_INTEL_PATH` (default
`C:\\Users\\Patrick\\uct-intelligence` -- a REAL directory on this box, per
CLAUDE.md's own project table). An un-isolated test would import the real
engine package and read the real, live `uct_intelligence.db` -- exactly the
"C:\\data is real on this box" hazard class this repo's own conftest.py
tripwire exists for, except for a *different* root the tripwire does not
cover. Every test below injects a fully fake `uct_intelligence` package tree
into `sys.modules` before the endpoint ever runs, so this file can never
reach the real checkout regardless of what exists on the machine running it.
"""
import contextlib
import sqlite3
import sys
import types

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
import api.routers.intelligence as intelligence_router

FREE_USER = {"id": "lp-free-1", "email": "lpfree@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "lp-paid-1", "email": "lppaid@example.test", "role": "member", "plan": "pro"}


@pytest.fixture
def fake_engine(tmp_path, monkeypatch):
    """Injects a fully fake uct_intelligence.api / uct_intelligence.db into
    sys.modules for the duration of the test. Returns a `seed(rows)` helper
    that inserts (snapshot_date, symbol) pairs into the fake
    leadership_snapshots table."""
    db_path = str(tmp_path / "fake_uct_intelligence.db")
    init = sqlite3.connect(db_path)
    init.execute("CREATE TABLE leadership_snapshots (snapshot_date TEXT, symbol TEXT)")
    init.commit()
    init.close()

    @contextlib.contextmanager
    def _get_connection():
        c = sqlite3.connect(db_path)
        c.row_factory = sqlite3.Row
        try:
            yield c
        finally:
            c.close()

    fake_api = types.ModuleType("uct_intelligence.api")
    fake_db = types.ModuleType("uct_intelligence.db")
    fake_db.get_connection = _get_connection
    fake_pkg = types.ModuleType("uct_intelligence")
    fake_pkg.api = fake_api
    fake_pkg.db = fake_db

    monkeypatch.setitem(sys.modules, "uct_intelligence", fake_pkg)
    monkeypatch.setitem(sys.modules, "uct_intelligence.api", fake_api)
    monkeypatch.setitem(sys.modules, "uct_intelligence.db", fake_db)

    def seed(rows):
        c = sqlite3.connect(db_path)
        c.executemany(
            "INSERT INTO leadership_snapshots (snapshot_date, symbol) VALUES (?, ?)", rows)
        c.commit()
        c.close()

    return seed


@pytest.fixture
def client_as():
    def _make(user):
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_current_user_with_plan, None)
        app.dependency_overrides[get_current_user] = lambda: dict(user)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
        return TestClient(app, raise_server_exceptions=False)
    yield _make
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_current_user_with_plan, None)


def test_free_user_is_refused_with_402(client_as, fake_engine):
    resp = client_as(FREE_USER).get("/api/leader-persistence/NVDA")
    assert resp.status_code == 402


def test_anonymous_caller_is_refused(fake_engine):
    resp = TestClient(app, raise_server_exceptions=False).get("/api/leader-persistence/NVDA")
    assert resp.status_code in (401, 403)


def test_a_real_consecutive_run_is_counted_correctly(client_as, fake_engine):
    # Mon-Fri, five consecutive trading days, newest last.
    fake_engine([
        ("2026-09-14", "NVDA"), ("2026-09-15", "NVDA"), ("2026-09-16", "NVDA"),
        ("2026-09-17", "NVDA"), ("2026-09-18", "NVDA"),
    ])
    resp = client_as(PAID_USER).get("/api/leader-persistence/NVDA")
    assert resp.status_code == 200
    body = resp.json()
    assert body["symbol"] == "NVDA"
    assert body["consecutive_days"] == 5
    assert body["total_appearances"] == 5
    assert body["last_seen"] == "2026-09-18"
    assert body["first_seen"] == "2026-09-14"


def test_a_gap_over_three_days_resets_the_consecutive_count_but_not_total(client_as, fake_engine):
    # An older 3-day run, a real gap (>3 days), then a newer 2-day run.
    fake_engine([
        ("2026-08-01", "NVDA"), ("2026-08-02", "NVDA"), ("2026-08-03", "NVDA"),
        ("2026-09-17", "NVDA"), ("2026-09-18", "NVDA"),
    ])
    resp = client_as(PAID_USER).get("/api/leader-persistence/NVDA")
    body = resp.json()
    assert body["consecutive_days"] == 2, (
        "the gap between 2026-08-03 and 2026-09-17 is far more than the 3-day weekend "
        "allowance and must break the streak")
    assert body["total_appearances"] == 5, "total_appearances counts every appearance, not just the current streak"


def test_a_ticker_never_on_the_list_is_an_honest_zero_not_an_error(client_as, fake_engine):
    """⚠️ Found while building this test: the endpoint has THREE distinct
    "empty" response shapes (engine unavailable: 2 keys; no rows for this
    ticker: 3 keys, this case; real data: 5 keys) -- `first_seen`/`last_seen`
    are simply ABSENT here, not `None`. Not a functional defect (every shape
    still answers consecutive_days=0 honestly) and changing the endpoint to
    unify the shapes is explicitly out of this packet's scope -- the frontend
    hook is written to tolerate all three shapes instead."""
    resp = client_as(PAID_USER).get("/api/leader-persistence/ZZZZ")
    assert resp.status_code == 200
    body = resp.json()
    assert body["consecutive_days"] == 0
    assert body["total_appearances"] == 0
    assert "first_seen" not in body
    assert "last_seen" not in body


def test_lookup_is_case_insensitive_on_symbol(client_as, fake_engine):
    fake_engine([("2026-09-18", "NVDA")])
    resp = client_as(PAID_USER).get("/api/leader-persistence/nvda")
    assert resp.status_code == 200
    assert resp.json()["consecutive_days"] == 1


def test_engine_unavailable_degrades_honestly_never_an_error(client_as, monkeypatch):
    """When the Brain Pack isn't installed, _get_api() returns None and the
    endpoint must still answer 200 with an honest zero -- not a 500."""
    monkeypatch.setattr(intelligence_router, "_get_api", lambda: None)
    resp = client_as(PAID_USER).get("/api/leader-persistence/NVDA")
    assert resp.status_code == 200
    assert resp.json()["consecutive_days"] == 0
