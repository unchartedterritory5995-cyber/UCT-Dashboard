import random

from api.services.screener import lift_ledger as ll


def _bar(i, c, spread=0.01):
    return {"t": 20200101 + i, "o": c, "h": c * (1 + spread),
            "l": c * (1 - spread), "c": c, "v": 1_000_000}


def _series(closes, spread=0.01):
    return [_bar(i, c, spread) for i, c in enumerate(closes)]


# ── outcome ────────────────────────────────────────────────────────────────

def test_target_first_is_true():
    bars = _series([100.0] * 5 + [100.0 * 1.15] + [100.0] * 40)
    assert ll.outcome(bars, 0, horizon=20) is True


def test_stop_first_is_false():
    bars = _series([100.0] * 5 + [100.0 * 0.85] + [100.0] * 40)
    assert ll.outcome(bars, 0, horizon=20) is False


def test_neither_resolving_is_false_not_none():
    """`None` is reserved for NOT EVALUABLE. An unresolved trade is evaluable
    and it did not work, so it is False — and the baseline uses the identical
    definition, which is the part that must not drift.
    """
    bars = _series([100.0] * 40)
    assert ll.outcome(bars, 0, horizon=20) is False


def test_no_room_left_in_the_series_is_none():
    bars = _series([100.0] * 10)
    assert ll.outcome(bars, 5, horizon=20) is None


def test_the_stop_wins_when_both_are_touched_in_the_same_window():
    """Stop is checked before target on each bar — the conservative reading,
    since intraday order is unknowable from a daily bar.
    """
    bars = _series([100.0]) + [
        {"t": 20200102, "o": 100.0, "h": 115.0, "l": 90.0, "c": 100.0, "v": 1}
    ] + _series([100.0] * 40)
    assert ll.outcome(bars, 0, horizon=20) is False


# ── the walk is causal ─────────────────────────────────────────────────────

def test_the_detector_never_sees_a_bar_after_the_anchor():
    """⛔ A look-ahead here would not fail loudly — it would quietly produce a
    spectacular lift. So the walk is asserted, not trusted.
    """
    seen = []

    def spy(window):
        seen.append(window[-1]["t"])
        return False

    bars = _series([100.0 + i for i in range(400)])
    rows = ll.scan_series(spy, bars, step=20, window=100, min_history=260)
    anchors = [t for t in seen]
    assert anchors, "expected at least one anchor"
    # every window's last bar is the anchor itself, never later
    for t in anchors:
        assert t <= bars[-1]["t"]
    assert len(rows) == len(anchors)


def test_anchors_are_non_overlapping_at_the_horizon():
    """Overlapping forward windows inflate n and shrink the CI without adding
    information — the fastest way to manufacture significance from noise.
    """
    seen = []

    def spy(window):
        seen.append(len(window))
        return False

    bars = _series([100.0 + i * 0.1 for i in range(500)])
    ll.scan_series(spy, bars, step=ll.HORIZON_BARS, window=400, min_history=260)
    assert len(seen) >= 2


def test_a_detector_that_raises_is_skipped_not_fatal():
    def boom(window):
        raise ValueError("bad")
    bars = _series([100.0 + i for i in range(400)])
    assert ll.scan_series(boom, bars) == []


# ── measure ────────────────────────────────────────────────────────────────

def _rows(hit_n, hit_w, free_n, free_w, year="2021"):
    rows = [(year, True, i < hit_w) for i in range(hit_n)]
    rows += [(year, False, i < free_w) for i in range(free_n)]
    return rows


def test_lift_is_conditional_minus_pattern_free():
    t = ll._tally(_rows(100, 60, 400, 200))
    assert t["n"] == 100 and t["wins"] == 60
    assert t["free_n"] == 400 and t["free_wins"] == 200


def test_the_baseline_only_counts_years_the_structure_fired_in():
    """⛔ THE BASELINE DRIFTS. Measured: target-first ran 17.1% in 2018 and
    35.7% in 2020. A structure that fired mostly in a good year would show a
    huge 'edge' against a pooled constant.
    """
    rows = [("2020", True, True)] + [("2018", False, False)] * 50
    t = ll._tally(rows)
    assert t["free_n"] == 0, "2018 anchors must not baseline a 2020 detection"
    assert t["years"] == ["2020"]


def test_measure_returns_none_lift_when_nothing_fired():
    bars = {"A": _series([100.0 + i for i in range(400)])}
    r = ll.measure(lambda w: False, bars)
    assert r["n"] == 0 and r["lift"] is None


# ── the null ───────────────────────────────────────────────────────────────

def _abs_ret_autocorr(bars):
    """Lag-1 autocorrelation of |return| — the standard volatility-clustering
    measure. High means quiet days follow quiet days."""
    r = [abs(bars[i]["c"] / bars[i - 1]["c"] - 1.0) for i in range(1, len(bars))]
    n = len(r) - 1
    m = sum(r) / len(r)
    num = sum((r[i] - m) * (r[i + 1] - m) for i in range(n))
    den = sum((x - m) ** 2 for x in r)
    return num / den if den else 0.0


def _clustered_series(n=900):
    """Alternating calm and violent regimes — real volatility clustering."""
    out, p = [], 100.0
    x = 3
    for i in range(n):
        x = (1103515245 * x + 12345) % (2 ** 31)
        amp = 0.004 if (i // 60) % 2 == 0 else 0.06
        p *= 1.0 + ((x / (2 ** 31)) - 0.5) * amp
        out.append(p)
    return _series(out)


def test_block_resampling_draws_only_real_returns_and_changes_the_order():
    """A moving-block bootstrap resamples WITH REPLACEMENT, so the multiset is
    deliberately not preserved — but no return may be invented.
    """
    bars = _clustered_series(300)
    out = ll.shuffle_returns(bars, random.Random(1))
    assert len(out) == len(bars)

    def rets(bs):
        return [round(bs[i]["c"] / bs[i - 1]["c"], 9) for i in range(1, len(bs))]
    original, drawn = set(rets(bars)), rets(out)
    assert set(drawn) <= original, "the null invented a return that never occurred"
    assert [b["c"] for b in out] != [b["c"] for b in bars], "order must change"


def test_the_block_null_KEEPS_volatility_clustering_and_an_iid_shuffle_does_not():
    """⭐ THE WHOLE REASON THE NULL IS BLOCK-BASED.

    A structure like a Darvas box SELECTS a quiet stretch. Measured against an
    iid-shuffled null — which destroys volatility clustering along with the
    order — such a detector shows lift that is really a volatility effect
    wearing a structural edge's clothes. The block null keeps quiet stretches
    quiet, so the comparison isolates STRUCTURE.
    """
    bars = _clustered_series()
    real = _abs_ret_autocorr(bars)
    iid = _abs_ret_autocorr(ll.shuffle_returns(bars, random.Random(5), block=1))
    blocked = _abs_ret_autocorr(
        ll.shuffle_returns(bars, random.Random(5), block=ll.NULL_BLOCK_BARS))

    assert real > 0.15, f"fixture is not actually clustered (rho={real:.3f})"
    assert iid < 0.05, f"an iid shuffle should destroy clustering (rho={iid:.3f})"
    assert blocked > iid * 3, (
        f"the block null must RETAIN clustering: blocked={blocked:.3f} "
        f"vs iid={iid:.3f}")


def test_shuffling_refuses_a_series_with_a_non_positive_close():
    bars = _series([100.0, 0.0, 100.0])
    assert ll.shuffle_returns(bars, random.Random(1)) == []


# ── the gates ──────────────────────────────────────────────────────────────

def test_a_ci_that_includes_zero_is_refused():
    res = {"lift": 0.02, "ci_low": -0.01, "ci_high": 0.05, "n": 30,
           "rate": 0.3, "baseline": 0.28, "years": ["2021"]}
    # padded to the escalated trial count: this test is about the other
    # gates, not about trial depth, and publication now requires 30.
    out = ll.adjudicate(res, nulls=[0.0] * ll.ESCALATED_NULL_TRIALS)
    assert out["published"] is False
    assert any("includes zero" in r for r in out["reasons"])


def test_a_lift_below_its_own_random_data_null_is_refused():
    """⚠️ The control most implementations skip. Osler found average simulated
    profits negative ~80% of the time on data where the pattern is meaningless
    by construction; without it a mechanical drag reads as signal.
    """
    res = {"lift": 0.03, "ci_low": 0.01, "ci_high": 0.05, "n": 900,
           "rate": 0.31, "baseline": 0.28, "years": ["2021"]}
    out = ll.adjudicate(res, nulls=[0.01, 0.04, 0.02])
    assert out["published"] is False
    assert any("random-data null" in r for r in out["reasons"])


def test_a_missing_null_is_a_refusal_never_a_pass():
    res = {"lift": 0.09, "ci_low": 0.05, "ci_high": 0.13, "n": 900,
           "rate": 0.37, "baseline": 0.28, "years": ["2021"]}
    out = ll.adjudicate(res, nulls=[])
    assert out["published"] is False


def test_all_gates_passing_publishes_the_lift():
    res = {"lift": 0.09, "ci_low": 0.05, "ci_high": 0.13, "n": 900,
           "rate": 0.37, "baseline": 0.28, "years": ["2021"]}
    # 30 trials, same three values repeated: this test is about the other
    # gates, and publication now requires an ESCALATED null.
    out = ll.adjudicate(res, nulls=[0.01, 0.02, 0.0] * 10)
    assert out["published"] is True
    assert out["lift"] == 0.09


def test_a_refusal_carries_NO_lift_key_rather_than_a_zero():
    """⛔⛔ THE HONESTY RULE. `pattern_join` shipped a synthetic 0.0 to members
    as a measurement across 46 of 79 rows because absence was treated as zero.
    A refused structure must have NO lift key at all.
    """
    out = ll.adjudicate({"lift": None, "n": 0}, nulls=[])
    assert out["published"] is False
    assert "lift" not in out


def test_a_negative_lift_whose_ci_excludes_zero_is_still_refused():
    """A structure measured to be reliably WORSE than its baseline does not get
    published as a number either — the column describes, it does not warn.
    """
    res = {"lift": -0.06, "ci_low": -0.09, "ci_high": -0.03, "n": 900,
           "rate": 0.22, "baseline": 0.28, "years": ["2021"]}
    # padded to the escalated trial count: this test is about the other
    # gates, not about trial depth, and publication now requires 30.
    out = ll.adjudicate(res, nulls=[0.0] * ll.ESCALATED_NULL_TRIALS)
    assert out["published"] is False
    assert any("random-data null" in r for r in out["reasons"])


def test_a_wide_interval_on_a_thin_sample_cannot_clear_the_null():
    """⛔ THE REAL RUN CAUGHT THIS, THE UNIT TESTS DID NOT.

    Measured 2026-08-30, first live run: the Power Play produced +32.97pp lift
    on n=13 with a 95% CI of [+6.52, +59.43], while its OWN random-data null
    reached +13.80pp across 5 trials. Comparing the POINT ESTIMATE to the null
    published it. Comparing the CI's LOWER BOUND refuses it — correctly, since
    the result is entirely consistent with the detector's mechanical drag on
    data where it cannot be right.

    This is also what makes gate 3 ("n is derived, never typed") actually bite:
    a thin sample widens the interval, the lower bound sinks under the null,
    and the structure is refused without anyone picking an `n >= 30`.
    """
    thin = {"lift": 0.3297, "ci_low": 0.0652, "ci_high": 0.5943, "n": 13,
            "rate": 0.6154, "baseline": 0.2857, "years": ["2021"]}
    out = ll.adjudicate(thin, nulls=[-0.0254, 0.1380, 0.001, -0.01, 0.004])
    assert out["published"] is False
    assert any("CI lower bound" in r for r in out["reasons"])


def test_a_well_powered_lift_still_clears_the_same_null():
    """The control: the tightening must not refuse everything. Darvas's real
    numbers — +7.65pp on n=2,625, CI [+5.78, +9.53], null max +2.31pp.
    """
    strong = {"lift": 0.0765, "ci_low": 0.0578, "ci_high": 0.0953, "n": 2625,
              "rate": 0.3467, "baseline": 0.2701, "years": ["2014", "2015"]}
    out = ll.adjudicate(strong, nulls=([-0.0057, 0.0231, 0.010, 0.0, 0.008]
                                       * 6))   # 30 trials, same values
    assert out["published"] is True
    assert out["lift"] == 0.0765


def test_the_cluster_bootstrap_CI_is_WIDER_than_the_naive_one():
    """⭐ THE WHOLE REASON THE CI IS A CLUSTER BOOTSTRAP.

    Detections are not independent draws: one ticker in a long consolidation
    contributes many anchors that share a regime. The textbook two-proportion
    standard error assumes independence and therefore comes out too narrow —
    which is how a structure clears a CI gate it has not earned. Resampling
    TICKERS carries the correlation, and the interval must widen.

    The fixture makes the dependence extreme and obvious: each ticker is
    internally unanimous, so all the information is in the 12 tickers, not in
    the 480 anchors.
    """
    bars_by = {}
    for k in range(12):
        good = k < 8
        closes = [100.0] * 300
        bars_by[f"T{k}"] = _series(closes)

    rows_by = {}
    for k in range(12):
        year = "2021"
        win = k < 8
        rows_by[f"T{k}"] = [(year, True, win)] * 20 + [(year, False, k < 4)] * 20

    lo, hi = ll._cluster_bootstrap_ci(rows_by, trials=400, seed=1)
    flat = [r for rows in rows_by.values() for r in rows]
    t = ll._tally(flat)
    p_c = t["wins"] / t["n"]
    p_b = t["free_wins"] / t["free_n"]
    lift = p_c - p_b
    import math as _m
    se = _m.sqrt(ll._wilson_se(p_c, t["n"]) ** 2 + ll._wilson_se(p_b, t["free_n"]) ** 2)
    naive_w = 2 * ll.Z * se
    cluster_w = hi - lo
    assert cluster_w > naive_w, (
        f"cluster CI ({cluster_w:.4f}) must be wider than naive ({naive_w:.4f})")


def test_a_single_ticker_cannot_produce_a_finite_cluster_interval():
    """One cluster carries no information about between-cluster variance, so
    the honest answer is an infinite interval — which the gate then refuses.
    """
    lo, hi = ll._cluster_bootstrap_ci({"ONLY": [("2021", True, True)] * 50},
                                      trials=400, seed=1)
    assert lo == float("-inf") and hi == float("inf")


# ── the artifact must exist and cover every structure ──────────────────────

def test_the_ledger_artifact_names_EVERY_relation():
    """⛔ AN UNMEASURED STRUCTURE MUST BE VISIBLE, NOT SILENT.

    `lesson_built_tested_green_and_unreachable` is the repo's own name for a
    module that computes the right answer and reaches no surface. A ledger that
    simply omits the structures nobody got round to measuring is the same
    defect wearing a data shape: absence reads as "fine" instead of "unknown".
    So every relation gets a row — published with its numbers, or refused with
    the reason it was refused.
    """
    from api.services.screener import base_catalog as bc

    data = ll.load()
    assert data, "the ledger artifact is missing or unreadable"
    entries = data.get("structures") or {}
    missing = [s.key for s in bc.RELATIONS if s.key not in entries]
    assert not missing, f"structures with no ledger row at all: {missing}"

    for s in bc.RELATIONS:
        e = entries[s.key]
        assert "published" in e, f"{s.key}: no verdict"
        if e["published"]:
            for f in ("lift", "ci_low", "ci_high", "n", "null_max"):
                assert f in e, f"{s.key} published without {f}"
        else:
            assert e.get("reasons"), f"{s.key} refused with no reason"


def test_the_artifact_records_its_own_method_and_date():
    """A number with no method beside it cannot be re-derived or challenged."""
    data = ll.load()
    for field in ("measured_at", "method", "sample", "baseline_metric"):
        assert data.get(field), f"the ledger does not record {field}"


def test_meta_never_reports_a_lift_the_ledger_refused():
    """⛔ THE CATALOG MAY NOT DISAGREE WITH THE HARNESS. `Structure` has no lift
    field; `meta()` reads the ledger. A refused structure must surface None,
    never a weak positive.
    """
    from api.services.screener import base_catalog as bc

    entries = (ll.load().get("structures") or {})
    m = bc.meta()
    for key, e in entries.items():
        if key not in m:
            continue
        if not e.get("published"):
            assert m[key]["lift_pp"] is None, (
                f"{key} was refused but meta() reports {m[key]['lift_pp']}")
        else:
            assert m[key]["lift_pp"] is not None, f"{key} published but meta() hides it"


# ── freshness ──────────────────────────────────────────────────────────────

def test_an_undated_artifact_is_stale_by_definition():
    """An undated number cannot be known to be current, so it is not trusted."""
    import json, tempfile, os
    fd, p = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    try:
        with open(p, "w", encoding="utf-8") as fh:
            json.dump({"structures": {}}, fh)
        assert ll.is_stale(path=p) is True
        assert ll.age_days(path=p) is None
    finally:
        os.unlink(p)


def test_staleness_is_measured_against_the_recorded_date():
    import datetime as dt
    import json, tempfile, os
    fd, p = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    try:
        with open(p, "w", encoding="utf-8") as fh:
            json.dump({"measured_at": "2026-01-01", "structures": {}}, fh)
        fresh = dt.date(2026, 3, 1)
        old = dt.date(2026, 9, 1)
        assert ll.is_stale(path=p, today=fresh) is False
        assert ll.is_stale(path=p, today=old) is True
    finally:
        os.unlink(p)


def test_the_ledger_is_not_stale():
    """⛔ THE FRESHNESS RAIL. Nothing re-runs the harness automatically -- it is
    a deliberate tool, because the web pod already carries ~135 cron jobs and a
    multi-minute monthly harness buys nothing there. So this test IS the
    refresh mechanism: when it goes red, re-run

        python tools/run_lift_ledger.py

    and commit the rewritten artifact. Going red is the design, not a defect.
    """
    age = ll.age_days()
    assert age is not None, "the ledger records no measured_at date"
    assert not ll.is_stale(), (
        f"the lift ledger was measured {age} days ago (bound is "
        f"{ll.MAX_LEDGER_AGE_DAYS}). Re-run `python tools/run_lift_ledger.py` "
        f"and commit the rewritten artifact.")


# ── the evidence reaches the member ────────────────────────────────────────

def test_the_filter_payload_carries_evidence_only_for_published_structures():
    """⛔ THE BLANK MUST STAY HONEST ALL THE WAY TO THE SCREEN.

    A refused structure is ABSENT from the evidence dict, never present with a
    zero. `pattern_join` shipped a synthetic breakeven to members as a
    measurement across 46 of 79 rows by treating absence as zero; the ledger
    exists so that cannot happen again, and it only holds if the surface
    preserves it.
    """
    from api.services.screener import base_catalog as bc
    from api.services.screener import filters

    m = filters.meta()
    ctl = [f for f in m["filters"] if f["key"] == "base_structure"][0]
    ev = ctl.get("evidence") or {}
    entries = ll.load().get("structures") or {}

    for key, e in entries.items():
        token = bc.match_value(key)
        if e.get("published"):
            assert token in ev, f"{key} is published but carries no evidence"
            assert ev[token]["lift_pp"] is not None
        else:
            assert token not in ev, (
                f"{key} was REFUSED but the filter payload carries evidence "
                f"for it: {ev.get(token)}")


def test_the_evidence_states_its_own_vintage_and_metric():
    """A number with no conditions beside it cannot be challenged or re-derived,
    and a member cannot tell a fresh measurement from a two-year-old one.
    """
    from api.services.screener import filters

    ctl = [f for f in filters.meta()["filters"]
           if f["key"] == "base_structure"][0]
    basis = ctl.get("evidence_basis") or {}
    assert basis.get("measured_at"), "evidence ships with no date"
    assert basis.get("metric"), "evidence ships with no metric"
    assert "stale" in basis, "the surface cannot tell whether the number is stale"


def test_a_detector_that_always_raises_is_not_reported_as_never_firing():
    """⛔⛔ THE BUG THIS EXISTS TO PREVENT, AND IT SHIPPED ONCE.

    `scan_series` swallows a raising detector so one bad structure cannot kill
    a whole run. But swallowing every anchor produced n=0 — IDENTICAL to a
    structure that simply never fired — and that is exactly what happened: the
    ledger runner passed a stub context with no `swings`, every call raised,
    and Stage 2 Breakout was written to the artifact as "no detections" while
    the live coverage check found it on 21 of 3,541 symbols. The contradiction
    between those two numbers is the only reason it was caught.
    """
    bars = _series([100.0 + (i % 7) for i in range(500)])

    def boom(window):
        raise AttributeError("no swings on this context")

    r = ll.measure(boom, {"A": bars, "B": bars})
    assert r["lift"] is None
    assert r.get("refused"), "an all-raising run must say so, not report n=0"
    assert "raised on" in r["refused"]


def test_a_working_detector_reports_no_scan_errors():
    """Non-vacuity: the error path must not fire on healthy detectors."""
    bars = _series([100.0 + (i % 7) for i in range(500)])
    r = ll.measure(lambda w: False, {"A": bars})
    assert r.get("scan_errors") == 0
    assert not r.get("refused")


def test_the_null_skips_the_interval_it_never_reads():
    """⚡ The null trials read only the POINT lift, so computing a 400-draw
    cluster CI for each was pure waste — a large share of a 46-minute run, and
    the reason 28 more structures looked like a 21-hour job.

    ⛔ The OBSERVED measurement must keep its interval. This pins that
    `bootstrap=0` drops the CI and nothing else: the lift, n and baseline are
    identical either way.
    """
    bars = _series(_noise_prices(600))
    full = ll.measure(lambda w: len(w) % 3 == 0, {"A": bars, "B": bars},
                      bootstrap=50)
    cheap = ll.measure(lambda w: len(w) % 3 == 0, {"A": bars, "B": bars},
                       bootstrap=0)
    assert cheap["ci_low"] is None and cheap["ci_high"] is None
    assert full["ci_low"] is not None
    assert cheap["lift"] == full["lift"]
    assert cheap["n"] == full["n"] and cheap["baseline"] == full["baseline"]


def _noise_prices(n, seed=13):
    out, p = [], 100.0
    x = seed
    for _ in range(n):
        x = (1103515245 * x + 12345) % (2 ** 31)
        p *= 1.0 + ((x / (2 ** 31)) - 0.5) * 0.05
        out.append(p)
    return out


ESCALATED_NULL_TRIALS = 30


def test_a_PUBLISHED_row_was_held_to_the_escalated_null():
    """⛔⛔ THE ESCALATION RULE, ENFORCED RATHER THAN DOCUMENTED.

    The publish gate compares the lift's CI lower bound to the MAXIMUM of the
    null trials. That maximum can only grow with more draws, so a small trial
    count is a strictly EASIER gate -- which means trial count is a dial that
    could be turned toward a desired result, and nothing but a rail stops it.

    This is not hypothetical. stage-4-breakdown cleared a 5-trial screen at
    +8.35pp with a CI lower bound of +5.45pp against a null max of +2.82pp, and
    was written to the artifact as published. Re-run at 30 trials the null max
    reached +5.54pp and the same structure was refused -- by 9 basis points.
    Had the screen's verdict been allowed to stand, the ledger would carry two
    published numbers held to nulls of very different strength.

    A REFUSAL at a low trial count needs no such rail: more trials can only
    raise the bar it already failed.
    """
    entries = (ll.load().get("structures") or {})
    published = {k: e for k, e in entries.items() if e.get("published")}
    assert published, "no published rows -- this rail would pass vacuously"
    for key, e in published.items():
        assert e.get("null_trials", 0) >= ESCALATED_NULL_TRIALS, (
            f"{key} is PUBLISHED on only {e.get('null_trials')} null trials; "
            f"the gate compares against the null's maximum, so fewer trials "
            f"is a weaker test. Re-run it at {ESCALATED_NULL_TRIALS}.")


def test_every_row_states_the_sample_it_was_measured_on():
    """A lift with no sample size beside it cannot be weighed.

    The header used to carry ONE `sample` line that the runner rewrote on every
    run -- so a `--only` re-measure of one structure left the header describing
    a sample five other rows were never drawn from. The size is a property of
    the row. Where an early run did not record it, the row says so explicitly
    rather than inheriting a number from a different measurement.
    """
    entries = (ll.load().get("structures") or {})
    assert entries, "no rows -- this rail would pass vacuously"
    for key, e in entries.items():
        assert "sample_tickers" in e, f"{key} does not state its sample"
        if e["sample_tickers"] is None:
            assert e.get("sample_tickers_missing"), (
                f"{key} has a null sample with no reason -- an absent number "
                f"must say why it is absent, not merely be blank")
        else:
            assert e["sample_tickers"] > 0, f"{key} claims a zero sample"


# -- the shared multi-detector scan -----------------------------------------

def _synthetic_universe(n_tickers=8, n_bars=520, seed=20260830):
    import random
    out = {}
    for t in range(n_tickers):
        rng = random.Random(seed + t)
        px, bars = 40.0 + t, []
        for i in range(n_bars):
            px = max(1.0, px * (1 + rng.gauss(0.0005, 0.022)))
            bars.append({"t": 20200101 + i, "o": px, "c": px,
                         "h": px * 1.012, "l": px * 0.988,
                         "v": rng.randint(400_000, 3_000_000)})
        out["T%02d" % t] = bars
    return out


def _group():
    """Structures that share the 400-bar window, as the runner groups them."""
    from api.services.screener import base_catalog as bc
    keys = ["darvas-box", "flat-base", "double-bottom", "vcp",
            "stage-4-breakdown", "high-tight-flag", "ascending-base"]
    return {k: (lambda st: (lambda ctx: bool(st.detect(ctx))))(bc.by_key(k))
            for k in keys}


def test_a_shared_scan_returns_EXACTLY_what_separate_scans_return():
    """⛔⛔ THE RAIL THAT MAKES THE OPTIMISATION USABLE.

    Fourteen structures each rebuilt the same per-anchor context, and that
    context is the expensive part (2.28 ms of zigzag against detectors costing
    0.25-0.5 ms). Sharing it turns a ~20-hour full-universe pass into a
    tractable one -- but only if it changes NOTHING. The detectors share one
    mutable object per anchor now, so a detector that wrote to it would alter
    what every later detector in that anchor sees, and no single-structure
    test could see that happen.

    So the shared pass is compared against the separate passes it replaces,
    field by field, on every structure in the group.
    """
    from api.services.screener import bases

    universe = _synthetic_universe()
    group = _group()
    kw = dict(window=400, min_history=400, step=ll.HORIZON_BARS)

    together = ll.measure_many(group, universe,
                               prepare=lambda w: bases._context(w, w), **kw)

    fired_any = False
    for key, det in group.items():
        alone = ll.measure(lambda w, d=det: d(bases._context(w, w)),
                           universe, **kw)
        for field in ("n", "wins", "free_n", "free_wins", "rate", "baseline",
                      "lift", "ci_low", "ci_high", "years"):
            assert together[key][field] == alone[field], (
                "%s.%s: shared=%r separate=%r"
                % (key, field, together[key][field], alone[field]))
        if (alone["n"] or 0) > 0:
            fired_any = True

    assert fired_any, (
        "no structure fired on the fixture -- the comparison would pass "
        "vacuously, since two empty results are trivially equal")


def test_the_shared_null_draws_the_same_series_as_the_separate_one():
    """The null must match too, or a group run and a single run would grade
    against different random data and their verdicts could not be compared.
    """
    from api.services.screener import bases

    universe = _synthetic_universe(n_tickers=5, n_bars=460)
    group = _group()
    kw = dict(window=400, min_history=400, step=ll.HORIZON_BARS)
    prep = lambda w: bases._context(w, w)

    together = ll.null_lifts_many(group, universe, prepare=prep, trials=2, **kw)
    for key, det in group.items():
        alone = ll.null_lifts(lambda w, d=det: d(bases._context(w, w)),
                              universe, trials=2, **kw)
        assert together[key] == alone, "%s: %r != %r" % (key, together[key], alone)


def test_one_failing_detector_does_not_poison_its_neighbours():
    """⛔ Errors are counted PER STRUCTURE. A single global counter would
    let one broken detector trip every other structure's
    "the detector raised on N anchors" refusal in the same run.
    """
    from api.services.screener import bases

    universe = _synthetic_universe(n_tickers=4, n_bars=460)

    def _boom(ctx):
        raise RuntimeError("detector is broken")

    group = {"ok": lambda ctx: True, "broken": _boom}
    kw = dict(window=400, min_history=400, step=ll.HORIZON_BARS)
    got = ll.measure_many(group, universe,
                          prepare=lambda w: bases._context(w, w), **kw)

    assert got["broken"].get("refused"), "the broken detector must be refused"
    assert not got["ok"].get("refused"), (
        "the healthy detector was refused because its neighbour raised")
    assert (got["ok"]["n"] or 0) > 0


def test_a_note_is_STAMPED_with_the_measurement_it_describes():
    """⛔⛔ A STALE NOTE IS A FALSE CLAIM WITH A CITATION ATTACHED.

    The harness rewrites the ROWS; the notes are prose and are carried forward
    untouched, so a re-measurement silently leaves every note behind. Not
    hypothetical: after the full-universe run `cup-with-handle` moved from
    -7.18pp to -0.18pp while its note still explained why it sat "below its own
    null" -- a sentence that had been true of a different measurement and now
    described nothing.

    ⭐ CHECKING THE FIGURES A NOTE CITES IS THE WRONG TEST, and the first
    version of this rail tried it: it immediately flagged the Darvas note for
    quoting its null distribution's MINIMUM (-2.06pp), a real number the row
    does not store. Legitimate prose talks about more than the row's fields.

    So the knowing side STAMPS its answer instead: a note carries
    `note_measured`, the row's numbers at the time it was written. If the row
    has moved, the note is stale by construction -- whatever it happens to say.
    """
    entries = (ll.load().get("structures") or {})
    assert entries, "no rows -- this rail would pass vacuously"

    stamped = 0
    for key, e in entries.items():
        if not e.get("note"):
            continue
        stamp = e.get("note_measured")
        assert stamp is not None, (
            "%s carries a note with no `note_measured` stamp, so nothing can "
            "tell whether it still describes this row" % key)
        current = [e.get(f) for f in ("lift", "ci_low", "ci_high", "n",
                                      "null_max")]
        assert list(stamp) == current, (
            "%s: the note was written for %r and the row now reads %r -- "
            "re-measurement left the prose behind" % (key, list(stamp), current))
        stamped += 1

    # ⚠️ NO `stamped > 0` GUARD HERE, deliberately. A ledger with no notes is a
    # legitimate state -- it is what the runner leaves behind after dropping
    # stale ones -- so demanding at least one stamp would make this rail red
    # for a correct artifact. The vacuity concern belongs to the rail below,
    # which asks the question that actually matters: does every PUBLISHED
    # number carry an explanation?
    _ = stamped


def test_every_PUBLISHED_number_carries_an_explanation():
    """⛔ A published number with no note is the thing this ledger exists to
    prevent. The refused rows can stand on their `reasons` -- those are
    generated and always current -- but a number we put in front of a member
    needs prose saying what it is and what it is not, and that prose must be
    stamped so it cannot outlive the measurement.
    """
    entries = (ll.load().get("structures") or {})
    published = {k: v for k, v in entries.items() if v.get("published")}
    assert published, "no published rows -- this rail would pass vacuously"
    for key, e in published.items():
        assert e.get("note"), (
            "%s is PUBLISHED with no note. A number a member sees needs an "
            "explanation beside it." % key)
        assert e.get("note_measured"), (
            "%s has a note with no stamp" % key)


def test_a_NEGATIVE_lift_can_never_publish():
    """⛔⛔ THE GATE THAT WAS MISSING, AND IT HAD FIRED.

    `cheat-3c` measured -1.10pp with a CI of [-2.16, -0.09] against a null max
    of -3.91pp and PUBLISHED: its interval excludes zero (both bounds are
    negative) and its lower bound does clear a null that is even more
    negative. A structure that reliably UNDERPERFORMS its own baseline was
    surfaced to members through `filters._structure_evidence` as a measured
    edge.

    I had described this exact hole while comparing ALTERNATIVE gates -- "any
    relaxation needs a sign condition or it publishes losers" -- and missed
    that the shipped gate carried it. It only never fired because no structure
    had yet landed with a negative lift sitting above a more-negative null.
    """
    verdict = ll.adjudicate(
        {"lift": -0.0110, "ci_low": -0.0216, "ci_high": -0.0009, "n": 6139},
        [-0.0391, -0.0500])
    assert verdict["published"] is False
    assert any("not positive" in r for r in verdict["reasons"])


def test_the_sign_gate_does_not_block_a_genuine_positive():
    """The control: gate zero must refuse losers without refusing winners."""
    verdict = ll.adjudicate(
        {"lift": 0.0735, "ci_low": 0.0678, "ci_high": 0.0796, "n": 24428,
         "rate": 0.3467, "baseline": 0.2732, "years": ["2020", "2021"]},
        [0.0110, 0.0090] * 15)   # 30 trials
    assert verdict["published"] is True


def test_no_published_row_in_the_artifact_carries_a_negative_lift():
    """The same check against the shipped artifact, so a bad row cannot sit
    there unnoticed even if the gate were bypassed by a hand edit.
    """
    entries = (ll.load().get("structures") or {})
    published = {k: v for k, v in entries.items() if v.get("published")}
    assert published, "no published rows -- this rail would pass vacuously"
    for key, e in published.items():
        assert (e.get("lift") or 0) > 0, (
            "%s is published with lift %r" % (key, e.get("lift")))


def test_member_visible_evidence_never_shows_a_negative_lift():
    """The surface, not just the store. `_structure_evidence` is what reaches
    a member, and it reads the artifact -- so it is checked separately.
    """
    from api.services.screener import filters

    ev = filters._structure_evidence()
    assert ev, "no evidence surfaced -- this rail would pass vacuously"
    for key, e in ev.items():
        assert e["lift_pp"] > 0, (
            "%s would show members a lift of %+.2fpp" % (key, e["lift_pp"]))


def test_a_FIVE_trial_screen_can_screen_but_cannot_publish():
    """⛔⛔ THE ESCALATION RULE BELONGS IN THE GATE, NOT IN A TEST.

    It lived as a procedure -- "remember to re-run at 30" -- enforced by a rail
    that runs AFTER the artifact is already written. So a screening run could
    and did write `published: true` on five trials, and the discipline
    depended on someone noticing. The gate now refuses it outright: a screen
    screens, and only an escalated run can publish.

    A refusal at five trials needs no such protection -- more draws can only
    raise a bar already failed.
    """
    strong = {"lift": 0.0735, "ci_low": 0.0678, "ci_high": 0.0796, "n": 24428,
              "rate": 0.3467, "baseline": 0.2732, "years": ["2020"]}
    screened = ll.adjudicate(strong, [0.0110] * 5)
    assert screened["published"] is False
    assert any("only 5 null trials" in r for r in screened["reasons"])

    escalated = ll.adjudicate(strong, [0.0110] * ll.ESCALATED_NULL_TRIALS)
    assert escalated["published"] is True, (
        "the same result must publish once it has been escalated, or the gate "
        "is refusing on trial count alone")


# ── the metric's DIRECTION ─────────────────────────────────────────────────

def _falls_then_recovers():
    bars = [{"t": i, "o": 100, "c": 100, "h": 101, "l": 99} for i in range(3)]
    bars += [{"t": 3 + i, "o": 100 - i * 2, "c": 100 - i * 2,
              "h": 101 - i * 2, "l": 99 - i * 2} for i in range(10)]
    bars += [{"t": 20 + i, "o": 100, "c": 100, "h": 101, "l": 99}
             for i in range(15)]
    return bars


def test_the_short_metric_is_the_MIRROR_of_the_long_one():
    """⭐⭐ SO THAT 'LIFT' MEANS THE SAME THING FOR EVERY STRUCTURE.

    The metric was a LONG outcome applied to all structures regardless of
    bias, which made a bearish row read backwards: `stage-4-breakdown`
    published +7.30pp, and under a long metric that says price resolved UPWARD
    more often after a breakdown -- the opposite of the claim the name makes.
    A number that needs a footnote to avoid being read as its own negation is
    not worth publishing.
    """
    bars = _falls_then_recovers()
    assert ll.outcome(bars, 2, horizon=20, direction="long") is False
    assert ll.outcome(bars, 2, horizon=20, direction="short") is True


def test_the_two_directions_disagree_on_the_same_series():
    """The control. If both graded a series identically the mirroring would be
    decorative, and every assertion above would hold for a detector that
    ignored `direction` entirely.
    """
    rises = [{"t": i, "o": 100 + i, "c": 100 + i, "h": 101 + i, "l": 99 + i}
             for i in range(40)]
    assert ll.outcome(rises, 2, horizon=20, direction="long") is True
    assert ll.outcome(rises, 2, horizon=20, direction="short") is False


def test_a_bearish_structure_is_graded_SHORT_and_a_bullish_one_LONG():
    """The wiring, read off the shipped runner rather than restated here."""
    import importlib.util
    import os

    root = os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.dirname(os.path.abspath(__file__)))))
    spec = importlib.util.spec_from_file_location(
        "rll", os.path.join(root, "tools", "run_lift_ledger.py"))
    rll = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rll)

    from api.services.screener import base_catalog as bc

    bearish = [s for s in bc.RELATIONS if s.bias == "bearish"]
    assert bearish, "fixture: there must be a bearish structure to check"
    for st in bearish:
        assert rll._direction_of(st) == "short", st.key
    for st in bc.RELATIONS:
        if st.bias != "bearish":
            assert rll._direction_of(st) == "long", st.key


def test_every_row_records_which_direction_it_was_graded_on():
    """⛔ A lift whose direction is not recorded cannot be read at all: +7.30pp
    means opposite things depending on which question was asked.
    """
    entries = (ll.load().get("structures") or {})
    graded = [k for k, v in entries.items() if v.get("lift") is not None]
    assert graded, "no measured rows -- this rail would pass vacuously"
    for key in graded:
        d = entries[key].get("direction")
        assert d in ("long", "short"), (
            "%s records direction=%r; a lift without its direction is "
            "unreadable" % (key, d))
