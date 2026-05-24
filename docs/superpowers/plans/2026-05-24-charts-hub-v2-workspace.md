# Charts Hub V2 — Customizable Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace V1's sub-tab Charts Hub with a customizable `react-grid-layout` workspace where Chart, Watchlist, Themes, and Scanner widgets can be placed anywhere, with TradingView-style color-group ticker linking and a single auto-saved layout per user.

**Architecture:** A new `ChartsWorkspace` shell owns layout state, persists to `usePreferences`, and provides a `WorkspaceContext` of 4 color groups (A/B/C/D). Each color group holds one ticker. Widget components wrap existing pages (Watchlists, ThemeTrackerPage, Screener) via a per-widget `ChartsSymContext.Provider` override that routes their `useChartsSym` calls into the widget's chosen color group. Mobile (`<640px`) bypasses the workspace entirely with a single full-screen chart.

**Tech Stack:** React 18, react-router-dom v6, react-grid-layout v1.4+, Vite, Vitest + @testing-library/react, existing `usePreferences` hook, existing `StockChart` component.

**Spec:** `docs/superpowers/specs/2026-05-24-charts-hub-v2-workspace-design.md`

---

## File Structure

**Created (21 files):**

```
app/src/hooks/
├── useMediaQuery.js
└── useMediaQuery.test.jsx

app/src/pages/charts/
├── WorkspaceContext.jsx              # Color group context + useWorkspace() hook
├── WorkspaceContext.test.jsx
├── WidgetHeader.jsx                  # Drag handle, color picker, close button
├── WidgetHeader.test.jsx
├── WidgetHost.jsx                    # Type dispatcher (chart/watchlist/themes/scanner)
├── WidgetHost.test.jsx
├── ChartsWorkspace.jsx               # New top-level — grid, persistence, mobile detect, +Add Widget
├── ChartsWorkspace.test.jsx
├── ChartsWorkspace.module.css
└── widgets/
    ├── ChartWidget.jsx               # Wraps StockChart; reads/writes its color group
    ├── ChartWidget.test.jsx
    ├── WatchlistWidget.jsx           # Wraps Watchlists with embedded prop + scoped context
    ├── WatchlistWidget.test.jsx
    ├── ThemesWidget.jsx              # Wraps ThemeTrackerPage similarly
    ├── ThemesWidget.test.jsx
    ├── ScannerWidget.jsx             # Wraps Screener similarly
    ├── ScannerWidget.test.jsx
    ├── MobileChartFallback.jsx       # Full-screen StockChart for <640px
    └── MobileChartFallback.test.jsx
```

**Modified (7 files):**

| File | Change |
|---|---|
| `app/package.json` | Add `react-grid-layout` dependency |
| `app/src/App.jsx` | Swap `ChartsHub` import for `ChartsWorkspace`; update `/charts` route element |
| `app/src/pages/charts/ChartsSymContext.jsx` | Reduce to deprecated wrapper around `useWorkspace()` Group A |
| `app/src/pages/charts/ChartsSymContext.test.jsx` | Update tests for new shim behavior |
| `app/src/pages/charts/LegacyRedirect.jsx` | Strip `?tab=` from destination (since sub-tabs no longer exist) |
| `app/src/pages/charts/LegacyRedirect.test.jsx` | Update test assertions for new behavior |
| `app/src/pages/Watchlists.jsx` | Add `embedded` prop — hides right-side `StockChart` when true |
| `app/src/pages/ThemeTrackerPage.jsx` | Add `embedded` prop — hides right-side `StockChart` when true |
| `app/src/pages/Screener.jsx` | Add `embedded` prop — compact header / padding when true |

**Deleted (5 files):**

```
app/src/pages/charts/ChartsHub.jsx                # Replaced by ChartsWorkspace.jsx
app/src/pages/charts/ChartsHub.test.jsx
app/src/pages/charts/ChartsHub.module.css
app/src/pages/charts/ChartTab.jsx                 # Replaced by widgets/ChartWidget.jsx
app/src/pages/charts/ChartTab.test.jsx
```

---

## Task 1: Install react-grid-layout

**Files:** `app/package.json` + `app/package-lock.json`

- [ ] **Step 1: Install the dependency**

Run: `cd app && npm install react-grid-layout@^1.4.4`
Expected: dependency added to `package.json`, lock file updated, no audit failures.

- [ ] **Step 2: Verify install**

Run: `cd app && npm ls react-grid-layout 2>&1 | head -5`
Expected: shows `react-grid-layout@1.4.x` resolved.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/package.json app/package-lock.json
git commit -m "chore(charts): add react-grid-layout dependency for V2 workspace"
```

---

## Task 2: useMediaQuery hook

**Files:**
- Create: `app/src/hooks/useMediaQuery.js`
- Create: `app/src/hooks/useMediaQuery.test.jsx`

- [ ] **Step 1: Write the failing test**

Write `app/src/hooks/useMediaQuery.test.jsx`:

```jsx
import { render, screen, act } from '@testing-library/react'
import { vi } from 'vitest'
import useMediaQuery from './useMediaQuery'

let mqListeners = []
let mqMatches = false

beforeEach(() => {
  mqListeners = []
  mqMatches = false
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation(query => ({
    matches: mqMatches,
    media: query,
    addEventListener: (_event, fn) => { mqListeners.push(fn) },
    removeEventListener: (_event, fn) => { mqListeners = mqListeners.filter(f => f !== fn) },
  })))
})

function Probe({ query }) {
  const matches = useMediaQuery(query)
  return <span data-testid="matches">{String(matches)}</span>
}

test('returns initial match state from matchMedia', () => {
  mqMatches = true
  render(<Probe query="(max-width: 640px)" />)
  expect(screen.getByTestId('matches').textContent).toBe('true')
})

test('returns false when matchMedia returns false', () => {
  mqMatches = false
  render(<Probe query="(max-width: 640px)" />)
  expect(screen.getByTestId('matches').textContent).toBe('false')
})

test('updates when matchMedia change event fires', () => {
  mqMatches = false
  render(<Probe query="(max-width: 640px)" />)
  expect(screen.getByTestId('matches').textContent).toBe('false')
  act(() => {
    mqListeners.forEach(fn => fn({ matches: true }))
  })
  expect(screen.getByTestId('matches').textContent).toBe('true')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/hooks/useMediaQuery.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Write `app/src/hooks/useMediaQuery.js`:

```js
import { useEffect, useState } from 'react'

export default function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(query)
    const handler = (e) => setMatches(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [query])

  return matches
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/hooks/useMediaQuery.test.jsx`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/src/hooks/useMediaQuery.js app/src/hooks/useMediaQuery.test.jsx
git commit -m "feat(hooks): add useMediaQuery hook for responsive breakpoints"
```

---

## Task 3: WorkspaceContext + useWorkspace hook

**Files:**
- Create: `app/src/pages/charts/WorkspaceContext.jsx`
- Create: `app/src/pages/charts/WorkspaceContext.test.jsx`

`WorkspaceContext` holds 4 color groups (A/B/C/D), each with one ticker. `useWorkspace()` returns `{ groupSyms, setGroupSym }`. Null-safe fallback when no provider.

- [ ] **Step 1: Write the failing test**

Write `app/src/pages/charts/WorkspaceContext.test.jsx`:

```jsx
import { render, screen, act } from '@testing-library/react'
import { useState } from 'react'
import { WorkspaceContext, useWorkspace } from './WorkspaceContext'

function Probe({ color }) {
  const { groupSyms, setGroupSym } = useWorkspace()
  return (
    <div>
      <span data-testid={`sym-${color}`}>{groupSyms[color] ?? 'null'}</span>
      <button onClick={() => setGroupSym(color, 'NVDA')}>{`set-${color}`}</button>
    </div>
  )
}

test('useWorkspace returns empty groups + no-op setter when used outside provider', () => {
  render(<Probe color="A" />)
  expect(screen.getByTestId('sym-A').textContent).toBe('null')
  screen.getByText('set-A').click()
  expect(screen.getByTestId('sym-A').textContent).toBe('null')
})

test('reads and writes color group through the provider', () => {
  function Wrapper() {
    const [groupSyms, setGroupSyms] = useState({ A: null, B: null, C: null, D: null })
    const setGroupSym = (color, sym) => {
      setGroupSyms(prev => ({ ...prev, [color]: sym }))
    }
    return (
      <WorkspaceContext.Provider value={{ groupSyms, setGroupSym }}>
        <Probe color="A" />
        <Probe color="B" />
      </WorkspaceContext.Provider>
    )
  }
  render(<Wrapper />)
  expect(screen.getByTestId('sym-A').textContent).toBe('null')
  expect(screen.getByTestId('sym-B').textContent).toBe('null')
  act(() => { screen.getByText('set-A').click() })
  expect(screen.getByTestId('sym-A').textContent).toBe('NVDA')
  expect(screen.getByTestId('sym-B').textContent).toBe('null')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/charts/WorkspaceContext.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the context + hook**

Write `app/src/pages/charts/WorkspaceContext.jsx`:

```jsx
import { createContext, useContext } from 'react'

export const WorkspaceContext = createContext(null)

const FALLBACK = {
  groupSyms: { A: null, B: null, C: null, D: null },
  setGroupSym: () => {},
}

export function useWorkspace() {
  return useContext(WorkspaceContext) || FALLBACK
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/charts/WorkspaceContext.test.jsx`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/src/pages/charts/WorkspaceContext.jsx app/src/pages/charts/WorkspaceContext.test.jsx
git commit -m "feat(charts): add WorkspaceContext + useWorkspace hook for color groups"
```

---

## Task 4: Shim ChartsSymContext to route through WorkspaceContext

**Files:**
- Modify: `app/src/pages/charts/ChartsSymContext.jsx`
- Modify: `app/src/pages/charts/ChartsSymContext.test.jsx`

V1's `useChartsSym` is called by Watchlists, ThemeTrackerPage, and MultiChart adapters. We re-implement it as a thin wrapper that maps to Group A of the WorkspaceContext, so V1 callers stay backwards-compatible without code change.

- [ ] **Step 1: Replace the test file**

Replace the contents of `app/src/pages/charts/ChartsSymContext.test.jsx`:

```jsx
import { render, screen, act } from '@testing-library/react'
import { useState } from 'react'
import { ChartsSymContext, useChartsSym } from './ChartsSymContext'
import { WorkspaceContext } from './WorkspaceContext'

function Probe() {
  const { sym, setSym } = useChartsSym()
  return (
    <div>
      <span data-testid="sym">{sym ?? 'null'}</span>
      <button onClick={() => setSym('NVDA')}>set</button>
    </div>
  )
}

test('useChartsSym returns null + no-op setter outside any provider', () => {
  render(<Probe />)
  expect(screen.getByTestId('sym').textContent).toBe('null')
  screen.getByText('set').click()
  expect(screen.getByTestId('sym').textContent).toBe('null')
})

test('useChartsSym maps to Group A of WorkspaceContext when WorkspaceContext is present', () => {
  function Wrapper() {
    const [groupSyms, setGroupSyms] = useState({ A: null, B: null, C: null, D: null })
    const setGroupSym = (color, sym) => {
      setGroupSyms(prev => ({ ...prev, [color]: sym }))
    }
    return (
      <WorkspaceContext.Provider value={{ groupSyms, setGroupSym }}>
        <Probe />
      </WorkspaceContext.Provider>
    )
  }
  render(<Wrapper />)
  expect(screen.getByTestId('sym').textContent).toBe('null')
  act(() => { screen.getByText('set').click() })
  expect(screen.getByTestId('sym').textContent).toBe('NVDA')
})

test('explicit ChartsSymContext provider still overrides (per-widget scope)', () => {
  function Wrapper() {
    const [sym, setSym] = useState('AAPL')
    return (
      <ChartsSymContext.Provider value={{ sym, setSym }}>
        <Probe />
      </ChartsSymContext.Provider>
    )
  }
  render(<Wrapper />)
  expect(screen.getByTestId('sym').textContent).toBe('AAPL')
  act(() => { screen.getByText('set').click() })
  expect(screen.getByTestId('sym').textContent).toBe('NVDA')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/charts/ChartsSymContext.test.jsx`
Expected: FAIL — current implementation uses its own static context, doesn't read from WorkspaceContext.

- [ ] **Step 3: Replace the implementation**

Replace the contents of `app/src/pages/charts/ChartsSymContext.jsx`:

```jsx
import { createContext, useContext } from 'react'
import { useWorkspace } from './WorkspaceContext'

// V1 context kept for explicit per-widget overrides (e.g., WatchlistWidget
// passes its own provider so the wrapped Watchlists publishes into the
// widget's chosen color group, not Group A).
export const ChartsSymContext = createContext(null)

/**
 * V1-compatible hook. Resolution order:
 *   1) Explicit ChartsSymContext.Provider (per-widget scoping)
 *   2) WorkspaceContext Group A (V1 callers like Watchlists/ThemeTrackerPage
 *      adapters that haven't been migrated to color-group-aware widgets)
 *   3) Null-safe fallback ({ sym: null, setSym: () => {} })
 */
export function useChartsSym() {
  const explicit = useContext(ChartsSymContext)
  const workspace = useWorkspace()
  if (explicit) return explicit
  return {
    sym: workspace.groupSyms.A,
    setSym: (s) => workspace.setGroupSym('A', s),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/charts/ChartsSymContext.test.jsx`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/src/pages/charts/ChartsSymContext.jsx app/src/pages/charts/ChartsSymContext.test.jsx
git commit -m "refactor(charts): shim ChartsSymContext to route through WorkspaceContext Group A"
```

---

## Task 5: WidgetHeader — drag handle, color picker, close button

**Files:**
- Create: `app/src/pages/charts/WidgetHeader.jsx`
- Create: `app/src/pages/charts/WidgetHeader.test.jsx`

The widget header is shared across all 4 widget types. It hosts:
- A `⋮⋮` drag grip (the className `charts-widget-drag-handle` is later consumed by react-grid-layout's `draggableHandle` option)
- A color dot button — click to cycle A→B→C→D→A
- A label (passed via prop)
- A `✕` close button

- [ ] **Step 1: Write the failing test**

Write `app/src/pages/charts/WidgetHeader.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import WidgetHeader from './WidgetHeader'

test('renders the label', () => {
  render(<WidgetHeader label="My Widget" color="A" onColorChange={() => {}} onRemove={() => {}} />)
  expect(screen.getByText('My Widget')).toBeInTheDocument()
})

test('renders the drag handle with the react-grid-layout className', () => {
  const { container } = render(<WidgetHeader label="W" color="A" onColorChange={() => {}} onRemove={() => {}} />)
  expect(container.querySelector('.charts-widget-drag-handle')).toBeInTheDocument()
})

test('color dot click cycles A → B → C → D → A', () => {
  const onColorChange = vi.fn()
  const { rerender } = render(<WidgetHeader label="W" color="A" onColorChange={onColorChange} onRemove={() => {}} />)

  screen.getByRole('button', { name: /color group/i }).click()
  expect(onColorChange).toHaveBeenLastCalledWith('B')

  rerender(<WidgetHeader label="W" color="B" onColorChange={onColorChange} onRemove={() => {}} />)
  screen.getByRole('button', { name: /color group/i }).click()
  expect(onColorChange).toHaveBeenLastCalledWith('C')

  rerender(<WidgetHeader label="W" color="C" onColorChange={onColorChange} onRemove={() => {}} />)
  screen.getByRole('button', { name: /color group/i }).click()
  expect(onColorChange).toHaveBeenLastCalledWith('D')

  rerender(<WidgetHeader label="W" color="D" onColorChange={onColorChange} onRemove={() => {}} />)
  screen.getByRole('button', { name: /color group/i }).click()
  expect(onColorChange).toHaveBeenLastCalledWith('A')
})

test('close button calls onRemove', () => {
  const onRemove = vi.fn()
  render(<WidgetHeader label="W" color="A" onColorChange={() => {}} onRemove={onRemove} />)
  screen.getByRole('button', { name: /close/i }).click()
  expect(onRemove).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/charts/WidgetHeader.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement WidgetHeader**

Write `app/src/pages/charts/WidgetHeader.jsx`:

```jsx
import styles from './ChartsWorkspace.module.css'

const COLORS = ['A', 'B', 'C', 'D']

function nextColor(c) {
  const i = COLORS.indexOf(c)
  return COLORS[(i + 1) % COLORS.length]
}

export default function WidgetHeader({ label, color, onColorChange, onRemove }) {
  return (
    <div className={styles.widgetHeader}>
      <span className={`${styles.dragGrip} charts-widget-drag-handle`} aria-hidden="true">⋮⋮</span>
      <button
        type="button"
        className={`${styles.colorDot} ${styles[`colorDot${color}`]}`}
        onClick={() => onColorChange(nextColor(color))}
        aria-label={`Color group ${color} (click to cycle)`}
        title={`Color group ${color} — click to cycle to next group`}
      />
      <span className={styles.widgetLabel}>{label}</span>
      <span className={styles.headerSpacer} />
      <button
        type="button"
        className={styles.closeBtn}
        onClick={onRemove}
        aria-label="Close widget"
        title="Remove this widget"
      >✕</button>
    </div>
  )
}
```

- [ ] **Step 4: Create a minimal placeholder CSS module so the import resolves**

Write `app/src/pages/charts/ChartsWorkspace.module.css` (will be expanded in Task 12):

```css
/* Widget header styles — full workspace styles land in Task 12. */
.widgetHeader {
  background: var(--bg-elevated, #0d1218);
  border-bottom: 1px solid var(--border, #1f2937);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--accent, #c9a84c);
  text-transform: uppercase;
  letter-spacing: 1px;
}

.dragGrip { color: var(--text-muted, #4b5563); font-size: 13px; cursor: move; user-select: none; }
.colorDot {
  width: 10px; height: 10px; border-radius: 50%;
  border: none; padding: 0; cursor: pointer;
  flex-shrink: 0;
}
.colorDotA { background: #c9a84c; }
.colorDotB { background: #60a5fa; }
.colorDotC { background: #4ade80; }
.colorDotD { background: #c084fc; }
.widgetLabel { color: var(--accent, #c9a84c); }
.headerSpacer { flex: 1; }
.closeBtn {
  background: transparent; border: none; color: var(--text-muted, #6b7280);
  cursor: pointer; padding: 0 4px; font-size: 12px;
}
.closeBtn:hover { color: var(--text, #e5e7eb); }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/charts/WidgetHeader.test.jsx`
Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/src/pages/charts/WidgetHeader.jsx app/src/pages/charts/WidgetHeader.test.jsx app/src/pages/charts/ChartsWorkspace.module.css
git commit -m "feat(charts): add WidgetHeader with drag handle, color picker, close button"
```

---

## Task 6: ChartWidget — wraps StockChart with color-group wiring

**Files:**
- Create: `app/src/pages/charts/widgets/ChartWidget.jsx`
- Create: `app/src/pages/charts/widgets/ChartWidget.test.jsx`

`ChartWidget` reads its assigned color group's ticker via `useWorkspace`, passes to `StockChart`, and writes back on user symbol changes inside the chart.

- [ ] **Step 1: Create the widgets directory**

Run: `mkdir -p app/src/pages/charts/widgets`
Expected: silent success.

- [ ] **Step 2: Write the failing test**

Write `app/src/pages/charts/widgets/ChartWidget.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import { vi } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'
import ChartWidget from './ChartWidget'

vi.mock('../../../components/StockChart', () => ({
  default: ({ sym, onSymbolChange }) => (
    <div>
      <span data-testid="chart-sym">{sym}</span>
      <button onClick={() => onSymbolChange && onSymbolChange('AAPL')}>change</button>
    </div>
  ),
}))

function Wrap({ color, initialGroups = { A: null, B: null, C: null, D: null } }) {
  const [groupSyms, setGroupSyms] = useState(initialGroups)
  const setGroupSym = (c, s) => setGroupSyms(prev => ({ ...prev, [c]: s }))
  return (
    <WorkspaceContext.Provider value={{ groupSyms, setGroupSym }}>
      <ChartWidget color={color} opts={{}} />
      <span data-testid="groupA">{groupSyms.A ?? 'null'}</span>
      <span data-testid="groupB">{groupSyms.B ?? 'null'}</span>
    </WorkspaceContext.Provider>
  )
}

test('defaults to SPY when its color group is empty', () => {
  render(<Wrap color="A" />)
  expect(screen.getByTestId('chart-sym').textContent).toBe('SPY')
})

test('renders the color groups ticker when set', () => {
  render(<Wrap color="B" initialGroups={{ A: 'NVDA', B: 'TSLA', C: null, D: null }} />)
  expect(screen.getByTestId('chart-sym').textContent).toBe('TSLA')
})

test('symbol changes write back to the widgets color group only', () => {
  render(<Wrap color="B" initialGroups={{ A: 'NVDA', B: null, C: null, D: null }} />)
  screen.getByText('change').click()
  expect(screen.getByTestId('groupA').textContent).toBe('NVDA')
  expect(screen.getByTestId('groupB').textContent).toBe('AAPL')
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/charts/widgets/ChartWidget.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement ChartWidget**

Write `app/src/pages/charts/widgets/ChartWidget.jsx`:

```jsx
import StockChart from '../../../components/StockChart'
import { useWorkspace } from '../WorkspaceContext'

export default function ChartWidget({ color, opts }) {
  const { groupSyms, setGroupSym } = useWorkspace()
  const sym = groupSyms[color] || 'SPY'
  return <StockChart sym={sym} onSymbolChange={(s) => setGroupSym(color, s)} />
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/charts/widgets/ChartWidget.test.jsx`
Expected: 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/src/pages/charts/widgets/ChartWidget.jsx app/src/pages/charts/widgets/ChartWidget.test.jsx
git commit -m "feat(charts): add ChartWidget with color-group wiring"
```

---

## Task 7: Watchlists embedded prop + WatchlistWidget

**Files:**
- Modify: `app/src/pages/Watchlists.jsx`
- Create: `app/src/pages/charts/widgets/WatchlistWidget.jsx`
- Create: `app/src/pages/charts/widgets/WatchlistWidget.test.jsx`

Watchlists has a split-panel: left = ticker lists, right = `StockChart`. In workspace mode, the chart panel is redundant (the Chart widget shows the chart). `embedded={true}` hides the right panel and lets the list fill the widget.

The `WatchlistWidget` provides a per-widget `ChartsSymContext.Provider` that routes the wrapped Watchlists' `useChartsSym` calls into the widget's chosen color group — so a Group B Watchlist publishes to Group B, not Group A.

- [ ] **Step 1: Locate the right-side chart panel in Watchlists.jsx**

Run: `grep -n "StockChart\|chartPanel\|chartFrame\|splitPanel" app/src/pages/Watchlists.jsx | head -10`

Identify the JSX block where the `<StockChart>` is rendered. It's likely wrapped in a container div with a className.

- [ ] **Step 2: Add embedded prop and conditional render**

In `app/src/pages/Watchlists.jsx`, change the component signature:

```jsx
// BEFORE
export default function Watchlists() {

// AFTER
export default function Watchlists({ embedded = false }) {
```

Find the JSX block rendering the right-side chart panel (identified in Step 1). Wrap its container with a conditional:

```jsx
{!embedded && (
  /* existing chart panel JSX unchanged */
)}
```

Also adjust the split-panel container's styling when embedded — the left list should occupy 100% width instead of its current fixed width. Add a conditional className:

```jsx
<div className={`${styles.splitPanel} ${embedded ? styles.splitPanelEmbedded : ''}`}>
```

Add the `.splitPanelEmbedded` class to `Watchlists.module.css`:

```css
.splitPanelEmbedded { display: block; }
.splitPanelEmbedded > .listPanel { width: 100%; max-width: 100%; }
```

(Adapt `.listPanel` to whatever class name actually applies to the left list — read 5–10 lines of context to identify it.)

- [ ] **Step 3: Write the failing test for WatchlistWidget**

Write `app/src/pages/charts/widgets/WatchlistWidget.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import { vi } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'
import WatchlistWidget from './WatchlistWidget'

// Mock Watchlists — assert it receives embedded=true and uses ChartsSymContext.
vi.mock('../../Watchlists', () => ({
  default: ({ embedded }) => {
    return <div data-testid="watchlists-render" data-embedded={String(embedded)}>WATCHLISTS</div>
  },
}))

function Wrap({ color }) {
  const [groupSyms, setGroupSyms] = useState({ A: null, B: null, C: null, D: null })
  const setGroupSym = (c, s) => setGroupSyms(prev => ({ ...prev, [c]: s }))
  return (
    <WorkspaceContext.Provider value={{ groupSyms, setGroupSym }}>
      <WatchlistWidget color={color} opts={{}} />
    </WorkspaceContext.Provider>
  )
}

test('renders Watchlists in embedded mode', () => {
  render(<Wrap color="A" />)
  const el = screen.getByTestId('watchlists-render')
  expect(el.getAttribute('data-embedded')).toBe('true')
})

test('provides a scoped ChartsSymContext that routes to the widgets color group', () => {
  // We test the scoping indirectly: the widget must wrap Watchlists in
  // a ChartsSymContext.Provider. The wrapped Watchlists, on click,
  // would call setSym on that scoped context — which routes to the
  // widgets color group. Full end-to-end is verified in T13 manual smoke.
  // Here we just verify the wrap is present by checking the rendered tree
  // contains the mock + the widget renders without errors.
  render(<Wrap color="C" />)
  expect(screen.getByTestId('watchlists-render')).toBeInTheDocument()
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/charts/widgets/WatchlistWidget.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement WatchlistWidget**

Write `app/src/pages/charts/widgets/WatchlistWidget.jsx`:

```jsx
import { useMemo } from 'react'
import Watchlists from '../../Watchlists'
import { ChartsSymContext } from '../ChartsSymContext'
import { useWorkspace } from '../WorkspaceContext'

export default function WatchlistWidget({ color, opts }) {
  const { groupSyms, setGroupSym } = useWorkspace()
  // Scoped context: routes the wrapped Watchlists' useChartsSym calls
  // into THIS widget's color group, not Group A.
  const scopedSymContext = useMemo(() => ({
    sym: groupSyms[color],
    setSym: (s) => setGroupSym(color, s),
  }), [groupSyms, color, setGroupSym])

  return (
    <ChartsSymContext.Provider value={scopedSymContext}>
      <Watchlists embedded />
    </ChartsSymContext.Provider>
  )
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/charts/widgets/WatchlistWidget.test.jsx`
Expected: 2 tests PASS.

- [ ] **Step 7: Build smoke**

Run: `cd app && npx vite build 2>&1 | tail -10`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/src/pages/Watchlists.jsx app/src/pages/Watchlists.module.css app/src/pages/charts/widgets/WatchlistWidget.jsx app/src/pages/charts/widgets/WatchlistWidget.test.jsx
git commit -m "feat(charts): add WatchlistWidget + embedded mode to Watchlists"
```

---

## Task 8: ThemeTrackerPage embedded prop + ThemesWidget

**Files:**
- Modify: `app/src/pages/ThemeTrackerPage.jsx`
- Create: `app/src/pages/charts/widgets/ThemesWidget.jsx`
- Create: `app/src/pages/charts/widgets/ThemesWidget.test.jsx`

Same pattern as Task 7 — ThemeTrackerPage also has a right-side `StockChart` (see `chartRef`, `chartPeriod`, the `chartFrame`/`chartImgWrap` containers). Add `embedded` prop to hide the right panel; render only the themes list at full width.

- [ ] **Step 1: Locate the chart panel**

Run: `grep -n "StockChart\|chartRef\|chartFrame\|chartImgWrap" app/src/pages/ThemeTrackerPage.jsx | head -15`

Find the JSX block rendering the right-side chart panel.

- [ ] **Step 2: Add embedded prop**

In `app/src/pages/ThemeTrackerPage.jsx`:

```jsx
// BEFORE
export default function ThemeTrackerPage() {

// AFTER
export default function ThemeTrackerPage({ embedded = false }) {
```

Wrap the right-side chart JSX block with:

```jsx
{!embedded && (
  /* existing chart panel JSX unchanged */
)}
```

If the left themes panel has a width constraint that assumes the chart is to its right, add a conditional className that flexes it to 100% width when embedded. Read `ThemeTrackerPage.module.css` to find the relevant left-panel class; add a `.themesPanelEmbedded` class that sets width to 100% and adjusts grid/flex as needed.

- [ ] **Step 3: Write the failing test for ThemesWidget**

Write `app/src/pages/charts/widgets/ThemesWidget.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import { vi } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'
import ThemesWidget from './ThemesWidget'

vi.mock('../../ThemeTrackerPage', () => ({
  default: ({ embedded }) => (
    <div data-testid="themes-render" data-embedded={String(embedded)}>THEMES</div>
  ),
}))

function Wrap({ color }) {
  const [groupSyms, setGroupSyms] = useState({ A: null, B: null, C: null, D: null })
  const setGroupSym = (c, s) => setGroupSyms(prev => ({ ...prev, [c]: s }))
  return (
    <WorkspaceContext.Provider value={{ groupSyms, setGroupSym }}>
      <ThemesWidget color={color} opts={{}} />
    </WorkspaceContext.Provider>
  )
}

test('renders ThemeTrackerPage in embedded mode', () => {
  render(<Wrap color="A" />)
  expect(screen.getByTestId('themes-render').getAttribute('data-embedded')).toBe('true')
})

test('mounts under the WorkspaceContext and renders without errors for each color', () => {
  for (const c of ['A', 'B', 'C', 'D']) {
    const { unmount } = render(<Wrap color={c} />)
    expect(screen.getByTestId('themes-render')).toBeInTheDocument()
    unmount()
  }
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/charts/widgets/ThemesWidget.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement ThemesWidget**

Write `app/src/pages/charts/widgets/ThemesWidget.jsx`:

```jsx
import { useMemo } from 'react'
import ThemeTrackerPage from '../../ThemeTrackerPage'
import { ChartsSymContext } from '../ChartsSymContext'
import { useWorkspace } from '../WorkspaceContext'

export default function ThemesWidget({ color, opts }) {
  const { groupSyms, setGroupSym } = useWorkspace()
  const scopedSymContext = useMemo(() => ({
    sym: groupSyms[color],
    setSym: (s) => setGroupSym(color, s),
  }), [groupSyms, color, setGroupSym])

  return (
    <ChartsSymContext.Provider value={scopedSymContext}>
      <ThemeTrackerPage embedded />
    </ChartsSymContext.Provider>
  )
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/charts/widgets/ThemesWidget.test.jsx`
Expected: 2 tests PASS.

- [ ] **Step 7: Build smoke**

Run: `cd app && npx vite build 2>&1 | tail -10`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/src/pages/ThemeTrackerPage.jsx app/src/pages/ThemeTrackerPage.module.css app/src/pages/charts/widgets/ThemesWidget.jsx app/src/pages/charts/widgets/ThemesWidget.test.jsx
git commit -m "feat(charts): add ThemesWidget + embedded mode to ThemeTrackerPage"
```

---

## Task 9: Screener embedded prop + ScannerWidget

**Files:**
- Modify: `app/src/pages/Screener.jsx`
- Create: `app/src/pages/charts/widgets/ScannerWidget.jsx`
- Create: `app/src/pages/charts/widgets/ScannerWidget.test.jsx`

Screener.jsx has 3 sub-tabs (Scanner / Live Scan / Custom Scan). The Scanner sub-tab is what's directly useful as a widget. `embedded={true}` should compact the page header and let it fill its widget container. Screener.jsx does NOT directly render a `StockChart` (the chart-on-right pattern lives in `CustomScan.jsx`, which is a sub-tab); so `embedded` mainly tightens padding and removes any outer page wrapper styling.

- [ ] **Step 1: Locate the outer page wrapper / header**

Run: `grep -n "styles.page\|styles.header\|<h1\|PAGE_TABS" app/src/pages/Screener.jsx | head -10`

Identify the outer container and the page title header.

- [ ] **Step 2: Add embedded prop**

In `app/src/pages/Screener.jsx`:

```jsx
// BEFORE
export default function Screener() {

// AFTER
export default function Screener({ embedded = false }) {
```

Wrap the outer page header / title block (if any) with:

```jsx
{!embedded && (
  /* existing page header / title JSX */
)}
```

Adjust the outer container className:

```jsx
<div className={`${styles.page} ${embedded ? styles.pageEmbedded : ''}`}>
```

Add to `Screener.module.css`:

```css
.pageEmbedded { padding: 0; height: 100%; overflow: auto; }
.pageEmbedded > .header { display: none; }
```

(Adapt `.header` to the actual class name of the page header element if different.)

- [ ] **Step 3: Write the failing test for ScannerWidget**

Write `app/src/pages/charts/widgets/ScannerWidget.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import { vi } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'
import ScannerWidget from './ScannerWidget'

vi.mock('../../Screener', () => ({
  default: ({ embedded }) => (
    <div data-testid="screener-render" data-embedded={String(embedded)}>SCREENER</div>
  ),
}))

function Wrap({ color }) {
  const [groupSyms, setGroupSyms] = useState({ A: null, B: null, C: null, D: null })
  const setGroupSym = (c, s) => setGroupSyms(prev => ({ ...prev, [c]: s }))
  return (
    <WorkspaceContext.Provider value={{ groupSyms, setGroupSym }}>
      <ScannerWidget color={color} opts={{}} />
    </WorkspaceContext.Provider>
  )
}

test('renders Screener in embedded mode', () => {
  render(<Wrap color="C" />)
  expect(screen.getByTestId('screener-render').getAttribute('data-embedded')).toBe('true')
})

test('mounts under the WorkspaceContext and renders without errors for each color', () => {
  for (const c of ['A', 'B', 'C', 'D']) {
    const { unmount } = render(<Wrap color={c} />)
    expect(screen.getByTestId('screener-render')).toBeInTheDocument()
    unmount()
  }
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/charts/widgets/ScannerWidget.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement ScannerWidget**

Write `app/src/pages/charts/widgets/ScannerWidget.jsx`:

```jsx
import { useMemo } from 'react'
import Screener from '../../Screener'
import { ChartsSymContext } from '../ChartsSymContext'
import { useWorkspace } from '../WorkspaceContext'

export default function ScannerWidget({ color, opts }) {
  const { groupSyms, setGroupSym } = useWorkspace()
  const scopedSymContext = useMemo(() => ({
    sym: groupSyms[color],
    setSym: (s) => setGroupSym(color, s),
  }), [groupSyms, color, setGroupSym])

  return (
    <ChartsSymContext.Provider value={scopedSymContext}>
      <Screener embedded />
    </ChartsSymContext.Provider>
  )
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/charts/widgets/ScannerWidget.test.jsx`
Expected: 2 tests PASS.

- [ ] **Step 7: Build smoke**

Run: `cd app && npx vite build 2>&1 | tail -10`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/src/pages/Screener.jsx app/src/pages/Screener.module.css app/src/pages/charts/widgets/ScannerWidget.jsx app/src/pages/charts/widgets/ScannerWidget.test.jsx
git commit -m "feat(charts): add ScannerWidget + embedded mode to Screener"
```

---

## Task 10: WidgetHost — type dispatcher

**Files:**
- Create: `app/src/pages/charts/WidgetHost.jsx`
- Create: `app/src/pages/charts/WidgetHost.test.jsx`

`WidgetHost` renders the right widget body based on `widget.type` and composes it with `WidgetHeader`.

- [ ] **Step 1: Write the failing test**

Write `app/src/pages/charts/WidgetHost.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { WorkspaceContext } from './WorkspaceContext'
import WidgetHost from './WidgetHost'

vi.mock('./widgets/ChartWidget', () => ({ default: () => <div data-testid="body-chart">CHART</div> }))
vi.mock('./widgets/WatchlistWidget', () => ({ default: () => <div data-testid="body-watchlist">WATCHLIST</div> }))
vi.mock('./widgets/ThemesWidget', () => ({ default: () => <div data-testid="body-themes">THEMES</div> }))
vi.mock('./widgets/ScannerWidget', () => ({ default: () => <div data-testid="body-scanner">SCANNER</div> }))

const wsValue = {
  groupSyms: { A: null, B: null, C: null, D: null },
  setGroupSym: () => {},
}

function wrap(widget, handlers = {}) {
  return render(
    <WorkspaceContext.Provider value={wsValue}>
      <WidgetHost
        widget={widget}
        onRemove={handlers.onRemove || (() => {})}
        onColorChange={handlers.onColorChange || (() => {})}
      />
    </WorkspaceContext.Provider>,
  )
}

test('dispatches to ChartWidget for type=chart', () => {
  wrap({ id: '1', type: 'chart', color: 'A', opts: {} })
  expect(screen.getByTestId('body-chart')).toBeInTheDocument()
})

test('dispatches to WatchlistWidget for type=watchlist', () => {
  wrap({ id: '2', type: 'watchlist', color: 'A', opts: {} })
  expect(screen.getByTestId('body-watchlist')).toBeInTheDocument()
})

test('dispatches to ThemesWidget for type=themes', () => {
  wrap({ id: '3', type: 'themes', color: 'B', opts: {} })
  expect(screen.getByTestId('body-themes')).toBeInTheDocument()
})

test('dispatches to ScannerWidget for type=scanner', () => {
  wrap({ id: '4', type: 'scanner', color: 'C', opts: {} })
  expect(screen.getByTestId('body-scanner')).toBeInTheDocument()
})

test('renders the WidgetHeader with label and color', () => {
  wrap({ id: '1', type: 'chart', color: 'A', opts: {} })
  // Label for chart type defaults to "Chart"
  expect(screen.getByText(/^Chart$/i)).toBeInTheDocument()
  // Color dot accessible by aria-label
  expect(screen.getByRole('button', { name: /color group/i })).toBeInTheDocument()
})

test('renders a placeholder for unknown type instead of crashing', () => {
  wrap({ id: '99', type: 'unknown', color: 'A', opts: {} })
  expect(screen.getByText(/unknown widget/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/charts/WidgetHost.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement WidgetHost**

Write `app/src/pages/charts/WidgetHost.jsx`:

```jsx
import ChartWidget from './widgets/ChartWidget'
import WatchlistWidget from './widgets/WatchlistWidget'
import ThemesWidget from './widgets/ThemesWidget'
import ScannerWidget from './widgets/ScannerWidget'
import WidgetHeader from './WidgetHeader'
import styles from './ChartsWorkspace.module.css'

const TYPE_LABEL = {
  chart: 'Chart',
  watchlist: 'Watchlist',
  themes: 'Themes',
  scanner: 'Scanner',
}

function WidgetBody({ widget }) {
  switch (widget.type) {
    case 'chart':     return <ChartWidget     color={widget.color} opts={widget.opts} />
    case 'watchlist': return <WatchlistWidget color={widget.color} opts={widget.opts} />
    case 'themes':    return <ThemesWidget    color={widget.color} opts={widget.opts} />
    case 'scanner':   return <ScannerWidget   color={widget.color} opts={widget.opts} />
    default:          return <div className={styles.unknownWidget}>Unknown widget type: {widget.type}</div>
  }
}

export default function WidgetHost({ widget, onRemove, onColorChange }) {
  return (
    <div className={styles.widget}>
      <WidgetHeader
        label={TYPE_LABEL[widget.type] || widget.type}
        color={widget.color}
        onColorChange={onColorChange}
        onRemove={onRemove}
      />
      <div className={styles.widgetBody}>
        <WidgetBody widget={widget} />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add the .widget, .widgetBody, .unknownWidget styles**

Append to `app/src/pages/charts/ChartsWorkspace.module.css`:

```css
.widget {
  background: var(--bg-elevated, #0f141b);
  border: 1px solid var(--border, #1f2937);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.widgetBody {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.unknownWidget {
  padding: 20px;
  color: var(--text-muted, #6b7280);
  font-size: 12px;
  text-align: center;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/charts/WidgetHost.test.jsx`
Expected: 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/src/pages/charts/WidgetHost.jsx app/src/pages/charts/WidgetHost.test.jsx app/src/pages/charts/ChartsWorkspace.module.css
git commit -m "feat(charts): add WidgetHost type dispatcher + widget container styles"
```

---

## Task 11: MobileChartFallback

**Files:**
- Create: `app/src/pages/charts/widgets/MobileChartFallback.jsx`
- Create: `app/src/pages/charts/widgets/MobileChartFallback.test.jsx`

Mobile gets a single full-screen `StockChart`. Default ticker = SPY; selected ticker persists to localStorage so refresh remembers it.

- [ ] **Step 1: Write the failing test**

Write `app/src/pages/charts/widgets/MobileChartFallback.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import MobileChartFallback from './MobileChartFallback'

vi.mock('../../../components/StockChart', () => ({
  default: ({ sym, onSymbolChange }) => (
    <div>
      <span data-testid="m-sym">{sym}</span>
      <button onClick={() => onSymbolChange('NVDA')}>change</button>
    </div>
  ),
}))

beforeEach(() => { localStorage.clear() })

test('defaults to SPY when no localStorage entry', () => {
  render(<MobileChartFallback />)
  expect(screen.getByTestId('m-sym').textContent).toBe('SPY')
})

test('restores ticker from localStorage', () => {
  localStorage.setItem('charts_mobile_sym', 'AAPL')
  render(<MobileChartFallback />)
  expect(screen.getByTestId('m-sym').textContent).toBe('AAPL')
})

test('persists ticker changes to localStorage', () => {
  render(<MobileChartFallback />)
  screen.getByText('change').click()
  expect(localStorage.getItem('charts_mobile_sym')).toBe('NVDA')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/charts/widgets/MobileChartFallback.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement MobileChartFallback**

Write `app/src/pages/charts/widgets/MobileChartFallback.jsx`:

```jsx
import { useEffect, useState } from 'react'
import StockChart from '../../../components/StockChart'

const STORAGE_KEY = 'charts_mobile_sym'

export default function MobileChartFallback() {
  const [sym, setSym] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || 'SPY'
    } catch {
      return 'SPY'
    }
  })

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, sym) } catch {}
  }, [sym])

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <StockChart sym={sym} onSymbolChange={setSym} />
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/charts/widgets/MobileChartFallback.test.jsx`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/src/pages/charts/widgets/MobileChartFallback.jsx app/src/pages/charts/widgets/MobileChartFallback.test.jsx
git commit -m "feat(charts): add MobileChartFallback for sub-640px viewports"
```

---

## Task 12: ChartsWorkspace shell

**Files:**
- Create: `app/src/pages/charts/ChartsWorkspace.jsx`
- Create: `app/src/pages/charts/ChartsWorkspace.test.jsx`
- Modify: `app/src/pages/charts/ChartsWorkspace.module.css` (append)

The shell: react-grid-layout integration, default-layout seeding on first visit, debounced layout persistence, mobile detection, color-group state, `+ Add Widget` dropdown, `Reset layout` button.

- [ ] **Step 1: Write the failing test**

Write `app/src/pages/charts/ChartsWorkspace.test.jsx`:

```jsx
import { render, screen, act, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

// Mock widget components so we don't bring in real widget internals.
vi.mock('./widgets/ChartWidget', () => ({ default: () => <div data-testid="body-chart">CHART</div> }))
vi.mock('./widgets/WatchlistWidget', () => ({ default: () => <div data-testid="body-watchlist">WATCHLIST</div> }))
vi.mock('./widgets/ThemesWidget', () => ({ default: () => <div data-testid="body-themes">THEMES</div> }))
vi.mock('./widgets/ScannerWidget', () => ({ default: () => <div data-testid="body-scanner">SCANNER</div> }))
vi.mock('./widgets/MobileChartFallback', () => ({ default: () => <div data-testid="mobile-fallback">MOBILE</div> }))

// Mock react-grid-layout — render children directly so we can assert
// what's in the DOM. The library's drag/resize behavior is its own
// concern; integration is verified in T15 manual smoke.
vi.mock('react-grid-layout', () => ({
  Responsive: ({ children, onLayoutChange }) => (
    <div data-testid="rgl-responsive">
      <button data-testid="rgl-fire-change" onClick={() => onLayoutChange && onLayoutChange([{ i: 'fake', x: 0, y: 0, w: 6, h: 6 }])}>fire</button>
      {children}
    </div>
  ),
  WidthProvider: (C) => C,
}))

// Mock usePreferences — control returned prefs, capture setPref calls.
const setPref = vi.fn()
let mockPrefs = {}
vi.mock('../../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPref, loading: false }),
}))

// Mock useMediaQuery — default desktop (false); individual tests override.
let mqMatches = false
vi.mock('../../hooks/useMediaQuery', () => ({
  default: () => mqMatches,
}))

import ChartsWorkspace from './ChartsWorkspace'

function renderWS() {
  return render(
    <MemoryRouter>
      <ChartsWorkspace />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  setPref.mockReset()
  mockPrefs = {}
  mqMatches = false
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

test('seeds 3 default widgets on first visit (no saved layout)', () => {
  renderWS()
  // Default layout: Watchlist + Chart + Themes
  expect(screen.getByTestId('body-watchlist')).toBeInTheDocument()
  expect(screen.getByTestId('body-chart')).toBeInTheDocument()
  expect(screen.getByTestId('body-themes')).toBeInTheDocument()
  expect(screen.queryByTestId('body-scanner')).not.toBeInTheDocument()
})

test('restores saved layout from preferences', () => {
  mockPrefs = {
    charts_workspace_layout: JSON.stringify({
      widgets: [
        { id: 's1', type: 'scanner', color: 'C', x: 0, y: 0, w: 6, h: 6, opts: {} },
      ],
      cols: 12,
      rowHeight: 40,
    }),
  }
  renderWS()
  expect(screen.getByTestId('body-scanner')).toBeInTheDocument()
  expect(screen.queryByTestId('body-chart')).not.toBeInTheDocument()
})

test('renders MobileChartFallback when useMediaQuery indicates mobile', () => {
  mqMatches = true
  renderWS()
  expect(screen.getByTestId('mobile-fallback')).toBeInTheDocument()
  expect(screen.queryByTestId('rgl-responsive')).not.toBeInTheDocument()
})

test('debounced save fires setPref after layout change', async () => {
  renderWS()
  act(() => { screen.getByTestId('rgl-fire-change').click() })
  // Debounce is 500ms — advance time and assert
  act(() => { vi.advanceTimersByTime(600) })
  await waitFor(() => {
    expect(setPref).toHaveBeenCalledWith(
      'charts_workspace_layout',
      expect.stringContaining('widgets'),
    )
  })
})

test('+ Add Widget toolbar button is present', () => {
  renderWS()
  expect(screen.getByRole('button', { name: /\+ add widget/i })).toBeInTheDocument()
})

test('Reset layout button is present', () => {
  renderWS()
  expect(screen.getByRole('button', { name: /reset layout/i })).toBeInTheDocument()
})

test('corrupted preferences blob falls back to default layout', () => {
  mockPrefs = { charts_workspace_layout: '{not valid json' }
  renderWS()
  // Default layout still loads
  expect(screen.getByTestId('body-chart')).toBeInTheDocument()
  expect(screen.getByTestId('body-watchlist')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/charts/ChartsWorkspace.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ChartsWorkspace**

Write `app/src/pages/charts/ChartsWorkspace.jsx`:

```jsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Responsive, WidthProvider } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import usePreferences from '../../hooks/usePreferences'
import useMediaQuery from '../../hooks/useMediaQuery'
import { WorkspaceContext } from './WorkspaceContext'
import WidgetHost from './WidgetHost'
import MobileChartFallback from './widgets/MobileChartFallback'
import styles from './ChartsWorkspace.module.css'

const ResponsiveGridLayout = WidthProvider(Responsive)

const COLS = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }
const ROW_HEIGHT = 40

const DEFAULT_LAYOUT = {
  widgets: [
    { id: 'w-watchlist', type: 'watchlist', color: 'A', x: 0, y: 0, w: 3, h: 6, opts: {} },
    { id: 'w-chart',     type: 'chart',     color: 'A', x: 3, y: 0, w: 9, h: 8, opts: { tf: 'D' } },
    { id: 'w-themes',    type: 'themes',    color: 'B', x: 0, y: 6, w: 3, h: 4, opts: {} },
  ],
  cols: 12,
  rowHeight: ROW_HEIGHT,
}

const WIDGET_DEFAULTS = {
  chart:     { w: 6, h: 8, minW: 3, minH: 4 },
  watchlist: { w: 3, h: 6, minW: 2, minH: 3 },
  themes:    { w: 3, h: 6, minW: 2, minH: 3 },
  scanner:   { w: 4, h: 6, minW: 3, minH: 3 },
}

function parseLayout(raw) {
  if (!raw) return null
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (parsed?.widgets && Array.isArray(parsed.widgets)) return parsed
  } catch {}
  return null
}

function nextColor(currentColors) {
  // Cycle A→B→C→D→A based on what's already in use.
  const order = ['A', 'B', 'C', 'D']
  for (const c of order) {
    if (!currentColors.includes(c)) return c
  }
  return 'A'
}

export default function ChartsWorkspace() {
  const isMobile = useMediaQuery('(max-width: 640px)')
  const { prefs, setPref } = usePreferences()

  // Layout state — seed from prefs or default.
  const [layout, setLayout] = useState(() => parseLayout(prefs?.charts_workspace_layout) || DEFAULT_LAYOUT)

  // If prefs arrive AFTER initial render (async fetch), pick them up.
  const loadedFromPrefsRef = useRef(false)
  useEffect(() => {
    if (loadedFromPrefsRef.current) return
    const parsed = parseLayout(prefs?.charts_workspace_layout)
    if (parsed) {
      setLayout(parsed)
      loadedFromPrefsRef.current = true
    }
  }, [prefs?.charts_workspace_layout])

  // Color-group state — seed from prefs or empty.
  const [groupSyms, setGroupSymsState] = useState(() => {
    try {
      const raw = prefs?.charts_workspace_groups
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (parsed && typeof parsed === 'object') {
          return { A: null, B: null, C: null, D: null, ...parsed }
        }
      }
    } catch {}
    return { A: null, B: null, C: null, D: null }
  })

  const setGroupSym = useCallback((color, sym) => {
    setGroupSymsState(prev => {
      const next = { ...prev, [color]: sym }
      setPref('charts_workspace_groups', JSON.stringify(next))
      return next
    })
  }, [setPref])

  const workspaceValue = useMemo(() => ({ groupSyms, setGroupSym }), [groupSyms, setGroupSym])

  // Debounced layout persist (500ms).
  const saveTimerRef = useRef(null)
  const scheduleSave = useCallback((nextLayout) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      setPref('charts_workspace_layout', JSON.stringify(nextLayout))
    }, 500)
  }, [setPref])

  // react-grid-layout fires onLayoutChange with the new x/y/w/h array.
  // Merge it back into our widget objects.
  const handleLayoutChange = useCallback((newGridLayout) => {
    setLayout(prev => {
      const byId = Object.fromEntries(newGridLayout.map(l => [l.i, l]))
      const widgets = prev.widgets.map(w => {
        const l = byId[w.id]
        if (!l) return w
        return { ...w, x: l.x, y: l.y, w: l.w, h: l.h }
      })
      const next = { ...prev, widgets }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const handleRemoveWidget = useCallback((id) => {
    setLayout(prev => {
      const next = { ...prev, widgets: prev.widgets.filter(w => w.id !== id) }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const handleColorChange = useCallback((id, color) => {
    setLayout(prev => {
      const next = { ...prev, widgets: prev.widgets.map(w => w.id === id ? { ...w, color } : w) }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const handleAddWidget = useCallback((type) => {
    setLayout(prev => {
      const usedColors = prev.widgets.map(w => w.color)
      const color = nextColor(usedColors)
      const defaults = WIDGET_DEFAULTS[type]
      const newWidget = {
        id: `w-${type}-${Date.now()}`,
        type, color,
        x: 0, y: Infinity,  // RGL bottom-packs
        w: defaults.w, h: defaults.h,
        opts: {},
      }
      const next = { ...prev, widgets: [...prev.widgets, newWidget] }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const handleResetLayout = useCallback(() => {
    setLayout(DEFAULT_LAYOUT)
    scheduleSave(DEFAULT_LAYOUT)
  }, [scheduleSave])

  const [addMenuOpen, setAddMenuOpen] = useState(false)

  if (isMobile) {
    return <MobileChartFallback />
  }

  const rglLayouts = {
    lg: layout.widgets.map(w => {
      const defaults = WIDGET_DEFAULTS[w.type] || {}
      return {
        i: w.id, x: w.x, y: w.y, w: w.w, h: w.h,
        minW: defaults.minW || 2, minH: defaults.minH || 3,
      }
    }),
  }

  return (
    <WorkspaceContext.Provider value={workspaceValue}>
      <div className={styles.workspace}>
        <header className={styles.workspaceHeader}>
          <span className={styles.workspaceTitle}>📈 Charts</span>
          <div className={styles.toolbarBtnGroup} style={{ position: 'relative' }}>
            <button
              type="button"
              className={styles.toolbarBtn}
              onClick={() => setAddMenuOpen(o => !o)}
            >+ Add Widget</button>
            {addMenuOpen && (
              <div className={styles.addMenu} onMouseLeave={() => setAddMenuOpen(false)}>
                {['chart', 'watchlist', 'themes', 'scanner'].map(t => (
                  <button
                    key={t}
                    type="button"
                    className={styles.addMenuItem}
                    onClick={() => { handleAddWidget(t); setAddMenuOpen(false) }}
                  >{t[0].toUpperCase() + t.slice(1)}</button>
                ))}
              </div>
            )}
          </div>
          <button type="button" className={`${styles.toolbarBtn} ${styles.ghost}`} onClick={handleResetLayout}>
            Reset layout
          </button>
        </header>
        <main className={styles.workspaceBody}>
          <ResponsiveGridLayout
            className="layout"
            layouts={rglLayouts}
            breakpoints={BREAKPOINTS}
            cols={COLS}
            rowHeight={ROW_HEIGHT}
            onLayoutChange={handleLayoutChange}
            draggableHandle=".charts-widget-drag-handle"
            compactType="vertical"
            margin={[6, 6]}
          >
            {layout.widgets.map(w => (
              <div key={w.id}>
                <WidgetHost
                  widget={w}
                  onRemove={() => handleRemoveWidget(w.id)}
                  onColorChange={(c) => handleColorChange(w.id, c)}
                />
              </div>
            ))}
          </ResponsiveGridLayout>
        </main>
      </div>
    </WorkspaceContext.Provider>
  )
}
```

- [ ] **Step 4: Append the workspace styles to the CSS module**

Append to `app/src/pages/charts/ChartsWorkspace.module.css`:

```css
.workspace {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg, #0a0e14);
  color: var(--text, #e5e7eb);
}

.workspaceHeader {
  background: var(--bg-elevated, #0d1218);
  border-bottom: 1px solid var(--border, #1f2937);
  padding: 8px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.workspaceTitle { font-size: 14px; font-weight: 600; letter-spacing: 0.5px; }

.toolbarBtn {
  background: var(--bg-elevated, #1f2937); color: var(--accent, #c9a84c);
  border: none; padding: 6px 12px; border-radius: 3px;
  font-size: 10px; text-transform: uppercase; letter-spacing: 1px;
  cursor: pointer; font-family: inherit;
}
.toolbarBtn.ghost { background: transparent; color: var(--text-muted, #6b7280); }
.toolbarBtn:hover { color: var(--text, #e5e7eb); }

.toolbarBtnGroup { display: inline-block; }

.addMenu {
  position: absolute; top: 100%; left: 0; margin-top: 4px;
  background: var(--bg-elevated, #0d1218); border: 1px solid var(--border, #1f2937);
  border-radius: 4px; display: flex; flex-direction: column;
  z-index: 100; min-width: 140px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
}
.addMenuItem {
  background: transparent; color: var(--text, #e5e7eb);
  border: none; padding: 8px 14px; text-align: left;
  font-size: 11px; cursor: pointer; font-family: inherit;
}
.addMenuItem:hover { background: var(--bg-hover, #1f2937); color: var(--accent, #c9a84c); }

.workspaceBody {
  flex: 1; min-height: 0; overflow: auto;
  padding: 6px;
}

/* react-grid-layout uses .react-grid-item — give the placeholder a visible style */
:global(.react-grid-placeholder) {
  background: var(--accent, #c9a84c) !important;
  opacity: 0.15 !important;
  border-radius: 4px;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/charts/ChartsWorkspace.test.jsx`
Expected: 7 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/src/pages/charts/ChartsWorkspace.jsx app/src/pages/charts/ChartsWorkspace.test.jsx app/src/pages/charts/ChartsWorkspace.module.css
git commit -m "feat(charts): add ChartsWorkspace shell with react-grid-layout + persistence + mobile fallback"
```

---

## Task 13: Update LegacyRedirect to strip ?tab=

**Files:**
- Modify: `app/src/pages/charts/LegacyRedirect.jsx`
- Modify: `app/src/pages/charts/LegacyRedirect.test.jsx`

Since V2 has no sub-tabs, legacy URLs should redirect to bare `/charts` (preserving non-`tab` query params).

- [ ] **Step 1: Replace the test file**

Replace the contents of `app/src/pages/charts/LegacyRedirect.test.jsx`:

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
        <Route path="/theme-tracker" element={<LegacyRedirect />} />
        <Route path="/watchlists" element={<LegacyRedirect />} />
        <Route path="/multi-chart" element={<LegacyRedirect />} />
        <Route path="/charts" element={<CurrentUrl />} />
      </Routes>
    </MemoryRouter>,
  )
}

test('/theme-tracker redirects to /charts', () => {
  renderAt('/theme-tracker')
  expect(screen.getByTestId('url').textContent).toBe('/charts')
})

test('preserves non-tab query params from the legacy URL', () => {
  renderAt('/watchlists?id=42&filter=tech')
  expect(screen.getByTestId('url').textContent).toBe('/charts?id=42&filter=tech')
})

test('strips legacy ?tab= param entirely', () => {
  renderAt('/multi-chart?tab=multichart&keep=me')
  expect(screen.getByTestId('url').textContent).toBe('/charts?keep=me')
})

test('redirects with empty query when only ?tab= was present', () => {
  renderAt('/theme-tracker?tab=themes')
  expect(screen.getByTestId('url').textContent).toBe('/charts')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/charts/LegacyRedirect.test.jsx`
Expected: FAIL — current component still emits `?tab=…` and requires a `tab` prop.

- [ ] **Step 3: Replace the implementation**

Replace the contents of `app/src/pages/charts/LegacyRedirect.jsx`:

```jsx
import { Navigate, useLocation } from 'react-router-dom'

/**
 * V2: /charts has no sub-tabs. Legacy URLs (/theme-tracker, /watchlists,
 * /multi-chart) redirect to bare /charts, dropping any ?tab= param and
 * preserving all other query params.
 */
export default function LegacyRedirect() {
  const { search } = useLocation()
  const params = new URLSearchParams(search)
  params.delete('tab')
  const qs = params.toString()
  return <Navigate to={qs ? `/charts?${qs}` : '/charts'} replace />
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/charts/LegacyRedirect.test.jsx`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/src/pages/charts/LegacyRedirect.jsx app/src/pages/charts/LegacyRedirect.test.jsx
git commit -m "refactor(charts): simplify LegacyRedirect to drop tab prop (no sub-tabs in V2)"
```

---

## Task 14: App.jsx — swap to ChartsWorkspace + delete V1 files

**Files:**
- Modify: `app/src/App.jsx`
- Delete: `app/src/pages/charts/ChartsHub.jsx`
- Delete: `app/src/pages/charts/ChartsHub.test.jsx`
- Delete: `app/src/pages/charts/ChartsHub.module.css`
- Delete: `app/src/pages/charts/ChartTab.jsx`
- Delete: `app/src/pages/charts/ChartTab.test.jsx`

- [ ] **Step 1: Swap the ChartsHub import for ChartsWorkspace in App.jsx**

In `app/src/App.jsx`, find the line (added in V1 Task 6):

```jsx
const ChartsHub = lazy(() => import('./pages/charts/ChartsHub'))
```

Replace with:

```jsx
const ChartsWorkspace = lazy(() => import('./pages/charts/ChartsWorkspace'))
```

Find the legacy redirect lines:

```jsx
<Route path="/charts" element={<ChartsHub />} />
<Route path="/theme-tracker" element={<LegacyRedirect tab="themes" />} />
<Route path="/watchlists" element={<LegacyRedirect tab="watchlist" />} />
<Route path="/multi-chart" element={<LegacyRedirect tab="multichart" />} />
```

Replace with:

```jsx
<Route path="/charts" element={<ChartsWorkspace />} />
<Route path="/theme-tracker" element={<LegacyRedirect />} />
<Route path="/watchlists" element={<LegacyRedirect />} />
<Route path="/multi-chart" element={<LegacyRedirect />} />
```

(The `tab` prop is gone — `LegacyRedirect` always lands on bare `/charts`.)

- [ ] **Step 2: Delete the 5 V1 files**

Run:

```bash
cd C:/Users/Patrick/uct-dashboard
git rm app/src/pages/charts/ChartsHub.jsx
git rm app/src/pages/charts/ChartsHub.test.jsx
git rm app/src/pages/charts/ChartsHub.module.css
git rm app/src/pages/charts/ChartTab.jsx
git rm app/src/pages/charts/ChartTab.test.jsx
```

Expected: 5 files removed; `git status` shows them as deleted.

- [ ] **Step 3: Build smoke**

Run: `cd app && npx vite build 2>&1 | tail -20`
Expected: build succeeds with no module-not-found errors.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/src/App.jsx
git commit -m "feat(charts): swap /charts route to V2 ChartsWorkspace + delete V1 ChartsHub/ChartTab files"
```

---

## Task 15: Full test sweep + manual smoke

- [ ] **Step 1: Run the entire frontend test suite**

Run: `cd app && npx vitest run`
Expected: full suite PASS (modulo the 3 pre-existing failures in `useWatermarkDrag.test.jsx` that are unrelated to this work).

New test counts: useMediaQuery (3) · WorkspaceContext (2) · ChartsSymContext updated (3) · WidgetHeader (4) · ChartWidget (3) · WatchlistWidget (2) · ThemesWidget (2) · ScannerWidget (2) · WidgetHost (6) · MobileChartFallback (3) · ChartsWorkspace (7) · LegacyRedirect updated (4). Net: ~41 tests in V2 (some replace V1 tests; net new vs V1 is ~24).

- [ ] **Step 2: Start the dev server**

Run in a separate terminal: `cd app && npm run dev`
Expected: Vite dev server starts on default port (~5173).

- [ ] **Step 3: Manual UI smoke checklist**

Open `http://localhost:5173/charts` in a desktop browser (>1200 px wide). With a logged-in user, verify:

| Check | Expected |
|---|---|
| First-ever visit (after deleting `charts_workspace_layout` from prefs OR using a fresh user) | ✅ Three widgets visible: Watchlist (top-left, Group A gold dot), Chart (top-right large, Group A, showing SPY), Themes (bottom-left, Group B blue dot) |
| Drag the Chart widget header (⋮⋮) to a new position | ✅ Widget moves; other widgets reflow; after ~500 ms a `POST /api/auth/preferences` fires for `charts_workspace_layout` |
| Resize the Themes widget by its bottom-right corner | ✅ Widget resizes; layout persists |
| Click NVDA in the Watchlist | ✅ Chart updates to NVDA (same Group A); Themes does NOT change (Group B) |
| Click the Watchlist's color dot | ✅ Cycles A → B → C → D → A. Once on Group B, clicking NVDA no longer drives the Chart. |
| Click `+ Add Widget` → pick Scanner | ✅ Scanner widget appears at bottom with Group C (or next unused color); shows scanner candidates |
| Click ✕ on any widget | ✅ Widget removed; layout persists |
| Click `Reset layout` | ✅ Returns to the 3-widget default |
| Refresh page | ✅ All widget positions, sizes, colors, and tickers restored |
| Navigate to `/theme-tracker` | ✅ Redirects to `/charts` (no `?tab=`); workspace renders |
| Navigate to `/watchlists?id=42` | ✅ Redirects to `/charts?id=42`; workspace renders |
| Resize browser to <640px | ✅ Workspace disappears; single full-screen SPY chart visible |
| Type AAPL in mobile chart's symbol search | ✅ Chart updates to AAPL; refresh keeps AAPL |
| Resize back >640px | ✅ Workspace returns with previously saved layout (NOT the mobile ticker) |
| Watchlist alerts, drag-and-drop, tags inside the Watchlist widget | ✅ All work identically to standalone |
| Themes period tabs, search inside the Themes widget | ✅ All work identically |
| Open `https://uctintelligence.com/charts` after Railway deploys | ✅ Same behavior in production |

If any check fails, stop and diagnose before continuing.

- [ ] **Step 4: Stop the dev server** (Ctrl+C)

---

## Task 16: Push to Railway

- [ ] **Step 1: Sanity check git status**

Run: `cd C:/Users/Patrick/uct-dashboard && git status --short && git log --oneline -20`
Expected: working tree clean (except pre-existing untracked files at root); ~16 commits ahead of `origin/master`.

- [ ] **Step 2: Push**

Run: `cd C:/Users/Patrick/uct-dashboard && git push`
Expected: push succeeds; Railway auto-deploys.

- [ ] **Step 3: Production smoke (after deploy)**

Open `https://uctintelligence.com/charts`. Re-run the 5 most critical checks from Task 15 Step 3:

1. Workspace loads with 3 default widgets
2. Drag-resize works
3. Watchlist → Chart ticker linking works
4. Refresh restores layout
5. `/theme-tracker` redirects to `/charts`

If any production-only failure appears (CDN cache, env var, etc.), investigate before declaring complete.

---

## Acceptance criteria (from spec)

A user with no prior preferences visits `/charts`. They see a 3-widget layout: a large Chart widget (Group A gold dot, showing SPY), a Watchlist widget (Group A, top-left), and a Themes widget (Group B blue dot, bottom-left). They click NVDA in the Watchlist → the Chart updates to NVDA (same Group A). The Themes widget does NOT change (Group B). They click `+ Add Widget` → Scanner → a Scanner widget appears at bottom with a Group C dot. They drag the Chart, resize the Themes widget; 500 ms later a `POST /api/auth/preferences` fires for `charts_workspace_layout`. Refresh → everything restored. `/theme-tracker` → `/charts`. Phone (`<640px`) → single full-screen SPY chart with symbol search. Free-tier user can do all of the above.

---

## Out of scope for this plan

- Named/multiple saved layouts (Phase 2)
- Add Widget modal with previews (Phase 2; this plan uses a simple dropdown)
- More widget types: COT, Patterns, Calendar, MA Relationship, UCT 20 (Phase 2)
- Per-widget settings popovers beyond color picker (Phase 2)
- Intro animation pill grid cleanup (Phase 2)
- Pause-on-hidden for inactive widget streams (Phase 3)
- Cross-account workspace layouts (Phase 3)
- Shareable / community workspace presets (Phase 3)
