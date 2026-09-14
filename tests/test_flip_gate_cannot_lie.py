"""The flip gate must be UNABLE TO LIE — and a regression must cost an ordinary pytest run.

⚰️ WHY THIS FILE EXISTS. On 2026-09-14 the flip gate's most important row was found to be
incapable of failing:

    check_s2_measured:  MET if list(glob("*real*.json")) else NOT_MEASURABLE

It counted FILES and never opened one. The first `--real` load runs in the programme's history all
printed `TOTALS load_harness FAIL` — S2 p50 14,855 ms against a 2,500 ms target, success 35.7% —
and the row flipped from NOT MEASURABLE to **MET**, because five files now existed. Producing
FAILING evidence made the gate GREENER. Two sibling rows had the identical shape.

⛔⛔ THE MUTATION SET IS THE PRODUCT HERE, NOT A SIDE-CAR. `mutation_harness_flipgate.py` proves
every row in three states — MET on planted passing evidence, NOT MET on planted failing evidence,
NOT MEASURABLE with the evidence gone — and this file runs that set IN-PROCESS so it is caught by
`pytest tests/test_flip_gate_cannot_lie.py` and not only by somebody remembering to run a harness.

⛔ IN-PROCESS, NOT A SUBPROCESS. A `subprocess` wrapper reports the WRAPPER's exit code, which has
hidden a real red on this project before. Calling the functions means a failure is a pytest failure
with the offending row's own sentence in the assertion message.

⛔ AND NOTHING IS PLANTED INTO THE REPOSITORY. Every case builds a complete evidence tree inside
`tempfile.mkdtemp()` and deletes it. The gate takes an injectable `Evidence` for exactly this
reason: an instrument that has to corrupt the real evidence directory to test itself never gets
tested.
"""
from __future__ import annotations

import pathlib
import sys

import pytest

INSTRUMENTS = (pathlib.Path(__file__).resolve().parents[1]
               / "docs" / "discord-render" / "instruments")
sys.path.insert(0, str(INSTRUMENTS))

import flip_preconditions as fp            # noqa: E402
import mutation_harness_flipgate as mh     # noqa: E402


# ── the mutation set, one pytest case per control ───────────────────────────

def _ids(cases):
    return [f"{c.key}::{c.kind}" for c in cases]


CASES = mh._cases()


@pytest.mark.parametrize("case", CASES, ids=_ids(CASES))
def test_every_row_reads_a_verdict_and_can_go_three_ways(case, tmp_path):
    """MET on planted PASS · NOT MET on planted FAIL · NOT MEASURABLE with the evidence gone."""
    result = mh.run_case(case, tmp_path)
    assert result.ok, (
        f"row {case.key!r} under {case.kind!r} ({case.why}) wanted {case.expect} "
        f"but printed {result.got}. {result.note}\n"
        f"    the row said: {result.detail}")


def test_the_mutation_set_covers_every_row_in_three_states():
    """⛔ NON-VACUITY OF THE HARNESS. A row added to CHECKS without controls is named here, so a
    silent row is structurally impossible rather than merely discouraged."""
    gaps = mh.coverage_gaps(CASES)
    assert not gaps, "rows without a full three-state mutation control:\n  " + "\n  ".join(gaps)
    assert len(fp.ROW_KEYS) >= 11, "the precondition table lost rows"
    assert len(CASES) >= 3 * len(fp.ROW_KEYS), "fewer cases than rows × 3 — something was dropped"


# ── the structural properties that make the above possible ──────────────────

def test_no_row_infers_a_verdict_from_file_existence(tmp_path):
    """⛔⛔ THE WHOLE POINT. Against a tree where every artifact EXISTS but says nothing useful,
    not one row may print MET. This is the 2026-09-14 defect stated as an assertion: a row that
    reads `exists()` passes this only by accident, and `run_all` then catches it row by row."""
    root, soak = tmp_path / "repo", tmp_path / "soak"
    ev = mh.plant_passing_tree(root, soak)
    # Blank every artifact in place — present, readable, and carrying no verdict at all.
    for path in (ev.forensics_test, ev.forensics_doc, ev.bindings, ev.shadow_rail,
                 ev.soak_log, ev.alerts_log, ev.canary_scope, ev.flip_packet):
        path.write_bytes(b"\n")
    for path in list(ev.step3.glob("*.json")) + list(
            ev.evidence_dir.glob("smoke*/INDEX.md")) + list(
            ev.instruments.glob("mutation_harness*.py")):
        path.write_bytes(b"\n")
    _code, rows = fp.evaluate(run_mutations=True, ev=ev)
    green = [r["precondition"] for r in rows if r["state"] == fp.MET]
    assert not green, ("these rows printed MET over empty artifacts, which is the defect this "
                       f"file exists to prevent: {green}")


def test_every_check_accepts_an_injectable_evidence_root():
    """A gate nobody can point at a sandbox is a gate nobody mutation-proves."""
    import inspect
    for key, name, fn in fp.CHECKS:
        params = list(inspect.signature(fn).parameters)
        assert params[:1] == ["ev"], f"{key} ({name}) cannot be pointed at a sandbox: {params}"


def test_the_verdict_ranking_cannot_be_satisfied_by_an_unmeasurable_row():
    assert fp._verdict([fp.MET, fp.NOT_MEASURABLE, fp.NOT_MET]) == fp.SOME_NOT_MET
    assert fp._verdict([fp.MET, fp.NOT_MEASURABLE]) == fp.SOME_UNMEASURABLE
    assert fp._verdict([fp.MET, fp.MET]) == fp.ALL_MET


def test_self_check_still_runs_and_passes(capsys):
    """`--self-check` is what a human runs; it must exercise the mutation set, not just arithmetic."""
    rc = fp.self_check()
    out = capsys.readouterr().out
    assert "TOTALS flip_preconditions --self-check" in out, "no TOTALS line is not a run"
    assert "TOTALS mutation_harness_flipgate" in out, "--self-check no longer runs the mutation set"
    assert rc == 0, out


def test_the_real_tree_still_evaluates_without_raising():
    """⛔ A gate that dies on the real tree prints nothing, and nothing reads as nobody looked.
    This asserts NOTHING about the verdict — the verdict is the world's business, not a test's."""
    code, rows = fp.evaluate()
    assert code in (fp.ALL_MET, fp.SOME_NOT_MET, fp.SOME_UNMEASURABLE)
    assert len(rows) == len(fp.CHECKS)
    assert all(r["evidence"] for r in rows), "a row with no evidence sentence explains nothing"
