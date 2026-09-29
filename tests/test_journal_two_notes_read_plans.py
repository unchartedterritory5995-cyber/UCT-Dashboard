"""Query-plan rails for the Notebook's whole-library reads (wave 7, lane I).

Every SQL statement here is CAPTURED from the real read function through a
recording connection, then EXPLAINed. None is retyped. A copy in the test would be
a second authority that drifts from the code it claims to check.

What is pinned, and why each one matters (numbers: docs/notebook/perf-budgets.md §2,
measured at 50k notes):
  * the folder counts, the tag grouping (tag cloud + tree) and the whole-library
    count are answered from a live covering index ALONE (`idx_j2_notes_live_cover`;
    the folder counts may take the narrower `idx_j2_notes_live_folder_title`). A note row's ~2 KB body
    pushes `tags` / `folder_id` / `deleted_at` / `archived_at` onto an overflow page,
    so any plan that touches the table pays an overflow walk per note;
  * the symbol filters (`embed_symbol=`, `ticker=`, sector/theme `symbol_in`) and
    `get_symbol_backlinks` carry NO correlated sidecar subquery. The correlated
    EXISTS was answered from `idx_j2_note_embeds_user_sym` once per note: 717 ms at
    10k, ~14.8 s at 50k;
  * the tasks read (`?view=tasks`) starts from the task-bearing partial index,
    never from every live note's body, and reads the task index beside it (wave 10);
  * a search maps its full-text matches to NOTE ROWIDS through the covering
    `idx_j2_notes_fts_map_rowid_note`, never through j2_notes' TEXT key (wave 10);
  * the backlinks look each note up in the covering `idx_j2_notes_id_live`, never its
    row; the relevance order reads its candidates from the NARROW covering
    `idx_j2_notes_switcher_live`, and its page's total comes from that same read, with
    no second COUNT (wave 10);
  * the document search ranks on the FTS table ALONE and joins + snippets only the
    ranked pages, answering exactly what the one-pass read answers (wave 10).
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
    assert "idx_j2_notes_live_folder_title" in names
    assert "idx_j2_notes_id_live" in names          # wave 10: the backlinks' covering lookups


def test_folder_counts_are_served_from_a_live_covering_index_alone(conn):
    # Either live index answers it without a row read (both lead with user_id,
    # deleted_at, archived_at, folder_id); the defect is a plan that reads rows.
    (sql, steps), = _plans(conn, lambda c: notes_svc.folder_note_counts(U, conn=c))
    assert any("USING COVERING INDEX idx_j2_notes_live_" in s for s in steps), steps


def test_a_folders_rows_are_walked_in_title_order_not_sorted(conn):
    # notes_for_folders: LIMIT 200 of one folder by title. Sorting the whole folder
    # read every note in it (~111 ms at 50k, wave 7 A/B); walked in title order the
    # LIMIT stops the walk.
    conn.execute("UPDATE j2_notes SET folder_id = 'f1'")
    conn.commit()
    (sql, steps), = _plans(conn, lambda c: notes_svc.notes_for_folders(U, ["f1"], conn=c))
    assert any("idx_j2_notes_live_folder_title" in s for s in steps), steps
    assert not any("TEMP B-TREE FOR ORDER BY" in s for s in steps), steps


def test_the_tags_route_makes_ONE_tag_pass_over_the_tag_index_and_parses_no_note(conn):
    # It made four whole-library json_each passes (two groupings, the nested rows,
    # the parents' recount); at 50k notes that was ~1 s p95. Wave 7 made it one
    # covered json_each pass; wave 10 reads the tag index (db.py j2_note_tag_index)
    # instead: grouped off its covering index, the live notes from a live covering
    # index, and no note's `tags` parsed at all.
    plans = _plans(conn, lambda c: notes_svc.tag_counts_and_tree(U, conn=c))
    tag = [(s, st) for s, st in plans if "j2_note_tag_index" in s]
    assert len(tag) == 1, [s for s, _ in plans]
    assert not [s for s, _ in plans if "json_each" in s], [s for s, _ in plans]
    sql, steps = tag[0]
    assert any("COVERING INDEX idx_j2_note_tag_index_tag" in s for s in steps), steps
    assert any("COVERING INDEX idx_j2_notes_live_" in s for s in steps), steps


def test_before_the_tag_index_is_built_the_tags_route_makes_one_covered_json_each_pass(conn):
    # The fallback (db.py `_ensure_note_tag_index` never finished) is the wave-7 pass.
    conn.execute("DELETE FROM j2_schema_builds WHERE name = ?", (j2db._NOTE_TAG_INDEX_BUILD,))
    conn.commit()
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
        inspected = [(sql, steps) for sql, steps in _plans(conn, lambda c: fn(U, conn=c, **kwargs))
                     if "j2_note_embeds" in sql]
        # ⛔ Non-vacuity, PER (filter, function) pair (tests shard M-6): statements that do
        # not name the sidecar are skipped, so a refactor reading it through another name
        # (a view, a CTE) would pass with nothing checked. Every pair reaches exactly one
        # sidecar statement today (the review's probe: 8 of 8).
        assert inspected, (f"{fn.__name__}({kwargs}) ran no statement naming j2_note_embeds -- "
                           "the rail would check nothing for this pair")
        for sql, steps in inspected:
            assert not any("CORRELATED" in s for s in steps), (kwargs, fn.__name__, steps)


def test_symbol_backlinks_start_from_the_symbol_set_not_from_every_note(conn):
    for sql, steps in _plans(conn, lambda c: notes_svc.get_symbol_backlinks(U, "AMD", conn=c)):
        # the notes table is entered by its key, `id`, from the set, never walked. (Wave 10: the
        # lookup is now `idx_j2_notes_id_live`, which also takes user_id/deleted_at as equality
        # terms -- "(id=? AND ...)" -- so the check is that `id` LEADS the search.)
        assert not any(s.startswith("SCAN n") or ("SEARCH n USING" in s and "(id=?" not in s)
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


@pytest.mark.parametrize("sort", ["updated", "relevance"])
def test_a_search_maps_its_matches_to_note_rowids_through_the_covering_index_alone(conn, sort):
    """Wave 10 (lane 10A): FTS rowid -> NOTE ROWID in one read of
    `idx_j2_notes_fts_map_rowid_note (fts_rowid, note_rowid)`. The wave-7 hop went
    FTS rowid -> `note_id` TEXT -> j2_notes' TEXT key (`sqlite_autoindex_j2_notes_1`)
    -> rowid: three lookups per match, 49 ms of a common term's set at 50k notes
    against 19 ms now (docs/notebook/perf-budgets.md §7). Every statement that maps
    the MATCH must read the map from that covering index and never enter j2_notes by
    its TEXT key."""
    conn.execute("UPDATE j2_notes SET body_plain = 'breakout over the pivot', title = 'breakout'")
    conn.commit()
    rec = Recorder(conn)
    rows, total = notes_svc.list_and_count_notes(U, q="breakout", sort=sort, conn=rec)
    assert len(rows) == total == 6          # non-vacuity: the search really matches
    hops = [(s, p) for s, p in rec.statements if "j2_notes_fts_map m" in s and "MATCH" in s]
    assert hops, [s for s, _ in rec.statements]
    for sql, params in hops:
        steps = [r[3] for r in conn.execute("EXPLAIN QUERY PLAN " + sql, params)]
        assert any("COVERING INDEX idx_j2_notes_fts_map_rowid_note" in s for s in steps), (sql, steps)
        assert not any("sqlite_autoindex_j2_notes_1" in s for s in steps), (sql, steps)
        assert "note_rowid" in sql and "m.note_id" not in sql, sql


def test_symbol_backlinks_read_no_note_row(conn):
    """Wave 10 (lane 10A): every note the symbol set names is looked up in the covering
    `idx_j2_notes_id_live (id, user_id, deleted_at, updated_at, title)`. Through the id
    autoindex each lookup read the note's ROW for those columns -- behind the body's
    overflow pages -- 5,000 times for one ticker at 50k (count 24 -> 7 ms, list 32 -> 14 ms,
    perf-budgets.md §7)."""
    plans = _plans(conn, lambda c: notes_svc.get_symbol_backlinks(U, "AMD", conn=c))
    entered = [(sql, steps) for sql, steps in plans if "JOIN j2_notes n" in sql]
    assert entered, [s for s, _ in plans]      # non-vacuity: the read still enters the notes
    for sql, steps in entered:
        assert any("SEARCH n USING COVERING INDEX idx_j2_notes_id_live (id=?" in s for s in steps), steps
    assert notes_svc.get_symbol_backlinks(U, "AMD", conn=conn)["count"] == 6


def test_symbol_backlinks_look_up_each_hit_ONCE(conn):
    """Wave 10 (lane PC): the count and the page come from ONE pass over the symbol's note
    set -- the total is the window count before the LIMIT -- and the embed detail is read for
    the page's ids alone. Two passes looked every hit up in `idx_j2_notes_id_live` twice and
    grouped every embed of the symbol to decorate five rows: about twice the time at every
    curve tier (docs/notebook/perf-budgets.md §9)."""
    rec = Recorder(conn)
    back = notes_svc.get_symbol_backlinks(U, "AMD", limit=2, conn=rec)
    entered = [s for s, _ in rec.statements if "JOIN j2_notes n" in s]
    assert len(entered) == 1, entered
    detail = [(s, p) for s, p in rec.statements if "FROM j2_note_embeds" in s and "GROUP BY note_id" in s]
    assert len(detail) == 1, [s for s, _ in rec.statements]
    sql, params = detail[0]
    assert "note_id IN (" in sql, sql
    # bounded by the PAGE: its ids are the only note ids bound, never the whole set
    assert sorted(p for p in params if str(p).startswith("n")) == sorted(n["id"] for n in back["notes"])
    # ... and the read is KEYED by them (the embeds' primary key, note_id first), never a walk of
    # every embed of the symbol through (user_id, symbol) filtered afterwards
    steps = [r[3] for r in conn.execute("EXPLAIN QUERY PLAN " + sql, params)]
    assert any("j2_note_embeds USING INDEX sqlite_autoindex_j2_note_embeds_1 (note_id=?)" in s
               for s in steps), steps
    assert back["count"] == 6 and len(back["notes"]) == 2      # non-vacuity: total beyond the page
    # The page's order names its tiebreak. Today the note-id set is a UNION, which already hands
    # the ids over in id order, so removing `, n.id` changes no answer on this plan (measured,
    # docs/notebook/gate-runs/wave10-PC/mutation-backlinks-M3-tie.txt) -- a behavioural test
    # cannot see it. The tiebreak is what keeps the page stable the day the plan changes, so the
    # rail holds the SQL itself, as the trash order's rail does.
    assert "ORDER BY n.updated_at DESC, n.id" in entered[0], entered[0]


def test_a_documents_pages_are_found_by_user_and_document_not_by_user_alone(conn):
    """Wave 10 (lane 10A, clause 14b): the editor's per-note document list asks
    `document_text_state` once per document, and its pages read is `document_id = ? AND
    user_id = ?`. Without statistics the planner took the one-column
    `idx_j2_note_document_pages_user (user_id)` and walked every page the member owns, per
    document: 819 ms for a note with 50 documents in a 10,000-document library. The
    two-column `idx_j2_note_document_pages_user_doc` wins the tie (11 ms at 1,000)."""
    from api.services.journal_two import document_ocr
    ts = "2026-09-01T00:00:00+00:00"
    for d in range(3):
        conn.execute("INSERT INTO j2_note_documents (id, user_id, note_id, attachment_url, name, status,"
                     " page_count, created_at) VALUES (?,?,?,?,?,?,?,?)",
                     (f"d{d}", U, "n1", f"/a/{d}.pdf", f"{d}.pdf", "ready", 2, ts))
        for p in (1, 2):
            conn.execute("INSERT INTO j2_note_document_pages (document_id, user_id, page_number, text)"
                         " VALUES (?,?,?,?)", (f"d{d}", U, p, "page text"))
    conn.commit()
    plans = _plans(conn, lambda c: document_ocr.document_text_state(c, U, "d1"))
    pages = [(s, st) for s, st in plans if "FROM j2_note_document_pages WHERE" in s]
    assert len(pages) == 1, [s for s, _ in plans]
    assert any("idx_j2_note_document_pages_user_doc (user_id=? AND document_id=?)" in s
               for s in pages[0][1]), pages[0][1]
    assert document_ocr.document_text_state(conn, U, "d1")["pages_total"] == 2   # non-vacuity


def test_the_relevance_candidates_are_read_from_the_narrow_covering_index(conn):
    """Wave 10 (lane 10A): the relevance order reads (rowid, updated_at) for EVERY row its
    filter admits -- the member's whole live range -- so the index's width is its cost.
    `title` is selected so that the covering index is `idx_j2_notes_switcher_live`, about
    half the width of `idx_j2_notes_live_cover`, which the planner otherwise took."""
    conn.execute("UPDATE j2_notes SET body_plain = 'breakout over the pivot', title = 'breakout'")
    conn.commit()
    plans = _plans(conn, lambda c: notes_svc.list_notes(U, q="breakout", sort="relevance", conn=c))
    cand = [(s, st) for s, st in plans if s.startswith(notes_svc._RELEVANCE_CANDIDATES_SQL)]
    assert len(cand) == 1, [s for s, _ in plans]
    assert any("COVERING INDEX idx_j2_notes_switcher_live" in s for s in cand[0][1]), cand[0][1]


def test_a_relevance_page_takes_its_true_total_from_the_ranked_read(conn):
    """Wave 10 (lane 10A): the relevance read admits exactly the rows `count_notes` counts
    over the same WHERE (it must, to order them), so `list_and_count_notes` answers the
    total from it and runs no second COUNT over the library -- and the answer is the same
    number the separate count gives."""
    conn.execute("UPDATE j2_notes SET body_plain = 'breakout over the pivot', title = 'breakout'"
                 " WHERE id != 'n5'")
    conn.execute("UPDATE j2_notes SET deleted_at = '2026-09-02T00:00:00+00:00' WHERE id = 'n0'")
    conn.commit()
    rec = Recorder(conn)
    rows, total = notes_svc.list_and_count_notes(U, q="breakout", sort="relevance", conn=rec)
    counts = [s for s, _ in rec.statements if "COUNT(*)" in s.upper() and "FROM J2_NOTES" in s.upper()]
    assert counts == [], counts
    assert total == notes_svc.count_notes(U, q="breakout", conn=conn) == len(rows) == 4
    # control: the updated-order page still counts with its own COUNT (its read is a page)
    rec2 = Recorder(conn)
    notes_svc.list_and_count_notes(U, q="breakout", conn=rec2)
    assert [s for s, _ in rec2.statements if "COUNT(*)" in s.upper()], "non-vacuity: the COUNT probe sees nothing"


def test_the_tasks_read_starts_from_the_task_bearing_partial_index(conn):
    now = datetime(2026, 9, 25, 12, tzinfo=note_tasks.ET)
    plans = _plans(conn, lambda c: note_tasks.list_tasks(U, now=now, conn=c))
    main = [st for s, st in plans if "taskItem" in s]
    assert main, "the tasks read no longer names taskItem -- update this rail with it"
    assert any("idx_j2_notes_live_tasks" in s for s in main[0]), main[0]
    # wave 10: each candidate's tasks come from the task index by primary key
    assert any("j2_note_task_digest" in s for s in main[0]), main[0]


def test_the_trash_order_breaks_deleted_at_ties_by_id(conn):
    """Trash (`sort="deleted"`, and the deleted-view default) orders by `deleted_at DESC, id ASC`.

    A batch trash stamps ONE `deleted_at` on many notes. Without the id tiebreak, their order --
    and therefore which note lands on which page -- was whatever the plan scanned, and the
    wave-7 index work changed it (review M-2: 39 of 1,032 differential combinations, every one a
    tie). The ids are inserted in an order that is neither id order nor its reverse, so neither a
    forward nor a reverse index scan can pass this by accident. The plan still walks
    `idx_j2_notes_user_deleted` for the date part; only the ties are sorted.
    """
    stamp = "2026-09-20T12:00:00+00:00"
    for nid in ("t3", "t1", "t4", "t2"):
        conn.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags,"
                     " created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,?,?)",
                     (nid, U, nid, '{"type":"doc"}', "", "[]", stamp, stamp, stamp))
    conn.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags,"
                 " created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,?,?)",
                 ("t0", U, "t0", '{"type":"doc"}', "", "[]", stamp, stamp, "2026-09-21T00:00:00+00:00"))
    conn.commit()
    expect = ["t0", "t1", "t2", "t3", "t4"]
    got = [n["id"] for n in notes_svc.list_notes(U, deleted=True, sort="deleted", conn=conn)]
    assert got == expect, got
    paged = [n["id"] for off in (0, 2, 4)
             for n in notes_svc.list_notes(U, deleted=True, sort="deleted", limit=2, offset=off, conn=conn)]
    assert paged == expect, paged
    # the deleted view's fallback (an unknown sort key) is the same order
    assert [n["id"] for n in notes_svc.list_notes(U, deleted=True, sort="nope", conn=conn)] == expect
    (sql, steps), = [p for p in _plans(conn, lambda c: notes_svc.list_notes(
        U, deleted=True, sort="deleted", conn=c)) if "ORDER BY" in p[0]]
    assert "deleted_at DESC, id ASC" in sql, sql
    # Only the LAST term (the id tiebreak) is sorted; the index still orders `deleted_at`. A whole
    # temp-b-tree sort would read and sort every trashed note before the LIMIT (review nit, fr2).
    # Checked BEFORE the index name, so this assertion is the one a whole-sort plan trips.
    # SQLite words that partial sort two ways: "LAST TERM OF ORDER BY" (3.50 on this box) and
    # "RIGHT PART OF ORDER BY" (3.45, the ubuntu CI runner -- PR #196). Both mean the same plan.
    assert any("USE TEMP B-TREE FOR LAST TERM OF ORDER BY" in s
               or "USE TEMP B-TREE FOR RIGHT PART OF ORDER BY" in s for s in steps), steps
    assert not any("USE TEMP B-TREE FOR ORDER BY" in s for s in steps), steps
    # Which index orders `deleted_at` is the planner's choice: 3.45 takes
    # idx_j2_notes_live_folder_title, whose first two columns are also (user_id, deleted_at). The
    # property is that the SEARCH walks an index leading with exactly those two, derived from the
    # schema rather than named, so a future index of that shape is not a regression.
    leading = set()
    for (name,) in conn.execute("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='j2_notes'"):
        cols = [r[2] for r in conn.execute(f"PRAGMA index_info('{name}')")]
        if cols[:2] == ["user_id", "deleted_at"]:
            leading.add(name)
    assert "idx_j2_notes_user_deleted" in leading, leading  # non-vacuity: the derivation sees it
    assert any(f"INDEX {n} (" in s for s in steps for n in leading), (steps, leading)


def test_the_snippet_page_filter_keeps_the_MATCH_only_plan(conn):
    """`_snippets_for` keeps one page's rows out of ONE pass over the MATCH, by its own `on_page`
    marker. An outer `WHERE rid IN (...)` looks equivalent and is not: SQLite pushes it into the
    FTS scan as a per-rowid seek (`INDEX 0:=M…`), which measured 16.6 ms p50 against 3.9 ms at
    50k notes (docs/notebook/perf-budgets.md; review fr1 nit, fr2). The MATCH-only scan reads
    `INDEX <n>:M…` -- no `=` (a rowid constraint) before the `M`."""
    import re
    conn.execute("UPDATE j2_notes SET body_plain = 'breakout over the pivot', title = 'breakout'")
    conn.commit()
    rec = Recorder(conn)
    got = notes_svc.list_notes(U, q="breakout", conn=rec)
    # non-vacuity: the page really carries snippets, so the statement below is the one that made them
    assert len(got) == 6 and all("<mark>" in n.get("bodySnippet", "") for n in got), got
    snip = [(s, p) for s, p in rec.statements if "snippet(j2_notes_fts" in s]
    assert len(snip) == 1, [s for s, _ in rec.statements]
    sql, params = snip[0]
    steps = [r[3] for r in conn.execute("EXPLAIN QUERY PLAN " + sql, params)]
    fts = [s for s in steps if "j2_notes_fts VIRTUAL TABLE INDEX" in s]
    assert fts, ("non-vacuity: no full-text scan in the plan", steps)
    for s in fts:
        m = re.search(r"VIRTUAL TABLE INDEX \d+:(\S*)", s)
        assert m and m.group(1).startswith("M") and "=" not in m.group(1), steps


# ── the document search (wave 10, lane 10A, clause 14b) ───────────────────────


def _seed_documents(conn, pages):
    """`pages`: [(user, note_id, doc_id, page_number, text)]. The FTS triggers index them."""
    ts = "2026-09-01T00:00:00+00:00"
    seen = set()
    for user, note, doc, pno, text in pages:
        if doc not in seen:
            seen.add(doc)
            conn.execute("INSERT INTO j2_note_documents (id, user_id, note_id, attachment_url, name,"
                         " status, page_count, created_at) VALUES (?,?,?,?,?,?,?,?)",
                         (doc, user, note, f"/a/{doc}.pdf", f"{doc}.pdf", "ready", 1, ts))
        conn.execute("INSERT INTO j2_note_document_pages (document_id, user_id, page_number, text)"
                     " VALUES (?,?,?,?)", (doc, user, pno, text))
    conn.commit()


def test_the_document_search_ranks_on_the_fts_table_alone(conn):
    """The one-pass read joined the document, the note (whose `deleted_at` sits past its body,
    on an overflow page) and the page, and built a snippet, for EVERY matching page before its
    sort kept twenty: 134 ms p50 for a common term over 10,000 documents. The rank now comes
    from the FTS table alone, and only the ranked pages are joined and snippeted (47 ms)."""
    from api.services.journal_two import document_search as ds
    _seed_documents(conn, [(U, f"n{i % 6}", f"d{i}", 1, f"guidance reiterated page {i}")
                           for i in range(12)])
    rec = Recorder(conn)
    hits = ds.search_document_pages(U, "guidance", limit=5, conn=rec)
    assert len(hits) == 5 and all("<mark>" in h["snippet"] for h in hits), hits   # non-vacuity
    fts = [(s, p) for s, p in rec.statements if "j2_note_document_pages_fts" in s and "MATCH" in s]
    assert fts[0][0] == ds._RANKED_SQL, [s for s, _ in fts]
    assert " JOIN " not in fts[0][0].upper() and "LIMIT" in fts[0][0].upper()
    assert len(fts) == 2, [s for s, _ in fts]           # the ranked read, then the ranked pages
    sql, params = fts[1]
    assert "snippet(" in sql and "IN (" in sql and "ORDER BY" not in sql.upper(), sql
    steps = [r[3] for r in conn.execute("EXPLAIN QUERY PLAN " + sql, params)]
    scan = [s for s in steps if "j2_note_document_pages_fts VIRTUAL TABLE INDEX" in s]
    assert scan and all("=" not in s.split(":")[-1] for s in scan), steps   # MATCH-only, no rowid seek


def test_the_document_search_falls_back_to_the_exact_read_when_the_trash_takes_the_window(conn):
    """The ranked read cannot see the Trash. When trashed notes' pages take more of the ranked
    window than its slack, the live pages below it must still be found -- by the exact
    one-pass read -- rather than an empty or short page being returned."""
    from api.services.journal_two import document_search as ds
    conn.execute("UPDATE j2_notes SET deleted_at = '2026-09-02T00:00:00+00:00' WHERE id = 'n0'")
    # the trashed note's pages are indexed FIRST, so they lead every tie of the rank
    trashed = [(U, "n0", f"t{i}", 1, "zzqfallback") for i in range(5)]
    live = [(U, "n1", f"l{i}", 1, "zzqfallback") for i in range(3)]
    _seed_documents(conn, trashed + live)
    rec = Recorder(conn)
    hits = ds.search_document_pages(U, "zzqfallback", limit=2, conn=rec)
    assert [h["document_id"] for h in hits] == ["l0", "l1"], hits
    ordered = [s for s, _ in rec.statements if "ORDER BY bm25" in s and " JOIN " in s]
    assert ordered, "the exact one-pass read never ran"
    # control: with room in the window, the fast path answers and the one-pass read does not run
    rec2 = Recorder(conn)
    got = [h["document_id"] for h in ds.search_document_pages(U, "zzqfallback", limit=8, conn=rec2)]
    assert got == ["l0", "l1", "l2"]
    assert not [s for s, _ in rec2.statements if "ORDER BY bm25" in s and " JOIN " in s]


@pytest.mark.parametrize("limit", [1, 2, 3, 5, 8, 20, 50])
def test_the_document_search_answers_exactly_what_the_one_pass_read_answers(conn, limit):
    """Differential: the two-read search against the exact one-pass read (`_one_pass`, the
    definition), over pages with distinct and TIED scores, a trashed note, a missing note and
    another member's pages, for common, rare, absent and trash-only terms."""
    from api.services.journal_two import document_search as ds
    from api.services.journal_two.notes_search import fts_match_expr
    conn.execute("UPDATE j2_notes SET deleted_at = '2026-09-02T00:00:00+00:00' WHERE id IN ('n2', 'n4')")
    ts = "2026-09-01T00:00:00+00:00"
    conn.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, created_at, updated_at)"
                 " VALUES ('o1', 'other', 'o1', '{}', '', ?, ?)", (ts, ts))
    pages = []
    for i in range(40):
        words = " ".join(["guidance"] * (1 + i % 4)) + f" reiterated filler {'x ' * (i % 7)}"
        pages.append((U, f"n{i % 6}", f"d{i}", 1 + i % 3, words + (" trashonly" if i % 6 in (2, 4) else "")))
    pages += [(U, "gone", "dg", 1, "guidance reiterated")]           # a note that does not exist
    pages += [("other", "o1", f"o{i}", 1, "guidance reiterated") for i in range(10)]
    _seed_documents(conn, pages)
    for q in ("guidance", "guidance reiterated", "reiterated filler", "trashonly", "absentterm"):
        got = ds.search_document_pages(U, q, limit=limit, conn=conn)
        want = ds._one_pass(conn, fts_match_expr(q), U, limit)
        assert got == want, (q, limit, [h["document_id"] for h in got], [h["document_id"] for h in want])
    assert ds.search_document_pages(U, "guidance", limit=limit, conn=conn), "non-vacuity"
    assert ds.search_document_pages(U, "trashonly", limit=limit, conn=conn) == []


def test_the_relevance_pass_ranks_only_the_searching_members_matches(conn):
    """Fix round 1 (review M-4): the FTS table holds every member's notes, and the ranked
    pass held every member's matches in Python before the outer WHERE dropped them -- a
    cost that grew with the platform's library, which a one-member benchmark cannot see.
    The pass now tests each match against the member's rowids, and the test must stay a
    LOOKUP: pushed into the map's index seek (`note_rowid=?`) it probes every member rowid
    for every match."""
    ts = "2026-09-01T00:00:00+00:00"
    conn.execute("UPDATE j2_notes SET body_plain = 'breakout over the pivot', title = 'breakout'")
    for i in range(4):
        conn.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags, ticker,"
                     " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                     (f"o{i}", "u2", "breakout", '{"type":"doc"}', "breakout over the pivot", "[]", None, ts, ts))
    conn.commit()
    rec = Recorder(conn)
    rows = notes_svc.list_notes(U, q="breakout", sort="relevance", conn=rec)
    assert sorted(r["id"] for r in rows) == [f"n{i}" for i in range(6)]
    ranked = [(s, p) for s, p in rec.statements if s == notes_svc._RELEVANCE_RANKED_SQL]
    assert len(ranked) == 1, [s for s, _ in rec.statements]
    sql, params = ranked[0]
    assert U in params
    got = conn.execute(sql, params).fetchall()
    member = {r[0] for r in conn.execute("SELECT rowid FROM j2_notes WHERE user_id = ?", (U,))}
    assert len(got) == 6 and {r[0] for r in got} <= member              # u2's four never ranked
    steps = [r[3] for r in conn.execute("EXPLAIN QUERY PLAN " + sql, params)]
    seek = [s for s in steps if "idx_j2_notes_fts_map_rowid_note" in s]
    assert seek and all("note_rowid=?" not in s for s in seek), steps   # a lookup, never a seek
