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
    def test_consistent_net_and_sorted_contracts_is_clean(self):
        payload = {"net": 300, "contracts": [{"value": 200}, {"value": 100}]}
        assert check_flow_internal_consistency(payload) == []

    def test_net_not_matching_contract_sum_flags(self):
        payload = {"net": 999, "contracts": [{"value": 200}, {"value": 100}]}
        problems = check_flow_internal_consistency(payload)
        assert any("net_mismatch" in p for p in problems)

    def test_contracts_out_of_order_flags(self):
        payload = {"net": 300, "contracts": [{"value": 100}, {"value": 200}]}
        problems = check_flow_internal_consistency(payload)
        assert "contracts_not_sorted_descending" in problems

    def test_empty_contracts_never_flags(self):
        assert check_flow_internal_consistency({"net": 0, "contracts": []}) == []

    def test_signed_value_preferred_over_value(self):
        # signed_value is what the runner actually sums; a short vs long leg
        # with the same absolute |value| must still reconcile against net.
        payload = {"net": 0, "contracts": [{"value": 100, "signed_value": 100},
                                            {"value": 100, "signed_value": -100}]}
        assert check_flow_internal_consistency(payload) == []
