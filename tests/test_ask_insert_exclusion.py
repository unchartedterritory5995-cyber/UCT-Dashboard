"""G-064 — an `askCitation` chip is a one-position leaf (spec §7.1), and Ask
Notebook never cites an inserted answer back as the member's own writing
(spec §7.2, promise P3).
"""
from __future__ import annotations

import sqlite3

import pytest

from api.services.journal_two import ask_retrieval as ar
from api.services.journal_two import note_citation_text as nct
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.db import ensure_schema


def _t(text):
    return {"type": "text", "text": text}


def _p(*inline):
    return {"type": "paragraph", "content": list(inline)}


def _chip(n=1):
    return {"type": "askCitation", "attrs": {"n": n, "label": "src", "claim": ""}}


def _insert(*paras):
    return {"type": "askInsert",
            "attrs": {"insertedAt": "2026-09-22T12:00:00Z", "scope": "notebook", "question": "q"},
            "content": list(paras)}


MIXED = {"type": "doc", "content": [
    _p(_t("My own view: margins are fine.")),
    _insert(_p(_t("Inserted answer says margins compressed "), _chip(1), _t("."))),
    _p(_t("After.")),
]}
ONLY_INSERTED = {"type": "doc", "content": [
    _insert(_p(_t("Inserted answer says margins compressed "), _chip(1), _t("."))),
]}


class TestTheChipIsALeaf:
    def test_a_chip_takes_one_position_and_no_text(self):
        doc = {"type": "doc", "content": [_p(_t("ab"), _chip(), _t("cd"))]}
        flat = nct.flatten(doc)
        assert flat["text"] == "abcd"
        spans = [(s["pm_start"], s["pm_end"]) for s in flat["spans"] if not s["is_atom"]]
        # "ab" 1..3, chip at 3, "cd" 4..6 — ProseMirror's own numbering.
        assert spans == [(1, 3), (4, 6)]
        assert flat["content_size"] == 7


class TestFlattenMarksInsertedRuns:
    def test_runs_inside_an_insert_are_flagged_and_others_are_not(self):
        flat = nct.flatten(MIXED)
        flagged = {flat["text"][s["flat_start"]:s["flat_end"]]
                   for s in flat["spans"] if s["in_ask_insert"]}
        plain = {flat["text"][s["flat_start"]:s["flat_end"]]
                 for s in flat["spans"] if not s["in_ask_insert"]}
        assert "Inserted answer says margins compressed " in flagged
        assert {"My own view: margins are fine.", "After."} <= plain

    def test_the_canonical_text_is_unchanged(self):
        # ⛔ flatten is pinned to ProseMirror's textBetween; the flag is metadata,
        # never a change to the text.
        assert nct.flatten(MIXED)["text"] == (
            "My own view: margins are fine.\nInserted answer says margins compressed .\nAfter.")

    def test_member_text_cuts_inserted_runs_out(self):
        own = nct.member_text(nct.flatten(MIXED))
        assert "Inserted answer" not in own
        assert "My own view: margins are fine." in own and "After." in own

    def test_in_ask_insert_answers_for_a_range(self):
        flat = nct.flatten(MIXED)
        i = flat["text"].index("Inserted")
        j = flat["text"].index("My own")
        assert nct.in_ask_insert(flat, i, i + 8) is True
        assert nct.in_ask_insert(flat, j, j + 6) is False


class TestNoteScope:
    def test_inserted_blocks_are_never_evidence(self):
        texts = [b["text"] for b in ar._note_blocks(MIXED, "margins")]
        assert "My own view: margins are fine." in texts
        assert not any("Inserted answer" in t for t in texts)

    def test_a_note_that_is_only_an_inserted_answer_yields_no_blocks(self):
        assert ar._note_blocks(ONLY_INSERTED, "margins") == []


class TestNotebookScopePassage:
    def test_the_passage_is_the_members_own_text(self):
        snippet, location, _validity = ar._best_note_passage(MIXED, "margins")
        assert "My own view" in snippet
        assert "Inserted answer" not in snippet
        assert location is not None

    def test_a_match_only_inside_an_insert_is_not_cited_exactly(self):
        doc = {"type": "doc", "content": [
            _p(_t("Unrelated member text.")),
            _insert(_p(_t("compressed margins here")))]}
        snippet, location, _validity = ar._best_note_passage(doc, "compressed")
        assert location is None
        assert "compressed" not in snippet

    def test_a_body_that_is_only_inserted_answers_is_not_a_candidate(self):
        assert ar._best_note_passage(ONLY_INSERTED, "margins") == (None, None, None)

    def test_an_empty_body_keeps_its_old_behaviour(self):
        assert ar._best_note_passage({"type": "doc", "content": []}, "margins")[0] == ""


@pytest.fixture()
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    yield c
    c.close()


class TestTheCandidateLoop:
    def test_a_note_holding_only_an_inserted_answer_is_never_evidence(self, conn):
        mine = notes_svc.create_note("u1", {
            "title": "Mine",
            "bodyJson": {"type": "doc", "content": [_p(_t("margins compressed in my view"))]},
        }, conn=conn)
        pasted = notes_svc.create_note("u1", {"title": "Pasted", "bodyJson": ONLY_INSERTED}, conn=conn)
        ids = {e["source_id"] for e in ar._notes(conn, "u1", "margins", 10)}
        assert mine["id"] in ids
        assert pasted["id"] not in ids
