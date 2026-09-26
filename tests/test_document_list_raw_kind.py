"""The note's document list names each document's OWN kind, beside `sourceKind`
(wave 7, lane I; review finding M-7).

`sourceKind` answers "is this a captured web page?" and says `attachment` for
every file, so a PDF, a photographed page and a .docx were indistinguishable to
it, and the preview picked its viewer from the attachment URL -- a projection
standing in for the kind. `kind` (pdf | image | docx | web) is a SEPARATE field:
older clients switch on `sourceKind`, which must not widen.

Real schema (`auth_db.init_db`), the real capture writer, the real router. The
file kinds are written with document_extraction's own constants, never retyped.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services import auth_db
from api.services.auth_db import get_connection
from api.services.journal_two import document_extraction as dx
from api.services.journal_two import notes as notes_svc
from api.services.journal_two import web_capture as wc
from api.services.journal_two import web_capture_store as wcs

URL = "https://www.reuters.com/markets/amd-guidance"


@pytest.fixture(autouse=True)
def _no_real_entity_master(monkeypatch):
    from api.services.entity_master import api as entity_master
    monkeypatch.setattr(
        entity_master, "resolve",
        lambda alias, as_of=None, **kw: entity_master.ResolveResult(status="not_found"),
    )


def _doc(conn, uid, note_id, name, source_kind, capture_type="pdf_full_text"):
    doc_id = uuid.uuid4().hex
    conn.execute(
        "INSERT INTO j2_note_documents"
        " (id, user_id, note_id, attachment_url, name, status, page_count,"
        "  created_at, source_kind, capture_type)"
        " VALUES (?,?,?,?,?,?,?,datetime('now'),?,?)",
        (doc_id, uid, note_id, f"/api/j2/notes/attachments/u/n/file/{name}", name,
         "ready", 1, source_kind, capture_type))
    return doc_id


@pytest.fixture()
def world():
    auth_db.init_db()
    uid = "u-dockind-" + uuid.uuid4().hex[:8]
    note = notes_svc.create_note(uid, {
        "title": "AMD research", "ticker": "AMD",
        "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]},
    })
    conn = get_connection()
    try:
        ids = {
            "pdf": _doc(conn, uid, note["id"], "q3.pdf", dx.SOURCE_KIND_ATTACHMENT),
            "image": _doc(conn, uid, note["id"], "whiteboard.png", dx.SOURCE_KIND_IMAGE),
            "docx": _doc(conn, uid, note["id"], "memo.docx", dx.SOURCE_KIND_DOCX),
            # a stored kind this table does not name yet
            "future": _doc(conn, uid, note["id"], "deck.pptx", "attachment_pptx"),
            # the ONE rule: capture_type says captured passage, source_kind says file
            "web_by_capture_type": _doc(conn, uid, note["id"], "clip", dx.SOURCE_KIND_ATTACHMENT,
                                        capture_type="web_passage"),
        }
        conn.commit()
    finally:
        conn.close()
    cap = wcs.capture_web_source(uid, note["id"], {
        "tier": wc.TIER_PASSAGE, "url": URL, "title": "Reuters: AMD guidance",
        "passage": "Guidance for the data-center segment was raised.",
    })
    ids["web"] = cap["document"]["id"]
    return {"uid": uid, "note_id": note["id"], "ids": ids}


@pytest.fixture()
def client(world):
    from api.routers import journal_two as journal_two_router
    fa = FastAPI()
    fa.include_router(journal_two_router.router)
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": world["uid"], "role": "member"}
    yield TestClient(fa)
    fa.dependency_overrides.clear()


def _listed(client, note_id):
    r = client.get(f"/api/j2/notes/{note_id}/documents")
    assert r.status_code == 200, r.text
    return {d["id"]: d for d in r.json()["documents"]}


def test_each_row_carries_its_own_kind(client, world):
    docs = _listed(client, world["note_id"])
    ids = world["ids"]
    assert docs[ids["pdf"]]["kind"] == "pdf"
    assert docs[ids["image"]]["kind"] == "image"
    assert docs[ids["docx"]]["kind"] == "docx"
    assert docs[ids["web"]]["kind"] == "web"


def test_sourceKind_is_unchanged_for_every_row(client, world):
    """The old field keeps its two values; `kind` sits BESIDE it. This is also the
    control that the new field is needed at all: three different files share one
    sourceKind."""
    docs = _listed(client, world["note_id"])
    ids = world["ids"]
    assert {docs[ids[k]]["sourceKind"] for k in ("pdf", "image", "docx", "future")} == {
        wc.SOURCE_KIND_ATTACHMENT}
    assert docs[ids["web"]]["sourceKind"] == wc.SOURCE_KIND_WEB
    assert len({docs[ids[k]]["kind"] for k in ("pdf", "image", "docx")}) == 3


def test_a_captured_page_is_web_by_the_one_rule_whatever_source_kind_says(client, world):
    row = _listed(client, world["note_id"])[world["ids"]["web_by_capture_type"]]
    assert row["sourceKind"] == wc.SOURCE_KIND_WEB
    assert row["kind"] == "web"


def test_a_stored_kind_the_table_does_not_name_passes_through_not_as_a_pdf(client, world):
    assert _listed(client, world["note_id"])[world["ids"]["future"]]["kind"] == "attachment_pptx"


def test_non_vacuity_the_list_holds_every_seeded_row(client, world):
    docs = _listed(client, world["note_id"])
    assert set(world["ids"].values()) <= set(docs), "the fixture's rows did not reach the list"


def test_a_schema_without_the_capture_columns_names_no_kind(client, world, monkeypatch):
    monkeypatch.setattr(wc, "capture_columns", lambda conn, alias="d": "")
    docs = _listed(client, world["note_id"])
    assert {d["kind"] for d in docs.values()} == {None}
    assert {d["sourceKind"] for d in docs.values()} == {None}
