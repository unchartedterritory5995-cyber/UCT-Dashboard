"""Tests for the per-setup performance stats."""
from __future__ import annotations

import importlib
import os
import sqlite3
import tempfile
import uuid
from datetime import datetime, timezone

import pytest


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


def _seed_account(db_conn, user_id="u_stats"):
    from api.services.journal_two import accounts as accounts_service
    return accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)


def _insert_trade(conn, *, user_id, account_id, setup, result, pnl_dollar, r_multiple, exit_iso=None):
    exit_iso = exit_iso or datetime.now(timezone.utc).isoformat()
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
                ?, NULL, ?, -1, ?, 1, ?, '{}', ?, ?)
        """,
        (
            str(uuid.uuid4()), user_id, str(uuid.uuid4()),
            exit_iso, exit_iso, setup, pnl_dollar, r_multiple, result,
            exit_iso, account_id,
        ),
    )
    conn.commit()


def test_no_trades_returns_empty_record(db_conn):
    from api.services.journal_two import setup_stats
    acc = _seed_account(db_conn)
    out = setup_stats.get_setup_stats("u_stats", acc["id"], "Bull Flag", conn=db_conn)
    assert out["setup"] == "Bull Flag"
    assert out["tradeCount"] == 0
    assert out["winCount"] == 0
    assert out["lastFive"] == []
    assert out["winRate"] is None
    assert out["avgR"] is None


def test_aggregates_trades_for_one_setup(db_conn):
    from api.services.journal_two import setup_stats
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_stats", account_id=acc["id"], setup="Bull Flag", result="Win", pnl_dollar=300, r_multiple=2.0)
    _insert_trade(db_conn, user_id="u_stats", account_id=acc["id"], setup="Bull Flag", result="Win", pnl_dollar=200, r_multiple=1.5)
    _insert_trade(db_conn, user_id="u_stats", account_id=acc["id"], setup="Bull Flag", result="Win", pnl_dollar=100, r_multiple=1.0)
    _insert_trade(db_conn, user_id="u_stats", account_id=acc["id"], setup="Bull Flag", result="Loss", pnl_dollar=-100, r_multiple=-1.0)
    _insert_trade(db_conn, user_id="u_stats", account_id=acc["id"], setup="Bull Flag", result="Loss", pnl_dollar=-100, r_multiple=-1.0)
    _insert_trade(db_conn, user_id="u_stats", account_id=acc["id"], setup="Bull Flag", result="BE", pnl_dollar=0, r_multiple=0.0)
    out = setup_stats.get_setup_stats("u_stats", acc["id"], "Bull Flag", conn=db_conn)
    assert out["tradeCount"] == 6
    assert out["winCount"] == 3
    assert out["lossCount"] == 2
    assert out["beCount"] == 1
    assert abs(out["winRate"] - 0.6) < 1e-6
    assert abs(out["avgR"] - (2.5 / 6)) < 1e-6
    assert abs(out["totalR"] - 2.5) < 1e-6
    assert out["totalPnlDollar"] == 400


def test_filters_by_account_and_setup(db_conn):
    from api.services.journal_two import setup_stats
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_stats", account_id=acc["id"], setup="Pullback", result="Win", pnl_dollar=100, r_multiple=1.0)
    _insert_trade(db_conn, user_id="u_other", account_id=acc["id"], setup="Bull Flag", result="Win", pnl_dollar=100, r_multiple=1.0)
    out = setup_stats.get_setup_stats("u_stats", acc["id"], "Bull Flag", conn=db_conn)
    assert out["tradeCount"] == 0


def test_last_five_in_chronological_order(db_conn):
    from api.services.journal_two import setup_stats
    acc = _seed_account(db_conn)
    sequence = [
        ("Win", 1.0, "2026-01-01T00:00:00+00:00"),
        ("Loss", -1.0, "2026-01-02T00:00:00+00:00"),
        ("Win", 1.0, "2026-01-03T00:00:00+00:00"),
        ("Loss", -1.0, "2026-01-04T00:00:00+00:00"),
        ("BE", 0.0, "2026-01-05T00:00:00+00:00"),
        ("Win", 1.0, "2026-01-06T00:00:00+00:00"),
        ("Loss", -1.0, "2026-01-07T00:00:00+00:00"),
    ]
    for result, r, iso in sequence:
        _insert_trade(db_conn, user_id="u_stats", account_id=acc["id"], setup="Bull Flag", result=result, pnl_dollar=100 * r, r_multiple=r, exit_iso=iso)
    out = setup_stats.get_setup_stats("u_stats", acc["id"], "Bull Flag", conn=db_conn)
    assert out["lastFive"] == ["W", "L", "B", "W", "L"]
