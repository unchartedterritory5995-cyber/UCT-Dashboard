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


@pytest.mark.parametrize("case", FIXTURES["composition"])
def test_composition_fixture_matches_python(case):
    """Net-liq composition regen guard — the authority is
    broker/composition.py (the live sentinel composes with it; the JS mirror
    is brokerLiveSummary, held by parity.test.js). The 2026-08-26 incident
    book (see test_incident_case_is_pinned_to_the_real_numbers) composes to
    $10,773.09, not the $21,763.06 a stale cash produced."""
    from api.services.journal_two.broker import composition
    i, exp = case["inputs"], case["expected"]
    out = composition.compose_net_liq(
        i["account"], i["positions"], i["strategies"],
        i["prices"], i["optionMarks"],
        i.get("preferBroker", False),
    )
    assert out == exp


def test_incident_case_is_pinned_to_the_real_numbers():
    """The 8/26 incident book must remain present with its real numbers —
    a regen that DROPS it loses the regression. It is located by its
    distinctive inputs (brokerCash == -18760.66) rather than by list
    position: position is an implementation detail that has already
    broken once (a regen prepended newer cases and moved it to index 4)."""
    matches = [c for c in FIXTURES["composition"]
               if c["inputs"]["account"].get("brokerCash") == -18760.66]
    assert matches, (
        "the 2026-08-26 incident regression case (brokerCash == -18760.66) "
        "is no longer in parity-fixtures.json composition cases — a regen "
        "DROPPED it and the regression it pins is no longer guarded"
    )
    exp = matches[0]["expected"]
    assert exp["netLiq"] == pytest.approx(10773.09, abs=0.02)
    acct = matches[0]["inputs"]["account"]
    assert acct["brokerCash"] == -18760.66
    assert acct["brokerCashLive"] == -29750.66
