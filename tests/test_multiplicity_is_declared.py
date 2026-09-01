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


def test_the_family_bound_claim_is_derived_from_the_CLUSTERED_bounds():
    """⛔⛔ TWO CORRECTIONS, ONE ARTIFACT, AND THEY INTERACT.

    This note's arithmetic compares each published row's CI lower bound to the
    family's largest null maximum. On 2026-09-01 the same-date clustering
    correction moved every one of those lower bounds — and the note still
    quoted the pre-clustering values, naming `climax-top` at +19.08pp as
    clearing a +18.92pp bar it now misses at +18.61pp.

    ⭐ TWO CORRECTIONS THAT ARE EACH INDIVIDUALLY SURVIVABLE ARE NOT JOINTLY
    SURVIVABLE, and a note stating one of them in terms of a bound the other
    has since moved is the stale-count defect this file keeps re-committing.
    So the claim is re-derived here rather than re-read.
    """
    rows = _rows()
    nulls = [v["null_max"] for v in rows.values() if v.get("null_max") is not None]
    bound = max(nulls)
    lim = ll.load().get("limitations") or ""

    clears, falls = [], []
    for key, v in rows.items():
        if not v.get("published"):
            continue
        deff = v.get("cluster_deff")
        assert isinstance(deff, (int, float)), (
            f"{key} publishes with no measured design effect, so this "
            f"comparison cannot be made honestly")
        lo, _ = ll.clustered_bounds(v["lift"], v["ci_low"], v["ci_high"],
                                    float(deff))
        (clears if lo > bound else falls).append(key)

    for key in clears:
        assert key in lim, (
            f"{key} clears the family-wise bound on its clustered interval and "
            f"the note does not name it")
    # ⛔ READ THE CLAUSE, NOT A CHARACTER WINDOW. The first version of this
    # sliced 200 chars either side of the name and asked whether "fall"
    # appeared -- and the slice cut "fall" in half, so a CORRECT note failed.
    # A rail that fails on where a word lands trains its author to move words.
    start = lim.find("cleared by")
    assert start != -1, "the family-wise note no longer states what clears the bar"
    # ⛔⛔ A SENTENCE DOES NOT END AT THE FIRST FULL STOP. `find(".")`
    # stopped inside "+25.85pp" -- three characters in -- so the clause this
    # rail examined was "cleared by only 1 of the 5 published rows -- parabolic
    # -extension (clustered CI low +25", and a mutation appending "and
    # climax-top." to the real clause PASSED. The rail read a number, not a
    # sentence. Terminate on a full stop followed by whitespace or end.
    import re
    m = re.search(r"\.(?=\s|$)", lim[start:])
    clause = lim[start:start + (m.end() if m else len(lim) - start)]
    for key in falls:
        assert key not in clause, (
            f"{key} is listed as clearing the family-wise bound, but its "
            f"clustered lower bound does not clear {bound:+.4f}")
    for key in clears:
        assert key in clause, (
            f"{key} clears the bound and the clause does not name it")
