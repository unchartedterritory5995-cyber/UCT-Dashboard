// GRPS CROWDING (2026-11-22): the pure half. Rails:
//   * the answer read into rows: each part null when not on hand, a stock that is not a symbol dropped, a list item
//     with no figure dropped, an unknown role read as "role not stated";
//   * each column's cell: a median with how many stocks it rests on, too few gives the count and no figure (never 0),
//     the lists (most shorted, largest buys) sort by their first stock, insider dollars with an unpriced purchase
//     counted and none priced said in words, a part not on hand said in words (pending, or not on hand);
//   * the coverage and as-of lines: one per part, each with its own date and cadence, the parts down and pending;
//   * one group's members: every state, each cell's words for what the store does not have, the sort (blanks last);
//   * the view in GRPS's model: its word, its lean read, its columns sort through the board's own sort.
// Every symbol and figure is INVENTED (__fixtures__/groupPositioningFixture.js).
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_MEMBERS_SORT, MEMBER_COLUMNS, POSITIONING_COLUMNS, POSITIONING_PART, memberCell, membersSortWords, positioningCell,
  positioningAsOfLine, positioningHead, positioningNotes, readMembers, readPositioning, readPositioningSources, sortMembers,
} from './groupPositioningModel'
import {
  COLUMN_BY_KEY, GROUPS_VIEWS, GROUPS_VIEW_ARG_WORDS, columnHead, firstSortDir, groupStatsUrl, groupsCommandArgs, groupsSortWords,
  readGroupsTable, sortGroupsRows, tableCell, viewColumns, viewPart,
} from './groupStatsModel'
import {
  MEMBERS_NOT_FOUND, POSITIONING_SOURCES, SECTOR_POSITIONING, SECTOR_POSITIONING_PARTS_DOWN, SECTOR_POSITIONING_PENDING, TECH_MEMBERS,
} from './__fixtures__/groupPositioningFixture'

const col = (key) => POSITIONING_COLUMNS.find((c) => c.key === key)
const table = (body = SECTOR_POSITIONING) => readGroupsTable(body)
const rowOf = (t, name) => t.rows.find((r) => r.name === name)
/** The board's context (tableCell, the sort) and a positioning cell's own (`sources`). */
const ctxOf = (t) => ({ minMembers: t.minMembers, positioning: t.positioning })
const cellCtx = (t) => ({ minMembers: t.minMembers, sources: t.positioning })

describe('the view in GRPS', () => {
  it('its word is CROWDING, it reads the lean part, and the other views read the default answer', () => {
    expect(GROUPS_VIEW_ARG_WORDS.CROWDING).toBe('crowding')
    expect(Object.keys(GROUPS_VIEW_ARG_WORDS)).not.toContain('POSITIONING')       // "positioning" is POS's and COT's word
    expect(GROUPS_VIEWS.crowding.columns).toBe(POSITIONING_COLUMNS)
    expect(viewPart('crowding')).toBe(POSITIONING_PART)
    expect(viewPart('overview')).toBeNull()
    expect(groupStatsUrl('sector', null, viewPart('crowding'))).toBe('/api/research/group-stats?kind=sector&part=positioning')
    expect(groupStatsUrl('industry', 'Oil & Gas', 'positioning')).toBe('/api/research/group-stats?kind=industry&name=Oil%20%26%20Gas&part=positioning')
    expect(groupStatsUrl('sector', null, 'nonsense')).toBe('/api/research/group-stats?kind=sector')
    expect(groupsCommandArgs({ kind: 'industry', view: 'crowding' })).toEqual(['INDUSTRIES', 'CROWDING'])
    expect(viewColumns('crowding', 'off')).toEqual(POSITIONING_COLUMNS)              // none of them is a fundamental
    for (const c of POSITIONING_COLUMNS) {
      expect(COLUMN_BY_KEY[c.key]).toBe(c)
      expect(firstSortDir(c.key)).toBe('desc')
      expect(columnHead(c)).toEqual(positioningHead(c))
      expect(positioningHead(c).label.length).toBeLessThan(18)
    }
  })

  it('the table answer carries the part and each part\'s state; the default answer carries neither', () => {
    const t = table()
    expect(t.state).toBe('ok')
    expect(t.part).toBe('positioning')
    expect(t.positioning.state).toBe('ok')
    expect(t.positioning.short).toMatchObject({ state: 'ok', settlement: '2031-05-15', previous: '2031-04-30', covered: 2950, universe: 3051 })
    expect(t.positioning.institutions.state).toBe('not_held')
    expect(readGroupsTable({ ...SECTOR_POSITIONING, part: undefined }).part).toBeNull()
  })
})

describe('the answer, read', () => {
  it('a group\'s three parts, a list item with no figure or no symbol dropped, an unknown role read as not stated', () => {
    const p = readPositioning({
      short: { reported: 2, pct_float: { n: 2, median: null }, top: [{ sym: 'QAA', pct_float: 3 }, { sym: 'not a sym!', pct_float: 9 }, { sym: 'QAB', pct_float: null }] },
      insider: { members: 7, buyers: { n: 7, count: 2, share: 28.6 }, purchases: 3, value: 1000, unpriced: 0,
        top: [{ sym: 'QAA', value: 900, date: '2031-05-01', role: 'wizard' }, { sym: 'QAB', value: null }] },
      funds: null,
    })
    expect(p.short.top).toEqual([{ sym: 'QAA', pctFloat: 3, dtc: null }])
    expect(p.short.pctFloat).toEqual({ n: 2, median: null, q1: null, q3: null })
    expect(p.insider.top).toEqual([{ sym: 'QAA', value: 900, date: '2031-05-01', role: 'not_stated' }])
    expect(p.funds).toBeNull()
    expect(readPositioning(null)).toBeNull()
  })

  it('sources from before positioning existed read as pending in every part', () => {
    const s = readPositioningSources({ state: 'pending' })
    expect(s.state).toBe('pending')
    expect([s.short.state, s.insider.state, s.funds.state, s.institutions.state]).toEqual(['pending', 'pending', 'pending', 'pending'])
    expect(readPositioningSources(undefined).state).toBe('pending')
    expect(readPositioningSources({ ...POSITIONING_SOURCES, short: { state: 'weird' } }).short.state).toBe('failed')
  })
})

describe('the cells', () => {
  const t = table()
  const tech = rowOf(t, 'Technology')
  const util = rowOf(t, 'Utilities')
  const energy = rowOf(t, 'Energy')
  const cell = (r, key) => positioningCell(r, col(key), cellCtx(t))

  it('⭐ a median says how many stocks it rests on; too few gives the count and no figure, never 0', () => {
    expect(cell(tech, 'p:short_pct')).toMatchObject({ value: 4.2, text: '4.2%', sub: 'of 50' })
    expect(cell(tech, 'p:short_pct').words).toBe('Median short interest of 4.2% across 50 stocks.')
    expect(cell(tech, 'p:short_dtc')).toMatchObject({ value: 2.6, text: '2.6', sub: 'of 50' })
    expect(cell(tech, 'p:short_chg')).toMatchObject({ value: 3.5, text: '+3.5%', sub: 'of 48' })
    expect(cell(energy, 'p:short_chg')).toMatchObject({ value: -4.1, text: '-4.1%' })
    for (const key of ['p:short_pct', 'p:short_dtc', 'p:short_chg', 'p:funds_net']) {
      const c = cell(util, key)
      expect([key, c.value, c.text, c.few]).toEqual([key, null, '3 with data', true])
      expect(c.words).toContain('fewer than 5 stocks have a figure')
    }
    expect(cell(util, 'p:funds_adding')).toMatchObject({ value: null, text: '3 with data', few: true })
    expect(cell(tech, 'p:funds_adding')).toMatchObject({ value: 62, text: '62.0%', sub: 'of 50' })
    expect(cell(tech, 'p:funds_net')).toMatchObject({ value: 2.4, text: '+2.4%', sub: 'of 48' })
  })

  it('the lists name their stocks with a figure and sort by the first', () => {
    const top = cell(tech, 'p:short_top')
    expect(top.value).toBe(31.5)
    expect(top.list.map((x) => [x.sym, x.text])).toEqual([['QTKA', '31.5%'], ['QTKB', '24.0%'], ['QTKC', '19.8%']])
    expect(top.list[0].words).toBe('QTKA 31.5% of float, 6.2 days to cover')
    // the insider dollars sort the column; the largest buys ride under them in the same cell (eight columns at most)
    const buys = cell(tech, 'p:ins_value')
    expect(buys.value).toBe(6_400_000)
    expect(buys.list.map((x) => x.sym)).toEqual(['QTKD', 'QTKD', 'QTKE'])
    expect(buys.list[0].words).toContain('by a CEO on')
    expect(buys.list[2].words).toContain('by a 10% owner')
    expect(buys.words).toContain('Largest: QTKD $2.5M, QTKD $1.1M, QTKE $900K.')
    expect(cell(energy, 'p:ins_value').list).toBeUndefined()
    expect(POSITIONING_COLUMNS).toHaveLength(8)
    expect(Object.values(GROUPS_VIEWS).filter((v) => v !== GROUPS_VIEWS.all).every((v) => v.columns.length <= 8)).toBe(true)
  })

  it('insider buyers among all members, and dollars that never price an unpriced purchase', () => {
    expect(cell(tech, 'p:ins_buyers')).toMatchObject({ value: 9, text: '9', sub: 'of 52, 17.3%' })
    expect(cell(util, 'p:ins_buyers')).toMatchObject({ value: 1, text: '1', sub: 'of 3' })              // no share under five
    expect(cell(energy, 'p:ins_buyers')).toMatchObject({ value: 0, text: '0' })                       // a real count
    expect(cell(tech, 'p:ins_value')).toMatchObject({ value: 6_400_000, sub: '14 buys, some unpriced' })
    expect(cell(tech, 'p:ins_value').words).toContain('1 without a price')
    expect(cell(energy, 'p:ins_value')).toMatchObject({ value: 0, text: 'None' })
    expect(cell(util, 'p:ins_value')).toMatchObject({ value: null, text: 'No price', sub: '1 buy', few: true })
  })

  it('a part not on hand is words, and pending says when it comes', () => {
    const down = table(SECTOR_POSITIONING_PARTS_DOWN)
    const c = positioningCell(rowOf(down, 'Technology'), col('p:short_pct'), cellCtx(down))
    expect(c).toEqual({ value: null, text: null, sub: null, words: 'Short interest: not on hand.' })
    const pending = table(SECTOR_POSITIONING_PENDING)
    expect(positioningCell(rowOf(pending, 'Technology'), col('p:funds_net'), cellCtx(pending)).words)
      .toBe('Fund holdings: appears after the next evening build.')
  })

  it('the board\'s own sort orders by a positioning column, a blank last either way', () => {
    const ctx = ctxOf(t)
    expect(sortGroupsRows(t.rows, { key: 'p:short_pct', dir: 'desc' }, ctx).map((r) => r.name)).toEqual(['Energy', 'Technology', 'Utilities'])
    expect(sortGroupsRows(t.rows, { key: 'p:short_pct', dir: 'asc' }, ctx).map((r) => r.name)).toEqual(['Technology', 'Energy', 'Utilities'])
    expect(sortGroupsRows(t.rows, { key: 'p:short_top', dir: 'desc' }, ctx).map((r) => r.name)).toEqual(['Technology', 'Energy', 'Utilities'])
    expect(sortGroupsRows(t.rows, { key: 'p:ins_value', dir: 'desc' }, ctx).map((r) => r.name)).toEqual(['Technology', 'Energy', 'Utilities'])
    expect(tableCell(tech, col('p:short_pct'), ctx)).toEqual(positioningCell(tech, col('p:short_pct'), cellCtx(t)))
    const pending = table(SECTOR_POSITIONING_PENDING)                               // the board hands its sources on
    expect(tableCell(rowOf(pending, 'Energy'), col('p:ins_value'), ctxOf(pending)).words).toBe('Insider buying: appears after the next evening build.')
    expect(groupsSortWords({ key: 'p:funds_adding', dir: 'desc' })).toBe('by Funds adding, highest first')
  })
})

describe('the coverage and as-of lines', () => {
  it('one plain line above the table: each part\'s date and reach', () => {
    expect(positioningAsOfLine(table().positioning)).toBe('As of: short interest, FINRA settlement May 15, 2031 (2,950 of 3,051 stocks); '
      + 'insider purchases filed May 6, 2031 to Jun 3, 2031 (no sales kept); funds, N-PORT 2031Q1 (2,890 of 3,051 stocks); 13F not shown.')
    const down = positioningAsOfLine(table(SECTOR_POSITIONING_PARTS_DOWN).positioning)
    expect(down).toContain('short interest not on hand')
    expect(down).toContain('funds not on hand')
    expect(positioningAsOfLine(table(SECTOR_POSITIONING_PENDING).positioning)).toBe('Positioning appears after the next evening build.')
  })

  it('one per part, each with its own date, cadence and coverage; 13F says why it is left out', () => {
    const notes = positioningNotes(table().positioning)
    expect(notes.map((n) => n.key)).toEqual(['short', 'insider', 'funds', 'institutions'])
    const [short, insider, funds, inst] = notes.map((n) => n.text)
    expect(short).toBe("Short interest: FINRA's report for settlement May 15, 2031 (published about May 27, 2031), against the one for "
      + "Apr 30, 2031; 2,950 of 3,051 stocks in the report. Reported twice a month; percent of float uses today's float.")
    expect(insider).toContain('filed May 6, 2031 to Jun 3, 2031, the 30 days of filings the server keeps')
    expect(insider).toContain('The server keeps no insider sales, so there is no sales total or net.')
    expect(funds).toContain('SEC Form N-PORT data set 2031Q1')
    expect(funds).toContain('reports for periods ending Jan 31, 2031 to Mar 31, 2031')
    expect(funds).toContain('within 60 days')
    expect(funds).toContain('2,890 of 3,051 stocks matched to a fund holding.')
    expect(inst).toContain('Institutions (13F): not shown.')
    expect(inst).toContain('45 days')
  })

  it('a part not on hand says why; an incomplete insider read says the counts may be short; pending says when', () => {
    const [short, insider, funds] = positioningNotes(table(SECTOR_POSITIONING_PARTS_DOWN).positioning).map((n) => n.text)
    expect(short).toBe('Short interest: the data plan did not answer for the FINRA report, so it is not shown.')
    expect(insider).toContain('Some filings in that span were not read yet, so the counts may be short.')
    expect(funds).toBe('Funds: the server has not built its N-PORT index yet, so it is not shown.')
    expect(positioningNotes(table(SECTOR_POSITIONING_PENDING).positioning)).toEqual([{ key: 'pending',
      text: 'Positioning appears after the next evening build: the figures held now were worked out before it was added.' }])
  })
})

describe('one group\'s members', () => {
  const m = readMembers(TECH_MEMBERS)
  const byKey = (key) => MEMBER_COLUMNS.find((c) => c.key === key)
  const r = (s) => m.rows.find((x) => x.sym === s)
  const cell = (s, key) => memberCell(r(s), byKey(key), m.sources)

  it('every state', () => {
    expect(m.state).toBe('ok')
    expect(m).toMatchObject({ name: 'Technology', members: 4, total: 4, cut: false, limit: 1000 })
    expect(readMembers(MEMBERS_NOT_FOUND)).toMatchObject({ state: 'not_found', name: 'Shipping' })
    expect(readMembers({ status: 'not_built' }).state).toBe('not_built')
    expect(readMembers({ status: 'computing' }).state).toBe('computing')
    expect(readMembers({ ...TECH_MEMBERS, part: undefined }).state).toBe('bad_shape')       // not the positioning answer
    expect(readMembers({ ...TECH_MEMBERS, member_rows: 'no' }).state).toBe('bad_shape')
    expect(readMembers(null).state).toBe('bad_shape')
  })

  it('each cell says what the store does not have, never a 0 for a missing figure', () => {
    expect(cell('QTKA', 'pct_float')).toMatchObject({ value: 31.5, text: '31.5%', sub: '6.2 days' })
    expect(cell('QTKF', 'pct_float')).toMatchObject({ value: null, text: 'No float', sub: '0.9 days', few: true })
    expect(cell('QTKG', 'pct_float')).toMatchObject({ value: null, text: 'Not reported' })
    expect(cell('QTKA', 'short_change_pct')).toMatchObject({ value: 12.5, text: '+12.5%' })
    expect(cell('QTKF', 'short_change_pct')).toMatchObject({ value: null, text: 'No change' })
    expect(cell('QTKD', 'buy_value')).toMatchObject({ value: 3_600_000, sub: '2 buys, last May 22, 2031' })
    expect(cell('QTKF', 'buy_value')).toMatchObject({ value: null, text: 'No price', sub: '1 buy, last May 30, 2031' })
    expect(cell('QTKA', 'buy_value')).toMatchObject({ value: 0, text: 'None' })                    // a real answer: none filed
    expect(cell('QTKA', 'funds_moves')).toMatchObject({ value: 13, text: '22 / 9', sub: 'of 40 holding' })
    expect(cell('QTKF', 'funds_moves')).toMatchObject({ value: null, text: 'No earlier report' })
    expect(cell('QTKG', 'funds_moves')).toMatchObject({ value: null, text: 'No fund matched' })
    expect(cell('QTKD', 'fund_net_pct')).toMatchObject({ value: -8, text: '-8.0%' })
    const down = { ...m.sources, short: { state: 'unavailable' } }
    expect(memberCell(r('QTKA'), byKey('pct_float'), down)).toEqual({ value: null, text: null, sub: null, words: 'Short interest: not on hand.' })
  })

  it('sorts by any column, a blank last either way; by symbol too', () => {
    expect(sortMembers(m.rows, DEFAULT_MEMBERS_SORT, m.sources).map((x) => x.sym)).toEqual(['QTKA', 'QTKD', 'QTKF', 'QTKG'])
    expect(sortMembers(m.rows, { key: 'pct_float', dir: 'asc' }, m.sources).map((x) => x.sym)).toEqual(['QTKD', 'QTKA', 'QTKF', 'QTKG'])
    expect(sortMembers(m.rows, { key: 'buy_value', dir: 'desc' }, m.sources).map((x) => x.sym)).toEqual(['QTKD', 'QTKA', 'QTKG', 'QTKF'])
    expect(sortMembers(m.rows, { key: 'sym', dir: 'desc' }, m.sources).map((x) => x.sym)).toEqual(['QTKG', 'QTKF', 'QTKD', 'QTKA'])
    expect(membersSortWords(DEFAULT_MEMBERS_SORT)).toBe('by Short % float, highest first')
    expect(membersSortWords({ key: 'sym', dir: 'asc' })).toBe('by symbol, A to Z')
  })
})
