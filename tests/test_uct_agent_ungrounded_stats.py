"""SG-3 (AUDIT live prod f591d31720, 2026-11-04) — no invented market statistics.

"how does SPY do after new 50-day highs", with no event-study kind served, went to the model, which answered with
invented quantitative claims (a typical pullback size and horizon, volume effects) and no data. A historical /
statistical MARKET question answered as TALK — no op read UCT data, no research — is ungrounded by construction:
`turn.guard_ungrounded_stats` replaces such a reply (a figure or a tendency in it) with an honest sentence, the
reply never streams for such a question, and the planner is told the rule. No new model call.

Scripted model, no network, no paid call. The figures below are made up (never a market value).
"""
from __future__ import annotations

import pytest

from api.services.uct_agent import turn
from tests.test_uct_agent import CAPS, CTX, _resp, caller_of, env

INVENTED = ("After new 50-day highs SPY typically pulls back 2-3% within 5 to 10 sessions, "
            "and volume usually fades.")


@pytest.fixture(autouse=True)
def _no_cost(monkeypatch):
    monkeypatch.setattr(turn, "_record_cost", lambda resp: 0.001)


def _run(envelope, message, caps=CAPS, **kw):
    return turn.run_turn(message=message, context=CTX, history=[], capabilities=caps, caller=caller_of(_resp(envelope)),
                         **kw)["envelope"]


@pytest.mark.parametrize("msg", [
    "how does SPY do after new 50-day highs",
    "what usually happens to NVDA after earnings",
    "historically, how does the market do in september",
    "what's the win rate of buying breakouts",
    "how often does QQQ bounce after a 3 day pullback",
])
def test_a_market_statistics_question_is_recognised(msg):
    assert turn.market_stat_question(msg) is True


@pytest.mark.parametrize("msg", [
    "what is a breakout", "explain RSI", "what does it mean when breadth is above 70%", "add the 50 day to my chart",
    "how do I set an alert after earnings", "find stocks near 52-week highs", "how often does breadth refresh",
    "switch to the weekly", "",
])
def test_concepts_how_tos_and_commands_are_not(msg):
    assert turn.market_stat_question(msg) is False


def test_the_live_shape_an_invented_statistical_answer_is_replaced_end_to_end():
    out = _run(env("answer", [], reply=INVENTED), "how does SPY do after new 50-day highs")
    assert out["disposition"] == "answer" and out["ops"] == []
    assert out["reply"] == turn.UNGROUNDED_STATS
    for figure in ("2-3%", "5 to 10", "typically", "usually"):
        assert figure not in out["reply"]


def test_a_tendency_without_a_figure_is_ungrounded_too():
    out = _run(env("answer", [], reply="Breakouts to new highs tend to see follow-through, especially on rising volume."),
               "what usually happens after SPY breaks out")
    assert out["reply"] == turn.UNGROUNDED_STATS


def test_the_event_study_is_offered_only_when_it_was_in_the_request():
    e = env("answer", [], reply=INVENTED)
    assert turn.guard_ungrounded_stats(e, "how does SPY do after new 50-day highs", {"history.afterEvent"})["reply"] \
        == turn.UNGROUNDED_STATS + turn.UNGROUNDED_STATS_STUDY
    assert turn.guard_ungrounded_stats(e, "how does SPY do after new 50-day highs", {"stock.quote"})["reply"] == turn.UNGROUNDED_STATS


@pytest.mark.parametrize("reply", [
    "I can't answer that from UCT's data — there's no study for it here.",
    "A breakout is a close above a prior resistance level.",
])
def test_an_honest_or_figure_free_reply_stands(reply):
    e = env("answer", [], reply=reply)
    assert turn.guard_ungrounded_stats(e, "how does SPY do after new 50-day highs", None) == e


def test_a_concept_answer_with_figures_stands_and_a_plan_is_never_touched():
    e = env("answer", [], reply="RSI above 70 is usually called overbought.")
    assert turn.guard_ungrounded_stats(e, "explain RSI", None) == e
    plan = env("apply", [{"action": "chart.setTimeframe", "target": "c1", "args": {"timeframe": "W"}}], reply="")
    assert turn.guard_ungrounded_stats(plan, "how does SPY do after new 50-day highs", None) == plan


def test_the_planner_is_told_the_rule_and_the_reply_never_streams_for_such_a_question():
    assert "HISTORICAL / STATISTICAL MARKET QUESTIONS" in turn._SYSTEM_HEAD + turn._SYSTEM_TAIL
    src = open(turn.__file__, encoding="utf-8").read()
    assert "and not market_stat_question(msg)))" in src
