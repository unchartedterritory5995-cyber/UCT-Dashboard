import { describe, it, expect } from 'vitest'
import { computeImportance, impEff, tierWeek, editorialLine, hasDatum, FEATURED_CAP } from './importance'

const E = (sym, over = {}) => ({
  sym, ew: 0, mc_b: null, _avg_vol: null, _price: null,
  eps_est: null, rev_est: null, eps_act: null,
  expected_move: null, beat_history: [], hist_stats: null,
  mine: false, _sources: [], ...over,
})

const week = (dayMap) => {
  const weekDates = Object.keys(dayMap).sort()
  const days = {}
  for (const ds of weekDates) {
    days[ds] = { bmo: dayMap[ds].bmo || [], amc: dayMap[ds].amc || [], tbd: dayMap[ds].tbd || [] }
  }
  return { days, weekDates }
}

describe('computeImportance', () => {
  it('ranks a megacap with anticipation above a bare microcap', () => {
    const entries = [
      E('PEP',  { ew: 500, mc_b: 231, _avg_vol: 5e6, _price: 170, eps_est: 2.2, expected_move: { pct: 5 } }),
      E('TINY', { ew: 0,   mc_b: 0.4, _avg_vol: 5e4, _price: 4 }),
      E('MID',  { ew: 20,  mc_b: 8,   _avg_vol: 1e6, _price: 40, eps_est: 1.0 }),
    ]
    const imp = computeImportance(entries)
    expect(imp.get('PEP')).toBeGreaterThan(imp.get('MID'))
    expect(imp.get('MID')).toBeGreaterThan(imp.get('TINY'))
  })

  it('missing fields contribute zero — never NaN', () => {
    const imp = computeImportance([E('A'), E('B', { mc_b: 5 }), E('C', { mc_b: 50 })])
    for (const v of imp.values()) expect(Number.isFinite(v)).toBe(true)
  })
})

describe('impEff', () => {
  it('boosts positions > watchlist > uct20, additively', () => {
    expect(impEff(0, E('X', { _sources: ['positions'] }))).toBe(3)
    expect(impEff(0, E('X', { _sources: ['watchlist'] }))).toBe(2)
    expect(impEff(0, E('X', { _sources: ['flagged'] }))).toBe(2)
    expect(impEff(0, E('X', { _sources: ['uct20'] }))).toBe(1)
    expect(impEff(0, E('X', { _sources: ['positions', 'watchlist', 'uct20'] }))).toBe(6)
    // watchlist+flagged is ONE +2 boost, not two
    expect(impEff(0, E('X', { _sources: ['watchlist', 'flagged'] }))).toBe(2)
  })
})

describe('tierWeek', () => {
  it('assigns exactly one Main Event to the heavyweight day and none to a quiet day', () => {
    const { days, weekDates } = week({
      '2026-07-13': { bmo: [E('TINY1', { eps_est: 0.1, mc_b: 0.5 })] },
      '2026-07-16': { bmo: [
        E('PEP', { ew: 500, mc_b: 231, _avg_vol: 5e6, _price: 170, eps_est: 2.2, expected_move: { pct: 5 } }),
        E('MID1', { ew: 10, mc_b: 3, eps_est: 1 }),
        E('MID2', { ew: 5, mc_b: 2, eps_est: 1 }),
        E('MID3', { ew: 2, mc_b: 1, eps_est: 1 }),
        E('MID4', { ew: 1, mc_b: 1, eps_est: 1 }),
        E('MID5', { ew: 0, mc_b: 0.8, eps_est: 1 }),
      ] },
    })
    const tiers = tierWeek(days, weekDates)
    expect(tiers['2026-07-16'].mainEvent).toBe('PEP')
    // The quiet Monday's only name sits below the week P75 — no Main Event
    expect(tiers['2026-07-13'].mainEvent).toBe(null)
  })

  it('zero-data names go compact; mine names never do', () => {
    const { days, weekDates } = week({
      '2026-07-16': { bmo: [
        E('BIG', { ew: 100, mc_b: 50, eps_est: 2 }),
        E('NODATA'),
        E('MINE_NODATA', { mine: true, _sources: ['watchlist'] }),
      ] },
    })
    const t = tierWeek(days, weekDates)['2026-07-16']
    expect(t.compact.has('NODATA')).toBe(true)
    expect(t.compact.has('MINE_NODATA')).toBe(false)
    // mine keeps a card (featured) even data-thin
    expect(t.featured.has('MINE_NODATA')).toBe(true)
  })

  it('sub-$2B names WITH data stay in the table — never hidden (review fix)', () => {
    const { days, weekDates } = week({
      '2026-07-16': { bmo: [
        E('BIG1', { ew: 90, mc_b: 100, eps_est: 1 }),
        E('BIG2', { ew: 80, mc_b: 90, eps_est: 1 }),
        E('BIG3', { ew: 70, mc_b: 80, eps_est: 1 }),
        E('BIG4', { ew: 60, mc_b: 70, eps_est: 1 }),
        E('BIG5', { ew: 50, mc_b: 60, eps_est: 1 }),
        E('SMALL', { ew: 0, mc_b: 1.5, eps_est: 0.31, rev_est: 55 }),
      ] },
    })
    const t = tierWeek(days, weekDates)['2026-07-16']
    expect(t.table.has('SMALL')).toBe(true)
    expect(t.compact.has('SMALL')).toBe(false)
  })

  it('featured is hard-capped per day including the Main Event', () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      E(`BIG${i}`, { ew: 100 - i, mc_b: 200 - i, eps_est: 1 }))
    const { days, weekDates } = week({ '2026-07-16': { bmo: entries } })
    const t = tierWeek(days, weekDates)['2026-07-16']
    const cardCount = (t.mainEvent ? 1 : 0) + t.featured.size
    expect(cardCount).toBeLessThanOrEqual(FEATURED_CAP)
  })

  it('tbd entries participate in tiering', () => {
    const { days, weekDates } = week({
      '2026-07-16': { tbd: [E('WAFD', { eps_est: 0.83, mc_b: 3 })], bmo: [E('X', { eps_est: 1, mc_b: 1 })] },
    })
    const t = tierWeek(days, weekDates)['2026-07-16']
    expect(t.table.has('WAFD') || t.featured.has('WAFD') || t.mainEvent === 'WAFD').toBe(true)
  })
})

describe('editorialLine', () => {
  it('composes only from present fields — never fabricates', () => {
    const full = E('PEP', {
      mc_b: 231,
      expected_move: { pct: 5.2 },
      hist_stats: { avg_abs_move: 3.1 },
      beat_history: [{ beat: true }, { beat: true }, { beat: false }, { beat: true }],
    })
    const line = editorialLine(full, true)
    expect(line).toContain('Largest report of the day ($231B)')
    expect(line).toContain('options price a ±5.2% swing')
    expect(line).toContain('typically moves ±3.1%')
    expect(line).toContain('beat 3 of last 4')

    expect(editorialLine(E('X'), false)).toBe('')
    const emOnly = editorialLine(E('X', { expected_move: { pct: 8 } }), false)
    expect(emOnly).toBe('options price a ±8% swing')
  })
})

describe('hasDatum', () => {
  it('any of est/act/EM counts; nothing → false', () => {
    expect(hasDatum(E('A', { eps_est: 1 }))).toBe(true)
    expect(hasDatum(E('A', { rev_est: 10 }))).toBe(true)
    expect(hasDatum(E('A', { eps_act: 1 }))).toBe(true)
    expect(hasDatum(E('A', { expected_move: { pct: 3 } }))).toBe(true)
    expect(hasDatum(E('A'))).toBe(false)
  })
})
