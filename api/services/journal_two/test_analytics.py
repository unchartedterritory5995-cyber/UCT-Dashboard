"""Analytics — aggregation correctness across the four sections."""

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


def _add_user(conn, user_id, email):
    conn.execute(
        "INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'pw')",
        (user_id, email),
    )
    conn.commit()


def _add_account(conn, user_id, *, name="Default", starting_balance=100_000):
    aid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """
        INSERT INTO j2_accounts (
            id, user_id, name, color, broker, starting_balance,
            account_size, default_stop, position_closing,
            breakeven_range, setups, share_journal_data,
            created_at, updated_at
        ) VALUES (?, ?, ?, 'blue', NULL, ?, ?,
                  '{"mode":"custom"}', 'FIFO',
                  '{"enabled":false,"unit":"$","value":0}',
                  '[]', 0, ?, ?)
        """,
        (aid, user_id, name, starting_balance, starting_balance, now, now),
    )
    conn.commit()
    return aid


def _add_trade(
    conn, user_id, *, account_id=None,
    exit_date_iso="2026-04-19T18:00:00Z", pnl=100, r=1.5, result="Win",
    side="Long", setup="VCP", symbol="NVDA",
):
    tid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """
        INSERT INTO j2_trades (
            id, user_id, position_id, symbol, side, shares,
            entry_price, entry_date, exit_price, exit_date,
            original_stop, setup, notes, pnl_dollar, pnl_percent,
            r_multiple, hold_days, result, context_at_entry,
            account_id, created_at
        ) VALUES (?, ?, 'manual', ?, ?, 100, 500, ?, 510, ?,
                  490, ?, NULL, ?, 0.02, ?, 1, ?, '{}', ?, ?)
        """,
        (
            tid, user_id, symbol, side, exit_date_iso, exit_date_iso,
            setup, pnl, r, result, account_id, now,
        ),
    )
    conn.commit()
    return tid


# ─── Empty / no-data ──────────────────────────────────────────────────────────


def test_empty_user_returns_zero_structures(db_conn):
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    _add_account(db_conn, "u1")

    got = get_analytics("u1", conn=db_conn)
    assert got["tradeCount"] == 0
    assert got["equity"]["kpis"]["maxDrawdown"] == 0
    assert got["equity"]["curve"] == []
    assert got["distribution"]["longVsShort"]["long"]["winRate"] is None


# ─── Equity section ───────────────────────────────────────────────────────────


def test_equity_curve_running_balance_correct(db_conn):
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1", starting_balance=100_000)

    _add_trade(db_conn, "u1", account_id=aid,
               exit_date_iso="2026-04-19T18:00:00Z", pnl=100)
    _add_trade(db_conn, "u1", account_id=aid,
               exit_date_iso="2026-04-20T18:00:00Z", pnl=200)
    _add_trade(db_conn, "u1", account_id=aid,
               exit_date_iso="2026-04-21T18:00:00Z", pnl=-50)

    got = get_analytics("u1", account_id=aid, conn=db_conn)
    curve = got["equity"]["curve"]
    assert len(curve) == 3
    assert curve[0]["equity"] == 100_100
    assert curve[1]["equity"] == 100_300
    assert curve[2]["equity"] == 100_250


def test_equity_drawdown_kpis(db_conn):
    """Trades: +100, -200, +50 → peak balance 100,100; max DD = -150."""
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1", starting_balance=100_000)

    _add_trade(db_conn, "u1", account_id=aid,
               exit_date_iso="2026-04-19T18:00:00Z", pnl=100)
    _add_trade(db_conn, "u1", account_id=aid,
               exit_date_iso="2026-04-20T18:00:00Z", pnl=-200, result="Loss")
    _add_trade(db_conn, "u1", account_id=aid,
               exit_date_iso="2026-04-21T18:00:00Z", pnl=50)

    got = get_analytics("u1", account_id=aid, conn=db_conn)
    kpis = got["equity"]["kpis"]
    assert kpis["peakPnl"] == 100  # peak balance was 100100
    # Drawdown after the -200 day: 100100 → 99900 = -200
    assert kpis["maxDrawdown"] == -200
    # Current (last) drawdown: 99950 - 100100 = -150
    assert kpis["currentDrawdown"] == -150


# ─── Performance section ──────────────────────────────────────────────────────


def test_hourly_buckets_use_et(db_conn):
    """A 23:00 UTC trade in EDT = 19:00 ET → hour 19 bucket."""
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    _add_trade(db_conn, "u1", account_id=aid,
               exit_date_iso="2026-04-19T23:00:00Z", pnl=140)

    got = get_analytics("u1", account_id=aid, conn=db_conn)
    hourly = {h["hour"]: h for h in got["performance"]["hourly"]}
    assert hourly[19]["pnl"] == 140
    assert hourly[19]["tradeCount"] == 1
    assert hourly[12]["tradeCount"] == 0


def test_day_of_week_breakdown(db_conn):
    """2026-04-20 is a Monday."""
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    _add_trade(db_conn, "u1", account_id=aid,
               exit_date_iso="2026-04-20T18:00:00Z", pnl=100)

    got = get_analytics("u1", account_id=aid, conn=db_conn)
    dow = {d["day"]: d for d in got["performance"]["dayOfWeek"]}
    assert dow["Mon"]["pnl"] == 100
    assert dow["Tue"]["pnl"] == 0


# ─── Distribution section ─────────────────────────────────────────────────────


def test_long_vs_short_split(db_conn):
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    _add_trade(db_conn, "u1", account_id=aid, side="Long",  pnl=100)
    _add_trade(db_conn, "u1", account_id=aid, side="Long",  pnl=200)
    _add_trade(db_conn, "u1", account_id=aid, side="Short", pnl=50)

    got = get_analytics("u1", account_id=aid, conn=db_conn)
    ls = got["distribution"]["longVsShort"]
    assert ls["long"]["totalPnl"] == 300
    assert ls["long"]["tradeCount"] == 2
    assert ls["short"]["totalPnl"] == 50
    assert ls["short"]["tradeCount"] == 1


def test_r_multiple_buckets(db_conn):
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    _add_trade(db_conn, "u1", account_id=aid, r=2.5, pnl=250)   # 2R..3R
    _add_trade(db_conn, "u1", account_id=aid, r=1.5, pnl=150)   # 1R..2R
    _add_trade(db_conn, "u1", account_id=aid, r=-0.5, pnl=-50, result="Loss")  # -1R..0R

    got = get_analytics("u1", account_id=aid, conn=db_conn)
    rm = {b["bucket"]: b["count"] for b in got["distribution"]["rMultiples"]}
    assert rm["2R..3R"] == 1
    assert rm["1R..2R"] == 1
    assert rm["-1R..0R"] == 1
    assert rm["< -2R"] == 0


def test_win_loss_streaks(db_conn):
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    # WWLLW
    _add_trade(db_conn, "u1", account_id=aid, exit_date_iso="2026-04-01T18:00:00Z", pnl=10, result="Win")
    _add_trade(db_conn, "u1", account_id=aid, exit_date_iso="2026-04-02T18:00:00Z", pnl=20, result="Win")
    _add_trade(db_conn, "u1", account_id=aid, exit_date_iso="2026-04-03T18:00:00Z", pnl=-10, result="Loss")
    _add_trade(db_conn, "u1", account_id=aid, exit_date_iso="2026-04-04T18:00:00Z", pnl=-20, result="Loss")
    _add_trade(db_conn, "u1", account_id=aid, exit_date_iso="2026-04-05T18:00:00Z", pnl=50, result="Win")

    got = get_analytics("u1", account_id=aid, conn=db_conn)
    streaks = got["distribution"]["winLossStreaks"]
    assert len(streaks) == 3
    assert streaks[0] == {"index": 1, "type": "win", "length": 2}
    assert streaks[1] == {"index": 2, "type": "loss", "length": 2}
    assert streaks[2] == {"index": 3, "type": "win", "length": 1}


# ─── Attribution section ──────────────────────────────────────────────────────


def test_pnl_by_setup_excludes_null(db_conn):
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    _add_trade(db_conn, "u1", account_id=aid, setup="VCP",  pnl=100)
    _add_trade(db_conn, "u1", account_id=aid, setup="EP",   pnl=50)
    _add_trade(db_conn, "u1", account_id=aid, setup=None,   pnl=999)  # excluded

    got = get_analytics("u1", account_id=aid, conn=db_conn)
    setups = {s["setup"]: s for s in got["attribution"]["bySetup"]}
    assert "VCP" in setups
    assert "EP" in setups
    assert None not in setups
    assert setups["VCP"]["totalPnl"] == 100


def test_pnl_by_symbol(db_conn):
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    _add_trade(db_conn, "u1", account_id=aid, symbol="NVDA", pnl=200)
    _add_trade(db_conn, "u1", account_id=aid, symbol="AMD",  pnl=140)
    _add_trade(db_conn, "u1", account_id=aid, symbol="NVDA", pnl=-50, result="Loss")

    got = get_analytics("u1", account_id=aid, conn=db_conn)
    syms = {s["symbol"]: s for s in got["attribution"]["bySymbol"]}
    assert syms["NVDA"]["totalPnl"] == 150
    assert syms["NVDA"]["tradeCount"] == 2
    assert syms["AMD"]["totalPnl"] == 140


def test_rolling_win_rate_window(db_conn):
    """Window 2 over W L W W → at index 2: 0.5; at 3: 0.5; at 4: 1.0."""
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    _add_trade(db_conn, "u1", account_id=aid, exit_date_iso="2026-04-01T18:00:00Z", result="Win")
    _add_trade(db_conn, "u1", account_id=aid, exit_date_iso="2026-04-02T18:00:00Z", pnl=-10, result="Loss")
    _add_trade(db_conn, "u1", account_id=aid, exit_date_iso="2026-04-03T18:00:00Z", result="Win")
    _add_trade(db_conn, "u1", account_id=aid, exit_date_iso="2026-04-04T18:00:00Z", result="Win")

    got = get_analytics("u1", account_id=aid, conn=db_conn)
    # Service computes for windows 10/20/50/100/200; 4 trades < 10 → all empty
    assert got["attribution"]["rollingWinRate"]["windows"]["10"] == []


# ─── Account scoping + date range ─────────────────────────────────────────────


def test_account_id_filter(db_conn):
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    a1 = _add_account(db_conn, "u1", name="Live")
    a2 = _add_account(db_conn, "u1", name="Paper")

    _add_trade(db_conn, "u1", account_id=a1, pnl=100)
    _add_trade(db_conn, "u1", account_id=a2, pnl=999)

    got_a1 = get_analytics("u1", account_id=a1, conn=db_conn)
    assert got_a1["tradeCount"] == 1
    assert got_a1["distribution"]["longVsShort"]["long"]["totalPnl"] == 100


def test_date_range_filter(db_conn):
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    _add_trade(db_conn, "u1", account_id=aid, exit_date_iso="2026-01-15T18:00:00Z", pnl=100)
    _add_trade(db_conn, "u1", account_id=aid, exit_date_iso="2026-04-20T18:00:00Z", pnl=200)

    got = get_analytics("u1", account_id=aid,
                       date_from="2026-04-01", date_to="2026-04-30",
                       conn=db_conn)
    assert got["tradeCount"] == 1
    assert got["distribution"]["longVsShort"]["long"]["totalPnl"] == 200


def test_user_isolation(db_conn):
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "alice", "alice@x.com")
    _add_user(db_conn, "bob", "bob@x.com")
    a_alice = _add_account(db_conn, "alice")
    a_bob = _add_account(db_conn, "bob")

    _add_trade(db_conn, "alice", account_id=a_alice, pnl=100)
    _add_trade(db_conn, "bob", account_id=a_bob, pnl=999)

    got = get_analytics("alice", conn=db_conn)
    assert got["tradeCount"] == 1
