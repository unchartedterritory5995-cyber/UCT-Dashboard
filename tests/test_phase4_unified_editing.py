"""PHASE 4 — UNIFIED EDITING, the server half.

Three store contracts, proved against the REAL store on a tmp SQLite file:

* DUPLICATE AS A NEW INDICATOR (`svc.fork`, `POST /{def_id}/fork`): a new def_id,
  its own history, provenance on the copy, and NO shared mutable state — editing
  either side never moves the other. Owner-scoped (another member's id is a 404).
* REVISION-AWARE SAVE (`expected_version`, `PUT … base_version`): an editor that
  opened version R cannot silently overwrite R+1 (409, nothing appended).
* PINE "APPLY" PROVENANCE (`meta.importedFrom`): Pine-translated maths that came in
  through the Builder's Apply door keeps Pine semantics (no `meta.semantics: 2`)
  through later edits — and a legacy row without the stamp is NOT migrated.
"""
from __future__ import annotations

import json
import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import user_definitions as router_mod
from api.services import user_definitions as svc
from tests.test_user_definitions import defn, store  # noqa: F401 -- fixture by name

USER, OTHER = "u1", "u2"


def _rows(def_id, user=USER):
    with sqlite3.connect(svc._DB_PATH) as c:
        return c.execute("SELECT version, definition FROM user_definitions WHERE user_id=? AND def_id=?"
                         " ORDER BY version", (user, def_id)).fetchall()


def _create(period=20, name="My Average", user=USER, **kw):
    def_id = svc.new_def_id()
    d = defn(period, name=name, def_id=def_id)
    d["meta"].update(kw.pop("meta", {}))
    svc.save(user, def_id, d, **kw)
    return def_id


def _edit(def_id, period=None, *, user=USER, name=None, mutate=None, **kw):
    cur = svc.get(user, def_id)["definition"]
    doc = json.loads(json.dumps(cur))
    doc.get("meta", {}).pop("semantics", None)
    if period is not None:
        doc["compute"]["ast"]["args"][1]["value"] = period
    if name is not None:
        doc["meta"]["name"] = name
    if mutate:
        mutate(doc)
    return svc.save(user, def_id, doc, **kw)


# ═══ FORK ═════════════════════════════════════════════════════════════════

def test_a_fork_is_a_NEW_definition_with_its_OWN_history_and_provenance(store):
    a = _create(20)
    _edit(a, 30)                                      # A is at version 2
    out = svc.fork(USER, a)
    b = out["def_id"]
    assert b != a and out["version"] == 1
    bdoc = svc.get(USER, b)["definition"]
    assert bdoc["id"] == b and bdoc["meta"]["name"] == "My Average (copy)"
    assert bdoc["meta"]["forkedFrom"]["def_id"] == a and bdoc["meta"]["forkedFrom"]["version"] == 2
    assert bdoc["compute"]["ast"] == svc.get(USER, a)["definition"]["compute"]["ast"]
    assert [v for v, _ in _rows(b)] == [1]


def test_editing_the_COPY_never_moves_the_SOURCE_and_vice_versa(store):
    a = _create(20)
    b = svc.fork(USER, a)["def_id"]
    a_before = _rows(a)
    _edit(b, 50)
    assert _rows(a) == a_before, "editing the custom copy changed the source definition"
    b_before = _rows(b)
    _edit(a, 9)
    assert _rows(b) == b_before, "editing the source changed its custom copy"
    assert svc.get(USER, a)["definition"]["compute"]["ast"]["args"][1]["value"] == 9
    assert svc.get(USER, b)["definition"]["compute"]["ast"]["args"][1]["value"] == 50


def test_a_copy_of_a_copy_names_once(store):
    a = _create(20)
    b = svc.fork(USER, a)["def_id"]
    c = svc.fork(USER, b)["def_id"]
    assert svc.get(USER, c)["definition"]["meta"]["name"] == "My Average (copy)"


def test_a_fork_is_OWNER_SCOPED_and_refuses_deleted_or_missing_sources(store):
    a = _create(20, user=OTHER)
    with pytest.raises(svc.ForkRefused):
        svc.fork(USER, a)                             # another member's definition
    mine = _create(20)
    svc.soft_delete(USER, mine)
    with pytest.raises(svc.ForkRefused):
        svc.fork(USER, mine)                          # a tombstone
    with pytest.raises(svc.ForkRefused):
        svc.fork(USER, "u_000000000fff")             # never existed


def test_a_fork_CARRIES_the_stored_semantics_rather_than_re_deciding_it(store):
    native = _create(20)                              # a native create: semantics 2
    assert svc.get(USER, native)["definition"]["meta"].get("semantics") == 2
    copy = svc.fork(USER, native)["def_id"]
    assert svc.get(USER, copy)["definition"]["meta"].get("semantics") == 2
    pine = _create(20, meta={"importedFrom": {"dialect": "pine", "via": "apply"}}, source_dialect="pine")
    assert "semantics" not in svc.get(USER, pine)["definition"]["meta"]
    pcopy = svc.fork(USER, pine)["def_id"]
    assert "semantics" not in svc.get(USER, pcopy)["definition"]["meta"]
    assert svc.get(USER, pcopy)["definition"]["meta"]["importedFrom"]["dialect"] == "pine"


# ═══ REVISION-AWARE SAVE ══════════════════════════════════════════════════

def test_a_STALE_save_is_refused_and_appends_NOTHING(store):
    a = _create(20)
    _edit(a, 30)                                      # elsewhere: R -> R+1 (version 2)
    before = _rows(a)
    with pytest.raises(svc.SaveConflict) as e:
        _edit(a, 40, expected_version=1)              # the old editor opened version 1
    assert e.value.expected == 1 and e.value.current == 2
    assert _rows(a) == before


def test_a_CURRENT_save_with_expected_version_succeeds(store):
    a = _create(20)
    out = _edit(a, 30, expected_version=1)
    assert out["version"] == 2
    with pytest.raises(svc.SaveConflict):
        _edit(a, 40, expected_version=1)              # the same stale token cannot win twice


def test_expected_version_is_OPTIONAL_and_last_write_wins_without_it(store):
    a = _create(20)
    _edit(a, 30)
    assert _edit(a, 40)["version"] == 3


# ═══ PINE APPLY PROVENANCE ════════════════════════════════════════════════

PINE_APPLY = {"importedFrom": {"dialect": "pine", "via": "apply"}}


def test_an_APPLY_import_keeps_pine_semantics_through_a_later_MATHS_edit(store):
    a = _create(20, meta=PINE_APPLY, source_dialect="pine")
    assert "semantics" not in svc.get(USER, a)["definition"]["meta"]
    _edit(a, 21)                                      # a maths edit with no dialect
    assert "semantics" not in svc.get(USER, a)["definition"]["meta"]


def test_the_STORED_row_protects_even_when_an_editor_drops_the_stamp(store):
    a = _create(20, meta=PINE_APPLY, source_dialect="pine")
    _edit(a, 21, mutate=lambda d: d["meta"].pop("importedFrom", None))
    assert "semantics" not in svc.get(USER, a)["definition"]["meta"]


def test_a_LEGACY_apply_row_without_the_stamp_is_NOT_migrated(store):
    """⛔ Phase 4A: rows saved before the stamp keep the old rule; nothing rewrites them."""
    a = _create(20, source_dialect="pine")            # the pre-Phase-4 Apply save shape
    assert "semantics" not in svc.get(USER, a)["definition"]["meta"]
    _edit(a, 21)
    assert svc.get(USER, a)["definition"]["meta"].get("semantics") == 2


def test_is_pine_import_reads_both_doors():
    assert svc.is_pine_import({"meta": {"recurrenceOrigin": "pine"}})
    assert svc.is_pine_import({"meta": {"importedFrom": {"dialect": "Pine"}}})
    assert not svc.is_pine_import({"meta": {"importedFrom": {"dialect": "thinkscript"}}})
    assert not svc.is_pine_import({"meta": {}})


# ═══ THE ROUTES ═══════════════════════════════════════════════════════════

@pytest.fixture
def http(store):
    app = FastAPI()
    app.include_router(router_mod.router)
    who = {"user": {"id": USER, "role": "member", "plan": "pro"}}
    app.dependency_overrides[get_current_user_with_plan] = lambda: who["user"]
    return TestClient(app, raise_server_exceptions=False), who


def test_the_FORK_route_copies_and_404s_for_anyone_else(http):
    c, who = http
    a = _create(20)
    r = c.post(f"/api/user-definitions/{a}/fork")
    assert r.status_code == 200, r.text
    assert r.json()["def_id"] != a and r.json()["forked_from"]["def_id"] == a
    who["user"] = {"id": OTHER, "role": "member", "plan": "pro"}
    assert c.post(f"/api/user-definitions/{a}/fork").status_code == 404
    who["user"] = {"id": OTHER, "role": "member", "plan": "free"}
    assert c.post(f"/api/user-definitions/{a}/fork").status_code == 402


def test_the_PUT_route_answers_a_stale_base_version_with_409(http):
    c, _ = http
    a = _create(20)
    _edit(a, 30)
    doc = svc.get(USER, a)["definition"]
    doc["meta"].pop("semantics", None)
    doc["compute"]["ast"]["args"][1]["value"] = 44
    r = c.put(f"/api/user-definitions/{a}", json={"definition": doc, "base_version": 1})
    assert r.status_code == 409
    body = r.json()
    assert body["conflict"] == {"def_id": a, "expected_version": 1, "current_version": 2}
    assert "Nothing was saved" in body["detail"]
    assert len(_rows(a)) == 2
    ok = c.put(f"/api/user-definitions/{a}", json={"definition": doc, "base_version": 2})
    assert ok.status_code == 200 and ok.json()["version"] == 3
