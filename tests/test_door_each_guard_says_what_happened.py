"""EACH GUARD OF THE DOOR SAYS WHAT REALLY HAPPENED.

Found by the live re-check of the day-length guard, as a member (2026-11-23, 3 of 24 requests). The assistant wrote
the days the member asked for as bars of the chart, twice; the guard refused it twice (right); and the member read:

    the assistant's change named a part of the indicator that does not exist, so nothing was offered to apply

That is FALSE. It is the member sentence of the gate `envelope:reference`, which eleven guards and the replay check
had borrowed for their own refusals. It shows only when the one repair fails too, so no check of a single answer saw
it. Measured over the 494 recorded final answers of the door: 3 were refused under that gate, and all 3 were the
day-length guard's.

Held here:
  * THE RAIL, read from the module's own syntax tree (its code, never a comment): `envelope:reference` is raised by
    `_check_references` alone; every gate of `GUARD_REFUSALS` is raised by exactly ONE function; a gate two functions
    raise is one of the two that are the same finding in two places, and nothing else; no two gates share a sentence;
  * THE RAIL CAN FAIL: one guard pointed back at `envelope:reference` turns it red, by name;
  * each guard's refusal resolves to ITS sentence, through the door's own lookup, for the member and for the model;
  * the day-length sentence is ONE string (the engine unit that lets a chart below a day build on daily bars changes
    it, and it alone);
  * the new gates are in the same class as the old one for the repair turn and for telemetry;
  * AT THE DOOR: a request refused twice by a guard tells the member what that guard found.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import ast
import copy
from pathlib import Path

import pytest

from api.services import definition_conversation as dc
from tests.test_door_days_on_an_intraday_chart import FIVE, STAND_IN
from tests.test_door_days_on_an_intraday_chart import WORDS as DAYS_WORDS
from tests.test_door_fill_in_settings import CHART, LIVE, REPLY, SILENT
from tests.test_door_fill_in_settings import WORDS as SHARES_WORDS
from tests.test_p2_truth_server import conv, emits, empty_view, env, model  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

SOURCE = Path(dc.__file__).read_text(encoding="utf-8")
BORROWED = "envelope:reference"
THE_FALSE_SENTENCE = "the assistant's change named a part of the indicator that does not exist, so nothing was offered to apply"
#: a gate two functions raise ON PURPOSE: the same finding met in two places, so the one sentence is true in both
SAME_FINDING_IN_TWO_PLACES = {"model:no-tool", "schema:node", "unsupported:scalar"}


def raisers(source=SOURCE):
    """{gate: the top-level functions that raise `_Refused` with that gate written as a literal}."""
    out = {}
    for fn in ast.parse(source).body:
        if isinstance(fn, ast.FunctionDef):
            for node in ast.walk(fn):
                if (isinstance(node, ast.Call) and getattr(node.func, "id", None) == "_Refused" and node.args
                        and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str)):
                    out.setdefault(node.args[0].value, set()).add(fn.name)
    return out


def problems(raised, guard_gates, refusals):
    """Every way a guard's refusal could resolve to a sentence that is not its own."""
    out = []
    if raised.get(BORROWED, set()) != {"_check_references"}:
        out.append(f"`{BORROWED}` is raised by {sorted(raised.get(BORROWED, set()))}: only `_check_references` names a part that does not exist")
    for gate in sorted(guard_gates):
        owners = raised.get(gate, set())
        if len(owners) != 1:
            out.append(f"`{gate}` is raised by {sorted(owners)}: a guard's gate has exactly one owner")
    shared = {gate for gate, owners in raised.items() if len(owners) > 1}
    if shared != SAME_FINDING_IN_TWO_PLACES:
        out.append(f"gates raised by more than one function: {sorted(shared)}; allowed, each for a stated reason: {sorted(SAME_FINDING_IN_TWO_PLACES)}")
    for gate in sorted(raised):
        # (the answer-shape gates, `envelope:*`: the class this finding is in. A gate of another class may say its
        # own clause through `member=` over the generic sentence, which is true of whatever it refuses.)
        if gate.startswith("envelope:") and gate not in refusals:
            out.append(f"`{gate}` has no sentence of its own: the member would read the generic one")
    by_sentence = {}
    for gate, sentence in refusals.items():
        by_sentence.setdefault(sentence, []).append(gate)
    for sentence, gates in sorted(by_sentence.items()):
        if len(gates) > 1:
            out.append(f"{sorted(gates)} share one sentence")
    return out


# ── the rail ──

def test_THE_RAIL_no_guard_borrows_another_gates_sentence():
    assert problems(raisers(), dc.GUARD_REFUSALS, dc.REFUSALS) == []
    # what it read is real: thirteen guard gates, each with its one owner, and the fourteen ways a reference can be wrong
    raised = raisers()
    assert set(dc.GUARD_REFUSALS) <= set(raised) and len(dc.GUARD_REFUSALS) == 13
    assert {gate: next(iter(raised[gate])) for gate in dc.GUARD_REFUSALS} == {
        "envelope:days-as-bars": "check_day_lengths", "envelope:days-choice-in-days": "check_day_lengths",
        "envelope:date-number": "check_date_numbers", "envelope:bars-back-sign": "_refuse_negative_bars_back",
        "envelope:infinity-in-a-window": "_refuse_infinity_in_a_window",
        "envelope:event-window": "_refuse_a_value_at_an_event_that_cannot_look_back",
        "envelope:stand-in-drawn": "_refuse_a_stand_in_drawn_as_a_value",
        "envelope:compared-with-itself": "_refuse_a_reading_compared_with_itself",
        "envelope:number-for-a-value": "_refuse_a_scope_read_of_nothing",
        "envelope:reply-placeholder": "_refuse_a_placeholder_reply",
        "envelope:fill-in-drawn-bare": "_refuse_a_bare_fill_in_setting",
        "envelope:reply-silent-on-your-figure": "_refuse_a_reply_silent_on_a_figure_only_the_member_has",
        "envelope:replayed": "_converse_turn"}


@pytest.mark.parametrize("gate", sorted(dc.GUARD_REFUSALS))
def test_THE_RAIL_CAN_FAIL_a_guard_pointed_back_at_the_borrowed_gate_is_named(gate):
    """The mutation the coordinator asked for, run on a copy of the source: nothing on disk is touched."""
    assert SOURCE.count(f'"{gate}"') == 2, gate                      # once where it is raised, once where its sentence is held
    at = SOURCE.rindex(f'"{gate}"')                                    # the raise comes after the table
    mutated = SOURCE[:at] + f'"{BORROWED}"' + SOURCE[at + len(gate) + 2:]
    found = problems(raisers(mutated), dc.GUARD_REFUSALS, dc.REFUSALS)
    assert any(f"`{BORROWED}` is raised by" in line for line in found), found
    assert any(f"`{gate}` is raised by []" in line for line in found), found


def test_THE_RAIL_CAN_FAIL_the_other_ways():
    raised = raisers()
    # two guards sharing one gate
    two = {**raised, "envelope:stand-in-drawn": {"_refuse_a_stand_in_drawn_as_a_value", "_refuse_a_scope_read_of_nothing"}}
    assert any("a guard's gate has exactly one owner" in line for line in problems(two, dc.GUARD_REFUSALS, dc.REFUSALS))
    # a gate raised with no sentence of its own
    assert any("has no sentence of its own" in line for line in problems({**raised, "envelope:brand-new": {"_refuse_x"}}, dc.GUARD_REFUSALS, dc.REFUSALS))
    # two gates with one sentence
    same = {**dc.REFUSALS, "envelope:replayed": dc.REFUSALS["envelope:reply-placeholder"]}
    assert any("share one sentence" in line for line in problems(raised, dc.GUARD_REFUSALS, same))
    # a new shared gate nobody named
    extra = {**raised, "envelope:revision": raised["envelope:revision"] | {"_refuse_x"}}
    assert any("gates raised by more than one function" in line for line in problems(extra, dc.GUARD_REFUSALS, dc.REFUSALS))


# ── each guard's sentence ──

@pytest.mark.parametrize("gate", sorted(dc.GUARD_REFUSALS))
def test_a_guards_refusal_resolves_to_ITS_sentence_for_the_member_and_names_its_gate_to_the_model(gate):
    refused = dc._Refused(gate, "outputs[0]: the diagnostic")
    assert refused.reason == dc.GUARD_REFUSALS[gate] == dc.REFUSALS[gate] != THE_FALSE_SENTENCE
    assert refused.for_model() == f"[{gate}] {dc.GUARD_REFUSALS[gate]} -- outputs[0]: the diagnostic"
    sentence = dc.GUARD_REFUSALS[gate]
    assert sentence.startswith("the assistant ") and "nothing was offered to apply" in sentence
    # a member's sentence carries no path, no code and no gate name
    assert not any(mark in sentence for mark in ("`", "[", "ops", "envelope", "outputs", "tf(", "_"))


def test_the_sentence_that_was_false_still_belongs_to_the_one_check_it_is_true_for():
    assert dc.REFUSALS[BORROWED] == THE_FALSE_SENTENCE and BORROWED not in dc.GUARD_REFUSALS
    assert dc._Refused(BORROWED, "ops[0] create: two outputs share one key").reason == THE_FALSE_SENTENCE


def test_the_day_length_sentence_is_ONE_string():
    assert dc.GUARD_REFUSALS["envelope:days-as-bars"] is dc.DAYS_BELOW_A_DAY_MEMBER
    assert "counting the days you asked for as bars of this chart" in dc.DAYS_BELOW_A_DAY_MEMBER
    assert dc.DAYS_BELOW_A_DAY_MEMBER.endswith("On a daily chart this builds as asked")
    # it is written once in the module: the constant, read by the table
    assert SOURCE.count("counting the days you asked for as bars of this chart") == 1


def test_the_new_gates_are_in_the_old_ones_class_for_the_repair_and_for_telemetry():
    for gate in dc.GUARD_REFUSALS:
        assert gate.startswith("envelope:") and gate.startswith(dc._MODEL_GATE_PREFIXES), gate
        assert gate not in dc._TERMINAL_GATES                        # each still gets its one repair
    assert BORROWED.startswith(dc._MODEL_GATE_PREFIXES) and BORROWED not in dc._TERMINAL_GATES


# ── each guard, raising its own gate ──

def refused_by(fn, *args):
    try:
        fn(*args)
    except dc._Refused as exc:
        return exc
    return None


def test_the_guards_found_live_raise_their_own_gates():
    assert refused_by(dc.check_day_lengths, STAND_IN, DAYS_WORDS, FIVE).gate == "envelope:days-as-bars"
    assert refused_by(dc._refuse_a_bare_fill_in_setting, {"ops": LIVE["ops"]}).gate == "envelope:fill-in-drawn-bare"
    assert refused_by(dc._refuse_a_reply_silent_on_a_figure_only_the_member_has, SILENT).gate == "envelope:reply-silent-on-your-figure"
    assert refused_by(dc._refuse_a_placeholder_reply, {"ops": LIVE["ops"], "reply": "Placeholder"}).gate == "envelope:reply-placeholder"


# ── at the door ──

def test_THE_FINDING_days_refused_twice_tell_the_member_what_happened(conv, clean_env, model):
    client = model([emits(STAND_IN), emits(STAND_IN)])
    r = conv.converse(DAYS_WORDS, user_id="u1", view=empty_view(0), chart=FIVE)
    assert r["ok"] is False and len(client.calls) == 2
    assert r["gate"] == "envelope:days-as-bars" and r["reason"] == dc.DAYS_BELOW_A_DAY_MEMBER
    assert "does not exist" not in r["reason"] and "envelope" not in r                      # nothing false, nothing to apply


def test_a_bare_setting_refused_twice_tells_the_member_what_happened(conv, clean_env, model):
    bare = {**env(0, copy.deepcopy(LIVE["ops"])), "reply": REPLY}
    client = model([emits(bare), emits(bare)])
    r = conv.converse(SHARES_WORDS, user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is False and len(client.calls) == 2
    assert r["gate"] == "envelope:fill-in-drawn-bare" and r["reason"] == dc.GUARD_REFUSALS["envelope:fill-in-drawn-bare"]


def test_a_silent_reply_refused_twice_tells_the_member_what_happened(conv, clean_env, model):
    silent = {**env(0, copy.deepcopy(SILENT["ops"])), "reply": SILENT["reply"]}
    client = model([emits(silent), emits(silent)])
    r = conv.converse(SHARES_WORDS, user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is False and len(client.calls) == 2
    assert r["gate"] == "envelope:reply-silent-on-your-figure"
    assert r["reason"] == dc.GUARD_REFUSALS["envelope:reply-silent-on-your-figure"]


def test_CONTROL_a_part_that_does_not_exist_still_reads_as_one(conv, clean_env, model):
    close = {"type": "series", "name": "close"}
    bad = env(0, [{"op": "create", "name": "Two", "placement": "pane", "outputs": [{"key": "a", "tree": close}, {"tree": close}]}], reply="Built it.")
    client = model([emits(bad), emits(bad)])
    r = conv.converse("plot the close twice", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is False and len(client.calls) == 2 and r["gate"] == BORROWED and r["reason"] == THE_FALSE_SENTENCE
