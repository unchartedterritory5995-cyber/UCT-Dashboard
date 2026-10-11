"""UCT Agent — no false action claims (stabilization, 2026-10-11).

The owner-approved live check (haiku-4-5) returned, for "Show me my strongest stocks.", an ANSWER with no
ops whose reply was "Opening your Momentum watchlist—your 8 strongest by RS Rank." — shown to the member
as if it had happened, and stored in the history the follow-up read; and for the follow-up an APPLY whose
one op only showed a list, replying "Filtering Momentum to stocks above $50.".

`turn.sanitize_envelope` is the one server-side gate between the model and the browser. A reply is never a
receipt: with ops it may not narrate work (UCT's receipt / proposal card / refusal says what happened);
with no ops it may not claim work at all (replaced by NOTHING_DONE). Ordinary answers pass untouched.
Recorded replies only — no model call.
"""
from __future__ import annotations

import json
import types

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import uct_agent as rx
from api.services import daily_counters
from api.services.uct_agent import store, turn

OP = {"action": "chart.setType", "target": "c1", "args": {"type": "bars"}}
CAPS = [{"name": "chart.setType", "domain": "chart", "target": "chart", "summary": "Change how price is drawn.",
         "hints": None, "risk": "local", "reversible": True,
         "args": {"type": "object", "properties": {"type": {"type": "string", "enum": ["candles", "bars", "line"]}},
                  "required": ["type"], "additionalProperties": False}}]
CTX = {"surface": "charts", "charts": [{"ref": "c1", "label": "Chart (SPY)", "symbol": "SPY"}]}


def env(disposition, ops=(), reply=""):
    return {"disposition": disposition, "reply": reply, "question": None, "ops": list(ops),
            "unsupported_category": None, "research": None}


def _resp(e):
    return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=json.dumps(e))], stop_reason="end_turn",
                                 usage=types.SimpleNamespace(input_tokens=100, output_tokens=20))


@pytest.fixture(autouse=True)
def _no_cost(monkeypatch):
    monkeypatch.setattr(turn, "_record_cost", lambda resp: 0.001)


# ── the two REAL replies from the live check ────────────────────────────────

def test_the_live_answer_that_claimed_to_open_a_watchlist_with_no_ops_is_replaced():
    out = turn.sanitize_envelope(env("answer", reply="Opening your Momentum watchlist—your 8 strongest by RS Rank."), {"c1"})
    assert out["disposition"] == "answer" and out["ops"] == []
    assert out["reply"] == turn.NOTHING_DONE
    assert "nothing in UCT changed" in out["reply"]


def test_the_live_apply_that_narrated_filtering_keeps_its_op_and_loses_the_narration():
    out = turn.sanitize_envelope(env("apply", ops=[OP], reply="Filtering Momentum to stocks above $50."), {"c1"})
    assert out["ops"] == [OP] and out["reply"] == ""


# ── zero ops: a claim is replaced; an answer is not ─────────────────────────

@pytest.mark.parametrize("reply", [
    "Opening your Momentum watchlist.", "Switched your chart to weekly.", "Added RSI to your chart.",
    "I've added RSI.", "I'll open your trading layout.", "I have saved the screen.", "Let me open that for you.",
    "Here are your strongest stocks: NVDA, PLTR, HOOD.", "Here are the top 10 by RS Rank: NVDA, PLTR.",
    "Done.", "All set!", "Sure, opening your Swing layout now.", "OK — filtering your list to stocks above $50.",
    # an `apply` that came back with no ops is just a reply, and is held to the same rule
])
def test_an_answer_with_no_ops_that_claims_work_is_replaced(reply):
    assert turn.sanitize_envelope(env("answer", reply=reply), {"c1"})["reply"] == turn.NOTHING_DONE


def test_an_apply_with_no_ops_becomes_an_answer_and_its_claim_is_replaced():
    out = turn.sanitize_envelope(env("apply", ops=[], reply="Opening your Momentum watchlist."), {"c1"})
    assert out["disposition"] == "answer" and out["reply"] == turn.NOTHING_DONE


@pytest.mark.parametrize("reply", [
    "RSI measures momentum on a 0-100 scale.",
    "Adding a 200-day SMA shows the long-term trend.",            # a gerund that explains, not narrates
    "Let me show you how RSI works: it compares average gains to average losses.",
    "Showing volume on the chart helps confirm breakouts.",
    "You can open Chart Settings to change the theme.",
    "I can't set colours for an indicator yet — set them in its settings.",
    "I'll need to know which chart you mean.",
    "Your Momentum list has 8 stocks.",
    "Strongest means highest RS Rank across UCT's Screener universe.",
])
def test_ordinary_answers_pass_untouched(reply):
    assert turn.sanitize_envelope(env("answer", reply=reply), {"c1"})["reply"] == reply


# ── with ops: narration dropped (the receipt reports); a disclosure kept ────

@pytest.mark.parametrize("disp", ["apply", "propose"])
@pytest.mark.parametrize("reply", [
    "Filtering Momentum to stocks above $50.", "Opening your trading layout.", "I'll delete the Swing list once you approve.",
    "Here are the top 10 by RS Rank.", "Sure, switching to weekly.", "Now adding RSI to the left chart.",
])
def test_a_plan_never_narrates_its_own_work(disp, reply):
    out = turn.sanitize_envelope(env(disp, ops=[OP], reply=reply), {"c1"})
    assert out["ops"] == [OP] and out["reply"] == ""


@pytest.mark.parametrize("reply", [
    "Using the latest session's close and dollar volume.",
    "RSI measures momentum on a 0-100 scale; switching the left chart to weekly.",
    "Bars make the open and close easier to see.",
])
def test_a_plan_keeps_a_reply_that_discloses_rather_than_narrates(reply):
    assert turn.sanitize_envelope(env("apply", ops=[OP], reply=reply), {"c1"})["reply"] == reply


# ── the whole turn, and what the conversation STORES ────────────────────────

def test_run_turn_returns_the_honest_reply(monkeypatch):
    c = lambda **kw: _resp(env("answer", reply="Opening your Momentum watchlist—your 8 strongest by RS Rank."))
    out = turn.run_turn(message="Show me my strongest stocks.", context=CTX, history=[], capabilities=CAPS, caller=c)
    assert out["envelope"]["reply"] == turn.NOTHING_DONE and out["envelope"]["ops"] == []


ADMIN = {"id": "38c023cf-0e81-4187-aa43-ac51a751a001", "plan": "pro", "role": "admin"}


@pytest.fixture
def client(monkeypatch):
    daily_counters.clear()
    store._reset_for_tests()
    monkeypatch.setattr(rx, "_et_day", lambda: "2026-10-11")
    monkeypatch.setattr(rx, "is_paid_user", lambda u: True)
    from api.middleware.auth_middleware import get_current_user_with_plan
    app = FastAPI()
    app.include_router(rx.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: ADMIN
    yield TestClient(app)
    daily_counters.clear()


def test_the_conversation_stores_the_honest_reply_so_the_next_turn_does_not_believe_the_claim(client, monkeypatch):
    monkeypatch.setattr(turn, "_default_caller", lambda **kw: _resp(env("answer", reply="Opening your Momentum watchlist.")))
    r = client.post("/api/agent/turn", json={"message": "Show me my strongest stocks.", "context": CTX, "capabilities": CAPS})
    assert r.status_code == 200 and r.json()["envelope"]["reply"] == turn.NOTHING_DONE
    cid = r.json()["conversationId"]
    agent_rows = [t for t in store.get_turns(ADMIN["id"], cid) if t["role"] == "agent"]
    assert [t["text"] for t in agent_rows] == [turn.NOTHING_DONE]
    assert all("Opening your Momentum" not in json.dumps(t) for t in store.get_turns(ADMIN["id"], cid))


def test_the_prompt_states_the_whole_market_ruling_for_my_strongest():
    p = turn._SYSTEM_HEAD + turn._SYSTEM_TAIL
    assert "across UCT's whole Screener universe" in p
    assert "never answer a screening request by opening or showing a watchlist" in p
