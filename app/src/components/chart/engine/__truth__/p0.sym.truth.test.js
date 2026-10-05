// P0 truth corpus, slice "sym" — the CHART lane.
//
// Invariant: if UCT accepts a definition that requires an EXTERNAL series
// (`sym('T', …)` another symbol, `ltf(…, 'N')` a lower timeframe), the execution
// path must either SUPPLY it correctly or REFUSE it before it becomes active.
// Never accept → starve → silent empty / confident 0.
//
// Every case states ASKED / CLAIMED / DID and its outcome class. BEFORE is what
// base a92b96de2 did (measured by probe, recorded in the P0-sym report).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { evaluateFormula } from '../../builder/FormulaField.jsx'
import { BUILDER_INPUT_SCOPE } from '../../builder/builderInputs.js'
import { buildDefinition } from '../../builder/BuilderSheet.jsx'
import { interpret } from '../ast/interpret'
import * as registry from '../nativeRegistry'
import {
  fetchableOtherSymbols, otherSymbolsSignature, OTHER_SYMBOL_REFUSAL, resolveOtherSymbols,
} from '../otherSymbols'
import { symbolsNeeded } from '../sourceRef'
import { createBinder } from '../binder'
import { addInstance } from '../instanceControls'
import { mergeChartSettings } from '../../chartDefaults'
import { createFakeChart } from '../__tests__/fakeChart'
import { chartClockNotesFor, resetChartClockNotes } from '../chartClockNotice'

const N = 300
const mk = (seed, drift) => Array.from({ length: N }, (_, i) => {
  const c = 100 + drift * i + Math.sin(i / (5 + seed)) * 8
  return { t: 1600000000 + i * 86400, o: c, h: c + 1, l: c - 1, c, v: 1000 }
})
const BARS = mk(1, 0.15)
const SPY = mk(4, 0.05)
const finite = (col) => Array.from(col || []).filter(Number.isFinite).length

let serial = 0
function formulaDoc(src) {
  const ev = evaluateFormula(src, BUILDER_INPUT_SCOPE)
  if (!ev.ok) throw new Error(`${src}: ${ev.error}`)
  serial += 1
  return buildDefinition({
    defId: `u_00000000${String(5000 + serial).padStart(4, '0')}`, name: `p0 sym ${serial}`,
    source: src, ast: ev.ast, mode: ev.verdict.mode, readback: ev.readback,
  })
}
const sec = (entries) => new Map(entries)
const AVAILABLE_SPY = sec([['SPY', { bars: SPY, status: 'available' }]])

describe('P0 sym — a typed formula that reads another symbol is SUPPLIED on the chart', () => {
  it('VALUE/EXACT — ASKED close / sym(\'SPY\', close); CLAIMED a saved, drawable RS line; DID (before) all-NaN, no report, never fetched', () => {
    const def = formulaDoc("close / sym('SPY', close)")
    // the definition installs (it always did — the defect was never at the door)
    expect(registry.validateUserDefinitions([def]).errors).toEqual([])
    const cols = registry.computeFor(def, BARS, {}, { tf: 'D', secondary: AVAILABLE_SPY })
    // AFTER: served, and EXACTLY what the interpreter answers with SPY supplied
    const direct = interpret(def.compute.ast, BARS, {}, undefined, undefined, { tf: 'D', symbols: { SPY } })
    expect(finite(cols.value)).toBe(N)
    expect(Array.from(cols.value)).toEqual(Array.from(direct))
    expect(registry.otherSymbolReport(cols)).toEqual({ served: ['SPY'], refused: [] })
    expect(registry.externalReadNotices(def, cols)).toEqual([])
  })

  it('VALUE — ASKED an RS new-high CONDITION; DID (before) all-NaN → a comparison against nothing', () => {
    const def = formulaDoc("close / sym('SPY', close) > highest((close / sym('SPY', close))[1], 63)")
    const cols = registry.computeFor(def, BARS, {}, { tf: 'D', secondary: AVAILABLE_SPY })
    const vals = Array.from(cols.value).filter(Number.isFinite)
    expect(vals.length).toBeGreaterThan(200)
    expect(vals.every((v) => v === 0 || v === 1)).toBe(true)
  })

  it('the chart FETCHES the ticker — DID (before) fetchableOtherSymbols [] and symbolsNeeded []', () => {
    const def = formulaDoc("close / sym('SPY', close)")
    expect(fetchableOtherSymbols(def)).toEqual(['SPY'])
    expect(symbolsNeeded([{ defId: def.id, instanceId: 'i1' }], () => def)).toEqual(['SPY'])
    // the memo signature sees the secondary land (a recompute when SPY arrives)
    expect(otherSymbolsSignature(def, new Map())).not.toEqual(otherSymbolsSignature(def, AVAILABLE_SPY))
  })

  it('UNKNOWN (pending) — bars not in hand YET: blank, refused by name, and NO notice while loading', () => {
    const def = formulaDoc("close / sym('SPY', close)")
    for (const secondary of [new Map(), sec([['SPY', { bars: [], status: 'loading' }]])]) {
      const cols = registry.computeFor(def, BARS, {}, { tf: 'D', secondary })
      expect(finite(cols.value)).toBe(0)
      const rep = registry.otherSymbolReport(cols)
      expect(rep.served).toEqual([])
      expect(rep.refused.map((r) => [r.ticker, r.code, r.pending])).toEqual([['SPY', OTHER_SYMBOL_REFUSAL.NO_BARS, true]])
      expect(registry.externalReadNotices(def, cols)).toEqual([])
    }
  })

  it('REFUSAL — ASKED sym of a ticker the store has no bars for; DID (before) silent blank; AFTER a named notice', () => {
    const def = formulaDoc("close / sym('ZZZQ', close)")
    const cols = registry.computeFor(def, BARS, {}, { tf: 'D', secondary: sec([['ZZZQ', { bars: [], status: 'no_data' }]]) })
    expect(finite(cols.value)).toBe(0)
    const notes = registry.externalReadNotices(def, cols)
    expect(notes.map((n) => n.code)).toEqual([OTHER_SYMBOL_REFUSAL.NO_BARS])
    expect(notes[0].reason).toMatch(/ZZZQ/)
    expect(notes[0].reason).toMatch(/no_data/)
  })

  it('REFUSAL — a framed (calculation-timeframe) instance is not served another symbol, by name', () => {
    const def = formulaDoc("close / sym('SPY', close)")
    const cols = registry.computeFor(def, BARS, {}, { tf: 'W', secondary: AVAILABLE_SPY, framed: true })
    expect(finite(cols.value)).toBe(0)
    expect(registry.externalReadNotices(def, cols).map((n) => n.code)).toEqual([OTHER_SYMBOL_REFUSAL.FRAMED])
  })

  it('REFUSAL — an AMBIGUOUS spelling (also a TradingView index: ADVN) is never fetched and never read as our listing', () => {
    // The Builder sheet's Pine tab saves a translation as a plain formula with no
    // Pine provenance, so `sym('ADVN', …)` may be TradingView's NYSE breadth index.
    const def = formulaDoc("close / sym('ADVN', close)")
    expect(fetchableOtherSymbols(def)).toEqual([])
    const cols = registry.computeFor(def, BARS, {}, { tf: 'D', secondary: sec([['ADVN', { bars: SPY, status: 'available' }]]) })
    expect(finite(cols.value)).toBe(0)
    expect(registry.externalReadNotices(def, cols).map((n) => n.code)).toEqual([OTHER_SYMBOL_REFUSAL.BARE])
  })

  it('CONTROL — a Pine translation keeps its own spelling rules, unchanged (no stamp → `unspelled`, no strip row)', () => {
    const def = { ...formulaDoc("close / sym('SPY', close)") }
    def.meta = { ...def.meta, recurrenceOrigin: 'pine' }
    const cols = registry.computeFor(def, BARS, {}, { tf: 'D', secondary: AVAILABLE_SPY })
    expect(finite(cols.value)).toBe(0)
    expect(registry.otherSymbolReport(cols).refused.map((r) => r.code)).toEqual([OTHER_SYMBOL_REFUSAL.UNSPELLED])
    expect(resolveOtherSymbols(def, { secondary: AVAILABLE_SPY }).refused.map((r) => r.code)).toEqual([OTHER_SYMBOL_REFUSAL.UNSPELLED])
    expect(fetchableOtherSymbols(def)).toEqual([])
    expect(registry.externalReadNotices(def, cols)).toEqual([])
  })
})

describe('P0 ltf — a typed formula that reads below the chart is REFUSED by name', () => {
  it('REFUSAL — ASKED ltf(close, \'60\'); CLAIMED saved + drawable; DID (before) all-NaN, no report, no error', () => {
    const def = formulaDoc("ltf(close, '60')")
    const cols = registry.computeFor(def, BARS, {}, { tf: 'D' })
    expect(cols.value).toBeUndefined()
    expect(registry.columnErrors(cols).value.guard).toBe(registry.FORMULA_LTF_GUARD)
    expect(registry.externalReadNotices(def, cols)).toEqual([
      { code: registry.FORMULA_LTF_GUARD, reason: registry.FORMULA_LTF_MESSAGE },
    ])
  })

  it('PARTIAL — a multi-plot formula: only the plot that reads ltf is refused; its sibling draws', () => {
    const plain = evaluateFormula('sma(close, 5)', BUILDER_INPUT_SCOPE)
    const low = evaluateFormula("ltf(close, '60') - close", BUILDER_INPUT_SCOPE)
    const row = (key, ev, src) => ({ key, label: key, source: src, ast: ev.ast, mode: ev.verdict.mode,
      readback: ev.readback, style: 'line', color: '#2962ff', width: 1, hidden: false })
    const def = buildDefinition({
      defId: 'u_000000005999', name: 'p0 two plots', source: 'sma(close, 5)', ast: plain.ast,
      mode: plain.verdict.mode, readback: plain.readback,
      plots: [row('avg', plain, 'sma(close, 5)'), row('low', low, "ltf(close, '60') - close")],
      placement: { target: 'pane' },
    })
    const cols = registry.computeFor(def, BARS, {}, { tf: 'D' })
    expect(finite(cols.avg)).toBeGreaterThan(0)
    expect(cols.low).toBeUndefined()
    expect(registry.columnErrors(cols).low.guard).toBe(registry.FORMULA_LTF_GUARD)
  })
})

describe('P0 tf — a higher-timeframe read from 5-minute bars (audit: "tf from 5m NaN")', () => {
  it('UNKNOWN (honest warm-up) then VALUE — the first week has no closed week before it; later bars are served', () => {
    const def = formulaDoc("tf(close, 'W')")
    // 20 sessions × 78 five-minute bars from Tue 2024-01-02 09:30 ET
    const m5 = Array.from({ length: 78 * 20 }, (_, i) => {
      const day = Math.floor(i / 78); const c = 100 + i * 0.01
      return { t: 1704205800 + day * 86400 + (i % 78) * 300, o: c, h: c, l: c, c, v: 1 }
    })
    const cols = registry.computeFor(def, m5, {}, { tf: '5' })
    const col = Array.from(cols.value)
    expect(Number.isNaN(col[0])).toBe(true)
    expect(finite(col)).toBeGreaterThan(1000)
    // three sessions of 5m bars: one week bucket, no CLOSED week → blank everywhere,
    // the same warm-up rule `sma(close, 300)` on 200 bars follows (not a starve).
    const short = registry.computeFor(def, m5.slice(0, 78 * 3), {}, { tf: '5' })
    expect(finite(short.value)).toBe(0)
  })
})

describe('P0 sym/ltf — the refusal REACHES the member (real binder → disclosure strip store)', () => {
  beforeEach(() => resetChartClockNotes())
  afterEach(() => resetChartClockNotes())

  function mount(def) {
    const { errors } = registry.installUserDefinitions([def])
    expect(errors).toEqual([])
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    const cs = addInstance(mergeChartSettings({}), def.id, registry)
    const instances = (cs.indicatorInstances || []).filter((i) => i.defId === def.id)
    const sync = (over = {}) => binder.sync({
      enabled: true, cs, instances, registry, bars: BARS, tf: 'D',
      symbol: { ticker: 'AAPL', exchange: 'NASDAQ' }, newestBarIsForming: false,
      adjustTime: (t) => t, applyData: (series, data) => series.setData(data), plan: { fresh: true },
      resolvePlacement: () => ({ paneIndex: 1, scaleId: def.id, scaleOptions: {} }),
      createObjectLayer: () => ({ set: () => {}, clear: () => {} }),
      ...over,
    })
    return { binder, sync, ids: instances.map((i) => i.instanceId), done: () => { binder.teardown(); registry.uninstallUserDefinition(def.id) } }
  }

  it('sym with no bars → a named row on the strip; once SPY lands → served and the row is gone', () => {
    const def = formulaDoc("close / sym('SPY', close)")
    const m = mount(def)
    m.sync({ secondary: sec([['SPY', { bars: [], status: 'error' }]]) })
    expect(chartClockNotesFor(m.ids).map((n) => n.code)).toEqual([OTHER_SYMBOL_REFUSAL.NO_BARS])
    m.sync({ secondary: AVAILABLE_SPY })
    expect(chartClockNotesFor(m.ids)).toEqual([])
    m.done()
  })

  it('ltf in a formula → the refusal row is on the strip', () => {
    const def = formulaDoc("ltf(close, '60')")
    const m = mount(def)
    m.sync()
    expect(chartClockNotesFor(m.ids)).toEqual([{ code: registry.FORMULA_LTF_GUARD, reason: registry.FORMULA_LTF_MESSAGE }])
    m.done()
  })
})
