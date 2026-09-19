"""Vendor Parity Tranche 2, Lane B -- the multi-bar evidence audit, permanent.

The original Lane B parity claim (`tests/test_vendor_parity_lane_b.py`) rests
on exactly ONE probe row per function. The owner's review correctly flagged
that single-point agreement cannot discriminate semantics across meaningful
state changes -- and pointed out that the preserved raw CSV artifact already
holds far more than that one row.

This file locks in the expanded evidence: `tools/vendor_parity_lane_b_multibar_audit.py`
rebuilds the FULL 300-row input series from the SAME preserved CSV (no new
TradingView session), runs it through the real production Python interpreter,
and compares every row it can validly answer against both the ruling's own
column AND the REJECTED candidate's real vendor-computed column (the mutation
control, using real vendor data for the wrong answer rather than a locally
invented perturbation).

⛔ NON-VACUITY is structural here, not asserted: the rejected-candidate
disagreement counts below are themselves the proof that this comparison can
fail. A change that silently reintroduced the wrong semantics would flip
`mismatch_count` from 0 to the same large number currently reported against
the rejected candidate.
"""
from __future__ import annotations

import sys
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent.parent / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import vendor_parity_lane_b_multibar_audit as mb  # noqa: E402


def _report():
    rows = mb.load_rows()
    bars = mb.build_bars(rows)
    out = {}
    for fn_key, builtin_col, obs_name, lookback0, kind, rejected_col in mb._FUNCTIONS:
        out[fn_key] = mb.audit_one(fn_key, builtin_col, obs_name, lookback0, kind,
                                    rejected_col, rows, bars)
    return rows, out


def test_csv_sanity_preconditions_hold():
    """The three facts the whole multi-bar approach depends on."""
    rows = mb.load_rows()
    sanity = mb.rows_sanity(rows)
    assert sanity["total_rows"] == 300
    assert sanity["distinct_phases"] == 25
    assert sanity["chronologically_sorted"] is True
    assert sanity["per_phase_disagreements"] == []
    assert sanity["raw_values_mapping_to_multiple_phases"] == {}


def test_rising_multi_bar_parity_with_true_and_false_states_and_transitions():
    _, report = _report()
    r = report["rising"]
    assert r["compared_rows"] >= 250
    assert r["mismatch_count"] == 0
    assert set(r["distinct_compared_vendor_values"]) == {True, False}
    assert r["boolean_transition_count"] and r["boolean_transition_count"] >= 10
    # mutation control: real vendor data for the REJECTED running-max candidate
    # must disagree with UCT's real (monotone) output on a substantial share of
    # rows -- proving the check can fail, using real data, not a guess.
    mc = r["mutation_control"]
    assert mc["rows_uct_disagrees_with_rejected_candidate"] >= 15


def test_median_multi_bar_parity_across_many_distinct_windows():
    _, report = _report()
    r = report["median"]
    assert r["compared_rows"] >= 250
    assert r["mismatch_count"] == 0
    assert len(r["distinct_compared_vendor_values"]) >= 15
    # mutation control: the REJECTED lower-middle candidate must disagree on
    # EVERY compared row for an even-length window with no duplicate middles --
    # a weaker result here would mean the ruling and the rejection can coincide
    # by chance, which would make the earlier single-probe claim luckier than it
    # looked.
    mc = r["mutation_control"]
    assert mc["rows_uct_disagrees_with_rejected_candidate"] == r["compared_rows"]


def test_percentrank_multi_bar_parity_including_ties():
    _, report = _report()
    r = report["percentrank"]
    assert r["compared_rows"] >= 250
    assert r["mismatch_count"] == 0
    # 0 and 100 are TIES (multiple bars share the extreme rank) -- real
    # tie-handling behavior, not merely a monotone ramp.
    assert set(r["distinct_compared_vendor_values"]) == {0.0, 25.0, 75.0, 100.0}
    mc = r["mutation_control"]
    assert mc["rows_uct_disagrees_with_rejected_candidate"] >= 30


def test_bbw_multi_bar_parity_across_changing_bandwidth_and_warmup_boundary():
    _, report = _report()
    r = report["bbw"]
    assert r["compared_rows"] >= 250
    assert r["mismatch_count"] == 0
    assert r["max_rel_delta"] < 1e-9  # float-precision noise only, not a real gap
    assert len(r["distinct_compared_vendor_values"]) >= 20
    # warm-up boundary: excluding fewer than n-1=19 rows would compare a window
    # this recomputation cannot have filled; excluding more would silently
    # shrink real coverage.
    assert r["excluded_cold_start_rows"] == 19
    mc = r["mutation_control"]
    assert mc["rows_uct_disagrees_with_rejected_candidate"] == r["compared_rows"]


def test_MUTATION_every_function_has_a_real_vendor_backed_discriminator():
    """Non-vacuity, stated once for all four: the rejected-candidate columns
    are REAL TradingView output for semantics this program did NOT choose, at
    every one of the same 300 rows -- not a synthetic perturbation invented
    after the fact. A future change that quietly reverted any function to its
    rejected semantics would make `mismatch_count` (against the RULING column)
    jump from 0 to the same magnitude currently reported here against the
    rejected column."""
    _, report = _report()
    for fn, r in report.items():
        mc = r["mutation_control"]
        assert mc["rows_uct_disagrees_with_rejected_candidate"] > 0, (
            f"{fn}: the rejected candidate never disagreed with UCT's real output -- "
            "the mutation control would be vacuous for this function"
        )
