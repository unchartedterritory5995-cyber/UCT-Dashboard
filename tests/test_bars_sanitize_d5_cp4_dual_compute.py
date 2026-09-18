"""D5 CHECKPOINT 4 — the split list, DARK.

`bars_sanitize._fetch_meta`'s FMP splits fetch is dual-computed against D5's
`reference_corp_actions.confirmed_splits` ledger: log-only, never raising,
never changing what is served. FMP stays the value of record; these tests
prove the comparison logic and the never-changes-the-return-value guarantee,
not any product behavior change.
"""
from __future__ import annotations

import os

import pytest

from api.services import bars_sanitize as bs
from api.services import reference_corp_actions as rca


# ── _dual_compute_outcome — pure, total, five named categories ───────────────

def test_dual_compute_outcome_both_empty():
    assert bs._dual_compute_outcome([], []) == "BOTH_EMPTY"


def test_dual_compute_outcome_agree():
    same = [("2026-01-01", 4.0), ("2026-06-10", 2.0)]
    assert bs._dual_compute_outcome(list(same), list(reversed(same))) == "AGREE"


def test_dual_compute_outcome_fmp_only():
    assert bs._dual_compute_outcome([("2026-01-01", 4.0)], []) == "FMP_ONLY"


def test_dual_compute_outcome_d5_only():
    assert bs._dual_compute_outcome([], [("2026-01-01", 4.0)]) == "D5_ONLY"


def test_dual_compute_outcome_partial_mismatch():
    fmp = [("2026-01-01", 4.0)]
    d5 = [("2026-01-01", 4.0), ("2026-06-10", 2.0)]
    assert bs._dual_compute_outcome(fmp, d5) == "PARTIAL_MISMATCH"


# ── _dual_compute_splits — never raises, never changes anything, logs only ───

def test_dual_compute_splits_never_raises_when_the_ledger_read_blows_up(monkeypatch):
    def _boom(ticker, db_path=None):
        raise RuntimeError("ledger unreadable")
    monkeypatch.setattr(rca, "read_confirmed_splits", _boom)
    bs._dual_compute_splits("AAPL", [("2026-01-01", 4.0)])  # must not raise


def test_dual_compute_splits_runs_on_every_call_under_pytest_regardless_of_sample_rate(
        monkeypatch):
    """PYTEST_CURRENT_TEST is already set by the pytest runner itself, so the
    sampling skip must never fire here -- assert the comparison actually ran by
    observing its one side effect (the log line), via a spy on the outcome fn."""
    calls = []
    monkeypatch.setattr(bs, "_dual_compute_outcome",
                         lambda fmp, d5: calls.append((fmp, d5)) or "AGREE")
    monkeypatch.setattr(rca, "read_confirmed_splits", lambda ticker, db_path=None: [])
    monkeypatch.setattr(bs, "_DUAL_COMPUTE_SAMPLE_RATE", 0.0)  # would always skip in prod
    bs._dual_compute_splits("AAPL", [("2026-01-01", 4.0)])
    assert len(calls) == 1, "pytest must bypass sampling, not merely lower its odds"


def test_dual_compute_splits_is_sampled_outside_pytest(monkeypatch):
    """With PYTEST_CURRENT_TEST hidden and the sample rate pinned to 0, the
    comparison must NOT run -- proving sampling is a real gate, not a no-op."""
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    monkeypatch.setattr(bs, "_DUAL_COMPUTE_SAMPLE_RATE", 0.0)
    monkeypatch.setattr(bs.random, "random", lambda: 0.5)  # >= 0.0 always
    calls = []
    monkeypatch.setattr(rca, "read_confirmed_splits",
                         lambda ticker, db_path=None: calls.append(ticker) or [])
    bs._dual_compute_splits("AAPL", [("2026-01-01", 4.0)])
    assert calls == [], "sample rate 0.0 outside pytest must skip the ledger read entirely"


def test_fetch_meta_return_value_is_unaffected_by_what_d5_says(monkeypatch):
    """The whole point of CP4: FMP stays the value of record no matter what the
    dual-compute finds. Feed D5 a DIFFERENT split list than FMP's and assert
    _fetch_meta's return is still FMP's, untouched."""
    class _FakeFmpResponse:
        pass

    def _fake_fmp_get(path, params):
        if path == "/stable/profile":
            return [{"ipoDate": "2020-01-01"}]
        if path == "/stable/splits":
            return [{"date": "2026-01-01", "numerator": 4, "denominator": 1}]
        raise AssertionError(f"unexpected path {path}")

    import api.services.earnings_estimates as ee
    monkeypatch.setattr(ee, "_fmp_get", _fake_fmp_get)
    monkeypatch.setattr(rca, "read_confirmed_splits",
                         lambda ticker, db_path=None: [("2026-06-10", 999.0)])

    result = bs._fetch_meta("AAPL")
    assert result == {"ipo": "2020-01-01", "splits": [("2026-01-01", 4.0)]}, (
        "D5's disagreeing answer must never change what _fetch_meta returns")
