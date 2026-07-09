"""Fixtures must always match the CURRENT Python output (regen guard).

Round-trips the committed parity-fixtures.json back through the Python
authority: if someone edits the JSON by hand (forbidden) or a Python calc
changes without regenerating, this fails. The JS side proves parity against
the same file in app/src/lib/journal-2-0/parity.test.js.
"""
import json
from pathlib import Path
import pytest
from api.services.journal_two import calculations as calc

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
