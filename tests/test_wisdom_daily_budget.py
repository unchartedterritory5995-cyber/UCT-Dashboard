"""R53 — the per-night extract budget is a VALUE, and an unusable one refuses.

⛔⛔ WHY A VALUE NEEDS DIFFERENT HANDLING FROM A SWITCH. Every `WISDOM_*_ENABLED` in this
programme defaults OFF, because an unset gate must mean "not released". A QUANTITY cannot work
that way: unset meaning "spend nothing" is an invisible outage, and unset meaning "spend anything"
is an invisible bill. So it defaults to the ruled number — and a value that is PRESENT but
nonsensical is refused rather than defaulted, because `WISDOM_EXTRACT_DAILY_BUDGET_USD=25O`
(letter O) quietly becoming 25.0 is how somebody ships a night they did not authorise.

⛔ Three ceilings exist and this is only one of them; the tests below pin that they stay distinct.
"""
from __future__ import annotations

import pathlib
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))


@pytest.fixture()
def budget(monkeypatch):
    from api.services.wisdom.extract import budget as mod

    monkeypatch.delenv(mod.DAILY_BUDGET_ENV, raising=False)
    return mod


def test_the_ruled_default_is_25(budget):
    assert budget.DEFAULT_DAILY_BUDGET_USD == 25.0
    assert budget.daily_budget_usd() == 25.0


def test_a_set_value_wins(budget, monkeypatch):
    monkeypatch.setenv(budget.DAILY_BUDGET_ENV, "40")
    assert budget.daily_budget_usd() == 40.0


def test_a_blank_value_is_the_default_not_a_refusal(budget, monkeypatch):
    """An operator clearing the variable means "use the ruled number", which is well-defined."""
    monkeypatch.setenv(budget.DAILY_BUDGET_ENV, "   ")
    assert budget.daily_budget_usd() == 25.0


def test_a_non_numeric_value_REFUSES_and_never_falls_back(budget, monkeypatch):
    """⛔⛔ THE LOAD-BEARING ONE."""
    monkeypatch.setenv(budget.DAILY_BUDGET_ENV, "25O")  # letter O
    with pytest.raises(budget.DailyBudgetUnusable) as exc:
        budget.daily_budget_usd()
    assert budget.DAILY_BUDGET_ENV in str(exc.value)
    assert "25.0" in str(exc.value), "the refusal should say what it declined to fall back to"


def test_zero_and_negative_REFUSE_and_the_message_names_the_right_lever(budget, monkeypatch):
    for bad in ("0", "-5"):
        monkeypatch.setenv(budget.DAILY_BUDGET_ENV, bad)
        with pytest.raises(budget.DailyBudgetUnusable) as exc:
            budget.daily_budget_usd()
        assert "WISDOM_EXTRACT_ENABLED" in str(exc.value), (
            "zero is not a pause button; the refusal must point at the switch that is")


def test_the_three_ceilings_stay_distinct(budget, monkeypatch):
    """⛔ This is NOT the programme total and NOT the PC-side ledger cap."""
    monkeypatch.setenv(budget.DAILY_BUDGET_ENV, "25")
    monkeypatch.setenv("WISDOM_EXTRACT_BUDGET_USD", "120")
    assert budget.daily_budget_usd() == 25.0 and budget.budget_cap_usd() == 120.0
    assert budget.DAILY_BUDGET_ENV != "WISDOM_EXTRACT_BUDGET_USD"
    # the programme total keeps its own fall-back-on-garbage behaviour, deliberately different
    monkeypatch.setenv("WISDOM_EXTRACT_BUDGET_USD", "nonsense")
    assert budget.budget_cap_usd() == budget.DEFAULT_BUDGET_USD


def test_it_is_read_from_exactly_one_place():
    """⛔ A second reader is a second authority over one number."""
    import ast

    hits = []
    for path in (REPO / "api" / "services" / "wisdom").rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and node.value == "WISDOM_EXTRACT_DAILY_BUDGET_USD":
                hits.append(f"{path.relative_to(REPO).as_posix()}:{node.lineno}")
    assert len(hits) == 1, f"the env name is read in more than one place: {hits}"
    assert hits[0].startswith("api/services/wisdom/extract/budget.py")


def test_the_default_matches_the_ruled_arithmetic():
    """⭐ 399 requests at the measured p90, rounded up to the next dollar."""
    from api.services.wisdom.extract import budget as mod

    p90_rate, requests_at_n3 = 0.06139, (400 // 3) * 3
    import math

    assert math.ceil(requests_at_n3 * p90_rate) == int(mod.DEFAULT_DAILY_BUDGET_USD)
