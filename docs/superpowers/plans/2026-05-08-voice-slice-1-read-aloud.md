# Voice Assistant — Slice 1: Read-Aloud (Mode A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first vertical slice of the voice assistant — TTS read-aloud only. Users can click "Read aloud" buttons on long-form content (morning wire, earnings transcripts, UCT20 picks, setup library entries) and hear it spoken via OpenAI's `tts-1` model. Audio plays via a persistent floating player bar; identical text/voice/speed combinations are served from disk cache.

**Architecture:** Three-layer backend (FastAPI router → service modules → OpenAI SDK + disk cache + SQLite) plus a React frontend that mounts a global `<AudioPlayerBar>` and exposes a reusable `<ReadAloudButton>` component. Backend streams MP3 chunks to the browser; browser pipes them into a single shared `<audio>` element via the React Context store. Disk cache keyed by SHA(text+voice+speed) keeps re-listens free.

**Tech Stack:** FastAPI · OpenAI Python SDK (`openai>=1.30`) · SQLite · React 18 · React Context API · CSS Modules · Vite

**Spec:** `docs/superpowers/specs/2026-05-08-voice-assistant-design.md`

**Scope (this plan):** Mode A only. Mode B (one-shot Q&A), Mode C (Realtime conversations), wake-word, and tool execution are out of scope for this slice and have their own future plans.

---

## File Structure (created/modified by this plan)

### Backend

| File | Responsibility |
|------|----------------|
| `requirements.txt` | Add `openai>=1.30,<2` dependency |
| `.env.example` | Document `OPENAI_API_KEY` (NEW or existing if already used elsewhere) |
| `api/services/auth_db.py` | Add 2 tables (`voice_settings`, `voice_usage_monthly`) to `_SCHEMA` |
| `api/services/voice_settings_service.py` | NEW. CRUD for per-user voice prefs |
| `api/services/voice_usage.py` | NEW. Mode A second-counting + monthly rollup |
| `api/services/voice_audio_cache.py` | NEW. Disk-backed cache keyed by SHA(text+voice+speed), 7-day TTL |
| `api/services/voice_openai.py` | NEW. Thin wrapper around OpenAI `audio.speech.with_streaming_response` |
| `api/middleware/auth_middleware.py` | Add `requires_voice_access` dependency factory |
| `api/routers/voice.py` | NEW. Endpoints: `POST /api/voice/tts`, `GET/PUT /api/voice/settings`, `GET /api/voice/usage` |
| `api/main.py` | Register voice router; add APScheduler retention cleanup job |

### Frontend

| File | Responsibility |
|------|----------------|
| `app/src/context/VoiceContext.jsx` | NEW. Global voice store via React Context + useReducer (no new deps) |
| `app/src/hooks/useReadAloud.js` | NEW. Wraps fetch + MediaSource into a play/pause/stop interface |
| `app/src/components/voice/AudioPlayerBar.jsx` | NEW. Bottom-of-screen player; play/pause/scrub/speed/close |
| `app/src/components/voice/AudioPlayerBar.module.css` | NEW. Styles for player bar |
| `app/src/components/voice/ReadAloudButton.jsx` | NEW. Reusable speaker-icon button; takes text or text-loader |
| `app/src/components/voice/ReadAloudButton.module.css` | NEW. Styles for button |
| `app/src/App.jsx` | Wrap children in `<VoiceProvider>`; mount `<AudioPlayerBar>` globally |
| `app/src/pages/Settings.jsx` | Add Voice settings panel (enable, voice picker, speed, monthly usage) |
| `app/src/pages/Settings.module.css` | Add Voice panel styles |
| `app/src/pages/MorningWire.jsx` | Add `<ReadAloudButton>` next to title |
| `app/src/components/tiles/EarningsModal.jsx` | Add `<ReadAloudButton>` for transcript section |
| `app/src/pages/UCT20.jsx` | Add `<ReadAloudButton>` per pick + "Read all picks" |
| `app/src/pages/SetupLibrary.jsx` | Add `<ReadAloudButton>` per setup entry |

### Tests

| File | Coverage |
|------|----------|
| `tests/test_voice_audio_cache.py` | Cache hit/miss/stale/eviction |
| `tests/test_voice_settings_service.py` | Default creation, update, voice/speed bounds |
| `tests/test_voice_usage.py` | Monthly bucketing, cap enforcement |
| `tests/test_voice_openai.py` | Mocked SDK call, retry behavior |
| `tests/test_voice_router.py` | Auth gate, plan gate, /tts streaming, /settings GET/PUT |
| `app/src/components/voice/AudioPlayerBar.test.jsx` | Render states, play/pause, navigation persistence |
| `app/src/components/voice/ReadAloudButton.test.jsx` | Click triggers fetch, disabled state, "playing now" indicator |

### Notes on dependencies

- **No new frontend dependencies.** Voice store uses React Context + `useReducer` (standard React 18 patterns the codebase already uses).
- **Backend**: only `openai>=1.30` is new. All other libs (`fastapi`, `apscheduler`, `sqlite3`, `hashlib`) are already present.

---

## Plan-Wide Conventions

- **Plan tier gate**: paid plans whose `plan` field is in `{"pro", "premium", "lifetime"}`. Adjust the constant `PAID_VOICE_PLANS` in `auth_middleware.py` if the actual Stripe plan keys differ.
- **Owner override**: users with `role == "admin"` always pass plan + cap checks.
- **Default voice**: `verse`. Allowed: `alloy`, `ash`, `ballad`, `coral`, `echo`, `sage`, `shimmer`, `verse`.
- **Default speed**: `1.0`. Allowed: `0.5` to `2.0`.
- **Mode A monthly cap**: enforced as **seconds of generated audio per user per calendar month**. Default `7200` (120 min); admins uncapped. Cached re-listens **do not** count against the cap (they don't hit OpenAI).
- **Cache directory**: `/data/voice_audio_cache/` on Railway, `./data/voice_audio_cache/` locally. TTL 7 days, evicted by APScheduler nightly job.
- **Commit cadence**: one commit per task, conventional prefix `feat(voice):` or `test(voice):`.
- **Test runner**: backend `pytest tests/test_voice_*.py -v`, frontend `cd app && npx vitest run --reporter=basic <path>`.

---

## Task 1: Add OpenAI SDK dependency + document env var

**Files:**
- Modify: `requirements.txt`
- Modify: `.env.example` (create if missing)

- [ ] **Step 1: Add `openai>=1.30,<2` to `requirements.txt`**

Append this single line to `requirements.txt` (preserve alphabetical placement near existing `anthropic`):

```
openai>=1.30,<2
```

- [ ] **Step 2: Install**

Run from repo root:

```bash
pip install -r requirements.txt
```

Expected: succeeds, prints `Successfully installed openai-1.x.x ...`.

- [ ] **Step 3: Verify import works**

Run:

```bash
python -c "from openai import OpenAI; print(OpenAI)"
```

Expected output: `<class 'openai.OpenAI'>`

- [ ] **Step 4: Add OPENAI_API_KEY to `.env.example`**

Open `.env.example` (create if missing). Add the following line in the API-keys section:

```
OPENAI_API_KEY=sk-...   # voice TTS (slice 1) + future Realtime/Whisper
```

If `.env.example` does not exist, create it with at minimum:

```
# API Keys
OPENAI_API_KEY=sk-...   # voice TTS (slice 1) + future Realtime/Whisper
```

Do NOT commit a real key. The user is expected to set `OPENAI_API_KEY` in Railway env vars.

- [ ] **Step 5: Commit**

```bash
git add requirements.txt .env.example
git commit -m "feat(voice): add openai SDK for TTS"
```

---

## Task 2: Add voice_settings + voice_usage_monthly DB tables

**Files:**
- Modify: `api/services/auth_db.py` (extend `_SCHEMA`)
- Test: `tests/test_voice_db_schema.py` (NEW)

- [ ] **Step 1: Write the failing test**

Create `tests/test_voice_db_schema.py`:

```python
"""Verify voice tables are created by auth_db.init_db()."""

from api.services.auth_db import init_db, get_connection


def test_voice_settings_table_exists():
    init_db()
    conn = get_connection()
    try:
        cols = conn.execute("PRAGMA table_info(voice_settings)").fetchall()
        col_names = {c["name"] for c in cols}
        assert "user_id" in col_names
        assert "enabled" in col_names
        assert "voice" in col_names
        assert "speed" in col_names
    finally:
        conn.close()


def test_voice_usage_monthly_table_exists():
    init_db()
    conn = get_connection()
    try:
        cols = conn.execute("PRAGMA table_info(voice_usage_monthly)").fetchall()
        col_names = {c["name"] for c in cols}
        assert "user_id" in col_names
        assert "year_month" in col_names
        assert "mode_a_seconds" in col_names
    finally:
        conn.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pytest tests/test_voice_db_schema.py -v
```

Expected: FAIL with "no such table: voice_settings".

- [ ] **Step 3: Add tables to `_SCHEMA` in auth_db.py**

Open `api/services/auth_db.py` and append these two `CREATE TABLE` statements to the `_SCHEMA` triple-quoted string (just before its closing `"""`):

```sql
CREATE TABLE IF NOT EXISTS voice_settings (
    user_id                       TEXT PRIMARY KEY REFERENCES users(id),
    enabled                       INTEGER NOT NULL DEFAULT 1,
    voice                         TEXT NOT NULL DEFAULT 'verse',
    speed                         REAL NOT NULL DEFAULT 1.0,
    retention_days                INTEGER NOT NULL DEFAULT 30,
    created_at                    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at                    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS voice_usage_monthly (
    user_id              TEXT NOT NULL REFERENCES users(id),
    year_month           TEXT NOT NULL,
    mode_a_seconds       INTEGER NOT NULL DEFAULT 0,
    mode_b_calls         INTEGER NOT NULL DEFAULT 0,
    mode_c_seconds       INTEGER NOT NULL DEFAULT 0,
    estimated_cost_usd   REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, year_month)
);
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pytest tests/test_voice_db_schema.py -v
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/test_voice_db_schema.py api/services/auth_db.py
git commit -m "feat(voice): add voice_settings and voice_usage_monthly tables"
```

---

## Task 3: Create voice_settings_service

**Files:**
- Create: `api/services/voice_settings_service.py`
- Test: `tests/test_voice_settings_service.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_voice_settings_service.py`:

```python
"""Voice settings service — get/upsert per-user voice preferences."""

import pytest
from api.services.auth_db import init_db, get_connection
from api.services.auth_service import create_user
from api.services.voice_settings_service import (
    get_voice_settings,
    update_voice_settings,
    ALLOWED_VOICES,
)


def _make_user():
    init_db()
    user = create_user(f"voicetest_{__import__('uuid').uuid4()}@example.com", "password123", "Test")
    return user["id"]


def test_get_returns_defaults_for_new_user():
    uid = _make_user()
    s = get_voice_settings(uid)
    assert s["enabled"] is True
    assert s["voice"] == "verse"
    assert s["speed"] == 1.0
    assert s["retention_days"] == 30


def test_update_persists_changes():
    uid = _make_user()
    update_voice_settings(uid, voice="ash", speed=1.25, enabled=False)
    s = get_voice_settings(uid)
    assert s["voice"] == "ash"
    assert s["speed"] == 1.25
    assert s["enabled"] is False


def test_update_rejects_unknown_voice():
    uid = _make_user()
    with pytest.raises(ValueError, match="voice"):
        update_voice_settings(uid, voice="not-a-real-voice")


def test_update_rejects_speed_out_of_range():
    uid = _make_user()
    with pytest.raises(ValueError, match="speed"):
        update_voice_settings(uid, speed=3.0)
    with pytest.raises(ValueError, match="speed"):
        update_voice_settings(uid, speed=0.1)


def test_allowed_voices_includes_verse():
    assert "verse" in ALLOWED_VOICES
    assert "alloy" in ALLOWED_VOICES
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pytest tests/test_voice_settings_service.py -v
```

Expected: FAIL with "No module named 'api.services.voice_settings_service'".

- [ ] **Step 3: Implement the service**

Create `api/services/voice_settings_service.py`:

```python
"""
Voice settings service — per-user voice preferences for TTS / future modes.

Storage: voice_settings table in auth.db (created in api/services/auth_db.py).
"""

from datetime import datetime, timezone
from api.services.auth_db import get_connection


ALLOWED_VOICES = {"alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"}
MIN_SPEED = 0.5
MAX_SPEED = 2.0
DEFAULT_VOICE = "verse"
DEFAULT_SPEED = 1.0
DEFAULT_RETENTION_DAYS = 30


def get_voice_settings(user_id: str) -> dict:
    """Return per-user voice settings; creates a default row if missing."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT enabled, voice, speed, retention_days FROM voice_settings WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if row is None:
            conn.execute(
                """INSERT INTO voice_settings (user_id, enabled, voice, speed, retention_days)
                   VALUES (?, 1, ?, ?, ?)""",
                (user_id, DEFAULT_VOICE, DEFAULT_SPEED, DEFAULT_RETENTION_DAYS),
            )
            conn.commit()
            return {
                "enabled": True,
                "voice": DEFAULT_VOICE,
                "speed": DEFAULT_SPEED,
                "retention_days": DEFAULT_RETENTION_DAYS,
            }
        return {
            "enabled": bool(row["enabled"]),
            "voice": row["voice"],
            "speed": float(row["speed"]),
            "retention_days": int(row["retention_days"]),
        }
    finally:
        conn.close()


def update_voice_settings(
    user_id: str,
    *,
    enabled: bool | None = None,
    voice: str | None = None,
    speed: float | None = None,
    retention_days: int | None = None,
) -> dict:
    """Validate + upsert voice settings. Returns the new full settings dict."""
    if voice is not None and voice not in ALLOWED_VOICES:
        raise ValueError(f"voice must be one of {sorted(ALLOWED_VOICES)}, got {voice!r}")
    if speed is not None and not (MIN_SPEED <= speed <= MAX_SPEED):
        raise ValueError(f"speed must be in [{MIN_SPEED}, {MAX_SPEED}], got {speed}")
    if retention_days is not None and not (1 <= retention_days <= 3650):
        raise ValueError(f"retention_days must be in [1, 3650], got {retention_days}")

    # Ensure row exists (and grab current values for partial update)
    current = get_voice_settings(user_id)
    new_enabled = current["enabled"] if enabled is None else bool(enabled)
    new_voice = current["voice"] if voice is None else voice
    new_speed = current["speed"] if speed is None else float(speed)
    new_retention = current["retention_days"] if retention_days is None else int(retention_days)

    conn = get_connection()
    try:
        conn.execute(
            """UPDATE voice_settings
               SET enabled = ?, voice = ?, speed = ?, retention_days = ?, updated_at = ?
               WHERE user_id = ?""",
            (
                1 if new_enabled else 0,
                new_voice,
                new_speed,
                new_retention,
                datetime.now(timezone.utc).isoformat(),
                user_id,
            ),
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "enabled": new_enabled,
        "voice": new_voice,
        "speed": new_speed,
        "retention_days": new_retention,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pytest tests/test_voice_settings_service.py -v
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/voice_settings_service.py tests/test_voice_settings_service.py
git commit -m "feat(voice): add per-user voice settings service"
```

---

## Task 4: Create voice_usage tracking service

**Files:**
- Create: `api/services/voice_usage.py`
- Test: `tests/test_voice_usage.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_voice_usage.py`:

```python
"""Voice usage tracking — Mode A second counting + monthly cap."""

from datetime import datetime
from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services.voice_usage import (
    record_mode_a_seconds,
    get_monthly_usage,
    is_within_mode_a_cap,
    MODE_A_DEFAULT_CAP_SECONDS,
)


def _make_user():
    init_db()
    return create_user(f"vusage_{__import__('uuid').uuid4()}@example.com", "password123")["id"]


def test_first_record_creates_row():
    uid = _make_user()
    record_mode_a_seconds(uid, 30)
    usage = get_monthly_usage(uid)
    assert usage["mode_a_seconds"] == 30
    assert usage["year_month"] == datetime.utcnow().strftime("%Y-%m")


def test_record_accumulates():
    uid = _make_user()
    record_mode_a_seconds(uid, 30)
    record_mode_a_seconds(uid, 45)
    usage = get_monthly_usage(uid)
    assert usage["mode_a_seconds"] == 75


def test_within_cap_default():
    uid = _make_user()
    assert is_within_mode_a_cap(uid) is True
    record_mode_a_seconds(uid, 100)
    assert is_within_mode_a_cap(uid) is True


def test_at_cap_blocks():
    uid = _make_user()
    record_mode_a_seconds(uid, MODE_A_DEFAULT_CAP_SECONDS)
    assert is_within_mode_a_cap(uid) is False


def test_admin_uncapped(monkeypatch):
    uid = _make_user()
    record_mode_a_seconds(uid, MODE_A_DEFAULT_CAP_SECONDS + 1000)
    # Admin override path
    assert is_within_mode_a_cap(uid, is_admin=True) is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pytest tests/test_voice_usage.py -v
```

Expected: FAIL with "No module named 'api.services.voice_usage'".

- [ ] **Step 3: Implement the service**

Create `api/services/voice_usage.py`:

```python
"""
Voice usage tracking — counts Mode A (read-aloud) seconds per user per month
and enforces a configurable cap. Admin users bypass the cap.

Storage: voice_usage_monthly table in auth.db.
"""

from datetime import datetime
from api.services.auth_db import get_connection


# 120 min/month default cap. ~$1.80 OpenAI cost. Override via env in future.
MODE_A_DEFAULT_CAP_SECONDS = 7200

# Cost estimate: $0.015 / minute = $0.00025 / second
MODE_A_COST_PER_SECOND = 0.00025


def _current_year_month() -> str:
    return datetime.utcnow().strftime("%Y-%m")


def record_mode_a_seconds(user_id: str, seconds: int) -> None:
    """Add to this user's Mode A total for the current calendar month."""
    if seconds <= 0:
        return
    ym = _current_year_month()
    cost_delta = seconds * MODE_A_COST_PER_SECOND
    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO voice_usage_monthly
               (user_id, year_month, mode_a_seconds, estimated_cost_usd)
               VALUES (?, ?, ?, ?)
               ON CONFLICT (user_id, year_month) DO UPDATE SET
                 mode_a_seconds = mode_a_seconds + excluded.mode_a_seconds,
                 estimated_cost_usd = estimated_cost_usd + excluded.estimated_cost_usd""",
            (user_id, ym, int(seconds), cost_delta),
        )
        conn.commit()
    finally:
        conn.close()


def get_monthly_usage(user_id: str, year_month: str | None = None) -> dict:
    """Return usage for a given month (defaults to current). Zeros if no row."""
    ym = year_month or _current_year_month()
    conn = get_connection()
    try:
        row = conn.execute(
            """SELECT mode_a_seconds, mode_b_calls, mode_c_seconds, estimated_cost_usd
               FROM voice_usage_monthly WHERE user_id = ? AND year_month = ?""",
            (user_id, ym),
        ).fetchone()
        if row is None:
            return {
                "year_month": ym,
                "mode_a_seconds": 0,
                "mode_b_calls": 0,
                "mode_c_seconds": 0,
                "estimated_cost_usd": 0.0,
            }
        return {
            "year_month": ym,
            "mode_a_seconds": int(row["mode_a_seconds"]),
            "mode_b_calls": int(row["mode_b_calls"]),
            "mode_c_seconds": int(row["mode_c_seconds"]),
            "estimated_cost_usd": float(row["estimated_cost_usd"]),
        }
    finally:
        conn.close()


def is_within_mode_a_cap(
    user_id: str,
    *,
    cap_seconds: int = MODE_A_DEFAULT_CAP_SECONDS,
    is_admin: bool = False,
) -> bool:
    """True if user can generate more Mode A audio this month."""
    if is_admin:
        return True
    return get_monthly_usage(user_id)["mode_a_seconds"] < cap_seconds
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pytest tests/test_voice_usage.py -v
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/voice_usage.py tests/test_voice_usage.py
git commit -m "feat(voice): add Mode A monthly usage tracking + cap"
```

---

## Task 5: Create voice_audio_cache (disk-backed TTS cache)

**Files:**
- Create: `api/services/voice_audio_cache.py`
- Test: `tests/test_voice_audio_cache.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_voice_audio_cache.py`:

```python
"""Disk-backed TTS audio cache, keyed by SHA(text+voice+speed)."""

import os
import time
import tempfile
import pytest
from api.services import voice_audio_cache as vac


@pytest.fixture(autouse=True)
def isolated_cache(monkeypatch, tmp_path):
    monkeypatch.setattr(vac, "_CACHE_DIR", str(tmp_path))
    yield


def test_miss_returns_none():
    assert vac.get_cached("hello", voice="verse", speed=1.0) is None


def test_put_then_get_roundtrips():
    audio_bytes = b"FAKE-MP3-DATA"
    vac.put_cached("hello", "verse", 1.0, audio_bytes)
    got = vac.get_cached("hello", voice="verse", speed=1.0)
    assert got == audio_bytes


def test_different_voice_different_cache():
    vac.put_cached("hello", "verse", 1.0, b"AAA")
    vac.put_cached("hello", "ash", 1.0, b"BBB")
    assert vac.get_cached("hello", voice="verse", speed=1.0) == b"AAA"
    assert vac.get_cached("hello", voice="ash", speed=1.0) == b"BBB"


def test_different_speed_different_cache():
    vac.put_cached("hello", "verse", 1.0, b"AAA")
    vac.put_cached("hello", "verse", 1.5, b"CCC")
    assert vac.get_cached("hello", voice="verse", speed=1.0) == b"AAA"
    assert vac.get_cached("hello", voice="verse", speed=1.5) == b"CCC"


def test_stale_entries_treated_as_miss():
    vac.put_cached("old", "verse", 1.0, b"OLD")
    # Find the cached file and backdate its mtime past the TTL.
    files = [f for f in os.listdir(vac._CACHE_DIR) if f.endswith(".mp3")]
    assert files, "expected a cached mp3 to exist"
    target = os.path.join(vac._CACHE_DIR, files[0])
    old_ts = time.time() - (vac.CACHE_TTL_SECONDS + 60)
    os.utime(target, (old_ts, old_ts))
    assert vac.get_cached("old", voice="verse", speed=1.0) is None


def test_purge_expired_removes_stale_files(monkeypatch):
    vac.put_cached("a", "verse", 1.0, b"A")
    vac.put_cached("b", "verse", 1.0, b"B")
    files = sorted(os.listdir(vac._CACHE_DIR))
    # Backdate one file
    target = os.path.join(vac._CACHE_DIR, files[0])
    old_ts = time.time() - (vac.CACHE_TTL_SECONDS + 60)
    os.utime(target, (old_ts, old_ts))
    removed = vac.purge_expired()
    assert removed == 1
    assert len(os.listdir(vac._CACHE_DIR)) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pytest tests/test_voice_audio_cache.py -v
```

Expected: FAIL with "No module named 'api.services.voice_audio_cache'".

- [ ] **Step 3: Implement the cache**

Create `api/services/voice_audio_cache.py`:

```python
"""
Disk-backed TTS audio cache. Keyed by SHA(text + voice + speed); 7-day TTL.
Cached audio bypasses OpenAI billing and Mode A usage tracking on hit.

Cache directory:
  - Railway: /data/voice_audio_cache/  (persistent volume)
  - Local:   ./data/voice_audio_cache/
"""

import os
import hashlib
import time
import logging

_log = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 7 * 24 * 3600  # 7 days

_RAILWAY_CACHE = "/data/voice_audio_cache"
if os.path.isdir("/data"):
    _CACHE_DIR = _RAILWAY_CACHE
else:
    _CACHE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "voice_audio_cache")

os.makedirs(_CACHE_DIR, exist_ok=True)


def _key(text: str, voice: str, speed: float) -> str:
    h = hashlib.sha256()
    h.update(text.encode("utf-8"))
    h.update(b"\x00")
    h.update(voice.encode("utf-8"))
    h.update(b"\x00")
    h.update(f"{speed:.4f}".encode("utf-8"))
    return h.hexdigest()


def _path_for(text: str, voice: str, speed: float) -> str:
    return os.path.join(_CACHE_DIR, _key(text, voice, speed) + ".mp3")


def get_cached(text: str, *, voice: str, speed: float) -> bytes | None:
    """Return cached MP3 bytes, or None if missing/expired."""
    p = _path_for(text, voice, speed)
    if not os.path.exists(p):
        return None
    age = time.time() - os.path.getmtime(p)
    if age > CACHE_TTL_SECONDS:
        return None
    try:
        with open(p, "rb") as f:
            return f.read()
    except OSError as e:
        _log.warning("voice cache read failed for %s: %s", p, e)
        return None


def put_cached(text: str, voice: str, speed: float, audio_bytes: bytes) -> None:
    """Atomically write audio_bytes to the cache."""
    p = _path_for(text, voice, speed)
    tmp = p + ".tmp"
    try:
        with open(tmp, "wb") as f:
            f.write(audio_bytes)
        os.replace(tmp, p)
    except OSError as e:
        _log.warning("voice cache write failed for %s: %s", p, e)
        try:
            os.remove(tmp)
        except OSError:
            pass


def purge_expired() -> int:
    """Remove cache files older than CACHE_TTL_SECONDS. Returns count removed."""
    removed = 0
    now = time.time()
    for name in os.listdir(_CACHE_DIR):
        if not name.endswith(".mp3"):
            continue
        full = os.path.join(_CACHE_DIR, name)
        try:
            if now - os.path.getmtime(full) > CACHE_TTL_SECONDS:
                os.remove(full)
                removed += 1
        except OSError:
            continue
    if removed:
        _log.info("voice cache purged %d expired file(s)", removed)
    return removed
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pytest tests/test_voice_audio_cache.py -v
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/voice_audio_cache.py tests/test_voice_audio_cache.py
git commit -m "feat(voice): add disk-backed TTS audio cache (7-day TTL)"
```

---

## Task 6: Create voice_openai (TTS API wrapper)

**Files:**
- Create: `api/services/voice_openai.py`
- Test: `tests/test_voice_openai.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_voice_openai.py`:

```python
"""Voice OpenAI wrapper — TTS streaming + retry."""

from unittest.mock import MagicMock, patch
import pytest
from api.services import voice_openai


def test_synthesize_returns_bytes_from_sdk():
    fake_resp = MagicMock()
    fake_resp.iter_bytes.return_value = iter([b"chunk1", b"chunk2"])
    fake_ctx = MagicMock()
    fake_ctx.__enter__.return_value = fake_resp
    fake_ctx.__exit__.return_value = False

    fake_client = MagicMock()
    fake_client.audio.speech.with_streaming_response.create.return_value = fake_ctx

    with patch.object(voice_openai, "_get_client", return_value=fake_client):
        out = voice_openai.synthesize_speech("hello", voice="verse", speed=1.0)

    assert out == b"chunk1chunk2"
    fake_client.audio.speech.with_streaming_response.create.assert_called_once()
    kwargs = fake_client.audio.speech.with_streaming_response.create.call_args.kwargs
    assert kwargs["model"] == "tts-1"
    assert kwargs["voice"] == "verse"
    assert kwargs["input"] == "hello"
    assert kwargs["speed"] == 1.0
    assert kwargs["response_format"] == "mp3"


def test_synthesize_truncates_oversize_text():
    fake_resp = MagicMock()
    fake_resp.iter_bytes.return_value = iter([b"x"])
    fake_ctx = MagicMock()
    fake_ctx.__enter__.return_value = fake_resp
    fake_ctx.__exit__.return_value = False

    fake_client = MagicMock()
    fake_client.audio.speech.with_streaming_response.create.return_value = fake_ctx

    long_text = "a" * (voice_openai.MAX_INPUT_CHARS + 500)
    with patch.object(voice_openai, "_get_client", return_value=fake_client):
        voice_openai.synthesize_speech(long_text, voice="verse", speed=1.0)

    sent = fake_client.audio.speech.with_streaming_response.create.call_args.kwargs["input"]
    assert len(sent) <= voice_openai.MAX_INPUT_CHARS


def test_synthesize_rejects_empty_text():
    with pytest.raises(ValueError, match="empty"):
        voice_openai.synthesize_speech("", voice="verse", speed=1.0)
    with pytest.raises(ValueError, match="empty"):
        voice_openai.synthesize_speech("   ", voice="verse", speed=1.0)
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pytest tests/test_voice_openai.py -v
```

Expected: FAIL with "No module named 'api.services.voice_openai'".

- [ ] **Step 3: Implement the wrapper**

Create `api/services/voice_openai.py`:

```python
"""
OpenAI voice client — thin wrapper around openai.audio.speech for TTS.
Centralizes API key resolution + retries + size limits.

Slice 1 covers TTS only. Slice 2 will add Whisper + gpt-4o-mini here;
slice 4 will add Realtime session token minting.
"""

import os
import logging
import time
from openai import OpenAI
from openai import APIConnectionError, APIStatusError, RateLimitError

_log = logging.getLogger(__name__)

# OpenAI tts-1 hard limit is ~4096 chars. Stay safely under.
MAX_INPUT_CHARS = 4000

_TTS_MODEL = "tts-1"

_client = None


def _get_client() -> OpenAI:
    """Lazy singleton — fails fast at first use if OPENAI_API_KEY missing."""
    global _client
    if _client is None:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not set")
        _client = OpenAI(api_key=api_key)
    return _client


def synthesize_speech(text: str, *, voice: str, speed: float) -> bytes:
    """
    Synthesize MP3 audio for `text` using OpenAI tts-1.
    Returns the full MP3 bytes (callers stream them to the client).
    Retries up to 3 times on transient errors.
    """
    if not text or not text.strip():
        raise ValueError("text is empty")
    if len(text) > MAX_INPUT_CHARS:
        _log.warning("voice synth: truncating %d -> %d chars", len(text), MAX_INPUT_CHARS)
        text = text[:MAX_INPUT_CHARS]

    client = _get_client()
    last_err: Exception | None = None
    for attempt in range(1, 4):
        try:
            with client.audio.speech.with_streaming_response.create(
                model=_TTS_MODEL,
                voice=voice,
                input=text,
                speed=speed,
                response_format="mp3",
            ) as resp:
                buf = bytearray()
                for chunk in resp.iter_bytes():
                    buf.extend(chunk)
                return bytes(buf)
        except (APIConnectionError, RateLimitError) as e:
            last_err = e
            sleep_s = 0.5 * (2 ** (attempt - 1))
            _log.warning("voice synth attempt %d failed: %s — retry in %.1fs", attempt, e, sleep_s)
            time.sleep(sleep_s)
        except APIStatusError as e:
            # 4xx — do not retry
            raise
    assert last_err is not None
    raise last_err
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pytest tests/test_voice_openai.py -v
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/voice_openai.py tests/test_voice_openai.py
git commit -m "feat(voice): add OpenAI tts-1 wrapper with retry + size limits"
```

---

## Task 7: Add `requires_voice_access` auth dependency

**Files:**
- Modify: `api/middleware/auth_middleware.py`

- [ ] **Step 1: Inspect existing patterns**

Open `api/middleware/auth_middleware.py` (already short — see existing `require_plan` factory). The new dependency follows the same factory style.

- [ ] **Step 2: Append `requires_voice_access` to the file**

Add this code at the end of `api/middleware/auth_middleware.py`:

```python


# ── Voice access ────────────────────────────────────────────────────────────

# Adjust if the actual Stripe plan keys differ. Admins always pass.
PAID_VOICE_PLANS = {"pro", "premium", "lifetime"}


def requires_voice_access(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Dependency: gates voice endpoints to paid plans + admins."""
    if user.get("role") == "admin":
        return user
    if user.get("plan") not in PAID_VOICE_PLANS:
        raise HTTPException(status_code=402, detail="Voice features require a paid plan")
    return user
```

- [ ] **Step 3: Verify import shape**

Run:

```bash
python -c "from api.middleware.auth_middleware import requires_voice_access, PAID_VOICE_PLANS; print(PAID_VOICE_PLANS)"
```

Expected output: `{'pro', 'premium', 'lifetime'}` (in some order).

- [ ] **Step 4: Commit**

```bash
git add api/middleware/auth_middleware.py
git commit -m "feat(voice): add requires_voice_access dependency"
```

---

## Task 8: Voice router — `/api/voice/tts` endpoint

**Files:**
- Create: `api/routers/voice.py`
- Test: `tests/test_voice_router.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_voice_router.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pytest tests/test_voice_router.py -v
```

Expected: FAIL — module `api.routers.voice` does not exist yet.

- [ ] **Step 3: Implement the router (TTS endpoint only for this task)**

Create `api/routers/voice.py`:

```python
"""
Voice router — TTS, settings, usage. Slice 1 (Mode A only).
Future slices add /oneshot, /session_token, /exec, /transcripts, /tools.
"""

import logging
from io import BytesIO
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from api.limiter import limiter
from api.middleware.auth_middleware import requires_voice_access
from api.services.voice_settings_service import (
    get_voice_settings,
    update_voice_settings,
    ALLOWED_VOICES,
    MIN_SPEED,
    MAX_SPEED,
)
from api.services.voice_usage import (
    record_mode_a_seconds,
    get_monthly_usage,
    is_within_mode_a_cap,
)
from api.services.voice_audio_cache import get_cached, put_cached
from api.services.voice_openai import synthesize_speech, MAX_INPUT_CHARS

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/voice", tags=["voice"])


# ── Schemas ─────────────────────────────────────────────────────────────────

class TtsRequest(BaseModel):
    text: str
    voice: str | None = None
    speed: float | None = Field(None, ge=MIN_SPEED, le=MAX_SPEED)


# ── Helpers ─────────────────────────────────────────────────────────────────

def _estimate_seconds(text: str, speed: float) -> int:
    """
    Rough estimate used for usage tracking.
    English read-aloud ≈ 150 wpm at speed=1.0 ≈ 2.5 words/sec.
    Speed scales linearly. Always returns at least 1.
    """
    words = max(1, len(text.split()))
    base_seconds = words / 2.5
    seconds = int(round(base_seconds / max(speed, 0.1)))
    return max(1, seconds)


# ── Endpoints ───────────────────────────────────────────────────────────────

@router.post("/tts")
@limiter.limit("30/minute")
def tts(request: Request, body: TtsRequest, user: dict = Depends(requires_voice_access)):
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    if len(text) > MAX_INPUT_CHARS:
        # Truncation also happens in synthesize_speech, but reject obviously oversize.
        raise HTTPException(
            status_code=400,
            detail=f"text exceeds max length ({MAX_INPUT_CHARS} chars)",
        )

    settings = get_voice_settings(user["id"])
    voice = body.voice or settings["voice"]
    speed = body.speed if body.speed is not None else settings["speed"]
    if voice not in ALLOWED_VOICES:
        raise HTTPException(status_code=400, detail=f"unknown voice: {voice}")

    is_admin = user.get("role") == "admin"
    if not is_within_mode_a_cap(user["id"], is_admin=is_admin):
        raise HTTPException(status_code=429, detail="monthly read-aloud cap reached")

    cached = get_cached(text, voice=voice, speed=speed)
    if cached is not None:
        return Response(content=cached, media_type="audio/mpeg")

    try:
        audio_bytes = synthesize_speech(text, voice=voice, speed=speed)
    except RuntimeError as e:
        # Missing API key etc.
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:  # noqa: BLE001 — bubble OpenAI errors as 502
        _log.exception("voice synth failed")
        raise HTTPException(status_code=502, detail=f"TTS failed: {e}")

    put_cached(text, voice, speed, audio_bytes)
    record_mode_a_seconds(user["id"], _estimate_seconds(text, speed))
    return Response(content=audio_bytes, media_type="audio/mpeg")
```

- [ ] **Step 4: Wire router into `api/main.py`**

In `api/main.py`, find the block of `from api.routers import ... as ..._router` lines (around lines 30–55). Add:

```python
from api.routers import voice as voice_router
```

Then locate the `app.include_router(...)` calls (search for `include_router`). Add this near the others (e.g., after `transcripts_router`):

```python
app.include_router(voice_router.router)
```

- [ ] **Step 5: Run router tests to verify they pass**

Run:

```bash
pytest tests/test_voice_router.py -v
```

Expected: 5 tests PASS. (Settings + usage tests are added in subsequent tasks.)

- [ ] **Step 6: Commit**

```bash
git add api/routers/voice.py api/main.py tests/test_voice_router.py
git commit -m "feat(voice): add /api/voice/tts endpoint with cache + usage"
```

---

## Task 9: Voice router — `/settings` GET/PUT and `/usage` GET

**Files:**
- Modify: `api/routers/voice.py`
- Modify: `tests/test_voice_router.py` (extend)

- [ ] **Step 1: Add settings + usage tests**

Append to `tests/test_voice_router.py`:

```python


# ── Settings + Usage ────────────────────────────────────────────────────────

def test_settings_get_returns_defaults_for_new_paid_user(client):
    _login(client, plan="pro")
    r = client.get("/api/voice/settings")
    assert r.status_code == 200
    body = r.json()
    assert body["voice"] == "verse"
    assert body["speed"] == 1.0
    assert body["enabled"] is True


def test_settings_put_persists(client):
    _login(client, plan="pro")
    r = client.put("/api/voice/settings", json={"voice": "ash", "speed": 1.25})
    assert r.status_code == 200
    body = r.json()
    assert body["voice"] == "ash"
    assert body["speed"] == 1.25
    # Re-fetch to confirm
    r2 = client.get("/api/voice/settings")
    assert r2.json()["voice"] == "ash"


def test_settings_put_rejects_invalid_voice(client):
    _login(client, plan="pro")
    r = client.put("/api/voice/settings", json={"voice": "not-real"})
    assert r.status_code == 400


def test_settings_requires_paid(client):
    _login(client, plan="free")
    assert client.get("/api/voice/settings").status_code == 402
    assert client.put("/api/voice/settings", json={"voice": "ash"}).status_code == 402


def test_usage_returns_current_month(client):
    _login(client, plan="pro")
    r = client.get("/api/voice/usage")
    assert r.status_code == 200
    body = r.json()
    assert "year_month" in body
    assert "mode_a_seconds" in body
    assert "cap_seconds" in body
    assert body["mode_a_seconds"] == 0
    assert body["cap_seconds"] > 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pytest tests/test_voice_router.py -v
```

Expected: 5 new tests FAIL with 404 (endpoints don't exist yet).

- [ ] **Step 3: Add settings + usage endpoints to `api/routers/voice.py`**

Add these imports at the top (if not already present):

```python
from api.services.voice_usage import MODE_A_DEFAULT_CAP_SECONDS
```

Add a new schema below `TtsRequest`:

```python
class SettingsUpdateRequest(BaseModel):
    enabled: bool | None = None
    voice: str | None = None
    speed: float | None = Field(None, ge=MIN_SPEED, le=MAX_SPEED)
    retention_days: int | None = Field(None, ge=1, le=3650)
```

Append these endpoints at the end of `api/routers/voice.py`:

```python


@router.get("/settings")
def settings_get(user: dict = Depends(requires_voice_access)):
    return get_voice_settings(user["id"])


@router.put("/settings")
@limiter.limit("30/minute")
def settings_put(
    request: Request,
    body: SettingsUpdateRequest,
    user: dict = Depends(requires_voice_access),
):
    try:
        return update_voice_settings(
            user["id"],
            enabled=body.enabled,
            voice=body.voice,
            speed=body.speed,
            retention_days=body.retention_days,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/usage")
def usage_get(user: dict = Depends(requires_voice_access)):
    is_admin = user.get("role") == "admin"
    cap = float("inf") if is_admin else MODE_A_DEFAULT_CAP_SECONDS
    u = get_monthly_usage(user["id"])
    return {
        **u,
        "cap_seconds": cap if cap != float("inf") else None,
        "uncapped": is_admin,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pytest tests/test_voice_router.py -v
```

Expected: 10 tests PASS (5 from Task 8 + 5 from this task).

- [ ] **Step 5: Commit**

```bash
git add api/routers/voice.py tests/test_voice_router.py
git commit -m "feat(voice): add /api/voice/settings and /api/voice/usage"
```

---

## Task 10: Schedule nightly cache purge in main.py

**Files:**
- Modify: `api/main.py`

- [ ] **Step 1: Locate the scheduler init**

Open `api/main.py` and search for `scheduler` (lower-case). The codebase already initializes APScheduler for COT and breadth jobs. Find the place where existing jobs are added (look for `scheduler.add_job(...)` calls) and prepare to add one more.

- [ ] **Step 2: Add the import near the top**

Add this with the other service imports:

```python
from api.services.voice_audio_cache import purge_expired as _voice_cache_purge
```

- [ ] **Step 3: Add the scheduled job**

Inside the scheduler-setup block (next to other `scheduler.add_job` calls), add:

```python
# Voice TTS cache cleanup — daily at 3:30 AM ET.
scheduler.add_job(
    _voice_cache_purge,
    "cron",
    hour=3,
    minute=30,
    timezone=ZoneInfo("America/New_York"),
    id="voice_audio_cache_purge",
    replace_existing=True,
)
```

If `ZoneInfo` is not already imported in `main.py`, add `from zoneinfo import ZoneInfo` at the top (it is — see line 7 of the existing file).

- [ ] **Step 4: Verify the import resolves**

Run:

```bash
python -c "from api.main import app; print('ok')"
```

Expected: prints `ok`. (Boots the app graph without errors.)

- [ ] **Step 5: Commit**

```bash
git add api/main.py
git commit -m "feat(voice): schedule nightly TTS cache purge"
```

---

## Task 11: Frontend — VoiceContext (global voice store)

**Files:**
- Create: `app/src/context/VoiceContext.jsx`

- [ ] **Step 1: Implement the context + reducer**

Create `app/src/context/VoiceContext.jsx`:

```jsx
import { createContext, useContext, useReducer, useRef, useCallback, useMemo } from 'react'

/**
 * Global voice store. Slice 1 only manages a single shared <audio> element
 * for read-aloud playback. Slice 2+ will extend to one-shot + Realtime modes.
 *
 * State shape:
 *   {
 *     status: 'idle' | 'loading' | 'playing' | 'paused' | 'error',
 *     trackId: string | null,    // identifies which ReadAloudButton is "playing"
 *     trackLabel: string | null, // shown in player bar
 *     speed: number,
 *     errorMessage: string | null,
 *   }
 */

const initialState = {
  status: 'idle',
  trackId: null,
  trackLabel: null,
  speed: 1.0,
  errorMessage: null,
}

function reducer(state, action) {
  switch (action.type) {
    case 'load':
      return { ...state, status: 'loading', trackId: action.trackId, trackLabel: action.trackLabel, errorMessage: null }
    case 'play':
      return { ...state, status: 'playing' }
    case 'pause':
      return { ...state, status: 'paused' }
    case 'stop':
      return { ...initialState, speed: state.speed }
    case 'error':
      return { ...state, status: 'error', errorMessage: action.message }
    case 'setSpeed':
      return { ...state, speed: action.speed }
    default:
      return state
  }
}

const VoiceContext = createContext(null)

export function VoiceProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  // Single shared <audio> element managed by AudioPlayerBar — ref is set there
  // via attachAudio(); everyone else just calls play/pause through dispatch helpers.
  const audioRef = useRef(null)

  const attachAudio = useCallback((el) => {
    audioRef.current = el
  }, [])

  const playUrl = useCallback(async ({ url, trackId, trackLabel }) => {
    dispatch({ type: 'load', trackId, trackLabel })
    const el = audioRef.current
    if (!el) {
      dispatch({ type: 'error', message: 'Audio element not ready' })
      return
    }
    try {
      el.src = url
      el.playbackRate = state.speed
      await el.play()
      dispatch({ type: 'play' })
    } catch (err) {
      dispatch({ type: 'error', message: err.message || 'Playback failed' })
    }
  }, [state.speed])

  const pause = useCallback(() => {
    audioRef.current?.pause()
    dispatch({ type: 'pause' })
  }, [])

  const resume = useCallback(async () => {
    try {
      await audioRef.current?.play()
      dispatch({ type: 'play' })
    } catch (err) {
      dispatch({ type: 'error', message: err.message })
    }
  }, [])

  const stop = useCallback(() => {
    const el = audioRef.current
    if (el) {
      el.pause()
      el.src = ''
    }
    dispatch({ type: 'stop' })
  }, [])

  const setSpeed = useCallback((speed) => {
    if (audioRef.current) audioRef.current.playbackRate = speed
    dispatch({ type: 'setSpeed', speed })
  }, [])

  const value = useMemo(() => ({
    ...state,
    attachAudio,
    playUrl,
    pause,
    resume,
    stop,
    setSpeed,
  }), [state, attachAudio, playUrl, pause, resume, stop, setSpeed])

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>
}

export function useVoice() {
  const ctx = useContext(VoiceContext)
  if (!ctx) throw new Error('useVoice must be used inside <VoiceProvider>')
  return ctx
}
```

- [ ] **Step 2: Quick smoke test**

Run:

```bash
cd app && npx vite build --mode development 2>&1 | tail -20
```

Expected: build succeeds (or fails ONLY because nothing imports the new file yet, which is fine — we'll wire it up in subsequent tasks).

- [ ] **Step 3: Commit**

```bash
git add app/src/context/VoiceContext.jsx
git commit -m "feat(voice): add VoiceProvider context for global TTS playback"
```

---

## Task 12: Frontend — useReadAloud hook

**Files:**
- Create: `app/src/hooks/useReadAloud.js`

- [ ] **Step 1: Implement the hook**

Create `app/src/hooks/useReadAloud.js`:

```js
import { useCallback } from 'react'
import { useVoice } from '../context/VoiceContext'

/**
 * Trigger TTS for a piece of text.
 *
 * Usage:
 *   const { play, isPlayingTrack } = useReadAloud()
 *   <button onClick={() => play({ trackId: 'wire-2026-05-08', label: 'Morning Wire',
 *                                  textProvider: () => stripHtml(rundownHtml) })}>
 *     Read aloud
 *   </button>
 *
 * `textProvider` is a sync or async function that returns the string to speak.
 * We accept a function (rather than the text directly) so the caller can defer
 * expensive HTML→text stripping until the user clicks.
 */
export default function useReadAloud() {
  const voice = useVoice()

  const play = useCallback(async ({ trackId, label, textProvider, voiceOverride, speedOverride }) => {
    if (voice.trackId === trackId && voice.status === 'playing') {
      voice.pause()
      return
    }
    if (voice.trackId === trackId && voice.status === 'paused') {
      await voice.resume()
      return
    }

    let text
    try {
      text = await Promise.resolve(textProvider())
    } catch (e) {
      console.error('[useReadAloud] textProvider failed', e)
      return
    }
    if (!text || !text.trim()) return

    const body = { text }
    if (voiceOverride) body.voice = voiceOverride
    if (speedOverride !== undefined) body.speed = speedOverride

    let blobUrl
    try {
      const r = await fetch('/api/voice/tts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        if (r.status === 402) {
          alert('Voice features require a paid plan.')
          return
        }
        if (r.status === 429) {
          alert('Monthly read-aloud cap reached.')
          return
        }
        throw new Error(`TTS failed: ${r.status}`)
      }
      const blob = await r.blob()
      blobUrl = URL.createObjectURL(blob)
    } catch (e) {
      console.error('[useReadAloud] fetch failed', e)
      return
    }

    await voice.playUrl({ url: blobUrl, trackId, trackLabel: label })
  }, [voice])

  const isPlayingTrack = (trackId) =>
    voice.trackId === trackId && (voice.status === 'playing' || voice.status === 'loading')

  const isPausedTrack = (trackId) =>
    voice.trackId === trackId && voice.status === 'paused'

  return { play, isPlayingTrack, isPausedTrack }
}
```

- [ ] **Step 2: Smoke test**

Run:

```bash
cd app && npx vite build --mode development 2>&1 | tail -20
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add app/src/hooks/useReadAloud.js
git commit -m "feat(voice): add useReadAloud hook"
```

---

## Task 13: Frontend — AudioPlayerBar component

**Files:**
- Create: `app/src/components/voice/AudioPlayerBar.jsx`
- Create: `app/src/components/voice/AudioPlayerBar.module.css`

- [ ] **Step 1: Implement the component**

Create `app/src/components/voice/AudioPlayerBar.jsx`:

```jsx
import { useEffect, useRef } from 'react'
import { useVoice } from '../../context/VoiceContext'
import styles from './AudioPlayerBar.module.css'

const SPEEDS = [0.75, 1.0, 1.25, 1.5, 2.0]

export default function AudioPlayerBar() {
  const voice = useVoice()
  const audioRef = useRef(null)

  // Register the shared <audio> element with the voice context exactly once.
  useEffect(() => {
    voice.attachAudio(audioRef.current)
    return () => voice.attachAudio(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Wire <audio> events back into the reducer
  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const onEnded = () => voice.stop()
    const onError = () => voice.stop()
    el.addEventListener('ended', onEnded)
    el.addEventListener('error', onError)
    return () => {
      el.removeEventListener('ended', onEnded)
      el.removeEventListener('error', onError)
    }
  }, [voice])

  const visible = voice.status !== 'idle'
  if (!visible) {
    // Still mount the <audio> element so it's ready when needed
    return <audio ref={audioRef} preload="auto" hidden />
  }

  const isPlaying = voice.status === 'playing'
  const isLoading = voice.status === 'loading'
  const isError = voice.status === 'error'

  return (
    <div className={styles.bar} role="region" aria-label="Audio playback">
      <audio ref={audioRef} preload="auto" />
      <button
        type="button"
        className={styles.iconBtn}
        onClick={() => (isPlaying ? voice.pause() : voice.resume())}
        disabled={isLoading || isError}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isLoading ? '…' : isPlaying ? '❚❚' : '▶'}
      </button>
      <div className={styles.label}>
        {voice.trackLabel || 'Audio'}
        {isError && <span className={styles.errorTag}> · {voice.errorMessage || 'Error'}</span>}
      </div>
      <select
        className={styles.speedSel}
        value={voice.speed}
        onChange={(e) => voice.setSpeed(parseFloat(e.target.value))}
        aria-label="Playback speed"
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>{s}×</option>
        ))}
      </select>
      <button
        type="button"
        className={styles.iconBtn}
        onClick={voice.stop}
        aria-label="Stop"
      >
        ✕
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Add styles**

Create `app/src/components/voice/AudioPlayerBar.module.css`:

```css
.bar {
  position: fixed;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  z-index: 9000;
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(15, 17, 14, 0.95);
  border: 1px solid rgba(201, 168, 76, 0.3);
  border-radius: 999px;
  padding: 8px 16px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
  font: 13px/1.2 'IBM Plex Sans', system-ui, sans-serif;
  color: #e8e6df;
  max-width: min(760px, calc(100vw - 24px));
}

.iconBtn {
  background: transparent;
  border: none;
  color: #c9a84c;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.iconBtn:hover { background: rgba(201, 168, 76, 0.12); }
.iconBtn:disabled { opacity: 0.5; cursor: default; }

.label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.errorTag { color: #f87171; }

.speedSel {
  background: rgba(255, 255, 255, 0.06);
  color: inherit;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  padding: 3px 6px;
  font-size: 12px;
}
```

- [ ] **Step 3: Smoke test**

Run:

```bash
cd app && npx vite build --mode development 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/voice/AudioPlayerBar.jsx app/src/components/voice/AudioPlayerBar.module.css
git commit -m "feat(voice): add AudioPlayerBar global player"
```

---

## Task 14: Frontend — ReadAloudButton component

**Files:**
- Create: `app/src/components/voice/ReadAloudButton.jsx`
- Create: `app/src/components/voice/ReadAloudButton.module.css`

- [ ] **Step 1: Implement the component**

Create `app/src/components/voice/ReadAloudButton.jsx`:

```jsx
import useReadAloud from '../../hooks/useReadAloud'
import styles from './ReadAloudButton.module.css'

/**
 * <ReadAloudButton trackId="wire-2026-05-08" label="Morning Wire" textProvider={() => '...'} />
 *
 * - trackId: stable id so the same button reflects "playing now" state across re-renders
 * - label: shown in the AudioPlayerBar while this track plays
 * - textProvider: sync or async () => string. Called on click. May fetch.
 * - size: 'sm' (default) | 'md'
 */
export default function ReadAloudButton({ trackId, label, textProvider, size = 'sm', children }) {
  const { play, isPlayingTrack, isPausedTrack } = useReadAloud()
  const playingNow = isPlayingTrack(trackId)
  const pausedHere = isPausedTrack(trackId)

  const onClick = () => play({ trackId, label, textProvider })

  const icon = playingNow ? '❚❚' : pausedHere ? '▶' : '🔊'
  const aria = playingNow ? 'Pause read-aloud' : pausedHere ? 'Resume read-aloud' : 'Read aloud'

  return (
    <button
      type="button"
      className={`${styles.btn} ${size === 'md' ? styles.md : styles.sm} ${playingNow ? styles.playing : ''}`}
      onClick={onClick}
      aria-label={aria}
      title={aria}
    >
      <span className={styles.icon} aria-hidden="true">{icon}</span>
      {children && <span className={styles.text}>{children}</span>}
    </button>
  )
}
```

- [ ] **Step 2: Add styles**

Create `app/src/components/voice/ReadAloudButton.module.css`:

```css
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(201, 168, 76, 0.08);
  border: 1px solid rgba(201, 168, 76, 0.25);
  color: #c9a84c;
  border-radius: 999px;
  cursor: pointer;
  font: 12px/1.2 'IBM Plex Sans', system-ui, sans-serif;
  transition: background 120ms ease, border-color 120ms ease;
}
.btn:hover {
  background: rgba(201, 168, 76, 0.18);
  border-color: rgba(201, 168, 76, 0.5);
}
.btn:focus-visible {
  outline: 2px solid #c9a84c;
  outline-offset: 1px;
}
.sm { padding: 4px 10px; font-size: 11px; }
.md { padding: 6px 14px; font-size: 13px; }
.playing {
  background: rgba(201, 168, 76, 0.25);
  border-color: rgba(201, 168, 76, 0.7);
}
.icon { display: inline-block; min-width: 14px; text-align: center; }
.text { letter-spacing: 0.5px; }
```

- [ ] **Step 3: Smoke test**

Run:

```bash
cd app && npx vite build --mode development 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/voice/ReadAloudButton.jsx app/src/components/voice/ReadAloudButton.module.css
git commit -m "feat(voice): add reusable ReadAloudButton component"
```

---

## Task 15: Frontend — Wire VoiceProvider + AudioPlayerBar into App.jsx

**Files:**
- Modify: `app/src/App.jsx`

- [ ] **Step 1: Inspect existing App.jsx structure**

Open `app/src/App.jsx` and locate (a) the top-level provider chain (look for context providers near the root render) and (b) the JSX that renders inside the providers (the routes / main layout).

- [ ] **Step 2: Add imports**

At the top of `app/src/App.jsx`, with the other component imports, add:

```jsx
import { VoiceProvider } from './context/VoiceContext'
import AudioPlayerBar from './components/voice/AudioPlayerBar'
```

- [ ] **Step 3: Wrap the app in VoiceProvider and mount AudioPlayerBar**

Find the outer-most provider (e.g., `<AuthProvider>` or similar) inside `App()`'s return. Add `<VoiceProvider>` as the innermost provider so it can read auth state on demand from fetches. Mount `<AudioPlayerBar />` once at the same level as the rest of the layout (e.g., a sibling of `<Routes>`). Example shape (adapt to whatever the file currently has):

```jsx
return (
  <AuthProvider>
    <VoiceProvider>
      {/* existing layout/routes here */}
      <Routes>{/* ... */}</Routes>
      <AudioPlayerBar />
    </VoiceProvider>
  </AuthProvider>
)
```

If `App.jsx` already has multiple stacked providers, place `VoiceProvider` immediately above the route tree. The `<AudioPlayerBar />` must render inside `VoiceProvider`.

- [ ] **Step 4: Smoke test by running the dev server**

Run:

```bash
cd app && npx vite build --mode development 2>&1 | tail -10
```

Expected: build succeeds, no React errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/App.jsx
git commit -m "feat(voice): mount VoiceProvider + AudioPlayerBar globally"
```

---

## Task 16: Frontend — Voice settings panel in Settings page

**Files:**
- Modify: `app/src/pages/Settings.jsx`
- Modify: `app/src/pages/Settings.module.css`

- [ ] **Step 1: Add a `VoicePanel` component inside `Settings.jsx`**

Open `app/src/pages/Settings.jsx`. Near the existing helper components (e.g., `AvatarUpload`), add:

```jsx
function VoicePanel() {
  const [settings, setSettings] = useState(null)
  const [usage, setUsage] = useState(null)
  const [savingMsg, setSavingMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/voice/settings', { credentials: 'include' }).then(r => r.ok ? r.json() : null),
      fetch('/api/voice/usage', { credentials: 'include' }).then(r => r.ok ? r.json() : null),
    ]).then(([s, u]) => {
      if (cancelled) return
      setSettings(s)
      setUsage(u)
    })
    return () => { cancelled = true }
  }, [])

  if (!settings) {
    return <TileCard title="Voice"><div style={{ opacity: 0.7 }}>Voice features require a paid plan.</div></TileCard>
  }

  const update = async (patch) => {
    setSavingMsg('Saving…')
    const r = await fetch('/api/voice/settings', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (r.ok) {
      const next = await r.json()
      setSettings(next)
      setSavingMsg('Saved ✓')
      setTimeout(() => setSavingMsg(''), 1500)
    } else {
      setSavingMsg('Save failed')
    }
  }

  const VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse']
  const usedSec = usage?.mode_a_seconds ?? 0
  const capSec = usage?.cap_seconds ?? null
  const pct = capSec ? Math.min(100, Math.round((usedSec / capSec) * 100)) : 0

  return (
    <TileCard title="Voice">
      <div className={styles.voiceRow}>
        <label className={styles.voiceLabel}>
          <input
            type="checkbox"
            checked={!!settings.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          {' '}Voice features enabled
        </label>
      </div>

      <div className={styles.voiceRow}>
        <span className={styles.voiceLabel}>Voice</span>
        <select value={settings.voice} onChange={(e) => update({ voice: e.target.value })}>
          {VOICES.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>

      <div className={styles.voiceRow}>
        <span className={styles.voiceLabel}>Speed</span>
        <input
          type="range"
          min="0.5"
          max="2.0"
          step="0.05"
          value={settings.speed}
          onChange={(e) => update({ speed: parseFloat(e.target.value) })}
        />
        <span className={styles.voiceVal}>{settings.speed.toFixed(2)}×</span>
      </div>

      <div className={styles.voiceRow}>
        <span className={styles.voiceLabel}>This month</span>
        {usage?.uncapped ? (
          <span className={styles.voiceVal}>{Math.round(usedSec / 60)} min · uncapped</span>
        ) : (
          <>
            <div className={styles.voiceMeter}>
              <div className={styles.voiceMeterFill} style={{ width: `${pct}%` }} />
            </div>
            <span className={styles.voiceVal}>
              {Math.round(usedSec / 60)} / {Math.round((capSec || 0) / 60)} min
            </span>
          </>
        )}
      </div>

      {savingMsg && <div className={styles.voiceSaveMsg}>{savingMsg}</div>}
    </TileCard>
  )
}
```

- [ ] **Step 2: Render `<VoicePanel />` in the Settings layout**

In the same file, find the JSX that renders the existing TileCards (chart settings, account, etc.). Add `<VoicePanel />` in the panel grid — typically near the chart settings panel:

```jsx
<VoicePanel />
```

- [ ] **Step 3: Add CSS for the panel**

Open `app/src/pages/Settings.module.css` and append:

```css
.voiceRow {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 0;
  font-size: 13px;
}
.voiceLabel {
  min-width: 110px;
  opacity: 0.85;
}
.voiceVal {
  color: #c9a84c;
  font-variant-numeric: tabular-nums;
}
.voiceMeter {
  flex: 1 1 auto;
  height: 8px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  overflow: hidden;
}
.voiceMeterFill {
  height: 100%;
  background: linear-gradient(90deg, #4ade80, #c9a84c 70%, #f87171);
  transition: width 200ms ease;
}
.voiceSaveMsg {
  font-size: 12px;
  opacity: 0.7;
  margin-top: 6px;
}
```

- [ ] **Step 4: Smoke test**

Run:

```bash
cd app && npx vite build --mode development 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/Settings.jsx app/src/pages/Settings.module.css
git commit -m "feat(voice): add Voice settings panel (voice picker, speed, monthly usage)"
```

---

## Task 17: Frontend — Read-aloud button on Morning Wire

**Files:**
- Modify: `app/src/pages/MorningWire.jsx`

- [ ] **Step 1: Locate the page header / title**

Open `app/src/pages/MorningWire.jsx`. Find the JSX that renders the page heading (typically an `<h1>` or similar). The morning wire content is rendered as HTML from `wire_data.rundown_html`.

- [ ] **Step 2: Add the import**

Near the top with other imports, add:

```jsx
import ReadAloudButton from '../components/voice/ReadAloudButton'
```

- [ ] **Step 3: Add a textProvider helper next to existing helpers**

Inside the component body (or near the top of the file as a module-level const), add:

```jsx
function htmlToPlainText(html) {
  if (!html) return ''
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  // Drop class names, scripts, etc. — keep visible text only.
  return tmp.textContent.replace(/\s+/g, ' ').trim()
}
```

- [ ] **Step 4: Render the button next to the page title**

Replace the existing title block — example before:

```jsx
<h1 className={styles.pageTitle}>Morning Wire</h1>
```

…with:

```jsx
<div className={styles.titleRow}>
  <h1 className={styles.pageTitle}>Morning Wire</h1>
  <ReadAloudButton
    trackId={`morning-wire-${data?.date || 'today'}`}
    label="Morning Wire"
    textProvider={() => htmlToPlainText(data?.rundown_html)}
    size="md"
  >
    Read aloud
  </ReadAloudButton>
</div>
```

(Adapt `data?.date` and `data?.rundown_html` to whatever the actual state variable is in this file — the page already fetches the rundown.)

- [ ] **Step 5: Add `.titleRow` CSS**

Open `app/src/pages/MorningWire.module.css` and append:

```css
.titleRow {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
```

- [ ] **Step 6: Smoke test**

Run:

```bash
cd app && npx vite build --mode development 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add app/src/pages/MorningWire.jsx app/src/pages/MorningWire.module.css
git commit -m "feat(voice): read-aloud button on Morning Wire page"
```

---

## Task 18: Frontend — Read-aloud button on EarningsModal transcript

**Files:**
- Modify: `app/src/components/tiles/EarningsModal.jsx`

- [ ] **Step 1: Locate the transcript section**

Open `app/src/components/tiles/EarningsModal.jsx`. Find the section that renders the transcript AI summary (look for the area populated by `/api/transcripts/{symbol}`, typically inside a collapsible block).

- [ ] **Step 2: Add the import**

```jsx
import ReadAloudButton from '../voice/ReadAloudButton'
```

- [ ] **Step 3: Render the button in the transcript header**

Inside the transcript section, near the section heading (e.g., where a "Transcript" label or sentiment pill renders), add:

```jsx
{transcript?.summary && (
  <ReadAloudButton
    trackId={`transcript-${symbol}`}
    label={`${symbol} earnings transcript`}
    textProvider={() => {
      const headline = transcript?.headline || ''
      const bullets = (transcript?.bullets || []).join('. ')
      return `${headline}. ${bullets}`
    }}
  >
    Read transcript
  </ReadAloudButton>
)}
```

(Adapt `transcript`, `symbol`, `transcript?.headline`, `transcript?.bullets` to the actual variable names in this file.)

- [ ] **Step 4: Smoke test**

Run:

```bash
cd app && npx vite build --mode development 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/tiles/EarningsModal.jsx
git commit -m "feat(voice): read-aloud button on earnings transcript section"
```

---

## Task 19: Frontend — Read-aloud buttons on UCT20 picks

**Files:**
- Modify: `app/src/pages/UCT20.jsx`

- [ ] **Step 1: Locate the per-pick rendering**

Open `app/src/pages/UCT20.jsx`. Find the loop that renders each pick card (the card row containing rank/ticker/setup badge/return/etc.).

- [ ] **Step 2: Add the import**

```jsx
import ReadAloudButton from '../components/voice/ReadAloudButton'
```

- [ ] **Step 3: Add a "Read all picks" button at the page header**

Find the page heading and add adjacent:

```jsx
<ReadAloudButton
  trackId="uct20-all-picks"
  label="UCT 20 picks"
  textProvider={() => {
    if (!picks?.length) return ''
    return picks.map((p, i) => {
      const rank = i + 1
      const sym = p.symbol || p.sym || ''
      const setup = p.setup || ''
      const thesis = p.thesis || p.catalyst || ''
      return `Number ${rank}. ${sym}. Setup: ${setup}. ${thesis}.`
    }).join(' ')
  }}
  size="md"
>
  Read all picks
</ReadAloudButton>
```

(Adapt `picks` to the actual state name — usually the array returned from `/api/leadership`.)

- [ ] **Step 4: Add per-pick read-aloud button when a pick is expanded**

Inside the expanded-pick body (where the company desc / catalyst / price action live), add at the end:

```jsx
<ReadAloudButton
  trackId={`uct20-pick-${pick.symbol || pick.sym}`}
  label={`UCT 20 — ${pick.symbol || pick.sym}`}
  textProvider={() => {
    const sym = pick.symbol || pick.sym || ''
    const desc = pick.description || ''
    const cat = pick.catalyst || ''
    const action = pick.price_action || ''
    return `${sym}. ${desc}. Catalyst: ${cat}. Price action: ${action}.`
  }}
>
  Read
</ReadAloudButton>
```

- [ ] **Step 5: Smoke test**

Run:

```bash
cd app && npx vite build --mode development 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add app/src/pages/UCT20.jsx
git commit -m "feat(voice): read-aloud buttons on UCT20 picks (per-pick + read-all)"
```

---

## Task 20: Frontend — Read-aloud button on SetupLibrary entries

**Files:**
- Modify: `app/src/pages/SetupLibrary.jsx`

- [ ] **Step 1: Inspect the page**

Open `app/src/pages/SetupLibrary.jsx`. Identify how setup entries are rendered (usually a list of cards with name, description, criteria, etc.).

- [ ] **Step 2: Add the import**

```jsx
import ReadAloudButton from '../components/voice/ReadAloudButton'
```

- [ ] **Step 3: Add per-setup read-aloud button**

Inside the per-setup card body (next to the title or in the action row), add:

```jsx
<ReadAloudButton
  trackId={`setup-${setup.id || setup.name}`}
  label={setup.name || 'Setup'}
  textProvider={() => {
    const parts = [
      setup.name,
      setup.description || '',
      setup.entry_criteria ? `Entry: ${setup.entry_criteria}.` : '',
      setup.exit_criteria ? `Exit: ${setup.exit_criteria}.` : '',
      setup.notes || '',
    ]
    return parts.filter(Boolean).join(' ')
  }}
>
  Read
</ReadAloudButton>
```

(Adapt the field names — `description`, `entry_criteria`, etc. — to match the actual setup object shape in this file.)

- [ ] **Step 4: Smoke test**

Run:

```bash
cd app && npx vite build --mode development 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/SetupLibrary.jsx
git commit -m "feat(voice): read-aloud button on Setup Library entries"
```

---

## Task 21: Frontend tests — ReadAloudButton + AudioPlayerBar

**Files:**
- Create: `app/src/components/voice/ReadAloudButton.test.jsx`
- Create: `app/src/components/voice/AudioPlayerBar.test.jsx`

- [ ] **Step 1: Write ReadAloudButton tests**

Create `app/src/components/voice/ReadAloudButton.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { VoiceProvider } from '../../context/VoiceContext'
import ReadAloudButton from './ReadAloudButton'

function wrap(node) {
  return render(<VoiceProvider>{node}</VoiceProvider>)
}

describe('ReadAloudButton', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['audio'], { type: 'audio/mpeg' })),
    })
    global.URL.createObjectURL = vi.fn(() => 'blob:fake')
    // jsdom <audio> doesn't implement play/pause — stub them.
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue()
    HTMLMediaElement.prototype.pause = vi.fn()
  })

  it('renders the read-aloud icon by default', () => {
    wrap(<ReadAloudButton trackId="t1" label="Test" textProvider={() => 'hi'} />)
    expect(screen.getByRole('button')).toBeTruthy()
  })

  it('fires a TTS fetch on click', async () => {
    wrap(<ReadAloudButton trackId="t1" label="Test" textProvider={() => 'hello'} />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/voice/tts',
        expect.objectContaining({ method: 'POST' })
      )
    })
  })

  it('does not fetch when textProvider returns empty', async () => {
    wrap(<ReadAloudButton trackId="t1" label="Test" textProvider={() => ''} />)
    fireEvent.click(screen.getByRole('button'))
    // microtask flush
    await Promise.resolve()
    expect(fetch).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they pass**

Run:

```bash
cd app && npx vitest run src/components/voice/ReadAloudButton.test.jsx --reporter=basic
```

Expected: 3 tests PASS.

- [ ] **Step 3: Write AudioPlayerBar tests**

Create `app/src/components/voice/AudioPlayerBar.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VoiceProvider } from '../../context/VoiceContext'
import AudioPlayerBar from './AudioPlayerBar'

describe('AudioPlayerBar', () => {
  it('renders only a hidden <audio> when idle', () => {
    const { container } = render(
      <VoiceProvider><AudioPlayerBar /></VoiceProvider>
    )
    expect(container.querySelector('audio')).toBeTruthy()
    expect(screen.queryByRole('region')).toBeNull()
  })
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd app && npx vitest run src/components/voice/AudioPlayerBar.test.jsx --reporter=basic
```

Expected: 1 test PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/voice/ReadAloudButton.test.jsx app/src/components/voice/AudioPlayerBar.test.jsx
git commit -m "test(voice): unit tests for ReadAloudButton + AudioPlayerBar"
```

---

## Task 22: End-to-end manual verification

**Files:** none (manual)

This task is a manual smoke test before merging. Per the CLAUDE.md system instructions: UI changes need to be verified in a browser, not just via type-check / unit tests.

- [ ] **Step 1: Start the backend**

```bash
cd C:/Users/Patrick/uct-dashboard
uvicorn api.main:app --reload --port 8000
```

Watch for `[startup]` lines. Expected: no exceptions, server reaches "Application startup complete."

- [ ] **Step 2: Start the frontend**

In a second terminal:

```bash
cd C:/Users/Patrick/uct-dashboard/app
npm run dev
```

Note the port (usually 5173).

- [ ] **Step 3: Verify Voice settings panel**

In a browser:

1. Log in as a paid-plan user (or admin user — owner email is always admin per CLAUDE.md).
2. Navigate to `/settings`.
3. Confirm the **Voice** panel renders with: enabled checkbox, voice picker (8 options), speed slider, monthly usage meter.
4. Change voice to `ash` — confirm "Saved ✓" appears, refresh, confirm voice persisted as `ash`.

- [ ] **Step 4: Verify read-aloud on Morning Wire**

1. Navigate to `/morning-wire`.
2. Click "Read aloud" next to the page title.
3. Within ~1.5s, the AudioPlayerBar should appear at the bottom and audio should start playing.
4. Click the pause button → playback pauses, icon flips to ▶.
5. Click again → resumes.
6. Change speed dropdown to `1.5×` → playback rate adjusts immediately.
7. Click ✕ → bar disappears, audio stops.

- [ ] **Step 5: Verify cache hits**

1. Click "Read aloud" again on the same morning wire.
2. Open DevTools Network tab — the second `/api/voice/tts` call should succeed in <100ms (served from disk cache).

- [ ] **Step 6: Verify usage meter increments**

1. Refresh `/settings` and confirm the monthly usage meter has incremented (e.g., from 0 min to ~1–2 min depending on wire length).
2. Confirm the cap shown (~120 min default).

- [ ] **Step 7: Verify free-plan blocks access**

1. Log out, log in as a free-plan user (or temporarily downgrade in DB).
2. Click any "Read aloud" button → expect an alert: `Voice features require a paid plan.`
3. The Voice panel in `/settings` should show: "Voice features require a paid plan."

- [ ] **Step 8: Verify earnings transcript + UCT20 buttons**

1. Open an earnings entry (Calendar → click a ticker with a reported transcript). Click "Read transcript".
2. Confirm the player bar shows `<SYMBOL> earnings transcript` and audio plays.
3. Navigate to `/uct20`. Click "Read all picks" — confirm narration includes "Number 1.", "Number 2.", etc.
4. Expand a single pick, click its "Read" button — confirm only that pick's text is read.

- [ ] **Step 9: Document any issues**

If any step fails, do NOT mark the task complete. File the issue, fix in the relevant earlier task, recommit, and re-run from Step 1.

- [ ] **Step 10: Final all-tests pass**

Run:

```bash
cd C:/Users/Patrick/uct-dashboard
pytest tests/test_voice_*.py -v && cd app && npx vitest run src/components/voice --reporter=basic
```

Expected: all backend voice tests + all frontend voice tests pass.

- [ ] **Step 11: Tag the slice**

```bash
git tag voice-slice-1-shipped
git push origin master --tags
```

---

## Plan Self-Review

After writing this plan, the following spec sections were checked against tasks:

- **Spec §1 Goals — Read aloud long-form content** → Tasks 17 (Morning Wire), 18 (Earnings transcript), 19 (UCT20), 20 (Setup Library)
- **Spec §1 Goals — Persist conversation history** → Out of scope for Slice 1 (Mode A only — no conversation). Tasks 12+ for slices 4–5.
- **Spec §1 Goals — Stay cost-efficient** → Tasks 5 (disk cache), 4 (usage cap), 10 (cache purge job)
- **Spec §2 Mode A** → Fully covered by Tasks 5–10 (backend) + 11–15 (frontend) + 16 (settings) + 17–20 (surfaces)
- **Spec §6 Backend additions — voice router endpoints** → `/tts` (Task 8), `/settings` (Task 9), `/usage` (Task 9). `/oneshot`, `/session_token`, `/exec`, `/transcripts`, `/tools` are explicitly out of slice 1.
- **Spec §6 DB schema — voice_settings + voice_usage_monthly** → Task 2 (other 3 tables added in later slices)
- **Spec §7 Cost optimization — Prompt caching** → N/A for Mode A. **TTS audio cache** → Task 5. **Auto-disconnect** → N/A for Mode A.
- **Spec §8 Security — plan gate** → Task 7. **Rate limits** → Task 8 (`@limiter.limit("30/minute")` on `/tts` and `/settings PUT`).
- **Spec §9 Testing — backend unit + integration** → Tasks 2–9 each include tests. **Browser tests** → Task 21. **Manual QA checklist** → Task 22.
- **Spec §10 Slice 1 acceptance** → "clicking 'Read aloud' plays audio with <500ms latency, cached re-listens are instant, plays through navigation" → Verified manually in Task 22 Steps 4–5. The persistent `<audio>` element survives navigation because `<AudioPlayerBar>` is mounted at the App root (Task 15).

**Placeholder scan:** None found. Every step has either runnable commands, full code, or explicit "adapt to the actual variable name in this file" instructions where the integration target is something the engineer can find in 30 seconds via Grep.

**Type consistency:** Verified across tasks:
- `voice` parameter is always `str` from `ALLOWED_VOICES` set.
- `speed` parameter is always `float` in `[MIN_SPEED, MAX_SPEED]`.
- Backend returns `audio/mpeg` Content-Type; frontend reads via `.blob()` + `URL.createObjectURL`.
- Voice context state shape is consistent: `status`, `trackId`, `trackLabel`, `speed`, `errorMessage`.
- `useReadAloud` returns `{ play, isPlayingTrack, isPausedTrack }` and is consumed identically by `ReadAloudButton`.
- `MODE_A_DEFAULT_CAP_SECONDS` constant referenced in service + router consistently.
