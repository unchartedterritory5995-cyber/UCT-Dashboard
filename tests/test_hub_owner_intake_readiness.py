"""The owner's trace is single-shot. These are the rails that stop the intake burning it.

⛔ RUN SCOPED — this file only:
    python -m pytest tests/test_hub_owner_intake_readiness.py -q

Every test here pairs a case with a CONTROL proving the check could have returned the other
answer. A readiness suite that passes everything reports a property of itself.
"""
from __future__ import annotations

import json
import pathlib
import re
import subprocess
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
TOOLS = REPO / "tools"
FIX = REPO / "tests" / "fixtures" / "hub_owner_intake"
OWNER_RUN = REPO / "docs" / "plans" / "joystick" / "owner-run.md"

sys.path.insert(0, str(TOOLS))
import hub_owner_intake as hoi  # noqa: E402


def _run(*args) -> tuple[int, str]:
    """Invoke the tool as an operator would. ⛔ Never through a pipe whose exit code would mask
    the tool's own — the wrapper-exit trap, sighted twice in this programme."""
    p = subprocess.run(
        [sys.executable, str(TOOLS / "hub_owner_intake.py"), *[str(a) for a in args]],
        capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=str(REPO),
    )
    return p.returncode, (p.stdout or "") + (p.stderr or "")


# ── the sheet the tool will actually be handed ──────────────────────────────────────────────────
def test_every_step_row_in_the_real_sheet_is_readable_by_the_tool():
    """If ROW_RE cannot see a row, that row is invisible to box 2 — silently."""
    txt = OWNER_RUN.read_text(encoding="utf-8")
    ids = [m.group("id") for m in hoi.ROW_RE.finditer(txt)]
    assert ids, "the parser found no rows at all in owner-run.md"
    # sections A-E must all be represented; a missing section = a silently unscored block
    for prefix in ("A", "B", "C", "Ci", "D", "E"):
        assert any(i.startswith(prefix) for i in ids), f"no {prefix}-rows parsed from the sheet"
    # ⚠️ D1 was renamed D1-eye on 2026-09-14 to break a four-way label collision.
    assert "A1" in ids and "D1-eye" in ids


def test_the_real_sheet_has_no_step_row_the_parser_misses():
    """CONTROL for the test above: it is only meaningful if a miss would be visible."""
    txt = OWNER_RUN.read_text(encoding="utf-8")
    seen = {m.group("id") for m in hoi.ROW_RE.finditer(txt)}
    candidates = {
        r.strip() for r in re.findall(r"^\|\s*([A-E]i?\d+[a-z]?)\s*\|", txt, re.M)
    }
    assert candidates - seen == set(), f"rows present but unparsed: {sorted(candidates - seen)}"


# ── D1 speaks its own vocabulary ────────────────────────────────────────────────────────────────
D1 = "| D1 | G3-16(a) | look | tell them apart | {} |"


@pytest.mark.parametrize("cell,expected", [
    ("☑ DISTINGUISHABLE ☐ CONFUSABLE", "PASS"),
    ("☐ DISTINGUISHABLE ☑ CONFUSABLE", "FAIL"),
    ("☐ DISTINGUISHABLE ☐ CONFUSABLE", "UNMARKED"),
    ("☑ DISTINGUISHABLE ☑ CONFUSABLE", "AMBIGUOUS"),
])
def test_d1_vocabulary_is_read_in_all_four_states(cell, expected):
    """⚰️ D1's cell is DISTINGUISHABLE/CONFUSABLE, not PASS/FAIL. Before 2026-09-14 a correctly
    marked D1 read UNMARKED and box 2 came back NOT TICKABLE naming a row the owner had answered."""
    assert hoi.read_marks(D1.format(cell)).get("D1") == expected


def test_the_tick_still_binds_to_the_word_that_follows_it():
    """CONTROL for the D1 fix: widening the vocabulary must not loosen the ordering rule that
    stopped `☐ PASS ☑ FAIL` reading as a PASS."""
    assert hoi.read_marks("| B1 | x | y | z | ☐ PASS ☑ FAIL |").get("B1") == "FAIL"
    assert hoi.read_marks("| B1 | x | y | z | ☑ PASS ☐ FAIL |").get("B1") == "PASS"


# ── an unmarked row is never a pass ─────────────────────────────────────────────────────────────
def test_an_unmarked_row_blocks_and_is_named():
    marks = hoi.read_marks("| B1 | x | y | z | ☑ PASS ☐ FAIL |\n| B2 | x | y | z |  |")
    b2 = hoi.box_two(marks)
    assert b2["tickable"] is False
    assert "B2" in b2["unmarked"]


def test_a_fully_marked_sheet_is_tickable():
    """CONTROL: box_two must be able to return True, or the test above passes vacuously."""
    marks = hoi.read_marks("| B1 | x | y | z | ☑ PASS ☐ FAIL |\n| B2 | x | y | z | ☑ PASS ☐ FAIL |")
    assert hoi.box_two(marks)["tickable"] is True


# ── the control block is load-bearing ───────────────────────────────────────────────────────────
def test_a_missing_control_block_withholds_both_boxes():
    """⛔ Until 2026-09-14 this printed a warning and returned 0 — the freeze would have lifted on
    a trace that never showed the instrument could tell a press from a flick."""
    rc, out = _run(FIX / "trace-no-control-block.json", FIX / "marks-real-all-pass.md")
    assert rc == 1, out
    assert "declared controls : 0" in out
    assert "NOT YET" in out


def test_a_complete_run_still_lifts_the_freeze():
    """CONTROL for the test above — otherwise the tool could be blocking everything."""
    rc, out = _run(FIX / "trace-nominal.json", FIX / "marks-real-all-pass.md")
    assert rc == 0, out
    assert "freeze is lifted" in out


# ── unusable input is exit 2, and is a different fact from a failure ────────────────────────────
@pytest.mark.parametrize("fixture,needle", [
    ("trace-dropped-rows.json", "OVERFLOWED"),
    ("trace-clipboard-cut.json", "could not read the trace"),
    ("trace-wrong-envelope.json", "not a joystick G0 trace"),
])
def test_unusable_input_exits_2_and_says_why(fixture, needle):
    rc, out = _run(FIX / fixture, FIX / "marks-real-all-pass.md")
    assert rc == 2, out
    assert needle in out


def test_exit_2_is_reserved_for_unusable_input_not_for_failure():
    """CONTROL: a real product FAILURE must be 1, not 2 — collapsing them loses the distinction
    between 'we could not measure it' and 'it is broken'."""
    rc, out = _run(FIX / "trace-a1-fires.json", FIX / "marks-real-all-pass.md")
    assert rc == 1, out
    assert "D4 FAILS" in out


# ── A1: silence is the correct answer ───────────────────────────────────────────────────────────
def test_a_silent_a1_scores_as_the_guard_holding_not_as_missing_data():
    """journal.close is the registry's only flickable:false action. Nothing firing is a PASS."""
    payload = json.loads((FIX / "trace-nominal.json").read_text(encoding="utf-8"))
    exp = hoi.hta.expectations(hoi.SECTION_A_EXPECT)
    res = hoi.hta.analyse(payload, exp, hoi.SECTION_A_CONTROL)
    b1 = hoi.box_one(res, {})
    assert b1["a1Total"] > 0, "no A1 gestures seen — the fixture, not the product"
    assert b1["a1Fired"] == 0
    assert b1["d4Holds"] is True


def test_a_firing_a1_is_a_failure():
    """CONTROL: d4Holds must be able to be False."""
    payload = json.loads((FIX / "trace-a1-fires.json").read_text(encoding="utf-8"))
    exp = hoi.hta.expectations(hoi.SECTION_A_EXPECT)
    res = hoi.hta.analyse(payload, exp, hoi.SECTION_A_CONTROL)
    assert hoi.box_one(res, {})["d4Holds"] is False


# ── the tool's own self-check must still pass ───────────────────────────────────────────────────
def test_the_tools_own_self_check_passes():
    rc, out = _run("--self-check")
    assert rc == 0, out
    assert "SELF-CHECK PASS" in out

# ── the D1 collision is resolved by suffix, and box 2 still counts the right set ────────────────
def test_the_renamed_eye_row_parses_and_the_bare_label_is_gone():
    """⚰️ "D1" named FOUR different checks across this programme's docs — and owner-run.md's own
    summary used two of those senses three lines apart. The live pair now carry suffixes:
    owner-run.md's eye row is D1-eye; glass-acceptance-steps.md's no-drag door is D1-a11y."""
    marks = hoi.read_marks(OWNER_RUN.read_text(encoding="utf-8"))
    assert "D1-eye" in marks, "the renamed row is invisible to the parser"
    assert "D1" not in marks, "a bare D1 survives in owner-run.md — the collision is not resolved"


def test_a_suffixed_id_is_not_a_special_case():
    """CONTROL: the suffix branch must be general, not a hard-coded D1-eye."""
    m = hoi.read_marks("| B7-foo | x | y | z | ☑ PASS ☐ FAIL |")
    assert m.get("B7-foo") == "PASS"


def test_box_two_counts_exactly_the_rows_closure_md_depends_on():
    """closure.md box 2 rests on glass-acceptance.md's blocks; operationally box_two() counts every
    B / C / Ci / D / E row of owner-run.md. Pin the SET, not the count — a count can stay 27 while
    membership drifts, which is the defect this whole programme keeps rediscovering."""
    marks = hoi.read_marks(OWNER_RUN.read_text(encoding="utf-8"))
    b2 = hoi.box_two(marks)
    expected = (
        [f"B{i}" for i in range(1, 16)]
        + [f"C{i}" for i in range(1, 5)]
        + [f"Ci{i}" for i in range(1, 4)]
        + ["D1-eye", "D2", "D3"]
        + ["E1", "E2"]
    )
    seen = sorted(k for k in marks if k[0] in "BCDE")
    assert seen == sorted(expected), f"box-2 row set drifted: {sorted(set(seen) ^ set(expected))}"
    assert b2["rows"] == len(expected) == 27


def test_box_two_still_refuses_an_incomplete_sheet_after_the_rename():
    """CONTROL for the test above — a set-equality check passes just as happily on a tool that has
    stopped refusing anything. Strip one mark and box 2 must go untickable and NAME the row."""
    txt = OWNER_RUN.read_text(encoding="utf-8")
    marked = re.sub(r"☐(\s*\w[\w-]*)", r"☑", txt, count=0)  # tick every first box
    marked = re.sub(r"^\|(\s*D1-eye\s*)\|(.*)☑ DISTINGUISHABLE(.*)$",
                    r"||☐ DISTINGUISHABLE", marked, flags=re.M)
    b2 = hoi.box_two(hoi.read_marks(marked))
    assert b2["tickable"] is False
    assert "D1-eye" in b2["unmarked"], f"the stripped row was not named: {b2}"
