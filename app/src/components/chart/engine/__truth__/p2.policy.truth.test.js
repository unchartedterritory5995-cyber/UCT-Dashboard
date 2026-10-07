// P2 truth matrix, slice "policy" — the LOCKED owner policies, browser lane.
//
//   P2-policy 2  condition-driven candle colour: the LATER stored instance wins
//   P2-policy 3/4 unknown presentation (semantics 2) vs legacy / Pine (unchanged)
//   P2-policy 6  IS TRUE is episodic (shared fixture p2_is_true_episodes.json)
//   P2-policy 7  scalar sibling: alert evaluability is PER OUTPUT
//   P2-presentation  server-side presentation validation parity
//                    (shared fixture p2_presentation_schema.json)
//   P2-preserve  an edit that changes maths keeps unrelated presentation
//
// Server half: tests/test_p2_truth_policy.py. Component half of preservation:
// builder/BuilderSheet.presentationPreserve.test.jsx.
//
// Every case states ASKED / CLAIMED / DID and its outcome class.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createBinder, unknownColourRule } from '../binder'
import { markersFor } from '../markerPrimitive'
import { createFakeChart } from '../__tests__/fakeChart'
import {
  validateDefinition, PLOT_STYLES, RESERVED_PLOT_STYLES, MARKER_SHAPES, MARKER_POSITIONS,
  MARKER_SIZE_RANGE, PAINT_KINDS, COLOR_MODES,
} from '../defSchema'
import { evaluability, LANES, STATUS } from '../evaluability'
import { parseFormula } from '../ast/parse'
import { policyFires, TRIGGER_POLICIES } from '../triggerPolicy'
import { buildDefinition } from '../../builder/BuilderSheet'
import { BUILDER_INPUT_SCOPE } from '../../builder/builderInputs'
import { evaluateFormula } from '../../builder/FormulaField'
import {
  preservePresentation, restorableRowFields, builderOwnedPaintIndexes,
} from '../../builder/presentationPreserve'
import { NO_PAINT, signalPaintsFor } from '../../builder/authoringIntent'

const FIX = path.resolve(process.cwd(), '..', 'tests/fixtures/ast')
const read = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'))
const EPISODES = read('p2_is_true_episodes.json')
const P1_POLICY = read('p1_trigger_policy.json')
const ALERT_FIX = read('p1_evaluability_alert.json')
const SCHEMA_FIX = read('p2_presentation_schema.json')

const SEM2 = { semantics: 2 }
const PINE = { recurrenceOrigin: 'pine' }
const LEGACY = {}

// ── a real binder over a fake chart (the p1.intent harness) ───────────────────
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
const lastMap = (h) => h.handed[h.handed.length - 1]

describe('P2-policy 2 — condition-driven candle colour: the LATER stored instance wins', () => {
  const RED = { kind: 'barcolor', color: '#ff0000' }
  const BLUE = { kind: 'barcolor', color: '#0000ff' }
  const defs = () => new Map([['u_r', doc('u_r', SEM2, { paints: [RED] })], ['u_b', doc('u_b', SEM2, { paints: [BLUE] })]])

  it('ASKED two instances painting the same bars · CLAIMED the later stored instance wins · DID paint every bar blue (EXACT)', () => {
    const h = harness(defs(), COND)
    const res = h.run([inst('u_r'), inst('u_b')])
    expect([...lastMap(h).values()]).toEqual(Array(4).fill('#0000ff'))
    expect(res.paints.conflicts).toBe(4)
  })

  it('ASKED the same two, REORDERED · CLAIMED the winner flips with the stored order · DID paint every bar red (EXACT)', () => {
    const h = harness(defs(), COND)
    h.run([inst('u_b'), inst('u_r')])
    expect([...lastMap(h).values()]).toEqual(Array(4).fill('#ff0000'))
  })

  it('ASKED a reorder on a LIVE chart · CLAIMED the overrides are re-handed once, then steady · DID (EXACT, no churn)', () => {
    const h = harness(defs(), COND)
    h.run([inst('u_r'), inst('u_b')])
    h.run([inst('u_b'), inst('u_r')])
    expect([...lastMap(h).values()]).toEqual(Array(4).fill('#ff0000'))
    const n = h.handed.length
    h.run([inst('u_b'), inst('u_r')])
    expect(h.handed.length).toBe(n)
  })

  it('ASKED a later CONDITION paint that is false/unknown on some bars · CLAIMED it only takes the bars it colours · DID leave the earlier instance on the rest (EXACT)', () => {
    // later instance paints green where cond is true, NOTHING where false/unknown (the builder's own SIGNAL paint)
    const [sig] = signalPaintsFor('cond', { barcolor: '#00ff00' })
    const h = harness(new Map([['u_r', doc('u_r', SEM2, { paints: [RED] })], ['u_s', doc('u_s', SEM2, { paints: [sig] })]]), COND)
    h.run([inst('u_r'), inst('u_s')])
    expect([...lastMap(h).values()]).toEqual(['#00ff00', '#ff0000', '#ff0000', '#00ff00'])
  })

  it('ASKED two paints inside ONE definition · CLAIMED the later paint wins (Pine RT6 vendor rule, unchanged) · DID (EXACT)', () => {
    const h = harness(new Map([['u_d', doc('u_d', SEM2, { paints: [RED, BLUE] })]]), COND)
    h.run([inst('u_d')])
    expect([...lastMap(h).values()]).toEqual(Array(4).fill('#0000ff'))
  })

  it('ASKED a hidden later instance · CLAIMED a hidden instance paints nothing, so the earlier one stands · DID (EXACT)', () => {
    const h = harness(defs(), COND)
    h.run([inst('u_r'), { ...inst('u_b'), hidden: true }])
    expect([...lastMap(h).values()]).toEqual(Array(4).fill('#ff0000'))
  })
})

describe('P2-policy 3/4 — UNKNOWN presentation: semantics 2 vs legacy vs Pine (bar 2 is UNKNOWN)', () => {
  const linePoints = (meta) => {
    const plots = [
      { key: 'value', label: 'V', style: 'line', color: '#c9a84c', legend: { decimals: 2 }, ...TWO },
      { key: 'cond', label: '', style: 'line', hidden: true },
    ]
    const h = harness(new Map([['u_l', doc('u_l', meta, { plots })]]), COND)
    h.run([inst('u_l')])
    const sets = h.calls('setData').map((c) => c.args[0]).filter((d) => Array.isArray(d) && d.length === 4 && d[0].value === 1)
    return sets[sets.length - 1].map((x) => x.color)
  }
  const barAt1 = (meta) => {
    const h = harness(new Map([['u_x', doc('u_x', meta, { paints: [{ kind: 'barcolor', ...TWO }] })]]), COND)
    h.run([inst('u_x')])
    return lastMap(h).get(String(BARS[1].t))
  }
  const bgAt1 = (meta) => {
    const h = harness(new Map([['u_x', doc('u_x', meta, { paints: [{ kind: 'bgcolor', ...TWO }] })]]), COND)
    h.run([inst('u_x')])
    return h.calls('attachPrimitive')[0].args[0].options().colors[1]
  }

  it('numeric line — ASKED cond ? up : down · CLAIMED sem2 UNKNOWN → base colour; legacy and Pine → down (unchanged) · DID', () => {
    expect(linePoints(SEM2)[1]).toBeUndefined() // undefined point colour = the series (base) colour
    expect(linePoints(LEGACY)[1]).toBe('#ff0000')
    expect(linePoints(PINE)[1]).toBe('#ff0000')
  })
  it('candle condition — CLAIMED sem2 UNKNOWN → no paint (bar keeps its own colour); legacy and Pine → down · DID', () => {
    expect(barAt1(SEM2)).toBeUndefined()
    expect(barAt1(LEGACY)).toBe('#ff0000')
    expect(barAt1(PINE)).toBe('#ff0000')
  })
  it('background condition — CLAIMED sem2 UNKNOWN → no paint; legacy and Pine → down · DID', () => {
    expect(bgAt1(SEM2)).toBeNull()
    expect(bgAt1(LEGACY)).toBe('#ff0000')
    expect(bgAt1(PINE)).toBe('#ff0000')
  })
  it('marker condition — CLAIMED UNKNOWN → no marker, on every semantics · DID (UNKNOWN)', () => {
    for (const meta of [SEM2, LEGACY, PINE]) {
      const m = markersFor({ column: [1, NaN, 0, 1], times: [1, 2, 3, 4], marker: { shape: 'arrowUp' }, color: '#fff',
        unknownNone: unknownColourRule({ meta }) })
      expect(m.map((x) => x.time)).toEqual([1, 4])
    }
  })
  it('a forged semantics stamp on a Pine document — CLAIMED Pine keeps Pine · DID (EXACT)', () => {
    expect(unknownColourRule({ meta: { ...PINE, semantics: 2 } })).toBe(false)
    expect(barAt1({ ...PINE, semantics: 2 })).toBe('#ff0000')
  })
})

describe('P2-policy 6 — IS TRUE is episodic (shared fixture, both lanes)', () => {
  const column = (closes) => closes.map((c) => (c === null ? null : (c > 100 ? 1 : 0)))
  for (const seq of EPISODES.sequences) {
    it(`${seq.id} — ASKED is_true over ${seq.id} · CLAIMED ${JSON.stringify(seq.fires)} · DID match`, () => {
      expect(policyFires(TRIGGER_POLICIES.IS_TRUE, column(seq.closes))).toEqual(seq.fires)
    })
  }
  it('the owner sequences are all present (F→T, T→T, T→F→T, T→U→T, T→U→F→T, U→T)', () => {
    const ids = EPISODES.sequences.map((s) => s.id)
    for (const id of ['F-T', 'T-T', 'T-F-T', 'T-U-T', 'T-U-F-T', 'U-T']) expect(ids).toContain(id)
  })
  it('P2X owner lock — ARM→U stays armed, T latches, U stays latched (no re-arm, episode not ended), F re-arms, T fires; arm-while-true fires on the first KNOWN true', () => {
    // ASKED the full owner state machine · CLAIMED each leg pinned by a named
    // fixture sequence (the server lane runs the SAME rows through the real cycle) · DID
    const ids = EPISODES.sequences.map((s) => s.id)
    for (const id of ['U-U-T', 'T-U-U-T', 'T-F-U-T', 'U-T-U-T', 'U-T-U-F-U-T', 'T-T']) expect(ids).toContain(id)
    const fires = (id) => EPISODES.sequences.find((s) => s.id === id).fires
    expect(fires('U-U-T')).toEqual([false, false, true])          // ARM→U→U→T fires
    expect(fires('T-U-U-T')).toEqual([true, false, false, false]) // latched through U, no refire
    expect(fires('T-F-U-T')).toEqual([true, false, false, true])  // F re-arms, U keeps it armed
    expect(fires('T-T')[0]).toBe(true)                            // armed while true → first known true fires
  })
  it('the P1 transition fixture agrees for ALL three policies (bar 0 unjudged there) — no policy moved', () => {
    for (const t of P1_POLICY.transitions) {
      for (const policy of Object.keys(t.fires)) {
        expect(policyFires(policy, t.column).slice(1)).toEqual(t.fires[policy])
      }
    }
  })
  it('NaN is UNKNOWN exactly like null (the engine column carries NaN)', () => {
    expect(policyFires('is_true', [1, NaN, 1])).toEqual([true, false, false])
    expect(policyFires('becomes_true', [0, NaN, 1])).toEqual([false, false, false])
  })
})

describe('P2-policy 7 — scalar sibling: alert evaluability is PER OUTPUT', () => {
  const P = (s) => { const r = parseFormula(s); if (!r.ok) throw new Error(s); return r.ast }
  const two = () => ({ id: 'u_00000000p2s1', version: 1,
    plots: [{ key: 'sig', style: 'line' }, { key: 'cap', style: 'line' }],
    compute: { kind: 'ast', fn: 'x', ast: P('close > 100'), trees: { sig: P('close > 100'), cap: P('market_cap > 1e9') }, scanPlot: 'sig' } })

  it('ASKED alert on the CONDITION sibling of a scalar plot · CLAIMED admitted (was: refused for the whole definition) · DID supported (VALUE)', () => {
    const v = evaluability(two(), 'sig', LANES.ALERT)
    expect(v.status).toBe(STATUS.SUPPORTED)
  })
  it('ASKED alert on the SCALAR plot itself · CLAIMED still refused, gate scalar · DID (REFUSAL)', () => {
    const v = evaluability(two(), 'cap', LANES.ALERT)
    expect(v.status).toBe(STATUS.REFUSED)
    expect(v.gate).toBe('scalar')
    expect(v.codes).toEqual(['market_cap'])
  })
  it('a `plot` refusal (v2 claim with no tree for a plot) STILL refuses the whole definition (unchanged)', () => {
    const c = ALERT_FIX.cases.find((x) => x.name === 'v2 claim, plot c has no tree :: a')
    expect(evaluability(c.definition, c.plotKey, LANES.ALERT).gate).toBe('plot')
  })
  it('the shared fixture: both deliberately-moved cases are supported, the scalar plots stay refused', () => {
    const by = (n) => ALERT_FIX.cases.find((x) => x.name === n)
    for (const n of ['multi plain + scalar :: a', 'multi scalar + plain :: b']) {
      const c = by(n)
      expect(c.expect.status).toBe('supported')
      expect(evaluability(c.definition, c.plotKey, LANES.ALERT).status).toBe(STATUS.SUPPORTED)
    }
    for (const n of ['multi plain + scalar :: b', 'multi scalar + plain :: a']) {
      const c = by(n)
      expect(evaluability(c.definition, c.plotKey, LANES.ALERT).gate).toBe('scalar')
    }
  })
})

// ── the base document for the presentation fixture: the builder's own body ────
function row(key, source, extra = {}) {
  const ev = evaluateFormula(source, BUILDER_INPUT_SCOPE)
  if (!ev.ok) throw new Error(`${source}: ${ev.error}`)
  return { key, label: '', source, ast: ev.ast, mode: ev.verdict.mode, readback: ev.readback,
    style: 'line', color: '#2962ff', width: 2, ...extra }
}
function schemaBase() {
  return buildDefinition({
    defId: 'u_00000000p2v1', name: 'Base', version: 1, rev: 1,
    plots: [
      row('value', 'sma(close, 5)'),
      row('cond', 'close > open', { hidden: true }),
      row('sig', 'close > sma(close, 5)', { style: 'markers', marker: { shape: 'circle' } }),
    ],
    scanPlot: 'value',
  })
}
function applyCase(base, c) {
  const d = JSON.parse(JSON.stringify(base))
  for (const [key, patch] of Object.entries(c.plots || {})) {
    const p = d.plots.find((x) => x.key === key)
    for (const [f, v] of Object.entries(patch)) { if (v === null) delete p[f]; else p[f] = v }
  }
  if ('paints' in c) d.paints = c.paints
  return d
}

describe('P2-presentation — the server validator mirrors defSchema (shared fixture)', () => {
  it('the vocabulary in the fixture IS defSchema\'s (a drift reds here and in the server rail)', () => {
    const v = SCHEMA_FIX.vocab
    expect([...PLOT_STYLES]).toEqual(v.plotStyles)
    expect([...RESERVED_PLOT_STYLES]).toEqual(v.reservedPlotStyles)
    expect([...MARKER_SHAPES]).toEqual(v.markerShapes)
    expect([...MARKER_POSITIONS]).toEqual(v.markerPositions)
    expect({ ...MARKER_SIZE_RANGE }).toEqual(v.markerSizeRange)
    expect([...PAINT_KINDS]).toEqual(v.paintKinds)
    expect([...COLOR_MODES]).toEqual(v.colorModes)
  })
  const base = schemaBase()
  it('the base document is valid', () => { expect(validateDefinition(base).ok).toBe(true) })
  for (const c of SCHEMA_FIX.cases) {
    it(`${c.name} — CLAIMED ${c.expect}${c.code ? ` (${c.code})` : ''} · DID: defSchema agrees`, () => {
      const r = validateDefinition(applyCase(base, c))
      if (c.expect === 'ok') {
        expect(r.errors || []).toEqual([])
      } else {
        expect(r.ok).toBe(false)
        expect(r.errors.join('\n')).toContain(c.browser)
      }
    })
  }
})

describe('P2-preserve — an edit that changes maths keeps unrelated presentation (pure half)', () => {
  const prior = () => {
    const d = schemaBase()
    d.plots[0] = { ...d.plots[0], colorMode: 'column:cond', colorUp: '#0f0', colorDown: '#f00', lineStyle: 'dashed',
      legend: { decimals: 4 }, precision: 3, forward: 0 }
    d.plots[1] = { ...d.plots[1], colorMode: 'column:cond', colorPacked: { transparency: 5 } }
    d.paints = [
      { kind: 'barcolor', colorMode: 'column:cond', colorPalette: ['rgba(0, 0, 0, 0)', '#ffeb3b'] },
      ...signalPaintsFor('sig', { barcolor: '#26a69a' }),
    ]
    d.placement = { target: 'pane', pane: { height: 0.3 }, scale: { mode: 'log' } }
    return d
  }

  it('restorableRowFields — ASKED reopen · CLAIMED the row gets exactly what buildDefinition writes back · DID', () => {
    expect(restorableRowFields(prior().plots[0])).toEqual({ colorMode: 'column:cond', colorUp: '#0f0', colorDown: '#f00' })
    expect(restorableRowFields(prior().plots[1])).toEqual({}) // a computed colour is not row-expressible
  })

  it('ASKED a rebuilt document that lost the unexpressible fields · CLAIMED they come back, maths facts do not · DID', () => {
    const p = prior()
    const next = schemaBase()
    const { doc: out, carried } = preservePresentation(next, p, { ownedPaints: new Set() })
    const v = out.plots.find((x) => x.key === 'value')
    expect(v.lineStyle).toBe('dashed')
    expect(v.legend).toEqual({ decimals: 4 })
    expect(v.precision).toBe(3)
    expect(v.forward).toBeUndefined() // a fact about the maths is never carried
    // colorMode is BUILDER vocabulary (restored into the row at reopen), so the merge leaves it to the builder
    expect(v.colorMode).toBeUndefined()
    expect(out.plots.find((x) => x.key === 'cond').colorPacked).toEqual({ transparency: 5 })
    expect(out.paints).toEqual(p.paints)
    expect(out.placement).toEqual(p.placement)
    expect(carried.length).toBeGreaterThan(0)
  })

  it('ASKED the member turned the SIGNAL candle colour off · CLAIMED the builder-owned paint is not resurrected · DID', () => {
    const p = prior()
    const owned = builderOwnedPaintIndexes(p, 'sig', NO_PAINT)
    expect([...owned]).toEqual([1])
    const { doc: out } = preservePresentation(schemaBase(), p, { ownedPaints: owned })
    expect(out.paints).toEqual([p.paints[0]])
  })

  it('ASKED the member removed the column a paint reads · CLAIMED that paint is dropped AND reported, never left dangling · DID', () => {
    const p = prior()
    const next = schemaBase()
    next.plots = next.plots.filter((x) => x.key !== 'cond')
    const { doc: out, dropped } = preservePresentation(next, p, { ownedPaints: new Set([1]) })
    expect(out.paints).toBeUndefined()
    expect(dropped).toContain('paints[0]')
  })

  it('ASKED a field the member DID change (style on a row) · CLAIMED the new document wins · DID', () => {
    const p = prior()
    const next = schemaBase()
    next.plots[0].style = 'histogram'
    const { doc: out } = preservePresentation(next, p)
    expect(out.plots[0].style).toBe('histogram')
  })

  it('ASKED a custom pane height (0.32) · CLAIMED kept while the target is unchanged; a target change belongs to the member · DID', () => {
    const p = { ...prior(), placement: { target: 'pane', pane: { height: 0.32 } } }
    expect(preservePresentation(schemaBase(), p).doc.placement).toEqual({ target: 'pane', pane: { height: 0.32 } })
    const toPrice = { ...schemaBase(), placement: { target: 'price' } }
    expect(preservePresentation(toPrice, p).doc.placement).toEqual({ target: 'price' })
  })

  it('ASKED a single PLAIN row carrying an object program · CLAIMED the program is saved · DID (was: the legacy body dropped it)', () => {
    const OBJ = { programVersion: 1, pineVersion: 5, regs: [], colls: [], ops: [{ k: 'create', family: 'label', site: 's1',
      into: null, when: null, lastBarOnly: true,
      props: { x: { v: 'bar' }, y: { v: 'tree', tree: 0 }, text: { v: 'text', node: { t: 'lit', s: 'hi' } } } }],
    trees: [{ type: 'series', name: 'high' }] }
    const ev = evaluateFormula('close', BUILDER_INPUT_SCOPE)
    const d = buildDefinition({ defId: 'u_00000000p2o1', name: 'Obj', source: 'close', ast: ev.ast,
      mode: ev.verdict.mode, readback: ev.readback, objects: OBJ })
    expect(d.objects).toEqual(OBJ)
    expect(validateDefinition(d).ok).toBe(true)
    // …and without one the plain document is still the legacy body, byte for byte
    const plain = buildDefinition({ defId: 'u_00000000p2o1', name: 'Obj', source: 'close', ast: ev.ast,
      mode: ev.verdict.mode, readback: ev.readback })
    expect('objects' in plain).toBe(false)
    expect(plain.schemaVersion).toBe(d.schemaVersion)
  })

  it('DISCLOSED — an object program is NOT carried across a reopen-edit (it can be bound to compute-graph node indexes; owner review)', () => {
    const p = { ...prior(), objects: { programVersion: 1, ops: [{ k: 'create' }] } }
    expect(preservePresentation(schemaBase(), p).doc.objects).toBeUndefined()
  })

  it('no prior (a create) — byte-identical', () => {
    const next = schemaBase()
    expect(preservePresentation(next, null).doc).toBe(next)
  })
})
