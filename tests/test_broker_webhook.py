"""SnapTrade webhook layer: signature verification (HMAC-SHA256 sorted-compact
JSON per docs, legacy webhookSecret fallback) + connection-lifecycle event
handling (instant broken/fixed/removed status updates; local data never
deleted)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.broker import (
    snaptrade_client as snap, connections, webhook_security,
)
from api.routers import broker_sync as broker_router

CONSUMER_KEY = "test-consumer-key"
LEGACY_SECRET = "legacy-secret"
NOW = datetime(2026, 7, 17, 12, 0, 0, tzinfo=timezone.utc)


def _body(event="ACCOUNT_HOLDINGS_UPDATED", **extra):
    b = {"userId": "u1", "eventType": event,
         "eventTimestamp": NOW.isoformat(), "clientId": "cid"}
    b.update(extra)
    return b


# ── webhook_security.verify (pure) ───────────────────────────────────────────

def test_valid_signature_accepts():
    body = _body()
    sig = webhook_security.compute_signature(body, CONSUMER_KEY)
    ok, mode = webhook_security.verify(
        body, sig, consumer_key=CONSUMER_KEY, legacy_secret=None, now=NOW)
    assert ok and mode == "signature"


def test_signature_over_payload_without_secret_field_accepts():
    # Delivery includes the deprecated webhookSecret field but the signature
    # was computed over the payload WITHOUT it.
    body = _body(webhookSecret="whatever")
    signed = {k: v for k, v in body.items() if k != "webhookSecret"}
    sig = webhook_security.compute_signature(signed, CONSUMER_KEY)
    ok, mode = webhook_security.verify(
        body, sig, consumer_key=CONSUMER_KEY, legacy_secret=None, now=NOW)
    assert ok and mode == "signature"


def test_stale_event_rejected_via_signature():
    body = _body(eventTimestamp=(NOW - timedelta(seconds=600)).isoformat())
    sig = webhook_security.compute_signature(body, CONSUMER_KEY)
    ok, mode = webhook_security.verify(
        body, sig, consumer_key=CONSUMER_KEY, legacy_secret=None, now=NOW)
    assert not ok and mode == "rejected"


def test_bad_signature_falls_back_to_legacy_secret():
    body = _body(webhookSecret=LEGACY_SECRET)
    ok, mode = webhook_security.verify(
        body, "bm90LXRoZS1zaWc=", consumer_key=CONSUMER_KEY,
        legacy_secret=LEGACY_SECRET, now=NOW)
    assert ok and mode == "legacy-after-signature-mismatch"


def test_no_header_legacy_secret_accepts():
    body = _body(webhookSecret=LEGACY_SECRET)
    ok, mode = webhook_security.verify(
        body, None, consumer_key=CONSUMER_KEY, legacy_secret=LEGACY_SECRET, now=NOW)
    assert ok and mode == "legacy"


def test_wrong_everything_rejected():
    body = _body(webhookSecret="wrong")
    ok, mode = webhook_security.verify(
        body, None, consumer_key=CONSUMER_KEY, legacy_secret=LEGACY_SECRET, now=NOW)
    assert not ok and mode == "rejected"


def test_unconfigured():
    ok, mode = webhook_security.verify(
        _body(), None, consumer_key=None, legacy_secret=None, now=NOW)
    assert not ok and mode == "unconfigured"


# ── router lifecycle handling ────────────────────────────────────────────────

class _Group:
    def __init__(self, **m):
        for k, v in m.items():
            setattr(self, k, v)


@pytest.fixture
def env(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("SNAPTRADE_CLIENT_ID", "cid")
    monkeypatch.setenv("SNAPTRADE_CONSUMER_KEY", CONSUMER_KEY)
    monkeypatch.setenv("SNAPTRADE_WEBHOOK_SECRET", LEGACY_SECRET)
    connections.save_broker_user("u1", "snap-u1", "sek")
    ba = connections.map_snaptrade_account("u1", {
        "id": "S1", "name": "Webull", "number": "1234",
        "institution_name": "Webull",
    })
    c = auth_db.get_connection()
    c.execute("UPDATE j2_broker_accounts SET brokerage_authorization_id='auth-1' "
              "WHERE id=?", (ba["id"],))
    c.commit(); c.close()

    app = FastAPI()
    app.include_router(broker_router.router)
    client = TestClient(app)
    yield {"client": client, "ba_id": ba["id"]}
    snap.reset()


def _post(client, body):
    sig = webhook_security.compute_signature(body, CONSUMER_KEY)
    return client.post("/api/j2/broker/webhook", json=body,
                       headers={"Signature": sig})


def _fresh_body(event, **extra):
    b = {"userId": "u1", "eventType": event,
         "eventTimestamp": datetime.now(timezone.utc).isoformat(),
         "clientId": "cid"}
    b.update(extra)
    return b


def test_connection_broken_marks_accounts_instantly(env, monkeypatch):
    from api.services.journal_two.broker import notifications
    monkeypatch.setattr(notifications, "connection_broken", lambda *a, **k: None)
    r = _post(env["client"], _fresh_body(
        "CONNECTION_BROKEN", brokerageAuthorizationId="auth-1"))
    assert r.status_code == 200
    ba = connections.get_broker_account("u1", env["ba_id"])
    assert ba["status"] == "broken"


def test_connection_fixed_clears_broken_and_schedules_sync(env, monkeypatch):
    connections.set_status("u1", env["ba_id"], "broken", error="x")
    called = []

    async def fake_sync_all(user_id, *, refresh_first=False):
        called.append(user_id)
    monkeypatch.setattr(broker_router, "broker_service_sync_all", fake_sync_all)
    r = _post(env["client"], _fresh_body(
        "CONNECTION_FIXED", brokerageAuthorizationId="auth-1"))
    assert r.status_code == 200 and r.json().get("scheduled")
    ba = connections.get_broker_account("u1", env["ba_id"])
    assert ba["status"] == "active"


def test_connection_deleted_disables_but_keeps_data(env):
    r = _post(env["client"], _fresh_body(
        "CONNECTION_DELETED", brokerageAuthorizationId="auth-1"))
    assert r.status_code == 200
    ba = connections.get_broker_account("u1", env["ba_id"])
    assert ba["status"] == "disabled" and ba["syncEnabled"] is False


def test_account_removed_disables_single_account(env):
    r = _post(env["client"], _fresh_body("ACCOUNT_REMOVED", accountId="S1"))
    assert r.status_code == 200
    ba = connections.get_broker_account("u1", env["ba_id"])
    assert ba["status"] == "disabled" and ba["syncEnabled"] is False


def _seed_balances(j2_account_id: str) -> None:
    c = auth_db.get_connection()
    c.execute(
        """UPDATE j2_accounts
              SET broker_total_equity = 5868.63, broker_cash = -15227.32,
                  broker_buying_power = 9077.15, broker_market_value = 20796.20,
                  broker_balance_synced_at = '2026-07-25T07:40:23Z'
            WHERE id = ?""",
        (j2_account_id,),
    )
    c.commit(); c.close()


def _j2_row(j2_account_id: str):
    c = auth_db.get_connection()
    try:
        return c.execute("SELECT * FROM j2_accounts WHERE id = ?",
                         (j2_account_id,)).fetchone()
    finally:
        c.close()


@pytest.mark.parametrize("event,extra", [
    ("CONNECTION_DELETED", {"brokerageAuthorizationId": "auth-1"}),
    ("USER_DELETED", {}),
    ("ACCOUNT_REMOVED", {"accountId": "S1"}),
])
def test_terminal_lifecycle_events_stop_showing_broker_balances(env, event, extra):
    """A connection removed at SnapTrade (member revoked access at the broker,
    or the account left the connection) is terminal — but the handler only
    disabled the mapping, leaving j2_accounts.balance_source='broker' with the
    last synced balances frozen on the row. Every broker surface then kept
    rendering a stale net-liq that nothing could ever refresh."""
    ba = connections.get_broker_account("u1", env["ba_id"])
    j2_id = ba["j2AccountId"]
    _seed_balances(j2_id)

    r = _post(env["client"], _fresh_body(event, **extra))
    assert r.status_code == 200

    row = _j2_row(j2_id)
    assert row is not None, "webhook must never delete the member's account"
    assert row["balance_source"] == "manual"
    for col in ("broker_total_equity", "broker_cash", "broker_buying_power",
                "broker_market_value", "broker_balance_synced_at"):
        assert row[col] is None, f"{col} must be cleared"


def test_connection_broken_keeps_balances(env):
    """CONNECTION_BROKEN is RECOVERABLE (reconnect fixes it), not terminal —
    it must NOT strip the balances, or a transient auth blip would blank a
    healthy member's account value."""
    ba = connections.get_broker_account("u1", env["ba_id"])
    j2_id = ba["j2AccountId"]
    _seed_balances(j2_id)

    r = _post(env["client"], _fresh_body(
        "CONNECTION_BROKEN", brokerageAuthorizationId="auth-1"))
    assert r.status_code == 200

    row = _j2_row(j2_id)
    assert row["balance_source"] == "broker"
    assert row["broker_total_equity"] == 5868.63


def test_trade_detection_schedules_sync(env, monkeypatch):
    called = []

    async def fake_sync_all(user_id, *, refresh_first=False):
        called.append(user_id)
    monkeypatch.setattr(broker_router, "broker_service_sync_all", fake_sync_all)
    r = _post(env["client"], _fresh_body("TRADE_DETECTION", accountId="S1"))
    assert r.status_code == 200 and r.json().get("scheduled")


def test_bad_signature_and_secret_401(env):
    body = _fresh_body("ACCOUNT_HOLDINGS_UPDATED", webhookSecret="wrong")
    r = env["client"].post("/api/j2/broker/webhook", json=body,
                           headers={"Signature": "bm9wZQ=="})
    assert r.status_code == 401


def test_legacy_secret_only_still_accepted(env):
    body = _fresh_body("ACCOUNT_HOLDINGS_UPDATED", webhookSecret=LEGACY_SECRET)
    r = env["client"].post("/api/j2/broker/webhook", json=body)
    assert r.status_code == 200


# ── webhook queue ────────────────────────────────────────────────────────────

def test_queued_sync_runs_and_retries_once(env, monkeypatch):
    """Events are queued (never dropped); a failing sync retries once."""
    broker_router._reset_webhook_queue_for_tests()
    attempts = []

    async def flaky_sync_all(user_id, *, refresh_first=False):
        attempts.append(user_id)
        if len(attempts) == 1:
            raise RuntimeError("transient")
    monkeypatch.setattr(broker_router, "broker_service_sync_all", flaky_sync_all)

    async def _drain_sleep(_):  # collapse the 30s retry backoff
        return None
    import asyncio as _asyncio
    real_sleep = _asyncio.sleep
    monkeypatch.setattr(broker_router.asyncio, "sleep",
                        lambda s: real_sleep(0))

    r = _post(env["client"], _fresh_body("ACCOUNT_HOLDINGS_UPDATED"))
    assert r.status_code == 200 and r.json().get("scheduled")

    async def _wait():
        q = broker_router._webhook_queue
        for _ in range(200):
            if broker_router._webhook_stats["processed"] >= 1:
                return
            await real_sleep(0.01)
    _run_in_client_loop(env["client"], _wait)
    assert len(attempts) == 2  # first failed, retry succeeded
    assert broker_router._webhook_stats["retried"] == 1
    broker_router._reset_webhook_queue_for_tests()


def _run_in_client_loop(client, coro_fn):
    """TestClient runs the app in its own portal loop; run followup coros
    there via a raw asyncio runner (anyio portal not exposed) — simplest is
    to poll from a fresh loop since queue state is threadsafe enough for
    asserts after processing."""
    import asyncio as _a
    import time as _t
    deadline = _t.monotonic() + 5
    while _t.monotonic() < deadline:
        if broker_router._webhook_stats["processed"] >= 1 \
                or broker_router._webhook_stats["failed"] >= 1:
            return
        _t.sleep(0.02)
