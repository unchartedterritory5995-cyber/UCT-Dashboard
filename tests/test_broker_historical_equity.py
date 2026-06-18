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
