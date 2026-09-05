"""Tests for Journal 2.0 Notebook service (notes.py)."""

from __future__ import annotations

import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services.journal_two import notes as svc
from api.services.journal_two import notes_quota
from api.services.journal_two.notes import (
    NoteValidationError, convert_playbook_to_tiptap, extract_plain_text,
)
from api.services.journal_two.db import ensure_schema


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    yield c
    c.close()


def test_extract_plain_text_walks_nested_nodes():
    doc = {"type": "doc", "content": [
        {"type": "heading", "content": [{"type": "text", "text": "Hello"}]},
        {"type": "paragraph", "content": [
            {"type": "text", "text": "World"},
            {"type": "text", "text": "!"},
        ]},
    ]}
    assert extract_plain_text(doc) == "Hello World !"


def test_extract_plain_text_handles_empty():
    assert extract_plain_text(None) == ""
    assert extract_plain_text({}) == ""
    assert extract_plain_text({"type": "doc"}) == ""


def test_create_note_minimal(conn):
    n = svc.create_note("u1", {"title": "First"}, conn=conn)
    assert n["title"] == "First"
    assert n["bodyJson"] == {"type": "doc", "content": []}
    assert n["tags"] == []


def test_create_note_with_body(conn):
    body = {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "Hi"}]},
    ]}
    n = svc.create_note("u1", {"title": "T", "bodyJson": body}, conn=conn)
    assert n["bodyPlain"] == "Hi"


def test_update_note_partial(conn):
    n = svc.create_note("u1", {"title": "Original"}, conn=conn)
    u = svc.update_note("u1", n["id"], {"title": "Updated"}, conn=conn)
    assert u["title"] == "Updated"


def test_update_note_ticker_normalized(conn):
    n = svc.create_note("u1", {"title": "T"}, conn=conn)
    u = svc.update_note("u1", n["id"], {"ticker": "nvda"}, conn=conn)
    assert u["ticker"] == "NVDA"


def test_update_note_tags_dedup_and_trim(conn):
    n = svc.create_note("u1", {"title": "T"}, conn=conn)
    u = svc.update_note(
        "u1", n["id"], {"tags": ["earnings", " EARNINGS ", "macro", ""]}, conn=conn,
    )
    assert u["tags"] == ["earnings", "macro"]


def test_delete_note(conn):
    n = svc.create_note("u1", {"title": "T"}, conn=conn)
    assert svc.delete_note("u1", n["id"], conn=conn) is True
    assert svc.get_note("u1", n["id"], conn=conn) is None


def test_list_notes_filter_by_folder(conn):
    f = svc.create_folder("u1", "Earnings", conn=conn)
    a = svc.create_note("u1", {"title": "In folder", "folderId": f["id"]}, conn=conn)
    b = svc.create_note("u1", {"title": "Unfiled"}, conn=conn)
    rows = svc.list_notes("u1", folder_id=f["id"], conn=conn)
    assert [n["id"] for n in rows] == [a["id"]]
    rows = svc.list_notes("u1", folder_id="__unfiled__", conn=conn)
    assert [n["id"] for n in rows] == [b["id"]]


def test_list_notes_filter_by_ticker(conn):
    a = svc.create_note("u1", {"title": "A", "ticker": "NVDA"}, conn=conn)
    svc.create_note("u1", {"title": "B", "ticker": "AAPL"}, conn=conn)
    rows = svc.list_notes("u1", ticker="NVDA", conn=conn)
    assert [n["id"] for n in rows] == [a["id"]]


def test_list_notes_filter_by_tag(conn):
    a = svc.create_note("u1", {"title": "A", "tags": ["earnings", "macro"]}, conn=conn)
    svc.create_note("u1", {"title": "B", "tags": ["macro"]}, conn=conn)
    rows = svc.list_notes("u1", tag="earnings", conn=conn)
    assert [n["id"] for n in rows] == [a["id"]]


def test_list_notes_search_body(conn):
    body = {"type": "doc", "content": [
        {"type": "paragraph", "content": [
            {"type": "text", "text": "Powerplay candidate"},
        ]},
    ]}
    a = svc.create_note("u1", {"title": "X", "bodyJson": body}, conn=conn)
    svc.create_note("u1", {"title": "Y"}, conn=conn)
    rows = svc.list_notes("u1", q="powerplay", conn=conn)
    assert [n["id"] for n in rows] == [a["id"]]


def test_list_notes_search_reaches_a_note_findable_only_by_its_tag(conn):
    """Final-review C1: the pre-Task-11 client-side panel search matched a
    note's tags (it substring-matched over `title+body+tags+ticker` joined
    into one string). Routing `q` through FTS5 alone (title/body_plain only)
    silently dropped that coverage — this note's title and body contain
    NOTHING that could match; only its tag can find it."""
    a = svc.create_note(
        "u1", {"title": "Untitled reflections", "tags": ["earnings"]}, conn=conn,
    )
    svc.create_note("u1", {"title": "Some other note", "tags": ["macro"]}, conn=conn)
    rows = svc.list_notes("u1", q="earnings", conn=conn)
    assert [n["id"] for n in rows] == [a["id"]]


def test_list_notes_search_reaches_a_note_findable_only_by_its_ticker(conn):
    """Same gap, the ticker axis: the old client search also substring-matched
    the ticker. Neither this note's title nor its body contains the ticker."""
    a = svc.create_note(
        "u1", {"title": "Weekend prep notes", "ticker": "NVDA"}, conn=conn,
    )
    svc.create_note("u1", {"title": "Another weekend note", "ticker": "AAPL"}, conn=conn)
    rows = svc.list_notes("u1", q="nvda", conn=conn)
    assert [n["id"] for n in rows] == [a["id"]]


# ── count_notes — the true total behind a capped page (Task 11) ─────────────

def test_count_notes_reflects_all_matches_not_the_page_size(conn):
    """The migration defect this task exists to kill: a member with more
    notes than one page must see an honest total, not `len(page)`. 120
    notes, requested with a 100-row page — `count_notes` must still say 120,
    not 100."""
    for i in range(120):
        svc.create_note("u1", {"title": f"Note {i}"}, conn=conn)
    page = svc.list_notes("u1", limit=100, conn=conn)
    assert len(page) == 100
    assert svc.count_notes("u1", conn=conn) == 120


def test_count_notes_respects_the_folder_filter(conn):
    """A folder's total must be that folder's count, not the library's."""
    f = svc.create_folder("u1", "Earnings", conn=conn)
    for i in range(3):
        svc.create_note("u1", {"title": f"In folder {i}", "folderId": f["id"]}, conn=conn)
    for i in range(2):
        svc.create_note("u1", {"title": f"Unfiled {i}"}, conn=conn)
    assert svc.count_notes("u1", conn=conn) == 5
    assert svc.count_notes("u1", folder_id=f["id"], conn=conn) == 3
    assert svc.count_notes("u1", folder_id="__unfiled__", conn=conn) == 2


def test_count_notes_never_crosses_users(conn):
    svc.create_note("u1", {"title": "Mine"}, conn=conn)
    svc.create_note("u2", {"title": "Theirs"}, conn=conn)
    assert svc.count_notes("u1", conn=conn) == 1
    assert svc.count_notes("u2", conn=conn) == 1


def _note_with_embeds(conn, title, *symbols, user="u1", widget_id="chart"):
    content = [{
        "type": "widgetEmbed",
        "attrs": {
            "v": 1, "widgetId": widget_id, "mode": "snapshot",
            "params": {"symbol": s, "tf": "D"},
            "capturedAt": "2026-08-13T12:00:00Z",
            "searchText": f"[chart: {s} D]",
        },
    } for s in symbols]
    return svc.create_note(user, {"title": title, "bodyJson": {"type": "doc", "content": content}}, conn=conn)


def test_count_notes_agrees_with_the_list_across_every_filter_dimension(conn):
    """`list_notes` and `count_notes` share ONE WHERE-clause builder
    (`_notes_filter_sql`) precisely so they can never disagree about
    membership — this pins that invariant across every filter the notebook
    route exposes: folder/unfiled/ticker/tag/q AND the two embed dimensions
    (`embed_symbol`/`embed_widget`), which read from the `j2_note_embeds`
    sidecar rather than a column on `j2_notes`.

    Fix-round-1 note: the embed cases were missing from the first version of
    this test — a real gap (both dimensions the brief named), even though
    both functions happened to share the identical `_notes_filter_sql` call
    at the time, so a future edit that touched only ONE of the two embed
    branches would have walked straight past this rail undetected."""
    f = svc.create_folder("u1", "Earnings", conn=conn)
    svc.create_note(
        "u1", {"title": "In folder", "folderId": f["id"], "ticker": "NVDA", "tags": ["earnings"]},
        conn=conn,
    )
    svc.create_note("u1", {"title": "Unfiled NVDA", "ticker": "NVDA"}, conn=conn)
    svc.create_note("u1", {"title": "Unfiled AAPL", "ticker": "AAPL", "tags": ["macro"]}, conn=conn)
    # Populate the j2_note_embeds sidecar for real — embed_symbol/embed_widget
    # read it, not j2_notes, so a fixture with no embeds would let both cases
    # "pass" by matching nothing on both sides, proving nothing either way.
    _note_with_embeds(conn, "AMD chart embed", "AMD", widget_id="chart")
    _note_with_embeds(conn, "NVDA breadth embed", "NVDA", widget_id="breadth")

    cases = [
        {},
        {"folder_id": f["id"]},
        {"folder_id": "__unfiled__"},
        {"ticker": "NVDA"},
        {"tag": "earnings"},
        {"q": "unfiled"},
        {"embed_symbol": "AMD"},
        {"embed_widget": "chart"},
    ]
    for kwargs in cases:
        listed = svc.list_notes("u1", limit=500, conn=conn, **kwargs)
        assert svc.count_notes("u1", conn=conn, **kwargs) == len(listed), kwargs

    # Each embed case must select a STRICT, non-empty, non-full subset of the
    # 5 notes above — a filter matching 0 or all 5 would let a broken
    # embed_symbol/embed_widget branch pass the agreement check vacuously
    # (both sides could drift identically to "everything" or "nothing" and
    # still agree with each other).
    total_notes = svc.count_notes("u1", conn=conn)
    assert total_notes == 5
    embed_symbol_count = svc.count_notes("u1", embed_symbol="AMD", conn=conn)
    embed_widget_count = svc.count_notes("u1", embed_widget="chart", conn=conn)
    assert 0 < embed_symbol_count < total_notes
    assert 0 < embed_widget_count < total_notes


# ── tag_counts — the whole-library tag distribution (final-review C5) ───────

def test_tag_counts_reflects_the_whole_library_not_a_page(conn):
    """The exact shape of the C5 bug: more notes exist than one page (100),
    each tagged 'earnings' — `tag_counts` must count all of them, not
    whatever a 100-row `list_notes` page would have carried."""
    for i in range(120):
        svc.create_note("u1", {"title": f"Note {i}", "tags": ["earnings"]}, conn=conn)
    page = svc.list_notes("u1", limit=100, conn=conn)
    assert len(page) == 100  # confirms the page really is smaller than the library
    counts = {row["tag"]: row["count"] for row in svc.tag_counts("u1", conn=conn)}
    assert counts["earnings"] == 120


def test_tag_counts_sums_notes_not_tag_occurrences_and_sorts_by_count_desc(conn):
    svc.create_note("u1", {"title": "A", "tags": ["earnings", "macro"]}, conn=conn)
    svc.create_note("u1", {"title": "B", "tags": ["macro"]}, conn=conn)
    svc.create_note("u1", {"title": "C", "tags": ["macro"]}, conn=conn)
    rows = svc.tag_counts("u1", conn=conn)
    assert rows[0] == {"tag": "macro", "count": 3}
    assert {"tag": "earnings", "count": 1} in rows


def test_tag_counts_never_crosses_users(conn):
    svc.create_note("u1", {"title": "Mine", "tags": ["earnings"]}, conn=conn)
    svc.create_note("u2", {"title": "Theirs", "tags": ["earnings", "macro"]}, conn=conn)
    u1_counts = {row["tag"]: row["count"] for row in svc.tag_counts("u1", conn=conn)}
    u2_counts = {row["tag"]: row["count"] for row in svc.tag_counts("u2", conn=conn)}
    assert u1_counts == {"earnings": 1}
    assert u2_counts == {"earnings": 1, "macro": 1}


def test_tag_counts_ignores_untagged_notes_and_handles_an_empty_library(conn):
    assert svc.tag_counts("u1", conn=conn) == []
    svc.create_note("u1", {"title": "No tags"}, conn=conn)
    assert svc.tag_counts("u1", conn=conn) == []


def test_tag_counts_merges_case_variants_of_the_same_tag(conn):
    """B3: `tag_counts` grouped by `json_each.value` case-SENSITIVELY while
    the `tag=` filter (`_notes_filter_sql`, `lower(tags) LIKE`) matches
    case-INSENSITIVELY — three notes tagged 'Earnings'/'earnings'/'EARNINGS'
    used to yield three chips of count 1 each, each opening a list of all
    three. A member who typed 'Trading' and 'trading' means one tag; the
    case-insensitive filter is the member-facing intent, so the count must
    merge on the same key the filter already matches on."""
    svc.create_note("u1", {"title": "A", "tags": ["Earnings"]}, conn=conn)
    svc.create_note("u1", {"title": "B", "tags": ["earnings"]}, conn=conn)
    svc.create_note("u1", {"title": "C", "tags": ["EARNINGS"]}, conn=conn)
    rows = svc.tag_counts("u1", conn=conn)
    assert len(rows) == 1
    assert rows[0]["count"] == 3


def test_tag_counts_agrees_with_the_list_filter_it_labels(conn):
    """The count on a tag chip must equal the length of the list clicking it
    opens — for every casing variant a note's tag happens to carry. Two
    authorities over one value (a count query and a filter query) must never
    be free to disagree; this is the agreement rail `test_backlinks_and_the_
    list_filter_agree` already keeps for the symbol-backlinks sidecar."""
    svc.create_note("u1", {"title": "A", "tags": ["Earnings"]}, conn=conn)
    svc.create_note("u1", {"title": "B", "tags": ["earnings"]}, conn=conn)
    svc.create_note("u1", {"title": "C", "tags": ["EARNINGS"]}, conn=conn)
    svc.create_note("u1", {"title": "D", "tags": ["macro"]}, conn=conn)
    rows = svc.tag_counts("u1", conn=conn)
    for row in rows:
        filtered = svc.list_notes("u1", tag=row["tag"], conn=conn)
        assert len(filtered) == row["count"], (
            f"chip for {row['tag']!r} shows {row['count']} but its own "
            f"filter opens {len(filtered)}"
        )


def test_backlinks_answer_which_entries_reference_a_ticker(conn):
    """The sidecar has been written since v1 and read by exactly one consumer.
    This is the read that lets the rest of the app see the journal."""
    a = _note_with_embeds(conn, "AMD post-mortem", "AMD", "AMD")   # two refs, ONE note
    _note_with_embeds(conn, "NVDA only", "NVDA")
    b = _note_with_embeds(conn, "Mixed", "AMD", "NVDA")

    back = svc.get_symbol_backlinks("u1", "amd", conn=conn)        # case-insensitive in
    assert back["symbol"] == "AMD"
    assert back["count"] == 2                                       # NOTES, not embeds
    assert {n["id"] for n in back["notes"]} == {a["id"], b["id"]}
    got_a = next(n for n in back["notes"] if n["id"] == a["id"])
    assert got_a["refs"] == 2 and got_a["widgetIds"] == ["chart"]
    assert got_a["title"] == "AMD post-mortem"

    # Another user's notes are invisible, and an unknown symbol is empty.
    assert svc.get_symbol_backlinks("u2", "AMD", conn=conn)["count"] == 0
    assert svc.get_symbol_backlinks("u1", "TSLA", conn=conn) == {"symbol": "TSLA", "count": 0, "notes": []}
    assert svc.get_symbol_backlinks("u1", "", conn=conn)["count"] == 0


def test_backlinks_and_the_list_filter_agree(conn):
    """Two readers, ONE membership question ('which notes reference this
    symbol'). A second authority over one value is this repo's most repeated
    defect — so the two answers are pinned to each other rather than each
    being pinned to a hand-typed expectation."""
    _note_with_embeds(conn, "One", "AMD")
    _note_with_embeds(conn, "Two", "AMD", "NVDA")
    _note_with_embeds(conn, "Three", "NVDA")
    for sym in ("AMD", "NVDA", "TSLA"):
        via_list = {n["id"] for n in svc.list_notes("u1", embed_symbol=sym, conn=conn)}
        back = svc.get_symbol_backlinks("u1", sym, limit=25, conn=conn)
        assert {n["id"] for n in back["notes"]} == via_list, sym
        assert back["count"] == len(via_list), sym


def test_backlinks_deleting_the_embed_drops_the_backlink(conn):
    """The sidecar is a projection of the body — editing the embed out must
    retract the backlink, or the app advertises entries that no longer
    reference the ticker."""
    n = _note_with_embeds(conn, "Temp", "AMD")
    assert svc.get_symbol_backlinks("u1", "AMD", conn=conn)["count"] == 1
    svc.update_note("u1", n["id"], {"bodyJson": {"type": "doc", "content": []}}, conn=conn)
    assert svc.get_symbol_backlinks("u1", "AMD", conn=conn)["count"] == 0


def test_list_rows_project_out_the_document_body(conn):
    """The LIST endpoint is a card index, not a document dump: a widget-embed
    note drags a multi-KB frozen settings blob in bodyJson, so list rows must
    not carry it (absent, not {} — an empty doc would look loadable). The
    single-note GET keeps the full body; bodyPlain on list rows is capped to
    a preview. Search still reaches the FULL body_plain (the WHERE clause
    reads the real column, only the projection is capped)."""
    body = {"type": "doc", "content": [
        {"type": "paragraph", "content": [
            {"type": "text", "text": "start " + ("x" * 900) + " needleword"},
        ]},
    ]}
    n = svc.create_note("u1", {"title": "Big", "bodyJson": body}, conn=conn)
    rows = svc.list_notes("u1", conn=conn)
    assert rows and rows[0]["id"] == n["id"]
    assert "bodyJson" not in rows[0]
    assert len(rows[0]["bodyPlain"]) <= 400
    # The capped preview must not break body search (cap is projection-only).
    assert [r["id"] for r in svc.list_notes("u1", q="needleword", conn=conn)] == [n["id"]]
    # The editor's single-note fetch still returns the whole document.
    full = svc.get_note("u1", n["id"], conn=conn)
    assert full["bodyJson"] == body


def test_folder_crud(conn):
    f = svc.create_folder("u1", "Lessons", conn=conn)
    assert f["name"] == "Lessons"
    u = svc.update_folder("u1", f["id"], {"name": "Lessons Renamed"}, conn=conn)
    assert u["name"] == "Lessons Renamed"
    assert svc.delete_folder("u1", f["id"], conn=conn) is True


def test_folder_unique_per_user(conn):
    svc.create_folder("u1", "X", conn=conn)
    with pytest.raises(NoteValidationError):
        svc.create_folder("u1", "X", conn=conn)
    # different user is fine
    svc.create_folder("u2", "X", conn=conn)


def test_delete_folder_unfiles_notes(conn):
    f = svc.create_folder("u1", "Move", conn=conn)
    n = svc.create_note("u1", {"title": "T", "folderId": f["id"]}, conn=conn)
    svc.delete_folder("u1", f["id"], conn=conn)
    after = svc.get_note("u1", n["id"], conn=conn)
    assert after["folderId"] is None


def test_convert_playbook_with_levels_and_attachments():
    entry = {
        "symbol": "NVDA",
        "observedDate": "2026-05-20",
        "setup": "VCP",
        "thesis": "Sitting on 50EMA after a 35% pole.",
        "levels": {"trigger": 145.5, "stop": 138.0, "target": 165.0},
        "attachments": [
            {"kind": "image", "url": "/img/a.webp"},
            {"kind": "link", "url": "https://example.com", "label": "TV chart"},
        ],
        "notes": "Watch for tight close.",
    }
    doc = convert_playbook_to_tiptap(entry)
    types = [n["type"] for n in doc["content"]]
    # heading, table, paragraph(thesis), image, paragraph(link), paragraph(notes)
    assert types[0] == "heading"
    assert types[1] == "table"
    assert "image" in types
    text = extract_plain_text(doc)
    assert "NVDA" in text and "Sitting" in text and "Watch" in text


def test_convert_playbook_without_levels():
    entry = {
        "symbol": "AAPL",
        "observedDate": "2026-05-21",
        "thesis": "Earnings setup.",
        "levels": {},
        "attachments": [],
        "notes": "",
    }
    doc = convert_playbook_to_tiptap(entry)
    types = [n["type"] for n in doc["content"]]
    assert "table" not in types


def test_validation_ticker_invalid(conn):
    with pytest.raises(NoteValidationError):
        svc.create_note("u1", {"title": "T", "ticker": "in@valid"}, conn=conn)


def test_validation_body_must_be_doc(conn):
    with pytest.raises(NoteValidationError):
        svc.create_note("u1", {"title": "T", "bodyJson": {"type": "not-doc"}}, conn=conn)


def test_validation_folder_must_exist(conn):
    with pytest.raises(NoteValidationError):
        svc.create_note("u1", {"title": "T", "folderId": "missing"}, conn=conn)


# ── Journal Widgets: widgetEmbed serialization + sidecar index ───────────────

WIDGET_DOC = {"type": "doc", "content": [
    {"type": "paragraph", "content": [{"type": "text", "text": "Setup review"}]},
    {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": "chart",
        "params": {"symbol": "AMD", "tf": "5"},
        "capturedAt": "2026-03-13T15:45:00Z", "mode": "snapshot",
        "searchText": "[chart: AMD 5m]", "tradeRef": "tr_1"}},
    {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": "breadth", "params": {},
        "capturedAt": "2026-03-13T15:50:00Z", "mode": "live",
        "searchText": "[breadth: heatmap]"}},
]}


def test_extract_plain_text_emits_widget_embed_search_text():
    txt = extract_plain_text(WIDGET_DOC)
    assert "[chart: AMD 5m]" in txt
    assert "[breadth: heatmap]" in txt


def test_extract_plain_text_widget_embed_without_search_text_degrades():
    doc = {"type": "doc", "content": [
        {"type": "widgetEmbed", "attrs": {"widgetId": "gone"}}]}
    assert "[widget]" in extract_plain_text(doc)


def test_extract_plain_text_matches_client_for_custom_nodes():
    # The client serializer (lib/tiptap.js extractPlainText) has emitted these
    # two for months; the server walked only text nodes — the drift this pins shut.
    doc = {"type": "doc", "content": [
        {"type": "videoTimestamp", "attrs": {"seconds": 75}},
        {"type": "attachmentChip", "attrs": {"name": "plan.pdf"}},
    ]}
    txt = extract_plain_text(doc)
    assert "[1:15]" in txt
    assert "[file: plan.pdf]" in txt


def test_non_dict_attrs_or_params_never_500_a_note_write(conn):
    # The body validator is deliberately permissive and the importer
    # round-trips arbitrary HTML (widgetEmbedNode.jsx jsonAttr JSON.parses
    # data-params='[1]' into a LIST) — so every custom-node branch must
    # DEGRADE on a truthy non-dict attrs/params, never raise. Before the
    # hardening, .get() on a list 500'd EVERY save of the note, permanently.
    doc = {"type": "doc", "content": [
        {"type": "widgetEmbed", "attrs": {"widgetId": "chart", "params": [1]}},
        {"type": "widgetEmbed", "attrs": [1]},
        {"type": "videoTimestamp", "attrs": [1]},
        {"type": "attachmentChip", "attrs": "nope"},
    ]}
    n = svc.create_note("u1", {"title": "T", "bodyJson": doc}, conn=conn)  # must not raise
    assert "[widget]" in n["bodyPlain"]
    assert "[file: file]" in n["bodyPlain"]
    rows = conn.execute(
        "SELECT symbol FROM j2_note_embeds WHERE note_id = ?", (n["id"],)).fetchall()
    # The list-params embed still indexes (symbol unknown); the attrs-less one
    # has no widgetId and is skipped.
    assert [r["symbol"] for r in rows] == [None]


def test_create_note_syncs_embed_sidecar(conn):
    n = svc.create_note("u1", {"title": "T", "bodyJson": WIDGET_DOC}, conn=conn)
    rows = conn.execute(
        "SELECT * FROM j2_note_embeds WHERE note_id = ? ORDER BY position",
        (n["id"],)).fetchall()
    assert [r["widget_id"] for r in rows] == ["chart", "breadth"]
    assert rows[0]["symbol"] == "AMD"
    assert rows[0]["timeframe"] == "5"
    assert rows[0]["trade_ref"] == "tr_1"
    assert rows[0]["mode"] == "snapshot"
    assert rows[0]["user_id"] == "u1"
    assert rows[1]["symbol"] is None


def test_update_note_resyncs_sidecar(conn):
    n = svc.create_note("u1", {"title": "T", "bodyJson": WIDGET_DOC}, conn=conn)
    svc.update_note("u1", n["id"], {"bodyJson": {
        "type": "doc", "content": [WIDGET_DOC["content"][1]]}}, conn=conn)
    rows = conn.execute(
        "SELECT widget_id FROM j2_note_embeds WHERE note_id = ?", (n["id"],)).fetchall()
    assert [r["widget_id"] for r in rows] == ["chart"]


def test_soft_delete_preserves_embeds_purge_clears_them(conn):
    # Wave 0 trash: a soft-deleted note is restorable, so its widget embeds
    # must survive delete_note — only the retention-expiry purge sweep may
    # actually remove them (matching test_notes_import.py's restore round trip).
    n = svc.create_note("u1", {"title": "T", "bodyJson": WIDGET_DOC}, conn=conn)
    svc.delete_note("u1", n["id"], conn=conn)
    still_there = conn.execute(
        "SELECT COUNT(*) AS c FROM j2_note_embeds WHERE note_id = ?", (n["id"],)).fetchone()
    assert still_there["c"] == 2

    from datetime import datetime, timedelta, timezone
    future = datetime.now(timezone.utc) + timedelta(days=svc.TRASH_RETENTION_DAYS + 1)
    purged = svc.purge_expired_deleted_notes(now=future, conn=conn)
    assert purged == 1

    left = conn.execute(
        "SELECT COUNT(*) AS c FROM j2_note_embeds WHERE note_id = ?", (n["id"],)).fetchone()
    assert left["c"] == 0


def test_update_note_without_body_change_keeps_sidecar(conn):
    n = svc.create_note("u1", {"title": "T", "bodyJson": WIDGET_DOC}, conn=conn)
    svc.update_note("u1", n["id"], {"title": "Renamed"}, conn=conn)
    rows = conn.execute(
        "SELECT COUNT(*) AS c FROM j2_note_embeds WHERE note_id = ?", (n["id"],)).fetchone()
    assert rows["c"] == 2


def test_list_notes_filters_by_embed_symbol_and_widget(conn):
    svc.create_note("u1", {"title": "With AMD", "bodyJson": WIDGET_DOC}, conn=conn)
    svc.create_note("u1", {"title": "Plain"}, conn=conn)
    got = svc.list_notes("u1", embed_symbol="amd", conn=conn)
    assert [n["title"] for n in got] == ["With AMD"]
    got2 = svc.list_notes("u1", embed_widget="breadth", conn=conn)
    assert [n["title"] for n in got2] == ["With AMD"]
    # And the searchText line is findable through the existing q= path.
    got3 = svc.list_notes("u1", q="chart: amd", conn=conn)
    assert [n["title"] for n in got3] == ["With AMD"]
    # Scoped to the owner.
    assert svc.list_notes("u2", embed_symbol="AMD", conn=conn) == []


def test_import_confirm_syncs_embed_sidecar(conn):
    res = svc.import_confirm("u1", {"source": "generic", "notes": [
        {"importKey": "k1", "title": "Imp", "bodyJson": WIDGET_DOC, "tags": []},
    ]}, conn=conn)
    nid = res["created"][0]["id"]
    rows = conn.execute(
        "SELECT widget_id FROM j2_note_embeds WHERE note_id = ? ORDER BY position",
        (nid,)).fetchall()
    assert [r["widget_id"] for r in rows] == ["chart", "breadth"]
    # Re-import with a changed body re-syncs rather than duplicating.
    doc2 = {"type": "doc", "content": [WIDGET_DOC["content"][1]]}
    svc.import_confirm("u1", {"source": "generic", "notes": [
        {"importKey": "k1", "title": "Imp", "bodyJson": doc2, "tags": []},
    ]}, conn=conn)
    rows2 = conn.execute(
        "SELECT widget_id FROM j2_note_embeds WHERE note_id = ?", (nid,)).fetchall()
    assert [r["widget_id"] for r in rows2] == ["chart"]


# ── Journal Widgets P5: send-to-journal append + capture inbox ───────────────

EMBED_ATTRS = {
    "v": 1, "widgetId": "chart", "params": {"symbol": "TSLA", "tf": "15"},
    "capturedAt": "2026-08-12T14:00:00Z", "mode": "snapshot",
    "searchText": "[chart: TSLA 15m]",
}


def test_append_widget_embed_appends_and_syncs(conn):
    n = svc.create_note("u1", {"title": "T", "bodyJson": {
        "type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "Existing"}]}]}},
        conn=conn)
    out = svc.append_widget_embed("u1", n["id"], EMBED_ATTRS, conn=conn)
    assert out["bodyJson"]["content"][-1]["type"] == "widgetEmbed"
    assert "[chart: TSLA 15m]" in out["bodyPlain"]
    assert "Existing" in out["bodyPlain"]
    rows = conn.execute(
        "SELECT symbol FROM j2_note_embeds WHERE note_id = ?", (n["id"],)).fetchall()
    assert [r["symbol"] for r in rows] == ["TSLA"]


def test_append_widget_embed_guards(conn):
    n = svc.create_note("u1", {"title": "T"}, conn=conn)
    with pytest.raises(NoteValidationError):
        svc.append_widget_embed("u1", n["id"], {"params": {}}, conn=conn)
    assert svc.append_widget_embed("u1", "missing", EMBED_ATTRS, conn=conn) is None
    assert svc.append_widget_embed("u2", n["id"], EMBED_ATTRS, conn=conn) is None


def test_update_note_compare_and_set(conn, monkeypatch):
    # A15: an optional updated_at baseline turns the full-doc PUT into a CAS,
    # so a server-side append (Send to Journal) can never be silently deleted
    # by a stale editor's autosave. Deterministic clock — equal stamps would
    # make the stale-baseline case vacuously pass.
    seq = {"n": 0}
    def tick():
        seq["n"] += 1
        return f"2026-08-12T09:00:{seq['n']:02d}Z"
    monkeypatch.setattr(svc, "_now_iso", tick)
    n = svc.create_note("u1", {"title": "T"}, conn=conn)
    # Matching baseline: succeeds and advances updated_at.
    out = svc.update_note("u1", n["id"], {"title": "A"}, conn=conn,
                          expected_updated_at=n["updatedAt"])
    assert out["title"] == "A"
    assert out["updatedAt"] != n["updatedAt"]
    # A concurrent server-side append moves updated_at → stale baseline refuses.
    svc.append_widget_embed("u1", n["id"], EMBED_ATTRS, conn=conn)
    with pytest.raises(svc.NoteConflictError):
        svc.update_note("u1", n["id"], {"bodyJson": {"type": "doc", "content": []}},
                        conn=conn, expected_updated_at=out["updatedAt"])
    # The refused write changed nothing — the appended embed survives.
    rows = conn.execute(
        "SELECT COUNT(*) AS c FROM j2_note_embeds WHERE note_id = ?", (n["id"],)).fetchone()
    assert rows["c"] == 1
    # No baseline = legacy last-writer-wins, unchanged.
    assert svc.update_note("u1", n["id"], {"title": "B"}, conn=conn)["title"] == "B"


def test_capture_inbox_prunes_past_the_cap(conn, monkeypatch):
    # Insert-side enforcement of the same cap the tray lists by: rows past the
    # newest N were invisible to the tray and therefore undeletable through
    # the only delete path the UI exposes — the unbounded-growth hazard the
    # table was created to avoid, one layer down.
    monkeypatch.setattr(svc, "_CAPTURE_INBOX_CAP", 5)
    seq = {"n": 0}
    def tick():
        seq["n"] += 1
        return f"2026-08-12T{seq['n'] // 60:02d}:{seq['n'] % 60:02d}:00Z"
    monkeypatch.setattr(svc, "_now_iso", tick)
    ids = [svc.create_capture("u1", {"widgetId": "chart"}, conn=conn)["id"] for _ in range(8)]
    rows = svc.list_captures("u1", conn=conn)
    assert [r["id"] for r in rows] == list(reversed(ids[3:]))  # newest 5 only
    left = conn.execute(
        "SELECT COUNT(*) AS c FROM j2_capture_inbox WHERE user_id = 'u1'").fetchone()
    assert left["c"] == 5, "pruned rows must be DELETED, not merely unlisted"


def test_capture_inbox_crud(conn):
    made = svc.create_capture("u1", {
        "widgetId": "chart", "params": {"symbol": "AMD", "tf": "5"},
        "searchText": "[chart: AMD 5m]"}, conn=conn)
    rows = svc.list_captures("u1", conn=conn)
    assert len(rows) == 1
    assert rows[0]["widgetId"] == "chart"
    assert rows[0]["params"] == {"symbol": "AMD", "tf": "5"}
    assert svc.list_captures("u2", conn=conn) == []
    assert svc.delete_capture("u2", made["id"], conn=conn) is False
    assert svc.delete_capture("u1", made["id"], conn=conn) is True
    assert svc.list_captures("u1", conn=conn) == []
    with pytest.raises(NoteValidationError):
        svc.create_capture("u1", {"params": {}}, conn=conn)
    # The byte ceiling (launch-audit finding): the inbox was the only
    # Journal-Widgets write path with no size cap on the shared auth.db.
    with pytest.raises(NoteValidationError):
        svc.create_capture(
            "u1",
            {"widgetId": "aisearch", "params": {"thread": [{"answer": "x" * (300 * 1024)}]}},
            conn=conn,
        )


def test_capture_inbox_carries_capture_time_annotations(conn):
    # Chart-parity review finding: the inbox wire dropped annotations, so the
    # tray's place() re-seeded drawings from the LIVE store at placement time —
    # an embed labeled "captured Monday" carried Tuesday's drawings while the
    # append-to-note route kept Monday's. The row must carry the capture-time
    # copy end to end.
    marks = [{"id": "d1", "type": "horizontal", "points": [{"price": 123.4}]}]
    svc.create_capture("u1", {
        "widgetId": "chart", "params": {"symbol": "AMD", "tf": "5"},
        "annotations": marks}, conn=conn)
    rows = svc.list_captures("u1", conn=conn)
    assert rows[0]["annotations"] == marks
    # Absent stays a clean empty list (legacy rows included), not None.
    svc.create_capture("u1", {"widgetId": "chart"}, conn=conn)
    fresh = svc.list_captures("u1", conn=conn)[0]
    assert fresh["annotations"] == []
    # Malformed shape is refused, not stored.
    with pytest.raises(NoteValidationError):
        svc.create_capture("u1", {"widgetId": "chart", "annotations": "not-a-list"}, conn=conn)
    # Annotations count toward the 256KB ceiling — they ride the same row.
    with pytest.raises(NoteValidationError):
        svc.create_capture(
            "u1",
            {"widgetId": "chart", "annotations": [{"note": "x" * (300 * 1024)}]},
            conn=conn,
        )


# ── Import headroom guard wiring (notes_quota.assert_import_headroom) ───────
#
# Both byte-level upload paths call assert_import_headroom() right beside
# their existing size-cap checks (_MAX_IMAGE_BYTES / _MAX_FILE_BYTES) so a
# volume-full condition is refused the same way an oversized file already is:
# NoteValidationError, not a raw NoteQuotaExceeded leaking a different shape
# to the router. Monkeypatch the seam (notes_quota._free_bytes) -- never fill
# a real disk to exercise this.

@pytest.fixture
def attach_root(tmp_path, monkeypatch):
    r = tmp_path / "j2_attachments"
    monkeypatch.setattr(svc, "_ATTACHMENT_ROOT", r)
    return r


def test_save_note_image_bytes_refused_when_headroom_short(attach_root, monkeypatch):
    monkeypatch.setattr(notes_quota, "_free_bytes", lambda: 100)  # far below RESERVE_BYTES
    with pytest.raises(NoteValidationError):
        svc.save_note_image_bytes(
            "u1", "n1", b"\x89PNG\r\n\x1a\n" + b"0" * 100, "pic.png", "image/png",
        )
    # Nothing was written to disk by the refused upload.
    assert not any(attach_root.rglob("*")) if attach_root.exists() else True


def test_save_note_image_bytes_succeeds_with_ample_room(attach_root, monkeypatch):
    monkeypatch.setattr(notes_quota, "_free_bytes", lambda: 500 * 1024**3)
    out = svc.save_note_image_bytes(
        "u1", "n1", b"\x89PNG\r\n\x1a\n" + b"0" * 100, "pic.png", "image/png",
    )
    assert out["url"].startswith("/api/j2/notes/attachments/u1/n1/inline/")


def test_save_note_attachment_bytes_refused_when_headroom_short(attach_root, monkeypatch):
    monkeypatch.setattr(notes_quota, "_free_bytes", lambda: 100)  # far below RESERVE_BYTES
    with pytest.raises(NoteValidationError):
        svc.save_note_attachment_bytes(
            "u1", "n1", b"%PDF-1.4 " + b"0" * 100, "doc.pdf", "application/pdf",
        )
    assert not any(attach_root.rglob("*")) if attach_root.exists() else True


def test_save_note_attachment_bytes_succeeds_with_ample_room(attach_root, monkeypatch):
    monkeypatch.setattr(notes_quota, "_free_bytes", lambda: 500 * 1024**3)
    out = svc.save_note_attachment_bytes(
        "u1", "n1", b"%PDF-1.4 " + b"0" * 100, "doc.pdf", "application/pdf",
    )
    assert out["url"].startswith("/api/j2/notes/attachments/u1/n1/file/")
    assert out["name"] == "doc.pdf"


# ── GET /api/j2/notes — the total actually reaches the JSON response ────────
#
# The repo's standing trap: a service can compute the right number and a
# whitelist dict-rebuild between the service and the wire can still drop it,
# leaving the reader at zero forever. This mounts the REAL router (not just
# the service function) so the assertion is on what actually serializes over
# the wire, not on an intermediate value.

@pytest.fixture
def route_client(monkeypatch, tmp_path):
    """Minimal app mounting the real journal_two router, with get_current_user
    overridden and the service DB pointed at a seeded temp file — mirrors
    test_filters.py's `route_client` fixture for the trades additive envelope."""
    from api.services import auth_db
    from api.middleware.auth_middleware import get_current_user
    from api.routers import journal_two

    db_path = str(tmp_path / "j2_notes_route.db")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)
    for i in range(120):
        svc.create_note("u1", {"title": f"Note {i}"}, conn=conn)
    f = svc.create_folder("u1", "Earnings", conn=conn)
    svc.create_note("u1", {"title": "Filed", "folderId": f["id"]}, conn=conn)
    conn.commit()
    conn.close()

    # get_connection() reads the module-global _DB_PATH at call time.
    monkeypatch.setattr(auth_db, "_DB_PATH", db_path)

    app = FastAPI()
    app.include_router(journal_two.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1"}
    client = TestClient(app)
    client.folder_id = f["id"]
    return client


def test_route_total_reflects_the_full_library_not_the_page(route_client):
    """121 notes exist (120 + 1 filed); the default page caps at 100. `total`
    must be the honest 121, and it must be a SIBLING key next to `notes` —
    not something the frontend has to derive from page length."""
    r = route_client.get("/api/j2/notes")
    assert r.status_code == 200
    body = r.json()
    assert len(body["notes"]) == 100          # the page cap, unchanged
    assert body["total"] == 121                # the TRUE total, not len(notes)
    assert body["limit"] == 100
    assert body["offset"] == 0


def test_route_total_respects_the_folder_filter(route_client):
    """A folder-scoped request's total must be that folder's count, not the
    library's — proves the router wires the SAME filters into count_notes
    that it uses for the list."""
    r = route_client.get(f"/api/j2/notes?folder_id={route_client.folder_id}")
    assert r.status_code == 200
    body = r.json()
    assert [n["title"] for n in body["notes"]] == ["Filed"]
    assert body["total"] == 1


def test_route_paginates_past_the_first_page_via_offset(route_client):
    """The route already accepted limit/offset — this proves paging past the
    100-row default actually surfaces the remaining rows via `offset`, and
    that two consecutive pages together add up to the honest total with no
    duplicates."""
    first = route_client.get("/api/j2/notes?limit=100&offset=0").json()
    second = route_client.get("/api/j2/notes?limit=100&offset=100").json()
    assert len(first["notes"]) == 100
    assert len(second["notes"]) == 21           # 121 total - 100 on page one
    first_ids = {n["id"] for n in first["notes"]}
    second_ids = {n["id"] for n in second["notes"]}
    assert not (first_ids & second_ids)          # no overlap
    assert len(first_ids | second_ids) == 121    # nothing dropped either


def test_route_tags_endpoint_reflects_the_whole_library_not_a_page(monkeypatch, tmp_path):
    """`GET /api/j2/notes/tags` is the honest source FolderSidebar's tag
    cloud consumes (final-review C5). 120 notes share a tag — more than one
    `list_notes` page (100) — through the REAL router, proving the count
    that reaches the wire is a whole-library count, not `len(page)`. A
    second user's identically-tagged note must not leak into the total."""
    from api.services import auth_db
    from api.middleware.auth_middleware import get_current_user
    from api.routers import journal_two

    db_path = str(tmp_path / "j2_notes_tags_route.db")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)
    for i in range(120):
        svc.create_note("u1", {"title": f"Note {i}", "tags": ["earnings"]}, conn=conn)
    svc.create_note("u2", {"title": "Not mine", "tags": ["earnings"]}, conn=conn)
    conn.commit()
    conn.close()

    monkeypatch.setattr(auth_db, "_DB_PATH", db_path)
    app = FastAPI()
    app.include_router(journal_two.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1"}
    client = TestClient(app)

    r = client.get("/api/j2/notes/tags")
    assert r.status_code == 200
    assert r.json()["tags"] == [{"tag": "earnings", "count": 120}]


# ── Wave 0 trash + folder-count routes ──────────────────────────────────────

def test_route_delete_is_soft_restore_undoes_it(route_client):
    r = route_client.get("/api/j2/notes?limit=1")
    note_id = r.json()["notes"][0]["id"]

    d = route_client.delete(f"/api/j2/notes/{note_id}")
    assert d.status_code == 200 and d.json() == {"ok": True}

    # Gone from the active view, present in the trash view.
    assert route_client.get(f"/api/j2/notes/{note_id}").status_code == 404
    trashed_ids = {n["id"] for n in route_client.get("/api/j2/notes?deleted=true").json()["notes"]}
    assert note_id in trashed_ids

    restore = route_client.post(f"/api/j2/notes/{note_id}/restore")
    assert restore.status_code == 200
    assert restore.json()["note"]["id"] == note_id
    assert route_client.get(f"/api/j2/notes/{note_id}").status_code == 200


def test_route_restore_of_a_never_deleted_note_404s(route_client):
    r = route_client.get("/api/j2/notes?limit=1")
    note_id = r.json()["notes"][0]["id"]
    assert route_client.post(f"/api/j2/notes/{note_id}/restore").status_code == 404


def test_route_delete_of_missing_note_404s(route_client):
    assert route_client.delete("/api/j2/notes/does-not-exist").status_code == 404


def test_route_folder_counts_reflects_the_whole_library(route_client):
    r = route_client.get("/api/j2/notes/folder-counts")
    assert r.status_code == 200
    body = r.json()
    assert body["counts"] == {route_client.folder_id: 1}
    assert body["unfiled"] == 120
    assert body["total"] == 121


def test_route_by_folders_returns_scoped_note_lists(route_client):
    r = route_client.get(f"/api/j2/notes/by-folders?ids={route_client.folder_id}")
    assert r.status_code == 200
    by_folder = r.json()["byFolder"]
    assert [n["title"] for n in by_folder[route_client.folder_id]] == ["Filed"]


def test_route_by_folders_with_no_ids_is_a_harmless_no_op(route_client):
    r = route_client.get("/api/j2/notes/by-folders?ids=")
    assert r.status_code == 200
    assert r.json()["byFolder"] == {}
