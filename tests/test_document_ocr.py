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


# ── §17-§27 · the OCR output usability gate ─────────────────────────────────

# The real noise Tesseract emitted for a page unreadable by construction.
# ⛔ NOT INVENTED FOR THE TEST — captured from the engine, so the rail is
# pinned to what actually happens rather than to what garbage looks like in
# somebody's imagination.
NOISE = ("meee conpenanon COMDENDED CONTA DATED STATEMENTS OF ue ter ented "
         "baptembe 8 2616 oe eres ont 1) Oe ot tee eee Oe ee ma are an 8 "
         "Ceeret ort) 2 ee ape ee ed Pet eae Pew eee ie ee at oe OP oped "
         "© De eo yee one ee ey tery er oer ett $ «ewe ~~ ere ee re eee eo ee")
NOISE_TOKEN = "conpenanon"      # appears only in the rejected output


def noisy_adapter(_image) -> ocr.OcrPageResult:
    return ocr.OcrPageResult(text=NOISE, engine=ENGINE,
                             engine_version=ENGINE_VERSION)


class TestUsabilityGate:
    def test_it_accepts_a_page_that_is_mostly_numbers(self):
        # ⛔ §19 — the failure a naive prose test would produce. A real segment
        # table has FEWER word-like tokens and a LOWER alphanumeric ratio than
        # the noise page; rejecting it would hide genuine research.
        assert ocr.text_is_usable(
            "REVENUE BY SEGMENT (in millions) Segment Data Center Gaming Total "
            "Q3 2026 $9,242 $2,856 $12,913 Change 51% (6%) 32%") is True

    def test_it_accepts_ticker_and_acronym_heavy_text(self):
        assert ocr.text_is_usable("NVDA EBITDA FCF 10-Q $12.48 74.3% AMD") is True

    def test_it_accepts_a_sparse_but_real_slide(self):
        # Only 14 tokens — a count-based gate would have rejected this while
        # accepting the 64-token noise page.
        assert ocr.text_is_usable(
            "DATA CENTER MOMENTUM Ql Q2 Q3 Q4E Revenue reached "
            "$12.48 billion in the quarter.") is True

    def test_it_rejects_the_noise_the_engine_actually_produced(self):
        assert ocr.text_is_usable(NOISE) is False

    def test_it_rejects_empty_and_near_empty_output(self):
        assert ocr.text_is_usable("") is False
        assert ocr.text_is_usable("   ") is False
        assert ocr.text_is_usable("oe ~") is False

    def test_it_decides_and_never_rewrites(self):
        # ⛔ §18 — the gate returns a verdict. It has no transform to apply, so
        # there is nothing it could silently "correct".
        assert ocr.text_is_usable(NOISE) in (True, False)


class TestUnusableOutputNeverBecomesText:
    def test_the_page_is_not_stored_and_the_document_is_not_complete(self, env):
        # ⛔ §23 — job execution success is not usable-text success.
        doc_id, _ = _attach(_scanned_pdf())
        ocr.set_adapter(noisy_adapter)
        ocr.plan_document(doc_id)
        res = ocr.ocr_document(doc_id, noisy_adapter)
        assert res["pages_read"] == 0
        assert res["pages_failed"] == 1

        c = _conn()
        row = c.execute("SELECT text, text_origin FROM j2_note_document_pages"
                        " WHERE document_id = ?", (doc_id,)).fetchone()
        # ⛔ §24 — the rejected text is NOT persisted. Only the reason is.
        assert row["text"] == ""
        assert row["text_origin"] == ocr.ORIGIN_NATIVE
        state = ocr.document_text_state(c, A, doc_id)
        assert state["pages_with_text"] == 0
        assert state["text_complete"] is False
        assert ocr.derive_document_status(state) == ocr.DOC_NO_TEXT
        job = c.execute("SELECT status, error_class, attempts FROM"
                        " j2_note_document_ocr_pages WHERE document_id = ?",
                        (doc_id,)).fetchone()
        assert job["status"] == ocr.OCR_FAILED
        assert job["error_class"] == "unusable_output"
        c.close()

    def test_the_garbage_never_reaches_SEARCH(self, env):
        # ⛔⛔ §27 — THE RAIL THAT MATTERS. The gate must sit BEFORE the
        # FTS-safe write, not in front of the UI. Storing noise and hiding it
        # at render time would be the same defect wearing a different coat.
        doc_id, _ = _attach(_scanned_pdf())
        ocr.set_adapter(noisy_adapter)
        ocr.plan_document(doc_id)
        ocr.ocr_document(doc_id, noisy_adapter)
        assert document_search.search_document_pages(A, NOISE_TOKEN) == []
        assert document_search.search_document_pages(A, "baptembe") == []

    def test_a_quality_rejection_does_not_burn_three_identical_retries(self, env):
        # The same bytes through the same engine produce the same noise, so
        # retrying is pure waste. Bounded in ONE step, not three.
        doc_id, _ = _attach(_scanned_pdf())
        ocr.set_adapter(noisy_adapter)
        ocr.plan_document(doc_id)
        calls = []
        def counting(image):
            calls.append(1)
            return noisy_adapter(image)
        ocr.ocr_document(doc_id, counting)
        ocr.ocr_document(doc_id, counting)   # nothing left to attempt
        assert len(calls) == 1
        c = _conn()
        assert ocr.pages_awaiting_ocr(c, doc_id) == []
        c.close()

    def test_a_good_page_beside_a_bad_one_still_lands(self, env):
        # §16/§41 — partial failure isolation survives the gate.
        doc_id, _ = _attach(_scanned_pdf(pages=2))
        ocr.set_adapter(fake_adapter)
        ocr.plan_document(doc_id)
        ocr.ocr_document(doc_id, fake_adapter, page_numbers=[1])
        ocr.ocr_document(doc_id, noisy_adapter, page_numbers=[2])
        c = _conn()
        state = ocr.document_text_state(c, A, doc_id)
        assert state["pages_with_text"] == 1
        assert state["text_complete"] is False
        c.close()
        assert len(document_search.search_document_pages(A, SCAN_PHRASE)) == 1
        assert document_search.search_document_pages(A, NOISE_TOKEN) == []


# ── §29/§30/§35 · the REAL Tesseract adapter ────────────────────────────────

from api.services.journal_two import document_ocr_tesseract as tess  # noqa: E402

_TESS_BIN = tess.binary_path() or (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    if pathlib.Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe").exists()
    else None)
_TESS_VER = tess.engine_version(_TESS_BIN) if _TESS_BIN else None


class TestTheEngineIsDarkByDefault:
    """⛔ THESE RUN EVERYWHERE, with or without a binary — the half of this
    story that must never be skipped is that OCR stays OFF unless somebody
    deliberately turns it on."""

    def test_no_flag_means_no_adapter_even_with_a_binary_present(self, env, monkeypatch):
        monkeypatch.delenv(tess.FLAG, raising=False)
        state = tess.install_if_enabled()
        assert state["flag"] is False
        assert state["active"] is False
        assert ocr.ocr_available() is False

    def test_the_flag_alone_cannot_arm_it_without_a_working_binary(self, env, monkeypatch):
        # ⛔ "Meant to be on but the binary is missing" is a DIFFERENT
        # operational fact from "off", and only one of them is a defect.
        monkeypatch.setenv(tess.FLAG, "1")
        monkeypatch.setenv("TESSERACT_BINARY", "/nonexistent/tesseract")
        monkeypatch.setattr(tess.shutil, "which", lambda _n: None)
        monkeypatch.setattr(tess.os.path, "exists", lambda _p: False)
        state = tess.install_if_enabled()
        assert state["flag"] is True and state["active"] is False
        assert ocr.ocr_available() is False

    def test_the_fingerprint_reports_capability_and_no_content(self, env):
        line = tess.startup_fingerprint()
        assert line.startswith("[startup] j2-ocr:")
        for field in ("flag=", "binary=", "version=", "active="):
            assert field in line


@pytest.mark.skipif(_TESS_BIN is None,
                    reason="no tesseract binary on this machine — the real-engine "
                           "rail cannot run here (the dark-by-default rails above "
                           "still do)")
class TestRealTesseractThroughTheWholePipeline:
    def test_a_scanned_page_becomes_findable_in_SEARCH(self, env, monkeypatch):
        # ⭐ THE WHOLE CHAIN, REAL ENGINE: upload -> classify -> OCR ->
        # usability gate -> FTS-safe replacement -> production Search.
        monkeypatch.setenv(tess.FLAG, "1")
        monkeypatch.setenv("TESSERACT_BINARY", _TESS_BIN)
        assert tess.install_if_enabled()["active"] is True

        doc_id, _ = _attach(_scanned_pdf())
        assert document_search.search_document_pages(A, "CONDENSED") == []
        ocr.plan_document(doc_id)
        res = ocr.ocr_document(doc_id, ocr.get_adapter())
        assert res["pages_read"] == 1, res

        hits = document_search.search_document_pages(A, "CONDENSED")
        assert len(hits) == 1, "the real engine's text is not searchable"
        assert hits[0]["document_id"] == doc_id and hits[0]["page_number"] == 1
        # ⛔ The financial figures a member would search for, verbatim.
        for term in ("margin", "revenue", "billion"):
            assert document_search.search_document_pages(A, term), term
        c = _conn()
        row = c.execute("SELECT text_origin FROM j2_note_document_pages"
                        " WHERE document_id = ?", (doc_id,)).fetchone()
        assert row["text_origin"] == ocr.ORIGIN_OCR
        assert ocr.document_text_state(c, A, doc_id)["text_complete"] is True
        c.close()

    def test_the_engine_records_its_own_identity_for_debugging(self, env, monkeypatch):
        monkeypatch.setenv(tess.FLAG, "1")
        monkeypatch.setenv("TESSERACT_BINARY", _TESS_BIN)
        tess.install_if_enabled()
        doc_id, _ = _attach(_scanned_pdf())
        ocr.plan_document(doc_id)
        ocr.ocr_document(doc_id, ocr.get_adapter())
        c = _conn()
        job = c.execute("SELECT engine, engine_version FROM"
                        " j2_note_document_ocr_pages WHERE document_id = ?",
                        (doc_id,)).fetchone()
        assert job["engine"] == "tesseract"
        assert "tesseract" in (job["engine_version"] or "").lower()
        c.close()

    def test_a_mixed_document_reaches_complete_only_after_the_scan_is_read(self, env, monkeypatch):
        monkeypatch.setenv(tess.FLAG, "1")
        monkeypatch.setenv("TESSERACT_BINARY", _TESS_BIN)
        tess.install_if_enabled()
        doc_id, _ = _attach(_mixed_pdf())
        c = _conn()
        assert ocr.document_text_state(c, A, doc_id)["text_complete"] is False
        c.close()
        ocr.plan_document(doc_id)
        ocr.ocr_document(doc_id, ocr.get_adapter())
        c = _conn()
        st = ocr.document_text_state(c, A, doc_id)
        assert st["pages_with_text"] == 3 and st["pages_from_ocr"] == 1
        assert st["text_complete"] is True
        c.close()


# ── Wave P2 §19/§21/§22 · the member has to be able to SEE the provenance ────

class TestProvenanceReachesTheMember:
    """⛔ A FACT THE PIPELINE KNOWS AND THE MEMBER NEVER SEES IS NOT A FEATURE.
    `text_origin` has been correct on the page row since P1; these rails are
    about it surviving all the way to the surface that is about to have a
    figure quoted off it."""

    def _client(self):
        from fastapi.testclient import TestClient
        from api.main import app
        from api.routers.journal_two import get_current_user
        app.dependency_overrides[get_current_user] = lambda: {"id": A}
        return TestClient(app)

    def test_search_says_the_text_was_read_from_a_scan(self, env):
        doc_id, _ = _attach(_scanned_pdf())
        ocr.set_adapter(fake_adapter)
        ocr.plan_document(doc_id)
        ocr.ocr_document(doc_id, fake_adapter)
        [hit] = document_search.search_document_pages(A, SCAN_PHRASE)
        assert hit["text_origin"] == ocr.ORIGIN_OCR

    def test_a_natively_extracted_page_is_not_labelled_scanned(self, env):
        # ⛔ THE NEGATIVE HALF. A label that appears on everything says nothing,
        # and one that appears on a native page is a false warning.
        # `page_clean` hands back the page's LINES, not one string.
        _, native_lines = fx.page_clean()
        words = [w.strip(".,%$()") for w in " ".join(native_lines).split()]
        term = max((w for w in words if w.isalpha()), key=len)
        doc_id, _ = _attach(_native_pdf(), name="native.pdf")
        hits = [h for h in document_search.search_document_pages(A, term)
                if h["document_id"] == doc_id]
        assert hits, f"the native fixture is not searchable for {term!r}"
        assert all(h["text_origin"] == ocr.ORIGIN_NATIVE for h in hits)

    def test_provenance_adds_a_fact_never_a_row(self, env):
        # ⛔⛔ THE JOIN IS THE RISK. Reading `text_origin` means joining the
        # canonical page table back onto an FTS hit; a join on the wrong key
        # would silently duplicate every result, and the member would see the
        # same page listed twice with no way to tell which was real.
        doc_id, _ = _attach(_scanned_pdf(2))
        ocr.set_adapter(fake_adapter)
        ocr.plan_document(doc_id)
        ocr.ocr_document(doc_id, fake_adapter)
        hits = document_search.search_document_pages(A, SCAN_PHRASE)
        keys = [(h["document_id"], h["page_number"]) for h in hits]
        assert sorted(keys) == [(doc_id, 1), (doc_id, 2)]
        assert len(keys) == len(set(keys)), f"the join duplicated rows: {keys}"

    def test_the_search_payload_carries_provenance(self, env):
        doc_id, _ = _attach(_scanned_pdf())
        ocr.set_adapter(fake_adapter)
        ocr.plan_document(doc_id)
        ocr.ocr_document(doc_id, fake_adapter)
        r = self._client().get(f"/api/j2/notes/documents/search?q={SCAN_PHRASE}")
        assert r.status_code == 200, r.text
        [res] = [x for x in r.json()["results"] if x["documentId"] == doc_id]
        assert res["textOrigin"] == ocr.ORIGIN_OCR

    def test_provenance_does_not_change_what_the_result_IS(self, env):
        # ⛔ §20: the hit is a DOCUMENT at a real page, not an "OCR object".
        # Provenance rides along; it never becomes the identity.
        doc_id, note_id = _attach(_scanned_pdf(), name="filing.pdf")
        ocr.set_adapter(fake_adapter)
        ocr.plan_document(doc_id)
        ocr.ocr_document(doc_id, fake_adapter)
        r = self._client().get(f"/api/j2/notes/documents/search?q={SCAN_PHRASE}")
        [res] = [x for x in r.json()["results"] if x["documentId"] == doc_id]
        assert res["sourceKind"] == "attachment"
        assert res["pageNumber"] == 1
        assert res["name"] == "filing.pdf"
        assert res["noteId"] == note_id
        # …and the page is reachable, which is the whole point of §22.
        assert res["attachmentUrl"]


class TestAClaimNobodyCanServeIsNotProcessing:
    """⚰️ §19 — 'reading scanned text…' must not be forever. Pages are claimed
    only while an engine exists, but the claim outlives the capability: turn
    the flag off, rebuild without the binary, and the member is left watching a
    spinner that can never resolve."""

    def test_claimed_pages_with_no_engine_report_unservable(self, env):
        doc_id, _ = _attach(_scanned_pdf())
        ocr.set_adapter(fake_adapter)
        ocr.plan_document(doc_id)             # claims page 1
        ocr.set_adapter(None)                 # …and the engine goes away
        c = _conn()
        st = ocr.document_text_state(c, A, doc_id)
        c.close()
        assert st["pages_awaiting_ocr"] == 1
        assert st["ocr_unavailable"] is True

    def test_the_same_pages_with_an_engine_are_simply_pending(self, env):
        # ⛔ THE CONTROL. Without it this rail would pass for a version that
        # always said "unservable", which would replace one lie with another.
        doc_id, _ = _attach(_scanned_pdf())
        ocr.set_adapter(fake_adapter)
        ocr.plan_document(doc_id)
        c = _conn()
        st = ocr.document_text_state(c, A, doc_id)
        c.close()
        assert st["pages_awaiting_ocr"] == 1
        assert st["ocr_unavailable"] is False

    def test_a_document_with_nothing_claimed_is_never_unservable(self, env):
        doc_id, _ = _attach(_native_pdf(), name="native.pdf")
        c = _conn()
        st = ocr.document_text_state(c, A, doc_id)
        c.close()
        assert st["pages_awaiting_ocr"] == 0
        assert st["ocr_unavailable"] is False

    def test_the_payload_tells_the_editor_so_it_can_stop_saying_reading(self, env):
        doc_id, note_id = _attach(_scanned_pdf())
        ocr.set_adapter(fake_adapter)
        ocr.plan_document(doc_id)
        ocr.set_adapter(None)
        from fastapi.testclient import TestClient
        from api.main import app
        from api.routers.journal_two import get_current_user
        app.dependency_overrides[get_current_user] = lambda: {"id": A}
        r = TestClient(app).get(f"/api/j2/notes/{note_id}/documents")
        [d] = [x for x in r.json()["documents"] if x["id"] == doc_id]
        assert d["pagesAwaitingOcr"] == 1
        assert d["ocrUnavailable"] is True
