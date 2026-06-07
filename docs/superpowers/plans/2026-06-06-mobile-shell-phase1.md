# Mobile Shell (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hamburger-only mobile nav with a bottom **tab-bar shell** (Home · Markets · Charts · Journal · More) and stand up a global **Ticker Hub** host (provider + sheet) that any surface can open — the foundation Phases 2–8 hang off.

**Architecture:** A mobile-tailored presentation layer over the same routes/data. At ≤1024px (touch) the existing desktop sidebar (`NavBar`) hides and a fixed bottom `MobileTabBar` becomes primary nav; the existing `MobileNav` top header (title/alerts/movers) stays. A `TickerHubProvider` mounted in `Layout` exposes `openTicker(sym)` so any component can open a `TickerHubSheet`. Desktop (≥1025px) is unchanged.

**Tech Stack:** React + Vite, React Router v6, CSS Modules, existing `hooks/useBreakpoint.js` + `components/mobile/Sheet.jsx`, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-06-mobile-overhaul-design.md` (§4 shell, §6 Ticker Hub).

---

## File Structure

**Create:**
- `app/src/components/mobile/MobileTabBar.jsx` — the 5-item bottom tab bar (4 NavLinks + a "More" button).
- `app/src/components/mobile/MobileTabBar.module.css` — fixed bottom bar, safe-area, 44px targets, hidden ≥1025px.
- `app/src/components/mobile/MoreSheet.jsx` — the "More" tab target: a `Sheet` listing secondary destinations.
- `app/src/components/mobile/TickerHubContext.jsx` — `TickerHubProvider` + `useTickerHub()` (`openTicker`/`closeTicker`/`sym`).
- `app/src/components/mobile/TickerHubSheet.jsx` — the global ticker sheet (header + live price + Open-chart + Flag actions; full content lands in Phase 4).
- Tests alongside each: `*.test.jsx`.

**Modify:**
- `app/src/components/Layout.jsx` — wrap in `TickerHubProvider`; render `MobileTabBar` + `MoreSheet` + `TickerHubSheet`; own the More-sheet open state.
- `app/src/components/Layout.module.css` — bottom padding on `.main` at ≤1024px so content clears the bar.
- `app/src/components/NavBar.module.css` — hide the desktop sidebar at ≤1024px (was ≤640px).
- `app/src/components/MobileNav.module.css` — show the mobile header at ≤1024px (was ≤640px).

---

## Task 1: MobileTabBar component

**Files:**
- Create: `app/src/components/mobile/MobileTabBar.jsx`
- Create: `app/src/components/mobile/MobileTabBar.module.css`
- Test: `app/src/components/mobile/MobileTabBar.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/components/mobile/MobileTabBar.test.jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import MobileTabBar from './MobileTabBar'

function renderAt(path, onMore = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MobileTabBar onMore={onMore} />
    </MemoryRouter>,
  )
}

test('renders all five tabs', () => {
  renderAt('/dashboard')
  ;['Home', 'Markets', 'Charts', 'Journal', 'More'].forEach((label) =>
    expect(screen.getByText(label)).toBeInTheDocument(),
  )
})

test('Home tab is active on /dashboard', () => {
  renderAt('/dashboard')
  expect(screen.getByText('Home').closest('a')).toHaveAttribute('aria-current', 'page')
})

test('Markets tab is active on a Markets sub-route (/options-flow)', () => {
  renderAt('/options-flow')
  expect(screen.getByText('Markets').closest('a')).toHaveAttribute('aria-current', 'page')
})

test('More button fires onMore', () => {
  const onMore = vi.fn()
  renderAt('/dashboard', onMore)
  fireEvent.click(screen.getByText('More'))
  expect(onMore).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/components/mobile/MobileTabBar.test.jsx`
Expected: FAIL — "Failed to resolve import './MobileTabBar'".

- [ ] **Step 3: Write the component**

```jsx
// app/src/components/mobile/MobileTabBar.jsx
import { NavLink, useLocation } from 'react-router-dom'
import styles from './MobileTabBar.module.css'

// 4 routed tabs + a "More" button. `match` = path prefixes that light the tab.
const TABS = [
  { key: 'home', label: 'Home', icon: '⌂', to: '/dashboard', match: ['/dashboard'] },
  { key: 'markets', label: 'Markets', icon: '◳', to: '/breadth',
    match: ['/breadth', '/options-flow', '/dark-pool', '/post-market', '/screener', '/patterns', '/calendar', '/catalysts'] },
  { key: 'charts', label: 'Charts', icon: '📈', to: '/charts',
    match: ['/charts', '/watchlists', '/theme-tracker', '/multi-chart'] },
  { key: 'journal', label: 'Journal', icon: '📓', to: '/journal', match: ['/journal'] },
]

export default function MobileTabBar({ onMore }) {
  const { pathname } = useLocation()
  const matchesMore = !TABS.some((t) => t.match.some((p) => pathname.startsWith(p)))

  return (
    <nav className={styles.bar} role="navigation" aria-label="Primary">
      {TABS.map((t) => {
        const active = t.match.some((p) => pathname.startsWith(p))
        return (
          <NavLink
            key={t.key}
            to={t.to}
            className={`${styles.tab} ${active ? styles.active : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <span className={styles.icon} aria-hidden="true">{t.icon}</span>
            <span className={styles.label}>{t.label}</span>
          </NavLink>
        )
      })}
      <button
        type="button"
        className={`${styles.tab} ${matchesMore ? styles.active : ''}`}
        onClick={onMore}
        aria-current={matchesMore ? 'page' : undefined}
      >
        <span className={styles.icon} aria-hidden="true">⋯</span>
        <span className={styles.label}>More</span>
      </button>
    </nav>
  )
}
```

- [ ] **Step 4: Write the styles**

```css
/* app/src/components/mobile/MobileTabBar.module.css */
.bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: var(--z-nav);
  display: flex;
  background: var(--bg-surface);
  border-top: 1px solid var(--border);
  padding-bottom: env(safe-area-inset-bottom);
}
.tab {
  flex: 1;
  min-height: var(--tap-min);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 6px 2px 8px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  font-family: var(--font-sans);
  text-decoration: none;
}
.tab.active { color: var(--ut-gold); }
.icon { font-size: 18px; line-height: 1; }
.label { font-size: 10px; font-weight: 600; letter-spacing: 0.2px; }

/* Desktop keeps the left sidebar — hide the bottom bar. */
@media (min-width: 1025px) {
  .bar { display: none; }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run src/components/mobile/MobileTabBar.test.jsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add app/src/components/mobile/MobileTabBar.jsx app/src/components/mobile/MobileTabBar.module.css app/src/components/mobile/MobileTabBar.test.jsx
git commit -m "feat(mobile): bottom tab bar component"
```

---

## Task 2: MoreSheet (the "More" tab target)

**Files:**
- Create: `app/src/components/mobile/MoreSheet.jsx`
- Test: `app/src/components/mobile/MoreSheet.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/components/mobile/MoreSheet.test.jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import MoreSheet from './MoreSheet'

function renderSheet(props = {}) {
  return render(
    <MemoryRouter>
      <MoreSheet open onClose={vi.fn()} {...props} />
    </MemoryRouter>,
  )
}

test('renders secondary destinations', () => {
  renderSheet()
  ;['UCT 20', 'Model Book', 'Setup Library', 'Morning Wire', 'Settings'].forEach((label) =>
    expect(screen.getByText(label)).toBeInTheDocument(),
  )
})

test('clicking a link calls onClose', () => {
  const onClose = vi.fn()
  renderSheet({ onClose })
  fireEvent.click(screen.getByText('Settings'))
  expect(onClose).toHaveBeenCalled()
})

test('renders nothing when closed', () => {
  render(<MemoryRouter><MoreSheet open={false} onClose={vi.fn()} /></MemoryRouter>)
  expect(screen.queryByText('Settings')).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/components/mobile/MoreSheet.test.jsx`
Expected: FAIL — "Failed to resolve import './MoreSheet'".

- [ ] **Step 3: Write the component**

```jsx
// app/src/components/mobile/MoreSheet.jsx
import { useNavigate } from 'react-router-dom'
import Sheet from './Sheet'
import styles from './MoreSheet.module.css'

const LINKS = [
  { to: '/uct-20', label: 'UCT 20', icon: '⭐' },
  { to: '/morning-wire', label: 'Morning Wire', icon: '📰' },
  { to: '/model-book', label: 'Model Book', icon: '📚' },
  { to: '/setup-library', label: 'Setup Library', icon: '🗂' },
  { to: '/support', label: 'Support', icon: '💬' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
]

export default function MoreSheet({ open, onClose }) {
  const navigate = useNavigate()
  if (!open) return null
  const go = (to) => { onClose?.(); navigate(to) }
  return (
    <Sheet open onClose={onClose} variant="bottom-sheet" title="More">
      <div className={styles.list}>
        {LINKS.map((l) => (
          <button key={l.to} type="button" className={styles.item} onClick={() => go(l.to)}>
            <span className={styles.icon} aria-hidden="true">{l.icon}</span>
            <span>{l.label}</span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}
```

- [ ] **Step 4: Write the styles**

```css
/* app/src/components/mobile/MoreSheet.module.css */
.list { display: flex; flex-direction: column; }
.item {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  width: 100%;
  min-height: var(--tap-min);
  padding: var(--space-md);
  background: none;
  border: none;
  border-bottom: 1px solid var(--border);
  color: var(--text-bright);
  font-family: var(--font-sans);
  font-size: var(--text-lg);
  text-align: left;
  cursor: pointer;
}
.item:last-child { border-bottom: none; }
.item:active { background: var(--bg-hover); }
.icon { width: 24px; text-align: center; font-size: var(--text-xl); }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run src/components/mobile/MoreSheet.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add app/src/components/mobile/MoreSheet.jsx app/src/components/mobile/MoreSheet.module.css app/src/components/mobile/MoreSheet.test.jsx
git commit -m "feat(mobile): More sheet for secondary destinations"
```

---

## Task 3: TickerHub context + hook

**Files:**
- Create: `app/src/components/mobile/TickerHubContext.jsx`
- Test: `app/src/components/mobile/TickerHubContext.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/components/mobile/TickerHubContext.test.jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { TickerHubProvider, useTickerHub } from './TickerHubContext'

function Probe() {
  const { sym, openTicker, closeTicker } = useTickerHub()
  return (
    <div>
      <span data-testid="sym">{sym ?? 'none'}</span>
      <button onClick={() => openTicker('nvda')}>open</button>
      <button onClick={closeTicker}>close</button>
    </div>
  )
}

test('openTicker sets an upper-cased sym; closeTicker clears it', () => {
  render(<TickerHubProvider><Probe /></TickerHubProvider>)
  expect(screen.getByTestId('sym').textContent).toBe('none')
  fireEvent.click(screen.getByText('open'))
  expect(screen.getByTestId('sym').textContent).toBe('NVDA')
  fireEvent.click(screen.getByText('close'))
  expect(screen.getByTestId('sym').textContent).toBe('none')
})

test('useTickerHub outside a provider returns a no-op (sym null)', () => {
  function Bare() {
    const { sym } = useTickerHub()
    return <span data-testid="bare">{sym ?? 'null'}</span>
  }
  render(<Bare />)
  expect(screen.getByTestId('bare').textContent).toBe('null')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/components/mobile/TickerHubContext.test.jsx`
Expected: FAIL — "Failed to resolve import './TickerHubContext'".

- [ ] **Step 3: Write the context**

```jsx
// app/src/components/mobile/TickerHubContext.jsx
import { createContext, useContext, useState, useCallback, useMemo } from 'react'

// Safe default so useTickerHub() works even outside a provider (no-op).
const TickerHubContext = createContext({ sym: null, openTicker: () => {}, closeTicker: () => {} })

export function TickerHubProvider({ children }) {
  const [sym, setSym] = useState(null)
  const openTicker = useCallback((s) => { if (s) setSym(String(s).toUpperCase()) }, [])
  const closeTicker = useCallback(() => setSym(null), [])
  const value = useMemo(() => ({ sym, openTicker, closeTicker }), [sym, openTicker, closeTicker])
  return <TickerHubContext.Provider value={value}>{children}</TickerHubContext.Provider>
}

export function useTickerHub() {
  return useContext(TickerHubContext)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/components/mobile/TickerHubContext.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/components/mobile/TickerHubContext.jsx app/src/components/mobile/TickerHubContext.test.jsx
git commit -m "feat(mobile): TickerHub context + useTickerHub hook"
```

---

## Task 4: TickerHubSheet (minimal host UI)

**Files:**
- Create: `app/src/components/mobile/TickerHubSheet.jsx`
- Create: `app/src/components/mobile/TickerHubSheet.module.css`
- Test: `app/src/components/mobile/TickerHubSheet.test.jsx`

Note: full Hub content (mini-chart, alerts, why-it's-moving) lands in Phase 4. Phase 1 ships header + two real actions (Open chart, Flag) to prove the plumbing.

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/components/mobile/TickerHubSheet.test.jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => navigateMock }))
// Stub the flag + live-price hooks so the sheet renders in isolation.
vi.mock('../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: vi.fn() }) }))
vi.mock('../../hooks/useLivePrices', () => ({ default: () => ({ prices: {} }) }))

import { TickerHubProvider, useTickerHub } from './TickerHubContext'
import TickerHubSheet from './TickerHubSheet'

function Opener() {
  const { openTicker } = useTickerHub()
  return <button onClick={() => openTicker('AAPL')}>open AAPL</button>
}

function Harness() {
  return (
    <MemoryRouter>
      <TickerHubProvider>
        <Opener />
        <TickerHubSheet />
      </TickerHubProvider>
    </MemoryRouter>
  )
}

test('is closed until a ticker is opened', () => {
  render(<Harness />)
  expect(screen.queryByText('AAPL')).toBeNull()
})

test('opens with the sym header and action buttons', () => {
  render(<Harness />)
  fireEvent.click(screen.getByText('open AAPL'))
  expect(screen.getByText('AAPL')).toBeInTheDocument()
  expect(screen.getByText('Chart')).toBeInTheDocument()
  expect(screen.getByText('Flag')).toBeInTheDocument()
})

test('Chart action navigates to /charts', () => {
  render(<Harness />)
  fireEvent.click(screen.getByText('open AAPL'))
  fireEvent.click(screen.getByText('Chart'))
  expect(navigateMock).toHaveBeenCalledWith('/charts')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/components/mobile/TickerHubSheet.test.jsx`
Expected: FAIL — "Failed to resolve import './TickerHubSheet'".

- [ ] **Step 3: Write the component**

```jsx
// app/src/components/mobile/TickerHubSheet.jsx
import { useNavigate } from 'react-router-dom'
import Sheet from './Sheet'
import { useTickerHub } from './TickerHubContext'
import { useFlagged } from '../../hooks/useFlagged'
import useLivePrices from '../../hooks/useLivePrices'
import styles from './TickerHubSheet.module.css'

export default function TickerHubSheet() {
  const { sym, closeTicker } = useTickerHub()
  const navigate = useNavigate()
  const { isFlagged, toggle } = useFlagged()
  const { prices } = useLivePrices(sym ? [sym] : [])

  if (!sym) return null
  const live = prices[sym] || prices[String(sym).toUpperCase()]
  const flagged = isFlagged(sym)

  const openChart = () => {
    try { localStorage.setItem('charts_mobile_sym', sym) } catch { /* noop */ }
    closeTicker()
    navigate('/charts')
  }

  return (
    <Sheet open onClose={closeTicker} variant="bottom-sheet" title={sym}>
      <div className={styles.body}>
        {live?.price != null && (
          <div className={styles.quote}>
            <span className={styles.price}>${live.price.toFixed(2)}</span>
            {live.change_pct != null && (
              <span className={live.change_pct >= 0 ? styles.up : styles.down}>
                {live.change_pct >= 0 ? '+' : ''}{live.change_pct.toFixed(2)}%
              </span>
            )}
          </div>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.action} onClick={openChart}>
            <span className={styles.aicon} aria-hidden="true">📈</span>Chart
          </button>
          <button
            type="button"
            className={`${styles.action} ${flagged ? styles.on : ''}`}
            onClick={() => toggle(sym)}
          >
            <span className={styles.aicon} aria-hidden="true">⚑</span>Flag
          </button>
        </div>
        <p className={styles.note}>More — alerts, journal, Compass — coming to this hub next.</p>
      </div>
    </Sheet>
  )
}
```

- [ ] **Step 4: Write the styles**

```css
/* app/src/components/mobile/TickerHubSheet.module.css */
.body { display: flex; flex-direction: column; gap: var(--space-lg); }
.quote { display: flex; align-items: baseline; gap: var(--space-md); }
.price { font-family: var(--font-mono); font-size: var(--text-2xl); color: var(--text-heading); }
.up { color: var(--gain); font-weight: 600; }
.down { color: var(--loss); font-weight: 600; }
.actions { display: flex; gap: var(--space-sm); }
.action {
  flex: 1;
  min-height: var(--tap-min);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: var(--space-sm);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  color: var(--text-bright);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  cursor: pointer;
}
.action.on { color: var(--ut-gold); border-color: var(--ut-gold); }
.aicon { font-size: var(--text-xl); }
.note { color: var(--text-muted); font-size: var(--text-sm); }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run src/components/mobile/TickerHubSheet.test.jsx`
Expected: PASS (3 tests). If `useFlagged`/`useLivePrices` export shapes differ, adjust the mocks AND imports to match the real modules (verify with `grep -n "export" app/src/hooks/useFlagged.js app/src/hooks/useLivePrices.js`).

- [ ] **Step 6: Commit**

```bash
git add app/src/components/mobile/TickerHubSheet.jsx app/src/components/mobile/TickerHubSheet.module.css app/src/components/mobile/TickerHubSheet.test.jsx
git commit -m "feat(mobile): minimal TickerHub sheet (header + chart/flag actions)"
```

---

## Task 5: Wire the shell into Layout

**Files:**
- Modify: `app/src/components/Layout.jsx`
- Modify: `app/src/components/Layout.module.css`
- Test: `app/src/components/Layout.test.jsx` (exists — extend it)

- [ ] **Step 1: Add a failing test to the existing Layout test**

Append to `app/src/components/Layout.test.jsx` (keep existing tests intact):

```jsx
test('renders the mobile tab bar (Home/Markets/Charts/Journal/More)', () => {
  // Layout is already rendered by the existing suite's helper; if not, render it:
  // render(<MemoryRouter><Layout><div>child</div></Layout></MemoryRouter>)
  // Assert the new bottom-bar labels are present.
})
```

If the existing `Layout.test.jsx` already renders `Layout` inside a router, reuse that setup and assert:

```jsx
expect(screen.getByText('Markets')).toBeInTheDocument()
expect(screen.getByText('Journal')).toBeInTheDocument()
```

First read the file: `Read app/src/components/Layout.test.jsx` and mirror its existing render helper + mocks (NavBar/MobileNav are likely mocked). Add the assertion as a new `test(...)`.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run src/components/Layout.test.jsx`
Expected: FAIL — "Markets" not found (tab bar not wired yet).

- [ ] **Step 3: Modify Layout.jsx**

Replace the imports + the `return (...)` body:

```jsx
// add to the import block at the top of app/src/components/Layout.jsx
import { useState } from 'react'
import MobileTabBar from './mobile/MobileTabBar'
import MoreSheet from './mobile/MoreSheet'
import { TickerHubProvider } from './mobile/TickerHubContext'
import TickerHubSheet from './mobile/TickerHubSheet'
```

(Ensure `useState` is added to the existing `react` import rather than duplicated.) Then change the returned JSX:

```jsx
  const [moreOpen, setMoreOpen] = useState(false)

  return (
    <TickerHubProvider>
      <div className={styles.shell}>
        {/* Desktop sidebar — hidden at <=1024px via CSS */}
        <NavBar />
        {/* Mobile header + drawer — shown at <=1024px via CSS */}
        <MobileNav />
        <main className={styles.main}>
          {children ?? <Outlet />}
        </main>
        <FeedbackWidget />
        {/* Mobile primary nav + global hosts */}
        <MobileTabBar onMore={() => setMoreOpen(true)} />
        <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
        <TickerHubSheet />
      </div>
    </TickerHubProvider>
  )
```

- [ ] **Step 4: Add bottom padding so content clears the bar**

Append to `app/src/components/Layout.module.css`:

```css
/* Clear the fixed bottom tab bar on touch (the bar is ~58px + safe-area). */
@media (max-width: 1024px) {
  .main {
    padding-bottom: calc(58px + env(safe-area-inset-bottom, 0px));
  }
}
```

- [ ] **Step 5: Run the Layout test to verify it passes**

Run: `cd app && npx vitest run src/components/Layout.test.jsx`
Expected: PASS (existing tests + the new tab-bar assertion).

- [ ] **Step 6: Commit**

```bash
git add app/src/components/Layout.jsx app/src/components/Layout.module.css app/src/components/Layout.test.jsx
git commit -m "feat(mobile): wire tab bar + More sheet + TickerHub host into Layout"
```

---

## Task 6: Shift the shell breakpoint 640 → 1024 (tablet uses the mobile shell)

The desktop sidebar currently hides at ≤640px and the mobile header shows at ≤640px. The spec puts tablets (641–1024px) on the mobile shell, so move both boundaries to 1024px.

**Files:**
- Modify: `app/src/components/NavBar.module.css`
- Modify: `app/src/components/MobileNav.module.css`

- [ ] **Step 1: Find the current breakpoints**

Run: `cd app && grep -n "max-width: 640px\|min-width: 641px" src/components/NavBar.module.css src/components/MobileNav.module.css`
Expected: the rules that hide `.nav` (NavBar) and show `.topBar`/`.drawer` (MobileNav).

- [ ] **Step 2: Edit NavBar.module.css**

Change the media query that hides the sidebar from `@media (max-width: 640px)` to `@media (max-width: 1024px)` (only the rule whose body is `.nav { display: none }` or equivalent — do not blanket-replace unrelated 640 rules). If NavBar has no such rule, add:

```css
@media (max-width: 1024px) {
  .nav { display: none !important; }
}
```

- [ ] **Step 3: Edit MobileNav.module.css**

Change the `@media (min-width: 641px) { ... display: none ... }` guard that *hides* the mobile header on desktop to `@media (min-width: 1025px)`, so the header shows through 1024px. Verify the topBar/drawer show at ≤1024 afterward.

- [ ] **Step 4: Verify the build**

Run: `cd app && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/NavBar.module.css app/src/components/MobileNav.module.css
git commit -m "feat(mobile): mobile shell now spans tablet (<=1024px), not just phones"
```

---

## Task 7: Full verification + ship

- [ ] **Step 1: Run the full frontend test suite**

Run: `cd app && npx vitest run`
Expected: all suites pass except the 3 known pre-existing failures (NavBar "calendar link", useWatermarkDrag ×2) noted in the spec. If any NEW failure appears, fix it before continuing.

- [ ] **Step 2: Build**

Run: `cd app && npm run build`
Expected: PASS.

- [ ] **Step 3: Mobile audit (phone + tablet)**

Start the local admin backend per CLAUDE.md "Mobile audit harness", then:

Run (PowerShell):
```
$env:MOBILE_AUDIT_EMAIL="mobtest@local.dev"; $env:MOBILE_AUDIT_PASSWORD="LocalTest2026!"
python tools/mobile_audit.py --base http://localhost:8077 --auth --routes /dashboard /breadth /charts /journal
python tools/mobile_audit.py --base http://localhost:8077 --auth --viewport tablet --routes /dashboard /breadth /charts /journal
```
Expected: 0 horizontal overflow. Open `tools/mobile_audit_out/phone/dashboard.png` and confirm the **bottom tab bar** renders and content isn't hidden behind it; confirm the desktop sidebar is gone at tablet width.

- [ ] **Step 4: Push**

```bash
git pull --rebase
git push
```

---

## Self-review notes

- **Spec coverage:** This plan implements spec §4 (bottom-tab workflow spine) and the §6 Ticker Hub **host** (full Hub content is explicitly Phase 4). Markets/Journal chip sub-nav is a thin part of later Markets/Journal phases (the tabs route to existing pages in Phase 1); not blocking the shell.
- **Known risk:** Task 6 moves tablets onto the mobile shell — verify tablet screenshots in Task 7 Step 3. If undesired, the fallback is to keep the bar phone-only (revert the two media-query edits to 640px); the tab bar already self-hides ≥1025px so it would simply not appear on tablet.
- **Hook export shapes:** Task 4 assumes `useFlagged` is a named export returning `{ isFlagged, toggle }` and `useLivePrices` is a default export returning `{ prices }`. Both are used that way elsewhere (TickerPopup, CatalystTable) — verify before implementing and adjust mocks/imports if needed.
- **No placeholders:** every step ships real code; the Hub's "more coming" note is shipped copy, not a code TODO.
