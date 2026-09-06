"""Wave C (Version History / Trust / Export Completeness) — version storage,
coalescing, list/get, and restore. Same in-memory-schema fixture pattern as
test_wave_b_favorites_recents.py.
"""
import sqlite3
from datetime import datetime, timedelta, timezone

import pytest

from api.services.journal_two.db import ensure_schema
from api.services.journal_two.notes import (
    NoteConflictError,
    NoteValidationError,
    create_note,
    get_note,
    get_note_version,
    list_note_versions,
    restore_note_version,
    update_note,
)


def _conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    return c


def _doc(text):
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}


def _create(c, user_id, title, body_json, **extra):
    payload = {"title": title, "bodyJson": body_json, **extra}
    return create_note(user_id, payload, conn=c)


def _backdate_updated_at(c, note_id, iso):
    c.execute("UPDATE j2_notes SET updated_at = ? WHERE id = ?", (iso, note_id))
    c.commit()


def _backdate_version(c, version_id, iso):
    c.execute("UPDATE j2_note_versions SET created_at = ? WHERE id = ?", (iso, version_id))
    c.commit()


# ── Schema ───────────────────────────────────────────────────────────────────

def test_versions_table_indexes_and_trigger_exist():
    c = _conn()
    tables = {r["name"] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert "j2_note_versions" in tables
    idx = {r["name"] for r in c.execute("SELECT name FROM sqlite_master WHERE type='index'")}
    assert "idx_j2_note_versions_note" in idx
    assert "idx_j2_note_versions_user" in idx
    triggers = {r["name"] for r in c.execute("SELECT name FROM sqlite_master WHERE type='trigger'")}
    assert "j2_notes_versions_ad" in triggers


# ── Coalescing ───────────────────────────────────────────────────────────────

def test_first_content_edit_captures_the_original_state():
    c = _conn()
    note = _create(c, "u1", "Original", _doc("original body"))
    update_note("u1", note["id"], {"title": "Edited"}, conn=c)
    versions = list_note_versions("u1", note["id"], conn=c)
    assert len(versions) == 1
    assert versions[0]["title"] == "Original"


def test_a_pure_metadata_save_never_creates_a_version():
    c = _conn()
    note = _create(c, "u1", "T", _doc("body"))
    update_note("u1", note["id"], {"ticker": "NVDA"}, conn=c)
    update_note("u1", note["id"], {"tags": ["thesis"]}, conn=c)
    update_note("u1", note["id"], {"folderId": None}, conn=c)
    assert list_note_versions("u1", note["id"], conn=c) == []


def test_repeated_edits_inside_the_coalescing_window_produce_one_version():
    c = _conn()
    note = _create(c, "u1", "T0", _doc("v0"))
    # Simulate a burst of autosave-driven edits, all inside the default
    # 30-minute coalescing window.
    update_note("u1", note["id"], {"title": "T1"}, conn=c)
    update_note("u1", note["id"], {"title": "T2"}, conn=c)
    update_note("u1", note["id"], {"title": "T3"}, conn=c)
    versions = list_note_versions("u1", note["id"], conn=c)
    assert len(versions) == 1
    assert versions[0]["title"] == "T0"  # the ORIGINAL state, not an intermediate one


def test_an_edit_after_the_window_elapses_creates_a_second_version():
    c = _conn()
    note = _create(c, "u1", "T0", _doc("v0"))
    update_note("u1", note["id"], {"title": "T1"}, conn=c)  # captures T0
    versions = list_note_versions("u1", note["id"], conn=c)
    assert len(versions) == 1
    # Push ONLY the captured version back in time -- the note's own
    # updated_at stays "now" (when T1 actually became current), so the gap
    # between them exceeds the coalescing window.
    old_ts = (datetime.now(timezone.utc) - timedelta(minutes=45)).isoformat()
    _backdate_version(c, versions[0]["id"], old_ts)

    update_note("u1", note["id"], {"title": "T2"}, conn=c)
    versions = list_note_versions("u1", note["id"], conn=c)
    assert len(versions) == 2
    titles = {v["title"] for v in versions}
    assert titles == {"T0", "T1"}


def test_no_version_when_the_versioned_fields_did_not_actually_change_value():
    c = _conn()
    note = _create(c, "u1", "Same", _doc("same body"))
    # Same title/body value, just re-sent -- title/subtitle/bodyJson keys
    # present in the patch, but nothing about the versioned content differs.
    update_note("u1", note["id"], {"title": "Same", "bodyJson": _doc("same body")}, conn=c)
    assert list_note_versions("u1", note["id"], conn=c) == []


def test_version_created_at_is_when_the_old_content_became_current_not_now():
    c = _conn()
    note = _create(c, "u1", "T0", _doc("v0"))
    backdated = "2026-01-01T00:00:00+00:00"
    _backdate_updated_at(c, note["id"], backdated)
    update_note("u1", note["id"], {"title": "T1"}, conn=c)
    versions = list_note_versions("u1", note["id"], conn=c)
    assert versions[0]["createdAt"] == backdated


def test_env_override_of_the_coalescing_window(monkeypatch):
    # `J2_VERSION_COALESCE_MINUTES` is read once at module-import time into a
    # module-level constant -- monkeypatch the CONSTANT directly rather than
    # the env var + importlib.reload(). A reload mutates the shared module
    # namespace in place: every other test's already-imported NoteConflictError
    # (captured at test-file-import-time) would silently stop matching the
    # RELOADED module's own new NoteConflictError class object -- a real class-
    # identity break, found live (it broke a same-file, later, unrelated test's
    # `pytest.raises(NoteConflictError)` the first time this was written with
    # reload). Patching the constant avoids the whole class of risk.
    from api.services.journal_two import notes as notes_mod
    monkeypatch.setattr(notes_mod, "J2_VERSION_COALESCE_MINUTES", 0)
    c = _conn()
    note = _create(c, "u1", "T0", _doc("v0"))
    update_note("u1", note["id"], {"title": "T1"}, conn=c)
    update_note("u1", note["id"], {"title": "T2"}, conn=c)
    versions = list_note_versions("u1", note["id"], conn=c)
    assert len(versions) == 2


# ── list / get ───────────────────────────────────────────────────────────────

def test_list_versions_is_newest_first_and_omits_body():
    c = _conn()
    note = _create(c, "u1", "T0", _doc("v0"))
    old_ts = (datetime.now(timezone.utc) - timedelta(minutes=45)).isoformat()
    _backdate_updated_at(c, note["id"], old_ts)
    update_note("u1", note["id"], {"title": "T1"}, conn=c)
    v1 = list_note_versions("u1", note["id"], conn=c)[0]
    # v1's created_at is already old_ts (captured from the backdated create);
    # the note's own updated_at is real "now" after the update_note call
    # above, so the gap already exceeds the coalescing window -- no need to
    # (and must not) also backdate updated_at here, or elapsed collapses to 0.
    update_note("u1", note["id"], {"title": "T2"}, conn=c)

    versions = list_note_versions("u1", note["id"], conn=c)
    assert [v["title"] for v in versions] == ["T1", "T0"]
    assert "bodyJson" not in versions[0]
    assert "bodyPlain" not in versions[0]


def test_get_version_returns_full_content():
    c = _conn()
    note = _create(c, "u1", "Original", _doc("hello world"))
    update_note("u1", note["id"], {"title": "Edited"}, conn=c)
    version_id = list_note_versions("u1", note["id"], conn=c)[0]["id"]
    v = get_note_version("u1", note["id"], version_id, conn=c)
    assert v["title"] == "Original"
    assert v["bodyPlain"] == "hello world"
    assert v["bodyJson"]["type"] == "doc"


def test_get_version_tenant_isolated_wrong_user():
    c = _conn()
    note = _create(c, "u1", "Original", _doc("secret"))
    update_note("u1", note["id"], {"title": "Edited"}, conn=c)
    version_id = list_note_versions("u1", note["id"], conn=c)[0]["id"]
    assert get_note_version("u2", note["id"], version_id, conn=c) is None


def test_get_version_tenant_isolated_wrong_note():
    c = _conn()
    note1 = _create(c, "u1", "N1", _doc("n1 body"))
    note2 = _create(c, "u1", "N2", _doc("n2 body"))
    update_note("u1", note1["id"], {"title": "N1 edited"}, conn=c)
    version_id = list_note_versions("u1", note1["id"], conn=c)[0]["id"]
    # Own user, own version, but asked against the WRONG note id.
    assert get_note_version("u1", note2["id"], version_id, conn=c) is None


def test_get_version_nonexistent_id_returns_none():
    c = _conn()
    note = _create(c, "u1", "T", _doc("b"))
    assert get_note_version("u1", note["id"], "nonexistent", conn=c) is None


def test_list_versions_empty_for_a_note_never_edited():
    c = _conn()
    note = _create(c, "u1", "T", _doc("b"))
    assert list_note_versions("u1", note["id"], conn=c) == []


# ── Restore ──────────────────────────────────────────────────────────────────

def test_restore_applies_the_old_content_as_the_new_current_state():
    c = _conn()
    note = _create(c, "u1", "Original", _doc("original body"))
    update_note("u1", note["id"], {"title": "Edited", "bodyJson": _doc("edited body")}, conn=c)
    version_id = list_note_versions("u1", note["id"], conn=c)[0]["id"]

    restored = restore_note_version("u1", note["id"], version_id, conn=c)
    assert restored["title"] == "Original"
    assert restored["bodyPlain"].strip() == "original body"


def test_restore_never_touches_folder_ticker_or_tags():
    c = _conn()
    note = _create(c, "u1", "Original", _doc("v0"), ticker="NVDA", tags=["thesis"])
    update_note("u1", note["id"], {"title": "Edited"}, conn=c)
    version_id = list_note_versions("u1", note["id"], conn=c)[0]["id"]
    # Change organizational metadata AFTER the version was captured.
    update_note("u1", note["id"], {"ticker": "AAPL", "tags": ["different"]}, conn=c)

    restored = restore_note_version("u1", note["id"], version_id, conn=c)
    assert restored["ticker"] == "AAPL"  # untouched by restore
    assert restored["tags"] == ["different"]  # untouched by restore


def test_restore_captures_the_pre_restore_state_so_it_stays_recoverable():
    """Directive §20: restore must not erase history. Restoring to an old
    version must itself be undoable by restoring forward again."""
    c = _conn()
    note = _create(c, "u1", "A", _doc("content A"))
    old_ts = (datetime.now(timezone.utc) - timedelta(minutes=45)).isoformat()
    _backdate_updated_at(c, note["id"], old_ts)
    update_note("u1", note["id"], {"title": "B", "bodyJson": _doc("content B")}, conn=c)
    version_a_id = list_note_versions("u1", note["id"], conn=c)[0]["id"]
    v = list_note_versions("u1", note["id"], conn=c)[0]
    _backdate_version(c, v["id"], old_ts)
    # Note's own updated_at stays real "now" (set by the B update above) --
    # see the equivalent comment in test_list_versions_is_newest_first...
    update_note("u1", note["id"], {"title": "C", "bodyJson": _doc("content C")}, conn=c)

    # Current content is now "C"; history holds [A, B] (C is still only the
    # current state, not yet superseded -- it becomes a version the moment
    # something replaces it, which is exactly what the restore below does).
    # Restore to A.
    restore_note_version("u1", note["id"], version_a_id, conn=c)
    current = get_note("u1", note["id"], conn=c)
    assert current["title"] == "A"

    # "C" (the pre-restore state) must now be in history, alongside B and A.
    versions_after = list_note_versions("u1", note["id"], conn=c)
    titles = {vv["title"] for vv in versions_after}
    assert "C" in titles
    assert "B" in titles


def test_restore_captures_pre_restore_state_even_inside_the_coalescing_window():
    """The exact fix this file's earlier failure surfaced: a restore
    performed shortly after the previous edit (well inside the 30-minute
    coalescing window, no backdating at all here) must STILL checkpoint the
    pre-restore content -- restore is a deliberate action, never coalesced
    away like an incidental autosave tick."""
    c = _conn()
    note = _create(c, "u1", "A", _doc("content A"))
    update_note("u1", note["id"], {"title": "B", "bodyJson": _doc("content B")}, conn=c)
    version_a_id = list_note_versions("u1", note["id"], conn=c)[0]["id"]

    # Restore immediately -- no time has passed, still well inside the window.
    restore_note_version("u1", note["id"], version_a_id, conn=c)
    assert get_note("u1", note["id"], conn=c)["title"] == "A"

    versions_after = list_note_versions("u1", note["id"], conn=c)
    assert "B" in {vv["title"] for vv in versions_after}


def test_restoring_forward_again_after_a_bad_restore_works():
    """Prove reversibility end-to-end (directive §93): A -> restore to
    (something) -> restore forward again -> current content matches."""
    c = _conn()
    note = _create(c, "u1", "Version1", _doc("v1"))
    old_ts = (datetime.now(timezone.utc) - timedelta(minutes=45)).isoformat()
    _backdate_updated_at(c, note["id"], old_ts)
    update_note("u1", note["id"], {"title": "Version2", "bodyJson": _doc("v2")}, conn=c)
    v1_id = list_note_versions("u1", note["id"], conn=c)[0]["id"]

    # Restore to Version1 (a "mistake").
    restore_note_version("u1", note["id"], v1_id, conn=c)
    assert get_note("u1", note["id"], conn=c)["title"] == "Version1"

    # The pre-restore state (Version2) is now in history -- find and restore it.
    versions = list_note_versions("u1", note["id"], conn=c)
    v2_entry = next(vv for vv in versions if vv["title"] == "Version2")
    restore_note_version("u1", note["id"], v2_entry["id"], conn=c)
    assert get_note("u1", note["id"], conn=c)["title"] == "Version2"


def test_restore_respects_the_optimistic_lock_and_raises_on_stale_baseline():
    c = _conn()
    note = _create(c, "u1", "Original", _doc("v0"))
    update_note("u1", note["id"], {"title": "Edited"}, conn=c)
    version_id = list_note_versions("u1", note["id"], conn=c)[0]["id"]
    current = get_note("u1", note["id"], conn=c)

    # A second "tab" edits the note first, moving updated_at.
    update_note("u1", note["id"], {"title": "Edited elsewhere"}, conn=c)

    # The stale restore attempt still carries the OLD baseline.
    with pytest.raises(NoteConflictError):
        restore_note_version("u1", note["id"], version_id,
                              expected_updated_at=current["updatedAt"], conn=c)
    # Content must be unaffected by the failed restore.
    assert get_note("u1", note["id"], conn=c)["title"] == "Edited elsewhere"


def test_restore_of_a_nonexistent_version_returns_none_and_changes_nothing():
    c = _conn()
    note = _create(c, "u1", "Original", _doc("v0"))
    result = restore_note_version("u1", note["id"], "nonexistent", conn=c)
    assert result is None
    assert get_note("u1", note["id"], conn=c)["title"] == "Original"


def test_restore_is_tenant_isolated():
    c = _conn()
    note = _create(c, "u1", "Original", _doc("v0"))
    update_note("u1", note["id"], {"title": "Edited"}, conn=c)
    version_id = list_note_versions("u1", note["id"], conn=c)[0]["id"]
    result = restore_note_version("u2", note["id"], version_id, conn=c)
    assert result is None
    assert get_note("u1", note["id"], conn=c)["title"] == "Edited"


def test_restore_content_flows_through_the_normal_embed_resync():
    """Restore reuses update_note verbatim, so embeds/mentions re-derive from
    the restored body exactly like any other save -- no bespoke relationship
    restoration logic needed (directive §7/§15 boundary)."""
    c = _conn()
    note = _create(c, "u1", "T", _doc("mentions $NVDA here"))
    update_note("u1", note["id"], {"bodyJson": _doc("no mention now")}, conn=c)
    mentions_after_edit = c.execute(
        "SELECT symbol FROM j2_note_mentions WHERE note_id = ?", (note["id"],)
    ).fetchall()
    assert [m["symbol"] for m in mentions_after_edit] == []

    version_id = list_note_versions("u1", note["id"], conn=c)[0]["id"]
    restore_note_version("u1", note["id"], version_id, conn=c)
    mentions_after_restore = c.execute(
        "SELECT symbol FROM j2_note_mentions WHERE note_id = ?", (note["id"],)
    ).fetchall()
    assert "NVDA" in [m["symbol"] for m in mentions_after_restore]


# ── Cascade / lifecycle ──────────────────────────────────────────────────────

def test_hard_deleting_a_note_cascades_its_versions_via_trigger():
    c = _conn()
    note = _create(c, "u1", "Original", _doc("v0"))
    update_note("u1", note["id"], {"title": "Edited"}, conn=c)
    assert len(list_note_versions("u1", note["id"], conn=c)) == 1

    c.execute("DELETE FROM j2_notes WHERE id = ?", (note["id"],))
    c.commit()
    remaining = c.execute(
        "SELECT COUNT(*) c FROM j2_note_versions WHERE note_id = ?", (note["id"],)
    ).fetchone()["c"]
    assert remaining == 0


def test_trashing_a_note_does_not_delete_its_versions():
    """Trash preserves history; only a hard purge removes it (directive §40)."""
    c = _conn()
    note = _create(c, "u1", "Original", _doc("v0"))
    update_note("u1", note["id"], {"title": "Edited"}, conn=c)
    c.execute("UPDATE j2_notes SET deleted_at = ? WHERE id = ?",
              ("2026-02-01T00:00:00+00:00", note["id"]))
    c.commit()
    # The row-level trigger only fires on a real DELETE, not a soft-delete
    # UPDATE -- versions must still be there.
    remaining = c.execute(
        "SELECT COUNT(*) c FROM j2_note_versions WHERE note_id = ?", (note["id"],)
    ).fetchone()["c"]
    assert remaining == 1


def test_history_stays_viewable_while_a_note_sits_in_trash():
    """Read-only history access is harmless -- a member browsing Trash may
    reasonably want to see what a note said before deciding whether to
    restore it out of Trash. Directive §41's 'Trash preserves history' is
    about more than the rows surviving on disk (proven above) -- it also
    means the list/get READ paths keep working while the note is trashed."""
    c = _conn()
    note = _create(c, "u1", "Original", _doc("v0"))
    updated = update_note("u1", note["id"], {"title": "Edited"}, conn=c)
    version_id = list_note_versions("u1", note["id"], conn=c)[0]["id"]
    c.execute("UPDATE j2_notes SET deleted_at = ? WHERE id = ?",
              ("2026-02-01T00:00:00+00:00", note["id"]))
    c.commit()

    versions = list_note_versions("u1", note["id"], conn=c)
    assert len(versions) == 1
    version = get_note_version("u1", note["id"], version_id, conn=c)
    assert version is not None
    assert version["title"] == "Original"
    assert updated["title"] == "Edited"  # sanity: the trashed row really did carry the edit


def test_restore_is_blocked_while_the_note_is_trashed():
    """The write path is a different question from the read path above --
    silently rewriting a trashed note's content (without the member first
    taking it out of Trash) would leave it in a confusing state: still
    trashed, but with content that changed while nobody was looking.
    `restore_note_version` reuses `update_note`, which already excludes
    `deleted_at IS NOT NULL` rows -- this proves that exclusion actually
    reaches the restore path, not just an ordinary PUT."""
    c = _conn()
    note = _create(c, "u1", "Original", _doc("v0"))
    update_note("u1", note["id"], {"title": "Edited"}, conn=c)
    version_id = list_note_versions("u1", note["id"], conn=c)[0]["id"]
    c.execute("UPDATE j2_notes SET deleted_at = ? WHERE id = ?",
              ("2026-02-01T00:00:00+00:00", note["id"]))
    c.commit()

    assert restore_note_version("u1", note["id"], version_id, conn=c) is None
    # And the trashed row's own content is untouched by the attempt.
    still_trashed = c.execute(
        "SELECT title, deleted_at FROM j2_notes WHERE id = ?", (note["id"],)
    ).fetchone()
    assert still_trashed["title"] == "Edited"
    assert still_trashed["deleted_at"] is not None


def test_versions_are_tenant_scoped_in_list_even_with_a_shared_note_id_guess():
    c = _conn()
    note = _create(c, "u1", "Secret", _doc("v0"))
    update_note("u1", note["id"], {"title": "Edited"}, conn=c)
    assert list_note_versions("u2", note["id"], conn=c) == []
