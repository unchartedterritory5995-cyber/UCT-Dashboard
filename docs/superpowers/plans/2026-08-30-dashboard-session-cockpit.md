# Dashboard → Session Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/dashboard` from a 15-tile, 5.5–6.9-screen accumulator into a one-viewport session cockpit that renders a deliberate composition in every market session, including weekends.

**Architecture:** Four zones with declared height budgets (A/The Read 120px · B/The Decision 440px · C/Your Risk 300px · D/The Doors 90px) plus a 240px Movers rail. Zone B swaps its hero by market session. Seven duplicate previews collapse into signpost cards fed by one new aggregate endpoint. Enforced by a Playwright height rail and a vitest bare-child guard.

**Tech Stack:** React 18 + Vite + React Router · CSS Modules · SWR · vitest · FastAPI + SQLite · Playwright (`tools/mobile_audit.py`)

**Spec:** `docs/superpowers/specs/2026-08-30-dashboard-session-cockpit-design.md`

## Global Constraints

- **Worktree:** `.worktrees/dashboard-cockpit`, branch `feat/dashboard-session-cockpit`. All commands run from that directory.
- **Never `git add -A`.** Stage named paths only. Ship with `git push origin feat/dashboard-session-cockpit:master`; on conflict fetch → merge → re-verify → push. **Never force-push.**
- **Frontend tests run from `app/`:** `cd app && npx vitest run <path>`. Backend from repo root: `python -m pytest <path> -v`.
- **Canonical breakpoints are 640 and 1024 only.** Copy `@media` strings from `app/src/styles/breakpoints.css`. Never introduce a new literal. `Dashboard.module.css`'s existing `1440`/`1100`/`768` all get snapped in Task 12.
- **`--tap-min: 44px`** on every interactive element on touch.
- **Icons are `UIcon` names, never raw emoji** (`app/src/components/ui/UIcon.jsx`).
- **jsdom computes no layout.** Any assertion about rendered height MUST live in the Playwright harness, never in vitest. A vitest height assertion is vacuous.
- **Components that become "doors" are not deleted.** Remove the dashboard mount only; keep the file and its own route as rollback backup.
- **`/dashboard`'s path never changes** — it is hardcoded in 9 places.

---

## File Structure

| File | Responsibility |
|---|---|
| `app/src/components/Layout.jsx` | *Modify* — remove the impossible page-tracking guard |
| `app/src/components/Layout.pageTracking.test.jsx` | *Create* — rail proving the POST fires |
| `app/src/pages/Dashboard.jsx` | *Modify* — zone composition, session switch |
| `app/src/pages/Dashboard.module.css` | *Modify* — zone budgets, canonical breakpoints |
| `app/src/pages/dashboard/useSessionState.js` | *Create* — the 4-state session resolver |
| `app/src/pages/dashboard/ZoneRead.jsx` | *Create* — Zone A |
| `app/src/pages/dashboard/TheWeek.jsx` | *Create* — Zone B weekend hero |
| `app/src/pages/dashboard/ZoneDoors.jsx` | *Create* — Zone D signposts |
| `app/src/pages/dashboard/doors.js` | *Create* — the door manifest (single authority) |
| `app/src/components/MoversSidebar.jsx` | *Modify* — gains "On the tape" |
| `app/src/components/tiles/JournalSnapshotTile.jsx` | *Modify* — curve out, stops in |
| `app/src/pages/charts/LegacyRedirect.jsx` | *Modify* — seed a themes widget |
| `app/src/components/NavBar.jsx` | *Modify* — Flow Scoreboard entry; then 4 groups |
| `api/routers/dashboard_signposts.py` | *Create* — `GET /api/dashboard/signposts` |
| `tools/mobile_audit.py` | *Modify* — desktop viewport + vertical budget |

---

# PHASE 0 — Instrument

Unblocks the evidence for every later decision. Independent of all other phases.

### Task 1: Make page tracking actually fire

**Files:**
- Modify: `app/src/components/Layout.jsx:15-33`
- Test: `app/src/components/Layout.pageTracking.test.jsx` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: rows in `page_views`, readable via `GET /api/auth/admin/analytics?days=N`. No exported symbols.

**Context the implementer needs:** `usePageTracking()` guards on `document.cookie.includes('uct_session')`. That cookie is set `httponly=True` in `api/routers/auth.py:1657`, so JavaScript cannot read it — `document.cookie` is `""` on the live logged-in app. The guard can never pass. `POST /api/auth/track` already requires auth (`Depends(get_current_user)`), so an anonymous call 401s harmlessly. Delete the guard; do not replace it with another cookie check.

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/components/Layout.pageTracking.test.jsx
//
// The tracking chain shipped complete — hook, endpoint, service, table,
// 3 indexes, 4 read queries, Admin UI — and recorded zero rows for its
// whole life, because the hook gated on `document.cookie` while the
// session cookie is HttpOnly. jsdom's document.cookie is "" by default,
// which is exactly production's value. This rail asserts the POST fires
// under that condition.
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, test, expect, beforeEach, afterEach } from 'vitest'
import Layout from './Layout'

vi.mock('./NavBar', () => ({ default: () => null }))
vi.mock('./MobileNav', () => ({ default: () => null }))
vi.mock('./FeedbackWidget', () => ({ default: () => null }))
vi.mock('./mobile/MobileTabBar', () => ({ default: () => null }))
vi.mock('./mobile/MoreSheet', () => ({ default: () => null }))
vi.mock('./mobile/TickerHubSheet', () => ({ default: () => null }))
vi.mock('../hooks/usePreferences', () => ({ default: () => ({ prefs: {} }) }))
vi.mock('../lib/barsPackClient', () => ({ initBarsPack: () => {} }))

beforeEach(() => { global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => ({}) })) })
afterEach(() => { vi.restoreAllMocks() })

test('posts a page view even though document.cookie is empty (HttpOnly session)', async () => {
  expect(document.cookie).toBe('')          // control: matches production
  render(<MemoryRouter initialEntries={['/dashboard']}><Layout /></MemoryRouter>)
  await waitFor(() => {
    const calls = global.fetch.mock.calls.filter(c => c[0] === '/api/auth/track')
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0][1].body)).toEqual({ page: '/dashboard' })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```
cd app && npx vitest run src/components/Layout.pageTracking.test.jsx
```

Expected: FAIL — `expect(calls).toHaveLength(1)` receives `0`. That zero is the production bug reproduced.

- [ ] **Step 3: Delete the impossible guard**

In `app/src/components/Layout.jsx`, remove these two lines from `usePageTracking`:

```js
    // Only track if user has a session cookie (logged in)
    if (!document.cookie.includes('uct_session')) return
```

Replace them with:

```js
    // ⛔ DO NOT reinstate a `document.cookie` check here. `uct_session` is
    // set httponly=True (api/routers/auth.py:1657), so JS can never see it
    // and this hook recorded ZERO rows for its entire life. The endpoint
    // already requires auth (Depends(get_current_user)); an anonymous call
    // 401s and costs nothing. Guard on auth state or not at all.
```

- [ ] **Step 4: Run it and watch it pass**

```
cd app && npx vitest run src/components/Layout.pageTracking.test.jsx
```

Expected: PASS.

- [ ] **Step 5: Prove the rail discriminates**

Temporarily re-add the deleted `if (!document.cookie...) return` line, re-run, and confirm the test goes RED. Then remove it again and confirm GREEN. A rail that cannot fail is not a rail.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/Layout.jsx app/src/components/Layout.pageTracking.test.jsx
git commit -m "fix: page tracking gated on an HttpOnly cookie it could never read

usePageTracking() early-returned on document.cookie.includes('uct_session'),
but uct_session is set httponly=True, so document.cookie is \"\" on the live
logged-in app. The POST never fired. page_views has no rows and
GET /api/auth/admin/analytics returns [] for 30d and 90d.

Every other layer was already correct: endpoint, service, table, 3 indexes,
4 read queries, Admin engagement UI."
```

---

# PHASE 1 — Repair

Fixes the four measured defects. **Nothing moves.** The page halves in length so that Phase 3 is designed against a page that renders as intended.

### Task 2: Height-budget rail in the Playwright harness

**Files:**
- Modify: `tools/mobile_audit.py:32-48` (VIEWPORTS, route lists), `:50-90` (probe JS), `:205-225` (report loop)

**Interfaces:**
- Consumes: nothing.
- Produces: `--check-height` CLI flag; `report.json` entries gain `scrollHeight`, `viewportHeight`, `screens`, `heightFlag`.

**Context:** `tools/mobile_audit.py` already boots Chromium, logs in via `page.request.post('/api/auth/login')`, dismisses the intro overlay, and runs a JS probe per route measuring `overflowX`. It has no desktop viewport and measures no vertical budget. jsdom cannot do this — the assertion must live here.

- [ ] **Step 1: Add the desktop viewport**

In `tools/mobile_audit.py`, add to the `VIEWPORTS` dict:

```python
    "desktop": {"width": 1280, "height": 1000, "deviceScaleFactor": 1, "isMobile": False},
```

- [ ] **Step 2: Extend the probe to measure vertical budget**

In the probe JS string, before the closing `return {`, add:

```js
  // The dashboard's scroll container is the flex child, not <html>.
  const sc = document.querySelector('[class*="_content_"]') || de;
  const scrollHeight = sc.scrollHeight;
  const viewportHeight = window.innerHeight;
```

and extend the returned object with:

```js
  scrollHeight, viewportHeight, screens: +(scrollHeight / viewportHeight).toFixed(2),
```

- [ ] **Step 3: Add the budget assertion to the report loop**

After the existing `flag = "OVERFLOW" if ... else "ok"` line:

```python
                    # Vertical budget: /dashboard must fit one viewport.
                    # Baseline measured 2026-08-30: 5.5 screens at 2133x1050,
                    # 6.9 at 1277x1000. Target after Phase 3: <= 1.05.
                    budget = HEIGHT_BUDGETS.get(route)
                    hflag = "ok"
                    if budget is not None and probe.get("screens", 0) > budget:
                        hflag = "OVER_BUDGET"
                        entry["heightFlag"] = hflag
                    print(f"[{vp_name:8}] {route:24} {flag:9} {hflag:12} "
                          f"screens={probe.get('screens')}")
```

and near the top of the file, beside `VIEWPORTS`:

```python
# Vertical budget in "screens" per route. A route absent from this map is
# not budgeted. /dashboard's budget is the whole point of the cockpit
# redesign — it must fit one viewport with a 5% tolerance for gaps.
HEIGHT_BUDGETS = {"/dashboard": 1.05}
```

- [ ] **Step 4: Run it against the CURRENT page and confirm it FAILS**

```
python tools/mobile_audit.py --base https://uctintelligence.com --auth --viewport desktop --routes /dashboard
```

Expected: `OVER_BUDGET screens=5.5` (or similar >5). **This failing run is the deliverable** — it reproduces the defect before any fix.

- [ ] **Step 5: Commit**

```bash
git add tools/mobile_audit.py
git commit -m "test: vertical height budget rail for /dashboard

Adds a desktop viewport and a screens-of-scroll assertion to the Playwright
harness. jsdom computes no layout, so this cannot live in vitest.
Currently RED at 5.5 screens against a 1.05 budget — as intended."
```

### Task 3: Fix the Sector Rotation void

**Files:**
- Modify: `app/src/pages/Dashboard.jsx` (the bare `<SectorRotation />` mount)
- Test: `app/src/pages/Dashboard.zones.test.jsx` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing exported. Establishes the invariant "no tile is a bare child of `.desktopOnly`".

**Context:** `TileCard.module.css` sets `.tile { height: 100%; display: flex; flex-direction: column }` and `.body { flex: 1 }`. Every tile except one is rendered inside a grid row whose track supplies the height. `<SectorRotation />` is a bare child of `.desktopOnly` (`display: block; height: auto`), so `height: 100%` has nothing to resolve against and `.body`'s `flex: 1` expands. Measured: tile 3,081px, body 3,037px, content 323px, void 2,714px.

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/pages/Dashboard.zones.test.jsx
//
// ⛔ THE INVARIANT: no dashboard tile may be a bare child of the desktop
// container. TileCard sets height:100%, which needs a parent whose height
// is defined. `.desktopOnly` is display:block/height:auto, so a bare tile
// child expands without limit — SectorRotation did exactly this and ate
// 2,714px (47% of the page). jsdom computes no layout, so this rail asserts
// STRUCTURE, not pixels; the pixel rail lives in tools/mobile_audit.py.
import { readFileSync } from 'node:fs'
import { test, expect } from 'vitest'

const src = readFileSync(new URL('./Dashboard.jsx', import.meta.url), 'utf8')

test('no tile component is rendered as a bare child of desktopOnly', () => {
  const block = src.split('styles.desktopOnly')[1]?.split('styles.mobileOnly')[0] ?? ''
  // A bare self-closing component at the container's own indent level (10
  // spaces inside .desktopOnly) is the defect shape.
  const bare = [...block.matchAll(/^ {10}<([A-Z]\w+)\s*\/>/gm)].map(m => m[1])
  expect(bare).toEqual([])
})
```

- [ ] **Step 2: Run it and watch it fail**

```
cd app && npx vitest run src/pages/Dashboard.zones.test.jsx
```

Expected: FAIL — `expect([]).toEqual([])` receives `["SectorRotation", "DeskVideoRail", "CompassTodayTile"]` (the exact set is whatever is currently bare; SectorRotation is the one that measurably expands).

- [ ] **Step 3: Wrap the bare mounts**

In `app/src/pages/Dashboard.jsx`, replace:

```jsx
          {/* Sector rotation — SPDR sectors ranked strongest→weakest */}
          <SectorRotation />
```

with:

```jsx
          {/* Sector rotation — SPDR sectors ranked strongest→weakest.
              ⛔ MUST stay wrapped. TileCard is height:100%, and .desktopOnly
              is display:block/height:auto — a bare mount here resolved that
              100% against nothing and expanded to 3,081px around a 323px
              list. Rail: Dashboard.zones.test.jsx */}
          <div className={styles.rowSector}>
            <SectorRotation />
          </div>
```

Apply the same wrapper treatment to any other bare mount the test reported, using `styles.rowFull`.

- [ ] **Step 4: Add the row classes**

In `app/src/pages/Dashboard.module.css`, after `.rowD`:

```css
/* Bare tiles have no grid track to resolve TileCard's height:100% against.
   These wrappers supply one. See Dashboard.zones.test.jsx. */
.rowSector { display: grid; grid-template-columns: 1fr; max-height: 420px; }
.rowFull   { display: grid; grid-template-columns: 1fr; }
```

- [ ] **Step 5: Run both rails**

```
cd app && npx vitest run src/pages/Dashboard.zones.test.jsx
python tools/mobile_audit.py --base https://uctintelligence.com --auth --viewport desktop --routes /dashboard
```

Expected: vitest PASS. The Playwright run still reports `OVER_BUDGET` but `screens` must drop from ~5.5 to ~2.6. **Record the new number** — it is Task 5's baseline.

- [ ] **Step 6: Commit**

```bash
git add app/src/pages/Dashboard.jsx app/src/pages/Dashboard.module.css app/src/pages/Dashboard.zones.test.jsx
git commit -m "fix: SectorRotation expanded to 3081px around a 323px list

It was the only tile rendered as a bare child of .desktopOnly, which is
display:block/height:auto, so TileCard's height:100% had no track to resolve
against and .body's flex:1 took 2,714px — 47% of the page's scroll length."
```

### Task 4: Cap the glance row and balance the hero row

**Files:**
- Modify: `app/src/pages/Dashboard.module.css` (`.rowB`, `.rowC`, `.hero`)

**Interfaces:**
- Consumes: nothing. Produces: nothing exported.

**Context:** `.rowC` uses `align-items: stretch` with no cap, so all four tiles inherit UCT 20's 20-row height (908px at 2133, 1,424px at 1277). `.rowB` gives the hero `7fr` while it renders 221px beside a 1,070px rail — an 849px dead column on any session where catalysts are thin.

- [ ] **Step 1: Cap the glance row**

Replace the `.rowC` block in `app/src/pages/Dashboard.module.css`:

```css
/* ⛔ max-height is load-bearing. Without it, align-items:stretch matches
   every tile to the tallest sibling (UCT 20's 20 rows) and a two-line
   exposure reading gets 908px. Tiles scroll inside the row instead. */
.rowC {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-md);
  align-items: stretch;
  max-height: 340px;
}
.rowC > * { min-height: 0; }
```

- [ ] **Step 2: Stop the hero column collapsing**

Replace the `.hero` block:

```css
/* min-height keeps the hero from leaving an 849px dead column beside the
   1,070px rail when the catalyst set is thin or the session is closed. */
.hero {
  min-height: 420px;
  max-height: 680px;
  overflow-y: auto;
  border-radius: var(--radius-xl, 14px);
}
```

- [ ] **Step 3: Re-measure**

```
python tools/mobile_audit.py --base https://uctintelligence.com --auth --viewport desktop --routes /dashboard
```

Expected: `screens` drops again. Record it.

- [ ] **Step 4: Commit**

```bash
git add app/src/pages/Dashboard.module.css
git commit -m "fix: cap the glance row and floor the hero column

.rowC had align-items:stretch with no cap, so all four tiles inherited UCT
20's 20-row height (908px at 2133, 1424px at 1277). .hero rendered 221px
beside a 1,070px rail, leaving an 849px dead column."
```

### Task 5: Stop the AI Search orb overlapping content

**Files:**
- Modify: `app/src/components/voice/` orb styles — locate with `cd app && grep -rl "_orb_" src/`
- Test: extend `tools/mobile_audit.py` probe

**Interfaces:**
- Consumes: nothing. Produces: probe field `orbOverlap` (boolean).

**Context:** The orb is `position: fixed`, horizontally centred over the content column. Measured: it covers the IWM index box at 2133px and the "Quote of the Day" heading at 1277px. `document.elementsFromPoint(760, 45)` returns `[circle, svg, SPAN._wrap_, BUTTON._orb_ _idle_]`.

- [ ] **Step 1: Add an overlap probe**

In the `tools/mobile_audit.py` probe JS, before the return:

```js
  // The AI orb is fixed and centred; if it sits on top of page content the
  // topmost element at its centre is not the orb's own subtree.
  const orb = document.querySelector('[class*="_orb_"]');
  let orbOverlap = false;
  if (orb) {
    const r = orb.getBoundingClientRect();
    const under = document.elementsFromPoint(r.left + r.width / 2, r.bottom + 4);
    orbOverlap = under.some(el => el.closest('[class*="_content_"]'));
  }
```

Add `orbOverlap,` to the returned object.

- [ ] **Step 2: Run and confirm it reports true**

```
python tools/mobile_audit.py --base https://uctintelligence.com --auth --viewport desktop --routes /dashboard
```

Expected: `orbOverlap: true` in `report.json`.

- [ ] **Step 3: Move the orb out of the content column**

In the orb's CSS module, change its horizontal anchoring from centred to right-anchored, clear of the content column:

```css
/* ⛔ Was horizontally centred, which parked it on top of whatever sat at
   top-centre — the IWM index box at 2133px, the Quote of the Day heading at
   1277px. Anchor right so it can never collide with the content column. */
  left: auto;
  right: var(--space-lg);
  transform: none;
```

- [ ] **Step 4: Re-run and confirm `orbOverlap: false`**

```
python tools/mobile_audit.py --base https://uctintelligence.com --auth --viewport desktop --routes /dashboard
```

- [ ] **Step 5: Commit**

```bash
git add app/src/components/voice tools/mobile_audit.py
git commit -m "fix: AI orb was fixed-centred over the content column

It covered the IWM index box at 2133px and the Quote of the Day heading at
1277px. Right-anchored, plus an orbOverlap probe in the audit harness."
```

---

# PHASE 2 — Rehome the three orphans

**Prerequisite for Phase 3.** Each of these features loses its only path when its dashboard tile becomes a door.

### Task 6: Fix the Theme Tracker broken door

**Files:**
- Modify: `app/src/pages/charts/LegacyRedirect.jsx`
- Test: `app/src/pages/charts/LegacyRedirect.themes.test.jsx` (create)

**Interfaces:**
- Consumes: `usePreferences('charts_workspace_layout')`.
- Produces: navigating `/theme-tracker` yields a workspace containing a `themes` widget.

**Context:** Theme Tracker is not missing — it is reachable as the `themes` widget type inside `/charts`. But `/theme-tracker` redirects to *bare* `/charts`, which shows it only if the member's saved `charts_workspace_layout` already contains that widget. For most members it silently shows a workspace without it.

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/pages/charts/LegacyRedirect.themes.test.jsx
//
// /theme-tracker used to land on bare /charts. If the member's saved
// workspace had no themes widget, the door opened onto a room that did not
// contain the thing they asked for. This rail asserts the redirect carries
// an intent the workspace can honour.
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { test, expect } from 'vitest'
import LegacyRedirect from './LegacyRedirect'

test('/theme-tracker redirects to /charts asking for the themes widget', () => {
  render(
    <MemoryRouter initialEntries={['/theme-tracker']}>
      <Routes>
        <Route path="/theme-tracker" element={<LegacyRedirect />} />
        <Route path="/charts" element={<div data-testid="dest">{window.location.search}</div>} />
      </Routes>
    </MemoryRouter>,
  )
  expect(screen.getByTestId('dest')).toBeTruthy()
})

test('the redirect preserves an explicit widget intent', () => {
  // LegacyRedirect must map /theme-tracker -> /charts?ensure=themes
  const src = new URL('./LegacyRedirect.jsx', import.meta.url)
  expect(require('node:fs').readFileSync(src, 'utf8')).toContain('ensure=themes')
})
```

- [ ] **Step 2: Run and watch the second test fail**

```
cd app && npx vitest run src/pages/charts/LegacyRedirect.themes.test.jsx
```

Expected: FAIL — `ensure=themes` not found.

- [ ] **Step 3: Carry the intent through the redirect**

In `app/src/pages/charts/LegacyRedirect.jsx`, replace the return with:

```jsx
export default function LegacyRedirect() {
  const { pathname, search } = useLocation()
  const params = new URLSearchParams(search)
  params.delete('tab')
  // ⛔ /theme-tracker must not land on a bare workspace. Theme Tracker is
  // reachable ONLY as the `themes` widget, so the door has to say which
  // room it wants; ChartsWorkspace seeds it when absent.
  if (pathname.startsWith('/theme-tracker')) params.set('ensure', 'themes')
  if (pathname.startsWith('/watchlists')) params.set('ensure', 'watchlist')
  const qs = params.toString()
  return <Navigate to={qs ? `/charts?${qs}` : '/charts'} replace />
}
```

- [ ] **Step 4: Honour `ensure` in the workspace**

In `app/src/pages/charts/ChartsWorkspace.jsx`, after the saved layout loads, add:

```jsx
  // Seed the requested widget when a legacy door asked for one and the
  // member's saved layout doesn't have it. Idempotent: never adds twice.
  useEffect(() => {
    const want = new URLSearchParams(location.search).get('ensure')
    if (!want) return
    if (widgets.some(w => w.type === want)) return
    addWidget(want)
  }, [location.search, widgets, addWidget])
```

- [ ] **Step 5: Run tests**

```
cd app && npx vitest run src/pages/charts/
```

Expected: PASS, and no existing ChartsWorkspace test regresses.

- [ ] **Step 6: Commit**

```bash
git add app/src/pages/charts/LegacyRedirect.jsx app/src/pages/charts/ChartsWorkspace.jsx app/src/pages/charts/LegacyRedirect.themes.test.jsx
git commit -m "fix: /theme-tracker landed on a workspace that may not contain themes

Theme Tracker exists only as the \`themes\` widget inside /charts, but the
legacy redirect dropped members on bare /charts. The door now names the room
and the workspace seeds the widget when the saved layout lacks it."
```

### Task 7: Give Flow Scoreboard a nav entry

**Files:**
- Modify: `app/src/components/NavBar.jsx:14-29`, `app/src/components/mobile/MoreSheet.jsx`
- Test: `app/src/components/NavBar.test.jsx` (extend)

**Interfaces:**
- Consumes: nothing. Produces: `/flow-scoreboard` present in `NAV_ITEMS`.

**Context:** `/flow-scoreboard` is a live, working route restored on 2026-08-09 and railed by `app/src/routes/lostDoors.route.test.jsx`. It has never had a nav entry — the dashboard tile is its only discoverable path.

- [ ] **Step 1: Write the failing test**

Append to `app/src/components/NavBar.test.jsx`:

```jsx
test('Flow Scoreboard is reachable from the nav, not only from a dashboard tile', () => {
  const src = readFileSync(new URL('./NavBar.jsx', import.meta.url), 'utf8')
  expect(src).toContain("to: '/flow-scoreboard'")
})
```

Add `import { readFileSync } from 'node:fs'` at the top if absent.

- [ ] **Step 2: Run and watch it fail**

```
cd app && npx vitest run src/components/NavBar.test.jsx
```

Expected: FAIL.

- [ ] **Step 3: Add the entry**

In `app/src/components/NavBar.jsx`, after the `/options-flow` line:

```jsx
  { to: '/flow-scoreboard', label: 'Flow Record',  icon: 'star' },
```

Add the same entry to `MoreSheet.jsx`'s item list.

- [ ] **Step 4: Run tests**

```
cd app && npx vitest run src/components/NavBar.test.jsx src/routes/lostDoors.route.test.jsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/NavBar.jsx app/src/components/mobile/MoreSheet.jsx app/src/components/NavBar.test.jsx
git commit -m "feat: Flow Scoreboard gets a nav entry

The route has been live since 2026-08-09 with a dashboard tile as its only
discoverable path. That tile becomes a door in Phase 3."
```

### Task 8: Absorb the tape into the Movers rail

**Files:**
- Modify: `app/src/components/MoversSidebar.jsx:120-140`, `app/src/components/MoversSidebar.module.css`
- Test: `app/src/components/MoversSidebar.test.jsx` (extend)

**Interfaces:**
- Consumes: `useTapeFeed` from `app/src/hooks/useTapeFeed.js`.
- Produces: an "ON THE TAPE" section inside `MoversSidebar`.

**Context:** `MoversSidebar` today renders exactly two `MoverSection`s, `RIPPING` and `DRILLING`. CLAUDE.md's claim that it already has an "ON THE TAPE" section is **stale — it does not**. `TapeFeed` has no route of its own, so this is its rehoming. `useTapeFeed` already exists.

- [ ] **Step 1: Write the failing test**

Append to `app/src/components/MoversSidebar.test.jsx`:

```jsx
test('renders an On the Tape section so TapeFeed has a home', async () => {
  render(<MoversSidebar propData={{ ripping: [], drilling: [] }} />)
  expect(await screen.findByText(/ON THE TAPE/i)).toBeTruthy()
})
```

- [ ] **Step 2: Run and watch it fail**

```
cd app && npx vitest run src/components/MoversSidebar.test.jsx
```

Expected: FAIL — text not found.

- [ ] **Step 3: Add the section**

In `app/src/components/MoversSidebar.jsx`, import the hook and render the section after `DRILLING`:

```jsx
import useTapeFeed from '../hooks/useTapeFeed'
```

```jsx
                <MoverSection label="DRILLING" items={data.drilling ?? []} positive={false} tweetCounts={tweetCounts} />
                {/* TapeFeed has no route of its own; the rail is its home. */}
                <div className={styles.tapeSection}>
                  <span className={styles.tapeLabel}>ON THE TAPE</span>
                  <TapeList items={tape ?? []} />
                </div>
```

with `const { tape } = useTapeFeed()` in the component body, and a small `TapeList` that maps items to rows using the existing row styles.

- [ ] **Step 4: Add the styles**

```css
.tapeSection { display: flex; flex-direction: column; gap: 6px; padding-top: 10px; border-top: 1px solid var(--border); }
.tapeLabel { font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 1.5px; color: var(--text-muted); }
```

- [ ] **Step 5: Run tests**

```
cd app && npx vitest run src/components/MoversSidebar.test.jsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/MoversSidebar.jsx app/src/components/MoversSidebar.module.css app/src/components/MoversSidebar.test.jsx
git commit -m "feat: Movers rail absorbs the tape feed

TapeFeed had no route of its own, so its dashboard tile was its only home.
(CLAUDE.md claimed MoversSidebar already had this section; it did not.)"
```

---

# PHASE 3 — Restructure

### Task 9: The session-state resolver

**Files:**
- Create: `app/src/pages/dashboard/useSessionState.js`
- Test: `app/src/pages/dashboard/useSessionState.test.js` (create)

**Interfaces:**
- Consumes: nothing (pure function of a `Date`).
- Produces: `export function resolveSession(date): 'PREMARKET' | 'LIVE' | 'CLOSED' | 'WEEKEND'` and `export default function useSessionState(): string`.

**Context:** `app/src/hooks/useMarketOpen.js` returns `{isOpen, isPremarket, isExtended}` and does **not** expose weekend-ness. Do not modify it — other consumers depend on its shape. Write a sibling that derives all four states.

- [ ] **Step 1: Write the failing test**

```js
// app/src/pages/dashboard/useSessionState.test.js
import { test, expect } from 'vitest'
import { resolveSession } from './useSessionState'

const et = (s) => new Date(`${s} GMT-0400`)   // EDT

test('weekend', () => {
  expect(resolveSession(et('2026-08-29 11:00'))).toBe('WEEKEND')  // Sat
  expect(resolveSession(et('2026-08-30 11:00'))).toBe('WEEKEND')  // Sun
})
test('premarket', () => {
  expect(resolveSession(et('2026-08-28 07:30'))).toBe('PREMARKET')
})
test('live', () => {
  expect(resolveSession(et('2026-08-28 11:00'))).toBe('LIVE')
})
test('closed weekday', () => {
  expect(resolveSession(et('2026-08-28 18:00'))).toBe('CLOSED')
  expect(resolveSession(et('2026-08-28 03:00'))).toBe('CLOSED')
})
```

- [ ] **Step 2: Run and watch it fail**

```
cd app && npx vitest run src/pages/dashboard/useSessionState.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// app/src/pages/dashboard/useSessionState.js
import { useState, useEffect } from 'react'

/**
 * The dashboard's four composition states. Only Zone B varies by state.
 *
 * ⛔ Deliberately NOT an extension of useMarketOpen(): that hook's
 * {isOpen, isPremarket, isExtended} shape has other consumers, and it
 * cannot express WEEKEND, which is the state this redesign exists to serve.
 */
export function resolveSession(date = new Date()) {
  const et = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const day = et.getDay()
  if (day === 0 || day === 6) return 'WEEKEND'
  const mins = et.getHours() * 60 + et.getMinutes()
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return 'PREMARKET'
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return 'LIVE'
  return 'CLOSED'
}

export default function useSessionState() {
  const [s, setS] = useState(() => resolveSession())
  useEffect(() => {
    const id = setInterval(() => setS(resolveSession()), 60_000)
    return () => clearInterval(id)
  }, [])
  return s
}
```

- [ ] **Step 4: Run and confirm PASS**

```
cd app && npx vitest run src/pages/dashboard/useSessionState.test.js
```

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/dashboard/useSessionState.js app/src/pages/dashboard/useSessionState.test.js
git commit -m "feat: four-state session resolver for the dashboard"
```

### Task 10: The door manifest and the signposts endpoint

**Files:**
- Create: `app/src/pages/dashboard/doors.js`, `api/routers/dashboard_signposts.py`
- Modify: `api/main.py` (include the router)
- Test: `app/src/pages/dashboard/doors.test.js`, `tests/test_dashboard_signposts.py`

**Interfaces:**
- Consumes: existing cached services.
- Produces: JS `export const DOORS = [{ key, label, to, icon }]` (8 entries) and `GET /api/dashboard/signposts → { <key>: { label, value, tone } }` keyed by the same 8 `key`s.

**Context:** Zone D replaces seven preview tiles with eight signpost cards. The manifest is the single authority for what the doors are; the endpoint is keyed by it. Repo rule: derive, never restate — the test asserts the two agree rather than hardcoding a list twice.

- [ ] **Step 1: Write the failing frontend test**

```js
// app/src/pages/dashboard/doors.test.js
import { test, expect } from 'vitest'
import { DOORS } from './doors'

test('every door has a key, label, route and icon', () => {
  expect(DOORS.length).toBe(8)
  for (const d of DOORS) {
    expect(d.key).toMatch(/^[a-z_]+$/)
    expect(d.to.startsWith('/')).toBe(true)
    expect(d.label.length).toBeGreaterThan(0)
    expect(d.icon.length).toBeGreaterThan(0)
  }
})

test('door keys are unique', () => {
  expect(new Set(DOORS.map(d => d.key)).size).toBe(DOORS.length)
})
```

- [ ] **Step 2: Run and watch it fail**

```
cd app && npx vitest run src/pages/dashboard/doors.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the manifest**

```js
// app/src/pages/dashboard/doors.js
//
// ⭐ THE SINGLE AUTHORITY for Zone D. The backend signposts endpoint is
// keyed by these `key`s and the route test resolves these `to`s against the
// real route table. Do not restate this list anywhere.
export const DOORS = [
  { key: 'breadth',      label: 'Breadth',       to: '/breadth',         icon: 'breadth' },
  { key: 'options_flow', label: 'Options Flow',  to: '/options-flow',    icon: 'flow' },
  { key: 'uct20',        label: 'UCT 20',        to: '/uct-20',          icon: 'star' },
  { key: 'calendar',     label: 'Calendar',      to: '/calendar',        icon: 'calendar' },
  { key: 'screener',     label: 'Screener',      to: '/screener',        icon: 'screener' },
  { key: 'desk',         label: 'The Desk',      to: '/desk',            icon: 'desk' },
  { key: 'journal',      label: 'Journal',       to: '/journal',         icon: 'journal' },
  { key: 'community',    label: 'Community',     to: '/community',       icon: 'community' },
]
```

- [ ] **Step 4: Write the failing backend test**

```python
# tests/test_dashboard_signposts.py
"""The signposts endpoint is keyed by the frontend door manifest. If the two
drift, Zone D renders cards with no numbers — a silent, plausible failure."""
import json, pathlib, re
from fastapi.testclient import TestClient
from api.main import app

DOORS_JS = pathlib.Path("app/src/pages/dashboard/doors.js")


def _door_keys() -> set[str]:
    src = DOORS_JS.read_text(encoding="utf-8")
    return set(re.findall(r"key:\s*'([a-z_]+)'", src))


def test_signposts_covers_every_door():
    client = TestClient(app)
    r = client.get("/api/dashboard/signposts")
    assert r.status_code in (200, 401)
    if r.status_code == 200:
        assert set(r.json().keys()) == _door_keys()


def test_door_manifest_is_not_empty():
    assert len(_door_keys()) == 8
```

- [ ] **Step 5: Run and watch it fail**

```
python -m pytest tests/test_dashboard_signposts.py -v
```

Expected: FAIL — 404, so `status_code in (200, 401)` is False.

- [ ] **Step 6: Implement the endpoint**

```python
# api/routers/dashboard_signposts.py
"""One aggregate behind Zone D's eight signpost cards.

⛔ Reads ONLY already-cached services. Zone D exists to replace ~4,000px of
preview tiles with ~90px of links-with-numbers; if it costs eight fetches it
has not replaced anything.
"""
from fastapi import APIRouter, Depends
from api.middleware.auth_middleware import get_current_user
from api.services import cache

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

_TTL = 60


def _card(label: str, value, tone: str = "neutral") -> dict:
    return {"label": label, "value": value, "tone": tone}


@router.get("/signposts")
def signposts(user: dict = Depends(get_current_user)) -> dict:
    cached = cache.get("dashboard_signposts")
    if cached is not None:
        return cached

    out: dict[str, dict] = {}
    # Each block is best-effort: a signpost with no number renders as a plain
    # link, never as an error. `.catch(() => null)` renders failure as fact.
    try:
        from api.services import engine
        b = engine.get_breadth() or {}
        out["breadth"] = _card("Exposure", (b.get("exposure") or {}).get("score"))
    except Exception:
        out["breadth"] = _card("Exposure", None)

    for key, label in (
        ("options_flow", "Today"), ("uct20", "This week"), ("calendar", "On deck"),
        ("screener", "Matches"), ("desk", "New"), ("journal", "Open"),
        ("community", "Unread"),
    ):
        out[key] = _card(label, None)

    cache.set("dashboard_signposts", out, ttl=_TTL)
    return out
```

Register it in `api/main.py` beside the other routers:

```python
from api.routers import dashboard_signposts
app.include_router(dashboard_signposts.router)
```

- [ ] **Step 7: Run both suites**

```
python -m pytest tests/test_dashboard_signposts.py -v
cd app && npx vitest run src/pages/dashboard/doors.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/src/pages/dashboard/doors.js app/src/pages/dashboard/doors.test.js api/routers/dashboard_signposts.py api/main.py tests/test_dashboard_signposts.py
git commit -m "feat: door manifest + signposts aggregate for Zone D

One authority for the eight doors; one 60s-cached endpoint keyed by it, so
Zone D costs one request instead of eight."
```

### Task 11: Zone D and door-integrity

**Files:**
- Create: `app/src/pages/dashboard/ZoneDoors.jsx`, `.module.css`
- Test: `app/src/pages/dashboard/ZoneDoors.route.test.jsx`

**Interfaces:**
- Consumes: `DOORS` from `./doors`, `GET /api/dashboard/signposts`.
- Produces: `export default function ZoneDoors()`.

**Context:** Follow `app/src/routes/lostDoors.route.test.jsx`'s idiom — render the real `App` at the href the component itself produced, never a typed URL. That file's own header explains why: a component test stays green for the entire time no route reaches it.

- [ ] **Step 1: Write the failing route test**

```jsx
// app/src/pages/dashboard/ZoneDoors.route.test.jsx
//
// ⭐ Reads the hrefs ZoneDoors ITSELF renders and resolves them against the
// real route table. The component is the authority; this test is a reader.
// See app/src/routes/lostDoors.route.test.jsx for why a component test alone
// cannot be the rail for a door.
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { test, expect, vi } from 'vitest'
import ZoneDoors from './ZoneDoors'
import { DOORS } from './doors'

vi.mock('swr', () => ({ default: () => ({ data: {} }) }))

test('renders one link per door, each pointing at its manifest route', () => {
  render(<MemoryRouter><ZoneDoors /></MemoryRouter>)
  const hrefs = screen.getAllByRole('link').map(a => a.getAttribute('href'))
  expect(hrefs.sort()).toEqual(DOORS.map(d => d.to).sort())
})
```

- [ ] **Step 2: Run and watch it fail**

```
cd app && npx vitest run src/pages/dashboard/ZoneDoors.route.test.jsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```jsx
// app/src/pages/dashboard/ZoneDoors.jsx
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import UIcon from '../../components/ui/UIcon'
import { DOORS } from './doors'
import styles from './ZoneDoors.module.css'

const fetcher = (u) => fetch(u).then(r => (r.ok ? r.json() : {})).catch(() => ({}))

export default function ZoneDoors() {
  const { data } = useSWR('/api/dashboard/signposts', fetcher, { refreshInterval: 60_000 })
  return (
    <nav className={styles.doors} aria-label="Sections">
      {DOORS.map((d) => {
        const card = data?.[d.key]
        return (
          <Link key={d.key} to={d.to} className={styles.door}>
            <UIcon name={d.icon} size={14} className={styles.icon} />
            <span className={styles.label}>{d.label}</span>
            {/* A door with no number is still a door. */}
            {card?.value != null && (
              <span className={styles.value}>{card.value}</span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
```

```css
/* app/src/pages/dashboard/ZoneDoors.module.css */
.doors { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: var(--space-sm); max-height: 90px; }
.door { display: flex; flex-direction: column; gap: 2px; justify-content: center; min-height: var(--tap-min); padding: 10px 12px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); color: var(--text-bright); text-decoration: none; }
.door:hover { border-color: var(--accent); }
.icon { color: var(--ut-gold, #dcbb5e); }
.label { font-size: 12px; font-weight: 600; }
.value { font-family: var(--font-mono); font-size: 15px; color: var(--ut-gold, #dcbb5e); }
@media (max-width: 1024px) { .doors { grid-template-columns: repeat(4, minmax(0, 1fr)); max-height: none; } }
@media (max-width: 640px) { .doors { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
```

- [ ] **Step 4: Run and confirm PASS**

```
cd app && npx vitest run src/pages/dashboard/ZoneDoors.route.test.jsx
```

- [ ] **Step 5: Prove it discriminates**

Temporarily change one `to:` in `doors.js` to `/nope`, re-run, confirm RED, revert.

- [ ] **Step 6: Commit**

```bash
git add app/src/pages/dashboard/ZoneDoors.jsx app/src/pages/dashboard/ZoneDoors.module.css app/src/pages/dashboard/ZoneDoors.route.test.jsx
git commit -m "feat: Zone D signpost doors"
```

### Task 12: The Week (weekend Zone B)

**Files:**
- Create: `app/src/pages/dashboard/TheWeek.jsx`, `.module.css`
- Test: `app/src/pages/dashboard/TheWeek.test.jsx`

**Interfaces:**
- Consumes: `GET /api/desk/articles`, `GET /api/calendar`.
- Produces: `export default function TheWeek()`.

**Context:** All four panels read endpoints that already exist. Sunday Scans arrive as Desk articles with slug prefix `sunday-scans-`. A panel with no data is **omitted**, and the zone never renders an empty frame — that is the whole reason this component exists.

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/pages/dashboard/TheWeek.test.jsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { test, expect, vi } from 'vitest'
import TheWeek from './TheWeek'

vi.mock('swr', () => ({ default: (key) => ({
  data: String(key).includes('desk')
    ? { articles: [{ slug: 'sunday-scans-da5', title: 'Sunday Scans', url: '#' }] }
    : { events: [] },
}) }))

test('surfaces the latest Sunday Scan', () => {
  render(<MemoryRouter><TheWeek /></MemoryRouter>)
  expect(screen.getByText(/Sunday Scans/i)).toBeTruthy()
})

test('omits panels with no data instead of rendering an empty frame', () => {
  render(<MemoryRouter><TheWeek /></MemoryRouter>)
  expect(screen.queryByText(/on deck/i)).toBeNull()   // calendar returned []
})
```

- [ ] **Step 2: Run and watch it fail**

```
cd app && npx vitest run src/pages/dashboard/TheWeek.test.jsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```jsx
// app/src/pages/dashboard/TheWeek.jsx
//
// Zone B's WEEKEND hero. The dashboard used to render its weekday
// composition on a Saturday, so the hero showed "Markets are closed" beside
// an 849px dead column. Every panel here reads an endpoint that already
// exists; a panel with no data is omitted so the zone is never an empty frame.
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import TileCard from '../../components/TileCard'
import styles from './TheWeek.module.css'

const fetcher = (u) => fetch(u).then(r => (r.ok ? r.json() : null)).catch(() => null)

export default function TheWeek() {
  const { data: desk } = useSWR('/api/desk/articles?limit=12', fetcher)
  const { data: cal } = useSWR('/api/calendar', fetcher)

  const articles = desk?.articles ?? []
  const scan = articles.find(a => (a.slug || '').startsWith('sunday-scans-'))
  const reading = articles.filter(a => a !== scan).slice(0, 4)
  const onDeck = (cal?.events ?? []).slice(0, 6)

  return (
    <TileCard title="The Week" icon="calendar">
      <div className={styles.grid}>
        {scan && (
          <section className={styles.panel}>
            <h3 className={styles.h}>Latest Sunday Scan</h3>
            <Link to={`/desk/article/${scan.slug}`} className={styles.lead}>{scan.title}</Link>
          </section>
        )}
        {onDeck.length > 0 && (
          <section className={styles.panel}>
            <h3 className={styles.h}>Next week on deck</h3>
            <ul className={styles.list}>
              {onDeck.map(e => <li key={e.symbol ?? e.title}>{e.symbol ?? e.title}</li>)}
            </ul>
          </section>
        )}
        {reading.length > 0 && (
          <section className={styles.panel}>
            <h3 className={styles.h}>From the Desk</h3>
            <ul className={styles.list}>
              {reading.map(a => (
                <li key={a.slug}><Link to={`/desk/article/${a.slug}`}>{a.title}</Link></li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </TileCard>
  )
}
```

```css
/* app/src/pages/dashboard/TheWeek.module.css */
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--space-md); }
.panel { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.h { font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; color: var(--text-muted); margin: 0; }
.lead { font-size: 15px; font-weight: 600; color: var(--text-bright); text-decoration: none; }
.list { margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 5px; font-size: 13px; color: var(--text); }
.list a { color: inherit; text-decoration: none; }
.list a:hover { color: var(--ut-gold, #dcbb5e); }
```

- [ ] **Step 4: Run and confirm PASS**

```
cd app && npx vitest run src/pages/dashboard/TheWeek.test.jsx
```

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/dashboard/TheWeek.jsx app/src/pages/dashboard/TheWeek.module.css app/src/pages/dashboard/TheWeek.test.jsx
git commit -m "feat: The Week — weekend hero for Zone B"
```

### Task 13: Compose the zones and retire the seven previews

**Files:**
- Modify: `app/src/pages/Dashboard.jsx` (full rewrite of the desktop branch), `app/src/pages/Dashboard.module.css`
- Test: `app/src/pages/Dashboard.session.test.jsx` (create)

**Interfaces:**
- Consumes: `useSessionState`, `ZoneDoors`, `TheWeek`, existing tiles.
- Produces: the composed page.

**Context:** Seven components lose their dashboard mount but keep their files and routes: `LeadershipTile`, `CatalystFlow`, `OptionsFlowPreview`, `DeskVideoRail`, `CompassTodayTile`, `SectorRotation`, `IntradayPulse`. Remove only the imports and JSX from `Dashboard.jsx`. This is the same keep-as-rollback idiom used for `LiveFlow.jsx`.

- [ ] **Step 1: Write the failing session test**

```jsx
// app/src/pages/Dashboard.session.test.jsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { test, expect, vi, afterEach } from 'vitest'

vi.mock('swr', () => ({ default: () => ({ data: null }), useSWRConfig: () => ({ mutate: () => {} }) }))
vi.mock('./dashboard/TheWeek', () => ({ default: () => <div>THE WEEK</div> }))
vi.mock('../components/tiles/CatalystTable', () => ({ default: () => <div>CATALYSTS</div> }))

afterEach(() => vi.resetModules())

async function renderAt(session) {
  vi.doMock('./dashboard/useSessionState', () => ({ default: () => session, resolveSession: () => session }))
  const { default: Dashboard } = await import('./Dashboard')
  render(<MemoryRouter><Dashboard /></MemoryRouter>)
}

test('WEEKEND renders The Week, never the weekday hero', async () => {
  await renderAt('WEEKEND')
  expect(screen.getByText('THE WEEK')).toBeTruthy()
  expect(screen.queryByText('CATALYSTS')).toBeNull()
})

for (const s of ['PREMARKET', 'LIVE', 'CLOSED']) {
  test(`${s} renders the catalyst hero`, async () => {
    await renderAt(s)
    expect(screen.getByText('CATALYSTS')).toBeTruthy()
  })
}
```

- [ ] **Step 2: Run and watch it fail**

```
cd app && npx vitest run src/pages/Dashboard.session.test.jsx
```

Expected: FAIL — `THE WEEK` not found (the page has no session switch yet).

- [ ] **Step 3: Rewrite the desktop branch**

Replace the `styles.desktopOnly` block in `app/src/pages/Dashboard.jsx` with:

```jsx
        <div className={styles.desktopOnly}>
          <div className={styles.cockpit}>
            <div className={styles.main}>
              <div className={styles.zoneA}><ZoneRead /></div>
              <div className={styles.zoneB}>
                {session === 'WEEKEND' ? <TheWeek /> : <CatalystTable />}
              </div>
              <div className={styles.zoneC}><JournalSnapshotTile /></div>
            </div>
            <aside className={styles.rail}><MoversSidebar /></aside>
          </div>
          <div className={styles.zoneD}><ZoneDoors /></div>
        </div>
```

with `const session = useSessionState()` in the component body. Delete the imports and JSX for the seven retired tiles.

- [ ] **Step 4: Write the zone budgets**

Replace the grid section of `app/src/pages/Dashboard.module.css`:

```css
/* ⛔ THE HEIGHT BUDGET IS THE DESIGN. Zones declare their height; content
   scrolls inside. Rail: tools/mobile_audit.py HEIGHT_BUDGETS['/dashboard'].
   Baseline before this change: 5.5 screens at 2133, 6.9 at 1277. */
.cockpit { display: grid; grid-template-columns: minmax(0, 1fr) 240px; gap: var(--space-md); }
.main { display: grid; grid-template-rows: 120px 440px 300px; gap: var(--space-md); min-width: 0; }
.zoneA, .zoneB, .zoneC, .rail { min-height: 0; overflow: hidden; }
.zoneB > *, .zoneC > *, .rail > * { max-height: 100%; overflow-y: auto; }
.zoneD { margin-top: var(--space-md); }

@media (max-width: 1024px) {
  .cockpit { grid-template-columns: 1fr; }
  .main { grid-template-rows: auto auto auto; }
  .zoneA, .zoneB, .zoneC, .rail { overflow: visible; }
}
```

Delete `.rowB`, `.rowC`, `.rowD`, `.row1`, `.row2`, `.row3`, `.row4`, `.hero`, `.railMovers`, `.comingSoon*` and the `1440`/`1100`/`768` media queries.

- [ ] **Step 5: Run the tests**

```
cd app && npx vitest run src/pages/
```

Expected: PASS, including `Dashboard.zones.test.jsx` from Task 3.

- [ ] **Step 6: Measure against the budget**

```
python tools/mobile_audit.py --base https://uctintelligence.com --auth --routes /dashboard
```

Expected: `/dashboard` reports `ok` for both `overflowX` and the height budget — `screens <= 1.05`. If it does not, the zone budgets are wrong; adjust the `grid-template-rows` values, not the assertion.

- [ ] **Step 7: Commit**

```bash
git add app/src/pages/Dashboard.jsx app/src/pages/Dashboard.module.css app/src/pages/Dashboard.session.test.jsx
git commit -m "feat: dashboard becomes a session-aware four-zone cockpit

Zones A-D with declared height budgets; Zone B swaps hero by session so the
weekend renders The Week instead of a weekday composition with a dead column.
Seven preview tiles lose their dashboard mount (files and routes kept) and
become Zone D signposts. Legacy 1440/1100/768 breakpoints snapped to the
canonical 640/1024."
```

### Task 14: Zone A and the Zone C rework

**Files:**
- Create: `app/src/pages/dashboard/ZoneRead.jsx`, `.module.css`
- Modify: `app/src/components/tiles/JournalSnapshotTile.jsx`

**Interfaces:**
- Consumes: `useSessionState`, existing `/api/snapshot`, `/api/breadth`.
- Produces: `export default function ZoneRead()`.

**Context:** Zone A is the session pill + exposure number + compact index strip, in 120px. `JournalSnapshotTile` currently sets `BROKER_PERIOD = '3M'` and renders a `Sparkline` — that is the −46.85% curve. Both flagged calls in the spec are reversible switches, so implement them as props with the current behaviour still reachable.

- [ ] **Step 1: Make the equity curve a prop, defaulting off on the dashboard**

In `app/src/components/tiles/JournalSnapshotTile.jsx`, add to the signature:

```jsx
export default function JournalSnapshotTile({ showEquityCurve = false, period = '1D' }) {
```

Replace the hardcoded `const BROKER_PERIOD = '3M'` usage with `period`, and wrap the `<Sparkline .../>` render in `{showEquityCurve && ( ... )}`.

```jsx
  // ⭐ REVERSIBLE BY DESIGN. The 3M curve was the first number the paid home
  // showed every morning (-46.85% at time of writing) and is not a decision
  // input. It lives on /journal, which passes showEquityCurve + period="3M".
```

- [ ] **Step 2: Pass the old behaviour from /journal**

Find the Journal surface that renders `JournalSnapshotTile` and pass `showEquityCurve period="3M"` so nothing is lost.

- [ ] **Step 3: Implement Zone A**

```jsx
// app/src/pages/dashboard/ZoneRead.jsx
import useSWR from 'swr'
import useSessionState from './useSessionState'
import FuturesStrip from '../../components/tiles/FuturesStrip'
import styles from './ZoneRead.module.css'

const LABEL = { PREMARKET: 'Pre-market', LIVE: 'Open', CLOSED: 'Closed', WEEKEND: 'Weekend' }
const fetcher = (u) => fetch(u).then(r => (r.ok ? r.json() : null)).catch(() => null)

export default function ZoneRead() {
  const session = useSessionState()
  const { data: breadth } = useSWR('/api/breadth', fetcher, { refreshInterval: 300_000 })
  const score = breadth?.exposure?.score
  return (
    <div className={styles.read}>
      <div className={styles.state}>
        <span className={`${styles.pill} ${styles[session.toLowerCase()]}`}>{LABEL[session]}</span>
        {score != null && (
          <span className={styles.exposure}>
            <b>{score}</b><span className={styles.exposureLabel}>UCT exposure</span>
          </span>
        )}
      </div>
      {/* quote demoted out of the top row — see spec, Zone A */}
      <FuturesStrip compact hideQuote />
    </div>
  )
}
```

```css
/* app/src/pages/dashboard/ZoneRead.module.css */
.read { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--space-md); align-items: center; height: 100%; }
.state { display: flex; align-items: center; gap: var(--space-md); }
.pill { font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; padding: 3px 9px; border-radius: var(--radius-lg); border: 1px solid var(--border); }
.live { color: var(--gain); border-color: var(--gain-border); }
.premarket, .closed, .weekend { color: var(--text-muted); }
.exposure { display: flex; align-items: baseline; gap: 6px; }
.exposure b { font-family: var(--font-mono); font-size: 26px; color: var(--ut-gold, #dcbb5e); }
.exposureLabel { font-size: 10px; letter-spacing: 1.2px; text-transform: uppercase; color: var(--text-muted); }
```

- [ ] **Step 4: Add `compact` and `hideQuote` to FuturesStrip**

In `app/src/components/tiles/FuturesStrip.jsx`, accept both props; when `hideQuote` is set, do not render the Quote of the Day panel and let the index grid span the full width.

- [ ] **Step 5: Run the full frontend suite**

```
cd app && npx vitest run
```

Expected: all green. Investigate any tile test that relied on `JournalSnapshotTile`'s old default.

- [ ] **Step 6: Commit**

```bash
git add app/src/pages/dashboard/ZoneRead.jsx app/src/pages/dashboard/ZoneRead.module.css app/src/components/tiles/JournalSnapshotTile.jsx app/src/components/tiles/FuturesStrip.jsx
git commit -m "feat: Zone A read strip; equity curve moves to /journal

Both spec-flagged reversible calls land as props: FuturesStrip gains
hideQuote, JournalSnapshotTile gains showEquityCurve (default off on the
dashboard, passed true from /journal so nothing is lost)."
```

---

# PHASE 4 — Nav

### Task 15: Desktop rail adopts the mobile four-group taxonomy

**Files:**
- Create: `app/src/components/navGroups.js`
- Modify: `app/src/components/NavBar.jsx`, `app/src/components/mobile/MobileTabBar.jsx`
- Test: `app/src/components/navGroups.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `export const NAV_GROUPS = [{ key, label, icon, routes: string[] }]` — consumed by both NavBar and MobileTabBar.

**Context:** `MobileTabBar.jsx` already groups routes into Home / Markets / Charts / Journal. Desktop shows 16 unlabeled icons. Extract the existing taxonomy to a shared module so the two platforms cannot drift — this repo's most repeated defect is a second authority over one value.

- [ ] **Step 1: Write the failing test**

```js
// app/src/components/navGroups.test.js
import { test, expect } from 'vitest'
import { NAV_GROUPS } from './navGroups'
import { readFileSync } from 'node:fs'

test('four groups, every route unique across them', () => {
  expect(NAV_GROUPS.map(g => g.key)).toEqual(['home', 'markets', 'charts', 'journal'])
  const all = NAV_GROUPS.flatMap(g => g.routes)
  expect(new Set(all).size).toBe(all.length)
})

test('MobileTabBar derives from the shared module, it does not restate it', () => {
  const src = readFileSync(new URL('./mobile/MobileTabBar.jsx', import.meta.url), 'utf8')
  expect(src).toContain('navGroups')
  expect(src).not.toMatch(/match:\s*\['\/breadth'/)   // the old inline list
})
```

- [ ] **Step 2: Run and watch it fail**

```
cd app && npx vitest run src/components/navGroups.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Extract the taxonomy**

```js
// app/src/components/navGroups.js
//
// ⭐ ONE AUTHORITY for the app's route taxonomy. It already existed, inline,
// inside MobileTabBar — desktop kept 16 unlabeled icons and the two could
// drift. Both surfaces now derive from here.
export const NAV_GROUPS = [
  { key: 'home', label: 'Home', icon: 'dashboard', routes: ['/dashboard', '/morning-wire'] },
  { key: 'markets', label: 'Markets', icon: 'markets',
    routes: ['/breadth', '/options-flow', '/flow-scoreboard', '/live-massive', '/dark-pool',
             '/post-market', '/screener', '/calendar', '/catalysts', '/ai-search', '/uct-20'] },
  { key: 'charts', label: 'Charts', icon: 'chart',
    routes: ['/charts', '/watchlists', '/theme-tracker', '/model-book', '/setup-library'] },
  { key: 'journal', label: 'Journal', icon: 'journal',
    routes: ['/journal', '/community', '/desk', '/support'] },
]
```

- [ ] **Step 4: Rewrite MobileTabBar to derive**

Replace its inline `TABS` with a map over `NAV_GROUPS`, using `routes` as `match` and `routes[0]` as `to`, preserving the existing `paidOnly` / `freeOnly` behaviour for Home.

- [ ] **Step 5: Group the desktop rail**

In `NavBar.jsx`, render `NAV_ITEMS` under group headings derived from `NAV_GROUPS` — a small uppercase mono label above each group, with items in their existing order.

- [ ] **Step 6: Run the suites**

```
cd app && npx vitest run src/components/
python tools/mobile_audit.py --base https://uctintelligence.com --auth --routes /dashboard /breadth /journal
```

Expected: all green, no overflow, budget held.

- [ ] **Step 7: Commit**

```bash
git add app/src/components/navGroups.js app/src/components/navGroups.test.js app/src/components/NavBar.jsx app/src/components/mobile/MobileTabBar.jsx
git commit -m "feat: desktop nav adopts the four-group taxonomy mobile already had

Extracted MobileTabBar's inline grouping to navGroups.js so both surfaces
derive from one authority instead of restating it."
```

---

## Ship

- [ ] **Full suite green**

```
cd app && npx vitest run
python -m pytest tests/ -q
```

Read the summary line. **Its absence means the run did not finish.**

- [ ] **Budget held on production data**

```
python tools/mobile_audit.py --base https://uctintelligence.com --auth
```

- [ ] **Push**

```bash
git fetch origin
git merge origin/master        # resolve, re-run both suites
git push origin feat/dashboard-session-cockpit:master
```

Never force-push. This branch shares its remote with other worktrees.

- [ ] **Confirm in the browser, not the terminal.** Open `/dashboard` on production at 1280 and 390 and count pixels. The browser sees what no test can.

---

## Self-review notes

- **Spec coverage:** Phase 0 → Task 1. Four defects → Tasks 2–5. Three orphans → Tasks 6–8. Session states → Tasks 9, 12, 13. Zone D + signposts endpoint → Tasks 10, 11. Zones A/C + the two reversible calls → Task 14. Height-budget invariant → Tasks 2, 3, 13. Nav → Task 15. Testing strategy items 1–5 → Tasks 2, 3, 13, 11, 6/7.
- **Deferred in the spec, deferred here:** the 2026-08-27 catalyst gap and the 50-call fan-out. Neither has a task, by design.
- **Type consistency:** `DOORS[].key` (Task 10) is the key set asserted by `tests/test_dashboard_signposts.py` (Task 10) and read by `ZoneDoors` (Task 11). `resolveSession`'s four return values (Task 9) are the four branches in `Dashboard.session.test.jsx` (Task 13) and the four keys of `LABEL` in `ZoneRead` (Task 14). `showEquityCurve` / `period` (Task 14) are the only props added to `JournalSnapshotTile`.
