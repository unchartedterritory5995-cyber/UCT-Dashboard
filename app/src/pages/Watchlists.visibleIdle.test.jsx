/**
 * ⭐ A VIRTUALIZED LIST'S MOVED WINDOW IS STORED IN IDLE TIME (2026-11-25, the next-row key task).
 *
 * An arrow key scrolls the list to the row it selects; the scroll moves the virtualized window by a row, and storing the
 * new window (which rows stream live prices) re-rendered the WHOLE watchlist in the tasks right after the chart
 * switch's frame (the 40 ms breakdown: ScanRows rendered again after the frame on most presses). A moved window now
 * waits for idle time (Watchlists `handleListVisible`, at most VISIBLE_IDLE_MS); a list's first window is stored at once.
 * Idle time is the test's to give (requestIdleCallback is stubbed; `idle()` runs what waits for it). The streamed set is
 * read where the page hands it to the stream (`useRealtimePrices`, recorded).
 *   1. a list streams its first window at once, with no idle time given, as before;
 *   2. a scroll that moves the window: nothing is stored in the scroll's own task nor before idle (before: the whole
 *      page rendered again to stream the new window there); at idle, the new window streams;
 *   3. several moves before idle: one store, the newest window (the windows in between never stream);
 *   4. a list closed before idle: the wait is cancelled and nothing is stored after it is gone.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'

const BIG = 400
const mkItems = (n) => Array.from({ length: n }, (_, i) => ({ id: `S${i}`, sym: `S${i}`, notes: '' }))
const hoisted = vi.hoisted(() => ({ prebuilt: [], streams: [] }))

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
vi.mock('../hooks/useRealtimePrices', () => ({
  default: (tickers) => {
    hoisted.streams.push(tickers)
    return { prices: {}, staleSymbols: new Set(), isStreaming: false, status: 'idle' }
  },
}))
vi.mock('../hooks/useBulkQuotes', () => ({ default: () => ({}) }))

const { default: Watchlists } = await import('./Watchlists')

const streamed = () => hoisted.streams[hoisted.streams.length - 1] || []
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))
const idleQueue = new Map()
let idleIds = 0
const idle = () => act(async () => {
  const fns = [...idleQueue.values()]
  idleQueue.clear()
  for (const fn of fns) fn({ didTimeout: false, timeRemaining: () => 50 })
})

beforeEach(() => {
  hoisted.streams = []
  hoisted.prebuilt = [{ id: 'big', name: 'Russell 2000', items: mkItems(BIG) }]
  try { localStorage.clear() } catch { /* private mode */ }
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
  idleQueue.clear()
  vi.stubGlobal('requestIdleCallback', (fn) => { idleIds += 1; idleQueue.set(idleIds, fn); return idleIds })
  vi.stubGlobal('cancelIdleCallback', (id) => { idleQueue.delete(id) })
  // a real box for the virtualizer (jsdom answers 0 for every size; Watchlists.virtualized.test.jsx)
  // every element 600 px tall, a ROW 30 px (the virtualizer's own estimate: measuring a row changes nothing)
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.hasAttribute && this.hasAttribute('data-index') ? 30 : 600 } })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 400 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 400 })
  HTMLElement.prototype.getBoundingClientRect = function () {
    const h = this.hasAttribute && this.hasAttribute('data-index') ? 30 : 600
    return { top: 0, left: 0, bottom: h, right: 400, width: 400, height: h, x: 0, y: 0, toJSON() {} }
  }
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb) { this.cb = cb }
    observe(el) { this.cb([{ target: el, contentRect: el.getBoundingClientRect() }], this) }
    unobserve() {}
    disconnect() {}
  })
})
afterEach(() => { vi.unstubAllGlobals() })

/** The list's scroll element (the one the virtualizer listens to), scrolled to `top` the way a browser reports it.
 *  (Row i starts at 30 * i; the window is the 20 rows in the 600 px viewport plus 12 rows of overscan each side.) */
function scrollTo(container, top) {
  let el = container.querySelector('[data-watch-sym]')
  while (el && !(el.className && String(el.className).includes('listBody'))) el = el.parentElement
  if (!el) throw new Error('no list scroll element found')
  Object.defineProperty(el, 'scrollTop', { configurable: true, writable: true, value: top })
  el.dispatchEvent(new Event('scroll'))
}

/** Opened with NO idle time given: the first window has to stream on its own. */
async function openList() {
  const view = render(<Watchlists embedded pickList="community:big" pickName="Russell 2000" />)
  await waitFor(() => expect(streamed().length).toBeGreaterThan(0))
  return view
}

describe("a virtualized list's moved window is stored in idle time", () => {
  it('1. a list streams its first window at once (no idle time given)', async () => {
    await openList()
    const first = streamed()
    expect(first[0]).toBe('S0')
    expect(first.length).toBeGreaterThan(10)
    expect(first.length).toBeLessThan(BIG / 2)
  })

  it("2. a moved window: nothing stored in the scroll's task nor before idle; at idle, the new window", async () => {
    const { container } = await openList()
    await idle()
    const before = streamed()
    const q0 = idleQueue.size
    await act(async () => { scrollTo(container, 1500) })
    expect(streamed(), "streamed in the scroll's own task").toEqual(before)
    await wait(30)
    expect(streamed(), 'streamed before the page is idle').toEqual(before)
    expect(idleQueue.size - q0, 'the new window waits for idle').toBe(1)
    await idle()
    const after = streamed()
    expect(after).not.toEqual(before)
    expect(after.includes('S50'), `the row at the new scroll position streams: ${after.join(',')}`).toBe(true)
    expect(after.includes('S0'), 'the row scrolled away stops streaming').toBe(false)
  })

  it('3. several moves before idle: one store, the newest window', async () => {
    const { container } = await openList()
    await idle()
    const n0 = hoisted.streams.length
    const q0 = idleQueue.size
    await act(async () => { scrollTo(container, 900) })
    await act(async () => { scrollTo(container, 1500) })
    await act(async () => { scrollTo(container, 3000) })
    expect(idleQueue.size - q0, 'one wait for all three').toBe(1)
    await idle()
    const after = streamed()
    expect(after.includes('S100'), after.join(',')).toBe(true)
    expect(after.includes('S30')).toBe(false)
    // the windows in between (rows 18-62, 38-82) never streamed
    expect(hoisted.streams.slice(n0).some((t) => t.includes('S30') && !t.includes('S0'))).toBe(false)
  })

  it('4. a list closed before idle: the wait is cancelled, nothing stored after it is gone', async () => {
    const { container, unmount } = await openList()
    await idle()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const q0 = idleQueue.size
    await act(async () => { scrollTo(container, 1500) })
    expect(idleQueue.size - q0).toBe(1)
    const q1 = idleQueue.size
    const n = hoisted.streams.length
    unmount()
    expect(idleQueue.size, 'unmounting cancels the wait').toBeLessThan(q1)
    await idle()
    expect(hoisted.streams.length).toBe(n)
    expect(errors.mock.calls.map((c) => String(c[0])).filter((m) => /unmounted|not wrapped in act/.test(m))).toEqual([])
    errors.mockRestore()
  })
})
