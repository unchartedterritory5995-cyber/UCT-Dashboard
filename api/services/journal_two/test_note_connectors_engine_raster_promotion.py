"""Content wins for a raster image a provider listed as a file (Plan E Task 9 fix round 1, concern 5).

Evernote types a resource from its declared MIME, so a PNG stored as `application/octet-stream`
was converted to a file chip. The node kind is decided at conversion, before any byte exists, so
the promotion happens in the engine's media stage, from the downloaded bytes: a file-kind item
whose signature is PNG, JPEG, GIF or WebP (`media_policy.raster_signature`; never SVG or a web
page) is stored as an inline image and its chip placeholder becomes an image. Only for a provider
that declares `promote_raster_files` (Evernote); every other provider keeps its file intent.
"""
from __future__ import annotations

import json

import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.note_connectors import connections, engine
from api.services.journal_two.note_connectors.convert import REF_PREFIX
from api.services.journal_two.note_connectors.providers.base import (
    AccountInfo, NoteProvider, RemoteNote, RemoteRef,
)

USER = "u1"
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>'


def _png() -> bytes:
    from api.services.journal_two.note_connectors.corpora.corpora_gen import _media_body
    return _media_body({"kind": "png", "w": 24, "h": 12, "seed": 3})


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("NOTE_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")

    async def creds(_u, _p):
        return {"accessToken": "t"}

    monkeypatch.setattr(engine, "_resolve_credentials", creds)


class FileNote(NoteProvider):
    """One note: a paragraph, then a FILE placeholder `res-1` named shot.png, typed
    application/octet-stream, whose bytes are `self.data`."""
    name = "fake"
    promote_raster_files = True

    def __init__(self, data: bytes):
        self.data = data

    def import_key(self, source_remote_id, remote_id):
        return f"fake:{remote_id}"

    async def validate(self, credentials):
        return AccountInfo(label="Fake")

    async def list_changed(self, credentials, cursor=None):
        return [RemoteRef(remote_id="N", updated_at="2026-01-01T00:00:00.000+00:00")]

    async def fetch(self, credentials, ref):
        doc = {"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "Octet:"}]},
            {"type": "attachmentChip", "attrs": {"href": f"{REF_PREFIX}res-1", "name": "shot.png"}}]}
        return RemoteNote(remote_id="N", title="N", doc=doc, updated_at=ref.updated_at,
                          media=[{"ref": "res-1", "kind": "file", "name": "shot.png",
                                  "mime": "application/octet-stream"}])

    async def fetch_media(self, credentials, ref):
        return self.data, "application/octet-stream"


class NotOptedIn(FileNote):
    promote_raster_files = False


async def _stored_kinds(monkeypatch, provider) -> list[tuple[str, str]]:
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: provider)
    connections.upsert_connector(USER, "fake", {"accessToken": "t"}, account_label="Fake")
    src = connections.create_source(USER, "fake", "acct", display_name="Fake")
    await engine.sync_source(src["id"], full=True, manual=True)
    conn = auth_db.get_connection()
    try:
        body = json.loads(conn.execute("SELECT body_json FROM j2_notes WHERE import_key = 'fake:N'").fetchone()[0])
    finally:
        conn.close()
    out = []
    for node in body["content"][1:]:
        attrs = node.get("attrs") or {}
        out.append((node["type"], (attrs.get("src") or attrs.get("href") or "").rsplit(".", 1)[-1]))
    return out


async def test_octet_stream_png_on_an_opted_in_provider_is_an_inline_image(db, monkeypatch):
    assert await _stored_kinds(monkeypatch, FileNote(_png())) == [("image", "png")]


async def test_octet_stream_svg_stays_a_file(db, monkeypatch):
    assert [kind for kind, _ext in await _stored_kinds(monkeypatch, FileNote(SVG))] == ["attachmentChip"]


async def test_other_providers_keep_their_file_intent(db, monkeypatch):
    assert await _stored_kinds(monkeypatch, NotOptedIn(_png())) == [("attachmentChip", "png")]


async def test_a_heic_typed_octet_stream_stays_a_file(db, monkeypatch):
    """Raster SIGNATURES only (PNG, JPEG, GIF, WebP): a HEIC would be converted and inlined by the
    image policy, but its bytes carry no plain raster signature, so content-wins leaves it a file."""
    from api.services.journal_two.note_connectors.corpora.corpora_gen import HEIC_FIXTURE
    kinds = [kind for kind, _ext in await _stored_kinds(monkeypatch, FileNote(HEIC_FIXTURE.read_bytes()))]
    assert kinds == ["attachmentChip"]
