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

def test_shuffling_preserves_the_return_multiset_and_destroys_order():
    bars = _series([100.0 * (1.01 ** i) * (0.98 if i % 5 == 0 else 1.0)
                    for i in range(60)])
    out = ll.shuffle_returns(bars, random.Random(1))
    assert len(out) == len(bars)

    def rets(bs):
        return sorted(round(bs[i]["c"] / bs[i - 1]["c"], 10)
                      for i in range(1, len(bs)))
    assert rets(out) == rets(bars), "the return multiset must be preserved"
    assert [b["c"] for b in out] != [b["c"] for b in bars], "order must change"


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
