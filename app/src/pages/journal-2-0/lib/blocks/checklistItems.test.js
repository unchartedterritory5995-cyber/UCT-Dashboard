import { describe, it, expect } from 'vitest'
import { checklistItems, uncheckedItems, checklistSummary, toggleChecked, untickedLine } from './checklistItems'

const settings = { setups: ['VCP', 'Flag'], setupRules: { VCP: [{ id: 's1', label: 'Volume dry-up' }, { id: 's2', label: 'Tight closes' }] } }
const rules = [{ id: 'r1', label: 'No trades in the first 5 minutes', beforeEntry: true },
  { id: 'r2', label: 'Journal every loss', beforeEntry: false }, { id: 'r3', label: 'Old rule' }]

describe('checklistItems', () => {
  it('the setup rules, then before-entry rules only', () => {
    expect(checklistItems({ settings, rules, setup: 'VCP', includeRules: 'yes' }).map((i) => i.id))
      .toEqual(['s1', 's2', 'rule:r1'])
  })
  it('includeRules no leaves the rules out; an unknown setup has no setup items', () => {
    expect(checklistItems({ settings, rules, setup: 'VCP', includeRules: 'no' }).map((i) => i.id)).toEqual(['s1', 's2'])
    expect(checklistItems({ settings, rules, setup: 'Gone', includeRules: 'yes' }).map((i) => i.id)).toEqual(['rule:r1'])
  })
  it('a stale checked id never counts', () => {
    const items = checklistItems({ settings, rules, setup: 'VCP', includeRules: 'no' })
    expect(checklistSummary(items, ['s1', 'deleted'])).toEqual({ done: 1, total: 2 })
    expect(uncheckedItems(items, ['s1']).map((i) => i.id)).toEqual(['s2'])
  })
  it('toggleChecked: on, off, item order, stale ids dropped', () => {
    const items = checklistItems({ settings, rules, setup: 'VCP', includeRules: 'no' })
    expect(toggleChecked(items, [], 's2')).toEqual(['s2'])
    expect(toggleChecked(items, ['s2'], 's1')).toEqual(['s1', 's2'])
    expect(toggleChecked(items, ['s1', 's2'], 's1')).toEqual(['s2'])
    expect(toggleChecked(items, ['gone', 's1'], 's2')).toEqual(['s1', 's2'])
  })
  it('untickedLine counts, and says nothing at zero', () => {
    expect(untickedLine(2)).toBe('2 checklist items not ticked.')
    expect(untickedLine(1)).toBe('1 checklist item not ticked.')
    expect(untickedLine(0)).toBeNull()
  })
  it('missing settings or rules are empty, never a throw', () => {
    expect(checklistItems({ settings: null, rules: null, setup: '', includeRules: 'yes' })).toEqual([])
  })
  // Beyond the brief: the item list is the member's own record, so a duplicate or an id-less row is
  // never shown twice or as a box that cannot be ticked.
  it('each id once, and a row with no id is not an item', () => {
    const dup = { setupRules: { VCP: [{ id: 's1', label: 'A' }, { id: 's1', label: 'A again' }, { label: 'no id' }] } }
    const twice = [{ id: 'r1', label: 'x', beforeEntry: true }, { id: 'r1', label: 'x', beforeEntry: true }]
    expect(checklistItems({ settings: dup, rules: twice, setup: 'VCP', includeRules: 'yes' }).map((i) => i.id))
      .toEqual(['s1', 'rule:r1'])
  })
})
