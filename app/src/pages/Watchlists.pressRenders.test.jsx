/**
 * NEXT-ROW: ONE ARROW PRESS IS ONE RENDER OF THE LIST (2026-11-23, next-row key profile, round 3).
 *
 * On the /charts board the colour group's symbol lives in a store (groupSymsStore), whose readers render
 * synchronously in the press's own task, the list's host among them. The key handler set the selection inside a
 * `startTransition` (6beb18e1c1, for hosts that keep the group symbol in React STATE, the breadth drill, where the
 * transition lets a fast scan skip rows), so on the board one press rendered the list THREE times: the store's
 * render (the new group symbol, the old selection), then the selection from the `hubSym -> setSelectedSym` effect
 * (a scheduler task), then the transition's own no-op render; and ScanRows built the visible rows' props twice.
 * Where the host says its symbol is in a store (`selectInPress`, the board's WatchlistWidget), the selection is now
 * set beside the group symbol, outside the transition: one render, and the effect finds the two already agree.
 *   P1 a store host, virtualized list: one press = ONE render of Watchlists and ONE of ScanRows; no transition;
 *      the highlight and the group symbol both on the new row
 *   P2 a store host, small list: one press = ONE render of Watchlists
 *   P3 a host that keeps the group symbol in React state (no `selectInPress`): the press is still a transition,
 *      as before (the breadth drill's coalescing)
 *
 * Counters: `useBulkQuotes` (mocked) is called once per Watchlists render; `useVirtualizer` (wrapped, real) once per
 * ScanRows render; `startTransition` (wrapped, real) once per transition the handler starts.
 *
 * Mutation proof: the selection back in the transition on a store host -> P1, P2 red; the selection out of the
 * transition on a state host -> P3 red.
 */
import React, { useMemo, useState, useSyncExternalStore } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { ChartsSymContext } from './charts/ChartsSymContext'

const hoisted = vi.hoisted(() => ({ prebuilt: [], wl: 0, scan: 0, transitions: 0 }))

vi.mock('react', async (importOriginal) => {
  const real = await importOriginal()
  const startTransition = (fn) => { hoisted.transitions++; return real.startTransition(fn) }
  return { ...real, default: { ...real, startTransition }, startTransition }
})
vi.mock('@tanstack/react-virtual', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, useVirtualizer: (opts) => { hoisted.scan++; return real.useVirtualizer(opts) } }
})
vi.mock('swr', () => ({
  default: (key) => {
    const k = Array.isArray(key) ? key[0] : key
    const path = typeof k === 'string' ? k.split('?')[0] : null
    if (path === '/api/watchlists') return { data: [], mutate: () => {} }
    if (path === '/api/watchlists/public') return { data: [], mutate: () => {} }
    if (path === '/api/watchlists/prebuilt') return { data: hoisted.prebuilt, mutate: () => {} }
    return { data: undefined, mutate: () => {} }
  },
  SWRConfig: ({ children }) => children,
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
const MOCK_USER = { id: 'u1', role: 'user', display_name: 'Pat' }
vi.mock('../context/AuthContext', async () => {
  const { createContext } = await import('react')
  return { useAuth: () => ({ user: MOCK_USER }), AuthContext: createContext({ user: MOCK_USER }) }
})
vi.mock('../utils/prefetchBars', () => ({
  prefetchBars: () => {}, prefetchBarsToIDB: () => {}, prefetchAllTimeframes: () => {},
  prefetchBarOnIntent: () => {}, prefetchListAllTimeframes: () => {}, warmMemFromIDB: () => {},
  prefetchVisibleList: () => {}, prewarmVisibleList: () => {},
}))
const PRICES = { prices: {}, staleSymbols: new Set(), isStreaming: false, status: 'idle' }
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => PRICES }))
const BULK = {}
vi.mock('../hooks/useBulkQuotes', () => ({ default: () => { hoisted.wl++; return BULK } }))

const { default: Watchlists } = await import('./Watchlists')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const press = () => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
const settle = () => act(async () => { await sleep(30) })
const selectedSyms = (container) =>
  [...container.querySelectorAll('[data-watch-sym]')]
    .filter((el) => /listRowSelected/.test(el.className))
    .map((el) => el.getAttribute('data-watch-sym'))
const resetCounts = () => { hoisted.wl = 0; hoisted.scan = 0; hoisted.transitions = 0 }

// The board's shape: the group symbol in a store, its reader renders synchronously on a change.
function makeStore() {
  let sym = null
  const subs = new Set()
  return {
    get: () => sym,
    set: (s) => { if (s === sym) return; sym = s; for (const f of subs) f() },
    subscribe: (f) => { subs.add(f); return () => subs.delete(f) },
  }
}
function StoreHost({ store, children }) {
  const sym = useSyncExternalStore(store.subscribe, store.get)
  const ctx = useMemo(() => ({ sym, setSym: store.set, selectInPress: true }), [sym, store])
  return <ChartsSymContext.Provider value={ctx}>{children}</ChartsSymContext.Provider>
}
// The breadth drill's shape: the group symbol in React state.
function StateHost({ children }) {
  const [sym, setSym] = useState(null)
  const ctx = useMemo(() => ({ sym, setSym }), [sym])
  return <ChartsSymContext.Provider value={ctx}>{children}</ChartsSymContext.Provider>
}

beforeEach(() => {
  try { localStorage.clear() } catch { /* private mode */ }
  resetCounts()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 30 })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 400 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 400 })
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { top: 0, left: 0, bottom: 600, right: 400, width: 400, height: 600, x: 0, y: 0, toJSON() {} }
  }
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb) { this.cb = cb }
    observe(el) { this.cb([{ target: el, contentRect: el.getBoundingClientRect() }], this) }
    unobserve() {}
    disconnect() {}
  })
})
afterEach(() => { vi.unstubAllGlobals() })

async function mountOnFirstRow(listId, host) {
  const view = render(host(<Watchlists embedded pickList={`community:${listId}`} pickName={listId} />))
  await waitFor(() => expect(view.container.querySelectorAll('[data-watch-sym]').length).toBeGreaterThan(0))
  await settle()
  await press()                                        // onto the first row
  await settle()
  resetCounts()
  return view
}

describe('a store host (the /charts board)', () => {
  it('P1 virtualized list: one press is one render of Watchlists and one of ScanRows, and no transition', async () => {
    hoisted.prebuilt = [{ id: 'big', name: 'Big', items: Array.from({ length: 400 }, (_, i) => ({ id: `S${i}`, sym: `S${i}`, notes: '' })) }]
    const store = makeStore()
    const { container } = await mountOnFirstRow('big', (el) => <StoreHost store={store}>{el}</StoreHost>)
    expect(store.get()).toBe('S0')
    expect(hoisted.wl).toBe(0)                           // the counters are quiet between presses (or this proves nothing)
    await press()                                        // S0 -> S1
    await settle()
    expect(store.get()).toBe('S1')
    expect(selectedSyms(container)).toEqual(['S1'])
    expect(hoisted.transitions).toBe(0)
    expect(hoisted.wl).toBe(1)
    expect(hoisted.scan).toBe(1)
  })

  it('P2 small list: one press is one render of Watchlists', async () => {
    hoisted.prebuilt = [{ id: 'small', name: 'Small', items: Array.from({ length: 12 }, (_, i) => ({ id: `D${i}`, sym: `D${i}`, notes: '' })) }]
    const store = makeStore()
    const { container } = await mountOnFirstRow('small', (el) => <StoreHost store={store}>{el}</StoreHost>)
    await press()                                        // D0 -> D1
    await settle()
    expect(store.get()).toBe('D1')
    expect(selectedSyms(container)).toEqual(['D1'])
    expect(hoisted.wl).toBe(1)
  })
})

describe('a host that keeps the group symbol in React state (the breadth drill)', () => {
  it('P3 the press is still a transition, as before', async () => {
    hoisted.prebuilt = [{ id: 'small', name: 'Small', items: Array.from({ length: 12 }, (_, i) => ({ id: `D${i}`, sym: `D${i}`, notes: '' })) }]
    const { container } = await mountOnFirstRow('small', (el) => <StateHost>{el}</StateHost>)
    await press()                                        // D0 -> D1
    await settle()
    expect(hoisted.transitions).toBe(1)
    expect(selectedSyms(container)).toEqual(['D1'])
  })
})
