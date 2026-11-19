"""THE STOCHASTIC OSCILLATOR: one library entry for the fast, slow and full ones, and the door's
question for which (coordinator's ruling 2026-11-18).

Until now no way of asking for a Stochastic reached a checked formula. "Stochastic Oscillator" was
the phrase of the engine's raw %K function, so it reached the assistant as a bare function and was
built from recollection (in TradingView's argument order: a different number). "Add the Stochastic"
and "a slow stochastic" were recognised by nothing.

Held here:
  * the entry is the library's, by its full name and by "slow", "fast" and "full"; the BARE word is
    never a spelling of it (it is part of other names), and those other names still read as themselves;
  * a request that says neither a kind nor a number is asked which, with no assistant call; the
    slow one is listed first; the choice builds the LIBRARY'S formula, is remembered, and next time
    is used and said;
  * a kind word or any number settles it without a question.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import datetime as dt
import json

import pytest

from api.services import indicator_memory as im
from api.services import indicator_names
from api.services import named_indicators as ni
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    call, conv, emits, empty_view, env, model, num, op,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

CHART = {"sym": "NVDA", "tf": "D"}
ENTRY = ni.entry("stochastic_oscillator")
QUESTION = "Which Stochastic?"
SLOW, FAST = "Slow Stochastic (14, 3, 3)", "Fast Stochastic (14, 1, 3)"


@pytest.fixture
def account():
    return {}


def memory_of(account):
    return im.Memory("u1", reader=lambda u: account.get(u),
                     writer=lambda u, text: account.pop(u, None) if text is None else account.__setitem__(u, text),
                     today=lambda: dt.date(2026, 11, 18))


def library(k_smooth):
    """The patch an assistant sends when it copies the library's formula at this K smoothing."""
    values = {"k_length": 14, "k_smooth": k_smooth, "d_smooth": 3}
    return env(0, [{"op": "create", "name": "Stochastic Oscillator", "placement": "pane",
                    "outputs": [{"key": o["key"], "label": o["label"], "tree": ni.tree_at(o, values)} for o in ENTRY["outputs"]]}])


def read(conv, words):
    u = conv.understand_turn(words, CHART)
    assert u["refusal"] is None, words
    return [e["id"] for e in u["named"]], [w["id"] for w in u["withheld"]], conv.open_questions(u)


def asked(words):
    return [{"role": "member", "text": words}, {"role": "assistant", "text": QUESTION}]


# ═══ 1. what is, and is not, this entry ══════════════════════════════════════

def test_the_entry_is_all_three_and_carries_two_tiers_until_its_capture_lands():
    assert [(p["key"], p["default"]) for p in ENTRY["params"]] == [("k_length", 14), ("k_smooth", 3), ("d_smooth", 3)]
    assert [o["label"] for o in ENTRY["outputs"]] == ["K", "D"]
    k = ENTRY["outputs"][0]["tree"]
    # the bar's fields in the ENGINE'S order (close first is TradingView's, and another number)
    assert k == call("sma", call("stoch", {"type": "series", "name": "high"}, {"type": "series", "name": "low"},
                                 {"type": "series", "name": "close"}, num(14)), num(3))
    assert ni.tiers(ENTRY) == (True, True, False) and ni.passes(ENTRY)
    said = ni.member_sentence(ENTRY, ni.defaults(ENTRY))
    assert "George C. Lane" in said and "TradingView" not in said


def test_the_bare_word_is_never_a_spelling_of_it(conv):
    for alias in ENTRY["aliases"]:
        assert len(alias.split()) >= 2, alias
    # ... so the names that hold the word are still themselves
    assert read(conv, "Add the Stochastic RSI")[0] == ["stochastic_rsi"]
    assert read(conv, "Add the Stochastic Momentum Index") == ([], ["stochastic_momentum_index"], [])
    assert ("stochastic momentum index", "stochastic_momentum_index") in indicator_names.withheld_spellings()
    assert read(conv, "show the stochastic of the RSI") == ([], [], [])                   # a description, the assistant's to read
    # and its full name is the library's, taken from the engine function it is the indicator of
    assert ENTRY["names_function"] == "stoch"
    for words in ("Add the Stochastic Oscillator 14 3 3", "add a slow stochastic", "Add the Fast Stochastic", "the full stochastic 14, 5, 3"):
        assert read(conv, words) == (["stochastic_oscillator"], [], []), words


# ═══ 2. the question ═════════════════════════════════════════════════════════

def test_it_is_asked_once_and_the_choice_builds_the_librarys_formula_and_is_remembered(conv, account, clean_env, model):
    mem = memory_of(account)
    for words in ("Add the Stochastic", "Add the Stochastic Oscillator"):
        client = model([])
        r = conv.converse(words, user_id="u1", view=empty_view(0), chart=CHART, memory=mem)
        assert r["disposition"] == "clarify" and r["asked"] == "stochastic_kind" and client.calls == [], words
        assert r["envelope"]["questions"][0] == {"id": "stochastic_kind", "text": QUESTION, "choices": [SLOW, FAST]}
    assert account == {}
    # the fast one, tapped: built to the library's formula with K smoothing 1, in one call
    client = model([emits(library(1))])
    r = conv.converse(FAST, user_id="u1", view=empty_view(0), chart=CHART, snippets=asked("Add the Stochastic"), memory=mem)
    assert r["ok"] is True and r["disposition"] == "change" and len(client.calls) == 1, r
    # (the sentence is said once, on the first line, with the numbers THAT line uses)
    assert any(a.get("text", "").startswith("Built to UCT's checked formula for Stochastic Oscillator (k length 14, k smoothing 1)")
               for a in r["envelope"]["assumptions"])
    assert mem.choice("stochastic_kind")["value"] == "fast" and mem.choice("stochastic_kind")["label"] == FAST
    # next time: not asked, built, and said
    client = model([emits(library(1))])
    r = conv.converse("Add the Stochastic Oscillator", user_id="u1", view=empty_view(0), chart=CHART, memory=mem)
    assert r["ok"] is True and r["disposition"] == "change" and len(client.calls) == 1 and r["remembered"] == ["stochastic_kind"], r
    assert r["envelope"]["assumptions"][0] == {
        "text": "Using the fast Stochastic (14, 1, 3), as you chose before. Say slow or fast to change it."}
    # a kind word is never overridden by the memory
    client = model([emits(library(3))])
    r = conv.converse("Add a slow stochastic", user_id="u1", view=empty_view(0), chart=CHART, memory=mem)
    assert r["ok"] is True and "remembered" not in r and mem.choice("stochastic_kind")["value"] == "fast"


def test_an_answer_that_is_not_the_librarys_formula_is_refused_even_after_the_question(conv, clean_env, model):
    """Naming the entry binds the build to its checked formula: a Stochastic from recollection, with
    the close first, is sent back, and twice is a refusal."""
    recollection = env(0, [{"op": "create", "name": "Stochastic", "placement": "pane", "outputs": [
        {"key": "k", "tree": call("sma", call("stoch", {"type": "series", "name": "close"}, {"type": "series", "name": "low"},
                                              {"type": "series", "name": "low"}, num(14)), num(3))}]}])
    model([emits(recollection), emits(recollection)])
    r = conv.converse("Add a slow stochastic", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is False and r["gate"] == conv.NAMED_GATE


def test_what_each_answer_is_worth(conv):
    for typed, want in ((SLOW, ("slow", SLOW)), (FAST, ("fast", FAST)), ("slow", ("slow", SLOW)), ("the fast one", ("fast", FAST))):
        got = conv.pending_answer(typed, asked("Add the Stochastic"), CHART)
        assert got is not None and conv.answer_value("stochastic_kind", got, CHART) == want, typed
    # numbers settle the question and choose no kind: nothing is remembered
    got = conv.pending_answer("14 5 5", asked("Add the Stochastic"), CHART)
    assert got is not None and conv.answer_value("stochastic_kind", got, CHART) is None
    # the registry's own shape
    q = conv.clarify_registry()["stochastic_kind"]
    assert q["choices"] == [SLOW, FAST] and q["remember"] == "default" and q["values"] == {SLOW: "slow", FAST: "fast"}
    assert json.dumps(q["said"]) and set(q["said"]) == set(q["choices"]) == set(q["also"])


def test_an_entry_takes_only_the_phrase_of_the_function_it_declares(conv, monkeypatch):
    """The takeover is one function's phrase, the one the entry names. Declared as another function's
    indicator, the same entry takes nothing: "stochastic oscillator" stays the engine function's."""
    from api.services import definition_concierge as dc
    stems, _ = dc._stem_key(dc._form_tokens("stochastic oscillator"))
    assert [r["key"] for r in conv._chart_lexicon(dc.LEXICON)["index"][stems]] == ["stochastic_oscillator"]
    real = ni.entry
    monkeypatch.setattr(ni, "entry", lambda i: {**real(i), "names_function": "rsi"} if i == "stochastic_oscillator" else real(i))
    assert [r["key"] for r in conv._chart_lexicon(dc.LEXICON)["index"][stems]] == ["stoch"]
    monkeypatch.setattr(ni, "entry", lambda i: {k: v for k, v in real(i).items() if k != "names_function"} if real(i) else None)
    assert [r["key"] for r in conv._chart_lexicon(dc.LEXICON)["index"][stems]] == ["stoch"]

