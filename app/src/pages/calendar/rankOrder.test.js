// Regression rail for the "calendar loads alphabetical" defect (owner report
// 2026-08-14). The week/feed comparator used to be `mine desc || imp desc`,
// hand-copied into WeekView AND FeedView. Both keys collapse to 0 on first
// paint — `mine` is uniform under the My Stocks audience, and `imp` is 0 for
// EVERY name until the enrichment-batch + day-metrics-batch fetches land
// (zMap() bails to `() => 0` with fewer than 2 defined values). A comparator
// that returns 0 for every pair makes Array#sort a NO-OP, so the grid rendered
// the provider's own order — alphabetical — for the first seconds of every
// load, then visibly re-shuffled when the overlays arrived.
//
// The fix is a single shared comparator with a deterministic fallback chain,
// so ordering NEVER depends on the order the API happened to serialize.
import { describe, it, expect } from 'vitest'
import { rankEntries } from './importance'

const E = (sym, over = {}) => ({
  sym, ew: 0, mc_b: null, _avg_vol: null, _price: null,
  eps_est: null, rev_est: null, eps_act: null,
  expected_move: null, mine: false, _sources: [], ...over,
})

const syms = rows => rows.map(r => r.sym)

// `impBySym` is empty exactly as it is before the overlays land.
const NO_IMP = new Map()

describe('rankEntries — first paint, before enrichment lands', () => {
  it('ranks by market cap when no importance is available yet', () => {
    // Fed in the provider's alphabetical order, as /api/calendar serves them.
    const rows = [
      E('AAON', { mc_b: 8 }),
      E('AIRS', { mc_b: 0.5 }),
      E('FERG', { mc_b: 40 }),
    ]
    expect(syms(rankEntries(rows, NO_IMP))).toEqual(['FERG', 'AAON', 'AIRS'])
  })

  it('is not a no-op when every entry is "mine" (the My Stocks audience)', () => {
    // The exact shape of the owner's screenshot: 378 reporting, 378 mine.
    const rows = [
      E('AAON', { mc_b: 8, mine: true }),
      E('AIRS', { mc_b: 0.5, mine: true }),
      E('FERG', { mc_b: 40, mine: true }),
    ]
    expect(syms(rankEntries(rows, NO_IMP))).toEqual(['FERG', 'AAON', 'AIRS'])
  })

  it('falls back to anticipation (ew) when caps are absent or tied', () => {
    const rows = [
      E('AAA', { ew: 3 }),
      E('BBB', { ew: 900 }),
      E('CCC', { ew: 40 }),
    ]
    expect(syms(rankEntries(rows, NO_IMP))).toEqual(['BBB', 'CCC', 'AAA'])
  })

  it('sorts names with no ranking datum LAST, not interleaved', () => {
    const rows = [
      E('AAA'),                  // nothing at all
      E('BBB', { mc_b: 2 }),
      E('CCC'),                  // nothing at all
      E('DDD', { mc_b: 30 }),
    ]
    expect(syms(rankEntries(rows, NO_IMP))).toEqual(['DDD', 'BBB', 'AAA', 'CCC'])
  })

  it('is deterministic regardless of the order the API serialized', () => {
    const a = [E('AAON', { mc_b: 8 }), E('AIRS', { mc_b: 0.5 }), E('FERG', { mc_b: 40 })]
    const b = [E('FERG', { mc_b: 40 }), E('AAON', { mc_b: 8 }), E('AIRS', { mc_b: 0.5 })]
    const c = [E('AIRS', { mc_b: 0.5 }), E('FERG', { mc_b: 40 }), E('AAON', { mc_b: 8 })]
    expect(syms(rankEntries(a, NO_IMP))).toEqual(syms(rankEntries(b, NO_IMP)))
    expect(syms(rankEntries(b, NO_IMP))).toEqual(syms(rankEntries(c, NO_IMP)))
  })

  it('breaks a genuine full tie alphabetically — deliberately, as the LAST key', () => {
    const rows = [E('ZZZ', { mc_b: 5 }), E('AAA', { mc_b: 5 }), E('MMM', { mc_b: 5 })]
    expect(syms(rankEntries(rows, NO_IMP))).toEqual(['AAA', 'MMM', 'ZZZ'])
  })
})

describe('rankEntries — once importance has landed', () => {
  it('lets imp_eff outrank raw market cap', () => {
    const rows = [
      E('BIG',  { mc_b: 400 }),
      E('HOT',  { mc_b: 9 }),
    ]
    const imp = new Map([['BIG', 0.1], ['HOT', 3.0]])
    expect(syms(rankEntries(rows, imp))).toEqual(['HOT', 'BIG'])
  })

  it('still pins mine above a higher-imp name the user does not hold', () => {
    const rows = [
      E('THEIRS', { mc_b: 400 }),
      E('MINE',   { mc_b: 2, mine: true }),
    ]
    const imp = new Map([['THEIRS', 5.0], ['MINE', 0.0]])
    expect(syms(rankEntries(rows, imp))).toEqual(['MINE', 'THEIRS'])
  })

  it('applies the personal source boost on top of imp', () => {
    const rows = [
      E('WATCHED', { mc_b: 5, mine: true, _sources: ['watchlist'] }),
      E('HELD',    { mc_b: 5, mine: true, _sources: ['positions'] }),
    ]
    const imp = new Map([['WATCHED', 1.0], ['HELD', 0.5]])
    // positions (+3.0) beats watchlist (+2.0) despite the lower base imp.
    expect(syms(rankEntries(rows, imp))).toEqual(['HELD', 'WATCHED'])
  })

  it('does not mutate the array it was handed', () => {
    const rows = [E('AAON', { mc_b: 8 }), E('FERG', { mc_b: 40 })]
    const before = syms(rows)
    rankEntries(rows, NO_IMP)
    expect(syms(rows)).toEqual(before)
  })

  it('tolerates a missing impBySym entirely (tiers not computed yet)', () => {
    const rows = [E('AAON', { mc_b: 8 }), E('FERG', { mc_b: 40 })]
    expect(syms(rankEntries(rows, undefined))).toEqual(['FERG', 'AAON'])
  })
})
