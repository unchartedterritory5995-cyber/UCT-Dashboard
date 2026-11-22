// app/src/agent/capabilities/indicatorDotSize.test.js — UCT RS Phase 2a, unit 2a-12b
//
// The chart agent learns Indicators' `setDotSize` (unit 2a-12, agentMutations.js I-15): the `dotSize`
// property of indicatorStyle.set builds the request from `styleOptionsOf(...).dotSize` (never an invented
// word), the receipt line says what changed in operator voice ("Default" for medium, the plotKey only when
// one dot output was sized), Undo is worded like its style siblings, and an Indicators refusal reads as a
// change that was not made. Real registry, real settings, no mocks.
import { describe, it, expect, beforeEach } from 'vitest'
import * as registry from '../../components/chart/engine/nativeRegistry'
import { mergeChartSettings } from '../../components/chart/chartDefaults'
import { withInstances } from '../../components/chart/engine/instanceControls'
import { adoptOverlayAverages } from '../../components/chart/maAdoption'
import { REASONS, styleOptionsOf } from '../../components/chart/builder/agentMutations'
import { styleRequest, checkBuilt, registerIndicatorControlCapabilities } from './indicatorControls'
import { receiptLine, extReceiptLine, refusalSentence, dotSizeWord, indicatorRowsOf, setOwnedDefinitionSource, _resetProposedPlans } from './indicatorEdits'
import { getCapability } from '../capabilities'

const view = (cs) => adoptOverlayAverages(cs) || cs
const load = (cs) => view(mergeChartSettings(JSON.stringify(cs)))
/** Parabolic SAR (one `markers` output → the Dot size control exists) beside RSI (no dots). */
function chart() {
  const base = mergeChartSettings(null)
  const raw = load({
    ...base,
    indicatorInstances: [
      ...(base.indicatorInstances || []),
      { instanceId: 'inst:sar:1', defId: 'sar', inputs: {}, hidden: false },
      { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 14 }, hidden: false },
    ],
    indicators: { ...(base.indicators || {}), rsi: { enabled: true } },
  })
  return load(withInstances(raw, raw.indicatorInstances, registry))
}
const CHART = 'Left chart (QQQ)'
const stateOf = (cs = chart()) => ({ chart: CHART, chartRef: 'c1', cs, canManage: true, rows: indicatorRowsOf(cs), change: null })
const ask = (st, over) => styleRequest(st, { instance: 'inst:sar:1', property: 'dotSize', value: 'large', output: null, ...over })

beforeEach(() => { setOwnedDefinitionSource(() => []); _resetProposedPlans() })

describe('indicatorStyle.set dotSize — the request (2a-12b)', () => {
  it('the fixture is what the unit relies on: SAR offers a dot size, RSI does not', () => {
    const cs = chart()
    expect(styleOptionsOf(cs, registry, 'inst:sar:1').dotSize).toMatchObject({ current: 'medium', options: ['small', 'medium', 'large'], plots: [{ plotKey: 'sar' }] })
    expect(styleOptionsOf(cs, registry, 'inst:rsi:1').dotSize).toBeNull()
  })

  it('"large" → setDotSize at the instance level (no plotKey), with the indicator\'s name for the receipt', () => {
    const b = ask(stateOf())
    expect(b.why).toBeUndefined()
    expect(b.req).toEqual({ op: 'setDotSize', instanceId: 'inst:sar:1', size: 'large' })
    expect(typeof b.name).toBe('string')
    expect(b.name.length).toBeGreaterThan(0)
  })

  it('the member\'s words map to the store\'s three: "default" = medium, "big" = large, "tiny" = small; case and spaces ignored', () => {
    const st = stateOf()
    expect(ask(st, { value: 'default' }).req.size).toBe('medium')
    expect(ask(st, { value: 'Big' }).req.size).toBe('large')
    expect(ask(st, { value: ' tiny ' }).req.size).toBe('small')
    expect(ask(st, { value: 'Medium' }).req.size).toBe('medium')
  })

  it('output names ONE dot output (by label or key) → plotKey rides along; an output with no dots is refused with the real ones named', () => {
    const st = stateOf()
    expect(ask(st, { output: 'SAR', value: 'small' }).req).toEqual({ op: 'setDotSize', instanceId: 'inst:sar:1', size: 'small', plotKey: 'sar' })
    expect(ask(st, { output: 'sar' }).req.plotKey).toBe('sar')
    const bad = ask(st, { output: 'signal' })
    expect(bad.req).toBeUndefined()
    expect(bad.why).toMatch(/draws no dots on “signal”/)
    expect(bad.why).toMatch(/SAR/)
  })

  it('an unknown word is refused and the options are named — nothing is invented beyond what styleOptionsOf offers', () => {
    const bad = ask(stateOf(), { value: 'enormous' })
    expect(bad.req).toBeUndefined()
    expect(bad.why).toMatch(/“enormous” isn't a dot size I know/)
    expect(bad.why).toMatch(/small, Default \(medium\), large/)
  })

  it('an indicator that draws no dots (styleOptionsOf reports dotSize: null) is refused: "this indicator draws no dots"', () => {
    const bad = ask(stateOf(), { instance: 'inst:rsi:1' })
    expect(bad.req).toBeUndefined()
    expect(bad.why).toMatch(/this indicator draws no dots/)
    expect(bad.why).toMatch(/RSI/)
  })

  it('an unknown instance is refused through the shared target refusal', () => {
    const bad = ask(stateOf(), { instance: 'inst:nope:1' })
    expect(bad.req).toBeUndefined()
    expect(typeof bad.why).toBe('string')
  })

  it('checkBuilt: a real change plans clean (null); "medium" on a default-sized SAR is a no-op (null, not a refusal); a refusal carries its why', () => {
    const st = stateOf()
    expect(checkBuilt(st, ask(st))).toBeNull()
    expect(checkBuilt(st, ask(st, { value: 'medium' }))).toBeNull()
    expect(checkBuilt(st, ask(st, { instance: 'inst:rsi:1' }))).toMatch(/this indicator draws no dots/)
    expect(checkBuilt({ ...st, canManage: false }, ask(st))).toMatch(/can't be changed from here/)
  })

  it('"make sar dots large" is an instant phrase of indicatorStyle.set; a non-indicator subject reaches the model', () => {
    registerIndicatorControlCapabilities()
    const cap = getCapability('indicatorStyle.set')
    expect(cap).toBeTruthy()
    expect(cap.args.properties.property.enum).toContain('dotSize')
    expect(cap.fast({ lower: 'make sar dots large' })).toEqual({ instance: 'sar', property: 'dotSize', value: 'large', output: null })
    expect(cap.fast({ lower: "make sar's dots tiny" })).toEqual({ instance: 'sar', property: 'dotSize', value: 'tiny', output: null })
    expect(cap.fast({ lower: 'make the chart dots large' })).toBeNull()
  })
})

describe('setDotSize — receipt, Undo and refusal wording (2a-12b)', () => {
  const NAME = 'Parabolic SAR'
  const where = ` on ${CHART}`

  it('the receipt line without a plotKey: "medium" is said as Default, the way the Dot size control labels it', () => {
    expect(extReceiptLine({ op: 'setDotSize', change: { what: 'dotSize', before: 'medium', after: 'large' } }, NAME, where))
      .toBe('Changed Parabolic SAR\'s dot size on Left chart (QQQ) — Default → large.')
    expect(receiptLine({ op: 'setDotSize', name: NAME, change: { what: 'dotSize', before: 'large', after: 'medium' } }, CHART))
      .toBe('Changed Parabolic SAR\'s dot size on Left chart (QQQ) — large → Default.')
  })

  it('the receipt line with a plotKey names the one dot output that was sized', () => {
    expect(extReceiptLine({ op: 'setDotSize', change: { what: 'dotSize', plotKey: 'sar', before: 'medium', after: 'small' } }, NAME, where))
      .toBe('Changed Parabolic SAR\'s dot size (sar) on Left chart (QQQ) — Default → small.')
    expect(extReceiptLine({ op: 'setDotSize', change: { what: 'dotSize', before: 'small', after: 'large' } }, NAME, ''))
      .toBe('Changed Parabolic SAR\'s dot size — small → large.')
  })

  it('no emoji in the member-facing lines', () => {
    const lines = [
      extReceiptLine({ op: 'setDotSize', change: { what: 'dotSize', plotKey: 'sar', before: 'medium', after: 'small' } }, NAME, where),
      receiptLine({ op: 'undo', undoOf: 'setDotSize', name: NAME }, CHART),
    ]
    for (const l of lines) expect(l).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
  })

  it('Undo of a dot size is worded like its style siblings: "Put <name> on <chart> back as it was."', () => {
    expect(receiptLine({ op: 'undo', undoOf: 'setDotSize', name: NAME }, CHART)).toBe('Put Parabolic SAR on Left chart (QQQ) back as it was.')
    expect(receiptLine({ op: 'undo', undoOf: 'setDisplayTarget', name: NAME }, CHART)).toBe('Put Parabolic SAR on Left chart (QQQ) back as it was.')
  })

  it('an Indicators bad-input refusal of setDotSize reads as a change NOT made, with the op\'s own options', () => {
    const line = refusalSentence({ ok: false, reason: REASONS.BAD_INPUT, detail: { value: 'enormous', why: 'a dot size is small, medium, large', options: ['small', 'medium', 'large'] } }, { chart: CHART, op: 'setDotSize' })
    expect(line).toBe('I didn\'t change it: a dot size is small, medium, large. It can be small, medium, large. Nothing was changed.')
    const none = refusalSentence({ ok: false, reason: REASONS.BAD_INPUT, detail: { why: 'RSI draws no dots to size', options: [] } }, { chart: CHART, op: 'setDotSize' })
    expect(none).toBe('I didn\'t change it: RSI draws no dots to size. Nothing was changed.')
  })

  it('dotSizeWord: medium → Default, the other two as said', () => {
    expect(dotSizeWord('medium')).toBe('Default')
    expect(dotSizeWord('small')).toBe('small')
    expect(dotSizeWord('large')).toBe('large')
  })
})
