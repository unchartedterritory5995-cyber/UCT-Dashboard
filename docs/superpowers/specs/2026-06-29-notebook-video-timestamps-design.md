# Notebook Video Timestamps — Design

**Date:** 2026-06-29
**Branch:** `feat/notebook-video-timestamps` (off `origin/master`)
**Status:** Design — pending user review

## Problem

When a user takes timestamped notes on a Desk video and clicks **"Save notes to Journal Notebook"**, the notes are exported into a J2 Notebook entry. Each note line becomes plain **bold `[MM:SS]` text**, and the source video is embedded as a bare, uncontrollable `youtube.com/embed` iframe.

The user wants to **click a timestamp in the saved Notebook note and have the video jump to that moment** (and, eventually, see a screenshot of that moment).

Today, click-to-jump only works *inside the Desk video panel* (`VideoDockSlot`), where note timestamps already call `videoStore.seekTo()`. Once exported to the Notebook, that capability is lost.

## Goals (Phase 1)

1. In a saved Notebook note, `[MM:SS]` markers are **clickable chips**.
2. Clicking a chip **scrolls the note's embedded video into view, seeks it to that second, and plays**.
3. Works for notes created going forward, and for notes already saved as plain bold text (backward-compat).
4. Graceful when the note has no video / the video was deleted (chips render inert).

## Non-Goals (Phase 1)

- Screenshots / frame stills at a timestamp — deferred to Phase 2 (see below).
- Driving the global floating/docked Desk player from the Notebook — the in-page hero is the target.
- Editing/adding new timestamps from inside the Notebook editor (timestamps originate from the Desk note-taking flow).

## Current State (origin/master)

| Piece | Location | Note |
|---|---|---|
| Video player + store | `app/src/components/video/{GlobalVideoLayer.jsx,videoStore.js}` | `videoStore.seekTo(sec)` / `getCurrentTime()` already exist |
| YouTube IFrame API loader | `app/src/pages/desk/useYouTubeApi.js` | loads `window.YT` |
| Video notes (capture + Desk-panel seek) | `app/src/components/video/VideoDockSlot.jsx`, `app/src/hooks/useVideoNotes.js` | timestamps clickable *in the Desk panel only* |
| `saveToNotebook()` export | `VideoDockSlot.jsx` ~L55 | emits paragraphs with bold `[MM:SS] ` text prefix; sets `heroImageUrl` = `youtube.com/watch?v={id}` |
| Notebook editor | `app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx` | renders bare YouTube `<iframe>` hero (~L298) when `heroImageUrl` is a YT URL; `parseYouTubeId()` helper at L13 |
| TipTap config | `app/src/pages/journal-2-0/lib/tiptap.js` | `buildExtensions()` |
| J2 note model | `api/services/journal_two/notes.py` | `bodyJson` (TipTap doc), `heroImageUrl`; no schema change needed |

**The gap:** exported `[MM:SS]` markers are inert bold text, and the hero iframe has no programmatic `seekTo`.

## Design — Phase 1

### Component 1: `videoTimestamp` TipTap node

New custom **inline, atomic, non-editable** TipTap node.

- **File:** `app/src/pages/journal-2-0/lib/videoTimestampNode.js`
- **Attrs:** `{ seconds: number }` (raw seconds — robust for >1hr videos; display is derived).
- **Render (`renderHTML` / nodeView):** a `<button>`/`<span>` chip styled gold (brand), showing `[MM:SS]` via the existing `fmtTime`/`fmtT` formatter. `contenteditable=false`, `atom: true`, `inline: true`, `selectable: true`.
- **Serialization:** `parseHTML` matches `data-video-ts` so round-trips survive save/load. `toDOM` emits `data-video-ts="{seconds}"`.
- **Click behavior:** on click, dispatch a DOM `CustomEvent('uct:video-seek', { detail: { seconds }, bubbles: true })` from the chip element. (Decouples the node from the player — no context threading through TipTap.)
- Added to `buildExtensions()` in `tiptap.js`.
- `extractPlainText()` in `tiptap.js` updated so the node contributes its `[MM:SS]` text to `bodyPlain` (keeps search/preview sane).

**What it does:** renders a stored second-offset as a clickable, formatted, non-editable chip and announces a seek request when clicked.
**Depends on:** TipTap core, the shared time formatter.

### Component 2: Seekable hero player

Replace the bare hero `<iframe>` in `NoteEditorPage.jsx` with a small YouTube IFrame-API-backed player.

- **File:** `app/src/pages/journal-2-0/components/notebook/NoteVideoHero.jsx` (extracted from the inline JSX).
- Uses `useYouTubeApi()` to get `window.YT`, instantiates `new YT.Player(mount, { videoId, playerVars: { rel:0, modestbranding:1, playsinline:1, enablejsapi:1 } })`.
- Listens for `uct:video-seek` on the editor container (or window): on event → `scrollIntoView({ behavior:'smooth', block:'nearest' })` on the hero, then `player.seekTo(detail.seconds, true)` + `player.playVideo()`.
- Keeps the existing "Watch on YouTube ↗" link.
- Cleans up the player + event listener on unmount.
- If `useYouTubeApi` fails to load (offline / blocked), falls back to the current bare iframe so the hero still shows the video (chips then become inert — see Component 4).

**What it does:** shows the source video and can jump to any second on request.
**Depends on:** `useYouTubeApi`, the `uct:video-seek` event contract.

### Component 3: `saveToNotebook` emits chips

In `VideoDockSlot.jsx` `saveToNotebook()`, replace the bold-text prefix with a `videoTimestamp` node:

```js
content: [
  { type: 'videoTimestamp', attrs: { seconds: n.t_seconds } },
  { type: 'text', text: ' ' + n.text },
]
```

`heroImageUrl` continues to carry the YouTube URL (unchanged) so the hero + chips know which video to drive.

**What it does:** exports notes with structured, clickable timestamps.
**Depends on:** the `videoTimestamp` node type existing in the editor schema.

### Component 4: Backward-compat + graceful degradation

- **Already-saved notes** (plain bold `[MM:SS]` text): on note load, if the note has a YouTube hero, run a pure transform over `bodyJson` that converts leading `[MM:SS]`/`[H:MM:SS]` bold-text runs into `videoTimestamp` nodes before handing the doc to the editor.
  - **File:** `app/src/pages/journal-2-0/lib/linkifyTimestamps.js` (pure function, unit-tested).
  - Only transforms when a YouTube hero is present; otherwise leaves the doc untouched.
- **No video / deleted video:** chips render but, with no hero player listening, the `uct:video-seek` event is a no-op. Chips get a subtle "inert" style when `heroImageUrl` has no parseable YouTube id.

**What it does:** old notes light up too; missing video never errors.
**Depends on:** the node type; `parseYouTubeId`.

### Data flow

```
Desk note-taking (t_seconds)
  → saveToNotebook(): bodyJson with videoTimestamp nodes + heroImageUrl
    → J2 note saved (no model change)
      → NoteEditorPage loads note
        → linkifyTimestamps() upgrades any legacy bold [MM:SS] (if YT hero)
        → editor renders videoTimestamp chips
        → NoteVideoHero mounts YT.Player from heroImageUrl
  user clicks chip → CustomEvent('uct:video-seek',{seconds})
    → NoteVideoHero: scrollIntoView + player.seekTo(seconds) + play
```

### Error handling

- YT API load failure → hero falls back to bare iframe; chips inert.
- Malformed `seconds` (NaN/negative) → node clamps to 0; never throws.
- Event fired with no listener (no hero) → no-op by design.
- Save path unchanged (autosave/retry in `NoteEditorPage` untouched).

### Testing

- `videoTimestampNode` — schema/serialization round-trip (`data-video-ts`), `extractPlainText` includes `[MM:SS]`.
- `linkifyTimestamps` — pure-function unit tests: converts legacy bold `[MM:SS]` only when YT hero present; leaves non-video docs untouched; handles `H:MM:SS`.
- `saveToNotebook` — emits `videoTimestamp` nodes (extend existing `VideoDockSlot.test.jsx`).
- `NoteVideoHero` — clicking a chip dispatches `uct:video-seek`; hero responds with `seekTo` (mock `YT.Player`).

## Phase 2 — Screenshots (deferred, user wants it)

A **true frame grab from the playing YouTube video is impossible client-side**: the player is a cross-origin iframe exposing only playback methods (no pixel/canvas access). Realistic paths, in priority order:

1. **Server-side ffmpeg frame grab for Live Session recordings.** The Zoom→YouTube auto-publish pipeline holds the source MP4 transiently. Capture (or, on demand, re-fetch) a still at each note's `t_seconds`, store it (Blob/poster table), and show it next to the chip. Accurate, our own asset. Scope: extend the recording pipeline + a small images store.
2. **YouTube storyboard frames** for general (non-Session) videos: the scrubber-hover preview sprite (`i.ytimg.com/sb/...`) gives an approximate still every few seconds — free, works for any video, but undocumented/fragile.
3. **Static thumbnail** (`hqdefault.jpg`) as a last-resort placeholder (same image regardless of timestamp — not really "the moment").

Phase 2 is out of scope for this implementation but recorded so the Phase 1 data (`seconds` per note + `heroImageUrl`) is already sufficient to attach stills later.

## Rollout

- Build on `feat/notebook-video-timestamps` off `origin/master`.
- No backend/schema change in Phase 1 (frontend-only: new TipTap node + hero player + export tweak + transform).
- Verify in-browser, then merge to master per the usual ship flow.
