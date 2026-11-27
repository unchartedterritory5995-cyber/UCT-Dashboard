"""LEARN AS A PRODUCT, slice D: what each turn records about questions, memory and names, and the
weekly owner report built from it.

The rules proved here:

* a turn records CLOSED IDS ONLY: a registry question id, a library entry id, a name-catalogue id.
  Nothing a member typed is stored, whatever they typed;
* each field is held to its own closed set where it is stored, read from the file that owns it; a
  set that cannot be read refuses the value and never raises;
* the name catalogue holds names only, none of which the door already knows, and reads a request as
  whole words;
* the weekly report is aggregates by distinct members, withholds a row about one or two members,
  counts the builders' own turns apart, and compares this window with the one before.

The model is scripted throughout; no test here makes a paid call.
"""
from __future__ import annotations

import json
import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.services import auth_db, indicator_names as names, indicator_telemetry as tel
from api.services import named_indicators as ni
from tests.test_indicator_memory import CHART, KIND, account, ema, memory_of  # noqa: F401 -- fixtures by name
from tests.test_named_indicators import create, tree_of
from tests.test_p2_truth_server import conv, emits, empty_view, env, model, out, view  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name
from tests.test_rollout_telemetry import raw_dump, rows, store  # noqa: F401 -- fixture by name

LEARNED = ("asked", "answered", "remembered", "named_built", "acronym_built", "named_held", "unknown_name")
SECRET = "zanzibar-private-words"


def last_turn():
    """The newest recorded turn, BY ROW ID: two turns written in the same second have no order
    the store promises otherwise."""
    conn = auth_db.get_connection()
    try:
        (props,) = conn.execute(
            "SELECT props FROM landing_events WHERE event = 'converse_turn' ORDER BY id DESC LIMIT 1").fetchone()
    finally:
        conn.close()
    return json.loads(props) if props else {}


def learned(p):
    return {k: p[k] for k in LEARNED if k in p}


# ═══ 1. the record: closed ids, and nothing else ═════════════════════════════

def test_the_doors_question_its_answer_and_the_memory_are_each_recorded_by_id(store, conv, account, clean_env, model):
    mem = memory_of(account)
    model([])
    r = conv.converse("Add a 50 day moving average", user_id="u1", view=empty_view(0), chart=CHART, memory=mem)
    assert r["disposition"] == "clarify"
    assert learned(last_turn()) == {"asked": "average_kind"}

    model([emits(ema(50))])
    r = conv.converse("Exponential (EMA)", user_id="u1", view=empty_view(0), chart=CHART,
                      snippets=KIND("Add a 50 day moving average"), memory=mem)
    assert r["disposition"] == "change"
    assert learned(last_turn()) == {"answered": "average_kind"}

    model([emits(ema(20))])
    r = conv.converse("Add a 20 day moving average", user_id="u1", view=empty_view(0), chart=CHART, memory=mem)
    assert r["disposition"] == "change"
    assert learned(last_turn()) == {"remembered": "average_kind"}


def test_a_question_the_assistant_asked_is_recorded_as_the_assistants(store, conv, clean_env, model):
    question = {"id": "which", "text": "Which one?", "choices": ["This", "That"]}
    model([emits(env(0, [], questions=[question]))])
    r = conv.converse("make it better somehow", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["turn"] == "question", r
    assert learned(last_turn()) == {"asked": "assistant"}


def test_a_library_indicator_built_is_recorded_by_its_entry(store, conv, clean_env, model):
    model([emits(env(0, [create("mcginley_dynamic")]))])
    r = conv.converse("Add the McGinley Dynamic", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["disposition"] == "change"
    assert learned(last_turn()) == {"named_built": "mcginley_dynamic"}


def test_a_library_name_that_was_named_and_NOT_built_is_not_recorded_as_built(store, conv, clean_env, model):
    """It is what the patch holds that is recorded, not what the request said."""
    model([emits(env(0, [], reply="The McGinley Dynamic follows price more closely than an average."))])
    r = conv.converse("What is the McGinley Dynamic?", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["disposition"] == "answer"
    assert learned(last_turn()) == {}


def test_a_change_that_brings_no_formula_builds_no_library_indicator(store, conv, clean_env, model):
    """The McGinley Dynamic is on the chart and the member names it while renaming: a change, and
    nothing built."""
    on_chart = view(1, [out("mcginley", tree_of("mcginley_dynamic"), type_="value")], name="McGinley Dynamic")
    model([emits(env(1, [{"op": "rename_definition", "name": "My McGinley"}]))])
    r = conv.converse("rename the McGinley Dynamic to My McGinley", user_id="u1", view=on_chart, chart=CHART)
    assert r["ok"] is True and r["disposition"] == "change"
    assert learned(last_turn()) == {}


def test_a_held_name_refused_is_recorded_by_its_entry_with_no_call(store, conv, clean_env, model):
    client = model([])
    r = conv.converse("Add the TTM Squeeze", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is False and r["gate"] == conv.NAMED_UNCHECKED_GATE and client.calls == []
    assert learned(last_turn()) == {"named_held": "ttm_squeeze"}
    assert "held" not in r                                    # the response carries none of the record's own keys


def test_a_well_known_name_the_door_refuses_is_recorded_by_its_catalogue_id_and_not_its_words(store, conv, clean_env, model):
    client = model([])
    # (the McClellan Oscillator was this example until 2026-11-25: it is withheld now, ruling B)
    r = conv.converse(f"Add the Elliott Wave {SECRET}", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is False and client.calls == []
    assert learned(last_turn()) == {"unknown_name": "elliott_wave"}
    dump = raw_dump()
    assert SECRET not in dump and "Elliott" not in dump and "Wave" not in dump


def test_a_refused_name_in_no_catalogue_row_is_other_and_its_words_are_dropped(store, conv, clean_env, model):
    client = model([])
    r = conv.converse("Add the Zorblat Wiggle Line", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is False and client.calls == []
    assert learned(last_turn()) == {"unknown_name": "other"}
    assert "orblat" not in raw_dump() and "iggle" not in raw_dump()


def test_a_catalogue_name_is_recorded_on_a_turn_that_BUILT_too(store, conv, clean_env, model):
    """So the report can say how often a name was built from the assistant's own knowledge. "kvo"
    is the case: a bare short acronym is never looked up as a name, so this request reaches the
    assistant unmarked, is built unchecked, and is counted under the name it stands for."""
    model([emits(ema(20))])
    r = conv.converse("show kvo with a 20 ema of it", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["disposition"] == "change"
    p = last_turn()
    assert learned(p) == {"unknown_name": "klinger_volume_oscillator"} and p["failure_class"] == "ok"


def test_an_ordinary_turn_records_none_of_them(store, conv, clean_env, model):
    model([emits(ema(20))])
    conv.converse("Add a 20 day exponential moving average", user_id="u1", view=empty_view(0), chart=CHART)
    assert learned(last_turn()) == {}


def test_the_record_never_costs_a_turn(store, conv, clean_env, model, monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("the catalogue is on fire")
    monkeypatch.setattr(names, "names_in", boom)
    model([emits(ema(20))])
    r = conv.converse("Add a 20 day exponential moving average", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["disposition"] == "change"
    assert learned(last_turn()) == {}


def test_the_pieces(conv):
    assert conv.learned_fields({"ok": True, "turn": "question"}, {}) == {
        "asked": "assistant", "answered": None, "remembered": None, "named_built": None, "acronym_built": None,
        "named_held": None, "unknown_name": None}
    assert conv.learned_fields({"ok": True, "turn": "question"}, {"asked": "average_kind"})["asked"] == "average_kind"
    assert conv.learned_fields({"ok": True, "turn": "patch"}, None)["asked"] is None
    assert conv.learned_fields({"ok": False, "turn": "question"}, {})["asked"] is None
    got = conv.learned_fields({"ok": True, "turn": "patch"}, {
        "remembered": ["average_kind", "cross_meaning"], "named_built": ["connors_rsi"], "named_held": [],
        "unknown_name": ["aroon", "other"], "answered": "average_length"})
    assert got == {"asked": None, "answered": "average_length", "remembered": "average_kind,cross_meaning",
                   "named_built": "connors_rsi", "acronym_built": None, "named_held": None, "unknown_name": "aroon,other"}
    # a refused NAME is the door's own sentence about that phrase; any other refusal is not a name
    name = {"phrase": "Gann Fan", "gate": "concept:ungrounded", "reason": conv.UNKNOWN_NAME_REASON.format(name="Gann Fan")}
    concept = {"phrase": "cheap", "gate": "concept:ungrounded", "reason": "no published threshold"}
    assert conv.refused_names([name, concept, None, {"phrase": 3}]) == ["Gann Fan"]
    assert conv.asked_names("Add the Gann Fan", ["Gann Fan"]) == ["gann_fan"]
    assert conv.asked_names("Add the Gann Fan and the Zorblat Line", ["Gann Fan", "Zorblat Line"]) == ["gann_fan", "other"]
    assert conv.asked_names("a 20 day average") == []


# ═══ 2. where it is stored: each field's own closed set ══════════════════════

@pytest.mark.parametrize("key,value", [
    ("asked", "average_kind"), ("asked", "assistant"), ("answered", "cross_meaning"),
    ("remembered", "average_kind,cross_meaning"), ("named_built", "mcginley_dynamic,connors_rsi"),
    ("named_held", "ttm_squeeze"), ("unknown_name", "klinger_volume_oscillator,other"),
])
def test_a_real_id_is_kept(key, value):
    assert tel._prop_violation("converse_turn", key, value) is None
    assert tel.sanitize_props("converse_turn", {key: value}) == {key: value}


@pytest.mark.parametrize("key,value", [
    ("asked", "my private strategy"), ("asked", "average_kind,cross_meaning"), ("asked", "mcginley_dynamic"),
    ("answered", "assistant"), ("answered", "which"), ("remembered", "assistant"),
    ("remembered", "average_kind, cross_meaning"), ("remembered", ""), ("remembered", "average_kind,"),
    ("named_built", "klinger_volume_oscillator"), ("named_built", "McGinley Dynamic"),
    ("named_held", "average_kind"), ("unknown_name", "Klinger Volume Oscillator"),
    ("unknown_name", "mcginley_dynamic"), ("unknown_name", "a secret plan"),
    ("unknown_name", ",".join(["aroon"] * 9)), ("asked", 3), ("named_built", ["mcginley_dynamic"]),
])
def test_anything_that_is_not_an_id_of_that_fields_own_set_is_dropped(key, value):
    assert tel._prop_violation("converse_turn", key, value) is not None
    assert tel.sanitize_props("converse_turn", {key: value, "calls": 1}) == {"calls": 1}


def test_the_sets_are_read_from_the_files_that_own_them(conv):
    assert tel._clarify_ids() == frozenset(conv.clarify_registry())
    assert tel._library_ids() == frozenset(e["id"] for e in ni.entries() + ni.held_names())
    assert tel._catalogue_ids() == names.ids() | {"other"}
    # and they do not overlap in a way that would let one field's id pass as another's
    assert not (tel._clarify_ids() & tel._library_ids()) and "assistant" not in tel._clarify_ids()


def test_a_set_that_cannot_be_read_refuses_the_value_and_never_raises(monkeypatch, store):
    def boom():
        raise RuntimeError("no registry")
    monkeypatch.setattr(tel, "_clarify_ids", boom)
    monkeypatch.setitem(tel._VALUE_RULES["converse_turn"], "asked", tel._ids_of(tel._clarify_ids, many=False))
    assert tel.sanitize_props("converse_turn", {"asked": "average_kind", "calls": 1}) == {"calls": 1}
    assert tel.log_event("u1", "converse_turn", asked="average_kind", calls=1) is True   # the row is still written
    assert last_turn() == {"calls": 1}


def test_the_client_may_not_send_any_of_them():
    """They are the server's own reading of a turn; the browser's door has no such event."""
    assert "converse_turn" not in tel.CLIENT_FIREABLE_EVENTS


# ═══ 3. the name catalogue ═══════════════════════════════════════════════════

def test_the_catalogue_is_names_only_in_one_spelling_each_id_once():
    doc = json.loads(names.PATH.read_text(encoding="utf-8"))
    assert set(doc) == {"_", "names"} and len(doc["names"]) >= 100
    seen_ids, seen_spellings = set(), {}
    for row in doc["names"]:
        assert set(row) - {"distinctive"} == {"id", "name", "aliases"}, row    # no formula, no description
        assert row.get("distinctive", True) is True                           # the mark is `true` or absent
        assert names.ID.fullmatch(row["id"]) and row["id"] not in seen_ids and row["id"] != names.OTHER
        seen_ids.add(row["id"])
        assert row["aliases"] and row["aliases"][0] == names.norm(row["name"])
        for a in row["aliases"]:
            assert a == names.norm(a) and len(a) >= 3, (row["id"], a)
            assert a not in seen_spellings, (a, row["id"], seen_spellings.get(a))
            seen_spellings[a] = row["id"]
    assert names.ids() == frozenset(seen_ids)


def test_no_catalogue_name_is_one_the_door_already_knows(conv):
    """A spelling the library answers, or one the door resolves whole to a function it has, is not
    unknown. Asked of EVERY spelling still counted (a row the library has gained may keep one the
    library does not carry, such as an acronym)."""
    library = {names.norm(a) for a, _ in ni.phrases()}
    checked = 0
    for row in names.catalogue():
        assert not (set(row["aliases"]) & library), row["id"]
        for spelling in row["aliases"]:
            r = conv.understand_turn(f"Add the {spelling}", CHART)
            whole = [t["name"] for t in (r.get("terms") or []) if t.get("section") == "functions"
                     and names.norm(t.get("matched_as")) == spelling] if r["refusal"] is None else []
            assert whole == [], (row["id"], spelling, whole)
            assert not r.get("named"), (row["id"], spelling)
            checked += 1
    assert checked >= 150


def test_a_request_is_read_as_whole_words_longest_first_and_answers_ids_only():
    assert names.names_in("Add the Klinger Volume Oscillator") == ["klinger_volume_oscillator"]
    assert names.names_in("a KLINGER oscillator, please") == ["klinger_volume_oscillator"]
    assert names.names_in("a wavetrend, a WAVE TREND OSCILLATOR") == ["wave_trend_oscillator"]   # one row, read once
    assert names.names_in("macaroons and a necktrix") == []                         # never inside a word
    assert names.names_in("the half-trend") == ["half_trend"]                       # punctuation is spacing
    # a spelling the LIBRARY answers is not unknown; one it does not answer still is
    assert names.names_in("the on-balance volume") == [] and names.names_in("an aroon up line") == []
    assert names.names_in("add kvo") == ["klinger_volume_oscillator"]        # an acronym nothing admits: counted
    assert names.names_in("add dmi") == []                                   # letters that mean two indicators are no row's spelling
    assert names.names_in("add obv") == []                                  # one it does: the library answers it
    assert names.names_in("") == [] and names.names_in(None) == [] and names.names_in(7) == []
    many = "ppo and pvo and trix and qqe and renko and kagi"
    assert len(names.names_in(many)) == names.MAX_PER_TURN
    for got in names.names_in(many) + names.names_in("Add the Klinger Volume Oscillator"):
        assert got in names.ids()
    assert names.lookup("Wave Trend Oscillator") == "wave_trend_oscillator" and names.lookup("wave trend oscillator please") is None
    # a name that has since joined the checked library is not an unknown name any more
    assert names.names_in("a fisher transform") == [] and names.now_in_library().get("fisher_transform") == "fisher_transform"
    assert names.name_of("gann_fan") == "Gann Fan" and names.name_of("nope") is None


def test_a_name_the_library_gains_stops_being_unknown_and_the_file_still_knows_its_id(monkeypatch):
    real = ni.phrases()
    monkeypatch.setattr(ni, "phrases", lambda: real + (("klinger volume oscillator", "klinger_volume_oscillator_entry"),))
    for cached in (names.catalogue, names._spellings):
        cached.cache_clear()
    try:
        assert names.names_in("Add the Klinger Volume Oscillator") == []
        assert "klinger_volume_oscillator" in names.ids()                  # an earlier record still passes
        assert names.now_in_library()["klinger_volume_oscillator"] == "klinger_volume_oscillator_entry"
    finally:
        monkeypatch.undo()
        for cached in (names.catalogue, names._spellings):
            cached.cache_clear()
    assert names.names_in("Add the Klinger Volume Oscillator") == ["klinger_volume_oscillator"]


def test_an_unreadable_catalogue_is_an_empty_one(monkeypatch, tmp_path):
    monkeypatch.setattr(names, "PATH", tmp_path / "missing.json")
    for cached in (names._file, names.catalogue, names._spellings):
        cached.cache_clear()
    try:
        assert names.names_in("Add the Klinger Volume Oscillator") == [] and names.ids() == frozenset()
    finally:
        monkeypatch.undo()
        for cached in (names._file, names.catalogue, names._spellings):
            cached.cache_clear()
    assert len(names.catalogue()) >= 100


# ═══ 4. the weekly owner report ══════════════════════════════════════════════

def turn(user, *, days_ago=0, admin=False, built=False, **fields):
    """One recorded turn, written through the store's own door (so every field is held to its set),
    then moved back in time when the test asks."""
    base = {"access": "admin" if admin else "cohort", "failure_class": "ok" if built or fields.get("asked") else "concept_refused",
            "disposition": "change" if built else ("clarify" if fields.get("asked") else "unsupported"), "calls": 1 if built else 0}
    assert tel.log_event(user, "converse_turn", **{**base, **fields}) is True
    if days_ago:
        conn = auth_db.get_connection()
        try:
            conn.execute("UPDATE landing_events SET created_at = datetime('now', ?) WHERE id = (SELECT MAX(id) FROM landing_events)",
                         (f"-{days_ago} days",))
            conn.commit()
        finally:
            conn.close()


def test_names_asked_for_are_ranked_by_distinct_members_and_each_is_split_by_what_happened(store):
    for u in ("m1", "m2", "m3", "m4"):
        turn(u, unknown_name="klinger_volume_oscillator")
    turn("m1", unknown_name="klinger_volume_oscillator")                    # one member asking twice is one member
    for u in ("m1", "m2", "m3"):
        turn(u, unknown_name="wave_trend_oscillator", built=u != "m3")
    turn("m1", unknown_name="half_trend,other")
    r = tel.weekly_report(7)
    asked = r["names"]["asked_for"]
    assert [n["id"] for n in asked] == ["klinger_volume_oscillator", "wave_trend_oscillator", "half_trend"]   # `other` is no row
    assert asked[0] == {"id": "klinger_volume_oscillator", "name": "Klinger Volume Oscillator", "members": 4, "turns": 5,
                        "refused": 5, "built_unchecked": 0, "built_from_library": 0, "builders_turns": 0,
                        "in_library": None, "in_library_since": None}
    # built with no formula of ours behind the name: the recollection gap, apart from the refusals
    assert (asked[1]["members"], asked[1]["turns"], asked[1]["refused"], asked[1]["built_unchecked"],
            asked[1]["built_from_library"]) == (3, 3, 1, 2, 0)
    assert asked[2] == {"id": "half_trend", "name": "Half Trend", "members": tel.FEWER, "turns": None, "refused": None,
                        "built_unchecked": None, "built_from_library": None, "builders_turns": 0,
                        "in_library": None, "in_library_since": None}
    assert r["names"]["not_in_the_catalogue"] == {"members": tel.FEWER, "turns": None, "builders_turns": 0}
    assert r["withheld_below_members"] == 3


def test_a_row_about_one_or_two_members_withholds_its_numbers_and_three_shows_them(store):
    for n, name in ((2, "renko"), (1, "gann_fan"), (3, "kagi")):
        for i in range(n):
            turn(f"m{i}", unknown_name=name)
    turn("admin-1", admin=True, unknown_name="zig_zag")                    # the builders' own: a shown row of 0 members
    by = {n["id"]: n for n in tel.weekly_report(7)["names"]["asked_for"]}
    assert by["gann_fan"]["members"] == by["renko"]["members"] == "fewer than 3"
    for key in ("turns", "refused", "built_unchecked", "built_from_library"):
        assert by["gann_fan"][key] is None and by["renko"][key] is None, key
    assert (by["kagi"]["members"], by["kagi"]["turns"], by["kagi"]["refused"]) == (3, 3, 3)
    # a withheld row sits after EVERY row that shows a number (a row of 0 members too), and the
    # withheld rows are in name order whatever order they arrived in: the order says nothing
    assert [n["id"] for n in tel.weekly_report(7)["names"]["asked_for"]] == ["kagi", "zig_zag", "gann_fan", "renko"]


def test_the_builders_own_turns_are_counted_apart_and_never_as_members(store):
    for _ in range(5):
        turn("admin-1", admin=True, unknown_name="qqe", built=True)
    turn("m1", unknown_name="qqe")
    (row,) = tel.weekly_report(7)["names"]["asked_for"]
    assert row["members"] == tel.FEWER and row["builders_turns"] == 5 and row["built_unchecked"] is None
    assert tel._counted([("a", {"access": "admin"})] * 4) == {"members": 0, "turns": 0, "builders_turns": 4}
    # a split counts the members' turns only, never the builders'
    rows = [("a", {"access": "admin", "x": 1})] * 4 + [(f"m{i}", {"access": "cohort", "x": i % 2}) for i in range(3)]
    assert tel._counted(rows, odd=lambda p: p["x"] == 1) == {"members": 3, "turns": 3, "odd": 1, "builders_turns": 4}


def test_held_names_and_library_builds_are_reported_by_entry(store):
    for u in ("m1", "m2", "m3"):
        turn(u, named_held="ttm_squeeze")
        turn(u, named_built="mcginley_dynamic,connors_rsi", built=True)
    turn("m4", named_built="mcginley_dynamic", built=True)
    r = tel.weekly_report(7)
    assert r["names"]["held_and_refused"] == [
        {"id": "ttm_squeeze", "name": "TTM Squeeze", "members": 3, "turns": 3, "builders_turns": 0}]
    assert [(b["id"], b["members"], b["turns"]) for b in r["named_built"]] == [
        ("mcginley_dynamic", 4, 4), ("connors_rsi", 3, 3)]
    assert r["named_built"][0]["name"] == "McGinley Dynamic"


def test_a_name_the_library_has_since_gained_says_so_and_its_library_builds_are_the_third_count(store, monkeypatch):
    """Before the library had it: two refused, one built unchecked. Since: four built to the
    checked formula. One row, three counts, so the queue and the gap and the cure read apart."""
    turn("m1", unknown_name="klinger_volume_oscillator")
    turn("m2", unknown_name="klinger_volume_oscillator")
    turn("m3", unknown_name="klinger_volume_oscillator", built=True)
    for u in ("m1", "m2", "m3", "m4"):
        turn(u, named_built="mcginley_dynamic", built=True)                  # the entry standing in for it below
    monkeypatch.setattr(names, "now_in_library", lambda: {"klinger_volume_oscillator": "mcginley_dynamic"})
    (row,) = tel.weekly_report(7)["names"]["asked_for"]
    assert (row["members"], row["turns"]) == (4, 7)
    assert (row["refused"], row["built_unchecked"], row["built_from_library"]) == (2, 1, 4)
    assert row["in_library"] == "mcginley_dynamic"
    assert row["in_library_since"] == ni.entry("mcginley_dynamic")["versions"][0]["since"]
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", row["in_library_since"])


def test_a_name_the_library_gained_shows_its_builds_even_when_nobody_asked_while_it_was_unknown(store, monkeypatch):
    for u in ("m1", "m2", "m3"):
        turn(u, named_built="mcginley_dynamic", built=True)
    monkeypatch.setattr(names, "now_in_library", lambda: {"klinger_volume_oscillator": "mcginley_dynamic",
                                                          "gann_fan": "connors_rsi"})
    (row,) = tel.weekly_report(7)["names"]["asked_for"]                     # gann_fan's entry was not built: no row
    assert row["id"] == "klinger_volume_oscillator"
    assert (row["refused"], row["built_unchecked"], row["built_from_library"]) == (0, 0, 3)


def test_a_turn_is_never_counted_under_two_outcomes(store, monkeypatch):
    """A record that carries both the name and its library entry is one turn, counted once."""
    for u in ("m1", "m2", "m3"):
        turn(u, unknown_name="klinger_volume_oscillator", named_built="mcginley_dynamic", built=True)
    monkeypatch.setattr(names, "now_in_library", lambda: {"klinger_volume_oscillator": "mcginley_dynamic"})
    (row,) = tel.weekly_report(7)["names"]["asked_for"]
    assert row["turns"] == 3
    # and it is a LIBRARY build: what the patch holds is the fact
    assert (row["refused"], row["built_unchecked"], row["built_from_library"]) == (0, 0, 3)


def test_questions_this_window_against_the_one_before_and_per_indicator_built(store):
    # this week: 2 door questions, 1 assistant question, 4 built (1 from memory)
    turn("m1", asked="average_kind")
    turn("m2", asked="average_kind")
    turn("m2", asked="assistant")
    turn("m1", built=True, answered="average_kind")
    turn("m2", built=True, answered="average_kind")
    turn("m1", built=True, remembered="average_kind")
    turn("m3", built=True)
    # the week before: 3 questions, 1 built
    for u in ("m1", "m2", "m3"):
        turn(u, days_ago=9, asked="average_length")
    turn("m1", days_ago=9, built=True)
    # older than both windows: not counted
    turn("m1", days_ago=20, asked="cross_meaning")
    q = tel.weekly_report(7)["questions"]
    assert q["this"] == {
        "turns": 7, "built": 4, "questions": 3, "asked_by_the_door": 2, "asked_by_the_assistant": 1,
        "questions_per_built": 0.75, "question_share_of_turns": round(3 / 7, 3),
        "built_from_memory": 1, "built_from_memory_share": 0.25,
        "by_question": {"average_kind": 2}, "answered": {"average_kind": 2}, "remembered": {"average_kind": 1}}
    assert q["previous"]["questions"] == 3 and q["previous"]["built"] == 1 and q["previous"]["questions_per_built"] == 3.0
    assert q["previous"]["by_question"] == {"average_length": 3}


def test_an_empty_store_reports_zeros_and_nones_never_raises(store):
    r = tel.weekly_report(7)
    assert r["names"] == {"asked_for": [], "held_and_refused": [],
                          "not_in_the_catalogue": {"members": 0, "turns": 0, "builders_turns": 0}}
    assert r["questions"]["this"]["questions_per_built"] is None and r["named_built"] == []
    assert r["second_calls"] == {"repair_gates": {}, "browser_refusals": {}, "repair_rate": None}
    assert r["demand"]["ranked"] == []
    assert tel.weekly_report(-5)["window_days"] == 1 and tel.weekly_report(999)["window_days"] == 45
    assert tel.weekly_report(0)["window_days"] == 7                        # no number given: a week


def test_the_report_holds_no_words_only_ids_names_from_the_repo_and_counts(store, conv, clean_env, model):
    model([])
    conv.converse(f"Add the Elliott Wave {SECRET}", user_id="m1", view=empty_view(0), chart=CHART)
    conv.converse(f"Add the Zorblat Wiggle Line {SECRET}", user_id="m1", view=empty_view(0), chart=CHART)
    text = json.dumps(tel.weekly_report(7))
    assert SECRET not in text and "orblat" not in text


def test_the_report_in_plain_words_says_what_the_report_says(store):
    for u in ("m1", "m2", "m3", "m4"):
        turn(u, unknown_name="klinger_volume_oscillator")
    for u in ("m1", "m2", "m3"):
        turn(u, unknown_name="wave_trend_oscillator", built=u != "m3")
        turn(u, named_held="ttm_squeeze")
        turn(u, named_built="mcginley_dynamic", built=True)
    turn("m1", unknown_name="half_trend,other")
    turn("admin-1", admin=True, unknown_name="half_trend")
    turn("m1", asked="average_kind")
    turn("m2", asked="average_kind")
    turn("m3", asked="assistant")
    turn("m1", built=True, remembered="average_kind")
    turn("m1", days_ago=9, asked="average_length")
    turn("m1", days_ago=9, built=True)
    text = tel.weekly_report_text(tel.weekly_report(7))
    for line in (
        "Create Indicator: the last 7 days",
        "  Indicators built: 6 (the 7 days before: 1)",
        "  Questions asked: 3 (the 7 days before: 1): 2 by the door (no AI call), 1 by the assistant",
        "  Questions per indicator built: 0.5 (the 7 days before: 1.0)",
        "  Built using a remembered choice: 1 of 6",
        "  Asked 2 times: Which kind of moving average?",
        "  Klinger Volume Oscillator: 4 members, 4 requests; 4 refused",
        "  Wave Trend Oscillator: 3 members, 3 requests; 1 refused; 2 built unchecked, from the assistant's own recollection",
        "  Half Trend: fewer than 3 members; 1 by the builders' own accounts",
        "  Names in no list: fewer than 3 members",
        "  TTM Squeeze: 3 members, 3 requests",
        "  McGinley Dynamic: 3 members, 3 builds",
    ):
        assert line in text.split("\n"), line
    assert text.endswith("\n") and "None" not in text.replace("None.", "")       # no raw null reaches the owner


def test_the_report_in_plain_words_says_when_the_library_has_gained_a_name(store, monkeypatch):
    for u in ("m1", "m2", "m3"):
        turn(u, unknown_name="klinger_volume_oscillator")
        turn(u, named_built="mcginley_dynamic", built=True)
    monkeypatch.setattr(names, "now_in_library", lambda: {"klinger_volume_oscillator": "mcginley_dynamic"})
    since = ni.entry("mcginley_dynamic")["versions"][0]["since"]
    text = tel.weekly_report_text(tel.weekly_report(7))
    assert (f"  Klinger Volume Oscillator: 3 members, 6 requests; 3 refused; 3 built from the library; "
            f"in the library since {since}") in text


def test_the_report_in_plain_words_on_an_empty_store(store):
    text = tel.weekly_report_text(tel.weekly_report(7))
    assert "  Indicators built: 0 (the 7 days before: 0)" in text
    assert "  Questions per indicator built: none built (the 7 days before: none)" in text
    assert text.count("  None.") == 4 and "  Nothing." in text and "  Share: none recorded" in text
    assert "None" not in text.replace("None.", "")


def test_the_weekly_report_is_admin_only(store):
    from api.routers import indicator_telemetry as router_mod
    app = FastAPI()
    app.include_router(router_mod.router)
    who = {"user": {"id": "m1", "role": "member", "plan": "pro"}}
    app.dependency_overrides[get_current_user] = lambda: who["user"]
    app.dependency_overrides[get_current_user_with_plan] = lambda: who["user"]
    c = TestClient(app, raise_server_exceptions=False)
    assert c.get("/api/indicator-telemetry/weekly-report").status_code == 403
    who["user"] = {"id": "a1", "role": "admin", "plan": "pro"}
    r = c.get("/api/indicator-telemetry/weekly-report", params={"days": 7})
    assert r.status_code == 200 and set(r.json()) == {
        "window_days", "withheld_below_members", "demand", "names", "questions", "second_calls", "named_built",
        "built_from_an_acronym", "internal_error", "bar_field_order"}
    # the same report in plain words, for a browser tab; and that is admin only too
    t = c.get("/api/indicator-telemetry/weekly-report", params={"format": "text"})
    assert t.status_code == 200 and t.headers["content-type"].startswith("text/plain")
    assert t.text == tel.weekly_report_text(tel.weekly_report(7))
    who["user"] = {"id": "m1", "role": "member", "plan": "pro"}
    assert c.get("/api/indicator-telemetry/weekly-report", params={"format": "text"}).status_code == 403
