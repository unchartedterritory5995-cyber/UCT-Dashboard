import { describe, it, expect } from 'vitest'
import {
  conditionCapability, isAlertable, boundInstances,
  LOCAL_ONLY, PROMOTABLE, DURABLE, SOURCE_UNAVAILABLE, INVALID,
} from '../conditionCapability'
import { normaliseConditions } from '../conditions'

const cond = (over) => ({ id: 'cond:1', name: 'C', formula: '', bindings: {}, actions: [], definitionId: null, ...over })

describe('condition capability — two legitimate kinds, never silently converted', () => {
  it('⭐ a self-contained inline formula is PROMOTABLE', () => {
    const c = cond({ formula: 'close > ema(close, 20)' })
    expect(conditionCapability(c).capability).toBe(PROMOTABLE)
  })

  it('⛔ a formula that follows a CHART INSTANCE is LOCAL_ONLY — and says why in the member’s terms', () => {
    const c = cond({ formula: 'a > 50', bindings: { a: '@legacy:rsi::rsi' } })
    const r = conditionCapability(c)
    expect(r.capability).toBe(LOCAL_ONLY)
    expect(r.reason).toMatch(/follows an indicator on this chart/)
    expect(r.reason).toMatch(/when the chart is closed/)
    // ⛔ never the mechanism
    expect(r.reason).not.toMatch(/instanceId|binding/i)
    expect(r.boundTo).toEqual(['legacy:rsi'])
  })

  it('⭐ a definition-backed condition is DURABLE', () => {
    const c = cond({ definitionId: 'u_abc' })
    expect(conditionCapability(c, { hasDefinition: () => true }).capability).toBe(DURABLE)
    expect(isAlertable(c, { hasDefinition: () => true })).toBe(true)
  })

  it('⛔ a definition that is gone is SOURCE_UNAVAILABLE — never a fallback to the inline copy', () => {
    const c = cond({ definitionId: 'u_gone', formula: 'close > open' })
    const r = conditionCapability(c, { hasDefinition: () => false })
    expect(r.capability).toBe(SOURCE_UNAVAILABLE)
    expect(r.definitionId).toBe('u_gone')
  })

  it('⛔ a compatibility formula NEVER makes a definition-backed condition promotable again', () => {
    const c = cond({ definitionId: 'u_abc', formula: 'close > open' })
    expect(conditionCapability(c, { hasDefinition: () => true }).capability).toBe(DURABLE)
  })

  it('⛔ an unparseable or empty formula is INVALID, not promotable', () => {
    expect(conditionCapability(cond({ formula: '' })).capability).toBe(INVALID)
    expect(conditionCapability(cond({ formula: 'close >' })).capability).toBe(INVALID)
  })

  it('⛔ a bound name whose binding was DELETED is INVALID — not promotable, and not offered a handoff', () => {
    // `a` is unbound but the tree still reads it. It is not self-contained, and it
    // is not chart-bound either — it does not work anywhere, so offering "create
    // an alertable version" would be offering to port something broken.
    const c = cond({ formula: 'a > 50', bindings: {} })
    expect(conditionCapability(c).capability).toBe(INVALID)
  })

  it('⭐ …but the SAME formula WITH its binding is LOCAL_ONLY', () => {
    const c = cond({ formula: 'a > 50', bindings: { a: '@legacy:rsi::rsi' } })
    expect(conditionCapability(c).capability).toBe(LOCAL_ONLY)
  })

  it('⭐ boundInstances names the instances, for the Builder handoff', () => {
    const c = cond({ formula: '(a - b) > 0', bindings: { a: '@legacy:rsi::rsi', b: '@legacy:movingAverage::ma' } })
    expect(boundInstances(c).sort()).toEqual(['legacy:movingAverage', 'legacy:rsi'])
  })
})

describe('normalisation carries both forms, additively', () => {
  it('⭐ a legacy inline row survives unchanged', () => {
    const [c] = normaliseConditions({ conditions: [{ id: 'cond:1', formula: 'close > open', name: 'X' }] })
    expect(c.formula).toBe('close > open')
    expect(c.definitionId).toBe(null)
  })

  it('⚰️ a DEFINITION-BACKED row used to be dropped for having no formula', () => {
    const [c] = normaliseConditions({ conditions: [{ id: 'cond:2', definitionId: 'u_abc', name: 'Y' }] })
    expect(c).toBeTruthy()
    expect(c.definitionId).toBe('u_abc')
    expect(c.formula).toBe('')
    expect(c.name).toBe('Y')
  })

  it('⛔ a row with NEITHER is still malformed and still dropped', () => {
    expect(normaliseConditions({ conditions: [{ id: 'cond:3', name: 'Z' }] })).toEqual([])
  })

  it('⭐ actions, enabled and order are untouched by either form', () => {
    const list = normaliseConditions({ conditions: [
      { id: 'cond:a', definitionId: 'u_1', enabled: false, actions: [{ type: 'background' }] },
      { id: 'cond:b', formula: 'high > low', actions: [{ type: 'marker' }] },
    ] })
    expect(list.map((c) => c.id)).toEqual(['cond:a', 'cond:b'])
    expect(list[0].enabled).toBe(false)
    expect(list[0].actions).toHaveLength(1)
    expect(list[1].enabled).toBe(true)
  })
})
