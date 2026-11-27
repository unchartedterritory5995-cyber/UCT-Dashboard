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
 *   LK8 (red first, M3) a board hidden 2 s or more revalidates its SWR reads after its show's first paint; a quick
 *       back-and-forth does not
 *   LK9 (red first, M4) a group TIMEFRAME changed on the board in front waits for the kept board's show, like a symbol
 *   LK10 (red first, H1) a layer hide leaves no chart or watchlist "active" (the key handlers follow those refs)
 *   LK11 (red first, M5) a menu the hidden board opened into document.body (a portal) is closed by the hide
 *   LK12 every way a kept layer board is dropped (a third board, grid mode, the desk hiding the workspace, ten hidden
 *        minutes, the workspace leaving) unmounts it with its handle disposed
 */
import { render, act, cleanup } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

// every WidgetHost INSTANCE: its mount (a state initialiser), its effect runs and cleanups, and what each render read
const hosts = vi.hoisted(() => ({ created: {}, effects: {}, cleanups: {}, renders: [], ws: {}, swr: {}, vis: {}, swrKey: null, fetches: 0, menuFor: null }))
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
      hosts.ws[widget.id] = ws
      hosts.swr[widget.id] = cfg
      hosts.vis[widget.id] = useContext(BoardVisibilityContext)
      hosts.renders.push({ id: widget.id, hidden, sym, tf: ws.groupTfs?.[widget.color] ?? null, data })
      return <div data-testid={`host-${widget.id}`}>{widget.id}{hosts.menuFor === widget.id ? <Menu id={widget.id} /> : null}</div>
    },
  }
})
vi.mock('./mobile/MobileChartsApp', () => ({ default: () => <div data-testid="mobile-charts-app">MOBILE</div> }))
vi.mock('./grid/MultiChartGrid', () => ({ default: () => <div data-testid="multichart-grid">GRID</div> }))
vi.mock('./grid/MultiChartMenu', () => ({ default: () => <div data-testid="multichart-menu">MC MENU</div> }))
vi.mock('react-grid-layout', async () => ({
  Responsive: ({ children, className }) => <div data-testid="rgl-responsive" className={`react-grid-layout ${className || ''}`}>{children}</div>,
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
vi.mock('../../hooks/useChartLayouts', () => ({
  default: () => ({ global: [], mine: [MAIN, TWO, INTRA], isLoading: false, saveLayout: async () => ({}), deleteLayout: async () => {}, refresh: () => {} }),
}))

import ChartsWorkspace from './ChartsWorkspace'

let swrSeq = 0
beforeEach(() => {
  Object.assign(hosts, { created: {}, effects: {}, cleanups: {}, renders: [], ws: {}, swr: {}, vis: {}, swrKey: null, fetches: 0, menuFor: null })
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

test('LK8 (red first, M3) a board hidden 2 s or more revalidates its reads after its show; a quick return does not', async () => {
  hosts.swrKey = `/api/kept-${++swrSeq}`
  mount()
  await settle()
  await go('Two Charts')
  await go('Main Trading')            // back at once
  await act(async () => { await new Promise((r) => setTimeout(r, 100)) })
  const quick = hosts.fetches
  await go('Two Charts')
  await act(async () => { await new Promise((r) => setTimeout(r, 2100)) })
  const before = hosts.fetches
  expect(before, 'NON-VACUITY: no revalidation after a quick return').toBe(quick)
  await go('Main Trading')
  await act(async () => { await new Promise((r) => setTimeout(r, 100)) })
  expect(hosts.fetches - before, 'a board hidden 2 s was not revalidated at its show').toBeGreaterThan(0)
}, 10000)

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
  test('the workspace leaving', async () => {
    const { view, vis } = await kept()
    view.unmount()
    expect(hosts.cleanups['watchlist-1']).toBe(1)
    expect(vis.state).toBe('disposed')
  })
})
