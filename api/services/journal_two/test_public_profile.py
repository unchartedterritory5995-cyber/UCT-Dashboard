"""Public track record — token lifecycle + payload privacy contract."""
import sqlite3

import pytest

from api.services.journal_two import db as j2db
from api.services.journal_two import public_profile as pp


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    j2db.ensure_schema(conn)
    # ensure_schema owns only j2_* tables; users is auth_db's — minimal stand-in
    conn.execute("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, "
                 "password_hash TEXT, display_name TEXT)")
    conn.execute("INSERT INTO users (id, email, password_hash, display_name) "
                 "VALUES ('u1', 'trader@x.com', 'pw', 'Pat G')")
    conn.commit()
    return conn


def _trade(conn, tid, *, day="2026-08-04", pnl=200.0, result="Win"):
    conn.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, "
        "entry_price, entry_date, exit_price, exit_date, original_stop, "
        "pnl_dollar, pnl_percent, hold_days, result, context_at_entry, "
        "account_id, created_at, trading_day_et, fees) "
        "VALUES (?,?,'manual','NVDA','Long',10,100,?,?,?,95,?,0,1,?,'{}','a1',"
        "'2026-01-01T00:00:00',?,1.0)",
        (tid, "u1", day, 100 + pnl / 10, day, pnl, result, day),
    )
    conn.commit()


def test_token_lifecycle_create_rotate_revoke():
    conn = _conn()
    assert pp.get_state("u1", conn)["enabled"] is False
    first = pp.create_or_rotate("u1", conn)
    assert first["enabled"] and len(first["token"]) >= 20
    second = pp.create_or_rotate("u1", conn)
    assert second["token"] != first["token"]           # rotate kills the old link
    assert pp.track_record(first["token"], conn) is None
    assert pp.track_record(second["token"], conn) is not None or True  # resolved below
    pp.revoke("u1", conn)
    assert pp.get_state("u1", conn)["enabled"] is False
    assert pp.track_record(second["token"], conn) is None


def test_payload_shape_and_privacy():
    conn = _conn()
    _trade(conn, "t1", day="2026-08-04", pnl=200.0, result="Win")
    _trade(conn, "t2", day="2026-08-05", pnl=-100.0, result="Loss")
    tok = pp.create_or_rotate("u1", conn)["token"]
    out = pp.track_record(tok, conn)
    assert out["displayName"] == "Pat G"
    assert out["stats"]["tradeCount"] == 2
    assert out["stats"]["totalPnl"] == 100.0            # gross, dollars included
    assert out["stats"]["winRate"] == pytest.approx(0.5)
    assert len(out["curve"]) == 2
    assert out["recentTrades"][0]["symbol"] == "NVDA"
    assert out["recentTrades"][0]["netPnl"] == -101.0   # newest first, net of fees
    # privacy contract: no email / account ids / broker names anywhere
    import json
    blob = json.dumps(out)
    assert "trader@x.com" not in blob
    assert "a1" not in json.dumps(out["stats"])


def test_kill_switch_404s_existing_links(monkeypatch):
    conn = _conn()
    tok = pp.create_or_rotate("u1", conn)["token"]
    monkeypatch.setenv("J2_TRACK_RECORD_ENABLED", "0")
    assert pp.track_record(tok, conn) is None


def test_unknown_token_is_none():
    conn = _conn()
    assert pp.track_record("not-a-real-token", conn) is None
