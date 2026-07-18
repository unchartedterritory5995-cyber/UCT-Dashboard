"""Tests for broker trade reconstruction + idempotency.

The headline guarantee: re-running reconstruction over the same activity
history imports ZERO duplicate trades. Also covers shorts persisting and
genuinely-identical round-trips staying distinct.
"""

from __future__ import annotations

import pytest

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two.broker import reconstruct


@pytest.fixture
def env(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    acct = accounts_service.create_account(
        "u1", {"name": "Broker", "color": "blue", "startingBalance": 1000.0}
    )
    settings = accounts_service.get_account_settings("u1", acct["id"])
    return {"acct_id": acct["id"], "settings": settings}


def _act(aid, typ, ticker, units, price, date):
    return {"id": aid, "type": typ, "units": units, "price": price, "fee": 0,
            "symbol": {"symbol": ticker}, "trade_date": date, "currency": "USD"}


def _trades(user="u1"):
    conn = auth_db.get_connection()
    try:
        return conn.execute(
            "SELECT symbol, side, shares, entry_price, exit_price, source, external_id "
            "FROM j2_trades WHERE user_id=? ORDER BY entry_date", (user,)
        ).fetchall()
    finally:
        conn.close()


def test_basic_reconstruct_and_persist(env):
    acts = [
        _act("a1", "BUY", "AAPL", 10, 100, "2026-04-01"),
        _act("a2", "SELL", "AAPL", 10, 110, "2026-04-02"),
    ]
    out = reconstruct.reconstruct_account("u1", "ba1", env["acct_id"], acts, env["settings"])
    assert out["imported"] == 1 and out["skipped"] == 0
    rows = _trades()
    assert len(rows) == 1
    assert rows[0]["source"] == "broker"
    assert rows[0]["external_id"].startswith("bk:")
    assert rows[0]["side"] == "Long"


def test_idempotent_rerun_zero_duplicates(env):
    acts = [
        _act("a1", "BUY", "AAPL", 10, 100, "2026-04-01"),
        _act("a2", "SELL", "AAPL", 10, 110, "2026-04-02"),
        _act("a3", "SELL", "TSLA", 5, 60, "2026-04-01"),   # short open
        _act("a4", "BUY", "TSLA", 5, 50, "2026-04-03"),    # cover
    ]
    first = reconstruct.reconstruct_account("u1", "ba1", env["acct_id"], acts, env["settings"])
    assert first["imported"] == 2
    # Re-run with the SAME activities (e.g. overlapping sync window).
    second = reconstruct.reconstruct_account("u1", "ba1", env["acct_id"], acts, env["settings"])
    assert second["imported"] == 0
    assert second["skipped"] == 2
    assert len(_trades()) == 2  # no duplication


def test_short_persisted_with_correct_side(env):
    acts = [
        _act("a1", "SELL", "TSLA", 5, 60, "2026-04-01"),
        _act("a2", "BUY", "TSLA", 5, 50, "2026-04-03"),
    ]
    reconstruct.reconstruct_account("u1", "ba1", env["acct_id"], acts, env["settings"])
    rows = _trades()
    assert len(rows) == 1
    assert rows[0]["side"] == "Short"
    assert rows[0]["entry_price"] == 60 and rows[0]["exit_price"] == 50


def test_identical_round_trips_stay_distinct(env):
    # Two identical day-trades on the same day → both must import (distinct
    # external ids via the deterministic ordinal), and a re-run dedups both.
    acts = [
        _act("a1", "BUY", "AAPL", 1, 100, "2026-04-01"),
        _act("a2", "SELL", "AAPL", 1, 100, "2026-04-01"),
        _act("a3", "BUY", "AAPL", 1, 100, "2026-04-01"),
        _act("a4", "SELL", "AAPL", 1, 100, "2026-04-01"),
    ]
    out = reconstruct.reconstruct_account("u1", "ba1", env["acct_id"], acts, env["settings"])
    assert out["imported"] == 2
    ext_ids = {r["external_id"] for r in _trades()}
    assert len(ext_ids) == 2  # distinct
    # Re-run → both dedup.
    out2 = reconstruct.reconstruct_account("u1", "ba1", env["acct_id"], acts, env["settings"])
    assert out2["imported"] == 0 and out2["skipped"] == 2


def test_open_position_returned_not_inserted(env):
    acts = [_act("a1", "BUY", "AAPL", 10, 100, "2026-04-01")]  # no sell
    out = reconstruct.reconstruct_account("u1", "ba1", env["acct_id"], acts, env["settings"])
    assert out["imported"] == 0
    assert len(out["openPositions"]) == 1
    assert out["openPositions"][0]["symbol"] == "AAPL"
    assert _trades() == []


def test_broker_trades_have_null_regime(env):
    # Historical imports must NOT be stamped with today's regime.
    acts = [
        _act("a1", "BUY", "AAPL", 10, 100, "2026-04-01"),
        _act("a2", "SELL", "AAPL", 10, 110, "2026-04-02"),
    ]
    reconstruct.reconstruct_account("u1", "ba1", env["acct_id"], acts, env["settings"])
    conn = auth_db.get_connection()
    try:
        regime = conn.execute(
            "SELECT regime FROM j2_trades WHERE user_id='u1'"
        ).fetchone()["regime"]
    finally:
        conn.close()
    assert regime is None


def test_option_events_collected_not_traded(env):
    acts = [{
        "id": "o1", "type": "BUY", "option_type": "BUY_TO_OPEN", "units": 1, "price": 2.0,
        "trade_date": "2026-04-01",
        "option_symbol": {"underlying_symbol": {"symbol": "AAPL"}, "strike_price": 200,
                          "expiration_date": "2026-06-19", "option_type": "CALL"},
    }]
    out = reconstruct.reconstruct_account("u1", "ba1", env["acct_id"], acts, env["settings"])
    assert out["imported"] == 0
    assert len(out["optionEvents"]) == 1  # handed to Phase 4
    assert _trades() == []


# ── Share adjustments end-to-end (Schwab JRNLSEC / SPLIT) ───────────────────

def test_journaled_out_shares_realize_no_trade(env):
    # Sending account: buy 2000, journal them to a sibling account.
    acts = [
        _act("j1", "BUY", "FIVN", 2000, 20.0, "2026-04-01"),
        _act("j2", "JRNLSEC", "FIVN", -2000, None, "2026-04-05"),
    ]
    out = reconstruct.reconstruct_account("u1", "ba1", env["acct_id"], acts, env["settings"])
    assert out["imported"] == 0
    assert out["shareAdjustments"] == 1
    assert out["openPositions"] == []
    assert _trades() == []


def test_journaled_in_shares_sell_as_long(env):
    # Receiving account: 2000 shares arrive via journal (no basis on the
    # activity → resolved via the injected price fn), later sold. Pre-fix this
    # reconstructed as a phantom SHORT.
    acts = [
        _act("j3", "JRNLSEC", "FIVN", 2000, None, "2026-04-05"),
        _act("j4", "SELL", "FIVN", 2000, 22.0, "2026-04-20"),
    ]
    out = reconstruct.reconstruct_account(
        "u1", "ba1", env["acct_id"], acts, env["settings"],
        transfer_price_fn=lambda sym, d: 21.0,
    )
    assert out["imported"] == 1
    rows = _trades()
    assert rows[0]["side"] == "Long"
    assert rows[0]["entry_price"] == 21.0 and rows[0]["exit_price"] == 22.0


def test_split_end_to_end(env):
    acts = [
        _act("s1", "BUY", "CRCG", 900, 1.0, "2026-04-01"),
        _act("s2", "SPLIT", "CRCG", -810, None, "2026-04-10"),  # 1:10 reverse
        _act("s3", "SELL", "CRCG", 90, 11.0, "2026-04-20"),
    ]
    out = reconstruct.reconstruct_account("u1", "ba1", env["acct_id"], acts, env["settings"])
    assert out["imported"] == 1
    rows = _trades()
    assert rows[0]["side"] == "Long"
    assert rows[0]["shares"] == 90
    assert rows[0]["entry_price"] == 10.0  # $1 basis × 10 after reverse split
    assert out["openPositions"] == []
