"""A DISCLOSED STAND-IN IS NOT A BUILD, and the record says which guard refused each attempt.

⚰️ MEASURED 2026-11-23 over every recorded door answer (289 distinct formula builds): ONE reply says it built
something other than what was asked. Asked "how many bars back the most recent close above today's close was", the
formula lane counted back to the last bar that closed above THE BAR BEFORE IT and said so in its reply. Wrong on
1,267 of 1,700 bars. The honest answer needs a loop, which is a script, and the door hands a request to the script
lane only when the formula turn DECLINES: a turn that builds something else, and discloses it, is never handed on.

It was built on the REPAIR call (2 calls). Which guard refused the first attempt was not on record: a member's
response said `attempts: 2` and nothing else. So three things are held here:
  * the instructions say it where declining is told: a different thing, built and disclosed, is still a different
    thing (`DISCLOSED_STAND_IN_RULE`);
  * the repair note of `envelope:compared-with-itself` (the likely first refusal: a look-back written `close >
    close`) taught only percentrank, HOW MANY bars are above today's value, and had no exit for WHICH bar. It has
    the exit the number-for-a-value note has (`WHICH_BAR_EXIT`). Cause LIKELY, not measured;
  * a response says, BY CODE, which guard refused each attempt, for every account (`refused_attempts`), so the next
    one is measured. What the repair turn was TOLD still reaches an admin only.

No model is called and nothing reaches the network.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services import definition_conversation as dc
from api.services import script_conversation as sc
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    _B, FakeClient, call, conv, emits, empty_view, env, model, num, op, out, view,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name
from tests.test_script_conversation import A_PATCH, ACCEPTS, CHART, GOOD, lane, writes  # noqa: F401 -- `lane` is a fixture

ROOT = Path(__file__).resolve().parents[1]
CLOSE = {"type": "series", "name": "close"}
WORDS = ("In a pane under the chart, plot how many bars back the most recent close above today's close was, "
         "looking back at most 250 bars, and plot nothing when there is none")
GATE = "envelope:compared-with-itself"
#: the look-back as a first attempt writes it: inside a window each close is read at its own bar, so this is `x > x`
ITSELF = env(0, [{"op": "create", "name": "Bars since a higher close", "placement": "pane", "outputs": [
    {"key": "back", "tree": call("barssince", op(">", CLOSE, CLOSE), num(250))}]}])
DECLINES = env(0, [], disposition="unsupported",
               reply="A formula here cannot look back for the bar that closed above today's close. I can plot how many of the last 250 closes were above it.")


# ── (a) the instruction ──

def test_the_rule_stands_once_where_the_instructions_tell_how_to_decline():
    prompt, rule = dc.CONVERSE_SYSTEM_PROMPT, dc.DISCLOSED_STAND_IN_RULE
    assert prompt.count(rule) == 1
    # right after the general rule it sharpens, in the section about what is not offered
    assert "say so plainly in `reply`. Never substitute something different.\n" + rule in prompt
    assert prompt.index("DO NOT FABRICATE CAPABILITIES") < prompt.index(rule)
    for part in ("A DIFFERENT THING, BUILT AND DISCLOSED, IS STILL A DIFFERENT THING", "does not compute what the member asked for on every bar",
                 "set disposition unsupported", "name the one thing a formula here cannot hold", "OFFER the nearest thing",
                 "written as a script"):
        assert part in rule, part
    assert rule.startswith("  * ") and rule.endswith("\n")             # one bullet of that list, like its neighbours


# ── (b) the repair note ──

def _told(check, tree):
    with pytest.raises(dc._Refused) as caught:
        check([("output back", tree)])
    return caught.value


def test_the_note_that_teaches_another_way_says_what_to_do_when_there_is_none():
    refused = _told(dc._refuse_a_reading_compared_with_itself, call("barssince", op(">", CLOSE, CLOSE), num(250)))
    assert refused.gate == GATE
    told = refused.for_model()
    assert "percentrank" in told and told.endswith(dc.WHICH_BAR_EXIT)
    for part in ("WHICH bar or HOW LONG AGO", "answer `unsupported` and say what is missing", "Do not build another measure in its place"):
        assert part in dc.WHICH_BAR_EXIT, part
    # the member's sentence is the guard's own, untouched: the exit is for the model alone
    assert refused.reason == dc.REFUSALS[GATE] and "percentrank" not in refused.reason and "unsupported" not in refused.reason


def test_CONTROL_the_note_it_is_modelled_on_has_the_same_exit():
    refused = _told(dc._refuse_a_scope_read_of_nothing, {"type": "tf", "value": "W", "args": [num(5)]})
    assert refused.gate == "envelope:number-for-a-value" and "answer `unsupported` and say what is missing" in refused.for_model()


# ── the hand-over: a turn that declines ON ITS REPAIR is followed by a script ──

def _text(sent):
    """Every string in what was sent to the model, whatever shape it is in."""
    if isinstance(sent, str):
        return sent
    if isinstance(sent, dict):
        return " ".join(_text(v) for v in sent.values())
    if isinstance(sent, (list, tuple)):
        return " ".join(_text(v) for v in sent)
    return ""


def test_a_formula_turn_that_declines_on_its_repair_call_is_followed_by_a_script(conv, clean_env, model, lane):
    client = model([emits(ITSELF), emits(DECLINES), writes()])
    r = conv.converse(WORDS, user_id="u1", view=empty_view(0), chart=CHART, admin=True, accepts=ACCEPTS)
    assert [c["tools"][0]["name"] for c in client.calls] == [conv.TOOL_NAME, conv.TOOL_NAME, sc.TOOL_NAME]
    # the repair call was told the exit, and took it
    assert dc.WHICH_BAR_EXIT.strip() in _text(client.calls[1]["messages"])
    assert r["ok"] is True and r["turn"] == "script" and r["script"]["pine"] == GOOD
    assert r["refused_attempts"] == [{"attempt": 1, "gate": GATE}]


def test_CONTROL_a_turn_that_builds_something_else_is_never_handed_to_a_script(conv, clean_env, model, lane):
    """Why the rule matters: the door cannot tell a stand-in from a build, so only a DECLINE reaches the script lane."""
    client = model([emits(ITSELF), emits(A_PATCH)])
    r = conv.converse(WORDS, user_id="u1", view=empty_view(0), chart=CHART, admin=True, accepts=ACCEPTS)
    assert [c["tools"][0]["name"] for c in client.calls] == [conv.TOOL_NAME, conv.TOOL_NAME]
    assert r["ok"] is True and r["turn"] == "patch" and "script" not in r


# ── (c) the instrument ──

def test_a_member_reads_which_guard_refused_by_its_code_and_never_what_the_model_was_told(conv, clean_env, model):
    model([emits(ITSELF), emits(A_PATCH)])
    r = conv.converse(WORDS, user_id="u1", view=empty_view(0), chart=CHART, admin=False, accepts=ACCEPTS)
    assert r["ok"] is True and r["attempts"] == 2
    assert r["refused_attempts"] == [{"attempt": 1, "gate": GATE}]
    assert "diagnostic" not in r and "percentrank" not in json.dumps(r)
    # an admin reads the code too, and what the repair turn was told
    model([emits(ITSELF), emits(A_PATCH)])
    r = conv.converse(WORDS, user_id="u2", view=empty_view(0), chart=CHART, admin=True, accepts=ACCEPTS)
    assert r["refused_attempts"] == [{"attempt": 1, "gate": GATE}]
    assert [d["gate"] for d in r["diagnostic"]] == [GATE] and "percentrank" in r["diagnostic"][0]["detail"]


def test_a_turn_refused_twice_names_both_attempts_and_one_never_refused_names_none(conv, clean_env, model):
    model([emits(ITSELF), emits(ITSELF)])
    r = conv.converse(WORDS, user_id="u1", view=empty_view(0), chart=CHART, admin=False, accepts=ACCEPTS)
    assert r["ok"] is False and r["gate"] == GATE
    assert r["refused_attempts"] == [{"attempt": 1, "gate": GATE}, {"attempt": 2, "gate": GATE}]
    model([emits(A_PATCH)])
    r = conv.converse(WORDS, user_id="u3", view=empty_view(0), chart=CHART, admin=False, accepts=ACCEPTS)
    assert r["ok"] is True and r["attempts"] == 1 and "refused_attempts" not in r


def test_only_a_code_of_this_door_is_carried_and_nothing_beside_it():
    refusals = [{"attempt": 1, "gate": GATE, "detail": "output back: `a > b` compares a reading with ITSELF"},
                {"attempt": 2, "gate": "something a model wrote", "detail": "x"},
                {"attempt": "3", "gate": GATE}, {"gate": GATE}, "not a refusal", None]
    assert dc.refused_attempts(refusals) == [{"attempt": 1, "gate": GATE}]
    assert dc.refused_attempts(None) == [] and dc.refused_attempts([]) == []
    assert GATE in dc.REFUSALS


# ── the fact, where the FIRST attempt reads it (2026-11-23) ──

def test_the_first_attempt_reads_the_fact_the_repair_note_carries():
    """⚰️ Six live samples of this request since the rule above: 4 right, each after a guard's note had said a formula
    cannot do this; 2 wrong, each a first formula that passed every guard and never read that note."""
    prompt, rule = dc.CONVERSE_SYSTEM_PROMPT, dc.LOOK_BACK_RULE
    assert prompt.count(rule) == 1
    # in the vocabulary section, right after the reading of "for the first time in N bars" (the other look-back rule)
    assert "without it the mark repeats on every bar of a run.\n" + rule in prompt
    for part in ("A LOOK-BACK NEVER COMPARES ITS BARS WITH TODAY'S VALUE", "each series is read at its own bar",
                 "`close > close` there compares every bar with itself", "`close[1] > close` compares each bar with the one before it",
                 "the door can have it written as a script"):
        assert part in rule, part
    # ONE constant: the instruction CONTAINS the repair note's own exit, and the exit is written once in the module
    assert dc.WHICH_BAR_EXIT in rule and prompt.count(dc.WHICH_BAR_EXIT) == 1
    source = (ROOT / "api" / "services" / "definition_conversation.py").read_text(encoding="utf-8")
    assert source.count("no formula here holds") == 1
    # and the repair note still ends with it: the two places cannot drift apart
    refused = _told(dc._refuse_a_reading_compared_with_itself, call("barssince", op(">", CLOSE, CLOSE), num(250)))
    assert refused.for_model().endswith(dc.WHICH_BAR_EXIT)


def test_CONTROL_the_two_wrong_first_attempts_pass_every_guard_which_is_why_the_instruction_is_needed():
    """The formulas the two wrong live answers were built from. No guard refuses them (each compares a bar with its
    NEIGHBOUR, not with itself), so nothing but the instructions can stop them."""
    before = {"type": "offset", "value": 1, "args": [CLOSE]}
    for cond in (op(">", CLOSE, before), op(">", before, CLOSE)):
        envelope = env(0, [{"op": "create", "name": "Bars since a higher close", "placement": "pane", "outputs": [
            {"key": "back", "tree": call("barssince", cond, num(250))}]}])
        assert dc.check_envelope(envelope, 0, empty_view(0)) is not None

