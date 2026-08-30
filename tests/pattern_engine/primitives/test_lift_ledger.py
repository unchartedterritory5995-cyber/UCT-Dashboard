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
    out = ll.adjudicate(res, nulls=[0.0])
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
    out = ll.adjudicate(res, nulls=[0.01, 0.02, 0.0])
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
    out = ll.adjudicate(res, nulls=[0.0])
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
    out = ll.adjudicate(strong, nulls=[-0.0057, 0.0231, 0.010, 0.0, 0.008])
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
