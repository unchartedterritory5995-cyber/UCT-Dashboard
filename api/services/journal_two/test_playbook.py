"""Playbook/Stock Observation library — CRUD + filter + validation."""

import os
import sqlite3
import tempfile

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


def test_create_entry_basic(db_conn):
    from api.services.journal_two.playbook import create_entry
    _add_user(db_conn, "u1", "u1@x.com")

    entry = create_entry("u1", {
        "symbol": "nvda",  # lowercased; should normalize
        "observedDate": "2026-04-19",
        "setup": "VCP",
        "thesis": "Tight base, high volume breakout candidate.",
        "levels": {"support": 195, "resistance": 210, "trigger": 210.5, "stop": 193},
    }, conn=db_conn)
    assert entry["symbol"] == "NVDA"
    assert entry["status"] == "watching"
    assert entry["levels"]["trigger"] == 210.5
    assert entry["setup"] == "VCP"


def test_create_requires_symbol_and_date(db_conn):
    from api.services.journal_two.playbook import create_entry, PlaybookValidationError
    _add_user(db_conn, "u1", "u1@x.com")
    with pytest.raises(PlaybookValidationError):
        create_entry("u1", {"observedDate": "2026-04-19"}, conn=db_conn)
    with pytest.raises(PlaybookValidationError):
        create_entry("u1", {"symbol": "NVDA"}, conn=db_conn)


def test_create_rejects_invalid_status(db_conn):
    from api.services.journal_two.playbook import create_entry, PlaybookValidationError
    _add_user(db_conn, "u1", "u1@x.com")
    with pytest.raises(PlaybookValidationError):
        create_entry("u1", {
            "symbol": "NVDA", "observedDate": "2026-04-19",
            "status": "cooking",
        }, conn=db_conn)


def test_create_rejects_invalid_levels(db_conn):
    from api.services.journal_two.playbook import create_entry, PlaybookValidationError
    _add_user(db_conn, "u1", "u1@x.com")
    with pytest.raises(PlaybookValidationError):
        create_entry("u1", {
            "symbol": "NVDA", "observedDate": "2026-04-19",
            "levels": {"support": "not a number"},
        }, conn=db_conn)


def test_list_filters(db_conn):
    from api.services.journal_two.playbook import create_entry, list_entries
    _add_user(db_conn, "u1", "u1@x.com")

    create_entry("u1", {"symbol": "NVDA", "observedDate": "2026-04-19"}, conn=db_conn)
    create_entry("u1", {"symbol": "AMD",  "observedDate": "2026-04-18",
                         "status": "triggered"}, conn=db_conn)
    create_entry("u1", {"symbol": "NVDA", "observedDate": "2026-04-17",
                         "status": "passed"}, conn=db_conn)

    all_entries = list_entries("u1", conn=db_conn)
    assert len(all_entries) == 3
    # Default sort newest first
    assert all_entries[0]["observedDate"] == "2026-04-19"

    by_sym = list_entries("u1", symbol="NVDA", conn=db_conn)
    assert len(by_sym) == 2

    by_status = list_entries("u1", status="triggered", conn=db_conn)
    assert len(by_status) == 1
    assert by_status[0]["symbol"] == "AMD"


def test_update_entry(db_conn):
    from api.services.journal_two.playbook import create_entry, update_entry
    _add_user(db_conn, "u1", "u1@x.com")
    e = create_entry("u1", {"symbol": "NVDA", "observedDate": "2026-04-19"}, conn=db_conn)

    updated = update_entry("u1", e["id"], {
        "status": "triggered",
        "thesis": "Broke out above 210.",
        "levels": {"support": 208},
    }, conn=db_conn)
    assert updated["status"] == "triggered"
    assert updated["thesis"] == "Broke out above 210."
    assert updated["levels"]["support"] == 208


def test_update_status_transitions(db_conn):
    from api.services.journal_two.playbook import create_entry, update_entry
    _add_user(db_conn, "u1", "u1@x.com")
    e = create_entry("u1", {"symbol": "NVDA", "observedDate": "2026-04-19"}, conn=db_conn)
    for status in ["triggered", "traded", "dead"]:
        updated = update_entry("u1", e["id"], {"status": status}, conn=db_conn)
        assert updated["status"] == status


def test_link_to_position_and_trade(db_conn):
    from api.services.journal_two.playbook import create_entry, update_entry
    _add_user(db_conn, "u1", "u1@x.com")
    e = create_entry("u1", {"symbol": "NVDA", "observedDate": "2026-04-19"}, conn=db_conn)

    updated = update_entry("u1", e["id"], {
        "linkedPositionId": "pos-abc",
        "status": "traded",
    }, conn=db_conn)
    assert updated["linkedPositionId"] == "pos-abc"
    assert updated["status"] == "traded"

    updated = update_entry("u1", e["id"], {
        "linkedTradeId": "trade-xyz",
    }, conn=db_conn)
    assert updated["linkedTradeId"] == "trade-xyz"


def test_delete_entry(db_conn):
    from api.services.journal_two.playbook import (
        create_entry, delete_entry, get_entry,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    e = create_entry("u1", {"symbol": "NVDA", "observedDate": "2026-04-19"}, conn=db_conn)
    assert delete_entry("u1", e["id"], conn=db_conn) is True
    assert get_entry("u1", e["id"], conn=db_conn) is None


def test_user_isolation(db_conn):
    from api.services.journal_two.playbook import (
        create_entry, list_entries, get_entry, update_entry, delete_entry,
    )
    _add_user(db_conn, "alice", "alice@x.com")
    _add_user(db_conn, "bob", "bob@x.com")
    a = create_entry("alice", {"symbol": "NVDA", "observedDate": "2026-04-19"}, conn=db_conn)

    assert list_entries("bob", conn=db_conn) == []
    assert get_entry("bob", a["id"], conn=db_conn) is None
    assert update_entry("bob", a["id"], {"status": "dead"}, conn=db_conn) is None
    assert delete_entry("bob", a["id"], conn=db_conn) is False
