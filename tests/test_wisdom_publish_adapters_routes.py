"""Adapter routes on the REAL app (api.main:app) — adapters/routes.py.

MOUNT. The registry mounts only `api/routers/wisdom_publish.py` (stream S-F1), which must
include these routers. Until S-F1's code is in the tree, the module fixture mounts them onto
the real app exactly as that file will (relative prefixes under the package prefixes) and
removes them afterwards; once S-F1 lands, the fixture uses the real mount and
`test_s_f1_mounts_the_adapter_routers_once_integrated` fails by name if it is missing.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. an admin route reachable anonymously (401) or by a member (403).
2. a draft decision allowed to a second admin, a member or an anonymous caller; an approval
   that publishes while the flag is off.
3. a machine route answering without the PUSH_SECRET bearer, with a wrong one, with a blank
   secret configured, or with a 500 on a non-ASCII header.
4. transcript text or a private level in the clip export or the KB export.
5. a mutating admin route the boot auth-surface audit would report ungated.
"""
from __future__ import annotations

import importlib.util
import json
from datetime import datetime

import pytest
from fastapi import APIRouter, FastAPI

from api.services.wisdom.core import store, timeutil
from api.services.wisdom.publish.adapters import clips, modelbook, routes
from tests.test_wisdom_publish_adapters_store import adapters_db, seeded  # noqa: F401

SECOND_ADMIN = {"id": "admin2-test", "email": "second@example.test", "role": "admin"}
ADMIN_PATHS = ("/api/admin/wisdom/publish/adapters/status", "/api/admin/wisdom/publish/adapters/badges?tickers=NVDA",
               "/api/admin/wisdom/publish/adapters/drafts", "/api/admin/wisdom/publish/adapters/d20")


def _parents():
    admin = APIRouter(prefix="/api/admin/wisdom/publish")
    admin.include_router(routes.router)
    internal = APIRouter(prefix="/api/internal/wisdom/publish")
    internal.include_router(routes.internal_router)
    return admin, internal


@pytest.fixture(scope="module")
def real_app():
    from api.main import app

    owner_mounted = "/api/admin/wisdom/publish/adapters/status" in {getattr(r, "path", "") for r in app.routes}
    added: list = []
    if not owner_mounted:
        before = list(app.router.routes)
        for parent in _parents():
            app.include_router(parent)
        added = [r for r in app.router.routes if all(r is not b for b in before)]
        app.router.routes[:] = added + before  # ahead of any SPA catch-all: first match wins
    yield app, owner_mounted
    for r in added:
        app.router.routes.remove(r)


@pytest.fixture
def client(real_app):
    from fastapi.testclient import TestClient

    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan

    app, _ = real_app
    for dep in (get_current_user, get_current_user_with_plan):
        app.dependency_overrides.pop(dep, None)
    return TestClient(app, raise_server_exceptions=False)


def test_s_f1_mounts_the_adapter_routers_once_integrated(real_app):
    if importlib.util.find_spec("api.services.wisdom.publish.review") is None:
        pytest.skip("S-F1 (publish/review.py) is not in this tree yet; mounting is integration work")
    assert real_app[1], ("api/routers/wisdom_publish.py must include adapters.routes.router and an internal_router "
                         "including adapters.routes.internal_router")


def test_admin_routes_answer_401_403_200(seeded, real_app, client, monkeypatch):
    from tests.authclients import ADMIN, FREE_MEMBER, signed_in_as

    app, _ = real_app
    monkeypatch.delenv("WISDOM_BADGES_ENABLED", raising=False)
    # ⛔⛔ `badges_for` anchors its "last WISDOM_BADGES_LOOKBACK_DAYS days" window to the REAL
    # wall clock (`timeutil.now_et()`) whenever it isn't given an explicit `now` -- and this test
    # drives the badges route over real HTTP, which has no way to pass one through. Every OTHER
    # caller of `badges_for` in this test suite (test_wisdom_publish_adapters_consumers.py etc.)
    # passes `now=` explicitly for exactly this reason. The seed fixture's records are dated
    # 2026-09-06/08 (`T0` in test_wisdom_publish_adapters_store.py); this test silently went from
    # green to a false "no records" failure the moment real time crossed 2026-09-18 (T0 + the
    # default 10-day lookback) -- caught here, not by anything that ran this test in the interim.
    # Pinning `now_et` reproduces the "pass now=" pattern for the one caller that can't do it
    # directly, so this test can never again rot with the calendar.
    monkeypatch.setattr(timeutil, "now_et", lambda: datetime(2026, 9, 10, 12, 0, tzinfo=timeutil.ET))
    for path in ADMIN_PATHS:
        assert client.get(path).status_code == 401, path
    with signed_in_as(FREE_MEMBER, app):
        for path in ADMIN_PATHS:
            assert client.get(path).status_code == 403, path
    with signed_in_as(ADMIN, app):
        for path in ADMIN_PATHS:
            assert client.get(path).status_code == 200, path
        assert client.get("/api/admin/wisdom/publish/adapters/badges?tickers=NVDA").json() == {}
        preview = client.get("/api/admin/wisdom/publish/adapters/badges?tickers=NVDA,AMD&preview=true").json()
        assert set(preview) == {"NVDA"} and preview["NVDA"]["preview"] is True
        d20 = client.get("/api/admin/wisdom/publish/adapters/d20").json()
        assert d20["level_alerts"]["allowed"] is False and d20["lookalike"]["allowed"] is False


def test_draft_decisions_are_owner_only_and_flag_gated(seeded, real_app, client, monkeypatch):
    from tests.authclients import ADMIN, FREE_MEMBER, signed_in_as

    app, _ = real_app
    monkeypatch.setenv("ADMIN_EMAILS", f"{ADMIN['email']},{SECOND_ADMIN['email']}")
    monkeypatch.setenv("WISDOM_MODELBOOK_DRAFTS_ENABLED", "1")
    modelbook.daily(type("Ctx", (), {"dry_run": False, "log": staticmethod(lambda m: None)})())
    with store.read() as conn:
        draft_id = conn.execute("SELECT draft_id FROM wisdom_drafts WHERE kind = 'modelbook_example'").fetchone()[0]
    approve = f"/api/admin/wisdom/publish/adapters/drafts/{draft_id}/approve"
    assert client.post(approve).status_code == 401
    with signed_in_as(FREE_MEMBER, app):
        assert client.post(approve).status_code == 403
    with signed_in_as(SECOND_ADMIN, app):
        assert client.post(approve).status_code == 403
    monkeypatch.delenv("WISDOM_MODELBOOK_DRAFTS_ENABLED")
    with signed_in_as(ADMIN, app):
        refused = client.post(approve)
        assert refused.status_code == 409 and "nothing was published" in refused.json()["detail"]
        listed = client.get("/api/admin/wisdom/publish/adapters/drafts?kind=modelbook_example").json()
        assert listed["count"] == 1 and listed["drafts"][0]["status"] == "draft"
        assert client.post("/api/admin/wisdom/publish/adapters/drafts/unknown/reject").status_code == 404
        rejected = client.post(f"/api/admin/wisdom/publish/adapters/drafts/{draft_id}/reject?note=not+yet")
        assert rejected.status_code == 200 and rejected.json()["status"] == "rejected"


def test_machine_routes_need_the_push_secret(seeded, real_app, client, monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "wisdom-test-secret")
    paths = ("/api/internal/wisdom/publish/adapters/kb-export",
             "/api/internal/wisdom/publish/adapters/clip-candidates?video_id=42")
    good = {"Authorization": "Bearer wisdom-test-secret"}
    for path in paths:
        assert client.get(path).status_code == 401, path
        assert client.get(path, headers={"Authorization": "Bearer nope"}).status_code == 401, path
        assert client.get(path, headers={"Authorization": "Bearer wisdom-tést".encode("latin-1")}).status_code == 401
        assert client.get(path, headers=good).status_code == 200, path
    export = client.get(paths[0], headers=good).json()
    assert export["enabled"] is False and export["rows"] == []
    body = client.get(paths[1], headers=good).json()
    assert body["youtube_id"] == "ytLIVE42" and body["records"]
    assert all(set(r) <= set(clips.RECORD_KEYS) for r in body["records"])
    text = json.dumps(body)
    for forbidden in ("Synthetic", "flat base on the daily", "131.5", "140.25", "142.75", "160.0", "attendee"):
        assert forbidden not in text, forbidden
    items = {"items": [{"tab": "attribution", "subject_ref": "engine_kb:x", "summary": "3 stale rows"}]}
    push = "/api/internal/wisdom/publish/adapters/review-items"
    assert client.post(push, json=items).status_code == 401
    assert client.post(push, json=items, headers=good).json() == {"inserted": 1, "already_queued": 0}
    assert client.post(push, json={"items": [{"tab": "golden", "subject_ref": "x", "summary": "y"}]},
                       headers=good).status_code == 422
    monkeypatch.setenv("PUSH_SECRET", "")
    assert client.get(paths[0], headers={"Authorization": "Bearer "}).status_code == 401


def test_the_boot_auth_surface_audit_sees_every_mutating_route_gated():
    from api import auth_surface_check

    app = FastAPI()
    for parent in _parents():
        app.include_router(parent)
    assert auth_surface_check.audit_routes(app)["ok"] is True
    # control: the same audit does flag an ungated mutating route under the same prefix
    leak = APIRouter(prefix="/api/admin/wisdom/publish/adapters")

    @leak.post("/leak")
    def _leak() -> dict:
        return {}

    app.include_router(leak)
    assert auth_surface_check.audit_routes(app)["ok"] is False
