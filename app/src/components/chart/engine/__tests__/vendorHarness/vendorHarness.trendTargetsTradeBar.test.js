// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.trendTargetsTradeBar.test.js
//
// ─── ⭐⭐ THE LAST TRADE STANDS ON THE BAR THAT OPENED IT — held against two live captures ──
//
// `trend-targets-algoalpha` draws one trade at a time: on `ta.crossunder(trend, 0)` (or
// `crossover`) it makes five lines and five labels and deletes the previous trade's
// (`line.delete(entry_line[1])`), and on every other bar it moves their right ends. `trend`
// is a `var` latch flipped by `ta.crossunder(tL, tL[1])`, and `tL` smooths a supertrend whose
// two bands are recurrences of their own.
//
// ⚰️ TradingView, NYSE:RDDT 1D from the listing (666 bars, captured 2026-11-15), draws the
// last trade at bar 653 ("Entry ▸ 134.70"). The runtime pane drew it at bar 656
// ("Entry ▸ 90.97", SL 143.72) while every plot, the trend-change shapes included, agreed bar
// for bar. Not the `line.delete(x[1])` / `set_x2` blocks: the PER-BAR RUN draws this trade at
// 653 too. The runtime document carries the HOST'S object program (its `str.tostring(…,
// format.mintick)` texts keep the run from owning its drawings), and that program's guards are
// trees the columnar evaluator runs. The document was minted without the Pine door's stamps
// (`meta.recurrenceOrigin`, …), so `objectReaderFor` evaluated every `var` in those trees as a
// 250-bar window re-seeded on each bar, from the listing as off it, with nothing withheld:
// the windowed `shortSignal` fired on 432 and 656, never on 653, and the windowed
// `longSignal` missed 310. ⭐ The fix is the door writing the same stamps on both documents
// (`memberPaneDefinition.js::pineTreeStamps`).
//
// ⛔ The control below is what makes this a measurement: the SAME document with the stamps
// removed still draws the trade at 656, and the vendor's own bar colours (its `trend`) put
// the flip at 653. SPY 1D (8,507 bars from the listing) MATCHED before and after: there the
// window reached back far enough for this trade, which is why one capture was not enough.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { gradeCapture, loadCapture, HARNESS_DIR } from './harness'
import { enterMemberDoor, HARNESS_DEF_ID, toProductBars } from './ourSide'
import { objectReaderFor } from '../../objectColumns'
import * as registry from '../../nativeRegistry'
import { pineTreeStamps } from '../../../builder/memberPane/memberPaneDefinition'

afterEach(() => { vi.unstubAllEnvs() })

const T = 600000
const RDDT = 'trend-targets-algoalpha-rddt-1d-2026-11-15'
const SPY = 'trend-targets-algoalpha-spy-1d-2026-11-15'
const STAMP_KEYS = ['recurrenceOrigin', 'pineVersion', 'doorVersion', 'naConditionFalse']

const lanesOn = () => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
}
const capOf = (id) => {
  const cap = loadCapture(path.join(HARNESS_DIR, `${id}.json`)).capture
  expect(cap, `${id} is a v1 capture`).toBeTruthy()
  return cap
}
const graded = new Map()
const gradeOf = (id) => {
  if (!graded.has(id)) {
    lanesOn()
    graded.set(id, gradeCapture(capOf(id)))
    vi.unstubAllEnvs()
  }
  return graded.get(id)
}

/** The vendor's lines and labels at chart bar indices (`objects.xIndex`: an object x is a
 *  rank into `indexes`, each a model bar index; the chart bar is that minus the first). */
function vendorTrade(cap) {
  const xi = cap.objects.xIndex
  const bar = (x) => xi.indexes[x] - xi.modelBars.first
  const r = cap.objects.records
  return {
    lines: r.lines.map((l) => ({ x1: bar(l.x1), x2: bar(l.x2), y: l.y1 })).sort((a, b) => a.y - b.y),
    labels: r.labels.map((l) => ({ x: bar(l.x), y: l.y, text: l.t })).sort((a, b) => a.y - b.y),
  }
}
function ourTrade(ours) {
  const held = ours.objects.held
  return {
    lines: held.filter((o) => o.family === 'line')
      .map((o) => ({ x1: o.props.x1, x2: o.props.x2, y: o.props.y1, bar: o.createdBar })).sort((a, b) => a.y - b.y),
    labels: held.filter((o) => o.family === 'label')
      .map((o) => ({ x: o.props.x, y: o.props.y, text: o.props.text })).sort((a, b) => a.y - b.y),
  }
}
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))

/** The bars the vendor's `trend` flips on, read off its own bar colour (plot_6). */
function vendorFlips(cap) {
  const k = cap.plotValues.fields.indexOf('plot_6')
  const col = cap.plotValues.rows.map((r) => r[k])
  // the bullish colour is read off the capture's own first Bullish Trend Change shape
  // (plot_7), never assumed from which colour comes first
  const up = cap.plotValues.fields.indexOf('plot_7')
  const firstUp = cap.plotValues.rows.findIndex((r) => r[up] !== null)
  const G = col[firstUp]
  const longs = []
  const shorts = []
  for (let i = 1; i < col.length; i += 1) {
    if (col[i] === G && col[i - 1] !== G) longs.push(i)
    if (col[i] !== G && col[i - 1] === G) shorts.push(i)
  }
  return { longs, shorts }
}

describe('⭐⭐ trend-targets-algoalpha: the last trade is drawn on the bar TradingView draws it', () => {
  it('the captures are what this file says they are', () => {
    const r = capOf(RDDT)
    expect(r.symbol.pro_name).toBe('NYSE:RDDT')
    expect(r.bars.rows.length).toBe(666)
    expect(r.history.startsAtBar0).toBe(true)
    const v = vendorTrade(r)
    expect(v.lines.length).toBe(5)
    expect(new Set(v.lines.map((l) => l.x1))).toEqual(new Set([653]))
    expect(new Set(v.lines.map((l) => l.x2))).toEqual(new Set([705]))
    expect(v.labels.map((l) => l.text)).toContain('Entry ▸ 134.70')
    const s = capOf(SPY)
    expect(s.symbol.pro_name).toBe('AMEX:SPY')
    expect(s.bars.rows.length).toBe(8507)
  })

  it.each([[RDDT], [SPY]])('%s (runtime pane): every line and label at TradingView\'s bars, prices and texts', (id) => {
    const g = gradeOf(id)
    expect(g.ours.ok, g.ours.refusal).toBe(true)
    expect(g.ours.objects.ok, g.ours.objects.reason).toBe(true)
    const v = vendorTrade(capOf(id))
    const o = ourTrade(g.ours)
    expect(o.lines.length).toBe(v.lines.length)
    expect(o.labels.length).toBe(v.labels.length)
    v.lines.forEach((l, i) => {
      expect(o.lines[i].x1, `line ${i} x1`).toBe(l.x1)
      expect(o.lines[i].x2, `line ${i} x2`).toBe(l.x2)
      expect(close(o.lines[i].y, l.y), `line ${i} y ${o.lines[i].y} vs ${l.y}`).toBe(true)
    })
    v.labels.forEach((l, i) => {
      expect(o.labels[i].x, `label ${i} x`).toBe(l.x)
      expect(close(o.labels[i].y, l.y), `label ${i} y`).toBe(true)
      expect(o.labels[i].text).toBe(l.text)
    })
  }, T)

  it.each([[RDDT], [SPY]])('%s (runtime pane): the whole capture grades MATCH, objects included', (id) => {
    const { verdict } = gradeOf(id)
    expect(verdict.verdict, verdict.reason).toBe('MATCH')
    expect(verdict.objects.verdict, verdict.objects.reason).toBe('MATCH')
  }, T)

  it('⭐ the runtime document carries the host program WITH the Pine tree stamps, written by one function', () => {
    lanesOn()
    const door = enterMemberDoor(capOf(RDDT).source.text)
    try { registry.uninstallUserDefinition(HARNESS_DEF_ID) } catch { /* not installed */ }
    expect(door.built.ok, door.built.reason).toBe(true)
    expect(door.built.lane).toBe('runtime')
    const def = door.built.definition
    expect(def.compute.kind).toBe('runtime')
    expect((def.objects.ops || []).length).toBeGreaterThan(0)
    const want = pineTreeStamps(door.built.translation)
    expect(want.recurrenceOrigin).toBe(registry.PINE_RECURRENCE_ORIGIN)
    expect(want.pineVersion).toBe(6)
    expect(want.naConditionFalse).toBe(true)
    for (const k of STAMP_KEYS) expect(def.meta[k], `meta.${k}`).toEqual(want[k])
  })

  it('⛔ CONTROL: the same document WITHOUT the stamps opens the last short on 656, where TradingView\'s trend flips on 653', () => {
    lanesOn()
    const cap = capOf(RDDT)
    const door = enterMemberDoor(cap.source.text)
    try { registry.uninstallUserDefinition(HARNESS_DEF_ID) } catch { /* not installed */ }
    const def = door.def || door.built.definition
    // the short trade's entry line: the create drawn in the bearish colour
    const shortEntry = def.objects.ops.find((op) => op.k === 'create' && op.family === 'line'
      && op.props.color && op.props.color.node && op.props.color.node.hex === '#ff1100')
    expect(shortEntry && shortEntry.when.v).toBe('tree')
    const bars = toProductBars(cap)
    const ctx = { tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: false, historyFromListing: true }
    const onBars = (d) => {
      const reader = objectReaderFor(d, bars, ctx)
      const on = []
      for (let b = 0; b < bars.length; b += 1) {
        const v = reader.readNode(shortEntry.when.tree, b)
        if (v && !Number.isNaN(v)) on.push(b)
      }
      return on
    }
    const { shorts } = vendorFlips(cap)
    expect(shorts[shorts.length - 1]).toBe(653)
    const stamped = onBars(def)
    expect(stamped).toContain(653)
    expect(stamped).not.toContain(656)
    // every flip TradingView's colours show is a short this program opens (the first trend
    // may leave 0 for -1 before any colour changes, so the program may open one more)
    for (const b of shorts) expect(stamped).toContain(b)
    const bare = { ...def, meta: Object.fromEntries(Object.entries(def.meta).filter(([k]) => !STAMP_KEYS.includes(k))) }
    const windowed = onBars(bare)
    expect(windowed).toContain(656)
    expect(windowed).not.toContain(653)
  })
})
