"""Tests for the per-account sync pipeline: backfill, incremental dedup,
pagination, the per-account lock, secret-invalid handling, and audit log."""

from __future__ import annotations

import asyncio

import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.broker import (
    snaptrade_client as snap, connections, activities_store, sync,
)
from snaptrade_client.exceptions import ApiException


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


def _act(aid, typ, ticker, units, price, date):
    return {"id": aid, "type": typ, "units": units, "price": price, "fee": 0,
            "symbol": {"symbol": ticker}, "trade_date": date, "currency": "USD"}


ACTS = [
    _act("a1", "BUY", "AAPL", 10, 100, "2026-04-01"),
    _act("a2", "SELL", "AAPL", 10, 110, "2026-04-02"),
    _act("a3", "SELL", "TSLA", 5, 60, "2026-04-01"),
    _act("a4", "BUY", "TSLA", 5, 50, "2026-04-03"),
]


def _activities_fn(acts, calls):
    def fn(**kw):
        calls.append(kw)
        start = kw.get("start_date")
        offset = kw.get("offset", 0)
        limit = kw.get("limit", 1000)
        data = acts
        if start is not None:
            data = [a for a in acts if a["trade_date"] >= start.isoformat()]
        page = data[offset:offset + limit]
        return _Resp({"data": page, "pagination": {"offset": offset, "limit": limit, "total": len(data)}})
    return fn


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
    # broker identity + a mapped account
    connections.save_broker_user("u1", "snap-uid", "secret")
    ba = connections.map_snaptrade_account("u1", {
        "id": "S1", "name": "Schwab", "number": "1234",
        "institution_name": "Schwab", "type": "margin",
    })
    calls = []
    snap.configure(_Group(account_information=_Group(
        get_account_activities=_activities_fn(ACTS, calls),
        get_user_account_positions=lambda **kw: _Resp([]),
        get_user_account_balance=lambda **kw: _Resp([]),
    )))
    yield {"ba_id": ba["id"], "j2": ba["j2AccountId"], "calls": calls}
    snap.reset()


def _trade_count(user="u1"):
    conn = auth_db.get_connection()
    try:
        return conn.execute("SELECT COUNT(*) AS n FROM j2_trades WHERE user_id=?", (user,)).fetchone()["n"]
    finally:
        conn.close()


@pytest.mark.asyncio
async def test_sync_reconciles_positions_and_balances(env):
    # Reconfigure the SDK to also return a holding + balances.
    calls = []
    snap.configure(_Group(account_information=_Group(
        get_account_activities=_activities_fn(ACTS, calls),
        get_user_account_positions=lambda **kw: _Resp(
            [{"symbol": {"symbol": "NVDA"}, "units": 100, "price": 500, "average_purchase_price": 450}]
        ),
        get_user_account_balance=lambda **kw: _Resp(
            [{"currency": "USD", "cash": 10000, "buying_power": 20000}]
        ),
    )))
    out = await sync.sync_account("u1", env["ba_id"])
    assert out["positionsUpserted"] == 1
    # Real broker balances landed on the account.
    from api.services.journal_two import accounts as accounts_service
    acct = accounts_service.get_account("u1", env["j2"])
    assert acct["balanceSource"] == "broker"
    # equity = cash 10000 + market value (100*500=50000) = 60000
    assert acct["brokerTotalEquity"] == 60000.0
    # The holding became an open j2_position (carried-in, estimated entry).
    conn = auth_db.get_connection()
    row = conn.execute(
        "SELECT symbol, shares, entry_price, entry_estimated, source FROM j2_positions "
        "WHERE user_id='u1' AND symbol='NVDA'"
    ).fetchone()
    conn.close()
    assert row["shares"] == 100 and row["entry_price"] == 450
    assert row["entry_estimated"] == 1 and row["source"] == "broker"


@pytest.mark.asyncio
async def test_sync_captures_cash_flows(env):
    acts = ACTS + [
        {"id": "c1", "type": "CONTRIBUTION", "amount": 5000, "currency": "USD",
         "trade_date": "2026-04-01"},
        {"id": "c2", "type": "WITHDRAWAL", "amount": 1000, "currency": "USD",
         "trade_date": "2026-04-02"},
        {"id": "c3", "type": "DIVIDEND", "amount": 12.5, "currency": "USD",
         "trade_date": "2026-04-02"},
    ]
    calls = []
    snap.configure(_Group(account_information=_Group(
        get_account_activities=_activities_fn(acts, calls),
        get_user_account_positions=lambda **kw: _Resp([]),
        get_user_account_balance=lambda **kw: _Resp(
            [{"currency": "USD", "cash": 10000, "buying_power": 20000}]
        ),
    )))
    await sync.sync_account("u1", env["ba_id"])
    from api.services.journal_two.broker import cashflow_store as store
    # External flows = deposit 5000 - withdrawal 1000 = 4000 (dividend excluded).
    assert store.sum_flows("u1", env["j2"], external_only=True) == 4000.0
    # All flows incl. dividend = 4012.5.
    assert store.sum_flows("u1", env["j2"], external_only=False) == 4012.5


@pytest.mark.asyncio
async def test_full_backfill_imports_and_advances_cursor(env):
    out = await sync.sync_account("u1", env["ba_id"])
    assert out["imported"] == 2
    assert out["newActivities"] == 4
    assert _trade_count() == 2
    assert activities_store.count("u1", env["ba_id"]) == 4
    ba = connections.get_broker_account("u1", env["ba_id"])
    assert ba["activitiesCursor"] == "2026-04-03T00:00:00Z"  # latest
    assert ba["lastSyncStatus"] == "ok"
    # First sync had no cursor → start_date omitted (backfill = all history).
    assert env["calls"][0].get("start_date") is None


@pytest.mark.asyncio
async def test_incremental_rerun_no_duplicates(env):
    await sync.sync_account("u1", env["ba_id"])
    out2 = await sync.sync_account("u1", env["ba_id"])
    assert out2["imported"] == 0     # idempotent
    assert _trade_count() == 2
    # Second sync used the cursor → start_date set (minus overlap).
    assert env["calls"][-1]["start_date"] is not None


@pytest.mark.asyncio
async def test_pagination(env, monkeypatch):
    monkeypatch.setattr(sync, "_PAGE", 2)  # force 2 pages over 4 activities
    out = await sync.sync_account("u1", env["ba_id"])
    assert out["newActivities"] == 4
    assert _trade_count() == 2
    # offsets 0 and 2 requested.
    offsets = [c["offset"] for c in env["calls"]]
    assert 0 in offsets and 2 in offsets


@pytest.mark.asyncio
async def test_concurrent_sync_same_account_no_dup(env):
    # Lock serializes; idempotency guards. Final state: 2 trades, no error.
    await asyncio.gather(
        sync.sync_account("u1", env["ba_id"]),
        sync.sync_account("u1", env["ba_id"]),
    )
    assert _trade_count() == 2
    assert activities_store.count("u1", env["ba_id"]) == 4


@pytest.mark.asyncio
async def test_secret_invalid_marks_broken(env):
    def boom(**kw):
        e = ApiException(status=401)
        e.body = {"code": "1076", "detail": "user secret invalid"}
        e.headers = {}
        raise e
    snap.configure(_Group(account_information=_Group(get_account_activities=boom)))
    with pytest.raises(snap.SnapUserSecretInvalid):
        await sync.sync_account("u1", env["ba_id"])
    ba = connections.get_broker_account("u1", env["ba_id"])
    assert ba["status"] == "broken"
    assert ba["lastSyncStatus"] == "error"


@pytest.mark.asyncio
async def test_sync_log_written(env):
    await sync.sync_account("u1", env["ba_id"])
    conn = auth_db.get_connection()
    try:
        row = conn.execute(
            "SELECT status, trades_imported, finished_at FROM j2_broker_sync_log "
            "WHERE user_id='u1' ORDER BY started_at DESC LIMIT 1"
        ).fetchone()
    finally:
        conn.close()
    assert row["status"] == "ok"
    assert row["trades_imported"] == 2
    assert row["finished_at"] is not None
