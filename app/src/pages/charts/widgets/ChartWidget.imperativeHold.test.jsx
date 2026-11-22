// ⭐⭐ THE HELD CHART BODY, AT THE WIDGET BOUNDARY (imperative switch; the browser A/B of 3cf50f94d5, 2026-11-22).
//
// With the switch on, the key handler's decision paints the new symbol and the widget's handoff HOLDS the chart body
// on the old symbol until a task after the frame (`painter.bodySym`). The label (this widget, the pane header) moves
// in the key's task; the body must not render there, or the key's task pays the very render the switch exists to move
// out of it. The A/B found it did: `subscribeCrosshair` was keyed on the HOST's symbol, which moves in the key's task,
// and it reaches `memo(StockChart)` untrampolined, so both charts re-rendered with the held symbol before the frame.
//
// Here the real ChartWidget, ChartPane and StableStockChart, with StockChart mocked: it counts its renders and, as the
// real chart does with the switch on, puts a switch controller (a fake that paints) in the port the widget hands it.
//   • switch ON: a decided switch renders the chart ZERO times between the key and the release; the label moves at
//     once, and the chart renders the new symbol after the release;
//   • …a target that is delisted (its watermark props come from the pane's delisted lookup) is held the same way;
//   • switch OFF (no controller in the port): the callback's identity moves exactly as on master, where it was keyed
//     on `sym`: it changes when the chart's symbol changes and only then.
import { render, screen, act } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'
import { createGroupSymsStore } from '../groupSymsStore'
import { decideGroupShow, chartGroupKey, __resetHandoffGroupsForTests } from '../../../hooks/handoffGroups'

const W = vi.hoisted(() => ({ renders: [], props: [], ctl: null, applied: [], delisted: {} }))

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
// the chart: counts its renders and records its props; with a controller set, it puts it in the port it is handed
vi.mock('../../../components/StockChart', async () => {
  const { useLayoutEffect } = await import('react')
  return {
    default: (props) => {
      W.renders.push(props.sym)
      W.props.push(props)
      useLayoutEffect(() => { if (props.switchPort && W.ctl) props.switchPort.current = W.ctl })
      return <span data-testid="chart-sym">{props.sym}</span>
    },
  }
})
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
// the pane's delisted lookup: what a case says each symbol is
vi.mock('../../../components/chart/restedReaders', async (importOriginal) => ({
  ...(await importOriginal()),
  useChartDelisted: (s) => (s && W.delisted[s]) || null,
}))

import ChartWidget from './ChartWidget'

const NOW = new Date('2026-09-16T15:55:00-04:00').getTime()
const unix = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return Math.floor(new Date(`2026-09-16T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-04:00`).getTime() / 1000)
}
const CURRENT = () => [{ t: unix('15:50') - 300, c: 1 }, { t: unix('15:50'), c: 1 }]

/** A switch controller that paints every symbol it is asked (the real one is railed on the real chart). */
const paintingController = () => ({
  canApply: (s) => ({ ok: true, sym: s }),
  apply: (s) => { W.applied.push(s); return 'applied' },
  reconcile: () => {}, noteReleased: () => {}, noteRound: () => {}, pendingSym: () => null,
})

let press
let setMarkDay
/** The /charts board as far as the widget reads it: a group-symbols store (the decision's scope) and its setGroupSym. */
function Board() {
  const [store] = useState(() => createGroupSymsStore({ A: 'AAA', B: null, C: null, D: null }))
  const [bus] = useState(() => ({ emit: () => {}, subscribe: () => () => {} }))
  const [markDay, _setMarkDay] = useState(null)
  setMarkDay = _setMarkDay
  // the board's setGroupSym (ChartsWorkspace.jsx): decide in the press, then write the symbol
  press = (sym) => { decideGroupShow(store, chartGroupKey('A'), sym); store.set((p) => ({ ...p, A: sym })) }
  const [base] = useState(() => ({
    groupSymsStore: store,
    groupSyms: store.get(),
    setGroupSym: (c, s) => store.set((p) => ({ ...p, [c]: s })),
    chartsTheme: 'default',
    crosshairBus: bus,
    aiSearchBus: { subscribe: () => () => {}, request: () => false },
    activeChartRef: { current: null },
  }))
  const value = markDay ? { ...base, markDay } : base
  return (
    <MemoryRouter>
      <WorkspaceContext.Provider value={value}>
        <ChartWidget color="A" opts={{ tf: '5' }} />
      </WorkspaceContext.Provider>
    </MemoryRouter>
  )
}
const release = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(40) }) }

beforeEach(() => {
  memState.clear()
  for (const s of ['AAA', 'BBB', 'CCC']) memState.set(`${s}_5`, CURRENT())
  W.renders.length = 0; W.props.length = 0; W.applied.length = 0; W.ctl = null; W.delisted = {}
  __resetHandoffGroupsForTests()
  vi.useFakeTimers(); vi.setSystemTime(NOW)
  // the release is a frame, then a task: on the fake clock
  vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(cb, 16))
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

test('switch ON: a decided switch renders the chart ZERO times between the key and the release; the label moves at once', async () => {
  W.ctl = paintingController()
  render(<Board />)
  await act(async () => { await vi.advanceTimersByTimeAsync(400) })   // quiet: the next press is decided at once
  expect(screen.getByTestId('chart-sym').textContent).toBe('AAA')
  const n0 = W.renders.length
  act(() => { press('BBB') })
  expect(W.applied, 'the decision painted BBB').toEqual(['BBB'])
  expect(screen.getByTestId('dock-sym').textContent, 'the host shows BBB in the key\'s task').toBe('BBB')
  expect(W.renders.slice(n0), 'the chart rendered while its body was held').toEqual([])
  await release()
  expect(W.renders.slice(n0).length, 'the chart renders the new symbol after the release').toBeGreaterThan(0)
  expect(W.renders.slice(n0).every((s) => s === 'BBB')).toBe(true)
})

test('switch ON: a delisted target is held the same way (its watermark props are the BODY\'s symbol\'s until the release)', async () => {
  W.ctl = paintingController()
  W.delisted = { BBB: { name: 'Bravo (delisted)', sector: 'Technology', industry: 'Software', date: '2024-01-02' } }
  render(<Board />)
  await act(async () => { await vi.advanceTimersByTimeAsync(400) })
  const n0 = W.renders.length
  act(() => { press('BBB') })
  expect(W.applied).toEqual(['BBB'])
  expect(W.renders.slice(n0), 'the chart rendered while its body was held').toEqual([])
  await release()
  const after = W.props.slice(n0)
  expect(after.length).toBeGreaterThan(0)
  // non-vacuity: once the body takes BBB, it is handed BBB's delisted props
  expect(after.at(-1).sym).toBe('BBB')
  expect(after.at(-1).watermarkName).toBe('Bravo (delisted)')
})

test('switch OFF (no controller): the crosshair callback\'s identity moves as on master, with the chart\'s symbol and only then', async () => {
  render(<Board />)
  await act(async () => { await vi.advanceTimersByTimeAsync(400) })
  // a render of the chart that is not a switch (the board marks a day: a prop of the chart changes)
  act(() => { setMarkDay('2026-09-10') })
  await act(async () => { await vi.advanceTimersByTimeAsync(400) })
  act(() => { press('BBB') })
  await act(async () => { await vi.advanceTimersByTimeAsync(400) })
  act(() => { press('CCC') })
  await act(async () => { await vi.advanceTimersByTimeAsync(400) })
  expect(W.applied).toEqual([])                          // nothing painted: today's path
  const seq = W.props.map((p) => ({ sym: p.sym, cb: p.subscribeCrosshair }))
  expect(new Set(seq.map((s) => s.sym))).toEqual(new Set(['AAA', 'BBB', 'CCC']))
  expect(seq.filter((s) => s.sym === 'AAA').length, 'non-vacuity: the chart rendered AAA more than once').toBeGreaterThan(1)
  for (let i = 1; i < seq.length; i++) {
    const sameSym = seq[i].sym === seq[i - 1].sym
    const sameCb = seq[i].cb === seq[i - 1].cb
    expect(sameCb, `render ${i}: ${seq[i - 1].sym} -> ${seq[i].sym}`).toBe(sameSym)
  }
})
