import { describe, it, expect } from 'vitest'
import { alertPayloadFor, alertAddress, alertsForCondition } from '../conditionAlerts'
import { signalPlotKey } from '../definitionSignal'
import { LOCAL_ONLY, SOURCE_UNAVAILABLE } from '../conditionCapability'

const DEF_ID = 'u_275dadc9fafe'
const def = (over = {}) => ({ id: DEF_ID, compute: { kind: 'ast' }, ...over })

const durable = { id: 'cond:1', name: 'Above 50', definitionId: DEF_ID, enabled: true, actions: [] }
const local = { id: 'cond:2', name: 'Follows RSI', formula: 'a > 50', bindings: { a: '@legacy:rsi::rsi' }, enabled: true }

const base = { sym: 'tsla', tf: 'D', definition: def(), hasDefinition: () => true }

describe('the address', () => {
  it('⭐ a single-plot definition addresses `value`', () => {
    expect(signalPlotKey(def())).toBe('value')
    expect(alertAddress(def())).toBe(`${DEF_ID}.value`)
  })

  it('⭐⭐ a MULTI-PLOT definition addresses its SCAN plot, not plot 1', () => {
    // The screener filters on `scanPlot`. An alert that named plot 1 instead
    // would fire on a different column than the scan the member built it from.
    const d = def({
      compute: { kind: 'ast', scanPlot: 'signal' },
      plots: [{ key: 'value', role: 'primary' }, { key: 'signal', role: 'secondary' }],
    })
    expect(signalPlotKey(d)).toBe('signal')
    expect(alertAddress(d)).toBe(`${DEF_ID}.signal`)
  })

  it('⛔ a GUIDE plot is never the address — it draws lines and has no column', () => {
    const d = def({ plots: [{ key: '_levels', role: 'guide' }, { key: 'value', role: 'primary' }] })
    expect(signalPlotKey(d)).toBe('value')
  })

  it('⛔⛔ a malformed id yields NULL rather than a well-formed-looking address', () => {
    // `alert_user_series.USER_ADDRESS_RE` is `u_<12 hex>.<plotKey>`. Anything else
    // is stored happily by nothing and resolved by nothing.
    expect(alertAddress(def({ id: 'draft_1' }))).toBe(null)
    expect(alertAddress(def({ id: 'u_ABC' }))).toBe(null)
    expect(alertAddress(null)).toBe(null)
  })

  it('⭐ the server’s own field name is accepted too — rows come back as `def_id`', () => {
    expect(alertAddress({ def_id: DEF_ID })).toBe(`${DEF_ID}.value`)
  })
})

describe('the payload', () => {
  it('⭐⭐ a durable condition compiles to the four fields the endpoint takes', () => {
    const res = alertPayloadFor(durable, base)
    expect(res.ok).toBe(true)
    expect(res.payload).toEqual({
      sym: 'TSLA',                       // upper-cased, as the endpoint expects
      indicator: `${DEF_ID}.value`,
      condition: 'cross_above',
      threshold: 0.5,
      tf: 'D',
    })
    expect(res.policy.id).toBe('becomes_true')
  })

  it('⛔ `scope` is OMITTED when there is no chart to scope to, never sent as null', () => {
    expect('scope' in alertPayloadFor(durable, base).payload).toBe(false)
    expect(alertPayloadFor(durable, { ...base, chartId: 'w:3' }).payload.scope).toBe('w:3')
  })

  it('⛔⛔ a LOCAL condition is refused BEFORE any request, in the member’s words', () => {
    const res = alertPayloadFor(local, base)
    expect(res.ok).toBe(false)
    expect(res.capability).toBe(LOCAL_ONLY)
    expect(res.reason).toMatch(/follows an indicator on this chart/)
  })

  it('⛔ a condition whose definition is gone is refused with THAT sentence', () => {
    const res = alertPayloadFor(durable, { ...base, hasDefinition: () => false })
    expect(res.ok).toBe(false)
    expect(res.capability).toBe(SOURCE_UNAVAILABLE)
    expect(res.reason).toMatch(/no longer available/)
  })

  it('⛔⛔ a definition that is not THIS condition’s is refused', () => {
    // The one failure nothing downstream could detect: a valid alert on the
    // wrong formula, armed under the right condition's name.
    const res = alertPayloadFor(durable, { ...base, definition: def({ id: 'u_aaaaaaaaaaaa' }) })
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/does not belong to this condition/)
  })

  it('⛔ an unknown policy refuses rather than falling back to the default', () => {
    const res = alertPayloadFor(durable, { ...base, policyId: 'while_true' })
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/while_true/)
  })

  it('⭐ becomes_false compiles through the same door', () => {
    const res = alertPayloadFor(durable, { ...base, policyId: 'becomes_false' })
    expect(res.payload.condition).toBe('cross_below')
    expect(res.payload.threshold).toBe(0.5)
  })

  it('⛔ a missing symbol or timeframe is a refusal, not an alert on ""', () => {
    expect(alertPayloadFor(durable, { ...base, sym: '' }).reason).toMatch(/symbol/)
    expect(alertPayloadFor(durable, { ...base, tf: '' }).reason).toMatch(/timeframe/)
  })

  it('⛔ a definition that cannot produce an address never reaches the network', () => {
    const res = alertPayloadFor(durable, { ...base, definition: def({ id: 'draft_1' }) })
    expect(res.ok).toBe(false)
  })
})

describe('is this condition already armed?', () => {
  const rows = [
    { id: 1, sym: 'TSLA', indicator: `${DEF_ID}.value`, condition: 'cross_above', threshold: 0.5 },
    { id: 2, sym: 'AAPL', indicator: `${DEF_ID}.value`, condition: 'cross_above', threshold: 0.5 },
    { id: 3, sym: 'TSLA', indicator: 'rsi.value', condition: 'above', threshold: 70 },
  ]

  it('⭐ it finds an alert created anywhere, because it matches on the ADDRESS', () => {
    expect(alertsForCondition(rows, durable, { definition: def(), sym: 'TSLA' }).map((a) => a.id)).toEqual([1])
  })

  it('⭐ without a symbol it finds every symbol’s', () => {
    expect(alertsForCondition(rows, durable, { definition: def() }).map((a) => a.id)).toEqual([1, 2])
  })

  it('⛔ a LOCAL condition has none, by construction', () => {
    expect(alertsForCondition(rows, local, { definition: def(), sym: 'TSLA' })).toEqual([])
  })

  it('⛔ a mismatched definition finds none rather than the other one’s', () => {
    expect(alertsForCondition(rows, durable, { definition: def({ id: 'u_aaaaaaaaaaaa' }) })).toEqual([])
  })

  it('⛔ it survives every shape a listing can arrive in', () => {
    expect(alertsForCondition(null, durable, { definition: def() })).toEqual([])
    expect(alertsForCondition(rows, durable, {})).toEqual([])
    expect(alertsForCondition(rows, durable)).toEqual([])
  })
})
