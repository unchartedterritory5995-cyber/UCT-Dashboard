"""⛔⛔ THE SWEEP REFUSED IT AND THE DOOR ADMITTED IT.

Reproduced in-process on ``close > sma(close, 1000)`` before this gate existed::

    ast_budget.budget_result(tree)  -> ok=False, guard=budget:lookback
    scan_definition.assert_scannable(d) -> ADMITTED, yields=bool
    routers/user_definitions._stamped(row) -> {'scannable': True, 'scan_refusal': None}
    scan_evaluator.evaluate_one(d, ...) -> ScanRunRefused [gate:not-scannable]
                                           "measures 1000 and the cap is 960"

So the surface that tells a member whether their screen runs said yes, and the
only thing that disagreed was a nightly sweep they cannot see. That is the same
shape as the ``cadence`` defect one gate over: a definition stamped runnable and
refused every night, forever, with nothing on screen to act on.

⭐ THE SENTENCE IS THE BUDGET'S OWN. ``budget_result`` already composes the cap,
the measurement and the reason; re-wording it in the gate would be a second
authority over a number ``scan_definition`` does not own — so this file asserts
the two strings are the SAME string.
"""

import json
import pathlib

import pytest

from api.services import ast_budget
from api.services import scan_definition as sd

ROOT = pathlib.Path(__file__).resolve().parents[1]
COLUMNS = ROOT / "tests" / "fixtures" / "ast" / "screener_columns.json"


def _definition(ast, source="x"):
    d = {"compute": {"kind": "ast", "ast": ast, "source": source}}
    d["compute"]["fn"] = sd.def_hash(d)
    return d


def _sma(window):
    return {"type": "op", "name": ">", "args": [
        {"type": "series", "name": "close"},
        {"type": "call", "name": "sma", "args": [
            {"type": "series", "name": "close"}, {"type": "num", "value": window}]},
    ]}


def test_an_over_budget_tree_is_refused_at_gate_budget():
    over = _sma(1000)
    # ⛔ NON-VACUITY FIRST: the budget really does reject this, so the assertion
    # below is about the DOOR rather than about a tree nothing objects to.
    verdict = ast_budget.budget_result(over)
    assert verdict["ok"] is False
    assert verdict["guard"] == "budget:lookback"

    with pytest.raises(sd.ScanRefused) as excinfo:
        sd.assert_scannable(_definition(over, "close > sma(close, 1000)"))
    assert "[gate:budget]" in str(excinfo.value)


def test_the_refusal_quotes_the_budget_verbatim_rather_than_rewording_it():
    """⭐ ONE AUTHORITY OVER THE NUMBER. If this gate ever starts composing its own
    sentence, the cap in the message and the cap in ``ast_budget`` can drift and
    a member is told a number nothing enforces."""
    over = _sma(1000)
    expected = ast_budget.budget_result(over)["error"]
    with pytest.raises(sd.ScanRefused) as excinfo:
        sd.assert_scannable(_definition(over, "close > sma(close, 1000)"))
    # The gate prefix is added by ScanRefused; the rest must be the budget's.
    assert str(excinfo.value).endswith(expected)


def test_a_tree_inside_the_budget_is_untouched():
    """⛔ Without this, a gate that refused everything satisfies the cases above."""
    out = sd.assert_scannable(_definition(_sma(20), "close > sma(close, 20)"))
    assert out["yields"] == "bool"


def test_the_door_and_the_sweep_now_AGREE_on_every_member_formula():
    """⭐⭐ THE CLAIM THAT MATTERS, over the real generated screener corpus.

    Anything ``assert_scannable`` admits, the budget must also admit — otherwise
    the server is stamping ``scannable: true`` on something the sweep will refuse
    tonight. The fixture is regenerated from the ``.pine`` sources on every
    frontend run, so this cannot drift into a claim about formulas the doors
    stopped producing.
    """
    cases = json.loads(COLUMNS.read_text(encoding="utf-8"))["cases"]
    assert len(cases) >= 36

    disagreements = []
    admitted = 0
    for case in cases:
        try:
            sd.assert_scannable(_definition(case["ast"], case["source"]))
        except sd.ScanRefused:
            continue
        admitted += 1
        if not ast_budget.budget_result(case["ast"]).get("ok"):
            disagreements.append(case["id"])

    # ⛔ THE DENOMINATOR IS ASSERTED TOO: a corpus that admitted nothing would
    # pass this having compared nothing at all.
    assert admitted >= 30, f"only {admitted} definitions were admitted"
    assert disagreements == [], (
        "the door admits what the sweep refuses: " + ", ".join(disagreements))
