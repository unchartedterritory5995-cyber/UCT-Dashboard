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


# ── Date-only brokers (Schwab): same-day ordering + orphan closes ──────────
# Schwab activities via SnapTrade carry date-only trade_dates, so same-day
# events arrive in arbitrary row order. Explicit open/close labels must win
# over arrival order, and an explicit close with no open position must never
# fabricate a phantom lot.

def test_same_day_close_listed_before_open_still_pairs(env):
    # Day-trade round trip where the close sorts BEFORE the open (row order
    # is arbitrary for date-only activities) → must still produce ONE closed
    # strategy, not a stranded open + phantom short.
    close = _ev("option_trade", "sell", "close", 2, 5.0, "2026-04-01", aid="c")
    close["row"] = 1
    opn = _ev("option_trade", "buy", "open", 2, 3.0, "2026-04-01", aid="o")
    opn["row"] = 2
    out = oro.reconstruct_options("u1", "ba1", env["j2"], [close, opn])
    assert out["imported"] == 1
    rows = _strategies()
    assert len(rows) == 1
    s = rows[0]
    assert s["status"] == "closed" and s["strategy_type"] == "long_call"
    assert s["pnl_dollar"] == 400.0


def test_same_day_short_round_trip_scrambled(env):
    cover = _ev("option_trade", "buy", "close", 1, 0.5, "2026-04-01", cp="put", aid="c")
    cover["row"] = 1
    sto = _ev("option_trade", "sell", "open", 1, 2.0, "2026-04-01", cp="put", aid="o")
    sto["row"] = 2
    out = oro.reconstruct_options("u1", "ba1", env["j2"], [cover, sto])
    assert out["imported"] == 1
    s = _strategies()[0]
    assert s["status"] == "closed" and s["strategy_type"] == "short_put"
    assert s["pnl_dollar"] == 150.0


def test_orphan_explicit_close_creates_no_phantom(env):
    # The opening trade predates the broker's history window (Schwab caps at
    # ~4 years) → the lone close must be skipped, not become a phantom short
    # position that later gets marked expired at $0.
    evs = [_ev("option_trade", "sell", "close", 3, 4.0, "2026-04-01")]
    out = oro.reconstruct_options("u1", "ba1", env["j2"], evs)
    assert out["imported"] == 0
    assert out["orphanCloses"] == 1
    assert _strategies() == []


def test_same_day_round_trip_with_expiration_event(env):
    # Contract traded and fully closed on expiration day; broker also emits a
    # lifecycle event that day. Lifecycle must settle LAST → closed at the
    # real exit price, nothing expired.
    expi = _ev("option_expiration", None, None, 1, None, "2026-06-19", aid="e")
    expi["row"] = 1
    close = _ev("option_trade", "sell", "close", 1, 5.0, "2026-06-19", aid="c")
    close["row"] = 2
    opn = _ev("option_trade", "buy", "open", 1, 3.0, "2026-06-19", aid="o")
    opn["row"] = 3
    out = oro.reconstruct_options("u1", "ba1", env["j2"], [expi, close, opn])
    assert out["imported"] == 1
    s = _strategies()[0]
    assert s["status"] == "closed"
    assert s["net_exit"] == 500.0 and s["pnl_dollar"] == 200.0


def test_closed_strategies_carry_the_trading_day_spine(env):
    """2026-08-27 books-audit finding: broker strategies never stamped
    trading_day_et, so calendar surfaces tz-converted Schwab's midnight-UTC
    closed_at stamps and put option P&L one day early ($6,800 of the whale's
    losses on the wrong day vs their statements). Date-only stamps keep
    their date; real timestamps convert to ET — same rule as trades."""
    events = [
        # Schwab shape: midnight-UTC date-only stamps.
        _ev("option_trade", "buy", "open", 1, 5.0, "2026-08-26T00:00:00Z", aid="b1"),
        _ev("option_trade", "sell", "close", 1, 6.0, "2026-08-27T00:00:00Z", aid="s1"),
        # Real-timestamp shape: 00:30 UTC genuinely IS the prior ET day.
        _ev("option_trade", "buy", "open", 1, 3.0, "2026-08-20T14:00:00Z",
            strike=250, aid="b2"),
        _ev("option_trade", "sell", "close", 1, 4.0, "2026-08-27T00:30:00Z",
            strike=250, aid="s2"),
    ]
    oro.reconstruct_options("u1", "ba1", env["j2"], events)
    conn = auth_db.get_connection()
    try:
        rows = {r["external_id"]: dict(r) for r in conn.execute(
            "SELECT external_id, closed_at, trading_day_et "
            "FROM j2_option_strategies WHERE user_id='u1' AND status='closed'")}
    finally:
        conn.close()
    by_close = {r["closed_at"]: r["trading_day_et"] for r in rows.values()}
    assert by_close["2026-08-27T00:00:00Z"] == "2026-08-27"   # date-only: keep the date
    assert by_close["2026-08-27T00:30:00Z"] == "2026-08-26"   # real ts: ET day
