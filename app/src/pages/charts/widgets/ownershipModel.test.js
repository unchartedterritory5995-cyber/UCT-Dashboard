// ownershipModel: the row model the Charts ownership dock and the research Ownership tab share.
// These pin where each row reads from in the ownership answer (`/api/research/ownership/{sym}`).
import { describe, it, expect } from 'vitest'
import { holdersByOwnership, positioningFacts, snapshotFacts, topHolders } from './ownershipModel'

const TF = {
  quarter: '2026Q3',
  summary: { ownership_pct: 63.46 },
  holders: [
    { name: 'BlackRock', shares: 1.1e9, change_shares: -1e8, change_pct: -8.3, ownership: 7.0, market_value: 2.7e11 },
    { name: 'Vanguard', shares: 1.3e9, change_shares: 2e7, change_pct: 1.5, ownership: 8.4, market_value: 3.2e11 },
    { name: 'NewCo', shares: 5e8, change_shares: 5e8, ownership: 3.0, market_value: 1.2e11, is_new: true },
    { name: 'Gone LP', shares: 0, change_shares: -4e6, ownership: 0, market_value: 0, is_sold_out: true },
    { name: 'Still LP', shares: 9e6, change_shares: 0, ownership: null, market_value: 2e9 },
  ],
}
const SHORT_OK = {
  state: 'ok', shares_short: 50_000_000, short_pct_float: 0.74, days_to_cover: 1.85,
  settlement_date: '2026-10-30', prior_short: 48_000_000, prior_settlement_date: '2026-10-15',
}

describe('topHolders: the Form 13F holder list is the only holders source', () => {
  it('maps the 13F holders, with the change the filing carries', () => {
    const out = topHolders({ thirteen_f: TF })
    expect(out.source).toBe('13f')
    expect(out.hasChange).toBe(true)
    expect(out.quarterLabel).toBe('Q3 2026')
    expect(out.rows.map((r) => [r.name, r.state])).toEqual([
      ['BlackRock', 'reduced'], ['Vanguard', 'increased'], ['NewCo', 'new'], ['Gone LP', 'exited'], ['Still LP', 'unchanged'],
    ])
    expect(out.rows[1]).toMatchObject({ shares: 1.3e9, value: 3.2e11, ownership: 8.4, changeShares: 2e7, changePct: 1.5 })
  })

  it('no 13F holders is null: a holders table outside the 13F block is never read', () => {
    const legacy = { institutional: { pct_held: 61, holders: [{ holder: 'Old Table Co', shares: 1, pct_out: 9.9, value: 1 }] } }
    expect(topHolders(legacy)).toBeNull()
    expect(topHolders({ ...legacy, thirteen_f: { quarter: '2026Q3', summary: {}, holders: [] } })).toBeNull()
    expect(topHolders(null)).toBeNull()
  })

  it('holdersByOwnership ranks the holders that carry a percent, largest first, cut to the limit', () => {
    expect(holdersByOwnership({ thirteen_f: TF }).map((r) => r.name)).toEqual(['Vanguard', 'BlackRock', 'NewCo', 'Gone LP'])
    expect(holdersByOwnership({ thirteen_f: TF }, 2).map((r) => r.name)).toEqual(['Vanguard', 'BlackRock'])
    expect(holdersByOwnership({})).toEqual([])
  })
})

describe('snapshot and positioning read the answer\'s own blocks', () => {
  it('the snapshot takes the institutional percent and the held report\'s percent of float', () => {
    const facts = snapshotFacts({ institutional: { pct_held: 63.46 }, short: SHORT_OK, share_counts: { float_shares: 1.48e10 } },
      { held_pct_insiders: 0.07 })
    expect(facts.map((f) => [f.key, f.value])).toEqual([
      ['inst', '63.5%'], ['insider', '0.1%'], ['short', '0.7%'], ['float', '14.80B'],
    ])
  })

  it('with no report held the snapshot has no short entry, and positioning says "not available" in one row', () => {
    const own = { institutional: { pct_held: null }, short: { state: 'not_held', shares_short: null, short_pct_float: null, days_to_cover: null },
      share_counts: { float_shares: 1.48e10, shares_outstanding: 1.5e10 } }
    expect(snapshotFacts(own, null).map((f) => f.key)).toEqual(['float'])
    const rows = positioningFacts(own)
    expect(rows.map((f) => [f.key, f.value])).toEqual([['float', '14.80B'], ['out', '15.00B'], ['shortna', 'not available']])
    expect(rows[2].hint).toContain('That is not the same as no short interest.')
    expect(rows[2].hint).toContain('SHINT')
    // a held report draws its rows and no "not available" row
    expect(positioningFacts({ ...own, short: SHORT_OK }).map((f) => f.key)).toEqual(['float', 'out', 'short', 'shortpct', 'dtc', 'shortchg'])
    // an answer with no short block at all (still loading, or an older record) adds nothing
    expect(positioningFacts({ share_counts: own.share_counts }).map((f) => f.key)).toEqual(['float', 'out'])
  })

  it('the short change is against the PREVIOUS FINRA report, and says so', () => {
    const rows = positioningFacts({ short: SHORT_OK, share_counts: { float_shares: 1.48e10, shares_outstanding: 1.5e10 } })
    const chg = rows.find((r) => r.key === 'shortchg')
    expect(chg.label).toBe('Short vs previous report')
    expect(chg.value).toBe('+4.2%')
    expect(chg.tone).toBe('down')                     // short interest rising is shown red
    expect(rows.find((r) => r.key === 'dtc').value).toBe('1.9')
  })

  it('a prior figure under the retired key is not read, so no change is invented', () => {
    const rows = positioningFacts({ short: { ...SHORT_OK, prior_short: null, prior_month_short: 40_000_000 },
      share_counts: { float_shares: 1.48e10, shares_outstanding: 1.5e10 } })
    expect(rows.find((r) => r.key === 'shortchg')).toBeUndefined()
  })
})
