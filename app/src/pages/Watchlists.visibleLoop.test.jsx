// Watchlists — `quoteOverride`, the prop that lets a caller PIN quotes for rows
// whose numbers are not "now" (a historical breadth drill showing what stocks did
// on a recorded day).
//
// ⛔ THIS FILE EXISTS BECAUSE THE FEATURE SHIPPED DEAD. The `prices` memo has a
// fast path — `if (!hasFreshReadouts() && idxKeys.length === 0) return feedPrices`
// — that skips the whole merge when nothing augments the live feed. The override
// merge was written AFTER that line, so on the only path that normally runs (no
// chart readouts, no thematic-index rows) it never executed, and the breadth drill
// went to production with Price, Vol and % Chg blank on EVERY row. It was caught
// by opening the page, not by the suite.
//
// So the load-bearing condition here is `hasFreshReadouts: () => false` below:
// that is the state the bug lived in, and any fixture with readouts would pass
// while the product stayed broken.
import { render, screen, fireEvent } from '@testing-library/react'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'

vi.mock('../components/StockChart', () => ({ default: () => null }))
vi.mock('../components/chart/SymbolSearch', () => ({ default: () => null }))
vi.mock('../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../components/chart/pane/ChartPane', () => ({ default: () => null }))
vi.mock('../utils/prefetchBars', () => ({
  prefetchBars: () => {}, prefetchBarsToIDB: () => {}, prefetchAllTimeframes: () => {},
  prefetchBarOnIntent: () => {}, prefetchListAllTimeframes: () => {}, warmMemFromIDB: () => {},
  prewarmVisibleList: () => {},
}))
// ⭐ THE CONTROL: no readouts. This is the state that made the override dead.
vi.mock('../lib/chartReadoutStore', () => ({
  subscribeChartReadouts: () => () => {}, getChartReadout: () => null, hasFreshReadouts: () => false,
}))
vi.mock('swr', () => ({ default: () => ({ data: [], mutate: () => {} }) }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'user', display_name: 'Pat' } }),
}))
vi.mock('../hooks/useFlagged', () => ({
  useFlagged: () => ({
    flagged: [], toggle: () => {}, remove: () => {}, isFlagged: () => false,
    isShared: false, toggleShare: () => {}, flaggedName: 'Flagged', renameFlagged: () => {},
  }),
}))
vi.mock('../hooks/useTickerTags', () => ({
  default: () => ({
    tags: {}, setTag: () => {}, removeTag: () => {}, getTag: () => null,
    shared: [], isColorShared: () => false, toggleShareColor: () => {}, communityTags: [],
  }),
}))
vi.mock('../hooks/useWatchlistAlerts', () => ({
  default: () => ({ alerts: [], createAlert: () => {}, deleteAlert: () => {}, getAlertsForSym: () => [], hasAlert: () => false }),
}))
vi.mock('../hooks/useTagColors', () => ({ default: () => ({ tagColors: [], tagByKey: {}, setTagLabel: () => {} }) }))
vi.mock('../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: () => {}, loading: false }),
  parsePref: (raw, fallback) => fallback,
}))
// ⭐ THE OTHER HALF OF THE CONTROL: the live feed is EMPTY, exactly as it is on a
// closed market. Without the override there is nothing at all to render.
vi.mock('../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: {}, isLoading: false, isStreaming: false, staleSymbols: new Set() }),
}))
// A fixed window: rows 0..4 are "on screen". jsdom does no layout, so the real
// virtualizer would report nothing and this file would pass vacuously.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }) => ({
    getVirtualItems: () => Array.from({ length: Math.min(count, 5) }, (_, index) => ({
      index, key: index, start: index * 30, size: 30, end: (index + 1) * 30,
    })),
    getTotalSize: () => count * 30,
    scrollToIndex: () => {}, measureElement: () => {},
  }),
  observeElementRect: () => () => {},
}))

import { useRef, useState } from 'react'
import { ScanRows } from './Watchlists'

// React #185 on /breadth (8 browser reports, 2026-10-06..08): the breadth drill board's
// scan list reported its visible window on EVERY re-render of its rows, the receiver stored
// that window in state, and storing it re-derived the rows — a passive-effect loop that
// never settled. Under React 19.2 each of those commits counts toward the nested-update
// limit, so the NEXT update anywhere (typing in the board, a table cell's effect) threw
// "Maximum update depth exceeded". This harness is that receiver, reduced to its shape:
// it stores what it is handed, and every render re-derives `items` as a NEW array of the
// SAME rows (exactly what a live-price tick or a perf/sort identity change does).
function Receiver({ onReport }) {
  const scrollRef = useRef(null)
  const [, setVisible] = useState([])
  const calls = useRef(0)
  const items = ['AAPL', 'NVDA', 'MSFT', 'AMD', 'TSLA', 'META', 'AMZN'].map((sym) => ({ id: sym, sym }))
  const onVisibleChange = useRef((syms) => {
    calls.current += 1
    onReport(syms)
    // Cap: without the fix this would loop forever and hang the test instead of failing it.
    if (calls.current < 200) setVisible(syms)
  }).current
  return (
    <div ref={scrollRef}>
      <ScanRows scrollRef={scrollRef} items={items} renderRow={(it) => <span>{it.sym}</span>}
        emptyText="none" onVisibleChange={onVisibleChange} />
    </div>
  )
}

let errSpy
beforeEach(() => { errSpy = vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => { errSpy.mockRestore() })

test('an unchanged visible window is reported once, not on every re-render (#185 loop)', () => {
  const reports = []
  render(<Receiver onReport={(s) => reports.push(s.join(','))} />)
  expect(screen.getByText('AAPL')).toBeInTheDocument()   // control: rows really rendered
  expect(reports).toEqual(['AAPL,NVDA,MSFT,AMD,TSLA'])
  const depth = errSpy.mock.calls.map((c) => String(c[0])).filter((m) => /Maximum update depth/.test(m))
  expect(depth).toEqual([])
})

test('a CHANGED window is still reported', () => {
  const reports = []
  function Shifting() {
    const scrollRef = useRef(null)
    const [n, setN] = useState(7)
    const items = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].slice(7 - n).map((sym) => ({ id: sym, sym }))
    return (
      <div ref={scrollRef}>
        <button onClick={() => setN(5)}>shrink</button>
        <ScanRows scrollRef={scrollRef} items={items} renderRow={(it) => <span>{it.sym}</span>}
          emptyText="none" onVisibleChange={(s) => reports.push(s.join(','))} />
      </div>
    )
  }
  render(<Shifting />)
  fireEvent.click(screen.getByText('shrink'))
  expect(reports[0]).toBe('A,B,C,D,E')
  expect(reports[reports.length - 1]).toBe('C,D,E,F,G')
})
