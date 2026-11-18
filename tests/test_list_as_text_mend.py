"""A MEND: the list of changes written as ONE PIECE OF TEXT.

SEEN on production, 2026-11-18. On a long formula the assistant can write its whole list of
changes as a piece of text holding the list:

    "ops": "[{\\"op\\": \\"create\\", \\"name\\": \\"Weighted Momentum Composite\\", ...}]"

The contract refused the format, the repair did the same again, and the member read "The UCT Agent
couldn't produce a valid change for that. Try rephrasing it." about an answer whose content nobody
had looked at.

The door now reads such a field as the list it holds. It is an EXTRACTION, not a repair: what comes
out meets the size cap and the strict check exactly as a list would.
"""
from __future__ import annotations

import copy
import json

import pytest

from tests.test_learned_record import last_turn
from tests.test_p2_truth_server import call, conv, emits, empty_view, env, model, num  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name
from tests.test_rollout_telemetry import store  # noqa: F401 -- fixture by name

CHART = {"sym": "NVDA", "tf": "D"}
S = lambda n: {"type": "series", "name": n}  # noqa: E731
GOOD = env(0, [{"op": "create", "name": "EMA 20", "placement": "price",
                "outputs": [{"key": "ma", "tree": call("ema", S("close"), num(20))}]}],
           assumptions=[{"output": "ma", "text": "Drawn on the price pane."}])


def as_text(answer, *fields):
    out = copy.deepcopy(answer)
    for f in fields:
        out[f] = json.dumps(out[f])
    return out


def test_the_fields_read_this_way_are_the_contracts_own_lists(conv):
    assert conv._list_fields() == ("assumptions", "ops", "questions")
    assert conv.MEND_LIST_AS_TEXT == "list-as-text"


def test_a_list_written_as_text_becomes_the_list_and_nothing_else_is_touched(conv):
    got, which = conv.lists_from_text(as_text(GOOD, "ops"))
    assert got == GOOD and which == ["ops"]
    got, which = conv.lists_from_text(as_text(GOOD, "ops", "assumptions"))
    assert got == GOOD and which == ["assumptions", "ops"]
    # an answer that arrived as lists is the SAME object back
    got, which = conv.lists_from_text(GOOD)
    assert got is GOOD and which == []
    # the input is not changed in place
    text = as_text(GOOD, "ops")
    conv.lists_from_text(text)
    assert isinstance(text["ops"], str)


@pytest.mark.parametrize("ops", [
    "add a 20 day EMA",                                   # prose
    "[{\"op\": \"create\"",                                # cut off
    "{\"op\": \"create\"}",                                # an object, not a list
    "\"[1, 2]\"",                                          # text inside text is not unwrapped twice
    "",
])
def test_text_that_is_not_a_list_is_left_for_the_check_to_refuse(conv, ops):
    answer = {**GOOD, "ops": ops}
    got, which = conv.lists_from_text(answer)
    assert got is answer and which == []
    assert conv._schema_errors(got)                                          # and the contract still refuses it


def test_only_the_contracts_list_fields_are_read(conv):
    """A reply or a name that happens to be a list in text is the text the assistant wrote."""
    answer = {**GOOD, "reply": "[1, 2, 3]"}
    got, which = conv.lists_from_text(answer)
    assert got is answer and which == []
    for other in (None, "x", [], 3):
        assert conv.lists_from_text(other) == (other, [])


def test_through_the_door_it_builds_in_one_call_and_the_record_says_it_was_mended(store, conv, clean_env, model):
    client = model([emits(as_text(GOOD, "ops"))])
    r = conv.converse("Add a 20 day EMA", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["disposition"] == "change" and len(client.calls) == 1, r.get("reason")
    assert isinstance(r["envelope"]["ops"], list) and r["envelope"]["ops"][0]["op"] == "create"
    assert r["usage"]["mended"] == "list-as-text" and r["usage"]["repair_gate"] is None
    assert last_turn()["failure_class"] == "ok"


def test_what_comes_out_of_the_text_meets_the_same_checks(store, conv, clean_env, model):
    # (1) a list in text that breaks the contract is refused as a list would be, and repaired
    bad = env(0, [{"op": "create", "name": "x", "placement": "price",
                   "outputs": [{"key": "ma", "tree": call("noSuchFunction", S("close"))}]}])
    client = model([emits(as_text(bad, "ops")), emits(GOOD)])
    r = conv.converse("Add a 20 day EMA", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and len(client.calls) == 2 and r["usage"]["repair_gate"] == "envelope:schema"
    # (2) text is not a way round the size cap: it is sized as soon as it is a list
    node = S("close")
    for _ in range(conv.MAX_FORMULA_DEPTH + 5):
        node = {"type": "op", "name": "+", "args": [node, num(1)]}
    huge = env(0, [{"op": "create", "name": "x", "placement": "price", "outputs": [{"key": "ma", "tree": node}]}])
    assert conv.answer_size_problem(as_text(huge, "ops")) is None            # as text it holds nothing to count
    client = model([emits(as_text(huge, "ops")), emits(GOOD)])
    r = conv.converse("Add a 20 day EMA", user_id="u2", view=empty_view(0), chart=CHART)
    assert r["ok"] is False and r["gate"] == "envelope:formula-size" and len(client.calls) == 1
