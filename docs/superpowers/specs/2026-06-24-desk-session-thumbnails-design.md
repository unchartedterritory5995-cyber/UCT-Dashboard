# Live Trading Sessions — Branded Thumbnails + Rename

**Date:** 2026-06-24
**Status:** Approved
**Author:** Claude + Patrick

## Goal

Two changes to the Desk Daily Sessions pipeline (`project_desk_daily_sessions_2026_06_24`):
1. **Rename** the landing section + per-video title from "Daily Session(s)" → **"Live Trading Session(s)"**.
2. **Auto-generate a branded thumbnail** for each session video and stamp it on YouTube during publish.

## 1. Rename

- **Category** (The Desk section): `Daily Sessions` → **`Live Trading Sessions`**. Driven by
  `DESK_DAILY_SESSION_CATEGORY` (Railway env) + the code default in `desk_daily_session._category()`.
- **Per-video title:** `_session_title()` prefix `Daily Session —` → **`Live Trading Session —`**
  (e.g. `Live Trading Session — June 24, 2026`). ET date, em-dash, unchanged otherwise.
- **Thumbnail eyebrow:** `— LIVE TRADING SESSION —`.

Existing 12s/1min test videos are disposable — deleted, not migrated. No backfill.

## 2. Branded thumbnail

Branded card (user-approved), 1280×720 JPEG:
- Dark UCT background; **compass mark** (`desk_assets/compass-mark.png`); **"UNCHARTED TERRITORY"**
  wordmark; gold **"— LIVE TRADING SESSION —"** eyebrow (`#c9a84c`); **date large**
  (e.g. *June 24, 2026*); tagline *"Navigate the market, effectively."*
- Fonts bundled in-repo (`desk_assets/DejaVuSans-Bold.ttf` + `DejaVuSans.ttf`) and loaded by
  absolute path so rendering is identical on Railway.

### Architecture (3 units)

1. **`api/services/desk_thumbnail.py`** — `render_session_thumbnail(date_text: str) -> bytes`.
   Pure Pillow render → JPEG bytes (1280×720, RGB). No network, no I/O beyond reading the bundled
   assets. `date_text` is the already-formatted date (e.g. `"June 24, 2026"`).
2. **`api/services/youtube_client.py`** — `YouTubeClient.set_thumbnail(video_id, image_bytes) -> None`.
   POSTs the image to `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId={id}`
   with `Content-Type: image/jpeg` + the upload-scoped bearer token (the `youtube.upload` scope
   already covers `thumbnails.set`; channel is custom-thumbnail-eligible via phone verification).
   Raises `YouTubeApiError` on non-2xx.
3. **`api/services/desk_daily_session.py`** (processor) — after `upload_unlisted` + `mark_uploaded`,
   call `set_thumbnail(vid, render_session_thumbnail(date_text))`. The date_text is derived from the
   same `_to_et(start_time)` used for the title (factor out a small `_session_date_text()` helper so
   title + thumbnail share one date).

### Failure handling — NON-FATAL

Thumbnail generation or `set_thumbnail` failure must **never** fail publish. Wrap the
thumbnail step in its own try/except inside the processor: log + continue. The video is the
deliverable; the thumbnail is cosmetic and can be set manually in YouTube Studio anytime.
(Mirrors how `delete_recording` failure is already swallowed.)

## Data flow

```
upload_unlisted -> videoId
   -> mark_uploaded(uuid, videoId)
   -> try: set_thumbnail(videoId, render_session_thumbnail(date_text))  [non-fatal]
   -> create_video({category: "Live Trading Sessions", title: "Live Trading Session — {date}"})
   -> delete_recording  [non-fatal]
   -> mark_done
```

## Testing

- `render_session_thumbnail("June 24, 2026")` returns non-empty bytes; `Image.open(BytesIO(...))`
  is 1280×720, mode RGB (JPEG). (Renders without network.)
- `set_thumbnail` POSTs to the thumbnails/set URL with `videoId` param + bearer token + image body
  (monkeypatched httpx); raises `YouTubeApiError` on non-2xx.
- Processor: after a successful upload it calls `set_thumbnail`; a `set_thumbnail` that raises still
  leaves the job `done` and the Desk record created (thumbnail failure is non-fatal).
- Title/category: `_session_title` → `Live Trading Session — June 24, 2026`; default category
  `Live Trading Sessions`.

## Assets

`api/services/desk_assets/`: `compass-mark.png` (copied from the app's intro asset),
`DejaVuSans-Bold.ttf`, `DejaVuSans.ttf` (freely redistributable; loaded by absolute path).

## Out of scope

Per-session custom art, post-hoc thumbnail editing (YouTube Studio handles manual swaps),
exact brand font (DejaVu used for v1; swap to Instrument Sans later if desired).
