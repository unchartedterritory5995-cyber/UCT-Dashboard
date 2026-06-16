"""Tests for single-leg option strategy reconstruction from broker option
events: round-trips, expiration, assignment, open positions, idempotency,
and P&L correctness (long + short)."""

from __future__ import annotations

import pytest

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two.broker import option_reconstruct as oro


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
    return {"j2": acct["id"]}


def _ev(kind, side, oc, contracts, price, date, *, cp="call", strike=200,
        underlying="AAPL", exp="2026-06-19", fee=0.0, aid="x"):
    return {
        "externalId": aid, "row": 1, "eventKind": kind, "side": side, "openClose": oc,
        "underlying": underlying, "strike": strike, "expiration": exp,
        "contractType": cp, "contracts": contracts, "price": price, "fee": fee,
        "date": date, "currency": "USD",
    }


def _strategies(user="u1"):
    conn = auth_db.get_connection()
    try:
        return conn.execute(
            "SELECT strategy_type, direction, status, net_entry, net_exit, "
            "pnl_dollar, result, source, external_id FROM j2_option_strategies "
            "WHERE user_id=? ORDER BY created_at", (user,)
        ).fetchall()
    finally:
        conn.close()


def _legs_count(user="u1"):
    conn = auth_db.get_connection()
    try:
        return conn.execute(
            "SELECT COUNT(*) AS n FROM j2_option_legs l "
            "JOIN j2_option_strategies s ON s.id = l.strategy_id WHERE s.user_id=?",
            (user,),
        ).fetchone()["n"]
    finally:
        conn.close()


def test_long_call_round_trip_profit(env):
    evs = [
        _ev("option_trade", "buy", "open", 2, 3.0, "2026-04-01"),
        _ev("option_trade", "sell", "close", 2, 5.0, "2026-04-10"),
    ]
    out = oro.reconstruct_options("u1", "ba1", env["j2"], evs)
    assert out["imported"] == 1
    s = _strategies()[0]
    assert s["strategy_type"] == "long_call" and s["direction"] == "bullish"
    assert s["status"] == "closed"
    # net_entry = +1*2*3*100 = 600 (debit); net_exit = +1*2*5*100 = 1000
    assert s["net_entry"] == 600.0 and s["net_exit"] == 1000.0
    assert s["pnl_dollar"] == 400.0 and s["result"] == "Win"
    assert _legs_count() == 1


def test_short_put_round_trip(env):
    # Sell-to-open put @2.0, buy-to-close @0.5 → credit kept = profit.
    evs = [
        _ev("option_trade", "sell", "open", 1, 2.0, "2026-04-01", cp="put"),
        _ev("option_trade", "buy", "close", 1, 0.5, "2026-04-05", cp="put"),
    ]
    oro.reconstruct_options("u1", "ba1", env["j2"], evs)
    s = _strategies()[0]
    assert s["strategy_type"] == "short_put" and s["direction"] == "bullish"
    # net_entry = -1*1*2*100 = -200 (credit); net_exit = -1*1*0.5*100 = -50
    assert s["net_entry"] == -200.0 and s["net_exit"] == -50.0
    # pnl = net_exit - net_entry = -50 - (-200) = 150
    assert s["pnl_dollar"] == 150.0 and s["result"] == "Win"


def test_expiration_closes_worthless(env):
    # Long call expires worthless → loss of full premium.
    evs = [
        _ev("option_trade", "buy", "open", 1, 4.0, "2026-04-01"),
        _ev("option_expiration", None, None, 1, None, "2026-06-19"),
    ]
    oro.reconstruct_options("u1", "ba1", env["j2"], evs)
    s = _strategies()[0]
    assert s["status"] == "expired"
    assert s["net_exit"] == 0.0
    assert s["pnl_dollar"] == -400.0 and s["result"] == "Loss"


def test_assignment_closes_strategy(env):
    # Short put assigned → option closes 'assigned' at 0; the stock leg would
    # arrive as a separate equity activity (handled elsewhere).
    evs = [
        _ev("option_trade", "sell", "open", 1, 2.0, "2026-04-01", cp="put"),
        _ev("option_assignment", None, None, 1, None, "2026-06-19", cp="put"),
    ]
    oro.reconstruct_options("u1", "ba1", env["j2"], evs)
    s = _strategies()[0]
    assert s["status"] == "assigned"
    # net_entry -200 (credit), net_exit 0 → pnl = 0 - (-200) = 200 (premium kept)
    assert s["pnl_dollar"] == 200.0


def test_open_strategy_when_not_closed(env):
    evs = [_ev("option_trade", "buy", "open", 1, 4.0, "2026-04-01")]
    out = oro.reconstruct_options("u1", "ba1", env["j2"], evs)
    assert out["imported"] == 1
    s = _strategies()[0]
    assert s["status"] == "open" and s["net_exit"] is None


def test_idempotent_rerun(env):
    evs = [
        _ev("option_trade", "buy", "open", 1, 3.0, "2026-04-01"),
        _ev("option_trade", "sell", "close", 1, 5.0, "2026-04-10"),
    ]
    first = oro.reconstruct_options("u1", "ba1", env["j2"], evs)
    second = oro.reconstruct_options("u1", "ba1", env["j2"], evs)
    assert first["imported"] == 1
    assert second["imported"] == 0 and second["skipped"] == 1
    assert len(_strategies()) == 1


def test_partial_close_two_strategies(env):
    # Open 3, close 1, close 2 → two closed strategies.
    evs = [
        _ev("option_trade", "buy", "open", 3, 3.0, "2026-04-01"),
        _ev("option_trade", "sell", "close", 1, 4.0, "2026-04-05"),
        _ev("option_trade", "sell", "close", 2, 6.0, "2026-04-08"),
    ]
    out = oro.reconstruct_options("u1", "ba1", env["j2"], evs)
    assert out["imported"] == 2
    assert all(s["status"] == "closed" for s in _strategies())


def test_inferred_open_close_without_explicit_flags(env):
    # Broker reports plain buy/sell (no open/close) → inferred from position.
    evs = [
        _ev("option_trade", "buy", None, 1, 3.0, "2026-04-01"),
        _ev("option_trade", "sell", None, 1, 5.0, "2026-04-10"),
    ]
    out = oro.reconstruct_options("u1", "ba1", env["j2"], evs)
    assert out["imported"] == 1
    assert _strategies()[0]["status"] == "closed"
