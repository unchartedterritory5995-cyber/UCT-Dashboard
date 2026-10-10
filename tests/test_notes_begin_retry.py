"""A note write retries its write lock once on "database is locked" (swarm, 2026-10-09).

24 concurrent members on one sandbox: two saves 34 ms apart each waited past the
3 s busy timeout at `BEGIN IMMEDIATE` and answered 500. The BEGIN wrote nothing,
so one retry is safe; a second failure still raises (the busy timeout stays short).
"""
from __future__ import annotations

import sqlite3

import pytest

from api.services.journal_two import notes


class _Conn:
    def __init__(self, failures: int, message: str = "database is locked"):
        self.failures, self.message, self.calls = failures, message, []

    def execute(self, sql):
        self.calls.append(sql)
        if self.failures:
            self.failures -= 1
            raise sqlite3.OperationalError(self.message)


def test_one_locked_begin_is_retried_and_succeeds():
    c = _Conn(failures=1)
    notes._begin_immediate(c, backoff=0)
    assert c.calls == ["BEGIN IMMEDIATE", "BEGIN IMMEDIATE"]


def test_a_second_locked_begin_still_raises():
    c = _Conn(failures=2)
    with pytest.raises(sqlite3.OperationalError):
        notes._begin_immediate(c, backoff=0)
    assert len(c.calls) == 2


def test_an_error_that_is_not_a_lock_is_not_retried():
    c = _Conn(failures=1, message="no such table: j2_notes")
    with pytest.raises(sqlite3.OperationalError):
        notes._begin_immediate(c, backoff=0)
    assert c.calls == ["BEGIN IMMEDIATE"]


def test_every_write_lock_in_the_notes_service_goes_through_the_retry():
    import inspect
    src = inspect.getsource(notes)
    helper = inspect.getsource(notes._begin_immediate)
    assert src.replace(helper, "").count('conn.execute("BEGIN IMMEDIATE")') == 0
    assert src.count("_begin_immediate(conn)") >= 7
