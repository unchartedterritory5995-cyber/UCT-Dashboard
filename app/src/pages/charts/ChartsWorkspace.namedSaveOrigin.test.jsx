/* ⛔ (2026-11-27, the live production sweep's S3b) THE NAMED SAVE WRITES A BOARD ONLY INTO THE LAYOUT IT CAME FROM.
 * Measured on production: a preferences read that began before a dock switch answered after it and put the OLD
 * `charts_active_template` back into the cache, under the NEW board. The auto-save 400 ms later wrote the new board
 * into the old layout's row by name, and every later switch between the two opened the same board.
 *   NO1 (red first) a switch MAIN -> TWO, then the old pointer (MAIN) put back by a stale read: the auto-save does not
 *       write TWO's board into MAIN's row (the board's own preference is still written: the save ran)
 *   NO2 CONTROL: a board taken from the stored preferences (its pointer is its origin) still auto-saves into that
 *       layout
 * Review of #2926:
 *   NO3 (red first, F-A) the row is written under ITS name, found by id: a pointer whose name is stale (renamed
 *       elsewhere) never writes another layout that now has the old name
 *   NO4 (red first, F-B) a member's Save (UCT Agent's layout.saveCurrent) refused by the guard answers
 *       { ok: false, named: 'skipped' } and says so; nothing says "Saved"
 *   NO5 (red first, F-C) a board taken from the stored preferences takes THEIR pointer as its origin: a stale pointer
 *       put back after the first load writes nothing either
 *   NO6 (red first, F-D) a Save As that answers after a switch adopts nothing: the board on screen keeps its pointer
 */
import { render, act, cleanup } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const st = vi.hoisted(() => ({ calls: [], mine: [], agentHost: null, saveAsGate: null }))
vi.mock('./WidgetHost', () => ({ default: ({ widget }) => <div data-testid={`host-${widget.id}`}>{widget.id}</div> }))
vi.mock('./mobile/MobileChartsApp', () => ({ default: () => <div data-testid="mobile-charts-app">MOBILE</div> }))
vi.mock('./grid/MultiChartGrid', () => ({ default: () => <div data-testid="multichart-grid">GRID</div> }))
vi.mock('./grid/MultiChartMenu', () => ({ default: () => <div data-testid="multichart-menu">MC MENU</div> }))
vi.mock('react-grid-layout', async () => ({
  Responsive: ({ children, className }) => <div data-testid="rgl-responsive" className={`react-grid-layout ${className || ''}`}>{children}</div>,
  WidthProvider: (C) => C,
}))
vi.mock('../journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
vi.mock('../../agent/agentApp', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useAgentPageHost: (...a) => { st.agentHost = a[1]; return actual.useAgentPageHost(...a) } }
})

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
  refreshPreferences: async () => null,
  mergeIntoPreferenceCache: async () => {},
  settlePreferenceWrites: () => {},
}))
vi.mock('../../hooks/useMediaQuery', () => ({ default: () => false }))
vi.mock('../../context/AuthContext', async () => {
  const { createContext } = await import('react')
  const value = { user: { id: 1, role: 'admin', plan: 'pro' }, addressSpaceEnabled: false }
  return { AuthContext: createContext(value), useAuth: () => value }
})

const MAIN = { id: 1, name: 'Main Trading', scope: 'user', groups: null, layout: { widgets: [
  { id: 'watchlist-1', type: 'watchlist', color: 'A', x: 0, y: 0, w: 6, h: 8, opts: {} },
], cols: 24 } }
const TWO = { id: 2, name: 'Two Charts', scope: 'user', groups: null, layout: { widgets: [
  { id: 'chart-1', type: 'chart', color: 'A', x: 0, y: 0, w: 8, h: 20, opts: { tf: 'D' } },
  { id: 'chart-2', type: 'chart', color: 'B', x: 8, y: 0, w: 8, h: 20, opts: { tf: 'D' } },
], cols: 24 } }
const OLDNAME = { id: 3, name: 'Old name', scope: 'user', groups: null, layout: { widgets: [
  { id: 'watchlist-9', type: 'watchlist', color: 'A', x: 0, y: 0, w: 6, h: 8, opts: {} },
], cols: 24 } }
vi.mock('../../hooks/useChartLayouts', () => ({
  default: () => ({
    global: [], mine: st.mine, isLoading: false,
    saveLayout: async (arg) => {
      st.calls.push(arg)
      if (arg.name === 'Copy' && st.saveAsGate) { await st.saveAsGate.promise; return { id: 7, name: 'Copy', scope: 'user' } }
      const row = st.mine.find((t) => t.name === arg.name)
      return { id: row ? row.id : 99, name: arg.name, scope: 'user' }
    },
    deleteLayout: async () => {}, refresh: () => {},
  }),
}))

import ChartsWorkspace from './ChartsWorkspace'

const pointer = (t, name = t.name) => JSON.stringify({ id: t.id, name, scope: t.scope })
beforeEach(() => {
  st.calls.length = 0
  st.mine = [MAIN, TWO]
  st.agentHost = null
  st.saveAsGate = null
  setPref.mockClear()
  try { localStorage.clear() } catch { /* */ }
  localStorage.setItem('uct.boardKeepAlive', '0')
  globalThis.fetch = vi.fn(async (url) => {
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (String(url).startsWith('/api/watchlists')) return json([])
    if (String(url).startsWith('/api/auth/preferences')) return new Response('', { status: 503 })
    return json({})
  })
})
afterEach(() => { cleanup(); delete globalThis.fetch })

function mount(board = MAIN.layout, active = pointer(MAIN)) {
  prefStore.set({
    charts_workspace_layout: JSON.stringify(board),
    charts_active_template: active,
    charts_workspace_groups: JSON.stringify({ A: 'AAPL', B: 'MSFT', C: null, D: null }),
  })
  return render(<MemoryRouter><ChartsWorkspace /></MemoryRouter>)
}
const dockButton = (name) => [...document.querySelectorAll('[role="toolbar"][aria-label="Saved layouts"] button')].find(b => b.textContent.trim() === name) || null
const wait = async (ms) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)) }) }
const widgetIds = (call) => (call?.layout?.widgets || []).map((w) => w.id).sort()
const into = (name) => st.calls.filter((c) => c.name === name)
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }

test('NO1 (red first) a stale pointer put back under a switched board: TWO is never written into MAIN', async () => {
  mount()
  await wait(50)
  await act(async () => { dockButton('Two Charts').click() })
  await wait(50)
  expect(document.querySelector('[data-testid="host-chart-1"]'), 'NON-VACUITY: the switch put TWO on screen').toBeTruthy()
  // a preferences read that began before the switch answers after it: the OLD pointer comes back into the cache
  await act(async () => { prefStore.write('charts_active_template', pointer(MAIN)) })
  setPref.mockClear()
  await wait(900)                                   // the auto-save's 400 ms, and its writes
  expect(into(MAIN.name).map(widgetIds), 'the board on screen (TWO) was written into MAIN\'s row').toEqual([])
  expect(setPref.mock.calls.some(([k]) => k === 'charts_workspace_layout'), 'NON-VACUITY: the auto-save ran (the board preference)').toBe(true)
})

test('NO2 CONTROL: a board taken from the stored preferences still auto-saves into the layout they name', async () => {
  // the stored board is MAIN plus a chart (edited before a reload): dirty against MAIN's row, and MAIN's own
  mount({ ...MAIN.layout, widgets: [...MAIN.layout.widgets, { id: 'chart-9', type: 'chart', color: 'A', x: 6, y: 0, w: 6, h: 8, opts: { tf: 'D' } }] })
  await wait(900)
  const saved = into(MAIN.name)
  expect(saved.length, 'the board was not saved into its own layout').toBeGreaterThan(0)
  expect(widgetIds(saved[saved.length - 1])).toEqual(['chart-9', 'watchlist-1'])
})

test('NO3 (red first, F-A) a stale pointer name never writes the layout that now has that name', async () => {
  // MAIN (id 1) was renamed elsewhere FROM "Old name"; another layout (id 3) has taken "Old name"; this tab's pointer
  // still names id 1 "Old name"
  st.mine = [MAIN, TWO, OLDNAME]
  mount({ ...MAIN.layout, widgets: [...MAIN.layout.widgets, { id: 'chart-9', type: 'chart', color: 'A', x: 6, y: 0, w: 6, h: 8, opts: { tf: 'D' } }] }, pointer(MAIN, 'Old name'))
  await wait(900)
  expect(into('Old name').map(widgetIds), 'the board was written into the layout that now has the stale name').toEqual([])
  expect(into(MAIN.name).length, 'the board was not saved into its own row (by id, under its name)').toBeGreaterThan(0)
})

test('NO4 (red first, F-B) a member\'s Save refused by the guard says so and answers skipped', async () => {
  mount()
  await wait(50)
  await act(async () => { dockButton('Two Charts').click() })
  await wait(50)
  await act(async () => { prefStore.write('charts_active_template', pointer(MAIN)) })
  expect(typeof st.agentHost?.layouts?.saveCurrent, 'NON-VACUITY: the Agent host has layout.saveCurrent').toBe('function')
  let r
  await act(async () => { r = await st.agentHost.layouts.saveCurrent() })
  expect(r, 'a refused Save read as done').toEqual({ ok: false, named: 'skipped' })
  expect(document.querySelector('[data-testid="workspace-notice-host"]')?.textContent || '', 'the member was not told').toMatch(/not saved/i)
  expect(into(MAIN.name), 'TWO was written into MAIN').toEqual([])
})

test('NO5 (red first, F-C) a board loaded from the stored preferences takes their pointer as its origin', async () => {
  // loaded: TWO's board under TWO's pointer; then a stale read puts MAIN's pointer back
  mount(TWO.layout, pointer(TWO))
  await wait(50)
  await act(async () => { prefStore.write('charts_active_template', pointer(MAIN)) })
  await wait(900)
  expect(into(MAIN.name).map(widgetIds), 'the loaded board (TWO) was written into MAIN\'s row').toEqual([])
})

test('NO6 (red first, F-D) a Save As that answers after a switch adopts nothing', async () => {
  mount()
  await wait(50)
  st.saveAsGate = deferred()
  let p
  await act(async () => { p = st.agentHost.layouts.saveAs('Copy') })
  await act(async () => { dockButton('Two Charts').click() })
  await wait(50)
  expect(JSON.parse(prefStore.get().charts_active_template).id, 'NON-VACUITY: the switch moved the pointer').toBe(TWO.id)
  await act(async () => { st.saveAsGate.resolve(); await p })
  await wait(50)
  expect(JSON.parse(prefStore.get().charts_active_template).id, 'the board on screen (TWO) was pointed at the copy').toBe(TWO.id)
  await wait(900)
  expect(into('Copy').length, 'the board on screen was saved into the copy').toBe(1)
})
