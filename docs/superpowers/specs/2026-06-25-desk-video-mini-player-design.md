# Persistent Video Mini-Player — The Desk → Videos

**Date:** 2026-06-25
**Status:** Approved design, pending implementation plan
**Author:** brainstormed with Patrick

## Goal

Make watching The Desk's YouTube videos a *premier* experience that lets users
**keep using the rest of the app while a video plays**. Today the player is
trapped inside the Desk Videos section (a Sheet/modal); navigating away stops
the video. We want a single video to keep playing seamlessly as the user moves
to charts, journal, dashboard, etc., via a persistent floating **mini-player**,
with a smooth shrink/grow transition and branded controls.

## Background — what already exists

The Videos section is already mature (do not rebuild these):

- `app/src/pages/desk/VideoPlayer.jsx` — custom player on the **YouTube IFrame
  Player API** (not a raw iframe), mounted to a React-untouched div node, with
  autoplay-next + "up next" rail. Lives inside a Sheet modal today.
- `app/src/pages/desk/videoProgress.js` — watch progress: localStorage instant +
  write-behind sync to `/api/education/progress` (2.5s debounce), cross-device
  hydrate-and-merge. `DONE_RATIO=0.92`, `MIN_RESUME=8`. **Reused unchanged.**
- `app/src/pages/desk/VideosSection.jsx` — library grid, Continue Watching,
  learning paths, search/category filter, admin CRUD.
- `app/src/pages/desk/useYouTubeApi.js` — YT API loader. **Reused.**
- `app/src/pages/desk/learningPaths.js` — curated ordered sequences. **Reused.**
- Backend `api/routers/education.py` + `api/services/education_service.py` —
  videos + progress (SQLite `/data/education.db`). **No backend changes needed.**

App shell context that makes this possible:

- `App.jsx` mounts `GlobalVoiceLayer` and `GlobalAddPositionProvider` **outside
  `<Routes>`** — proven route-persistent mount points. The new layer goes here.
- Existing fixed overlays / z-index: voice `FloatingOrb` = 8000, read-aloud
  `AudioPlayerBar` = 9000 (centered bottom), `MobileTabBar` = 300 (fixed bottom,
  ~58px + `env(safe-area-inset-bottom)`), modals/sheets = 1000.

## Core technical constraint

A `<iframe>` **reloads (restarts the video) if it is moved in the DOM**. Therefore
the player must be created **once**, live at the app root, and only ever be
**visually repositioned** — never re-parented or re-mounted. The store changes
*mode*; the layer animates the fixed host's rectangle. Zero reloads, ever.

(Rejected alternatives: reparenting the iframe between containers — reloads it;
native Picture-in-Picture — cross-origin YouTube iframes block it and it
surrenders our branded chrome.)

## Architecture

One `YT.Player` instance owned by a new **`GlobalVideoLayer`** mounted next to
`GlobalVoiceLayer` in `App.jsx`. A global store drives its mode:

- `closed` — hidden, no active video.
- `docked` — full "theater" filling a slot inside the Desk Videos section.
- `mini` — floating corner player that persists across all routes.

### Components

**1. `app/src/components/video/videoStore.js`** (new)
Global now-playing state via `useSyncExternalStore` (mirror `videoProgress.js`
style: module-level state + listeners + `getSnapshot`).

State:
- `video` — `{ youtube_id, title, category, duration }` or null
- `context` — ordered list of videos (category list or learning path) for next-up
- `index` — position of `video` within `context`
- `mode` — `'closed' | 'docked' | 'mini'`
- `playing` — bool (mirrors player state)
- `position`, `duration` — seconds (for the mini scrubber)
- `corner` — `'br' | 'bl' | 'tr' | 'tl'`, persisted to localStorage
- `dockRect` — measured rect of the active dock slot, or null

Actions:
- `play(video, context)` — set video+context, `mode='docked'`
- `minimize()` — `docked → mini` (manual button)
- `expand()` — `mini → docked`; also navigates to `/desk?section=videos`
- `close()` — flush progress, `mode='closed'`, clear video
- `next()` — advance to `context[index+1]` if present (works in either mode)
- `setCorner(corner)` — persist + reposition
- `registerDockSlot(rect)` / `clearDockSlot()` — slot lifecycle (see below)
- internal setters: `setPlaying`, `setPosition`

Auto-shrink rule: when `clearDockSlot()` fires while `mode==='docked'`, the store
flips to `mini`. When `registerDockSlot()` fires while a video is active and
`mode==='mini'`, it re-docks to `docked`.

**2. `app/src/components/video/GlobalVideoLayer.jsx` (+ `.module.css`)** (new)
- Owns the single `YT.Player`, created once (StrictMode-safe create-once ref
  guard), mounted into a div node React never touches (same technique as
  `VideoPlayer.jsx` today). Uses `useYouTubeApi`.
- Renders a `position: fixed` host. On store change:
  - `docked` + `dockRect` → animate host to fill that rect.
  - `mini` → animate host to the chosen corner at mini size, clearing the tab
    bar + orb (see Stacking).
  - `closed` → hidden (player kept warm briefly, then `destroy()` after flush).
- Renders branded chrome overlay: title, play/pause, expand, close, next,
  scrubber, drag handle (mini only).
- Owns the autoplay-next countdown (moved out of `VideoPlayer.jsx`) so it works
  in both modes; calls `store.next()`.
- Drag handling in mini mode → snap to nearest corner → `setCorner`.
- Drives progress: on the player's ~5s tick and on state changes, calls
  `recordProgress(youtube_id, t, d)` from the existing `videoProgress.js`.

**3. `app/src/components/video/VideoDockSlot.jsx`** (new)
A lightweight placeholder the Desk Videos section renders where the theater
should appear. Measures its bounding rect (ref + `ResizeObserver` + window
resize/scroll) and calls `registerDockSlot(rect)` while mounted; calls
`clearDockSlot()` on unmount. This is the **auto-shrink-on-navigate trigger** —
no direct router coupling. The global host positions the live player over this
slot, so on the Desk the user sees the full theater exactly where the slot is.

**4. Branded controls** — gold SVG icons via the existing `UIcon` set
(play, pause, x/close, expand/maximize, skip/next, drag-grip). **No generic
emoji** (standing brand rule).

### Data flow

1. Click a video card → `play(video, categoryList)` → `mode='docked'`. If on the
   Desk, the slot is mounted → host docks into its rect → player loads the video
   at `resumeSeconds(id)`.
2. Navigate away → slot unmounts → `clearDockSlot()` → auto `docked → mini`,
   animate to corner. Video keeps playing.
3. Manual minimize button (in the docked theater) → `mini` without leaving.
4. Tap the mini body / expand icon → `expand()` → navigate to
   `/desk?section=videos` → slot remounts → re-dock to `docked`.
5. Drag the mini → snaps to nearest corner → persisted.
6. Close (X) → flush progress write-behind queue → `mode='closed'`, hide.
7. Video ends → next-up countdown → `next()` advances within `context`, stopping
   at the end of the list.

### Coexistence & premium details

- **Audio exclusivity:** starting a video pauses any active read-aloud / Realtime
  voice audio (call into the voice store's halt path), and starting voice pauses
  the video — never two audio sources at once. Wired carefully and **mode-scoped**
  (mindful of the prior shared-audio orphan bug: a stray reset must not silently
  desync one player's audio from its UI).
- **Shared-element feel:** dock↔mini animates the host rectangle
  (translate/scale + opacity on chrome), not a hard cut.
- **Stacking / z-index:** mini at ~8500 — above the voice orb (8000), below the
  audio bar (9000). On mobile it docks above `MobileTabBar`
  (~58px + `env(safe-area-inset-bottom)`) and offset from the orb so nothing
  overlaps.

### Mobile (full parity)

- Size/position driven by **CSS media queries, not JS `useMediaQuery`**
  (first-paint staleness lesson). Compact 16:9 mini.
- Drag-snap corners constrained to safe zones (clear of tab bar + orb).
- Honor `env(safe-area-inset-bottom)`.

### Error handling

- YT API load failure and player `onError` → graceful fallback (retry / skip to
  next) without crashing the app.
- `close()` always flushes the progress write-behind queue.
- Create-once ref guard for StrictMode double-mount; idempotent player creation.

## Testing

- **Unit — `videoStore`:** mode transitions (`play → docked → mini → expand →
  docked → close`), `next()` advances within `context` and stops at the end,
  corner persistence (localStorage), `registerDockSlot`/`clearDockSlot` →
  auto-mini / re-dock.
- **Component — `VideoDockSlot`:** reports a rect on mount, calls `clearDockSlot`
  on unmount.
- **Component — `GlobalVideoLayer`:** renders mini chrome controls; drag snaps to
  the nearest corner; play/pause/close/expand call the right store actions.
- Existing education API + Videos section tests stay green.

## Files

**New**
- `app/src/components/video/videoStore.js`
- `app/src/components/video/GlobalVideoLayer.jsx`
- `app/src/components/video/GlobalVideoLayer.module.css`
- `app/src/components/video/VideoDockSlot.jsx`
- branded SVG icons (extend the existing `UIcon` set)

**Refactor**
- `app/src/App.jsx` — mount `<GlobalVideoLayer />` next to `GlobalVoiceLayer`
- `app/src/pages/desk/VideosSection.jsx` — open videos via `store.play()`; render
  `<VideoDockSlot />` for the theater instead of the Sheet/modal player
- `app/src/pages/desk/VideoPlayer.jsx` — player/autoplay-next logic moves into
  `GlobalVideoLayer`; trim or retire this file

**Unchanged**
- `app/src/pages/desk/videoProgress.js`
- `app/src/pages/desk/useYouTubeApi.js`
- `app/src/pages/desk/learningPaths.js`
- all backend (`api/routers/education.py`, `api/services/education_service.py`)

## Out of scope (YAGNI / follow-ups)

- Surfacing video cards on other surfaces (dashboard tile, ticker popups, research
  empty states) — a separate "discovery" initiative.
- Native OS Picture-in-Picture.
- Captions / playback-speed / theater keyboard-shortcut polish (can layer on later
  once the persistence foundation ships).
