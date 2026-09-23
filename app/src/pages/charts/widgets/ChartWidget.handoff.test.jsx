// ── Identity coherence across a symbol switch, at the WIDGET boundary ───────
//
// The hook rails (hooks/useSymbolHandoff.test.jsx) prove the lag logic. These
// prove the thing the member actually experiences: that the SYMBOL THE WHOLE
// WIDGET IS SHOWING moves as one piece. ChartPane, the detail dock, the
// leverage/holdings controls and the capture read-out all read `sym`, and half
// of them live outside StockChart's tree — so a lag applied inside the chart
// would have fixed the candles and left the header on B. That mixed state
// ("B header + A candles") is the exact thing the contract forbids, and only a
// widget-level test can see it.

import { render, screen, act } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'

// The cache the handoff consults. Driven per-test so a symbol can be made
// current, hours-stale, or absent.
const memState = new Map()
vi.mock('../../../utils/barsMemCache', () => ({
  memPeek: (sym, tf) => memState.get(`${sym}_${tf}`) ?? null,
  memHas: (sym, tf) => memState.has(`${sym}_${tf}`),
  memPut: () => {},
}))
vi.mock('../../../utils/barsIDB', () => ({ idbGet: vi.fn(async () => undefined) }))
const prefetchMock = vi.fn()
// `prepareForDisplay` resolves with the OUTCOME; tests drive it per case so a
// degraded commit ('nodata'/'error') can be told apart from a successful one.
const prepareMock = vi.fn(async () => new Promise(() => {}))   // pending by default
vi.mock('../../../utils/prefetchBars', () => ({
  prefetchBarsToIDB: (...a) => prefetchMock(...a),
  prepareForDisplay: (...a) => prepareMock(...a),
  prefetchReplayTimeframes: () => {},
}))

// Every identity-bearing child reports the symbol IT was given, so a mixed
// state is directly observable rather than inferred.
vi.mock('../../../components/StockChart', () => ({
  default: ({ sym }) => <span data-testid="chart-sym">{sym}</span>,
}))
vi.mock('./ChartDetailDock', () => ({
  default: ({ sym, children }) => (<><span data-testid="dock-sym">{sym}</span>{children}</>),
  ChartEarningsButton: () => null,
  ChartPanelsButton: () => null,
}))
vi.mock('../../../components/chart/SymbolSearch', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return { default: forwardRef((_p, ref) => { useImperativeHandle(ref, () => ({ openWith: () => {} })); return <span>search</span> }) }
})
vi.mock('../../../components/community/ShareToFloor', () => ({ default: () => <span>share</span> }))
vi.mock('../../../components/chart/ChartSettingsModal', () => ({ default: () => null }))
vi.mock('./ChartMarketClock', () => ({ default: () => <span>clock</span> }))
vi.mock('./ChartDayGain', () => ({ default: () => <span>gain</span> }))
vi.mock('./AiSearchWidget', () => ({ default: () => null }))
vi.mock('./TimeframeMenu', () => ({ default: () => null }))
vi.mock('../../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: () => {} }) }))
vi.mock('../../../hooks/useWatchlistAlerts', () => ({ default: () => ({ alerts: [], createAlert: () => {}, deleteAlert: () => {} }) }))
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({ default: () => ({ data: null, isLoading: false }) }))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {}, loading: false }) }))
vi.mock('../../../hooks/useThemeIndexBars', () => ({ default: () => ({ isIndex: false, bars: null, name: null, sector: null, loading: false }) }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => null }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: false, isPremarket: false, isExtended: false }) }))

import ChartWidget from './ChartWidget'

const NOW = new Date('2026-09-16T15:55:00-04:00').getTime()
const unix = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return Math.floor(new Date(`2026-09-16T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-04:00`).getTime() / 1000)
}
const series = (t) => [{ t: t - 300, c: 1 }, { t, c: 1 }]
const CURRENT = () => series(unix('15:50'))
const STALE = () => series(unix('10:00'))

let setGroup = null
function Wrap({ initial = 'AAA', tf = '5' }) {
  const [groupSyms, setGroupSyms] = useState({ A: initial, B: null, C: null, D: null })
  setGroup = (s) => setGroupSyms(p => ({ ...p, A: s }))
  const value = {
    groupSyms,
    setGroupSym: (c, s) => setGroupSyms(p => ({ ...p, [c]: s })),
    chartsTheme: 'default',
    crosshairBus: { emit: () => {}, subscribe: () => () => {} },
    aiSearchBus: { subscribe: () => () => {}, request: () => false },
    activeChartRef: { current: null },
  }
  return (
    <MemoryRouter>
      <WorkspaceContext.Provider value={value}>
        <ChartWidget color="A" opts={{ tf }} />
      </WorkspaceContext.Provider>
    </MemoryRouter>
  )
}

/** Every identity surface must agree — that agreement IS the contract. */
const identity = () => {
  const chart = screen.getByTestId('chart-sym').textContent
  const dock = screen.getByTestId('dock-sym').textContent
  expect(dock).toBe(chart)      // mixed identity is the failure mode
  return chart
}

// ChartWidget debounces the group symbol by 90ms before it even becomes a
// request; step past that, then let the handoff settle.
const settle = async (ms = 200) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

beforeEach(() => {
  memState.clear(); prefetchMock.mockClear()
  prepareMock.mockReset(); prepareMock.mockImplementation(() => new Promise(() => {}))
  vi.useFakeTimers(); vi.setSystemTime(NOW)
})
afterEach(() => { vi.useRealTimers() })

test('a WARM current symbol commits, and every surface moves together', async () => {
  memState.set('AAA_5', CURRENT())
  memState.set('BBB_5', CURRENT())
  render(<Wrap initial="AAA" />)
  expect(identity()).toBe('AAA')
  act(() => { setGroup('BBB') })
  await settle()
  expect(identity()).toBe('BBB')
})

test('⛔ an HOURS-BEHIND B never appears: A stays whole, complete, and labelled A', async () => {
  memState.set('AAA_5', CURRENT())
  memState.set('BBB_5', STALE())
  render(<Wrap initial="AAA" />)
  act(() => { setGroup('BBB') })
  await settle(150)
  // Not "B with stale candles", not "B with a blank canvas" — still A, entirely.
  expect(identity()).toBe('AAA')
  expect(prefetchMock).toHaveBeenCalled()   // …and the repair was kicked
})

test('…then commits to B as one piece once the repair lands', async () => {
  memState.set('AAA_5', CURRENT())
  memState.set('BBB_5', STALE())
  render(<Wrap initial="AAA" />)
  act(() => { setGroup('BBB') })
  await settle(150)
  expect(identity()).toBe('AAA')
  memState.set('BBB_5', CURRENT())          // the ±6 warmer repairs it first
  await settle(100)
  expect(identity()).toBe('BBB')
})

test('⛔⛔ rapid A→B→C: B must never appear once C has been requested', async () => {
  memState.set('AAA_5', CURRENT())
  memState.set('BBB_5', STALE())
  memState.set('CCC_5', STALE())
  render(<Wrap initial="AAA" />)
  act(() => { setGroup('BBB') })
  await settle(150)
  act(() => { setGroup('CCC') })
  await settle(150)
  memState.set('BBB_5', CURRENT())          // B's data arrives LATE
  await settle(150)
  expect(identity()).not.toBe('BBB')        // a wrong-symbol frame would be BBB
  memState.set('CCC_5', CURRENT())
  await settle(150)
  expect(identity()).toBe('CCC')
})

test('a DEAD ticker commits on its NO-DATA outcome, not on a stopwatch', async () => {
  memState.set('AAA_5', CURRENT())
  prepareMock.mockResolvedValue('nodata')
  render(<Wrap initial="AAA" />)
  act(() => { setGroup('ZZZ') })
  await settle(200)
  // Committed because the prepare ANSWERED ("no data"), not because a timer
  // expired. The chart then shows its own no-data state — an honest degraded
  // handoff, which the harness must count separately from a successful one.
  expect(identity()).toBe('ZZZ')
})

test('DAILY is not held back by the intraday frontier maths', async () => {
  render(<Wrap initial="AAA" tf="D" />)
  act(() => { setGroup('BBB') })
  await settle()
  expect(identity()).toBe('BBB')
})
