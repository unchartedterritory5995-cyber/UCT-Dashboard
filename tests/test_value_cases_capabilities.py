"""EVERY CAPABILITY THE ASSISTANT IS TOLD IT MAY USE HAS A VALUE CASE, or is on a list that may only shrink.

`pine_authoring.CAPABILITY_WORDS` is what the script assistant reads as "LANGUAGE YOU MAY USE": one wording per
admitted capability of the runtime lane. A capability can be admitted and worded with nothing anywhere showing that
a script the assistant WRITES with it comes out right: a new id was silent until someone worded it, and worded
without one answer ever held by value.

The rule (Studio plan section 7, L10, with the Pine coordinator): a capability's wording ships with one value
case. Which capabilities a recorded script uses is asked of the ONE detector (`pine_capabilities.capabilities_of`),
never typed here.

  * a capability with a wording and no script case must be named in the fixture's
    `capabilities_without_a_case`. A NEW wording with no case is red;
  * that list may only shrink: a capability that gains a case must leave it (so the list stays true);
  * a capability the recorded scripts USE that has no wording is named too (`capabilities_used_without_words`):
    the assistant wrote with something it was never told it may use, which is a finding either way.
"""
from __future__ import annotations

import json
from pathlib import Path

from api.services import pine_authoring, pine_capabilities

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "tests" / "fixtures" / "authoring" / "value_cases.json").read_text(encoding="utf-8"))
SCRIPT = [c for c in DATA["cases"] if c["lane"] == "script"]


def used_by_cases(cases):
    """{capability id: the case ids whose recorded script uses it}, by the one detector."""
    out = {}
    for case in cases:
        for cap in pine_capabilities.capabilities_of(case["answer"]["script"]["pine"]):
            out.setdefault(cap, []).append(case["id"])
    return out


USED = used_by_cases(SCRIPT)
WORDED = list(pine_authoring.CAPABILITY_WORDS)


def uncovered(worded, used):
    return sorted(c for c in worded if c not in used)


def test_a_worded_capability_with_no_case_is_on_the_list_and_the_list_is_true():
    listed = DATA["capabilities_without_a_case"]
    assert listed == sorted(listed) and len(set(listed)) == len(listed)
    now = uncovered(WORDED, USED)
    new = sorted(set(now) - set(listed))
    assert not new, (f"worded for the assistant with no value case: {new}. Record one script the assistant writes with each "
                     "(tools/value_record.py), hold it by value, and add it to the cases. Do not add the id to the list.")
    gone = sorted(set(listed) - set(now))
    assert not gone, f"these now have a case (or lost their wording): take them OFF capabilities_without_a_case: {gone}"


def test_the_list_may_only_shrink():
    # MEASURED 2026-11-22, when the rule began: 29 worded, 13 with a case, 16 without. The number below is the most
    # the list has ever been allowed to hold; lower it as cases arrive, never raise it.
    assert len(DATA["capabilities_without_a_case"]) <= 14
    assert len(WORDED) - len(DATA["capabilities_without_a_case"]) >= 15


def test_CONTROL_a_new_wording_with_no_case_is_caught():
    assert "a-capability-admitted-tomorrow" in uncovered(WORDED + ["a-capability-admitted-tomorrow"], USED)
    assert "obj:table" not in uncovered(WORDED, USED)                # CONTROL: one that has a case is not listed
    assert uncovered(WORDED, {}) == sorted(WORDED)                    # with no cases at all, every wording is uncovered


def test_what_the_recorded_scripts_use_without_a_wording_is_named():
    unworded = sorted(c for c in USED if c not in pine_authoring.CAPABILITY_WORDS)
    assert unworded == DATA["capabilities_used_without_words"], (
        "the recorded scripts' use of capabilities with no wording changed. Either the assistant now writes with something it was "
        f"never told it may use, or a wording arrived: update capabilities_used_without_words to {unworded} after reading why.")


def test_the_detector_answers_ids_and_every_script_case_uses_the_core():
    assert all(isinstance(c, str) and c for c in USED)
    assert sorted(USED.get("core", [])) == sorted(c["id"] for c in SCRIPT)
    assert len(USED) >= 10


def test_a_case_that_reads_what_the_assistant_is_not_offered_is_one_whose_words_ask_for_it():
    """`request-other` is not offered to the assistant (it is admitted for finished bars only). A recorded script may
    still read another symbol or timeframe when the MEMBER'S WORDS ask for one, and only then: the rule the door
    applies to every script it returns (`pine_authoring.other_read_asked`), held here on the record."""
    used_not_offered = {cap: ids for cap, ids in USED.items() if pine_authoring.not_offered(cap)}
    assert sorted(used_not_offered) == DATA["capabilities_used_without_words"]
    assert set(used_not_offered) <= {"request-other"}, sorted(used_not_offered)       # nothing else not offered is ever written
    checked = 0
    for ids in used_not_offered.values():
        for cid in ids:
            case = next(c for c in SCRIPT if c["id"] == cid)
            verdict, unasked = pine_authoring.other_read_asked(case["words"], case["answer"]["script"]["pine"], {"sym": "NVDA", "tf": "D"})
            assert verdict == pine_authoring.OTHER_READ_ASKED, (cid, verdict, unasked, case["words"])
            checked += 1
    assert checked >= 3
    # CONTROL: the same scripts under words that ask for nothing of the kind are NOT passed
    some = next(c for c in SCRIPT if c["id"] in used_not_offered["request-other"])
    assert pine_authoring.other_read_asked("Plot a line", some["answer"]["script"]["pine"], {"sym": "NVDA", "tf": "D"})[0] != pine_authoring.OTHER_READ_ASKED
