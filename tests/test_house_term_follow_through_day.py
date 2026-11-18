"""A HOUSE TERM HOLDS ITS OWN CONVENTION (ruling 2026-11-18).

"Follow-through day" is the firm's term. Asked for "day 4 through day 12 after the lowest low", the
assistant counted the day of the low as day 1 (the low 3 to 11 bars back), and said so. The house
counts the day AFTER the low as day 1 (4 to 12 bars back). It was the one house indicator still
graded different after the instruction changes of that day; everything else in it matched.

A firm definition settles a house term, so the convention is handed to the assistant with the term
and is never a question. (Whether a GENERIC request that counts days from a low should be asked
about was measured on the requests on file first: 1 of 965, and that one is this term's own
request. No question was added.)
"""
from __future__ import annotations

import json

import pytest

from tests.test_p2_truth_server import call, conv, emits, empty_view, env, model, num  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name
from tests.test_rollout_telemetry import store  # noqa: F401 -- fixture by name

CHART = {"sym": "SPY", "tf": "D"}
S = lambda n: {"type": "series", "name": n}  # noqa: E731
op = lambda name, *a: {"type": "op", "name": name, "args": list(a)}  # noqa: E731
off = lambda node, n: {"type": "offset", "value": n, "args": [node]}  # noqa: E731
HOUSE = ("Mark a follow-through day: a close up 1.7% or more on higher volume than the day before, but only "
         "from day 4 through day 12 after the lowest low of the last 50 sessions.")


def the_term(conv, words):
    got = conv.understand_turn(words, CHART)
    assert got["refusal"] is None, got["refusal"]
    return [t for t in got["notes"]["matched_terms"] if t["entry"] == "follow_through_day"]


@pytest.mark.parametrize("words", [HOUSE, "mark follow through days", "Add a Follow-Through Day marker", "show me every FOLLOW THROUGH DAY"])
def test_the_term_is_recognised_however_it_is_written_and_carries_the_convention(conv, words):
    (term,) = the_term(conv, words)
    assert term["rule"] == conv.FOLLOW_THROUGH_DAY_RULE
    rule = term["rule"]
    assert "HOUSE TERM" in rule and "THE DAY AFTER THE LOWEST LOW IS DAY 1" in rule
    assert "lowestbars(low, 50) >= 4 and lowestbars(low, 50) <= 12" in rule            # the worked example, in the engine's words
    assert "PREVIOUS close" in rule                                                    # the up-day ruling, restated for this term
    assert "ASK" not in rule and "clarify" not in rule                                 # a house term is never a question


def test_it_is_handed_to_the_assistant_and_the_door_asks_nothing(store, conv, clean_env, model):
    """One call, and the convention is in what the assistant read. Built to the house reference."""
    gain = op(">=", op("/", op("-", S("close"), off(S("close"), 1)), off(S("close"), 1)), num(0.017))
    volume = op(">", S("volume"), off(S("volume"), 1))
    days = op("&&", op(">=", call("lowestbars", S("low"), num(50)), num(4)), op("<=", call("lowestbars", S("low"), num(50)), num(12)))
    built = env(0, [{"op": "create", "name": "Follow-Through Day", "placement": "price",
                     "outputs": [{"key": "ftd", "tree": op("&&", op("&&", gain, volume), days)}]}])
    client = model([emits(built)])
    assert conv.door_question(conv.understand_turn(HOUSE, CHART), empty_view(0)) is None
    r = conv.converse(HOUSE, user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["disposition"] == "change" and len(client.calls) == 1, r.get("reason")
    sent = json.dumps(client.calls[0]["messages"][0]["content"])
    assert "THE DAY AFTER THE LOWEST LOW IS DAY 1" in sent and "HOUSE TERM" in sent


def test_a_request_that_does_not_name_the_term_is_not_handed_it(conv):
    for words in ("Add a 20 day EMA", "mark a close up 2% on higher volume", "follow the 50 day line through the day",
                  "4 to 12 days after the lowest low of the last 50 sessions, mark an up close"):
        assert the_term(conv, words) == [], words


def test_the_generic_phrases_are_the_two_terms_and_no_more(conv):
    assert {key for key, _rule in conv.GENERIC_PHRASES.values()} == {"moving_average", "follow_through_day"}
    assert conv.GENERIC_PHRASES["follow through day"][1] is conv.GENERIC_PHRASES["follow through days"][1]
    # naming the house term does not open the moving-average questions
    assert conv.open_questions(conv.understand_turn(HOUSE, CHART)) == []
