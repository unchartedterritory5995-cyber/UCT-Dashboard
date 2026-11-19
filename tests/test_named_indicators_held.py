"""ONLY THE NAME IS WITHHELD: held names, and the unknown-name rule made whole-phrase.

Slice 2 of the named-indicator library (`api/services/named_indicators.py`), by the engine
session's ruling of 2026-11-18. Three things, each held here:

  1. HELD NAMES. Some indicators UCT knows by name and has no checked formula for (the definition
     could not be confirmed on a page read, or it belongs to another store). Named alone, each is
     refused BY NAME, in any spelling, before any model call, and the refusal is the way forward:
     describe the rule in your own words.
  2. NAME PLUS DESCRIPTION. When the member does describe the rule beside the name, the turn goes
     on: the assistant is told to build that description and nothing it knows about the name, and
     the door labels every output as the member's own formula.
  3. THE WHOLE-PHRASE RULE, on the chart door only. A short Title-Case name with a word in it that
     nothing accounts for is an unknown name, even when another of its words is known ("Hartwell
     Trend Cycle" knows "trend"). Measured on 604 requests before it was written; the cases that
     decided its shape are pinned below. `/propose`'s planner is unchanged.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import json

import pytest

from api.services import definition_concierge as dc
from api.services import named_indicators as ni
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    call, conv, emits, empty_view, env, model, num, op, out, view,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

S = lambda n: {"type": "series", "name": n}  # noqa: E731
CHART = {"sym": "NVDA", "tf": "D"}
HELD = {e["id"]: e for e in ni.held_names()}
UNCHECKED = "named:unchecked"
VOLUME_RULE = op(">", S("volume"), call("highest", S("volume"), num(10)))


def create(tree, key="rule", name="My rule"):
    return {"op": "create", "name": name, "placement": "pane", "outputs": [{"key": key, "tree": tree}]}


# ═══ 1. the held names ═══════════════════════════════════════════════════════

def test_the_held_names_and_what_each_carries():
    # Pocket Pivot was held until 2026-11-18; it is a library entry now (tests/test_library_pocket_pivot.py)
    assert set(HELD) == {"ttm_squeeze", "mansfield_relative_strength"}
    built = {e["id"] for e in ni.entries()}
    built_aliases = {a for e in ni.entries() for a in e["aliases"]}
    for e in ni.held_names():
        assert e["id"] not in built
        assert e["name"].lower() in e["aliases"] and len(set(e["aliases"])) == len(e["aliases"])
        assert not (set(e["aliases"]) & built_aliases)
        for alias in e["aliases"]:
            assert alias == alias.lower().strip()
            assert any(len(w) >= 4 for w in alias.split()), alias       # never a bare short acronym
        assert e["why"] and e["describe"] and e["since"]
        # ⛔ NO FORMULA AT ALL: nothing a model could be handed, nothing to approximate from
        assert not ({"outputs", "formula", "tree", "params", "evidence"} & set(e))
        assert not ni.passes(e) and ni.tiers(e) == (False, False, False)
        assert ni.entry(e["id"]) is e or ni.entry(e["id"]) == e
    # the example in the way forward never repeats the name it stands in for
    for e in ni.held_names():
        assert not any(alias in e["describe"].lower() for alias in e["aliases"]), e["id"]


def test_the_way_forward_is_what_the_member_reads():
    said = ni.way_forward(HELD["ttm_squeeze"])
    assert said == ("TTM Squeeze isn't in UCT's checked library yet. Describe the rule itself in your own words "
                    "(for example: the Bollinger Bands inside the Keltner Channels) and the assistant "
                    "will build exactly that, as your own formula.")
    assert "(for example" not in ni.way_forward({"name": "Zeta Wave"})
    for e in ni.held_names():
        assert len(ni.way_forward(e)) < 400


@pytest.mark.parametrize("message", [
    "Add the TTM Squeeze", "add a ttm squeeze", "TTM SQUEEZE", "add a ttm squeeze marker in a lower pane",
    "ttm squeeze please", "TTM squeeze with dots on the zero line",
    "Add the Mansfield Relative Strength", "mansfield relative performance",
    "ttm squeeze on NVDA", "Add the TTM Squeeze with a 50 day average", "TTM Squeeze 20 2 1.5",
])
def test_a_held_name_alone_is_refused_by_name_before_any_call(conv, clean_env, model, message):
    client = model([])
    r = conv.converse(message, user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is False and r["gate"] == UNCHECKED and client.calls == [], r
    assert "isn't in UCT's checked library yet" in r["reason"] and "in your own words" in r["reason"]
    assert "(for example: " in r["reason"]


def test_every_held_alias_is_refused_however_it_is_capitalised(conv):
    for e in ni.held_names():
        for alias in e["aliases"]:
            for words in (alias, alias.title(), alias.upper()):
                got = conv.understand_turn(f"add the {words}", CHART)
                assert got["refusal"] is not None and got["refusal"]["gate"] == UNCHECKED, words
                assert got["refusal"]["reason"] == ni.way_forward(e), words


def test_a_phrase_that_only_meant_not_available_is_taken_and_nothing_else_is(conv):
    """"pocket pivot" was already a phrase on this door: one value of a Screener TEXT column no
    formula can read. That answered "not available" and handed the request on to the model. The
    library name takes that bucket; a bucket holding anything else is never replaced."""
    stems, _cost = dc._stem_key(dc._form_tokens("pocket pivot"))
    before = dc.LEXICON["index"][stems]
    assert all(r["kind"] == dc.EXCLUDED_ENTRY for r in before)
    (row,) = conv.CHART_LEXICON["index"][stems]
    assert row["kind"] == dc.TABLE_ENTRY and row["key"] == "pocket_pivot" and row["section"] == ni.SECTION
    # the Screener's own "mansfield" column is a term of that column still: the bare word is not held
    got = conv.understand_turn("show mansfield", CHART)
    assert got["refusal"] is None and [t["name"] for t in got["terms"]] == ["mansfield"]
    # and the shared lexicon itself is untouched
    assert dc.LEXICON["index"][stems] is before


def test_a_library_name_never_takes_a_phrase_that_already_means_something(conv, monkeypatch):
    """ADDED, NEVER REPLACED: an entry whose alias is already a phrase of this door (here, the RSI's
    own full name) does not displace it. Only a bucket that says nothing but "not available" is taken."""
    import copy
    doc = copy.deepcopy(ni.library())
    doc["held"].append({"id": "zeta_wave", "name": "Zeta Wave", "aliases": ["zeta wave", "relative strength index"],
                        "why": "a test", "describe": "a test", "since": "2026-11-18"})
    stems, _cost = dc._stem_key(dc._form_tokens("relative strength index"))
    before = conv.CHART_LEXICON["index"][stems]
    assert not all(r["kind"] == dc.EXCLUDED_ENTRY for r in before)
    monkeypatch.setattr(ni, "library", lambda: doc)
    rebuilt = conv._chart_lexicon(conv.dc.LEXICON)
    assert rebuilt["index"][stems] == before                              # still the RSI
    zeta, _cost = dc._stem_key(dc._form_tokens("zeta wave"))
    assert rebuilt["index"][zeta][0]["key"] == "zeta_wave"                # its new phrase was added


def test_a_question_about_a_held_name_is_discussed_and_cannot_come_back_as_a_change(conv, clean_env, model):
    client = model([emits(env(0, [], disposition="answer", reply="A volume signature near a moving average."))])
    r = conv.converse("What is the TTM Squeeze?", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["disposition"] == "answer" and len(client.calls) == 1
    sent = json.dumps(client.calls[0]["messages"][0]["content"])
    assert "NOT CHECKED YET" in sent
    model([emits(env(0, [create(VOLUME_RULE)], disposition="change", reply="Done."))])
    r = conv.converse("What is the TTM Squeeze?", user_id="u2", view=empty_view(0), chart=CHART)
    assert r["ok"] is False and r.get("backstop") is True and "envelope" not in r
    assert r["reason"] == ni.way_forward(HELD["ttm_squeeze"])


# ═══ 2. the name plus the member's own description ═══════════════════════════

DESCRIBED = [
    "Mansfield relative strength versus SPY over 52 weeks",
    "TTM Squeeze: the bollinger bands inside the keltner channels over 20 bars",
    "ttm squeeze: bollinger bands inside the keltner channels",
    "ttm squeeze when volume is above the highest volume in 10 days",
    "mansfield relative strength, the price divided by SPY as a percent above its 200-day average",
]
NOT_DESCRIBED = [
    "Add the TTM Squeeze", "add a ttm squeeze marker in a lower pane", "ttm squeeze on NVDA",
    "show me the ttm squeeze please", "a ttm squeeze scanner", "ttm squeeze in green",
    "Add the TTM Squeeze with a 50 day average",        # a number and no thing a formula reads
    "TTM Squeeze 20 2 1.5",                             # numbers and no rule
    "TTM squeeze with dots on the zero line",
]


@pytest.mark.parametrize("message", DESCRIBED)
def test_a_described_rule_beside_the_name_goes_on(conv, message):
    got = conv.understand_turn(message, CHART)
    assert got["refusal"] is None, got["refusal"]
    assert len(got["own_words"]) == 1 and got["own_words"][0]["id"] in HELD
    assert got["named"] == []                                             # nothing to hold the patch to: there is no formula
    (term,) = [t for t in got["notes"]["matched_terms"] if t.get("named_indicator")]
    assert term["rule"] == conv.NAMED_OWN_WORDS_RULE and set(term) == {"wrote", "entry", "named_indicator", "rule"}
    assert got["request_text"] == message                                 # the member's words, whole


@pytest.mark.parametrize("message", NOT_DESCRIBED)
def test_the_name_without_a_rule_does_not(conv, message):
    got = conv.understand_turn(message, CHART)
    assert got["refusal"] is not None and got["refusal"]["gate"] == UNCHECKED, message


def test_the_test_of_a_description_itself(conv):
    assert conv.described_in_own_words("ttm squeeze when volume is above the highest volume in 10 days", CHART)
    assert not conv.described_in_own_words("ttm squeeze", CHART)
    assert not conv.described_in_own_words("  ", CHART)
    # a ticker counts as a thing a formula reads; the chart's own symbol does not
    assert conv.described_in_own_words("mansfield relative strength versus SPY over 52 weeks", CHART)
    assert not conv.described_in_own_words("mansfield relative strength versus NVDA over 52 weeks", CHART)
    # one thing read and nothing else is not a rule
    assert not conv.described_in_own_words("ttm squeeze on volume", CHART)
    # the words of the NAME itself are never counted as the description
    assert not conv.described_in_own_words("mansfield relative strength mansfield relative performance", CHART)


def test_built_from_the_members_words_and_labelled_as_their_own(conv, clean_env, model):
    client = model([emits(env(0, [create(VOLUME_RULE, "pp", "Volume above the 10 day high")], reply="Built your rule."))])
    r = conv.converse("ttm squeeze when volume is above the highest volume in 10 days", user_id="u1",
                      view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["attempts"] == 1 and len(client.calls) == 1
    (note,) = r["envelope"]["assumptions"]
    assert note == {"output": "pp", "text": "Built from your own description, as your own formula. "
                                            "UCT has not checked a formula for TTM Squeeze."}
    sent = json.dumps(client.calls[0]["messages"][0]["content"])
    assert "UCT has NO checked formula for this name" in sent and "Build ONLY the rule the member's own words" in sent
    assert "NOT CHECKED YET" not in sent                                  # the authoring rule, not the discussion one
    assert conv.check_envelope(r["envelope"], 0, empty_view(0))


def test_own_words_notes_directly(conv):
    patch = env(0, [create(VOLUME_RULE, "a"), {"op": "add_output", "key": "b", "tree": VOLUME_RULE},
                    {"op": "rename_definition", "name": "X"}])
    notes = conv.own_words_notes(patch, [HELD["ttm_squeeze"]])
    assert [n["output"] for n in notes] == ["a", "b"] and all("TTM Squeeze" in n["text"] for n in notes)
    both = conv.own_words_notes(patch, [HELD["ttm_squeeze"], HELD["mansfield_relative_strength"]])
    assert "for TTM Squeeze or Mansfield Relative Strength." in both[0]["text"] and len(both[0]["text"]) <= ni.SENTENCE_MAX
    assert conv.own_words_notes(patch, []) == []
    assert conv.own_words_notes(env(0, [{"op": "rename_definition", "name": "X"}]), [HELD["ttm_squeeze"]]) == []


def test_a_checked_name_beside_a_held_one_keeps_its_gate(conv, clean_env, model):
    """Both in one request: the checked one is still held to its formula; the held one's label
    still goes on what was built."""
    mcg = ni.entry("mcginley_dynamic")
    patch = env(0, [{"op": "create", "name": "Mine", "placement": "pane", "outputs": [
        {"key": "pp", "tree": VOLUME_RULE}, {"key": "md", "tree": mcg["outputs"][0]["tree"]}]}])
    model([emits(patch)])
    r = conv.converse("the McGinley Dynamic, and a ttm squeeze when volume is above the highest volume in 10 days",
                      user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True, r
    texts = [a["text"] for a in r["envelope"]["assumptions"]]
    assert any(t.startswith("Built from your own description") for t in texts)
    assert any(t.startswith("Built to UCT's checked formula for McGinley Dynamic") for t in texts)
    wrong = env(0, [create(VOLUME_RULE, "pp")])                           # the McGinley Dynamic left out
    model([emits(wrong), emits(wrong)])
    r = conv.converse("the McGinley Dynamic, and a ttm squeeze when volume is above the highest volume in 10 days",
                      user_id="u2", view=empty_view(0), chart=CHART)
    assert r["ok"] is False and r["gate"] == "named:formula"


# ═══ 3. the whole-phrase rule ════════════════════════════════════════════════

def plan(message, strict):
    return dc.plan(message, dc.INDICATOR_KIND, lexicon=None if not strict else None, strict_names=strict)


def chart(message):
    from api.services import definition_conversation as c
    return c.understand_turn(message, CHART)


#: Names with one KNOWN word inside: each passed the planner before this rule and reached a model
#: free to improvise. (Measured 2026-11-18.)
NOW_UNKNOWN = [
    ("Add the Hartwell Trend Cycle", "Hartwell Trend Cycle"),
    ("Add the Brannock Volume Oscillator", "Brannock Volume Oscillator"),
    ("Add the Dunmore Price Oscillator", "Dunmore Price Oscillator"),
    ("Add the Minervini Trend Template", "Minervini Trend Template"),
    ("Add the Td Brannock Setup Count", "Td Brannock Setup Count"),
    ("Add the Zero-Drift Ema", "Drift Ema"),
    # typed ALONE: the first word of a message is excused only when it is a word requests open with
    ("Brannock Volume Oscillator", "Brannock Volume Oscillator"),
    ("Hartwell Trend Cycle please", "Hartwell Trend Cycle"),
]
#: What the measurement said must NOT be caught: a first word capitalised by grammar, grammar
#: words, descriptions made of the product's own vocabulary, sentences typed in capitals.
STILL_UNDERSTOOD = [
    "Add Bollinger Bands", "Add Chaikin money flow", "Add Linear regression slope", "Add Money flow index",
    "Add the Previous Week High And Low", "Add the Linear Regression Slope", "Add the Volume Oscillator",
    "Add the Rate Of Change", "Add the On-Balance Volume", "Add the Up/Down Volume Ratio",
    "Add the Relative Strength Index", "Show me the RSI value in my Info Row.",
    "Bollinger Bands", "Volume Oscillator", "Rate Of Change", "Linear Regression Slope",   # typed alone
    "Overlay Bollinger Bands", "Graph The Relative Strength Index",
    "Add the Higher High And Higher Low Against The Last Confirmed Swings",      # a sentence in capitals (over 4 words)
    "Add the McGinley Dynamic", "Add the Kaufman Adaptive Moving Average", "Add the Ultimate Oscillator",
]


@pytest.mark.parametrize("message, phrase", NOW_UNKNOWN)
def test_a_short_name_with_an_unaccounted_word_is_an_unknown_name(conv, clean_env, model, message, phrase):
    client = model([])
    r = conv.converse(message, user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is False and r["gate"] == "concept:ungrounded" and client.calls == [], r
    assert r["not_understood"][0]["phrase"] == phrase
    assert r["reason"] == conv.UNKNOWN_NAME_REASON.format(name=phrase)
    assert "in your own words" in r["reason"]                             # the way forward, not a dead end


#: Names the rule caught when it was first measured, and which the library holds now: the same
#: words are BUILT, to a checked formula. This is the pairing that makes the rule affordable.
NOW_IN_THE_LIBRARY = [
    ("Add the Triple Ema", "triple_exponential_moving_average"),
    ("Add the Double Ema", "double_exponential_moving_average"),
    ("please add the Chande Momentum Oscillator to my chart", "chande_momentum_oscillator"),
    ("Chande Momentum Oscillator", "chande_momentum_oscillator"),
    ("Stochastic Rsi", "stochastic_rsi"),
    ("add the stoch rsi", "stochastic_rsi"),
]


@pytest.mark.parametrize("message, entry_id", NOW_IN_THE_LIBRARY)
def test_a_name_the_rule_would_catch_is_built_once_the_library_holds_it(conv, message, entry_id):
    got = chart(message)
    assert got["refusal"] is None and [e["id"] for e in got["named"]] == [entry_id], (message, got["refusal"])


@pytest.mark.parametrize("message", STILL_UNDERSTOOD)
def test_what_the_measurement_said_must_not_be_caught_is_not(conv, message):
    got = chart(message)
    assert got["refusal"] is None, (message, got["refusal"])
    assert got["not_understood"] == []


def test_a_name_no_word_of_which_is_known_is_refused_as_it_always_was(conv):
    for message, phrase in (("Add the Gann Fan", "Gann Fan"), ("Add the Hull Suite", "Hull Suite")):
        got = chart(message)
        assert got["refusal"]["gate"] == "concept:ungrounded"
        assert got["refusal"]["not_understood"][0]["phrase"] == phrase


def test_the_rest_of_a_request_survives_an_unknown_name(conv):
    got = chart("Add the Hartwell Trend Cycle and a 50 day average")
    assert got["refusal"] is None
    assert [n["phrase"] for n in got["not_understood"]] == ["Hartwell Trend Cycle"]
    assert "Hartwell" not in got["request_text"] and "50 day average" in got["request_text"]
    # the known word INSIDE the unknown name is part of the name, not a term of its own: "volume" is a
    # term when it stands alone, and is NOT one inside "Brannock Volume Oscillator"
    alone = chart("add volume and a 50 day average")
    assert "volume" in [t["name"] for t in alone["terms"]]
    inside = chart("Add the Brannock Volume Oscillator and a 50 day average")
    assert [n["phrase"] for n in inside["not_understood"]] == ["Brannock Volume Oscillator"]
    assert "volume" not in [t["name"] for t in inside["terms"]]


def test_PROPOSE_is_unchanged_the_rule_is_opt_in():
    """The Screener door's planner is exactly what it was: the same words, with and without."""
    for message, _phrase in NOW_UNKNOWN:
        off = dc.plan(message, dc.INDICATOR_KIND)
        on = dc.plan(message, dc.INDICATOR_KIND, strict_names=True)
        assert [n["phrase"] for n in on["not_understood"]], message
        # (off: either understood, or refused for a reason that was already there)
        assert off == dc.plan(message, dc.INDICATOR_KIND, strict_names=False)
    assert dc.plan("Add the Hartwell Trend Cycle", dc.INDICATOR_KIND)["not_understood"] == [] or \
        dc.plan("Add the Hartwell Trend Cycle", dc.INDICATOR_KIND)["not_understood"][0]["phrase"] != "Hartwell Trend Cycle"
    # and its own sentence for an unknown name is its own
    r = dc.plan("Add the Gann Fan", dc.INDICATOR_KIND)["not_understood"][0]["reason"]
    assert "supported functions or concepts" in r and "in your own words" not in r


def test_the_pieces_of_the_rule():
    from api.services import definition_conversation as c
    lex = c.CHART_LEXICON

    def foreign(text):
        return dc._foreign_words(list(dc._WORD_TOKEN.finditer(text)), lex)
    assert foreign("Hartwell Trend Cycle") == ["Hartwell"]                    # "trend" is known, "cycle" is vocabulary
    assert foreign("Bollinger Bands") == [] and foreign("Rate Of Change") == []
    assert foreign("Brannock Volume Oscillator") == ["Brannock"]
    assert foreign("Volume Oscillator") == []                             # the product's own vocabulary
    assert foreign("Add Bollinger Bands") == []                           # an opener is no part of a name, wherever it stands
    assert dc.NAME_MAX_WORDS == 4
    assert {"add", "show", "plot"} <= dc._SENTENCE_OPENERS and "klinger" not in dc._SENTENCE_OPENERS
    assert not (dc._SENTENCE_OPENERS & {"oscillator", "average", "index", "bands"})   # never a word a name is made of
    vocabulary = dc._lexicon_vocabulary(lex)
    assert dc._lexicon_vocabulary(lex) is vocabulary and len(vocabulary) > 200


def test_a_sentence_typed_in_capitals_keeps_the_older_rule(conv):
    """More than four words in a row with capitals is a sentence, not a name: it is refused only
    when NOTHING in it is known, exactly as before."""
    long = "Add the Higher High And Higher Low Against The Last Confirmed Swings"
    assert chart(long)["refusal"] is None
    # CONTROL: the same words as a SHORT run are caught ("Swings" is no word the product uses)
    assert chart("Add the Confirmed Swings High")["refusal"] is not None


def test_the_unknown_name_sentence_is_the_callers_own():
    told = dc.plan("Add the Gann Fan", dc.INDICATOR_KIND, name_refusal='"{name}" is new to me.')
    assert told["not_understood"][0]["reason"] == '"Gann Fan" is new to me.'
