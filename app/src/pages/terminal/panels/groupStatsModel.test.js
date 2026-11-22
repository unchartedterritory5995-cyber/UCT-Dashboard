// Group fundamentals and breadth, the pure half (groupStatsModel.js). Rails:
//   * the URL, the words and the command a choice writes back;
//   * the route's answers as states (ok, not built, computing, a shape it cannot read, a group not held);
//   * a cell: a median through the catalog's format, a share, a change in points, the day's highs and lows, and
//     a group with too few members gives its count and no figure (never 0);
//   * the sort (a blank sinks to the end either way), the column sets with the fundamentals switched off;
//   * one group's rows, ranks, counts and the year's line on a fixed 0 to 100% scale.
// The fixtures are the route's real shape with invented figures.
import { describe, it, expect } from 'vitest'
import {
  BREADTH_SHARES, COLUMN_BY_KEY, DEFAULT_GROUPS_SORT, FUND_IDS, GROUPS_KIND_ARG_WORDS, GROUPS_TABLE_CODE, GROUPS_VIEWS, GROUPS_VIEW_ARG_WORDS,
  breadthCounts, breadthRows, breadthSummary, builtWords, columnHead, fundRows, fundStateWords, fundSummary, groupStatsUrl, groupsCommand,
  groupsCommandArgs, groupsSortWords, normGroupsKind, normGroupsView, parseGroupsKind, parseGroupsView, pointsText, rankText,
  readGroupDetail, readGroupsTable, shareLine, shareLineWords, shareText, signedCount, sortGroupsRows, tableCell, viewColumns,
} from './groupStatsModel'
import { COMPUTING, INDUSTRY_BOARD, NOT_BUILT, SECTOR_BOARD, TECH_DETAIL } from './__fixtures__/groupStatsFixture'

const table = readGroupsTable(SECTOR_BOARD)
const ctx = { metaById: table.metrics, minMembers: table.minMembers }
const row = (name) => table.rows.find((r) => r.name === name)

describe('the read, the words and the command', () => {
  it('asks one route by kind, and by name for one group', () => {
    expect(GROUPS_TABLE_CODE).toBe('GRPS')
    expect(groupStatsUrl()).toBe('/api/research/group-stats?kind=sector')
    expect(groupStatsUrl('industry')).toBe('/api/research/group-stats?kind=industry')
    expect(groupStatsUrl('industry', 'Oil & Gas E&P')).toBe('/api/research/group-stats?kind=industry&name=Oil%20%26%20Gas%20E%26P')
    expect(groupStatsUrl('theme', 'X')).toBe('/api/research/group-stats?kind=sector&name=X')
  })

  it('each word names its choice; anything else is the default', () => {
    expect(GROUPS_KIND_ARG_WORDS).toEqual({ SECTOR: 'sector', SECTORS: 'sector', INDUSTRY: 'industry', INDUSTRIES: 'industry' })
    expect(parseGroupsKind('industries')).toBe('industry')
    expect(parseGroupsKind('toString')).toBeNull()
    for (const [w, v] of Object.entries(GROUPS_VIEW_ARG_WORDS)) expect([w, parseGroupsView(w.toLowerCase())]).toEqual([w, v])
    expect(Object.values(GROUPS_VIEW_ARG_WORDS).every((v) => v in GROUPS_VIEWS)).toBe(true)
    expect([normGroupsKind('nope'), normGroupsView(null), normGroupsView('MARGIN'), normGroupsKind('industry')])
      .toEqual(['sector', 'overview', 'margins', 'industry'])
  })

  it('a choice writes back only what is not the default, and reads back as the same choice', () => {
    expect(groupsCommandArgs({})).toEqual([])
    expect(groupsCommandArgs({ kind: 'industry' })).toEqual(['INDUSTRIES'])
    expect(groupsCommandArgs({ kind: 'industry', view: 'valuation' })).toEqual(['INDUSTRIES', 'VALUATION'])
    expect(groupsCommand({ view: 'breadth' })).toBe('GRPS BREADTH')
    for (const kind of ['sector', 'industry']) {
      for (const view of Object.keys(GROUPS_VIEWS)) {
        const [a, b] = [groupsCommandArgs({ kind, view }), null]
        const back = { kind: a.map(parseGroupsKind).find(Boolean) || 'sector', view: a.map(parseGroupsView).find(Boolean) || 'overview' }
        expect([kind, view, b]).toEqual([back.kind, back.view, null])
      }
    }
  })
})

describe('the answer as a state', () => {
  it('a held table: its rows, its days and what is on hand', () => {
    expect(table.state).toBe('ok')
    expect(table.rows.map((r) => r.name)).toEqual(['Technology', 'Energy', 'Utilities'])
    expect([table.session, table.builtFor, table.fundState, table.breadthState, table.minMembers]).toEqual(['2031-06-04', '2031-06-04', 'ok', 'ok', 5])
    expect(table.metrics.get('pe_ttm')).toMatchObject({ name: 'P/E (TTM)', fmt: 'x2', agg: 'median', composed: true })
    expect(readGroupsTable(INDUSTRY_BOARD).kind).toBe('industry')
  })

  it('not built yet, the first build running, an answer it cannot read, and nothing in it', () => {
    expect(readGroupsTable(NOT_BUILT).state).toBe('not_built')
    expect(readGroupsTable(COMPUTING).state).toBe('computing')
    for (const bad of [null, [], 'x', { status: 'ok' }, { status: 'error' }]) expect(readGroupsTable(bad).state).toBe('bad_shape')
    expect(readGroupsTable({ ...SECTOR_BOARD, groups: [{ name: '' }, 7] }).state).toBe('empty')
  })

  it('one group, a group the build does not hold, and the switch said in words', () => {
    const d = readGroupDetail(TECH_DETAIL)
    expect([d.state, d.name, d.members, d.peers, d.lineDates.length]).toEqual(['ok', 'Technology', 52, 11, 252])
    const missing = readGroupDetail({ ...SECTOR_BOARD, found: false, name: 'Shipping', peers: 11 })
    expect([missing.state, missing.name]).toEqual(['not_found', 'Shipping'])
    expect(readGroupDetail({ ...TECH_DETAIL, found: undefined }).state).toBe('bad_shape')
    expect(fundStateWords('ok')).toBeNull()
    expect(fundStateWords('off')).toContain('switched off')
    expect(fundStateWords('pending')).toContain('after the next one')
    expect(fundStateWords('unavailable')).toContain('could not be read')
  })
})

describe('a cell', () => {
  it('a median through the catalog format with how many stocks it rests on; a share; a year ago', () => {
    expect(tableCell(row('Technology'), COLUMN_BY_KEY['f:revenue_growth_q'], ctx)).toMatchObject({ value: 14.2, text: '14.2%', sub: 'of 48' })
    expect(tableCell(row('Technology'), COLUMN_BY_KEY['f:pe_ttm'], ctx)).toMatchObject({ value: 31.75, text: '31.75x', sub: 'of 48' })
    expect(tableCell(row('Technology'), COLUMN_BY_KEY['f:revenue_accelerating'], ctx)).toMatchObject({ value: 56.3, text: '56%' })
    expect(tableCell(row('Technology'), COLUMN_BY_KEY['f:pe_ttm:ya'], ctx)).toMatchObject({ value: 26.4, text: '26.40x', sub: 'of 45' })
    expect(tableCell(row('Energy'), COLUMN_BY_KEY['f:revenue_growth_q'], ctx).text).toBe('-4.6%')
  })

  it('⭐ a group with too few members gives its count and no figure, never 0', () => {
    for (const key of ['f:net_margin', 'f:pe_ttm:ya', 'b:above50', 'b:net_highs']) {
      const c = tableCell(row('Utilities'), COLUMN_BY_KEY[key], ctx)
      expect([key, c.value, c.text, c.few]).toEqual([key, null, '3 with data', true])
      expect(c.words).toMatch(/fewer than 5/)
    }
  })

  it('breadth: a share of its stocks, the change in points, highs minus lows, up and down', () => {
    const tech = row('Technology')
    expect(tableCell(tech, COLUMN_BY_KEY['b:above50'], ctx)).toMatchObject({ value: 58, text: '58%', sub: 'of 50' })
    expect(tableCell(tech, COLUMN_BY_KEY['b:above50:week'], ctx)).toMatchObject({ value: 6, text: '+6 pts' })
    expect(tableCell(tech, COLUMN_BY_KEY['b:above50:month'], ctx)).toMatchObject({ value: -8, text: '-8 pts' })
    expect(tableCell(tech, COLUMN_BY_KEY['b:net_highs'], ctx)).toMatchObject({ value: 5, text: '+5', sub: '6 highs, 1 low' })
    expect(tableCell(row('Energy'), COLUMN_BY_KEY['b:net_highs'], ctx)).toMatchObject({ value: -3, text: '-3', sub: '0 highs, 3 lows' })
    expect(tableCell(tech, COLUMN_BY_KEY['b:advdec'], ctx)).toMatchObject({ value: 14, text: '31 / 17', sub: '2 flat' })
    expect(tableCell({ ...tech, breadth: null }, COLUMN_BY_KEY['b:above50'], ctx)).toMatchObject({ value: null, text: null })
  })

  it('the shared words', () => {
    expect([rankText({ position: 1, of: 11 }), rankText({ position: 2, of: 11 }), rankText({ position: 3, of: 11 }), rankText({ position: 11, of: 140 }),
      rankText({ position: 22, of: 140 }), rankText(null)]).toEqual(['1st of 11', '2nd of 11', '3rd of 11', '11th of 140', '22nd of 140', null])
    expect([pointsText(4.4), pointsText(-0.4), pointsText(0), pointsText(null)]).toEqual(['+4 pts', '0 pts', '0 pts', null])
    expect([signedCount(3), signedCount(-2), signedCount(0), signedCount(null)]).toEqual(['+3', '-2', '0', null])
    expect([shareText(62.5), shareText(null)]).toEqual(['63%', null])
  })
})

describe('the columns and the sort', () => {
  it('each view is a handful of columns; with the fundamentals not on hand only breadth is left', () => {
    expect(GROUPS_VIEWS.overview.columns.map((c) => c.key)).toEqual(['f:revenue_growth_q', 'f:eps_growth_q', 'f:net_margin', 'f:pe_ttm', 'b:above50', 'b:net_highs'])
    for (const v of Object.values(GROUPS_VIEWS)) if (v !== GROUPS_VIEWS.all) expect(v.columns.length).toBeLessThanOrEqual(8)
    expect(GROUPS_VIEWS.all.columns.length).toBe(FUND_IDS.length + Object.keys(BREADTH_SHARES).length + 2)
    expect(viewColumns('overview', 'off').map((c) => c.key)).toEqual(['b:above50', 'b:net_highs'])
    expect(viewColumns('margins', 'unavailable')).toEqual([])
    expect(viewColumns('margins', 'ok')).toHaveLength(5)
  })

  it('a header says its catalog name in its title and what a composed figure is made of', () => {
    expect(columnHead(COLUMN_BY_KEY['f:pe_ttm'], ctx.metaById)).toEqual({ label: 'P/E', title: "P/E (TTM): the group's median, worked out with UCT's stored close" })
    expect(columnHead(COLUMN_BY_KEY['f:pe_ttm:ya'], ctx.metaById).label).toBe('P/E, a year ago')
    expect(columnHead(COLUMN_BY_KEY['b:above50:week']).label).toBe('Above 50-day, 1 wk')
  })

  it('by name A to Z by default; by a figure highest first, a blank last either way', () => {
    expect(sortGroupsRows(table.rows, DEFAULT_GROUPS_SORT, ctx).map((r) => r.name)).toEqual(['Energy', 'Technology', 'Utilities'])
    expect(sortGroupsRows(table.rows, { key: 'f:pe_ttm', dir: 'desc' }, ctx).map((r) => r.name)).toEqual(['Technology', 'Energy', 'Utilities'])
    expect(sortGroupsRows(table.rows, { key: 'f:pe_ttm', dir: 'asc' }, ctx).map((r) => r.name)).toEqual(['Energy', 'Technology', 'Utilities'])
    expect(sortGroupsRows(table.rows, { key: 'b:net_highs', dir: 'asc' }, ctx).map((r) => r.name)).toEqual(['Energy', 'Technology', 'Utilities'])
    expect(sortGroupsRows(table.rows, { key: 'nope', dir: 'desc' }, ctx).map((r) => r.name)).toEqual(['Energy', 'Technology', 'Utilities'])
    expect(groupsSortWords({ key: 'f:pe_ttm', dir: 'desc' }, ctx.metaById)).toBe('by P/E, highest first')
    expect(groupsSortWords(DEFAULT_GROUPS_SORT)).toBe('by name, A to Z')
  })
})

describe('one group (GRP\'s sections)', () => {
  const d = readGroupDetail(TECH_DETAIL)

  it('a row per metric: the median, its middle half, a year and three years ago, the rank', () => {
    const rows = fundRows(d)
    expect(rows.map((r) => r.id)).toEqual(['revenue_growth_q', 'eps_growth_q', 'revenue_accelerating', 'gross_margin', 'operating_margin',
      'net_margin', 'fcf_margin', 'roe', 'pe_ttm', 'ps_ttm', 'fcf_yield'])
    const rev = rows[0]
    expect([rev.now.text, rev.now.n, rev.middle, rev.yearAgo.text, rev.threeYears.text, rev.rank]).toEqual(['14.2%', 46, '4.1% to 27.9%', '9.8%', '17.5%', '2nd of 11'])
    const acc = rows[2]
    expect([acc.now.text, acc.middle, acc.threeYears.value, acc.threeYears.n]).toEqual(['57%', null, null, 3])
    expect(rows.find((r) => r.id === 'pe_ttm').threeYears).toEqual({ n: 3, value: null, text: null })
    expect(fundRows({ ...d, fund: null })).toEqual([])
  })

  it('the breadth rows, the day\'s counts and the two summaries', () => {
    const rows = breadthRows(d)
    const r1 = (v) => Math.round(v * 10) / 10
    expect(rows.map((r) => [r.key, r.now.share, r1(r.weekChange), r1(r.monthChange), r.rank])).toEqual([
      ['above20', 64, 4, 13, '2nd of 11'], ['above50', 58, 6, -7.3, '3rd of 11'], ['above200', 71.4, 2, 2.6, '1st of 11'],
      ['near_high', 29.8, 2.1, -5, '2nd of 11']])
    expect(breadthCounts(d)).toEqual({ highs: 6, lows: 1, yearN: 47, net: 5, netRank: '1st of 11', up: 31, down: 17, flat: 2, n: 50, priced: 50 })
    expect(fundSummary(d)).toBe('median revenue growth 14.2% (of 46), net margin 14.8%, P/E 31.75x; 2nd of 11 by revenue growth')
    expect(breadthSummary(d)).toBe('58% above the 50-day (+6 pts in a week); 6 new highs, 1 new low')
    expect(fundSummary({ ...d, fundState: 'off' })).toBeNull()
    expect(builtWords(d)).toMatch(/^after the close of Jun 4, 2031 \(built \d{1,2}:\d{2} [AP]M ET\)$/)
  })

  it('the line sits on a fixed 0 to 100% scale and breaks on a day with too few stocks', () => {
    const geo = shareLine(['2031-01-02', '2031-01-03', '2031-01-06', '2031-01-07'], [0, 50, null, 100], { w: 100, h: 100, padX: 0, padY: 0 })
    expect(geo.path).toBe('M0 100 L33.3 50 M100 0')
    expect(geo.mid).toBe(50)
    expect([geo.low.v, geo.high.v, geo.last.v, geo.days]).toEqual([0, 100, 100, 3])
    expect(shareLineWords(geo)).toBe('Share above the 50-day average, daily, Jan 2, 2031 to Jan 7, 2031: low 0% on Jan 2, 2031, high 100% on Jan 7, 2031, now 100%.')
    expect(shareLine(['2031-01-02'], [40])).toBeNull()
    expect(shareLine(d.lineDates, d.breadth.line).days).toBe(249)
  })
})
