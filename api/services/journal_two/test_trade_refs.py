import sqlite3
from api.services.journal_two import db as j2db
from api.services.journal_two.trade_refs import (
    trade_ref_for_row, resolve_trade_by_ref, orphaned_refs,
)


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    j2db.ensure_schema(conn)
    conn.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares,"
        " entry_price, entry_date, exit_price, exit_date, original_stop,"
        " pnl_dollar, pnl_percent, hold_days, result, context_at_entry, created_at,"
        " source, external_id) VALUES"
        " ('m1','u1','p1','NVDA','Long',10,100,'2026-01-02',110,'2026-01-03',95,"
        " 100,10,1,'Win','{}','2026-01-01',NULL,NULL),"
        " ('b1','u1','p2','TSLA','Long',5,200,'2026-01-02',210,'2026-01-03',195,"
        " 50,5,1,'Win','{}','2026-01-01','broker','bk:abc')"
    )
    return conn


def test_ref_shapes():
    conn = _conn()
    manual = conn.execute("SELECT * FROM j2_trades WHERE id='m1'").fetchone()
    broker = conn.execute("SELECT * FROM j2_trades WHERE id='b1'").fetchone()
    assert trade_ref_for_row(manual) == "id:m1"
    assert trade_ref_for_row(broker) == "ext:bk:abc"


def test_resolve_and_orphans():
    conn = _conn()
    assert resolve_trade_by_ref("u1", "id:m1", conn)["id"] == "m1"
    assert resolve_trade_by_ref("u1", "ext:bk:abc", conn)["id"] == "b1"
    assert resolve_trade_by_ref("u1", "ext:bk:GONE", conn) is None
    assert orphaned_refs("u1", ["id:m1", "ext:bk:abc", "ext:bk:GONE"], conn) == ["ext:bk:GONE"]
