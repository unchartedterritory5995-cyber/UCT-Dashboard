"""Voice router — auth gate, plan gate, /tts streaming, /settings, /usage."""

from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.services.auth_db import init_db
from api.services.auth_service import create_user, create_session
from api.services import voice_audio_cache as vac


@pytest.fixture
def client():
    init_db()
    return TestClient(app)


def _login(client, plan="pro", role="member"):
    user = create_user(f"vroute_{__import__('uuid').uuid4()}@example.com", "password123")
    # Force plan + role for test
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        conn.execute("UPDATE users SET role = ? WHERE id = ?", (role, user["id"]))
        conn.execute(
            "INSERT INTO subscriptions (id, user_id, plan, status) VALUES (?, ?, ?, 'active')",
            (__import__('uuid').uuid4().hex, user["id"], plan),
        )
        conn.commit()
    finally:
        conn.close()
    token = create_session(user["id"])
    client.cookies.set("uct_session", token)
    return user["id"]


def test_tts_requires_auth(client):
    r = client.post("/api/voice/tts", json={"text": "hi"})
    assert r.status_code == 401


def test_tts_requires_paid_plan(client):
    _login(client, plan="free")
    r = client.post("/api/voice/tts", json={"text": "hi"})
    assert r.status_code == 402


def test_tts_returns_mp3_for_paid_user(client, tmp_path, monkeypatch):
    monkeypatch.setattr(vac, "_CACHE_DIR", str(tmp_path))
    _login(client, plan="pro")
    fake_audio = b"\xFF\xFB\x90\x00FAKEMP3"
    with patch("api.routers.voice.synthesize_speech", return_value=fake_audio):
        r = client.post("/api/voice/tts", json={"text": "hello world"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("audio/mpeg")
    assert r.content == fake_audio


def test_tts_serves_from_cache_on_second_call(client, tmp_path, monkeypatch):
    monkeypatch.setattr(vac, "_CACHE_DIR", str(tmp_path))
    _login(client, plan="pro")
    fake_audio = b"\xFF\xFB\x90\x00CACHED"
    with patch("api.routers.voice.synthesize_speech", return_value=fake_audio) as m:
        r1 = client.post("/api/voice/tts", json={"text": "same text"})
        r2 = client.post("/api/voice/tts", json={"text": "same text"})
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.content == r2.content == fake_audio
    assert m.call_count == 1  # second call hit cache


def test_tts_rejects_empty_text(client):
    _login(client, plan="pro")
    r = client.post("/api/voice/tts", json={"text": ""})
    assert r.status_code == 400
