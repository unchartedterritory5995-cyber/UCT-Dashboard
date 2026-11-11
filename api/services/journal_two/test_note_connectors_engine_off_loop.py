"""Small synchronous reads a member pass made on the event loop run in a worker thread (Plan E final
review M2): building the provider (Evernote's admin mode reads the member's role there) and the
removal-check bookkeeping (`note_removal_check`, `removal_skips`), each on its own connection.

Left on the loop, by design: the reads that share `_import_remote_notes`' one connection and its
transaction (adoption's title query, `_bulk_existing_note_meta`), as the engine has always run them.
"""
from __future__ import annotations

import threading

import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.note_connectors import connections, engine
from api.services.journal_two.note_connectors.providers.base import (
    AccountInfo, NoteProvider, RemoteNote, RemoteRef,
)

USER = "u1"


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("NOTE_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    monkeypatch.setattr(engine, "MEMBER_FULL_PASS_MIN_INTERVAL_S", 0)

    async def creds(_u, _p):
        return {"accessToken": "t"}

    monkeypatch.setattr(engine, "_resolve_credentials", creds)


class Listed(NoteProvider):
    name = "fake"

    def import_key(self, source_remote_id, remote_id):
        return f"fake:{remote_id}"

    async def validate(self, credentials):
        return AccountInfo(label="Fake")

    async def list_changed(self, credentials, cursor=None):
        return [RemoteRef(remote_id="A", updated_at="2026-01-01T00:00:00.000+00:00")]

    async def list_present_refs(self, credentials):
        return await self.list_changed(credentials)

    async def fetch(self, credentials, ref):
        return RemoteNote(remote_id="A", title="A", updated_at=ref.updated_at,
                          doc={"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "a"}]}]})

    async def fetch_media(self, credentials, ref):
        raise AssertionError("no media")


@pytest.mark.parametrize("member", [False, True])
async def test_build_and_removal_check_reads_run_off_the_loop(db, monkeypatch, member):
    loop_thread = threading.get_ident()
    seen: dict[str, list[int]] = {}

    def spy(name, fn):
        def wrapped(*a, **kw):
            seen.setdefault(name, []).append(threading.get_ident())
            return fn(*a, **kw)
        return wrapped

    monkeypatch.setattr(engine, "_provider_factory", spy("build", lambda name, source=None: Listed()))
    monkeypatch.setattr(connections, "note_removal_check", spy("note_removal_check", connections.note_removal_check))
    monkeypatch.setattr(connections, "removal_skips", spy("removal_skips", connections.removal_skips))
    connections.upsert_connector(USER, "fake", {"accessToken": "t"}, account_label="Fake")
    src = connections.create_source(USER, "fake", "acct", display_name="Fake")
    result = await engine.sync_source(src["id"], full=not member, manual=True, member=member)
    assert result["status"] == "ok"
    want = {"build", "removal_skips"} | ({"note_removal_check"} if not member else set())
    assert want <= set(seen), seen
    assert all(t != loop_thread for threads in seen.values() for t in threads), seen
