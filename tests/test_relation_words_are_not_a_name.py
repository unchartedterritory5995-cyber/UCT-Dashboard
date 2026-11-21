"""A RUN MADE ONLY OF RELATION WORDS IS A RELATION, never an indicator's name.

Found in a live round, 2026-11-21. The chart door reads a run of two or more Title-Case words that no known
phrase overlaps as a named indicator. "Signal When RSI 14 Crosses Above 70", typed in Title Case, was refused
before any model call as an unknown indicator NAMED "Crosses Above".

On the chart door a run in which EVERY word is one of the door's own relation words is now a relation. The
word set is DERIVED, never listed: the words of the closed table's `sentence` for each function that yields
true or false, plus the lexicon's own phrases for those functions (`definition_concierge._relation_stems`).

⛔ THE BROADER RULE WAS MEASURED AND REFUSED: reading a short run as a name only when it holds a word the
product does not know also un-refused real named indicators nobody here has a formula for. Those names are
held here, so the broader rule cannot arrive quietly.

`/propose`'s planner is unchanged. No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import copy
import json

import pytest

from api.services import ast_table
from api.services import definition_concierge as dc
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    conv, empty_view, model,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

CHART = {"sym": "NVDA", "tf": "D"}

#: Each was refused before any model call, as an unknown indicator named by its relation words.
FREED = [
    ("Signal When RSI 14 Crosses Above 70", "Crosses Above"),
    ("Show When RSI Crosses Below 30", "Crosses Below"),
    ("RSI Crossing Above 50", "Crossing Above"),
    ("EMA 9 Crossing Below EMA 21", "Crossing Below"),
]
#: Names nobody here has a formula for. EVERY ONE MUST STAY REFUSED BY NAME: the first eight are the real named
#: indicators the broader rule let through when it was measured; the next four hold a relation word beside
#: other words; the rest hold a word the product has never used.
STILL_A_NAME = [
    ("Range Filter", "Range Filter"), ("Volatility Stop", "Volatility Stop"), ("Pivot Points", "Pivot Points"),
    ("Three Line Break", "Three Line Break"), ("Arms Index", "Arms Index"), ("Bullish Percent Index", "Bullish Percent Index"),
    ("Add Put Call Ratio", "Put Call Ratio"), ("Count Back Line", "Count Back Line"),
    ("Falling Wedge", "Falling Wedge"), ("Above The Stomach", "Above The Stomach"),
    ("Crossing Guard Oscillator", "Crossing Guard Oscillator"), ("Bars Above Brannock", "Bars Above Brannock"),
    ("Brannock Volume Oscillator", "Brannock Volume Oscillator"), ("Hartwell Trend Cycle", "Hartwell Trend Cycle"),
    ("Add Gann Fan", "Gann Fan"), ("Price Action Channel", "Price Action Channel"), ("Relative Vigor Index", "Relative Vigor Index"),
]
#: KNOWN AND NOT COVERED, on record so a later change has to say so here: the run holds a word that is no
#: relation word of the table ("zero", "day", "average", "up", "days").
STILL_REFUSED_AND_KNOWN = [
    ("Alert When MACD Crosses Above Zero", "Crosses Above Zero"),
    ("Plot When Price Crosses Below The 50 Day Average", "Day Average"),
    ("Up Days", "Up Days"),
]


def _lex():
    return __import__("api.services.definition_conversation", fromlist=["x"]).CHART_LEXICON


def _refused(words, lexicon=None, strict=True):
    lex = _lex() if lexicon is None else lexicon
    got = dc.plan(words, dc.INDICATOR_KIND, lexicon=lex, strict_names=True) if strict else dc.plan(words, dc.INDICATOR_KIND)
    return [n["phrase"] for n in got["not_understood"]]


@pytest.mark.parametrize("message, was", FREED)
def test_a_relation_typed_in_title_case_is_not_a_named_indicator(conv, message, was):
    got = conv.understand_turn(message, CHART)
    assert got["refusal"] is None, (message, got["refusal"])
    assert got["not_understood"] == [] and got["request_text"] == message.strip()
    # and it WAS the relation words that were refused: with the rule off, they still are
    assert was in _refused(message, strict=False)


@pytest.mark.parametrize("message, phrase", STILL_A_NAME)
def test_a_name_is_still_refused_by_name(message, phrase):
    assert _refused(message) == [phrase]


@pytest.mark.parametrize("message, phrase", STILL_A_NAME[:6])
def test_a_refused_name_costs_no_model_call(conv, clean_env, model, message, phrase):
    client = model([])
    r = conv.converse(message, user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is False and r["gate"] == "concept:ungrounded" and client.calls == [], r
    assert r["not_understood"][0]["phrase"] == phrase


@pytest.mark.parametrize("message, phrase", STILL_REFUSED_AND_KNOWN)
def test_what_this_rule_does_not_cover_is_still_refused(message, phrase):
    assert _refused(message) == [phrase]


def test_every_word_of_the_run_must_be_a_relation_word():
    lex = _lex()
    words = lambda text: list(dc._WORD_TOKEN.finditer(text))  # noqa: E731
    assert dc._only_relation_words(words("Crosses Above"), lex) is True
    assert dc._only_relation_words(words("Crossing Below"), lex) is True
    assert dc._only_relation_words(words("Rising For Bars"), lex) is True
    for text in ("Crosses Above Zero", "Falling Wedge", "Above The Stomach", "Up Days", "Range Filter", "Brannock"):
        assert dc._only_relation_words(words(text), lex) is False, text
    assert dc._only_relation_words([], lex) is False                         # no words is no relation


# ── ⛔ THE WORD SET IS DERIVED ────────────────────────────────────────────────────────────────────

def test_the_relation_words_are_the_tables_true_or_false_functions_and_the_lexicons_phrases_for_them():
    lex = _lex()
    functions = ast_table.TABLE[ast_table.FUNCTIONS_SECTION]
    relations = sorted(name for name, spec in functions.items() if spec.get("yields") == "bool")
    assert {"crossOver", "crossUnder", "rising", "falling"} <= set(relations)
    stems = dc._relation_stems(lex)
    # every word of each such function's own sentence is in it ...
    for name in relations:
        for word in dc._WORD_TOKEN.findall(dc._SENTENCE_SLOT.sub(" ", functions[name]["sentence"])):
            assert set(dc._stem_key(dc._form_tokens(word))[0]) <= stems, (name, word)
    # ... and so is every word of each lexicon phrase that names one
    phrases = [key for key, entries in lex["index"].items() if any(e.get("kind") == dc.TABLE_ENTRY and e.get("key") in relations for e in entries)]
    assert phrases, "the lexicon has no phrase for any true/false function: the second source proves nothing"
    for key in phrases:
        assert set(key) <= stems, key
    # and NOTHING else is: no word arrives from anywhere but those two declarations
    want = set()
    for name in relations:
        for word in dc._WORD_TOKEN.findall(dc._SENTENCE_SLOT.sub(" ", functions[name]["sentence"])):
            want.update(dc._stem_key(dc._form_tokens(word))[0])
    for key in phrases:
        want.update(key)
    assert stems == frozenset(want)
    # an ordinary word of the product is not a relation word just for being known
    vocabulary = dc._lexicon_vocabulary(lex)
    assert {"volum", "averag"} & vocabulary and not ({"volum", "averag", "day", "up", "down", "zero"} & stems)


def test_a_true_or_false_function_added_to_the_table_extends_the_set_with_no_edit():
    lex = _lex()
    table = json.loads(json.dumps(ast_table.TABLE, default=lambda o: dict(o) if hasattr(o, "items") else list(o)))
    table[ast_table.FUNCTIONS_SECTION]["touching"] = {"args": ["series", "series"], "yields": "bool", "sentence": "{0} touching {1} exactly"}
    table[ast_table.FUNCTIONS_SECTION]["smoothly"] = {"args": ["series"], "yields": "num", "sentence": "{0} smoothly gliding"}
    before, after = dc._relation_stems(lex), dc._relation_stems(lex, table)
    added = after - before
    assert added == {s for w in ("touching", "exactly") for s in dc._stem_key(dc._form_tokens(w))[0]}
    assert not ({s for w in ("smoothly", "gliding") for s in dc._stem_key(dc._form_tokens(w))[0]} & after)   # a NUMBER function adds nothing
    assert dc._relation_stems(lex) == before                                 # the real table's answer is what it was


def test_a_phrase_the_lexicon_gains_for_a_true_or_false_function_extends_the_set_with_no_edit():
    lex = _lex()
    grown = {**lex, "index": {**lex["index"], ("breach", "upward"): [{"kind": dc.TABLE_ENTRY, "key": "crossOver", "section": "functions", "words": ("breach", "upward"), "cost": 0}],
                               ("glide", "path"): [{"kind": dc.TABLE_ENTRY, "key": "sma", "section": "functions", "words": ("glide", "path"), "cost": 0}]}}
    before, after = dc._relation_stems(lex), dc._relation_stems(grown)
    assert after - before == {"breach", "upward"}                            # the phrase for crossOver
    assert not ({"glide", "path"} & after)                                   # a phrase for a NUMBER function adds nothing
    assert copy.copy(before) == dc._relation_stems(lex)


def test_PROPOSE_keeps_the_older_reading():
    """The Screener door's planner is unchanged: with the rule off, the relation words are still read as a name."""
    words = "Signal When RSI 14 Crosses Above 70"
    assert "Crosses Above" in _refused(words, strict=False)
    assert _refused(words) == []
