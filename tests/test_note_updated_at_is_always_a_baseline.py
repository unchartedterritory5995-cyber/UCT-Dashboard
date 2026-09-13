"""Wave Q1 — `updatedAt` IS THE COMPARE-AND-SET. IT MAY NEVER BE EMPTY.

⚰️ WHY THIS FILE EXISTS
The activation canary (2026-09-09) queued a note update carrying
`baseUpdatedAt: null` — a PUT with no compare-and-set at all. The empty-CONTENT
half of that artifact is reproduced and fixed. This is the other half.

The client's baseline comes from exactly one place: the `updatedAt` on the note
the server handed it. `NoteEditorPage.nullbaseline.test.jsx` MEASURED what the
editor does when that field is falsy — **it queues `baseUpdatedAt: null`**, on
both an empty string and a missing key. So the client has no defence, and the
server's guarantee is load-bearing.

⛔ `updated_at TEXT NOT NULL` DOES NOT GIVE THAT GUARANTEE. `NOT NULL` permits
the empty string, and an empty string is falsy in JavaScript. The guarantee has
to come from every WRITER always putting a real timestamp there — which is a
claim about code, and therefore a claim that needs a test.

⛔ It is not enough to check `create` and `update`. The editor loads whatever
`GET /notes/{id}` returns, and that row can have been last written by an import,
a restore-from-trash, a version restore, a body-appending writer, or a folder
move. Each of those is a separate `UPDATE ... SET updated_at = ?`.
"""
from __future__ import annotations

import uuid

import pytest

from api.services import auth_db
from api.services.journal_two import notes as notes_svc

USER = "u-q1-baseline"


def _doc(text: str = "body"):
    return {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": text}]}]}


def _new(**payload):
    auth_db.init_db()
    base = {"title": "NVDA thesis", "bodyJson": _doc()}
    base.update(payload)
    return notes_svc.create_note(USER, base)


def _assert_usable_baseline(note, where: str):
    """The exact predicate the client applies — `if (base)` — not a NOT NULL check."""
    assert note is not None, f"{where}: no note returned"
    got = note.get("updatedAt")
    assert got is not None, f"{where}: updatedAt is None — the client queues a null baseline"
    assert isinstance(got, str), f"{where}: updatedAt is {type(got).__name__}, not a string"
    assert got.strip() != "", f"{where}: updatedAt is empty — falsy in JS, so the PUT loses its CAS"


class TestTheGuaranteeItself:
    def test_a_freshly_created_note_carries_a_baseline(self):
        _assert_usable_baseline(_new(), "create_note")

    def test_a_note_created_with_NO_body_still_carries_a_baseline(self):
        # The canary's note: created, typed into, reloaded before the PUT landed,
        # so the server's copy was still empty.
        _assert_usable_baseline(_new(title="", bodyJson=None), "create_note (empty)")

    def test_reading_it_back_carries_a_baseline(self):
        n = _new()
        _assert_usable_baseline(notes_svc.get_note(USER, n["id"]), "get_note")

    def test_updating_it_carries_a_baseline(self):
        n = _new()
        _assert_usable_baseline(
            notes_svc.update_note(USER, n["id"], {"title": "changed"}), "update_note")

    def test_a_compare_and_set_update_carries_the_NEW_baseline(self):
        n = _new()
        out = notes_svc.update_note(
            USER, n["id"], {"title": "cas"}, expected_updated_at=n["updatedAt"])
        _assert_usable_baseline(out, "update_note (CAS)")
        assert out["updatedAt"] != n["updatedAt"], "a CAS write must move the baseline"


class TestEveryOtherWriterOfUpdatedAt:
    """⛔ Each of these is a separate `UPDATE ... SET updated_at = ?` in
    notes.py. A note the editor opens may have been last touched by ANY of
    them, so each has to leave a usable baseline behind."""

    def test_an_IMPORTED_note_carries_a_baseline_even_with_a_garbage_updatedAt(self):
        # `_import_date` takes `updatedAt` from an UNTRUSTED import payload
        # (Notion / Obsidian / Evernote exports) and falls back to `now` when it
        # will not parse. This pins that the fallback is a real timestamp and
        # never the empty string the caller supplied.
        for junk in ("", "   ", "not-a-date", None, 12345, "0000-00-00"):
            got = notes_svc._import_date(junk, "2026-09-09T00:00:00Z")
            assert isinstance(got, str) and got.strip(), (
                f"_import_date({junk!r}) returned {got!r} — an empty baseline")

    def test_import_date_PASSES_THROUGH_a_valid_timestamp(self):
        # The control: without this the test above would pass against an
        # implementation that ignored its input entirely.
        assert notes_svc._import_date("2026-05-01T12:00:00", "FALLBACK") == "2026-05-01T12:00:00"

    def test_a_restored_note_carries_a_baseline(self):
        n = _new()
        notes_svc.delete_note(USER, n["id"])
        notes_svc.restore_note(USER, n["id"])
        _assert_usable_baseline(notes_svc.get_note(USER, n["id"]), "restore_note")

    def test_a_note_moved_between_folders_carries_a_baseline(self):
        n = _new()
        notes_svc.update_note(USER, n["id"], {"folderId": None})
        _assert_usable_baseline(notes_svc.get_note(USER, n["id"]), "folder move")


class TestTheProbeCanFail:
    """⭐ A predicate nobody has watched reject is not a predicate."""

    @pytest.mark.parametrize("bad", [None, "", "   "])
    def test_the_assertion_rejects_a_baseline_less_note(self, bad):
        with pytest.raises(AssertionError):
            _assert_usable_baseline({"updatedAt": bad}, "synthetic")

    def test_the_assertion_rejects_a_missing_note(self):
        with pytest.raises(AssertionError):
            _assert_usable_baseline(None, "synthetic")

    def test_the_assertion_ACCEPTS_a_real_one(self):
        _assert_usable_baseline({"updatedAt": "2026-09-09T00:00:00"}, "synthetic")
