"""Member templates — wave 6, lane E, item 3.

What these pin:
  * "Save as template" copies a note's TITLE, BODY and PROPERTIES into a new
    `j2_note_templates` row, read by the server from the member's own note (the
    client never supplies the body it claims to be copying);
  * templates are the MEMBER'S: listed, read, renamed and deleted only by their
    owner — another member's id is a 404, never a "forbidden" oracle;
  * the list is a summary (no bodies); one template is read in full;
  * a property the template carries that no longer exists (deleted since) is
    left OUT of the full read, so creating from the template never trips over
    it — the note is still made with everything that is still valid;
  * the template is a COPY: editing or trashing the note afterwards changes
    nothing in it;
  * names are trimmed, required, capped; the per-member count is capped.
"""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw


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
def app(db_path):
    from api.routers import journal_two as journal_two_router
    fa = FastAPI()
    fa.include_router(journal_two_router.router)
    yield fa
    fa.dependency_overrides.clear()


@pytest.fixture
def client(app):
    return TestClient(app)


def _login_as(app, user_id):
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": user_id, "role": "member"}


def _doc(text):
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}


def _note(client, title="Weekly review", text="What worked", **extra):
    r = client.post("/api/j2/notes", json={"title": title, "bodyJson": _doc(text), **extra})
    assert r.status_code == 200, r.text
    return r.json()["note"]


def _save(client, note_id, name=None):
    payload = {"noteId": note_id}
    if name is not None:
        payload["name"] = name
    return client.post("/api/j2/note-templates", json=payload)


def test_save_as_template_copies_title_body_and_properties(app, client):
    _login_as(app, "u1")
    n = _note(client)
    r = client.put(f"/api/j2/notes/{n['id']}", json={"properties": {"builtin:thesis_status": "active"}})
    assert r.status_code == 200, r.text
    r = _save(client, n["id"], "  My weekly  ")
    assert r.status_code == 200, r.text
    t = r.json()["template"]
    assert t["name"] == "My weekly"
    full = client.get(f"/api/j2/note-templates/{t['id']}").json()["template"]
    assert full["title"] == "Weekly review"
    assert full["bodyJson"] == _doc("What worked")
    assert full["properties"] == {"builtin:thesis_status": "active"}


def test_the_name_defaults_to_the_note_title(app, client):
    _login_as(app, "u1")
    n = _note(client, title="Earnings prep")
    assert _save(client, n["id"]).json()["template"]["name"] == "Earnings prep"
    blank = _note(client, title="")
    assert _save(client, blank["id"]).json()["template"]["name"] == "Untitled template"


def test_the_list_is_a_summary_newest_first(app, client):
    _login_as(app, "u1")
    a = _save(client, _note(client, title="A")["id"]).json()["template"]
    b = _save(client, _note(client, title="B")["id"]).json()["template"]
    rows = client.get("/api/j2/note-templates").json()["templates"]
    assert [r["id"] for r in rows] == [b["id"], a["id"]]
    assert all("bodyJson" not in r for r in rows), "the list never ships bodies"


def test_the_template_is_a_copy_not_a_link(app, client):
    _login_as(app, "u1")
    n = _note(client, text="original")
    t = _save(client, n["id"], "T").json()["template"]
    client.put(f"/api/j2/notes/{n['id']}", json={"bodyJson": _doc("edited later")})
    client.delete(f"/api/j2/notes/{n['id']}")
    full = client.get(f"/api/j2/note-templates/{t['id']}").json()["template"]
    assert full["bodyJson"] == _doc("original")


def test_rename_and_delete(app, client):
    _login_as(app, "u1")
    t = _save(client, _note(client)["id"], "Old").json()["template"]
    r = client.patch(f"/api/j2/note-templates/{t['id']}", json={"name": " New name "})
    assert r.status_code == 200, r.text
    assert r.json()["template"]["name"] == "New name"
    assert client.patch(f"/api/j2/note-templates/{t['id']}", json={"name": "   "}).status_code == 400
    assert client.patch(f"/api/j2/note-templates/{t['id']}", json={"name": "x" * 81}).status_code == 400
    assert client.delete(f"/api/j2/note-templates/{t['id']}").status_code == 200
    assert client.get(f"/api/j2/note-templates/{t['id']}").status_code == 404
    assert client.get("/api/j2/note-templates").json()["templates"] == []


def test_templates_belong_to_their_member(app, client):
    _login_as(app, "u1")
    n = _note(client)
    t = _save(client, n["id"], "Mine").json()["template"]
    _login_as(app, "u2")
    assert client.get("/api/j2/note-templates").json()["templates"] == []
    assert client.get(f"/api/j2/note-templates/{t['id']}").status_code == 404
    assert client.patch(f"/api/j2/note-templates/{t['id']}", json={"name": "Hijack"}).status_code == 404
    assert client.delete(f"/api/j2/note-templates/{t['id']}").status_code == 404
    # …and u2 cannot template u1's NOTE either.
    assert _save(client, n["id"], "Theirs").status_code == 404
    _login_as(app, "u1")
    assert client.get(f"/api/j2/note-templates/{t['id']}").json()["template"]["name"] == "Mine"


def test_a_trashed_or_missing_note_cannot_be_saved(app, client):
    _login_as(app, "u1")
    n = _note(client)
    client.delete(f"/api/j2/notes/{n['id']}")
    assert _save(client, n["id"]).status_code == 404
    assert _save(client, "nope").status_code == 404
    assert client.post("/api/j2/note-templates", json={}).status_code == 400


def test_a_property_deleted_since_is_left_out_of_the_read(app, client):
    _login_as(app, "u1")
    r = client.post("/api/j2/property-defs", json={"name": "Setup", "type": "text"})
    assert r.status_code == 200, r.text
    prop_id = r.json()["propertyDef"]["id"]
    n = _note(client)
    client.put(f"/api/j2/notes/{n['id']}", json={"properties": {prop_id: "Breakout", "builtin:confidence": "high"}})
    t = _save(client, n["id"], "T").json()["template"]
    assert client.get(f"/api/j2/note-templates/{t['id']}").json()["template"]["properties"] == {
        prop_id: "Breakout", "builtin:confidence": "high"}
    assert client.delete(f"/api/j2/property-defs/{prop_id}").status_code == 200
    props = client.get(f"/api/j2/note-templates/{t['id']}").json()["template"]["properties"]
    assert props == {"builtin:confidence": "high"}
    # …so the create-from-template write the client makes goes through.
    fresh = client.post("/api/j2/notes", json={"title": "From T"}).json()["note"]
    assert client.put(f"/api/j2/notes/{fresh['id']}", json={"properties": props}).status_code == 200


def test_the_name_is_required_on_save_when_blank_is_sent(app, client):
    _login_as(app, "u1")
    n = _note(client)
    assert _save(client, n["id"], "   ").status_code == 400
    assert _save(client, n["id"], "y" * 81).status_code == 400


def test_the_per_member_count_is_capped(app, client, monkeypatch):
    from api.services.journal_two import note_templates
    monkeypatch.setattr(note_templates, "MAX_TEMPLATES_PER_MEMBER", 2)
    _login_as(app, "u1")
    n = _note(client)
    assert _save(client, n["id"], "1").status_code == 200
    assert _save(client, n["id"], "2").status_code == 200
    r = _save(client, n["id"], "3")
    assert r.status_code == 400
    assert "2" in r.json()["detail"]
