"""builtin:note_kind (spec P1.2): a select over the member's kinds, so views, filters and boards
group by kind. ⛔ The definition never reads the journal-styles switch (spec P1.7c): with it off a
note's Kind of note still validates and renders."""
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


def _def(user_id):
    from api.services.journal_two import note_properties as np
    return next(d for d in np.list_property_defs(user_id) if d["id"] == "builtin:note_kind")


def test_note_kind_def_is_present_with_the_switch_off(db_path, monkeypatch):
    monkeypatch.delenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", raising=False)
    d = _def("u1")
    assert d["type"] == "select" and d["source"] == "user_set" and d["name"] == "Kind of note"
    assert [o["id"] for o in d["options"]][:2] == ["trade_plan", "daily_prep"]


def test_a_members_own_kind_is_an_option_for_them_only(db_path):
    from api.services.journal_two import note_kinds as nk
    k = nk.create_kind("u1", "Swing")
    assert k["id"] in [o["id"] for o in _def("u1")["options"]]
    assert k["id"] not in [o["id"] for o in _def("u2")["options"]]


def test_setting_and_rejecting_values(db_path):
    from api.services.journal_two import note_kinds as nk
    from api.services.journal_two import notes
    k = nk.create_kind("u1", "Swing")
    n = notes.create_note("u1", {"title": "x"})
    got = notes.update_note("u1", n["id"], {"properties": {"builtin:note_kind": k["id"]}})
    assert got["propertiesJson"]["builtin:note_kind"] == k["id"]
    with pytest.raises(notes.NoteValidationError):
        notes.update_note("u2", notes.create_note("u2", {"title": "y"})["id"],
                          {"properties": {"builtin:note_kind": k["id"]}})   # u1's kind is not u2's


def test_a_template_keeps_a_member_kind_value(db_path):
    from api.services.journal_two import note_kinds as nk
    from api.services.journal_two import note_templates, notes
    k = nk.create_kind("u1", "Swing")
    n = notes.create_note("u1", {"title": "x"}, properties={"builtin:note_kind": k["id"]})
    t = note_templates.create_from_note("u1", n["id"])
    assert note_templates.get_template("u1", t["id"])["properties"]["builtin:note_kind"] == k["id"]
