/**
 * NEXT-ROW: THE ARROW KEY'S SCROLL WAITS FOR THE FRAME THAT SHOWS THE SWITCH (2026-11-23, key-press profiles).
 *
 * Between a watchlist arrow key and the two linked charts' first frame, the list kept its selected row in view
 * INSIDE the commit: the virtualizer centred it (`scrollToIndex` reads the scroller's scrollHeight/clientHeight,
 * a forced layout) and the row's `scrollIntoView` ran (a second one), before the charts could paint. Keeping
 * the row in view now waits for the frame that shows the switch (utils/afterPaintSlot.js); the highlight and the
 * charts do not wait for anything.
 *   K1 the press moves the highlight at once: no frame is needed for it (small and virtualized lists)
 *   K2 the colour group's symbol is set inside the key handler itself (the paired charts follow in that task)
 *   K3 before the frame nothing scrolls and nothing reads the scroller's height
 *   K4 after the frame the selected row is brought into view: a small list's row `scrollIntoView({ block:
 *      'nearest' })`; a virtualized list's row is centred by the virtualizer (scrollTo) and then the same
 *      `scrollIntoView` (what each did before, one frame later)
 *   K5 a held arrow (three presses, no frame between) scrolls ONCE, to the last row
 *   K6 a widget that goes away before the frame scrolls nothing
 *   K7 the arrows walk the rows in the order they are drawn (a column sort), and wrap
 *
 * Mutation proof (each run before calling these done):
 *   the virtualizer's centring back in the commit      -> K3 (virtualized) red
 *   the row's scrollIntoView back in the commit        -> K3 (both) red
 *   no coalescing (a run per press)                    -> K5 red
 *   the unmount does not cancel                        -> K6 red
 *   the highlight waits for the frame                  -> K1 red
 *   the group symbol set a task later                  -> K2 red
 *   the arrows walk the stored order                   -> K7 red
 *
 * Harness: Watchlists.virtualized.test.jsx's (a prebuilt list through mocked SWR, a 600 px box for every element
 * so the virtualizer measures a viewport), plus spies on the two scroll calls and the scrollHeight read, and
 * animation frames the test runs by hand so "before the frame" is a state a test can stand in.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { ChartsSymContext } from './charts/ChartsSymContext'

const BIG = 400          // > VIRTUALIZE_MIN_ROWS
const mkItems = (syms) => syms.map((s) => ({ id: s, sym: s, notes: '' }))

const hoisted = vi.hoisted(() => ({ prebuilt: [] }))

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
  default: () => ({ prices: {}, staleSymbols: new Set(), isStreaming: false, status: 'idle' }),
}))
vi.mock('../hooks/useBulkQuotes', () => ({ default: () => ({}) }))

const { default: Watchlists } = await import('./Watchlists')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const setHidden = (v) => Object.defineProperty(document, 'hidden', { configurable: true, get: () => v })

// The scroll calls and the layout read the arrow key's scroll makes, recorded.
let seen
function spyScroll() {
  seen = { intoView: [], scrollTo: [], heightReads: 0 }
  HTMLElement.prototype.scrollIntoView = function (opts) { seen.intoView.push({ sym: this.getAttribute('data-watch-sym'), opts }) }
  HTMLElement.prototype.scrollTo = function (opts) { seen.scrollTo.push(opts) }
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true, get() { seen.heightReads++; return 100000 },
  })
}
const clearSeen = () => { seen.intoView = []; seen.scrollTo = []; seen.heightReads = 0 }

// Frames the test runs by hand, by id (ids far above jsdom's own, so a cancel of a frame asked for before the
// hold, or of one already run, can never strike a waiting one).
let frames = new Map()
let nextFrameId = 1e6
const runFrames = () => { const q = [...frames.values()]; frames = new Map(); for (const cb of q) cb(0) }
function holdFrames() {
  frames = new Map()
  vi.stubGlobal('requestAnimationFrame', (cb) => { const id = ++nextFrameId; frames.set(id, cb); return id })
  vi.stubGlobal('cancelAnimationFrame', (id) => { frames.delete(id) })
}
const waitingFrames = () => frames.size
/** The frame that shows the press comes and is painted (its animation frames, then the zero timer after it). */
async function paint() {
  await act(async () => { runFrames(); await sleep(5) })
}

const press = (key = 'ArrowDown') =>
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) })
const selectedSyms = (container) =>
  [...container.querySelectorAll('[data-watch-sym]')]
    .filter((el) => /listRowSelected/.test(el.className))
    .map((el) => el.getAttribute('data-watch-sym'))

beforeEach(() => {
  try { localStorage.clear() } catch { /* private mode */ }
  setHidden(false)
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 })
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
  spyScroll()
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete HTMLElement.prototype.scrollIntoView
  delete HTMLElement.prototype.scrollTo
  delete HTMLElement.prototype.scrollHeight
  delete document.hidden
})

/** Mounted, settled, frames held, recorders emptied. `picked` records the group symbol writes as they happen. */
async function mount(listId, name) {
  const picked = []
  const ctx = { sym: null, setSym: (s) => { picked.push(s) } }
  const view = render(
    <ChartsSymContext.Provider value={ctx}>
      <Watchlists embedded pickList={`community:${listId}`} pickName={name} />
    </ChartsSymContext.Provider>,
  )
  await waitFor(() => expect(view.container.querySelectorAll('[data-watch-sym]').length).toBeGreaterThan(0))
  await act(async () => { await sleep(50) })              // the mount's own frames come and go first
  holdFrames()
  clearSeen()
  return { ...view, picked }
}

describe('a small list (every row drawn)', () => {
  const SYMS = ['M2', 'M0', 'M3', 'M1', 'M4']
  beforeEach(() => { hoisted.prebuilt = [{ id: 'small', name: 'Small', items: mkItems(SYMS) }] })

  it('K1 K2 K3 K4: the highlight and the group symbol move in the press; the scroll waits for the frame', async () => {
    const { container, picked } = await mount('small', 'Small')
    let pickedInHandler = null
    await act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      pickedInHandler = [...picked]                     // K2: before React does anything with the press
    })
    expect(pickedInHandler).toEqual(['M2'])
    expect(selectedSyms(container)).toEqual(['M2'])      // K1: no frame has come
    expect(seen.intoView).toEqual([])                    // K3
    expect(seen.heightReads).toBe(0)
    await paint()
    expect(seen.intoView).toEqual([{ sym: 'M2', opts: { block: 'nearest', inline: 'nearest' } }])   // K4
  })

  it('K5: a held arrow (three presses before a frame) scrolls once, to the last row', async () => {
    const { container } = await mount('small', 'Small')
    await press(); await press(); await press()
    expect(selectedSyms(container)).toEqual(['M3'])
    expect(seen.intoView).toEqual([])
    await paint()
    expect(seen.intoView).toEqual([{ sym: 'M3', opts: { block: 'nearest', inline: 'nearest' } }])
    await paint()                                        // and nothing more on the frames after it
    await act(async () => { await sleep(300) })          // nor from the backstop timer
    expect(seen.intoView).toHaveLength(1)
    // the next press scrolls again, after its own frame: a held key never stops scrolling
    await press()
    await paint()
    expect(seen.intoView.map((c) => c.sym)).toEqual(['M3', 'M1'])
  })

  it('K6: a widget that goes away before the frame scrolls nothing, and leaves nothing waiting for one', async () => {
    const view = await mount('small', 'Small')
    await press()
    expect(waitingFrames()).toBeGreaterThan(0)           // the press left work for its frame (or this proves nothing)
    view.unmount()
    expect(waitingFrames()).toBe(0)                      // the unmount took it back
    await paint()
    await act(async () => { await sleep(300) })
    expect(seen.intoView).toEqual([])
  })

  it('K7: the arrows walk the rows in the order drawn (sorted by symbol), and wrap', async () => {
    const { container, picked } = await mount('small', 'Small')
    await act(async () => { container.querySelector('[data-col-key="sym"]').click() })
    const drawn = [...container.querySelectorAll('[data-watch-sym]')].map((el) => el.getAttribute('data-watch-sym'))
    expect(drawn).not.toEqual(SYMS)                      // the sort changed the order (or this proves nothing)
    for (let i = 0; i < drawn.length + 1; i++) await press()
    expect(picked).toEqual([...drawn, drawn[0]])
  })
})

describe('a virtualized list', () => {
  const SYMS = Array.from({ length: BIG }, (_, i) => `S${i}`)
  beforeEach(() => { hoisted.prebuilt = [{ id: 'big', name: 'Big', items: mkItems(SYMS) }] })

  it('K1 K2 K3 K4: nothing is centred or measured before the frame; after it, centred once and kept in view', async () => {
    const { container, picked } = await mount('big', 'Big')
    await press(); await paint(); clearSeen()            // on S0, its scroll done
    let pickedInHandler = null
    await act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      pickedInHandler = [...picked]
    })
    expect(pickedInHandler).toEqual(['S0', 'S1'])        // K2
    expect(selectedSyms(container)).toEqual(['S1'])      // K1
    expect(seen.scrollTo).toEqual([])                    // K3: the virtualizer has not scrolled ...
    expect(seen.heightReads).toBe(0)                     // ... nor read the scroller's height
    expect(seen.intoView).toEqual([])
    await paint()
    expect(seen.scrollTo).toHaveLength(1)                // K4: centred, once
    expect(Number.isFinite(seen.scrollTo[0].top)).toBe(true)
    expect(seen.intoView).toEqual([{ sym: 'S1', opts: { block: 'nearest', inline: 'nearest' } }])
  })

  it('K5: a held arrow centres once, on the last row', async () => {
    const { container } = await mount('big', 'Big')
    await press(); await paint(); clearSeen()            // on S0
    await press(); await press(); await press()
    expect(selectedSyms(container)).toEqual(['S3'])
    expect(seen.scrollTo).toEqual([])
    await paint()
    expect(seen.scrollTo).toHaveLength(1)
    expect(seen.intoView).toEqual([{ sym: 'S3', opts: { block: 'nearest', inline: 'nearest' } }])
  })

  it('K6: a widget that goes away before the frame centres nothing, and leaves nothing waiting for one', async () => {
    const view = await mount('big', 'Big')
    await press()
    expect(waitingFrames()).toBeGreaterThan(0)
    view.unmount()
    expect(waitingFrames()).toBe(0)
    await paint()
    await act(async () => { await sleep(300) })
    expect(seen.scrollTo).toEqual([])
    expect(seen.intoView).toEqual([])
  })
})
