// app/src/components/chart/engine/runtime/__tests__/fillInlineSides.test.js
//
// ─── ⭐⭐ ENGINE 84 (CO-3) — `fill(plot(a), plot(b))`: A SIDE WRITTEN AS THE PLOT ITSELF ───────────
//
// The Pine v6 User Manual, *Fills*: `fill`'s `plot1` / `plot2` and `hline1` / `hline2` take the IDs `plot()` and
// `hline()` calls return, and one call takes two plot IDs or two hline IDs, never one of each. The runtime lane read a
// side only as a NAME bound to a plot (`p1 = plot(a)`), so the inline form was refused `runtime:fill-target`
// ("argument 1 of `fill()` is not a plot"). An argument is its value: the inline form is the bound form, so it must
// produce the same outputs, in the same order, with the same descriptors and the same columns, bar for bar.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 30
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + (i % 7), h: 108 + (i % 5), l: 92 - (i % 3), c: 100 + ((i * 3) % 11), v: 1000 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const HEAD = '//@version=5\nindicator("t", overlay=true)\n'

const build = (src) => buildRuntimeIr(src, { bars: BARS, inputs: {} })
function run(src) {
  const b = build(src)
  if (!b.ok) throw new Error(`refused ${b.refusal.guard}: ${b.refusal.message}`)
  const program = lowerIrProgram(b.ir, { historyFromListing: true })
  const outs = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true }).outputs.map((o) => Array.from(o))
  const descriptors = b.ir.outputs.map((o) => ({ call: o.call, upper: o.upper, lower: o.lower, gradient: !!o.gradient, hidden: !!o.hidden }))
  return { outs, descriptors }
}
const same = (a, b) => a.length === b.length && a.every((x, i) => (Number.isNaN(x) && Number.isNaN(b[i])) || x === b[i])
const sameRun = (a, b) => {
  expect(a.descriptors).toEqual(b.descriptors)
  expect(a.outs.length).toBe(b.outs.length)
  a.outs.forEach((o, k) => expect(same(o, b.outs[k]), `output ${k}`).toBe(true))
}

const PAIRS = {
  'two inline plots': [
    'fill(plot(high), plot(low), color=color.new(color.blue, 80))\n',
    'p1 = plot(high)\np2 = plot(low)\nfill(p1, p2, color=color.new(color.blue, 80))\n'],
  'inline plots with their own arguments, and a colour by position': [
    'fill(plot(high, "hi", color.red), plot(low, "lo", color.green), color.new(color.gray, 70))\n',
    'p1 = plot(high, "hi", color.red)\np2 = plot(low, "lo", color.green)\nfill(p1, p2, color.new(color.gray, 70))\n'],
  'one inline side, one bound': [
    'p1 = plot(high)\nfill(p1, plot(low), color=color.new(color.blue, 80))\n',
    'p1 = plot(high)\np2 = plot(low)\nfill(p1, p2, color=color.new(color.blue, 80))\n'],
  'two inline hlines': [
    'fill(hline(70), hline(30), color=color.new(color.purple, 90))\n',
    'h1 = hline(70)\nh2 = hline(30)\nfill(h1, h2, color=color.new(color.purple, 90))\n'],
  'a hidden fill (`color = na`)': [
    'fill(plot(high), plot(low), color=na)\n',
    'p1 = plot(high)\np2 = plot(low)\nfill(p1, p2, color=na)\n'],
  'plots after the fill keep their place': [
    'fill(plot(high), plot(low), color=color.new(color.blue, 80))\nplot(close)\n',
    'p1 = plot(high)\np2 = plot(low)\nfill(p1, p2, color=color.new(color.blue, 80))\nplot(close)\n'],
}

describe('CO-3 — `fill(plot(a), plot(b))` is the bound form, output for output', () => {
  for (const [what, [inline, bound]] of Object.entries(PAIRS)) {
    it(what, () => {
      const a = run(`${HEAD}${inline}`)
      const b = run(`${HEAD}${bound}`)
      sameRun(a, b)
      // ⛔ non-vacuous: a fill descriptor that spans two outputs
      const fill = a.descriptors.find((d) => d.call === 'fill')
      expect(fill && Number.isInteger(fill.upper) && Number.isInteger(fill.lower) && fill.upper !== fill.lower).toBe(true)
    })
  }
})

describe('CO-3 — what stays refused, by name', () => {
  it('an inline plot beside an inline hline (the Manual: two plot IDs or two hline IDs, never one of each)', () => {
    const r = build(`${HEAD}fill(plot(high), hline(30), color=color.blue)\n`)
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:fill-target')
    expect(r.refusal.message).toMatch(/never one of each/)
  })
  it('an inline call that returns no fill ID (`plotshape`) is still not a plot', () => {
    const r = build(`${HEAD}p2 = plot(low)\nfill(plotshape(high), p2, color=color.blue)\n`)
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:fill-target')
    expect(r.refusal.message).toMatch(/argument 1 of `fill\(\)` is not a plot/)
  })
  it('a series that is not a plot ID is still not a plot', () => {
    const r = build(`${HEAD}fill(high, low, color=color.blue)\n`)
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:fill-target')
  })
})
