"""Tests for Task 2: grouped /videos payload, taxonomy-apply, and category admin
ops on api/routers/education.py.

Harness mirrors tests/test_education_audio_route.py (standalone FastAPI app +
router + dependency_overrides, since api/routers/education.py defines its own
`require_paid` locally rather than using the shared auth_middleware dependency)
and reuses the `svc` tmp-DB fixture pattern from tests/test_education_taxonomy.py
(Task 1's service-level tests for the same DB).
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.education as edu_router
from api.middleware.auth_middleware import require_admin


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
    app = _app()
    app.dependency_overrides[edu_router.require_paid] = lambda: {"id": "u1", "email": "t@t.dev"}
    return TestClient(app)


@pytest.fixture()
def admin_client():
    app = _app()
    app.dependency_overrides[require_admin] = lambda: {"id": "a1", "role": "admin"}
    return TestClient(app)


@pytest.fixture()
def push_client(monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "test-secret-123")
    c = TestClient(_app())
    c.headers.update({"Authorization": "Bearer test-secret-123"})
    return c


# ── GET /videos — grouped payload ────────────────────────────────────────────

def test_videos_payload_carries_kind_and_sort_order(paid_client, svc):
    svc.upsert_category("Live Trading Sessions", kind="show")
    svc.create_video({"youtube_id": "yt1", "title": "S", "category": "Live Trading Sessions"})
    body = paid_client.get("/api/education/videos").json()
    cat = body["categories"][0]
    assert cat["kind"] == "show" and "sort_order" in cat and cat["videos"][0]["tags"] == []
    # additive-only: name/videos keys unchanged from the pre-taxonomy shape
    assert cat["name"] == "Live Trading Sessions"
    assert body["total"] == 1


def test_videos_requires_paid(client):
    r = client.get("/api/education/videos")
    assert r.status_code in (401, 402, 403)


# ── POST /taxonomy-apply — PUSH_SECRET ───────────────────────────────────────

def test_taxonomy_apply_requires_push_secret(client, monkeypatch):
    monkeypatch.delenv("PUSH_SECRET", raising=False)
    r = client.post("/api/education/taxonomy-apply", json={"categories": [], "assignments": []})
    assert r.status_code in (401, 403)


def test_taxonomy_apply_applies(push_client, svc):
    v = svc.create_video({"youtube_id": "yt2", "title": "A", "category": "General"})
    r = push_client.post("/api/education/taxonomy-apply", json={
        "categories": [{"name": "Options & Flow", "kind": "library", "sort_order": 0}],
        "assignments": [{"id": v["id"], "category": "Options & Flow", "tags": ["options"]}]})
    assert r.status_code == 200 and r.json()["videos"] == 1
    assert svc.get_video(v["id"])["category"] == "Options & Flow"


def test_taxonomy_apply_bad_category_returns_400(push_client, svc):
    r = push_client.post("/api/education/taxonomy-apply", json={
        "categories": [{"name": "Bad Cat", "kind": "bogus"}],
        "assignments": []})
    assert r.status_code == 400


# ── POST /categories/rename — admin ──────────────────────────────────────────

def test_rename_is_admin_only(paid_client):
    r = paid_client.post("/api/education/categories/rename",
                         json={"from_name": "A", "to_name": "B"})
    assert r.status_code in (401, 403)


def test_rename_moves_rows(admin_client, svc):
    svc.create_video({"youtube_id": "yt3", "title": "X", "category": "Live Sessions"})
    r = admin_client.post("/api/education/categories/rename",
                          json={"from_name": "Live Sessions", "to_name": "Live Trading Sessions"})
    assert r.status_code == 200 and r.json()["moved"] == 1
    assert svc.get_video_by_youtube_id("yt3")["category"] == "Live Trading Sessions"


def test_rename_same_name_returns_400(admin_client):
    r = admin_client.post("/api/education/categories/rename",
                          json={"from_name": "Same", "to_name": "Same"})
    assert r.status_code == 400


# ── PATCH /categories/{name} — admin ─────────────────────────────────────────

def test_patch_category_meta_is_admin_only(paid_client):
    r = paid_client.patch("/api/education/categories/Interviews", json={"blurb": "Guests"})
    assert r.status_code in (401, 403)


def test_patch_category_meta(admin_client, svc):
    svc.upsert_category("Interviews")
    r = admin_client.patch("/api/education/categories/Interviews", json={"blurb": "Guests"})
    assert r.status_code == 200 and r.json()["blurb"] == "Guests"


# ── Route-order sanity: literal /categories/rename must not be shadowed by
#    the parameterized PATCH /categories/{name}, and the pre-existing plain
#    GET /categories list route must keep working. ───────────────────────────

def test_get_categories_still_works_alongside_new_routes(paid_client, svc):
    svc.create_video({"youtube_id": "yt4", "title": "Y", "category": "Charting"})
    r = paid_client.get("/api/education/categories")
    assert r.status_code == 200
    assert r.json()["categories"] == ["Charting"]


def test_rename_route_not_shadowed_by_patch_category(admin_client, svc):
    svc.create_video({"youtube_id": "yt5", "title": "Z", "category": "Old Name"})
    r = admin_client.post("/api/education/categories/rename",
                          json={"from_name": "Old Name", "to_name": "New Name"})
    assert r.status_code == 200
    assert r.json() == {"moved": 1}
