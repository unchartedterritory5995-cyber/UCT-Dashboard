// ERNSC model: the route's answer read into states and rows, the order, the words a member reads, the argument words and
// the write-back. Fixtures are the route's real shape with invented figures.
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ERNSC_METRIC, DEFAULT_ERNSC_SEASON, ERNSC_CODE, ERNSC_METRIC_ARG_WORDS, ERNSC_SEASON_ARG_WORDS, countsLine, coverageLine,
  ernscCommand, ernscCommandArgs, figureText, medianWords, methodWords, moveText, moveWords, normErnscMetric, normErnscSeason,
  ofText, parseErnscMetric, parseErnscSeason, pctText, rateText, readSectorDetail, readSectorEarnings, reportedText, reportedWords,
  reporterLine, reporterSymbols, reporterWords, roseText, seasonLine, seasonOption, sectorDetailUrl, sectorEarningsUrl, sortReporters,
  sortSectors, stateTone, surpriseText, toneOf, triText, triWords, yearAgoLine,
} from './sectorEarningsModel'
import { COMPUTING, CURRENT, EMPTY, FAILED, NONE_YET, NOT_FOUND, TECH_DETAIL, UTIL_DETAIL, YEAR_AGO } from './__fixtures__/sectorEarningsFixture'

describe('the URL and the words', () => {
  it('one route, the season always named, a sector by its name; a word read the same as its value', () => {
    expect(ERNSC_CODE).toBe('ERNSC')
    expect(sectorEarningsUrl()).toBe('/api/research/sector-earnings?season=current')
    expect(sectorEarningsUrl({ season: 'YEARAGO' })).toBe('/api/research/sector-earnings?season=year_ago')
    expect(sectorEarningsUrl({ season: 'nope' })).toBe('/api/research/sector-earnings?season=current')
    expect(sectorDetailUrl({ season: 'previous', sector: 'Consumer Cyclical' })).toBe('/api/research/sector-earnings?season=previous&sector=Consumer%20Cyclical')
    expect(sectorDetailUrl({ sector: 'Oil & Gas' })).toBe('/api/research/sector-earnings?season=current&sector=Oil%20%26%20Gas')
    expect(ERNSC_SEASON_ARG_WORDS).toEqual({ PRIOR: 'previous', PREVIOUS: 'previous', YEARAGO: 'year_ago', LASTYEAR: 'year_ago' })
    expect(ERNSC_METRIC_ARG_WORDS).toEqual({ EPS: 'eps', REVENUE: 'revenue', REV: 'revenue', SALES: 'revenue' })
    expect([parseErnscSeason('prior'), parseErnscSeason(' lastyear '), parseErnscSeason('NOW'), parseErnscSeason('toString')]).toEqual(['previous', 'year_ago', null, null])
    expect([parseErnscMetric('eps'), parseErnscMetric('Sales'), parseErnscMetric('PE'), parseErnscMetric('constructor')]).toEqual(['eps', 'revenue', null, null])
    expect([normErnscSeason('year_ago'), normErnscSeason(null), normErnscSeason('PREVIOUS'), normErnscSeason('toString')]).toEqual(['year_ago', 'current', 'previous', 'current'])
    expect([normErnscMetric('revenue'), normErnscMetric(undefined), normErnscMetric('REV')]).toEqual(['revenue', 'eps', 'revenue'])
  })

  it('the write-back leaves each default out', () => {
    expect([DEFAULT_ERNSC_SEASON, DEFAULT_ERNSC_METRIC]).toEqual(['current', 'eps'])
    expect(ernscCommandArgs({})).toEqual([])
    expect(ernscCommandArgs({ season: 'previous' })).toEqual(['PRIOR'])
    expect(ernscCommandArgs({ metric: 'revenue' })).toEqual(['REVENUE'])
    expect(ernscCommandArgs({ season: 'year_ago', metric: 'revenue' })).toEqual(['YEARAGO', 'REVENUE'])
    expect(ernscCommand({ season: 'year_ago' })).toBe('ERNSC YEARAGO')
    expect(ernscCommand()).toBe('ERNSC')
  })

  it('numbers through the shared formatters; a missing one is null, never 0', () => {
    expect([rateText(62.5), rateText(0), rateText(null)]).toEqual(['63%', '0%', null])
    expect([pctText(4.2), pctText(-12), pctText(0), pctText(undefined)]).toEqual(['+4.2%', '-12.0%', '0.0%', null])
    expect([toneOf(3), toneOf(-1), toneOf(0), toneOf(null)]).toEqual(['up', 'down', null, null])
    expect([stateTone('beat'), stateTone('miss'), stateTone('in_line'), stateTone('none')]).toEqual(['up', 'down', null, null])
    expect([figureText(1.18, 'eps'), figureText(2.102e9, 'revenue'), figureText(null, 'eps')]).toEqual(['1.18', '2.10B', null])
    expect(ofText(1205)).toBe('of 1,205')
  })
})

describe('the answer', () => {
  it('⭐ an answer: the coverage, the seasons, the totals beside a year earlier, every sector in the server\'s order', () => {
    const v = readSectorEarnings(CURRENT)
    expect(v.state).toBe('ok')
    expect([v.season, v.today, v.inLinePct, v.inLineAbs, v.minReporters]).toEqual(['current', '2031-11-20', 0.5, 0.005, 5])
    expect(v.coverage).toEqual({ universe: 26, held: 24, notHeld: 2, noSector: 1, oldestCopy: '2031-11-12', newestCopy: '2031-11-20', copiesOld: 1, oldDays: 7 })
    expect(v.seasons.current).toEqual({ label: 'Q3 2031', from: '2031-10-01', to: '2031-12-31', through: '2031-11-20', complete: false })
    expect(v.seasons.year_ago.complete).toBe(true)
    expect(v.sectors.map((s) => s.name)).toEqual(['Healthcare', 'Technology', 'Energy', 'Utilities', 'Sector not on file'])
    const [health, tech, energy, util, none] = v.sectors
    expect([tech.reported, tech.toReport, tech.awaiting]).toEqual([8, 2, 1])
    expect(tech.eps).toEqual({ n: 8, beat: 5, inLine: 1, miss: 2, none: 0, beatPct: 62.5, inLinePct: 12.5, missPct: 25, median: 4.2, medianN: 7 })
    expect(tech.revenue).toMatchObject({ n: 6, beat: 5, miss: 1, none: 2, beatPct: 83.3, median: 1.05 })
    expect(tech.move).toEqual({ n: 6, median: 1.25, rose: 4, rosePct: 66.7, notSettled: 1, notMeasured: 1 })
    expect(tech.yearAgo.eps).toMatchObject({ n: 6, beatPct: 66.7 })
    expect(tech.yearAgo.yearAgo).toBeNull()
    expect(health.eps.beatPct).toBe(80)
    expect([energy.eps.beatPct, energy.eps.median, energy.move.median]).toEqual([null, null, null])
    expect([util.reported, util.toReport, util.yearAgo]).toEqual([0, 1, null])
    expect(none.onFile).toBe(false)
    expect(v.total).toMatchObject({ reported: 17, toReport: 3, awaiting: 1 })
    expect(v.total.eps).toMatchObject({ n: 17, beat: 12, inLine: 1, miss: 4, beatPct: 70.6, median: 1.5, medianN: 16 })
    expect(v.total.yearAgo.eps).toMatchObject({ n: 7, beatPct: 71.4 })
  })

  it('the other states, and a shape it cannot read', () => {
    expect(readSectorEarnings(COMPUTING).state).toBe('computing')
    expect(readSectorEarnings(FAILED)).toMatchObject({ state: 'failed', reason: 'error' })
    expect(readSectorEarnings({ status: 'unavailable' }).state).toBe('failed')
    expect(readSectorEarnings(EMPTY).state).toBe('empty')
    expect(readSectorEarnings(NONE_YET).state).toBe('none_yet')
    expect(readSectorEarnings(YEAR_AGO)).toMatchObject({ state: 'ok', season: 'year_ago' })
    for (const bad of [null, 'x', [], { status: 'ok' }, { status: 'ok', sectors: [] }, { status: 'error', detail: 'x' }, { ...CURRENT, total: null }]) {
      expect(readSectorEarnings(bad).state, JSON.stringify(bad)).toBe('bad_shape')
    }
    // a row the reader cannot use is left out; a missing count is 0 of a count, a missing share is null
    const v = readSectorEarnings({ ...CURRENT, sectors: [{ name: '' }, 7, { name: 'Odd' }] })
    expect(v.sectors.map((s) => s.name)).toEqual(['Odd'])
    expect(v.sectors[0]).toMatchObject({ reported: 0, eps: { n: 0, beatPct: null, median: null }, move: { n: 0, median: null }, yearAgo: null })
  })

  it('one sector: every reporter, the ones to come and the pending ones; not found; the other states', () => {
    const d = readSectorDetail(TECH_DETAIL)
    expect(d.state).toBe('ok')
    expect(d.sector.name).toBe('Technology')
    expect(d.sector.reporters).toHaveLength(8)
    expect(d.sector.reporters[0]).toEqual({ symbol: 'ZQKA', date: '2031-10-22', label: 'FY2031 Q3', epsAct: 1.18, epsEst: 1, epsPct: 18, epsAbs: null,
      epsState: 'beat', revAct: 2.102e9, revEst: 2e9, revPct: 5.1, revState: 'beat', move: 6.1, moveState: 'ok' })
    expect(d.sector.upcoming).toEqual([{ symbol: 'ZQKJ', date: '2031-11-25' }, { symbol: 'ZQKK', date: '2031-12-04' }])
    expect(d.sector.late).toEqual([{ symbol: 'ZQKL', date: '2031-11-12' }])
    expect(readSectorDetail(UTIL_DETAIL).sector.reporters).toEqual([])
    expect(readSectorDetail(NOT_FOUND).state).toBe('not_found')
    expect(readSectorDetail(COMPUTING).state).toBe('computing')
    expect(readSectorDetail({ status: 'ok', found: true, sector: { name: 'X' } }).state).toBe('bad_shape')
    // a move the server did not settle is never a number here
    const odd = readSectorDetail({ ...TECH_DETAIL, sector: { ...TECH_DETAIL.sector, reporters: [{ symbol: 'zqzz', move: 3, move_state: 'not_settled', eps_state: 'odd' }] } })
    expect(odd.sector.reporters[0]).toMatchObject({ symbol: 'ZQZZ', move: null, moveState: 'not_settled', epsState: 'none' })
  })
})

describe('order', () => {
  const v = readSectorEarnings(CURRENT)

  it('⭐ the sectors by the chosen measure\'s beat share; below the floor next; no sector on file last', () => {
    expect(sortSectors(v.sectors, 'eps').map((s) => s.name)).toEqual(['Healthcare', 'Technology', 'Energy', 'Utilities', 'Sector not on file'])
    expect(sortSectors(v.sectors, 'revenue').map((s) => s.name)).toEqual(['Technology', 'Healthcare', 'Energy', 'Utilities', 'Sector not on file'])
  })

  it('⭐ the biggest beats and misses first, an EPS estimate under 5 cents after them, no consensus last', () => {
    const reps = readSectorDetail(TECH_DETAIL).sector.reporters
    expect(sortReporters(reps, 'eps').map((r) => r.symbol)).toEqual(['ZQKA', 'ZQKG', 'ZQKB', 'ZQKC', 'ZQKD', 'ZQKF', 'ZQKE', 'ZQKH'])
    expect(sortReporters(reps, 'revenue').map((r) => r.symbol)).toEqual(['ZQKA', 'ZQKB', 'ZQKF', 'ZQKC', 'ZQKD', 'ZQKE', 'ZQKG', 'ZQKH'])
    expect(reporterSymbols(readSectorDetail(TECH_DETAIL), 'eps')[0]).toBe('ZQKA')
    expect(reporterSymbols(null, 'eps')).toEqual([])
  })
})

describe('what a member reads', () => {
  const v = readSectorEarnings(CURRENT)
  const [health, tech, energy, util] = v.sectors

  it('⭐ the header says first that it is only the stocks UCT holds results for, then the season', () => {
    expect(coverageLine(v)).toBe('Only the stocks UCT holds earnings results for: 24 of the 26 stocks in its universe, not every company that reports.')
    expect(seasonLine(v, 'current')).toBe('The Q3 2031 season: reports dated Oct 1 to Dec 31, 2031, so far through Nov 20, 2031.')
    expect(seasonLine(v, 'year_ago')).toBe('The Q3 2030 season: reports dated Oct 1 to Dec 31, 2030.')
    expect(seasonLine({ seasons: {} }, 'current')).toBe('')
    expect(countsLine(v.total)).toBe("17 stocks reported, 3 still to report later in the season, 1 past its report date with the result not in UCT's copy yet.")
    expect(seasonOption(v, 'previous')).toBe('The season before (Q2 2031)')
    expect(seasonOption(null, 'previous')).toBe('The season before')
  })

  it('the cells and their words: shares with their count, too few said, never 0', () => {
    expect(triText(tech.eps)).toBe('63 / 13 / 25%')
    expect(triText(energy.eps)).toBeNull()
    expect(triWords(tech.eps, 'eps')).toBe('63% beat, 13% in line, 25% missed the EPS consensus (5, 1 and 2 of 8 with a consensus)')
    expect(triWords(energy.eps, 'eps', 5)).toBe('3 reporters with an EPS consensus, fewer than 5, so no share')
    expect(triWords(util.eps, 'revenue')).toBe('0 reporters with a revenue consensus, fewer than 5, so no share')
    expect(medianWords(tech.eps, 'eps')).toBe('median EPS surprise +4.2%, over 7 reporters with a percent surprise')
    expect(medianWords(energy.eps, 'eps')).toBe('3 percent surprises, fewer than 5, so no median')
    expect(roseText(health.move)).toBe('60% of 5 rose')
    expect(roseText(energy.move)).toBe('3 measured')
    expect(moveWords(tech.move)).toBe('median move +1.3% from the close before the report to the close after, 67% rose (4 of 6); 1 not settled yet, 1 with no move held')
    expect(moveWords(energy.move)).toBe('3 measured moves, fewer than 5, so no median')
    expect(reportedText(tech)).toBe('8 reported, 2 to come, 1 pending')
    expect(reportedText(health)).toBe('5 reported')
    expect(reportedWords(util)).toBe('0 stocks reported, 1 still to report later in the season')
    expect(yearAgoLine(health.yearAgo, 'revenue', 'Q3 2030')).toBe('A year earlier (Q3 2030): 1 reporter with a revenue consensus, fewer than 5, '
      + 'so no share; 1 percent surprise, fewer than 5, so no median; 1 measured move, fewer than 5, so no median.')
  })

  it('a reporter: its surprise on the chosen measure, its line and its words', () => {
    const reps = readSectorDetail(TECH_DETAIL).sector.reporters
    const by = Object.fromEntries(reps.map((r) => [r.symbol, r]))
    expect([surpriseText(by.ZQKA, 'eps'), surpriseText(by.ZQKA, 'revenue'), surpriseText(by.ZQKH, 'eps'), surpriseText(by.ZQKH, 'revenue')])
      .toEqual(['+18.0%', '+5.1%', '+$0.02', null])
    expect(reporterLine(by.ZQKA, 'eps', '2031-11-20')).toBe('Oct 22 · 1.18 vs 1.00 · rev +5.1% · moved +6.1%')
    expect(reporterLine(by.ZQKA, 'revenue', '2031-11-20')).toBe('Oct 22 · 2.10B vs 2.00B · EPS +18.0% · moved +6.1%')
    expect(reporterLine(by.ZQKG, 'eps', '2031-11-20')).toBe('Nov 18 · 0.88 vs 1.00 · rev no consensus · move not settled')
    expect(reporterLine(by.ZQKH, 'eps', '2031-11-20')).toBe('Oct 30 · 0.04 vs 0.02 · rev no consensus · no move held')
    expect([moveText(by.ZQKA), moveText(by.ZQKG), moveText(by.ZQKH)]).toEqual(['moved +6.1%', 'move not settled', 'no move held'])
    expect(reporterWords(by.ZQKA)).toBe('Reported Oct 22, 2031 (FY2031 Q3). EPS 1.18 against 1.00 expected: +18.0%, a beat. '
      + 'Revenue 2.10B against 2.00B expected: +5.1%, a beat. The stock moved +6.1% from the close before the report to the close after.')
    expect(reporterWords(by.ZQKE)).toMatch(/: \+0\.3%, in line\./)
    expect(reporterWords(by.ZQKG)).toMatch(/Revenue 2\.05B, no comparable consensus\. The move is not settled yet in UCT's copy\.$/)
    expect(reporterWords({ ...by.ZQKG, epsAct: null, date: null })).toMatch(/^EPS: a miss\./)
  })

  it('the method: the season, the tolerance, the reaction, the floor, the sectors and the copies, in words', () => {
    const m = methodWords(v)
    expect(m).toMatch(/^How it is counted: a season is the reports dated in one calendar quarter/)
    expect(m).toMatch(/a surprise within 0\.5% either way is in line \(for an EPS estimate under 5 cents, within half a cent\)/)
    expect(m).toMatch(/A share or a median shows with at least 5 reporters\./)
    expect(m).toMatch(/1 stock has no sector on file and is counted on its own row\./)
    expect(m).toMatch(/UCT read these copies between Nov 12, 2031 and Nov 20, 2031 \(1 copy is more than 7 days old\)\.$/)
    expect(methodWords({ ...v, coverage: { ...v.coverage, oldestCopy: null, noSector: 0 } })).not.toMatch(/read these copies|no sector/)
  })
})
