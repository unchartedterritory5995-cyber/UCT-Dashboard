"""A NAME THAT IS ONE OF UCT'S OWN BUILT-IN INDICATORS: answered by the door, with an offer to add it
(coordinator's ruling 2026-11-18).

"Add the RS Rating" used to be read as a formula to write: the door asked which benchmark to
compare with, and the assistant then wrote a ratio under a name that means a rank across every
stock. The RS Rating is one of UCT's own indicators, computed by the server. So is RS Phases.

Held here:
  * such a name is a library name with `built_in` {indicator, name, what}; `indicator` and `name`
    ARE the native registry's (read from `nativeRegistry.js`, so a rename there fails here);
  * it is answered with no assistant call, whatever the browser;
  * a browser that accepts an offer AND said it can add that indicator now is ANSWERED (not
    refused) and offered the one action; any other browser is told where to look, and offered
    nothing: the door never names an action that build cannot take;
  * the member's own description beside the name is still built as their own formula.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import json
import pathlib
import re

import pytest

from api.services import named_indicators as ni
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    call, conv, emits, empty_view, env, model, num, op,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

ROOT = pathlib.Path(__file__).resolve().parents[1]
CHART = {"sym": "NVDA", "tf": "D"}
RATING, PHASES = ni.entry("rs_rating"), ni.entry("rs_phases")
OFFERS = ["note.by", "offer"]


def ask(conv, words, **kw):
    return conv.converse(words, user_id="u1", view=empty_view(0), chart=CHART, **kw)


# ═══ 1. the names ════════════════════════════════════════════════════════

def test_the_built_in_names_and_what_each_carries():
    # (the fourth is ONE SETTING of a built-in, with `setting` beside the three: tests/test_vwap_bands_offer.py)
    # (and, since 2026-11-19, every built-in on the Indicators list that no checked formula or grammar function
    # answers by name: `builtin_*`, tests/test_built_in_names_census.py)
    ids = [e["id"] for e in ni.built_ins()]
    assert [i for i in ids if not i.startswith("builtin_")] == ["mansfield_relative_strength", "rs_rating", "rs_phases",
                                                                "session_vwap_bands"]
    assert len(ids) == len(set(ids)) and len([i for i in ids if i.startswith("builtin_")]) >= 10
    assert [e["id"] for e in ni.built_ins() if ni.built_in_setting(e) is not None] == ["session_vwap_bands"]
    for e in ni.built_ins():
        b = ni.built_in(e)
        assert {"indicator", "name", "what"} <= set(b) <= {"indicator", "name", "what", "setting", "own_version"}, e["id"]
        assert ("setting" in b) == (ni.built_in_setting(e) is not None) and b.get("own_version", True) is True
        assert not ni.passes(e) and e in ni.held_names()             # never a formula the assistant is handed
        assert not ({"outputs", "formula", "tree", "params", "evidence"} & set(e))
        assert len(ni.built_in_answer(e)) <= ni.SENTENCE_MAX and len(ni.way_forward(e)) <= ni.SENTENCE_MAX
        assert b["name"] in ni.built_in_answer(e) and b["name"] in ni.way_forward(e)
    assert ni.built_in(ni.entry("ttm_squeeze")) is None
    # Mansfield Relative Strength was a Screener-only number for a day; `rsMansfield` draws it now
    assert ni.built_in(ni.entry("mansfield_relative_strength"))["indicator"] == "rsMansfield"
    assert ni.built_in(ni.entry("mcginley_dynamic")) is None


def test_the_indicator_and_its_name_are_the_native_registrys_own():
    """The door names an indicator of the browser's registry. Its id and its name are read from the
    registry's source here: rename either there and this fails, rather than a member being told
    to look for a name that is no longer on the list."""
    registry = (ROOT / "app" / "src" / "components" / "chart" / "engine" / "nativeRegistry.js").read_text(encoding="utf-8")
    for e in ni.built_ins():
        b = ni.built_in(e)
        blocks = re.findall(r"\n  id: '" + re.escape(b["indicator"]) + r"',\n(.{0,900}?)\n    name: '([^']+)'", registry, re.S)
        # (a definition written with the registry's `nativeDef(id, fn, {name: ...})` helper)
        # (comment lines may sit between the helper's arguments and the object that carries the name)
        blocks += re.findall(r"nativeDef\('" + re.escape(b["indicator"]) + r"', '[^']+',((?:\s*//[^\n]*)*\s*)\{\s*name: '([^']+)'",
                             registry)
        assert blocks, f"no definition with id {b['indicator']} in the native registry"
        # (one id may be DECLARED twice, an older and a newer version of the definition, each with its own name:
        # which one the registry SERVES is held where the registry runs, `builtInNames.test.js`)
        assert b["name"] in {name for _between, name in blocks}, (b["indicator"], blocks)
    # CONTROL: the reader can miss
    assert not re.findall(r"\n  id: 'rsNoSuchThing',\n(.{0,900}?)\n    name: '([^']+)'", registry, re.S)


def test_a_record_with_a_field_missing_is_not_a_built_in():
    for missing in ("indicator", "name", "what"):
        e = json.loads(json.dumps(RATING))
        del e["built_in"][missing]
        assert ni.built_in(e) is None
    assert ni.built_in({"built_in": "rsRating"}) is None and ni.built_in(None) is None


def test_the_browsers_copy_lists_them():
    doc = json.loads((ROOT / "app" / "src" / "components" / "chart" / "builder" / "authoring" / "checkedLibrary.json").read_text(encoding="utf-8"))
    assert doc["builtIns"] == [{"id": e["id"], "name": e["name"], "indicator": e["built_in"]["indicator"],
                                "builtInName": e["built_in"]["name"],
                                **({"setting": {"input": ni.built_in_setting(e)["input"],
                                                "values": ni.built_in_setting(e)["values"]}}
                                   if ni.built_in_setting(e) is not None else {})} for e in ni.built_ins()]
    assert [row["indicator"] for row in doc["builtIns"] if "setting" in row] == ["vwap"]


# ═══ 2. what the door reads ══════════════════════════════════════════════

@pytest.mark.parametrize("words,entry_id", [
    ("Add the RS Rating", "rs_rating"), ("add uct rs rating", "rs_rating"), ("show the relative strength rating", "rs_rating"),
    ("RS RATING", "rs_rating"), ("add the ibd rs rating", "rs_rating"),
    ("Add RS Phases", "rs_phases"), ("add the relative strength phases", "rs_phases"),
])
def test_the_name_is_read_as_the_built_in_and_never_asked_a_formula_question(conv, words, entry_id):
    got = conv.understand_turn(words, CHART)
    assert got["refusal"] is not None and got["refusal"]["gate"] == conv.NAMED_BUILT_IN_GATE, words
    assert got["built_in"]["id"] == entry_id and got["held"] == [entry_id]
    assert got["refusal"]["reason"] == ni.way_forward(ni.entry(entry_id))


@pytest.mark.parametrize("words", ["Show relative strength", "Plot the RS line", "Add the RS line versus QQQ"])
def test_a_relative_strength_request_that_is_not_one_of_those_names_is_untouched(conv, words):
    got = conv.understand_turn(words, CHART)
    assert got["refusal"] is None and "built_in" not in got, words


def test_a_rule_described_beside_the_name_is_still_the_members_own_formula(conv):
    got = conv.understand_turn("rs rating: the close divided by SPY over 252 bars", CHART)
    assert got["refusal"] is None and [e["id"] for e in got["own_words"]] == ["rs_rating"]


# ═══ 3. the answer, by what the browser said ═════════════════════════════

def test_a_browser_that_can_add_it_is_answered_and_offered_the_action(conv, clean_env, model):
    client = model([])
    r = ask(conv, "Add the RS Rating", accepts=OFFERS, addable=["rsRating", "rsPhases"])
    assert client.calls == []                                             # no assistant call
    assert r["ok"] is True and r["disposition"] == "answer" and r["turn"] == "offer" and r["answered_by"] == "door"
    assert r["reply"] == ni.built_in_answer(RATING) == (
        "RS Rating is one of UCT's own indicators, UCT RS Rating: the stock's RS Rating, 1 to 99, session by session "
        "on daily charts. It is not a formula to build here.")
    assert r["offer"] == {"kind": "add_built_in", "indicator": "rsRating", "name": "UCT RS Rating",
                          "label": "Add UCT RS Rating to this chart"}
    # nothing is built and nothing is changed by the answer itself
    assert r["envelope"]["ops"] == [] and r["envelope"]["disposition"] == "answer" and r["envelope"]["reply"] == r["reply"]
    assert r["cost_usd"] == 0.0 and r["attempts"] == 0
    assert conv.check_envelope(r["envelope"], 0, empty_view(0))


def test_the_other_name_offers_its_own_indicator(conv, clean_env, model):
    model([])
    r = ask(conv, "add rs phases", accepts=OFFERS, addable=["rsPhases"])
    assert r["ok"] is True and r["offer"]["indicator"] == "rsPhases" and r["offer"]["label"] == "Add UCT RS Phases to this chart"


@pytest.mark.parametrize("kw,why", [
    ({}, "an older tab says nothing"),
    ({"accepts": ["note.by"], "addable": ["rsRating"]}, "it does not accept an offer"),
    ({"accepts": OFFERS}, "it did not say what it can add"),
    ({"accepts": OFFERS, "addable": []}, "it can add nothing right now"),
    ({"accepts": OFFERS, "addable": ["rsPhases"]}, "it can add another one, not this one"),
    ({"accepts": OFFERS, "addable": "rsRating"}, "not a list"),
    ({"accepts": "offer", "addable": ["rsRating"]}, "accepts is not a list"),
    ({"accepts": OFFERS, "addable": [{"id": "rsRating"}, 7, None]}, "not words"),
    ({"accepts": OFFERS, "addable": ["x" * 65, "RSRATING"]}, "too long, and another spelling"),
])
def test_any_other_browser_is_told_where_to_look_and_offered_nothing(conv, clean_env, model, kw, why):
    client = model([])
    r = ask(conv, "Add the RS Rating", **kw)
    assert client.calls == [], why
    assert r["ok"] is False and r["gate"] == conv.NAMED_BUILT_IN_GATE and "offer" not in r and "envelope" not in r, why
    assert r["reason"] == ("RS Rating is one of UCT's own indicators (UCT RS Rating), not a formula this window builds. "
                           "Look for UCT RS Rating in the Indicators list."), why


def test_what_a_browser_can_add_is_bounded_and_needs_the_word(conv):
    assert conv.can_add_built_ins(OFFERS, ["rsRating", "rsRating", "a"]) == frozenset({"rsRating", "a"})
    assert conv.can_add_built_ins(["note.by"], ["rsRating"]) == frozenset()
    assert conv.can_add_built_ins(None, ["rsRating"]) == frozenset() and conv.can_add_built_ins(OFFERS, None) == frozenset()
    many = [f"id{i}" for i in range(conv.BUILT_INS_MAX + 5)]
    assert conv.can_add_built_ins(OFFERS, many) == frozenset(many[:conv.BUILT_INS_MAX])
    assert conv.can_add_built_ins(OFFERS, ["", "y" * (conv.BUILT_IN_ID_MAX + 1), "ok"]) == frozenset({"ok"})


def test_only_a_built_in_name_is_ever_offered(conv, clean_env, model):
    """A held name that is NOT a built-in, a checked name and an ordinary request carry no offer,
    whatever the browser says it can add."""
    model([])
    r = ask(conv, "Add the TTM Squeeze", accepts=OFFERS, addable=["rsRating", "rsPhases", "ttm_squeeze"])
    assert r["ok"] is False and r["gate"] == conv.NAMED_UNCHECKED_GATE and "offer" not in r
    # Mansfield Relative Strength IS a built-in name: offered only for ITS indicator, never another
    r = ask(conv, "Add the Mansfield Relative Strength", accepts=OFFERS, addable=["rsRating", "rsLine"])
    assert r["ok"] is False and r["gate"] == conv.NAMED_BUILT_IN_GATE and "offer" not in r
    r = ask(conv, "Add the Mansfield Relative Strength", accepts=OFFERS, addable=["rsMansfield"])
    assert r["ok"] is True and r["offer"]["indicator"] == "rsMansfield"
    assert r["offer"]["label"] == "Add UCT Mansfield RS to this chart"
    # (2026-11-19: a formula can hold a member's own version of it, so the answer says so:
    # tests/test_built_in_names_census.py, "build your own is said exactly where the door takes one")
    assert r["reply"] == ("Mansfield Relative Strength (UCT Mansfield RS) is one of UCT's own indicators: the RS line as "
                          "a percent above or below its own long average, around a zero line. Add it with one tap, or "
                          "describe what you'd change and I'll build your own.")


def test_a_question_about_the_name_is_discussed_not_offered(conv, clean_env, model):
    client = model([emits(env(0, [], disposition="answer", reply="A rank of past return across every stock."))])
    r = ask(conv, "What is the RS Rating?", accepts=OFFERS, addable=["rsRating"])
    assert r["ok"] is True and r["disposition"] == "answer" and len(client.calls) == 1 and "offer" not in r
