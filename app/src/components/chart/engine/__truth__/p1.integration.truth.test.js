// P1 INTEGRATION TRUTH — ONE DEFINITION → TYPED OUTPUTS → MULTIPLE SAFE CONSUMERS.
//
// The integrated proof (truth item 19, all consumers together; the slices proved
// each half). ONE user definition with two outputs:
//   rsi  = rsi(close, 14)        → SERIES
//   hot  = rsi(close, 14) > 60   → CONDITION
// is installed ONCE, then read by: the chart (binder), an Info Value (header
// reference), the signal gate + a trigger-policy alert request, and the marker
// presentation — and every consumer's number comes from the SAME stored trees.
// Nothing is copied: the Info Value and the alert request carry addresses only.

import { describe, it, expect, afterAll } from 'vitest'
import { parseFormula, astHash } from '../ast/parse'
import { treesHash } from '../ast/trees'
import * as registry from '../nativeRegistry'
import { createBinder } from '../binder'
import { mergeChartSettings } from '../../chartDefaults'
import { outputTypeOf, OUTPUT_TYPES } from '../outputType'
import { evaluability, LANES, STATUS, GATE_GUARDS } from '../evaluability'
import { infoValuesOf, INFO_VALUES_KEY } from '../infoValues'
import { resolveInfoValue, INFO_VALUE_STATES } from '../infoValueResolve'
import { signalAlertRequest, compileTriggerPolicy, TRIGGER_POLICIES } from '../triggerPolicy'
import { requestInfoValue, infoValueRefFor } from '../../builder/infoValueDoor'

const P = (src) => {
  const r = parseFormula(src)
  if (!r.ok) throw new Error(`${src}: ${JSON.stringify(r)}`)
  return r.ast
}

const DEF_ID = 'u_1a7e9a7e0001'
const trees = { rsi: P('rsi(close, 14)'), hot: P('rsi(close, 14) > 60') }
const DOC = {
  schemaVersion: 1, id: DEF_ID, version: 1,
  meta: { name: 'RSI hot', shortName: 'RSI hot', category: 'Custom', tier: 'premium',
    repaint: 'non-repainting', freshness: 'live', semantics: 2 },
  placement: { target: 'pane', pane: { height: 0.15 } },
  plots: [
    { key: 'rsi', label: 'RSI', style: 'line', color: '#fff' },
    { key: 'hot', label: 'Hot', style: 'markers', color: '#f5c518', marker: { shape: 'circle', position: 'belowBar' } },
  ],
  compute: { kind: 'ast', fn: astHash(trees.hot), rev: 1, ast: trees.hot, trees, treesHash: treesHash(trees),
    source: 'rsi(close, 14) > 60', sources: { rsi: 'rsi(close, 14)', hot: 'rsi(close, 14) > 60' }, scanPlot: 'hot' },
}

const N = 120
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 100 + 0.15 * i + 7 * Math.sin(i / 4)
  return { t: 1600000000 + i * 86400, o: c - 0.3, h: c + 1, l: c - 1, c, v: 1e6 + i }
})

function draw(cs) {
  const chart = {
    addSeries: (ctor, options, paneIndex) => {
      const series = { __data: [], ctor, options, paneIndex,
        setData: (d) => { series.__data = d }, update: () => {}, applyOptions: (o) => Object.assign(options, o),
        priceScale: () => ({ applyOptions: () => {} }), createPriceLine: () => ({}), removePriceLine: () => {},
        setMarkers: () => {} }
      return series
    },
    removeSeries: () => {},
    panes: () => [{ paneIndex: () => 0, setHeight: () => {}, getHeight: () => 100 }],
    priceScale: () => ({ applyOptions: () => {} }),
  }
  const LWC = { LineSeries: 'LineSeries', HistogramSeries: 'HistogramSeries', AreaSeries: 'AreaSeries',
    BaselineSeries: 'BaselineSeries', CandlestickSeries: 'CandlestickSeries' }
  const binder = createBinder({ chart, LWC })
  binder.sync({ enabled: true, registry, instances: cs.indicatorInstances, bars: BARS, cs, sym: 'NVDA', tf: 'D',
    secondary: new Map(), resolvePlacement: () => ({ paneIndex: 1, priceScaleId: 'right', key: 'p' }) })
  return binder
}

describe('P1 integration — one definition, many consumers, no drift', () => {
  const { installed, errors } = registry.installUserDefinitions([DOC])
  afterAll(() => registry.clearUserDefinitions())

  it('installs once and each output is typed independently (SERIES + CONDITION)', () => {
    expect(errors || []).toEqual([])
    expect(installed.map((d) => d.id)).toEqual([DEF_ID])
    const def = registry.getDefinition(DEF_ID)
    expect(outputTypeOf(def, 'rsi').type).toBe(OUTPUT_TYPES.SERIES)
    expect(outputTypeOf(def, 'hot').type).toBe(OUTPUT_TYPES.CONDITION)
  })

  it('chart + Info Value + signal/alert + marker all read the SAME stored trees', () => {
    const def = registry.getDefinition(DEF_ID)
    const base = mergeChartSettings(JSON.stringify({
      settingsVersion: 2,
      indicatorInstances: [{ instanceId: `${DEF_ID}:1`, defId: DEF_ID, inputs: {}, hidden: false }],
    }))
    // VALUE consumer — through the Builder's own door into the info slice
    const req = requestInfoValue(base, infoValueRefFor({ instanceId: `${DEF_ID}:1`, plotKey: 'rsi' }))
    expect(req.added).toBe(true)
    const cs = req.settings
    expect(JSON.stringify(cs.header[INFO_VALUES_KEY])).not.toMatch(/"(ast|trees|source)"|rsi\(/)

    // CHART consumer
    const binder = draw(cs)
    const rsiB = binder.bindings().find((b) => b.instanceId === `${DEF_ID}:1` && b.plotKey === 'rsi')
    expect(rsiB).toBeTruthy()
    const cols = registry.computeFor(def, BARS, {}, {})
    expect(rsiB.lastValue).toBe(cols.rsi[N - 1])

    // INFO VALUE reads the chart's own value — no second computation
    const iv = resolveInfoValue(cs, infoValuesOf(cs)[0], {
      registry, bindings: binder.bindings(), columnErrorsOf: binder.columnErrorsOf,
      gateCtx: { tf: 'D', secondary: new Map() },
    })
    expect(iv.state).toBe(INFO_VALUE_STATES.VALUE)
    expect(iv.value).toBe(rsiB.lastValue)

    // NO DRIFT: the CONDITION column is exactly the comparison of the SERIES column
    let known = 0
    for (let i = 0; i < N; i++) {
      const r = cols.rsi[i]
      if (Number.isFinite(r)) { known++; expect(cols.hot[i]).toBe(r > 60 ? 1 : 0) } else {
        expect(Number.isFinite(cols.hot[i])).toBe(false) // semantics 2: unknown stays unknown
      }
    }
    expect(known).toBeGreaterThan(50)

    // SIGNAL + ALERT consumer — the gate approves the CONDITION, refuses the SERIES
    const ok = signalAlertRequest({ def, key: 'hot', policy: TRIGGER_POLICIES.BECOMES_TRUE, sym: 'nvda', tf: 'D', ctx: { tf: 'D' } })
    expect(ok.ok).toBe(true)
    expect(ok.payload).toEqual({ sym: 'NVDA', indicator: `${DEF_ID}.hot`, trigger_policy: 'becomes_true',
      ...compileTriggerPolicy(TRIGGER_POLICIES.BECOMES_TRUE), tf: 'D' })
    expect(JSON.stringify(ok.payload)).not.toMatch(/rsi\(|"ast"|"source"/)
    const bad = signalAlertRequest({ def, key: 'rsi', policy: TRIGGER_POLICIES.BECOMES_TRUE, sym: 'NVDA', tf: 'D', ctx: { tf: 'D' } })
    expect(bad.ok).toBe(false)
    expect(bad.gate.guard).toBe(GATE_GUARDS.SIGNAL_NUMERIC)

    // MARKER presentation of the CONDITION is a supported chart-marker lane use
    expect(evaluability(def, 'hot', LANES.CHART_MARKER, { tf: 'D' }).status).not.toBe(STATUS.REFUSED)
  })
})
