"""P2 Tier 3 final fix I1: a COPIED check-in starts unpicked, through every door that copies a body.

A pick keeps its block's `day` (R-T3-2, `nextCheckinParams`), so a check-in that travelled with a copied
body would record every later pick on the copy against the SOURCE's day: Oct 16's note duplicated on
Oct 20 and re-picked would move Oct 16's mood and leave Oct 20 with none. Every copy door therefore
resets the copy's check-ins to the builder's unpicked shape (`trader_blocks.CHECKIN_UNPICKED`) through
ONE helper, `trader_blocks.unpick_checkins`. The doors, enumerated from source (final-fix-report.md):

  1. Duplicate note           POST /api/j2/notes {isCopy: true}         notes.create_note
  2. Save as template         POST /api/j2/note-templates {noteId}      note_templates.create_from_note
  3. New note from a template GET /api/j2/note-templates/{id}           note_templates.get_template
  4. Today's daily note       note_daily.open_daily_note(template_id)   note_templates.get_template
  5. A style's outline        journal_styles.compose                    journal_styles._outline_doc
  6. The community gallery    publish / use                             public reducer: no check-in survives

Each door test asserts the COPY's stored check-in has no day and no picks, and that the SOURCE's
check-in is unchanged (which is also the control: the source really was picked and recorded).

⛔ NOT a copy door, by decision: the two conflicted copies (the editor's and the outbox drain's). They
hold the member's own UNSENT version of the same note, on the day it was written; resetting them would
delete the pick the copy exists to keep. `test_a_create_without_is_copy_keeps_the_pick` pins that path.
"""
from __future__ import annotations

import importlib
import json
import os
import sqlite3
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

DAY = "2026-10-16"


# ── fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def conn():
    from api.services.journal_two.db import ensure_schema
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    yield c
    c.close()


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


@pytest.fixture
def client(db_path):
    from api.middleware import auth_middleware as authmw
    from api.routers import journal_two as journal_two_router
    app = FastAPI()
    app.include_router(journal_two_router.router)
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u1", "role": "member"}
    yield TestClient(app)
    app.dependency_overrides.clear()


# ── helpers ──────────────────────────────────────────────────────────────────

def _checkin(mood="4", focus="3", day=DAY, embed_id="ci-1"):
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": "moodCheckIn", "embedId": embed_id, "mode": "snapshot",
        "params": {"mood": mood, "focus": focus, "day": day},
        "searchText": "[mood and focus check-in]",
    }}


def _picked_doc():
    """A picked check-in at the top level and one nested in a column, beside ordinary text."""
    return {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "Morning"}]},
        _checkin(embed_id="ci-top"),
        {"type": "columns", "content": [{"type": "column", "content": [_checkin(mood="2", focus="5",
                                                                                embed_id="ci-nested")]}]},
    ]}


def _checkins_in(body):
    """Every check-in's params in `body`, in document order."""
    found = []

    def walk(node):
        if not isinstance(node, dict):
            return
        attrs = node.get("attrs") or {}
        if node.get("type") == "widgetEmbed" and attrs.get("widgetId") == "moodCheckIn":
            found.append(dict(attrs.get("params") or {}))
        for child in node.get("content") or []:
            walk(child)

    walk(body)
    return found


UNPICKED = {"mood": "", "focus": "", "day": ""}


def _db():
    from api.services.auth_db import get_connection
    return get_connection()


def _sidecar(note_id):
    c = _db()
    try:
        return [dict(r) for r in c.execute(
            "SELECT embed_id, day, mood, focus FROM j2_note_checkins WHERE note_id = ? ORDER BY embed_id",
            (note_id,)).fetchall()]
    finally:
        c.close()


def _stored_body(table, row_id):
    c = _db()
    try:
        return json.loads(c.execute(f"SELECT body_json FROM {table} WHERE id = ?", (row_id,)).fetchone()[0])
    finally:
        c.close()


SOURCE_ROWS = [{"embed_id": "ci-nested", "day": DAY, "mood": 2, "focus": 5},
               {"embed_id": "ci-top", "day": DAY, "mood": 4, "focus": 3}]


def _source(client):
    r = client.post("/api/j2/notes", json={"title": "Oct 16", "bodyJson": _picked_doc()})
    assert r.status_code == 200, r.text
    note = r.json()["note"]
    # Control: the source is picked, and its sidecar recorded both blocks.
    assert _sidecar(note["id"]) == SOURCE_ROWS
    return note


def _assert_source_unchanged(note_id):
    assert _sidecar(note_id) == SOURCE_ROWS
    assert _checkins_in(_stored_body("j2_notes", note_id)) == [
        {"mood": "4", "focus": "3", "day": DAY}, {"mood": "2", "focus": "5", "day": DAY}]


# ── the one helper ───────────────────────────────────────────────────────────

def test_the_helper_unpicks_every_check_in_and_changes_nothing_else():
    from api.services.journal_two import trader_blocks as tb
    body = _picked_doc()
    before = json.dumps(body, sort_keys=True)
    out = tb.unpick_checkins(body)
    assert _checkins_in(out) == [UNPICKED, UNPICKED]
    assert json.dumps(body, sort_keys=True) == before, "the source body must never be changed"
    # Everything but the picks survives: the text, the embed ids, the searchText.
    assert out["content"][0] == body["content"][0]
    assert out["content"][1]["attrs"]["embedId"] == "ci-top"
    assert out["content"][1]["attrs"]["searchText"] == "[mood and focus check-in]"


def test_the_helper_resets_to_exactly_the_shape_the_style_builder_makes():
    """The unpicked shape is the builder's own, not a second copy of it."""
    from api.services.journal_two import trader_blocks as tb
    built, _ = tb.BUILDERS["moodCheckIn"]({}, {"now": __import__("datetime").datetime(2026, 10, 20)})
    assert built["attrs"]["params"] == tb.CHECKIN_UNPICKED == UNPICKED


# ── door 1: Duplicate note ───────────────────────────────────────────────────

def test_door_duplicate_note_stores_the_copy_unpicked_and_leaves_the_source(client):
    src = _source(client)
    r = client.post("/api/j2/notes", json={"title": "Copy of Oct 16", "bodyJson": src["bodyJson"],
                                           "isCopy": True})
    assert r.status_code == 200, r.text
    copy_id = r.json()["note"]["id"]
    assert _checkins_in(_stored_body("j2_notes", copy_id)) == [UNPICKED, UNPICKED]
    assert _sidecar(copy_id) == []
    _assert_source_unchanged(src["id"])


def test_a_create_without_is_copy_keeps_the_pick(client):
    """The conflicted copies' path (no isCopy): the member's unsent pick is kept, on its own day.
    Also pins that only an exact `true` asks for a copy."""
    src = _source(client)
    for flag in (None, "true", 1):
        payload = {"title": "Oct 16 (conflicted copy)", "bodyJson": src["bodyJson"]}
        if flag is not None:
            payload["isCopy"] = flag
        r = client.post("/api/j2/notes", json=payload)
        assert r.status_code == 200, r.text
        assert _sidecar(r.json()["note"]["id"]) == SOURCE_ROWS, flag


# ── door 2: Save as template ─────────────────────────────────────────────────

def test_door_save_as_template_stores_the_template_unpicked_and_leaves_the_source(client):
    src = _source(client)
    r = client.post("/api/j2/note-templates", json={"noteId": src["id"]})
    assert r.status_code == 200, r.text
    tid = r.json()["template"]["id"]
    assert _checkins_in(_stored_body("j2_note_templates", tid)) == [UNPICKED, UNPICKED]
    _assert_source_unchanged(src["id"])


# ── doors 3 and 4: a note from a template ────────────────────────────────────

def _picked_template(user_id="u1"):
    """A template stored PICKED, as one saved before this fix would be (the read must still clean it)."""
    c = _db()
    try:
        c.execute("INSERT INTO j2_note_templates (id, user_id, name, title, body_json, properties_json,"
                  " created_at, updated_at) VALUES ('t-old', ?, 'Daily', 'Daily', ?, NULL, 'x', 'x')",
                  (user_id, json.dumps(_picked_doc())))
        c.commit()
    finally:
        c.close()
    return "t-old"


def test_door_new_note_from_a_template_reads_the_template_unpicked(client):
    tid = _picked_template()
    r = client.get(f"/api/j2/note-templates/{tid}")
    assert r.status_code == 200, r.text
    body = r.json()["template"]["bodyJson"]
    assert _checkins_in(body) == [UNPICKED, UNPICKED]
    # The client's create-from-template write sends exactly that body: nothing is recorded.
    made = client.post("/api/j2/notes", json={"title": "Oct 20", "bodyJson": body}).json()["note"]
    assert _sidecar(made["id"]) == []
    # The template (the source) is never written by a read.
    assert _checkins_in(_stored_body("j2_note_templates", tid))[0] == {"mood": "4", "focus": "3", "day": DAY}


def test_door_todays_daily_note_from_a_template_starts_unpicked(db_path):
    from api.services.journal_two import note_daily
    tid = _picked_template()
    out = note_daily.open_daily_note("u1", "2026-10-20", tid)
    assert out["created"] is True
    note_id = out["note"]["id"]
    assert _checkins_in(_stored_body("j2_notes", note_id)) == [UNPICKED, UNPICKED]
    assert _sidecar(note_id) == []
    assert _checkins_in(_stored_body("j2_note_templates", tid))[0] == {"mood": "4", "focus": "3", "day": DAY}


# ── door 5: a style's outline ────────────────────────────────────────────────

def test_door_a_style_outline_from_a_template_composes_unpicked(conn, monkeypatch):
    from api.services.journal_two import journal_styles as js
    monkeypatch.setenv("JOURNAL_TIER3_ENABLED", "true")   # the switch on: off drops the node (R-T3-FIN-4)
    conn.execute("INSERT INTO j2_note_templates (id, user_id, name, title, body_json, properties_json,"
                 " created_at, updated_at) VALUES ('t-old', 'u1', 'Daily', 'Daily', ?, NULL, 'x', 'x')",
                 (json.dumps(_picked_doc()),))
    style = {"id": "s1", "version": 1, "kindId": "daily", "outlineTemplateId": "t-old", "blocks": [],
             "properties": {}}
    composed = js.compose("u1", style, ticker=None, conn=conn, mode="update")
    assert _checkins_in(composed["bodyJson"]) == [UNPICKED, UNPICKED]
    stored = json.loads(conn.execute("SELECT body_json FROM j2_note_templates WHERE id='t-old'").fetchone()[0])
    assert _checkins_in(stored)[0] == {"mood": "4", "focus": "3", "day": DAY}


def test_door_a_style_inline_outline_composes_unpicked(conn, monkeypatch):
    from api.services.journal_two import journal_styles as js
    monkeypatch.setenv("JOURNAL_TIER3_ENABLED", "true")   # the switch on: off drops the node (R-T3-FIN-4)
    style = {"id": "s1", "version": 1, "kindId": "daily", "outlineTemplateId": None,
             "outlineBodyJson": _picked_doc(), "blocks": [], "properties": {}}
    composed = js.compose("u1", style, ticker=None, conn=conn, mode="update")
    assert _checkins_in(composed["bodyJson"]) == [UNPICKED, UNPICKED]
    assert _checkins_in(style["outlineBodyJson"])[0] == {"mood": "4", "focus": "3", "day": DAY}


# ── import: a RESTORE, so it KEEPS the picks (ruling R-T3-FIN-3) ─────────────

def test_import_is_a_restore_and_keeps_the_check_in_picks_and_day(client):
    """The JSON export round trip (lib/importer/uctJson.js) brings `bodyJson` back verbatim. A member
    restoring a backup expects their days back, as the conflicted copies keep theirs, so import never
    unpicks: the imported note's sidecar records the same days and levels."""
    src = _source(client)
    r = client.post("/api/j2/notes/import/confirm", json={"source": "uct-json", "notes": [
        {"importKey": "uct:backup-1", "title": "Oct 16", "bodyJson": src["bodyJson"], "tags": []}]})
    assert r.status_code == 200, r.text
    created = r.json()["created"]
    assert len(created) == 1
    new_id = created[0]["id"] if isinstance(created[0], dict) else created[0]
    assert new_id != src["id"]
    assert _sidecar(new_id) == SOURCE_ROWS
    # An import never arrives already shared (ruling R60, c871a0d904): every widget gains `share: False`.
    # The picks and the day are what a restore keeps; the share switch is the import rule's, not the backup's.
    assert _checkins_in(_stored_body("j2_notes", new_id)) == [
        {"mood": "4", "focus": "3", "day": DAY, "share": False},
        {"mood": "2", "focus": "5", "day": DAY, "share": False}]
    _assert_source_unchanged(src["id"])


# ── door 6: the community gallery ────────────────────────────────────────────

def test_door_the_gallery_carries_no_check_in_at_all():
    """Publish and use both run the body through the gallery reducer, which turns every widgetEmbed
    into the neutral line: a gallery copy holds no check-in to reset. Pinned so a reducer change that
    starts keeping widgets has to come back here."""
    from api.services.journal_two import template_gallery as gallery
    out = gallery.sanitize_body(_picked_doc(), "u1")
    assert _checkins_in(out) == []
    assert "moodCheckIn" not in json.dumps(out)
