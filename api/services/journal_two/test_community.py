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
