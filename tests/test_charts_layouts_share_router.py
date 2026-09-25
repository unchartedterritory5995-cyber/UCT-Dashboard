"""Tests for the charts-layouts SHARE endpoints — terminal-grade property 3,
"saved things become names, and names are addresses" (Day 3 of the
Terminal-Next roadmap).

Follows this repo's own established pattern (test_admin_chart_health.py): the
override replaces `get_current_user`, the AUTH DEPENDENCY the router's own
`_assert_may_write` ownership check sits on top of — never the ownership check
itself — so a route that lost its `_assert_may_write` call would actually show
up red here, not just a route that lost its login requirement.
"""
import uuid

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.middleware.auth_middleware import get_current_user
from api.services import charts_layout_service as svc

OWNER = str(uuid.uuid4())
OTHER = str(uuid.uuid4())


def _as(user: dict):
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


@pytest.fixture
def owner_client():
    client = _as({"id": OWNER, "role": "user", "email": "owner@test"})
    yield client
    app.dependency_overrides.clear()


@pytest.fixture
def other_client():
    client = _as({"id": OTHER, "role": "user", "email": "other@test"})
    yield client
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _tmp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "charts_layouts.db"))
    svc._init_db()


def _make_layout(user_id=OWNER, scope="user", name="My Board"):
    return svc.upsert(scope, user_id, name, {"widgets": [{"id": "a"}], "cols": 24},
                      {"A": "NVDA"}, "Tester")


def test_owner_can_mint_a_share_link(owner_client):
    row = _make_layout()
    r = owner_client.post(f"/api/charts/layouts/{row['id']}/share")
    assert r.status_code == 200
    assert r.json()["token"].startswith("cl_")


def test_non_owner_is_refused_by_the_real_ownership_check(other_client):
    """The route under test still calls `_assert_may_write` — this is what
    would go red if that call were ever deleted."""
    row = _make_layout()
    r = other_client.post(f"/api/charts/layouts/{row['id']}/share")
    assert r.status_code == 403


def test_sharing_a_global_prebuilt_layout_404s_not_403(owner_client):
    """From the caller's side a global layout isn't theirs to mint a PERSONAL
    link for — a 404 here, not a confusing 403 (an admin CAN write to a global
    row via _assert_may_write, but share() still refuses scope='global')."""
    admin_client = _as({"id": OWNER, "role": "admin", "email": "admin@test"})
    row = _make_layout(user_id=OWNER, scope="global", name="Prebuilt")
    r = admin_client.post(f"/api/charts/layouts/{row['id']}/share")
    assert r.status_code == 404
    app.dependency_overrides.clear()


def test_share_state_is_read_only_and_does_not_mint(owner_client):
    row = _make_layout()
    r = owner_client.get(f"/api/charts/layouts/{row['id']}/share")
    assert r.status_code == 200
    assert r.json() == {"token": None}
    # confirm nothing was minted as a side effect
    assert svc.share_status(OWNER, row["id"]) is None


def test_share_state_reflects_a_live_token(owner_client):
    row = _make_layout()
    owner_client.post(f"/api/charts/layouts/{row['id']}/share")
    r = owner_client.get(f"/api/charts/layouts/{row['id']}/share")
    assert r.json()["token"] is not None


def test_non_owner_cannot_read_share_state_either(other_client):
    row = _make_layout()
    r = other_client.get(f"/api/charts/layouts/{row['id']}/share")
    assert r.status_code == 403


def test_owner_can_unshare(owner_client):
    row = _make_layout()
    owner_client.post(f"/api/charts/layouts/{row['id']}/share")
    r = owner_client.delete(f"/api/charts/layouts/{row['id']}/share")
    assert r.status_code == 200
    assert r.json()["revoked"] is True
    assert svc.share_status(OWNER, row["id"]) is None


def test_any_logged_in_user_can_resolve_a_valid_share_token():
    """Both identities in ONE test — `app.dependency_overrides` is a single
    shared dict on the app singleton, so requesting owner_client AND
    other_client as separate fixtures in the same test collapses to whichever
    fixture's setup ran last (both would silently authenticate as the same
    user). Swap the override explicitly between the two calls instead."""
    row = _make_layout()
    client = _as({"id": OWNER, "role": "user", "email": "owner@test"})
    token = client.post(f"/api/charts/layouts/{row['id']}/share").json()["token"]
    app.dependency_overrides[get_current_user] = lambda: {"id": OTHER, "role": "user", "email": "other@test"}
    r = client.get(f"/api/charts/layouts/shared/{token}")
    app.dependency_overrides.clear()
    assert r.status_code == 200
    assert r.json()["name"] == "My Board"
    assert r.json()["groups"] == {"A": "NVDA"}


def test_resolving_an_unknown_token_is_a_plain_404(owner_client):
    r = owner_client.get("/api/charts/layouts/shared/cl_does_not_exist")
    assert r.status_code == 404


def test_resolving_a_revoked_token_is_also_a_plain_404():
    row = _make_layout()
    client = _as({"id": OWNER, "role": "user", "email": "owner@test"})
    token = client.post(f"/api/charts/layouts/{row['id']}/share").json()["token"]
    client.delete(f"/api/charts/layouts/{row['id']}/share")
    app.dependency_overrides[get_current_user] = lambda: {"id": OTHER, "role": "user", "email": "other@test"}
    r = client.get(f"/api/charts/layouts/shared/{token}")
    app.dependency_overrides.clear()
    assert r.status_code == 404


def test_sharing_a_nonexistent_layout_404s(owner_client):
    r = owner_client.post("/api/charts/layouts/999999/share")
    assert r.status_code == 404
