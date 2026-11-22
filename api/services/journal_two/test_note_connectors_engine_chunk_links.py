"""Links across an import-chunk boundary resolve by the end of the pass (Plan E Task 6 review R1).

The engine imports a large delta in chunks of `IMPORT_CHUNK_NOTES` (Task 5 fix round 1, I3). A link
from chunk 1 to a note in chunk 2 is a FORWARD link: when chunk 1 is imported its target does not
exist yet, so it stays `import-link://` pending. The random heal sweep (`heal_pending_links`,
HEAL_LIMIT notes, drawn from ALL the member's pending notes) only heals it by chance. The pass must
heal THIS pass's own pending notes by name, after the last chunk.

A REAL import here (no recorder): real schema, real `_import_remote_notes`, real link resolution.
The sweep's default limit is shrunk to 10 so that, with 600 unrelated pending notes in the pool, a
chance heal cannot hide the bug (with the real 500 the old code healed note 0 about 5 times in 6).
"""

from __future__ import annotations

import json

import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.note_connectors import engine, link_keys
from api.services.journal_two.note_connectors.providers.base import (
    AccountInfo, NoteProvider, RemoteNote, RemoteRef,
)

T1 = "2026-08-01T00:00:00+00:00"


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("NOTE_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    import api.services.journal_two.note_connectors.connections as conns
    return conns


class Linked(NoteProvider):
    name = "fake"

    def __init__(self, n: int, links: dict[int, int]):
        self.n = n
        self.links = links  # note index -> target index

    def key(self, i: int) -> str:
        return self.import_key("graph", f"n{i}")

    async def validate(self, credentials):
        return AccountInfo(label="fake")

    async def list_changed(self, credentials, cursor=None):
        return [RemoteRef(remote_id=f"n{i}", updated_at=T1) for i in range(self.n)]

    async def fetch(self, credentials, ref):
        i = int(ref.remote_id[1:])
        content = [{"type": "paragraph", "content": [{"type": "text", "text": f"note {i}"}]}]
        links = []
        if i in self.links:
            target = self.key(self.links[i])
            links.append(target)
            content.append({"type": "paragraph", "content": [{
                "type": "text", "text": f"see n{self.links[i]}",
                "marks": [{"type": "link", "attrs": {"href": f"import-link://{target}"}}]}]})
        return RemoteNote(remote_id=ref.remote_id, title=f"Note {i}",
                          doc={"type": "doc", "content": content}, links=links,
                          created_at=T1, updated_at=T1)

    async def fetch_media(self, credentials, ref):
        raise AssertionError("no media")


def _seed_unrelated_pending(user: str, count: int) -> None:
    """`count` imported notes from another source, each linking to a key that never exists."""
    for start in range(0, count, 300):
        notes = [{
            "importKey": f"other:g/u{i}", "title": f"Unrelated {i}",
            "bodyJson": {"type": "doc", "content": [{"type": "paragraph", "content": [{
                "type": "text", "text": "dangling",
                "marks": [{"type": "link", "attrs": {"href": f"import-link://other:g/ghost{i}"}}]}]}]},
            "tags": [], "folderPath": [], "updatedAt": T1}
            for i in range(start, min(start + 300, count))]
        notes_svc.import_confirm(user, {"source": "other", "destFolderId": None, "notes": notes})


def _note_by_key(key: str) -> dict:
    conn = auth_db.get_connection()
    try:
        return dict(conn.execute(
            "SELECT id, body_json, import_links_pending FROM j2_notes WHERE import_key = ?",
            (key,)).fetchone())
    finally:
        conn.close()


def _pending_count(user: str) -> int:
    conn = auth_db.get_connection()
    try:
        return conn.execute("SELECT COUNT(*) FROM j2_notes WHERE user_id = ? AND import_links_pending = 1",
                            (user,)).fetchone()[0]
    finally:
        conn.close()


async def test_links_both_ways_across_the_chunk_boundary_resolve_at_pass_end(db, monkeypatch):
    n = engine.IMPORT_CHUNK_NOTES + 1  # note n-1 is alone in the second chunk
    last = n - 1
    provider = Linked(n, {0: last, last: 0})  # forward (chunk 1 -> 2) and backward (2 -> 1)
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: provider)
    monkeypatch.setattr(link_keys.heal_pending_links, "__kwdefaults__",
                        {**link_keys.heal_pending_links.__kwdefaults__, "limit": 10})

    _seed_unrelated_pending("u1", 600)
    assert _pending_count("u1") == 600
    db.upsert_connector("u1", "fake", {"token": "t"})
    source = db.create_source("u1", "fake", "graph")

    result = await engine.sync_source(source["id"], manual=True)
    assert result["status"] == "ok" and result["created"] == n

    first, final = _note_by_key(provider.key(0)), _note_by_key(provider.key(last))
    for note in (first, final):
        assert "import-link://" not in note["body_json"]
        assert note["import_links_pending"] == 0
    assert final["id"] in first["body_json"] and first["id"] in final["body_json"]
    assert _pending_count("u1") == 600  # only the unrelated, genuinely dangling notes remain


async def test_the_random_heal_sweep_runs_once_per_pass_not_once_per_chunk(db, monkeypatch):
    # Review m4: a 5000-note first sync read up to 25 x 500 bodies in per-chunk sweeps.
    n = engine.IMPORT_CHUNK_NOTES * 2 + 1  # three chunks
    provider = Linked(n, {})
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: provider)
    sweeps: list[dict] = []
    real = link_keys.heal_pending_links

    def counting(user_id, **kw):
        sweeps.append(kw)
        return real(user_id, **kw)

    monkeypatch.setattr(engine, "heal_pending_links", counting)
    db.upsert_connector("u1", "fake", {"token": "t"})
    source = db.create_source("u1", "fake", "graph")
    await engine.sync_source(source["id"], manual=True)
    random_sweeps = [kw for kw in sweeps if kw.get("limit", link_keys.HEAL_LIMIT) > 0]
    assert len(random_sweeps) == 1
