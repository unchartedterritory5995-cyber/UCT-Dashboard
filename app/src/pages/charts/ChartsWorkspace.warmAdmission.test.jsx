/* ⚡ (2026-11-26, the board switch; owner: "never a lone chart") A MEMBER'S SWITCH MOUNTS ITS WARM CHARTS TOGETHER.
 * The main board's staggered mount admitted a switch's new widgets one per 300 ms, so a two-chart board showed chart 1
 * and, a third of a second later, chart 2 (bench probe: chart 2 at +333 ms, the list at +634 ms). On a member's switch
 * every chart whose bars the store already holds is now mounted in the switch's own commit; cold charts keep the pacing.
 *   A1 (red first) a dock switch to a warm two-chart board: both chart bodies are mounted in the commit that shows it
 *   A2 the same switch with nothing held: the charts keep the paced admission (never both in that commit)
 *   A3 (review: finding 4) an intraday chart that shows extended hours is asked about its EXTENDED key: its regular-hours
 *      key held alone does not make it warm
 */
import { render, act, cleanup } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

// every WidgetHost render records whether its body is mounted, per commit of the board
const hostRenders = []
vi.mock('./WidgetHost', () => ({ default: ({ widget, mounted }) => { hostRenders.push({ id: widget.id, mounted: mounted !== false }); return <div data-testid={`host-${widget.id}`} /> } }))
vi.mock('./mobile/MobileChartsApp', () => ({ default: () => <div data-testid="mobile-charts-app">MOBILE</div> }))
vi.mock('./grid/MultiChartGrid', () => ({ default: () => <div data-testid="multichart-grid">GRID</div> }))
vi.mock('./grid/MultiChartMenu', () => ({ default: () => <div data-testid="multichart-menu">MC MENU</div> }))
// the grid (its node carries `react-grid-layout`, as the real one's does): every COMMIT records the node's classes and the
// layout it was given; a button stands in for a member's drag
const gridCommits = []
vi.mock('react-grid-layout', async () => {
  const { useLayoutEffect, useRef } = await import('react')
  return {
    Responsive: ({ children, onLayoutChange, className, layouts }) => {
      const ref = useRef(null)
      const lg = (layouts && layouts.lg) || []
      useLayoutEffect(() => { gridCommits.push({ classes: String(ref.current?.className || ''), lg }) })
      return (
        <div ref={ref} data-testid="rgl-responsive" className={`react-grid-layout ${className || ''}`}>
          <button data-testid="rgl-drag" onClick={() => onLayoutChange && onLayoutChange([{ i: 'watchlist-1', x: 10, y: 2, w: 6, h: 8 }])}>drag</button>
          {children}
        </div>
      )
    },
    WidthProvider: (C) => C,
  }
})
vi.mock('../journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

const prefStore = (() => {
  let prefs = {}
  const subs = new Set()
  return {
    get: () => prefs,
    set: (p) => { prefs = p; subs.forEach(f => f()) },
    write: (k, v) => { prefs = { ...prefs, [k]: v }; subs.forEach(f => f()) },
    subscribe: (f) => { subs.add(f); return () => subs.delete(f) },
  }
})()
const setPref = vi.fn((k, v) => { prefStore.write(k, v); return Promise.resolve(true) })
vi.mock('../../hooks/usePreferences', () => ({
  default: function usePreferences() { return { prefs: useSyncExternalStore(prefStore.subscribe, prefStore.get), setPref, loading: false } },
  parsePref: (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  },
}))
vi.mock('../../hooks/useMediaQuery', () => ({ default: () => false }))
vi.mock('../../context/AuthContext', async () => {
  const { createContext } = await import('react')
  const value = { user: { id: 1, role: 'admin', plan: 'pro' }, addressSpaceEnabled: false }
  return { AuthContext: createContext(value), useAuth: () => value }
})


const MAIN = { id: 1, name: 'Main Trading', scope: 'user', groups: null, layout: { widgets: [{ id: 'watchlist-1', type: 'watchlist', color: 'A', x: 0, y: 0, w: 6, h: 8, opts: {} }], cols: 24 } }
const INTRA = { id: 3, name: 'Intraday Pair', scope: 'user', groups: null, layout: { widgets: [
  { id: 'chart-5a', type: 'chart', color: 'A', x: 0, y: 0, w: 12, h: 20, opts: { tf: '5' } },
  { id: 'chart-5b', type: 'chart', color: 'B', x: 12, y: 0, w: 12, h: 20, opts: { tf: '5' } },
], cols: 24 } }
const TWO = { id: 2, name: 'Two Charts', scope: 'user', groups: null, layout: { widgets: [
  { id: 'chart-1', type: 'chart', color: 'A', x: 0, y: 0, w: 8, h: 20, opts: { tf: 'D' } },
  { id: 'chart-2', type: 'chart', color: 'B', x: 8, y: 0, w: 8, h: 20, opts: { tf: 'D' } },
  { id: 'wl-2', type: 'watchlist', color: 'A', x: 16, y: 0, w: 8, h: 20, opts: {} },
], cols: 24 } }
vi.mock('../../hooks/useChartLayouts', () => ({
  default: () => ({ global: [], mine: [MAIN, TWO, INTRA], isLoading: false, saveLayout: async () => ({}), deleteLayout: async () => {}, refresh: () => {} }),
}))

import ChartsWorkspace from './ChartsWorkspace'

beforeEach(() => {
  hostRenders.length = 0
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url) => {
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (String(url).startsWith('/api/watchlists')) return json([])
    if (String(url).startsWith('/api/auth/preferences')) return new Response('', { status: 503 })
    return json({})
  })
})
afterEach(() => { cleanup(); delete globalThis.fetch; delete globalThis.__uctStoreHoldsBars })

function mount() {
  prefStore.set({
    charts_workspace_layout: JSON.stringify(MAIN.layout),
    charts_active_template: JSON.stringify({ id: MAIN.id, name: MAIN.name, scope: MAIN.scope }),
    charts_workspace_groups: JSON.stringify({ A: 'AAPL', B: 'MSFT', C: null, D: null }),
  })
  return render(<MemoryRouter><ChartsWorkspace /></MemoryRouter>)
}
const dockButton = (name) => [...document.querySelectorAll('[role="toolbar"][aria-label="Saved layouts"] button')].find(b => b.textContent.trim() === name) || null
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
// the first board commit that rendered both charts' hosts: were both bodies mounted in it?
function firstCommitWithBoth() {
  const i1 = hostRenders.findIndex((r) => r.id === 'chart-1')
  const i2 = hostRenders.findIndex((r) => r.id === 'chart-2')
  return { c1: hostRenders[i1]?.mounted, c2: hostRenders[i2]?.mounted }
}

test('A1 (red first) a switch to a warm two-chart board mounts both chart bodies in the commit that shows it', async () => {
  globalThis.__uctStoreHoldsBars = vi.fn(() => true)
  mount()
  await settle()
  await act(async () => { dockButton('Two Charts').click() })
  const first = firstCommitWithBoth()
  expect(first, 'a chart of the warm board waited for its paced turn').toEqual({ c1: true, c2: true })
  expect(globalThis.__uctStoreHoldsBars).toHaveBeenCalledWith('AAPL', 'D', { showExtended: true })
  expect(globalThis.__uctStoreHoldsBars).toHaveBeenCalledWith('MSFT', 'D', { showExtended: true })
})

test('A2 the same switch with nothing held keeps the paced admission', async () => {
  globalThis.__uctStoreHoldsBars = vi.fn(() => false)
  mount()
  await settle()
  await act(async () => { dockButton('Two Charts').click() })
  const first = firstCommitWithBoth()
  expect(first.c1 && first.c2, 'cold charts were mounted together, past the pacing').toBe(false)
})

test('A3 (red first) an intraday chart showing extended hours is warm only if its EXTENDED key is held', async () => {
  // the store holds only the regular-hours key (the view the store assumes when no session is named)
  globalThis.__uctStoreHoldsBars = vi.fn((sym, tf, o) => (o?.showExtended ?? false) === false)
  mount()
  await settle()
  await act(async () => { dockButton('Intraday Pair').click() })
  const a = hostRenders.find((r) => r.id === 'chart-5a')
  const b = hostRenders.find((r) => r.id === 'chart-5b')
  expect(a.mounted && b.mounted, 'charts were admitted at once on a key they do not show').toBe(false)
})
