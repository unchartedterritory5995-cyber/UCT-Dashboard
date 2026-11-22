"""SG-3 (AUDIT live prod f591d31720, 2026-11-04) — no invented market statistics: the PLANNER RULE.

"how does SPY do after new 50-day highs", with no event-study kind served, went to the model, which answered with
invented quantitative claims and no data. The planner is told: a historical / statistical market question is answered
ONLY by planning an action that reads UCT's data; with none, it says it can't answer from UCT's data yet and gives no
figures, ranges, typical moves or tendencies from general knowledge.

(A server-side output check was reviewed in #815 and withdrawn: a word-list classifier on the question had false
positives on coaching, education, UCT help and the member's own data. Its structural replacement — no market-outcome
figures in a reply that read no data — is designed separately.)
"""
from __future__ import annotations

from api.services.uct_agent import turn


def test_the_planner_is_told_to_answer_market_statistics_only_from_uct_data():
    prompt = turn._SYSTEM_HEAD + turn._SYSTEM_TAIL
    assert "HISTORICAL / STATISTICAL MARKET QUESTIONS" in prompt
    rule = prompt[prompt.index("HISTORICAL / STATISTICAL MARKET QUESTIONS"):].split("\n", 1)[0]
    assert "answer ONLY by planning an action that reads UCT's data" in rule
    assert "never give figures, ranges, typical moves or tendencies from general knowledge" in rule


def test_no_word_list_guard_and_streaming_is_unchanged():
    assert not hasattr(turn, "guard_ungrounded_stats") and not hasattr(turn, "market_stat_question")
    src = open(turn.__file__, encoding="utf-8").read()
    assert "and not kn_on))      # review #768: knowledge on → an answer never streams" in src
