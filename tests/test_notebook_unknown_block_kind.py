"""P1.7(a)+(b), server half: a widget kind the server has never heard of is stored, read back and
indexed exactly like a known one, and needs schema level 0. A new block kind is therefore never a
schema decision (docs/notebook/p1-verify-before-building.md)."""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest

FUTURE = {"type": "widgetEmbed", "attrs": {
    "v": 1, "widgetId": "checklistFromTheFuture", "embedId": "e-future-1", "mode": "snapshot",
    "capturedAt": "2026-10-11T14:00:00Z", "searchText": "[checklist: 1 of 1]",
    "params": {"items": [{"id": "a", "text": "Base 5+ weeks", "checked": True}]}}}


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


def _body():
    return {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "Plan"}]}, FUTURE]}


def test_an_unknown_kind_needs_schema_level_zero():
    from api.services.journal_two import notebook_schema
    assert notebook_schema.required_schema(_body()) == 0


def test_an_unknown_kind_is_stored_read_back_and_indexed(db_path):
    from api.services import auth_db
    from api.services.journal_two import notes
    n = notes.create_note("u-future", {"title": "Plan", "bodyJson": _body()})
    got = notes.get_note("u-future", n["id"])
    node = next(x for x in got["bodyJson"]["content"] if x["type"] == "widgetEmbed")
    assert node["attrs"]["widgetId"] == "checklistFromTheFuture"
    assert node["attrs"]["params"] == FUTURE["attrs"]["params"]
    c = auth_db.get_connection()
    try:
        rows = c.execute("SELECT widget_id FROM j2_note_embeds WHERE note_id = ?", (n["id"],)).fetchall()
    finally:
        c.close()
    assert [r["widget_id"] for r in rows] == ["checklistFromTheFuture"]


def test_an_update_keeps_the_unknown_kind(db_path):
    from api.services.journal_two import notes
    n = notes.create_note("u-future", {"title": "Plan", "bodyJson": _body()})
    body = _body()
    body["content"].append({"type": "paragraph", "content": [{"type": "text", "text": "More"}]})
    notes.update_note("u-future", n["id"], {"bodyJson": body}, expected_updated_at=n["updatedAt"], client_schema=0)
    got = notes.get_note("u-future", n["id"])
    assert any(x.get("attrs", {}).get("widgetId") == "checklistFromTheFuture" for x in got["bodyJson"]["content"])
