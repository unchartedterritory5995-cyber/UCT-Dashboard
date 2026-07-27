"""Tests for Task 2: paths router endpoints on api/routers/education.py.

Fixture pattern copied from tests/test_education_router_taxonomy.py (standalone
FastAPI app + router + dependency_overrides, since api/routers/education.py
defines its own `require_paid` locally). Seeds via the `svc` tmp-DB fixture
(Task 1's education_service functions), asserts via the HTTP router layer.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.education as edu_router
from api.middleware.auth_middleware import require_admin, get_current_user


@pytest.fixture()
def svc(tmp_path, monkeypatch):
    from api.services import education_service as es
    monkeypatch.setattr(es, "_DB_PATH", str(tmp_path / "education.db"))
    es._init_db()
    return es


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(edu_router.router)
    return app


@pytest.fixture()
def client():
    """No overrides — every dependency (require_paid / require_admin /
    require_push_secret) runs for real, i.e. unauthenticated."""
    return TestClient(_app())


@pytest.fixture()
def paid_client():
    """Paid-but-NOT-admin — the auth tier that should fail every admin write
    with 403 (not 401). Overrides BOTH edu_router.require_paid (the
    router-local paid gate used by GET /paths) AND the shared
    get_current_user — require_admin depends directly on get_current_user
    (`Depends(get_current_user)`), which is NOT reached by overriding
    require_paid alone. Without this second override, get_current_user runs
    for REAL (no session cookie) and 401s before the role check ever
    executes, so every admin-write negative test below would actually be
    asserting "unauthenticated" rather than "authenticated paid-non-admin"."""
    app = _app()
    paid_non_admin = {"id": "u1", "email": "t@t.dev", "role": "member"}
    app.dependency_overrides[edu_router.require_paid] = lambda: paid_non_admin
    app.dependency_overrides[get_current_user] = lambda: paid_non_admin
    return TestClient(app)


@pytest.fixture()
def admin_client():
    app = _app()
    app.dependency_overrides[require_admin] = lambda: {"id": "a1", "role": "admin"}
    # require_paid is not overridden here on purpose for most tests below (admin
    # routes don't need it); tests that hit GET /paths through admin_client
    # override both explicitly where needed.
    return TestClient(app)


@pytest.fixture()
def push_client(monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "test-secret-123")
    c = TestClient(_app())
    c.headers.update({"Authorization": "Bearer test-secret-123"})
    return c


# ── GET /paths — paid, enabled-only ──────────────────────────────────────────

def test_get_paths_requires_paid(client):
    r = client.get("/api/education/paths")
    assert r.status_code in (401, 402, 403)


def test_get_paths_returns_enabled_only(paid_client, svc):
    svc.create_path({"slug": "on", "name": "On Path", "kind": "track", "enabled": True})
    svc.create_path({"slug": "off", "name": "Off Path", "kind": "track", "enabled": False})
    r = paid_client.get("/api/education/paths")
    assert r.status_code == 200
    slugs = [p["slug"] for p in r.json()["paths"]]
    assert slugs == ["on"]


def test_get_paths_includes_steps(paid_client, svc):
    p = svc.create_path({"slug": "foo", "name": "Foo", "kind": "track"})
    svc.replace_path_steps(p["id"], [{"youtube_id": "yt1", "module_label": "M1", "note": "n"}])
    r = paid_client.get("/api/education/paths")
    steps = r.json()["paths"][0]["steps"]
    assert steps == [{"youtube_id": "yt1", "module_label": "M1", "note": "n",
                      "start_seconds": None, "end_seconds": None}]


# ── POST /paths — admin ──────────────────────────────────────────────────────

def test_create_path_requires_admin(client, paid_client):
    body = {"slug": "new-track", "name": "New Track"}
    assert client.post("/api/education/paths", json=body).status_code in (401, 403)
    assert paid_client.post("/api/education/paths", json=body).status_code == 403


def test_create_path_happy_path(admin_client, svc):
    r = admin_client.post("/api/education/paths",
                          json={"slug": "risk-track", "name": "Risk & Sizing", "kind": "track"})
    assert r.status_code == 200
    body = r.json()
    assert body["slug"] == "risk-track" and body["name"] == "Risk & Sizing"
    assert svc.get_path(body["id"])["name"] == "Risk & Sizing"


def test_create_path_bad_slug_returns_400(admin_client):
    r = admin_client.post("/api/education/paths", json={"slug": "Not Kebab!", "name": "X"})
    assert r.status_code == 400


def test_create_path_duplicate_slug_returns_400(admin_client, svc):
    svc.create_path({"slug": "dup", "name": "Dup"})
    r = admin_client.post("/api/education/paths", json={"slug": "dup", "name": "Dup 2"})
    assert r.status_code == 400


# ── PATCH /paths/{id} — admin ────────────────────────────────────────────────

def test_patch_path_requires_admin(client, paid_client, svc):
    p = svc.create_path({"slug": "p1", "name": "P1"})
    body = {"name": "Renamed"}
    assert client.patch(f"/api/education/paths/{p['id']}", json=body).status_code in (401, 403)
    assert paid_client.patch(f"/api/education/paths/{p['id']}", json=body).status_code == 403


def test_patch_path_happy_path(admin_client, svc):
    p = svc.create_path({"slug": "p2", "name": "P2", "kind": "track"})
    r = admin_client.patch(f"/api/education/paths/{p['id']}", json={"name": "P2 Renamed"})
    assert r.status_code == 200
    assert r.json()["name"] == "P2 Renamed"
    # slug immutable, unaffected
    assert r.json()["slug"] == "p2"


def test_patch_path_missing_id_returns_404(admin_client, svc):
    r = admin_client.patch("/api/education/paths/999999", json={"name": "X"})
    assert r.status_code == 404


def test_patch_path_explicit_null_kind_returns_400(admin_client, svc):
    p = svc.create_path({"slug": "p3", "name": "P3"})
    r = admin_client.patch(f"/api/education/paths/{p['id']}", json={"kind": None})
    assert r.status_code == 400


def test_patch_path_explicit_null_sort_order_returns_400(admin_client, svc):
    p = svc.create_path({"slug": "p4", "name": "P4"})
    r = admin_client.patch(f"/api/education/paths/{p['id']}", json={"sort_order": None})
    assert r.status_code == 400


def test_patch_path_explicit_null_enabled_is_ignored(admin_client, svc):
    p = svc.create_path({"slug": "p5", "name": "P5", "enabled": True})
    r = admin_client.patch(f"/api/education/paths/{p['id']}", json={"enabled": None})
    assert r.status_code == 200
    assert r.json()["enabled"] == 1  # unchanged, not disabled


# ── DELETE /paths/{id} — admin ───────────────────────────────────────────────

def test_delete_path_requires_admin(client, paid_client, svc):
    p = svc.create_path({"slug": "d1", "name": "D1"})
    assert client.delete(f"/api/education/paths/{p['id']}").status_code in (401, 403)
    assert paid_client.delete(f"/api/education/paths/{p['id']}").status_code == 403


def test_delete_path_happy_path(admin_client, svc):
    p = svc.create_path({"slug": "d2", "name": "D2"})
    r = admin_client.delete(f"/api/education/paths/{p['id']}")
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert svc.get_path(p["id"]) is None


def test_delete_path_missing_id_returns_404(admin_client, svc):
    r = admin_client.delete("/api/education/paths/999999")
    assert r.status_code == 404


# ── PUT /paths/{id}/steps — admin ────────────────────────────────────────────

def test_put_steps_requires_admin(client, paid_client, svc):
    p = svc.create_path({"slug": "s1", "name": "S1"})
    body = {"steps": [{"youtube_id": "yt1"}]}
    assert client.put(f"/api/education/paths/{p['id']}/steps", json=body).status_code in (401, 403)
    assert paid_client.put(f"/api/education/paths/{p['id']}/steps", json=body).status_code == 403


def test_put_steps_happy_path(admin_client, svc):
    p = svc.create_path({"slug": "s2", "name": "S2"})
    body = {"steps": [
        {"youtube_id": "yt1", "module_label": "M1", "note": "first"},
        {"youtube_id": "yt2"},
    ]}
    r = admin_client.put(f"/api/education/paths/{p['id']}/steps", json=body)
    assert r.status_code == 200 and r.json() == {"steps": 2}
    assert [s["youtube_id"] for s in svc.get_path(p["id"])["steps"]] == ["yt1", "yt2"]


def test_put_steps_missing_id_returns_404(admin_client, svc):
    r = admin_client.put("/api/education/paths/999999/steps", json={"steps": []})
    assert r.status_code == 404


def test_put_steps_missing_youtube_id_returns_400(admin_client, svc):
    p = svc.create_path({"slug": "s3", "name": "S3"})
    r = admin_client.put(f"/api/education/paths/{p['id']}/steps",
                         json={"steps": [{"youtube_id": ""}]})
    assert r.status_code == 400
    # existing steps untouched (none existed — assert nothing was written)
    assert svc.get_path(p["id"])["steps"] == []


def test_put_steps_carries_start_end_seconds_through(admin_client, paid_client, svc):
    """The clip-window fields round-trip: PUT → service → member-facing GET."""
    p = svc.create_path({"slug": "clip", "name": "Clip", "enabled": True})
    r = admin_client.put(f"/api/education/paths/{p['id']}/steps", json={"steps": [
        {"youtube_id": "yt1", "start_seconds": 1340, "end_seconds": 2465},
        {"youtube_id": "yt2"},
    ]})
    assert r.status_code == 200 and r.json() == {"steps": 2}
    got = paid_client.get("/api/education/paths").json()["paths"][0]["steps"]
    assert got[0]["start_seconds"] == 1340 and got[0]["end_seconds"] == 2465
    assert got[1]["start_seconds"] is None and got[1]["end_seconds"] is None


def test_put_steps_end_not_after_start_returns_400(admin_client, svc):
    p = svc.create_path({"slug": "clip2", "name": "Clip 2"})
    r = admin_client.put(f"/api/education/paths/{p['id']}/steps", json={"steps": [
        {"youtube_id": "yt1", "start_seconds": 100, "end_seconds": 100},
    ]})
    assert r.status_code == 400
    assert svc.get_path(p["id"])["steps"] == []  # nothing landed


def test_put_steps_negative_start_returns_400(admin_client, svc):
    p = svc.create_path({"slug": "clip3", "name": "Clip 3"})
    r = admin_client.put(f"/api/education/paths/{p['id']}/steps", json={"steps": [
        {"youtube_id": "yt1", "start_seconds": -4},
    ]})
    assert r.status_code == 400


def test_put_steps_non_integer_start_returns_422(admin_client, svc):
    # Pydantic owns the type gate — a non-numeric string never reaches the service.
    p = svc.create_path({"slug": "clip4", "name": "Clip 4"})
    r = admin_client.put(f"/api/education/paths/{p['id']}/steps", json={"steps": [
        {"youtube_id": "yt1", "start_seconds": "not-a-number"},
    ]})
    assert r.status_code == 422


# ── POST /paths-apply — PUSH_SECRET ──────────────────────────────────────────

def test_paths_apply_requires_push_secret(client, monkeypatch):
    monkeypatch.delenv("PUSH_SECRET", raising=False)
    r = client.post("/api/education/paths-apply", json={"paths": []})
    assert r.status_code in (401, 403)


def test_paths_apply_admin_alone_is_not_sufficient(admin_client):
    r = admin_client.post("/api/education/paths-apply", json={"paths": []})
    assert r.status_code in (401, 403)


def test_paths_apply_happy_path(push_client, svc):
    r = push_client.post("/api/education/paths-apply", json={"paths": [
        {"slug": "applied-track", "name": "Applied Track", "kind": "track",
         "steps": [{"youtube_id": "yt1"}, {"youtube_id": "yt2", "module_label": "M1"}]},
    ]})
    assert r.status_code == 200
    assert r.json() == {"paths": 1, "steps": 2}
    row = svc.list_paths()[0]
    assert row["slug"] == "applied-track" and len(row["steps"]) == 2


def test_paths_apply_is_transactional_via_router(push_client, svc):
    """A bad entry anywhere in the batch rolls back the WHOLE apply — verified
    at the router layer (not just the service layer in Task 1's tests)."""
    r = push_client.post("/api/education/paths-apply", json={"paths": [
        {"slug": "good-one", "name": "Good One", "kind": "track", "steps": []},
        {"slug": "Not Kebab!", "name": "Bad", "kind": "track", "steps": []},
    ]})
    assert r.status_code == 400
    assert svc.list_paths(include_disabled=True) == []


def test_paths_apply_carries_start_end_seconds(push_client, svc):
    r = push_client.post("/api/education/paths-apply", json={"paths": [
        {"slug": "clipped", "name": "Clipped", "kind": "track",
         "steps": [{"youtube_id": "yt1", "start_seconds": 90, "end_seconds": 300}]},
    ]})
    assert r.status_code == 200
    step = svc.list_paths()[0]["steps"][0]
    assert step["start_seconds"] == 90 and step["end_seconds"] == 300


def test_paths_apply_upserts_by_slug(push_client, svc):
    svc.create_path({"slug": "existing", "name": "Old Name", "kind": "track"})
    r = push_client.post("/api/education/paths-apply", json={"paths": [
        {"slug": "existing", "name": "New Name", "kind": "track", "steps": []},
    ]})
    assert r.status_code == 200
    paths = svc.list_paths(include_disabled=True)
    assert len(paths) == 1 and paths[0]["name"] == "New Name"
