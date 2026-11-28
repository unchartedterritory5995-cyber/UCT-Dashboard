// ⭐ (lane C, zero-network PR 1.5, goal A4) THE CHART'S OWN TIMEFRAME DWELL. A chart that rests TF_DWELL_MS on a symbol
// and timeframe warms every OTHER timeframe on its bar (a custom code as its native base: 4h / 2h -> 60, 45m -> 15), the
// member's habitual next timeframes first; never before the page's first chart paint, never in replay; a press on the
// bar records the habit. On the REAL ChartWidget + ChartPane; StockChart is a stub.
// (P2) after the dwell the two habitual timeframes' INTRADAY keys are KEPT (store.keepKey: pinned, no stream) and
// lake-seeded (not awaited); released on the next press and when the page hides; never at a date or in replay.
import { render, cleanup, act } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi, test, expect, beforeEach, afterEach } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'
import { WidgetDoorContext } from '../widgetDoors'

const captured = vi.hoisted(() => ({ props: null, warms: [], paintCbs: [], painted: false, keeps: [], seeds: [] }))
vi.mock('../../../components/chart/barStoreSwitch', async (orig) => ({ ...(await orig()), BARSTORE: true }))
vi.mock('../../../data/barStore/index', async (orig) => {
  const m = await orig()
  const keepKey = (key) => { const w = { key, released: false }; captured.keeps.push(w); return () => { w.released = true } }
  const lakeSeed = (key, o) => { captured.seeds.push({ key, o }); return Promise.resolve(false) }
  // the real store, its keepKey / lakeSeed observed (the replay path reads the store too)
  return { ...m, getBarStore: () => new Proxy(m.getBarStore(), { get: (t, k) => (k === 'keepKey' ? keepKey : k === 'lakeSeed' ? lakeSeed : (typeof t[k] === 'function' ? t[k].bind(t) : t[k])) }) }
})
vi.mock('../../../components/StockChart', () => ({
  default: (props) => { captured.props = props; return <span data-testid="chart-sym">{props.sym}</span> },
}))
vi.mock('../../../components/chart/SymbolSearch', () => ({ default: () => <span>search</span> }))
vi.mock('../../../components/community/ShareToFloor', () => ({ default: () => <span>share</span> }))
vi.mock('../../../components/chart/ChartSettingsModal', () => ({ default: () => null }))
vi.mock('./ChartMarketClock', () => ({ default: () => <span>clock</span> }))
vi.mock('./ChartDayGain', () => ({ default: () => <span>gain</span> }))
vi.mock('./AiSearchWidget', () => ({ default: () => null }))
vi.mock('./TimeframeMenu', () => ({ default: () => null }))
vi.mock('../../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: () => {} }) }))
vi.mock('../../../hooks/useWatchlistAlerts', () => ({ default: () => ({ alerts: [], createAlert: () => {}, deleteAlert: () => {} }) }))
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({ default: () => ({ data: null, isLoading: false }) }))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {}, setPrefMerged: () => {}, loading: false }), parsePref: (_r, f) => f }))
vi.mock('../../../hooks/useThemeIndexBars', () => ({ default: () => ({ isIndex: false, bars: null, name: null, sector: null, loading: false }) }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => null, prefetchTickerMeta: () => {} }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: false, isPremarket: false, isExtended: false }) }))
vi.mock('../../../utils/barsWarm', async (orig) => ({
  ...(await orig()),
  prefetchAllTimeframes: (sym, o) => { captured.warms.push({ sym, tfs: o && o.tfs, edge: o && o.edge, signal: o && o.signal }) },
}))
vi.mock('../../../lib/firstChartPaint', async (orig) => ({
  ...(await orig()),
  whenFirstChartPainted: (fn) => { if (captured.painted) fn(); else captured.paintCbs.push(fn); return () => {} },
}))

import ChartWidget, { TF_DWELL_MS } from './ChartWidget'
import { __resetTfHabitForTests, habitualTfs } from '../../../components/chart/tfHabit'

const BAR = ['1', '5', '15', '45', '60', '240', 'D', 'W']
const ctl = { setOpts: null }
function Wrap({ initialOpts, replayCutoff = null }) {
  const [opts, setOpts] = useState(initialOpts)
  useEffect(() => { ctl.setOpts = setOpts }, [])
  const value = {
    groupSyms: { A: 'NVDA', B: null, C: null, D: null }, setGroupSym: () => {}, chartsTheme: 'default', replayCutoff,
    crosshairBus: { emit: () => {}, subscribe: () => () => {} }, aiSearchBus: { subscribe: () => () => {}, request: () => false },
    activeChartRef: { current: null }, chartApiById: { current: new Map() },
  }
  return (
    <MemoryRouter initialEntries={['/charts']}>
      <WorkspaceContext.Provider value={value}>
        <WidgetDoorContext.Provider value="w1">
          <ChartWidget color="A" chartId="w1" opts={opts} onOptsChange={(o) => setOpts(o)} />
        </WidgetDoorContext.Provider>
      </WorkspaceContext.Provider>
    </MemoryRouter>
  )
}
const optsFor = (tf) => ({ tf, settings: { header: { timeframes: BAR } } })

beforeEach(() => {
  vi.useFakeTimers()
  __resetTfHabitForTests()
  captured.warms.length = 0; captured.paintCbs.length = 0; captured.painted = true; captured.props = null; captured.keeps.length = 0; captured.seeds.length = 0
})
afterEach(() => { cleanup(); vi.useRealTimers() })

test('after the dwell: every other timeframe on the bar, as native bases, the habitual ones first, the current base left out', () => {
  render(<Wrap initialOpts={optsFor('D')} />)
  expect(captured.warms).toHaveLength(0)
  act(() => { vi.advanceTimersByTime(TF_DWELL_MS - 5) })
  expect(captured.warms).toHaveLength(0)           // not before the dwell
  act(() => { vi.advanceTimersByTime(10) })
  expect(captured.warms).toHaveLength(1)
  const { sym, tfs } = captured.warms[0]
  expect(sym).toBe('NVDA')
  // no history: D's bar neighbours first (W, then 4h -> its base 60), then the rest; 45m -> 15; D itself left out
  expect(tfs.slice(0, 2)).toEqual(['W', '60'])
  expect([...tfs].sort()).toEqual(['1', '15', '5', '60', 'W'].sort())
})

test('(review of #2996, F1) device + edge only (edge: true), and leaving the symbol aborts the dwell signal', () => {
  render(<Wrap initialOpts={optsFor('D')} />)
  act(() => { vi.advanceTimersByTime(TF_DWELL_MS + 5) })
  const w = captured.warms[0]
  expect(w.edge).toBe(true)
  expect(w.signal.aborted).toBe(false)
  act(() => { ctl.setOpts(optsFor('W')) })   // the member left (the timeframe moved on)
  expect(w.signal.aborted).toBe(true)
})

test('a timeframe press records the habit, and the next dwell warms that timeframe first', () => {
  render(<Wrap initialOpts={optsFor('D')} />)
  act(() => { vi.advanceTimersByTime(TF_DWELL_MS + 5) })
  act(() => { captured.props.onTfChange?.('45') })     // the bar's own press (StockChart's onTfChange is the same setTf)
  expect(habitualTfs('D', { k: 1 })).toEqual(['45'])
  captured.warms.length = 0
  act(() => { ctl.setOpts(optsFor('D')) })              // back on D
  act(() => { vi.advanceTimersByTime(TF_DWELL_MS + 5) })
  expect(captured.warms.at(-1).tfs[0]).toBe('15')      // 45m's base, first
})

test('a symbol held for less than the dwell warms nothing for it', () => {
  render(<Wrap initialOpts={optsFor('D')} />)
  act(() => { vi.advanceTimersByTime(TF_DWELL_MS / 2) })
  act(() => { ctl.setOpts(optsFor('W')) })
  act(() => { vi.advanceTimersByTime(TF_DWELL_MS / 2) })
  expect(captured.warms).toHaveLength(0)
  act(() => { vi.advanceTimersByTime(TF_DWELL_MS) })
  expect(captured.warms).toHaveLength(1)
  expect(captured.warms[0].tfs).not.toContain('W')
})

test('never before the first chart paint: queued, then run once it has painted', () => {
  captured.painted = false
  render(<Wrap initialOpts={optsFor('D')} />)
  act(() => { vi.advanceTimersByTime(TF_DWELL_MS + 5) })
  expect(captured.warms).toHaveLength(0)
  expect(captured.paintCbs.length).toBeGreaterThanOrEqual(1)   // the warm (and P2's keep) wait for the paint
  act(() => { for (const f of captured.paintCbs) f() })
  expect(captured.warms).toHaveLength(1)
})

test('CONTROL: in replay the chart warms nothing here (the replay warm owns its timeframes)', () => {
  render(<Wrap initialOpts={optsFor('D')} replayCutoff="2020-03-16" />)
  act(() => { vi.advanceTimersByTime(TF_DWELL_MS * 3) })
  expect(captured.warms).toHaveLength(0)
})

test('(P2) after the dwell the habitual INTRADAY key is kept and lake-seeded (not awaited), released on the next press', () => {
  render(<Wrap initialOpts={optsFor('D')} />)
  act(() => { vi.advanceTimersByTime(TF_DWELL_MS - 5) })
  expect(captured.keeps).toHaveLength(0)                         // not before the dwell
  act(() => { vi.advanceTimersByTime(10) })
  // D's habitual next timeframes: W (a date key: not kept) and 4h (its native base 60): one keep, the 60m key
  expect(captured.keeps).toHaveLength(1)
  expect(captured.keeps[0].key).toMatch(/_60/)
  expect(captured.seeds.map((x) => x.key)).toEqual([captured.keeps[0].key])
  expect(captured.seeds[0].o?.awaited).toBeFalsy()
  act(() => { ctl.setOpts(optsFor('W')) })                       // the member pressed on: released
  expect(captured.keeps[0].released).toBe(true)
})

test('(P2) a hidden page keeps nothing: the keeps are released when the page hides', async () => {
  const { setDeskHidden } = await import('../../../lib/deskVisibility')
  render(<Wrap initialOpts={optsFor('D')} />)
  act(() => { vi.advanceTimersByTime(TF_DWELL_MS + 5) })
  expect(captured.keeps).toHaveLength(1)
  act(() => { setDeskHidden(true) })
  expect(captured.keeps[0].released).toBe(true)
  act(() => { setDeskHidden(false) })
})

test('(P2) CONTROL: nothing kept in replay', () => {
  render(<Wrap initialOpts={optsFor('D')} replayCutoff="2020-03-16" />)
  act(() => { vi.advanceTimersByTime(TF_DWELL_MS * 3) })
  expect(captured.keeps).toHaveLength(0)
})
