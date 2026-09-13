"""Tests for the signed-lot FIFO mode (allow_shorts=True), used by broker
sync. Long-only behavior is covered by test_csv_import.py; here we focus on
shorts, covers, flips, and leftover open positions."""

from __future__ import annotations

import pytest

from api.services.journal_two.fifo import Fill, reconstruct_trades
from api.services.journal_two import calculations as calc


def _f(row, action, shares, price, date, symbol="NVDA"):
    return Fill(row=row, symbol=symbol, action=action, shares=shares, price=price, date=date)


def _run(fills):
    return reconstruct_trades(fills, allow_shorts=True)


D1, D2, D3, D4 = (f"2026-04-0{i}T00:00:00Z" for i in (1, 2, 3, 4))


def test_long_round_trip_still_works():
    out = _run([_f(2, "Buy", 100, 10, D1), _f(3, "Sell", 100, 12, D2)])
    assert out["errors"] == []
    t = out["trades"][0]
    assert t["side"] == "Long" and t["entryPrice"] == 10 and t["exitPrice"] == 12
    assert out["open_positions"] == []


def test_short_round_trip():
    # Sell-to-open 100 @ 50, buy-to-cover 100 @ 40 → profitable short.
    out = _run([_f(2, "Sell", 100, 50, D1), _f(3, "Buy", 100, 40, D2)])
    assert out["errors"] == []
    assert len(out["trades"]) == 1
    t = out["trades"][0]
    assert t["side"] == "Short"
    assert t["entryPrice"] == 50   # sell-to-open
    assert t["exitPrice"] == 40    # buy-to-cover
    assert t["entryDate"] == D1 and t["exitDate"] == D2
    assert out["open_positions"] == []

    # P&L through the real derived calc: short profits when cover < entry.
    d = calc.compute_trade_derived(
        side="Short", shares=100, entry_price=50, entry_date=D1,
        exit_price=40, exit_date=D2, original_stop=55,
        breakeven_range={"enabled": False, "unit": "$", "value": 0},
    )
    assert d["pnl_dollar"] == pytest.approx(1000.0)  # (50-40)*100
    assert d["result"] == "Win"


def test_scale_into_short_then_cover_vwap():
    # Sell 100@50, sell 50@56 → avg 52; cover 150@40.
    out = _run([_f(2, "Sell", 100, 50, D1), _f(3, "Sell", 50, 56, D2), _f(4, "Buy", 150, 40, D3)])
    assert out["errors"] == []
    t = out["trades"][0]
    assert t["side"] == "Short"
    assert t["shares"] == 150
    assert t["entryPrice"] == pytest.approx((100 * 50 + 50 * 56) / 150, abs=0.01)
    assert t["entryDate"] == D1


def test_partial_cover_leaves_open_short():
    out = _run([_f(2, "Sell", 100, 50, D1), _f(3, "Buy", 40, 45, D2)])
    assert len(out["trades"]) == 1
    assert out["trades"][0]["shares"] == 40 and out["trades"][0]["side"] == "Short"
    assert len(out["open_positions"]) == 1
    op = out["open_positions"][0]
    assert op["side"] == "Short" and op["shares"] == 60 and op["entryPrice"] == 50


def test_flip_long_to_short():
    # Long 100 @ 10, then Sell 150 @ 20 → close 100 long, open 50 short @ 20.
    out = _run([_f(2, "Buy", 100, 10, D1), _f(3, "Sell", 150, 20, D2)])
    assert out["errors"] == []   # NOT an oversell error in shorts mode
    assert len(out["trades"]) == 1
    t = out["trades"][0]
    assert t["side"] == "Long" and t["shares"] == 100 and t["exitPrice"] == 20
    assert len(out["open_positions"]) == 1
    op = out["open_positions"][0]
    assert op["side"] == "Short" and op["shares"] == 50 and op["entryPrice"] == 20
    assert op["entryDate"] == D2


def test_flip_short_to_long():
    # Short 100 @ 50, then Buy 150 @ 40 → cover 100 short, open 50 long @ 40.
    out = _run([_f(2, "Sell", 100, 50, D1), _f(3, "Buy", 150, 40, D2)])
    assert len(out["trades"]) == 1
    t = out["trades"][0]
    assert t["side"] == "Short" and t["shares"] == 100 and t["exitPrice"] == 40
    op = out["open_positions"][0]
    assert op["side"] == "Long" and op["shares"] == 50 and op["entryPrice"] == 40


def test_open_long_no_trade():
    out = _run([_f(2, "Buy", 100, 10, D1)])
    assert out["trades"] == []
    assert out["open_positions"] == [{"symbol": "NVDA", "side": "Long", "shares": 100,
                                      "entryPrice": 10, "entryDate": D1}]


def test_open_short_no_trade():
    out = _run([_f(2, "Sell", 100, 50, D1)])
    assert out["trades"] == []
    assert out["open_positions"][0]["side"] == "Short"


def test_multi_symbol_independent_sides():
    out = _run([
        _f(2, "Buy", 10, 100, D1, symbol="AAPL"),
        _f(3, "Sell", 5, 60, D1, symbol="TSLA"),     # short TSLA
        _f(4, "Sell", 10, 110, D2, symbol="AAPL"),   # close AAPL long
        _f(5, "Buy", 5, 55, D2, symbol="TSLA"),      # cover TSLA short
    ])
    by_sym = {t["symbol"]: t for t in out["trades"]}
    assert by_sym["AAPL"]["side"] == "Long"
    assert by_sym["TSLA"]["side"] == "Short"
    assert out["open_positions"] == []


def test_scale_out_short_multiple_trades():
    # Short 100@50; cover 40@45; cover 60@40 → two short trades.
    out = _run([_f(2, "Sell", 100, 50, D1), _f(3, "Buy", 40, 45, D2), _f(4, "Buy", 60, 40, D3)])
    assert len(out["trades"]) == 2
    assert all(t["side"] == "Short" for t in out["trades"])
    assert out["trades"][0]["shares"] == 40
    assert out["trades"][1]["shares"] == 60
    assert out["open_positions"] == []
