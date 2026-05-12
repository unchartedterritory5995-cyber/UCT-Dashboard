"""Tests for the Compass Chat orchestrator (persistence layer first)."""
from __future__ import annotations
import importlib, json, os, sqlite3, tempfile, uuid
from datetime import datetime, timezone, timedelta
import pytest


@pytest.fixture
def db_conn(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = sqlite3.connect(tmp.name)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()
    os.unlink(tmp.name)


def _seed_account(db_conn, user_id="u_chat"):
    from api.services.journal_two import accounts as accounts_service
    return accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)


def test_append_user_message_writes_row(db_conn):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    msg_id = coach_chat.append_message(
        user_id="u_chat", account_id=acc["id"],
        role="user", content="Hello Compass.",
        conn=db_conn,
    )
    row = db_conn.execute("SELECT role, content FROM j2_chat_messages WHERE id = ?", (msg_id,)).fetchone()
    assert row["role"] == "user"
    assert row["content"] == "Hello Compass."


def test_list_messages_returns_chronological(db_conn):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    coach_chat.append_message(user_id="u_chat", account_id=acc["id"],
                              role="user", content="One", conn=db_conn)
    coach_chat.append_message(user_id="u_chat", account_id=acc["id"],
                              role="assistant", content="Reply", conn=db_conn)
    msgs = coach_chat.list_messages(user_id="u_chat", account_id=acc["id"], limit=10, conn=db_conn)
    assert msgs["messages"][0]["content"] == "One"
    assert msgs["messages"][1]["content"] == "Reply"


def test_forget_message_marks_forgotten(db_conn):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    mid = coach_chat.append_message(user_id="u_chat", account_id=acc["id"],
                                    role="user", content="Forget me", conn=db_conn)
    coach_chat.forget_message(user_id="u_chat", account_id=acc["id"],
                              message_id=mid, conn=db_conn)
    msgs = coach_chat.list_messages(user_id="u_chat", account_id=acc["id"], limit=10, conn=db_conn)
    assert all(m["id"] != mid for m in msgs["messages"])


def test_forget_all_marks_every_message_forgotten(db_conn):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    coach_chat.append_message(user_id="u_chat", account_id=acc["id"],
                              role="user", content="One", conn=db_conn)
    coach_chat.append_message(user_id="u_chat", account_id=acc["id"],
                              role="assistant", content="Two", conn=db_conn)
    coach_chat.forget_message(user_id="u_chat", account_id=acc["id"], all=True, conn=db_conn)
    msgs = coach_chat.list_messages(user_id="u_chat", account_id=acc["id"], limit=10, conn=db_conn)
    assert msgs["messages"] == []


def test_rate_limit_check_counts_user_messages_today(db_conn):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    for _ in range(5):
        coach_chat.append_message(user_id="u_chat", account_id=acc["id"],
                                  role="user", content="msg", conn=db_conn)
    info = coach_chat.get_rate_limit_info(user_id="u_chat", account_id=acc["id"], conn=db_conn)
    assert info["used"] == 5
    assert info["remaining"] == 200 - 5


def test_chat_status_reflects_env_kill_switch(db_conn, monkeypatch):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    monkeypatch.setenv("COMPASS_CHAT_ENABLED", "false")
    status = coach_chat.get_chat_status(user_id="u_chat", account_id=acc["id"], conn=db_conn)
    assert status["enabled"] is False
    monkeypatch.setenv("COMPASS_CHAT_ENABLED", "true")
    status2 = coach_chat.get_chat_status(user_id="u_chat", account_id=acc["id"], conn=db_conn)
    assert status2["enabled"] is True
