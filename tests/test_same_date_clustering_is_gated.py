"""Same-date correlation is a GATE input, not a caveat beside the numbers.

⛔⛔ THE HOLE, AND WHY NO EXISTING RAIL COULD SEE IT. Every interval in the
ledger comes from a cluster bootstrap that resamples TICKERS. That is right for
one axis and silent about the other: a structure firing on hundreds of DIFFERENT
names on the SAME DAY has one market event, not hundreds of observations. The
bootstrap cannot see it, so the interval it returns is too NARROW — and gates 1
and 2 both read an interval's bound. Every test in this repo agreed with the
bootstrap because every test asked the bootstrap.

⭐ IT WAS MEASURED, NOT ASSUMED. `docs/base_lift_clustering.json` holds the
within-date intra-class correlation of the win/loss outcome per structure,
computed over 650 tickers. Two of the seven published rows do not survive it.
Measured 2026-09-01.

⛔ THE STANDARD THIS PINS: a row may publish only with a MEASURED design
effect. Not "publish on the narrow bound and note the gap" — half the noise
term missing is not a smaller claim, it is an unfounded one.
"""
import sys, pathlib, json, math

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

from api.services.screener import lift_ledger as ll

ROOT = pathlib.Path(__file__).resolve().parents[1]
CLUSTERING = ROOT / "docs/base_lift_clustering.json"


def _rows():
    return (ll.load().get("structures") or {})


def _published():
    return {k: v for k, v in _rows().items() if v.get("published")}


# ── the standard ────────────────────────────────────────────────────────────

def test_every_published_row_carries_a_measured_design_effect():
    """⛔ THE WHOLE POINT. A published row whose clustering was never measured
    is publishing an interval it knows is too narrow by an unknown factor."""
    naked = [k for k, v in _published().items()
             if not isinstance(v.get("cluster_deff"), (int, float))]
    assert not naked, (
        f"published with no measured same-date design effect: {naked}. Either "
        f"measure the clustering for these structures or refuse them — a "
        f"published number is a claim about noise, and this one is missing "
        f"half the noise term.")


def test_the_published_set_is_what_readjudication_produces():
    """⭐ DERIVED, NOT TYPED. The published flags are re-run through the ONE
    gate function with each row's own stored design effect. A row whose flag
    disagrees with its own gates is the second-authority defect."""
    wrong = []
    for key, row in _rows().items():
        if row.get("lift") is None:
            continue                      # never measured; nothing to re-gate
        verdict = ll.readjudicate(row, row.get("cluster_deff"))
        if bool(verdict["published"]) != bool(row.get("published")):
            wrong.append((key, row.get("published"), verdict["published"],
                          verdict.get("reasons")))
    assert not wrong, (
        f"stored `published` disagrees with the gates applied to the stored "
        f"numbers: {wrong}")


def test_two_named_rows_fell_to_the_correction_and_say_why():
    """⭐ THE MEASUREMENT'S OWN RESULT, PINNED BY NAME. If a future re-measure
    rescues one of these, that is a real change and this test should be the
    thing that makes someone say so out loud."""
    rows = _rows()
    for key in ("square-box", "low-cheat"):
        row = rows.get(key)
        assert row, f"{key} vanished from the ledger"
        assert not row.get("published"), (
            f"{key} is published again. Under the design effect measured on "
            f"2026-09-01 it did not clear its gates; if a new clustering "
            f"measurement rescued it, update this rail deliberately.")
        joined = " ".join(row.get("reasons") or [])
        assert "design effect" in joined, (
            f"{key} is refused but its reasons never mention the clustering "
            f"correction that refused it: {row.get('reasons')}")


# ── the widening itself ─────────────────────────────────────────────────────

def test_the_widening_is_about_the_estimate_not_the_midpoint():
    """⛔ A bootstrap interval is not symmetric about `lift`. Re-centring it
    would move the point estimate as a side effect of a variance fix."""
    lo, hi = ll.clustered_bounds(0.10, 0.02, 0.30, 4.0)
    assert lo == pytest.approx(0.10 - 0.08 * 2)
    assert hi == pytest.approx(0.10 + 0.20 * 2)


def test_a_design_effect_of_one_changes_nothing():
    """⛔ NON-VACUITY. If the formula moved a bound at deff=1 it would be
    widening for a correlation of zero, and every number above is noise."""
    lo, hi = ll.clustered_bounds(0.10, 0.02, 0.30, 1.0)
    assert (lo, hi) == pytest.approx((0.02, 0.30))


def test_the_ledger_stores_measurements_only_so_it_cannot_widen_twice():
    """⛔⛔ THE TRAP THIS AVOIDS. If the widened bound were written back beside
    the design effect that produced it, the next pass would widen the already
    widened bound. The artifact therefore holds the bootstrap's bounds and the
    design effect — both measurements — and the clustered interval is DERIVED
    at the surface that renders it."""
    for key, row in _published().items():
        derived = ll.evidence_for_structure(key)
        assert derived.get("ci_basis") == "clustered", (
            f"{key}: the member-facing view is not the clustered interval")
        expect_lo, _ = ll.clustered_bounds(row["lift"], row["ci_low"],
                                           row["ci_high"],
                                           float(row["cluster_deff"]))
        assert derived["ci_low"] == pytest.approx(round(expect_lo, 4)), (
            f"{key}: the rendered lower bound is not one application of the "
            f"widening to the stored bootstrap bound")
        # applying it to the DERIVED row again must move it further — which is
        # the proof that the stored value is the un-widened one.
        again, _ = ll.clustered_bounds(derived["lift"], derived["ci_low"],
                                       derived["ci_high"],
                                       float(row["cluster_deff"]))
        assert again < derived["ci_low"], (
            f"{key}: widening the rendered row again did not move it, so the "
            f"stored bound may already carry the correction")


# ── the gate cannot be bypassed ─────────────────────────────────────────────

def _passing_result():
    return {"lift": 0.20, "ci_low": 0.15, "ci_high": 0.25, "n": 5000,
            "rate": 0.6, "baseline": 0.4, "years": ["2020", "2021"]}


def test_a_row_with_no_measured_clustering_is_refused():
    """⛔ THE DEFAULT MUST FAIL CLOSED. `adjudicate` is called from two sites;
    one forgetting to pass the design effect must not quietly publish on the
    narrow bound."""
    v = ll.adjudicate(_passing_result(), [0.01] * ll.ESCALATED_NULL_TRIALS)
    assert not v["published"]
    assert any("clustering" in r for r in v["reasons"]), v["reasons"]


def test_the_same_row_publishes_once_its_clustering_is_measured():
    """⭐ THE CONTROL. Without this, the test above passes for a gate that
    refuses everything — which is not a gate."""
    v = ll.adjudicate(_passing_result(), [0.01] * ll.ESCALATED_NULL_TRIALS,
                      deff=1.0)
    assert v["published"], v.get("reasons")


def test_a_large_design_effect_can_take_a_row_below_its_null():
    """⛔ THE GATE HAS TO BITE. A correction that never changes a verdict is a
    comment."""
    nulls = [0.13] * ll.ESCALATED_NULL_TRIALS
    assert ll.adjudicate(_passing_result(), nulls, deff=1.0)["published"]
    assert not ll.adjudicate(_passing_result(), nulls, deff=9.0)["published"]


def test_synthetic_nulls_answer_the_gates_identically():
    """⭐ WHAT MAKES RE-ADJUDICATION EXACT RATHER THAN APPROXIMATE. The gates
    read only `max()` and `len()` off the null list, so rebuilding it from the
    stored summary reproduces the original verdict byte for byte."""
    row = {"null_max": 0.0172, "null_trials": 30}
    nulls = ll.synthetic_nulls(row)
    assert len(nulls) == 30 and max(nulls) == pytest.approx(0.0172)
    # a row that kept its real vector must return THAT, not the reconstruction
    row2 = dict(row, null_lifts=[0.001, 0.0172, 0.004])
    assert ll.synthetic_nulls(row2) == [0.001, 0.0172, 0.004]


# ── the measurement artifact ────────────────────────────────────────────────

def test_the_clustering_artifact_agrees_with_the_ledger():
    """⛔ TWO FILES, ONE VALUE. `cluster_deff` on a row is a copy of the
    measurement; if they drift, the gate is being applied with a number nobody
    measured."""
    assert CLUSTERING.exists(), (
        "the clustering measurement artifact is gone — the design effects on "
        "the ledger rows now have no provenance")
    blob = json.loads(CLUSTERING.read_text(encoding="utf-8"))
    measured = blob.get("structures") or {}
    assert measured, "the clustering artifact holds no structures"
    for key, m in measured.items():
        row = _rows().get(key) or {}
        if "cluster_deff" not in row:
            continue
        assert row["cluster_deff"] == pytest.approx(m["deff"], abs=1e-3), (
            f"{key}: the ledger says deff={row['cluster_deff']} and the "
            f"measurement says {m['deff']}")
        # and the deff must be what its own rho and m_eff produce
        assert m["deff"] == pytest.approx(1 + (m["m_eff"] - 1) * m["rho"],
                                          abs=1e-2), (
            f"{key}: the recorded design effect is not the one its rho and "
            f"cluster size imply — one of the three was edited by hand")


def test_the_correlation_is_large_enough_that_this_gate_matters():
    """⛔ NON-VACUITY ON THE FINDING ITSELF. If every rho came back ~0 this
    whole apparatus would be ceremony, and the honest report would say so."""
    blob = json.loads(CLUSTERING.read_text(encoding="utf-8"))
    rhos = [m["rho"] for m in (blob.get("structures") or {}).values()]
    assert rhos, "no correlations recorded"
    assert max(rhos) > 0.05, (
        f"the largest measured within-date correlation is {max(rhos):.4f}. At "
        f"that level the clustering correction is doing nothing and this gate "
        f"should be reconsidered rather than left in place looking like rigour.")


def test_the_limitation_travels_with_the_numbers():
    lim = ll.load().get("limitations") or ""
    assert "SAME-DATE" in lim.upper(), (
        "the ledger no longer declares the same-date clustering correction — "
        "a reader cannot infer from a row that its interval was widened")
    for must in ("design effect", "conditional arm"):
        assert must.lower() in lim.lower(), (
            f"the clustering note lost {must!r}: it must carry BOTH what was "
            f"corrected and what the correction does not cover")


# ── the wiring, which is where this kind of work usually dies ───────────────

def _runner_src():
    return (ROOT / "tools/run_lift_ledger.py").read_text(encoding="utf-8")


def test_every_runner_adjudicate_call_passes_the_design_effect():
    """⛔ THE GATE IS ONLY AS GOOD AS ITS CALL SITES. `adjudicate` fails closed
    without a `deff`, so a site that omits it does not publish on the narrow
    bound — it unpublishes the row and reads as a measurement result. Derived
    from the AST, never grepped for a name."""
    import ast
    tree = ast.parse(_runner_src())
    calls = [n for n in ast.walk(tree)
             if isinstance(n, ast.Call)
             and isinstance(n.func, ast.Attribute)
             and n.func.attr == "adjudicate"]
    assert calls, (
        "no `adjudicate` call found in the runner — either it was renamed or "
        "this rail is now looking at the wrong module")
    naked = [ast.unparse(c) for c in calls
             if not any(k.arg == "deff" for k in c.keywords)]
    assert not naked, (
        f"these runner call sites do not pass a design effect: {naked}. Each "
        f"would refuse every row it grades.")


def test_the_runner_carries_the_clustering_across_a_re_run():
    """⛔⛔ THE SILENT-UNPUBLISH TRAP. The clustering is measured by a separate
    pass; a normal `run_lift_ledger` re-run rebuilds each row from scratch. If
    the design effect is not carried forward, the very next run refuses every
    published row and the artifact says the library collapsed."""
    import tools.run_lift_ledger as runner
    prior = {"cluster_deff": 4.0, "cluster_rho": 0.13, "cluster_m_eff": 23.5,
             "cluster_measured_at": "2026-09-01"}
    row = {"published": True, "lift": 0.02}
    runner._carry_forward(prior, row)
    for k, v in prior.items():
        assert row.get(k) == v, (
            f"a re-run drops {k}, so the next pass grades this row with no "
            f"measured clustering and refuses it")


def test_carry_forward_does_not_invent_a_clustering_that_was_never_measured():
    """⛔ NON-VACUITY. A carrier that stamped a default onto every row would
    pass the test above and quietly re-open the hole it exists to close."""
    import tools.run_lift_ledger as runner
    row = {"published": True, "lift": 0.02}
    runner._carry_forward({}, row)
    assert "cluster_deff" not in row, (
        "a row with no prior measurement came out of the carrier carrying "
        "one — the gate can now be satisfied by a number nobody measured")


def test_the_old_carrier_name_is_gone():
    """⭐ THE RENAME IS THE POINT. A helper called `_carry_note` that also
    moves the design effect deciding publication is the stale-name defect this
    repo keeps paying for: the next reader deletes the call believing it only
    touches prose, and every published row silently unpublishes."""
    import ast
    tree = ast.parse(_runner_src())
    defs = [n.name for n in ast.walk(tree)
            if isinstance(n, ast.FunctionDef) and n.name == "_carry_note"]
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call)
             and isinstance(n.func, ast.Name) and n.func.id == "_carry_note"]
    assert not defs and not calls, (
        "`_carry_note` is back as a definition or a call. It carries the "
        "clustering measurement too — name it for everything it moves, or the "
        "next deletion is silent.")
    # ⛔ AST, NOT A SUBSTRING. The first version of this rail grepped the
    # source and failed on the RENAME NOTE in the new function's own docstring
    # — a rail that forbids naming the thing it renamed teaches the next
    # engineer to delete the explanation instead of keeping the guarantee.
    assert "_carry_forward" in [n.name for n in ast.walk(tree)
                                if isinstance(n, ast.FunctionDef)], (
        "the successor is gone too — nothing carries the clustering forward")


# ── is the ledger finished? ─────────────────────────────────────────────────

def test_no_null_escalation_can_change_any_verdict():
    """⭐⭐ THE COMPLETENESS CLAIM, RE-DERIVED RATHER THAN TRUSTED.

    Most rows were graded against 5 null trials, far under the 30 a published
    row needs, so escalating them looks like the obvious remaining work. It is
    futile by construction: a null MAXIMUM only grows with trials, so gate 2
    gets strictly harder, and gates 0 and 1 never read the null at all.

    ⛔ This is checked row by row rather than argued, because "the argument is
    sound" is how a completeness claim survives the day it stops being true.
    """
    rescuable = []
    for key, row in _rows().items():
        if row.get("published") or row.get("lift") is None:
            continue
        if row["lift"] <= 0:
            continue                                   # gate 0
        deff = row.get("cluster_deff")
        lo = (ll.clustered_bounds(row["lift"], row["ci_low"], row["ci_high"],
                                  float(deff))[0]
              if isinstance(deff, (int, float)) else row["ci_low"])
        if lo <= 0:
            continue                                   # gate 1
        nm = row.get("null_max")
        if nm is not None and lo <= nm:
            continue                                   # gate 2, monotone
        if (row.get("null_trials") or 0) >= ll.ESCALATED_NULL_TRIALS:
            continue                                   # already at the ceiling
        rescuable.append((key, row["lift"], lo, nm, row.get("null_trials")))
    assert not rescuable, (
        f"these rows COULD publish if their nulls were escalated: {rescuable}. "
        f"The ledger's completeness note says none can — escalate them or "
        f"correct the note.")


def test_the_claim_is_not_vacuous_because_rows_ARE_below_the_ceiling():
    """⛔ NON-VACUITY. If every row already had 30 trials, "no escalation can
    help" would be trivially true and would say nothing about this library."""
    below = [k for k, v in _rows().items()
             if (v.get("null_trials") or 0) < ll.ESCALATED_NULL_TRIALS]
    assert len(below) >= 10, (
        f"only {len(below)} rows sit below the {ll.ESCALATED_NULL_TRIALS}-trial "
        f"ceiling; the futility argument no longer describes this ledger")


def test_the_monotonicity_the_argument_rests_on_actually_holds():
    """⛔ THE LOAD-BEARING PREMISE, TESTED. Everything above rests on a null
    maximum being non-decreasing in trial count. That is obvious — which is
    exactly the kind of premise that goes unchecked."""
    import random
    rng = random.Random(11)
    draws = [rng.gauss(0, 1) for _ in range(200)]
    maxima = [max(draws[:n]) for n in range(1, len(draws) + 1)]
    assert all(b >= a for a, b in zip(maxima, maxima[1:])), (
        "a running maximum decreased — the futility argument is unsound")


def test_the_completeness_claim_travels_with_the_numbers():
    lim = ll.load().get("limitations") or ""
    assert "IS THIS LEDGER FINISHED?" in lim, (
        "the ledger no longer states whether its remaining 5-trial rows are "
        "worth escalating — the next reader will spend a day finding out")
    for must in ("only GROW", "not more DATA"):
        assert must in lim, (
            f"the completeness note lost {must!r}: it must carry BOTH why "
            f"escalation is futile AND what it does not foreclose")
