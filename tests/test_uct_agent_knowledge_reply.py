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

LONG = INVENTED + " It is UCT's favourite setup and the team trades it every season, sized at full risk."

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
    monkeypatch.setenv("UCT_AGENT_KNOWLEDGE", "1")   # #775 knowledge_gate: v2 offers playbook.* only with the KN flag on
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


# ── review #768: knowledge first (talk dispositions, plain answers, clarify, streaming) ─────────────────────────────
def _stream_run(message, envelope, capabilities=ALL, context=KCTX):
    events, resp = [], _resp(envelope)

    def stream_caller(feed, **kw):
        feed(resp.content[0].text)
        return resp
    out = turn.run_turn(message=message, context=context, history=[], capabilities=capabilities,
                        caller=caller_of(resp), on_event=events.append, stream_caller=stream_caller)
    return out, events


def _streamed_text(events):
    """What the member saw streamed and never retracted."""
    shown = ""
    for e in events:
        if e.get("t") == "delta":
            shown += e.get("text") or ""
        elif e.get("t") == "retract":
            shown = ""
    return shown


@pytest.mark.parametrize("interpreter", [None, "nl1"])
@pytest.mark.parametrize("disp", ["answer", "clarify"])
def test_r768_a_talk_disposition_holding_a_knowledge_op_is_that_read_never_the_invented_text(disp, interpreter):
    q = {"text": INVENTED, "choices": []} if disp == "clarify" else None
    e = {**env(disp, [SETUP_OP, OP], reply=INVENTED), "question": q}
    out = _run("tell me more about it", e, interpreter)["envelope"]
    assert out["disposition"] == "apply" and [o["action"] for o in out["ops"]] == ["playbook.setup"]   # TALK never writes
    assert out["reply"] == "" and "10%" not in json.dumps(out)


def test_r768_the_gate_alone_promotes_a_talk_reply_holding_a_knowledge_op():
    out = turn.sanitize_envelope(env("answer", [SETUP_OP, OP], reply=INVENTED), {"playbook", "c1"})
    assert out["disposition"] == "apply" and [o["action"] for o in out["ops"]] == ["playbook.setup"] and out["reply"] == ""


def test_r768_a_streamed_answer_with_a_knowledge_op_is_retracted():
    out, events = _stream_run("tell me more about it", env("answer", [SETUP_OP], reply=LONG))
    assert not any(e.get("t") == "delta" for e in events)                     # knowledge on: an answer never streams ...
    assert out["envelope"]["reply"] == "" and _streamed_text(events) == ""    # ... and it was taken back


@pytest.mark.parametrize("interpreter", [None, "nl1"])
@pytest.mark.parametrize("message", ["what is a VCP?", "What are the rules for an episodic pivot",
                                     "define a high tight flag", "how does the team trade a kicker?"])
def test_r768_a_plain_answer_to_a_playbook_question_becomes_uct_s_cited_read(message, interpreter):
    res = _run(message, env("answer", reply=INVENTED), interpreter)
    out = res["envelope"]
    assert out["disposition"] == "apply" and out["reply"] == ""
    assert [o["action"] for o in out["ops"]] == ["playbook.explain"] and out["ops"][0]["target"] == "playbook"
    assert out["ops"][0]["args"]["question"] == message
    assert res["usage"]["knowledge_first"] == "knowledge_turn:read"
    assert "10%" not in json.dumps(out)


def test_r768_a_playbook_question_never_streams_the_models_reply():
    out, events = _stream_run("what is a VCP?", env("answer", reply=LONG))
    assert not any(e.get("t") == "delta" for e in events)
    assert out["envelope"]["ops"][0]["action"] == "playbook.explain" and out["envelope"]["reply"] == ""


def test_r768_without_the_explain_read_the_answer_is_uct_s_fixed_sentence():
    caps = CAPS + [_kcap("playbook.setup", S)]
    out = turn.run_turn(message="what is a VCP?", context=KCTX, history=[], capabilities=caps,
                        caller=caller_of(_resp(env("answer", reply=INVENTED))))["envelope"]
    assert out["disposition"] == "answer" and out["reply"] == turn.KNOWLEDGE_NOT_RETRIEVED and out["ops"] == []


def test_r768_a_playbook_question_researched_by_the_model_is_read_from_uct_not_the_web(outbound):
    e = env("answer", reply=INVENTED, research={"query": "vcp definition", "recency": "any"})
    res = _run("what is a VCP?", e)
    assert outbound == [] and res["envelope"]["ops"][0]["action"] == "playbook.explain"
    assert res["envelope"]["reply"] in ("", turn.KNOWLEDGE_NO_WEB)


def test_r768_a_clarify_on_a_playbook_question_keeps_its_choices_never_its_text():
    q = {"text": "Do you mean the VCP, a 3-contraction base with a 5% stop?", "choices": ["VCP", "Flat base"]}
    out = _run("what is that base?", {**env("clarify", reply="A VCP is a base."), "question": q})["envelope"]
    assert out["disposition"] == "clarify" and out["reply"] == ""
    assert out["question"]["text"] == turn.KNOWLEDGE_CLARIFY and out["question"]["choices"] == ["VCP", "Flat base"]


def test_r768_a_change_with_a_playbook_question_keeps_the_change_and_adds_the_read():
    out = _run("make it bars and what is a VCP?", env("apply", [OP], reply="Switching to bars. A VCP is a 3-contraction base."))["envelope"]
    assert [o["action"] for o in out["ops"]] == ["chart.setType", "playbook.explain"]   # the chart change is kept
    assert out["reply"] == ""                                                         # its receipt confirms it


def test_r768_a_knowledge_read_beside_a_local_only_lookup_says_the_local_notice():
    caps = ALL + [{"name": "breadth.show", "domain": "breadth", "target": "market", "summary": "breadth", "hints": None,
                   "risk": "local", "reversible": True, "undo": "none", "query": True, "localOnly": True,
                   "args": {"type": "object", "properties": {}, "additionalProperties": False}}]
    ctx = {**KCTX, "market": [{"ref": "market", "label": "Market"}]}
    o = {"action": "breadth.show", "target": "market", "args": {}}
    out = turn.sanitize_envelope(env("apply", [SETUP_OP, o], reply=INVENTED), {"playbook", "market"},
                                 local_notice="UCT notice.", knowledge_no_web=True)
    assert out["reply"] == "UCT notice." and out.get("local_notice") is True                 # the local notice wins
    out = turn.sanitize_envelope(env("apply", [SETUP_OP, o], reply=INVENTED), {"playbook", "market"}, knowledge_no_web=True)
    assert out["reply"] == ""                                                                 # never the model's words
    assert caps and ctx


def test_r768_flag_off_a_playbook_question_is_answered_and_streamed_as_before():
    out, events = _stream_run("what is a VCP?", env("answer", reply="A VCP is a volatility contraction pattern. It forms as a stock tightens through successive pullbacks, each smaller than the last, on falling volume, before a breakout."),
                              capabilities=CAPS, context=CTX)
    assert out["envelope"]["reply"] == "A VCP is a volatility contraction pattern. It forms as a stock tightens through successive pullbacks, each smaller than the last, on falling volume, before a breakout." and out["envelope"]["ops"] == []
    assert "knowledge_first" not in out["usage"]
    assert _streamed_text(events) == "A VCP is a volatility contraction pattern. It forms as a stock tightens through successive pullbacks, each smaller than the last, on falling volume, before a breakout."                # streamed exactly as before


def test_r768_a_non_playbook_question_with_the_flag_on_is_unchanged():
    out = _run("what time does the market open?", env("answer", reply="9:30 ET."))
    assert out["envelope"]["reply"] == "9:30 ET." and "knowledge_first" not in out["usage"]


def test_r768_the_servers_playbook_words_are_the_browsers():
    from pathlib import Path
    from api.services.uct_agent.knowledge import frame
    js = (Path(__file__).resolve().parents[1] / "app" / "src" / "agent" / "capabilities" / "knowledge.js").read_text(encoding="utf-8")
    for w in frame._WORDS:
        assert f"/{w.pattern}/" in js, w.pattern
    assert f"/{frame._COACHING}/" in js
    assert not frame.wants_knowledge("teach me what a VCP is") and frame.wants_knowledge("What is a VCP?")


# ── review #768 delta: the output decides, clarify choices, flag-off identity, symbol questions, proposals ──────────
@pytest.mark.parametrize("message", ["What are the" + chr(10) + "rules for a VCP?", "Explain" + chr(10) + "VCP", "define" + chr(10) + chr(10) + "an EP"])
def test_r768d_line_breaks_never_hide_a_playbook_question(message):
    res = _run(message, env("answer", reply=LONG))
    out = res["envelope"]
    assert [o["action"] for o in out["ops"]] == ["playbook.explain"] and out["reply"] == "", message
    assert "10%" not in json.dumps(out)


def test_r768d_an_answer_never_streams_while_knowledge_is_on():
    out, events = _stream_run("what time does the market open?", env("answer", reply=LONG.replace("EP", "open")))
    assert not any(e.get("t") == "delta" for e in events)


def test_r768d_a_knowledge_clarify_keeps_only_short_plain_choices():
    q = {"text": "Which one?", "choices": ["VCP", "A VCP is a 3-contraction base with a 5% stop", "Flat base: buy the pivot",
                                           "Cup with Handle"]}
    out = _run("what is that base?", {**env("clarify"), "question": q})["envelope"]
    assert out["question"]["choices"] == ["VCP", "Cup with Handle"] and out["question"]["text"] == turn.KNOWLEDGE_CLARIFY
    q = {"text": "Which one?", "choices": ["A VCP is a 3-contraction base", "Flat base: buy the pivot"]}
    out = _run("what is that base?", {**env("clarify"), "question": q})["envelope"]
    assert out["disposition"] == "apply" and out["ops"][0]["action"] == "playbook.explain"   # nothing left: the read


def test_r768d_flag_off_a_talk_reply_with_a_stray_playbook_op_is_served_as_before():
    out = turn.run_turn(message="what is an EP", context=CTX, history=[], capabilities=CAPS,
                        caller=caller_of(_resp(env("answer", [SETUP_OP], reply="An EP is an episodic pivot."))))["envelope"]
    assert out["disposition"] == "answer" and out["ops"] == [] and out["reply"] == "An EP is an episodic pivot."


@pytest.mark.parametrize("message,reply", [
    ("what is the breakout level on NVDA", "NVDA's breakout level is near its prior high."),
    ("what are the pivots on this chart", "The pivots are at the two prior swing highs."),
])
def test_r768d_a_question_about_a_stock_or_chart_is_not_a_playbook_question(message, reply):
    res = _run(message, env("answer", reply=reply))
    assert res["envelope"]["reply"] == reply and res["envelope"]["ops"] == [] and "knowledge_first" not in res["usage"]


def test_r768d_a_proposal_never_gets_a_knowledge_read_behind_its_card():
    out = _run("what is a VCP, and set things up for trading one", env("propose", [OP], reply="A VCP trader likes bars; a VCP is a base."))["envelope"]
    assert [o["action"] for o in out["ops"]] == ["chart.setType"] and out["reply"] == ""


def test_r768d_the_word_list_is_not_the_guarantee_brain_stays_off_until_evidence_routing():
    """Owner 2026-11-04: v1's gates are defence in depth. Phrasings the words miss are answered by the model, which is
    why Brain stays OFF until the evidence step (docs/agent/knowledge/EVIDENCE-ROUTING-DESIGN.md) is built."""
    from pathlib import Path
    from api.services.uct_agent.knowledge import frame
    assert not frame.wants_knowledge("what's a VCP?")                 # a known gap of the word list (documented)
    doc = Path(__file__).resolve().parents[1] / "docs" / "agent" / "knowledge" / "EVIDENCE-ROUTING-DESIGN.md"
    assert "Brain stays OFF" in doc.read_text(encoding="utf-8")
