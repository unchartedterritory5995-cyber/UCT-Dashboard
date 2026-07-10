"""Task 1 — single-trade detail endpoint with best-effort broker provenance.

Covers get_trade_detail (service) + the GET /trades/{trade_id} route ordering.

NOTE ON THE SEED: the brief's sketch INSERT omitted several NOT NULL j2_trades
columns (pnl_dollar/pnl_percent/hold_days/result/context_at_entry) — that would
fail the NOT NULL constraints. _seed_trade below inserts a complete, valid row.

NOTE ON THE SCHEMA: the real j2_broker_activities columns are
id/user_id/broker_account_id/external_id/activity_type/symbol/occurred_at/
raw_json/processed/created_at — NOT the brief's assumed units/price/trade_date.
Units + price live inside raw_json; the window is bounded on occurred_at.
"""

import json
import sqlite3

from api.services.journal_two import db as j2db
from api.services.journal_two.excursions_store import upsert_excursion
from api.services.journal_two.trades import get_trade_detail


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    j2db.ensure_schema(conn)
    return conn


def _seed_trade(
    conn,
    trade_id="t1",
    user_id="u1",
    symbol="NVDA",
    *,
    entry_date="2026-04-01T14:30:00Z",
    exit_date="2026-04-03T18:00:00Z",
    source=None,
    external_id=None,
):
    """Insert a complete (all NOT NULL columns populated) j2_trades row."""
    conn.execute(
        """
        INSERT INTO j2_trades (
            id, user_id, position_id, symbol, side, shares,
            entry_price, entry_date, exit_price, exit_date, original_stop,
            pnl_dollar, pnl_percent, hold_days, result, context_at_entry,
            created_at, source, external_id
        ) VALUES (?, ?, ?, ?, 'Long', 10, 100, ?, 110, ?, 95,
                  100, 0.1, 2, 'Win', '{}', '2026-01-01', ?, ?)
        """,
        (trade_id, user_id, f"p-{trade_id}", symbol, entry_date, exit_date,
         source, external_id),
    )
    conn.commit()


def _seed_activity(
    conn,
    user_id="u1",
    symbol="NVDA",
    *,
    external_id="act-1",
    activity_type="BUY",
    occurred_at="2026-04-01T14:30:00Z",
    units=10,
    price=100.0,
    broker_account_id="ba-1",
):
    """Insert a raw broker-activity row (units/price stored inside raw_json)."""
    conn.execute(
        """
        INSERT INTO j2_broker_activities
            (id, user_id, broker_account_id, external_id, activity_type,
             symbol, occurred_at, raw_json, processed, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
        """,
        (
            f"id-{external_id}", user_id, broker_account_id, external_id,
            activity_type, symbol, occurred_at,
            json.dumps({"units": units, "price": price, "type": activity_type}),
            "2026-04-01T00:00:00Z",
        ),
    )
    conn.commit()


# ── Core contract ────────────────────────────────────────────────────────────

def test_returns_trade_and_ref():
    conn = _conn()
    _seed_trade(conn)
    out = get_trade_detail("u1", "t1", conn=conn)
    assert out["trade"]["symbol"] == "NVDA"
    assert out["tradeRef"] == "id:t1"
    assert out["brokerActivities"] == []
    # excursion is attached (None when not yet computed → FE shows "pending nightly")
    assert out["excursion"] is None


# ── Excursion sub-object (Task 5) ────────────────────────────────────────────

def test_excursion_present_for_computed_trade():
    """When an excursion has been computed + stored for the trade's stable
    tradeRef, get_trade_detail attaches it as the camelCase `excursion` dict."""
    conn = _conn()
    _seed_trade(conn)  # manual trade → tradeRef "id:t1"
    upsert_excursion(
        "u1",
        "id:t1",
        {
            "symbol": "NVDA",
            "mfe_price": 118.0,
            "mae_price": 96.0,
            "mfe_r": 3.6,
            "mae_r": -0.8,
            "mfe_ts": "2026-04-02T15:00:00Z",
            "mae_ts": "2026-04-01T15:00:00Z",
            "exit_efficiency": 0.55,
            "missed_r": 1.6,
            "bar_resolution": "5m",
            "data_quality": "ok",
        },
        conn=conn,
    )
    out = get_trade_detail("u1", "t1", conn=conn)
    exc = out["excursion"]
    assert exc is not None
    assert exc["symbol"] == "NVDA"
    assert exc["mfePrice"] == 118.0
    assert exc["maeR"] == -0.8
    assert exc["exitEfficiency"] == 0.55
    assert exc["barResolution"] == "5m"
    assert exc["dataQuality"] == "ok"
    assert exc["computedAt"]  # stamped by upsert


def test_excursion_none_when_absent():
    """No stored excursion → excursion is None (nightly job / backfill fills it)."""
    conn = _conn()
    _seed_trade(conn)
    out = get_trade_detail("u1", "t1", conn=conn)
    assert out["excursion"] is None


def test_wrong_user_is_none():
    conn = _conn()
    _seed_trade(conn)
    assert get_trade_detail("u2", "t1", conn=conn) is None


def test_missing_trade_is_none():
    conn = _conn()
    assert get_trade_detail("u1", "does-not-exist", conn=conn) is None


# ── Broker provenance (the schema-real extra test) ───────────────────────────

def test_broker_activity_present():
    """A broker trade whose symbol + holding window matches a stored activity
    surfaces that activity as best-effort provenance, and the ref is ext:*."""
    conn = _conn()
    _seed_trade(conn, source="broker", external_id="ext-abc")
    _seed_activity(conn, external_id="act-9", occurred_at="2026-04-02T15:00:00Z")
    out = get_trade_detail("u1", "t1", conn=conn)

    assert out["tradeRef"] == "ext:ext-abc"
    acts = out["brokerActivities"]
    assert len(acts) == 1
    a = acts[0]
    assert a["symbol"] == "NVDA"
    assert a["activityType"] == "BUY"
    assert a["occurredAt"] == "2026-04-02T15:00:00Z"
    # units/price recovered best-effort from raw_json
    assert a["units"] == 10
    assert a["price"] == 100.0
    # labeled best-effort — never a claim of exact fill lineage
    assert a["matchBasis"] == "symbol+window"


def test_manual_trade_gets_no_provenance():
    """Provenance is broker-source trades only — a manual trade whose symbol
    happens to match a broker activity must NOT associate it."""
    conn = _conn()
    _seed_trade(conn)  # source=None → manual
    _seed_activity(conn, occurred_at="2026-04-02T15:00:00Z")
    out = get_trade_detail("u1", "t1", conn=conn)
    assert out["brokerActivities"] == []


def test_activity_outside_window_excluded():
    conn = _conn()
    _seed_trade(conn, source="broker", external_id="ext-abc")
    # Well before entry_date - 1d
    _seed_activity(conn, external_id="old", occurred_at="2026-01-15T15:00:00Z")
    # Well after exit_date + 1d
    _seed_activity(conn, external_id="future", occurred_at="2026-08-01T15:00:00Z")
    out = get_trade_detail("u1", "t1", conn=conn)
    assert out["brokerActivities"] == []


def test_activity_wrong_symbol_excluded():
    conn = _conn()
    _seed_trade(conn, source="broker", external_id="ext-abc")
    _seed_activity(conn, symbol="AAPL", occurred_at="2026-04-02T15:00:00Z")
    out = get_trade_detail("u1", "t1", conn=conn)
    assert out["brokerActivities"] == []


def test_other_users_activity_excluded():
    """Provenance is user-scoped — never leak another user's broker ledger."""
    conn = _conn()
    _seed_trade(conn, source="broker", external_id="ext-abc")
    _seed_activity(conn, user_id="u2", occurred_at="2026-04-02T15:00:00Z")
    out = get_trade_detail("u1", "t1", conn=conn)
    assert out["brokerActivities"] == []


# ── Route ordering regression ────────────────────────────────────────────────

def test_import_preview_route_not_shadowed():
    """Registering GET /trades/{trade_id} must not remove/shadow the static
    /trades/import/preview route (nor the detail route itself)."""
    from api.routers.journal_two import router

    paths = {r.path for r in router.routes}
    assert "/api/j2/trades/import/preview" in paths
    assert "/api/j2/trades/{trade_id}" in paths
