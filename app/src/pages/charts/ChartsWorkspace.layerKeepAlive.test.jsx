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
 */
import { render, act, cleanup } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

// every WidgetHost INSTANCE: its mount (a state initialiser), its effect runs and cleanups, and what each render read
const hosts = vi.hoisted(() => ({ created: {}, effects: {}, cleanups: {}, renders: [], ws: {}, swr: {} }))
vi.mock('./WidgetHost', async () => {
  const { useState, useEffect } = await import('react')
  const { useSWRConfig } = await import('swr')
  const { useBoardHidden } = await import('../../components/chart/boardVisibility')
  const { useWorkspace } = await import('./WorkspaceContext')
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
      hosts.ws[widget.id] = ws
      hosts.swr[widget.id] = cfg
      hosts.renders.push({ id: widget.id, hidden, sym })
      return <div data-testid={`host-${widget.id}`}>{widget.id}</div>
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

beforeEach(() => {
  Object.assign(hosts, { created: {}, effects: {}, cleanups: {}, renders: [], ws: {}, swr: {} })
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

test('LK4 (red first) the kept board\'s SWR polls are paused, the front board\'s are not', async () => {
  mount()
  await settle()
  await go('Two Charts')
  expect(hosts.swr['watchlist-1'].isPaused(), 'the kept board polls').toBe(true)
  expect(hosts.swr['chart-1'].isPaused()).toBe(false)
  await go('Main Trading')
  expect(hosts.swr['watchlist-1'].isPaused()).toBe(false)
  expect(hosts.swr['chart-1'].isPaused()).toBe(true)
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
