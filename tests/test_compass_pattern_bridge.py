"""Tests for the Compass × Pattern Engine bridge.

Three voice tools wrap the existing pattern engine REST surface:
  - find_patterns_on_ticker(symbol, tf?, min_conf?)
  - scan_active_patterns(types?, tf?, min_conf?, category?, limit?)
  - list_pattern_types(category?)
"""

import importlib
import os
import sqlite3
import tempfile
import time

import pytest


@pytest.fixture
def db_conn(monkeypatch):
    # Pattern tables live in their own DB (pattern_db) since 2026-07-16 —
    # the tools read patterns.db, so that's what this fixture seeds.
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("PATTERN_DB_PATH", tmp.name)
    from api.services.pattern_engine import pattern_db
    pattern_db._initialized_paths.clear()
    pattern_db.init_db()
    conn = sqlite3.connect(tmp.name)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()
    pattern_db._initialized_paths.clear()
    os.unlink(tmp.name)


def row_id_marker(kwargs):
    return f"{kwargs.get('sym', 'X')}_{kwargs.get('pattern_id', 'p')}_{int(time.time() * 1000) % 1000000}"


def _seed_detection(conn, **kwargs):
    """Insert a pattern_detection row. Sensible defaults for everything."""
    import uuid
    now = int(time.time())
    row = {
        "id": kwargs.get("id") or str(uuid.uuid4()),
        "sym": kwargs.get("sym", "TEST"),
        "tf": kwargs.get("tf", "D"),
        "pattern_id": kwargs.get("pattern_id", "bull_flag"),
        "category": kwargs.get("category", "classical"),
        "direction": kwargs.get("direction", "bullish"),
        "start_t": kwargs.get("start_t", now - 86400 * 30),
        "end_t": kwargs.get("end_t", now),
        "confidence": kwargs.get("confidence", 75.0),
        "quality_json": kwargs.get("quality_json", "{}"),
        "geometry_json": kwargs.get("geometry_json", "{}"),
        "levels_json": kwargs.get("levels_json",
            '{"entry": 120.5, "stop": 115.2, "target_primary": 135.0}'),
        "context_json": kwargs.get("context_json", "{}"),
        "narrative_json": kwargs.get("narrative_json", '{"headline": "test"}'),
        "status": kwargs.get("status", "ready"),
        "detected_at": kwargs.get("detected_at", now),
        "last_seen_at": kwargs.get("last_seen_at", now),
        "hash_key": kwargs.get("hash_key") or f"hash_{row_id_marker(kwargs)}",
    }
    cols = ",".join(row.keys())
    placeholders = ",".join(["?"] * len(row))
    conn.execute(
        f"INSERT INTO pattern_detections ({cols}) VALUES ({placeholders})",
        list(row.values()),
    )
    conn.commit()
    return row["id"]


# ── list_pattern_types ───────────────────────────────────────────────────────

def test_list_pattern_types_returns_50_patterns():
    from api.services.voice_tool_impls import _list_pattern_types
    out = _list_pattern_types()
    assert out["ok"] is True
    assert out["count"] >= 40  # 50 detectors registered, some may not have metadata
    assert "patterns" in out
    assert out["narration"]


def test_list_pattern_types_filters_by_category():
    from api.services.voice_tool_impls import _list_pattern_types
    cl = _list_pattern_types(category="classical")
    cs = _list_pattern_types(category="candlestick")
    uct = _list_pattern_types(category="uct")
    assert cl["count"] > 0
    assert cs["count"] > 0
    assert uct["count"] > 0
    # All items in classical result should be classical
    assert all(p["category"] == "classical" for p in cl["patterns"])
    assert all(p["category"] == "candlestick" for p in cs["patterns"])


def test_list_pattern_types_unknown_category_returns_zero():
    from api.services.voice_tool_impls import _list_pattern_types
    out = _list_pattern_types(category="nonexistent")
    assert out["ok"] is True
    assert out["count"] == 0


# ── find_patterns_on_ticker ──────────────────────────────────────────────────

def test_find_patterns_returns_no_patterns_for_unknown_ticker(db_conn):
    from api.services.voice_tool_impls import _find_patterns_on_ticker
    out = _find_patterns_on_ticker(symbol="ZZZ_NONEXISTENT", tf="D")
    assert out["ok"] is True
    assert out["count"] == 0
    assert "No active patterns" in out["narration"]


def test_find_patterns_returns_active_detections(db_conn):
    _seed_detection(db_conn, sym="NVDA", pattern_id="bull_flag",
                    confidence=82.0, status="ready", tf="D")
    _seed_detection(db_conn, sym="NVDA", pattern_id="high_tight_flag",
                    confidence=78.0, status="forming", tf="D")
    _seed_detection(db_conn, sym="NVDA", pattern_id="vcp",
                    confidence=60.0, status="ready", tf="D")

    from api.services.voice_tool_impls import _find_patterns_on_ticker
    out = _find_patterns_on_ticker(symbol="NVDA", tf="D", min_conf=70.0)
    assert out["ok"] is True
    assert out["count"] == 2  # vcp filtered out by min_conf
    assert out["symbol"] == "NVDA"
    # First detection should be highest confidence
    assert out["detections"][0]["confidence"] >= out["detections"][1]["confidence"]
    assert "NVDA" in out["narration"]


def test_find_patterns_rejects_missing_symbol():
    from api.services.voice_tool_impls import _find_patterns_on_ticker
    out = _find_patterns_on_ticker(symbol="", tf="D")
    assert out["ok"] is False
    assert "Symbol required" in out["narration"]


# ── scan_active_patterns ─────────────────────────────────────────────────────

def test_scan_returns_empty_when_no_data(db_conn):
    from api.services.voice_tool_impls import _scan_active_patterns
    out = _scan_active_patterns(min_conf=70, tf="D")
    assert out["ok"] is True
    assert out["count"] == 0
    assert "No active patterns" in out["narration"]


def test_scan_returns_recent_detections(db_conn):
    _seed_detection(db_conn, sym="AAPL", pattern_id="bull_flag",
                    confidence=85.0, status="ready")
    _seed_detection(db_conn, sym="TSLA", pattern_id="high_tight_flag",
                    confidence=80.0, status="forming")
    _seed_detection(db_conn, sym="QQQ", pattern_id="bear_flag",
                    confidence=72.0, direction="bearish", status="ready")

    from api.services.voice_tool_impls import _scan_active_patterns
    out = _scan_active_patterns(min_conf=70, tf="D", limit=10)
    assert out["ok"] is True
    assert out["count"] == 3
    syms = {d["sym"] for d in out["detections"]}
    assert syms == {"AAPL", "TSLA", "QQQ"}


def test_scan_filters_by_types(db_conn):
    _seed_detection(db_conn, sym="AAPL", pattern_id="bull_flag", confidence=85.0)
    _seed_detection(db_conn, sym="TSLA", pattern_id="vcp", confidence=80.0)
    _seed_detection(db_conn, sym="QQQ", pattern_id="bear_flag",
                    confidence=80.0, direction="bearish")

    from api.services.voice_tool_impls import _scan_active_patterns
    out = _scan_active_patterns(types="bull_flag,vcp", min_conf=70, tf="D")
    assert out["count"] == 2
    pids = {d["pattern_id"] for d in out["detections"]}
    assert pids == {"bull_flag", "vcp"}


def test_scan_filters_by_category(db_conn):
    _seed_detection(db_conn, sym="AAPL", pattern_id="bull_flag",
                    category="classical", confidence=80.0)
    _seed_detection(db_conn, sym="TSLA", pattern_id="hammer",
                    category="candlestick", confidence=80.0)

    from api.services.voice_tool_impls import _scan_active_patterns
    out = _scan_active_patterns(category="candlestick", min_conf=70, tf="D")
    assert out["count"] == 1
    assert out["detections"][0]["sym"] == "TSLA"


def test_scan_excludes_stale_detections(db_conn):
    # Detection older than 7 days should be excluded by the recent cutoff
    old_t = int(time.time()) - 10 * 24 * 60 * 60
    _seed_detection(db_conn, sym="STALE", confidence=90.0,
                    detected_at=old_t, last_seen_at=old_t)
    _seed_detection(db_conn, sym="FRESH", confidence=80.0)

    from api.services.voice_tool_impls import _scan_active_patterns
    out = _scan_active_patterns(min_conf=70, tf="D")
    syms = {d["sym"] for d in out["detections"]}
    assert "FRESH" in syms
    assert "STALE" not in syms


# ── Registry + Compass allowlist wiring ──────────────────────────────────────

def test_tools_in_voice_registry():
    import api.services.voice_tool_impls  # noqa: F401 (triggers registration)
    from api.services.voice_tools import _REGISTRY
    assert "find_patterns_on_ticker" in _REGISTRY
    assert "scan_active_patterns" in _REGISTRY
    assert "list_pattern_types" in _REGISTRY


def test_tools_in_compass_allowlist():
    import api.services.voice_tool_impls  # noqa: F401
    from api.services.voice_agents import get_agent
    compass = get_agent("compass")
    allow = compass["tool_allowlist"]
    assert "find_patterns_on_ticker" in allow
    assert "scan_active_patterns" in allow
    assert "list_pattern_types" in allow


def test_tools_in_compass_chat_catalog():
    from api.services.journal_two.coach_chat_tools import TOOLS
    assert "find_patterns_on_ticker" in TOOLS
    assert "scan_active_patterns" in TOOLS
    assert "list_pattern_types" in TOOLS
    # Each entry has the required shape
    for k in ("find_patterns_on_ticker", "scan_active_patterns", "list_pattern_types"):
        t = TOOLS[k]
        assert callable(t["executor"])
        assert t["requires_confirm"] is False
        assert t["input_schema"]["type"] == "object"


# ── Compass Chat text-mode executor parity ───────────────────────────────────

def test_compass_chat_find_patterns_executor(db_conn):
    from api.services.journal_two.coach_chat_tools import TOOLS
    _seed_detection(db_conn, sym="AMD", pattern_id="cup_handle", confidence=85.0)
    out = TOOLS["find_patterns_on_ticker"]["executor"](
        user_id="u1", account_id="a1",
        args={"symbol": "AMD", "tf": "D", "min_conf": 70},
        conn=db_conn,
    )
    assert out["ok"] is True
    assert out["symbol"] == "AMD"
    assert out["count"] == 1
    assert out["detections"][0]["pattern_id"] == "cup_handle"
