"""Scheduled-sync cadence compliance (SnapTrade launch guide: background
holdings ≤4/day/user, activities ≤1/account/24h — the 20-min loop was ~72/day).
Default mode 'daily' = one scheduled sync per account per 24h; webhooks +
on-login refresh + Recent Orders polling own intraday freshness."""
from api.services.journal_two.broker import sync


def test_default_mode_is_daily(monkeypatch):
    monkeypatch.delenv("BROKER_SYNC_MODE", raising=False)
    monkeypatch.delenv("BROKER_SYNC_INTERVAL_MIN", raising=False)
    assert sync._default_interval_min() == 1440


def test_legacy_mode_restores_20_minutes(monkeypatch):
    monkeypatch.setenv("BROKER_SYNC_MODE", "legacy")
    monkeypatch.delenv("BROKER_SYNC_INTERVAL_MIN", raising=False)
    assert sync._default_interval_min() == 20


def test_explicit_interval_wins_over_mode(monkeypatch):
    monkeypatch.setenv("BROKER_SYNC_MODE", "daily")
    monkeypatch.setenv("BROKER_SYNC_INTERVAL_MIN", "45")
    assert sync._default_interval_min() == 45
