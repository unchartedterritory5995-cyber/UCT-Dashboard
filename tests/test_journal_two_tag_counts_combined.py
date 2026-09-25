"""GET /notes/tags from ONE pass: `tag_counts_and_tree` must equal the two separate
reads it replaced (wave 7, lane I).

The route used to call `tag_counts` and `tag_tree` separately, each on its own
connection and each grouping the whole library's tags. The combined function reads
the grouped rows once and folds them twice (all tags, then only the tags with no
'/'). If the fold drifts, the sidebar's tag cloud and its tree stop agreeing with
the `tag=` filter, and nothing structural would notice. So the rail compares the
combined answer with the two separate ones on a library holding every tag shape
the fold treats specially:
  * a case variant carried by DIFFERENT notes ("Earnings" / "earnings"), and both
    spellings on ONE note (the collided-group recount);
  * a legacy spaced path ("Q3 / Q4") beside "q3/q4";
  * a legacy trailing slash ("research/"), which normalises to a FLAT key but sits
    in the nested rows;
  * raw UTF-8 "Élan" beside an escaped "\\u00e9lan";
  * a flat tag that is also a parent ("review" + "review/weekly");
  * a trashed note and an archived note, whose tags must count nowhere.
"""
from __future__ import annotations

import json
import sqlite3

import pytest

from api.services.journal_two import db as j2db
from api.services.journal_two import notes as notes_svc

U = "u1"
TS = "2026-09-01T00:00:00+00:00"


@pytest.fixture
def conn(tmp_path):
    c = sqlite3.connect(str(tmp_path / "t.db"))
    c.row_factory = sqlite3.Row
    j2db.ensure_schema(c)
    rows = [
        ("n1", ["Earnings", "research/semis"]),
        ("n2", ["earnings", "review"]),
        ("n3", ["Earnings", "earnings", "review/weekly"]),
        ("n4", ["Q3 / Q4", "research/"]),
        ("n5", ["q3/q4", "research/semis/memory", "review"]),
        ("n6", ["setups/breakout", "setups/breakout/vcp"]),
        ("n7", []),
        ("n8", ["macro/rates", "Macro/Rates"]),
    ]
    for nid, tags in rows:
        c.execute(
            "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (nid, U, nid, '{"type":"doc"}', "", json.dumps(tags, ensure_ascii=False), TS, TS))
    # the two spellings json.dumps writes for a non-ASCII tag
    c.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags, created_at, updated_at)"
              " VALUES ('n9', ?, 'n9', '{}', '', ?, ?, ?)", (U, '["Élan"]', TS, TS))
    c.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags, created_at, updated_at)"
              " VALUES ('n10', ?, 'n10', '{}', '', ?, ?, ?)", (U, '["\\u00e9lan", "review"]', TS, TS))
    # trashed + archived: their tags must count nowhere
    c.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags, created_at, updated_at,"
              " deleted_at) VALUES ('n11', ?, 'n11', '{}', '', ?, ?, ?, ?)",
              (U, '["gone", "review"]', TS, TS, TS))
    c.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags, created_at, updated_at,"
              " archived_at) VALUES ('n12', ?, 'n12', '{}', '', ?, ?, ?, ?)",
              (U, '["shelved/away"]', TS, TS, TS))
    # another member's notes are never counted
    c.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags, created_at, updated_at)"
              " VALUES ('x1', 'u2', 'x1', '{}', '', '[\"earnings\"]', ?, ?)", (TS, TS))
    c.commit()
    yield c
    c.close()


def test_the_combined_read_equals_the_two_separate_reads(conn):
    combined = notes_svc.tag_counts_and_tree(U, conn=conn)
    assert combined == {"tags": notes_svc.tag_counts(U, conn=conn), "tree": notes_svc.tag_tree(U, conn=conn)}


def _recomputed_truth(conn):
    """From scratch, in plain Python, over the raw stored tags of the member's LIVE
    notes: per key, the notes carrying it exactly (`own`) and the notes carrying it
    or anything below it (`total`) -- the definitions `tag_tree`'s docstring states
    and the `tag=` filter lists."""
    exact: dict[str, set[str]] = {}
    spell: dict[str, str] = {}
    for nid, tags in conn.execute(
            "SELECT id, tags FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL"
            " AND archived_at IS NULL", (U,)):
        for t in json.loads(tags or "[]"):
            k = notes_svc.tag_key(t)
            if k:
                exact.setdefault(k, set()).add(nid)
                spell[k] = max(spell.get(k, ""), t)
    nodes = set(exact)
    for k in list(exact):
        segs = k.split("/")
        nodes.update("/".join(segs[:i]) for i in range(1, len(segs)))
    tree = {n: (len(exact.get(n, ())),
                len(set().union(*[ids for k, ids in exact.items() if k == n or k.startswith(n + "/")])))
            for n in nodes}
    counts = {k: (len(ids), spell[k]) for k, ids in exact.items()}
    return counts, tree


def test_the_combined_read_equals_a_from_scratch_recomputation(conn):
    """The rewrite changed HOW the tags are grouped (one scan, Python folding),
    so equality with the separate calls alone cannot catch a shared mistake --
    both run the same new code. This compares with the definition instead."""
    got = notes_svc.tag_counts_and_tree(U, conn=conn)
    counts, tree = _recomputed_truth(conn)
    assert {notes_svc.tag_key(r["tag"]): (r["count"], r["tag"]) for r in got["tags"]} == counts
    assert {n["key"]: (n["own"], n["total"]) for n in got["tree"]} == tree
    for n in got["tree"]:
        assert notes_svc.tag_key(n["path"]) == n["key"], n


def test_non_vacuity_the_fixture_reaches_every_special_shape(conn):
    got = notes_svc.tag_counts_and_tree(U, conn=conn)
    counts = {notes_svc.tag_key(r["tag"]): r["count"] for r in got["tags"]}
    tree = {n["key"]: n for n in got["tree"]}
    assert counts["earnings"] == 3            # n1, n2, n3 -- n3 carries both spellings, counted once
    assert counts["q3/q4"] == 2               # the spaced legacy spelling folds in
    assert counts["élan"] == 2                # raw UTF-8 and the escape are one tag
    assert "gone" not in counts and "shelved/away" not in counts   # trash, archive
    assert tree["review"]["total"] == 4       # n2, n5, n10 own it; n3 sits below it
    assert tree["research"]["own"] == 1 and tree["research"]["total"] == 3   # "research/" is n4's
    assert tree["setups"]["own"] == 0         # an implied parent
    assert tree["macro/rates"]["own"] == 1    # one note, two spellings


def test_the_route_answers_from_the_combined_read(conn, monkeypatch):
    from api.routers import journal_two as router
    seen = []

    def fake(user_id, conn=None):
        seen.append(user_id)
        return {"tags": [{"tag": "t", "count": 1}], "tree": []}

    monkeypatch.setattr(router.notes_service, "tag_counts_and_tree", fake)
    monkeypatch.setattr(router.notes_service, "tag_counts",
                        lambda *a, **k: pytest.fail("the route must not re-run tag_counts"))
    monkeypatch.setattr(router.notes_service, "tag_tree",
                        lambda *a, **k: pytest.fail("the route must not re-run tag_tree"))
    assert router.note_tag_counts_endpoint(user={"id": U}) == {"tags": [{"tag": "t", "count": 1}], "tree": []}
    assert seen == [U]
