"""A strategy or a backtest is never told UCT has no strategy tester (2026-11-26, coordinator's ruling 1).

Step 1 (#2859): the door's own sentence on a strategy request. Step 2 (the assistant writes strategies): that sentence
said the assistant does not write strategies, which is no longer true, so it is retired. What stays is the SCRUB: on a
strategy request, no sentence claiming UCT cannot backtest reaches the member, on a decline or a build; a decline left
with nothing true is answered with the door's sentence. A request that is not for a strategy is untouched. No paid calls.
"""
from __future__ import annotations

import json

import pytest

from tests.test_p2_truth_server import conv, emits, empty_view, env, model  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name
from tests.test_script_conversation import ask, lane, writes  # noqa: F401 -- fixtures by name

THE_REQUEST = ("Backtest a strategy that buys when the 20 EMA crosses above the 50 EMA and sells when it crosses below, "
               "with a 7% stop loss.")
SAID_LIVE = ("I can't backtest here — this builds indicators that draw on your chart, not a strategy tester, so there "
             "are no simulated trades, equity curve or win-rate statistics.")


def member_text(r):
    return json.dumps({k: r.get(k) for k in ("reply", "reason")} | {"envelope_reply": (r.get("envelope") or {}).get("reply")},
                      ensure_ascii=False)


@pytest.mark.parametrize("words,yes", [
    (THE_REQUEST, True),
    ("Write a strategy that buys a breakout above the 20 day high and exits on a close below the 10 day low.", True),
    ("Strategy: go long when the 2 period RSI is below 10 and the close is above the 200 day SMA.", True),
    ("backtest the RSI 2 idea", True),
    ("Plot the 14 day RSI with lines at 30 and 70", False),
    ("My swing strategy uses the 21 EMA, plot it in blue", False),
    ("Mark the days where volume is twice its average", False),
])
def test_what_counts_as_a_strategy_request(conv, words, yes):
    assert conv.asks_for_strategy(words) is yes, words


def test_THE_CASE_a_decline_that_only_claims_no_tester_is_answered_with_the_doors_sentence(conv, clean_env, model, lane):
    model([writes(disposition="unsupported", reply="A strategy is not something I can write; " + SAID_LIVE)])
    r = ask(conv, THE_REQUEST)
    text = member_text(r)
    assert conv.STRATEGY_DECLINE in text
    assert "strategy tester" not in text and "can't backtest" not in text


def test_a_decline_keeps_its_true_sentences(conv, clean_env, model, lane):
    model([writes(disposition="unsupported", reply="A 7% stop that trails the position needs a broker rule not confirmed "
                                                   "yet. " + SAID_LIVE)])
    r = ask(conv, THE_REQUEST)
    assert "needs a broker rule not confirmed yet" in r["reason"] and "strategy tester" not in r["reason"]


def test_a_formula_decline_alone_loses_the_false_claim(conv, clean_env, model):
    model([emits(env(0, [], disposition="unsupported", reply=SAID_LIVE))])
    r = conv.converse(THE_REQUEST, user_id="u1", view=empty_view(0))
    assert r["reply"] == conv.STRATEGY_DECLINE and r["envelope"]["reply"] == conv.STRATEGY_DECLINE


def test_a_build_loses_the_false_claim(conv, clean_env, model, lane):
    reply = ("This engine only builds indicators, not backtestable strategies, so here is the signal version. "
             "It plots the prior 20-bar high and the prior 10-bar low and marks each entry and exit.")
    model([writes(reply=reply)])
    r = ask(conv, "Write a strategy that buys a breakout above the 20 day high and exits on a close below the 10 day low.")
    assert r["ok"] is True and r["turn"] == "script"
    assert "only builds indicators" not in r["reply"] and "It plots the prior 20-bar high" in r["reply"]
    assert "doesn't write strategies" not in r["reply"]


def test_CONTROL_a_request_that_is_not_for_a_strategy_is_untouched(conv, clean_env, model, lane):
    model([emits(env(0, [], disposition="unsupported", reply="A formula cannot hold that.")),
           writes(disposition="unsupported", reply="The engine has no earnings data.")])
    r = ask(conv, "Show the five largest volume days of the year")
    assert conv.STRATEGY_DECLINE not in member_text(r)
