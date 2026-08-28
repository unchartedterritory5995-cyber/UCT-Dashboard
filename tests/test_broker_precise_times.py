"""Precise execution times for date-only brokers.

Schwab stamps every transaction at midnight UTC, so trades reconstructed
from its feed carry no clock: hour-of-day analytics sit silently empty and
the trading-day spine leans on a date-string fallback. But the Recent
Orders rail SAW the true execution time in its provisional row —
prune_provisional now preserves it (j2_broker_precise_times, keyed by the
REAL activity's match key) and reconstruction re-applies it. The raw
ledger is never mutated; the memo survives the provisional's deletion, so
every future full reconstruction re-enriches deterministically.
"""

from __future__ import annotations

import pytest

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two.broker import activities_store, reconstruct


USER = "u1"
BACCT = "ba1"


@pytest.fixture
def env(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    acct = accounts_service.create_account(
        "u1", {"name": "Broker", "color": "blue", "startingBalance": 1.0}
    )
    return {"j2": acct["id"]}


def _equity(act_id, typ, sym, units, price, trade_date, provisional=False):
    act = {"id": act_id, "type": typ, "units": units, "price": price,
           "fee": 0, "symbol": {"symbol": sym}, "trade_date": trade_date,
           "currency": "USD"}
    if provisional:
        act["_provisional"] = True
    return act


PRECISE_BUY = "2026-08-27T14:52:59.859000Z"
PRECISE_SELL = "2026-08-27T19:10:11.000000Z"


def test_prune_preserves_the_provisional_clock(env):
    # The rail stored the fill with its real execution time…
    activities_store.store_activities(USER, BACCT, [
        _equity("intraday:th", "BUY", "TH", 150.0, 18.89, PRECISE_BUY,
                provisional=True),
    ])
    # …then the broker's midnight-stamped real transaction arrives and the
    # provisional is pruned.
    real = _equity("real-th", "BUY", "TH", 150.0, 18.89, "2026-08-27T00:00:00Z")
    activities_store.store_activities(USER, BACCT, [real])
    removed = activities_store.prune_provisional(USER, BACCT, [real])
    assert removed == 1
    conn = auth_db.get_connection()
    try:
        rows = [dict(r) for r in conn.execute(
            "SELECT match_key, precise_ts FROM j2_broker_precise_times")]
    finally:
        conn.close()
    assert len(rows) == 1
    assert rows[0]["precise_ts"] == PRECISE_BUY
    assert rows[0]["match_key"].startswith("TH|BUY|150.0|2026-08-27|")


def test_a_precise_real_activity_writes_no_memo(env):
    activities_store.store_activities(USER, BACCT, [
        _equity("intraday:x", "BUY", "TH", 150.0, 18.89, PRECISE_BUY,
                provisional=True),
    ])
    real = _equity("real-x", "BUY", "TH", 150.0, 18.89,
                   "2026-08-27T14:53:02Z")     # broker HAS a clock here
    activities_store.store_activities(USER, BACCT, [real])
    # The provisional itself is precise, so a memo row IS written (harmless)
    # — but a midnight-stamped PROVISIONAL must never write one:
    activities_store.store_activities(USER, BACCT, [
        _equity("intraday:y", "SELL", "ZZ", 10.0, 5.0, "2026-08-26T00:00:00Z",
                provisional=True),
    ])
    real2 = _equity("real-y", "SELL", "ZZ", 10.0, 5.0, "2026-08-26T00:00:00Z")
    activities_store.store_activities(USER, BACCT, [real2])
    activities_store.prune_provisional(USER, BACCT, [real, real2])
    conn = auth_db.get_connection()
    try:
        keys = [r["match_key"] for r in conn.execute(
            "SELECT match_key FROM j2_broker_precise_times")]
    finally:
        conn.close()
    assert not any(k.startswith("ZZ|") for k in keys)


def test_reconstruction_reapplies_the_clock_to_midnight_stamps(env):
    # Ledger state after the daily sync: only midnight-stamped REAL rows
    # remain (provisionals pruned) + the memo carries the true times.
    activities_store.store_activities(USER, BACCT, [
        _equity("intraday:b", "BUY", "TH", 150.0, 18.89, PRECISE_BUY,
                provisional=True),
        _equity("intraday:s", "SELL", "TH", 150.0, 19.40, PRECISE_SELL,
                provisional=True),
    ])
    real_buy = _equity("real-b", "BUY", "TH", 150.0, 18.89,
                       "2026-08-27T00:00:00Z")
    real_sell = _equity("real-s", "SELL", "TH", 150.0, 19.40,
                        "2026-08-27T00:00:00Z")
    activities_store.store_activities(USER, BACCT, [real_buy, real_sell])
    activities_store.prune_provisional(USER, BACCT, [real_buy, real_sell])

    acts = activities_store.get_activities(USER, BACCT)
    settings = accounts_service.get_account_settings(USER, env["j2"])
    out = reconstruct.reconstruct_account(USER, BACCT, env["j2"], acts, settings)
    assert out["imported"] == 1
    conn = auth_db.get_connection()
    try:
        t = conn.execute(
            "SELECT entry_date, exit_date, trading_day_et, hour_et "
            "FROM j2_trades WHERE user_id = ?", (USER,)).fetchone()
    finally:
        conn.close()
    assert t["entry_date"] == PRECISE_BUY        # real clock, not midnight
    assert t["exit_date"] == PRECISE_SELL
    assert t["trading_day_et"] == "2026-08-27"
    assert t["hour_et"] is not None              # time analytics wake up


def test_no_memo_leaves_the_ledger_untouched(env):
    real_buy = _equity("real-b", "BUY", "TH", 150.0, 18.89,
                       "2026-08-27T00:00:00Z")
    real_sell = _equity("real-s", "SELL", "TH", 150.0, 19.40,
                        "2026-08-27T00:00:00Z")
    activities_store.store_activities(USER, BACCT, [real_buy, real_sell])
    acts = activities_store.get_activities(USER, BACCT)
    settings = accounts_service.get_account_settings(USER, env["j2"])
    out = reconstruct.reconstruct_account(USER, BACCT, env["j2"], acts, settings)
    assert out["imported"] == 1
    conn = auth_db.get_connection()
    try:
        t = conn.execute(
            "SELECT entry_date, hour_et, trading_day_et FROM j2_trades "
            "WHERE user_id = ?", (USER,)).fetchone()
    finally:
        conn.close()
    assert t["entry_date"] == "2026-08-27T00:00:00Z"
    assert t["hour_et"] is None                  # honest: no clock exists
    assert t["trading_day_et"] == "2026-08-27"   # date-string rule holds
