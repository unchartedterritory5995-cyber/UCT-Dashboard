"""Wave I — Attachments + PDF / Financial Document Research Foundation.
Backend unit tests: extraction, the document/page tables, page-aware
search, the Wave-C-history attachment-GC fix, and account-purge coverage.
"""
from __future__ import annotations

import sqlite3

import pytest

from api.services.journal_two import notes as notes_svc
from api.services.journal_two import document_extraction, document_search, attachment_gc, ticker_research
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.pdf_fixtures import make_pdf, make_blank_pdf


@pytest.fixture(autouse=True)
def _no_real_entity_master(monkeypatch):
    from api.services.entity_master import api as entity_master

    def _fake_resolve(alias, as_of=None, **kw):
        return entity_master.ResolveResult(status="not_found")
    monkeypatch.setattr(entity_master, "resolve", _fake_resolve)


@pytest.fixture
def conn(tmp_path, monkeypatch):
    """Fresh sandboxed J2 db — DATA_DIR and notes._ATTACHMENT_ROOT are
    aligned to the SAME 'j2_attachments' subdirectory so a write (via
    save_note_attachment_bytes, which uses the cached notes._ATTACHMENT_ROOT)
    and a read (via serve_note_image_path -> attachment_root.attachment_root(),
    a LIVE call reading DATA_DIR fresh) resolve to the same tree — a real,
    if narrow, gap in every prior media test, which never exercised the read
    side (see the Wave I entry checkpoint's own reconstruction)."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "j2_attachments")
    c = sqlite3.connect(tmp_path / "j2_test.db")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    yield c
    c.close()


def _upload_pdf(conn, user_id, note_id, pdf_bytes, filename="report.pdf"):
    return notes_svc.save_note_attachment_bytes(
        user_id, note_id, pdf_bytes, filename, "application/pdf",
    )


# ── extract_pdf_pages ─────────────────────────────────────────────────────

def test_extract_pdf_pages_happy_path_preserves_page_identity_and_punctuation():
    pdf = make_pdf(["Hello page one", "Second page text here", "Gross margin was 42.5% ($1,234.56)"])
    pages, page_count = document_extraction.extract_pdf_pages(pdf)
    assert page_count == 3
    assert pages == ["Hello page one", "Second page text here", "Gross margin was 42.5% ($1,234.56)"]


def test_extract_pdf_pages_corrupt_pdf_returns_none_never_raises():
    assert document_extraction.extract_pdf_pages(b"not a pdf at all") is None


def test_extract_pdf_pages_zero_text_pdf_returns_empty_strings_not_none():
    """An image-only/scanned PDF is a real, valid PDF with zero extractable
    text -- process_document must tell this apart from a corrupt PDF
    (status=no_text, never processing_failed)."""
    pdf = make_blank_pdf(n_pages=2)
    pages, page_count = document_extraction.extract_pdf_pages(pdf)
    assert page_count == 2
    assert pages == ["", ""]


def test_extract_pdf_pages_respects_the_max_pages_bound(monkeypatch):
    monkeypatch.setattr(document_extraction, "_MAX_PAGES", 2)
    pdf = make_pdf(["one", "two", "three", "four"])
    pages, real_page_count = document_extraction.extract_pdf_pages(pdf)
    assert real_page_count == 4  # the PDF's real page count is still reported
    assert len(pages) == 2  # but text extraction stopped at the bound


def test_normalize_page_text_preserves_financial_punctuation_strips_only_whitespace_noise():
    raw = "Revenue  grew   12.5%   to $1,234.56 (up from $998.00)\n\n\n\nNext paragraph."
    out = document_extraction._normalize_page_text(raw)
    assert "$1,234.56" in out
    assert "12.5%" in out
    assert "(up from $998.00)" in out
    assert "\n\n\n\n" not in out


# ── create_document / process_document ────────────────────────────────────

def test_create_document_is_idempotent_on_note_id_plus_attachment_url(conn):
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)
    d1 = document_extraction.create_document(conn=conn, user_id="u1", note_id=note["id"], attachment_url="/x.pdf", name="x.pdf")
    d2 = document_extraction.create_document(conn=conn, user_id="u1", note_id=note["id"], attachment_url="/x.pdf", name="x.pdf")
    assert d1["id"] == d2["id"]
    rows = conn.execute("SELECT COUNT(*) AS c FROM j2_note_documents").fetchone()
    assert rows["c"] == 1


def test_process_document_happy_path_writes_page_rows_and_ready_status(conn):
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)
    pdf = make_pdf(["First page content", "Second page content"])
    att = _upload_pdf(conn, "u1", note["id"], pdf)
    doc = document_extraction.create_document(conn=conn, user_id="u1", note_id=note["id"],
                                                attachment_url=att["url"], name=att["name"])
    result = document_extraction.process_document(doc["id"], conn=conn)
    assert result["ok"] is True
    assert result["status"] == "ready"
    assert result["page_count"] == 2

    row = conn.execute("SELECT * FROM j2_note_documents WHERE id = ?", (doc["id"],)).fetchone()
    assert row["status"] == "ready"
    assert row["page_count"] == 2
    assert row["processed_at"] is not None

    pages = document_extraction.list_document_pages("u1", doc["id"], conn=conn)
    assert [p["page_number"] for p in pages] == [1, 2]
    assert pages[0]["text"] == "First page content"
    assert pages[1]["text"] == "Second page content"
    assert pages[0]["text_origin"] == "native"


def test_process_document_zero_text_pdf_is_status_no_text_not_processing_failed(conn):
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)
    pdf = make_blank_pdf(n_pages=1)
    att = _upload_pdf(conn, "u1", note["id"], pdf)
    doc = document_extraction.create_document(conn=conn, user_id="u1", note_id=note["id"],
                                                attachment_url=att["url"], name=att["name"])
    result = document_extraction.process_document(doc["id"], conn=conn)
    assert result["status"] == "no_text"
    row = conn.execute("SELECT status, page_count FROM j2_note_documents WHERE id = ?", (doc["id"],)).fetchone()
    assert row["status"] == "no_text"
    assert row["page_count"] == 1  # page count is real even with no extractable text


def test_process_document_corrupt_or_missing_file_is_honest_processing_failed(conn):
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)
    # A document row pointing at an attachment URL that was never actually
    # uploaded -- the "file missing on disk" failure path.
    doc = document_extraction.create_document(
        conn=conn, user_id="u1", note_id=note["id"],
        attachment_url=f"/api/j2/notes/attachments/u1/{note['id']}/file/doesnotexist.pdf",
        name="ghost.pdf",
    )
    result = document_extraction.process_document(doc["id"], conn=conn)
    assert result["ok"] is False
    assert result["status"] == "processing_failed"
    row = conn.execute("SELECT status FROM j2_note_documents WHERE id = ?", (doc["id"],)).fetchone()
    assert row["status"] == "processing_failed"


def test_process_document_never_crashes_on_a_corrupt_pdf_on_disk(conn):
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)
    att = notes_svc.save_note_attachment_bytes("u1", note["id"], b"garbage not a pdf", "bad.pdf", "application/pdf")
    doc = document_extraction.create_document(conn=conn, user_id="u1", note_id=note["id"],
                                                attachment_url=att["url"], name=att["name"])
    result = document_extraction.process_document(doc["id"], conn=conn)
    assert result["ok"] is False
    assert result["status"] == "processing_failed"


def test_process_document_is_idempotent_via_insert_or_ignore_on_reprocess(conn):
    """A retry (e.g. queue_extraction fired twice) must not duplicate page
    rows or crash on the PRIMARY KEY."""
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)
    pdf = make_pdf(["Only page"])
    att = _upload_pdf(conn, "u1", note["id"], pdf)
    doc = document_extraction.create_document(conn=conn, user_id="u1", note_id=note["id"],
                                                attachment_url=att["url"], name=att["name"])
    document_extraction.process_document(doc["id"], conn=conn)
    document_extraction.process_document(doc["id"], conn=conn)  # reprocess
    rows = conn.execute("SELECT COUNT(*) AS c FROM j2_note_document_pages WHERE document_id = ?", (doc["id"],)).fetchone()
    assert rows["c"] == 1


# ── document_search ────────────────────────────────────────────────────────

def test_search_document_pages_finds_a_real_match_with_page_and_note_context(conn):
    note = notes_svc.create_note("u1", {"title": "NVDA 10-K notes"}, conn=conn)
    pdf = make_pdf(["Intro page", "Gross margin expanded significantly this quarter"])
    att = _upload_pdf(conn, "u1", note["id"], pdf)
    doc = document_extraction.create_document(conn=conn, user_id="u1", note_id=note["id"],
                                                attachment_url=att["url"], name=att["name"])
    document_extraction.process_document(doc["id"], conn=conn)

    results = document_search.search_document_pages("u1", "margin", conn=conn)
    assert len(results) == 1
    assert results[0]["page_number"] == 2
    assert results[0]["document_id"] == doc["id"]
    assert results[0]["note_id"] == note["id"]
    assert results[0]["note_title"] == "NVDA 10-K notes"
    assert "<mark>" in results[0]["snippet"]


def test_search_document_pages_is_tenant_scoped(conn):
    n1 = notes_svc.create_note("u1", {"title": "n1"}, conn=conn)
    n2 = notes_svc.create_note("u2", {"title": "n2"}, conn=conn)
    for uid, note in (("u1", n1), ("u2", n2)):
        att = _upload_pdf(conn, uid, note["id"], make_pdf(["A shared secret keyword appears here"]))
        doc = document_extraction.create_document(conn=conn, user_id=uid, note_id=note["id"],
                                                    attachment_url=att["url"], name=att["name"])
        document_extraction.process_document(doc["id"], conn=conn)

    results = document_search.search_document_pages("u1", "keyword", conn=conn)
    assert len(results) == 1
    assert results[0]["note_id"] == n1["id"]


def test_search_document_pages_excludes_documents_in_a_trashed_note(conn):
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)
    att = _upload_pdf(conn, "u1", note["id"], make_pdf(["Findable text here"]))
    doc = document_extraction.create_document(conn=conn, user_id="u1", note_id=note["id"],
                                                attachment_url=att["url"], name=att["name"])
    document_extraction.process_document(doc["id"], conn=conn)
    assert len(document_search.search_document_pages("u1", "findable", conn=conn)) == 1

    notes_svc.delete_note("u1", note["id"], conn=conn)  # soft delete (trash)
    assert document_search.search_document_pages("u1", "findable", conn=conn) == []


def test_search_document_pages_empty_query_returns_empty_not_everything(conn):
    assert document_search.search_document_pages("u1", "", conn=conn) == []


# ── Wave-C-history GC fix ──────────────────────────────────────────────────

def test_gc_protects_an_attachment_still_referenced_only_by_an_older_wave_c_version(conn, tmp_path):
    """The real gap found at this wave's checkpoint: an attachment removed
    from the CURRENT note body, but still referenced by an OLDER Wave C
    version snapshot, must NOT be swept -- restoring that version must not
    show a broken attachment."""
    note = notes_svc.create_note("u1", {"title": "n", "bodyJson": {"type": "doc", "content": []}}, conn=conn)
    att = notes_svc.save_note_attachment_bytes("u1", note["id"], b"%PDF-1.4 fake but fine for GC test",
                                                 "report.pdf", "application/pdf")
    filename = att["url"].rsplit("/", 1)[-1]

    # Capture a version whose body_json references the attachment (mirrors a
    # real save: the chip lives in body_json before the member later removes it).
    import json
    conn.execute(
        "INSERT INTO j2_note_versions (id, user_id, note_id, title, subtitle, body_json, body_plain, created_at)"
        " VALUES ('v1', 'u1', ?, 'n', '', ?, '', '2020-01-01T00:00:00+00:00')",
        (note["id"], json.dumps({"type": "doc", "content": [
            {"type": "attachmentChip", "attrs": {"href": att["url"], "name": "report.pdf"}},
        ]})),
    )
    conn.commit()
    # Current note body no longer references it (member removed the chip).

    report = attachment_gc.sweep_orphaned_attachments(
        min_age_hours=0, dry_run=False, user_id="u1", conn=conn,
    )
    assert report["orphaned"] == 0, "an attachment still referenced by a Wave C version must not be orphaned"
    file_path = tmp_path / "j2_attachments" / "u1" / "notes" / note["id"] / "file" / filename
    assert file_path.exists()


def test_gc_still_sweeps_a_truly_unreferenced_attachment(conn, tmp_path):
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)
    att = notes_svc.save_note_attachment_bytes("u1", note["id"], b"orphan bytes", "orphan.txt", "text/plain")
    filename = att["url"].rsplit("/", 1)[-1]
    # Never referenced anywhere -- current body, versions, or inbox.
    report = attachment_gc.sweep_orphaned_attachments(
        min_age_hours=0, dry_run=False, user_id="u1", conn=conn,
    )
    assert report["deleted"] == 1
    file_path = tmp_path / "j2_attachments" / "u1" / "notes" / note["id"] / "file" / filename
    assert not file_path.exists()


# ── Cascade delete + account purge ─────────────────────────────────────────

def test_deleting_a_note_cascades_to_documents_pages_and_fts(conn):
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)
    att = _upload_pdf(conn, "u1", note["id"], make_pdf(["Cascade test page"]))
    doc = document_extraction.create_document(conn=conn, user_id="u1", note_id=note["id"],
                                                attachment_url=att["url"], name=att["name"])
    document_extraction.process_document(doc["id"], conn=conn)
    assert conn.execute("SELECT COUNT(*) AS c FROM j2_note_documents").fetchone()["c"] == 1
    assert conn.execute("SELECT COUNT(*) AS c FROM j2_note_document_pages").fetchone()["c"] == 1
    assert conn.execute("SELECT COUNT(*) AS c FROM j2_note_document_pages_fts").fetchone()["c"] == 1

    conn.execute("DELETE FROM j2_notes WHERE id = ?", (note["id"],))
    conn.commit()

    assert conn.execute("SELECT COUNT(*) AS c FROM j2_note_documents").fetchone()["c"] == 0
    assert conn.execute("SELECT COUNT(*) AS c FROM j2_note_document_pages").fetchone()["c"] == 0
    assert conn.execute("SELECT COUNT(*) AS c FROM j2_note_document_pages_fts").fetchone()["c"] == 0
    assert conn.execute("SELECT COUNT(*) AS c FROM j2_note_document_pages_fts_map").fetchone()["c"] == 0


def test_account_purge_removes_document_and_page_rows():
    from api.services.journal_two import account_purge
    assert "j2_note_documents" in account_purge._DIRECT_USER_TABLES
    assert "j2_note_document_pages" in account_purge._DIRECT_USER_TABLES


# ── Ticker Research Workspace "Documents" section ──────────────────────────

def test_ticker_workspace_surfaces_a_pdf_via_its_owning_notes_ticker(conn):
    """Checkpoint decision: membership derives ENTIRELY through the owning
    note's existing ticker relationship -- the document itself carries no
    ticker metadata of its own."""
    note = notes_svc.create_note("u1", {"title": "NVDA research", "ticker": "NVDA"}, conn=conn)
    att = _upload_pdf(conn, "u1", note["id"], make_pdf(["NVDA investor deck"]))
    document_extraction.create_document(conn=conn, user_id="u1", note_id=note["id"],
                                          attachment_url=att["url"], name=att["name"])

    summary = ticker_research.get_ticker_research_summary("u1", "NVDA", conn=conn)
    assert len(summary["documents"]) == 1
    assert summary["documents"][0]["name"] == att["name"]
    assert summary["documents"][0]["noteId"] == note["id"]
    assert summary["documents"][0]["status"] == "pending"


def test_ticker_workspace_documents_is_independent_of_the_notes_sections_own_cap(conn):
    """A PDF on an older note not in the bounded Notes list must still
    surface in Documents -- the two sections query independently."""
    older = notes_svc.create_note("u1", {"title": "Old NVDA note", "ticker": "NVDA"}, conn=conn)
    att = _upload_pdf(conn, "u1", older["id"], make_pdf(["Old filing"]))
    document_extraction.create_document(conn=conn, user_id="u1", note_id=older["id"],
                                          attachment_url=att["url"], name=att["name"])
    # 5 newer NVDA notes push `older` out of the Notes section's own 5-cap.
    for i in range(5):
        notes_svc.create_note("u1", {"title": f"Newer note {i}", "ticker": "NVDA"}, conn=conn)

    summary = ticker_research.get_ticker_research_summary("u1", "NVDA", conn=conn)
    assert older["id"] not in [n["id"] for n in summary["notes"]]
    assert summary["documents"][0]["noteId"] == older["id"]


def test_ticker_workspace_documents_empty_when_no_pdfs(conn):
    notes_svc.create_note("u1", {"title": "n", "ticker": "NVDA"}, conn=conn)
    summary = ticker_research.get_ticker_research_summary("u1", "NVDA", conn=conn)
    assert summary["documents"] == []
