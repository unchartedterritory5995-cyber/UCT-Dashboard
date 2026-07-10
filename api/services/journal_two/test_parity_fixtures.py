"""Fixtures must always match the CURRENT Python output (regen guard).

Round-trips the committed parity-fixtures.json back through the Python
authority: if someone edits the JSON by hand (forbidden) or a Python calc
changes without regenerating, this fails. The JS side proves parity against
the same file in app/src/lib/journal-2-0/parity.test.js.
"""
import json
from datetime import date as Date
from pathlib import Path
import pytest
from api.services.journal_two import calculations as calc
from api.services.journal_two import options as opt

FIXTURES = json.loads(
    (Path(__file__).resolve().parents[3] / "app" / "src" / "lib" / "journal-2-0"
     / "parity-fixtures.json").read_text()
)


@pytest.mark.parametrize("case", FIXTURES["equity"])
def test_equity_fixture_matches_python(case):
    i, exp = case["inputs"], case["expected"]
    pnl = calc.trade_pnl_dollar(i["side"], i["entryPrice"], i["exitPrice"], i["shares"])
    assert pnl == pytest.approx(exp["pnlDollar"], abs=1e-9)
    assert calc.hold_days(i["entryDate"], i["exitDate"]) == exp["holdDays"]
    assert calc.trade_result(pnl, i["entryPrice"], i["shares"], i["breakevenRange"]) == exp["result"]


def _py_legs(legs):
    """camelCase fixture legs -> snake_case for the Python calcs (mirrors the generator)."""
    out = []
    for leg in legs:
        d = {"side": leg["side"], "qty": leg["qty"],
             "entry_price": leg["entryPrice"], "exit_price": leg["exitPrice"]}
        if "strike" in leg:
            d["strike"] = leg["strike"]
        if "expiration" in leg:
            d["expiration"] = leg["expiration"]
        out.append(d)
    return out


@pytest.mark.parametrize("case", FIXTURES["options"])
def test_options_fixture_matches_python(case):
    i, exp = case["inputs"], case["expected"]
    legs = _py_legs(i["legs"])
    ne = opt.compute_net_entry(legs)
    assert ne == pytest.approx(exp["netEntry"], abs=1e-9)
    nx = opt.compute_net_exit(legs)
    if exp["netExit"] is None:
        assert nx is None
        assert exp["pnl"] is None
    else:
        assert nx == pytest.approx(exp["netExit"], abs=1e-9)
        assert opt.compute_pnl(ne, nx, 0, 0) == pytest.approx(exp["pnl"], abs=1e-9)
    assert opt.classify_debit_credit(ne) == exp["debitCredit"]
    max_risk = opt.compute_max_risk(i["strategyType"], legs, ne)
    if exp["maxRisk"] is None:
        assert max_risk is None
    else:
        assert max_risk == pytest.approx(exp["maxRisk"], abs=1e-9)
    dte = opt.compute_days_to_expiration(legs, as_of=Date.fromisoformat(i["asOf"]))
    assert dte == exp["dte"]
