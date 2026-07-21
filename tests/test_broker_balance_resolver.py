"""Tests for the account-equity resolver — the broker-vs-manual chokepoint."""

from __future__ import annotations

from api.services.journal_two.broker.balance_resolver import resolve_equity


def test_manual_account_uses_starting_plus_realized():
    acct = {"balanceSource": "manual", "startingBalance": 10000.0}
    out = resolve_equity(acct, realized_pnl=2500.0)
    assert out["source"] == "manual"
    assert out["equity"] == 12500.0
    assert out["cash"] is None and out["marketValue"] is None


def test_manual_account_no_realized():
    acct = {"balanceSource": "manual", "startingBalance": 5000.0}
    assert resolve_equity(acct)["equity"] == 5000.0


def test_broker_account_uses_broker_equity():
    acct = {
        "balanceSource": "broker",
        "startingBalance": 1.0,           # placeholder; must be ignored
        "brokerTotalEquity": 42000.0,
        "brokerCash": 8000.0,
        "brokerBuyingPower": 16000.0,
        "brokerMarketValue": 34000.0,
        "brokerBalanceSyncedAt": "2026-06-15T20:00:00Z",
    }
    out = resolve_equity(acct, realized_pnl=999999.0)  # must be ignored for broker
    assert out["source"] == "broker"
    assert out["equity"] == 42000.0
    assert out["cash"] == 8000.0
    assert out["buyingPower"] == 16000.0
    assert out["marketValue"] == 34000.0
    assert out["syncedAt"] == "2026-06-15T20:00:00Z"


def test_broker_source_but_no_equity_is_pending_not_reconstructed():
    # INV-1: connected but balances not yet synced → an explicit PENDING state
    # (equity None, UI shows "—"), NEVER startingBalance + realized_pnl. A broker
    # account must never present a reconstructed number as its balance.
    acct = {"balanceSource": "broker", "startingBalance": 7000.0, "brokerTotalEquity": None}
    out = resolve_equity(acct, realized_pnl=300.0)
    assert out["source"] == "broker"          # it IS a broker account, not manual
    assert out["equity"] is None              # not 7300.0 (the old fabrication)
    assert out["pending"] is True


def test_broker_non_finite_equity_is_pending():
    # A corrupt/non-finite stored equity must degrade to pending, never render
    # an inf/NaN as the account balance.
    for bad in (float("inf"), float("nan"), float("-inf")):
        out = resolve_equity({"balanceSource": "broker", "brokerTotalEquity": bad})
        assert out["equity"] is None and out["pending"] is True


def test_broker_negative_equity_is_shown_as_broker_truth():
    # A genuine broker-reported negative equity (margin debt) is TRUTH — mirror
    # it, do not clamp (clamping broker-reported values would break fidelity).
    out = resolve_equity({"balanceSource": "broker", "brokerTotalEquity": -1500.0})
    assert out["equity"] == -1500.0 and out["pending"] is False


def test_missing_starting_balance_defaults_zero():
    out = resolve_equity({"balanceSource": "manual"}, realized_pnl=100.0)
    assert out["equity"] == 100.0
