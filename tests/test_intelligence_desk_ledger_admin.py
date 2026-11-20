"""The desk-ledger reads on the intelligence router require the admin role.

The engine keeps psychology events, coaching notes and skill assessments as ONE
desk-wide ledger with no member key, so there are no "caller's own rows" to
serve. The three reads are therefore admin-only, and this file holds that:

  1. STRUCTURE - each route on the SERVED app carries `require_admin` (the
     object, not a name) in its dependency tree, and no longer the paid gate.
  2. BEHAVIOUR - an anonymous caller, a signed-in member without a plan and a
     paid member are each refused; an admin is served.
  3. SHAPE - what an admin receives is exactly what the route always returned,
     with rows and with the engine absent.

No request here reaches a provider: the engine is replaced by an in-memory
ledger, and refusals are decided before any handler runs.
"""
from __future__ import annotations

import os
import sqlite3
import sys
import types
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.middleware.auth_middleware import (  # noqa: E402
    get_current_user,
    get_current_user_with_plan,
    require_admin,
)

LEDGER_READS = (
    ("/api/psychology-events", "events"),
    ("/api/coaching-notes", "notes"),
    ("/api/skill-assessments", "assessments"),
)

FREE_USER = {"id": "dl-free-1", "email": "dlfree@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "dl-paid-1", "email": "dlpaid@example.test", "role": "member", "plan": "pro"}
ADMIN_USER = {"id": "dl-adm-1", "email": "dladm@example.test", "role": "admin", "plan": "free"}


@pytest.fixture(scope="module")
def app():
    """The real app, imported and never rebuilt, so a severed mount cannot pass."""
    from api.main import app as real_app
    return real_app


@pytest.fixture
def as_user(app):
    """A client signed in as `user` (None = anonymous). The override is on the
    session readers only, never on the gate, so the gate itself always runs."""
    def _make(user):
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_current_user_with_plan, None)
        if user is not None:
            app.dependency_overrides[get_current_user] = lambda: dict(user)
            app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
        return TestClient(app, raise_server_exceptions=False)
    yield _make
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_current_user_with_plan, None)


def _route(app, path):
    for r in app.routes:
        if getattr(r, "path", None) == path and "GET" in (getattr(r, "methods", None) or ()):
            return r
    raise AssertionError(f"{path} is not served")


def _deps(route):
    objs, stack = set(), list(route.dependant.dependencies)
    while stack:
        d = stack.pop()
        objs.add(d.call)
        stack.extend(d.dependencies)
    return objs


# -- 1. structure ---------------------------------------------------------------

@pytest.mark.parametrize("path,_key", LEDGER_READS)
def test_each_ledger_read_carries_the_admin_gate(app, path, _key):
    deps = _deps(_route(app, path))
    assert require_admin in deps, f"{path} does not carry require_admin"
    assert "require_paid" not in {getattr(d, "__name__", "") for d in deps}, (
        f"{path} is gated for paid members again; the ledger has no member key")


def test_the_gate_reader_sees_a_sibling_that_is_paid_not_admin(app):
    """Control: the reader must be able to answer "not admin" for a real route."""
    deps = _deps(_route(app, "/api/setup-templates"))
    assert require_admin not in deps
    assert "require_paid" in {getattr(d, "__name__", "") for d in deps}


# -- 2. behaviour ---------------------------------------------------------------

@pytest.mark.parametrize("path,_key", LEDGER_READS)
def test_an_anonymous_caller_is_refused(as_user, path, _key):
    resp = as_user(None).get(path)
    assert resp.status_code == 401, (path, resp.status_code, resp.text[:160])


@pytest.mark.parametrize("path,_key", LEDGER_READS)
@pytest.mark.parametrize("user", [FREE_USER, PAID_USER], ids=["no-plan", "paid"])
def test_a_signed_in_member_who_is_not_admin_is_refused(as_user, path, _key, user):
    resp = as_user(user).get(path)
    assert resp.status_code == 403, (path, user["plan"], resp.status_code, resp.text[:160])
    assert resp.json() == {"detail": "Admin access required"}


# -- 3. shape -------------------------------------------------------------------

def _ledger():
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE psychology_events (id INTEGER PRIMARY KEY, event_date TEXT,
            event_type TEXT, severity TEXT, details TEXT, related_trades TEXT,
            acknowledged INTEGER, created_at TEXT);
        CREATE TABLE coaching_notes (id INTEGER PRIMARY KEY, note_date TEXT,
            note_type TEXT, content TEXT, trigger_event TEXT, related_trades TEXT,
            source TEXT, created_at TEXT);
        CREATE TABLE skill_assessments (id INTEGER PRIMARY KEY, skill_domain TEXT,
            skill_name TEXT, proficiency TEXT, evidence_count INTEGER,
            last_assessed TEXT, notes TEXT);
        INSERT INTO psychology_events VALUES
            (1, date('now'), 'overtrading', 'warning', 'six entries', '[11, 12]', 0, datetime('now'));
        INSERT INTO coaching_notes VALUES
            (1, date('now'), 'weekly', 'size down', '', 'not json', 'ai_review', datetime('now'));
        INSERT INTO skill_assessments VALUES
            (1, 'risk', 'stops', 'developing', 3, datetime('now'), '');
    """)
    return conn


@pytest.fixture
def engine(monkeypatch):
    """The engine, replaced by an in-memory ledger with one row per table."""
    from api.routers import intelligence
    conn = _ledger()

    @contextmanager
    def get_connection():
        yield conn

    pkg = types.ModuleType("uct_intelligence")
    pkg.__path__ = []
    db = types.ModuleType("uct_intelligence.db")
    db.get_connection = get_connection
    pkg.db = db
    monkeypatch.setitem(sys.modules, "uct_intelligence", pkg)
    monkeypatch.setitem(sys.modules, "uct_intelligence.db", db)
    monkeypatch.setattr(intelligence, "_get_api", lambda: object())
    yield conn
    conn.close()


def test_an_admin_is_served_the_same_shape_as_before(as_user, engine):
    client = as_user(ADMIN_USER)

    body = client.get("/api/psychology-events").json()
    assert set(body) == {"events", "count"} and body["count"] == 1
    assert body["events"][0]["event_type"] == "overtrading"
    assert body["events"][0]["related_trades"] == [11, 12]

    body = client.get("/api/coaching-notes").json()
    assert set(body) == {"notes", "count"} and body["count"] == 1
    assert body["notes"][0]["content"] == "size down"
    assert body["notes"][0]["related_trades"] == []          # unparseable -> empty, as before

    body = client.get("/api/coaching-notes", params={"note_type": "daily"}).json()
    assert body == {"notes": [], "count": 0}

    body = client.get("/api/skill-assessments").json()
    assert set(body) == {"assessments", "count"} and body["count"] == 1
    assert body["assessments"][0]["skill_domain"] == "risk"


@pytest.mark.parametrize("path,key", LEDGER_READS)
def test_an_admin_gets_the_empty_answer_when_the_engine_is_absent(as_user, monkeypatch, path, key):
    from api.routers import intelligence
    monkeypatch.setattr(intelligence, "_get_api", lambda: None)
    resp = as_user(ADMIN_USER).get(path)
    assert resp.status_code == 200
    assert resp.json() == {key: [], "count": 0}
