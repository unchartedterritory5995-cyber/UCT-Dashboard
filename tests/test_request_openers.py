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
OWNER RULING, 2026-11-18: a moving average with no kind named is a QUESTION, never an assumption.

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
    ("Add Brannock Volume Oscillator", "Brannock Volume Oscillator"), ("Done. Add Hartwell Trend Cycle", "Hartwell Trend Cycle"),
    ("Brannock Volume Oscillator", "Brannock Volume Oscillator"),             # typed alone: "Brannock" opens no request
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
    assert names("then Add Inside bar") == []                               # "inside bar" is a house term now (chart_twins.PATTERNS)
    assert names("then Add Brannock bar") == ["Add Brannock"]               # mid-sentence a capital is not grammar: the older reading
    assert names("Add Gann Fan") == ["Gann Fan"]
    assert names("Inside Bar Gann") == ["Inside Bar Gann"]                  # "Inside" opens no request: it stays in the run
    # the pieces
    first = list(dc._WORD_TOKEN.finditer("Add Inside bar. Show it"))
    assert dc._opens_a_sentence("Add Inside bar. Show it", first[0]) is True
    assert dc._opens_a_sentence("Add Inside bar. Show it", first[1]) is False     # not first
    assert dc._opens_a_sentence("Add Inside bar. Show it", first[3]) is True      # after the full stop
    assert dc._opens_a_sentence("Brannock Volume", list(dc._WORD_TOKEN.finditer("Brannock Volume"))[0]) is False


def test_mid_sentence_an_opener_is_still_no_part_of_a_name(conv):
    """"so Add Bollinger Bands": the run is three words and overlaps something known, and "Add" is
    not a word any name is made of, so nothing in it is foreign."""
    assert conv.understand_turn("so Add Bollinger Bands", CHART)["refusal"] is None
    got = conv.understand_turn("so Add Brannock Volume Oscillator", CHART)
    assert got["refusal"] is not None                                       # "Brannock" still is


def test_PROPOSE_keeps_the_older_reading():
    """The Screener door's planner is unchanged: with the rule off, an opener still counts."""
    off = dc.plan("Add Inside bar", dc.INDICATOR_KIND)
    assert [n["phrase"] for n in off["not_understood"]] == ["Add Inside"]
    on = dc.plan("Add Inside bar", dc.INDICATOR_KIND, strict_names=True)
    assert on["not_understood"] == []


# ── "moving average": OWNER RULING 2026-11-18 -- ask which kind, never assume ─────────────────────

BARE = ["add a 50 day moving average", "Add a 50 day Moving Average", "Plot the Moving Average", "add a 50 MA",
        "add the 200 dma", "20 and 50 day moving averages", "show two moving averages"]
#: (each names its LENGTH too: a kind with no length anywhere is asked for the length,
#: `tests/test_clarify_registry.py`. A library average brings its own numbers.)
KIND_NAMED = [("add a 50 day SMA", "sma"), ("50 day simple moving average", "sma"), ("50 EMA", "ema"),
              ("Add the 21 day Exponential Moving Average", "ema"), ("add a 20 day weighted moving average", "wma"),
              ("Add a 55 bar Hull Moving Average", "hma"), ("Add the Kaufman Adaptive Moving Average", "kaufman_adaptive_moving_average")]


@pytest.mark.parametrize("message", BARE)
def test_a_moving_average_with_no_kind_named_ASKS_and_costs_nothing(conv, clean_env, model, message):
    client = model([])                                                      # any model call would fail the turn
    r = conv.converse(message, user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["disposition"] == "clarify" and r["turn"] == "question", r
    assert client.calls == [] and r["attempts"] == 0 and r["cost_usd"] == 0.0 and r["asked_by"] == "door"
    (question,) = r["envelope"]["questions"]
    assert question["id"] == "average_kind" and question["text"] == "Which kind of moving average?"
    assert question["choices"][:2] == ["Simple (SMA)", "Exponential (EMA)"] and len(question["choices"]) == 6
    assert r["envelope"]["ops"] == [] and "assumptions" not in r["envelope"]      # nothing built, nothing assumed
    assert conv.check_envelope(r["envelope"], 0, empty_view(0))               # the door's own question passes the door


@pytest.mark.parametrize("message, kind", KIND_NAMED)
def test_a_named_kind_builds_without_asking(conv, clean_env, model, message, kind):
    tree = call(kind if kind in ("sma", "ema", "wma", "hma") else "ema", S("close"), num(50))
    if kind == "kaufman_adaptive_moving_average":
        from api.services import named_indicators as ni
        tree = ni.entry(kind)["outputs"][0]["tree"]
    patch = env(0, [{"op": "create", "name": "Average", "placement": "price", "outputs": [{"key": "ma", "tree": tree}]}])
    client = model([emits(patch)])
    r = conv.converse(message, user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["disposition"] == "change" and len(client.calls) == 1, r
    assert [t["name"] for t in conv.understand_turn(message, CHART)["terms"]] == [kind]     # the longer phrase wins
    assert conv.door_question(conv.understand_turn(message, CHART), empty_view(0)) is None


def test_every_choice_the_door_offers_reads_back_as_that_kind(conv, clean_env, model):
    """The member's answer is the next message. Each choice must be words this door understands as
    the kind it names, and must not make it ask again."""
    want = ["sma", "ema", "wma", "hma", "vwma", "kaufman_adaptive_moving_average"]
    assert len(conv.AVERAGE_QUESTION["choices"]) == len(want)
    for choice, kind in zip(conv.AVERAGE_QUESTION["choices"], want):
        got = conv.understand_turn(choice, CHART)
        assert got["refusal"] is None and kind in [t["name"] for t in got["terms"]], (choice, got["terms"])
        assert not conv.asks_which_average(got, empty_view(0)), choice
    # and the answer builds: the request plus the answer, one call, the change accepted
    patch = env(0, [{"op": "create", "name": "50 day EMA", "placement": "price",
                     "outputs": [{"key": "ma", "tree": call("ema", S("close"), num(50))}]}])
    client = model([emits(patch)])
    said = [{"role": "member", "text": "add a 50 day moving average"},
            {"role": "assistant", "text": "Which kind of moving average?"}]
    r = conv.converse("Exponential (EMA)", user_id="u1", view=empty_view(0), chart=CHART, snippets=said)
    assert r["ok"] is True and r["disposition"] == "change" and len(client.calls) == 1
    assert "add a 50 day moving average. Exponential (EMA)" in json.dumps(client.calls[0]["messages"][0]["content"])


def test_when_the_door_does_not_ask(conv, clean_env, model):
    # a QUESTION about moving averages is answered, not met with a question
    client = model([emits(env(0, [], disposition="answer", reply="It smooths price."))])
    r = conv.converse("What does the Moving Average do?", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["disposition"] == "answer" and len(client.calls) == 1
    # a request that says nothing of a moving average is never asked about one
    for other in ("Add RSI 14", "Highlight Mondays", "Add the McGinley Dynamic", "close above the 20 day high"):
        assert not conv.asks_which_average(conv.understand_turn(other, CHART), empty_view(0)), other
    # a library entry that IS a kind of average names a kind: the door does not ask; the assistant has the rule
    assert not conv.asks_which_average(conv.understand_turn("a 20 bar moving average and the McGinley Dynamic", CHART), empty_view(0))
    # a kind of average named beside the bare phrase settles it for the assistant
    assert not conv.asks_which_average(conv.understand_turn("price above its moving average and the 20 ema", CHART), empty_view(0))
    # beside an indicator ALREADY on the chart the assistant reads the chart, under the rule: one call, and the rule is in it
    from tests.test_p2_truth_server import out, view
    on_chart = view(1, [out("ma", call("ema", S("close"), num(20)), type_="value")], name="20 EMA")
    edit = env(1, [{"op": "set_output_tree", "output": "ma", "tree": call("ema", S("close"), num(50))}])
    client = model([emits(edit)])
    r = conv.converse("make the moving average 50", user_id="u1", view=on_chart, chart=CHART)
    assert r["ok"] is True and r["disposition"] == "change" and len(client.calls) == 1
    sent = json.dumps(client.calls[0]["messages"][0]["content"])
    assert "NEVER assume a kind" in sent and "ASK which kind" in sent


def test_the_rule_the_assistant_reads_says_ask_never_assume(conv):
    got = conv.understand_turn("add a moving average", CHART)
    (term,) = [t for t in got["notes"]["matched_terms"] if t["entry"] == "moving_average"]
    assert term["rule"] == conv.MOVING_AVERAGE_RULE
    assert "NEVER assume a kind" in term["rule"] and "disposition clarify" in term["rule"]
    assert "simple average (sma) and say so" not in term["rule"]             # the superseded rule
    assert {key for key, _rule in conv.GENERIC_PHRASES.values()} == {"moving_average", "follow_through_day"}


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
