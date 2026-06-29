# Notebook Video Timestamps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `[MM:SS]` markers in saved Notebook video-notes clickable so they seek the note's embedded player to that moment and play.

**Architecture:** A custom atomic TipTap inline node (`videoTimestamp`) renders each timestamp as a non-editable gold chip that, on click, dispatches a `uct:video-seek` DOM CustomEvent. A new seekable hero player component (`NoteVideoHero`) in the Notebook editor listens for that event and drives the YouTube IFrame API (`seekTo` + `playVideo`). The Desk export (`saveToNotebook`) emits these nodes, and a pure transform upgrades legacy bold-text timestamps on load.

**Tech Stack:** React, TipTap v3 (`@tiptap/core`/`@tiptap/react`), YouTube IFrame Player API (existing `useYouTubeApi`), Vitest + @testing-library/react.

## Global Constraints

- Branch: `feat/notebook-video-timestamps` (off `origin/master`); worktree `.claude/worktrees/notebook-video-timestamps`.
- All frontend code under `app/`. Run tests from `app/`: `npx vitest run <path>`.
- **First step before any test:** `cd app && npm install` (worktree has no `node_modules` yet).
- Frontend-only. **No backend, API, or DB schema change.**
- Time formatting MUST reuse `fmtTime` from `app/src/components/video/playerUtils.js` (`m:ss`, or `h:mm:ss` past an hour; NaN/negative → `0:00`).
- Seek event contract (fixed): `new CustomEvent('uct:video-seek', { detail: { seconds }, bubbles: true })`.
- Brand: chip color uses the `--ut-gold` token (fallback `#d4af37`). No generic emoji.
- Follow existing test style: `import { describe, it, expect, beforeEach } from 'vitest'`.

---

### Task 1: `videoTimestamp` TipTap node

**Files:**
- Create: `app/src/pages/journal-2-0/lib/videoTimestampNode.js`
- Test: `app/src/pages/journal-2-0/lib/videoTimestampNode.test.js`

**Interfaces:**
- Consumes: `fmtTime(secs)` from `app/src/components/video/playerUtils.js`.
- Produces: named export `VideoTimestamp` (a TipTap `Node`, name `videoTimestamp`, attr `{ seconds: number }`). Serializes to/from `data-video-ts="<seconds>"`. Clicking the rendered chip dispatches `uct:video-seek` with `{ seconds }`.

- [ ] **Step 1: Install deps (one-time)**

Run: `cd app && npm install`
Expected: completes; `app/node_modules/@tiptap/core` exists.

- [ ] **Step 2: Write the failing test**

```js
// app/src/pages/journal-2-0/lib/videoTimestampNode.test.js
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { VideoTimestamp } from './videoTimestampNode'

let editor
afterEach(() => { editor?.destroy(); editor = null })

function mount(seconds) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({
    element: el,
    extensions: [StarterKit, VideoTimestamp],
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'videoTimestamp', attrs: { seconds } }] }],
    },
  })
  return el
}

describe('VideoTimestamp node', () => {
  it('renders a chip showing [m:ss] with a data-video-ts attribute', () => {
    const el = mount(75)
    const chip = el.querySelector('[data-video-ts]')
    expect(chip).toBeTruthy()
    expect(chip.getAttribute('data-video-ts')).toBe('75')
    expect(chip.textContent).toBe('[1:15]')
  })

  it('dispatches uct:video-seek with the seconds on click', () => {
    const el = mount(42)
    const chip = el.querySelector('[data-video-ts]')
    let got = null
    window.addEventListener('uct:video-seek', (e) => { got = e.detail.seconds }, { once: true })
    chip.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(got).toBe(42)
  })

  it('serializes back to HTML with data-video-ts (round-trip)', () => {
    mount(3661)
    expect(editor.getHTML()).toContain('data-video-ts="3661"')
  })

  it('clamps malformed seconds to 0', () => {
    const el = mount(-5)
    expect(el.querySelector('[data-video-ts]').getAttribute('data-video-ts')).toBe('0')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/videoTimestampNode.test.js`
Expected: FAIL — cannot resolve `./videoTimestampNode`.

- [ ] **Step 4: Write the node**

```js
// app/src/pages/journal-2-0/lib/videoTimestampNode.js
import { Node, mergeAttributes } from '@tiptap/core'
import { fmtTime } from '../../../components/video/playerUtils'

const clampSecs = (v) => Math.max(0, Math.floor(Number(v) || 0))

// Atomic, non-editable inline chip that represents a moment in the note's
// source video. Clicking it asks the page's hero player to jump there via a
// bubbling `uct:video-seek` CustomEvent. Stored as raw seconds (robust past
// the one-hour mark); the display string is derived with fmtTime.
export const VideoTimestamp = Node.create({
  name: 'videoTimestamp',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      seconds: {
        default: 0,
        parseHTML: (el) => clampSecs(el.getAttribute('data-video-ts')),
        renderHTML: (attrs) => ({ 'data-video-ts': String(clampSecs(attrs.seconds)) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'button[data-video-ts]' }, { tag: 'span[data-video-ts]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const secs = clampSecs(node.attrs.seconds)
    return [
      'button',
      mergeAttributes(HTMLAttributes, {
        'data-video-ts': String(secs),
        type: 'button',
        class: 'uct-video-ts',
        contenteditable: 'false',
        title: 'Jump to this moment',
      }),
      `[${fmtTime(secs)}]`,
    ]
  },

  addNodeView() {
    return ({ node }) => {
      const secs = clampSecs(node.attrs.seconds)
      const dom = document.createElement('button')
      dom.type = 'button'
      dom.className = 'uct-video-ts'
      dom.setAttribute('data-video-ts', String(secs))
      dom.setAttribute('contenteditable', 'false')
      dom.title = 'Jump to this moment'
      dom.textContent = `[${fmtTime(secs)}]`
      dom.style.cssText =
        'color:var(--ut-gold,#d4af37);background:none;border:none;padding:0 2px;' +
        'font:inherit;font-weight:600;cursor:pointer;'
      // Keep the editor from hijacking selection/focus on press.
      dom.addEventListener('mousedown', (e) => e.preventDefault())
      dom.addEventListener('click', (e) => {
        e.preventDefault()
        dom.dispatchEvent(
          new CustomEvent('uct:video-seek', { detail: { seconds: secs }, bubbles: true }),
        )
      })
      return { dom }
    }
  },
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/videoTimestampNode.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add app/src/pages/journal-2-0/lib/videoTimestampNode.js app/src/pages/journal-2-0/lib/videoTimestampNode.test.js
git commit -m "feat: videoTimestamp TipTap node (clickable [MM:SS] chip)"
```

---

### Task 2: `linkifyTimestamps` legacy-doc transform

**Files:**
- Create: `app/src/pages/journal-2-0/lib/linkifyTimestamps.js`
- Test: `app/src/pages/journal-2-0/lib/linkifyTimestamps.test.js`

**Interfaces:**
- Produces: default export `linkifyTimestamps(doc) -> doc`. Pure. For each top-level `paragraph` whose first child is a `text` node starting with `[M:SS]` or `[H:MM:SS]` (optionally bold, optionally followed by one space), replaces that prefix with a `{ type: 'videoTimestamp', attrs: { seconds } }` node. Non-matching docs/paragraphs are returned structurally unchanged. Caller is responsible for only invoking this when a YouTube hero is present.

- [ ] **Step 1: Write the failing test**

```js
// app/src/pages/journal-2-0/lib/linkifyTimestamps.test.js
import { describe, it, expect } from 'vitest'
import linkifyTimestamps from './linkifyTimestamps'

const para = (children) => ({ type: 'paragraph', content: children })
const txt = (text, bold) => ({ type: 'text', ...(bold ? { marks: [{ type: 'bold' }] } : {}), text })

describe('linkifyTimestamps', () => {
  it('converts a legacy bold [M:SS] prefix into a videoTimestamp node', () => {
    const doc = { type: 'doc', content: [para([txt('[1:15] ', true), txt('Breakout retest')])] }
    const out = linkifyTimestamps(doc)
    const p = out.content[0]
    expect(p.content[0]).toEqual({ type: 'videoTimestamp', attrs: { seconds: 75 } })
    expect(p.content[p.content.length - 1].text).toBe('Breakout retest')
  })

  it('handles H:MM:SS', () => {
    const doc = { type: 'doc', content: [para([txt('[1:02:03] ', true), txt('Late note')])] }
    expect(linkifyTimestamps(doc).content[0].content[0]).toEqual({
      type: 'videoTimestamp', attrs: { seconds: 3723 },
    })
  })

  it('handles prefix + text in one node', () => {
    const doc = { type: 'doc', content: [para([txt('[0:30] inline text', true)])] }
    const p = linkifyTimestamps(doc).content[0]
    expect(p.content[0]).toEqual({ type: 'videoTimestamp', attrs: { seconds: 30 } })
    expect(p.content[1].text).toBe('inline text')
  })

  it('leaves non-matching paragraphs untouched', () => {
    const doc = { type: 'doc', content: [para([txt('Just a plain note')])] }
    expect(linkifyTimestamps(doc)).toEqual(doc)
  })

  it('leaves already-converted docs untouched', () => {
    const doc = {
      type: 'doc',
      content: [para([{ type: 'videoTimestamp', attrs: { seconds: 10 } }, txt(' x')])],
    }
    expect(linkifyTimestamps(doc)).toEqual(doc)
  })

  it('returns input unchanged when not a doc', () => {
    expect(linkifyTimestamps(null)).toBe(null)
    expect(linkifyTimestamps({})).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/linkifyTimestamps.test.js`
Expected: FAIL — cannot resolve `./linkifyTimestamps`.

- [ ] **Step 3: Write the transform**

```js
// app/src/pages/journal-2-0/lib/linkifyTimestamps.js
// Upgrade legacy Notebook exports (bold "[M:SS] "/"[H:MM:SS] " text prefixes,
// produced by older saveToNotebook versions) into videoTimestamp nodes so they
// become clickable. Pure function over a TipTap doc. Only the leading prefix of
// each top-level paragraph is considered. Caller gates on YouTube-hero presence.

const TS_RE = /^\[(\d+):([0-5]?\d)(?::([0-5]\d))?\]\s?/

function parsePrefix(text) {
  const m = TS_RE.exec(text)
  if (!m) return null
  const seconds =
    m[3] !== undefined
      ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
      : Number(m[1]) * 60 + Number(m[2])
  return { seconds, rest: text.slice(m[0].length) }
}

export default function linkifyTimestamps(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.content)) return doc
  const content = doc.content.map((node) => {
    if (node.type !== 'paragraph' || !Array.isArray(node.content) || node.content.length === 0) {
      return node
    }
    const [first, ...rest] = node.content
    if (!first || first.type !== 'text' || typeof first.text !== 'string') return node
    const parsed = parsePrefix(first.text)
    if (!parsed) return node
    const tsNode = { type: 'videoTimestamp', attrs: { seconds: parsed.seconds } }
    // Drop the bold mark from any leftover text so the note body reads cleanly.
    const remainder = parsed.rest ? [{ type: 'text', text: parsed.rest }] : []
    return { ...node, content: [tsNode, ...remainder, ...rest] }
  })
  return { ...doc, content }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/linkifyTimestamps.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/lib/linkifyTimestamps.js app/src/pages/journal-2-0/lib/linkifyTimestamps.test.js
git commit -m "feat: linkifyTimestamps transform for legacy notebook timestamps"
```

---

### Task 3: Register the node + plain-text extraction

**Files:**
- Modify: `app/src/pages/journal-2-0/lib/tiptap.js`
- Test: `app/src/pages/journal-2-0/lib/tiptap.test.js` (create)

**Interfaces:**
- Consumes: `VideoTimestamp` (Task 1), `fmtTime`.
- Produces: `buildExtensions()` includes `VideoTimestamp`; `extractPlainText(doc)` renders a `videoTimestamp` node as `[m:ss]` text.

- [ ] **Step 1: Write the failing test**

```js
// app/src/pages/journal-2-0/lib/tiptap.test.js
import { describe, it, expect } from 'vitest'
import { buildExtensions, extractPlainText } from './tiptap'

describe('tiptap config', () => {
  it('registers the videoTimestamp node', () => {
    const names = buildExtensions().map((e) => e.name)
    expect(names).toContain('videoTimestamp')
  })

  it('extractPlainText renders a videoTimestamp as [m:ss]', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'videoTimestamp', attrs: { seconds: 75 } }, { type: 'text', text: ' note' }],
      }],
    }
    expect(extractPlainText(doc)).toBe('[1:15]  note')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/tiptap.test.js`
Expected: FAIL — `videoTimestamp` not in extension names.

- [ ] **Step 3: Edit `tiptap.js`**

Add the import near the other extension imports:

```js
import { VideoTimestamp } from './videoTimestampNode'
import { fmtTime } from '../../../components/video/playerUtils'
```

Add `VideoTimestamp` to the array returned by `buildExtensions()` (append after `SlashMenuExtension`):

```js
    SlashMenuExtension,
    VideoTimestamp,
  ]
```

In `extractPlainText`, extend the `walk` function to handle the node — add this branch right after the existing `if (node.type === 'text' ...)` line:

```js
    if (node.type === 'videoTimestamp') out.push(`[${fmtTime(node.attrs?.seconds || 0)}]`)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/tiptap.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/lib/tiptap.js app/src/pages/journal-2-0/lib/tiptap.test.js
git commit -m "feat: register videoTimestamp node + include in plain-text extraction"
```

---

### Task 4: `NoteVideoHero` seekable hero player

**Files:**
- Create: `app/src/pages/journal-2-0/components/notebook/NoteVideoHero.jsx`
- Test: `app/src/pages/journal-2-0/components/notebook/NoteVideoHero.test.jsx`

**Interfaces:**
- Consumes: `useYouTubeApi()` from `app/src/pages/desk/useYouTubeApi.js` (returns boolean `ready`; the `YT.Player` is read off `window.YT`). Listens for `uct:video-seek` on `window`.
- Produces: default export `NoteVideoHero({ youtubeId, watchUrl })`. Renders the embedded player (or a bare-iframe fallback before the API is ready) + a "Watch on YouTube ↗" link. On `uct:video-seek`, scrolls itself into view and calls `player.seekTo(seconds, true)` + `player.playVideo()`. Returns `null` when `youtubeId` is falsy. Reuses the existing `.videoHero / .videoHeroFrame / .videoHeroLink` classes from `NoteEditorPage.module.css`.

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/pages/journal-2-0/components/notebook/NoteVideoHero.test.jsx
import { render, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import NoteVideoHero from './NoteVideoHero'

let lastPlayer
beforeEach(() => {
  lastPlayer = null
  window.YT = {
    Player: class {
      constructor(el, opts) {
        this.opts = opts
        this.seekTo = vi.fn()
        this.playVideo = vi.fn()
        this.destroy = vi.fn()
        lastPlayer = this
      }
    },
  }
})
afterEach(() => { delete window.YT })

describe('NoteVideoHero', () => {
  it('renders nothing without a youtubeId', () => {
    const { container } = render(<NoteVideoHero youtubeId="" watchUrl="x" />)
    expect(container.firstChild).toBeNull()
  })

  it('instantiates a YT.Player for the video', () => {
    render(<NoteVideoHero youtubeId="abcdefghijk" watchUrl="https://youtu.be/abcdefghijk" />)
    expect(lastPlayer).toBeTruthy()
    expect(lastPlayer.opts.videoId).toBe('abcdefghijk')
  })

  it('seeks and plays on uct:video-seek', () => {
    render(<NoteVideoHero youtubeId="abcdefghijk" watchUrl="x" />)
    act(() => {
      window.dispatchEvent(new CustomEvent('uct:video-seek', { detail: { seconds: 42 } }))
    })
    expect(lastPlayer.seekTo).toHaveBeenCalledWith(42, true)
    expect(lastPlayer.playVideo).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/journal-2-0/components/notebook/NoteVideoHero.test.jsx`
Expected: FAIL — cannot resolve `./NoteVideoHero`.

- [ ] **Step 3: Write the component**

```jsx
// app/src/pages/journal-2-0/components/notebook/NoteVideoHero.jsx
import { useEffect, useRef } from 'react'
import { useYouTubeApi } from '../../../desk/useYouTubeApi'
import styles from './NoteEditorPage.module.css'

// Seekable replacement for the Notebook's bare hero iframe. Mounts a YouTube
// IFrame-API player so clickable [MM:SS] chips (videoTimestamp nodes) can jump
// the video via the `uct:video-seek` event. Falls back to a plain iframe until
// the API is ready (or if it fails to load) so the video always shows.
export default function NoteVideoHero({ youtubeId, watchUrl }) {
  const ready = useYouTubeApi()
  const mountRef = useRef(null)
  const playerRef = useRef(null)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!ready || !youtubeId || !mountRef.current) return
    if (!(window.YT && window.YT.Player)) return
    const player = new window.YT.Player(mountRef.current, {
      videoId: youtubeId,
      playerVars: { rel: 0, modestbranding: 1, playsinline: 1, enablejsapi: 1 },
    })
    playerRef.current = player
    return () => {
      try { player.destroy() } catch { /* ignore */ }
      playerRef.current = null
    }
  }, [ready, youtubeId])

  useEffect(() => {
    const onSeek = (e) => {
      const secs = Math.max(0, Math.floor(Number(e.detail?.seconds) || 0))
      try { wrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) } catch { /* ignore */ }
      const p = playerRef.current
      if (p && typeof p.seekTo === 'function') {
        try { p.seekTo(secs, true); p.playVideo() } catch { /* ignore */ }
      }
    }
    window.addEventListener('uct:video-seek', onSeek)
    return () => window.removeEventListener('uct:video-seek', onSeek)
  }, [])

  if (!youtubeId) return null

  return (
    <div className={styles.videoHero} ref={wrapRef}>
      <div className={styles.videoHeroFrame}>
        {ready ? (
          <div ref={mountRef} />
        ) : (
          <iframe
            src={`https://www.youtube.com/embed/${youtubeId}?rel=0&modestbranding=1&playsinline=1`}
            title="Session video"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        )}
      </div>
      <a className={styles.videoHeroLink} href={watchUrl} target="_blank" rel="noreferrer">
        Watch on YouTube ↗
      </a>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/journal-2-0/components/notebook/NoteVideoHero.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/components/notebook/NoteVideoHero.jsx app/src/pages/journal-2-0/components/notebook/NoteVideoHero.test.jsx
git commit -m "feat: NoteVideoHero seekable hero player (responds to uct:video-seek)"
```

---

### Task 5: Wire the hero + legacy upgrade into `NoteEditorPage`

**Files:**
- Modify: `app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx`
- Test: `app/src/pages/journal-2-0/components/notebook/NoteEditorPage.video.test.jsx` (create)

**Interfaces:**
- Consumes: `NoteVideoHero` (Task 4), `linkifyTimestamps` (Task 2), existing `parseYouTubeId` (already in the file), `buildExtensions` (now includes the node).
- Produces: when `note.heroImageUrl` is a YouTube URL, the editor content is run through `linkifyTimestamps` (so legacy bold timestamps become chips) and the hero renders `NoteVideoHero`. Non-video notes are unchanged (still `HeroImagePicker`, raw body).

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/pages/journal-2-0/components/notebook/NoteEditorPage.video.test.jsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const NOTE = {
  id: 'n1', title: 'AAPL session — Notes', subtitle: '', folderId: null,
  ticker: 'AAPL', tags: [],
  heroImageUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
  bodyJson: {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [
        { type: 'text', marks: [{ type: 'bold' }], text: '[1:15] ' },
        { type: 'text', text: 'Breakout retest' },
      ],
    }],
  },
}

vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, update: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

beforeEach(() => {
  window.YT = { Player: class { constructor() { this.seekTo = vi.fn(); this.playVideo = vi.fn(); this.destroy = vi.fn() } } }
})
afterEach(() => { delete window.YT; vi.clearAllMocks() })

describe('NoteEditorPage video timestamps', () => {
  it('upgrades a legacy bold [MM:SS] note into a clickable chip', async () => {
    const NoteEditorPage = (await import('./NoteEditorPage')).default
    render(<NoteEditorPage noteId="n1" onBack={() => {}} />)
    const chip = document.querySelector('[data-video-ts]')
    expect(chip).toBeTruthy()
    expect(chip.getAttribute('data-video-ts')).toBe('75')
    expect(chip.textContent).toBe('[1:15]')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/journal-2-0/components/notebook/NoteEditorPage.video.test.jsx`
Expected: FAIL — no `[data-video-ts]` element (legacy text not yet upgraded).

- [ ] **Step 3: Edit `NoteEditorPage.jsx` — imports**

Add to the import block at the top:

```js
import { useMemo } from 'react'
import NoteVideoHero from './NoteVideoHero'
import linkifyTimestamps from '../../lib/linkifyTimestamps'
```

(If `useMemo` is already imported from `react`, add it to that existing import instead of a duplicate line.)

- [ ] **Step 4: Edit `NoteEditorPage.jsx` — compute hero id + editor body**

Immediately after `const editor = useEditor(...)`'s closing — actually place this BEFORE `const editor = useEditor(` so it can be referenced. Add:

```js
  const ytId = parseYouTubeId(note?.heroImageUrl)
  const bodyForEditor = useMemo(
    () => (ytId && note?.bodyJson ? linkifyTimestamps(note.bodyJson) : note?.bodyJson),
    [ytId, note?.bodyJson],
  )
```

Change the `useEditor` `content` line from:

```js
    content: note?.bodyJson || { type: 'doc', content: [] },
```
to:
```js
    content: bodyForEditor || { type: 'doc', content: [] },
```

- [ ] **Step 5: Edit `NoteEditorPage.jsx` — setContent comparison**

In the "Push fresh body into editor" effect, change the `fresh` source so it matches the (possibly linkified) editor content and avoids a redundant `setContent`:

```js
      const current = JSON.stringify(editor.getJSON())
      const fresh = JSON.stringify(bodyForEditor)
      if (current !== fresh) editor.commands.setContent(bodyForEditor, false)
```

- [ ] **Step 6: Edit `NoteEditorPage.jsx` — replace the hero block**

Replace the whole `{parseYouTubeId(note.heroImageUrl) ? ( ... ) : ( <HeroImagePicker .../> )}` block (the embedded `<iframe>` hero, ~lines 298–323) with:

```jsx
        {ytId ? (
          <NoteVideoHero youtubeId={ytId} watchUrl={note.heroImageUrl} />
        ) : (
          <HeroImagePicker
            noteId={noteId}
            value={note.heroImageUrl}
            onChange={onHeroChange}
          />
        )}
```

- [ ] **Step 7: Run the new test + the lib tests to verify green**

Run: `cd app && npx vitest run src/pages/journal-2-0/components/notebook/NoteEditorPage.video.test.jsx`
Expected: PASS (1 test). The chip is present with `data-video-ts="75"`.

- [ ] **Step 8: Commit**

```bash
git add app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx app/src/pages/journal-2-0/components/notebook/NoteEditorPage.video.test.jsx
git commit -m "feat: Notebook editor uses seekable hero + upgrades legacy timestamps to chips"
```

---

### Task 6: Export chips from `saveToNotebook`

**Files:**
- Modify: `app/src/components/video/VideoDockSlot.jsx` (`saveToNotebook`, ~lines 55–82)
- Test: `app/src/components/video/VideoDockSlot.notebook.test.jsx` (create)

**Interfaces:**
- Consumes: `useVideoNotes` (mocked in test), `videoStore.play`.
- Produces: `saveToNotebook` posts `bodyJson` whose each paragraph is `[{ type:'videoTimestamp', attrs:{ seconds } }, { type:'text', text:' '+noteText }]` (instead of bold-text prefix). `heroImageUrl` unchanged.

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/components/video/VideoDockSlot.notebook.test.jsx
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as store from './videoStore'

vi.mock('../../hooks/useVideoNotes', () => ({
  default: () => ({
    notes: [{ id: 1, t_seconds: 75, text: 'Breakout retest' }],
    add: vi.fn(),
    remove: vi.fn(),
  }),
}))

beforeEach(() => { store.__reset() })
afterEach(() => { vi.restoreAllMocks() })

const LIST = [{ id: 1, youtube_id: 'abcdefghijk', title: 'AAPL session' }]

describe('saveToNotebook emits videoTimestamp chips', () => {
  it('posts a bodyJson with a videoTimestamp node per note', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    act(() => store.play(LIST, 0))
    render(<VideoDockSlotWrapper />)
    function VideoDockSlotWrapper() {
      const Comp = require('./VideoDockSlot').default
      return <Comp />
    }
    const btn = await screen.findByRole('button', { name: /notebook/i })
    await act(async () => { fireEvent.click(btn) })
    const post = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/j2/notes'))
    expect(post).toBeTruthy()
    const body = JSON.parse(post[1].body)
    const firstPara = body.bodyJson.content[0]
    expect(firstPara.content[0]).toEqual({ type: 'videoTimestamp', attrs: { seconds: 75 } })
    expect(firstPara.content[1].text).toBe(' Breakout retest')
  })
})
```

> Note: if `import VideoDockSlot from './VideoDockSlot'` at top works in this repo's test setup, prefer a normal top import over the `require` wrapper above and render `<VideoDockSlot />` directly. Match the existing `VideoDockSlot.test.jsx` import style.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/components/video/VideoDockSlot.notebook.test.jsx`
Expected: FAIL — first paragraph child is a bold text node, not a `videoTimestamp` node.

- [ ] **Step 3: Edit `saveToNotebook` in `VideoDockSlot.jsx`**

Replace the `content` mapping:

```js
    const content = notes.map((n) => ({
      type: 'paragraph',
      content: [
        { type: 'text', marks: [{ type: 'bold' }], text: `[${fmtT(n.t_seconds)}] ` },
        { type: 'text', text: n.text },
      ],
    }))
```
with:
```js
    const content = notes.map((n) => ({
      type: 'paragraph',
      content: [
        { type: 'videoTimestamp', attrs: { seconds: n.t_seconds } },
        { type: 'text', text: ' ' + n.text },
      ],
    }))
```

(`fmtT` may now be unused in this function; leave other usages intact. If lint flags it as entirely unused in the file, remove the import — otherwise leave it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/components/video/VideoDockSlot.notebook.test.jsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add app/src/components/video/VideoDockSlot.jsx app/src/components/video/VideoDockSlot.notebook.test.jsx
git commit -m "feat: saveToNotebook exports clickable videoTimestamp chips"
```

---

### Task 7: Full suite + build verification

**Files:** none (verification only).

- [ ] **Step 1: Run the video + notebook test suites**

Run: `cd app && npx vitest run src/components/video src/pages/journal-2-0/lib src/pages/journal-2-0/components/notebook`
Expected: all green (including the pre-existing `VideoDockSlot.test.jsx`, `videoStore.test.js`).

- [ ] **Step 2: Production build**

Run: `cd app && npm run build`
Expected: build succeeds, no errors.

- [ ] **Step 3: Commit (only if any lint/build fix was needed)**

```bash
git add -A
git commit -m "chore: lint/build fixes for notebook video timestamps"
```

---

## Manual verification (after merge or on a deploy)

1. On the Desk, play a video, jot 2–3 notes at different moments, click **Save notes to Journal Notebook**.
2. Open the note in the Notebook (`/journal?j2tab=notebook` → the new note).
3. Confirm each line starts with a gold `[M:SS]` chip; the video hero shows at top.
4. Click a chip → the hero scrolls into view, jumps to that second, and plays.
5. Open an older video-note saved before this change → confirm its `[M:SS]` prefixes also became clickable chips.

## Self-Review Notes

- **Spec coverage:** clickable chips (Tasks 1,3,6) ✓; seek the embedded video (Task 4) ✓; scroll-into-view + play (Task 4) ✓; backward-compat for legacy notes (Tasks 2,5) ✓; graceful no-video (Task 4 returns null hero / event no-op; chips still render) ✓; tests (every task) ✓; no backend change ✓. Phase 2 screenshots intentionally out of scope.
- **Deviation from spec:** the spec mentioned a distinct "inert" chip style when no video is present. Dropped as YAGNI — without a hero listener the click is already a harmless no-op, and adding node→hero coupling isn't worth it. Behavior remains graceful.
- **Type consistency:** event name `uct:video-seek` and `detail.seconds` identical across Tasks 1/4/5; node type string `videoTimestamp` with attr `seconds` identical across Tasks 1/2/3/6; `fmtTime` reused everywhere.
