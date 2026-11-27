/* ⭐ (2026-11-27, board keep-alive Stage 2; boardKeepAlive.js) A RETURN TO THE BOARD A MEMBER JUST LEFT SHOWS IT.
 * With `uct.boardKeepAlive` on, the board a member's switch leaves stays mounted, hidden in <Activity>, and a switch back
 * to the very same layout shows it instead of mounting every widget again. One board is kept.
 *   K1 (red first) MAIN -> TWO -> MAIN: MAIN's widget is the SAME instance (created once), hidden while TWO is in front
 *   K2 with the keep-alive off the return mounts it again (today)
 *   K3 the kept board is never written: a drag on its grid moves nothing on the board in front, even a widget of the
 *      same id (boards saved from one another share widget ids)
 *   K4 the attributes a widget is found by (data-widget-id) are only on the board in front
 *   K5 one board is kept: MAIN -> TWO -> INTRA disposes MAIN, and the return mounts it again
 *   K6 a board whose saved layout changed meanwhile is mounted fresh, never the stale kept copy
 *   K7 the kept board's widgets stay admitted by the main board's stagger: a return to a four-widget board renders every
 *      one mounted in its first commit (not paced back in)
 */
import { render, act, cleanup } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

// every WidgetHost INSTANCE: a state initialiser runs once per mount, and not again at an <Activity> show
const hosts = vi.hoisted(() => ({ created: {}, renders: [] }))
vi.mock('./WidgetHost', async () => {
  const { useState } = await import('react')
  return {
    default: ({ widget, mounted }) => {
      useState(() => { hosts.created[widget.id] = (hosts.created[widget.id] || 0) + 1; return 0 })
      hosts.renders.push({ id: widget.id, mounted: mounted !== false })
      return <div data-testid={`host-${widget.id}`}>{widget.id}</div>
    },
  }
})
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
      useLayoutEffect(() => { gridCommits.push({ classes: String(ref.current?.className || ''), lg, el: ref.current }) })
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


let MAIN_LAYOUT = null
const mainLayout = (x = 0) => ({ widgets: [{ id: 'watchlist-1', type: 'watchlist', color: 'A', x, y: 0, w: 6, h: 8, opts: {} }], cols: 24 })
const MAIN = { id: 1, name: 'Main Trading', scope: 'user', groups: null, get layout() { return MAIN_LAYOUT } }
const TWO = { id: 2, name: 'Two Charts', scope: 'user', groups: null, layout: { widgets: [
  { id: 'chart-1', type: 'chart', color: 'A', x: 0, y: 0, w: 8, h: 20, opts: { tf: 'D' } },
  { id: 'chart-2', type: 'chart', color: 'B', x: 8, y: 0, w: 8, h: 20, opts: { tf: 'D' } },
], cols: 24 } }
const INTRA = { id: 3, name: 'Intraday Pair', scope: 'user', groups: null, layout: { widgets: [
  { id: 'chart-5a', type: 'chart', color: 'A', x: 0, y: 0, w: 12, h: 20, opts: { tf: '5' } },
], cols: 24 } }
const DUP = { id: 4, name: 'Dup Board', scope: 'user', groups: null, layout: { widgets: [
  { id: 'watchlist-1', type: 'watchlist', color: 'A', x: 12, y: 0, w: 6, h: 8, opts: {} },
], cols: 24 } }
const QUAD = { id: 5, name: 'Quad Board', scope: 'user', groups: null, layout: { widgets: ['q1', 'q2', 'q3', 'q4'].map((id, i) => (
  { id, type: 'watchlist', color: 'A', x: i * 6, y: 0, w: 6, h: 8, opts: {} })), cols: 24 } }
vi.mock('../../hooks/useChartLayouts', () => ({
  default: () => ({ global: [], mine: [MAIN, TWO, INTRA, DUP, QUAD], isLoading: false, saveLayout: async () => ({}), deleteLayout: async () => {}, refresh: () => {} }),
}))

import ChartsWorkspace from './ChartsWorkspace'

beforeEach(() => {
  hosts.created = {}
  hosts.renders = []
  gridCommits.length = 0
  MAIN_LAYOUT = mainLayout(0)
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url) => {
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (String(url).startsWith('/api/watchlists')) return json([])
    if (String(url).startsWith('/api/auth/preferences')) return new Response('', { status: 503 })
    return json({})
  })
})
afterEach(() => { cleanup(); delete globalThis.fetch })

function mount({ keepAlive = true } = {}) {
  if (keepAlive) localStorage.setItem('uct.boardKeepAlive', '1')
  prefStore.set({
    charts_workspace_layout: JSON.stringify(MAIN.layout),
    charts_active_template: JSON.stringify({ id: MAIN.id, name: MAIN.name, scope: MAIN.scope }),
    charts_workspace_groups: JSON.stringify({ A: 'AAPL', B: 'MSFT', C: null, D: null }),
  })
  return render(<MemoryRouter><ChartsWorkspace /></MemoryRouter>)
}
const dockButton = (name) => [...document.querySelectorAll('[role="toolbar"][aria-label="Saved layouts"] button')].find(b => b.textContent.trim() === name) || null
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const go = async (name) => { await act(async () => { dockButton(name).click() }); await settle() }
// shown: no ancestor hidden by <Activity> (it sets display: none on the board's slot)
const shown = (el) => { for (let n = el; n; n = n.parentElement) if (n.style && n.style.display === 'none') return false; return true }
const host = (id) => document.querySelector(`[data-testid="host-${id}"]`)

test('K1 (red first) a return to the board just left shows the same instance', async () => {
  mount()
  await settle()
  expect(hosts.created['watchlist-1']).toBe(1)
  await go('Two Charts')
  expect(host('watchlist-1'), 'MAIN was unmounted when TWO came in front').toBeTruthy()
  expect(shown(host('watchlist-1')), 'the kept board is visible behind TWO').toBe(false)
  expect(shown(host('chart-1'))).toBe(true)
  await go('Main Trading')
  expect(hosts.created['watchlist-1'], 'the return mounted MAIN again').toBe(1)
  expect(shown(host('watchlist-1'))).toBe(true)
  expect(shown(host('chart-1')), 'TWO, now kept, is visible').toBe(false)
})

test('K2 with the keep-alive off the return mounts the board again', async () => {
  mount({ keepAlive: false })
  await settle()
  await go('Two Charts')
  expect(host('watchlist-1')).toBeNull()
  await go('Main Trading')
  expect(hosts.created['watchlist-1']).toBe(2)
})

test('K3 the kept board is never written: a drag on its grid moves nothing on the board in front', async () => {
  mount()
  await settle()
  await go('Dup Board')                       // the board in front holds a watchlist-1 of its own, at x 12
  const hiddenGrid = [...document.querySelectorAll('[data-testid="rgl-responsive"]')].find((g) => !shown(g))
  expect(hiddenGrid, 'NON-VACUITY: the kept board has its grid').toBeTruthy()
  const frontX = () => [...gridCommits].reverse().find((c) => c.el && c.el.isConnected && shown(c.el))?.lg.find((i) => i.i === 'watchlist-1')?.x
  expect(frontX(), 'NON-VACUITY: the board in front shows its own watchlist-1').toBe(12)
  await act(async () => { hiddenGrid.querySelector('[data-testid="rgl-drag"]').click() })   // the stand-in drag: watchlist-1 to x 10
  await settle()
  expect(frontX(), 'a drag on the kept board moved the board in front').toBe(12)
})

test('K4 data-widget-id is only on the board in front', async () => {
  mount()
  await settle()
  expect(document.querySelectorAll('[data-widget-id="watchlist-1"]').length).toBe(1)
  await go('Two Charts')
  expect(document.querySelectorAll('[data-widget-id="watchlist-1"]').length, 'the kept board still names its widget').toBe(0)
  expect(document.querySelectorAll('[data-widget-id="chart-1"]').length).toBe(1)
  await go('Main Trading')
  expect(document.querySelectorAll('[data-widget-id="watchlist-1"]').length).toBe(1)
  expect(document.querySelectorAll('[data-widget-id="chart-1"]').length).toBe(0)
})

test('K5 one board is kept: a third board disposes the first', async () => {
  mount()
  await settle()
  await go('Two Charts')
  await go('Intraday Pair')
  expect(host('watchlist-1'), 'MAIN still mounted behind two other boards').toBeNull()
  expect(host('chart-1'), 'TWO is the kept board').toBeTruthy()
  await go('Main Trading')
  expect(hosts.created['watchlist-1']).toBe(2)
})

test('K6 a board saved differently meanwhile is mounted fresh', async () => {
  mount()
  await settle()
  await go('Two Charts')
  MAIN_LAYOUT = mainLayout(2)
  await go('Main Trading')
  expect(hosts.created['watchlist-1'], 'the stale kept copy was shown').toBe(2)
})

test('K7 a return to a four-widget board renders every widget mounted in its first commit', async () => {
  mount()
  await settle()
  await go('Quad Board')
  await act(async () => { await new Promise((r) => setTimeout(r, 2000)) })   // all four admitted
  await go('Main Trading')
  hosts.renders = []
  await act(async () => { dockButton('Quad Board').click() })
  const first = ['q1', 'q2', 'q3', 'q4'].map((id) => hosts.renders.find((r) => r.id === id)?.mounted)
  expect(first, 'a widget of the kept board was paced back in').toEqual([true, true, true, true])
})
