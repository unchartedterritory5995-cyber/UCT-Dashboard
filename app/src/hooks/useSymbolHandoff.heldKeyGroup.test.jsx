// ⛔⛔ GATE 6 ON A HELD KEY (2026-11-21). A linked group shows all its charts in one frame or none: on single
// presses that held (192 of 192 measured), on a HELD arrow it did not. Three recorded held-key runs (D + 30m, 30
// keys; D:/uct-history imperative-ab-20261121/held-on.json, devgates-20261121/held-onA.json and held-onB.json):
// the 30m chart painted, ALONE, the row the PREVIOUS key asked for, in the frame of the NEXT key, 10 + 13 + 10
// times (33 of 33 such paints: the symbol one key back); on the landing row of two of the three it painted the
// row before the landing (AVGO, 304.17) 12.7 / 23.8 ms after the last key while the daily chart was still on
// the symbol the hold started from, and the landing row (STX) reached both only 267 / 414 ms after the key.
//
// THE CAUSE, both halves reproduced here with the real useSymbolHandoff + handoffGroups:
//   A. the round's LEAVE. A member that is ready waits for its sibling (right). The next key makes every member
//      leave that round in ONE commit, one after the other (layout cleanups, in tree order). The first to leave
//      (the daily chart: first in the tree, never ready inside a 33 ms gap) found "the siblings left are all
//      ready" and showed them: the 30m chart, which was about to leave in the same commit.
//   B. a request that is left stayed CURRENT until the next request RAN, and inside a burst the next request
//      waits BURST_SETTLE_MS first: a late answer of the superseded one (its panes' columns) showed it, alone.
//
// Two charts in one tree as on the board (the daily one FIRST: the existing round test had the ready chart first,
// which is the one order that cannot show this). Every task is a frame the browser may paint: the pair on screen
// is sampled after every key and after every millisecond.
import { render, act } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../components/chart/barStoreSwitch', () => ({ BARSTORE: true }))
/** The daily chart's rows answer this long after its switch starts; the 30m chart's rows are in memory. */
const DAILY_MS = 150
const st = { daily: [], answeredAt: new Map(), held: new Set(), colsPending: new Set(), cols: new Map() }
vi.mock('../data/barStore/prefetch', () => ({
  peekDisplayable: () => true,                                  // every 30m row is warm (a watchlist's neighbours)
  lakePending: () => false,
  deepPending: () => false,
  holdsBars: (sym, tf) => st.held.has(`${sym}|${tf}`),          // no daily set held: the bounded daily hold
  heldRows: () => 0,
  prepareForDisplay: () => new Promise(() => {}),
  prepareDailyForDisplay: (sym, tf) => new Promise((r) => { st.daily.push({ key: `${sym}|${tf}`, at: Date.now(), r }) }),
  prefetchBarsToIDB: () => {},
}))
vi.mock('../utils/prefetchBars', () => ({ prefetchBarsToIDB: () => {}, prepareForDisplay: () => new Promise(() => {}), prepareDailyForDisplay: () => new Promise(() => {}) }))
vi.mock('../utils/barsMemCache', () => ({ memPeek: () => null }))
vi.mock('../components/chart/engine/serverCompute', () => ({
  columnsReadyFor: (sym, tf) => !st.colsPending.has(`${sym}|${tf}`),
  whenColumnsReady: (sym, tf) => new Promise((r) => { st.cols.set(`${sym}|${tf}`, r) }),
  warmColumnsFor: () => {},
}))

import useSymbolHandoff from './useSymbolHandoff'
import { beginGroupSwitch, __resetHandoffGroupsForTests, __resetScopeForTests } from './handoffGroups'
import { BURST_SETTLE_MS, QUIET_MS } from './useSymbolSettle'

const G = 'charts:A'
const SETTLE = { debounceMs: 90, isWarm: () => true }           // ChartWidget's settle rule, rows warm
const KEY_MS = 33                                               // a held arrow's repeat
let scope
let screen       // what each chart shows now (written at its commit)
let commits      // commits per chart
let frames       // { t, D, M, req }: the pair on screen after each task, and the group's request then
let t0

beforeEach(() => {
  vi.useFakeTimers()
  st.daily = []; st.answeredAt = new Map(); st.held = new Set(); st.colsPending = new Set(); st.cols = new Map()
  __resetHandoffGroupsForTests()
  scope = { board: 1 }
  screen = {}; commits = { D: 0, M: 0 }; frames = []
  t0 = Date.now()
})
afterEach(() => { __resetScopeForTests(scope); vi.useRealTimers() })

function Chart({ name, tf, sym, group = G }) {
  const shown = useSymbolHandoff(sym, tf, { group, scope: group ? scope : null, settle: SETTLE })
  useLayoutEffect(() => { screen[name] = shown; commits[name] += 1 })
  return null
}
// the daily chart FIRST, as on the measured board (flip-chart, then flip-chart-2)
function Board({ sym, daily = true, tfD = 'D', group = G }) {
  return (
    <>
      {daily ? <Chart name="D" tf={tfD} sym={sym} group={group} /> : null}
      <Chart name="M" tf="30" sym={sym} group={group} />
    </>
  )
}
const frame = (req) => { frames.push({ t: Date.now() - t0, D: screen.D, M: screen.M, req }) }
/** every daily answer that is due lands now (a superseded request's answer lands late too, as a real one does) */
function answerDue() {
  for (const p of st.daily) {
    if (p.done || Date.now() - p.at < DAILY_MS) continue
    p.done = true
    st.answeredAt.set(p.key, Date.now() - t0)
    p.r('current')
  }
}
/** one key: the board's setGroupSym (the key press decides, then writes the symbol), one task */
async function press(view, sym, props = {}) {
  await act(async () => { beginGroupSwitch(scope, G, sym); view.rerender(<Board sym={sym} {...props} />) })
  frame(sym)
}
/** `ms` of 1 ms tasks, the screen sampled after each */
async function wait(ms, req) {
  for (let i = 0; i < ms; i++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(1); answerDue() })
    frame(req)
  }
}
async function mount(props = {}) {
  const view = render(<Board sym="AAA" {...props} />)
  await wait(QUIET_MS + 30, 'AAA')                              // a quiet spell: the first key is not in a burst
  frames.length = 0
  commits.D = 0; commits.M = 0
  return view
}
/** frames with the two charts apart */
const split = () => frames.filter((f) => f.D !== f.M)
/** frames in which a chart changed to something that is not the group's request at that moment */
const superseded = () => frames.filter((f, i) => i > 0 && ['D', 'M'].some((c) => f[c] !== frames[i - 1][c] && f[c] !== f.req))
const ROWS = Array.from({ length: 30 }, (_, i) => `R${String(i + 1).padStart(2, '0')}`)

describe('a held key obeys gate 6 at every paint', () => {
  it('30 keys 33 ms apart, then a rest: no chart ever paints a row its sibling is not painting, and the landing row shows on both the moment the slower one is ready', async () => {
    const view = await mount()
    for (const sym of ROWS) { await press(view, sym); await wait(KEY_MS - 1, sym) }
    const LAND = ROWS[ROWS.length - 1]
    const lastKeyAt = frames[frames.length - KEY_MS].t
    await wait(600, LAND)

    expect(split().map((f) => `${f.t}ms ${f.D}/${f.M} (asked ${f.req})`)).toEqual([])
    expect(superseded().map((f) => `${f.t}ms ${f.D}/${f.M} (asked ${f.req})`)).toEqual([])
    // the landing: both charts, one frame, at the daily chart's answer (not at a timeout after it)
    const first = frames.find((f) => f.D === LAND || f.M === LAND)
    expect(first).toBeTruthy()
    expect([first.D, first.M]).toEqual([LAND, LAND])
    expect(first.t).toBe(st.answeredAt.get(`${LAND}|D`))
    expect(first.t - lastKeyAt).toBeLessThanOrEqual(BURST_SETTLE_MS + DAILY_MS)
    expect([screen.D, screen.M]).toEqual([LAND, LAND])
  }, 60000)

  it('a superseded request never shows late: its panes\' columns land after the next key, and nothing paints it', async () => {
    const view = await mount()
    st.colsPending.add('R01|30')                                // the 30m chart's columns for R01 are still due
    await press(view, 'R01')
    await wait(KEY_MS - 1, 'R01')
    await press(view, 'R02')                                    // inside the burst: R02 waits BURST_SETTLE_MS before it runs
    await wait(10, 'R02')
    await act(async () => { st.colsPending.delete('R01|30'); st.cols.get('R01|30')(true) })   // R01's columns land now
    frame('R02')
    await wait(400, 'R02')

    expect(split().map((f) => `${f.t}ms ${f.D}/${f.M} (asked ${f.req})`)).toEqual([])
    expect(frames.some((f) => f.D === 'R01' || f.M === 'R01')).toBe(false)
    expect([screen.D, screen.M]).toEqual(['R02', 'R02'])
  }, 30000)

  it('...nor on a chart with no group (the same late answer, the same burst)', async () => {
    const view = render(<Board sym="AAA" daily={false} group={null} />)
    await wait(QUIET_MS + 30, 'AAA')
    frames.length = 0
    const key = async (sym) => { await act(async () => { view.rerender(<Board sym={sym} daily={false} group={null} />) }); frame(sym) }
    st.colsPending.add('R01|30')
    await key('R01')
    await wait(KEY_MS - 1, 'R01')
    const r02At = Date.now() - t0
    await key('R02')
    await wait(10, 'R02')
    await act(async () => { st.colsPending.delete('R01|30'); st.cols.get('R01|30')(true) })
    frame('R02')
    await wait(200, 'R02')

    expect(frames.some((f) => f.M === 'R01')).toBe(false)       // the request it left never reaches the screen
    expect(frames.find((f) => f.M === 'R02').t).toBe(r02At + BURST_SETTLE_MS)   // (the settle rule's own wait, unchanged)
  }, 30000)

  it('a member whose timeframe changes while its sibling waits does not let the sibling show alone', async () => {
    const view = await mount()
    await press(view, 'R01')
    await wait(10, 'R01')                                       // the 30m chart is ready and waiting; the daily one is not
    await act(async () => { view.rerender(<Board sym="R01" tfD="W" />) })
    frame('R01')
    await wait(400, 'R01')

    expect(split().map((f) => `${f.t}ms ${f.D}/${f.M}`)).toEqual([])
    expect([screen.D, screen.M]).toEqual(['R01', 'R01'])
  }, 30000)
})

describe('what must not change', () => {
  it('a chart that leaves the board never holds the others: its ready sibling shows in that task', async () => {
    const view = await mount()
    await press(view, 'R01')
    await wait(10, 'R01')
    expect(screen.M).toBe('AAA')                                // ready, waiting for the daily chart
    await act(async () => { view.rerender(<Board sym="R01" daily={false} />) })   // the daily chart is closed
    expect(screen.M).toBe('R01')
  })

  it('a single press on rows both charts hold: decided in the key press, one commit each, one frame', async () => {
    const view = await mount()
    st.held.add('BBB|D')
    await press(view, 'BBB')
    expect(frames[0]).toMatchObject({ D: 'BBB', M: 'BBB' })
    expect(commits).toEqual({ D: 1, M: 1 })
    await wait(300, 'BBB')
    expect(commits).toEqual({ D: 1, M: 1 })
    expect(split()).toEqual([])
  })

  it('a single press with a slower daily chart: the 30m chart waits, both show in the frame the daily one is ready', async () => {
    const view = await mount()
    await press(view, 'BBB')
    await wait(300, 'BBB')
    const first = frames.find((f) => f.D === 'BBB' || f.M === 'BBB')
    expect([first.D, first.M, first.t]).toEqual(['BBB', 'BBB', st.answeredAt.get('BBB|D')])
    expect(split()).toEqual([])
  })

  it('keys slower than the daily answer: every row paints, on both charts in one frame (an intermediate row may paint, never on one chart)', async () => {
    const view = await mount()
    const rows = ROWS.slice(0, 4)
    for (const sym of rows) { await press(view, sym); await wait(299, sym) }
    expect(split().map((f) => `${f.t}ms ${f.D}/${f.M}`)).toEqual([])
    expect(superseded()).toEqual([])
    expect([...new Set(frames.map((f) => f.D))].filter((s) => s !== 'AAA')).toEqual(rows)
    expect([...new Set(frames.map((f) => f.M))].filter((s) => s !== 'AAA')).toEqual(rows)
  }, 30000)
})
