"""Phase 5 tests: scheduler due-account selection + bounded runner, webhook
(shared-secret auth + reactive sync), and account-deletion cascade."""

from __future__ import annotations

import pytest
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.broker import (
    snaptrade_client as snap, connections, sync, service,
)


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


@pytest.fixture
def env(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    conn.executescript(auth_db._SCHEMA)  # users/subscriptions (for downgrade-pause check)
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("SNAPTRADE_CLIENT_ID", "cid")
    monkeypatch.setenv("SNAPTRADE_CONSUMER_KEY", "ck")
    snap.set_limiter(_NoThrottle())
    snap.configure(_Group(account_information=_Group(
        get_account_activities=lambda **kw: _Resp({"data": [], "pagination": {}}),
        get_user_account_positions=lambda **kw: _Resp([]),
        get_user_account_balance=lambda **kw: _Resp([]),
    ), authentication=_Group(
        delete_snap_trade_user=lambda **kw: _Resp({}),
    )))
    yield
    snap.reset()


def _mk_account(user, snap_id, number):
    connections.save_broker_user(user, f"{user}-uid", "secret")
    return connections.map_snaptrade_account(user, {
        "id": snap_id, "name": "Schwab", "number": number, "institution_name": "Schwab",
    })


# ── scheduler ────────────────────────────────────────────────────────────────

def test_list_due_accounts_selects_never_synced(env):
    _mk_account("u1", "S1", "1111")
    _mk_account("u2", "S2", "2222")
    due = connections.list_due_accounts(interval_minutes=20)
    assert len(due) == 2  # never synced → due


def test_list_due_excludes_recent_and_disabled(env):
    a = _mk_account("u1", "S1", "1111")
    connections.record_sync_result("u1", a["id"], ok=True)  # just synced → not due
    b = _mk_account("u2", "S2", "2222")
    connections.set_sync_enabled("u2", b["id"], False)       # disabled → not due
    due = connections.list_due_accounts(interval_minutes=20)
    assert due == []


def _mk_paid_user(uid):
    # Scheduler only syncs paid/admin users (downgrade-pause). Mark admin.
    conn = auth_db.get_connection()
    conn.execute(
        "INSERT OR REPLACE INTO users (id, email, password_hash, role) VALUES (?, ?, 'x', 'admin')",
        (uid, f"{uid}@x.com"),
    )
    conn.commit(); conn.close()


@pytest.mark.asyncio
async def test_sync_due_accounts_runs_all(env):
    _mk_paid_user("u1"); _mk_paid_user("u2")
    _mk_account("u1", "S1", "1111")
    _mk_account("u2", "S2", "2222")
    out = await sync.sync_due_accounts(interval_minutes=20, concurrency=2)
    assert out["due"] == 2 and out["synced"] == 2 and out["failed"] == 0


@pytest.mark.asyncio
async def test_sync_due_skips_unpaid_user(env):
    # No subscription / not admin → downgrade-pause: not synced.
    _mk_account("free1", "S9", "9999")
    out = await sync.sync_due_accounts(interval_minutes=20, concurrency=2)
    assert out["due"] == 0


# ── webhook ──────────────────────────────────────────────────────────────────

@pytest.fixture
def client(env, monkeypatch):
    monkeypatch.setenv("SNAPTRADE_WEBHOOK_SECRET", "hook-secret")
    from api.routers import broker_sync as br
    app = FastAPI()
    app.include_router(br.router)
    return TestClient(app)


def test_webhook_rejects_bad_secret(client):
    r = client.post("/api/j2/broker/webhook", json={"webhookSecret": "wrong", "userId": "u1"})
    assert r.status_code == 401


def test_webhook_accepts_valid_secret(client):
    r = client.post("/api/j2/broker/webhook",
                    json={"webhookSecret": "hook-secret", "userId": "u1",
                          "eventType": "ACCOUNT_HOLDINGS_UPDATED"})
    assert r.status_code == 200 and r.json()["ok"] is True


def test_webhook_missing_secret_config(client, monkeypatch):
    monkeypatch.delenv("SNAPTRADE_WEBHOOK_SECRET", raising=False)
    r = client.post("/api/j2/broker/webhook", json={"webhookSecret": "x"})
    assert r.status_code == 503


def test_webhook_unknown_event_ignored(client):
    r = client.post("/api/j2/broker/webhook",
                    json={"webhookSecret": "hook-secret", "userId": "u1", "eventType": "SOMETHING_ELSE"})
    assert r.status_code == 200 and r.json().get("ignored")


def test_webhook_unknown_user_ignored(client):
    # Valid secret + known event but no broker identity for this user → ignored.
    r = client.post("/api/j2/broker/webhook",
                    json={"webhookSecret": "hook-secret", "userId": "ghost",
                          "eventType": "ACCOUNT_HOLDINGS_UPDATED"})
    assert r.status_code == 200 and r.json().get("ignored") == "unknown user"


def test_webhook_known_user_scheduled(client):
    connections.save_broker_user("u1", "u1-uid", "secret")
    r = client.post("/api/j2/broker/webhook",
                    json={"webhookSecret": "hook-secret", "userId": "u1",
                          "eventType": "ACCOUNT_HOLDINGS_UPDATED"})
    assert r.status_code == 200 and r.json().get("scheduled") is True


# ── deletion cascade ─────────────────────────────────────────────────────────

def test_purge_on_account_deletion(env):
    a = _mk_account("u1", "S1", "1111")
    conn = auth_db.get_connection()
    # Seed a ledger row too.
    from api.services.journal_two.broker import activities_store
    activities_store.store_activities("u1", a["id"], [{"id": "act1", "type": "BUY"}], conn=conn)
    out = service.purge_on_account_deletion("u1", conn)
    conn.commit()
    assert out["purged"] is True
    # All broker rows gone.
    assert conn.execute("SELECT COUNT(*) AS n FROM j2_broker_users WHERE user_id='u1'").fetchone()["n"] == 0
    assert conn.execute("SELECT COUNT(*) AS n FROM j2_broker_accounts WHERE user_id='u1'").fetchone()["n"] == 0
    assert conn.execute("SELECT COUNT(*) AS n FROM j2_broker_activities WHERE user_id='u1'").fetchone()["n"] == 0
    conn.close()
