"""Say what the desk LOOKED FOR and did not find (2026-08-29).

Rung 4 — data-limits honesty — scores 0/5 on the fast lane, the worst rung by
a distance. `S1-03-breadth` is the clean case: after the None-grounding fix the
breadth pack correctly renders NOTHING when it has no data, and the model then
invents breadth numbers anyway (c1 g1 o2 s1, safety break).

Silence is the problem. To the model, "the desk sent no breadth" is
indistinguishable from "the desk never looked" — so it fills the gap. Note the
distinction from the None bug: `score None` reads as a DATA VALUE and is worse
than silence; "breadth: not available" reads as a STATED ABSENCE and is better
than silence. The fix is to state the absence, not to leak a null.
"""
import pytest

import api.routers.ai_search as ai


@pytest.fixture(autouse=True)
def _no_log(monkeypatch):
    monkeypatch.setenv("AI_SEARCH_LOG_ENABLED", "0")


def test_an_asked_for_pack_that_has_nothing_is_declared(monkeypatch):
    """Fails while an empty pack is simply omitted."""
    monkeypatch.setattr(ai, "_ctx_breadth", lambda: "")
    ctx, _salt, meta = ai._uct_context("what is market breadth telling us right now?")
    assert "breadth" in (meta.get("grounding_gaps") or []), meta
    assert "breadth" in ctx.lower()


def test_the_gap_tells_the_model_to_say_so_rather_than_estimate(monkeypatch):
    """The line has to carry the instruction, not just the word — the DATA
    LIMITS paragraph alone was not enough to stop the fabrication."""
    monkeypatch.setattr(ai, "_ctx_breadth", lambda: "")
    ctx, _salt, _meta = ai._uct_context("what is market breadth telling us right now?")
    low = ctx.lower()
    assert "not available" in low or "no current" in low, ctx
    assert "estimate" in low or "say so" in low, ctx


def test_a_pack_that_returns_data_is_not_a_gap(monkeypatch):
    """CONTROL — proves the gap list is driven by emptiness, not by asking."""
    monkeypatch.setattr(ai, "_ctx_breadth", lambda: "Breadth (UCT): score 55")
    _ctx, _salt, meta = ai._uct_context("what is market breadth telling us right now?")
    assert "breadth" not in (meta.get("grounding_gaps") or []), meta


def test_a_pack_nobody_asked_for_is_not_a_gap(monkeypatch):
    """CONTROL — the load-bearing half. Declaring every pack the desk did not
    run would fill the prompt with absences nobody asked about and teach the
    model the desk is mostly empty."""
    monkeypatch.setattr(ai, "_ctx_breadth", lambda: "")
    _ctx, _salt, meta = ai._uct_context("what is NVDA trading at?")
    assert "breadth" not in (meta.get("grounding_gaps") or []), meta


def test_a_gap_alone_still_produces_context(monkeypatch):
    """CONTROL — if the ONLY thing to say is "we looked and have nothing", that
    is still worth saying. An early `if not parts` return would drop it."""
    monkeypatch.setattr(ai, "_ctx_breadth", lambda: "")
    monkeypatch.setattr(ai, "_regime_provider", lambda: {})
    ctx, _salt, _meta = ai._uct_context("what is market breadth telling us right now?")
    assert ctx.strip() != ""
