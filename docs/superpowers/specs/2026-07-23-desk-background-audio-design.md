# THE DESK — Background Audio (screen-locked playback) — Design

**Date:** 2026-07-23
**Branch:** `feat/desk-bg-audio`
**Status:** Design approved; pending spec review → implementation plan

## Problem

On mobile, THE DESK videos stop the instant the phone screen locks/blanks — so a member cannot pocket the phone and keep listening. This is table-stakes for anyone actually consuming session content on mobile (the YouTube app has it; our web player does not).

## Root cause (verified)

THE DESK player is a single **YouTube IFrame Player** (`YT.Player`) mounted once at app root (`app/src/components/video/GlobalVideoLayer.jsx`), fed `youtube_id`s from `GET /api/education/videos`. When the screen locks, the browser **suspends the cross-origin YouTube iframe** and audio stops. A website **cannot** override this on a YouTube iframe: `MediaSession`/`WakeLock` require a media element the page controls, and the iframe is cross-origin. YouTube's own background play is an app/Premium-level feature, not something an embedding site can unlock.

## Chosen approach — "audio-primary, muted-video-follows"

Serve an app-controlled **audio track** (extracted from each session's own MP4) and play it through a native same-origin `<audio>` element that becomes the **source of truth** on mobile. On the play tap we start **both** the `<audio>` element (unmuted) **and** the YouTube video **muted**, kept loosely time-synced. Screen on → member sees the muted video and hears the audio element. Screen locks → the muted iframe suspends harmlessly; the already-playing `<audio>` element keeps going with lock-screen controls via the **MediaSession API**. Nothing has to *start* at the fragile lock moment — that is what makes "it just keeps going" robust.

Decisions locked with the owner:
- **Seamless / automatic** (no "Listen" button) — audio continues the instant the screen locks.
- **Full coverage** — pipeline extraction for new sessions **plus** a one-time backfill of the existing ~300-video library.

### Why this shape (validated against iOS Safari, the hardest target)

- **Muting the video is the documented fix, not a gamble.** Two *unmuted* media elements fight over iOS's single audio session; Apple's own developer forums confirm that a playing `<video>` pauses a separate `<audio>`, and adding `muted` to the video makes the conflict "disappear." Multiple *muted* elements coexist freely.
- **A gesture-started, already-playing `<audio>` + MediaSession survives screen-lock** on a regular Safari tab. (The "controls die after ~30s" iOS bugs are **PWA/standalone-mode only** — WebKit #261858 — so we stay a normal Safari tab, not an installed PWA. Our native/PWA track is parked anyway.)
- **The "simpler" handoff idea is refuted:** you cannot *start* `<audio>` during a `visibilitychange`→hidden event on iOS (not a user gesture). So the audio must already be playing from the original tap — i.e. the seamless design is the *only* one that works, not just the nicest.
- **A muted YouTube iframe honors programmatic `playVideo()`/`seekTo()` on mobile** (mobile only honors programmatic play when muted — which we are), so we can keep it synced while visible.

## Architecture

```
                         ┌─────────────────────────────────────────┐
  play tap (gesture) ───►│ GlobalVideoLayer (mobile / coarse-ptr)   │
                         │  1. start <audio> (unmuted)  ◄── clock   │
                         │  2. YT.player.mute(); seekTo; playVideo  │
                         │  3. MediaSession: metadata + handlers    │
                         └───────────────┬─────────────────────────┘
                                         │ audio is source of truth
   scrubber / seek / rate / chapters ────┤  (writes audio, mirrors to muted YT)
                                         │
             visibilitychange→visible ───┤  one authoritative seekTo(audio.currentTime)
                                         ▼
   screen locks ─► muted iframe suspends (harmless) ─► <audio> keeps playing ─► lock-screen controls
```

Audio bytes come from an app endpoint that redirects to a presigned R2 URL:

```
GET /api/education/videos/{id}/audio  ──302──►  presigned Cloudflare R2 URL (short TTL)
```

## Backend design

All target files are dashboard/desk-owned (none in partner "Ravi"'s set).

### 1. Schema (`api/services/education_service.py`)
Add two nullable, additive columns to the existing boot-time `_EXTRA_COLUMNS` migration tuple (idempotent `ALTER TABLE ... ADD COLUMN` on boot, same pattern as `meeting_uuid`/`poster`):
- `("audio_url", "TEXT")` — R2 object key (or full key path) for the extracted audio; `NULL` = no audio yet.
- `("audio_at", "INTEGER")` — unix ts when audio was produced.

Add a single-column setter mirroring `set_meeting_uuid`:
```python
def set_audio(video_id, audio_key):
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("UPDATE edu_videos SET audio_url = ?, audio_at = ?, updated_at = ? WHERE id = ?",
                  (audio_key, int(time.time()), int(time.time()), int(video_id)))
        c.commit()
```

### 2. Extraction in the live pipeline (`api/services/desk_daily_session.py`)
The temp `.mp4` exists on local disk only inside the `if not vid:` block, from `zoom.stream_download` until the `finally: os.remove(tmp)`. **Ordering matters:** at the point right after `mark_uploaded(uuid, vid)` the `edu_videos` row does **not** exist yet — it is created further down (`create_video`, then `set_meeting_uuid(row["id"], uuid)`). So split the work in two:

- **(a) Extract + upload** immediately after `mark_uploaded`, keyed on the `youtube_id` (`vid`) we already have, in its **own `try/except` that never re-raises** — mirroring the branded-thumbnail step, so an ffmpeg failure can never break YouTube publishing. The R2 key is **deterministic** (`desk_audio/<youtube_id>.m4a`), so no row id is needed here.
- **(b) DB write** once the row is known — piggyback on the existing `set_meeting_uuid(row["id"], uuid)` site near the end of the successful path: also call `education_service.set_audio(row["id"], key)` (only if extraction in (a) succeeded).

```python
# (a) after: desk_session_jobs.mark_uploaded(uuid, vid)
audio_key = None
if desk_background_audio.is_enabled():
    try:
        audio_key = desk_background_audio.extract_and_store(tmp, vid)  # ffmpeg -> R2, returns key
    except Exception as ae:
        log.warning("bg-audio extract failed (non-fatal): %s", ae)

# ... existing publish / create_video ...
# (b) at the existing set_meeting_uuid(row["id"], uuid) site:
if audio_key:
    education_service.set_audio(row["id"], audio_key)
```

- ffmpeg command: `ffmpeg -i <tmp.mp4> -vn -c:a aac -b:a 96k -ac 2 -movflags +faststart <out.m4a>`. **96 kbps stereo** (not 64): because audio-primary means the member hears this track even while watching on-screen, so it must be transparent for speech + screen-share — 96k is, and it's still only ~0.7 MB/min (~13 GB for the full ~300-video backfill on R2). Mono `-ac 1` remains an option if storage ever matters more than a stereo screen-share.
- **Caveat (documented):** extraction only sees a local mp4 on the *first* successful pass. A job reclaimed after upload (already has `youtube_id`) skips the download block, so it has no local mp4 — those, plus jobs that crash after upload, fall to the yt-dlp backfill. New-session audio must be captured on that first pass.

### 3. New module `api/services/desk_background_audio.py`
- `is_enabled()` → `os.environ.get("DESK_BACKGROUND_AUDIO_ENABLED", "") == "1"` (this feature area uses plain `os.environ`, **not** a `CONFIG` object).
- `extract_and_store(mp4_path, youtube_id)` → ffmpeg extract → R2 put → returns key.
- `audio_key(youtube_id)` / `presigned_url(youtube_id, expires=3600)`.

### 4. R2 helper (`api/services/data_sync.py`)
`data_sync._client()` already builds a boto3 S3 client for R2 (`DATA_SYNC_ENDPOINT_URL/ACCESS_KEY/SECRET_KEY/BUCKET/REGION`). No presigned-URL helper exists yet, but boto3 supports it natively. Add a small public helper:
```python
def presigned_get(key, expires=3600):
    cl = _client()
    if not cl:
        return None
    return cl.generate_presigned_url("get_object",
        Params={"Bucket": _bucket(), "Key": key}, ExpiresIn=expires)
```
Also add a thin `put_bytes(key, data, content_type)` / reuse existing `put_object`/`upload_file` for the audio upload. **R2 is best-effort/optional**: when creds are unset, `_client()` returns `None` — extraction skips and the serve endpoint 404s. No hard runtime dependency on R2.

### 5. Serve endpoint (`api/routers/education.py`)
Add beside `get_video_poster`, gated by `require_paid`:
```python
@router.get("/videos/{video_id}/audio")
def get_video_audio(video_id: int, _user: dict = Depends(require_paid)):
    row = education_service.get_video_row(video_id)  # exact single-row accessor resolved in the plan
    if not row or not row.get("audio_url"):
        raise HTTPException(404, "No background audio for this video")
    url = data_sync.presigned_get(row["audio_url"])
    if not url:
        raise HTTPException(404, "Audio storage unavailable")
    return RedirectResponse(url, status_code=302)
```
(If no single-row accessor exists yet, the plan adds one mirroring existing read helpers; the key is deterministic so the row read is only needed to confirm audio exists + gate.)
Add `RedirectResponse` to the `fastapi.responses` import (currently only `FileResponse`). 302-redirect keeps audio bytes/Range traffic off the app pod (R2 serves directly). Pattern precedent: `schwab_router.py` already returns a `RedirectResponse`.

### 6. Build (`nixpacks.toml`)
Add `"ffmpeg"` to `[phases.setup] nixPkgs` (currently `["python312","nodejs_20","nodePackages.npm"]`). **This is the only hard build change** — new-session extraction runs in-process on the **web** pod (that is where the desk queue drains). `yt-dlp` is **not** added to prod — it is local backfill tooling only.

### 7. One-time backfill (local, not prod) — `tools/desk_audio_backfill.py`
Iterate `edu_videos WHERE audio_url IS NULL`; for each, `yt-dlp -f bestaudio -x --audio-format m4a <youtube_id>` (our own unlisted/owned uploads), transcode to 96k AAC (match the pipeline), upload to R2, `set_audio`. Run from the owner's PC (avoids YouTube IP-blocking of Railway, keeps `yt-dlp` out of the prod image). Rate-limit + resumable (skip rows that already have `audio_url`). ~300 rows, one-time.

## Frontend design (`app/src/components/video/GlobalVideoLayer.jsx`)

Mobile gate: reuse the existing imperative idiom already in this file — `window.matchMedia('(pointer: coarse)')?.matches` — inside the **play path** (a behavioral, click-time decision, so the `useMediaQuery` stale-first-paint gotcha does not apply). Desktop keeps today's exact YouTube behavior (and its existing Document-PiP).

Changes:
1. **Own a hidden `<audio ref>`.** On the mobile play path: `audioEl.src = /api/education/videos/{id}/audio; audioEl.play()` **inside the tap**, then `yt.mute(); yt.seekTo(0/resume); yt.playVideo()`. If the video has no `audio_url` (404), fall back to today's YouTube-only behavior — **no regression**.
2. **Make audio the clock.** Reroute these writers to write the audio element first, then mirror to the muted YT player: `togglePlay`, `seekBy`, `seekFrac`, `cycleRate` (`audioEl.playbackRate` + `yt.setPlaybackRate`), `applyVolume`/`toggleMute` (volume acts on the audio element; YT stays muted), the store-driven `seekReq` effect, the 300ms scrubber-poll effect (`setProg` from `audioEl.currentTime`/`duration`), and `registerTimeGetter` (point at the audio clock).
3. **New lifecycle resync effect.** Add a `visibilitychange`/`pageshow` listener: on becoming visible, do one authoritative `yt.seekTo(audioEl.currentTime, true)` and reconcile play/pause — accept a single deliberate re-buffer rather than fighting drift continuously. While visible, correct YT only when `|ytTime - audioTime| > 0.4s` (threshold-gated; prefer a small `setPlaybackRate` nudge for sub-threshold drift; never seek every tick).
4. **MediaSession block** (lift from `AudioPlayerBar.jsx` L166–190): `MediaMetadata` (title, artist "UCT Intelligence", `artwork` = `https://i.ytimg.com/vi/{id}/hqdefault.jpg`, a modest 256–512 square), `setActionHandler('play'|'pause'|'seekbackward'|'seekforward'|'seekto')`, and `setPositionState` (best-effort; iOS support is inconsistent — guard on finite duration, don't rely on it). Chapters are already in scope via `useVideoInsights(current?.id)` (`{t,title}` shape).
   - **Lock-screen buttons (owner call = default ±15s seek).** On iOS the lock screen shows **either** skip-±seconds **or** previous/next — not both. Default: register `seekbackward`/`seekforward` (±15s), matching podcast familiarity; chapters remain available in-app via the scrubber. (Alternative on request: wire `previoustrack`/`nexttrack` to chapter jumps instead.)

### Voice-subsystem touchpoints (high scrutiny — read-aloud has prior incidents)
5. **`audioExclusivity.js`** — `pauseOtherAudio()` (fired on the YT `PLAYING` event) currently pauses **every** `<audio>` on the page *and* `speechSynthesis.cancel()`. It will silence our own new audio element. Fix: tag the video's audio element (e.g. `data-uct-video-audio`) and **exclude it** from the `querySelectorAll('audio')` sweep. Keep read-aloud behavior otherwise identical.
6. **MediaSession arbiter** — `navigator.mediaSession` is a single global that `AudioPlayerBar` reclaims whenever voice is non-idle. Add explicit ownership: when the Desk video is the active player it owns MediaSession; while it is active, suppress the read-aloud bar's reclaim (or last-play-wins). Do not regress the read-aloud lock-screen/stop behavior.

### Flags
- Frontend: `const bgAudioEnabled = import.meta.env.VITE_DESK_BG_AUDIO_ENABLED === '1'` (default-off).
- Backend: `DESK_BACKGROUND_AUDIO_ENABLED=1`.
- Ship **dark** first; enable after real-device verification.

## Testing

- **Backend unit** (pytest): schema migration adds columns; `desk_background_audio.extract_and_store` (mock ffmpeg + R2) sets `audio_url` and is non-fatal on failure; serve endpoint 302s to a presigned URL, 404s when no audio / no creds / not paid; flag gating.
- **Frontend unit** (vitest `--pool=threads`): extend `app/src/components/video/GlobalVideoLayer.test.jsx` — add a fake `<audio>` and assert the mobile play path starts audio + mutes YT, that scrubber/seek/rate route to the audio element, that a no-`audio_url` video falls back to YT-only, and that `audioExclusivity` no longer pauses the tagged element.
- **Real-device (required, jsdom cannot prove this):** iOS Safari + Android Chrome — lock the phone mid-playback and confirm audio continues with working lock-screen controls; unlock and confirm the video resyncs; confirm read-aloud + video don't stomp each other's MediaSession. Consistent with the project's mobile-verification lessons (reading CSS/DOM ≠ verifying mobile behavior).

## Rollout

1. Land backend (schema, module, endpoint, nixpacks ffmpeg) behind `DESK_BACKGROUND_AUDIO_ENABLED` — dark.
2. Run local backfill for the ~300 existing videos → R2.
3. Land frontend behind `VITE_DESK_BG_AUDIO_ENABLED` — dark.
4. Real-device verification pass.
5. Owner enables both flags. Respect dashboard deploy windows (web deploys ≥4:20 PM ET or <9:15 AM ET; pre-push hook enforces).

## Risks & mitigations

1. **Lock→unlock drift (top engineering risk).** The muted iframe is suspended while backgrounded, so its clock stalls; the YT `seekTo` is coarse and re-buffers. Mitigation: audio is the sole always-running clock; one authoritative `seekTo` on foreground-return; threshold-gated corrections while visible. Drift is invisible while the screen is off anyway.
2. **Voice-subsystem regression** (`audioExclusivity` + MediaSession singleton). Mitigation: minimal, tagged exclusion + explicit MediaSession ownership; regression tests around read-aloud stop/lock-screen behavior; treat as the careful part of the change.
3. **R2 unset / audio missing.** Mitigation: graceful degrade to YouTube-only; feature simply doesn't light up.
4. **yt-dlp backfill fragility / ToS.** Content is our own; run locally, rate-limited, resumable; not a prod dependency.

## Escape hatch (documented, not built)

If real-device two-player sync feels janky, self-hosting the **video** too (a single same-origin muted `<video>` served like the audio) eliminates the cross-origin suspension and the two-timeline sync entirely — same backend, larger storage/bandwidth. This is also the Model-B ("explicit Listen toggle") fallback surface.

## Out of scope

- Native app / PWA background audio (parked).
- Offline download.
- Self-hosting full video (escape hatch only).
