"""`GET /notes` computes its page and its total from ONE set of match sets
(wave 7, lane I).

`list_and_count_notes` runs `list_notes` and `count_notes` on one connection and
shares each expensive rowid set between them (`_RowidSets`): the search match
(FTS + the tag the text names + the ticker it names) and the `tag=` match. At 50k
notes the common-term search match is ~42 ms, and it was paid twice per request.

Three things are pinned:
  * the answer equals the two separate calls, for every filter shape the
    predicate treats specially (the shared form must never drift from the
    inline one -- both come from the same `_notes_filter_sql`);
  * the expensive sets really are computed ONCE per request (statements are
    captured from the real function through a recording connection);
  * the route answers from the combined read.
"""
from __future__ import annotations

import json
import sqlite3

import pytest

from api.services.journal_two import db as j2db
from api.services.journal_two import notes as notes_svc

U = "u1"


def _body(text):
    return json.dumps({"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": text}]}]})


@pytest.fixture
def conn(tmp_path):
    c = sqlite3.connect(str(tmp_path / "lc.db"))
    c.row_factory = sqlite3.Row
    j2db.ensure_schema(c)
    notes_svc.register_note_sql_functions(c)
    c.execute("INSERT INTO j2_note_folders (id, user_id, name, sort_order, parent_id, created_at)"
              " VALUES ('f1', ?, 'Setups', 0, '', '2026-09-01T00:00:00Z')", (U,))
    rows = [
        # id, title, body, tags, ticker, folder, deleted_at, archived_at, updated
        ("n1", "Breakout plan", "NVDA breakout over the pivot", ["research/semis"], "NVDA", "f1", None, None, 1),
        ("n2", "Earnings recap", "breakout failed after earnings", ["earnings"], "AMD", None, None, None, 2),
        ("n3", "Weekly review", "no breakout this week", ["review", "research"], None, "f1", None, None, 3),
        ("n4", "Scratch", "breakout notes to delete", ["research"], None, None, "2026-09-02T00:00:00Z", None, 4),
        ("n5", "Shelved", "old breakout idea", ["research/semis"], "NVDA", None, None, "2026-09-02T00:00:00Z", 5),
        ("n6", "Macro", "rates and the dollar", ["macro"], "TLT", None, None, None, 6),
        ("n7", "Earnings", "a note whose only link to the word is its tag", ["Earnings"], None, None, None, None, 7),
    ]
    for nid, title, text, tags, ticker, folder, deleted, archived, upd in rows:
        c.execute(
            "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags, ticker, folder_id,"
            " created_at, updated_at, deleted_at, archived_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (nid, U, title, _body(text), text, json.dumps(tags), ticker, folder,
             "2026-09-01T00:00:00Z", f"2026-09-{10 + upd:02d}T00:00:00Z", deleted, archived))
    # another member's note matching everything: must never be counted
    c.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags, ticker,"
              " created_at, updated_at) VALUES ('x1','u2','Breakout',?,?,?,?,?,?)",
              (_body("breakout earnings research"), "breakout earnings research",
               '["research", "earnings"]', "NVDA", "2026-09-01T00:00:00Z", "2026-09-20T00:00:00Z"))
    c.commit()
    yield c
    c.close()


SHAPES = [
    {},
    {"q": "breakout"},
    {"q": "breakout", "sort": "relevance"},
    {"q": "earnings"},                       # text match AND a tag named by the text
    {"q": "$NVDA"},                          # ticker named by the text
    {"q": "zzznomatch"},
    {"q": "--"},                             # no FTS term: the LIKE fallback
    {"tag": "research"},                     # a parent tag: its children match too
    {"tag": "research", "q": "breakout"},
    {"tag": "nosuchtag"},
    {"folder_id": "f1", "q": "breakout"},
    {"folder_id": "__archived__", "tag": "research"},
    {"deleted": True, "q": "breakout"},
    {"q": "breakout", "limit": 1, "offset": 1},
    {"ticker": "NVDA"},
]


def _separate(conn, kw):
    list_kw = dict(kw)
    count_kw = {k: v for k, v in kw.items() if k not in ("sort", "limit", "offset")}
    return notes_svc.list_notes(U, conn=conn, **list_kw), notes_svc.count_notes(U, conn=conn, **count_kw)


@pytest.mark.parametrize("kw", SHAPES, ids=[json.dumps(s) for s in SHAPES])
def test_the_combined_read_equals_the_two_separate_calls(conn, kw):
    assert notes_svc.list_and_count_notes(U, conn=conn, **kw) == _separate(conn, kw)


def test_non_vacuity_the_shapes_reach_real_matches(conn):
    total = lambda **kw: notes_svc.list_and_count_notes(U, conn=conn, **kw)[1]
    assert total(q="breakout") == 3                    # n1 n2 n3 (n4 trashed, n5 archived)
    assert total(q="earnings") == 2                    # n2 by text, n7 by text+tag
    assert total(q="$NVDA") == 1                       # n1 by ticker
    assert total(tag="research") == 2                  # n1 (research/semis) + n3
    assert total(tag="research", q="breakout") == 2
    assert total(deleted=True, q="breakout") == 1      # n4
    assert total(folder_id="__archived__", tag="research") == 1   # n5
    rows, t = notes_svc.list_and_count_notes(U, conn=conn, q="breakout", limit=1, offset=1)
    assert len(rows) == 1 and t == 3                   # a page is not its total


class _Recorder:
    def __init__(self, conn):
        self._conn = conn
        self.statements: list[str] = []

    def execute(self, sql, params=()):
        self.statements.append(sql)
        return self._conn.execute(sql, params)

    def __getattr__(self, name):
        return getattr(self._conn, name)


def _runs(statements, needle):
    # the snippet pass runs its own MATCH by design; it is not the match set
    return [s for s in statements if needle in s and "snippet(" not in s]


def test_the_search_match_is_computed_ONCE_for_the_page_and_its_total(conn):
    rec = _Recorder(conn)
    notes_svc.list_and_count_notes(U, conn=rec, q="breakout")
    assert len(_runs(rec.statements, "j2_notes_fts MATCH")) == 1, rec.statements
    # control: the separate calls DO pay it twice, so the count above can fail
    rec2 = _Recorder(conn)
    notes_svc.list_notes(U, conn=rec2, q="breakout")
    notes_svc.count_notes(U, conn=rec2, q="breakout")
    assert len(_runs(rec2.statements, "j2_notes_fts MATCH")) == 2


def test_the_tag_match_is_computed_ONCE_for_the_page_and_its_total(conn):
    rec = _Recorder(conn)
    notes_svc.list_and_count_notes(U, conn=rec, tag="research")
    assert len(_runs(rec.statements, "j2_tag_match")) == 1, rec.statements


def test_an_unknown_filter_is_refused_not_ignored(conn):
    with pytest.raises(TypeError):
        notes_svc.list_and_count_notes(U, conn=conn, tags="research")


def test_the_route_answers_from_the_combined_read(monkeypatch):
    from api.routers import journal_two as router
    seen = []

    def fake(user_id, **kw):
        seen.append((user_id, kw.get("q"), kw.get("limit")))
        return [{"id": "n1"}], 7

    monkeypatch.setattr(router.notes_service, "list_and_count_notes", fake)
    monkeypatch.setattr(router.notes_service, "list_notes",
                        lambda *a, **k: pytest.fail("the route must not run list_notes separately"))
    monkeypatch.setattr(router.notes_service, "count_notes",
                        lambda *a, **k: pytest.fail("the route must not run count_notes separately"))
    monkeypatch.setattr(router.notes_service, "resolve_sector_theme_symbols", lambda *a, **k: None)
    out = router.list_notes_endpoint(q="breakout", limit=50, user={"id": U})
    assert out["notes"] == [{"id": "n1"}] and out["total"] == 7
    assert seen == [(U, "breakout", 50)]
