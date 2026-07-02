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
    # Zoom sends download_token at the TOP LEVEL of the event body (sibling of payload).
    body = {"event": "recording.completed",
            "download_token": "TOK",
            "payload": {"object": {
                "uuid": "U1", "topic": "Live Trading", "start_time": "2026-06-24T13:30:00Z",
                "recording_files": [{"file_type": "MP4", "download_url": "http://dl/1"}]}}}
    raw = json.dumps(body)
    r = client.post("/api/desk/zoom-webhook", content=raw,
                    headers={"x-zm-request-timestamp": "2", "x-zm-signature": _sig("2", raw),
                             "content-type": "application/json"})
    assert r.status_code == 200
    assert q.count_status("pending") == 1
    job = q.list_recent(1)[0]
    assert job["download_token"] == "TOK"       # captured from the top level
    assert job["download_url"] == "http://dl/1"

def test_recording_completed_picks_largest_mp4(client):
    # A stop/restart mid-webinar produces multiple MP4 segments; the tiny first
    # clip must not shadow the real recording (2026-07-01 ChartMaster workshop:
    # a 2-min 4MB stub was published instead of the 1:23:18 371MB session).
    body = {"event": "recording.completed",
            "download_token": "TOK",
            "payload": {"object": {
                "uuid": "U2", "topic": "Workshop", "start_time": "2026-07-01T23:00:54Z",
                "recording_files": [
                    {"file_type": "MP4", "download_url": "http://dl/stub", "file_size": 3_835_304},
                    {"file_type": "M4A", "download_url": "http://dl/audio", "file_size": 848_405},
                    {"file_type": "MP4", "download_url": "http://dl/full", "file_size": 389_478_669},
                ]}}}
    raw = json.dumps(body)
    r = client.post("/api/desk/zoom-webhook", content=raw,
                    headers={"x-zm-request-timestamp": "4", "x-zm-signature": _sig("4", raw),
                             "content-type": "application/json"})
    assert r.status_code == 200
    job = q.list_recent(1)[0]
    assert job["download_url"] == "http://dl/full"

def test_recording_completed_no_sizes_keeps_first_mp4(client):
    body = {"event": "recording.completed",
            "download_token": "TOK",
            "payload": {"object": {
                "uuid": "U3", "topic": "Live Trading", "start_time": "2026-06-24T13:30:00Z",
                "recording_files": [
                    {"file_type": "MP4", "download_url": "http://dl/a"},
                    {"file_type": "MP4", "download_url": "http://dl/b"},
                ]}}}
    raw = json.dumps(body)
    r = client.post("/api/desk/zoom-webhook", content=raw,
                    headers={"x-zm-request-timestamp": "5", "x-zm-signature": _sig("5", raw),
                             "content-type": "application/json"})
    assert r.status_code == 200
    job = q.list_recent(1)[0]
    assert job["download_url"] == "http://dl/a"

def test_bad_signature_rejected(client):
    raw = json.dumps({"event": "recording.completed", "payload": {}})
    r = client.post("/api/desk/zoom-webhook", content=raw,
                    headers={"x-zm-request-timestamp": "3", "x-zm-signature": "v0=bad",
                             "content-type": "application/json"})
    assert r.status_code == 401


# ── /insights-status ─────────────────────────────────────────────────────────────

def test_insights_status_401_without_bearer(client):
    r = client.get("/api/desk/insights-status")
    assert r.status_code == 401


def test_insights_status_401_wrong_bearer(client, monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "correct-secret")
    r = client.get("/api/desk/insights-status",
                   headers={"Authorization": "Bearer wrong-secret"})
    assert r.status_code == 401


def test_insights_status_happy_shape_with_stubbed_service(client, monkeypatch):
    from api.services import desk_session_insights, education_service
    monkeypatch.setenv("PUSH_SECRET", "ppp")
    monkeypatch.setattr(desk_session_insights, "get_insights_status", lambda: {
        "pending": [{"id": 1, "title": "Live Trading Session — July 1, 2026"}],
        "recent_passes": [{"ts": 111, "results": [], "errors": []}],
        "fail_streaks": {2: 3},
    })
    monkeypatch.setattr(education_service, "list_videos", lambda: [
        {"id": 5, "title": "V5", "meeting_uuid": "U5", "insights_at": 123,
         "zoom_cleaned": 1, "chapters": '[{"t":0,"title":"a"}]',
         "ticker_moments": '[{"ticker":"AAPL","t":0}]'},
        {"id": 6, "title": "V6 (not a session)", "meeting_uuid": "", "insights_at": None,
         "zoom_cleaned": 0, "chapters": None, "ticker_moments": None},
        {"id": 4, "title": "V4 corrupt json", "meeting_uuid": "U4", "insights_at": None,
         "zoom_cleaned": 0, "chapters": "not json", "ticker_moments": "[1,2"},
    ])

    r = client.get("/api/desk/insights-status", headers={"Authorization": "Bearer ppp"})
    assert r.status_code == 200
    data = r.json()
    assert data["pending"] == [{"id": 1, "title": "Live Trading Session — July 1, 2026"}]
    assert data["recent_passes"] == [{"ts": 111, "results": [], "errors": []}]
    assert data["fail_streaks"] == {"2": 3}  # JSON round-trips int keys as strings

    videos = data["recent_videos"]
    assert len(videos) == 2  # V6 excluded — no meeting_uuid
    assert videos[0]["id"] == 5  # newest (highest id) first
    assert videos[0]["chapters"] == 1
    assert videos[0]["tickers"] == 1
    assert videos[0]["zoom_cleaned"] is True
    v4 = next(v for v in videos if v["id"] == 4)
    assert v4["chapters"] == 0  # malformed JSON parsed defensively -> 0, no crash
    assert v4["tickers"] == 0
