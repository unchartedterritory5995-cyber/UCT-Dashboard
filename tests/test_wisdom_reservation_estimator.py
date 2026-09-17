"""R36 — reserve from measured history, and re-check the cap against ACTUALS after every batch.

⛔⛔ THE TWO HALVES ARE ONE CHANGE. Tightening the reservation without the actuals re-check is
strictly less safe than the constant ceiling it replaces: the cap is otherwise tested only at
reserve time, so a reservation that sits below the largest real request lets actual spend pass the
cap unnoticed. That is not hypothetical — measured on the three 2026-09-15 passes, p90 x 1.5 is
15,962 output tokens against an observed max of 18,857 (0.85x).

⚠️ DEVIATION FROM THE RULING, TESTED AS BUILT. The ruling says "p90 x 1.5 over the ledger's last N
entries for this extractor_version". The ledger carries no token counts and no extractor_version,
so the estimate is over measured COST PER REQUEST — the same quantity the cap is denominated in.
"""
from __future__ import annotations

import importlib.util
import pathlib
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]


def _load():
    spec = importlib.util.spec_from_file_location("_gate_for_r36",
                                                  REPO / "tools" / "wisdom" / "extract_golden_gate.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["_gate_for_r36"] = module
    spec.loader.exec_module(module)
    return module


gate = _load()


def _entries(n, usd_per_request, *, model="claude-opus-5", transport="batch", requests=10):
    return [{"model": model, "transport": transport, "requests": requests,
             "usd": usd_per_request * requests} for _ in range(n)]


# ── the estimate ─────────────────────────────────────────────────────────────

def test_no_history_means_no_estimate_so_the_caller_falls_back_to_worst_case():
    """⛔ An unmeasured configuration must reserve the CEILING, not a guess."""
    assert gate.measured_reservation_usd([], "claude-opus-5", transport="batch") is None
    thin = _entries(gate.RESERVE_MIN_HISTORY - 1, 0.05)
    assert gate.measured_reservation_usd(thin, "claude-opus-5", transport="batch") is None


def test_with_history_it_is_the_p90_times_the_multiplier():
    est = gate.measured_reservation_usd(_entries(10, 0.05), "claude-opus-5", transport="batch")
    assert est == pytest.approx(0.05 * gate.RESERVE_P90_MULTIPLIER)


def test_history_for_another_model_or_transport_is_not_used():
    """⛔ A sync run's cost says nothing about a batch run's, and vice versa."""
    other = _entries(10, 0.05, model="claude-haiku-4-5") + _entries(10, 0.05, transport="sync")
    assert gate.measured_reservation_usd(other, "claude-opus-5", transport="batch") is None


def test_an_entry_with_zero_requests_is_ignored_not_divided_by():
    entries = [{"model": "claude-opus-5", "transport": "batch", "requests": 0, "usd": 1.0}]
    entries += _entries(5, 0.04)
    est = gate.measured_reservation_usd(entries, "claude-opus-5", transport="batch")
    assert est == pytest.approx(0.04 * gate.RESERVE_P90_MULTIPLIER)


def test_the_reservation_never_exceeds_the_worst_case():
    """Reserving MORE than the ceiling would be worse than the rule this replaces."""
    params = {"max_tokens": 32000, "system": "x", "messages": [], "output_config": {}}
    ceiling = gate.worst_case_usd(params, "claude-opus-5", batch=True)
    huge = _entries(10, ceiling * 10)
    assert gate.reservation_usd(params, "claude-opus-5", batch=True, entries=huge) == ceiling


def test_with_no_entries_the_reservation_is_exactly_the_worst_case():
    params = {"max_tokens": 32000, "system": "x", "messages": [], "output_config": {}}
    ceiling = gate.worst_case_usd(params, "claude-opus-5", batch=True)
    assert gate.reservation_usd(params, "claude-opus-5", batch=True, entries=[]) == ceiling


# ── the actuals re-check ─────────────────────────────────────────────────────

def test_actuals_past_the_cap_refuse_the_next_batch(tmp_path):
    """⛔⛔ THE LOAD-BEARING HALF."""
    ledger = tmp_path / "ledger.json"
    cap = gate.SpendCap(ledger, 1.0)
    assert not cap.refuses_next_batch()
    cap.settle(0.5, 0.4, {"phase": "gate"})
    assert not cap.refuses_next_batch(), "under the cap, work continues"
    cap.settle(0.5, 0.9, {"phase": "gate"})          # 1.30 total, cap 1.0
    assert cap.refuses_next_batch(), "actuals passed the cap and the next batch was not refused"


def test_a_settle_that_stays_under_the_cap_never_latches_the_refusal(tmp_path):
    cap = gate.SpendCap(tmp_path / "l.json", 10.0)
    for _ in range(5):
        cap.settle(1.0, 0.5, {"phase": "gate"})
    assert not cap.refuses_next_batch()


def test_the_run_loop_consults_the_refusal(tmp_path):
    """Non-vacuity: the flag must actually be read where batches are sent."""
    src = (REPO / "tools" / "wisdom" / "extract_golden_gate.py").read_text(encoding="utf-8")
    block = src.split("def run_batch_round", 1)[1].split("\ndef ", 1)[0]
    assert "refuses_next_batch()" in block, "the per-batch refusal is never consulted"
    assert "reservation_usd(" in block, "the measured reservation is not used to size a batch"


def test_the_observed_maximum_is_recorded_as_a_fixture():
    """⛔ So a future tightening that would reserve less than a real request costs fails HERE."""
    assert gate.OBSERVED_MAX_OUTPUT_TOKENS == 18857
    p90_times_multiplier = 10641 * gate.RESERVE_P90_MULTIPLIER
    assert p90_times_multiplier < gate.OBSERVED_MAX_OUTPUT_TOKENS, (
        "p90 x multiplier now covers the observed max — good, but the actuals re-check is still "
        "what makes this safe and must not be removed on the strength of it")


def test_session_9s_ledger_under_the_new_rule_needs_fewer_rounds():
    """Replay: the measured per-request cost was ~$0.0587, so a batch can hold far more."""
    entries = _entries(6, 0.0587)
    est = gate.measured_reservation_usd(entries, "claude-opus-5", transport="batch")
    assert est == pytest.approx(0.0587 * 1.5)
    for headroom, old_rounds in ((23.13, 2), (18.38, 3), (13.28, 4)):
        per_round = int(headroom // est)
        assert per_round >= 83, f"{headroom} should now fit a whole 83-request pass in one round"
        assert old_rounds >= 2
