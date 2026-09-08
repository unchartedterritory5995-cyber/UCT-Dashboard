"""Wave L Slice 1b — export truthfulness, member lifecycle, and search honesty.

These prove the REUSED Wave I/J paths behave correctly for a web capture. Where
Wave J already defines a rule, the rail proves the reused path rather than
inventing a second one.
"""
import uuid

import pytest

from api.services import auth_db
from api.services.journal_two import notes as notes_service
from api.services.journal_two import notes_export
from api.services.journal_two import web_capture_store as store

URL = "https://www.reuters.com/tech/nvda-q3?id=7"
PASSAGE = "Management expects gross margins to normalize through fiscal 2027."
BELIEF = "I think this is too optimistic."


@pytest.fixture()
def conn():
    auth_db.init_db()
    c = auth_db.get_connection()
    try:
        yield c
    finally:
        c.close()


def _user(conn):
    uid = uuid.uuid4().hex
    conn.execute("INSERT INTO users (id, email, password_hash, created_at)"
                 " VALUES (?,?,?,datetime('now'))", (uid, f"{uid}@t.local", "x"))
    conn.commit()
    return uid


def _capture(conn, tier="passage", passage=PASSAGE, annotation=BELIEF):
    u = _user(conn)
    n = notes_service.create_note(u, {"title": "NVDA"}, conn=conn)["id"]
    r = store.capture_web_source(u, n, {
        "tier": tier, "url": URL, "title": "Reuters: NVDA Q3",
        "passage": passage, "annotation": annotation}, conn=conn)
    return u, n, r


# ── §4 Export / portability ──────────────────────────────────────────────────

class TestExport:
    def test_a_web_passage_exports_as_a_CAPTURED_PASSAGE_never_as_a_page(self, conn):
        u, n, r = _capture(conn)
        resolve = notes_export._make_note_link_aware_resolver(u, conn, None, {})
        text, citation, annotation = resolve(
            f"{notes_export._DOCUMENT_EXCERPT_MARKER}{r['excerpt']['id']}")
        assert text == PASSAGE
        assert "captured passage 1" in citation
        assert ", p.1" not in citation, "a web capture has no article pagination"

    def test_the_export_carries_the_NAVIGABLE_source_url(self, conn):
        u, n, r = _capture(conn)
        resolve = notes_export._make_note_link_aware_resolver(u, conn, None, {})
        _, citation, _ = resolve(
            f"{notes_export._DOCUMENT_EXCERPT_MARKER}{r['excerpt']['id']}")
        assert URL in citation, "the member must be able to reach the original"

    def test_export_keeps_source_material_and_member_annotation_SEPARATE(self, conn):
        u, n, r = _capture(conn)
        resolve = notes_export._make_note_link_aware_resolver(u, conn, None, {})
        text, citation, annotation = resolve(
            f"{notes_export._DOCUMENT_EXCERPT_MARKER}{r['excerpt']['id']}")
        assert text == PASSAGE
        assert annotation == BELIEF
        assert BELIEF not in text and BELIEF not in citation

    def test_a_PDF_excerpt_STILL_exports_with_real_pagination(self, conn):
        # Control: Wave I/J behaviour is untouched, so the assertions above are
        # not passing because the exporter stopped saying "p." at all.
        u = _user(conn)
        n = notes_service.create_note(u, {"title": "N"}, conn=conn)["id"]
        did = uuid.uuid4().hex
        conn.execute(
            "INSERT INTO j2_note_documents (id, user_id, note_id, attachment_url, name,"
            " status, page_count, extraction_version, created_at)"
            " VALUES (?,?,?,?,?,?,?,?,datetime('now'))",
            (did, u, n, "/api/j2/notes/attachments/u/n/file/x.pdf", "10-K.pdf", "ready", 3, 1))
        conn.execute(
            "INSERT INTO j2_note_document_pages (document_id, user_id, page_number, text)"
            " VALUES (?,?,?,?)", (did, u, 2, "Risk factors include supply concentration."))
        from api.services.journal_two import note_excerpts
        ex = note_excerpts.create_excerpt(
            u, n, document_id=did, page_number=2,
            captured_text="Risk factors include supply concentration.", conn=conn)
        conn.commit()
        resolve = notes_export._make_note_link_aware_resolver(u, conn, None, {})
        _, citation, _ = resolve(f"{notes_export._DOCUMENT_EXCERPT_MARKER}{ex['id']}")
        assert ", p.2" in citation

    def test_a_deleted_source_is_OMITTED_never_fabricated(self, conn):
        u, n, r = _capture(conn)
        conn.execute("DELETE FROM j2_note_excerpts WHERE id = ?", (r["excerpt"]["id"],))
        conn.commit()
        resolve = notes_export._make_note_link_aware_resolver(u, conn, None, {})
        assert resolve(f"{notes_export._DOCUMENT_EXCERPT_MARKER}{r['excerpt']['id']}") is None


# ── §5 The ordinary member lifecycle (the REUSED Wave J path) ────────────────

class TestLifecycle:
    def test_a_capture_is_normally_visible(self, conn):
        u, n, r = _capture(conn)
        assert conn.execute(
            "SELECT COUNT(*) FROM j2_note_documents WHERE id = ? AND user_id = ?",
            (r["document"]["id"], u)).fetchone()[0] == 1

    def test_trashing_the_note_removes_it_from_normal_research(self, conn):
        u, n, r = _capture(conn)
        notes_service.delete_note(u, n, conn=conn)
        # Wave J's own rule, reused: `get_note`'s default `deleted_at IS NULL`
        # filter is what stops a trashed note's material being served.
        assert notes_service.get_note(u, n, conn=conn) is None

    def test_restoring_returns_the_capture_with_IDENTICAL_provenance(self, conn):
        u, n, r = _capture(conn)
        before = conn.execute(
            "SELECT attachment_url, source_url, capture_type FROM j2_note_documents"
            " WHERE id = ?", (r["document"]["id"],)).fetchone()
        notes_service.delete_note(u, n, conn=conn)
        notes_service.restore_note(u, n, conn=conn)
        after = conn.execute(
            "SELECT attachment_url, source_url, capture_type FROM j2_note_documents"
            " WHERE id = ?", (r["document"]["id"],)).fetchone()
        assert notes_service.get_note(u, n, conn=conn) is not None
        assert tuple(before) == tuple(after), "provenance must survive a round trip"
        assert conn.execute(
            "SELECT captured_text FROM j2_note_excerpts WHERE id = ?",
            (r["excerpt"]["id"],)).fetchone()[0] == PASSAGE

    def test_permanent_deletion_removes_the_private_captured_text(self, conn):
        u, n, r = _capture(conn)
        did = r["document"]["id"]
        conn.execute("DELETE FROM j2_notes WHERE id = ?", (n,))
        conn.commit()
        for table, col in (("j2_note_documents", "id"),
                           ("j2_note_document_pages", "document_id"),
                           ("j2_note_excerpts", "document_id")):
            assert conn.execute(
                f"SELECT COUNT(*) FROM {table} WHERE {col} = ?", (did,)).fetchone()[0] == 0


# ── §6 Search truthfulness ───────────────────────────────────────────────────

class TestSearchTruthfulness:
    def test_a_captured_passage_IS_findable_from_its_text(self, conn):
        u, n, r = _capture(conn)
        hits = conn.execute(
            "SELECT document_id FROM j2_note_document_pages"
            " WHERE user_id = ? AND text LIKE '%gross margins%'", (u,)).fetchall()
        assert any(h["document_id"] == r["document"]["id"] for h in hits)

    def test_a_search_hit_carries_the_capture_type_so_it_cannot_be_shown_as_a_whole_article(self, conn):
        u, n, r = _capture(conn)
        row = conn.execute(
            "SELECT capture_type FROM j2_note_documents WHERE id = ?",
            (r["document"]["id"],)).fetchone()
        assert row["capture_type"] == store.CAPTURE_WEB_PASSAGE
        # And the presentation layer's mapping is the one vocabulary.
        assert store.capture_coverage(row) == store.COVERAGE_PASSAGE_ONLY

    def test_a_reference_capture_stores_NO_body_text_to_match_on(self, conn):
        u, n, r = _capture(conn, tier="reference", passage="", annotation="")
        assert conn.execute(
            "SELECT COUNT(*) FROM j2_note_document_pages WHERE document_id = ?",
            (r["document"]["id"],)).fetchone()[0] == 0
