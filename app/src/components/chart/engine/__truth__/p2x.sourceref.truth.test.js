// app/src/components/chart/engine/__truth__/p2x.sourceref.truth.test.js
//
// ─── ⭐⭐ P2X — A MOVING AVERAGE NEVER SILENTLY RE-ATTACHES TO A NEW INSTANCE THAT
//     REUSES ITS SOURCE'S ID ──────────────────────────────────────────────────
//
// P1-info finding 1: `sourceRef.severReferencesTo` had NO production caller. A
// `legacy:<defId>` id is deterministic, and `setIndicatorEnabled(…, true)`
// rebuilds `legacy:<defId>` under the SAME id after a delete — so a Moving
// Average whose source was `@legacy:rsi::rsi` read the NEW RSI the moment one
// was added, without the member choosing it (the owner's locked ruling,
// `sourceRef.js` "DELETION BREAKS THE DEPENDENCY", was implemented and never
// wired). The two delete doors (`removeInstance`, `setIndicatorEnabled(false)`)
// now sever the dependents: the source becomes the visible gravestone
// (`!@legacy:rsi::rsi`, "Source unavailable") — the same pattern as the header's
// info values (`severed: true`).
//
// ⭐ A1 (D3, owner-approved 2026-10-13): `setIndicatorEnabled(false)` now HIDES and severs
// nothing (decision O3: dependents are kept). The definition DELETE moved, verbatim, to
// `removeDefinition`, and every delete → re-add case below drives that door explicitly.
//
// Each case: ASKED / CLAIMED / DID, and its class.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as registry from '../nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { createBinder } from '../binder'
import {
  setIndicatorEnabled, removeInstance, addInstance, setInstanceInput, findInstance, removeDefinition,
  HIDDEN_VIA_DEFINITION,
} from '../instanceControls'
import {
  instanceSource, parseSource, isSeveredSource, sourceDependsOn, severReferencesTo, sourceLineIntactIn,
} from '../sourceRef'
import { withInstances } from '../instanceControls'
import { addInfoValue, infoValuesOf } from '../infoValues'
import { resolveInfoValue, resolveInfoValues, INFO_VALUE_STATES, INFO_VALUE_GUARDS } from '../infoValueResolve'
import { buildDefinition } from '../../builder/BuilderSheet'
import { evaluateFormula } from '../../builder/FormulaField'
import { BUILDER_INPUTS, BUILDER_INPUT_SCOPE } from '../../builder/builderInputs'
import { clearSecondaryBars } from '../secondaryBars'
import { OHLC_FAMILY } from '../ohlcCapability'

const RSI_SRC = instanceSource('legacy:rsi', 'rsi')

/** A chart with RSI on (legacy:rsi) and a Moving Average reading RSI's output. */
function chartWithMaOverRsi() {
  const cs0 = setIndicatorEnabled(mergeChartSettings('{}'), 'rsi', true, registry)
  const before = new Set((cs0.indicatorInstances || []).map((i) => i && i.instanceId))
  const cs1 = addInstance(cs0, 'movingAverage', registry)
  const ma = cs1.indicatorInstances.find((i) => i && i.defId === 'movingAverage' && !before.has(i.instanceId))
  if (!ma) throw new Error('addInstance minted no MA')
  const cs2 = setInstanceInput(cs1, ma.instanceId, 'source', RSI_SRC, registry)
  if (findInstance(cs2, ma.instanceId).inputs.source !== RSI_SRC) throw new Error('the MA source was refused')
  return { cs: cs2, maId: ma.instanceId }
}
const maSource = (cs, maId) => {
  const inst = findInstance(cs, maId)
  return inst ? inst.inputs.source : undefined
}

// ── the binder, exactly as `movingAverageSource.test.js` drives it ───────────
const bars = (n) => Array.from({ length: n }, (_, i) => ({
  t: `2026-${String(4 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
  o: 100 + Math.sin(i / 3) * 5, h: 106 + Math.sin(i / 3) * 5, l: 94 + Math.sin(i / 3) * 5,
  c: 100 + Math.sin(i / 3) * 5, v: 1000 + i,
}))
function harness() {
  const created = []
  const chart = {
    addSeries: (ctor, options, paneIndex) => {
      const series = {
        __data: [], ctor, options, paneIndex,
        setData: (d) => { series.__data = d }, update: () => {}, applyOptions: (o) => Object.assign(options, o),
        priceScale: () => ({ applyOptions: () => {} }),
        createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {},
      }
      created.push(series)
      return series
    },
    removeSeries: () => {},
    panes: () => [{ paneIndex: () => 0, setHeight: () => {}, getHeight: () => 100 }],
    priceScale: () => ({ applyOptions: () => {} }),
  }
  const LWC = { LineSeries: 'LineSeries', HistogramSeries: 'HistogramSeries', AreaSeries: 'AreaSeries',
    BaselineSeries: 'BaselineSeries', CandlestickSeries: 'CandlestickSeries' }
  return { chart, LWC, created }
}
/** The MA's drawn values on a chart holding exactly these instances. */
function maValues(cs, maId) {
  const live = (cs.indicatorInstances || []).filter((i) => i && i.defId && (i.instanceId === maId || i.defId === 'rsi'))
  const h = harness()
  const binder = createBinder({ chart: h.chart, LWC: h.LWC })
  binder.sync({
    enabled: true, registry, instances: live, bars: bars(60),
    cs: mergeChartSettings({}), sym: 'NVDA', tf: 'D', secondary: new Map(),
    ohlcFamilyOf: () => OHLC_FAMILY.SECURITY,
    resolvePlacement: () => ({ paneIndex: 1, priceScaleId: 'right', key: 'p' }),
  })
  const maSeries = h.created.filter((s) => s.options && String(s.options.title || '').length >= 0)
  // the MA is the series whose options name the MA instance, or the last one created
  const vals = maSeries.map((s) => s.__data.map((p) => p.value).filter(Number.isFinite))
  return vals
}

beforeEach(() => { clearSecondaryBars() })

describe('the fixture is real', () => {
  it('an MA over legacy:rsi reads RSI (values in 0–100), so the cases below are not vacuous', () => {
    const { cs, maId } = chartWithMaOverRsi()
    expect(sourceDependsOn(maSource(cs, maId))).toBe('legacy:rsi')
    const all = maValues(cs, maId)
    // two series: RSI and the MA over it — both finite and both inside 0–100
    expect(all.filter((v) => v.length).length).toBe(2)
    for (const v of all) for (const x of v) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(100) }
  })
})

describe('⛔⛔ delete → re-add under the SAME id never reconnects the MA', () => {
  // A1 (D3): the toggle HIDES now, so the delete in this scenario is explicit — removeDefinition.
  it('ASKED delete RSI (removeDefinition), then turn it on again (setIndicatorEnabled rebuilds `legacy:rsi`) · CLAIMED the MA does not adopt the new RSI · DID sever it — UNAVAILABLE (was: SILENT RECONNECT)', () => {
    const { cs, maId } = chartWithMaOverRsi()
    const off = removeDefinition(cs, 'rsi', registry)
    const on = setIndicatorEnabled(off, 'rsi', true, registry)
    // the re-add really did mint the very same id — this is the hazard
    expect(findInstance(on, 'legacy:rsi')).toBeTruthy()
    const src = maSource(on, maId)
    expect(isSeveredSource(src), `the MA reconnected: source is ${src}`).toBe(true)
    expect(src).toBe(`!${RSI_SRC}`)       // the gravestone keeps the old text
    expect(parseSource(src)).toBeNull()     // → "Source unavailable", never Close
    expect(sourceDependsOn(src)).toBeNull()
    // and on the chart: RSI draws, the MA draws NOTHING (not the new RSI's average)
    const drawn = maValues(on, maId).filter((v) => v.length)
    expect(drawn.length).toBe(1)
  })

  it('ASKED remove RSI from the chart (removeInstance), then turn it on again · CLAIMED the same · DID', () => {
    const { cs, maId } = chartWithMaOverRsi()
    const removed = removeInstance(cs, 'legacy:rsi', registry)
    expect(isSeveredSource(maSource(removed, maId))).toBe(true)
    const on = setIndicatorEnabled(removed, 'rsi', true, registry)
    expect(findInstance(on, 'legacy:rsi')).toBeTruthy()
    expect(isSeveredSource(maSource(on, maId))).toBe(true)
  })

  it('ASKED re-point the MA explicitly after the re-add · CLAIMED the member\'s explicit choice reconnects it · DID — EXACT', () => {
    const { cs, maId } = chartWithMaOverRsi()
    // A1 (D3): delete → re-add, so the delete is explicit (removeDefinition)
    const on = setIndicatorEnabled(removeDefinition(cs, 'rsi', registry), 'rsi', true, registry)
    const repaired = setInstanceInput(on, maId, 'source', RSI_SRC, registry)
    expect(maSource(repaired, maId)).toBe(RSI_SRC)
    expect(maValues(repaired, maId).filter((v) => v.length).length).toBe(2)
  })

  // ⭐ A1 (D3, decision O3): a definition HIDE is not a delete — the MA is KEPT connected.
  it('ASKED turn RSI off with the definition toggle, then on · CLAIMED a hide keeps the MA reading RSI (O3) · DID — never severed, byte-identical after ON', () => {
    const { cs, maId } = chartWithMaOverRsi()
    const off = setIndicatorEnabled(cs, 'rsi', false, registry)
    expect(findInstance(off, 'legacy:rsi')).toMatchObject({ hidden: true, hiddenVia: HIDDEN_VIA_DEFINITION })
    expect(maSource(off, maId), 'a definition hide severed the MA').toBe(RSI_SRC)
    expect(findInstance(off, maId), 'the hide touched the dependent').toEqual(findInstance(cs, maId))
    const on = setIndicatorEnabled(off, 'rsi', true, registry)
    expect(JSON.stringify(on), 'ON after a hide is not byte-identical').toBe(JSON.stringify(cs))
    expect(maValues(on, maId).filter((v) => v.length).length).toBe(2)
  })

  it('ASKED add a SECOND RSI after deleting one (`inst:rsi:N`) · CLAIMED never the deleted id · DID (control: the tombstone holds the id)', () => {
    const base = setIndicatorEnabled(mergeChartSettings('{}'), 'rsi', true, registry)
    const a = addInstance(base, 'rsi', registry)
    const firstId = a.indicatorInstances.find((i) => i && i.instanceId && i.instanceId.startsWith('inst:rsi:')).instanceId
    const gone = removeInstance(a, firstId, registry)
    const b = addInstance(gone, 'rsi', registry)
    const ids = b.indicatorInstances.filter((i) => i && i.defId === 'rsi' && !i.removed).map((i) => i.instanceId)
    expect(ids.filter((id) => id === firstId).length).toBeLessThanOrEqual(1)
    expect(findInstance(b, firstId)).toBeNull()
  })
})

describe('persistence — the gravestone is ordinary, durable chart-settings state', () => {
  it('ASKED save → reload the severed blob · CLAIMED the marker survives `mergeChartSettings` unchanged, and the blob gains no other key · DID', () => {
    const { cs, maId } = chartWithMaOverRsi()
    // A1 (D3): the severing door is removeDefinition (the toggle hides and severs nothing)
    const off = removeDefinition(cs, 'rsi', registry)
    const reread = mergeChartSettings(JSON.stringify(off))
    expect(maSource(reread, maId)).toBe(`!${RSI_SRC}`)
    expect(JSON.stringify(mergeChartSettings(JSON.stringify(reread)))).toBe(JSON.stringify(reread))
    // the dead `conditions` vestige is not conjured into the blob by a sever
    expect('conditions' in off).toBe('conditions' in cs)
  })

  it('ASKED delete an instance nothing reads · CLAIMED nothing else moves (identity for the dependents) · DID', () => {
    const { cs, maId } = chartWithMaOverRsi()
    const macd = setIndicatorEnabled(cs, 'macd', true, registry)
    // A1 (D3): "delete" is removeDefinition — the toggle would only hide (and trivially pass)
    const off = removeDefinition(macd, 'macd', registry)
    expect(maSource(off, maId)).toBe(RSI_SRC)
    expect(findInstance(off, maId)).toBe(findInstance(macd, maId))
    expect(severReferencesTo(macd, 'legacy:macd', registry.getDefinition)).toBe(macd)
  })
})

// ─── ⭐⭐ LINE IDENTITY (owner decision 2026-11-02) — FIXED, was the it.todo here ──
//
// ⚰️ It read: "DISCLOSED, NOT FIXED — an output KEY reused across a definition edit
// (remove output "fast", later add a NEW "fast") is read by an MA / info value on
// `@inst::fast` without the member choosing it; needs output provenance across versions
// (owner review)". The store now gives every saved line a `uid` (`decide_line_ids`) and
// a reference records the line it bound to (`sourceLines` / an info value's `line`).
//
// Each case drives the REAL doors: `setInstanceInput` (records), the binder (resolves),
// `addInfoValue` / `resolveInfoValue`, `withInstances` (the 3d stamp). The store's uid
// decision is stood in for by the uids written on each installed version.

const LINE_DEF = 'u_0000000lid01'
const UID_A = 'p_aaaaaaaaaaaa'
const UID_B = 'p_bbbbbbbbbbbb'
function lineRow(key, text) {
  const ev = evaluateFormula(text, BUILDER_INPUT_SCOPE)
  if (!ev.ok) throw new Error(`${text}: ${ev.error}`)
  return { key, label: '', style: 'line', color: BUILDER_INPUTS[0].default, width: BUILDER_INPUTS[1].default,
    hidden: false, source: ev.source, ast: ev.ast, mode: ev.verdict.mode, readback: ev.readback }
}
/** One stored version of the member's definition: `[{key, text, uid?, newLine?}]`. */
function lineDoc(version, specs) {
  const rows = specs.map((sp) => lineRow(sp.key, sp.text))
  const d = buildDefinition({
    defId: LINE_DEF, version, name: 'Lines', source: rows[0].source, ast: rows[0].ast, mode: rows[0].mode,
    readback: rows[0].readback, inputs: [...BUILDER_INPUTS], plots: rows, scanPlot: rows[0].key,
  })
  d.plots = d.plots.map((pl) => {
    const sp = specs.find((x) => x.key === pl.key) || {}
    return { ...pl, ...(sp.uid ? { uid: sp.uid } : {}), ...(sp.newLine ? { newLine: true } : {}) }
  })
  return d
}
function installLines(version, specs) {
  const { installed, errors } = registry.installUserDefinitions([lineDoc(version, specs)])
  if (errors.length || installed.length !== 1) throw new Error(`install refused: ${errors.join('; ')}`)
}
const V1 = [{ key: 'value', text: 'close', uid: 'p_000000000001' }, { key: 'fast', text: 'close * 2', uid: UID_A }]
const V2_FAST_GONE = [{ key: 'value', text: 'close', uid: 'p_000000000001' }]
const V3_FAST_READDED = [{ key: 'value', text: 'close', uid: 'p_000000000001' }, { key: 'fast', text: 'close * 3', uid: UID_B }]
const V2_FAST_EDITED = [{ key: 'value', text: 'close', uid: 'p_000000000001' }, { key: 'fast', text: 'close * 3', uid: UID_A }]

/** A chart with the member's definition on it and a Moving Average reading its `fast`. */
function chartWithMaOverFast() {
  installLines(1, V1)
  const cs0 = mergeChartSettings('{}')
  const cs1 = addInstance(cs0, LINE_DEF, registry)
  const host = cs1.indicatorInstances.find((i) => i && i.defId === LINE_DEF)
  const before = new Set(cs1.indicatorInstances.map((i) => i && i.instanceId))
  const cs2 = addInstance(cs1, 'movingAverage', registry)
  const ma = cs2.indicatorInstances.find((i) => i && i.defId === 'movingAverage' && !before.has(i.instanceId))
  const src = instanceSource(host.instanceId, 'fast')
  const cs3 = setInstanceInput(cs2, ma.instanceId, 'source', src, registry)
  if (findInstance(cs3, ma.instanceId).inputs.source !== src) throw new Error('the MA source was refused')
  return { cs: cs3, maId: ma.instanceId, hostId: host.instanceId, src }
}
/** How many of the chart's series drew anything (the host's two lines + the MA's one). */
function drawnSeries(cs, maId) {
  const live = (cs.indicatorInstances || [])
    .filter((i) => i && i.deleted !== true && (i.defId === LINE_DEF || i.instanceId === maId))
  const h = harness()
  const binder = createBinder({ chart: h.chart, LWC: h.LWC })
  binder.sync({
    enabled: true, registry, instances: live, bars: bars(60),
    cs: mergeChartSettings({}), sym: 'NVDA', tf: 'D', secondary: new Map(),
    ohlcFamilyOf: () => OHLC_FAMILY.SECURITY,
    resolvePlacement: () => ({ paneIndex: 1, priceScaleId: 'right', key: 'p' }),
  })
  return h.created.filter((s) => s.__data.some((p) => Number.isFinite(p.value))).length
}
/** `cs` as an instance list written before line identity existed (no `sourceLines`). */
const asLegacy = (cs) => ({
  ...cs,
  indicatorInstances: cs.indicatorInstances.map((i) => {
    if (!i || !i.sourceLines) return i
    const { sourceLines: _l, ...rest } = i
    return rest
  }),
})

describe('⛔⛔ LINE IDENTITY — a line re-added under a removed key never inherits its references', () => {
  afterEach(() => { registry.uninstallUserDefinition(LINE_DEF) })

  it('the fixture is real: the MA over `fast` draws, and the pick recorded the line it bound to', () => {
    const { cs, maId } = chartWithMaOverFast()
    expect(findInstance(cs, maId).sourceLines).toEqual({ source: UID_A })
    expect(drawnSeries(cs, maId)).toBe(3)
  })

  it('ASKED remove "fast", later add a NEW "fast" (new uid) · CLAIMED the MA does not read the new line · DID — UNAVAILABLE (was: SILENT RECONNECT, the it.todo)', () => {
    const { cs, maId, src } = chartWithMaOverFast()
    installLines(2, V2_FAST_GONE)
    expect(drawnSeries(cs, maId)).toBe(1)                      // the key is gone: nothing to read
    installLines(3, V3_FAST_READDED)
    expect(maSource(cs, maId)).toBe(src)                 // the stored value is untouched…
    expect(drawnSeries(cs, maId), 'the MA reconnected to the re-added line').toBe(2)   // …and reads nothing
    expect(sourceLineIntactIn(cs, maId, 'source', src, registry.getDefinition)).toBe(false)  // "Source unavailable"
  })

  it('CONTROL — an EDIT of the same line (same uid, new maths) keeps the MA bound', () => {
    const { cs, maId, src } = chartWithMaOverFast()
    installLines(2, V2_FAST_EDITED)
    expect(drawnSeries(cs, maId)).toBe(3)
    expect(sourceLineIntactIn(cs, maId, 'source', src, registry.getDefinition)).toBe(true)
  })

  it("ASKED re-point the MA explicitly at the new line · CLAIMED the member's choice binds it · DID", () => {
    const { cs, maId, src } = chartWithMaOverFast()
    installLines(3, V3_FAST_READDED)
    const repaired = setInstanceInput(cs, maId, 'source', src, registry)
    expect(findInstance(repaired, maId).sourceLines).toEqual({ source: UID_B })
    expect(drawnSeries(repaired, maId)).toBe(3)
  })

  it('a line the store has not answered for yet (pending, `newLine`) matches no recorded reference and records none', () => {
    const { cs, maId, src } = chartWithMaOverFast()
    installLines(3, [V1[0], { key: 'fast', text: 'close * 3', newLine: true }])
    expect(drawnSeries(cs, maId)).toBe(2)
    const picked = setInstanceInput(cs, maId, 'source', src, registry)
    expect(findInstance(picked, maId).sourceLines).toBeUndefined()
    expect(drawnSeries(picked, maId)).toBe(3)                  // unrecorded → binds by key, as before
  })

  it('LEGACY — a reference with nothing recorded binds by key exactly as before', () => {
    const { cs, maId } = chartWithMaOverFast()
    const legacy = asLegacy(cs)
    expect(findInstance(legacy, maId).sourceLines).toBeUndefined()
    installLines(3, V3_FAST_READDED)
    expect(drawnSeries(legacy, maId)).toBe(3)
  })

  it('3d — a legacy reference learns its line at the NEXT WRITE, and then a re-added line does not inherit it', () => {
    const { cs, maId } = chartWithMaOverFast()
    const legacy = asLegacy(cs)
    const written = withInstances(legacy, legacy.indicatorInstances, registry)
    expect(findInstance(written, maId).sourceLines).toEqual({ source: UID_A })
    installLines(3, V3_FAST_READDED)
    expect(drawnSeries(written, maId)).toBe(2)
  })

  it('3d — while the key is gone a write stamps `retired`, so the later re-add does not inherit it', () => {
    const { cs, maId } = chartWithMaOverFast()
    installLines(2, V2_FAST_GONE)
    const legacy = asLegacy(cs)
    const written = withInstances(legacy, legacy.indicatorInstances, registry)
    expect(findInstance(written, maId).sourceLines).toEqual({ source: 'retired' })
    installLines(3, V3_FAST_READDED)
    expect(drawnSeries(written, maId)).toBe(2)
  })

  it('3d — never stamps against an UNLOADED definition, and reads never write', () => {
    const { cs, maId, src } = chartWithMaOverFast()
    const legacy = asLegacy(cs)
    const snapshot = JSON.stringify(legacy)
    drawnSeries(legacy, maId)                                  // a render…
    resolveInfoValues(legacy, { defOf: registry.getDefinition })
    sourceLineIntactIn(legacy, maId, 'source', src, registry.getDefinition)
    expect(JSON.stringify(legacy)).toBe(snapshot)        // …changed nothing
    registry.uninstallUserDefinition(LINE_DEF)
    const written = withInstances(legacy, legacy.indicatorInstances, registry)
    expect(findInstance(written, maId).sourceLines).toBeUndefined()
  })
})

describe('⛔⛔ LINE IDENTITY — a header info value never reads a re-added line', () => {
  afterEach(() => { registry.uninstallUserDefinition(LINE_DEF) })

  it('ASKED show `fast` in the header, remove it, add a NEW `fast` · CLAIMED the value is unavailable · DID', () => {
    const { cs, hostId } = chartWithMaOverFast()
    const withValue = addInfoValue(cs, { instanceId: hostId, plotKey: 'fast' }, registry.getDefinition)
    const stored = infoValuesOf(withValue)
    expect(stored).toEqual([{ instanceId: hostId, plotKey: 'fast', format: 'auto', line: UID_A }])
    const before = resolveInfoValue(withValue, stored[0], { defOf: registry.getDefinition })
    expect(before.state).not.toBe(INFO_VALUE_STATES.BROKEN)
    // the record survives a save → reload of the settings blob
    expect(infoValuesOf(mergeChartSettings(JSON.stringify(withValue)))).toEqual(stored)

    installLines(3, V3_FAST_READDED)
    const after = resolveInfoValue(withValue, stored[0], { defOf: registry.getDefinition })
    expect(after.state).toBe(INFO_VALUE_STATES.BROKEN)
    expect(after.guard).toBe(INFO_VALUE_GUARDS.OUTPUT_MISSING)
  })

  it('CONTROL — the same line edited keeps the value; a legacy entry binds by key', () => {
    const { cs, hostId } = chartWithMaOverFast()
    const withValue = addInfoValue(cs, { instanceId: hostId, plotKey: 'fast' }, registry.getDefinition)
    installLines(2, V2_FAST_EDITED)
    const ref = infoValuesOf(withValue)[0]
    expect(resolveInfoValue(withValue, ref, { defOf: registry.getDefinition }).state).not.toBe(INFO_VALUE_STATES.BROKEN)
    installLines(3, V3_FAST_READDED)
    const { line: _l, ...legacyRef } = ref
    expect(resolveInfoValue(withValue, legacyRef, { defOf: registry.getDefinition }).state).not.toBe(INFO_VALUE_STATES.BROKEN)
  })
})
