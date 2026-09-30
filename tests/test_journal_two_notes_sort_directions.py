"""Wave 10 lane FX4 (coordinator round 2): the Notebook table's Title/Updated
header toggle must be SERVER-driven, never a client-side reverse of whatever
page happens to be loaded. `list_notes` pages 100 notes at a time
(`api/routers/journal_two.py::list_notes_endpoint`, `limit: int = 100`); for a
member with more than 100 notes, reversing page 1 of `sort=updated` in the
browser would show the 100 NEWEST notes, backwards, LABELLED oldest-first --
a lie a member would act on.

This pins the two new `order_col` entries `list_notes` gained for the real
fix (`api/services/journal_two/notes.py`): `updated_asc` and `title_desc`,
each with an explicit `id ASC` tiebreak so two notes sharing a timestamp (or,
for title, a case-insensitive title) still page deterministically -- without
the tiebreak, SQLite's plan is free to order tied rows either way per query,
and a page boundary landing inside a tie could show one note twice or drop
another silently.
"""
from __future__ import annotations

import json
import sqlite3

from api.services.journal_two import db as j2db
from api.services.journal_two import notes as notes_svc

U = "u1"


def _body(text: str) -> str:
    return json.dumps({"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": text}]}]})


def _mk_conn(tmp_path):
    c = sqlite3.connect(str(tmp_path / "sortdir.db"))
    c.row_factory = sqlite3.Row
    j2db.ensure_schema(c)
    notes_svc.register_note_sql_functions(c)
    return c


def _insert(c, nid, title, updated_at, user=U):
    c.execute(
        "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags, ticker,"
        " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (nid, user, title, _body(title), title, "[]", None, "2026-01-01T00:00:00Z", updated_at),
    )


def test_updated_asc_page_1_is_the_truly_oldest_notes_not_the_newest_page_reversed(tmp_path):
    """The exact bug this rail exists to catch."""
    c = _mk_conn(tmp_path)
    # 12 notes, updated_at strictly increasing -- n1 is the oldest, n12 the newest.
    for i in range(1, 13):
        _insert(c, f"n{i}", f"Note {i}", f"2026-01-{i:02d}T00:00:00Z")
    c.commit()

    page1 = notes_svc.list_notes(U, sort="updated_asc", limit=5, offset=0, conn=c)
    page2 = notes_svc.list_notes(U, sort="updated_asc", limit=5, offset=5, conn=c)
    page3 = notes_svc.list_notes(U, sort="updated_asc", limit=5, offset=10, conn=c)

    assert [n["id"] for n in page1] == ["n1", "n2", "n3", "n4", "n5"]
    assert [n["id"] for n in page2] == ["n6", "n7", "n8", "n9", "n10"]
    assert [n["id"] for n in page3] == ["n11", "n12"]

    # ⛔ THE BUG THIS PINS: a client-side reverse of `sort=updated`'s own page 1
    # (the 100 -- here 5 -- NEWEST) is n12..n8, never the oldest five.
    newest_page = notes_svc.list_notes(U, sort="updated", limit=5, offset=0, conn=c)
    client_reversed_ids = list(reversed([n["id"] for n in newest_page]))
    assert [n["id"] for n in page1] != client_reversed_ids
    assert client_reversed_ids == ["n8", "n9", "n10", "n11", "n12"]

    # the three pages are disjoint and, together, cover every note exactly once
    seen = [n["id"] for n in page1] + [n["id"] for n in page2] + [n["id"] for n in page3]
    assert len(seen) == len(set(seen)) == 12


def test_updated_asc_ties_break_by_id_so_two_notes_sharing_a_timestamp_still_page_deterministically(tmp_path):
    c = _mk_conn(tmp_path)
    # Two notes share the exact same updated_at -- without the `id ASC`
    # tiebreak this order is whatever the query plan happens to produce.
    _insert(c, "z9", "Z tied", "2026-02-01T00:00:00Z")
    _insert(c, "a1", "A tied", "2026-02-01T00:00:00Z")
    _insert(c, "m5", "M later", "2026-02-02T00:00:00Z")
    c.commit()

    order = [n["id"] for n in notes_svc.list_notes(U, sort="updated_asc", limit=10, offset=0, conn=c)]
    assert order == ["a1", "z9", "m5"]


def test_title_desc_page_1_is_the_truly_last_titles_alphabetically_not_the_first_page_reversed(tmp_path):
    c = _mk_conn(tmp_path)
    # Deliberately SCRAMBLED relative to alphabetical order -- if title_desc
    # ever silently fell back to `updated_at DESC` (the mutation this test
    # exists to catch), an updated_at that happened to agree with alphabetical
    # order would let the wrong query pass by coincidence. It does not agree
    # here: golf (alphabetically last) gets the EARLIEST updated_at.
    titles_and_days = [
        ("Alpha", 5), ("Bravo", 2), ("Charlie", 7), ("Delta", 1),
        ("Echo", 6), ("Foxtrot", 3), ("golf", 4),
    ]
    for i, (t, day) in enumerate(titles_and_days, start=1):
        _insert(c, f"n{i}", t, f"2026-03-{day:02d}T00:00:00Z")
    c.commit()

    page1 = notes_svc.list_notes(U, sort="title_desc", limit=3, offset=0, conn=c)
    page2 = notes_svc.list_notes(U, sort="title_desc", limit=3, offset=3, conn=c)

    # COLLATE NOCASE DESC: "golf" outranks "Foxtrot" outranks "Echo", case-insensitively.
    assert [n["title"] for n in page1] == ["golf", "Foxtrot", "Echo"]
    assert [n["title"] for n in page2] == ["Delta", "Charlie", "Bravo"]
    assert {n["id"] for n in page1} & {n["id"] for n in page2} == set()


def test_title_desc_ties_break_by_id_the_same_way_as_updated_asc(tmp_path):
    c = _mk_conn(tmp_path)
    # z9's updated_at is LATER than a1's, on purpose: a fallback to
    # `updated_at DESC` would put z9 first, the opposite of the `id ASC`
    # tiebreak title_desc actually uses -- so this disagrees with the wrong
    # query instead of coincidentally agreeing with it.
    _insert(c, "z9", "Tied", "2026-05-02T00:00:00Z")
    _insert(c, "a1", "Tied", "2026-05-01T00:00:00Z")
    c.commit()
    order = [n["id"] for n in notes_svc.list_notes(U, sort="title_desc", limit=10, offset=0, conn=c)]
    assert order == ["a1", "z9"]


def test_the_pre_existing_sort_values_are_unchanged_byte_for_byte(tmp_path):
    """The new entries are additive -- `updated`/`title` keep exactly their
    prior `ORDER BY` (no added tiebreak either), so no other caller of
    `sort=` shifts."""
    c = _mk_conn(tmp_path)
    _insert(c, "n1", "Bravo", "2026-04-01T00:00:00Z")
    _insert(c, "n2", "Alpha", "2026-04-02T00:00:00Z")
    c.commit()

    updated = [n["id"] for n in notes_svc.list_notes(U, sort="updated", limit=10, conn=c)]
    title = [n["id"] for n in notes_svc.list_notes(U, sort="title", limit=10, conn=c)]
    assert updated == ["n2", "n1"]  # DESC: newest first
    assert title == ["n2", "n1"]    # ASC by title: Alpha before Bravo


def test_an_unrecognized_sort_value_still_falls_back_exactly_as_before(tmp_path):
    c = _mk_conn(tmp_path)
    _insert(c, "n1", "Bravo", "2026-06-01T00:00:00Z")
    _insert(c, "n2", "Alpha", "2026-06-02T00:00:00Z")
    c.commit()
    # An older client (or a typo) sending something unrecognized must still
    # degrade to the documented default -- updated_at DESC -- never 400, and
    # never silently pick up one of the two new directional keys by accident.
    rows = [n["id"] for n in notes_svc.list_notes(U, sort="not-a-real-value", limit=10, conn=c)]
    assert rows == ["n2", "n1"]
