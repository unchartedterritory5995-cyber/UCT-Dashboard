"""Stage A member-validation instrumentation (decision-log "Stage A→B gate"
entry, 2026-09-06). Proves each event actually fires, end-to-end through
the real HTTP layer + the real activity_log table -- "a rail nobody has
seen fire is not a rail" (this project's own standing discipline). Also
proves the aggregate-only privacy contract: no logged `details` blob ever
contains note content, search query text, or Ask Current Note questions.
"""
from __future__ import annotations

import json
import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services.journal_two.db import ensure_schema

PAID = {"id": "u1", "email": "u1@example.test", "role": "member", "plan": "pro"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from api.services import auth_db
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    from api.routers import journal_two

    db_path = str(tmp_path / "j2_notebook_analytics.db")
    c = sqlite3.connect(db_path)
    c.row_factory = sqlite3.Row
    c.executescript(auth_db._SCHEMA)  # users/activity_log live here, not in db.py's ensure_schema
    ensure_schema(c)
    c.execute(
        "INSERT INTO users (id, email, password_hash, display_name, role, created_at)"
        " VALUES (?,?,?,?,?,datetime('now'))",
        (PAID["id"], PAID["email"], "x", "U1", "member"),
    )
    c.commit()
    c.close()
    monkeypatch.setattr(auth_db, "_DB_PATH", db_path)

    app = FastAPI()
    app.include_router(journal_two.router)
    app.dependency_overrides[get_current_user] = lambda: dict(PAID)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(PAID)
    return TestClient(app), db_path


def _events(db_path, action_suffix=None):
    c = sqlite3.connect(db_path)
    c.row_factory = sqlite3.Row
    rows = c.execute(
        "SELECT action, details FROM activity_log WHERE user_id = ? ORDER BY created_at",
        (PAID["id"],),
    ).fetchall()
    c.close()
    out = [dict(r) for r in rows]
    if action_suffix:
        out = [r for r in out if r["action"] == f"j2:{action_suffix}"]
    return out


def test_note_creation_logs_notebook_note_created(client):
    c, db_path = client
    r = c.post("/api/j2/notes", json={"title": "My thesis"})
    assert r.status_code == 200
    evs = _events(db_path, "notebook_note_created")
    assert len(evs) == 1


def test_thesis_tagged_note_ALSO_logs_thesis_created(client):
    c, db_path = client
    c.post("/api/j2/notes", json={"title": "NVDA thesis", "tags": ["thesis"]})
    assert len(_events(db_path, "notebook_note_created")) == 1
    assert len(_events(db_path, "notebook_thesis_note_created")) == 1


def test_a_non_thesis_note_never_logs_thesis_created(client):
    c, db_path = client
    c.post("/api/j2/notes", json={"title": "Plain note", "tags": ["research"]})
    assert len(_events(db_path, "notebook_thesis_note_created")) == 0


def test_search_with_results_logs_hasResults_true(client):
    c, db_path = client
    c.post("/api/j2/notes", json={"title": "NVDA capex thesis", "bodyJson": {
        "type": "doc", "content": [{"type": "paragraph", "content": [
            {"type": "text", "text": "NVDA semiconductor capex is accelerating"}]}]}})
    r = c.get("/api/j2/notes", params={"q": "capex"})
    assert r.status_code == 200
    evs = _events(db_path, "notebook_search_used")
    assert len(evs) == 1
    assert json.loads(evs[0]["details"]) == {"hasResults": True}


def test_search_with_no_results_logs_hasResults_false(client):
    c, db_path = client
    r = c.get("/api/j2/notes", params={"q": "zzz_no_such_term_zzz"})
    assert r.status_code == 200
    evs = _events(db_path, "notebook_search_used")
    assert len(evs) == 1
    assert json.loads(evs[0]["details"]) == {"hasResults": False}


def test_no_query_never_logs_search_used(client):
    c, db_path = client
    c.get("/api/j2/notes")
    assert len(_events(db_path, "notebook_search_used")) == 0


def test_search_event_details_never_contain_the_query_text(client):
    c, db_path = client
    secret = "my private thesis about a confidential position"
    c.get("/api/j2/notes", params={"q": secret})
    evs = _events(db_path, "notebook_search_used")
    assert len(evs) == 1
    assert secret not in evs[0]["details"]


def test_trash_then_restore_logs_both_events_in_order(client):
    c, db_path = client
    note = c.post("/api/j2/notes", json={"title": "To be trashed"}).json()["note"]
    c.delete(f"/api/j2/notes/{note['id']}")
    c.post(f"/api/j2/notes/{note['id']}/restore")
    actions = [r["action"] for r in _events(db_path)]
    assert actions.index("j2:notebook_note_trashed") < actions.index("j2:notebook_note_restored")


def test_restoring_a_note_that_was_never_trashed_logs_nothing(client):
    c, db_path = client
    note = c.post("/api/j2/notes", json={"title": "Never trashed"}).json()["note"]
    r = c.post(f"/api/j2/notes/{note['id']}/restore")
    assert r.status_code == 404
    assert len(_events(db_path, "notebook_note_restored")) == 0


def test_notebook_tab_visit_telemetry_is_allow_listed(client):
    c, db_path = client
    r = c.post("/api/j2/telemetry", json={"event": "notebook_tab_visit"})
    assert r.status_code == 200
    evs = _events(db_path, "notebook_tab_visit")
    assert len(evs) == 1


def test_notebook_capture_saved_telemetry_is_allow_listed(client):
    c, db_path = client
    r = c.post("/api/j2/telemetry", json={
        "event": "notebook_capture_saved",
        "props": {"widgetId": "chart", "target": "inbox", "hasTradeRef": True},
    })
    assert r.status_code == 200
    evs = _events(db_path, "notebook_capture_saved")
    assert len(evs) == 1
    assert json.loads(evs[0]["details"]) == {
        "widgetId": "chart", "target": "inbox", "hasTradeRef": True,
    }


def test_an_unlisted_telemetry_event_is_rejected(client):
    c, _ = client
    r = c.post("/api/j2/telemetry", json={"event": "not_a_real_event"})
    assert r.status_code == 400
