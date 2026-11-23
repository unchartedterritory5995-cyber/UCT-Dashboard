// Layer A scorer: the declared hidden-field refusal (testing/fastRefusals.js, AUDIT ruling 2026-11-22). A fast plan the
// Screener's F-16 rule refuses whole is a SAFE REFUSAL (the `refused` column); nothing else is.
import { describe, it, expect } from 'vitest'
import { fastRefusalRule, withDeclaredRefusal } from './testing/fastRefusals'
import { RATING_FIELDS, FLOW_FIELDS } from './capabilities/scanHidden'

const screen = (args) => ({ action: 'screener.run', args: { filters: [], sort_field: null, sort_dir: null, mode: 'new', show: null, as: null, within: null, ...args } })
const ops = (...o) => ({ kind: 'ops', ops: o })

describe('layer A — declared hidden-field refusals', () => {
  it('a hidden-field fast plan scores refused (sort, filter, compared field; ratings and flow)', () => {
    const hidden = [...RATING_FIELDS][0]
    const flow = [...FLOW_FIELDS][0]
    for (const fast of [
      ops(screen({ sort_field: 'rs_rank', sort_dir: 'desc' })),
      ops(screen({ filters: [{ field: hidden, op: 'gte', value: 0 }] })),
      ops(screen({ filters: [{ field: 'price', op: 'gt_col', other: hidden }] })),
      ops(screen({ filters: [{ field: flow, op: 'gte', value: 0 }], mode: 'refine' })),
    ]) {
      expect(fastRefusalRule(fast.ops)).toBe('hidden-field')
      expect(withDeclaredRefusal('fast-WRONG', fast)).toBe('fast-refuses')
    }
  })

  it('the same shape on a PUBLIC field, mis-claimed, still scores fast-WRONG', () => {
    for (const fast of [
      ops(screen({ sort_field: 'chg_pct_1d', sort_dir: 'desc' })),
      ops(screen({ filters: [{ field: 'price', op: 'gt', value: 10 }] })),
      ops(screen({})),
    ]) {
      expect(fastRefusalRule(fast.ops)).toBe(null)
      expect(withDeclaredRefusal('fast-WRONG', fast)).toBe('fast-WRONG')
    }
  })

  it('a hidden-field plan that would RUN anything else still scores WRONG', () => {
    const fast = ops(screen({ sort_field: 'rs_rank', sort_dir: 'desc' }), { action: 'chart.setSymbol', args: { symbol: 'NVDA' } })
    expect(fastRefusalRule(fast.ops)).toBe(null)
    expect(withDeclaredRefusal('fast-WRONG', fast)).toBe('fast-WRONG')
    // another capability's op is never covered by this rule, hidden-looking args or not
    expect(withDeclaredRefusal('fast-WRONG', ops({ action: 'watchlist.add', args: { sort_field: 'rs_rank' } }))).toBe('fast-WRONG')
  })

  it('only fast-WRONG ops plans are re-scored: other outcomes and kinds are left alone', () => {
    const fast = ops(screen({ sort_field: 'rs_rank' }))
    expect(withDeclaredRefusal('fast-correct', fast)).toBe('fast-correct')
    expect(withDeclaredRefusal('to-model', null)).toBe('to-model')
    expect(withDeclaredRefusal('fast-WRONG', { kind: 'undo' })).toBe('fast-WRONG')
  })
})
