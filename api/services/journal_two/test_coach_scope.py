"""Tests for resolve_account_scope — the single helper that turns a
caller-supplied account_id (real UUID or '_all_') into the list of
real account ids a Compass call should query."""
import sqlite3
import tempfile
import os
import uuid
from datetime import datetime, timezone
import pytest
from api.services.journal_two import coach_scope
from api.services.journal_two.db import ensure_schema


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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


def _seed_account(conn, user_id, name, compass_enabled=1) -> str:
    aid = str(uuid.uuid4())
    now = _now_iso()
    conn.execute(
        """INSERT INTO j2_accounts (
              id, user_id, name, color, starting_balance,
              account_size, default_stop, position_closing,
              breakeven_range, setups, share_journal_data, created_at, updated_at,
              compass_enabled
           ) VALUES (?, ?, ?, '#888888', 100000, 100000, '{"mode":"custom"}', 'FIFO',
                    '{"enabled":false,"unit":"$","value":0}', '[]', 0, ?, ?, ?)""",
        (aid, user_id, name, now, now, compass_enabled),
    )
    conn.commit()
    return aid


def test_resolve_real_account_id_returns_that_id(conn):
    aid = _seed_account(conn, "user-1", "Default")
    assert coach_scope.resolve_account_scope(conn, "user-1", aid) == [aid]


def test_resolve_all_sentinel_unions_enabled_accounts(conn):
    a1 = _seed_account(conn, "user-1", "Default", compass_enabled=1)
    a2 = _seed_account(conn, "user-1", "Cash", compass_enabled=1)
    a3 = _seed_account(conn, "user-1", "Excluded", compass_enabled=0)
    result = coach_scope.resolve_account_scope(conn, "user-1", "_all_")
    assert sorted(result) == sorted([a1, a2])
    assert a3 not in result


def test_resolve_all_sentinel_with_zero_enabled_returns_empty(conn):
    _seed_account(conn, "user-1", "Off", compass_enabled=0)
    result = coach_scope.resolve_account_scope(conn, "user-1", "_all_")
    assert result == []


def test_resolve_all_sentinel_ignores_other_users(conn):
    _seed_account(conn, "user-1", "Mine")
    _seed_account(conn, "user-2", "Theirs")
    result = coach_scope.resolve_account_scope(conn, "user-1", "_all_")
    assert len(result) == 1


def test_is_unified_helper():
    assert coach_scope.is_unified("_all_") is True
    assert coach_scope.is_unified("acc-abc") is False
    assert coach_scope.is_unified(None) is False
