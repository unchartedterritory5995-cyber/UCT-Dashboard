# tests/test_catalyst_tuning.py
"""Tests for the evidence-based catalyst auto-tuning feature.

Each test isolates the SQLite catalysts DB + overrides JSON via tmp paths +
importlib.reload so module-level _DB_PATH / _OVERRIDES_PATH pick up the env.
"""
import importlib

import pytest


# ─────────────────────────────────────────────────────────────────────────
# TASK A — store enrichment + recent_feedback accessor
# ─────────────────────────────────────────────────────────────────────────

def _reload_store(monkeypatch, tmp_path):
    db = tmp_path / "catalysts.db"
    monkeypatch.setenv("CATALYST_DB_PATH", str(db))
    from api.services.catalyst import store as store_mod
    importlib.reload(store_mod)
    store_mod._init_db()
    return store_mod


def test_record_feedback_enriches_float_and_dollar_vol(monkeypatch, tmp_path):
    store = _reload_store(monkeypatch, tmp_path)
    monkeypatch.setattr(
        "api.services.catalyst.ticker_metadata.get_metadata",
        lambda ticker: {"float_shares": 12_000_000,
                        "shares_outstanding": 20_000_000,
                        "avg_volume_30d": 1_000_000},
    )
    store.record_feedback(
        user_id="u1", market_date="2026-06-15", ticker="junk",
        verdict="bad",
        row={"tag": "Gapper", "price": 4.0, "gap_pct": 8.0, "vol_x": 3.0},
    )
    rows = store.recent_feedback("bad", days=30)
    assert len(rows) == 1
    r = rows[0]
    assert r["ticker"] == "JUNK"
    assert r["float_shares"] == 12_000_000
    assert r["dollar_vol"] == 4.0 * 1_000_000
    importlib.reload(store)


def test_record_feedback_falls_back_to_shares_outstanding(monkeypatch, tmp_path):
    store = _reload_store(monkeypatch, tmp_path)
    monkeypatch.setattr(
        "api.services.catalyst.ticker_metadata.get_metadata",
        lambda ticker: {"float_shares": None,
                        "shares_outstanding": 7_000_000,
                        "avg_volume_30d": 500_000},
    )
    store.record_feedback(
        user_id="u1", market_date="2026-06-15", ticker="ABC",
        verdict="bad", row={"price": 10.0},
    )
    rows = store.recent_feedback("bad", days=30)
    assert rows[0]["float_shares"] == 7_000_000
    importlib.reload(store)


def test_recent_feedback_filters_by_verdict_and_window(monkeypatch, tmp_path):
    store = _reload_store(monkeypatch, tmp_path)
    monkeypatch.setattr(
        "api.services.catalyst.ticker_metadata.get_metadata",
        lambda ticker: {},
    )
    store.record_feedback(user_id="u", market_date="2026-06-15", ticker="GOOD",
                          verdict="good", row={"price": 50.0})
    store.record_feedback(user_id="u", market_date="2026-06-15", ticker="BAD",
                          verdict="bad", row={"price": 4.0})
    assert [r["ticker"] for r in store.recent_feedback("bad")] == ["BAD"]
    assert [r["ticker"] for r in store.recent_feedback("good")] == ["GOOD"]
    # A negative window puts the cutoff in the future -> nothing in range.
    assert store.recent_feedback("bad", days=-1) == []
    importlib.reload(store)
