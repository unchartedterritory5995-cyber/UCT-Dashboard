"""Tests for Journal 2.0 Notebook service (notes.py)."""

from __future__ import annotations

import sqlite3

import pytest

from api.services.journal_two import notes as svc
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


def test_update_note_resyncs_and_delete_cleans_sidecar(conn):
    n = svc.create_note("u1", {"title": "T", "bodyJson": WIDGET_DOC}, conn=conn)
    svc.update_note("u1", n["id"], {"bodyJson": {
        "type": "doc", "content": [WIDGET_DOC["content"][1]]}}, conn=conn)
    rows = conn.execute(
        "SELECT widget_id FROM j2_note_embeds WHERE note_id = ?", (n["id"],)).fetchall()
    assert [r["widget_id"] for r in rows] == ["chart"]
    svc.delete_note("u1", n["id"], conn=conn)
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
