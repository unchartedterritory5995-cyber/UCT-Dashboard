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
import importlib
import json
import threading

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
    imgs = [n for n in trading["bodyJson"]["content"] if n.get("type") == "image"]
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
    img = next(n for n in note["bodyJson"]["content"] if n.get("type") == "image")
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
    assert all(n.get("type") != "image" for n in note["bodyJson"]["content"])


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
# 5. Delete detection: 2-strikes + refuse guard
# ---------------------------------------------------------------------------

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
    r2 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r2["status"] == "ok"
    idx_rows = {r["remote_id"]: r for r in _remote_index_rows(source["id"])}
    assert idx_rows["c"]["miss_streak"] == 1
    c_note = notes_svc.get_note("u1", c_note_id)
    assert "source-deleted" not in c_note["tags"]

    # Full sync #3: "c" STILL missing -> second consecutive miss -> tagged + severed.
    r3 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r3["status"] == "ok"
    idx_rows = {r["remote_id"]: r for r in _remote_index_rows(source["id"])}
    assert "c" not in idx_rows  # index row severed
    c_note = notes_svc.get_note("u1", c_note_id)
    assert "source-deleted" in c_note["tags"]
    # the note itself is never deleted, only flagged.
    assert notes_svc.get_note("u1", c_note_id) is not None


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

    href = _find_link(page_one["bodyJson"])
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
    assert f"/journal?j2tab=notebook&note={target['id']}" in json.dumps(original["bodyJson"])

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

    def racing_rewrite_body(doc, media_urls, id_by_key, *, strip_unresolved_links=True):
        if not fired["done"]:
            fired["done"] = True
            # Simulates a user's OWN edit landing in the window between this
            # note's import_confirm (already run) and this resolve step.
            notes_svc.update_note("u1", original_id, {"title": "user's own concurrent edit"})
        return real_rewrite_body(
            doc, media_urls, id_by_key, strip_unresolved_links=strip_unresolved_links)

    monkeypatch.setattr(engine, "rewrite_body", racing_rewrite_body)

    result = await engine.sync_source(source["id"], full=True, manual=True)

    assert result["conflicts"] == 1

    kept_original = notes_svc.get_note("u1", original_id)
    assert kept_original["title"] == "user's own concurrent edit"  # never clobbered
    assert "sync-conflict" in kept_original["tags"]
    # the LOSING (resolved) write never applied -> the placeholder confirm
    # already wrote is still there, untouched by the race.
    assert "import-link://" in json.dumps(kept_original["bodyJson"])

    all_notes = notes_svc.list_notes("u1")
    assert len(all_notes) == 3  # original + target + the new conflict sibling
    sibling = next(n for n in all_notes if n["title"] == "Race Note (synced copy)")
    assert "sync-conflict" in sibling["tags"]
    # the sibling holds the RESOLVED content (link resolved to the target,
    # same as the clean-path assertion above).
    assert f"/journal?j2tab=notebook&note={target['id']}" in json.dumps(sibling["bodyJson"])
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
    bad.doc = {"type": "not-a-doc"}  # malformed -> import_confirm raises NoteValidationError

    provider.notes_by_id = {"p1": good, "p2": bad}

    result = await engine.sync_source(source["id"], full=True)

    assert result["status"] == "ok"  # a bad batch degrades gracefully, doesn't abort the sync
    assert result["created"] == 1  # only batch 1's note
    assert result["mediaUploaded"] == 1  # batch 1 was fully resolved, not just confirmed
    assert any("batch" in f.lower() for f in result["failures"])

    notes = notes_svc.list_notes("u1")
    assert len(notes) == 1
    assert notes[0]["title"] == "Batch One Note"
    img = next(n for n in notes[0]["bodyJson"]["content"] if n.get("type") == "image")
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
    assert "import-ref://" not in json.dumps(healed["bodyJson"])


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


# Important 6 — validate the resolved body (1MB/shape backstop) before the
# raw write; failure -> named error in the log, placeholder body left in
# place so self-heal can retry after a fix.


async def test_oversized_resolved_body_fails_validation_and_leaves_placeholder_in_place(
    source, provider, monkeypatch,
):
    """Exercises the PER-BATCH (media) pass's validation call — the note has
    media so `_confirm_and_resolve_batch` actually reaches `rewrite_body`."""
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

    def fake_rewrite_body(doc, media_urls, id_by_key, *, strip_unresolved_links=True):
        return huge_doc, []

    monkeypatch.setattr(engine, "rewrite_body", fake_rewrite_body)

    result = await engine.sync_source(source["id"], full=True)

    assert result["status"] == "ok"  # a per-note validation failure never fails the whole sync
    assert result["created"] == 1
    assert any("validation" in f.lower() for f in result["failures"])

    note = notes_svc.list_notes("u1")[0]
    # the placeholder body import_confirm wrote is still there, untouched.
    assert "import-ref://img-1" in json.dumps(note["bodyJson"])
    assert json.dumps(note["bodyJson"]) != json.dumps(huge_doc)


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

    def fake_rewrite_body(doc, media_urls, id_by_key, *, strip_unresolved_links=True):
        return huge_doc, []

    monkeypatch.setattr(engine, "rewrite_body", fake_rewrite_body)

    result = await engine.sync_source(source["id"], full=True)

    assert result["status"] == "ok"
    assert result["created"] == 2
    assert any("validation" in f.lower() for f in result["failures"])

    source_note = next(n for n in notes_svc.list_notes("u1") if n["title"] == "Oversize Link Source")
    assert "import-link://" in json.dumps(source_note["bodyJson"])
    assert json.dumps(source_note["bodyJson"]) != json.dumps(huge_doc)


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
    assert f"/journal?j2tab=notebook&note={note_b['id']}" in json.dumps(note_a["bodyJson"])
    assert "import-link://" not in json.dumps(note_a["bodyJson"])


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
    assert "import-link://fake:fake-graph/b" in json.dumps(note_a["bodyJson"])  # intact, not stripped

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
    assert f"/journal?j2tab=notebook&note={note_b['id']}" in json.dumps(note_a2["bodyJson"])
    assert "import-link://" not in json.dumps(note_a2["bodyJson"])


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
    await engine.sync_source(source["id"], full=True, manual=True)
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
    await engine.sync_source(source["id"], full=True, manual=True)
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
    await engine.sync_source(source["id"], full=True, manual=True)
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
