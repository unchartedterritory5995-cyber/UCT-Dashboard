// EEHSC model: the route's answer read into states and rows, the words a member reads, the argument words and the
// write-back. Fixtures are the route's real shape with invented figures.
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_EEHSC_METRIC, DEFAULT_EEHSC_WINDOW, EEHSC_CODE, EEHSC_METRIC_ARG_WORDS, EEHSC_WINDOW_ARG_WORDS, changeWords, collectingWords,
  countedSymbols, countedText, countsText, countsWords, coverageLine, eehscCommand, eehscCommandArgs, estimateText, netText, netWords,
  normEehscMetric, normEehscWindow, originWords, parseEehscMetric, parseEehscWindow, pctText, plusDays, readRevisionBreadth,
  revisionBreadthUrl, sectorGroups, toneOf, totalLine, trackedLine, windowLine,
} from './revisionBreadthModel'
import { COLLECTING_30, COMPUTING, EMPTY, EPS_30, FAILED, REV_7 } from './__fixtures__/revisionBreadthFixture'

describe('the URL and the words', () => {
  it('one route, the estimate and window always named, a word read the same as its value', () => {
    expect(EEHSC_CODE).toBe('EEHSC')
    expect(revisionBreadthUrl()).toBe('/api/research/estimate-history?metric=eps&window=30')
    expect(revisionBreadthUrl({ metric: 'revenue', window: 7 })).toBe('/api/research/estimate-history?metric=revenue&window=7')
    expect(revisionBreadthUrl({ metric: 'REV', window: '1W' })).toBe('/api/research/estimate-history?metric=revenue&window=7')
    expect(revisionBreadthUrl({ metric: 'nope', window: 14 })).toBe('/api/research/estimate-history?metric=eps&window=30')
    expect(EEHSC_WINDOW_ARG_WORDS).toEqual({ '7D': 7, '1W': 7, '30D': 30, '1M': 30 })
    expect(EEHSC_METRIC_ARG_WORDS).toEqual({ EPS: 'eps', REVENUE: 'revenue', REV: 'revenue', SALES: 'revenue' })
    expect([parseEehscWindow('7d'), parseEehscWindow(' 1m '), parseEehscWindow('14D'), parseEehscWindow('toString')]).toEqual([7, 30, null, null])
    expect([parseEehscMetric('eps'), parseEehscMetric('Sales'), parseEehscMetric('PE'), parseEehscMetric('constructor')]).toEqual(['eps', 'revenue', null, null])
    expect([normEehscWindow(7), normEehscWindow('7'), normEehscWindow(null), normEehscWindow(14)]).toEqual([7, 7, 30, 30])
    expect([normEehscMetric('revenue'), normEehscMetric(undefined), normEehscMetric('SALES')]).toEqual(['revenue', 'eps', 'revenue'])
  })

  it('the write-back leaves each default out', () => {
    expect([DEFAULT_EEHSC_WINDOW, DEFAULT_EEHSC_METRIC]).toEqual([30, 'eps'])
    expect(eehscCommandArgs({})).toEqual([])
    expect(eehscCommandArgs({ window: 7 })).toEqual(['7D'])
    expect(eehscCommandArgs({ metric: 'revenue' })).toEqual(['REVENUE'])
    expect(eehscCommandArgs({ metric: 'revenue', window: 7 })).toEqual(['7D', 'REVENUE'])
    expect(eehscCommand({ window: 7 })).toBe('EEHSC 7D')
    expect(eehscCommand()).toBe('EEHSC')
  })

  it('numbers through the shared formatters; a missing one is null, never 0', () => {
    expect([netText(50), netText(-60), netText(0), netText(null)]).toEqual(['+50%', '-60%', '0%', null])
    expect([pctText(20), pctText(-12.5), pctText(0), pctText(undefined)]).toEqual(['+20.0%', '-12.5%', '0.0%', null])
    expect([estimateText(1.2, 'eps'), estimateText(-0.4, 'eps'), estimateText(2.6e9, 'revenue'), estimateText(null, 'eps')])
      .toEqual(['1.20', '-0.40', '2.60B', null])
    expect([toneOf(3), toneOf(-1), toneOf(0), toneOf(null)]).toEqual(['up', 'down', null, null])
    expect(plusDays('2031-01-05', 30)).toBe('2031-02-04')
    expect(plusDays('nope', 3)).toBeNull()
  })
})

describe('the answer', () => {
  it('⭐ an answer: the tracked count and where it came from, the totals, every sector in the server\'s order', () => {
    const v = readRevisionBreadth(EPS_30)
    expect(v.state).toBe('ok')
    expect([v.metric, v.window, v.asof, v.coversFrom, v.tolerancePct, v.minCounted]).toEqual(['eps', 30, '2031-03-14', '2031-01-05', 0.5, 5])
    expect(v.tracked).toEqual({ n: 23, cap: 600, sp500: 18, viewed: 5, noSector: 2 })
    expect(v.sectors.map((s) => s.name)).toEqual(['Technology', 'Healthcare', 'Energy', 'Utilities', 'Sector not on file'])
    const [tech, , energy, util, none] = v.sectors
    expect([tech.members, tech.counted, tech.up, tech.down, tech.held, tech.net]).toEqual([7, 6, 4, 1, 1, 50])
    expect(tech.notCounted).toEqual({ collecting: 1, gap: 0, notComparable: 0 })
    expect(tech.raises.map((x) => x.symbol)).toEqual(['ZQTA', 'ZQTB', 'ZQTC'])
    expect(energy.cuts.map((x) => x.symbol)).toEqual(['ZQEA', 'ZQEB', 'ZQEC'])
    expect(util.net).toBeNull()
    expect(none.onFile).toBe(false)
    expect(v.total).toMatchObject({ members: 23, counted: 19, up: 9, down: 6, held: 4, net: 15.8 })
    expect(v.total.notCounted).toEqual({ collecting: 2, gap: 1, notComparable: 1 })
    expect(tech.symbols[0]).toEqual({ symbol: 'ZQTA', state: 'up', pct: 20, from: 1, to: 1.2, fromDate: '2031-02-12', toDate: '2031-03-14', periodEnd: '2031-03-31', reason: null })
  })

  it('the other states, and a shape it cannot read', () => {
    expect(readRevisionBreadth(COMPUTING).state).toBe('computing')
    expect(readRevisionBreadth(FAILED)).toMatchObject({ state: 'failed', reason: 'error' })
    expect(readRevisionBreadth({ status: 'unavailable' }).state).toBe('failed')
    expect(readRevisionBreadth(EMPTY).state).toBe('empty')
    expect(readRevisionBreadth(COLLECTING_30).state).toBe('collecting')
    for (const bad of [null, 'x', [], { status: 'ok' }, { status: 'ok', sectors: [] }, { status: 'error', detail: 'x' }]) {
      expect(readRevisionBreadth(bad).state, JSON.stringify(bad)).toBe('bad_shape')
    }
    // a row the reader cannot use is left out; a symbol with a state it does not know is left out
    const v = readRevisionBreadth({ ...EPS_30, sectors: [{ name: '' }, 7, { ...EPS_30.sectors[0], symbols: [{ symbol: 'ZQZZ', state: 'odd' }, ...EPS_30.sectors[0].symbols] }] })
    expect(v.sectors.map((s) => s.name)).toEqual(['Technology'])
    expect(v.sectors[0].symbols).toHaveLength(7)
  })

  it('a missing count is 0 of a count, a missing net is null', () => {
    const v = readRevisionBreadth({ ...EPS_30, total: {}, sectors: [{ name: 'Odd' }] })
    expect(v.total).toMatchObject({ counted: 0, net: null })
    expect(v.sectors[0]).toMatchObject({ members: 0, counted: 0, net: null, raises: [], cuts: [], symbols: [] })
    expect(v.state).toBe('collecting')
  })
})

describe('what a member reads', () => {
  const v = readRevisionBreadth(EPS_30)

  it('⭐ the header says first that it is only the stocks UCT tracks, with N, the window and the newest snapshot', () => {
    expect(trackedLine(v)).toBe('Among the 23 stocks UCT tracks (the S&P 500 list and stocks members have looked at), not the whole market.')
    expect(trackedLine({ tracked: { n: 4, sp500: 0, viewed: 4 } })).toBe('Among the 4 stocks UCT tracks (stocks members have looked at), not the whole market.')
    expect(trackedLine({ tracked: { n: 1, sp500: 1, viewed: 0 } })).toBe('Among the 1 stock UCT tracks (the S&P 500 list), not the whole market.')
    expect(windowLine(v, 'eps', 30)).toBe('Next-quarter EPS estimates, the change over 30 days to Mar 14, 2031 (the newest snapshot).')
    expect(windowLine(readRevisionBreadth(REV_7), 'revenue', 7)).toBe('Next-quarter revenue estimates, the change over 7 days to Mar 14, 2031 (the newest snapshot).')
  })

  it('coverage, totals, rows and a sector with too few', () => {
    expect(coverageLine(v.total)).toBe('19 counted; 2 still collecting, 1 with a gap in its snapshots, 1 with no comparable estimate.')
    expect(coverageLine({ counted: 5, notCounted: { collecting: 0, gap: 2, notComparable: 0 } })).toBe('5 counted; 2 with a gap in their snapshots.')
    expect(coverageLine({ counted: 5, notCounted: { collecting: 0, gap: 0, notComparable: 0 } })).toBe('5 counted.')
    expect(totalLine(v)).toBe('All tracked stocks: net +16% (9 raised, 6 cut, 4 held; 19 counted).')
    const [tech, , , util] = v.sectors
    expect(countsText(tech)).toBe('4 / 1 / 1')
    expect(countsWords(tech)).toBe('4 raised, 1 cut, 1 held')
    expect(countedText(tech)).toBe('6 of 7 counted')
    expect(netWords(util, 5)).toBe('2 stocks counted, fewer than 5, so no net figure')
    expect(netWords(tech, 5)).toBe('net +50% (4 raised, 1 cut, 1 held; 6 counted)')
  })

  it('an opened sector: the counted stocks largest raise first, the rest by reason, and a change in words', () => {
    const [tech, health, energy] = v.sectors
    const g = sectorGroups(tech)
    expect(g.counted.map((s) => s.symbol)).toEqual(['ZQTA', 'ZQTB', 'ZQTC', 'ZQTD', 'ZQTE', 'ZQTF'])
    expect(g.rest.map((r) => [r.state, r.symbols.map((s) => s.symbol)])).toEqual([['collecting', ['ZQTG']]])
    expect(sectorGroups(health).rest[0].words).toBe('A gap in the snapshots: none near one end of the window')
    expect(sectorGroups(energy).rest[0].state).toBe('not_comparable')
    expect(changeWords(tech.symbols[0], 'eps')).toBe('+20.0%, 1.00 to 1.20 (Feb 12, 2031 to Mar 14, 2031)')
    const rev = readRevisionBreadth(REV_7).sectors[0].symbols[0]
    expect(changeWords(rev, 'revenue')).toBe('+4.0%, 2.50B to 2.60B (Mar 7, 2031 to Mar 14, 2031)')
    expect(countedSymbols(v)).toEqual(['ZQTA', 'ZQTB', 'ZQTC', 'ZQTD', 'ZQTE', 'ZQTF', 'ZQHA', 'ZQHB', 'ZQHC', 'ZQHD', 'ZQHE',
      'ZQEA', 'ZQEB', 'ZQEC', 'ZQED', 'ZQEE', 'ZQUA', 'ZQUB', 'ZQXA'])
    expect(countedSymbols(null)).toEqual([])
  })

  it('where the tracked stocks came from, and when the first changes are due', () => {
    expect(originWords(v)).toBe('18 from the S&P 500 list the daily job follows, 5 added when a member opened their estimate history (at most 600). 2 stocks have no sector on file and are listed on their own row.')
    expect(originWords({ tracked: { sp500: 0, viewed: 1, cap: null, noSector: 1 } })).toBe('1 added when a member opened its estimate history. 1 stock has no sector on file and is listed on its own row.')
    const c = readRevisionBreadth(COLLECTING_30)
    expect(collectingWords(c, 30)).toBe('Snapshots began on Mar 2, 2031, so the first 30-day changes are due from about Apr 1, 2031.')
    expect(collectingWords({ coversFrom: null }, 7)).toBe('No snapshot has been taken yet. The daily job adds one each weekday evening, and history begins with the first.')
  })
})
