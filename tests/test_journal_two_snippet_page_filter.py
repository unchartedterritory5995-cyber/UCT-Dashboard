"""The search snippets keep a matched row whose body column is NULL (wave 7, lane I, fix round 1,
review M-1).

`_snippets_for` computes snippet()/highlight() for one page of results in a single pass over the
MATCH, then keeps only the page's rows. It used to keep them with `WHERE body_snippet IS NOT NULL`
-- but FTS5's snippet() returns NULL for a matched row whose body column is NULL, so such a row
lost its TITLE highlight too. The page filter is now its own marker column.

Latent today: `j2_notes.body_plain` is `NOT NULL DEFAULT ''` and the FTS trigger copies it, so the
rail has to put the NULL into the FTS row directly. The point is that the filter states what it
means ("on this page"), not what one column happens to hold.
"""
from __future__ import annotations

import json
import sqlite3

import pytest

from api.services.journal_two import db as j2db
from api.services.journal_two import notes as notes_svc

U = "u1"


@pytest.fixture
def conn(tmp_path):
    c = sqlite3.connect(str(tmp_path / "snip.db"))
    c.row_factory = sqlite3.Row
    j2db.ensure_schema(c)
    notes_svc.register_note_sql_functions(c)
    ts = "2026-09-01T00:00:00+00:00"
    for nid, title, text in (("n1", "Breakout plan", "entry over the pivot"),
                             ("n2", "Weekly review", "one clean breakout this week")):
        body = json.dumps({"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": text}]}]})
        c.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags,"
                  " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
                  (nid, U, title, body, text, "[]", ts, ts))
    c.commit()
    yield c
    c.close()


def _by_id(conn):
    return {n["id"]: n for n in notes_svc.list_notes(U, q="breakout", conn=conn)}


def test_control_both_rows_carry_their_snippets(conn):
    got = _by_id(conn)
    assert set(got) == {"n1", "n2"}, got
    assert "<mark>" in got["n1"].get("titleSnippet", ""), got["n1"]
    assert "<mark>" in got["n2"].get("bodySnippet", ""), got["n2"]


def test_a_null_body_in_the_fts_row_keeps_the_title_highlight(conn):
    rid = conn.execute("SELECT fts_rowid FROM j2_notes_fts_map WHERE note_id = 'n1'").fetchone()[0]
    conn.execute("UPDATE j2_notes_fts SET body_plain = NULL WHERE rowid = ?", (rid,))
    conn.commit()
    # the precondition this rail exists for: snippet() really is NULL for that row now
    assert conn.execute(
        "SELECT snippet(j2_notes_fts, 3, '<mark>', '</mark>', '…', 12) FROM j2_notes_fts"
        " WHERE j2_notes_fts MATCH ? AND rowid = ?",
        (notes_svc.fts_match_expr("breakout"), rid)).fetchone()[0] is None
    got = _by_id(conn)
    assert "<mark>" in got["n1"].get("titleSnippet", ""), got["n1"]
    assert got["n1"].get("bodySnippet", None) == "", got["n1"]
    assert "<mark>" in got["n2"].get("bodySnippet", ""), got["n2"]
