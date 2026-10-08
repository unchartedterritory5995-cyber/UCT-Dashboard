"""Ask the Notebook never tells a member their note is cut off (fin walk K1), and never calls
their own file off topic (K6).

K1, measured on a live model: two whole notes of four and three sentences were each handed to
the model as a 240-character window around the first matching word. The model reported the
window's edge as a defect in the note ("the note cuts off", "both appear truncated") and left
out what the notes went on to say.

Two rules, both pinned here:
  * a note that fits is sent WHOLE, so there is no edge to misreport;
  * a passage that really is part of a longer note says so, in words the model is told how to
    read, and the prompt forbids describing the member's note as cut off.

No model is called anywhere in this file.
"""
from __future__ import annotations

import inspect
import json
import sqlite3

import pytest

from api.services.journal_two import ask_evidence as ev
from api.services.journal_two import ask_prompt as ap
from api.services.journal_two import ask_ranking as rk
from api.services.journal_two import ask_retrieval as ar
from api.services.journal_two import note_citation_text as nct

U = "u1"

# The walk's two notes, in shape: short, whole, and about one name.
PLAN = [
    "CRWD breakout plan. Planned entry 412.50 on a close above the base high.",
    "Stop 398 under the pivot low, target 455.",
    "The catalyst is the Falcon Flex renewal cycle, which management said is two quarters early.",
    "I will not add before the report.",
]
AFTER = [
    "CRWD after the report: filled at 413.10 the morning after.",
    "Revenue beat and the guide was raised.",
    "I raised the stop to breakeven at the close and kept the full position.",
]
FILLER = ("Semiconductor capital spending commentary from the supplier call was mixed and "
          "the order book detail is recorded here for later comparison. ")


def _doc(*paras):
    return {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": p}]} for p in paras]}


def _long_doc():
    """A note far past the whole-note budget, with the one matching sentence in the middle."""
    paras = [FILLER * 3 for _ in range(6)]
    paras.insert(3, "My CRWD entry was 412.50 and the stop sat under the pivot low at 398.")
    return _doc(*paras)


@pytest.fixture()
def conn(tmp_path):
    from api.services.journal_two.notes import extract_plain_text
    c = sqlite3.connect(tmp_path / "ask.db")
    c.row_factory = sqlite3.Row
    c.executescript(
        "CREATE TABLE j2_notes (id TEXT PRIMARY KEY, user_id TEXT, title TEXT, ticker TEXT,"
        " body_json TEXT, body_plain TEXT, properties_json TEXT, deleted_at TEXT, updated_at TEXT);"
        "CREATE VIRTUAL TABLE j2_notes_fts USING fts5(note_id UNINDEXED, user_id UNINDEXED, title,"
        " body_plain, tokenize='porter unicode61');")
    for nid, title, doc in (("plan", "CRWD breakout plan", _doc(*PLAN)),
                            ("after", "CRWD after the report", _doc(*AFTER)),
                            ("long", "Supplier call notes", _long_doc())):
        plain = extract_plain_text(doc)
        c.execute("INSERT INTO j2_notes VALUES (?,?,?,?,?,?,'{}',NULL,'2026-10-07')",
                  (nid, U, title, "CRWD", json.dumps(doc), plain))
        c.execute("INSERT INTO j2_notes_fts VALUES (?,?,?,?)", (nid, U, title, plain))
    c.commit()
    yield c
    c.close()


def _by_id(items):
    return {i["source_id"]: i for i in items}


# ── a note that fits is sent whole ───────────────────────────────────────────────────────────

def test_a_short_note_is_sent_whole_and_is_not_marked_as_an_excerpt(conn):
    items = _by_id(ar._notes(conn, U, ar.ask_match_expr("What have I written about CRWD entry"), 8))
    for nid, paras in (("plan", PLAN), ("after", AFTER)):
        it = items[nid]
        for sentence in paras:                       # every sentence, the last one included
            assert sentence in it["text"], (nid, sentence)
        assert not it.get("truncated"), nid
    # the two things the live answer left out are in what the model is handed
    assert "renewal cycle" in items["plan"]["text"]
    assert "raised the stop to breakeven" in items["after"]["text"]


def test_the_whole_note_budget_is_a_named_number_and_a_short_note_is_under_it():
    assert ar.NOTE_WHOLE_MAX_CHARS == 1200
    assert len(" ".join(PLAN)) < ar.NOTE_WHOLE_MAX_CHARS
    # four whole notes of that size still fit the packet's own budget
    assert rk.MAX_PER_SOURCE_TYPE * ar.NOTE_WHOLE_MAX_CHARS <= rk.MAX_CHARS


def test_a_note_exactly_at_the_budget_is_whole_and_one_over_is_an_excerpt():
    base = "entry "
    at = _doc(base + "x" * (ar.NOTE_WHOLE_MAX_CHARS - len(base)))
    over = _doc(base + "x" * (ar.NOTE_WHOLE_MAX_CHARS - len(base) + 1))
    assert ar._note_passage(at, '"entry"')[3] is False
    assert ar._note_passage(over, '"entry"')[3] is True


# ── a passage that is part of a longer note says so ─────────────────────────────────────────

def test_a_long_note_is_an_excerpt_and_is_marked(conn):
    it = _by_id(ar._notes(conn, U, ar.ask_match_expr("CRWD entry stop"), 8))["long"]
    assert it["truncated"] is True
    assert len(it["text"]) < ar.NOTE_WHOLE_MAX_CHARS
    assert "412.50" in it["text"]                     # the passage is the one that matched


def test_an_excerpt_starts_and_ends_on_a_word_not_in_the_middle_of_one():
    snippet, _loc, _validity, partial = ar._note_passage(_long_doc(), '"entry"')
    assert partial is True
    words = set((FILLER * 3 + " My CRWD entry was 412.50 and the stop sat under the pivot low at 398.").split())
    assert snippet.split()[0] in words and snippet.split()[-1] in words, snippet


def test_the_marker_is_in_the_prompt_only_for_a_partial_passage(conn):
    items = _by_id(ar._notes(conn, U, ar.ask_match_expr("CRWD entry stop"), 8))
    whole = ap.render_source(1, items["plan"])
    part = ap.render_source(2, items["long"])
    assert ap.EXCERPT_MARK in part
    assert ap.EXCERPT_MARK not in whole
    assert ap.WHOLE_MARK in whole and ap.WHOLE_MARK not in part
    # the old wording invited the very sentence it was meant to prevent
    assert "shortened to fit" not in part and "the cut" not in part


def test_the_budget_cut_is_marked_the_same_way():
    """`ask_ranking.budget` can shorten an oversized item. That is the same fact to the model."""
    big = ev.make_evidence(source_type=ev.NOTE, source_id="n", user_id=U, label="Big",
                           text="word " * 2000, citation_validity=ev.CITE_NOTE_ONLY)
    big["relevance"] = ev.QUERY_MATCH
    kept = rk.packet([big], "word")["evidence"][0]
    assert kept["truncated"] is True
    assert ap.EXCERPT_MARK in ap.render_source(1, kept)


# ── the prompt contract ─────────────────────────────────────────────────────────────────────

def test_the_prompt_forbids_calling_the_members_note_cut_off():
    p = ap.system_prompt()
    assert ap._EXCERPTS in p
    block = ap._EXCERPTS
    for word in ("cut off", "truncated", "incomplete", "unfinished"):
        assert word in block, word
    assert "Never" in block
    assert "working from part of the note" in block
    # it names both marks, so the instruction and the data cannot drift apart
    assert ap.EXCERPT_MARK in block and ap.WHOLE_MARK in block


def test_the_system_prompt_still_takes_no_parameters():
    assert list(inspect.signature(ap.system_prompt.__wrapped__).parameters) == []


# ── citations still land on the right passage ───────────────────────────────────────────────

@pytest.mark.parametrize("doc", [_doc(*PLAN), _long_doc()], ids=["whole", "excerpt"])
def test_the_citation_still_points_at_the_matched_word(doc):
    """Sending more text must not move the citation. The location is the matched term's own
    range in the canonical text, whatever the snippet is."""
    snippet, loc, validity, _partial = ar._note_passage(doc, '"entry"')
    flat = nct.flatten(doc)
    assert validity == ev.CITE_EXACT
    assert flat["text"][loc["snippet_start"]:loc["snippet_end"]].lower() == "entry"
    rng = nct.SpanIndex(flat["spans"]).pm_range(loc["snippet_start"], loc["snippet_end"])
    assert (loc["from"], loc["to"]) == (rng["from"], rng["to"])
    assert loc["fingerprint"] == nct.fingerprint(doc)
    assert "entry" in snippet.lower()


def test_the_three_value_passage_function_is_unchanged_for_its_callers():
    doc = _doc(*PLAN)
    assert ar._best_note_passage(doc, '"entry"') == ar._note_passage(doc, '"entry"')[:3]


def test_inserted_ask_answers_are_still_never_part_of_a_whole_note():
    insert = {"type": "askInsert", "attrs": {}, "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "An earlier AI answer about CRWD entry."}]}]}
    doc = {"type": "doc", "content": [_doc("My own CRWD entry was 412.50.")["content"][0], insert]}
    flat = nct.flatten(doc)
    if not any(s.get("in_ask_insert") for s in flat["spans"]):
        pytest.skip("this build names the insert node differently; tests/test_ask_insert_exclusion.py owns it")
    snippet, _loc, _validity, partial = ar._note_passage(doc, '"entry"')
    assert "earlier AI answer" not in snippet and partial is False


# ── K6: a member's own file is theirs to ask about ──────────────────────────────────────────

def test_the_notebook_prompt_never_tells_the_model_to_refuse_for_being_off_topic():
    p = ap.system_prompt()
    assert "I'm the UCT research desk" not in p
    assert "clearly unrelated" not in p
    assert "Use the refusal ONLY" not in p


def test_the_notebook_prompt_says_any_subject_in_the_notebook_is_in_scope():
    block = ap._NOTEBOOK_SCOPE
    assert block in ap.system_prompt()
    assert "any subject" in block
    assert "unrelated to markets or trading" in block and "Never" in block


def test_the_real_safety_boundary_is_kept_and_is_the_desks_own_text():
    """Market manipulation is still refused, and the words are the desk's one copy of them,
    selected by name. Nothing is retyped here or in the prompt module."""
    from api.routers.ai_search import _SAFETY_BLOCKS
    kept = ap.desk_safety_text()
    assert kept.startswith("ILLEGAL / MANIPULATION")
    assert kept.strip() in _SAFETY_BLOCKS
    assert "pump-and-dumps" in kept
    assert kept in ap.system_prompt()
    assert not kept.startswith("SCOPE")


def test_the_excerpt_window_is_moved_inward_to_whole_words():
    """Built so both raw edges (90 before, 150 after) land in the MIDDLE of a word."""
    text = ("abcdefghij " * 40) + "entry" + (" klmnopqrst" * 40)
    idx = text.index("entry")
    assert not text[idx - 90 - 1].isspace() and not text[idx + 5 + 150].isspace()   # the fixture's premise
    start, end = ar._excerpt_window(text, idx, 5)
    assert text[start].isspace() and text[end - 1].isspace()   # each edge sits on the gap between words
    assert start <= idx and end >= idx + 5                      # the match is always inside
    assert idx - start <= 90 and end - (idx + 5) <= 150         # moved inward, never outward
    assert text[start:end].split()[0] == "abcdefghij" and text[start:end].split()[-1] == "klmnopqrst"
