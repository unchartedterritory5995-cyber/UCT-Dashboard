"""Wave L Slice 1b — coverage, attribution and citation truthfulness in Ask.

The question these rails answer is not "does retrieval work" but "can the
synthesis layer tell what it actually has". A captured passage is the WHOLE of an
evidence item and a SLIVER of an article, and every one of these tests is about
not confusing the two.
"""
import pytest

from api.services.journal_two import ask_evidence as ev
from api.services.journal_two import web_capture_store as store


def page_row(capture_type, page_number=1, name="Reuters: NVDA Q3", **kw):
    row = {"document_id": "doc1", "user_id": "u1", "page_number": page_number,
           "name": name, "capture_type": capture_type}
    row.update(kw)
    return row


def excerpt_row(capture_type, page_number=1, **kw):
    row = {"id": "ex1", "user_id": "u1", "document_id": "doc1",
           "page_number": page_number, "document_name": "Reuters: NVDA Q3",
           "captured_text": "Management expects gross margins to normalize.",
           "capture_type": capture_type}
    row.update(kw)
    return row


# ── §1 Coverage travels with the evidence ────────────────────────────────────

class TestCoverageInTheEnvelope:
    def test_a_web_passage_page_carries_selected_passage_only(self):
        e = ev.from_document_page(page_row("web_passage"), snippet="margins normalize")
        assert e["coverage"] == ev.COVERAGE_PASSAGE_ONLY

    def test_a_web_reference_carries_metadata_only(self):
        e = ev.from_document_page(page_row("web_reference"), snippet="")
        assert e["coverage"] == ev.COVERAGE_METADATA_ONLY

    def test_a_PDF_page_still_carries_document_complete(self):
        # Wave I/J semantics preserved: this is the control that proves the
        # mapping is not returning one constant.
        e = ev.from_document_page(page_row("pdf_full_text"), snippet="x")
        assert e["coverage"] == ev.COVERAGE_COMPLETE

    def test_a_row_with_NO_capture_type_is_treated_as_a_pre_wave_L_pdf(self):
        row = page_row("pdf_full_text"); row.pop("capture_type")
        assert ev.from_document_page(row, snippet="x")["coverage"] == ev.COVERAGE_COMPLETE

    def test_a_web_excerpt_carries_selected_passage_only(self):
        e = ev.from_excerpt(excerpt_row("web_passage"), anchor_ok=True)
        assert e["coverage"] == ev.COVERAGE_PASSAGE_ONLY

    def test_every_evidence_item_carries_SOME_coverage(self):
        # A consumer that never receives the field cannot even try to be
        # truthful, so absence is the failure mode worth pinning.
        e = ev.make_evidence(source_type=ev.NOTE, source_id="n1", user_id="u1", label="N")
        assert e["coverage"] in ev.COVERAGES

    def test_an_unknown_coverage_is_REFUSED_not_silently_accepted(self):
        with pytest.raises(ValueError):
            ev.make_evidence(source_type=ev.NOTE, source_id="n1", user_id="u1",
                             label="N", coverage="the_whole_internet")

    def test_selected_passage_only_can_NEVER_map_to_document_complete(self):
        # The single boundary this slice exists to defend.
        assert ev.coverage_for("web_passage") != ev.COVERAGE_COMPLETE
        assert ev.coverage_for("web_reference") != ev.COVERAGE_COMPLETE
        for ctype in ("web_passage", "web_reference"):
            for maker, kw in ((ev.from_document_page, {"snippet": "s"}),
                              (ev.from_excerpt, {"anchor_ok": True})):
                row = page_row(ctype) if maker is ev.from_document_page else excerpt_row(ctype)
                assert maker(row, **kw)["coverage"] != ev.COVERAGE_COMPLETE


# ── §1 Adversarial: the corpus boundary under questioning ────────────────────

class TestAdversarialCoverage:
    def test_one_captured_passage_yields_NO_evidence_for_the_rest_of_the_article(self):
        # "What does the rest of this article say?" — the corpus contains one
        # passage. There is no evidence item representing the remainder, and the
        # one item present says so.
        items = [ev.from_excerpt(excerpt_row("web_passage"), anchor_ok=True)]
        assert len(items) == 1
        assert all(i["coverage"] == ev.COVERAGE_PASSAGE_ONLY for i in items)
        assert not any(i["coverage"] == ev.COVERAGE_COMPLETE for i in items)

    def test_a_reference_only_capture_offers_NO_body_text_to_answer_from(self):
        # "Summarize this article" with only a WEB_REFERENCE: the evidence
        # carries no article text, so the honest outcome is a coverage-limited
        # no-answer rather than model-general inference.
        e = ev.from_document_page(page_row("web_reference"), snippet="")
        assert e["text"] == ""
        assert e["coverage"] == ev.COVERAGE_METADATA_ONLY

    def test_a_matching_passage_IS_answerable_and_cites_the_capture(self):
        # "What did I save about margins?" — this must still work. A boundary
        # that refused everything would be safe and useless.
        e = ev.from_excerpt(excerpt_row("web_passage"), anchor_ok=True)
        assert "margins" in e["text"]
        assert e["navigation"]["kind"] == "excerpt"
        assert e["navigation"]["excerpt_id"] == "ex1"


# ── §2 Source claim vs member belief, through serialization ──────────────────

class TestAttributionSurvivesSerialization:
    def test_source_text_and_member_annotation_stay_in_SEPARATE_fields(self):
        e = ev.from_excerpt(
            excerpt_row("web_passage", annotation="I think this is too optimistic."),
            anchor_ok=True)
        assert e["text"] == "Management expects gross margins to normalize."
        assert e["payload"]["annotation"] == "I think this is too optimistic."
        # ⛔ The member's belief is never inside the quoted evidence. A response
        # can say "the source says X; you annotated Y" only because these two
        # never merged.
        assert "too optimistic" not in e["text"]

    def test_an_excerpt_with_no_annotation_carries_no_empty_belief_field(self):
        e = ev.from_excerpt(excerpt_row("web_passage"), anchor_ok=True)
        assert "annotation" not in e["payload"]


# ── §3 Citation must not invent article pagination ───────────────────────────

class TestCitationTruthfulness:
    def test_a_web_capture_is_labelled_a_CAPTURED_PASSAGE_not_a_page(self):
        e = ev.from_document_page(page_row("web_passage", page_number=2), snippet="s")
        assert "captured passage 2" in e["label"]
        assert "p.2" not in e["label"], "capture order is not article pagination"

    def test_a_web_EXCERPT_is_labelled_the_same_way(self):
        e = ev.from_excerpt(excerpt_row("web_passage", page_number=3), anchor_ok=True)
        assert "captured passage 3" in e["label"]
        assert "p.3" not in e["label"]

    def test_a_PDF_page_STILL_says_p_N(self):
        # Control: real pagination keeps its real label, so the assertions above
        # are not passing because the label never says "p." at all.
        e = ev.from_document_page(page_row("pdf_full_text", page_number=4), snippet="s")
        assert "p.4" in e["label"]

    def test_the_storage_page_number_is_still_available_for_navigation(self):
        # The implementation detail survives where machines need it; it just
        # never reaches the member as article pagination.
        e = ev.from_excerpt(excerpt_row("web_passage", page_number=2), anchor_ok=True)
        assert e["navigation"]["page_number"] == 2


# ── The store's coverage helper agrees with the envelope's ───────────────────

class TestOneVocabulary:
    def test_the_store_and_the_envelope_cannot_disagree(self):
        for ctype in (store.CAPTURE_PDF_FULL_TEXT, store.CAPTURE_WEB_PASSAGE,
                      store.CAPTURE_WEB_REFERENCE):
            assert store.capture_coverage({"capture_type": ctype}) == ev.coverage_for(ctype)

    def test_the_store_re_exports_rather_than_redefines(self):
        assert store.COVERAGE_PASSAGE_ONLY is ev.COVERAGE_PASSAGE_ONLY
        assert store.COVERAGE_COMPLETE is ev.COVERAGE_COMPLETE
