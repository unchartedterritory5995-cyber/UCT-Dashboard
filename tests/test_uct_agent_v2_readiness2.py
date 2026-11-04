"""v2-readiness-2 (Mission 3) — planner v2 parity items left by #766 / #768 / #771, scripted (no model, no paid call):

1. agent.undo (hotfix #766) is a CHANGE step in v2: sent as `apply` (never a query nothing executes), blocked after a
   web lookup like any change, and the v2 system prompt carries the Undo rule only when the browser offers agent.undo.
2. KN-1 flag-off identity: with UCT_AGENT_KNOWLEDGE off, a playbook.* manifest entry is never offered, so the v2 request
   is byte-identical to one built without it; with the flag on it is offered (index) and its result is framed.
"""
from __future__ import annotations

import json

import pytest

from api.services.uct_agent import turn, turn_v2 as v2
from tests.test_uct_agent_planner_v2 import ARGS, CAPS, CTX, resp, scripted, text, tool_use, waiter  # noqa: F401

UNDO = {"name": "agent.undo", "domain": "agent", "target": "about", "summary": "Undo YOUR OWN most recent change(s).", "hints": None,
        "risk": "local", "reversible": True, "undo": "none", "query": True,
        "args": ARGS({"scope": {"type": "string", "enum": ["last", "all"]}, "about": {"type": ["string", "null"], "enum": ["timeframe", None]}})}
PLAYBOOK = {"name": "playbook.explain", "domain": "playbook", "target": "playbook", "summary": "Answer from UCT's knowledge base.", "hints": None,
            "risk": "local", "reversible": True, "undo": "none", "query": True, "args": ARGS({"question": {"type": "string"}})}
CTX_U = {**CTX, "agent": [{"ref": "a1", "label": "UCT Agent"}], "playbook": [{"ref": "p1", "label": "UCT's playbook"}]}


@pytest.fixture(autouse=True)
def _flags(monkeypatch):
    monkeypatch.setenv(v2.PLANNER_ENV, "v2")
    for k in (v2.ROUNDS_ENV, v2.TURN_USD_ENV, v2.TOOLS_ENV, "UCT_AGENT_EFFORT", "UCT_AGENT_KNOWLEDGE"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(turn, "_record_cost", lambda r: 0.0)


def go(caller, wait_step=None, caps=None, message="undo that", events=None, **kw):
    return v2.run_turn_v2(message=message, context=CTX_U, history=[], capabilities=caps or (CAPS + [UNDO]), caller=caller,
                          on_event=(events.append if events is not None else None), wait_step=wait_step, **kw)


# ── 1. agent.undo ──────────────────────────────────────────────────────────────────────────────
def test_UNDO_a_v2_agent_undo_step_is_sent_as_apply_and_its_browser_outcome_is_what_the_model_reads():
    ev = []
    c = scripted(resp(tool_use("load_actions", {"names": ["agent__undo"]}, "tu1")),
                 resp(tool_use("agent__undo", {"target": "a1", "args": {"scope": "last", "about": None}}, "tu2")),
                 resp(text("")))
    w = waiter({"status": "done", "receipt": "Undid: Chart (SPY) back to daily"})
    out = go(c, w, events=ev)
    step = [e for e in ev if e["t"] == "step"][0]
    assert step["action"] == "agent.undo" and step["mode"] == "apply"           # never "query": nothing would execute it
    told = c.calls[2]["messages"][-1]["content"][0]
    assert told["content"] == "done: Undid: Chart (SPY) back to daily" and not told.get("is_error")
    assert out["envelope"]["steps"][0]["status"] == "done"


def test_UNDO_a_refused_undo_is_an_error_result_and_never_a_claim():
    c = scripted(resp(tool_use("agent__undo", {"target": "a1", "args": {"scope": "last", "about": None}}, "tu2")),
                 resp(text("Undone.")))
    out = go(c, waiter({"status": "refused", "refusal": "There is nothing of mine to undo in this session."}))
    told = c.calls[1]["messages"][-1]["content"][0]
    assert told["is_error"] is True and "nothing of mine to undo" in told["content"]
    assert out["envelope"]["reply"] == v2.UNDO_NOT_DONE                         # "Undone." when the Undo was refused is withheld


def test_UNDO_is_a_change_so_it_is_blocked_after_a_web_lookup_in_the_same_turn():
    st = v2._start("undo that", CTX_U, [], CAPS + [UNDO], None, None, None, None, None)
    st["researched"] = True
    st["pending_uses"] = [{"type": "tool_use", "id": "tu1", "name": "agent__undo", "input": {"target": "a1", "args": {"scope": "last", "about": None}}}]
    assert v2._run_pending_steps(st, None, waiter({"status": "done"})) is None
    assert st["steps"] == [] and st["results"][0]["content"] == v2.NO_CHANGE_AFTER_RESEARCH


def test_UNDO_rule_rides_the_system_prompt_only_when_agent_undo_is_offered():
    with_undo = v2._start("x", CTX_U, [], CAPS + [UNDO], None, None, None, None, None)["system"][0]["text"]
    without = v2._start("x", CTX_U, [], CAPS, None, None, None, None, None)["system"][0]["text"]
    assert v2.V2_UNDO_RULE in with_undo and "agent__undo" in with_undo
    assert v2.V2_UNDO_RULE not in without and "agent__undo" not in without and "UNDO." not in without


# ── 2. knowledge flag-off identity ────────────────────────────────────────────────────────────
def _req(caps):
    st = v2._start("what is a vcp?", CTX_U, [], caps, None, None, None, None, "v2_fixed")
    return json.dumps({"system": st["system"], "tools": st["tools"], "messages": st["messages"], "caps": sorted(st["caps"])}, sort_keys=True)


@pytest.mark.parametrize("layout", ["index", "search"])
def test_KNOWLEDGE_FLAG_OFF_a_playbook_entry_is_never_offered_and_the_v2_request_is_byte_identical(monkeypatch, layout):
    monkeypatch.setenv(v2.TOOLS_ENV, layout)
    assert _req(CAPS + [PLAYBOOK]) == _req(CAPS)
    assert "playbook__explain" not in _req(CAPS + [PLAYBOOK]) and "playbook.explain" not in _req(CAPS + [PLAYBOOK])


def test_KNOWLEDGE_FLAG_OFF_a_forged_playbook_call_is_an_unknown_action_and_runs_nothing():
    c = scripted(resp(tool_use("playbook__explain", {"target": "p1", "args": {"question": "vcp"}}, "tu1")), resp(text("I can't.")))
    w = waiter({"status": "query", "result": "never"})
    out = go(c, w, caps=CAPS + [PLAYBOOK], message="what is a vcp?")
    assert w.seen == [] and out["envelope"]["steps"] == []
    assert c.calls[1]["messages"][-1]["content"][0]["is_error"] is True


def test_KNOWLEDGE_FLAG_ON_the_entry_is_offered_and_its_result_is_framed(monkeypatch):
    monkeypatch.setenv("UCT_AGENT_KNOWLEDGE", "1")
    assert _req(CAPS + [PLAYBOOK]) != _req(CAPS) and "playbook__explain" in _req(CAPS + [PLAYBOOK])
    c = scripted(resp(tool_use("playbook__explain", {"target": "p1", "args": {"question": "vcp"}}, "tu1")), resp(text("Per UCT's playbook…")))
    go(c, waiter({"status": "query", "result": "A VCP is …"}), caps=CAPS + [PLAYBOOK], message="what is a vcp?")
    told = c.calls[1]["messages"][-1]["content"][0]["content"]
    assert "<uct_knowledge>" in told


@pytest.mark.parametrize("reply", ["Undone.", "I reverted the timeframe change.", "Took that back for you.", "Restored the daily chart."])
def test_UNDO_no_undo_claim_survives_an_undo_step_that_did_not_go_through(reply):
    c = scripted(resp(tool_use("agent__undo", {"target": "a1", "args": {"scope": "last", "about": None}}, "tu2")), resp(text(reply)))
    assert go(c, waiter({"status": "refused", "refusal": "changed since"}))["envelope"]["reply"] == v2.UNDO_NOT_DONE
    c = scripted(resp(tool_use("agent__undo", {"target": "a1", "args": {"scope": "last", "about": None}}, "tu2")), resp(text(reply)))
    assert go(c, waiter({"status": "done", "receipt": "Undid it"}))["envelope"]["reply"] == reply      # its receipt is above


# review #775 (4): the claim check is per Undo step, and a strong claim with no Undo step at all is caught
def test_UNDO_a_claim_with_NO_undo_step_is_caught_but_an_ordinary_restore_is_not():
    c = scripted(resp(tool_use("chart__setTimeframe", {"target": "c1", "args": {"timeframe": "D"}}, "tu1")), resp(text("Undone — back to daily.")))
    assert go(c, waiter({"status": "done", "receipt": "Chart (SPY) to daily"}), message="back to daily")["envelope"]["reply"] == v2.UNDO_NOT_DONE
    c = scripted(resp(tool_use("chart__setTimeframe", {"target": "c1", "args": {"timeframe": "D"}}, "tu1")), resp(text("Restored the daily timeframe.")))
    assert go(c, waiter({"status": "done", "receipt": "Chart (SPY) to daily"}), message="back to daily")["envelope"]["reply"] == "Restored the daily timeframe."


def test_UNDO_one_good_undo_among_several_does_not_back_a_claim():
    u = lambda i: tool_use("agent__undo", {"target": "a1", "args": {"scope": "last", "about": None}}, f"tu{i}")  # noqa: E731
    c = scripted(resp(u(1), u(2)), resp(text("Took both back.")))
    out = go(c, waiter({"status": "done", "receipt": "Undid A"}, {"status": "refused", "refusal": "changed since"}))
    assert [s["status"] for s in out["envelope"]["steps"]] == ["done", "refused"]
    assert out["envelope"]["reply"] == v2.UNDO_NOT_DONE
    c = scripted(resp(u(1), u(2)), resp(text("Took both back.")))
    assert go(c, waiter({"status": "done", "receipt": "Undid A"}, {"status": "done", "receipt": "Undid B"}))["envelope"]["reply"] == "Took both back."


@pytest.mark.parametrize("steps,reply,unbacked", [
    ([], "All set.", False),
    ([], "I undid that.", True),
    ([], "I reversed the order.", False),                              # weak word, no Undo planned: an ordinary change
    ([{"action": "agent.undo", "status": "done"}], "Put it back.", False),
    ([{"action": "agent.undo", "status": "refused"}], "Put it back.", True),
])
def test_undo_claim_unbacked_table(steps, reply, unbacked):
    assert v2.undo_claim_unbacked(steps, reply) is unbacked
