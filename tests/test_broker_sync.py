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
async def test_holdings_refresh_failure_is_surfaced_not_silently_ok(env, monkeypatch):
    # A SnapError while fetching the LIVE holdings/balances (rate-limit,
    # transient, unsupported broker) must NOT report a clean success: the
    # activities import above already succeeded, but current state
    # (equity/cash/positions) is stale. The prior code fell through to
    # record_sync_result(ok=True) → last_error=None, so a newly-added position
    # stayed invisible until a manual "Sync now" (the reported bug).
    async def boom(*a, **kw):
        raise snap.SnapError("positions endpoint 503")

    monkeypatch.setattr(snap, "get_positions", boom)
    out = await sync.sync_account("u1", env["ba_id"])

    # Trades still imported (the activities half succeeded) + cursor advanced.
    assert out["imported"] == 2
    assert _trade_count() == 2
    assert out["balancesError"] and "holdings/balances not refreshed" in out["balancesError"]
    ba = connections.get_broker_account("u1", env["ba_id"])
    assert ba["activitiesCursor"] == "2026-04-03T00:00:00Z"

    # The account's freshness signal reflects the stale holdings, not a green check.
    conn = auth_db.get_connection()
    try:
        row = conn.execute(
            "SELECT last_sync_status, last_error FROM j2_broker_accounts WHERE id=?",
            (env["ba_id"],),
        ).fetchone()
    finally:
        conn.close()
    assert row["last_sync_status"] == "error"
    assert "holdings/balances not refreshed" in (row["last_error"] or "")

    # The audit-log row must AGREE with the account chip — a stale-holdings sync
    # is an 'error' row carrying the reason, never a green 'ok' beside an amber
    # health badge (the diagnostic surface must not lie).
    conn = auth_db.get_connection()
    try:
        log = conn.execute(
            "SELECT status, error FROM j2_broker_sync_log WHERE user_id='u1' "
            "ORDER BY started_at DESC LIMIT 1"
        ).fetchone()
    finally:
        conn.close()
    assert log["status"] == "error"
    assert "holdings/balances not refreshed" in (log["error"] or "")


@pytest.mark.asyncio
async def test_broken_connection_recovers_despite_holdings_hiccup(env, monkeypatch):
    # A previously-broken connection whose AUTH has healed (activities fetched
    # fine) but that hits a transient holdings rate-limit must recover to
    # 'active' — the holdings staleness is an error on last_sync_status, NOT a
    # false "reconnect needed" banner.
    connections.set_status("u1", env["ba_id"], "broken", error="was broken")

    async def boom(*a, **kw):
        raise snap.SnapError("positions endpoint 429")

    monkeypatch.setattr(snap, "get_positions", boom)
    await sync.sync_account("u1", env["ba_id"])
    ba = connections.get_broker_account("u1", env["ba_id"])
    assert ba["status"] == "active"          # auth recovered
    assert ba["lastSyncStatus"] == "error"   # holdings still flagged stale


@pytest.mark.asyncio
async def test_clean_sync_still_reports_ok(env):
    # Guard against over-flagging: a fully successful sync (holdings included)
    # must still record ok with no balancesError.
    out = await sync.sync_account("u1", env["ba_id"])
    assert out["balancesError"] is None
    ba = connections.get_broker_account("u1", env["ba_id"])
    assert ba["lastSyncStatus"] == "ok"


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
async def test_generic_auth_error_marks_broken(env):
    # A 401 WITHOUT the secret-invalid code (no body / generic reason) — the
    # real-world shape from prod 2026-07-14 — must still flag the connection
    # broken so the UI shows "Reconnect needed" instead of silently failing.
    def boom(**kw):
        e = ApiException(status=401, reason="Unauthorized")
        e.body = None
        e.headers = {}
        raise e
    snap.configure(_Group(account_information=_Group(get_account_activities=boom)))
    with pytest.raises(snap.SnapAuthError):
        await sync.sync_account("u1", env["ba_id"])
    ba = connections.get_broker_account("u1", env["ba_id"])
    assert ba["status"] == "broken"
    assert ba["lastSyncStatus"] == "error"


@pytest.mark.asyncio
async def test_sync_retries_when_database_locked(env, monkeypatch):
    # A transient SQLite "database is locked" (auth.db write contention on the
    # single web pod) must not fail the sync outright — retry the idempotent
    # _do_sync and succeed on the second attempt.
    import sqlite3
    real = activities_store.store_activities
    state = {"n": 0}

    def flaky(*a, **kw):
        state["n"] += 1
        if state["n"] == 1:
            raise sqlite3.OperationalError("database is locked")
        return real(*a, **kw)

    monkeypatch.setattr(activities_store, "store_activities", flaky)
    monkeypatch.setattr(sync, "_LOCKED_RETRY_DELAYS", (0.0,), raising=False)
    out = await sync.sync_account("u1", env["ba_id"])
    assert out["imported"] == 2
    assert state["n"] == 2
    ba = connections.get_broker_account("u1", env["ba_id"])
    assert ba["lastSyncStatus"] == "ok"


@pytest.mark.asyncio
async def test_sync_locked_exhausted_still_raises(env, monkeypatch):
    # Persistent lock (not transient) → retries exhaust → error surfaces.
    import sqlite3

    def always_locked(*a, **kw):
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(activities_store, "store_activities", always_locked)
    monkeypatch.setattr(sync, "_LOCKED_RETRY_DELAYS", (0.0,), raising=False)
    with pytest.raises(sqlite3.OperationalError):
        await sync.sync_account("u1", env["ba_id"])


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


@pytest.mark.asyncio
async def test_locked_retry_delays_are_jittered(env, monkeypatch):
    # Parallel syncs that retry in LOCKSTEP re-collide (prod 2026-07-16
    # morning bursts). Each retry sleep must be jittered around its base.
    import sqlite3
    sleeps = []

    async def capture_sleep(s):
        sleeps.append(s)

    monkeypatch.setattr(sync.asyncio, "sleep", capture_sleep)
    monkeypatch.setattr(sync.random, "uniform", lambda a, b: 1.3)
    monkeypatch.setattr(sync, "_LOCKED_RETRY_DELAYS", (2.0,))

    def always_locked(*a, **kw):
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(activities_store, "store_activities", always_locked)
    with pytest.raises(sqlite3.OperationalError):
        await sync.sync_account("u1", env["ba_id"])
    assert sleeps == [2.0 * 1.3]


def test_locked_retry_has_a_longer_tail():
    # Three retries (four attempts) with a patient tail — a big concurrent
    # backfill can hold auth.db past a ~4s total budget.
    assert sync._LOCKED_RETRY_DELAYS == (1.0, 3.0, 8.0)


def test_sync_cadence_label_reflects_config(monkeypatch):
    # The Trust Center chip is DERIVED from this, so it can never drift from the
    # real cadence the way the hardcoded "auto every 20m" did.
    monkeypatch.delenv("BROKER_SYNC_INTERVAL_MIN", raising=False)
    monkeypatch.delenv("BROKER_SYNC_MODE", raising=False)
    assert sync.sync_cadence_label() == "auto-syncs daily"        # default = 1440
    monkeypatch.setenv("BROKER_SYNC_MODE", "legacy")
    assert sync.sync_cadence_label() == "auto-syncs every 20m"    # legacy = 20
    monkeypatch.setenv("BROKER_SYNC_INTERVAL_MIN", "60")          # explicit wins
    assert sync.sync_cadence_label() == "auto-syncs hourly"
    monkeypatch.setenv("BROKER_SYNC_INTERVAL_MIN", "120")
    assert sync.sync_cadence_label() == "auto-syncs every 2h"


@pytest.mark.asyncio
async def test_sync_all_skips_broken_accounts(env):
    """A broken account (needs reconnect) must not be synced — every attempt
    is a guaranteed 401, and SnapTrade webhooks dead connections daily (prod
    noise: one 401/day from a stale test account). Reconnect flips status to
    active first, so nothing legitimate is skipped."""
    connections.set_status("u1", env["ba_id"], "broken", error="dead")
    out = await sync.sync_all_for_user("u1")
    assert out[env["ba_id"]] == {"skipped": True, "reason": "broken"}


# ── the sweep must actually REPORT a fleet-wide failure (2026-07-23) ─────────

def test_due_sweep_reports_a_failure_spike(monkeypatch):
    """Wiring rail: sync_due_accounts must hand a mass failure to the spike
    detector. Without this the 11-accounts-fail-at-once shape is invisible
    until a per-account rule trips hours later."""
    seen = {}

    def fake_spike(scope, *, due, failed, sample_error=""):
        seen.update(scope=scope, due=due, failed=failed, sample_error=sample_error)
        return True

    monkeypatch.setattr(sync.notifications, "sweep_failure_spike", fake_spike)
    monkeypatch.setattr(sync.connections, "list_due_accounts",
                        lambda interval: [{"userId": f"u{i}", "id": f"a{i}"}
                                          for i in range(4)])
    monkeypatch.setattr(sync, "_user_is_paid", lambda uid, cache: True)

    async def boom(user_id, account_id, **kw):
        raise RuntimeError("SnapTrade API error 401: Unauthorized (code 0000)")

    monkeypatch.setattr(sync, "sync_account", boom)
    out = asyncio.run(sync.sync_due_accounts())

    assert out == {"due": 4, "synced": 0, "failed": 4}
    assert seen["due"] == 4 and seen["failed"] == 4
    assert "code 0000" in seen["sample_error"]


def test_due_sweep_does_not_report_when_everything_succeeds(monkeypatch):
    called = []
    monkeypatch.setattr(sync.notifications, "sweep_failure_spike",
                        lambda *a, **k: called.append(1))
    monkeypatch.setattr(sync.connections, "list_due_accounts",
                        lambda interval: [{"userId": "u1", "id": "a1"}])
    monkeypatch.setattr(sync, "_user_is_paid", lambda uid, cache: True)

    async def ok(user_id, account_id, **kw):
        return {"ok": True}

    monkeypatch.setattr(sync, "sync_account", ok)
    asyncio.run(sync.sync_due_accounts())
    assert called == []
