"""⛔⛔ A NOTE ALREADY STORED TOO DEEP OPENS — 200 with its metadata, the body
withheld — never a 500. Wave 10, lane 10D (the read side of 10C concern 4).

H14 hotfix #203 (`notes.MAX_BODY_DEPTH`) refuses a too-deep body on every WRITE
door. A note stored deeper than that BEFORE the cap still answered 500 on every
read, because FastAPI's response serialiser refuses a payload nested past its own
ceiling (docs/notebook/evidence/wave10-10c/deep-nesting-probe-output.txt): the
member could never open it again. The router now serves such a note through
`_servable_note`.

Every case below SEEDS the deep body straight into the sandbox DB — bypassing the
write guard, exactly as a pre-cap note sits in production — and reads it through
the REAL router:
  * GET answers 200, metadata intact, `bodyWithheld.reason` in the client's own
    vocabulary, and the stored row untouched;
  * a normal note's GET is BYTE-identical to the plain serialisation;
  * a metadata-only PUT on the deep note answers 200 (it 500'd after writing);
  * the placeholder echoed back through PUT is refused — never written over it;
  * a deep VERSION reads 200 withheld, and restoring it is a 400, not a 500;
  * the placeholder LOCKS the editor rather than blanking it: the server's own
    mirror of ProseMirror cannot build it, and the fixture the client rail reads
    is the same object (app/.../lib/__fixtures__/withheldNoteBody.json).
"""
from __future__ import annotations

import importlib
import json
import os
import pathlib
import re
import tempfile
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services.journal_two import notes as svc

ROOT = pathlib.Path(__file__).resolve().parents[1]
GUARD_JS = ROOT / "app/src/pages/journal-2-0/lib/noteContentGuard.js"
FIXTURE = ROOT / "app/src/pages/journal-2-0/lib/__fixtures__/withheldNoteBody.json"
UID = "u-readside"


def bullets(levels: int, leaf: str = "deepest words") -> dict:
    node = {"type": "paragraph", "content": [{"type": "text", "text": leaf}]}
    for _ in range(levels):
        node = {"type": "bulletList", "content": [{"type": "listItem", "content": [node]}]}
    return {"type": "doc", "content": [node]}


@pytest.fixture
def env(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    from api.routers import journal_two as router_mod
    fa = FastAPI()
    fa.include_router(router_mod.router)

    # The "before" door for the byte-identity rail: the same return annotation,
    # the same serialiser, and NO read-side handling.
    @fa.get("/_plain/{note_id}")
    def _plain(note_id: str) -> dict:
        return {"note": svc.get_note(UID, note_id)}

    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": UID, "role": "member"}
    yield TestClient(fa, raise_server_exceptions=False), router_mod
    fa.dependency_overrides.clear()
    os.unlink(tmp.name)


def _seed_deep(title="deep outline", levels=30) -> tuple[dict, str]:
    """A note created shallow through the service, then given a too-deep body BY
    SQL — past the write guard, as a note stored before the cap."""
    note = svc.create_note(UID, {"title": title, "bodyJson": bullets(2), "tags": ["keep"]})
    deep = json.dumps(bullets(levels))
    conn = svc.get_connection()
    try:
        conn.execute("UPDATE j2_notes SET body_json = ? WHERE id = ?", (deep, note["id"]))
        conn.commit()
    finally:
        conn.close()
    return svc.get_note(UID, note["id"]), deep


def _stored_body(note_id: str) -> str:
    conn = svc.get_connection()
    try:
        return conn.execute("SELECT body_json FROM j2_notes WHERE id = ?", (note_id,)).fetchone()[0]
    finally:
        conn.close()


def test_the_seed_really_is_past_the_cap_and_past_the_serialiser():
    # Non-vacuity: the body this file seeds is one the write guard would refuse.
    assert svc._json_depth_exceeds(bullets(30), svc.MAX_BODY_DEPTH)
    assert not svc._json_depth_exceeds(bullets(20), svc.MAX_BODY_DEPTH)


def test_a_deep_stored_note_opens_200_with_metadata_and_the_marker(env):
    client, r = env
    note, deep = _seed_deep()
    g = client.get(f"/api/j2/notes/{note['id']}")
    assert g.status_code == 200, g.text[:300]
    got = g.json()["note"]
    assert got["id"] == note["id"] and got["title"] == "deep outline"
    assert got["updatedAt"] == note["updatedAt"] and got["tags"] == ["keep"]
    assert got["bodyWithheld"] == {"reason": "malformed", "detail": svc.TOO_DEEP_BODY_DETAIL}
    assert got["bodyJson"] == r._WITHHELD_BODY_JSON
    # The depth sentence is IN the placeholder, for any reader that renders it.
    assert got["bodyJson"]["content"][0]["content"][0]["text"] == svc.TOO_DEEP_BODY_DETAIL
    # ⛔ Withheld, not changed: the stored row is exactly what was seeded.
    assert _stored_body(note["id"]) == deep


def test_a_normal_note_is_byte_identical_to_the_plain_serialisation(env):
    client, _ = env
    note = svc.create_note(UID, {"title": "ordinary", "bodyJson": bullets(20, "outline leaf")})
    served = client.get(f"/api/j2/notes/{note['id']}")
    plain = client.get(f"/_plain/{note['id']}")
    assert served.status_code == plain.status_code == 200
    assert served.content == plain.content
    assert "bodyWithheld" not in served.json()["note"]


def test_a_metadata_PUT_on_a_deep_note_answers_200_and_leaves_the_body(env):
    """It used to write the title and THEN 500 on the response."""
    client, _ = env
    note, deep = _seed_deep("rename me")
    p = client.put(f"/api/j2/notes/{note['id']}",
                   json={"title": "renamed", "baseUpdatedAt": note["updatedAt"]})
    assert p.status_code == 200, p.text[:300]
    assert p.json()["note"]["title"] == "renamed"
    assert p.json()["note"]["bodyWithheld"]["reason"] == "malformed"
    assert _stored_body(note["id"]) == deep


def test_the_placeholder_echoed_back_is_refused_and_the_stored_body_is_untouched(env):
    client, r = env
    note, deep = _seed_deep("echo")
    for body in (r._WITHHELD_BODY_JSON, json.dumps(r._WITHHELD_BODY_JSON)):
        p = client.put(f"/api/j2/notes/{note['id']}",
                       json={"bodyJson": body, "baseUpdatedAt": note["updatedAt"]})
        assert p.status_code == 400 and p.json()["detail"] == svc.TOO_DEEP_BODY_DETAIL
    assert _stored_body(note["id"]) == deep
    # CONTROL: an ordinary body replacing the deep note is still the member's call.
    ok = client.put(f"/api/j2/notes/{note['id']}",
                    json={"bodyJson": bullets(2, "fresh start"), "baseUpdatedAt": note["updatedAt"]})
    assert ok.status_code == 200, ok.text[:300]


def test_a_deep_version_reads_withheld_and_restoring_it_is_a_400_not_a_500(env):
    client, _ = env
    note = svc.create_note(UID, {"title": "has history", "bodyJson": bullets(2)})
    vid = str(uuid.uuid4())
    conn = svc.get_connection()
    try:
        conn.execute(
            "INSERT INTO j2_note_versions (id, user_id, note_id, title, subtitle, body_json,"
            " body_plain, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (vid, UID, note["id"], "old", None, json.dumps(bullets(30)), "deepest words",
             "2026-09-01T00:00:00+00:00"))
        conn.commit()
    finally:
        conn.close()
    v = client.get(f"/api/j2/notes/{note['id']}/versions/{vid}")
    assert v.status_code == 200, v.text[:300]
    assert v.json()["version"]["bodyWithheld"]["reason"] == "malformed"
    rs = client.post(f"/api/j2/notes/{note['id']}/versions/{vid}/restore",
                     json={"baseUpdatedAt": note["updatedAt"]})
    assert rs.status_code == 400 and rs.json()["detail"] == svc.TOO_DEEP_BODY_DETAIL
    assert svc.get_note(UID, note["id"])["updatedAt"] == note["updatedAt"]


def test_the_marker_is_the_clients_own_unreadable_word(env):
    """ONE vocabulary: `bodyWithheld.reason` is noteContentGuard.js's
    UNREADABLE_MALFORMED, READ from the client source — never retyped."""
    _, r = env
    src = GUARD_JS.read_text(encoding="utf-8")
    m = re.search(r"export const UNREADABLE_MALFORMED = '([a-z]+)'", src)
    assert m, "could not read UNREADABLE_MALFORMED from noteContentGuard.js"
    assert r.BODY_WITHHELD_REASON == m.group(1)


def test_the_placeholder_locks_rather_than_blanks(env):
    """The server's mirror of ProseMirror's own throws cannot build it — so the
    editor's content guard locks it read-only instead of showing an empty doc an
    autosave would write over the stored note. And every node TYPE in it is
    known, which is what makes the client's reason 'malformed', not 'newer'."""
    _, r = env
    assert svc._body_build_problem(r._WITHHELD_BODY_JSON) is not None
    types = set(re.findall(r'"type": "([a-zA-Z]+)"', json.dumps(r._WITHHELD_BODY_JSON)))
    assert types == {"doc", "paragraph", "text"}


def test_the_client_fixture_is_the_server_placeholder(env):
    """The vitest rail (lib/withheldNoteBody.test.js) proves the REAL editor
    schema cannot build this fixture and names it 'malformed'; this pins that
    the fixture is the object the server sends."""
    _, r = env
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == r._WITHHELD_BODY_JSON
