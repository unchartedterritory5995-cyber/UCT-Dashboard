"""Wave P1 — the OCR pipeline, proven without an OCR engine.

⛔⛔ THE ONE THAT MATTERS IS `TestSearchActuallyFindsIt`. Everything else here
could pass while the feature is useless: the page table can hold perfect OCR
text, the job can report complete, the status can say ready — and Search can be
permanently blind, because `j2_note_document_pages` has no `AFTER UPDATE`
trigger and a scanned PDF already stored an empty row for every page. That rail
goes through the PRODUCTION search path, not the page table, and it carries the
positive control that the phrase was genuinely unfindable beforehand.

⛔ THE ENGINE IS A DETERMINISTIC FAKE, AND IT DRIVES THE REAL PATH (§29). It is
injected at the same seam the real engine will use, so the storage, job,
recovery and coverage behaviour proven here is the behaviour that ships. There
is no parallel test-only code path.
"""
from __future__ import annotations

import importlib.util
import pathlib
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from api.services import auth_db
from api.services.auth_db import get_connection
from api.services.journal_two import document_extraction as dx
from api.services.journal_two import document_ocr as ocr
from api.services.journal_two import document_search
from api.services.journal_two import notes as notes_svc

# ⛔ ONE FIXTURE GENERATOR FOR THE WHOLE WAVE. The benchmark corpus and these
# rails must not disagree about what "a scanned page" is, so both import the
# same builders rather than each rolling their own PDF.
_FX_PATH = pathlib.Path(__file__).resolve().parents[1] / "tools" / "wave_p_fixtures.py"
_spec = importlib.util.spec_from_file_location("wave_p_fixtures", _FX_PATH)
fx = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fx)

# A phrase that exists ONLY on the scanned page, so a Search hit cannot come
# from the note body, a native page, or another fixture.
SCAN_PHRASE = "kimberlitegabbro"
ENGINE, ENGINE_VERSION = "fake-test-ocr", "1.0.0"

A = "u-ocr-a"
B = "u-ocr-b"


def fake_adapter(_image) -> ocr.OcrPageResult:
    """Deterministic. ⛔ It returns the SAME text every time on purpose: this
    suite is about the pipeline, and an engine that varied would make every
    assertion below a measurement of the engine instead."""
    return ocr.OcrPageResult(
        text=f"Revenue rose. {SCAN_PHRASE} appears only on this scanned page.",
        engine=ENGINE, engine_version=ENGINE_VERSION)


def failing_adapter(_image) -> ocr.OcrPageResult:
    raise RuntimeError("engine says no")


@pytest.fixture()
def env(tmp_path, monkeypatch):
    """Fresh tenants + an attachment root the write AND read sides agree on."""
    global A, B
    auth_db.init_db()
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "j2_attachments")
    tok = uuid.uuid4().hex[:8]
    A, B = f"u-ocr-a-{tok}", f"u-ocr-b-{tok}"
    ocr.set_adapter(None)
    yield
    ocr.set_adapter(None)


def _note(user: str = None) -> str:
    n = notes_svc.create_note(user or A, {
        "title": "Filings", "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}})
    return n["id"]


def _attach(pdf: bytes, *, user: str = None, note_id: str = None,
            name: str = "scan.pdf") -> tuple[str, str]:
    user = user or A
    note_id = note_id or _note(user)
    att = notes_svc.save_note_attachment_bytes(user, note_id, pdf, name,
                                               "application/pdf")
    doc = dx.create_document(user, note_id, att["url"], att.get("name"))
    dx.process_document(doc["id"])          # native extraction, as production does
    return doc["id"], note_id


def _scanned_pdf(pages: int = 1) -> bytes:
    img, _ = fx.page_clean()
    return fx._images_to_scanned_pdf([img] * pages)


def _native_pdf() -> bytes:
    _, txt = fx.page_clean()
    return fx._native_text_pdf([txt, txt])


def _mixed_pdf() -> bytes:
    """native / scanned / native — the shape P0 measured as [492, 0, 781]."""
    import io
    from pypdf import PdfReader, PdfWriter
    _, txt = fx.page_clean()
    img, _ = fx.page_table()
    w = PdfWriter()
    w.add_page(PdfReader(io.BytesIO(fx._native_text_pdf([txt]))).pages[0])
    w.add_page(PdfReader(io.BytesIO(fx._images_to_scanned_pdf([img]))).pages[0])
    w.add_page(PdfReader(io.BytesIO(fx._native_text_pdf([txt]))).pages[0])
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def _conn():
    c = get_connection()
    c.row_factory = sqlite3.Row
    return c


# ── §34 · the classifier ────────────────────────────────────────────────────

class TestClassifier:
    def test_a_native_page_is_native_and_a_scanned_page_is_scanned(self, env):
        doc_id, _ = _attach(_mixed_pdf())
        ocr.set_adapter(fake_adapter)
        plan = ocr.plan_document(doc_id)
        assert plan["classes"] == {1: ocr.PAGE_NATIVE, 2: ocr.PAGE_SCANNED,
                                   3: ocr.PAGE_NATIVE}

    def test_a_native_page_is_NEVER_claimed_for_ocr(self, env):
        # ⛔ §18/§39 — filings carry logos and charts on perfectly good text
        # pages. "Has an image" must never mean "needs OCR".
        doc_id, _ = _attach(_native_pdf())
        ocr.set_adapter(fake_adapter)
        plan = ocr.plan_document(doc_id)
        assert plan["ocr_required"] == []
        c = _conn()
        assert c.execute("SELECT COUNT(*) c FROM j2_note_document_ocr_pages"
                         " WHERE document_id = ?", (doc_id,)).fetchone()["c"] == 0
        c.close()


# ── §37 · no engine wired must not make things WORSE ────────────────────────

class TestNoEngineIsHonest:
    def test_without_an_adapter_a_scan_keeps_saying_no_text(self, env):
        # ⛔⛔ THE REGRESSION THIS BLOCKS. If planning claimed pages with no
        # engine to read them, the document would derive `pending` and a member
        # would watch "Processing scanned text…" forever — strictly worse than
        # today's honest `no_text`, and green to every status check.
        doc_id, _ = _attach(_scanned_pdf())
        assert ocr.ocr_available() is False
        plan = ocr.plan_document(doc_id)
        assert plan["scanned_pages"] == [1], "it still KNOWS the page is a scan"
        assert plan["ocr_required"] == [], "but it promises nothing"
        c = _conn()
        assert c.execute("SELECT status FROM j2_note_documents WHERE id = ?",
                         (doc_id,)).fetchone()["status"] == ocr.DOC_NO_TEXT
        c.close()


# ── §7/§8/§10 · THE LOAD-BEARING RAIL ───────────────────────────────────────

class TestSearchActuallyFindsIt:
    def test_the_phrase_is_unfindable_before_ocr_and_findable_after(self, env):
        doc_id, note_id = _attach(_scanned_pdf())
        c = _conn()

        # ⭐ POSITIVE CONTROL, FIRST. The empty page row IS already in the FTS
        # index — so "Search finds nothing" is a real answer from a real index,
        # not the absence of one. Without this the whole rail could pass
        # against a document that was never indexed at all.
        indexed = c.execute(
            "SELECT COUNT(*) c FROM j2_note_document_pages_fts WHERE document_id = ?",
            (doc_id,)).fetchone()["c"]
        assert indexed == 1, "the empty scanned page must already be indexed"
        assert document_search.search_document_pages(A, SCAN_PHRASE) == []

        ocr.set_adapter(fake_adapter)
        ocr.plan_document(doc_id)
        res = ocr.ocr_document(doc_id, fake_adapter)
        assert res["pages_read"] == 1

        # ⛔ THROUGH THE PRODUCTION SEARCH PATH, never the page table.
        hits = document_search.search_document_pages(A, SCAN_PHRASE)
        assert len(hits) == 1, f"Search cannot see the OCR text: {hits!r}"
        assert hits[0]["document_id"] == doc_id
        assert hits[0]["page_number"] == 1
        c.close()

    def test_the_page_carries_ocr_provenance_not_a_second_field(self, env):
        doc_id, _ = _attach(_scanned_pdf())
        ocr.set_adapter(fake_adapter)
        ocr.plan_document(doc_id)
        ocr.ocr_document(doc_id, fake_adapter)
        c = _conn()
        row = c.execute("SELECT text, text_origin FROM j2_note_document_pages"
                        " WHERE document_id = ?", (doc_id,)).fetchone()
        assert row["text_origin"] == ocr.ORIGIN_OCR
        assert SCAN_PHRASE in row["text"]
        c.close()

    def test_replacement_is_idempotent_in_the_table_AND_the_index(self, env):
        doc_id, _ = _attach(_scanned_pdf())
        ocr.set_adapter(fake_adapter)
        ocr.plan_document(doc_id)
        for _ in range(3):
            ocr.ocr_document(doc_id, fake_adapter, page_numbers=[1])
        c = _conn()
        assert c.execute("SELECT COUNT(*) c FROM j2_note_document_pages"
                         " WHERE document_id = ?", (doc_id,)).fetchone()["c"] == 1
        assert c.execute("SELECT COUNT(*) c FROM j2_note_document_pages_fts"
                         " WHERE document_id = ?", (doc_id,)).fetchone()["c"] == 1
        assert c.execute("SELECT COUNT(*) c FROM j2_note_document_pages_fts_map"
                         " WHERE document_id = ?", (doc_id,)).fetchone()["c"] == 1
        assert len(document_search.search_document_pages(A, SCAN_PHRASE)) == 1
        c.close()

    def test_replace_page_text_refuses_an_unknown_origin(self, env):
        c = _conn()
        with pytest.raises(ValueError):
            ocr.replace_page_text(c, document_id="d", user_id=A, page_number=1,
                                  text="x", text_origin="whatever")
        c.close()


# ── §11-§15 · coverage that describes what we actually possess ──────────────

class TestCoverageIsTruthful:
    def test_a_mixed_document_does_not_claim_the_scanned_page(self, env):
        # ⚰️ P0 measured this document as status=ready, pages_indexed=3, with
        # text lengths [492, 0, 781]. One readable page made the whole thing
        # look searched.
        doc_id, _ = _attach(_mixed_pdf())
        c = _conn()
        state = ocr.document_text_state(c, A, doc_id)
        assert state["pages_total"] == 3
        assert state["pages_with_text"] == 2
        assert state["text_complete"] is False
        c.close()

    def test_pages_indexed_now_counts_PAGES_not_ROWS(self, env):
        from api.services.journal_two import ask_retrieval as ar
        doc_id, _ = _attach(_mixed_pdf())
        c = _conn()
        cov = ar.document_coverage(c, A, doc_id)
        assert cov["pages_total"] == 3
        assert cov["pages_indexed"] == 2, "a row holding '' is not an indexed page"
        assert cov["text_complete"] is False
        c.close()

    def test_the_corpus_coverage_line_does_not_count_empty_pages(self, env):
        from api.services.journal_two import ask_retrieval as ar
        _attach(_mixed_pdf())
        c = _conn()
        assert ar.coverage(c, A)["document_pages_searchable"] == 2
        c.close()

    def test_a_document_becomes_complete_only_when_every_page_has_text(self, env):
        doc_id, _ = _attach(_mixed_pdf())
        ocr.set_adapter(fake_adapter)
        ocr.plan_document(doc_id)
        c = _conn()
        assert ocr.document_text_state(c, A, doc_id)["text_complete"] is False
        c.close()
        ocr.ocr_document(doc_id, fake_adapter)
        c = _conn()
        state = ocr.document_text_state(c, A, doc_id)
        assert state["pages_with_text"] == 3
        assert state["pages_from_ocr"] == 1
        assert state["text_complete"] is True
        assert ocr.derive_document_status(state) == ocr.DOC_READY
        c.close()

    def test_a_job_that_finished_cannot_make_an_empty_page_complete(self, env):
        # ⛔ §32 — job terminal state is not readiness. Forced directly, because
        # a corrupt job is exactly the case a happy-path run cannot produce.
        doc_id, _ = _attach(_scanned_pdf())
        ocr.set_adapter(fake_adapter)
        ocr.plan_document(doc_id)
        c = _conn()
        c.execute("UPDATE j2_note_document_ocr_pages SET status = ?"
                  " WHERE document_id = ?", (ocr.OCR_COMPLETE, doc_id))
        c.commit()
        state = ocr.document_text_state(c, A, doc_id)
        assert state["ocr_jobs"].get(ocr.OCR_COMPLETE) == 1
        assert state["pages_with_text"] == 0
        assert state["text_complete"] is False
        assert ocr.derive_document_status(state) == ocr.DOC_NO_TEXT
        c.close()


# ── §16/§41 · partial failure ───────────────────────────────────────────────

class TestPartialFailure:
    def test_one_failed_page_does_not_cost_the_others(self, env):
        doc_id, _ = _attach(_scanned_pdf(pages=3))
        ocr.set_adapter(fake_adapter)
        ocr.plan_document(doc_id)
        ocr.ocr_document(doc_id, fake_adapter, page_numbers=[1, 3])

        calls = {"n": 0}
        def only_page_two_fails(image):
            calls["n"] += 1
            raise RuntimeError("unreadable")
        ocr.ocr_document(doc_id, only_page_two_fails, page_numbers=[2])
        assert calls["n"] == 1

        c = _conn()
        state = ocr.document_text_state(c, A, doc_id)
        assert state["pages_with_text"] == 2
        assert state["text_complete"] is False
        assert len(document_search.search_document_pages(A, SCAN_PHRASE)) == 2
        row = c.execute("SELECT status, attempts, error_class FROM"
                        " j2_note_document_ocr_pages WHERE document_id = ?"
                        " AND page_number = 2", (doc_id,)).fetchone()
        assert row["status"] == ocr.OCR_FAILED
        assert row["attempts"] == 1
        c.close()

    def test_a_page_stops_being_retried_once_its_attempts_run_out(self, env):
        doc_id, _ = _attach(_scanned_pdf())
        ocr.set_adapter(fake_adapter)
        ocr.plan_document(doc_id)
        for _ in range(ocr.MAX_ATTEMPTS + 2):
            ocr.ocr_document(doc_id, failing_adapter)
        c = _conn()
        row = c.execute("SELECT attempts FROM j2_note_document_ocr_pages"
                        " WHERE document_id = ?", (doc_id,)).fetchone()
        assert row["attempts"] == ocr.MAX_ATTEMPTS
        assert ocr.pages_awaiting_ocr(c, doc_id) == []
        c.close()


# ── §20/§22 · restart recovery ──────────────────────────────────────────────

class TestRestartRecovery:
    def test_a_page_abandoned_by_a_restart_is_reclaimed_and_finishes(self, env):
        doc_id, _ = _attach(_scanned_pdf())
        ocr.set_adapter(fake_adapter)
        ocr.plan_document(doc_id)
        c = _conn()
        # A redeploy landed mid-page: the row says processing and nothing is
        # running. Aged past the window so it is abandoned, not in flight.
        stale = (datetime.now(timezone.utc) - ocr.STALLED_AFTER
                 - timedelta(minutes=1)).isoformat()
        c.execute("UPDATE j2_note_document_ocr_pages SET status = ?, started_at = ?"
                  " WHERE document_id = ?", (ocr.OCR_PROCESSING, stale, doc_id))
        c.commit()
        assert c.execute("SELECT status FROM j2_note_documents WHERE id = ?",
                         (doc_id,)).fetchone()["status"] == ocr.DOC_PENDING

        out = ocr.recover_stalled(c)
        assert out["reclaimed"] == 1
        assert ocr.pages_awaiting_ocr(c, doc_id) == [1]
        c.close()

        ocr.ocr_document(doc_id, fake_adapter)
        assert len(document_search.search_document_pages(A, SCAN_PHRASE)) == 1

    def test_recovery_does_not_steal_a_page_that_is_still_running(self, env):
        # ⛔ AGE, NOT PRESENCE. Reclaiming on sight would hand a live page to a
        # second writer and race two jobs over one row.
        doc_id, _ = _attach(_scanned_pdf())
        ocr.set_adapter(fake_adapter)
        ocr.plan_document(doc_id)
        c = _conn()
        c.execute("UPDATE j2_note_document_ocr_pages SET status = ?, started_at = ?"
                  " WHERE document_id = ?",
                  (ocr.OCR_PROCESSING, datetime.now(timezone.utc).isoformat(), doc_id))
        c.commit()
        assert ocr.recover_stalled(c)["reclaimed"] == 0
        c.close()

    def test_a_partly_done_document_finishes_without_reprocessing_the_done_pages(self, env):
        doc_id, _ = _attach(_scanned_pdf(pages=3))
        ocr.set_adapter(fake_adapter)
        ocr.plan_document(doc_id)
        ocr.ocr_document(doc_id, fake_adapter, page_numbers=[1])

        seen = []
        def counting(image):
            seen.append(1)
            return fake_adapter(image)
        ocr.ocr_document(doc_id, counting)     # the remaining pages only
        assert len(seen) == 2, "a completed page was reprocessed"
        c = _conn()
        assert ocr.document_text_state(c, A, doc_id)["text_complete"] is True
        c.close()


# ── §30/§31 · tenancy and lifecycle ─────────────────────────────────────────

class TestTenancyAndLifecycle:
    def test_another_members_document_yields_nothing(self, env):
        doc_id, _ = _attach(_scanned_pdf())
        ocr.set_adapter(fake_adapter)
        ocr.plan_document(doc_id)
        ocr.ocr_document(doc_id, fake_adapter)
        c = _conn()
        assert ocr.document_text_state(c, B, doc_id) == {"exists": False}
        assert document_search.search_document_pages(B, SCAN_PHRASE) == []
        c.close()

    def test_deleting_the_note_removes_the_ocr_text_index_and_job_state(self, env):
        doc_id, note_id = _attach(_scanned_pdf())
        ocr.set_adapter(fake_adapter)
        ocr.plan_document(doc_id)
        ocr.ocr_document(doc_id, fake_adapter)
        assert len(document_search.search_document_pages(A, SCAN_PHRASE)) == 1

        c = _conn()
        c.execute("DELETE FROM j2_notes WHERE id = ?", (note_id,))
        c.commit()
        # ⛔ NO GHOST SEARCH HIT after the source is gone.
        assert document_search.search_document_pages(A, SCAN_PHRASE) == []
        for table in ("j2_note_documents", "j2_note_document_pages",
                      "j2_note_document_ocr_pages", "j2_note_document_pages_fts",
                      "j2_note_document_pages_fts_map"):
            n = c.execute(f"SELECT COUNT(*) c FROM {table} WHERE document_id = ?"
                          if table != "j2_note_documents" else
                          f"SELECT COUNT(*) c FROM {table} WHERE id = ?",
                          (doc_id,)).fetchone()["c"]
            assert n == 0, f"{table} still holds rows for a deleted document"
        c.close()

    def test_the_ocr_table_is_in_the_account_purge_manifest(self, env):
        from api.services.journal_two import account_purge
        assert "j2_note_document_ocr_pages" in account_purge._DIRECT_USER_TABLES


# ── §23 · the door a member's editor reads ──────────────────────────────────

class TestTheDocumentStatusDoor:
    """A SERVICE RAIL IS NOT A ROUTE RAIL. The editor cannot render page truth
    it is never sent, and P0 found the editor renders no document status at
    all — so the payload is where this has to start."""

    def _client(self):
        from fastapi.testclient import TestClient
        from api.main import app
        from api.routers.journal_two import get_current_user
        app.dependency_overrides[get_current_user] = lambda: {"id": A}
        return TestClient(app)

    def test_the_payload_carries_page_truth_not_just_a_status(self, env):
        doc_id, note_id = _attach(_mixed_pdf())
        r = self._client().get(f"/api/j2/notes/{note_id}/documents")
        assert r.status_code == 200, r.text
        [d] = [x for x in r.json()["documents"] if x["id"] == doc_id]
        # ⚰️ The document says `ready` — and it is NOT complete. Both are true
        # and the member needs the second one.
        assert d["status"] == "ready"
        assert d["pagesTotal"] == 3
        assert d["pagesWithText"] == 2
        assert d["textComplete"] is False

    def test_a_fully_read_document_reports_complete(self, env):
        doc_id, note_id = _attach(_mixed_pdf())
        ocr.set_adapter(fake_adapter)
        ocr.plan_document(doc_id)
        ocr.ocr_document(doc_id, fake_adapter)
        r = self._client().get(f"/api/j2/notes/{note_id}/documents")
        [d] = [x for x in r.json()["documents"] if x["id"] == doc_id]
        assert d["textComplete"] is True
        assert d["pagesFromOcr"] == 1
