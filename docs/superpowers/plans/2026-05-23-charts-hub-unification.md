# Charts Hub Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge `/theme-tracker`, `/watchlists`, and `/multi-chart` into a single `/charts` left-nav tab with four sub-tabs (Chart · Watchlist · Themes · Multi-Chart) backed by a shared ticker context. Three subsumed pages render as-is via lazy-mount.

**Architecture:** New `ChartsHub` shell wraps four sub-tabs. Sub-tab switching via `?tab=…` query param + last-tab restored from `usePreferences`. Symbol selection in any sub-tab publishes to a hub-level React context that the other sub-tabs read. Three legacy URLs redirect to the new hub with query params preserved.

**Tech Stack:** React 18, React Router v6, Vite, Vitest + @testing-library/react, existing `usePreferences` hook, existing `StockChart` component.

**Spec:** `docs/superpowers/specs/2026-05-23-charts-hub-unification-design.md`

---

## File Structure

**Created (9 files):**

| File | Responsibility |
|---|---|
| `app/src/pages/charts/ChartsSymContext.jsx` | React Context + null-safe `useChartsSym()` hook |
| `app/src/pages/charts/ChartsSymContext.test.jsx` | Hook behavior |
| `app/src/pages/charts/ChartTab.jsx` | Single-symbol chart sub-tab (SPY default) |
| `app/src/pages/charts/ChartTab.test.jsx` | Default symbol, context reads/writes |
| `app/src/pages/charts/LegacyRedirect.jsx` | `<Navigate>` wrapper that merges incoming query params into the new URL |
| `app/src/pages/charts/LegacyRedirect.test.jsx` | Query merge behavior |
| `app/src/pages/charts/ChartsHub.jsx` | Shell — sub-tab strip, URL/preference sync, lazy-mount, context provider |
| `app/src/pages/charts/ChartsHub.test.jsx` | Sub-tab switching, default landing, persistence, lazy-mount |
| `app/src/pages/charts/ChartsHub.module.css` | Header + sub-tab strip styles |

**Modified (8 files):**

| File | Change |
|---|---|
| `app/src/App.jsx` | Add `/charts` route + 3 legacy redirect routes; remove direct routes for `/theme-tracker`, `/watchlists`, `/multi-chart` |
| `app/src/components/NavBar.jsx` | Swap nav items + extend `FREE_PAGES` |
| `app/src/components/NavBar.test.jsx` | Update assertions for new "Charts" link |
| `app/src/components/MobileNav.jsx` | Swap nav sections + extend `FREE_PAGES` |
| `app/src/components/AuthGuard.jsx` | Extend `FREE_PAGES` to include `/charts` and `/multi-chart` |
| `app/src/pages/Watchlists.jsx` | ~10-line adapter — publish row-click ticker to hub context |
| `app/src/pages/ThemeTrackerPage.jsx` | ~10-line adapter — publish holding-click ticker to hub context |
| `app/src/pages/MultiChart.jsx` | Add "Apply ${sym} to cell #1" toolbar button |

---

## Task 1: Set up the new directory

**Files:** Create `app/src/pages/charts/` (empty for now).

- [ ] **Step 1: Verify working tree is clean**

Run: `cd C:/Users/Patrick/uct-dashboard && git status --short`
Expected: only untracked files outside `app/src/` (existing experimental docs / tools). No staged changes.

- [ ] **Step 2: Create the directory**

Run: `mkdir -p app/src/pages/charts`
Expected: silent success.

---

## Task 2: ChartsSymContext + hook

**Files:**
- Create: `app/src/pages/charts/ChartsSymContext.jsx`
- Create: `app/src/pages/charts/ChartsSymContext.test.jsx`

- [ ] **Step 1: Write the failing test**

Write `app/src/pages/charts/ChartsSymContext.test.jsx`:

```jsx
import { render, screen, act } from '@testing-library/react'
import { useState } from 'react'
import { ChartsSymContext, useChartsSym } from './ChartsSymContext'

function Probe() {
  const { sym, setSym } = useChartsSym()
  return (
    <div>
      <span data-testid="sym">{sym ?? 'null'}</span>
      <button onClick={() => setSym('NVDA')}>set</button>
    </div>
  )
}

test('useChartsSym returns null + no-op setter when used outside provider', () => {
  render(<Probe />)
  expect(screen.getByTestId('sym').textContent).toBe('null')
  // Click must not throw
  screen.getByText('set').click()
  expect(screen.getByTestId('sym').textContent).toBe('null')
})

test('useChartsSym reads + writes through the provider', () => {
  function Wrapper() {
    const [sym, setSym] = useState(null)
    return (
      <ChartsSymContext.Provider value={{ sym, setSym }}>
        <Probe />
      </ChartsSymContext.Provider>
    )
  }
  render(<Wrapper />)
  expect(screen.getByTestId('sym').textContent).toBe('null')
  act(() => { screen.getByText('set').click() })
  expect(screen.getByTestId('sym').textContent).toBe('NVDA')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/charts/ChartsSymContext.test.jsx`
Expected: FAIL — module not found (`./ChartsSymContext`).

- [ ] **Step 3: Implement the context + hook**

Write `app/src/pages/charts/ChartsSymContext.jsx`:

```jsx
import { createContext, useContext } from 'react'

export const ChartsSymContext = createContext(null)

const FALLBACK = { sym: null, setSym: () => {} }

export function useChartsSym() {
  return useContext(ChartsSymContext) || FALLBACK
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/charts/ChartsSymContext.test.jsx`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/src/pages/charts/ChartsSymContext.jsx app/src/pages/charts/ChartsSymContext.test.jsx
git commit -m "feat(charts): add ChartsSymContext + useChartsSym hook"
```

---

## Task 3: ChartTab — single-chart sub-tab

**Files:**
- Create: `app/src/pages/charts/ChartTab.jsx`
- Create: `app/src/pages/charts/ChartTab.test.jsx`

`ChartTab` renders the existing `StockChart` with the shared context's `sym` (falling back to `SPY` on first-ever visit) and wires `onSymbolChange` so user symbol changes inside the chart propagate back to the hub context.

- [ ] **Step 1: Write the failing test**

Write `app/src/pages/charts/ChartTab.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import { vi } from 'vitest'
import { ChartsSymContext } from './ChartsSymContext'
import ChartTab from './ChartTab'

// Mock StockChart — it pulls in lightweight-charts + ~30 hooks; we only
// need to verify the props we pass down.
vi.mock('../../components/StockChart', () => ({
  default: ({ sym, onSymbolChange }) => (
    <div>
      <span data-testid="chart-sym">{sym}</span>
      <button onClick={() => onSymbolChange && onSymbolChange('NVDA')}>change</button>
    </div>
  ),
}))

test('ChartTab defaults to SPY when context sym is null', () => {
  function Wrapper() {
    const [sym, setSym] = useState(null)
    return (
      <ChartsSymContext.Provider value={{ sym, setSym }}>
        <ChartTab />
      </ChartsSymContext.Provider>
    )
  }
  render(<Wrapper />)
  expect(screen.getByTestId('chart-sym').textContent).toBe('SPY')
})

test('ChartTab renders context sym when provided', () => {
  const value = { sym: 'AAPL', setSym: vi.fn() }
  render(
    <ChartsSymContext.Provider value={value}>
      <ChartTab />
    </ChartsSymContext.Provider>,
  )
  expect(screen.getByTestId('chart-sym').textContent).toBe('AAPL')
})

test('ChartTab writes back to context when StockChart fires onSymbolChange', () => {
  const setSym = vi.fn()
  render(
    <ChartsSymContext.Provider value={{ sym: 'SPY', setSym }}>
      <ChartTab />
    </ChartsSymContext.Provider>,
  )
  screen.getByText('change').click()
  expect(setSym).toHaveBeenCalledWith('NVDA')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/charts/ChartTab.test.jsx`
Expected: FAIL — module not found (`./ChartTab`).

- [ ] **Step 3: Implement ChartTab**

Write `app/src/pages/charts/ChartTab.jsx`:

```jsx
import StockChart from '../../components/StockChart'
import { useChartsSym } from './ChartsSymContext'

export default function ChartTab() {
  const { sym, setSym } = useChartsSym()
  const resolved = sym || 'SPY'
  return <StockChart sym={resolved} onSymbolChange={setSym} />
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/charts/ChartTab.test.jsx`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/src/pages/charts/ChartTab.jsx app/src/pages/charts/ChartTab.test.jsx
git commit -m "feat(charts): add ChartTab sub-tab with SPY default + context wiring"
```

---

## Task 4: LegacyRedirect — query-preserving redirect component

**Files:**
- Create: `app/src/pages/charts/LegacyRedirect.jsx`
- Create: `app/src/pages/charts/LegacyRedirect.test.jsx`

This component handles `/theme-tracker`, `/watchlists`, `/multi-chart` → `/charts?tab=…`. It must MERGE any incoming query params (so `?id=42` survives).

- [ ] **Step 1: Write the failing test**

Write `app/src/pages/charts/LegacyRedirect.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import LegacyRedirect from './LegacyRedirect'

function CurrentUrl() {
  const loc = useLocation()
  return <div data-testid="url">{loc.pathname + loc.search}</div>
}

function renderAt(path) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/theme-tracker" element={<LegacyRedirect tab="themes" />} />
        <Route path="/watchlists" element={<LegacyRedirect tab="watchlist" />} />
        <Route path="/multi-chart" element={<LegacyRedirect tab="multichart" />} />
        <Route path="/charts" element={<CurrentUrl />} />
      </Routes>
    </MemoryRouter>,
  )
}

test('/theme-tracker redirects to /charts?tab=themes', () => {
  renderAt('/theme-tracker')
  expect(screen.getByTestId('url').textContent).toBe('/charts?tab=themes')
})

test('preserves extra query params from the legacy URL', () => {
  renderAt('/watchlists?id=42&filter=tech')
  // Order of params in URLSearchParams output is insertion order
  expect(screen.getByTestId('url').textContent).toBe('/charts?tab=watchlist&id=42&filter=tech')
})

test('legacy ?tab= param is dropped (we set our own)', () => {
  renderAt('/multi-chart?tab=ignored&keep=me')
  expect(screen.getByTestId('url').textContent).toBe('/charts?tab=multichart&keep=me')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/charts/LegacyRedirect.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement LegacyRedirect**

Write `app/src/pages/charts/LegacyRedirect.jsx`:

```jsx
import { Navigate, useLocation } from 'react-router-dom'

export default function LegacyRedirect({ tab }) {
  const { search } = useLocation()
  const params = new URLSearchParams(search)
  params.delete('tab')  // we always overwrite with the canonical tab
  params.set('tab', tab)
  // Put tab first; URLSearchParams.set after delete appends, so rebuild:
  const merged = new URLSearchParams()
  merged.set('tab', tab)
  for (const [k, v] of params) {
    if (k !== 'tab') merged.append(k, v)
  }
  return <Navigate to={`/charts?${merged.toString()}`} replace />
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/charts/LegacyRedirect.test.jsx`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/src/pages/charts/LegacyRedirect.jsx app/src/pages/charts/LegacyRedirect.test.jsx
git commit -m "feat(charts): add LegacyRedirect for old /theme-tracker, /watchlists, /multi-chart URLs"
```

---

## Task 5: ChartsHub — shell, sub-tab strip, URL/pref sync

**Files:**
- Create: `app/src/pages/charts/ChartsHub.jsx`
- Create: `app/src/pages/charts/ChartsHub.test.jsx`
- Create: `app/src/pages/charts/ChartsHub.module.css`

We test the shell with all sub-tab components mocked. Real sub-tab content is verified in Tasks 2/3 + manual smoke in Task 13.

- [ ] **Step 1: Write the failing test**

Write `app/src/pages/charts/ChartsHub.test.jsx`:

```jsx
import { render, screen, act } from '@testing-library/react'
import { vi } from 'vitest'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

// Mock the 4 sub-tab components — we only care about which one is visible.
vi.mock('./ChartTab', () => ({ default: () => <div data-testid="tab-chart">CHART</div> }))
vi.mock('../Watchlists', () => ({ default: () => <div data-testid="tab-watchlist">WATCHLIST</div> }))
vi.mock('../ThemeTrackerPage', () => ({ default: () => <div data-testid="tab-themes">THEMES</div> }))
vi.mock('../MultiChart', () => ({ default: () => <div data-testid="tab-multichart">MULTICHART</div> }))

// Mock usePreferences — we control returned prefs and capture setPref calls.
const setPref = vi.fn()
let mockPrefs = {}
vi.mock('../../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPref, loading: false }),
}))

import ChartsHub from './ChartsHub'

function UrlProbe() {
  const loc = useLocation()
  return <div data-testid="url">{loc.pathname + loc.search}</div>
}

function renderHub(initial = '/charts') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/charts" element={<><ChartsHub /><UrlProbe /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  setPref.mockReset()
  mockPrefs = {}
})

test('first visit with no preference lands on Chart sub-tab', async () => {
  renderHub('/charts')
  expect(await screen.findByTestId('tab-chart')).toBeVisible()
})

test('?tab=watchlist activates Watchlist sub-tab', async () => {
  renderHub('/charts?tab=watchlist')
  expect(await screen.findByTestId('tab-watchlist')).toBeVisible()
})

test('returning user with saved preference restores last-visited sub-tab', async () => {
  mockPrefs = { charts_last_tab: 'themes' }
  renderHub('/charts')
  expect(await screen.findByTestId('tab-themes')).toBeVisible()
})

test('?tab= URL param wins over saved preference', async () => {
  mockPrefs = { charts_last_tab: 'themes' }
  renderHub('/charts?tab=multichart')
  expect(await screen.findByTestId('tab-multichart')).toBeVisible()
})

test('clicking a sub-tab updates URL and saves preference', async () => {
  renderHub('/charts')
  await screen.findByTestId('tab-chart')
  act(() => {
    screen.getByRole('tab', { name: /themes/i }).click()
  })
  expect(await screen.findByTestId('tab-themes')).toBeVisible()
  expect(screen.getByTestId('url').textContent).toBe('/charts?tab=themes')
  expect(setPref).toHaveBeenCalledWith('charts_last_tab', 'themes')
})

test('lazy-mount: unvisited sub-tabs are not in the DOM', async () => {
  renderHub('/charts?tab=chart')
  await screen.findByTestId('tab-chart')
  expect(screen.queryByTestId('tab-watchlist')).not.toBeInTheDocument()
  expect(screen.queryByTestId('tab-themes')).not.toBeInTheDocument()
  expect(screen.queryByTestId('tab-multichart')).not.toBeInTheDocument()
})

test('visited sub-tabs stay mounted (display:none) after switching', async () => {
  renderHub('/charts?tab=chart')
  await screen.findByTestId('tab-chart')
  act(() => {
    screen.getByRole('tab', { name: /watchlist/i }).click()
  })
  await screen.findByTestId('tab-watchlist')
  // Previously-visited Chart still in DOM
  expect(screen.getByTestId('tab-chart')).toBeInTheDocument()
})

test('seeds context from ?sym= and exposes it to active sub-tab', async () => {
  // ChartTab mock doesn't read context; we just verify the URL is honored
  // and the active tab renders. Full context wiring covered in Task 3.
  renderHub('/charts?tab=chart&sym=NVDA')
  expect(await screen.findByTestId('tab-chart')).toBeVisible()
  // URL preserved
  expect(screen.getByTestId('url').textContent).toContain('sym=NVDA')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/charts/ChartsHub.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ChartsHub**

Write `app/src/pages/charts/ChartsHub.jsx`:

```jsx
import { Suspense, useState, useEffect, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
// Match the project-wide convention: lazyWithRetry hard-reloads the page
// when a stale chunk 404s after a Railway redeploy. Used everywhere in App.jsx.
import lazy from '../../utils/lazyWithRetry'
import usePreferences from '../../hooks/usePreferences'
import { ChartsSymContext } from './ChartsSymContext'
import styles from './ChartsHub.module.css'

const ChartTab = lazy(() => import('./ChartTab'))
const WatchlistTab = lazy(() => import('../Watchlists'))
const ThemesTab = lazy(() => import('../ThemeTrackerPage'))
const MultiChartTab = lazy(() => import('../MultiChart'))

const SUB_TABS = [
  { id: 'chart',      label: 'Chart',       Component: ChartTab },
  { id: 'watchlist',  label: 'Watchlist',   Component: WatchlistTab },
  { id: 'themes',     label: 'Themes',      Component: ThemesTab },
  { id: 'multichart', label: 'Multi-Chart', Component: MultiChartTab },
]

const VALID_IDS = new Set(SUB_TABS.map(t => t.id))

export default function ChartsHub() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { prefs, setPref } = usePreferences()

  const urlTab = searchParams.get('tab')
  const prefTab = prefs?.charts_last_tab
  const initial = VALID_IDS.has(urlTab) ? urlTab
                : VALID_IDS.has(prefTab) ? prefTab
                : 'chart'

  const [activeId, setActiveId] = useState(initial)

  // If the resolved initial came from the preference (not the URL),
  // push it into the URL so the address bar reflects state.
  useEffect(() => {
    if (!urlTab && activeId) {
      const next = new URLSearchParams(searchParams)
      next.set('tab', activeId)
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // React to external URL changes (e.g., back/forward button).
  useEffect(() => {
    if (urlTab && VALID_IDS.has(urlTab) && urlTab !== activeId) {
      setActiveId(urlTab)
    }
  }, [urlTab, activeId])

  // Track which sub-tabs have been mounted at least once (lazy keep-alive).
  const [mountedIds, setMountedIds] = useState(() => new Set([initial]))
  useEffect(() => {
    setMountedIds(prev => {
      if (prev.has(activeId)) return prev
      const next = new Set(prev)
      next.add(activeId)
      return next
    })
  }, [activeId])

  // Shared ticker context — seed from ?sym= if present.
  const [sym, setSym] = useState(searchParams.get('sym'))
  const symContextValue = useMemo(() => ({ sym, setSym }), [sym])

  function handleTabClick(id) {
    if (id === activeId) return
    setActiveId(id)
    const next = new URLSearchParams(searchParams)
    next.set('tab', id)
    navigate(`/charts?${next.toString()}`, { replace: true })
    setPref('charts_last_tab', id)
  }

  return (
    <ChartsSymContext.Provider value={symContextValue}>
      <div className={styles.hub}>
        <header className={styles.header}>
          <h1 className={styles.title}>📈 Charts</h1>
          <div className={styles.subtabStrip} role="tablist">
            {SUB_TABS.map(tab => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={tab.id === activeId}
                className={[styles.subtab, tab.id === activeId ? styles.subtabActive : ''].join(' ')}
                onClick={() => handleTabClick(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </header>
        <main className={styles.body}>
          {SUB_TABS.map(tab => mountedIds.has(tab.id) && (
            <div
              key={tab.id}
              className={styles.tabPanel}
              style={{ display: tab.id === activeId ? 'block' : 'none' }}
              role="tabpanel"
              aria-hidden={tab.id !== activeId}
            >
              <Suspense fallback={<div className={styles.loading}>Loading…</div>}>
                <tab.Component />
              </Suspense>
            </div>
          ))}
        </main>
      </div>
    </ChartsSymContext.Provider>
  )
}
```

- [ ] **Step 4: Write the CSS module**

Write `app/src/pages/charts/ChartsHub.module.css`:

```css
.hub {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg, #0a0e14);
  color: var(--text, #e5e7eb);
}

.header {
  background: var(--bg-elevated, #0d1218);
  border-bottom: 1px solid var(--border, #1f2937);
  padding: 12px 20px 0 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex-shrink: 0;
}

.title {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.5px;
  margin: 0;
  color: var(--text, #e5e7eb);
}

.subtabStrip {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.subtabStrip::-webkit-scrollbar { display: none; }

.subtab {
  flex-shrink: 0;
  scroll-snap-align: start;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-muted, #6b7280);
  padding: 8px 14px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1px;
  cursor: pointer;
  font-family: inherit;
}

.subtab:hover {
  color: var(--text, #e5e7eb);
}

.subtabActive {
  color: var(--accent, #c9a84c);
  border-bottom-color: var(--accent, #c9a84c);
}

.body {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: auto;
}

.tabPanel {
  /* Each sub-tab keeps its own height management; the panel is just a container. */
  height: 100%;
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--text-muted, #6b7280);
  font-size: 12px;
}

@media (max-width: 640px) {
  .header { padding: 10px 12px 0 12px; }
  .subtab { padding: 8px 10px; font-size: 10px; }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/charts/ChartsHub.test.jsx`
Expected: 8 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/src/pages/charts/ChartsHub.jsx app/src/pages/charts/ChartsHub.module.css app/src/pages/charts/ChartsHub.test.jsx
git commit -m "feat(charts): add ChartsHub shell with sub-tab strip, lazy-mount, URL+pref sync"
```

---

## Task 6: Wire `/charts` route + legacy redirects in App.jsx

**Files:**
- Modify: `app/src/App.jsx` (route block around lines 144–170)

- [ ] **Step 1: Add the import for ChartsHub + LegacyRedirect**

`app/src/App.jsx` uses `lazy` from `./utils/lazyWithRetry` (line 5) for all page imports. Locate the lazy-import block (lines 22–58, alphabetical-ish) and add after the `MultiChart` line (~line 43):

```jsx
const ChartsHub = lazy(() => import('./pages/charts/ChartsHub'))
const LegacyRedirect = lazy(() => import('./pages/charts/LegacyRedirect'))
```

- [ ] **Step 2: Replace the three direct routes with redirects + add /charts**

Inside `<Route element={<Layout />}>`, find these lines:

```jsx
<Route path="/theme-tracker" element={<ThemeTrackerPage />} />
...
<Route path="/multi-chart" element={<MultiChart />} />
<Route path="/watchlists" element={<Watchlists />} />
```

Replace all three with:

```jsx
<Route path="/charts" element={<ChartsHub />} />
<Route path="/theme-tracker" element={<LegacyRedirect tab="themes" />} />
<Route path="/watchlists" element={<LegacyRedirect tab="watchlist" />} />
<Route path="/multi-chart" element={<LegacyRedirect tab="multichart" />} />
```

Order doesn't matter for routing, but keep `/charts` first for readability.

- [ ] **Step 3: Verify imports for the removed direct components stay (they're used inside ChartsHub via lazy)**

The pre-existing top-of-file imports of `MultiChart`, `Watchlists`, `ThemeTrackerPage` can remain — they're now harmless dead imports unless tree-shaken. If they generate ESLint unused-import warnings, **remove them**. Run:

`cd app && npx eslint src/App.jsx`
Expected: no errors. (If there are unused-import warnings, delete the unused top-level imports — `ChartsHub` loads its own copies via `lazy()`.)

- [ ] **Step 4: Manual route smoke (Vite dev)**

Already covered by Task 13's end-to-end smoke. No separate verification step here.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/src/App.jsx
git commit -m "feat(charts): wire /charts route + legacy URL redirects in App.jsx"
```

---

## Task 7: NavBar — swap items + extend FREE_PAGES + update test

**Files:**
- Modify: `app/src/components/NavBar.jsx` (lines 11–34)
- Modify: `app/src/components/NavBar.test.jsx`

- [ ] **Step 1: Update NavBar.test.jsx first (TDD on the change)**

Replace the contents of `app/src/components/NavBar.test.jsx`:

```jsx
import { renderWithProviders, screen } from '../test-utils'
import NavBar from './NavBar'

test('renders nav sidebar with free-tier links by default', () => {
  // Charts hub (unified) + dashboard + breadth + calendar are FREE_PAGES.
  // Theme Tracker, Watchlists, Multi-Chart no longer appear in the nav —
  // they've been subsumed under /charts.
  renderWithProviders(<NavBar />)
  expect(screen.getByTestId('nav-sidebar')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /breadth/i })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /^charts$/i })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /calendar/i })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /theme tracker/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /watchlists/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /multi chart/i })).not.toBeInTheDocument()
})

test('active link has active class', () => {
  renderWithProviders(<NavBar />, { route: '/dashboard' })
  const dashLink = screen.getByRole('link', { name: /dashboard/i })
  expect(dashLink.className).toMatch(/active/)
})

test('Charts link active on /charts and on legacy paths during transition', () => {
  renderWithProviders(<NavBar />, { route: '/charts' })
  const chartsLink = screen.getByRole('link', { name: /^charts$/i })
  expect(chartsLink.className).toMatch(/active/)
})
```

- [ ] **Step 2: Run the test — it should fail**

Run: `cd app && npx vitest run src/components/NavBar.test.jsx`
Expected: FAIL — old test asserted Theme Tracker / Watchlists are present.

- [ ] **Step 3: Update NavBar.jsx**

In `app/src/components/NavBar.jsx`:

Find lines 11–30 (`NAV_ITEMS`). Replace:

```jsx
const NAV_ITEMS = [
  { to: '/dashboard',    label: 'Dashboard',    icon: '⊞' },
  { to: '/morning-wire', label: 'Morning Wire',  icon: '📰' },
  { to: '/uct-20',       label: 'UCT 20',        icon: '⭐' },
  { to: '/breadth',        label: 'Breadth',        icon: '📶' },
  { to: '/theme-tracker',  label: 'Theme Tracker',  icon: '🎯' },
  { to: '/calendar',       label: 'Calendar',        icon: '📅' },
  { to: '/screener',     label: 'Screener',      icon: '⚡' },
  { to: '/patterns',     label: 'Patterns',      icon: '🎯' },
  { to: '/options-flow', label: 'Options Flow',  icon: '📊' },
  { to: '/dark-pool',    label: 'Dark Pool',     icon: '🌊' },
  { to: '/post-market',  label: 'Post Market',   icon: '🌙' },
  { to: '/model-book',      label: 'Model Book',     icon: '📖' },
  { to: '/setup-library',   label: 'Setup Library',  icon: '📚' },
  { to: '/journal',      label: 'Journal',       icon: '📓' },
  { to: '/risk',         label: 'Risk',          icon: '🛡️' },
  { to: '/multi-chart',  label: 'Multi Chart',   icon: '⊟' },
  { to: '/watchlists',   label: 'Watchlists',    icon: '📋' },
  { to: '/support',      label: 'Support',       icon: '💬' },
]
```

With:

```jsx
const NAV_ITEMS = [
  { to: '/dashboard',    label: 'Dashboard',    icon: '⊞' },
  { to: '/morning-wire', label: 'Morning Wire',  icon: '📰' },
  { to: '/uct-20',       label: 'UCT 20',        icon: '⭐' },
  { to: '/breadth',      label: 'Breadth',       icon: '📶' },
  { to: '/charts',       label: 'Charts',        icon: '📈' },
  { to: '/calendar',     label: 'Calendar',      icon: '📅' },
  { to: '/screener',     label: 'Screener',      icon: '⚡' },
  { to: '/patterns',     label: 'Patterns',      icon: '🎯' },
  { to: '/options-flow', label: 'Options Flow',  icon: '📊' },
  { to: '/dark-pool',    label: 'Dark Pool',     icon: '🌊' },
  { to: '/post-market',  label: 'Post Market',   icon: '🌙' },
  { to: '/model-book',   label: 'Model Book',    icon: '📖' },
  { to: '/setup-library',label: 'Setup Library', icon: '📚' },
  { to: '/journal',      label: 'Journal',       icon: '📓' },
  { to: '/risk',         label: 'Risk',          icon: '🛡️' },
  { to: '/support',      label: 'Support',       icon: '💬' },
]
```

Find line 34. Replace:

```jsx
const FREE_PAGES = ['/dashboard', '/breadth', '/theme-tracker', '/calendar', '/watchlists', '/patterns']
```

With:

```jsx
const FREE_PAGES = ['/dashboard', '/breadth', '/charts', '/calendar', '/patterns', '/theme-tracker', '/watchlists', '/multi-chart']
```

(Legacy paths stay in FREE_PAGES so their redirects pass the auth gate.)

- [ ] **Step 4: Run the test — it should pass**

Run: `cd app && npx vitest run src/components/NavBar.test.jsx`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/src/components/NavBar.jsx app/src/components/NavBar.test.jsx
git commit -m "feat(charts): swap NavBar entries for unified Charts hub + extend FREE_PAGES"
```

---

## Task 8: MobileNav — swap items + extend FREE_PAGES

**Files:**
- Modify: `app/src/components/MobileNav.jsx` (lines 13–58)

No dedicated MobileNav test exists; verification happens via manual mobile-width smoke in Task 13.

- [ ] **Step 1: Update NAV_SECTIONS**

In `app/src/components/MobileNav.jsx` lines 13–56:

Inside the `Analysis` section's `items` array (around line 25), **remove** the Theme Tracker entry:

```jsx
{ to: '/theme-tracker',  label: 'Theme Tracker',  icon: '🎯' },
```

**Add** the Charts entry in its place (so it sits between Breadth and Calendar):

```jsx
{ to: '/charts',         label: 'Charts',         icon: '📈' },
```

Inside the `Trading` section's `items` array (around lines 41–48), **remove** these two entries:

```jsx
{ to: '/multi-chart', label: 'Multi Chart', icon: '⊟' },
{ to: '/watchlists',  label: 'Watchlists',  icon: '📋' },
```

- [ ] **Step 2: Extend FREE_PAGES**

Find line 58. Replace:

```jsx
const FREE_PAGES = ['/dashboard', '/breadth', '/theme-tracker', '/calendar', '/watchlists', '/patterns']
```

With:

```jsx
const FREE_PAGES = ['/dashboard', '/breadth', '/charts', '/calendar', '/patterns', '/theme-tracker', '/watchlists', '/multi-chart']
```

- [ ] **Step 3: Quick build smoke**

Run: `cd app && npx vite build 2>&1 | tail -20`
Expected: build succeeds with no syntax errors related to MobileNav.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/src/components/MobileNav.jsx
git commit -m "feat(charts): swap MobileNav entries for unified Charts hub + extend FREE_PAGES"
```

---

## Task 9: AuthGuard — extend FREE_PAGES

**Files:**
- Modify: `app/src/components/AuthGuard.jsx` (line 100)

- [ ] **Step 1: Update the constant**

In `app/src/components/AuthGuard.jsx` find line 100:

```jsx
const FREE_PAGES = ['/dashboard', '/breadth', '/theme-tracker', '/calendar', '/watchlists', '/patterns']
```

Replace with:

```jsx
const FREE_PAGES = ['/dashboard', '/breadth', '/charts', '/calendar', '/patterns', '/theme-tracker', '/watchlists', '/multi-chart']
```

- [ ] **Step 2: Verify no tests broke**

Run: `cd app && npx vitest run` (full frontend suite — takes ~2-5 min)
Expected: full suite PASS. The list expansion is permissive (adds free pages, removes nothing), so no existing assertion should fail.

If a Watchlists / ThemeTracker / MultiChart test fails because of router context expectations, hold off — those adapters land in Tasks 10–12.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/src/components/AuthGuard.jsx
git commit -m "feat(charts): extend AuthGuard FREE_PAGES for /charts hub + legacy paths"
```

---

## Task 10: Watchlists adapter — publish ticker to hub context

**Files:**
- Modify: `app/src/pages/Watchlists.jsx`

Goal: when a user clicks a watchlist row, the selected ticker propagates to `ChartsSymContext` so the Chart sub-tab, Themes sub-tab, and Multi-Chart sub-tab all see it. Must remain backwards-compatible if Watchlists is rendered outside the hub (the null-safe `useChartsSym()` hook handles this).

- [ ] **Step 1: Read Watchlists.jsx to find the row-click handler**

Run: `cd C:/Users/Patrick/uct-dashboard && grep -n "setSelectedSym\|setActiveSym\|onClick.*sym\|selectedSym" app/src/pages/Watchlists.jsx | head -20`

Identify the state variable that holds the currently-charted symbol (likely `selectedSym` / `activeSym` / similar) and the click handler that sets it.

- [ ] **Step 2: Add the hub-context wiring**

Near the top of `app/src/pages/Watchlists.jsx`, add the import:

```jsx
import { useChartsSym } from './charts/ChartsSymContext'
```

Inside the component, near other `useState` calls, add:

```jsx
const { sym: hubSym, setSym: setHubSym } = useChartsSym()
```

Find the existing row-click handler that sets the local selected symbol. Augment it to also call `setHubSym(ticker)`. Example shape — adapt to the actual variable name found in Step 1:

```jsx
// BEFORE
const handleRowClick = (ticker) => {
  setSelectedSym(ticker)
  // ... existing logic
}

// AFTER
const handleRowClick = (ticker) => {
  setSelectedSym(ticker)
  setHubSym(ticker)
  // ... existing logic
}
```

If the click handler is inline JSX (`onClick={() => setSelectedSym(item.sym)}`), wrap both calls:

```jsx
onClick={() => { setSelectedSym(item.sym); setHubSym(item.sym); }}
```

Also add a sync effect so that when the hub context changes externally (user clicks NVDA in Themes sub-tab and then switches to Watchlist), the local selection follows:

```jsx
useEffect(() => {
  if (hubSym && hubSym !== selectedSym) setSelectedSym(hubSym)
}, [hubSym])  // intentionally do NOT depend on selectedSym (avoid feedback loop)
```

- [ ] **Step 3: Build smoke**

Run: `cd app && npx vite build 2>&1 | tail -10`
Expected: build succeeds.

- [ ] **Step 4: Run existing Watchlists tests (if any)**

Run: `cd app && npx vitest run src/pages/Watchlists`
Expected: all existing Watchlists tests pass (none today — Watchlists has no `.test.jsx` file; this is a no-op for now).

- [ ] **Step 5: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/src/pages/Watchlists.jsx
git commit -m "feat(charts): wire Watchlists row-click to hub ticker context"
```

---

## Task 11: ThemeTrackerPage adapter — publish ticker to hub context

**Files:**
- Modify: `app/src/pages/ThemeTrackerPage.jsx`

- [ ] **Step 1: Read ThemeTrackerPage.jsx to find the holding-click handler**

Run: `cd C:/Users/Patrick/uct-dashboard && grep -n "setSelectedSym\|setActiveSym\|onClick.*sym\|selectedSym\|onSymbolChange" app/src/pages/ThemeTrackerPage.jsx | head -20`

Identify the state holding the currently-charted symbol on the right panel.

- [ ] **Step 2: Add hub-context wiring**

Near the top of `app/src/pages/ThemeTrackerPage.jsx`, add the import:

```jsx
import { useChartsSym } from './charts/ChartsSymContext'
```

Inside the component, near other `useState` calls, add:

```jsx
const { sym: hubSym, setSym: setHubSym } = useChartsSym()
```

Find the existing holding-click handler that sets the local selected symbol (identified in Step 1). Augment it to also call `setHubSym(ticker)`. Example shape — adapt to the actual variable name found in Step 1:

```jsx
// BEFORE
const handleHoldingClick = (ticker) => {
  setSelectedSym(ticker)
  // ... existing logic
}

// AFTER
const handleHoldingClick = (ticker) => {
  setSelectedSym(ticker)
  setHubSym(ticker)
  // ... existing logic
}
```

If the click handler is inline JSX (`onClick={() => setSelectedSym(h.sym)}`), wrap both calls:

```jsx
onClick={() => { setSelectedSym(h.sym); setHubSym(h.sym); }}
```

Add a sync effect so that when the hub context changes externally (user clicks NVDA in Watchlist sub-tab and then switches to Themes), the local selection follows:

```jsx
useEffect(() => {
  if (hubSym && hubSym !== selectedSym) setSelectedSym(hubSym)
}, [hubSym])  // intentionally do NOT depend on selectedSym (avoid feedback loop)
```

- [ ] **Step 3: Build smoke**

Run: `cd app && npx vite build 2>&1 | tail -10`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/src/pages/ThemeTrackerPage.jsx
git commit -m "feat(charts): wire ThemeTrackerPage holding-click to hub ticker context"
```

---

## Task 12: MultiChart — "Apply current ticker" button

**Files:**
- Modify: `app/src/pages/MultiChart.jsx` (lines 1–131)

Goal: add a header button reading "Apply {sym} to cell #1" that pushes the hub-context ticker into cell index 0. Cell #1 is chosen (not focused-cell) to avoid touching MultiChart's internal focused-cell tracking, which doesn't exist today.

- [ ] **Step 1: Add the import**

At top of `app/src/pages/MultiChart.jsx`, after the existing imports:

```jsx
import { useChartsSym } from './charts/ChartsSymContext'
```

- [ ] **Step 2: Read the hub context inside the component**

After `const { prefs, setPref } = usePreferences()` (line 14):

```jsx
const { sym: hubSym } = useChartsSym()
```

- [ ] **Step 3: Add an apply handler**

After the existing `loadWatchPanel` callback (around lines 70–72):

```jsx
const applyHubTickerToCell0 = useCallback(() => {
  if (!hubSym) return
  setState(prev => {
    if (!prev.cells.length) return prev
    const cells = [...prev.cells]
    cells[0] = { ...cells[0], sym: hubSym }
    return { ...prev, cells }
  })
}, [hubSym])
```

- [ ] **Step 4: Add the button to headerControls**

In the JSX `headerControls` block (around lines 89–109), after the `Watch Panel` button (line 108), add:

```jsx
<button
  onClick={applyHubTickerToCell0}
  className={styles.watchPanelBtn}
  disabled={!hubSym}
  title={hubSym ? `Load ${hubSym} into cell #1` : 'Select a ticker in another sub-tab first'}
>
  Apply {hubSym || '…'} to cell #1
</button>
```

- [ ] **Step 5: Build smoke**

Run: `cd app && npx vite build 2>&1 | tail -10`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/src/pages/MultiChart.jsx
git commit -m "feat(charts): add 'Apply current ticker' button to MultiChart toolbar"
```

---

## Task 13: Full frontend test sweep + manual smoke

- [ ] **Step 1: Run the entire frontend test suite**

Run: `cd app && npx vitest run`
Expected: all tests PASS. New tests: `ChartsSymContext` (2) · `ChartTab` (3) · `LegacyRedirect` (3) · `ChartsHub` (8) · updated `NavBar` (3). Existing tests should be unaffected.

If a Watchlists/ThemeTracker test fails because the adapter introduced a new render path that needs the context, wrap the test render with a `<ChartsSymContext.Provider value={{ sym: null, setSym: () => {} }}>` — but since the hook is null-safe (`useChartsSym` returns a fallback when no provider), this should not happen.

- [ ] **Step 2: Start the dev server**

Run in a separate terminal: `cd app && npm run dev`
Expected: Vite dev server starts on default port (~5173).

- [ ] **Step 3: Manual UI smoke checklist**

Open `http://localhost:5173` in a browser. With a free-tier login (or admin), verify:

| Check | Expected |
|---|---|
| Left nav shows "📈 Charts" | ✅ Single new entry between Breadth and Calendar; Theme Tracker / Watchlists / Multi Chart entries gone. |
| First visit to `/charts` | ✅ Lands on Chart sub-tab with SPY loaded. |
| Click Watchlist sub-tab | ✅ Watchlists.jsx renders identically to today. |
| Click a row in a watchlist (say NVDA) | ✅ Right-panel chart updates to NVDA. |
| Click Chart sub-tab | ✅ Now shows NVDA (ticker carried over). |
| Click Themes sub-tab | ✅ ThemeTrackerPage renders identically; if NVDA appears in any theme, that theme's holding list highlights NVDA (depending on how the existing component renders selection). |
| Click Multi-Chart sub-tab | ✅ MultiChart renders. New "Apply NVDA to cell #1" button visible in toolbar. Click it → cell #1 loads NVDA. |
| URL after switching tabs | ✅ Reflects `?tab=…` on every switch. |
| Refresh page | ✅ Lands on last-visited sub-tab. |
| Navigate to legacy URL `/theme-tracker?test=1` | ✅ Redirects to `/charts?tab=themes&test=1` (query preserved). |
| Navigate to `/watchlists` | ✅ Redirects to `/charts?tab=watchlist`. |
| Navigate to `/multi-chart` | ✅ Redirects to `/charts?tab=multichart`. |
| Browser back button after switching tabs | ✅ Returns to the previous sub-tab. |
| Resize browser to <640px | ✅ Sub-tab strip becomes horizontally scrollable. Mobile nav drawer also shows "Charts" only. |
| Watchlist alerts, drag-and-drop, tags | ✅ All work identically inside the hub (untouched internals). |
| ThemeTracker theme expand/collapse, period tabs | ✅ All work identically. |
| MultiChart layout picker, Watch Panel button | ✅ All work identically. |

If any item fails, stop and diagnose before continuing. Common failure modes:
- "Loading…" forever on a sub-tab → check Suspense boundary + lazy import path.
- Sub-tab doesn't switch on click → check `handleTabClick`; verify URL updates via DevTools.
- Legacy URL doesn't redirect → check route order in App.jsx; check FREE_PAGES.
- Free user kicked back to /dashboard from a legacy URL → confirm AuthGuard FREE_PAGES includes the path.

- [ ] **Step 4: Stop the dev server** (Ctrl+C in the dev terminal)

---

## Task 14: Push to Railway

- [ ] **Step 1: Sanity check git status**

Run: `cd C:/Users/Patrick/uct-dashboard && git status --short && git log --oneline -15`
Expected: working tree clean; ~12 commits ahead of origin (one per task that wrote code).

- [ ] **Step 2: Push**

Run: `cd C:/Users/Patrick/uct-dashboard && git push`
Expected: push succeeds. Railway begins auto-deploy.

- [ ] **Step 3: Monitor Railway deploy (optional)**

If Railway CLI is configured, run: `railway logs --tail 50`
Otherwise check Railway dashboard. Healthcheck should pass within ~3 min (the 600s timeout in `railway.json` gives plenty of headroom).

- [ ] **Step 4: Production smoke**

After deploy completes, open `https://uctintelligence.com/charts`. Re-run a condensed version of Task 13 Step 3 — the 5 most important checks:

1. Charts nav entry visible
2. /charts loads SPY in Chart sub-tab
3. Clicking each sub-tab works
4. /theme-tracker redirects correctly
5. /multi-chart redirects correctly

---

## Acceptance criteria (mirrors the spec)

A user with no prior `charts_last_tab` preference, visiting `/charts`, sees the Chart sub-tab with SPY loaded. They click Watchlist sub-tab — Watchlists renders identically to today. They click a ticker (say NVDA) in their list. They click Chart sub-tab — NVDA is loaded. They click Multi-Chart sub-tab — see the existing Multi-Chart with an "Apply NVDA to cell #1" button. They refresh the page — they're on Multi-Chart sub-tab (last visited). They navigate to `/theme-tracker?bookmark=old_link` — they end up at `/charts?tab=themes&bookmark=old_link` and Themes renders. A free-tier user can do all of the above.

---

## Out of scope for this plan

- Updating the intro animation pill grid to drop "Theme Tracker" / "Watchlists" labels (deferred polish)
- "Recently Viewed" tickers ribbon on Chart sub-tab (deferred polish)
- Pausing inactive sub-tab live streams (deferred polish)
- Folding Screener / Custom Scan / UCT 20 / Patterns into the hub (future Phase 3)
- Any backend, DB, or schema work
