---
id: WISDOM-ZOOM-356-ROOT-CAUSE
title: Video 356 "Workshop with Stockbee" — 345 s stored of ~6,830 s, and the Zoom copy trashed
status: fixed in code (stream S-C, W1 §2.2); recording recovery is an owner-side step
generated: 2026-09-13
code: api/services/desk_session_insights.py · tests/test_desk_session_insights.py · tools/wisdom/sources_zoom_transcript_repair.py
---

# Video 356 — root cause, fix, and the recovery trap

No transcript text appears in this document (public repo). Locators only.

## 1. What was observed

| Fact | Value | Where measured |
|---|---|---|
| Video | edu_videos id 356, "Workshop with Stockbee", YouTube `rKVAkk3811Q` | manifest §2.1 |
| Meeting | uuid `K02BCIBPQTKxm51v+d7inQ==`, recorded 2026-09-11 | W1 §2.2 |
| Published video length | ~6,830 s | YouTube lengthSeconds (manifest §2.1) |
| Stored transcript | 76 cues, first at 57 s, last at 345 s → coverage 345 / 6,830 = **5.05 %** | `GET /api/education/videos/356/transcript-cues` (sample: `data/wisdom/samples/zoom_video_356.transcript_cues.json`, gitignored) |
| Zoom cloud copy | in Zoom trash | W1 §2.2 |
| Every other measurable video | 33 of 34 cover ≥ 98 % | manifest §2.1 |

## 2. Root cause

A stop/restart inside one Zoom meeting produces **one MP4 and one TRANSCRIPT recording file per
segment**, all under the same meeting uuid.

Two different selection rules picked two different segments:

| Step | Rule (before) | Picked |
|---|---|---|
| Publish (webhook) | `zoom_client.select_largest_mp4` — largest MP4 by `file_size` | the long segment (~6,830 s) → YouTube |
| Insights pass | `desk_session_insights._find_transcript_file` — the **first** completed TRANSCRIPT in `recording_files` | the short first segment (345 s) |

Nothing paired the transcript to the published MP4 (no `id`, `recording_start` or
`recording_end` comparison), nothing offset or stitched segments, and nothing measured
coverage before the recording was trashed. Because Zoom's AI summary supplied chapters and the
cue list was non-empty, `_run_one_pending` stored the short transcript and trashed the recording
**in the same pass** — the long segment's transcript was never fetched.

A second, quieter consequence: `_capture_media_provenance` anchors `media_started_at` on the
LARGEST MP4 while the cues came from another segment, so the stored cue offsets and the time
anchor referred to different recordings.

Ruled out: the 6 MB `download_text` cap and the 600 k-character `_timestamped_block` cap (a 345 s
VTT is orders of magnitude below both). A "transcript still processing" race is not the cause: a
non-completed file is skipped, and a completed first-segment file still wins.

⚠️ Verification status: the mechanism is proven by a fixture (§4) that reproduces the exact
shape; it is NOT yet verified against the live recording metadata, which is in Zoom trash and
unreachable with the S2S app's scopes (no list/recover scope). Confirm after recovery: count the
TRANSCRIPT files in `GET /v2/meetings/{uuid}/recordings`, compare each file's
`recording_start`/`recording_end` with row 356's `source_recording_file_id`.

## 3. Fix (in `api/services/desk_session_insights.py`)

1. **Pairing.** `plan_transcript_for_mp4(rec)` pairs the transcript to the published (largest) MP4
   by recording-window overlap. One overlapping file → `paired`; several → `stitched`, each cue
   offset by `file.recording_start − mp4.recording_start`; timed transcripts that do not overlap →
   `no_overlap` (none used — storing another segment's words is the defect). Untimed metadata
   falls back to the single / largest file. `build_paired_cues` drops cues before the MP4 start or
   past its end (+60 s grace).
2. **Coverage guard.** Before any `delete_recording`, `_trash_gate` computes
   `coverage = last stored cue / media duration` (the MP4's own window, else `edu_videos.duration`).
   Below **0.98** the recording is **kept**, the attempt is marked (`insights_at`), the result reads
   `trash_refused`, and `chart_health_alerts` emits `desk_transcript_coverage:<video_id>` at
   `critical` (once per video per process, plus the alert module's own cooldown). If the paired
   Zoom transcript covers more than the stored one, the gate stores it first (transcript only)
   and re-measures.
3. **Raw VTT archive.** Before any trash, every VTT (TRANSCRIPT / CC) and the recording metadata
   JSON (keys containing password/passcode/token removed) are written immutably through
   `api.services.wisdom.core.r2.put_immutable` to
   `wisdom/sources/zoom_vtt/<sha24(meeting_uuid)>/<recording_file_id>.vtt` and
   `.../recording-<sha256[:16]>.json`. A failed archive keeps the recording. A VTT whose key already
   holds different bytes is written beside it under a content-suffixed key, never overwritten.
4. **Kill switches**, read literally, unset = protections ON:
   `DESK_TRANSCRIPT_COVERAGE_GUARD_DISABLED`, `DESK_VTT_ARCHIVE_DISABLED` (`1/true/yes/on` disable).

Known limit, stated rather than hidden: when neither the MP4 window nor `edu_videos.duration` is
available, coverage is not measurable and the guard does not block (Zoom's recordings API returns
`recording_start`/`recording_end` on every MP4, so this is the untimed-metadata edge only). The
flag-off publish path in `desk_daily_session.py` (inline delete when
`DESK_SESSION_CHAPTERS_ENABLED != "1"`) is outside this stream's files and does not pass through
the gate — see the S-C report's integrator requests.

## 4. Repro and rails (`tests/test_desk_session_insights.py`)

The fixture `_rec_356()` is the 356 shape: a 345 s MP4 + TRANSCRIPT listed first, then the
6,830 s MP4 + TRANSCRIPT. Each test says red for one failure:

| Test | Says red when |
|---|---|
| `test_the_356_bug_first_in_list_transcript_is_the_short_segment` | documents the old selector (control for the fixture) |
| `test_the_transcript_is_paired_to_the_published_mp4_by_recording_window` | pairing regresses to list order |
| `test_multi_transcript_regression_stores_the_full_transcript_and_trashes_once` | the stored transcript ends at 345 s, or no archive precedes the trash |
| `test_several_overlapping_transcripts_are_stitched_with_offsets_to_the_mp4_start` | stitching loses the offset |
| `test_a_transcript_from_another_segment_is_never_used` | a non-overlapping segment is used |
| `test_the_guard_keeps_the_recording_while_coverage_is_below_98_percent` (+ control) | a < 98 % recording is trashed |
| `test_the_recovery_trap_repairs_from_the_paired_transcript_before_any_trash` | a recovered 356 is trashed without a fetch |
| `test_expired_wait_with_no_transcript_keeps_a_measurable_recording` | max-wait expiry deletes an uncovered recording |
| `test_an_archive_failure_keeps_the_recording` (+ control) | a trash happens without the archive |
| `test_the_archive_is_immutable_keyed_and_redacts_secrets` | a key overwrites, or a passcode lands in R2 |

Mutation checks run (break the guard, see red, restore) are listed in the S-C report.

## 5. The recovery trap — read this before touching 356 in Zoom

**Before this fix:** if the recording were recovered from Zoom trash and `zoom_cleaned` reset to 0,
the next `:07/:15` insights pass would see `has_chapters = True`, skip every fetch, and go straight
to `delete_recording` — trashing the recovered copy again with the 345 s transcript still stored.

**After this fix:** the same pass reaches `_trash_gate`, measures 5 % coverage, tries the paired
transcript from the recovered recording, stores it if it covers more, and trashes only when the
stored transcript covers ≥ 98 % and the VTTs are archived.

Still true after the fix, and why the manual path below exists:
- `videos_pending_insights` only lists videos created in the last 7 days (356 was created
  2026-09-11, so the window closes ~2026-09-18). After that the pass never revisits 356.
- **Do not reset `zoom_cleaned`** — that column belongs to the Desk pipeline.

## 6. Recovery procedure (owner-side step first)

1. Owner: Zoom web portal → Recordings → Trash → recover "Workshop with Stockbee" (2026-09-11).
   (The S2S app has no recover or list scope.)
2. Download the TRANSCRIPT VTT(s), naming each `<recording_file_id>.vtt`, and save the
   `GET /v2/meetings/{uuid}/recordings` JSON beside them.
3. Dry-run (prints before/after coverage, no writes):
   `python tools/wisdom/sources_zoom_transcript_repair.py --video-id 356 --youtube-id rKVAkk3811Q --length-seconds 6830 --vtt-dir <dir> --recording-json <dir>/recording.json --before-cues-file <samples>/zoom_video_356.transcript_cues.json`
4. If AFTER ≥ 0.98: repeat with `--apply` (PUSH_SECRET in env) — POSTs `{"transcript": ...}` ONLY.
5. Remove `"356"` from `C:\Users\Patrick\uct-recaps\polished.json` so the recap polish re-runs.
6. Trash the Zoom copy by hand once coverage is confirmed (or let a pass inside the 7-day window do
   it through the gate).

If the Zoom copy is unrecoverable: `--whisper` over R2 `desk_audio/rKVAkk3811Q.m4a` (no Zoom speaker
labels; ~CPU-bound — run under the heavy lock).

## 7. Before / after expectations

| | Before | After (expected) |
|---|---|---|
| Stored cues, last t | 345 s | ≥ 6,693 s (0.98 × 6,830) |
| Coverage | 0.0505 | ≥ 0.98 |
| `wisdom_sources.incomplete` (edu_videos:356) | 1 | 0 on the next version (a changed transcript sha creates v2) |
| Zoom copy | trashed with nothing archived | archived to R2, then trashed only through the gate |
