"""PRODUCTION BUG 2026-10-12 — "what percent of nasdaq stocks above 50sma right now" was answered:
"UCT's breadth data covers the whole US market, not Nasdaq alone … Want me to pull that?" with
external links.

Root cause (traced locally):
  1. the browser's deterministic breadth phrase missed "50sma" (it needed a space before "sma"), so the
     request went to the model;
  2. the model was offered breadth.show (routing matched) but replied with words (disposition
     answer) instead of planning it;
  3. the server then FORCED a web search for "right now" (`_needs_current_facts`), and the model wrote
     its answer from web results — the false coverage claim and the external links.

These pin the server half:
  · a breadth question never triggers forced research; a model-requested search for a plain breadth
    lookup is dropped;
  · news / why questions keep the existing local-notice rules;
  · the system prompt carries the breadth rule only when breadth.show is offered.
Scripted model, no network.
"""
from __future__ import annotations

import pytest

from api.services.uct_agent import turn
from tests.test_uct_agent_breadth import CAPS, CTX, ScriptedModel, env

BUG = "what percent of nasdaq stocks above 50sma right now"
NASDAQ_OP = {"action": "breadth.show", "target": "b1",
             "args": {"mode": "value", "universe": "nasdaq", "metrics": ["pct_above_50sma"], "date": None,
                      "compare_date": None, "start": None, "end": None, "basis": None}}


@pytest.fixture
def searched(monkeypatch):
    calls = []

    def fake_research(q, recency):
        calls.append(q)
        return {"answer": "UCT's breadth data covers the whole US market, not Nasdaq alone.", "citations": ["https://example.com"]}
    monkeypatch.setattr(turn, "_research", fake_research)
    monkeypatch.setattr(turn, "_record_cost", lambda resp: 0.0)
    return calls


@pytest.mark.parametrize("message", [
    BUG,
    "What percent of NASDAQ stocks are above the 50 SMA right now?",
    "% of NYSE stocks above 200sma currently",
    "how many US stocks are above the 200-day MA today",
    "what's breadth like right now",
    "how many new highs on the nasdaq today",
])
def test_RECOGNIZED_breadth_questions(message):
    assert turn.is_breadth_question(message)


@pytest.mark.parametrize("message", ["why is NVDA moving today", "latest news on AAPL", "what is the 50 sma",
                                     "add the 50 sma to my chart", "what's the market doing right now"])
def test_NOT_breadth_questions(message):
    assert not turn.is_breadth_question(message)


def test_BUG_a_words_only_answer_never_triggers_a_forced_web_search(searched):
    """The exact production wording: the model answered with words; the server used to search the web."""
    m = ScriptedModel()
    m.queue = [env("answer", reply="Want me to pull that?")]
    out = turn.run_turn(message=BUG, context=CTX, history=[], capabilities=CAPS, caller=m)
    assert searched == []                                                   # no web search
    assert out["usage"]["research_calls"] == 0 and not out["usage"].get("research_forced")
    assert out["usage"].get("citations") in ([], None)                       # no external links
    assert len([c for c in m.calls if c.get("max_tokens") != 64]) == 1


def test_BUG_a_model_requested_search_for_a_breadth_lookup_is_dropped(searched):
    m = ScriptedModel()
    m.queue = [{**env("answer", reply="Checking."), "research": {"query": "nasdaq stocks above 50 sma", "recency": "day"}}]
    out = turn.run_turn(message=BUG, context=CTX, history=[], capabilities=CAPS, caller=m)
    assert searched == [] and out["usage"]["research_calls"] == 0
    assert out["usage"]["breadth_research_blocked"] is True


def test_BUG_the_planned_lookup_runs_as_before(searched):
    m = ScriptedModel()
    m.queue = [env("apply", [NASDAQ_OP])]
    out = turn.run_turn(message=BUG, context=CTX, history=[], capabilities=CAPS, caller=m)
    assert out["envelope"]["ops"] == [NASDAQ_OP] and searched == []


def test_NEWS_and_WHY_beside_breadth_keep_their_existing_rules(searched):
    """Not widened: news / explanation words are still governed by the local-notice rules."""
    m = ScriptedModel()
    m.queue = [{**env("apply", [NASDAQ_OP]), "research": {"query": "NVDA news", "recency": "day"}}]
    out = turn.run_turn(message="nasdaq breadth right now and the latest NVDA news", context=CTX, history=[],
                        capabilities=CAPS, caller=m)
    assert out["envelope"]["reply"] == turn.LOCAL_NEWS_NOT_DONE and searched == []


def test_WITHOUT_breadth_offered_the_old_current_facts_rule_stands(searched):
    """Only when UCT can answer it: with no breadth.show in the manifest nothing changes."""
    caps = [c for c in CAPS if c["name"] != "breadth.show"]
    ctx = {k: v for k, v in CTX.items() if k != "breadth"}
    m = ScriptedModel()
    m.queue = [env("answer", reply="Checking."), env("answer", reply="From the web.")]
    out = turn.run_turn(message=BUG, context=ctx, history=[], capabilities=caps, caller=m)
    assert searched == [BUG] and out["usage"]["research_forced"] is True


def test_PROMPT_carries_the_breadth_rule_only_when_breadth_show_is_offered():
    assert turn.BREADTH_RULE in turn.system_prompt(CAPS)
    assert turn.BREADTH_RULE not in turn.system_prompt([c for c in CAPS if c["name"] != "breadth.show"])
    assert "never say UCT lacks historical breadth or NYSE / Nasdaq breadth" in turn.BREADTH_RULE
    assert "breadth.history" in turn.BREADTH_RULE and "never tell the member to scroll a chart" in turn.BREADTH_RULE


def test_MANIFEST_offers_nasdaq_nyse_us_and_uct_with_honest_handling():
    cap = next(c for c in CAPS if c["name"] == "breadth.show")
    assert cap["args"]["properties"]["universe"]["enum"] == ["us", "nyse", "nasdaq", "uct"]
    assert "nyse | nasdaq | uct" in cap["hints"]
