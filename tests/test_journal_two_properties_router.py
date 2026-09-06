"""Router-level tests for Wave E's property-definition / per-note-property-
value / saved-view endpoints. Same standalone-FastAPI-app + temp-auth.db
pattern as test_journal_two_note_links_router.py.
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


def _create_note(client, title="A note", **extra):
    payload = {"title": title, **extra}
    r = client.post("/api/j2/notes", json=payload)
    assert r.status_code == 200
    return r.json()["note"]["id"]


# ── Route order ──────────────────────────────────────────────────────────────

def test_property_and_saved_view_routes_registered_before_dynamic_note_detail(app):
    from api.routers.journal_two import router
    paths = [rt.path for rt in router.routes]
    idx_note_detail = paths.index("/api/j2/notes/{note_id}")
    for fixed in ("/api/j2/notes/properties", "/api/j2/notes/saved-views"):
        assert fixed in paths
        assert paths.index(fixed) < idx_note_detail


# ── Property defs CRUD ───────────────────────────────────────────────────────

def test_create_list_property_def(app, client):
    _login_as(app, "u1")
    r = client.post("/api/j2/notes/properties", json={"name": "Thesis Status", "type": "select",
                                                        "options": [{"label": "Active"}]})
    assert r.status_code == 200
    prop = r.json()["property"]
    assert prop["name"] == "Thesis Status"

    r = client.get("/api/j2/notes/properties")
    names = [p["name"] for p in r.json()["properties"]]
    assert "Thesis Status" in names
    assert "Sector" in names  # derived built-in always present


def test_create_property_def_rejects_unknown_type(app, client):
    _login_as(app, "u1")
    r = client.post("/api/j2/notes/properties", json={"name": "X", "type": "formula"})
    assert r.status_code == 400


def test_update_property_def_rename(app, client):
    _login_as(app, "u1")
    prop = client.post("/api/j2/notes/properties", json={"name": "Old", "type": "text"}).json()["property"]
    r = client.put(f"/api/j2/notes/properties/{prop['id']}", json={"name": "New"})
    assert r.status_code == 200
    assert r.json()["property"]["name"] == "New"


def test_update_property_def_404_for_unknown_id(app, client):
    _login_as(app, "u1")
    r = client.put("/api/j2/notes/properties/ghost", json={"name": "New"})
    assert r.status_code == 404


def test_property_defs_are_tenant_isolated(app, client):
    _login_as(app, "u1")
    prop = client.post("/api/j2/notes/properties", json={"name": "Mine", "type": "text"}).json()["property"]

    _login_as(app, "u2")
    r = client.put(f"/api/j2/notes/properties/{prop['id']}", json={"name": "Hijacked"})
    assert r.status_code == 404
    r = client.delete(f"/api/j2/notes/properties/{prop['id']}")
    assert r.status_code == 404


def test_delete_property_def(app, client):
    _login_as(app, "u1")
    prop = client.post("/api/j2/notes/properties", json={"name": "Temp", "type": "text"}).json()["property"]
    r = client.delete(f"/api/j2/notes/properties/{prop['id']}")
    assert r.status_code == 200
    names = [p["name"] for p in client.get("/api/j2/notes/properties").json()["properties"]]
    assert "Temp" not in names


# ── Per-note property values ─────────────────────────────────────────────────

def test_set_and_get_note_property_value(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)
    prop = client.post("/api/j2/notes/properties", json={"name": "Confidence", "type": "text"}).json()["property"]
    r = client.put(f"/api/j2/notes/{note_id}/properties/{prop['id']}", json={"value": "High"})
    assert r.status_code == 200
    props = r.json()["properties"]
    assert props[0]["value"] == "High"

    r2 = client.get(f"/api/j2/notes/{note_id}/properties")
    assert r2.json()["properties"][0]["value"] == "High"


def test_set_note_property_value_404_for_unknown_note(app, client):
    _login_as(app, "u1")
    prop = client.post("/api/j2/notes/properties", json={"name": "X", "type": "text"}).json()["property"]
    r = client.put(f"/api/j2/notes/does-not-exist/properties/{prop['id']}", json={"value": "hi"})
    assert r.status_code == 404


def test_set_note_property_value_rejects_invalid_type(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)
    prop = client.post("/api/j2/notes/properties", json={"name": "Score", "type": "number"}).json()["property"]
    r = client.put(f"/api/j2/notes/{note_id}/properties/{prop['id']}", json={"value": "not a number"})
    assert r.status_code == 400


def test_note_properties_are_tenant_isolated(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)
    prop = client.post("/api/j2/notes/properties", json={"name": "X", "type": "text"}).json()["property"]
    client.put(f"/api/j2/notes/{note_id}/properties/{prop['id']}", json={"value": "secret"})

    _login_as(app, "u2")
    r = client.get(f"/api/j2/notes/{note_id}/properties")
    assert r.status_code == 404  # note itself isn't u2's


# ── Saved views CRUD ─────────────────────────────────────────────────────────

def test_create_list_saved_view(app, client):
    _login_as(app, "u1")
    r = client.post("/api/j2/notes/saved-views", json={"name": "Active Theses", "viewType": "list"})
    assert r.status_code == 200
    view = r.json()["view"]
    assert view["name"] == "Active Theses"

    r = client.get("/api/j2/notes/saved-views")
    assert [v["name"] for v in r.json()["views"]] == ["Active Theses"]


def test_create_saved_view_rejects_unknown_view_type(app, client):
    _login_as(app, "u1")
    r = client.post("/api/j2/notes/saved-views", json={"name": "X", "viewType": "board"})
    assert r.status_code == 400


def test_update_and_delete_saved_view(app, client):
    _login_as(app, "u1")
    view = client.post("/api/j2/notes/saved-views", json={"name": "Old"}).json()["view"]
    r = client.put(f"/api/j2/notes/saved-views/{view['id']}", json={"name": "New"})
    assert r.status_code == 200
    assert r.json()["view"]["name"] == "New"
    r = client.delete(f"/api/j2/notes/saved-views/{view['id']}")
    assert r.status_code == 200
    assert client.get("/api/j2/notes/saved-views").json()["views"] == []


def test_saved_views_are_tenant_isolated(app, client):
    _login_as(app, "u1")
    view = client.post("/api/j2/notes/saved-views", json={"name": "Mine"}).json()["view"]

    _login_as(app, "u2")
    assert client.put(f"/api/j2/notes/saved-views/{view['id']}", json={"name": "Hijacked"}).status_code == 404
    assert client.delete(f"/api/j2/notes/saved-views/{view['id']}").status_code == 404


# ── GET /notes composition with savedViewId / propertyFilter ─────────────────

def test_list_notes_with_saved_view_id_applies_the_servers_stored_filter(app, client):
    _login_as(app, "u1")
    prop = client.post("/api/j2/notes/properties", json={"name": "Status", "type": "select",
                                                           "options": [{"label": "Active"}, {"label": "Closed"}]}).json()["property"]
    active_id = prop["options"][0]["id"]
    a = _create_note(client, title="A")
    b = _create_note(client, title="B")
    client.put(f"/api/j2/notes/{a}/properties/{prop['id']}", json={"value": active_id})
    view = client.post("/api/j2/notes/saved-views", json={
        "name": "Active", "filter": [{"propertyDefId": prop["id"], "op": "eq", "value": active_id}],
    }).json()["view"]

    r = client.get(f"/api/j2/notes?savedViewId={view['id']}")
    assert r.status_code == 200
    ids = [n["id"] for n in r.json()["notes"]]
    assert ids == [a]


def test_list_notes_with_unknown_saved_view_id_404s(app, client):
    _login_as(app, "u1")
    r = client.get("/api/j2/notes?savedViewId=ghost")
    assert r.status_code == 404


def test_list_notes_with_ad_hoc_property_filter(app, client):
    _login_as(app, "u1")
    prop = client.post("/api/j2/notes/properties", json={"name": "Score", "type": "number"}).json()["property"]
    a = _create_note(client, title="A")
    b = _create_note(client, title="B")
    client.put(f"/api/j2/notes/{a}/properties/{prop['id']}", json={"value": 9})
    client.put(f"/api/j2/notes/{b}/properties/{prop['id']}", json={"value": 1})

    import json as _json
    filt = _json.dumps([{"propertyDefId": prop["id"], "op": "gte", "value": 5}])
    r = client.get(f"/api/j2/notes?propertyFilter={filt}")
    ids = [n["id"] for n in r.json()["notes"]]
    assert ids == [a]


def test_list_notes_with_malformed_property_filter_400s(app, client):
    _login_as(app, "u1")
    r = client.get("/api/j2/notes?propertyFilter=not-json")
    assert r.status_code == 400
