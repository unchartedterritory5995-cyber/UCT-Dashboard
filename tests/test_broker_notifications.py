"""Broker connection notifications — member email + owner Discord.

Guardrails under test (owner-approved design):
  - member email fires ONLY on the transition into status='broken'
    (the one failure the member can fix by reconnecting), exactly once;
  - repeated transient sync failures NEVER email the member — they ping
    the owner's Discord, at most once per account per day, and only after
    3 consecutive same-day failures;
  - notification failures never break a sync.
"""

from __future__ import annotations

import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.broker import (
    snaptrade_client as snap, connections, sync, notifications,
)
from snaptrade_client.exceptions import ApiException


class _Group:
    def __init__(self, **m):
        for k, v in m.items():
            setattr(self, k, v)


class _NoThrottle:
    async def acquire(self, n=1):
        return None


class _Resp:
    def __init__(self, body):
        self.body = body


def _empty_page(**kw):
    return _Resp({"data": [], "pagination": {"offset": 0, "limit": 1000, "total": 0}})


def _auth_401(**kw):
    e = ApiException(status=401, reason="Unauthorized")
    e.body = None
    e.headers = {}
    raise e


@pytest.fixture
def env(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    auth_db.init_db()  # full auth schema (users table) — the email lookup needs it
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.execute(
        "INSERT INTO users (id, email, password_hash, display_name) VALUES (?,?,?,?)",
        ("u1", "member@example.com", "x", "James"),
    )
    conn.commit()
    conn.close()
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("SNAPTRADE_CLIENT_ID", "cid")
    monkeypatch.setenv("SNAPTRADE_CONSUMER_KEY", "ck")
    snap.set_limiter(_NoThrottle())
    snap.configure(_Group(account_information=_Group(
        get_account_activities=_empty_page,
        get_user_account_positions=lambda **kw: _Resp([]),
        get_user_account_balance=lambda **kw: _Resp([]),
    )))
    connections.save_broker_user("u1", "snap-uid", "secret")
    ba = connections.map_snaptrade_account("u1", {
        "id": "S1", "name": "Robinhood", "number": "1234",
        "institution_name": "Robinhood", "type": "margin",
    })

    # Notifications: run inline (no thread) + capture sends instead of network.
    emails, pings = [], []
    monkeypatch.setattr(notifications, "_spawn", lambda fn, *a: fn(*a))
    monkeypatch.setattr(notifications, "_post_discord",
                        lambda title, desc: pings.append((title, desc)))
    from api.services import email_service
    monkeypatch.setattr(email_service, "send_email",
                        lambda to, subject, html: emails.append((to, subject, html)) or True)
    notifications._reset_dedup_for_tests()

    yield {"ba_id": ba["id"], "emails": emails, "pings": pings}
    snap.reset()


@pytest.mark.asyncio
async def test_broken_transition_emails_member_once(env):
    snap.configure(_Group(account_information=_Group(get_account_activities=_auth_401)))
    with pytest.raises(snap.SnapAuthError):
        await sync.sync_account("u1", env["ba_id"])
    # Member got exactly one reconnect email…
    assert len(env["emails"]) == 1
    to, subject, html = env["emails"][0]
    assert to == "member@example.com"
    assert "reconnect" in subject.lower()
    assert "/settings" in html
    # …and the owner got a Discord ping.
    assert len(env["pings"]) == 1

    # Second failing sync while STILL broken → no repeat email, no repeat ping.
    with pytest.raises(snap.SnapAuthError):
        await sync.sync_account("u1", env["ba_id"])
    assert len(env["emails"]) == 1
    assert len(env["pings"]) == 1


@pytest.mark.asyncio
async def test_transient_failures_never_email_member(env, monkeypatch):
    # Persistent transient failure (e.g. locked DB) — member must NOT be
    # emailed; owner gets ONE Discord ping once 3 consecutive same-day
    # failures accumulate, then no more that day.
    import sqlite3

    def always_locked(*a, **kw):
        raise sqlite3.OperationalError("database is locked")

    from api.services.journal_two.broker import activities_store
    monkeypatch.setattr(activities_store, "store_activities", always_locked)
    monkeypatch.setattr(sync, "_LOCKED_RETRY_DELAYS", (0.0, 0.0))  # 3 attempts/cycle

    with pytest.raises(sqlite3.OperationalError):
        await sync.sync_account("u1", env["ba_id"])
    assert env["emails"] == []          # never email transient failures
    assert len(env["pings"]) == 1       # 3 consecutive error rows → one ping

    with pytest.raises(sqlite3.OperationalError):
        await sync.sync_account("u1", env["ba_id"])
    assert env["emails"] == []
    assert len(env["pings"]) == 1       # deduped: once per account per day


@pytest.mark.asyncio
async def test_notification_failure_never_breaks_sync(env, monkeypatch):
    # Sender explodes → the sync outcome is unchanged (auth error still the
    # surfaced exception, account still marked broken).
    def boom_send(*a, **kw):
        raise RuntimeError("resend down")
    from api.services import email_service
    monkeypatch.setattr(email_service, "send_email", boom_send)
    monkeypatch.setattr(notifications, "_post_discord", boom_send)

    snap.configure(_Group(account_information=_Group(get_account_activities=_auth_401)))
    with pytest.raises(snap.SnapAuthError):
        await sync.sync_account("u1", env["ba_id"])
    ba = connections.get_broker_account("u1", env["ba_id"])
    assert ba["status"] == "broken"
