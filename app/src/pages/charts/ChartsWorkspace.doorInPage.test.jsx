/* TERM-038 in-page doors (2026-10-01).
 *
 * The defect: a door (`/charts?openLayout=` / `?openWatchlist=` / `?openThemeSet=`) was
 * read once, at mount. A member ALREADY on /charts who picked an address in the Ctrl/Cmd+K
 * palette saw the URL change and nothing open.
 *
 * These rails drive the CLICK path, never a fresh render with the param already set (that
 * is the old behaviour and passes either way): the REAL palette and the REAL workspace are
 * mounted side by side under the app's own router kind (BrowserRouter), the member types a
 * name and clicks the row, and the BOARD is asserted (which widget is on it, which list or
 * set it points at), plus the param is gone from the URL. Every pick is also counted in
 * React commits: an effect that writes the URL it reads can loop (rule H14), and a bound
 * on commits per pick is the rail for that.
 */
import { render, screen, act, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { Profiler } from 'react'
import { vi } from 'vitest'
import { BrowserRouter, useLocation } from 'react-router-dom'

vi.mock('./WidgetHost', () => ({
  default: ({ widget }) => (
    <div
      data-testid={`body-${widget.type}`}
      data-watchkey={widget.opts?.watchKey || ''}
      data-themeset={widget.opts?.themeSetId || ''}
    >{widget.type}</div>
  ),
}))
vi.mock('./mobile/MobileChartsApp', () => ({ default: () => <div data-testid="mobile-charts-app">MOBILE</div> }))
vi.mock('./grid/MultiChartGrid', () => ({ default: () => <div data-testid="multichart-grid">GRID</div> }))
vi.mock('./grid/MultiChartMenu', () => ({ default: () => <div data-testid="multichart-menu">MC MENU</div> }))
vi.mock('react-grid-layout', () => ({
  Responsive: ({ children }) => <div data-testid="rgl-responsive">{children}</div>,
  WidthProvider: (C) => C,
}))

const setPref = vi.fn()
let mockPrefs = {}
vi.mock('../../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPref, loading: false }),
  parsePref: (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  },
}))
vi.mock('../../hooks/useMediaQuery', () => ({ default: () => false }))

// The palette reads the flag through AuthContext; the workspace through useAuth().
vi.mock('../../context/AuthContext', async () => {
  const { createContext } = await import('react')
  const value = { user: { id: 1, role: 'user' }, addressSpaceEnabled: true }
  return { AuthContext: createContext(value), useAuth: () => value }
})

const SWING = {
  id: 12, name: 'Swing Board', scope: 'user', groups: null,
  layout: { widgets: [{ id: 'w1', type: 'watchlist', color: 'A', x: 0, y: 0, w: 4, h: 8, opts: {} }], cols: 24 },
}
const MACRO = {
  id: 13, name: 'Macro Board', scope: 'user', groups: null,
  layout: { widgets: [{ id: 'f1', type: 'fundamentals', color: 'A', x: 0, y: 0, w: 4, h: 8, opts: {} }], cols: 24 },
}
vi.mock('../../hooks/useChartLayouts', () => ({
  default: () => ({
    global: [], mine: [SWING, MACRO], isLoading: false,
    saveLayout: async () => ({}), deleteLayout: async () => {}, refresh: () => {},
  }),
}))

import CommandPalette from '../../components/CommandPalette'
import ChartsWorkspace from './ChartsWorkspace'

const ADDRESSES = [
  { address: 'L:12', kind: 'layout', kind_label: 'Chart layout', name: 'Swing Board', to: '/charts?openLayout=12' },
  { address: 'L:13', kind: 'layout', kind_label: 'Chart layout', name: 'Macro Board', to: '/charts?openLayout=13' },
  { address: 'W:w-abc', kind: 'watchlist', kind_label: 'Watchlist', name: 'Swing Names', to: '/charts?openWatchlist=user:w-abc' },
  { address: 'W:w-def', kind: 'watchlist', kind_label: 'Watchlist', name: 'Macro Names', to: '/charts?openWatchlist=user:w-def' },
  { address: 'T:ts_abc', kind: 'theme_set', kind_label: 'Theme set', name: 'Swing themes', to: '/charts?openThemeSet=ts_abc' },
  { address: 'T:ts_def', kind: 'theme_set', kind_label: 'Theme set', name: 'Macro themes', to: '/charts?openThemeSet=ts_def' },
]

let commits = 0
// A runaway (H14) never returns control to the test, so a bound checked AFTER the pick
// could never fail; the commit counter itself throws past a hard ceiling, which turns a
// loop into a red test instead of a hung run.
const RUNAWAY = 200
function countCommit() {
  commits += 1
  if (commits > RUNAWAY) throw new Error(`H14 runaway: ${commits} commits`)
}
function RouteSpy() {
  const l = useLocation()
  return <div data-testid="route-spy">{l.pathname}{l.search}</div>
}
function renderAtCharts() {
  window.history.pushState({}, '', '/charts')
  return render(
    <BrowserRouter>
      <CommandPalette />
      <Profiler id="ws" onRender={countCommit}>
        <ChartsWorkspace />
      </Profiler>
      <RouteSpy />
    </BrowserRouter>,
  )
}

async function pick(query, rowName) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))
  })
  fireEvent.change(screen.getByRole('combobox'), { target: { value: query } })
  const row = await screen.findByRole('option', { name: `${rowName}. Enter to open.` })
  const before = commits
  fireEvent.click(row)
  return before
}

// A loop would run to React's update-depth ceiling (50 nested) or forever; one pick
// measured at 0-2 commits (2026-10-01). The bound is the H14 rail, not a performance budget.
const MAX_COMMITS_PER_PICK = 6

beforeEach(() => {
  commits = 0
  setPref.mockReset()
  mockPrefs = { charts_workspace_layout: JSON.stringify({ widgets: [], cols: 24 }) }
  global.fetch = vi.fn((url) => {
    const u = String(url)
    if (u.startsWith('/api/address/search')) {
      const q = new URL(u, 'http://x').searchParams.get('q')?.toLowerCase() || ''
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: ADDRESSES.filter(a => a.name.toLowerCase().includes(q)), unavailable: [] }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [], notes: [] }) })
  })
})
afterEach(() => {
  cleanup()
  delete global.fetch
  window.history.pushState({}, '', '/')
})

const widgets = (type) => document.querySelectorAll(`[data-testid="body-${type}"]`)

test('a layout picked while ALREADY on /charts opens; a second pick opens the other; a re-pick of the first opens it again', async () => {
  renderAtCharts()
  await act(async () => {})
  expect(widgets('watchlist').length, 'the starting board is empty').toBe(0)

  let before = await pick('swing board', 'Chart layout: Swing Board')
  await waitFor(() => expect(widgets('watchlist').length).toBe(1))
  expect(window.location.search, 'the door is stripped once applied').toBe('')
  expect(screen.getByTestId('route-spy').textContent, 'the router agrees the door is gone').toBe('/charts')
  expect(commits - before).toBeLessThanOrEqual(MAX_COMMITS_PER_PICK)

  before = await pick('macro board', 'Chart layout: Macro Board')
  await waitFor(() => expect(widgets('fundamentals').length).toBe(1))
  expect(widgets('watchlist').length, 'the second board REPLACED the first').toBe(0)
  expect(commits - before).toBeLessThanOrEqual(MAX_COMMITS_PER_PICK)

  before = await pick('swing board', 'Chart layout: Swing Board')
  await waitFor(() => expect(widgets('watchlist').length).toBe(1))
  expect(widgets('fundamentals').length).toBe(0)
  expect(commits - before).toBeLessThanOrEqual(MAX_COMMITS_PER_PICK)
  expect(window.location.search).toBe('')
})

test('a watchlist picked twice while mounted retargets the SAME widget each time', async () => {
  renderAtCharts()
  await act(async () => {})

  let before = await pick('swing names', 'Watchlist: Swing Names')
  await waitFor(() => expect(widgets('watchlist')[0]).toHaveAttribute('data-watchkey', 'user:w-abc'))
  expect(commits - before).toBeLessThanOrEqual(MAX_COMMITS_PER_PICK)

  before = await pick('macro names', 'Watchlist: Macro Names')
  await waitFor(() => expect(widgets('watchlist')[0]).toHaveAttribute('data-watchkey', 'user:w-def'))
  expect(widgets('watchlist').length, 'retargeted, not a second widget').toBe(1)
  expect(commits - before).toBeLessThanOrEqual(MAX_COMMITS_PER_PICK)
  expect(window.location.search).toBe('')
})

test('a theme set picked while mounted lands on the board, and a second pick retargets it', async () => {
  renderAtCharts()
  await act(async () => {})
  let before = await pick('swing themes', 'Theme set: Swing themes')
  await waitFor(() => expect(widgets('themes')[0]).toHaveAttribute('data-themeset', 'ts_abc'))
  expect(commits - before).toBeLessThanOrEqual(MAX_COMMITS_PER_PICK)
  expect(window.location.search).toBe('')

  before = await pick('macro themes', 'Theme set: Macro themes')
  await waitFor(() => expect(widgets('themes')[0]).toHaveAttribute('data-themeset', 'ts_def'))
  expect(widgets('themes').length).toBe(1)
  expect(commits - before).toBeLessThanOrEqual(MAX_COMMITS_PER_PICK)
})

test('back after a door lands on an entry that re-opens nothing (the strip replaced it)', async () => {
  renderAtCharts()
  await act(async () => {})
  await pick('swing names', 'Watchlist: Swing Names')
  await waitFor(() => expect(widgets('watchlist').length).toBe(1))
  await pick('macro board', 'Chart layout: Macro Board')
  await waitFor(() => expect(widgets('fundamentals').length).toBe(1))
  const before = commits
  await act(async () => { window.history.back(); await new Promise(r => setTimeout(r, 30)) })
  // The entry we went back to was the stripped `/charts`, so no door fires and the
  // board the member is looking at is not replaced under them.
  expect(window.location.search).toBe('')
  expect(widgets('fundamentals').length).toBe(1)
  expect(commits - before).toBeLessThanOrEqual(MAX_COMMITS_PER_PICK)
})
