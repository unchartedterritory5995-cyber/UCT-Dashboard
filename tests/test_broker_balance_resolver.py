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


def test_broker_source_but_no_equity_falls_back_to_manual():
    # Connected but balances not yet synced → behave as manual (no crash, no
    # fake zero equity from the broker side).
    acct = {"balanceSource": "broker", "startingBalance": 7000.0, "brokerTotalEquity": None}
    out = resolve_equity(acct, realized_pnl=300.0)
    assert out["source"] == "manual"
    assert out["equity"] == 7300.0


def test_missing_starting_balance_defaults_zero():
    out = resolve_equity({"balanceSource": "manual"}, realized_pnl=100.0)
    assert out["equity"] == 100.0
