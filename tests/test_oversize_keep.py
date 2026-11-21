"""⭐⭐ ITEM 2 (2026-11-21, coordinator ruling) -- the store's half of "a preview the store cannot hold is kept another
way at Add" (`memberPaneDefinition.js::withOversizeKeep`).

vdubus-pattern-gen-v2-restored-refined (committed, MPL-2.0) has a ~4 MB host document; the member door now keeps it
drawn bar by bar instead. `tests/fixtures/oversize_keep_vdubus.json` is the exact POST body the real client save sends
for it (written by `oversizeKeep.test.jsx`, which holds it equal to today's door). Here the store is handed that body
with production's runtime switches (stage all, runtime saves on, capability admission on), on temporary databases, and
the document is read back by a fresh client: KEPT ACROSS RELOAD. And the store's size refusal, which the door renders
verbatim, is the member's sentence on the runtime cap too.
"""
from __future__ import annotations

import copy
import json
import re
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import user_definitions as router_mod
from api.services import alert_rev_migration as rev
from api.services import indicator_alert_service as ias
from api.services import runtime_definitions as rt
from api.services import user_definitions as svc

ROOT = Path(__file__).resolve().parents[1]
BODY = json.loads((ROOT / "tests" / "fixtures" / "oversize_keep_vdubus.json").read_text(encoding="utf-8"))
SOURCE = (ROOT / "corpus" / "committed" / f"{BODY['slug']}.pine").read_text(encoding="utf-8")
USER = "u_oversize_keep"


@pytest.fixture
def client(tmp_path, monkeypatch):
    for k in (rt.STAGE_ENV, rt.SAVE_ENV, rt.KILL_ENV, rt.ALLOW_ENV):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv(rt.STAGE_ENV, "all")
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    rev.init_schema()

    def make():
        app = FastAPI()
        app.include_router(router_mod.router)
        app.dependency_overrides[get_current_user_with_plan] = \
            lambda: {"id": USER, "role": "user", "plan": "premium"}
        return TestClient(app)
    return make


def test_K11_the_runtime_document_Add_keeps_is_stored_and_read_back_after_a_reload(client):
    body = BODY["body"]
    assert body["definition"]["compute"]["kind"] == "runtime"
    assert body["definition"]["compute"]["source"] == SOURCE, "the shared body is not the committed script"
    r = client().post("/api/user-definitions", json=body)
    assert r.status_code == 200, r.text
    did = r.json()["def_id"]
    fresh = client()                       # a reload: a new session reads what the store holds
    got = fresh.get(f"/api/user-definitions/{did}")
    assert got.status_code == 200, got.text
    d = got.json()["definition"]
    assert d["compute"]["kind"] == "runtime"
    assert d["compute"]["source"] == SOURCE
    assert d["compute"]["objects"] is True
    listed = [row["def_id"] for row in fresh.get("/api/user-definitions").json()["definitions"]]
    assert did in listed


def test_K12_past_the_runtime_cap_the_store_refuses_in_the_members_words(client):
    body = copy.deepcopy(BODY["body"])
    pad = rt.RUNTIME_MAX_DEFINITION_BYTES + 64
    body["definition"]["meta"]["description"] = "x" * pad
    r = client().post("/api/user-definitions", json=body)
    assert r.status_code == 400
    detail = r.json()["detail"]
    assert re.fullmatch(r"this indicator is too large to keep: as saved it would be \d+ bytes, and a saved indicator "
                        rf"may hold at most {rt.RUNTIME_MAX_DEFINITION_BYTES}\. Nothing was saved\.", detail), detail
    for internal in ("user_preferences", "names its caps", "definition exceeds"):
        assert internal not in detail, detail
    assert client().get("/api/user-definitions").json()["definitions"] == []
