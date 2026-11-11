// app/src/components/chart/indicatorRegistry.groups.test.js
//
// ⭐ UCT RS PHASE 2a, UNIT 2a-11 — the grouping helpers lifted out of the
// settings dialog: `sectionize`, `packRows`, `initialCollapsed` (+ `INLINE_MAX`).
// Pure functions over generated fields; the phone sheet reads them now and the
// dialog swaps to them in unit 2a-15, so the RULES here are the dialog's rules:
// sections by `group` in first-appearance order, a headerless section for the
// ungrouped, `inline` packs of up to three SAME-type fields, every field in and
// every field out.
import { describe, it, expect } from 'vitest'
import { sectionize, packRows, initialCollapsed, INLINE_MAX, fieldsForInstance, fieldsFromDefinition, visibleInputs } from './indicatorRegistry'
import * as engineRegistry from './engine/nativeRegistry'

const rsDef = () => engineRegistry.getDefinition('rsLine')
const rsInst = { instanceId: 'rs-1', defId: 'rsLine', inputs: {}, hidden: false }

const flatKeys = (rows) => rows.flatMap((r) => r.keys)

describe('initialCollapsed(def)', () => {
  it('is the definition\'s meta.groupsCollapsed as a Set of strings', () => {
    // VA2: the plan's five folded groups (§6.3); 3-08 adds Checks (the anchor date)
    expect([...initialCollapsed(rsDef())]).toEqual(['Line', 'New highs', 'Rating', 'Stress test', 'Method', 'Checks'])
  })
  it('is empty with no hint, and drops junk', () => {
    expect(initialCollapsed(engineRegistry.getDefinition('rsi')).size).toBe(0)
    expect(initialCollapsed(null).size).toBe(0)
    expect(initialCollapsed({ meta: { groupsCollapsed: 'Line' } }).size).toBe(0)
    expect([...initialCollapsed({ meta: { groupsCollapsed: [1, '', null, 'x'] } })]).toEqual(['x'])
  })
})

describe('sectionize(def, fields) over the shipped UCT RS definition', () => {
  it('yields Simple, Line, New highs, Rating, Stress test, Method in declaration order, keys per group in order, the hint on collapsed', () => {
    const def = rsDef()
    const model = fieldsForInstance(def, rsInst)
    const sections = sectionize(def, model.all)
    const groups = ['Simple', 'Line', 'New highs', 'Rating', 'Stress test', 'Method']
    expect(sections.map((s) => s.group)).toEqual(groups)
    expect(sections.map((s) => s.label)).toEqual(groups)
    expect(sections.map((s) => s.collapsed)).toEqual([false, true, true, true, true, true])
    // Keys partition the RENDERED inputs, in declaration order, nothing lost.
    // ⭐ 3-08: with no server declaration the Phase 3 inputs (requiresServer) get
    // no field, so Checks (the anchor date alone) has no section until the v4 row
    // declares it. ⭐ 3-14: the legacy Mansfield switch DOES, in Method, while its
    // successor (`view`) is undeclared.
    const shown = visibleInputs(def, null)
    const declared = shown.map((i) => i.key)
    expect(declared).toContain('showMansfield')
    expect(declared).not.toContain('view')
    expect(sections.flatMap((s) => s.keys)).toEqual(declared)
    for (const s of sections) {
      const byGroup = shown.filter((i) => i.group === s.group).map((i) => i.key)
      expect(s.keys).toEqual(byGroup)
      expect(s.fields.map((f) => f.key)).toEqual(byGroup)
      // No `inline` on this definition ⇒ every row is a single row.
      expect(s.rows.every((r) => r.kind === 'row')).toBe(true)
      expect(flatKeys(s.rows)).toEqual(byGroup)
    }
  })

  it('3-08: with the v4 row declared, Checks joins the sections, collapsed, and the Phase 3 controls render in their groups', () => {
    const def = rsDef()
    const declared = { inputs: def.meta.serverInputs, options: { benchmark: ['SPY', 'RSP', 'SECTOR', 'QQQ', 'IWM', 'INDUSTRY', 'CUSTOM'] } }
    const sections = sectionize(def, fieldsForInstance(def, rsInst, { declared }).all)
    expect(sections.map((s) => s.group)).toEqual(['Simple', 'Line', 'New highs', 'Rating', 'Stress test', 'Method', 'Checks'])
    expect(sections.at(-1)).toMatchObject({ group: 'Checks', collapsed: true, keys: ['anchorDate'] })
    expect(sections[0].keys.slice(0, 3)).toEqual(['benchmark', 'customBenchmark', 'view'])
    expect(sections.find((s) => s.group === 'Method').keys).toEqual(['mansfieldLength', 'mansfieldColor', 'dotCrossColor',
      'rrgRatioLength', 'rrgMomentumLength', 'clenowWindow', 'clenowGapPct', 'atrLength', 'varsLookback'])
  })

  it('defaults to every field of the definition when no fields are passed', () => {
    const def = rsDef()
    const a = sectionize(def)
    const b = sectionize(def, fieldsFromDefinition(def).map((f) => ({ ...f, group: def.inputs.find((i) => i.key === f.key).group })))
    expect(a.map((s) => s.keys)).toEqual(b.map((s) => s.keys))
  })

  it('sections ONE tab\'s half the same way (the dialog\'s Inputs / Style split)', () => {
    const def = rsDef()
    const model = fieldsForInstance(def, rsInst)
    const inputs = sectionize(def, model.inputs)
    const style = sectionize(def, model.style)
    expect(inputs.flatMap((s) => s.keys)).toEqual(model.inputs.map((f) => f.key))
    expect(style.flatMap((s) => s.keys)).toEqual(model.style.map((f) => f.key))
    // The Style half holds only hinted groups, each marked collapsed — the
    // CONSUMER decides whether to honour the hint there (the dialog does not).
    // Rating has no colour or width, so it is not on the Style tab (VA2).
    expect(style.map((s) => s.group)).toEqual(['Line', 'New highs', 'Stress test', 'Method'])
    expect(style.every((s) => s.collapsed)).toBe(true)
  })
})

describe('sectionize over a definition with no groups', () => {
  it('is one headerless section — group null, label null, never collapsed — holding every field', () => {
    const def = engineRegistry.getDefinition('rsi')
    const model = fieldsForInstance(def, { instanceId: 'legacy:rsi', defId: 'rsi', inputs: {} })
    const sections = sectionize(def, model.all)
    expect(sections).toHaveLength(1)
    expect(sections[0].group).toBeNull()
    expect(sections[0].label).toBeNull()
    expect(sections[0].collapsed).toBe(false)
    expect(sections[0].keys).toEqual(def.inputs.map((i) => i.key))
  })

  it('ungrouped fields between grouped ones keep their own headerless section, in first-appearance order', () => {
    const fields = [
      { key: 'a', type: 'number', group: null },
      { key: 'b', type: 'number', group: 'G' },
      { key: 'c', type: 'toggle', group: null },
      { key: 'd', type: 'number', group: 'G' },
    ]
    const sections = sectionize({ meta: { groupsCollapsed: ['G'] } }, fields)
    expect(sections.map((s) => s.group)).toEqual([null, 'G'])
    expect(sections.map((s) => s.keys)).toEqual([['a', 'c'], ['b', 'd']])
    expect(sections.map((s) => s.collapsed)).toEqual([false, true])
  })

  it('tolerates junk fields', () => {
    expect(sectionize({}, [null, {}, { key: 'k', type: 'number' }]).map((s) => s.keys)).toEqual([['k']])
    expect(sectionize(null, [])).toEqual([])
  })
})

describe('packRows — the inline rule', () => {
  const num = (key, inline) => ({ key, type: 'number', inline: inline || null })
  const col = (key, inline) => ({ key, type: 'color', inline: inline || null })

  it('INLINE_MAX is three', () => {
    expect(INLINE_MAX).toBe(3)
  })

  it('four same-type fields sharing an inline name pack as three + one; a field with no inline is its own row', () => {
    const fields = [num('p'), num('a', 'levels'), num('b', 'levels'), num('c', 'levels'), num('d', 'levels'), num('q')]
    const rows = packRows(fields)
    expect(rows.map((r) => r.kind)).toEqual(['row', 'pack', 'pack', 'row'])
    expect(rows[1].inline).toBe('levels')
    expect(rows[1].keys).toEqual(['a', 'b', 'c'])
    expect(rows[2].keys).toEqual(['d'])
    expect(rows[1].fields.map((f) => f.key)).toEqual(['a', 'b', 'c'])
    expect(flatKeys(rows)).toEqual(fields.map((f) => f.key))
  })

  it('an inline group of MIXED types does not pack: each type run is its own pack', () => {
    const rows = packRows([num('n1', 'mix'), col('c1', 'mix'), num('n2', 'mix')])
    expect(rows.map((r) => r.kind)).toEqual(['pack', 'pack', 'pack'])
    expect(rows.map((r) => r.keys)).toEqual([['n1'], ['c1'], ['n2']])
  })

  it('accepts KEYS with a lookup (Map or object) and skips an unknown key', () => {
    const byKey = new Map([['a', num('a', 'g')], ['b', num('b', 'g')], ['z', num('z')]])
    expect(packRows(['a', 'b', 'z'], byKey).map((r) => r.keys)).toEqual([['a', 'b'], ['z']])
    expect(packRows(['a', 'ghost'], Object.fromEntries(byKey)).map((r) => r.keys)).toEqual([['a']])
    expect(packRows(['a'])).toEqual([])
    expect(packRows(null)).toEqual([])
  })

  it('every field that arrives leaves, in order, for the shipped UCT RS fields', () => {
    const model = fieldsForInstance(rsDef(), rsInst)
    expect(flatKeys(packRows(model.all))).toEqual(model.all.map((f) => f.key))
  })
})

// ⭐ UCT RS 3-14 — `isPlotHidden`: a `requiresServer` plot waits for EVERY gated input.
describe('3-14 · isPlotHidden', () => {
  it('fails closed, needs every gated input declared, and never hides an unmarked plot', async () => {
    const { isPlotHidden } = await import('./indicatorRegistry')
    const def = { inputs: [{ key: 'a', requiresServer: true }, { key: 'b', requiresServer: true }, { key: 'c' }] }
    const gated = { key: 'p', requiresServer: true }
    expect(isPlotHidden(def, { key: 'q' }, null)).toBe(false)
    expect(isPlotHidden(def, gated, null)).toBe(true)
    expect(isPlotHidden(def, gated, { inputs: ['a', 'c'] })).toBe(true)
    expect(isPlotHidden(def, gated, { inputs: ['a', 'b'] })).toBe(false)
    expect(isPlotHidden({ inputs: [{ key: 'c' }] }, gated, { inputs: ['c'] })).toBe(true)
  })
})
