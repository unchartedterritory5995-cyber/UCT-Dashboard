"""Lead fixes from agent-qa's ADR-005 audit (#625), Sprint 2:

* F-17 — `recent_outcome` (free text the browser may send about the last outcome) is never forwarded to the model,
  whatever the history holds: the server cannot tell what it repeats.
* F-18 — the conversation-naming call screens the Agent's own rows with `is_local_row`, as history does."""
from __future__ import annotations

import json
import types

from api.services.uct_agent import turn

SECRET = "987.654"


def _resp(payload: dict):
    return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=json.dumps(payload))],
                                 stop_reason="end_turn", usage=types.SimpleNamespace(input_tokens=10, output_tokens=5))


def _capture(payload: dict):
    calls = []

    def caller(**kw):
        calls.append(kw)
        return _resp(payload)
    return caller, calls


def _turn_messages(history, recent_outcome):
    caller, calls = _capture({"disposition": "answer", "reply": "ok", "ops": [], "question": None,
                              "unsupported_category": None})
    try:
        turn.run_turn(message="and the month before?", context={}, history=history, capabilities=[],
                      recent_outcome=recent_outcome, caller=caller)
    except Exception:  # noqa: BLE001 — what was SENT is the question, not how the reply was judged
        pass
    assert calls, "the model call was not reached: the test would pass vacuously"
    return json.dumps(calls[0].get("messages"), ensure_ascii=False, default=str)   # the turn, not the system prompt


def test_F17_recent_outcome_is_never_forwarded_even_with_no_local_row_in_history():
    sent = _turn_messages([{"role": "member", "text": "breadth?", "data": {}}], f"Breadth was {SECRET}%")
    assert SECRET not in sent and "<recent_outcome>" not in sent


def test_F17_an_empty_history_does_not_reopen_it():
    sent = _turn_messages([], f"Rating {SECRET}")
    assert SECRET not in sent


def test_F18_naming_skips_an_agent_row_that_carried_a_local_result():
    caller, calls = _capture({"title": "Breadth check"})
    turns = [{"role": "member", "text": "what % are above the 50 day", "data": {}},
             {"role": "agent", "text": f"breadth is {SECRET}%",
              "data": {"envelope": {"ops": [{"action": "breadth.show"}]}}}]
    turn.name_conversation(turns, caller=caller)
    assert calls and SECRET not in json.dumps(calls[0], ensure_ascii=False, default=str)


def test_F18_naming_skips_an_unreadable_agent_row():
    caller, calls = _capture({"title": "x"})
    turns = [{"role": "member", "text": "q", "data": {}},
             {"role": "agent", "text": f"value {SECRET}", "data": {"envelope": "not a dict"}}]
    turn.name_conversation(turns, caller=caller)
    assert calls and SECRET not in json.dumps(calls[0], ensure_ascii=False, default=str)


def test_F18_naming_still_reads_ordinary_agent_replies():
    caller, calls = _capture({"title": "x"})
    turns = [{"role": "member", "text": "switch to bars", "data": {}},
             {"role": "agent", "text": "Switched the chart to bars", "data": {"envelope": {"ops": [{"action": "chart.style"}]}}}]
    turn.name_conversation(turns, caller=caller)
    assert calls and "Switched the chart to bars" in json.dumps(calls[0], ensure_ascii=False, default=str)
