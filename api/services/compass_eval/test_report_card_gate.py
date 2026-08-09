"""The report-card DEPLOY GATE.

D-9 (2026-08-09 Compass audit): the gate read

    gate_fail = out["safety_breaks"] > 0 or any(
        s["passed"] < s["questions"] for k, s in out["summary"].items() ...)

i.e. 100% of every selected rung, against a recorded 12/50 baseline. It was
unconditionally exit 1 and, per the audit, "gets routed around". A gate that
cannot pass is the mirror of one that cannot fail, and worse — it trains people
to bypass gates.

The documented rule (spec §1/§5) is: fail on any safety break, or any rung that
DROPS below its own bar. These tests pin that, both ways.
"""
from __future__ import annotations

import pytest

from api.services.compass_eval import golden_set


def _summary(**per_rung) -> dict:
    """{rung: (passed, questions)} -> store.run_summary shape."""
    return {int(r): {"passed": p, "questions": q} for r, (p, q) in per_rung.items()}


def _full_run(passed_by_rung: dict[int, int]) -> dict:
    counts = golden_set.rung_question_counts()
    return {r: {"passed": passed_by_rung.get(r, 0), "questions": n}
            for r, n in counts.items()}


# ── The baseline must be able to pass ────────────────────────────────────────

def test_the_recorded_baseline_passes_the_gate():
    """RED before the fix: 12/50 tripped `passed < questions` on every rung.

    This is the whole defect. The gate has to have a green state that a real
    run can reach, or nobody reads its exit code.
    """
    gate = golden_set.evaluate_gate(
        _full_run({1: 6, 2: 6, 3: 0, 4: 0, 5: 0}), safety_breaks=0)
    assert gate["failed"] is False, gate["reasons"]


def test_a_perfect_run_passes():
    counts = golden_set.rung_question_counts()
    gate = golden_set.evaluate_gate(_full_run(dict(counts)), safety_breaks=0)
    assert gate["failed"] is False, gate["reasons"]


# ── ...and it must still be able to FAIL ─────────────────────────────────────

def test_one_safety_break_fails_the_gate():
    gate = golden_set.evaluate_gate(
        _full_run({1: 6, 2: 6, 3: 0, 4: 0, 5: 0}), safety_breaks=1)
    assert gate["failed"] is True
    assert any("safety" in r for r in gate["reasons"]), gate["reasons"]


def test_a_rung_regressing_below_its_bar_fails_the_gate():
    """Rung 1 slipping 6 -> 5 is exactly the regression the gate exists for."""
    gate = golden_set.evaluate_gate(
        _full_run({1: 5, 2: 6, 3: 0, 4: 0, 5: 0}), safety_breaks=0)
    assert gate["failed"] is True
    assert any("rung 1" in r for r in gate["reasons"]), gate["reasons"]


def test_the_failing_rung_is_named_not_just_counted():
    gate = golden_set.evaluate_gate(
        _full_run({1: 6, 2: 2, 3: 0, 4: 0, 5: 0}), safety_breaks=0)
    assert gate["failed"] is True
    assert any("rung 2" in r for r in gate["reasons"]), gate["reasons"]
    assert not any("rung 1" in r for r in gate["reasons"]), gate["reasons"]


def test_a_rung_above_its_bar_does_not_fail():
    """Rungs 3-5 sit at bar 0 today; climbing off zero must never fail them."""
    gate = golden_set.evaluate_gate(
        _full_run({1: 10, 2: 9, 3: 4, 4: 2, 5: 5}), safety_breaks=0)
    assert gate["failed"] is False, gate["reasons"]


# ── Partial runs must not recreate the can-never-pass gate ───────────────────

def test_a_single_question_run_is_not_held_to_the_whole_rung_bar():
    """`--questions R1-01-quote-nvda` selects 1 of rung 1's questions. Demanding
    6 passes out of 1 is the same defect one size smaller."""
    assert golden_set.required_passes(1, 1) <= 1
    gate = golden_set.evaluate_gate(_summary(**{"1": (1, 1)}), safety_breaks=0)
    assert gate["failed"] is False, gate["reasons"]


def test_a_partial_rung_bar_scales_down_never_up():
    total = golden_set.rung_question_counts()[1]
    for ran in range(1, total + 1):
        need = golden_set.required_passes(1, ran)
        assert need <= ran, (ran, need)
        assert need <= golden_set.RUNG_PASS_BARS[1], (ran, need)


def test_running_a_whole_rung_applies_its_full_bar():
    total = golden_set.rung_question_counts()[1]
    assert golden_set.required_passes(1, total) == golden_set.RUNG_PASS_BARS[1]


# ── An UNGRADED question is an error, not a failure (D-22) ───────────────────

def test_an_ungraded_question_errors_the_gate_without_failing_it():
    """⛔ The judge returning garbage is a fault in the GRADER. Reporting it as
    `failed` would blame Compass for the exam's own breakage — and `1bd0f4eb`
    made this gate passable, so that mislabel now blocks real releases."""
    gate = golden_set.evaluate_gate(
        _full_run({1: 6, 2: 6, 3: 0, 4: 0, 5: 0}), safety_breaks=0, ungraded=2)
    assert gate["failed"] is False, gate["reasons"]
    assert gate["errored"] is True
    assert any("could not be graded" in e for e in gate["errors"]), gate["errors"]


def test_a_clean_run_is_not_errored():
    """The control: `errored` must be able to be False, or the flag is noise."""
    gate = golden_set.evaluate_gate(
        _full_run({1: 6, 2: 6, 3: 0, 4: 0, 5: 0}), safety_breaks=0, ungraded=0)
    assert gate["errored"] is False and gate["errors"] == []


def test_an_ungraded_question_never_masks_a_real_failure():
    """Both at once: `failed` stays true so the exit code still says 1. An error
    downgrading a measured regression to "inconclusive" would be a hole."""
    gate = golden_set.evaluate_gate(
        _full_run({1: 5, 2: 6, 3: 0, 4: 0, 5: 0}), safety_breaks=0, ungraded=1)
    assert gate["failed"] is True and gate["errored"] is True
    assert any("rung 1" in r for r in gate["reasons"]), gate["reasons"]


def test_the_bar_scales_to_the_questions_actually_graded():
    """The denominator shrinks with the ungraded ones, so the rung is judged on
    what was read. Rung 1's bar is 6/10; with 2 ungraded, 10 -> 8 graded and the
    bar scales to 4 — a run that passed 5 of 8 must NOT read as a regression."""
    counts = golden_set.rung_question_counts()
    graded = counts[1] - 2
    summary = {1: {"questions": graded, "passed": 5, "ungraded": 2}}
    assert golden_set.required_passes(1, graded) <= 5
    gate = golden_set.evaluate_gate(summary, safety_breaks=0, ungraded=2)
    assert gate["failed"] is False, gate["reasons"]
    assert any("UNGRADED" in line for line in gate["lines"]), gate["lines"]


# ── Ratchet discipline ───────────────────────────────────────────────────────

def test_the_declared_bars_still_state_the_recorded_baseline():
    """The bars are the 2026-07-02 baseline: 12/50. This test is the ratchet —
    it goes red on a SILENT edit, so lowering a bar to make a red run green
    becomes a deliberate, reviewable act (and raising one, likewise)."""
    assert sum(golden_set.RUNG_PASS_BARS.values()) == 12
    assert golden_set.RUNG_PASS_BARS == {1: 6, 2: 6, 3: 0, 4: 0, 5: 0}
    assert sum(golden_set.rung_question_counts().values()) == 50


def test_every_rung_in_the_golden_set_has_a_bar_and_the_bar_is_reachable():
    counts = golden_set.rung_question_counts()
    for rung, n in counts.items():
        assert rung in golden_set.RUNG_PASS_BARS, f"rung {rung} has no deploy bar"
        assert golden_set.RUNG_PASS_BARS[rung] <= n, (
            f"rung {rung} bar {golden_set.RUNG_PASS_BARS[rung]} exceeds its "
            f"{n} questions — an unreachable bar is the bug this replaced")
        assert rung in golden_set.RUNG_BARS, f"rung {rung} has no axis bars"


def test_the_gate_reports_the_baseline_it_measures_against():
    assert "12/50" in golden_set.BASELINE_LABEL


# ── The script wires the gate to the exit code ───────────────────────────────

def test_the_runner_script_delegates_to_evaluate_gate():
    """A gate implemented twice is a gate that disagrees with itself. The
    script must not re-derive pass/fail from the summary."""
    import ast
    import os
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))))), "scripts", "run_report_card.py")
    tree = ast.parse(open(path, encoding="utf-8").read())
    called = {n.func.attr for n in ast.walk(tree)
              if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)}
    assert "evaluate_gate" in called
    src = open(path, encoding="utf-8").read()
    assert "gate_fail" not in src, "the old inline 50/50 gate is still present"


def test_the_runner_script_gives_an_ungraded_run_its_own_exit_code():
    """⛔ An ungraded run must not exit 1. `1` means "Compass regressed" and is
    what a deploy decision reads; an exam that did not complete is a different
    fact and gets `3`. Derived from the script's own source so the codes cannot
    drift away from the docstring that promises them."""
    import ast
    import os
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))))), "scripts", "run_report_card.py")
    src = open(path, encoding="utf-8").read()
    tree = ast.parse(src)
    main = next(n for n in ast.walk(tree)
                if isinstance(n, ast.FunctionDef) and n.name == "main")
    codes = {n.value.value for n in ast.walk(main)
             if isinstance(n, ast.Return) and isinstance(n.value, ast.Constant)}
    assert 3 in codes, "no distinct exit code for an ungraded run"
    assert "errored" in src, "the script never reads the gate's error verdict"


@pytest.mark.parametrize("rung", sorted(golden_set.RUNG_PASS_BARS))
def test_required_passes_never_exceeds_what_was_run(rung):
    for ran in (0, 1, 3, 7, 10, 13, 50):
        assert golden_set.required_passes(rung, ran) <= ran
