// Finish program, lane FE, I7 verification: the Trade Plan template now sets up property
// definitions in the member's account before its note is made (wave 13 lane 13A; live with
// every flag off). Two questions the review asked, answered against the REAL template:
//   * is it idempotent?  picking Trade Plan again creates nothing;
//   * does it touch a member's existing definitions?  it can only LIST and CREATE (the two
//     calls `ensureTemplatePropertyDefs` is given), reuses the member's own by name and type,
//     and steps around a name the member uses for something else.
import { describe, it, expect, vi } from 'vitest'
import { getTemplate } from './notebookTemplates'
import { PLAN_ROLES } from './planLevels'
import { ensureTemplatePropertyDefs } from './templatePropertyDefs'

const TRADE_PLAN = getTemplate('trade-plan')
const NAMES = PLAN_ROLES.map((r) => r[0].toUpperCase() + r.slice(1))

function account(initial = []) {
  const defs = initial.map((d) => ({ ...d }))
  let seq = 0
  const listDefs = vi.fn(async () => defs.map((d) => ({ ...d })))
  const createDef = vi.fn(async (name, type) => {
    const def = { id: `new-${seq += 1}`, name, type, source: 'user_set' }
    defs.push(def)
    return def
  })
  return { defs, listDefs, createDef }
}

describe('I7 — Trade Plan property definitions', () => {
  it('declares one number property per plan role, and nothing else', () => {
    expect(TRADE_PLAN.propertyDefinitions.map((d) => [d.name, d.type])).toEqual(NAMES.map((n) => [n, 'number']))
    expect(NAMES.length).toBeGreaterThan(0)
    expect(TRADE_PLAN.properties).toBeUndefined()        // no property VALUES ride the create
  })

  it('is idempotent: the second pick creates nothing and resolves to the same definitions', async () => {
    const a = account()
    const first = await ensureTemplatePropertyDefs(TRADE_PLAN, { listDefs: a.listDefs, createDef: a.createDef })
    expect(a.createDef).toHaveBeenCalledTimes(NAMES.length)
    const second = await ensureTemplatePropertyDefs(TRADE_PLAN, { listDefs: a.listDefs, createDef: a.createDef })
    expect(a.createDef).toHaveBeenCalledTimes(NAMES.length)                 // not one more
    expect(second.revealIds).toEqual(first.revealIds)
    expect(a.defs.map((d) => d.name).sort()).toEqual([...NAMES].sort())     // no second "Entry"
  })

  it('never changes what the member already has: own definitions are reused, a clashing name is stepped around', async () => {
    const mine = [
      { id: 'p-1', name: 'entry', type: 'number', source: 'user_set' },     // theirs, same type, other case: reused
      { id: 'p-2', name: 'Stop', type: 'text', source: 'user_set' },        // theirs, another type: left alone
      { id: 'p-3', name: 'Conviction', type: 'select', source: 'user_set' },
    ]
    const before = JSON.stringify(mine)
    const a = account(mine)
    const out = await ensureTemplatePropertyDefs(TRADE_PLAN, { listDefs: a.listDefs, createDef: a.createDef })
    // every one of the member's rows is byte-for-byte what it was
    expect(JSON.stringify(a.defs.slice(0, mine.length))).toBe(before)
    expect(out.resolved.entry.id).toBe('p-1')
    expect(out.resolved.stop.name).toBe('Stop (number)')
    const created = a.createDef.mock.calls.map((c) => c[0])
    expect(created).not.toContain('Entry')
    expect(created).not.toContain('Stop')
    expect(created).toContain('Stop (number)')
  })

  it('the only network calls the real path can make are a GET and POSTs to /api/j2/property-defs', async () => {
    const calls = []
    const realFetch = global.fetch
    global.fetch = vi.fn(async (url, init = {}) => {
      calls.push(`${(init.method || 'GET').toUpperCase()} ${url}`)
      if ((init.method || 'GET').toUpperCase() === 'GET') return { ok: true, json: async () => ({ propertyDefs: [] }) }
      const body = JSON.parse(init.body)
      return { ok: true, json: async () => ({ propertyDef: { id: `n-${calls.length}`, name: body.name, type: body.type, source: 'user_set' } }) }
    })
    try {
      await ensureTemplatePropertyDefs(TRADE_PLAN)
    } finally {
      global.fetch = realFetch
    }
    expect(calls[0]).toBe('GET /api/j2/property-defs')
    expect(new Set(calls.slice(1))).toEqual(new Set(['POST /api/j2/property-defs']))
    expect(calls.length).toBe(1 + NAMES.length)
  })
})
