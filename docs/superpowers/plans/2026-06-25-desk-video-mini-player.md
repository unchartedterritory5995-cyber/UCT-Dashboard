# Persistent Video Mini-Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Desk video keep playing seamlessly while the user navigates the rest of the app, via a single app-root player that docks into a Desk "theater" and floats as a draggable corner mini-player.

**Architecture:** One `YT.Player` instance is owned by a new `GlobalVideoLayer` mounted outside `<Routes>` in `App.jsx` (like `GlobalVoiceLayer`). A `useSyncExternalStore` store (`videoStore.js`) drives its mode — `docked` (theater over a slot on the Desk), `mini` (floating corner), or `closed`. The fixed host only ever *repositions* (animated top/left/width/height); the iframe never re-mounts, so playback never restarts.

**Tech Stack:** React 18 (`useSyncExternalStore`), YouTube IFrame Player API (existing `useYouTubeApi`), Vitest + React Testing Library, CSS Modules.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-25-desk-video-mini-player-design.md`.
- **Base branch:** branch off `origin/master` in an **isolated git worktree** (the shared main tree is used by a concurrent session — never `git add -A`, ship via fast-forward `push origin <branch>:master`).
- **No backend changes.** Reuse `videoProgress.js` (`recordProgress`, `markWatched`, `resumeSeconds`) and `/api/education/progress` exactly as-is.
- **Single player instance.** Never move/re-parent the iframe in the DOM (that reloads it). Reposition the fixed host only.
- **No generic emoji.** All controls use on-brand gold SVG icons (`#c9a84c` → `#e6cf86` gradient), matching `app/src/pages/education/icons.jsx`.
- **Mobile layout is CSS/`window`-driven, not `useMediaQuery`/`useIsTouch`** (those are stale at first paint in a fixed mobile context). Responsive sizing reads `window.innerWidth` directly (correct at first paint) and recomputes on `resize`.
- **Z-index:** mini host = `8500` (above voice orb `8000`, below audio bar `9000`).
- **Test command:** `cd app && npx vitest run <path>` (single file) / `cd app && npm test` (full FE suite). Build check: `cd app && npm run build`.

---

## File Structure

**New**
- `app/src/components/video/videoStore.js` — now-playing state + actions (pure, no React).
- `app/src/components/video/icons.jsx` — gold SVG controls (pause, close, minimize, expand, next, drag).
- `app/src/components/video/hostStyle.js` — `computeHostStyle()` pure positioning helper.
- `app/src/components/video/GlobalVideoLayer.jsx` — owns the `YT.Player`, renders the fixed host + controls + next-up card.
- `app/src/components/video/GlobalVideoLayer.module.css` — host/controls/mini styles + mobile media queries.
- `app/src/components/video/VideoDockSlot.jsx` — reserves the theater box on the Desk, reports its rect, renders description + Up-Next rail.
- `app/src/components/video/audioExclusivity.js` — pause other playing `<audio>` when a video starts.
- Test files alongside each (`*.test.js[x]`).

**Modify**
- `app/src/App.jsx` — mount `<GlobalVideoLayer />` next to `GlobalVoiceLayer`.
- `app/src/pages/desk/VideosSection.jsx` — open videos via the store; render `<VideoDockSlot />`; drop the `Sheet`-based `VideoPlayer`.

**Delete**
- `app/src/pages/desk/VideoPlayer.jsx` and `app/src/pages/desk/VideoPlayer.test.jsx` — its player/up-next logic moves into `GlobalVideoLayer`.

---

### Task 1: `videoStore.js` — now-playing state machine

**Files:**
- Create: `app/src/components/video/videoStore.js`
- Test: `app/src/components/video/videoStore.test.js`

**Interfaces:**
- Produces (all named exports):
  - `play(list, index = 0)` → void — start a session (`mode='docked'`).
  - `playIndex(i)` → void — jump to index `i` within the current list.
  - `next()` → boolean — advance one; `false` if already at the end.
  - `minimize()` / `expand()` / `close()` → void — mode transitions.
  - `setCorner(corner)` → void — `corner ∈ {'br','bl','tr','tl'}`, persisted.
  - `registerDockSlot(rect)` / `clearDockSlot()` → void — slot lifecycle.
  - `currentVideo()` → video object or `null`.
  - `subscribe(cb)` → unsubscribe fn; `getSnapshot()` → state object; `__reset()` → test helper.
  - Snapshot shape: `{ list, index, mode, corner, dockRect, playing }`, `mode ∈ {'closed','docked','mini'}`.

- [ ] **Step 1: Write the failing test**

```js
// app/src/components/video/videoStore.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import * as v from './videoStore'

const LIST = [
  { id: 1, youtube_id: 'aaaaaaaaaaa', title: 'First' },
  { id: 2, youtube_id: 'bbbbbbbbbbb', title: 'Second' },
  { id: 3, youtube_id: 'ccccccccccc', title: 'Third' },
]

beforeEach(() => v.__reset())

describe('videoStore', () => {
  it('starts closed with empty list', () => {
    expect(v.getSnapshot().mode).toBe('closed')
    expect(v.currentVideo()).toBeNull()
  })

  it('play() opens docked at the given index', () => {
    v.play(LIST, 1)
    const s = v.getSnapshot()
    expect(s.mode).toBe('docked')
    expect(s.index).toBe(1)
    expect(v.currentVideo().youtube_id).toBe('bbbbbbbbbbb')
  })

  it('next() advances and stops at the end', () => {
    v.play(LIST, 1)
    expect(v.next()).toBe(true)
    expect(v.getSnapshot().index).toBe(2)
    expect(v.next()).toBe(false)
    expect(v.getSnapshot().index).toBe(2)
  })

  it('minimize/expand toggle docked<->mini', () => {
    v.play(LIST, 0)
    v.minimize()
    expect(v.getSnapshot().mode).toBe('mini')
    v.expand()
    expect(v.getSnapshot().mode).toBe('docked')
  })

  it('clearDockSlot auto-minimizes; registerDockSlot re-docks', () => {
    v.play(LIST, 0)
    v.clearDockSlot()
    expect(v.getSnapshot().mode).toBe('mini')
    v.registerDockSlot({ top: 0, left: 0, width: 640, height: 360 })
    const s = v.getSnapshot()
    expect(s.mode).toBe('docked')
    expect(s.dockRect.width).toBe(640)
  })

  it('close() resets to closed/empty', () => {
    v.play(LIST, 2)
    v.close()
    const s = v.getSnapshot()
    expect(s.mode).toBe('closed')
    expect(s.list).toEqual([])
    expect(v.currentVideo()).toBeNull()
  })

  it('setCorner persists to localStorage and notifies subscribers', () => {
    let hits = 0
    const unsub = v.subscribe(() => { hits += 1 })
    v.setCorner('tl')
    expect(v.getSnapshot().corner).toBe('tl')
    expect(localStorage.getItem('desk_video_corner')).toBe('tl')
    expect(hits).toBeGreaterThan(0)
    unsub()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/components/video/videoStore.test.js`
Expected: FAIL — `Failed to resolve import './videoStore'`.

- [ ] **Step 3: Write minimal implementation**

```js
// app/src/components/video/videoStore.js
// Global "now playing" state for the persistent Desk video player. Mirrors the
// useSyncExternalStore pattern of pages/desk/videoProgress.js: module-level
// state + a listener set + getSnapshot. Drives GlobalVideoLayer's mode:
//   closed → no video | docked → theater over the Desk slot | mini → floating
const CORNER_KEY = 'desk_video_corner'
const CORNERS = ['br', 'bl', 'tr', 'tl']

function readCorner() {
  try {
    const c = localStorage.getItem(CORNER_KEY)
    return CORNERS.includes(c) ? c : 'br'
  } catch {
    return 'br'
  }
}

let state = {
  list: [],
  index: 0,
  mode: 'closed', // 'closed' | 'docked' | 'mini'
  corner: readCorner(),
  dockRect: null, // { top, left, width, height } of the Desk slot, or null
  playing: false,
}
const listeners = new Set()

function set(patch) {
  state = { ...state, ...patch }
  listeners.forEach((cb) => cb())
}

// ── Actions ───────────────────────────────────────────────────────────────
export function play(list, index = 0) {
  if (!Array.isArray(list) || !list.length) return
  const i = Math.max(0, Math.min(index, list.length - 1))
  set({ list, index: i, mode: 'docked', playing: true })
}

export function playIndex(i) {
  if (i < 0 || i >= state.list.length) return
  set({ index: i })
}

export function next() {
  if (state.index + 1 >= state.list.length) return false
  set({ index: state.index + 1 })
  return true
}

export function minimize() {
  if (state.mode === 'docked') set({ mode: 'mini' })
}

export function expand() {
  if (state.mode === 'mini') set({ mode: 'docked' })
}

export function close() {
  set({ list: [], index: 0, mode: 'closed', dockRect: null, playing: false })
}

export function setCorner(corner) {
  if (!CORNERS.includes(corner)) return
  try { localStorage.setItem(CORNER_KEY, corner) } catch { /* ignore */ }
  set({ corner })
}

export function setPlaying(b) {
  set({ playing: !!b })
}

// The Desk theater slot mounted → record its rect and (re)dock there.
export function registerDockSlot(rect) {
  const patch = { dockRect: rect }
  if (state.mode === 'mini') patch.mode = 'docked'
  set(patch)
}

// The slot unmounted (user navigated away) → float as mini.
export function clearDockSlot() {
  const patch = { dockRect: null }
  if (state.mode === 'docked') patch.mode = 'mini'
  set(patch)
}

// ── Reads / subscription ──────────────────────────────────────────────────
export function currentVideo() {
  return state.mode !== 'closed' && state.list.length ? state.list[state.index] : null
}

export function subscribe(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function getSnapshot() {
  return state
}

export function __reset() {
  state = { list: [], index: 0, mode: 'closed', corner: readCorner(), dockRect: null, playing: false }
  listeners.clear()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/components/video/videoStore.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/components/video/videoStore.js app/src/components/video/videoStore.test.js
git commit -m "feat(video): now-playing store for persistent Desk player"
```

---

### Task 2: `hostStyle.js` — positioning helper

**Files:**
- Create: `app/src/components/video/hostStyle.js`
- Test: `app/src/components/video/hostStyle.test.js`

**Interfaces:**
- Consumes: store snapshot fields (`mode`, `corner`, `dockRect`).
- Produces: `computeHostStyle(mode, corner, dockRect, vw, vh)` → `{ top, left, width, height }` (all px numbers). Docked uses the slot rect; mini/docked-without-rect computes a corner rect from the viewport so transitions animate the same four properties.

- [ ] **Step 1: Write the failing test**

```js
// app/src/components/video/hostStyle.test.js
import { describe, it, expect } from 'vitest'
import { computeHostStyle, MINI } from './hostStyle'

describe('computeHostStyle', () => {
  it('docked fills the slot rect exactly', () => {
    const r = { top: 100, left: 50, width: 640, height: 360 }
    expect(computeHostStyle('docked', 'br', r, 1280, 800)).toEqual(r)
  })

  it('mini bottom-right sits inside the desktop viewport with margins', () => {
    const s = computeHostStyle('mini', 'br', null, 1280, 800)
    expect(s.width).toBe(MINI.desktopW)
    expect(s.height).toBe(Math.round((MINI.desktopW * 9) / 16))
    expect(s.left).toBe(1280 - MINI.desktopW - MINI.desktopMargin)
    expect(s.top).toBe(800 - s.height - MINI.desktopMargin)
  })

  it('mini top-left anchors to the top-left margin', () => {
    const s = computeHostStyle('mini', 'tl', null, 1280, 800)
    expect(s.left).toBe(MINI.desktopMargin)
    expect(s.top).toBe(MINI.desktopMargin)
  })

  it('mobile widths shrink the mini and clear the bottom tab bar', () => {
    const s = computeHostStyle('mini', 'br', null, 380, 700)
    expect(s.width).toBeLessThanOrEqual(MINI.mobileMaxW)
    // bottom clearance must leave room for the tab bar + orb
    expect(s.top + s.height).toBeLessThanOrEqual(700 - MINI.mobileBottomClear)
  })

  it('docked without a rect falls back to the mini corner (no flash)', () => {
    const s = computeHostStyle('docked', 'br', null, 1280, 800)
    expect(s.width).toBe(MINI.desktopW)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/components/video/hostStyle.test.js`
Expected: FAIL — `Failed to resolve import './hostStyle'`.

- [ ] **Step 3: Write minimal implementation**

```js
// app/src/components/video/hostStyle.js
// Pure positioning math for the fixed video host. Both modes return
// {top,left,width,height} so the CSS transition animates the same four props
// for a smooth dock<->mini shrink/grow. Responsive sizing reads the passed-in
// viewport (caller uses window.innerWidth/Height, correct at first paint — we
// deliberately avoid useMediaQuery, which is stale at first paint).
export const MINI = {
  desktopW: 360,
  desktopMargin: 18,
  mobileMaxW: 220,
  mobileMargin: 12,
  mobileBottomClear: 80, // ~58px tab bar + safe-area + gap, also clears the orb
  breakpoint: 640,
}

function miniRect(corner, vw, vh) {
  const mobile = vw < MINI.breakpoint
  const w = mobile ? Math.min(MINI.mobileMaxW, vw - 2 * MINI.mobileMargin) : MINI.desktopW
  const h = Math.round((w * 9) / 16)
  const sideMargin = mobile ? MINI.mobileMargin : MINI.desktopMargin
  const topMargin = mobile ? MINI.mobileMargin : MINI.desktopMargin
  const bottomMargin = mobile ? MINI.mobileBottomClear : MINI.desktopMargin
  const left = corner.includes('l') ? sideMargin : vw - w - sideMargin
  const top = corner.includes('t') ? topMargin : vh - h - bottomMargin
  return { top, left, width: w, height: h }
}

export function computeHostStyle(mode, corner, dockRect, vw, vh) {
  if (mode === 'docked' && dockRect) {
    return {
      top: dockRect.top,
      left: dockRect.left,
      width: dockRect.width,
      height: dockRect.height,
    }
  }
  return miniRect(corner, vw, vh)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/components/video/hostStyle.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/components/video/hostStyle.js app/src/components/video/hostStyle.test.js
git commit -m "feat(video): host positioning helper (dock<->mini rects)"
```

---

### Task 3: `icons.jsx` — gold control icons

**Files:**
- Create: `app/src/components/video/icons.jsx`
- Test: `app/src/components/video/icons.test.jsx`

**Interfaces:**
- Produces: `PauseIcon`, `CloseIcon`, `MinimizeIcon`, `ExpandIcon`, `NextIcon`, `DragIcon` — each `({ size }) => <svg>`. (`PlayIcon` is reused from `pages/education/icons.jsx`.)

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/components/video/icons.test.jsx
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PauseIcon, CloseIcon, MinimizeIcon, ExpandIcon, NextIcon, DragIcon } from './icons'

describe('video icons', () => {
  it('every control icon renders an <svg> at the requested size', () => {
    for (const Icon of [PauseIcon, CloseIcon, MinimizeIcon, ExpandIcon, NextIcon, DragIcon]) {
      const { container } = render(<Icon size={20} />)
      const svg = container.querySelector('svg')
      expect(svg).toBeTruthy()
      expect(svg.getAttribute('width')).toBe('20')
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/components/video/icons.test.jsx`
Expected: FAIL — `Failed to resolve import './icons'`.

- [ ] **Step 3: Write minimal implementation**

```jsx
// app/src/components/video/icons.jsx
// On-brand gold SVG controls for the persistent video player. Matches the
// gradient + stroke language of pages/education/icons.jsx. No generic emoji.
const GOLD = '#c9a84c'
const GOLD_BRIGHT = '#e6cf86'

function Defs({ id }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor={GOLD_BRIGHT} />
        <stop offset="100%" stopColor={GOLD} />
      </linearGradient>
    </defs>
  )
}

export function PauseIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
      <Defs id="vid-pause" />
      <rect x="6.5" y="5" width="3.4" height="14" rx="1" fill="url(#vid-pause)" />
      <rect x="14.1" y="5" width="3.4" height="14" rx="1" fill="url(#vid-pause)" />
    </svg>
  )
}

export function CloseIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
      <Defs id="vid-close" />
      <path d="M6 6l12 12M18 6L6 18" stroke="url(#vid-close)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function MinimizeIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
      <Defs id="vid-min" />
      {/* arrows collapsing inward to a corner */}
      <path d="M10 4v6H4M14 20v-6h6" stroke="url(#vid-min)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ExpandIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
      <Defs id="vid-exp" />
      <path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5" stroke="url(#vid-exp)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function NextIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
      <Defs id="vid-next" />
      <path d="M6 5l9 7-9 7z" fill="url(#vid-next)" />
      <rect x="16.5" y="5" width="2.4" height="14" rx="1" fill="url(#vid-next)" />
    </svg>
  )
}

export function DragIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
      <g fill={GOLD}>
        <circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" />
        <circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" />
        <circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" />
      </g>
    </svg>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/components/video/icons.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/video/icons.jsx app/src/components/video/icons.test.jsx
git commit -m "feat(video): on-brand gold control icons"
```

---

### Task 4: `GlobalVideoLayer.jsx` — the single persistent player

**Files:**
- Create: `app/src/components/video/GlobalVideoLayer.jsx`, `app/src/components/video/GlobalVideoLayer.module.css`
- Test: `app/src/components/video/GlobalVideoLayer.test.jsx`
- Modify: `app/src/App.jsx`

**Interfaces:**
- Consumes: `videoStore` (`subscribe`, `getSnapshot`, `next`, `minimize`, `close`, `setPlaying`), `hostStyle.computeHostStyle`, `useYouTubeApi`, `videoProgress` (`recordProgress`, `markWatched`, `resumeSeconds`), icons.
- Produces: default-exported `<GlobalVideoLayer />`. Renders `null` when `mode === 'closed'`.

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/components/video/GlobalVideoLayer.test.jsx
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import GlobalVideoLayer from './GlobalVideoLayer'
import * as store from './videoStore'

vi.mock('../../pages/desk/useYouTubeApi', () => ({ useYouTubeApi: () => true }))

let lastPlayer, lastOnStateChange
beforeEach(() => {
  store.__reset()
  lastPlayer = null
  lastOnStateChange = null
  window.YT = {
    Player: class {
      constructor(mount, opts) {
        lastOnStateChange = opts.events?.onStateChange
        this.loadVideoById = vi.fn()
        this.pauseVideo = vi.fn()
        this.playVideo = vi.fn()
        this.destroy = vi.fn()
        this.getCurrentTime = () => 0
        this.getDuration = () => 0
        lastPlayer = this
      }
    },
  }
})

const LIST = [
  { id: 1, youtube_id: 'aaaaaaaaaaa', title: 'First Video' },
  { id: 2, youtube_id: 'bbbbbbbbbbb', title: 'Second Video' },
]

const renderLayer = () =>
  render(<MemoryRouter><GlobalVideoLayer /></MemoryRouter>)

describe('GlobalVideoLayer', () => {
  it('renders nothing while closed', () => {
    const { container } = renderLayer()
    expect(container.firstChild).toBeNull()
  })

  it('builds the player and shows the title when a video plays', () => {
    renderLayer()
    act(() => store.play(LIST, 0))
    expect(lastPlayer).toBeTruthy()
    expect(screen.getByText('First Video')).toBeInTheDocument()
  })

  it('shows a Next up card when the video ends and advances on Play now', () => {
    renderLayer()
    act(() => store.play(LIST, 0))
    act(() => lastOnStateChange({ data: 0 })) // ENDED
    expect(screen.getByText('Next up')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Play now'))
    expect(store.getSnapshot().index).toBe(1)
    expect(lastPlayer.loadVideoById).toHaveBeenCalledWith({ videoId: 'bbbbbbbbbbb', startSeconds: 0 })
  })

  it('Close button tears the player down and closes the store', () => {
    renderLayer()
    act(() => store.play(LIST, 0))
    fireEvent.click(screen.getByLabelText('Close player'))
    expect(store.getSnapshot().mode).toBe('closed')
    expect(lastPlayer.destroy).toHaveBeenCalled()
  })

  it('Minimize switches the store to mini mode', () => {
    renderLayer()
    act(() => store.play(LIST, 0))
    fireEvent.click(screen.getByLabelText('Minimize'))
    expect(store.getSnapshot().mode).toBe('mini')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/components/video/GlobalVideoLayer.test.jsx`
Expected: FAIL — `Failed to resolve import './GlobalVideoLayer'`.

- [ ] **Step 3: Write the CSS module**

```css
/* app/src/components/video/GlobalVideoLayer.module.css */
.host {
  position: fixed;
  z-index: 8500;
  background: #000;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.55);
  transition: top 0.32s cubic-bezier(0.22, 1, 0.36, 1),
    left 0.32s cubic-bezier(0.22, 1, 0.36, 1),
    width 0.32s cubic-bezier(0.22, 1, 0.36, 1),
    height 0.32s cubic-bezier(0.22, 1, 0.36, 1);
}
.docked {
  border-radius: 12px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
}
.mini {
  border: 1px solid rgba(201, 168, 76, 0.35);
}
.frame {
  position: absolute;
  inset: 0;
}
.frame :global(iframe) {
  width: 100%;
  height: 100%;
}
.loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #a8a290;
  font-size: 13px;
}
.controls {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.78), rgba(0, 0, 0, 0));
  opacity: 0;
  transition: opacity 0.18s ease;
}
.host:hover .controls,
.mini .controls {
  opacity: 1;
}
.ctitle {
  flex: 1;
  min-width: 0;
  color: #f3efe2;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  min-width: 30px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 6px;
}
.cbtn:hover {
  background: rgba(255, 255, 255, 0.12);
}
.nextCard {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(8, 9, 8, 0.92);
  color: #f3efe2;
  text-align: center;
  padding: 12px;
}
.nextLabel {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #c9a84c;
}
.nextTitle {
  font-size: 14px;
  font-weight: 600;
  max-width: 90%;
}
.nextPlayBtn,
.nextCancelBtn {
  border: 1px solid rgba(201, 168, 76, 0.5);
  background: transparent;
  color: #f3efe2;
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
}
.nextPlayBtn {
  background: rgba(201, 168, 76, 0.18);
}
.dragHandle {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 26px;
  display: none;
  align-items: center;
  justify-content: center;
  cursor: grab;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0));
  opacity: 0;
  transition: opacity 0.18s ease;
}
.mini .dragHandle {
  display: flex;
}
.mini:hover .dragHandle {
  opacity: 1;
}

/* Mobile: a touch smaller, controls always visible for tappability. */
@media (max-width: 640px) {
  .mini .controls {
    opacity: 1;
  }
  .host {
    border-radius: 8px;
  }
}
```

- [ ] **Step 4: Write the component**

```jsx
// app/src/components/video/GlobalVideoLayer.jsx
// The single, app-root-level video player. Mounted once (outside <Routes>),
// it owns one YT.Player and only ever REPOSITIONS its fixed host between the
// Desk theater slot (docked) and a floating corner (mini) — the iframe never
// re-mounts, so playback never restarts across navigation.
import { useEffect, useRef, useState, useCallback, useSyncExternalStore } from 'react'
import { useYouTubeApi } from '../../pages/desk/useYouTubeApi'
import { recordProgress, markWatched, resumeSeconds } from '../../pages/desk/videoProgress'
import { subscribe, getSnapshot, next as storeNext, minimize, close as storeClose } from './videoStore'
import { computeHostStyle } from './hostStyle'
import { PlayIcon } from '../../pages/education/icons'
import { PauseIcon, CloseIcon, MinimizeIcon, NextIcon } from './icons'
import styles from './GlobalVideoLayer.module.css'

const NEXT_COUNTDOWN = 6

function useViewport() {
  const [vp, setVp] = useState(() => ({
    vw: typeof window !== 'undefined' ? window.innerWidth : 1280,
    vh: typeof window !== 'undefined' ? window.innerHeight : 800,
  }))
  useEffect(() => {
    const onResize = () => setVp({ vw: window.innerWidth, vh: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return vp
}

export default function GlobalVideoLayer() {
  const apiReady = useYouTubeApi()
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const { vw, vh } = useViewport()
  const { list, index, mode, corner, dockRect } = snap
  const active = mode !== 'closed' && list.length > 0
  const current = active ? list[index] : null
  const upNext = active && index + 1 < list.length ? list[index + 1] : null

  const hostRef = useRef(null)
  const playerRef = useRef(null)
  const tickerRef = useRef(null)
  const curIdRef = useRef(null)
  const [ended, setEnded] = useState(false)
  const [countdown, setCountdown] = useState(NEXT_COUNTDOWN)
  const [isPlaying, setIsPlaying] = useState(true)

  const saveNow = useCallback(() => {
    const p = playerRef.current
    if (!p || !p.getCurrentTime || !p.getDuration) return
    try {
      const t = p.getCurrentTime()
      const d = p.getDuration()
      if (d > 0) recordProgress(curIdRef.current, t, d)
    } catch { /* ignore */ }
  }, [])

  // Build the player once, when a video first becomes active.
  useEffect(() => {
    if (!apiReady || !active || playerRef.current || !hostRef.current) return
    const startId = list[index].youtube_id
    curIdRef.current = startId
    const mount = document.createElement('div')
    hostRef.current.appendChild(mount)
    const player = new window.YT.Player(mount, {
      videoId: startId,
      playerVars: {
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        autoplay: 1,
        start: resumeSeconds(startId) || undefined,
      },
      events: {
        onStateChange: (e) => {
          if (e.data === 0) {
            markWatched(curIdRef.current)
            setEnded(true)
            setIsPlaying(false)
          } else if (e.data === 1) {
            saveNow()
            setIsPlaying(true)
            setEnded(false)
          } else if (e.data === 2) {
            setIsPlaying(false)
          }
        },
      },
    })
    playerRef.current = player
    tickerRef.current = setInterval(saveNow, 5000)
  }, [apiReady, active, list, index, saveNow])

  // Switch the video in-place when the index/list changes after build.
  useEffect(() => {
    const p = playerRef.current
    if (!p || !active || !p.loadVideoById) return
    const id = list[index].youtube_id
    if (id === curIdRef.current) return
    saveNow()
    setEnded(false)
    curIdRef.current = id
    p.loadVideoById({ videoId: id, startSeconds: resumeSeconds(id) })
  }, [list, index, active, saveNow])

  // Tear down when the session closes.
  useEffect(() => {
    if (active) return
    const p = playerRef.current
    if (!p) return
    saveNow()
    try { clearInterval(tickerRef.current) } catch { /* ignore */ }
    try { p.destroy() } catch { /* ignore */ }
    playerRef.current = null
    curIdRef.current = null
  }, [active, saveNow])

  // Flush + destroy on unmount (full app teardown only — never during routing).
  useEffect(() => () => {
    const p = playerRef.current
    if (!p) return
    saveNow()
    try { clearInterval(tickerRef.current) } catch { /* ignore */ }
    try { p.destroy() } catch { /* ignore */ }
  }, [saveNow])

  // Auto-advance countdown when a video ends and another follows.
  useEffect(() => {
    if (!ended || !upNext) return
    setCountdown(NEXT_COUNTDOWN)
    const id = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { clearInterval(id); storeNext(); return 0 }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [ended, upNext])

  if (!active) return null

  const hostStyle = computeHostStyle(mode, corner, dockRect, vw, vh)
  const togglePlay = () => {
    const p = playerRef.current
    if (!p) return
    try { (isPlaying ? p.pauseVideo : p.playVideo).call(p) } catch { /* ignore */ }
  }

  return (
    <div
      className={`${styles.host} ${mode === 'mini' ? styles.mini : styles.docked}`}
      style={hostStyle}
      data-mode={mode}
    >
      <div ref={hostRef} className={styles.frame} />
      {!apiReady && <div className={styles.loading}>Loading…</div>}

      <div className={styles.controls}>
        <span className={styles.ctitle}>{current.title}</span>
        <button className={styles.cbtn} onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying ? <PauseIcon /> : <PlayIcon size={18} />}
        </button>
        {upNext && (
          <button className={styles.cbtn} onClick={() => storeNext()} aria-label="Next video">
            <NextIcon />
          </button>
        )}
        {mode === 'docked' && (
          <button className={styles.cbtn} onClick={() => minimize()} aria-label="Minimize">
            <MinimizeIcon />
          </button>
        )}
        <button className={styles.cbtn} onClick={() => storeClose()} aria-label="Close player">
          <CloseIcon />
        </button>
      </div>

      {ended && upNext && (
        <div className={styles.nextCard} role="dialog" aria-label="Next up">
          <div className={styles.nextLabel}>Next up</div>
          <div className={styles.nextTitle}>{upNext.title}</div>
          <button className={styles.nextPlayBtn} onClick={() => storeNext()}>Play now</button>
          <button className={styles.nextCancelBtn} onClick={() => setEnded(false)}>Cancel ({countdown})</button>
        </div>
      )}
      {ended && !upNext && (
        <div className={styles.nextCard}>
          <div className={styles.nextLabel}>End of this section</div>
          <button className={styles.nextPlayBtn} onClick={() => storeClose()}>Close</button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Mount it in `App.jsx`**

Add the import near the other lazy/global imports at the top of `app/src/App.jsx`:

```jsx
import GlobalVideoLayer from './components/video/GlobalVideoLayer'
```

Then render it next to the other global layers. Find the `<GlobalAddPositionProvider />` block inside `<VoiceProvider>` and add the layer right after it:

```jsx
        <Suspense fallback={null}>
          <GlobalAddPositionProvider />
        </Suspense>
        {/* Persistent Desk video player — one instance, survives all routing. */}
        <GlobalVideoLayer />
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd app && npx vitest run src/components/video/GlobalVideoLayer.test.jsx`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add app/src/components/video/GlobalVideoLayer.jsx app/src/components/video/GlobalVideoLayer.module.css app/src/components/video/GlobalVideoLayer.test.jsx app/src/App.jsx
git commit -m "feat(video): app-root persistent player (GlobalVideoLayer)"
```

---

### Task 5: `VideoDockSlot.jsx` + rewire `VideosSection`, delete `VideoPlayer`

**Files:**
- Create: `app/src/components/video/VideoDockSlot.jsx`
- Test: `app/src/components/video/VideoDockSlot.test.jsx`
- Modify: `app/src/pages/desk/VideosSection.jsx`
- Delete: `app/src/pages/desk/VideoPlayer.jsx`, `app/src/pages/desk/VideoPlayer.test.jsx`

**Interfaces:**
- Consumes: `videoStore` (`subscribe`, `getSnapshot`, `registerDockSlot`, `clearDockSlot`, `playIndex`).
- Produces: default-exported `<VideoDockSlot />`. While a video is active it (a) reserves a 16:9 box and reports its rect via `registerDockSlot` on mount / resize / scroll, calling `clearDockSlot` on unmount, and (b) renders the current title/description + an Up-Next rail below the reserved box.

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/components/video/VideoDockSlot.test.jsx
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import VideoDockSlot from './VideoDockSlot'
import * as store from './videoStore'

beforeEach(() => store.__reset())

const LIST = [
  { id: 1, youtube_id: 'aaaaaaaaaaa', title: 'First Video' },
  { id: 2, youtube_id: 'bbbbbbbbbbb', title: 'Second Video' },
]

describe('VideoDockSlot', () => {
  it('renders nothing when no video is active', () => {
    const { container } = render(<VideoDockSlot />)
    expect(container.firstChild).toBeNull()
  })

  it('registers a dock rect on mount and re-docks the store', () => {
    act(() => store.play(LIST, 0))
    act(() => { store.clearDockSlot() }) // simulate having been minimized
    expect(store.getSnapshot().mode).toBe('mini')
    render(<VideoDockSlot />)
    expect(store.getSnapshot().mode).toBe('docked')
    expect(store.getSnapshot().dockRect).not.toBeNull()
  })

  it('clears the dock rect (auto-mini) on unmount', () => {
    act(() => store.play(LIST, 0))
    const { unmount } = render(<VideoDockSlot />)
    act(() => unmount())
    expect(store.getSnapshot().mode).toBe('mini')
    expect(store.getSnapshot().dockRect).toBeNull()
  })

  it('Up-Next rail jumps to the clicked video', () => {
    act(() => store.play(LIST, 0))
    render(<VideoDockSlot />)
    fireEvent.click(screen.getByText('Second Video'))
    expect(store.getSnapshot().index).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/components/video/VideoDockSlot.test.jsx`
Expected: FAIL — `Failed to resolve import './VideoDockSlot'`.

- [ ] **Step 3: Write the component**

```jsx
// app/src/components/video/VideoDockSlot.jsx
// Placeholder the Desk Videos section renders where the "theater" lives. It
// reserves a 16:9 box (the GlobalVideoLayer host overlays it) and reports that
// box's rect to the store; on unmount (the user navigated away) it clears the
// slot, which flips the store to the floating mini. Also renders the rich
// browsing chrome — current title/description + Up-Next rail — that only makes
// sense on the Desk.
import { useEffect, useRef, useSyncExternalStore, useCallback } from 'react'
import { subscribe, getSnapshot, registerDockSlot, clearDockSlot, playIndex } from './videoStore'
import styles from './VideoDockSlot.module.css'

const thumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

export default function VideoDockSlot() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const { list, index, mode } = snap
  const active = mode !== 'closed' && list.length > 0
  const boxRef = useRef(null)

  const report = useCallback(() => {
    const el = boxRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    registerDockSlot({ top: r.top, left: r.left, width: r.width, height: r.height })
  }, [])

  useEffect(() => {
    if (!active) return
    report()
    const onScrollOrResize = () => report()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(report) : null
    if (ro && boxRef.current) ro.observe(boxRef.current)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
      if (ro) ro.disconnect()
      clearDockSlot()
    }
  }, [active, report])

  if (!active) return null

  const current = list[index]
  const upcoming = list.slice(index + 1)

  return (
    <div className={styles.theater}>
      {/* Reserved 16:9 box the fixed player host positions itself over. */}
      <div ref={boxRef} className={styles.dockBox} aria-label={`Now playing: ${current.title}`} />
      <div className={styles.meta}>
        <div className={styles.title}>{current.title}</div>
        {current.description && <p className={styles.desc}>{current.description}</p>}
      </div>
      {upcoming.length > 0 && (
        <div className={styles.upNext}>
          <div className={styles.upNextHead}>Up next in this section</div>
          <div className={styles.upNextRail}>
            {upcoming.map((v, i) => (
              <button
                key={v.id ?? v.youtube_id}
                className={styles.upNextItem}
                onClick={() => playIndex(index + 1 + i)}
              >
                <span className={styles.upNextThumbWrap}>
                  <img className={styles.upNextThumb} src={thumb(v.youtube_id)} alt="" loading="lazy" />
                </span>
                <span className={styles.upNextTitle}>{v.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Write the slot CSS**

```css
/* app/src/components/video/VideoDockSlot.module.css */
.theater {
  margin: 0 0 18px;
}
.dockBox {
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
  border-radius: 12px;
}
.meta {
  margin-top: 10px;
}
.title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary, #f3efe2);
}
.desc {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-secondary, #a8a290);
}
.upNext {
  margin-top: 14px;
}
.upNextHead {
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-secondary, #a8a290);
  margin-bottom: 8px;
}
.upNextRail {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.upNextItem {
  flex: 0 0 auto;
  width: 150px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  padding: 0;
}
.upNextThumbWrap {
  display: block;
  width: 150px;
  aspect-ratio: 16 / 9;
  border-radius: 8px;
  overflow: hidden;
}
.upNextThumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.upNextTitle {
  display: block;
  margin-top: 5px;
  font-size: 12px;
  color: var(--text-primary, #f3efe2);
  line-height: 1.3;
}
```

- [ ] **Step 5: Rewire `VideosSection.jsx`**

In `app/src/pages/desk/VideosSection.jsx`:

Replace the `VideoPlayer` import line:

```jsx
import VideoPlayer from './VideoPlayer'
```

with:

```jsx
import VideoDockSlot from '../../components/video/VideoDockSlot'
import { play as playVideo } from '../../components/video/videoStore'
```

Remove the `playing` state line:

```jsx
  const [playing, setPlaying] = useState(null)
```

Replace every `onClick={() => setPlaying({ list: X, index: Y })}` call site with a `playVideo(X, Y)` call. There are four:

- Learning paths: `onClick={() => setPlaying({ list: p.videos, index: 0 })}` → `onClick={() => playVideo(p.videos, 0)}`
- Continue watching: `onClick={() => setPlaying({ list: cw.list, index: cw.index })}` → `onClick={() => playVideo(cw.list, cw.index)}`
- Library card: `onClick={() => setPlaying({ list: cat.videos, index: vi })}` → `onClick={() => playVideo(cat.videos, vi)}`

Render the dock slot at the top of the returned tree. Immediately after the opening `<div className={styles.page}>` add:

```jsx
      <VideoDockSlot />
```

Delete the old player render block near the bottom:

```jsx
      {playing && (
        <VideoPlayer
          list={playing.list}
          startIndex={playing.index}
          onClose={() => setPlaying(null)}
        />
      )}
```

- [ ] **Step 6: Delete the obsolete player**

```bash
git rm app/src/pages/desk/VideoPlayer.jsx app/src/pages/desk/VideoPlayer.test.jsx
```

- [ ] **Step 7: Run tests + build to verify**

Run: `cd app && npx vitest run src/components/video/VideoDockSlot.test.jsx src/pages/desk/`
Expected: PASS — dock slot tests green; remaining desk tests (Desk, TeamSection, learningPaths, videoProgress) still green; no reference to the deleted `VideoPlayer`.

Run: `cd app && npm run build`
Expected: build succeeds (no missing-import errors from the `VideoPlayer` removal).

- [ ] **Step 8: Commit**

```bash
git add app/src/components/video/VideoDockSlot.jsx app/src/components/video/VideoDockSlot.module.css app/src/components/video/VideoDockSlot.test.jsx app/src/pages/desk/VideosSection.jsx
git commit -m "feat(video): Desk theater dock slot; route Videos through the store"
```

---

### Task 6: Mini-player polish — drag-to-corner + expand-to-Desk

**Files:**
- Modify: `app/src/components/video/GlobalVideoLayer.jsx`, `app/src/components/video/GlobalVideoLayer.module.css`
- Test: `app/src/components/video/GlobalVideoLayer.test.jsx` (add cases)

**Interfaces:**
- Consumes additionally: `videoStore` (`expand`, `setCorner`), `react-router-dom` `useNavigate`, `icons.ExpandIcon`, `icons.DragIcon`.
- Produces: in `mini` mode the host shows a drag handle (snaps to the nearest of the four corners on drop, persisting via `setCorner`) and an Expand button that navigates to `/desk?section=videos` and calls `expand()`.

- [ ] **Step 1: Write the failing tests**

Add a top-level import to `GlobalVideoLayer.test.jsx` (alongside the existing imports):

```jsx
import { nearestCorner } from './hostStyle'
```

Then append these cases to the existing `describe('GlobalVideoLayer', ...)` block:

```jsx
  it('Expand button navigates to the Desk and re-docks', () => {
    renderLayer()
    act(() => store.play(LIST, 0))
    act(() => store.minimize())
    fireEvent.click(screen.getByLabelText('Expand to Desk'))
    expect(store.getSnapshot().mode).toBe('docked')
  })

  it('nearest-corner snap maps a drop point to a corner', () => {
    expect(nearestCorner(10, 10, 1000, 800)).toBe('tl')
    expect(nearestCorner(990, 790, 1000, 800)).toBe('br')
    expect(nearestCorner(10, 790, 1000, 800)).toBe('bl')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/components/video/GlobalVideoLayer.test.jsx`
Expected: FAIL — `getByLabelText('Expand to Desk')` not found and `nearestCorner` is not a function.

- [ ] **Step 3: Add `nearestCorner` to `hostStyle.js`**

Append to `app/src/components/video/hostStyle.js`:

```js
// Map a point (e.g. a drag-drop position) to the nearest screen corner.
export function nearestCorner(x, y, vw, vh) {
  const v = y < vh / 2 ? 't' : 'b'
  const h = x < vw / 2 ? 'l' : 'r'
  return `${v}${h}`
}
```

- [ ] **Step 4: Add drag + expand to `GlobalVideoLayer.jsx`**

Update imports:

```jsx
import { subscribe, getSnapshot, next as storeNext, minimize, expand as storeExpand, close as storeClose, setCorner } from './videoStore'
import { computeHostStyle, nearestCorner } from './hostStyle'
import { PauseIcon, CloseIcon, MinimizeIcon, ExpandIcon, NextIcon, DragIcon } from './icons'
import { useNavigate } from 'react-router-dom'
```

Inside the component, after `const togglePlay = ...`, add the navigate hook (place the `useNavigate()` call up with the other hooks, before the early `return null`) and drag handlers:

```jsx
  // (hook — declare alongside the other hooks, above `if (!active) return null`)
  const navigate = useNavigate()
  const dragRef = useRef(null)

  const onExpand = useCallback(() => {
    navigate('/desk?section=videos')
    storeExpand()
  }, [navigate])

  const onDragStart = useCallback((e) => {
    if (mode !== 'mini') return
    e.preventDefault()
    const move = (ev) => {
      const p = ev.touches ? ev.touches[0] : ev
      dragRef.current = { x: p.clientX, y: p.clientY }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const d = dragRef.current
      if (d) setCorner(nearestCorner(d.x, d.y, window.innerWidth, window.innerHeight))
      dragRef.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [mode])
```

Add the drag handle + expand button into the rendered host. Add the drag handle as the first child inside the host `<div>`:

```jsx
      {mode === 'mini' && (
        <div className={styles.dragHandle} onPointerDown={onDragStart} aria-label="Move player">
          <DragIcon />
        </div>
      )}
```

And in the `.controls` row, add an Expand button shown only in mini mode (place it just before the Close button):

```jsx
        {mode === 'mini' && (
          <button className={styles.cbtn} onClick={onExpand} aria-label="Expand to Desk">
            <ExpandIcon />
          </button>
        )}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd app && npx vitest run src/components/video/GlobalVideoLayer.test.jsx src/components/video/hostStyle.test.js`
Expected: PASS (all cases, including the two new ones).

- [ ] **Step 6: Commit**

```bash
git add app/src/components/video/GlobalVideoLayer.jsx app/src/components/video/GlobalVideoLayer.module.css app/src/components/video/GlobalVideoLayer.test.jsx app/src/components/video/hostStyle.js
git commit -m "feat(video): draggable mini-player + expand-to-Desk"
```

---

### Task 7: Audio exclusivity — one sound source at a time

**Files:**
- Create: `app/src/components/video/audioExclusivity.js`
- Test: `app/src/components/video/audioExclusivity.test.js`
- Modify: `app/src/components/video/GlobalVideoLayer.jsx`

**Interfaces:**
- Produces: `pauseOtherAudio()` — pauses every currently-playing `<audio>` element on the page (the read-aloud / voice players). Conservative: it only calls `.pause()`, never resets any state machine (avoids regressing the shared-audio orphan bug). Called when our video transitions to PLAYING.

- [ ] **Step 1: Write the failing test**

```js
// app/src/components/video/audioExclusivity.test.js
import { describe, it, expect, vi } from 'vitest'
import { pauseOtherAudio } from './audioExclusivity'

describe('pauseOtherAudio', () => {
  it('pauses playing audio elements and leaves paused ones alone', () => {
    const playing = document.createElement('audio')
    Object.defineProperty(playing, 'paused', { value: false })
    playing.pause = vi.fn()
    const stopped = document.createElement('audio')
    Object.defineProperty(stopped, 'paused', { value: true })
    stopped.pause = vi.fn()
    document.body.append(playing, stopped)

    pauseOtherAudio()

    expect(playing.pause).toHaveBeenCalledTimes(1)
    expect(stopped.pause).not.toHaveBeenCalled()
    playing.remove(); stopped.remove()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/components/video/audioExclusivity.test.js`
Expected: FAIL — `Failed to resolve import './audioExclusivity'`.

- [ ] **Step 3: Write the utility**

```js
// app/src/components/video/audioExclusivity.js
// When a Desk video starts, silence any other audio source (read-aloud / voice)
// so the user never hears two streams at once. Deliberately conservative: we
// only pause currently-playing <audio> elements; we never touch the voice state
// machine (a stray reset there caused the past "Read Aloud stuck-on" orphan).
export function pauseOtherAudio() {
  if (typeof document === 'undefined') return
  document.querySelectorAll('audio').forEach((el) => {
    try { if (!el.paused) el.pause() } catch { /* ignore */ }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/components/video/audioExclusivity.test.js`
Expected: PASS.

- [ ] **Step 5: Wire it into the player's PLAYING transition**

In `app/src/components/video/GlobalVideoLayer.jsx`, import it:

```jsx
import { pauseOtherAudio } from './audioExclusivity'
```

In the `onStateChange` handler, in the `e.data === 1` (PLAYING) branch, call it first:

```jsx
          } else if (e.data === 1) {
            pauseOtherAudio()
            saveNow()
            setIsPlaying(true)
            setEnded(false)
```

- [ ] **Step 6: Run the video suite to verify no regressions**

Run: `cd app && npx vitest run src/components/video/`
Expected: PASS (all video tests).

- [ ] **Step 7: Commit**

```bash
git add app/src/components/video/audioExclusivity.js app/src/components/video/audioExclusivity.test.js app/src/components/video/GlobalVideoLayer.jsx
git commit -m "feat(video): pause other audio when a video starts playing"
```

---

### Task 8: Final verification — full suite, build, mobile stacking

**Files:**
- Modify (if needed): `app/src/components/video/GlobalVideoLayer.module.css` (mobile media-query tweaks only).

- [ ] **Step 1: Run the full frontend test suite**

Run: `cd app && npm test`
Expected: PASS — the whole suite is green, including the new `components/video/*` tests and the existing `desk/*` tests, with no remaining references to the deleted `VideoPlayer`.

- [ ] **Step 2: Production build**

Run: `cd app && npm run build`
Expected: build succeeds with no errors or unresolved imports.

- [ ] **Step 3: Confirm mobile stacking values**

Re-read `GlobalVideoLayer.module.css` and `hostStyle.js` and confirm against the constraints:
- Host `z-index: 8500` (above voice orb `8000`, below audio bar `9000`).
- `MINI.mobileBottomClear` (80) clears the `MobileTabBar` (~58px) + safe area.
- Mini controls are always visible at `max-width: 640px` (tap-friendly).

If any value is off, fix it inline and re-run Steps 1–2.

- [ ] **Step 4: Commit any tweaks**

```bash
git add app/src/components/video/GlobalVideoLayer.module.css app/src/components/video/hostStyle.js
git commit -m "chore(video): mobile stacking + safe-area clearances"
```

- [ ] **Step 5: Push for deploy (per always-push preference)**

Push the worktree branch fast-forward onto master (shared-tree rule — never `git add -A`, ship via fast-forward):

```bash
git push origin HEAD:master
```

Then verify the Railway deploy succeeds and report the bundle is live (see `reference_dashboard_deploy_verify_cloudflare`).

---

## Manual verification checklist (user, in-browser)

After deploy, on `/desk?section=videos`:
1. Click a video → it plays in the inline theater (docked).
2. Navigate to `/charts` (or any page) → the video shrinks to a floating corner mini and **keeps playing without restarting**.
3. Drag the mini to another corner → it snaps and stays there on the next navigation.
4. Click Expand on the mini → returns to the Desk and re-docks at the same timestamp.
5. Let a video end → "Next up" card → auto-advances to the next in the section (works docked and mini).
6. Close (X) → player disappears; the video shows under "Continue watching" with its saved position.
7. On a phone: the mini sits above the bottom tab bar, clear of the voice orb and the "?" button; controls are tappable.
8. Start a video while a read-aloud is playing → the read-aloud audio pauses (no double audio).

---

## Self-Review

**Spec coverage:**
- Single global player outside `<Routes>` → Task 4 (mounted in `App.jsx`).
- Reposition-only, no iframe re-mount → Task 2 (`computeHostStyle`) + Task 4 (build-once effect).
- Store with modes/actions → Task 1.
- Auto-shrink on navigate + manual minimize → Task 5 (slot unmount → `clearDockSlot`) + Task 4 (Minimize button).
- Expand back to Desk → Task 6.
- Draggable corner, persisted → Task 6 (`nearestCorner` + `setCorner` + `desk_video_corner`).
- Next / autoplay-next in both modes → Task 4.
- Branded gold controls, no emoji → Task 3.
- Audio exclusivity (conservative) → Task 7.
- Shared-element animation → Task 4 CSS transition on top/left/width/height.
- Stacking / z-index 8500, above orb below audio bar → Tasks 4 + 8.
- Mobile full parity, CSS/`window`-driven not `useMediaQuery` → `hostStyle` viewport args + media queries (Tasks 2/4/8).
- Error handling (API fail, onError-safe try/catch, flush on close, StrictMode-safe build-once guard) → Task 4.
- Reuse `videoProgress.js`, no backend changes → Tasks 4/5.
- Tests for store, positioning, slot, layer, audio → all tasks.

**Placeholder scan:** No TBD/TODO; every code/step is concrete.

**Type consistency:** Action names match across tasks — `play/playIndex/next/minimize/expand/close/setCorner/registerDockSlot/clearDockSlot/currentVideo/subscribe/getSnapshot/__reset` defined in Task 1 and consumed verbatim in Tasks 4–7. `computeHostStyle`/`nearestCorner`/`MINI` defined in Tasks 2/6 and used in Tasks 4/6. Icon names (`PauseIcon/CloseIcon/MinimizeIcon/ExpandIcon/NextIcon/DragIcon`) defined in Task 3, consumed in Tasks 4/6.
