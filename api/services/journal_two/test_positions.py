"""Positions service — list/get/count, user isolation, closed-position exclusion."""

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


def _insert_position(conn, user_id, symbol="YSS", shares=250, closed=False, **overrides):
    """Shortcut to seed a position row directly. Avoids hitting the (not yet
    built) create-position service so Phase 3 tests are self-contained."""
    pid = overrides.pop("id", str(uuid.uuid4()))
    now = datetime.now(timezone.utc).isoformat()
    ctx = json.dumps(
        {
            "navCount": 0,
            "rallyDay": None,
            "powerTrend": None,
            "breadthValue": None,
            "breadthMetricName": "NASI RSI",
            "indexName": "NYA",
            "igRank": None,
            "rsRating": None,
        }
    )
    defaults = {
        "side": "Long",
        "entry_date": "2026-04-09T00:00:00Z",
        "shares": float(shares),
        "original_shares": float(shares),
        "entry_price": 29.57,
        "stop_price": 27.90,
        "breakeven_stop": None,
        "raise_to_breakeven": 0,
        "setup": None,
        "notes": None,
        "context_at_entry": ctx,
        "created_at": now,
        "updated_at": now,
        "closed_at": now if closed else None,
    }
    defaults.update(overrides)
    conn.execute(
        """
        INSERT INTO j2_positions (
            id, user_id, symbol, side, entry_date, shares, original_shares,
            entry_price, stop_price, breakeven_stop, raise_to_breakeven,
            setup, notes, context_at_entry, created_at, updated_at, closed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            pid,
            user_id,
            symbol,
            defaults["side"],
            defaults["entry_date"],
            defaults["shares"],
            defaults["original_shares"],
            defaults["entry_price"],
            defaults["stop_price"],
            defaults["breakeven_stop"],
            defaults["raise_to_breakeven"],
            defaults["setup"],
            defaults["notes"],
            defaults["context_at_entry"],
            defaults["created_at"],
            defaults["updated_at"],
            defaults["closed_at"],
        ),
    )
    conn.commit()
    return pid


def test_list_open_positions_empty(db_conn):
    from api.services.journal_two import positions as svc
    assert svc.list_open_positions("u1", conn=db_conn) == []


def test_list_open_positions_returns_yss_with_camelcase_shape(db_conn):
    from api.services.journal_two import positions as svc
    pid = _insert_position(db_conn, "u1", symbol="YSS")
    got = svc.list_open_positions("u1", conn=db_conn)
    assert len(got) == 1
    p = got[0]
    assert p["id"] == pid
    assert p["userId"] == "u1"
    assert p["symbol"] == "YSS"
    assert p["side"] == "Long"
    assert p["shares"] == 250.0
    assert p["entryPrice"] == 29.57
    assert p["stopPrice"] == 27.90
    assert p["raiseToBreakeven"] is False
    assert p["breakevenStop"] is None
    assert p["closedAt"] is None
    assert p["contextAtEntry"]["indexName"] == "NYA"


def test_list_open_positions_excludes_closed(db_conn):
    from api.services.journal_two import positions as svc
    _insert_position(db_conn, "u1", symbol="OPEN")
    _insert_position(db_conn, "u1", symbol="CLOSED", closed=True)
    got = svc.list_open_positions("u1", conn=db_conn)
    assert len(got) == 1
    assert got[0]["symbol"] == "OPEN"


def test_list_open_positions_user_isolation(db_conn):
    from api.services.journal_two import positions as svc
    _insert_position(db_conn, "u1", symbol="AAA")
    _insert_position(db_conn, "u2", symbol="BBB")
    a = svc.list_open_positions("u1", conn=db_conn)
    b = svc.list_open_positions("u2", conn=db_conn)
    assert [p["symbol"] for p in a] == ["AAA"]
    assert [p["symbol"] for p in b] == ["BBB"]


def test_list_open_positions_sorted_by_symbol(db_conn):
    from api.services.journal_two import positions as svc
    _insert_position(db_conn, "u1", symbol="ZZZ")
    _insert_position(db_conn, "u1", symbol="AAA")
    _insert_position(db_conn, "u1", symbol="MMM")
    got = svc.list_open_positions("u1", conn=db_conn)
    assert [p["symbol"] for p in got] == ["AAA", "MMM", "ZZZ"]


def test_get_position_returns_none_for_missing(db_conn):
    from api.services.journal_two import positions as svc
    assert svc.get_position("u1", "nonexistent", conn=db_conn) is None


def test_get_position_enforces_user_isolation(db_conn):
    from api.services.journal_two import positions as svc
    pid = _insert_position(db_conn, "u1", symbol="YSS")
    # u2 tries to read u1's position by id
    assert svc.get_position("u2", pid, conn=db_conn) is None
    # u1 succeeds
    assert svc.get_position("u1", pid, conn=db_conn) is not None


def test_count_open_positions_ignores_closed(db_conn):
    from api.services.journal_two import positions as svc
    _insert_position(db_conn, "u1", symbol="A")
    _insert_position(db_conn, "u1", symbol="B")
    _insert_position(db_conn, "u1", symbol="C", closed=True)
    assert svc.count_open_positions_for_user("u1", conn=db_conn) == 2


def test_count_open_positions_user_isolated(db_conn):
    from api.services.journal_two import positions as svc
    _insert_position(db_conn, "u1", symbol="A")
    _insert_position(db_conn, "u2", symbol="B")
    _insert_position(db_conn, "u2", symbol="C")
    assert svc.count_open_positions_for_user("u1", conn=db_conn) == 1
    assert svc.count_open_positions_for_user("u2", conn=db_conn) == 2


def test_raise_to_breakeven_roundtrip(db_conn):
    from api.services.journal_two import positions as svc
    _insert_position(db_conn, "u1", raise_to_breakeven=1, breakeven_stop=29.57)
    got = svc.list_open_positions("u1", conn=db_conn)
    assert got[0]["raiseToBreakeven"] is True
    assert got[0]["breakevenStop"] == 29.57
