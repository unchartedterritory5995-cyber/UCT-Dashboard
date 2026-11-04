"""Brain response handling (owner, 2026-11-03, before activation). Planner v1 writes `reply` BEFORE anything is read,
so a plan holding ANY knowledge read (playbook.*) never serves it: UCT's grounded, cited knowledge card is the answer.

Decision for a MIXED write + playbook plan: the model's reply is dropped as well. Free text cannot be checked for a
definition the knowledge base never gave; the write's own receipt confirms the change and the card gives the knowledge.
A knowledge plan is never researched in the same turn; UCT's fixed sentence (turn.KNOWLEDGE_NO_WEB) says so.
Planner v2 (read first, then answer) is unchanged. Scripted models only: no network, no cost.
"""
from __future__ import annotations

import json
import types

import pytest

from api.services.uct_agent import turn
from tests.test_uct_agent import CAPS, CTX, OP, _resp, caller_of, env  # noqa: F401

Q = {"type": "object", "properties": {"question": {"type": "string"}}, "required": ["question"], "additionalProperties": False}
S = {"type": "object", "properties": {"setup": {"type": "string"}}, "required": ["setup"], "additionalProperties": False}


def _kcap(name, args):
    return {"name": name, "domain": "playbook", "target": "playbook", "summary": name, "hints": None, "risk": "local",
            "reversible": True, "undo": "none", "query": True, "args": args}


KCAPS = [_kcap("playbook.explain", Q), _kcap("playbook.setup", S), _kcap("playbook.record", S)]
ALL = CAPS + KCAPS
KCTX = {**CTX, "playbook": [{"ref": "playbook", "label": "UCT's trading playbook"}]}
SETUP_OP = {"action": "playbook.setup", "target": "playbook", "args": {"setup": "EP"}}
EXPLAIN_OP = {"action": "playbook.explain", "target": "playbook", "args": {"question": "what is an EP"}}
RECORD_OP = {"action": "playbook.record", "target": "playbook", "args": {"setup": "EP"}}
INVENTED = "An EP is a 10% gap on earnings; UCT enters at the open with a 3% stop and wins 72% of the time."


@pytest.fixture(autouse=True)
def _no_cost(monkeypatch):
    monkeypatch.setattr(turn, "_record_cost", lambda resp: 0.001)


@pytest.fixture
def outbound(monkeypatch):
    sent = []
    monkeypatch.setattr(turn, "_research", lambda q, r: (sent.append(q), {"answer": "web text", "citations": ["https://x"]})[1])
    return sent


def _run(message, envelope, interpreter=None):
    return turn.run_turn(message=message, context=KCTX, history=[], capabilities=ALL, caller=caller_of(_resp(envelope)),
                         interpreter=interpreter)


@pytest.mark.parametrize("interpreter", [None, "nl1"])
@pytest.mark.parametrize("op", [SETUP_OP, EXPLAIN_OP, RECORD_OP])
def test_v1_a_knowledge_plan_never_serves_the_models_invented_definition(op, interpreter):
    out = _run("what is an EP", env("apply", [op], reply=INVENTED), interpreter)["envelope"]
    assert out["disposition"] == "apply"
    assert [o["action"] for o in out["ops"]] == [op["action"]]           # the grounded card's read still runs
    assert out["reply"] == ""
    for s in ("10%", "3%", "72%", "gap on earnings"):
        assert s not in json.dumps(out)


def test_v1_a_mixed_write_and_knowledge_plan_keeps_the_write_but_drops_the_reply():
    out = _run("make it bars and what is an EP", env("apply", [OP, SETUP_OP], reply=f"Done. {INVENTED}"))["envelope"]
    assert [o["action"] for o in out["ops"]] == ["chart.setType", "playbook.setup"]
    assert out["reply"] == ""                                              # documented decision (module docstring)


def test_v1_a_knowledge_plan_is_not_researched_and_says_so(outbound):
    e = env("apply", [SETUP_OP], reply=INVENTED, research={"query": "episodic pivot definition", "recency": "any"})
    res = _run("what is an EP and what is the news on it?", e)
    assert outbound == []                                                  # no web request at all
    assert res["usage"].get("research_skipped") == "knowledge_plan"
    assert res["envelope"]["reply"] == turn.KNOWLEDGE_NO_WEB
    assert [o["action"] for o in res["envelope"]["ops"]] == ["playbook.setup"]


def test_v1_the_rule_is_decided_by_action_name_in_the_server_gate():
    for o in (SETUP_OP, EXPLAIN_OP):
        assert turn.sanitize_envelope(env("apply", [o], reply=INVENTED), {"playbook"})["reply"] == ""
        # even a post-research ("grounded") reply never rides beside UCT's knowledge
        assert turn.sanitize_envelope(env("apply", [o], reply="Per the web, it is a gap."), {"playbook"},
                                      grounded=True)["reply"] == ""
    # an op whose ARGUMENT is named like a knowledge action is not one
    o = {"action": "chart.setType", "target": "c1", "args": {"type": "bars", "name": "playbook.setup"}}
    assert turn.sanitize_envelope(env("apply", [o], reply="A bar chart shows open, high, low and close."), {"c1"})["reply"] == "A bar chart shows open, high, low and close."


def test_flag_off_parity_a_plain_answer_and_a_write_are_unchanged():
    out = turn.run_turn(message="make it bars", context=CTX, history=[], capabilities=CAPS,
                        caller=caller_of(_resp(env("apply", [OP], reply="A bar chart shows open, high, low and close."))))["envelope"]
    assert out["reply"] == "A bar chart shows open, high, low and close." and out["ops"]
    out = turn.run_turn(message="what is an EP", context=CTX, history=[], capabilities=CAPS,
                        caller=caller_of(_resp(env("answer", reply="An EP is an episodic pivot."))))["envelope"]
    assert out["reply"] == "An EP is an episodic pivot."                  # flag off: no knowledge op exists to trigger it


def test_flag_off_parity_a_playbook_op_is_still_an_unknown_action():
    with pytest.raises(turn.TurnError):
        turn.run_turn(message="what is an EP", context=KCTX, history=[], capabilities=CAPS,
                      caller=caller_of(_resp(env("apply", [SETUP_OP], reply=INVENTED))))


def test_flag_off_research_is_unchanged(outbound):
    e = env("answer", reply="x", research={"query": "why is NVDA moving kn-grounded-reply-uniq", "recency": "day"})
    c = caller_of(_resp(e), _resp(env("answer", reply="NVDA rose on earnings.")))
    res = turn.run_turn(message="why is NVDA moving today", context=CTX, history=[], capabilities=CAPS, caller=c)
    assert outbound == ["why is NVDA moving kn-grounded-reply-uniq"]
    assert res["envelope"]["reply"] == "NVDA rose on earnings."


def _model_reply(blocks, stop):
    return types.SimpleNamespace(content=list(blocks), stop_reason=stop, usage=types.SimpleNamespace(
        input_tokens=10, output_tokens=5, cache_read_input_tokens=0, cache_creation_input_tokens=0))


def test_v2_is_unchanged_it_reads_first_then_answers_from_the_framed_result(monkeypatch):
    from api.services.uct_agent import turn_v2 as v2
    monkeypatch.setenv(v2.PLANNER_ENV, "v2")
    monkeypatch.setattr(turn, "sanitize_envelope", lambda *a, **k: pytest.fail("v2 never passes the v1 gate"))
    final = "Per UCT's playbook (UCT KB #2), an EP is a gap on a fresh catalyst."
    script = [_model_reply([types.SimpleNamespace(type="tool_use", id="k1", name="playbook__setup",
                                                  input={"target": "playbook", "args": {"setup": "EP"}})], "tool_use"),
              _model_reply([types.SimpleNamespace(type="text", text=final)], "end_turn")]
    calls = []

    def caller(**kw):
        calls.append(kw)
        return script[len(calls) - 1]

    class M:
        def call(self, category, fn, **kw):
            return fn(**kw)

        def calls_left(self):
            return 5

        def research(self, fn):
            return fn()
    waits = iter([{"status": "query", "result": "From UCT's playbook: Episodic Pivot, a gap on a fresh catalyst."}])
    out = v2.run_turn_v2(message="what is an EP", context=KCTX, history=[], capabilities=KCAPS, caller=caller, meter=M(),
                         on_event=None, wait_step=lambda sid: {"id": sid, **next(waits)})
    assert out["envelope"]["planner"] == "v2" and out["envelope"]["reply"] == final
    seen = calls[1]["messages"][-1]["content"][0]["content"]
    assert "<uct_knowledge>" in seen and "a gap on a fresh catalyst" in seen   # the answer was written AFTER the read
