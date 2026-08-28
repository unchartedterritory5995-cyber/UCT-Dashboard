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


# ── /session-requeue ─────────────────────────────────────────────────────────────

def _skipped_test_job():
    q.enqueue("Uskip", "TEST", "2026-08-19T01:00:09Z", "http://dl", "tok")
    q.claim_next(); q.mark_skipped("Uskip", "test recording: TEST")

def test_session_requeue_401_without_bearer(client):
    r = client.post("/api/desk/session-requeue", json={"meeting_uuid": "x"})
    assert r.status_code == 401

def test_session_requeue_happy_path_corrects_topic(client, monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "ppp")
    _skipped_test_job()
    r = client.post("/api/desk/session-requeue",
                    json={"meeting_uuid": "Uskip", "topic": "Evening Update"},
                    headers={"Authorization": "Bearer ppp"})
    assert r.status_code == 200
    assert r.json()["requeued"] is True
    assert r.json()["job"]["topic"] == "Evening Update"
    assert q.count_status("pending") == 1

def test_session_requeue_refuses_a_topic_the_processor_would_reskip(client, monkeypatch):
    # Requeueing without fixing the topic would silently skip again on the next
    # drain — refuse it up front, with the reason.
    monkeypatch.setenv("PUSH_SECRET", "ppp")
    _skipped_test_job()
    r = client.post("/api/desk/session-requeue", json={"meeting_uuid": "Uskip"},
                    headers={"Authorization": "Bearer ppp"})
    assert r.status_code == 400
    assert "skip rule" in r.json()["error"]
    assert q.count_status("skipped") == 1     # untouched

def test_session_requeue_404_on_unknown_uuid(client, monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "ppp")
    r = client.post("/api/desk/session-requeue", json={"meeting_uuid": "ghost"},
                    headers={"Authorization": "Bearer ppp"})
    assert r.status_code == 404

def test_session_requeue_409_on_a_done_job(client, monkeypatch):
    # A published job must never be re-run through the pipeline from here.
    monkeypatch.setenv("PUSH_SECRET", "ppp")
    q.enqueue("Udone", "Evening Update", "s", "http://dl", "tok")
    q.claim_next(); q.mark_done("Udone", "VID")
    r = client.post("/api/desk/session-requeue", json={"meeting_uuid": "Udone"},
                    headers={"Authorization": "Bearer ppp"})
    assert r.status_code == 409
    assert q.count_status("done") == 1


# ── /session-cancel ──────────────────────────────────────────────────────────────

def test_session_cancel_401_without_bearer(client):
    r = client.post("/api/desk/session-cancel", json={"meeting_uuid": "x"})
    assert r.status_code == 401

def test_session_cancel_stops_a_pending_take_from_ever_publishing(client, monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "ppp")
    q.enqueue("Ubad", "SUNDAY SCANS", "2026-08-23T02:00:00Z", "http://dl", "tok")
    r = client.post("/api/desk/session-cancel",
                    json={"meeting_uuid": "Ubad", "reason": "bad take, re-recorded"},
                    headers={"Authorization": "Bearer ppp"})
    assert r.status_code == 200 and r.json()["cancelled"] is True
    assert r.json()["job"]["status"] == "skipped"
    # the ARTIFACT: the drain cannot claim it
    assert q.claim_next() is None

def test_session_cancel_leaves_a_second_pending_take_publishable(client, monkeypatch):
    """The whole point: kill ONE take, not the queue. A blanket stop would also
    lose the good re-record."""
    monkeypatch.setenv("PUSH_SECRET", "ppp")
    q.enqueue("Ubad", "SUNDAY SCANS", "2026-08-23T02:00:00Z", "http://dl", "tok")
    q.enqueue("Ugood", "SUNDAY SCANS", "2026-08-23T02:40:00Z", "http://dl2", "tok2")
    r = client.post("/api/desk/session-cancel", json={"meeting_uuid": "Ubad"},
                    headers={"Authorization": "Bearer ppp"})
    assert r.status_code == 200
    claimed = q.claim_next()
    assert claimed is not None and claimed["meeting_uuid"] == "Ugood"
    assert q.claim_next() is None

def test_session_cancel_404_on_unknown_uuid(client, monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "ppp")
    r = client.post("/api/desk/session-cancel", json={"meeting_uuid": "ghost"},
                    headers={"Authorization": "Bearer ppp"})
    assert r.status_code == 404

def test_session_cancel_409_on_a_done_job_names_the_published_video(client, monkeypatch):
    """Publishing is one-way — a cancel that implied it recalled a public video
    would be a lie. Name the id so the operator knows what to remove by hand."""
    monkeypatch.setenv("PUSH_SECRET", "ppp")
    q.enqueue("Udone", "SUNDAY SCANS", "s", "http://dl", "tok")
    q.claim_next(); q.mark_done("Udone", "VIDPUB")
    r = client.post("/api/desk/session-cancel", json={"meeting_uuid": "Udone"},
                    headers={"Authorization": "Bearer ppp"})
    assert r.status_code == 409
    assert "VIDPUB" in r.json()["error"]
    assert q.count_status("done") == 1

def test_session_cancel_409_on_a_processing_job(client, monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "ppp")
    q.enqueue("Uproc", "SUNDAY SCANS", "s", "http://dl", "tok")
    q.claim_next()
    r = client.post("/api/desk/session-cancel", json={"meeting_uuid": "Uproc"},
                    headers={"Authorization": "Bearer ppp"})
    assert r.status_code == 409
    assert q.get_job("Uproc")["status"] == "processing"


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


def test_insights_status_limit_query_param_overrides_the_default_8(client, monkeypatch):
    from api.services import desk_session_insights, education_service
    monkeypatch.setenv("PUSH_SECRET", "ppp")
    monkeypatch.setattr(desk_session_insights, "get_insights_status", lambda: {
        "pending": [], "recent_passes": [], "fail_streaks": {}})
    monkeypatch.setattr(education_service, "list_videos", lambda: [
        {"id": i, "title": f"V{i}", "meeting_uuid": f"U{i}", "insights_at": None,
         "zoom_cleaned": 0, "chapters": None, "ticker_moments": None}
        for i in range(1, 21)])

    default = client.get("/api/desk/insights-status", headers={"Authorization": "Bearer ppp"})
    assert len(default.json()["recent_videos"]) == 8

    r = client.get("/api/desk/insights-status?limit=20", headers={"Authorization": "Bearer ppp"})
    assert len(r.json()["recent_videos"]) == 20
