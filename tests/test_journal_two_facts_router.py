"""Router-level tests for Wave F's fact-observation endpoints. Same
standalone-FastAPI-app + temp-auth.db pattern as
test_journal_two_properties_router.py."""
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


@pytest.fixture(autouse=True)
def _no_real_entity_master(monkeypatch):
    from api.services.entity_master import api as entity_master
    monkeypatch.setattr(
        entity_master, "resolve",
        lambda alias, as_of=None, **kw: entity_master.ResolveResult(status="not_found"),
    )


@pytest.fixture(autouse=True)
def _no_real_current_value_provider(monkeypatch):
    from api.services.journal_two import fact_current_value
    monkeypatch.setattr(fact_current_value, "_resolve_price", lambda tickers: {t: 999.99 for t in tickers})


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


def _create_note(client, title="A note"):
    r = client.post("/api/j2/notes", json={"title": title})
    assert r.status_code == 200
    return r.json()["note"]["id"]


def _attach_fact_node(client, note_id, fact_id):
    r = client.get(f"/api/j2/notes/{note_id}")
    body = r.json()["note"]["bodyJson"]
    body["content"] = list(body.get("content") or []) + [
        {"type": "financialFact", "attrs": {"factId": fact_id}}
    ]
    r = client.put(f"/api/j2/notes/{note_id}", json={"bodyJson": body})
    assert r.status_code == 200


def test_facts_require_auth(app, client):
    r = client.post("/api/j2/notes/some-note/facts", json={})
    assert r.status_code == 401
    r = client.get("/api/j2/notes/some-note/facts")
    assert r.status_code == 401


def test_create_and_resolve_a_price_fact(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)
    r = client.post(f"/api/j2/notes/{note_id}/facts", json={
        "ticker": "NVDA", "factType": "price", "value": 142.83,
    })
    assert r.status_code == 200
    fact = r.json()["fact"]
    assert fact["value"] == 142.83
    assert fact["ticker"] == "NVDA"

    _attach_fact_node(client, note_id, fact["id"])
    r = client.get(f"/api/j2/notes/{note_id}/facts")
    assert r.status_code == 200
    facts_out = r.json()["facts"]
    assert len(facts_out) == 1
    assert facts_out[0]["value"] == 142.83
    assert facts_out[0]["current"] == 999.99  # from the stubbed resolver


def test_creating_an_inactive_fact_type_400s(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)
    r = client.post(f"/api/j2/notes/{note_id}/facts", json={
        "ticker": "NVDA", "factType": "analyst_price_target_consensus", "value": 195.0,
    })
    assert r.status_code == 400


def test_idempotent_capture_via_router_returns_the_same_fact_id(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)
    r1 = client.post(f"/api/j2/notes/{note_id}/facts", json={
        "ticker": "NVDA", "factType": "price", "value": 142.83, "idempotencyKey": "intent-1",
    })
    r2 = client.post(f"/api/j2/notes/{note_id}/facts", json={
        "ticker": "NVDA", "factType": "price", "value": 999.0, "idempotencyKey": "intent-1",
    })
    assert r1.json()["fact"]["id"] == r2.json()["fact"]["id"]


def test_insert_endpoint_places_the_node_into_the_notes_body(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)
    fact = client.post(f"/api/j2/notes/{note_id}/facts", json={
        "ticker": "NVDA", "factType": "price", "value": 1.0,
    }).json()["fact"]
    r = client.post(f"/api/j2/notes/{note_id}/facts/{fact['id']}/insert")
    assert r.status_code == 200
    r2 = client.get(f"/api/j2/notes/{note_id}/facts")
    assert [f["id"] for f in r2.json()["facts"]] == [fact["id"]]


def test_insert_endpoint_404s_for_a_foreign_note(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)
    fact = client.post(f"/api/j2/notes/{note_id}/facts", json={
        "ticker": "NVDA", "factType": "price", "value": 1.0,
    }).json()["fact"]

    _login_as(app, "u2")
    r = client.post(f"/api/j2/notes/{note_id}/facts/{fact['id']}/insert")
    assert r.status_code == 404


def test_update_caption(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)
    fact = client.post(f"/api/j2/notes/{note_id}/facts", json={
        "ticker": "NVDA", "factType": "price", "value": 1.0,
    }).json()["fact"]
    r = client.put(f"/api/j2/facts/{fact['id']}", json={"caption": "revised"})
    assert r.status_code == 200
    assert r.json()["fact"]["caption"] == "revised"


def test_delete_fact(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)
    fact = client.post(f"/api/j2/notes/{note_id}/facts", json={
        "ticker": "NVDA", "factType": "price", "value": 1.0,
    }).json()["fact"]
    r = client.delete(f"/api/j2/facts/{fact['id']}")
    assert r.status_code == 200
    r = client.put(f"/api/j2/facts/{fact['id']}", json={"caption": "x"})
    assert r.status_code == 404


# ── Tenant isolation ─────────────────────────────────────────────────────────

def test_cannot_delete_another_users_fact_via_router(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)
    fact = client.post(f"/api/j2/notes/{note_id}/facts", json={
        "ticker": "NVDA", "factType": "price", "value": 1.0,
    }).json()["fact"]

    _login_as(app, "u2")
    r = client.delete(f"/api/j2/facts/{fact['id']}")
    assert r.status_code == 404

    _login_as(app, "u1")
    r = client.put(f"/api/j2/facts/{fact['id']}", json={"caption": "still mine"})
    assert r.status_code == 200


def test_cannot_read_another_users_notes_facts_via_router(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)
    fact = client.post(f"/api/j2/notes/{note_id}/facts", json={
        "ticker": "NVDA", "factType": "price", "value": 1.0,
    }).json()["fact"]
    _attach_fact_node(client, note_id, fact["id"])

    _login_as(app, "u2")
    # A foreign note id resolves to nothing for this user's own facts list --
    # the JOIN in list_note_facts is scoped by user_id on BOTH sides.
    r = client.get(f"/api/j2/notes/{note_id}/facts")
    assert r.status_code == 200
    assert r.json()["facts"] == []
