// P1 truth matrix, slice "intent" — AUTHORING INTENT + TYPED PRESENTATION.
//
// Intent (PLOT / SIGNAL / VALUE) is authoring metadata: it picks the read-back,
// the default presentation and the consumer requested. It NEVER sets a type
// (`outputType.outputTypeOf` is the one authority) and every permission is the
// shared gate's (`evaluability`). Presentation uses master's existing
// primitives only: `markers` plots, `paints[]` (bgcolor / barcolor), per-point
// `colorMode`. UNKNOWN never paints a condition colour on a semantics-2 document.
//
// Every case states ASKED / CLAIMED / DID and its outcome class.
// Component half: `builder/BuilderSheet.intent.test.jsx`.
import { describe, it, expect } from 'vitest'
import { parseFormula } from '../ast/parse'
import { outputTypeOf, OUTPUT_TYPES } from '../outputType'
import { STATUS, GATE_GUARDS, LANES } from '../evaluability'
import { CHART_SCALAR_GUARD } from '../chartScalars'
import { createBinder, paintColoursFor, unknownColourRule } from '../binder'
import { markersFor } from '../markerPrimitive'
import { validateDefinition } from '../defSchema'
import { createFakeChart } from '../__tests__/fakeChart'
import {
  INTENTS, intentReadback, defaultIntentFor, signalOutputFor, signalPaintsFor, signalPaintsOf,
  presentationVerdict, markerRequestProblem, NO_PAINT,
} from '../../builder/authoringIntent'
import { buildDefinition, applySignalLook } from '../../builder/BuilderSheet'
import { infoValueRefFor, requestInfoValue, addedInstanceId } from '../../builder/infoValueDoor'

const P = (src) => {
  const r = parseFormula(src)
  if (!r.ok) throw new Error(`${src}: ${JSON.stringify(r)}`)
  return r.ast
}
const one = (src, meta = { semantics: 2 }) => ({ id: 'u_0000000p1i01', version: 1,
  plots: [{ key: 'value', style: 'line' }], compute: { kind: 'ast', fn: 'x', ast: P(src) }, meta })
const many = (srcs, meta = { semantics: 2 }) => {
  const trees = Object.fromEntries(Object.entries(srcs).map(([k, s]) => [k, P(s)]))
  const keys = Object.keys(trees)
  return { id: 'u_0000000p1i02', version: 1, plots: keys.map((k) => ({ key: k, style: 'line', label: k })),
    compute: { kind: 'ast', fn: 'y', ast: trees[keys[0]], trees, scanPlot: keys[0] }, meta }
}
const SEM2 = { semantics: 2 }
const PINE = { recurrenceOrigin: 'pine' }
const LEGACY = {}

describe('P1 intent — 5: VALUE intent on a SERIES stays a SERIES', () => {
  it('5a VALUE — ASKED "show the latest value of sma(close,20)"; CLAIMED its latest value; DID: type stays SERIES, info-value lane supported (EXACT)', () => {
    const d = one('sma(close, 20)')
    const rb = intentReadback(d, INTENTS.VALUE)
    expect(rb.selectedKey).toBe('value')
    const o = rb.outputs[0]
    expect(o.type).toBe(OUTPUT_TYPES.SERIES)
    expect(o.lane).toBe(LANES.INFO_VALUE)
    expect(o.verdict.status).toBe(STATUS.SUPPORTED)
    expect(rb.blocking).toBeNull()
    // the intent is not an input to the type authority
    expect(outputTypeOf({ ...d, intent: 'value', meta: { ...d.meta, authoringIntent: 'value' } }, 'value').type)
      .toBe(OUTPUT_TYPES.SERIES)
  })

  it('5b VALUE on a CONDITION — ASKED value of close > open; CLAIMED a 1/0 value; DID: stays CONDITION (format is presentation, not a type)', () => {
    const rb = intentReadback(one('close > open'), INTENTS.VALUE)
    expect(rb.outputs[0].type).toBe(OUTPUT_TYPES.CONDITION)
    expect(rb.outputs[0].verdict.status).toBe(STATUS.SUPPORTED)
  })

  it('5c VALUE on a current-only scalar — ASKED latest market_cap; CLAIMED nothing false; DID: SCALAR refused on info-value (REFUSAL)', () => {
    const rb = intentReadback(one('market_cap'), INTENTS.VALUE)
    expect(rb.outputs[0].type).toBe(OUTPUT_TYPES.SCALAR)
    expect(rb.outputs[0].verdict.guard).toBe(CHART_SCALAR_GUARD)
    expect(rb.blocking).toBeTruthy()
  })

  it('5d the request is a REFERENCE {instanceId, plotKey, format} to the instance just added — never a name, never a formula (EXACT)', () => {
    const before = { indicatorInstances: [{ instanceId: 'u_x:1', defId: 'u_x' }] }
    const after = { indicatorInstances: [...before.indicatorInstances, { instanceId: 'u_x:2', defId: 'u_x' }] }
    const id = addedInstanceId(before, after, 'u_x')
    expect(id).toBe('u_x:2')
    const ref = infoValueRefFor({ instanceId: id, plotKey: 'value' })
    expect(Object.keys(ref).sort()).toEqual(['format', 'instanceId', 'plotKey'])
    // ⚠️ on this branch the info slice is not integrated: the door says so (no false claim)
    const req = requestInfoValue(after, ref)
    expect(req.added).toBe(false)
    expect(req.settings).toBe(after)
    expect(req.reason).toMatch(/not available/)
  })
})

describe('P1 intent — 6: the SIGNAL intent cannot lie (UI side)', () => {
  it('6a SIGNAL on a number — ASKED "signal when sma(close,20)"; CLAIMED a signal; DID: refused signal:numeric-output, nothing converted (REFUSAL)', () => {
    const d = one('sma(close, 20)')
    const rb = intentReadback(d, INTENTS.SIGNAL)
    expect(rb.outputs[0].type).toBe(OUTPUT_TYPES.SERIES)
    expect(rb.outputs[0].verdict.guard).toBe(GATE_GUARDS.SIGNAL_NUMERIC)
    expect(rb.blocking).toMatch(/not a yes\/no/)
    expect(signalOutputFor(d)).toBeNull() // a SERIES is never the default signal
    // and the presentation helper never gets to paint it
    expect(presentationVerdict(d, 'value', { paints: signalPaintsFor('value', { barcolor: '#ff0000' }) }).status)
      .toBe(STATUS.REFUSED)
  })

  it('6b SIGNAL picks the CONDITION of a mixed document; the SERIES sibling is still drawn, not refused (EXACT)', () => {
    const d = many({ ma: 'sma(close, 20)', up: 'close > sma(close, 20)' })
    expect(signalOutputFor(d)).toBe('up')
    const rb = intentReadback(d, INTENTS.SIGNAL)
    expect(rb.selectedKey).toBe('up')
    expect(rb.blocking).toBeNull()
    const ma = rb.outputs.find((o) => o.key === 'ma')
    expect(ma.lane).toBe(LANES.CHART)
    expect(ma.verdict.status).toBe(STATUS.SUPPORTED)
    expect(rb.status).toBe('ok')
  })

  it('6c a member PICKING the SERIES as the signal is refused, not converted (REFUSAL)', () => {
    const d = many({ ma: 'sma(close, 20)', up: 'close > sma(close, 20)' })
    const rb = intentReadback(d, INTENTS.SIGNAL, { requestedKey: 'ma' })
    expect(rb.selectedKey).toBe('ma')
    expect(rb.blocking).toMatch(/compare it to something/)
  })

  it('6d one valid + one invalid output is PARTIAL, never presented as fully successful (PARTIAL)', () => {
    const d = many({ ma: 'sma(close, 20)', cap: 'market_cap > 1e9' })
    const rb = intentReadback(d, INTENTS.PLOT)
    expect(rb.status).toBe('partial')
    expect(rb.outputs.find((o) => o.key === 'cap').verdict.guard).toBe(CHART_SCALAR_GUARD)
    expect(rb.blocking).toBeNull() // PLOT discloses; the chart draws the one it can
  })

  it('6e reopen re-derives the intent from the derived type — never from stored metadata (EXACT)', () => {
    expect(defaultIntentFor(one('close > open'))).toBe(INTENTS.SIGNAL)
    expect(defaultIntentFor(one('sma(close, 20)'))).toBe(INTENTS.PLOT)
    expect(defaultIntentFor({ ...one('sma(close, 20)'), meta: { semantics: 2, authoringIntent: 'signal' } })).toBe(INTENTS.PLOT)
  })

  it('6f a marker the renderer cannot draw is REFUSED, never coerced to a neighbour (REFUSAL)', () => {
    expect(markerRequestProblem({ shape: 'cross' })).toMatch(/cannot be drawn/)
    expect(markerRequestProblem({ shape: 'circle', position: 'top' })).toMatch(/cannot sit/)
    expect(markerRequestProblem({ shape: 'circle', text: 'x'.repeat(25) })).toMatch(/24/)
    expect(markerRequestProblem({ shape: 'arrowUp', position: 'belowBar' })).toBeNull()
    // a marker on a NUMBER is disclosed by the gate ("drawn where > 0")
    expect(presentationVerdict(one('sma(close, 20)'), 'value', { marker: { shape: 'circle' } }).status)
      .toBe(STATUS.DISCLOSED)
  })

  it('6g the SIGNAL presentation becomes the canonical document through buildDefinition, and the schema accepts it (EXACT)', () => {
    const ast = P('close > sma(close, 20)')
    const row = { key: 'value', label: '', source: 'close > sma(close, 20)', ast, mode: 'non-repainting',
      readback: 'x', style: 'line', color: '#c9a84c', width: 1 }
    const { rows, paints } = applySignalLook([row], 'value',
      { marker: { shape: 'arrowUp', position: 'belowBar' }, barcolor: '#26a69a', bgcolor: '#26a69a' })
    const doc = buildDefinition({ defId: 'u_0000000p1i03', name: 'Sig', source: row.source, ast,
      mode: 'non-repainting', readback: 'x', plots: rows, paints })
    expect(doc.plots[0]).toMatchObject({ style: 'markers', marker: { shape: 'arrowUp', position: 'belowBar' } })
    expect(doc.paints.map((p) => [p.kind, p.colorMode, p.colorDown])).toEqual([
      ['barcolor', 'column:value', NO_PAINT], ['bgcolor', 'column:value', NO_PAINT]])
    const v = validateDefinition(doc)
    expect(v.errors || []).toEqual([])
    expect(signalPaintsOf(doc, 'value')).toEqual({ barcolor: '#26a69a', bgcolor: '#26a69a' })
    // no presentation ⇒ no `paints` key at all (every existing document unchanged)
    const plain = buildDefinition({ defId: 'u_0000000p1i03', name: 'Sig', source: row.source, ast,
      mode: 'non-repainting', readback: 'x' })
    expect('paints' in plain).toBe(false)
  })
})

describe('P1 intent — 12: UNKNOWN signal presentation (markers)', () => {
  const times = [1, 2, 3, 4]
  it('12a an UNKNOWN marker column draws NO marker, on every semantics (UNKNOWN)', () => {
    const m = markersFor({ column: [1, NaN, 0, 1], times, marker: { shape: 'arrowUp' }, color: '#fff' })
    expect(m.map((x) => x.time)).toEqual([1, 4])
  })
  it('12b a two-tone marker whose colour condition is UNKNOWN takes its OWN colour on semantics 2 — never colorDown (UNKNOWN)', () => {
    const args = { column: [1, 1, 1], times, marker: { shape: 'circle' }, color: '#base',
      condColumn: [1, NaN, 0], colorUp: '#up', colorDown: '#down' }
    expect(markersFor({ ...args, unknownNone: unknownColourRule({ meta: SEM2 }) }).map((x) => x.color))
      .toEqual(['#up', '#base', '#down'])
  })
  it('12c …and a Pine translation keeps owner ruling 2 (na takes the else branch) byte for byte (EXACT)', () => {
    const args = { column: [1, 1, 1], times, marker: { shape: 'circle' }, color: '#base',
      condColumn: [1, NaN, 0], colorUp: '#up', colorDown: '#down' }
    expect(unknownColourRule({ meta: { ...PINE, semantics: 2 } })).toBe(false) // a forged stamp is ignored
    expect(markersFor({ ...args, unknownNone: unknownColourRule({ meta: PINE }) }).map((x) => x.color))
      .toEqual(['#up', '#down', '#down'])
    expect(unknownColourRule({ meta: LEGACY })).toBe(false)
  })
})

// ── a real binder over a fake chart ──────────────────────────────────────────
const BARS = Array.from({ length: 4 }, (_, i) => ({ t: 1700000000 + i * 86400, o: 1, h: 2, l: 0, c: 1 + (i % 2) }))
const doc = (id, meta, { paints = [], plots } = {}) => ({
  id, schemaVersion: 2, label: id, inputs: [], meta,
  placement: { target: 'price' },
  plots: plots || [
    { key: 'value', label: 'V', style: 'line', legend: { decimals: 2 } },
    { key: 'cond', label: '', style: 'line', hidden: true },
  ],
  paints,
})
function harness(defs, cols) {
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const candles = fake.chart.addSeries(fake.LWC.CandlestickSeries, {}, 0)
  const handed = []
  const registry = {
    getDefinition: (id) => defs.get(id) || null,
    computeFor: () => cols,
    hasAnyFinite: (col) => Array.isArray(col) && col.some(Number.isFinite),
    columnKeys: (d) => (d.plots || []).map((p) => p.key),
  }
  const run = (instances) => binder.sync({
    enabled: instances.length > 0, instances, registry, bars: BARS, adjustTime: (t) => t,
    plan: { fresh: true }, applyData: (s, data) => s.setData(data),
    resolvePlacement: () => ({ paneIndex: 0, scaleId: 'right', scaleOptions: null }),
    priceSeries: () => candles, setBarColours: (m) => handed.push(m),
  })
  const calls = (m) => fake.calls.filter((c) => c.method === m)
  return { run, calls, handed }
}
const inst = (defId) => ({ instanceId: `i:${defId}`, defId, inputs: {} })
const COND = { value: [1, 2, 3, 4], cond: [1, NaN, 0, 1] }
const TWO = { colorMode: 'column:cond', colorUp: '#00ff00', colorDown: '#ff0000' }

describe('P1 intent — 13: UNKNOWN drives NO condition paint (never the "down" colour), per channel', () => {
  it('13a barcolor — ASKED green when true / red when false; bar 2 UNKNOWN; DID: semantics 2 leaves bar 2 its own colour (UNKNOWN)', () => {
    const h = harness(new Map([['u_s', doc('u_s', SEM2, { paints: [{ kind: 'barcolor', ...TWO }] })]]), COND)
    h.run([inst('u_s')])
    const m = h.handed[h.handed.length - 1]
    expect(m.get(String(BARS[1].t))).toBeUndefined()
    expect(m.get(String(BARS[0].t))).toBe('#00ff00')
    expect(m.get(String(BARS[2].t))).toBe('#ff0000')
  })

  it('13b barcolor — the SAME document translated from Pine keeps owner ruling 2: bar 2 is red (EXACT, vendor fidelity)', () => {
    const h = harness(new Map([['u_p', doc('u_p', PINE, { paints: [{ kind: 'barcolor', ...TWO }] })]]), COND)
    h.run([inst('u_p')])
    expect(h.handed[h.handed.length - 1].get(String(BARS[1].t))).toBe('#ff0000')
  })

  it('13c bgcolor — semantics 2: an UNKNOWN bar draws no background (UNKNOWN)', () => {
    const p = { kind: 'bgcolor', ...TWO }
    expect(paintColoursFor(p, 'i', new Map([['i::cond', COND.cond]]), 4, { unknownNone: true })).toBeTruthy()
    const h = harness(new Map([['u_s', doc('u_s', SEM2, { paints: [p] })]]), COND)
    h.run([inst('u_s')])
    const colours = h.calls('attachPrimitive')[0].args[0].options().colors
    expect(colours[1]).toBeNull()
    expect(colours[2]).toBe('#ff0000')
  })

  it('13d line per-point colour (`cond ? up : down`) — semantics 2: an UNKNOWN condition draws the plot\'s OWN colour, not down (UNKNOWN; decision documented)', () => {
    const plots = [
      { key: 'value', label: 'V', style: 'line', color: '#c9a84c', legend: { decimals: 2 }, ...TWO },
      { key: 'cond', label: '', style: 'line', hidden: true },
    ]
    const pts = (meta) => {
      const fakeRun = harness(new Map([['u_l', doc('u_l', meta, { plots })]]), COND)
      fakeRun.run([inst('u_l')])
      const sets = fakeRun.calls('setData').map((c) => c.args[0])
        .filter((d) => Array.isArray(d) && d.length === 4 && d[0].value === 1)
      return sets[sets.length - 1].map((x) => x.color)
    }
    expect(pts(SEM2)).toEqual(['#00ff00', undefined, '#ff0000', '#00ff00'])
    expect(pts(PINE)).toEqual(['#00ff00', '#ff0000', '#ff0000', '#00ff00'])
  })

  it('13e the builder\'s own SIGNAL paints draw nothing on false AND unknown, on every semantics (UNKNOWN)', () => {
    const [bar] = signalPaintsFor('cond', { barcolor: '#26a69a' })
    for (const meta of [SEM2, LEGACY]) {
      const h = harness(new Map([['u_b', doc('u_b', meta, { paints: [bar] })]]), COND)
      h.run([inst('u_b')])
      expect([...h.handed[h.handed.length - 1].keys()]).toEqual([String(BARS[0].t), String(BARS[3].t)])
    }
  })
})

describe('P1 intent — paint priority is deterministic', () => {
  const STATIC = (c) => ({ kind: 'bgcolor', color: c })
  // ⚠️ Two instances that each bind their OWN series stack by SERIES order (a
  // background primitive is zOrder 'bottom' on its host series), which the
  // pane's series order (`paneSeriesOrder`) already decides. Paint-only
  // overlays share ONE host (the candles) — that is where attach history used
  // to decide, and where the instance order now does.
  it('P1 bgcolor: on a shared host the LATER instance in the chart\'s instance order is stacked on top, even after a reorder (EXACT)', () => {
    const only = { plots: [{ key: 'cond', label: '', style: 'line', hidden: true }] }
    const defs = new Map([['u_a', doc('u_a', SEM2, { ...only, paints: [STATIC('#aa0000')] })],
      ['u_b', doc('u_b', SEM2, { ...only, paints: [STATIC('#00bb00')] })]])
    const h = harness(defs, COND)
    h.run([inst('u_a'), inst('u_b')])
    const colourOf = (call) => call.args[0].options().colors[0]
    expect(h.calls('attachPrimitive').map(colourOf)).toEqual(['#aa0000', '#00bb00'])
    // the member reorders: b before a → a must now be on top
    h.run([inst('u_b'), inst('u_a')])
    const att = h.calls('attachPrimitive').map(colourOf)
    expect(att.slice(-2)).toEqual(['#00bb00', '#aa0000'])
    // a steady pass re-attaches nothing
    const n = h.calls('attachPrimitive').length
    h.run([inst('u_b'), inst('u_a')])
    expect(h.calls('attachPrimitive').length).toBe(n)
  })

  it('P2 barcolor: within one definition the LATER paint wins; two definitions that disagree leave the bar its own colour (EXACT, unchanged)', () => {
    const red = { kind: 'barcolor', color: '#ff0000' }
    const blue = { kind: 'barcolor', color: '#0000ff' }
    const h = harness(new Map([['u_d', doc('u_d', SEM2, { paints: [red, blue] })]]), COND)
    h.run([inst('u_d')])
    expect([...h.handed[0].values()]).toEqual(Array(4).fill('#0000ff'))
    const h2 = harness(new Map([['u_d', doc('u_d', SEM2, { paints: [red] })], ['u_e', doc('u_e', SEM2, { paints: [blue] })]]), COND)
    const res = h2.run([inst('u_d'), inst('u_e')])
    expect(h2.handed).toEqual([]) // nothing to override: every bar keeps its own colour
    expect(res).toBeTruthy()
  })
})
