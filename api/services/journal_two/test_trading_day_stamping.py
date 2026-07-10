"""Every j2_trades/option write path stamps trading_day_et (+hour_et)."""
import sqlite3
import pytest
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


def test_manual_create_with_exit_time_et_combines_to_utc_and_stamps_hour():
    """exitTimeEt combines date+time as ET-local → DST-correct UTC instant →
    P1a stamping computes the real ET hour."""
    conn = _conn()
    trade = trades_service.create_trade_manual(
        "u1",
        {"symbol": "NVDA", "side": "Long", "shares": 10, "entryPrice": 100,
         "entryDate": "2026-04-19", "exitPrice": 110, "exitDate": "2026-04-19",
         "exitTimeEt": "10:30"},
        SETTINGS, conn=conn,
    )
    # 10:30 ET on 2026-04-19 is EDT (UTC-4) → 14:30 UTC
    assert trade["exitDate"] == "2026-04-19T14:30:00+00:00"
    row = conn.execute(
        "SELECT exit_date, trading_day_et, hour_et FROM j2_trades"
    ).fetchone()
    assert row["exit_date"] == "2026-04-19T14:30:00+00:00"
    assert row["trading_day_et"] == "2026-04-19"
    assert row["hour_et"] == 10


def test_manual_create_with_entry_time_et_combines_to_utc():
    conn = _conn()
    trade = trades_service.create_trade_manual(
        "u1",
        {"symbol": "NVDA", "side": "Long", "shares": 10, "entryPrice": 100,
         "entryDate": "2026-04-19", "entryTimeEt": "09:45",
         "exitPrice": 110, "exitDate": "2026-04-19"},
        SETTINGS, conn=conn,
    )
    # 09:45 ET (EDT, UTC-4) → 13:45 UTC
    assert trade["entryDate"] == "2026-04-19T13:45:00+00:00"


def test_manual_create_without_time_keeps_date_only_null_hour():
    """Absent time → the existing UTC-midnight date-only convention, NULL hour."""
    conn = _conn()
    trade = trades_service.create_trade_manual(
        "u1",
        {"symbol": "NVDA", "side": "Long", "shares": 10, "entryPrice": 100,
         "entryDate": "2026-04-19", "exitPrice": 110, "exitDate": "2026-04-19"},
        SETTINGS, conn=conn,
    )
    assert trade["exitDate"] == "2026-04-19T00:00:00+00:00"
    assert trade["entryDate"] == "2026-04-19T00:00:00+00:00"
    row = conn.execute("SELECT hour_et FROM j2_trades").fetchone()
    assert row["hour_et"] is None


def test_manual_create_empty_time_string_is_date_only():
    """An empty-string time is treated as absent (FE sends null, but be lenient)."""
    conn = _conn()
    trade = trades_service.create_trade_manual(
        "u1",
        {"symbol": "NVDA", "side": "Long", "shares": 10, "entryPrice": 100,
         "entryDate": "2026-04-19", "exitPrice": 110, "exitDate": "2026-04-19",
         "entryTimeEt": "", "exitTimeEt": None},
        SETTINGS, conn=conn,
    )
    assert trade["exitDate"] == "2026-04-19T00:00:00+00:00"


def test_manual_create_rejects_malformed_time():
    conn = _conn()
    with pytest.raises(trades_service.ManualTradeValidationError):
        trades_service.create_trade_manual(
            "u1",
            {"symbol": "NVDA", "side": "Long", "shares": 10, "entryPrice": 100,
             "entryDate": "2026-04-19", "exitPrice": 110, "exitDate": "2026-04-19",
             "exitTimeEt": "25:99"},
            SETTINGS, conn=conn,
        )


def test_manual_create_rejects_non_hhmm_time():
    conn = _conn()
    with pytest.raises(trades_service.ManualTradeValidationError):
        trades_service.create_trade_manual(
            "u1",
            {"symbol": "NVDA", "side": "Long", "shares": 10, "entryPrice": 100,
             "entryDate": "2026-04-19", "exitPrice": 110, "exitDate": "2026-04-19",
             "entryTimeEt": "9:5"},
            SETTINGS, conn=conn,
        )
