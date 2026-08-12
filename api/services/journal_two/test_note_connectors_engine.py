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

import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.note_connectors import engine
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
    monkeypatch.setattr(engine, "_provider_factory", lambda name: p)
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
# link resolution across the batch (import-link:// -> a real note URL)
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
