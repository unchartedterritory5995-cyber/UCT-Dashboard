"""AN OPERATOR NODE NAMED AFTER A FUNCTION IS RE-SPELLED AS THAT CALL, AND ONLY WHEN IT IS EXACTLY THE CALL (2026-11-24).

⚰️ MEASURED 2026-11-24 in the regression sweep after #2599 (admin, measurement only; the request is private, so by its
shape alone): a first attempt wrote the larger and the smaller of two values as `{"type": "op", "name": "max", ...}`
and `min`. The contract's operators are symbols, the whole answer was refused (`envelope:schema`), and the repair wrote
the same nodes as calls: a second paid call for a spelling.

Coordinator's ruling, held here with no paid call:
  * re-spelled only when the name is a function of the engine's OWN table, the node gives exactly that function's
    number of arguments, and their order is kept (`max(a, b)` stays a then b);
  * any other arity, a name the table does not hold, an operator, or a node with any other key is left as written,
    for the check to refuse as before;
  * the operators and the arities are READ (the contract's enum, the table's `args`), never restated here;
  * the turn that needed it is answered in ONE call and the mend is recorded by name (`usage.mended`); the control
    (a wrong arity) still pays its repair.
"""
from __future__ import annotations

import copy

from api.services import ast_table
from api.services import definition_conversation as dc
from tests.test_p2_truth_server import call, conv, emits, empty_view, env, model, num  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

DAILY = {"sym": "NVDA", "tf": "D"}
S = lambda n: {"type": "series", "name": n}  # noqa: E731
C, H, L = S("close"), S("high"), S("low")


def op(name, *args):
    return {"type": "op", "name": name, "args": list(args)}


def build(tree):
    return env(0, [{"op": "create", "name": "Clipped distance", "placement": "pane", "primary": "d",
                    "outputs": [{"key": "d", "label": "Clipped distance", "tree": tree}]}])


def tree_of(answer):
    return answer["ops"][0]["outputs"][0]["tree"]


# ── what is read, not restated ──

def test_the_operators_and_the_arities_are_read_from_the_contract_and_the_table():
    ops = dc._schema_operators()
    assert {"+", "-", "*", "/", "&&", "?:"} <= ops and not ops & set(ast_table.TABLE["functions"])
    f = ast_table.TABLE["functions"]
    assert len(f["max"]["args"]) == 2 and len(f["min"]["args"]) == 2 and len(f["abs"]["args"]) == 1


# ── the mend ──

def test_THE_FINDING_max_and_min_written_as_operators_become_the_calls_in_the_same_order():
    written = op("-", op("max", H, op("/", C, num(2))), op("min", L, C))
    answer = build(written)
    assert any("is not one of" in e for e in dc._schema_errors(answer))       # refused as it came
    after, n = dc.mend_operator_named_function(answer)
    assert n == 2
    assert tree_of(after) == op("-", call("max", H, op("/", C, num(2))), call("min", L, C))
    assert dc._schema_errors(after) == []
    assert tree_of(answer) == written, "the answer it was given was changed in place"


def test_a_one_argument_function_written_as_an_operator_is_re_spelled_too():
    after, n = dc.mend_operator_named_function(build(op("abs", op("-", C, H))))
    assert n == 1 and tree_of(after) == call("abs", op("-", C, H))


def test_a_wrong_arity_an_unknown_name_an_operator_or_another_key_is_left_as_written():
    for tree in (op("max", H, L, C),                        # three arguments: max takes two
                 op("max", H),                               # one
                 op("maxOf", H, L),                          # a name the table does not hold
                 op("+", H, L),                              # an operator
                 {**op("max", H, L), "note": "x"}):          # a node with another key
        answer = build(copy.deepcopy(tree))
        after, n = dc.mend_operator_named_function(answer)
        assert n == 0 and after is answer and tree_of(after) == tree, tree


def test_an_answer_with_nothing_to_mend_is_the_same_object():
    answer = build(call("max", H, L))
    assert dc.mend_operator_named_function(answer) == (answer, 0)
    assert dc.mend_operator_named_function({"disposition": "clarify"})[1] == 0
    assert dc.mend_operator_named_function("not an answer") == ("not an answer", 0)


# ── the whole turn ──

def test_the_turn_that_paid_a_second_call_is_answered_in_one_and_says_it_was_mended(conv, clean_env, model):
    client = model([emits(build(op("-", op("max", H, C), op("min", L, C))))])
    r = conv.converse("Plot the high minus the close, but never less than zero", user_id="u1", view=empty_view(0), chart=DAILY)
    assert r["ok"] is True and len(client.calls) == 1, r
    assert r["usage"]["repair_gate"] is None
    assert conv.MEND_OPERATOR_FUNCTION in str(r["usage"]["mended"])
    assert tree_of(r["envelope"]) == op("-", call("max", H, C), call("min", L, C))


def test_control_a_wrong_arity_still_pays_its_repair(conv, clean_env, model):
    client = model([emits(build(op("max", H, L, C))), emits(build(call("max", H, L)))])
    r = conv.converse("Plot the larger of the high and the low", user_id="u1", view=empty_view(0), chart=DAILY)
    assert len(client.calls) == 2, r
    assert r["usage"]["repair_gate"] == "envelope:schema"
    assert conv.MEND_OPERATOR_FUNCTION not in str(r["usage"]["mended"])
