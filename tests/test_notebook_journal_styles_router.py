"""The journal-styles router: gate (404 before anything), session (401), plan (402), then the
service. Path-shadow rail: every route resolves to THIS router in api.main:app."""
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
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


@pytest.fixture
def client(db_path, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")
    from api.routers import notebook_journal_styles as r
    app = FastAPI()
    app.include_router(r.router)
    c = TestClient(app)
    c.app_ref = app
    yield c
    app.dependency_overrides.clear()


def _as(client, uid="u1", plan="pro"):
    user = {"id": uid, "role": "member", "plan": plan}
    client.app_ref.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    client.app_ref.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)


def test_gate_off_is_one_404_before_the_session(client, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "0")
    assert client.get("/api/j2/journal-styles").status_code == 404
    assert client.post("/api/j2/note-kinds", json={"name": "x"}).status_code == 404
    r = client.post("/api/j2/notes/n1/apply-style-update", content=b"[not json")
    assert (r.status_code, r.json()) == (404, {"detail": "Not found"})


def test_gate_off_answers_before_the_body_is_read(client, monkeypatch):
    """Signed in and paid, a malformed body: with the gate OFF the answer is the one 404, never
    the body's 422 -- the gate runs before the body reader."""
    _as(client)
    assert client.post("/api/j2/journal-styles", content=b"[1]").status_code == 422      # control: gate on
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "0")
    r = client.post("/api/j2/journal-styles", content=b"[1]")
    assert (r.status_code, r.json()) == (404, {"detail": "Not found"})


def test_signed_out_is_401_and_free_is_402(client):
    assert client.get("/api/j2/journal-styles").status_code == 401
    _as(client, plan="free")
    r = client.get("/api/j2/journal-styles")
    assert r.status_code == 402 and r.json()["detail"] == "Journal styles require a paid plan"
    r = client.post("/api/j2/notes/n1/apply-style-update", json={})
    assert r.status_code == 402
    assert client.get("/api/j2/notes/n1/style-update-plan").status_code == 402


def test_list_create_get_update_default_delete_restore(client):
    _as(client)
    listing = client.get("/api/j2/journal-styles").json()
    assert listing["blockKinds"] == ["chart"] and len(listing["kinds"]) == 8
    s = client.post("/api/j2/journal-styles", json={"name": "Mine", "kindId": "trade_plan",
                    "blocks": [{"block": "chart", "enabled": True, "settings": {"tf": "D"}}]}).json()["style"]
    assert client.get(f"/api/j2/journal-styles/{s['id']}").json()["style"]["name"] == "Mine"
    assert client.put(f"/api/j2/journal-styles/{s['id']}", json={"blocks": []}).json()["style"]["version"] == 2
    assert client.post(f"/api/j2/journal-styles/{s['id']}/default").json()["style"]["isDefault"] is True
    assert client.delete(f"/api/j2/journal-styles/{s['id']}").json()["ok"] is True
    assert client.get(f"/api/j2/journal-styles/{s['id']}").status_code == 404
    assert client.post(f"/api/j2/journal-styles/{s['id']}/restore").json()["style"]["isDefault"] is True


def test_errors_carry_sentences(client):
    _as(client)
    r = client.post("/api/j2/journal-styles", json={"name": "x", "kindId": "nope"})
    assert r.status_code == 400 and r.json()["detail"] == "Choose a kind of note for this style."
    assert client.put("/api/j2/journal-styles/builtin:thesis", json={"name": "x"}).status_code == 400
    assert client.get("/api/j2/journal-styles/nope").status_code == 404
    assert client.put("/api/j2/journal-styles/nope", json={"name": "x"}).status_code == 404
    assert client.delete("/api/j2/journal-styles/nope").status_code == 404
    assert client.post("/api/j2/journal-styles/nope/restore").status_code == 404
    assert client.post("/api/j2/journal-styles/nope/default").status_code == 404


def test_kinds_and_in_use(client):
    _as(client)
    k = client.post("/api/j2/note-kinds", json={"name": "Swing", "icon": "bolt"}).json()["kind"]
    client.post("/api/j2/journal-styles", json={"name": "S", "kindId": k["id"]})
    r = client.delete(f"/api/j2/note-kinds/{k['id']}")
    assert r.status_code == 409 and "1 style" in r.json()["detail"]


def test_delete_kind_reports_the_purged_deleted_styles(client):
    """Carry note c: a kind's soft-deleted styles go with it, and the answer says how many."""
    _as(client)
    k = client.post("/api/j2/note-kinds", json={"name": "Swing"}).json()["kind"]
    s = client.post("/api/j2/journal-styles", json={"name": "S", "kindId": k["id"]}).json()["style"]
    client.delete(f"/api/j2/journal-styles/{s['id']}")
    r = client.delete(f"/api/j2/note-kinds/{k['id']}")
    assert r.status_code == 200 and r.json() == {"ok": True, "purgedDeletedStyles": 1}
    assert client.delete(f"/api/j2/note-kinds/{k['id']}").status_code == 404
    assert client.delete("/api/j2/note-kinds/thesis").status_code == 400


def test_preview(client):
    _as(client)
    r = client.post("/api/j2/journal-styles/preview", json={"styleId": "builtin:thesis", "ticker": "nvda"})
    assert r.status_code == 200 and r.json()["ticker"] == "NVDA"
    assert client.post("/api/j2/journal-styles/preview", json={"styleId": "nope"}).status_code == 404


def _note(uid="u1", *, locked=False, props=None, ticker="NVDA", stamp=("builtin:trade_plan", 1, "trade_plan")):
    from api.services import auth_db
    from api.services.journal_two import notes as notes_service
    c = auth_db.get_connection()
    try:
        n = notes_service.create_note(uid, {"title": "T", "ticker": ticker}, c, properties=props,
                                      style_stamp=stamp)
        if locked:
            c.execute("UPDATE j2_notes SET locked = 1 WHERE id = ?", (n["id"],))
            c.commit()
        return notes_service.get_note(uid, n["id"], conn=c)
    finally:
        c.close()


def test_mapping_offer_apply_returns_locked_notes_as_skipped(client):
    """Carry note d: a locked note is never written to, and the answer names it."""
    _as(client)
    plain = _note(props={"builtin:research_type": "earnings_play"}, stamp=None)
    locked = _note(props={"builtin:research_type": "earnings_play"}, stamp=None, locked=True)
    offer = client.get("/api/j2/note-kinds/mapping-offer").json()["offer"]
    assert offer["total"] == 2
    r = client.post("/api/j2/note-kinds/mapping-offer", json={"excludeNoteIds": []}).json()
    assert [n["id"] for n in r["notes"]] == [plain["id"]] and r["count"] == 1
    assert r["skipped"] == [{"id": locked["id"], "reason": "locked"}]
    assert client.post("/api/j2/note-kinds/mapping-offer", json={"excludeNoteIds": "x"}).status_code == 400


def test_mapping_offer_apply_never_500s_mid_loop(client, monkeypatch):
    """Review M6: a note that becomes locked, or changes, between the offer's read and its own write
    is SKIPPED with its reason; the notes already written stay reported (their revisions must reach
    the client to be landed), and the route answers 200, never a 500 after a partial apply."""
    from api.services.journal_two import notes as notes_service
    _as(client)
    props = {"builtin:research_type": "earnings_play"}
    first, raced_lock, raced_write, last = (_note(props=props, stamp=None) for _ in range(4))
    real = notes_service.update_note

    def racing(user_id, note_id, *a, **k):
        if note_id == raced_lock["id"]:
            raise notes_service.NoteLockedError(notes_service.LOCKED_APPEND_SENTENCE)
        if note_id == raced_write["id"]:
            raise notes_service.NoteConflictError("changed under us")
        return real(user_id, note_id, *a, **k)
    monkeypatch.setattr(notes_service, "update_note", racing)
    r = client.post("/api/j2/note-kinds/mapping-offer", json={"excludeNoteIds": []})
    assert r.status_code == 200
    out = r.json()
    assert [n["id"] for n in out["notes"]] == [first["id"], last["id"]] and out["count"] == 2
    assert out["skipped"] == [{"id": raced_lock["id"], "reason": "locked"},
                              {"id": raced_write["id"], "reason": "changed"}]


def test_apply_style_update_requires_a_base_revision(client):
    """Ruling M1: baseUpdatedAt is REQUIRED (the revision the member is looking at). Missing is a
    400 with a plain sentence, and nothing is written."""
    from api.routers import notebook_journal_styles as r
    _as(client)
    n = _note()
    res = client.post(f"/api/j2/notes/{n['id']}/apply-style-update", json={})
    assert res.status_code == 400 and res.json()["detail"] == r.BASE_REQUIRED_SENTENCE
    plan = client.get(f"/api/j2/notes/{n['id']}/style-update-plan").json()["plan"]
    assert plan["missingBlocks"] is True                                 # nothing was added


def test_style_update_plan_and_apply(client):
    _as(client)
    n = _note()
    plan = client.get(f"/api/j2/notes/{n['id']}/style-update-plan").json()["plan"]
    assert plan["add"] == [{"block": "chart", "label": None}]
    assert {"locked", "versionCurrent", "missingBlocks", "upToDate"} <= set(plan)
    r = client.post(f"/api/j2/notes/{n['id']}/apply-style-update", json={"baseUpdatedAt": n["updatedAt"]})
    assert r.status_code == 200
    out = r.json()
    assert out["plan"]["add"] == plan["add"]
    assert any(x["type"] == "widgetEmbed" for x in out["note"]["bodyJson"]["content"])
    assert client.get(f"/api/j2/notes/{n['id']}/style-update-plan").json()["plan"]["upToDate"] is True


def test_style_update_plan_with_a_named_style_and_errors(client):
    _as(client)
    n = _note()
    r = client.get(f"/api/j2/notes/{n['id']}/style-update-plan?styleId=builtin:thesis").json()["plan"]
    assert r["switching"] is True and r["styleId"] == "builtin:thesis"
    assert client.get("/api/j2/notes/nope/style-update-plan").status_code == 404
    assert client.get(f"/api/j2/notes/{n['id']}/style-update-plan?styleId=nope").status_code == 404
    unstyled = _note(stamp=None)
    r = client.get(f"/api/j2/notes/{unstyled['id']}/style-update-plan")
    assert r.status_code == 400 and r.json()["detail"] == "This note was not made from a style."


def test_apply_style_update_stale_base_is_409_with_the_sentence(client):
    from api.services.journal_two import journal_styles as js
    _as(client)
    n = _note()
    r = client.post(f"/api/j2/notes/{n['id']}/apply-style-update", json={"baseUpdatedAt": "2000-01-01T00:00:00Z"})
    assert r.status_code == 409 and r.json()["detail"] == js.CONFLICT_SENTENCE


def test_apply_style_update_locked_note_is_423(client):
    from api.services.journal_two import notes as notes_service
    _as(client)
    n = _note(locked=True)
    r = client.post(f"/api/j2/notes/{n['id']}/apply-style-update", json={"baseUpdatedAt": n["updatedAt"]})
    assert r.status_code == 423 and r.json()["detail"] == notes_service.LOCKED_APPEND_SENTENCE


def test_apply_style_update_refuses_a_bad_base_type(client):
    _as(client)
    n = _note()
    r = client.post(f"/api/j2/notes/{n['id']}/apply-style-update", json={"baseUpdatedAt": 5})
    assert r.status_code == 400


def test_every_route_resolves_to_this_router_in_the_real_app():
    from api import main
    from api.routers import notebook_journal_styles as r
    own = {(m, rt.path) for rt in r.router.routes for m in rt.methods}
    assert len(own) >= 16                                               # non-vacuity
    seen = {}
    for rt in main.app.routes:
        for m in getattr(rt, "methods", None) or ():
            key = (m, getattr(rt, "path", ""))
            if key in own and key not in seen:
                seen[key] = rt.endpoint.__module__
    assert set(seen) == own
    assert set(seen.values()) == {"api.routers.notebook_journal_styles"}


def test_no_earlier_route_in_the_real_app_matches_a_concrete_url_of_ours():
    """The stronger half of the shadow rail: a route registered EARLIER whose path pattern
    matches one of our concrete URLs (e.g. journal_two's `/notes/{note_id}` against
    `/notes/x/style-update-plan`) would answer first. Walk the app in order, as Starlette does."""
    import re
    from api import main
    from api.routers import notebook_journal_styles as r
    own = [(m, rt.path) for rt in r.router.routes for m in rt.methods]
    shadowed = []
    for method, path in own:
        url = re.sub(r"\{[^}]+\}", "x", path)
        for rt in main.app.routes:
            if method not in (getattr(rt, "methods", None) or ()):
                continue
            regex = getattr(rt, "path_regex", None)
            if regex is not None and regex.match(url):
                if rt.endpoint.__module__ != "api.routers.notebook_journal_styles":
                    shadowed.append(f"{method} {path} <- {rt.path} ({rt.endpoint.__module__})")
                break
    assert not shadowed, shadowed
