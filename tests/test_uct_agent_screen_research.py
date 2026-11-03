"""A count or list of stocks meeting a condition is UCT's Screener, never the web (2026-11-03).

Production: "how many stocks are up more than 5% today" reached no screener action and was answered from a
web search ("today" forced research). The server now blocks research on a screen-shaped question whenever
the screener is offered, never forces it there, and the prompt names the rule.
"""
from __future__ import annotations

import json

import pytest

from api.services.uct_agent import turn
from tests.test_uct_agent_breadth import ScriptedModel, env

_GOLDEN = json.loads(open("app/src/agent/contract/manifest.golden.json", encoding="utf-8").read())["capabilities"]
SCREEN_CAPS = [c for c in _GOLDEN if c["name"] in ("screener.run", "screener.state")]
CTX = {"surface": "charts"}


@pytest.fixture(autouse=True)
def _no_cost(monkeypatch):
    monkeypatch.setattr(turn, "_record_cost", lambda resp: 0.0)


@pytest.fixture
def searched(monkeypatch):
    calls = []
    monkeypatch.setattr(turn, "_research", lambda q, r: calls.append(q) or {"answer": "x", "citations": ["https://x"]})
    return calls


def test_the_golden_manifest_offers_the_screener():
    assert any(c["name"] == "screener.run" for c in SCREEN_CAPS)


@pytest.mark.parametrize("q", ["how many stocks are up more than 5% today", "which stocks gained over 5% today",
                               "what stocks are down more than 3% this week", "stocks up more than 5% today"])
def test_SCREEN_QUESTIONS_are_recognised(q):
    assert turn.is_screen_question(q)


@pytest.mark.parametrize("q", ["is NVDA up more than 5% today", "nvda price", "latest news on Tesla",
                               "what percent of stocks are above the 50 day"])
def test_NOT_SCREEN_QUESTIONS(q):
    assert not turn.is_screen_question(q)


def test_a_model_research_request_on_a_screen_question_is_blocked(searched):
    m = ScriptedModel()
    m.queue = [{**env("answer", reply="Let me check."), "research": {"query": "stocks up 5% today", "recency": "day"}}]
    out = turn.run_turn(message="how many stocks are up more than 5% today", context=CTX, history=[],
                        capabilities=SCREEN_CAPS, caller=m)
    assert searched == [] and out["usage"]["screen_research_blocked"] is True
    assert out["usage"].get("research_forced") is not True


def test_today_never_FORCES_research_on_a_screen_question(searched):
    m = ScriptedModel()
    m.queue = [env("answer", reply="I can run that screen.")]
    out = turn.run_turn(message="how many stocks are up more than 5% today", context=CTX, history=[],
                        capabilities=SCREEN_CAPS, caller=m)
    assert searched == [] and out["usage"].get("research_forced") is not True


def test_without_the_screener_offered_nothing_changes(searched):
    m = ScriptedModel()
    m.queue = [env("answer", reply="From memory."), env("answer", reply="From the web.")]
    out = turn.run_turn(message="how many stocks are up more than 5% today", context=CTX, history=[],
                        capabilities=[c for c in _GOLDEN if c["name"] == "breadth.show"], caller=m)
    assert out["usage"].get("screen_research_blocked") is None


def test_PROMPT_names_the_screen_rule_only_when_the_screener_is_offered():
    assert turn.SCREEN_RULE in turn.system_prompt(SCREEN_CAPS)
    assert turn.SCREEN_RULE not in turn.system_prompt([c for c in _GOLDEN if c["name"] == "breadth.show"])
    assert "never research" in turn.SCREEN_RULE and "never promise a live intraday count" in turn.SCREEN_RULE
