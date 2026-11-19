"""ACRONYMS (ruling 2026-11-18): inside the Create Indicator door a library entry may be named by
its acronym ("OBV"), under four conditions. Each is held here for every admitted acronym.

  (1) it names exactly ONE indicator UCT knows by name: it is the initials of its own entry, and of
      no other library entry or name-catalogue row, and it is no word of the product's own;
  (2) every request on file that uses it reads as that indicator. ⚠️ THE REQUESTS ON FILE COULD NOT
      SAY: one of them used an admitted acronym, and it was written to test this. So this condition
      is watched in production instead: every build that came from an acronym is its own row of the
      weekly report, with how often the member's next turn removed or rewrote what was built;
  (3) what was built is always named in FULL, so a misread is visible at once;
  (4) a symbol beside it is still read as the symbol ("OBV of AAPL"), and the acronym is never
      read as one, even where the same letters are a real ticker ("PVT").

Not admitted, and why: ADL (also Advance Decline Line), DMI (also Dynamic Momentum Index), AD.
ADX is the engine's own function word and needs nothing.
"""
from __future__ import annotations

import json
import re

import pytest

from api.services import conversation_preflight as pre
from api.services import definition_concierge as dc
from api.services import indicator_names as names
from api.services import indicator_telemetry as tel
from api.services import named_indicators as ni
from tests.test_learned_record import last_turn, learned, turn
from tests.test_named_indicators import create
from tests.test_p2_truth_server import call, conv, emits, empty_view, env, model, num  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name
from tests.test_rollout_telemetry import store  # noqa: F401 -- fixture by name

CHART = {"sym": "NVDA", "tf": "D"}
ENTRIES = {e["id"]: e for e in ni.entries()}
ADMITTED = [(a, e["id"]) for e in ni.entries() for a in e.get("acronyms") or ()]
S = lambda n: {"type": "series", "name": n}  # noqa: E731


def conflicts(acronym, entry_id=None):
    """Why these letters may NOT be an acronym of `entry_id` (condition 1), as a list of reasons.
    Written here, apart from the library's code: the rule is checked, not trusted."""
    why = []
    if not re.fullmatch(r"[a-z]{2,4}", acronym):
        why.append("not two to four lowercase letters")
    if entry_id is not None and ni.initials(ENTRIES[entry_id]["name"]) != acronym:
        why.append(f"not the initials of {ENTRIES[entry_id]['name']}")
    in_library = names.now_in_library()
    for e in ni.entries() + ni.held_names():
        if e["id"] != entry_id and (ni.initials(e["name"]) == acronym or acronym in e["aliases"]):
            why.append(f"also {e['name']} (library)")
    for row in names._file():
        if in_library.get(row["id"]) == entry_id and entry_id is not None:
            continue                                                        # the same indicator's own catalogue row
        if ni.initials(row["name"]) == acronym or acronym in row["aliases"]:
            why.append(f"also {row['name']} (name catalogue)")
    if dc._matches(f"add {acronym}", dc.LEXICON):
        why.append("a word of the product's own (the shared lexicon)")
    return why


# ═══ (1) one indicator, and nothing else ═════════════════════════════════════

def test_the_admitted_acronyms_are_these_and_each_names_one_indicator_only():
    # (2026-11-18) DPO joined with its entry: the same four conditions, checked by the same code below
    assert sorted(ADMITTED) == [("dpo", "detrended_price_oscillator"), ("kst", "know_sure_thing"),
                                ("obv", "on_balance_volume"),
                                ("ppo", "percentage_price_oscillator"), ("pvt", "price_volume_trend")]
    for acronym, entry_id in ADMITTED:
        assert conflicts(acronym, entry_id) == [], (acronym, conflicts(acronym, entry_id))
    assert len({a for a, _ in ADMITTED}) == len(ADMITTED)


def test_the_ones_left_out_fail_the_same_check_for_the_reason_given():
    """The check that passes the four must be able to refuse: the two candidates that were measured
    and left out each name TWO indicators."""
    adl = conflicts("adl", "accumulation_distribution_line")
    assert adl == ["also Advance Decline Line (name catalogue)"], adl
    dmi = conflicts("dmi", "directional_movement_index")
    assert dmi == ["also Dynamic Momentum Index (name catalogue)"], dmi
    assert "not the initials of On Balance Volume" in conflicts("obx", "on_balance_volume")
    assert "a word of the product's own (the shared lexicon)" in conflicts("adx")
    assert "not two to four lowercase letters" in conflicts("OBV", "on_balance_volume")
    # and none of those is a spelling the library answers
    spellings = {s for s, _ in ni.phrases()}
    assert not ({"adl", "dmi", "ad", "adx"} & spellings)


def test_an_alias_is_still_never_a_bare_short_word_and_an_acronym_is_never_an_alias():
    for e in ni.entries():
        assert not (set(e.get("acronyms") or ()) & set(e["aliases"])), e["id"]
    assert ni.acronym_entry("OBV") == ni.acronym_entry("obv") == ni.acronym_entry(" Obv ") == "on_balance_volume"
    assert ni.acronym_entry("on balance volume") is None and ni.acronym_entry("dmi") is None and ni.acronym_entry(None) is None
    assert ni.initials("Know Sure Thing") == "kst" and ni.initials("Accumulation/Distribution Line") == "adl"


# ═══ at the door: the entry, by its acronym, in any capitals ═════════════════

@pytest.mark.parametrize("acronym,entry_id", ADMITTED)
def test_the_acronym_reaches_its_entry_with_no_call(conv, acronym, entry_id):
    for words in (f"Add {acronym.upper()}", f"add {acronym}", f"show me the {acronym.upper()} in a lower pane"):
        r = conv.understand_turn(words, CHART)
        assert r["refusal"] is None, (words, r["refusal"])
        assert [e["id"] for e in r["named"]] == [entry_id], words
        assert list(conv.by_acronym(r["terms"]).values()) == [entry_id], words
    # the full name is NOT "by acronym"
    r = conv.understand_turn(f"Add the {ENTRIES[entry_id]['name']}", CHART)
    assert [e["id"] for e in r["named"]] == [entry_id] and conv.by_acronym(r["terms"]) == {}


def test_the_planner_shared_with_the_screener_does_not_read_them():
    for acronym, _entry in ADMITTED:
        assert dc._matches(f"add {acronym}", dc.LEXICON) == []


# ═══ (3) what was built is named in full ═════════════════════════════════════

@pytest.mark.parametrize("acronym,entry_id", ADMITTED)
def test_what_was_built_is_named_in_full_and_said_once(store, conv, clean_env, model, acronym, entry_id):
    e = ENTRIES[entry_id]
    client = model([emits(env(0, [create(entry_id)]))])
    r = conv.converse(f"Add {acronym.upper()}", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["disposition"] == "change" and len(client.calls) == 1, r.get("reason")
    said = [a["text"] for a in r["envelope"]["assumptions"] if a.get("output") in {o["key"] for o in e["outputs"]}]
    assert len(said) == 1, said                                             # once for the indicator, not once per output
    assert said[0].startswith(f"Built to UCT's checked formula for {e['name']}"), said
    # and the record says it came from an acronym
    assert learned(last_turn()) == {"named_built": entry_id, "acronym_built": entry_id}


def test_built_by_its_full_name_is_not_recorded_as_from_an_acronym(store, conv, clean_env, model):
    model([emits(env(0, [create("on_balance_volume")]))])
    conv.converse("Add the On Balance Volume", user_id="u1", view=empty_view(0), chart=CHART)
    assert learned(last_turn()) == {"named_built": "on_balance_volume"}


def test_something_else_built_for_an_acronym_is_refused_never_drawn(conv, clean_env, model):
    """The acronym names the library's formula. A patch that holds another one is sent back once
    and then refused: an acronym is not a looser name."""
    other = env(0, [{"op": "create", "name": "OBV", "placement": "pane",
                     "outputs": [{"key": "obv", "tree": call("sma", S("volume"), num(20))}]}])
    client = model([emits(other), emits(other)])
    r = conv.converse("Add OBV", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is False and r["gate"] == "named:formula" and len(client.calls) == 2


# ═══ (4) a symbol beside it is the symbol; the acronym never is ══════════════

@pytest.mark.parametrize("acronym,entry_id", ADMITTED)
def test_a_symbol_beside_the_acronym_is_still_the_symbol(conv, acronym, entry_id):
    r = conv.understand_turn(f"Add {acronym.upper()} of AAPL", CHART)
    assert r["refusal"] is None and [e["id"] for e in r["named"]] == [entry_id]
    assert r["other_sym"] == "AAPL"
    asked = conv.without_acronyms(f"Add {acronym.upper()} of AAPL", conv.by_acronym(r["terms"]))
    assert pre.named_tickers(asked, CHART) == ["AAPL"]


def test_the_library_spelling_wins_over_a_ticker_of_the_same_letters(conv, clean_env, model):
    """PVT is a real ticker to the door's symbol reader. Written in Create Indicator it is the
    Price Volume Trend: it is not a symbol the member asked to read, so a patch that reads the
    symbol PVT is one the member never asked for, and is refused."""
    assert "PVT" in pre.named_tickers("Add PVT", CHART)                     # the reader, left alone, sees a ticker
    r = conv.understand_turn("Add PVT", CHART)
    acronyms = conv.by_acronym(r["terms"])
    assert acronyms == {"PVT": "price_volume_trend"}
    assert pre.named_tickers(conv.without_acronyms("Add PVT", acronyms), CHART) == []
    reads_the_ticker = env(0, [{"op": "create", "name": "PVT close", "placement": "pane", "outputs": [
        {"key": "x", "tree": {"type": "sym", "value": "PVT", "args": [S("close")]}},
        *create("price_volume_trend")["outputs"]]}])
    model([emits(reads_the_ticker), emits(reads_the_ticker)])
    r = conv.converse("Add PVT", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is False and r["gate"] == "unsupported:symbol-unasked", (r.get("gate"), r.get("reason"))


def test_without_acronyms_takes_out_those_words_and_no_others(conv):
    assert conv.without_acronyms("Add PVT of AAPL", {"PVT": "price_volume_trend"}).split() == ["Add", "of", "AAPL"]
    assert conv.without_acronyms("Add PVTX and PVT", {"PVT": "price_volume_trend"}).split() == ["Add", "PVTX", "and"]
    assert conv.without_acronyms("a pvt.to line and pvt", {"pvt": "price_volume_trend"}).split() == ["a", "pvt.to", "line", "and"]
    assert conv.without_acronyms("Add PVT.", {"PVT": "price_volume_trend"}).split() == ["Add", "."]       # a full stop is not a dotted symbol
    assert conv.without_acronyms("XYZ.PVT against PVT", {"PVT": "price_volume_trend"}).split() == ["XYZ.PVT", "against"]
    assert conv.without_acronyms("OBV vs BRK.B", {"OBV": "on_balance_volume"}).split() == ["vs", "BRK.B"]
    assert conv.without_acronyms("Add PVT", {}) == "Add PVT" and conv.without_acronyms(None, {"PVT": "x"}) == ""


# ═══ (2) watched: the weekly report's own row, and a misread's mark ══════════

def conversation(user, cid, *steps):
    for fields in steps:
        turn(user, conversation_id=cid, **fields)


def test_builds_from_an_acronym_are_their_own_row_with_how_often_the_next_turn_undid_them(store):
    conversation("m1", "auth_aaaaaaaaaaa1", {"built": True, "named_built": "on_balance_volume", "acronym_built": "on_balance_volume", "op_kinds": "create"},
                 {"built": True, "op_kinds": "remove_output"})                 # taken away at once: a misread's mark
    conversation("m2", "auth_aaaaaaaaaaa2", {"built": True, "named_built": "on_balance_volume", "acronym_built": "on_balance_volume", "op_kinds": "create"},
                 {"built": True, "op_kinds": "set_style"})                     # recoloured: ordinary use
    conversation("m3", "auth_aaaaaaaaaaa3", {"built": True, "named_built": "on_balance_volume", "acronym_built": "on_balance_volume", "op_kinds": "create"})
    conversation("m4", "auth_aaaaaaaaaaa4", {"built": True, "named_built": "on_balance_volume", "acronym_built": "on_balance_volume", "op_kinds": "create"},
                 {"built": True, "op_kinds": "set_slot"},                      # a number changed: ordinary use
                 {"built": True, "op_kinds": "create"})                        # ... and only the NEXT turn counts
    conversation("m1", "auth_aaaaaaaaaaa5", {"built": True, "named_built": "know_sure_thing", "acronym_built": "know_sure_thing", "op_kinds": "create"},
                 {"built": True, "op_kinds": "set_output_tree"})
    turn("m5", built=True, named_built="on_balance_volume", op_kinds="create")   # by its full name: not in this row
    turn("m6", days_ago=9, built=True, named_built="on_balance_volume", acronym_built="on_balance_volume", op_kinds="create")   # the window before: not this report's
    rows = tel.weekly_report(7)["built_from_an_acronym"]
    assert rows[0] == {"id": "on_balance_volume", "name": "On Balance Volume", "acronyms": ["obv"], "members": 4,
                       "turns": 4, "changed_or_removed_next": 1, "builders_turns": 0}
    assert rows[1] == {"id": "know_sure_thing", "name": "Know Sure Thing", "acronyms": ["kst"], "members": tel.FEWER,
                       "turns": None, "changed_or_removed_next": None, "builders_turns": 0}
    assert len(rows) == 2


def test_the_next_turn_is_the_next_in_THAT_conversation_and_one_with_no_conversation_has_none(store):
    turn("m1", built=True, conversation_id="auth_bbbbbbbbbbb1", acronym_built="price_volume_trend", named_built="price_volume_trend", op_kinds="create")
    turn("m2", built=True, conversation_id="auth_bbbbbbbbbbb2", acronym_built="price_volume_trend", named_built="price_volume_trend", op_kinds="create")
    turn("m3", built=True, acronym_built="price_volume_trend", named_built="price_volume_trend", op_kinds="create")        # no conversation id
    turn("m9", built=True, conversation_id="auth_bbbbbbbbbbb9", op_kinds="remove_output")     # ANOTHER conversation's removal
    turn("m2", built=True, conversation_id="auth_bbbbbbbbbbb2", op_kinds="remove_output")     # m2's own, later
    (row,) = tel.weekly_report(7)["built_from_an_acronym"]
    assert (row["members"], row["turns"], row["changed_or_removed_next"]) == (3, 3, 1)
    assert tel.MISREAD_FOLLOW_UPS == {"remove_output", "set_output_tree", "create"}


def test_the_report_in_plain_words_has_the_acronym_rows(store):
    for i in range(3):
        conversation(f"m{i}", f"auth_ccccccccccc{i}", {"built": True, "named_built": "on_balance_volume", "acronym_built": "on_balance_volume", "op_kinds": "create"},
                     *([{"built": True, "op_kinds": "remove_output"}] if i == 0 else []))
    text = tel.weekly_report_text(tel.weekly_report(7))
    assert "BUILT FROM AN ACRONYM (and how often the next turn removed or rewrote it: a misread's mark)" in text
    assert "  OBV as On Balance Volume: 3 members, 3 builds; 1 removed or rewritten on the next turn" in text


def test_only_a_library_id_may_be_recorded_as_built_from_an_acronym():
    assert tel._prop_violation("converse_turn", "acronym_built", "on_balance_volume") is None
    for bad in ("obv", "OBV", "klinger_volume_oscillator", "my private words", ""):
        assert tel._prop_violation("converse_turn", "acronym_built", bad) is not None, bad
    assert "acronym_built" in json.dumps(sorted(tel.EVENT_SCHEMAS["converse_turn"]))
