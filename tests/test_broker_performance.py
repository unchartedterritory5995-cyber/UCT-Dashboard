"""Tests for the pure performance engine — deposit/withdrawal-adjusted returns.

The headline correctness rule: an external cash flow (deposit/withdrawal) must
NOT move the time-weighted return; only market moves do.
"""

from __future__ import annotations

import pytest

from api.services.journal_two.broker import performance as perf


# ── TWR ──────────────────────────────────────────────────────────────────────

def test_twr_zero_when_deposit_no_market_move():
    # 10000 → deposit 5000 → 15000, no market move. TWR must be 0%.
    equity = [("2026-05-01", 10000.0), ("2026-05-02", 15000.0)]
    flows = [("2026-05-02", 5000.0)]
    assert abs(perf.time_weighted_return(equity, flows) - 0.0) < 1e-9


def test_twr_withdrawal_no_phantom_loss():
    equity = [("2026-05-01", 10000.0), ("2026-05-02", 8000.0)]
    flows = [("2026-05-02", -2000.0)]
    assert abs(perf.time_weighted_return(equity, flows) - 0.0) < 1e-9


def test_twr_chains_market_moves_across_a_deposit():
    # +10% (10000→11000), then deposit 5000 same day as the +10% close on day 3.
    # sub1: 11000/10000 = 1.10 ; sub2: (17100 - 5000)/11000 = 1.10 → 1.21
    equity = [("2026-05-01", 10000.0), ("2026-05-02", 11000.0), ("2026-05-03", 17100.0)]
    flows = [("2026-05-03", 5000.0)]
    assert abs(perf.time_weighted_return(equity, flows) - 0.21) < 1e-9


def test_twr_none_on_insufficient_or_bad_start():
    assert perf.time_weighted_return([("2026-05-01", 10000.0)], []) is None
    assert perf.time_weighted_return([("2026-05-01", 0.0), ("2026-05-02", 10.0)], []) is None


# ── Simple + dollar P&L ──────────────────────────────────────────────────────

def test_simple_and_dollar_pnl():
    assert perf.simple_return(10000, 13000, 2000) == pytest.approx(0.10)
    assert perf.dollar_pnl(10000, 13000, 2000) == 1000.0


def test_simple_none_on_zero_start():
    assert perf.simple_return(0, 100, 0) is None


# ── Money-weighted (XIRR) ────────────────────────────────────────────────────

def test_xirr_simple_doubling_one_year():
    # -1000 today, +2000 in 365 days → 100% annual.
    flows = [("2026-01-01", -1000.0), ("2027-01-01", 2000.0)]
    assert perf.money_weighted_return(flows) == pytest.approx(1.0, abs=1e-3)


def test_xirr_none_on_degenerate():
    assert perf.money_weighted_return([("2026-01-01", -1000.0)]) is None
    # All same sign → no root to bracket.
    assert perf.money_weighted_return(
        [("2026-01-01", -1000.0), ("2027-01-01", -50.0)]
    ) is None
