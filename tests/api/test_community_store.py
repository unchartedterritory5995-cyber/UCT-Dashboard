# tests/api/test_community_store.py
import os
import sqlite3
import tempfile

import pytest


@pytest.fixture
def store(monkeypatch, tmp_path):
    """community_store pointed at a temp DB (path read dynamically per call)."""
    monkeypatch.setenv("COMMUNITY_DB_PATH", str(tmp_path / "community.db"))
    from api.services import community_store
    community_store._init_db()
    return community_store


def test_init_creates_tables(store):
    with store.get_connection() as conn:
        names = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    assert {"threads", "posts", "reactions", "reports",
            "read_state", "muted_users", "acks"} <= names


def test_spaces_fixed(store):
    assert set(store.SPACES) == {"mentor-desk", "trade-ideas", "questions", "wins-lessons"}
    assert store.SPACES["mentor-desk"]["mentor_only"] is True
    assert store.SPACES["trade-ideas"]["mentor_only"] is False
