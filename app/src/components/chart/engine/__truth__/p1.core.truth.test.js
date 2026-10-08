// P1 truth matrix, slice "core" — TYPED OUTPUTS + THE SHARED EVALUABILITY GATE.
//
// ONE definition → TYPED OUTPUTS → MANY SAFE CONSUMERS. `outputType.js` is the
// ONE type authority (derived from the tree / the registry declaration, never
// from intent, labels or client data); `evaluability.js` is the ONE place a
// consumer asks "can THIS output be evaluated correctly in THIS lane?".
//
// Every case states ASKED / CLAIMED / DID and its outcome class. The server half
// is `tests/test_p1_truth_core.py`, held equal through the shared fixtures
// `tests/fixtures/ast/p1_evaluability_alert.json` and `p1_output_types.json`.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseFormula } from '../ast/parse'
import { interpret } from '../ast/interpret'
import * as registry from '../nativeRegistry'
import { outputTypeOf, outputsOf, treeOutputType, OUTPUT_TYPES } from '../outputType'
import {
  evaluability, chartStaticRefusals, LANES, STATUS, GATE_GUARDS, FORMULA_LTF_GUARD,
} from '../evaluability'
import { CHART_SCALAR_GUARD } from '../chartScalars'
import { PERIOD_READS_GUARD } from '../periodReads'
import { OTHER_SYMBOL_REFUSAL } from '../otherSymbols'
import { semanticsOf } from '../definitionSemantics'

const FIX = path.resolve(process.cwd(), '..', 'tests/fixtures/ast')
const ALERT_FIXTURE = JSON.parse(fs.readFileSync(path.join(FIX, 'p1_evaluability_alert.json'), 'utf8'))
const TYPE_FIXTURE = JSON.parse(fs.readFileSync(path.join(FIX, 'p1_output_types.json'), 'utf8'))
const CORPUS = JSON.parse(fs.readFileSync(path.join(FIX, 'corpus.json'), 'utf8'))

const N = 260
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 100 + 0.05 * i + 8 * Math.sin(i / 6)
  return { t: 1600000000 + i * 86400, o: c - 0.4, h: c + 1, l: c - 1, c, v: 1e6 + i }
})
const SPY = BARS.map((b) => ({ ...b, c: b.c * 4 }))
const finite = (col) => Array.from(col || []).filter(Number.isFinite).length

const P = (src) => {
  const r = parseFormula(src)
  if (!r.ok) throw new Error(`${src}: ${JSON.stringify(r)}`)
  return r.ast
}
const one = (src, meta, plot = {}) => ({ id: 'u_0000000p1c01', name: 'p1', version: 1,
  plots: [{ key: 'value', style: 'line', ...plot }], compute: { kind: 'ast', fn: 'x', ast: P(src) },
  ...(meta ? { meta } : {}) })
const many = (srcs, meta) => {
  const trees = Object.fromEntries(Object.entries(srcs).map(([k, s]) => [k, P(s)]))
  const keys = Object.keys(trees)
  return { id: 'u_0000000p1c02', name: 'p1m', version: 1, plots: keys.map((k) => ({ key: k, style: 'line' })),
    compute: { kind: 'ast', fn: 'y', ast: trees[keys[0]], trees, scanPlot: keys[0] }, ...(meta ? { meta } : {}) }
}

describe('P1 core — 1/2/3/4: the taxonomy is what the engine genuinely produces', () => {
  it('1 SERIES — ASKED sma(close, 20); CLAIMED a number per bar; DID typed series (manifest yields num)', () => {
    const t = outputTypeOf(one('sma(close, 20)'), 'value')
    expect(t).toMatchObject({ type: OUTPUT_TYPES.SERIES, yields: 'num', origin: 'tree' })
  })

  it('2 CONDITION — ASKED comparisons / logic / bool functions; CLAIMED yes/no per bar; DID typed condition', () => {
    for (const src of ['close > open', 'crossOver(close, sma(close, 10))', '!(close > open)',
      "tf(close > open, 'W')", '(close > open)[1]', 'close > open ? 1 : 0', 'rising(close, 3)']) {
      expect(outputTypeOf(one(src), 'value').type, src).toBe(OUTPUT_TYPES.CONDITION)
    }
    // a `?:` with numeric arms is a number, not a yes/no
    expect(outputTypeOf(one('close > open ? close : open'), 'value').type).toBe(OUTPUT_TYPES.SERIES)
  })

  it('2 CONDITION — every bool-typed tree of the conformance corpus computes ONLY {0, 1, NaN} (the domain a trigger threshold relies on)', () => {
    let checked = 0
    for (const c of CORPUS.cases) {
      if (!c.ast || treeOutputType(c.ast).type !== OUTPUT_TYPES.CONDITION) continue
      for (const opts of [{ tf: 'D' }, { tf: 'D', semantics: 2 }]) {
        let col
        try { col = interpret(c.ast, BARS, {}, undefined, undefined, opts) } catch { continue }
        for (const v of col) expect(v === 0 || v === 1 || Number.isNaN(v), `${c.id}: ${v}`).toBe(true)
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(20)
  })

  it('3 EVENTS — ASKED the SAR native\'s declared events; CLAIMED {0,1,NaN} event columns; DID typed events (and its `markers`-style SAR plot stays SERIES)', () => {
    const sar = registry.getDefinition('sar')
    expect(sar).toBeTruthy()
    expect(outputTypeOf(sar, 'priceCrossedSar')).toMatchObject({ type: OUTPUT_TYPES.EVENTS, origin: 'native-event' })
    expect(outputTypeOf(sar, 'trendFlipped').type).toBe(OUTPUT_TYPES.EVENTS)
    // a marker is presentation, not a type: SAR's dots are prices
    expect(outputTypeOf(sar, 'sar')).toMatchObject({ type: OUTPUT_TYPES.SERIES, origin: 'native-plot' })
    // a formula document cannot claim an event: `events[]` keys are not its outputs
    const doc = { ...one('close > open'), events: [{ key: 'fired' }] }
    expect(outputTypeOf(doc, 'fired').type).toBe(null)
  })

  it('4 SCALAR — ASKED market_cap > 1e9; CLAIMED a current-only yes/no; DID typed scalar (yields bool), scan-supported, chart-refused', () => {
    const def = one('market_cap > 1e9')
    expect(outputTypeOf(def, 'value')).toMatchObject({ type: OUTPUT_TYPES.SCALAR, yields: 'bool', scalars: ['market_cap'] })
    expect(evaluability(def, 'value', LANES.SCAN)).toMatchObject({ status: STATUS.SUPPORTED, authority: 'server', final: false })
    expect(evaluability(def, 'value', LANES.CHART, { tf: 'D' })).toMatchObject({ status: STATUS.REFUSED, guard: CHART_SCALAR_GUARD })
  })
})

describe('P1 core — 6/7/20: intent and client data never set a type', () => {
  it('6 SIGNAL cannot lie — ASKED a SIGNAL on rsi(close,14) (intent stamped on the plot and meta); CLAIMED a yes/no; DID typed series, signal lane REFUSED', () => {
    const def = one('rsi(close, 14)', { intent: 'signal', outputTypes: { value: 'condition' } }, { intent: 'signal', type: 'condition' })
    expect(outputTypeOf(def, 'value').type).toBe(OUTPUT_TYPES.SERIES)
    expect(evaluability(def, 'value', LANES.SIGNAL, { tf: 'D' }))
      .toMatchObject({ status: STATUS.REFUSED, guard: GATE_GUARDS.SIGNAL_NUMERIC })
    // the explicit conversion is the member's: a comparison IS a condition
    expect(evaluability(one('rsi(close, 14) > 70'), 'value', LANES.SIGNAL, { tf: 'D' }).status).toBe(STATUS.SUPPORTED)
  })

  it('7 multi-output typed independently — ASKED a 3-plot document; CLAIMED one type per plot; DID series / condition / scalar, each gated on its own', () => {
    const def = many({ line: 'sma(close, 10)', cross: 'crossOver(close, sma(close, 10))', cap: 'market_cap' })
    expect(outputsOf(def).map((o) => [o.key, o.type])).toEqual([
      ['line', OUTPUT_TYPES.SERIES], ['cross', OUTPUT_TYPES.CONDITION], ['cap', OUTPUT_TYPES.SCALAR]])
    expect(evaluability(def, 'line', LANES.CHART, { tf: 'D' }).status).toBe(STATUS.SUPPORTED)
    expect(evaluability(def, 'cross', LANES.SIGNAL, { tf: 'D' }).status).toBe(STATUS.SUPPORTED)
    expect(evaluability(def, 'line', LANES.SIGNAL, { tf: 'D' }).status).toBe(STATUS.REFUSED)
    expect(evaluability(def, 'cap', LANES.CHART, { tf: 'D' }).guard).toBe(CHART_SCALAR_GUARD)
    // and the chart draws exactly the two the gate supports
    const cols = registry.computeFor(def, BARS, {}, { tf: 'D' })
    expect(Object.keys(cols).sort()).toEqual(['cross', 'line'])
  })

  it('20 forged type — ASKED a client document carrying `type`/`intent`/`meta.outputTypes`; CLAIMED nothing changes; DID the derived type is identical to the bare document\'s', () => {
    for (const c of TYPE_FIXTURE.cases) {
      const bare = { id: 'u_0000000p1c03', plots: [{ key: 'value', style: 'line' }], compute: { kind: 'ast', fn: 'z', ast: c.ast } }
      const forged = { ...bare, meta: { outputTypes: { value: 'events' }, intent: 'value' },
        plots: [{ key: 'value', style: 'markers', type: 'events', intent: 'signal', marker: { shape: 'circle' } }] }
      const t = outputTypeOf(bare, 'value')
      expect({ type: t.type, yields: t.yields, scalars: [...t.scalars] }, c.source).toEqual(c.expect)
      expect(outputTypeOf(forged, 'value').type, c.source).toBe(t.type)
    }
  })
})

describe('P1 core — 8/9/10/11: one gate, P0\'s refusals, the chart agrees with it', () => {
  it('8 unsupported operand — ASKED ltf(close, "60") > close in a formula; CLAIMED refused by name; DID the gate and computeFor give the SAME guard and sentence', () => {
    const def = one("ltf(close, '60') > close")
    const g = evaluability(def, 'value', LANES.CHART, { tf: 'D' })
    const cols = registry.computeFor(def, BARS, {}, { tf: 'D' })
    expect(g).toMatchObject({ status: STATUS.REFUSED, guard: FORMULA_LTF_GUARD, final: true })
    expect(registry.columnErrors(cols).value).toEqual({ guard: g.guard, message: g.reason })
    // builder preview draws through the same computeFor: same answer
    expect(evaluability(def, 'value', LANES.BUILDER_PREVIEW, { tf: 'D' }).guard).toBe(FORMULA_LTF_GUARD)
  })

  it('8 the chart\'s pre-compute refusals ARE the gate\'s — over period / ltf / scalar / sym mixes, the gate refuses exactly the columns computeFor refuses with that guard', () => {
    const pr = { base: 'D', reads: [{ name: 'timeframe.period', version: 6 }], byTf: { D: ['D'], W: ['W'] },
      objects: false, keys: [{ key: 'a', names: ['timeframe.period'] }] }
    const srcs = { plain: 'close > 100', scalar: 'rs_rank > 80', ltf: "ltf(close, '60') > close", sym: "close / sym('SPY', close)" }
    const STATIC = new Set([PERIOD_READS_GUARD, FORMULA_LTF_GUARD, CHART_SCALAR_GUARD])
    let n = 0
    for (const a of Object.keys(srcs)) for (const b of Object.keys(srcs)) for (const meta of [undefined, { periodReads: pr }]) {
      for (const tf of ['D', 'W']) {
        const def = many({ a: srcs[a], b: srcs[b] }, meta)
        const ctx = { tf, secondary: new Map([['SPY', { bars: SPY, status: 'ok' }]]) }
        const cols = registry.computeFor(def, BARS, {}, ctx)
        const errs = registry.columnErrors(cols)
        for (const key of ['a', 'b']) {
          const g = evaluability(def, key, LANES.CHART, ctx)
          const e = errs[key]
          if (e && STATIC.has(e.guard)) expect(g, `${a}/${b}/${tf}/${key}`).toMatchObject({ status: STATUS.REFUSED, guard: e.guard, reason: e.message })
          else expect(g.status, `${a}/${b}/${tf}/${key}`).toBe(STATUS.SUPPORTED)
          if (g.status === STATUS.SUPPORTED) expect(cols[key], `${a}/${b}/${tf}/${key}`).toBeTruthy()
          n += 1
        }
      }
    }
    expect(n).toBe(128)
    // and `whole` is the document-wide short-circuit, unchanged
    expect(chartStaticRefusals(one("ltf(close, '60')"), { tf: 'D' }).whole).toMatchObject({ value: { guard: FORMULA_LTF_GUARD } })
  })

  it('9 sym SUPPLIED on the chart — ASKED close / sym("SPY", close) with SPY in hand; CLAIMED drawn; DID supported, 260 finite values', () => {
    const def = one("close / sym('SPY', close)")
    const ctx = { tf: 'D', secondary: new Map([['SPY', { bars: SPY, status: 'ok' }]]) }
    expect(evaluability(def, 'value', LANES.CHART, ctx).status).toBe(STATUS.SUPPORTED)
    expect(finite(registry.computeFor(def, BARS, {}, ctx).value)).toBe(N)
    // loading → refused, pending (P0: the strip says nothing yet); settled no-data → final refusal
    expect(evaluability(def, 'value', LANES.CHART, { tf: 'D', secondary: new Map([['SPY', { bars: [], status: 'loading' }]]) }))
      .toMatchObject({ status: STATUS.REFUSED, guard: OTHER_SYMBOL_REFUSAL.NO_BARS, pending: true, final: false })
    expect(evaluability(def, 'value', LANES.CHART, { tf: 'D', secondary: new Map([['SPY', { bars: [], status: 'no_data' }]]) }))
      .toMatchObject({ status: STATUS.REFUSED, guard: OTHER_SYMBOL_REFUSAL.NO_BARS, final: true })
    // a sibling that reads no other symbol is not refused for its neighbour's read
    const m = many({ a: 'close > 100', b: "close / sym('SPY', close)" })
    expect(evaluability(m, 'a', LANES.CHART, { tf: 'D' }).status).toBe(STATUS.SUPPORTED)
  })

  it('10 sym UNSUPPLIED in the alert lane — ASKED every case of the shared fixture; CLAIMED the server\'s answer; DID the browser preflight matches status, gate and codes (server side: test_p1_truth_core.py)', () => {
    for (const c of ALERT_FIXTURE.cases) {
      const g = evaluability(c.definition, c.plotKey, LANES.ALERT)
      expect({ status: g.status, gate: g.gate || null, codes: g.codes || [] }, c.name).toEqual(c.expect)
      expect(g.authority, c.name).toBe('server')
      if (g.status === STATUS.SUPPORTED) expect(g.final, c.name).toBe(false)
    }
    // ⭐ PHASE 5 SUPERSEDES P1-10: the alert lane SUPPLIES another symbol now; an
    // ambiguous spelling or more than two tickers is still withheld by name.
    const sym = ALERT_FIXTURE.cases.find((c) => c.name.startsWith('sym SPY ratio'))
    expect(sym.expect).toEqual({ status: 'supported', gate: null, codes: [] })
    const vix = ALERT_FIXTURE.cases.find((c) => c.name.startsWith('sym VIX ambiguous'))
    expect(vix.expect).toEqual({ status: 'refused', gate: 'withheld', codes: ['other-symbol:ambiguous'] })
    const three = ALERT_FIXTURE.cases.find((c) => c.name.startsWith('sym three tickers'))
    expect(three.expect).toEqual({ status: 'refused', gate: 'withheld', codes: ['other-symbol:fan-out'] })
  })

  it('11 a current-only scalar cannot masquerade as SERIES — ASKED sma(market_cap,5), market_cap[1], market_cap; CLAIMED history; DID typed scalar, refused on chart / info-value / signal', () => {
    for (const src of ['sma(market_cap, 5)', 'market_cap[1]', 'market_cap', 'close > 10 && rs_rank > 80']) {
      const def = one(src)
      expect(outputTypeOf(def, 'value').type, src).toBe(OUTPUT_TYPES.SCALAR)
      for (const lane of [LANES.CHART, LANES.INFO_VALUE, LANES.SIGNAL, LANES.CHART_MARKER]) {
        expect(evaluability(def, 'value', lane, { tf: 'D' }), `${src} @ ${lane}`)
          .toMatchObject({ status: STATUS.REFUSED, guard: CHART_SCALAR_GUARD })
      }
      expect(registry.computeFor(def, BARS, {}, { tf: 'D' }).value, src).toBeUndefined()
    }
  })
})

describe('P1 core — 14/15/16: typing and gating never touch definition semantics', () => {
  const ask = (def) => {
    const before = JSON.stringify(def)
    const out = [outputTypeOf(def, 'value').type,
      ...Object.values(LANES).map((l) => evaluability(def, 'value', l, { tf: 'D' }).status)]
    expect(JSON.stringify(def)).toBe(before) // nothing is stamped, nothing is written
    return out
  }

  it('14 legacy stays legacy — ASKED an unstamped (legacy) document; CLAIMED semantics 1; DID semantics 1 after every question', () => {
    const def = one('close > sma(close, 5)')
    ask(def)
    expect(semanticsOf(def)).toBe(1)
  })

  it('15 semantics:2 stays — ASKED a store-stamped document; CLAIMED semantics 2; DID semantics 2, and the same types/answers as legacy', () => {
    const v2 = one('close > sma(close, 5)', { semantics: 2 })
    const v1 = one('close > sma(close, 5)')
    expect(ask(v2)).toEqual(ask(v1))
    expect(semanticsOf(v2)).toBe(2)
  })

  it('16 Pine retains source semantics — ASKED a Pine translation (even with a forged stamp); CLAIMED semantics 1 and the Pine sym rules; DID both', () => {
    const pine = one("close / sym('SPY', close)", { recurrenceOrigin: 'pine', semantics: 2 })
    ask(pine)
    expect(semanticsOf(pine)).toBe(1)
    expect(outputTypeOf(pine, 'value').type).toBe(OUTPUT_TYPES.SERIES)
    // a Pine doc is decided by its recorded spellings: none recorded → `unspelled`
    expect(evaluability(pine, 'value', LANES.CHART, { tf: 'D' }))
      .toMatchObject({ status: STATUS.REFUSED, guard: OTHER_SYMBOL_REFUSAL.UNSPELLED })
    // a Pine plotshape is a CONDITION drawn as markers
    const shape = one('close > open', { recurrenceOrigin: 'pine' }, { style: 'markers', marker: { shape: 'arrowUp' } })
    expect(outputTypeOf(shape, 'value').type).toBe(OUTPUT_TYPES.CONDITION)
    expect(evaluability(shape, 'value', LANES.CHART_MARKER, { tf: 'D' }).status).toBe(STATUS.SUPPORTED)
  })

  it('runtime (bar-by-bar VM) outputs are UNTYPED, never guessed — and a signal on one refuses', () => {
    const rt = { id: 'u_0000000p1c04', plots: [{ key: 'value', style: 'line' }],
      compute: { kind: 'runtime', fn: 'runtime:x', outputs: { value: 0 } } }
    expect(outputTypeOf(rt, 'value')).toMatchObject({ type: null, untyped: 'untyped:runtime-output' })
    expect(evaluability(rt, 'value', LANES.SIGNAL).guard).toBe(GATE_GUARDS.UNTYPED)
    expect(evaluability(rt, 'value', LANES.ALERT)).toMatchObject({ status: STATUS.REFUSED, gate: 'lane' })
  })
})

// Items owned by the later slices now live in their own truth files (integrated):
//   5, 12, 13 (intent + presentation) → p1.intent.truth.test.js
//   17, 18, 19-info (info value)      → p1.info.truth.test.js
//   10/12/19-alert, trigger policy    → p1.signal.truth.test.js + tests/test_p1_truth_signal.py
//   cap + BEGIN IMMEDIATE concurrency  → tests/test_p1_truth_signal.py
//   19 (all consumers together)       → p1.integration.truth.test.js
