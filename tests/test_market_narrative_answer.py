"""/api/schwab/market-narrative serves the model's ANSWER, never its lead-in.

2026-11-14: members were served "Let me pull up Friday's market close." for 30 minutes.
A web-search turn can come back paused (stop_reason "pause_turn") after the lead-in and
before the answer; the handler joined every text block and cached that.
"""
import inspect
from datetime import datetime
from types import SimpleNamespace

import anthropic
import pytest

from api import schwab_router
from api.services import market_narrative_swr, narrative_cost_guard
from api.services.cache import cache

NARRATIVE = "schwab_market_narrative"
ANSWER = "The S&P 500 rose 0.4% and the Nasdaq gained 0.7% as chip stocks rallied."
USAGE = SimpleNamespace(input_tokens=1000, output_tokens=60)


def _text(t):
    return SimpleNamespace(type="text", text=t)


def _search():
    return [SimpleNamespace(type="server_tool_use", name="web_search"),
            SimpleNamespace(type="web_search_tool_result", content=[])]


class SeqClient:
    """Answers each create() with the next reply in order."""

    def __init__(self, replies):
        self.replies, self.calls = list(replies), []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.replies.pop(0)


@pytest.fixture
def run(monkeypatch):
    narrative_cost_guard._reset_for_test(NARRATIVE)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "not-a-real-key")
    key = market_narrative_swr.cache_key(datetime.now())
    cache.invalidate(key)

    def go(replies):
        fake = SeqClient(replies)
        monkeypatch.setattr(anthropic, "Anthropic", lambda **_kw: fake)
        out = inspect.unwrap(schwab_router.market_narrative)(_auth={})
        return fake, out, cache.get(key)
    yield go
    narrative_cost_guard._reset_for_test(NARRATIVE)
    cache.invalidate(key)


def test_a_paused_search_turn_is_resumed_and_the_answer_served(run):
    paused = SimpleNamespace(stop_reason="pause_turn", usage=USAGE,
                             content=[_text("Let me pull up Friday's market close."), *_search()])
    done = SimpleNamespace(stop_reason="end_turn", usage=USAGE, content=[_text(ANSWER)])
    fake, out, cached = run([paused, done])
    assert out == {"narrative": ANSWER} and cached == ANSWER
    assert len(fake.calls) == 2
    resumed = fake.calls[1]["messages"]
    assert resumed[1] == {"role": "assistant", "content": paused.content}
    assert narrative_cost_guard.calls_today_for_surface(NARRATIVE) == 2, "both calls charged"


def test_the_lead_in_before_a_search_is_dropped(run):
    reply = SimpleNamespace(stop_reason="end_turn", usage=USAGE,
                            content=[_text("Let me pull up Friday's market close."), *_search(),
                                     _text(ANSWER)])
    _, out, _ = run([reply])
    assert out == {"narrative": ANSWER}


def test_a_lead_in_alone_is_never_cached(run):
    """Still paused after every resume: serve the placeholder, cache nothing, so the
    last-good wrapper keeps the previous narrative."""
    paused = SimpleNamespace(stop_reason="pause_turn", usage=USAGE,
                             content=[_text("Let me pull up Friday's market close."), *_search()])
    fake, out, cached = run([paused] * (schwab_router._NARRATIVE_MAX_CONTINUATIONS + 1))
    assert out == {"narrative": "Market summary unavailable."} and cached is None
    assert len(fake.calls) == schwab_router._NARRATIVE_MAX_CONTINUATIONS + 1


def test_chatter_without_an_index_is_not_cached(run):
    reply = SimpleNamespace(stop_reason="end_turn", usage=USAGE,
                            content=[_text("I could not find reliable figures for today.")])
    _, out, cached = run([reply])
    assert out == {"narrative": "Market summary unavailable."} and cached is None
