"""Tests for the consolidated fundamental snapshot service."""
from __future__ import annotations

import api.services.research.snapshot as snap


def _clear_cache(sym):
    from api.services.cache import cache
    cache.set(f"research_snapshot::{sym}", None, 0)


def test_snapshot_composes_ratings_and_fundamentals(monkeypatch):
    monkeypatch.setattr(snap, "get_fundamentals", lambda s: {
        "name": "Apple Inc.", "sector": "Technology", "industry": "Consumer Electronics",
        "market_cap": "$3.00T", "pe_forward": 28.5, "peg": 2.1, "roe_pct": 45.0,
        "revenue_growth_pct": 8.0, "earnings_growth_pct": 12.0, "profit_margin_pct": 25.0,
        "debt_to_equity": 150.0, "beta": 1.2, "fifty_two_week_high": 220.0,
        "fifty_two_week_low": 160.0, "dividend_yield_pct": 0.5,
        "analyst_target_mean": 240.0, "analyst_recommendation": "buy", "analyst_count": 40,
    })
    monkeypatch.setattr(snap, "get_ratings", lambda s: {
        "composite": 92,
        "components": {"eps": 90, "rs": 88, "growth": 76, "value": 48, "smr": "A", "accdis": "B", "sponsorship": "A"},
        "checkup": [{"label": "ROE ≥ 17%", "status": "pass", "value": "45%"}],
        "method": "Threshold-calibrated v1",
    })
    _clear_cache("AAPL")

    out = snap.get_snapshot("aapl")
    assert out["sym"] == "AAPL"
    assert out["name"] == "Apple Inc."
    assert out["sector"] == "Technology"
    assert out["composite"] == 92
    assert out["components"]["eps"] == 90
    assert out["checkup"][0]["status"] == "pass"
    # data boxes pulled from fundamentals
    assert out["metrics"]["market_cap"] == "$3.00T"
    assert out["metrics"]["pe_forward"] == 28.5
    assert out["metrics"]["roe_pct"] == 45.0
    assert out["metrics"]["analyst_count"] == 40


def test_snapshot_null_safe_when_sources_fail(monkeypatch):
    def boom(s):
        raise RuntimeError("yfinance down")
    monkeypatch.setattr(snap, "get_fundamentals", boom)
    monkeypatch.setattr(snap, "get_ratings", boom)
    _clear_cache("FAIL")

    out = snap.get_snapshot("FAIL")
    assert out["sym"] == "FAIL"
    assert out["composite"] is None
    # metric keys are always present (null-safe), values None when sources fail
    assert out["metrics"]["market_cap"] is None
    assert out["metrics"]["roe_pct"] is None
    assert out["checkup"] == []


def test_snapshot_ignores_fundamentals_error_dict(monkeypatch):
    monkeypatch.setattr(snap, "get_fundamentals", lambda s: {"error": "no fundamentals available", "ticker": s})
    monkeypatch.setattr(snap, "get_ratings", lambda s: {"composite": 50, "components": {}, "checkup": [], "method": "v1"})
    _clear_cache("ERR")

    out = snap.get_snapshot("ERR")
    assert out["name"] == "ERR"          # falls back to sym, not the error dict
    assert out["composite"] == 50
    assert out["metrics"]["market_cap"] is None


def test_snapshot_empty_sym():
    assert snap.get_snapshot("")["sym"] == ""
    assert snap.get_snapshot(None)["metrics"] == {}
