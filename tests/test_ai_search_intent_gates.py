"""Intent gates vs. the words traders actually type (2026-08-29).

Found by the fast-lane grounding audit: 14 of 30 golden-set questions reached
the model with no desk pack for what they asked. Four of those were pure regex
misses, and in every one the trigger word is LITERALLY IN THE QUESTION:

    "What's the flow tape showing on SPY right now?"        -> _FLOW_RE miss
    "what levels matter and where's the entry per the desk"  -> _LEVELS_RE miss
    "Pull the desk verdict and the street's reaction"        -> _VERDICT_RE miss
    "Which of today's scanner candidates has the best setup" -> _VERDICT_RE miss

This is the failure mode the whole initiative started from: a hand-typed
alternation cannot enumerate how a trader phrases a thing, and every miss is
SILENT — the answer still arrives, fluent and ungrounded. Two of these scored
4/4/4/4 from the judge while carrying no desk data at all.

Questions are quoted VERBATIM from golden_set_search.json so these cases stay
tied to the exam rather than to my paraphrase.
"""
import pytest

import api.routers.ai_search as ai


# ── the four measured misses ────────────────────────────────────────────────
@pytest.mark.parametrize("q", [
    "What's the flow tape showing on SPY right now?",          # S4-03
    "What is the options flow saying on TSLA today?",           # S1-06 (already passed)
    "show me the flow tape",
    "what's the flow looking like on NVDA",
])
def test_flow_gate_catches_how_traders_say_flow(q):
    """`flow` bare is guarded by a lookahead of following words; "flow tape"
    was not in it, so the desk's own flow pack never loaded for a flow question."""
    assert ai._FLOW_RE.search(q), q


@pytest.mark.parametrize("q", [
    "If I'm stalking TSLA this week, what levels matter and where's the entry per the desk?",  # S3-06
    "what levels matter on NVDA",
    "which levels should I watch",
])
def test_levels_gate_catches_bare_levels(q):
    """_LEVELS_RE knew 'key levels' and 'levels to watch' but not 'levels' —
    so "what levels matter" reached the model with no dark-pool/gamma pack."""
    assert ai._LEVELS_RE.search(q), q


@pytest.mark.parametrize("q", [
    "CRM just reported. Pull the desk verdict and the street's reaction, then give me the swing view for the next few weeks.",  # S3-02
    "Which of today's scanner candidates has the best setup, and why?",   # S3-03
    "what's the desk read on NVDA",
    "give me your verdict on AMD",
    "where's the entry on TSLA",
    "what levels matter and where's the entry per the desk",
])
def test_verdict_gate_catches_a_request_for_the_desks_call(q):
    """_VERDICT_RE had no `verdict` alternative at all — the one word a member
    is most likely to use when asking for exactly that."""
    assert ai._VERDICT_RE.search(q), q


# ── controls: the gates must still discriminate ─────────────────────────────
@pytest.mark.parametrize("q", [
    "what is the cash flow statement telling us",     # cash flow != options flow
    "any news flow on NVDA today",                    # news flow
    "how did order flow regulation change",           # order flow
])
def test_flow_gate_still_refuses_the_other_flows(q):
    """CONTROL — the guarded lookbehinds exist because 'flow' is overloaded.
    Widening the lookahead must not start paying for a flow pack on a cash-flow
    question."""
    assert not ai._FLOW_RE.search(q), q


@pytest.mark.parametrize("q", [
    "what were the biggest gainers today",
    "explain what a moving average is",
])
def test_levels_gate_does_not_fire_on_unrelated_asks(q):
    """CONTROL — bare `levels` is a real widening; prove it did not become
    unconditional."""
    assert not ai._LEVELS_RE.search(q), q


@pytest.mark.parametrize("q", [
    "what is a bull flag",
    "who reports earnings today",
    "what were the biggest gainers today",
])
def test_verdict_gate_does_not_fire_on_a_question_asking_for_no_call(q):
    """CONTROL — the verdict pack runs grade_ticker; firing it on a definitional
    or roster question would pay for a computation nobody asked for."""
    assert not ai._VERDICT_RE.search(q), q


# ── the audit that found them stays honest ──────────────────────────────────
def test_the_fast_lane_always_has_a_web_leg_in_the_audit(monkeypatch):
    """The grounding audit passed an empty result, so `web_search` never
    appeared and FIVE questions read as missing a web leg the fast lane makes
    on literally every call. An audit that reports a miss the lane cannot have
    is the cold-desk trap one level down."""
    from api.services.ai_search_eval import runner
    monkeypatch.setattr(ai, "_grounded_system",
                        lambda q: ("SYS", "salt",
                                   {"grounding_sources": ["regime"], "ctx_block": ""}))
    out = runner.run_grounding_audit(question_ids=["S2-06-macro-current"])
    row = out["rows"][0]
    assert "web_search" in row["fired_tools"], row
    assert row["covered"] is True, row
