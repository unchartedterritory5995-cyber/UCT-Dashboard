"""A DOCUMENT citation carries its KIND, so the client can open a PDF at its page.

⚰️ THE GAP. A document-page citation's navigation was
`{kind:'document', document_id, page_number, note_id}` -- enough to name the
page, not enough to open it truthfully. A captured web passage is ALSO a
document page (`web_capture_store` writes one per passage), and opening that in
the PDF viewer is Wave N §9's defect: a viewer over a `web:<sha256>` identity.
So every host opened the owning note at the top instead.

⭐ The server now adds:
  - `source_kind` -- "attachment" | "web", decided by `ask_evidence.is_web_capture`,
    the one server answer to "is this row a web capture?", over the same
    `j2_note_documents` columns the excerpt read and the search queries select;
    ABSENT when the row's query selected neither capture column (an old schema),
    so the client keeps its old behaviour instead of trusting a guess;
  - `excerpt_id`, for a web page only -- the excerpt `capture_web_source` wrote
    beside it, through which the member revisits a captured passage.

Real schema (`auth_db.init_db`), real capture writer, real retrieval SQL for
every scope: a hand-built row cannot see a query that forgot a column (Wave N §1).
"""
from __future__ import annotations

import pathlib
import re
import sqlite3
import uuid

import pytest

from api.services import auth_db
from api.services.auth_db import get_connection
from api.services.journal_two import ask_evidence as ev
from api.services.journal_two import ask_retrieval as ar
from api.services.journal_two import ask_service
from api.services.journal_two import notes as notes_svc
from api.services.journal_two import web_capture as wc
from api.services.journal_two import web_capture_store as wcs

U = "u-docnav"
REPO = pathlib.Path(__file__).resolve().parent.parent


def _tok() -> str:
    return "zq" + uuid.uuid4().hex[:8]


@pytest.fixture()
def corpus():
    auth_db.init_db()
    note = notes_svc.create_note(U, {
        "title": "NVDA research", "ticker": "NVDA",
        "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]},
    })
    pdf_tok, web_tok = _tok(), _tok()
    conn = get_connection()
    try:
        pdf_id = uuid.uuid4().hex
        conn.execute(
            "INSERT INTO j2_note_documents"
            " (id, user_id, note_id, attachment_url, name, status, page_count,"
            "  created_at, source_kind, capture_type)"
            " VALUES (?,?,?,?,?,?,?,datetime('now'),?,?)",
            (pdf_id, U, note["id"], "/api/j2/notes/attachments/u/n/file/q3.pdf", "Q3 10-Q",
             "ready", 80, wc.SOURCE_KIND_ATTACHMENT, "pdf_full_text"))
        conn.execute(
            "INSERT INTO j2_note_document_pages (document_id, user_id, page_number, text)"
            " VALUES (?,?,?,?)",
            (pdf_id, U, 47, f"Gross margin {pdf_tok} compressed to 71 percent."))
        conn.commit()
    finally:
        conn.close()
    captured = wcs.capture_web_source(U, note["id"], {
        "tier": wc.TIER_PASSAGE, "url": "https://www.reuters.com/markets/nvda",
        "title": "Reuters: NVDA margins",
        "passage": f"Analysts expect margins {web_tok} to normalize next year.",
    })
    return {"note": note, "pdf_id": pdf_id, "pdf_tok": pdf_tok,
            "web_id": captured["document"]["id"], "web_tok": web_tok,
            "web_page": captured["page_number"], "web_excerpt": captured["excerpt"]["id"]}


def _pages(items, doc_id):
    return [i for i in items if i["source_type"] == ev.DOCUMENT_PAGE
            and i["navigation"].get("document_id") == doc_id]


# Every scope's REAL page query, read BEFORE the packet dedupe (which would fold
# a web page into the excerpt it shares a lineage with).
SCOPES = {
    "notebook": lambda c, k, doc_id, tok: ar._document_pages(c, U, tok, 10),
    "document": lambda c, k, doc_id, tok: ar._document_pages_scoped(c, U, doc_id, tok, 10),
    "note": lambda c, k, doc_id, tok: ar._document_pages_in_note(c, U, k["note"]["id"], tok, 10),
    "security": lambda c, k, doc_id, tok: ar._entity_documents(c, U, [k["note"]["id"]], tok, 10),
}


@pytest.mark.parametrize("scope", sorted(SCOPES))
def test_a_PDF_page_carries_its_kind_and_no_excerpt(corpus, scope):
    conn = get_connection()
    try:
        items = SCOPES[scope](conn, corpus, corpus["pdf_id"], corpus["pdf_tok"])
    finally:
        conn.close()
    [page] = _pages(items, corpus["pdf_id"])
    assert page["navigation"] == {
        "kind": "document", "document_id": corpus["pdf_id"], "page_number": 47,
        "note_id": corpus["note"]["id"], "source_kind": wc.SOURCE_KIND_ATTACHMENT,
    }


@pytest.mark.parametrize("scope", sorted(SCOPES))
def test_a_WEB_page_carries_its_kind_and_its_capture_excerpt(corpus, scope):
    conn = get_connection()
    try:
        items = SCOPES[scope](conn, corpus, corpus["web_id"], corpus["web_tok"])
    finally:
        conn.close()
    [page] = _pages(items, corpus["web_id"])
    nav = page["navigation"]
    assert nav["source_kind"] == wc.SOURCE_KIND_WEB
    assert nav["excerpt_id"] == corpus["web_excerpt"]
    assert nav["page_number"] == corpus["web_page"]


def test_a_web_page_whose_excerpt_is_gone_carries_the_kind_and_no_excerpt(corpus):
    conn = get_connection()
    try:
        conn.execute("DELETE FROM j2_note_excerpts WHERE id = ?", (corpus["web_excerpt"],))
        conn.commit()
        items = ar._document_pages_scoped(conn, U, corpus["web_id"], corpus["web_tok"], 10)
    finally:
        conn.close()
    [page] = _pages(items, corpus["web_id"])
    assert page["navigation"]["source_kind"] == wc.SOURCE_KIND_WEB
    assert "excerpt_id" not in page["navigation"]


def test_the_PDF_citation_reaches_the_member_through_a_real_scope(corpus):
    # End to end, past the packet: retrieve_document -> public_source.
    got = ar.retrieve_document(U, corpus["pdf_id"], corpus["pdf_tok"])
    [page] = _pages(got["evidence"], corpus["pdf_id"])
    public = ask_service.public_source(1, page)
    assert public["navigation"]["source_kind"] == wc.SOURCE_KIND_ATTACHMENT
    assert public["navigation"]["page_number"] == 47


class TestNoKindIsNeverAGuess:
    """⛔ A row whose query selected neither capture column (a schema that
    predates captures) is NOT known to be a PDF. Calling it an attachment is how
    a captured passage once reached the PDF viewer."""

    def _row(self, **kw):
        row = {"document_id": "d1", "user_id": "u1", "page_number": 3,
               "name": "old.pdf", "note_id": "n1", "text_origin": "native"}
        row.update(kw)
        return row

    def test_a_row_without_the_capture_columns_carries_no_kind(self):
        nav = ev.from_document_page(self._row(), snippet="x")["navigation"]
        assert "source_kind" not in nav
        assert ev.document_source_kind(self._row()) is None

    def test_a_pre_wave_L_pdf_on_a_current_schema_IS_an_attachment(self):
        # The columns were asked, and are NULL: a PDF written before captures.
        row = self._row(capture_type=None, source_kind=None, source_url=None)
        assert ev.from_document_page(row, snippet="x")["navigation"]["source_kind"] == (
            wc.SOURCE_KIND_ATTACHMENT)

    def test_either_column_alone_says_web(self):
        assert ev.document_source_kind(self._row(capture_type="web_passage")) == wc.SOURCE_KIND_WEB
        assert ev.document_source_kind(self._row(source_kind="web")) == wc.SOURCE_KIND_WEB


def test_the_client_reads_the_SAME_two_values():
    """The browser acts on these strings, so its constants are READ, not restated
    here: `SOURCE_WEB` / `SOURCE_ATTACHMENT` (searchResultLabel.js -- what Search
    and the excerpt path already key on) must equal what `web_capture` writes,
    and the citation transport must route on THOSE constants, not a copy."""
    lib = REPO / "app" / "src" / "pages" / "journal-2-0" / "lib"
    label = (lib / "searchResultLabel.js").read_text(encoding="utf-8")
    web = re.search(r"export const SOURCE_WEB = '([^']+)'", label)
    att = re.search(r"export const SOURCE_ATTACHMENT = '([^']+)'", label)
    assert web and att, "a client kind constant moved -- re-point this rail"
    assert web.group(1) == wc.SOURCE_KIND_WEB
    assert att.group(1) == wc.SOURCE_KIND_ATTACHMENT
    transport = (lib / "openCitation.js").read_text(encoding="utf-8")
    assert re.search(r"import \{[^}]*\bSOURCE_WEB\b[^}]*\bSOURCE_ATTACHMENT\b[^}]*\}"
                     r" from '\./searchResultLabel'", transport)
    assert not re.search(r"=\s*'(web|attachment)'", transport), (
        "openCitation.js restates a kind value instead of importing it")
