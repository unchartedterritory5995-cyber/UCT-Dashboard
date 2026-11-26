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
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { useRef } from 'react'

const V = vi.hoisted(() => ({ calls: [], offset: 0, height: 300, size: 30, n: 100 }))

vi.mock('@tanstack/react-virtual', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    useVirtualizer: (opts) => {
      const n = opts.count
      const rows = Array.from({ length: n }, (_, i) => ({ index: i, key: i, start: i * V.size, end: (i + 1) * V.size, size: V.size, lane: 0 }))
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
function List({ sym, noScroll = null }) {
  const scrollRef = useRef(null)
  const noScrollRef = useRef(noScroll)
  noScrollRef.current = noScroll
  return (
    <div ref={scrollRef} style={{ height: 300, overflowY: 'auto' }}>
      <ScanRows scrollRef={scrollRef} items={ITEMS} renderRow={(it) => <span>{it.sym}</span>} emptyText="none"
        scrollToSym={sym} noScrollRef={noScrollRef} />
    </div>
  )
}
/** The list at rest on `first`'s window (rows 0..9 in view: offset 0, 300 px, 30 px rows), then the selection moves. */
function press(from, to, { offset = 0, height = 300 } = {}) {
  V.offset = offset
  V.height = height
  const view = render(<List sym={from} />)
  V.calls.length = 0
  view.rerender(<List sym={to} />)
  return view
}

beforeEach(() => { V.calls.length = 0; V.offset = 0; V.height = 300 })

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

  it('R6 a click selection never moves the list', () => {
    V.offset = 0
    const view = render(<List sym="S5" />)
    V.calls.length = 0
    view.rerender(<List sym="S60" noScroll="S60" />)
    expect(V.calls).toEqual([])
  })
})
