"""Drift + anomaly detection — behavioral degradation surfacing."""

import uuid
from datetime import datetime, timezone, timedelta
from unittest.mock import patch

import pytest

from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services import voice_drift_detector as vdd


def _user():
    init_db()
    return create_user(f"vdd_{uuid.uuid4()}@x.com", "p")["id"]


def _trade(*, exit_days_ago=10, result="win", pnl_dollar=100, r_multiple=1.5,
           shares=100, entry_price=100, stop=95, mistake_tags=None):
    exit_dt = (datetime.now(timezone.utc) - timedelta(days=exit_days_ago)).isoformat()
    return {
        "symbol": "X", "result": result, "pnl_dollar": pnl_dollar,
        "r_multiple": r_multiple, "shares": shares,
        "entry_price": entry_price, "original_stop": stop,
        "exit_date": exit_dt, "mistake_tags": mistake_tags,
    }


# ── Helper math ─────────────────────────────────────────────────────────────

def test_to_float_handles_none():
    assert vdd._to_float(None) == 0.0
    assert vdd._to_float("3.14") == 3.14
    assert vdd._to_float("garbage", default=5) == 5


def test_parse_exit_date_iso():
    dt = vdd._parse_exit_date("2026-05-12T10:00:00+00:00")
    assert dt is not None
    dt_z = vdd._parse_exit_date("2026-05-12T10:00:00Z")
    assert dt_z is not None


def test_parse_exit_date_invalid():
    assert vdd._parse_exit_date(None) is None
    assert vdd._parse_exit_date("not a date") is None


def test_split_windows_routes_correctly():
    trades = [
        _trade(exit_days_ago=5),    # recent
        _trade(exit_days_ago=40),   # baseline (30-60)
        _trade(exit_days_ago=90),   # too old (drop)
    ]
    recent, baseline = vdd._split_windows(trades)
    assert len(recent) == 1
    assert len(baseline) == 1


def test_win_rate_uses_result_or_pnl():
    trades = [
        _trade(result="win", pnl_dollar=200),
        _trade(result="loss", pnl_dollar=-100),
        _trade(result=None, pnl_dollar=50),  # positive pnl counts as win
    ]
    wr = vdd._win_rate(trades)
    assert wr == pytest.approx(2 / 3, rel=1e-3)


def test_avg_loss_r_ignores_winners():
    trades = [
        _trade(pnl_dollar=200, r_multiple=2.0),
        _trade(pnl_dollar=-100, r_multiple=-1.0),
        _trade(pnl_dollar=-200, r_multiple=-2.0),
    ]
    avg = vdd._avg_loss_r(trades)
    assert avg == pytest.approx(-1.5, rel=1e-3)


def test_mistake_counts_string_tags():
    trades = [
        _trade(mistake_tags="fomo,no_stop"),
        _trade(mistake_tags="fomo"),
        _trade(mistake_tags=None),
    ]
    c = vdd._mistake_counts(trades)
    assert c["fomo"] == 2
    assert c["no_stop"] == 1


# ── End-to-end detection ───────────────────────────────────────────────────

def test_detect_drift_no_trades_no_findings(monkeypatch):
    monkeypatch.setattr(
        "api.services.journal_two.trades.list_trades_for_user",
        lambda uid, conn=None, account_id=None: [],
    )
    assert vdd.detect_drift("u") == []


def test_detect_drift_win_rate_drop():
    """Baseline 80% win, recent 30% win → drift_warning."""
    # 5+ trades in each window so MIN_TRADES is satisfied
    baseline = [_trade(exit_days_ago=45, result="win", pnl_dollar=100) for _ in range(8)]
    baseline += [_trade(exit_days_ago=50, result="loss", pnl_dollar=-100) for _ in range(2)]
    recent = [_trade(exit_days_ago=5, result="loss", pnl_dollar=-100) for _ in range(7)]
    recent += [_trade(exit_days_ago=10, result="win", pnl_dollar=100) for _ in range(3)]

    with patch("api.services.journal_two.trades.list_trades_for_user",
               return_value=baseline + recent):
        findings = vdd.detect_drift("u")
    subkinds = {f["subkind"] for f in findings}
    assert "win_rate_drop" in subkinds


def test_detect_drift_mistake_recurrence():
    recent = [
        _trade(exit_days_ago=2, mistake_tags="fomo"),
        _trade(exit_days_ago=5, mistake_tags="fomo"),
        _trade(exit_days_ago=8, mistake_tags="fomo,no_stop"),
    ]
    with patch("api.services.journal_two.trades.list_trades_for_user",
               return_value=recent):
        findings = vdd.detect_drift("u")
    fomo_findings = [f for f in findings if "fomo" in f["headline"].lower()]
    assert len(fomo_findings) == 1
    assert fomo_findings[0]["subkind"] == "mistake_recurrence"


def test_detect_drift_size_creep():
    """Baseline avg risk $500, recent avg risk $800 → size_creep."""
    baseline = [
        _trade(exit_days_ago=40, shares=100, entry_price=100, stop=95)
        for _ in range(6)
    ]  # risk = 100 * 5 = 500
    recent = [
        _trade(exit_days_ago=5, shares=100, entry_price=100, stop=92)
        for _ in range(6)
    ]  # risk = 100 * 8 = 800
    with patch("api.services.journal_two.trades.list_trades_for_user",
               return_value=baseline + recent):
        findings = vdd.detect_drift("u")
    subkinds = {f["subkind"] for f in findings}
    assert "size_creep" in subkinds


def test_detect_drift_frequency_spike():
    baseline = [_trade(exit_days_ago=45) for _ in range(5)]
    recent = [_trade(exit_days_ago=5) for _ in range(15)]
    with patch("api.services.journal_two.trades.list_trades_for_user",
               return_value=baseline + recent):
        findings = vdd.detect_drift("u")
    subkinds = {f["subkind"] for f in findings}
    assert "frequency_spike" in subkinds


def test_emit_drift_insights_queues_via_proactive():
    """emit_drift_insights wires through to voice_proactive_service."""
    init_db()
    uid = _user()
    fake_trades = [
        _trade(exit_days_ago=2, mistake_tags="fomo"),
        _trade(exit_days_ago=5, mistake_tags="fomo"),
        _trade(exit_days_ago=8, mistake_tags="fomo"),
    ]
    with patch("api.services.journal_two.trades.list_trades_for_user",
               return_value=fake_trades):
        n = vdd.emit_drift_insights(uid)
    assert n >= 1
    # Verify insight landed in the proactive table
    from api.services.voice_proactive_service import list_pending_insights
    pending = list_pending_insights(uid)
    assert any("fomo" in (p.get("headline") or "").lower() for p in pending)
