"""Community feed — opt-in filter, privacy stripping, attribution."""

import json
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
    import importlib
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = sqlite3.connect(tmp.name)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()
    os.unlink(tmp.name)


def _add_user(conn, user_id, email, display_name=None, full_name=None):
    conn.execute(
        "INSERT INTO users (id, email, password_hash, display_name, full_name) VALUES (?, ?, 'pw', ?, ?)",
        (user_id, email, display_name, full_name),
    )
    conn.commit()


def _set_sharing(conn, user_id, shared):
    """Upsert a j2_settings row with shareJournalData set."""
    from api.services.journal_two.settings import default_settings_data
    data = default_settings_data()
    data["shareJournalData"] = bool(shared)
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "INSERT OR REPLACE INTO j2_settings (id, user_id, data, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), user_id, json.dumps(data), now, now),
    )
    conn.commit()


def _add_trade(conn, user_id, *, symbol="NVDA", shares=100, entry_price=500,
               exit_price=520, r_multiple=2.0, result="Win",
               entry_date="2026-04-09T00:00:00Z"):
    """Direct insert of a j2_trade for test setup."""
    tid = str(uuid.uuid4())
    pnl_dollar = (exit_price - entry_price) * shares
    pnl_percent = (exit_price - entry_price) / entry_price
    ctx = json.dumps({
        "navCount": 3, "rallyDay": "D7", "powerTrend": "On",
        "breadthValue": 55, "breadthMetricName": "NASI RSI",
        "indexName": "NYA", "igRank": None, "rsRating": None,
    })
    conn.execute(
        """
        INSERT INTO j2_trades (
            id, user_id, position_id, symbol, side, shares,
            entry_price, entry_date, exit_price, exit_date,
            original_stop, setup, notes, pnl_dollar, pnl_percent,
            r_multiple, hold_days, result, context_at_entry, created_at
        ) VALUES (?, ?, 'manual-test', ?, 'Long', ?, ?, ?, ?, ?, ?, 'VCP',
                  'trade notes', ?, ?, ?, 1, ?, ?, ?)
        """,
        (tid, user_id, symbol, shares, entry_price, entry_date,
         exit_price, "2026-04-10T00:00:00Z", entry_price - 10,
         pnl_dollar, pnl_percent, r_multiple, result, ctx,
         datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    return tid


def _add_position(conn, user_id, *, symbol="NVDA", shares=100, entry_price=500,
                  stop_price=490, entry_date="2026-04-01T00:00:00Z", closed_at=None):
    """Direct insert of a j2_position for test setup."""
    pid = str(uuid.uuid4())
    ctx = json.dumps({
        "navCount": 3, "rallyDay": "D7", "powerTrend": "On",
        "breadthValue": 55, "breadthMetricName": "NASI RSI",
        "indexName": "NYA", "igRank": None, "rsRating": None,
    })
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """
        INSERT INTO j2_positions (
            id, user_id, symbol, side, entry_date, shares, original_shares,
            entry_price, stop_price, breakeven_stop, raise_to_breakeven,
            setup, notes, context_at_entry, created_at, updated_at, closed_at
        ) VALUES (?, ?, ?, 'Long', ?, ?, ?, ?, ?, NULL, 0,
                  'VCP', 'position notes', ?, ?, ?, ?)
        """,
        (pid, user_id, symbol, entry_date, shares, shares, entry_price,
         stop_price, ctx, now, now, closed_at),
    )
    conn.commit()
    return pid


def test_only_opted_in_users_appear(db_conn):
    from api.services.journal_two import community as svc

    _add_user(db_conn, "u1", "alice@x.com", display_name="Alice")
    _add_user(db_conn, "u2", "bob@x.com", display_name="Bob")
    _set_sharing(db_conn, "u1", True)
    _set_sharing(db_conn, "u2", False)
    _add_trade(db_conn, "u1", symbol="NVDA")
    _add_trade(db_conn, "u2", symbol="AAPL")

    got = svc.list_shared_trades(conn=db_conn)
    assert len(got) == 1
    assert got[0]["symbol"] == "NVDA"
    assert got[0]["trader"] == "Alice"


def test_user_without_settings_row_is_excluded(db_conn):
    """A user who never saved settings shouldn't appear (no opt-in)."""
    from api.services.journal_two import community as svc

    _add_user(db_conn, "u1", "alice@x.com", display_name="Alice")
    _add_trade(db_conn, "u1", symbol="NVDA")
    # No _set_sharing call → no settings row

    got = svc.list_shared_trades(conn=db_conn)
    assert got == []


def test_privacy_stripping_excludes_shares_and_pnl_dollar(db_conn):
    from api.services.journal_two import community as svc

    _add_user(db_conn, "u1", "alice@x.com", display_name="Alice")
    _set_sharing(db_conn, "u1", True)
    _add_trade(db_conn, "u1", shares=1000, entry_price=500, exit_price=520)

    got = svc.list_shared_trades(conn=db_conn)
    assert len(got) == 1
    t = got[0]
    assert "shares" not in t
    assert "pnlDollar" not in t
    # Kept fields
    assert "pnlPercent" in t
    assert "rMultiple" in t
    assert "result" in t
    assert "entryPrice" in t
    assert "exitPrice" in t


def test_display_name_fallback_to_full_name(db_conn):
    from api.services.journal_two import community as svc

    _add_user(db_conn, "u1", "alice@x.com", display_name=None, full_name="Alice Smith")
    _set_sharing(db_conn, "u1", True)
    _add_trade(db_conn, "u1")

    got = svc.list_shared_trades(conn=db_conn)
    assert got[0]["trader"] == "Alice Smith"


def test_display_name_fallback_to_email_local_part(db_conn):
    from api.services.journal_two import community as svc

    _add_user(db_conn, "u1", "alice@example.com", display_name=None, full_name=None)
    _set_sharing(db_conn, "u1", True)
    _add_trade(db_conn, "u1")

    got = svc.list_shared_trades(conn=db_conn)
    assert got[0]["trader"] == "alice"


def test_email_never_leaks_into_response(db_conn):
    from api.services.journal_two import community as svc

    _add_user(db_conn, "u1", "alice@example.com", display_name="Alice")
    _set_sharing(db_conn, "u1", True)
    _add_trade(db_conn, "u1")

    got = svc.list_shared_trades(conn=db_conn)
    serialized = json.dumps(got)
    assert "alice@example.com" not in serialized


def test_newest_entry_first(db_conn):
    from api.services.journal_two import community as svc

    _add_user(db_conn, "u1", "alice@x.com")
    _set_sharing(db_conn, "u1", True)
    _add_trade(db_conn, "u1", symbol="OLD", entry_date="2026-01-01T00:00:00Z")
    _add_trade(db_conn, "u1", symbol="NEW", entry_date="2026-06-01T00:00:00Z")

    got = svc.list_shared_trades(conn=db_conn)
    assert got[0]["symbol"] == "NEW"
    assert got[1]["symbol"] == "OLD"


def test_limit_param_caps_rows(db_conn):
    from api.services.journal_two import community as svc

    _add_user(db_conn, "u1", "alice@x.com")
    _set_sharing(db_conn, "u1", True)
    for i in range(10):
        _add_trade(db_conn, "u1", symbol=f"SYM{i}",
                   entry_date=f"2026-01-{i + 1:02d}T00:00:00Z")

    got = svc.list_shared_trades(limit=5, conn=db_conn)
    assert len(got) == 5


def test_multiple_users_share_and_appear_together(db_conn):
    from api.services.journal_two import community as svc

    _add_user(db_conn, "alice", "alice@x.com", display_name="Alice")
    _add_user(db_conn, "bob", "bob@x.com", display_name="Bob")
    _set_sharing(db_conn, "alice", True)
    _set_sharing(db_conn, "bob", True)
    _add_trade(db_conn, "alice", symbol="NVDA")
    _add_trade(db_conn, "bob", symbol="AAPL")

    got = svc.list_shared_trades(conn=db_conn)
    traders = {t["trader"] for t in got}
    assert traders == {"Alice", "Bob"}


def test_trades_include_trader_id_and_is_me(db_conn):
    from api.services.journal_two import community as svc

    _add_user(db_conn, "alice", "alice@x.com", display_name="Alice")
    _add_user(db_conn, "bob", "bob@x.com", display_name="Bob")
    _set_sharing(db_conn, "alice", True)
    _set_sharing(db_conn, "bob", True)
    _add_trade(db_conn, "alice", symbol="NVDA")
    _add_trade(db_conn, "bob", symbol="AAPL")

    # Alice is the viewer — her rows get isMe=true, Bob's don't
    got = svc.list_shared_trades(current_user_id="alice", conn=db_conn)
    by_sym = {t["symbol"]: t for t in got}
    assert by_sym["NVDA"]["isMe"] is True
    assert by_sym["NVDA"]["traderId"] == "alice"
    assert by_sym["AAPL"]["isMe"] is False
    assert by_sym["AAPL"]["traderId"] == "bob"


# ═══════════════ list_trader_summaries ═══════════════════════════════════════


def test_trader_summaries_only_opted_in(db_conn):
    from api.services.journal_two import community as svc

    _add_user(db_conn, "alice", "alice@x.com", display_name="Alice")
    _add_user(db_conn, "bob", "bob@x.com", display_name="Bob")
    _set_sharing(db_conn, "alice", True)
    _set_sharing(db_conn, "bob", False)
    _add_trade(db_conn, "alice")
    _add_trade(db_conn, "bob")

    got = svc.list_trader_summaries(conn=db_conn)
    assert len(got) == 1
    assert got[0]["trader"] == "Alice"


def test_trader_summaries_aggregates_win_rate_and_pf(db_conn):
    from api.services.journal_two import community as svc

    _add_user(db_conn, "alice", "alice@x.com", display_name="Alice")
    _set_sharing(db_conn, "alice", True)
    # 3 wins (+5%, +5%, +10%), 1 loss (-3%), 1 BE (0.5%)
    _add_trade(db_conn, "alice", entry_price=100, exit_price=105, r_multiple=2.0, result="Win")
    _add_trade(db_conn, "alice", entry_price=100, exit_price=105, r_multiple=2.0, result="Win")
    _add_trade(db_conn, "alice", entry_price=100, exit_price=110, r_multiple=3.0, result="Win")
    _add_trade(db_conn, "alice", entry_price=100, exit_price=97, r_multiple=-1.5, result="Loss")
    _add_trade(db_conn, "alice", entry_price=100, exit_price=100.5, r_multiple=0.25, result="BE")

    got = svc.list_trader_summaries(conn=db_conn)
    assert len(got) == 1
    a = got[0]
    assert a["tradeCount"] == 5
    assert a["wins"] == 3
    assert a["losses"] == 1
    assert a["bes"] == 1
    # Win rate: BE excluded from denom → 3 / (3+1) = 75%
    assert a["winRate"] == pytest.approx(75.0, abs=0.01)
    # Profit factor on pnl_percent: wins sum = 0.05+0.05+0.10 = 0.20;
    # loss sum = -0.03; PF = 0.20 / 0.03 ≈ 6.67
    assert a["profitFactor"] == pytest.approx(0.20 / 0.03, rel=0.01)


def test_trader_summaries_profit_factor_infinite_encoded_as_null(db_conn):
    """All wins, no losses → profitFactor: null (JSON doesn't allow ∞;
    client renders '∞' when None and wins > 0)."""
    from api.services.journal_two import community as svc

    _add_user(db_conn, "alice", "alice@x.com", display_name="Alice")
    _set_sharing(db_conn, "alice", True)
    _add_trade(db_conn, "alice", entry_price=100, exit_price=105, r_multiple=2.0, result="Win")
    _add_trade(db_conn, "alice", entry_price=100, exit_price=110, r_multiple=3.0, result="Win")

    got = svc.list_trader_summaries(conn=db_conn)
    assert got[0]["profitFactor"] is None
    assert got[0]["wins"] == 2
    assert got[0]["losses"] == 0


def test_trader_summaries_profit_factor_zero_on_no_wins(db_conn):
    from api.services.journal_two import community as svc

    _add_user(db_conn, "alice", "alice@x.com", display_name="Alice")
    _set_sharing(db_conn, "alice", True)
    _add_trade(db_conn, "alice", entry_price=100, exit_price=97, r_multiple=-1.5, result="Loss")
    _add_trade(db_conn, "alice", entry_price=100, exit_price=100.5, r_multiple=0.25, result="BE")

    got = svc.list_trader_summaries(conn=db_conn)
    assert got[0]["profitFactor"] == 0


def test_trader_summaries_isme_flag(db_conn):
    from api.services.journal_two import community as svc

    _add_user(db_conn, "alice", "alice@x.com", display_name="Alice")
    _add_user(db_conn, "bob", "bob@x.com", display_name="Bob")
    _set_sharing(db_conn, "alice", True)
    _set_sharing(db_conn, "bob", True)
    _add_trade(db_conn, "alice")
    _add_trade(db_conn, "bob")

    got = svc.list_trader_summaries(current_user_id="alice", conn=db_conn)
    by_name = {t["trader"]: t for t in got}
    assert by_name["Alice"]["isMe"] is True
    assert by_name["Bob"]["isMe"] is False


def test_trader_summaries_sorted_by_trade_count_desc(db_conn):
    from api.services.journal_two import community as svc

    _add_user(db_conn, "alice", "alice@x.com", display_name="Alice")
    _add_user(db_conn, "bob", "bob@x.com", display_name="Bob")
    _set_sharing(db_conn, "alice", True)
    _set_sharing(db_conn, "bob", True)
    _add_trade(db_conn, "alice", entry_date="2026-01-01T00:00:00Z")
    _add_trade(db_conn, "bob", entry_date="2026-01-01T00:00:00Z")
    _add_trade(db_conn, "bob", entry_date="2026-01-02T00:00:00Z")
    _add_trade(db_conn, "bob", entry_date="2026-01-03T00:00:00Z")

    got = svc.list_trader_summaries(conn=db_conn)
    assert got[0]["trader"] == "Bob"  # 3 trades
    assert got[1]["trader"] == "Alice"  # 1 trade


def test_trader_summaries_omits_dollar_amounts(db_conn):
    """No $ fields in the response — portfolio-size privacy."""
    from api.services.journal_two import community as svc

    _add_user(db_conn, "alice", "alice@x.com", display_name="Alice")
    _set_sharing(db_conn, "alice", True)
    _add_trade(db_conn, "alice")

    got = svc.list_trader_summaries(conn=db_conn)
    t = got[0]
    # Must NOT include anything $-denominated
    for k in ("totalPnl", "totalPnlDollar", "avgPnlDollar", "shares"):
        assert k not in t


# ═══════════════ list_shared_open_positions ══════════════════════════════════


def test_shared_positions_only_opted_in(db_conn):
    from api.services.journal_two import community as svc

    _add_user(db_conn, "alice", "alice@x.com", display_name="Alice")
    _add_user(db_conn, "bob", "bob@x.com", display_name="Bob")
    _set_sharing(db_conn, "alice", True)
    _set_sharing(db_conn, "bob", False)
    _add_position(db_conn, "alice", symbol="NVDA")
    _add_position(db_conn, "bob", symbol="AAPL")

    got = svc.list_shared_open_positions(conn=db_conn)
    assert len(got) == 1
    assert got[0]["symbol"] == "NVDA"
    assert got[0]["trader"] == "Alice"


def test_shared_positions_exclude_closed(db_conn):
    from api.services.journal_two import community as svc

    _add_user(db_conn, "alice", "alice@x.com", display_name="Alice")
    _set_sharing(db_conn, "alice", True)
    _add_position(db_conn, "alice", symbol="OPEN")
    _add_position(
        db_conn, "alice", symbol="CLOSED",
        closed_at="2026-04-10T00:00:00Z",
    )

    got = svc.list_shared_open_positions(conn=db_conn)
    symbols = {p["symbol"] for p in got}
    assert symbols == {"OPEN"}


def test_shared_positions_strip_shares(db_conn):
    from api.services.journal_two import community as svc

    _add_user(db_conn, "alice", "alice@x.com", display_name="Alice")
    _set_sharing(db_conn, "alice", True)
    _add_position(db_conn, "alice", shares=1000, entry_price=500, stop_price=490)

    got = svc.list_shared_open_positions(conn=db_conn)
    assert len(got) == 1
    p = got[0]
    # STRIPPED — absolute size
    assert "shares" not in p
    assert "originalShares" not in p
    # KEPT — price levels are public market data
    assert p["entryPrice"] == 500
    assert p["stopPrice"] == 490


def test_shared_positions_trader_id_and_is_me(db_conn):
    from api.services.journal_two import community as svc

    _add_user(db_conn, "alice", "alice@x.com", display_name="Alice")
    _add_user(db_conn, "bob", "bob@x.com", display_name="Bob")
    _set_sharing(db_conn, "alice", True)
    _set_sharing(db_conn, "bob", True)
    _add_position(db_conn, "alice", symbol="NVDA")
    _add_position(db_conn, "bob", symbol="AAPL")

    got = svc.list_shared_open_positions(current_user_id="alice", conn=db_conn)
    by_sym = {p["symbol"]: p for p in got}
    assert by_sym["NVDA"]["isMe"] is True
    assert by_sym["NVDA"]["traderId"] == "alice"
    assert by_sym["AAPL"]["isMe"] is False
    assert by_sym["AAPL"]["traderId"] == "bob"


def test_shared_positions_email_never_leaks(db_conn):
    from api.services.journal_two import community as svc

    _add_user(db_conn, "alice", "alice@example.com", display_name="Alice")
    _set_sharing(db_conn, "alice", True)
    _add_position(db_conn, "alice")

    got = svc.list_shared_open_positions(conn=db_conn)
    assert "alice@example.com" not in json.dumps(got)
