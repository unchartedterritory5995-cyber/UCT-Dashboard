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
