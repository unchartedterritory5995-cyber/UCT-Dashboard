// app/src/components/chart/engine/runtime/__tests__/runtimeWarmupDrawings.test.js
//
// ⭐⭐⭐ UIE PHASE 3 (M3A) — A LISTING DOCUMENT'S OWN DRAWINGS ON A CHART THAT DOES NOT
// START AT THE LISTING (`warmupDrawings.js`, `runtimeColumns.js::computeOffListing`).
//
// The proof that matters is the plots' one: what is DRAWN on the short chart EQUALS what
// a run from the listing draws (the same drawings, every property, each bar-index
// coordinate in chart bars). And every drawing whose picture depends on where the chart
// starts — a `var` line anchored on the first bar, a label reading `bar_index` — keeps
// the whole picture withheld, by name, with the reason.
import { describe, it, expect } from 'vitest'
import { computeRuntimeColumns, runtimeWarmupOf, RUNTIME_HISTORY_GUARD } from '../runtimeColumns.js'
import { runtimeObjectsOf, runtimeObjectsWithheldOf } from '../runtimeObjects.js'
import { sameDrawings } from '../warmupDrawings.js'

const FULL = 6000
const N = 3000
const bars = Array.from({ length: FULL }, (_, i) => {
  const c = 100 + 12 * Math.sin(i / 17) + 4 * Math.sin(i / 5.3) + i * 0.01
  return { t: 1500000000 + i * 86400, o: c - 0.3, h: c + 1.1, l: c - 0.9, c, v: 1000 + (i % 29) * 7 }
})
const WINDOW = bars.slice(FULL - N)
const doc = (body) => ({
  id: 'w', meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: 'runtime:w', outputs: { v: 0 }, objects: true,
    source: `//@version=6\nindicator("w", overlay = true)\nplot(ta.ema(close, 10))\n${body}` },
})
const D = { tf: 'D', newestBarIsForming: false }

/** the short chart's drawings, and the run from the listing's */
function drawn(body, ctx = D) {
  const d = doc(body)
  const truth = computeRuntimeColumns(d, bars, { ...ctx, historyFromListing: true })
  const got = computeRuntimeColumns(d, WINDOW, ctx)
  return { truth: runtimeObjectsOf(truth), got: runtimeObjectsOf(got), withheld: runtimeObjectsWithheldOf(got),
    warmup: runtimeWarmupOf(got) }
}

const SAME = {
  // ⚠️ NOT "every crossover, the collector keeping 50": Pine's collector is BATCHED (it
  // lets 5 past the cap, then collects back to it), so how many survive depends on how
  // many were ever made — on where the chart starts — and that picture is rightly
  // withheld (below)
  'labels at crossovers, the script keeping its newest 5':
    'var a = array.new<label>()\nif ta.crossover(close, ta.sma(close, 20))\n    array.push(a, label.new(bar_index, high, "x", style = label.style_label_down))\n'
    + '    if array.size(a) > 5\n        label.delete(array.shift(a))\n',
  'a box redrawn at each new 10-bar high, the old one deleted':
    'var box b = na\nif high == ta.highest(high, 10)\n    box.delete(b)\n    b := box.new(bar_index - 5, high, bar_index, low, text = "zone")\n',
  'two lines and the fill between them, rebuilt every bar':
    'var line a = na\nvar line c = na\nvar linefill f = na\nline.delete(a)\nline.delete(c)\nlinefill.delete(f)\n'
    + 'a := line.new(bar_index - 10, ta.highest(high, 10), bar_index, ta.highest(high, 10), style = line.style_arrow_right)\n'
    + 'c := line.new(bar_index - 10, ta.lowest(low, 10), bar_index, ta.lowest(low, 10))\n'
    + 'f := linefill.new(a, c, color.new(color.blue, 80))\n',
  'a dashboard table of the last RSI':
    'var t = table.new(position.top_right, 1, 1)\nr = ta.rsi(close, 14)\nif barstate.islast\n    table.cell(t, 0, 0, str.tostring(math.round(r)))\n',
}

describe('⭐⭐ drawn off the listing when two starts end with the same picture — and it EQUALS the run from the listing', () => {
  for (const [name, body] of Object.entries(SAME)) {
    it(name, () => {
      const r = drawn(body)
      expect(r.withheld, r.withheld && r.withheld.reason).toBeNull()
      expect(r.warmup.drawings).toBe('same-from-two-starts')
      expect(r.got.live.length).toBeGreaterThan(0)
      // the short chart's bar k is the listing run's bar k + (FULL - N)
      expect(sameDrawings(r.truth.live, r.got.live, FULL - N)).toEqual({ same: true })
    })
  }

  it('a forming last bar: the same verdict', () => {
    const r = drawn(SAME['labels at crossovers, the script keeping its newest 5'], { tf: 'D', newestBarIsForming: true })
    expect(r.withheld).toBeNull()
  })

  it('deterministic: the same window twice draws the same drawings, ids included', () => {
    const a = drawn(SAME['two lines and the fill between them, rebuilt every bar']).got.live
    const b = drawn(SAME['two lines and the fill between them, rebuilt every bar']).got.live
    expect(b).toEqual(a)
  })
})

describe('⛔ a picture that depends on where the chart starts: every drawing withheld, by name, with why', () => {
  const WITHHELD = {
    'a var line anchored on the first bar': ['var line l = line.new(bar_index, close, bar_index, close)\nline.set_xy2(l, bar_index, close)\n', 'x1'],
    'a label reading bar_index': ['if barstate.islast\n    label.new(bar_index, high, str.tostring(bar_index))\n', 'text'],
    'labels on every 50th bar (counted from the first)': ['if bar_index % 50 == 0\n    label.new(bar_index, high, "x")\n', null],
    'every crossover labelled, the batched collector keeping ~50': ['if ta.crossover(close, ta.sma(close, 20))\n    label.new(bar_index, high, "x")\n', 'drawings and the other'],
  }
  for (const [name, [body, prop]] of Object.entries(WITHHELD)) {
    it(name, () => {
      const r = drawn(body)
      expect(r.got).toBeNull()
      expect(r.withheld.guard).toBe(RUNTIME_HISTORY_GUARD)
      expect(r.withheld.reason).toMatch(/run from two different first bars/)
      if (prop) expect(r.withheld.reason).toContain(prop)
      expect(r.warmup.withheldBars).toBeGreaterThan(0)   // its plots are still drawn
    })
  }

  it('the check can be switched off: the old withholding', () => {
    const d = doc(SAME['labels at crossovers, the script keeping its newest 5'])
    const got = computeRuntimeColumns(d, WINDOW, D, { warmupDrawings: false })
    expect(runtimeObjectsWithheldOf(got).guard).toBe(RUNTIME_HISTORY_GUARD)
  })
})

describe('sameDrawings', () => {
  const line = (id, x1, x2, extra = {}) => ({ family: 'line', id, createdBar: x2, props: { x1, y1: 1, x2, y2: 2, ...extra } })
  it('bar-index coordinates in chart bars; bar_time ones as they are; ids by position', () => {
    expect(sameDrawings([line(1, 300, 310)], [line(7, 50, 60)], 250)).toEqual({ same: true })
    expect(sameDrawings([line(1, 300, 310)], [line(7, 50, 61)], 250).same).toBe(false)
    const t = { xloc: 'bar_time' }
    expect(sameDrawings([line(1, 5e11, 6e11, t)], [line(2, 5e11, 6e11, t)], 250)).toEqual({ same: true })
    expect(sameDrawings([line(1, 5e11, 6e11, t)], [line(2, 5e11 - 250, 6e11 - 250, t)], 250).same).toBe(false)
    const fill = (id, a, b) => ({ family: 'linefill', id, props: { line1: { __ref: a }, line2: { __ref: b }, color: '#f00' } })
    expect(sameDrawings([line(1, 300, 310), line(2, 300, 310), fill(3, 1, 2)],
      [line(8, 50, 60), line(9, 50, 60), fill(10, 8, 9)], 250)).toEqual({ same: true })
    expect(sameDrawings([line(1, 300, 310), line(2, 300, 310), fill(3, 1, 2)],
      [line(8, 50, 60), line(9, 50, 60), fill(10, 9, 8)], 250).same).toBe(false)
  })
  it('one drawing more, or one property different, is a different picture', () => {
    expect(sameDrawings([line(1, 300, 310)], [], 250).same).toBe(false)
    expect(sameDrawings([line(1, 300, 310, { color: '#f00' })], [line(1, 50, 60, { color: '#0f0' })], 250).why).toMatch(/color/)
  })
})
