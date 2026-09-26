"""The insights router's doors, and the mount order that makes one of them
reachable at all.

`GET /api/j2/notes/{note_id}` in journal_two.py would answer
`/api/j2/notes/tasks` as "the note whose id is 'tasks'" if it were mounted
first. The two orders are both built here so the requirement is demonstrated,
not asserted: the controller wiring api/main.py must include this router
BEFORE journal_two_router.
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
def db(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


def _app(*routers):
    fa = FastAPI()
    for r in routers:
        fa.include_router(r)
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u1", "role": "member"}
    return fa


def _seed_task():
    from api.services.journal_two import notes as ns
    body = {"type": "doc", "content": [{"type": "taskList", "content": [
        {"type": "taskItem", "attrs": {"checked": False},
         "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Size the add"}]}]}]}]}
    return ns.create_note("u1", {"title": "Plan", "bodyJson": body})["id"]


def test_mounted_BEFORE_journal_two_the_tasks_door_answers(db):
    from api.routers import journal_two, notebook_insights
    _seed_task()
    r = TestClient(_app(notebook_insights.router, journal_two.router)).get("/api/j2/notes/tasks")
    assert r.status_code == 200
    assert [t["text"] for t in r.json()["tasks"]] == ["Size the add"]


def test_mounted_AFTER_journal_two_the_tasks_door_is_shadowed(db):
    """CONTROL — this is the failure the mount order prevents. If this ever
    starts answering 200, the shadowing route was removed and the ordering
    requirement in the docstring can be relaxed; until then it stands."""
    from api.routers import journal_two, notebook_insights
    _seed_task()
    r = TestClient(_app(journal_two.router, notebook_insights.router)).get("/api/j2/notes/tasks")
    assert r.status_code != 200 or "tasks" not in r.json()


def test_the_tasks_door_validates_its_filters(db):
    from api.routers import notebook_insights
    client = TestClient(_app(notebook_insights.router))
    assert client.get("/api/j2/notes/tasks?status=nope").status_code == 400
    assert client.get("/api/j2/notes/tasks?due=someday").status_code == 400
    ok = client.get("/api/j2/notes/tasks?status=all&due=none")
    assert ok.status_code == 200 and set(ok.json()) >= {"today", "tasks", "count", "truncated"}


def test_the_unlinked_mentions_door(db):
    from api.routers import notebook_insights
    from api.services.journal_two import notes as ns
    target = ns.create_note("u1", {"title": "Flat base"})["id"]
    doc = {"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "text", "text": "A tight flat base under the highs."}]}]}
    other = ns.create_note("u1", {"title": "Log", "bodyJson": doc})["id"]
    body = TestClient(_app(notebook_insights.router)).get(
        f"/api/j2/notes/{target}/unlinked-mentions").json()
    assert [n["id"] for n in body["notes"]] == [other]
    assert body["notes"][0]["snippet"]["match"] == "flat base"


def test_both_doors_require_a_session(db):
    from api.routers import notebook_insights
    fa = FastAPI()
    fa.include_router(notebook_insights.router)
    client = TestClient(fa)
    assert client.get("/api/j2/notes/tasks").status_code == 401
    assert client.get("/api/j2/notes/x/unlinked-mentions").status_code == 401
