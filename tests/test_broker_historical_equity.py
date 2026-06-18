"""Tests for the accurate daily portfolio-value reconstruction engine.

The pure core is API-free: price lookups are injected, so these tests never hit
the network and pin the accounting deterministically.
"""

from __future__ import annotations

from api.services.journal_two.broker import historical_equity as he
from api.services.journal_two.broker.snaptrade_adapter import Fill


# ── OCC symbol ───────────────────────────────────────────────────────────────

def test_occ_symbol():
    assert he.occ_symbol("AAPL", "2026-01-16", "call", 200.0) == "O:AAPL260116C00200000"
    assert he.occ_symbol("SPY", "2025-12-19", "put", 600.5) == "O:SPY251219P00600500"


# ── replay_timeline ──────────────────────────────────────────────────────────

def test_replay_accumulates_stock_option_cash_and_handles_split_and_close():
    events = [
        {"kind": "cash", "date": "2026-01-01", "amount": 10000.0},
        {"kind": "stock", "date": "2026-01-02", "ticker": "AAPL", "shares_delta": 100, "cash_delta": -1000.0},
        {"kind": "option", "date": "2026-01-03", "occ": "O:AAPL260116C00200000", "contracts_delta": 2, "cash_delta": -300.0},
        {"kind": "split", "date": "2026-01-04", "ticker": "AAPL", "factor": 2},
        {"kind": "stock", "date": "2026-01-05", "ticker": "AAPL", "shares_delta": -50, "cash_delta": 600.0},
        {"kind": "option_close", "date": "2026-01-06", "occ": "O:AAPL260116C00200000"},
    ]
    tl = he.replay_timeline(events)
    assert [r["date"] for r in tl] == ["2026-01-01", "2026-01-02", "2026-01-03",
                                       "2026-01-04", "2026-01-05", "2026-01-06"]
    assert tl[0]["cash"] == 10000.0
    assert tl[1]["stocks"]["AAPL"] == 100 and tl[1]["cash"] == 9000.0
    assert tl[2]["options"]["O:AAPL260116C00200000"] == 2 and tl[2]["cash"] == 8700.0
    assert tl[3]["stocks"]["AAPL"] == 200
    assert tl[4]["stocks"]["AAPL"] == 150 and tl[4]["cash"] == 9300.0
    assert tl[5]["options"].get("O:AAPL260116C00200000", 0) == 0


# ── value_timeline ───────────────────────────────────────────────────────────

def test_value_timeline_marks_holdings_to_market():
    timeline = [{"date": "2026-01-01", "stocks": {"AAPL": 100}, "options": {}, "cash": 0.0}]
    dates = ["2026-01-01", "2026-01-02", "2026-01-03"]
    prices = {("stock", "AAPL", "2026-01-01"): 10.0,
              ("stock", "AAPL", "2026-01-02"): 11.0,
              ("stock", "AAPL", "2026-01-03"): 12.0}
    pf = lambda kind, sym, d: prices.get((kind, sym, d))
    out = he.value_timeline(timeline, dates, pf)
    assert [round(r["equity"]) for r in out] == [1000, 1100, 1200]
    assert all(r["estimated"] is False and r["partial"] is False for r in out)


def test_value_timeline_options_x100_carry_forward_and_partial():
    timeline = [{"date": "2026-01-01", "stocks": {}, "options": {"O:X": 2}, "cash": 500.0}]
    prices = {("option", "O:X", "2026-01-01"): 1.50}
    pf = lambda kind, sym, d: prices.get((kind, sym, d))
    out = he.value_timeline(timeline, ["2026-01-01", "2026-01-02"], pf)
    assert round(out[0]["equity"]) == 800            # 500 + 2×1.50×100
    assert round(out[1]["equity"]) == 800            # carried forward

    tl2 = [{"date": "2026-01-01", "stocks": {"ZZZ": 5}, "options": {}, "cash": 0.0}]
    out2 = he.value_timeline(tl2, ["2026-01-01"], lambda *a: None)
    assert out2[0]["partial"] is True and out2[0]["equity"] == 0.0
