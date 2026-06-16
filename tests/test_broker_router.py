"""HTTP-level tests for the broker-sync router.

Spins up a minimal FastAPI app with just the broker router, overrides the
auth dependencies, injects a fake SnapTrade SDK, and runs against a temp DB.
Verifies routing, the consent gate, the paid-plan gate, and status access.
"""

from __future__ import annotations

import pytest
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.broker import snaptrade_client as snap
from api.middleware import auth_middleware as authmw
from api.routers import broker_sync as broker_router


class _Resp:
    def __init__(self, body):
        self.body = body


class _Group:
    def __init__(self, **m):
        for k, v in m.items():
            setattr(self, k, v)


class _NoThrottle:
    async def acquire(self, n=1):
        return None


def _fake_sdk():
    accts = [{"id": "S1", "name": "Schwab", "number": "111122223333",
              "institution_name": "Charles Schwab", "type": "margin",
              "balance": {"total": {"currency": "USD"}}}]
    return _Group(
        authentication=_Group(
            register_snap_trade_user=lambda **kw: _Resp({"userId": kw["user_id"], "userSecret": "sek"}),
            login_snap_trade_user=lambda **kw: _Resp({"redirectURI": "https://app.snaptrade.com/p"}),
            delete_snap_trade_user=lambda **kw: _Resp({}),
        ),
        account_information=_Group(
            list_user_accounts=lambda **kw: _Resp(accts),
            get_account_activities=lambda **kw: _Resp({"data": [], "pagination": {}}),
        ),
    )


@pytest.fixture
def client(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("SNAPTRADE_CLIENT_ID", "cid")
    monkeypatch.setenv("SNAPTRADE_CONSUMER_KEY", "ckey")
    snap.configure(_fake_sdk())
    snap.set_limiter(_NoThrottle())

    app = FastAPI()
    app.include_router(broker_router.router)
    # Default: an authenticated PAID user.
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u1", "role": "member"}
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: {"id": "u1", "plan": "pro", "role": "member"}

    c = TestClient(app)
    c._app = app  # expose for override tweaks
    yield c
    snap.reset()


def test_status_open_to_logged_in(client):
    r = client.get("/api/j2/broker/status")
    assert r.status_code == 200
    body = r.json()
    assert body["connected"] is False
    assert body["snaptradeConfigured"] is True


def test_connect_requires_consent(client):
    r = client.post("/api/j2/broker/connect", json={"consent": False})
    assert r.status_code == 400


def test_connect_with_consent_returns_redirect(client):
    r = client.post("/api/j2/broker/connect", json={"consent": True, "customRedirect": "https://uct/return"})
    assert r.status_code == 200
    assert r.json()["redirectUri"].startswith("https://app.snaptrade.com/")


def test_full_flow_connect_refresh_status_disconnect(client):
    assert client.post("/api/j2/broker/connect", json={"consent": True}).status_code == 200
    r = client.post("/api/j2/broker/accounts/refresh")
    assert r.status_code == 200
    accounts = r.json()["accounts"]
    assert len(accounts) == 1
    bid = accounts[0]["id"]

    # toggle sync off
    r = client.put(f"/api/j2/broker/accounts/{bid}", json={"syncEnabled": False})
    assert r.status_code == 200
    assert r.json()["syncEnabled"] is False

    st = client.get("/api/j2/broker/status").json()
    assert st["connected"] is True and len(st["accounts"]) == 1

    # disconnect (DELETE with body)
    r = client.request("DELETE", "/api/j2/broker/connections", json={"purgeTrades": False})
    assert r.status_code == 200
    assert r.json()["disconnected"] is True
    assert client.get("/api/j2/broker/status").json()["connected"] is False


def test_paid_gate_blocks_free_user(client):
    # Flip the plan override to a free user → connect must 403.
    client._app.dependency_overrides[authmw.get_current_user_with_plan] = \
        lambda: {"id": "u1", "plan": "free", "role": "member"}
    r = client.post("/api/j2/broker/connect", json={"consent": True})
    assert r.status_code == 403
    # status stays open to any logged-in user.
    assert client.get("/api/j2/broker/status").status_code == 200


def test_refresh_before_connect_conflicts(client):
    r = client.post("/api/j2/broker/accounts/refresh")
    assert r.status_code == 409


def test_sync_now_endpoint(client):
    assert client.post("/api/j2/broker/connect", json={"consent": True}).status_code == 200
    assert client.post("/api/j2/broker/accounts/refresh").status_code == 200
    r = client.post("/api/j2/broker/sync")
    assert r.status_code == 200
    assert "results" in r.json()


def test_sync_now_paid_gated(client):
    client._app.dependency_overrides[authmw.get_current_user_with_plan] = \
        lambda: {"id": "u1", "plan": "free", "role": "member"}
    assert client.post("/api/j2/broker/sync").status_code == 403


def test_dup_flags_list_open_to_logged_in(client):
    r = client.get("/api/j2/broker/dup-flags")
    assert r.status_code == 200
    assert r.json()["flags"] == []


def test_dup_flag_resolve_paid_gated(client):
    client._app.dependency_overrides[authmw.get_current_user_with_plan] = \
        lambda: {"id": "u1", "plan": "free", "role": "member"}
    r = client.post("/api/j2/broker/dup-flags/some-id", json={"action": "dismiss"})
    assert r.status_code == 403


def test_admin_bypasses_paid_gate(client):
    # Admin on a free plan must still reach paid broker endpoints.
    client._app.dependency_overrides[authmw.get_current_user_with_plan] = \
        lambda: {"id": "u1", "plan": "free", "role": "admin"}
    assert client.post("/api/j2/broker/connect", json={"consent": True}).status_code == 200


def test_comped_plan_passes_paid_gate(client):
    client._app.dependency_overrides[authmw.get_current_user_with_plan] = \
        lambda: {"id": "u1", "plan": "comped", "role": "member"}
    assert client.post("/api/j2/broker/connect", json={"consent": True}).status_code == 200
