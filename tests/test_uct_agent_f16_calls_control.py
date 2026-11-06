"""The owner's narrow exception to F-16, on the server (api/services/uct_agent/flow_calls.py).

The class is an options-flow hidden phrase + Calls + a screen-shaped message. It is decided before E-1, planner v2 and the
manifest. Only the Calls chip may leave, in an envelope built from nothing but the op, and the F-16 sentence stands for every
other outcome. tests/test_uct_agent_w11_repair_b.py is the rest of F-16, unchanged.

`tests/fixtures/f16_flow_calls_v2_request.json` is the REAL body the real panel sent with routing v2 on, captured from the
harness (fixture board, made-up data): it carries widget.setOption and no screener.run.
"""
import json
import re
from pathlib import Path

import pytest

from api.services.uct_agent import flow_calls, turn
from tests.test_uct_agent_w11_repair_b import ALL, _resp, _screen_op, caller_of, env

ROOT = Path(__file__).resolve().parents[1]
GOLDEN = json.loads((ROOT / "app/src/agent/contract/manifest.golden.json").read_text(encoding="utf-8"))
SET_OPTION = next(c for c in GOLDEN["capabilities"] if c["name"] == "widget.setOption")
V2 = json.loads((ROOT / "tests/fixtures/f16_flow_calls_v2_request.json").read_text(encoding="utf-8"))
V2_NAMES = [c["name"] for c in V2["capabilities"]]
CAPS = [*ALL, SET_OPTION]
FLOW = {"id": "of", "type": "optionsflow", "label": "Options Flow"}
NEWS = {"id": "nw", "type": "news", "label": "News"}
BOARD = {"board": [{"ref": "b1", "widgets": [FLOW, NEWS]}]}
NO_FLOW = {"board": [{"ref": "b1", "widgets": [NEWS]}]}
ASK = "only show calls on the options flow"
RESEARCH = {"query": "unusual calls", "recency": "week"}
BOARD_REF = V2["context"]["board"][0]["ref"]


def _chip(widget="of", key="callPut", value="Calls", target="b1", **over):
    return {**env("apply", ops=[{"action": "widget.setOption", "target": target, "args": {"widget": widget, "key": key, "value": value}}]), **over}


def _v2_chip(**over):
    return _chip(widget="w-flow", target=BOARD_REF, **over)


@pytest.fixture(autouse=True)
def no_paid_step(monkeypatch):
    """Research is never reached on this path: reaching it fails the test."""
    def boom(*a, **k):
        raise AssertionError("research reached")
    monkeypatch.setattr(turn, "_research", boom)


def _turn(message, plan, context=BOARD):
    return turn.run_turn(message=message, context=context, history=[], capabilities=CAPS, caller=caller_of(_resp(plan)))


def _v2_turn(message, plan):
    return turn.run_turn(message=message, context=V2["context"], history=[], capabilities=V2["capabilities"], routing=V2["routing"],
                         caller=caller_of(_resp(plan)))


def _refused(out):
    e = out["envelope"]
    assert e["ops"] == [] and e["disposition"] == "answer"
    assert e["reply"].startswith("I didn't run it: UCT Agent can't screen on")
    assert out["usage"]["hidden_phrase"] is True and out["usage"]["research_calls"] == 0
    assert out["usage"]["flow_calls"] in ("chip", "refuse")   # decided by the guard, not by chance
    assert out["usage"]["model_calls"] <= 1


def _served(out):
    e = out["envelope"]
    assert [o["action"] for o in e["ops"]] == ["widget.setOption"] and e["reply"] == ""
    assert not e.get("research") and not e.get("question") and not e.get("need_groups")
    assert out["usage"]["flow_calls_chip"] is True and out["usage"]["model_calls"] == 1 and out["usage"]["research_calls"] == 0
    assert "hidden_phrase" not in out["usage"]


def test_the_fixture_is_the_shape_routing_v2_sends():
    assert flow_calls.WIDGET_NAME in V2["message"] and "widget.setOption" in V2_NAMES and "screener.run" not in V2_NAMES


@pytest.mark.parametrize("message", [ASK, "only calls in the option flow", "just the calls on the options-flow", "filter the options flow to calls",
                                     "show just calls in options flow", "keep only calls on the options flow", "show me only calls on options flow"])
@pytest.mark.parametrize("value", ["Calls", "calls", "C"])
def test_the_chip_alone_is_served_with_no_model_text(message, value):
    _served(_turn(message, _chip(value=value, reply="MODEL PROSE")))
    _served(_v2_turn(message, _v2_chip(value=value, reply="MODEL PROSE")))


def test_a_propose_is_served_the_same_way():
    _served(_turn(ASK, {**_chip(), "disposition": "propose", "reply": "MODEL PROSE"}))


def test_the_compact_op_shape_a_real_response_uses_is_read_too():
    plan = env("apply", ops=[{"action": "widget.setOption", "target": BOARD_REF, "args_json": json.dumps({"widget": "w-flow", "key": "callPut", "value": "Calls"})}])
    _served(_v2_turn(ASK, plan))


@pytest.mark.parametrize("run,plan", [
    (_turn, {**_chip(), "disposition": "answer", "reply": "free prose"}),                      # D1a(i)
    (_turn, {**_chip(), "disposition": "answer", "reply": "free prose", "research": RESEARCH}),  # D1a(ii)
    (_turn, {**_chip(), "disposition": "clarify", "question": {"text": "which?", "choices": []}}),
    (_turn, {**_chip(), "disposition": "unsupported", "unsupported_category": "other"}),
    (_v2_turn, {**_v2_chip(), "disposition": "answer", "reply": "free prose", "research": RESEARCH}),
    (_v2_turn, env("answer", reply="free prose", research=RESEARCH)),                          # D1b: no op at all
    (_v2_turn, env("answer", reply="free prose")),
])
def test_anything_but_a_chip_plan_gets_the_sentence_whatever_the_manifest(run, plan):
    _refused(run(ASK, plan))


@pytest.mark.parametrize("run,plan", [
    (_turn, _chip(reply="MODEL PROSE: the top call is XYZ")),                                  # D1a(iii)
    (_turn, _chip(research=RESEARCH)),                                                         # D1a(iv)
    (_turn, _chip(need_groups=["screener"])),                                                  # D1a(v)
    (_v2_turn, _v2_chip(reply="MODEL PROSE", research=RESEARCH)),
])
def test_a_chip_plan_loses_its_text_research_and_groups(run, plan):
    _served(run(ASK, plan))


def test_a_question_cannot_buy_research_on_this_path():
    # the words that make a change "a mixed request" elsewhere: refused here, before any model call
    out = _turn("only show calls on the options flow and why is NVDA moving", _chip(research=RESEARCH))
    _refused(out)
    assert out["usage"]["model_calls"] == 0


def test_no_model_text_is_streamed_on_this_path():
    events = []

    def stream(feed, **kw):
        feed(json.dumps(_chip(reply="MODEL PROSE")))
        return _resp(_chip(reply="MODEL PROSE"))
    out = turn.run_turn(message=ASK, context=BOARD, history=[], capabilities=CAPS, on_event=events.append, stream_caller=stream)
    _served(out)
    assert [e for e in events if e.get("t") == "delta"] == []


def test_planner_v2_and_the_knowledge_gate_never_see_this_class(monkeypatch):
    from api.services.uct_agent import turn_v2
    from api.services.uct_agent.knowledge import evidence

    def boom(*a, **k):
        raise AssertionError("reached")
    monkeypatch.setattr(turn_v2, "run_turn_v2", boom)
    monkeypatch.setattr(evidence, "active", lambda *a, **k: True)
    monkeypatch.setattr(evidence, "serve", boom)
    plan = _chip(reply="MODEL PROSE")
    _served(turn.run_turn(message=ASK, context=BOARD, history=[], capabilities=CAPS, caller=caller_of(_resp(plan)), v2={"wait_step": None, "turn_token": "t"}))
    out = turn.run_turn(message=f"{ASK} top 10", context=BOARD, history=[], capabilities=CAPS, caller=caller_of(_resp(plan)), v2={"wait_step": None, "turn_token": "t"})
    _refused(out)
    assert out["usage"]["model_calls"] == 0


@pytest.mark.parametrize("plan,context", [
    (_chip(), NO_FLOW), (_chip(widget="nw"), BOARD), (_chip(widget="zz"), BOARD), (_chip(value="Puts"), BOARD), (_chip(value="P"), BOARD), (_chip(value="all"), BOARD),
    (_chip(key="printType", value="SWEEP"), BOARD), (_chip(key="filters", value="opt_net_premium_1d"), BOARD),
    (_screen_op("vol_ratio"), BOARD), (_screen_op("opt_net_premium_1d"), BOARD),
])
def test_any_other_plan_keeps_the_refusal(plan, context):
    _refused(_turn(ASK, plan, context))


def test_a_mixed_plan_keeps_the_refusal():
    both = _chip()
    both["ops"] = [*both["ops"], *_screen_op("vol_ratio")["ops"]]
    _refused(_turn(ASK, both))


#: D2: every hidden phrase must be the widget's own name. D3: anything beyond the chip, as a class: the first five are AUDIT's,
#: the rest are held out, written after the rule and absent from any word list.
MORE_THAN_THE_CHIP = [
    "only show calls on the options flow with bullish premium", "only show calls on the options flow with net premium",
    "only show calls on the options flow and dark pool prints", "only show calls on the options flow with a high rs rank",
    "only show calls on the options flow across the market", "only show calls on the options flow for the whole market",
    "only show calls on the options flow sorted by net premium", "only show calls on the options flow, top 10",
    "only show all unusual calls on the options flow",
    "only show calls on the options flow in tech", "only show calls on the options flow by sector", "only show calls on the options flow over 1m",
    "only show the biggest calls on the options flow", "only show calls on the options flow for nvda and amd", "only show calls on the options flow today",
    "only show expiring calls on the options flow", "only show calls on the options flow ranked by size", "only show the leaders with calls on the options flow",
    "only show stocks with calls on the options flow", "only show calls with bullish premium", "only show calls with dark pool prints",
]


@pytest.mark.parametrize("message", MORE_THAN_THE_CHIP)
def test_more_than_the_chip_is_refused_with_no_model_call(message):
    out = _turn(message, _chip())
    _refused(out)
    assert out["usage"]["model_calls"] == 0


@pytest.mark.parametrize("message", ["only show calls on the options flow", "only calls in the option flow"])
def test_no_flow_widget_on_the_board_is_refused_with_no_model_call(message):
    out = _turn(message, _chip(), NO_FLOW)
    _refused(out)
    assert out["usage"]["model_calls"] == 0


@pytest.mark.parametrize("message", ["remove calls only from the options flow", "clear the calls filter on the options flow", "turn off calls only on the options flow",
                                     "reset the options flow calls filter", "stop showing only calls on the options flow"])
def test_clearing_is_one_fixed_answer(message):
    # D4: the approval names applying Calls Only, so clearing stays the member's: Undo, or the All chip
    out = _turn(message, _chip(value="all"))
    assert out["envelope"]["ops"] == [] and out["envelope"]["reply"] == flow_calls.CALLS_ONLY_SENTENCE
    assert out["usage"]["model_calls"] == 0 and out["usage"]["flow_calls"] == "clear"


@pytest.mark.parametrize("message", ["call up the options flow", "only show margin calls on the options flow", "call the options flow"])
def test_call_as_another_word_is_not_the_chip(message):
    assert flow_calls.classify(message, BOARD, True) is None


def test_a_message_outside_the_class_runs_as_it_did():
    assert flow_calls.classify("how do calls work", BOARD, False) is None
    assert flow_calls.classify("only show puts on the options flow", BOARD, True) is None
    assert flow_calls.classify("filter the options flow widget to calls", BOARD, False) is None   # not screen-shaped


def test_the_browser_holds_the_same_closed_list():
    src = (ROOT / "app/src/agent/capabilities/screener.js").read_text(encoding="utf-8")
    m = re.search(r"FLOW_CHIP_FILLER = new Set\(`(.*?)`", src, re.S)
    assert m and frozenset(m.group(1).split()) == flow_calls.FILLER


def test_no_hidden_field_or_data_comes_with_it():
    sent = json.dumps(_turn(ASK, _chip())["envelope"])
    assert "opt_" not in sent and "dp_" not in sent
