# ChartMaster Workshop Thumbnail — Artwork Plate Design

**Date:** 2026-07-01
**Status:** Approved (approach A — static plate + stamped date)
**Scope:** ChartMaster workshops ONLY. All other shows keep their existing cards
(classic / editorial / evening). No general plate system.

## What

"Workshop with ChartMaster" videos published by the Desk auto-publish pipeline
get a custom cinematic thumbnail: the owner's stormy-sea artwork (ornate gold
"CHARTMASTER" lettering over dark waves, "UNCHARTED TERRITORY WORKSHOP with"
eyebrow baked into the art) with the episode date stamped on per episode.

The current renderer (`api/services/desk_thumbnail.py`) draws fully
programmatic Pillow cards. This adds a fourth layout kind: **plate** — a
pre-made background image composited with a small dynamic date plaque.

## Trigger / routing

- `_resolve_theme()` gains a check: eyebrow label (or explicit
  `variant="chartmaster"`) containing `"chartmaster"` (case-insensitive) →
  a new `_CHARTMASTER_THEME` with `layout="plate"`.
- The eyebrow arrives from `desk_daily_session._route()` — auto-derived from
  the Zoom webinar topic ("Workshop with ChartMaster" → eyebrow
  `WORKSHOP WITH CHARTMASTER`), so no routing changes are needed there.
- Everything not matching "chartmaster" is untouched.

## Renderer — `_render_plate()`

1. Load `api/services/desk_assets/chartmaster-workshop.png` (bundled asset,
   absolute path like the compass/fonts so it renders identically on Railway).
2. Fit to 1280×720: LANCZOS resize; if the source aspect isn't exactly 16:9,
   cover-fit and center-crop (art is authored at 16:9, so this is a safety
   net, not a design tool).
3. Date plaque, bottom-center (mirrors the Evening Update pill):
   - Text: `date_text.upper()` (e.g. `JULY 1, 2026`), DejaVuSans-Bold ~30px,
     tracked +3, warm cream-gold fill `(251, 234, 202)`.
   - Rounded rect behind it: translucent dark fill `(0, 0, 0, ~130)`, 2px gold
     outline `(250, 212, 132)`, radius ~25, ~22px horizontal padding.
   - Vertical position: plaque centered at y ≈ 645 (inside the bottom 15%
     calm-water band the art reserves; exact y tuned visually at build time
     against the real plate and locked in the code).
4. Output: JPEG quality 95, subsampling 0 (same as existing cards; YouTube
   caps thumbnails at 2 MB — assert the encoded size stays under it in tests).

**Fallback (never break publish):** if the plate asset is missing or fails to
open, render the classic card instead. Thumbnails are already non-fatal in the
pipeline; this keeps the layout-level failure mode graceful too.

## Artwork plate — authoring brief (owner)

Regenerate the existing artwork with these constraints, then hand the file
over for bundling:

- **Canvas:** 1280×720 exactly (or 2560×1440; it will be LANCZOS-downscaled).
- **Composition:** same as the approved sample — eyebrow
  "UNCHARTED TERRITORY WORKSHOP" + flourishes + "WITH" in the upper sky,
  giant ornate gold CHARTMASTER filling the middle, stormy sea below.
- **Reserved date band:** bottom ~15% of the frame (y ≈ 610–720 at 1280×720),
  centered third of the width: calmer/darker water — no big splashes, foam
  crests, or bright highlights there, so the gold-outlined plaque reads
  cleanly at small card size.
- **Keep the CHARTMASTER lettering inside the middle ~70% vertically** so
  neither the plaque nor YouTube's timestamp overlay (bottom-right) clips it.
- Format: PNG or high-quality JPEG.

The file is committed at `api/services/desk_assets/chartmaster-workshop.png`
(re-encoded to PNG if needed).

## Backfill — tonight's episode

After ship + deploy, one-shot: render the new card for date text
`July 1, 2026` and re-set the thumbnail on the already-published video
`-XhibOL_5Fw` via the existing `youtube_client.set_thumbnail()` (covered by
the upload scope; replaces in place, no re-upload). Same `railway ssh`
execution technique as the 2026-07-01 re-enqueue, or a local run with the YT
env vars.

## Tests (`tests/test_desk_thumbnail.py` additions)

1. Routing: eyebrow `WORKSHOP WITH CHARTMASTER` resolves to the plate layout;
   `LIVE TRADING SESSION` still resolves classic.
2. Render smoke: with the bundled plate present, `render_session_thumbnail`
   returns valid JPEG bytes (magic number), 1280×720, < 2 MB.
3. Fallback: with the plate path monkeypatched to a missing file, rendering a
   chartmaster eyebrow returns the classic card (valid JPEG, no exception).

## Out of scope

- General plate registry / admin upload UI (explicitly rejected — ChartMaster
  only).
- Per-episode AI-generated artwork.
- Changes to `_route()`, the publish pipeline, or other show cards.
