"""Router-level tests for Wave E's property-def / note-property / saved-view
endpoints. Same standalone-FastAPI-app + temp-auth.db pattern as
test_journal_two_note_links_router.py.
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
    r = client.post("/api/j2/notes", json={"title": title, **extra})
    assert r.status_code == 200
    return r.json()["note"]["id"]


# ── Property defs ────────────────────────────────────────────────────────────

def test_list_property_defs_includes_builtins_with_no_auth_free_ride(app, client):
    r = client.get("/api/j2/property-defs")
    assert r.status_code == 401  # never reachable unauthenticated
    _login_as(app, "u1")
    r = client.get("/api/j2/property-defs")
    assert r.status_code == 200
    ids = {d["id"] for d in r.json()["propertyDefs"]}
    assert "builtin:thesis_status" in ids


def test_create_property_def_end_to_end(app, client):
    _login_as(app, "u1")
    r = client.post("/api/j2/property-defs", json={
        "name": "Risk Level", "type": "select",
        "options": [{"label": "Low"}, {"label": "High"}],
    })
    assert r.status_code == 200
    d = r.json()["propertyDef"]
    assert d["name"] == "Risk Level"
    assert len(d["options"]) == 2


def test_create_property_def_rejects_bad_type(app, client):
    _login_as(app, "u1")
    r = client.post("/api/j2/property-defs", json={"name": "X", "type": "not_a_type"})
    assert r.status_code == 400


def test_rename_property_def_end_to_end(app, client):
    _login_as(app, "u1")
    d = client.post("/api/j2/property-defs", json={"name": "Old", "type": "text"}).json()["propertyDef"]
    r = client.put(f"/api/j2/property-defs/{d['id']}", json={"name": "New"})
    assert r.status_code == 200
    assert r.json()["propertyDef"]["name"] == "New"


def test_delete_property_def_end_to_end(app, client):
    _login_as(app, "u1")
    d = client.post("/api/j2/property-defs", json={"name": "X", "type": "text"}).json()["propertyDef"]
    r = client.delete(f"/api/j2/property-defs/{d['id']}")
    assert r.status_code == 200
    r2 = client.get("/api/j2/property-defs")
    assert d["id"] not in {x["id"] for x in r2.json()["propertyDefs"]}


def test_delete_a_nonexistent_property_def_404s(app, client):
    _login_as(app, "u1")
    r = client.delete("/api/j2/property-defs/does-not-exist")
    assert r.status_code == 404


def test_builtin_property_def_cannot_be_renamed_or_deleted_via_router(app, client):
    _login_as(app, "u1")
    r = client.put("/api/j2/property-defs/builtin:thesis_status", json={"name": "Renamed"})
    assert r.status_code == 400
    r2 = client.delete("/api/j2/property-defs/builtin:thesis_status")
    assert r2.status_code == 400


def test_property_defs_never_leak_across_tenants(app, client):
    _login_as(app, "u1")
    client.post("/api/j2/property-defs", json={"name": "Mine", "type": "text"})
    _login_as(app, "u2")
    r = client.get("/api/j2/property-defs")
    names = {d["name"] for d in r.json()["propertyDefs"]}
    assert "Mine" not in names


# ── Note properties (set via PUT /notes/{id}, read via GET .../properties) ──

def test_setting_and_reading_back_a_note_property(app, client):
    _login_as(app, "u1")
    d = client.post("/api/j2/property-defs", json={"name": "Confidence", "type": "text"}).json()["propertyDef"]
    note_id = _create_note(client)
    r = client.put(f"/api/j2/notes/{note_id}", json={"properties": {d["id"]: "High"}})
    assert r.status_code == 200

    resolved = client.get(f"/api/j2/notes/{note_id}/properties").json()["properties"]
    by_id = {p["id"]: p for p in resolved}
    assert by_id[d["id"]]["value"] == "High"


def test_setting_a_property_to_an_invalid_value_400s_never_saves(app, client):
    _login_as(app, "u1")
    d = client.post("/api/j2/property-defs", json={"name": "Size", "type": "number"}).json()["propertyDef"]
    note_id = _create_note(client)
    r = client.put(f"/api/j2/notes/{note_id}", json={"properties": {d["id"]: "not a number"}})
    assert r.status_code == 400
    resolved = client.get(f"/api/j2/notes/{note_id}/properties").json()["properties"]
    by_id = {p["id"]: p for p in resolved}
    assert by_id[d["id"]]["value"] is None  # never partially saved


def test_note_properties_endpoint_404s_for_a_foreign_notes_id(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)
    _login_as(app, "u2")
    r = client.get(f"/api/j2/notes/{note_id}/properties")
    assert r.status_code == 404


def test_financial_derived_ticker_property_reads_from_the_notes_own_field(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client, ticker="NVDA")
    resolved = client.get(f"/api/j2/notes/{note_id}/properties").json()["properties"]
    by_id = {p["id"]: p for p in resolved}
    assert by_id["builtin:ticker"]["value"] == "NVDA"


# ── Saved views ──────────────────────────────────────────────────────────────

def test_create_list_delete_a_saved_view(app, client):
    _login_as(app, "u1")
    r = client.post("/api/j2/saved-views", json={"name": "Active Theses", "viewType": "table", "spec": {}})
    assert r.status_code == 200
    v = r.json()["savedView"]
    assert v["name"] == "Active Theses"

    listed = client.get("/api/j2/saved-views").json()["savedViews"]
    assert any(x["id"] == v["id"] for x in listed)

    r2 = client.delete(f"/api/j2/saved-views/{v['id']}")
    assert r2.status_code == 200
    assert client.get("/api/j2/saved-views").json()["savedViews"] == []


def test_saved_views_never_leak_across_tenants(app, client):
    _login_as(app, "u1")
    v = client.post("/api/j2/saved-views", json={"name": "Mine", "viewType": "list", "spec": {}}).json()["savedView"]
    _login_as(app, "u2")
    listed = client.get("/api/j2/saved-views").json()["savedViews"]
    assert listed == []
    r = client.delete(f"/api/j2/saved-views/{v['id']}")
    assert r.status_code == 404  # can't delete another tenant's view


def test_list_notes_via_saved_view_id_ignores_client_supplied_property_filter(app, client):
    """directive §87: savedViewId must win over any ad-hoc propertyFilter
    sent in the same request -- the server resolves the view's OWN spec."""
    _login_as(app, "u1")
    d = client.post(
        "/api/j2/property-defs",
        json={"name": "Status", "type": "select", "options": [{"label": "Active"}, {"label": "Closed"}]},
    ).json()["propertyDef"]
    active_id, closed_id = d["options"][0]["id"], d["options"][1]["id"]
    active_note = _create_note(client, title="Active Note")
    closed_note = _create_note(client, title="Closed Note")
    client.put(f"/api/j2/notes/{active_note}", json={"properties": {d["id"]: active_id}})
    client.put(f"/api/j2/notes/{closed_note}", json={"properties": {d["id"]: closed_id}})

    view = client.post("/api/j2/saved-views", json={
        "name": "Active", "viewType": "list",
        "spec": {"propertyFilter": [{"propertyId": d["id"], "op": "eq", "value": active_id}]},
    }).json()["savedView"]

    # An attacker/stale-client-supplied propertyFilter alongside savedViewId
    # asking for the CLOSED note must be ignored -- the saved view's own
    # spec (Active) is what actually runs.
    import json as json_mod
    malicious_filter = json_mod.dumps([{"propertyId": d["id"], "op": "eq", "value": closed_id}])
    r = client.get(f"/api/j2/notes?savedViewId={view['id']}&propertyFilter={malicious_filter}")
    assert r.status_code == 200
    titles = {n["title"] for n in r.json()["notes"]}
    assert titles == {"Active Note"}


def test_list_notes_with_an_unknown_saved_view_id_404s(app, client):
    _login_as(app, "u1")
    r = client.get("/api/j2/notes?savedViewId=does-not-exist")
    assert r.status_code == 404


def test_list_notes_with_a_malformed_property_filter_json_400s(app, client):
    _login_as(app, "u1")
    r = client.get("/api/j2/notes?propertyFilter=not-json")
    assert r.status_code == 400
