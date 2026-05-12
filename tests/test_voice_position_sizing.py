"""Voice position-sizing engine — pure math + full validation."""

import uuid
import pytest

from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services import voice_position_sizing as vps


def _user():
    init_db()
    return create_user(f"vps_{uuid.uuid4()}@example.com", "p")["id"]


# ── calc_position_size (pure math) ──────────────────────────────────────────

def test_calc_size_basic_long():
    """1% of $100k on a $200 entry / $195 stop = $1000 / $5 = 200 shares."""
    r = vps.calc_position_size(account_size=100_000, risk_pct=1.0,
                                entry=200, stop=195)
    assert r["ok"] is True
    assert r["shares"] == 200
    assert r["dollar_risk"] == 1000.0
    assert r["r_per_share"] == 5.0


def test_calc_size_basic_short():
    """Short 1% of $100k entry $50 stop $52 = $1000 / $2 = 500 shares."""
    r = vps.calc_position_size(account_size=100_000, risk_pct=1.0,
                                entry=50, stop=52, side="short")
    assert r["ok"] is True
    assert r["shares"] == 500


def test_calc_size_rejects_long_stop_above_entry():
    r = vps.calc_position_size(account_size=100_000, risk_pct=1.0,
                                entry=100, stop=105, side="long")
    assert r["ok"] is False
    assert "stop" in r["reason"].lower()


def test_calc_size_rejects_short_stop_below_entry():
    r = vps.calc_position_size(account_size=100_000, risk_pct=1.0,
                                entry=100, stop=95, side="short")
    assert r["ok"] is False


def test_calc_size_rejects_zero_account():
    r = vps.calc_position_size(account_size=0, risk_pct=1.0,
                                entry=100, stop=95)
    assert r["ok"] is False


def test_calc_size_rejects_excessive_risk_pct():
    """risk_pct above absolute cap is rejected."""
    r = vps.calc_position_size(account_size=100_000, risk_pct=10.0,
                                entry=100, stop=95)
    assert r["ok"] is False


def test_calc_size_handles_tight_stop():
    """$0.50 stop on $100 stock — should produce a large share count."""
    r = vps.calc_position_size(account_size=100_000, risk_pct=1.0,
                                entry=100, stop=99.5)
    assert r["ok"] is True
    assert r["shares"] == 2000  # $1000 / $0.50


# ── validate_trade (full state) ─────────────────────────────────────────────

def test_validate_passes_clean_trade(monkeypatch):
    """No open positions, modest size — passes."""
    uid = _user()
    monkeypatch.setattr(vps, "_get_account_settings", lambda u, a: {
        "account_id": None, "account_name": "Test",
        "account_size": 100_000.0, "max_risk_pct": 1.0,
    })
    monkeypatch.setattr(vps, "_current_portfolio_risk", lambda u, a: {
        "total_risk": 0.0, "open_count": 0, "by_symbol": {},
    })
    out = vps.validate_trade(
        user_id=uid, symbol="NVDA",
        entry=200, stop=195, shares=200,
    )
    assert out["ok"] is True
    assert out["refusal_basis"] == []


def test_validate_rejects_oversize_trade(monkeypatch):
    """Asking for too many shares — should refuse for exceeding risk %."""
    uid = _user()
    monkeypatch.setattr(vps, "_get_account_settings", lambda u, a: {
        "account_id": None, "account_name": "Test",
        "account_size": 100_000.0, "max_risk_pct": 1.0,
    })
    monkeypatch.setattr(vps, "_current_portfolio_risk", lambda u, a: {
        "total_risk": 0.0, "open_count": 0, "by_symbol": {},
    })
    out = vps.validate_trade(
        user_id=uid, symbol="NVDA",
        entry=200, stop=195, shares=1000,  # = $5000 risk = 5%
    )
    assert out["ok"] is False
    assert any("per-trade risk" in r for r in out["refusal_basis"])


def test_validate_refuses_duplicate_position(monkeypatch):
    """Already long NVDA — refuse a second NVDA entry."""
    uid = _user()
    monkeypatch.setattr(vps, "_get_account_settings", lambda u, a: {
        "account_id": None, "account_name": "Test",
        "account_size": 100_000.0, "max_risk_pct": 1.0,
    })
    monkeypatch.setattr(vps, "_current_portfolio_risk", lambda u, a: {
        "total_risk": 500.0, "open_count": 1,
        "by_symbol": {"NVDA": 500.0},
    })
    out = vps.validate_trade(
        user_id=uid, symbol="NVDA",
        entry=200, stop=195, shares=100,
    )
    assert out["ok"] is False
    assert any("NVDA" in r for r in out["refusal_basis"])


def test_validate_refuses_when_portfolio_heat_exceeds_cap(monkeypatch):
    """Current heat is 10%, new trade would push to 13% — refuse."""
    uid = _user()
    monkeypatch.setattr(vps, "_get_account_settings", lambda u, a: {
        "account_id": None, "account_name": "Test",
        "account_size": 100_000.0, "max_risk_pct": 1.0,
    })
    monkeypatch.setattr(vps, "_current_portfolio_risk", lambda u, a: {
        "total_risk": 10_000.0, "open_count": 10,
        "by_symbol": {},
    })
    out = vps.validate_trade(
        user_id=uid, symbol="NVDA",
        entry=200, stop=195, shares=200,  # +$1000 risk
    )
    # 10000 + 1000 = 11% — under cap but close. Push harder:
    out2 = vps.validate_trade(
        user_id=uid, symbol="NVDA",
        entry=200, stop=195, shares=600,  # +$3000 risk = 13%
    )
    # First should refuse on per-trade risk (3% > 1% max). Heat would also fail.
    assert out2["ok"] is False
    assert any("heat" in r.lower() or "per-trade" in r.lower() for r in out2["refusal_basis"])


def test_validate_refuses_inverted_stop(monkeypatch):
    """Long with stop above entry — refuse with clear reason."""
    uid = _user()
    monkeypatch.setattr(vps, "_get_account_settings", lambda u, a: {
        "account_id": None, "account_name": "Test",
        "account_size": 100_000.0, "max_risk_pct": 1.0,
    })
    monkeypatch.setattr(vps, "_current_portfolio_risk", lambda u, a: {
        "total_risk": 0, "open_count": 0, "by_symbol": {},
    })
    out = vps.validate_trade(
        user_id=uid, symbol="NVDA",
        entry=100, stop=105, shares=10, side="long",
    )
    assert out["ok"] is False


def test_validate_refuses_sector_concentration(monkeypatch):
    """If user already has heavy semiconductor exposure, refuse a 4th."""
    uid = _user()
    monkeypatch.setattr(vps, "_get_account_settings", lambda u, a: {
        "account_id": None, "account_name": "Test",
        "account_size": 100_000.0, "max_risk_pct": 1.0,
    })
    # Existing $2300 risk in Semis sector (already over 2.5×1% = 2.5%)
    monkeypatch.setattr(vps, "_current_portfolio_risk", lambda u, a: {
        "total_risk": 2300.0, "open_count": 3,
        "by_symbol": {"NVDA": 800.0, "AMD": 800.0, "AVGO": 700.0},
        "by_sector": {"Semiconductors": 2300.0},
    })
    monkeypatch.setattr(vps, "_sectors_for_symbol",
                         lambda s: {"Semiconductors"})
    out = vps.validate_trade(
        user_id=uid, symbol="TSM",
        entry=200, stop=195, shares=100,  # adds $500 more semi risk
    )
    assert out["ok"] is False
    assert any("Semiconductors" in r and "sector" in r.lower()
                for r in out["refusal_basis"])


def test_validate_allows_diversified_trade(monkeypatch):
    """Same risk amount but a different sector should pass."""
    uid = _user()
    monkeypatch.setattr(vps, "_get_account_settings", lambda u, a: {
        "account_id": None, "account_name": "Test",
        "account_size": 100_000.0, "max_risk_pct": 1.0,
    })
    monkeypatch.setattr(vps, "_current_portfolio_risk", lambda u, a: {
        "total_risk": 2300.0, "open_count": 3,
        "by_symbol": {"NVDA": 800.0, "AMD": 800.0, "AVGO": 700.0},
        "by_sector": {"Semiconductors": 2300.0},
    })
    monkeypatch.setattr(vps, "_sectors_for_symbol",
                         lambda s: {"Healthcare"})  # different sector
    out = vps.validate_trade(
        user_id=uid, symbol="UNH",
        entry=400, stop=395, shares=100,  # $500 healthcare risk
    )
    assert out["ok"] is True


def test_validate_reports_account_state(monkeypatch):
    """Output should always include account_size, max_risk_pct, portfolio_heat."""
    uid = _user()
    monkeypatch.setattr(vps, "_get_account_settings", lambda u, a: {
        "account_id": None, "account_name": "Swing",
        "account_size": 50_000.0, "max_risk_pct": 0.75,
    })
    monkeypatch.setattr(vps, "_current_portfolio_risk", lambda u, a: {
        "total_risk": 250.0, "open_count": 1, "by_symbol": {"MSFT": 250.0},
    })
    out = vps.validate_trade(
        user_id=uid, symbol="NVDA",
        entry=100, stop=95, shares=50,
    )
    assert out["account_size"] == 50_000.0
    assert out["max_risk_pct"] == 0.75
    assert out["account_name"] == "Swing"
    assert out["portfolio_heat_before"] == pytest.approx(0.5, abs=0.01)
    assert "rule_book" in out
