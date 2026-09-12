import { describe, it, expect, vi } from 'vitest'
import { promoteCondition, checkPromotable, STEPS } from '../conditionPromotion'
import { conditionsOf, addCondition, addAction } from '../conditionControls'
import { LOCAL_ONLY, DURABLE, INVALID } from '../conditionCapability'

// ── a chart with three conditions, the middle one instance-bound ─────────────
const build = () => {
  let cs = { conditions: [], header: { fields: [], infoFormulas: [] } }
  cs = addCondition(cs, { name: 'Above 50', formula: 'rsi(close, 14) > 50' })
  cs = addCondition(cs, { name: 'Follows RSI', formula: 'a > 50', bindings: { a: '@legacy:rsi::rsi' } })
  cs = addCondition(cs, { name: 'Inside Bar', formula: 'high < high[1] && low > low[1]' })
  const [plain, bound, inside] = conditionsOf(cs)
  // the first one carries an action, so "actions survive" is testable
  cs = addAction(cs, plain.id, 'candleColor')
  return { cs, ids: { plain: plain.id, bound: bound.id, inside: inside.id } }
}

const store = (over = {}) => ({
  buildDocument: vi.fn(({ source, name }) => ({ id: 'draft_1', source, name })),
  validate: vi.fn((docs) => ({ defs: docs, errors: [] })),
  save: vi.fn(async (doc) => ({ ok: true, row: { id: 'u_server9', version: 1, definition: doc } })),
  install: vi.fn(() => ({ ok: true })),
  ...over,
})

describe('who may be promoted', () => {
  it('⭐ a self-contained inline condition may', () => {
    const { cs, ids } = build()
    expect(checkPromotable(cs, ids.plain).ok).toBe(true)
    expect(checkPromotable(cs, ids.inside).ok).toBe(true)
  })

  it('⛔⛔ an INSTANCE-BOUND one may NOT — and the refusal names what it follows', () => {
    const { cs, ids } = build()
    const gate = checkPromotable(cs, ids.bound)
    expect(gate.ok).toBe(false)
    expect(gate.capability).toBe(LOCAL_ONLY)
    expect(gate.boundTo).toEqual(['legacy:rsi'])
    // ⭐ the sentence is about what they BUILT, not about our data model
    expect(gate.reason).toMatch(/follows an indicator on this chart/)
    expect(gate.reason).not.toMatch(/@|binding|instanceId/)
  })

  it('⛔ an already-durable one is refused with NOTHING TO SAY — it is not an error', () => {
    const cs = { conditions: [{ id: 'cond:x', name: 'D', definitionId: 'u_1', enabled: true }] }
    const gate = checkPromotable(cs, 'cond:x', { hasDefinition: () => true })
    expect(gate.ok).toBe(false)
    expect(gate.capability).toBe(DURABLE)
    expect(gate.reason).toBe(null)
  })

  it('⛔ a condition that is no longer on the chart is refused, not thrown at', () => {
    const { cs } = build()
    expect(checkPromotable(cs, 'cond:gone').ok).toBe(false)
    expect(checkPromotable(cs, 'cond:gone').cond).toBe(null)
  })
})

describe('promotion — what moves and what does not', () => {
  it('⭐⭐ the definition becomes canonical and EVERYTHING THE CHART OWNS survives', async () => {
    const { cs, ids } = build()
    const before = conditionsOf(cs)
    const s = store()
    const res = await promoteCondition(cs, ids.plain, s)

    expect(res.ok).toBe(true)
    expect(res.definitionId).toBe('u_server9')
    const after = conditionsOf(res.settings)
    const row = after.find((c) => c.id === ids.plain)

    expect(row.definitionId).toBe('u_server9')   // …the formula now lives there
    expect(row.id).toBe(before[0].id)            // id — the actions are keyed on it
    expect(row.name).toBe('Above 50')            // name
    expect(row.enabled).toBe(true)               // enabled state
    expect(row.actions).toHaveLength(1)          // the visual action
    expect(row.actions[0].type).toBe('candleColor')
    expect(after.map((c) => c.id)).toEqual(before.map((c) => c.id))  // ⭐ and the ORDER
  })

  it('⭐ the document is built from the condition’s OWN source and name', async () => {
    const { cs, ids } = build()
    const s = store()
    await promoteCondition(cs, ids.plain, s)
    expect(s.buildDocument).toHaveBeenCalledWith({ source: 'rsi(close, 14) > 50', name: 'Above 50' })
  })

  it('⛔ the STORE’s row is installed, never the draft', async () => {
    const { cs, ids } = build()
    const s = store()
    const res = await promoteCondition(cs, ids.plain, s)
    expect(s.install.mock.calls[0][0].id).toBe('draft_1')   // the definition body…
    expect(res.definitionId).toBe('u_server9')              // …under the SERVER's id
  })

  it('⛔ the other conditions are untouched', async () => {
    const { cs, ids } = build()
    const res = await promoteCondition(cs, ids.plain, store())
    const after = conditionsOf(res.settings)
    expect(after[1].definitionId).toBe(null)
    expect(after[1].formula).toBe('a > 50')
    expect(after[2].formula).toBe('high < high[1] && low > low[1]')
  })

  it('⛔ the caller’s settings object is never mutated', async () => {
    const { cs, ids } = build()
    const snapshot = JSON.stringify(cs)
    await promoteCondition(cs, ids.plain, store())
    expect(JSON.stringify(cs)).toBe(snapshot)
  })
})

describe('atomicity — every failure leaves the condition valid', () => {
  const failsAt = {
    build: { buildDocument: vi.fn(() => { throw new Error('unparseable') }) },
    validate: { validate: vi.fn(() => ({ defs: [], errors: ['budget exceeded'] })) },
    save: { save: vi.fn(async () => ({ ok: false, error: 'offline' })) },
    throws: { save: vi.fn(async () => { throw new Error('network down') }) },
    noId: { save: vi.fn(async () => ({ ok: true, row: {} })) },
    install: { install: vi.fn(() => ({ ok: false, error: 'stale verdict' })) },
  }

  for (const [where, over] of Object.entries(failsAt)) {
    it(`⛔ a failure at ${where} returns the SAME settings object`, async () => {
      const { cs, ids } = build()
      const res = await promoteCondition(cs, ids.plain, store(over))
      expect(res.ok).toBe(false)
      // ⭐ identity, not equality — `next !== settings` is the whole of a caller's
      // error handling everywhere else in this layer, and promotion keeps that.
      expect(res.settings).toBe(cs)
      expect(res.reason).toBeTruthy()
      expect(STEPS).toContain(res.step)
    })
  }

  it('⛔ nothing reaches the network when the registry refuses', async () => {
    const { cs, ids } = build()
    const s = store(failsAt.validate)
    await promoteCondition(cs, ids.plain, s)
    expect(s.save).not.toHaveBeenCalled()
    expect(s.install).not.toHaveBeenCalled()
  })

  it('⛔ nothing is installed when the save fails', async () => {
    const { cs, ids } = build()
    const s = store(failsAt.save)
    await promoteCondition(cs, ids.plain, s)
    expect(s.install).not.toHaveBeenCalled()
  })

  it('⛔⛔ THE ROLLBACK BOUNDARY IS NAMED, not hidden', async () => {
    // A definition that saved but cannot draw leaves an ORPHAN. It is inert — it
    // plots nothing and alerts on nothing — and reporting it beats attaching a
    // condition that would render nothing with no explanation.
    const { cs, ids } = build()
    const res = await promoteCondition(cs, ids.plain, store(failsAt.install))
    expect(res.step).toBe('install')
    expect(res.orphanDefinitionId).toBe('u_server9')
    expect(res.settings).toBe(cs)
    expect(conditionsOf(cs)[0].definitionId).toBe(null)   // ⭐ still a working condition
  })

  it('⛔ a condition deleted mid-flight does not get resurrected', async () => {
    const { cs, ids } = build()
    const s = store()
    // the settings handed BACK from the save are a chart the condition has left
    const gone = { ...cs, conditions: conditionsOf(cs).filter((c) => c.id !== ids.plain) }
    const res = await promoteCondition(gone, ids.plain, s)
    expect(res.ok).toBe(false)
    expect(res.step).toBe('capability')
    expect(s.save).not.toHaveBeenCalled()
  })

  it('⛔ an instance-bound condition never reaches the store at all', async () => {
    const { cs, ids } = build()
    const s = store()
    const res = await promoteCondition(cs, ids.bound, s)
    expect(res.capability).toBe(LOCAL_ONLY)
    expect(res.boundTo).toEqual(['legacy:rsi'])
    expect(s.buildDocument).not.toHaveBeenCalled()
    expect(res.settings).toBe(cs)
  })

  it('⛔ a formula that does not read back is INVALID, and is not offered a handoff', async () => {
    const cs = { conditions: [{ id: 'cond:z', name: 'Broken', formula: 'zzz > 1', enabled: true }] }
    const res = await promoteCondition(cs, 'cond:z', store())
    expect(res.capability).toBe(INVALID)
    expect(res.boundTo).toEqual([])
  })
})
