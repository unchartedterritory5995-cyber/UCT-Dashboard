"""Auto-routing the agent lane (2026-08-29), shipped DARK.

Measured, not assumed:
  * the prod capture log reads by_mode = fast 49 / agent 1. The only lane that
    can iterate and call the desk's 16 tools is hidden behind a UI pill.
  * the exam scores that lane 19/30 against the single-shot lane's 13/30, and
    the gap is concentrated in rung 3 — "give me the desk's call", where
    grade_ticker / patterns / quote genuinely win over one Perplexity shot.

So: when a member asks for the desk's CALL and has not pinned a mode, use the
lane that is measurably better at exactly that.

⛔ The trigger is `_VERDICT_RE` — the gate that ALREADY decides "this is a
request for the desk's call". A second regex meaning the same thing is this
repo's most repeated defect (lesson_a_second_authority_over_one_value).

⛔ Default OFF. The agent lane bills 2 units against a $15/day cap surface and
is slower; arming it is the owner's call, one Railway var.
"""
import pytest

import api.routers.ai_search as ai

VERDICT_ASK = "what's the desk read on NVDA"
PLAIN_ASK = "what were the biggest gainers today"


@pytest.fixture(autouse=True)
def _armed(monkeypatch):
    monkeypatch.setenv("AI_SEARCH_AGENT_AUTOROUTE", "1")


def test_a_request_for_the_desks_call_routes_to_the_agent():
    assert ai._wants_agent(VERDICT_ASK, None) is True


def test_a_plain_question_stays_on_the_fast_lane():
    """CONTROL — auto-routing everything would double the bill and the latency
    for questions one shot already answers well (rung 5 is 5/5 on the fast lane)."""
    assert ai._wants_agent(PLAIN_ASK, None) is False


@pytest.mark.parametrize("pinned", ["fast", "reasoning"])
def test_an_explicit_client_mode_always_wins(pinned):
    """CONTROL — a member who picked a lane keeps it. Auto-routing is for the
    default, never an override of a stated choice."""
    assert ai._wants_agent(VERDICT_ASK, pinned) is False


def test_the_flag_is_off_by_default(monkeypatch):
    """⛔ The load-bearing safety property: this costs 2 units per ask against a
    $15/day cap. Shipping it live-by-default would be a spend change nobody
    approved."""
    monkeypatch.delenv("AI_SEARCH_AGENT_AUTOROUTE", raising=False)
    assert ai._wants_agent(VERDICT_ASK, None) is False


def test_disarming_the_flag_stops_it(monkeypatch):
    monkeypatch.setenv("AI_SEARCH_AGENT_AUTOROUTE", "0")
    assert ai._wants_agent(VERDICT_ASK, None) is False


def test_the_trigger_is_the_existing_verdict_gate():
    """Derived, not restated: every phrasing the verdict gate already knows must
    route, so the two can never disagree about what "the desk's call" means."""
    for q in ("give me your verdict on AMD", "should i buy TSLA here",
              "where's the entry on TSLA", "which has the best setup"):
        assert ai._VERDICT_RE.search(q), q
        assert ai._wants_agent(q, None) is True, q


def test_pinning_agent_still_works_with_the_flag_off(monkeypatch):
    """CONTROL — the pill must keep working exactly as before; this change is
    purely additive to the DEFAULT path."""
    monkeypatch.delenv("AI_SEARCH_AGENT_AUTOROUTE", raising=False)
    assert (ai._agent_pinned("agent") is True
            and ai._agent_pinned("fast") is False
            and ai._agent_pinned(None) is False)


def test_the_stream_endpoint_actually_consults_the_router():
    """lesson_built_tested_green_and_unreachable — the agent lane was hidden
    behind a pill for weeks while being fully built. A routing decision the
    endpoint never asks for would repeat that exactly. Read the source."""
    import ast
    import io
    src = io.open(ai.__file__, encoding="utf-8").read()
    tree = ast.parse(src)
    fn = next((n for n in ast.walk(tree)
               if isinstance(n, ast.FunctionDef) and n.name == "ai_search_stream"), None)
    if fn is None:   # endpoint name differs — fall back to the module text
        assert "_wants_agent(" in src and "_agent_pinned(" in src
        return
    body = ast.unparse(fn)
    assert "_wants_agent(" in body, "the stream endpoint never asks _wants_agent"
    assert "_agent_pinned(" in body


def test_the_endpoint_probe_is_not_vacuous():
    """CONTROL — prove the source really contains the pinned path we replaced,
    so the assertion above cannot pass against an empty read."""
    import io
    src = io.open(ai.__file__, encoding="utf-8").read()
    assert "ai_search_agent.available()" in src


# ── the exam must be able to SEE the routing decision ──────────────────────
def test_the_auto_lane_sends_a_desk_call_ask_to_the_agent(monkeypatch):
    """⛔ My first A/B of this flag was VACUOUS: run_exam(lane="fast") calls
    fast_lane_answer DIRECTLY, so it never consults _wants_agent and both arms
    measured the same code path. Identical scores, identical grounding lines —
    a fixture that cannot distinguish. lane="auto" mirrors the endpoint."""
    from api.services.ai_search_eval import runner
    from api.services.compass_eval import judge, store
    import api.services.ai_search_agent as agent

    monkeypatch.setenv("AI_SEARCH_AGENT_AUTOROUTE", "1")
    monkeypatch.setattr(store, "init_db", lambda *a, **k: None)
    monkeypatch.setattr(store, "record_run", lambda *a, **k: None)
    monkeypatch.setattr(store, "record_score", lambda *a, **k: None)
    monkeypatch.setattr(runner, "_judge_client", lambda: object())
    monkeypatch.setattr(judge, "judge_answer", lambda *a, **k: {
        "correctness": 4, "grounding": 4, "opinion": 4, "safety": 4, "rationale": "ok"})
    monkeypatch.setattr(ai, "_grounded_system",
                        lambda q: ("SYS", "salt",
                                   {"grounding_sources": ["regime", "quote", "verdict"],
                                    "ctx_block": "NVDA last 178.20"}))
    monkeypatch.setattr(agent, "available", lambda: True)

    used = {"agent": False, "fast": False}

    def _agent(query, system, hist, x, capture=None):
        used["agent"] = True
        if capture is not None:
            capture.append({"name": "grade_ticker", "args": {}, "result": "GO"})
        return {"answer": "desk verdict: GO", "tools_used": ["grade_ticker"]}

    def _fast(*a, **k):
        used["fast"] = True
        return {"answer": "one shot", "citations": []}

    monkeypatch.setattr(agent, "run_agent", _agent)
    monkeypatch.setattr(ai, "fast_lane_answer", _fast)

    runner.run_exam(lane="auto", question_ids=["S3-01-verdict-direct"])
    assert used["agent"] is True and used["fast"] is False, used


def test_the_auto_lane_keeps_a_plain_ask_on_one_shot(monkeypatch):
    """CONTROL — the discriminating half. If everything routed to the agent the
    A/B would be vacuous in the other direction."""
    from api.services.ai_search_eval import runner
    from api.services.compass_eval import judge, store
    import api.services.ai_search_agent as agent

    monkeypatch.setenv("AI_SEARCH_AGENT_AUTOROUTE", "1")
    monkeypatch.setattr(store, "init_db", lambda *a, **k: None)
    monkeypatch.setattr(store, "record_run", lambda *a, **k: None)
    monkeypatch.setattr(store, "record_score", lambda *a, **k: None)
    monkeypatch.setattr(runner, "_judge_client", lambda: object())
    monkeypatch.setattr(judge, "judge_answer", lambda *a, **k: {
        "correctness": 4, "grounding": 4, "opinion": 4, "safety": 4, "rationale": "ok"})
    monkeypatch.setattr(ai, "_grounded_system",
                        lambda q: ("SYS", "salt",
                                   {"grounding_sources": ["regime", "movers"], "ctx_block": "x"}))
    monkeypatch.setattr(agent, "available", lambda: True)

    used = {"agent": False, "fast": False}

    def _agent(*a, **k):
        used["agent"] = True
        return {"answer": "x", "tools_used": []}

    def _fast(*a, **k):
        used["fast"] = True
        return {"answer": "one shot", "citations": []}

    monkeypatch.setattr(agent, "run_agent", _agent)
    monkeypatch.setattr(ai, "fast_lane_answer", _fast)

    runner.run_exam(lane="auto", question_ids=["S1-02-movers"])
    assert used["fast"] is True and used["agent"] is False, used
