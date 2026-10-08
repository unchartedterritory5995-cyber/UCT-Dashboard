import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TEMPLATES, getTemplate } from './notebookTemplates'
import {
  __resetTemplateReveals,
  declaredExpression,
  ensureTemplatePropertyDefs,
  rememberTemplateReveal,
  templateRevealFor,
} from './templatePropertyDefs'
import { STARTER_FORMULAS, evaluateFormula, formulaInputIds } from './formula/computed'
import { parse, refsOf } from './formula/formulaEngine'
import { __resetNotebookFlags, latchNotebookFlags } from './offline/notebookFlags'

/**
 * Wave 12, lane 12B-2: the Position Tracker's property definitions, and applying them.
 * The NotebookTab-level rail (tabs/NotebookTab.positionTracker.test.jsx) proves the
 * request order end to end; this file proves the planner's every branch.
 */

const tracker = getTemplate('position-tracker')
const NUMBERS = ['Entry', 'Stop', 'Exit', 'Shares', 'Account size']
const FORMULAS = ['R-multiple', 'Risk per share', 'Position size %']

/** A fake property-defs store: list + create, recording every create. */
function store(initial = []) {
  const defs = initial.map((d) => ({ source: 'user_set', ...d }))
  const creates = []
  let n = 0
  return {
    creates,
    listDefs: vi.fn(async () => defs.map((d) => ({ ...d }))),
    createDef: vi.fn(async (name, type, config) => {
      creates.push({ name, type, config })
      const d = { id: `p${(n += 1)}`, name, type, source: 'user_set', ...(config ? { config, computed: true } : {}) }
      defs.push(d)
      return d
    }),
    defs,
  }
}

beforeEach(() => { __resetNotebookFlags(); __resetTemplateReveals() })
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

describe('12B-2 -- the Position Tracker declares its definitions as data', () => {
  it('five number properties and three formula properties, by the spec\'s names', () => {
    const decl = tracker.propertyDefinitions
    expect(decl.filter((d) => d.type === 'number').map((d) => d.name)).toEqual(NUMBERS)
    expect(decl.filter((d) => d.type === 'formula').map((d) => d.name)).toEqual(FORMULAS)
    expect(new Set(decl.map((d) => d.key)).size).toBe(decl.length)
  })

  it('R-multiple and risk per share ARE the 11B starters (derived, never a typed copy)', () => {
    const byKey = Object.fromEntries(tracker.propertyDefinitions.map((d) => [d.key, d]))
    expect(declaredExpression(byKey.r_multiple)).toBe(STARTER_FORMULAS.find((s) => s.id === 'r_multiple').expression)
    expect(declaredExpression(byKey.risk_per_share)).toBe(STARTER_FORMULAS.find((s) => s.id === 'risk_per_share').expression)
    expect(byKey.r_multiple.expression).toBeUndefined()
  })

  it('every formula parses and reads only the template\'s own number properties', () => {
    const numbers = new Set(NUMBERS.map((n) => n.toLowerCase()))
    for (const d of tracker.propertyDefinitions.filter((x) => x.type === 'formula')) {
      const text = declaredExpression(d)
      expect(text, d.key).toBeTruthy()
      const refs = refsOf(parse(text))
      expect(refs.length, d.key).toBeGreaterThan(0)
      for (const r of refs) {
        expect(r.kind, d.key).toBe('name')
        expect(numbers.has(r.key.trim().toLowerCase()), `${d.key} reads ${r.key}`).toBe(true)
      }
    }
  })

  // Wave 13 lane 13A: the Trade Plan declares its four plan levels too (Entry/Stop/Target/Shares,
  // numbers), so the grader reads a plan without parsing prose.
  it('only the Trade Plan and the Position Tracker declare definitions, and no template declares property VALUES', () => {
    expect(TEMPLATES.filter((t) => t.propertyDefinitions).map((t) => t.key)).toEqual(['trade-plan', 'position-tracker'])
    expect(getTemplate('trade-plan').propertyDefinitions.map((d) => [d.name, d.type])).toEqual(
      [['Entry', 'number'], ['Stop', 'number'], ['Target', 'number'], ['Shares', 'number']])
    expect(TEMPLATES.filter((t) => t.properties)).toEqual([])
  })
})

describe('12B-2 -- flag ON: definitions are created, numbers first, formulas stored by id', () => {
  beforeEach(() => latchNotebookFlags({ notebook_formulas_enabled: true }))

  it('a member with no properties gets all eight, and the formulas compute from the numbers', async () => {
    const s = store()
    const out = await ensureTemplatePropertyDefs(tracker, { listDefs: s.listDefs, createDef: s.createDef })
    expect(s.creates.map((c) => [c.name, c.type])).toEqual([
      ...NUMBERS.map((n) => [n, 'number']), ...FORMULAS.map((n) => [n, 'formula']),
    ])
    expect(out.skipped).toEqual([])
    expect(out.revealIds).toHaveLength(8)
    const idOf = Object.fromEntries(s.defs.map((d) => [d.name, d.id]))
    for (const c of s.creates.filter((x) => x.type === 'formula')) {
      expect(c.config.expression, c.name).not.toMatch(/\{[^@]/) // by id, never by name
      for (const id of formulaInputIds(c.config.expression)) expect(Object.values(idOf)).toContain(id)
    }
    // The values a trader expects: in 100, stop 95, out 110, 50 shares, $10,000 account.
    const props = { [idOf.Entry]: 100, [idOf.Stop]: 95, [idOf.Exit]: 110, [idOf.Shares]: 50, [idOf['Account size']]: 10000 }
    const value = (name) => evaluateFormula(s.defs.find((d) => d.name === name).config.expression, s.defs, props).value
    expect(value('R-multiple')).toBe(2)
    expect(value('Risk per share')).toBe(5)
    expect(value('Position size %')).toBe(50)
  })

  it('applying it twice reuses everything the first apply made -- no second "Entry"', async () => {
    const s = store()
    await ensureTemplatePropertyDefs(tracker, { listDefs: s.listDefs, createDef: s.createDef })
    const before = s.creates.length
    const again = await ensureTemplatePropertyDefs(tracker, { listDefs: s.listDefs, createDef: s.createDef })
    expect(s.creates.length).toBe(before)
    expect(again.revealIds).toHaveLength(8)
  })

  it('reuses the member\'s own definitions by name (any case) and type, keeping their formula', async () => {
    const s = store([
      { id: 'mine-entry', name: ' entry ', type: 'number' },
      { id: 'mine-r', name: 'R-Multiple', type: 'formula', config: { expression: '{@mine-entry} * 2' }, computed: true },
    ])
    const out = await ensureTemplatePropertyDefs(tracker, { listDefs: s.listDefs, createDef: s.createDef })
    expect(s.creates.map((c) => c.name)).not.toContain('Entry')
    expect(s.creates.map((c) => c.name)).not.toContain('R-multiple')
    expect(out.resolved.entry.id).toBe('mine-entry')
    expect(out.resolved.r_multiple.id).toBe('mine-r')
    const risk = s.creates.find((c) => c.name === 'Risk per share')
    expect(formulaInputIds(risk.config.expression)).toContain('mine-entry')
  })

  it('a name taken by ANOTHER type is never touched or duplicated: "Stop (number)" is made instead', async () => {
    const s = store([{ id: 'txt-stop', name: 'Stop', type: 'text' }])
    const out = await ensureTemplatePropertyDefs(tracker, { listDefs: s.listDefs, createDef: s.createDef })
    expect(s.creates.filter((c) => c.name === 'Stop')).toEqual([])
    const alt = s.defs.find((d) => d.name === 'Stop (number)')
    expect(alt.type).toBe('number')
    expect(out.resolved.stop.id).toBe(alt.id)
    expect(formulaInputIds(s.creates.find((c) => c.name === 'R-multiple').config.expression)).toContain(alt.id)
  })

  it('a code-defined built-in of the same name and type is never reused (it is not the member\'s)', async () => {
    const s = store([{ id: 'builtin:entry', name: 'Entry', type: 'number' }])
    const out = await ensureTemplatePropertyDefs(tracker, { listDefs: s.listDefs, createDef: s.createDef })
    expect(out.resolved.entry.id).not.toBe('builtin:entry')
    expect(out.resolved.entry.name).toBe('Entry (number)')
  })

  it('both names taken by other types: that input is skipped, and so are the formulas that read it', async () => {
    const s = store([
      { id: 'a', name: 'Stop', type: 'text' },
      { id: 'b', name: 'Stop (number)', type: 'date' },
    ])
    const out = await ensureTemplatePropertyDefs(tracker, { listDefs: s.listDefs, createDef: s.createDef })
    expect(out.skipped.map((x) => [x.key, x.reason])).toEqual([
      ['stop', 'name_taken'], ['r_multiple', 'input_missing'], ['risk_per_share', 'input_missing'],
    ])
    expect(s.creates.map((c) => c.name)).toEqual(['Entry', 'Exit', 'Shares', 'Account size', 'Position size %'])
  })

  it('a refused formula (the server\'s gate disagrees with the tab) is skipped; the rest still land', async () => {
    const s = store()
    const createDef = vi.fn(async (name, type, config) => {
      if (type === 'formula') throw new Error('Unsupported property type: \'formula\'')
      return s.createDef(name, type, config)
    })
    const out = await ensureTemplatePropertyDefs(tracker, { listDefs: s.listDefs, createDef })
    expect(out.skipped.map((x) => x.reason)).toEqual(['create_failed', 'create_failed', 'create_failed'])
    expect(out.revealIds).toHaveLength(5)
  })

  it('a failed number create skips only what depends on it', async () => {
    const s = store()
    const createDef = vi.fn(async (name, type, config) => {
      if (name === 'Exit') throw new Error('500')
      return s.createDef(name, type, config)
    })
    const out = await ensureTemplatePropertyDefs(tracker, { listDefs: s.listDefs, createDef })
    expect(out.skipped.map((x) => [x.key, x.reason])).toEqual([['exit', 'create_failed'], ['r_multiple', 'input_missing']])
    expect(Object.keys(out.resolved)).toEqual(['entry', 'stop', 'shares', 'account', 'risk_per_share', 'position_size'])
  })
})

describe('⛔ 12B-2 -- flag OFF: the formulas are left out BEFORE any request', () => {
  it('latched off: five number creates, not one formula create, the formulas reported as left out', async () => {
    latchNotebookFlags({ notebook_formulas_enabled: false })
    const s = store()
    const out = await ensureTemplatePropertyDefs(tracker, { listDefs: s.listDefs, createDef: s.createDef })
    expect(s.creates.map((c) => [c.name, c.type])).toEqual(NUMBERS.map((n) => [n, 'number']))
    expect(s.creates.some((c) => c.type === 'formula' || c.config)).toBe(false)
    expect(out.skipped).toEqual(FORMULAS.map((name, i) => ({
      key: ['r_multiple', 'risk_per_share', 'position_size'][i], name, reason: 'formulas_off',
    })))
    expect(out.revealIds).toHaveLength(5)
  })

  it('nothing latched yet reads as OFF (an enablement gate: unset means off)', async () => {
    const s = store()
    await ensureTemplatePropertyDefs(tracker, { listDefs: s.listDefs, createDef: s.createDef })
    expect(s.creates.some((c) => c.type === 'formula')).toBe(false)
    expect(s.creates).toHaveLength(5)
  })

  it('CONTROL: the same call with the flag ON does send formula creates (the rail can tell)', async () => {
    latchNotebookFlags({ notebook_formulas_enabled: true })
    const s = store()
    await ensureTemplatePropertyDefs(tracker, { listDefs: s.listDefs, createDef: s.createDef })
    expect(s.creates.filter((c) => c.type === 'formula')).toHaveLength(3)
  })
})

describe('12B-2 -- templates without definitions, and the reveal', () => {
  it('a template that declares none makes no request at all', async () => {
    const s = store()
    const out = await ensureTemplatePropertyDefs(getTemplate('daily-prep'), { listDefs: s.listDefs, createDef: s.createDef })
    expect(s.listDefs).not.toHaveBeenCalled()
    expect(out).toEqual({ resolved: {}, revealIds: [], skipped: [] })
  })

  it('the reveal is remembered per note and bounded', () => {
    rememberTemplateReveal('n1', ['a', 'b'])
    expect(templateRevealFor('n1')).toEqual(['a', 'b'])
    expect(templateRevealFor('other')).toEqual([])
    for (let i = 0; i < 60; i += 1) rememberTemplateReveal(`x${i}`, ['z'])
    expect(templateRevealFor('n1')).toEqual([])
    expect(templateRevealFor('x59')).toEqual(['z'])
  })
})
