"""Wave J — Document Intelligence II: excerpts / highlights / annotations.
Backend unit tests: the excerpt table + note-content sidecar, thesis-evidence
document_excerpt integration, excerpt search, cascade delete, and
account-purge coverage.
"""
from __future__ import annotations

import sqlite3

import pytest

from api.services.journal_two import notes as notes_svc
from api.services.journal_two import note_excerpts, excerpt_search, thesis_evidence, document_extraction
from api.services.journal_two.db import ensure_schema


@pytest.fixture(autouse=True)
def _no_real_entity_master(monkeypatch):
    from api.services.entity_master import api as entity_master

    def _fake_resolve(alias, as_of=None, **kw):
        return entity_master.ResolveResult(status="not_found")
    monkeypatch.setattr(entity_master, "resolve", _fake_resolve)


@pytest.fixture
def conn(tmp_path):
    c = sqlite3.connect(tmp_path / "j2_test.db")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    yield c
    c.close()


USER = "u1"
OTHER_USER = "u2"


def _note(conn, user_id=USER, **kw):
    return notes_svc.create_note(user_id, kw, conn=conn)


def _document(conn, user_id, note_id, name="report.pdf"):
    return document_extraction.create_document(user_id, note_id, f"/api/j2/notes/attachments/{user_id}/{note_id}/file/x.pdf", name, conn=conn)


# ── create_excerpt ────────────────────────────────────────────────────────

def test_create_excerpt_happy_path(conn):
    note = _note(conn, title="NVDA Research")
    doc = _document(conn, USER, note["id"])
    excerpt = note_excerpts.create_excerpt(
        USER, note["id"], document_id=doc["id"], page_number=17,
        captured_text="Management expects gross margins to normalize lower",
        quote_prefix="...guidance context. ", quote_suffix=" This was reiterated.",
        annotation="Weakens my margin-expansion assumption",
        conn=conn,
    )
    assert excerpt["pageNumber"] == 17
    assert excerpt["capturedText"] == "Management expects gross margins to normalize lower"
    assert excerpt["annotation"] == "Weakens my margin-expansion assumption"
    assert excerpt["modifiedAt"] is None


def test_create_excerpt_requires_captured_text(conn):
    note = _note(conn)
    doc = _document(conn, USER, note["id"])
    with pytest.raises(note_excerpts.ExcerptValidationError):
        note_excerpts.create_excerpt(USER, note["id"], document_id=doc["id"], page_number=1, captured_text="  ", conn=conn)


def test_create_excerpt_rejects_a_note_belonging_to_another_user(conn):
    note = _note(conn, user_id=OTHER_USER)
    doc = _document(conn, OTHER_USER, note["id"])
    with pytest.raises(note_excerpts.ExcerptValidationError):
        note_excerpts.create_excerpt(USER, note["id"], document_id=doc["id"], page_number=1, captured_text="x", conn=conn)


def test_create_excerpt_rejects_a_document_belonging_to_another_user(conn):
    """Two-sided re-verification (checkpoint decision 37): a note the
    caller genuinely owns is not enough authorization for a document id
    that belongs to someone else."""
    my_note = _note(conn, user_id=USER)
    foreign_note = _note(conn, user_id=OTHER_USER)
    foreign_doc = _document(conn, OTHER_USER, foreign_note["id"])
    with pytest.raises(note_excerpts.ExcerptValidationError):
        note_excerpts.create_excerpt(USER, my_note["id"], document_id=foreign_doc["id"], page_number=1, captured_text="x", conn=conn)


def test_create_excerpt_truncates_quote_context_server_side(conn):
    note = _note(conn)
    doc = _document(conn, USER, note["id"])
    long_ctx = "x" * 500
    excerpt = note_excerpts.create_excerpt(
        USER, note["id"], document_id=doc["id"], page_number=1, captured_text="quote",
        quote_prefix=long_ctx, quote_suffix=long_ctx, conn=conn,
    )
    assert len(excerpt["quotePrefix"]) == note_excerpts._MAX_QUOTE_CONTEXT_CHARS
    assert len(excerpt["quoteSuffix"]) == note_excerpts._MAX_QUOTE_CONTEXT_CHARS


# ── note-content sidecar (j2_note_excerpt_refs) ──────────────────────────────

def test_list_note_excerpts_reads_through_the_refs_sidecar_not_bare_note_id(conn):
    """Mirrors note_facts.list_note_facts exactly: an excerpt only shows up
    for a note once its documentExcerpt node is actually saved into that
    note's body -- creating the row alone is not enough (checkpoint's own
    'rebuildable projection, never edited directly' contract)."""
    note = _note(conn, title="NVDA Research")
    doc = _document(conn, USER, note["id"])
    excerpt = note_excerpts.create_excerpt(USER, note["id"], document_id=doc["id"], page_number=1, captured_text="quote", conn=conn)

    assert note_excerpts.list_note_excerpts(USER, note["id"], conn=conn) == []

    notes_svc.append_document_excerpt(USER, note["id"], excerpt["id"], conn=conn)
    listed = note_excerpts.list_note_excerpts(USER, note["id"], conn=conn)
    assert len(listed) == 1
    assert listed[0]["id"] == excerpt["id"]


def test_append_document_excerpt_returns_none_for_a_foreign_note(conn):
    note = _note(conn, user_id=OTHER_USER)
    assert notes_svc.append_document_excerpt(USER, note["id"], "fake-excerpt-id", conn=conn) is None


def test_removing_the_node_from_a_notes_body_drops_it_from_the_sidecar_but_not_the_row(conn):
    """Editor-local node removal must NOT delete the underlying excerpt --
    it may still be referenced by a thesis in a different note (checkpoint
    decision 56/72/73)."""
    note = _note(conn, title="NVDA Research")
    doc = _document(conn, USER, note["id"])
    excerpt = note_excerpts.create_excerpt(USER, note["id"], document_id=doc["id"], page_number=1, captured_text="quote", conn=conn)
    notes_svc.append_document_excerpt(USER, note["id"], excerpt["id"], conn=conn)
    assert len(note_excerpts.list_note_excerpts(USER, note["id"], conn=conn)) == 1

    # Save the note with an EMPTY body (simulates the member deleting the
    # node in the editor, then saving).
    notes_svc.update_note(USER, note["id"], {"bodyJson": {"type": "doc", "content": []}}, conn=conn)
    assert note_excerpts.list_note_excerpts(USER, note["id"], conn=conn) == []
    # The row itself is untouched.
    assert note_excerpts.get_excerpt(USER, excerpt["id"], conn=conn) is not None


# ── update_excerpt_annotation / delete_excerpt ───────────────────────────────

def test_update_excerpt_annotation_never_touches_captured_text(conn):
    note = _note(conn)
    doc = _document(conn, USER, note["id"])
    excerpt = note_excerpts.create_excerpt(USER, note["id"], document_id=doc["id"], page_number=1, captured_text="original quote", conn=conn)
    updated = note_excerpts.update_excerpt_annotation(USER, excerpt["id"], "new annotation", conn=conn)
    assert updated["capturedText"] == "original quote"
    assert updated["annotation"] == "new annotation"
    assert updated["modifiedAt"] is not None


def test_update_excerpt_annotation_rejects_a_foreign_excerpt(conn):
    note = _note(conn, user_id=OTHER_USER)
    doc = _document(conn, OTHER_USER, note["id"])
    excerpt = note_excerpts.create_excerpt(OTHER_USER, note["id"], document_id=doc["id"], page_number=1, captured_text="x", conn=conn)
    assert note_excerpts.update_excerpt_annotation(USER, excerpt["id"], "hijacked", conn=conn) is None


def test_delete_excerpt_rejects_a_foreign_excerpt(conn):
    note = _note(conn, user_id=OTHER_USER)
    doc = _document(conn, OTHER_USER, note["id"])
    excerpt = note_excerpts.create_excerpt(OTHER_USER, note["id"], document_id=doc["id"], page_number=1, captured_text="x", conn=conn)
    assert note_excerpts.delete_excerpt(USER, excerpt["id"], conn=conn) is False
    assert note_excerpts.get_excerpt(OTHER_USER, excerpt["id"], conn=conn) is not None


# ── cascade delete ────────────────────────────────────────────────────────

def test_deleting_the_source_document_cascades_the_excerpt(conn):
    """checkpoint decision 57: a citation must never claim a purged
    document still exists."""
    note = _note(conn)
    doc = _document(conn, USER, note["id"])
    excerpt = note_excerpts.create_excerpt(USER, note["id"], document_id=doc["id"], page_number=1, captured_text="x", conn=conn)
    conn.execute("DELETE FROM j2_note_documents WHERE id = ?", (doc["id"],))
    conn.commit()
    assert note_excerpts.get_excerpt(USER, excerpt["id"], conn=conn) is None


def test_deleting_the_owning_note_cascades_the_excerpt_and_refs(conn):
    note = _note(conn)
    doc = _document(conn, USER, note["id"])
    excerpt = note_excerpts.create_excerpt(USER, note["id"], document_id=doc["id"], page_number=1, captured_text="x", conn=conn)
    notes_svc.append_document_excerpt(USER, note["id"], excerpt["id"], conn=conn)
    conn.execute("DELETE FROM j2_notes WHERE id = ?", (note["id"],))
    conn.commit()
    assert note_excerpts.get_excerpt(USER, excerpt["id"], conn=conn) is None
    assert conn.execute("SELECT COUNT(*) c FROM j2_note_excerpt_refs WHERE note_id = ?", (note["id"],)).fetchone()["c"] == 0


# ── thesis evidence integration (document_excerpt target type) ──────────────

def test_thesis_evidence_accepts_a_document_excerpt_target(conn):
    thesis_note = _note(conn, title="NVDA Thesis")
    source_note = _note(conn, title="NVDA Investor Deck Research")
    doc = _document(conn, USER, source_note["id"])
    excerpt = note_excerpts.create_excerpt(
        USER, source_note["id"], document_id=doc["id"], page_number=17,
        captured_text="Management expects gross margins to normalize lower",
        conn=conn,
    )
    evidence = thesis_evidence.add_evidence(
        USER, thesis_note["id"], target_type="document_excerpt", target_id=excerpt["id"],
        stance="opposes", caption="Directly weakens my margin-expansion assumption",
        conn=conn,
    )
    assert evidence["targetType"] == "document_excerpt"
    assert evidence["stance"] == "opposes"
    listed = thesis_evidence.list_note_evidence(USER, thesis_note["id"], conn=conn)
    assert len(listed) == 1 and listed[0]["id"] == evidence["id"]


def test_thesis_evidence_rejects_a_document_excerpt_belonging_to_another_user(conn):
    thesis_note = _note(conn, user_id=USER, title="Thesis")
    foreign_note = _note(conn, user_id=OTHER_USER)
    foreign_doc = _document(conn, OTHER_USER, foreign_note["id"])
    foreign_excerpt = note_excerpts.create_excerpt(OTHER_USER, foreign_note["id"], document_id=foreign_doc["id"], page_number=1, captured_text="x", conn=conn)
    with pytest.raises(thesis_evidence.ThesisEvidenceValidationError):
        thesis_evidence.add_evidence(USER, thesis_note["id"], target_type="document_excerpt", target_id=foreign_excerpt["id"], stance="supports", conn=conn)


def test_the_same_excerpt_can_support_one_thesis_and_oppose_another(conn):
    """checkpoint decision 73: stance belongs to the evidence EDGE, never
    baked into the excerpt itself."""
    bull_thesis = _note(conn, title="NVDA Bull Thesis")
    bear_thesis = _note(conn, title="NVDA Bear Thesis")
    source_note = _note(conn, title="NVDA Investor Deck")
    doc = _document(conn, USER, source_note["id"])
    excerpt = note_excerpts.create_excerpt(USER, source_note["id"], document_id=doc["id"], page_number=17, captured_text="margin commentary", conn=conn)

    ev_bull = thesis_evidence.add_evidence(USER, bull_thesis["id"], target_type="document_excerpt", target_id=excerpt["id"], stance="supports", conn=conn)
    ev_bear = thesis_evidence.add_evidence(USER, bear_thesis["id"], target_type="document_excerpt", target_id=excerpt["id"], stance="opposes", conn=conn)
    assert ev_bull["stance"] == "supports"
    assert ev_bear["stance"] == "opposes"
    assert ev_bull["targetId"] == ev_bear["targetId"] == excerpt["id"]


# ── excerpt search ────────────────────────────────────────────────────────

def test_search_excerpts_finds_captured_text_and_annotation(conn):
    note = _note(conn, title="NVDA Research")
    doc = _document(conn, USER, note["id"])
    note_excerpts.create_excerpt(
        USER, note["id"], document_id=doc["id"], page_number=17,
        captured_text="Management expects gross margins to normalize lower",
        annotation="Weakens my margin-expansion assumption",
        conn=conn,
    )
    by_quote = excerpt_search.search_excerpts(USER, "margins", conn=conn)
    assert len(by_quote) == 1
    assert by_quote[0]["page_number"] == 17
    by_annotation = excerpt_search.search_excerpts(USER, "assumption", conn=conn)
    assert len(by_annotation) == 1


def test_search_excerpts_is_tenant_scoped(conn):
    note = _note(conn, user_id=OTHER_USER)
    doc = _document(conn, OTHER_USER, note["id"])
    note_excerpts.create_excerpt(OTHER_USER, note["id"], document_id=doc["id"], page_number=1, captured_text="unique_search_token_xyz", conn=conn)
    assert excerpt_search.search_excerpts(USER, "unique_search_token_xyz", conn=conn) == []


def test_search_excerpts_excludes_a_trashed_notes_excerpts(conn):
    note = _note(conn, title="NVDA Research")
    doc = _document(conn, USER, note["id"])
    note_excerpts.create_excerpt(USER, note["id"], document_id=doc["id"], page_number=1, captured_text="unique_trash_token_abc", conn=conn)
    assert len(excerpt_search.search_excerpts(USER, "unique_trash_token_abc", conn=conn)) == 1
    notes_svc.delete_note(USER, note["id"], conn=conn)
    assert excerpt_search.search_excerpts(USER, "unique_trash_token_abc", conn=conn) == []


def test_annotation_edit_updates_the_fts_index(conn):
    note = _note(conn)
    doc = _document(conn, USER, note["id"])
    excerpt = note_excerpts.create_excerpt(USER, note["id"], document_id=doc["id"], page_number=1, captured_text="quote text", conn=conn)
    assert excerpt_search.search_excerpts(USER, "originalannotationterm", conn=conn) == []
    note_excerpts.update_excerpt_annotation(USER, excerpt["id"], "originalannotationterm", conn=conn)
    assert len(excerpt_search.search_excerpts(USER, "originalannotationterm", conn=conn)) == 1
    note_excerpts.update_excerpt_annotation(USER, excerpt["id"], "revisedannotationterm", conn=conn)
    assert excerpt_search.search_excerpts(USER, "originalannotationterm", conn=conn) == []
    assert len(excerpt_search.search_excerpts(USER, "revisedannotationterm", conn=conn)) == 1


# ── account purge coverage ────────────────────────────────────────────────

def test_account_purge_removes_excerpts_and_refs(conn):
    from api.services.journal_two import account_purge
    note = _note(conn)
    doc = _document(conn, USER, note["id"])
    excerpt = note_excerpts.create_excerpt(USER, note["id"], document_id=doc["id"], page_number=1, captured_text="x", conn=conn)
    notes_svc.append_document_excerpt(USER, note["id"], excerpt["id"], conn=conn)
    account_purge.purge_user_data(USER, conn=conn)
    assert conn.execute("SELECT COUNT(*) c FROM j2_note_excerpts WHERE user_id = ?", (USER,)).fetchone()["c"] == 0
    assert conn.execute("SELECT COUNT(*) c FROM j2_note_excerpt_refs WHERE user_id = ?", (USER,)).fetchone()["c"] == 0
