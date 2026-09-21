"""THE TEST THAT ENTITLES US TO THE McCLELLAN NAMES.

⛔⛔ This file is the standing answer to "may UCT ship something called a McClellan
Oscillator?". The rule the project ships under is ACCURACY BEFORE BRANDING: the
calculation must numerically reproduce an established implementation to a documented
tolerance across a substantial historical matrix — not look right on a chart.

The fixture is McClellan Financial's own published NYSE series (see the provenance block
at the top of `tests/fixtures/mcclellan_nyse_reference.csv`). Replaying THEIR advances
and declines through OUR engine must reproduce THEIR oscillator and summation.
"""
from __future__ import annotations

import math

import pytest

from api.services.market_indicators import mcclellan as mc
from api.services.market_indicators import validation as val


@pytest.fixture(scope="module")
def ref():
    rows = val.load_reference_fixture()
    assert len(rows) >= 150, (
        "the reference fixture is the whole evidence base for the McClellan names; a "
        "short one would let this gate pass for the wrong reason")
    return rows


# ── Constants ────────────────────────────────────────────────────────────────

def test_the_smoothing_constants_are_exactly_the_tracking_rates():
    """McClellan defines the smoothers as 10% and 5% and calls the day counts a
    translation. If those two spellings ever disagree, every value moves."""
    assert mc.ALPHA_19 == 0.10
    assert mc.ALPHA_39 == 0.05
    assert mc.ALPHA_19 == 2.0 / (19 + 1)
    assert mc.ALPHA_39 == 2.0 / (39 + 1)


def test_the_two_variants_carry_different_neutral_levels():
    """The classic Summation Index is neutral at +1000 and the ratio-adjusted one at
    zero. A series that inherits the wrong base is off by 1000 points and looks fine."""
    assert mc.CLASSIC.summation_base == 1000.0
    assert mc.RATIO_ADJUSTED.summation_base == 0.0


def test_an_unknown_variant_is_refused_rather_than_defaulted():
    with pytest.raises(ValueError):
        mc.Methodology(variant="nearly_ratio_adjusted")


# ── Normalisation ────────────────────────────────────────────────────────────

def test_ratio_adjustment_is_net_over_total_times_one_thousand():
    # McClellan's own worked scale: "pretend there are always exactly 1000 issues".
    assert mc.ratio_adjusted_net_advances(1000, 0) == pytest.approx(1000.0)
    assert mc.ratio_adjusted_net_advances(0, 1000) == pytest.approx(-1000.0)
    assert mc.ratio_adjusted_net_advances(600, 400) == pytest.approx(200.0)


def test_unchanged_issues_are_excluded_from_the_denominator_by_default():
    """⛔ McClellan excludes them deliberately. Including them compresses every reading
    toward zero by the unchanged share, which is a silent, plausible-looking error."""
    without = mc.ratio_adjusted_net_advances(600, 400, unchanged=200)
    assert without == pytest.approx(200.0)
    with_unch = mc.ratio_adjusted_net_advances(600, 400, unchanged=200,
                                               include_unchanged=True)
    assert with_unch == pytest.approx(1000 * 200 / 1200)
    assert with_unch < without, "including unchanged must shrink the reading"


def test_a_zero_denominator_is_a_non_value_not_a_zero():
    assert mc.ratio_adjusted_net_advances(0, 0) is None


def test_the_classic_variant_uses_raw_net_advances_untouched():
    assert mc.normalise(923, 1828, method=mc.CLASSIC) == pytest.approx(-905.0)
    # and the ratio-adjusted variant does NOT agree with it — they are different series
    assert mc.normalise(923, 1828, method=mc.RATIO_ADJUSTED) == pytest.approx(
        -905 / 2751 * 1000.0)


# ── FORMULA FIDELITY — the gate ──────────────────────────────────────────────

def test_the_engine_reproduces_the_published_oscillator_and_summation_exactly(ref):
    """⭐⭐ THE LICENCE. Seeded from the reference's own published trends (the fixture is
    a rolling window whose EMAs carry in from before it begins), replaying their
    advances and declines must reproduce their numbers.

    Measured 2026-09-20: max |oscillator diff| = 0.0, max |summation diff| = 0.0 over
    179 graded sessions.
    """
    dates = [r["date"] for r in ref]
    adv = [r["advances"] for r in ref]
    dec = [r["declines"] for r in ref]

    seed = mc.TrendState(ema19=ref[0]["ref_trend_10pct"],
                         ema39=ref[0]["ref_trend_5pct"], n=1)
    anchor = mc.Anchor(at=ref[1]["date"], value=ref[1]["ref_summation"],
                       source="reference:mcclellan")

    rep = val.run_matrix(
        dates[1:], adv[1:], dec[1:], universe="nyse-composite",
        method=mc.CLASSIC, anchor=anchor, seed_state=seed,
        ref_oscillator=[r["ref_oscillator"] for r in ref[1:]],
        ref_summation=[r["ref_summation"] for r in ref[1:]],
        tolerance=val.EXACT_TOLERANCE,
    )
    assert rep.compared == len(ref) - 1, rep.summary()
    assert rep.ok, (
        f"{rep.summary()}\nfirst failures: "
        + "; ".join(f"{r.date} osc±{r.osc_abs_diff} summ±{r.summ_abs_diff}"
                    for r in rep.failures[:5]))
    assert rep.max_osc_diff < val.EXACT_TOLERANCE
    assert rep.max_summ_diff < val.EXACT_TOLERANCE


def test_the_matrix_can_actually_fail(ref):
    """⛔ A GATE NOBODY HAS SEEN FAIL IS NOT A GATE. Perturb one reference value and the
    harness must go red — otherwise the test above could be passing vacuously."""
    dates = [r["date"] for r in ref]
    adv = [r["advances"] for r in ref]
    dec = [r["declines"] for r in ref]
    bad = [r["ref_oscillator"] for r in ref]
    bad[10] = bad[10] + 0.5

    seed = mc.TrendState(ema19=ref[0]["ref_trend_10pct"],
                         ema39=ref[0]["ref_trend_5pct"], n=1)
    rep = val.run_matrix(dates[1:], adv[1:], dec[1:], universe="nyse-composite",
                         method=mc.CLASSIC, seed_state=seed,
                         ref_oscillator=bad[1:])
    assert not rep.ok
    assert len(rep.failures) == 1
    assert rep.failures[0].date == ref[10]["date"]


def test_an_empty_report_is_not_a_pass():
    rep = val.MatrixReport()
    assert rep.ok is False


def test_the_published_trends_themselves_are_reproduced(ref):
    """Not just the difference — each smoother individually, so a compensating pair of
    errors cannot hide inside the oscillator."""
    dates = [r["date"] for r in ref]
    seed = mc.TrendState(ema19=ref[0]["ref_trend_10pct"],
                         ema39=ref[0]["ref_trend_5pct"], n=1)
    res = mc.compute(dates[1:], [r["advances"] for r in ref[1:]],
                     [r["declines"] for r in ref[1:]],
                     method=mc.CLASSIC, state=seed)
    for i, r in enumerate(ref[1:]):
        assert res.ema19[i] == pytest.approx(r["ref_trend_10pct"], abs=1e-9), r["date"]
        assert res.ema39[i] == pytest.approx(r["ref_trend_5pct"], abs=1e-9), r["date"]


# ── Seeding and convergence — the measured facts the design rests on ─────────

def _cold_error_against_published(ref, seed_mode):
    """|our oscillator − the published oscillator| per row, from a cold start.

    The published series is the truth here: it is what a correctly-warmed engine
    produces, so the gap IS the seed's residual.
    """
    dates = [r["date"] for r in ref]
    res = mc.compute(dates, [r["advances"] for r in ref], [r["declines"] for r in ref],
                     method=mc.CLASSIC, seed_mode=seed_mode)
    # row 0 has no published oscillator to compare against (it is the fixture's seed row)
    return [None if res.oscillator[i] is None
            else res.oscillator[i] - ref[i]["ref_oscillator"]
            for i in range(len(ref))], res


def test_the_default_seed_is_the_best_conditioned_of_the_three(ref):
    """⭐ THE MEASUREMENT BEHIND `DEFAULT_SEED_MODE`.

    Zero is not chosen because it scored best on one window — it is the unconditional
    expectation of a zero-mean input — but if it ever stopped ALSO scoring best, the
    principle and the evidence would have parted company and somebody should look.
    """
    at = 120
    errs = {}
    for mode in (mc.SEED_ZERO, mc.SEED_SMA, mc.SEED_FIRST):
        e, _ = _cold_error_against_published(ref, mode)
        errs[mode] = abs(e[at])
    assert errs[mc.SEED_ZERO] < errs[mc.SEED_SMA] < errs[mc.SEED_FIRST], errs
    assert mc.DEFAULT_SEED_MODE == mc.SEED_ZERO


def test_the_oscillator_forgets_its_seed_and_the_summation_never_does(ref):
    """The two halves of the whole design, pinned together.

    A future 'simplification' that starts accumulating from row zero fails here rather
    than shipping a plausible, permanently-offset level.
    """
    err, _ = _cold_error_against_published(ref, mc.DEFAULT_SEED_MODE)

    assert abs(err[20]) > 5.0, "a 20-session warm-up is nowhere near converged"
    assert abs(err[80]) < 2.0
    assert abs(err[140]) < 0.1, "by 140 observations it is inside a tenth of a point"

    # The SUM of those residuals does not decay — that is the permanent level error.
    drift = sum(e for e in err[1:] if e is not None)
    assert abs(drift) > 200.0, (
        "if this ever gets small, the anchor refusal has lost its justification and "
        "should be re-argued from a fresh measurement rather than quietly relaxed")


def test_the_burn_in_constant_bounds_the_permanent_summation_offset(ref):
    """⛔⛔ THE CONSTANT MUST KEEP DESCRIBING THE CODE.

    `DEFAULT_BURN_IN` is justified by ONE number: the permanent offset a Summation
    Index inherits if it is anchored that many observations in. The docstring claims
    ~3 points. This measures it, so the claim cannot rot.
    """
    err, _ = _cold_error_against_published(ref, mc.DEFAULT_SEED_MODE)
    b = mc.DEFAULT_BURN_IN
    assert b < len(ref) - 20, "the fixture must be long enough to measure past the burn-in"

    residual_at_epoch = abs(err[b])
    tail = sum(e for e in err[b + 1:] if e is not None)
    assert residual_at_epoch < 0.25, (
        f"oscillator residual at the burn-in epoch is {residual_at_epoch:.3f}; the "
        f"~20x geometric tail would put the permanent summation offset above 5 points")
    assert abs(tail) < 6.0, (
        f"measured summation offset over the remaining window is {tail:+.2f} points — "
        f"the docstring's '~3 points' no longer describes DEFAULT_BURN_IN={b}")


def test_a_shorter_burn_in_would_be_materially_worse(ref):
    """The control. Without it the bound above could pass for a burn-in of 10."""
    err, _ = _cold_error_against_published(ref, mc.DEFAULT_SEED_MODE)
    short_tail = sum(e for e in err[41:] if e is not None)
    assert abs(short_tail) > 50.0, (
        "a 40-observation burn-in should leave a large permanent offset; if it does "
        "not, DEFAULT_BURN_IN is being paid for nothing")


def test_a_summation_without_an_anchor_is_refused_not_defaulted():
    dates = ["2026-01-02", "2026-01-05", "2026-01-06"]
    osc = [1.0, 2.0, 3.0]
    with pytest.raises(mc.SummationNotAnchored):
        mc.summation_series(dates, osc, mc.Anchor(at="2020-01-01", value=0.0))


def test_a_declared_anchor_inside_the_burn_in_is_refused():
    """A level fixed while the EMAs are still warming up is an artifact of the seed."""
    dates = [f"2026-01-{d:02d}" for d in range(1, 21)]
    adv = [600] * 20
    dec = [400] * 20
    with pytest.raises(mc.SummationNotAnchored):
        mc.compute(dates, adv, dec, method=mc.RATIO_ADJUSTED,
                   anchor=mc.Anchor(at=dates[5], value=0.0, source="declared"))


def test_a_reference_anchor_is_exempt_from_the_burn_in_gate():
    """An established publisher's level is a fact about the market, so it CORRECTS the
    seed instead of inheriting it."""
    dates = [f"2026-01-{d:02d}" for d in range(1, 21)]
    res = mc.compute(dates, [600] * 20, [400] * 20, method=mc.RATIO_ADJUSTED,
                     anchor=mc.Anchor(at=dates[5], value=123.0,
                                      source="reference:mcclellan"))
    assert res.summation[5] == pytest.approx(123.0)
    assert res.summation[4] is None, "the series is undefined before its anchor"


def test_the_anchor_session_does_not_double_count_its_own_oscillator():
    """⛔ The single easiest off-by-one in the family."""
    dates = ["2026-01-02", "2026-01-05", "2026-01-06"]
    osc = [10.0, 20.0, 30.0]
    out = mc.summation_series(dates, osc, mc.Anchor(at="2026-01-02", value=0.0,
                                                    source="reference:x"))
    assert out == [0.0, 20.0, 50.0]


def test_first_trustworthy_index_counts_observations_not_rows():
    method = mc.Methodology(variant=mc.VARIANT_RATIO_ADJUSTED, burn_in=3)
    osc = [1.0, None, None, 2.0, None, 3.0, 4.0, 5.0]
    #      0     1     2     3     4     5    6    7   → 4th real obs is index 6
    assert mc.first_trustworthy_index(osc, method) == 6


# ── Holes ────────────────────────────────────────────────────────────────────

def test_a_missing_session_does_not_advance_the_trends():
    """Folding a zero in would pull both EMAs toward zero as though the market had been
    perfectly balanced. A hole is 'not measured', not 'balanced'."""
    vals = [100.0, None, 100.0]
    osc, st = mc.oscillator_series(vals)
    assert osc[1] is None
    assert st.n == 2
    osc2, st2 = mc.oscillator_series([100.0, 100.0])
    assert osc[2] == pytest.approx(osc2[1])
    assert st.ema19 == pytest.approx(st2.ema19)


def test_a_hole_holds_the_summation_level_rather_than_ending_it():
    out = mc.summation_series(["2026-01-02", "2026-01-05", "2026-01-06"],
                              [1.0, None, 2.0],
                              mc.Anchor(at="2026-01-02", value=0.0,
                                        source="reference:x"))
    assert out == [0.0, 0.0, 2.0]


# ── Determinism / reconstruction ─────────────────────────────────────────────

def test_incremental_append_equals_full_recompute(ref):
    """⭐ THE RECONSTRUCTION TEST. A stored series that is extended one session at a time
    must equal the same series recomputed from scratch, or the level silently depends on
    how often the job ran."""
    dates = [r["date"] for r in ref]
    adv = [r["advances"] for r in ref]
    dec = [r["declines"] for r in ref]

    full = mc.compute(dates, adv, dec, method=mc.RATIO_ADJUSTED)

    st = mc.TrendState()
    piecewise = []
    for i in range(len(dates)):
        part = mc.compute([dates[i]], [adv[i]], [dec[i]],
                          method=mc.RATIO_ADJUSTED, state=st)
        piecewise.append(part.oscillator[0])
        st = part.state
    for i in range(len(dates)):
        assert piecewise[i] == pytest.approx(full.oscillator[i], abs=1e-12), dates[i]


def test_recomputing_twice_gives_identical_numbers(ref):
    dates = [r["date"] for r in ref]
    adv = [r["advances"] for r in ref]
    dec = [r["declines"] for r in ref]
    a = mc.compute(dates, adv, dec, method=mc.RATIO_ADJUSTED)
    b = mc.compute(dates, adv, dec, method=mc.RATIO_ADJUSTED)
    assert a.oscillator == b.oscillator


# ── Regime coverage — the brief's "test across market conditions" ────────────

def _slice_by(ref, pred):
    return [r for r in ref if pred(r)]


def test_the_matrix_holds_across_strong_advances_declines_and_quiet_tape(ref):
    """⛔ ONE AGGREGATE PASS CAN HIDE A REGIME. Grade the same replay again inside three
    disjoint market conditions, each required to be non-empty so a slice that stopped
    matching cannot pass by being empty."""
    dates = [r["date"] for r in ref]
    seed = mc.TrendState(ema19=ref[0]["ref_trend_10pct"],
                         ema39=ref[0]["ref_trend_5pct"], n=1)
    rep = val.run_matrix(dates[1:], [r["advances"] for r in ref[1:]],
                         [r["declines"] for r in ref[1:]],
                         universe="nyse-composite", method=mc.CLASSIC, seed_state=seed,
                         ref_oscillator=[r["ref_oscillator"] for r in ref[1:]])
    by_date = {r.date: r for r in rep.rows}

    regimes = {
        "strong advance": _slice_by(ref[1:], lambda r: r["advances"] - r["declines"] > 800),
        "strong decline": _slice_by(ref[1:], lambda r: r["advances"] - r["declines"] < -800),
        "quiet":          _slice_by(ref[1:], lambda r: abs(r["advances"] - r["declines"]) < 200),
    }
    for label, rows in regimes.items():
        assert rows, f"no sessions matched the {label!r} regime — the slice is vacuous"
        for r in rows:
            row = by_date[r["date"]]
            assert row.passed, f"{label} {r['date']} diff={row.osc_abs_diff}"


def test_the_reference_window_actually_spans_a_wide_range(ref):
    """Guards the fixture itself: if a future refresh narrows it to a calm stretch, the
    regime test above would still pass while proving much less."""
    nets = [r["advances"] - r["declines"] for r in ref]
    assert max(nets) > 800, "fixture has no strong advance"
    assert min(nets) < -800, "fixture has no strong decline"
    summs = [r["ref_summation"] for r in ref]
    assert max(summs) - min(summs) > 1000, "fixture summation barely moves"
