"""Query-plan rails for the Notebook's whole-library reads (wave 7, lane I).

Every SQL statement here is CAPTURED from the real read function through a
recording connection, then EXPLAINed. None is retyped. A copy in the test would be
a second authority that drifts from the code it claims to check.

What is pinned, and why each one matters (numbers: docs/notebook/perf-budgets.md §2,
measured at 50k notes):
  * the folder counts, the tag grouping (tag cloud + tree) and the whole-library
    count are answered from `idx_j2_notes_live_cover` ALONE. A note row's ~2 KB body
    pushes `tags` / `folder_id` / `deleted_at` / `archived_at` onto an overflow page,
    so any plan that touches the table pays an overflow walk per note;
  * the symbol filters (`embed_symbol=`, `ticker=`, sector/theme `symbol_in`) and
    `get_symbol_backlinks` carry NO correlated sidecar subquery. The correlated
    EXISTS was answered from `idx_j2_note_embeds_user_sym` once per note: 717 ms at
    10k, ~14.8 s at 50k;
  * the tasks read (`?view=tasks`) starts from the task-bearing partial index,
    never from every live note's body.
Each rail was mutation-proved against the defect it names (see the lane-I report).
"""
from __future__ import annotations

import sqlite3
from datetime import datetime

import pytest

from api.services.journal_two import db as j2db
from api.services.journal_two import note_tasks
from api.services.journal_two import notes as notes_svc

U = "u1"


class Recorder:
    """A connection stand-in that records every statement the real function runs."""

    def __init__(self, conn):
        self._conn = conn
        self.statements: list[tuple[str, tuple]] = []

    def execute(self, sql, params=()):
        self.statements.append((sql, tuple(params)))
        return self._conn.execute(sql, params)

    def cursor(self):
        rec = self

        class _Cur:
            def __init__(self):
                self._c = rec._conn.cursor()

            def __setattr__(self, k, v):
                if k == "_c":
                    object.__setattr__(self, k, v)
                else:
                    setattr(self._c, k, v)

            def execute(self, sql, params=()):
                rec.statements.append((sql, tuple(params)))
                return self._c.execute(sql, params)

        return _Cur()

    def __getattr__(self, name):
        return getattr(self._conn, name)


@pytest.fixture
def conn(tmp_path):
    c = sqlite3.connect(str(tmp_path / "plans.db"))
    c.row_factory = sqlite3.Row
    j2db.ensure_schema(c)
    notes_svc.register_note_sql_functions(c)
    ts = "2026-09-01T00:00:00+00:00"
    for i in range(6):
        body = ('{"type":"doc","content":[{"type":"taskList","content":[{"type":"taskItem",'
                '"attrs":{"checked":false},"content":[{"type":"paragraph","content":'
                '[{"type":"text","text":"t"}]}]}]}]}') if i % 2 else '{"type":"doc"}'
        c.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags, ticker,"
                  " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                  (f"n{i}", U, f"n{i}", body, "", '["a", "b/c"]', "AMD", ts, ts))
        c.execute("INSERT INTO j2_note_embeds (note_id, user_id, position, widget_id, symbol)"
                  " VALUES (?,?,0,'chart','AMD')", (f"n{i}", U))
    c.commit()
    yield c
    c.close()


def _plans(conn, fn):
    rec = Recorder(conn)
    fn(rec)
    out = []
    for sql, params in rec.statements:
        if not sql.lstrip().upper().startswith("SELECT"):
            continue
        steps = [r[3] for r in conn.execute("EXPLAIN QUERY PLAN " + sql, params)]
        out.append((sql, steps))
    assert out, "the function ran no SELECT -- the rail would check nothing"
    return out


def _covered_by_live_cover(steps):
    return any("USING COVERING INDEX idx_j2_notes_live_cover" in s for s in steps)


def test_the_live_cover_index_exists_after_ensure_schema(conn):
    names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")}
    assert "idx_j2_notes_live_cover" in names
    assert "idx_j2_notes_live_tasks" in names


def test_folder_counts_are_served_from_the_cover_index_alone(conn):
    (sql, steps), = _plans(conn, lambda c: notes_svc.folder_note_counts(U, conn=c))
    assert _covered_by_live_cover(steps), steps


def test_the_tags_route_makes_ONE_tag_pass_and_it_is_served_from_the_cover_index(conn):
    # It made four whole-library json_each passes (two groupings, the nested rows,
    # the parents' recount); at 50k notes that was ~1 s p95. One pass, covered.
    plans = _plans(conn, lambda c: notes_svc.tag_counts_and_tree(U, conn=c))
    j2 = [(s, st) for s, st in plans if "json_each" in s]
    assert len(j2) == 1, [s for s, _ in plans]
    for sql, steps in j2:
        assert _covered_by_live_cover(steps), (sql, steps)


@pytest.mark.parametrize("kwargs", [
    {"embed_symbol": "AMD"}, {"ticker": "AMD"}, {"symbol_in": ["AMD", "NVDA"]}, {"embed_widget": "chart"},
])
def test_the_symbol_filters_carry_no_correlated_sidecar_subquery(conn, kwargs):
    for fn in (notes_svc.count_notes, notes_svc.list_notes):
        for sql, steps in _plans(conn, lambda c: fn(U, conn=c, **kwargs)):
            if "j2_note_embeds" not in sql:
                continue
            assert not any("CORRELATED" in s for s in steps), (kwargs, fn.__name__, steps)


def test_symbol_backlinks_start_from_the_symbol_set_not_from_every_note(conn):
    for sql, steps in _plans(conn, lambda c: notes_svc.get_symbol_backlinks(U, "AMD", conn=c)):
        # the notes table is entered by primary key from the set, never walked
        assert not any(s.startswith("SCAN n") or ("SEARCH n USING" in s and "(id=?)" not in s)
                       for s in steps), steps


def test_the_search_boxs_relevance_order_ranks_in_ONE_match_pass(conn):
    # FolderSidebar asks for sort=relevance. The old ORDER BY carried a correlated
    # `(SELECT bm25(...) ... WHERE note_id = j2_notes.id AND MATCH ?)`, which re-ran the
    # full-text query once per candidate note: at 50k notes a common term did not
    # finish in 300 s. The rank must come from one MATCH pass, joined.
    conn.execute("UPDATE j2_notes SET body_plain = 'breakout over the pivot', title = 'breakout'")
    conn.commit()
    rec = Recorder(conn)
    notes_svc.list_notes(U, q="breakout", sort="relevance", conn=rec)
    main = [(s, p) for s, p in rec.statements if "bm25(" in s]
    assert main, "the relevance read no longer calls bm25 -- update this rail with it"
    for sql, params in main:
        rows = conn.execute("EXPLAIN QUERY PLAN " + sql, params).fetchall()
        parent = {r[0]: r[1] for r in rows}
        detail = {r[0]: r[3] for r in rows}

        def under_correlated(node):
            while node in parent:
                node = parent[node]
                if "CORRELATED" in detail.get(node, ""):
                    return True
            return False
        fts_scans = [i for i, d in detail.items() if "j2_notes_fts VIRTUAL TABLE" in d]
        assert fts_scans, ("non-vacuity: the plan shows no full-text scan at all", list(detail.values()))
        # no full-text scan sits inside a per-row (correlated) subquery
        assert not [i for i in fts_scans if under_correlated(i)], list(detail.values())
    # non-vacuity: it really ranks (and returns) the matching notes
    assert len(notes_svc.list_notes(U, q="breakout", sort="relevance", conn=conn)) == 6


def test_the_tasks_read_starts_from_the_task_bearing_partial_index(conn):
    now = datetime(2026, 9, 25, 12, tzinfo=note_tasks.ET)
    plans = _plans(conn, lambda c: note_tasks.list_tasks(U, now=now, conn=c))
    main = [st for s, st in plans if "taskItem" in s]
    assert main, "the tasks read no longer names taskItem -- update this rail with it"
    assert any("idx_j2_notes_live_tasks" in s for s in main[0]), main[0]
