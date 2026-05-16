"""Schema-level smoke tests for the j2_* tables."""
import sqlite3
import tempfile
import os
import pytest
from api.services.journal_two.db import ensure_schema


@pytest.fixture
def conn():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    c = sqlite3.connect(path)
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    yield c
    c.close()
    os.remove(path)


def test_j2_unified_coach_state_table_exists(conn):
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='j2_unified_coach_state'"
    ).fetchone()
    assert row is not None, "j2_unified_coach_state table missing from _J2_SCHEMA"


def test_j2_unified_coach_state_schema(conn):
    cols = {r["name"]: r for r in conn.execute(
        "PRAGMA table_info(j2_unified_coach_state)"
    ).fetchall()}
    assert set(cols.keys()) == {
        "user_id", "trader_profile", "compass_enabled",
        "onboarded", "onboarding_mode", "onboarding_session_id",
        "created_at", "updated_at",
    }
    assert cols["user_id"]["pk"] == 1
    assert cols["trader_profile"]["notnull"] == 1
    assert cols["compass_enabled"]["notnull"] == 1
