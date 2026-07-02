# api/services/test_brain_service.py
import json
import os
import shutil
import sqlite3
import sys
from pathlib import Path

import pytest

from api.services import brain_service

ENGINE_PKG = Path(__file__).resolve().parents[2] / "external" / "uct-intelligence" / "uct_intelligence"


def _make_brain(root, origin_trader="Qullamaggie"):
    """Build a packed brain layout (real engine code + tiny fixture DB) at root."""
    shutil.copytree(ENGINE_PKG, root / "uct_intelligence")
    data = root / "data"
    data.mkdir()
    conn = sqlite3.connect(str(data / "uct_intelligence.db"))
    conn.execute("""CREATE TABLE setup_templates (
        id INTEGER PRIMARY KEY, name TEXT, family TEXT, origin_trader TEXT,
        description TEXT, aliases TEXT, ideal_regime TEXT, sector_conditions TEXT,
        liquidity_min TEXT, float_requirements TEXT, catalyst_types TEXT,
        trend_requirements TEXT, ma_alignment TEXT, rs_requirements TEXT,
        entry_triggers TEXT, stop_methods TEXT, max_stop_pct REAL, addon_rules TEXT,
        profit_logic TEXT, invalidation TEXT, hold_time_range TEXT,
        common_mistakes TEXT, notes TEXT, active INTEGER DEFAULT 1)""")
    conn.execute(
        "INSERT INTO setup_templates (name, family, origin_trader, description, aliases,"
        " ideal_regime, entry_triggers, stop_methods, max_stop_pct, profit_logic,"
        " invalidation, common_mistakes, active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)",
        ("HTF", "Momentum Continuation", origin_trader, "High tight flag",
         json.dumps(["High Tight Flag", "HTF continuation"]), json.dumps(["GREEN", "YELLOW"]),
         json.dumps({"primary": "break of flag high on volume"}),
         json.dumps({"initial": "below flag low", "max_pct": 7.0}), 7.0,
         json.dumps({"first_target": "1.5R"}), json.dumps({"structural": "close below flag low"}),
         json.dumps(["chasing >5% past pivot"])),
    )
    conn.execute("""CREATE TABLE setup_performance (
        id INTEGER PRIMARY KEY, setup_type TEXT, regime_phase TEXT, total_trades INTEGER,
        wins INTEGER, losses INTEGER, win_rate_pct REAL, avg_gain_pct REAL,
        avg_loss_pct REAL, expectancy REAL)""")
    conn.execute("INSERT INTO setup_performance (setup_type, regime_phase, total_trades, wins,"
                 " losses, win_rate_pct, avg_gain_pct, avg_loss_pct, expectancy)"
                 " VALUES ('HTF','ALL',40,23,17,57.5,12.0,-4.0,0.9)")
    conn.execute("CREATE TABLE ep_candidates (id INTEGER PRIMARY KEY, symbol TEXT,"
                 " date_flagged TEXT, setup_type TEXT, thesis TEXT, company TEXT,"
                 " sector TEXT, entry_price REAL, status TEXT, source TEXT, created_at TEXT)")
    conn.execute("CREATE TABLE ep_follow_throughs (id INTEGER PRIMARY KEY, ep_id INTEGER,"
                 " symbol TEXT, check_date TEXT, current_price REAL, entry_price REAL,"
                 " pct_change REAL, days_held INTEGER, status TEXT, created_at TEXT)")
    conn.execute("CREATE TABLE market_regimes (id INTEGER PRIMARY KEY, regime_date TEXT,"
                 " phase TEXT)")
    conn.execute("CREATE TABLE knowledge_base (id INTEGER PRIMARY KEY, category TEXT, title TEXT,"
                 " content TEXT, tags TEXT, active INTEGER DEFAULT 1, source TEXT,"
                 " trader TEXT, regime_context TEXT, priority INTEGER, knowledge_epoch TEXT,"
                 " created_at TEXT, updated_at TEXT, source_ref TEXT)")
    conn.commit()
    conn.close()
    return root


@pytest.fixture()
def brain_env(tmp_path, monkeypatch):
    """Real engine code + a tiny fixture DB in the packed layout."""
    if not ENGINE_PKG.is_dir():
        pytest.skip("uct-intelligence submodule not checked out")
    root = _make_brain(tmp_path / "brain")
    monkeypatch.setenv("BRAIN_DIR", str(root))
    brain_service._reset_for_tests()
    yield root
    brain_service._reset_for_tests()


def test_unavailable_when_no_brain(tmp_path, monkeypatch):
    monkeypatch.setenv("BRAIN_DIR", str(tmp_path / "nope"))
    brain_service._reset_for_tests()
    assert brain_service.available() is False
    out = brain_service.lookup_playbook("HTF")
    assert out == {"ok": False, "error": "brain not available"}


def test_lookup_playbook_resolves_alias_and_joins_winrate(brain_env):
    out = brain_service.lookup_playbook("high tight flag")
    assert out["ok"] is True
    assert out["name"] == "HTF"
    assert out["max_stop_pct"] == 7.0
    assert out["winrate"]["win_rate_pct"] == 57.5
    assert "Qullamaggie" in out["source"]


def test_setup_winrate_small_sample_guard(brain_env):
    out = brain_service.setup_winrate("HTF")
    assert out["ok"] is True and out["total_trades"] == 40
    missing = brain_service.setup_winrate("VCP")
    assert missing["ok"] is False and "sample" in missing["reason"]


def test_size_a_trade_uses_regime_default_and_validates(brain_env, monkeypatch):
    monkeypatch.setattr(brain_service, "_current_regime", lambda: "GREEN")
    out = brain_service.size_a_trade(entry=100.0, stop=95.0, account=50000.0, grade="A+")
    assert out["ok"] is True and out["regime"] == "GREEN"
    assert out["shares"] > 0
    bad = brain_service.size_a_trade(entry=100.0, stop=100.0, account=50000.0)
    assert bad["ok"] is False


def test_reset_clears_stale_engine_module(tmp_path, monkeypatch):
    """_reset_for_tests must pop cached uct_intelligence modules so a new
    BRAIN_DIR serves the NEW pack's data, not Python's stale module cache."""
    if not ENGINE_PKG.is_dir():
        pytest.skip("uct-intelligence submodule not checked out")
    try:
        pack_a = _make_brain(tmp_path / "brain_a", origin_trader="Qullamaggie")
        monkeypatch.setenv("BRAIN_DIR", str(pack_a))
        brain_service._reset_for_tests()
        first = brain_service.lookup_playbook("HTF")
        assert first["ok"] is True and first["origin_trader"] == "Qullamaggie"

        pack_b = _make_brain(tmp_path / "brain_b", origin_trader="FAKE_TRADER")
        monkeypatch.setenv("BRAIN_DIR", str(pack_b))
        brain_service._reset_for_tests()
        second = brain_service.lookup_playbook("HTF")
        assert second["ok"] is True
        assert second["origin_trader"] == "FAKE_TRADER"
    finally:
        brain_service._reset_for_tests()
