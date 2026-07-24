"""Tests for GET /api/education/videos/{id}/audio — 302 redirect to a presigned
R2 URL for the desk background-audio track. Mirrors the router-test harness in
tests/test_earnings_table_router.py (standalone FastAPI app + router +
dependency_overrides), since api/routers/education.py defines its own
`require_paid` locally (not the shared auth_middleware dependency).

Serves by the deterministic R2 key (`desk_audio/<youtube_id>.m4a`) + an R2
existence check — NOT by gating on the stamped `audio_url` column — so a
one-time local backfill that uploads audio without stamping production's
`education.db` row still serves correctly."""
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


def test_audio_serves_via_deterministic_key_when_audio_url_null(monkeypatch):
    # Backfill-friendly path: audio_url was never stamped in prod's DB, but the
    # R2 object exists at the deterministic key — must still serve.
    monkeypatch.setattr(edu_router.svc, "get_video",
                         lambda vid: {"id": vid, "youtube_id": "abc", "audio_url": None})

    exists_calls = []
    presign_calls = []

    def _fake_object_exists(key):
        exists_calls.append(key)
        return True

    def _fake_presigned_get(key, expires=3600):
        presign_calls.append(key)
        return "https://r2.example/signed"

    monkeypatch.setattr(edu_router.data_sync, "object_exists", _fake_object_exists)
    monkeypatch.setattr(edu_router.data_sync, "presigned_get", _fake_presigned_get)

    c = _client()
    r = c.get("/api/education/videos/5/audio", follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"] == "https://r2.example/signed"
    assert exists_calls == ["desk_audio/abc.m4a"]
    assert presign_calls == ["desk_audio/abc.m4a"]


def test_audio_serves_via_stamped_audio_url_when_present(monkeypatch):
    # Fast path: audio_url already stamped (new-session extraction) — use it
    # directly rather than re-deriving the deterministic key.
    monkeypatch.setattr(edu_router.svc, "get_video",
                         lambda vid: {"id": vid, "youtube_id": "abc",
                                      "audio_url": "desk_audio/xyz.m4a"})

    exists_calls = []
    presign_calls = []
    monkeypatch.setattr(edu_router.data_sync, "object_exists",
                         lambda key: exists_calls.append(key) or True)
    monkeypatch.setattr(edu_router.data_sync, "presigned_get",
                         lambda key, expires=3600: presign_calls.append(key) or "https://r2.example/signed")

    c = _client()
    r = c.get("/api/education/videos/5/audio", follow_redirects=False)
    assert r.status_code == 302
    assert exists_calls == ["desk_audio/xyz.m4a"]
    assert presign_calls == ["desk_audio/xyz.m4a"]


def test_audio_404_when_object_does_not_exist(monkeypatch):
    monkeypatch.setattr(edu_router.svc, "get_video",
                         lambda vid: {"id": vid, "youtube_id": "abc", "audio_url": None})
    monkeypatch.setattr(edu_router.data_sync, "object_exists", lambda key: False)
    c = _client()
    r = c.get("/api/education/videos/5/audio")
    assert r.status_code == 404


def test_audio_404_when_presigned_unavailable(monkeypatch):
    monkeypatch.setattr(edu_router.svc, "get_video",
                         lambda vid: {"id": vid, "youtube_id": "abc",
                                      "audio_url": "desk_audio/abc.m4a"})
    monkeypatch.setattr(edu_router.data_sync, "object_exists", lambda key: True)
    monkeypatch.setattr(edu_router.data_sync, "presigned_get",
                         lambda key, expires=3600: None)
    c = _client()
    r = c.get("/api/education/videos/5/audio")
    assert r.status_code == 404


def test_audio_302_to_presigned(monkeypatch):
    monkeypatch.setattr(edu_router.svc, "get_video",
                         lambda vid: {"id": vid, "youtube_id": "abc",
                                      "audio_url": "desk_audio/abc.m4a"})
    monkeypatch.setattr(edu_router.data_sync, "object_exists", lambda key: True)
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
