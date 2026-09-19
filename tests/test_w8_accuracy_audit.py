"""Pytest wrapper over `docs/discord-render/instruments/w8_accuracy_audit.py`'s
pure functions.

The tool's own `--self-check` is the mutation-proof (run manually and recorded
in the evidence doc, per `docs/discord-render/instruments/d14_monitor.py`'s
convention of an operational self-check distinct from the pytest suite this
repo's gate actually collects). This file exists so the SAME cases run under
`pytest`, the thing CI/the six-shard-equivalent Python gate actually discovers,
rather than only ever being run by hand.

⛔ No network, no filesystem, no sqlite — these are the pure functions only.
The I/O runners (`run_chart_check`, `run_flow_check`, `run_buzz_check`,
`independent_buzz_tally`) need a live backend or a real buzz.db and are
exercised manually per the module docstring's `railway ssh` instruction, not
here — a fixture faking `fetch_bars`/`get_live_prices`/`buzz_boards` would only
prove the plumbing calls its own mocks correctly, not anything about accuracy.
"""
import sys
import pathlib
import importlib.util

_MODULE_PATH = (pathlib.Path(__file__).resolve().parent.parent
                / "docs" / "discord-render" / "instruments" / "w8_accuracy_audit.py")
_spec = importlib.util.spec_from_file_location("w8_accuracy_audit", _MODULE_PATH)
_w8 = importlib.util.module_from_spec(_spec)
sys.modules["w8_accuracy_audit"] = _w8
_spec.loader.exec_module(_w8)

check_ohlc_invariants = _w8.check_ohlc_invariants
check_bar_ordering = _w8.check_bar_ordering
check_chart_vs_snapshot = _w8.check_chart_vs_snapshot
check_buzz_counts = _w8.check_buzz_counts
check_flow_internal_consistency = _w8.check_flow_internal_consistency
check_flow_against_raw_tape = _w8.check_flow_against_raw_tape


class TestOhlcInvariants:
    def test_clean_bar_is_clean(self):
        assert check_ohlc_invariants({"o": 10, "h": 12, "l": 9, "c": 11, "v": 1000}) == []

    def test_high_below_close_flags(self):
        problems = check_ohlc_invariants({"o": 10, "h": 10.5, "l": 9, "c": 11, "v": 1000})
        assert "high_below_open_or_close" in problems

    def test_low_above_open_flags(self):
        problems = check_ohlc_invariants({"o": 10, "h": 12, "l": 10.5, "c": 11, "v": 1000})
        assert "low_above_open_or_close" in problems

    def test_high_below_low_flags(self):
        problems = check_ohlc_invariants({"o": 10, "h": 8, "l": 9, "c": 8.5, "v": 1000})
        assert "high_below_low" in problems

    def test_nan_close_flags_and_short_circuits(self):
        problems = check_ohlc_invariants({"o": 10, "h": 12, "l": 9, "c": float("nan"), "v": 1000})
        assert problems == ["close_nan_or_inf"]

    def test_inf_high_flags(self):
        problems = check_ohlc_invariants({"o": 10, "h": float("inf"), "l": 9, "c": 11, "v": 1000})
        assert "high_nan_or_inf" in problems

    def test_negative_volume_flags(self):
        assert "volume_negative" in check_ohlc_invariants({"o": 10, "h": 12, "l": 9, "c": 11, "v": -5})

    def test_nonpositive_close_flags(self):
        assert "close_not_positive" in check_ohlc_invariants({"o": 10, "h": 12, "l": 9, "c": 0, "v": 1})

    def test_unparseable_bar_flags(self):
        assert check_ohlc_invariants({"o": "x", "h": 12, "l": 9, "c": 11, "v": 1000}) == ["unparseable"]

    def test_missing_field_flags_unparseable(self):
        assert check_ohlc_invariants({"o": 10, "h": 12, "l": 9, "v": 1000}) == ["unparseable"]


class TestBarOrdering:
    def test_strictly_increasing_is_clean(self):
        assert check_bar_ordering([{"t": 1}, {"t": 2}, {"t": 3}]) == []

    def test_duplicate_timestamp_flags(self):
        problems = check_bar_ordering([{"t": 1}, {"t": 2}, {"t": 2}])
        assert any("duplicate_t=2" in p for p in problems)

    def test_out_of_order_timestamp_flags(self):
        problems = check_bar_ordering([{"t": 1}, {"t": 3}, {"t": 2}])
        assert any("out_of_order_t=2" in p for p in problems)

    def test_empty_series_is_clean(self):
        assert check_bar_ordering([]) == []

    def test_missing_t_flags_by_index(self):
        problems = check_bar_ordering([{"t": 1}, {}, {"t": 3}])
        assert "bar[1]_missing_t" in problems


class TestChartVsSnapshot:
    """The SMH-incident check (`discord_chart_render.compute_stats`'s own
    docstring: -3.5% on stale bars vs +0.6% live, same ticker/day)."""

    def test_agreeing_values_do_not_flag(self):
        assert check_chart_vs_snapshot(0.6, 0.5) is None

    def test_opposite_signs_flags_as_sign_mismatch(self):
        problem = check_chart_vs_snapshot(-3.5, 0.6)
        assert problem is not None
        assert "sign_mismatch" in problem

    def test_same_sign_but_far_apart_flags_as_magnitude_mismatch(self):
        problem = check_chart_vs_snapshot(0.5, 4.0)
        assert problem is not None
        assert "magnitude_mismatch" in problem

    def test_missing_live_value_is_not_computable_never_agreement(self):
        assert check_chart_vs_snapshot(-3.5, None) is None

    def test_missing_bars_value_is_not_computable(self):
        assert check_chart_vs_snapshot(None, 0.6) is None

    def test_both_missing_is_not_computable(self):
        assert check_chart_vs_snapshot(None, None) is None

    def test_small_moves_within_tolerance_do_not_flag(self):
        # Both under the 0.5pp sign-check floor and within the magnitude tolerance.
        assert check_chart_vs_snapshot(0.1, -0.1) is None

    def test_custom_tolerance_is_honored(self):
        # diff = 1.5pp: exceeds a 1.0pp tolerance, within a 2.0pp one.
        assert check_chart_vs_snapshot(1.0, 2.5, tolerance_pct=1.0) is not None
        assert check_chart_vs_snapshot(1.0, 2.5, tolerance_pct=2.0) is None


class TestBuzzCounts:
    def test_identical_maps_do_not_flag(self):
        assert check_buzz_counts({"NVDA": 5, "SPY": 2}, {"NVDA": 5, "SPY": 2}) == []

    def test_differing_count_flags(self):
        problems = check_buzz_counts({"NVDA": 5}, {"NVDA": 3})
        assert problems == ["NVDA: served=5 derived=3"]

    def test_ticker_only_on_served_side_flags(self):
        problems = check_buzz_counts({"NVDA": 5, "AMD": 1}, {"NVDA": 5})
        assert any("AMD" in p for p in problems)

    def test_ticker_only_on_derived_side_flags(self):
        problems = check_buzz_counts({"NVDA": 5}, {"NVDA": 5, "AMD": 1})
        assert any("AMD" in p for p in problems)

    def test_both_empty_is_clean(self):
        assert check_buzz_counts({}, {}) == []


class TestFlowInternalConsistency:
    """Against the REAL `_compute_ticker_flow` payload shape: `net` is a dict
    `{bull, bear, unclassified, dir}`, contracts carry `premium` (not `value`).

    ⛔ FIXED 2026-09-19 — every case here previously exercised a shape
    `_compute_ticker_flow` has never produced. Against a real payload the old
    net check always raised `unparseable_contracts_or_net` (net is a dict, not
    a float) and the old sort check read every `c.get("value", 0)` as 0 — an
    all-zero list is vacuously sorted, so it could never catch a real ordering
    bug. Both bugs shared the same wrong fixture, which is why they went
    unnoticed: the tests agreed with the code, and neither agreed with reality.
    See `check_flow_internal_consistency`'s own docstring for the full account.
    """

    def test_dir_agreeing_with_bull_over_bear_is_clean(self):
        payload = {"net": {"bull": 300, "bear": 100, "dir": "BULL"}, "contracts": []}
        assert check_flow_internal_consistency(payload) == []

    def test_dir_disagreeing_with_bull_bear_flags(self):
        payload = {"net": {"bull": 300, "bear": 100, "dir": "BEAR"}, "contracts": []}
        problems = check_flow_internal_consistency(payload)
        assert any("net_dir_mismatch" in p for p in problems)

    def test_dir_neutral_when_bull_equals_bear_is_clean(self):
        payload = {"net": {"bull": 100, "bear": 100, "dir": "NEUTRAL"}, "contracts": []}
        assert check_flow_internal_consistency(payload) == []

    def test_net_as_a_bare_scalar_flags(self):
        # The shape every case in this class used to assume — now itself a
        # detected defect, not the fixture.
        problems = check_flow_internal_consistency({"net": 300, "contracts": []})
        assert any("net_wrong_shape" in p for p in problems)

    def test_contracts_sorted_descending_by_premium_is_clean(self):
        payload = {"net": None, "contracts": [{"premium": 200}, {"premium": 100}]}
        assert check_flow_internal_consistency(payload) == []

    def test_contracts_out_of_order_by_premium_flags(self):
        payload = {"net": None, "contracts": [{"premium": 100}, {"premium": 200}]}
        problems = check_flow_internal_consistency(payload)
        assert "contracts_not_sorted_descending_by_premium" in problems

    def test_empty_contracts_never_flags(self):
        assert check_flow_internal_consistency({"net": None, "contracts": []}) == []


class TestFlowAgainstRawTape:
    """`check_flow_against_raw_tape` — the raw-tape upper-bound leg (2026-09-19).
    Deliberately NOT a re-implementation of `_build_by_contract`'s business
    rules (color gate, per-day caps, sweep-only filtering) — a filtered
    subset's total can never exceed its own unconstrained superset, which is
    what makes this a sound, TRUE independent check rather than a second copy
    of the same logic that could share its bugs."""

    def test_shown_values_within_the_raw_bound_is_clean(self):
        contracts = [{"cp": "C", "strike": 100.0, "exp": "1/1/2027", "premium": 500, "volume": 10}]
        raw = {("C", 100.0, "1/1/2027"): (1000.0, 20.0, 3)}
        assert check_flow_against_raw_tape(contracts, raw) == []

    def test_shown_value_exactly_at_the_raw_boundary_is_clean(self):
        contracts = [{"cp": "C", "strike": 100.0, "exp": "1/1/2027", "premium": 1000, "volume": 20}]
        raw = {("C", 100.0, "1/1/2027"): (1000.0, 20.0, 3)}
        assert check_flow_against_raw_tape(contracts, raw) == []

    def test_zero_raw_rows_flags(self):
        contracts = [{"cp": "C", "strike": 999.0, "exp": "1/1/2027", "premium": 500, "volume": 10}]
        problems = check_flow_against_raw_tape(contracts, {})
        assert any("ZERO raw flow.db rows" in p for p in problems)

    def test_zero_raw_rows_flags_even_at_premium_and_volume_zero(self):
        # Isolates the zero-rows guard from the exceeds-bound checks, which a
        # shown 0 would never trip on their own — caught a mutation that
        # deleted the guard while leaving this case's premium/volume nonzero.
        contracts = [{"cp": "C", "strike": 999.0, "exp": "1/1/2027", "premium": 0, "volume": 0}]
        problems = check_flow_against_raw_tape(contracts, {})
        assert any("ZERO raw flow.db rows" in p for p in problems)

    def test_shown_premium_exceeding_the_raw_total_flags(self):
        contracts = [{"cp": "C", "strike": 100.0, "exp": "1/1/2027", "premium": 5000, "volume": 10}]
        raw = {("C", 100.0, "1/1/2027"): (1000.0, 20.0, 3)}
        problems = check_flow_against_raw_tape(contracts, raw)
        assert any("exceeds raw" in p and "premium" in p for p in problems)

    def test_shown_volume_exceeding_the_raw_total_flags(self):
        contracts = [{"cp": "C", "strike": 100.0, "exp": "1/1/2027", "premium": 500, "volume": 500}]
        raw = {("C", 100.0, "1/1/2027"): (1000.0, 20.0, 3)}
        problems = check_flow_against_raw_tape(contracts, raw)
        assert any("exceeds raw" in p and "volume" in p for p in problems)

    def test_empty_contracts_never_flags(self):
        raw = {("C", 100.0, "1/1/2027"): (1000.0, 20.0, 3)}
        assert check_flow_against_raw_tape([], raw) == []
