/**
 * NEXT-ROW: AN ARROW KEY'S SCROLL RUNS IN THE NEXT ANIMATION FRAME CALLBACK, NOT IN THE KEY TASK (2026-11-23).
 *
 * Between a watchlist arrow key and the two linked charts' first frame, the list kept its selected row in view
 * INSIDE the commit: the virtualizer centred it (`scrollToIndex` reads the scroller's scrollHeight/clientHeight, a
 * forced layout, before the charts' DOM writes were done) and the row's `scrollIntoView` ran. For a move made by
 * the arrow keys, keeping the row in view now runs in the next animation frame callback
 * (utils/afterPaintSlot.js createNextFrameSlot): after every DOM write of the key task, before that frame's layout
 * and paint, so the scroll is painted in the SAME frame as the highlight (review of #2598, F1: no bar that jumps a
 * row and back on a held key). Every other selection (a list opened on a selection, a symbol set from elsewhere, a
 * search) scrolls in the commit exactly as before (F2).
 *   K1 the press moves the highlight at once: no frame is needed for it (small and virtualized lists)
 *   K2 the colour group's symbol is set inside the key handler itself (the paired charts follow in that task)
 *   K3 inside the key task and its commits nothing scrolls and nothing reads the scroller's height
 *   K4 the scroll runs INSIDE the next frame callback (no timer after it): a small list's row
 *      `scrollIntoView({ block: 'nearest' })`; a virtualized list's row is centred (scrollTo at THAT row's offset)
 *      and then the same `scrollIntoView`
 *   K5 a held arrow (three presses, no frame between) scrolls ONCE, in that frame, to the last row
 *   K6 a widget that goes away before the frame scrolls nothing, and leaves nothing waiting for one
 *   K7 the arrows walk the rows in the order they are drawn (a column sort), and wrap
 *   K8 a list opened on a selection scrolls in the commit, as before (no frame needed)
 *   K9 a symbol set from elsewhere (the colour group moved) scrolls in the commit, as before
 *   K10 the list changes between the press and the frame: the row is found again by its symbol, and nothing
 *       scrolls in the commit meanwhile
 *   K11 the row is gone when the frame comes: nothing scrolls, and when it is back the snap happens (it was not
 *       marked done) (F5)
 *   K12 under StrictMode a list opened on a selection still snaps (F4)
 *
 * Mutation proof (each run before calling these done): see the PR body.
 *
 * Harness: Watchlists.virtualized.test.jsx's (a prebuilt list through mocked SWR, a 600 px box for every element
 * so the virtualizer measures a viewport and every row is 600 px), spies on the two scroll calls and the
 * scrollHeight read, and animation frames the test runs by hand.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { ChartsSymContext } from './charts/ChartsSymContext'

const BIG = 400          // > VIRTUALIZE_MIN_ROWS
const ROW = 600          // every element's offsetHeight here, so every measured row
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
const NEAREST = { block: 'nearest', inline: 'nearest' }

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
/** The next frame's animation frame callbacks run, and NOTHING else (no timer, no sleep). */
const frame = () => act(() => { runFrames() })

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
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: ROW })
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

const listEl = (listId, name, ctx) => (
  <ChartsSymContext.Provider value={ctx}>
    <Watchlists embedded pickList={`community:${listId}`} pickName={name} />
  </ChartsSymContext.Provider>
)

/** Mounted, settled, frames held, recorders emptied. `picked` records the group symbol writes as they happen. */
async function mount(listId, name, { sym = null, strict = false, holdFirst = false } = {}) {
  const picked = []
  const ctx = { sym, setSym: (s) => { picked.push(s) } }
  if (holdFirst) holdFrames()
  const el = listEl(listId, name, ctx)
  const view = render(strict ? <React.StrictMode>{el}</React.StrictMode> : el)
  await waitFor(() => expect(view.container.querySelectorAll('[data-watch-sym]').length).toBeGreaterThan(0))
  await act(async () => { await sleep(50) })              // the mount's own frames (if not held) come and go first
  if (!holdFirst) { holdFrames(); clearSeen() }
  return { ...view, picked, ctx }
}

describe('a small list (every row drawn)', () => {
  const SYMS = ['M2', 'M0', 'M3', 'M1', 'M4']
  beforeEach(() => { hoisted.prebuilt = [{ id: 'small', name: 'Small', items: mkItems(SYMS) }] })

  it('K1 K2 K3 K4: the highlight and the group symbol move in the press; the scroll runs inside the next frame callback', async () => {
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
    await frame()                                        // K4: the frame callback itself, no timer
    expect(seen.intoView).toEqual([{ sym: 'M2', opts: NEAREST }])
  })

  it('K5: a held arrow (three presses before a frame) scrolls once, in that frame, to the last row', async () => {
    const { container } = await mount('small', 'Small')
    await press(); await press(); await press()
    expect(selectedSyms(container)).toEqual(['M3'])
    expect(seen.intoView).toEqual([])
    await frame()
    expect(seen.intoView).toEqual([{ sym: 'M3', opts: NEAREST }])
    await frame()                                        // nothing more on the next frame
    await act(async () => { await sleep(300) })          // nor from the backstop timer
    expect(seen.intoView).toHaveLength(1)
    await press()                                        // the next press scrolls in its own frame
    await frame()
    expect(seen.intoView.map((c) => c.sym)).toEqual(['M3', 'M1'])
  })

  it('K6: a widget that goes away before the frame scrolls nothing, and leaves nothing waiting for one', async () => {
    const view = await mount('small', 'Small')
    await press()
    expect(waitingFrames()).toBeGreaterThan(0)           // the press left work for its frame (or this proves nothing)
    view.unmount()
    expect(waitingFrames()).toBe(0)                      // the unmount took it back
    await frame()
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

  it('K8: a list opened on a selection scrolls in the commit, with no frame', async () => {
    await mount('small', 'Small', { sym: 'M3', holdFirst: true })
    expect(seen.intoView).toEqual([{ sym: 'M3', opts: NEAREST }])
  })

  it('K9: a symbol set from elsewhere scrolls in the commit, with no frame', async () => {
    const { rerender, ctx } = await mount('small', 'Small')
    await act(() => { rerender(listEl('small', 'Small', { ...ctx, sym: 'M4' })) })
    expect(seen.intoView).toEqual([{ sym: 'M4', opts: NEAREST }])
  })
})

describe('a virtualized list', () => {
  const SYMS = Array.from({ length: BIG }, (_, i) => `S${i}`)
  beforeEach(() => { hoisted.prebuilt = [{ id: 'big', name: 'Big', items: mkItems(SYMS) }] })

  it('K1 K2 K3 K4: nothing is centred or measured in the key task; in the frame callback, THAT row is centred once', async () => {
    const { container, picked } = await mount('big', 'Big')
    await press(); await frame(); clearSeen()            // on S0, its scroll done
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
    await frame()                                        // K4
    expect(seen.scrollTo).toEqual([{ top: 1 * ROW, behavior: 'auto' }])   // row 1, centred in a 600 px viewport
    expect(seen.intoView).toEqual([{ sym: 'S1', opts: NEAREST }])
  })

  it('K5: a held arrow centres once, in that frame, on the last row', async () => {
    const { container } = await mount('big', 'Big')
    await press(); await frame(); clearSeen()            // on S0
    await press(); await press(); await press()
    expect(selectedSyms(container)).toEqual(['S3'])
    expect(seen.scrollTo).toEqual([])
    await frame()
    expect(seen.scrollTo).toEqual([{ top: 3 * ROW, behavior: 'auto' }])
    expect(seen.intoView).toEqual([{ sym: 'S3', opts: NEAREST }])
  })

  it('K6: a widget that goes away before the frame centres nothing, and leaves nothing waiting for one', async () => {
    const view = await mount('big', 'Big')
    await press()
    expect(waitingFrames()).toBeGreaterThan(0)
    view.unmount()
    expect(waitingFrames()).toBe(0)
    await frame()
    await act(async () => { await sleep(300) })
    expect(seen.scrollTo).toEqual([])
    expect(seen.intoView).toEqual([])
  })

  it('K10: the list changes before the frame: nothing scrolls meanwhile, and the row is found again by its symbol', async () => {
    const { rerender, ctx } = await mount('big', 'Big')
    await press(); await frame(); clearSeen()            // on S0
    await press()                                        // S1 (row 1) asked for
    hoisted.prebuilt = [{ id: 'big', name: 'Big', items: mkItems(['X0', ...SYMS]) }]   // S1 is row 2 now
    await act(() => { rerender(listEl('big', 'Big', ctx)) })
    expect(seen.scrollTo).toEqual([])                    // the list change scrolled nothing in its commit
    await frame()
    expect(seen.scrollTo).toHaveLength(1)
    expect(seen.scrollTo[0].top).toBeGreaterThan(1 * ROW)   // not row 1's offset: the row was found where it is now
  })

  it('K11: the row is gone when the frame comes: nothing scrolls; when it is back, the snap happens', async () => {
    const { rerender, ctx } = await mount('big', 'Big')
    await press(); await frame(); clearSeen()            // on S0
    await press()                                        // S1 asked for
    hoisted.prebuilt = [{ id: 'big', name: 'Big', items: mkItems(SYMS.filter((s) => s !== 'S1')) }]
    await act(() => { rerender(listEl('big', 'Big', ctx)) })
    await frame()
    expect(seen.scrollTo).toEqual([])                    // no row to centre
    hoisted.prebuilt = [{ id: 'big', name: 'Big', items: mkItems(SYMS) }]
    await act(() => { rerender(listEl('big', 'Big', ctx)) })
    expect(seen.scrollTo).toEqual([{ top: 1 * ROW, behavior: 'auto' }])   // back: snapped (in its commit, as before)
  })

  it('K12: under StrictMode a list opened on a selection still snaps', async () => {
    await mount('big', 'Big', { sym: 'S50', strict: true, holdFirst: true })
    expect(seen.scrollTo.filter((c) => c.top > 0)).toHaveLength(1)
  })
})
