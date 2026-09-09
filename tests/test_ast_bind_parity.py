"""⭐⭐ THE PYTHON HALF OF THE BIND-FOLD PARITY, HELD TO A PINNED FIXTURE.

`tests/fixtures/ast/bind_fold_parity.json` is the third party. This file asserts
the Python lane against it; `app/src/components/chart/engine/ast/bindParity.test.js`
asserts the JS lane against the same rows.

⛔ NEITHER LANE IS THE ORACLE FOR THE OTHER. A test that ran the JS lane from
Python and compared the two would be GREEN WHEN BOTH ARE WRONG TOGETHER — the
failure mode this repo has hit before (`a cross-lane equality is satisfied by two
lanes that are wrong together`). A pinned expectation fails when either moves,
including when they move in step.

⛔ AND THE REFUSAL STRINGS ARE PINNED, NOT JUST THE VERDICTS. The owner ruled the
two lanes must produce the SAME reason string: a member pasting a script into the
builder and a sweep evaluating the saved definition must be told the same thing
about the same length. A verdict-only comparison would let one lane say
*"folded to 2.5 from lenDaily / 2"* and the other say *"bad window"* and call
that parity.
"""

import io
import json
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from api.services import ast_bind as B                          # noqa: E402
from api.services import ast_interpret as ai                     # noqa: E402

FIXTURE = (pathlib.Path(__file__).resolve().parents[1]
           / "tests" / "fixtures" / "ast" / "bind_fold_parity.json")
CASES = json.loads(io.open(FIXTURE, encoding="utf-8").read())["cases"]


def _consts(case):
    return B.binding_constants(timeframe=case.get("timeframe"),
                               inputs=case.get("inputs"),
                               symbol=case.get("symbol"))


def test_the_fixture_is_not_empty_and_covers_both_outcomes():
    """⛔ NON-VACUITY, AND IT CHECKS THE SHAPE OF THE POPULATION rather than the
    count. A fixture of eight folding cases and no refusals would make every
    refusal assertion below pass by never running."""
    assert len(CASES) >= 6
    assert any("foldsTo" in c for c in CASES), "no folding case"
    assert any("refusalContains" in c for c in CASES), "no refusal case"
    assert any(c.get("leavesUnfolded") for c in CASES), "no left-alone case"
    # ⭐ AND THE TEXT HALF, ASSERTED SEPARATELY. Without this the text rows could
    # all be deleted and every remaining assertion in this file would still pass —
    # the failure mode a shared fixture is most prone to.
    assert any("foldScalarTo" in c for c in CASES), "no text-answer case"
    assert any(c.get("notFoldableOn") for c in CASES), "no unresolvable-field case"


@pytest.mark.parametrize("case", [c for c in CASES if "foldScalarTo" in c],
                         ids=lambda c: c["id"])
def test_the_python_lane_answers_a_TEXT_question_with_the_PINNED_number(case):
    got = B.fold_scalar(case["tree"], _consts(case))
    assert got == case["foldScalarTo"], (
        f"{case['id']}: answered {got!r}, fixture pins {case['foldScalarTo']!r}")
    if "maxLookback" in case:
        # ⛔ AND IT COSTS NO BARS. `syminfo.*` is settled by the BINDING, so a text
        # question over it reads no bar at all — pinned beside the answer because a
        # lookback silently guessed at 0 and a lookback that IS 0 look identical
        # until the day the guess is wrong.
        assert ai.max_lookback(case["tree"]) == case["maxLookback"]


@pytest.mark.parametrize("case", [c for c in CASES if c.get("notFoldableOn")],
                         ids=lambda c: c["id"])
def test_an_unresolvable_symbol_scoped_field_STOPS_the_fold_and_names_itself(case):
    with pytest.raises(B.NotFoldable) as caught:
        B.fold_scalar(case["tree"], _consts(case))
    what = caught.value.what
    assert case["notFoldableOn"] in what, (
        f"{case['id']}: stopped on {what!r}, expected it to name "
        f"{case['notFoldableOn']!r}")
    for fragment in case.get("notFoldableSays") or ():
        assert fragment in what, (
            f"{case['id']}: the reason is missing {fragment!r}\n  got: {what}")


@pytest.mark.parametrize("case", [c for c in CASES if "foldsTo" in c],
                         ids=lambda c: c["id"])
def test_the_python_lane_folds_to_the_PINNED_literal(case):
    out = B.fold_bound(case["tree"], _consts(case))
    slot = out["args"][1]
    assert slot == {"type": "num", "value": case["foldsTo"]}, (
        f"{case['id']}: folded to {slot!r}, fixture pins {case['foldsTo']!r}")
    if "maxLookback" in case:
        # ⛔ THE BUDGET IS PRICED ON THE FOLDED TREE. Pinning the lookback beside
        # the literal is what catches a fold that produced the right number and
        # a tree the budget then read differently.
        assert ai.max_lookback(out) == case["maxLookback"]


@pytest.mark.parametrize("case", [c for c in CASES if "refusalContains" in c],
                         ids=lambda c: c["id"])
def test_the_python_lane_refuses_with_the_PINNED_sentence(case):
    with pytest.raises(Exception) as caught:
        B.fold_bound(case["tree"], _consts(case))
    msg = str(caught.value)
    for fragment in case["refusalContains"]:
        assert fragment in msg, (
            f"{case['id']}: the refusal is missing {fragment!r}\n  got: {msg}")


@pytest.mark.parametrize("case", [c for c in CASES if c.get("leavesUnfolded")],
                         ids=lambda c: c["id"])
def test_an_unfoldable_length_is_LEFT_ALONE_and_names_its_operand(case):
    """⛔ NO PARTIAL FOLD. The slot comes back exactly as it went in, so the
    window check downstream refuses the member's own expression rather than some
    half-rewritten version of it."""
    out = B.fold_bound(case["tree"], _consts(case))
    assert out["args"][1] == case["tree"]["args"][1], (
        f"{case['id']}: the slot was rewritten and should not have been")
    with pytest.raises(B.NotFoldable) as caught:
        B.fold_scalar(case["tree"]["args"][1], _consts(case))
    assert caught.value.what == case["notFoldableOperand"]


def test_the_fixture_itself_is_reachable_from_the_JS_lane_too():
    """⚠️ A PARITY FIXTURE ONLY ONE LANE READS IS NOT A PARITY FIXTURE.

    This asserts the JS half EXISTS and points at this same file — the cheap
    check that stops the pair silently becoming a one-lane rail, which is what
    happens when somebody deletes the JS test and every Python test stays green.
    """
    js = (pathlib.Path(__file__).resolve().parents[1] / "app" / "src" / "components"
          / "chart" / "engine" / "ast" / "bindParity.test.js")
    assert js.exists(), (
        "the JS half of this parity pair is missing — the fixture is then a "
        "Python-only rail wearing the word `parity`")
    text = io.open(js, encoding="utf-8").read()
    assert "bind_fold_parity.json" in text, (
        "the JS half exists but does not read the pinned fixture, so the two "
        "lanes are no longer held to one artifact")
