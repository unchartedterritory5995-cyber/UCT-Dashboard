"""Wave N §1/§11 — the export must not turn a web capture into a PDF page.

⚰️ FOUND BY THE §1 DOWNSTREAM AUDIT, and it is the exact conflation the audit
was ordered to look for. `_resolve_thesis_evidence_by_note` labels EVERY
`document_excerpt` target as `"{document name}, p.{page_number}"` — the
"page-is-the-citation-unit" convention Wave J established when the only thing
that target type could be was a real PDF excerpt.

Wave N makes a captured web passage attachable under that same target type. So
an exported thesis would read:

    Reuters: NVDA margins, p.2

⛔ That is Wave M's `· p.N` defect surviving into the ONE surface that leaves
UCT entirely and lands in the member's permanent archive — and §11 forbids
serialising a web capture as a fake paginated attachment.

⭐ THE TARGET TYPE IS THE RELATIONAL NAMESPACE, NOT THE SOURCE SEMANTICS. The
fix is not a second taxonomy; it is that every consumer must disambiguate on
`source_kind`, which the row has carried since Wave L.
"""
from __future__ import annotations

import sqlite3
import uuid

import pytest

from api.services import auth_db
from api.services.auth_db import get_connection
from api.services.journal_two import notes as notes_svc
from api.services.journal_two import notes_export
from api.services.journal_two import thesis_evidence as te
from api.services.journal_two import web_capture as wc
from api.services.journal_two import web_capture_store as wcs

U = "u-export-truth"
SOURCE = "Gross margin {tok} normalizes toward the mid-70s next year."
MINE = "I think management is too optimistic."


def _tok() -> str:
    return "zq" + uuid.uuid4().hex[:8]


def _attach_capture(note_id: str, tok: str) -> str:
    res = wcs.capture_web_source(U, note_id, {
        "tier": wc.TIER_PASSAGE, "url": "https://www.reuters.com/markets/nvda",
        "title": "Reuters: NVDA margins",
        "passage": SOURCE.format(tok=tok), "annotation": MINE,
    })
    excerpt_id = res["excerpt"]["id"]
    te.add_evidence(U, note_id, target_type="document_excerpt",
                    target_id=excerpt_id, stance="opposes",
                    caption="cuts against the long case")
    return excerpt_id


@pytest.fixture()
def exported():
    auth_db.init_db()
    n = notes_svc.create_note(U, {
        "title": "NVDA thesis", "ticker": "NVDA",
        "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]},
    })
    tok = _tok()
    _attach_capture(n["id"], tok)
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    try:
        by_note = notes_export._resolve_thesis_evidence_by_note(conn, U, [n["id"]])
    finally:
        conn.close()
    return {"note": n, "tok": tok, "evidence": by_note.get(n["id"], [])}


class TestTheExportedLabel:
    def test_the_evidence_is_exported_at_all(self, exported):
        assert exported["evidence"], "an attached capture vanished from the export"

    def test_it_is_NOT_labelled_as_a_page(self, exported):
        # ⛔ THE DEFECT. "Reuters: NVDA margins, p.2" claims a paginated source
        # that does not exist, in the artefact the member keeps forever.
        label = exported["evidence"][0]["targetLabel"]
        assert "p.2" not in label, f"a web capture was exported as a page: {label!r}"
        assert "p." not in label, f"a web capture was exported with pagination: {label!r}"

    def test_it_still_names_its_source(self, exported):
        # Removing the lie must not remove the provenance.
        label = exported["evidence"][0]["targetLabel"]
        assert "Reuters: NVDA margins" in label

    def test_the_stance_and_caption_survive(self, exported):
        row = exported["evidence"][0]
        assert row["stance"] == "opposes"
        assert row["caption"] == "cuts against the long case"


class TestTheDocumentControl:
    """⭐ §8 — the real-PDF path must keep its real page."""

    def test_a_real_document_excerpt_still_exports_with_its_page(self):
        auth_db.init_db()
        n = notes_svc.create_note(U, {
            "title": "NVDA thesis pdf", "ticker": "NVDA",
            "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]},
        })
        conn = get_connection()
        conn.row_factory = sqlite3.Row
        try:
            doc_id = uuid.uuid4().hex
            conn.execute(
                "INSERT INTO j2_note_documents"
                " (id, user_id, note_id, attachment_url, name, status, page_count,"
                "  created_at, source_kind)"
                " VALUES (?,?,?,?,?,?,?,datetime('now'),?)",
                (doc_id, U, n["id"], "/files/nvda-10q.pdf", "NVDA 10-Q", "ready", 80,
                 wc.SOURCE_KIND_ATTACHMENT))
            ex_id = uuid.uuid4().hex
            conn.execute(
                "INSERT INTO j2_note_excerpts"
                " (id, user_id, note_id, document_id, page_number, captured_text,"
                "  char_start, char_end, created_at)"
                " VALUES (?,?,?,?,?,?,?,?,datetime('now'))",
                (ex_id, U, n["id"], doc_id, 47, "Management expects margins to normalise",
                 0, 38))
            conn.commit()
            te.add_evidence(U, n["id"], target_type="document_excerpt",
                            target_id=ex_id, stance="supports", conn=conn)
            conn.commit()
            by_note = notes_export._resolve_thesis_evidence_by_note(conn, U, [n["id"]])
        finally:
            conn.close()
        label = by_note[n["id"]][0]["targetLabel"]
        assert "NVDA 10-Q" in label
        assert "p.47" in label, (
            f"the real-document path lost its page while fixing the web one: {label!r}")
