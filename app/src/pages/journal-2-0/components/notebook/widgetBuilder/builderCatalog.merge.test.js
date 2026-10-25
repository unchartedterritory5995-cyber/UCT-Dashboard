// The builder's interpreter of the server's view rules and its per-source refusals, after the be->impl merge.
// tests/test_view_rules_merge.py rails the SAME cases on sources.view_allowed / auto_view; here the client's
// CHECK_TESTS / autoView answer them from the catalog data (types, targetGoal), and the refusals come from the
// catalog's own `refusedRanges` / `allAccountsOnly` (Task 9.17 concern 2), never a client list.
import { describe, it, expect } from 'vitest'
import { indexCatalog, viewReason, autoView, refusedRangesOf, rangeRefused, allAccountsOnly } from './builderCatalog'
import { CATALOG } from './__fixtures__/builderFixtures'
import { TOOL_CATALOG } from './__fixtures__/toolCatalog'

// The served catalog plus a notes-like source (wave 10 is off in the generated fixture): two day fields.
const NOTES = { key: 'notes', label: 'Notes', fields: [
  { key: 'created', label: 'Written', type: 'day', split: true },
  { key: 'updated', label: 'Updated', type: 'day', split: true },
  { key: 'folder', label: 'Folder', type: 'text', split: true }], measures: ['notes'] }
const CAT = indexCatalog({ ...CATALOG, sources: [...CATALOG.sources, NOTES] })
const p = (source, view, split = null, extra = {}) => ({ source, view: { type: view }, split, measures: [{ key: 'net_pnl' }], ...extra })

describe('view rules read the field types and a goal target (be wave 10 semantics, impl R-35 data)', () => {
  it('a line and a heat map run along any day field', () => {
    for (const by of ['created', 'updated']) {
      expect(viewReason(CAT, p('notes', 'line', { by }), 'line')).toBeNull()
      expect(viewReason(CAT, p('notes', 'heat', { by }), 'heat')).toBeNull()
      expect(autoView(CAT, { source: 'notes', split: { by } })).toBe('line')
    }
    expect(viewReason(CAT, p('notes', 'line', { by: 'folder' }), 'line')).toBe(CATALOG.reasons.view_line)
    expect(viewReason(CAT, p('closed_trades', 'heat', { by: 'month' }), 'heat')).toBe(CATALOG.reasons.view_heat)
    expect(viewReason(CAT, p('closed_trades', 'line', { by: 'month' }), 'line')).toBeNull()
    expect(autoView(CAT, { source: 'notes', split: { by: 'folder' } })).toBe('bar')
  })

  it('a goal target is a target', () => {
    expect(viewReason(CAT, p('closed_trades', 'progress', null, { display: { targetGoal: { goal: 'g1' } } }), 'progress')).toBeNull()
    expect(viewReason(CAT, p('closed_trades', 'progress', null, { display: {} }), 'progress')).toBe(CATALOG.reasons.view_progress)
  })

  it('CONTROL: without the served `types` the day fields are not time fields', () => {
    const rules = CATALOG.viewRules
    const bare = indexCatalog({ ...CATALOG, sources: [...CATALOG.sources, NOTES],
      viewRules: { ...rules, checks: rules.checks.map(({ types, ...c }) => c), auto: { ...rules.auto, time_types: [] } } })
    expect(viewReason(bare, p('notes', 'line', { by: 'created' }), 'line')).toBe(CATALOG.reasons.view_line)
    expect(autoView(bare, { source: 'notes', split: { by: 'created' } })).toBe('bar')
  })
})

describe('the refusals each source serves', () => {
  const tools = indexCatalog(TOOL_CATALOG)
  it('routine and tracker days refuse the trade-count ranges and take every account; closed trades refuse none', () => {
    for (const s of ['routine_history', 'tracker_history']) {
      expect(refusedRangesOf(tools, s)).toEqual(['last_20_trades', 'last_50_trades', 'last_100_trades'])
      expect(rangeRefused(tools, s, { token: 'last_50_trades' })).toBe(true)
      expect(rangeRefused(tools, s, { token: 'last_30d' })).toBe(false)
      expect(allAccountsOnly(tools, s)).toBe(true)
    }
    expect(refusedRangesOf(tools, 'closed_trades')).toEqual([])
    expect(allAccountsOnly(tools, 'closed_trades')).toBe(false)
  })
  it('an older server that serves neither refuses nothing here', () => {
    const old = indexCatalog({ ...TOOL_CATALOG, sources: TOOL_CATALOG.sources.map(({ refusedRanges, allAccountsOnly: a, ...s }) => s) })
    expect(refusedRangesOf(old, 'routine_history')).toEqual([])
    expect(allAccountsOnly(old, 'routine_history')).toBe(false)
  })
})
