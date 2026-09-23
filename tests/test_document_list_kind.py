"""A note's document list says which rows are CAPTURED WEB PAGES.

⚰️ THE GAP. `GET /notes/{id}/documents` listed a captured web source as one more
document -- its `attachmentUrl` is `web:<sha256>`, an identity, not a file -- and
every surface that opens a row of it (the editor's `?doc=&page=` route, reached
from Search, from Ask's page route and from any deep link; the research
workspace's Documents list, from the research summary) handed that row to the
PDF viewer. Wave N §9's defect, reachable from several doors at once.

⭐ Both lists now carry `sourceKind`, decided by `ask_evidence.document_source_kind`
-- `is_web_capture`, the SAME rule a cited page's navigation carries -- and the
note's list carries `capturePassages`, the excerpt `capture_web_source` wrote
beside each captured page, through which the page is revisited. ADDITIVE: every
existing field is unchanged.

Real schema (`auth_db.init_db`), the real capture writer, the real router.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services import auth_db
from api.services.auth_db import get_connection
from api.services.journal_two import notes as notes_svc
from api.services.journal_two import web_capture as wc
from api.services.journal_two import web_capture_store as wcs

URL = "https://www.reuters.com/markets/nvda-margins"


@pytest.fixture(autouse=True)
def _no_real_entity_master(monkeypatch):
    from api.services.entity_master import api as entity_master
    monkeypatch.setattr(
        entity_master, "resolve",
        lambda alias, as_of=None, **kw: entity_master.ResolveResult(status="not_found"),
    )


@pytest.fixture()
def world():
    auth_db.init_db()
    uid = "u-doclist-" + uuid.uuid4().hex[:8]
    note = notes_svc.create_note(uid, {
        "title": "NVDA research", "ticker": "NVDA",
        "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]},
    })
    pdf_id = uuid.uuid4().hex
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO j2_note_documents"
            " (id, user_id, note_id, attachment_url, name, status, page_count,"
            "  created_at, source_kind, capture_type)"
            " VALUES (?,?,?,?,?,?,?,datetime('now'),?,?)",
            (pdf_id, uid, note["id"], "/api/j2/notes/attachments/u/n/file/q3.pdf", "Q3 10-Q",
             "ready", 80, wc.SOURCE_KIND_ATTACHMENT, "pdf_full_text"))
        conn.commit()
    finally:
        conn.close()
    first = wcs.capture_web_source(uid, note["id"], {
        "tier": wc.TIER_PASSAGE, "url": URL, "title": "Reuters: NVDA margins",
        "passage": "Analysts expect gross margins to normalize next year.",
    })
    second = wcs.capture_web_source(uid, note["id"], {
        "tier": wc.TIER_PASSAGE, "url": URL, "title": "Reuters: NVDA margins",
        "passage": "Data-center revenue grew faster than any prior quarter.",
    })
    return {
        "uid": uid, "note_id": note["id"], "pdf_id": pdf_id,
        "web_id": first["document"]["id"], "second_web_id": second["document"]["id"],
        "p1": first["page_number"], "ex1": first["excerpt"]["id"],
        "p2": second["page_number"], "ex2": second["excerpt"]["id"],
    }


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


def test_two_passages_of_one_page_are_one_document_with_two_captured_pages(world):
    # Non-vacuity for the passage assertions below: the fixture really built
    # one captured document holding TWO passages, each with its own excerpt.
    assert world["second_web_id"] == world["web_id"]
    assert world["p1"] != world["p2"]
    assert world["ex1"] != world["ex2"]


def test_the_note_list_names_each_rows_kind_and_its_captured_passages(client, world):
    docs = _listed(client, world["note_id"])
    pdf, web = docs[world["pdf_id"]], docs[world["web_id"]]
    assert pdf["sourceKind"] == wc.SOURCE_KIND_ATTACHMENT
    assert pdf["capturePassages"] == []
    assert web["sourceKind"] == wc.SOURCE_KIND_WEB
    assert web["capturePassages"] == [
        {"pageNumber": world["p1"], "excerptId": world["ex1"]},
        {"pageNumber": world["p2"], "excerptId": world["ex2"]},
    ]
    # ADDITIVE: what every existing reader reads is still there, unchanged.
    for key in ("id", "attachmentUrl", "name", "status", "pageCount", "textComplete"):
        assert key in pdf and key in web
    assert web["attachmentUrl"].startswith("web:")


def test_a_passage_whose_excerpt_was_deleted_leaves_the_list(client, world):
    conn = get_connection()
    try:
        conn.execute("DELETE FROM j2_note_excerpts WHERE id = ?", (world["ex2"],))
        conn.commit()
    finally:
        conn.close()
    web = _listed(client, world["note_id"])[world["web_id"]]
    assert web["sourceKind"] == wc.SOURCE_KIND_WEB
    assert web["capturePassages"] == [{"pageNumber": world["p1"], "excerptId": world["ex1"]}]


def test_the_kind_is_is_web_capture_not_the_raw_column(client, world):
    """⛔ ONE RULE. `is_web_capture` accepts EITHER column ("a row carrying only
    one still tells the truth"), so a row whose `capture_type` says it is a
    captured passage is web whatever `source_kind` says -- a reading of the raw
    `source_kind` column alone would call it a PDF and send it straight back to
    the PDF viewer."""
    conn = get_connection()
    try:
        conn.execute("UPDATE j2_note_documents SET source_kind = ? WHERE id = ?",
                     (wc.SOURCE_KIND_ATTACHMENT, world["web_id"]))
        conn.commit()
    finally:
        conn.close()
    web = _listed(client, world["note_id"])[world["web_id"]]
    assert web["sourceKind"] == wc.SOURCE_KIND_WEB
    assert [p["excerptId"] for p in web["capturePassages"]] == [world["ex1"], world["ex2"]]


def test_a_schema_without_the_capture_columns_names_no_kind(client, world, monkeypatch):
    # The columns were not selected: nothing is known, so nothing is claimed.
    monkeypatch.setattr(wc, "capture_columns", lambda conn, alias="d": "")
    docs = _listed(client, world["note_id"])
    assert {d["sourceKind"] for d in docs.values()} == {None}
    assert all(d["capturePassages"] == [] for d in docs.values())


def test_the_research_summary_names_the_kind_too(client, world):
    r = client.get("/api/j2/notes/research/NVDA/summary")
    assert r.status_code == 200, r.text
    docs = {d["id"]: d for d in r.json()["documents"]}
    assert docs[world["web_id"]]["sourceKind"] == wc.SOURCE_KIND_WEB
    assert docs[world["pdf_id"]]["sourceKind"] == wc.SOURCE_KIND_ATTACHMENT
