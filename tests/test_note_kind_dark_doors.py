"""Kind of note through every server door that offers it. NOTEBOOK_JOURNAL_STYLES_ENABLED, which
used to keep it dark (spec P1.7c), was retired as always on (2026-11-04), so it is always offered.

Every server door that LISTS properties to offer or suggest one is railed here:
  * property autofill candidates (property_autofill.candidates)
  * AI organise: the context it shows the model, and the plan validator's settable list
  * the template gallery's property definitions

The raw note-property write (set_note_properties) validates a value that already exists (a queued
offline write, an applied style, a mapped note). It is railed open in
test_the_raw_property_write_accepts_a_kind.
"""
from __future__ import annotations

import importlib
import json
import os
import tempfile

import pytest

KIND = "builtin:note_kind"


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


def _resolved(user_id, note):
    from api.services.auth_db import get_connection
    from api.services.journal_two import note_properties as np
    conn = get_connection()
    try:
        return np.resolve_note_properties(user_id, note, conn)
    finally:
        conn.close()


def test_autofill_suggests_a_kind(db_path, monkeypatch):
    from api.services.journal_two import notes, property_autofill as pa
    n = notes.create_note("u1", {"title": "x"})
    on = [p["id"] for p in pa.candidates(_resolved("u1", notes.get_note("u1", n["id"])))]
    assert KIND in on
    assert "builtin:thesis_status" in on               # the other empty selects are offered too


def test_ai_organise_lists_and_accepts_a_kind(db_path, monkeypatch):
    from api.services.journal_two import ai_actions as ai, notes
    n = notes.create_note("u1", {"title": "gap and go plan"})
    plan = json.dumps({"summary": "s", "changes": [
        {"note": "n1", "op": "set_property", "property": "Kind of note", "value": "Trade plan"}]})

    ctx = ai.build_context("u1", "gap and go")
    assert ctx["notes"], "CONTROL: the candidate note was found"
    assert "Kind of note" in [p["name"] for p in ctx["properties"]]
    out = ai.validate_plan("u1", plan, ctx)
    assert [c["args"]["value"] for c in out["changes"]] == ["trade_plan"]
    assert n["id"]


def test_an_existing_value_resolves(db_path, monkeypatch):
    """The per-note properties carry the value."""
    from api.services.journal_two import notes
    n = notes.create_note("u1", {"title": "x"}, properties={KIND: "trade_plan"})
    got = {p["id"]: p["value"] for p in _resolved("u1", notes.get_note("u1", n["id"]))}
    assert got[KIND] == "trade_plan"


def test_the_raw_property_write_accepts_a_kind(db_path, monkeypatch):
    from api.services.journal_two import notes
    n = notes.create_note("u1", {"title": "x"})
    got = notes.update_note("u1", n["id"], {"properties": {KIND: "thesis"}})
    assert got["propertiesJson"][KIND] == "thesis"


def test_the_gallery_definitions_skip_the_kind(db_path):
    from api.services.journal_two import notes, template_gallery as tg
    from api.services.auth_db import get_connection
    n = notes.create_note("u1", {"title": "x"}, properties={KIND: "thesis", "builtin:thesis_status": "active"})
    raw = notes.get_note("u1", n["id"])
    conn = get_connection()
    try:
        defs = tg.property_definitions("u1", json.dumps(raw["propertiesJson"]), conn)
    finally:
        conn.close()
    ids = [d.get("builtinId") for d in defs]
    assert "builtin:thesis_status" in ids               # CONTROL: other built-ins still travel
    assert KIND not in ids
