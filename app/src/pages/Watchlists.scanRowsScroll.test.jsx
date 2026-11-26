// ⭐ (2026-11-26, owner: "jumpy") THE LIST KEEPS THE SELECTED ROW IN VIEW WITH THE LEAST SCROLL. ScanRows re-centred the
// list on EVERY selection change (`scrollToIndex(idx, { align: 'center' })`), so each arrow press moved the whole list
// under the member's eye, and paid the virtualizer's measure and scroll in the key task. Now, TradingView-like:
//   R1 (red first) a press to a row already in view does not scroll
//   R2 (red first) the edge press (the row just past the bottom or top) scrolls the least: `align: 'auto'`, one row
//   R3 a selection landing far off-screen (a typed ticker, a jump) is centred, once
//   R4 nothing measured yet (a list opening on a symbol) centres, as before
//   R5 a row in view in part scrolls the least; R6 a click selection never moves the list
// The virtualizer is a stand-in here (jsdom does no layout): its window is set per case, and every `scrollToIndex` it
// is asked for is recorded. That the browser then scrolls by one row is the library's `align: 'auto'` contract.
import { render } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useRef } from 'react'

const V = vi.hoisted(() => ({ calls: [], opts: [], offset: 0, live: null, height: 300, size: 30, n: 100 }))

vi.mock('@tanstack/react-virtual', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    useVirtualizer: (opts) => {
      V.opts.push(opts)
      const n = opts.count
      const m0 = opts.scrollMargin || 0
      const rows = Array.from({ length: n }, (_, i) => ({ index: i, key: i, start: m0 + i * V.size, end: m0 + (i + 1) * V.size, size: V.size, lane: 0 }))
      return {
        scrollOffset: V.offset,
        scrollRect: V.height == null ? null : { width: 200, height: V.height },
        measurementsCache: V.height == null ? [] : rows,
        getVirtualItems: () => rows.slice(0, Math.min(n, 20)),
        getTotalSize: () => n * V.size,
        measureElement: () => {},
        scrollToIndex: (index, o) => { V.calls.push({ index, align: o && o.align }) },
      }
    },
  }
})
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

const ITEMS = Array.from({ length: 100 }, (_, i) => ({ id: `S${i}`, sym: `S${i}` }))
/** The scroller's LIVE scrollTop is `V.live` (else the virtualizer's `V.offset`); with `head`, a sticky 32 px column
 *  header is the scroller's first child (the watchlist's `.gridHead`), and boxes are laid out as a browser would. */
function List({ sym, noScroll = null, head = false, measureOffset = false }) {
  const scrollRef = useRef(null)
  const noScrollRef = useRef(noScroll)
  noScrollRef.current = noScroll
  const scroller = (el) => {
    scrollRef.current = el
    if (el) Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => (V.live ?? V.offset) })
  }
  return (
    <div ref={scroller} data-scroller="" style={{ height: 300, overflowY: 'auto' }}>
      {head ? <div data-sticky-head="" style={{ position: 'sticky', top: 0, minHeight: 32 }}>Symbol</div> : null}
      <ScanRows scrollRef={scrollRef} items={ITEMS} renderRow={(it) => <span>{it.sym}</span>} emptyText="none"
        scrollToSym={sym} noScrollRef={noScrollRef} measureOffset={measureOffset} />
    </div>
  )
}
const realRect = HTMLElement.prototype.getBoundingClientRect
const box = (top, height) => ({ top, height, bottom: top + height, left: 0, right: 200, width: 200, x: 0, y: top, toJSON() {} })
/** Boxes as a browser lays them out: the scroller at 0 (300 tall), its sticky header 32 tall, the rows' host below it. */
function layOut() {
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.hasAttribute('data-scroller')) return box(0, 300)
    if (this.hasAttribute('data-sticky-head')) return box(0, 32)
    if (this.parentElement && this.parentElement.hasAttribute('data-scroller')) return box(32 - (V.live ?? V.offset), 3000)
    return realRect.call(this)
  }
}
/** The list at rest on `first`'s window (rows 0..9 in view: offset 0, 300 px, 30 px rows), then the selection moves. */
function press(from, to, { offset = 0, height = 300, live = null, head = false, measureOffset = false } = {}) {
  V.offset = offset
  V.live = live
  V.height = height
  const view = render(<List sym={from} head={head} measureOffset={measureOffset} />)
  V.calls.length = 0
  view.rerender(<List sym={to} head={head} measureOffset={measureOffset} />)
  return view
}

beforeEach(() => { V.calls.length = 0; V.opts.length = 0; V.offset = 0; V.live = null; V.height = 300 })
afterEach(() => { HTMLElement.prototype.getBoundingClientRect = realRect })

describe('ScanRows: the selected row kept in view with the least scroll', () => {
  it('R1 (red first) an arrow press to a row already in view does not scroll', () => {
    press('S4', 'S5')
    expect(V.calls, 'the list moved for a row already in view').toEqual([])
    press('S9', 'S8')
    expect(V.calls).toEqual([])
  })

  it('R2 (red first) the edge press scrolls the least: the row just below the view, and the row just above it', () => {
    press('S9', 'S10')
    expect(V.calls).toEqual([{ index: 10, align: 'auto' }])
    press('S11', 'S10', { offset: 330 })                       // rows 11..20 in view: S10 is the row just above
    expect(V.calls).toEqual([{ index: 10, align: 'auto' }])
  })

  it('R3 a selection landing far off-screen is centred, once', () => {
    const view = press('S5', 'S60')
    expect(V.calls).toEqual([{ index: 60, align: 'center' }])
    view.rerender(<List sym="S60" />)
    expect(V.calls, 'centred again on a re-render').toHaveLength(1)
  })

  it('R4 nothing measured yet (a list opening on a symbol) centres, as before', () => {
    V.height = null
    render(<List sym="S5" />)
    expect(V.calls).toEqual([{ index: 5, align: 'center' }])
  })

  it('R5 a row in view in part (cut by the bottom edge) scrolls the least', () => {
    press('S5', 'S10', { offset: 15 })                         // 15..315: S10 (300..330) is cut
    expect(V.calls).toEqual([{ index: 10, align: 'auto' }])
  })

  // (review of #2834) THE STICKY COLUMN HEADER covers the scroller's top 32 px: a row under it is not in view
  it('R7 (red first) the watchlist path, TOP edge: a row under the sticky header is not in view; the scroll keeps rows clear of it', () => {
    layOut()
    // rows sit at 32 + 30 i (the header above them, measured): at scrollTop 300 the clear view is 332..600
    press('S10', 'S9', { offset: 300, head: true, measureOffset: true })
    expect(V.calls, 'the selected row was left under the header').toEqual([{ index: 9, align: 'auto' }])
    expect(V.opts.at(-1).scrollPaddingStart, 'align auto must keep rows below the header').toBe(32)
    expect(V.opts.at(-1).scrollMargin).toBe(32)
  })

  it('R8 (red first) the scan path (no measureOffset), BOTTOM edge: its rows start below the header, so the cut row scrolls', () => {
    layOut()
    // the scan's rows start at 32 (below the header): at scrollTop 0 the clear view is 32..300, and S8 (272..302) is cut
    press('S7', 'S8', { offset: 0, head: true })
    expect(V.calls, 'the selected row was left cut off at the bottom').toEqual([{ index: 8, align: 'auto' }])
    expect(V.opts.at(-1).scrollMargin, 'the scan path measured where its rows start').toBe(32)
  })

  it('R9 a fast repeat reads the LIVE scroll position: a near row is never read as far (and centred) while the virtualizer lags', () => {
    // the scroller is at 30 (the last press scrolled one row); the virtualizer's own offset has not caught up (0)
    press('S10', 'S11', { offset: 0, live: 30 })
    expect(V.calls).toEqual([{ index: 11, align: 'auto' }])
  })

  it('R6 a click selection never moves the list', () => {
    V.offset = 0
    const view = render(<List sym="S5" />)
    V.calls.length = 0
    view.rerender(<List sym="S60" noScroll="S60" />)
    expect(V.calls).toEqual([])
  })
})
