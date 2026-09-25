"""Router-level tests for Wave I's document/attachment endpoints. Same
standalone-FastAPI-app + temp-auth.db pattern as
test_journal_two_home_and_research_router.py.
"""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services.journal_two.pdf_fixtures import make_pdf


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


@pytest.fixture
def attachment_root(tmp_path, monkeypatch):
    """See test_wave_i_documents.py's `conn` fixture docstring: DATA_DIR
    (read live by attachment_root.attachment_root() on every read) and
    notes._ATTACHMENT_ROOT (cached at import, used by every write) must
    point at the SAME subdirectory or an upload-then-extract round trip
    through the real router can't find what it just wrote."""
    from api.services.journal_two import notes as notes_svc
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "j2_attachments")
    yield tmp_path


@pytest.fixture(autouse=True)
def _no_real_entity_master(monkeypatch):
    from api.services.entity_master import api as entity_master
    monkeypatch.setattr(
        entity_master, "resolve",
        lambda alias, as_of=None, **kw: entity_master.ResolveResult(status="not_found"),
    )


@pytest.fixture(autouse=True)
def _no_background_extraction(monkeypatch):
    """These tests assert the SYNCHRONOUS half of the upload path (a
    'pending' document row exists the instant the upload response returns)
    and drive extraction itself explicitly via process_document() where they
    need a 'ready' result — a real daemon thread racing test teardown (it
    can still hold a sqlite3 connection open when the test function returns,
    which Windows refuses to unlink) is not needed for anything asserted
    here."""
    from api.services.journal_two import document_extraction
    monkeypatch.setattr(document_extraction, "queue_extraction", lambda document_id: None)


@pytest.fixture
def app(db_path, attachment_root):
    from api.routers import journal_two as journal_two_router
    fa = FastAPI()
    fa.include_router(journal_two_router.router)
    yield fa
    fa.dependency_overrides.clear()


@pytest.fixture
def client(app):
    return TestClient(app)


def _login_as(app, user_id):
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": user_id, "role": "member"}


def _create_note(client, title="A note", **extra):
    r = client.post("/api/j2/notes", json={"title": title, **extra})
    assert r.status_code == 200
    return r.json()["note"]["id"]


def test_upload_attachments_requires_auth(client):
    r = client.post("/api/j2/notes/n1/attachments", files={"file": ("x.pdf", b"x", "application/pdf")})
    assert r.status_code == 401


def test_list_documents_requires_auth(client):
    assert client.get("/api/j2/notes/n1/documents").status_code == 401


def test_search_documents_requires_auth(client):
    assert client.get("/api/j2/notes/documents/search?q=x").status_code == 401


def test_uploading_a_pdf_synchronously_creates_a_pending_document_row(app, client):
    """create_document runs on the request path (only extraction itself is
    async) — a pending row must exist the instant the upload response
    returns, with no wait/poll needed to observe it."""
    _login_as(app, "u1")
    note_id = _create_note(client)
    pdf = make_pdf(["Hello from a real PDF"])

    r = client.post(f"/api/j2/notes/{note_id}/attachments", files={"file": ("report.pdf", pdf, "application/pdf")})
    assert r.status_code == 200
    att = r.json()
    assert att["name"] == "report.pdf"

    docs = client.get(f"/api/j2/notes/{note_id}/documents").json()["documents"]
    assert len(docs) == 1
    assert docs[0]["attachmentUrl"] == att["url"]
    assert docs[0]["status"] == "pending"


def test_uploading_a_non_pdf_attachment_creates_no_document_row(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)
    r = client.post(f"/api/j2/notes/{note_id}/attachments", files={"file": ("notes.csv", b"a,b,c", "text/csv")})
    assert r.status_code == 200
    docs = client.get(f"/api/j2/notes/{note_id}/documents").json()["documents"]
    assert docs == []


def _tiny_png() -> bytes:
    import io as _io
    from PIL import Image
    buf = _io.BytesIO()
    Image.new("RGB", (4, 4), (200, 30, 30)).save(buf, "PNG")
    return buf.getvalue()


def test_both_upload_routes_report_every_saved_attachment_to_the_seam(app, client, monkeypatch):
    """Seam S1 (wave 7). The router never decides what becomes a document:
    it hands EVERY saved attachment -- the /images route and the
    /attachments route alike -- to document_extraction.on_attachment_saved
    with the kind and the content type, AFTER the bytes are saved. Lane G
    extends that one function (image OCR, docx text) behind its own gate.
    If a route stops calling it, image and docx documents silently never
    happen while every upload still answers 200 -- which is why this rail
    spies on the seam rather than on any document row."""
    from api.services.journal_two import document_extraction
    calls = []

    def _spy(user_id, note_id, att, content_type, *, kind):
        calls.append((user_id, note_id, dict(att), content_type, kind))
        return None

    monkeypatch.setattr(document_extraction, "on_attachment_saved", _spy)
    _login_as(app, "u1")
    note_id = _create_note(client)

    r_img = client.post(f"/api/j2/notes/{note_id}/images", files={"file": ("shot.png", _tiny_png(), "image/png")})
    assert r_img.status_code == 200, r_img.text
    r_file = client.post(f"/api/j2/notes/{note_id}/attachments", files={"file": ("notes.csv", b"a,b,c", "text/csv")})
    assert r_file.status_code == 200, r_file.text

    assert [(c[1], c[3], c[4]) for c in calls] == [
        (note_id, "image/png", "image"),
        (note_id, "text/csv", "file"),
    ]
    assert calls[0][0] == "u1"
    # the seam receives the SAVED artifact (the dict the route answers with),
    # never a pre-save guess -- its url is the join key back to the bytes
    assert calls[0][2]["url"] == r_img.json()["url"]
    assert calls[1][2]["url"] == r_file.json()["url"]


def test_the_seam_itself_still_makes_a_pdf_a_document_and_nothing_else(monkeypatch):
    """The PDF behaviour lives INSIDE the seam now: a file kind with a PDF
    content type creates the row and queues extraction; an image kind or a
    non-PDF file returns None and touches nothing. (The router-level PDF
    test above proves the route reaches this; this proves the decision.)"""
    from api.services.journal_two import document_extraction
    created, queued = [], []
    monkeypatch.setattr(document_extraction, "create_document",
                        lambda uid, nid, url, name, **kw: created.append((uid, nid, url, name)) or {"id": "doc-1"})
    monkeypatch.setattr(document_extraction, "queue_extraction", lambda doc_id: queued.append(doc_id))

    out = document_extraction.on_attachment_saved(
        "u1", "n1", {"url": "/x/report.pdf", "name": "report.pdf", "size": 3}, "application/pdf", kind="file")
    assert out == {"id": "doc-1"}
    assert created == [("u1", "n1", "/x/report.pdf", "report.pdf")]
    assert queued == ["doc-1"]

    assert document_extraction.on_attachment_saved(
        "u1", "n1", {"url": "/x/a.png", "width": 4, "height": 4}, "image/png", kind="image") is None
    assert document_extraction.on_attachment_saved(
        "u1", "n1", {"url": "/x/notes.csv", "name": "notes.csv", "size": 5}, "text/csv", kind="file") is None
    assert created == [("u1", "n1", "/x/report.pdf", "report.pdf")]
    assert queued == ["doc-1"]


def test_list_documents_on_a_note_with_none_is_an_empty_list_not_404(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)
    r = client.get(f"/api/j2/notes/{note_id}/documents")
    assert r.status_code == 200
    assert r.json()["documents"] == []


def test_list_documents_404s_for_a_foreign_note(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)
    _login_as(app, "u2")
    assert client.get(f"/api/j2/notes/{note_id}/documents").status_code == 404


def test_search_documents_is_tenant_scoped_end_to_end(app, client):
    from api.services.journal_two import document_extraction

    _login_as(app, "u1")
    n1 = _create_note(client, "u1 note")
    pdf = make_pdf(["A distinctive searchable phrase about gross margin"])
    att1 = client.post(f"/api/j2/notes/{n1}/attachments", files={"file": ("r1.pdf", pdf, "application/pdf")}).json()
    doc1 = document_extraction.get_document_by_attachment("u1", n1, att1["url"])
    document_extraction.process_document(doc1["id"])

    _login_as(app, "u2")
    n2 = _create_note(client, "u2 note")
    att2 = client.post(f"/api/j2/notes/{n2}/attachments", files={"file": ("r2.pdf", pdf, "application/pdf")}).json()
    doc2 = document_extraction.get_document_by_attachment("u2", n2, att2["url"])
    document_extraction.process_document(doc2["id"])

    r = client.get("/api/j2/notes/documents/search?q=margin")  # still logged in as u2
    assert r.status_code == 200
    results = r.json()["results"]
    assert len(results) == 1
    assert results[0]["noteId"] == n2
