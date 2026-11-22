"""Wave 3 W3-4 (w3-a, 2026-11-03) -- the single-turn coaching workflow, server side: the `coach` block makes the model
structure a coaching reply as explain -> what to check -> ONE question back, and a reply in that shape passes the
guard untouched (footer added), while the shapes the workflow forbids are replaced. `coach.next` has no server side
(the browser's chips send ordinary messages); the server's part is the block and the guard. Scripted model only."""
from __future__ import annotations

import json
import re
import types

import pytest

from api.services.uct_agent import coach, turn
from api.services.uct_agent.coach import guard, prompt

CAPS = [{"name": "coach.explain", "domain": "coach", "target": "coach", "summary": "Explain.", "hints": None, "risk": "local",
         "reversible": True, "query": True,
         "args": {"type": "object", "properties": {"topic": {"type": "string"}}, "required": ["topic"], "additionalProperties": False}}]
CONCEPT = ("Breakouts and failed breakouts. A breakout is a move through a level that had been containing price. "
           "Common mistakes: treating an intraday poke as a breakout. Uncertainty: no pattern makes a breakout certain to hold.")
CTX = {"charts": [{"ref": "c1", "label": "Chart (NVDA)", "symbol": "NVDA"}],
       "coach": [{"ref": "k1", "label": "Trading coach", "conceptId": "breakouts-and-failure", "concept": CONCEPT, "consent": "unknown"}]}
STRUCTURED = ("A breakout is a move through a level that had been containing price; a failed one comes back inside the range "
              "within a few sessions, and no pattern makes a breakout certain to hold.\n"
              "- Where exactly was the boundary, and did the close finish beyond it?\n"
              "- How did the session's volume compare with the stock's recent average?\n"
              "- What would show you it had failed?\n"
              "What was the level you were watching on this chart?")


def env(reply, disposition="answer"):
    return {"disposition": disposition, "reply": reply, "question": None, "ops": [], "unsupported_category": None, "research": None}


def scripted(e):
    seen = {"system": None}

    def call(**kw):
        seen["system"] = "\n".join(b["text"] for b in kw["system"])
        return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=json.dumps(e))], stop_reason="end_turn",
                                     usage=types.SimpleNamespace(input_tokens=1, output_tokens=1))
    call.seen = seen
    return call


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv(coach.FLAG_ENV, "1")


def test_the_block_prescribes_the_workflow():
    r = prompt.RULES
    assert re.search(r"\(1\) the explanation; \(2\) what to check", r)
    assert "exactly ONE short question back" in r
    assert "EXPLAIN FROM THE CONCEPT TEXT" in r and "Never improvise" in r
    assert "STATE UNCERTAINTY" in r and "GROUNDED FIGURES ONLY" in r
    assert r.strip().endswith("END every coaching reply with exactly: Educational, not advice.")


def test_a_structured_reply_passes_untouched_with_the_footer(on):
    c = scripted(env(STRUCTURED))
    out = turn.run_turn(message="what is a failed breakout?", context=CTX, history=[], capabilities=CAPS, caller=c)
    assert prompt.RULES.strip() in c.seen["system"]
    reply = out["envelope"]["reply"]
    assert reply == STRUCTURED + "\n\n" + guard.FOOTER
    assert out["usage"]["coach_guard"] == []
    # the shape: an explanation, "- " check bullets, one question at the end
    lines = [l for l in reply.splitlines() if l.strip()]
    assert sum(1 for l in lines if l.startswith("- ")) == 3
    assert lines[-2].endswith("?") and lines[-1] == guard.FOOTER


@pytest.mark.parametrize("bad,codes", [
    # (usage["coach_guard"] is the SORTED set of codes)
    ("A breakout is a move through a level. Buy now before it runs. What was the level?", ["order", "uncertainty", "unsupported"]),
    ("A breakout is a move through a level. It will go up from here. What was the level?", ["uncertainty", "unsupported"]),
    ("A breakout is a move through a level. Most hold about 70% of the time. What was the level?", ["figure", "uncertainty"]),
    ("The breakout should follow through next week. What was the level?", ["uncertainty"]),
])
def test_the_shapes_the_workflow_forbids_are_replaced(on, bad, codes):
    out = turn.run_turn(message="coach me on breakouts", context=CTX, history=[], capabilities=CAPS, caller=scripted(env(bad)))
    assert out["envelope"]["reply"] == guard.FIXED
    assert out["usage"]["coach_guard"] == codes


def test_the_model_may_restate_the_observation_and_the_members_figure(on):
    ctx = {**CTX, "coach": [{**CTX["coach"][0], "observation": "On this chart (NVDA, daily bars through 2026-10-30): the last close is above its 20-day average."}]}
    reply = ("A breakout is a move through a level. On this chart (NVDA, daily bars through 2026-10-30): the last close is above its "
             "20-day average — that describes the chart so far, and it may change.\n- Where was the boundary?\nWhat was your plan at the 20-day?")
    out = turn.run_turn(message="is NVDA above the 20-day?", context=ctx, history=[], capabilities=CAPS, caller=scripted(env(reply)))
    assert out["usage"]["coach_guard"] == []
    assert out["envelope"]["reply"].startswith("A breakout is a move")


def test_no_server_side_next_and_the_block_is_absent_off_the_coach(on):
    c = scripted(env("Fine."))
    out = turn.run_turn(message="hello", context={"charts": CTX["charts"]}, history=[], capabilities=CAPS, caller=c)
    assert "coach_guard" not in out["usage"] and prompt.RULES.strip() not in c.seen["system"]
    assert "next" not in out["envelope"]
