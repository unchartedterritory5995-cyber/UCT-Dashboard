"""Fees must thread from broker activities through FIFO into reconstructed
trade P&L (previously dropped → net P&L = gross). Covers long, prorated
partial close, and short."""

from __future__ import annotations

import pytest

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two.fifo import Fill, reconstruct_trades
from api.services.journal_two.broker import snaptrade_adapter as ad, reconstruct


def _f(row, action, shares, price, date, fee):
    return Fill(row=row, symbol="AAPL", action=action, shares=shares, price=price, date=date, fee=fee)


D1, D2, D3 = "2026-04-01T00:00:00Z", "2026-04-02T00:00:00Z", "2026-04-03T00:00:00Z"


def test_long_round_trip_fees_summed():
    out = reconstruct_trades([_f(2, "Buy", 100, 10, D1, 5.0), _f(3, "Sell", 100, 12, D2, 7.0)],
                             allow_shorts=True)
    assert out["trades"][0]["fees"] == 12.0   # 5 entry + 7 exit


def test_partial_close_prorates_entry_fee():
    # Buy 100 fee 10 → 0.1/share; sell 50 fee 4 → entry portion 50*0.1=5, +4 = 9
    out = reconstruct_trades([_f(2, "Buy", 100, 10, D1, 10.0), _f(3, "Sell", 50, 12, D2, 4.0)],
                             allow_shorts=True)
    assert out["trades"][0]["fees"] == 9.0


def test_short_round_trip_fees():
    out = reconstruct_trades([_f(2, "Sell", 100, 50, D1, 6.0), _f(3, "Buy", 100, 40, D2, 8.0)],
                             allow_shorts=True)
    t = out["trades"][0]
    assert t["side"] == "Short" and t["fees"] == 14.0


def test_adapter_extracts_fee():
    act = {"id": "x", "type": "BUY", "units": 10, "price": 100, "fee": 1.25,
           "symbol": {"symbol": "AAPL"}, "trade_date": "2026-04-01"}
    f = ad.to_equity_fill(act, 1)
    assert f.fee == 1.25


def test_fees_persist_to_db_trade():
    # End-to-end: a broker activity pair → j2_trades row with non-zero fees.
    import sqlite3
    import importlib
    # in-memory-style temp DB
    import tempfile, os
    d = tempfile.mkdtemp()
    dbfile = os.path.join(d, "auth.db")
    orig = auth_db._DB_PATH
    auth_db._DB_PATH = dbfile
    try:
        conn = auth_db.get_connection(); ensure_schema(conn); conn.close()
        acct = accounts_service.create_account("u1", {"name": "B", "color": "blue", "startingBalance": 1.0})
        settings = accounts_service.get_account_settings("u1", acct["id"])
        acts = [
            {"id": "a1", "type": "BUY", "units": 10, "price": 100, "fee": 5,
             "symbol": {"symbol": "AAPL"}, "trade_date": "2026-04-01", "currency": "USD"},
            {"id": "a2", "type": "SELL", "units": 10, "price": 110, "fee": 7,
             "symbol": {"symbol": "AAPL"}, "trade_date": "2026-04-02", "currency": "USD"},
        ]
        reconstruct.reconstruct_account("u1", "ba1", acct["id"], acts, settings)
        conn = auth_db.get_connection()
        row = conn.execute("SELECT fees, pnl_dollar FROM j2_trades WHERE user_id='u1'").fetchone()
        conn.close()
        assert row["fees"] == 12.0
    finally:
        auth_db._DB_PATH = orig
