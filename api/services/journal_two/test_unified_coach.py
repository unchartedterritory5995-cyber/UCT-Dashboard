"""Tests for the unified coach state service."""
import sqlite3
import tempfile
import os
import pytest
from api.services.journal_two import unified_coach
from api.services.journal_two.db import ensure_schema


@pytest.fixture
def conn():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    c = sqlite3.connect(path)
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    yield c
    c.close()
    os.remove(path)


def test_get_or_create_returns_defaults_on_first_read(conn):
    state = unified_coach.get_or_create(conn, "user-1")
    assert state["userId"] == "user-1"
    assert state["traderProfile"] == ""
    assert state["compassEnabled"] is True
    assert state["onboarded"] is False
    assert "createdAt" in state and "updatedAt" in state


def test_get_or_create_is_idempotent(conn):
    a = unified_coach.get_or_create(conn, "user-1")
    b = unified_coach.get_or_create(conn, "user-1")
    assert a["createdAt"] == b["createdAt"]


def test_update_profile_persists(conn):
    unified_coach.get_or_create(conn, "user-1")
    out = unified_coach.update_state(conn, "user-1", trader_profile="Disciplined swing trader.")
    assert out["traderProfile"] == "Disciplined swing trader."
    reread = unified_coach.get_or_create(conn, "user-1")
    assert reread["traderProfile"] == "Disciplined swing trader."


def test_update_compass_enabled_toggles(conn):
    unified_coach.get_or_create(conn, "user-1")
    out = unified_coach.update_state(conn, "user-1", compass_enabled=False)
    assert out["compassEnabled"] is False
    reread = unified_coach.get_or_create(conn, "user-1")
    assert reread["compassEnabled"] is False


def test_update_with_no_changes_is_noop(conn):
    unified_coach.get_or_create(conn, "user-1")
    out = unified_coach.update_state(conn, "user-1")
    assert out["traderProfile"] == ""
    assert out["compassEnabled"] is True


def test_update_onboarding_fields_round_trip(conn):
    unified_coach.get_or_create(conn, "u_ob")
    out = unified_coach.update_state(
        conn, "u_ob", onboarding_mode=True, onboarding_session_id="sess-1",
    )
    assert out["onboardingMode"] is True
    assert out["onboardingSessionId"] == "sess-1"
    # Clearing the session id with "" sets NULL
    out2 = unified_coach.update_state(conn, "u_ob", onboarding_session_id="")
    assert out2["onboardingSessionId"] is None


def test_onboarded_defaults_false(conn):
    s = unified_coach.get_or_create(conn, "u_ob2")
    assert s["onboarded"] is False
    assert s["onboardingMode"] is False
    assert s["onboardingSessionId"] is None
