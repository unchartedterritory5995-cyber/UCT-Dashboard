"""Tests for the sync engine — `note_connectors.engine`.

Uses a `FakeProvider` (implements the real `NoteProvider` ABC) rather than
mocking httpx, since the engine is written against the provider CONTRACT,
not any concrete provider's transport. DB isolation mirrors
`test_note_connectors_connections.py`'s `db` fixture: monkeypatch
`auth_db._DB_PATH` to a temp file before any connection opens, then run
`ensure_schema` — every module (`connections`, `notes`, `engine`) resolves
the same tmp DB via `auth_db.get_connection()` at call time, no explicit
`conn` threading needed.

The required cases from the task brief:
  1. initial sync creates notes + folders + media (fake provider, tmp
     attachment root)
  2. re-sync (identical content) -> all-skipped, no redundant media fetch
  3. remote edit -> update in place
  4. local-edit conflict -> sibling note + tags on BOTH, original untouched
  5. delete detection: 2 consecutive full misses -> tag + sever; refuse
     guard when a full enumeration returns <50% of the known index
  6. cursor is passed through to list_changed RAW (no engine-side overlap
     adjustment — providers own that)
  7. cooldown (manual bypasses)
  8. log rows accurate; status 'error' + cursor untouched on a provider
     raise mid-source

Plus: fetch_many all-or-nothing with a per-ref fallback, data_uri media
decode (+ corrupt-base64 as a named failure, not a crash), provider
instance discipline (list_changed before any fetch), and sync_due_sources
serial + exception-walled iteration.
"""

from __future__ import annotations

import asyncio
import base64
import copy
import importlib
import json
import threading
from datetime import datetime, timedelta, timezone

import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.note_connectors import engine, errors
from api.services.journal_two.note_connectors.providers.base import (
    AccountInfo, NoteProvider, RemoteNote, RemoteRef,
)

PNG_BYTES = (
    b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01'
    b'\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01'
    b'\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82'
)
PNG_DATA_URI = "data:image/png;base64," + base64.b64encode(PNG_BYTES).decode()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def db(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("NOTE_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    import api.services.journal_two.note_connectors.connections as conns
    return conns


class FakeProvider(NoteProvider):
    """A fully in-memory, controllable stand-in for the `NoteProvider`
    contract. Mirrors the REAL providers' instance-discipline guard
    (fetch before list_changed raises) so the engine's ordering is proven
    against the same contract Roam/Craft enforce, not a looser fake."""

    name = "fake"

    def __init__(self):
        self.refs: list[RemoteRef] = []
        self.notes_by_id: dict[str, RemoteNote] = {}
        self.media_by_ref: dict[str, tuple[bytes, str]] = {}
        self.list_changed_calls: list[str | None] = []
        self.fetch_calls: list[str] = []
        self.fetch_many_calls: list[list[str]] = []
        self.fetch_media_calls: list[str] = []
        self.raise_on_list_changed: Exception | None = None
        self.raise_on_fetch_many_for: set[str] = set()
        self.raise_on_fetch_for: set[str] = set()
        self.raise_on_fetch_media_for: set[str] = set()
        self.aclose_calls = 0
        self._enumerated = False

    async def validate(self, credentials):
        return AccountInfo(label="fake")

    async def list_changed(self, credentials, cursor=None):
        self.list_changed_calls.append(cursor)
        if self.raise_on_list_changed is not None:
            raise self.raise_on_list_changed
        self._enumerated = True
        items = [r for r in self.refs if cursor is None or r.updated_at > cursor]
        return sorted(items, key=lambda r: r.updated_at)

    async def fetch(self, credentials, ref):
        if not self._enumerated:
            raise RuntimeError("fetch called before list_changed")
        self.fetch_calls.append(ref.remote_id)
        if ref.remote_id in self.raise_on_fetch_for:
            raise RuntimeError(f"fetch failed for {ref.remote_id}")
        return self.notes_by_id[ref.remote_id]

    async def fetch_many(self, credentials, refs):
        if not self._enumerated:
            raise RuntimeError("fetch_many called before list_changed")
        self.fetch_many_calls.append([r.remote_id for r in refs])
        if any(r.remote_id in self.raise_on_fetch_many_for for r in refs):
            raise RuntimeError("batch fetch failed")
        return [self.notes_by_id[r.remote_id] for r in refs]

    async def fetch_media(self, credentials, ref):
        self.fetch_media_calls.append(ref)
        if ref in self.raise_on_fetch_media_for:
            raise RuntimeError(f"media fetch failed for {ref}")
        return self.media_by_ref[ref]

    async def aclose(self):
        self.aclose_calls += 1


def _doc(text: str) -> dict:
    return {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": text}]}]}


def _body(n):
    """Full bodyJson for a note picked off a LIST row: list_notes projects
    the document body out (widget-embed notes drag multi-KB settings blobs,
    so list responses stopped shipping bodies — panel batch 3). The editor's
    single-note fetch is the read path that keeps it, so tests read it the
    same way."""
    return notes_svc.get_note(n["userId"], n["id"])["bodyJson"]


def _rn(remote_id, title, *, text=None, updated_at="2026-08-01T00:00:00+00:00",
        created_at="2026-07-01T00:00:00+00:00", media=None, links=None,
        tags=None, folder_path=None) -> RemoteNote:
    return RemoteNote(
        remote_id=remote_id, title=title,
        doc=_doc(text if text is not None else title),
        media=media or [], links=links or [], tags=tags or [],
        folder_path=folder_path or [], created_at=created_at, updated_at=updated_at,
    )


@pytest.fixture
def provider(monkeypatch):
    p = FakeProvider()
    # Task 11 widened `_provider_factory`'s call site to always pass BOTH
    # positional args (`provider_name, source`) — see engine.py's
    # `_default_provider_factory` docstring. This fake ignores `source`.
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    return p


@pytest.fixture
def source(db, provider):
    """A connected 'fake' provider source, ready to sync."""
    db.upsert_connector("u1", "fake", {"token": "abc"})
    return db.create_source("u1", "fake", "fake-graph")


def _log_rows(source_id: str) -> list[dict]:
    conn = auth_db.get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM j2_note_sync_log WHERE source_id = ? ORDER BY id ASC",
            (source_id,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def _remote_index_rows(source_id: str) -> list[dict]:
    conn = auth_db.get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM j2_note_remote_index WHERE source_id = ?", (source_id,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# 1. Initial sync creates notes + folders + media
# ---------------------------------------------------------------------------

async def test_initial_full_sync_creates_notes_folders_and_media(source, provider):
    provider.refs = [
        RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="p2", updated_at="2026-08-02T00:00:00+00:00"),
    ]
    provider.notes_by_id = {
        "p1": _rn("p1", "Trading Notes",
                  folder_path=["Trading", "Setups"],
                  media=[{"ref": "img-1", "kind": "image", "name": "chart.png"}]),
        "p2": _rn("p2", "Setup Library", updated_at="2026-08-02T00:00:00+00:00"),
    }
    provider.notes_by_id["p1"].doc["content"].append(
        {"type": "image", "attrs": {"src": "import-ref://img-1"}})
    provider.media_by_ref["img-1"] = (PNG_BYTES, "image/png")

    result = await engine.sync_source(source["id"], full=True)

    assert result["status"] == "ok"
    assert result["created"] == 2
    assert result["updated"] == 0
    assert result["skipped"] == 0
    assert result["mediaUploaded"] == 1

    notes = notes_svc.list_notes("u1")
    titles = {n["title"] for n in notes}
    assert titles == {"Trading Notes", "Setup Library"}

    folders = {f["name"] for f in notes_svc.list_folders("u1")}
    assert {"Trading", "Setups"} <= folders

    trading = next(n for n in notes if n["title"] == "Trading Notes")
    imgs = [n for n in _body(trading)["content"] if n.get("type") == "image"]
    assert len(imgs) == 1
    assert imgs[0]["attrs"]["src"].startswith("/api/j2/notes/attachments/u1/")
    assert not imgs[0]["attrs"]["src"].startswith("import-ref://")

    # provider instance discipline: list_changed ran before any fetch.
    assert provider.list_changed_calls == [None]
    assert provider.aclose_calls == 1  # engine cleans up the per-sync instance


async def test_data_uri_media_decodes_directly_without_provider_fetch(source, provider):
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    rn = _rn("p1", "Inline Image",
             media=[{"ref": "md-img-1.png", "kind": "image", "name": "md-img-1.png",
                     "data_uri": PNG_DATA_URI}])
    rn.doc["content"].append({"type": "image", "attrs": {"src": "import-ref://md-img-1.png"}})
    provider.notes_by_id = {"p1": rn}

    result = await engine.sync_source(source["id"], full=True)

    assert result["mediaUploaded"] == 1
    assert provider.fetch_media_calls == []  # decoded directly, never round-tripped

    note = notes_svc.list_notes("u1")[0]
    img = next(n for n in _body(note)["content"] if n.get("type") == "image")
    assert img["attrs"]["src"].startswith("/api/j2/notes/attachments/u1/")


async def test_corrupt_base64_data_uri_is_a_named_failure_not_a_crash(source, provider):
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    rn = _rn("p1", "Bad Inline Image",
             media=[{"ref": "md-img-1.png", "kind": "image", "name": "md-img-1.png",
                     "data_uri": "data:image/png;base64,!!!not-valid-base64!!!==="}])
    rn.doc["content"].append({"type": "image", "attrs": {"src": "import-ref://md-img-1.png"}})
    provider.notes_by_id = {"p1": rn}

    result = await engine.sync_source(source["id"], full=True)

    assert result["status"] == "ok"  # per-media failure never fails the whole sync
    assert result["mediaUploaded"] == 0
    assert result["created"] == 1
    assert any("md-img-1.png" in f for f in result["failures"])

    note = notes_svc.list_notes("u1")[0]
    # dropped media -> the image node is removed by rewrite_body, no crash.
    assert all(n.get("type") != "image" for n in _body(note)["content"])


@pytest.mark.parametrize("uri", ["data:image/png;base64,!!!not-valid-base64!!!===", "data:image/png;base64"])
async def test_a_malformed_data_uri_is_a_final_unsupported_notice(source, provider, uri):
    """Task 9 fix round 1 (minor b): a data URI that cannot decode will never decode -- a
    FINAL `unsupported` notice, never a retried `fetch_failed`."""
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    rn = _rn("p1", "Bad Inline Image", media=[
        {"ref": "md-img-1.png", "kind": "image", "name": "md-img-1.png", "data_uri": uri}])
    rn.doc["content"].append({"type": "image", "attrs": {"src": "import-ref://md-img-1.png"}})
    provider.notes_by_id = {"p1": rn}
    await engine.sync_source(source["id"], full=True)
    body = _body(notes_svc.list_notes("u1")[0])
    notice = next(n for n in body["content"] if n.get("type") == "importNotice")
    assert (notice["attrs"]["reason"], notice["attrs"]["attempts"]) == ("unsupported", 0)
    conn = auth_db.get_connection()
    try:
        pending = conn.execute("SELECT import_media_pending FROM j2_notes WHERE user_id='u1'").fetchone()[0]
    finally:
        conn.close()
    assert pending == 0


def test_an_oversized_data_uri_is_refused_before_decoding(monkeypatch):
    """Task 9 fix round 1 (minor a): a data URI longer than the largest source the policy
    would keep (base64 of 25 MB, plus slack) is `too_large` -- never decoded."""
    from api.services.journal_two import media_policy
    monkeypatch.setattr(media_policy, "MEDIA_SOURCE_MAX_BYTES", 300)
    limit = engine.data_uri_max_chars()
    assert limit == 300 * 4 // 3 + engine.DATA_URI_SLACK_CHARS
    decoded = []
    monkeypatch.setattr(engine.base64, "b64decode", lambda *a, **k: decoded.append(1) or b"")
    with pytest.raises(errors.NoteConnTooLarge):
        engine._decode_data_uri("data:image/png;base64," + "A" * limit)
    assert decoded == []
    reason = engine._notice_for_exception(
        errors.NoteConnTooLarge("x", reason="big"), ref="r", name="a.png", source_url=None, attempts=1)
    assert reason["attrs"]["reason"] == "too_large"
    engine._decode_data_uri("data:image/png;base64," + "A" * (limit - len("data:image/png;base64,")))
    assert decoded == [1]                                     # at the limit: decoded


# ---------------------------------------------------------------------------
# 2. Re-sync (identical content) -> all-skipped
# ---------------------------------------------------------------------------

async def test_resync_with_unchanged_content_is_all_skipped(source, provider):
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {
        "p1": _rn("p1", "Steady Note",
                  media=[{"ref": "img-1", "kind": "image", "name": "chart.png"}]),
    }
    provider.notes_by_id["p1"].doc["content"].append(
        {"type": "image", "attrs": {"src": "import-ref://img-1"}})
    provider.media_by_ref["img-1"] = (PNG_BYTES, "image/png")

    r1 = await engine.sync_source(source["id"], full=True)
    assert r1["created"] == 1 and r1["mediaUploaded"] == 1
    media_fetch_count_after_first = len(provider.fetch_media_calls)

    r2 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r2["created"] == 0
    assert r2["updated"] == 0
    assert r2["skipped"] == 1
    assert r2["mediaUploaded"] == 0
    # skipped notes never re-resolve media.
    assert len(provider.fetch_media_calls) == media_fetch_count_after_first


# ---------------------------------------------------------------------------
# 3. Remote edit -> update in place
# ---------------------------------------------------------------------------

async def test_remote_edit_updates_the_note_in_place(source, provider):
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "Original Title", text="v1")}
    r1 = await engine.sync_source(source["id"], full=True)
    assert r1["created"] == 1
    original_id = notes_svc.list_notes("u1")[0]["id"]

    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-05T00:00:00+00:00")]
    provider.notes_by_id = {
        "p1": _rn("p1", "Original Title", text="v2", updated_at="2026-08-05T00:00:00+00:00"),
    }
    r2 = await engine.sync_source(source["id"], full=True, manual=True)

    assert r2["updated"] == 1
    assert r2["created"] == 0
    note = notes_svc.get_note("u1", original_id)
    assert note["id"] == original_id  # same note, updated in place
    assert note["bodyPlain"].strip() == "v2"


# ---------------------------------------------------------------------------
# 4. Local-edit conflict -> sibling + tags on both, original untouched
# ---------------------------------------------------------------------------

async def test_local_edit_conflict_creates_sibling_and_preserves_both_versions(source, provider):
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {
        "p1": _rn("p1", "Trading Journal", text="remote v1", folder_path=["Trading"],
                  tags=["setup"]),
    }
    await engine.sync_source(source["id"], full=True)
    original = notes_svc.list_notes("u1")[0]
    assert original["title"] == "Trading Journal"
    original_folder_id = original["folderId"]
    assert original_folder_id is not None

    # Local edit AFTER the sync (updated_at now strictly newer than imported_at).
    notes_svc.update_note("u1", original["id"], {"title": "My local rewrite"})

    # Remote changes too.
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-10T00:00:00+00:00")]
    provider.notes_by_id = {
        "p1": _rn("p1", "Trading Journal", text="remote v2",
                  updated_at="2026-08-10T00:00:00+00:00", folder_path=["Trading"],
                  tags=["setup"]),
    }
    result = await engine.sync_source(source["id"], full=True, manual=True)

    assert result["created"] == 1  # the sibling
    assert result["updated"] == 0  # the original is NEVER touched by import_confirm

    all_notes = notes_svc.list_notes("u1")
    assert len(all_notes) == 2

    kept_original = notes_svc.get_note("u1", original["id"])
    assert kept_original["title"] == "My local rewrite"  # untouched by the sync
    assert "sync-conflict" in kept_original["tags"]

    sibling = next(n for n in all_notes if n["id"] != original["id"])
    assert sibling["title"] == "Trading Journal (synced copy)"
    assert sibling["bodyPlain"].strip() == "remote v2"
    assert "sync-conflict" in sibling["tags"]
    assert sibling["folderId"] == original_folder_id  # same folder as the original


async def test_conflict_resync_updates_the_sibling_not_the_original(source, provider):
    """A second remote change, while the local edit persists, must keep
    routing to the SAME sibling (update in place), never spawn a second one,
    and never touch the original."""
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "Note", text="remote v1")}
    await engine.sync_source(source["id"], full=True)
    original = notes_svc.list_notes("u1")[0]
    notes_svc.update_note("u1", original["id"], {"title": "locally edited"})

    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-05T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "Note", text="remote v2",
                                       updated_at="2026-08-05T00:00:00+00:00")}
    await engine.sync_source(source["id"], full=True, manual=True)

    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-06T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "Note", text="remote v3",
                                       updated_at="2026-08-06T00:00:00+00:00")}
    result = await engine.sync_source(source["id"], full=True, manual=True)

    assert result["created"] == 0
    assert result["updated"] == 1  # the sibling updates in place

    all_notes = notes_svc.list_notes("u1")
    assert len(all_notes) == 2  # still exactly one sibling
    kept_original = notes_svc.get_note("u1", original["id"])
    assert kept_original["title"] == "locally edited"


# ---------------------------------------------------------------------------
# Fix-round-3 Important (live-gate 23rd check): a conflict is only a conflict
# when the REMOTE side actually changed -- `_is_conflict(meta)` alone is
# permanently true for any note the user ever legitimately edited.
# ---------------------------------------------------------------------------

async def test_conflicted_note_with_unchanged_remote_does_not_re_tally_or_resurrect_sibling(
    source, provider,
):
    """(a) A note the user edited, whose remote content is genuinely UNCHANGED
    on the next full pass, must produce conflicts == 0 and never touch a
    sibling -- including a previously-deleted one, which must STAY deleted
    (the exact "delete the copy and it comes right back" defect the live
    gate's 23rd check found: `import_confirm` finds no row for
    `{key}#remote` and silently recreates it)."""
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "Note A", text="remote v1")}
    await engine.sync_source(source["id"], full=True)
    original = notes_svc.list_notes("u1")[0]

    # Genuine user edit -- via the PUBLIC update_note path, exactly as a real
    # edit in the notes UI would (this is what makes _is_conflict permanently
    # true for this note from here on).
    notes_svc.update_note("u1", original["id"], {"title": "locally edited"})

    # Remote changes ONCE -> a genuine conflict, sibling created (baseline;
    # the machinery must still fire on a real change).
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-05T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "Note A", text="remote v2",
                                       updated_at="2026-08-05T00:00:00+00:00")}
    r_conflict = await engine.sync_source(source["id"], full=True, manual=True)
    assert r_conflict["conflicts"] == 1
    sibling = next(n for n in notes_svc.list_notes("u1") if n["id"] != original["id"])
    assert sibling["title"] == "Note A (synced copy)"

    # The user deletes the "(synced copy)" note.
    assert notes_svc.delete_note("u1", sibling["id"]) is True
    assert len(notes_svc.list_notes("u1")) == 1

    # Remote STAYS AT v2 (byte-identical to the last sync) -- a heal-phase /
    # routine full pass with nothing new. Repeated twice: the live gate's
    # bug reproduces on EVERY pass, not just the first.
    for _ in range(2):
        provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-05T00:00:00+00:00")]
        provider.notes_by_id = {"p1": _rn("p1", "Note A", text="remote v2",
                                           updated_at="2026-08-05T00:00:00+00:00")}
        result = await engine.sync_source(source["id"], full=True, manual=True)

        assert result["conflicts"] == 0
        assert result["created"] == 0
        assert result["updated"] == 0

        all_notes = notes_svc.list_notes("u1")
        assert len(all_notes) == 1, (
            f"the deleted sibling was resurrected: {[n['title'] for n in all_notes]}"
        )
        kept = notes_svc.get_note("u1", original["id"])
        assert kept["title"] == "locally edited"  # original still untouched
        assert not any("(synced copy)" in n["title"] for n in all_notes)


async def test_conflicted_note_with_remote_change_after_an_unchanged_pass_still_conflicts(
    source, provider,
):
    """(b) After an unchanged-remote pass produces no conflict, a REAL
    subsequent remote change must still fire the conflict machinery --
    proves the hash gate doesn't blind it to genuine changes."""
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "Note B", text="remote v1")}
    await engine.sync_source(source["id"], full=True)
    original = notes_svc.list_notes("u1")[0]
    notes_svc.update_note("u1", original["id"], {"title": "locally edited"})

    # Pass 1: remote unchanged -> no conflict (this is the (a) scenario).
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "Note B", text="remote v1")}
    r1 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r1["conflicts"] == 0
    assert len(notes_svc.list_notes("u1")) == 1

    # Pass 2: remote genuinely changes -> conflicts == 1, sibling carries the
    # NEW content.
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-09T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "Note B", text="remote v2",
                                       updated_at="2026-08-09T00:00:00+00:00")}
    r2 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r2["conflicts"] == 1

    all_notes = notes_svc.list_notes("u1")
    assert len(all_notes) == 2
    sibling = next(n for n in all_notes if n["id"] != original["id"])
    assert sibling["title"] == "Note B (synced copy)"
    assert sibling["bodyPlain"].strip() == "remote v2"
    assert "sync-conflict" in sibling["tags"]
    kept_original = notes_svc.get_note("u1", original["id"])
    assert kept_original["title"] == "locally edited"  # still untouched


# ---------------------------------------------------------------------------
# Plan A Task 1: "did the remote change" is keyed on the remote's REVISION
# (`j2_notes.import_remote_rev`), never on our conversion. A converter fix
# changes `_import_payload_hash` for every note on the next full pass; that
# must not read as a remote edit on a member-edited note.
# ---------------------------------------------------------------------------

async def test_converter_change_never_manufactures_a_conflict_copy(source, provider):
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "Page")}
    await engine.sync_source(source["id"], full=True)
    n = notes_svc.list_notes("u1")[0]
    notes_svc.update_note("u1", n["id"], {"title": "Mine"})
    # same remote revision, different conversion (a converter fix shipped)
    provider.notes_by_id = {"p1": _rn("p1", "Page", text="Page, converted better")}
    r = await engine.sync_source(source["id"], full=True, manual=True)
    assert r["conflicts"] == 0
    assert [x["title"] for x in notes_svc.list_notes("u1")] == ["Mine"]
    # the member's note is untouched: its body is still the original conversion
    assert "converted better" not in notes_svc.get_note("u1", n["id"])["bodyPlain"]


async def test_converter_change_updates_an_unedited_note_in_place(source, provider):
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "Page")}
    await engine.sync_source(source["id"], full=True)
    provider.notes_by_id = {"p1": _rn("p1", "Page", text="Page, converted better")}
    r = await engine.sync_source(source["id"], full=True, manual=True)
    assert r["conflicts"] == 0
    all_notes = notes_svc.list_notes("u1")
    assert len(all_notes) == 1
    assert r["updated"] == 1 and "converted better" in all_notes[0]["bodyPlain"]


async def test_remote_revision_change_on_edited_note_still_conflicts(source, provider):
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "Page")}
    await engine.sync_source(source["id"], full=True)
    n = notes_svc.list_notes("u1")[0]
    notes_svc.update_note("u1", n["id"], {"title": "Mine"})
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-02T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "Page", text="remote v2",
                                       updated_at="2026-08-02T00:00:00+00:00")}
    r = await engine.sync_source(source["id"], full=True, manual=True)
    assert r["conflicts"] == 1
    assert sorted(x["title"] for x in notes_svc.list_notes("u1")) == ["Mine", "Page (synced copy)"]


async def test_legacy_row_without_remote_rev_uses_imported_at_fallback(source, provider):
    from datetime import datetime, timedelta, timezone
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "Page")}
    await engine.sync_source(source["id"], full=True)
    n = notes_svc.list_notes("u1")[0]
    conn = auth_db.get_connection()
    try:
        # the rail is only meaningful if the import actually recorded a revision
        assert conn.execute("SELECT import_remote_rev FROM j2_notes WHERE id = ?",
                            (n["id"],)).fetchone()[0] == "2026-08-01T00:00:00+00:00"
        conn.execute("UPDATE j2_notes SET import_remote_rev = NULL WHERE id = ?", (n["id"],))
        conn.commit()
    finally:
        conn.close()
    notes_svc.update_note("u1", n["id"], {"title": "Mine"})

    # converter change, SAME remote updated_at (older than imported_at) -> no copy
    provider.notes_by_id = {"p1": _rn("p1", "Page", text="Page, converted better")}
    r1 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r1["conflicts"] == 0
    assert [x["title"] for x in notes_svc.list_notes("u1")] == ["Mine"]

    # a remote edit made AFTER the import -> a genuine conflict
    later = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    provider.refs = [RemoteRef(remote_id="p1", updated_at=later)]
    provider.notes_by_id = {"p1": _rn("p1", "Page", text="remote v2", updated_at=later)}
    r2 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r2["conflicts"] == 1
    assert sorted(x["title"] for x in notes_svc.list_notes("u1")) == ["Mine", "Page (synced copy)"]


async def _legacy_conflicted_row_with_deleted_sibling(source, provider):
    """A note that conflicted BEFORE Task 1 deployed: member-edited, remote
    revision later than its (stale) imported_at, "(synced copy)" deleted by
    the member, and `import_remote_rev` NULL (the pre-deploy baseline write
    never recorded one). Returns (note id, the remote revision)."""
    from datetime import datetime, timedelta, timezone
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "Page")}
    await engine.sync_source(source["id"], full=True)
    n = notes_svc.list_notes("u1")[0]
    notes_svc.update_note("u1", n["id"], {"title": "Mine"})
    later = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    provider.refs = [RemoteRef(remote_id="p1", updated_at=later)]
    provider.notes_by_id = {"p1": _rn("p1", "Page", text="remote v2", updated_at=later)}
    r = await engine.sync_source(source["id"], full=True, manual=True)
    assert r["conflicts"] == 1
    sibling = next(x for x in notes_svc.list_notes("u1") if x["id"] != n["id"])
    assert notes_svc.delete_note("u1", sibling["id"]) is True
    conn = auth_db.get_connection()
    try:
        conn.execute("UPDATE j2_notes SET import_remote_rev = NULL WHERE id = ?", (n["id"],))
        conn.commit()
    finally:
        conn.close()
    return n["id"], later


def _remote_rev_of(note_id):
    conn = auth_db.get_connection()
    try:
        return conn.execute("SELECT import_remote_rev, updated_at FROM j2_notes WHERE id = ?",
                            (note_id,)).fetchone()
    finally:
        conn.close()


async def test_unchanged_pass_backfills_a_legacy_conflicted_rows_revision(source, provider):
    """Fix round 1, finding 1: an unchanged pass (equal hash) records the
    remote revision on a legacy row, timestamp-neutrally, so a LATER
    converter change can no longer resurrect the deleted sibling."""
    note_id, later = await _legacy_conflicted_row_with_deleted_sibling(source, provider)
    before = _remote_rev_of(note_id)
    assert before["import_remote_rev"] is None

    # (i) unchanged pass: same revision, same conversion
    provider.notes_by_id = {"p1": _rn("p1", "Page", text="remote v2", updated_at=later)}
    r1 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r1["conflicts"] == 0
    after = _remote_rev_of(note_id)
    assert after["import_remote_rev"] == later
    assert after["updated_at"] == before["updated_at"]  # timestamp-neutral

    # (ii) converter change, same revision: no copy, no conflict
    provider.notes_by_id = {"p1": _rn("p1", "Page", text="remote v2, converted better",
                                       updated_at=later)}
    r2 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r2["conflicts"] == 0
    assert [x["title"] for x in notes_svc.list_notes("u1")] == ["Mine"]


async def test_legacy_conflicted_row_converter_change_without_prior_pass_is_no_worse(
    source, provider,
):
    """Fix round 1, finding 1, the residual case: a converter change reaching
    a legacy conflicted row BEFORE any unchanged pass. Pre-Task-1 the hash
    rule called this a conflict and tried to re-confirm the deleted sibling
    (a trashed sibling keeps its import_key, so that surfaces as a stored
    failure, not a visible note); it still does (no worse), and the baseline
    write now records the revision, so it happens at most ONCE -- the next
    converter change is quiet."""
    note_id, later = await _legacy_conflicted_row_with_deleted_sibling(source, provider)
    provider.notes_by_id = {"p1": _rn("p1", "Page", text="remote v2, converted better",
                                       updated_at=later)}
    r1 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r1["conflicts"] == 1  # same as the pre-Task-1 hash rule
    assert _remote_rev_of(note_id)["import_remote_rev"] == later
    # The trashed sibling keeps its import_key, so the re-confirm hits the
    # unique index and is reported as a failure rather than reappearing --
    # exactly what the pre-Task-1 hash rule did on this pass.
    assert any("p1#remote" in f for f in r1["failures"])
    titles_after_first = sorted(x["title"] for x in notes_svc.list_notes("u1"))
    assert titles_after_first == ["Mine"]

    provider.notes_by_id = {"p1": _rn("p1", "Page", text="remote v2, converted twice",
                                       updated_at=later)}
    r2 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r2["conflicts"] == 0
    assert r2["failures"] == []
    assert sorted(x["title"] for x in notes_svc.list_notes("u1")) == titles_after_first


# ---------------------------------------------------------------------------
# 5. Delete detection: 2-strikes + refuse guard
# ---------------------------------------------------------------------------


def _a_night_later(source_id):
    """Backdate the source's previous full pass by a day, so the next
    back-to-back full pass on the real clock is shaped like the NEXT nightly
    pass. Every full pass, scheduler included, leaves at least
    MEMBER_FULL_PASS_MIN_INTERVAL_S between strike 1 and strike 2; these
    tests model nightly passes, which are a day apart."""
    conn = auth_db.get_connection()
    try:
        conn.execute(
            "UPDATE j2_note_sources SET last_full_sync_at = ? WHERE id = ?",
            ((datetime.now(timezone.utc) - timedelta(days=1)).isoformat(), source_id),
        )
        conn.commit()
    finally:
        conn.close()


async def test_delete_detection_needs_two_consecutive_full_misses(source, provider):
    provider.refs = [
        RemoteRef(remote_id="a", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="b", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="c", updated_at="2026-08-01T00:00:00+00:00"),
    ]
    provider.notes_by_id = {
        "a": _rn("a", "A"), "b": _rn("b", "B"), "c": _rn("c", "C"),
    }
    await engine.sync_source(source["id"], full=True)
    c_note_id = next(n["id"] for n in notes_svc.list_notes("u1") if n["title"] == "C")

    # Full sync #2: "c" is missing -> first miss, NOT deleted yet.
    provider.refs = provider.refs[:2]  # only a, b
    _a_night_later(source["id"])
    r2 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r2["status"] == "ok"
    idx_rows = {r["remote_id"]: r for r in _remote_index_rows(source["id"])}
    assert idx_rows["c"]["miss_streak"] == 1
    c_note = notes_svc.get_note("u1", c_note_id)
    assert "source-deleted" not in c_note["tags"]

    # Full sync #3: "c" STILL missing -> second consecutive miss -> tagged + severed.
    _a_night_later(source["id"])
    r3 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r3["status"] == "ok"
    idx_rows = {r["remote_id"]: r for r in _remote_index_rows(source["id"])}
    assert "c" not in idx_rows  # index row severed
    c_note = notes_svc.get_note("u1", c_note_id)
    assert "source-deleted" in c_note["tags"]
    # the note itself is never deleted, only flagged.
    assert notes_svc.get_note("u1", c_note_id) is not None


async def test_a_sever_is_persisted_to_the_sync_log_row_the_card_reads(source, provider):
    """The connectors card does NOT read a sync's return value -- it reads the
    newest `j2_note_sync_log` row (`routers/note_sync.py::_latest_sync_counts`).
    So a pass whose response says `sourceDeleted: 1` while the log row says 0
    is invisible to the member, which is exactly how deletions used to land:
    `_finish_log` wrote created/updated/skipped/media/conflicts and silently
    dropped the sever count. Asserts the number reaches the row, not just the
    response -- and that a pass which severs NOTHING writes 0, so the column
    can never read as "stale last time something was deleted"."""
    provider.refs = [
        RemoteRef(remote_id="a", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="b", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="c", updated_at="2026-08-01T00:00:00+00:00"),
    ]
    provider.notes_by_id = {"a": _rn("a", "A"), "b": _rn("b", "B"), "c": _rn("c", "C")}
    await engine.sync_source(source["id"], full=True)

    def _newest_log_source_deleted() -> int:
        conn = auth_db.get_connection()
        try:
            row = conn.execute(
                "SELECT source_deleted FROM j2_note_sync_log "
                "WHERE source_id = ? ORDER BY id DESC LIMIT 1",
                (source["id"],),
            ).fetchone()
        finally:
            conn.close()
        return row["source_deleted"] or 0

    # A pass that severs nothing writes 0 -- not NULL, not the previous value.
    assert _newest_log_source_deleted() == 0

    provider.refs = provider.refs[:2]              # "c" goes missing
    _a_night_later(source["id"])
    r2 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r2["sourceDeleted"] == 0                # first miss: no sever yet
    assert _newest_log_source_deleted() == 0

    _a_night_later(source["id"])
    r3 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r3["sourceDeleted"] == 1                # second miss: severed
    # ⛔ THE POINT: the same 1 must be readable from the log row, because that
    # row -- not r3 -- is what the member's connectors card renders.
    assert _newest_log_source_deleted() == 1


async def test_delete_detection_refuses_when_enumeration_returns_under_half(source, provider):
    provider.refs = [
        RemoteRef(remote_id=str(i), updated_at="2026-08-01T00:00:00+00:00") for i in range(4)
    ]
    provider.notes_by_id = {str(i): _rn(str(i), f"N{i}") for i in range(4)}
    await engine.sync_source(source["id"], full=True)
    before = {r["remote_id"]: r["miss_streak"] for r in _remote_index_rows(source["id"])}
    assert len(before) == 4

    # A suspicious enumeration: only 1 of 4 previously-known items comes back.
    provider.refs = provider.refs[:1]
    result = await engine.sync_source(source["id"], full=True, manual=True)

    assert result["status"] == "warning"
    assert result["deleteDetectionWarning"] is not None
    assert "50%" in result["deleteDetectionWarning"] or "known items" in result["deleteDetectionWarning"]

    after = {r["remote_id"]: r["miss_streak"] for r in _remote_index_rows(source["id"])}
    # Nothing was touched by the refused delete pass.
    assert after == before
    assert len(after) == 4

    log_row = _log_rows(source["id"])[-1]
    assert log_row["status"] == "warning"


# ---------------------------------------------------------------------------
# 6. Cursor passed through raw (no engine-side overlap adjustment)
# ---------------------------------------------------------------------------

async def test_incremental_sync_passes_the_raw_stored_cursor_unadjusted(source, provider):
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "First")}
    await engine.sync_source(source["id"], full=True)

    got_source = engine.connections.get_source_by_id(source["id"])
    stored_cursor = got_source["cursor"]
    assert stored_cursor == "2026-08-01T00:00:00+00:00"

    provider.refs = [
        RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="p2", updated_at="2026-08-02T00:00:00+00:00"),
    ]
    provider.notes_by_id["p2"] = _rn("p2", "Second", updated_at="2026-08-02T00:00:00+00:00")

    await engine.sync_source(source["id"], full=False, manual=True)

    assert provider.list_changed_calls[-1] == stored_cursor  # exact, unadjusted


# ---------------------------------------------------------------------------
# 7. Cooldown (manual bypasses)
# ---------------------------------------------------------------------------

async def test_cooldown_skips_a_repeat_sync_unless_manual(source, provider):
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "First")}
    await engine.sync_source(source["id"], full=True)
    calls_after_first = len(provider.list_changed_calls)

    r2 = await engine.sync_source(source["id"])
    assert r2["status"] == "cooldown"
    assert len(provider.list_changed_calls) == calls_after_first  # provider never touched

    r3 = await engine.sync_source(source["id"], manual=True)
    assert r3["status"] == "ok"
    assert len(provider.list_changed_calls) == calls_after_first + 1


# ---------------------------------------------------------------------------
# 8. Log rows accurate; error status + cursor untouched on a provider raise
# ---------------------------------------------------------------------------

async def test_log_row_counts_are_accurate_on_success(source, provider):
    provider.refs = [
        RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="p2", updated_at="2026-08-02T00:00:00+00:00"),
    ]
    provider.notes_by_id = {
        "p1": _rn("p1", "A", media=[{"ref": "img-1", "kind": "image", "name": "x.png"}]),
        "p2": _rn("p2", "B", updated_at="2026-08-02T00:00:00+00:00"),
    }
    provider.notes_by_id["p1"].doc["content"].append(
        {"type": "image", "attrs": {"src": "import-ref://img-1"}})
    provider.media_by_ref["img-1"] = (PNG_BYTES, "image/png")

    await engine.sync_source(source["id"], full=True)

    rows = _log_rows(source["id"])
    assert len(rows) == 1
    row = rows[0]
    assert row["status"] == "ok"
    assert row["started_at"] is not None and row["finished_at"] is not None
    assert row["notes_created"] == 2
    assert row["notes_updated"] == 0
    assert row["notes_skipped"] == 0
    assert row["media_uploaded"] == 1


async def test_provider_exception_marks_log_error_and_does_not_advance_cursor(source, provider):
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "First")}
    await engine.sync_source(source["id"], full=True)
    cursor_before = engine.connections.get_source_by_id(source["id"])["cursor"]

    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-09T00:00:00+00:00")]
    provider.raise_on_list_changed = RuntimeError("provider is down")

    with pytest.raises(RuntimeError, match="provider is down"):
        await engine.sync_source(source["id"], full=True, manual=True)

    got = engine.connections.get_source_by_id(source["id"])
    assert got["cursor"] == cursor_before  # untouched
    assert got["lastSyncStatus"] == "error"

    rows = _log_rows(source["id"])
    assert rows[-1]["status"] == "error"
    assert "provider is down" in rows[-1]["error"]


# ---------------------------------------------------------------------------
# fetch_many all-or-nothing -> per-ref fallback
# ---------------------------------------------------------------------------

async def test_fetch_many_batch_exception_falls_back_to_per_ref_with_one_named_failure(
    source, provider,
):
    provider.refs = [
        RemoteRef(remote_id="ok-1", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="bad", updated_at="2026-08-01T00:00:01+00:00"),
        RemoteRef(remote_id="ok-2", updated_at="2026-08-01T00:00:02+00:00"),
    ]
    provider.notes_by_id = {
        "ok-1": _rn("ok-1", "OK One"),
        "ok-2": _rn("ok-2", "OK Two", updated_at="2026-08-01T00:00:02+00:00"),
        # "bad" deliberately absent -> per-ref fetch() raises a KeyError for it.
    }
    provider.raise_on_fetch_many_for = {"bad"}
    provider.raise_on_fetch_for = {"bad"}
    # give fetch() something to raise on 'bad' explicitly (KeyError would also
    # work via notes_by_id, but an explicit raise is a clearer failure name).

    result = await engine.sync_source(source["id"], full=True)

    assert provider.fetch_many_calls == [["ok-1", "bad", "ok-2"]]  # one batch attempt
    assert sorted(provider.fetch_calls) == ["bad", "ok-1", "ok-2"]  # fell back per-ref
    assert result["created"] == 2  # the two good notes still imported
    assert len(result["failures"]) == 1
    assert "bad" in result["failures"][0]

    titles = {n["title"] for n in notes_svc.list_notes("u1")}
    assert titles == {"OK One", "OK Two"}


# ---------------------------------------------------------------------------
# sync_due_sources — serial, exception-walled
# ---------------------------------------------------------------------------

async def test_sync_due_sources_isolates_a_failing_source(db, provider):
    db.upsert_connector("u1", "fake", {"token": "abc"})
    good = db.create_source("u1", "fake", "graph-good")
    bad = db.create_source("u1", "bogus-provider", "graph-bad")

    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "Good Note")}

    await engine.sync_due_sources()

    good_after = db.get_source("u1", good["id"])
    bad_after = db.get_source("u1", bad["id"])
    assert good_after["lastSyncStatus"] == "ok"
    assert bad_after["lastSyncStatus"] == "error"  # isolated, didn't stop the sweep
    assert notes_svc.list_notes("u1")[0]["title"] == "Good Note"


# ---------------------------------------------------------------------------
# Link resolution (import-link:// -> a real note URL), via the FINAL pass
# (`_resolve_links_final_pass`, added in the 2026-08-12 review round-2 fix).
#
# ⚠️ Both notes below land in the SAME confirm batch (default
# `_CONFIRM_BATCH_SIZE`), so this test alone does NOT prove cross-batch
# resolution — that was exactly the false confidence that hid the original
# bug (link resolution used to run inside each batch's OWN resolve step, so
# a same-batch case like this one always "just worked" even before the fix,
# while a genuinely cross-batch forward reference was silently and
# permanently erased). The dedicated cross-batch regression is
# `test_cross_batch_forward_link_resolves_in_the_final_pass` below, which
# forces `_CONFIRM_BATCH_SIZE=1` so the two notes land in DIFFERENT batches.
# ---------------------------------------------------------------------------

async def test_import_link_placeholder_resolves_to_the_target_notes_url(source, provider):
    provider.refs = [
        RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="p2", updated_at="2026-08-01T00:00:01+00:00"),
    ]
    linked = _rn("p1", "Page One", links=["fake:fake-graph/p2"])
    linked.doc["content"].append({
        "type": "paragraph",
        "content": [{
            "type": "text", "text": "Setup Library",
            "marks": [{"type": "link", "attrs": {"href": "import-link://fake:fake-graph/p2"}}],
        }],
    })
    provider.notes_by_id = {
        "p1": linked,
        "p2": _rn("p2", "Setup Library", updated_at="2026-08-01T00:00:01+00:00"),
    }

    await engine.sync_source(source["id"], full=True)

    target_id = next(n["id"] for n in notes_svc.list_notes("u1") if n["title"] == "Setup Library")
    page_one = next(n for n in notes_svc.list_notes("u1") if n["title"] == "Page One")

    def _find_link(node):
        if isinstance(node, dict):
            for m in node.get("marks") or []:
                if m.get("type") == "link":
                    return m["attrs"]["href"]
            for c in node.get("content") or []:
                found = _find_link(c)
                if found:
                    return found
        return None

    href = _find_link(_body(page_one))
    assert href == f"/journal?j2tab=notebook&note={target_id}"


# ---------------------------------------------------------------------------
# Review fix pass (2026-08-12) — Critical 1 covered in test_note_connectors_db.py
# ---------------------------------------------------------------------------


# Critical 2 — a concurrent user edit landing between confirm and the raw
# body write must never be clobbered; the resolved content reroutes to a
# conflict sibling instead.


async def test_body_write_race_reroutes_resolved_content_to_a_sibling_preserving_the_original(
    source, provider, monkeypatch,
):
    # "p2" (the link target) IS synced alongside "p1" in round 1 so the link
    # actually resolves on the clean path — proving the positive case, not
    # just the "stays intact forever" negative case (covered elsewhere).
    provider.refs = [
        RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="p2", updated_at="2026-08-01T00:00:00+00:00"),
    ]
    rn1 = _rn("p1", "Race Note", text="v1", links=["fake:fake-graph/p2"])
    rn1.doc["content"].append({
        "type": "paragraph",
        "content": [{
            "type": "text", "text": "link",
            "marks": [{"type": "link", "attrs": {"href": "import-link://fake:fake-graph/p2"}}],
        }],
    })
    provider.notes_by_id = {"p1": rn1, "p2": _rn("p2", "Target Note")}

    r1 = await engine.sync_source(source["id"], full=True)
    assert r1["status"] == "ok"
    assert r1["conflicts"] == 0
    all_notes = notes_svc.list_notes("u1")
    assert len(all_notes) == 2  # clean path: no race, no sibling
    original = next(n for n in all_notes if n["title"] == "Race Note")
    target = next(n for n in all_notes if n["title"] == "Target Note")
    original_id = original["id"]
    # the link resolved cleanly to the target's real URL on the clean path
    # (via the final link-resolution pass), proving the clean path itself
    # resolves correctly, not just that it "doesn't crash".
    assert f"/journal?j2tab=notebook&note={target['id']}" in json.dumps(_body(original))

    # Second sync: remote content changes -> import_confirm will UPDATE this
    # note's placeholder body normally (no PRE-confirm conflict, since the
    # note was never locally edited yet).
    provider.refs = [
        RemoteRef(remote_id="p1", updated_at="2026-08-05T00:00:00+00:00"),
        RemoteRef(remote_id="p2", updated_at="2026-08-01T00:00:00+00:00"),
    ]
    rn2 = _rn("p1", "Race Note", text="v2", updated_at="2026-08-05T00:00:00+00:00",
              links=["fake:fake-graph/p2"])
    rn2.doc["content"].append({
        "type": "paragraph",
        "content": [{
            "type": "text", "text": "link",
            "marks": [{"type": "link", "attrs": {"href": "import-link://fake:fake-graph/p2"}}],
        }],
    })
    provider.notes_by_id = {"p1": rn2, "p2": _rn("p2", "Target Note")}

    real_rewrite_body = engine.rewrite_body
    fired = {"done": False}

    def racing_rewrite_body(doc, media_urls, id_by_key, *, strip_unresolved_links=True,
                            notices=None, resolved=None):
        if not fired["done"]:
            fired["done"] = True
            # Simulates a user's OWN edit landing in the window between this
            # note's import_confirm (already run) and this resolve step.
            notes_svc.update_note("u1", original_id, {"title": "user's own concurrent edit"})
        return real_rewrite_body(
            doc, media_urls, id_by_key, strip_unresolved_links=strip_unresolved_links,
            notices=notices, resolved=resolved)

    monkeypatch.setattr(engine, "rewrite_body", racing_rewrite_body)

    result = await engine.sync_source(source["id"], full=True, manual=True)

    assert result["conflicts"] == 1

    kept_original = notes_svc.get_note("u1", original_id)
    assert kept_original["title"] == "user's own concurrent edit"  # never clobbered
    assert "sync-conflict" in kept_original["tags"]
    # the LOSING (resolved) write never applied -> the placeholder confirm
    # already wrote is still there, untouched by the race.
    assert "import-link://" in json.dumps(_body(kept_original))

    all_notes = notes_svc.list_notes("u1")
    assert len(all_notes) == 3  # original + target + the new conflict sibling
    sibling = next(n for n in all_notes if n["title"] == "Race Note (synced copy)")
    assert "sync-conflict" in sibling["tags"]
    # the sibling holds the RESOLVED content (link resolved to the target,
    # same as the clean-path assertion above).
    assert f"/journal?j2tab=notebook&note={target['id']}" in json.dumps(_body(sibling))
    assert sibling["bodyPlain"].strip().startswith("v2")


# Critical 3 (PRIMARY) — a later batch's confirm exception can never strand
# an already-resolved earlier batch; batch-level failures degrade gracefully.


async def test_batch_2_confirm_exception_never_strands_batch_1s_already_resolved_note(
    source, provider, monkeypatch,
):
    monkeypatch.setattr(engine, "_CONFIRM_BATCH_SIZE", 1)  # force 2 notes -> 2 batches

    provider.refs = [
        RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="p2", updated_at="2026-08-01T00:00:01+00:00"),
    ]
    good = _rn("p1", "Batch One Note",
               media=[{"ref": "img-1", "kind": "image", "name": "x.png"}])
    good.doc["content"].append({"type": "image", "attrs": {"src": "import-ref://img-1"}})
    provider.media_by_ref["img-1"] = (PNG_BYTES, "image/png")

    bad = _rn("p2", "Batch Two Note", updated_at="2026-08-01T00:00:01+00:00")
    bad.doc = {"type": "not-a-doc"}  # malformed -> import_confirm isolates it into `failed`

    provider.notes_by_id = {"p1": good, "p2": bad}

    result = await engine.sync_source(source["id"], full=True)

    assert result["status"] == "ok"  # a bad batch degrades gracefully, doesn't abort the sync
    assert result["created"] == 1  # only batch 1's note
    assert result["mediaUploaded"] == 1  # batch 1 was fully resolved, not just confirmed
    # session-audit.md A1/A2: `import_confirm` now isolates the one bad note
    # into its own `failed` entry instead of raising for the whole (size-1)
    # batch, so the message names the NOTE, not the batch.
    assert any("could not be stored" in f.lower() for f in result["failures"])

    notes = notes_svc.list_notes("u1")
    assert len(notes) == 1
    assert notes[0]["title"] == "Batch One Note"
    img = next(n for n in _body(notes[0])["content"] if n.get("type") == "image")
    assert img["attrs"]["src"].startswith("/api/j2/notes/attachments/u1/")  # fully resolved

    log_row = _log_rows(source["id"])[-1]
    assert log_row["notes_created"] == 1
    assert log_row["status"] == "ok"


# Critical 3 (SAFETY NET) — self-heal: a note whose stored body still
# carries a stranded placeholder (from some earlier failed resolve) gets
# healed on a later sync even though its content hash marks it "skipped".


async def test_a_hand_stranded_note_heals_on_the_next_sync(source, provider):
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "Stranded Note", text="hello")}

    r1 = await engine.sync_source(source["id"], full=True)
    assert r1["status"] == "ok"
    note = notes_svc.list_notes("u1")[0]

    # Directly simulate a prior, now-fixed bug: the stored body still
    # carries a literal, never-resolved placeholder (imported_at/import_hash
    # left untouched, so the NEXT sync with identical remote content will
    # mark this note 'skipped' by hash).
    conn = auth_db.get_connection()
    stranded_body = json.dumps({
        "type": "doc",
        "content": [{"type": "image", "attrs": {"src": "import-ref://orphan-ref"}}],
    })
    conn.execute("UPDATE j2_notes SET body_json = ? WHERE id = ?", (stranded_body, note["id"]))
    conn.commit()
    conn.close()
    assert "import-ref://" in notes_svc.get_note("u1", note["id"])["bodyPlain"] or True  # sanity no-op

    # Second sync: remote content is UNCHANGED (same hash) -> would normally
    # be a pure skip. Self-heal must still notice + fix the stranded body.
    result = await engine.sync_source(source["id"], full=True, manual=True)

    assert result["status"] == "ok"
    assert result["skipped"] == 1  # content-wise, this WAS a skip

    healed = notes_svc.get_note("u1", note["id"])
    assert "import-ref://" not in json.dumps(_body(healed))


# Important 4 — an auth rejection marks BOTH the source and the connector
# 'broken' so list_due_sources excludes it and the UI prompts a reconnect,
# instead of retrying (and failing) forever.


async def test_auth_error_marks_both_source_and_connector_broken(source, provider):
    provider.raise_on_list_changed = errors.NoteConnAuthError("token rejected")

    with pytest.raises(errors.NoteConnAuthError):
        await engine.sync_source(source["id"], full=True)

    got_source = engine.connections.get_source_by_id(source["id"])
    assert got_source["status"] == "broken"
    got_connector = engine.connections.get_connector("u1", "fake")
    assert got_connector["status"] == "broken"

    # due-listing already filters on status='active' -> this source no
    # longer gets auto-retried forever.
    due_ids = {s["id"] for s in engine.connections.list_due_sources(0)}
    assert source["id"] not in due_ids


async def test_token_expired_subclass_also_marks_broken(source, provider):
    """NoteConnTokenExpired ⊂ NoteConnAuthError — the SAME handling applies."""
    provider.raise_on_list_changed = errors.NoteConnTokenExpired("token expired")

    with pytest.raises(errors.NoteConnTokenExpired):
        await engine.sync_source(source["id"], full=True)

    assert engine.connections.get_source_by_id(source["id"])["status"] == "broken"
    assert engine.connections.get_connector("u1", "fake")["status"] == "broken"


# Fix-round (msgraph wave, Important #4) — the other half of the two tests
# above: once a source is marked 'broken' and the user reconnects + the NEXT
# sync actually succeeds, the source must rejoin the active pool. Without
# this, `create_source`'s idempotent-return on reconnect only reset the
# CONNECTOR's status (via `upsert_connector`), never the SOURCE's, so a
# source stayed permanently excluded from `list_due_sources`/
# `list_all_sources` even after a real, successful sync.


async def test_a_broken_source_recovers_to_active_after_a_successful_sync(source, provider):
    provider.raise_on_list_changed = errors.NoteConnAuthError("token rejected")
    with pytest.raises(errors.NoteConnAuthError):
        await engine.sync_source(source["id"], full=True)
    assert engine.connections.get_source_by_id(source["id"])["status"] == "broken"

    # Reconnect + a real, successful sync (mirrors the real recovery path:
    # the provider now accepts credentials again).
    provider.raise_on_list_changed = None
    result = await engine.sync_source(source["id"], full=True, manual=True)
    assert result["status"] == "ok"

    got = engine.connections.get_source_by_id(source["id"])
    assert got["status"] == "active"
    due_ids = {s["id"] for s in engine.connections.list_due_sources(0)}
    assert source["id"] in due_ids, "recovered source must rejoin list_due_sources"
    all_ids = {s["id"] for s in engine.connections.list_all_sources()}
    assert source["id"] in all_ids, "recovered source must rejoin list_all_sources (nightly full pass)"


async def test_a_failing_sync_still_marks_the_source_broken_no_regression(source, provider):
    """Control for the recovery fix above — a genuinely failing sync must
    still mark 'broken', proving the new ok=True recovery path never
    weakened the existing ok=False failure path. Same shape as
    `test_auth_error_marks_both_source_and_connector_broken`, kept here as
    the explicit pair to the recovery test."""
    provider.raise_on_list_changed = errors.NoteConnAuthError("token rejected")
    with pytest.raises(errors.NoteConnAuthError):
        await engine.sync_source(source["id"], full=True)

    assert engine.connections.get_source_by_id(source["id"])["status"] == "broken"
    assert engine.connections.get_connector("u1", "fake")["status"] == "broken"


# Important 6 — validate the resolved body (1MB/shape backstop) before the
# raw write; failure -> named error in the log, placeholder body left in
# place so self-heal can retry after a fix.


async def test_a_note_whose_projection_fails_is_a_named_failure_and_the_pass_continues(
    source, provider, monkeypatch,
):
    """Plan A Task 2 fix round 1, M1 + M2. `_apply_resolved_body` now rebuilds the
    note's sidecars; when that raises for ONE note, its body write is rolled back
    (placeholder kept, updated_at unmoved) and the media pass records a per-note
    failure and carries on with the next note instead of stopping the source."""
    provider.refs = [RemoteRef(remote_id="bad", updated_at="2026-08-01T00:00:00+00:00"),
                     RemoteRef(remote_id="good", updated_at="2026-08-01T00:00:01+00:00")]
    bad = _rn("bad", "Bad Note", media=[{"ref": "img-b", "kind": "image", "name": "b.png"}])
    bad.doc["content"].append({"type": "image", "attrs": {"src": "import-ref://img-b"}})
    good = _rn("good", "Good Note", media=[{"ref": "img-g", "kind": "image", "name": "g.png"}])
    good.doc["content"].append({"type": "image", "attrs": {"src": "import-ref://img-g"}})
    provider.media_by_ref = {"img-b": (PNG_BYTES, "image/png"), "img-g": (PNG_BYTES, "image/png")}
    provider.notes_by_id = {"bad": bad, "good": good}

    real_sync = notes_svc._sync_note_sidecars
    seen_baselines: dict[str, str] = {}
    real_bulk = engine._bulk_note_updated_at

    def recording_bulk(conn, ids):
        out = real_bulk(conn, ids)
        seen_baselines.update(out)
        return out

    def flaky_sync(conn, user_id, note_id, body_json, body_plain):
        blob = json.dumps(body_json)
        # Only the ENGINE's resolved write for the bad note fails; confirm's own
        # sidecar rebuild (placeholder still present) goes through untouched.
        if "Bad Note" in blob and "import-ref://" not in blob:
            raise RuntimeError("projection failed")
        return real_sync(conn, user_id, note_id, body_json, body_plain)

    monkeypatch.setattr(engine, "_bulk_note_updated_at", recording_bulk)
    monkeypatch.setattr(notes_svc, "_sync_note_sidecars", flaky_sync)

    result = await engine.sync_source(source["id"], full=True)

    assert result["status"] == "ok"
    assert result["created"] == 2
    assert any("resolved body write failed" in f and "projection failed" in f
               for f in result["failures"]), result["failures"]
    by_title = {n["title"]: n for n in notes_svc.list_notes("u1")}
    bad_note, good_note = by_title["Bad Note"], by_title["Good Note"]
    assert "import-ref://img-b" in json.dumps(_body(bad_note))       # body write rolled back
    assert "import-ref://" not in json.dumps(_body(good_note))        # the next note still resolved
    conn = auth_db.get_connection()
    try:
        upd = conn.execute("SELECT updated_at FROM j2_notes WHERE id = ?",
                           (bad_note["id"],)).fetchone()[0]
    finally:
        conn.close()
    assert upd == seen_baselines[bad_note["id"]]                       # updated_at never moved


async def test_oversized_resolved_body_fails_validation_and_terminates(
    source, provider, monkeypatch,
):
    """Exercises the PER-BATCH (media) pass's validation call — the note has
    media so `_confirm_and_resolve_batch` actually reaches `rewrite_body`.

    Plan A Task 8 (Task 6 review d): it used to leave the placeholder in place, pending,
    so every later pass re-fetched the media with no attempt counted. When even the
    final-notice body cannot be stored (this fake makes EVERY rewrite huge), the
    placeholders are removed, the note stops pending, and the loss is a named failure."""
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    rn = _rn("p1", "Oversize Target", media=[{"ref": "img-1", "kind": "image", "name": "x.png"}])
    rn.doc["content"].append({"type": "image", "attrs": {"src": "import-ref://img-1"}})
    provider.media_by_ref["img-1"] = (PNG_BYTES, "image/png")
    provider.notes_by_id = {"p1": rn}

    # Monkeypatch engine's OWN rewrite_body reference to prove ENGINE-level
    # validation catches an oversized/invalid resolved doc before writing it —
    # independent of whether real content can naturally grow past 1MB.
    huge_doc = {
        "type": "doc",
        "content": [{"type": "paragraph", "content": [{"type": "text", "text": "x" * 2_000_000}]}],
    }

    def fake_rewrite_body(doc, media_urls, id_by_key, *, strip_unresolved_links=True,
                          notices=None, resolved=None):
        return huge_doc, []

    monkeypatch.setattr(engine, "rewrite_body", fake_rewrite_body)

    result = await engine.sync_source(source["id"], full=True)

    assert result["status"] == "ok"  # a per-note validation failure never fails the whole sync
    assert result["created"] == 1
    assert any("validation" in f.lower() for f in result["failures"])

    note = notes_svc.list_notes("u1")[0]
    assert "import-ref://img-1" not in json.dumps(_body(note))
    assert json.dumps(_body(note)) != json.dumps(huge_doc)
    assert _row("u1", "fake:fake-graph/p1")["import_media_pending"] == 0
    assert _last_failures(source["id"]) == [{
        "noteTitle": "Oversize Target", "name": "x.png",
        "reason": "x.png can't be shown here"}]
    await engine.sync_source(source["id"], full=True, manual=True)
    assert provider.fetch_media_calls == ["img-1"]                      # never fetched again


async def test_oversized_resolved_link_body_fails_validation_in_the_final_pass(
    source, provider, monkeypatch,
):
    """Same backstop, but exercised via the FINAL link-resolution pass
    (`_resolve_links_final_pass`) — a separate call site with its own
    validation check. The link target ("p2") is synced in the SAME round so
    it actually resolves and the (fake) rewrite_body gets invoked."""
    provider.refs = [
        RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="p2", updated_at="2026-08-01T00:00:00+00:00"),
    ]
    rn = _rn("p1", "Oversize Link Source", links=["fake:fake-graph/p2"])
    rn.doc["content"].append({
        "type": "paragraph",
        "content": [{
            "type": "text", "text": "link",
            "marks": [{"type": "link", "attrs": {"href": "import-link://fake:fake-graph/p2"}}],
        }],
    })
    provider.notes_by_id = {"p1": rn, "p2": _rn("p2", "Target")}

    huge_doc = {
        "type": "doc",
        "content": [{"type": "paragraph", "content": [{"type": "text", "text": "x" * 2_000_000}]}],
    }

    def fake_rewrite_body(doc, media_urls, id_by_key, *, strip_unresolved_links=True,
                          notices=None, resolved=None):
        return huge_doc, []

    monkeypatch.setattr(engine, "rewrite_body", fake_rewrite_body)
    # Plan A Task 4: the link heal pass runs after the final pass and is a THIRD
    # rewrite site; without the same fake it would (correctly) heal the real link and
    # hide what this test pins. With it, its own validation backstop is exercised too.
    from api.services.journal_two.note_connectors import link_keys
    monkeypatch.setattr(link_keys, "rewrite_body", fake_rewrite_body)

    result = await engine.sync_source(source["id"], full=True)

    assert result["status"] == "ok"
    assert result["created"] == 2
    assert any("validation" in f.lower() for f in result["failures"])
    assert any(f.startswith("link heal: write failed") for f in result["failures"])

    source_note = next(n for n in notes_svc.list_notes("u1") if n["title"] == "Oversize Link Source")
    assert "import-link://" in json.dumps(_body(source_note))
    assert json.dumps(_body(source_note)) != json.dumps(huge_doc)


# Minor 7 — conflicts count surfaced in the result dict + the log row.


async def test_conflict_count_is_surfaced_in_result_and_log_row(source, provider):
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "Conflict Note", text="remote v1")}
    await engine.sync_source(source["id"], full=True)
    original = notes_svc.list_notes("u1")[0]
    notes_svc.update_note("u1", original["id"], {"title": "local edit"})

    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-05T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "Conflict Note", text="remote v2",
                                       updated_at="2026-08-05T00:00:00+00:00")}
    result = await engine.sync_source(source["id"], full=True, manual=True)

    assert result["conflicts"] == 1

    log_row = _log_rows(source["id"])[-1]
    assert log_row["conflicts"] == 1


# ---------------------------------------------------------------------------
# Round 2 review fix (2026-08-12) — cross-batch import-link:// resolution.
#
# The per-batch pipeline (Critical 3, round 1) resolved MEDIA and LINKS
# together, inside each batch's own resolve step. A link whose target landed
# in a LATER batch didn't exist yet at that point, and with
# `strip_unresolved_links` defaulting True the mark was silently DROPPED
# (not just left unresolved) — permanently, since the erased body then had
# no "import-link://" substring left for self-heal's grep to find. Fixed by
# splitting link resolution into `_resolve_links_final_pass`, run once after
# every batch (+ conflict siblings) has confirmed, using
# `strip_unresolved_links=False` so an unresolved mark always stays
# greppable until it genuinely resolves.
# ---------------------------------------------------------------------------


async def test_cross_batch_forward_link_resolves_in_the_final_pass(source, provider, monkeypatch):
    """Note A (batch 1) forward-links Note B (batch 2, confirmed AFTER A).
    Under the pre-fix per-batch design this would have permanently erased
    the link; the final pass runs after BOTH batches, so it resolves."""
    monkeypatch.setattr(engine, "_CONFIRM_BATCH_SIZE", 1)  # force A and B into separate batches

    provider.refs = [
        RemoteRef(remote_id="a", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="b", updated_at="2026-08-01T00:00:01+00:00"),
    ]
    a = _rn("a", "Note A", links=["fake:fake-graph/b"])
    a.doc["content"].append({
        "type": "paragraph",
        "content": [{
            "type": "text", "text": "link to B",
            "marks": [{"type": "link", "attrs": {"href": "import-link://fake:fake-graph/b"}}],
        }],
    })
    b = _rn("b", "Note B", updated_at="2026-08-01T00:00:01+00:00")
    provider.notes_by_id = {"a": a, "b": b}

    result = await engine.sync_source(source["id"], full=True)

    assert result["status"] == "ok"
    assert result["created"] == 2

    note_a = next(n for n in notes_svc.list_notes("u1") if n["title"] == "Note A")
    note_b = next(n for n in notes_svc.list_notes("u1") if n["title"] == "Note B")
    assert f"/journal?j2tab=notebook&note={note_b['id']}" in json.dumps(_body(note_a))
    assert "import-link://" not in json.dumps(_body(note_a))


async def test_final_pass_failure_leaves_the_mark_intact_and_self_heals_next_sync(
    source, provider, monkeypatch,
):
    """A total final-pass failure (e.g. the bulk `import_check` call itself
    raising) must not lose an otherwise-successful sync, and must never
    strip the unresolved mark — it stays intact so a later sync (here, via
    self-heal, since the remote content is unchanged) finishes the job."""
    provider.refs = [
        RemoteRef(remote_id="a", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="b", updated_at="2026-08-01T00:00:01+00:00"),
    ]
    a = _rn("a", "Note A", links=["fake:fake-graph/b"])
    a.doc["content"].append({
        "type": "paragraph",
        "content": [{
            "type": "text", "text": "link to B",
            "marks": [{"type": "link", "attrs": {"href": "import-link://fake:fake-graph/b"}}],
        }],
    })
    b = _rn("b", "Note B", updated_at="2026-08-01T00:00:01+00:00")
    provider.notes_by_id = {"a": a, "b": b}

    real_import_check = notes_svc.import_check

    def failing_import_check(*args, **kwargs):
        raise RuntimeError("simulated final-pass failure")

    monkeypatch.setattr(notes_svc, "import_check", failing_import_check)

    result = await engine.sync_source(source["id"], full=True)

    assert result["status"] == "ok"  # the safety net: an otherwise-successful sync still completes
    assert result["created"] == 2
    assert any("link resolution pass failed" in f for f in result["failures"])

    note_a = next(n for n in notes_svc.list_notes("u1") if n["title"] == "Note A")
    assert "import-link://fake:fake-graph/b" in json.dumps(_body(note_a))  # intact, not stripped

    # Restore the real import_check and re-sync with IDENTICAL remote
    # content -> "a" hashes unchanged -> marked 'skipped' by import_confirm
    # -> self-heal must still notice the stranded placeholder and finish it.
    monkeypatch.setattr(notes_svc, "import_check", real_import_check)

    provider.refs = [
        RemoteRef(remote_id="a", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="b", updated_at="2026-08-01T00:00:01+00:00"),
    ]
    provider.notes_by_id = {"a": a, "b": b}

    result2 = await engine.sync_source(source["id"], full=True, manual=True)

    assert result2["status"] == "ok"
    note_a2 = next(n for n in notes_svc.list_notes("u1") if n["title"] == "Note A")
    note_b = next(n for n in notes_svc.list_notes("u1") if n["title"] == "Note B")
    assert f"/journal?j2tab=notebook&note={note_b['id']}" in json.dumps(_body(note_a2))
    assert "import-link://" not in json.dumps(_body(note_a2))


# ---------------------------------------------------------------------------
# Task 11 MUST-RESOLVE #1: opaque-cursor mode (Dropbox-style) vs timestamp
# mode (Roam/Craft/Notion) -- both modes proven, regression-safe.
# ---------------------------------------------------------------------------

class OpaqueCursorFakeProvider(FakeProvider):
    """A provider that publishes a Dropbox-style opaque continuation cursor
    on `self.opaque_cursor` (base.py) after every `list_changed()` call --
    proves the engine takes it verbatim over the timestamp derivation."""

    def __init__(self, *, next_cursors: list[str]):
        super().__init__()
        self._next_cursors = list(next_cursors)

    async def list_changed(self, credentials, cursor=None):
        refs = await super().list_changed(credentials, cursor=cursor)
        if self._next_cursors:
            self.opaque_cursor = self._next_cursors.pop(0)
        return refs


async def test_opaque_cursor_mode_takes_precedence_over_timestamp_derivation(db, monkeypatch):
    provider = OpaqueCursorFakeProvider(next_cursors=["dbx-cursor-1", "dbx-cursor-2"])
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: provider)
    db.upsert_connector("u1", "dropbox", {"accessToken": "abc"})
    source = db.create_source("u1", "dropbox", "/team notes")

    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "First")}

    result = await engine.sync_source(source["id"], full=True)
    assert result["status"] == "ok"

    got = engine.connections.get_source_by_id(source["id"])
    assert got["cursor"] == "dbx-cursor-1"  # opaque, NOT the ref's updated_at


async def test_opaque_cursor_persists_even_on_an_empty_delta(db, monkeypatch):
    """An opaque cursor must advance UNCONDITIONALLY (unlike timestamp mode,
    which only advances on a non-empty `refs`) -- an empty incremental
    delta still needs its continuation cursor persisted, or the next call
    would fall back to a full re-list every time."""
    provider = OpaqueCursorFakeProvider(next_cursors=["dbx-cursor-1", "dbx-cursor-2"])
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: provider)
    db.upsert_connector("u1", "dropbox", {"accessToken": "abc"})
    source = db.create_source("u1", "dropbox", "/team notes")

    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "First")}
    await engine.sync_source(source["id"], full=True)

    # Second sync: raw stored cursor handed back verbatim, and an EMPTY
    # delta this time -- the opaque cursor must still advance.
    provider.refs = []
    provider.notes_by_id = {}
    result2 = await engine.sync_source(source["id"], full=False, manual=True)
    assert provider.list_changed_calls[-1] == "dbx-cursor-1"  # round-tripped raw, unadjusted
    assert result2["status"] == "ok"

    got2 = engine.connections.get_source_by_id(source["id"])
    assert got2["cursor"] == "dbx-cursor-2"  # advanced despite refs == []


async def test_timestamp_cursor_mode_unaffected_by_the_opaque_cursor_feature(source, provider):
    """Regression: plain FakeProvider never sets `opaque_cursor` (stays the
    base.py class default `None`) -- Roam/Craft/Notion's existing
    timestamp-derived cursor is completely unchanged by opaque-cursor mode."""
    assert provider.opaque_cursor is None
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "First")}
    await engine.sync_source(source["id"], full=True)
    got = engine.connections.get_source_by_id(source["id"])
    assert got["cursor"] == "2026-08-01T00:00:00+00:00"


# ---------------------------------------------------------------------------
# Task 11 MUST-RESOLVE #3: source-aware provider construction
# ---------------------------------------------------------------------------

async def test_provider_factory_receives_the_full_source_row(db, monkeypatch):
    captured: dict = {}

    def spy_factory(name, source=None):
        captured["name"] = name
        captured["source"] = source
        return FakeProvider()

    monkeypatch.setattr(engine, "_provider_factory", spy_factory)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    source = db.create_source("u1", "fake", "fake-graph")

    await engine.sync_source(source["id"], full=True)

    assert captured["name"] == "fake"
    assert captured["source"]["id"] == source["id"]
    assert captured["source"]["remoteId"] == "fake-graph"


def test_default_provider_factory_delegates_to_the_registry(monkeypatch):
    """Task 11: `_default_provider_factory` no longer hand-dispatches
    roam/craft by name -- it delegates entirely to `registry.build_provider`
    (per `providers/base.py`'s own documented contract that the engine
    "never imports a concrete provider module directly except through the
    registry")."""
    from api.services.journal_two.note_connectors import registry
    calls = []
    monkeypatch.setattr(
        registry, "build_provider",
        lambda name, source=None: (calls.append((name, source)), "SENTINEL")[1],
    )
    result = engine._default_provider_factory("notion", {"remoteId": "ws1"})
    assert result == "SENTINEL"
    assert calls == [("notion", {"remoteId": "ws1"})]


# ---------------------------------------------------------------------------
# Task 11 MUST-RESOLVE #4 + #5: list_deleted wiring into the full pass, and
# the Notion >50-row database-overflow exemption from delete detection.
# ---------------------------------------------------------------------------

async def test_list_deleted_severs_immediately_without_waiting_for_two_misses(source, provider):
    provider.refs = [
        RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="p2", updated_at="2026-08-01T00:00:00+00:00"),
    ]
    provider.notes_by_id = {
        "p1": _rn("p1", "Keeper"),
        "p2": _rn("p2", "Trashed"),
    }
    await engine.sync_source(source["id"], full=True)
    assert {r["remote_id"] for r in _remote_index_rows(source["id"])} == {"p1", "p2"}

    # Second full sync: p2 no longer appears in list_changed AND is named by
    # list_deleted -- must sever on THIS pass, not require a second miss.
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {"p1": provider.notes_by_id["p1"]}

    async def _list_deleted(credentials):
        return [RemoteRef(remote_id="p2", updated_at="2026-08-02T00:00:00+00:00")]

    provider.list_deleted = _list_deleted

    result = await engine.sync_source(source["id"], full=True, manual=True)
    assert result["status"] == "ok"
    assert result["sourceDeleted"] == 1

    notes = notes_svc.list_notes("u1")
    trashed = next(n for n in notes if n["title"] == "Trashed")
    assert "source-deleted" in trashed["tags"]
    assert {r["remote_id"] for r in _remote_index_rows(source["id"])} == {"p1"}


async def test_list_deleted_is_never_called_when_the_provider_lacks_it(source, provider):
    """Regression: FakeProvider (Roam/Craft-shaped) has no `list_deleted` --
    the generic miss-streak detector remains the ONLY signal, unchanged."""
    assert getattr(provider, "list_deleted", None) is None
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "Keeper")}
    result = await engine.sync_source(source["id"], full=True)
    assert result["status"] == "ok"
    assert result["sourceDeleted"] == 0


async def test_list_deleted_failure_falls_back_to_miss_streak_detection(source, provider):
    """A failing trash sweep (rate limit, transient, etc.) must never abort
    the sync -- the generic 2-strike detector remains the fallback signal,
    surfaced as a named, non-fatal failure."""
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "Keeper")}
    await engine.sync_source(source["id"], full=True)

    async def _boom(credentials):
        raise RuntimeError("Notion search rate limited")

    provider.list_deleted = _boom
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]

    result = await engine.sync_source(source["id"], full=True, manual=True)
    assert result["status"] == "ok"  # never aborts
    assert any("list_deleted sweep failed" in f for f in result["failures"])


async def test_overflow_row_notes_are_exempt_from_delete_detection_by_construction(source, provider):
    """MUST-RESOLVE #5: a >50-row Notion database's per-row overflow notes
    (EXTRA RemoteNotes returned by `fetch_many`, never appearing in
    `list_changed()`'s own `refs`) never enter `j2_note_remote_index` in the
    first place -- so even a (hypothetically confused) `list_deleted` signal
    naming an overflow row's remote_id can never touch it. Pinned by having
    `list_deleted` claim the overflow row IS deleted and proving nothing
    happens to it."""
    parent = _rn("parent", "Database Page")
    overflow = _rn("row-99", "Overflow Row")
    provider.refs = [RemoteRef(remote_id="parent", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {"parent": parent}

    original_fetch_many = provider.fetch_many

    async def fetch_many_with_overflow(credentials, refs):
        notes = await original_fetch_many(credentials, refs)
        return notes + [overflow]

    provider.fetch_many = fetch_many_with_overflow

    r1 = await engine.sync_source(source["id"], full=True)
    assert r1["created"] == 2
    assert {r["remote_id"] for r in _remote_index_rows(source["id"])} == {"parent"}  # overflow never tracked

    async def _list_deleted(credentials):
        return [RemoteRef(remote_id="row-99", updated_at="2026-08-02T00:00:00+00:00")]

    provider.list_deleted = _list_deleted

    r2 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r2["status"] == "ok"
    assert r2["sourceDeleted"] == 0  # nothing severed -- overflow row was never tracked

    overflow_note = next(n for n in notes_svc.list_notes("u1") if n["title"] == "Overflow Row")
    assert "source-deleted" not in overflow_note["tags"]


# ---------------------------------------------------------------------------
# Fix-round-1 Important #1a: explicit-sever blast-radius bound.
# ---------------------------------------------------------------------------

async def test_list_deleted_blast_radius_over_cap_refuses_and_falls_back_to_miss_streak(source, provider):
    """100 tracked notes; enumeration returns 60 (passes the existing <50%
    guard); a buggy `list_deleted` names the other 40 as deleted. Without
    the #1a cap this severed all 40 in one pass, permanently (tags are
    append-only). The cap (20% of prev_count) must refuse the explicit
    signal for all 40 and fall back to the ordinary 2-strike counter."""
    refs = [RemoteRef(remote_id=f"p{i}", updated_at="2026-08-01T00:00:00+00:00") for i in range(100)]
    provider.refs = refs
    provider.notes_by_id = {r.remote_id: _rn(r.remote_id, f"Note {r.remote_id}") for r in refs}
    await engine.sync_source(source["id"], full=True)
    assert len(_remote_index_rows(source["id"])) == 100

    kept = refs[:60]
    missing = refs[60:]
    provider.refs = kept
    provider.notes_by_id = {r.remote_id: provider.notes_by_id[r.remote_id] for r in kept}

    async def _list_deleted(credentials):
        return [RemoteRef(remote_id=r.remote_id, updated_at="2026-08-02T00:00:00+00:00") for r in missing]

    provider.list_deleted = _list_deleted

    _a_night_later(source["id"])
    result = await engine.sync_source(source["id"], full=True, manual=True)
    assert result["status"] == "warning"
    assert result["sourceDeleted"] == 0  # nothing severed THIS pass
    assert "explicit" in (result["deleteDetectionWarning"] or "").lower()

    notes = notes_svc.list_notes("u1")
    for r in missing:
        note = next(n for n in notes if n["title"] == f"Note {r.remote_id}")
        assert "source-deleted" not in note["tags"]

    remaining = {row["remote_id"]: row for row in _remote_index_rows(source["id"])}
    assert len(remaining) == 100  # all 100 still tracked -- nothing severed
    for r in missing:
        assert remaining[r.remote_id]["miss_streak"] == 1  # generic path still counted the miss


async def test_list_deleted_blast_radius_under_cap_still_severs_immediately(source, provider):
    """Regression: a SMALL, plausible explicit-delete set (well under the
    20% cap) must still sever immediately, unaffected by the new bound --
    this is `test_list_deleted_severs_immediately_without_waiting_for_two_
    misses` again, at a larger scale to prove the cap math (20 of 100)."""
    refs = [RemoteRef(remote_id=f"p{i}", updated_at="2026-08-01T00:00:00+00:00") for i in range(100)]
    provider.refs = refs
    provider.notes_by_id = {r.remote_id: _rn(r.remote_id, f"Note {r.remote_id}") for r in refs}
    await engine.sync_source(source["id"], full=True)

    kept = refs[:85]
    missing = refs[85:]  # 15 missing -- under the 20-item cap (20% of 100)
    provider.refs = kept
    provider.notes_by_id = {r.remote_id: provider.notes_by_id[r.remote_id] for r in kept}

    async def _list_deleted(credentials):
        return [RemoteRef(remote_id=r.remote_id, updated_at="2026-08-02T00:00:00+00:00") for r in missing]

    provider.list_deleted = _list_deleted

    result = await engine.sync_source(source["id"], full=True, manual=True)
    assert result["status"] == "ok"
    assert result["sourceDeleted"] == 15

    notes = notes_svc.list_notes("u1")
    for r in missing:
        note = next(n for n in notes if n["title"] == f"Note {r.remote_id}")
        assert "source-deleted" in note["tags"]


async def test_unrelated_two_strike_severs_still_apply_alongside_a_refused_explicit_signal(source, provider):
    """A refused explicit signal must not swallow GENUINE, unrelated 2-strike
    severs happening in the same pass -- `deleted_count` stays accurate even
    when `status == "warning"`."""
    refs = [RemoteRef(remote_id=f"p{i}", updated_at="2026-08-01T00:00:00+00:00") for i in range(100)]
    refs.append(RemoteRef(remote_id="already-missing-once", updated_at="2026-08-01T00:00:00+00:00"))
    provider.refs = refs
    provider.notes_by_id = {r.remote_id: _rn(r.remote_id, f"Note {r.remote_id}") for r in refs}
    await engine.sync_source(source["id"], full=True)

    # Round 2: "already-missing-once" goes missing for the FIRST time (bumps
    # its miss_streak to 1, not yet severed) -- everything else present.
    provider.refs = refs[:-1]
    provider.notes_by_id = {r.remote_id: provider.notes_by_id[r.remote_id] for r in refs[:-1]}
    _a_night_later(source["id"])
    r2 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r2["sourceDeleted"] == 0

    # Round 3: "already-missing-once" misses a SECOND time (real 2-strike
    # sever) WHILE a buggy list_deleted also claims 40 of the other 100 are
    # deleted (refused by the #1a cap).
    kept = refs[:60]
    over_cap_missing = refs[60:100]
    provider.refs = kept
    provider.notes_by_id = {r.remote_id: provider.notes_by_id[r.remote_id] for r in kept}

    async def _list_deleted(credentials):
        return [RemoteRef(remote_id=r.remote_id, updated_at="2026-08-03T00:00:00+00:00")
                for r in over_cap_missing]

    provider.list_deleted = _list_deleted

    _a_night_later(source["id"])
    r3 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r3["status"] == "warning"
    assert r3["sourceDeleted"] == 1  # the genuine 2-strike sever still counted
    # 101 notes exist in this test -- list_notes' default limit=100 would
    # silently truncate depending on sort-tiebreak order (Fix-round-2's own
    # timestamp-neutral tag write means a severed note no longer jumps to
    # the top of `sort="updated"` by virtue of being touched -- correctly
    # so; the test must not depend on that incidental ordering to find it).
    tagged = next(
        n for n in notes_svc.list_notes("u1", limit=200)
        if n["title"] == "Note already-missing-once"
    )
    assert "source-deleted" in tagged["tags"]


# ---------------------------------------------------------------------------
# Fix-round-1 Important #1b: un-tag heal on reappearance.
# ---------------------------------------------------------------------------

async def test_severed_note_is_untagged_when_the_remote_id_reappears(source, provider):
    """`_tag_note_source_deleted` only ever APPENDS the tag -- without a
    heal, a false-positive sever (or a genuine provider-side restore) is
    PERMANENT. When a previously-severed remote_id reappears in a listing,
    the tag comes off and tracking resumes.

    Uses 3 tracked items (p2/p3 always present) rather than 1 -- with only
    ONE tracked item, the pre-existing <50%-enumeration refuse guard fires
    on the very FIRST miss (0 seen of 1 is always <50%), so a lone item can
    never reach a genuine 2-strike sever at all; p2/p3 keep `seen_ids` at
    2-of-3 (>=50%) while p1 goes missing."""
    provider.refs = [
        RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="p2", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="p3", updated_at="2026-08-01T00:00:00+00:00"),
    ]
    provider.notes_by_id = {
        "p1": _rn("p1", "Comeback Kid"),
        "p2": _rn("p2", "Steady Two"),
        "p3": _rn("p3", "Steady Three"),
    }
    await engine.sync_source(source["id"], full=True)

    # Two consecutive full misses of p1 (p2/p3 stay present) -> generic
    # 2-strike sever.
    provider.refs = [
        RemoteRef(remote_id="p2", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="p3", updated_at="2026-08-01T00:00:00+00:00"),
    ]
    provider.notes_by_id = {"p2": provider.notes_by_id["p2"], "p3": provider.notes_by_id["p3"]}
    _a_night_later(source["id"])
    await engine.sync_source(source["id"], full=True, manual=True)
    _a_night_later(source["id"])
    r2 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r2["sourceDeleted"] == 1
    tagged = next(n for n in notes_svc.list_notes("u1") if n["title"] == "Comeback Kid")
    assert "source-deleted" in tagged["tags"]
    assert {r["remote_id"] for r in _remote_index_rows(source["id"])} == {"p2", "p3"}

    # The remote item comes BACK -- next sync must heal the tag AND
    # reinstate remote_index tracking.
    provider.refs = [
        RemoteRef(remote_id="p1", updated_at="2026-08-03T00:00:00+00:00"),
        RemoteRef(remote_id="p2", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="p3", updated_at="2026-08-01T00:00:00+00:00"),
    ]
    provider.notes_by_id["p1"] = _rn("p1", "Comeback Kid", updated_at="2026-08-03T00:00:00+00:00")
    await engine.sync_source(source["id"], full=True, manual=True)

    healed = next(n for n in notes_svc.list_notes("u1") if n["title"] == "Comeback Kid")
    assert "source-deleted" not in healed["tags"]
    assert {r["remote_id"] for r in _remote_index_rows(source["id"])} == {"p1", "p2", "p3"}


async def test_untag_heal_never_fires_for_a_note_still_continuously_tracked(source, provider):
    """Regression / non-vacuity: a note that was NEVER severed (its
    remote_index row never left) must never be touched by the heal path --
    `_touch_remote_index`'s "new to the index" check must correctly skip
    it every round."""
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "Steady")}
    await engine.sync_source(source["id"], full=True)

    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-02T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "Steady", updated_at="2026-08-02T00:00:00+00:00")}
    await engine.sync_source(source["id"], full=True, manual=True)

    note = next(n for n in notes_svc.list_notes("u1") if n["title"] == "Steady")
    assert "source-deleted" not in note["tags"]


# ---------------------------------------------------------------------------
# Fix-round-2 Important: the engine's own sever/heal tag writes must be
# timestamp-neutral, or a reappearing note gets a phantom conflict duplicate.
# ---------------------------------------------------------------------------

async def test_severed_note_reappearing_does_not_create_a_conflict_duplicate(source, provider):
    """Root cause: `_tag_note_source_deleted` (via `notes_svc.update_note`)
    used to bump `updated_at`, making `_is_conflict` (`updated_at >
    imported_at`) true FOREVER -- so a reappearing note always got
    duplicated into a "(synced copy)" conflict sibling, tags on both,
    `conflicts` == 1 on every subsequent sync. Asserts the COUNT of notes
    matching the title, not `next(...)` -- a `next()` lookup is BLIND to a
    second matching note by construction (the exact gap the reviewer found
    in the round-1 heal test, which only ever proved the ORIGINAL was
    healed and never checked whether a sibling also existed)."""
    provider.refs = [
        RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="p2", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="p3", updated_at="2026-08-01T00:00:00+00:00"),
    ]
    provider.notes_by_id = {
        "p1": _rn("p1", "Comeback Kid"),
        "p2": _rn("p2", "Steady Two"),
        "p3": _rn("p3", "Steady Three"),
    }
    await engine.sync_source(source["id"], full=True)

    # Two consecutive full misses of p1 (p2/p3 stay present) -> generic
    # 2-strike sever.
    provider.refs = [
        RemoteRef(remote_id="p2", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="p3", updated_at="2026-08-01T00:00:00+00:00"),
    ]
    provider.notes_by_id = {"p2": provider.notes_by_id["p2"], "p3": provider.notes_by_id["p3"]}
    _a_night_later(source["id"])
    await engine.sync_source(source["id"], full=True, manual=True)
    _a_night_later(source["id"])
    r2 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r2["sourceDeleted"] == 1

    # Reappears with the SAME content (no genuine user edit) -- must NOT
    # duplicate into a conflict sibling.
    provider.refs = [
        RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="p2", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="p3", updated_at="2026-08-01T00:00:00+00:00"),
    ]
    provider.notes_by_id["p1"] = _rn("p1", "Comeback Kid")
    r3 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r3["conflicts"] == 0

    matches = [n for n in notes_svc.list_notes("u1") if n["title"] == "Comeback Kid"]
    assert len(matches) == 1, (
        f"expected exactly one note titled 'Comeback Kid', got {len(matches)}: "
        f"{[m['title'] for m in notes_svc.list_notes('u1')]}"
    )
    assert "sync-conflict" not in matches[0]["tags"]
    assert "source-deleted" not in matches[0]["tags"]
    assert not any("(synced copy)" in n["title"] for n in notes_svc.list_notes("u1"))


async def test_a_genuine_user_edit_during_the_severed_window_still_conflicts_on_reappearance(
    source, provider,
):
    """The timestamp-neutral fix must be NARROW: it only silences the
    engine's OWN tag-write, never a real user edit. A genuine edit (mirrors
    what the notes UI does -- a plain `notes_svc.update_note` call, no
    `conn=` threading through the engine's neutral helper) that happens
    WHILE the note is severed must still route to a conflict sibling once
    it reappears, per spec §6."""
    provider.refs = [
        RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="p2", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="p3", updated_at="2026-08-01T00:00:00+00:00"),
    ]
    provider.notes_by_id = {
        "p1": _rn("p1", "Edited While Gone"),
        "p2": _rn("p2", "Steady Two"),
        "p3": _rn("p3", "Steady Three"),
    }
    await engine.sync_source(source["id"], full=True)

    provider.refs = [
        RemoteRef(remote_id="p2", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="p3", updated_at="2026-08-01T00:00:00+00:00"),
    ]
    provider.notes_by_id = {"p2": provider.notes_by_id["p2"], "p3": provider.notes_by_id["p3"]}
    _a_night_later(source["id"])
    await engine.sync_source(source["id"], full=True, manual=True)
    _a_night_later(source["id"])
    r2 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r2["sourceDeleted"] == 1

    # A GENUINE user edit while the note sits severed -- the real
    # notes_svc.update_note path, which DOES bump updated_at (as it must).
    original = next(n for n in notes_svc.list_notes("u1") if n["title"] == "Edited While Gone")
    notes_svc.update_note("u1", original["id"], {"title": "Edited While Gone (user touched)"})

    provider.refs = [
        RemoteRef(remote_id="p1", updated_at="2026-08-03T00:00:00+00:00"),
        RemoteRef(remote_id="p2", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="p3", updated_at="2026-08-01T00:00:00+00:00"),
    ]
    provider.notes_by_id["p1"] = _rn("p1", "Edited While Gone", updated_at="2026-08-03T00:00:00+00:00")
    r3 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r3["conflicts"] == 1

    sibling = next(n for n in notes_svc.list_notes("u1") if "(synced copy)" in n["title"])
    assert "sync-conflict" in sibling["tags"]


# ---------------------------------------------------------------------------
# Fix-round-1 Important #4: loop-agnostic per-source mutual exclusion.
# ---------------------------------------------------------------------------

def test_try_acquire_and_release_source_is_a_plain_mutex_never_loop_bound():
    """`_try_acquire_source`/`_release_source` touch no asyncio primitive at
    all -- calling them with NO running event loop at all (this is a plain
    `def` test, not `async def`) proves they carry no loop affinity by
    construction."""
    sid = "no-loop-source"
    assert engine._try_acquire_source(sid) is True
    assert engine._try_acquire_source(sid) is False  # already held
    engine._release_source(sid)
    assert engine._try_acquire_source(sid) is True
    engine._release_source(sid)


async def test_contended_sync_from_two_different_event_loops_never_raises_runtimeerror(
    source, provider, monkeypatch,
):
    """The reviewer's probe: `engine._locks` was an `asyncio.Lock` dict, so
    a SECOND contended acquire from a DIFFERENT event loop than the one
    that first acquired it raised `RuntimeError: <Lock> is bound to a
    different event loop`. Reproduces the real production shape --
    `scheduler.py`'s BackgroundScheduler jobs run each fire on a FRESH
    `asyncio.run()` loop on a worker thread, while the router's manual
    "Sync now" runs on the long-lived uvicorn loop -- via a real OS thread
    running its own `asyncio.run()`, contending on the SAME source_id as
    this test's own (pytest-asyncio) event loop. Must resolve to a clean
    "busy"/"ok" split, never a crash on either side."""
    monkeypatch.setattr(engine, "_LOCKED_RETRY_DELAYS", (0.01, 0.01, 0.01))

    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "First")}

    release_gate = threading.Event()
    entered_gate = threading.Event()
    real_list_changed = provider.list_changed

    async def blocking_list_changed(credentials, cursor=None):
        entered_gate.set()
        while not release_gate.is_set():
            await asyncio.sleep(0.01)
        return await real_list_changed(credentials, cursor=cursor)

    monkeypatch.setattr(provider, "list_changed", blocking_list_changed)

    results: dict[str, Any] = {}
    thread_errors: list[BaseException] = []

    def run_on_own_loop():
        try:
            results["first"] = asyncio.run(engine.sync_source(source["id"], manual=True))
        except BaseException as e:  # noqa: BLE001 -- must capture, never let a RuntimeError vanish on the thread
            thread_errors.append(e)

    t1 = threading.Thread(target=run_on_own_loop)
    t1.start()
    assert entered_gate.wait(timeout=5), "first sync never entered list_changed"

    # Second caller: SAME source_id, THIS test's own (different) event loop.
    second_task = asyncio.create_task(engine.sync_source(source["id"], manual=True))
    await asyncio.sleep(0.05)
    release_gate.set()
    try:
        results["second"] = await asyncio.wait_for(second_task, timeout=5)
    except BaseException as e:  # noqa: BLE001
        thread_errors.append(e)
    t1.join(timeout=5)

    assert thread_errors == [], f"cross-loop contention raised: {thread_errors!r}"
    statuses = {results["first"]["status"], results["second"]["status"]}
    assert statuses <= {"ok", "busy"}
    assert "ok" in statuses  # at least one call actually completed the sync


# ── The persisted outcome must agree with the computed one ───────────────────
# A1's fix made `sync_source` return status="warning" when a pass fetched refs
# but stored NONE of them. But `record_sync_result(ok=True)` fired BEFORE that
# was computed, so `last_sync_status` was written "ok" with a NULL error --
# and that row is what the connectors UI reads. Two authorities over one
# value: the returned dict said warning, the stored row said ok.
#
# `SourceRow.jsx` has ALWAYS had the door for this (an amber dot on
# `lastSyncStatus === 'warning'`, line 20, and `lastSyncError` rendered at
# line 95) -- the branch was simply unreachable, because nothing anywhere ever
# wrote "warning" to that column. Built, green, and unreachable.


async def test_a_pass_that_stores_nothing_persists_warning_and_why(source, provider):
    """The stored row, not just the returned dict — it is what the member sees."""
    provider.refs = [
        RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="p2", updated_at="2026-08-02T00:00:00+00:00"),
    ]
    provider.notes_by_id = {
        "p1": _rn("p1", "Trading Notes"),
        "p2": _rn("p2", "Setup Library", updated_at="2026-08-02T00:00:00+00:00"),
    }
    # Every fetch fails -> refs were seen, no note was stored: the audit's
    # "13 staged, 0 landed" shape, reduced to its essentials.
    provider.raise_on_fetch_for = {"p1", "p2"}
    provider.raise_on_fetch_many_for = {"p1", "p2"}

    result = await engine.sync_source(source["id"], full=True)
    assert result["status"] == "warning", "precondition: the pass stored nothing"
    assert result["created"] == 0 and result["updated"] == 0

    row = engine.connections.get_source_by_id(source["id"])
    assert row["lastSyncStatus"] == "warning", (
        "the stored outcome disagrees with the computed one: sync_source "
        "returned 'warning' but the source row the connectors card reads was "
        f"written {row['lastSyncStatus']!r}. SourceRow's amber-dot branch "
        "cannot fire, so the member is told this sync was fine"
    )
    assert row["lastSyncError"], (
        "nothing was persisted about WHY the pass stored nothing -- "
        "SourceRow renders lastSyncError, and a warning with no reason "
        "gives the member an amber dot and no way to act on it"
    )


async def test_a_healthy_pass_still_records_ok_and_clears_a_stale_error(source, provider):
    """The control: the warning path must not leak into the ordinary one, and
    a recovered sync must not keep showing the previous failure's reason."""
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    provider.notes_by_id = {"p1": _rn("p1", "Trading Notes")}
    provider.raise_on_fetch_for = {"p1"}
    provider.raise_on_fetch_many_for = {"p1"}
    await engine.sync_source(source["id"], full=True)
    assert engine.connections.get_source_by_id(source["id"])["lastSyncError"]

    provider.raise_on_fetch_for = set()
    provider.raise_on_fetch_many_for = set()
    result = await engine.sync_source(source["id"], full=True, manual=True)

    assert result["status"] == "ok"
    row = engine.connections.get_source_by_id(source["id"])
    assert row["lastSyncStatus"] == "ok"
    assert not row["lastSyncError"], (
        "a healthy sync left the previous failure's reason on the row -- the "
        "member keeps reading a stale error for a source that is now fine"
    )


# ── A1's PARTIAL sibling: mixed batch, real import_confirm failure ──────────
# `test_a_pass_that_stores_nothing_persists_warning_and_why` above proves the
# TOTAL-loss shape (0 of N landed -> status must not read "ok"). Nothing in
# this suite exercised the MIXED shape through a REAL `import_confirm`
# rejection (as opposed to an engine-level `raise_on_fetch_*` mock): one note
# lands, one is genuinely too large for `notes_svc._validate_body_json`'s
# >1MB backstop and is isolated into `import_confirm`'s own `failed` bucket
# (session-audit.md A1/A2's per-note SAVEPOINT). Two separate Rule-3
# properties had never been proven together at the engine level: the healthy
# sibling must not be poisoned, AND the cursor -- computed from `refs`, not
# from what actually landed -- must not advance past the note that never
# stored, even though it is chronologically the NEWER of the two.

async def test_a_real_oversized_note_is_isolated_and_holds_the_cursor_back(source, provider):
    provider.refs = [
        RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="p2", updated_at="2026-08-02T00:00:00+00:00"),
    ]
    provider.notes_by_id = {
        "p1": _rn("p1", "Fits Fine", updated_at="2026-08-01T00:00:00+00:00"),
        "p2": _rn(
            "p2", "Too Big", text="x" * 2_000_000,
            updated_at="2026-08-02T00:00:00+00:00",
        ),
    }

    result = await engine.sync_source(source["id"], full=True)

    assert result["created"] == 1, "the healthy note must land despite its oversized sibling"
    assert any("could not be stored" in f for f in result["failures"])

    titles = {n["title"] for n in notes_svc.list_notes("u1")}
    assert titles == {"Fits Fine"}, (
        "the oversized note landed (should never happen), or it took its "
        "healthy sibling down with it (the pre-SAVEPOINT 'whole batch rolls "
        "back' defect)"
    )

    row = engine.connections.get_source_by_id(source["id"])
    assert row["cursor"] is None, (
        "the cursor advanced past a note that never landed -- p2's "
        "updated_at is the newer of the two, so a naive max(refs) cursor "
        "would skip past it forever: a plain re-push of unchanged remote "
        "content is a no-op (no new hash, no new timestamp), so nothing "
        "would ever ask for p2 again"
    )


async def test_a_member_edit_survives_a_resync_of_a_note_with_an_unresolvable_link(source, provider):
    """A synced note keeps `import_media_pending` set while one of its links
    can never resolve (Notion: a mention of a page not shared with the
    integration, a database, a trashed page). `import_confirm` deliberately
    re-writes a pending note even when its hash is unchanged (audit B5, the
    media-retry path) -- so a note the MEMBER edited, whose remote side did
    not change, used to be handed to that write and lost the member's edit
    on every later sync, with conflicts == 0 and no copy kept."""
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]

    def remote():
        rn = _rn("p1", "Page One", links=["fake:fake-graph/UNSHARED"])
        rn.doc["content"].append({"type": "paragraph", "content": [{
            "type": "text", "text": "see other page",
            "marks": [{"type": "link", "attrs": {"href": "import-link://fake:fake-graph/UNSHARED"}}]}]})
        return rn

    provider.notes_by_id = {"p1": remote()}
    await engine.sync_source(source["id"], full=True)
    note = notes_svc.list_notes("u1")[0]

    notes_svc.update_note("u1", note["id"], {
        "title": "My edited title",
        "bodyJson": {"type": "doc", "content": [{"type": "paragraph", "content": [
            {"type": "text", "text": "MEMBER WROTE THIS"}]}]},
    })

    for _ in range(2):  # the defect repeated on every pass
        provider.notes_by_id = {"p1": remote()}  # remote UNCHANGED
        result = await engine.sync_source(source["id"], full=True, manual=True)
        kept = notes_svc.get_note("u1", note["id"])
        assert kept["title"] == "My edited title"
        assert "MEMBER WROTE THIS" in kept["bodyPlain"]
        assert result["updated"] == 0
        assert result["conflicts"] == 0
        assert len(notes_svc.list_notes("u1")) == 1


# ── Plan D task 2: a member caller never waits through the busy ladder ───────

async def test_a_member_sync_on_a_busy_source_returns_busy_without_sleeping(
    source, provider, monkeypatch,
):
    slept = []

    async def fake_sleep(s):
        slept.append(s)

    monkeypatch.setattr(engine.asyncio, "sleep", fake_sleep)
    assert engine._try_acquire_source(source["id"])
    try:
        r = await engine.sync_source(source["id"], member=True)
    finally:
        engine._release_source(source["id"])
    assert r == {"status": "busy", "sourceId": source["id"]}
    assert slept == []  # the ladder was not walked
    assert provider.list_changed_calls == []


async def test_a_scheduler_sync_on_a_busy_source_still_walks_the_ladder(
    source, provider, monkeypatch,
):
    slept = []

    async def fake_sleep(s):
        slept.append(s)

    monkeypatch.setattr(engine.asyncio, "sleep", fake_sleep)
    assert engine._try_acquire_source(source["id"])
    try:
        r = await engine.sync_source(source["id"])
    finally:
        engine._release_source(source["id"])
    assert r == {"status": "busy", "sourceId": source["id"]}
    assert len(slept) == len(engine._LOCKED_RETRY_DELAYS)
    assert provider.list_changed_calls == []


async def test_a_member_sync_skips_the_cooldown(source, provider):
    first = await engine.sync_source(source["id"], manual=True)
    assert first.get("status") != "busy"
    again = await engine.sync_source(source["id"], member=True)
    assert again.get("status") not in ("cooldown", "busy")


def test_is_source_busy_reflects_the_inflight_set(source):
    assert engine.is_source_busy(source["id"]) is False
    assert engine._try_acquire_source(source["id"])
    try:
        assert engine.is_source_busy(source["id"]) is True
    finally:
        engine._release_source(source["id"])
    assert engine.is_source_busy(source["id"]) is False



# ── Plan D task 3: Sync now removal check ────────────────────────────────────
#
# A member's "Sync now" with full=True runs a rate-limited removal check: a
# complete listing feeds the SAME 2-strike delete detection the nightly pass
# uses. The rate limit (MEMBER_FULL_PASS_MIN_INTERVAL_S from
# last_full_sync_at) is also what keeps two member presses inside ten minutes
# from counting as two strikes. The clock is moved with engine._utcnow.

T0 = datetime(2026, 11, 1, 15, 0, tzinfo=timezone.utc)


def _at(monkeypatch, dt):
    monkeypatch.setattr(engine, "_utcnow", lambda: dt)


def _refs(*ids, updated_at="2026-08-01T00:00:00+00:00"):
    return [RemoteRef(remote_id=i, updated_at=updated_at) for i in ids]


def _note_by_title(title):
    return next(n for n in notes_svc.list_notes("u1") if n["title"] == title)


def _set_last_full(source_id, value):
    conn = auth_db.get_connection()
    try:
        conn.execute(
            "UPDATE j2_note_sources SET last_full_sync_at = ? WHERE id = ?", (value, source_id),
        )
        conn.commit()
    finally:
        conn.close()


def _seed_abcde(provider):
    provider.refs = _refs("a", "b", "c", "d", "e")
    provider.notes_by_id = {i: _rn(i, i.upper()) for i in "abcde"}


async def _strike_one_on_e(source, provider, monkeypatch):
    """Scheduler seed at T0, then "e" disappears and a member presses at
    T0+11m: strike 1, pending 1."""
    _seed_abcde(provider)
    _at(monkeypatch, T0)
    await engine.sync_source(source["id"], full=True)
    provider.refs = _refs("a", "b", "c", "d")
    _at(monkeypatch, T0 + timedelta(minutes=11))
    r = await engine.sync_source(source["id"], full=True, member=True)
    assert r["removalCheck"]["ran"] is True
    assert r["removalCheck"]["pending"] == 1
    return r


async def test_explicit_trash_severs_on_one_member_press(source, provider, monkeypatch):
    _seed_abcde(provider)
    _at(monkeypatch, T0)
    await engine.sync_source(source["id"], full=True)            # scheduler seed
    provider.refs = _refs("a", "b", "c", "d")

    async def trash(c):
        return _refs("e")

    provider.list_deleted = trash
    _at(monkeypatch, T0 + timedelta(minutes=11))
    r = await engine.sync_source(source["id"], full=True, member=True)
    assert r["removalCheck"] == {"ran": True, "reason": None, "pending": 0, "severed": 1,
                                 "nextAllowedAt": (T0 + timedelta(minutes=21)).isoformat()}
    assert "source-deleted" in _note_by_title("E")["tags"]


async def test_an_enumeration_miss_is_strike_one_and_reported_pending(source, provider, monkeypatch):
    r = await _strike_one_on_e(source, provider, monkeypatch)
    assert r["removalCheck"] == {"ran": True, "reason": None, "pending": 1, "severed": 0,
                                 "nextAllowedAt": (T0 + timedelta(minutes=21)).isoformat()}
    assert r["sourceDeleted"] == 0
    assert "source-deleted" not in _note_by_title("E")["tags"]
    idx = {row["remote_id"]: row for row in _remote_index_rows(source["id"])}
    assert idx["e"]["miss_streak"] == 1


async def test_a_second_press_inside_ten_minutes_is_not_a_strike(source, provider, monkeypatch):
    await _strike_one_on_e(source, provider, monkeypatch)
    stored_cursor = engine.connections.get_source_by_id(source["id"])["cursor"]
    calls_before = len(provider.list_changed_calls)

    _at(monkeypatch, T0 + timedelta(minutes=16))
    r = await engine.sync_source(source["id"], full=True, member=True)
    assert r["removalCheck"]["ran"] is False and r["removalCheck"]["reason"] == "rate_limited"
    assert r["removalCheck"]["nextAllowedAt"] == (T0 + timedelta(minutes=21)).isoformat()
    assert r["removalCheck"]["pending"] == 1 and "source-deleted" not in _note_by_title("E")["tags"]
    assert r["removalCheck"]["severed"] == 0
    assert provider.list_changed_calls[-1] == stored_cursor     # downgraded to incremental, one call only
    assert len(provider.list_changed_calls) == calls_before + 1
    # the rate-limited press did not move the stamp
    assert engine.connections.get_source_by_id(source["id"])["lastFullSyncAt"] == (
        T0 + timedelta(minutes=11)).isoformat()
    idx = {row["remote_id"]: row for row in _remote_index_rows(source["id"])}
    assert idx["e"]["miss_streak"] == 1


async def test_a_second_press_after_ten_minutes_confirms_the_removal(source, provider, monkeypatch):
    await _strike_one_on_e(source, provider, monkeypatch)
    _at(monkeypatch, T0 + timedelta(minutes=22))
    r = await engine.sync_source(source["id"], full=True, member=True)
    assert r["removalCheck"]["ran"] is True and r["removalCheck"]["reason"] is None
    assert r["removalCheck"]["severed"] == 1 and r["removalCheck"]["pending"] == 0
    assert "source-deleted" in _note_by_title("E")["tags"]
    assert "e" not in {row["remote_id"] for row in _remote_index_rows(source["id"])}


async def test_a_nightly_pass_two_minutes_after_a_member_strike_is_not_strike_two(
    source, provider, monkeypatch,
):
    """The strike gap holds for EVERY pass: a scheduler full pass less than
    MEMBER_FULL_PASS_MIN_INTERVAL_S after the member's strike 1 does not
    count an enumeration miss, but still stamps last_full_sync_at."""
    await _strike_one_on_e(source, provider, monkeypatch)                 # strike 1 at T0+11m
    _at(monkeypatch, T0 + timedelta(minutes=13))
    r = await engine.sync_source(source["id"], full=True, manual=True)   # scheduler shape
    assert r["sourceDeleted"] == 0
    assert "removalCheck" not in r
    e = _note_by_title("E")
    assert "source-deleted" not in e["tags"]
    assert notes_svc.get_note("u1", e["id"]) is not None
    idx = {row["remote_id"]: row for row in _remote_index_rows(source["id"])}
    assert idx["e"]["miss_streak"] == 1
    assert engine.connections.get_source_by_id(source["id"])["lastFullSyncAt"] == (
        T0 + timedelta(minutes=13)).isoformat()


async def test_a_nightly_pass_eleven_minutes_after_a_member_strike_confirms(
    source, provider, monkeypatch,
):
    await _strike_one_on_e(source, provider, monkeypatch)                 # strike 1 at T0+11m
    _at(monkeypatch, T0 + timedelta(minutes=22))
    r = await engine.sync_source(source["id"], full=True, manual=True)   # scheduler shape
    assert r["sourceDeleted"] == 1
    assert "removalCheck" not in r
    e = _note_by_title("E")
    assert "source-deleted" in e["tags"]
    assert notes_svc.get_note("u1", e["id"]) is not None                 # never erased
    assert "e" not in {row["remote_id"] for row in _remote_index_rows(source["id"])}
    assert engine.connections.get_source_by_id(source["id"])["lastFullSyncAt"] == (
        T0 + timedelta(minutes=22)).isoformat()


async def test_an_explicit_trash_ref_inside_the_strike_gap_still_severs(
    source, provider, monkeypatch,
):
    await _strike_one_on_e(source, provider, monkeypatch)                 # strike 1 on "e" at T0+11m
    provider.refs = _refs("a", "b", "c")                                  # "d" now gone too

    async def trash(c):
        return _refs("d")

    provider.list_deleted = trash
    _at(monkeypatch, T0 + timedelta(minutes=13))
    r = await engine.sync_source(source["id"], full=True, manual=True)   # scheduler shape
    assert r["sourceDeleted"] == 1                                        # "d" only
    assert "source-deleted" in _note_by_title("D")["tags"]
    assert "source-deleted" not in _note_by_title("E")["tags"]
    idx = {row["remote_id"]: row for row in _remote_index_rows(source["id"])}
    assert "d" not in idx
    assert idx["e"]["miss_streak"] == 1


async def test_search_index_lag_never_severs_a_page_that_comes_back(source, provider, monkeypatch):
    async def lagging_trash(c):
        return []                     # Notion-shaped: the trash index has not caught up

    provider.list_deleted = lagging_trash
    r1 = await _strike_one_on_e(source, provider, monkeypatch)
    assert r1["removalCheck"]["pending"] == 1

    _at(monkeypatch, T0 + timedelta(minutes=12))
    r2 = await engine.sync_source(source["id"], full=True, member=True)
    assert r2["removalCheck"]["reason"] == "rate_limited"

    provider.refs = _refs("a", "b", "c", "d", "e")           # "e" is back in the listing
    _at(monkeypatch, T0 + timedelta(minutes=23))
    r3 = await engine.sync_source(source["id"], full=True, member=True)
    assert r3["removalCheck"]["ran"] is True and r3["removalCheck"]["pending"] == 0
    assert r3["removalCheck"]["severed"] == 0
    assert "source-deleted" not in _note_by_title("E")["tags"]
    idx = {row["remote_id"]: row for row in _remote_index_rows(source["id"])}
    assert _remote_index_rows(source["id"])  # e row present with miss_streak 0
    assert idx["e"]["miss_streak"] == 0


async def test_a_page_present_only_in_the_delta_listing_is_present(source, provider, monkeypatch):
    """The union rule: a page in EITHER listing is present. Here the full
    listing (cursor=None) lags and omits "e", but the delta listing carries it
    (it was just edited) -- "e" must not take a strike."""
    _seed_abcde(provider)
    _at(monkeypatch, T0)
    await engine.sync_source(source["id"], full=True)
    provider.refs = _refs("a", "b", "c", "d") + _refs("e", updated_at="2026-08-09T00:00:00+00:00")
    provider.notes_by_id["e"] = _rn("e", "E", text="edited", updated_at="2026-08-09T00:00:00+00:00")
    orig = provider.list_changed

    async def lagging_full_listing(creds, cursor=None):
        got = await orig(creds, cursor=cursor)
        return [r for r in got if r.remote_id != "e"] if cursor is None else got

    provider.list_changed = lagging_full_listing
    _at(monkeypatch, T0 + timedelta(minutes=11))
    r = await engine.sync_source(source["id"], full=True, member=True)
    assert r["removalCheck"]["ran"] is True and r["removalCheck"]["pending"] == 0
    idx = {row["remote_id"]: row for row in _remote_index_rows(source["id"])}
    assert idx["e"]["miss_streak"] == 0


async def test_removal_check_lists_fully_first_and_fetches_only_the_delta(source, provider, monkeypatch):
    provider.refs = _refs("a", "b")
    provider.notes_by_id = {"a": _rn("a", "A"), "b": _rn("b", "B")}
    _at(monkeypatch, T0)
    await engine.sync_source(source["id"], full=True)
    stored_cursor = engine.connections.get_source_by_id(source["id"])["cursor"]

    provider.refs = _refs("a", "b") + _refs("c", updated_at="2026-08-05T00:00:00+00:00")
    provider.notes_by_id["c"] = _rn("c", "C", updated_at="2026-08-05T00:00:00+00:00")
    provider.fetch_many_calls = []
    _at(monkeypatch, T0 + timedelta(minutes=11))
    r = await engine.sync_source(source["id"], full=True, member=True)
    assert provider.list_changed_calls[-2:] == [None, stored_cursor]
    assert {x for call in provider.fetch_many_calls for x in call} == {"c"}
    assert r["created"] == 1
    assert {row["remote_id"] for row in _remote_index_rows(source["id"])} == {"a", "b", "c"}
    # the cursor advances exactly as an incremental pass would
    assert engine.connections.get_source_by_id(source["id"])["cursor"] == "2026-08-05T00:00:00+00:00"


async def test_the_under_half_guard_still_refuses_a_member_press(source, provider, monkeypatch):
    provider.refs = _refs("0", "1", "2", "3")
    provider.notes_by_id = {str(i): _rn(str(i), f"N{i}") for i in range(4)}
    _at(monkeypatch, T0)
    await engine.sync_source(source["id"], full=True)
    before = {row["remote_id"]: row["miss_streak"] for row in _remote_index_rows(source["id"])}

    provider.refs = _refs("0")
    _at(monkeypatch, T0 + timedelta(minutes=11))
    r = await engine.sync_source(source["id"], full=True, member=True)
    assert r["removalCheck"]["ran"] is True
    assert r["removalCheck"]["reason"] == "refused"
    assert r["removalCheck"]["pending"] == 0 and r["removalCheck"]["severed"] == 0
    assert r["status"] == "warning" and r["deleteDetectionWarning"]
    after = {row["remote_id"]: row["miss_streak"] for row in _remote_index_rows(source["id"])}
    assert after == before
    # a refused check is still a check for the rate limit
    assert engine.connections.get_source_by_id(source["id"])["lastFullSyncAt"] == (
        T0 + timedelta(minutes=11)).isoformat()
    assert r["removalCheck"]["nextAllowedAt"] == (T0 + timedelta(minutes=21)).isoformat()


async def test_a_failed_enumeration_degrades_to_an_incremental_pass(source, provider, monkeypatch):
    provider.refs = _refs("a")
    provider.notes_by_id = {"a": _rn("a", "A")}
    _at(monkeypatch, T0)
    await engine.sync_source(source["id"], full=True)

    provider.refs = _refs("a") + _refs("b", updated_at="2026-08-05T00:00:00+00:00")
    provider.notes_by_id["b"] = _rn("b", "B", updated_at="2026-08-05T00:00:00+00:00")
    orig = provider.list_changed

    async def full_listing_down(creds, cursor=None):
        if cursor is None:
            provider.list_changed_calls.append(None)
            raise RuntimeError("enumeration down")
        return await orig(creds, cursor=cursor)

    provider.list_changed = full_listing_down
    _at(monkeypatch, T0 + timedelta(minutes=11))
    r = await engine.sync_source(source["id"], full=True, member=True)
    assert r["status"] == "ok"
    assert r["removalCheck"]["ran"] is False
    assert r["removalCheck"]["reason"] == "enumeration_failed"
    assert r["removalCheck"]["severed"] == 0 and r["removalCheck"]["pending"] == 0
    assert r["removalCheck"]["nextAllowedAt"] is None    # T0+10m is already past: allowed now
    assert any("enumeration down" in f for f in r["failures"])
    assert r["created"] == 1 and _note_by_title("B")         # delta still imported
    assert engine.connections.get_source_by_id(source["id"])["lastFullSyncAt"] == T0.isoformat()


async def test_removal_check_on_an_empty_index_is_a_quiet_no_op(source, provider, monkeypatch):
    provider.refs = _refs("a")
    provider.notes_by_id = {"a": _rn("a", "A")}
    _at(monkeypatch, T0)
    r = await engine.sync_source(source["id"], full=True, member=True)   # first-ever call
    assert r["status"] == "ok"
    assert r["deleteDetectionWarning"] is None
    assert r["removalCheck"] == {"ran": True, "reason": None, "pending": 0, "severed": 0,
                                 "nextAllowedAt": (T0 + timedelta(minutes=10)).isoformat()}


async def test_removal_check_on_an_empty_remote_and_empty_index_is_quiet(source, provider, monkeypatch):
    _at(monkeypatch, T0)
    r = await engine.sync_source(source["id"], full=True, member=True)
    assert r["status"] == "ok" and r["deleteDetectionWarning"] is None
    assert r["removalCheck"]["ran"] is True and r["removalCheck"]["reason"] is None
    assert r["removalCheck"]["pending"] == 0


async def test_an_unreadable_or_future_last_full_stamp_never_locks_the_member_out(
    source, provider, monkeypatch,
):
    provider.refs = _refs("a")
    provider.notes_by_id = {"a": _rn("a", "A")}
    _at(monkeypatch, T0)
    for stamp in ("garbage", (T0 + timedelta(hours=2)).isoformat(), "2026-11-01T14:49:00"):
        _set_last_full(source["id"], stamp)
        r = await engine.sync_source(source["id"], full=True, member=True)
        assert r["removalCheck"]["ran"] is True, stamp
        assert r["removalCheck"]["reason"] is None, stamp
        assert engine.connections.get_source_by_id(source["id"])["lastFullSyncAt"] == T0.isoformat()
    # ...but a stamp within the 60 s skew allowance still counts as a recent pass
    _set_last_full(source["id"], (T0 + timedelta(seconds=30)).isoformat())
    r = await engine.sync_source(source["id"], full=True, member=True)
    assert r["removalCheck"]["reason"] == "rate_limited"


async def test_a_pending_note_that_reappears_incrementally_heals_and_leaves_the_count(
    source, provider, monkeypatch, db,
):
    await _strike_one_on_e(source, provider, monkeypatch)
    assert db.pending_removal_counts("u1", [source["id"]]) == {source["id"]: 1}

    provider.refs = _refs("a", "b", "c", "d") + _refs("e", updated_at="2026-08-09T00:00:00+00:00")
    provider.notes_by_id["e"] = _rn("e", "E", text="edited", updated_at="2026-08-09T00:00:00+00:00")
    _at(monkeypatch, T0 + timedelta(minutes=12))
    r = await engine.sync_source(source["id"], manual=True)          # plain incremental
    assert "removalCheck" not in r
    assert db.pending_removal_counts("u1", [source["id"]]) == {}
    assert "source-deleted" not in _note_by_title("E")["tags"]
    idx = {row["remote_id"]: row for row in _remote_index_rows(source["id"])}
    assert idx["e"]["miss_streak"] == 0


async def test_every_full_pass_stamps_last_full_sync_at(source, provider, monkeypatch):
    provider.refs = _refs("a")
    provider.notes_by_id = {"a": _rn("a", "A")}
    _at(monkeypatch, T0)
    await engine.sync_source(source["id"], full=True)
    assert engine.connections.get_source_by_id(source["id"])["lastFullSyncAt"] == T0.isoformat()
    # an incremental pass (scheduler or member) never stamps it
    _at(monkeypatch, T0 + timedelta(minutes=30))
    await engine.sync_source(source["id"], manual=True)
    await engine.sync_source(source["id"], member=True)
    assert engine.connections.get_source_by_id(source["id"])["lastFullSyncAt"] == T0.isoformat()


async def test_a_member_incremental_press_carries_no_removal_check(source, provider, monkeypatch):
    _at(monkeypatch, T0)
    r = await engine.sync_source(source["id"], member=True)
    assert "removalCheck" not in r


# ── Plan A Task 4: pending means "something can still resolve"; links heal later ──
#
# `import_media_pending` answers MEDIA only now (`import-ref://`); a link that cannot
# resolve yet is `import_links_pending`, and it is the heal pass (link_keys.py), not a
# re-import, that finishes it when the target arrives. Every heal write goes through
# `engine._apply_resolved_body`: timestamp-neutral, optimistic-locked, projected.

def _row(user_id, import_key):
    conn = auth_db.get_connection()
    try:
        return dict(conn.execute(
            "SELECT * FROM j2_notes WHERE user_id = ? AND import_key = ?", (user_id, import_key),
        ).fetchone())
    finally:
        conn.close()


def _link_para(key, text="see other page"):
    return {"type": "paragraph", "content": [{
        "type": "text", "text": text,
        "marks": [{"type": "link", "attrs": {"href": f"import-link://{key}"}}]}]}


def _links_of(note_id):
    conn = auth_db.get_connection()
    try:
        return [r["target_note_id"] for r in conn.execute(
            "SELECT target_note_id FROM j2_note_links WHERE note_id = ? ORDER BY position", (note_id,))]
    finally:
        conn.close()


async def test_unresolvable_link_does_not_reimport_or_redownload(source, provider):
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]

    def remote():
        rn = _rn("p1", "Page One", links=["fake:fake-graph/UNSHARED"],
                 media=[{"ref": "img-1", "kind": "image", "name": "chart.png"}])
        rn.doc["content"].append(_link_para("fake:fake-graph/UNSHARED"))
        rn.doc["content"].append({"type": "image", "attrs": {"src": "import-ref://img-1"}})
        return rn

    provider.notes_by_id = {"p1": remote()}
    provider.media_by_ref["img-1"] = (PNG_BYTES, "image/png")
    r1 = await engine.sync_source(source["id"], full=True)
    assert r1["created"] == 1
    calls = len(provider.fetch_media_calls)

    provider.notes_by_id = {"p1": remote()}  # remote UNCHANGED
    r2 = await engine.sync_source(source["id"], full=True, manual=True)
    assert (r2["updated"], r2["skipped"]) == (0, 1)
    assert len(provider.fetch_media_calls) == calls
    row = _row("u1", "fake:fake-graph/p1")
    assert (row["import_media_pending"], row["import_links_pending"]) == (0, 1)


async def test_link_heals_when_its_target_arrives_later_without_reimport(source, provider):
    p1_ref = RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")
    provider.refs = [p1_ref]
    p1 = _rn("p1", "Page One", links=["fake:fake-graph/p2"])
    p1.doc["content"].append(_link_para("fake:fake-graph/p2", "Setup Library"))
    provider.notes_by_id = {"p1": p1}
    await engine.sync_source(source["id"], full=True)
    p1_row = _row("u1", "fake:fake-graph/p1")
    p1_id = p1_row["id"]
    assert p1_row["import_links_pending"] == 1
    before_updated_at = notes_svc.get_note("u1", p1_id)["updatedAt"]

    # sync 2 (incremental): only p2 is new; p1 is never re-fetched or re-confirmed
    provider.refs = [p1_ref, RemoteRef(remote_id="p2", updated_at="2026-08-02T00:00:00+00:00")]
    provider.notes_by_id = {"p1": p1, "p2": _rn("p2", "Setup Library",
                                                  updated_at="2026-08-02T00:00:00+00:00")}
    fetched_before = len(provider.fetch_calls) + sum(len(c) for c in provider.fetch_many_calls)
    r2 = await engine.sync_source(source["id"], manual=True)
    assert (r2["created"], r2["updated"]) == (1, 0)
    fetched = provider.fetch_calls + [i for c in provider.fetch_many_calls for i in c]
    assert fetched[fetched_before:] == ["p2"]

    p2_id = _row("u1", "fake:fake-graph/p2")["id"]
    assert "/journal?j2tab=notebook&note=" + p2_id in json.dumps(notes_svc.get_note("u1", p1_id)["bodyJson"])
    assert _row("u1", "fake:fake-graph/p1")["import_links_pending"] == 0
    assert notes_svc.get_note("u1", p1_id)["updatedAt"] == before_updated_at
    # controller ruling 4: the healed link reached the projection (backlinks / graph)
    assert _links_of(p1_id) == [p2_id]


async def test_heal_never_touches_a_member_edited_note(source, provider):
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    p1 = _rn("p1", "Page One", links=["fake:fake-graph/p2"])
    p1.doc["content"].append(_link_para("fake:fake-graph/p2"))
    provider.notes_by_id = {"p1": p1}
    await engine.sync_source(source["id"], full=True)
    p1_id = _row("u1", "fake:fake-graph/p1")["id"]

    # the member edits the note but keeps the (still unresolved) link
    edited = {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "MEMBER WROTE THIS"}]},
        _link_para("fake:fake-graph/p2")]}
    notes_svc.update_note("u1", p1_id, {"bodyJson": edited})
    member_body = notes_svc.get_note("u1", p1_id)["bodyJson"]
    member_updated_at = notes_svc.get_note("u1", p1_id)["updatedAt"]

    provider.refs.append(RemoteRef(remote_id="p2", updated_at="2026-08-02T00:00:00+00:00"))
    provider.notes_by_id["p2"] = _rn("p2", "Target", updated_at="2026-08-02T00:00:00+00:00")
    await engine.sync_source(source["id"], manual=True)

    kept = notes_svc.get_note("u1", p1_id)
    assert kept["bodyJson"] == member_body
    assert kept["updatedAt"] == member_updated_at


# ---------------------------------------------------------------------------
# Plan A Task 6 (spec I-7): failed media is visible and retried, bounded
# ---------------------------------------------------------------------------

_IMG = "https://cdn.example.com/a.png"
_IMG_KEY = "fake:fake-graph/p1"


def _image_note(provider, *refs, failing=None):
    """One remote page, "Chart page", carrying an image placeholder per ref. Every ref in
    `failing` (default: all) raises from `fetch_media`."""
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    refs = refs or (_IMG,)
    rn = _rn("p1", "Chart page", media=[
        {"ref": r, "kind": "image", "name": r.rsplit("/", 1)[-1]} for r in refs])
    for r in refs:
        rn.doc["content"].append({"type": "image", "attrs": {"src": f"import-ref://{r}"}})
    provider.notes_by_id = {"p1": rn}
    provider.raise_on_fetch_media_for = set(refs if failing is None else failing)
    return rn


def _nodes_of(body, node_type):
    out, stack = [], [body]
    while stack:
        node = stack.pop()
        if isinstance(node, dict):
            if node.get("type") == node_type:
                out.append(node)
            stack.extend(node.get("content") or [])
    return out


def _only(body, node_type):
    found = _nodes_of(body, node_type)
    assert len(found) == 1, (node_type, body)
    return found[0]


def _last_failures(source_id):
    raw = _log_rows(source_id)[-1]["failures_json"]
    return None if raw is None else json.loads(raw)


async def test_failed_image_leaves_a_visible_notice_and_stays_pending(source, provider):
    _image_note(provider)
    r1 = await engine.sync_source(source["id"], full=True)

    assert r1["status"] == "ok" and r1["created"] == 1 and r1["mediaUploaded"] == 0
    body = _body(notes_svc.list_notes("u1")[0])
    assert _nodes_of(body, "image") == []
    notice = _only(body, "importNotice")
    assert notice["attrs"] == {"reason": "fetch_failed", "name": "a.png",
                               "sourceUrl": _IMG, "ref": _IMG, "attempts": 1}
    assert _row("u1", _IMG_KEY)["import_media_pending"] == 1
    assert _last_failures(source["id"]) == [
        {"noteTitle": "Chart page", "reason": "Couldn't copy a.png — retrying on the next sync",
         "name": "a.png"}]
    # the `_do_sync` result's own `failures` list is unchanged in shape: plain strings
    assert any(_IMG in f for f in r1["failures"])
    assert all(isinstance(f, str) for f in r1["failures"])


async def test_clean_pass_writes_null_failures_json(source, provider):
    _image_note(provider, failing=())
    provider.media_by_ref[_IMG] = (PNG_BYTES, "image/png")
    r1 = await engine.sync_source(source["id"], full=True)
    assert r1["mediaUploaded"] == 1
    assert _log_rows(source["id"])[-1]["failures_json"] is None
    assert _row("u1", _IMG_KEY)["import_media_pending"] == 0


async def test_retry_replaces_the_notice_with_the_image(source, provider):
    _image_note(provider)
    await engine.sync_source(source["id"], full=True)
    assert _row("u1", _IMG_KEY)["import_media_pending"] == 1

    provider.raise_on_fetch_media_for = set()
    provider.media_by_ref[_IMG] = (PNG_BYTES, "image/png")
    r2 = await engine.sync_source(source["id"], full=True, manual=True)

    assert r2["mediaUploaded"] == 1
    body = _body(notes_svc.list_notes("u1")[0])
    assert _nodes_of(body, "importNotice") == []
    assert _only(body, "image")["attrs"]["src"].startswith("/api/j2/notes/attachments/u1/")
    assert _row("u1", _IMG_KEY)["import_media_pending"] == 0
    assert provider.fetch_media_calls == [_IMG, _IMG]
    assert _last_failures(source["id"]) is None


async def test_retry_stops_after_max_attempts_with_a_final_notice(source, provider):
    from api.services.journal_two.import_notice import MEDIA_RETRY_MAX_ATTEMPTS
    _image_note(provider)
    for n in range(1, MEDIA_RETRY_MAX_ATTEMPTS + 1):
        await engine.sync_source(source["id"], full=True, manual=True)
        notice = _only(_body(notes_svc.list_notes("u1")[0]), "importNotice")
        assert notice["attrs"]["attempts"] == n
    assert len(provider.fetch_media_calls) == MEDIA_RETRY_MAX_ATTEMPTS
    # final: no longer pending, and the sentence no longer promises a retry
    assert _row("u1", _IMG_KEY)["import_media_pending"] == 0
    assert _last_failures(source["id"]) == [
        {"noteTitle": "Chart page", "reason": "Couldn't copy a.png", "name": "a.png"}]

    r4 = await engine.sync_source(source["id"], full=True, manual=True)
    assert len(provider.fetch_media_calls) == MEDIA_RETRY_MAX_ATTEMPTS  # never fetched again
    assert r4["skipped"] == 1
    assert _only(_body(notes_svc.list_notes("u1")[0]), "importNotice")["attrs"]["attempts"] == 3
    assert _last_failures(source["id"]) is None  # nothing was written this pass


async def test_a_maxed_ref_is_not_fetched_while_a_sibling_ref_keeps_the_note_pending(
        source, provider):
    a, b = _IMG, "https://cdn.example.com/b.png"
    _image_note(provider, a)                                            # a:1
    await engine.sync_source(source["id"], full=True)
    # The remote page gains b (a real change, so the whole note re-imports). Plan A Task 8
    # fix round 1 (I4): a ref that already RESOLVED is never fetched again on a retry, so
    # the sibling that keeps the note pending has to be one that is still failing.
    _image_note(provider, a, b)
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-02T00:00:00+00:00")]
    provider.notes_by_id["p1"].updated_at = "2026-08-02T00:00:00+00:00"
    for _ in range(2):
        await engine.sync_source(source["id"], full=True, manual=True)  # a:2,3  b:1,2
    assert _row("u1", _IMG_KEY)["import_media_pending"] == 1             # b still retryable
    assert provider.fetch_media_calls.count(a) == 3

    await engine.sync_source(source["id"], full=True, manual=True)
    assert provider.fetch_media_calls.count(a) == 3                     # a is done trying
    by_ref = {n["attrs"]["ref"]: n["attrs"] for n in
              _nodes_of(_body(notes_svc.list_notes("u1")[0]), "importNotice")}
    assert by_ref[a]["reason"] == "fetch_failed" and by_ref[a]["attempts"] == 3
    assert by_ref[b]["attempts"] == 3
    assert _row("u1", _IMG_KEY)["import_media_pending"] == 0


async def test_retry_bookkeeping_never_moves_updated_at(source, provider):
    _image_note(provider)
    await engine.sync_source(source["id"], full=True)
    note_id = _row("u1", _IMG_KEY)["id"]
    first = notes_svc.get_note("u1", note_id)["updatedAt"]
    for _ in range(2):
        await engine.sync_source(source["id"], full=True, manual=True)
        assert notes_svc.get_note("u1", note_id)["updatedAt"] == first
    # and the retries never read as a member edit: no conflict copy, no conflict count
    assert len(notes_svc.list_notes("u1")) == 1
    assert _log_rows(source["id"])[-1]["conflicts"] == 0


async def test_edited_note_with_failed_media_is_left_alone(source, provider):
    _image_note(provider)
    await engine.sync_source(source["id"], full=True)
    note_id = _row("u1", _IMG_KEY)["id"]
    notes_svc.update_note("u1", note_id, {"title": "Chart page (mine)"})
    member = notes_svc.get_note("u1", note_id)

    provider.raise_on_fetch_media_for = set()
    provider.media_by_ref[_IMG] = (PNG_BYTES, "image/png")
    await engine.sync_source(source["id"], full=True, manual=True)

    kept = notes_svc.get_note("u1", note_id)
    assert kept["bodyJson"] == member["bodyJson"]   # the notice stays; no retry write
    assert kept["updatedAt"] == member["updatedAt"]
    assert kept["title"] == "Chart page (mine)"
    assert provider.fetch_media_calls == [_IMG]


async def test_storage_limit_waits_without_re_importing_every_pass(source, provider, monkeypatch):
    from api.services.journal_two.notes_quota import NoteQuotaExceeded

    def full(_n):
        raise NoteQuotaExceeded("over the notebook storage limit")

    monkeypatch.setattr(notes_svc, "assert_import_headroom", full)
    _image_note(provider, failing=())
    provider.media_by_ref[_IMG] = (PNG_BYTES, "image/png")
    await engine.sync_source(source["id"], full=True)

    notice = _only(_body(notes_svc.list_notes("u1")[0]), "importNotice")
    assert notice["attrs"]["reason"] == "storage_limit"
    assert _row("u1", _IMG_KEY)["import_media_pending"] == 2
    assert _last_failures(source["id"]) == [{
        "noteTitle": "Chart page", "name": "a.png",
        "reason": "Not copied: storage limit. a.png will be copied once space frees up"}]

    r2 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r2["skipped"] == 1 and r2["updated"] == 0     # waiting is not a re-import
    assert provider.fetch_media_calls == [_IMG]


def test_notice_for_exception_maps_each_failure_to_its_reason():
    from api.services.journal_two.notes_quota import NoteQuotaExceeded

    def reason(exc):
        n = engine._notice_for_exception(exc, ref="r", name="a.png", source_url=None, attempts=1)
        assert n["type"] == "importNotice" and n["attrs"]["ref"] == "r"
        return n["attrs"]["reason"]

    assert reason(errors.NoteConnTransient("503")) == "fetch_failed"
    assert reason(RuntimeError("boom")) == "fetch_failed"
    # Plan A Task 8: the TYPE decides, never the words.
    assert reason(errors.NoteConnUnsafeAddress("x", reason="anything at all")) == "unsafe"
    assert reason(errors.NoteConnUnsupported(
        "x", reason="Media reference points at a private/internal network address")) == "unsupported"
    assert reason(errors.NoteConnTooLarge("x", reason="too big")) == "too_large"
    assert reason(media_policy.MediaRejected("storage_limit", "s")) == "storage_limit"
    assert reason(errors.NoteConnUnsupported("x", reason="encoding not read")) == "unsupported"
    assert reason(notes_svc.NoteValidationError("Only PNG/JPG/GIF/WebP images allowed")) == "unsupported"
    try:
        raise notes_svc.NoteValidationError("full") from NoteQuotaExceeded("full")
    except notes_svc.NoteValidationError as e:
        assert reason(e) == "storage_limit"


async def test_a_placeholder_with_no_media_entry_still_leaves_a_notice(source, provider):
    """No silent drop: a placeholder the provider never listed in `media` cannot be fetched,
    so it becomes a final notice instead of vanishing."""
    rn = _image_note(provider, failing=())
    provider.media_by_ref[_IMG] = (PNG_BYTES, "image/png")
    rn.doc["content"].append({"type": "image", "attrs": {"src": "import-ref://orphan.png"}})
    await engine.sync_source(source["id"], full=True)
    body = _body(notes_svc.list_notes("u1")[0])
    assert len(_nodes_of(body, "image")) == 1
    notice = _only(body, "importNotice")
    assert notice["attrs"]["ref"] == "orphan.png"
    assert notice["attrs"]["reason"] == "unsupported"
    assert _row("u1", _IMG_KEY)["import_media_pending"] == 0


# ---------------------------------------------------------------------------
# Plan A Task 8: every stored file goes through the ONE media policy
# ---------------------------------------------------------------------------

from api.services.journal_two import media_policy  # noqa: E402

_IMGS = tuple(f"https://cdn.example.com/{c}.png" for c in "abc")


def _media_cap(monkeypatch, nbytes):
    monkeypatch.setattr(media_policy, "MEMBER_IMPORT_MEDIA_CAP_BYTES", nbytes)


async def test_cap_reached_mid_note_imports_the_note_and_marks_the_rest(source, provider, monkeypatch):
    media_policy._USAGE_MEMO.clear()
    _media_cap(monkeypatch, len(PNG_BYTES) * 2)
    _image_note(provider, *_IMGS, failing=())
    for ref in _IMGS:
        provider.media_by_ref[ref] = (PNG_BYTES, "image/png")

    result = await engine.sync_source(source["id"], full=True)

    assert result["status"] == "ok" and result["created"] == 1          # the note still imports
    body = _body(notes_svc.list_notes("u1")[0])
    assert len(_nodes_of(body, "image")) == 2
    notice = _only(body, "importNotice")
    assert (notice["attrs"]["reason"], notice["attrs"]["ref"]) == ("storage_limit", _IMGS[2])
    assert _row("u1", _IMG_KEY)["import_media_pending"] == 2
    assert _last_failures(source["id"]) == [{
        "noteTitle": "Chart page", "name": "c.png",
        "reason": "Not copied: storage limit. c.png will be copied once space frees up"}]


async def test_storage_wait_retries_once_space_frees(source, provider, monkeypatch):
    media_policy._USAGE_MEMO.clear()
    _media_cap(monkeypatch, len(PNG_BYTES) * 2)
    _image_note(provider, *_IMGS, failing=())
    for ref in _IMGS:
        provider.media_by_ref[ref] = (PNG_BYTES, "image/png")
    await engine.sync_source(source["id"], full=True)
    assert _row("u1", _IMG_KEY)["import_media_pending"] == 2
    note_id = _row("u1", _IMG_KEY)["id"]
    stamped = notes_svc.get_note("u1", note_id)["updatedAt"]

    # still full: waiting is not a re-import, and nothing is fetched again
    r2 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r2["skipped"] == 1 and r2["updated"] == 0
    assert len(provider.fetch_media_calls) == 3
    assert _row("u1", _IMG_KEY)["import_media_pending"] == 2

    # space frees -> the waiting note comes back on the next pass
    _media_cap(monkeypatch, 10 * 1024 * 1024)
    stored_srcs = [n["attrs"]["src"] for n in _nodes_of(_body(notes_svc.get_note("u1", note_id)), "image")]
    await engine.sync_source(source["id"], full=True, manual=True)
    # fix round 1 (I4): ONLY the missing item is fetched; the two already stored are reused
    assert provider.fetch_media_calls == [*_IMGS, _IMGS[2]]
    body = _body(notes_svc.get_note("u1", note_id))
    assert len(_nodes_of(body, "image")) == 3
    assert [n["attrs"]["src"] for n in _nodes_of(body, "image")][:2] == stored_srcs
    assert _nodes_of(body, "importNotice") == []
    assert _row("u1", _IMG_KEY)["import_media_pending"] == 0
    assert notes_svc.get_note("u1", note_id)["updatedAt"] == stamped     # timestamp-neutral


async def test_a_retry_never_stores_an_already_resolved_file_twice(source, provider, monkeypatch, tmp_path):
    """I4: a file chip that resolved stays; its uuid-named file is not written again (an
    orphan the cap would count) when a sibling's storage wait retries."""
    media_policy._USAGE_MEMO.clear()
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    rn = _rn("p1", "Chart page", media=[
        {"ref": "f.csv", "kind": "file", "name": "f.csv"},
        {"ref": _IMG, "kind": "image", "name": "a.png"}])
    rn.doc["content"] += [{"type": "attachmentChip", "attrs": {"href": "import-ref://f.csv", "name": "f.csv"}},
                          {"type": "image", "attrs": {"src": f"import-ref://{_IMG}"}}]
    provider.notes_by_id = {"p1": rn}
    provider.media_by_ref.update({"f.csv": (b"a,b,c", "text/csv"), _IMG: (PNG_BYTES, "image/png")})
    _media_cap(monkeypatch, 5)
    await engine.sync_source(source["id"], full=True)
    assert _row("u1", _IMG_KEY)["import_media_pending"] == 2
    _media_cap(monkeypatch, 10 * 1024 * 1024)
    await engine.sync_source(source["id"], full=True, manual=True)
    files = [p for p in (tmp_path / "att").rglob("*") if p.is_file()]
    assert sorted(p.suffix for p in files) == [".csv", ".png"]          # one each, no orphan
    assert provider.fetch_media_calls == ["f.csv", _IMG, _IMG]


async def test_a_connector_file_chip_is_never_decoded(source, provider):
    """I5: an item the provider lists as a file keeps the bytes, even a corrupt image."""
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    broken = b"\x89PNG\r\n\x1a\n" + b"corrupt" * 10
    rn = _rn("p1", "Chart page", media=[{"ref": "b.png", "kind": "file", "name": "b.png"}])
    rn.doc["content"].append({"type": "attachmentChip", "attrs": {"href": "import-ref://b.png", "name": "b.png"}})
    provider.notes_by_id = {"p1": rn}
    provider.media_by_ref["b.png"] = (broken, "image/png")
    await engine.sync_source(source["id"], full=True)
    body = _body(notes_svc.list_notes("u1")[0])
    assert _nodes_of(body, "importNotice") == []
    assert _only(body, "attachmentChip")["attrs"]["size"] == len(broken)


async def test_the_policy_work_runs_off_the_event_loop(source, provider, monkeypatch):
    """I2: a manual "Sync now" runs on the uvicorn loop; the decode/store must not."""
    import threading
    loop_thread = threading.get_ident()
    seen = []
    real = media_policy.store_media

    def spy(*a, **k):
        seen.append(threading.get_ident())
        return real(*a, **k)

    monkeypatch.setattr(media_policy, "store_media", spy)
    _image_note(provider, failing=())
    provider.media_by_ref[_IMG] = (PNG_BYTES, "image/png")
    await engine.sync_source(source["id"], full=True)
    assert seen and all(t != loop_thread for t in seen)


def test_the_storage_wait_flip_is_member_scoped_and_timestamp_neutral(db):
    conn = auth_db.get_connection()
    try:
        for nid, uid in (("n1", "u1"), ("n2", "u2")):
            conn.execute(
                "INSERT INTO j2_notes (id, user_id, title, body_json, created_at, updated_at, "
                "import_media_pending) VALUES (?, ?, 't', '{}', '2026-01-01', '2026-01-01', 2)",
                (nid, uid))
        conn.commit()
        assert engine._flip_storage_waits(conn, "u1") == 1
        rows = {r["id"]: (r["import_media_pending"], r["updated_at"]) for r in
                conn.execute("SELECT id, import_media_pending, updated_at FROM j2_notes")}
    finally:
        conn.close()
    assert rows == {"n1": (1, "2026-01-01"), "n2": (2, "2026-01-01")}


async def test_an_image_over_the_size_limit_reads_too_large(source, provider, monkeypatch):
    """Task 6 review (b): an oversize image is the policy's `too_large`, never `unsupported`."""
    monkeypatch.setattr(media_policy, "MEDIA_SOURCE_MAX_BYTES", len(PNG_BYTES) - 1)
    _image_note(provider, failing=())
    provider.media_by_ref[_IMG] = (PNG_BYTES, "image/png")
    await engine.sync_source(source["id"], full=True)
    notice = _only(_body(notes_svc.list_notes("u1")[0]), "importNotice")
    assert notice["attrs"]["reason"] == "too_large" and notice["attrs"]["attempts"] == 0
    assert _row("u1", _IMG_KEY)["import_media_pending"] == 0


async def test_a_download_refused_for_its_size_reads_too_large(source, provider, monkeypatch):
    _image_note(provider, failing=())

    async def too_big(_creds, ref):
        raise errors.NoteConnTooLarge("x", reason="Media reference is larger than the allowed size limit")

    monkeypatch.setattr(provider, "fetch_media", too_big)
    await engine.sync_source(source["id"], full=True)
    assert _only(_body(notes_svc.list_notes("u1")[0]), "importNotice")["attrs"]["reason"] == "too_large"


async def test_bomb_and_disguised_html_from_a_connector_are_notices_never_stored(source, provider, tmp_path):
    _image_note(provider, *_IMGS[:2], failing=())
    provider.media_by_ref[_IMGS[0]] = (b"<!DOCTYPE html><html><script>x()</script></html>", "image/png")
    from api.services.journal_two.test_media_policy import _bomb_tiff
    provider.media_by_ref[_IMGS[1]] = (_bomb_tiff(), "image/tiff")
    result = await engine.sync_source(source["id"], full=True)
    assert result["status"] == "ok"
    notices = {n["attrs"]["ref"]: n["attrs"]["reason"] for n in
               _nodes_of(_body(notes_svc.list_notes("u1")[0]), "importNotice")}
    assert notices == {_IMGS[0]: "unsupported", _IMGS[1]: "too_large"}
    stored = [p for p in (tmp_path / "att").rglob("*") if p.is_file()] if (tmp_path / "att").exists() else []
    assert stored == []


async def test_a_placeholder_chip_keeps_chip_intent_for_an_image_and_svg_is_never_inline(source, provider):
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    rn = _rn("p1", "Chart page", media=[
        {"ref": "s.svg", "kind": "image", "name": "logo.svg"},
        {"ref": "p.png", "kind": "file", "name": "shot.png"}])
    rn.doc["content"] += [{"type": "image", "attrs": {"src": "import-ref://s.svg"}},
                          {"type": "attachmentChip", "attrs": {"href": "import-ref://p.png", "name": "shot.png"}}]
    provider.notes_by_id = {"p1": rn}
    provider.media_by_ref.update({"s.svg": (svg, "image/svg+xml"), "p.png": (PNG_BYTES, "image/png")})
    await engine.sync_source(source["id"], full=True)
    body = _body(notes_svc.list_notes("u1")[0])
    assert _nodes_of(body, "image") == []
    chips = {c["attrs"]["name"]: c["attrs"] for c in _nodes_of(body, "attachmentChip")}
    assert chips["logo.svg"]["href"].endswith(".svg") and "/file/" in chips["logo.svg"]["href"]
    assert chips["shot.png"]["href"].endswith(".png") and "/file/" in chips["shot.png"]["href"]
    assert chips["shot.png"]["size"] == len(PNG_BYTES)


async def test_unsafe_is_the_guards_type_never_the_wording(source, provider, monkeypatch):
    """Task 6 review (c)+(e): a provider's own 'private page' refusal reads unsupported; only the
    SSRF guard's TYPE reads unsafe."""
    _image_note(provider, *_IMGS[:2], failing=())

    async def refuse(_creds, ref):
        if ref == _IMGS[0]:
            raise errors.NoteConnUnsupported("x", reason="This is a private page you cannot share")
        raise errors.NoteConnUnsafeAddress("x", reason="Media reference was refused")

    monkeypatch.setattr(provider, "fetch_media", refuse)
    await engine.sync_source(source["id"], full=True)
    reasons = {n["attrs"]["ref"]: n["attrs"]["reason"] for n in
               _nodes_of(_body(notes_svc.list_notes("u1")[0]), "importNotice")}
    assert reasons == {_IMGS[0]: "unsupported", _IMGS[1]: "unsafe"}


@pytest.mark.parametrize("url", [
    "http://cdn.example.com/a.png", "https:///nohost.png", "https://10.0.0.7/a.png",
    "https://169.254.169.254/latest/meta-data", "https://[::1]/a.png",
])
async def test_the_ssrf_guard_raises_the_unsafe_type(url):
    from api.services.journal_two.note_connectors.providers.base import assert_public_https
    with pytest.raises(errors.NoteConnUnsafeAddress):
        await assert_public_https(url)
    assert not hasattr(engine, "_UNSAFE_REASON_WORDS")      # the word list is gone


async def test_a_resolved_body_that_fails_validation_terminates_under_the_bound(
        source, provider, monkeypatch):
    """Task 6 review (d): a resolved body the validator refuses used to leave the placeholder
    pending, re-fetching its media on every pass with no attempt counted. It now lands each
    item's final notice (a named failure), and the next pass fetches nothing."""
    _image_note(provider, failing=())
    provider.media_by_ref[_IMG] = (PNG_BYTES, "image/png")
    real = notes_svc._validate_body_json

    def refuse_resolved_media(raw):
        if "/api/j2/notes/attachments/" in json.dumps(raw):
            raise notes_svc.NoteValidationError("This note is too long to save as one page.")
        return real(raw)

    monkeypatch.setattr(notes_svc, "_validate_body_json", refuse_resolved_media)
    result = await engine.sync_source(source["id"], full=True)
    assert result["status"] == "ok"
    assert any("validation" in f.lower() for f in result["failures"])
    notice = _only(_body(notes_svc.list_notes("u1")[0]), "importNotice")
    assert (notice["attrs"]["reason"], notice["attrs"]["ref"]) == ("unsupported", _IMG)
    assert _row("u1", _IMG_KEY)["import_media_pending"] == 0
    assert _last_failures(source["id"]) == [{
        "noteTitle": "Chart page", "name": "a.png", "reason": "a.png can't be shown here"}]

    await engine.sync_source(source["id"], full=True, manual=True)
    assert provider.fetch_media_calls == [_IMG]                         # bounded: no refetch


# ---------------------------------------------------------------------------
# Plan A Task 9 (I-5, I-6): hotlinks are copied in; `data:` images decode; redirects followed
# ---------------------------------------------------------------------------

import httpx  # noqa: E402

from api.services.journal_two.note_connectors.providers import base as base_module  # noqa: E402

_HOT = "http://cdn.example.com/a.png"


@pytest.fixture
def web(provider, monkeypatch):
    """The fake provider's `fetch_media` is the real shared hotlink path (`fetch_content_url`)
    over a mock transport: what `web.routes[url]` answers, hop by hop. No live DNS, no network."""
    async def _public(host):
        return ["142.250.0.1"]

    monkeypatch.setattr(base_module, "_resolve_host", _public)
    state = {"routes": {}, "calls": []}

    def handler(request: httpx.Request) -> httpx.Response:
        # An http hop is sent to the checked IP with the original Host (fix round 1, I1).
        url = f"{request.url.scheme}://{request.headers['host']}{request.url.raw_path.decode()}"
        state["calls"].append(url)
        answer = state["routes"].get(url)
        if answer is None:
            raise AssertionError(f"unexpected request to {request.url}")
        return answer()

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    async def fetch_media(_creds, ref):
        provider.fetch_media_calls.append(ref)
        return await base_module.fetch_content_url(client, ref, what="Fake media")

    monkeypatch.setattr(provider, "fetch_media", fetch_media)
    return state


def _hot_note(provider, ref=_HOT):
    """An mddoc-shaped entry: no `source_url` -- the ref is the original address."""
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    rn = _rn("p1", "Chart page", media=[{"ref": ref, "kind": "image", "name": "a.png"}])
    rn.doc["content"].append({"type": "image", "attrs": {"src": f"import-ref://{ref}"}})
    provider.notes_by_id = {"p1": rn}


async def test_http_hotlink_is_downloaded_and_rehosted(source, provider, web):
    _hot_note(provider)
    web["routes"][_HOT] = lambda: httpx.Response(200, content=PNG_BYTES, headers={"content-type": "image/png"})
    result = await engine.sync_source(source["id"], full=True)
    assert result["mediaUploaded"] == 1
    body = _body(notes_svc.list_notes("u1")[0])
    (img,) = _nodes_of(body, "image")
    assert img["attrs"]["src"].startswith("/api/j2/notes/attachments/u1/")
    assert _HOT not in json.dumps(body)                         # never kept as a hotlink
    assert _nodes_of(body, "importNotice") == []


async def test_redirect_followed_to_the_real_image(source, provider, web):
    _hot_note(provider)
    web["routes"][_HOT] = lambda: httpx.Response(302, headers={"location": "https://cdn2.example.com/real.png"})
    web["routes"]["https://cdn2.example.com/real.png"] = lambda: httpx.Response(
        200, content=PNG_BYTES, headers={"content-type": "image/png"})
    result = await engine.sync_source(source["id"], full=True)
    assert result["mediaUploaded"] == 1
    assert web["calls"] == [_HOT, "https://cdn2.example.com/real.png"]
    (img,) = _nodes_of(_body(notes_svc.list_notes("u1")[0]), "image")
    assert img["attrs"]["src"].startswith("/api/j2/notes/attachments/u1/")


async def test_redirect_to_private_address_is_unsafe_notice(source, provider, web):
    """A public URL that 302s to the cloud metadata address: a named `unsafe` notice where the
    image was -- never a 500, never a stored page, and the metadata address is never asked."""
    _hot_note(provider)
    web["routes"][_HOT] = lambda: httpx.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data/"})
    result = await engine.sync_source(source["id"], full=True)
    assert result["status"] == "ok" and result["created"] == 1 and result["mediaUploaded"] == 0
    assert web["calls"] == [_HOT]
    body = _body(notes_svc.list_notes("u1")[0])
    assert _nodes_of(body, "image") == []
    notice = _only(body, "importNotice")
    assert notice["attrs"] == {"reason": "unsafe", "name": "a.png", "sourceUrl": _HOT, "ref": _HOT,
                               "attempts": 0}
    assert _row("u1", _IMG_KEY)["import_media_pending"] == 0     # final: never retried
    root = notes_svc._ATTACHMENT_ROOT                            # nothing stored at all
    assert not root.exists() or not any(p.is_file() for p in root.rglob("*"))


async def test_failed_hotlink_notice_links_to_the_original(source, provider, web):
    _hot_note(provider)
    web["routes"][_HOT] = lambda: httpx.Response(404, content=b"gone")
    await engine.sync_source(source["id"], full=True)
    notice = _only(_body(notes_svc.list_notes("u1")[0]), "importNotice")
    assert notice["attrs"]["reason"] == "fetch_failed"
    assert notice["attrs"]["sourceUrl"] == _HOT


async def test_percent_encoded_svg_data_uri_is_decoded_and_kept(source, provider):
    """I-6 through the engine: an SVG data URI (percent-encoded) is decoded and stored -- as a
    file, since an SVG is never inline (the media policy) -- never dropped."""
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    uri = "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E"
    rn = _rn("p1", "Logo", media=[
        {"ref": "md-img-1.svg", "kind": "image", "name": "md-img-1.svg", "data_uri": uri}])
    rn.doc["content"].append({"type": "image", "attrs": {"src": "import-ref://md-img-1.svg"}})
    provider.notes_by_id = {"p1": rn}
    result = await engine.sync_source(source["id"], full=True)
    assert result["mediaUploaded"] == 1
    assert provider.fetch_media_calls == []
    body = _body(notes_svc.list_notes("u1")[0])
    assert _nodes_of(body, "importNotice") == []
    (chip,) = _nodes_of(body, "attachmentChip")
    assert chip["attrs"]["href"].endswith(".svg")


# ---------------------------------------------------------------------------
# Plan A Task 10 (L-3, L-4): every provider doc is finalized -- bare URLs become
# links, every href goes through the one scheme policy -- before it is hashed.
# ---------------------------------------------------------------------------

def _link_marks(doc) -> list[tuple[str, str]]:
    out = []

    def walk(node):
        if isinstance(node, dict):
            for m in node.get("marks") or []:
                if m.get("type") == "link":
                    out.append((node.get("text"), m["attrs"]["href"]))
            for c in node.get("content") or []:
                walk(c)
    walk(doc)
    return out


async def test_every_provider_doc_is_finalized_before_hashing(source, provider):
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    rn = _rn("p1", "Links", text="see www.tradingview.com/x. and NVDA.US")
    rn.doc["content"].append({"type": "paragraph", "content": [
        {"type": "text", "text": "bad", "marks": [{"type": "link", "attrs": {"href": "javascript:alert(1)"}}]},
        {"type": "text", "text": " https://in.code/x", "marks": [{"type": "code"}]},
    ]})
    provider.notes_by_id = {"p1": rn}
    original = copy.deepcopy(rn.doc)

    await engine.sync_source(source["id"], full=True)

    (note,) = notes_svc.list_notes("u1")
    assert _link_marks(_body(note)) == [("www.tradingview.com/x", "https://www.tradingview.com/x")]
    assert rn.doc == original  # the provider's own object is never mutated
    # the hash was taken over the FINALIZED body: an unchanged re-push is a no-op
    result = await engine.sync_source(source["id"], full=True, manual=True)
    assert result["updated"] == 0 and result["created"] == 0


async def test_a_notion_deep_link_resolves_to_the_imported_note(source, provider):
    pid = "0123456789abcdef0123456789abcdef"
    provider.refs = [
        RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00"),
        RemoteRef(remote_id="p2", updated_at="2026-08-01T00:00:01+00:00"),
    ]
    rn = _rn("p1", "Deep")
    rn.doc["content"].append({"type": "paragraph", "content": [
        {"type": "text", "text": "Target", "marks": [{"type": "link", "attrs": {"href": f"notion://www.notion.so/T-{pid}"}}]},
    ]})
    provider.notes_by_id = {"p1": rn, "p2": _rn("p2", "Target", updated_at="2026-08-01T00:00:01+00:00")}
    # the fake provider's import key is not a notion key, so map the derived key onto p2's
    real_import_key = provider.import_key
    provider.import_key = lambda s, r: "notion:01234567-89ab-cdef-0123-456789abcdef" if r == "p2" else real_import_key(s, r)

    await engine.sync_source(source["id"], full=True)

    target_id = next(n["id"] for n in notes_svc.list_notes("u1") if n["title"] == "Target")
    deep = next(n for n in notes_svc.list_notes("u1") if n["title"] == "Deep")
    assert _link_marks(_body(deep)) == [("Target", f"/journal?j2tab=notebook&note={target_id}")]


async def test_a_notice_the_provider_placed_is_listed_in_failures_json_once(source, provider):
    """Plan A Task 12 fix round 1: a notice the CONVERTER put in the note (a truncated
    database, a file with no address) is a failure the member can read in the log, like the
    engine's own media notices -- listed when the note is written, not again when it is
    skipped unchanged, and it never marks the note pending."""
    from api.services.journal_two import import_notice
    provider.refs = [RemoteRef(remote_id="p1", updated_at="2026-08-01T00:00:00+00:00")]
    rn = _rn("p1", "DB page")
    rn.doc["content"].append(import_notice.notice_node(
        "truncated", name="the first 100 rows of Trades", source_url=None, ref=None, attempts=0))
    provider.notes_by_id = {"p1": rn}

    await engine.sync_source(source["id"], full=True)
    assert _last_failures(source["id"]) == [
        {"noteTitle": "DB page", "reason": "Only the first 100 rows of Trades came over",
         "name": "the first 100 rows of Trades"}]
    assert _row("u1", "fake:fake-graph/p1")["import_media_pending"] == 0

    r2 = await engine.sync_source(source["id"], full=True, manual=True)
    assert (r2["updated"], r2["skipped"]) == (0, 1), r2
    assert _last_failures(source["id"]) is None
