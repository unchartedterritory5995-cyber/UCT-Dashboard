# Intro-video toolchain — proposal for the owner

**Status:** Phase 0 proposal (2026-10-17). Owner approves the toolchain before the first render; the
first three videos are approved before the rest are produced (spec §4.10). All production is
offline, here, on the owner's PC; videos are uploaded to R2 and served through a paid-gated
redirect (spec §13.2 T15). Captions are mandatory (spec §13.7 D15).

## What each video is

30-60 seconds. Opens on the thing itself (a real chart, a real number), says what you will be able
to do after the unit, ends on one line you can repeat. Brand motion graphics: gold on dark, the
compass mark, candles and lines drawn from **real bars** rendered by our own chart code. A stylized
animated host of the owner where it adds something. The owner's cloned voice reads the script.

## Proposed toolchain (A: no avatar, start here)

| Step | Tool | Why | Cost |
|---|---|---|---|
| Script | Written in sessions under `VOICE.md`, saved as `docs/study/intros/<unit>.md` | Owner reviews text, not video | 0 |
| Voice | **ElevenLabs** professional voice clone (needs ~30 min of clean speech, or an instant clone from a few minutes for the test), with consent recorded first | Best-in-class clone quality; per-character pricing; the owner controls the account | ~$22/mo (Creator) covers ~100k characters ≈ 120 scripts of 60 s; a Pro clone may need the $99/mo tier for the training; per video ≈ $0.10-0.40 |
| Visuals | **Remotion** (React-based video rendering) with the app's own React chart components and brand tokens | Our front end is React; the same components that draw drills draw the video, so every chart is real; deterministic renders; version-controlled | Free to use for individuals and small teams (verify the current Remotion license terms before the first render; a company license is modest if required) |
| Chart frames | `pattern_vision/chart_render.py` (mplfinance, ticker-free) for stills; lightweight-charts via Remotion for animated frames | Already exists | 0 |
| Captions | WebVTT generated from the script with ElevenLabs word timestamps | No transcription step; captions are exact | 0 |
| Encode | ffmpeg: 720p H.264 ≤ 6 MB + 540p rendition; poster PNG | Phone-first sizes | 0 |
| Store / serve | R2 `study/intros/<unit>.<sha>.{mp4,vtt,png}` via a PUSH_SECRET upload door; `GET /api/study/intro/{unit}` → 302 presigned (1 h) | The Desk-audio pattern | R2 ≈ $0.015/GB-month; 120 × 6 MB ≈ 0.7 GB |

**Per-video marginal cost ≈ $0.50 or less. Fixed ≈ $22-99/month while producing.**

## Option B: add the animated host

| Tool | Notes | Cost |
|---|---|---|
| **HeyGen** or **Synthesia** photo/video avatar, stylized | Needs a short consent video from the owner; produces a talking-head layer we composite into the Remotion scene | ~$29-99/month; per-minute credits |
| **D-ID** | Cheaper, lower quality | ~$6-30/month |
| Hand-drawn stylized avatar (illustrated, not photoreal) animated in Remotion with simple mouth/head motion | Brand-safe, clearly not "deepfake", no third-party likeness model | design time only |

Recommendation: ship Option A for the first three videos; test Option B's illustrated avatar on one
of them; decide after the owner sees both.

## Process

1. Owner signs `VOICE_CONSENT.md` and names the voice source.
2. Toolchain accounts created under the owner's email; keys stay out of the repo.
3. Three scripts approved → three renders → owner approves voice, pace, visuals, captions.
4. Batch the rest per track; owner reviews each script before render and each video on upload.
5. Units without a video show the designed card with the unit's glyph (never "coming soon").

## Open for the owner

- Approve Option A as the starting toolchain and its monthly cost.
- Choose the voice source (a Desk recording vs a fresh clean read).
- Whether to test the illustrated avatar on one of the first three.
