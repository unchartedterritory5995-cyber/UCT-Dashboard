"""P1 M-7: a version restore takes the style stamp back with the body."""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest

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

def _note_updated_to_v2():
    from api.services.journal_two import journal_styles as js, notes
    s = js.create_style("u1", {"name": "S", "kindId": "thesis", "blocks": [],
                               "outlineBodyJson": {"type": "doc", "content": [
                                   {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "T"}]}]}})
    n, _ = js.create_styled_note("u1", {"styleId": s["id"], "ticker": "NVDA"})
    js.update_style("u1", s["id"], {"blocks": [{"block": "chart", "enabled": True, "settings": {"tf": "D"}}]})
    note, _ = js.apply_style_update("u1", n["id"], expected_updated_at=n["updatedAt"])
    return s, n, note

def test_restoring_before_the_update_takes_the_version_back(db_path):
    from api.services.journal_two import journal_styles as js, notes
    s, n, note = _note_updated_to_v2()
    assert note["styleVersion"] == 2
    versions = notes.list_note_versions("u1", n["id"])
    pre = next(v for v in versions if v.get("styleVersion") == 1)
    back = notes.restore_note_version("u1", n["id"], pre["id"], expected_updated_at=note["updatedAt"])
    assert (back["styleId"], back["styleVersion"]) == (s["id"], 1)
    plan = js.plan_style_update("u1", n["id"])
    assert plan["versionCurrent"] is False and plan["missingBlocks"] is True

def test_a_restore_from_a_legacy_version_reoffers_the_update(db_path):
    from api.services.auth_db import get_connection
    from api.services.journal_two import journal_styles as js, notes
    s, n, note = _note_updated_to_v2()
    c = get_connection()
    c.execute("UPDATE j2_note_versions SET style_id = NULL, style_version = NULL, style_captured = 0 WHERE note_id = ?", (n["id"],))
    c.commit(); c.close()
    pre = notes.list_note_versions("u1", n["id"])[-1]
    back = notes.restore_note_version("u1", n["id"], pre["id"], expected_updated_at=note["updatedAt"])
    assert (back["styleId"], back["styleVersion"]) == (s["id"], None)
    assert js.plan_style_update("u1", n["id"])["versionCurrent"] is False

def test_a_note_never_made_from_a_style_restores_with_no_stamp(db_path):
    from api.services.journal_two import notes
    n = notes.create_note("u1", {"title": "plain"})
    n2 = notes.update_note("u1", n["id"], {"title": "plain 2"}, client_schema=4, force_version=True)
    v = notes.list_note_versions("u1", n["id"])[-1]
    back = notes.restore_note_version("u1", n["id"], v["id"], expected_updated_at=n2["updatedAt"])
    assert (back.get("styleId"), back.get("styleVersion")) == (None, None)
