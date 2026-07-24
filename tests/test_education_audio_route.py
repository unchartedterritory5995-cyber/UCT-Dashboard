"""Tests for GET /api/education/videos/{id}/audio — 302 redirect to a presigned
R2 URL for the desk background-audio track. Mirrors the router-test harness in
tests/test_earnings_table_router.py (standalone FastAPI app + router +
dependency_overrides), since api/routers/education.py defines its own
`require_paid` locally (not the shared auth_middleware dependency)."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.education as edu_router


def _client():
    app = FastAPI()
    app.include_router(edu_router.router)
    app.dependency_overrides[edu_router.require_paid] = lambda: {"id": "u1", "email": "t@t.dev"}
    return TestClient(app)


def test_requires_paid():
    # No override → require_paid runs for real (unauthenticated) → 401/402/403.
    app = FastAPI()
    app.include_router(edu_router.router)
    c = TestClient(app)
    r = c.get("/api/education/videos/5/audio")
    assert r.status_code in (401, 402, 403)


def test_audio_404_when_video_missing(monkeypatch):
    monkeypatch.setattr(edu_router.svc, "get_video", lambda vid: None)
    c = _client()
    r = c.get("/api/education/videos/5/audio")
    assert r.status_code == 404


def test_audio_404_when_no_audio(monkeypatch):
    monkeypatch.setattr(edu_router.svc, "get_video",
                         lambda vid: {"id": vid, "audio_url": None})
    c = _client()
    r = c.get("/api/education/videos/5/audio")
    assert r.status_code == 404


def test_audio_404_when_presigned_unavailable(monkeypatch):
    monkeypatch.setattr(edu_router.svc, "get_video",
                         lambda vid: {"id": vid, "audio_url": "desk_audio/abc.m4a"})
    monkeypatch.setattr(edu_router.data_sync, "presigned_get",
                         lambda key, expires=3600: None)
    c = _client()
    r = c.get("/api/education/videos/5/audio")
    assert r.status_code == 404


def test_audio_302_to_presigned(monkeypatch):
    monkeypatch.setattr(edu_router.svc, "get_video",
                         lambda vid: {"id": vid, "audio_url": "desk_audio/abc.m4a"})
    captured = {}

    def _fake_presigned_get(key, expires=3600):
        captured["key"] = key
        captured["expires"] = expires
        return "https://r2.example/signed"

    monkeypatch.setattr(edu_router.data_sync, "presigned_get", _fake_presigned_get)
    c = _client()
    r = c.get("/api/education/videos/5/audio", follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"] == "https://r2.example/signed"
    # 8-hour TTL — long enough that a screen-locked session doesn't 403 mid-play.
    assert captured["expires"] == 28800
