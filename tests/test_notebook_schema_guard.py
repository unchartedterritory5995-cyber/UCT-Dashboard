"""S1 (wave 5 whole-branch review) — the server refuses a body write from a
client too old for the STORED note.

The hazard: TipTap opens a body holding one unknown node or mark type as an
EMPTY document, and that editor's next save writes the empty document over the
note. `origin/master`'s bundle never sends `X-UCT-Notebook-Schema`, so every tab
open at deploy time, and every member after a rollback, reads as schema 0 — and
is refused on a note that holds wave-5 or G-064 content.

⛔ The client table is PARSED here, never restated: a copy in this test would
be a third authority over one fact (the saved-views precedent in CLAUDE.md).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services import auth_db
from api.services.journal_two import notebook_schema as nbs
from api.services.journal_two.db import ensure_schema as j2_ensure_schema
from api.services.user_playbook.db import ensure_schema as upb_ensure_schema

CLIENT_TABLE = Path("app/src/pages/journal-2-0/lib/notebookSchema.js")
HEADER = nbs.NOTEBOOK_SCHEMA_HEADER


def _parse_client_table() -> dict[str, int]:
    js = CLIENT_TABLE.read_text(encoding="utf-8")
    block = re.search(r"NOTEBOOK_TYPE_SCHEMA\s*=\s*Object\.freeze\(\{(.*?)\n\}\)", js, re.S)
    assert block, "could not find NOTEBOOK_TYPE_SCHEMA in notebookSchema.js"
    body = re.sub(r"//[^\n]*", "", block.group(1))
    pairs = re.findall(r"^\s*([A-Za-z_]\w*)\s*:\s*(\d+)\s*,?\s*$", body, re.M)
    return {name: int(level) for name, level in pairs}


def test_the_server_and_client_schema_tables_CANNOT_drift():
    client = _parse_client_table()
    # Non-vacuity: a parse that found nothing would make equality trivially true
    # against an empty server map, and a partial parse would hide a drift.
    assert len(client) >= 35, f"parsed a suspiciously small client table: {sorted(client)}"
    assert client.get("paragraph") == 0 and client.get("inlineMath") == 1
    assert client == nbs.NOTEBOOK_TYPE_SCHEMA, (
        f"client-only {sorted(set(client.items()) - set(nbs.NOTEBOOK_TYPE_SCHEMA.items()))} / "
        f"server-only {sorted(set(nbs.NOTEBOOK_TYPE_SCHEMA.items()) - set(client.items()))}"
    )


def test_the_wave5_and_g064_types_are_level_1_and_nothing_else_is():
    ones = sorted(t for t, lvl in nbs.NOTEBOOK_TYPE_SCHEMA.items() if lvl == 1)
    assert ones == ["askCitation", "askInsert", "blockMath", "highlight", "inlineMath", "textColor"]
    assert set(nbs.NOTEBOOK_TYPE_SCHEMA.values()) == {0, 1}


# ── the rule, as a pure function ──────────────────────────────────────────────

def _doc(*blocks):
    return {"type": "doc", "content": list(blocks)}


def _p(*inline):
    return {"type": "paragraph", "content": list(inline)}


def _t(text, *marks):
    node = {"type": "text", "text": text}
    if marks:
        node["marks"] = [{"type": m} for m in marks]
    return node


def test_required_schema_reads_nodes_marks_nesting_and_malformed_bodies():
    assert nbs.required_schema(_doc(_p(_t("plain", "bold")))) == 0
    assert nbs.required_schema(_doc(_p(_t("x"), {"type": "inlineMath", "attrs": {"latex": "x"}}))) == 1
    assert nbs.required_schema(_doc(_p(_t("key", "highlight")))) == 1
    deep = _doc({"type": "bulletList", "content": [{"type": "listItem", "content": [
        _p(_t("n", "textColor"))]}]})
    assert nbs.required_schema(deep) == 1
    assert nbs.required_schema(json.dumps(deep)) == 1          # stored as TEXT
    assert nbs.required_schema(_doc(_p(_t("x")), {"type": "somethingNew"})) == 0   # unknown ⇒ 0
    for junk in (None, "", "not json", 7, [], {"content": "nope"}, {"type": 5, "marks": "x"}):
        assert nbs.required_schema(junk) == 0
    # far deeper than the recursion limit
    node = _p(_t("leaf", "highlight"))
    for _ in range(5000):
        node = {"type": "blockquote", "content": [node]}
    assert nbs.required_schema(_doc(node)) == 1


def test_declared_schema_treats_missing_or_unparseable_as_the_oldest_client():
    assert nbs.declared_schema(None) == 0
    assert nbs.declared_schema("") == 0
    assert nbs.declared_schema("abc") == 0
    assert nbs.declared_schema("-3") == 0
    assert nbs.declared_schema(" 1 ") == 1
    assert nbs.declared_schema("2") == 2


# ── the doors ─────────────────────────────────────────────────────────────────

WAVE5_BODY = _doc(_p(_t("NVDA thesis "), {"type": "inlineMath", "attrs": {"latex": "\\pi r^2"}}),
                  _p(_t("key level", "highlight")))
OLD_BODY = _doc(_p(_t("NVDA thesis", "bold")))
BLANK_PLUS_TYPED = _doc(_p(_t("one line typed into an empty-looking editor")))


@pytest.fixture
def app(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    conn = auth_db.get_connection()
    j2_ensure_schema(conn)
    upb_ensure_schema(conn)
    conn.close()
    from api.routers import journal_two as j2_router
    from api.routers import user_playbook as upb_router
    fa = FastAPI()
    fa.include_router(j2_router.router)
    fa.include_router(upb_router.router)
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u1", "role": "member"}
    yield fa
    fa.dependency_overrides.clear()


@pytest.fixture
def client(app):
    return TestClient(app)


def _stored_note_body(note_id: str) -> str:
    conn = auth_db.get_connection()
    try:
        return conn.execute("SELECT body_json FROM j2_notes WHERE id = ?", (note_id,)).fetchone()[0]
    finally:
        conn.close()


def _note(client, body):
    r = client.post("/api/j2/notes", json={"title": "NVDA thesis", "bodyJson": body})
    assert r.status_code == 200, r.text
    return r.json()["note"]


def test_an_old_client_cannot_write_a_body_over_a_wave5_note(client):
    note = _note(client, WAVE5_BODY)
    before = _stored_note_body(note["id"])
    r = client.put(f"/api/j2/notes/{note['id']}", json={
        "bodyJson": BLANK_PLUS_TYPED, "baseUpdatedAt": note["updatedAt"]})
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == nbs.REFUSAL_DETAIL
    assert _stored_note_body(note["id"]) == before          # byte-identical


def test_an_unparseable_header_is_the_oldest_client(client):
    note = _note(client, WAVE5_BODY)
    before = _stored_note_body(note["id"])
    r = client.put(f"/api/j2/notes/{note['id']}", headers={HEADER: "banana"},
                   json={"bodyJson": BLANK_PLUS_TYPED})
    assert r.status_code == 409
    assert _stored_note_body(note["id"]) == before


def test_a_current_client_writes_a_wave5_note(client):
    note = _note(client, WAVE5_BODY)
    r = client.put(f"/api/j2/notes/{note['id']}", headers={HEADER: "1"},
                   json={"bodyJson": BLANK_PLUS_TYPED, "baseUpdatedAt": note["updatedAt"]})
    assert r.status_code == 200, r.text
    assert json.loads(_stored_note_body(note["id"])) == BLANK_PLUS_TYPED


def test_an_old_client_still_writes_an_old_note(client):
    """⛔ THE CONTROL: old tabs keep working on notes they can read."""
    note = _note(client, OLD_BODY)
    r = client.put(f"/api/j2/notes/{note['id']}", json={
        "bodyJson": BLANK_PLUS_TYPED, "baseUpdatedAt": note["updatedAt"]})
    assert r.status_code == 200, r.text
    assert json.loads(_stored_note_body(note["id"])) == BLANK_PLUS_TYPED


def test_an_old_client_may_still_change_a_wave5_notes_metadata(client):
    """The guard is on BODY writes: a folder, tag or ticker change carries no
    body and cannot blank anything."""
    note = _note(client, WAVE5_BODY)
    before = _stored_note_body(note["id"])
    r = client.put(f"/api/j2/notes/{note['id']}", json={"tags": ["nvda"]})
    assert r.status_code == 200, r.text
    assert _stored_note_body(note["id"]) == before


def test_a_mark_alone_is_enough_to_refuse(client):
    note = _note(client, _doc(_p(_t("key level", "textColor"))))
    r = client.put(f"/api/j2/notes/{note['id']}", json={"bodyJson": BLANK_PLUS_TYPED})
    assert r.status_code == 409


# ── the playbook-entry door ───────────────────────────────────────────────────

def _entry(client, body):
    s = client.post("/api/upb/sections", json={"title": "Breakouts"})
    assert s.status_code == 200, s.text
    r = client.post(f"/api/upb/sections/{s.json()['section']['id']}/entries",
                    json={"title": "HTF", "body_json": body})
    assert r.status_code == 200, r.text
    return r.json()["entry"]


def _stored_entry_body(entry_id: str) -> str:
    conn = auth_db.get_connection()
    try:
        return conn.execute("SELECT body_json FROM upb_entries WHERE id = ?", (entry_id,)).fetchone()[0]
    finally:
        conn.close()


def test_an_old_client_cannot_write_a_body_over_a_wave5_playbook_entry(client):
    entry = _entry(client, WAVE5_BODY)
    before = _stored_entry_body(entry["id"])
    r = client.put(f"/api/upb/entries/{entry['id']}", json={"body_json": BLANK_PLUS_TYPED})
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == nbs.REFUSAL_DETAIL
    assert _stored_entry_body(entry["id"]) == before


def test_a_current_client_writes_a_wave5_playbook_entry(client):
    entry = _entry(client, WAVE5_BODY)
    r = client.put(f"/api/upb/entries/{entry['id']}", headers={HEADER: "1"},
                   json={"body_json": BLANK_PLUS_TYPED})
    assert r.status_code == 200, r.text
    assert json.loads(_stored_entry_body(entry["id"])) == BLANK_PLUS_TYPED


def test_an_old_client_still_writes_an_old_playbook_entry_and_any_title(client):
    old = _entry(client, OLD_BODY)
    r = client.put(f"/api/upb/entries/{old['id']}", json={"body_json": BLANK_PLUS_TYPED})
    assert r.status_code == 200, r.text
    new = _entry(client, WAVE5_BODY)
    r = client.put(f"/api/upb/entries/{new['id']}", json={"title": "renamed"})
    assert r.status_code == 200, r.text
