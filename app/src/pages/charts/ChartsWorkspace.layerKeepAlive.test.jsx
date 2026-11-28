/* ⭐ (2026-11-27, the board keep-alive's LAYER mode; boardKeepAlive.js '2') A RETURN FLIPS A VISIBILITY, NOTHING ELSE.
 * The kept board is not in an <Activity>: it stays mounted AND laid out under the board in front (absolute, inset 0,
 * visibility hidden, inert), every effect of it alive, its work paused through its handle.
 *   LK1 (red first) MAIN -> TWO -> MAIN: the same instance, no effect cleaned up at the hide and none re-run at the show;
 *       the kept board is a hidden, inert layer (never display: none)
 *   LK2 (red first) the kept board's widgets read their board as hidden (useBoardHidden), the front board's as shown,
 *       and the show turns it back
 *   LK3 (red first) a group symbol switched on the board in front does not reach the kept board's linked widget; the
 *       show applies it
 *   LK4 (red first) the kept board's SWR polls are paused (its slot's SWRConfig), the front board's are not
 *   LK5 a third board disposes the kept one with a plain unmount (its effects' cleanups run)
 *   LK6 '1' is still the <Activity> mode (no layer slot)
 * Review of #2901:
 *   LK7 (red first, H2) a key both boards read: mutate() from the board in front fetches once and the front board shows
 *       it, though the kept board's hook was mounted first (a paused first hook swallowed it)
 *   LK8 (red first, M3 + D2) a board hidden 3 s: its show re-reads each POLLED key once (three hooks on one key make
 *       ONE request) and never a static key (no refresh interval); a quick back-and-forth re-reads nothing
 *   LK9 (red first, M4) a group TIMEFRAME changed on the board in front waits for the kept board's show, like a symbol
 *   LK10 (red first, H1) a layer hide leaves no chart or watchlist "active" (the key handlers follow those refs)
 *   LK11 (red first, M5) a menu the hidden board opened into document.body (a portal) is closed by the hide
 *   LK12 every way a kept layer board is dropped (a third board, grid mode, the desk hiding the workspace, ten hidden
 *        minutes, the workspace leaving) unmounts it with its handle disposed
 *   LK13 (red first; review of #2901, D3 + L3) a board kept 30 minutes without a show goes, page visible or not
 * Review of #2911:
 *   LK12 + (red first, F1) the Agent deleting the kept board's layout drops it (the menu's delete already did); the
 *        Agent deleting another layout leaves it kept
 *   LK14 (red first, F2) a layer switch to a board that is not kept marks the NEW grid (charts-switching: no item
 *        transition on its first layout passes), never the hidden one, and the mark clears; a return to a kept board
 *        marks nothing
 * Lane G (2026-11-28, plan PR 2.3):
 *   LK16 (red first) K = 2 (`uct.boardKeepAlive.k`): two boards are kept behind the one in front, and a return to
 *        either is the same instance; a board past the K-th drops the LEAST RECENTLY SHOWN one, never a newer one
 *   LK17 (red first) THE FLIP: a return to a kept board renders NEITHER board's grid (the shown one's kept element, the
 *        hidden one's last element), and the workspace attributes move to the board in front on the DOM
 *   LK18 (red first) the kept element's handlers are the slot's gate: a hidden board's grid writes nothing; the same
 *        board shown again writes through the workspace's CURRENT handlers
 * Review of #2923:
 *   LK15 (red first, F2-a) two layer switches to new boards in one frame, then back to the first: its grid carries no
 *        mark (the second switch's mark took it off), and after the frames no grid does
 */
import { render, act, cleanup, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

// every WidgetHost INSTANCE: its mount (a state initialiser), its effect runs and cleanups, and what each render read
const hosts = vi.hoisted(() => ({ created: {}, effects: {}, cleanups: {}, renders: [], ws: {}, swr: {}, vis: {}, swrKey: null, fetches: 0, menuFor: null, swrFor: {}, byKey: {}, grids: [], gridProps: {} }))
vi.mock('./WidgetHost', async () => {
  const { useState, useEffect, useContext } = await import('react')
  const { createPortal } = await import('react-dom')
  const { default: useSWR, useSWRConfig } = await import('swr')
  const { useBoardHidden, BoardVisibilityContext } = await import('../../components/chart/boardVisibility')
  const { useWorkspace } = await import('./WorkspaceContext')
  // a menu in document.body that closes on a press elsewhere, as the product's menus do
  function Menu({ id }) {
    const [open, setOpen] = useState(true)
    useEffect(() => {
      const close = () => setOpen(false)
      document.addEventListener('mousedown', close)
      return () => document.removeEventListener('mousedown', close)
    }, [])
    return open ? createPortal(<div data-testid={`menu-${id}`}>menu</div>, document.body) : null
  }
  return {
    default: ({ widget }) => {
      useState(() => { hosts.created[widget.id] = (hosts.created[widget.id] || 0) + 1; return 0 })
      useEffect(() => {
        hosts.effects[widget.id] = (hosts.effects[widget.id] || 0) + 1
        return () => { hosts.cleanups[widget.id] = (hosts.cleanups[widget.id] || 0) + 1 }
      }, [])
      const hidden = useBoardHidden()
      const ws = useWorkspace()
      const sym = ws.groupSyms?.[widget.color] ?? null
      const cfg = useSWRConfig()
      const { data } = useSWR(hosts.swrKey, async () => { hosts.fetches++; return hosts.fetches })
      // LK8: a widget's own reads (three hooks on one polled key, one static key)
      const own = hosts.swrFor[widget.id] || null
      const read = (k) => async () => { hosts.byKey[k] = (hosts.byKey[k] || 0) + 1; return hosts.byKey[k] }
      const polled = { refreshInterval: own?.interval || 0, dedupingInterval: 500 }
      useSWR(own ? own.key : null, read(own?.key), polled)
      useSWR(own ? own.key : null, read(own?.key), polled)
      useSWR(own ? own.key : null, read(own?.key), polled)
      useSWR(own ? own.staticKey : null, read(own?.staticKey), { dedupingInterval: 500 })
      hosts.ws[widget.id] = ws
      hosts.swr[widget.id] = cfg
      hosts.vis[widget.id] = useContext(BoardVisibilityContext)
      hosts.renders.push({ id: widget.id, hidden, sym, tf: ws.groupTfs?.[widget.color] ?? null, data })
      return <div data-testid={`host-${widget.id}`}>{widget.id}{hosts.menuFor === widget.id ? <Menu id={widget.id} /> : null}</div>
    },
  }
})
vi.mock('../../agent/agentApp', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useAgentPageHost: (...a) => { hosts.agentHost = a[1]; return actual.useAgentPageHost(...a) } }
})
vi.mock('./mobile/MobileChartsApp', () => ({ default: () => <div data-testid="mobile-charts-app">MOBILE</div> }))
vi.mock('./grid/MultiChartGrid', () => ({ default: () => <div data-testid="multichart-grid">GRID</div> }))
vi.mock('./grid/MultiChartMenu', () => ({ default: () => <div data-testid="multichart-menu">MC MENU</div> }))
vi.mock('react-grid-layout', async () => ({
  // every grid render, by the widget ids it lays out (LK17), and each grid's latest handlers (LK18)
  Responsive: (props) => {
    const ids = (Array.isArray(props.children) ? props.children : [props.children]).filter(Boolean).map((c) => String(c.key)).sort().join(',')
    hosts.grids.push(ids)
    hosts.gridProps[ids] = props
    return <div data-testid="rgl-responsive" className={`react-grid-layout ${props.className || ''}`}>{props.children}</div>
  },
  WidthProvider: (C) => C,
}))
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

const MAIN = { id: 1, name: 'Main Trading', scope: 'user', groups: null, layout: { widgets: [
  { id: 'watchlist-1', type: 'watchlist', color: 'A', x: 0, y: 0, w: 6, h: 8, opts: {} },
], cols: 24 } }
const TWO = { id: 2, name: 'Two Charts', scope: 'user', groups: null, layout: { widgets: [
  { id: 'chart-1', type: 'chart', color: 'A', x: 0, y: 0, w: 8, h: 20, opts: { tf: 'D' } },
  { id: 'chart-2', type: 'chart', color: 'B', x: 8, y: 0, w: 8, h: 20, opts: { tf: 'D' } },
], cols: 24 } }
const INTRA = { id: 3, name: 'Intraday Pair', scope: 'user', groups: null, layout: { widgets: [
  { id: 'chart-5a', type: 'chart', color: 'A', x: 0, y: 0, w: 12, h: 20, opts: { tf: '5' } },
], cols: 24 } }
const FOUR = { id: 4, name: 'Fourth Board', scope: 'user', groups: null, layout: { widgets: [
  { id: 'chart-4a', type: 'chart', color: 'C', x: 0, y: 0, w: 12, h: 20, opts: { tf: '15' } },
], cols: 24 } }
vi.mock('../../hooks/useChartLayouts', () => ({
  default: () => ({ global: [], mine: [MAIN, TWO, INTRA, FOUR], isLoading: false, saveLayout: async () => ({}), deleteLayout: async () => {}, refresh: () => {} }),
}))

import ChartsWorkspace from './ChartsWorkspace'

let swrSeq = 0
beforeEach(() => {
  Object.assign(hosts, { created: {}, effects: {}, cleanups: {}, renders: [], ws: {}, swr: {}, vis: {}, swrKey: null, fetches: 0, menuFor: null, swrFor: {}, byKey: {}, grids: [], gridProps: {} })
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url) => {
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (String(url).startsWith('/api/watchlists')) return json([])
    if (String(url).startsWith('/api/auth/preferences')) return new Response('', { status: 503 })
    return json({})
  })
})
afterEach(() => { cleanup(); delete globalThis.fetch })

function mount(mode = '2') {
  localStorage.setItem('uct.boardKeepAlive', mode)
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
const host = (id) => document.querySelector(`[data-testid="host-${id}"]`)
const slotOf = (el) => el?.closest('[data-board-current], [inert]') || null
const displayNone = (el) => { for (let n = el; n; n = n.parentElement) if (n.style && n.style.display === 'none') return true; return false }
const lastRender = (id) => [...hosts.renders].reverse().find((r) => r.id === id)

test('LK1 (red first) a return is the same instance: no cleanup at the hide, no effect at the show; the kept board is a layer', async () => {
  mount()
  await settle()
  expect(hosts.effects['watchlist-1']).toBe(1)
  await go('Two Charts')
  expect(host('watchlist-1'), 'MAIN was unmounted when TWO came in front').toBeTruthy()
  expect(hosts.cleanups['watchlist-1'] || 0, 'the hide cleaned up the kept board\'s effects').toBe(0)
  expect(displayNone(host('watchlist-1')), 'the kept board was put in display: none').toBe(false)
  const slot = slotOf(host('watchlist-1'))
  expect(slot?.hasAttribute('inert'), 'the kept board is not inert').toBe(true)
  expect(slot?.getAttribute('aria-hidden')).toBe('true')
  expect(slot?.className || '').toMatch(/boardSlotLayer/)
  expect(slotOf(host('chart-1'))?.hasAttribute('inert')).toBe(false)
  await go('Main Trading')
  expect(hosts.created['watchlist-1'], 'the return mounted MAIN again').toBe(1)
  expect(hosts.effects['watchlist-1'], 'the show re-ran the kept board\'s effects').toBe(1)
  expect(hosts.cleanups['watchlist-1'] || 0).toBe(0)
  expect(slotOf(host('watchlist-1'))?.hasAttribute('inert')).toBe(false)
  expect(slotOf(host('chart-1'))?.hasAttribute('inert'), 'TWO, now kept, is not a layer').toBe(true)
})

test('LK2 (red first) the kept board reads itself hidden; the show turns it back', async () => {
  mount()
  await settle()
  expect(lastRender('watchlist-1').hidden).toBe(false)
  await go('Two Charts')
  expect(lastRender('watchlist-1').hidden, 'the kept board does not read itself hidden').toBe(true)
  expect(lastRender('chart-1').hidden).toBe(false)
  await go('Main Trading')
  expect(lastRender('watchlist-1').hidden).toBe(false)
  expect(lastRender('chart-1').hidden).toBe(true)
})

test('LK3 (red first) a group switch on the board in front waits for the show of the kept board', async () => {
  mount()
  await settle()
  expect(lastRender('watchlist-1').sym, 'NON-VACUITY: MAIN reads group A').toBe('AAPL')
  await go('Two Charts')
  await act(async () => { hosts.ws['chart-1'].setGroupSym('A', 'NVDA') })
  await settle()
  expect(lastRender('chart-1').sym, 'NON-VACUITY: the board in front switched').toBe('NVDA')
  expect(hosts.renders.filter((r) => r.id === 'watchlist-1' && r.sym === 'NVDA').length,
    'the kept board followed a switch made on the board in front').toBe(0)
  await go('Main Trading')
  expect(lastRender('watchlist-1').sym, 'the show did not apply the switch').toBe('NVDA')
})

test('LK4 (red first) the kept board\'s SWR polls are off (isVisible), the front board\'s are not', async () => {
  mount()
  await settle()
  await go('Two Charts')
  expect(hosts.swr['watchlist-1'].isVisible(), 'the kept board polls').toBe(false)
  expect(hosts.swr['chart-1'].isVisible()).toBe(true)
  expect(hosts.swr['watchlist-1'].isPaused(), 'H2: a paused hook swallows mutate() and retries for the board in front').toBe(false)
  await go('Main Trading')
  expect(hosts.swr['watchlist-1'].isVisible()).toBe(true)
  expect(hosts.swr['chart-1'].isVisible()).toBe(false)
})

test('LK5 a third board disposes the kept board with a plain unmount', async () => {
  mount()
  await settle()
  await go('Two Charts')
  await go('Intraday Pair')
  expect(host('watchlist-1'), 'MAIN still mounted behind two other boards').toBeNull()
  expect(hosts.cleanups['watchlist-1'], 'MAIN dropped without its cleanups').toBe(1)
  expect(hosts.cleanups['chart-1'] || 0, 'TWO (now kept) was cleaned up').toBe(0)
})

test('LK6 \'1\' is still the <Activity> mode', async () => {
  mount('1')
  await settle()
  await go('Two Charts')
  expect(displayNone(host('watchlist-1'))).toBe(true)
  expect(document.querySelector('[inert]')).toBeNull()
  expect(lastRender('watchlist-1').hidden).toBe(false)
})

test('LK7 (red first, H2) mutate() of a key both boards read fetches once and reaches the board in front', async () => {
  hosts.swrKey = `/api/shared-${++swrSeq}`
  mount()
  await settle()
  await go('Two Charts')              // the kept board's hook for the key was mounted first
  await settle()
  const before = hosts.fetches
  await act(async () => { await hosts.swr['chart-1'].mutate(hosts.swrKey) })
  await settle()
  expect(hosts.fetches - before, 'a mutate() from the board in front fetched nothing').toBe(1)
  const last = [...hosts.renders].reverse().find((r) => r.id === 'chart-1')
  expect(last.data, 'the board in front does not show the refetch').toBe(hosts.fetches)
})

test('LK8 (red first, M3 + D2) a show re-reads each polled key once, never a static one; a quick return nothing', async () => {
  const key = `/api/polled-${++swrSeq}`, staticKey = `/api/static-${swrSeq}`
  hosts.swrFor = { 'watchlist-1': { key, interval: 1000, staticKey } }
  const reads = () => ({ polled: hosts.byKey[key] || 0, fixed: hosts.byKey[staticKey] || 0 })
  mount()
  await settle()
  await act(async () => { await new Promise((r) => setTimeout(r, 100)) })
  expect(reads().polled, 'NON-VACUITY: the three hooks read their key once at mount').toBe(1)
  await go('Two Charts')
  await go('Main Trading')            // back at once
  await act(async () => { await new Promise((r) => setTimeout(r, 300)) })
  expect(reads(), 'a quick return re-read').toEqual({ polled: 1, fixed: 1 })
  await go('Two Charts')
  await act(async () => { await new Promise((r) => setTimeout(r, 3000)) })
  expect(reads(), 'a hidden board polled').toEqual({ polled: 1, fixed: 1 })
  await go('Main Trading')
  await act(async () => { await new Promise((r) => setTimeout(r, 400)) })
  expect(reads().polled - 1, 'the show re-read the polled key once per HOOK, or not at all').toBe(1)
  expect(reads().fixed - 1, 'the show re-read a static key').toBe(0)
}, 15000)

test('LK9 (red first, M4) a group timeframe change waits for the kept board\'s show', async () => {
  mount()
  await settle()
  await go('Two Charts')
  const tfBefore = lastRender('watchlist-1').tf
  await act(async () => { hosts.ws['chart-1'].setGroupTf('A', '5') })
  await settle()
  expect(lastRender('chart-1').tf, 'NON-VACUITY: the board in front took the timeframe').toBe('5')
  expect(hosts.renders.filter((r) => r.id === 'watchlist-1' && r.tf === '5').length,
    'the kept board followed a timeframe change made on the board in front').toBe(0)
  expect(tfBefore).not.toBe('5')
  await go('Main Trading')
  expect(lastRender('watchlist-1').tf, 'the show did not apply the timeframe').toBe('5')
})

test('LK10 (red first, H1) a layer hide leaves no chart or watchlist active', async () => {
  mount()
  await settle()
  hosts.ws['watchlist-1'].activeChartRef.current = 'w-main'
  hosts.ws['watchlist-1'].activeWatchlistRef.current = 'watchlist-1'
  await go('Two Charts')
  expect(hosts.ws['chart-1'].activeChartRef.current, 'a chart of the hidden board is still active').toBeNull()
  expect(hosts.ws['chart-1'].activeWatchlistRef.current, 'a watchlist of the hidden board is still active').toBeNull()
})

test('LK11 (red first, M5) a menu the hidden board opened into document.body closes at the hide', async () => {
  hosts.menuFor = 'watchlist-1'
  mount()
  await settle()
  expect(document.querySelector('[data-testid="menu-watchlist-1"]'), 'NON-VACUITY: the menu is open').toBeTruthy()
  await go('Two Charts')               // a click() on the dock: no press reached the document
  expect(document.querySelector('[data-testid="menu-watchlist-1"]'), 'the hidden board left its menu over the board in front').toBeNull()
})

describe('LK12 every way a kept layer board is dropped unmounts it with its handle disposed', () => {
  const kept = async () => {
    const view = mount()
    await settle()
    await go('Two Charts')
    const vis = hosts.vis['watchlist-1']
    expect(vis?.state, 'NON-VACUITY: MAIN is kept').toBe('hidden')
    return { view, vis }
  }
  const dropped = (vis) => {
    expect(hosts.cleanups['watchlist-1'], 'the kept board was not unmounted').toBe(1)
    expect(vis.state).toBe('disposed')
    expect(hosts.cleanups['chart-1'] || 0, 'the board in front was unmounted').toBe(0)
  }
  test('a third board', async () => { const { vis } = await kept(); await go('Intraday Pair'); dropped(vis) })
  test('grid mode', async () => {
    const { vis } = await kept()
    await act(async () => { prefStore.write('multichart_state', JSON.stringify({ mode: 'grid', layout: '1x2', cells: [] })) })
    await settle()
    expect(hosts.cleanups['watchlist-1']).toBe(1)
    expect(vis.state).toBe('disposed')
  })
  test('the desk hiding the workspace', async () => {
    const { view, vis } = await kept()
    view.rerender(<MemoryRouter><ChartsWorkspace hidden /></MemoryRouter>)
    await settle()
    expect(hosts.cleanups['watchlist-1']).toBe(1)
    expect(vis.state).toBe('disposed')
  })
  test('ten hidden minutes', async () => {
    const { vis } = await kept()
    vi.useFakeTimers()
    try {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      act(() => { document.dispatchEvent(new Event('visibilitychange')) })
      act(() => { vi.advanceTimersByTime(10 * 60_000 + 1) })
      dropped(vis)
    } finally {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
      vi.useRealTimers()
    }
  })
  test('the Agent deleting its layout (review of #2911, F1)', async () => {
    const { vis } = await kept()
    expect(typeof hosts.agentHost?.layouts?.remove, 'NON-VACUITY: the Agent host has the layouts door').toBe('function')
    await act(async () => { await hosts.agentHost.layouts.remove(INTRA.id) })
    await settle()
    expect(hosts.cleanups['watchlist-1'] || 0, 'the Agent deleting ANOTHER layout dropped the kept board').toBe(0)
    expect(vis.state).toBe('hidden')
    await act(async () => { await hosts.agentHost.layouts.remove(MAIN.id) })
    await settle()
    dropped(vis)
  })
  test('the workspace leaving', async () => {
    const { view, vis } = await kept()
    view.unmount()
    expect(hosts.cleanups['watchlist-1']).toBe(1)
    expect(vis.state).toBe('disposed')
  })
})

test('LK13 (red first) a board kept 30 minutes without a show goes, the page visible', async () => {
  // the cap's timer starts at the switch: fake timers first (advancing with real time, so the awaits still run)
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    mount()
    await settle()
    await go('Two Charts')
    const vis = hosts.vis['watchlist-1']
    expect(vis?.state, 'NON-VACUITY: MAIN is kept').toBe('hidden')
    act(() => { vi.advanceTimersByTime(29 * 60_000) })
    expect(hosts.cleanups['watchlist-1'] || 0).toBe(0)
    act(() => { vi.advanceTimersByTime(60_000 + 1) })
    expect(hosts.cleanups['watchlist-1'], 'a board kept 30 minutes without a show is still kept').toBe(1)
    expect(vis.state).toBe('disposed')
    expect(hosts.cleanups['chart-1'] || 0, 'the board in front was dropped').toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

test('LK14 (red first; review of #2911, F2) a layer switch to a board not kept marks the NEW grid; a return marks nothing', async () => {
  mount()
  await settle()
  // the load's own switch marked MAIN's grid (the remount path); it clears after two frames
  await waitFor(() => expect(document.querySelectorAll('.react-grid-layout.charts-switching').length, 'NON-VACUITY: the load mark clears').toBe(0))
  await act(async () => { dockButton('Two Charts').click() })
  const front = document.querySelector('[data-board-current] .react-grid-layout')
  expect(front, 'NON-VACUITY: the board in front has a grid').toBeTruthy()
  expect(host('chart-1')?.closest('.react-grid-layout'), 'NON-VACUITY: TWO is the board in front').toBe(front)
  expect(front.classList.contains('charts-switching'), 'the fresh grid of a board not kept was not marked').toBe(true)
  const hiddenGrid = host('watchlist-1')?.closest('.react-grid-layout')
  expect(hiddenGrid && hiddenGrid !== front, 'NON-VACUITY: MAIN is kept in its own grid').toBe(true)
  expect(hiddenGrid.classList.contains('charts-switching'), 'the hidden grid was marked').toBe(false)
  await waitFor(() => expect(front.classList.contains('charts-switching'), 'the mark never cleared').toBe(false))
  await act(async () => { dockButton('Main Trading').click() })
  expect(document.querySelectorAll('.react-grid-layout.charts-switching').length, 'a return to a kept board marked a grid').toBe(0)
  await settle()
})

test('LK15 (red first; review of #2923, F2-a) two layer switches to new boards in one frame, then back to the first: no mark on its grid', async () => {
  // the frames are this test's: nothing runs between the two switches
  const frames = []
  vi.stubGlobal('requestAnimationFrame', (f) => { frames.push(f); return frames.length })
  const flushFrames = () => act(() => { for (let i = 0; i < 10 && frames.length; i++) frames.splice(0).forEach((f) => f(0)) })
  try {
    mount()
    await settle()
    flushFrames()                                   // the load's own mark comes off
    expect(document.querySelectorAll('.react-grid-layout.charts-switching').length, 'NON-VACUITY: the load mark is off').toBe(0)
    await act(async () => { dockButton('Two Charts').click() })
    const twoGrid = host('chart-1')?.closest('.react-grid-layout')
    expect(twoGrid?.classList.contains('charts-switching'), 'NON-VACUITY: the first new grid is marked').toBe(true)
    await act(async () => { dockButton('Intraday Pair').click() })   // no frame ran since the first switch
    expect(host('chart-5a')?.closest('.react-grid-layout')?.classList.contains('charts-switching'), 'NON-VACUITY: the second new grid is marked').toBe(true)
    await act(async () => { dockButton('Two Charts').click() })
    expect(host('chart-1')?.closest('.react-grid-layout'), 'NON-VACUITY: TWO came back as the kept board').toBe(twoGrid)
    expect(twoGrid.classList.contains('charts-switching'), 'the first new grid kept its mark through the return').toBe(false)
    flushFrames()
    expect(document.querySelectorAll('.react-grid-layout.charts-switching').length, 'a grid kept a mark after the frames').toBe(0)
  } finally {
    vi.unstubAllGlobals()
  }
  await settle()
})

test('LK16 (red first; Lane G) K = 2 keeps two boards behind the front one; past K the least recently shown goes', async () => {
  localStorage.setItem('uct.boardKeepAlive.k', '2')
  mount()
  await settle()
  await go('Two Charts')
  await go('Intraday Pair')
  expect(host('watchlist-1'), 'MAIN (two boards back) was not kept with K = 2').toBeTruthy()
  expect(hosts.cleanups['watchlist-1'] || 0).toBe(0)
  await go('Main Trading')
  expect(hosts.created['watchlist-1'], 'the return to MAIN mounted it again').toBe(1)
  expect(hosts.effects['watchlist-1']).toBe(1)
  expect(slotOf(host('watchlist-1'))?.hasAttribute('inert')).toBe(false)
  // kept now: INTRA (just left), TWO (least recently shown). A fourth board drops TWO, never INTRA.
  await go('Fourth Board')
  expect(hosts.cleanups['chart-1'], 'the least recently shown board (TWO) was not dropped').toBe(1)
  expect(hosts.cleanups['chart-5a'] || 0, 'a more recently shown board (INTRA) was dropped').toBe(0)
  expect(hosts.cleanups['watchlist-1'] || 0, 'MAIN (just left) was dropped').toBe(0)
  await go('Intraday Pair')
  expect(hosts.created['chart-5a'], 'INTRA came back fresh').toBe(1)
  // the widget attributes are on the board in front only
  expect(document.querySelectorAll('[data-widget-id="chart-5a"]').length).toBe(1)
  expect(document.querySelectorAll('[data-widget-id="watchlist-1"]').length, 'a kept board carries data-widget-id').toBe(0)
})

test('LK17 (red first; Lane G) a return to a kept board renders neither grid; the attributes follow the board in front', async () => {
  mount()
  await settle()
  await go('Two Charts')
  await go('Main Trading')
  await go('Two Charts')
  await settle()
  hosts.grids.length = 0
  await go('Main Trading')
  expect(hosts.grids.filter((g) => g === 'chart-1,chart-2').length, "the hide re-rendered the leaving board's grid").toBe(0)
  expect(hosts.grids.filter((g) => g === 'watchlist-1').length, "the show re-rendered the shown board's grid").toBe(0)
  expect(document.querySelectorAll('[data-widget-id="watchlist-1"]').length).toBe(1)
  expect(document.querySelector('[data-widget-id="watchlist-1"]')?.getAttribute('data-widget-type')).toBe('watchlist')
  expect(document.querySelectorAll('[data-widget-id="chart-1"]').length, 'the kept board kept its data-widget-id').toBe(0)
  expect(document.querySelectorAll('[data-widget-type="chart"]').length, 'the kept board kept its data-widget-type').toBe(0)
  hosts.grids.length = 0
  await go('Two Charts')
  expect(hosts.grids.length, 'the second return rendered a grid').toBe(0)
  expect(document.querySelectorAll('[data-widget-id="chart-1"]').length).toBe(1)
  expect(document.querySelectorAll('[data-widget-id="watchlist-1"]').length).toBe(0)
})

test("LK18 (red first; Lane G) a hidden board's grid writes nothing; shown again it writes through the current handlers", async () => {
  mount()
  await settle()
  await go('Two Charts')
  const hiddenGrid = hosts.gridProps['watchlist-1']
  expect(typeof hiddenGrid?.onLayoutChange, 'NON-VACUITY: the kept grid has a layout handler').toBe('function')
  const moved = (x) => [{ i: 'watchlist-1', x, y: 0, w: 6, h: 8 }]
  setPref.mockClear()
  await act(async () => { hiddenGrid.onLayoutChange(moved(3), { lg: moved(3) }) })
  await act(async () => { await new Promise((r) => setTimeout(r, 700)) })
  const wrote = () => setPref.mock.calls.filter(([k, v]) => k === 'charts_workspace_layout' && String(v).includes('"x":3'))
  expect(wrote().length, "a hidden board's grid wrote the board").toBe(0)
  await go('Main Trading')
  setPref.mockClear()
  // the very handler object the grid was last rendered with (the flip renders it no more): it reaches the workspace now
  await act(async () => { hosts.gridProps['watchlist-1'].onLayoutChange(moved(3), { lg: moved(3) }) })
  await act(async () => { await new Promise((r) => setTimeout(r, 700)) })
  expect(wrote().length, 'the board in front, shown again, did not write through its grid').toBeGreaterThan(0)
})
