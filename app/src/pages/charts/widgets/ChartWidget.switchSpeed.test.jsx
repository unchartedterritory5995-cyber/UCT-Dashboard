// ── THE SWITCH-SPEED INSTRUMENT'S WIRING, AT THE WIDGET (2026-11-23) ──────────────────────────────────────────
//
// hooks/useSymbolHandoff.switchSpeed.test.jsx proves the instrument through the handoff. This proves the three
// things only the real widget can: (1) ChartWidget gives its handoff an identity and (2) provides the SAME identity
// to the chart under it (chart/paintLog PaintMemberContext), each widget its own, so two charts of one group on the
// SAME timeframe are still told apart; (3) the pane's search path says "typed" (ChartPane handleSearchedSymbol),
// though the event is a click. Real: ChartWidget, ChartPane, ChartIdentityRow, the handoff, the group, the paint
// record, the instrument. The chart itself is a stand-in that makes its paint record as StockChart does
// (components/StockChart.switchSpeed.test.jsx holds the real StockChart to that).
import { render, screen, act, fireEvent } from '@testing-library/react'
import { useMemo } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'

const memState = new Map()
vi.mock('../../../utils/barsMemCache', () => ({
  memPeek: (sym, tf) => memState.get(`${sym}_${tf}`) ?? null,
  memHas: (sym, tf) => memState.has(`${sym}_${tf}`),
  memPut: () => {},
}))
vi.mock('../../../utils/barsIDB', () => ({ idbGet: vi.fn(async () => undefined) }))
vi.mock('../../../utils/prefetchBars', () => ({
  prefetchBarsToIDB: () => {},
  prepareForDisplay: () => new Promise(() => {}),
  prepareDailyForDisplay: async () => 'current',
  prefetchReplayTimeframes: () => {},
}))
// The chart: it shows the symbol it is given and makes its paint record under the identity its host provides,
// in the layout effect of the commit that shows the symbol (as StockChart's updateChart does).
vi.mock('../../../components/StockChart', async () => {
  const { useContext, useLayoutEffect } = await import('react')
  const { PaintMemberContext, recordPaint } = await import('../../../components/chart/paintLog')
  return {
    default: ({ sym, tf }) => {
      const member = useContext(PaintMemberContext)
      useLayoutEffect(() => { recordPaint(sym, tf, 100, 'full', member) }, [sym, tf, member])
      return <span data-testid="chart-sym">{sym}</span>
    },
  }
})
vi.mock('./ChartDetailDock', () => ({ default: ({ children }) => <>{children}</> }))
// The search: its one commit (SymbolSearch.submit: Enter, or a result picked) is `onSymbolChange`; here a result is CLICKED.
vi.mock('../../../components/chart/SymbolSearch', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    default: forwardRef((p, ref) => {
      useImperativeHandle(ref, () => ({ openWith: () => {} }))
      return <button type="button" data-testid="search-pick" onClick={() => p.onSymbolChange?.('BBB')}>search</button>
    }),
  }
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
import { createGroupSymsStore } from '../groupSymsStore'
import { beginGroupSwitch, chartGroupKey, __resetHandoffGroupsForTests } from '../../../hooks/handoffGroups'
import { SWITCH_TRIGGER, SWITCH_COUNTERS, peekSwitchCounts, __resetSwitchSpeedForTests, __setSwitchClockForTests } from '../../../lib/switchSpeed'

const NOW = new Date('2026-09-16T15:55:00-04:00').getTime()
const T = Math.floor(new Date('2026-09-16T15:50:00-04:00').getTime() / 1000)
const CURRENT = () => [{ t: T - 300, c: 1 }, { t: T, c: 1 }]

let frames
let clock

/** Two chart widgets of colour group A, both on 5m, on a board whose setGroupSym is ChartsWorkspace's: the press goes
 *  to the group first (beginGroupSwitch), then the symbol is written to the board's store. */
function Board({ store }) {
  const value = useMemo(() => ({
    groupSymsStore: store,
    groupSyms: store.get(),
    setGroupSym: (c, s) => {
      if (store.get()[c] !== s) beginGroupSwitch(store, chartGroupKey(c), s)
      store.set((prev) => ({ ...prev, [c]: s }))
    },
    chartsTheme: 'default',
    crosshairBus: { emit: () => {}, subscribe: () => () => {} },
    aiSearchBus: { subscribe: () => () => {}, request: () => false },
    activeChartRef: { current: null },
  }), [store])
  return (
    <MemoryRouter>
      <WorkspaceContext.Provider value={value}>
        <ChartWidget color="A" opts={{ tf: '5' }} />
        <ChartWidget color="A" opts={{ tf: '5' }} />
      </WorkspaceContext.Provider>
    </MemoryRouter>
  )
}
const shown = () => screen.getAllByTestId('chart-sym').map((el) => el.textContent)
const settle = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

beforeEach(() => {
  memState.clear()
  for (const s of ['AAA', 'BBB']) memState.set(`${s}_5`, CURRENT())
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  vi.setSystemTime(NOW)
  __resetHandoffGroupsForTests()
  __resetSwitchSpeedForTests()
  frames = []
  clock = 0
  __setSwitchClockForTests(() => clock)
  vi.stubGlobal('requestAnimationFrame', (cb) => { frames.push(cb); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => {
  __resetSwitchSpeedForTests()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

test('a search result picked in one widget: ONE typed sample, after BOTH charts of the group have drawn', async () => {
  const store = createGroupSymsStore({ A: 'AAA', B: null, C: null, D: null })
  render(<Board store={store} />)
  await settle(200)
  expect(shown()).toEqual(['AAA', 'AAA'])
  frames.length = 0                                          // (whatever the mount asked a frame for is not this switch's)

  let t0 = null
  document.addEventListener('click', (e) => { t0 = e.timeStamp }, { capture: true, once: true })
  fireEvent.click(screen.getAllByTestId('search-pick')[0])
  await settle(400)                                          // past the panes' columns wait, whichever way it was shown
  expect(shown()).toEqual(['BBB', 'BBB'])
  expect(typeof t0).toBe('number')
  clock = t0 + 25
  act(() => { frames.splice(0).forEach((cb) => cb(clock)) })

  const got = peekSwitchCounts()
  expect(got, 'a sample was counted').not.toBeNull()
  expect(got.cells).toHaveLength(1)
  expect(SWITCH_TRIGGER[got.cells[0][2]]).toBe('typed')      // the pane said so; the event alone is a click
  expect(got.cells[0].slice(5)).toEqual([0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0])   // 25 ms -> 25-33, counted once
  expect(Object.fromEntries(SWITCH_COUNTERS.map((k, i) => [k, got.counters[i]]))).toMatchObject({ untracked: 0, unpressed: 0, superseded: 0 })
})
