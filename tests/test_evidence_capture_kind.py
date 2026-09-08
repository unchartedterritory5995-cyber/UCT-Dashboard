"""Wave N §1 — Ask must not call a captured web passage "page 1".

⚰️ THE DEFECT, and it is the shape §1 was ordered to look for. Wave L taught
`ask_evidence.passage_label` to say "captured passage" instead of "· p.N" for a
web capture, and `coverage_for` to report `selected_passage_only` instead of
`document_complete`. Both branches keyed on `capture_type`. **No Ask query
selected that column.** So across every scope a captured Reuters paragraph
reached the model AND the member's source list as:

    Reuters: NVDA margins · p.1        coverage: document_complete

— a page of an article that has no pages, and a claim to hold the whole piece
when we hold one paragraph the member clipped. The label goes into the prompt
(`ask_prompt`'s "label: …" line) and into `public_source`, so both the answer
and the citation the member clicks were wrong.

⭐ WHY IT STAYED GREEN. `test_web_capture_coverage.py` builds its rows BY HAND
with `capture_type` in them, so it proves the branch is correct and can say
nothing about whether any query supplies the column
(`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`). These tests go
through the REAL retrieval SQL for every scope, which is the only place the
omission is visible.

⛔ AND THERE IS A SECOND-AUTHORITY DEFECT UNDERNEATH: `capture_type` (Wave L)
and `source_kind` (Wave M) both answer "is this a web capture", and different
layers picked different columns. The envelope now accepts either — capture_type
first, because only it separates a passage from a reference-only capture.
"""
from __future__ import annotations

import sqlite3
import uuid

import pytest

from api.services import auth_db
from api.services.auth_db import get_connection
from api.services.journal_two import ask_evidence as ev
from api.services.journal_two import ask_retrieval as ar
from api.services.journal_two import notes as notes_svc
from api.services.journal_two import web_capture as wc
from api.services.journal_two import web_capture_store as wcs

U = "u-capkind"
PASSAGE = "Gross margin {tok} normalizes toward the mid-70s next year."


def _tok() -> str:
    return "zq" + uuid.uuid4().hex[:8]


@pytest.fixture()
def captured():
    auth_db.init_db()
    n = notes_svc.create_note(U, {
        "title": "NVDA thesis", "ticker": "NVDA",
        "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]},
    })
    tok = _tok()
    res = wcs.capture_web_source(U, n["id"], {
        "tier": wc.TIER_PASSAGE, "url": "https://www.reuters.com/markets/nvda",
        "title": "Reuters: NVDA margins", "passage": PASSAGE.format(tok=tok),
        "annotation": "I think management is too optimistic.",
    })
    return {"note": n, "tok": tok, "document_id": res["document"]["id"]}


def _labels(items):
    return [i.get("label") or "" for i in items]


class TestEveryAskScope:
    """⭐ EVERY SCOPE, because the omission was per-query, not per-branch."""

    def test_note_scope(self, captured):
        got = ar.retrieve_note(U, captured["note"]["id"], captured["tok"])
        assert got["evidence"], "the captured passage is not retrievable at all"
        for label in _labels(got["evidence"]):
            assert "p.1" not in label, f"a web capture was labelled as a page: {label!r}"

    def test_document_scope(self, captured):
        got = ar.retrieve_document(U, captured["document_id"], captured["tok"])
        assert got["evidence"], "the captured passage is not retrievable at all"
        for label in _labels(got["evidence"]):
            assert "p.1" not in label, f"a web capture was labelled as a page: {label!r}"

    def test_corpus_scope(self, captured):
        got = ar.retrieve(U, captured["tok"])
        found = [i for i in got["evidence"]
                 if i["source_type"] in (ev.DOCUMENT_PAGE, ev.DOCUMENT_EXCERPT)]
        assert found, "the captured passage is not retrievable at all"
        for label in _labels(found):
            assert "p.1" not in label, f"a web capture was labelled as a page: {label!r}"

    def test_it_still_names_its_source(self, captured):
        # ⛔ Removing the lie must not remove the provenance.
        got = ar.retrieve_note(U, captured["note"]["id"], captured["tok"])
        assert all("Reuters: NVDA margins" in l for l in _labels(got["evidence"]))


class TestCoverageIsNotOverclaimed:
    def test_a_captured_passage_never_claims_a_complete_document(self, captured):
        got = ar.retrieve_note(U, captured["note"]["id"], captured["tok"])
        for i in got["evidence"]:
            assert i["coverage"] != ev.COVERAGE_COMPLETE, (
                "one clipped paragraph was presented as the whole article")

    def test_and_the_corpus_scope_agrees(self, captured):
        got = ar.retrieve(U, captured["tok"])
        found = [i for i in got["evidence"]
                 if i["source_type"] in (ev.DOCUMENT_PAGE, ev.DOCUMENT_EXCERPT)]
        assert found
        for i in found:
            assert i["coverage"] != ev.COVERAGE_COMPLETE


class TestEitherColumnIsEnough:
    """⭐ The join between Wave L's column and Wave M's."""

    def test_capture_type_alone_answers(self):
        assert ev.is_web_capture({"capture_type": "web_passage"})
        assert ev.is_web_capture({"capture_type": "web_reference"})

    def test_source_kind_alone_answers(self):
        assert ev.is_web_capture({"source_kind": "web"})

    def test_a_source_kind_only_web_row_does_not_claim_completeness(self):
        # The honest floor when the finer column is absent.
        assert ev.coverage_for_row({"source_kind": "web"}) != ev.COVERAGE_COMPLETE

    def test_the_finer_column_WINS_over_the_coarser(self):
        # A reference-only capture holds NO body text. `source_kind` cannot say
        # that, so a row carrying both must be read by capture_type.
        assert ev.coverage_for_row(
            {"capture_type": "web_reference", "source_kind": "web"}
        ) == ev.COVERAGE_METADATA_ONLY

    def test_an_attachment_is_not_a_web_capture(self):
        assert not ev.is_web_capture({"capture_type": "pdf_full_text",
                                      "source_kind": "attachment"})


class TestTheDocumentControl:
    """⛔ §8. The fix must not cost the real-PDF path its real page."""

    @pytest.fixture()
    def pdf(self):
        auth_db.init_db()
        n = notes_svc.create_note(U, {
            "title": "NVDA filing", "ticker": "NVDA",
            "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]},
        })
        tok = _tok()
        conn = get_connection()
        conn.row_factory = sqlite3.Row
        try:
            doc_id = uuid.uuid4().hex
            conn.execute(
                "INSERT INTO j2_note_documents"
                " (id, user_id, note_id, attachment_url, name, status, page_count,"
                "  created_at, source_kind, capture_type)"
                " VALUES (?,?,?,?,?,?,?,datetime('now'),?,?)",
                (doc_id, U, n["id"], "/files/nvda-10q.pdf", "NVDA 10-Q", "ready", 80,
                 wc.SOURCE_KIND_ATTACHMENT, "pdf_full_text"))
            conn.execute(
                "INSERT INTO j2_note_document_pages"
                " (document_id, user_id, page_number, text)"
                " VALUES (?,?,?,?)",
                (doc_id, U, 47, PASSAGE.format(tok=tok)))
            conn.commit()
        finally:
            conn.close()
        return {"note": n, "tok": tok, "document_id": doc_id}

    def test_a_real_page_still_says_p47(self, pdf):
        got = ar.retrieve_note(U, pdf["note"]["id"], pdf["tok"])
        labels = _labels(got["evidence"])
        assert any("p.47" in l for l in labels), (
            f"the real-document path lost its page: {labels!r}")

    def test_a_real_document_still_reports_complete_coverage(self, pdf):
        got = ar.retrieve_note(U, pdf["note"]["id"], pdf["tok"])
        pages = [i for i in got["evidence"] if i["source_type"] == ev.DOCUMENT_PAGE]
        assert pages, "the PDF page was not retrieved"
        assert all(i["coverage"] == ev.COVERAGE_COMPLETE for i in pages)


class TestTheSchemaIsAsked:
    """⭐ THE OTHER HALF, and it is why Wave M left 28 Ask tests red.

    Wave M selected `source_kind`/`source_url` unconditionally. A schema that
    predates those columns — several Ask suites build a minimal one of exactly
    the tables they exercise — then raised `no such column` on every query.
    ⛔ A `no such column` catch could NOT fix that: it is indistinguishable
    from a real failure and would turn one into a confident empty result
    (`lesson_a_swallowed_error_becomes_a_confident_finding`). Asking the schema
    is the only way to tell "cannot hold a capture" from "something is broken".
    """

    def _conn(self, columns: str) -> sqlite3.Connection:
        c = sqlite3.connect(":memory:")
        c.execute(f"CREATE TABLE j2_note_documents (id TEXT{columns})")
        return c

    def test_a_schema_that_HAS_them_projects_all_three(self):
        c = self._conn(", capture_type TEXT, source_kind TEXT, source_url TEXT")
        try:
            cols = wc.capture_columns(c)
        finally:
            c.close()
        for name in wc.CAPTURE_COLUMNS:
            assert f"d.{name} AS {name}" in cols
        assert cols.startswith(", "), "the projection must splice into a SELECT"

    def test_a_schema_that_LACKS_them_projects_nothing(self):
        c = self._conn("")
        try:
            assert wc.capture_columns(c) == ""
        finally:
            c.close()

    def test_a_schema_with_no_such_table_projects_nothing(self):
        c = sqlite3.connect(":memory:")
        try:
            assert wc.capture_columns(c) == ""
        finally:
            c.close()

    def test_the_alias_is_the_callers(self):
        # ⛔ Every caller today joins the documents table as `d`, so this is
        # the one assertion here that is about a FUTURE caller: a hardcoded
        # "d." would splice a column reference that resolves to nothing and
        # the row would quietly stop announcing what it is — which is exactly
        # how this defect happened the first time.
        c = self._conn(", capture_type TEXT, source_kind TEXT, source_url TEXT")
        try:
            assert "docs.capture_type" in wc.capture_columns(c, alias="docs")
        finally:
            c.close()
