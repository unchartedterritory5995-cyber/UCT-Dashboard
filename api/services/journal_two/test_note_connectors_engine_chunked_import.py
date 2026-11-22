"""The engine imports a large delta in bounded chunks as it fetches (Plan E Task 5 review I3).

A first sync of a 5000-note Evernote account used to fetch EVERY note (each a converted TipTap
doc) before importing any; the single web pod held them all at once. Now the engine fetches,
finalizes and imports `IMPORT_CHUNK_NOTES` refs at a time, so at most one chunk of converted
notes is alive, while the cursor rule (advance only when every ref was stored) is unchanged.

`_import_remote_notes` is replaced by a recorder here: this suite is about the ORCHESTRATION
(what is fetched and imported when, and the cursor), not about storing notes; the real import's
own suites cover that.
"""

from __future__ import annotations

import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.note_connectors import engine
from api.services.journal_two.note_connectors.providers.base import (
    AccountInfo, NoteProvider, RemoteNote, RemoteRef,
)

N = 5000


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


def _ts(i: int) -> str:
    return f"2026-01-01T00:00:00.{i:03d}+00:00" if i < 1000 else f"2026-01-02T{i // 3600:02d}:{(i // 60) % 60:02d}:{i % 60:02d}.000+00:00"


class BigAccount(NoteProvider):
    name = "fake"

    def __init__(self, n: int):
        self.refs = [RemoteRef(remote_id=f"n{i}", updated_at=_ts(i)) for i in range(n)]
        self.events: list[tuple[str, int]] = []
        self.alive = 0       # converted notes fetched and not yet handed to an import
        self.peak_alive = 0

    async def validate(self, credentials):
        return AccountInfo(label="fake")

    async def list_changed(self, credentials, cursor=None):
        return list(self.refs)

    async def fetch(self, credentials, ref):
        return (await self.fetch_many(credentials, [ref]))[0]

    async def fetch_many(self, credentials, refs):
        self.events.append(("fetch", len(refs)))
        self.alive += len(refs)
        self.peak_alive = max(self.peak_alive, self.alive)
        return [RemoteNote(remote_id=r.remote_id, title=r.remote_id,
                           doc={"type": "doc", "content": [{"type": "paragraph", "content": [
                               {"type": "text", "text": "x" * 200}]}]},
                           created_at=r.updated_at, updated_at=r.updated_at) for r in refs]

    async def fetch_media(self, credentials, ref):
        raise AssertionError("no media")


@pytest.fixture
def account(db, monkeypatch):
    p = BigAccount(N)
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    imported: list[int] = []

    async def record_import(user_id, source, provider, creds, remote_notes, **kw):
        provider.events.append(("import", len(remote_notes)))
        provider.alive -= len(remote_notes)
        imported.append(len(remote_notes))
        return {"created": len(remote_notes), "updated": 0, "skipped": 0, "mediaUploaded": 0,
                "conflicts": 0, "failures": [], "noticeFailures": [], "notStoredRefs": []}

    monkeypatch.setattr(engine, "_import_remote_notes", record_import)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    source = db.create_source("u1", "fake", "acct")
    return p, source, imported, db


async def test_a_5000_note_first_sync_never_holds_more_than_one_chunk(account):
    p, source, imported, db = account
    result = await engine.sync_source(source["id"], manual=True)
    assert result["status"] == "ok" and result["created"] == N
    assert sum(imported) == N
    assert max(imported) <= engine.IMPORT_CHUNK_NOTES
    # Peak converted notes alive at once: one chunk, never the whole account.
    assert p.peak_alive <= engine.IMPORT_CHUNK_NOTES
    # Fetch and import interleave: an import follows each chunk's fetches.
    kinds = [k for k, _ in p.events]
    assert kinds.index("import") < len(kinds) - 1 and kinds.count("import") == len(imported)


async def test_the_cursor_still_advances_only_when_every_chunk_stored_everything(account, monkeypatch):
    p, source, imported, db = account

    async def lose_one_in_the_last_chunk(user_id, src, provider, creds, remote_notes, **kw):
        lost = [rn.remote_id for rn in remote_notes if rn.remote_id == f"n{N - 1}"]
        return {"created": len(remote_notes) - len(lost), "updated": 0, "skipped": 0,
                "mediaUploaded": 0, "conflicts": 0, "failures": [], "noticeFailures": [],
                "notStoredRefs": lost}

    monkeypatch.setattr(engine, "_import_remote_notes", lose_one_in_the_last_chunk)
    await engine.sync_source(source["id"], manual=True)
    assert db.get_source("u1", source["id"])["cursor"] is None  # A1: kept where it was

    monkeypatch.setattr(engine, "_import_remote_notes",
                        lambda *a, **k: _all_stored(a[4]))
    await engine.sync_source(source["id"], manual=True)
    assert db.get_source("u1", source["id"])["cursor"] == max(r.updated_at for r in p.refs)


async def test_a_note_lost_in_an_early_chunk_keeps_the_cursor(account, monkeypatch):
    # Task 6 review m3: lost at IMPORT level in chunk 1, then clean chunks. An accumulation that
    # REPLACED instead of adding would forget it and advance the cursor past it.
    p, source, imported, db = account

    async def lose_n0(user_id, src, provider, creds, remote_notes, **kw):
        lost = [rn.remote_id for rn in remote_notes if rn.remote_id == "n0"]
        return {"created": len(remote_notes) - len(lost), "updated": 0, "skipped": 0,
                "mediaUploaded": 0, "conflicts": 0, "failures": [], "noticeFailures": [],
                "notStoredRefs": lost}

    monkeypatch.setattr(engine, "_import_remote_notes", lose_n0)
    await engine.sync_source(source["id"], manual=True)
    assert db.get_source("u1", source["id"])["cursor"] is None


async def _all_stored(remote_notes):
    return {"created": len(remote_notes), "updated": 0, "skipped": 0, "mediaUploaded": 0,
            "conflicts": 0, "failures": [], "noticeFailures": [], "notStoredRefs": []}


async def test_a_fetch_failure_in_one_chunk_keeps_the_cursor(account, monkeypatch):
    p, source, imported, db = account
    real = p.fetch_many

    async def failing(credentials, refs):
        if any(r.remote_id == "n10" for r in refs):
            raise RuntimeError("batch down")
        return await real(credentials, refs)

    async def single(credentials, ref):
        if ref.remote_id == "n10":
            raise RuntimeError("note gone")
        return (await real(credentials, [ref]))[0]

    p.fetch_many = failing
    p.fetch = single
    result = await engine.sync_source(source["id"], manual=True)
    assert any("n10" in f for f in result["failures"])
    assert sum(imported) == N - 1
    assert db.get_source("u1", source["id"])["cursor"] is None
