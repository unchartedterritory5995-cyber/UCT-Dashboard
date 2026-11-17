"""A bars-back count compared with a negative number is refused at the door, with the convention.

Found by the house set's value check, 2026-11-16. Asked for a follow-through day "from day 4
through day 12 after the lowest low of the last 50 sessions", the model wrote TradingView's
convention: ``lowestbars(low, 50) >= -11 && lowestbars(low, 50) <= -3``. Here the count is 0 or
more, so the indicator built, read back plausibly, and fired on 0 of 700 bars on two symbols.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    conv, emits, empty_view, env, model,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

LOW = {"type": "series", "name": "low"}
CLOSE = {"type": "series", "name": "close"}
num = lambda v: {"type": "num", "value": v}  # noqa: E731
neg = lambda v: {"type": "op", "name": "u-", "args": [num(v)]}  # noqa: E731
call = lambda name, *a: {"type": "call", "name": name, "args": list(a)}  # noqa: E731
op = lambda name, *a: {"type": "op", "name": name, "args": list(a)}  # noqa: E731

LB = call("lowestbars", LOW, num(50))
PINE_WAY = op("&&", op(">=", LB, neg(11)), op("<=", LB, neg(3)))
NEG_LB = op("u-", LB)
OUR_WAY = op("&&", op(">=", LB, num(3)), op("<=", LB, num(11)))
create = lambda tree: env(0, [{"op": "create", "name": "FTD window", "outputs": [{"key": "ftd", "tree": tree}]}])  # noqa: E731
EMPTY = lambda: empty_view(0)  # noqa: E731


def test_the_negative_form_costs_the_repair_and_the_note_states_the_convention(conv, clean_env, model):
    client = model([emits(create(PINE_WAY)), emits(create(OUR_WAY))])
    r = conv.converse("mark day 4 to 12 after the 50 day low", user_id="u1", view=EMPTY())
    assert r["ok"] is True and r["attempts"] == 2
    note = client.calls[1]["messages"][-1]["content"][0]["content"]
    assert note.startswith("[envelope:reference]")
    assert "lowestbars" in note and "never negative" in note and ">= 3" in note


def test_twice_negative_is_refused_and_never_reaches_the_browser(conv, clean_env, model):
    model([emits(create(PINE_WAY)), emits(create(PINE_WAY))])
    r = conv.converse("mark day 4 to 12 after the 50 day low", user_id="u1", view=EMPTY())
    assert r["ok"] is False and r["gate"] == "envelope:reference"


def test_each_shape_of_the_mistake_is_seen(conv, clean_env, model):
    shapes = [
        op("<=", LB, num(-3)),                                           # a plain negative literal
        op(">", neg(5), call("highestbars", {"type": "series", "name": "high"}, num(20))),   # the call on the right
        op("==", call("barssince", op(">", CLOSE, num(1)), num(30)), neg(1)),
        # the same belief, negated: what the model wrote when told "3 to 11 bars ago"
        op("&&", op(">=", NEG_LB, num(3)), op("<=", NEG_LB, num(11))),
        op("<", num(2), NEG_LB),
    ]
    for tree in shapes:
        model([emits(create(tree)), emits(create(tree))])
        r = conv.converse("x", user_id="u1", view=EMPTY())
        assert r["ok"] is False and r["gate"] == "envelope:reference", tree


def test_CONTROL_the_positive_form_and_other_negatives_pass_first_time(conv, clean_env, model):
    fine = [
        OUR_WAY,
        op(">=", LB, num(0)),                                            # zero is a real answer: this bar
        op("<=", NEG_LB, neg(3)),                                        # consistent: a pasted script's form
        op(">=", NEG_LB, num(0)),                                        # zero has no sign
        op("<", op("-", CLOSE, call("sma", CLOSE, num(50))), neg(2)),    # a negative beside something else
        op(">", call("rsi", CLOSE, num(14)), neg(5)),
    ]
    for tree in fine:
        model([emits(create(tree))])
        r = conv.converse("x", user_id="u1", view=EMPTY())
        assert r["ok"] is True and r["attempts"] == 1, (tree, r.get("gate"))


def test_the_prompt_states_the_convention_up_front():
    from api.services import definition_conversation as dcv
    text = dcv.system_prompt()
    assert "A count of bars is never negative here" in text
    for name in ("highestbars", "lowestbars", "barssince"):
        assert f"`{name}`" in text
