"""A SYMBOL'S OR AN ACRONYM'S POSSESSIVE IS A REFERENCE, never a word of an indicator's name.

Found in a live round, 2026-11-21. The unknown-name rule reads a run of two or more Title-Case words as a
named indicator and leaves acronyms out by `isupper()`. The possessive's lowercase "s" made "SPY's" fail that
test, so a request that opened with a verb the opener list does not hold, followed by a symbol's possessive,
read as an indicator NAMED by those two words. The clause was withheld from the assistant, which then asked
the member for the symbol and the window they had already written.

On the chart door an all-caps stem's possessive now ends a name run. A PERSON's possessive ("Wilder's
Smoothing") is still the first word of a name. `/propose`'s planner is unchanged.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import json

import pytest

from api.services import definition_concierge as dc
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    call, conv, emits, empty_view, env, model, num,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

CHART = {"sym": "NVDA", "tf": "D"}

#: Each was refused before any model call, as an unknown indicator named by its first two words.
FREED = [
    "Count SPY's distribution days over the last 25 bars",
    "Rank NVDA's volume over 50 bars",
    "Measure QQQ's drawdown from its 52 week high",
    "Average SPY's range over 20 days",
    "Tally QQQ's up days in the last 10",
    "Done. Count IWM's up closes over the last 10 bars",                    # a second sentence, the same shape
    "Smooth RSI's line with a 5 day average",                               # an acronym of ours, owned the same way
]
#: A PERSON's possessive is still the first word of a name nobody here has a formula for.
STILL_A_NAME = [
    ("Wilder's Smoothing of the close", "Wilder's Smoothing"),
    ("Brannock's Volume Oscillator", "Brannock's Volume Oscillator"),
    ("Show Hartwell's Trend Cycle", "Hartwell's Trend Cycle"),
    ("Add Brannock Volume Oscillator", "Brannock Volume Oscillator"),       # and a name with no possessive at all
]


@pytest.mark.parametrize("message", FREED)
def test_a_symbols_possessive_after_a_verb_is_not_a_named_indicator(conv, message):
    got = conv.understand_turn(message, CHART)
    assert got["refusal"] is None, (message, got["refusal"])
    assert got["not_understood"] == [] and got["request_text"] == message.strip()


@pytest.mark.parametrize("message, phrase", STILL_A_NAME)
def test_a_persons_possessive_is_still_the_first_word_of_a_name(conv, clean_env, model, message, phrase):
    client = model([])
    r = conv.converse(message, user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is False and r["gate"] == "concept:ungrounded" and client.calls == [], r
    assert r["not_understood"][0]["phrase"] == phrase


def test_what_counts_as_an_acronyms_possessive():
    yes = ["SPY's", "QQQ's", "RSI's", "NVDA's", "AT's", "BRK'S"]
    no = ["Wilder's", "Brannock's", "A's",          # a person; a person; ONE capital is no acronym
          "SPY", "SPYs", "Spy's", "McGinley's",     # no possessive; no apostrophe; not all capitals; an internal capital
          "SPY'd", "'s", "s"]
    assert [w for w in yes if not dc._acronym_possessive(w)] == []
    assert [w for w in no if dc._acronym_possessive(w)] == []


def test_the_possessive_ends_the_run_and_only_on_the_chart_door():
    lex = __import__("api.services.definition_conversation", fromlist=["x"]).CHART_LEXICON

    def names(text, lexicon=lex):
        return [n["key"] for n in dc._named_phrases(text, dc._matches(text, lex), lexicon)]
    assert names("Count SPY's distribution days") == []
    # ⛔ it ENDS the run, it is not skipped over: the words on its two sides are never joined into one name
    assert names("Brannock SPY's Oscillator") == []
    assert names("Brannock Volume SPY's Hartwell Cycle") == ["Brannock Volume", "Hartwell Cycle"]
    # CONTROL: the same words with no possessive are one run, so the two lines above are the possessive's doing
    assert names("Brannock Volume Hartwell Cycle") == ["Brannock Volume Hartwell Cycle"]
    # the older reading, where the rule is off (`strict_lexicon=None`)
    assert names("Count SPY's distribution days", None) == ["Count SPY's"]


def test_PROPOSE_keeps_the_older_reading():
    """The Screener door's planner is unchanged: with the rule off, the possessive still counts."""
    words = "Count SPY's distribution days over the last 25 bars"
    off = dc.plan(words, dc.INDICATOR_KIND)
    assert [n["phrase"] for n in off["not_understood"]] == ["Count SPY's"]
    on = dc.plan(words, dc.INDICATOR_KIND, strict_names=True)
    assert on["not_understood"] == []


def test_the_clause_reaches_the_assistant_whole(conv, clean_env, model):
    """What the miss cost: the clause holding the symbol and the window was withheld, so the assistant
    asked for both. The request now reaches the model call with every word of it."""
    words = "Count SPY's distribution days over the last 25 bars"
    client = model([])
    conv.converse(words, user_id="u1", view=empty_view(0), chart=CHART)
    assert len(client.calls) >= 1                                            # a model call is made at all
    sent = json.dumps(client.calls[0], default=str)                          # (json leaves an apostrophe as it is)
    assert "Count SPY's distribution days over the last 25 bars" in sent
