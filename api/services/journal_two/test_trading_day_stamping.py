"""Every j2_trades/option write path stamps trading_day_et (+hour_et)."""
import sqlite3
from api.services.journal_two import db as j2db
from api.services.journal_two import trades as trades_service


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    j2db.ensure_schema(conn)
    return conn


SETTINGS = {"breakevenRange": {"enabled": False, "unit": "$", "value": 0}}


def test_manual_create_stamps_date_only_verbatim():
    conn = _conn()
    trades_service.create_trade_manual(
        "u1",
        {"symbol": "NVDA", "side": "Long", "shares": 10, "entryPrice": 100,
         "entryDate": "2026-04-19", "exitPrice": 110, "exitDate": "2026-04-19"},
        SETTINGS, conn=conn,
    )
    row = conn.execute("SELECT trading_day_et, hour_et FROM j2_trades").fetchone()
    assert row["trading_day_et"] == "2026-04-19"   # NOT 2026-04-18
    assert row["hour_et"] is None


def test_bulk_insert_stamps_real_timestamps_in_et():
    conn = _conn()
    trades_service.bulk_insert_trades(
        "u1",
        [{"symbol": "TSLA", "side": "Long", "shares": 5, "entryPrice": 200,
          "entryDate": "2026-04-19T13:00:00Z", "exitPrice": 210,
          "exitDate": "2026-04-20T01:00:00Z",  # 21:00 ET on the 19th
          "originalStop": 195, "setup": None, "notes": None,
          "externalId": "bk:test1"}],
        SETTINGS, conn=conn, account_id="a1", source="broker",
    )
    row = conn.execute("SELECT trading_day_et, hour_et FROM j2_trades").fetchone()
    assert row["trading_day_et"] == "2026-04-19"
    assert row["hour_et"] == 21
