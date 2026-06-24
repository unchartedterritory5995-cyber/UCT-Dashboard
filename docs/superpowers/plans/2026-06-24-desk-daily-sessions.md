# The Desk — Daily Sessions Auto-Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A backend job that detects the day's archived YouTube (unlisted) webinar recording and idempotently publishes it into The Desk → Videos as a dated "Daily Session" record, with an end-of-day safety-net alert.

**Architecture:** A small REST client (`youtube_client.py`, raw `httpx` — no Google SDK) refreshes an OAuth token and lists the channel's **completed** live broadcasts. An orchestrator (`desk_daily_session.py`) filters out already-published video ids, builds a dated title, and inserts via the existing `education_service.create_video()`. APScheduler in `api/main.py` runs an interval poll + an EOD safety check, gated by an env flag.

**Tech Stack:** Python 3.12, FastAPI, `httpx==0.28.1`, APScheduler, SQLite (`education.db`), pytest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-24-desk-daily-sessions-design.md`. Capture side (Zoom→YouTube) is human config — NOT in this plan.
- **No new dependencies.** Use `httpx` (already pinned) for all HTTP. Do NOT add `google-api-python-client`.
- **Idempotent by `youtube_id`** — re-runs never duplicate (reuse `education_service.existing_youtube_ids()`).
- **Never crash the scheduler tick** — every job body wraps its work in try/except and logs (mirrors `tweet_poller`).
- **Reuse the existing store** — `api/services/education_service.py` (`create_video`, `existing_youtube_ids`, `list_videos`). No new table.
- **Category** default `"Daily Sessions"` (env-overridable `DESK_DAILY_SESSION_CATEGORY`).
- **Title format** (verbatim): `Daily Session — {Month} {D}, {YYYY}` using the broadcast's actual start time in **America/New_York** (e.g. `Daily Session — June 24, 2026`). Note the em-dash `—`.
- **Master switch** `DESK_DAILY_SESSION_ENABLED=1` (inert when unset).
- **Env (web pod):** `YT_OAUTH_CLIENT_ID`, `YT_OAUTH_CLIENT_SECRET`, `YT_OAUTH_REFRESH_TOKEN`.
- Run tests from the worktree root: `python -m pytest <path> -v`.

---

## Operational prerequisite (manual — not a code task)

Mint the `YT_OAUTH_REFRESH_TOKEN` once: at **developers.google.com/oauthplayground**, click the gear → "Use your own OAuth credentials" → paste the Desktop client id/secret from Part E of the setup walkthrough → authorize scope `https://www.googleapis.com/auth/youtube.readonly` as the channel owner → exchange for tokens → copy the **refresh token**. Store all three values in Railway web-pod env. No code needed; the playground returns a long-lived refresh token because the client is a Desktop app.

---

## File Structure

- **Create** `api/services/youtube_client.py` — OAuth token refresh + `list_completed_broadcasts()`. Pure parser `_parse_broadcasts()` split out for testing.
- **Create** `api/services/desk_daily_session.py` — `_session_title()`, `publish_new_sessions()`, `check_missing_session_alert()`. Orchestration only; no HTTP, no SQL of its own (delegates to the two services).
- **Modify** `api/main.py` — add a gated scheduler block (interval poll + EOD safety cron) next to the Twitter block (~line 1795+).
- **Create** `tests/test_youtube_client.py`
- **Create** `tests/test_desk_daily_session.py`

---

### Task 1: YouTube REST client (`youtube_client.py`)

**Files:**
- Create: `api/services/youtube_client.py`
- Test: `tests/test_youtube_client.py`

**Interfaces:**
- Produces:
  - `class YouTubeAuthError(Exception)`, `class YouTubeApiError(Exception)`
  - `_parse_broadcasts(payload: dict) -> list[dict]` — each item `{"video_id": str, "title": str, "started_at": str|None, "privacy": str|None}`
  - `class YouTubeClient` with `list_completed_broadcasts(max_results: int = 10) -> list[dict]` (same item shape)

- [ ] **Step 1: Write the failing test (pure parser + auth guard)**

```python
# tests/test_youtube_client.py
import pytest
from api.services import youtube_client as yc


def test_parse_broadcasts_extracts_fields():
    payload = {"items": [
        {"id": "VID123", "snippet": {"title": "Webinar",
            "actualStartTime": "2026-06-24T13:30:00Z"},
         "status": {"privacyStatus": "unlisted"}},
    ]}
    out = yc._parse_broadcasts(payload)
    assert out == [{"video_id": "VID123", "title": "Webinar",
                    "started_at": "2026-06-24T13:30:00Z", "privacy": "unlisted"}]


def test_parse_broadcasts_skips_items_without_id():
    payload = {"items": [{"snippet": {"title": "no id"}}, {"id": ""}]}
    assert yc._parse_broadcasts(payload) == []


def test_parse_broadcasts_falls_back_to_scheduled_then_published():
    payload = {"items": [{"id": "V", "snippet": {
        "title": "t", "scheduledStartTime": "2026-06-24T13:00:00Z"}}]}
    assert yc._parse_broadcasts(payload)[0]["started_at"] == "2026-06-24T13:00:00Z"


def test_ensure_token_raises_when_unconfigured():
    c = yc.YouTubeClient(client_id=None, client_secret=None, refresh_token=None)
    with pytest.raises(yc.YouTubeAuthError):
        c._ensure_token()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_youtube_client.py -v`
Expected: FAIL with `AttributeError: module 'api.services.youtube_client' has no attribute '_parse_broadcasts'` (or ModuleNotFound).

- [ ] **Step 3: Write minimal implementation**

```python
# api/services/youtube_client.py
"""Thin YouTube Data API v3 client (raw httpx, no Google SDK).

Refreshes an OAuth access token from a stored refresh token, then lists the
channel's COMPLETED live broadcasts (works for unlisted, which the public RSS
feed hides). Used by desk_daily_session to find the day's archived webinar.
"""
from __future__ import annotations

import os
import time
import httpx

_TOKEN_URL = "https://oauth2.googleapis.com/token"
_BROADCASTS_URL = "https://www.googleapis.com/youtube/v3/liveBroadcasts"


class YouTubeAuthError(Exception):
    """OAuth not configured or token refresh failed."""


class YouTubeApiError(Exception):
    """liveBroadcasts.list returned a non-200."""


def _parse_broadcasts(payload: dict) -> list[dict]:
    """Pure: normalize a liveBroadcasts.list response into our item shape.

    The liveBroadcast `id` IS the archived video id. Date prefers the real
    start, then the scheduled start, then publishedAt."""
    out: list[dict] = []
    for item in (payload or {}).get("items", []):
        vid = (item.get("id") or "").strip()
        if not vid:
            continue
        snip = item.get("snippet", {}) or {}
        out.append({
            "video_id": vid,
            "title": snip.get("title", "") or "",
            "started_at": (snip.get("actualStartTime")
                           or snip.get("scheduledStartTime")
                           or snip.get("publishedAt")),
            "privacy": (item.get("status", {}) or {}).get("privacyStatus"),
        })
    return out


class YouTubeClient:
    def __init__(self, client_id: str | None = None,
                 client_secret: str | None = None,
                 refresh_token: str | None = None):
        self.client_id = client_id if client_id is not None else os.environ.get("YT_OAUTH_CLIENT_ID")
        self.client_secret = client_secret if client_secret is not None else os.environ.get("YT_OAUTH_CLIENT_SECRET")
        self.refresh_token = refresh_token if refresh_token is not None else os.environ.get("YT_OAUTH_REFRESH_TOKEN")
        self._access_token: str | None = None
        self._token_exp: float = 0.0

    def _ensure_token(self) -> str:
        if self._access_token and time.time() < self._token_exp - 60:
            return self._access_token
        if not (self.client_id and self.client_secret and self.refresh_token):
            raise YouTubeAuthError("YouTube OAuth env not configured")
        resp = httpx.post(_TOKEN_URL, data={
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "refresh_token": self.refresh_token,
            "grant_type": "refresh_token",
        }, timeout=15)
        if resp.status_code != 200:
            raise YouTubeAuthError(f"token refresh {resp.status_code}: {resp.text[:200]}")
        data = resp.json()
        self._access_token = data["access_token"]
        self._token_exp = time.time() + int(data.get("expires_in", 3600))
        return self._access_token

    def list_completed_broadcasts(self, max_results: int = 10) -> list[dict]:
        token = self._ensure_token()
        resp = httpx.get(_BROADCASTS_URL, params={
            "part": "snippet,status",
            "broadcastStatus": "completed",
            "broadcastType": "all",
            "maxResults": max_results,
        }, headers={"Authorization": f"Bearer {token}"}, timeout=20)
        if resp.status_code != 200:
            raise YouTubeApiError(f"liveBroadcasts.list {resp.status_code}: {resp.text[:200]}")
        return _parse_broadcasts(resp.json())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_youtube_client.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the network-path test (monkeypatched httpx)**

```python
# append to tests/test_youtube_client.py
class _Resp:
    def __init__(self, status, payload=None, text=""):
        self.status_code = status
        self._payload = payload or {}
        self.text = text
    def json(self):
        return self._payload


def test_list_completed_broadcasts_refreshes_token_and_lists(monkeypatch):
    calls = {}
    def fake_post(url, data=None, timeout=None):
        calls["token"] = data
        return _Resp(200, {"access_token": "AT", "expires_in": 3600})
    def fake_get(url, params=None, headers=None, timeout=None):
        calls["auth"] = headers["Authorization"]
        return _Resp(200, {"items": [{"id": "V1",
            "snippet": {"title": "x", "actualStartTime": "2026-06-24T13:30:00Z"}}]})
    monkeypatch.setattr(yc.httpx, "post", fake_post)
    monkeypatch.setattr(yc.httpx, "get", fake_get)
    c = yc.YouTubeClient(client_id="id", client_secret="sec", refresh_token="rt")
    rows = c.list_completed_broadcasts()
    assert rows[0]["video_id"] == "V1"
    assert calls["auth"] == "Bearer AT"
    assert calls["token"]["grant_type"] == "refresh_token"


def test_list_raises_on_api_error(monkeypatch):
    monkeypatch.setattr(yc.httpx, "post", lambda *a, **k: _Resp(200, {"access_token": "AT"}))
    monkeypatch.setattr(yc.httpx, "get", lambda *a, **k: _Resp(403, text="forbidden"))
    c = yc.YouTubeClient(client_id="id", client_secret="sec", refresh_token="rt")
    with pytest.raises(yc.YouTubeApiError):
        c.list_completed_broadcasts()
```

- [ ] **Step 6: Run the full client test file**

Run: `python -m pytest tests/test_youtube_client.py -v`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add api/services/youtube_client.py tests/test_youtube_client.py
git commit -m "feat(desk): YouTube liveBroadcasts client (raw httpx)"
```

---

### Task 2: Detect + publish orchestrator (`desk_daily_session.py`)

**Files:**
- Create: `api/services/desk_daily_session.py`
- Test: `tests/test_desk_daily_session.py`

**Interfaces:**
- Consumes: `youtube_client.YouTubeClient.list_completed_broadcasts()`; `education_service.{existing_youtube_ids, create_video, list_videos}`.
- Produces:
  - `_session_title(started_at_iso: str | None, *, now=None) -> str`
  - `publish_new_sessions(client=None) -> list[dict]` — returns the created rows.

- [ ] **Step 1: Write the failing title test**

```python
# tests/test_desk_daily_session.py
import os
import tempfile
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.services import desk_daily_session as dds
from api.services import education_service as edu

ET = ZoneInfo("America/New_York")


def test_session_title_formats_et_date():
    # 2026-06-24T13:30:00Z == 09:30 ET, still June 24
    assert dds._session_title("2026-06-24T13:30:00Z") == "Daily Session — June 24, 2026"


def test_session_title_handles_utc_midnight_rolling_back_to_prev_et_day():
    # 2026-06-25T02:00:00Z == 2026-06-24 22:00 ET
    assert dds._session_title("2026-06-25T02:00:00Z") == "Daily Session — June 24, 2026"


def test_session_title_falls_back_to_now_when_missing():
    fixed = datetime(2026, 6, 24, 12, 0, tzinfo=ET)
    assert dds._session_title(None, now=fixed) == "Daily Session — June 24, 2026"
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_desk_daily_session.py -v`
Expected: FAIL (module/attribute missing).

- [ ] **Step 3: Implement title + publish**

```python
# api/services/desk_daily_session.py
"""Detect the day's archived YouTube webinar and publish it to The Desk.

Polls the channel's completed live broadcasts, skips any whose video id is
already in education.db, and inserts a dated "Daily Session" record. Idempotent
by youtube_id. Pure orchestration — HTTP lives in youtube_client, storage in
education_service.
"""
from __future__ import annotations

import os
from datetime import datetime
from zoneinfo import ZoneInfo

from api.services import education_service
from api.services.youtube_client import YouTubeClient

_ET = ZoneInfo("America/New_York")


def _category() -> str:
    return os.environ.get("DESK_DAILY_SESSION_CATEGORY", "Daily Sessions")


def _to_et(started_at_iso: str | None, *, now: datetime | None = None) -> datetime:
    if not started_at_iso:
        return now or datetime.now(_ET)
    iso = started_at_iso.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(iso)
    except ValueError:
        return now or datetime.now(_ET)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo("UTC"))
    return dt.astimezone(_ET)


def _session_title(started_at_iso: str | None, *, now: datetime | None = None) -> str:
    dt = _to_et(started_at_iso, now=now)
    return f"Daily Session — {dt.strftime('%B')} {dt.day}, {dt.year}"


def publish_new_sessions(client=None) -> list[dict]:
    """Publish any completed broadcast not already in the library. Idempotent."""
    client = client or YouTubeClient()
    broadcasts = client.list_completed_broadcasts()
    have = education_service.existing_youtube_ids()
    created: list[dict] = []
    for b in broadcasts:
        vid = (b.get("video_id") or "").strip()
        if not vid or vid in have:
            continue
        row = education_service.create_video({
            "youtube_id": vid,
            "title": _session_title(b.get("started_at")),
            "description": "",
            "category": _category(),
            "sort_order": 0,
        })
        created.append(row)
        have.add(vid)
    return created
```

- [ ] **Step 4: Run title tests**

Run: `python -m pytest tests/test_desk_daily_session.py -v`
Expected: PASS (3 title tests).

- [ ] **Step 5: Add publish tests (fake client + temp education.db)**

```python
# append to tests/test_desk_daily_session.py
class _FakeClient:
    def __init__(self, rows):
        self._rows = rows
    def list_completed_broadcasts(self, max_results=10):
        return self._rows


@pytest.fixture
def edu_db(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(edu, "_DB_PATH", os.path.join(d, "education.db"))
        edu._init_db()
        yield edu


def test_publish_creates_dated_record(edu_db):
    client = _FakeClient([{"video_id": "VID1", "title": "raw",
                           "started_at": "2026-06-24T13:30:00Z", "privacy": "unlisted"}])
    created = dds.publish_new_sessions(client=client)
    assert len(created) == 1
    assert created[0]["youtube_id"] == "VID1"
    assert created[0]["title"] == "Daily Session — June 24, 2026"
    assert created[0]["category"] == "Daily Sessions"


def test_publish_is_idempotent(edu_db):
    client = _FakeClient([{"video_id": "VID1", "title": "raw",
                           "started_at": "2026-06-24T13:30:00Z"}])
    assert len(dds.publish_new_sessions(client=client)) == 1
    assert dds.publish_new_sessions(client=client) == []   # second run no-ops
    assert len(edu.list_videos()) == 1
```

- [ ] **Step 6: Run the file**

Run: `python -m pytest tests/test_desk_daily_session.py -v`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add api/services/desk_daily_session.py tests/test_desk_daily_session.py
git commit -m "feat(desk): detect+publish daily session orchestrator (idempotent)"
```

---

### Task 3: End-of-day safety-net alert

**Files:**
- Modify: `api/services/desk_daily_session.py`
- Modify: `tests/test_desk_daily_session.py`

**Interfaces:**
- Consumes: `education_service.list_videos()`; `api.services.discord_notify._send_webhook(embed: dict)`.
- Produces:
  - `todays_session_exists(now: datetime | None = None) -> bool`
  - `check_missing_session_alert(now: datetime | None = None, *, publish=True) -> bool` — returns `True` iff an alert was fired.

- [ ] **Step 1: Write the failing safety-net tests**

```python
# append to tests/test_desk_daily_session.py
def test_safety_net_silent_on_weekend(edu_db, monkeypatch):
    fired = []
    monkeypatch.setattr(dds, "_alert_owner", lambda now: fired.append(now))
    sat = datetime(2026, 6, 27, 18, 0, tzinfo=ET)
    assert dds.check_missing_session_alert(now=sat, publish=False) is False
    assert fired == []


def test_safety_net_silent_when_today_present(edu_db, monkeypatch):
    fired = []
    monkeypatch.setattr(dds, "_alert_owner", lambda now: fired.append(now))
    edu.create_video({"youtube_id": "V", "title": "Daily Session — June 24, 2026",
                      "category": "Daily Sessions", "sort_order": 0})
    wed = datetime(2026, 6, 24, 18, 0, tzinfo=ET)
    assert dds.check_missing_session_alert(now=wed, publish=False) is False
    assert fired == []


def test_safety_net_fires_when_absent_on_weekday(edu_db, monkeypatch):
    fired = []
    monkeypatch.setattr(dds, "_alert_owner", lambda now: fired.append(now))
    wed = datetime(2026, 6, 24, 18, 0, tzinfo=ET)
    assert dds.check_missing_session_alert(now=wed, publish=False) is True
    assert len(fired) == 1
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_desk_daily_session.py -k safety_net -v`
Expected: FAIL (`_alert_owner` / `check_missing_session_alert` missing).

- [ ] **Step 3: Implement the safety net**

```python
# add to api/services/desk_daily_session.py (after publish_new_sessions)

def todays_session_exists(now: datetime | None = None) -> bool:
    now = now or datetime.now(_ET)
    expected = _session_title(None, now=now)
    cat = _category()
    return any(v.get("title") == expected and v.get("category") == cat
               for v in education_service.list_videos())


def _alert_owner(now: datetime) -> None:
    from api.services import discord_notify
    discord_notify._send_webhook({
        "title": "⚠️ Daily Session not published",
        "description": (f"No '{_session_title(None, now=now)}' video is in The Desk "
                        f"by {now.strftime('%-I:%M %p ET') if os.name != 'nt' else now.strftime('%I:%M %p ET')}. "
                        "Check that the webinar ran and auto-streamed to YouTube."),
        "color": 0xE0A800,
    })


def check_missing_session_alert(now: datetime | None = None, *, publish: bool = True) -> bool:
    """Weekday EOD guard. Tries one publish, then alerts the owner if today's
    session still isn't in the library. Returns True iff it alerted."""
    now = now or datetime.now(_ET)
    if now.weekday() >= 5:          # Sat/Sun
        return False
    if publish:
        try:
            publish_new_sessions()
        except Exception:
            pass
    if todays_session_exists(now):
        return False
    _alert_owner(now)
    return True
```

- [ ] **Step 4: Run the safety-net tests**

Run: `python -m pytest tests/test_desk_daily_session.py -k safety_net -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the whole file**

Run: `python -m pytest tests/test_desk_daily_session.py tests/test_youtube_client.py -v`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add api/services/desk_daily_session.py tests/test_desk_daily_session.py
git commit -m "feat(desk): EOD safety-net alert for missing daily session"
```

---

### Task 4: Scheduler wiring + env flag (`api/main.py`)

**Files:**
- Modify: `api/main.py` — inside the `if acquire_scheduler_lock():` block, after the Twitter scheduler block (~line 1810), before COT cleanup jobs.

**Interfaces:**
- Consumes: `desk_daily_session.{publish_new_sessions, check_missing_session_alert}`; module-level `CronTrigger` (already imported in the block).

- [ ] **Step 1: Add the gated block**

Insert this inside the scheduler block (it already has `from apscheduler.triggers.cron import CronTrigger` in scope):

```python
        # -- The Desk: Daily Sessions auto-publish -------------------------
        _desk_sessions_on = os.environ.get("DESK_DAILY_SESSION_ENABLED", "0") == "1"
        if _desk_sessions_on:
            from api.services import desk_daily_session as _dds

            def _dds_poll():
                try:
                    created = _dds.publish_new_sessions()
                    if created:
                        print(f"[desk-sessions] published {len(created)} session(s)")
                except Exception as e:
                    print(f"[desk-sessions] poll error (non-fatal): {e}")

            def _dds_safety():
                try:
                    _dds.check_missing_session_alert()
                except Exception as e:
                    print(f"[desk-sessions] safety-net error (non-fatal): {e}")

            # Interval poll: weekdays, every 30 min across the active window.
            _scheduler.add_job(_dds_poll,
                trigger=CronTrigger(day_of_week="mon-fri", hour="9-23", minute="*/30"),
                id="desk_daily_session_poll", max_instances=1, replace_existing=True)
            # EOD safety net: weekdays 6 PM ET.
            _scheduler.add_job(_dds_safety,
                trigger=CronTrigger(day_of_week="mon-fri", hour=18, minute=0),
                id="desk_daily_session_safety", max_instances=1, replace_existing=True)
            print("[startup] Desk Daily Sessions auto-publish ENABLED")
```

- [ ] **Step 2: Verify the app imports cleanly**

Run: `python -c "import api.main"`
Expected: no ImportError (prints any normal startup logs, exits 0).

- [ ] **Step 3: Verify the wiring is present**

Run: `grep -c desk_daily_session api/main.py`
Expected: `>= 3` (import + two job bodies referencing `_dds`).

- [ ] **Step 4: Confirm jobs register only when enabled (smoke)**

Run:
```bash
DESK_DAILY_SESSION_ENABLED=1 python -c "import api.main" 2>&1 | grep -i 'Desk Daily Sessions' || true
```
Expected: prints `[startup] Desk Daily Sessions auto-publish ENABLED` when the lock is acquired locally (if the lock isn't acquired in this env, the line may not print — that's fine; Step 3's grep is the binding check).

- [ ] **Step 5: Commit**

```bash
git add api/main.py
git commit -m "feat(desk): schedule daily-session poll + EOD safety net (env-gated)"
```

---

### Task 5: Full suite + ship

**Files:** none (verification + integration).

- [ ] **Step 1: Run the new tests together**

Run: `python -m pytest tests/test_youtube_client.py tests/test_desk_daily_session.py -v`
Expected: PASS (11 tests).

- [ ] **Step 2: Run the existing education suite to confirm no regression**

Run: `python -m pytest tests/test_education.py -v`
Expected: PASS (unchanged).

- [ ] **Step 3: Push via fast-forward to master (shared-tree safe)**

Per `lesson_uct_dashboard_shared_worktree`: do NOT `git add -A`; ship this branch by fast-forward. From the worktree:
```bash
git fetch origin master
git rebase origin/master
git push origin desk-daily-sessions:master
```
Expected: fast-forward push succeeds (the only changed files are the two new services, two new test files, the `api/main.py` block, and the two docs).

- [ ] **Step 4: Post-deploy enablement (manual)**

After the refresh token is minted (operational prerequisite) and stored, set on the **web** pod:
```bash
railway variables --set DESK_DAILY_SESSION_ENABLED=1 --service web
railway redeploy --service web --yes
```
Then run a test webinar and confirm *"Daily Session — {date}"* under The Desk → Videos → Daily Sessions within ~30–60 min.

---

## Self-Review

**Spec coverage:**
- Capture (config) → setup walkthrough (out of code scope). ✅ noted, not a task.
- Detect (`liveBroadcasts.list` poll, skip already-published, dedupe by videoId) → Task 1 + Task 2. ✅
- Publish (dated title, "Daily Sessions" category, idempotent) → Task 2. ✅
- Safety net (weekday, data-driven, owner alert) → Task 3. ✅
- Scheduling (interval poll + EOD cron, env-gated) → Task 4. ✅
- Env/secrets → Global Constraints + operational prerequisite + Task 5 Step 4. ✅
- Reuse `edu_videos`, no new table → Tasks 2/3 use `education_service`. ✅
- Error handling (never crash tick, structured auth errors) → Task 1 errors + Task 4 try/except. ✅
- Testing (parser fixtures, idempotency, dated title, safety-net cases, no live calls) → Tasks 1–3. ✅

**Placeholder scan:** No TBD/TODO; every code step has complete code; no "add error handling" hand-waves. ✅

**Type consistency:** `list_completed_broadcasts()` item shape `{video_id,title,started_at,privacy}` is produced in Task 1 and consumed verbatim in Task 2. `_session_title(started_at_iso, *, now=None)`, `publish_new_sessions(client=None)`, `check_missing_session_alert(now=None, *, publish=True)`, `_alert_owner(now)` names match across tasks + tests. `education_service` calls (`create_video`, `existing_youtube_ids`, `list_videos`, `_DB_PATH`, `_init_db`) match the real module. ✅
