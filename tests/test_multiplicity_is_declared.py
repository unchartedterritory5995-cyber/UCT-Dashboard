"""The family-wise question must stay visible until it is answered.

⛔⛔ THE HOLE. Roughly thirty tests are run — twenty-five structures with a
measured null, several graded in both directions — and each published row's
gate 1 asks only whether ITS OWN interval excludes zero. Asked thirty times,
that question means considerably less than it does once. No family-wise
correction is applied, and the artifact must say so where the numbers are.

⭐ A BOUND EXISTS AND IS RECORDED: the largest null maximum anywhere is
+18.92pp, and a bar at that level is cleared by only two of the seven published
rows. But that bound OVERSTATES the correction, because raw null maxima mix a
detector's own mechanical edge with the family's chances to get lucky, and only
the second is multiplicity.

⛔ WHAT MAKES IT FIXABLE. A correct maxT needs per-trial null VECTORS
standardised by each structure's own null. The artifact stored only each row's
maximum, so the correction was not computable without re-measuring everything.
Rows written from 2026-09-01 carry `null_lifts`. This rail exists so that
retention is not silently dropped again — losing it is cheap to do and expensive
to undo.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

from api.services.screener import lift_ledger as ll

ROOT = pathlib.Path(__file__).resolve().parents[1]


def _rows():
    return (ll.load().get("structures") or {})


def test_the_limitation_is_recorded_where_the_numbers_are():
    """⛔ NOT IN A COMMIT MESSAGE OR A PLAN DOC. A caveat that does not travel
    with the artifact is a caveat nobody reading the artifact will see."""
    lim = ll.load().get("limitations") or ""
    assert "MULTIPLE COMPARISONS" in lim, (
        "the ledger no longer declares that no family-wise correction is "
        "applied — that is the one caveat a reader cannot infer from a row")
    for must in ("+18.92pp", "OVERSTATES"):
        assert must in lim, (
            f"the multiplicity note lost {must!r}: it has to carry BOTH the "
            f"bound and the reason the bound is not the answer")


def test_the_family_is_actually_large_enough_to_matter():
    """⛔ NON-VACUITY. If only two structures were ever measured, this whole
    concern would be theatre. The claim rests on the count."""
    measured = [v for v in _rows().values() if v.get("null_max") is not None]
    assert len(measured) >= 20, (
        f"only {len(measured)} structures carry a measured null — re-derive "
        f"the multiplicity argument before trusting the wording")


def test_the_recorded_bound_still_matches_the_artifact():
    """⭐ THE BOUND IS A MEASUREMENT, so it must be re-derived rather than
    trusted. If a bigger null lands, the note's +18.92pp is stale and the
    two-of-seven claim with it."""
    nulls = [v["null_max"] for v in _rows().values()
             if v.get("null_max") is not None]
    assert nulls
    worst = max(nulls) * 100
    assert abs(worst - 18.92) < 0.01, (
        f"the largest null maximum is now {worst:+.2f}pp, not +18.92pp. The "
        f"limitation note quotes the old figure and the rows it says would "
        f"fall may have changed — re-derive both.")


def test_the_runner_retains_the_null_VECTOR_not_only_its_max():
    """⛔ THE THING THAT MAKES THE CORRECTION POSSIBLE LATER. Thirty floats per
    row is nothing; discarding them made a family-wise correction impossible
    without re-measuring the whole library."""
    src = (ROOT / "tools/run_lift_ledger.py").read_text(encoding="utf-8")
    assert src.count('row["null_lifts"]') == 2, (
        "both write sites must retain the null vector — one keeping it and one "
        "dropping it is how half the ledger becomes uncorrectable")


def test_rows_measured_from_now_on_carry_their_vector():
    """Rows written before 2026-09-01 legitimately lack it; a row that has one
    must have it consistently with its own trial count."""
    bad = []
    for key, v in _rows().items():
        if "null_lifts" not in v:
            continue
        if len(v["null_lifts"]) != v.get("null_trials"):
            bad.append((key, len(v["null_lifts"]), v.get("null_trials")))
    assert not bad, (
        f"null vector length disagrees with null_trials: {bad}. A partial "
        f"vector would silently understate the family maximum.")
