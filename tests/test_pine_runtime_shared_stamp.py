"""Phase 3 WS-H, arming item S4 (2026-10-31): `GET /shared/{token}` stamps a
runtime-lane document with its kill and allowlist state, as every other serving
path does (`runtime_definitions.stamp_served`).

Before: the share preview returned the stored document unstamped, so a killed
or ungraded script's link previewed as if it were servable. The stored row is
never rewritten; the stamp is a property of the served copy.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import user_definitions as router_mod
from api.services import runtime_definitions as rt
from api.services import user_definition_relint as rl
from api.services import user_definitions as svc

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "runtime_documents" / "documents.json"
DOCS = {d["slug"]: d for d in json.loads(FIXTURE.read_text(encoding="utf-8"))["documents"]}
ADX = DOCS["adx-and-di-for-v4"]["definition"]
DELTA = DOCS["delta-rsi-oscillator-strategy"]["definition"]
AUTHOR = "u-share-author"
VIEWER = "u-share-viewer"


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for k in (rt.STAGE_ENV, rt.SAVE_ENV, rt.KILL_ENV, rt.ALLOW_ENV):
        monkeypatch.delenv(k, raising=False)
    rl._NOTICE_CACHE.clear()
    yield
    rl._NOTICE_CACHE.clear()


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    from api.services import indicator_alert_service as ias
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    return tmp_path


def _viewer() -> TestClient:
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": VIEWER, "role": "member", "plan": "premium"}
    return TestClient(app)


def _shared(monkeypatch, definition, allow=None) -> str:
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.STAGE_ENV, "all")
    if allow:
        monkeypatch.setenv(rt.ALLOW_ENV, allow)
    svc.save(AUTHOR, definition["id"], copy.deepcopy(definition))
    minted = svc.share(AUTHOR, definition["id"])
    assert minted and minted["token"].startswith("sh_")
    return minted["token"]


def _preview(token: str) -> dict:
    got = _viewer().get(f"/api/user-definitions/shared/{token}")
    assert got.status_code == 200, got.text
    return got.json()


def test_S4_a_graded_live_script_previews_UNSTAMPED_and_whole(store, monkeypatch):
    """The control: the stamp is not added to everything."""
    token = _shared(monkeypatch, ADX)
    body = _preview(token)
    meta = body["definition"].get("meta") or {}
    assert "runtimeKilled" not in meta and "runtimeNotGraded" not in meta
    assert body["definition"] == svc.get(AUTHOR, ADX["id"])["definition"]
    assert body["origin_def_id"] == ADX["id"]
    assert set(body) >= {"definition", "author_id", "origin_def_id", "origin_version",
                         "origin_ast_hash", "table_version"}


def test_S4_a_script_KILLED_by_source_hash_previews_stamped(store, monkeypatch):
    token = _shared(monkeypatch, ADX)
    stored = svc.get(AUTHOR, ADX["id"])["definition"]
    monkeypatch.setenv(rt.KILL_ENV, ADX["meta"]["runtimeSourceHash"][:16])
    body = _preview(token)
    assert "kill list" in body["definition"]["meta"]["runtimeKilled"]
    assert svc.get(AUTHOR, ADX["id"])["definition"] == stored        # nothing rewritten


def test_S4_a_script_KILLED_by_its_ORIGIN_definition_id_previews_stamped(store, monkeypatch):
    token = _shared(monkeypatch, ADX)
    monkeypatch.setenv(rt.KILL_ENV, ADX["id"])
    body = _preview(token)
    assert ADX["id"] in body["definition"]["meta"]["runtimeKilled"]


def test_S4_a_script_no_longer_on_the_allowlist_previews_stamped_NOT_GRADED(store, monkeypatch):
    token = _shared(monkeypatch, DELTA, allow=DELTA["meta"]["runtimeSourceHash"])
    monkeypatch.delenv(rt.ALLOW_ENV)                                   # graded no longer
    body = _preview(token)
    assert "not yet been graded" in body["definition"]["meta"]["runtimeNotGraded"]
    monkeypatch.setenv(rt.ALLOW_ENV, DELTA["meta"]["runtimeSourceHash"])
    back = _preview(token)
    assert "runtimeNotGraded" not in (back["definition"].get("meta") or {})
