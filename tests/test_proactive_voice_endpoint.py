"""
P4-A end-to-end proactive voice — backend endpoint tests.

Verifies that /insights/unspoken honors the proactive_speak setting and
the importance threshold, and that mark-spoken sets delivered_at.
"""

import uuid

from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services.voice_proactive_service import (
    add_insight, list_pending_insights,
)
from api.services.voice_settings_service import update_voice_settings
from api.routers.voice import insights_unspoken, insights_mark_spoken


def _user():
    init_db()
    return create_user(f"pvend_{uuid.uuid4()}@x.com", "p")


def _user_dict(user_row):
    """Convert auth row to the {id, ...} dict that the endpoint expects."""
    return {"id": user_row["id"], "role": user_row.get("role", "user")}


# ── /insights/unspoken ─────────────────────────────────────────────────────

def test_unspoken_returns_null_when_proactive_speak_off():
    """Default state — proactive_speak is OFF, so nothing is spoken."""
    u = _user()
    add_insight(u["id"], kind="regime_shift", headline="Regime flipped",
                importance=9)
    out = insights_unspoken(user=_user_dict(u))
    assert out["insight"] is None


def test_unspoken_returns_null_when_no_insights_above_threshold():
    """Toggle is ON, but importance < 7 → nothing spoken."""
    u = _user()
    update_voice_settings(u["id"], proactive_speak=True)
    add_insight(u["id"], kind="watchlist_alert",
                headline="Low-importance ping", importance=5)
    out = insights_unspoken(user=_user_dict(u))
    assert out["insight"] is None


def test_unspoken_returns_high_importance_insight():
    """Toggle ON + importance ≥ 7 → returns the insight."""
    u = _user()
    update_voice_settings(u["id"], proactive_speak=True)
    iid = add_insight(u["id"], kind="regime_shift",
                      headline="GREEN to AMBER", body="Breadth deteriorating",
                      importance=8)
    out = insights_unspoken(user=_user_dict(u))
    assert out["insight"] is not None
    assert out["insight"]["id"] == iid
    assert out["insight"]["importance"] == 8
    assert "GREEN to AMBER" in out["insight"]["spoken_text"]


def test_unspoken_composes_headline_plus_body():
    u = _user()
    update_voice_settings(u["id"], proactive_speak=True)
    add_insight(u["id"], kind="mistake_pattern",
                headline="Three rapid trades", body="Step away — rule fired",
                importance=9)
    out = insights_unspoken(user=_user_dict(u))
    text = out["insight"]["spoken_text"]
    assert "Three rapid trades" in text
    assert "Step away" in text


def test_unspoken_picks_highest_importance_among_pending():
    """Multiple eligible insights → highest importance is spoken first."""
    u = _user()
    update_voice_settings(u["id"], proactive_speak=True)
    add_insight(u["id"], kind="watchlist_alert",
                headline="Lower priority", symbol="AAA", importance=7)
    high_id = add_insight(u["id"], kind="drift_warning",
                          headline="Higher priority", symbol="BBB",
                          importance=10)
    out = insights_unspoken(user=_user_dict(u))
    assert out["insight"]["id"] == high_id


# ── /insights/{id}/mark-spoken ─────────────────────────────────────────────
#
# Endpoint is rate-limited by slowapi which requires a real Request scope.
# Tests use TestClient to exercise the route through the full FastAPI stack.

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def authenticated_client(monkeypatch):
    """TestClient with requires_voice_access stubbed for a specific user."""
    from api.main import app
    from api.routers import voice as voice_router

    def _make_client_for(user_id: str, role: str = "user"):
        # FastAPI introspects the signature to build query params, so the
        # stub needs an argless callable rather than *args/**kwargs.
        def _stub_requires():
            return {"id": user_id, "role": role}
        app.dependency_overrides[voice_router.requires_voice_access] = _stub_requires
        return TestClient(app)

    yield _make_client_for
    # Cleanup
    from api.main import app as _app
    from api.routers import voice as _voice
    _app.dependency_overrides.pop(_voice.requires_voice_access, None)


def test_mark_spoken_sets_delivered(authenticated_client):
    u = _user()
    update_voice_settings(u["id"], proactive_speak=True)
    iid = add_insight(u["id"], kind="regime_shift",
                      headline="Phase changed", importance=8)
    assert any(p["id"] == iid for p in list_pending_insights(u["id"]))

    client = authenticated_client(u["id"])
    r = client.post(f"/api/voice/insights/{iid}/mark-spoken")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["marked"] == 1

    # After marking: it's no longer pending
    assert not any(p["id"] == iid for p in list_pending_insights(u["id"]))


def test_mark_spoken_is_idempotent_for_unknown_id(authenticated_client):
    u = _user()
    client = authenticated_client(u["id"])
    r = client.post("/api/voice/insights/99999999/mark-spoken")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["marked"] == 0


def test_mark_spoken_does_not_cross_users(authenticated_client):
    """User A cannot mark User B's insight as spoken."""
    a = _user()
    b = _user()
    iid = add_insight(b["id"], kind="regime_shift",
                      headline="B's regime", importance=8)
    # User A tries to mark it
    client = authenticated_client(a["id"])
    r = client.post(f"/api/voice/insights/{iid}/mark-spoken")
    assert r.status_code == 200
    assert r.json()["marked"] == 0
    # B's insight still pending
    assert any(p["id"] == iid for p in list_pending_insights(b["id"]))


def test_unspoken_skips_already_delivered(authenticated_client):
    """After mark-spoken, the insight is no longer returned."""
    u = _user()
    update_voice_settings(u["id"], proactive_speak=True)
    iid = add_insight(u["id"], kind="regime_shift",
                      headline="One-shot insight", importance=8)
    client = authenticated_client(u["id"])
    client.post(f"/api/voice/insights/{iid}/mark-spoken")
    out = insights_unspoken(user=_user_dict(u))
    assert out["insight"] is None
