"""Wave N §6 — curation cannot manufacture corroboration.

Once a captured passage is attached to a thesis it becomes reachable TWO ways:

  A. as the captured research itself (a document page / saved excerpt), and
  B. through the thesis-evidence relationship.

⛔ THOSE ARE NOT TWO INDEPENDENT CORROBORATING SOURCES. They are one passage,
once, that the member also happened to file against a thesis. Attaching a quote
to a thesis says something about the MEMBER's judgement, not about how many
publishers said it — and an answer that counts it twice tells the member their
view is better supported than it is. That is the most expensive kind of wrong a
research tool can be.

⭐ The protection already exists and is deliberate: `from_excerpt` shares the
PAGE's `lineage_key`, and `_thesis_edge_evidence` MARKS an object already
retrieved rather than appending a new one. Wave N makes a NEW class of object
(a captured web passage) eligible for that edge, so these prove the invariant
survives for it — the §18 consumer-audit rule.
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
from api.services.journal_two import thesis_evidence as te
from api.services.journal_two import web_capture as wc
from api.services.journal_two import web_capture_store as wcs

U = "u-lineage"
PASSAGE = "Gross margin {tok} normalizes toward the mid-70s next year."


def _tok() -> str:
    return "zq" + uuid.uuid4().hex[:8]


@pytest.fixture()
def attached():
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
    te.add_evidence(U, n["id"], target_type="document_excerpt",
                    target_id=res["excerpt"]["id"], stance="opposes")
    return {"note": n, "tok": tok, "excerpt_id": res["excerpt"]["id"]}


def _lineage_keys(items):
    return [i.get("lineage_key") for i in items]


class TestOneSourceStaysOneSource:
    def test_the_captured_passage_is_retrievable_at_all(self, attached):
        got = ar.retrieve_note(U, attached["note"]["id"], attached["tok"])
        assert got["evidence"], "the attached capture is not retrievable"

    def test_the_page_and_the_excerpt_SHARE_one_lineage_key(self, attached):
        # ⛔ THE SEMANTIC ASSERTION §6 ASKS FOR — source IDENTITY, not a count.
        # A page hit and the saved excerpt of that same passage are the same
        # underlying claim, so they must collapse to one lineage.
        got = ar.retrieve_note(U, attached["note"]["id"], attached["tok"])
        keys = [k for k in _lineage_keys(got["evidence"]) if k and k.startswith("page:")]
        assert keys, "no page-lineage evidence was retrieved"
        assert len(set(keys)) == 1, (
            f"one captured passage produced {len(set(keys))} distinct lineages: {set(keys)}")

    def test_the_thesis_edge_MARKS_rather_than_adds(self, attached):
        # `_thesis_edge_evidence` looks the object up in `by_source` and returns
        # a STANCE-MARKED copy; it never fabricates a source. If it appended,
        # the same passage would corroborate itself.
        conn = get_connection()
        conn.row_factory = sqlite3.Row
        try:
            base = ev.from_excerpt(
                {"id": attached["excerpt_id"], "document_id": "d1", "page_number": 1,
                 "note_id": attached["note"]["id"], "captured_text": "x",
                 "annotation": None, "document_name": "Reuters", "user_id": U},
                anchor_ok=True)
            by_source = {f"document_excerpt:{attached['excerpt_id']}": base}
            marked = ar._thesis_edge_evidence(
                conn, U, [attached["note"]["id"]], by_source)
        finally:
            conn.close()
        assert marked, "the thesis edge did not mark the retrieved object"
        assert marked[0]["lineage_key"] == base["lineage_key"], (
            "attaching to a thesis changed the passage's lineage — it would then "
            "count as a second, independent corroborating source")

    def test_an_edge_whose_object_was_NOT_retrieved_adds_nothing(self, attached):
        # ⭐ The other half of "marks rather than adds": with an empty
        # by_source, a stance edge must produce NOTHING rather than inventing
        # a source the retrieval step never found.
        conn = get_connection()
        conn.row_factory = sqlite3.Row
        try:
            assert ar._thesis_edge_evidence(
                conn, U, [attached["note"]["id"]], {}) == []
        finally:
            conn.close()


class TestStanceIsNotTheSource:
    def test_marking_a_stance_does_not_rewrite_the_passage(self, attached):
        conn = get_connection()
        conn.row_factory = sqlite3.Row
        try:
            base = ev.from_excerpt(
                {"id": attached["excerpt_id"], "document_id": "d1", "page_number": 1,
                 "note_id": attached["note"]["id"],
                 "captured_text": PASSAGE.format(tok=attached["tok"]),
                 "annotation": "I think management is too optimistic.",
                 "document_name": "Reuters", "user_id": U},
                anchor_ok=True)
            marked = ar._thesis_edge_evidence(
                conn, U, [attached["note"]["id"]],
                {f"document_excerpt:{attached['excerpt_id']}": base})
        finally:
            conn.close()
        blob = str(marked[0])
        # §7: SOURCE ≠ MEMBER NOTE ≠ STANCE. The stance may be attached to the
        # object; it must never appear inside what the source is quoted saying.
        assert attached["tok"] in blob
        assert "opposes" not in str(marked[0].get("snippet") or "")
