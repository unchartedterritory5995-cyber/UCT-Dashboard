# "From the Desk" Dashboard Video Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "From the Desk" horizontal video rail to the Dashboard that leads with Continue Watching, fills with the newest videos, and opens a clicked video in the persistent Desk player.

**Architecture:** One pure helper (`buildRail`) derives the ordered rail from the existing `/api/education/videos` payload + the `videoProgress` store; one component (`DeskVideoRail`) renders it and wires clicks to `videoStore.play()` + navigation. No backend changes.

**Tech Stack:** React 18 (`useSyncExternalStore`), SWR, React Router, Vitest + React Testing Library, CSS Modules.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-26-desk-video-rail-design.md`.
- **No backend changes.** Reuse `GET /api/education/videos` (each video already includes `created_at`).
- **Paid-only surface** — `/dashboard` is already paid-gated; no extra paywall logic.
- **No generic emoji** — use the gold SVG icons from `app/src/pages/education/icons.jsx` (`GraduationIcon`, `PlayIcon`).
- **Renders nothing on empty/error** — never show a dead box on the dashboard.
- **Rail item shape:** `{ video, list, index, pct, resume }` — `list` is the video's category `videos` array, `index` its position in that list.
- **Test command:** from the `app/` directory: `npx vitest run <path>` (single file) / `npm test` (full FE suite). Build: `npm run build`. (Run all commands from `app/`, not the repo root.)
- **Ship:** isolated worktree off `origin/master`; fast-forward `push origin HEAD:master`.

---

## File Structure

**New**
- `app/src/components/dashboard/buildRail.js` — pure rail derivation (Continue Watching + Latest, dedup, cap).
- `app/src/components/dashboard/DeskVideoRail.jsx` — the rail component (SWR + progress + click).
- `app/src/components/dashboard/DeskVideoRail.module.css` — rail styles.
- Test files alongside each.

**Modify**
- `app/src/pages/Dashboard.jsx` — render `<DeskVideoRail />` after `<CatalystTable />` (desktop + mobile).

---

### Task 1: `buildRail` — derive the ordered rail

**Files:**
- Create: `app/src/components/dashboard/buildRail.js`
- Test: `app/src/components/dashboard/buildRail.test.js`

**Interfaces:**
- Produces: `buildRail(categories, progress, cap = 12)` →
  `Array<{ video, list, index, pct, resume }>`.
  - `categories`: `[{ name, videos: [...] }]` (from the API).
  - `progress`: `{ [youtube_id]: { t, d, at, done } }` (from `videoProgress`).
  - Continue Watching first (in-progress, `!done`, `t >= 8`, newest by `at`), then
    Latest (everything else not `done`, newest by `created_at`), deduped by
    `youtube_id`, sliced to `cap`. `pct` is 0–100; `resume` true for the first group.

- [ ] **Step 1: Write the failing test**

```js
// app/src/components/dashboard/buildRail.test.js
import { describe, it, expect } from 'vitest'
import { buildRail } from './buildRail'

const cats = [
  { name: 'A', videos: [
    { id: 1, youtube_id: 'aaaaaaaaaaa', title: 'Alpha', created_at: 100 },
    { id: 2, youtube_id: 'bbbbbbbbbbb', title: 'Bravo', created_at: 300 },
  ] },
  { name: 'B', videos: [
    { id: 3, youtube_id: 'ccccccccccc', title: 'Charlie', created_at: 200 },
    { id: 4, youtube_id: 'ddddddddddd', title: 'Delta', created_at: 400 },
  ] },
]

describe('buildRail', () => {
  it('returns [] for no categories', () => {
    expect(buildRail([], {})).toEqual([])
  })

  it('orders latest by created_at desc when nothing is in progress', () => {
    const r = buildRail(cats, {})
    expect(r.map((i) => i.video.title)).toEqual(['Delta', 'Bravo', 'Charlie', 'Alpha'])
    expect(r.every((i) => i.resume === false)).toBe(true)
  })

  it('puts Continue Watching first (newest by at), then latest; dedups', () => {
    const progress = {
      aaaaaaaaaaa: { t: 30, d: 60, at: 999, done: false }, // Alpha in progress, newest
      ccccccccccc: { t: 15, d: 60, at: 500, done: false }, // Charlie in progress
    }
    const r = buildRail(cats, progress)
    expect(r.map((i) => i.video.title)).toEqual(['Alpha', 'Charlie', 'Delta', 'Bravo'])
    expect(r[0]).toMatchObject({ resume: true, pct: 50, index: 0 })
    expect(r[0].list).toBe(cats[0].videos) // carries its category list
    // no video appears twice
    expect(new Set(r.map((i) => i.video.youtube_id)).size).toBe(r.length)
  })

  it('excludes finished videos', () => {
    const progress = { ddddddddddd: { t: 60, d: 60, at: 999, done: true } }
    const r = buildRail(cats, progress)
    expect(r.map((i) => i.video.title)).not.toContain('Delta')
  })

  it('respects the cap', () => {
    expect(buildRail(cats, {}, 2)).toHaveLength(2)
  })

  it('ignores barely-started progress (<8s) for the resume group', () => {
    const r = buildRail(cats, { aaaaaaaaaaa: { t: 3, d: 60, at: 999, done: false } })
    expect(r[0].resume).toBe(false) // Alpha falls to latest, not resume
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/components/dashboard/buildRail.test.js`
Expected: FAIL — `Failed to resolve import './buildRail'`.

- [ ] **Step 3: Write the implementation**

```js
// app/src/components/dashboard/buildRail.js
// Pure derivation of the dashboard "From the Desk" rail from the education API
// payload + watch progress. Continue Watching (in-progress) first, then the
// newest videos. Mirrors VideosSection's Continue Watching rule (>= 8s, !done).
const MIN_RESUME = 8

export function buildRail(categories = [], progress = {}, cap = 12) {
  const cats = Array.isArray(categories) ? categories : []
  const seen = new Set()
  const resume = []

  // Pass 1 — in-progress (resume) videos, and mark finished ones as handled.
  for (const cat of cats) {
    const list = cat.videos || []
    list.forEach((video, index) => {
      const id = video.youtube_id
      if (!id || seen.has(id)) return
      const e = progress[id]
      if (e && e.done) { seen.add(id); return } // never surface finished videos
      if (e && (e.t || 0) >= MIN_RESUME) {
        seen.add(id)
        const pct = e.d ? Math.min(100, Math.round((e.t / e.d) * 100)) : 0
        resume.push({ video, list, index, pct, resume: true, _at: e.at || 0 })
      }
    })
  }
  resume.sort((a, b) => b._at - a._at)

  // Pass 2 — everything else, newest by created_at.
  const latest = []
  for (const cat of cats) {
    const list = cat.videos || []
    list.forEach((video, index) => {
      const id = video.youtube_id
      if (!id || seen.has(id)) return
      seen.add(id)
      latest.push({ video, list, index, pct: 0, resume: false, _ts: video.created_at || 0 })
    })
  }
  latest.sort((a, b) => b._ts - a._ts)

  return [...resume, ...latest]
    .slice(0, cap)
    .map(({ _at, _ts, ...item }) => item)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/components/dashboard/buildRail.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/components/dashboard/buildRail.js app/src/components/dashboard/buildRail.test.js
git commit -m "feat(dashboard): buildRail helper for the From the Desk video rail"
```

---

### Task 2: `DeskVideoRail` component + Dashboard wiring

**Files:**
- Create: `app/src/components/dashboard/DeskVideoRail.jsx`, `app/src/components/dashboard/DeskVideoRail.module.css`
- Test: `app/src/components/dashboard/DeskVideoRail.test.jsx`
- Modify: `app/src/pages/Dashboard.jsx`

**Interfaces:**
- Consumes: `buildRail` (Task 1); `videoProgress` (`subscribe`, `getSnapshot`, `hydrateFromServer`); `videoStore.play(list, index)`; `education/icons` (`GraduationIcon`, `PlayIcon`); SWR; `react-router-dom` `useNavigate`.
- Produces: default-exported `<DeskVideoRail />`. Renders `null` while loading, on error, or when empty.

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/components/dashboard/DeskVideoRail.test.jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const navigateSpy = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateSpy }))

let swrData
vi.mock('swr', () => ({ default: () => ({ data: swrData, error: undefined, isLoading: false }) }))

const playSpy = vi.fn()
vi.mock('../video/videoStore', () => ({ play: (...a) => playSpy(...a) }))

let progressData = {}
vi.mock('../../pages/desk/videoProgress', () => ({
  subscribe: () => () => {},
  getSnapshot: () => progressData,
  hydrateFromServer: () => {},
}))

import DeskVideoRail from './DeskVideoRail'

const CATS = [{ name: 'A', videos: [
  { id: 1, youtube_id: 'aaaaaaaaaaa', title: 'Alpha', created_at: 100 },
  { id: 2, youtube_id: 'bbbbbbbbbbb', title: 'Bravo', created_at: 200 },
] }]

beforeEach(() => {
  navigateSpy.mockClear(); playSpy.mockClear()
  progressData = {}; swrData = undefined
})

describe('DeskVideoRail', () => {
  it('renders nothing when there are no videos', () => {
    swrData = { categories: [], total: 0 }
    const { container } = render(<DeskVideoRail />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a Resume card first when something is in progress', () => {
    progressData = { aaaaaaaaaaa: { t: 30, d: 60, at: 999, done: false } }
    swrData = { categories: CATS, total: 2 }
    render(<DeskVideoRail />)
    const cards = screen.getAllByRole('button', { name: /Play / })
    expect(cards[0]).toHaveAccessibleName('Play Alpha')
    expect(screen.getByText('Resume')).toBeInTheDocument()
  })

  it('clicking a card plays it and navigates to the Desk', () => {
    swrData = { categories: CATS, total: 2 }
    render(<DeskVideoRail />)
    fireEvent.click(screen.getByLabelText('Play Bravo'))
    expect(playSpy).toHaveBeenCalledWith(CATS[0].videos, 1)
    expect(navigateSpy).toHaveBeenCalledWith('/desk?section=videos')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/components/dashboard/DeskVideoRail.test.jsx`
Expected: FAIL — `Failed to resolve import './DeskVideoRail'`.

- [ ] **Step 3: Write the component**

```jsx
// app/src/components/dashboard/DeskVideoRail.jsx
// "From the Desk" — a horizontal video rail on the Dashboard. Leads with the
// user's Continue Watching, fills with the newest videos. Clicking a card opens
// it in the persistent Desk player. Renders nothing when there's nothing to show.
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import useSWR from 'swr'
import { useNavigate } from 'react-router-dom'
import { subscribe, getSnapshot, hydrateFromServer } from '../../pages/desk/videoProgress'
import { play as playVideo } from '../video/videoStore'
import { GraduationIcon, PlayIcon } from '../../pages/education/icons'
import { buildRail } from './buildRail'
import styles from './DeskVideoRail.module.css'

const fetcher = (url) => fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))
const thumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

export default function DeskVideoRail() {
  const navigate = useNavigate()
  const { data, error, isLoading } = useSWR('/api/education/videos', fetcher)
  const progress = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => { hydrateFromServer() }, [])

  const items = useMemo(() => buildRail(data?.categories || [], progress), [data, progress])

  if (isLoading || error || items.length === 0) return null

  const open = (item) => {
    playVideo(item.list, item.index)
    navigate('/desk?section=videos')
  }

  return (
    <section className={styles.rail} aria-label="From the Desk videos">
      <div className={styles.head}>
        <span className={styles.headIcon} aria-hidden="true"><GraduationIcon size={18} /></span>
        <span className={styles.headTitle}>From the Desk</span>
        <button className={styles.viewAll} onClick={() => navigate('/desk?section=videos')}>
          View all →
        </button>
      </div>
      <div className={styles.scroll}>
        {items.map((item) => (
          <button
            key={item.video.youtube_id}
            className={styles.card}
            onClick={() => open(item)}
            aria-label={`Play ${item.video.title}`}
          >
            <span className={styles.thumbWrap}>
              <img className={styles.thumb} src={thumb(item.video.youtube_id)} alt="" loading="lazy" />
              <span className={styles.playOverlay} aria-hidden="true"><PlayIcon /></span>
              {item.resume && <span className={styles.resumePill}>Resume</span>}
              {item.pct > 0 && (
                <span className={styles.progressBar}>
                  <span className={styles.progressFill} style={{ width: `${item.pct}%` }} />
                </span>
              )}
            </span>
            <span className={styles.cardTitle}>{item.video.title}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Write the CSS module**

```css
/* app/src/components/dashboard/DeskVideoRail.module.css */
.rail {
  width: 100%;
  background: var(--bg-surface, #14160f);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  border-radius: 12px;
  padding: 12px 14px;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.headIcon {
  display: inline-flex;
}
.headTitle {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--text-primary, #f3efe2);
}
.viewAll {
  margin-left: auto;
  border: none;
  background: transparent;
  color: #c9a84c;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.scroll {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  scrollbar-width: none;
  padding-bottom: 2px;
}
.scroll::-webkit-scrollbar { display: none; }
.card {
  flex: 0 0 auto;
  width: 190px;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  text-align: left;
}
.thumbWrap {
  position: relative;
  display: block;
  width: 190px;
  aspect-ratio: 16 / 9;
  border-radius: 8px;
  overflow: hidden;
  background: #000;
}
.thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.playOverlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.card:hover .playOverlay {
  opacity: 1;
}
.resumePill {
  position: absolute;
  top: 6px;
  left: 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #0e0f0d;
  background: linear-gradient(135deg, #e6cf86, #c9a84c);
  border-radius: 999px;
  padding: 2px 7px;
}
.progressBar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background: rgba(255, 255, 255, 0.25);
}
.progressFill {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #e6cf86, #c9a84c);
}
.cardTitle {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.3;
  color: var(--text-primary, #f3efe2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```

- [ ] **Step 5: Run the component test to verify it passes**

Run: `cd app && npx vitest run src/components/dashboard/DeskVideoRail.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Wire it into the Dashboard**

In `app/src/pages/Dashboard.jsx`, add the import alongside the other tile imports (near the top, after the `CatalystTable` import):

```jsx
import DeskVideoRail from '../components/dashboard/DeskVideoRail'
```

Render it in the **desktop** layout right after `<CatalystTable />`:

```jsx
          <CatalystTable />
          <DeskVideoRail />
          <div className={styles.row2}>
```

And in the **mobile** layout right after the mobile `<CatalystTable />` (the one preceded by the `{/* 3. Catalysts / needs attention ... */}` comment):

```jsx
            <CatalystTable />
            <DeskVideoRail />
            {/* 4. Movers */}
```

- [ ] **Step 7: Run the full video/dashboard tests + build**

Run: `cd app && npx vitest run src/components/dashboard/`
Expected: PASS (buildRail + DeskVideoRail).

Run: `cd app && npm run build`
Expected: build succeeds (no missing-import errors).

- [ ] **Step 8: Commit**

```bash
git add app/src/components/dashboard/DeskVideoRail.jsx app/src/components/dashboard/DeskVideoRail.module.css app/src/components/dashboard/DeskVideoRail.test.jsx app/src/pages/Dashboard.jsx
git commit -m "feat(dashboard): From the Desk video rail under the Catalyst table"
```

---

## Manual verification checklist (user, in-browser)

After deploy, hard-refresh the dashboard:
1. A "From the Desk" rail appears right under the Catalyst table.
2. If you have in-progress videos, they show first with a "Resume" pill + progress bar.
3. The rest are the newest videos; finished videos don't appear.
4. Clicking a card jumps to `/desk?section=videos` and the video opens in the theater.
5. "View all →" goes to the Desk Videos section.
6. With an empty library (or while logged-out/non-paid), the rail simply doesn't render.

---

## Self-Review

**Spec coverage:**
- Rail component on the dashboard → Task 2.
- `buildRail` pure helper (Continue Watching + Latest, dedup, cap, pct) → Task 1.
- Reuse `/api/education/videos` SWR + `videoProgress`, no backend → Tasks 1–2.
- Continue Watching first, then Latest by `created_at` → Task 1 (tested).
- Click → `play(list, index)` + navigate to Desk → Task 2 (tested).
- Renders nothing on empty/error → Task 2 (tested).
- Placement after the Catalyst table (desktop + mobile) → Task 2 Step 6.
- Gold icons, no emoji → Task 2 (uses `GraduationIcon`/`PlayIcon`).

**Placeholder scan:** No TBD/TODO; all code and commands are concrete.

**Type consistency:** Item shape `{ video, list, index, pct, resume }` is produced by `buildRail` (Task 1) and consumed verbatim in `DeskVideoRail` (Task 2). `play(list, index)` matches `videoStore.play` from the persistent-player work. SWR/progress/navigate mocks in the Task 2 test match the component's import specifiers (`../video/videoStore`, `../../pages/desk/videoProgress`).
