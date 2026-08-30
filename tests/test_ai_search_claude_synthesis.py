"""Perplexity retrieves, Claude thinks (2026-08-30). Shipped DARK.

Owner's question: "compared to someone just using regular Claude, is our version
better yet?" Honest answer at the time: on desk DATA yes, on THINKING no — and
the reason is that the fast lane synthesises with Perplexity's `sonar-pro`, not
with Claude. We were comparing a Perplexity-model answer to a Claude-model
answer while the data advantage was ours all along.

This keeps Perplexity for what it is genuinely good at — searching the live web
and returning cited sources — and hands the SYNTHESIS to Claude, over the desk
context plus those findings. The lane a member hits stays one round trip.

⛔ Default OFF. It adds an Anthropic call per ask; arming it is a spend decision.
⛔ Any failure returns the Perplexity answer unchanged — synthesis must never
cost a member their answer.
"""
import pytest

import api.routers.ai_search as ai

_WEB = {"answer": "NVDA rose on strong datacenter demand [1][2].",
        "citations": ["https://reuters.com/a", "https://wsj.com/b"],
        "mode": "fast", "model": "sonar-pro"}


class _Blk:
    type = "text"

    def __init__(self, t):
        self.text = t


class _Resp:
    def __init__(self, t):
        self.content = [_Blk(t)]


def _stub_claude(monkeypatch, text="Claude's grounded read [1][2].", boom=False):
    import api.services.engine as engine

    class _Msgs:
        def create(self, **kw):
            _seen.update(kw)
            if boom:
                raise RuntimeError("anthropic down")
            return _Resp(text)

    class _Client:
        messages = _Msgs()

        def with_options(self, **kw):
            return self

    _seen = {}
    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: _Client())
    return _seen


def test_the_flag_is_off_by_default(monkeypatch):
    """⛔ The load-bearing safety property: this adds an LLM call per ask."""
    monkeypatch.delenv("AI_SEARCH_CLAUDE_SYNTH", raising=False)
    assert ai._claude_synth_enabled() is False


def test_claude_synthesises_over_the_desk_context_and_the_web(monkeypatch):
    """The whole point — Claude gets BOTH halves, and its answer is what ships."""
    monkeypatch.setenv("AI_SEARCH_CLAUDE_SYNTH", "1")
    seen = _stub_claude(monkeypatch)
    out = ai._claude_synthesis("why is NVDA up?", "UCT DESK CONTEXT: NVDA last $217.55",
                               _WEB, None)
    assert out["answer"] == "Claude's grounded read [1][2]."
    sys_txt = seen.get("system") or ""
    assert "217.55" in sys_txt, "desk context never reached Claude"
    assert "datacenter demand" in sys_txt, "web findings never reached Claude"


def test_the_citations_survive(monkeypatch):
    """Perplexity found them; a synthesis that drops them makes every [n] in the
    answer dangle."""
    monkeypatch.setenv("AI_SEARCH_CLAUDE_SYNTH", "1")
    _stub_claude(monkeypatch)
    out = ai._claude_synthesis("why is NVDA up?", "ctx", _WEB, None)
    assert out["citations"] == _WEB["citations"]


def test_a_claude_failure_returns_none_so_the_web_answer_stands(monkeypatch):
    """CONTROL — synthesis must never cost a member their answer."""
    monkeypatch.setenv("AI_SEARCH_CLAUDE_SYNTH", "1")
    _stub_claude(monkeypatch, boom=True)
    assert ai._claude_synthesis("why is NVDA up?", "ctx", _WEB, None) is None


def test_nothing_to_synthesise_is_left_alone(monkeypatch):
    """CONTROL — no web answer AND no desk context means there is nothing for
    Claude to reason over; spending a call on it would be pure waste."""
    monkeypatch.setenv("AI_SEARCH_CLAUDE_SYNTH", "1")
    _stub_claude(monkeypatch)
    assert ai._claude_synthesis("why is NVDA up?", "", {"answer": ""}, None) is None


def test_an_upstream_error_is_never_synthesised_over(monkeypatch):
    """CONTROL — a provider error must reach the outage ladder untouched, not be
    dressed up by Claude into something that reads like an answer."""
    monkeypatch.setenv("AI_SEARCH_CLAUDE_SYNTH", "1")
    _stub_claude(monkeypatch)
    assert ai._claude_synthesis("q", "ctx", {"answer": "", "error": "timeout after 30s"},
                                None) is None


# ── one definition: it rides inside fast_lane_answer ───────────────────────
def test_the_fast_lane_applies_synthesis_when_armed(monkeypatch):
    """Wired inside fast_lane_answer so the single shot, BOTH stream fallbacks
    and the exam all get it from one place — the same reason that helper exists."""
    monkeypatch.setenv("AI_SEARCH_CLAUDE_SYNTH", "1")
    _stub_claude(monkeypatch)
    monkeypatch.setattr(ai.perplexity_search, "web_search", lambda *a, **k: dict(_WEB))
    out = ai.fast_lane_answer("why is NVDA up?", "ctx", "salt")
    assert out["answer"] == "Claude's grounded read [1][2]."
    assert out["citations"] == _WEB["citations"]


def test_the_fast_lane_is_untouched_when_disarmed(monkeypatch):
    """CONTROL — with the flag off the member gets exactly today's answer."""
    monkeypatch.delenv("AI_SEARCH_CLAUDE_SYNTH", raising=False)
    monkeypatch.setattr(ai.perplexity_search, "web_search", lambda *a, **k: dict(_WEB))
    out = ai.fast_lane_answer("why is NVDA up?", "ctx", "salt")
    assert out["answer"] == _WEB["answer"]
