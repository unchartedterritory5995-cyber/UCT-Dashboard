# THE DESK — Background Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let THE DESK videos keep playing audio on mobile when the phone screen locks, by serving an app-controlled audio track and playing it through a native `<audio>` element with MediaSession lock-screen controls.

**Architecture:** "Audio-primary, muted-video-follows." On mobile, the play tap starts a native `<audio>` element (the app-served 96 kbps AAC track = the source of truth) AND the existing YouTube iframe **muted**, loosely time-synced. When the screen locks the muted iframe suspends harmlessly and the `<audio>` element keeps playing with lock-screen controls. Audio is extracted from each session's source MP4 inside the existing publish pipeline; the ~300-video back-catalog is backfilled once, locally, via yt-dlp. Everything ships behind dark flags.

**Tech Stack:** FastAPI (Python), SQLite (`/data/education.db`), Cloudflare R2 via boto3 (`data_sync.py`), ffmpeg (new system dep), React + Vite, YouTube IFrame Player API, MediaSession API, vitest, pytest.

## Global Constraints

- **Worktree:** `.worktrees/desk-bg-audio`, branch `feat/desk-bg-audio` (off `origin/master`). Isolated worktree — commit with explicit `git add -- <path>`, NEVER `git add -A`. Ship later via `push origin feat/desk-bg-audio:master` (do not touch master until launch, and respect the deploy window: web deploys ≥4:20 PM ET or <9:15 AM ET — enforced by `.git/hooks/pre-push`).
- **Backend flag:** `DESK_BACKGROUND_AUDIO_ENABLED` read as `os.environ.get("DESK_BACKGROUND_AUDIO_ENABLED", "") == "1"` (this feature area uses plain `os.environ`, NOT a `CONFIG` object).
- **Frontend flag:** `const bgAudioEnabled = import.meta.env.VITE_DESK_BG_AUDIO_ENABLED === '1'` (default OFF).
- **R2 is best-effort/optional:** `data_sync._client()` returns `None` when `DATA_SYNC_*` creds are unset — extraction must skip and the serve endpoint must 404, never raise.
- **Audio format:** `ffmpeg -vn -c:a aac -b:a 96k -ac 2 -movflags +faststart`. Deterministic R2 key: `desk_audio/<youtube_id>.m4a`.
- **Ship dark:** no user-visible behavior until BOTH flags are on. A video with no `audio_url` must behave exactly as today (no regression).
- **Not a PWA:** the app runs as a regular Safari tab — do not add a web-app manifest `display: standalone` for this (the iOS "controls die after 30s" bug is PWA-only).
- **Voice subsystem is high-scrutiny:** changes to `audioExclusivity.js` and any `navigator.mediaSession` ownership must not regress read-aloud (`AudioPlayerBar.jsx`) stop/lock-screen behavior. Add regression tests.
- **Partner files:** none of the target files are in Ravi's set (`OptionsFlow.jsx`, `schwab_router.py`, `live_massive_router.py`, `massive_ws_worker.py`) — no coordination needed.
- **Tests:** backend `pytest`; frontend `cd app && npx vitest run --pool=threads <file>`.

---

## Task 1: Schema — `audio_url` / `audio_at` columns + `set_audio` setter

**Files:**
- Modify: `api/services/education_service.py` (add to `_EXTRA_COLUMNS` tuple ~line 78; add `set_audio` near `set_meeting_uuid`)
- Test: `tests/test_education_audio.py` (new)

**Interfaces:**
- Produces: `education_service.set_audio(video_id: int, audio_key: str) -> None` (sets `audio_url=audio_key`, `audio_at=now`, `updated_at=now`). Columns `audio_url TEXT`, `audio_at INTEGER` on `edu_videos`, both nullable. `get_video(video_id)` (already exists, returns `dict | None`) now includes `audio_url`/`audio_at`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_education_audio.py`:
```python
import os, tempfile
import importlib

def _fresh_service(tmp_path):
    os.environ["EDUCATION_DB_PATH"] = str(tmp_path / "edu.db")
    import api.services.education_service as es
    importlib.reload(es)
    es._init_db()
    return es

def test_set_audio_persists_key_and_timestamp(tmp_path):
    es = _fresh_service(tmp_path)
    row = es.create_video({"youtube_id": "abc123", "title": "T", "category": "Live Trading Sessions"})
    assert row["audio_url"] is None
    es.set_audio(row["id"], "desk_audio/abc123.m4a")
    got = es.get_video(row["id"])
    assert got["audio_url"] == "desk_audio/abc123.m4a"
    assert isinstance(got["audio_at"], int) and got["audio_at"] > 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_education_audio.py -v`
Expected: FAIL (`KeyError: 'audio_url'` on the `create_video` row, and `AttributeError: module ... has no attribute 'set_audio'`).

- [ ] **Step 3: Add the columns**

In `api/services/education_service.py`, append two entries to the `_EXTRA_COLUMNS` tuple (after `("poster", "INTEGER"),`):
```python
    ("audio_url", "TEXT"),      # R2 object key for the extracted background-audio track (NULL = none yet)
    ("audio_at", "INTEGER"),    # epoch when the audio track was produced
```

- [ ] **Step 4: Add the setter**

In `api/services/education_service.py`, next to `set_meeting_uuid` (the "Writes" section), add:
```python
def set_audio(video_id: int, audio_key: str) -> None:
    """Record the R2 key of the extracted background-audio track for a video."""
    now = int(time.time())
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            "UPDATE edu_videos SET audio_url = ?, audio_at = ?, updated_at = ? WHERE id = ?",
            (audio_key, now, now, int(video_id)),
        )
        c.commit()
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_education_audio.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -- api/services/education_service.py tests/test_education_audio.py
git commit -m "feat(desk-audio): add audio_url/audio_at columns + set_audio setter"
```

---

## Task 2: R2 presigned-GET helper in `data_sync.py`

**Files:**
- Modify: `api/services/data_sync.py` (add `presigned_get`, `put_bytes`)
- Test: `tests/test_data_sync_presign.py` (new)

**Interfaces:**
- Consumes: existing `data_sync._client()` (returns a boto3 S3 client or `None`), `data_sync._bucket()`.
- Produces:
  - `data_sync.presigned_get(key: str, expires: int = 3600) -> str | None` — presigned GET URL, or `None` when R2 creds are unset.
  - `data_sync.put_bytes(key: str, data: bytes, content_type: str) -> bool` — uploads bytes, returns `True` on success, `False` when unconfigured.

- [ ] **Step 1: Write the failing test**

Create `tests/test_data_sync_presign.py`:
```python
import importlib
import api.services.data_sync as ds

def test_presigned_get_returns_none_when_unconfigured(monkeypatch):
    monkeypatch.setattr(ds, "_client", lambda: None)
    assert ds.presigned_get("desk_audio/x.m4a") is None

def test_presigned_get_delegates_to_boto3(monkeypatch):
    calls = {}
    class FakeClient:
        def generate_presigned_url(self, op, Params, ExpiresIn):
            calls.update(op=op, Params=Params, ExpiresIn=ExpiresIn)
            return "https://r2.example/signed"
    monkeypatch.setattr(ds, "_client", lambda: FakeClient())
    monkeypatch.setattr(ds, "_bucket", lambda: "mybucket")
    url = ds.presigned_get("desk_audio/x.m4a", expires=1200)
    assert url == "https://r2.example/signed"
    assert calls["op"] == "get_object"
    assert calls["Params"] == {"Bucket": "mybucket", "Key": "desk_audio/x.m4a"}
    assert calls["ExpiresIn"] == 1200
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_data_sync_presign.py -v`
Expected: FAIL (`AttributeError: module 'api.services.data_sync' has no attribute 'presigned_get'`).

- [ ] **Step 3: Add the helpers**

In `api/services/data_sync.py`, add near the other client-using functions:
```python
def presigned_get(key: str, expires: int = 3600):
    """Presigned GET URL for an R2 object, or None if R2 is not configured."""
    cl = _client()
    if not cl:
        return None
    try:
        return cl.generate_presigned_url(
            "get_object",
            Params={"Bucket": _bucket(), "Key": key},
            ExpiresIn=int(expires),
        )
    except Exception:
        return None


def put_bytes(key: str, data: bytes, content_type: str) -> bool:
    """Upload bytes to R2. Returns False (no-op) when R2 is not configured."""
    cl = _client()
    if not cl:
        return False
    try:
        cl.put_object(Bucket=_bucket(), Key=key, Body=data, ContentType=content_type)
        return True
    except Exception:
        return False
```
(If `_bucket()` does not already exist in this module, add `def _bucket(): return os.environ.get("DATA_SYNC_BUCKET")` next to `_client()`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_data_sync_presign.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -- api/services/data_sync.py tests/test_data_sync_presign.py
git commit -m "feat(desk-audio): add R2 presigned_get + put_bytes helpers to data_sync"
```

---

## Task 3: `desk_background_audio.py` — extract + store module

**Files:**
- Create: `api/services/desk_background_audio.py`
- Test: `tests/test_desk_background_audio.py` (new)

**Interfaces:**
- Consumes: `data_sync.put_bytes`, `data_sync.presigned_get`.
- Produces:
  - `is_enabled() -> bool` — `os.environ.get("DESK_BACKGROUND_AUDIO_ENABLED", "") == "1"`.
  - `audio_key(youtube_id: str) -> str` — returns `f"desk_audio/{youtube_id}.m4a"`.
  - `extract_and_store(mp4_path: str, youtube_id: str) -> str | None` — runs ffmpeg on `mp4_path`, uploads the `.m4a` bytes to R2 under `audio_key(youtube_id)`, returns the key on success or `None` on any failure (never raises).
  - `presigned_url(youtube_id: str, expires: int = 3600) -> str | None` — `data_sync.presigned_get(audio_key(youtube_id), expires)`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_desk_background_audio.py`:
```python
import subprocess
import api.services.desk_background_audio as dba

def test_audio_key():
    assert dba.audio_key("abc123") == "desk_audio/abc123.m4a"

def test_extract_and_store_happy_path(tmp_path, monkeypatch):
    # Pretend ffmpeg writes an m4a
    def fake_run(cmd, **kw):
        out = cmd[cmd.index("-movflags") + 2] if "-movflags" in cmd else cmd[-1]
        with open(out, "wb") as f:
            f.write(b"FAKE-AAC-BYTES")
        class R: returncode = 0; stderr = b""
        return R()
    monkeypatch.setattr(subprocess, "run", fake_run)
    puts = {}
    monkeypatch.setattr(dba.data_sync, "put_bytes",
                        lambda key, data, content_type: puts.update(key=key, data=data, ct=content_type) or True)
    key = dba.extract_and_store(str(tmp_path / "src.mp4"), "abc123")
    assert key == "desk_audio/abc123.m4a"
    assert puts["key"] == "desk_audio/abc123.m4a"
    assert puts["data"] == b"FAKE-AAC-BYTES"
    assert puts["ct"] == "audio/mp4"

def test_extract_and_store_returns_none_on_ffmpeg_failure(tmp_path, monkeypatch):
    def boom(cmd, **kw):
        class R: returncode = 1; stderr = b"ffmpeg exploded"
        return R()
    monkeypatch.setattr(subprocess, "run", boom)
    assert dba.extract_and_store(str(tmp_path / "src.mp4"), "abc123") is None

def test_extract_and_store_returns_none_when_r2_unconfigured(tmp_path, monkeypatch):
    def fake_run(cmd, **kw):
        out = cmd[-1]
        open(out, "wb").write(b"x")
        class R: returncode = 0; stderr = b""
        return R()
    monkeypatch.setattr(subprocess, "run", fake_run)
    monkeypatch.setattr(dba.data_sync, "put_bytes", lambda *a, **k: False)
    assert dba.extract_and_store(str(tmp_path / "src.mp4"), "abc123") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_desk_background_audio.py -v`
Expected: FAIL (`ModuleNotFoundError: api.services.desk_background_audio`).

- [ ] **Step 3: Write the module**

Create `api/services/desk_background_audio.py`:
```python
"""Extract a compact background-audio track from a session MP4 and host it on R2
so mobile clients can keep playing audio when the screen locks. Best-effort:
every function fails soft (returns None / False) so it can never break the
YouTube publish pipeline. Gated by DESK_BACKGROUND_AUDIO_ENABLED.
"""
from __future__ import annotations

import logging
import os
import subprocess
import tempfile

from api.services import data_sync

log = logging.getLogger(__name__)

_BITRATE = os.environ.get("DESK_BG_AUDIO_BITRATE", "96k")


def is_enabled() -> bool:
    return os.environ.get("DESK_BACKGROUND_AUDIO_ENABLED", "") == "1"


def audio_key(youtube_id: str) -> str:
    return f"desk_audio/{youtube_id}.m4a"


def presigned_url(youtube_id: str, expires: int = 3600):
    return data_sync.presigned_get(audio_key(youtube_id), expires)


def extract_and_store(mp4_path: str, youtube_id: str):
    """ffmpeg-extract 96k AAC from mp4_path, upload to R2, return the key or None."""
    out = None
    try:
        fd, out = tempfile.mkstemp(suffix=".m4a")
        os.close(fd)
        cmd = [
            "ffmpeg", "-y", "-i", mp4_path,
            "-vn", "-c:a", "aac", "-b:a", _BITRATE, "-ac", "2",
            "-movflags", "+faststart", out,
        ]
        res = subprocess.run(cmd, capture_output=True, timeout=600)
        if res.returncode != 0 or not os.path.exists(out) or os.path.getsize(out) == 0:
            log.warning("bg-audio ffmpeg failed for %s: rc=%s", youtube_id,
                        getattr(res, "returncode", "?"))
            return None
        with open(out, "rb") as f:
            data = f.read()
        if not data_sync.put_bytes(audio_key(youtube_id), data, "audio/mp4"):
            log.warning("bg-audio R2 upload skipped/failed for %s", youtube_id)
            return None
        return audio_key(youtube_id)
    except Exception as e:
        log.warning("bg-audio extract_and_store failed for %s: %s", youtube_id, e)
        return None
    finally:
        if out and os.path.exists(out):
            try:
                os.remove(out)
            except OSError:
                pass
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_desk_background_audio.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -- api/services/desk_background_audio.py tests/test_desk_background_audio.py
git commit -m "feat(desk-audio): desk_background_audio module (ffmpeg extract -> R2)"
```

---

## Task 4: Wire extraction into the publish pipeline

**Files:**
- Modify: `api/services/desk_daily_session.py` (`process_pending_jobs`, the `if not vid:` block + the `set_meeting_uuid` site)
- Test: `tests/test_desk_daily_session_audio.py` (new)

**Interfaces:**
- Consumes: `desk_background_audio.is_enabled`, `desk_background_audio.extract_and_store`, `education_service.set_audio`.
- Behavior: after `mark_uploaded(uuid, vid)`, when enabled, extract audio from the temp mp4 (keyed on `vid`) into a local `audio_key` variable, non-fatally. At the existing `set_meeting_uuid(row["id"], uuid)` site, if `audio_key` was produced, also call `education_service.set_audio(row["id"], audio_key)`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_desk_daily_session_audio.py`. Because `process_pending_jobs` is a large orchestrator, test the extraction wiring at the seam by asserting the two calls happen in order with the temp path. Mirror the existing tests in `tests/` for this module (reuse their job-queue + zoom/youtube fakes if present); otherwise assert on a focused helper. Minimum viable test:
```python
import api.services.desk_daily_session as dds

def test_audio_extraction_called_with_tmp_and_youtube_id(monkeypatch, tmp_path):
    seen = {}
    monkeypatch.setattr(dds.desk_background_audio, "is_enabled", lambda: True)
    monkeypatch.setattr(dds.desk_background_audio, "extract_and_store",
                        lambda mp4, yid: seen.update(mp4=mp4, yid=yid) or "desk_audio/vid123.m4a")
    # helper extracted in Step 3 so the seam is unit-testable without the full pipeline:
    key = dds._maybe_extract_audio("/tmp/x.mp4", "vid123")
    assert key == "desk_audio/vid123.m4a"
    assert seen == {"mp4": "/tmp/x.mp4", "yid": "vid123"}

def test_audio_extraction_skipped_when_disabled(monkeypatch):
    monkeypatch.setattr(dds.desk_background_audio, "is_enabled", lambda: False)
    assert dds._maybe_extract_audio("/tmp/x.mp4", "vid123") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_desk_daily_session_audio.py -v`
Expected: FAIL (`AttributeError: module ... has no attribute '_maybe_extract_audio'`).

- [ ] **Step 3: Add the helper + wire the two sites**

In `api/services/desk_daily_session.py`, add the import near the top:
```python
from api.services import desk_background_audio
```
Add the helper:
```python
def _maybe_extract_audio(mp4_path, youtube_id):
    """Best-effort background-audio extraction; never raises."""
    if not desk_background_audio.is_enabled():
        return None
    try:
        return desk_background_audio.extract_and_store(mp4_path, youtube_id)
    except Exception:
        return None
```
In `process_pending_jobs`, immediately after `desk_session_jobs.mark_uploaded(uuid, vid)` (inside the `if not vid:` block), capture the key:
```python
                audio_key = _maybe_extract_audio(tmp, vid)
```
Initialize `audio_key = None` at the top of the per-job `try` (so it exists on the reclaimed-job path where the download block is skipped). At the existing `education_service.set_meeting_uuid(row["id"], uuid)` line, add right after it:
```python
            if audio_key:
                try:
                    education_service.set_audio(row["id"], audio_key)
                except Exception:
                    pass
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_desk_daily_session_audio.py -v`
Expected: PASS

- [ ] **Step 5: Run the existing desk-session tests to confirm no regression**

Run: `python -m pytest tests/ -k desk_daily_session -v`
Expected: PASS (all pre-existing tests still green)

- [ ] **Step 6: Commit**

```bash
git add -- api/services/desk_daily_session.py tests/test_desk_daily_session_audio.py
git commit -m "feat(desk-audio): extract audio in publish pipeline (non-fatal, first-pass only)"
```

---

## Task 5: Serve endpoint `GET /api/education/videos/{id}/audio`

**Files:**
- Modify: `api/routers/education.py` (add route beside `get_video_poster`; add `RedirectResponse` import)
- Test: `tests/test_education_audio_route.py` (new)

**Interfaces:**
- Consumes: `education_service.get_video`, `data_sync.presigned_get`, `require_paid` dependency.
- Produces: `GET /api/education/videos/{video_id}/audio` → 302 redirect to a presigned R2 URL; 404 when the row is missing, has no `audio_url`, or R2 is unconfigured; 402 when not a paid user (via `require_paid`).

- [ ] **Step 1: Write the failing test**

Create `tests/test_education_audio_route.py` (follow the existing router-test pattern in `tests/` — TestClient with the `require_paid` dependency overridden to a paid user; mirror whatever `test_education*.py` already does). Core assertions:
```python
# ... build client with require_paid overridden to a fake paid user ...
def test_audio_404_when_no_audio(client, monkeypatch):
    monkeypatch.setattr(edu_router.education_service, "get_video",
                        lambda vid: {"id": vid, "audio_url": None})
    r = client.get("/api/education/videos/5/audio")
    assert r.status_code == 404

def test_audio_302_to_presigned(client, monkeypatch):
    monkeypatch.setattr(edu_router.education_service, "get_video",
                        lambda vid: {"id": vid, "audio_url": "desk_audio/abc.m4a"})
    monkeypatch.setattr(edu_router.data_sync, "presigned_get",
                        lambda key, expires=3600: "https://r2.example/signed")
    r = client.get("/api/education/videos/5/audio", follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"] == "https://r2.example/signed"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_education_audio_route.py -v`
Expected: FAIL (404 route not found / attribute errors).

- [ ] **Step 3: Add the route**

In `api/routers/education.py`: extend the `fastapi.responses` import to include `RedirectResponse`, and ensure `from api.services import data_sync` is imported. Add beside `get_video_poster`:
```python
@router.get("/videos/{video_id}/audio")
def get_video_audio(video_id: int, _user: dict = Depends(require_paid)):
    row = education_service.get_video(video_id)
    if not row or not row.get("audio_url"):
        raise HTTPException(404, "No background audio for this video")
    url = data_sync.presigned_get(row["audio_url"])
    if not url:
        raise HTTPException(404, "Audio storage unavailable")
    return RedirectResponse(url, status_code=302)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_education_audio_route.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -- api/routers/education.py tests/test_education_audio_route.py
git commit -m "feat(desk-audio): serve GET /videos/{id}/audio -> 302 presigned R2"
```

---

## Task 6: Add ffmpeg to the Railway image

**Files:**
- Modify: `nixpacks.toml`

**Interfaces:** none (build config). ffmpeg becomes available on the web pod PATH so `desk_background_audio.extract_and_store` works in prod.

- [ ] **Step 1: Edit nixpacks.toml**

In `nixpacks.toml`, add `"ffmpeg"` to the `[phases.setup] nixPkgs` array:
```toml
[phases.setup]
nixPkgs = ["python312", "nodejs_20", "nodePackages.npm", "ffmpeg"]
```

- [ ] **Step 2: Verify ffmpeg is invokable locally (sanity, optional)**

Run: `ffmpeg -version` (if installed locally) — confirms the command name the module uses.
Expected: version banner. (If ffmpeg isn't on your local machine, that's fine — it only needs to exist on the Railway image; the unit tests mock `subprocess.run`.)

- [ ] **Step 3: Commit**

```bash
git add -- nixpacks.toml
git commit -m "build(desk-audio): add ffmpeg to nixpacks nixPkgs (prod audio extraction)"
```

---

## Task 7: One-time local backfill tool (yt-dlp)

**Files:**
- Create: `tools/desk_audio_backfill.py`

**Interfaces:** standalone script, run locally by the owner. NOT imported by the app; yt-dlp is NOT added to prod requirements.

- [ ] **Step 1: Write the script**

Create `tools/desk_audio_backfill.py`:
```python
"""One-time LOCAL backfill of background-audio for the existing DESK library.

For every edu_videos row missing audio_url, pull audio from our own YouTube
upload via yt-dlp, transcode to 96k AAC, upload to R2, and stamp set_audio.
Run on the owner's PC (NOT Railway) so YouTube doesn't rate-limit the pod, and
so yt-dlp never becomes a prod dependency.

Prereqs (local only): `pip install yt-dlp`, ffmpeg on PATH, and the DATA_SYNC_*
+ EDUCATION_DB_PATH env vars pointed at prod R2 + a local copy of education.db.

Usage:
  python tools/desk_audio_backfill.py --dry-run          # list what WOULD run
  python tools/desk_audio_backfill.py --limit 10         # do 10 (resumable)
  python tools/desk_audio_backfill.py                    # do all missing
"""
import argparse, os, subprocess, sys, tempfile, time

from api.services import education_service, data_sync, desk_background_audio


def _missing():
    return [v for v in education_service.list_videos() if not v.get("audio_url")]


def _pull_and_store(youtube_id):
    tmp_dir = tempfile.mkdtemp()
    src = os.path.join(tmp_dir, f"{youtube_id}.m4a")
    # yt-dlp: bestaudio -> m4a (our own unlisted/owned upload)
    dl = subprocess.run(
        ["yt-dlp", "-f", "bestaudio", "-x", "--audio-format", "m4a",
         "-o", os.path.join(tmp_dir, f"{youtube_id}.%(ext)s"),
         f"https://www.youtube.com/watch?v={youtube_id}"],
        capture_output=True,
    )
    if dl.returncode != 0 or not os.path.exists(src):
        print(f"  ! yt-dlp failed for {youtube_id}: {dl.stderr.decode()[:200]}")
        return None
    # Re-encode to the exact pipeline format + upload via the shared module.
    return desk_background_audio.extract_and_store(src, youtube_id)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    education_service._init_db()
    todo = _missing()
    if args.limit:
        todo = todo[: args.limit]
    print(f"{len(todo)} videos missing audio")
    if args.dry_run:
        for v in todo:
            print(f"  would backfill {v['youtube_id']}  ({v['title']})")
        return 0

    ok = 0
    for i, v in enumerate(todo, 1):
        yid = v["youtube_id"]
        print(f"[{i}/{len(todo)}] {yid} …")
        key = _pull_and_store(yid)
        if key:
            education_service.set_audio(v["id"], key)
            ok += 1
            print(f"  ✓ {key}")
        time.sleep(2)  # be polite to YouTube
    print(f"done: {ok}/{len(todo)} backfilled")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Smoke the dry-run against a local DB (optional sanity)**

Run: `python tools/desk_audio_backfill.py --dry-run`
Expected: prints a count + "would backfill …" lines (or "0 videos missing audio" against an empty local DB). No network calls in dry-run.

- [ ] **Step 3: Commit**

```bash
git add -- tools/desk_audio_backfill.py
git commit -m "feat(desk-audio): local one-time yt-dlp backfill tool"
```

---

## Task 8: Stop `audioExclusivity` from silencing our own audio element

**Files:**
- Modify: `app/src/components/video/audioExclusivity.js`
- Test: `app/src/components/video/audioExclusivity.test.js` (new)

**Interfaces:**
- Produces: `pauseOtherAudio()` skips any `<audio>` carrying the attribute `data-uct-video-audio`; all other behavior (pausing other `<audio>` + `speechSynthesis.cancel()`) unchanged.

- [ ] **Step 1: Write the failing test**

Create `app/src/components/video/audioExclusivity.test.js`:
```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { pauseOtherAudio } from './audioExclusivity'

beforeEach(() => { document.body.innerHTML = ''; globalThis.speechSynthesis = { cancel: vi.fn() } })

it('pauses other audio but NOT the tagged video-audio element', () => {
  const other = document.createElement('audio'); other.pause = vi.fn(); document.body.appendChild(other)
  const mine = document.createElement('audio'); mine.setAttribute('data-uct-video-audio', '1'); mine.pause = vi.fn(); document.body.appendChild(mine)
  pauseOtherAudio()
  expect(other.pause).toHaveBeenCalled()
  expect(mine.pause).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run --pool=threads src/components/video/audioExclusivity.test.js`
Expected: FAIL (`mine.pause` was called).

- [ ] **Step 3: Add the exclusion**

In `app/src/components/video/audioExclusivity.js`, change the `querySelectorAll('audio')` sweep so it skips the tagged element:
```js
  document.querySelectorAll('audio').forEach((el) => {
    if (el.hasAttribute('data-uct-video-audio')) return  // the Desk video's own audio track
    try { el.pause() } catch {}
  })
```
Leave the `window.speechSynthesis.cancel()` call as-is.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run --pool=threads src/components/video/audioExclusivity.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -- app/src/components/video/audioExclusivity.js app/src/components/video/audioExclusivity.test.js
git commit -m "feat(desk-audio): exclude the video's own audio element from pauseOtherAudio"
```

---

## Task 9: Add the `<audio>` element + mobile audio-primary play path

**Files:**
- Modify: `app/src/components/video/GlobalVideoLayer.jsx`
- Test: `app/src/components/video/GlobalVideoLayer.test.jsx` (extend existing)

**Interfaces:**
- Consumes: the flag `import.meta.env.VITE_DESK_BG_AUDIO_ENABLED === '1'`, `useVideoInsights(current?.id)` (already in scope), the audio endpoint `/api/education/videos/{id}/audio`.
- Produces: a module-level `const bgAudioEnabled` + helper `isAudioPrimary()` = `bgAudioEnabled && window.matchMedia('(pointer: coarse)')?.matches && !!current?.audio_url` (or `!!current?.id`, since presence is confirmed by the endpoint — gate on the flag+pointer and let a 404 fall back). A hidden `<audio ref={audioRef} data-uct-video-audio="1" preload="metadata" />`. On the mobile play path: set `audioRef.current.src` to the audio endpoint, call `.play()` inside the tap, then `player().mute()` + `player().playVideo()`.

- [ ] **Step 1: Write the failing test**

Extend `app/src/components/video/GlobalVideoLayer.test.jsx` (which already mocks `window.YT.Player` + drives `videoStore`). Add a suite that stubs `matchMedia('(pointer: coarse)') => {matches:true}`, sets `import.meta.env.VITE_DESK_BG_AUDIO_ENABLED = '1'`, mocks `HTMLMediaElement.prototype.play`, then plays a video via the store and asserts (a) a hidden `<audio data-uct-video-audio>` is rendered, (b) its `src` ends with `/audio`, (c) the YT player was muted. Use the existing test's fake-player capture to assert `mute` was called.
```js
it('starts the audio element muted-video on mobile when the flag is on', async () => {
  import.meta.env.VITE_DESK_BG_AUDIO_ENABLED = '1'
  window.matchMedia = (q) => ({ matches: q.includes('coarse'), addEventListener() {}, removeEventListener() {} })
  const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue()
  // ... render, then videoStore.play([{ id: 7, youtube_id: 'abc', audio_url: 'desk_audio/abc.m4a' }], 0) ...
  const audioEl = document.querySelector('audio[data-uct-video-audio]')
  expect(audioEl).toBeTruthy()
  expect(audioEl.getAttribute('src')).toMatch(/\/api\/education\/videos\/7\/audio$/)
  expect(playSpy).toHaveBeenCalled()
  expect(fakePlayer.mute).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run --pool=threads src/components/video/GlobalVideoLayer.test.jsx`
Expected: FAIL (no `audio[data-uct-video-audio]` element).

- [ ] **Step 3: Implement**

In `app/src/components/video/GlobalVideoLayer.jsx`:
1. Near the top (module scope): `const bgAudioEnabled = import.meta.env.VITE_DESK_BG_AUDIO_ENABLED === '1'`.
2. Add `const audioRef = useRef(null)`.
3. Add a helper inside the component:
```jsx
  const isAudioPrimary = () =>
    bgAudioEnabled && !!window.matchMedia?.('(pointer: coarse)')?.matches
```
4. Render the hidden element (next to the `<div ref={hostRef} .../>`):
```jsx
      <audio ref={audioRef} data-uct-video-audio="1" preload="metadata" style={{ display: 'none' }} />
```
5. In the player-build effect where playback starts (and in `loadVideoById`-switch), when `isAudioPrimary()`: set `audioRef.current.src = \`/api/education/videos/${current.id}/audio\``, call `audioRef.current.play().catch(() => {})` **synchronously in the same tap**, then `p.mute(); p.playVideo()`. Wrap `audioRef.current` accesses in `if (audioRef.current) {…}`. On audio `error` (404 = no track) fall back: `p.unMute()` and behave as today.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run --pool=threads src/components/video/GlobalVideoLayer.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -- app/src/components/video/GlobalVideoLayer.jsx app/src/components/video/GlobalVideoLayer.test.jsx
git commit -m "feat(desk-audio): mobile audio-primary play path (audio el + muted YT)"
```

---

## Task 10: Make the audio element the clock (controls + scrubber + time getter)

**Files:**
- Modify: `app/src/components/video/GlobalVideoLayer.jsx`
- Test: `app/src/components/video/GlobalVideoLayer.test.jsx` (extend)

**Interfaces:**
- Behavior when `isAudioPrimary()` and the audio element is active: `togglePlay`, `seekBy`, `seekFrac`, `cycleRate`, `applyVolume`/`toggleMute`, and the store-driven `seekReq` effect write the **audio element** first, then mirror to the muted YT player (`p.seekTo(t, true)` after an audio seek; `p.setPlaybackRate(r)`; keep `p.mute()`). The 300ms scrubber-poll effect reads `audioRef.current.currentTime`/`.duration` for `setProg`. `registerTimeGetter` returns the audio clock.
- Guard: when the audio element is NOT active (desktop, flag off, or 404 fallback), all of the above keep today's YT-only behavior. Use a single `audioActiveRef` boolean set true only after `audioRef.current.play()` resolves without error.

- [ ] **Step 1: Write the failing tests**

In `GlobalVideoLayer.test.jsx`, add cases (mobile + flag on): clicking play/pause toggles `audioEl.paused`; the scrubber drag calls set `audioEl.currentTime` AND `fakePlayer.seekTo`; the speed button sets `audioEl.playbackRate` and `fakePlayer.setPlaybackRate`; with the flag OFF, none of the audio paths run (today's YT calls only). Assert `registerTimeGetter`'s registered getter returns `audioEl.currentTime` when audio is active.

- [ ] **Step 2: Run to verify they fail**

Run: `cd app && npx vitest run --pool=threads src/components/video/GlobalVideoLayer.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add `const audioActiveRef = useRef(false)` (set `true` in the `play().then(...)`, `false` on audio `error`/close). Gate each control site:
```jsx
  const audioOn = () => audioActiveRef.current && audioRef.current
  // togglePlay:
  if (audioOn()) { isPlaying ? audioRef.current.pause() : audioRef.current.play().catch(()=>{}) } // YT mirrors via its own state effect
  else { (isPlaying ? p.pauseVideo : p.playVideo).call(p) }
  // seekFrac(frac):
  if (audioOn()) { const t = frac * (audioRef.current.duration || 0); audioRef.current.currentTime = t; p.seekTo(t, true) }
  else { p.seekTo(frac * d, true) }
  // seekBy(delta): mirror the same pattern using audioRef.current.currentTime
  // cycleRate(r): if (audioOn()) audioRef.current.playbackRate = r; p.setPlaybackRate?.(r)
  // applyVolume/toggleMute: act on audioRef.current.volume/.muted when audioOn(); keep p muted
```
Scrubber-poll effect: when `audioOn()`, read from `audioRef.current` for `setProg({ t: audioRef.current.currentTime, d: audioRef.current.duration || 0 })`. `registerTimeGetter`: return `() => (audioOn() ? audioRef.current.currentTime : p.getCurrentTime())`. Wire the audio element's `ended` event to the same end handling as YT state 0 (`markWatched` + `setEnded(true)`).

- [ ] **Step 4: Run to verify they pass**

Run: `cd app && npx vitest run --pool=threads src/components/video/GlobalVideoLayer.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -- app/src/components/video/GlobalVideoLayer.jsx app/src/components/video/GlobalVideoLayer.test.jsx
git commit -m "feat(desk-audio): audio element is the clock; YT mirrors while visible"
```

---

## Task 11: Foreground resync (visibilitychange) + threshold-gated drift correction

**Files:**
- Modify: `app/src/components/video/GlobalVideoLayer.jsx`
- Test: `app/src/components/video/GlobalVideoLayer.test.jsx` (extend)

**Interfaces:**
- Behavior when `audioOn()`: a `visibilitychange` listener fires on `document.visibilityState === 'visible'` and does one authoritative `p.seekTo(audioRef.current.currentTime, true)` then, if audio is playing, `p.playVideo()`. While visible, a light interval (reuse the existing 300ms poll or a 1s tick) corrects only when `Math.abs(p.getCurrentTime() - audioRef.current.currentTime) > 0.4` via a single `p.seekTo(...)`. No correction while `document.hidden`.

- [ ] **Step 1: Write the failing test**

In `GlobalVideoLayer.test.jsx` (mobile + flag on, audio active): set `audioEl.currentTime = 42`, dispatch a `visibilitychange` with `document.visibilityState` stubbed to `'visible'`, assert `fakePlayer.seekTo` was called with `42`. Second case: within-tolerance drift (0.2s) does NOT call `seekTo`; out-of-tolerance (1.0s) does.

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run --pool=threads src/components/video/GlobalVideoLayer.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add an effect:
```jsx
  useEffect(() => {
    if (!bgAudioEnabled) return
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      const p = player(); const a = audioRef.current
      if (!p || !a || !audioActiveRef.current) return
      try { p.seekTo(a.currentTime, true); if (!a.paused) p.playVideo() } catch {}
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])
```
In the scrubber-poll effect, add threshold-gated correction while visible + `audioOn()`:
```jsx
      if (audioOn() && document.visibilityState === 'visible') {
        const p = player()
        if (p && Math.abs(p.getCurrentTime() - audioRef.current.currentTime) > 0.4) {
          try { p.seekTo(audioRef.current.currentTime, true) } catch {}
        }
      }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run --pool=threads src/components/video/GlobalVideoLayer.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -- app/src/components/video/GlobalVideoLayer.jsx app/src/components/video/GlobalVideoLayer.test.jsx
git commit -m "feat(desk-audio): foreground resync + threshold-gated drift correction"
```

---

## Task 12: MediaSession lock-screen controls + voice arbiter

**Files:**
- Modify: `app/src/components/video/GlobalVideoLayer.jsx`
- Modify: `app/src/components/voice/AudioPlayerBar.jsx` (arbiter guard only)
- Test: `app/src/components/video/GlobalVideoLayer.test.jsx` (extend)

**Interfaces:**
- Produces: when `audioOn()`, sets `navigator.mediaSession.metadata` (title = `current.title`, artist `'UCT Intelligence'`, artwork `https://i.ytimg.com/vi/${current.youtube_id}/hqdefault.jpg`, sizes `'480x360'`), and `setActionHandler('play'|'pause'|'seekbackward'|'seekforward'|'seekto')` driving the audio element. **Do NOT register `previoustrack`/`nexttrack`** (iOS shows seek OR prev/next, not both — default is ±15s seek). Sets `navigator.mediaSession.playbackState`. A shared guard so the Desk video and read-aloud don't stomp each other: while the video's audio is active, `AudioPlayerBar` must not reclaim MediaSession.
- Arbiter mechanism: a tiny module-level flag. Create `app/src/components/video/mediaSessionOwner.js` exporting `setVideoOwnsMediaSession(bool)` + `videoOwnsMediaSession()`. GlobalVideoLayer sets it true while `audioOn()`, false on close/pause-to-idle. `AudioPlayerBar`'s MediaSession effect early-returns when `videoOwnsMediaSession()` is true.

- [ ] **Step 1: Write the failing test**

In `GlobalVideoLayer.test.jsx` (mobile + flag on, audio active): stub `navigator.mediaSession = { setActionHandler: vi.fn(), }` and `window.MediaMetadata = class { constructor(o){ Object.assign(this,o) } }`. Play a video; assert `mediaSession.metadata.title` set, artwork URL contains the youtube_id, and `setActionHandler` called with `'play'`,`'pause'`,`'seekbackward'`,`'seekforward'`,`'seekto'` but NOT `'nexttrack'`. Add a `mediaSessionOwner.test.js`: `setVideoOwnsMediaSession(true)` → `videoOwnsMediaSession() === true`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run --pool=threads src/components/video/GlobalVideoLayer.test.jsx src/components/video/mediaSessionOwner.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `app/src/components/video/mediaSessionOwner.js`:
```js
let _videoOwns = false
export function setVideoOwnsMediaSession(v) { _videoOwns = !!v }
export function videoOwnsMediaSession() { return _videoOwns }
```
In `GlobalVideoLayer.jsx`, add an effect that runs when `audioOn()` + `current` changes (mirror `AudioPlayerBar.jsx` lines ~166–190):
```jsx
  useEffect(() => {
    if (!audioOn() || !('mediaSession' in navigator)) return
    setVideoOwnsMediaSession(true)
    try {
      if (window.MediaMetadata) {
        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: current?.title || 'The Desk', artist: 'UCT Intelligence', album: 'The Desk',
          artwork: [{ src: `https://i.ytimg.com/vi/${current?.youtube_id}/hqdefault.jpg`, sizes: '480x360', type: 'image/jpeg' }],
        })
      }
      const a = audioRef.current
      const S = 15
      navigator.mediaSession.setActionHandler('play', () => a.play().catch(()=>{}))
      navigator.mediaSession.setActionHandler('pause', () => a.pause())
      navigator.mediaSession.setActionHandler('seekbackward', () => { a.currentTime = Math.max(0, a.currentTime - S) })
      navigator.mediaSession.setActionHandler('seekforward', () => { a.currentTime = a.currentTime + S })
      navigator.mediaSession.setActionHandler('seekto', (d) => { if (d.seekTime != null) a.currentTime = d.seekTime })
    } catch {}
    return () => { setVideoOwnsMediaSession(false) }
  }, [current?.id])
```
Keep `navigator.mediaSession.playbackState` in sync with play/pause. In `AudioPlayerBar.jsx`, at the top of its MediaSession `useEffect`, add:
```jsx
    if (videoOwnsMediaSession()) return  // Desk video owns the lock screen while its audio is live
```
(import `videoOwnsMediaSession` from `../video/mediaSessionOwner`).

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run --pool=threads src/components/video/GlobalVideoLayer.test.jsx src/components/video/mediaSessionOwner.test.js`
Expected: PASS

- [ ] **Step 5: Run the read-aloud regression tests**

Run: `cd app && npx vitest run --pool=threads src/components/voice/AudioPlayerBar.test.jsx` (and any read-aloud e2e in the suite)
Expected: PASS (no regression to read-aloud's own MediaSession when the video isn't active)

- [ ] **Step 6: Commit**

```bash
git add -- app/src/components/video/GlobalVideoLayer.jsx app/src/components/video/mediaSessionOwner.js app/src/components/video/mediaSessionOwner.test.js app/src/components/voice/AudioPlayerBar.jsx app/src/components/video/GlobalVideoLayer.test.jsx
git commit -m "feat(desk-audio): MediaSession lock-screen controls + video/voice arbiter"
```

---

## Task 13: Full-suite verification + build

**Files:** none (verification task).

- [ ] **Step 1: Backend suite (touched areas)**

Run: `python -m pytest tests/test_education_audio.py tests/test_data_sync_presign.py tests/test_desk_background_audio.py tests/test_desk_daily_session_audio.py tests/test_education_audio_route.py -v`
Expected: all PASS

- [ ] **Step 2: Frontend suite (touched areas)**

Run: `cd app && npx vitest run --pool=threads src/components/video src/components/voice/AudioPlayerBar.test.jsx`
Expected: all PASS

- [ ] **Step 3: Production build (flag off — must be a no-op regression-wise)**

Run: `cd app && npm run build`
Expected: build succeeds. With `VITE_DESK_BG_AUDIO_ENABLED` unset, `bgAudioEnabled` is false → the player behaves exactly as today.

- [ ] **Step 4: Commit any lockfile/build fixups (if needed)**

```bash
git add -- app/package-lock.json 2>/dev/null || true
git commit -m "chore(desk-audio): build verification" --allow-empty
```

---

## Real-device verification (manual — REQUIRED before flag flip; jsdom cannot prove this)

Not a code task, but the deploy gate. After a DARK deploy with `DESK_BACKGROUND_AUDIO_ENABLED=1` (backend) and a browser with `VITE_DESK_BG_AUDIO_ENABLED=1`:
1. **iOS Safari (regular tab, not added-to-home-screen):** play a Desk video, lock the phone → audio KEEPS playing; lock-screen shows title + artwork + play/pause + ±15s. Unlock → video resyncs (one deliberate re-buffer is acceptable).
2. **Android Chrome:** same, plus notification-shade controls.
3. **No-audio fallback:** a video whose `audio_url` is still NULL plays exactly as today (no console errors, screen-lock stops it as before — no regression).
4. **Voice coexistence:** start read-aloud, then a Desk video → video takes the lock screen; stop the video → read-aloud’s own controls behave normally. Confirm no "stuck audio."

## Rollout order

1. Merge Tasks 1–7 + nixpacks (backend dark) → deploy → confirm `ffmpeg -version` on the pod and that new sessions get `audio_url` (probe `/api/desk/sessions-status` + education.db).
2. Run `tools/desk_audio_backfill.py` locally for the ~300 back-catalog → R2.
3. Merge Tasks 8–13 (frontend dark) → deploy.
4. Real-device verification pass (above).
5. Owner sets `VITE_DESK_BG_AUDIO_ENABLED=1` (rebuild) + confirms `DESK_BACKGROUND_AUDIO_ENABLED=1`. Rollback = unset either flag.

## Escape hatch (if two-player sync feels janky on real devices)

Degrade to a same-origin muted `<video>` served like the audio (self-host the video too) — one player, no two-timeline sync, same backend. Documented in the spec; not built here.
