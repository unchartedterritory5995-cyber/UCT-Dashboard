"""Multi-currency equity (USD-only) + split/divergence handling in holdings
reconciliation."""

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
    conn = auth_db.get_connection(); ensure_schema(conn); conn.close()
    acct = accounts_service.create_account("u1", {"name": "B", "color": "blue", "startingBalance": 1.0})
    return {"ba": {"id": "ba1", "j2AccountId": acct["id"]}, "acct_id": acct["id"]}


def _pos(sym, units, price, avg_cost, currency="USD"):
    return {"symbol": {"symbol": sym}, "units": units, "price": price,
            "average_purchase_price": avg_cost, "currency": currency}


def test_market_value_excludes_non_usd():
    pos = [_pos("AAPL", 10, 150, 100, "USD"), _pos("SHOP.TO", 10, 100, 90, "CAD")]
    # Only the USD position counts: 10*150 = 1500 (CAD 1000 excluded).
    assert balances.market_value(pos) == 1500.0
    assert balances.has_non_usd_positions(pos) is True


def test_market_value_currencyless_counts_as_usd():
    pos = [{"symbol": {"symbol": "AAPL"}, "units": 10, "price": 150}]
    assert balances.market_value(pos) == 1500.0


def test_split_divergence_falls_back_to_cost_basis_estimated(env):
    # Broker reports 40 shares (post 4:1 split); FIFO has 10 (pre-split) →
    # diverge → must NOT freeze FIFO basis; seed from broker avg cost, estimated.
    raw_pos = [_pos("AAPL", 40, 25, 25)]
    fifo = [{"symbol": "AAPL", "side": "Long", "shares": 10,
             "entryPrice": 100.0, "entryDate": "2026-01-02T00:00:00Z"}]
    res = balances.reconcile_positions("u1", env["ba"], raw_pos, fifo)
    assert len(res["discrepancies"]) == 1
    conn = auth_db.get_connection()
    r = conn.execute("SELECT shares, entry_price, entry_estimated FROM j2_positions WHERE user_id='u1'").fetchone()
    conn.close()
    assert r["shares"] == 40                 # broker wins
    assert r["entry_price"] == 25            # broker cost basis, NOT stale 100
    assert r["entry_estimated"] == 1         # flagged estimated


def test_matching_shares_uses_real_fifo_entry(env):
    raw_pos = [_pos("AAPL", 10, 150, 140)]
    fifo = [{"symbol": "AAPL", "side": "Long", "shares": 10,
             "entryPrice": 98.5, "entryDate": "2026-01-02T00:00:00Z"}]
    balances.reconcile_positions("u1", env["ba"], raw_pos, fifo)
    conn = auth_db.get_connection()
    r = conn.execute("SELECT entry_price, entry_estimated FROM j2_positions WHERE user_id='u1'").fetchone()
    conn.close()
    assert r["entry_price"] == 98.5 and r["entry_estimated"] == 0
