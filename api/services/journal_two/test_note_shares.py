"""Rails for note share links (note_shares.py). The security posture is the
test surface: sanitized payload, rewritten attachment URLs, revocation is
final, the flag is a master switch, and the public image proxy serves ONLY
that note's images."""

from __future__ import annotations

import sqlite3

import pytest

from api.services.journal_two import note_shares, notes as notes_svc
from api.services.journal_two.db import ensure_schema


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    yield c
    c.close()


@pytest.fixture
def root(tmp_path, monkeypatch):
    r = tmp_path / "att"
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", r)
    return r


def _note_with_image(conn, user="u1"):
    n = notes_svc.create_note(user, {"title": "Shared T", "subtitle": "sub"}, conn=conn)
    body = {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "hello"}]},
        {"type": "image", "attrs": {
            "src": f"/api/j2/notes/attachments/{user}/{n['id']}/inline/abc123.png"}},
    ]}
    notes_svc.update_note(user, n["id"], {"bodyJson": body}, conn=conn)
    return n


def test_create_resolve_roundtrip_rewrites_urls_and_sanitizes(conn):
    n = _note_with_image(conn)
    share = note_shares.create_share("u1", n["id"], conn=conn)
    assert share and share["token"]
    # Idempotent: a second create returns the SAME active token.
    assert note_shares.create_share("u1", n["id"], conn=conn)["token"] == share["token"]

    pub = note_shares.resolve_share(share["token"], conn=conn)
    assert pub["title"] == "Shared T"
    # Attachment URL rewritten to the token proxy — the real route is owner-only.
    img = pub["bodyJson"]["content"][1]["attrs"]["src"]
    assert img == f"/api/j2/shared/{share['token']}/att/inline/abc123.png"
    # Sanitized: the reader gets the document, never the account.
    for leak in ("userId", "user_id", "tags", "folderId", "ticker", "id"):
        assert leak not in pub


def test_cannot_share_someone_elses_note(conn):
    n = _note_with_image(conn, user="u1")
    assert note_shares.create_share("u2", n["id"], conn=conn) is None


def test_revoke_is_final_and_kills_resolution(conn):
    n = _note_with_image(conn)
    tok = note_shares.create_share("u1", n["id"], conn=conn)["token"]
    assert note_shares.revoke_share("u1", n["id"], conn=conn) is True
    assert note_shares.resolve_share(tok, conn=conn) is None
    assert note_shares.get_share("u1", n["id"], conn=conn) is None
    # Re-sharing mints a NEW token — the leaked old link stays dead.
    tok2 = note_shares.create_share("u1", n["id"], conn=conn)["token"]
    assert tok2 != tok
    assert note_shares.resolve_share(tok, conn=conn) is None


def test_flag_gates_the_public_surface(monkeypatch):
    monkeypatch.delenv("J2_SHARE_LINKS_ENABLED", raising=False)
    assert note_shares.enabled() is False
    monkeypatch.setenv("J2_SHARE_LINKS_ENABLED", "1")
    assert note_shares.enabled() is True


def test_attachment_proxy_scope(conn, root):
    n = _note_with_image(conn)
    tok = note_shares.create_share("u1", n["id"], conn=conn)["token"]
    d = root / "u1" / "notes" / n["id"] / "inline"
    d.mkdir(parents=True)
    (d / "abc123.png").write_bytes(b"png")
    # In-scope image serves.
    assert note_shares.resolve_share_attachment(tok, "inline", "abc123.png", conn=conn) is not None
    # 'file' sub (PDFs etc.) stays private in v1.
    assert note_shares.resolve_share_attachment(tok, "file", "abc123.png", conn=conn) is None
    # Traversal is dead downstream.
    assert note_shares.resolve_share_attachment(tok, "inline", "..", conn=conn) is None
    # A bad/revoked token serves nothing.
    assert note_shares.resolve_share_attachment("nope", "inline", "abc123.png", conn=conn) is None
    note_shares.revoke_share("u1", n["id"], conn=conn)
    assert note_shares.resolve_share_attachment(tok, "inline", "abc123.png", conn=conn) is None
