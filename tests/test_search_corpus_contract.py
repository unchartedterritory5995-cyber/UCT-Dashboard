"""Wave M — the retrieval corpus contract.

⭐⭐ THE CORRECTION THIS FILE RECORDS. Wave L closed with a residual saying
"Notebook Search does not reach captured/document text". **That was measured on
the wrong surface.** It is true of `GET /api/j2/notes?q=` (whose FTS index is
title + body_plain by design) and NOT true of the member's Search, which has
rendered three sections since Waves I and J — Notes, Documents, Evidence — and
already reaches captured passages through the latter two.

⛔ SO THE REAL DEFECT WAS NOT REACH, IT WAS TRUTH. A captured web source is a
`j2_note_documents` row whose passages are page rows, and `page_number` there is
a CAPTURE ORDINAL. Both sections rendered it as `· p.N`, so a second passage
clipped from one article was shown as "page 2" of a web article that has no
pages. These tests pin the corpus (each kind reachable, tenant-scoped,
lifecycle-correct) and the source-kind that lets the surface say what it found.
"""
from __future__ import annotations

import uuid

import pytest

from api.services import auth_db
from api.services.journal_two import document_search, excerpt_search
from api.services.journal_two import notes as notes_svc
from api.services.journal_two import web_capture as wc
from api.services.journal_two import web_capture_store as wcs

A = "u-corpus-a"
B = "u-corpus-b"
# ⛔ A UNIQUE TOKEN PER TEST. `auth_db.init_db()` reuses one database across the
# file, so a passage worded the same way in two tests makes the second one match
# the FIRST one's leftovers — which is how the trash test "failed" while passing
# in isolation. The token, not the prose, is what each assertion searches for.
PASSAGE_TMPL = "Gross margin {tok} normalizes toward the mid-70s next year."
SECOND_TMPL = "Customer concentration {tok} increased again this year."


def _tok() -> str:
    return "zq" + uuid.uuid4().hex[:8]


def _note(user: str, title: str = "NVDA research"):
    return notes_svc.create_note(user, {
        "title": title, "ticker": "NVDA",
        "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]},
    })


def _capture(user: str, note_id: str, passage: str, url="https://reuters.com/nvda"):
    return wcs.capture_web_source(user, note_id, {
        "tier": wc.TIER_PASSAGE, "url": url, "title": "Reuters: NVDA margins",
        "passage": passage, "annotation": "my own read",
    })


@pytest.fixture()
def captured():
    auth_db.init_db()
    n = _note(A)
    tok = _tok()
    _capture(A, n["id"], PASSAGE_TMPL.format(tok=tok))
    n["tok"] = tok
    return n


class TestTheCorpusIsReachable:
    """§15 — the minimum success criterion."""

    def test_a_captured_passage_is_found_by_its_own_words(self, captured):
        hits = document_search.search_document_pages(A, captured["tok"])
        assert hits, "a captured passage is not reachable from document search"
        assert any("margin" in (h["snippet"] or "").lower() for h in hits)

    def test_the_same_passage_is_found_as_saved_evidence(self, captured):
        assert excerpt_search.search_excerpts(A, captured["tok"])

    def test_each_hit_names_its_note_so_it_can_navigate(self, captured):
        for h in document_search.search_document_pages(A, captured["tok"]):
            assert h["note_id"] and h["note_title"], "a result with no destination is a dead end"


class TestSourceKindTruth:
    """§8 — the result must say what it is."""

    def test_a_web_capture_reports_source_kind_web(self, captured):
        hits = document_search.search_document_pages(A, captured["tok"])
        assert hits[0]["source_kind"] == wc.SOURCE_KIND_WEB
        assert hits[0]["source_url"]

    def test_excerpt_results_carry_it_too(self, captured):
        hits = excerpt_search.search_excerpts(A, captured["tok"])
        assert hits[0]["source_kind"] == wc.SOURCE_KIND_WEB

    def test_the_page_number_of_a_web_capture_is_an_ORDINAL(self, captured):
        # ⛔ The fact that makes the label a lie: capture a SECOND passage from
        # the same article and it becomes "2". Nothing about that is a page.
        tok2 = _tok()
        _capture(A, captured["id"], SECOND_TMPL.format(tok=tok2))
        hits = document_search.search_document_pages(A, tok2)
        assert hits and hits[0]["page_number"] == 2
        assert hits[0]["source_kind"] == wc.SOURCE_KIND_WEB


class TestTenantIsolation:
    """§32 — no cross-tenant result, and no existence oracle either."""

    def test_another_member_cannot_find_it(self, captured):
        assert document_search.search_document_pages(B, captured["tok"]) == []
        assert excerpt_search.search_excerpts(B, captured["tok"]) == []

    def test_and_the_owner_still_can_CONTROL(self, captured):
        # ⭐ Non-vacuity: without this, the isolation test above would pass on a
        # search that returns nothing for anybody.
        assert document_search.search_document_pages(A, captured["tok"])


class TestLifecycle:
    """§21 — no ghost results after the source goes away."""

    def test_trashing_the_note_removes_its_captures_from_search(self, captured):
        assert document_search.search_document_pages(A, captured["tok"])
        notes_svc.delete_note(A, captured["id"])
        assert document_search.search_document_pages(A, captured["tok"]) == []
        assert excerpt_search.search_excerpts(A, captured["tok"]) == []

    def test_restoring_it_brings_them_back_without_a_reindex(self, captured):
        notes_svc.delete_note(A, captured["id"])
        notes_svc.restore_note(A, captured["id"])
        assert document_search.search_document_pages(A, captured["tok"]), (
            "restore must return captured material to search automatically")
