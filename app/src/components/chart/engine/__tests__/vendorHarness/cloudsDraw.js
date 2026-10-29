// app/src/components/chart/engine/__tests__/vendorHarness/cloudsDraw.js
//
// ─── UNCHARTED CLOUDS, DRAWN — the shared half of the two draw-parity rails ───
//
// `vendorHarness.cloudsDrawParity.test.js` (captures A, D: defaults) and
// `vendorHarness.cloudsSettingsParity.test.js` (set E: a member's own settings)
// both run the script through the REAL member door, the REAL binder and the REAL
// fill primitive's draw, and read back what lands on the canvas. One runner, so
// the two rails cannot measure differently.
//
// ⭐ SETTINGS GO THROUGH THE PRODUCT'S OWN DOORS, never a hand-built document:
//   • a folded `input.int` (a length) → `paramEdit.applyParamEdit` on the
//     member-pane document (ParamControls' write; `memberPaneVariants`' path);
//   • a declared input (`showMA1`) → `instanceControls.setInstanceInput`;
//   • a plot colour → the plot's own Style colour input (`$color`, `$out2Color`),
//     `setInstanceInput` again — what the member's colour swatch writes.
// A Pine input none of those doors can reach is returned as a GAP, by name.
import fs from 'node:fs'
import path from 'node:path'

import { enterMemberDoor, toProductBars, tfCodeOf, warmBarsSupply, HARNESS_DEF_ID } from './ourSide'
import * as registry from '../../nativeRegistry'
import { createBinder } from '../../binder'
import { addInstance, setInstanceInput } from '../../instanceControls'
import { applyParamEdit } from '../../../builder/paramEdit'
import { mergeChartSettings } from '../../../chartDefaults'
import { createFakeChart, createRecordingCtx, drawPrimitive } from '../fakeChart'

export const REPO = path.resolve(process.cwd(), '..')
export const CLOUDS_SRC = fs.readFileSync(path.join(REPO, 'tests/fixtures/member/uncharted-clouds.pine'), 'utf8')
export const REF = path.join(REPO, 'tests/fixtures/vendor/reference')

export function readCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/)
  const head = lines[0].split(',')
  return lines.slice(1).map((l) => {
    const c = l.split(',')
    const o = {}
    head.forEach((h, i) => { o[h] = c[i] })
    return o
  })
}

/** A css colour as the canvas reads it → `{hex, a}` with `a` the 8-bit alpha. */
export function cssToRgba(s) {
  if (typeof s !== 'string') return null
  let m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s)
  if (m) return { hex: `#${m[1].toUpperCase()}`, a: m[2] === undefined ? 255 : parseInt(m[2], 16) }
  m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(s)
  if (!m) return { raw: s }
  const h = (x) => Number(x).toString(16).toUpperCase().padStart(2, '0')
  return { hex: `#${h(m[1])}${h(m[2])}${h(m[3])}`, a: m[4] === undefined ? 255 : Math.round(Number(m[4]) * 255) }
}

export const fmt = (c) => (c ? `${c.hex}/${c.a}` : String(c))

/** The script's `input.*` names in declaration order — TradingView's `in_<n>`. */
export function pineInputOrder(src = CLOUDS_SRC) {
  return [...src.matchAll(/^(\w+)\s*=\s*input\.\w+\(/gm)].map((m) => m[1])
}

/** Which drawn plot (by title) each colour input paints: `plot(..., "Fast MA", color=ma1Color)`. */
function plotColourInputs(src = CLOUDS_SRC) {
  const out = new Map()
  for (const m of src.matchAll(/^plot\([^\n]*?"([^"]+)"[^\n]*?color\s*=\s*(\w+)/gm)) out.set(m[2], m[1])
  return out
}

/**
 * Apply a member's settings (`{pineInputName: value}`) through the product's doors.
 * @returns {{def, cs, instanceId, applied: string[], gaps: {name, value, why}[]}}
 */
function applySettings(settings) {
  const door = enterMemberDoor(CLOUDS_SRC)
  if (!door.def) throw new Error(door.refusal)
  let def = door.def
  const applied = []
  const gaps = []
  // 1. folded parameters: a NEW document, as ParamControls produces one
  const manifest = (def.compute && def.compute.paramManifest) || {}
  const rest = {}
  let edited = door.built.definition
  for (const [name, value] of Object.entries(settings)) {
    const pid = Object.keys(manifest).find((k) => manifest[k].sourceName === name)
    if (!pid) { rest[name] = value; continue }
    const r = applyParamEdit(edited, pid, value)
    if (!r.ok) { gaps.push({ name, value, why: `paramEdit refused: ${r.error}` }); continue }
    edited = r.definition
    applied.push(`${name}=${value} (paramEdit ${pid})`)
  }
  if (edited !== door.built.definition) {
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
    const { installed, errors } = registry.installUserDefinitions([edited])
    if (!installed.length) throw new Error(`install refused the edited document: ${errors.join(' | ')}`)
    def = installed[0]
  }
  // 2. instance inputs and plot Style colours
  let cs = addInstance(mergeChartSettings({}), def.id, registry)
  const inst = (cs.indicatorInstances || []).find((i) => i.defId === def.id)
  const declared = new Set((def.inputs || []).map((s) => s.key))
  const colourPlots = plotColourInputs()
  for (const [name, value] of Object.entries(rest)) {
    let key = null
    let v = value
    if (declared.has(name)) {
      key = name
      if (typeof value === 'boolean') v = value ? 1 : 0
    } else if (colourPlots.has(name)) {
      // the DOCUMENT's plot (the installed copy carries the resolved colour, not the `$ref`)
      const plot = edited.plots.find((p) => p.label === colourPlots.get(name))
      const ref = plot && typeof plot.color === 'string' && plot.color.startsWith('$') ? plot.color.slice(1) : null
      if (ref && declared.has(ref)) key = ref
    }
    if (!key) {
      gaps.push({ name, value, why: 'no door: not a folded parameter, not a declared input, not a plot\'s Style colour' })
      continue
    }
    const next = setInstanceInput(cs, inst.instanceId, key, v, registry)
    if (next === cs) { gaps.push({ name, value, why: `setInstanceInput(${key}) refused the value` }); continue }
    cs = next
    applied.push(`${name}=${value} (input ${key})`)
  }
  return { def, cs, instanceId: inst.instanceId, applied, gaps }
}

/**
 * Run one capture: values (registry.computeFor over warm bars) and the drawn chart
 * (binder + fill primitive), with the member's settings applied.
 */
export function runCloudsCapture({ dir, name, settings = {} }) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, `${name}.meta.json`), 'utf8'))
  const rows = readCsv(path.join(dir, `${name}.csv`))
  const study = (meta.studies || []).find((s) => s.slug === 'uncharted_clouds')
  const cap = {
    symbol: { ...meta.symbol, pro_name: meta.symbol.full_name },
    timeframe: meta.resolution,
    bars: { timeUnit: 'unix-s', rows: rows.map((r) => [Number(r.t), +r.o, +r.h, +r.l, +r.c, +r.v]) },
  }
  const supply = warmBarsSupply(cap)
  const pre = supply.kind === 'warm' ? supply.bars : 0
  const bars = toProductBars({ ...cap, bars: { ...cap.bars, rows: (supply.rows || []).concat(cap.bars.rows) } })
  const n = rows.length
  const tf = tfCodeOf(meta.resolution)

  const { def, cs, instanceId, applied, gaps } = applySettings(settings)
  const instances = (cs.indicatorInstances || []).filter((i) => i.defId === def.id)
  const inputs = (instances[0] && instances[0].inputs) || {}

  const colsAll = registry.computeFor(def, bars, inputs, { tf, symbol: { ticker: meta.symbol.name } })
  const cols = Object.fromEntries(Object.entries(colsAll).map(([k, v]) => [k, v && v.length === bars.length ? Array.from(v).slice(pre) : v]))

  const idx = new Map(bars.map((b, i) => [String(b.t), i]))
  // Prehistory is off-screen: its x is null, so a polygon never spans the seam.
  const fake = createFakeChart({ timeToX: (t) => (Number.isInteger(t) && t >= pre ? t * 10 : null) })
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const candles = fake.chart.addSeries(fake.LWC.CandlestickSeries, {}, 0)
  binder.sync({
    priceSeries: () => candles, setBarColours: () => {}, enabled: true, cs, instances, registry, bars, tf,
    symbol: { ticker: meta.symbol.name }, adjustTime: (t) => idx.get(String(t)),
    applyData: (series, data) => series.setData(data), plan: { fresh: true },
    resolvePlacement: () => ({ paneIndex: 0, scaleId: 'right', scaleOptions: {} }),
  })
  const owners = def.plots.filter((p) => p.fill && typeof p.fill.with === 'string')
  const bands = fake.calls.filter((c) => c.method === 'attachPrimitive').map((a) => {
    const rec = createRecordingCtx()
    const host = fake.seriesCreated.find((s) => s.__id === a.id)
    drawPrimitive(a.args[0], { chart: fake.chart, series: host, recorder: rec })
    // per window bar: the fillStyle of the polygon covering it (null = unpainted)
    const perBar = new Array(n).fill(null)
    const twice = []
    const styles = rec.polygonColours()
    rec.polygons().forEach((poly, k) => {
      const xs = poly.map((p) => p.x)
      const lo = Math.min(...xs)
      const hi = Math.max(...xs)
      for (let i = Math.ceil((lo - 0.5) / 10); i * 10 <= hi + 0.5; i += 1) {
        const w = i - pre
        if (w < 0 || w >= n) continue
        if (perBar[w] !== null) twice.push(w)
        perBar[w] = styles[k]
      }
    })
    return { perBar, twice }
  })
  const lineSeries = fake.seriesCreated.filter((s) => s !== candles && s.__options && s.__options.lineWidth !== undefined)
  const setDataOf = (s) => {
    const calls = fake.calls.filter((c) => c.id === s.__id && c.method === 'setData')
    return calls.length ? calls[calls.length - 1].args[0] : null
  }
  // each VISIBLE plot's series, by plot key (absent = the binder bound none for it)
  const lineOf = new Map(binder.bindings().filter((b) => b && b.series && b.plotKey).map((b) => [b.plotKey, b.series]))
  const drawnPlots = def.plots.filter((p) => !p.hidden)
  return { meta, study, rows, n, pre, supply, def, cs, instanceId, inputs, cols, colsAll, owners, bands, lineSeries, lineOf, drawnPlots, setDataOf, bars, applied, gaps }
}

/** TradingView's columns for a run, derived from the capture's own plot list. */
export function tvColumns(r) {
  const plots = (r.study && r.study.plots) || []
  const lines = plots.filter((p) => p.type === 'line' && p.target === null).map((p) => p.id)
  const colourOf = (target) => (plots.find((p) => p.type === 'colorer' && p.target === target) || {}).id
  const col = (pid) => r.rows.map((row) => {
    const v = row[`uncharted_clouds.${pid}`]
    return v === '' || v === undefined ? NaN : Number(v)
  })
  return { lines, colourOf, col }
}

/** Our keys in TradingView's order: the two MAs, then the 21 layers. */
export function ourKeys(r) {
  const drawn = r.def.plots.filter((p) => !p.hidden).map((p) => p.key)
  const layers = [...r.owners.map((p) => p.key), r.owners[r.owners.length - 1].fill.with]
  return [...drawn, ...layers]
}

export const uninstallHarness = () => registry.uninstallUserDefinition(HARNESS_DEF_ID)
