"""Tests for calendar_seen service + GET/POST /api/calendar/seen endpoints.

Strategy:
  - Monkeypatch calendar_seen._DB_PATH to a temp SQLite file so tests are
    fully isolated from /data/auth.db.
  - Also reset _INIT_DONE so each test triggers a fresh schema init against
    the temp DB.
  - Endpoint tests mock get_current_user to bypass real auth.
"""
import os
import pytest
from unittest import mock
from fastapi.testclient import TestClient


# ─────────────────────────────────────────────────────────────────────────────
# Service-level tests (direct function calls, temp DB)
# ─────────────────────────────────────────────────────────────────────────────

def _reset_and_patch(monkeypatch, tmp_path):
    """Point calendar_seen at a temp DB and reset the init flag."""
    import api.services.calendar_seen as cs
    db = str(tmp_path / "seen_test.db")
    monkeypatch.setattr(cs, "_DB_PATH", db)
    monkeypatch.setattr(cs, "_INIT_DONE", False)
    return cs


def test_mark_seen_and_get_seen(monkeypatch, tmp_path):
    cs = _reset_and_patch(monkeypatch, tmp_path)

    # nothing seen yet
    assert cs.get_seen("user1", "earnings") == set()

    # mark one item
    cs.mark_seen("user1", "earnings", "AAPL:2026-06-02")
    result = cs.get_seen("user1", "earnings")
    assert "AAPL:2026-06-02" in result


def test_mark_seen_idempotent(monkeypatch, tmp_path):
    """Calling mark_seen twice with the same args must not raise and must not
    duplicate the row (PK constraint)."""
    cs = _reset_and_patch(monkeypatch, tmp_path)

    cs.mark_seen("user1", "earnings", "NVDA:2026-06-10")
    cs.mark_seen("user1", "earnings", "NVDA:2026-06-10")  # second call → no-op

    result = cs.get_seen("user1", "earnings")
    assert result == {"NVDA:2026-06-10"}


def test_get_seen_scoped_to_item_type(monkeypatch, tmp_path):
    """get_seen with item_type only returns keys for that type."""
    cs = _reset_and_patch(monkeypatch, tmp_path)

    cs.mark_seen("user1", "earnings", "AAPL:2026-06-02")
    cs.mark_seen("user1", "filing", "AAPL:10-Q-2026")

    earnings = cs.get_seen("user1", "earnings")
    filings = cs.get_seen("user1", "filing")

    assert "AAPL:2026-06-02" in earnings
    assert "AAPL:10-Q-2026" not in earnings
    assert "AAPL:10-Q-2026" in filings
    assert "AAPL:2026-06-02" not in filings


def test_get_seen_no_type_returns_all(monkeypatch, tmp_path):
    """get_seen(user, item_type=None) aggregates across all types."""
    cs = _reset_and_patch(monkeypatch, tmp_path)

    cs.mark_seen("user1", "earnings", "AAPL:2026-06-02")
    cs.mark_seen("user1", "filing", "AAPL:10-Q-2026")

    all_seen = cs.get_seen("user1")
    assert {"AAPL:2026-06-02", "AAPL:10-Q-2026"} <= all_seen


def test_seen_isolated_per_user(monkeypatch, tmp_path):
    """Each user has their own seen set — no cross-user leakage."""
    cs = _reset_and_patch(monkeypatch, tmp_path)

    cs.mark_seen("user1", "earnings", "AAPL:2026-06-02")
    cs.mark_seen("user2", "earnings", "NVDA:2026-06-10")

    u1 = cs.get_seen("user1", "earnings")
    u2 = cs.get_seen("user2", "earnings")

    assert "AAPL:2026-06-02" in u1
    assert "NVDA:2026-06-10" not in u1
    assert "NVDA:2026-06-10" in u2
    assert "AAPL:2026-06-02" not in u2


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint tests (FastAPI TestClient, mock auth + mock service)
# ─────────────────────────────────────────────────────────────────────────────

_FAKE_USER = {"id": "user-abc", "email": "test@example.com", "role": "member"}


def _make_client():
    from api.main import app
    from api.middleware.auth_middleware import get_current_user
    app.dependency_overrides[get_current_user] = lambda: _FAKE_USER
    client = TestClient(app)
    return client, app


def test_get_seen_endpoint_empty():
    client, app = _make_client()
    try:
        with mock.patch("api.services.calendar_seen.get_seen", return_value=set()):
            r = client.get("/api/calendar/seen?item_type=earnings")
        assert r.status_code == 200
        assert r.json() == {"seen": []}
    finally:
        app.dependency_overrides.clear()


def test_get_seen_endpoint_with_keys():
    client, app = _make_client()
    try:
        with mock.patch(
            "api.services.calendar_seen.get_seen",
            return_value={"AAPL:2026-06-02", "NVDA:2026-06-10"},
        ):
            r = client.get("/api/calendar/seen?item_type=earnings")
        assert r.status_code == 200
        seen = set(r.json()["seen"])
        assert seen == {"AAPL:2026-06-02", "NVDA:2026-06-10"}
    finally:
        app.dependency_overrides.clear()


def test_post_seen_endpoint():
    client, app = _make_client()
    try:
        with mock.patch("api.services.calendar_seen.mark_seen") as mock_mark:
            r = client.post(
                "/api/calendar/seen",
                json={"item_type": "earnings", "item_key": "AAPL:2026-06-02"},
            )
        assert r.status_code == 200
        assert r.json() == {"ok": True}
        mock_mark.assert_called_once_with("user-abc", "earnings", "AAPL:2026-06-02")
    finally:
        app.dependency_overrides.clear()


def test_post_seen_endpoint_idempotent():
    """POST twice → both return 200 ok; underlying service handles dedup."""
    client, app = _make_client()
    try:
        with mock.patch("api.services.calendar_seen.mark_seen"):
            r1 = client.post(
                "/api/calendar/seen",
                json={"item_type": "filing", "item_key": "AAPL:10-Q-2026"},
            )
            r2 = client.post(
                "/api/calendar/seen",
                json={"item_type": "filing", "item_key": "AAPL:10-Q-2026"},
            )
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r1.json()["ok"] is True
        assert r2.json()["ok"] is True
    finally:
        app.dependency_overrides.clear()


def test_seen_requires_auth():
    """Without the dependency override, unauthenticated requests should fail."""
    from api.main import app
    # Ensure no overrides
    app.dependency_overrides.clear()
    client = TestClient(app, raise_server_exceptions=False)
    r = client.get("/api/calendar/seen")
    # Expect 401 or 403 (unauthenticated)
    assert r.status_code in (401, 403, 422)
