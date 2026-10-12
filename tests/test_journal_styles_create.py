"""Styled create rides the existing create route (spec P1.3: never a second way to make a note)."""
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
    from api.routers import journal_two
    app = FastAPI()
    app.include_router(journal_two.router)
    c = TestClient(app)
    c.app_ref = app
    yield c
    app.dependency_overrides.clear()


def _as(client, uid="u1", plan="pro"):
    client.app_ref.dependency_overrides[authmw.get_current_user] = lambda: {"id": uid, "role": "member", "plan": plan}


def test_a_plain_create_is_unchanged(client):
    _as(client, plan="free")
    r = client.post("/api/j2/notes", json={"title": "plain"})
    assert r.status_code == 200 and set(r.json()) == {"note"}
    n = r.json()["note"]
    assert (n["styleId"], n["styleVersion"], n["kindId"]) == (None, None, None)


def test_a_plain_create_never_reads_the_switch(client, monkeypatch):
    """Spec P1.7c: only the styleId/kindId branch reads the switch. With the gate OFF and a free
    plan, a create without them still makes a note, and a null styleId/kindId is a plain create."""
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "0")
    _as(client, plan="free")
    assert client.post("/api/j2/notes", json={"title": "plain"}).status_code == 200
    r = client.post("/api/j2/notes", json={"title": "plain", "styleId": None, "kindId": None})
    assert r.status_code == 200 and set(r.json()) == {"note"}


def test_kind_makes_a_note_in_the_default_style(client):
    _as(client)
    r = client.post("/api/j2/notes", json={"kindId": "trade_plan", "ticker": "NVDA"})
    assert r.status_code == 200
    n = r.json()["note"]
    assert (n["styleId"], n["styleVersion"], n["kindId"]) == ("builtin:trade_plan", 1, "trade_plan")
    assert n["propertiesJson"]["builtin:note_kind"] == "trade_plan"
    assert any(x["type"] == "widgetEmbed" for x in n["bodyJson"]["content"])
    assert r.json()["skippedBlocks"] == []


def test_a_styled_create_is_ONE_insert_with_no_second_revision(client):
    """Body, properties and stamp land in the insert: the note's first version is its only one."""
    from api.services import auth_db
    _as(client)
    n = client.post("/api/j2/notes", json={"kindId": "trade_plan", "ticker": "NVDA"}).json()["note"]
    assert n["createdAt"] == n["updatedAt"]
    c = auth_db.get_connection()
    try:
        row = c.execute("SELECT style_id, style_version, kind_id, properties_json FROM j2_notes WHERE id = ?",
                        (n["id"],)).fetchone()
    finally:
        c.close()
    assert (row[0], row[1], row[2]) == ("builtin:trade_plan", 1, "trade_plan")
    assert '"builtin:note_kind": "trade_plan"' in row[3]


def test_style_id_wins_and_records_its_version(client):
    _as(client)
    from api.services.journal_two import journal_styles as js
    s = js.create_style("u1", {"name": "Mine", "kindId": "thesis", "properties": {"builtin:confidence": "low"},
                               "blocks": [{"block": "chart", "enabled": True, "settings": {}}]})
    js.update_style("u1", s["id"], {"blocks": []})                    # a content change: v1 -> v2
    n = client.post("/api/j2/notes", json={"styleId": s["id"], "kindId": "trade_plan", "title": "T"}).json()["note"]
    assert (n["styleId"], n["styleVersion"], n["kindId"]) == (s["id"], 2, "thesis")
    assert n["propertiesJson"] == {"builtin:confidence": "low", "builtin:note_kind": "thesis"}
    assert n["title"] == "T"


def test_a_chart_block_with_no_ticker_is_skipped_and_named(client):
    _as(client)
    r = client.post("/api/j2/notes", json={"styleId": "builtin:thesis", "title": "Thesis"}).json()
    assert r["skippedBlocks"] == [{"block": "chart", "reason": "needs-ticker"}]
    assert not any(x["type"] == "widgetEmbed" for x in r["note"]["bodyJson"]["content"])


def test_kind_without_any_style_makes_a_note_with_only_the_kind(client):
    _as(client)
    from api.services.journal_two import note_kinds as nk
    k = nk.create_kind("u1", "Swing")
    n = client.post("/api/j2/notes", json={"kindId": k["id"]}).json()["note"]
    assert (n["styleId"], n["styleVersion"], n["kindId"]) == (None, None, k["id"])
    assert n["propertiesJson"] == {"builtin:note_kind": k["id"]}


def test_gate_off_and_free_plan_refuse_a_styled_create(client, monkeypatch):
    _as(client, plan="free")
    r = client.post("/api/j2/notes", json={"kindId": "thesis"})
    assert r.status_code == 402 and r.json()["detail"] == "Journal styles require a paid plan"
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "0")
    _as(client)
    r = client.post("/api/j2/notes", json={"kindId": "thesis"})
    assert (r.status_code, r.json()) == (404, {"detail": "Not found"})
    _as(client, plan="free")                       # the gate answers before the plan is read
    assert client.post("/api/j2/notes", json={"styleId": "builtin:thesis"}).status_code == 404


def test_the_plan_is_read_when_the_session_carries_none(client, monkeypatch):
    """In production get_current_user carries no plan: the branch asks for it."""
    client.app_ref.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u9", "role": "member"}
    monkeypatch.setattr(authmw, "get_user_plan", lambda uid: "free")
    assert client.post("/api/j2/notes", json={"kindId": "thesis"}).status_code == 402
    monkeypatch.setattr(authmw, "get_user_plan", lambda uid: "pro")
    assert client.post("/api/j2/notes", json={"kindId": "thesis"}).status_code == 200


def test_unknown_style_and_kind(client):
    _as(client)
    assert client.post("/api/j2/notes", json={"styleId": "nope"}).status_code == 404
    r = client.post("/api/j2/notes", json={"kindId": "nope"})
    assert r.status_code == 400 and r.json()["detail"] == "Choose a kind of note."
    assert client.post("/api/j2/notes", json={"styleId": 5}).status_code == 400
    assert client.post("/api/j2/notes", json={"kindId": "thesis", "ticker": "no way"}).status_code == 400
