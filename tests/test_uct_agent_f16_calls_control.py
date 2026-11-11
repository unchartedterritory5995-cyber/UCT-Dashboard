"""The owner's narrow exception to F-16, on the server: the browser's fast path is only half of the claim.

turn.py refuses a screen-shaped message that names a hidden field AFTER the model answers, whatever it planned. Without
this exception "only show calls on the options flow" would be dropped here even when the model planned the widget's own
Calls chip. The exception holds only for that plan on a flow widget in this turn's own board, and every other F-16 path
keeps its refusal: tests/test_uct_agent_w11_repair_b.py stays as it was. Widened 2026-11-10 to every chip:
tests/test_uct_agent_f16_flow_chips.py.
"""
import json
from pathlib import Path

import pytest

from api.services.uct_agent import turn
from tests.test_uct_agent_w11_repair_b import ALL, _resp, _screen_op, caller_of, env

GOLDEN = json.loads((Path(__file__).resolve().parents[1] / "app/src/agent/contract/manifest.golden.json").read_text(encoding="utf-8"))
SET_OPTION = next(c for c in GOLDEN["capabilities"] if c["name"] == "widget.setOption")
CAPS = [*ALL, SET_OPTION]
FLOW = {"id": "of", "type": "optionsflow", "label": "Options Flow"}
NEWS = {"id": "nw", "type": "news", "label": "News"}
BOARD = {"board": [{"ref": "b1", "widgets": [FLOW, NEWS]}]}
NO_FLOW = {"board": [{"ref": "b1", "widgets": [NEWS]}]}
ASK = "only show calls on the options flow"


def _control(widget="of", key="callPut", value="Calls"):
    return env("apply", ops=[{"action": "widget.setOption", "target": "b1", "args": {"widget": widget, "key": key, "value": value}}])


def _turn(message, plan, context=BOARD):
    return turn.run_turn(message=message, context=context, history=[], capabilities=CAPS, caller=caller_of(_resp(plan)))


def _refused(out):
    assert out["envelope"]["ops"] == []
    assert out["envelope"]["reply"].startswith("I didn't run it: UCT Agent can't screen on")
    assert out["usage"]["hidden_phrase"] is True


@pytest.mark.parametrize("message", [ASK, "only calls in the option flow", "just the calls on the options-flow", "filter the options flow to calls"])
@pytest.mark.parametrize("value", ["Calls", "calls", "C"])
def test_the_calls_chip_on_a_flow_widget_on_this_board_is_served(message, value):
    out = _turn(message, _control(value=value))
    assert [o["action"] for o in out["envelope"]["ops"]] == ["widget.setOption"]
    assert out["envelope"]["ops"][0]["args"] == {"widget": "of", "key": "callPut", "value": value}
    assert "hidden_phrase" not in out["usage"]


def test_no_hidden_field_or_data_comes_with_it():
    sent = json.dumps(_turn(ASK, _control())["envelope"])
    assert "opt_" not in sent and "dp_" not in sent


@pytest.mark.parametrize("plan,context,why", [
    (_control(), NO_FLOW, "no flow widget on the board"),
    (_control(widget="nw"), BOARD, "another widget"),
    (_control(widget="zz"), BOARD, "a widget not on this board"),
    (_control(key="filters", value="opt_net_premium_1d"), BOARD, "a hidden field as a value"),
    (_control(key="lead", value="sentiment"), BOARD, "a control that is no filter chip"),
    (_control(value="Straddles"), BOARD, "a value no chip has"),
    (env("answer", reply="Calls are up today."), BOARD, "prose"),
    (_screen_op("vol_ratio"), BOARD, "a public look-alike screen"),
    (_screen_op("opt_net_premium_1d"), BOARD, "a hidden field screen"),
])
def test_anything_else_keeps_the_refusal(plan, context, why):
    _refused(_turn(ASK, plan, context))


def test_a_mixed_plan_keeps_the_refusal():
    both = _control()
    both["ops"] = [*both["ops"], *_screen_op("vol_ratio")["ops"]]
    _refused(_turn(ASK, both))


@pytest.mark.parametrize("message", [
    "only show stocks with calls on the options flow",     # a universe of stocks
    "only show calls with dark pool prints",               # the hidden phrase is not the widget's name
    "only show calls with bullish premium",
    "only show calls with a high rs rank",
    "only show balls on the options flow",                 # not the word on the chip
])
def test_a_message_that_is_not_that_request_keeps_the_refusal_even_with_the_right_plan(message):
    _refused(_turn(message, _control()))
