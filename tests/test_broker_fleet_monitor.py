"""Broker fleet monitor — autonomous detection of stuck member connections.

Owner-approved design (2026-07-16): every member is a detector. The monitor
sweeps ALL connections hourly for the states that stranded real members this
week and pings the owner's Discord (never members):
  • stranded connect — broker identity exists but ZERO accounts imported
    (the Webull dead-end state) older than a grace window;
  • stale sync — a sync-enabled active account with no successful sync in
    24h (the silent-death state);
  • still-broken — a connection sitting in status='broken' (member ignoring
    the reconnect email);
  • SnapTrade heartbeat — partner API down / key invalid.
One digest ping per distinct finding-set per ET day.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.broker import (
    snaptrade_client as snap, connections, fleet_monitor,
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


def _iso(dt):
    return dt.isoformat()


@pytest.fixture
def env(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    auth_db.init_db()
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("SNAPTRADE_CLIENT_ID", "cid")
    monkeypatch.setenv("SNAPTRADE_CONSUMER_KEY", "ck")
    snap.set_limiter(_NoThrottle())
    snap.configure(_Group(api_status=_Group(check=lambda **kw: _Resp({"online": True}))))
    # Fleet checks skip unpaid users; make test users admins.
    def mk_user(uid):
        c = auth_db.get_connection()
        c.execute("INSERT OR REPLACE INTO users (id, email, password_hash, role) "
                  "VALUES (?, ?, 'x', 'admin')", (uid, f"{uid}@x.com"))
        c.commit(); c.close()
    pings = []
    monkeypatch.setattr(fleet_monitor, "_post_discord",
                        lambda title, desc: pings.append((title, desc)))
    fleet_monitor._reset_dedup_for_tests()
    yield {"mk_user": mk_user, "pings": pings}
    snap.reset()


def _mk_conn_with_account(uid, *, last_sync_at=None, status="active", sync_enabled=True):
    connections.save_broker_user(uid, f"{uid}-uid", "secret")
    ba = connections.map_snaptrade_account(uid, {
        "id": f"S-{uid}", "name": "Robinhood", "number": "1234",
        "institution_name": "Robinhood",
    })
    conn = auth_db.get_connection()
    conn.execute(
        "UPDATE j2_broker_accounts SET status=?, sync_enabled=?, last_sync_at=?, "
        "last_sync_status=? WHERE id=?",
        (status, 1 if sync_enabled else 0, last_sync_at,
         "ok" if last_sync_at else None, ba["id"]),
    )
    conn.commit(); conn.close()
    return ba


@pytest.mark.asyncio
async def test_detects_stranded_connect(env):
    env["mk_user"]("u-stranded")
    connections.save_broker_user("u-stranded", "uid-s", "secret")  # identity, 0 accounts
    # Backdate consent past the grace window.
    conn = auth_db.get_connection()
    conn.execute("UPDATE j2_broker_users SET consent_at=? WHERE user_id='u-stranded'",
                 (_iso(datetime.now(timezone.utc) - timedelta(hours=2)),))
    conn.commit(); conn.close()
    out = await fleet_monitor.run_fleet_check()
    kinds = [f["kind"] for f in out["findings"]]
    assert "stranded_connect" in kinds
    assert len(env["pings"]) == 1


@pytest.mark.asyncio
async def test_detects_stale_sync_and_still_broken(env):
    env["mk_user"]("u-stale"); env["mk_user"]("u-broken")
    _mk_conn_with_account(
        "u-stale", last_sync_at=_iso(datetime.now(timezone.utc) - timedelta(hours=30)))
    _mk_conn_with_account(
        "u-broken", status="broken",
        last_sync_at=_iso(datetime.now(timezone.utc) - timedelta(hours=1)))
    out = await fleet_monitor.run_fleet_check()
    kinds = sorted(f["kind"] for f in out["findings"])
    assert kinds == ["stale_sync", "still_broken"]


@pytest.mark.asyncio
async def test_healthy_fleet_pings_nothing(env):
    env["mk_user"]("u-ok")
    _mk_conn_with_account(
        "u-ok", last_sync_at=_iso(datetime.now(timezone.utc) - timedelta(minutes=30)))
    out = await fleet_monitor.run_fleet_check()
    assert out["findings"] == []
    assert env["pings"] == []


@pytest.mark.asyncio
async def test_same_findings_dedupe_per_day(env):
    env["mk_user"]("u-stale")
    _mk_conn_with_account(
        "u-stale", last_sync_at=_iso(datetime.now(timezone.utc) - timedelta(hours=30)))
    await fleet_monitor.run_fleet_check()
    await fleet_monitor.run_fleet_check()
    assert len(env["pings"]) == 1


@pytest.mark.asyncio
async def test_suppressed_user_via_env_is_dropped(env, monkeypatch):
    monkeypatch.setenv("BROKER_FLEET_SUPPRESS", "u-testacct, u-other")
    env["mk_user"]("u-testacct")
    _mk_conn_with_account(
        "u-testacct", status="broken",
        last_sync_at=_iso(datetime.now(timezone.utc) - timedelta(hours=1)))
    out = await fleet_monitor.run_fleet_check()
    assert out["findings"] == []
    assert env["pings"] == []


@pytest.mark.asyncio
async def test_bracco_test_account_suppressed_by_default(env):
    uid = "38c023cf-0e81-4187-aa43-ac51a751ae79"
    env["mk_user"](uid)
    _mk_conn_with_account(
        uid, status="broken",
        last_sync_at=_iso(datetime.now(timezone.utc) - timedelta(hours=1)))
    out = await fleet_monitor.run_fleet_check()
    assert out["findings"] == []
    assert env["pings"] == []


@pytest.mark.asyncio
async def test_suppression_leaves_other_users_flagged(env, monkeypatch):
    monkeypatch.setenv("BROKER_FLEET_SUPPRESS", "u-testacct")
    env["mk_user"]("u-testacct"); env["mk_user"]("u-real")
    _mk_conn_with_account(
        "u-testacct", status="broken",
        last_sync_at=_iso(datetime.now(timezone.utc) - timedelta(hours=1)))
    _mk_conn_with_account(
        "u-real", status="broken",
        last_sync_at=_iso(datetime.now(timezone.utc) - timedelta(hours=1)))
    out = await fleet_monitor.run_fleet_check()
    assert [f["userId"] for f in out["findings"]] == ["u-real"]


@pytest.mark.asyncio
async def test_snaptrade_heartbeat_failure_is_a_finding(env):
    def down(**kw):
        raise RuntimeError("connection refused")
    snap.configure(_Group(api_status=_Group(check=down)))
    out = await fleet_monitor.run_fleet_check()
    assert any(f["kind"] == "snaptrade_unreachable" for f in out["findings"])
