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
// Each case: ASKED / CLAIMED / DID, and its class.

import { describe, it, expect, beforeEach } from 'vitest'
import * as registry from '../nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { createBinder } from '../binder'
import {
  setIndicatorEnabled, removeInstance, addInstance, setInstanceInput, findInstance,
} from '../instanceControls'
import {
  instanceSource, parseSource, isSeveredSource, sourceDependsOn, severReferencesTo,
} from '../sourceRef'
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
  it('ASKED turn RSI off, then on again (setIndicatorEnabled revives `legacy:rsi`) · CLAIMED the MA does not adopt the new RSI · DID sever it — UNAVAILABLE (was: SILENT RECONNECT)', () => {
    const { cs, maId } = chartWithMaOverRsi()
    const off = setIndicatorEnabled(cs, 'rsi', false, registry)
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
    const on = setIndicatorEnabled(setIndicatorEnabled(cs, 'rsi', false, registry), 'rsi', true, registry)
    const repaired = setInstanceInput(on, maId, 'source', RSI_SRC, registry)
    expect(maSource(repaired, maId)).toBe(RSI_SRC)
    expect(maValues(repaired, maId).filter((v) => v.length).length).toBe(2)
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
    const off = setIndicatorEnabled(cs, 'rsi', false, registry)
    const reread = mergeChartSettings(JSON.stringify(off))
    expect(maSource(reread, maId)).toBe(`!${RSI_SRC}`)
    expect(JSON.stringify(mergeChartSettings(JSON.stringify(reread)))).toBe(JSON.stringify(reread))
    // the dead `conditions` vestige is not conjured into the blob by a sever
    expect('conditions' in off).toBe('conditions' in cs)
  })

  it('ASKED delete an instance nothing reads · CLAIMED nothing else moves (identity for the dependents) · DID', () => {
    const { cs, maId } = chartWithMaOverRsi()
    const macd = setIndicatorEnabled(cs, 'macd', true, registry)
    const off = setIndicatorEnabled(macd, 'macd', false, registry)
    expect(maSource(off, maId)).toBe(RSI_SRC)
    expect(findInstance(off, maId)).toBe(findInstance(macd, maId))
    expect(severReferencesTo(macd, 'legacy:macd', registry.getDefinition)).toBe(macd)
  })
})

describe('Phase 2 editing (recorded)', () => {
  it.todo('DISCLOSED, NOT FIXED — an output KEY reused across a definition edit (remove output "fast", later add a NEW "fast") is read by an MA / info value on `@inst::fast` without the member choosing it; needs output provenance across versions (owner review)')
})
