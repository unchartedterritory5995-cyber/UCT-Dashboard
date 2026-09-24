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
import shutil
import subprocess
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


def _client_facts(path: Path = CLIENT_TABLE) -> dict:
    """The client's half of the facts, read the way the BUNDLE reads them.

    ⛔⛔ S1 (wave 5 final review): this used to be a regex matching one
    `name: N` per line. Measured: `diagram: 2, chart3d: 2,` written on ONE line
    parsed as 41 entries — the same count as before — and neither name was seen.
    With the Python half forgotten too, client == server still held, and the
    server would have counted `diagram` as 0: H14 for the next wave, every rail
    green.

    ⭐ So the module is IMPORTED by Node and the frozen object serialised. Any
    layout of the table — two entries on a line, a spread of another frozen
    object, a quoted or computed key, a trailing comment — is read exactly as the
    product reads it; there is no shape rule left to drift from. A `key:` count
    beside the regex was the alternative, and it only guards the shapes someone
    thought of: a `...WAVE6_TYPES` spread is invisible to both.
    ⚠️ The cost, accepted: notebookSchema.js must stay importable by plain Node
    (no static imports — its own header says so), and `node` must be on PATH.
    """
    node = shutil.which("node")
    assert node, ("node is not on PATH — this rail reads the client table the way the "
                  "bundle does, and a rail that cannot run is not a gate")
    url = path.resolve().as_uri()
    js = (f"import({json.dumps(url)}).then((m) => process.stdout.write(JSON.stringify({{"
          "table: m.NOTEBOOK_TYPE_SCHEMA, refusal: m.SCHEMA_REFUSAL_DETAIL, "
          "header: m.NOTEBOOK_SCHEMA_HEADER})))")
    r = subprocess.run([node, "--input-type=module", "-e", js], capture_output=True, timeout=120)
    err = (r.stderr or b"").decode("utf-8", errors="replace")
    assert r.returncode == 0, f"node could not import {path}: {err[:2000]}"
    return json.loads((r.stdout or b"").decode("utf-8", errors="replace"))


def _client_table(path: Path = CLIENT_TABLE) -> dict[str, int]:
    table = _client_facts(path)["table"]
    assert isinstance(table, dict), f"NOTEBOOK_TYPE_SCHEMA did not come back as an object: {table!r}"
    return {k: int(v) for k, v in table.items()}


def test_the_server_and_client_schema_tables_CANNOT_drift():
    client = _client_table()
    # Non-vacuity: a read that found nothing would make equality trivially true
    # against an empty server map, and a partial read would hide a drift.
    assert len(client) >= 35, f"read a suspiciously small client table: {sorted(client)}"
    assert client.get("paragraph") == 0 and client.get("inlineMath") == 1
    assert client == nbs.NOTEBOOK_TYPE_SCHEMA, (
        f"client-only {sorted(set(client.items()) - set(nbs.NOTEBOOK_TYPE_SCHEMA.items()))} / "
        f"server-only {sorted(set(nbs.NOTEBOOK_TYPE_SCHEMA.items()) - set(client.items()))}"
    )


def test_the_client_table_is_read_WHATEVER_its_layout__two_entries_on_one_line(tmp_path):
    """⛔ S1's reproduction, kept as the rail: a copy of the real module with the
    next wave's types written two to a line. The reader must see both — and the
    parity rail must then SEE the drift, because the Python half was not updated."""
    src = CLIENT_TABLE.read_text(encoding="utf-8").replace("\r\n", "\n")
    marker = "  textColor: 1,\n})"
    assert src.count(marker) == 1, "the table no longer ends where this reproduction expects"
    copy = tmp_path / "notebookSchema.two-per-line.mjs"
    copy.write_text(src.replace(marker, "  textColor: 1,\n  diagram: 2, chart3d: 2,\n})"), encoding="utf-8")

    real = _client_table()
    mutated = _client_table(copy)
    assert len(mutated) == len(real) + 2, f"{len(real)} -> {len(mutated)}: an entry was dropped"
    assert mutated["diagram"] == 2 and mutated["chart3d"] == 2
    assert mutated != nbs.NOTEBOOK_TYPE_SCHEMA, "the drift is invisible to the parity rail"


# ⛔ N1: no copy of the level-1 NAMES lives here (the brief that produced this
# guard: "no copy of the list lives in the test"). What the table must look like
# is asserted from its own structure, so the next wave edits the table and the
# server map — never this test.
_SECTION = re.compile(r"^\s*//\s*──\s*(\d+)\s*:")
_ENTRY = re.compile(r"(?:^|[^\w$])([A-Za-z_$][\w$]*)\s*:\s*(\d+)")


def test_levels_are_contiguous_from_0_and_there_is_a_newer_level():
    levels = sorted(set(nbs.NOTEBOOK_TYPE_SCHEMA.values()))
    assert levels[0] == 0, "no level-0 types: production's schema is missing from the table"
    assert levels == list(range(levels[-1] + 1)), (
        f"levels {levels} skip one: a client declares 'every type at or below N', so a gap "
        "is a level no bundle can ever declare")
    assert levels[-1] >= 1, "non-vacuity: the table records at least one newer schema"


def test_every_entry_sits_under_a_section_comment_naming_its_level():
    """The table is organised in `// ── N: … ──` sections. An entry filed under
    the wrong section is a type given the wrong level by whoever reads the
    section. The walk is cross-checked against the Node-read table, so it cannot
    silently skip an entry it failed to recognise."""
    js = CLIENT_TABLE.read_text(encoding="utf-8").replace("\r\n", "\n")
    start = js.index("NOTEBOOK_TYPE_SCHEMA = Object.freeze({")
    end = js.index("\n})", start)
    section = None
    seen: dict[str, int] = {}
    for line in js[start:end].split("\n")[1:]:
        m = _SECTION.match(line)
        if m:
            section = int(m.group(1))
            continue
        code = line.split("//", 1)[0]
        for name, level in _ENTRY.findall(code):
            assert section is not None, f"{name} precedes every section comment"
            assert int(level) == section, f"{name}: {level} is filed under the level-{section} section"
            seen[name] = int(level)
    assert len(seen) >= 35, f"non-vacuity: the walk found only {sorted(seen)}"
    assert seen == _client_table(), "the section walk and the module disagree about what the table holds"


# ── N2: the refusal sentence is ONE fact in two files ────────────────────────

def test_the_refusal_sentence_and_the_header_name_are_the_same_on_both_sides():
    """The editor tells a schema refusal from a compare-and-set conflict by this
    sentence (`isSchemaRefusal`), and the locked editor shows it. A reworded
    server detail would switch the editor's refusal handling off in silence."""
    facts = _client_facts()
    assert len(nbs.REFUSAL_DETAIL) > 20, "non-vacuity"
    assert facts["refusal"] == nbs.REFUSAL_DETAIL
    assert facts["header"] == nbs.NOTEBOOK_SCHEMA_HEADER


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


def test_a_body_forwarded_at_level_0_is_refused_on_a_wave5_note(client):
    """⛔ B1's server contract. A client FORWARDING a body it never read — the
    outbox drain, the editor sending an old tab's queued words — declares the
    WRITER's level, which for every capture made before stamps is an explicit
    `0`. It must be refused exactly like a missing header, byte-identical."""
    note = _note(client, WAVE5_BODY)
    before = _stored_note_body(note["id"])
    r = client.put(f"/api/j2/notes/{note['id']}", headers={HEADER: "0"}, json={
        "bodyJson": BLANK_PLUS_TYPED, "baseUpdatedAt": note["updatedAt"]})
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == nbs.REFUSAL_DETAIL
    assert _stored_note_body(note["id"]) == before


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
