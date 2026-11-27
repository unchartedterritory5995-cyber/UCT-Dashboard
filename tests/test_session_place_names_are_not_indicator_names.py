"""A market-session place name is a place, never an unknown indicator name (2026-11-26).

The write-capability probe (live, admin measurement only): "On a 15 minute chart, shade the Asian, London and New York
sessions in three different colors" reached the model as "On a 15 minute chart, shade the Asian, London": "New York"
(two Title-Case words) was refused as an unknown named indicator and its whole clause excised, so the model asked
whether the member meant to include New York. Held here: the clause reaches the model whole; the unknown-name rule
still refuses an invented two-word indicator name; the product nouns still read as words. No paid calls.
"""
from __future__ import annotations

import pytest

from tests.test_p2_truth_server import conv, empty_view, emits, env, model  # noqa: F401 -- fixtures by name

CHART = {"sym": "NVDA", "tf": "15"}
THE_REQUEST = "On a 15 minute chart, shade the Asian, London and New York sessions in three different colors."


@pytest.mark.parametrize("words", [THE_REQUEST, "Shade the New York session in blue",
                                   "Mark the Hong Kong open with a vertical line",
                                   "Shade the New Zealand session hours in gray"])
def test_a_session_place_is_read_as_words_and_nothing_is_cut(conv, words):
    u = conv.understand_turn(words, CHART)
    assert u["refusal"] is None
    assert u["not_understood"] == [], u["not_understood"]
    assert u["request_text"].lower() == words.lower(), u["request_text"]


def test_the_request_found_live_reaches_the_model_whole(conv, model):
    e = env(0, [], disposition="clarify", questions=[{"id": "q1", "text": "Which New York clock hours should each session cover?"}])
    client = model([emits(e)])
    r = conv.converse(THE_REQUEST, user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and len(client.calls) == 1, r
    sent = str(client.calls[0]["messages"][0]["content"]).lower()
    assert "new york sessions in three different colors" in sent


def test_CONTROL_an_invented_two_word_name_is_still_an_unknown_name(conv):
    u = conv.understand_turn("Add the Zorblat Oscillator in a pane below", {"sym": "NVDA", "tf": "D"})
    caught = [n["phrase"] for n in u.get("not_understood") or []] + ([u["refusal"].get("reason", "")] if u["refusal"] else [])
    assert any("Zorblat" in str(c) for c in caught), u


def test_CONTROL_the_product_nouns_still_read_as_words(conv):
    u = conv.understand_turn("Show the 14 day RSI in my Info Row", {"sym": "NVDA", "tf": "D"})
    assert u["refusal"] is None and u["not_understood"] == []
