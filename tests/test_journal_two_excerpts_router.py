"""Router-level tests for Wave J's excerpt endpoints. Same standalone-
FastAPI-app + temp-auth.db pattern as test_journal_two_documents_router.py.
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


def _upload_pdf(client, note_id, text="Hello from a real PDF", filename="report.pdf"):
    pdf = make_pdf([text])
    r = client.post(f"/api/j2/notes/{note_id}/attachments", files={"file": (filename, pdf, "application/pdf")})
    assert r.status_code == 200
    att = r.json()
    docs = client.get(f"/api/j2/notes/{note_id}/documents").json()["documents"]
    doc = next(d for d in docs if d["attachmentUrl"] == att["url"])
    return doc["id"]


def test_create_excerpt_requires_auth(client):
    r = client.post("/api/j2/notes/n1/excerpts", json={"documentId": "d1", "pageNumber": 1, "capturedText": "x"})
    assert r.status_code == 401


def test_list_excerpts_requires_auth(client):
    assert client.get("/api/j2/notes/n1/excerpts").status_code == 401


def test_get_excerpt_requires_auth(client):
    assert client.get("/api/j2/excerpts/e1").status_code == 401


def test_search_excerpts_requires_auth(client):
    assert client.get("/api/j2/notes/excerpts/search?q=x").status_code == 401


def test_create_excerpt_inserts_the_node_and_it_is_immediately_listable(app, client):
    """The whole point of the combined create+place endpoint (checkpoint
    decision 20/21): a member never has to separately open/edit the
    destination note."""
    _login_as(app, "u1")
    note_id = _create_note(client, "NVDA Investor Deck Research")
    doc_id = _upload_pdf(client, note_id, text="Management expects gross margins to normalize lower")

    r = client.post(f"/api/j2/notes/{note_id}/excerpts", json={
        "documentId": doc_id, "pageNumber": 1,
        "capturedText": "gross margins to normalize lower",
        "annotation": "Weakens my margin thesis",
    })
    assert r.status_code == 200
    excerpt = r.json()["excerpt"]
    assert excerpt["capturedText"] == "gross margins to normalize lower"
    assert excerpt["documentName"] == "report.pdf"
    assert excerpt["attachmentUrl"]

    listed = client.get(f"/api/j2/notes/{note_id}/excerpts").json()["excerpts"]
    assert len(listed) == 1
    assert listed[0]["id"] == excerpt["id"]


def test_create_excerpt_404s_for_a_foreign_note(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)
    doc_id = _upload_pdf(client, note_id)
    _login_as(app, "u2")
    r = client.post(f"/api/j2/notes/{note_id}/excerpts", json={
        "documentId": doc_id, "pageNumber": 1, "capturedText": "x",
    })
    assert r.status_code == 400  # note ownership fails inside create_excerpt -> ExcerptValidationError


def test_create_excerpt_rejects_missing_captured_text(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)
    doc_id = _upload_pdf(client, note_id)
    r = client.post(f"/api/j2/notes/{note_id}/excerpts", json={
        "documentId": doc_id, "pageNumber": 1, "capturedText": "   ",
    })
    assert r.status_code == 400


def test_get_excerpt_by_id_carries_the_attachment_url_for_click_to_source(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)
    doc_id = _upload_pdf(client, note_id)
    excerpt = client.post(f"/api/j2/notes/{note_id}/excerpts", json={
        "documentId": doc_id, "pageNumber": 1, "capturedText": "Hello from a real PDF",
    }).json()["excerpt"]

    r = client.get(f"/api/j2/excerpts/{excerpt['id']}")
    assert r.status_code == 200
    assert r.json()["excerpt"]["attachmentUrl"] == excerpt["attachmentUrl"]


def test_get_excerpt_404s_for_a_foreign_excerpt(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)
    doc_id = _upload_pdf(client, note_id)
    excerpt = client.post(f"/api/j2/notes/{note_id}/excerpts", json={
        "documentId": doc_id, "pageNumber": 1, "capturedText": "x",
    }).json()["excerpt"]
    _login_as(app, "u2")
    assert client.get(f"/api/j2/excerpts/{excerpt['id']}").status_code == 404


def test_update_excerpt_annotation_endpoint(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)
    doc_id = _upload_pdf(client, note_id)
    excerpt = client.post(f"/api/j2/notes/{note_id}/excerpts", json={
        "documentId": doc_id, "pageNumber": 1, "capturedText": "x",
    }).json()["excerpt"]

    r = client.patch(f"/api/j2/excerpts/{excerpt['id']}", json={"annotation": "updated reason"})
    assert r.status_code == 200
    assert r.json()["excerpt"]["annotation"] == "updated reason"
    assert r.json()["excerpt"]["capturedText"] == "x"


def test_update_excerpt_annotation_404s_for_a_foreign_excerpt(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)
    doc_id = _upload_pdf(client, note_id)
    excerpt = client.post(f"/api/j2/notes/{note_id}/excerpts", json={
        "documentId": doc_id, "pageNumber": 1, "capturedText": "x",
    }).json()["excerpt"]
    _login_as(app, "u2")
    r = client.patch(f"/api/j2/excerpts/{excerpt['id']}", json={"annotation": "hijack"})
    assert r.status_code == 404


def test_search_excerpts_is_tenant_scoped_end_to_end(app, client):
    _login_as(app, "u1")
    n1 = _create_note(client, "u1 note")
    doc1 = _upload_pdf(client, n1, text="text about a distinctive_search_phrase here")
    client.post(f"/api/j2/notes/{n1}/excerpts", json={
        "documentId": doc1, "pageNumber": 1, "capturedText": "distinctive_search_phrase",
    })

    _login_as(app, "u2")
    n2 = _create_note(client, "u2 note")
    doc2 = _upload_pdf(client, n2, text="text about a distinctive_search_phrase here")
    client.post(f"/api/j2/notes/{n2}/excerpts", json={
        "documentId": doc2, "pageNumber": 1, "capturedText": "distinctive_search_phrase",
    })

    r = client.get("/api/j2/notes/excerpts/search?q=distinctive_search_phrase")  # still logged in as u2
    assert r.status_code == 200
    results = r.json()["results"]
    assert len(results) == 1
    assert results[0]["noteId"] == n2


def test_evidence_endpoint_accepts_a_document_excerpt_target_end_to_end(app, client):
    """The Wave G evidence endpoint needs no route change -- only the
    service-layer TARGET_TYPES tuple did (checkpoint decision: target_type
    was left an open string specifically to invite this)."""
    _login_as(app, "u1")
    thesis_note = _create_note(client, "NVDA Thesis")
    source_note = _create_note(client, "NVDA Investor Deck")
    doc_id = _upload_pdf(client, source_note, text="Management expects gross margins to normalize lower")
    excerpt = client.post(f"/api/j2/notes/{source_note}/excerpts", json={
        "documentId": doc_id, "pageNumber": 1, "capturedText": "gross margins to normalize lower",
    }).json()["excerpt"]

    r = client.post(f"/api/j2/notes/{thesis_note}/evidence", json={
        "targetType": "document_excerpt", "targetId": excerpt["id"], "stance": "opposes",
    })
    assert r.status_code == 200
    assert r.json()["evidence"]["targetType"] == "document_excerpt"

    listed = client.get(f"/api/j2/notes/{thesis_note}/evidence").json()["evidence"]
    assert len(listed) == 1 and listed[0]["targetId"] == excerpt["id"]
