# "From the Desk" Dashboard Video Rail

**Date:** 2026-06-26
**Status:** Approved design, pending implementation plan
**Author:** brainstormed with Patrick

## Goal

Surface The Desk's videos on the main Dashboard so paid users discover and resume
them without going to `/desk`. A horizontal "From the Desk" rail leads with the
user's in-progress videos (Continue Watching) and fills out with the newest
additions. Clicking a card opens the video in the existing persistent player
(docked Desk theater). This is the "discovery" half of the broader video
initiative; the persistent player ([[project_desk_video_mini_player_2026_06_25]])
is the enabler.

## Background — what exists (reuse, don't rebuild)

- `GET /api/education/videos` (paid-gated) returns `{ categories: [{name, videos[]}], total }`.
  `list_videos()` does `SELECT *`, so each video object includes `id`, `youtube_id`,
  `title`, `description`, `category`, `duration`, `sort_order`, **`created_at`**,
  `updated_at`. **No backend change needed** — `created_at` powers "latest".
- `app/src/pages/desk/videoProgress.js` — watch progress store (`subscribe`,
  `getSnapshot`, `hydrateFromServer`); shape `{ [youtube_id]: { t, d, at, done } }`.
- `app/src/components/video/videoStore.js` — `play(list, index)` opens the
  persistent player docked.
- `app/src/pages/desk/VideosSection.jsx` — reference for the Continue Watching
  derivation and the up-next rail card markup (thumbnail + title + progress bar).
- `app/src/pages/Dashboard.jsx` — desktop layout is a stack of full-width rows
  (`row1`, `IntradayPulse`, `compassRow`, `CatalystTable`, `row2`, `row3`, `row4`).
  Paid-only (route gated; `/dashboard` not in `FREE_PAGES`).
- `app/src/pages/education/icons.jsx` — `GraduationIcon`, `PlayIcon` (brand gold).

## Placement

A new full-width row in `Dashboard.jsx`'s desktop stack, **immediately after
`<CatalystTable />` and before `row2`** (prominent, above the movers/breadth row).
Mobile: the same component renders in the existing mobile flow below the
equivalent point; the rail is a horizontal scroller so it adapts to width.

## Architecture

One new component, `DeskVideoRail`, plus a pure `buildRail` helper. It reads the
shared SWR cache for `/api/education/videos` and subscribes to `videoProgress`.
No new state stores, no backend.

### Components

**1. `app/src/components/dashboard/buildRail.js`** (pure)
- `buildRail(categories, progress, cap = 12)` → ordered array of rail items.
- Item shape: `{ video, list, index, pct, resume }` where
  - `video` — the video object,
  - `list` — that video's category `videos` array (so the player's up-next
    matches the library),
  - `index` — the video's position within `list`,
  - `pct` — integer 0–100 watched (0 when not started),
  - `resume` — boolean (true for Continue Watching items).
- Order: **Continue Watching first** — entries with `progress[id]` that are
  `!done` and `t >= 8`, newest first by `progress[id].at`. Then **Latest** — all
  remaining videos (not already included, not `done`) sorted by `created_at`
  desc. Concatenate and slice to `cap`.
- Dedup by `youtube_id` (a video is never in both groups).

**2. `app/src/components/dashboard/DeskVideoRail.jsx` (+ `.module.css`)**
- `useSWR('/api/education/videos', fetcher)` — same key/fetcher as `VideosSection`
  so the cache is shared (no extra network on a warm cache).
- `useSyncExternalStore(subscribe, getSnapshot, getSnapshot)` for progress; calls
  `hydrateFromServer()` once on mount.
- `const items = useMemo(() => buildRail(categories, progress), [categories, progress])`.
- **Render `null`** if `isLoading`, `error`, or `items.length === 0` (no empty box).
- Otherwise: a section with a gold "From the Desk" header (`GraduationIcon` +
  label + a "View all →" link to `/desk?section=videos`) and a horizontal
  scroller of cards. Each card: thumbnail (`https://i.ytimg.com/vi/{id}/hqdefault.jpg`),
  `PlayIcon` overlay, title, and a progress bar when `pct > 0`. A "Resume" pill on
  `resume` items.
- **Click** → `play(item.list, item.index)` then
  `navigate('/desk?section=videos')`.
- Cards are `flex: 0 0 auto` in an `overflow-x: auto` row (mirrors the existing
  up-next rail / `SegmentedNav` scroll pattern; hidden scrollbar).

**3. `app/src/pages/Dashboard.jsx`** — import and render `<DeskVideoRail />` as a
new row right after `<CatalystTable />`. **4. `Dashboard.module.css`** — a row
wrapper class if needed for spacing (reuse existing row gap).

### Data flow

Dashboard mounts → `DeskVideoRail` reads the shared videos cache + progress →
`buildRail` derives the ordered items → render (or `null`). Click → persistent
player opens docked + route changes to the Desk, where `VideoDockSlot` docks it.

### Error handling

- Fetch error or empty library → component renders `null` (dashboard unaffected).
- Unknown/missing `created_at` on a row → treat as `0` (sorts last) so a bad row
  never throws.
- Thumbnails use the standard YouTube thumbnail URL; a broken image just shows the
  card background (no special handling needed).

## Testing

- **Unit — `buildRail`:** Continue Watching ordered newest-first and placed before
  Latest; Latest sorted by `created_at` desc; `done` videos excluded; dedup across
  groups; `cap` respected; empty input → `[]`; `pct` computed correctly.
- **Component — `DeskVideoRail`:** with a mock API response + progress, renders a
  resume card before a latest card; a click calls `play` with the right
  `(list, index)` and navigates to `/desk?section=videos`; renders nothing on
  empty/error.

## Files

**New**
- `app/src/components/dashboard/buildRail.js` (+ `buildRail.test.js`)
- `app/src/components/dashboard/DeskVideoRail.jsx` (+ `.module.css`, + `.test.jsx`)

**Modify**
- `app/src/pages/Dashboard.jsx` (render the rail after `CatalystTable`)
- `app/src/pages/Dashboard.module.css` (row spacing, if needed)

**Reuse, unchanged**
- `videoStore.play`, `videoProgress` (`subscribe`/`getSnapshot`/`hydrateFromServer`),
  `/api/education/videos`, `pages/education/icons`.

## Out of scope (YAGNI / follow-ups)

- The other surfaces (ticker/research contextual videos, empty states, Morning
  Wire cross-links) — separate efforts.
- A dedicated "latest" backend endpoint — not needed; client sorts the existing
  payload.
- Personalized recommendations beyond Continue Watching + Latest.
