import sqlite3
from api.services.journal_two import db as j2db
from api.services.journal_two.trading_day_backfill import run_backfill


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    j2db.ensure_schema(conn)
    return conn


def _insert_legacy_trade(conn, trade_id, exit_date):
    # Simulates a pre-spine row: trading_day_et NULL. The NOT NULL P&L /
    # result / context columns are filled with inert values — the backfill
    # only reads id/user_id/symbol/exit_date, so they don't affect behavior.
    conn.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares,"
        " entry_price, entry_date, exit_price, exit_date, original_stop,"
        " pnl_dollar, pnl_percent, hold_days, result, context_at_entry, created_at)"
        " VALUES (?, 'u1', 'p1', 'NVDA', 'Long', 10, 100, ?, 110, ?, 95,"
        " 100, 0.1, 1, 'Win', '{}', '2026-01-01')",
        (trade_id, exit_date, exit_date),
    )


def test_backfill_fills_nulls_and_reports_moved_days():
    conn = _conn()
    _insert_legacy_trade(conn, "t1", "2026-04-19T00:00:00Z")   # date-only: moves 04-18 -> 04-19
    _insert_legacy_trade(conn, "t2", "2026-04-19T14:30:00Z")   # real ts: stays 04-19
    result = run_backfill(conn=conn)
    assert result["trades_updated"] == 2
    days = dict(conn.execute("SELECT id, trading_day_et FROM j2_trades").fetchall())
    assert days == {"t1": "2026-04-19", "t2": "2026-04-19"}
    moved = result["moved_days"]
    assert len(moved) == 1 and moved[0]["trade_id"] == "t1"
    assert moved[0]["old_day"] == "2026-04-18" and moved[0]["new_day"] == "2026-04-19"


def test_backfill_is_idempotent():
    conn = _conn()
    _insert_legacy_trade(conn, "t1", "2026-04-19T14:30:00Z")
    run_backfill(conn=conn)
    second = run_backfill(conn=conn)
    assert second["trades_updated"] == 0
