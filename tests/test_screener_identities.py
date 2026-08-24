"""Rails for `api/services/screener/identities.py`.

⭐ WHAT THESE TESTS PROTECT, AND WHY THE SHAPE IS UNUSUAL

The module under test exists because ~9,600 tests that assert *what the code
does* were blind to thirty columns saying the wrong thing. A test suite for a
value-verification module therefore has to avoid the same trap: it is not enough
to check that `run()` returns a dict with the right keys.

Three properties are load-bearing and each has a test that goes RED when it is
broken:

1. **Every identity can actually fire.** `_CASES` pairs each identity with a row
   that satisfies it and a row that violates it, and `test_every_identity_has_a
   _case` DERIVES the required key set from `IDENTITIES` itself — so a new
   identity fails the suite until somebody proves it can go red. An identity
   nobody has seen fail is not a rail (`lesson_gate_that_cannot_fail`).

2. **A NULL operand is never a pass.** This is the whole point of the module.
   Two tests hold it: one on absence, one on NaN, plus the gate case that keeps
   a loss-maker out of `roe >= roa` instead of counting it as a violation.

3. **The list is derived, not typed.** The percent family comes from
   `filters.FILTERS`'s own `unit` declaration; the test injects a synthetic
   column and watches the identity appear.

⛔ These tests never touch `C:\\data`. The one filesystem test writes its own
SQLite file under pytest's `tmp_path`.
"""
import json
import math
import sqlite3

import pytest

from api.services.screener import identities as I


# ─────────────────────────────────────────────────────────────────────────────
#  One satisfying row and one violating row per identity.
#  The generated families build their cases from the SAME dictionaries the
#  module generates the identities from, so the two can never drift.
# ─────────────────────────────────────────────────────────────────────────────

_CASES: dict[str, tuple[dict, dict]] = {
    # windows ────────────────────────────────────────────────────────────
    "dist_20d_high_ge_52w_high": (
        {"dist_20d_high_pct": -2.0, "dist_52w_high_pct": -10.0},
        {"dist_20d_high_pct": -10.0, "dist_52w_high_pct": -2.0}),
    "dist_52w_high_ge_ath": (
        {"dist_52w_high_pct": -10.0, "dist_ath_pct": -40.0},
        {"dist_52w_high_pct": -40.0, "dist_ath_pct": -10.0}),
    "dist_52w_low_ge_20d_low": (
        {"dist_52w_low_pct": 80.0, "dist_20d_low_pct": 5.0},
        {"dist_52w_low_pct": 5.0, "dist_20d_low_pct": 80.0}),
    "dist_52w_high_not_positive": (
        {"dist_52w_high_pct": -3.5}, {"dist_52w_high_pct": 4.2}),
    "dist_52w_low_not_negative": (
        {"dist_52w_low_pct": 12.0}, {"dist_52w_low_pct": -12.0}),
    "dist_20d_high_not_positive": (
        {"dist_20d_high_pct": -1.0}, {"dist_20d_high_pct": 1.0}),
    "dist_ath_not_positive": (
        {"dist_ath_pct": -55.0}, {"dist_ath_pct": 0.5}),
    "close_at_52w_high_implies_flag": (
        {"dist_52w_high_pct": 0.0, "new_52w_high": 1},
        {"dist_52w_high_pct": 0.0, "new_52w_high": 0}),
    "close_at_ath_implies_flag": (
        {"dist_ath_pct": 0.0, "new_ath": 1},
        {"dist_ath_pct": 0.0, "new_ath": 0}),

    # returns ────────────────────────────────────────────────────────────
    "gap_times_intraday_is_daily": (
        {"gap_pct": 1.0, "chg_from_open_pct": 2.0, "chg_pct_1d": 3.02},
        {"gap_pct": 1.0, "chg_from_open_pct": 2.0, "chg_pct_1d": 5.0}),
    "daily_change_matches_prev_close": (
        {"chg_pct_1d": 3.02, "price": 103.02, "prev_day_close": 100.0},
        {"chg_pct_1d": 1.00, "price": 103.02, "prev_day_close": 100.0}),

    # moving averages ────────────────────────────────────────────────────
    "above_50sma_agrees_with_pct": (
        {"above_50sma": 1, "pct_vs_sma50": 3.0},
        {"above_50sma": 0, "pct_vs_sma50": 3.0}),
    "ma_stack_full_bull_is_above_all": (
        {"ma_stack": "full-bull", "pct_vs_sma20": 1.0,
         "pct_vs_sma50": 4.0, "pct_vs_sma200": 9.0},
        {"ma_stack": "full-bull", "pct_vs_sma20": 1.0,
         "pct_vs_sma50": 4.0, "pct_vs_sma200": -9.0}),
    "ma_stack_bear_is_below_all": (
        {"ma_stack": "bear", "pct_vs_sma20": -1.0,
         "pct_vs_sma50": -4.0, "pct_vs_sma200": -9.0},
        {"ma_stack": "bear", "pct_vs_sma20": 1.0,
         "pct_vs_sma50": -4.0, "pct_vs_sma200": -9.0}),
    "atr_extension_closes_with_sma50_distance": (
        # pct_vs_sma50 = 10 -> (close-sma50)/close = 0.1/1.1 = 0.090909
        # atr_pct = 3 -> atr_ext must be 0.090909/0.03 = 3.03
        {"atr_ext_sma50": 3.03, "atr_pct": 3.0, "pct_vs_sma50": 10.0},
        {"atr_ext_sma50": 6.06, "atr_pct": 3.0, "pct_vs_sma50": 10.0}),

    # candles ────────────────────────────────────────────────────────────
    "candle_parts_close_to_one": (
        {"body_pct": 0.5, "upper_wick_pct": 0.3, "lower_wick_pct": 0.2},
        {"body_pct": 0.5, "upper_wick_pct": 0.3, "lower_wick_pct": 0.0}),
    "close_position_inside_body_and_lower_wick": (
        {"close_position": 0.7, "lower_wick_pct": 0.2, "body_pct": 0.5},
        {"close_position": 0.95, "lower_wick_pct": 0.2, "body_pct": 0.5}),

    # bars ───────────────────────────────────────────────────────────────
    "prev_day_ohlc_ordered": (
        {"prev_day_open": 10.0, "prev_day_high": 11.0,
         "prev_day_low": 9.0, "prev_day_close": 10.5},
        {"prev_day_open": 10.0, "prev_day_high": 10.2,
         "prev_day_low": 9.0, "prev_day_close": 10.5}),

    # indicators ─────────────────────────────────────────────────────────
    "rsi_in_range": ({"rsi14": 55.0}, {"rsi14": 120.0}),
    "uct_composite_in_range": ({"uct_composite": 50}, {"uct_composite": 150}),
    "rs_rank_in_range": ({"rs_rank": 50}, {"rs_rank": -5}),

    # size ───────────────────────────────────────────────────────────────
    "dollar_volume_is_price_times_volume": (
        {"dollar_vol_30d": 1e7, "price": 10.0, "avg_volume_30d": 1e6},
        {"dollar_vol_30d": 2e7, "price": 10.0, "avg_volume_30d": 1e6}),
    "shares_outstanding_ge_float": (
        {"shares_outstanding": 1e9, "float_shares": 8e8},
        {"shares_outstanding": 8e8, "float_shares": 1e9}),
    "float_pct_matches_share_counts": (
        {"float_pct": 80.0, "float_shares": 8e8, "shares_outstanding": 1e9},
        {"float_pct": 50.0, "float_shares": 8e8, "shares_outstanding": 1e9}),
    "market_cap_is_price_times_shares": (
        {"market_cap": 1e10, "price": 10.0, "shares_outstanding": 1e9},
        {"market_cap": 5e9, "price": 10.0, "shares_outstanding": 1e9}),

    # fundamentals — the two the audit's own identities caught ───────────
    "gross_margin_ge_op_margin": (
        {"gross_margin": 60.0, "op_margin": 20.0},
        # PLD's published pair, 2026-08-23: arithmetically impossible.
        {"gross_margin": 29.05, "op_margin": 38.43}),
    "roe_ge_roa_when_both_positive": (
        {"roe": 10.0, "roa": 5.0},
        # GBLI's published pair: ROE wrong by 248x.
        {"roe": 0.019, "roa": 1.99}),
    "insider_plus_institutional_within_100": (
        {"insider_own_pct": 5.0, "inst_pct": 80.0},
        {"insider_own_pct": 30.0, "inst_pct": 90.0}),
    "price_target_upside_matches_target": (
        {"pt_upside_pct": 20.0, "pt_target": 120.0, "price": 100.0},
        {"pt_upside_pct": 5.0, "pt_target": 120.0, "price": 100.0}),

    # events ─────────────────────────────────────────────────────────────
    "days_to_earnings_matches_date": (
        {"days_to_earnings": 7, "next_earnings_date": "2026-08-30",
         "snapshot_date": "2026-08-23"},
        {"days_to_earnings": 3, "next_earnings_date": "2026-08-30",
         "snapshot_date": "2026-08-23"}),

    # flow ───────────────────────────────────────────────────────────────
    "dp_5d_notional_ge_1d": (
        {"dp_notional_5d": 1e6, "dp_notional_1d": 1e5},
        {"dp_notional_5d": 1e4, "dp_notional_1d": 1e5}),
    "dp_notional_within_session_tape": (
        {"dp_notional_1d": 1_000.0, "session_dollar_vol": 10_000.0},
        {"dp_notional_1d": 20_000.0, "session_dollar_vol": 10_000.0}),
    "bull_share_agrees_with_net_premium": (
        {"opt_bull_pct_1d": 60.0, "opt_net_premium_1d": 100.0},
        {"opt_bull_pct_1d": 60.0, "opt_net_premium_1d": -100.0}),
}


def _generated_cases() -> dict[str, tuple[dict, dict]]:
    """Cases for the generated families, built from the module's OWN sources.

    ⭐ Reading `I._SHARE_OF_TOTAL` / `I._NON_NEGATIVE` / `I._UNIT_FRACTION` /
    `I.percent_columns()` rather than retyping their members is the same rule
    the module itself follows: derive, never restate. Add a column to one of
    those dicts and its case appears here automatically.
    """
    out: dict[str, tuple[dict, dict]] = {}
    for col in I._SHARE_OF_TOTAL:
        out[f"share_band__{col}"] = ({col: 50.0}, {col: 150.0})
    for col in I._NON_NEGATIVE:
        out[f"non_negative__{col}"] = ({col: 1.0}, {col: -1.0})
    for col in I._UNIT_FRACTION:
        out[f"fraction_band__{col}"] = ({col: 0.5}, {col: 1.5})
    for col in I.percent_columns():
        out[f"pct_magnitude__{col}"] = ({col: 10.0}, {col: 9.9e9})
    return out


def _all_cases() -> dict[str, tuple[dict, dict]]:
    cases = dict(_generated_cases())
    cases.update(_CASES)
    return cases


def _by_name() -> dict[str, I.Identity]:
    return {i.name: i for i in I.IDENTITIES}


def _one(ident: I.Identity, row: dict) -> dict:
    return I.run([row], identities=[ident])["results"][0]


# ─────────────────────────────────────────────────────────────────────────────
#  1. Completeness — a new identity cannot ship untested
# ─────────────────────────────────────────────────────────────────────────────

def test_every_identity_has_a_case():
    """Derived from `IDENTITIES`, never a typed list.

    ⛔ If this fails because you added an identity, the fix is a case in
    `_CASES`, not a name in an allowlist. An identity nobody has watched fire
    is decoration.
    """
    declared = {i.name for i in I.IDENTITIES}
    covered = set(_all_cases())
    assert declared - covered == set(), (
        "identities with no satisfying/violating case: "
        f"{sorted(declared - covered)}")
    assert covered - declared == set(), (
        f"cases for identities that no longer exist: {sorted(covered - declared)}")


@pytest.mark.parametrize("name", sorted(_all_cases()))
def test_identity_passes_its_satisfying_row_and_fails_its_violating_row(name):
    """The control lives INSIDE the test: the same identity must go both ways.

    A test that only checks the happy row would pass against a predicate that
    can never fire — which is precisely how thirty wrong columns survived a
    green suite.
    """
    ident = _by_name()[name]
    sat, viol = _all_cases()[name]

    ok = _one(ident, sat)
    assert ok["checkable"] == 1, f"{name}: satisfying row was not checkable: {ok}"
    assert ok["violated"] == 0, f"{name}: satisfying row was flagged: {ok['worst']}"

    bad = _one(ident, viol)
    assert bad["checkable"] == 1, f"{name}: violating row was not checkable: {bad}"
    assert bad["violated"] == 1, f"{name}: violating row was NOT caught"
    assert bad["worst"][0]["over_tolerance"] > 0


# ─────────────────────────────────────────────────────────────────────────────
#  2. Honest-None — the rule the whole module exists to hold
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("missing", ["gross_margin", "op_margin"])
def test_a_null_operand_is_neither_a_pass_nor_a_violation(missing):
    ident = _by_name()["gross_margin_ge_op_margin"]
    row = {"ticker": "T", "gross_margin": 60.0, "op_margin": 20.0}
    row[missing] = None
    r = _one(ident, row)
    assert r["checkable"] == 0
    assert r["satisfied"] == 0
    assert r["violated"] == 0
    assert r["skipped_null"] == 1
    assert r["null_by_column"] == {missing: 1}


def test_an_absent_column_is_reported_as_absent_not_as_null():
    """'The column is not in this data' and 'the column is NULL here' are
    different facts. Folding them is how a missing artifact reads as an empty
    column — the exact confusion the audit's provenance note had to correct."""
    ident = _by_name()["dp_notional_within_session_tape"]
    r = _one(ident, {"ticker": "T", "dp_notional_1d": 1.0})
    assert r["checkable"] == 0 and r["skipped_null"] == 1
    assert r["columns_absent_from_data"] == ["session_dollar_vol"]


def test_a_nan_is_its_own_bucket_and_never_a_pass():
    """A NaN in a REAL column is a defect, not an absence. `is None` reports it
    as healthy, so it gets counted separately and visibly."""
    ident = _by_name()["rsi_in_range"]
    r = _one(ident, {"ticker": "T", "rsi14": float("nan")})
    assert r["checkable"] == 0
    assert r["skipped_nonfinite"] == 1
    assert r["skipped_null"] == 0
    assert r["violated"] == 0


def test_the_gate_excludes_a_loss_maker_rather_than_flagging_it():
    """⭐ THE MOST IMPORTANT GATE IN THE TABLE.

    `roe >= roa` reverses for a loss-maker: the same negative net income over
    the smaller denominator is MORE negative, so a perfectly correct row would
    read as a violation. Without this gate the identity would fire on every
    unprofitable company in the universe and be switched off within a week.
    """
    ident = _by_name()["roe_ge_roa_when_both_positive"]
    r = _one(ident, {"ticker": "RIVN", "roe": -60.0, "roa": -21.35})
    assert r["skipped_gate"] == 1
    assert r["checkable"] == 0 and r["violated"] == 0
    assert "REVERSES" in ident.gate_why


def test_new_high_implication_runs_one_way_only():
    """An intraday new high that fades is ordinary, not a defect.

    `new_52w_high` compares today's HIGH to the window maximum while
    `dist_52w_high_pct` compares today's CLOSE, so the flag can legitimately be
    set on a row whose close is below the high. Asserting the converse would
    flag every fade.
    """
    ident = _by_name()["close_at_52w_high_implies_flag"]
    r = _one(ident, {"ticker": "T", "dist_52w_high_pct": -1.5, "new_52w_high": 1})
    assert r["violated"] == 0, "an intraday new high that faded was flagged"


# ─────────────────────────────────────────────────────────────────────────────
#  3. The receipt must close, or refuse to exist
# ─────────────────────────────────────────────────────────────────────────────

def test_receipt_arithmetic_closes_on_every_identity():
    rows = [
        {"ticker": "A", "gross_margin": 60.0, "op_margin": 20.0, "rsi14": 55.0},
        {"ticker": "B", "gross_margin": None, "op_margin": 20.0},
        {"ticker": "C", "gross_margin": 10.0, "op_margin": 40.0,
         "rsi14": float("nan")},
        {"ticker": "D", "roe": -1.0, "roa": -2.0},
    ]
    rec = I.run(rows)
    assert rec["rows_seen"] == 4
    for r in rec["results"]:
        assert (r["checkable"] + r["skipped_null"] + r["skipped_nonfinite"]
                + r["skipped_gate"]) == 4, r["name"]
        assert r["checkable"] == r["satisfied"] + r["violated"], r["name"]


def test_a_receipt_that_does_not_close_is_refused():
    """The control for the closure guard: a tally that cannot add up must raise
    rather than publish. Mirrors `scan_evaluator._assert_coverage_closes` —
    a receipt nobody can reconcile reads as measurement and is worse than none.
    """
    liar = I.Identity(
        name="deliberately_broken", family="test",
        statement="x", why="x", columns=("v",),
        # Silently drops a row from the tally by raising inside `excess`? No —
        # errors are counted. Instead force the guard directly.
        excess=lambda r: 0.0,
        tol=I.Tol(value=0.0, why="test"))
    rec = I.run([{"v": 1.0}], identities=[liar])
    assert rec["results"][0]["checkable"] == 1
    # Now break the invariant the guard protects and confirm it fires.
    import dataclasses
    broken = dataclasses.replace(liar, excess=lambda r: 0.0)
    orig = I._Tally.__init__

    def _skewed(self, *a, **k):
        orig(self, *a, **k)
        self.skipped_gate = 99          # a count that belongs to no row

    I._Tally.__init__ = _skewed
    try:
        with pytest.raises(I.IdentityReceiptError):
            I.run([{"v": 1.0}], identities=[broken])
    finally:
        I._Tally.__init__ = orig


def test_a_predicate_that_raises_is_a_violation_not_a_pass():
    boom = I.Identity(
        name="raises", family="test", statement="x", why="x",
        columns=("v",), excess=lambda r: 1 / 0,
        tol=I.Tol(value=0.0, why="test"))
    r = _one(boom, {"ticker": "T", "v": 1.0})
    assert r["violated"] == 1 and r["predicate_errors"] == 1
    assert "ZeroDivisionError" in r["worst"][0]["error"]


# ─────────────────────────────────────────────────────────────────────────────
#  4. Structural rules on the table itself
# ─────────────────────────────────────────────────────────────────────────────

def test_every_identity_states_its_proof_and_its_tolerance_reason():
    """⭐ A tolerance without a justification is a guess, and this repo has been
    burned by guessed constants (`lesson_relative_tolerance_on_a_ratio_near_one`).
    The rule is enforced structurally, so it cannot be skipped in review."""
    for i in I.IDENTITIES:
        assert i.statement.strip(), i.name
        assert len(i.why.strip()) > 30, f"{i.name}: the proof is too thin"
        assert len(i.tol.why.strip()) > 30, f"{i.name}: tolerance has no reason"
        assert i.severity in ("proof", "advisory")
        if i.gate is not None:
            assert len(i.gate_why.strip()) > 20, f"{i.name}: gate has no reason"


def test_identity_names_are_unique():
    names = [i.name for i in I.IDENTITIES]
    assert len(names) == len(set(names))


def test_a_tolerance_needs_a_reason_and_exactly_one_form():
    with pytest.raises(ValueError):
        I.Tol(why="", value=1.0)
    with pytest.raises(ValueError):
        I.Tol(why="both", value=1.0, per_row=lambda r: 1.0)
    with pytest.raises(ValueError):
        I.Tol(why="neither")


def test_a_gate_without_a_reason_is_refused():
    with pytest.raises(ValueError):
        I.Identity(name="x", family="f", statement="s", why="w",
                   columns=("a",), excess=lambda r: 0.0,
                   tol=I.Tol(value=0.0, why="t"), gate=lambda r: True)


def test_a_duplicate_identity_name_is_refused():
    dup = I.band("dupe", "f", "a", 0, 1, "s", "w", I.Tol(value=0, why="t"))
    with pytest.raises(ValueError):
        I._assert_unique([dup, dup])


# ─────────────────────────────────────────────────────────────────────────────
#  5. The derivation — the list is not hand-typed
# ─────────────────────────────────────────────────────────────────────────────

def test_percent_family_is_derived_from_the_filter_registry(monkeypatch):
    """Inject a synthetic percent filter and watch the identity appear.

    ⛔ The control matters: if `percent_columns()` were a typed list, the
    injected column would NOT show up and this test goes red. That is the whole
    claim — one writer per value, derived never restated.
    """
    from api.services.screener import filters
    fake = dict(filters.FILTERS)
    fake["zzz_synthetic"] = {"label": "Z", "category": "technical",
                             "type": "range", "column": "zzz_synthetic_col",
                             "presets": [], "allow_custom": True,
                             "unit": "%", "options_column": None}
    monkeypatch.setattr(filters, "FILTERS", fake)
    assert "zzz_synthetic_col" in I.percent_columns()
    names = {i.name for i in I.build_identities()}
    assert "pct_magnitude__zzz_synthetic_col" in names


def test_percent_family_ignores_a_column_the_registry_does_not_call_a_percent(
        monkeypatch):
    from api.services.screener import filters
    fake = dict(filters.FILTERS)
    fake["zzz_ratio"] = {"label": "Z", "category": "technical", "type": "range",
                         "column": "zzz_ratio_col", "presets": [],
                         "allow_custom": True, "unit": None,
                         "options_column": None}
    monkeypatch.setattr(filters, "FILTERS", fake)
    assert "zzz_ratio_col" not in I.percent_columns()


def test_payout_ratio_is_deliberately_not_banded_at_100():
    """A REIT distributing more than GAAP earnings is correct, not broken.

    The fundamentals lane measured O at 226.88% payout against yfinance's
    236.42% and adjudicated ours right. Banding it would fire on every REIT —
    a refusal that flags correct data gets switched off, and then the real
    ones go with it.
    """
    assert "payout_ratio" not in I._SHARE_OF_TOTAL
    assert "share_band__payout_ratio" not in {i.name for i in I.IDENTITIES}
    r = _one(_by_name()["pct_magnitude__payout_ratio"], {"payout_ratio": 226.88})
    assert r["violated"] == 0


# ─────────────────────────────────────────────────────────────────────────────
#  6. The per-row tolerance is genuinely per-row
# ─────────────────────────────────────────────────────────────────────────────

def test_the_atr_tolerance_scales_with_the_row():
    """A constant would manufacture phantoms at small ATR.

    Measured on the 2026-08-23 snapshot: the propagated 2-dp bound gives 0
    violations over 3,706 rows where a constant 0.0005 gives 34.
    """
    ident = _by_name()["atr_extension_closes_with_sma50_distance"]
    small = {"atr_ext_sma50": 1.0, "atr_pct": 1.0, "pct_vs_sma50": 1.0}
    large = {"atr_ext_sma50": 20.0, "atr_pct": 40.0, "pct_vs_sma50": 60.0}
    assert ident.tol.for_row(large) > ident.tol.for_row(small) * 5
    assert ident.tol.describe()["kind"] == "per-row"
    assert ident.tol.describe()["value"] is None


def test_a_zero_atr_is_excluded_rather_than_counted():
    ident = _by_name()["atr_extension_closes_with_sma50_distance"]
    r = _one(ident, {"atr_ext_sma50": 0.0, "atr_pct": 0.0, "pct_vs_sma50": 5.0})
    assert r["skipped_gate"] == 1 and r["checkable"] == 0


# ─────────────────────────────────────────────────────────────────────────────
#  7. The receipt as a member-grade artifact
# ─────────────────────────────────────────────────────────────────────────────

def test_worst_offenders_are_named_and_ranked():
    ident = _by_name()["gross_margin_ge_op_margin"]
    rows = [
        {"ticker": "MILD", "gross_margin": 30.0, "op_margin": 31.0},
        {"ticker": "PLD", "gross_margin": 29.05, "op_margin": 38.43},
        {"ticker": "FINE", "gross_margin": 60.0, "op_margin": 20.0},
    ]
    r = I.run(rows, identities=[ident])["results"][0]
    assert [w["ticker"] for w in r["worst"]] == ["PLD", "MILD"]
    assert r["worst"][0]["values"] == {"gross_margin": 29.05, "op_margin": 38.43}


def test_an_as_of_mix_is_never_published_as_a_single_date():
    """⛔ Reading the as-of off the first row is the audit's own finding #4
    restated inside the auditor. A mixed population names no date at all."""
    rows = [{"ticker": "A", "snapshot_date": "2026-08-23", "bars_asof": "20260821"},
            {"ticker": "B", "snapshot_date": "2026-08-23", "bars_asof": "20260618"}]
    rec = I.run(rows)
    assert rec["snapshot_date"] == "2026-08-23"
    assert rec["bars_asof"] is None
    assert rec["bars_asof_mix"] == {"20260821": 1, "20260618": 1}
    assert "MIXED across 2 values" in I.format_report(rec)


def test_the_report_names_the_not_checkable_identities_as_not_a_pass():
    rec = I.run([{"ticker": "A", "rsi14": 50.0}])
    text = I.format_report(rec)
    assert "NOT CHECKABLE ON THIS DATA" in text
    assert "This is NOT a pass" in text
    assert "gross_margin_ge_op_margin" in rec["identities_not_checkable_here"]


def test_receipt_is_json_serialisable():
    rec = I.run([{"ticker": "A", "rsi14": 50.0}])
    json.loads(json.dumps(rec, default=str))


# ─────────────────────────────────────────────────────────────────────────────
#  8. Reading a real snapshot file (its own, under tmp_path)
# ─────────────────────────────────────────────────────────────────────────────

def _tiny_db(path):
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE screener_rows (ticker TEXT PRIMARY KEY, "
                 "gross_margin REAL, op_margin REAL, rsi14 REAL, "
                 "snapshot_date TEXT)")
    conn.executemany("INSERT INTO screener_rows VALUES (?,?,?,?,?)", [
        ("GOOD", 60.0, 20.0, 55.0, "2026-08-23"),
        ("PLD", 29.05, 38.43, 44.0, "2026-08-23"),
        ("NULLY", None, 20.0, None, "2026-08-23"),
    ])
    conn.commit()
    conn.close()


def test_run_over_snapshot_reads_a_file_and_reports(tmp_path):
    db = tmp_path / "screener.db"
    _tiny_db(str(db))
    rec = I.run_over_snapshot(str(db))
    assert rec["rows_seen"] == 3
    assert rec["snapshot_date"] == "2026-08-23"
    gm = next(r for r in rec["results"] if r["name"] == "gross_margin_ge_op_margin")
    assert gm["checkable"] == 2 and gm["violated"] == 1 and gm["skipped_null"] == 1
    assert gm["worst"][0]["ticker"] == "PLD"


def test_the_snapshot_read_opens_the_file_read_only(tmp_path, monkeypatch):
    """⛔ `/data` is `C:\\data` on this box — the owner's LIVE store. A module
    anyone can run by hand must not be able to create a journal sidecar there.

    The test watches the CONNECTION `read_snapshot_rows` actually opens, not a
    second one it builds itself — a test that opens its own `mode=ro` handle
    would stay green after the module dropped the flag.
    """
    db = tmp_path / "screener.db"
    _tiny_db(str(db))
    seen = {}
    real = sqlite3.connect

    def spy(target, *a, **k):
        seen["target"], seen["uri"] = target, k.get("uri")
        return real(target, *a, **k)

    monkeypatch.setattr(I.sqlite3, "connect", spy)
    rows = I.read_snapshot_rows(str(db))
    assert len(rows) == 3
    assert seen["uri"] is True, "the read must go through a URI, not a bare path"
    assert "mode=ro" in seen["target"], f"read was not read-only: {seen['target']}"

    # And the flag is load-bearing: a handle opened that way refuses a write.
    conn = real(seen["target"], uri=True)
    try:
        with pytest.raises(sqlite3.OperationalError):
            conn.execute("DELETE FROM screener_rows")
            conn.commit()
    finally:
        conn.close()


def test_cli_exit_code_separates_proof_from_advisory(tmp_path, capsys):
    db = tmp_path / "screener.db"
    _tiny_db(str(db))
    assert I.main(["--db", str(db)]) == 1            # PLD breaks a proof
    assert I.main(["--db", str(db), "--fail-on", "none"]) == 0
    out = capsys.readouterr().out
    assert "gross_margin_ge_op_margin" in out


def test_cli_reports_a_missing_database_rather_than_crashing(tmp_path, capsys):
    assert I.main(["--db", str(tmp_path / "nope.db")]) == 2
