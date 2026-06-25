import hashlib, hmac, json, os, tempfile
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from api.routers import desk_zoom_webhook as wh
from api.services import desk_session_jobs as q

SECRET = "shh"

@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ZOOM_WEBHOOK_SECRET_TOKEN", SECRET)
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(q, "_DB_PATH", os.path.join(d, "jobs.db")); q._init_db()
        app = FastAPI(); app.include_router(wh.router)
        yield TestClient(app)

def _sig(ts, body):
    msg = f"v0:{ts}:{body}".encode()
    return "v0=" + hmac.new(SECRET.encode(), msg, hashlib.sha256).hexdigest()

def test_url_validation_returns_encrypted_token(client):
    body = {"event": "endpoint.url_validation", "payload": {"plainToken": "abc"}}
    raw = json.dumps(body)
    r = client.post("/api/desk/zoom-webhook", content=raw,
                    headers={"x-zm-request-timestamp": "1", "x-zm-signature": _sig("1", raw),
                             "content-type": "application/json"})
    assert r.status_code == 200
    expect = hmac.new(SECRET.encode(), b"abc", hashlib.sha256).hexdigest()
    assert r.json() == {"plainToken": "abc", "encryptedToken": expect}

def test_recording_completed_enqueues(client):
    body = {"event": "recording.completed", "payload": {"object": {
        "uuid": "U1", "topic": "Live Trading", "start_time": "2026-06-24T13:30:00Z",
        "recording_files": [{"file_type": "MP4", "download_url": "http://dl/1"}]},
        "download_token": "TOK"}}
    raw = json.dumps(body)
    r = client.post("/api/desk/zoom-webhook", content=raw,
                    headers={"x-zm-request-timestamp": "2", "x-zm-signature": _sig("2", raw),
                             "content-type": "application/json"})
    assert r.status_code == 200
    assert q.count_status("pending") == 1

def test_bad_signature_rejected(client):
    raw = json.dumps({"event": "recording.completed", "payload": {}})
    r = client.post("/api/desk/zoom-webhook", content=raw,
                    headers={"x-zm-request-timestamp": "3", "x-zm-signature": "v0=bad",
                             "content-type": "application/json"})
    assert r.status_code == 401
