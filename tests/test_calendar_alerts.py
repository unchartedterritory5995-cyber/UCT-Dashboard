"""Tests for api/services/calendar_alerts.py

Covers:
- run_prereport_alerts fires deliver_alert_payload once per (user, ticker, day)
- Dedup: a second call for the same (user, ticker, date) does NOT fire again
- Env gate: CALENDAR_ALERTS_ENABLED=0 suppresses all alerts
- Empty reporters → 0 fires
- Empty user sets → 0 fires
"""
from __future__ import annotations

import importlib
from unittest import mock

# Patch target: deliver_alert_payload is imported at call-time inside
# run_prereport_alerts via:
#   from api.services.watchlist_alert_service import deliver_alert_payload
# so we patch it at the source module.
_DELIVER_PATH = "api.services.watchlist_alert_service.deliver_alert_payload"


def _reload(tmp_path, monkeypatch):
    """Reload the module with a fresh tmp DB path."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    import api.services.calendar_alerts as mod
    importlib.reload(mod)
    return mod


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_env_gate_disabled(tmp_path, monkeypatch):
    """When CALENDAR_ALERTS_ENABLED != 1, run_prereport_alerts returns 0."""
    monkeypatch.setenv("CALENDAR_ALERTS_ENABLED", "0")
    mod = _reload(tmp_path, monkeypatch)

    with mock.patch.object(mod, "_get_reporters_for_date") as reporters, \
         mock.patch.object(mod, "_collect_all_users_ticker_sets") as users, \
         mock.patch(_DELIVER_PATH) as deliver:
        count = mod.run_prereport_alerts("2026-06-01")

    assert count == 0
    reporters.assert_not_called()
    users.assert_not_called()
    deliver.assert_not_called()


def test_env_gate_enabled_fires(tmp_path, monkeypatch):
    """CALENDAR_ALERTS_ENABLED=1 fires exactly once per (user, ticker, date)."""
    monkeypatch.setenv("CALENDAR_ALERTS_ENABLED", "1")
    mod = _reload(tmp_path, monkeypatch)

    with mock.patch.object(mod, "_get_reporters_for_date", return_value={"AAPL", "MSFT"}), \
         mock.patch.object(mod, "_collect_all_users_ticker_sets",
                           return_value={"u1": {"AAPL", "GOOG"}}), \
         mock.patch(_DELIVER_PATH) as fake_deliver:
        count = mod.run_prereport_alerts("2026-06-01")

    # AAPL in both sets, MSFT not in u1, GOOG not reporting → only AAPL
    assert count == 1
    assert fake_deliver.call_count == 1
    call_kwargs = fake_deliver.call_args.kwargs
    assert call_kwargs["sym"] == "AAPL"
    assert call_kwargs["user_id"] == "u1"
    assert call_kwargs["source"] == "calendar_alert"


def test_dedup_same_user_ticker_date(tmp_path, monkeypatch):
    """Second call for same (user, ticker, date) does not fire again."""
    monkeypatch.setenv("CALENDAR_ALERTS_ENABLED", "1")
    mod = _reload(tmp_path, monkeypatch)

    def _run(deliver_mock):
        with mock.patch.object(mod, "_get_reporters_for_date", return_value={"NVDA"}), \
             mock.patch.object(mod, "_collect_all_users_ticker_sets",
                               return_value={"u2": {"NVDA"}}), \
             mock.patch(_DELIVER_PATH, deliver_mock):
            return mod.run_prereport_alerts("2026-06-02")

    fake_deliver = mock.MagicMock()
    first = _run(fake_deliver)
    second = _run(fake_deliver)

    assert first == 1          # fired on first call
    assert second == 0         # deduped on second call
    assert fake_deliver.call_count == 1


def test_empty_reporters(tmp_path, monkeypatch):
    """No reporters → 0 fires without touching delivery."""
    monkeypatch.setenv("CALENDAR_ALERTS_ENABLED", "1")
    mod = _reload(tmp_path, monkeypatch)

    with mock.patch.object(mod, "_get_reporters_for_date", return_value=set()), \
         mock.patch.object(mod, "_collect_all_users_ticker_sets",
                           return_value={"u1": {"AAPL"}}), \
         mock.patch(_DELIVER_PATH) as fake_deliver:
        count = mod.run_prereport_alerts("2026-06-01")

    assert count == 0
    fake_deliver.assert_not_called()


def test_empty_user_sets(tmp_path, monkeypatch):
    """No users with My-Stocks → 0 fires."""
    monkeypatch.setenv("CALENDAR_ALERTS_ENABLED", "1")
    mod = _reload(tmp_path, monkeypatch)

    with mock.patch.object(mod, "_get_reporters_for_date", return_value={"AAPL"}), \
         mock.patch.object(mod, "_collect_all_users_ticker_sets", return_value={}), \
         mock.patch(_DELIVER_PATH) as fake_deliver:
        count = mod.run_prereport_alerts("2026-06-01")

    assert count == 0
    fake_deliver.assert_not_called()


def test_multiple_users_multiple_tickers(tmp_path, monkeypatch):
    """Two users each matching two tickers → 4 alerts fired."""
    monkeypatch.setenv("CALENDAR_ALERTS_ENABLED", "1")
    mod = _reload(tmp_path, monkeypatch)

    with mock.patch.object(mod, "_get_reporters_for_date",
                           return_value={"AAPL", "MSFT", "NVDA"}), \
         mock.patch.object(mod, "_collect_all_users_ticker_sets",
                           return_value={"u1": {"AAPL", "MSFT"}, "u2": {"MSFT", "NVDA"}}), \
         mock.patch(_DELIVER_PATH) as fake_deliver:
        count = mod.run_prereport_alerts("2026-06-03")

    assert count == 4  # u1: AAPL+MSFT, u2: MSFT+NVDA
    assert fake_deliver.call_count == 4
