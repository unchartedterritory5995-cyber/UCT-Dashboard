"""`member_interest._position_syms` against a REAL seeded auth.db.

⛔ The bug this rails: `_position_syms` carried its own SQL naming `sym` and
`status = 'open'` against `j2_positions`, whose columns are `symbol` and
`closed_at`. The query raised on every call, the except swallowed it at INFO,
and every member's open positions vanished from My Stocks. Every other test
of this module MOCKS `_position_syms`, so none of them could see it -- these
rails seed the real Journal 2.0 schema (`journal_two.db.ensure_schema`) in a
temp DATA_DIR and read through the real function.
"""
from __future__ import annotations

import json
import logging
import sqlite3

import pytest

from api.services import member_interest as mi
from api.services.journal_two import db as j2db


def _insert(conn, pid, user_id, symbol, closed_at):
    conn.execute(
        """INSERT INTO j2_positions
             (id, user_id, symbol, side, entry_date, shares, original_shares,
              entry_price, stop_price, context_at_entry, created_at,
              updated_at, closed_at)
           VALUES (?, ?, ?, 'Long', '2026-09-01', 10, 10, 100, 90, ?,
                   '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', ?)""",
        (pid, user_id, symbol, json.dumps({}), closed_at),
    )


@pytest.fixture
def seeded_data_dir(tmp_path, monkeypatch):
    conn = sqlite3.connect(tmp_path / "auth.db")
    try:
        j2db.ensure_schema(conn)
        _insert(conn, "p1", "member-a", "nvda", None)                    # open
        _insert(conn, "p2", "member-a", "TSLA", "2026-09-10T00:00:00Z")  # closed
        _insert(conn, "p3", "member-b-other", "AMD", None)  # someone else's
        conn.commit()
    finally:
        conn.close()
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    return tmp_path


def test_member_gets_exactly_their_open_symbol(seeded_data_dir, caplog):
    with caplog.at_level(logging.WARNING, logger=mi.__name__):
        got = mi._position_syms("member-a")
    assert got == {"NVDA"}
    # A correct read must not have gone through the swallow.
    assert not [r for r in caplog.records if "_position_syms" in r.getMessage()]


def test_a_member_with_no_positions_gets_nothing(seeded_data_dir):
    assert mi._position_syms("member-with-nothing") == set()


def test_positions_reach_interest_for(seeded_data_dir, monkeypatch):
    monkeypatch.setattr(mi, "_watchlist_syms", lambda u: set())
    monkeypatch.setattr(mi, "_flagged_syms", lambda u: set())
    monkeypatch.setattr(mi, "_uct20_syms", lambda u: set())
    out = mi.interest_for("member-a")
    assert out["by_source"]["positions"] == {"NVDA"}
    assert out["entities"]["NVDA"]["because"] == ["positions"]


def test_a_failed_read_is_a_named_warning_not_a_silent_empty(tmp_path, monkeypatch, caplog):
    # An auth.db with no j2_positions table at all: the read must fail LOUDLY.
    sqlite3.connect(tmp_path / "auth.db").close()
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    with caplog.at_level(logging.WARNING, logger=mi.__name__):
        assert mi._position_syms("member-a") == set()
    hits = [r for r in caplog.records
            if r.levelno >= logging.WARNING and "_position_syms" in r.getMessage()]
    assert hits, "a failed positions read left no warning naming the function"
