"""⭐⭐ e95 unit 2b -- THE PYTHON HALF OF THE KNOB-ARM PRUNE, HELD TO A PINNED FIXTURE.

A member's ``input.string`` setting that drives a ``switch`` is a live knob: the member door builds every arm, and ONE
binding (its inputs) picks one (coordinator ruling 2026-11-22: prune at bind time). ``tests/fixtures/ast/
knob_arms_parity.json`` is the third party: this file asserts the Python lane (``ast_bind.prune_knob_arms``, inside
``fold_bound``, and the interpreter's entry), ``app/src/components/chart/engine/ast/knobArmsParity.test.js`` the JS lane
(``bind.js::pruneKnobArms`` / ``foldBound``). Neither lane is the oracle for the other.
"""

import io
import json
import math
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from api.services import ast_bind as B                          # noqa: E402
from api.services import ast_interpret as ai                     # noqa: E402

FIXTURE = (pathlib.Path(__file__).resolve().parents[1]
           / "tests" / "fixtures" / "ast" / "knob_arms_parity.json")
CASES = json.loads(io.open(FIXTURE, encoding="utf-8").read())["cases"]


def _consts(case):
    return B.binding_constants(timeframe=case.get("timeframe"), inputs=case.get("inputs"))


def test_the_fixture_is_a_real_population():
    """⛔ non-vacuity: arms picked, arms left alone, and a refused arm picked."""
    assert len(CASES) >= 8
    assert any(c["prunedTo"] != c["tree"] for c in CASES), "no case prunes"
    assert any(c["prunedTo"] == c["tree"] for c in CASES), "no case is left alone"
    assert any("refusedArm" in json.dumps(c["prunedTo"]) for c in CASES), "no refused arm is picked"


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["id"])
def test_prune_knob_arms_gives_the_pinned_tree(case):
    assert B.prune_knob_arms(case["tree"], _consts(case)) == case["prunedTo"]


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["id"])
def test_fold_bound_prunes_the_same_way(case):
    assert B.fold_bound(case["tree"], _consts(case)) == case["prunedTo"]


def test_a_tree_with_nothing_to_prune_binds_to_itself():
    """The same object, so a document with no knob ternary moves nowhere."""
    case = next(c for c in CASES if c["id"] == "knob-absent-left-alone")
    assert B.prune_knob_arms(case["tree"], _consts(case)) is case["tree"]


def _bars(n=40):
    return [{"t": f"2026-01-{(i % 28) + 1:02d}", "o": 100.0, "h": 102.0, "l": 98.0,
             "c": 101.0 if i % 2 else 99.0, "v": 1000.0 + i} for i in range(n)]


def test_the_interpreter_binds_at_its_entry_an_unpicked_refused_arm_is_never_evaluated():
    """The Python lane's own bind (``ast_interpret.interpret``): the inputs it is handed fix the knob, so a refused arm
    the setting does not pick is pruned away before anything evaluates; the picked one refuses by name."""
    tree = {"type": "op", "name": "?:", "args": [
        {"type": "op", "name": "==", "args": [{"type": "series", "name": "anchor"}, {"type": "num", "value": 3}]},
        {"type": "call", "name": "refusedArm", "args": [{"type": "num", "value": 1}]},
        {"type": "series", "name": "close"}]}
    col = ai.interpret(tree, _bars(), {"anchor": 0})
    assert [x for x in col if not math.isnan(x)][:2] == [99.0, 101.0]
    with pytest.raises(ai.TableRefusal) as exc:
        ai.interpret(tree, _bars(), {"anchor": 3})
    assert exc.value.guard == "interpret:refused-arm"
    assert "a setting picks a branch of this script that the translator refused" in str(exc.value)


def test_the_server_save_gate_measures_the_budget_at_the_knobs_defaults():
    """``user_definitions._admit_new_maths`` (the browser's install rule, ``nativeRegistry.validateAstLane``): a tree
    whose arms together read more series than the cap is admitted when the program the knobs' DEFAULTS draw is within
    it; the arm a later setting picks is measured by that binding's compute budget."""
    from api.services import user_definitions as ud
    from api.services import ast_budget
    S = lambda n: {"type": "series", "name": n}                                     # noqa: E731
    wide = S("high")
    for n in ("low", "open", "close", "volume", "hour", "minute", "dayofmonth", "month", "year"):
        wide = {"type": "op", "name": "+", "args": [wide, S(n)]}
    tree = {"type": "op", "name": "?:", "args": [
        {"type": "op", "name": "==", "args": [S("anchor"), {"type": "num", "value": 1}]}, wide, S("close")]}
    assert ast_budget.budget_result(tree, None)["ok"] is False, "the saved tree must be over the cap for this to mean anything"
    definition = {"id": "u_knob", "inputs": [{"key": "anchor", "type": "enum", "default": "A", "options": ["A", "B"]}],
                  "plots": [{"key": "value", "style": "line"}], "compute": {"kind": "ast", "ast": tree}}
    ud._admit_new_maths(definition, {})            # admitted: at its default the knob picks `close`
    moved = dict(definition, inputs=[{"key": "anchor", "type": "enum", "default": "B", "options": ["A", "B"]}])
    with pytest.raises(ud.SaveRefused) as exc:
        ud._admit_new_maths(moved, {})             # a default that picks the wide arm is over the cap: refused
    assert exc.value.gate == "budget"
