"""AN ACRONYM THAT COULD MEAN TWO INDICATORS IS A QUESTION (ruling 2026-11-18, per the owner's
"always clarify").

"DMI" is the Directional Movement Index and the Dynamic Momentum Index. "ADL" and "AD" are the
Accumulation Distribution Line and the Advance Decline Line. For such letters the door neither
guesses nor gives the unknown-name answer: it ASKS which, with no model call, the likeliest first.
The answer then follows that indicator's own path:

* a library entry is built to its checked formula;
* a well-known name with no checked formula is built with the name withheld;
* a name UCT does not build gets that name's own answer (the way forward), never the question again.

The answer is remembered like any other, used next time, and said. Everything else about the
question mechanism is held for these three by `tests/test_clarify_registry.py` (asked when open,
every choice reads back, the contract).
"""
from __future__ import annotations

import json

import pytest

from api.services import indicator_names as names
from api.services import indicator_telemetry as tel
from api.services import named_indicators as ni
from tests.test_indicator_memory import account, memory_of  # noqa: F401 -- fixtures by name
from tests.test_learned_record import last_turn, learned
from tests.test_named_indicators import create
from tests.test_p2_truth_server import call, conv, emits, empty_view, env, model, num  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name
from tests.test_rollout_telemetry import store  # noqa: F401 -- fixture by name

CHART = {"sym": "NVDA", "tf": "D"}
S = lambda n: {"type": "series", "name": n}  # noqa: E731
DMI_CHOICES = ["Directional Movement Index (+DI, -DI, ADX)", "Dynamic Momentum Index"]
ADL_CHOICES = ["Accumulation Distribution Line", "Advance Decline Line"]


def asked(question_text, words):
    return [{"role": "member", "text": words}, {"role": "assistant", "text": question_text}]


def acronym_questions(conv):
    return {qid: q for qid, q in conv.clarify_registry().items() if q.get("acronym")}


# ═══ 1. the questions, as data ═══════════════════════════════════════════════

def test_the_three_questions_and_what_each_choice_stands_for(conv):
    qs = acronym_questions(conv)
    assert list(qs) == ["acronym_dmi", "acronym_adl", "acronym_ad"]
    assert qs["acronym_dmi"]["choices"] == DMI_CHOICES                      # the likeliest first
    assert qs["acronym_adl"]["choices"] == qs["acronym_ad"]["choices"] == ADL_CHOICES
    assert qs["acronym_ad"]["capitals_only"] is True and not qs["acronym_dmi"]["capitals_only"]
    catalogue = {r["id"]: r for r in names._file()}
    for qid, q in qs.items():
        assert q["text"] == f"{q['acronym'].upper()} could mean two indicators. Which one?"
        assert list(q["rows"]) == list(q["values"]) == list(q["said"]) == q["choices"]
        assert len(set(q["rows"].values())) == len(q["choices"]) >= 2
        for label, row in q["rows"].items():
            assert row in catalogue, (qid, row)
            assert catalogue[row]["name"] in label                           # the choice shows the indicator's own name
            # the letters are that indicator's initials (AD: the first two of them)
            assert ni.initials(catalogue[row]["name"]).startswith(q["acronym"]), (qid, row)
        assert all(0 < len(v) <= 24 and v == v.lower() for v in q["values"].values())     # what the memory may hold
        # never also an acronym the library admits: those letters mean ONE thing
        assert ni.acronym_entry(q["acronym"]) is None


def test_every_clash_of_initials_that_touches_the_library_is_decided(conv):
    """Letters that are the initials of two indicators, at least one of them in the library. Each
    is either asked about or listed here with the reason it is not. A new library entry whose
    initials clash fails this until someone decides."""
    in_library = names.now_in_library()
    things = {}
    for r in names._file():
        things.setdefault(ni.initials(r["name"]), set()).add(in_library.get(r["id"]) or r["id"])
    for e in ni.entries() + ni.held_names():
        things.setdefault(ni.initials(e["name"]), set()).add(e["id"])
    library = {e["id"] for e in ni.entries() + ni.held_names()}
    clashes = {k for k, v in things.items() if len(v) > 1 and v & library and 2 <= len(k) <= 4}
    not_asked = {
        # (2026-11-19: ATR Bands became a built-in name, tests/test_built_in_names_census.py)
        "ab": "not letters anyone writes for ATR Bands or Acceleration Bands, and AB is not an admitted acronym",
        "ao": "nobody writes AO for the Accelerator Oscillator (its own abbreviation is AC), and AO is not an admitted acronym",
        "cc": "not letters anyone writes for the Coppock Curve or the Cyber Cycle",
        "pp": "not an admitted acronym; Pocket Pivot is asked for by its full name and pivot points is a description",
        "smi": "not an admitted acronym for either; both names are looked up in full",
        "ts": "not letters anyone writes for TD Sequential or the TTM Squeeze",
    }
    asked_about = {q["acronym"] for q in acronym_questions(conv).values()}
    assert clashes == (asked_about - {"ad"}) | set(not_asked), sorted(clashes)
    assert not (asked_about & set(not_asked))
    for letters in not_asked:
        assert ni.acronym_entry(letters) is None, letters                    # so none of them is ever guessed


# ═══ 2. asked, never guessed ═════════════════════════════════════════════════

@pytest.mark.parametrize("words,qid,choices", [
    ("Add DMI", "acronym_dmi", DMI_CHOICES), ("add the dmi in a lower pane", "acronym_dmi", DMI_CHOICES),
    ("Add ADL", "acronym_adl", ADL_CHOICES), ("Add AD", "acronym_ad", ADL_CHOICES),
])
def test_the_door_asks_which_with_no_model_call(store, conv, clean_env, model, words, qid, choices):
    client = model([])
    r = conv.converse(words, user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["disposition"] == "clarify" and r["asked"] == qid and r["asked_by"] == "door"
    assert client.calls == [] and r["cost_usd"] == 0.0
    (question,) = r["envelope"]["questions"]
    assert question["choices"] == choices and question["text"].endswith("could mean two indicators. Which one?")
    assert learned(last_turn()) == {"asked": qid}


@pytest.mark.parametrize("words", [
    "Add the Directional Movement Index", "DMI, the Directional Movement Index", "Add the Dynamic Momentum Index",
    "Add ADX", "an ad for my chart", "add the admiral line", "Add ADL. Accumulation Distribution Line",
    # the letters inside a longer word, or as a symbol with a suffix, are not the acronym
    "mark the headline number", "plot the deadline", "add ADL.TO as a line",
])
def test_naming_the_indicator_or_not_writing_the_letters_asks_nothing(conv, words):
    r = conv.understand_turn(words, CHART)
    assert r["refusal"] is None and conv.open_acronyms(r) == [], words


def test_beside_an_indicator_on_the_chart_or_in_a_question_the_door_does_not_ask(conv):
    r = conv.understand_turn("Add DMI", CHART)
    assert conv.door_question(r, empty_view(0)) == "acronym_dmi"
    assert conv.door_question(r, {"definition": {"name": "x"}}) is None
    assert conv.door_question(conv.understand_turn("What is DMI?", CHART), empty_view(0)) is None


# ═══ 3. the answer follows that indicator's own path ═════════════════════════

def test_the_library_one_is_built_checked_and_remembered_and_next_time_it_is_used_and_said(store, conv, account, clean_env, model):
    mem = memory_of(account)
    q = conv.clarify_question("acronym_dmi")
    client = model([emits(env(0, [create("directional_movement_index")]))])
    r = conv.converse(DMI_CHOICES[0], user_id="u1", view=empty_view(0), chart=CHART,
                      snippets=asked(q["text"], "Add DMI"), memory=mem)
    assert r["ok"] is True and r["disposition"] == "change" and len(client.calls) == 1, r.get("reason")
    assert any(a["text"].startswith("Built to UCT's checked formula for Directional Movement Index")
               for a in r["envelope"]["assumptions"])
    assert learned(last_turn()) == {"answered": "acronym_dmi", "named_built": "directional_movement_index"}
    assert mem.choice("acronym_dmi")["value"] == "directional" and mem.choice("acronym_dmi")["label"] == DMI_CHOICES[0]
    # next time: not asked; built checked; and the member is told how the letters were read
    client = model([emits(env(0, [create("directional_movement_index")]))])
    r = conv.converse("Add DMI", user_id="u1", view=empty_view(0), chart=CHART, memory=mem)
    assert r.get("disposition") == "change", (r.get("gate"), r.get("reason"), r.get("diagnostic"))
    assert len(client.calls) == 1 and r["remembered"] == ["acronym_dmi"]
    assert r["envelope"]["assumptions"][0] == {
        "text": "Reading DMI as the Directional Movement Index, as you chose before. Name the other one to change it."}
    # and naming the other one is never overridden by the memory
    r = conv.understand_turn("Add the Dynamic Momentum Index", CHART)
    assert [w["id"] for w in r["withheld"]] == ["dynamic_momentum_index"] and r["named"] == []


def test_the_one_with_no_checked_formula_is_built_with_the_name_withheld(store, conv, account, clean_env, model):
    mem = memory_of(account)
    q = conv.clarify_question("acronym_dmi")
    built = env(0, [{"op": "create", "name": "RSI with a length that follows volatility", "placement": "pane",
                     "outputs": [{"key": "value", "label": "Volatility-paced RSI", "tree": call("rsi", S("close"), num(14))}]}],
                reply="An RSI whose length shortens when volatility rises.")
    client = model([emits(built)])
    r = conv.converse(DMI_CHOICES[1], user_id="u1", view=empty_view(0), chart=CHART,
                      snippets=asked(q["text"], "Add DMI"), memory=mem)
    assert r["ok"] is True and r["disposition"] == "change" and len(client.calls) == 1, r.get("reason")
    assert any("Dynamic Momentum Index is not in UCT's checked library yet" in a["text"] for a in r["envelope"]["assumptions"])
    assert mem.choice("acronym_dmi")["value"] == "dynamic"
    assert learned(last_turn()) == {"answered": "acronym_dmi", "unknown_name": "dynamic_momentum_index"}


def test_the_one_uct_does_not_build_gets_its_own_answer_and_is_not_asked_again(store, conv, account, clean_env, model):
    mem = memory_of(account)
    q = conv.clarify_question("acronym_adl")
    # ⭐ 2026-11-25 (ruling B): the Advance Decline Line is a catalogued name for one calculation, so it is WITHHELD
    # (built from what it computes, the name kept off the chart), no longer refused as unknown. A breadth line is not
    # in one stock's bars: the assistant says so and builds nothing.
    client = model([emits(env(0, [], disposition="unsupported",
                              reply="The Advance Decline Line counts every stock's advances and declines; this chart has one stock's bars."))])
    r = conv.converse(ADL_CHOICES[1], user_id="u1", view=empty_view(0), chart=CHART,
                      snippets=asked(q["text"], "Add ADL"), memory=mem)
    assert len(client.calls) == 1 and r.get("reason") != conv.UNKNOWN_NAME_REASON.format(name="Advance Decline Line")
    sent = json.dumps(client.calls[0]["messages"][0]["content"])
    assert "Advance Decline Line" in sent and conv.WITHHELD_RULE[:40] in sent.replace('\\"', '"')
    assert r.get("disposition") != "clarify"
    # the member said what ADL means to them, and the door now RECOGNISES that meaning (a withheld name counts in
    # `meant_by`), so it is remembered as every recognised choice is (`answer_value`); before, it was not recognised
    assert (mem.choice("acronym_adl") or {}).get("label") == "Advance Decline Line"
    assert learned(last_turn()).get("answered") == "acronym_adl"


def test_a_message_that_does_not_answer_is_a_new_request(conv, clean_env, model):
    q = conv.clarify_question("acronym_dmi")
    assert conv.pending_answer("Add a 50 day EMA", asked(q["text"], "Add DMI"), CHART) is None
    got = conv.pending_answer(DMI_CHOICES[0], asked(q["text"], "Add DMI"), CHART)
    assert got == {"question": "acronym_dmi", "message": f"Add DMI. {DMI_CHOICES[0]}", "answer": DMI_CHOICES[0]}
    # the escape for an unbuildable name is for an ACRONYM's own choice only
    kind = conv.clarify_question("average_kind")
    assert conv.pending_answer("Advance Decline Line", asked(kind["text"], "Add a 50 day moving average"), CHART) is None
    # ... not for any other name the door refuses (that is a new request, refused on its own)
    assert conv.pending_answer("Add the Hartwell Oscillator", asked(q["text"], "Add DMI"), CHART) is None
    # ... and only when the question was really open in what the member first wrote
    adl = conv.clarify_question("acronym_adl")
    assert conv.pending_answer(ADL_CHOICES[1], asked(adl["text"], "Add a 50 day EMA"), CHART) is None
    assert conv.pending_answer(ADL_CHOICES[1], asked(adl["text"], "Add ADL"), CHART)["question"] == "acronym_adl"


def test_a_choice_is_recognised_by_its_library_entry_even_when_the_ids_differ(conv):
    """A catalogue row and its library entry need not share an id (Elder's Force Index is the
    library's `force_index`). A choice naming such a row is recognised by the entry."""
    question = {"rows": {"Force Index": "elder_force_index", "Something else": "klinger_volume_oscillator"}}
    named = conv.understand_turn("Add the Force Index", CHART)
    assert [e["id"] for e in named["named"]] == ["force_index"]
    assert conv.meant_by(question, named) == "Force Index"
    assert conv.meant_by(question, conv.understand_turn("Add a 50 day EMA", CHART)) is None


# ═══ 4. it is a registry question like any other ═════════════════════════════

def test_settings_shows_it_and_only_its_own_choices_can_be_set(conv, account):
    mem = memory_of(account)
    view = conv.memory_view(mem)
    row = next(q for q in view["questions"] if q["id"] == "acronym_dmi")
    assert row["title"] == "What DMI means" and [c["label"] for c in row["choices"]] == DMI_CHOICES
    assert [c["value"] for c in row["choices"]] == ["directional", "dynamic"]
    assert conv.set_memory(mem, "acronym_dmi", "dynamic") is True and mem.choice("acronym_dmi")["label"] == DMI_CHOICES[1]
    assert conv.set_memory(mem, "acronym_dmi", "directional_movement_index") is False
    assert conv.set_memory(mem, "acronym_adl", "advance") is True          # a member may set it; the door then reads it


def test_the_record_and_the_weekly_report_count_it(store, conv):
    for value in ("acronym_dmi", "acronym_adl", "acronym_ad"):
        assert tel._prop_violation("converse_turn", "asked", value) is None
        assert tel._prop_violation("converse_turn", "answered", value) is None
    from tests.test_learned_record import turn
    for u in ("m1", "m2", "m3"):
        turn(u, asked="acronym_dmi")
    this = tel.weekly_report(7)["questions"]["this"]
    assert this["by_question"] == {"acronym_dmi": 3} and this["asked_by_the_door"] == 3
    assert "Asked 3 times: DMI could mean two indicators. Which one?" in tel.weekly_report_text(tel.weekly_report(7))


def test_every_acronym_question_has_an_evaluation_case():
    import pathlib
    root = pathlib.Path(__file__).resolve().parents[1]
    doc = json.loads((root / "tests/fixtures/authoring/converse_eval_clarify_cases.json").read_text(encoding="utf-8"))
    cases = {c["id"]: c for c in doc["cases"]}
    for cid, first in (("clarify-acronym-dmi", "Add DMI"), ("clarify-acronym-adl", "Add ADL in a lower pane"), ("clarify-acronym-ad", "Add AD")):
        ask, answer = cases[cid]["turns"]
        assert ask["words"] == first and ask["expect"] == {"kind": "clarify", "max_model_calls": 0}
        assert answer["expect"]["kind"] == "change" and answer["expect"]["max_model_calls"] == 1
