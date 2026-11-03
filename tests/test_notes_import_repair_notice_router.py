"""Plan F Task 9: the member's import-repair notice doors.

`GET /api/j2/notes/import/repair-notice` -> `{"show", "lossNotes"}` for the CALLER's own notice
(`store.pending_notice`); `POST /api/j2/notes/import/repair-notice/dismiss` -> `{"ok": true}`,
idempotent, an UPDATE (`store.dismiss_notice`). Real router, real schema on a temp auth.db.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.import_repair import store

GET = "/api/j2/notes/import/repair-notice"
DISMISS = "/api/j2/notes/import/repair-notice/dismiss"


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    c = auth_db.get_connection()
    ensure_schema(c)
    c.close()
    return tmp_path


@pytest.fixture(autouse=True)
def _fresh_limiter():
    from api.limiter import limiter
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture
def app(db):
    from api.routers import journal_two as journal_two_router
    fa = FastAPI()
    fa.include_router(journal_two_router.router)
    yield fa
    fa.dependency_overrides.clear()


@pytest.fixture
def client(app):
    return TestClient(app)


def _login_as(app, user_id):
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": user_id, "role": "member"}


def _record(user_id, loss_notes):
    c = auth_db.get_connection()
    try:
        store.record_notice(c, user_id, loss_notes)
        c.commit()
    finally:
        c.close()


def _rows():
    c = auth_db.get_connection()
    try:
        return [tuple(r) for r in c.execute(
            "SELECT user_id, loss_notes, dismissed_at IS NOT NULL FROM j2_import_repair_notices ORDER BY user_id")]
    finally:
        c.close()


def test_no_row_means_no_notice(app, client):
    _login_as(app, "u1")
    r = client.get(GET)
    assert r.status_code == 200 and r.json() == {"show": False, "lossNotes": 0}
    r = client.post(DISMISS)  # idempotent, even with nothing to dismiss
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert _rows() == []  # dismissing nothing creates nothing


def test_a_recorded_notice_shows_once_then_dismiss_hides_it_forever(app, client):
    _record("u1", 3)
    _login_as(app, "u1")
    assert client.get(GET).json() == {"show": True, "lossNotes": 3}
    assert client.get(GET).json() == {"show": True, "lossNotes": 3}  # until dismissed
    assert client.post(DISMISS).json() == {"ok": True}
    assert client.get(GET).json() == {"show": False, "lossNotes": 0}
    assert client.post(DISMISS).json() == {"ok": True}  # again: still ok
    _record("u1", 7)  # a later run never re-arms it
    assert client.get(GET).json() == {"show": False, "lossNotes": 0}
    assert _rows() == [("u1", 3, 1)]  # an UPDATE: the row stays


def test_one_member_cannot_see_or_dismiss_another_members_notice(app, client):
    _record("u1", 2)
    _record("u2", 5)
    _login_as(app, "u2")
    assert client.get(GET).json() == {"show": True, "lossNotes": 5}
    client.post(DISMISS)
    _login_as(app, "u1")
    assert client.get(GET).json() == {"show": True, "lossNotes": 2}  # untouched by u2's dismiss
    assert _rows() == [("u1", 2, 0), ("u2", 5, 1)]
    # the doors take no member id from the request: a query or body naming another is ignored
    _login_as(app, "u3")
    assert client.get(GET, params={"userId": "u1"}).json() == {"show": False, "lossNotes": 0}
    client.post(DISMISS, json={"userId": "u1"})
    assert _rows() == [("u1", 2, 0), ("u2", 5, 1)]


def test_routes_are_not_shadowed_by_note_id_routes(app, client):
    """FastAPI answers on the FIRST route whose pattern matches, in declaration order. No route
    of the same method declared before these doors may match their path (a `/notes/{note_id}/...`
    pattern reading `import` as a note id), and the same check fires on a route that would."""
    from fastapi.routing import APIRoute

    from api.routers import journal_two as journal_two_router
    routes = [r for r in journal_two_router.router.routes if isinstance(r, APIRoute)]

    def first_match(path, method):
        return next(r for r in routes if method in r.methods and r.path_regex.match(path))

    assert first_match(GET, "GET").path == GET
    assert first_match(DISMISS, "POST").path == DISMISS
    # control: the check can fire. A note-id route of this shape WOULD swallow the GET door.
    from fastapi import APIRouter
    probe = APIRouter(prefix="/api/j2")
    probe.add_api_route("/notes/{note_id}/repair-notice", lambda note_id: None, methods=["GET"])
    assert probe.routes[0].path_regex.match(GET)
    _record("u1", 4)
    _login_as(app, "u1")
    assert client.get(GET).json() == {"show": True, "lossNotes": 4}


def test_the_doors_need_a_signed_in_member(app, client):
    assert client.get(GET).status_code == 401
    assert client.post(DISMISS).status_code == 401


def test_the_doors_are_rate_limited(app, client, monkeypatch):
    from api.routers import journal_two as journal_two_router
    monkeypatch.setattr(journal_two_router, "NOTE_IMPORT_REPAIR_NOTICE_RATE", "2/minute")
    _login_as(app, "u1")
    codes = [client.get(GET).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


def test_the_dismiss_door_is_rate_limited_too(app, client, monkeypatch):
    """Task 9 review M-2: the POST spends the same budget on its own (no GET first)."""
    from api.routers import journal_two as journal_two_router
    monkeypatch.setattr(journal_two_router, "NOTE_IMPORT_REPAIR_NOTICE_RATE", "2/minute")
    _login_as(app, "u1")
    codes = [client.post(DISMISS).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
