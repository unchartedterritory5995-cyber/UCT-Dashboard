import sqlite3
from api.services.journal_two import db as j2db
from api.services.journal_two.trade_refs import (
    trade_ref_for_row, resolve_trade_by_ref, orphaned_refs, ref_is_live,
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
    # Option strategies are NOT in j2_trades — their annotations key on
    # `id:<strategy id>` (see excursion_engine.compute_for_option_strategy).
    conn.execute(
        "INSERT INTO j2_option_strategies (id, user_id, underlying, strategy_type,"
        " direction, net_entry, entry_date, context_at_entry, status, closed_at,"
        " created_at, updated_at) VALUES"
        " ('s1','u1','SPY','long_call','bullish',500,'2026-01-02','{}','closed',"
        " '2026-01-03','2026-01-01','2026-01-01'),"
        " ('s2','u2','QQQ','long_put','bearish',300,'2026-01-02','{}','closed',"
        " '2026-01-03','2026-01-01','2026-01-01')"
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


def test_ref_is_live_covers_option_strategies():
    conn = _conn()
    assert ref_is_live("u1", "id:m1", conn)        # equity trade
    assert ref_is_live("u1", "ext:bk:abc", conn)   # broker fingerprint
    # A live option strategy's ref is LIVE even though it's not in j2_trades
    # (the 2026-07-12 false-orphan bug: every closed strategy read as orphaned).
    assert ref_is_live("u1", "id:s1", conn)
    assert not ref_is_live("u1", "id:s2", conn)    # other user's strategy
    assert not ref_is_live("u1", "id:GONE", conn)
    assert not ref_is_live("u1", "ext:bk:GONE", conn)


def test_orphaned_refs_treats_live_strategy_as_live():
    conn = _conn()
    assert orphaned_refs("u1", ["id:s1", "id:GONE"], conn) == ["id:GONE"]
