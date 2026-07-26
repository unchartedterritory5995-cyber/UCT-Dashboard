# tests/api/test_landing_analytics.py
"""Tests for /api/landing-analytics.

The router existed for a long time but was never mounted in main.py, so every
track() call from the landing page hit the SPA catch-all and the admin page had
no data behind it. `test_router_is_actually_mounted` is the regression guard for
exactly that — a passing unit test of the handler proves nothing if nothing
routes to it.
"""
import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth_test.db"))

    import api.services.auth_db as auth_db
    importlib.reload(auth_db)
    auth_db.init_db()

    from api.main import app
    return TestClient(app)


def _admin(app):
    from api.middleware.auth_middleware import require_admin
    app.dependency_overrides[require_admin] = lambda: {"id": "x", "role": "admin"}
    return require_admin


def test_router_is_actually_mounted(client):
    """Guards the original bug: the router existed but was never included, so
    every request fell through to the SPA catch-all.

    NOT a 405 check — the catch-all answers GET on any path, so an unmounted
    router still returns 200 HTML there. Two things the catch-all provably
    cannot do: reject an unauthenticated read with 401, and return JSON.
    """
    resp = client.get("/api/landing-analytics/summary")
    assert resp.status_code in (401, 403), "summary fell through to the SPA catch-all"
    assert "application/json" in resp.headers.get("content-type", "")


def test_event_is_recorded(client):
    resp = client.post("/api/landing-analytics/event", json={
        "event": "coming_soon_view", "visitor_id": "visitor-1",
    })
    assert resp.status_code == 200


def test_unknown_events_are_rejected(client):
    """The allow-list is what stops the table being filled with junk by a
    public unauthenticated endpoint."""
    resp = client.post("/api/landing-analytics/event", json={
        "event": "not_a_real_event", "visitor_id": "visitor-1",
    })
    assert resp.status_code in (400, 422)


@pytest.mark.parametrize("event", [
    "coming_soon_view", "waitlist_submit", "waitlist_joined",
    "founder_contact_click", "substack_click", "coming_soon_login_click",
])
def test_every_coming_soon_event_is_allowed(client, event):
    """Each event the page actually fires must be in the allow-list, or it is
    silently dropped and the funnel quietly under-reports."""
    resp = client.post("/api/landing-analytics/event", json={
        "event": event, "visitor_id": "visitor-1",
    })
    assert resp.status_code == 200, f"{event} was rejected"


def test_summary_reports_the_pre_launch_funnel(client):
    from api.main import app
    dep = _admin(app)
    try:
        # Two visitors look; one joins; one taps the phone number.
        for v in ("a", "b"):
            client.post("/api/landing-analytics/event",
                        json={"event": "coming_soon_view", "visitor_id": v})
        client.post("/api/landing-analytics/event",
                    json={"event": "waitlist_joined", "visitor_id": "a"})
        client.post("/api/landing-analytics/event",
                    json={"event": "founder_contact_click", "visitor_id": "b",
                          "props": {"channel": "phone"}})

        cs = client.get("/api/landing-analytics/summary?days=7").json()["coming_soon"]
        assert cs["views"] == 2
        assert cs["joined"] == 1
        assert cs["join_rate"] == 0.5
        assert cs["founder_clickers"] == 1
        assert cs["founder_by_channel"] == [{"channel": "phone", "n": 1}]
    finally:
        app.dependency_overrides.pop(dep, None)


def test_summary_join_rate_is_safe_with_no_views(client):
    from api.main import app
    dep = _admin(app)
    try:
        cs = client.get("/api/landing-analytics/summary?days=7").json()["coming_soon"]
        assert cs == {
            "views": 0, "joined": 0, "join_rate": 0.0,
            "founder_clickers": 0, "substack_clickers": 0,
            "founder_by_channel": [],
        }
    finally:
        app.dependency_overrides.pop(dep, None)


def test_summary_requires_admin(client):
    assert client.get("/api/landing-analytics/summary").status_code in (401, 403)
