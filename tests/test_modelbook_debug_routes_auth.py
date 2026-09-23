"""Packet X CP1 -- api/routers/modelbook.py's debug-index-drawings / debug-desc
routes carried ZERO auth of any kind (not require_paid, not even a plain
session check) while every other route in this file requires paid or admin.
`debug_desc` in particular could fire up to 5 billed Anthropic calls per
anonymous hit. Signed by the owner 2026-09-23 (fingerprint 314278988), scoped
to: gate both routes behind `require_admin` (matching this file's own
convention for every other diagnostic/generation/write action) + first-ever
test coverage of both routes.

Mirrors tests/test_modelbook_appearances_endpoint.py's isolation + override
pattern. `require_admin` depends on `get_current_user` (not
`get_current_user_with_plan`), so overriding `get_current_user` alone with a
role is enough to drive all three cases.
"""
import os
import tempfile

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.middleware.auth_middleware import get_current_user
from api.services import modelbook_service as svc

MEMBER_USER = {"id": "mb-member-1", "email": "mbmember@example.test", "role": "member", "plan": "pro"}
ADMIN_USER = {"id": "mb-admin-1", "email": "mbadmin@example.test", "role": "admin", "plan": "pro"}


@pytest.fixture(autouse=True)
def _isolated_modelbook_db(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(svc, "_DB_PATH", os.path.join(d, "modelbook.db"))
        svc._init_db()
        yield


@pytest.fixture(autouse=True)
def _no_real_anthropic_call(monkeypatch):
    # PACKET-X's own admin-success case must not make a real network call.
    # _get_anthropic_client() returning None short-circuits BOTH debug_desc's
    # direct client.messages.create() call and _generate_descriptions' own
    # internal call (both check `if client is None: return/skip`).
    import api.services.engine as engine

    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: None)


@pytest.fixture
def client_as():
    def _make(user):
        app.dependency_overrides.pop(get_current_user, None)
        if user is not None:
            app.dependency_overrides[get_current_user] = lambda: dict(user)
        return TestClient(app, raise_server_exceptions=False)
    yield _make
    app.dependency_overrides.pop(get_current_user, None)


# ── debug-index-drawings ─────────────────────────────────────────────────────

def test_debug_index_drawings_anonymous_is_refused(client_as):
    resp = client_as(None).get("/api/modelbook/debug-index-drawings?symbol=^IXIC")
    assert resp.status_code in (401, 403)


def test_debug_index_drawings_non_admin_member_is_refused_with_403(client_as):
    resp = client_as(MEMBER_USER).get("/api/modelbook/debug-index-drawings?symbol=^IXIC")
    assert resp.status_code == 403


def test_debug_index_drawings_admin_gets_200_with_existing_shape(client_as):
    resp = client_as(ADMIN_USER).get("/api/modelbook/debug-index-drawings?symbol=^IXIC")
    assert resp.status_code == 200
    body = resp.json()
    assert body["symbol"] == "^IXIC"
    assert "raw_len" in body


# ── debug-desc/{sym} ─────────────────────────────────────────────────────────

def test_debug_desc_anonymous_is_refused(client_as):
    resp = client_as(None).get("/api/modelbook/debug-desc/NVDA")
    assert resp.status_code in (401, 403)


def test_debug_desc_non_admin_member_is_refused_with_403(client_as):
    resp = client_as(MEMBER_USER).get("/api/modelbook/debug-desc/NVDA")
    assert resp.status_code == 403


def test_debug_desc_admin_gets_200_with_existing_shape_no_network_call(client_as):
    resp = client_as(ADMIN_USER).get("/api/modelbook/debug-desc/NVDA")
    assert resp.status_code == 200
    body = resp.json()
    assert body["sym"] == "NVDA"
    # The client-is-None branch: no real call attempted, generate_result is None.
    assert body["client"] == "None"
    assert body["generate_result"] is None
