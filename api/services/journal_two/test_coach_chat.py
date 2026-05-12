"""Tests for the Compass Chat orchestrator (persistence layer first)."""
from __future__ import annotations
import importlib, json, os, sqlite3, tempfile, uuid
from datetime import datetime, timezone, timedelta
import pytest


# ── Streaming loop with read/analyze tools ──────────────────────────────────


class FakeAnthropicStream:
    """Scripted Anthropic stream — emits text + tool_use events."""
    def __init__(self, *, events: list[dict]):
        self.events = list(events)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def __iter__(self):
        for ev in self.events:
            yield ev


class FakeChatClient:
    """Stand-in for AnthropicChatClient. Script multiple stream responses."""
    def __init__(self, *, stream_scripts: list[list[dict]]):
        self.stream_scripts = list(stream_scripts)
        self.calls = []

    def start_stream(self, *, system_prompt: str, messages: list, tools: list):
        self.calls.append({"system_prompt": system_prompt, "messages": messages, "tools": tools})
        if not self.stream_scripts:
            raise RuntimeError("FakeChatClient out of stream scripts")
        events = self.stream_scripts.pop(0)
        return FakeAnthropicStream(events=events)


def _insert_trade(conn, *, user_id, account_id, exit_iso, **kwargs):
    defaults = dict(
        symbol="TEST", side="Long", shares=100,
        entry_price=100.0, entry_date=exit_iso,
        exit_price=105.0, exit_date=exit_iso,
        original_stop=95.0, setup="Bull Flag", notes=None,
        pnl_dollar=500.0, pnl_percent=5.0, r_multiple=1.0,
        hold_days=2, result="Win", context_at_entry="{}",
        created_at=exit_iso, mistake_tags="[]", emotion_tags="[]",
        fees=0, regime=None,
    )
    defaults.update(kwargs)
    conn.execute(
        """INSERT INTO j2_trades (
            id, user_id, position_id, symbol, side, shares,
            entry_price, entry_date, exit_price, exit_date,
            original_stop, setup, notes, pnl_dollar, pnl_percent,
            r_multiple, hold_days, result, context_at_entry,
            created_at, account_id, mistake_tags, emotion_tags, fees, regime
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (str(uuid.uuid4()), user_id, str(uuid.uuid4()),
         defaults["symbol"], defaults["side"], defaults["shares"],
         defaults["entry_price"], defaults["entry_date"],
         defaults["exit_price"], defaults["exit_date"],
         defaults["original_stop"], defaults["setup"], defaults["notes"],
         defaults["pnl_dollar"], defaults["pnl_percent"], defaults["r_multiple"],
         defaults["hold_days"], defaults["result"], defaults["context_at_entry"],
         defaults["created_at"], account_id, defaults["mistake_tags"],
         defaults["emotion_tags"], defaults["fees"], defaults["regime"]),
    )
    conn.commit()


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


def test_handle_user_turn_simple_text_response(db_conn):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    client = FakeChatClient(stream_scripts=[
        [{"type": "text", "text": "Hello back."}, {"type": "message_stop"}],
    ])
    events = list(coach_chat.handle_user_turn(
        user_id="u_chat", account_id=acc["id"],
        user_message="Hi.", client=client, conn=db_conn,
    ))
    rows = db_conn.execute("SELECT role, content FROM j2_chat_messages ORDER BY created_at").fetchall()
    assert rows[0]["role"] == "user"
    assert rows[0]["content"] == "Hi."
    assistant_rows = [r for r in rows if r["role"] == "assistant"]
    assert len(assistant_rows) == 1
    assert assistant_rows[0]["content"] == "Hello back."
    types = [e.get("type") for e in events]
    assert "token" in types
    assert "complete" in types


def test_handle_user_turn_executes_read_tool_inline(db_conn):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-11T20:00:00+00:00")
    client = FakeChatClient(stream_scripts=[
        [{"type": "tool_use", "id": "tu_1", "name": "list_recent_trades", "input": {"days": 7}},
         {"type": "message_stop"}],
        [{"type": "text", "text": "You had 1 trade."}, {"type": "message_stop"}],
    ])
    events = list(coach_chat.handle_user_turn(
        user_id="u_chat", account_id=acc["id"],
        user_message="How many trades?", client=client, conn=db_conn,
    ))
    rows = db_conn.execute("SELECT role FROM j2_chat_messages ORDER BY created_at").fetchall()
    roles = [r["role"] for r in rows]
    assert "tool" in roles
    assistant_contents = [
        r["content"] for r in db_conn.execute(
            "SELECT content FROM j2_chat_messages WHERE role='assistant'"
        ).fetchall()
    ]
    assert any("1 trade" in (c or "") for c in assistant_contents)
    assert len(client.calls) == 2


def test_handle_user_turn_rate_limit_returns_error_event(db_conn, monkeypatch):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    for _ in range(coach_chat.RATE_LIMIT_PER_DAY):
        coach_chat.append_message(user_id="u_chat", account_id=acc["id"],
                                  role="user", content="x", conn=db_conn)
    client = FakeChatClient(stream_scripts=[])
    events = list(coach_chat.handle_user_turn(
        user_id="u_chat", account_id=acc["id"], user_message="another",
        client=client, conn=db_conn,
    ))
    types = [e.get("type") for e in events]
    assert "error" in types
    n = db_conn.execute("SELECT COUNT(*) AS n FROM j2_chat_messages WHERE role='user'").fetchone()["n"]
    assert n == coach_chat.RATE_LIMIT_PER_DAY


def test_handle_user_turn_kill_switch_returns_disabled(db_conn, monkeypatch):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    monkeypatch.setenv("COMPASS_CHAT_ENABLED", "false")
    client = FakeChatClient(stream_scripts=[])
    events = list(coach_chat.handle_user_turn(
        user_id="u_chat", account_id=acc["id"], user_message="hello",
        client=client, conn=db_conn,
    ))
    types = [e.get("type") for e in events]
    assert "error" in types
    n = db_conn.execute("SELECT COUNT(*) AS n FROM j2_chat_messages").fetchone()["n"]
    assert n == 0
