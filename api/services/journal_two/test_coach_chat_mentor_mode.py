"""Tests for the two-lane mentor persona reaching TEXT chat (voice<->text parity).

Verifies:
  - coach_prompts.MENTOR_TWO_LANE is the single source of truth for the text
  - voice_prompts.compass re-exports it as _MENTOR_TWO_LANE (same object, no divergence)
  - coach_chat._mentor_mode_active() implements the same "1"/"admin" semantics
    as the voice-side COMPASS_MENTOR_MODE gate
  - handle_user_turn appends it to the system prompt when active
"""
from __future__ import annotations
import importlib
import os
import sqlite3
import tempfile
import uuid

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


def _mk_user(conn, uid, role):
    conn.execute(
        "INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)",
        (uid, f"{uid}@x.com", "not-a-real-hash", role),
    )
    conn.commit()


def _seed_account(db_conn, user_id):
    from api.services.journal_two import accounts as accounts_service
    return accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)


def test_two_lane_constant_lives_in_coach_prompts():
    from api.services.journal_two import coach_prompts
    assert "TWO LANES" in coach_prompts.MENTOR_TWO_LANE
    # voice must reuse the same object (no divergence)
    from api.services.voice_prompts import compass as vp
    assert vp._MENTOR_TWO_LANE is coach_prompts.MENTOR_TWO_LANE


def test_mentor_mode_flag_semantics(db_conn, monkeypatch):
    from api.services.journal_two import coach_chat
    _mk_user(db_conn, "admin1", "admin")
    _mk_user(db_conn, "user1", "member")

    monkeypatch.delenv("COMPASS_MENTOR_MODE", raising=False)
    assert coach_chat._mentor_mode_active("user1", db_conn) is False

    monkeypatch.setenv("COMPASS_MENTOR_MODE", "1")
    assert coach_chat._mentor_mode_active("user1", db_conn) is True

    monkeypatch.setenv("COMPASS_MENTOR_MODE", "admin")
    assert coach_chat._mentor_mode_active("admin1", db_conn) is True
    assert coach_chat._mentor_mode_active("user1", db_conn) is False


def test_mentor_mode_admin_flag_unknown_user_is_false(db_conn, monkeypatch):
    from api.services.journal_two import coach_chat
    monkeypatch.setenv("COMPASS_MENTOR_MODE", "admin")
    assert coach_chat._mentor_mode_active("nobody", db_conn) is False


def test_system_prompt_gains_two_lane_when_active(db_conn, monkeypatch):
    """Drive one turn with a scripted client and inspect the system prompt."""
    from api.services.journal_two import coach_chat, coach_prompts
    from api.services.journal_two.test_coach_chat import FakeChatClient
    from api.services.journal_two import accounts

    _mk_user(db_conn, "admin1", "admin")
    acct = accounts.get_or_migrate_default_account("admin1", conn=db_conn)
    monkeypatch.setenv("COMPASS_MENTOR_MODE", "admin")

    client = FakeChatClient(stream_scripts=[[{"type": "text", "text": "hi"}]])
    list(coach_chat.handle_user_turn(
        user_id="admin1", account_id=acct["id"],
        user_message="hello", client=client, conn=db_conn,
    ))
    sys_prompt = client.captured_system_prompts[-1]
    assert coach_prompts.MENTOR_TWO_LANE in sys_prompt


def test_system_prompt_omits_two_lane_when_inactive(db_conn, monkeypatch):
    """A non-admin user under COMPASS_MENTOR_MODE=admin never sees the two-lane text."""
    from api.services.journal_two import coach_chat, coach_prompts
    from api.services.journal_two.test_coach_chat import FakeChatClient
    from api.services.journal_two import accounts

    _mk_user(db_conn, "user1", "member")
    acct = accounts.get_or_migrate_default_account("user1", conn=db_conn)
    monkeypatch.setenv("COMPASS_MENTOR_MODE", "admin")

    client = FakeChatClient(stream_scripts=[[{"type": "text", "text": "hi"}]])
    list(coach_chat.handle_user_turn(
        user_id="user1", account_id=acct["id"],
        user_message="hello", client=client, conn=db_conn,
    ))
    sys_prompt = client.captured_system_prompts[-1]
    assert coach_prompts.MENTOR_TWO_LANE not in sys_prompt


def test_system_prompt_omits_two_lane_when_flag_unset(db_conn, monkeypatch):
    """Default off (mirrors shipped voice behavior when COMPASS_MENTOR_MODE is unset)."""
    from api.services.journal_two import coach_chat, coach_prompts
    from api.services.journal_two.test_coach_chat import FakeChatClient
    from api.services.journal_two import accounts

    _mk_user(db_conn, "admin1", "admin")
    acct = accounts.get_or_migrate_default_account("admin1", conn=db_conn)
    monkeypatch.delenv("COMPASS_MENTOR_MODE", raising=False)

    client = FakeChatClient(stream_scripts=[[{"type": "text", "text": "hi"}]])
    list(coach_chat.handle_user_turn(
        user_id="admin1", account_id=acct["id"],
        user_message="hello", client=client, conn=db_conn,
    ))
    sys_prompt = client.captured_system_prompts[-1]
    assert coach_prompts.MENTOR_TWO_LANE not in sys_prompt
