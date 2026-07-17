"""Budgeted on-demand SnapTrade holdings refresh (manual_refresh.py) +
holdings-freshness bookkeeping captured during sync.

SnapTrade's scheduled brokerage pull is ~nightly; these cover the same-day
freshness rail: sync stores the broker-reported holdings snapshot time +
authorization id, and a member opening the Journal with a stale snapshot
triggers ONE budgeted refresh_brokerage_authorization call.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.broker import (
    snaptrade_client as snap, connections, manual_refresh, sync,
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
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("SNAPTRADE_CLIENT_ID", "cid")
    monkeypatch.setenv("SNAPTRADE_CONSUMER_KEY", "ck")
    snap.set_limiter(_NoThrottle())
    connections.save_broker_user("u1", "snap-uid", "secret")
    ba = connections.map_snaptrade_account("u1", {
        "id": "S1", "name": "Webull", "number": "1234",
        "institution_name": "Webull", "type": "margin",
    })
    manual_refresh._reset_trigger_dedup_for_tests()
    yield {"ba_id": ba["id"]}
    snap.reset()


def _set_account(ba_id, **cols):
    conn = auth_db.get_connection()
    sets = ", ".join(f"{k}=?" for k in cols)
    conn.execute(f"UPDATE j2_broker_accounts SET {sets} WHERE id=?",
                 (*cols.values(), ba_id))
    conn.commit()
    conn.close()


def _stale_ready_account(ba_id, hours_stale=12):
    _set_account(
        ba_id,
        brokerage_authorization_id="auth-1",
        holdings_synced_at=_iso(datetime.now(timezone.utc) - timedelta(hours=hours_stale)),
        last_manual_refresh_at=None,
    )


def _refresh_recorder(calls):
    def fn(**kw):
        calls.append(kw)
        return _Resp({"detail": "refresh queued"})
    return fn


# ── sync captures holdings freshness metadata ────────────────────────────────

@pytest.mark.asyncio
async def test_sync_stores_holdings_synced_at_and_auth_id(env):
    hs = "2026-07-16T03:16:00Z"
    snap.configure(_Group(account_information=_Group(
        get_account_activities=lambda **kw: _Resp({"data": [], "pagination": {"total": 0}}),
        get_user_account_positions=lambda **kw: _Resp([]),
        get_user_account_balance=lambda **kw: _Resp([]),
        list_user_accounts=lambda **kw: _Resp([{
            "id": "S1", "brokerage_authorization": "auth-xyz",
            "balance": {"total": {"amount": 1000, "currency": "USD"}},
            "sync_status": {
                "holdings": {"last_successful_sync": hs},
                "transactions": {
                    "initial_sync_completed": True,
                    "last_successful_sync": "2026-07-16",
                    "first_transaction_date": "2024-01-05",
                },
            },
        }]),
    )))
    await sync.sync_account("u1", env["ba_id"])
    ba = connections.get_broker_account("u1", env["ba_id"])
    assert ba["holdingsSyncedAt"] == hs
    assert ba["brokerageAuthorizationId"] == "auth-xyz"
    assert ba["txInitialSyncCompleted"] is True
    assert ba["txLastSuccessfulSync"] == "2026-07-16"
    assert ba["firstTransactionDate"] == "2024-01-05"


# ── maybe_refresh_user budget logic ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_stale_holdings_trigger_one_refresh(env, monkeypatch):
    monkeypatch.setattr(manual_refresh, "_in_trading_window", lambda *a: True)
    _stale_ready_account(env["ba_id"])
    calls = []
    snap.configure(_Group(connections=_Group(
        refresh_brokerage_authorization=_refresh_recorder(calls))))
    out = await manual_refresh.maybe_refresh_user("u1")
    assert out["requested"] == [env["ba_id"]]
    assert len(calls) == 1
    assert calls[0]["authorization_id"] == "auth-1"
    # The stamp prevents an immediate repeat.
    ba = connections.get_broker_account("u1", env["ba_id"])
    assert ba["lastManualRefreshAt"] is not None
    out2 = await manual_refresh.maybe_refresh_user("u1")
    assert out2["requested"] == [] and len(calls) == 1


@pytest.mark.asyncio
async def test_fresh_holdings_do_not_refresh(env, monkeypatch):
    monkeypatch.setattr(manual_refresh, "_in_trading_window", lambda *a: True)
    _set_account(
        env["ba_id"],
        brokerage_authorization_id="auth-1",
        holdings_synced_at=_iso(datetime.now(timezone.utc) - timedelta(hours=1)),
    )
    calls = []
    snap.configure(_Group(connections=_Group(
        refresh_brokerage_authorization=_refresh_recorder(calls))))
    out = await manual_refresh.maybe_refresh_user("u1")
    assert out["requested"] == [] and calls == []


@pytest.mark.asyncio
async def test_missing_auth_id_or_unknown_age_skips(env, monkeypatch):
    monkeypatch.setattr(manual_refresh, "_in_trading_window", lambda *a: True)
    calls = []
    snap.configure(_Group(connections=_Group(
        refresh_brokerage_authorization=_refresh_recorder(calls))))
    # No auth id, no holdings timestamp (fresh connect, pre-first-sync).
    out = await manual_refresh.maybe_refresh_user("u1")
    assert out["requested"] == [] and calls == []
    # Auth id but unknown snapshot age — still no spend.
    _set_account(env["ba_id"], brokerage_authorization_id="auth-1")
    out = await manual_refresh.maybe_refresh_user("u1")
    assert out["requested"] == [] and calls == []


@pytest.mark.asyncio
async def test_outside_trading_window_skips(env, monkeypatch):
    monkeypatch.setattr(manual_refresh, "_in_trading_window", lambda *a: False)
    _stale_ready_account(env["ba_id"])
    calls = []
    snap.configure(_Group(connections=_Group(
        refresh_brokerage_authorization=_refresh_recorder(calls))))
    out = await manual_refresh.maybe_refresh_user("u1")
    assert out["requested"] == [] and calls == []


@pytest.mark.asyncio
async def test_kill_switch_disables(env, monkeypatch):
    monkeypatch.setattr(manual_refresh, "_in_trading_window", lambda *a: True)
    monkeypatch.setenv("BROKER_MANUAL_REFRESH_ENABLED", "0")
    _stale_ready_account(env["ba_id"])
    calls = []
    snap.configure(_Group(connections=_Group(
        refresh_brokerage_authorization=_refresh_recorder(calls))))
    out = await manual_refresh.maybe_refresh_user("u1")
    assert out["requested"] == [] and calls == []


@pytest.mark.asyncio
async def test_refresh_failure_is_swallowed(env, monkeypatch):
    monkeypatch.setattr(manual_refresh, "_in_trading_window", lambda *a: True)
    _stale_ready_account(env["ba_id"])

    def boom(**kw):
        raise RuntimeError("SnapTrade down")
    snap.configure(_Group(connections=_Group(refresh_brokerage_authorization=boom)))
    out = await manual_refresh.maybe_refresh_user("u1")  # must not raise
    assert out["requested"] == []
    # No stamp on failure — eligible to retry next window.
    ba = connections.get_broker_account("u1", env["ba_id"])
    assert ba["lastManualRefreshAt"] is None


def test_trading_window_boundaries():
    from zoneinfo import ZoneInfo
    tz = ZoneInfo("America/New_York")
    assert manual_refresh._in_trading_window(datetime(2026, 7, 16, 10, 0, tzinfo=tz))
    assert not manual_refresh._in_trading_window(datetime(2026, 7, 16, 5, 0, tzinfo=tz))
    assert not manual_refresh._in_trading_window(datetime(2026, 7, 18, 10, 0, tzinfo=tz))  # Saturday
