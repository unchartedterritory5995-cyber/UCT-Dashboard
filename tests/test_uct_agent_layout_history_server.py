"""layoutHistory.restore (UCT Agent, Layouts -> Version history): the server semantics the Agent relies on, through the REAL
routes (api/routers/workspace_doc.py) over the REAL store (api/services/workspace_doc_store.py). AUDIT #1248 items 1-2:

1. APPEND-ONLY: a restore writes a NEW head whose content equals version N; the prior head stays in the history,
   untombstoned and restorable from the panel — also after the Agent's Undo is no longer possible (the board saved again).
2. SCOPE: the document is the authenticated member's own (user_id from the session, never from the request); one member's
   restore never reads or changes another member's history; only the known boards are accepted.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import auth as auth_router
from api.routers import workspace_doc as wd_router
from api.services import workspace_doc_store as wds
from tests.authclients import authorize


def _member():
    return {"id": f"lh-{uuid.uuid4().hex[:12]}", "email": "lh@example.test", "role": "member", "plan": "free"}


@pytest.fixture
def armed(tmp_path, monkeypatch):
    monkeypatch.setattr(wds, "_DB_PATH", str(tmp_path / "workspace_docs.db"))
    monkeypatch.setenv(wds.ENABLED_ENV, "1")
    return tmp_path


def _client(user):
    from api.services import auth_db

    auth_db.init_db()
    app = FastAPI()
    app.include_router(auth_router.router)
    app.include_router(wd_router.router)
    authorize(app, user)
    return TestClient(app)


def _save(client, theme):
    r = client.post("/api/auth/preferences", json={"key": "charts_theme", "value": theme})
    assert r.status_code == 200, r.text


def _versions(client):
    r = client.get("/api/workspace/doc/versions?board=charts&limit=50")
    assert r.status_code == 200, r.text
    return {v["version"]: v for v in r.json()["versions"]}


def _restore(client, version, base):
    return client.post("/api/workspace/doc/restore", json={"version": version, "base_version": base, "board": "charts"})


def _theme(client, version):
    return client.get(f"/api/workspace/doc/versions/{version}?board=charts").json()["doc"]["prefs"].get("charts_theme")


def test_a_restore_appends_a_copy_and_the_prior_head_stays_listed_untombstoned_and_restorable(armed):
    c = _client(_member())
    for t in ("a", "b", "c"):
        _save(c, t)
    before = _versions(c)
    head = max(before)
    target = min(v for v, row in before.items() if not row["tombstone"] and _theme(c, v) == "a")
    r = _restore(c, target, head)
    assert r.status_code == 200, r.text
    assert r.json()["appended"] is True and r.json()["version"] == head + 1 and r.json()["restored_from"] == target
    after = _versions(c)
    new = after[head + 1]
    assert new["source"] == "restore" and new["restored_from"] == target
    assert new["content_sha256"] == before[target]["content_sha256"]               # the new head IS version N's content
    for v, row in before.items():                                                 # nothing rewritten, nothing tombstoned
        assert after[v] == row, v
    assert after[head]["tombstone"] is False and _theme(c, head) == "c"            # the prior head, intact
    # and restorable from the panel: the same route the Agent's Undo and the panel's Restore use
    r2 = _restore(c, head, head + 1)
    assert r2.status_code == 200 and r2.json()["restored_from"] == head
    assert _versions(c)[head + 2]["content_sha256"] == before[head]["content_sha256"]


def test_after_an_undo_refused_because_the_board_was_saved_the_prior_head_is_still_restorable(armed):
    user = _member()
    c = _client(user)
    for t in ("a", "b"):
        _save(c, t)
    head = max(_versions(c))                                                      # the board before the Agent's restore
    assert _restore(c, head - 1, head).status_code == 200                          # the Agent restores the previous version
    # the member's board saves again (the board's own document write, as the workspace autosave lands): Agent Undo refuses
    h = wds.head(user["id"], "charts")
    wds.write(user["id"], "charts", {**h["doc"], "prefs": {**h["doc"]["prefs"], "charts_theme": "member-edit"}}, base_version=h["version"])
    now = max(_versions(c))
    assert _restore(c, head, head + 1).status_code == 409                         # the Undo's compare-and-set (base = its head)
    listed = _versions(c)
    assert listed[head]["tombstone"] is False and _theme(c, head) == "b"
    r = _restore(c, head, now)                                                    # the panel, on the current head
    assert r.status_code == 200 and r.json()["restored_from"] == head
    assert _versions(c)[now + 1]["content_sha256"] == listed[head]["content_sha256"]


def test_a_restore_is_scoped_to_the_signed_in_member_and_never_reaches_another_members_history(armed):
    a, b = _member(), _member()
    ca, cb = _client(a), _client(b)
    for t in ("a1", "a2", "a3"):
        _save(ca, t)
    _save(cb, "b1")
    _save(cb, "b2")
    a_before = _versions(ca)
    b_before = _versions(cb)
    # B asks for a version number only A has: refused (404), nothing written anywhere
    missing = max(a_before) if max(a_before) not in b_before else max(a_before) + 10
    assert _restore(cb, missing, max(b_before)).status_code == 404
    # B restores B's own version 1: only B's history grows
    assert _restore(cb, min(b_before), max(b_before)).status_code == 200
    assert _versions(ca) == a_before
    assert max(_versions(cb)) == max(b_before) + 1
    # the doc id is not the client's to name: the request has no user / doc field, and an extra one is ignored
    assert set(wd_router.RestoreRequest.model_fields) == {"version", "base_version", "board"}
    r = cb.post("/api/workspace/doc/restore", json={"version": min(b_before), "base_version": max(_versions(cb)),
                                                     "board": "charts", "user_id": a["id"]})
    assert r.status_code in (200, 422)
    assert _versions(ca) == a_before                                              # A untouched whatever B sends
    # only the known boards (charts, terminal) — no shared / template document can be named
    assert cb.post("/api/workspace/doc/restore", json={"version": 1, "base_version": 1, "board": "templates"}).status_code == 400
