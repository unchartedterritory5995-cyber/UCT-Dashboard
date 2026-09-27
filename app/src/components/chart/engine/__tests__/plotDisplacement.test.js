// app/src/components/chart/engine/__tests__/plotDisplacement.test.js
//
// ─── ⭐⭐ `plot(x, offset = -N)` IS DRAWN WHERE PINE DRAWS IT (2026-09-26) ─────
//
// ⚰️ THE DEFECT. The translator has always recorded a leftward displacement as
// presentation — the undisplaced tree plus `displace: -N` on its output row —
// and nothing downstream ever read it: the member pane dropped it building its
// rows, so every such plot was drawn N bars LATE. A pivot marker sat on the bar
// that CONFIRMED the pivot instead of the pivot bar, on every chart, with nothing
// on screen saying so.
//
// ⭐ THE RULE, PINE'S OWN: the value computed at bar i is drawn at bar i + offset.
// For offset < 0 the last |offset| bars carry no point, and nothing is computed
// from a future bar — the drawing is a re-indexing of a finished column.
//
// ⛔⛔ AND IT IS A DRAWING FACT ONLY. The column — what a scan, an alert and a
// `source` reference read — keeps the value on the bar that computed it. Both
// directions are railed here: the drawing moves, the column does not.
import { describe, it, expect, vi } from 'vitest'

// ⭐ The band's edges are only observable through what the binder hands the fill
// primitive, so the primitive is wrapped (never replaced) to record its options.
const { fillPatches } = vi.hoisted(() => ({ fillPatches: [] }))
vi.mock('../fillPrimitive', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    createFillPrimitive: (init) => {
      const p = real.createFillPrimitive(init)
      return { primitive: p.primitive, setOptions: (patch) => { fillPatches.push(patch); p.setOptions(patch) } }
    },
  }
})
import fs from 'node:fs'
import path from 'node:path'

import { createBinder, drawShiftOf, displacedColumn } from '../binder'
import { createFakeChart } from './fakeChart'
import { validateDefinition } from '../defSchema'
import { interpret } from '../ast/interpret'
import { translatePine } from '../ast/pine'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { applyParamEdit } from '../../builder/paramEdit'

const N = 8
const BARS = Array.from({ length: N }, (_, i) => ({ t: 1700000000 + i * 60, o: 10, h: 10, l: 10, c: 10 + i, v: 1 }))
const T = (i) => BARS[i].t

function harness(defs, columnsById) {
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const registry = {
    getDefinition: (id) => defs.get(id) || null,
    computeFor: (def) => columnsById[def.id],
    hasAnyFinite: (col) => Array.from(col || []).some(Number.isFinite),
    columnKeys: (d) => (d.plots || []).map((p) => p.key),
  }
  const markerSets = []
  const run = (instances) => binder.sync({
    enabled: true,
    instances,
    registry,
    bars: BARS,
    adjustTime: (t) => t,
    plan: { fresh: true },
    applyData: (series, data) => series.setData(data),
    resolvePlacement: () => ({ paneIndex: 1, scaleId: 's', scaleOptions: {} }),
    createSeriesMarkers: (_series, first) => {
      markerSets.push(first)
      return { setMarkers: (m) => markerSets.push(m) }
    },
  })
  const setDataOf = () => fake.calls.filter((c) => c.method === 'setData').map((c) => c.args[0])
  return { fake, run, setDataOf, markerSets }
}

const inst = (defId) => ({ instanceId: `inst:${defId}:1`, defId, inputs: {} })
const lineDef = (id, extra = {}) => ({
  id, schemaVersion: 2, label: id, inputs: [],
  plots: [{ key: 'value', label: 'V', style: 'line', legend: { decimals: 2 }, ...extra }],
})
const valuesAt = (points) => points.map((p) => (p && 'value' in p ? p.value : null))

// ─── the pure re-indexing ──────────────────────────────────────────────────────

describe('displacedColumn — the re-indexing, and only that', () => {
  it('⭐ offset -2: bar j shows the value computed at bar j+2; the last 2 bars are empty', () => {
    const col = Float64Array.from([0, 1, 2, 3, 4, 5])
    expect(Array.from(displacedColumn(col, -2))).toEqual([2, 3, 4, 5, NaN, NaN])
  })

  it('⛔ it never mutates the column it was handed', () => {
    const col = Float64Array.from([0, 1, 2, 3])
    displacedColumn(col, -1)
    expect(Array.from(col)).toEqual([0, 1, 2, 3])
  })

  it('⭐ 0 is the identity, and the result is memoised on identity', () => {
    const col = Float64Array.from([1, 2, 3])
    expect(displacedColumn(col, 0)).toBe(col)
    expect(displacedColumn(col, -1)).toBe(displacedColumn(col, -1))
  })

  it('⛔⛔ a POSITIVE displace on a plot is never applied — it is already in the tree', () => {
    // The translator turns `offset = +N` into `x[N]`. A renderer that also read a
    // positive `displace` would shift it twice as far. The schema refuses one too.
    expect(drawShiftOf({ displace: 3 })).toBe(0)
    expect(drawShiftOf({ displace: -3 })).toBe(-3)
    expect(drawShiftOf({ displace: 1.5 })).toBe(0)
    expect(drawShiftOf({})).toBe(0)
  })
})

// ─── the binder draws it ───────────────────────────────────────────────────────

describe('the binder draws a leftward displacement', () => {
  const COL = Float64Array.from([0, 1, 2, 3, 4, 5, 6, 7])

  it('⭐⭐ a displaced line is drawn N bars to the LEFT, times unchanged', () => {
    const defs = new Map([['u_d', lineDef('u_d', { displace: -3 })]])
    const { run, setDataOf } = harness(defs, { u_d: { value: COL } })
    run([inst('u_d')])
    const pts = setDataOf()[0]
    expect(pts.map((p) => p.time)).toEqual(BARS.map((b) => b.t))
    expect(valuesAt(pts)).toEqual([3, 4, 5, 6, 7, null, null, null])
  })

  it('⛔ CONTROL — the same plot without `displace` is drawn where it was computed', () => {
    const defs = new Map([['u_p', lineDef('u_p')]])
    const { run, setDataOf } = harness(defs, { u_p: { value: COL } })
    run([inst('u_p')])
    expect(valuesAt(setDataOf()[0])).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('⛔⛔ THE COLUMN IS NOT TOUCHED — what a scan, an alert and a source read', () => {
    const col = Float64Array.from(COL)
    const defs = new Map([['u_d', lineDef('u_d', { displace: -3 })]])
    const { run } = harness(defs, { u_d: { value: col } })
    run([inst('u_d')])
    expect(Array.from(col)).toEqual(Array.from(COL))
  })

  it('⭐⭐ a marker is placed on the displaced bar (a pivot on its pivot bar)', () => {
    // A 0/1 event column that fires on bar 6 — the bar that CONFIRMS a pivot two
    // bars back. Displaced by -2, the glyph belongs on bar 4.
    const ev = Float64Array.from([0, 0, 0, 0, 0, 0, 1, 0])
    const marker = { shape: 'circle', position: 'aboveBar' }
    const defs = new Map([['u_m', {
      id: 'u_m', schemaVersion: 2, label: 'm', inputs: [],
      plots: [{ key: 'value', label: 'M', style: 'markers', legend: { decimals: 2 }, marker, displace: -2 }],
    }]])
    const { run, markerSets } = harness(defs, { u_m: { value: ev } })
    run([inst('u_m')])
    const last = markerSets[markerSets.length - 1]
    expect(last.map((m) => m.time)).toEqual([T(4)])
  })

  it('⛔ CONTROL — the same marker without `displace` sits on the confirming bar', () => {
    const ev = Float64Array.from([0, 0, 0, 0, 0, 0, 1, 0])
    const marker = { shape: 'circle', position: 'aboveBar' }
    const defs = new Map([['u_m', {
      id: 'u_m', schemaVersion: 2, label: 'm', inputs: [],
      plots: [{ key: 'value', label: 'M', style: 'markers', legend: { decimals: 2 }, marker }],
    }]])
    const { run, markerSets } = harness(defs, { u_m: { value: ev } })
    run([inst('u_m')])
    expect(markerSets[markerSets.length - 1].map((m) => m.time)).toEqual([T(6)])
  })

  it('⭐ a band follows its displaced edges', () => {
    const up = Float64Array.from([10, 11, 12, 13, 14, 15, 16, 17])
    const lo = Float64Array.from([0, 1, 2, 3, 4, 5, 6, 7])
    const defs = new Map([['u_b', {
      id: 'u_b', schemaVersion: 2, label: 'b', inputs: [],
      plots: [
        { key: 'upper', label: 'U', style: 'line', legend: { decimals: 2 }, fill: { with: 'lower' }, displace: -1 },
        { key: 'lower', label: 'L', style: 'line', legend: { decimals: 2 }, displace: -1 },
      ],
    }]])
    fillPatches.length = 0
    const { run } = harness(defs, { u_b: { upper: up, lower: lo } })
    run([inst('u_b')])
    const last = fillPatches.filter((x) => x.upper).pop()
    expect(last, 'the band was never handed its edges').toBeTruthy()
    expect(Array.from(last.upper)).toEqual([11, 12, 13, 14, 15, 16, 17, NaN])
    expect(Array.from(last.lower)).toEqual([1, 2, 3, 4, 5, 6, 7, NaN])
  })
})

// ─── the schema ────────────────────────────────────────────────────────────────

describe('the schema says what `displace` may be', () => {
  const doc = (plot) => ({
    id: 'u_s', schemaVersion: 2, version: 1,
    compute: { kind: 'ast', ast: { type: 'series', name: 'close' }, source: 'close', fn: 'x' },
    meta: { name: 's' }, placement: { target: 'pane' }, inputs: [],
    plots: [{ key: 'value', label: 'V', style: 'line', legend: { decimals: 2 }, ...plot }],
  })
  const errs = (plot) => (validateDefinition(doc(plot)).errors || []).filter((e) => /displace/.test(e))

  it('⭐ a negative whole number is accepted', () => { expect(errs({ displace: -5 })).toEqual([]) })
  it('⛔ a positive one is refused, and the sentence says why', () => {
    expect(errs({ displace: 5 }).join(' ')).toMatch(/rightward displacement belongs in the tree/)
  })
  it('⛔ a fraction is refused', () => { expect(errs({ displace: -1.5 }).length).toBe(1) })
  it('⛔ a malformed displaceFrom is refused', () => {
    expect(errs({ displace: -2, displaceFrom: { param: 'p', scale: 2, add: 0 } }).length).toBe(1)
    expect(errs({ displace: -2, displaceFrom: { param: '__uct_param_1', scale: -1, add: 1 } })).toEqual([])
  })
})

// ─── the member pane door carries it, param-aware ──────────────────────────────

const src = (body) => `//@version=5\nindicator("t", overlay = true)\n${body}\n`

describe('the member pane carries it onto the saved definition', () => {
  it('⭐⭐ a leftward offset reaches `plots[].displace`; the compute tree stays undisplaced', () => {
    const d = memberPaneDefinition({ source: src('plot(close, "c", offset = -3)'), id: 'u_mp' })
    expect(d.ok, d.reason).toBe(true)
    const p = d.definition.plots.find((x) => x.key === 'value')
    expect(p.displace).toBe(-3)
    expect(d.definition.compute.ast).toEqual({ type: 'series', name: 'close' })
    expect(validateDefinition(d.definition).ok).toBe(true)
  })

  it('⛔⛔ a RIGHTWARD offset is NOT carried on the plot — it is in the tree once', () => {
    const d = memberPaneDefinition({ source: src('plot(close, "c", offset = 3)'), id: 'u_mp' })
    expect(d.ok, d.reason).toBe(true)
    const p = d.definition.plots.find((x) => x.key === 'value')
    expect(p.displace).toBeUndefined()
    expect(d.definition.compute.ast).toEqual({ type: 'offset', value: 3, args: [{ type: 'series', name: 'close' }] })
  })

  it('⭐⭐ a pivot whose `rightbars` is an input: an edit moves pivot, shift AND drawing', () => {
    const d = memberPaneDefinition({ id: 'u_pv', source: src(
      'rb = input.int(3, "Right", minval = 1)\n'
      + 'plot(ta.pivothigh(high, 2, rb), "p", style = plot.style_circles, offset = -rb)') })
    expect(d.ok, d.reason).toBe(true)
    const plot = d.definition.plots.find((x) => x.key === 'value')
    expect(plot.displace).toBe(-3)
    const [pid, entry] = Object.entries(d.definition.compute.paramManifest || {})[0] || []
    expect(entry && entry.sourceName).toBe('rb')
    expect(plot.displaceFrom).toEqual({ param: pid, scale: -1, add: 0 })
    const r = applyParamEdit(d.definition, pid, 5)
    expect(r.ok, r.error).toBe(true)
    const moved = r.definition.plots.find((x) => x.key === 'value')
    expect(moved.displace).toBe(-5)
    expect(r.definition.compute.ast.value).toBe(5)
    expect(r.definition.compute.ast.args[0].args[2]).toEqual({ type: 'num', value: 5 })
  })

  it('⛔ an edit that would turn the drawing rightward is refused whole', () => {
    const d = memberPaneDefinition({ id: 'u_pv2', source: src(
      'n = input.int(3, "N", minval = 1)\n'
      + 'plot(ta.sma(close, n), "s", offset = -n + 4)') })
    expect(d.ok, d.reason).toBe(true)
    const plot = d.definition.plots.find((x) => x.key === 'value')
    // `-n + 4` at n = 3 is +1 → rightward, in the tree; nothing on the plot.
    expect(plot.displace).toBeUndefined()
  })

  it('⛔⛔ a displacement read NON-affinely withholds its parameter, and says so', () => {
    const d = memberPaneDefinition({ id: 'u_w', source: src(
      'n = input.int(3, "N", minval = 1)\n'
      + 'plot(ta.sma(close, n), "s", offset = -(n * 2))') })
    expect(d.ok, d.reason).toBe(true)
    const plot = d.definition.plots.find((x) => x.key === 'value')
    expect(plot.displace).toBe(-6)
    expect(plot.displaceFrom).toBeUndefined()
    const names = Object.values(d.definition.compute.paramManifest || {}).map((e) => e.sourceName)
    expect(names).not.toContain('n')
    expect(d.notes.map((x) => x.note).join(' ')).toMatch(/also sets where a plot is drawn/)
  })

  it('⛔⛔ a band between plots displaced DIFFERENTLY is refused by name', () => {
    const d = memberPaneDefinition({ id: 'u_f', source: src(
      'a = plot(high, "a", offset = -2)\nb = plot(low, "b", offset = -3)\nfill(a, b)') })
    expect(d.ok).toBe(false)
    expect(d.guard).toBe('pine:plot-offset')
    expect(d.reason).toMatch(/different displacements \(-2 and -3 bars\)/)
  })

  it('⛔ CONTROL — a band between plots displaced the SAME attaches', () => {
    const d = memberPaneDefinition({ id: 'u_f2', source: src(
      'a = plot(high, "a", offset = -2)\nb = plot(low, "b", offset = -2)\nfill(a, b)') })
    expect(d.ok, d.reason).toBe(true)
  })
})

// ─── the corpus case, end to end: which bar a pivot is drawn on ────────────────

describe('extrapolated-pivot-connector — a pivot is drawn on its pivot bar', () => {
  const REPO = path.resolve(process.cwd(), '..')
  const FILE = path.join(REPO, 'corpus/committed/extrapolated-pivot-connector__vROeQSQlNs.pine')

  it('⭐⭐ BEFORE: confirmed at bar 250. AFTER: drawn at bar 150, the pivot', () => {
    expect(fs.existsSync(FILE)).toBe(true)
    const d = memberPaneDefinition({ source: fs.readFileSync(FILE, 'utf8'), id: 'u_epc' })
    expect(d.ok, d.reason).toBe(true)
    const plot = d.definition.plots.find((x) => /Pivot High/.test(x.label || ''))
    expect(plot, JSON.stringify(d.definition.plots.map((x) => x.label))).toBeTruthy()
    expect(plot.displace).toBe(-100)
    // A single clean peak at bar 150 over 300 bars.
    const bars = Array.from({ length: 300 }, (_, i) => {
      const h = 1000 - Math.abs(i - 150)
      return { t: 20260101 + i, o: h - 1, h, l: h - 2, c: h - 1, v: 1 }
    })
    const tree = d.definition.compute.trees ? d.definition.compute.trees[plot.key] : d.definition.compute.ast
    // The member's own inputs (`csrc`) are identifiers in the saved tree; bind them
    // at their defaults, the values the chart binds when nobody has moved a knob.
    const defaults = Object.fromEntries((d.definition.inputs || []).map((i) => [i.key, i.default]))
    const bind = (n) => (!n || typeof n !== 'object' ? n
      : n.type === 'series' && typeof defaults[n.name] === 'number' ? { type: 'num', value: defaults[n.name] }
        : Array.isArray(n.args) ? { ...n, args: n.args.map(bind) } : n)
    const col = interpret(bind(tree), bars)
    const computedAt = Array.from(col).findIndex(Number.isFinite)
    const drawnAt = Array.from(displacedColumn(col, drawShiftOf(plot))).findIndex(Number.isFinite)
    expect(computedAt).toBe(250) // the column: the pivot's value, on the bar that confirms it
    expect(drawnAt).toBe(150)    // the drawing: on the pivot bar, as TradingView draws it
    expect(col[250]).toBe(1000)
  })

  it('⛔ CONTROL — the plain translation computes the SAME column (the scan is unchanged)', () => {
    // The door's tree is the plain translation's with the member's input left as an
    // identifier; bound at its default it computes the identical column. The
    // displacement changed where the value is DRAWN and nothing about what it IS.
    const text = fs.readFileSync(FILE, 'utf8')
    const t = translatePine(text, { strict: true })
    const row = t.outputs.find((o) => /Pivot High/.test(o.title || ''))
    expect(row.displace).toBe(-100)
    const d = memberPaneDefinition({ source: text, id: 'u_epc' })
    const plot = d.definition.plots.find((x) => /Pivot High/.test(x.label || ''))
    const tree = d.definition.compute.trees ? d.definition.compute.trees[plot.key] : d.definition.compute.ast
    const defaults = Object.fromEntries((d.definition.inputs || []).map((i) => [i.key, i.default]))
    const bind = (n) => (!n || typeof n !== 'object' ? n
      : n.type === 'series' && typeof defaults[n.name] === 'number' ? { type: 'num', value: defaults[n.name] }
        : Array.isArray(n.args) ? { ...n, args: n.args.map(bind) } : n)
    const bars = Array.from({ length: 300 }, (_, i) => {
      const h = 1000 - Math.abs(i - 150) + (i % 7)
      return { t: 20260101 + i, o: h - 1, h, l: h - 2, c: h - 1, v: 1 }
    })
    expect(Array.from(interpret(bind(tree), bars))).toEqual(Array.from(interpret(row.ast, bars)))
  })
})

// ─── the builder sheet's document writer carries it too ─────────────────────────

describe('buildDefinition — the one writer both doors use', () => {
  const row = (extra) => ({
    key: 'value', label: 'V', source: 'close', ast: { type: 'series', name: 'close' },
    mode: 'non-repainting', readback: '', style: 'line', ...extra,
  })

  it('⭐ a row\'s leftward displacement reaches the saved plot, with its relation', async () => {
    const { buildDefinition } = await import('../../builder/BuilderSheet.jsx')
    const doc = buildDefinition({
      defId: 'u_bd', name: 'bd', source: 'close', ast: { type: 'series', name: 'close' },
      mode: 'non-repainting',
      plots: [row({ displace: -4, displaceFrom: { param: '__uct_param_1', scale: -1, add: 0 } })],
    })
    expect(doc.plots[0].displace).toBe(-4)
    expect(doc.plots[0].displaceFrom).toEqual({ param: '__uct_param_1', scale: -1, add: 0 })
    expect(validateDefinition(doc).ok).toBe(true)
  })

  it('⛔⛔ a POSITIVE displace on a row is never written — it would be applied twice', async () => {
    const { buildDefinition } = await import('../../builder/BuilderSheet.jsx')
    const doc = buildDefinition({
      defId: 'u_bd2', name: 'bd', source: 'close', ast: { type: 'series', name: 'close' },
      mode: 'non-repainting', plots: [row({ displace: 3 })],
    })
    expect(doc.plots[0].displace).toBeUndefined()
  })
})
