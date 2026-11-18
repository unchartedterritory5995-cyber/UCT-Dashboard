// MOST's pure model: what each column says in each session, and that a missing value is a dash,
// never a zero that sorts or filters as if it were real.
import { describe, it, expect } from 'vitest'
import {
  MAX_NAMES, MAX_SOURCES, SESSION_COPY, SESSIONS, buildRows, catalystLabel, catalystSources, defaultSort, filterRows, liveSymbols,
  parsePct, ratingWords, sortRows,
} from './moversModel'

const MOVERS = {
  ripping: [{ sym: 'AAA', pct: '+12.50%' }, { sym: 'bbb', pct: '+4.00%' }],
  drilling: [{ sym: 'CCC', pct: '-8.25%' }],
}
const CATALYSTS = { rows: [
  { ticker: 'AAA', tag: 'Earnings', thesis_text: 'Beat and raised.', gap_pct: 11, vol_x: 6.5, price: 50, catalyst_at: 1760000000 },
  { ticker: 'DDD', catalyst_type: 'FDA', thesis_text: 'Approval.', gap_pct: 2.1, vol_x: 0, price: 9 },
] }
const VOLUME = { active: true, rows: [
  { sym: 'AAA', price: 51, pct: 12, rvol: 4, rvol_day: 3.2, lit: true },
  { sym: 'EEE', price: 30, pct: -1, rvol: 5, rvol_day: 2.5, lit: true },
  { sym: 'ZZZ', price: 10, pct: 0.2, rvol: 1.1, rvol_day: 0.9, lit: false },
] }
const by = (rows) => Object.fromEntries(rows.map((r) => [r.sym, r]))

describe('parsePct', () => {
  it('reads the movers strings and plain numbers; junk is null, not zero', () => {
    expect(parsePct('+34.40%')).toBe(34.4)
    expect(parsePct('-3.1%')).toBe(-3.1)
    expect(parsePct(2.5)).toBe(2.5)
    expect(parsePct('')).toBeNull()
    expect(parsePct('n/a')).toBeNull()
    expect(parsePct(undefined)).toBeNull()
  })
})

describe('buildRows', () => {
  it('merges the three lists by symbol and names where each row came from', () => {
    const rows = by(buildRows({ movers: MOVERS, catalysts: CATALYSTS, volume: VOLUME, prices: {}, session: 'regular' }))
    expect(Object.keys(rows).sort()).toEqual(['AAA', 'BBB', 'CCC', 'DDD', 'EEE'])
    expect(rows.AAA.lists.sort()).toEqual(['catalysts', 'movers', 'volume'])
    expect(rows.EEE.lists).toEqual(['volume'])
    // a name the scanner merely tracks (not lit) and nothing else mentions is not a mover
    expect(rows.ZZZ).toBeUndefined()
  })

  it('regular session: the live store wins for last and %; volume vs average prefers the scanner', () => {
    const prices = { AAA: { price: 52.1, change_pct: 13.2, volume: 4_200_000 } }
    const { AAA, DDD, BBB } = by(buildRows({ movers: MOVERS, catalysts: CATALYSTS, volume: VOLUME, prices, session: 'regular' }))
    expect(AAA).toMatchObject({ last: 52.1, pct: 13.2, volume: 4_200_000, volVsAvg: 3.2, volSource: 'scanner', lit: true })
    expect(AAA.catalyst).toEqual({
      label: 'Earnings', thesis: 'Beat and raised.', at: 1760000000 * 1000, writtenAt: null, sources: { list: [], more: 0 }, rating: null,
    })
    // DDD: no live price, no scanner — falls back to the catalyst board; vol_x 0 is unknown, not 0×
    expect(DDD).toMatchObject({ last: 9, pct: 2.1, volVsAvg: null, volSource: null })
    expect(DDD.catalyst.label).toBe('FDA')
    // BBB: only the movers list — % from it, everything else honestly absent
    expect(BBB).toMatchObject({ last: null, pct: 4, volume: null, volVsAvg: null, catalyst: null })
  })

  it('pre-market: last is the pre-market print and % is measured against yesterday\'s close', () => {
    const prices = { AAA: { price: 45, change_pct: 0, prev_close: 40, ext_price: 50, ext_session: 'pre', volume: 90_000 } }
    const { AAA, CCC } = by(buildRows({ movers: MOVERS, catalysts: CATALYSTS, volume: VOLUME, prices, session: 'pre' }))
    expect(AAA.last).toBe(50)
    expect(AAA.pct).toBeCloseTo(25)
    // CCC has no pre-market print: the movers list's own % stands, and no regular-session price poses as one
    expect(CCC).toMatchObject({ last: null, pct: -8.25 })
  })

  it('CONTROL: an ext print from the OTHER session is not read as this session\'s', () => {
    const prices = { AAA: { price: 45, prev_close: 40, ext_price: 50, ext_session: 'post' } }
    const { AAA } = by(buildRows({ movers: MOVERS, prices, session: 'pre' }))
    expect(AAA.last).toBeNull()
    expect(AAA.pct).toBe(12.5)
  })

  it('after hours: % is the regular session and the after-hours move is its own column', () => {
    const prices = { AAA: { price: 40, change_pct: 10, day_close: 40, ext_price: 42, ext_session: 'post' } }
    const { AAA, CCC } = by(buildRows({ movers: MOVERS, prices, session: 'post' }))
    expect(AAA).toMatchObject({ last: 40, pct: 10 })
    expect(AAA.ah).toBeCloseTo(5)
    expect(CCC.ah).toBeNull()
  })

  it('every session has copy, and only the regular session claims to be live', () => {
    for (const s of SESSIONS) expect(SESSION_COPY[s].basis.length).toBeGreaterThan(20)
    expect(SESSIONS.filter((s) => SESSION_COPY[s].badge === 'Live')).toEqual(['regular'])
    expect(SESSION_COPY.closed.badge).toBe('Last session')
  })
})

describe('filters and sort', () => {
  const rows = buildRows({
    movers: MOVERS, catalysts: CATALYSTS, volume: VOLUME, session: 'regular',
    prices: { AAA: { price: 52, change_pct: 13, volume: 5e6 }, CCC: { price: 3, change_pct: -8, volume: 2e5 } },
  })

  it('lenses cut by direction and by the scanner\'s lit flag', () => {
    expect(filterRows(rows, { lens: 'up' }).map((r) => r.sym).sort()).toEqual(['AAA', 'BBB', 'DDD'])
    expect(filterRows(rows, { lens: 'down' }).map((r) => r.sym).sort()).toEqual(['CCC', 'EEE'])
    expect(filterRows(rows, { lens: 'volume' }).map((r) => r.sym).sort()).toEqual(['AAA', 'EEE'])
    expect(filterRows(rows, { lens: 'all' })).toHaveLength(rows.length)
  })

  it('a price or volume floor drops names below it AND names with no value to compare', () => {
    expect(filterRows(rows, { minPrice: 5 }).map((r) => r.sym).sort()).toEqual(['AAA', 'DDD', 'EEE'])
    expect(filterRows(rows, { minVolume: 1e6 }).map((r) => r.sym)).toEqual(['AAA'])
  })

  it('sorts either way, and a missing value always sinks to the bottom', () => {
    const desc = sortRows(rows, { key: 'volume', dir: 'desc' }).map((r) => r.sym)
    const asc = sortRows(rows, { key: 'volume', dir: 'asc' }).map((r) => r.sym)
    expect(desc.slice(0, 2)).toEqual(['AAA', 'CCC'])
    expect(asc.slice(0, 2)).toEqual(['CCC', 'AAA'])
    expect(desc.slice(2)).toEqual(asc.slice(2))   // the unknowns, in the same (symbol) order both ways
    expect(sortRows(rows, { key: 'pct', dir: 'asc' })[0].sym).toBe('CCC')
    expect(sortRows(rows, { key: 'absPct', dir: 'desc' })[0].sym).toBe('AAA')
  })

  it('each lens has a default sort that leads with its own extreme', () => {
    expect(defaultSort('up')).toEqual({ key: 'pct', dir: 'desc' })
    expect(defaultSort('down')).toEqual({ key: 'pct', dir: 'asc' })
    expect(defaultSort('volume')).toEqual({ key: 'volVsAvg', dir: 'desc' })
    expect(defaultSort('all')).toEqual({ key: 'absPct', dir: 'desc' })
  })
})

describe('liveSymbols / catalystLabel', () => {
  it('subscribes the movers, catalysts and LIT scanner names once each, capped', () => {
    expect(liveSymbols({ movers: MOVERS, catalysts: CATALYSTS, volume: VOLUME })).toEqual(['AAA', 'BBB', 'CCC', 'DDD', 'EEE'])
    const many = { ripping: Array.from({ length: MAX_NAMES + 20 }, (_, i) => ({ sym: `S${i}`, pct: '+5%' })) }
    expect(liveSymbols({ movers: many })).toHaveLength(MAX_NAMES)
    expect(liveSymbols({})).toEqual([])
  })

  it('a catalyst says its type, else its tag, else nothing', () => {
    // the board's own type says what happened; its tag only says which bucket the name was filed under
    expect(catalystLabel({ tag: 'Catalyst', catalyst_type: 'FDA' })).toBe('FDA')
    expect(catalystLabel({ tag: 'Gapper', catalyst_type: ' M&A ' })).toBe('M&A')
    expect(catalystLabel({ catalyst_type: 'FDA' })).toBe('FDA')
    // "None" is the board saying it named no type: the tag stands, never the word None
    expect(catalystLabel({ tag: 'Gapper', catalyst_type: 'None' })).toBe('Gapper')
    expect(catalystLabel({ tag: 'Earnings', catalyst_type: '' })).toBe('Earnings')
    expect(catalystLabel({ tag: 'News', catalyst_type: 7 })).toBe('News')
    expect(catalystLabel({ catalyst_type: 'none' })).toBeNull()
    expect(catalystLabel({})).toBeNull()
    expect(catalystLabel(null)).toBeNull()
  })

  it('catalystSources: the links a write-up cites, http(s) only, each once, capped and counted', () => {
    const raw = JSON.stringify(['https://www.reuters.com/a', 'http://sec.gov/b?x=1', 'https://www.reuters.com/a', 'javascript:alert(1)', 'not a link', 5, ''])
    expect(catalystSources(raw)).toEqual({
      list: [{ url: 'https://www.reuters.com/a', host: 'reuters.com' }, { url: 'http://sec.gov/b?x=1', host: 'sec.gov' }],
      more: 0,
    })
    // the list itself (already parsed) reads the same as its JSON text
    expect(catalystSources(['https://a.example/1']).list).toEqual([{ url: 'https://a.example/1', host: 'a.example' }])
    const many = Array.from({ length: MAX_SOURCES + 3 }, (_, i) => `https://s${i}.example/x`)
    expect(catalystSources(many).list).toHaveLength(MAX_SOURCES)
    expect(catalystSources(many).more).toBe(3)
    // unreadable is no sources, never a guess
    for (const bad of [null, undefined, '', '[]', 'x', '{"a":1}', 12, {}]) expect(catalystSources(bad)).toEqual({ list: [], more: 0 })
  })

  it('ratingWords: the analyst action with its firm and its date, each only when it was sent', () => {
    expect(ratingWords({ action: 'upgrade', company: 'Morgan Stanley', from_grade: 'Equal-Weight', to_grade: 'Overweight', date: '2026-11-17' }))
      .toBe('Upgrade by Morgan Stanley, Equal-Weight to Overweight, 2026-11-17')
    expect(ratingWords({ action: 'INITIATE', company: 'Jefferies', to_grade: 'Buy', date: '2026-11-17T08:00:00' })).toBe('Initiate by Jefferies, to Buy, 2026-11-17')
    expect(ratingWords({ action: 'downgrade' })).toBe('Downgrade')
    expect(ratingWords({ action: 'downgrade', from_grade: 'Buy', date: 'soon' })).toBe('Downgrade')
    for (const none of [null, undefined, {}, { company: 'X' }, 'upgrade', { action: '' }]) expect(ratingWords(none)).toBeNull()
  })

  it('buildRows carries the write-up\'s time, its sources and the analyst action for a listed name', () => {
    const [row] = buildRows({
      movers: { ripping: [{ sym: 'AAA', pct: '+12.50%' }], drilling: [] },
      catalysts: { rows: [{
        ticker: 'AAA', tag: 'Catalyst', catalyst_type: 'Analyst', thesis_text: 'Upgraded.', catalyst_at: 1760000000, thesis_at: 1760000600,
        thesis_sources: '["https://www.example.com/note"]', rating_change: { action: 'upgrade', company: 'Acme Research', to_grade: 'Buy', date: '2026-11-18' },
      }] },
    })
    expect(row.catalyst).toEqual({
      label: 'Analyst', thesis: 'Upgraded.', at: 1760000000 * 1000, writtenAt: 1760000600 * 1000,
      sources: { list: [{ url: 'https://www.example.com/note', host: 'example.com' }], more: 0 },
      rating: 'Upgrade by Acme Research, to Buy, 2026-11-18',
    })
  })
})
