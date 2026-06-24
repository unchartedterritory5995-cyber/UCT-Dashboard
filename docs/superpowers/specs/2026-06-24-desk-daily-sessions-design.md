# The Desk — Daily Sessions Auto-Publish (Zoom → YouTube → The Desk)

**Date:** 2026-06-24
**Status:** Design approved (pending spec review)
**Author:** Claude + Patrick

## Problem

UCT runs a live Zoom **webinar** every weekday. The recording should land in **The
Desk → Videos** automatically, titled with the day's date (e.g. *"Daily Session —
June 24, 2026"*), with **zero per-session effort** and no risk of "forgetting."

## Approach (chosen)

**Zoom Webinar → live-streams to YouTube (unlisted) → engine detects the new
video → auto-publishes a Desk Videos record.**

The video never touches our servers. No download, no re-upload, no storage cap, no
heavy-file processing on the web pod. The capture side is **pure account
configuration** (no code); the only net-new code is a small detect-poll + publish
job that mirrors the existing `ensure_default_videos()` / COT-self-heal patterns.

### Why this over the alternatives

| Approach | Verdict |
|---|---|
| Zoom **Cloud Recording** + webhook → download → re-upload to YouTube | Works, but heavy: video download + chunked re-upload on our infra (memory/segfault risk per `project_worker_segfault_2026_06_10`), Zoom storage cap, webhook signature handling. Rejected. |
| Keep the **Zoom share link** in The Desk | Simplest, but Zoom cloud storage cap (~5GB Pro) purges old recordings → links rot in a growing daily library. Rejected. |
| **Zoom live-stream → YouTube unlisted** (this design) | Zero per-session effort (Zoom auto-start), permanent free hosting, reuses the existing Desk YouTube player, no video on our infra. **Chosen.** |

Confirmed mechanics:
- Zoom webinars support **custom live streaming with a persistent stream key + auto-start**
  configured once at scheduling — the host never clicks "Go Live"
  ([Zoom KB0064210](https://support.zoom.us/hc/en-us/articles/115001777826)).
- Archived **unlisted** live broadcasts are listable via the authenticated YouTube Data API
  `liveBroadcasts.list` (privacy can be unlisted; completed broadcasts persist when the stream
  records) — so detection works for unlisted videos that the public RSS feed would hide
  ([YouTube Live API](https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/list)).

## Architecture

Three units, each independently testable:

### 1. Capture (configuration only — no code)
Zoom Webinar → Custom Live Streaming Service → persistent YouTube stream key/URL →
**auto-start enabled**. YouTube persistent stream default privacy = **unlisted**.
Every weekday the webinar auto-broadcasts and YouTube auto-archives it as an
unlisted video. Covered in detail in the **Setup Walkthrough** section below.

### 2. Detect (new service: `api/services/desk_daily_session.py`)
A poll, run on an interval through the day (and self-heal on Desk visits), that:
1. Calls YouTube Data API `liveBroadcasts.list` (`mine=true`, `broadcastStatus=completed`,
   `part=snippet,status,contentDetails`) using a stored UCT YouTube **OAuth refresh token**.
2. Filters to broadcasts whose archived video we haven't published yet
   (`youtube_id not in existing_youtube_ids()`), newer than the last-seen marker.
3. For each new one, hands the `videoId` + actual session date to the publish step.

**Why poll, not webhook:** unlisted videos don't reliably appear in YouTube's public
WebSub/RSS feed, and we already know the session cadence. An interval poll that
dedupes by `videoId` is robust to a drifting webinar time or a session that runs long.

### 3. Publish (into the existing `edu_videos` store)
`create_video({...})` with:
- `youtube_id` = the archived broadcast's video id
- `title` = `"Daily Session — {Month D, YYYY}"` (date from the broadcast's actual start time, ET)
- `category` = `"Daily Sessions"` (new dedicated section in The Desk → Videos)
- `description` = optional short default
- `sort_order` = 0

**Idempotent** by `youtube_id` (same guard `ensure_default_videos()` uses) — re-runs
never duplicate. The existing `/api/education/*` endpoints + Desk Videos player render
it with no frontend change beyond the new category appearing in the chips.

### 4. Safety net — "don't forget"
On a weekday, if no new Daily Sessions video has been published by an **end-of-day
cutoff** (e.g. 6 PM ET), the engine alerts the owner (Discord webhook / existing alert
channel), mirroring the holiday-guard pattern (`lesson_scheduled_jobs_holiday_guard`).
With auto-start configured, forgetting is essentially impossible; this catches the
rare case where auto-start hiccupped or the webinar didn't run. Weekday-gated, and
data-driven (checks whether today's video exists before alerting).

## Data model

No new table. Reuses `edu_videos` (`api/services/education_service.py`). One new
**category value** `"Daily Sessions"`. A tiny bit of poll state (last-seen broadcast
id / last-run timestamp) lives in a flag file on the `/data` volume or a 1-row helper
table — matching how COT/catalyst self-heal track `_LAST_AUTO_REFRESH_AT`.

## Scheduling

APScheduler block in `api/main.py` next to COT / Twitter / Catalyst, gated by a new
env flag (e.g. `DESK_DAILY_SESSION_ENABLED=1`):
- **Detect poll:** every ~30 min during a weekday window after the session (interval,
  not a single fixed time — robust to time drift).
- **Safety-net check:** once at the EOD cutoff (weekday).
- **Request-driven self-heal:** a Desk Videos load can trigger a debounced poll
  (30-min cooldown), same idiom as COT `get_status()`.

## Environment / secrets

- `YT_OAUTH_CLIENT_ID`, `YT_OAUTH_CLIENT_SECRET`, `YT_OAUTH_REFRESH_TOKEN` — a UCT
  Google Cloud OAuth client + a long-lived refresh token for the channel that owns the
  stream (read-only `youtube.readonly` scope is enough for `liveBroadcasts.list`).
- `DESK_DAILY_SESSION_ENABLED=1` — master switch (inert when unset).
- Optional: `DESK_DAILY_SESSION_CATEGORY` (default `"Daily Sessions"`),
  `DESK_DAILY_SESSION_EOD_CUTOFF_ET` (default `18:00`).

Stored in Railway web-pod env (the web pod owns `education.db`), staged via
`railway variables --set` then `railway redeploy --service web`.

## Error handling

- YouTube API failure → log + retry next interval; never crash the scheduler tick
  (same defensive posture as `tweet_poller`).
- Auth/refresh-token expiry → structured error + owner alert (so a silent stall is
  visible), don't loop.
- Publish failure → leave the video unpublished so the next poll retries (idempotent).
- Holiday / no-session day → safety net is weekday-gated and data-driven, so it won't
  cry wolf, but also won't publish a phantom.

## Testing

- **Detect:** unit-test the `liveBroadcasts.list` response parser with fixtures
  (completed unlisted broadcast → `videoId` + date; already-published → skipped;
  empty → no-op).
- **Publish:** idempotency (same `videoId` twice → one row), correct dated title,
  correct category — against a temp `education.db` (mirrors `test_education.py`).
- **Safety net:** weekday + no-video → alert fires; video present → silent; weekend →
  silent.
- No live YouTube calls in tests (inject a fake client).

## Setup Walkthrough (one-time, human steps)

This is the configuration that makes the daily stream happen — done once, then it
runs itself. Delivered to the operator separately as a step-by-step; summarized here
so the spec is self-contained.

1. **YouTube channel** — use/create the UCT channel that will host the recordings.
   In YouTube Studio, **enable live streaming** (one-time identity verification, can
   take ~24h to activate). Set the channel's default upload/stream privacy to
   **Unlisted**.
2. **Persistent stream key** — YouTube Studio → **Go Live → Stream → Stream
   settings** → copy the **persistent Stream key** and **Stream URL**
   (`rtmp://a.rtmp.youtube.com/live2`). Persistent (reusable) is essential so it
   survives across recurring webinar occurrences. Set this stream's visibility to
   **Unlisted**.
3. **Zoom** — confirm Pro/Business + Webinar add-on. In Zoom **Settings → In
   Meeting (Advanced) → Allow livestreaming of webinars → Custom Live Streaming
   Service**, enable it.
4. **Configure the recurring webinar** — edit the daily webinar → **Live Streaming
   → Configure custom streaming service** → paste Stream URL + Stream key + a
   livestreaming page URL → **enable Auto-start** → save. (Configure on **desktop**;
   the iPhone host control only offers "Live on YouTube," not the custom service.)
5. **Google Cloud OAuth** — create a Google Cloud project, enable **YouTube Data
   API v3**, create an **OAuth client (Desktop)**, and run a one-time consent flow as
   the channel owner to mint a **refresh token** with `youtube.readonly`. Put the
   client id/secret/refresh token into Railway env.
6. **Flip on** `DESK_DAILY_SESSION_ENABLED=1`, redeploy, and verify after the next
   session that *"Daily Session — {date}"* appears under The Desk → Videos → Daily
   Sessions.

**Daily reality after setup:** the host just starts the webinar as usual. Auto-start
fires the YouTube broadcast; ~minutes after the webinar ends, the poll finds the
archived unlisted video and publishes it. If anything fails, the EOD safety net pings
the owner the same day.

## Out of scope (v1)

- Trimming / editing the recording (publish the raw archive; YouTube Studio can trim later).
- AI title/summary/auto-categorization (dated title is the requirement; smart metadata
  is a future enhancement).
- Auto-starting the webinar itself (host still opens the webinar; only the *stream*
  is auto-started).
- Multiple concurrent daily sessions (assumes one webinar/day; the poll handles >1 if
  it ever happens, each gets its own dated record).
