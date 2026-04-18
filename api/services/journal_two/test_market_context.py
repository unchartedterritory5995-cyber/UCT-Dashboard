"""Market-context snapshot — pulls from engine.get_breadth, never fabricates."""

import os
import sqlite3
import tempfile

import pytest


@pytest.fixture
def db_conn(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)

    import importlib
    from api.services import auth_db
    importlib.reload(auth_db)

    auth_db.init_db()
    conn = sqlite3.connect(tmp.name)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()
    os.unlink(tmp.name)


_DEFAULT_SETTINGS = {
    "journalColumns": {"marketNavIndex": "NYA", "breadthMetric": "NASI RSI"},
}


def test_snapshot_with_happy_path_breadth(monkeypatch, db_conn):
    """rallyDay + breadthValue pulled from the mocked engine.get_breadth."""
    import api.services.journal_two.market_context as mc

    monkeypatch.setattr(
        "api.services.engine.get_breadth",
        lambda: {"rally_day_count": 7, "breadth_score": 62.5, "market_phase": "Confirmed Uptrend"},
    )

    snap = mc.build_snapshot("u1", _DEFAULT_SETTINGS, conn=db_conn)
    assert snap["rallyDay"] == "D7"
    assert snap["breadthValue"] == 62.5
    assert snap["powerTrend"] is None  # deferred rule — user direction 2026-04-17
    assert snap["navCount"] == 0
    assert snap["breadthMetricName"] == "NASI RSI"
    assert snap["indexName"] == "NYA"
    assert snap["igRank"] is None
    assert snap["rsRating"] is None


def test_rally_day_null_when_engine_returns_zero(monkeypatch, db_conn):
    """rally_day_count of 0 → rallyDay null (no rally)."""
    import api.services.journal_two.market_context as mc

    monkeypatch.setattr(
        "api.services.engine.get_breadth",
        lambda: {"rally_day_count": 0, "breadth_score": 40.0},
    )

    snap = mc.build_snapshot("u1", _DEFAULT_SETTINGS, conn=db_conn)
    assert snap["rallyDay"] is None


def test_snapshot_when_engine_throws(monkeypatch, db_conn):
    """engine.get_breadth raises → snapshot still returns, with null context."""
    import api.services.journal_two.market_context as mc

    def _boom():
        raise RuntimeError("engine offline")

    monkeypatch.setattr("api.services.engine.get_breadth", _boom)

    snap = mc.build_snapshot("u1", _DEFAULT_SETTINGS, conn=db_conn)
    assert snap["rallyDay"] is None
    assert snap["breadthValue"] is None
    assert snap["powerTrend"] is None
    assert snap["navCount"] == 0
    # Metric name still captured from settings even when the feed failed
    assert snap["breadthMetricName"] == "NASI RSI"
    assert snap["indexName"] == "NYA"


def test_nav_count_reflects_existing_open_positions(monkeypatch, db_conn):
    """navCount captures the count BEFORE a new position would be inserted."""
    import api.services.journal_two.market_context as mc
    from api.services.journal_two.test_positions import _insert_position

    monkeypatch.setattr("api.services.engine.get_breadth", lambda: {})

    _insert_position(db_conn, "u1", symbol="A")
    _insert_position(db_conn, "u1", symbol="B")
    _insert_position(db_conn, "u1", symbol="C", closed=True)  # closed — excluded

    snap = mc.build_snapshot("u1", _DEFAULT_SETTINGS, conn=db_conn)
    assert snap["navCount"] == 2


def test_snapshot_uses_current_settings_for_names(monkeypatch, db_conn):
    """breadthMetricName + indexName snapshot from settings at capture time."""
    import api.services.journal_two.market_context as mc

    monkeypatch.setattr("api.services.engine.get_breadth", lambda: {})

    snap = mc.build_snapshot(
        "u1",
        {"journalColumns": {"marketNavIndex": "IWM", "breadthMetric": "% Above 50MA"}},
        conn=db_conn,
    )
    assert snap["indexName"] == "IWM"
    assert snap["breadthMetricName"] == "% Above 50MA"
