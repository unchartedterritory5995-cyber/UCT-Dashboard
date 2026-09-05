"""Wave 0 unit tests: soft-delete/restore/purge lifecycle + the folder-count
and per-folder-notes reads that replace the old capped-page sidebar derivation.

Real lifecycle contract per the Wave 0 mandate: create -> edit -> delete ->
recover -> confirm exact content restored, plus the adversarial cases (double
delete, restore-twice, cross-user isolation, purge only touching truly-expired
rows)."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone

import pytest

from api.services.journal_two import notes as svc
from api.services.journal_two.db import ensure_schema


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    yield c
    c.close()


# ── delete / restore lifecycle ──────────────────────────────────────────────

def test_delete_then_restore_returns_exact_original_content(conn):
    n = svc.create_note("u1", {"title": "T", "bodyJson": {
        "type": "doc", "content": [{"type": "paragraph", "content": [
            {"type": "text", "text": "hello"}]}]}}, conn=conn)

    assert svc.delete_note("u1", n["id"], conn=conn) is True
    # Invisible to the default (active) view and to plain get_note.
    assert svc.get_note("u1", n["id"], conn=conn) is None
    assert [x["id"] for x in svc.list_notes("u1", conn=conn)] == []

    restored = svc.restore_note("u1", n["id"], conn=conn)
    assert restored is not None
    assert restored["title"] == "T"
    assert restored["bodyJson"] == n["bodyJson"]
    # Visible again through the normal (active) view.
    assert svc.get_note("u1", n["id"], conn=conn) is not None
    assert restored["deletedAt"] is None


def test_double_delete_is_a_no_op_not_an_error(conn):
    n = svc.create_note("u1", {"title": "T"}, conn=conn)
    assert svc.delete_note("u1", n["id"], conn=conn) is True
    # Second delete of an already-trashed note: nothing left to soft-delete.
    assert svc.delete_note("u1", n["id"], conn=conn) is False


def test_restore_twice_is_a_no_op_not_an_error(conn):
    n = svc.create_note("u1", {"title": "T"}, conn=conn)
    svc.delete_note("u1", n["id"], conn=conn)
    assert svc.restore_note("u1", n["id"], conn=conn) is not None
    # Second restore: nothing left to un-delete.
    assert svc.restore_note("u1", n["id"], conn=conn) is None


def test_restore_of_a_never_deleted_note_returns_none(conn):
    n = svc.create_note("u1", {"title": "T"}, conn=conn)
    assert svc.restore_note("u1", n["id"], conn=conn) is None


def test_delete_and_restore_cannot_cross_users(conn):
    mine = svc.create_note("u1", {"title": "Mine"}, conn=conn)
    theirs = svc.create_note("u2", {"title": "Theirs"}, conn=conn)
    assert svc.delete_note("u1", theirs["id"], conn=conn) is False
    assert svc.get_note("u2", theirs["id"], conn=conn) is not None  # untouched

    svc.delete_note("u2", theirs["id"], conn=conn)
    assert svc.restore_note("u1", theirs["id"], conn=conn) is None
    assert svc.get_note("u2", theirs["id"], include_deleted=True, conn=conn) is not None


def test_editing_a_trashed_note_404s_until_restored(conn):
    n = svc.create_note("u1", {"title": "T"}, conn=conn)
    svc.delete_note("u1", n["id"], conn=conn)
    assert svc.update_note("u1", n["id"], {"title": "Renamed"}, conn=conn) is None
    assert svc.append_widget_embed("u1", n["id"], {
        "v": 1, "widgetId": "chart", "params": {"symbol": "AMD"},
        "capturedAt": "2026-01-01T00:00:00Z", "mode": "snapshot",
    }, conn=conn) is None

    svc.restore_note("u1", n["id"], conn=conn)
    updated = svc.update_note("u1", n["id"], {"title": "Renamed"}, conn=conn)
    assert updated is not None and updated["title"] == "Renamed"


def test_get_note_include_deleted_reveals_a_trashed_note(conn):
    n = svc.create_note("u1", {"title": "T"}, conn=conn)
    svc.delete_note("u1", n["id"], conn=conn)
    assert svc.get_note("u1", n["id"], conn=conn) is None
    got = svc.get_note("u1", n["id"], include_deleted=True, conn=conn)
    assert got is not None and got["id"] == n["id"] and got["deletedAt"] is not None


# ── the trash (deleted=True) view mirrors the active view ──────────────────

def test_deleted_view_lists_only_trashed_notes_and_active_view_excludes_them(conn):
    a = svc.create_note("u1", {"title": "Active"}, conn=conn)
    b = svc.create_note("u1", {"title": "Trashed"}, conn=conn)
    svc.delete_note("u1", b["id"], conn=conn)

    active = svc.list_notes("u1", conn=conn)
    trashed = svc.list_notes("u1", deleted=True, conn=conn)
    assert [x["id"] for x in active] == [a["id"]]
    assert [x["id"] for x in trashed] == [b["id"]]

    assert svc.count_notes("u1", conn=conn) == 1
    assert svc.count_notes("u1", deleted=True, conn=conn) == 1


# ── embeds survive a soft delete, only the purge sweep clears them ─────────

def test_purge_only_removes_notes_past_retention_not_recently_trashed_ones(conn):
    old = svc.create_note("u1", {"title": "Old"}, conn=conn)
    recent = svc.create_note("u1", {"title": "Recent"}, conn=conn)
    svc.delete_note("u1", old["id"], conn=conn)
    svc.delete_note("u1", recent["id"], conn=conn)

    # Backdate `old`'s deleted_at so it's already past the retention window;
    # leave `recent`'s deleted_at at "now" (well inside the window).
    cutoff_past = (datetime.now(timezone.utc) - timedelta(days=svc.TRASH_RETENTION_DAYS + 5)).isoformat()
    conn.execute("UPDATE j2_notes SET deleted_at = ? WHERE id = ?", (cutoff_past, old["id"]))
    conn.commit()

    purged = svc.purge_expired_deleted_notes(conn=conn)
    assert purged == 1
    # The expired one is gone for good — restore can't bring it back.
    assert svc.restore_note("u1", old["id"], conn=conn) is None
    row = conn.execute("SELECT 1 FROM j2_notes WHERE id = ?", (old["id"],)).fetchone()
    assert row is None
    # The recently-trashed one is untouched and still restorable.
    assert svc.restore_note("u1", recent["id"], conn=conn) is not None


def test_purge_is_cross_user_a_system_sweep_not_scoped_to_one_account(conn):
    a = svc.create_note("u1", {"title": "A"}, conn=conn)
    b = svc.create_note("u2", {"title": "B"}, conn=conn)
    svc.delete_note("u1", a["id"], conn=conn)
    svc.delete_note("u2", b["id"], conn=conn)
    future = datetime.now(timezone.utc) + timedelta(days=svc.TRASH_RETENTION_DAYS + 1)
    purged = svc.purge_expired_deleted_notes(now=future, conn=conn)
    assert purged == 2


# ── folder_note_counts: the P0-2 fix's core mechanism ───────────────────────

def test_folder_note_counts_reflects_the_whole_library_not_a_capped_page(conn):
    f1 = svc.create_folder("u1", "Setups", conn=conn)
    f2 = svc.create_folder("u1", "Earnings", conn=conn)
    for i in range(150):
        svc.create_note("u1", {"title": f"n{i}", "folderId": f1["id"]}, conn=conn)
    svc.create_note("u1", {"title": "e1", "folderId": f2["id"]}, conn=conn)
    svc.create_note("u1", {"title": "unfiled"}, conn=conn)

    out = svc.folder_note_counts("u1", conn=conn)
    assert out["counts"][f1["id"]] == 150   # far past any old 100-row page cap
    assert out["counts"][f2["id"]] == 1
    assert out["unfiled"] == 1
    assert out["total"] == 152


def test_folder_note_counts_excludes_trashed_notes(conn):
    f1 = svc.create_folder("u1", "Setups", conn=conn)
    n1 = svc.create_note("u1", {"title": "keep", "folderId": f1["id"]}, conn=conn)
    n2 = svc.create_note("u1", {"title": "trash me", "folderId": f1["id"]}, conn=conn)
    svc.delete_note("u1", n2["id"], conn=conn)

    out = svc.folder_note_counts("u1", conn=conn)
    assert out["counts"][f1["id"]] == 1
    assert out["total"] == 1


def test_folder_note_counts_is_scoped_per_user(conn):
    f1 = svc.create_folder("u1", "Mine", conn=conn)
    f2 = svc.create_folder("u2", "Theirs", conn=conn)
    svc.create_note("u1", {"title": "a", "folderId": f1["id"]}, conn=conn)
    svc.create_note("u2", {"title": "b", "folderId": f2["id"]}, conn=conn)
    svc.create_note("u2", {"title": "c", "folderId": f2["id"]}, conn=conn)

    out1 = svc.folder_note_counts("u1", conn=conn)
    out2 = svc.folder_note_counts("u2", conn=conn)
    assert out1["counts"] == {f1["id"]: 1} and out1["total"] == 1
    assert out2["counts"] == {f2["id"]: 2} and out2["total"] == 2


# ── notes_for_folders: the inline leaf-row source ───────────────────────────

def test_notes_for_folders_returns_full_folder_contents_past_the_old_100_cap(conn):
    f1 = svc.create_folder("u1", "Big", conn=conn)
    for i in range(150):
        svc.create_note("u1", {"title": f"n{i:03d}", "folderId": f1["id"]}, conn=conn)

    out = svc.notes_for_folders("u1", [f1["id"]], conn=conn)
    assert len(out[f1["id"]]) == 150  # honestly complete, well past the old 100-row cap


def test_notes_for_folders_honors_limit_per_folder(conn):
    f1 = svc.create_folder("u1", "Big", conn=conn)
    for i in range(30):
        svc.create_note("u1", {"title": f"n{i:03d}", "folderId": f1["id"]}, conn=conn)
    out = svc.notes_for_folders("u1", [f1["id"]], limit_per_folder=10, conn=conn)
    assert len(out[f1["id"]]) == 10


def test_notes_for_folders_excludes_trashed_notes(conn):
    f1 = svc.create_folder("u1", "F", conn=conn)
    keep = svc.create_note("u1", {"title": "keep", "folderId": f1["id"]}, conn=conn)
    gone = svc.create_note("u1", {"title": "gone", "folderId": f1["id"]}, conn=conn)
    svc.delete_note("u1", gone["id"], conn=conn)
    out = svc.notes_for_folders("u1", [f1["id"]], conn=conn)
    assert [n["id"] for n in out[f1["id"]]] == [keep["id"]]


def test_notes_for_folders_scopes_to_only_the_requested_folders(conn):
    f1 = svc.create_folder("u1", "F1", conn=conn)
    f2 = svc.create_folder("u1", "F2", conn=conn)
    svc.create_note("u1", {"title": "in f1", "folderId": f1["id"]}, conn=conn)
    svc.create_note("u1", {"title": "in f2", "folderId": f2["id"]}, conn=conn)
    out = svc.notes_for_folders("u1", [f1["id"]], conn=conn)
    assert list(out.keys()) == [f1["id"]]  # f2 never asked for -> never returned


def test_notes_for_folders_with_no_ids_is_a_harmless_no_op(conn):
    assert svc.notes_for_folders("u1", [], conn=conn) == {}


def test_notes_for_folders_ignores_a_bogus_or_blank_id_rather_than_erroring(conn):
    out = svc.notes_for_folders("u1", ["", "nope-does-not-exist"], conn=conn)
    assert out.get("nope-does-not-exist") == []
    assert "" not in out


# ── get_symbol_backlinks agrees with the embed_symbol list filter ──────────

def _note_with_amd_chart(conn, user="u1"):
    return svc.create_note(user, {"title": "Setup", "bodyJson": {
        "type": "doc", "content": [{"type": "widgetEmbed", "attrs": {
            "v": 1, "widgetId": "chart", "params": {"symbol": "AMD", "tf": "5"},
            "capturedAt": "2026-03-13T15:45:00Z", "mode": "snapshot",
            "searchText": "[chart: AMD 5m]"}}]}}, conn=conn)


def test_backlinks_stop_counting_a_trashed_note_matching_the_list_filter(conn):
    n = _note_with_amd_chart(conn)
    before = svc.get_symbol_backlinks("u1", "AMD", conn=conn)
    assert before["count"] == 1
    assert len(svc.list_notes("u1", embed_symbol="AMD", conn=conn)) == 1

    svc.delete_note("u1", n["id"], conn=conn)

    after = svc.get_symbol_backlinks("u1", "AMD", conn=conn)
    assert after["count"] == 0
    assert svc.list_notes("u1", embed_symbol="AMD", conn=conn) == []  # agrees with backlinks

    svc.restore_note("u1", n["id"], conn=conn)
    restored = svc.get_symbol_backlinks("u1", "AMD", conn=conn)
    assert restored["count"] == 1
    assert len(svc.list_notes("u1", embed_symbol="AMD", conn=conn)) == 1  # still agrees


# ── tag_counts excludes a trashed note's tags ───────────────────────────────

def test_tag_counts_excludes_a_trashed_notes_tags(conn):
    n = svc.create_note("u1", {"title": "T", "tags": ["earnings"]}, conn=conn)
    assert svc.tag_counts("u1", conn=conn) == [{"tag": "earnings", "count": 1}]
    svc.delete_note("u1", n["id"], conn=conn)
    assert svc.tag_counts("u1", conn=conn) == []
    svc.restore_note("u1", n["id"], conn=conn)
    assert svc.tag_counts("u1", conn=conn) == [{"tag": "earnings", "count": 1}]
