// Group fundamentals and breadth, the pure half (groupStatsModel.js). Rails:
//   * the URL, the words and the command a choice writes back;
//   * the route's answers as states (ok, not built, computing, a shape it cannot read, a group not held);
//   * a cell: a median through the catalog's format, a share, a change in points, the day's highs and lows, and
//     a group with too few members gives its count and no figure (never 0);
//   * the sort (a blank sinks to the end either way), the column sets with the fundamentals switched off;
//   * one group's rows, ranks, counts and the year's line on a fixed 0 to 100% scale;
//   * the weekly rank (2026-11-22): the RANK view and its sort, the state (pending, unavailable), a rank cell (out of how
//     many, on how many stocks, too few gives the count), the places moved, the small line on one scale, the movers, one
//     group's rows and summary, and the words.
// The fixtures are the route's real shape with invented figures.
import { describe, it, expect } from 'vitest'
import {
  BREADTH_SHARES, COLUMN_BY_KEY, DEFAULT_GROUPS_SORT, FUND_IDS, GROUPS_KIND_ARG_WORDS, GROUPS_TABLE_CODE, GROUPS_VIEWS, GROUPS_VIEW_ARG_WORDS,
  RANK_MOVER_WINDOWS, breadthCounts, breadthRows, breadthSummary, builtWords, changeText, columnHead, defaultGroupsSort, firstSortDir,
  fundRows, fundStateWords, fundSummary, groupStatsUrl, groupsCommand, groupsCommandArgs, groupsSortWords, moverWords, normGroupsKind,
  normGroupsView, parseGroupsKind, parseGroupsView, placeText, placesText, placesWords, pointsText, rankLine, rankLineWords, rankMovers,
  rankRows, rankScaleMax, rankStateWords, rankSummary, rankText, rankWindowWords, readGroupDetail, readGroupsTable, shareLine,
  shareLineWords, shareText, signedCount, sortGroupsRows, tableCell, viewColumns,
} from './groupStatsModel'
import { COMPUTING, INDUSTRY_BOARD, NOT_BUILT, SECTOR_BOARD, TECH_DETAIL, TECH_RANK } from './__fixtures__/groupStatsFixture'

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

describe('the weekly rank (2026-11-22)', () => {
  const ranked = readGroupsTable(SECTOR_BOARD)
  const rctx = { metaById: ranked.metrics, minMembers: ranked.minMembers, dates: ranked.rankDates, scaleMax: rankScaleMax(ranked.rows) }
  const rrow = (name) => ranked.rows.find((r) => r.name === name)

  it('RANK is a view word with its own columns; it opens sorted by the place now, best first', () => {
    expect(GROUPS_VIEW_ARG_WORDS.RANK).toBe('rank')
    expect(GROUPS_VIEWS.rank.columns.map((c) => c.key)).toEqual(['r:now', 'r:w4', 'r:w13', 'r:w52', 'r:range', 'r:m3', 'r:line'])
    expect(groupsCommandArgs({ kind: 'industry', view: 'rank' })).toEqual(['INDUSTRIES', 'RANK'])
    expect(defaultGroupsSort('rank')).toEqual({ key: 'r:now', dir: 'asc' })
    expect(defaultGroupsSort('overview')).toEqual(DEFAULT_GROUPS_SORT)
    expect(['r:now', 'r:m3', 'r:range', 'r:w4', 'name', 'f:pe_ttm'].map(firstSortDir)).toEqual(['asc', 'asc', 'asc', 'desc', 'asc', 'desc'])
    expect(groupsSortWords({ key: 'r:now', dir: 'asc' })).toBe('by Rank now, best first')
    expect(groupsSortWords({ key: 'r:now', dir: 'desc' })).toBe('by Rank now, worst first')
    expect(groupsSortWords({ key: 'r:w13', dir: 'desc' })).toBe('by 13-wk change, highest first')
    expect(viewColumns('rank', 'off')).toHaveLength(7)                     // the rank does not need the filings
    expect(columnHead(COLUMN_BY_KEY['r:line']).label).toBe('Weekly rank, 1 yr')
    expect(COLUMN_BY_KEY['r:line'].sortable).toBe(false)
  })

  it('the answer says the rank\'s state, its weeks and its windows; an answer without it is pending', () => {
    expect([ranked.rankState, ranked.rankDates.length, ranked.rankDates[0], ranked.rankDates[52]]).toEqual(['ok', 53, '2030-06-07', '2031-06-04'])
    expect(ranked.rankSessions).toEqual({ m6: 126, m3: 63 })
    // eslint-disable-next-line no-unused-vars
    const old = readGroupsTable({ ...SECTOR_BOARD, sources: { ...SECTOR_BOARD.sources, rank: undefined }, groups: SECTOR_BOARD.groups.map(({ rank, ...g }) => g) })
    expect([old.rankState, old.rows[0].rank]).toEqual(['pending', null])
    expect(readGroupsTable({ ...SECTOR_BOARD, sources: { ...SECTOR_BOARD.sources, rank: { state: 'unavailable' } } }).rankState).toBe('unavailable')
    expect(rankStateWords('pending')).toContain('next evening build')
    expect(rankStateWords('unavailable')).toContain('no weekly rank')
    expect(rankStateWords('ok')).toBeNull()
  })

  it('a rank says its place out of how many and the stocks it rests on; too few gives the count and no rank, never 0', () => {
    const tech = rrow('Technology')
    expect(tableCell(tech, COLUMN_BY_KEY['r:now'], rctx)).toMatchObject({ value: 1, text: '1st of 2', sub: '50 stocks' })
    expect(tableCell(tech, COLUMN_BY_KEY['r:now'], rctx).words).toBe('1st of 2 by the median 6-month change (+18.4%) of 50 stocks.')
    expect(tableCell(tech, COLUMN_BY_KEY['r:w4'], rctx)).toMatchObject({ value: 1, text: '+1', sub: 'was 2nd' })
    expect(tableCell(tech, COLUMN_BY_KEY['r:w4'], rctx).words).toBe('4 weeks ago 2nd of 2 on May 9, 2031 (49 stocks); climbed 1 place since.')
    expect(tableCell(rrow('Energy'), COLUMN_BY_KEY['r:w13'], rctx)).toMatchObject({ value: -1, text: '-1', sub: 'was 1st' })
    expect(tableCell(tech, COLUMN_BY_KEY['r:w52'], rctx)).toMatchObject({ value: 0, text: '0', sub: 'was 1st' })
    expect(tableCell(tech, COLUMN_BY_KEY['r:range'], rctx)).toMatchObject({ value: 1, text: '1st / 2nd', sub: '53 weeks ranked' })
    expect(tableCell(tech, COLUMN_BY_KEY['r:m3'], rctx)).toMatchObject({ value: 2, text: '2nd of 2', sub: '50 stocks' })
    const util = rrow('Utilities')
    expect(tableCell(util, COLUMN_BY_KEY['r:now'], rctx)).toMatchObject({ value: null, text: '3 with prices', few: true })
    expect(tableCell(util, COLUMN_BY_KEY['r:now'], rctx).words).toBe('3 stocks with a 6-month change: fewer than 5, so no rank.')
    expect(tableCell(util, COLUMN_BY_KEY['r:w4'], rctx)).toMatchObject({ value: null, text: null })
    expect(tableCell(util, COLUMN_BY_KEY['r:range'], rctx)).toMatchObject({ value: null, text: null, words: 'No ranked week in the last year.' })
    expect(tableCell({ ...tech, rank: null }, COLUMN_BY_KEY['r:now'], rctx)).toMatchObject({ value: null, text: null })
    // ranked then but not now: the place then, no change
    const lost = { ...tech, rank: { ...tech.rank, m6: { ...tech.rank.m6, w4: { ...tech.rank.m6.w4, change: null } } } }
    expect(tableCell(lost, COLUMN_BY_KEY['r:w4'], rctx)).toMatchObject({ value: null, text: 'was 2nd', few: true })
    expect(sortGroupsRows(ranked.rows, { key: 'r:now', dir: 'desc' }, rctx).map((r) => r.name)).toEqual(['Energy', 'Technology', 'Utilities'])
  })

  it('the small line: 1st at the top, one scale for every row, a week with no rank breaks it', () => {
    const cell = tableCell(rrow('Technology'), COLUMN_BY_KEY['r:line'], rctx)
    expect(cell.geo.path.startsWith('M')).toBe(true)
    expect(cell.words).toBe('Rank by the median 6-month change each week, Jun 7, 2030 to Jun 4, 2031, 1st at the top: best 1st on Jun 4, 2031, '
      + 'worst 2nd on May 9, 2031, latest 1st of 2.')
    expect(tableCell(rrow('Utilities'), COLUMN_BY_KEY['r:line'], rctx)).toMatchObject({ geo: null, words: 'Fewer than two ranked weeks: no line.' })
    const g = rankLine(['a', 'b', 'c', 'd'], [1, null, 3, 2], [3, 3, 3, 3], { w: 100, h: 20, padX: 0, padY: 0 })
    expect(g.path).toBe('M0 0 M66.7 20 L100 10')
    expect([g.top, g.best.position, g.worst.position, g.weeks]).toEqual([3, 1, 3, 3])
    expect(rankLine(['a', 'b'], [4, 4], null, { scaleMax: 9 }).top).toBe(9)
    expect(rankLine([], [1], [])).toBeNull()
    expect(rankScaleMax(ranked.rows)).toBe(2)
    expect(rankScaleMax(readGroupsTable(INDUSTRY_BOARD).rows)).toBe(140)
  })

  it('the movers: the most places climbed and fallen over 4 and 13 weeks, only groups ranked at both ends', () => {
    const ind = readGroupsTable(INDUSTRY_BOARD)
    const w4 = rankMovers(ind.rows, 'w4')
    expect(w4.up.map((x) => [x.name, x.change])).toEqual([['Semiconductors', 12]])
    expect(w4.down.map((x) => [x.name, x.change])).toEqual([['Oil & Gas E&P', -10]])
    expect(moverWords(w4.up[0])).toBe('climbed 12 places: from 17th of 138 on May 9, 2031 to 5th of 140')
    expect(rankMovers(ind.rows, 'w13').down.map((x) => x.change)).toEqual([-45])
    expect(rankMovers(ranked.rows, 'w4').counted).toBe(2)                   // Utilities has no rank at either end
    expect(rankMovers(ranked.rows, 'w52')).toMatchObject({ up: [], down: [], counted: 2 })
    expect(RANK_MOVER_WINDOWS.map((w) => w.back)).toEqual(['w4', 'w13'])
    const many = ['C', 'A', 'B', 'D'].map((name, i) => ({ name, rank: { m6: { now: { position: 1, of: 9 }, w4: { position: 4, of: 9, change: i === 3 ? 1 : 3 } } } }))
    expect(rankMovers(many, 'w4', 2).up.map((x) => x.name)).toEqual(['A', 'B'])
  })

  it('one group: its rows by both measures, the summary line, and the year line on its own scale', () => {
    const d = readGroupDetail(TECH_DETAIL)
    expect([d.rank.m6.ofLine.length, d.rank.m6.nLine[10], d.rank.m3.medianLine[52]]).toEqual([53, 4, 9])
    expect(rankSummary(d)).toBe('2nd of 11 by 6-month change (50 stocks); +1 place in 4 weeks, +3 places in 13 weeks')
    const rows = rankRows(d)
    expect(rows.map((r) => [r.key, r.label, r.date])).toEqual([['now', 'Now', '2031-06-04'], ['w4', '4 weeks ago', '2031-05-09'],
      ['w13', '13 weeks ago', '2031-03-07'], ['w52', '52 weeks ago', '2030-06-07'], ['best', 'Best of the year', null], ['worst', 'Worst of the year', null]])
    expect(rows[0].cells.map((c) => [c.text, c.sub])).toEqual([['2nd of 11', 'median +14.0%, 50 stocks'], ['1st of 11', 'median +9.0%, 50 stocks']])
    expect(rows[1].cells.map((c) => [c.text, c.sub])).toEqual([['3rd of 11', '50 stocks, climbed 1 place since'], ['4th of 11', '50 stocks, climbed 3 places since']])
    expect(rows[4].cells.map((c) => [c.text, c.sub])).toEqual([['1st of 11', 'Apr 18, 2031, 50 stocks'], ['1st of 11', 'Jun 4, 2031, 50 stocks']])
    expect(rows[5].cells.map((c) => c.text)).toEqual(['9th of 11', '10th of 11'])
    const geo = rankLine(d.rankDates, d.rank.m6.line, d.rank.m6.ofLine)
    expect([geo.top, geo.weeks, geo.best.position, geo.best.date, geo.worst.position, geo.last.of]).toEqual([11, 52, 1, '2031-04-18', 9, 11])
    expect(geo.path.split('M').length - 1).toBe(2)                         // the week with four stocks breaks the line once
    expect(rankLineWords(geo)).toBe('Rank by the median 6-month change each week, Jun 7, 2030 to Jun 4, 2031, 1st at the top: best 1st on Apr 18, 2031, '
      + 'worst 9th on Oct 25, 2030, latest 2nd of 11.')
    const few = readGroupDetail({ ...TECH_DETAIL, rank: { ...TECH_RANK, m6: { ...TECH_RANK.m6, now: { position: null, of: 11, n: 4, median: null, date: '2031-06-04' } } } })
    expect(rankSummary(few)).toBe('4 stocks with prices, fewer than 5: no rank')
    const still = readGroupDetail({ ...TECH_DETAIL, rank: { ...TECH_RANK, m6: { ...TECH_RANK.m6, w4: { ...TECH_RANK.m6.w4, change: 0 } } } })
    expect(rankSummary(still)).toBe('2nd of 11 by 6-month change (50 stocks); no change in 4 weeks, +3 places in 13 weeks')
    expect(rankRows(few)[0].cells[0]).toMatchObject({ text: '4 with prices', few: true })
    const pending = readGroupDetail({ ...TECH_DETAIL, sources: { ...TECH_DETAIL.sources, rank: undefined }, rank: null })
    expect([pending.rankState, rankSummary(pending), rankRows(pending)]).toEqual(['pending', 'appears after the next evening build', []])
    expect(rankSummary(readGroupDetail({ ...TECH_DETAIL, sources: { ...TECH_DETAIL.sources, rank: { state: 'unavailable' } } }))).toBe('not shown')
  })

  it('the words: places, places moved, a median change and the windows', () => {
    expect([placeText(1), placeText(22), placeText(113), placeText(0), placeText(null)]).toEqual(['1st', '22nd', '113th', null, null])
    expect([placesText(8), placesText(-3), placesText(0), placesText(null)]).toEqual(['+8', '-3', '0', null])
    expect([placesWords(1), placesWords(-2), placesWords(0)]).toEqual(['climbed 1 place', 'fell 2 places', 'held its place'])
    expect([changeText(14.23), changeText(-0.04), changeText(null)]).toEqual(['+14.2%', '0.0%', null])
    expect([rankWindowWords(126, 'm6'), rankWindowWords(null, 'm3')]).toEqual(['126 stored sessions (about six months)', 'about three months'])
  })
})
