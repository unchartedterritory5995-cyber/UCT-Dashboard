// ⭐ THE FIELD INSTRUMENT FOR SWITCH SPEED, THROUGH THE REAL HANDOFF (2026-11-23).
//
// Real: useSymbolHandoff, handoffGroups (the board's own beginGroupSwitch), the chart paint record
// (chart/paintLog.recordPaint, called where StockChart calls it), lib/switchSpeed and, for what is sent,
// lib/perfBeacon. Real DOM events through React's own dispatch. Stubbed: the bar store's answers (which rows are
// held), the animation frame (so a test decides when "the frame" is) and the instrument's clock.
//
// What these hold:
//   · the sample ends at the frame after the LATER chart of a linked pair has drawn, never the first;
//   · the press measures nothing: no clock read, no frame asked for, no count, until the frame callback;
//   · every trigger and every route is reached from a real path;
//   · a switch the next press replaces is counted `superseded` and is never a sample;
//   · nothing the page holds (a ticker, a title, a list's name) is in what is sent.
import { render, fireEvent, act } from '@testing-library/react'
import { useLayoutEffect, useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../components/chart/barStoreSwitch', () => ({ BARSTORE: true }))
const st = vi.hoisted(() => ({ ready: {}, columns: true, holds: true, prep: {}, daily: {}, cols: [] }))
vi.mock('../data/barStore/prefetch', () => ({
  peekDisplayable: (sym, tf) => st.ready[tf] !== false,
  lakePending: () => false,
  deepPending: () => false,
  holdsBars: () => st.holds,
  heldRows: () => 0,
  prepareForDisplay: (sym, tf) => new Promise((r) => { st.prep[tf] = r }),
  prepareDailyForDisplay: (sym, tf) => new Promise((r) => { st.daily[tf] = r }),
  prefetchBarsToIDB: () => {},
}))
vi.mock('../utils/prefetchBars', () => ({ prefetchBarsToIDB: () => {}, prepareForDisplay: () => new Promise(() => {}), prepareDailyForDisplay: () => new Promise(() => {}) }))
vi.mock('../utils/barsMemCache', () => ({ memPeek: () => null }))
vi.mock('../components/chart/engine/serverCompute', () => ({
  columnsReadyFor: () => st.columns,
  whenColumnsReady: () => new Promise((r) => { st.cols.push(r) }),
  warmColumnsFor: () => {},
}))

import useSymbolHandoff from './useSymbolHandoff'
import { beginGroupSwitch, registerMember, __resetHandoffGroupsForTests, __resetScopeForTests } from './handoffGroups'
import { BURST_SETTLE_MS } from './useSymbolSettle'
import { recordPaint } from '../components/chart/paintLog'
import {
  SWITCH_TF, SWITCH_TRIGGER, SWITCH_ROUTE, SWITCH_COUNTERS, SWITCH_SPEED_GLOBAL, TRIGGER_TYPED,
  hintSwitchTrigger, peekSwitchCounts, __resetSwitchSpeedForTests, __setSwitchClockForTests,
} from '../lib/switchSpeed'
import { startPerfBeacon } from '../lib/perfBeacon'

const G = 'charts:A'
let scope
let board
let frames
let clock
let clockReads      // one entry per read of the instrument's clock: was it inside a frame callback?
let inFrame

beforeEach(() => {
  // (the frame and the microtask stay real: a test asks for them itself)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  vi.setSystemTime(new Date('2026-11-18T15:00:00Z'))        // a Wednesday, 10:00 in New York: inside the regular session
  Object.assign(st, { ready: {}, columns: true, holds: true, prep: {}, daily: {}, cols: [] })
  __resetHandoffGroupsForTests()
  __resetSwitchSpeedForTests()
  scope = { board: 1 }
  board = { settle: null, on: null, setGroupSym: null }
  frames = []
  clock = 0
  clockReads = []
  inFrame = false
  __setSwitchClockForTests(() => { clockReads.push(inFrame); return clock })
  vi.stubGlobal('requestAnimationFrame', (cb) => { frames.push(cb); return frames.length })
})
afterEach(() => {
  __resetScopeForTests(scope)
  __resetSwitchSpeedForTests()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** One chart of the board: the real handoff, and the chart's paint record where StockChart makes it: in the layout
 *  effect of the commit that shows a symbol (StockChart.jsx: useLayoutEffect on [sym, resolvedTf] -> updateChart ->
 *  recordPaint), and again when its rows arrive. `c.bars(sym)`: how many rows the chart has for the symbol it shows. */
function Chart({ c, s }) {
  const [, force] = useState(0)
  c.repaint = () => force((n) => n + 1)
  const shown = useSymbolHandoff(s, c.tf, { group: G, scope, member: c.member, settle: board.settle })
  c.shown = shown
  const bars = c.bars(shown)
  useLayoutEffect(() => { recordPaint(shown, c.tf, bars, 'full', c.member) }, [shown, c.tf, bars, c.member])
  return null
}
/** The board: a list, a search box and the charts of ONE colour group. Its setGroupSym is ChartsWorkspace's: the press
 *  goes to the group first (beginGroupSwitch), then the symbol is written. */
function Board({ charts }) {
  const [sym, setSym] = useState('AAA')
  const setGroupSym = (next) => { if (next !== sym) beginGroupSwitch(scope, G, next); setSym(next) }
  board.setGroupSym = setGroupSym
  const on = (e) => board.on?.(e, setGroupSym)
  return (
    <>
      <ul data-testid="list" tabIndex={0} onKeyDown={on} onClick={on}><li data-testid="row">row</li></ul>
      <input data-testid="search" onKeyDown={on} />
      {charts.map((c) => <Chart key={c.id} c={c} s={sym} />)}
    </>
  )
}
const chart = (id, tf, bars = () => 100) => ({ id, tf, member: { id }, bars, shown: null, repaint: null })
function mount(charts, { settle = null } = {}) {
  board.settle = settle
  const view = render(<Board charts={charts} />)
  return { list: view.getByTestId('list'), row: view.getByTestId('row'), search: view.getByTestId('search') }
}
/** A real key or click on `el` whose handler switches the group to `sym`; returns the press time (the event's own). */
function press(el, sym, how = 'ArrowDown', around = (go) => go()) {
  let t0 = null
  board.on = (e, setGroupSym) => { t0 = e.nativeEvent.timeStamp; around(() => setGroupSym(sym)) }
  if (how === 'click') fireEvent.click(el)
  else fireEvent.keyDown(el, { key: how })
  board.on = null
  expect(typeof t0).toBe('number')
  return t0
}
/** The frame: whatever was waiting on a microtask, then every frame callback asked for, with the clock at `at`. */
async function frame(at) {
  await act(async () => {})
  clock = at
  inFrame = true
  const run = frames.splice(0)
  run.forEach((cb) => cb(at))
  inFrame = false
  return run.length
}
const named = (c) => ({ tf: SWITCH_TF[c[0]], store: c[1], trigger: SWITCH_TRIGGER[c[2]], route: SWITCH_ROUTE[c[3]], rth: c[4], n: c.slice(5) })
const cells = () => (peekSwitchCounts()?.cells || []).map(named)
const total = () => cells().reduce((sum, c) => sum + c.n.reduce((a, b) => a + b, 0), 0)
const counters = () => Object.fromEntries(SWITCH_COUNTERS.map((k, i) => [k, peekSwitchCounts()?.counters[i] ?? 0]))
const bucket = (i) => Array.from({ length: 11 }, (_, k) => (k === i ? 1 : 0))
const shownBy = (...cs) => cs.map((c) => c.shown)

describe('what one sample is', () => {
  it('⭐ a linked pair: the sample ends at the frame after the LATER chart has drawn, not the first', async () => {
    let secondHasRows = false
    const a = chart(1, '30')
    const b = chart(2, '60', (sym) => (sym === 'BBB' && !secondHasRows ? 0 : 100))
    const { list } = mount([a, b])
    const t0 = press(list, 'BBB')
    expect(shownBy(a, b)).toEqual(['BBB', 'BBB'])            // decided in the press: both charts were handed the symbol
    expect(await frame(t0 + 20)).toBe(0)                     // ONE chart has drawn: no frame is even asked for
    expect(total()).toBe(0)
    act(() => { secondHasRows = true; b.repaint() })         // the second chart's rows arrive: its full pass
    expect(await frame(t0 + 37)).toBe(1)
    expect(cells()).toEqual([{ tf: 'intraday-other', store: 0, trigger: 'list-key', route: 'decision', rth: 1, n: bucket(3) }])   // 33-40
    expect(await frame(t0 + 400)).toBe(0)                    // and it is counted once
    expect(total()).toBe(1)
  })

  it('⭐ the press measures nothing: no clock read, no frame asked for, no count, until the frame callback runs', async () => {
    const a = chart(1, '30')
    const b = chart(2, '60')
    const { list } = mount([a, b])
    let t0 = null
    let inHandler = null
    board.on = (e, setGroupSym) => {
      t0 = e.nativeEvent.timeStamp
      setGroupSym('BBB')
      inHandler = { reads: clockReads.length, frames: frames.length, counted: total() }
    }
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    board.on = null
    expect(inHandler).toEqual({ reads: 0, frames: 0, counted: 0 })
    // the handler has returned and React has committed: both charts drew in that commit, still in the key's own task
    expect(shownBy(a, b)).toEqual(['BBB', 'BBB'])
    expect([clockReads.length, frames.length, total()]).toEqual([0, 0, 0])
    await act(async () => {})                                // after the commit: ONE frame is asked for, nothing more
    expect([clockReads.length, frames.length, total()]).toEqual([0, 1, 0])
    clock = t0 + 12
    inFrame = true
    frames.splice(0).forEach((cb) => cb(clock))
    inFrame = false
    expect(clockReads).toEqual([true])                       // the one clock read: inside the frame callback
    expect(cells()).toEqual([{ tf: 'intraday-other', store: 0, trigger: 'list-key', route: 'decision', rth: 1, n: bucket(0) }])
  })

  it.each([
    [['1', 'D'], 'intraday-1m'],
    [['30', '60'], 'intraday-other'],
    [['D', 'W'], 'daily-plus'],
  ])("the group's timeframe class is its finest chart's: %j is %s", async (tfs, tf) => {
    const { list } = mount(tfs.map((code, i) => chart(i + 1, code)))
    const t0 = press(list, 'BBB')
    await frame(t0 + 10)
    expect(cells().map((c) => [c.tf, c.route])).toEqual([[tf, 'decision']])
  })

  it('outside the regular session the same switch lands in the other cell', async () => {
    vi.setSystemTime(new Date('2026-11-21T15:00:00Z'))       // a Saturday
    const { list } = mount([chart(1, '30'), chart(2, '60')])
    const t0 = press(list, 'BBB')
    await frame(t0 + 10)
    expect(cells().map((c) => c.rth)).toEqual([0])
  })
})

describe('every trigger, from a real event', () => {
  it.each([
    ['an arrow key on the list', 'list', 'ArrowDown', 'list-key'],
    ['the space bar on the list', 'list', ' ', 'list-key'],
    ['a click on a row', 'row', 'click', 'list-click'],
    ['Enter in the search box', 'search', 'Enter', 'typed'],
    ['a hotkey outside a text field', 'list', 'j', 'other'],
  ])('%s', async (_name, where, how, trigger) => {
    const els = mount([chart(1, '30'), chart(2, '60')])
    const t0 = press(els[where], 'BBB', how)
    await frame(t0 + 10)
    expect(cells().map((c) => c.trigger)).toEqual([trigger])
    expect(total()).toBe(1)
  })

  it('a search result that is clicked is typed: the search says so, and says it for that one switch only', async () => {
    const { row } = mount([chart(1, '30'), chart(2, '60')])
    const told = (go) => { hintSwitchTrigger(TRIGGER_TYPED); try { go() } finally { hintSwitchTrigger(-1) } }   // ChartPane handleSearchedSymbol
    let t0 = press(row, 'BBB', 'click', told)
    await frame(t0 + 10)
    t0 = press(row, 'CCC', 'click')
    await frame(t0 + 10)
    expect(cells().map((c) => c.trigger).sort()).toEqual(['list-click', 'typed'])
  })

  it('a symbol that changes with no input in flight is not a press: nothing is measured, and it is counted', async () => {
    const { list } = mount([chart(1, '30'), chart(2, '60')])
    act(() => { board.setGroupSym('BBB') })                  // a link, a layout restore
    expect(await frame(50)).toBe(0)
    expect(total()).toBe(0)
    const t0 = press(list, 'CCC')
    await frame(t0 + 10)
    expect(total()).toBe(1)
    expect(counters()).toMatchObject({ unpressed: 1, superseded: 0 })
  })
})

describe('every route, from the real handoff', () => {
  it('decision: every chart could show it in the press', async () => {
    const a = chart(1, '30')
    const b = chart(2, '60')
    const { list } = mount([a, b])
    const t0 = press(list, 'BBB')
    await frame(t0 + 10)
    expect(cells().map((c) => c.route)).toEqual(['decision'])
  })

  it("now: the rows are held but a chart's columns had not landed, so it is shown from the handoff a moment later", async () => {
    const a = chart(1, '30')
    const b = chart(2, '60')
    const { list } = mount([a, b])
    st.columns = false
    const t0 = press(list, 'BBB')
    expect(shownBy(a, b)).toEqual(['AAA', 'AAA'])
    expect(await frame(t0 + 10)).toBe(0)
    await act(async () => { st.columns = true; st.cols.splice(0).forEach((r) => r()) })
    expect(shownBy(a, b)).toEqual(['BBB', 'BBB'])
    await frame(t0 + 45)
    expect(cells()).toEqual([{ tf: 'intraday-other', store: 0, trigger: 'list-key', route: 'now', rth: 1, n: bucket(4) }])   // 40-50
  })

  it('deferred: a second press inside the burst is held by the settle rule first', async () => {
    const a = chart(1, '30')
    const b = chart(2, '60')
    const { list } = mount([a, b], { settle: { debounceMs: 90, isWarm: () => false } })
    let t0 = press(list, 'BBB')                              // after a quiet spell: decided in the press
    await frame(t0 + 10)
    act(() => { vi.advanceTimersByTime(40) })
    t0 = press(list, 'CCC')                                  // 40 ms later and not warm
    expect(shownBy(a, b)).toEqual(['BBB', 'BBB'])
    await act(async () => { vi.advanceTimersByTime(BURST_SETTLE_MS + 1) })
    expect(shownBy(a, b)).toEqual(['CCC', 'CCC'])
    await frame(t0 + 160)
    expect(cells().map((c) => [c.route, c.n.indexOf(1)]).sort()).toEqual([['decision', 0], ['deferred', 8]])   // 150-250
  })

  it('daily-hold: a D/W/M chart had to promote its set first', async () => {
    const a = chart(1, 'D')
    const b = chart(2, 'W')
    const { list } = mount([a, b])
    st.holds = false
    const t0 = press(list, 'BBB')
    expect(shownBy(a, b)).toEqual(['AAA', 'AAA'])
    await act(async () => { st.holds = true; Object.values(st.daily).forEach((r) => r('current')) })
    expect(shownBy(a, b)).toEqual(['BBB', 'BBB'])
    await frame(t0 + 180)
    expect(cells()).toEqual([{ tf: 'daily-plus', store: 0, trigger: 'list-key', route: 'daily-hold', rth: 1, n: bucket(8) }])
  })

  it('prepare: an intraday chart had to wait for its rows; the group is as slow as its slowest chart', async () => {
    const a = chart(1, '30')
    const b = chart(2, '60')
    const { list } = mount([a, b])
    st.ready['60'] = false
    const t0 = press(list, 'BBB')
    expect(shownBy(a, b)).toEqual(['AAA', 'AAA'])            // the ready 30m chart waits for its sibling
    await act(async () => { st.ready['60'] = true; st.prep['60']('current') })
    expect(shownBy(a, b)).toEqual(['BBB', 'BBB'])
    await frame(t0 + 300)
    expect(cells()).toEqual([{ tf: 'intraday-other', store: 0, trigger: 'list-key', route: 'prepare', rth: 1, n: bucket(9) }])   // 250-500
  })

  it('other: a member that paints itself and reports no route (the group\'s own member API)', async () => {
    const { list } = mount([])
    const key = {}
    const off = registerMember(scope, G, 'controller', { key, tf: () => '30', canShowNow: () => false, showDecided: () => {} })
    const t0 = press(list, 'BBB')
    recordPaint('BBB', '30', 100, 'full', key)
    await frame(t0 + 70)
    off()
    expect(cells()).toEqual([{ tf: 'intraday-other', store: 0, trigger: 'list-key', route: 'other', rth: 1, n: bucket(6) }])   // 66-100
  })
})

describe('a switch that never completes', () => {
  it('⭐ replaced by the next press before it could be shown: one `superseded`, and only the landing switch is a sample', async () => {
    const a = chart(1, '30')
    const b = chart(2, '60')
    const { list } = mount([a, b])
    st.ready['60'] = false                                   // nothing can be shown yet
    press(list, 'BBB')
    const t1 = press(list, 'CCC')
    expect(shownBy(a, b)).toEqual(['AAA', 'AAA'])
    await act(async () => { st.ready['60'] = true; st.prep['60']('current') })
    expect(shownBy(a, b)).toEqual(['CCC', 'CCC'])            // BBB was never on screen
    await frame(t1 + 90)
    expect(total()).toBe(1)
    expect(cells().map((c) => c.n.indexOf(1))).toEqual([6])
    expect(counters()).toMatchObject({ superseded: 1, unpressed: 0 })
    expect(await frame(t1 + 900)).toBe(0)
    expect(total()).toBe(1)
  })

  it('...and one whose charts HAD drawn, when the next key came before its frame', async () => {
    const a = chart(1, '30')
    const b = chart(2, '60')
    const { list } = mount([a, b])
    press(list, 'BBB')
    await act(async () => {})
    expect(frames).toHaveLength(1)                           // BBB drew on both charts; its frame has not run
    const t1 = press(list, 'CCC')
    await frame(t1 + 14)
    expect(cells().map((c) => c.n)).toEqual([bucket(0)])     // CCC's 14 ms, and nothing of BBB
    expect(counters()).toMatchObject({ superseded: 1 })
  })
})

describe('what leaves the page', () => {
  it('⭐ nothing the page holds is in it: whole numbers, and three fixed words beside them', async () => {
    // a ticker spelled nowhere in this file (built from character codes), so only the PAGE can put it in the report
    const needle = String.fromCharCode(90, 81, 88, 74, 75, 87)
    const a = chart(1, '30')
    const b = chart(2, '60')
    const { list, row, search } = mount([a, b])
    document.title = needle
    list.setAttribute('aria-label', needle)
    row.textContent = needle
    search.value = needle
    let t0 = press(list, needle)                             // the list walks onto it
    await frame(t0 + 10)
    t0 = press(row, `${needle}.A`, 'click')                  // a row that spells it is clicked
    await frame(t0 + 30)
    t0 = press(search, `${needle}.B`, 'Enter')               // it is typed and entered
    await frame(t0 + 60)
    expect(shownBy(a, b)).toEqual([`${needle}.B`, `${needle}.B`])
    expect(total()).toBe(3)
    // control: the page does hold it, and this check can see it
    expect(document.documentElement.outerHTML).toContain(needle)
    expect(JSON.stringify({ sym: a.shown })).toContain(needle)
    expect(JSON.stringify(peekSwitchCounts())).not.toContain(needle)

    // ...and the report the beacon builds, as the door receives it
    const listeners = {}
    const sent = []
    const win = {
      location: { pathname: `/charts/${needle}`, origin: 'https://uctintelligence.com' },
      navigator: { sendBeacon: (url, blob) => { sent.push(blob); return true } },
      PerformanceObserver: class { observe() {} disconnect() {} },
      setTimeout: () => 0,
      clearTimeout: () => {},
      addEventListener: (t, fn) => { listeners[t] = fn },
      removeEventListener: () => {},
      [SWITCH_SPEED_GLOBAL]: window[SWITCH_SPEED_GLOBAL],    // the instrument, where it left itself
    }
    const doc = { visibilityState: 'hidden', addEventListener: (t, fn) => { listeners[`doc:${t}`] = fn }, removeEventListener: () => {} }
    startPerfBeacon({ win, doc, perf: { now: () => 1000, getEntriesByType: () => [] }, desktop: true })
    listeners['doc:visibilitychange']()
    const bodies = await Promise.all(sent.map((blob) => blob.text()))
    expect(bodies).toHaveLength(2)                           // the page-load report, and the switches report
    for (const text of bodies) expect(text).not.toContain(needle)
    const report = JSON.parse(bodies[1])
    expect(Object.keys(report).sort()).toEqual(['client', 'kind', 'page', 'switches'])
    expect([report.page, report.client, report.kind]).toEqual(['/charts', 'desktop', 'switches'])
    const leaves = (v) => (v && typeof v === 'object' ? Object.values(v).flatMap(leaves) : [v])
    expect(leaves(report.switches).filter((v) => !Number.isInteger(v))).toEqual([])
    expect(report.switches.cells.map(named).map((c) => c.trigger).sort()).toEqual(['list-click', 'list-key', 'typed'])
    expect(peekSwitchCounts()).toBeNull()                    // sent once: the instrument starts again from nothing
  })
})
