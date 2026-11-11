"""F-16 widened by the owner (2026-11-10): every Options Flow widget chip, on the server. turn.py refuses a screen-shaped
message that names a hidden field AFTER the model answers; `plans_only_flow_chips` lets through exactly a plan of
widget.setOption ops that set the widget's own chip groups (minPremium / callPut / printType / direction) to chips it has, on
an Options Flow widget on this turn's own board, for a message that names the widget and a chip. Everything else keeps the
refusal (tests/test_uct_agent_f16_calls_control.py, tests/test_uct_agent_w11_repair_b.py).
"""
import json
from pathlib import Path

import pytest

from tests.test_uct_agent_f16_calls_control import BOARD, NO_FLOW, _control, _refused, _turn
from tests.test_uct_agent_w11_repair_b import _screen_op

GOLDEN = json.loads((Path(__file__).resolve().parents[1] / "app/src/agent/contract/manifest.golden.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("message,ops", [
    ("only sweeps in the options flow", [("printType", "Sweep")]),
    ("block trades only on the options flow", [("printType", "BLOCK")]),
    ("show me the bearish options flow", [("direction", "Bear")]),
    ("options flow, bull side only", [("direction", "BULL")]),
    ("only puts in the options flow widget", [("callPut", "Puts")]),
    ("options flow prints over a million in premium", [("minPremium", "$1M")]),
    ("only 500k and up on the options flow", [("minPremium", 500000)]),
    ("bullish call sweeps on the options flow", [("callPut", "Calls"), ("printType", "Sweep"), ("direction", "Bull")]),
    ("clear the options flow chips back to all calls and puts", [("callPut", "All")]),
])
def test_every_chip_of_a_flow_widget_on_this_board_is_served(message, ops):
    plan = _control()
    plan["ops"] = [{"action": "widget.setOption", "target": "b1", "args": {"widget": "of", "key": k, "value": v}} for k, v in ops]
    out = _turn(message, plan)
    assert [o["args"]["key"] for o in out["envelope"]["ops"]] == [k for k, _ in ops]
    assert "hidden_phrase" not in out["usage"]
    sent = json.dumps(out["envelope"])
    assert "opt_" not in sent and "dp_" not in sent


@pytest.mark.parametrize("plan,context,why", [
    (_control(key="printType", value="SWEEP"), NO_FLOW, "no flow widget on the board"),
    (_control(widget="nw", key="printType", value="SWEEP"), BOARD, "another widget"),
    (_control(key="printType", value="ML"), BOARD, "a print type no chip has"),
    (_control(key="minPremium", value=2000000), BOARD, "a premium no chip has"),
    (_control(key="darkPool", value="on"), BOARD, "an invented filter"),
    (_screen_op("opt_net_premium_1d"), BOARD, "a hidden field screen"),
])
def test_anything_but_a_chip_keeps_the_refusal(plan, context, why):
    _refused(_turn("only sweeps in the options flow", plan, context))


def test_a_mixed_chip_and_screen_plan_keeps_the_refusal():
    both = _control(key="printType", value="Sweep")
    both["ops"] = [*both["ops"], *_screen_op("vol_ratio")["ops"]]
    _refused(_turn("only sweeps in the options flow", both))


@pytest.mark.parametrize("message", [
    "only show stocks with sweeps on the options flow",   # a universe of stocks
    "only show sweeps with dark pool prints",            # the hidden phrase is not the widget's name
    "only show balls on the options flow",               # no chip word
])
def test_a_message_that_is_not_a_chip_request_keeps_the_refusal(message):
    _refused(_turn(message, _control(key="printType", value="Sweep")))


# ── AUDIT #1029 (2): a plan that MIXES flow-chip ops with ANY other op keeps the refusal. Every capability in the golden
# manifest, before and after the chip op, and every widget.setOption that is not a chip of a flow widget on this board. The
# exception reads the raw planned ops (before validation), so an action no manifest has is refused the same way. ──
_ALL_ACTIONS = sorted({c["name"] for c in GOLDEN["capabilities"]} - {"widget.setOption"} | {"made.up", ""})
_CHIP = {"action": "widget.setOption", "target": "b1", "args": {"widget": "of", "key": "printType", "value": "Sweep"}}
_NOT_A_CHIP = {
    "another widget": {"action": "widget.setOption", "target": "b1", "args": {"widget": "nw", "key": "printType", "value": "Sweep"}},
    "a widget not on this board": {"action": "widget.setOption", "target": "b1", "args": {"widget": "zz", "key": "callPut", "value": "C"}},
    "a control that is no chip": {"action": "widget.setOption", "target": "b1", "args": {"widget": "of", "key": "lead", "value": "x"}},
    "a value no chip has": {"action": "widget.setOption", "target": "b1", "args": {"widget": "of", "key": "callPut", "value": "Straddles"}},
    "no args": {"action": "widget.setOption", "target": "b1"},
    "args not an object": {"action": "widget.setOption", "target": "b1", "args": ["of", "callPut", "C"]},
    "not an op": "widget.setOption",
}


def _mixed(other, first):
    plan = _control()
    plan["ops"] = [other, _CHIP] if first else [_CHIP, other]
    return plan


@pytest.mark.parametrize("first", [True, False], ids=["other-first", "chip-first"])
@pytest.mark.parametrize("action", _ALL_ACTIONS)
def test_a_chip_op_mixed_with_any_other_action_keeps_the_refusal(action, first):
    _refused(_turn("only sweeps in the options flow", _mixed({"action": action, "target": "b1", "args": {}}, first)))


@pytest.mark.parametrize("first", [True, False], ids=["other-first", "chip-first"])
@pytest.mark.parametrize("why", sorted(_NOT_A_CHIP))
def test_a_chip_op_mixed_with_a_set_option_that_is_no_chip_keeps_the_refusal(why, first):
    _refused(_turn("only sweeps in the options flow", _mixed(_NOT_A_CHIP[why], first)))


def test_two_chip_ops_alone_are_served_the_control_for_the_mixed_cases():
    plan = _control()
    plan["ops"] = [_CHIP, {"action": "widget.setOption", "target": "b1", "args": {"widget": "of", "key": "direction", "value": "Bull"}}]
    out = _turn("only bullish sweeps in the options flow", plan)
    assert [o["args"]["key"] for o in out["envelope"]["ops"]] == ["printType", "direction"]
    assert "hidden_phrase" not in out["usage"]
