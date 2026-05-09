"""Tests for the Phase B discipline state computation."""
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
    """Fresh temp DB per test, mirroring test_settings.py's pattern."""
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


def _baseline_payload():
    return {
        "accountSize": 100_000,
        "defaultStop": {"mode": "custom"},
        "positionClosing": "FIFO",
        "breakevenRange": {"enabled": False, "unit": "$", "value": 0},
        "setups": [],
        "shareJournalData": False,
        "tradingMode": "both",
    }


def _seed_account(db_conn, user_id="u_disc"):
    from api.services.journal_two import accounts as accounts_service
    return accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)


def _insert_trade(conn, *, user_id, account_id, pnl_dollar, exit_iso, result="Loss"):
    """Helper: insert one closed trade with a specific exit ISO timestamp.
    j2_trades.exit_date stores full ISO timestamps (not date-only)."""
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
            exit_iso, exit_iso, pnl_dollar, result,
            exit_iso, account_id,
        ),
    )
    conn.commit()


def test_no_settings_means_unlocked(db_conn):
    from api.services.journal_two import discipline as disc
    acc = _seed_account(db_conn)
    state = disc.compute_discipline_state("u_disc", acc["id"], conn=db_conn)
    assert state["locked"] is False
    assert state["reasons"] == []
    assert state["todaysPnlDollar"] == 0
    assert state["todaysPnlPct"] == 0


def test_daily_loss_limit_locks_when_breached(db_conn):
    from api.services.journal_two import discipline as disc
    from api.services.journal_two import accounts as accounts_service
    acc = _seed_account(db_conn)
    accounts_service.upsert_account_settings(
        "u_disc", acc["id"],
        {**_baseline_payload(), "dailyLossLimitPct": 2},
        conn=db_conn,
    )
    today_et = datetime.now(ET).date()
    exit_iso = datetime.combine(today_et, datetime.min.time(), tzinfo=ET).astimezone(timezone.utc).isoformat()
    _insert_trade(db_conn, user_id="u_disc", account_id=acc["id"], pnl_dollar=-2500, exit_iso=exit_iso)

    state = disc.compute_discipline_state("u_disc", acc["id"], conn=db_conn)
    assert state["locked"] is True
    assert any(r["type"] == "daily_loss" for r in state["reasons"])


def test_cooling_off_locks_within_window(db_conn):
    from api.services.journal_two import discipline as disc
    from api.services.journal_two import accounts as accounts_service
    acc = _seed_account(db_conn)
    accounts_service.upsert_account_settings(
        "u_disc", acc["id"],
        {**_baseline_payload(), "coolingOffMinutesAfterLoss": 15},
        conn=db_conn,
    )
    five_min_ago = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    _insert_trade(db_conn, user_id="u_disc", account_id=acc["id"], pnl_dollar=-100, exit_iso=five_min_ago)

    state = disc.compute_discipline_state("u_disc", acc["id"], conn=db_conn)
    cooling = next((r for r in state["reasons"] if r["type"] == "cooling_off"), None)
    assert cooling is not None
    assert "unlockAt" in cooling


def test_cooling_off_clears_after_window(db_conn):
    from api.services.journal_two import discipline as disc
    from api.services.journal_two import accounts as accounts_service
    acc = _seed_account(db_conn)
    accounts_service.upsert_account_settings(
        "u_disc", acc["id"],
        {**_baseline_payload(), "coolingOffMinutesAfterLoss": 15},
        conn=db_conn,
    )
    twenty_min_ago = (datetime.now(timezone.utc) - timedelta(minutes=20)).isoformat()
    _insert_trade(db_conn, user_id="u_disc", account_id=acc["id"], pnl_dollar=-100, exit_iso=twenty_min_ago)
    state = disc.compute_discipline_state("u_disc", acc["id"], conn=db_conn)
    assert not any(r["type"] == "cooling_off" for r in state["reasons"])


def test_no_trade_window_locks_during_window(db_conn):
    from api.services.journal_two import discipline as disc
    from api.services.journal_two import accounts as accounts_service
    acc = _seed_account(db_conn)
    now_et = datetime.now(ET)
    start = (now_et - timedelta(minutes=10)).strftime("%H:%M")
    end = (now_et + timedelta(minutes=10)).strftime("%H:%M")
    accounts_service.upsert_account_settings(
        "u_disc", acc["id"],
        {**_baseline_payload(), "noTradeWindowsET": [{"start": start, "end": end, "label": "Test"}]},
        conn=db_conn,
    )
    state = disc.compute_discipline_state("u_disc", acc["id"], conn=db_conn, now=now_et)
    assert any(r["type"] == "no_trade_window" for r in state["reasons"])


def test_multiple_reasons_can_fire_simultaneously(db_conn):
    from api.services.journal_two import discipline as disc
    from api.services.journal_two import accounts as accounts_service
    acc = _seed_account(db_conn)
    now_et = datetime.now(ET)
    accounts_service.upsert_account_settings(
        "u_disc", acc["id"],
        {**_baseline_payload(),
         "dailyLossLimitPct": 2,
         "coolingOffMinutesAfterLoss": 15,
         "noTradeWindowsET": [{"start": (now_et - timedelta(minutes=5)).strftime("%H:%M"),
                               "end":   (now_et + timedelta(minutes=5)).strftime("%H:%M"),
                               "label": "Test"}]},
        conn=db_conn,
    )
    exit_iso = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    _insert_trade(db_conn, user_id="u_disc", account_id=acc["id"], pnl_dollar=-3000, exit_iso=exit_iso)
    state = disc.compute_discipline_state("u_disc", acc["id"], conn=db_conn, now=now_et)
    types = {r["type"] for r in state["reasons"]}
    assert {"daily_loss", "cooling_off", "no_trade_window"} <= types
