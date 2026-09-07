"""Router-level tests for Wave G's evidence + thesis-summary endpoints. Same
standalone-FastAPI-app + temp-auth.db pattern as
test_journal_two_facts_router.py."""
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


def test_evidence_endpoints_require_auth(app, client):
    r = client.post("/api/j2/notes/some-note/evidence", json={})
    assert r.status_code == 401
    r = client.get("/api/j2/notes/some-note/evidence")
    assert r.status_code == 401
    r = client.get("/api/j2/notes/some-note/thesis-summary")
    assert r.status_code == 401


def test_add_and_list_evidence(app, client):
    _login_as(app, "u1")
    thesis_id = _create_note(client, "NVDA thesis")
    source_id = _create_note(client, "Supporting research")

    r = client.post(f"/api/j2/notes/{thesis_id}/evidence", json={
        "targetType": "note", "targetId": source_id, "stance": "supports", "caption": "datacenter tailwind",
    })
    assert r.status_code == 200
    evidence = r.json()["evidence"]
    assert evidence["stance"] == "supports"

    r = client.get(f"/api/j2/notes/{thesis_id}/evidence")
    assert r.status_code == 200
    assert len(r.json()["evidence"]) == 1


def test_add_evidence_with_unknown_stance_400s(app, client):
    _login_as(app, "u1")
    thesis_id = _create_note(client)
    source_id = _create_note(client)
    r = client.post(f"/api/j2/notes/{thesis_id}/evidence", json={
        "targetType": "note", "targetId": source_id, "stance": "neutral",
    })
    assert r.status_code == 400


def test_add_evidence_against_foreign_target_400s(app, client):
    _login_as(app, "u1")
    thesis_id = _create_note(client)
    _login_as(app, "u2")
    foreign_id = _create_note(client)

    _login_as(app, "u1")
    r = client.post(f"/api/j2/notes/{thesis_id}/evidence", json={
        "targetType": "note", "targetId": foreign_id, "stance": "supports",
    })
    assert r.status_code == 400


def test_remove_evidence(app, client):
    _login_as(app, "u1")
    thesis_id = _create_note(client)
    source_id = _create_note(client)
    evidence = client.post(f"/api/j2/notes/{thesis_id}/evidence", json={
        "targetType": "note", "targetId": source_id, "stance": "opposes",
    }).json()["evidence"]

    r = client.delete(f"/api/j2/evidence/{evidence['id']}")
    assert r.status_code == 200
    assert client.get(f"/api/j2/notes/{thesis_id}/evidence").json()["evidence"] == []


def test_cannot_remove_another_users_evidence_via_router(app, client):
    _login_as(app, "u1")
    thesis_id = _create_note(client)
    source_id = _create_note(client)
    evidence = client.post(f"/api/j2/notes/{thesis_id}/evidence", json={
        "targetType": "note", "targetId": source_id, "stance": "supports",
    }).json()["evidence"]

    _login_as(app, "u2")
    r = client.delete(f"/api/j2/evidence/{evidence['id']}")
    assert r.status_code == 404


def test_thesis_summary_bundles_evidence_and_changelog(app, client):
    _login_as(app, "u1")
    thesis_id = _create_note(client, "NVDA thesis")
    source_id = _create_note(client, "Supporting research")
    client.post(f"/api/j2/notes/{thesis_id}/evidence", json={
        "targetType": "note", "targetId": source_id, "stance": "supports",
    })

    r = client.get(f"/api/j2/notes/{thesis_id}/thesis-summary")
    assert r.status_code == 200
    body = r.json()
    assert len(body["evidence"]) == 1
    assert any(e["type"] == "evidence_added" for e in body["changelog"])


def test_thesis_summary_404s_for_a_nonexistent_note(app, client):
    _login_as(app, "u1")
    r = client.get("/api/j2/notes/not-a-real-note/thesis-summary")
    assert r.status_code == 404


def test_thesis_summary_is_tenant_scoped(app, client):
    _login_as(app, "u1")
    thesis_id = _create_note(client)
    _login_as(app, "u2")
    r = client.get(f"/api/j2/notes/{thesis_id}/thesis-summary")
    assert r.status_code == 404
