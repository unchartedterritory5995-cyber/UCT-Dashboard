# The Desk — Daily Sessions v2 (Zoom Cloud Record → YouTube → Desk) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** When a Zoom webinar's cloud recording finishes, Zoom calls our webhook; the engine downloads the recording, uploads it to YouTube (unlisted), publishes a dated "Daily Session" record in The Desk, and deletes the Zoom cloud copy — fully automatic.

**Architecture:** Thin webhook receiver (web pod) validates Zoom's signature and enqueues a job row. A scheduled processor drains the queue one at a time: stream-download the MP4 to a temp file (never in RAM), resumable-upload to YouTube, `create_video()` into the existing `edu_videos` store, delete the Zoom copy. Reuses the v1 publish half (`_session_title`, idempotency, EOD safety net).

**Tech Stack:** Python 3.12, FastAPI, `httpx`, APScheduler, SQLite, pytest. No new deps.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-24-desk-daily-sessions-design.md` (v2 section).
- **No new dependencies** — `httpx` for all HTTP; `hmac`/`hashlib` (stdlib) for signatures.
- **Never hold the whole video in RAM** — stream download to a temp file on disk; stream the upload PUT from that file handle. (Guards `project_worker_segfault_2026_06_10`.)
- **Webhook stays thin** — validate + enqueue, return 200 fast. NO download in the request (Zoom retries slow/non-2xx).
- **Idempotent** — queue PK on Zoom `meeting_uuid`; Desk insert still deduped by `youtube_id`.
- **Title format VERBATIM** (reuse v1): `Daily Session — {Month} {D}, {YYYY}`, em-dash, ET date from the recording's `start_time`.
- **Env-gated** by `DESK_DAILY_SESSION_ENABLED=1` (inert when unset).
- **Reuse** `education_service` (`create_video`/`existing_youtube_ids`/`list_videos`) and v1 `desk_daily_session._session_title`. No new video table.
- Run tests: `python -m pytest <path> -v` from the worktree root.

## Env / secrets (web pod)
`ZOOM_S2S_ACCOUNT_ID`, `ZOOM_S2S_CLIENT_ID`, `ZOOM_S2S_CLIENT_SECRET`, `ZOOM_WEBHOOK_SECRET_TOKEN`, `YT_OAUTH_CLIENT_ID`, `YT_OAUTH_CLIENT_SECRET`, `YT_OAUTH_REFRESH_TOKEN` (upload scope), `DESK_DAILY_SESSION_ENABLED=1`.

## File Structure
- Create `api/services/desk_session_jobs.py` — SQLite job queue.
- Create `api/routers/desk_zoom_webhook.py` — webhook receiver + signature/validation helpers.
- Create `api/services/zoom_client.py` — Zoom S2S OAuth + stream-download + delete.
- Modify `api/services/youtube_client.py` — add `upload_unlisted`.
- Modify `api/services/desk_daily_session.py` — add `process_pending_jobs` + retarget safety net.
- Modify `api/main.py` — include router + scheduler drain job + retire v1 poll.
- Tests: `tests/test_desk_session_jobs.py`, `tests/test_desk_zoom_webhook.py`, `tests/test_zoom_client.py`, add to `tests/test_youtube_client.py` + `tests/test_desk_daily_session.py`.

---

### Task 1: Job queue (`desk_session_jobs.py`)

**Files:** Create `api/services/desk_session_jobs.py`; Test `tests/test_desk_session_jobs.py`.

**Interfaces — Produces:**
- `enqueue(meeting_uuid, topic, start_time, download_url, download_token) -> bool` (False if uuid already present — idempotent)
- `claim_next() -> dict | None` (oldest `pending`, atomically set `processing`)
- `mark_done(meeting_uuid, youtube_id)`, `mark_error(meeting_uuid, error)` (increments `attempts`; back to `pending` if attempts < max, else `error`)
- `count_status(status) -> int`, `list_recent(limit=20) -> list[dict]`
- `_DB_PATH`, `_init_db()` (test hook, mirrors education_service)

- [ ] **Step 1: Failing test**
```python
# tests/test_desk_session_jobs.py
import os, tempfile, pytest
from api.services import desk_session_jobs as q

@pytest.fixture
def db(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(q, "_DB_PATH", os.path.join(d, "jobs.db"))
        q._init_db(); yield q

def test_enqueue_then_claim(db):
    assert db.enqueue("uuid1", "topic", "2026-06-24T13:30:00Z", "http://dl", "tok") is True
    job = db.claim_next()
    assert job["meeting_uuid"] == "uuid1" and job["status"] == "processing"
    assert db.claim_next() is None  # nothing else pending

def test_enqueue_is_idempotent(db):
    assert db.enqueue("uuid1", "t", "s", "u", "k") is True
    assert db.enqueue("uuid1", "t", "s", "u", "k") is False
    assert db.count_status("pending") == 1

def test_mark_done(db):
    db.enqueue("u", "t", "s", "u", "k"); db.claim_next()
    db.mark_done("u", "VID")
    assert db.count_status("done") == 1

def test_mark_error_retries_then_fails(db, monkeypatch):
    monkeypatch.setattr(q, "_MAX_ATTEMPTS", 2)
    db.enqueue("u", "t", "s", "u", "k")
    db.claim_next(); db.mark_error("u", "boom1")     # attempts=1 -> back to pending
    assert db.count_status("pending") == 1
    db.claim_next(); db.mark_error("u", "boom2")     # attempts=2 -> error
    assert db.count_status("error") == 1
```

- [ ] **Step 2: Run → fails.** `python -m pytest tests/test_desk_session_jobs.py -v`

- [ ] **Step 3: Implement**
```python
# api/services/desk_session_jobs.py
"""SQLite queue for pending Zoom recordings awaiting download+publish.
PK on meeting_uuid = idempotency against duplicate webhook deliveries.
Mirrors education_service: WAL, _WRITE_LOCK, contextlib.closing."""
from __future__ import annotations
import contextlib, os, sqlite3, threading, time

_DB_PATH = os.environ.get("DESK_JOBS_DB_PATH", "/data/desk_session_jobs.db")
_WRITE_LOCK = threading.Lock()
_MAX_ATTEMPTS = int(os.environ.get("DESK_DAILY_SESSION_MAX_ATTEMPTS", "3"))

_SCHEMA = """
CREATE TABLE IF NOT EXISTS desk_session_jobs (
  meeting_uuid  TEXT PRIMARY KEY,
  topic         TEXT,
  start_time    TEXT,
  download_url  TEXT NOT NULL,
  download_token TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending|processing|done|error
  youtube_id    TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dsj_status ON desk_session_jobs(status, created_at);
"""

def _connect():
    c = sqlite3.connect(_DB_PATH, timeout=10.0); c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL"); return c

def _init_db():
    parent = os.path.dirname(_DB_PATH)
    if parent: os.makedirs(parent, exist_ok=True)
    with contextlib.closing(_connect()) as c:
        c.executescript(_SCHEMA); c.commit()

def enqueue(meeting_uuid, topic, start_time, download_url, download_token) -> bool:
    now = int(time.time())
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        try:
            c.execute(
                "INSERT INTO desk_session_jobs (meeting_uuid, topic, start_time, "
                "download_url, download_token, status, attempts, created_at, updated_at) "
                "VALUES (?,?,?,?,?, 'pending', 0, ?, ?)",
                (meeting_uuid, topic, start_time, download_url, download_token, now, now))
            c.commit(); return True
        except sqlite3.IntegrityError:
            return False  # duplicate webhook -> already queued

def claim_next():
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT * FROM desk_session_jobs WHERE status='pending' "
            "ORDER BY created_at ASC, rowid ASC LIMIT 1").fetchone()
        if not row: return None
        c.execute("UPDATE desk_session_jobs SET status='processing', updated_at=? "
                  "WHERE meeting_uuid=?", (int(time.time()), row["meeting_uuid"]))
        c.commit(); return dict(row) | {"status": "processing"}

def mark_done(meeting_uuid, youtube_id):
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("UPDATE desk_session_jobs SET status='done', youtube_id=?, "
                  "updated_at=? WHERE meeting_uuid=?",
                  (youtube_id, int(time.time()), meeting_uuid)); c.commit()

def mark_error(meeting_uuid, error):
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        row = c.execute("SELECT attempts FROM desk_session_jobs WHERE meeting_uuid=?",
                        (meeting_uuid,)).fetchone()
        attempts = (row["attempts"] if row else 0) + 1
        status = "error" if attempts >= _MAX_ATTEMPTS else "pending"
        c.execute("UPDATE desk_session_jobs SET status=?, attempts=?, error=?, "
                  "updated_at=? WHERE meeting_uuid=?",
                  (status, attempts, str(error)[:500], int(time.time()), meeting_uuid))
        c.commit()

def count_status(status) -> int:
    with contextlib.closing(_connect()) as c:
        return c.execute("SELECT COUNT(*) n FROM desk_session_jobs WHERE status=?",
                         (status,)).fetchone()["n"]

def list_recent(limit=20):
    with contextlib.closing(_connect()) as c:
        rows = c.execute("SELECT * FROM desk_session_jobs ORDER BY created_at DESC "
                         "LIMIT ?", (int(limit),)).fetchall()
        return [dict(r) for r in rows]
```

- [ ] **Step 4: Run → passes.** `python -m pytest tests/test_desk_session_jobs.py -v`
- [ ] **Step 5: Commit** `git add api/services/desk_session_jobs.py tests/test_desk_session_jobs.py && git commit -m "feat(desk): SQLite job queue for pending Zoom recordings"`

---

### Task 2: Webhook receiver (`desk_zoom_webhook.py`)

**Files:** Create `api/routers/desk_zoom_webhook.py`; Test `tests/test_desk_zoom_webhook.py`.

**Interfaces — Produces:**
- `router` (FastAPI APIRouter, prefix `/api/desk`)
- `_validation_response(plain_token, secret) -> dict` (`{plainToken, encryptedToken}`)
- `_verify_signature(secret, timestamp, raw_body, signature) -> bool`
- `POST /api/desk/zoom-webhook`
- Consumes: `desk_session_jobs.enqueue`.

- [ ] **Step 1: Failing test**
```python
# tests/test_desk_zoom_webhook.py
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
```

- [ ] **Step 2: Run → fails.** `python -m pytest tests/test_desk_zoom_webhook.py -v`

- [ ] **Step 3: Implement**
```python
# api/routers/desk_zoom_webhook.py
"""Zoom webhook receiver for The Desk Daily Sessions.
Validates Zoom's HMAC signature + URL-validation challenge, and on
recording.completed enqueues a job. Thin: validate + enqueue + 200. The
heavy download/upload happens in a scheduled processor, never here."""
from __future__ import annotations
import hashlib, hmac, os
from fastapi import APIRouter, Request, Response
from api.services import desk_session_jobs

router = APIRouter(prefix="/api/desk", tags=["desk-daily-sessions"])

def _secret() -> str:
    return os.environ.get("ZOOM_WEBHOOK_SECRET_TOKEN", "")

def _validation_response(plain_token: str, secret: str) -> dict:
    enc = hmac.new(secret.encode(), plain_token.encode(), hashlib.sha256).hexdigest()
    return {"plainToken": plain_token, "encryptedToken": enc}

def _verify_signature(secret: str, timestamp: str, raw_body: str, signature: str) -> bool:
    if not (secret and timestamp and signature):
        return False
    msg = f"v0:{timestamp}:{raw_body}".encode()
    expected = "v0=" + hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)

def _first_mp4_url(obj: dict) -> str | None:
    for f in (obj.get("recording_files") or []):
        if (f.get("file_type") or "").upper() == "MP4" and f.get("download_url"):
            return f["download_url"]
    return None

@router.post("/zoom-webhook")
async def zoom_webhook(request: Request):
    raw = (await request.body()).decode("utf-8")
    secret = _secret()
    ts = request.headers.get("x-zm-request-timestamp", "")
    sig = request.headers.get("x-zm-signature", "")
    import json as _json
    try:
        data = _json.loads(raw) if raw else {}
    except ValueError:
        return Response(status_code=400)
    event = data.get("event")
    # URL validation must still be signature-checked.
    if not _verify_signature(secret, ts, raw, sig):
        return Response(status_code=401)
    if event == "endpoint.url_validation":
        plain = (data.get("payload") or {}).get("plainToken", "")
        return _validation_response(plain, secret)
    if event == "recording.completed":
        payload = data.get("payload") or {}
        obj = payload.get("object") or {}
        uuid = obj.get("uuid")
        url = _first_mp4_url(obj)
        if uuid and url:
            try:
                desk_session_jobs.enqueue(
                    uuid, obj.get("topic", ""), obj.get("start_time", ""),
                    url, payload.get("download_token", ""))
            except Exception:
                pass  # never fail the webhook; processor/safety-net recovers
        return {"ok": True}
    return {"ignored": event}
```

- [ ] **Step 4: Run → passes.** `python -m pytest tests/test_desk_zoom_webhook.py -v`
- [ ] **Step 5: Commit** `git add api/routers/desk_zoom_webhook.py tests/test_desk_zoom_webhook.py && git commit -m "feat(desk): Zoom webhook receiver (HMAC validate + enqueue)"`

---

### Task 3: Zoom client (`zoom_client.py`)

**Files:** Create `api/services/zoom_client.py`; Test `tests/test_zoom_client.py`.

**Interfaces — Produces:**
- `class ZoomAuthError(Exception)`, `class ZoomApiError(Exception)`
- `class ZoomClient` with `stream_download(download_url, token, dest_path)` and `delete_recording(meeting_uuid)`; `_ensure_token()`.

- [ ] **Step 1: Failing test**
```python
# tests/test_zoom_client.py
import os, tempfile, pytest
from api.services import zoom_client as zc

class _Resp:
    def __init__(self, status, payload=None, text="", chunks=None, headers=None):
        self.status_code = status; self._p = payload or {}; self.text = text
        self._chunks = chunks or []; self.headers = headers or {}
    def json(self): return self._p
    def raise_for_status(self): pass
    def iter_bytes(self, chunk_size=1024):
        for ch in self._chunks: yield ch
    def __enter__(self): return self
    def __exit__(self, *a): return False

def test_ensure_token_raises_when_unconfigured():
    c = zc.ZoomClient(account_id=None, client_id=None, client_secret=None)
    with pytest.raises(zc.ZoomAuthError):
        c._ensure_token()

def test_stream_download_writes_file(monkeypatch):
    monkeypatch.setattr(zc.httpx, "stream",
        lambda *a, **k: _Resp(200, chunks=[b"hello ", b"world"]))
    c = zc.ZoomClient(account_id="a", client_id="i", client_secret="s")
    with tempfile.TemporaryDirectory() as d:
        dest = os.path.join(d, "v.mp4")
        c.stream_download("http://dl", "tok", dest)
        assert open(dest, "rb").read() == b"hello world"

def test_delete_recording_calls_api(monkeypatch):
    seen = {}
    monkeypatch.setattr(zc.httpx, "post", lambda *a, **k: _Resp(200, {"access_token": "AT", "expires_in": 3600}))
    def fake_delete(url, headers=None, params=None, timeout=None):
        seen["url"] = url; return _Resp(204)
    monkeypatch.setattr(zc.httpx, "delete", fake_delete)
    c = zc.ZoomClient(account_id="a", client_id="i", client_secret="s")
    c.delete_recording("U1")
    assert "U1" in seen["url"]
```

- [ ] **Step 2: Run → fails.** `python -m pytest tests/test_zoom_client.py -v`

- [ ] **Step 3: Implement**
```python
# api/services/zoom_client.py
"""Zoom Server-to-Server OAuth client (raw httpx). Streams a cloud recording
to disk and trashes it after upload. Never holds the file in RAM."""
from __future__ import annotations
import base64, os, time, httpx

_TOKEN_URL = "https://zoom.us/oauth/token"
_API = "https://api.zoom.us/v2"

class ZoomAuthError(Exception): ...
class ZoomApiError(Exception): ...

class ZoomClient:
    def __init__(self, account_id=None, client_id=None, client_secret=None):
        self.account_id = account_id if account_id is not None else os.environ.get("ZOOM_S2S_ACCOUNT_ID")
        self.client_id = client_id if client_id is not None else os.environ.get("ZOOM_S2S_CLIENT_ID")
        self.client_secret = client_secret if client_secret is not None else os.environ.get("ZOOM_S2S_CLIENT_SECRET")
        self._token = None; self._exp = 0.0

    def _ensure_token(self) -> str:
        if self._token and time.time() < self._exp - 60:
            return self._token
        if not (self.account_id and self.client_id and self.client_secret):
            raise ZoomAuthError("Zoom S2S OAuth env not configured")
        basic = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode()).decode()
        resp = httpx.post(_TOKEN_URL,
            params={"grant_type": "account_credentials", "account_id": self.account_id},
            headers={"Authorization": f"Basic {basic}"}, timeout=15)
        if resp.status_code != 200:
            raise ZoomAuthError(f"zoom token {resp.status_code}: {resp.text[:200]}")
        data = resp.json()
        self._token = data["access_token"]; self._exp = time.time() + int(data.get("expires_in", 3600))
        return self._token

    def stream_download(self, download_url: str, token: str, dest_path: str) -> str:
        # download_token (from the webhook) authorizes the file URL directly.
        url = download_url
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        with httpx.stream("GET", url, headers=headers, follow_redirects=True, timeout=None) as r:
            if r.status_code != 200:
                raise ZoomApiError(f"download {r.status_code}")
            with open(dest_path, "wb") as f:
                for chunk in r.iter_bytes(chunk_size=1024 * 1024):
                    f.write(chunk)
        return dest_path

    def delete_recording(self, meeting_uuid: str) -> None:
        token = self._ensure_token()
        # Double-encode the UUID per Zoom's rule if it contains / or //.
        import urllib.parse as _u
        uid = meeting_uuid
        if "/" in uid or uid.startswith("/"):
            uid = _u.quote(_u.quote(uid, safe=""), safe="")
        resp = httpx.delete(f"{_API}/meetings/{uid}/recordings",
            headers={"Authorization": f"Bearer {token}"},
            params={"action": "trash"}, timeout=20)
        if resp.status_code not in (200, 204):
            raise ZoomApiError(f"delete {resp.status_code}: {resp.text[:200]}")
```

- [ ] **Step 4: Run → passes.** `python -m pytest tests/test_zoom_client.py -v`
- [ ] **Step 5: Commit** `git add api/services/zoom_client.py tests/test_zoom_client.py && git commit -m "feat(desk): Zoom S2S client — stream-download + trash recording"`

---

### Task 4: YouTube uploader (extend `youtube_client.py`)

**Files:** Modify `api/services/youtube_client.py`; add tests to `tests/test_youtube_client.py`.

**Interfaces — Produces:** `YouTubeClient.upload_unlisted(file_path, title, description="") -> str` (returns videoId).

- [ ] **Step 1: Failing test (append)**
```python
# append to tests/test_youtube_client.py
def test_upload_unlisted_returns_video_id(monkeypatch, tmp_path):
    f = tmp_path / "v.mp4"; f.write_bytes(b"x" * 10)
    posts = {}
    def fake_post(url, params=None, headers=None, json=None, timeout=None):
        posts["meta"] = json
        return _Resp(200, {}, headers_get="https://up.example/session")
    class _R2(_Resp):
        pass
    def fake_put(url, content=None, headers=None, timeout=None):
        return _Resp(200, {"id": "VIDUP"})
    # token refresh
    monkeypatch.setattr(yc.httpx, "post", lambda *a, **k: _Resp(200, {"access_token": "AT", "expires_in": 3600})
                        if "oauth2" in (a[0] if a else "") else fake_post(*a, **k))
    # simpler: monkeypatch the two calls separately
    monkeypatch.setattr(yc.httpx, "put", fake_put)
    c = yc.YouTubeClient(client_id="i", client_secret="s", refresh_token="r")
    # stub _ensure_token + the resumable init to avoid double-post ambiguity
    monkeypatch.setattr(c, "_ensure_token", lambda: "AT")
    monkeypatch.setattr(yc.httpx, "post", lambda url, params=None, headers=None, json=None, timeout=None:
                        _Resp(200, {}, headers_get="https://up.example/session"))
    vid = c.upload_unlisted(str(f), "Daily Session — June 24, 2026")
    assert vid == "VIDUP"
```
NOTE: the existing `_Resp` test helper must expose a `.headers` mapping. Update the existing `_Resp` class in this file so its constructor accepts `headers_get=None` and sets `self.headers = {"location": headers_get} if headers_get else {}`. Keep existing fields intact.

- [ ] **Step 2: Run → fails.** `python -m pytest tests/test_youtube_client.py -k upload -v`

- [ ] **Step 3: Implement (add to `youtube_client.py`)**
```python
# add near the top-level constants
_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos"

# add as a method on YouTubeClient
    def upload_unlisted(self, file_path: str, title: str, description: str = "") -> str:
        """Resumable upload of a local file as an UNLISTED video. Streams the
        bytes from disk (no full-file RAM load). Returns the new videoId."""
        token = self._ensure_token()
        size = os.path.getsize(file_path)
        meta = {"snippet": {"title": title, "description": description},
                "status": {"privacyStatus": "unlisted", "selfDeclaredMadeForKids": False}}
        init = httpx.post(_UPLOAD_URL,
            params={"uploadType": "resumable", "part": "snippet,status"},
            headers={"Authorization": f"Bearer {token}",
                     "X-Upload-Content-Type": "video/*",
                     "X-Upload-Content-Length": str(size)},
            json=meta, timeout=30)
        if init.status_code not in (200, 201):
            raise YouTubeApiError(f"upload init {init.status_code}: {init.text[:200]}")
        session_url = init.headers.get("location") or init.headers.get("Location")
        if not session_url:
            raise YouTubeApiError("upload init: no resumable session URL")
        with open(file_path, "rb") as fh:
            put = httpx.put(session_url, content=fh,
                headers={"Content-Type": "video/*", "Content-Length": str(size)},
                timeout=None)
        if put.status_code not in (200, 201):
            raise YouTubeApiError(f"upload put {put.status_code}: {put.text[:200]}")
        return put.json()["id"]
```

- [ ] **Step 4: Run → passes.** `python -m pytest tests/test_youtube_client.py -v` (all, incl. existing).
- [ ] **Step 5: Commit** `git add api/services/youtube_client.py tests/test_youtube_client.py && git commit -m "feat(desk): YouTube resumable upload_unlisted (streamed from disk)"`

---

### Task 5: Processor (extend `desk_daily_session.py`)

**Files:** Modify `api/services/desk_daily_session.py`; add tests to `tests/test_desk_daily_session.py`.

**Interfaces — Produces:**
- `process_pending_jobs(*, zoom=None, youtube=None) -> list[dict]` — drains the queue; per job: download→upload→publish→delete→mark_done; on error mark_error + cleanup temp.
- Retarget `check_missing_session_alert` so an error/auth failure path emits a distinct alert (reuse v1 kinds).

- [ ] **Step 1: Failing test (append)**
```python
# append to tests/test_desk_daily_session.py
from api.services import desk_session_jobs as q

class _FakeZoom:
    def __init__(self): self.deleted = []
    def stream_download(self, url, token, dest):
        with open(dest, "wb") as f: f.write(b"video")
        return dest
    def delete_recording(self, uuid): self.deleted.append(uuid)

class _FakeYT:
    def upload_unlisted(self, path, title, description=""):
        return "VIDX"

@pytest.fixture
def jobs_db(monkeypatch):
    import tempfile, os as _os
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(q, "_DB_PATH", _os.path.join(d, "jobs.db")); q._init_db()
        yield q

def test_process_pending_publishes_and_cleans(edu_db, jobs_db):
    jobs_db.enqueue("U1", "t", "2026-06-24T13:30:00Z", "http://dl", "tok")
    z = _FakeZoom()
    out = dds.process_pending_jobs(zoom=z, youtube=_FakeYT())
    assert len(out) == 1
    vids = edu.list_videos()
    assert len(vids) == 1 and vids[0]["title"] == "Daily Session — June 24, 2026"
    assert vids[0]["youtube_id"] == "VIDX"
    assert z.deleted == ["U1"]                      # Zoom copy trashed
    assert jobs_db.count_status("done") == 1

def test_process_idempotent_on_existing_video(edu_db, jobs_db):
    edu.create_video({"youtube_id": "VIDX", "title": "x", "category": "Daily Sessions", "sort_order": 0})
    jobs_db.enqueue("U1", "t", "2026-06-24T13:30:00Z", "http://dl", "tok")
    dds.process_pending_jobs(zoom=_FakeZoom(), youtube=_FakeYT())
    assert len([v for v in edu.list_videos() if v["youtube_id"] == "VIDX"]) == 1

def test_process_marks_error_on_upload_failure(edu_db, jobs_db, monkeypatch):
    monkeypatch.setattr(q, "_MAX_ATTEMPTS", 1)
    jobs_db.enqueue("U1", "t", "2026-06-24T13:30:00Z", "http://dl", "tok")
    class _BoomYT:
        def upload_unlisted(self, *a, **k): raise RuntimeError("upload boom")
    dds.process_pending_jobs(zoom=_FakeZoom(), youtube=_BoomYT())
    assert jobs_db.count_status("error") == 1
    assert edu.list_videos() == []
```

- [ ] **Step 2: Run → fails.** `python -m pytest tests/test_desk_daily_session.py -k process -v`

- [ ] **Step 3: Implement (add to `desk_daily_session.py`)**
```python
# add imports at top
import os, tempfile
from api.services import desk_session_jobs

# add function
def process_pending_jobs(*, zoom=None, youtube=None) -> list[dict]:
    """Drain the recording queue: download -> upload -> publish -> delete.
    One job at a time. Idempotent (youtube_id guard + queue PK). Never raises;
    per-job failures are recorded for retry / the EOD safety net."""
    from api.services.zoom_client import ZoomClient
    from api.services.youtube_client import YouTubeClient
    zoom = zoom or ZoneClient_default(ZoomClient)
    youtube = youtube or YouTubeClient()
    done: list[dict] = []
    while True:
        job = desk_session_jobs.claim_next()
        if not job:
            break
        uuid = job["meeting_uuid"]
        title = _session_title(job.get("start_time"))
        tmp = None
        try:
            fd, tmp = tempfile.mkstemp(suffix=".mp4"); os.close(fd)
            zoom.stream_download(job["download_url"], job.get("download_token"), tmp)
            vid = youtube.upload_unlisted(tmp, title)
            if vid not in education_service.existing_youtube_ids():
                education_service.create_video({
                    "youtube_id": vid, "title": title, "description": "",
                    "category": _category(), "sort_order": 0})
            try:
                zoom.delete_recording(uuid)
            except Exception:
                pass  # publish succeeded; a stuck Zoom copy is non-fatal
            desk_session_jobs.mark_done(uuid, vid)
            done.append({"meeting_uuid": uuid, "youtube_id": vid, "title": title})
        except Exception as e:
            desk_session_jobs.mark_error(uuid, e)
        finally:
            if tmp and os.path.exists(tmp):
                try: os.remove(tmp)
                except OSError: pass
    return done
```
NOTE: replace the `ZoneClient_default(ZoomClient)` placeholder with simply `ZoomClient()` — i.e. the line is `zoom = zoom or ZoomClient()`. (Do not introduce a helper; instantiate directly.)

- [ ] **Step 4: Run → passes.** `python -m pytest tests/test_desk_daily_session.py -v`
- [ ] **Step 5: Commit** `git add api/services/desk_daily_session.py tests/test_desk_daily_session.py && git commit -m "feat(desk): recording processor (download->upload->publish->trash)"`

---

### Task 6: Wiring + retire v1 poll (`api/main.py`)

**Files:** Modify `api/main.py`.

- [ ] **Step 1: Register the webhook router.** Near the other `from api.routers import ...` lines (top of file), add:
```python
from api.routers import desk_zoom_webhook as desk_zoom_webhook_router
```
And near the other `app.include_router(...)` calls (~line 2399+), add:
```python
app.include_router(desk_zoom_webhook_router.router)
```

- [ ] **Step 2: Replace the v1 poll block with the v2 processor drain.** In the scheduler block, find the v1 block beginning `# -- The Desk: Daily Sessions auto-publish ---` (added in v1 Task 4) and REPLACE its body so the gated block reads:
```python
        # -- The Desk: Daily Sessions auto-publish (v2: Zoom cloud record) --
        _desk_sessions_on = os.environ.get("DESK_DAILY_SESSION_ENABLED", "0") == "1"
        if _desk_sessions_on:
            from api.services import desk_daily_session as _dds
            from api.services import desk_session_jobs as _dsj
            try:
                _dsj._init_db()
            except Exception as e:
                print(f"[desk-sessions] jobs db init error: {e}")

            def _dds_process():
                try:
                    out = _dds.process_pending_jobs()
                    if out:
                        print(f"[desk-sessions] published {len(out)} session(s)")
                except Exception as e:
                    print(f"[desk-sessions] process error (non-fatal): {e}")

            def _dds_safety():
                try:
                    _dds.check_missing_session_alert()
                except Exception as e:
                    print(f"[desk-sessions] safety-net error (non-fatal): {e}")

            # Drain the recording queue every 5 min (a recording usually finishes
            # processing on Zoom's side a few minutes after the webinar ends).
            _scheduler.add_job(_dds_process, trigger=CronTrigger(minute="*/5"),
                id="desk_daily_session_process", max_instances=1, replace_existing=True)
            _scheduler.add_job(_dds_safety,
                trigger=CronTrigger(day_of_week="mon-fri", hour=18, minute=0),
                id="desk_daily_session_safety", max_instances=1, replace_existing=True)
            print("[startup] Desk Daily Sessions auto-publish ENABLED (v2 cloud-record)")
```

- [ ] **Step 3: Init the jobs DB at startup** (so the webhook can enqueue before the first scheduler tick). Near the `education_service.ensure_default_videos()` call (~line 814), add right after it:
```python
        try:
            from api.services import desk_session_jobs as _dsj_boot
            _dsj_boot._init_db()
        except Exception as _e:
            print(f"[startup] desk_session_jobs init skipped: {_e}")
```

- [ ] **Step 4: Verify import + wiring.**
  - `python -c "import api.main"` → exit 0.
  - `grep -c desk_zoom_webhook api/main.py` → `>= 2`.
  - `grep -c desk_session_jobs api/main.py` → `>= 2`.
  - `grep -c "process_pending_jobs\|_dds_process" api/main.py` → `>= 1`.

- [ ] **Step 5: Commit** `git add api/main.py && git commit -m "feat(desk): wire v2 webhook router + queue-drain scheduler (retire v1 poll)"`

---

### Task 7: Full suite + ship

- [ ] **Step 1:** `python -m pytest tests/test_desk_session_jobs.py tests/test_desk_zoom_webhook.py tests/test_zoom_client.py tests/test_youtube_client.py tests/test_desk_daily_session.py -v` → all pass.
- [ ] **Step 2:** `python -m pytest tests/test_education.py -v` → no regression.
- [ ] **Step 3: Ship (shared-tree safe).** `git fetch origin master && git rebase origin/master && git push origin desk-daily-sessions:master`
- [ ] **Step 4 (manual, post-deploy):** set the Zoom + YouTube env vars + `DESK_DAILY_SESSION_ENABLED=1` on the web pod, redeploy, then verify the Zoom webhook validates and a test webinar lands in The Desk.

---

## Self-Review

**Spec coverage:** webhook receiver+validation (T2) ✅; Zoom S2S client stream-download+delete (T3) ✅; YouTube upload (T4) ✅; queue+idempotency (T1) ✅; processor download→upload→publish→delete+temp cleanup (T5) ✅; scheduler+router wiring+retire v1 poll (T6) ✅; env-gating (T6) ✅; EOD safety net reused (T5/existing) ✅; ship (T7) ✅.
**Placeholder scan:** the two intentional NOTEs (update `_Resp` helper in T4; replace the `ZoneClient_default` placeholder with `ZoomClient()` in T5) are called out explicitly with the exact fix. No TBD/TODO left in code.
**Type consistency:** `desk_session_jobs` API (`enqueue/claim_next/mark_done/mark_error/count_status`) used identically in T2/T5/T6. `ZoomClient.stream_download(url, token, dest)` + `delete_recording(uuid)` and `YouTubeClient.upload_unlisted(path, title, description="")` match across T3/T4/T5 producers and consumers. `_session_title`/`_category`/`education_service.*` reused from v1 unchanged.
