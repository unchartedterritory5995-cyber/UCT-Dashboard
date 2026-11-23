// THE RECEIPT NAMES THE PLOT (AUDIT 11-23): "color the MACD signal line orange" changed MACD's Signal colour but the receipt said
// "Changed MACD's color" — the member could not tell which line changed. Fixed in indicatorEdits.styledOutputWord / extReceiptLine
// (both the proposal / describe sentence and the confirmed receipt). Class-generated over EVERY indicator the catalog offers, each
// style change built by the capability's own request builder (indicatorControls.styleRequest) and planned by Indicators' own
// writer (agentMutations.planIndicatorMutation), so the `change` the sentence reads is the writer's, never hand-made:
//   (1) COLOUR    every colour setting of an indicator with several → "Changed <name>'s <label> color …" (label: the
//                 definition's own, "Signal", "%D", "Kijun", "+DI"; a trailing "color" is not doubled)
//   (2) UP / DOWN every signed histogram of an indicator that draws several lines → "Changed <name>'s <plot> up color …"
//   (3) PLOT STYLE every output of an indicator that draws several → "Changed how <name>'s <plot> is drawn …"
//   (4) DOT SIZE  every dot output of an indicator that draws several → "Changed <name>'s <plot> dot size …"
//   (5) UNCHANGED an indicator with ONE colour / ONE drawn line keeps its sentence exactly; an instance-level control (line width,
//                 line style) names no output; a definition that cannot be read falls back to the old sentence
// The expected label comes from the definition (the Inspector's own words), never from the sentence. LOCAL (vitest, unit).
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import * as R from '../components/chart/engine/nativeRegistry'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { adoptOverlayAverages } from '../components/chart/maAdoption'
import { planIndicatorMutation, styleOptionsOf } from '../components/chart/builder/agentMutations'
import { addableRows, extReceiptLine, receiptLine, styledOutputWord } from './capabilities/indicatorEdits'
import { styleRequest } from './capabilities/indicatorControls'
import { colorName } from './capabilities/chart'

registerBuiltins()

const VOL = { volumeSeparatePane: true, blankVolume: false }
const ctx = { canManage: true, ownedDefinitionIds: [], registry: R, chartId: 'c1', volumeOpts: VOL }
const CHART = 'Chart (QQQ)'
const csWith = (defId) => {
  const base = mergeChartSettings(null)
  const raw = mergeChartSettings(JSON.stringify({ ...base, indicatorInstances: [{ instanceId: `inst:${defId}:1`, defId, inputs: {}, hidden: false, presentation: { signColors: true } }] }))
  return adoptOverlayAverages(raw) || raw
}
const drawn = (def) => (def.plots || []).filter(p => p && p.key && p.style !== 'hlines')
const colorInputs = (def) => (def.inputs || []).filter(i => i && i.type === 'color')
const strip = (s) => String(s).replace(/\s+colou?r$/i, '').trim()
const NEW = '#123456'
// one style change through the capability's request builder and Indicators' planner → { change, name } | null (refused / no-op)
function planned(defId, args) {
  const cs = csWith(defId)
  const st = { chart: CHART, chartRef: 'c1', cs, rows: [], canManage: true }
  const built = styleRequest(st, { instance: `inst:${defId}:1`, ...args })
  if (!built.req) return { why: built.why }
  const p = planIndicatorMutation(cs, built.req, ctx)
  return p.ok ? { op: p.plan.op, change: p.plan.preview.change, name: p.plan.preview.name, defId } : { why: p.reason }
}
// both sentences: the proposal / describe line (extReceiptLine with the plan's defId) and the confirmed receipt (receiptLine)
const lines = (x) => [extReceiptLine({ op: x.op, change: x.change, defId: x.defId }, x.name, ` on ${CHART}`), receiptLine({ op: x.op, change: x.change, defId: x.defId, name: x.name }, CHART)]

const DEFS = addableRows().map(r => r.defId).filter((d, i, a) => a.indexOf(d) === i && R.getDefinition(d))

describe('(1) colour: every colour setting of a multi-colour indicator is named', () => {
  const rows = DEFS.flatMap(d => (colorInputs(R.getDefinition(d)).length > 1 ? colorInputs(R.getDefinition(d)).map(i => [d, i.key, i.label || i.key]) : []))
  it(`${rows.length} colour settings across ${new Set(rows.map(r => r[0])).size} indicators`, () => {
    expect(rows.length).toBeGreaterThan(20)
    const miss = []
    for (const [d, key, label] of rows) {
      const x = planned(d, { property: 'color', value: NEW, output: label })
      if (!x.change) { miss.push(`${d}.${key}: not planned (${x.why})`); continue }
      expect(x.change.target).toBe(`input:${key}`)
      const want = `Changed ${x.name}'s ${strip(label)} color on ${CHART} to ${colorName(NEW)}.`
      for (const l of lines(x)) if (l !== want) miss.push(`${d}.${key}: ${l} ≠ ${want}`)
    }
    expect(miss).toEqual([])
  })
  it('the AUDIT sentence: MACD\'s signal line', () => {
    const x = planned('macd', { property: 'color', value: 'orange', output: 'signal' })
    expect(lines(x)).toEqual([`Changed MACD's Signal color on ${CHART} to orange.`, `Changed MACD's Signal color on ${CHART} to orange.`])
  })
})

describe('(2) up / down colours of a signed histogram on a multi-line indicator name the histogram', () => {
  const rows = []
  for (const d of DEFS) {
    const def = R.getDefinition(d)
    if (drawn(def).length < 2) continue
    let opts = null
    try { opts = styleOptionsOf(csWith(d), R, `inst:${d}:1`) } catch { opts = null }
    for (const c of (opts?.colors || []).filter(c => c.target.startsWith('sign:'))) rows.push([d, c.target, c.plotKey])
  }
  it(`${rows.length} signed-histogram colours`, () => {
    expect(rows.length).toBeGreaterThan(1)
    const miss = []
    for (const [d, target, plotKey] of rows) {
      const def = R.getDefinition(d)
      const x = planned(d, { property: target === 'sign:up' ? 'upColor' : 'downColor', value: NEW, output: plotKey })
      if (!x.change) { miss.push(`${d}.${plotKey}: not planned (${x.why})`); continue }
      const plot = drawn(def).find(p => p.key === plotKey)
      const want = `Changed ${x.name}'s ${plot.label || plot.key} ${target === 'sign:up' ? 'up' : 'down'} color on ${CHART} to ${colorName(NEW)}.`
      for (const l of lines(x)) if (l !== want) miss.push(`${d}.${plotKey}: ${l} ≠ ${want}`)
    }
    expect(miss).toEqual([])
  })
})

describe('(3) plot style: every output of a multi-line indicator is named', () => {
  const rows = []
  for (const d of DEFS) {
    if (drawn(R.getDefinition(d)).length < 2) continue
    let opts = null
    try { opts = styleOptionsOf(csWith(d), R, `inst:${d}:1`) } catch { opts = null }
    for (const s of opts?.plotStyles || []) { const v = s.options.find(o => o !== s.current); if (v) rows.push([d, s.plotKey, v]) }
  }
  it(`${rows.length} plot-style outputs`, () => {
    expect(rows.length).toBeGreaterThan(10)
    const miss = []
    let done = 0
    for (const [d, plotKey, v] of rows) {
      const plot = drawn(R.getDefinition(d)).find(p => p.key === plotKey)
      const x = planned(d, { property: 'plotStyle', value: v, output: plotKey })
      // (a style the writer itself refuses for that output — e.g. awesome's coloured columns — is Indicators', not this sentence's)
      if (!x.change) { if (x.why !== 'writer-refused') miss.push(`${d}.${plotKey}: not planned (${x.why})`); continue }
      done++
      if (!plot) continue                                             // a style row for a guide line: no drawn output to name
      const want = `Changed how ${x.name}'s ${plot.label || plot.key} is drawn on ${CHART} — ${x.change.before || 'default'} → ${v}.`
      for (const l of lines(x)) if (l !== want) miss.push(`${d}.${plotKey}: ${l} ≠ ${want}`)
    }
    expect(miss).toEqual([])
    expect(done).toBeGreaterThan(50)
  })
})

describe('(4) dot size: every dot output of a multi-line indicator is named', () => {
  const rows = []
  for (const d of DEFS) {
    if (drawn(R.getDefinition(d)).length < 2) continue
    let opts = null
    try { opts = styleOptionsOf(csWith(d), R, `inst:${d}:1`) } catch { opts = null }
    for (const pl of opts?.dotSize?.plots || []) rows.push([d, pl.plotKey, pl.current === 'large' ? 'small' : 'large'])
  }
  it(`${rows.length} dot outputs`, () => {
    expect(rows.length).toBeGreaterThan(3)
    const miss = []
    for (const [d, plotKey, size] of rows) {
      const plot = drawn(R.getDefinition(d)).find(p => p.key === plotKey)
      const x = planned(d, { property: 'dotSize', value: size, output: plotKey })
      if (!x.change) { miss.push(`${d}.${plotKey}: not planned (${x.why})`); continue }
      const want = new RegExp(`^Changed ${x.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'s ${String(plot.label || plot.key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} dot size on ${CHART.replace(/[()]/g, '\\$&')} — `)
      for (const l of lines(x)) if (!want.test(l)) miss.push(`${d}.${plotKey}: ${l}`)
    }
    expect(miss).toEqual([])
  })
})

describe('(5) unchanged: one output, an instance-level control, an unreadable definition', () => {
  it('every ONE-colour indicator keeps "Changed <name>\'s color …" exactly', () => {
    const one = DEFS.filter(d => colorInputs(R.getDefinition(d)).length === 1)
    expect(one.length).toBeGreaterThan(20)
    const miss = []
    for (const d of one) {
      const x = planned(d, { property: 'color', value: NEW, output: null })
      if (!x.change) { miss.push(`${d}: not planned (${x.why})`); continue }
      const want = `Changed ${x.name}'s color on ${CHART} to ${colorName(NEW)}.`
      for (const l of lines(x)) if (l !== want) miss.push(`${d}: ${l}`)
    }
    expect(miss).toEqual([])
  })
  it('a ONE-line indicator\'s plot style keeps its sentence (the key in brackets, as before)', () => {
    const one = DEFS.filter(d => drawn(R.getDefinition(d)).length === 1)
    let n = 0
    for (const d of one) {
      let opts = null
      try { opts = styleOptionsOf(csWith(d), R, `inst:${d}:1`) } catch { opts = null }
      const s = (opts?.plotStyles || [])[0]
      const v = s?.options.find(o => o !== s.current)
      if (!v) continue
      const x = planned(d, { property: 'plotStyle', value: v, output: s.plotKey })
      if (!x.change) continue
      n++
      for (const l of lines(x)) expect(l, d).toBe(`Changed how ${x.name} (${s.plotKey}) is drawn on ${CHART} — ${x.change.before || 'default'} → ${v}.`)
    }
    expect(n).toBeGreaterThan(5)
  })
  it('line width / line style (instance-level: no output in the contract) name no output', () => {
    for (const [key, before, after, want] of [['lineWidth', 1, 2, '1 → 2'], ['lineStyle', 'solid', 'dashed', 'solid → dashed']]) {
      for (const d of ['movingAverage', 'macd', 'ichimoku']) {
        const l = extReceiptLine({ op: 'setAppearance', change: { what: 'appearance', key, before, after }, defId: d }, 'X', ` on ${CHART}`)
        expect(l).toBe(`Changed X's ${key === 'lineWidth' ? 'line width' : 'line style'} on ${CHART} — ${want}.`)
      }
    }
  })
  it('an unknown definition, a missing target or plotKey → the old sentence', () => {
    expect(styledOutputWord('nope', { target: 'input:signalColor' })).toBeNull()
    expect(styledOutputWord('macd', { target: 'input:nope' })).toBeNull()
    expect(styledOutputWord('macd', { plotKey: 'nope' })).toBeNull()
    expect(styledOutputWord(null, { target: 'input:signalColor' })).toBeNull()
    expect(extReceiptLine({ op: 'setColor', change: { target: 'input:signalColor', after: '#ff8800' } }, 'MACD', '')).toBe(`Changed MACD's color to ${colorName('#ff8800')}.`)
  })
})
