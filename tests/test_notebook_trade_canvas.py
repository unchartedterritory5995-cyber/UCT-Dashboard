"""Wave 11 lane 11D -- the trade-plan canvas, server side.

A canvas is an ORDINARY note whose body is one `tradeCanvas` block atom holding
the board in its attributes. There is no route of its own: this file proves the
note's existing doors carry it -- create, the compare-and-set PUT, the schema
guard (level 3: an older bundle is refused the write that would blank the plan),
body_plain / search / mentions (from the node's `searchText`), backlinks and the
graph (a thesis links to the canvas with an ordinary `noteLink`), version history
and restore, trash, and every export (Markdown, web page, Word) -- plus the gate
on the auth payload, dark by default.
"""
from __future__ import annotations

import io
import json
import os
import zipfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.routers import auth as auth_router
from api.services import auth_db
from api.services.journal_two import notebook_schema as nbs
from api.services.journal_two import notes_export as nx
from api.services.journal_two import notes_export_formats as nxf
from api.services.journal_two import trade_canvas as tc
from api.services.journal_two.db import ensure_schema as j2_ensure_schema
from api.services.journal_two.notes import extract_plain_text

HEADER = nbs.NOTEBOOK_SCHEMA_HEADER
FLAG = "NOTEBOOK_TRADE_CANVAS_ENABLED"
KEY = "notebook_trade_canvas_enabled"

BOARD = {
    "v": 1,
    "items": [
        {"id": "c1", "kind": "chart", "x": 0, "y": 0, "w": 480, "h": 300, "symbol": "NVDA", "tf": "D",
         "mode": "live", "asOf": None},
        {"id": "c2", "kind": "chart", "x": 0, "y": 360, "w": 480, "h": 300, "symbol": "NVDA", "tf": "60",
         "mode": "frozen", "asOf": "2026-09-24"},
        {"id": "t1", "kind": "text", "x": 560, "y": 0, "w": 240, "h": 140,
         "text": "Base breakout over the 50-day\nwith volume"},
        {"id": "s1", "kind": "sticky", "x": 560, "y": 200, "w": 180, "h": 110, "text": "Earnings 10/28", "color": "gold"},
    ],
    "edges": [{"id": "e1", "from": "t1", "to": "c1", "label": "if it holds"}],
    "levels": [
        {"id": "l3", "role": "target", "label": "Target", "price": 205, "chartId": "c1"},
        {"id": "l1", "role": "entry", "label": "Entry", "price": 182.5, "chartId": "c1"},
        {"id": "l2", "role": "stop", "label": "Stop", "price": 171, "chartId": None},
    ],
}
SEARCH = ("Trade-plan canvas · $NVDA Daily chart · $NVDA 1 hour chart frozen as of 2026-09-24 · "
          "Entry 182.50 · Stop 171.00 · Target 205.00 · Base breakout over the 50-day with volume · "
          "Earnings 10/28 · if it holds")


def canvas_doc(board=BOARD, search=SEARCH):
    return {"type": "doc", "content": [
        {"type": "tradeCanvas", "attrs": {"board": board, "searchText": search}},
        {"type": "paragraph"},
    ]}


# ── the gate ────────────────────────────────────────────────────────────────


def _payload(**env):
    old = {k: os.environ.get(k) for k in env}
    try:
        for k, v in env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        return auth_router._access_payload({"role": "member"}, "free")
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def _find(obj, key):
    if isinstance(obj, dict):
        if key in obj:
            return obj[key]
        for v in obj.values():
            got = _find(v, key)
            if got is not None:
                return got
    return None


def test_the_gate_is_DARK_unless_set_and_rides_the_auth_payload():
    assert auth_router.NOTEBOOK_FLAGS[FLAG] is False
    assert _find(_payload(**{FLAG: None}), KEY) is False
    assert _find(_payload(**{FLAG: "1"}), KEY) is True
    assert _find(_payload(**{FLAG: "0"}), KEY) is False
    # an unrecognised value takes the default (OFF), never its opposite
    assert _find(_payload(**{FLAG: "maybe"}), KEY) is False


def test_the_ledger_declares_the_gate_dark_with_a_reason():
    ledger = json.loads(open("docs/feature_flags.json", encoding="utf-8").read())["flags"]
    row = ledger[FLAG]
    assert row["status"] == "dark" and row["where"] == []
    assert "never-revert" in row["note"].lower() and "tradeCanvas" in row["note"]


# ── the schema level (never-revert) ─────────────────────────────────────────


def test_the_canvas_node_is_schema_level_3_on_the_server():
    assert nbs.NOTEBOOK_TYPE_SCHEMA["tradeCanvas"] == 3
    assert max(nbs.NOTEBOOK_TYPE_SCHEMA.values()) == 3
    assert nbs.required_schema(canvas_doc()) == 3
    # CONTROL: an ordinary body needs nothing newer than before
    assert nbs.required_schema({"type": "doc", "content": [{"type": "paragraph"}]}) == 0


# ── the doors, through the real router ──────────────────────────────────────


@pytest.fixture
def client(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    conn = auth_db.get_connection()
    j2_ensure_schema(conn)
    conn.close()
    from api.routers import journal_two as j2_router
    fa = FastAPI()
    fa.include_router(j2_router.router)
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u1", "role": "member"}
    yield TestClient(fa)
    fa.dependency_overrides.clear()


def _row(note_id: str):
    conn = auth_db.get_connection()
    try:
        return conn.execute("SELECT body_json, body_plain FROM j2_notes WHERE id = ?", (note_id,)).fetchone()
    finally:
        conn.close()


def _create(client, body=None, title="NVDA trade plan", **extra):
    r = client.post("/api/j2/notes", json={"title": title, "bodyJson": body or canvas_doc(), **extra})
    assert r.status_code == 200, r.text
    return r.json()["note"]


def test_a_canvas_is_created_through_the_ordinary_note_door_and_stored_whole(client):
    note = _create(client, tags=["trade-plan"], ticker="NVDA")
    body, plain = _row(note["id"])
    stored = json.loads(body)
    assert stored["content"][0]["type"] == "tradeCanvas"
    assert stored["content"][0]["attrs"]["board"] == BOARD          # byte-for-byte the board
    # ⛔ body_plain (the search index) reads the node's search line
    assert "$NVDA Daily chart" in plain and "Entry 182.50" in plain
    got = client.get(f"/api/j2/notes/{note['id']}").json()["note"]
    assert got["bodyJson"]["content"][0]["attrs"]["board"]["levels"][1]["price"] == 182.5
    assert "trade-plan" in got["tags"]


def test_search_finds_a_canvas_by_its_card_text_and_its_ticker(client):
    note = _create(client)
    r = client.get("/api/j2/notes", params={"q": "breakout"})
    assert r.status_code == 200, r.text
    assert note["id"] in [n["id"] for n in r.json()["notes"]]
    # CONTROL: a word nowhere on the board finds nothing
    r = client.get("/api/j2/notes", params={"q": "zebracorn"})
    assert note["id"] not in [n["id"] for n in r.json()["notes"]]


def test_a_canvas_counts_as_a_mention_of_its_tickers(client):
    note = _create(client)
    conn = auth_db.get_connection()
    try:
        syms = [r[0] for r in conn.execute("SELECT symbol FROM j2_note_mentions WHERE note_id = ?", (note["id"],))]
    finally:
        conn.close()
    assert "NVDA" in syms


def test_a_board_edit_rides_the_compare_and_set_PUT_at_level_3(client):
    note = _create(client)
    moved = json.loads(json.dumps(BOARD))
    moved["items"][2]["x"] = 640
    r = client.put(f"/api/j2/notes/{note['id']}", headers={HEADER: "3"},
                   json={"bodyJson": canvas_doc(moved), "baseUpdatedAt": note["updatedAt"]})
    assert r.status_code == 200, r.text
    assert json.loads(_row(note["id"])[0])["content"][0]["attrs"]["board"]["items"][2]["x"] == 640
    # ⛔ the compare-and-set still holds: a write from the old revision is a conflict
    stale = client.put(f"/api/j2/notes/{note['id']}", headers={HEADER: "3"},
                       json={"bodyJson": canvas_doc(), "baseUpdatedAt": note["updatedAt"]})
    assert stale.status_code == 409, stale.text
    assert json.loads(_row(note["id"])[0])["content"][0]["attrs"]["board"]["items"][2]["x"] == 640


@pytest.mark.parametrize("declared", [None, "2", "0"])
def test_an_OLDER_bundle_is_refused_the_write_that_would_blank_a_canvas(client, declared):
    """⛔ The never-revert reason, end to end: a bundle without the node (production
    today, or any rollback) opens a canvas EMPTY; its save must be refused, and the
    stored plan must be byte-identical afterwards."""
    note = _create(client)
    before = _row(note["id"])[0]
    headers = {HEADER: declared} if declared is not None else {}
    r = client.put(f"/api/j2/notes/{note['id']}", headers=headers, json={
        "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}, "baseUpdatedAt": note["updatedAt"]})
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == nbs.REFUSAL_DETAIL
    assert _row(note["id"])[0] == before


def test_CONTROL_an_older_bundle_still_writes_an_ordinary_note(client):
    note = _create(client, body={"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "text", "text": "thesis"}]}]}, title="NVDA thesis")
    r = client.put(f"/api/j2/notes/{note['id']}", headers={HEADER: "2"}, json={
        "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}, "baseUpdatedAt": note["updatedAt"]})
    assert r.status_code == 200, r.text


def test_a_thesis_link_to_the_canvas_shows_as_a_backlink_and_a_graph_edge(client):
    canvas = _create(client)
    thesis = _create(client, title="NVDA thesis", body={"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "text", "text": "Trade plan: "}, {"type": "noteLink", "attrs": {"noteId": canvas["id"]}}]}]})
    bl = client.get(f"/api/j2/notes/{canvas['id']}/backlinks").json()
    assert thesis["id"] in [n.get("id") or n.get("noteId") for n in bl.get("notes", bl.get("backlinks", []))]
    g = client.get("/api/j2/notes/graph").json()
    pairs = {(e.get("source"), e.get("target")) for e in g["edges"]}
    assert (thesis["id"], canvas["id"]) in pairs


def test_version_history_keeps_and_restores_an_older_board(client):
    note = _create(client)
    moved = json.loads(json.dumps(BOARD))
    moved["levels"] = []
    # The client re-derives the search line at every commit; a version is a
    # checkpoint of the words (title, body_plain), exactly as for a text note.
    r = client.put(f"/api/j2/notes/{note['id']}", headers={HEADER: "3"}, json={
        "bodyJson": canvas_doc(moved, search=SEARCH.replace(" · Entry 182.50 · Stop 171.00 · Target 205.00", "")),
        "baseUpdatedAt": note["updatedAt"]})
    assert r.status_code == 200, r.text
    items = client.get(f"/api/j2/notes/{note['id']}/versions").json()["versions"]
    assert len(items) == 1, items          # the pre-edit board, checkpointed
    target = items[-1]["id"]
    rr = client.post(f"/api/j2/notes/{note['id']}/versions/{target}/restore")
    assert rr.status_code == 200, rr.text
    restored = json.loads(_row(note["id"])[0])["content"][0]["attrs"]["board"]
    assert len(restored["levels"]) == 3


def test_a_canvas_goes_to_trash_and_comes_back_whole(client):
    note = _create(client)
    assert client.delete(f"/api/j2/notes/{note['id']}").status_code == 200
    assert client.post(f"/api/j2/notes/{note['id']}/restore").status_code == 200
    assert json.loads(_row(note["id"])[0])["content"][0]["attrs"]["board"] == BOARD


# ── export: a readable summary, never a crash ───────────────────────────────


def test_markdown_export_is_a_readable_summary():
    md = nx.tiptap_to_markdown(canvas_doc())
    assert "**Trade-plan canvas — 4 items, 3 levels, 1 arrow**" in md
    # levels in entry / stop / target order, with the chart they are drawn on
    e, s, t = md.index("Entry: 182.50"), md.index("Stop: 171.00"), md.index("Target: 205.00")
    assert e < s < t
    assert "Entry: 182.50 (on NVDA · Daily · live)" in md
    assert "NVDA · 1 hour · frozen as of 2026-09-24" in md
    assert "Base breakout over the 50-day with volume" in md
    assert "Sticky: Earnings 10/28" in md
    assert "→" in md and "(if it holds)" in md


def test_web_page_export_renders_the_summary():
    page = nxf.note_html(canvas_doc(), resolver=None, title="NVDA trade plan")
    assert "Trade-plan canvas" in page and "Entry: 182.50" in page and "frozen as of 2026-09-24" in page


def test_word_export_carries_the_summary():
    data = nxf.note_docx(canvas_doc(), title="NVDA trade plan")
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        xml = z.read("word/document.xml").decode("utf-8")
    assert "Trade-plan canvas" in xml and "Entry: 182.50" in xml and "NVDA · 1 hour · frozen as of 2026-09-24" in xml


@pytest.mark.parametrize("junk", [
    None, [], "board", {"items": "x"}, {"items": [None, 3, {"kind": "chart"}]},
    {"items": [{"id": "a", "kind": "text", "text": ["not", "text"]}], "levels": [{"price": "x"}],
     "edges": [{"from": "a", "to": "zz"}]},
])
def test_no_board_shape_crashes_any_exporter_or_the_plain_text(junk):
    doc = {"type": "doc", "content": [{"type": "tradeCanvas", "attrs": {"board": junk}}]}
    assert "Trade-plan canvas" in nx.tiptap_to_markdown(doc)
    nxf.note_html(doc, resolver=None, title="t")
    nxf.note_docx(doc, title="t")
    assert extract_plain_text(doc) == "[trade-plan canvas]"
    # attrs that are not even a dict
    bad = {"type": "doc", "content": [{"type": "tradeCanvas", "attrs": ["x"]}]}
    assert "Trade-plan canvas (empty)" in nx.tiptap_to_markdown(bad)


def test_the_single_note_export_route_answers_for_a_canvas(client):
    note = _create(client)
    r = client.get(f"/api/j2/notes/{note['id']}/export")
    assert r.status_code == 200, r.text
    assert "Entry: 182.50" in r.content.decode("utf-8", errors="replace")


def test_summary_sections_reads_a_board_the_client_wrote():
    secs = dict(tc.summary_sections({"board": BOARD}))
    assert secs["Levels"][0].startswith("Entry: 182.50")
    assert secs["Charts"] == ["NVDA · Daily · live", "NVDA · 1 hour · frozen as of 2026-09-24"]
    assert tc.fmt_price(0.1234) == "0.1234" and tc.fmt_price(1234.5) == "1,234.50"
