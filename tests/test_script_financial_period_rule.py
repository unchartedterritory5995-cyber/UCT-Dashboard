"""A request.financial PERIOD IS A CONSTANT, AND ONLY ONE THE ENGINE SERVES (rule 16 of the script contract, 2026-11-25).

The assistant half of finding 2 of the Deepvue import probe: an EPS line with a quarterly/annual setting was written
three times as `request.financial(..., period)` with `period` an input, which the engine refuses; and the engine holds
no fiscal-year series. Held here, with no model call: the rule is in the contract once, numbered after rule 15, with no
placeholder left; it says the period is written in the call, teaches one constant read per option chosen by the input,
and says to leave out a period the engine does not serve. That the taught form RUNS is held against the engine itself
(`app/src/components/chart/engine/requestFinancial.periodSetting.test.js`).
"""
import pytest

from api.services import pine_authoring as pa


@pytest.fixture
def open_door(monkeypatch):
    monkeypatch.setenv("PINE_FINANCIAL_SUPPLY_ENABLED", "all")


def test_rule_16_is_in_the_contract_once_after_rule_15(open_door):
    c = pa.contract()
    assert c.count(pa.FINANCIAL_PERIOD_RULE) == 1
    assert "\n16. " + pa.FINANCIAL_PERIOD_RULE in c
    assert c.index("\n15. ") < c.index("\n16. ")
    assert "{financial_period}" not in c and "{strict_pivot}" not in c


def test_it_teaches_one_constant_read_per_option_chosen_by_the_input():
    r = pa.FINANCIAL_PERIOD_RULE
    assert "constant" in r.lower() and "ONE `request.financial` call per option" in r
    assert 'request.financial(syminfo.tickerid, "EARNINGS_PER_SHARE_DILUTED", "FQ")' in r
    assert 'request.financial(syminfo.tickerid, "EARNINGS_PER_SHARE_DILUTED", "TTM")' in r
    assert 'period == "TTM" ? ttm : fq' in r
    assert "request.financial(syminfo.tickerid, \"EARNINGS_PER_SHARE_DILUTED\", period)" not in r


def test_it_says_to_leave_out_a_period_the_engine_does_not_serve():
    assert "leave that option out and say so in `reply`" in pa.FINANCIAL_PERIOD_RULE


@pytest.mark.parametrize("stage", ["", "admins", "off"])
def test_while_the_financial_door_is_dark_the_rule_is_not_there(monkeypatch, stage):
    monkeypatch.setenv("PINE_FINANCIAL_SUPPLY_ENABLED", stage)
    c = pa.contract()
    assert pa.FINANCIAL_PERIOD_RULE not in c and "request.financial" not in pa.document()
    assert "{financial_period}" not in c and "\n16. " not in c and "\n15. " in c
