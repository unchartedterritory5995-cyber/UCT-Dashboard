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
//   W6 the two layers' charts are mounted once for the widget's life
//   W7 (review of #2932) a typed Enter that flips leaves the focus in the front layer, as a typed switch does
//   W8 (owner, 2026-11-27) change-date mode at a 2006 date (the workspace's replay cutoff): a press to the row ahead flips
//   W9 (owner, 2026-11-27) zoomed out 2014-2026 (a view lock both layers hold, at the frame it gives): a press flips
//   W10 (owner, 2026-11-27) the date box: go to 1/3/2006, arrow through 10 symbols: every chart opens at that date with
//      the same span (both layers carry the anchor), presses flip where the hidden chart is ready; "Latest" clears it
//   W11 Enter on an empty date field clears it; entering replay clears it
import { render, screen, act, fireEvent, within } from '@testing-library/react'
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
const renders = vi.hoisted(() => ({ bySym: {}, props: {}, storeBars: {}, unmounts: 0, mounts: 0, meta: null }))
// The chart: shows its symbol, and like StockChart REPORTS each committed pass to its layer (chart/layerPaint.js) with the
// bars the store gives its key at that commit, and publishes a date-nav API (a frame at the right edge, default zoom)
vi.mock('../../../components/StockChart', async () => {
  const { useContext, useLayoutEffect, useEffect, useRef } = await import('react')
  const { LayerPaintContext } = await import('../../../components/chart/layerPaint')
  return {
    default: (props) => {
      const { sym, tf, onDateNavApi, replayCutoff, anchorDate, anchorWidth } = props
      renders.bySym[sym] = (renders.bySym[sym] || 0) + 1
      ;(renders.props[sym] = renders.props[sym] || []).push(props)
      const report = useContext(LayerPaintContext)
      const latest = useRef(props)
      latest.current = props
      useLayoutEffect(() => { report?.({ sym, tf, ext: false, bars: renders.storeBars[sym], cutoff: replayCutoff || null, anchor: anchorWidth ? `${anchorDate}|${anchorWidth}` : null }) })
      useLayoutEffect(() => { renders.mounts += 1; return () => { renders.unmounts += 1 } }, [])
      useEffect(() => {
        if (typeof onDateNavApi !== 'function') return undefined
        const m = { frame: { fromRight: 160, toRight: -5, locked: false }, activeRange: null, priceAuto: true, replay: { on: false } }
        onDateNavApi({ getDateMeta: () => (typeof renders.meta === 'function' ? renders.meta(latest.current) : renders.meta) || m, restoreView: () => {}, stepBar: () => {}, goToDate: () => {}, goToYear: () => {} })
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
// The header's search: like SymbolSearch, its input sits in a PORTAL (outside the layer), and a submit hides that portal
// root before it calls onSymbolChange (SymbolSearch.submit)
vi.mock('../../../components/chart/SymbolSearch', async () => {
  const { forwardRef, useImperativeHandle, useRef } = await import('react')
  const { createPortal } = await import('react-dom')
  return {
    default: forwardRef((p, ref) => {
      useImperativeHandle(ref, () => ({ openWith: () => {} }))
      const root = useRef(null)
      const submit = (e) => {
        e.preventDefault()
        if (root.current) root.current.style.display = 'none'
        p.onSymbolChange?.(e.currentTarget.elements.q.value.toUpperCase())
      }
      return (
        <>
          <span>search</span>
          {createPortal(<div ref={root}><form data-testid={`search-${p.sym}`} onSubmit={submit}><input name="q" aria-label={`search ${p.sym}`} /></form></div>, document.body)}
        </>
      )
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
import * as nf from '../../../components/chart/neighborFrames'
import * as dbm from '../../../components/chart/doubleBuffer'
import { __setDoubleBufferBarsSourceForTests, __setDoubleBufferStoreForTests } from '../../../components/chart/useDoubleBuffer'
import { chartKeyFor } from '../../../components/chart/useBarSnapshotBars'
import { BoardVisibilityContext, createBoardVisibility } from '../../../components/chart/boardVisibility'

const NOW = new Date('2026-09-16T15:55:00-04:00').getTime()

let setGroup = null
function Wrap({ initial = 'AAA', scoped = true, board = null, log = null, cutoff = null }) {
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
    replayCutoff: cutoff,
  }), [scoped, store, groupSyms, cutoff])
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
  renders.meta = null
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
function Switcher({ board }) {
  const [n, setN] = useState(0)
  return <button type="button" data-testid="board-switch" onClick={() => { setN((x) => x + 1); board.set(board.state === 'visible' ? 'hidden' : 'visible') }}>{n}</button>
}
// the switch's own update re-renders only the switch (a sibling of the board, as in the workspace's chrome)
function SwitchBoard({ board, log }) {
  return (
    <Profiler id="root" onRender={() => { log.push('root') }}>
      <Switcher board={board} />
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
  const unmounted = renders.unmounts
  log.length = 0
  fireEvent.click(screen.getByTestId('board-switch'))     // hide the board
  expect(log[0], `the click's commit rendered the widget: ${JSON.stringify(log)}`).toBe('root')
  expect(renders.unmounts - unmounted, 'the click unmounted a chart').toBe(0)
  expect(renders.bySym).toEqual(renderedBefore)          // no chart rendered at all
  expect(dbm.shadowsHeld(board)).toBe(0)                  // the budget moved at once
  await settle()                                          // idle time: the hidden pane goes
  expect(renders.unmounts - unmounted).toBe(1)
  expect(layer('shadow')).toBe(null)
  log.length = 0
  fireEvent.click(screen.getByTestId('board-switch'))     // show it again
  expect(log[0], `the show's commit rendered the widget: ${JSON.stringify(log)}`).toBe('root')
  expect(dbm.shadowsHeld(board)).toBe(1)
  await settle()
  expect(symIn(layer('shadow'))).toBe('BBB')
})

// (2026-11-27, the live dry run's canvas count) a hidden pane is RE-USED for each next row, never re-created: the widget
// holds two charts for its life, whatever the presses
test('W6 the two layers are mounted once: flips and retargets re-use the same two charts (no canvas growth)', async () => {
  const m0 = renders.mounts, u0 = renders.unmounts
  render(<Wrap />)
  await settle()
  expect(renders.mounts - m0).toBe(2)
  act(() => { setGroup('BBB') })
  await settle(400)
  act(() => { setGroup('CCC') })
  await settle(400)
  act(() => { setGroup('AAA') })
  await settle(400)
  expect(dbm.doubleBufferStats().flips).toBeGreaterThanOrEqual(1)
  expect(renders.mounts - m0, 'a press or a retarget mounted another chart').toBe(2)
  expect(renders.unmounts - u0).toBe(0)
})

// (review of #2932) a typed Enter refocuses the chart (ChartPane handleSymbolChange, in the next frame) so the next keys
// reach it. On a FLIP the pane that ran the search is the OLD front, inert by the time that frame runs: the focus must land
// in the pane now shown. The frames the Enter asks for are held until its switch has committed: the order when the handoff
// shows a warm row at once (here the handoff's own wait would otherwise let the frame run first, and F5 carry the focus).
const typeEnter = async (paneSym, text) => {
  const input = screen.getByLabelText(`search ${paneSym}`)
  act(() => { input.focus() })
  fireEvent.change(input, { target: { value: text } })
  const frames = []
  const raf = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length }
  try { fireEvent.submit(screen.getByTestId(`search-${paneSym}`)) } finally { globalThis.requestAnimationFrame = raf }
  await settle(200)                                         // the switch commits
  act(() => { for (const cb of frames.splice(0)) cb(performance.now()) })   // then the Enter's frame
  await settle(50)
}
test('W7 (review of #2932) a typed Enter that flips leaves the focus in the front layer, as a typed switch does', async () => {
  render(<Wrap />)
  await settle()
  expect(symIn(layer('shadow'))).toBe('BBB')
  await typeEnter('AAA', 'bbb')
  expect(dbm.doubleBufferStats().flips).toBe(1)
  expect(symIn(layer('front'))).toBe('BBB')
  expect(layer('front').contains(document.activeElement), `focus is on ${document.activeElement?.tagName} ${document.activeElement?.getAttribute?.('aria-label') ?? ''}`).toBe(true)
  await settle()
  expect(symIn(layer('shadow'))).toBe('CCC')
  await typeEnter('BBB', 'aaa')                             // not the hidden pane's row: the normal switch (the control)
  expect(dbm.doubleBufferStats().flips).toBe(1)
  expect(symIn(layer('front'))).toBe('AAA')
  expect(layer('front').contains(document.activeElement)).toBe(true)
})

// (owner, 2026-11-27) instant scanning in change-date mode and zoomed out: the hidden pane is prepared in the front's mode
test('W8 (owner) change-date mode at a 2006 date: both layers hold the cutoff; a press to the row ahead flips', async () => {
  render(<Wrap cutoff="2006-03-15" />)
  await settle()
  expect(symIn(layer('shadow'))).toBe('BBB')
  act(() => { setGroup('BBB') })
  await settle(200)
  expect(dbm.doubleBufferStats().flips).toBe(1)
  expect(symIn(layer('front'))).toBe('BBB')
})
test('W9 (owner) zoomed out 2014-2026: a view lock both layers hold, at the frame it gives them; a press flips', async () => {
  renders.meta = { frame: { fromRight: 2850, toRight: -150, locked: true, lock: { anchorFrac: 0.95, width: 3000, tf: 'D', top: null, bottom: null } },
    activeRange: '12Y', priceAuto: true, replay: { mode: false }, rows: 6000, replayLock: null }
  render(<Wrap />)
  await settle()
  act(() => { setGroup('BBB') })
  await settle(200)
  expect(dbm.doubleBufferStats().flips, JSON.stringify(dbm.doubleBufferStats().why)).toBe(1)
})

// (owner, 2026-11-27) scanning charts AT a past date: the date box's anchor rides both layers' props
const SYMS = ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9']
const anchoredMeta = (p) => (p.anchorWidth
  ? { frame: { fromRight: 4700, toRight: 4700 - p.anchorWidth, locked: false }, activeRange: null, priceAuto: true, replay: { mode: false },
    rows: 6000, anchor: { date: p.anchorDate, width: p.anchorWidth }, anchorFrame: { fromRight: 4700, toRight: 4700 - p.anchorWidth }, anchorEarliest: false }
  : { frame: { fromRight: 160, toRight: -5, locked: false }, activeRange: null, priceAuto: true, replay: { on: false } })
function scanList() {
  for (const s of SYMS) renders.storeBars[s] = Object.freeze([s, 1])
  SYMS.forEach((s, i) => { nf.publishScanNeighbors(s, SYMS.slice(i + 1, i + 2), i ? [SYMS[i - 1]] : []) })
  __setDoubleBufferBarsSourceForTests((key) => {
    for (const sym of SYMS) if (chartKeyFor({ sym, resolvedTf: 'D', showExtended: false, replayCutoff: null, hasOverride: false }) === key) return renders.storeBars[sym]
    return null
  })
  renders.meta = anchoredMeta
}
const lastProps = (sym) => { const l = renders.props[sym] || []; return l[l.length - 1] }
const dateField = () => layer('front').querySelector('input[placeholder="M/D/YYYY"]')
const goTo = (text) => {
  const f = dateField()
  act(() => { f.focus() })
  fireEvent.change(f, { target: { value: text } })
  fireEvent.keyDown(f, { key: 'Enter' })
}
test('W10 (owner) go to 1/3/2006, arrow through 10 symbols: each opens at that date with the same span, flips where ready; Latest clears', async () => {
  scanList()
  render(<Wrap initial="S0" />)
  await settle()
  goTo('1032006')
  await settle()
  const w = lastProps('S0').anchorWidth
  expect(lastProps('S0').anchorDate).toBe('2006-01-03')
  expect(w).toBe(165)                                         // the member's span (the front's frame: 160 - -5)
  for (const s of SYMS.slice(1)) {
    act(() => { setGroup(s) })
    await settle(400)
    expect(symIn(layer('front'))).toBe(s)
    expect(lastProps(s).anchorDate, `${s} opened at another date`).toBe('2006-01-03')
    expect(lastProps(s).anchorWidth, `${s} opened at another span`).toBe(w)
  }
  expect(dbm.doubleBufferStats().flips, JSON.stringify(dbm.doubleBufferStats().why)).toBeGreaterThanOrEqual(5)
  const latest = within(layer('front')).getByRole('button', { name: 'Back to the latest bar' })
  fireEvent.click(latest)
  await settle()
  expect(lastProps('S9').anchorDate ?? null).toBe(null)
  expect(within(layer('front')).queryByRole('button', { name: 'Back to the latest bar' })).toBe(null)
  act(() => { setGroup('S8') })
  await settle(400)
  expect(lastProps('S8').anchorDate ?? null).toBe(null)       // back to the present
})
test('W11 (owner) Enter on an empty date field clears the date; entering replay clears it', async () => {
  scanList()
  const view = render(<Wrap initial="S0" />)
  await settle()
  goTo('1032006')
  await settle()
  expect(lastProps('S0').anchorDate).toBe('2006-01-03')
  goTo('')
  await settle()
  expect(lastProps('S0').anchorDate ?? null).toBe(null)
  goTo('1032006')
  await settle()
  expect(lastProps('S0').anchorDate).toBe('2006-01-03')
  view.rerender(<Wrap initial="S0" cutoff="2006-06-30" />)
  await settle()
  expect(lastProps('S0').anchorDate ?? null).toBe(null)
})
