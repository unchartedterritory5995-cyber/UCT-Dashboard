"""THE WITHHELD NAME (ruling 2026-11-18): a DISTINCTIVE well-known indicator name with no library
entry is BUILT, and the name is withheld.

Before: "Add the Klinger Volume Oscillator" was refused before any model call, and "add a klinger
oscillator" reached the assistant unmarked, which built it from recollection UNDER THE NAME, as
if UCT stood behind it. Now, for the names the catalogue marks `distinctive`:

* the name is a term: the request reaches the assistant with the rule to build what the name is
  generally understood to compute, to name everything by what it computes, and to say what it built;
* the door refuses a change that writes the name (or its abbreviation) on the chart anyway: one
  repair, and wrong twice ends in a refusal;
* the door itself tells the member, on every output built, that the name is not in the checked
  library and to check the formula;
* the member's own name for their indicator is theirs to give;
* nothing else moves: a name that is a drawing, a pattern or needs other data is still refused with
  the way forward, a library name is still the library's, and the words of a withheld name are not
  vocabulary (they account for that name and no other).

The model is scripted throughout.
"""
from __future__ import annotations

import json

import pytest

from api.services import definition_concierge as dc
from api.services import indicator_names as names
from api.services import named_indicators as ni
from tests.test_learned_record import last_turn, learned
from tests.test_p2_truth_server import call, conv, emits, empty_view, env, model, num  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name
from tests.test_rollout_telemetry import store  # noqa: F401 -- fixture by name

CHART = {"sym": "NVDA", "tf": "D"}
S = lambda n: {"type": "series", "name": n}  # noqa: E731
TREE = {"type": "op", "name": "-", "args": [call("ema", S("volume"), num(34)), call("ema", S("volume"), num(55))]}
KLINGER = {"id": "klinger_volume_oscillator", "name": "Klinger Volume Oscillator"}


def build(name="Volume force, fast average minus slow", label="Fast minus slow volume force", key="spread", **extra):
    return env(0, [{"op": "create", "name": name, "placement": "pane",
                    "outputs": [{"key": key, "label": label, "tree": TREE}]}],
               reply="A 34-bar average of volume minus a 55-bar average of volume.", **extra)


# ═══ 1. which names, and what the assistant is handed ════════════════════════

def test_the_catalogue_marks_the_names_and_none_of_them_is_the_librarys():
    rows = [r for r in names.catalogue() if r["distinctive"]]
    assert 40 <= len(rows) < len(names.catalogue())                      # some, never all
    library = {names.norm(a) for a, _ in ni.phrases()}
    for spelling, row_id in names.withheld_spellings():
        assert spelling not in library and not names.is_short_acronym(spelling), spelling
        assert names.name_of(row_id), row_id
    assert names.is_short_acronym("kvo") and names.is_short_acronym("t3") and not names.is_short_acronym("trix")
    assert not names.is_short_acronym("td combo")


@pytest.mark.parametrize("spelling,row_id", names.withheld_spellings())
def test_every_spelling_of_a_withheld_name_reaches_it_in_any_capitals(conv, spelling, row_id):
    for words in (f"add the {spelling}", f"Add the {spelling.title()} in a lower pane"):
        r = conv.understand_turn(words, CHART)
        assert r["refusal"] is None, (words, r["refusal"])
        assert [w["id"] for w in r["withheld"]] == [row_id], words
        assert r["named"] == [] and r["not_understood"] == [], words


def test_the_assistant_is_handed_the_name_and_the_rule_as_data(conv, clean_env, model):
    client = model([emits(build())])
    r = conv.converse("Add the Klinger Volume Oscillator", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and len(client.calls) == 1
    sent = json.dumps(client.calls[0]["messages"][0]["content"])
    assert '\\"well_known_name\\": \\"Klinger Volume Oscillator\\"' in sent or '"well_known_name": "Klinger Volume Oscillator"' in sent
    for must in ("NO checked formula", "never write this name", "say in one or two plain", "emit no ops"):
        assert must in conv.WITHHELD_RULE
    assert conv.WITHHELD_RULE[:60] in sent.replace('\\"', '"')
    # the rule rides with the TURN (data), never in the instructions every request shares
    assert "well-known indicator NAME" not in conv.system_prompt()


def test_a_name_that_is_not_distinctive_keeps_its_answer(conv, clean_env, model):
    client = model([])
    for words, phrase in (("Add the Elliott Wave", "Elliott Wave"), ("Add the McClellan Oscillator", "McClellan Oscillator"),
                          ("Add the Gann Fan", "Gann Fan")):
        r = conv.converse(words, user_id="u1", view=empty_view(0), chart=CHART)
        assert r["ok"] is False and r["reason"] == conv.UNKNOWN_NAME_REASON.format(name=phrase), words
    assert client.calls == []


def test_a_library_name_is_still_the_librarys(conv):
    r = conv.understand_turn("Add the Force Index and the On Balance Volume", CHART)
    assert [e["id"] for e in r["named"]] == ["force_index", "on_balance_volume"] and r["withheld"] == []


def test_a_question_about_one_is_a_question(conv, clean_env, model):
    client = model([emits(env(0, [], reply="It compares volume flowing in with volume flowing out."))])
    r = conv.converse("What is the Klinger Volume Oscillator?", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["disposition"] == "answer" and len(client.calls) == 1
    assert not r["envelope"].get("assumptions")


# ═══ 2. built, and the name withheld ═════════════════════════════════════════

def test_it_is_built_in_one_call_and_the_door_says_the_name_is_not_checked(store, conv, clean_env, model):
    client = model([emits(build())])
    r = conv.converse("Add the Klinger Volume Oscillator", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["disposition"] == "change" and r["attempts"] == 1 and len(client.calls) == 1
    (note,) = [a for a in r["envelope"]["assumptions"] if a.get("output") == "spread"]
    assert note["text"] == ("Klinger Volume Oscillator is not in UCT's checked library yet, so this is not offered under "
                            "that name. It was built from what the name is generally understood to mean. Check the formula "
                            "before you rely on it.")
    assert len(note["text"]) <= ni.SENTENCE_MAX
    assert conv.check_envelope(r["envelope"], 0, empty_view(0))            # what the door returns still passes the door
    # and the record says a catalogue name was built with no checked formula behind it
    assert learned(last_turn()) == {"unknown_name": "klinger_volume_oscillator"}


@pytest.mark.parametrize("wrong", [
    {"name": "Klinger Volume Oscillator"}, {"name": "My klinger oscillator (34, 55)"}, {"label": "Klinger Volume Oscillator"},
    {"label": "KVO"}, {"name": "Klinger-Volume-Oscillator"},
])
def test_the_name_written_on_the_chart_is_sent_back_once_and_the_repair_is_what_the_member_gets(conv, clean_env, model, wrong):
    client = model([emits(build(**wrong)), emits(build())])
    r = conv.converse("add a klinger oscillator", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["attempts"] == 2 and len(client.calls) == 2, r.get("reason")
    told = json.dumps(client.calls[1]["messages"])
    assert "named:withheld" in told and "no checked formula" in told and "what it computes" in told
    create = r["envelope"]["ops"][0]
    assert "klinger" not in json.dumps([create["name"], [o.get("label") for o in create["outputs"]]]).lower()


def test_wrong_twice_ends_in_a_refusal_never_in_the_name_on_the_chart(conv, clean_env, model):
    client = model([emits(build(name="Klinger Volume Oscillator")), emits(build(label="Klinger line"))])
    r = conv.converse("Add the Klinger Volume Oscillator", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is False and r["gate"] == conv.WITHHELD_GATE and len(client.calls) == 2
    assert r["reason"] == conv.REFUSALS["named:withheld"] + " -- Klinger Volume Oscillator"
    assert "envelope" not in r


def test_the_members_own_name_for_it_is_theirs_to_give(conv, clean_env, model):
    client = model([emits(build(name="Klinger"))])
    r = conv.converse("Add the Klinger Volume Oscillator and call it Klinger", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["attempts"] == 1 and len(client.calls) == 1
    assert r["envelope"]["ops"][0]["name"] == "Klinger"
    # the door still says, on the output, that the name is not checked
    assert any("not in UCT's checked library" in a["text"] for a in r["envelope"]["assumptions"])


def test_a_word_that_only_contains_the_name_is_not_the_name(conv):
    """Whole words: "Trixie" is not TRIX, and a formula never counts as a name."""
    trix = [{"id": "trix", "name": "TRIX"}]
    ok = env(0, [{"op": "create", "name": "Trixie's triple average change", "placement": "pane",
                  "outputs": [{"key": "trix", "label": "Change of the triple average", "tree": TREE}]}])
    conv.check_withheld(ok, trix)                                           # the output KEY is not a label either
    with pytest.raises(conv._Refused) as caught:
        conv.check_withheld(env(0, [{"op": "create", "name": "TRIX (15)", "placement": "pane",
                                     "outputs": [{"key": "a", "tree": TREE}]}]), trix)
    assert caught.value.gate == "named:withheld"
    # a word that is the name's alone is the name in part; a word the product also uses is not
    assert conv._own_words_of("klinger_volume_oscillator") == frozenset({"klinger"})
    assert "schaff" in conv._own_words_of("schaff_trend_cycle") and "index" not in conv._own_words_of("stochastic_momentum_index")
    with pytest.raises(conv._Refused):
        conv.check_withheld(build(label="Klinger line"), [KLINGER])
    conv.check_withheld(build(label="Volume oscillator, 34 against 55"), [KLINGER])     # the product's own words: fine


def test_the_pieces(conv):
    ops = [{"op": "create", "name": "A", "placement": "pane", "outputs": [{"key": "k", "label": "B", "tree": {"type": "series", "name": "close"}}]},
           {"op": "rename_output", "output": "k", "label": "C"}, {"op": "rename_definition", "name": "D"},
           {"op": "set_marker", "output": "k", "text": "E", "shape": "arrowUp"},
           {"op": "set_table", "position": "top_right", "cells": [{"label": "F", "value": {"type": "series", "name": "volume"}}]}]
    assert conv._written_words(ops) == ["A", "B", "C", "D", "E", "F"]        # names, labels, a marker's text; never a formula
    # nothing to withhold, or nothing changed: nothing to check and nothing to say
    conv.check_withheld(build(name="Klinger Volume Oscillator"), [])
    answer = env(0, [], reply="Klinger Volume Oscillator compares two volume averages.")
    conv.check_withheld(answer, [KLINGER])
    assert conv.withheld_notes(answer, [KLINGER]) == [] and conv.withheld_notes(build(), []) == []
    two = conv.withheld_notes(build(), [KLINGER, {"id": "qstick", "name": "Qstick"}])
    assert two[0]["text"].startswith("Klinger Volume Oscillator or Qstick is not in UCT's checked library yet")
    assert conv.withheld_in([{"section": conv.WITHHELD_SECTION, "name": "qstick"}, {"section": "functions", "name": "ema"},
                             {"section": conv.WITHHELD_SECTION, "name": "qstick"}, None]) == [{"id": "qstick", "name": "Qstick"}]
    assert names.every_spelling("klinger_volume_oscillator") == ("klinger volume oscillator", "klinger oscillator", "kvo")
    assert names.every_spelling("nope") == ()


# ═══ 3. its words are that name's and no other's ═════════════════════════════

def test_the_words_of_a_withheld_name_are_not_vocabulary(conv):
    vocabulary = dc._lexicon_vocabulary(conv.CHART_LEXICON)
    for word in ("klinger", "camarilla", "schaff", "qstick"):
        stems, _cost = dc._stem_key(dc._form_tokens(word))
        assert not all(s in vocabulary for s in stems), word
    # so another name that borrows one is still an unknown name ...
    r = conv.understand_turn("Add the Schaff Momentum Ribbon", CHART)
    assert r["refusal"] is not None and r["refusal"]["not_understood"][0]["phrase"] == "Schaff Momentum Ribbon"
    r = conv.understand_turn("Add the Brannock Klinger Oscillator", CHART)
    assert r["refusal"] is not None
    # ... while the name itself, whole, is accounted for, with the product's own words beside it
    r = conv.understand_turn("Add the Schaff Trend Cycle Of The Close", CHART)
    assert r["refusal"] is None and [w["id"] for w in r["withheld"]] == ["schaff_trend_cycle"]
    # (the Fisher Transform stood here until it joined the checked library, 2026-11-18: a name
    # leaves this list by being checked, and is then a library name)
    r = conv.understand_turn("Add the Fisher Transform", CHART)
    assert r["refusal"] is None and r["withheld"] == [] and [e["id"] for e in r["named"]] == ["fisher_transform"]


def test_the_planner_shared_with_the_screener_is_unchanged(conv):
    """`names_only` is the CHART door's lexicon. The shared one has none, and refuses as before."""
    assert "names_only" not in dc.LEXICON and "names_only_section" not in dc.LEXICON
    assert not (set(conv.CHART_LEXICON["names_only"]) & set(dc.LEXICON["index"]))
    for words in ("Add the Klinger Volume Oscillator", "add the schaff trend cycle"):
        told = dc.plan(words, dc.INDICATOR_KIND)
        assert all(t.get("section") != conv.WITHHELD_SECTION for t in told.get("terms") or []), words
    assert dc.plan("Add the Qstick", dc.INDICATOR_KIND) == dc.plan("Add the Qstick", dc.INDICATOR_KIND, lexicon=dc.LEXICON)


# ═══ after a live round (2026-11-18) ═════════════════════════════════════════

def test_a_recognisable_variant_of_the_name_is_the_name_and_the_repair_says_which_word(conv):
    """A build for the Fractal Adaptive Moving Average named "Fractal Dimension Adaptive Average"
    writes the name. Ruling: that is the name (its own word, in nearly the same order);
    the rule exists so a member never reads a checked-sounding name on an unchecked formula. The
    repair names the word that gave it away and asks for what the indicator DOES, in other words."""
    frama = [{"id": "fractal_adaptive_moving_average", "name": "Fractal Adaptive Moving Average"}]
    with pytest.raises(conv._Refused) as caught:
        conv.check_withheld(build(name="Fractal Dimension Adaptive Average", label="Adaptive average of close"), frama)
    said = caught.value.detail
    assert caught.value.gate == "named:withheld"
    assert "(\"fractal\" is that name's own)" in said
    assert 'say what it DOES, in other words (for example "an average that speeds up in trends and slows in ranges")' in said
    assert "none of its own words" in said
    # the whole name written out needs no word pointed at
    with pytest.raises(conv._Refused) as whole:
        conv.check_withheld(build(name="Fractal Adaptive Moving Average (16)"), frama)
    assert "is that name's own" not in whole.value.detail and "say what it DOES" in whole.value.detail
    # CONTROL: a name by what it does passes
    conv.check_withheld(build(name="An average that speeds up in trends and slows in ranges", label="Adaptive average"), frama)


def test_the_not_in_the_library_sentence_is_said_once_not_once_per_output(conv):
    two = env(0, [{"op": "create", "name": "Volume force", "placement": "pane",
                   "outputs": [{"key": "fast", "label": "Fast", "tree": TREE}, {"key": "slow", "label": "Slow", "tree": TREE},
                               {"key": "gap", "label": "Gap", "tree": TREE}]}])
    notes = conv.withheld_notes(two, [KLINGER])
    assert len(notes) == 1 and notes[0]["output"] == "fast"
    assert notes[0]["text"].startswith("Klinger Volume Oscillator is not in UCT's checked library yet")

