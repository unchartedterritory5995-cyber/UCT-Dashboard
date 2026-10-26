"""Ruling W9-R46, armed at the be->impl merge: the routine vs-P&L panel's copy and rounding contract.

The client copies two sentences (`VsPnlPanel.CAVEAT`, `RoutineBlock.SUGGESTED`) and re-renders the win-rate percent
(`VsPnlPanel.winRateLine`). The shared vectors file's `routine_vs_pnl` section is the contract: this rail binds it to
`routine_insights` (the owner), and `VsPnlPanel.contract.test.jsx` binds the client to the same section.
"""
from __future__ import annotations

import json
from pathlib import Path

from api.services.journal_two import routine_insights as ri

VECTORS = Path(__file__).resolve().parent / "fixtures" / "widgetFormulaVectors.json"
SECTION = json.loads(VECTORS.read_text(encoding="utf-8"))["routine_vs_pnl"]


def test_the_copied_sentences_are_the_owners():
    assert SECTION["CAVEAT"] == ri.CAVEAT
    assert SECTION["SUGGEST_LINE"] == ri.SUGGEST_LINE


def test_the_win_rate_rounding_table_is_the_owners_rounding():
    rows = SECTION["win_rate_rounding"]
    assert len(rows) >= 10
    for value, shown in rows:
        assert ri._pct(value) == shown, value


def test_the_table_carries_the_cases_a_naive_rounding_gets_wrong():
    """Non-vacuity: Python's own round() (banker's) disagrees with the owner on some rows, so a table that a
    wrong rounding would also pass cannot be what this file holds."""
    rows = SECTION["win_rate_rounding"]
    assert any(f"{round(v * 100)}%" != shown for v, shown in rows)
    assert any(abs(v * 100 - int(v * 100) - 0.5) < 1e-6 for v, _ in rows)      # an exact half is in it
