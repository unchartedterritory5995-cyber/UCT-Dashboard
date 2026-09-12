import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createBinder } from '../binder'
import { createFakeChart } from './fakeChart'
import { __setPaneModeForTest, computePaneLayout, SEPARATOR_PX } from '../paneLayout'
import * as registry from '../nativeRegistry'
import { resolveDisplayTarget, derivedTargetOf, paneFollowerKeys, paneOwnersNeeded } from '../displayTarget'
import { resolvePlacement } from '../placement'
import { COND_TRUE, COND_FALSE, COND_UNKNOWN, evaluateCondition } from '../conditions'
import { signalPlotKey, signalColumn } from '../definitionSignal'
import { buildDefinition } from '../../builder/BuilderSheet'
import { evaluateFormula } from '../../builder/FormulaField'
import { BUILDER_INPUTS, BUILDER_INPUT_SCOPE } from '../../builder/builderInputs'

// ─── A DURABLE CONDITION, DRAWN ─────────────────────────────────────────────
//
// ⭐⭐ THE CLAIM UNDER TEST IS THAT THE TWO KINDS ARE INDISTINGUISHABLE DOWNSTREAM.
// A condition backed by a user definition and one carrying an inline formula must
// produce the SAME column shape, the same warm-up head and the same UNKNOWN
// semantics, because the candle colour, the marker and the background have no idea
// which they are reading — and if they ever could tell, the two would drift.

const bars = Array.from({ length: 120 }, (_, i) => {
  const up = i % 3 !== 0
  const base = 100 + Math.sin(i / 7) * 8 + i * 0.02
  return { t: 1700000000 + i * 86400, o: up ? base : base + 1, c: up ? base + 1 : base, h: base + 2, l: base - 2, v: 1e6 }
})

/** A stored single-plot boolean definition — built by the SAME writer promotion
 *  uses, so a fixture can never be a shape the product does not produce. */
const boolDef = (id, source, version = 1) => {
  const ev = evaluateFormula(source, BUILDER_INPUT_SCOPE)
  expect(ev.ok, `fixture formula did not read back: ${source}`).toBe(true)
  return buildDefinition({
    defId: id, name: 'Fixture', version,
    source: ev.source, ast: ev.ast, mode: ev.verdict.mode, readback: ev.readback,
    inputs: BUILDER_INPUTS,
  })
}

const install = (def) => {
  const { installed, errors } = registry.installUserDefinitions([def])
  expect(errors, `the registry refused the fixture: ${errors.join('; ')}`).toEqual([])
  expect(installed).toHaveLength(1)
  return def
}

describe('a definition-backed condition evaluates', () => {
  it('⭐⭐ it produces the SAME column as the same formula written inline', () => {
    const src = 'close > open'
    install(boolDef('u_aaaaaaaaaa01', src))
    const durable = evaluateCondition({ id: 'c1', definitionId: 'u_aaaaaaaaaa01' }, bars, () => null, registry)
    const inline = evaluateCondition({ id: 'c2', formula: src, bindings: {} }, bars, () => null, registry)
    expect(durable.error).toBe(null)
    expect(durable.column).toBeInstanceOf(Uint8Array)
    expect([...durable.column]).toEqual([...inline.column])
    // …and the fixture genuinely has both answers to find
    expect(new Set(durable.column).has(COND_TRUE)).toBe(true)
    expect(new Set(durable.column).has(COND_FALSE)).toBe(true)
  })

  it('⭐ the WARM-UP HEAD is the definition tree’s, so UNKNOWN means the same thing', () => {
    install(boolDef('u_aaaaaaaaaa02', 'close > sma(close, 30)'))
    const durable = evaluateCondition({ id: 'c1', definitionId: 'u_aaaaaaaaaa02' }, bars, () => null, registry)
    const inline = evaluateCondition({ id: 'c2', formula: 'close > sma(close, 30)', bindings: {} }, bars, () => null, registry)
    expect(durable.error).toBe(null)
    const head = (r) => [...r.column].findIndex((v) => v !== COND_UNKNOWN)
    expect(head(durable)).toBeGreaterThan(0)          // there IS a warm head…
    expect(head(durable)).toBe(head(inline))          // …and it is the same one
  })

  it('⛔ a definition that is not installed reads back as Source unavailable', () => {
    const r = evaluateCondition({ id: 'c1', definitionId: 'u_ffffffffff99' }, bars, () => null, registry)
    expect(r.column).toBe(null)
    expect(r.error).toBe('Source unavailable')
    expect(r.missing).toEqual(['u_ffffffffff99'])
  })

  it('⛔ NO REGISTRY IS A REFUSAL, NOT A THROW', () => {
    // `evaluateCondition` is called from inside the binder's paint path. A throw
    // here is a black board, and there are callers that hold no registry.
    expect(() => evaluateCondition({ id: 'c1', definitionId: 'u_aaaaaaaaaa01' }, bars, () => null))
      .not.toThrow()
    expect(evaluateCondition({ id: 'c1', definitionId: 'u_aaaaaaaaaa01' }, bars, () => null).error)
      .toBe('Source unavailable')
  })

  it('⛔⛔ THE DEFINITION IS CANONICAL — a stale compatibility formula is NOT read', () => {
    // A promoted row may still carry the text it came from. If the definition is
    // missing, falling back to that text would shade the chart on the OLD maths
    // with nothing to tell the member the two had parted.
    const r = evaluateCondition(
      { id: 'c1', definitionId: 'u_ffffffffff98', formula: 'close > open', bindings: {} },
      bars, () => null, registry,
    )
    expect(r.column).toBe(null)
    expect(r.error).toBe('Source unavailable')
  })
})

describe('which output is the signal', () => {
  it('⭐⭐ a MULTI-PLOT definition is read on its SCAN plot, not on plot 1', () => {
    // The alert lane addresses `compute.scanPlot`. A chart shading on plot 1 would
    // disagree with the alert armed on the very same condition, and both would
    // look right from where they stand.
    const up = evaluateFormula('close > open', BUILDER_INPUT_SCOPE)
    const down = evaluateFormula('close < open', BUILDER_INPUT_SCOPE)
    const row = (key, ev) => ({
      key, label: key, style: 'line', color: BUILDER_INPUTS[0].default, width: BUILDER_INPUTS[1].default,
      source: ev.source, ast: ev.ast, mode: ev.verdict.mode, readback: ev.readback,
    })
    const def = install(buildDefinition({
      defId: 'u_aaaaaaaaaa03', name: 'Multi', version: 1,
      source: down.source, ast: down.ast, mode: down.verdict.mode, readback: down.readback,
      inputs: BUILDER_INPUTS,
      plots: [row('up', up), row('down', down)],
      scanPlot: 'down',
    }))
    expect(signalPlotKey(def)).toBe('down')

    const r = evaluateCondition({ id: 'c1', definitionId: 'u_aaaaaaaaaa03' }, bars, () => null, registry)
    const inverse = evaluateCondition({ id: 'c2', formula: 'close < open', bindings: {} }, bars, () => null, registry)
    expect(r.error).toBe(null)
    expect([...r.column]).toEqual([...inverse.column])

    // …and it is genuinely NOT plot 1, or this case would pass on either answer.
    const plot1 = evaluateCondition({ id: 'c3', formula: 'close > open', bindings: {} }, bars, () => null, registry)
    expect([...r.column]).not.toEqual([...plot1.column])
  })

  it('⛔ a GUIDE plot is never the signal', () => {
    expect(signalPlotKey({ plots: [{ key: 'levels', role: 'guide' }, { key: 'value', role: 'primary' }] })).toBe('value')
  })

  it('⛔ a named plot the registry did not produce falls back rather than answering null', () => {
    expect(signalColumn({ compute: { scanPlot: 'nope' } }, { value: [1, 2] })).toEqual([1, 2])
    expect(signalColumn({ compute: { scanPlot: 'nope' } }, null)).toBe(null)
    expect(signalColumn({ compute: { scanPlot: 'nope' } }, {})).toBe(null)
  })
})

// ─── AND THROUGH THE BINDER, WHICH IS WHERE IT ACTUALLY RUNS ────────────────

const ctxFor = (instances, conditions) => {
  const settings = { indicatorInstances: instances }
  const layout = computePaneLayout(instances, {
    chartHeight: 600, hasVolumeBand: false, separatorPx: SEPARATOR_PX,
    excludeKeys: paneFollowerKeys(instances, settings),
    keepKeys: paneOwnersNeeded(instances, settings),
  })
  return {
    enabled: true, instances, registry, bars, conditions,
    adjustTime: (t) => t,
    plan: { fresh: true },
    applyData: (s, d) => s.setData(d),
    paneLayout: layout,
    targetOf: (i) => resolveDisplayTarget(i, settings),
    // ⚠️ REQUIRED. `binder.sync` returns `'no placement resolver'` without one and
    // evaluates NOTHING — a ctx missing it would make every case below vacuous.
    resolvePlacement: (i, def) => resolvePlacement(i, def, {
      paneMargins: layout.bands, paneLayout: layout,
      volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1,
      targetOf: (x) => resolveDisplayTarget(x, settings),
      derivedTargetOf: (x) => derivedTargetOf(x, settings),
    }),
  }
}

const durableCond = (id, definitionId) => ({
  id, name: id, definitionId, formula: '', enabled: true, bindings: {}, actions: [],
})

describe('the binder', () => {
  let fake
  let binder
  beforeEach(() => { __setPaneModeForTest('panes'); fake = createFakeChart(); binder = createBinder({ chart: fake.chart, LWC: fake.LWC }) })
  afterEach(() => { __setPaneModeForTest(null); vi.restoreAllMocks() })

  it('⭐⭐ THE REGISTRY REACHES THE CONDITION LANE — a promoted condition DRAWS', () => {
    install(boolDef('u_bbbbbbbbbb01', 'close > open'))
    binder.sync(ctxFor([], [durableCond('D1', 'u_bbbbbbbbbb01')]))
    const { columns, errors } = binder.conditions()
    expect(errors.get('D1'), 'the promoted condition did not evaluate').toBeUndefined()
    expect(columns.get('D1')).toBeInstanceOf(Uint8Array)
  })

  it('⭐ two durable conditions on one chart draw their own columns', () => {
    // The memo is keyed per condition id, so these two could not collide through
    // it — this is here because both carry `formula: ''` and a lane that keyed
    // anything on the formula text would see one condition where there are two.
    install(boolDef('u_bbbbbbbbbb02', 'close > open'))
    install(boolDef('u_bbbbbbbbbb03', 'close < open'))
    binder.sync(ctxFor([], [
      durableCond('D1', 'u_bbbbbbbbbb02'),
      durableCond('D2', 'u_bbbbbbbbbb03'),
    ]))
    const { columns } = binder.conditions()
    const a = columns.get('D1')
    const b = columns.get('D2')
    expect(a).toBeInstanceOf(Uint8Array)
    expect(b).toBeInstanceOf(Uint8Array)
    expect([...a]).not.toEqual([...b])
  })

  it('⭐ a second sync that changes nothing does NOT recompute', () => {
    install(boolDef('u_bbbbbbbbbb04', 'close > open'))
    const c = durableCond('D1', 'u_bbbbbbbbbb04')
    binder.sync(ctxFor([], [c]))
    const first = binder.conditions().columns.get('D1')
    binder.sync(ctxFor([], [{ ...c }]))
    expect(binder.conditions().columns.get('D1'), 'it recomputed although nothing it reads changed').toBe(first)
  })

  it('⛔⛔ AN EDIT TO THE DEFINITION INVALIDATES THE MEMO', () => {
    // `installUserDefinitions` replaces the document under the SAME id, so a memo
    // keyed on the id alone would hold the pre-edit column for as long as the bars
    // array did — the member edits their formula and the chart does not move.
    install(boolDef('u_bbbbbbbbbb05', 'close > open'))
    const c = durableCond('D1', 'u_bbbbbbbbbb05')
    binder.sync(ctxFor([], [c]))
    const before = [...binder.conditions().columns.get('D1')]

    install(boolDef('u_bbbbbbbbbb05', 'close < open', 2))
    binder.sync(ctxFor([], [{ ...c }]))
    const after = [...binder.conditions().columns.get('D1')]
    expect(after).not.toEqual(before)
  })
})

// ─── THE DIFFERENCE BETWEEN THE TWO KINDS, MEASURED ─────────────────────────
//
// ⭐⭐ THIS IS THE WHOLE PRODUCT DECISION, AS AN ASSERTION. A LOCAL condition
// FOLLOWS the chart's indicator; a DURABLE one FREEZES its own inputs. Both are
// correct sentences and they are different sentences, which is why one is never
// silently turned into the other.

describe('LOCAL follows the chart; DURABLE does not', () => {
  const rsiCol = (period) => registry.computeFor(registry.getDefinition('rsi'), bars, { period }, undefined).rsi
  const columnFor = (period) => (key) => (String(key).includes('legacy:rsi') ? rsiCol(period) : null)
  const LOCAL = { id: 'L', formula: 'a > 50', bindings: { a: '@legacy:rsi::rsi' }, enabled: true }
  const DURABLE = { id: 'D', definitionId: 'u_cccccccccc01', formula: '', bindings: {}, enabled: true }

  const run = (period) => {
    install(boolDef('u_cccccccccc01', 'rsi(close, 14) > 50'))
    return {
      local: evaluateCondition(LOCAL, bars, columnFor(period), registry).column,
      durable: evaluateCondition(DURABLE, bars, columnFor(period), registry).column,
    }
  }
  const trues = (c) => [...c].filter((v) => v === COND_TRUE).length
  const same = (a, b) => a.length === b.length && [...a].every((v, i) => v === b[i])

  it('⭐⭐ move the chart’s RSI from 14 to 28: the LOCAL one moves, the DURABLE one does not', () => {
    const at14 = run(14)
    const at28 = run(28)
    expect(same(at14.local, at28.local), 'the local condition did NOT follow the chart').toBe(false)
    expect(same(at14.durable, at28.durable), 'the durable condition FOLLOWED the chart').toBe(true)
    // …and the move is a real one, not a one-bar rounding difference
    expect(trues(at14.local)).not.toBe(trues(at28.local))
    expect(trues(at14.durable)).toBe(trues(at28.durable))
  })

  it('⭐⭐ AND THEY AGREE ON THE WARM-UP HEAD — the correction, kept honest here', () => {
    // ⚰️ THIS CASE USED TO PIN THE OPPOSITE, and the comment it carried is worth
    // keeping because the two facts that produced the divergence are each
    // individually correct and will look correct again to the next reader:
    //
    //   * `maxLookback('a > 50')` is 0 — the tree names a binding, not a window.
    //   * `NaN > 50` is 0, not NaN — a comparison against NaN is pinned at FALSE
    //     by design (Pine's rule, and the one the scan lane is tested against).
    //
    // Together they put a finite `0` on bars where nothing had been evaluated, so
    // LOCAL read FALSE over the head where DURABLE read UNKNOWN.
    // `conditions.unavailableFromSources` now masks the bars a BOUND SOURCE has no
    // number for, and the two spellings of one idea produce one column.
    //
    // The detailed bar-by-bar cases live in `conditionWarmupParity.test.js`; this
    // one stays here so the divergence cannot come back unnoticed in THIS file,
    // which is where a future reader will look for what the two forms share.
    const { local, durable } = run(14)
    const head = (c) => [...c].findIndex((v) => v !== COND_UNKNOWN)
    expect(head(local)).toBe(head(durable))
    expect(head(local)).toBe(14)
    expect([...local]).toEqual([...durable])
  })
})
