"""REFERENCE SCRIPTS: a way of writing no door answer uses, held by value another way.

Ten capabilities are worded for the script assistant ("you may use `switch`, `while`, your own types ...") and no
recorded DOOR ANSWER uses them (`capabilities_without_a_case`). ⚰️ MEASURED 2026-11-23 over the 130 distinct scripts
the assistant has written on record: five of the ten were never used once, and since 2026-11-21 only `while` (2 of
77) and `realtime-state` (1 of 77) were; the same request gets `while` in one sample and `for` in the next. They are
ways of WRITING, not things a member asks for, so no plain-words request can be made to need them.

So each is held another way. A script WRITTEN BY HAND answers an EXISTING case's request with the capability, and is
graded by that case's own rule through the same lane (the member pane's own path), with the same controls.
  * What that proves: the ENGINE runs a script written that way right, on every bar.
  * What it does NOT prove: that the assistant writes it. `capabilities_without_a_case` keeps its meaning and does
    not shrink; `capabilities_held_by_a_reference_script` is the second line.
Eight were right. Two capabilities were held by nothing, each for a named reason:
  * `obj:getter`, recorded WRONG, an ENGINE DEFECT: a label whose text is arithmetic on a value read back from a
    drawing is not drawn, and nothing is reported (silent). It goes right when the engine does. ⭐⭐ IT DID: e96 #2610
    computes getter arithmetic in a drawing's text, so the script is graded RIGHT now, its record kept (recorded
    WRONG, its defect) and marked `engine_fixed` {by, since_engine: 96}, the value cases' own field, never claimed
    ahead of the engine that earns it. Nine are right; `obj:getter` is held;
  * `conditional-ta`, a CORRECT NAMED REFUSAL kept as a specimen: the assistant is told it may write a ta call
    inside an `if`; the engine refuses that script by name, rightly, when the block does not run on every bar. The
    fault is the wording. A script written to a wording the gate admits will hold it.

This file needs node and `app/node_modules`. Where they are missing it SKIPS, and the lanes that run it treat a
skip as a failure. No model is called.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services import pine_capabilities
from tests.test_value_cases_scripts import _every_window_one_longer, _lane
from tools.value_cases import edges as E
from tools.value_cases import script_grade
from tools.value_cases import script_rules as R
from tools.value_cases.market import STOCK

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "tests" / "fixtures" / "authoring" / "value_cases.json").read_text(encoding="utf-8"))
REFS = DATA["reference_scripts"]
BY_ID = {r["id"]: r for r in REFS}
CASES = {c["id"]: c for c in (DATA.get("pending") or []) + DATA["cases"]}
WITHOUT = list(DATA["capabilities_without_a_case"])
HELD = list(DATA["capabilities_held_by_a_reference_script"])
RECORDED_WRONG = {"ref-obj-getter"}             # recorded WRONG: an engine defect, named
ENGINE_FIXED = {"ref-obj-getter"}               # ... which the engine has since fixed (e96 #2610): graded RIGHT now
WRONG = RECORDED_WRONG - ENGINE_FIXED            # wrong today: none
REFUSED = {"ref-conditional-ta"}                # refused by the engine BY NAME, rightly: a specimen
RIGHT = [r for r in REFS if r["id"] not in WRONG | REFUSED]
#: a window under 5 bars, by the case whose rule holds the script (see `SHORT_WINDOWS` in the script tests)
SHORT = {"cap-03": 3, "cap-04": 3}
#: a neighbour's rule, for the control: the same kind of thing (a plotted column, or a drawing), asked differently
NEIGHBOUR = {"cap-01": "cap-09", "cap-02": "cap-09", "cap-03": "cap-02", "cap-09": "cap-02", "cap-04": "cap-05", "cap-06": "cap-05",
             "cap-05": "cap-06"}                 # (e96: the getter script is right now, so it has a neighbour too)


def claimable(since):
    """An `engine_fixed` claim is never AHEAD of the engine that earns it: `since` is not above the engine the lane runs
    (`user_definitions.read_script_engine_version`), or, while the fixing train is not numbered yet, it is that train's
    own number, named in a pending line of the version file. (The tag is built in two pieces: a train's retag rewrites
    the literal wherever it is written, and this reader must survive the numbering it waits for.)"""
    import re
    from api.services import user_definitions as ud
    engine = ud.read_script_engine_version()
    text = (ROOT / "app" / "src" / "components" / "chart" / "engine" / "scriptEngineVersion.js").read_text(encoding="utf-8")
    tag = "NUMBER" + " PENDING"
    pending = {int(n) for n in re.findall(re.escape(tag) + r" = \([^)]*\btrain e(\d+)\b", text)}
    return since <= engine or (since in pending and since > engine)


def pine(ref):
    return ref["answer"]["script"]["pine"]


@pytest.fixture(scope="module")
def graded():
    return _lane(script_grade.grade_all, REFS)


# ── the section ──

def test_the_section_is_whole():
    assert len(REFS) == len(BY_ID) == 9 and all(rid.startswith("ref-") for rid in BY_ID)
    assert not set(BY_ID) & set(CASES)                                  # a reference script is not a case
    for ref in REFS:
        rid, held_by = ref["id"], CASES[ref["holds"]]
        assert ref["lane"] == "script" and ref["chart"] == "daily" and R.has_rule(ref["holds"]), rid
        assert ref["words"] == held_by["words"], rid                    # it answers THAT request, word for word
        assert ref["written"] == {"on": "2026-11-23", "by": "hand"} and "recorded" not in ref, rid   # never a door answer
        assert ref["answer"]["turn"] == "script" and pine(ref).startswith("//@version=5"), rid
        assert ref["capabilities"] and set(ref["capabilities"]) <= set(WITHOUT), rid
        # the same edge as the case it answers, or none; a formula case's ties in the script lane's own form (2026-11-25)
        assert ref.get("edge") == E.script_form(held_by.get("edge")), rid
        assert ("defect" in ref) == (ref.get("recorded_verdict") == "wrong") and len(ref.get("defect") or "x" * 99) > 80, rid
        assert ("refused" in ref) == (ref["id"] in REFUSED), rid
    assert {r["id"] for r in REFS if r.get("recorded_verdict") == "wrong"} == RECORDED_WRONG
    # ⭐ e96: the engine fix is marked by hand, on a recorded-wrong script only, its record kept beside it
    assert {r["id"] for r in REFS if "engine_fixed" in r} == ENGINE_FIXED <= RECORDED_WRONG
    for rid in ENGINE_FIXED:
        ef = BY_ID[rid]["engine_fixed"]
        assert set(ef) == {"by", "since_engine"} and "#2610" in ef["by"] and ef["since_engine"] == 96, ef
        assert claimable(ef["since_engine"]), (rid, ef, "claimed ahead of the engine that earns it")
    refused = BY_ID["ref-conditional-ta"]["refused"]
    assert refused["guard"] == "pine:block" and "CORRECT NAMED REFUSAL" in refused["why"] and "WORDING" in refused["why"]


def test_each_script_really_uses_what_it_was_written_for():
    for ref in REFS:
        used = set(pine_capabilities.capabilities_of(pine(ref)))
        assert set(ref["capabilities"]) <= used, (ref["id"], sorted(used))
    # CONTROL: the detector can say no. The `while` script uses no `switch`.
    assert "switch" not in pine_capabilities.capabilities_of(pine(BY_ID["ref-while"]))


def test_the_two_lines_say_two_different_things():
    """`capabilities_without_a_case`: what no DOOR ANSWER uses. A reference script never takes a capability off it."""
    written_for = {c for ref in RIGHT for c in ref["capabilities"]}
    assert HELD == [c for c in WITHOUT if c in written_for]
    assert HELD == ["for-in", "generics", "max_bars_back", "method-call", "obj:getter", "realtime-state", "switch", "udt",
                    "while"]                                            # (e96: `obj:getter` is held, #2610)
    assert set(WITHOUT) - set(HELD) == {"conditional-ta"}                    # held by nothing right: a named refusal
    assert len(WITHOUT) == 10
    # only the capability a script was WRITTEN FOR counts. The detector also finds `conditional-ta` in the `switch`
    # script (a ta call in a switch arm): that is not the capability as it is worded ("inside an `if` block").
    assert "conditional-ta" in pine_capabilities.capabilities_of(pine(BY_ID["ref-switch"])) and "conditional-ta" not in HELD
    # and no recorded door answer uses any of the ten: the first line is still true
    for case in DATA["cases"]:
        if case["lane"] == "script":
            assert not set(pine_capabilities.capabilities_of(case["answer"]["script"]["pine"])) & set(WITHOUT), case["id"]


# ── by value, through the lane ──

def test_every_reference_script_is_what_the_section_says(graded):
    for ref in REFS:
        want = "right" if ref in RIGHT else "wrong"                     # (a refused script is not right either)
        assert graded[ref["id"]]["verdict"] == want, (ref["id"], graded[ref["id"]]["lines"])


def test_the_one_wrong_one_is_refused_for_its_reason_and_the_getter_is_right_since_e96(graded):
    """⭐ e96 #2610: the label whose text is arithmetic on a read-back value is DRAWN, with the right number. The proof
    the studio designed: `obj:getter` goes RIGHT when e96's engine fix lands (a mutant reverting the piece of #2610 the
    script rests on, the write of its local `rise` from getter arithmetic (`scalarNumber`), turns it back to WRONG and
    this rail red: ci/mutants/e96-train-integration.json TJ10)."""
    getter = "\n".join(str(line) for line in graded["ref-obj-getter"]["lines"])
    assert "RIGHT  a line from the lowest low of the last 60 bars to the newest close" in getter      # the line is drawn right
    assert "RIGHT  a label at the end of the line" in getter and "all labels []" not in getter       # and now the label is
    assert graded["ref-obj-getter"]["verdict"] == "right"
    # its record is kept beside the fix: what was wrong, and why
    assert "ARITHMETIC on a value read back from a drawing" in BY_ID["ref-obj-getter"]["defect"]
    refused = "\n".join(str(line) for line in graded["ref-conditional-ta"]["lines"])
    assert BY_ID["ref-conditional-ta"]["refused"]["guard"] in refused and "plotted no column to compare" in refused   # by name


def test_CONTROL_a_neighbouring_requests_rule_fails_each_right_script():
    others = [{**{k: v for k, v in ref.items() if k != "edge"}, "holds": NEIGHBOUR[ref["holds"]]} for ref in RIGHT]
    got = _lane(script_grade.grade_all, others)
    assert sorted(rid for rid, g in got.items() if g["verdict"] == "right") == []


def test_CONTROL_a_reference_script_with_every_window_one_bar_longer_is_caught():
    answers, tried = {}, []
    for ref in RIGHT:
        source, hit = _every_window_one_longer(pine(ref), SHORT.get(ref["holds"]))
        assert hit, ref["id"]
        answers[ref["id"]] = {"turn": "script", "script": {"pine": source}}
        tried.append(ref)
    got = _lane(script_grade.grade_all, tried, answers)
    assert sorted(r["id"] for r in tried if got[r["id"]]["verdict"] == "right") == []


# ── the grader ──

def test_a_script_that_plots_no_column_is_graded_wrong_in_words_never_an_exception():
    """⚰️ 2026-11-23: the engine refused the one plot of a script by name, the run came back with no column, and the
    grader crashed with "list index out of range"."""
    run = {"ok": True, "columns": {}, "drawn": {"tables": [], "labels": [], "lines": [], "boxes": [], "via": None},
           "errors": {"value": {"guard": "pine:block", "message": "`avgUp` calls `ta.sma` inside a block that does not run on every bar"}}}
    got = R.grade_script("cap-09", "plot(x)", run, {"bars": STOCK})
    assert got["verdict"] == "wrong"
    said = "\n".join(str(line) for line in got["lines"])
    assert "pine:block" in said and "plotted no column to compare" in said
    # CONTROL: a column that IS the rule still passes through the same function
    right = R.grade_script("cap-09", "plot(x)", {**run, "errors": None, "columns": {"value": R.RULES["cap-09"]()[0][1]}}, {"bars": STOCK})
    assert right["verdict"] == "right"
