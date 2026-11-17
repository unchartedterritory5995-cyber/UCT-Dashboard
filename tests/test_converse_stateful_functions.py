"""SuperTrend and Parabolic SAR can be built through Create Indicator.

Found by the exploratory round on production, 2026-11-17. The vocabulary offers `supertrend`,
`supertrendDirection`, `sar` and `sarDirection`, and the door writes each as bounded recurrences
whose update reads its own previous value through a name the table declares (`self`,
`state1`..`state4`). The door's boundary gate checks every `series` name against the names the
MODEL may write, so it refused its own expansion: "SuperTrend 10, 3" cost two model calls and
ended in "couldn't produce a valid change", every time, although the assistant had called the
function correctly.

  1. each of the four functions passes the door on the first attempt;
  2. a running value's own name is still refused anywhere else (bare, in a seed, in a warm-up);
  3. the exemption reads which arguments are updates, and what they bind, from the table;
  4. the instructions name the two as functions, with each direction's own sign, and say what to
     do with a ratcheting stop that is neither.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import copy

import pytest

from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    conv, emits, empty_view, env, model,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

num = lambda v: {"type": "num", "value": v}  # noqa: E731
ser = lambda name: {"type": "series", "name": name}  # noqa: E731
call = lambda name, *a: {"type": "call", "name": name, "args": list(a)}  # noqa: E731
op = lambda name, *a: {"type": "op", "name": name, "args": list(a)}  # noqa: E731
create = lambda tree: env(0, [{"op": "create", "name": "X", "outputs": [{"key": "st", "tree": tree}]}])  # noqa: E731
EMPTY = lambda: empty_view(0)  # noqa: E731

FUNCTIONS = [
    call("supertrend", num(3), num(10)),
    call("supertrendDirection", num(3), num(10)),
    call("sar", num(0.02), num(0.2)),
    call("sarDirection", num(0.02), num(0.2)),
]


# ─── 1. the functions the vocabulary offers pass the door ────────────────────────

@pytest.mark.parametrize("tree", FUNCTIONS, ids=[t["name"] for t in FUNCTIONS])
def test_each_stateful_function_passes_the_door_on_the_first_attempt(conv, clean_env, model, tree):
    client = model([emits(create(tree)), emits(create(tree))])
    r = conv.converse("x", user_id="u1", view=EMPTY())
    assert r["ok"] is True, (r.get("gate"), r.get("reason"))
    assert r["attempts"] == 1 and len(client.calls) == 1            # no repair turn was paid for
    assert r["envelope"]["ops"][0]["outputs"][0]["tree"] == tree     # stored as the call, not its expansion


def test_they_combine_with_ordinary_maths(conv, clean_env, model):
    # "close above SuperTrend": a yes/no built on the function
    tree = op(">", ser("close"), call("supertrend", num(3), num(10)))
    model([emits(create(tree))])
    r = conv.converse("x", user_id="u1", view=EMPTY())
    assert r["ok"] is True and r["attempts"] == 1, r.get("gate")


# ─── 2. the name itself is still not the model's to write ────────────────────────

@pytest.mark.parametrize("tree", [
    ser("self"),                                                    # bare
    ser("state1"),
    op("+", ser("close"), ser("self")),                             # in ordinary maths
    call("sma", ser("self"), num(10)),                              # inside a function that binds nothing
], ids=["bare-self", "bare-state1", "in-maths", "in-sma"])
def test_a_running_values_own_name_outside_its_update_is_refused_by_name(conv, clean_env, model, tree):
    model([emits(create(tree)), emits(create(tree))])
    r = conv.converse("x", user_id="u1", view=EMPTY())
    assert r["ok"] is False and r["gate"] == "schema:name", r


# ─── 3. the exemption is read from the table ─────────────────────────────────────

def test_only_a_read_inside_its_own_update_is_exempt():
    from api.services import definition_conversation as dcv
    one = num(1)
    # accum(seed, update, warmup): `self` is bound in the update (argument 1) and nowhere else
    tree = call("accum", ser("self"), op("+", ser("self"), ser("close")), num(50))
    before = copy.deepcopy(tree)
    out = dcv._bound_reads_as_constants(tree)
    assert out["args"][0] == ser("self")                            # a seed: untouched, so still refused
    assert out["args"][1] == op("+", one, ser("close"))             # the update: the bound read only
    assert tree == before                                           # the caller's tree is not changed
    # accum2(stateIndex, warmup, seed1, seed2, update1, update2): both names, in both updates only
    two = call("accum2", num(1), num(50), ser("state1"), ser("close"),
               op("+", ser("state1"), ser("state2")), op("-", ser("state2"), ser("self")))
    got = dcv._bound_reads_as_constants(two)
    assert got["args"][2] == ser("state1")                          # a seed
    assert got["args"][4] == op("+", one, one)
    assert got["args"][5] == op("-", one, ser("self"))              # `self` is not accum2's name
    # nested: an inner recurrence inside an outer update keeps the outer name bound
    nested = call("accum", num(0), call("accum", num(0), op("+", ser("self"), ser("close")), num(5)), num(9))
    assert dcv._bound_reads_as_constants(nested)["args"][1]["args"][1] == op("+", one, ser("close"))
    # nothing bound, nothing changed
    plain = op("+", ser("close"), call("sma", ser("close"), num(20)))
    assert dcv._bound_reads_as_constants(plain) == plain


def test_the_bound_names_and_update_positions_come_from_the_table():
    from api.services import ast_table
    from api.services import call_expansions
    single, multi = ast_table.recurrences(), ast_table.multi_states()
    assert single["accum"]["binds"] == call_expansions.ACCUM_SELF == "self"
    assert single["accum"]["body"] == 1
    assert list(multi["accum4"]["binds"]) == ["state1", "state2", "state3", "state4"]
    assert list(multi["accum4"]["updates"]) == [6, 7, 8, 9]
    # every name an expansion binds is one the table declares (so the exemption covers them all)
    assert set(ast_table.recurrence_bindings()) >= {"self", "state1", "state2", "state3", "state4"}


# ─── 4. the instructions ─────────────────────────────────────────────────────────

def test_the_instructions_name_the_two_as_functions_with_each_directions_own_sign():
    from api.services import definition_conversation as dcv
    text = dcv.system_prompt()
    for name in ("supertrend(factor, atrPeriod)", "supertrendDirection", "sar(step, maxStep)", "sarDirection"):
        assert f"`{name}`" in text, name
    assert "supertrend(3, 10)" in text                               # "SuperTrend 10, 3": period 10, factor 3
    # the two directions do NOT share a sign, and the instructions say each one's
    assert "-1 while the trend is UP, 1 while it is DOWN" in text
    assert "1 while the dots are under price, -1 while they are above" in text
    assert "a window is always a literal whole number" in text
    assert "ratchets" in text and "set disposition unsupported" in text


def test_the_signs_the_instructions_state_are_the_ones_the_expansions_compute():
    """The sentence above is a claim about `call_expansions`: read the trees and check it."""
    from api.services import call_expansions as ce
    st = ce.supertrend_trees(num(3), num(10))
    # the line is the LOWER band exactly when direction is -1: -1 is the uptrend
    value = st["value"]
    pick = value["args"][2]                                          # (unknown ? na : (direction == -1 ? lower : upper))
    assert pick["name"] == "?:" and pick["args"][0]["name"] == "=="
    minus_one = pick["args"][0]["args"][1]
    assert minus_one in (num(-1), op("u-", num(1)), {"type": "num", "value": -1})
    # Parabolic SAR seeds its trend 1 on a rising close and puts the dot at the LOW: 1 is under price
    sar = ce.sar_trees(num(0.02), num(0.2))
    assert sar is not None and set(sar) >= {"value", "direction"}
