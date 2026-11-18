"""A REQUEST OPENER IS GRAMMAR, never the first word of a name; and "moving average" is a phrase.

Found by measuring, 2026-11-18. The unknown-name rule reads a run of two or more Title-Case words
as a named indicator. A request that OPENS with a verb has a capital on the verb by grammar, so
"Add Inside bar" read as an indicator called "Add Inside" and was refused before any model call.
So did "Show Weekly pivot points" ("Show Weekly"), "Highlight Mondays", "Mark Fridays in blue" and
"Add The 10:00 bar marked" ("Add The"). Of 140 indicator ideas written "Add <Idea>", 56 were
refused for that reason alone. On the chart door an opener standing first in its sentence is now
taken off the run before the question "is this a name?" is asked.

The same measurement found the bare phrase "moving average" was no phrase of the chart door, so
"Plot the Moving Average" and "Add a 50 day Moving Average" were unknown named indicators too.

`/propose`'s planner is unchanged: both are part of `plan(strict_names=True)`.
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
S = lambda n: {"type": "series", "name": n}  # noqa: E731

#: Each was refused before any model call until 2026-11-18, as an unknown indicator named by the
#: first two words.
FREED = [
    "Add Inside bar", "Show Weekly pivot points", "Highlight Mondays", "Mark Fridays in blue",
    "Add The 10:00 bar marked", "Add Weighted MA", "Add Flat base", "Add Distribution day count",
    "Add Average daily range percent", "Add Relative strength line vs SPY", "Add Up/down streak (consecutive closes)",
    "Add New 52-week high for the first time in 30 days", "Add Range expansion bar (range twice its 20-day average)",
    "Done. Show Weekly pivot points",                                       # a second sentence opens again
]
#: A name is still a name after an opener: two or more Title-Case words that nothing accounts for.
STILL_A_NAME = [
    ("Add Gann Fan", "Gann Fan"), ("Add the Gann Fan", "Gann Fan"), ("Show Hull Suite", "Hull Suite"),
    ("Add Klinger Volume Oscillator", "Klinger Volume Oscillator"), ("Done. Add Schaff Trend Cycle", "Schaff Trend Cycle"),
    ("Klinger Volume Oscillator", "Klinger Volume Oscillator"),             # typed alone: "Klinger" opens no request
]


@pytest.mark.parametrize("message", FREED)
def test_an_opener_and_one_capitalised_word_is_not_a_named_indicator(conv, message):
    got = conv.understand_turn(message, CHART)
    assert got["refusal"] is None, (message, got["refusal"])
    assert got["not_understood"] == [] and got["request_text"] == message.strip()


@pytest.mark.parametrize("message, phrase", STILL_A_NAME)
def test_a_name_after_an_opener_is_still_a_name_and_is_named_without_the_opener(conv, clean_env, model, message, phrase):
    client = model([])
    r = conv.converse(message, user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is False and r["gate"] == "concept:ungrounded" and client.calls == [], r
    assert r["not_understood"][0]["phrase"] == phrase                       # "Gann Fan", never "Add Gann Fan"


def test_an_opener_is_excused_only_where_a_sentence_opens_when_it_comes_to_dropping_it():
    lex = __import__("api.services.definition_conversation", fromlist=["x"]).CHART_LEXICON

    def names(text):
        return [n["key"] for n in dc._named_phrases(text, dc._matches(text, lex), lex)]
    assert names("Add Inside bar") == []
    assert names("then Add Inside bar") == ["Add Inside"]                   # mid-sentence a capital is not grammar: the older reading
    assert names("Add Gann Fan") == ["Gann Fan"]
    assert names("Inside Bar Gann") == ["Inside Bar Gann"]                  # "Inside" opens no request: it stays in the run
    # the pieces
    first = list(dc._WORD_TOKEN.finditer("Add Inside bar. Show it"))
    assert dc._opens_a_sentence("Add Inside bar. Show it", first[0]) is True
    assert dc._opens_a_sentence("Add Inside bar. Show it", first[1]) is False     # not first
    assert dc._opens_a_sentence("Add Inside bar. Show it", first[3]) is True      # after the full stop
    assert dc._opens_a_sentence("Klinger Volume", list(dc._WORD_TOKEN.finditer("Klinger Volume"))[0]) is False


def test_mid_sentence_an_opener_is_still_no_part_of_a_name(conv):
    """"so Add Bollinger Bands": the run is three words and overlaps something known, and "Add" is
    not a word any name is made of, so nothing in it is foreign."""
    assert conv.understand_turn("so Add Bollinger Bands", CHART)["refusal"] is None
    got = conv.understand_turn("so Add Klinger Volume Oscillator", CHART)
    assert got["refusal"] is not None                                       # "Klinger" still is


def test_PROPOSE_keeps_the_older_reading():
    """The Screener door's planner is unchanged: with the rule off, an opener still counts."""
    off = dc.plan("Add Inside bar", dc.INDICATOR_KIND)
    assert [n["phrase"] for n in off["not_understood"]] == ["Add Inside"]
    on = dc.plan("Add Inside bar", dc.INDICATOR_KIND, strict_names=True)
    assert on["not_understood"] == []


# ── "moving average" ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("message", [
    "Plot the Moving Average", "Add a 50 day Moving Average", "add a moving average", "show two moving averages",
    "What does the Moving Average do?",
])
def test_moving_average_is_a_phrase_with_the_rule_for_which_kind(conv, message):
    got = conv.understand_turn(message, CHART)
    assert got["refusal"] is None, got["refusal"]
    (term,) = [t for t in got["notes"]["matched_terms"] if t["entry"] == "moving_average"]
    assert term["rule"] == conv.GENERIC_PHRASES["moving average"][1]
    assert "simple average (sma)" in term["rule"] and "`assumptions`" in term["rule"]


def test_a_generic_phrase_never_takes_a_phrase_that_already_means_something(conv, monkeypatch):
    """ADDED, NEVER REPLACED: were "bollinger bands" listed as a generic phrase, the Bollinger
    function would keep it."""
    stems, _cost = dc._stem_key(dc._form_tokens("bollinger bands"))
    before = conv.CHART_LEXICON["index"][stems]
    monkeypatch.setattr(conv, "GENERIC_PHRASES", {**conv.GENERIC_PHRASES, "bollinger bands": ("generic_bands", "a rule")})
    rebuilt = conv._chart_lexicon(conv.dc.LEXICON)
    assert rebuilt["index"][stems] == before
    ma, _cost = dc._stem_key(dc._form_tokens("moving average"))
    assert rebuilt["index"][ma][0]["key"] == "moving_average"


def test_a_named_kind_of_average_is_still_that_kind(conv):
    for message, entry in (("Add the Simple Moving Average", "sma"), ("Add the Exponential Moving Average", "ema"),
                           ("Add the Weighted Moving Average", "wma"), ("Add the Hull Moving Average", "hma"),
                           ("Add the Kaufman Adaptive Moving Average", "kaufman_adaptive_moving_average")):
        got = conv.understand_turn(message, CHART)
        names = [t["name"] for t in got["terms"]]
        assert names == [entry], (message, names)                           # the longer phrase wins: never "moving_average"


def test_the_moving_average_is_built_and_the_rule_reaches_the_assistant(conv, clean_env, model):
    patch = env(0, [{"op": "create", "name": "50 day average", "placement": "price",
                     "outputs": [{"key": "ma", "tree": call("sma", S("close"), num(50))}]}],
                assumptions=[{"output": "ma", "text": "I used a simple average."}])
    client = model([emits(patch)])
    r = conv.converse("Add a 50 day Moving Average", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["attempts"] == 1 and len(client.calls) == 1
    assert "a moving average with no kind named" in json.dumps(client.calls[0]["messages"][0]["content"])
