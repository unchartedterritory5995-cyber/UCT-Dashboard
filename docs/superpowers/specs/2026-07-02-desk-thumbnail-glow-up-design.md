# Desk Thumbnail Glow-Up — Classic / Editorial / Evening Redesign

**Date:** 2026-07-02
**Status:** Designs owner-selected from a 9-variant mockup round (3 per show).
**Scope:** Visual internals of the three code-drawn layouts in
`api/services/desk_thumbnail.py` ONLY. Routing, theme keys, layout names,
`render_session_thumbnail`'s signature/dispatch, the ChartMaster plate, title
and date formats are all UNCHANGED.

## Chosen designs

Reference mockups (scratch, produced by the variant studio round; the mockup
scripts live outside the repo and are the source recipes for the port):

1. **Classic → "Candlestick Skyline"** (`live_v2`): storm-lit dark navy
   backdrop with film grain + vignette; a large, softly-blurred glowing gold
   candlestick uptrend rises across the lower half of the frame like lit
   towers, ending in a bright close-dot; centered brand kit above it —
   compass, UNCHARTED TERRITORY wordmark, "— {eyebrow} —" gold eyebrow,
   metallic gold-foil DATE hero, tagline.
2. **Editorial → "Leather Journal"** (`thoughts_v3`): emerald leather-grain
   field; double gold frame with corner diamonds; compass medallion in a gold
   ring at top-center; gold-foil UNCHARTED TERRITORY; large metallic serif
   headline (the show name from the eyebrow); "— MARKET COMMENTARY —"
   diamond-flanked kicker; gold date; tagline.
3. **Evening → "City Lights on Water"** (`evening_v2`): the existing dusk-sky
   + skyline identity with the horizon raised; below it a dark bay with
   mirrored tower reflections, vertical window-light streaks and a central
   sun-glitter path; headline + "FROM {host}" subline as today; the gold
   date pill floats centered on the water band.

## Hard requirements (all three)

- **Dynamic text stays dynamic.** Classic and editorial take their headline/
  eyebrow text from `eyebrow_label` (classic is ALSO the default layout for
  unrecognized topics and the plate fallback — it must render any text,
  auto-fit, no clipping). Evening keeps its host-aware
  `"<headline> FROM <host>"` split exactly as implemented today.
- Date text format unchanged (`July 1, 2026` style in; per-layout casing as
  the design shows). Legible at ~427px card width.
- Output contract unchanged: 1280×720 RGB JPEG, quality 95, subsampling 0,
  < 2 MB.
- Existing test suite (`tests/test_desk_thumbnail.py`) stays green unchanged;
  the routing tests and plate tests are untouched by design.
- Brand kit on every card: compass mark, UNCHARTED TERRITORY, show name,
  date, gold #c9a84c family. Tagline stays on all three (present in all
  three chosen mockups).
- Each show remains visually distinct at a glance (file's stated design
  philosophy).

## Implementation shape

- Port each mockup recipe into the module as the new body of
  `_render_classic` / `_render_editorial` / `_render_evening` (same
  signatures `(theme, date_text, eyebrow_label) -> Image`). Helper functions
  added at module level where reused (grain, frame, reflections), following
  the existing private-helper idiom. Delete now-unused pieces of the old
  bodies only when nothing else references them (`_draw_uptrend` remains —
  classic's new design uses a restyled variant of it; `_skyline` remains for
  evening).
- The old editorial layout key `"editorial"` keeps working for the
  `"thoughts"`/`"emerald"` theme entries; only its rendering changes.
- No new assets, no new dependencies (pure Pillow).
- One new smoke test per layout: render via `render_session_thumbnail` with
  that show's eyebrow and assert JPEG magic + 1280×720 + <2MB (mirrors the
  plate smoke test), including one classic render with a LONG arbitrary
  eyebrow (auto-fit/no-crash check).

## Rollout

- Build + iterate in worktree `.worktrees/thumbs` (branch
  `feat/thumbnail-glow-up`). Render full-size proofs + a 427px-wide strip for
  owner review. **Push to master ONLY after owner approves the proofs.**
- Future episodes pick the new cards up automatically at publish time. No
  backfill of already-published videos in this scope (owner can request
  one-shots later; the ChartMaster backfill recipe applies).

## Out of scope

- ChartMaster plate (explicitly untouched).
- Routing/`_route`/section names, pipeline behavior, YouTube metadata.
- Backfilling old video thumbnails.
