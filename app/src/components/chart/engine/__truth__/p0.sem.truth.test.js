/** P0G TRUTH CORPUS — slice "sem": owner decisions A (unknown comparisons) and
 *  C (Wilder functions across gaps), browser lane. Python twin:
 *  `tests/test_p0_truth_sem.py`; both read the SAME fixture `p0.sem.gaps.json`
 *  (80 synthetic daily bars, holes at bars 30 and 50 and on the newest bar), whose
 *  `expect` block is this lane's output frozen at generation — the Python lane
 *  must reproduce it at 1e-9, so the two lanes are proven identical on it.
 *
 *  Every case states ASKED / CLAIMED / DID and an outcome class. "BEFORE" is the
 *  engine at base `7bd868f34`.
 *
 *  ⭐ THE MECHANISM: ONE definition-semantics version, `meta.semantics: 2`,
 *  stamped by the STORE on a new native / PCF / thinkScript save (never a Pine
 *  translation; never a legacy row's presentation edit), read by
 *  `definitionSemantics.js::semanticsOptsFor` into `opts.semantics`, owning both
 *  A (`interpret.js::BINARY_V2`) and C (`interpret.js::FN_V2`). Absent = 1 = every
 *  existing output, byte for byte. */
import { describe, it, expect } from 'vitest'

import { interpret, BINARY, BINARY_V2, FN_V2, semanticsV2 } from '../ast/interpret.js'
import { computeFor } from '../nativeRegistry.js'
import { PINE_RECURRENCE_ORIGIN, installUserDefinitions, getDefinition, clearUserDefinitions } from '../nativeRegistry.js'
import { validateDefinition } from '../defSchema.js'
import {
  semanticsOf, semanticsOptsFor, stampSemantics, withStoredSemantics, PINE_ORIGIN,
  SEMANTICS_UNKNOWN_PROPAGATES,
} from '../definitionSemantics.js'
import { parseFormula, astHash } from '../ast/parse.js'
import { computeRSI, computeATR, computeADX } from '../../indicators.js'
import { rsiOfSeries } from '../../technicalStudies.js'
import { markersFor } from '../markerPrimitive.js'
import GAPS from './p0.sem.gaps.json'

const BARS = GAPS.bars
const V2 = { semantics: 2 }
const wire = (col) => Array.from(col, (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null))
const caseOf = (id) => GAPS.cases.find((c) => c.id === id)
const run = (id) => wire(interpret(caseOf(id).ast, BARS, {}, undefined, undefined, caseOf(id).opts))
const finite = (col) => col.filter((v) => v !== null).length
const pts = (p) => (Array.isArray(p) && p.length ? p.map((x) => (x && Number.isFinite(x.value) ? x.value : null)) : [])

const astDoc = (source, meta = {}) => {
  const { ast } = parseFormula(source)
  return {
    schemaVersion: 1, id: 'u_p0gsem', version: 1,
    compute: { kind: 'ast', fn: astHash(ast), rev: 1, ast, source },
    meta: { name: 'P0G', shortName: 'P0G', category: 'Custom', tier: 'premium', repaint: 'non-repainting', ...meta },
    placement: { target: 'pane', pane: { height: 0.15 } },
    plots: [{ key: 'value', label: 'v', style: 'line', color: '#fff' }],
  }
}
const chartCol = (def) => wire(computeFor(def, BARS, {}, { tf: 'D', newestBarIsForming: false }).value)
// `close` with a hole on bar 30 and bar 50, spelled in the formula language
const G_SRC = 'close * (sqrt(abs((barindex - 30) * (barindex - 50)) - 0.5) * 0 + 1)'

// --------------------------------------------------------------------------- //
// the shared fixture — this lane still produces what both lanes were frozen at
// --------------------------------------------------------------------------- //
describe('shared gap fixture (browser = server, frozen)', () => {
  it('every case reproduces its frozen column [EXACT; Python twin asserts the same]', () => {
    for (const c of GAPS.cases) expect(run(c.id), c.id).toEqual(GAPS.expect[c.id])
  })
})

// --------------------------------------------------------------------------- //
// A — unknown comparisons
// --------------------------------------------------------------------------- //
describe('A · unknown comparisons', () => {
  it('ASKED close>100 on a bar whose value is unknown · CLAIMED (decision A) unknown · BEFORE: 0 · NOW (semantics 2): UNKNOWN', () => {
    for (const op of ['gt', 'lt', 'ge', 'le', 'eq', 'ne']) {
      expect(run(`${op}__v2`)[30], op).toBe(null)
      expect(run(`${op}__v2`)[50], op).toBe(null)
      expect(finite(run(`${op}__v2`)), op).toBe(78)
    }
    expect(BINARY_V2['>'](NaN, 1)).toBeNaN()
    expect(BINARY_V2['=='](NaN, NaN)).toBeNaN()
    expect(BINARY_V2['!='](NaN, 1)).toBeNaN()
  })

  it('ASKED the same on a LEGACY save (no stamp) · DID: 0 — X23 retained, no migration [DISCLOSED DIFFERENCE, legacy]', () => {
    expect(run('gt__v1')[30]).toBe(0)
    expect(run('ne__v1')[30]).toBe(0)
    expect(BINARY['>'](NaN, 1)).toBe(0)
    // and the legacy table is the one an unstamped evaluation reads
    expect(semanticsV2({})).toBe(false)
    expect(semanticsV2(undefined)).toBe(false)
  })

  it('and/or/not/?: keep their propagation; with the comparison now unknown they answer unknown, not a laundered 0/1 [UNKNOWN]', () => {
    expect(run('and_true__v2')[30]).toBe(null)
    expect(run('or_false__v2')[30]).toBe(null)
    expect(run('not__v2')[30]).toBe(null)
    expect(run('ternary__v2')[30]).toBe(null)
    // BEFORE (legacy): the laundered 0 made `!` a confident TRUE on the hole
    expect(run('not__v1')[30]).toBe(1)
    // a known bar is the same answer in both
    expect(run('and_true__v2')[29]).toBe(run('and_true__v1')[29])
  })

  it('crossOver over a hole is unknown in both (it already required four known values) [UNKNOWN]', () => {
    expect(run('crossover__v2')).toEqual(run('crossover__v1'))
    expect(run('crossover__v2')[30]).toBe(null)
    expect(run('crossover__v2')[31]).toBe(null)
  })

  it('barssince / valuewhen RESET on an unknown condition bar instead of counting a laundered false [UNKNOWN]', () => {
    const v1 = run('barssince__v1')
    const v2 = run('barssince__v2')
    expect(v2[30]).toBe(null)                 // BEFORE: v1 counted bar 30 as a confident "not true"
    expect(v1[30]).not.toBe(null)
    expect(finite(v2)).toBeLessThan(finite(v1))
    expect(run('valuewhen__v2')[30]).toBe(null)
  })

  it('a marker drawn from an unknown condition bar is NO marker (not a false one, not a true one) [UNKNOWN]', () => {
    const col = run('gt__v2')
    const times = BARS.map((b) => b.t)
    const ms = markersFor({ column: col.map((v) => (v === null ? NaN : v)), times, marker: { shape: 'circle' }, color: '#fff' })
    expect(ms.some((m) => m.time === BARS[30].t)).toBe(false)
    expect(ms.length).toBe(col.filter((v) => v === 1).length)
  })

  it('a threshold on a held RSI is unknown on the hole and known after it (v1 had erased every pre-hole bar) [VALUE / UNKNOWN]', () => {
    const v1 = run('rsi_cmp_gap__v1')
    const v2 = run('rsi_cmp_gap__v2')
    expect(v1[30]).toBe(0)                    // BEFORE: rsi erased -> comparison laundered to 0
    expect(v2[30]).toBe(null)
    expect(v2[29]).toBe(1)
  })
})

// --------------------------------------------------------------------------- //
// Pine keeps Pine
// --------------------------------------------------------------------------- //
describe('A · Pine-origin documents keep Pine semantics', () => {
  it('ASKED na > 1 in a Pine import · CLAIMED (TradingView) false · DID: 0 — the store never stamps it, and the listing outranks a forged stamp [EXACT]', () => {
    const pine = astDoc(`${G_SRC} > 100`, { recurrenceOrigin: PINE_RECURRENCE_ORIGIN, semantics: 2 })
    expect(PINE_ORIGIN).toBe(PINE_RECURRENCE_ORIGIN)
    expect(semanticsOf(pine)).toBe(1)
    expect(semanticsOptsFor(pine)).toEqual({})
    expect(stampSemantics(pine).meta.semantics).toBeUndefined()
    expect(withStoredSemantics(pine, { semantics: 2 }).meta.semantics).toBeUndefined()
    // the Pine lane's listing evaluation compares na as false even if handed both
    expect(semanticsV2({ semantics: 2, historyFromListing: true })).toBe(false)
    const col = wire(interpret(caseOf('gt__v1').ast, BARS, {}, undefined, undefined,
      { semantics: 2, historyFromListing: true }))
    expect(col[30]).toBe(0)
  })

  it('defSchema refuses a Pine document that carries the stamp, and any value but 2 [CONTROLLED ERROR]', () => {
    const ok = validateDefinition(astDoc('close > 1', { semantics: 2 }))
    expect(ok.errors || []).toEqual([])
    for (const bad of [1, 3, '2', true]) {
      const r = validateDefinition(astDoc('close > 1', { semantics: bad }))
      expect((r.errors || []).some((e) => /meta\.semantics/.test(e)), String(bad)).toBe(true)
    }
    const pine = validateDefinition(astDoc('close > 1', { semantics: 2, recurrenceOrigin: 'pine' }))
    expect((pine.errors || []).some((e) => /Pine translation keeps Pine semantics/.test(e))).toBe(true)
  })
})

// --------------------------------------------------------------------------- //
// C — Wilder functions across gaps
// --------------------------------------------------------------------------- //
describe('C · Wilder family holds across a missing observation (semantics 2)', () => {
  it('ASKED rsi(x,14) over a gappy x · CLAIMED (decision C, TradingView `ta.rsi` over `ta.rma`) hold · BEFORE: 15 values, every pre-hole bar erased · NOW: EXACTLY native rsiOfSeries [EXACT]', () => {
    const v1 = run('rsi_gap__v1')
    const v2 = run('rsi_gap__v2')
    expect(finite(v1)).toBe(15)               // restart after the LAST hole (bar 50)
    expect(v1.slice(0, 51).every((v) => v === null)).toBe(true)
    const gcol = Array.from(interpret(caseOf('gt__v1').ast.args[0], BARS, {}, undefined, undefined, {}))
    expect(v2).toEqual(wire(rsiOfSeries(gcol, 14)))
    expect(v2[30]).toBe(null)                 // the hole
    expect(v2[31]).toBe(null)                 // the bar whose change reads the hole
    expect(v2[32]).not.toBe(null)             // continues from the preserved state
    expect(finite(v2)).toBe(62)
  })

  it('ASKED atr(h,l,x,14) over a gappy x · NOW: holds (TR on the bar after the hole is not computable) [VALUE]', () => {
    const v1 = run('atr_gap__v1')
    const v2 = run('atr_gap__v2')
    expect(finite(v1)).toBe(15)
    expect(finite(v2)).toBe(64)
    expect(v2[31]).toBe(null)
    expect(v2[32]).not.toBe(null)
    // before the first hole v2 is the gap-free ATR exactly
    expect(v2.slice(0, 31)).toEqual(run('atr_gapfree__v2').slice(0, 31))
  })

  it('adx / plusDI / minusDI hold; mfi and stoch (finite windows, not Wilder) keep the restart [VALUE / DISCLOSED]', () => {
    expect(finite(run('adx_gap__v1'))).toBe(2)
    expect(finite(run('adx_gap__v2'))).toBe(49)
    expect(finite(run('plusdi_gap__v2'))).toBe(62)
    expect(finite(run('minusdi_gap__v2'))).toBe(62)
    expect(run('mfi_gap__v2')).toEqual(run('mfi_gap__v1'))
    expect(run('stoch_gap__v2')).toEqual(run('stoch_gap__v1'))
    expect(Object.keys(FN_V2).sort()).toEqual(['adx', 'atr', 'minusDI', 'plusDI', 'rsi'])
  })

  it('a hole on the NEWEST bar no longer erases the column [VALUE]', () => {
    expect(finite(run('rsi_newest_hole__v1'))).toBe(0)
    expect(finite(run('atr_newest_hole__v1'))).toBe(0)
    expect(run('rsi_newest_hole__v2').at(-1)).toBe(null)
    expect(run('rsi_newest_hole__v2').slice(0, 79)).toEqual(run('rsi_gapfree__v2').slice(0, 79))
    expect(run('atr_newest_hole__v2')).toEqual(run('atr_gapfree__v2'))   // ATR reads c[i-1], not c[79]
  })

  it('a LEFT-EDGE hole (composed warm-up) and a gap-free series are the SAME column under both semantics [EXACT]', () => {
    for (const id of ['rsi_left_edge', 'atr_left_edge', 'rsi_gapfree', 'atr_gapfree', 'adx_gapfree']) {
      expect(run(`${id}__v2`), id).toEqual(run(`${id}__v1`))
    }
  })

  it('LEGACY formula retains the finiteTailStart restart [DISCLOSED DIFFERENCE, legacy]', () => {
    expect(run('rsi_gap__v1')).toEqual(GAPS.expect.rsi_gap__v1)
    expect(run('rsi_gap__v1').findIndex((v) => v !== null)).toBe(65)   // 51 + 14
  })
})

describe('C · the NATIVE RSI/ATR indicators are unchanged (control)', () => {
  it('computeRSI / computeATR / computeADX / rsiOfSeries reproduce their frozen columns [EXACT]', () => {
    expect(pts(computeRSI(BARS, 14))).toEqual(GAPS.native.computeRSI_close14)
    expect(pts(computeATR(BARS, 14))).toEqual(GAPS.native.computeATR_14)
    expect(pts(computeADX(BARS, 14).adx)).toEqual(GAPS.native.computeADX_14)
    expect(wire(rsiOfSeries(BARS.map((b) => b.c), 14))).toEqual(GAPS.native.rsiOfSeries_close14)
  })

  it('the formula functions over a gap-free series equal the native ones under both semantics [EXACT]', () => {
    expect(run('rsi_gapfree__v2')).toEqual(GAPS.native.computeRSI_close14)
    expect(run('rsi_gapfree__v1')).toEqual(GAPS.native.computeRSI_close14)
    expect(run('atr_gapfree__v2')).toEqual(GAPS.native.computeATR_14)
    expect(run('adx_gapfree__v2')).toEqual(GAPS.native.computeADX_14)
  })
})

// --------------------------------------------------------------------------- //
// ownership — the stamp reaches the chart lane, and only the stamp does
// --------------------------------------------------------------------------- //
describe('semantic ownership on the chart lane', () => {
  it('a STAMPED native document charts under semantics 2; the same document unstamped charts as before [VALUE / legacy]', () => {
    const src = `rsi(${G_SRC}, 14) > 50`
    const stamped = chartCol(astDoc(src, { semantics: 2 }))
    const legacy = chartCol(astDoc(src))
    expect(stamped).toEqual(GAPS.expect.rsi_cmp_gap__v2)
    expect(legacy).toEqual(GAPS.expect.rsi_cmp_gap__v1)
  })

  it('semanticsOptsFor reads only an exact 2 on a non-Pine document', () => {
    expect(semanticsOptsFor(astDoc('close'))).toEqual({})
    expect(semanticsOptsFor(astDoc('close', { semantics: 2 }))).toEqual(V2)
    expect(semanticsOptsFor(astDoc('close', { semantics: '2' }))).toEqual({})
    expect(SEMANTICS_UNKNOWN_PROPAGATES).toBe(2)
  })

  it('the builder preview applies the store rule: create -> 2; presentation edit of a legacy row -> inherits 1; maths edit -> 2; Pine import -> none', () => {
    const legacyRow = astDoc('close > 1')
    expect(stampSemantics(astDoc('close > 1')).meta.semantics).toBe(2)
    expect(stampSemantics({ ...legacyRow, meta: { ...legacyRow.meta, name: 'renamed' } }, { prior: legacyRow }).meta.semantics).toBeUndefined()
    expect(stampSemantics(astDoc('close > 2'), { prior: legacyRow }).meta.semantics).toBe(2)
    const stampedRow = astDoc('close > 1', { semantics: 2 })
    expect(stampSemantics(astDoc('close > 1'), { prior: stampedRow }).meta.semantics).toBe(2)
    expect(stampSemantics(astDoc('close > 1'), { dialect: 'pine' }).meta.semantics).toBeUndefined()
    expect(stampSemantics(astDoc('close > 1'), { dialect: 'thinkscript' }).meta.semantics).toBe(2)
  })

  it('the installed copy carries the STORE\'s answer, and a semantics change reinstalls (installKey)', () => {
    clearUserDefinitions()
    const doc = astDoc('close > 1', { freshness: 'live' })
    expect(withStoredSemantics({ ...doc, meta: { ...doc.meta, semantics: 2 } }, { semantics: 1 }).meta.semantics).toBeUndefined()
    const a = installUserDefinitions([doc])
    expect(a.errors).toEqual([])
    expect(semanticsOf(getDefinition(doc.id))).toBe(1)
    const b = installUserDefinitions([withStoredSemantics(doc, { semantics: 2 })])
    expect(b.errors).toEqual([])
    expect(semanticsOf(getDefinition(doc.id))).toBe(2)
    clearUserDefinitions()
  })
})
