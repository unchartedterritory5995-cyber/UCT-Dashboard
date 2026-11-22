"""THE FISHER TRANSFORM IN THE LIBRARY: offered as a function, on a capture.

Several linked running values are built from a member's words only in the two shapes that provably
settle (`tests/test_converse_running_values_linked.py`); a form that is path-dependent by its shape
is refused, by name. The Fisher Transform is one: it SNAPS the value it feeds back (past 0.99 it
becomes 0.999), a choice on its own value.

It is offered the way SuperTrend and Parabolic SAR are: as the function `fisher(length)`, whose
expansion is the formula that was graded, bar for bar, against TradingView's built-in before it was
entered (`callExpansions.js::fisherTree`; `tests/fixtures/ast/fisher_graded.json` holds the tree's
fingerprint). Held here, at the door:

  * the library's formula is the short call, and the door accepts it and checks its expansion;
  * the same recurrence WRITTEN OUT BY HAND is still refused as path-dependent, with its numbers
    exactly the library's or one of them moved: the rule is loosened for nothing;
  * what the member reads says what it was graded against.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import copy

import pytest

from api.services import call_expansions, named_indicators as ni, running_values
from tests.test_p2_truth_server import call, conv, emits, empty_view, env, model, num, out, view  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

GATE = "unsupported:running-value"
FISHER = ni.entry("fisher_transform")
OUT = {o["key"]: o for o in FISHER["outputs"]}
CHART = {"sym": "NVDA", "tf": "D"}


def at(length, key="fisher"):
    return ni.tree_at(OUT[key], {"length": length})


def create(tree, key="fisher", **extra):
    return {"op": "create", "name": "Fisher Transform", "placement": "pane", "outputs": [{"key": key, "tree": tree}], **extra}


def by_hand(length=9):
    """The same recurrence written out: what `fisher(length)` stands for."""
    return call_expansions.expand_call(call("fisher", num(length)))


# ═══ 1. the entry ════════════════════════════════════════════════════════════

def test_the_librarys_formula_is_the_short_call_and_stands_on_all_three_tiers():
    assert OUT["fisher"]["tree"] == call("fisher", num(9))
    assert OUT["trigger"]["tree"] == {"type": "offset", "value": 1, "args": [call("fisher", num(9))]}
    assert OUT["fisher"]["sites"] == {"length": [[0]]}                          # ONE number, in one place
    assert ni.tiers(FISHER) == (True, True, True)
    assert FISHER["evidence"]["capture"]["grade"] == "EQUAL AFTER WARM-UP"
    said = ni.member_sentence(FISHER, {"length": 9})
    assert said.startswith("Built to UCT's checked formula for Fisher Transform (length 9)")
    assert said.endswith("and equal to TradingView's own after the first bars of captured charts.")
    # what the call stands for is path-dependent by its shape: it is here on evidence, not on the shape rule
    assert running_values.classify(by_hand())["shape"] == running_values.PATH


@pytest.mark.parametrize("length", [9, 20, 2, 659])
def test_the_door_accepts_the_call_at_any_length_the_history_can_hold(conv, length):
    for key in ("fisher", "trigger"):
        answer = conv.check_envelope(env(0, [create(at(length, key), key)]), 0, empty_view(0))
        assert answer["ops"][0]["outputs"][0]["tree"] == at(length, key)      # returned as written: the short call


def test_a_length_the_history_cannot_hold_is_refused_for_that_as_any_formula_is(conv):
    """300 bars of restart, the range, and the trigger's one bar back: 659 is the most."""
    with pytest.raises(conv._Refused) as caught:
        conv.check_envelope(env(0, [create(at(660, "trigger"), "trigger")]), 0, empty_view(0))
    assert caught.value.gate.startswith("budget:"), caught.value.gate


def test_asked_for_by_name_it_is_built_in_one_call_and_says_what_it_was_graded_against(conv, clean_env, model):
    answer = env(0, [{"op": "create", "name": "Fisher Transform", "placement": "pane", "primary": "fisher",
                      "outputs": [{"key": "fisher", "label": "Fisher", "tree": at(9)},
                                  {"key": "trigger", "label": "Trigger", "tree": at(9, "trigger")}]}],
                 reply="Built the Fisher Transform.")
    client = model([emits(answer)])
    r = conv.converse("Add the Fisher Transform", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["attempts"] == 1 and len(client.calls) == 1, r.get("reason")
    notes = [a["text"] for a in r["envelope"]["assumptions"]]
    assert notes[0].startswith("Built to UCT's checked formula for Fisher Transform (length 9)")
    assert "equal to TradingView's own after the first bars of captured charts" in notes[0]
    assert not any("not in UCT's checked library" in t for t in notes)          # it is no longer a withheld name
    # the answer the window is sent is two short calls, not eight hundred nodes
    assert len(str(r["envelope"]["ops"][0]["outputs"])) < 600
    # and the assistant was handed the call to write, in its own copy of the contract
    assert "fisher(length)" in str(client.calls[0])


# ═══ 2. the rule is loosened for nothing ═════════════════════════════════════

def test_the_same_recurrence_written_out_by_hand_is_still_refused_as_path_dependent(conv):
    """Exactly the library's numbers, node for node, but WRITTEN OUT: refused. The function is what
    is offered; the shape is not."""
    for tree in (by_hand(9), by_hand(20)):
        with pytest.raises(conv._Refused) as caught:
            conv.check_envelope(env(0, [create(tree)]), 0, empty_view(0))
        assert caught.value.gate == GATE and "never settles" in caught.value.detail


@pytest.mark.parametrize("moved", ["0.67", "0.66", "0.99", "0.999", "300"])
def test_a_hand_written_variant_with_one_number_moved_is_refused_too(conv, moved):
    tree = copy.deepcopy(by_hand(9))
    stack, hit = [tree], 0
    while stack and not hit:
        node = stack.pop()
        if isinstance(node, dict):
            if node.get("type") == "num" and str(node.get("value")) == moved:
                node["value"] = 0.5 if moved != "300" else 200
                hit += 1
            stack.extend(node.get("args") or [])
    assert hit == 1
    with pytest.raises(conv._Refused) as caught:
        conv.check_envelope(env(0, [create(tree)]), 0, empty_view(0))
    assert caught.value.gate == GATE, (moved, caught.value.gate)


def test_asked_for_by_name_and_answered_with_another_formula_nothing_is_built(conv, clean_env, model):
    wrong = env(0, [create(call("ema", {"type": "series", "name": "close"}, num(9)))])
    model([emits(wrong), emits(wrong)])
    r = conv.converse("Add the Fisher Transform", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is False and r["gate"] == "named:formula" and "envelope" not in r


# ═══ 3. changing it ══════════════════════════════════════════════════════════

def test_its_length_is_one_number_the_assistant_may_set(conv):
    """Stored as the short call, its length is one ordinary slot (`fisher#0`): not a number inside
    linked running values, which the door would send back."""
    holding = view(1, [out("fisher", at(9), type_="series")])
    assert conv.running_value_owns(at(9), [0]) is None
    assert conv.check_envelope(env(1, [{"op": "set_slot", "slot": "fisher#0", "value": 20}]), 1, holding)
