"""P2X (owner decision 3) -- the store keeps an object program byte-identical.

The browser decides whether an edit can carry a definition's object program
(`builder/objectProgramCarry.js`) and asks the member before a save that would
remove it. These cases pin the SERVER half of that contract: the save authority
(`user_definitions.save`) stores `definition.objects` verbatim on a create and on
an edit, serves it back unchanged, and adds no rule of its own that could drop or
rewrite it. Fixtures are real member-pane documents (c3b live corpus, dumped from
`memberPaneDefinition` into `tests/fixtures/p2x/object_pane_docs.json`; the JS
truth file rails that dump against the live door).

Each case: ASKED / CLAIMED / DID.
"""
from __future__ import annotations

import copy
import json
import pathlib

import pytest

from api.services import user_definitions as ud

ROOT = pathlib.Path(__file__).resolve().parent
DOCS = json.loads((ROOT / "fixtures" / "p2x" / "object_pane_docs.json").read_text("utf-8"))
USER = "p2x-objects-user"


@pytest.fixture
def client(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from api.main import app
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan

    path = tmp_path / "user_definitions.db"
    monkeypatch.setenv("USER_DEFINITIONS_DB_PATH", str(path))
    monkeypatch.setattr(ud, "_DB_PATH", str(path))
    ud._init_db()
    app.dependency_overrides[get_current_user] = lambda: {"id": USER}
    app.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": USER, "role": "user", "plan": "premium"}
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_current_user_with_plan, None)


def _canon(v) -> str:
    return json.dumps(v, sort_keys=True, separators=(",", ":"))


@pytest.mark.parametrize("name", sorted(DOCS))
def test_P2X_objects_create_reload_edit_keep_the_program_verbatim(client, name):
    """ASKED: save a Pine member pane that draws objects, reload it, then save a
    representable edit (a rename) carrying the program. CLAIMED: the program is
    stored and served byte-identical at every step. DID: below."""
    doc = copy.deepcopy(DOCS[name])
    program = copy.deepcopy(doc["objects"])
    assert program["ops"], "the fixture draws nothing -- vacuous"

    r = client.post("/api/user-definitions", json={"definition": doc})
    assert r.status_code == 200, r.text
    def_id = r.json()["def_id"]

    got = client.get(f"/api/user-definitions/{def_id}")
    assert got.status_code == 200, got.text
    stored = got.json()["definition"]
    assert _canon(stored["objects"]) == _canon(program)
    # the Pine stamps the object lane evaluates under are kept too
    assert stored["meta"].get("recurrenceOrigin") == "pine"

    edit = copy.deepcopy(stored)
    edit["meta"]["name"] = "Renamed"
    edit["version"] = int(stored.get("version", 1)) + 1
    put = client.put(f"/api/user-definitions/{def_id}", json={"definition": edit})
    assert put.status_code == 200, put.text
    again = client.get(f"/api/user-definitions/{def_id}").json()["definition"]
    assert again["meta"]["name"] == "Renamed"
    assert _canon(again["objects"]) == _canon(program)


def test_P2X_objects_the_store_adds_no_rule_that_drops_or_rewrites_a_program(client):
    """ASKED: an edit WITHOUT the program (what the browser sends only after the
    member confirmed the lossy save). CLAIMED: the store does what it is told --
    the confirmation is the browser's gate, the store neither resurrects the old
    program nor refuses the save. DID: below."""
    doc = copy.deepcopy(DOCS["c3b_04_table_dash.pine"])
    def_id = client.post("/api/user-definitions", json={"definition": doc}).json()["def_id"]
    stored = client.get(f"/api/user-definitions/{def_id}").json()["definition"]
    lossy = copy.deepcopy(stored)
    lossy.pop("objects")
    lossy["version"] = int(stored.get("version", 1)) + 1
    r = client.put(f"/api/user-definitions/{def_id}", json={"definition": lossy})
    assert r.status_code == 200, r.text
    after = client.get(f"/api/user-definitions/{def_id}").json()["definition"]
    assert "objects" not in after
    # and the earlier version still holds it (append-only history)
    v1 = client.get(f"/api/user-definitions/{def_id}", params={"version": 1}).json()["definition"]
    assert _canon(v1["objects"]) == _canon(doc["objects"])
