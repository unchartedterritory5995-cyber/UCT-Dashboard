"""⭐⭐ R-J — a window that names a member's knob, the Python half.

Owner ruling 2026-09-12, tied explicitly to R-H: **bound by the folded value FOR
THIS WAVE.** The justification is entirely the premise::

    R-H  a member ``input.int`` the translator folds becomes an IMMUTABLE
         parameter baked into the tree
    =>   the folded value is the ONLY value that window can take
    =>   a lookback bounded by it is a promise the badge can keep

⛔⛔ THE DAY THAT PREMISE ENDS THE BOUND BECOMES A LIE, so it is a declared
constant rather than an assumption in four readers' heads, and this file fires BY
NAME when it flips. The replacement is already ruled and recorded:
``_input_windows.whenRuntime`` says ``boundByDeclaredMaxval`` — bound by the
input's DECLARED ``maxval``, REFUSE when there is none, never fall back to the
default.

⛔ AND IT CHECKS THE TWO PYTHON READERS AGAINST EACH OTHER AND AGAINST THE
MANIFEST. ``ast_lint`` may import nothing outside the standard library, so it
re-derives the constant from its own manifest read; two derivations of one
declaration is exactly the shape that drifts, and this is what stops it.
"""
import json
import pathlib

from api.services.ast_interpret import max_lookback as interpret_max
from api.services.ast_lint import (
    UNKNOWN,
    _INPUTS_ARE_FOLDED as LINT_FOLDED,
    _RUNTIME_INPUT_WINDOW_RULE as LINT_RULE,
    _bind_foldable_window as lint_walk,
    max_lookback as lint_max,
)
from api.services.ast_table import (
    INPUTS_ARE_FOLDED,
    RUNTIME_INPUT_WINDOW_RULE,
    bind_foldable_window,
    usable_window_bound,
)

_MANIFEST = (pathlib.Path(__file__).resolve().parents[1]
             / "app/src/components/chart/engine/ast/closedTable.json")

#: ``ta.sma(close, period)`` where ``period`` is a member knob defaulting to 30.
KNOB = {"type": "series", "name": "period", "inputDefault": 30}
KNOB_TREE = {"type": "call", "name": "sma",
             "args": [{"type": "series", "name": "close"}, KNOB]}


def _declared():
    return json.loads(_MANIFEST.read_text(encoding="utf-8"))["_input_windows"]


def test_INPUTS_ARE_FOLDED_is_true_and_here_is_what_happens_when_it_is_not():
    assert INPUTS_ARE_FOLDED is True, (
        "R-J bound a knob-named window by its FOLDED VALUE, and the only thing "
        "that makes that honest is R-H: a folded `input.int` is baked into the "
        "tree, so the knob cannot move. `_input_windows.inputsAreFolded` is now "
        "false, which means a member CAN move it, and every bound this contract "
        "hands out is a promise about a value that is no longer fixed.\n\n"
        "THE REPLACEMENT IS ALREADY RULED, at "
        "`closedTable.json::_input_windows.whenRuntime`: bound by the input's "
        "DECLARED `maxval`, and REFUSE when there is none. Never fall back to the "
        "default -- a default is where the knob starts, and a lookback bound must "
        "hold everywhere the knob can reach.")


def test_the_wave_2_rule_is_on_file_so_it_cannot_be_quietly_re_decided():
    assert RUNTIME_INPUT_WINDOW_RULE == "boundByDeclaredMaxval"
    block = _declared()
    assert "maxval" in block["_whenRuntime"]
    assert "REFUSES" in block["_whenRuntime"]
    # ⛔ And the ruling itself is recorded beside the switch, not only in a commit.
    assert "R-H" in block["_ruling"]


def test_both_python_readers_derive_the_constant_from_the_same_declaration():
    # ⛔ TWO DERIVATIONS OF ONE VALUE. `ast_lint` cannot import `ast_table` --
    # its stdlib-only rail forbids it -- so each reads the manifest itself, and
    # this is what stops the two from drifting.
    declared = _declared()["inputsAreFolded"] is True
    assert INPUTS_ARE_FOLDED is declared
    assert LINT_FOLDED is declared
    assert LINT_RULE == RUNTIME_INPUT_WINDOW_RULE


def test_today_a_knob_named_window_is_bounded_by_the_folded_value():
    assert bind_foldable_window(KNOB) == (True, 30)
    assert usable_window_bound(KNOB) == 30
    assert lint_walk(KNOB) == (True, 30)
    assert interpret_max(KNOB_TREE) == 30
    # ⛔ `ast_lint` needs the definition's declared inputs, exactly as
    # `lint_definition` supplies them: an identifier the definition does not
    # declare is an unknown series and fails closed, which is a different
    # question from this one and is still the right answer to it.
    assert lint_max(KNOB_TREE, {"inputs": {"period": True}}) == 30


def test_CONTROL_the_gate_is_load_bearing_not_decorative():
    """Pass the flag off explicitly and the same knob becomes unanalysable.

    Without this the constant could be deleted from the code path entirely and
    every assertion above would still pass.
    """
    assert bind_foldable_window(KNOB, False) == (False, None)
    ternary = {"type": "op", "name": "?:",
               "args": [{"type": "series", "name": "isweekly"}, KNOB,
                        {"type": "num", "value": 10}]}
    assert bind_foldable_window(ternary, True) == (True, 30)
    assert bind_foldable_window(ternary, False) == (False, None)


def test_CONTROL_an_undeclared_identifier_stays_unanalysable():
    """R-J bounds a KNOB, never any bare name."""
    bare = {"type": "series", "name": "somethingElse"}
    assert bind_foldable_window(bare) == (False, None)
    assert usable_window_bound(bare) is None
    assert lint_walk(bare) == (False, None)
    assert lint_max({"type": "call", "name": "sma",
                     "args": [{"type": "series", "name": "close"}, bare]}) == UNKNOWN
