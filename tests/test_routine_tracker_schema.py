"""Notebook widgets phase 2, Task 9.2: the routine and tracker tables (ruling W9-R2)."""
from __future__ import annotations

import sqlite3

import pytest

from api.services.journal_two import db

TABLES = (
    "j2_routines", "j2_routine_schedules", "j2_routine_ticks", "j2_routine_days",
    "j2_routine_reminder_claims", "j2_trackers", "j2_tracker_values",
)


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    db.ensure_schema(c)
    yield c
    c.close()


def _routine(c, rid, uid, key=None):
    c.execute(
        "INSERT INTO j2_routines (id, user_id, name, items_json, settings_json, created_at,"
        " updated_at, source_template_key) VALUES (?, ?, 'r', '[]', '{}', 'x', 'x', ?)",
        (rid, uid, key))


def test_seven_tables_exist_with_user_id(conn):
    for t in TABLES:
        cols = {r[1]: r for r in conn.execute(f"PRAGMA table_info({t})")}
        assert "user_id" in cols, t
        assert cols["user_id"][3] == 1, t  # NOT NULL


def test_routines_and_trackers_carry_deleted_at_and_save_seq(conn):
    for t in ("j2_routines", "j2_trackers"):
        cols = {r[1]: r for r in conn.execute(f"PRAGMA table_info({t})")}
        assert "deleted_at" in cols
        assert cols["save_seq"][3] == 1 and cols["save_seq"][4] == "1"


def test_primary_keys_are_per_member(conn):
    for uid in ("a", "b"):
        conn.execute("INSERT INTO j2_routine_ticks VALUES (?, 'r1', '2026-10-23', 'i1', 1, 'x')", (uid,))
        conn.execute("INSERT INTO j2_routine_days VALUES (?, 'r1', '2026-10-23', 1, 'x')", (uid,))
        conn.execute("INSERT INTO j2_routine_schedules VALUES (?, 'r1', '2026-10-01', '{}')", (uid,))
        conn.execute("INSERT INTO j2_routine_reminder_claims VALUES (?, 'r1', '2026-10-23', 'x')", (uid,))
        conn.execute("INSERT INTO j2_tracker_values VALUES (?, 't1', '2026-10-23', 1.5, 'x')", (uid,))
    for t in ("j2_routine_ticks", "j2_routine_days", "j2_routine_schedules",
              "j2_routine_reminder_claims", "j2_tracker_values"):
        assert conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] == 2, t
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO j2_routine_ticks VALUES ('a', 'r1', '2026-10-23', 'i1', 0, 'y')")


def test_unique_template_key_allows_many_nulls_and_refuses_a_second_key(conn):
    _routine(conn, "r1", "a")
    _routine(conn, "r2", "a")
    _routine(conn, "r3", "a", "premarket_routine")
    with pytest.raises(sqlite3.IntegrityError):
        _routine(conn, "r4", "a", "premarket_routine")
    _routine(conn, "r5", "b", "premarket_routine")
    assert conn.execute("SELECT COUNT(*) FROM j2_routines").fetchone()[0] == 4


def test_tracker_template_key_is_unique_per_member(conn):
    ins = ("INSERT INTO j2_trackers (id, user_id, name, kind, settings_json, created_at,"
           " updated_at, source_template_key) VALUES (?, ?, 't', 'number', '{}', 'x', 'x', ?)")
    conn.execute(ins, ("t1", "a", None))
    conn.execute(ins, ("t2", "a", None))
    conn.execute(ins, ("t3", "a", "sleep"))
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(ins, ("t4", "a", "sleep"))
    conn.execute(ins, ("t5", "b", "sleep"))


def test_ensure_schema_is_idempotent(conn):
    db.ensure_schema(conn)
    db.ensure_schema(conn)
