"""⭐ L4 wiring: a Screener term the member writes on a chart is given its house chart formula.

Measured 2026-11-15: asked for "ADR %", the dock built a 20-bar average where the Screener's ADR %
is 21. With the twin registry the assistant is handed the Screener's own formula as data.
"""
from __future__ import annotations

from api.services import chart_twins
from api.services import definition_concierge as dc
from api.services import definition_conversation as conv


def test_the_door_reads_the_one_registry():
    assert conv.CHART_TWINS is chart_twins.TWINS
    assert "rsi14" in conv.CHART_TWINS and "adr_pct" in conv.CHART_TWINS


def test_a_term_with_a_twin_carries_the_house_formula_and_one_without_does_not():
    notes = conv._language_notes({"terms": [
        {"matched_as": "ADR %", "name": "adr_pct"},
        {"matched_as": "market cap", "name": "market_cap"},
    ]})
    adr, cap = notes["matched_terms"]
    assert adr["chart_formula"] == dc.formula_for(chart_twins.TWINS["adr_pct"])
    assert "21" in adr["chart_formula"] and "high" in adr["chart_formula"]
    assert "use this formula" in adr["rule"]
    assert cap == {"wrote": "market cap", "entry": "market_cap"}        # unchanged: no chart form


def test_a_firm_concept_still_takes_its_chart_form_from_the_same_registry():
    """`overbought` reads the nightly rsi14; its chart form comes from the twin, as before."""
    notes = conv._language_notes({"concepts": [{"word": "overbought"}]})
    (c,) = [c for c in notes["firm_concepts"] if c["word"] == "overbought"]
    assert c["chart_formula"] == "(rsi(close, 14) >= 70)"
