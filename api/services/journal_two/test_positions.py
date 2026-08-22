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


# ── Write paths (Phase 4) ────────────────────────────────────────────────────


_CTX = {
    "navCount": 0,
    "rallyDay": None,
    "powerTrend": None,
    "breadthValue": None,
    "breadthMetricName": "NASI RSI",
    "indexName": "NYA",
    "igRank": None,
    "rsRating": None,
}


def test_create_position_happy_path(db_conn):
    from api.services.journal_two import positions as svc
    p = svc.create_position(
        "u1",
        {
            "symbol": "nvda",  # will normalize to NVDA
            "side": "Long",
            "entryDate": "2026-04-15",
            "shares": 100,
            "entryPrice": 500,
            "stopPrice": 480,
            "setup": "  VCP  ",  # will strip
            "notes": "breakout test",
        },
        _CTX,
        conn=db_conn,
    )
    assert p["symbol"] == "NVDA"
    assert p["setup"] == "VCP"
    assert p["shares"] == 100.0
    assert p["originalShares"] == 100.0
    assert p["raiseToBreakeven"] is False
    assert p["breakevenStop"] is None
    assert p["closedAt"] is None
    assert p["contextAtEntry"]["indexName"] == "NYA"


def test_create_position_rejects_stop_on_wrong_side_long(db_conn):
    from api.services.journal_two import positions as svc
    from api.services.journal_two.positions import PositionValidationError
    with pytest.raises(PositionValidationError):
        svc.create_position(
            "u1",
            {
                "symbol": "X",
                "side": "Long",
                "entryDate": "2026-04-15",
                "shares": 100,
                "entryPrice": 100,
                "stopPrice": 105,  # above entry — invalid for Long
            },
            _CTX,
            conn=db_conn,
        )


def test_create_position_rejects_stop_on_wrong_side_short(db_conn):
    from api.services.journal_two import positions as svc
    from api.services.journal_two.positions import PositionValidationError
    with pytest.raises(PositionValidationError):
        svc.create_position(
            "u1",
            {
                "symbol": "X",
                "side": "Short",
                "entryDate": "2026-04-15",
                "shares": 100,
                "entryPrice": 100,
                "stopPrice": 95,  # below entry — invalid for Short
            },
            _CTX,
            conn=db_conn,
        )


def test_create_position_rejects_far_future_entry_date(db_conn):
    from api.services.journal_two import positions as svc
    from api.services.journal_two.positions import PositionValidationError
    with pytest.raises(PositionValidationError):
        svc.create_position(
            "u1",
            {
                "symbol": "X",
                "side": "Long",
                "entryDate": "2099-01-01",
                "shares": 100,
                "entryPrice": 100,
                "stopPrice": 95,
            },
            _CTX,
            conn=db_conn,
        )


def test_update_position_raise_to_be_preserves_stop_price(db_conn):
    """CRITICAL §9/§18: raiseToBreakeven toggle must NOT touch stopPrice."""
    from api.services.journal_two import positions as svc
    pid = _insert_position(db_conn, "u1", stop_price=27.90)
    before = svc.get_position("u1", pid, conn=db_conn)
    assert before["stopPrice"] == 27.90

    updated = svc.update_position(
        "u1",
        pid,
        {"raiseToBreakeven": True, "breakevenStop": 29.57},
        conn=db_conn,
    )
    assert updated["raiseToBreakeven"] is True
    assert updated["breakevenStop"] == 29.57
    assert updated["stopPrice"] == 27.90  # unchanged


def test_update_position_raise_to_be_toggle_off_clears_breakeven_stop(db_conn):
    from api.services.journal_two import positions as svc
    pid = _insert_position(db_conn, "u1", raise_to_breakeven=1, breakeven_stop=29.57)
    updated = svc.update_position(
        "u1", pid, {"raiseToBreakeven": False}, conn=db_conn
    )
    assert updated["raiseToBreakeven"] is False
    assert updated["breakevenStop"] is None


def test_update_position_stop_price_directly_editable(db_conn):
    """Users CAN edit the original stop deliberately via PUT."""
    from api.services.journal_two import positions as svc
    pid = _insert_position(db_conn, "u1", stop_price=27.90)
    updated = svc.update_position("u1", pid, {"stopPrice": 28.50}, conn=db_conn)
    assert updated["stopPrice"] == 28.50


def test_update_position_ignores_unknown_fields(db_conn):
    from api.services.journal_two import positions as svc
    pid = _insert_position(db_conn, "u1")
    updated = svc.update_position(
        "u1",
        pid,
        {
            "closedAt": "2099-01-01",  # server-owned
            "originalShares": 9999,  # server-owned
            "contextAtEntry": {"fake": True},  # server-owned
            "notes": "legit update",
        },
        conn=db_conn,
    )
    assert updated["notes"] == "legit update"
    assert updated["originalShares"] == 250.0
    assert updated["closedAt"] is None
    assert updated["contextAtEntry"]["indexName"] == "NYA"


def test_update_position_user_isolation(db_conn):
    from api.services.journal_two import positions as svc
    pid = _insert_position(db_conn, "u1")
    # u2 can't update u1's position
    got = svc.update_position("u2", pid, {"notes": "hacked"}, conn=db_conn)
    assert got is None
    # u1's position still has original notes (None)
    original = svc.get_position("u1", pid, conn=db_conn)
    assert original["notes"] is None


def test_delete_position(db_conn):
    from api.services.journal_two import positions as svc
    pid = _insert_position(db_conn, "u1")
    assert svc.delete_position("u1", pid, conn=db_conn) is True
    assert svc.get_position("u1", pid, conn=db_conn) is None


def test_delete_position_user_isolation(db_conn):
    from api.services.journal_two import positions as svc
    pid = _insert_position(db_conn, "u1")
    # u2 can't delete u1's position
    assert svc.delete_position("u2", pid, conn=db_conn) is False
    assert svc.get_position("u1", pid, conn=db_conn) is not None


def test_broker_import_honesty_fields_survive_the_list_payload(db_conn):
    """entry_estimated + source MUST reach the API payload. The 2026-08-20
    reconnect bug: the list SELECT omitted both columns, so _row_to_position
    defaulted entryEstimated to False and source to None -- every estimated
    (placeholder-dated) broker position presented as a real same-day fill, and
    the hero booked its whole unrealized gain as "Today" (+$1,335.87 vs the
    broker's -$881.04)."""
    from api.services.journal_two import positions as svc

    pid = _insert_position(db_conn, "u1", symbol="DELL")
    db_conn.execute(
        "UPDATE j2_positions SET entry_estimated = 1, source = ?, "
        "broker_price = 434.63 WHERE id = ?",
        ("broker", pid),
    )
    db_conn.commit()

    rows = svc.list_open_positions("u1")
    assert len(rows) == 1
    assert rows[0]["entryEstimated"] is True
    assert rows[0]["source"] == "broker"
    assert rows[0]["brokerPrice"] == 434.63

    one = svc.get_position("u1", pid)
    assert one["entryEstimated"] is True
    assert one["source"] == "broker"
