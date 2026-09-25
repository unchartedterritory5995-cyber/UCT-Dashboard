"""Query-plan rail for Ask's entity membership (wave 7, lane H carry-over).

`ask_retrieval._entity_note_ids` answers "which of this member's notes are about
this security" -- the ticker field, a chart embed, or a cashtag mention. It used
to ask the embed and mention halves as two CORRELATED `EXISTS (... WHERE
e.note_id = n.id AND e.user_id = n.user_id AND e.symbol IN (...))`: the same
shape lane I measured on the `GET /notes` symbol filters at 717 ms p95 at 10k
notes and ~14.8 s at 50k, because with no ANALYZE statistics the planner
answers each EXISTS from `idx_j2_note_embeds_user_sym` -- every embed of the
symbol -- once PER NOTE.

It now reads the ONE symbol set `notes._symbol_note_ids_sql` already owns (the
answer every list filter and the symbol backlinks read), as an `IN (subquery)`
computed once.

Every statement is CAPTURED from the real function through a recording
connection and EXPLAINed -- never retyped, which would be a second authority.
The answer itself is pinned too: a plan rail over a function that returns the
wrong notes would be green for the wrong reason.
"""
from __future__ import annotations

import sqlite3

import pytest

from api.services.journal_two import ask_retrieval as ar
from api.services.journal_two import db as j2db
from api.services.journal_two import notes as notes_svc

U, OTHER = "u1", "u2"
TS = "2026-09-01T00:00:00+00:00"


class Recorder:
    """A connection stand-in that records every statement the real function runs."""

    def __init__(self, conn):
        self._conn = conn
        self.statements: list[tuple[str, tuple]] = []

    def execute(self, sql, params=()):
        self.statements.append((sql, tuple(params)))
        return self._conn.execute(sql, params)

    def __getattr__(self, name):
        return getattr(self._conn, name)


def _add_note(c, nid, user, *, ticker=None, deleted=False):
    c.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags, ticker,"
              " created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
              (nid, user, nid, '{"type":"doc"}', "", "[]", ticker, TS, TS,
               TS if deleted else None))


@pytest.fixture
def conn(tmp_path):
    c = sqlite3.connect(str(tmp_path / "ask_plans.db"))
    c.row_factory = sqlite3.Row
    j2db.ensure_schema(c)
    notes_svc.register_note_sql_functions(c)
    # by ticker field / by chart embed / by cashtag mention / about something else
    _add_note(c, "n_ticker", U, ticker="AMD")
    _add_note(c, "n_embed", U)
    _add_note(c, "n_mention", U)
    _add_note(c, "n_other", U, ticker="TSLA")
    _add_note(c, "n_trashed", U, ticker="AMD", deleted=True)
    _add_note(c, "n_foreign", OTHER, ticker="AMD")
    c.execute("INSERT INTO j2_note_embeds (note_id, user_id, position, widget_id, symbol)"
              " VALUES ('n_embed', ?, 0, 'chart', 'AMD')", (U,))
    c.execute("INSERT INTO j2_note_embeds (note_id, user_id, position, widget_id, symbol)"
              " VALUES ('n_foreign', ?, 0, 'chart', 'AMD')", (OTHER,))
    c.execute("INSERT INTO j2_note_mentions (note_id, user_id, symbol, created_at)"
              " VALUES ('n_mention', ?, 'NVDA', ?)", (U, TS))
    # a spread of unrelated embeds so the symbol index has something to walk
    for i in range(20):
        _add_note(c, f"f{i}", U)
        c.execute("INSERT INTO j2_note_embeds (note_id, user_id, position, widget_id, symbol)"
                  " VALUES (?, ?, 0, 'chart', 'AMD')", (f"f{i}", OTHER))
    c.commit()
    yield c
    c.close()


ENTITY = {"symbols": ["AMD", "NVDA"]}


def _captured(conn):
    rec = Recorder(conn)
    ids = ar._entity_note_ids(rec, U, ENTITY)
    sel = [(sql, params) for sql, params in rec.statements
           if sql.lstrip().upper().startswith("SELECT")]
    assert sel, "the function ran no SELECT -- the rail would check nothing"
    return ids, sel


def test_the_answer_is_ticker_OR_embed_OR_mention_for_this_member_and_live_notes_only(conn):
    ids, _ = _captured(conn)
    assert sorted(ids) == ["n_embed", "n_mention", "n_ticker"]


def test_no_symbols_is_no_query_and_no_notes(conn):
    rec = Recorder(conn)
    assert ar._entity_note_ids(rec, U, {"symbols": []}) == []
    assert rec.statements == []


def test_the_membership_query_carries_NO_correlated_sidecar_subquery(conn):
    _, sel = _captured(conn)
    touched = 0
    for sql, params in sel:
        if "j2_note_embeds" not in sql and "j2_note_mentions" not in sql:
            continue
        touched += 1
        steps = [r[3] for r in conn.execute("EXPLAIN QUERY PLAN " + sql, params)]
        assert steps, sql
        assert not any("CORRELATED" in s for s in steps), steps
    # Non-vacuity: the sidecars ARE consulted -- a function that stopped reading
    # embeds and mentions would pass the loop above by skipping it.
    assert touched >= 1


def test_the_symbol_set_is_the_one_notes_already_owns(conn):
    """One authority for 'which notes relate to this symbol': the sidecar half
    of the membership query IS `notes._symbol_note_ids_sql`, not a restatement."""
    side_sql, _ = notes_svc._symbol_note_ids_sql(U, ENTITY["symbols"])
    _, sel = _captured(conn)
    assert any(side_sql in sql for sql, _ in sel), [s for s, _ in sel]


def test_MOVING_the_source_moves_Ask_with_it(conn, monkeypatch):
    """The test above cannot tell a derivation from a byte-identical copy
    (measured: a restated copy passed it). Moving the source can: reorder the
    set's two halves in notes and Ask must carry the new text -- a copy would
    keep the old one. The answer must not change, because it is the same set."""
    real = notes_svc._symbol_note_ids_sql

    def moved(user_id, symbols):
        sql, params = real(user_id, symbols)
        first, second = sql.split(" UNION ")
        half = len(params) // 2
        return f"{second} UNION {first}", [*params[half:], *params[:half]]

    monkeypatch.setattr(notes_svc, "_symbol_note_ids_sql", moved)
    moved_sql, _ = moved(U, ENTITY["symbols"])
    assert moved_sql != real(U, ENTITY["symbols"])[0]
    ids, sel = _captured(conn)
    assert any(moved_sql in sql for sql, _ in sel), [s for s, _ in sel]
    assert sorted(ids) == ["n_embed", "n_mention", "n_ticker"]
