// ⚡ (2026-11-27, the board switch) A REMOUNTED LIST STARTS FROM THE ROW SIZES IT MEASURED LAST TIME.
//
// MEASURED: on every board switch the watchlist's virtualizer measured each mounted row on mount
// (`measureElement` -> `offsetHeight` on ref attach, inside the commit) and read the scroller's box synchronously
// (`observeElementRect`) for a value our wrapper only hands over in the next frame anyway. Untraced CPU profiles
// (keepalive2-20261127, first click): `measureElement` 12-25 ms, the scroller read ~2 ms per click; the first read is
// a forced layout of the freshly committed board, and every row that measured != the 30 px estimate re-rendered the
// list after the commit.
//
// NOW: ScanRows keeps the sizes it measured per list (`sizeCacheKey`) and row key. A remount estimates each row at its
// remembered size (the first render is already placed right), and the attach-time measurement answers from that
// memory instead of reading layout; the ResizeObserver's border-box delivery (after layout, before paint) still
// measures every row, so a row whose height changed is corrected. The scroller's box is read in the frame it is
// delivered in. A list with no `sizeCacheKey` (and the first mount of any list) measures exactly as before.
//   R1 (red first) a remount reads no row's offsetHeight, and places the rows at their remembered sizes
//   R2 a row that changed height since is corrected by the observer's measurement
//   R3 (red first) the scroller's box is not read inside the commit; it is read in the frame
//   R4 no `sizeCacheKey`: the rows are measured on mount, as before
//   R5 both list call sites pass a key
import { render, act, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useRef, Profiler } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('../components/StockChart', () => ({ default: () => null }))
vi.mock('../components/chart/SymbolSearch', () => ({ default: () => null }))
vi.mock('../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../components/chart/pane/ChartPane', () => ({ default: () => null }))
vi.mock('../utils/prefetchBars', () => ({
  prefetchBars: () => {}, prefetchBarsToIDB: () => {}, prefetchAllTimeframes: () => {},
  prefetchBarOnIntent: () => {}, prefetchListAllTimeframes: () => {}, warmMemFromIDB: () => {},
  prewarmVisibleList: () => {},
}))
vi.mock('swr', () => ({ default: () => ({ data: [], mutate: () => {} }) }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'user', display_name: 'Pat' } }),
}))

import { ScanRows, rowSizeCacheKey, measureRememberedRow, ROW_SIZE_ROWS_MAX, ROW_SIZE_CORRECTIONS_MAX } from './Watchlists'

const ITEMS = Array.from({ length: 60 }, (_, i) => ({ id: `R${i}`, sym: `R${i}` }))
const ROW_PX = 40

// jsdom lays nothing out: rows are ROW_PX tall (or what `T.rowPx` says for one key), the scroller 300 x 400.
// Every read is counted, by kind, so "read inside the commit" is a number.
const T = { rowReads: 0, scrollerReads: 0, rowPx: {}, renders: {} }
const realH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
const realW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
const keyOf = (el) => ITEMS[Number(el.getAttribute('data-index'))]?.id
beforeEach(() => {
  T.rowReads = 0; T.scrollerReads = 0; T.rowPx = {}; T.renders = {}
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      if (this.hasAttribute('data-index')) { T.rowReads++; return T.rowPx[keyOf(this)] ?? ROW_PX }
      if (this.hasAttribute('data-scroller')) { T.scrollerReads++; return 400 }
      return 0
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() { if (this.hasAttribute('data-scroller')) { T.scrollerReads++; return 300 } return 0 },
  })
})
afterEach(() => {
  cleanup()
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realH)
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', realW)
  vi.unstubAllGlobals()
})

// The scroller is mounted BEFORE the list, as in the widget (the list body exists, then a list is opened or loaded):
// the virtualizer reads its scroll element in its layout effect, and a parent's ref is attached after a child's.
function List({ cacheKey, show = true, onCommit = null, items = ITEMS }) {
  const scrollRef = useRef(null)
  return (
    <Profiler id="list" onRender={onCommit || (() => {})}>
    <div ref={scrollRef} data-scroller="" data-scan-scroller="" style={{ height: 400, overflowY: 'auto' }}>
      {show ? (
        <ScanRows scrollRef={scrollRef} items={items} renderRow={(it) => { T.renders[it.sym] = (T.renders[it.sym] || 0) + 1; return <span>{it.sym}</span> }} emptyText="none"
          sizeCacheKey={cacheKey} />
      ) : null}
    </div>
    </Profiler>
  )
}
/** Mount the scroller, then the list in it. */
const mountList = (cacheKey) => {
  const view = render(<List cacheKey={cacheKey} show={false} />)
  view.rerender(<List cacheKey={cacheKey} />)
  return view
}
const rowTop = (container, i) => {
  const el = container.querySelector(`[data-index="${i}"]`)
  const m = el && /translateY\(([-\d.]+)px\)/.exec(el.style.transform)
  return m ? Number(m[1]) : null
}
const frames = (n = 3) => act(async () => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)) })

describe('ScanRows: a remounted list starts from the row sizes it measured', () => {
  it('R1 (red first) a remount reads no row offsetHeight, and the rows sit at their remembered sizes', async () => {
    const view = mountList('list:R1')
    await frames()
    expect(T.rowReads, 'the first mount measures (nothing is remembered yet)').toBeGreaterThan(0)
    expect(rowTop(view.container, 2)).toBe(2 * ROW_PX)
    view.rerender(<List cacheKey="list:R1" show={false} />) // the list unmounts (a board switch away)

    T.rowReads = 0
    // the remembered sizes are the estimates: the rows are placed right in the remount's FIRST commit with rows, before
    // any measurement could re-render the list (the first mount placed them at the 30 px estimate, then moved them)
    let firstPlaced = null
    const onCommit = () => { if (firstPlaced === null && rowTop(view.container, 2) !== null) firstPlaced = rowTop(view.container, 2) }
    view.rerender(<List cacheKey="list:R1" onCommit={onCommit} />)
    await frames()
    expect(firstPlaced, 'row 2 in the first commit that holds it').toBe(2 * ROW_PX)
    expect(rowTop(view.container, 2), 'the rows mounted').not.toBeNull()
    expect(T.rowReads, 'rows measured again on the remount').toBe(0)
    expect(rowTop(view.container, 2), 'placed at the remembered size').toBe(2 * ROW_PX)
    expect(rowTop(view.container, 5)).toBe(5 * ROW_PX)
  })

  it('R2 a row that changed height since is corrected by the observer measurement', async () => {
    // the virtualizer asks the scroller's own window for its observer (jsdom's window, not the test global)
    const win = document.defaultView
    const prevRO = win.ResizeObserver
    const observers = []
    win.ResizeObserver = class {
      constructor(cb) { this.cb = cb; this.els = new Set(); observers.push(this) }
      observe(el) { this.els.add(el) }
      unobserve(el) { this.els.delete(el) }
      disconnect() { this.els.clear() }
    }
    try {
      const again = mountList('list:R2')
      await frames()
      again.rerender(<List cacheKey="list:R2" show={false} />)
      again.rerender(<List cacheKey="list:R2" />)
      await frames()
      expect(rowTop(again.container, 2)).toBe(2 * ROW_PX)
      // row 1 grew (a note opened, a wrap): the observer delivers its border box, as the browser does after layout
      const row1 = again.container.querySelector('[data-index="1"]')
      const ro = observers.find((o) => o.els.has(row1))
      expect(ro, 'the row is observed').toBeTruthy()
      await act(async () => {
        ro.cb([{ target: row1, borderBoxSize: [{ blockSize: 70, inlineSize: 300 }] }], ro)
      })
      await frames()
      expect(rowTop(again.container, 2), 'the rows below moved by the change').toBe(ROW_PX + 70)
    } finally { win.ResizeObserver = prevRO }
  })

  it('R3 (red first) the scroller box is not read inside the commit, it is read in the frame', async () => {
    let queue = []
    vi.stubGlobal('requestAnimationFrame', (fn) => { queue.push(fn); return queue.length })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    mountList('list:R3')
    expect(T.scrollerReads, 'scroller box read inside the mount commit').toBe(0)
    await act(async () => { const due = queue; queue = []; for (const fn of due) fn(0) })
    expect(T.scrollerReads, 'read in the frame').toBeGreaterThan(0)
  })

  it('R4 no sizeCacheKey: the rows are measured on mount, as before', async () => {
    const view = mountList(undefined)
    await frames()
    expect(T.rowReads).toBeGreaterThan(0)
    view.rerender(<List cacheKey={undefined} show={false} />)
    T.rowReads = 0
    view.rerender(<List cacheKey={undefined} />)
    await frames()
    expect(T.rowReads, 'a list with no key measures its rows on every mount').toBeGreaterThan(0)
  })

  it('R5 both ScanRows call sites in Watchlists pass a sizeCacheKey', () => {
    const src = readFileSync(join(process.cwd(), 'src/pages/Watchlists.jsx'), 'utf8')
    const uses = src.split('<ScanRows').slice(1).map((s) => s.slice(0, s.indexOf('/>')))
    expect(uses.length).toBeGreaterThanOrEqual(2)
    for (const u of uses) expect(u).toMatch(/sizeCacheKey=\{/)
  })
})

// The virtualizer asks the scroller's own window for its observer (jsdom's window, not the test global).
function withRowObservers(fn) {
  const win = document.defaultView
  const prevRO = win.ResizeObserver
  const observers = []
  win.ResizeObserver = class {
    constructor(cb) { this.cb = cb; this.els = new Set(); observers.push(this) }
    observe(el) { this.els.add(el) }
    unobserve(el) { this.els.delete(el) }
    disconnect() { this.els.clear() }
  }
  const deliver = (container, index, blockSize) => {
    const row = container.querySelector(`[data-index="${index}"]`)
    const ro = observers.find((o) => o.els.has(row))
    if (!ro) throw new Error(`row ${index} is not observed`)
    ro.cb([{ target: row, borderBoxSize: [{ blockSize, inlineSize: 300 }] }], ro)
  }
  return Promise.resolve(fn(deliver)).finally(() => { win.ResizeObserver = prevRO })
}
const GEOM = { fontSize: 11, logoPx: 16, columns: ['flag', 'sym', 'chg'], touch: false, viewportW: 1400 }

describe('ScanRows: the remembered sizes are keyed by everything that sets a row height (review of #2907)', () => {
  it('R6 the key separates logos on/off, logo size, column sets, touch tier and viewport band; no id: no key', () => {
    const k = (over) => rowSizeCacheKey({ kind: 'wl', id: 'L1', ...GEOM, ...over })
    expect(k({})).not.toBe(k({ logoPx: 0 }))
    expect(k({})).not.toBe(k({ logoPx: 20 }))
    expect(k({})).not.toBe(k({ columns: ['flag', 'sym', 'chg', 'spark'] }))
    expect(k({})).not.toBe(k({ fontSize: 13 }))
    expect(k({})).not.toBe(k({ touch: true }))
    expect(k({})).not.toBe(k({ viewportW: 800 }))
    expect(k({}), 'same inputs, same key').toBe(k({ columns: ['flag', 'sym', 'chg'] }))
    for (const id of [null, undefined, '']) expect(rowSizeCacheKey({ kind: 'wl', id, ...GEOM })).toBeNull()
  })

  it("R7 scans are keyed by their host's stable id, never the display name: two hosts never share, a host with none is not remembered", () => {
    const scan = (id) => rowSizeCacheKey({ kind: 'scan', id, ...GEOM })
    expect(scan('breadth-drill')).not.toBe(scan('etf-holdings'))
    expect(scan(null)).toBeNull()
    const src = readFileSync(join(process.cwd(), 'src/pages/Watchlists.jsx'), 'utf8')
    const uses = src.split('<ScanRows').slice(1).map((s) => s.slice(0, s.indexOf('/>')))
    const keyed = uses.map((u) => /sizeCacheKey=\{rowSizeCacheKey\(\{ kind: '(\w+)', id: ([\w.]+)/.exec(u))
    expect(keyed.every(Boolean), 'every list keys through rowSizeCacheKey').toBe(true)
    expect(keyed.find((m) => m[1] === 'scan')[2]).toBe('colStorageKey')
    expect(keyed.find((m) => m[1] === 'wl')[2]).toBe('wl.id')
  })

  it('R8 two keys (logos on, logos off) keep separate memories: neither re-seeds the other', async () => {
    const on = mountList('list:R8|l16')
    await frames()
    on.unmount()
    T.rowPx = Object.fromEntries(ITEMS.map((it) => [it.id, 50])) // logos off: another row height
    const off = mountList('list:R8|l0')
    await frames()
    expect(rowTop(off.container, 2)).toBe(100)
    off.unmount()
    T.rowPx = {}
    T.rowReads = 0
    const again = mountList('list:R8|l16')
    await frames()
    expect(T.rowReads, 'remembered').toBe(0)
    expect(rowTop(again.container, 2), "its own sizes, not the other widget's").toBe(2 * ROW_PX)
  })

  it('R9 (red first) a remembered size the observer contradicts is committed before paint (inside the observer callback)', () =>
    withRowObservers(async (deliver) => {
      const view = mountList('list:R9')
      await frames()
      view.rerender(<List cacheKey="list:R9" show={false} />)
      view.rerender(<List cacheKey="list:R9" />)
      await frames()
      expect(rowTop(view.container, 2)).toBe(2 * ROW_PX)
      // NOT inside act: the callback, then its microtask (both before the frame paints), and no task in between
      deliver(view.container, 1, 70)
      await Promise.resolve()
      expect(rowTop(view.container, 2), 'rows still at the stale offsets when the frame paints').toBe(ROW_PX + 70)
      await act(async () => {})
    }))

  it(`R10 more than ${ROW_SIZE_CORRECTIONS_MAX} corrections in one mount drop the list's memory: the next mount measures`, () =>
    withRowObservers(async (deliver) => {
      const view = mountList('list:R10')
      await frames()
      view.rerender(<List cacheKey="list:R10" show={false} />)
      view.rerender(<List cacheKey="list:R10" />)
      await frames()
      for (let i = 0; i <= ROW_SIZE_CORRECTIONS_MAX; i++) await act(async () => { deliver(view.container, i, 60) })
      view.rerender(<List cacheKey="list:R10" show={false} />)
      T.rowReads = 0
      view.rerender(<List cacheKey="list:R10" />)
      await frames()
      expect(T.rowReads, 'a dropped memory measures on the next mount').toBeGreaterThan(0)
    }))

  it('R11 a row with no index is not remembered; one list remembers at most ROW_SIZE_ROWS_MAX rows', () => {
    const el = { offsetHeight: 33 }
    const mem = { sizes: new Map(), corrections: 0, dropped: false, correctedNow: false }
    const inst = (index) => ({ indexFromElement: () => index, options: { getItemKey: (i) => `K${i}` } })
    expect(measureRememberedRow(el, undefined, inst(-1), mem)).toBe(33)
    expect(mem.sizes.size, 'index -1 cached').toBe(0)
    for (let i = 0; i < ROW_SIZE_ROWS_MAX; i++) mem.sizes.set(`X${i}`, 30)
    measureRememberedRow(el, undefined, inst(7), mem)
    expect(mem.sizes.size).toBeLessThanOrEqual(ROW_SIZE_ROWS_MAX)
    expect(mem.sizes.get('K7')).toBe(33)
  })
})

// ⚡ FIRST FRAME CHANGES: rows appear one frame (or more) earlier. On a board switch the scroller and the list mount in
// ONE commit: the virtualizer finds no scroll element there and, with no box, renders no rows. A list that remembers
// its scroller's box renders the window's rows in that first commit. No frame runs in these two cases.
describe('ScanRows: a remembered list has its rows in the switch\'s first commit', () => {
  it('R12 (red first) warm: the scroller and the list mount together and the rows are there, placed, with no layout read', async () => {
    const first = mountList('list:R12')
    await frames() // the box is delivered (and remembered), the rows measured
    expect(rowTop(first.container, 2)).toBe(2 * ROW_PX)
    first.unmount()
    let queue = []
    vi.stubGlobal('requestAnimationFrame', (fn) => { queue.push(fn); return queue.length })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    T.rowReads = 0
    const again = render(<List cacheKey="list:R12" />) // one commit, as the board switch mounts it
    expect(again.container.querySelector('[data-index="0"]'), 'no rows in the first commit').not.toBeNull()
    expect(rowTop(again.container, 2)).toBe(2 * ROW_PX)
    expect(T.rowReads, 'rows measured in the commit').toBe(0)
    // the window: the remembered 400 px box holds 10 rows of 40 (plus the overscan)
    expect(again.container.querySelector('[data-index="9"]')).not.toBeNull()
    queue = []
  })

  it('R13 cold: a list with no memory mounts as before (no rows until the box arrives)', () => {
    const view = render(<List cacheKey="list:R13-never-seen" />)
    expect(view.container.querySelector('[data-index="0"]')).toBeNull()
    const nokey = render(<List cacheKey={undefined} />)
    expect(nokey.container.querySelector('[data-index="0"]')).toBeNull()
  })
})

// ⭐ Follow-ups (reviews of #2907 DELTA and #2913).
describe('ScanRows: corrections in one commit; a remembered offset; the warm first render bounded', () => {
  it('R15 (red first) D1: ten seeded rows wrong in ONE observer pass make exactly one commit, before paint, with every row placed', () =>
    withRowObservers(async (deliver) => {
      const view = mountList('list:R15')
      await frames()
      view.rerender(<List cacheKey="list:R15" show={false} />)
      let commits = 0
      const onCommit = () => { commits++ }
      view.rerender(<List cacheKey="list:R15" onCommit={onCommit} />)
      await frames()
      commits = 0
      // the browser hands every row of a pass to the observer in one callback; nothing (no task, no microtask) runs
      // between these ten deliveries either, so they are the same pass
      for (let i = 0; i < 10; i++) deliver(view.container, i, 42)
      await Promise.resolve()
      expect(commits, 'synchronous commits for one observer pass').toBe(1)
      for (let i = 0; i <= 10; i++) expect(rowTop(view.container, i), `row ${i} placed before paint`).toBe(i * 42)
      const placed = [...Array(11).keys()].map((i) => rowTop(view.container, i))
      await act(async () => {})
      await frames()
      expect([...Array(11).keys()].map((i) => rowTop(view.container, i)), 'a later render moved a row').toEqual(placed)
    }))

  it('R16 (red first) D2: a measurement the virtualizer already holds schedules nothing and leaves nothing set', () => {
    const el = {}
    const onCorrection = vi.fn()
    const mem = { sizes: new Map([['K1', 40]]), seeded: new Set(['K1']), corrections: 0, dropped: false, onCorrection }
    // the memory is stale (40); the virtualizer already holds the real 70
    const inst = { indexFromElement: () => 1, options: { getItemKey: () => 'K1' }, itemSizeCache: new Map([['K1', 70]]), measurementsCache: [] }
    expect(measureRememberedRow(el, { borderBoxSize: [{ blockSize: 70 }] }, inst, mem)).toBe(70)
    expect(onCorrection).not.toHaveBeenCalled()
    expect(mem.correctedNow, 'a flag left set would force a flushSync on the next scroll').not.toBe(true)
    // and a row seen once is not judged again: a later real resize takes the ordinary path
    expect(mem.seeded.has('K1')).toBe(false)
  })

  it('R14 a remembered box twice the real height adds rows, never moves one: no row changes place between the first and second commit', async () => {
    const first = mountList('list:R14')
    await frames()
    first.unmount()
    // the widget is now half as tall: the real box is 200, the remembered one 400
    const rowH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() { return this.hasAttribute('data-scroller') ? 200 : rowH.get.call(this) },
    })
    const view = render(<List cacheKey="list:R14" />)
    const firstCommit = {}
    view.container.querySelectorAll('[data-index]').forEach((el) => {
      const i = Number(el.getAttribute('data-index'))
      firstCommit[i] = rowTop(view.container, i)
    })
    expect(Object.keys(firstCommit).length).toBeGreaterThan(0)
    await frames()
    for (const [i, top] of Object.entries(firstCommit)) {
      expect(top, `row ${i} vs the cold placement`).toBe(Number(i) * ROW_PX)
      const now = rowTop(view.container, Number(i))
      if (now !== null) expect(now, `row ${i} moved`).toBe(top)
    }
  })

  it('R17 (red first) a list remembered scrolled starts at that offset in the first commit (no frame of its top rows)', async () => {
    // jsdom scrolls nothing: a scroll position that holds what is written, and a scrollTo that writes it
    const realScrollTo = HTMLElement.prototype.scrollTo
    const realTop = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', { configurable: true, get() { return this._top || 0 }, set(v) { this._top = v } })
    HTMLElement.prototype.scrollTo = function (opts) { this.scrollTop = typeof opts === 'object' ? (opts.top ?? this.scrollTop) : opts }
    try {
      const first = mountList('list:R17')
      await frames()
      const scroller = first.container.querySelector('[data-scroller]')
      await act(async () => { scroller.scrollTop = 800; scroller.dispatchEvent(new Event('scroll')) })
      await frames()
      first.unmount()
      vi.stubGlobal('requestAnimationFrame', () => 0)
      vi.stubGlobal('cancelAnimationFrame', () => {})
      // what the FIRST commit holds (the Profiler reports after its subtree's layout effects, before any later render)
      let atFirst = null
      const onCommit = () => {
        if (atFirst) return
        const sc = document.querySelector('[data-scroller]')
        atFirst = { top: sc.scrollTop, row20: !!sc.querySelector('[data-index="20"]'), row0: !!sc.querySelector('[data-index="0"]') }
      }
      render(<List cacheKey="list:R17" onCommit={onCommit} />) // one commit, as the switch mounts it
      expect(atFirst.row20, 'the remembered window (rows 20-29) in the first commit').toBe(true)
      expect(atFirst.row0, 'the top rows instead').toBe(false)
      expect(atFirst.top, 'the scroller restored in the same commit').toBe(800)
    } finally { HTMLElement.prototype.scrollTo = realScrollTo; delete HTMLElement.prototype.scrollTop; if (realTop) Object.defineProperty(Element.prototype, 'scrollTop', realTop) }
  })

  it("R18 (red first) M1: the warm first commit renders the window's rows only; the overscan follows after it", async () => {
    const first = mountList('list:R18')
    await frames()
    first.unmount()
    vi.stubGlobal('requestAnimationFrame', () => 0)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    let firstCount = null
    const view = render(<List cacheKey="list:R18" onCommit={() => { if (firstCount === null) firstCount = document.querySelectorAll('[data-index]').length }} />)
    // the 400 px box holds 10 rows of 40 px (11 when the edge row counts)
    expect(firstCount, 'rows in the first commit').toBeLessThanOrEqual(11)
    expect(firstCount).toBeGreaterThanOrEqual(10)
    await act(async () => {})
    expect(view.container.querySelectorAll('[data-index]').length, 'the overscan joined after the first commit').toBeGreaterThan(firstCount)
  })
})

// ⭐ (review of #2916, LOW) A list that comes back SHORTER than it was scrolled: the remembered offset is clamped to the
// last screenful of the rows it has now, so the first commit is never blank space past the end.
describe('ScanRows: the remembered offset fits the list it comes back to', () => {
  it('R19 (red first) half the rows: the first commit holds the last screenful, the scroller at its end', async () => {
    const realScrollTo = HTMLElement.prototype.scrollTo
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', { configurable: true, get() { return this._top || 0 }, set(v) { this._top = v } })
    HTMLElement.prototype.scrollTo = function (opts) { this.scrollTop = typeof opts === 'object' ? (opts.top ?? this.scrollTop) : opts }
    try {
      const firstMount = mountList('list:R19') // 60 rows of 40 px: 2,400 px, a 400 px box
      await frames()
      const scroller = firstMount.container.querySelector('[data-scroller]')
      // pass through the middle first, so every row of the first 30 has been measured (remembered at 40 px): the clamp
      // then has no 30 px estimates in it and the last screenful starts exactly at 800
      await act(async () => { scroller.scrollTop = 400; scroller.dispatchEvent(new Event('scroll')) })
      await frames()
      await act(async () => { scroller.scrollTop = 2000; scroller.dispatchEvent(new Event('scroll')) }) // the very end
      await frames()
      firstMount.unmount()
      vi.stubGlobal('requestAnimationFrame', () => 0)
      vi.stubGlobal('cancelAnimationFrame', () => {})
      const half = ITEMS.slice(0, 30) // it comes back with 30 rows: 1,200 px, so the last screenful starts at 800
      let atFirst = null
      const onCommit = () => {
        if (atFirst) return
        const sc = document.querySelector('[data-scroller]')
        atFirst = { top: sc.scrollTop, rows: [...sc.querySelectorAll('[data-index]')].map((el) => Number(el.getAttribute('data-index'))) }
      }
      render(<List cacheKey="list:R19" items={half} onCommit={onCommit} />)
      expect(atFirst.rows.length, 'blank space: no rows in the first commit').toBeGreaterThan(0)
      expect(Math.max(...atFirst.rows), 'the last row').toBe(29)
      // the last screenful (rows 20-29) is all there; the library's range also counts the row that ends on the edge (19)
      for (let i = 20; i <= 29; i++) expect(atFirst.rows, `row ${i} of the last screenful`).toContain(i)
      expect(atFirst.top, 'the scroller at the end of the shorter list').toBe(800)
    } finally { HTMLElement.prototype.scrollTo = realScrollTo; delete HTMLElement.prototype.scrollTop }
  })
})
