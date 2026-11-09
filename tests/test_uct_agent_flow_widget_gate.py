"""AUDIT S4-A (2026-11-08): the server's F-16 text gate (turn.py, `scan_refine.refusal_for_text` + `hidden_screen_request`)
must not discard a plan of ONLY widget controls. "filter the options flow to sweeps" with an Options Flow widget on the board is
`widget.setOption` on that widget's own chips: no screen runs and no hidden field is read. A hidden-field SCREEN is still refused.

NOT RUN LOCALLY (pl-exec's rules on this PC: no backend, no pytest). Owed to AUDIT / CI.
"""
from __future__ import annotations

import pytest

from api.services.uct_agent import turn
from tests.test_uct_agent import CAPS, CTX, _resp, caller_of, env  # noqa: F401
from tests.test_uct_agent_w11_repair_b import ALL, CTX2, SCREEN  # noqa: F401

SET_OPTION = {"name": "widget.setOption", "domain": "board", "target": "board", "risk": "local", "reversible": True,
              "summary": "Change ONE control of a widget on the board.", "hints": None,
              "args": {"type": "object", "properties": {"widget": {"type": "string"}, "key": {"type": "string"},
                                                        "value": {"type": ["string", "number", "boolean"]}},
                       "required": ["widget", "key", "value"], "additionalProperties": False}}
CAPS_FLOW = ALL + [SET_OPTION]
CTX_FLOW = {**CTX2, "board": [{"ref": "board", "label": "Board", "widgets": [{"id": "of", "type": "optionsflow"}]}]}


@pytest.fixture(autouse=True)
def _no_cost(monkeypatch):
    monkeypatch.setattr(turn, "_record_cost", lambda resp: 0.001)


def test_the_words_are_gated_text_so_the_case_is_real():
    # the message itself trips both checks: without the fix this plan was discarded
    from api.services.uct_agent.scan import refine
    msg = "filter the options flow to sweeps"
    assert refine.refusal_for_text(msg) is not None and turn.hidden_screen_request(msg) is True


def test_a_widget_setOption_plan_on_the_options_flow_is_kept():
    plan = env("apply", ops=[{"action": "widget.setOption", "target": "board", "args": {"widget": "of", "key": "printType", "value": "SWEEP"}}])
    c = caller_of(_resp(plan))
    out = turn.run_turn(message="filter the options flow to sweeps", context=CTX_FLOW, history=[], capabilities=CAPS_FLOW, caller=c)
    e = out["envelope"]
    assert not str(e.get("reply") or "").startswith("I didn't run it")
    assert [o["action"] for o in e["ops"]] == ["widget.setOption"]
    assert out["usage"].get("hidden_phrase") is not True


def test_a_hidden_field_screen_is_still_refused():
    screen = env("apply", ops=[{"action": "screener.run", "target": "screener",
                                "args": {"filters": [{"field": "chg_pct_3m", "op": "gt", "value": 0, "max": None, "values": None}],
                                         "sort_field": None, "sort_dir": None, "mode": "refine", "show": None, "as": None, "within": None}}])
    c = caller_of(_resp(screen))
    out = turn.run_turn(message="only show stocks with bullish options flow", context=CTX_FLOW, history=[], capabilities=CAPS_FLOW, caller=c)
    assert out["envelope"]["ops"] == [] and out["envelope"]["reply"].startswith("I didn't run it:")
    assert out["usage"]["hidden_phrase"] is True


def test_a_mixed_plan_with_any_screener_op_is_still_refused():
    mixed = env("apply", ops=[{"action": "widget.setOption", "target": "board", "args": {"widget": "of", "key": "printType", "value": "SWEEP"}},
                              {"action": "screener.run", "target": "screener",
                               "args": {"filters": [], "sort_field": None, "sort_dir": None, "mode": "refine", "show": None, "as": None, "within": None}}])
    c = caller_of(_resp(mixed))
    out = turn.run_turn(message="filter the options flow to sweeps", context=CTX_FLOW, history=[], capabilities=CAPS_FLOW, caller=c)
    assert out["envelope"]["ops"] == [] and out["envelope"]["reply"].startswith("I didn't run it:")
