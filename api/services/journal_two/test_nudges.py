"""Tests for the Phase F nudges service."""
from __future__ import annotations

import importlib
import os
import sqlite3
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest


ET = ZoneInfo("America/New_York")


@pytest.fixture
def db_conn(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = sqlite3.connect(tmp.name)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()
    os.unlink(tmp.name)


def _seed_account(db_conn, user_id="u_nudge"):
    from api.services.journal_two import accounts as accounts_service
    return accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)


def _insert_trade(conn, *, user_id, account_id, result, exit_iso):
    conn.execute(
        """
        INSERT INTO j2_trades (
            id, user_id, position_id, symbol, side, shares,
            entry_price, entry_date, exit_price, exit_date,
            original_stop, setup, notes, pnl_dollar, pnl_percent,
            r_multiple, hold_days, result, context_at_entry,
            created_at, account_id
        )
        VALUES (?, ?, ?, 'TEST', 'Long', 100, 100, ?, 99, ?, 99,
                NULL, NULL, ?, -1, NULL, 1, ?, '{}', ?, ?)
        """,
        (
            str(uuid.uuid4()), user_id, str(uuid.uuid4()),
            exit_iso, exit_iso, -100 if result == "Loss" else 100, result,
            exit_iso, account_id,
        ),
    )
    conn.commit()


def _insert_position(conn, *, user_id, account_id, entry_date_iso, notes=None, closed_at=None):
    conn.execute(
        """
        INSERT INTO j2_positions (
            id, user_id, symbol, side, entry_date, shares, original_shares,
            entry_price, stop_price, notes, context_at_entry,
            created_at, updated_at, closed_at, account_id
        )
        VALUES (?, ?, 'TEST', 'Long', ?, 100, 100, 100, 95, ?, '{}', ?, ?, ?, ?)
        """,
        (
            str(uuid.uuid4()), user_id, entry_date_iso, notes,
            entry_date_iso, entry_date_iso, closed_at, account_id,
        ),
    )
    conn.commit()


def test_no_trades_no_positions_returns_zeros(db_conn):
    from api.services.journal_two import nudges
    acc = _seed_account(db_conn)
    out = nudges.get_nudges_state("u_nudge", acc["id"], conn=db_conn)
    assert out["lossStreakCount"] == 0
    assert out["winStreakCount"] == 0
    assert out["staleCount"] == 0
    assert out["thresholds"] == {"loss": 3, "win": 5, "staleDays": 30}


def test_loss_streak_counts_consecutive_today(db_conn):
    from api.services.journal_two import nudges
    acc = _seed_account(db_conn)
    today_utc = datetime.now(timezone.utc).isoformat()
    # 3 losses today
    for _ in range(3):
        _insert_trade(db_conn, user_id="u_nudge", account_id=acc["id"], result="Loss", exit_iso=today_utc)
    out = nudges.get_nudges_state("u_nudge", acc["id"], conn=db_conn)
    assert out["lossStreakCount"] == 3


def test_loss_streak_resets_on_day_boundary(db_conn):
    from api.services.journal_two import nudges
    acc = _seed_account(db_conn)
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    today_utc = datetime.now(timezone.utc).isoformat()
    # 1 loss yesterday + 2 losses today → only today's count
    _insert_trade(db_conn, user_id="u_nudge", account_id=acc["id"], result="Loss", exit_iso=yesterday)
    _insert_trade(db_conn, user_id="u_nudge", account_id=acc["id"], result="Loss", exit_iso=today_utc)
    _insert_trade(db_conn, user_id="u_nudge", account_id=acc["id"], result="Loss", exit_iso=today_utc)
    out = nudges.get_nudges_state("u_nudge", acc["id"], conn=db_conn)
    assert out["lossStreakCount"] == 2


def test_win_streak_counts_consecutive_across_days(db_conn):
    from api.services.journal_two import nudges
    acc = _seed_account(db_conn)
    # 5 wins spread across days — winStreakCount = 5 (no day restriction)
    for i in range(5):
        when = (datetime.now(timezone.utc) - timedelta(days=4 - i)).isoformat()
        _insert_trade(db_conn, user_id="u_nudge", account_id=acc["id"], result="Win", exit_iso=when)
    out = nudges.get_nudges_state("u_nudge", acc["id"], conn=db_conn)
    assert out["winStreakCount"] == 5


def test_bounded_limit_returns_same_streak_for_short_history(db_conn):
    from api.services.journal_two import nudges
    acc = _seed_account(db_conn)
    # A short win streak — the bounded celebration read (limit=60) must return
    # the identical streak the unbounded header read does.
    for i in range(4):
        when = (datetime.now(timezone.utc) - timedelta(days=3 - i)).isoformat()
        _insert_trade(db_conn, user_id="u_nudge", account_id=acc["id"], result="Win", exit_iso=when)
    unbounded = nudges.get_nudges_state("u_nudge", acc["id"], conn=db_conn)
    bounded = nudges.get_nudges_state("u_nudge", acc["id"], conn=db_conn, limit=60)
    assert bounded["winStreakCount"] == unbounded["winStreakCount"] == 4


def test_stale_position_with_no_notes_counts(db_conn):
    from api.services.journal_two import nudges
    acc = _seed_account(db_conn)
    old = (datetime.now(timezone.utc) - timedelta(days=45)).isoformat()
    _insert_position(db_conn, user_id="u_nudge", account_id=acc["id"], entry_date_iso=old, notes=None)
    out = nudges.get_nudges_state("u_nudge", acc["id"], conn=db_conn)
    assert out["staleCount"] == 1


def test_stale_position_with_notes_does_not_count(db_conn):
    from api.services.journal_two import nudges
    acc = _seed_account(db_conn)
    old = (datetime.now(timezone.utc) - timedelta(days=45)).isoformat()
    _insert_position(db_conn, user_id="u_nudge", account_id=acc["id"], entry_date_iso=old, notes="reviewed")
    out = nudges.get_nudges_state("u_nudge", acc["id"], conn=db_conn)
    assert out["staleCount"] == 0
