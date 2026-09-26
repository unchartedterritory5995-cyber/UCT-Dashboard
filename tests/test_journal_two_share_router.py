"""Router-level tests for the note-share endpoints' flag gating. Same
standalone-FastAPI-app + temp-auth.db pattern as
test_journal_two_note_links_router.py.

⛔⛔ ALL FIVE share endpoints are flag-gated (J2_SHARE_LINKS_ENABLED), owner-side
(mint/status/revoke) AND the public read pair alike. Until 2026-09-22 only the
public pair checked the flag -- the owner-side three relied entirely on the
frontend's separate `isAdmin` gate to keep the Share button from ever being
clicked while the mechanism is off. Competitive audit finding Collaboration
F2, 2026-09-22. This file pins the owner-side gating specifically; the public
pair's own gating is already covered by test_note_shares.py's
test_flag_gates_the_public_surface (service layer) -- this file is router-level
and owner-side only, so the two don't duplicate coverage.
"""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


@pytest.fixture
def app(db_path):
    from api.routers import journal_two as journal_two_router
    # Wave 8 seam S8-2: the five share routes MOVED to notebook_shares; journal_two
    # still serves POST /api/j2/notes, which these tests use to make a note. Mounted
    # in main.py's order -- the share router first.
    from api.routers import notebook_shares as notebook_shares_router
    fa = FastAPI()
    fa.include_router(notebook_shares_router.router)
    fa.include_router(journal_two_router.router)
    yield fa
    fa.dependency_overrides.clear()


@pytest.fixture
def client(app):
    return TestClient(app)


def _login_as(app, user_id):
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": user_id, "role": "member"}
    # Wave 8 lane 8B, ruling D-B3: MINT is paid-gated now (notebook_shares.require_paid
    # reads get_current_user_with_plan), so the member these tests sign in as is a paid
    # one. Status and revoke still read get_current_user alone. The unpaid direction is
    # railed in tests/test_share_publish_authorization.py, not here.
    app.dependency_overrides[authmw.get_current_user_with_plan] = (
        lambda: {"id": user_id, "role": "member", "plan": "pro"})


def _create_note(client, title="A note"):
    r = client.post("/api/j2/notes", json={"title": title})
    assert r.status_code == 200
    return r.json()["note"]["id"]


# ── flag OFF (default) — all three owner-side endpoints refuse ─────────────

def test_get_share_status_404s_while_the_flag_is_off(monkeypatch, app, client):
    monkeypatch.delenv("J2_SHARE_LINKS_ENABLED", raising=False)
    _login_as(app, "u1")
    note_id = _create_note(client)
    r = client.get(f"/api/j2/notes/{note_id}/share")
    assert r.status_code == 404


def test_create_share_404s_while_the_flag_is_off(monkeypatch, app, client):
    monkeypatch.delenv("J2_SHARE_LINKS_ENABLED", raising=False)
    _login_as(app, "u1")
    note_id = _create_note(client)
    r = client.post(f"/api/j2/notes/{note_id}/share")
    assert r.status_code == 404


def test_revoke_share_404s_while_the_flag_is_off(monkeypatch, app, client):
    monkeypatch.delenv("J2_SHARE_LINKS_ENABLED", raising=False)
    _login_as(app, "u1")
    note_id = _create_note(client)
    r = client.delete(f"/api/j2/notes/{note_id}/share")
    assert r.status_code == 404


# ── CONTROL — flag ON, same three endpoints work normally ──────────────────
# Proves the new guards refuse ONLY when the flag is off, not unconditionally.

def test_the_same_three_endpoints_work_normally_once_the_flag_is_on(monkeypatch, app, client):
    monkeypatch.setenv("J2_SHARE_LINKS_ENABLED", "1")
    _login_as(app, "u1")
    note_id = _create_note(client)

    r = client.get(f"/api/j2/notes/{note_id}/share")
    assert r.status_code == 200
    assert r.json()["share"] is None  # none minted yet

    r = client.post(f"/api/j2/notes/{note_id}/share")
    assert r.status_code == 200
    assert r.json()["share"]["token"]

    r = client.delete(f"/api/j2/notes/{note_id}/share")
    assert r.status_code == 200
    assert r.json()["revoked"] is True
