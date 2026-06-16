"""Tests for broker balances + holdings-as-truth position reconciliation."""

from __future__ import annotations

import pytest

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two.broker import balances


@pytest.fixture
def env(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    acct = accounts_service.create_account(
        "u1", {"name": "Broker", "color": "blue", "startingBalance": 1.0}
    )
    return {"ba": {"id": "ba1", "j2AccountId": acct["id"]}, "acct_id": acct["id"]}


def _pos(sym, units, price, avg_cost):
    return {"symbol": {"symbol": sym}, "units": units, "price": price,
            "average_purchase_price": avg_cost}


def _positions(user="u1"):
    conn = auth_db.get_connection()
    try:
        return conn.execute(
            "SELECT symbol, side, shares, entry_price, entry_estimated, stop_price, source "
            "FROM j2_positions WHERE user_id=? ORDER BY symbol", (user,)
        ).fetchall()
    finally:
        conn.close()


# ── balances ─────────────────────────────────────────────────────────────────

def test_market_value_signed():
    # long 10@150 = +1500, short 5@40 = -200 → net 1300
    mv = balances.market_value([_pos("AAPL", 10, 150, 100), _pos("TSLA", -5, 40, 50)])
    assert mv == 1300.0


def test_usd_cash_buying_power_filters_currency():
    raw = [{"currency": {"code": "USD"}, "cash": 5000, "buying_power": 10000},
           {"currency": {"code": "CAD"}, "cash": 999, "buying_power": 999}]
    cash, bp = balances.usd_cash_buying_power(raw)
    assert cash == 5000 and bp == 10000


def test_write_balances_sets_account_fields(env):
    raw_bal = [{"currency": "USD", "cash": 8000, "buying_power": 16000}]
    raw_pos = [_pos("AAPL", 10, 150, 100)]  # mv 1500
    out = balances.write_balances("u1", env["ba"], raw_bal, raw_pos)
    assert out["equity"] == 9500.0 and out["cash"] == 8000 and out["marketValue"] == 1500.0
    acct = accounts_service.get_account("u1", env["acct_id"])
    assert acct["balanceSource"] == "broker"
    assert acct["brokerTotalEquity"] == 9500.0
    assert acct["brokerBuyingPower"] == 16000.0


# ── holdings reconciliation ──────────────────────────────────────────────────

def test_carried_in_position_uses_cost_basis_estimated(env):
    # No FIFO history → entry seeded from avg cost, flagged estimated.
    raw_pos = [_pos("AAPL", 10, 150, 100)]
    res = balances.reconcile_positions("u1", env["ba"], raw_pos, fifo_open_positions=[])
    assert res["upserted"] == 1
    rows = _positions()
    assert len(rows) == 1
    r = rows[0]
    assert r["side"] == "Long" and r["shares"] == 10
    assert r["entry_price"] == 100      # cost basis seed
    assert r["entry_estimated"] == 1
    assert r["stop_price"] == 100       # unknown stop → = entry (R null)
    assert r["source"] == "broker"


def test_fifo_match_uses_real_entry(env):
    raw_pos = [_pos("AAPL", 10, 150, 100)]
    fifo = [{"symbol": "AAPL", "side": "Long", "shares": 10,
             "entryPrice": 98.5, "entryDate": "2026-01-02T00:00:00Z"}]
    balances.reconcile_positions("u1", env["ba"], raw_pos, fifo)
    r = _positions()[0]
    assert r["entry_price"] == 98.5      # real fill, not cost basis
    assert r["entry_estimated"] == 0


def test_short_holding_negative_units(env):
    raw_pos = [_pos("TSLA", -5, 40, 50)]
    balances.reconcile_positions("u1", env["ba"], raw_pos, [])
    r = _positions()[0]
    assert r["side"] == "Short" and r["shares"] == 5


def test_resync_updates_shares_preserves_enrichment(env):
    # First sync: carried-in 10 shares.
    balances.reconcile_positions("u1", env["ba"], [_pos("AAPL", 10, 150, 100)], [])
    # User enriches: set a stop + setup.
    conn = auth_db.get_connection()
    conn.execute("UPDATE j2_positions SET stop_price=90, setup='VCP' WHERE user_id='u1'")
    conn.commit(); conn.close()
    # Second sync: now 15 shares.
    balances.reconcile_positions("u1", env["ba"], [_pos("AAPL", 15, 150, 100)], [])
    conn = auth_db.get_connection()
    r = conn.execute("SELECT shares, stop_price, setup FROM j2_positions WHERE user_id='u1'").fetchone()
    conn.close()
    assert r["shares"] == 15            # broker fact updated
    assert r["stop_price"] == 90        # user enrichment preserved
    assert r["setup"] == "VCP"


def test_closed_holding_removed(env):
    balances.reconcile_positions("u1", env["ba"], [_pos("AAPL", 10, 150, 100)], [])
    assert len(_positions()) == 1
    # AAPL no longer held → removed.
    res = balances.reconcile_positions("u1", env["ba"], [], [])
    assert res["closed"] == 1
    assert _positions() == []


def test_share_discrepancy_flagged(env):
    raw_pos = [_pos("AAPL", 10, 150, 100)]
    fifo = [{"symbol": "AAPL", "side": "Long", "shares": 7,  # broker says 10, FIFO says 7
             "entryPrice": 98.5, "entryDate": "2026-01-02T00:00:00Z"}]
    res = balances.reconcile_positions("u1", env["ba"], raw_pos, fifo)
    assert len(res["discrepancies"]) == 1
    # Broker wins: stored shares = 10.
    assert _positions()[0]["shares"] == 10
