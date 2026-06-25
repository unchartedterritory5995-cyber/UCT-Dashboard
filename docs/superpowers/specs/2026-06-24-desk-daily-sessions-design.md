# The Desk — Daily Sessions Auto-Publish (Zoom Cloud Record → YouTube → The Desk)

**Date:** 2026-06-24
**Status:** v2 — capture method pivoted to Zoom cloud auto-record (supersedes the v1 YouTube-live-poll design below)
**Author:** Claude + Patrick

## Problem

UCT runs a Zoom **webinar** every weekday — a **new, paywalled link each day**, scheduled
from a template (NOT a recurring webinar). The recording must land in **The Desk →
Videos** automatically, titled with the day's date (e.g. *"Daily Session — June 24,
2026"*), with **zero per-session effort** and no risk of "forgetting."

## Approach (v2, chosen)

**Zoom webinar auto-records to cloud → Zoom fires a `recording.completed` webhook →
engine downloads the recording → uploads to YouTube (unlisted) → publishes a dated
Desk Videos record → deletes the recording from Zoom cloud.**

Why this beats the v1 "live-stream to YouTube" approach for THIS user:
- **Truly zero-click capture.** Zoom **Automatic Cloud Recording** starts the instant
  the host starts the webinar — no "Go Live" button. Zoom's auto-start for *custom
  RTMP* live streaming is account-gated and unreliable, so v1 couldn't guarantee
  hands-off. Auto cloud recording can.
- **New link every day is invisible to the automation.** The webhook fires for *any*
  recording on the account, regardless of the (fresh, paywalled) webinar link — so a
  template-scheduled new webinar each day "just works." A recurring webinar is not
  required.
- **Permanent hosting + no storage cap.** Re-hosting on YouTube unlisted reuses the
  existing Desk player and is free/unlimited; deleting the Zoom cloud copy after a
  successful upload keeps us under Zoom's storage cap.

Cost: the video now transits our infra (download + re-upload). We mitigate the
memory/segfault risk (`project_worker_segfault_2026_06_10`) by **streaming the
download to a temp file on disk** (never the whole file in RAM) and using **YouTube
resumable chunked upload** read from that file. Processing runs as a **background job
off the web request path**, one recording at a time.

## Architecture

Five units, each independently testable:

### 1. Capture (configuration only — no code)
Zoom account: **Settings → Recording → Automatic recording → Record to the cloud** ON.
A **webinar template** ("Daily Session") with auto-record-to-cloud baked in; the
operator schedules a new webinar from it each day (fresh paywalled link). Detailed in
the **Setup Walkthrough**.

### 2. Webhook receiver (`api/routers/desk_zoom_webhook.py`)
`POST /api/desk/zoom-webhook` — thin, lives on the web pod:
- **URL validation:** on Zoom's `endpoint.url_validation` event, respond with
  `{plainToken, encryptedToken}` where `encryptedToken = HMAC-SHA256(plainToken, ZOOM_WEBHOOK_SECRET_TOKEN)` (hex). Required to verify the endpoint in Zoom.
- **Signature check:** verify the `x-zm-signature` header
  (`v0=HMAC-SHA256("v0:{x-zm-request-timestamp}:{raw_body}", secret)`) on every event;
  reject mismatches with 401.
- On `recording.completed`, extract `{meeting_uuid, topic, start_time, download_url(s),
  download_token}` and **enqueue** a job row (status `pending`) into a small SQLite
  queue on `/data`. Return 200 immediately. Never download in the request.

### 3. Zoom client (`api/services/zoom_client.py`, raw httpx)
- **S2S OAuth:** `account_credentials` grant → access token (cached, refreshed on
  expiry) from `ZOOM_S2S_ACCOUNT_ID` / `ZOOM_S2S_CLIENT_ID` / `ZOOM_S2S_CLIENT_SECRET`.
- `stream_download(download_url, token, dest_path)` — `httpx.stream` the MP4 to a temp
  file in chunks (never `.read()` the whole body).
- `delete_recording(meeting_uuid)` — `DELETE /v2/meetings/{uuid}/recordings` (trash) so
  the Zoom cloud copy doesn't accrue against the storage cap.
- Structured errors (`ZoomAuthError`, `ZoomApiError`) so the worker can alert vs retry.

### 4. YouTube uploader (extend `api/services/youtube_client.py`)
- Keep the existing OAuth token refresh, but the credential now needs the
  **`youtube.upload`** scope (v1 used read-only `youtube.readonly`).
- `upload_unlisted(file_path, title, description="") -> str` — resumable upload
  (`uploads?uploadType=resumable`), `status.privacyStatus="unlisted"`, reading the file
  in chunks from disk. Returns the new `videoId`.
- (The v1 `list_completed_broadcasts` read-poll is no longer used; leave it or remove
  it in the plan's cleanup step.)

### 5. Recording processor (`api/services/desk_daily_session.py`, extended)
A background job (scheduler, web or worker pod) that drains the queue one row at a time:
1. Claim the oldest `pending` job (mark `processing`).
2. `zoom_client.stream_download(...)` → temp file.
3. `youtube_client.upload_unlisted(file, title=_session_title(start_time))` → `videoId`.
4. `education_service.create_video({youtube_id, title, category="Daily Sessions", ...})`
   — **idempotent** by both the Zoom `meeting_uuid` (queue PK) and `youtube_id`.
5. `zoom_client.delete_recording(meeting_uuid)`; mark job `done`; delete temp file.
6. On failure: mark `error` with the message; the EOD safety net surfaces it. Bounded
   retries (e.g. 3) before giving up.

`_session_title()` (date → `Daily Session — {Month} {D}, {YYYY}` ET) is **unchanged**
from v1 and reused. The publish-into-`edu_videos` step is **unchanged** in spirit.

### 6. End-of-day safety net (reuse v1, retarget)
Weekday EOD: if no `Daily Session — {today}` row exists in The Desk, alert the owner
(Discord). Now also distinguishes a **stuck queue / Zoom-or-YouTube auth failure** from
a genuinely-absent session (different alert text), since those are the realistic failure
modes. Weekday-gated, data-driven.

## Data model

- Reuse `edu_videos` (`education_service`) for the published record — no new video table.
- **New tiny queue table** (`desk_session_jobs` on `/data`, own SQLite or a table in an
  existing dashboard DB): `meeting_uuid PK, topic, start_time, download_url,
  download_token, status(pending|processing|done|error), youtube_id, attempts, error,
  created_at, updated_at`. PK on `meeting_uuid` gives idempotency against duplicate
  webhooks. Tiny, mirrors the cot.db/catalysts.db local-SQLite pattern.

## Environment / secrets (web pod)

- `ZOOM_S2S_ACCOUNT_ID`, `ZOOM_S2S_CLIENT_ID`, `ZOOM_S2S_CLIENT_SECRET` — Zoom
  Server-to-Server OAuth app (scopes: `cloud_recording:read:list_account_recordings:admin`
  + recording read/download + `cloud_recording:delete...` — exact scope names finalized
  during setup).
- `ZOOM_WEBHOOK_SECRET_TOKEN` — for URL validation + signature verification.
- `YT_OAUTH_CLIENT_ID`, `YT_OAUTH_CLIENT_SECRET`, `YT_OAUTH_REFRESH_TOKEN` — now minted
  with the **`youtube.upload`** scope.
- `DESK_DAILY_SESSION_ENABLED=1` — master switch (inert when unset).
- Optional: `DESK_DAILY_SESSION_CATEGORY` (default `"Daily Sessions"`),
  `DESK_DAILY_SESSION_MAX_ATTEMPTS` (default 3).

## Error handling

- Webhook: bad signature → 401; unknown event → 200 ignore; always 200 fast on accepted
  events (Zoom retries non-2xx, so never do slow work inline).
- Download/upload/delete failures → job `error` + bounded retry; EOD safety net alerts.
- Zoom or YouTube auth failure → distinct owner alert (token expired / quota), not the
  generic "webinar didn't run."
- Idempotent: re-delivered webhook for the same `meeting_uuid` → no duplicate (queue PK);
  re-run after a partial failure resumes without a duplicate Desk row (youtube_id guard).
- Temp files always cleaned up (success or failure).

## Testing

- **Webhook:** URL-validation HMAC response correct; signature accept/reject; a
  `recording.completed` event enqueues exactly one job; duplicate delivery → still one.
- **Zoom client:** token refresh (monkeypatched httpx); `stream_download` writes the
  body to disk in chunks (fake stream); delete calls the right endpoint.
- **YouTube uploader:** resumable upload happy path returns the videoId (monkeypatched);
  auth/quota error surfaces `YouTubeApiError`.
- **Processor:** end-to-end with fakes — pending job → upload → `create_video` (dated
  title, "Daily Sessions") → delete → `done`; idempotency (same uuid twice → one Desk
  row); failure path marks `error` + cleans the temp file.
- **Safety net:** weekday/absent → alert; present → silent; weekend → silent; stuck-queue
  → distinct alert.
- No live Zoom/YouTube calls in tests (inject fakes).

## Setup Walkthrough (one-time, human steps)

See the companion `…-SETUP-walkthrough.md` (being updated for v2). Summary:
1. **YouTube:** channel with live/upload enabled; mint a YouTube OAuth refresh token with
   the **upload** scope (OAuth Playground, Desktop client).
2. **Zoom recording:** Settings → Recording → **Automatic recording → Record to the
   cloud** ON.
3. **Zoom template:** schedule a webinar with auto-record-to-cloud → **Save as Template**
   ("Daily Session"). Daily: Schedule a Webinar → Use template → fresh paywalled link.
4. **Zoom app:** create a **Server-to-Server OAuth** app (recording read/download/delete
   scopes) → copy Account ID + Client ID + Client Secret. Add an **Event Subscription**
   for `recording.completed` pointing at `https://uctintelligence.com/api/desk/zoom-webhook`
   → copy the **Secret Token**.
5. Hand Claude the Zoom + YouTube credentials; Claude stores them in Railway, verifies the
   webhook validates, runs a test webinar.

## Out of scope (v1/v2)

- Trimming/editing the recording (raw recording published; trim later in YouTube Studio).
- AI title/summary (dated title is the requirement).
- Multiple recordings per day (each completed recording → its own dated record; if two
  land the same day, the second would collide on title — acceptable for v1, revisit if
  it happens).

---

## v1 (superseded) — Zoom live-stream → YouTube unlisted poll

The originally-shipped design live-streamed the webinar to YouTube unlisted and polled
`liveBroadcasts.list`. Superseded because Zoom's auto-start for custom RTMP is
unreliable (couldn't guarantee zero-click) and the user needs a fresh paywalled link
per day. The v1 publish half (`_session_title`, `edu_videos` insert, idempotency, EOD
safety net) is **reused** by v2; the v1 detect-poll (`list_completed_broadcasts`) is
retired. v1 code shipped inert on master `af071caa`.
