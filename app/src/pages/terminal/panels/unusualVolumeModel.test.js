// UNVOL, the pure half. Rails:
//   * the scan body is pinned whole: the reading asked for, the floors, the direction, the order,
//     the columns, one page; the probe asks one row at the base picks whatever the chips say;
//   * the typed words, the defaults and what a pick writes into the command;
//   * the view: rows in the server's order, a row with no reading for the mode left out and
//     counted (never 0×), the total, when the by-now reading was worked out, which session the
//     last-session reading describes, and whether prices are live while volumes are not;
//   * a body that is not a scan answer is a failed read, never an empty list;
//   * "moving" is a reading under five minutes old; the multiple's text.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_UNVOL_MIN, DEFAULT_UNVOL_SIDE, UNUSUAL_VOLUME_CODE, UNVOL_COLUMNS_READ, UNVOL_FLOORS, UNVOL_LIVE_FRESH_MS, UNVOL_MINS,
  UNVOL_MIN_ARG_WORDS, UNVOL_MODES, UNVOL_PAGE_SIZE, UNVOL_SIDES, UNVOL_SIDE_ARG_WORDS, multipleText, normUnvolMin, normUnvolSide,
  parseUnvolMin, parseUnvolSide, unvolCommandArgs, unvolIsMoving, unvolScanBody, unvolView,
} from './unusualVolumeModel'

// `app/src/pages/terminal/panels/` is FIVE levels below the repo root. The server's suite
// (tests/test_terminal_unusual_volume_scan.py) runs every body in this file through the real scan.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const SERVER_REQUESTS = JSON.parse(fs.readFileSync(
  path.join(HERE, '..', '..', '..', '..', '..', 'tests', 'fixtures', 'terminal_unvol_scan_requests.json'), 'utf8')).requests

const AT = Date.parse('2026-11-18T15:42:00Z') / 1000   // 10:42 AM ET
const row = (over = {}) => ({
  ticker: 'ZZA', company: 'Zeta Alpha Corp', price: 41.2, chg_pct_1d: 6.4, rvol_live: 4.23, vol_ratio: 1.1,
  avg_volume_30d: 2_400_000, industry: 'Semiconductors', bars_asof: 20261117, live_row: 1, live_asof: AT, ...over,
})
const answer = (rows, over = {}) => ({ total: rows.length, rows, snapshot_date: '20261118', snapshot: { snapshot_date: '20261118' }, ...over })

describe('UNVOL scan body', () => {
  it('the by-now reading: rvol_live at 2× or more, the floors, stocks only, highest first, one page', () => {
    expect(unvolScanBody('now')).toEqual({
      filters: [
        { key: 'rvol_live', op: 'gte', min: 2 },
        { key: 'price', op: 'gte', min: 5 },
        { key: 'dollar_vol_30d', op: 'gte', min: 10_000_000 },
        { key: 'security_type', op: 'not_in', values: ['ETF'] },
      ],
      sort: { key: 'rvol_live', dir: 'desc' },
      view: 'technical',
      columns: ['company', 'price', 'chg_pct_1d', 'rvol_live', 'vol_ratio', 'avg_volume_30d', 'industry', 'bars_asof'],
      page: 1,
      page_size: 100,
    })
    expect(UNVOL_PAGE_SIZE).toBe(100)
    expect(UNVOL_FLOORS).toEqual({ price: 5, dollarVol30d: 10_000_000 })
    expect(UNVOL_MODES).toEqual({ now: { key: 'rvol_live' }, last: { key: 'vol_ratio' } })
    expect(UNUSUAL_VOLUME_CODE).toBe('UNVOL')
  })

  it('the last-session reading swaps ONLY the volume column: vol_ratio in the filter and the order', () => {
    const now = unvolScanBody('now', { side: 'up', min: 3 })
    const last = unvolScanBody('last', { side: 'up', min: 3 })
    expect(last.filters[0]).toEqual({ key: 'vol_ratio', op: 'gte', min: 3 })
    expect(last.sort).toEqual({ key: 'vol_ratio', dir: 'desc' })
    expect(last.filters.slice(1)).toEqual(now.filters.slice(1))
    expect(last.columns).toEqual(now.columns)
    // an unknown mode is the by-now reading, never a third thing
    expect(unvolScanBody('nope').filters[0].key).toBe('rvol_live')
  })

  it('the direction is a rule on the day change, and the multiple is the first rule\'s floor', () => {
    expect(unvolScanBody('now', { side: 'up' }).filters.at(-1)).toEqual({ key: 'chg_pct_1d', op: 'gt', min: 0 })
    expect(unvolScanBody('now', { side: 'down' }).filters.at(-1)).toEqual({ key: 'chg_pct_1d', op: 'lt', max: 0 })
    expect(unvolScanBody('now', { side: 'all' }).filters).toHaveLength(4)
    expect(unvolScanBody('now', { min: 5 }).filters[0].min).toBe(5)
    // a pick the panel does not offer falls back to the default, never reaches the server as typed
    expect(unvolScanBody('now', { side: 'sideways', min: 7 }).filters).toEqual(unvolScanBody('now').filters)
    // each body is its own object: one read cannot edit another's columns
    expect(unvolScanBody('now').columns).not.toBe(UNVOL_COLUMNS_READ)
  })

  it('every body is one the server suite runs through the real scan (the shared fixture)', () => {
    expect(SERVER_REQUESTS.length).toBeGreaterThanOrEqual(6)
    expect(new Set(SERVER_REQUESTS.map((r) => r.mode))).toEqual(new Set(['now', 'last']))
    expect(SERVER_REQUESTS.some((r) => r.picks.probe)).toBe(true)
    for (const r of SERVER_REQUESTS) expect(unvolScanBody(r.mode, r.picks), r.name).toEqual(r.body)
  })

  it('the probe asks one row at the base picks, whatever the chips say', () => {
    const probe = unvolScanBody('now', { side: 'down', min: 5, probe: true })
    expect(probe.filters).toEqual(unvolScanBody('now').filters)
    expect(probe.page_size).toBe(1)
    expect(probe.sort).toEqual({ key: 'rvol_live', dir: 'desc' })
  })
})

describe('UNVOL words', () => {
  it('the typed words, the defaults and the command arguments', () => {
    expect([DEFAULT_UNVOL_SIDE, DEFAULT_UNVOL_MIN]).toEqual(['all', 2])
    expect(['up', 'GAINERS', 'green', 'down', 'DN', 'losers', 'RED'].map(parseUnvolSide)).toEqual(['up', 'up', 'up', 'down', 'down', 'down', 'down'])
    expect(['2x', '2', '3X', 3, '5x', '5'].map(parseUnvolMin)).toEqual([2, 2, 3, 3, 5, 5])
    for (const t of ['', null, undefined, 'NVDA', 'toString', '4X', '10', 'ALL']) {
      expect(parseUnvolSide(t), String(t)).toBeNull()
      expect(parseUnvolMin(t), String(t)).toBeNull()
    }
    expect([normUnvolSide('up'), normUnvolSide('LOSERS'), normUnvolSide(null), normUnvolSide('nope')]).toEqual(['up', 'down', 'all', 'all'])
    expect([normUnvolMin(3), normUnvolMin('5X'), normUnvolMin(null), normUnvolMin(4), normUnvolMin('toString')]).toEqual([3, 5, 2, 2, 2])
    expect(unvolCommandArgs()).toEqual([])
    expect(unvolCommandArgs({ side: 'all', min: 2 })).toEqual([])
    expect(unvolCommandArgs({ side: 'up' })).toEqual(['UP'])
    expect(unvolCommandArgs({ side: 'down', min: 5 })).toEqual(['DOWN', '5X'])
    expect(unvolCommandArgs({ min: 3 })).toEqual(['3X'])
  })

  it('every word a chip writes is read back to the same pick, and no word is in both maps', () => {
    for (const [key, s] of Object.entries(UNVOL_SIDES)) if (s.token) expect(parseUnvolSide(s.token)).toBe(key)
    for (const [key, m] of Object.entries(UNVOL_MINS)) if (m.token) expect(parseUnvolMin(m.token)).toBe(Number(key))
    expect(UNVOL_SIDES[DEFAULT_UNVOL_SIDE].token).toBeNull()
    expect(UNVOL_MINS[DEFAULT_UNVOL_MIN].token).toBeNull()
    const words = [...Object.keys(UNVOL_SIDE_ARG_WORDS), ...Object.keys(UNVOL_MIN_ARG_WORDS)]
    expect(new Set(words).size).toBe(words.length)
    for (const v of Object.values(UNVOL_SIDE_ARG_WORDS)) expect(Object.keys(UNVOL_SIDES)).toContain(v)
    for (const v of Object.values(UNVOL_MIN_ARG_WORDS)) expect(Object.keys(UNVOL_MINS)).toContain(String(v))
  })
})

describe('UNVOL view', () => {
  it('by now: rows in the server\'s order with the live reading, and when it was worked out', () => {
    const v = unvolView(answer([
      row(),
      row({ ticker: 'zzb', company: '', rvol_live: 3.1, chg_pct_1d: -2.25, price: 12.5, industry: null, live_asof: AT - 30 }),
    ], { total: 240 }), 'now')
    expect(v.ok).toBe(true)
    expect(v.rows).toEqual([
      { sym: 'ZZA', company: 'Zeta Alpha Corp', multiple: 4.23, chgPct: 6.4, price: 41.2, avgVol: 2_400_000, industry: 'Semiconductors', order: 0 },
      { sym: 'ZZB', company: null, multiple: 3.1, chgPct: -2.25, price: 12.5, avgVol: 2_400_000, industry: null, order: 1 },
    ])
    expect(v.total).toBe(240)                                  // the rows are one page of the 240 that matched
    expect(v.liveAt).toBe('2026-11-18T15:42:00.000Z')          // the NEWEST stamp on the page
    expect(v.session).toBeNull()
    expect(v.pricesLive).toBe(false)                           // only said for the last-session reading
    expect(v.unread).toBe(0)
  })

  it('a row with no reading for the mode is left out and counted, never drawn as 0×', () => {
    const v = unvolView(answer([row(), row({ ticker: 'ZZC', rvol_live: null }), row({ ticker: 'ZZD', rvol_live: 0 }), row({ ticker: 'ZZE', rvol_live: '4' })]), 'now')
    expect(v.rows.map((r) => r.sym)).toEqual(['ZZA'])
    expect(v.unread).toBe(3)
    // the same answer read as the last session keeps every row that has THAT reading
    expect(unvolView(answer([row(), row({ ticker: 'ZZC', rvol_live: null, vol_ratio: 2.6 })]), 'last').rows.map((r) => [r.sym, r.multiple]))
      .toEqual([['ZZA', 1.1], ['ZZC', 2.6]])
  })

  it('a repeated or ticker-less row is dropped; a missing price, change or average is "not known", never 0', () => {
    const v = unvolView(answer([row({ ticker: 'aaa' }), row({ ticker: 'AAA', rvol_live: 9 }), row({ ticker: '' }), null,
      row({ ticker: 'BBB', price: 0, chg_pct_1d: null, avg_volume_30d: '1000', company: 5 })]), 'now')
    expect(v.rows.map((r) => [r.sym, r.multiple])).toEqual([['AAA', 4.23], ['BBB', 4.23]])
    expect(v.rows[1]).toMatchObject({ price: null, chgPct: null, avgVol: null, company: null })
  })

  it('by now with no stamp on the rows falls back to the overlay\'s own as-of, and to none when it sent none', () => {
    const bare = [row({ live_asof: null }), row({ ticker: 'ZZB', live_row: 0, live_asof: AT })]
    expect(unvolView(answer(bare, { snapshot: { live: { as_of: AT - 60 } } }), 'now').liveAt).toBe('2026-11-18T15:41:00.000Z')
    expect(unvolView(answer(bare), 'now').liveAt).toBeNull()
    expect(unvolView(answer(bare, { snapshot: { live: { as_of: '15:41:00 ET' } } }), 'now').liveAt).toBeNull()   // a string is not parsed into a time
    // an empty page has no reading to date, whatever the overlay says about itself
    expect(unvolView(answer([], { snapshot: { live: { as_of: AT } } }), 'now').liveAt).toBeNull()
  })

  it('last session: the session most rows describe, and whether prices are today\'s while volumes are not', () => {
    const rows = [
      row({ vol_ratio: 6.2, live_row: 0, live_asof: null }),
      row({ ticker: 'ZZB', vol_ratio: 3.4, live_row: 0, live_asof: null }),
      row({ ticker: 'ZZC', vol_ratio: 2.2, bars_asof: 20261114, live_row: 0, live_asof: null }),
    ]
    const v = unvolView(answer(rows), 'last')
    expect(v.rows.map((r) => [r.sym, r.multiple])).toEqual([['ZZA', 6.2], ['ZZB', 3.4], ['ZZC', 2.2]])
    expect(v.session).toBe('2026-11-17')
    expect(v.liveAt).toBeNull()
    expect(v.pricesLive).toBe(false)
    expect(unvolView(answer([row({ vol_ratio: 6.2 })]), 'last').pricesLive).toBe(true)
    // no row dates itself: the session before the build date (a Wednesday build describes Tuesday)
    expect(unvolView(answer([row({ vol_ratio: 6.2, bars_asof: null })]), 'last').session).toBe('2026-11-17')
    expect(unvolView({ total: 1, rows: [row({ vol_ratio: 6.2, bars_asof: null })] }, 'last').session).toBeNull()
  })

  it('a body that is not a scan answer is a failed read; an empty page is an empty list; the receipt rides along', () => {
    for (const body of [null, undefined, [], 'x', {}, { detail: 'bad column' }, { rows: 'no' }]) expect(unvolView(body, 'now').ok).toBe(false)
    expect(unvolView({ total: 0, rows: [], snapshot_date: '20261118' }, 'now')).toEqual({
      ok: true, rows: [], total: 0, unread: 0, liveAt: null, session: null, pricesLive: false, coverage: null,
    })
    const coverage = { evaluated: 10, answered: 9, dropped: 0, not_computable: 1, dropped_symbols: [] }
    expect(unvolView(answer([row()], { coverage }), 'now').coverage).toBe(coverage)
    // a total smaller than the page is not believed over the rows on the page
    expect(unvolView(answer([row(), row({ ticker: 'ZZB' })], { total: 1 }), 'now').total).toBe(2)
  })
})

describe('UNVOL small helpers', () => {
  it('a reading is moving while it is under five minutes old', () => {
    const now = Date.parse('2026-11-18T15:45:00Z')
    expect(UNVOL_LIVE_FRESH_MS).toBe(5 * 60 * 1000)
    expect(unvolIsMoving('2026-11-18T15:42:00.000Z', now)).toBe(true)
    expect(unvolIsMoving('2026-11-18T15:40:00.000Z', now)).toBe(true)
    expect(unvolIsMoving('2026-11-18T15:39:59.000Z', now)).toBe(false)     // the close, or a stalled sweep
    expect(unvolIsMoving('2026-11-18T15:46:00.000Z', now)).toBe(false)     // a stamp from the future is not trusted
    for (const bad of [null, '', 'x']) expect(unvolIsMoving(bad, now)).toBe(false)
  })

  it('the multiple reads one decimal under 10 and none from there, and a missing one reads n/a', () => {
    expect([2, 2.04, 4.23, 9.94, 9.95, 12.4, 100].map(multipleText)).toEqual(['2.0×', '2.0×', '4.2×', '9.9×', '10×', '12×', '100×'])
    for (const bad of [null, undefined, 0, -3, '4', NaN]) expect(multipleText(bad)).toBe('n/a')
  })
})
