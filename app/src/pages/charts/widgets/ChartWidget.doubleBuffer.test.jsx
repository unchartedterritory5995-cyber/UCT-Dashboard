// ⭐⭐ THE DOUBLE-BUFFERED NEXT ROW AT THE WIDGET (2026-11-27; components/chart/useDoubleBuffer.js). A list-linked chart
// widget on a deciding board keeps a second pane, hidden under the shown one, set to the row ahead.
//   W1 the slot: one FRONT layer (shown, not inert) and, after idle time, a SHADOW layer on the row ahead (inert,
//      aria-hidden, the hidden class); a widget with no board scope keeps its one pane (no slot)
//   W2 THE FLIP and the chrome: a press to the shadow's row shows the SAME DOM layer that already held it (its header,
//      its chart), every identity surface agrees (pane, chart, dock), and neither layer's chart rendered for it
//   W3 STALE REFUSED: the store's bars for the row moved on after the shadow's chart reported: the front pane switches
//   W4 FALLBACK: a press to another row switches the front pane, exactly as before
//   W5 (delta review N1) A BOARD SWITCH'S CLICK COMMITS NOTHING OF THE WIDGET: hiding and showing its board (the
//      workspace does it in its click handler) renders no pane and unmounts no chart in that commit; the shadow goes
//      later, in idle time, and comes back after the show
import { render, screen, act, fireEvent } from '@testing-library/react'
import { Profiler, useMemo, useState } from 'react'
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
  prepareDailyForDisplay: async () => 'current',
  prefetchReplayTimeframes: () => {},
}))

// Every identity-bearing child reports the symbol IT was given, so a mixed
// state is directly observable rather than inferred.
const renders = vi.hoisted(() => ({ bySym: {}, props: {}, storeBars: {}, unmounts: 0 }))
// The chart: shows its symbol, and like StockChart REPORTS each committed pass to its layer (chart/layerPaint.js) with the
// bars the store gives its key at that commit, and publishes a date-nav API (a frame at the right edge, default zoom)
vi.mock('../../../components/StockChart', async () => {
  const { useContext, useLayoutEffect, useEffect } = await import('react')
  const { LayerPaintContext } = await import('../../../components/chart/layerPaint')
  return {
    default: (props) => {
      const { sym, tf, onDateNavApi } = props
      renders.bySym[sym] = (renders.bySym[sym] || 0) + 1
      ;(renders.props[sym] = renders.props[sym] || []).push(props)
      const report = useContext(LayerPaintContext)
      useLayoutEffect(() => { report?.({ sym, tf, ext: false, bars: renders.storeBars[sym] }) })
      useLayoutEffect(() => () => { renders.unmounts += 1 }, [])
      useEffect(() => {
        if (typeof onDateNavApi !== 'function') return undefined
        const m = { frame: { fromRight: 160, toRight: -5, locked: false }, activeRange: null, priceAuto: true, replay: { on: false } }
        onDateNavApi({ getDateMeta: () => m, restoreView: () => {} })
        return () => onDateNavApi(null)
      }, [onDateNavApi])
      return <span data-testid="chart-sym">{sym}</span>
    },
  }
})
/** The props that changed between a symbol's chart renders (what made the memo render it). */
const changedProps = (sym) => {
  const list = renders.props[sym] || []
  const out = []
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i]
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    out.push([...keys].filter((k) => !Object.is(a[k], b[k])))
  }
  return JSON.stringify(out)
}
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
import { createGroupSymsStore } from '../groupSymsStore'
import * as nf from '../../../components/chart/neighborFrames'
import * as dbm from '../../../components/chart/doubleBuffer'
import { __setDoubleBufferBarsSourceForTests, __setDoubleBufferStoreForTests } from '../../../components/chart/useDoubleBuffer'
import { chartKeyFor } from '../../../components/chart/useBarSnapshotBars'
import { BoardVisibilityContext, createBoardVisibility } from '../../../components/chart/boardVisibility'

const NOW = new Date('2026-09-16T15:55:00-04:00').getTime()

let setGroup = null
function Wrap({ initial = 'AAA', scoped = true, board = null, log = null }) {
  const [store] = useState(() => createGroupSymsStore({ A: initial, B: null, C: null, D: null }))
  const [groupSyms, setGroupSyms] = useState({ A: initial, B: null, C: null, D: null })
  setGroup = scoped ? (s) => store.set((p) => ({ ...p, A: s })) : (s) => setGroupSyms((p) => ({ ...p, A: s }))
  const value = useMemo(() => ({
    groupSyms: scoped ? store.get() : groupSyms,
    groupSymsStore: scoped ? store : undefined,
    setGroupSym: scoped ? (c, s) => store.set((p) => ({ ...p, [c]: s })) : (c, s) => setGroupSyms((p) => ({ ...p, [c]: s })),
    chartsTheme: 'default',
    crosshairBus: { emit: () => {}, subscribe: () => () => {} },
    aiSearchBus: { subscribe: () => () => {}, request: () => false },
    activeChartRef: { current: null },
  }), [scoped, store, groupSyms])
  return (
    <MemoryRouter>
      <WorkspaceContext.Provider value={value}>
        {board ? (
          <BoardVisibilityContext.Provider value={board}>
            <Profiler id="widget" onRender={() => { log?.push('widget') }}>
              <ChartWidget color="A" opts={{ tf: 'D' }} />
            </Profiler>
          </BoardVisibilityContext.Provider>
        ) : <ChartWidget color="A" opts={{ tf: 'D' }} />}
      </WorkspaceContext.Provider>
    </MemoryRouter>
  )
}

const settle = async (ms = 400) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const layer = (role) => document.querySelector(`[data-db-layer="${role}"]`)
const symIn = (el) => el?.querySelector('[data-testid="chart-sym"]')?.textContent ?? null

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW)
  vi.stubGlobal('requestIdleCallback', undefined)
  for (const s of ['AAA', 'BBB', 'CCC']) renders.storeBars[s] = Object.freeze([s, 1])
  dbm.__setDoubleBufferForTests(true)
  __setDoubleBufferStoreForTests(true)
  dbm.__resetDoubleBufferStatsForTests()
  __setDoubleBufferBarsSourceForTests((key) => {
    for (const sym of ['AAA', 'BBB', 'CCC']) {
      for (const ext of [false, true]) {
        if (chartKeyFor({ sym, resolvedTf: 'D', showExtended: ext, replayCutoff: null, hasOverride: false }) === key) return renders.storeBars[sym]
      }
    }
    return null
  })
  nf.__setNeighborFramesForTests(true); nf.__resetScanForTests()
  nf.publishScanNeighbors('AAA', ['BBB', 'CCC'], [])
  nf.publishScanNeighbors('BBB', ['CCC'], ['AAA'])
  for (const k of Object.keys(renders.bySym)) delete renders.bySym[k]
  for (const k of Object.keys(renders.props)) delete renders.props[k]
})
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllGlobals()
  dbm.__setDoubleBufferForTests(null); nf.__setNeighborFramesForTests(null); __setDoubleBufferBarsSourceForTests(null); __setDoubleBufferStoreForTests(null)
})

test('W1 the slot: a front layer and, after idle time, a shadow on the row ahead (hidden, inert); no scope, no slot', async () => {
  const { unmount } = render(<Wrap />)
  await settle()
  expect(document.querySelector('[data-double-buffer]')).not.toBe(null)
  expect(symIn(layer('front'))).toBe('AAA')
  expect(layer('front').hasAttribute('inert')).toBe(false)
  const sh = layer('shadow')
  expect(symIn(sh)).toBe('BBB')
  expect(sh.hasAttribute('inert')).toBe(true)
  expect(sh.getAttribute('aria-hidden')).toBe('true')
  expect(sh.className).not.toBe(layer('front').className)
  unmount()
  render(<Wrap scoped={false} />)
  await settle()
  expect(document.querySelector('[data-double-buffer]')).toBe(null)
  expect(screen.getByTestId('chart-sym').textContent).toBe('AAA')
})

test('W2 THE FLIP: the layer that held the row is shown, every surface agrees, no chart rendered for it', async () => {
  render(<Wrap />)
  await settle()
  const shadowEl = layer('shadow')
  const before = renders.bySym.BBB
  act(() => { setGroup('BBB') })
  await settle(200)
  expect(layer('front')).toBe(shadowEl)                     // the very layer, now shown
  expect(symIn(layer('front'))).toBe('BBB')
  expect(screen.getByTestId('dock-sym').textContent).toBe('BBB')
  expect(layer('front').hasAttribute('inert')).toBe(false)
  expect(layer('shadow').hasAttribute('inert')).toBe(true)
  expect(renders.bySym.BBB, `the flip rendered the chart: props changed ${changedProps('BBB')}`).toBe(before)   // no chart render
  expect(dbm.doubleBufferStats().flips).toBe(1)
})

test('W3 STALE: the row moved on after the shadow was set -> the front pane switches', async () => {
  render(<Wrap />)
  await settle()
  const frontEl = layer('front')
  renders.storeBars.BBB = Object.freeze(['BBB', 2])   // the store moved on for the row after the shadow's chart reported
  act(() => { setGroup('BBB') })
  await settle(200)
  expect(layer('front')).toBe(frontEl)
  expect(symIn(frontEl)).toBe('BBB')
  expect(dbm.doubleBufferStats().flips).toBe(0)
  expect(dbm.doubleBufferStats().why.stale).toBe(1)
})

test('W4 FALLBACK: a press to another row switches the front pane', async () => {
  render(<Wrap />)
  await settle()
  const frontEl = layer('front')
  act(() => { setGroup('CCC') })
  await settle(200)
  expect(layer('front')).toBe(frontEl)
  expect(symIn(frontEl)).toBe('CCC')
  expect(screen.getByTestId('dock-sym').textContent).toBe('CCC')
  expect(dbm.doubleBufferStats().flips).toBe(0)
})

/** The workspace's board switch: a click that hides (or shows) the board in its own handler, beside a sync update. */
function SwitchBoard({ board, log }) {
  const [n, setN] = useState(0)
  return (
    <Profiler id="root" onRender={() => { log.push('root') }}>
      <button type="button" data-testid="board-switch" onClick={() => { setN((x) => x + 1); board.set(board.state === 'visible' ? 'hidden' : 'visible') }}>{n}</button>
      <Wrap board={board} log={log} />
    </Profiler>
  )
}

test("W5 (N1) a board switch's click commits nothing of the widget; the shadow goes in idle time and returns after the show", async () => {
  const board = createBoardVisibility({ layer: true })
  const log = []
  render(<SwitchBoard board={board} log={log} />)
  await settle()
  expect(symIn(layer('shadow'))).toBe('BBB')
  const renderedBefore = { ...renders.bySym }
  log.length = 0
  fireEvent.click(screen.getByTestId('board-switch'))     // hide the board
  expect(log[0], `the click's commit rendered the widget: ${JSON.stringify(log)}`).toBe('root')
  expect(renders.unmounts, 'the click unmounted a chart').toBe(0)
  expect(renders.bySym).toEqual(renderedBefore)          // no chart rendered at all
  expect(dbm.shadowsHeld(board)).toBe(0)                  // the budget moved at once
  await settle()                                          // idle time: the hidden pane goes
  expect(renders.unmounts).toBe(1)
  expect(layer('shadow')).toBe(null)
  log.length = 0
  fireEvent.click(screen.getByTestId('board-switch'))     // show it again
  expect(log[0], `the show's commit rendered the widget: ${JSON.stringify(log)}`).toBe('root')
  expect(dbm.shadowsHeld(board)).toBe(1)
  await settle()
  expect(symIn(layer('shadow'))).toBe('BBB')
})
