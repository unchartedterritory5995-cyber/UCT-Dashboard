// P1 truth matrix, slice "info" — AN INFO VALUE IS A REFERENCE, NOT A FORMULA.
//
// `header.infoValues` holds `{instanceId, plotKey, format}` references to outputs
// already installed on the chart (`engine/infoValues.js`). The value printed is the
// binder's own latest value for that binding (`engine/infoValueResolve.js`), gated
// by the shared `evaluability(…, 'info-value', …)` lane. Every case states ASKED /
// CLAIMED / DID and its outcome class.
import { describe, it, expect } from 'vitest'
import { parseFormula } from '../ast/parse'
import * as registry from '../nativeRegistry'
import { createBinder } from '../binder'
import { mergeChartSettings } from '../../chartDefaults'
import { outputTypeOf, OUTPUT_TYPES } from '../outputType'
import { legendChips, chipValueText } from '../readout'
import {
  addInfoValue, removeInfoValue, repairInfoValue, infoValuesOf, severInfoValuesTo, INFO_VALUES_KEY,
  severInfoValuesForInstanceSwap,
} from '../infoValues'
import {
  resolveInfoValue, resolveInfoValues, infoValueOutputExists, INFO_VALUE_STATES, INFO_VALUE_GUARDS,
} from '../infoValueResolve'
import { addInstance, removeInstance, setIndicatorEnabled } from '../instanceControls'
import { severReferencesTo } from '../sourceRef'
import { legacyInstanceId } from '../instances'
import { CHART_SCALAR_GUARD } from '../chartScalars'

const P = (src) => {
  const r = parseFormula(src)
  if (!r.ok) throw new Error(`${src}: ${JSON.stringify(r)}`)
  return r.ast
}
const userDef = (id, srcs) => {
  const trees = Object.fromEntries(Object.entries(srcs).map(([k, s]) => [k, P(s)]))
  const keys = Object.keys(trees)
  return { id, name: id, version: 1, meta: { name: id },
    plots: keys.map((k) => ({ key: k, style: 'line', legend: { decimals: 2 } })),
    compute: { kind: 'ast', fn: id, ast: trees[keys[0]], trees, scanPlot: keys[0] } }
}
const withDefs = (...defs) => {
  const byId = new Map(defs.map((d) => [d.id, d]))
  return (id) => byId.get(id) || registry.getDefinition(id)
}
const inst = (instanceId, defId, extra = {}) => ({ instanceId, defId, inputs: {}, hidden: false, ...extra })
const csWith = (instances, infoValues) => mergeChartSettings(JSON.stringify({
  settingsVersion: 2, indicatorInstances: instances, ...(infoValues ? { header: { infoValues } } : {}),
}))
const AST_TOKENS = /"(ast|trees|source|src|formula|bindings|compute|type|label|name)"/

const N = 80
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 100 + 0.1 * i + 6 * Math.sin(i / 5)
  return { t: 1600000000 + i * 86400, o: c - 0.3, h: c + 1, l: c - 1, c, v: 1e6 + i }
})

function harness() {
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
  return { chart, LWC }
}
function draw(cs, reg = registry) {
  const h = harness()
  const binder = createBinder({ chart: h.chart, LWC: h.LWC })
  binder.sync({ enabled: true, registry: reg, instances: cs.indicatorInstances, bars: BARS, cs, sym: 'NVDA', tf: 'D',
    secondary: new Map(), resolvePlacement: () => ({ paneIndex: 1, priceScaleId: 'right', key: 'p' }) })
  return binder
}
const envOf = (binder, reg = registry) => ({ registry: reg, bindings: binder.bindings(),
  columnErrorsOf: binder.columnErrorsOf, gateCtx: { tf: 'D', secondary: new Map() } })

describe('P1 info — 17: an Info Value references instance + output; it never copies an AST', () => {
  it('17a ASKED "show RSI\'s latest value in the header"; CLAIMED a reference; DID store exactly {instanceId, plotKey, format} — EXACT', () => {
    const cs0 = addInstance(mergeChartSettings('{}'), 'rsi', registry)
    const id = cs0.indicatorInstances.find((i) => i.defId === 'rsi').instanceId
    const cs1 = addInfoValue(cs0, { instanceId: id, plotKey: 'rsi' }, registry.getDefinition, infoValueOutputExists)
    expect(cs1).not.toBe(cs0)
    const stored = cs1.header[INFO_VALUES_KEY]
    expect(stored).toEqual([{ instanceId: id, plotKey: 'rsi', format: 'auto' }])
    expect(Object.keys(stored[0]).sort()).toEqual(['format', 'instanceId', 'plotKey'])
    expect(JSON.stringify(stored)).not.toMatch(AST_TOKENS)
    // ⛔ and NOTHING ELSE moved: the instance list and every other header key are the same objects.
    expect(cs1.indicatorInstances).toBe(cs0.indicatorInstances)
    for (const k of Object.keys(cs0.header)) expect(cs1.header[k]).toBe(cs0.header[k])
  })

  it('17b ASKED a forged entry carrying an ast/source/type/label; CLAIMED a formula home; DID strip it on read — REFUSAL', () => {
    const forged = { instanceId: 'inst:rsi:1', plotKey: 'rsi', format: 'auto', ast: P('close > 1'),
      source: 'close > 1', type: 'condition', label: 'RSI', bindings: { x: '@a::b' }, value: 42, compute: { kind: 'ast' } }
    const cs = csWith([inst('inst:rsi:1', 'rsi')], [forged])
    expect(cs.header.infoValues).toEqual([{ instanceId: 'inst:rsi:1', plotKey: 'rsi', format: 'auto' }])
    expect(JSON.stringify(cs.header.infoValues)).not.toMatch(AST_TOKENS)
    // the forged `type` cannot retype the output, and the forged `value` is never printed
    const r = resolveInfoValue(cs, cs.header.infoValues[0], envOf(draw(cs)))
    expect(r.type).toBe(OUTPUT_TYPES.SERIES)
    expect(r.value).not.toBe(42)
  })

  it('17c ASKED VALUE intent on a SERIES; CLAIMED nothing about its type; DID leave it SERIES (definition + instance untouched) — EXACT', () => {
    const def = userDef('u_info00000017', { value: 'sma(close, 5)' })
    const defOf = withDefs(def)
    const before = JSON.stringify(def)
    const cs0 = csWith([inst('i1', def.id)])
    const cs1 = addInfoValue(cs0, { instanceId: 'i1', plotKey: 'value' }, defOf, infoValueOutputExists)
    expect(JSON.stringify(def)).toBe(before)
    expect(cs1.indicatorInstances).toEqual(cs0.indicatorInstances)
    expect(outputTypeOf(def, 'value').type).toBe(OUTPUT_TYPES.SERIES)
    const reg = { ...registry, getDefinition: defOf }
    const r = resolveInfoValue(cs1, infoValuesOf(cs1)[0], envOf(draw(cs1, reg), reg))
    expect(r.state).toBe(INFO_VALUE_STATES.VALUE)
    expect(r.type).toBe(OUTPUT_TYPES.SERIES)
  })

  it('17d ASKED a CONDITION read as a value with format yesno; CLAIMED Yes/No; DID print Yes/No, type CONDITION — EXACT', () => {
    const def = userDef('u_info0000017d', { up: 'close > 0' })
    const reg = { ...registry, getDefinition: withDefs(def) }
    const cs = csWith([inst('c1', def.id)], [{ instanceId: 'c1', plotKey: 'up', format: 'yesno' }])
    const r = resolveInfoValue(cs, infoValuesOf(cs)[0], envOf(draw(cs, reg), reg))
    expect(r).toMatchObject({ state: INFO_VALUE_STATES.VALUE, type: OUTPUT_TYPES.CONDITION, value: 1, text: 'Yes' })
    // a format is not a type change: yesno on a SERIES falls back to the number
    const s = userDef('u_info0000017e', { v: 'close * 0 + 1' })
    const reg2 = { ...registry, getDefinition: withDefs(s) }
    const cs2 = csWith([inst('s1', s.id)], [{ instanceId: 's1', plotKey: 'v', format: 'yesno' }])
    const r2 = resolveInfoValue(cs2, infoValuesOf(cs2)[0], envOf(draw(cs2, reg2), reg2))
    expect(r2).toMatchObject({ type: OUTPUT_TYPES.SERIES, text: '1.00' })
  })

  it('17e ASKED to reference something that is not an installed output; CLAIMED a value; DID refuse the add (identity) — REFUSAL', () => {
    const cs = csWith([inst('i1', 'rsi')])
    const defOf = registry.getDefinition
    expect(addInfoValue(cs, { instanceId: 'nope', plotKey: 'rsi' }, defOf, infoValueOutputExists)).toBe(cs)
    expect(addInfoValue(cs, { instanceId: 'i1', plotKey: 'not-a-plot' }, defOf, infoValueOutputExists)).toBe(cs)
    expect(addInfoValue(cs, { instanceId: 'i1', plotKey: 'rsi', ast: P('close') }, defOf, infoValueOutputExists).header.infoValues)
      .toEqual([{ instanceId: 'i1', plotKey: 'rsi', format: 'auto' }])
  })
})

describe('P1 info — 18: deleting the referenced instance leaves a clean, visible broken reference', () => {
  const rsiId = legacyInstanceId('rsi')
  const seeded = () => {
    const cs0 = setIndicatorEnabled(mergeChartSettings('{}'), 'rsi', true, registry)
    return addInfoValue(cs0, { instanceId: rsiId, plotKey: 'rsi' }, registry.getDefinition, infoValueOutputExists)
  }

  it('18a ASKED delete RSI (legend ×); CLAIMED nothing about the header; DID sever the reference — kept, visible, broken — UNKNOWN→explicit', () => {
    const cs = seeded()
    const del = removeInstance(cs, rsiId, registry)
    expect(del.header.infoValues).toEqual([{ instanceId: rsiId, plotKey: 'rsi', format: 'auto', severed: true }])
    const r = resolveInfoValue(del, infoValuesOf(del)[0], envOf(draw(del)))
    expect(r).toMatchObject({ state: INFO_VALUE_STATES.BROKEN, guard: INFO_VALUE_GUARDS.DELETED, text: 'unavailable' })
    expect(r.value).toBeUndefined()
  })

  it('18b ASKED delete then RE-ADD RSI (same deterministic id `legacy:rsi`); CLAIMED a fresh RSI; DID keep the old value broken — never a silent reconnect', () => {
    const del = setIndicatorEnabled(seeded(), 'rsi', false, registry)
    expect(del.header.infoValues[0].severed).toBe(true)
    const back = setIndicatorEnabled(del, 'rsi', true, registry)
    expect(back.indicatorInstances.some((i) => i.instanceId === rsiId && !i.deleted)).toBe(true)
    const r = resolveInfoValue(back, infoValuesOf(back)[0], envOf(draw(back)))
    expect(r.state).toBe(INFO_VALUE_STATES.BROKEN)
    // ⭐ explicit repair is the only way back
    const fixed = repairInfoValue(back, { instanceId: rsiId, plotKey: 'rsi', severed: true },
      { instanceId: rsiId, plotKey: 'rsi' }, registry.getDefinition, infoValueOutputExists)
    expect(resolveInfoValue(fixed, infoValuesOf(fixed)[0], envOf(draw(fixed))).state).toBe(INFO_VALUE_STATES.VALUE)
    // and explicit removal returns the header to its legacy shape (key absent)
    const gone = removeInfoValue(back, { instanceId: rsiId, plotKey: 'rsi' })
    expect(INFO_VALUES_KEY in gone.header).toBe(false)
  })

  it('18c ASKED the instance vanished without a delete door (template/share/normalise); CLAIMED a value; DID broken instance-missing — never looked up by name', () => {
    // a different RSI with the SAME display name exists — it must not be adopted
    const cs = csWith([inst('inst:rsi:2', 'rsi')], [{ instanceId: 'inst:rsi:1', plotKey: 'rsi' }])
    const r = resolveInfoValue(cs, infoValuesOf(cs)[0], envOf(draw(cs)))
    expect(r).toMatchObject({ state: INFO_VALUE_STATES.BROKEN, guard: INFO_VALUE_GUARDS.INSTANCE_MISSING })
  })

  it('18d ASKED the plot was removed from the definition / the definition is not installed; DID broken output-missing / definition-missing', () => {
    const v1 = userDef('u_info0000018d', { a: 'close', b: 'open' })
    const v2 = userDef('u_info0000018d', { a: 'close' })
    const cs = csWith([inst('i1', v1.id)], [{ instanceId: 'i1', plotKey: 'b' }])
    const r = resolveInfoValue(cs, infoValuesOf(cs)[0], { defOf: withDefs(v2), bindings: [] })
    expect(r).toMatchObject({ state: INFO_VALUE_STATES.BROKEN, guard: INFO_VALUE_GUARDS.OUTPUT_MISSING })
    const r2 = resolveInfoValue(cs, infoValuesOf(cs)[0], { defOf: () => null, bindings: [] })
    expect(r2).toMatchObject({ state: INFO_VALUE_STATES.BROKEN, guard: INFO_VALUE_GUARDS.DEFINITION_MISSING })
  })

  it('18e ASKED delete one of TWO RSIs / delete something else; DID sever only the referenced one; identity when nothing pointed at it', () => {
    const cs = csWith([inst('inst:rsi:1', 'rsi'), inst('inst:rsi:2', 'rsi'), inst('inst:macd:1', 'macd')],
      [{ instanceId: 'inst:rsi:1', plotKey: 'rsi' }, { instanceId: 'inst:rsi:2', plotKey: 'rsi' }])
    const del = removeInstance(cs, 'inst:rsi:2', registry)
    expect(del.header.infoValues.map((v) => !!v.severed)).toEqual([false, true])
    const other = removeInstance(cs, 'inst:macd:1', registry)
    expect(other.header).toBe(cs.header)
    // the generic sever door agrees
    const sv = severReferencesTo(cs, 'inst:rsi:1', registry.getDefinition)
    expect(sv.header.infoValues.map((v) => !!v.severed)).toEqual([true, false])
    expect(severInfoValuesTo(cs, 'nobody')).toBe(cs)
  })
})

describe('P1 info — 19 (part): the chart and the info value read ONE computation', () => {
  it('19a ASKED RSI drawn on the chart AND shown in the header; CLAIMED one number; DID identical latest value + text, from the binder — EXACT', () => {
    const cs = csWith([inst('inst:rsi:1', 'rsi', { inputs: { period: 14 } })], [{ instanceId: 'inst:rsi:1', plotKey: 'rsi' }])
    const binder = draw(cs)
    const binding = binder.bindings().find((b) => b.instanceId === 'inst:rsi:1' && b.plotKey === 'rsi')
    expect(binding).toBeTruthy()
    const col = registry.computeFor(registry.getDefinition('rsi'), BARS, { period: 14 }, {}).rsi
    expect(binding.lastValue).toBe(col[col.length - 1])
    const r = resolveInfoValue(cs, infoValuesOf(cs)[0], envOf(binder))
    expect(r.state).toBe(INFO_VALUE_STATES.VALUE)
    expect(r.value).toBe(binding.lastValue)
    const chip = legendChips(binder.bindings(), null, registry, cs.indicatorInstances)
      .find((c) => c.instanceId === 'inst:rsi:1' && c.plotKey === 'rsi')
    expect(r.text).toBe(chipValueText(chip))
  })

  it('19b ASKED the newest bar is UNKNOWN; CLAIMED a latest value; DID print — (never a stale earlier value, never 0) — UNKNOWN', () => {
    const cs = csWith([inst('inst:rsi:1', 'rsi')], [{ instanceId: 'inst:rsi:1', plotKey: 'rsi' }])
    const fake = [{ instanceId: 'inst:rsi:1', plotKey: 'rsi', defId: 'rsi', series: {}, lastValue: undefined, prevValue: 55 }]
    const r = resolveInfoValue(cs, infoValuesOf(cs)[0], { registry, bindings: fake })
    expect(r).toMatchObject({ state: INFO_VALUE_STATES.UNKNOWN, text: '—' })
    expect(r.value).toBeUndefined()
  })

  it('19c ASKED a current-only scalar / an ltf formula as an info value; CLAIMED a latest value; DID the gate\'s refusal, no number — REFUSAL', () => {
    const sc = userDef('u_info0000019c', { v: 'market_cap > 1e9' })
    const lt = userDef('u_info0000019d', { v: "ltf(close, '60')" })
    for (const [def, guard] of [[sc, CHART_SCALAR_GUARD], [lt, 'lower-tf:formula-unsupported']]) {
      const reg = { ...registry, getDefinition: withDefs(def) }
      const cs = csWith([inst('x1', def.id)], [{ instanceId: 'x1', plotKey: 'v' }])
      const r = resolveInfoValue(cs, infoValuesOf(cs)[0], envOf(draw(cs, reg), reg))
      expect(r).toMatchObject({ state: INFO_VALUE_STATES.REFUSED, guard, text: 'n/a' })
      expect(r.reason).toBeTruthy()
      expect(r.value).toBeUndefined()
    }
  })

  it('19d hidden instance → unavailable (not computed), not a stale number; resolveInfoValues keeps stored order', () => {
    const cs = csWith([inst('inst:rsi:1', 'rsi', { hidden: true }), inst('inst:rsi:2', 'rsi')],
      [{ instanceId: 'inst:rsi:2', plotKey: 'rsi' }, { instanceId: 'inst:rsi:1', plotKey: 'rsi' }])
    const rows = resolveInfoValues(cs, envOf(draw(cs)))
    expect(rows.map((r) => r.instanceId)).toEqual(['inst:rsi:2', 'inst:rsi:1'])
    expect(rows[0].state).toBe(INFO_VALUE_STATES.VALUE)
    expect(rows[1]).toMatchObject({ state: INFO_VALUE_STATES.UNAVAILABLE, guard: INFO_VALUE_GUARDS.HIDDEN })
  })
})

describe('P1 info — 18f: a share link swaps in the SENDER’s instances under the recipient’s header', () => {
  const recipient = () => csWith([inst('inst:rsi:1', 'rsi', { inputs: { period: 14 } })],
    [{ instanceId: 'inst:rsi:1', plotKey: 'rsi' }])
  const sender = [inst('inst:rsi:1', 'rsi', { inputs: { period: 2 } })]
  const apply = (cs, swapped) => ({ ...cs, indicatorInstances: swapped })   // the ?state= apply shape

  it('BEFORE (no sever): the recipient’s value would silently read the sender’s RSI(2) — the silent-wrong case', () => {
    const naive = apply(recipient(), sender)
    const r = resolveInfoValue(naive, infoValuesOf(naive)[0], envOf(draw(naive)))
    const mine = registry.computeFor(registry.getDefinition('rsi'), BARS, { period: 14 }, {}).rsi
    expect(r.state).toBe(INFO_VALUE_STATES.VALUE)
    expect(r.value).not.toBe(mine[mine.length - 1])   // a DIFFERENT instance's number
  })

  it('AFTER: ASKED open a shared chart; CLAIMED my header value; DID severed → visible unavailable, never the sender’s number', () => {
    const cs = recipient()
    const next = apply(severInfoValuesForInstanceSwap(cs, sender), sender)
    expect(next.header.infoValues).toEqual([{ instanceId: 'inst:rsi:1', plotKey: 'rsi', format: 'auto', severed: true }])
    const r = resolveInfoValue(next, infoValuesOf(next)[0], envOf(draw(next)))
    expect(r).toMatchObject({ state: INFO_VALUE_STATES.BROKEN, guard: INFO_VALUE_GUARDS.DELETED })
    expect(r.value).toBeUndefined()
  })

  it('a provably identical instance (same id, defId, version, inputs) keeps its value; no info values → identity', () => {
    const cs = recipient()
    const same = [inst('inst:rsi:1', 'rsi', { inputs: { period: 14 } })]
    expect(severInfoValuesForInstanceSwap(cs, same)).toBe(cs)
    const absent = severInfoValuesForInstanceSwap(cs, [])
    expect(absent.header.infoValues[0].severed).toBe(true)
    const plain = csWith([inst('inst:rsi:1', 'rsi')])
    expect(severInfoValuesForInstanceSwap(plain, sender)).toBe(plain)
  })
})
