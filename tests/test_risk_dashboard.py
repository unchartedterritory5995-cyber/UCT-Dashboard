"""
Risk Dashboard endpoint tests — composes the full risk view payload
for the UI panel.
"""

import uuid
from unittest.mock import patch

from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services.voice_position_sizing import get_risk_dashboard


def _user():
    init_db()
    return create_user(f"rdash_{uuid.uuid4()}@x.com", "p")["id"]


def test_dashboard_returns_expected_keys():
    uid = _user()
    out = get_risk_dashboard(uid)
    for key in (
        "account_size", "max_risk_per_trade_pct", "portfolio_heat_cap_pct",
        "max_sector_concentration_pct", "total_risk_dollars",
        "portfolio_heat_pct", "open_position_count",
        "by_symbol", "by_sector", "recent_refusals",
    ):
        assert key in out, f"missing key: {key}"


def test_dashboard_empty_account_state():
    """Fresh user → all zeros, no refusals, no positions."""
    uid = _user()
    out = get_risk_dashboard(uid)
    assert out["total_risk_dollars"] == 0.0
    assert out["portfolio_heat_pct"] == 0.0
    assert out["open_position_count"] == 0
    assert out["by_symbol"] == []
    assert out["by_sector"] == []
    assert out["recent_refusals"] == []


def test_dashboard_heat_cap_is_3x_max_risk():
    """Portfolio heat cap mirrors validate_trade rule (3x max_risk_per_trade)."""
    uid = _user()
    out = get_risk_dashboard(uid)
    assert out["portfolio_heat_cap_pct"] == out["max_risk_per_trade_pct"] * 3.0


def test_dashboard_sector_cap_is_2_5x_max_risk():
    """Sector concentration cap mirrors validate_trade rule (2.5x)."""
    uid = _user()
    out = get_risk_dashboard(uid)
    assert abs(out["max_sector_concentration_pct"] - out["max_risk_per_trade_pct"] * 2.5) < 0.01


def test_dashboard_includes_position_risk(monkeypatch):
    """When the user has open positions, total_risk + by_symbol populate."""
    uid = _user()
    # Matches the real shape journal_two.positions._row_to_position returns (camelCase).
    fake_positions = [
        {"symbol": "NVDA", "entryPrice": 200, "stopPrice": 195, "shares": 100},
        {"symbol": "AAPL", "entryPrice": 180, "stopPrice": 175, "shares": 50},
    ]
    with patch("api.services.journal_two.positions.list_open_positions",
               return_value=fake_positions), \
         patch("api.services.theme_db.get_themes_for_ticker", return_value=[]):
        out = get_risk_dashboard(uid)
    # NVDA: 100 * 5 = 500. AAPL: 50 * 5 = 250. Total: 750.
    assert out["total_risk_dollars"] == 750.0
    assert out["open_position_count"] == 2
    syms = [s["symbol"] for s in out["by_symbol"]]
    assert "NVDA" in syms
    assert "AAPL" in syms
    # NVDA should be first (higher risk)
    assert out["by_symbol"][0]["symbol"] == "NVDA"


def test_dashboard_sector_aggregation(monkeypatch):
    """When positions share sectors, by_sector aggregates them."""
    uid = _user()
    # Matches the real shape journal_two.positions._row_to_position returns (camelCase).
    fake_positions = [
        {"symbol": "NVDA", "entryPrice": 200, "stopPrice": 195, "shares": 100},
        {"symbol": "AMD",  "entryPrice": 100, "stopPrice": 98,  "shares": 100},
    ]
    def fake_themes(sym):
        return [{"sector_name": "Technology", "ticker": "XLK"}]
    with patch("api.services.journal_two.positions.list_open_positions",
               return_value=fake_positions), \
         patch("api.services.theme_db.get_themes_for_ticker", side_effect=fake_themes):
        out = get_risk_dashboard(uid)
    sectors = {s["sector"]: s["risk_dollars"] for s in out["by_sector"]}
    # NVDA 500 + AMD 200 = 700 in Technology
    assert sectors.get("Technology") == 700.0


def test_dashboard_handles_position_service_failure(monkeypatch):
    """If positions can't be fetched, return zeros, not crash."""
    uid = _user()
    def _raise(*a, **k):
        raise RuntimeError("DB down")
    with patch("api.services.journal_two.positions.list_open_positions",
               side_effect=_raise):
        out = get_risk_dashboard(uid)
    assert out["total_risk_dollars"] == 0.0
    assert out["open_position_count"] == 0
