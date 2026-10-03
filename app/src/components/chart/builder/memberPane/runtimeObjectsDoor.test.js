// app/src/components/chart/builder/memberPane/runtimeObjectsDoor.test.js
//
// ─── RT5 — THE DOOR A DRAWING-ONLY RUNTIME DOCUMENT WALKS THROUGH ────────────
//
// A script whose drawing the HOST object program cannot follow (here: a label
// whose text prints a running `var` total, which only a per-bar run computes)
// attaches through the runtime lane with `compute.objects === true`, and its
// objects come from the same run that computes its (hidden) anchor column.
// Controls: flag off it is the host refusal it always was; a drawing the host
// lane follows keeps the host lane (nothing it already drew moves).
import { describe, it, expect, vi, afterEach } from 'vitest'

import { memberPaneDefinition } from './memberPaneDefinition'
import * as registry from '../../engine/nativeRegistry'
import { runtimeObjectsOf, drawsRuntimeObjects } from '../../engine/runtime/runtimeObjects'
import { computeRuntimeColumns } from '../../engine/runtime/runtimeColumns'

const H = '//@version=6\nindicator("t", overlay = true)\n'
const RUNNING_TOTAL = `${H}var float acc = 0\nacc += close\nif bar_index % 50 == 0\n`
  + '    label.new(bar_index, close, str.tostring(acc, "#"))\n'
const HOST_DRAWS = `${H}if bar_index % 50 == 0\n    label.new(bar_index, close, "x")\n`
// the host refuses the PLOT (a running `var` total) and draws the label itself
const RUNTIME_PLOT_HOST_DRAWS = `${H}var float acc = 0\nacc += close\nplot(acc)\nif bar_index % 50 == 0\n`
  + '    label.new(bar_index, close, "x")\n'
const ID = 'u_rt5-door'

const N = 260
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, v: 1000 }))

const flags = (runtime) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', runtime ? '1' : '')
}
const build = (source) => memberPaneDefinition({ source, id: ID, name: 'T' })

afterEach(() => { registry.uninstallUserDefinition(ID); vi.unstubAllEnvs() })

describe('RT5 — a drawing-only runtime document', () => {
  it('attaches with its objects owned by the run', () => {
    flags(true)
    const r = build(RUNNING_TOTAL)
    expect(r.ok).toBe(true)
    expect(r.definition.compute.kind).toBe('runtime')
    expect(r.definition.compute.objects).toBe(true)
    expect(drawsRuntimeObjects(r.definition)).toBe(true)
  })

  it('the run that computes its column makes its labels, texts printed from the run', () => {
    flags(true)
    const r = build(RUNNING_TOTAL)
    const { installed, errors } = registry.installUserDefinitions([r.definition])
    expect(errors).toEqual([])
    // the lane the registry loads lazily, called as the worker calls it
    const cols = computeRuntimeColumns(installed[0], BARS,
      { tf: 'D', newestBarIsForming: false, historyFromListing: true })
    const payload = runtimeObjectsOf(cols)
    expect(payload).not.toBeNull()
    const labels = payload.live.filter((o) => o.family === 'label')
    expect(labels).toHaveLength(6)
    let acc = 0
    const want = []
    BARS.forEach((b, i) => { acc += b.c; if (i % 50 === 0) want.push(String(Math.round(acc))) })
    expect(labels.map((l) => l.props.text)).toEqual(want)
    // ⛔ the payload is not a column: every reader that walks the keys sees columns only
    expect(Object.keys(cols)).not.toContain('__runtimeObjects')
  })

  it('control: flag off, it is the host refusal it always was', () => {
    flags(false)
    const r = build(RUNNING_TOTAL)
    expect(r.ok).toBe(false)
    expect(r.runtimeDeclined).toBeUndefined()
  })

  it('control: a runtime document whose drawing the HOST lane follows keeps the host objects', () => {
    flags(true)
    const r = build(RUNTIME_PLOT_HOST_DRAWS)
    expect(r.ok).toBe(true)
    expect(r.definition.compute.kind).toBe('runtime')
    expect(r.definition.compute.objects).toBeUndefined()
    expect(r.definition.objects).toBeTruthy()
  })

  it('control: a drawing the host lane follows keeps the host lane', () => {
    flags(true)
    const r = build(HOST_DRAWS)
    expect(r.ok).toBe(true)
    expect(r.definition.compute.kind).not.toBe('runtime')
    expect(drawsRuntimeObjects(r.definition)).toBe(false)
  })

  it('calc_bars_count: a chart longer than the declared count refuses by name; one within it draws', () => {
    flags(true)
    const src = RUNNING_TOTAL.replace('indicator("t", overlay = true)', 'indicator("t", overlay = true, calc_bars_count = 100)')
    const r = build(src)
    expect(r.ok).toBe(true)
    const { installed } = registry.installUserDefinitions([r.definition])
    const ctx = { tf: 'D', newestBarIsForming: false, historyFromListing: true }
    expect(() => computeRuntimeColumns(installed[0], BARS, ctx)).toThrow(/calc_bars_count = 100/)
    // control: 100 bars is within the count, and draws
    const cols = computeRuntimeColumns(installed[0], BARS.slice(0, 100), ctx)
    expect(runtimeObjectsOf(cols).live.filter((o) => o.family === 'label')).toHaveLength(2)
  })
})
