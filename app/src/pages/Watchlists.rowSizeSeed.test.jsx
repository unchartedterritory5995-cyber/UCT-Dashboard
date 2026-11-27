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
import { useRef } from 'react'
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

import { ScanRows } from './Watchlists'

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
function List({ cacheKey, show = true }) {
  const scrollRef = useRef(null)
  return (
    <div ref={scrollRef} data-scroller="" style={{ height: 400, overflowY: 'auto' }}>
      {show ? (
        <ScanRows scrollRef={scrollRef} items={ITEMS} renderRow={(it) => { T.renders[it.sym] = (T.renders[it.sym] || 0) + 1; return <span>{it.sym}</span> }} emptyText="none"
          sizeCacheKey={cacheKey} />
      ) : null}
    </div>
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

    const firstMountRenders = T.renders.R2
    T.rowReads = 0
    T.renders = {}
    view.rerender(<List cacheKey="list:R1" />)
    await frames()
    // the remembered sizes are the estimates: no row measures other than its estimate, so the list does not
    // re-render for a measurement (the first mount did: 30 px estimated, 40 px measured)
    expect(T.renders.R2, 'a row rendered again for a measurement on the remount').toBeLessThan(firstMountRenders)
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
