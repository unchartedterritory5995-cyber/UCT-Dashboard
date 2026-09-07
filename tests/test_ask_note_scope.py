"""Wave K Slice 6 — rails for Ask Current Note on the typed-evidence contract.

Wave 2 answered this scope by pasting up to 20k characters of note body into
the SYSTEM message. There was no addressable unit to cite, so the model was
asked to quote a phrase and the panel scraped its output with a regex.

The scope now presents the note as BLOCKS, each carrying a real ProseMirror
range. What is proved here:
  - every block is citable, with a location that verifies before it navigates
  - the whole note is still shown; only truncation order changed
  - a note that does not discuss the question still REFUSES
  - a member cannot ask about a note they do not own
"""
from __future__ import annotations

import sqlite3

import pytest

from api.services.journal_two import ask_evidence as ev
from api.services.journal_two import ask_retrieval as ar
from api.services.journal_two import note_citation_text as nct


def _doc(*paragraphs):
    return {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": p}]}
        for p in paragraphs]}


@pytest.fixture()
def conn(tmp_path):
    c = sqlite3.connect(tmp_path / "auth.db")
    c.row_factory = sqlite3.Row
    c.executescript(
        "CREATE TABLE j2_notes (id TEXT PRIMARY KEY, user_id TEXT, title TEXT,"
        " ticker TEXT, body_json TEXT, deleted_at TEXT);")
    return c


def _add(conn, nid, user_id, title, doc, deleted=None):
    import json
    conn.execute("INSERT INTO j2_notes (id,user_id,title,ticker,body_json,deleted_at)"
                 " VALUES (?,?,?,NULL,?,?)",
                 (nid, user_id, title, json.dumps(doc), deleted))
    conn.commit()


THESIS = _doc(
    "NVDA thesis: datacenter demand stays ahead of supply through 2027.",
    "Risk: margins compressed in Q3 as hyperscalers negotiated harder.",
    "Position sized at 4% with a stop under the 50-day.",
)


class TestEveryBlockIsCitable:
    def test_each_block_becomes_its_own_evidence_object(self, conn):
        _add(conn, "n1", "u1", "NVDA thesis", THESIS)
        out = ar.retrieve_note("u1", "n1", "margins", conn=conn)
        assert len(out["evidence"]) == 3

    def test_every_citation_carries_a_verifiable_location(self, conn):
        _add(conn, "n1", "u1", "NVDA thesis", THESIS)
        out = ar.retrieve_note("u1", "n1", "margins", conn=conn)
        for item in out["evidence"]:
            loc = item["location"]
            # ⛔ The location must VERIFY against the note before it is ever
            # used to navigate. A range that does not is how a citation lands
            # on the wrong paragraph.
            assert nct.verify(THESIS, loc["from"], loc["to"], item["text"])
            assert item["citation_validity"] == ev.CITE_EXACT

    def test_blocks_have_distinct_identities(self, conn):
        # Sharing one source_id would collapse the note to a single citable
        # point under lineage dedupe -- the member could only ever be sent to
        # one place in their own note.
        _add(conn, "n1", "u1", "NVDA thesis", THESIS)
        out = ar.retrieve_note("u1", "n1", "margins", conn=conn)
        ids = [i["source_id"] for i in out["evidence"]]
        assert len(set(ids)) == len(ids)
        assert len({i["lineage_key"] for i in out["evidence"]}) == 3

    def test_the_matching_block_ranks_first(self, conn):
        _add(conn, "n1", "u1", "NVDA thesis", THESIS)
        out = ar.retrieve_note("u1", "n1", "margins compressed", conn=conn)
        assert "margins compressed" in out["evidence"][0]["text"]


class TestTheWholeNoteIsStillShown:
    def test_non_matching_blocks_are_still_sent_as_context(self, conn):
        _add(conn, "n1", "u1", "NVDA thesis", THESIS)
        out = ar.retrieve_note("u1", "n1", "margins", conn=conn)
        kinds = {i["relevance"] for i in out["evidence"]}
        assert ev.QUERY_MATCH in kinds and ev.ENTITY_CONTEXT in kinds

    def test_the_context_ceiling_matches_what_wave_2_showed(self):
        # Migrating the prompt path must not quietly shrink what the model
        # sees. Same 20k as note_ask._NOTE_BODY_CAP was.
        assert ar.NOTE_SCOPE_MAX_CHARS == 20000

    def test_a_long_note_drops_its_least_relevant_blocks_not_its_tail(self, conn):
        filler = ["unrelated paragraph about scheduling " + "x" * 400
                  for _ in range(80)]
        doc = _doc(*filler, "margins compressed in Q3")
        _add(conn, "n1", "u1", "long", doc)
        out = ar.retrieve_note("u1", "n1", "margins", conn=conn)
        # The one relevant block is last in the document and would have been
        # cut by Wave 2's head-truncation at 20,000 characters.
        assert any("margins compressed" in i["text"] for i in out["evidence"])
        assert out["evidence_chars"] <= ar.NOTE_SCOPE_MAX_CHARS


class TestSingleSourceScopesDoNotCapThemselves:
    # ⛔ The per-type cap exists so one document cannot crowd out the member's
    # own note in a CORPUS-WIDE answer. Inside one note every candidate is the
    # same type by construction, so the default cap of 4 would silently reduce
    # any note to four paragraphs.

    def test_a_ten_paragraph_note_returns_ten_blocks(self, conn):
        doc = _doc(*[f"paragraph {i} about margins" for i in range(10)])
        _add(conn, "n1", "u1", "long", doc)
        out = ar.retrieve_note("u1", "n1", "margins", conn=conn)
        from api.services.journal_two import ask_ranking as rk
        assert len(out["evidence"]) == 10 > rk.MAX_PER_SOURCE_TYPE


class TestItStillRefuses:
    def test_a_note_that_does_not_discuss_the_question_refuses(self, conn):
        _add(conn, "n1", "u1", "Zoo notes", _doc("notes about the zoo trip"))
        out = ar.retrieve_note("u1", "n1", "what did I say about margins",
                               conn=conn)
        assert out["no_answer"] is True
        assert out["no_answer_reason"] == "not_in_this_note"

    def test_a_stopword_in_common_is_not_an_answer(self, conn):
        # ⛔ THE RAIL ON _content_terms. "about" appears in both the question
        # and the note; if query stopwords counted as matches the refusal
        # above could never fire for any question containing a common word.
        _add(conn, "n1", "u1", "Zoo", _doc("a note about the zoo"))
        out = ar.retrieve_note("u1", "n1", "what did I say about margins",
                               conn=conn)
        assert out["no_answer"] is True

    def test_an_empty_note_refuses(self, conn):
        _add(conn, "n1", "u1", "Empty", {"type": "doc", "content": []})
        out = ar.retrieve_note("u1", "n1", "anything", conn=conn)
        assert out["no_answer"] is True
        assert out["coverage"]["has_text"] is False

    def test_a_real_match_lifts_the_refusal(self, conn):
        _add(conn, "n1", "u1", "NVDA thesis", THESIS)
        out = ar.retrieve_note("u1", "n1", "what did I say about margins",
                               conn=conn)
        assert out["no_answer"] is False
        assert out["query_matches"] >= 1


class TestTenantScoping:
    def test_another_members_note_is_not_found(self, conn):
        _add(conn, "n1", "u2", "Their private thesis", THESIS)
        out = ar.retrieve_note("u1", "n1", "margins", conn=conn)
        assert out["no_answer_reason"] == "note_not_found"
        assert out["evidence"] == []
        assert out["coverage"]["exists"] is False

    def test_a_trashed_note_is_not_answerable(self, conn):
        _add(conn, "n1", "u1", "Deleted", THESIS, deleted="2026-09-01T00:00:00Z")
        out = ar.retrieve_note("u1", "n1", "margins", conn=conn)
        assert out["coverage"]["exists"] is False

    def test_the_refusal_never_names_the_note(self, conn):
        # An error that differs by existence is an oracle for another
        # member's rows.
        _add(conn, "n1", "u2", "SECRET NVDA SHORT", THESIS)
        out = ar.retrieve_note("u1", "n1", "margins", conn=conn)
        assert "SECRET" not in repr(out)


class TestTermExtraction:
    def test_the_last_fts_term_keeps_its_prefix_operator_off(self):
        # ⛔ THE SLICE 6 BUG. fts_match_expr ends with a prefix operator, so
        # stripping only quotes left the last (most specific) term as
        # `margins"*` and it matched nothing.
        from api.services.journal_two.notes_search import fts_match_expr
        terms = ar._terms(fts_match_expr("what did I say about margins"))
        assert "margins" in terms
        assert not any('"' in t or "*" in t for t in terms)

    def test_content_terms_drop_the_words_that_cannot_answer(self):
        assert ar._content_terms("what did I say about margins") == ["margins"]

    def test_content_terms_keep_a_real_multi_word_question(self):
        got = ar._content_terms("datacenter supply and hyperscaler pricing")
        assert set(got) >= {"datacenter", "supply", "hyperscaler", "pricing"}
