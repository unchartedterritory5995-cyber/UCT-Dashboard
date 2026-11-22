"""THE DOOR REFUSES A NUMBER STANDING WHERE A VALUE SHOULD BE, AND A REPLY THAT IS A PLACEHOLDER.

Found by a value check of a live round, 2026-11-22. Asked on a 5 minute chart for "today's low so far plus the
14 day ATR, and today's high so far minus the 14 day ATR", the assistant could not write a daily ATR and answered
`sessionLow() + tf(0, W)` and `sessionHigh() - tf(0, W)`: a weekly read of the CONSTANT 0 where the ATR should
have been, with the reply "Placeholder". The door accepted it on the first attempt. Labelled "Session low + ATR",
it drew the session low: a wrong picture under an honest-looking label.

Two guards, each on its own:
  * a `tf`, `tf_live` or `sym` wrapper whose child reads nothing of a bar (no series, no call) is refused, so the
    model gets its one repair, told to write the value or to say it cannot;
  * a change whose `reply` is a placeholder word is refused the same way.

MEASURED before they were written, with the door's own functions, over every answer recorded in the live rounds
that changes something (199): they refuse that one answer and no other. Held here on the 101 recorded right
answers of the value cases as well. The recorded answer itself is a value case recorded WRONG (`intraday-01`).

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from api.services import definition_conversation as dc
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    conv, emits, empty_view, env, model,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

ROOT = Path(__file__).resolve().parents[1]
CASES = json.loads((ROOT / "tests" / "fixtures" / "authoring" / "value_cases.json").read_text(encoding="utf-8"))["cases"]
THE_ANSWER = next(c for c in CASES if c["id"] == "intraday-01")
WORDS = THE_ANSWER["words"]
CHART = {"sym": "NVDA", "tf": "5"}

CLOSE = {"type": "series", "name": "close"}
ZERO = {"type": "num", "value": 0}


def call(name, *args):
    return {"type": "call", "name": name, "args": list(args)}


def op(name, *args):
    return {"type": "op", "name": name, "args": list(args)}


def wrap(kind, value, child):
    return {"type": kind, "value": value, "args": [child]}


def created(*trees, reply="Two lines.", name="Lines"):
    outputs = [{"key": f"o{k}", "tree": t} for k, t in enumerate(trees)]
    return {**env(0, [{"op": "create", "name": name, "placement": "price", "outputs": outputs}]), "reply": reply}


ATR = call("atr", {"type": "series", "name": "high"}, {"type": "series", "name": "low"}, CLOSE, {"type": "num", "value": 14})
GOOD = created(op("+", {"type": "series", "name": "low"}, ATR), op("-", {"type": "series", "name": "high"}, ATR))


def refused_by(fn, *args):
    try:
        fn(*args)
    except dc._Refused as exc:
        return exc
    return None


# ── a scope read of nothing ──

@pytest.mark.parametrize("tree,why", [
    (wrap("tf", "W", ZERO), "the weekly read of the constant 0 (the finding)"),
    (wrap("tf", "M", {"type": "num", "value": 14}), "a monthly read of a number"),
    (wrap("tf_live", "W", ZERO), "the live weekly read of a number"),
    (wrap("sym", "SPY", {"type": "num", "value": 1}), "another symbol's ... number"),
    (op("+", call("sessionLow"), wrap("tf", "W", ZERO)), "inside a sum, as it was answered"),
    (wrap("tf", "W", op("*", {"type": "num", "value": 2}, {"type": "num", "value": 3})), "a read of arithmetic over numbers only"),
    (call("sma", wrap("tf", "W", ZERO), {"type": "num", "value": 10}), "inside a call's argument"),
])
def test_a_scope_read_of_nothing_is_refused(tree, why):
    exc = refused_by(dc._refuse_a_scope_read_of_nothing, [("output x", tree)])
    assert exc is not None, why
    assert exc.gate == "envelope:reference"
    told = exc.for_model()
    for piece in ("output x:", "reads a plain number, not a value of a bar", "a number is standing where the value the member asked for should be",
                  "the weekly close is tf(close, W)", "answer `unsupported` and say what is missing"):
        assert piece in told, piece


@pytest.mark.parametrize("tree", [
    wrap("tf", "W", CLOSE),                                              # the weekly close
    wrap("tf", "M", {"type": "series", "name": "high"}),
    wrap("tf", "W", call("sma", CLOSE, {"type": "num", "value": 10})),        # a call is a read
    wrap("sym", "SPY", CLOSE),
    wrap("tf", "W", call("sessionLow")),                                 # a call with no arguments still reads bars
    op("+", CLOSE, ZERO),                                                # a plain number OUTSIDE a scope read is arithmetic
    {"type": "offset", "value": 1, "args": [CLOSE]},
    ZERO,                                                                # a level line is a number, and is not a scope read
])
def test_CONTROL_a_scope_read_of_a_value_and_a_plain_number_are_left_alone(tree):
    assert refused_by(dc._refuse_a_scope_read_of_nothing, [("output x", tree)]) is None


# ── a placeholder reply ──

@pytest.mark.parametrize("reply", ["Placeholder", "placeholder.", "  PLACEHOLDER  ", "TODO", "tbd", "N/A", "n/a", "Lorem ipsum dolor sit amet", "reply", "(placeholder)"])
def test_a_placeholder_reply_on_a_change_is_refused(reply):
    exc = refused_by(dc._refuse_a_placeholder_reply, {**GOOD, "reply": reply})
    assert exc is not None, reply
    told = exc.for_model()
    assert "a placeholder, not what the member is told" in told and "a number left standing in for a value" in told


@pytest.mark.parametrize("reply", [
    "Two lines: the low plus the ATR and the high minus it.",
    "I've left a placeholder level at 100 for your entry; change it in the settings.",       # the WORD inside a sentence is a sentence
    "Not applicable to weekly charts: this reads daily bars.",
    "", "   ",                                                                                # an empty reply is left as it was
])
def test_CONTROL_a_sentence_and_an_empty_reply_are_left_alone(reply):
    assert refused_by(dc._refuse_a_placeholder_reply, {**GOOD, "reply": reply}) is None


def test_CONTROL_a_question_with_no_change_is_never_judged_by_its_reply():
    assert refused_by(dc._refuse_a_placeholder_reply, {"ops": [], "reply": "Placeholder"}) is None


# ── at the door ──

def test_THE_FINDING_the_recorded_answer_is_refused_and_the_repair_is_the_answer(conv, clean_env, model):
    answered = {**env(0, copy.deepcopy(THE_ANSWER["answer"]["ops"])), "reply": THE_ANSWER["answer"]["reply"]}
    assert answered["reply"] == "Placeholder"
    client = model([emits(answered), emits(GOOD)])
    r = conv.converse(WORDS, user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["attempts"] == 2 and len(client.calls) == 2, (r.get("gate"), r.get("reason"))
    assert [o["tree"] for o in r["envelope"]["ops"][0]["outputs"]] == [o["tree"] for o in GOOD["ops"][0]["outputs"]]
    # what the model was told between the two: the door's own words about the number standing in
    said = json.dumps(client.calls[1]["messages"])
    assert "reads a plain number, not a value of a bar" in said


def test_an_answer_that_is_refused_twice_changes_nothing(conv, clean_env, model):
    answered = {**env(0, copy.deepcopy(THE_ANSWER["answer"]["ops"])), "reply": "Two lines."}
    client = model([emits(answered), emits(answered)])
    r = conv.converse(WORDS, user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is False and r["gate"] == "envelope:reference" and len(client.calls) == 2
    assert not (r.get("envelope") or {}).get("ops")


def test_each_guard_stands_alone_at_the_door():
    """The recorded answer trips BOTH. Each must refuse without the other: the read of nothing under a real
    sentence, and the placeholder reply over real formulas."""
    only_the_read = created(op("+", call("sessionLow"), wrap("tf", "W", ZERO)), reply="The session low plus the weekly ATR.")
    only_the_reply = {**GOOD, "reply": "Placeholder"}
    for answered, piece in ((only_the_read, "reads a plain number"), (only_the_reply, "a placeholder, not what the member is told")):
        exc = refused_by(dc.check_envelope, answered, 0)
        assert exc is not None and piece in exc.for_model(), piece
    assert refused_by(dc.check_envelope, GOOD, 0) is None              # CONTROL: the right answer passes the whole check


# ── measured: nothing right is refused ──

def test_no_recorded_right_answer_is_refused_by_either_guard():
    right = [c for c in CASES if c["lane"] == "formula" and c.get("recorded_verdict") != "wrong"]
    assert len(right) >= 100
    for case in right:
        answer = case["answer"]
        assert refused_by(dc._refuse_a_scope_read_of_nothing, dc._trees_of(answer)) is None, case["id"]
        assert refused_by(dc._refuse_a_placeholder_reply, {**answer, "reply": "A line."}) is None, case["id"]
    # CONTROL: the recorded WRONG one is refused by both
    wrong = THE_ANSWER["answer"]
    assert refused_by(dc._refuse_a_scope_read_of_nothing, dc._trees_of(wrong)) is not None
    assert refused_by(dc._refuse_a_placeholder_reply, wrong) is not None
    assert THE_ANSWER["recorded_verdict"] == "wrong" and "Placeholder" in THE_ANSWER["defect"]
