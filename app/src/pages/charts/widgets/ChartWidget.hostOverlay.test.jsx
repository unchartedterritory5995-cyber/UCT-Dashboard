// The Chart widget's host hooks (chartHostOverlay.js, 2026-10-18): a host OUTSIDE /charts (the
// screener) may add price lines for the symbol on show and set its own scan pause. On /charts no
// host context is set, and the widget must behave exactly as before.
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
const seen = vi.hoisted(() => ({ lines: null }))
vi.mock('../../../components/StockChart', () => ({
  default: ({ sym, priceLines }) => { seen.lines = priceLines ?? null; return <span data-testid="chart-sym">{sym}</span> },
}))
vi.mock('./ChartDetailDock', () => ({
  default: ({ sym, children }) => (<><span data-testid="dock-sym">{sym}</span>{children}</>),
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
import { ChartHostOverlayContext } from './chartHostOverlay'

const NOW = new Date('2026-09-16T15:55:00-04:00').getTime()
const unix = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return Math.floor(new Date(`2026-09-16T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-04:00`).getTime() / 1000)
}
const CURRENT = () => { const t = unix('15:50'); return [{ t: t - 300, c: 1 }, { t, c: 1 }] }

let setGroup = null
function Wrap({ overlay = null }) {
  const [groupSyms, setGroupSyms] = useState({ A: 'AAA', B: null, C: null, D: null })
  setGroup = (s) => setGroupSyms(p => ({ ...p, A: s }))
  const value = {
    groupSyms,
    setGroupSym: (c, s) => setGroupSyms(p => ({ ...p, [c]: s })),
    chartsTheme: 'default',
    crosshairBus: { emit: () => {}, subscribe: () => () => {} },
    aiSearchBus: { subscribe: () => () => {}, request: () => false },
    activeChartRef: { current: null },
  }
  const chart = <ChartWidget color="A" opts={{ tf: '5' }} />
  return (
    <MemoryRouter>
      <WorkspaceContext.Provider value={value}>
        {overlay ? <ChartHostOverlayContext.Provider value={overlay}>{chart}</ChartHostOverlayContext.Provider> : chart}
      </WorkspaceContext.Provider>
    </MemoryRouter>
  )
}
const shown = () => screen.getByTestId('chart-sym').textContent
const tick = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const LINES = [{ price: 988, color: '#dcbb5e', title: 'Flat base pivot' }]

beforeEach(() => {
  memState.clear(); memState.set('AAA_5', CURRENT()); memState.set('BBB_5', CURRENT())
  prefetchMock.mockClear(); prepareMock.mockReset(); prepareMock.mockImplementation(() => new Promise(() => {}))
  seen.lines = null
  vi.useFakeTimers(); vi.setSystemTime(NOW)
})
afterEach(() => { vi.useRealTimers() })

test('/charts (no host): no extra price lines, and the 90 ms scan pause still holds', async () => {
  render(<Wrap />)
  expect(seen.lines).toBeNull()
  act(() => { setGroup('BBB') })
  await tick(50)
  expect(shown()).toBe('AAA')
  await tick(100)
  expect(shown()).toBe('BBB')
})

test("a host's price lines reach the chart for the symbol on show only", async () => {
  const overlay = { priceLinesFor: (s) => (s === 'AAA' ? LINES : null) }
  render(<Wrap overlay={overlay} />)
  expect(seen.lines).toEqual(LINES)
  act(() => { setGroup('BBB') })
  await tick(200)
  expect(shown()).toBe('BBB')
  expect(seen.lines).toBeNull()
})

test('a host with no scan pause switches at once', async () => {
  render(<Wrap overlay={{ symbolDebounceMs: 0 }} />)
  act(() => { setGroup('BBB') })
  await tick(0)
  expect(shown()).toBe('BBB')
})
