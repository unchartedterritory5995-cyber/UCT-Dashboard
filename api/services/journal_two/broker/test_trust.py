"""Tests for the Sync Trust Center backend (Task B6).

Covers the two read-only status surfaces built on the existing broker
plumbing: the per-user sync-audit-log read (`service.sync_log`) and the
per-account trust summary (`service.trust_summary`) — health fields +
imported-vs-broker counts + coarse token state. Plus the pure token-state
helper in `connections`.

No network: the SnapTrade client is configured with a fake SDK (the trust
reads never touch it, but we mirror the broker test harness) and every table
is seeded directly against a temp-file SQLite DB.
"""

from __future__ import annotations

import uuid

import pytest
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two.broker import snaptrade_client as snap
from api.services.journal_two.broker import connections
from api.services.journal_two.broker import service as broker_service
from api.middleware import auth_middleware as authmw
from api.routers import broker_sync as broker_router


class _Group:
    def __init__(self, **m):
        for k, v in m.items():
            setattr(self, k, v)


class _NoThrottle:
    async def acquire(self, n=1):
        return None


def _fake_sdk():
    return _Group(
        authentication=_Group(),
        account_information=_Group(),
    )


@pytest.fixture
def env(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", Fernet.generate_key().decode())
    snap.configure(_fake_sdk())
    snap.set_limiter(_NoThrottle())
    yield
    snap.reset()


# ── Seed helpers ─────────────────────────────────────────────────────────────

def _seed_broker_account(user_id, *, status="active", starting_balance=1000.0):
    """Create a j2_account + a linked j2_broker_accounts row. Returns
    (broker_account_id, j2_account_id)."""
    acct = accounts_service.create_account(
        user_id, {"name": f"B-{uuid.uuid4().hex[:4]}", "color": "blue",
                  "startingBalance": starting_balance})
    j2_account_id = acct["id"]
    broker_account_id = str(uuid.uuid4())
    conn = auth_db.get_connection()
    try:
        conn.execute(
            "UPDATE j2_accounts SET balance_source = 'broker' WHERE id = ?",
            (j2_account_id,))
        conn.execute(
            "INSERT INTO j2_broker_accounts (id, user_id, snaptrade_account_id, "
            "brokerage_name, account_number_masked, account_type, currency, "
            "j2_account_id, sync_enabled, status, last_sync_at, last_sync_status, "
            "last_error, created_at, updated_at) VALUES "
            "(?, ?, ?, 'Charles Schwab', '••3333', 'margin', 'USD', ?, 1, ?, "
            "'2026-01-02T00:00:00Z', 'ok', ?, '2026-01-01', '2026-01-01')",
            (broker_account_id, user_id, f"S-{broker_account_id[:6]}", j2_account_id,
             status, "secret invalid — reconnect" if status == "broken" else None))
        conn.commit()
    finally:
        conn.close()
    return broker_account_id, j2_account_id


def _seed_sync_log(user_id, broker_account_id, *, started_at, status="ok",
                   trades=0, positions=0, options=0, error=None):
    conn = auth_db.get_connection()
    try:
        conn.execute(
            "INSERT INTO j2_broker_sync_log (id, user_id, broker_account_id, "
            "started_at, finished_at, trades_imported, positions_upserted, "
            "options_imported, dup_candidates, status, error) VALUES "
            "(?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
            (str(uuid.uuid4()), user_id, broker_account_id, started_at,
             started_at, trades, positions, options, status, error))
        conn.commit()
    finally:
        conn.close()


def _seed_activity(user_id, broker_account_id, *, symbol="AAPL"):
    conn = auth_db.get_connection()
    try:
        conn.execute(
            "INSERT INTO j2_broker_activities (id, user_id, broker_account_id, "
            "external_id, activity_type, symbol, occurred_at, raw_json, "
            "processed, created_at) VALUES (?, ?, ?, ?, 'BUY', ?, "
            "'2026-01-01T00:00:00Z', '{}', 1, '2026-01-01T00:00:00Z')",
            (str(uuid.uuid4()), user_id, broker_account_id,
             f"ext-{uuid.uuid4().hex[:8]}", symbol))
        conn.commit()
    finally:
        conn.close()


def _seed_broker_trade(user_id, account_id, *, symbol="AAPL"):
    conn = auth_db.get_connection()
    try:
        conn.execute(
            "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, "
            "entry_price, entry_date, exit_price, exit_date, original_stop, setup, "
            "notes, pnl_dollar, pnl_percent, r_multiple, hold_days, result, "
            "context_at_entry, created_at, account_id, source) VALUES "
            "(?, ?, 'pos', ?, 'Long', 10, 100.0, '2026-01-01T00:00:00Z', 110.0, "
            "'2026-01-02T00:00:00Z', 95.0, NULL, NULL, 100.0, 0.1, 2.0, 1, 'Win', "
            "'{}', '2026-01-02T00:00:00Z', ?, 'broker')",
            (str(uuid.uuid4()), user_id, symbol, account_id))
        conn.commit()
    finally:
        conn.close()


def _seed_broker_position(user_id, account_id, *, symbol="AAPL", closed=False):
    conn = auth_db.get_connection()
    try:
        conn.execute(
            "INSERT INTO j2_positions (id, user_id, symbol, side, entry_date, shares, "
            "original_shares, entry_price, stop_price, breakeven_stop, "
            "raise_to_breakeven, setup, notes, context_at_entry, created_at, "
            "updated_at, closed_at, account_id, source, external_id, entry_estimated) "
            "VALUES (?, ?, ?, 'Long', '2026-01-01T00:00:00Z', 5, 5, 100.0, 100.0, "
            "NULL, 0, NULL, NULL, '{}', '2026-01-01', '2026-01-01', ?, ?, 'broker', "
            "?, 1)",
            (str(uuid.uuid4()), user_id, symbol,
             "2026-01-03T00:00:00Z" if closed else None, account_id,
             f"bkpos-{uuid.uuid4().hex[:6]}"))
        conn.commit()
    finally:
        conn.close()


# ── token_state helper ───────────────────────────────────────────────────────

def test_token_state_broken_wins():
    assert connections.token_state(account_status="broken") == "broken"
    # broken overrides even a disabled authorization
    assert connections.token_state(
        account_status="broken", authorization_disabled=True) == "broken"


def test_token_state_ok_default():
    assert connections.token_state(account_status="active") == "ok"
    assert connections.token_state(account_status="disabled") == "ok"
    assert connections.token_state(
        account_status="active", authorization_disabled=None) == "ok"
    assert connections.token_state(
        account_status="active", authorization_disabled=False) == "ok"


def test_token_state_expiring_when_disabled():
    assert connections.token_state(
        account_status="active", authorization_disabled=True) == "expiring"


def test_authorization_disabled_reads_nested_flag():
    # Nested authorization object carrying the disabled flag → captured.
    assert connections.authorization_disabled(
        {"brokerage_authorization": {"disabled": True}}) is True
    assert connections.authorization_disabled(
        {"brokerage_authorization": {"disabled": False}}) is False
    assert connections.authorization_disabled(
        {"brokerage_authorization": {"disabled_date": "2026-02-01"}}) is True
    # Common case on the current plan: it's just an id string → not exposed.
    assert connections.authorization_disabled(
        {"brokerage_authorization": "auth-uuid"}) is None
    assert connections.authorization_disabled({}) is None


# ── sync_log ─────────────────────────────────────────────────────────────────

def test_sync_log_user_scoped_newest_first_limited(env):
    ba1, _ = _seed_broker_account("u1")
    ba2, _ = _seed_broker_account("u2")
    _seed_sync_log("u1", ba1, started_at="2026-01-01T00:00:00Z", trades=1)
    _seed_sync_log("u1", ba1, started_at="2026-01-03T00:00:00Z", trades=3)
    _seed_sync_log("u1", ba1, started_at="2026-01-02T00:00:00Z", trades=2)
    _seed_sync_log("u2", ba2, started_at="2026-01-05T00:00:00Z", trades=9)

    rows = broker_service.sync_log("u1")
    # Only u1's rows.
    assert len(rows) == 3
    assert all("u2" not in (r.get("brokerAccountId") or "") for r in rows)
    # Newest first.
    assert [r["startedAt"] for r in rows] == [
        "2026-01-03T00:00:00Z", "2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z"]
    # camelCased shape.
    top = rows[0]
    assert top["tradesImported"] == 3
    assert set(["id", "brokerAccountId", "startedAt", "finishedAt",
                "tradesImported", "positionsUpserted", "optionsImported",
                "status", "error"]).issubset(top.keys())

    # limit honored.
    assert len(broker_service.sync_log("u1", limit=1)) == 1


def test_sync_log_account_filter(env):
    ba1, _ = _seed_broker_account("u1")
    ba2, _ = _seed_broker_account("u1")
    _seed_sync_log("u1", ba1, started_at="2026-01-01T00:00:00Z")
    _seed_sync_log("u1", ba2, started_at="2026-01-02T00:00:00Z")
    rows = broker_service.sync_log("u1", account_id=ba1)
    assert len(rows) == 1
    assert rows[0]["brokerAccountId"] == ba1


# ── trust_summary ────────────────────────────────────────────────────────────

def test_trust_summary_health_counts_and_token_state(env):
    ba, j2 = _seed_broker_account("u1", status="active")
    # 3 raw activities (broker truth), 2 broker trades, 1 open + 1 closed pos.
    _seed_activity("u1", ba)
    _seed_activity("u1", ba)
    _seed_activity("u1", ba)
    _seed_broker_trade("u1", j2)
    _seed_broker_trade("u1", j2, symbol="MSFT")
    _seed_broker_position("u1", j2, closed=False)
    _seed_broker_position("u1", j2, symbol="MSFT", closed=True)

    out = broker_service.trust_summary("u1")
    assert out["anyBroker"] is True
    assert len(out["accounts"]) == 1
    a = out["accounts"][0]
    # Health fields threaded from the account row.
    assert a["brokerageName"] == "Charles Schwab"
    assert a["accountNumberMasked"] == "••3333"
    assert a["status"] == "active"
    assert a["lastSyncStatus"] == "ok"
    assert a["syncEnabled"] is True
    assert a["warming"] is False
    assert "lastSyncAt" in a and "lastError" in a
    # Counts.
    assert a["importedActivityCount"] == 3
    assert a["tradeCount"] == 2
    assert a["positionCount"] == 1   # only the OPEN position
    assert a["tokenState"] == "ok"


def test_trust_summary_broken_account_token_state(env):
    ba, j2 = _seed_broker_account("u1", status="broken")
    out = broker_service.trust_summary("u1")
    a = out["accounts"][0]
    assert a["status"] == "broken"
    assert a["tokenState"] == "broken"
    assert a["lastError"]


def test_trust_summary_counts_scoped_to_account(env):
    ba_a, j2a = _seed_broker_account("u1")
    ba_b, j2b = _seed_broker_account("u1")
    _seed_activity("u1", ba_a)
    _seed_broker_trade("u1", j2a)
    # Account B has its own data; must not bleed into A's counts.
    _seed_activity("u1", ba_b)
    _seed_activity("u1", ba_b)
    _seed_broker_trade("u1", j2b)
    _seed_broker_position("u1", j2b)

    out = broker_service.trust_summary("u1")
    by_id = {a["brokerAccountId"]: a for a in out["accounts"]}
    assert by_id[ba_a]["importedActivityCount"] == 1
    assert by_id[ba_a]["tradeCount"] == 1
    assert by_id[ba_a]["positionCount"] == 0
    assert by_id[ba_b]["importedActivityCount"] == 2
    assert by_id[ba_b]["tradeCount"] == 1
    assert by_id[ba_b]["positionCount"] == 1


def test_trust_summary_no_broker(env):
    out = broker_service.trust_summary("nobody")
    assert out["anyBroker"] is False
    assert out["accounts"] == []


# ── Route-level (auth-gated, user-scoped) ────────────────────────────────────

@pytest.fixture
def client(env):
    app = FastAPI()
    app.include_router(broker_router.router)
    app.dependency_overrides[authmw.get_current_user] = \
        lambda: {"id": "u1", "role": "member"}
    c = TestClient(app)
    c._app = app
    yield c


def test_route_sync_log_and_trust(client):
    ba, j2 = _seed_broker_account("u1")
    _seed_sync_log("u1", ba, started_at="2026-01-01T00:00:00Z", trades=4)
    _seed_activity("u1", ba)
    _seed_broker_trade("u1", j2)

    r = client.get("/api/j2/broker/sync-log")
    assert r.status_code == 200
    rows = r.json()["rows"]
    assert len(rows) == 1 and rows[0]["tradesImported"] == 4

    r2 = client.get("/api/j2/broker/trust")
    assert r2.status_code == 200
    body = r2.json()
    assert body["anyBroker"] is True
    assert body["accounts"][0]["importedActivityCount"] == 1
    assert body["accounts"][0]["tradeCount"] == 1
    assert body["accounts"][0]["tokenState"] == "ok"


def test_route_trust_requires_auth():
    # No dependency override → get_current_user runs for real → 401/403 (not 405).
    app = FastAPI()
    app.include_router(broker_router.router)
    c = TestClient(app)
    assert c.get("/api/j2/broker/trust").status_code in (401, 403)
    assert c.get("/api/j2/broker/sync-log").status_code in (401, 403)
