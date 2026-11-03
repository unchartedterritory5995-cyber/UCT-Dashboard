"""A full pass with a complete listing retries pending media copies (Plan E Task 9).

Found by the messy Evernote corpus (`test_note_connectors_evernote_engine.py`): a provider with
`list_present_refs` (Evernote, OneNote) keeps its stored cursor on a full pass, so a note whose
remote never changes was never listed again and an image that failed to copy on it stayed
"retrying on the next sync" forever. `engine._pending_media_refs` now adds those notes to a full
pass's fetch, without letting them move or hold the cursor.
"""
from __future__ import annotations

from api.services.journal_two import import_notice


async def test_pending_media_retry_never_moves_or_holds_the_cursor(tmp_path, monkeypatch):
    """Unit: on a full pass with a complete listing, a listed-but-unchanged note waiting on a
    retryable copy is fetched; its (newer) listing time never becomes the cursor (OneNote's cursor
    is a drain watermark) and its failure never holds the cursor."""
    from cryptography.fernet import Fernet

    from api.services import auth_db
    from api.services.journal_two import notes as notes_svc
    from api.services.journal_two.db import ensure_schema
    from api.services.journal_two.note_connectors import connections, engine
    from api.services.journal_two.note_connectors.providers.base import (
        AccountInfo, NoteProvider, RemoteNote, RemoteRef,
    )

    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("NOTE_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")

    async def creds(_u, _p):
        return {"accessToken": "t"}

    monkeypatch.setattr(engine, "_resolve_credentials", creds)

    def doc(text, image=False):
        content = [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]
        if image:
            content.append({"type": "image", "attrs": {"src": "import-ref://res-1"}})
        return {"type": "doc", "content": content}

    class Fake(NoteProvider):
        name = "fake"

        def __init__(self, delta, present, fail_media_once, fail_fetch_b=False):
            self.delta, self.present, self.fetched = delta, present, []
            self.fail_media = fail_media_once
            self.fail_fetch_b = fail_fetch_b

        def import_key(self, source_remote_id, remote_id):
            return f"fake:{remote_id}"

        async def validate(self, credentials):
            return AccountInfo(label="Fake")

        async def list_changed(self, credentials, cursor=None):
            return list(self.delta)

        async def list_present_refs(self, credentials):
            return list(self.present)

        async def fetch(self, credentials, ref):
            self.fetched.append(ref.remote_id)
            if ref.remote_id == "B" and self.fail_fetch_b:
                raise engine.errors.NoteConnTransient("get_note timed out")
            if ref.remote_id == "B":
                return RemoteNote(remote_id="B", title="B", doc=doc("b", image=True),
                                  media=[{"ref": "res-1", "kind": "image", "name": "b.png"}],
                                  updated_at="2026-01-09T00:00:00.000+00:00")
            return RemoteNote(remote_id=ref.remote_id, title=ref.remote_id, doc=doc(ref.remote_id),
                              updated_at=ref.updated_at)

        async def fetch_media(self, credentials, ref):
            if self.fail_media:
                self.fail_media = False
                raise engine.errors.NoteConnTransient("expired")
            from api.services.journal_two.note_connectors.corpora.corpora_gen import _media_body
            return _media_body({"kind": "png", "w": 4, "h": 4, "seed": 1}), "image/png"

    a = RemoteRef(remote_id="A", updated_at="2026-01-01T00:00:00.000+00:00")
    b = RemoteRef(remote_id="B", updated_at="2026-01-09T00:00:00.000+00:00")
    connections.upsert_connector("u1", "fake", {"accessToken": "t"}, account_label="Fake")
    src = connections.create_source("u1", "fake", "acct", display_name="Fake")
    monkeypatch.setattr(engine, "MEMBER_FULL_PASS_MIN_INTERVAL_S", 0)

    # pass 1: B is listed and its image fails -> pending retry
    first = Fake([a, b], [a, b], fail_media_once=True)
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: first)
    await engine.sync_source(src["id"], full=True, manual=True)
    connections.update_cursor("u1", src["id"], "2026-01-01T00:00:00.000+00:00")  # a drain watermark

    def pending_b():
        c = auth_db.get_connection()
        try:
            return c.execute("SELECT import_media_pending FROM j2_notes WHERE import_key = 'fake:B'"
                             ).fetchone()[0]
        finally:
            c.close()

    assert pending_b() == import_notice.MEDIA_PENDING_RETRY
    cursor = lambda: connections.get_source_by_id(src["id"])["cursor"]  # noqa: E731

    # pass 2: the delta holds only A (edited); B (unchanged) is in the complete listing only, and
    # fetching it fails. The retry is attempted, and its failure does not hold the cursor.
    a2 = RemoteRef(remote_id="A", updated_at="2026-01-02T00:00:00.000+00:00")
    second = Fake([a2], [a2, b], fail_media_once=False, fail_fetch_b=True)
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: second)
    await engine.sync_source(src["id"], full=True, manual=True)
    assert set(second.fetched) == {"A", "B"}   # a failing batch is retried item by item
    assert pending_b() == import_notice.MEDIA_PENDING_RETRY
    assert cursor() == "2026-01-02T00:00:00.000+00:00"

    # pass 3: the retry lands; B's newer listing time never becomes the cursor
    third = Fake([a2], [a2, b], fail_media_once=False)
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: third)
    await engine.sync_source(src["id"], full=True, manual=True)
    assert third.fetched == ["A", "B"]
    assert pending_b() == import_notice.MEDIA_PENDING_NONE
    assert cursor() == "2026-01-02T00:00:00.000+00:00"

    # an incremental pass (no complete listing) adds nothing
    fourth = Fake([a2], [a2, b], fail_media_once=False)
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: fourth)
    await engine.sync_source(src["id"], full=False, manual=True)
    assert fourth.fetched == ["A"]
