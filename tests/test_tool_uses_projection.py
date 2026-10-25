"""Task 8.9 - the "used in" projection: `j2_tool_uses`, one row per saved tool placed in a note.

`notes._sync_note_sidecars` already walks every `widgetEmbed` once per save. A node whose
`widgetId` is `builtWidget` and whose `params.defId` is a string adds
`(user_id, note_id, "widget", defId, defRev)`. The note's rows are deleted and re-inserted in
the caller's transaction, the same shape as `j2_note_checkins`. The table is a rebuildable
projection, never edited directly.

`widget_definitions.used_in_notes(user_id, def_id)` reads it joined to `j2_notes` (not trashed,
not a sample note), and `get()`'s `usedIn` is that count of distinct notes. Only the member's
own rows count: A's note naming B's widget id adds nothing to B's count.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta, timezone

import pytest

A, B = "u-uses-a", "u-uses-b"


@pytest.fixture
def conn():
    from api.services.journal_two.db import ensure_schema
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    yield c
    c.close()


def _built(def_id, def_rev=1, embed_id="e-1"):
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": "builtWidget", "embedId": embed_id, "mode": "snapshot",
        "params": {"defId": def_id, "defRev": def_rev}, "searchText": "[widget]"}}


def _doc(*nodes):
    return {"type": "doc", "content": list(nodes)}


def _note(conn, *nodes, user_id=A, title="Day"):
    from api.services.journal_two import notes as svc
    return svc.create_note(user_id, {"title": title, "bodyJson": _doc(*nodes)}, conn=conn)


def _def(conn, user_id=A, name="My widget"):
    """A stored widget row, inserted directly (the store's own create needs Task 8.5's catalog)."""
    import uuid
    def_id = str(uuid.uuid4())
    ts = "2026-10-24T15:00:00+00:00"
    plan = json.dumps({"v": 1, "source": "closed_trades", "measures": [{"key": "net_pnl"}]})
    conn.execute(
        "INSERT INTO j2_widget_definitions (id, user_id, name, plan_json, plan_version, rev,"
        " placed_rev, created_at, updated_at, save_seq) VALUES (?, ?, ?, ?, 1, 1, 1, ?, ?, 1)",
        (def_id, user_id, name, plan, ts, ts))
    conn.execute(
        "INSERT INTO j2_widget_definition_revs (user_id, definition_id, rev, plan_json, summary,"
        " saved_at) VALUES (?, ?, 1, ?, '', ?)", (user_id, def_id, plan, ts))
    conn.commit()
    return def_id


def _rows(conn, note_id):
    return [dict(r) for r in conn.execute(
        "SELECT user_id, kind, tool_id, rev FROM j2_tool_uses WHERE note_id = ? ORDER BY tool_id",
        (note_id,)).fetchall()]


def _used_in(conn, user_id, def_id):
    from api.services.journal_two import widget_definitions as wd
    return wd.get(user_id, def_id, conn=conn)["usedIn"]


# -- the projection ---------------------------------------------------------------------

def test_note_save_records_built_widget_use(conn):
    from api.services.journal_two import widget_definitions as wd
    d = _def(conn)
    n = _note(conn, _built(d, 3), title="Monday review")
    assert _rows(conn, n["id"]) == [{"user_id": A, "kind": "widget", "tool_id": d, "rev": 3}]
    assert _used_in(conn, A, d) == 1
    used = wd.used_in_notes(A, d, conn=conn)
    assert [(u["noteId"], u["title"]) for u in used] == [(n["id"], "Monday review")]
    assert used[0]["updatedAt"]


def test_a_non_built_embed_or_a_non_string_def_id_adds_nothing(conn):
    other = {"type": "widgetEmbed", "attrs": {"widgetId": "chart", "params": {"defId": "x"}}}
    bad = _built(12345)
    missing = {"type": "widgetEmbed", "attrs": {"widgetId": "builtWidget", "params": {}}}
    n = _note(conn, other, bad, missing)
    assert _rows(conn, n["id"]) == []


def test_a_nested_built_widget_is_found(conn):
    d = _def(conn)
    n = _note(conn, {"type": "blockquote", "content": [_built(d)]})
    assert [r["tool_id"] for r in _rows(conn, n["id"])] == [d]


def test_a_stored_body_with_non_list_content_still_syncs(conn):
    # _refuse_unbuildable keeps this off every write door; a body stored before it
    # existed must not 500 the sidecar walk, and its siblings are still projected.
    from api.services.journal_two import notes as svc
    d = _def(conn)
    n = _note(conn)
    body = {"type": "doc", "content": [{"type": "paragraph", "content": 5}, _built(d)]}
    svc._sync_note_sidecars(conn, A, n["id"], body, "")
    assert _rows(conn, n["id"]) == [{"user_id": A, "kind": "widget", "tool_id": d, "rev": 1}]


def test_the_projection_names_the_same_kind_the_widget_service_declares():
    from api.services.journal_two import notebook_widgets, notes
    assert notes._BUILT_WIDGET_ID == notebook_widgets.BUILT_KIND


def test_a_def_id_that_cannot_encode_is_skipped_and_the_note_still_saves(conn):
    d = _def(conn)
    n = _note(conn, _built("\ud800", 1, "e-bad"), _built(d, 1, "e-good"))
    assert [r["tool_id"] for r in _rows(conn, n["id"])] == [d]


def test_a_non_integer_def_rev_is_stored_as_null_and_the_note_still_saves(conn):
    d = _def(conn)
    n = _note(conn, _built(d, "7"))
    assert _rows(conn, n["id"]) == [{"user_id": A, "kind": "widget", "tool_id": d, "rev": None}]


def test_two_in_one_note_counts_one_note(conn):
    from api.services.journal_two import widget_definitions as wd
    d = _def(conn)
    n = _note(conn, _built(d, 1, "e-1"), _built(d, 2, "e-2"))
    _note(conn, _built(d, 1, "e-3"), title="Other")
    assert _used_in(conn, A, d) == 2
    assert len(wd.used_in_notes(A, d, conn=conn)) == 2
    assert len({r["tool_id"] for r in _rows(conn, n["id"])}) == 1


def test_removing_widget_clears_row(conn):
    from api.services.journal_two import notes as svc
    d = _def(conn)
    n = _note(conn, _built(d))
    assert _used_in(conn, A, d) == 1
    svc.update_note(A, n["id"], {"bodyJson": _doc({"type": "paragraph"})}, conn=conn)
    assert _rows(conn, n["id"]) == []
    assert _used_in(conn, A, d) == 0


def test_trashed_note_not_counted(conn):
    from api.services.journal_two import notes as svc
    from api.services.journal_two import widget_definitions as wd
    d = _def(conn)
    n = _note(conn, _built(d))
    svc.delete_note(A, n["id"], conn=conn)
    assert len(_rows(conn, n["id"])) == 1, "trash leaves the projection row (like the check-ins)"
    assert _used_in(conn, A, d) == 0
    assert wd.used_in_notes(A, d, conn=conn) == []
    svc.restore_note(A, n["id"], conn=conn)
    assert _used_in(conn, A, d) == 1


def test_a_sample_note_is_not_counted(conn):
    from api.services.journal_two import sample_marker
    d = _def(conn)
    n = _note(conn, _built(d))
    conn.execute("UPDATE j2_notes SET import_source = ? WHERE id = ?",
                 (sample_marker.SAMPLE_SOURCE, n["id"]))
    conn.commit()
    assert _used_in(conn, A, d) == 0


def test_hard_delete_sweep_removes_rows(conn):
    from api.services.journal_two import notes as svc
    d = _def(conn)
    gone = _note(conn, _built(d, 1, "e-gone"), title="Expired")
    kept = _note(conn, _built(d, 1, "e-kept"), title="Live")
    svc.delete_note(A, gone["id"], conn=conn)
    future = datetime.now(timezone.utc) + timedelta(days=svc.TRASH_RETENTION_DAYS + 1)
    assert svc.purge_expired_deleted_notes(now=future, conn=conn) == 1
    assert _rows(conn, gone["id"]) == []
    assert len(_rows(conn, kept["id"])) == 1


def test_foreign_def_id_in_my_note_not_counted_for_owner(conn):
    from api.services.journal_two import widget_definitions as wd
    theirs = _def(conn, user_id=B)
    n = _note(conn, _built(theirs), user_id=A)
    assert _rows(conn, n["id"]) == [{"user_id": A, "kind": "widget", "tool_id": theirs, "rev": 1}]
    assert _used_in(conn, B, theirs) == 0
    assert wd.used_in_notes(B, theirs, conn=conn) == []
    # Control: B's own note with that widget does count for B.
    _note(conn, _built(theirs), user_id=B)
    assert _used_in(conn, B, theirs) == 1


def test_list_defs_carries_the_same_count(conn):
    from api.services.journal_two import widget_definitions as wd
    d1, d2 = _def(conn, name="One"), _def(conn, name="Two")
    _note(conn, _built(d1, 1, "a"), _built(d2, 1, "b"))
    _note(conn, _built(d1, 1, "c"))
    counts = {w["id"]: w["usedIn"] for w in wd.list_defs(A, conn=conn)}
    assert counts == {d1: 2, d2: 1}


def test_used_in_notes_of_a_foreign_or_unknown_id_is_empty(conn):
    from api.services.journal_two import widget_definitions as wd
    assert wd.used_in_notes(A, "no-such-id", conn=conn) == []
    assert wd.used_in_notes(A, None, conn=conn) == []


# -- the purge rail ---------------------------------------------------------------------

def test_the_account_purge_removes_j2_tool_uses_for_the_member_only(conn):
    """Named here, independent of `_DIRECT_USER_TABLES`: the generic manifest rail seeds and
    checks off that same tuple, so a table missing from it would be invisible to it too."""
    from api.services.journal_two import account_purge as ap
    assert "j2_tool_uses" in ap._DIRECT_USER_TABLES
    d = _def(conn)
    _note(conn, _built(d), user_id=A)
    theirs = _note(conn, _built(d), user_id=B)
    conn.commit()
    report = ap.purge_user_data(A, conn)
    assert report["errors"] == [], report["errors"]
    assert report["rows_deleted"].get("j2_tool_uses") == 1
    assert conn.execute("SELECT COUNT(*) FROM j2_tool_uses WHERE user_id = ?", (A,)).fetchone()[0] == 0
    assert len(_rows(conn, theirs["id"])) == 1


def test_the_indexes_exist(conn):
    idx = {r["name"]: r["sql"] for r in conn.execute(
        "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'j2_tool_uses'")}
    sqls = " ".join(s for s in idx.values() if s).replace(" ", "")
    assert "(user_id,kind,tool_id)" in sqls
    assert "(note_id)" in sqls


def test_my_note_naming_a_foreign_id_lists_nothing_for_me_either(conn):
    """A defId that is not the member's widget is treated as absent, even when the member's
    own note names it."""
    from api.services.journal_two import widget_definitions as wd
    theirs = _def(conn, user_id=B)
    _note(conn, _built(theirs), user_id=A)
    assert wd.used_in_notes(A, theirs, conn=conn) == []


# -- Task 9.10: routines and trackers -----------------------------------------------------

def _tool(widget_id, key, tool_id, embed_id="e-1", **more):
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": widget_id, "embedId": embed_id, "mode": "snapshot",
        "params": {key: tool_id, "day": "2026-11-04", **more}, "searchText": "[" + widget_id + "]"}}


def _routine_node(rid, embed_id="e-1"):
    return _tool("routine", "routineId", rid, embed_id)


def _tracker_node(tid, embed_id="e-1"):
    return _tool("tracker", "trackerId", tid, embed_id)


def _routine(conn, user_id=A, name="Morning"):
    from api.services.journal_two import routines as rs
    return rs.create(user_id, name=name, items=[{"text": "Read the wire"}],
                     schedule={"kind": "every"}, conn=conn)["id"]


def _tracker(conn, user_id=A, name="Sleep"):
    from api.services.journal_two import trackers as ts
    return ts.create(user_id, name=name, kind="number", conn=conn)["id"]


def _stores():
    from api.services.journal_two import routines as rs, trackers as ts
    return [("routine", rs, _routine, _routine_node, rs.get),
            ("tracker", ts, _tracker, _tracker_node, ts.get)]


def test_routine_and_tracker_blocks_recorded_on_save(conn):
    rid, tid = _routine(conn), _tracker(conn)
    n = _note(conn, _routine_node(rid, "e-1"), _tracker_node(tid, "e-2"), title="Monday")
    assert sorted((r["kind"], r["tool_id"], r["rev"]) for r in _rows(conn, n["id"])) == sorted(
        [("routine", rid, None), ("tracker", tid, None)])
    for kind, store, _mk, _node, get in _stores():
        tool = rid if kind == "routine" else tid
        used = store.used_in_notes(A, tool, conn=conn)
        assert [(u["noteId"], u["title"]) for u in used] == [(n["id"], "Monday")]
        assert used[0]["updatedAt"]
        assert get(A, tool, conn=conn)["usedIn"] == 1


def test_a_routine_or_tracker_embed_naming_nothing_adds_nothing(conn):
    bad = [
        {"type": "widgetEmbed", "attrs": {"widgetId": "routine", "params": {}}},
        _routine_node(12345),
        _routine_node(""),
        _tracker_node(chr(0xD800)),
        # the other kind's key on this kind's widget is not a use
        _tool("routine", "trackerId", "x"), _tool("tracker", "routineId", "x"),
    ]
    n = _note(conn, *bad)
    assert _rows(conn, n["id"]) == []


def test_two_blocks_in_one_note_count_one_note(conn):
    for kind, store, mk, node, get in _stores():
        tool = mk(conn)
        n = _note(conn, node(tool, "e-1"), node(tool, "e-2"), title=kind + " twice")
        _note(conn, node(tool, "e-3"), title=kind + " once")
        assert get(A, tool, conn=conn)["usedIn"] == 2
        assert len(store.used_in_notes(A, tool, conn=conn)) == 2
        assert len({r["tool_id"] for r in _rows(conn, n["id"])}) == 1


def test_removing_block_clears_row(conn):
    from api.services.journal_two import notes as svc
    for kind, store, mk, node, get in _stores():
        tool = mk(conn)
        n = _note(conn, node(tool))
        assert get(A, tool, conn=conn)["usedIn"] == 1
        svc.update_note(A, n["id"], {"bodyJson": _doc({"type": "paragraph"})}, conn=conn)
        assert _rows(conn, n["id"]) == []
        assert get(A, tool, conn=conn)["usedIn"] == 0
        assert store.used_in_notes(A, tool, conn=conn) == []


def test_trashed_note_not_counted_for_routine_or_tracker(conn):
    from api.services.journal_two import notes as svc
    for kind, store, mk, node, get in _stores():
        tool = mk(conn)
        n = _note(conn, node(tool))
        svc.delete_note(A, n["id"], conn=conn)
        assert get(A, tool, conn=conn)["usedIn"] == 0
        assert store.used_in_notes(A, tool, conn=conn) == []
        svc.restore_note(A, n["id"], conn=conn)
        assert get(A, tool, conn=conn)["usedIn"] == 1


def test_a_sample_note_is_not_counted_for_a_routine_or_tracker(conn):
    from api.services.journal_two import sample_marker
    for kind, store, mk, node, get in _stores():
        tool = mk(conn)
        n = _note(conn, node(tool))
        conn.execute("UPDATE j2_notes SET import_source = ? WHERE id = ?",
                     (sample_marker.SAMPLE_SOURCE, n["id"]))
        conn.commit()
        assert get(A, tool, conn=conn)["usedIn"] == 0
        assert store.used_in_notes(A, tool, conn=conn) == []


def test_foreign_routine_id_in_my_note_not_counted_for_owner(conn):
    for kind, store, mk, node, get in _stores():
        theirs = mk(conn, user_id=B)
        mine = _note(conn, node(theirs), user_id=A, title="Mine")
        assert [r["tool_id"] for r in _rows(conn, mine["id"])] == [theirs]
        assert get(B, theirs, conn=conn)["usedIn"] == 0
        assert store.used_in_notes(B, theirs, conn=conn) == []
        # I cannot list another member's tool through my own id either
        assert store.used_in_notes(A, theirs, conn=conn) == []
        # Control: B's own note with that tool does count for B, and only B sees it.
        _note(conn, node(theirs), user_id=B, title="Theirs")
        assert get(B, theirs, conn=conn)["usedIn"] == 1
        assert [u["title"] for u in store.used_in_notes(B, theirs, conn=conn)] == ["Theirs"]


def test_list_carries_the_same_count(conn):
    from api.services.journal_two import routines as rs, trackers as ts
    r1, r2 = _routine(conn, name="One"), _routine(conn, name="Two")
    _note(conn, _routine_node(r1, "a"), _routine_node(r2, "b"))
    _note(conn, _routine_node(r1, "c"))
    assert {x["id"]: x["usedIn"] for x in rs.list_routines(A, conn=conn)} == {r1: 2, r2: 1}
    t1 = _tracker(conn, name="One")
    _note(conn, _tracker_node(t1))
    own = {x["id"]: x["usedIn"] for x in ts.list_trackers(A, conn=conn)}
    assert own[t1] == 1
    assert all(v == 0 for k, v in own.items() if k != t1)


def test_used_in_notes_of_an_unknown_id_is_empty(conn):
    for kind, store, mk, node, get in _stores():
        assert store.used_in_notes(A, "no-such-id", conn=conn) == []
        assert store.used_in_notes(A, None, conn=conn) == []


def _registry_widget_ids():
    """The widget ids the registry declares, read by text: a top-level key written `  <id>:`
    (two-space indent) and followed by a manifest call."""
    import pathlib
    import re
    text = (pathlib.Path(__file__).resolve().parents[1] / "app" / "src" / "widgets" / "registry.js"
            ).read_text(encoding="utf-8")
    return set(re.findall(r"^  ([A-Za-z][A-Za-z0-9]*):\s*(?:blockManifest|snapshotManifest)\(", text, re.M))


def test_tool_ids_match_registry():
    from api.services.journal_two import notes
    assert (notes._ROUTINE_ID, notes._TRACKER_ID) == ("routine", "tracker")
    ids = _registry_widget_ids()
    # Control: the extractor sees registered ids, so an empty answer cannot read as a pass.
    assert notes._BUILT_WIDGET_ID in ids and "moodCheckIn" in ids
    if not {"routine", "tracker"} & ids:
        pytest.skip("the routine and tracker registry rows land in Tasks 9.13 and 9.14; "
                    "this pin activates the moment either row exists")
    assert {notes._ROUTINE_ID, notes._TRACKER_ID} <= ids
    assert set(notes._TOOL_PARAM_KEY) == {notes._ROUTINE_ID, notes._TRACKER_ID}


def test_a_use_row_pointing_at_another_members_note_is_not_listed(conn):
    """The join re-checks the note's owner: a row (mine, kind, my tool) whose note is B's counts
    for nothing, though no save can write one."""
    for kind, store, mk, node, get in _stores():
        tool = mk(conn)
        theirs = _note(conn, user_id=B, title="Not mine")
        conn.execute("INSERT INTO j2_tool_uses (user_id, note_id, kind, tool_id, rev)"
                     " VALUES (?, ?, ?, ?, NULL)", (A, theirs["id"], kind, tool))
        conn.commit()
        assert get(A, tool, conn=conn)["usedIn"] == 0
        assert store.used_in_notes(A, tool, conn=conn) == []
