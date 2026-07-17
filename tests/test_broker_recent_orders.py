"""Recent Orders poll → provisional intraday fills → journal, and their
lifecycle: excluded from the ledger heal, pruned when the real transaction
lands (or after the age cap). SnapTrade transactions are never intraday —
this rail is what makes same-day fills appear in the journal."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.broker import (
    activities_store, connections, recent_orders, snaptrade_client as snap, sync,
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


NOW = datetime.now(timezone.utc)


def _order(**over):
    o = {
        "brokerage_order_id": "ord-1",
        "status": "EXECUTED",
        "action": "BUY",
        "universal_symbol": {"raw_symbol": "NVDA"},
        "filled_quantity": 100,
        "execution_price": 500.0,
        "time_executed": NOW.isoformat(),
    }
    o.update(over)
    return o


# ── order → provisional activity conversion (pure) ───────────────────────────

def test_executed_equity_order_converts():
    act = recent_orders.order_to_provisional_activity(_order())
    assert act is not None
    assert act["id"].startswith("intraday:")
    assert act["type"] == "BUY" and act["units"] == 100 and act["price"] == 500.0
    assert act["symbol"]["symbol"] == "NVDA"


def test_non_executed_and_option_orders_skipped():
    assert recent_orders.order_to_provisional_activity(
        _order(status="PENDING")) is None
    assert recent_orders.order_to_provisional_activity(
        _order(option_symbol={"ticker": "NVDA 250117C00500000"})) is None
    assert recent_orders.order_to_provisional_activity(
        _order(filled_quantity=0)) is None


def test_sell_short_maps_to_sell():
    act = recent_orders.order_to_provisional_activity(_order(action="SELL_SHORT"))
    assert act is not None and act["type"] == "SELL"


def test_fingerprint_stable_across_polls():
    a1 = recent_orders.order_to_provisional_activity(_order())
    a2 = recent_orders.order_to_provisional_activity(_order())
    assert a1["id"] == a2["id"]


# ── market window ────────────────────────────────────────────────────────────

def test_market_window():
    from zoneinfo import ZoneInfo
    tz = ZoneInfo("America/New_York")
    assert recent_orders._in_market_window(datetime(2026, 7, 17, 10, 0, tzinfo=tz))
    assert recent_orders._in_market_window(datetime(2026, 7, 17, 9, 27, tzinfo=tz))
    assert not recent_orders._in_market_window(datetime(2026, 7, 17, 8, 0, tzinfo=tz))
    assert not recent_orders._in_market_window(datetime(2026, 7, 17, 17, 0, tzinfo=tz))
    assert not recent_orders._in_market_window(datetime(2026, 7, 18, 10, 0, tzinfo=tz))  # Sat


# ── end-to-end with DB ───────────────────────────────────────────────────────

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
    connections.save_broker_user("u1", "snap-u1", "sek")
    ba = connections.map_snaptrade_account("u1", {
        "id": "S1", "name": "Webull", "number": "1234",
        "institution_name": "Webull",
    })
    yield {"ba": connections.get_broker_account("u1", ba["id"])}
    snap.reset()


@pytest.mark.asyncio
async def test_poll_account_injects_fill_and_builds_trade(env, monkeypatch):
    snap.configure(_Group(account_information=_Group(
        get_user_account_recent_orders=lambda **kw: _Resp(
            {"orders": [_order(), _order(
                brokerage_order_id="ord-2", action="SELL", execution_price=510.0,
                time_executed=(NOW + timedelta(minutes=30)).isoformat())]}),
    )))
    out = await recent_orders.poll_account("u1", env["ba"])
    assert out["new"] == 2
    # Both fills are in the ledger…
    acts = activities_store.get_activities("u1", env["ba"]["id"])
    assert len(acts) == 2 and all(a["id"].startswith("intraday:") for a in acts)
    # …and the FIFO built a closed trade from them (buy 100 @500, sell @510).
    conn = auth_db.get_connection()
    row = conn.execute(
        "SELECT symbol, entry_price, exit_price FROM j2_trades WHERE user_id='u1'"
    ).fetchone()
    conn.close()
    assert row and row["symbol"] == "NVDA"
    assert row["entry_price"] == 500.0 and row["exit_price"] == 510.0


@pytest.mark.asyncio
async def test_repeat_poll_is_idempotent(env):
    snap.configure(_Group(account_information=_Group(
        get_user_account_recent_orders=lambda **kw: _Resp({"orders": [_order()]}),
    )))
    out1 = await recent_orders.poll_account("u1", env["ba"])
    out2 = await recent_orders.poll_account("u1", env["ba"])
    assert out1["new"] == 1 and out2["new"] == 0
    assert len(activities_store.get_activities("u1", env["ba"]["id"])) == 1


def test_heal_window_never_deletes_provisional_rows(env):
    ba_id = env["ba"]["id"]
    activities_store.store_activities("u1", ba_id, [
        {"id": "intraday:abc", "type": "BUY", "units": 10, "price": 100,
         "symbol": {"symbol": "TSLA"}, "trade_date": NOW.isoformat()},
        {"id": "real-1", "type": "BUY", "units": 5, "price": 50,
         "symbol": {"symbol": "AAPL"}, "trade_date": NOW.isoformat()},
    ])
    # Broker re-fetch returns ONLY real-1 → the provisional row must survive.
    removed = activities_store.heal_window("u1", ba_id, {"real-1"})
    assert removed == 0
    ids = {a["id"] for a in activities_store.get_activities("u1", ba_id)}
    assert "intraday:abc" in ids


def test_prune_provisional_on_matching_real_activity(env):
    ba_id = env["ba"]["id"]
    day = NOW.isoformat()
    activities_store.store_activities("u1", ba_id, [
        {"id": "intraday:abc", "type": "BUY", "units": 100, "price": 500,
         "symbol": {"symbol": "NVDA"}, "trade_date": day},
    ])
    real = [{"id": "real-9", "type": "BUY", "units": 100, "price": 500,
             "symbol": {"symbol": "NVDA"}, "trade_date": day}]
    activities_store.store_activities("u1", ba_id, real)
    removed = activities_store.prune_provisional("u1", ba_id, real)
    assert removed == 1
    ids = {a["id"] for a in activities_store.get_activities("u1", ba_id)}
    assert ids == {"real-9"}


def test_prune_provisional_age_cap(env):
    ba_id = env["ba"]["id"]
    old = (NOW - timedelta(days=5)).isoformat()
    activities_store.store_activities("u1", ba_id, [
        {"id": "intraday:old", "type": "SELL", "units": 3, "price": 20,
         "symbol": {"symbol": "F"}, "trade_date": old},
    ])
    removed = activities_store.prune_provisional("u1", ba_id, [])
    assert removed == 1


@pytest.mark.asyncio
async def test_sweep_gates(env, monkeypatch):
    # Outside market window → skipped without touching the SDK.
    monkeypatch.setattr(recent_orders, "_in_market_window", lambda *a: False)
    out = await recent_orders.poll_all_accounts()
    assert out.get("skipped") is True
