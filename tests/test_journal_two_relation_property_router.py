"""Relation property — wave 6, lane E, item 5.

What these pin:
  * a new property type, `relation`, whose value is a LIST OF NOTE IDS
    (trimmed, de-duplicated in order, at most 50; an empty list clears it);
  * the target note answers "Related from" — `GET /notes/{id}/related-from`:
    every live note of the member's whose relation property holds its id, once
    per note with the relation names — owner-scoped, trash excluded, a deleted
    relation property excluded, never the note itself;
  * a relation can be filtered by `contains` (and emptiness), never compared or
    sorted (an array has no order a member means);
  * ⛔ ONE FACT IN TWO FILES: the client's property-type list
    (PropertiesSection.jsx `NEW_PROPERTY_TYPES`) and the server's
    (`note_properties._VALID_TYPES`) are pinned against each other here — the
    client list is PARSED, not restated (a copy here would be a third authority).
"""
from __future__ import annotations

import importlib
import os
import re
import tempfile
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

REPO = Path(__file__).resolve().parents[1]
PROPERTIES_SECTION = REPO / "app" / "src" / "pages" / "journal-2-0" / "components" / "notebook" / "PropertiesSection.jsx"


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


def _note(client, title):
    r = client.post("/api/j2/notes", json={"title": title})
    assert r.status_code == 200, r.text
    return r.json()["note"]["id"]


def _relation(client, name="Related"):
    r = client.post("/api/j2/property-defs", json={"name": name, "type": "relation"})
    assert r.status_code == 200, r.text
    return r.json()["propertyDef"]["id"]


def _set(client, note_id, prop_id, value):
    return client.put(f"/api/j2/notes/{note_id}", json={"properties": {prop_id: value}})


def _related_from(client, note_id):
    r = client.get(f"/api/j2/notes/{note_id}/related-from")
    assert r.status_code == 200, r.text
    return r.json()


def test_a_relation_holds_a_list_of_note_ids(app, client):
    _login_as(app, "u1")
    rel = _relation(client)
    a, b, c = _note(client, "A"), _note(client, "B"), _note(client, "C")
    r = _set(client, a, rel, [f" {b} ", c, b])
    assert r.status_code == 200, r.text
    assert r.json()["note"]["propertiesJson"][rel] == [b, c], "trimmed, de-duplicated, in order"
    assert _set(client, a, rel, []).json()["note"]["propertiesJson"].get(rel) is None, "empty clears"


@pytest.mark.parametrize("bad", ["x", [1], [""], [None], ["x" * 65], ["n"] * 51, {"a": 1}])
def test_a_relation_refuses_what_is_not_a_short_list_of_ids(app, client, bad):
    _login_as(app, "u1")
    rel = _relation(client)
    a = _note(client, "A")
    if bad == ["n"] * 51:
        bad = [f"n{i}" for i in range(51)]
    assert _set(client, a, rel, bad).status_code == 400


def test_the_target_lists_what_is_related_from_it(app, client):
    _login_as(app, "u1")
    rel = _relation(client, "Peers")
    other = _relation(client, "Supply chain")
    a, b, c, t = _note(client, "A"), _note(client, "B"), _note(client, "C"), _note(client, "Target")
    _set(client, a, rel, [t])
    client.put(f"/api/j2/notes/{b}", json={"properties": {rel: [t], other: [t, c]}})
    _set(client, c, rel, [a])  # related, but not to the target
    got = _related_from(client, t)
    assert got["count"] == 2
    by = {n["id"]: n for n in got["notes"]}
    assert set(by) == {a, b}
    assert by[a]["title"] == "A"
    assert sorted(by[b]["properties"]) == ["Peers", "Supply chain"]


def test_related_from_leaves_out_the_trash_a_deleted_relation_and_the_note_itself(app, client):
    _login_as(app, "u1")
    rel = _relation(client)
    gone_rel = _relation(client, "Old")
    a, b, t = _note(client, "A"), _note(client, "B"), _note(client, "T")
    _set(client, a, rel, [t])
    _set(client, b, gone_rel, [t])
    _set(client, t, rel, [t])  # a note related to itself
    assert _related_from(client, t)["count"] == 2
    client.delete(f"/api/j2/property-defs/{gone_rel}")
    client.delete(f"/api/j2/notes/{a}")
    assert _related_from(client, t) == {"count": 0, "notes": []}


def test_related_from_is_the_members_own(app, client):
    _login_as(app, "u1")
    rel = _relation(client)
    a, t = _note(client, "A"), _note(client, "T")
    _set(client, a, rel, [t])
    _login_as(app, "u2")
    assert _related_from(client, t) == {"count": 0, "notes": []}


def test_a_relation_filters_by_contains_and_is_never_compared_or_sorted(app, client):
    _login_as(app, "u1")
    rel = _relation(client)
    a, b, t = _note(client, "A"), _note(client, "B"), _note(client, "T")
    _set(client, a, rel, [t])
    _set(client, b, rel, [a])
    import json as _json

    def listed(flt):
        return client.get("/api/j2/notes", params={"propertyFilter": _json.dumps(flt)})

    r = listed([{"propertyId": rel, "op": "contains", "value": t}])
    assert r.status_code == 200, r.text
    assert [n["title"] for n in r.json()["notes"]] == ["A"]
    assert sorted(n["title"] for n in listed([{"propertyId": rel, "op": "is_not_empty"}]).json()["notes"]) == ["A", "B"]
    assert listed([{"propertyId": rel, "op": "eq", "value": t}]).status_code == 400
    # …and with a LIST value too: validation accepts the list, so only the
    # explicit refusal stops it reaching SQLite as an unbindable parameter.
    assert listed([{"propertyId": rel, "op": "eq", "value": [t]}]).status_code == 400
    assert listed([{"propertyId": rel, "op": "gt", "value": [t]}]).status_code == 400
    r = client.get("/api/j2/notes", params={"propertySort": _json.dumps({"propertyId": rel, "direction": "asc"})})
    assert r.status_code == 400


def test_the_client_and_server_type_lists_are_one_fact():
    from api.services.journal_two import note_properties
    src = PROPERTIES_SECTION.read_text(encoding="utf-8")
    block = re.search(r"const NEW_PROPERTY_TYPES = \[(.*?)\n\]", src, re.S)
    assert block, "NEW_PROPERTY_TYPES not found in PropertiesSection.jsx -- the parser is broken, not the lists"
    client_types = re.findall(r"value: '([a-z_]+)'", block.group(1))
    assert len(client_types) >= 7, "non-vacuity: the parser must see the whole list"
    assert "relation" in client_types
    assert sorted(client_types) == sorted(note_properties._VALID_TYPES)
