// app/src/components/chart/builder/memberPane/wseReviewFixes.test.js
//
// ─── ⭐⭐ PHASE 3 WS-E — THE REVIEW'S FINDINGS ON 2e82c07db2, AS RAILS ─────────
//
//   H1  `calc_bars_count`: what `bar_index` reads on the window's first bar is
//       uncaptured (Q-WSE1), so a run whose answer depends on it is refused by name;
//       one that reads it only as a distance or a drawing's place is drawn.
//   M1  a windowed document never draws a host object program computed over the
//       whole chart beside plots computed over the window.
//   L1  `fill(p1, p2, color, title, editable, fillgaps)` is not a gradient.
//   L2  an `offset` that reads a REASSIGNED setting is not read at its default.
//   L3  a fill TradingView does not draw either (`display.none`, `color = na`) is
//       not named in "Not drawn by this pane".
import { describe, it, expect, vi, afterEach } from 'vitest'

import { memberPaneDefinition } from './memberPaneDefinition'
import * as registry from '../../engine/nativeRegistry'
import { computeRuntimeColumns } from '../../engine/runtime/runtimeColumns'
import { runtimeObjectsOf } from '../../engine/runtime/runtimeObjects'
import { CALC_BARS_INDEX_GUARD } from '../../engine/runtime/calcBarsWindow'

const ID = 'u_wse-review'
const N = 260
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 100 + 10 * Math.sin(i / 9) + i * 0.1
  return { t: 1700000000 + i * 86400, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 + (i % 7) }
})
const flags = () => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
}
const door = (source) => memberPaneDefinition({ source, id: ID, name: 'T' })
const CB = (n = 100) => `//@version=6\nindicator("t", overlay = true, calc_bars_count = ${n})\n`
const ACC = 'var float acc = 0.0\nacc += close\nplot(acc, "acc")\n'
/** Run a document over `bars`; → `{cols}` or `{err}`. `listing` = the chart reaches the listing. */
function run(d, bars = BARS, listing = false) {
  const { installed, errors } = registry.installUserDefinitions([d.definition])
  expect(errors).toEqual([])
  try {
    return { cols: computeRuntimeColumns(installed[0], bars, { tf: 'D', newestBarIsForming: false, ...(listing ? { historyFromListing: true } : {}) }) }
  } catch (err) { return { err } }
}
const colOf = (d, cols, label) => cols[d.definition.plots.find((p) => p.label === label).key]

afterEach(() => { registry.uninstallUserDefinition(ID); vi.unstubAllEnvs() })

describe('WS-E review H1 — the calc_bars_count window and `bar_index`', () => {
  it('⛔ the reviewer\'s probe: `plot(bar_index)` on 101 bars of a chart off the listing is refused by name', () => {
    flags()
    const d = door(`${CB()}${ACC}plot(bar_index, "bi")\n`)
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.meta.runtimeHistory).toBe('listing')
    const r = run(d, BARS.slice(0, 101))
    expect(r.err && r.err.guard).toBe(CALC_BARS_INDEX_GUARD)
    expect(r.err.message).toMatch(/what `bar_index` reads/)
  })

  it('⛔ and on a chart that reaches the listing too: the value is uncaptured either way', () => {
    flags()
    const d = door(`${CB()}${ACC}plot(bar_index, "bi")\n`)
    expect(run(d, BARS, true).err.guard).toBe(CALC_BARS_INDEX_GUARD)
  })

  it('⛔ a phase of it (`bar_index % 5` carried in state), its text, and `last_bar_index` are refused', () => {
    flags()
    for (const tail of [
      'var float k = 0.0\nif bar_index % 5 == 0\n    k += 1\nplot(k, "k")\n',
      'if barstate.islast\n    label.new(bar_index, close, str.tostring(bar_index))\n',
      'plot(last_bar_index, "lbi")\n',
      'if bar_index % 50 == 0\n    label.new(bar_index * 2, close, "x")\n',
      'f() => bar_index\nplot(f(), "fb")\n',
    ]) {
      const d = door(`${CB()}${ACC}${tail}`)
      expect(d.ok, `${tail}: ${d.reason}`).toBe(true)
      const r = run(d)
      expect(r.err && r.err.guard, tail).toBe(CALC_BARS_INDEX_GUARD)
    }
  })

  it('⭐ CONTROL — a distance between bars and a drawing placed AT an index are drawn', () => {
    flags()
    const d = door(`${CB()}${ACC}plot(bar_index - bar_index[3], "gap")\nif bar_index % 1 == 0 and close > close[1] and barstate.islast\n    label.new(bar_index - 2, close, "x")\n`)
    expect(d.ok, d.reason).toBe(true)
    const r = run(d)
    expect(r.err, r.err && r.err.message).toBeUndefined()
    const gap = colOf(d, r.cols, 'gap')
    expect(Number.isNaN(gap[N - 101])).toBe(true)
    expect(gap[N - 1]).toBe(3)
    const obj = runtimeObjectsOf(r.cols)
    if (obj && obj.live.length) expect(obj.live[0].props.x).toBe(N - 3)
  })

  it('⭐ CONTROL — a chart within the count is not windowed, and `plot(bar_index)` draws from its own bar 0', () => {
    flags()
    const d = door(`${CB()}${ACC}plot(bar_index, "bi")\n`)
    const r = run(d, BARS.slice(0, 100), true)
    expect(r.err).toBeUndefined()
    expect(colOf(d, r.cols, 'bi')[99]).toBe(99)
  })

  it('⭐ CONTROL — a windowed script that never reads `bar_index` is drawn', () => {
    flags()
    const d = door(`${CB()}${ACC}`)
    const r = run(d)
    expect(r.err).toBeUndefined()
    let a = 0
    const want = BARS.slice(N - 100).map((b) => (a += b.c))
    expect(colOf(d, r.cols, 'acc')[N - 1]).toBeCloseTo(want[99], 6)
  })
})

describe('WS-E review M1 — a windowed document and the host object program', () => {
  // a label at each turn up: placed AT `bar_index`, chosen by price alone
  const TURN = 'if close > close[1] and close[1] <= close[2]\n    label.new(bar_index, close, "x")\n'
  it('⭐ a CLEAN host program under `calc_bars_count` is not carried: the run draws over the same window', () => {
    flags()
    const d = door(`${CB()}${ACC}${TURN}`)
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.objects).toBeFalsy()
    expect(d.definition.compute.objects).toBe(true)
    const r = run(d)
    expect(r.err, r.err && r.err.message).toBeUndefined()
    // only the turns INSIDE the window (from its third bar: `close[2]`), each at its chart bar
    const want = []
    for (let i = N - 100 + 2; i < N; i += 1) if (BARS[i].c > BARS[i - 1].c && BARS[i - 1].c <= BARS[i - 2].c) want.push(i)
    expect(want.length).toBeGreaterThan(0)
    expect(runtimeObjectsOf(r.cols).live.map((o) => o.props.x)).toEqual(want)
  })

  it('⛔ CONTROL — the same script without `calc_bars_count` keeps its clean host program', () => {
    flags()
    const d = door(`//@version=6\nindicator("t", overlay = true)\n${ACC}${TURN}`)
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.objects).toBeTruthy()
    expect(d.definition.compute.objects).toBeUndefined()
  })
})

describe('WS-E review L1-L3 — fills', () => {
  const H = '//@version=6\nindicator("t", overlay = true)\n'
  const P = `${ACC}p1 = plot(acc * 1.1, "A")\np2 = plot(acc * 0.9, "B")\n`
  const notDrawn = (d) => (d.notes || []).find((n) => n.name === 'Not drawn by this pane')

  it('L1 ⛔ six positionals whose third is a COLOUR is a solid fill (title, editable, fillgaps), not a gradient', async () => {
    flags()
    const { buildRuntimeIr } = await import('../../engine/ast/pineRuntimeFrontend')
    const built = buildRuntimeIr(`${H}${P}fill(p1, p2, color.red, "band", true, false)\n`, { bars: BARS.slice(0, 5), inputs: {} })
    expect(built.ok, built.refusal && built.refusal.message).toBe(true)
    const fill = built.ir.outputs.find((o) => o.call === 'fill')
    expect(fill.gradient).toBeUndefined()
  })

  it('L1 ⭐ CONTROL — six positionals with VALUES third and fourth stay a gradient', async () => {
    const { buildRuntimeIr } = await import('../../engine/ast/pineRuntimeFrontend')
    const built = buildRuntimeIr(`${H}${P}fill(p1, p2, acc, acc * 0.9, color.red, color.green)\n`, { bars: BARS.slice(0, 5), inputs: {} })
    expect(built.ok).toBe(true)
    expect(built.ir.outputs.find((o) => o.call === 'fill').gradient).toBe(true)
  })

  it('L3 ⛔ a fill with `display = display.none` or `color = na` is not named "Not drawn"', () => {
    flags()
    for (const f of ['fill(p1, p2, color = color.red, display = display.none)', 'fill(p1, p2, color = na)']) {
      const d = door(`${H}${P}${f}\n`)
      expect(d.ok, `${f}: ${d.reason || (d.runtimeDeclined && d.runtimeDeclined.why)}`).toBe(true)
      expect(notDrawn(d), f).toBeUndefined()
    }
  })

  it('L3 ⭐ CONTROL — a visible fill is still named', () => {
    flags()
    const d = door(`${H}${P}fill(p1, p2, color = color.red)\n`)
    expect(notDrawn(d) && notDrawn(d).note).toMatch(/a fill between two plots/)
  })
})

describe('WS-E review L2 — an `offset` reading a reassigned setting', () => {
  const H = '//@version=6\nindicator("t", overlay = true)\n'
  it('⛔ `len := len + 1` then `offset = -len` is withheld, never drawn at the default\'s -2', () => {
    flags()
    const d = door(`${H}len = input.int(2, "len")\nlen := len + 1\n${ACC}plot(acc * 2, "sh", offset = -len)\n`)
    expect(d.ok, d.reason || (d.runtimeDeclined && d.runtimeDeclined.why)).toBe(true)
    expect(d.withheld).toContain('sh')
    expect((d.definition.plots.find((p) => p.label === 'sh') || {}).displace).toBeUndefined()
  })

  it('⭐ CONTROL — the same setting never reassigned is read: displace -2', () => {
    flags()
    const d = door(`${H}len = input.int(2, "len")\n${ACC}plot(acc * 2, "sh", offset = -len)\n`)
    expect(d.definition.plots.find((p) => p.label === 'sh').displace).toBe(-2)
  })
})

describe('WS-E review M2 — the run\'s drawings replacing a partial host program are named', () => {
  const H = '//@version=6\nindicator("t", overlay = true)\n'
  const HOST = 'if close > close[1] and close[1] <= close[2]\n    label.new(bar_index, close, "x")\n'
  it('⭐ the "Drawings" note says they replace a program that could not make some of its calls', () => {
    flags()
    const d = door(`${H}${ACC}${HOST}var line l = na\nif acc > 20000 and na(l)\n    l := line.new(bar_index - 1, close, bar_index, close)\n`)
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.compute.objects).toBe(true)
    const note = (d.notes || []).find((n) => n.name === 'Drawings')
    expect(note && note.note).toMatch(/These replace the drawing program this pane would otherwise use, which could not make \d+ of its \d+ drawing calls/)
  })
  it('⛔ CONTROL — a run that owns its drawings with no host program to replace says nothing of one', () => {
    flags()
    const d = door(`//@version=6\nindicator("t", overlay = true, calc_bars_count = 100)\n${ACC}${HOST}`)
    const note = (d.notes || []).find((n) => n.name === 'Drawings')
    expect(note && note.note).toMatch(/made by the same bar-by-bar run/)
    expect(note.note).not.toMatch(/These replace/)
  })
})
