// app/src/components/chart/engine/runtime/__tests__/rt5RuntimeObjects.test.js
//
// ─── RT5 — A RUN THAT KEEPS ITS OWN DRAWINGS ─────────────────────────────────
//
// The rails for the runtime lane's drawing store (`objectStore.js`), the
// drawing build (`buildRuntimeIr({objectsInRun})`) and its two refusals by
// name. Every rule carries a control that must come out the OTHER way, so a
// rail that answers the same thing for everything cannot pass.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 300
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 100 + 10 * Math.sin(i / 7) + i * 0.05
  return { t: 1700000000 + i * 86400, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 + (i % 13) * 10 }
})
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = (decl = '') => `//@version=6\nindicator("t", overlay = true${decl})\n`

const build = (src, decl) => buildRuntimeIr(head(decl) + src,
  { bars: BARS, inputs: {}, objectsInRun: true, tf: 'D', basePeriod: 'D' })

function run(src, decl) {
  const built = build(src, decl)
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const res = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
    barTimes: BARS.map((b) => b.t),
  })
  return { built, fin: res.objects.finish() }
}

const ofFamily = (fin, fam) => fin.live.filter((o) => o.family === fam)

describe('RT5 — the run keeps what its drawing calls make', () => {
  it('a drawing-only script lowers drawing ops and holds every label it made', () => {
    const { built, fin } = run('if bar_index % 10 == 0\n    label.new(bar_index, close, "x")\n')
    expect(built.diagnostics.objectOps).toBeGreaterThan(0)
    expect(fin.status).toBe('ok')
    const labels = ofFamily(fin, 'label')
    expect(labels).toHaveLength(30)
    // the label sits on the bar that made it, at that bar's close
    expect(labels[3].props.x).toBe(30)
    expect(labels[3].props.y).toBeCloseTo(BARS[30].c, 9)
  })

  it('the C7 collector: above cap + 5, the oldest go until cap remain', () => {
    // 30 creations, cap 5: trims at the 11th, 17th, 23rd and 29th → 5 + 1 held.
    const { fin } = run('if bar_index % 10 == 0\n    label.new(bar_index, close, str.tostring(bar_index))\n',
      ', max_labels_count = 5')
    const labels = ofFamily(fin, 'label')
    expect(labels.map((l) => l.props.x)).toEqual([240, 250, 260, 270, 280, 290])
    expect(labels.map((l) => l.props.text)).toEqual(['240', '250', '260', '270', '280', '290'])
  })

  it('control: the default capacity holds all thirty', () => {
    const { fin } = run('if bar_index % 10 == 0\n    label.new(bar_index, close, str.tostring(bar_index))\n')
    expect(ofFamily(fin, 'label')).toHaveLength(30)
  })

  it('a deleted line is gone; the one kept in a var survives', () => {
    const { fin } = run(
      'var line keep = na\n'
      + 'if bar_index == 5\n    keep := line.new(bar_index, close, bar_index + 1, close)\n'
      + 'l = line.new(bar_index, low, bar_index + 1, low)\n'
      + 'line.delete(l[1])\n')
    const lines = ofFamily(fin, 'line')
    // every per-bar line but the newest was deleted one bar later
    expect(lines.filter((x) => x.createdBar !== 5)).toHaveLength(1)
    expect(lines.some((x) => x.createdBar === 5 && x.props.x1 === 5)).toBe(true)
  })
})

describe('RT5 — conditional-call history refuses by name', () => {
  it('a ta call inside a block that does not run every bar refuses', () => {
    const r = build('if bar_index % 2 == 0\n    s = ta.sma(close, 3)\n    label.new(bar_index, s)\n')
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:conditional-history')
  })

  it('a function body with history refuses', () => {
    const r = build('f(x) =>\n    x[1]\nif bar_index % 2 == 0\n    label.new(bar_index, f(close))\n')
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:conditional-history')
  })

  it('control: the same function called on EVERY bar builds and reads the bar before', () => {
    const { fin } = run('f(x) =>\n    x[1]\nv = f(close)\nif bar_index % 10 == 0\n    label.new(bar_index, v)\n')
    const labels = ofFamily(fin, 'label')
    expect(labels[4].props.x).toBe(40)
    expect(labels[4].props.y).toBeCloseTo(BARS[39].c, 9)
  })

  it('control: a multi-line body with a ta call, called on every bar, builds', () => {
    const { fin } = run('g() =>\n    m = ta.sma(close, 4)\n    m\nv = g()\nif bar_index % 10 == 0\n    label.new(bar_index, v)\n')
    const labels = ofFamily(fin, 'label')
    const want = (BARS[47].c + BARS[48].c + BARS[49].c + BARS[50].c) / 4
    expect(labels[5].props.y).toBeCloseTo(want, 9)
  })

  it('control: bar_index[k] inside a global block is the chart\'s (A13, C06), and builds', () => {
    const { fin } = run('if bar_index % 10 == 0\n    label.new(bar_index[3], close)\n')
    expect(ofFamily(fin, 'label')[2].props.x).toBe(17)
  })

  it('control: the chart\'s own history inside a block is the chart\'s, and builds', () => {
    const { fin } = run('if bar_index % 10 == 0\n    label.new(bar_index, close[1])\n')
    const labels = ofFamily(fin, 'label')
    expect(labels[2].props.y).toBeCloseTo(BARS[19].c, 9)
  })

  it('control: a top-level stateful binding read in a block is evaluated on EVERY bar', () => {
    const { fin } = run('e = ta.ema(close, 5)\nif bar_index % 10 == 0\n    label.new(bar_index, e)\n')
    // the EMA over every bar, by hand
    const a = 2 / 6
    let ema = NaN
    const want = BARS.map((b, i) => {
      if (i < 4) return NaN
      if (i === 4) { ema = BARS.slice(0, 5).reduce((s, x) => s + x.c, 0) / 5; return ema }
      ema = a * b.c + (1 - a) * ema
      return ema
    })
    const labels = ofFamily(fin, 'label')
    expect(labels[5].props.x).toBe(50)
    expect(labels[5].props.y).toBeCloseTo(want[50], 9)
  })
})

describe('RT5 — a drawing call in one arm of ?: refuses by name', () => {
  it('refuses', () => {
    const r = build('l = bar_index % 10 == 0 ? label.new(bar_index, close) : na\n')
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:object-op')
    expect(r.refusal.message).toMatch(/\?:/)
  })

  it('control: the same drawing in an if builds and draws only on the taken bars', () => {
    const { fin } = run('if bar_index % 10 == 0\n    label.new(bar_index, close)\n')
    expect(ofFamily(fin, 'label')).toHaveLength(30)
  })
})

describe('RT5 — a comma line of statements is split, as the host lane splits it', () => {
  it('`label.delete(a[1]), label.delete(b[1])` deletes both, each bar', () => {
    const { fin } = run('a = label.new(bar_index, high, "a")\nb = label.new(bar_index, low, "b")\n'
      + 'label.delete(a[1]), label.delete(b[1])\n')
    expect(ofFamily(fin, 'label').map((l) => l.props.text).sort()).toEqual(['a', 'b'])
  })

  it('control: a mixed line (`v := close, label.new(...)`) runs both statements', () => {
    const { fin } = run('var float v = na\nif bar_index % 50 == 0\n    v := close, label.new(bar_index, v)\n')
    const labels = ofFamily(fin, 'label')
    expect(labels).toHaveLength(6)
    expect(labels[1].props.y).toBeCloseTo(BARS[50].c, 9)
  })
})

