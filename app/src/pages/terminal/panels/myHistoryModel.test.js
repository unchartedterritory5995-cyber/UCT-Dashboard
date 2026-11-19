// MYH, the pure half. Rails:
//   * the URLs are the member's own Journal routes, and never carry a member id;
//   * the server's symbol filter is a PREFIX match, so every read is kept to exactly this ticker;
//   * ⭐ THE NUMBERS ARE THE JOURNAL'S: the stats equal the Journal's own `summaryStats` over the
//     same union its Trade Journal tab builds (stock trades + `optionClosedToRow` rows), and a
//     row's R is the row's own `rMultiple`;
//   * a trade with no stop logged has no R: it is left out of the average, never counted as zero,
//     and the sentence says how many trades the average covers;
//   * an open position: no real stop logged is null (never the broker's placeholder or a zero), a
//     placeholder date is "estimated", and with no price there is no unrealized result;
//   * the small-sample line is PERF's own wording.
import { describe, it, expect } from 'vitest'
import { positionPnlDollar, positionPnlPercent, summaryStats } from '../../../lib/journal-2-0'
import { optionClosedToRow } from '../../journal-2-0/lib/optionCalcs'
import { CONFIDENCE_MIN, performanceCommandArgs, sampleText } from './performanceModel'
import {
  MY_HISTORY_CODE, NOTES_LIMIT, NOTES_URL, NO_R_TEXT, OPTIONS_URL, POSITIONS_URL, TRADES_SHOWN, TRADES_URL, historySentence,
  historyStats, holdingRows, journalRows, myHistoryCommand, myHistoryCommandArgs, notesRead, notesUrl, optionsRead, optionsUrl,
  positionsRead, positionsUrl, rCoverageSentence, tradeRows, tradesRead, tradesUrl,
} from './myHistoryModel'
import {
  CLOSED_CALL, EXPIRED_PUT, NOTES_BODY, NVDA_TRADES, OPEN_CALL, OPEN_SPREAD, POSITIONS_BODY, TRADES_BODY, note, position, strategy, trade,
} from './__fixtures__/myHistoryFixture'

const byKey = (stats) => Object.fromEntries(stats.map((s) => [s.key, s]))

describe('MYH: the routes and the command', () => {
  it('the four data reads are the member\'s own Journal routes, filtered on the server where the route can', () => {
    expect(MY_HISTORY_CODE).toBe('MYH')
    expect([TRADES_URL, POSITIONS_URL, OPTIONS_URL, NOTES_URL]).toEqual(['/api/j2/trades', '/api/j2/positions', '/api/j2/options', '/api/j2/notes'])
    expect(tradesUrl({ sym: 'nvda' })).toBe('/api/j2/trades?symbol=NVDA')
    expect(tradesUrl({ sym: ' NVDA ', accountId: 'acc-1' })).toBe('/api/j2/trades?symbol=NVDA&account_id=acc-1')
    expect(positionsUrl()).toBe('/api/j2/positions')
    expect(positionsUrl({ accountId: 'a b&c' })).toBe('/api/j2/positions?account_id=a+b%26c')
    expect(optionsUrl({ sym: 'NVDA', accountId: 'acc-2' })).toBe('/api/j2/options?symbol=NVDA&account_id=acc-2')
    // the sample notebook's examples name real tickers: they are not the member's own notes
    expect(notesUrl({ sym: 'brk.b' })).toBe(`/api/j2/notes?ticker=BRK.B&limit=${NOTES_LIMIT}&excludeSample=1`)
    expect(NOTES_LIMIT).toBe(5)
    expect(TRADES_SHOWN).toBe(20)
  })

  it('no ticker, no request; and no URL can carry a member id', () => {
    for (const blank of [null, undefined, '', '   ']) {
      expect(tradesUrl({ sym: blank })).toBeNull()
      expect(optionsUrl({ sym: blank })).toBeNull()
      expect(notesUrl({ sym: blank })).toBeNull()
    }
    const all = [tradesUrl({ sym: 'NVDA', accountId: 'acc-1' }), positionsUrl({ accountId: 'acc-1' }), optionsUrl({ sym: 'NVDA' }), notesUrl({ sym: 'NVDA' })].join(' ')
    expect(all).not.toMatch(/user|member|uid/i)
    // the trades read sends no page limit: the numbers are the whole record on the stock
    expect(tradesUrl({ sym: 'NVDA' })).not.toMatch(/limit|offset/)
  })

  it('the account is typed and written back in PERF\'s words, by its place in the list', () => {
    expect(myHistoryCommand('nvda')).toBe('NVDA MYH')
    expect(myHistoryCommand('nvda', 'ZZ')).toBe('NVDA ZZ')
    for (const choice of ['all', 1, 2, 12, 'acc-2', null]) expect(myHistoryCommandArgs({ account: choice })).toEqual(performanceCommandArgs({ account: choice }))
    expect(myHistoryCommandArgs({ account: 'all' })).toEqual(['ALL'])
    expect(myHistoryCommandArgs({ account: 2 })).toEqual(['2'])
    expect(myHistoryCommandArgs({ account: 'acc-2' })).toEqual([])
  })
})

describe('MYH: every read is kept to exactly this ticker', () => {
  it('the trades route matches by prefix; another ticker that starts the same is never counted', () => {
    const out = tradesRead(TRADES_BODY, 'NVDA')
    expect(out.state).toBe('ok')
    expect(out.trades.map((t) => t.id)).toEqual(['t5', 't4', 't3', 't2', 't1'])
    expect(out.trades).toEqual(NVDA_TRADES)   // the Journal's own rows, untouched
    expect(tradesRead(TRADES_BODY, 'nvdax').trades.map((t) => t.id)).toEqual(['x1'])
    expect(tradesRead(TRADES_BODY, 'NVD').trades).toEqual([])
    // a lower-case or padded symbol on a row is still that ticker
    expect(tradesRead({ trades: [trade('a', { symbol: ' nvda ' })] }, 'NVDA').trades).toHaveLength(1)
  })

  it('a row with no result number is left out and counted, never read as zero', () => {
    const out = tradesRead({ trades: [trade('a'), trade('b', { pnlDollar: null }), trade('c', { pnlDollar: 'n/a' }), null, 'x'] }, 'NVDA')
    expect(out.trades.map((t) => t.id)).toEqual(['a'])
    expect(out.unreadable).toBe(2)
  })

  it('an answer that is not a list is a failed read, never an empty record', () => {
    for (const body of [undefined, null, [], 'x', {}, { trades: 'none' }, { detail: 'Not authenticated' }]) {
      expect(tradesRead(body, 'NVDA').state).toBe('failed')
      expect(positionsRead(body, 'NVDA').state).toBe('failed')
      expect(optionsRead(body, 'NVDA').state).toBe('failed')
      expect(notesRead(body).state).toBe('failed')
    }
    expect(tradesRead({ trades: [] }, 'NVDA')).toEqual({ state: 'ok', trades: [], unreadable: 0 })
  })

  it('positions and option strategies are kept to the ticker too, and options are split by how they ended', () => {
    expect(positionsRead(POSITIONS_BODY, 'NVDA').positions.map((p) => p.id)).toEqual(['p1'])
    expect(positionsRead(POSITIONS_BODY, 'TSLA')).toEqual({ state: 'ok', positions: [] })
    const body = { strategies: [OPEN_CALL, CLOSED_CALL, EXPIRED_PUT, strategy('s-roll', { status: 'rolled' }), strategy('s-other', { underlying: 'NVDAX' })] }
    const o = optionsRead(body, 'NVDA')
    expect(o.state).toBe('ok')
    expect(o.open.map((s) => s.id)).toEqual(['s-open'])
    expect(o.closed.map((s) => s.id)).toEqual(['s-closed'])
    expect(o.other).toBe(2)
  })

  it('notes keep a title, the dates and the link: a note\'s text is never kept', () => {
    const out = notesRead(NOTES_BODY)
    expect(out).toEqual({
      state: 'ok',
      total: 2,
      notes: [
        { id: 'n2', key: 'note-0-n2', title: 'NVDA plan into earnings', updated: '2026-11-14T21:10:00+00:00', created: '2026-10-01T15:00:00+00:00', href: '/journal/notebook?note=n2' },
        { id: 'n1', key: 'note-1-n1', title: 'Why I sold NVDA too early', updated: '2026-10-21T14:00:00+00:00', created: '2026-10-01T15:00:00+00:00', href: '/journal/notebook?note=n1' },
      ],
    })
    expect(JSON.stringify(out)).not.toContain('made-up preview text')
    // the route's own total, never the page length; an untitled note still has a name to click
    expect(notesRead({ notes: [note('a b', '', null)], total: 12 })).toMatchObject({ total: 12, notes: [{ title: 'Untitled note', href: '/journal/notebook?note=a%20b', updated: null }] })
    expect(notesRead({ notes: [note('a', 'x', null), { title: 'no id' }, null] }).total).toBe(1)
  })
})

describe('MYH: the numbers are the Journal\'s own', () => {
  it('⭐ the stats equal the Journal\'s summaryStats over the union its Trade Journal tab builds', () => {
    // The union, built here the way tabs/TradeJournalTab.jsx builds it (never through the model).
    const journalUnion = [...NVDA_TRADES, ...[CLOSED_CALL].map(optionClosedToRow)]
    const rows = journalRows({ trades: tradesRead(TRADES_BODY, 'NVDA').trades, closedStrategies: [CLOSED_CALL] })
    expect(rows).toEqual(journalUnion)
    const want = summaryStats(journalUnion)
    const got = historyStats(rows)
    expect(got.summary).toEqual(want)
    const s = byKey(got.stats)
    expect(s.trades.value).toBe(want.totalTrades)
    expect(s.winRate.value).toBe(want.winRate)
    expect(s.total.value).toBe(want.totalPnl)
    expect(s.average.value).toBe(want.avgPnlPerTrade)
    expect(s.best.value).toBe(want.largestWin)
    expect(s.worst.value).toBe(want.largestLoss)
    expect(s.hold.value).toBe(want.avgHold)
    // and the totals are the ones this fixture adds up to by hand
    expect(want.totalTrades).toBe(6)
    expect(want.totalPnl).toBeCloseTo(1887.4, 6)
    expect([want.wins, want.losses, want.bes]).toEqual([4, 1, 1])
    expect(got.options).toBe(1)
  })

  it('five stock trades: the count, the win rate over wins and losses, total, average, best, worst, hold', () => {
    const got = historyStats(journalRows({ trades: NVDA_TRADES }))
    const s = byKey(got.stats)
    expect(got.stats.map((x) => x.key)).toEqual(['trades', 'winRate', 'total', 'average', 'averageR', 'best', 'worst', 'hold'])
    expect(s.trades).toMatchObject({ value: 5, state: 'ok', note: '3 wins, 1 loss, 1 breakeven' })
    expect(s.winRate).toMatchObject({ value: 75, state: 'thin', n: 4, min: CONFIDENCE_MIN, of: 'wins and losses' })
    expect(s.total).toMatchObject({ value: 1590, state: 'ok', note: 'Before fees.' })
    expect(s.average).toMatchObject({ value: 318, state: 'thin', n: 5, of: 'trades' })
    expect(s.best).toMatchObject({ value: 1000, state: 'ok' })
    expect(s.worst).toMatchObject({ value: -350, state: 'ok' })
    expect(s.hold).toMatchObject({ value: 4, state: 'thin', n: 5 })
    expect(got.excluded).toBe(0)
  })

  it('⛔ a trade with no stop logged has no R: left out of the average, never counted as zero', () => {
    const got = historyStats(journalRows({ trades: NVDA_TRADES }))
    const s = byKey(got.stats)
    expect(got.r).toMatchObject({ known: 4, stockNoStop: 1, optionNoRisk: 0 })
    // (2.0 - 1.4 + 2.6 + 0.0) / 4, NOT / 5
    expect(s.averageR.value).toBeCloseTo(0.8, 10)
    expect(s.averageR).toMatchObject({ state: 'thin', n: 4, of: 'trades with a known R' })
    expect(rCoverageSentence(got.r, 5)).toBe('R is known for 4 of 5 trades. 1 stock trade has no stop logged (a broker import carries none), so it has no R and is left out of the average, never counted as zero.')
    // a breakeven trade's R of 0.0 IS a known R; only a missing one is not
    const none = historyStats([trade('a', { rMultiple: null }), trade('b', { rMultiple: null })])
    expect(byKey(none.stats).averageR).toMatchObject({ state: 'none', value: null, why: 'No trade here has a known R.' })
    expect(rCoverageSentence(none.r, 2)).toBe('R is known for 0 of 2 trades. 2 stock trades have no stop logged (a broker import carries none), so they have no R and are left out of the average, never counted as zero.')
    expect(rCoverageSentence(historyStats([]).r, 0)).toBe('')
    const opt = historyStats([optionClosedToRow({ ...CLOSED_CALL, rMultiple: null })])
    expect(rCoverageSentence(opt.r, 1)).toBe('R is known for 0 of 1 trade. 1 option trade has no set maximum risk, so no R either.')
    expect(rCoverageSentence(historyStats([trade('a')]).r, 1)).toBe('R is known for 1 of 1 trade.')
  })

  it('the small-sample line is PERF\'s own wording, and a large sample says where the number is from', () => {
    const s = byKey(historyStats(journalRows({ trades: NVDA_TRADES })).stats)
    expect(sampleText(s.winRate)).toBe('Small sample: 4 wins and losses, 10 needed.')
    expect(sampleText(s.average)).toBe('Small sample: 5 trades, 10 needed.')
    expect(sampleText(s.averageR)).toBe('Small sample: 4 trades with a known R, 10 needed.')
    const many = Array.from({ length: 12 }, (_, i) => trade(`m${i}`, { result: i % 3 ? 'Win' : 'Loss', pnlDollar: i % 3 ? 100 : -50, rMultiple: i % 3 ? 1 : -0.5 }))
    const big = byKey(historyStats(many).stats)
    expect(big.winRate).toMatchObject({ state: 'ok', n: 12 })
    expect(sampleText(big.winRate)).toBe('From 12 wins and losses.')
    expect(sampleText(big.averageR)).toBe('From 12 trades with a known R.')
  })

  it('nothing to work a number out from says what is missing, never zero', () => {
    const allBe = byKey(historyStats([trade('a', { result: 'BE', pnlDollar: 0 }), trade('b', { result: 'BE', pnlDollar: 0 })]).stats)
    expect(allBe.winRate).toMatchObject({ state: 'none', value: null, why: 'No winning or losing trades yet.' })
    expect(allBe.best).toMatchObject({ state: 'none', value: null, why: 'No winning trade yet.' })
    expect(allBe.worst).toMatchObject({ state: 'none', value: null, why: 'No losing trade yet.' })
    const empty = byKey(historyStats([]).stats)
    expect(empty.trades.value).toBe(0)
    expect(empty.average).toMatchObject({ state: 'none', value: null })
    expect(empty.hold).toMatchObject({ state: 'none', value: null })
  })

  it('the fees line says which trades are before fees; a trade the Journal leaves out of Analytics is counted and flagged', () => {
    expect(byKey(historyStats([optionClosedToRow(CLOSED_CALL)]).stats).total.note).toBe('After fees.')
    expect(byKey(historyStats(journalRows({ trades: NVDA_TRADES, closedStrategies: [CLOSED_CALL] })).stats).total.note)
      .toBe('Stock trades before fees, option trades after.')
    const got = historyStats([trade('a'), trade('b', { analyticsExcluded: true })])
    expect(got.summary.totalTrades).toBe(2)
    expect(got.excluded).toBe(1)
  })
})

describe('MYH: the closed-trade rows', () => {
  it('newest close first, each row the Journal\'s own numbers', () => {
    const rows = tradeRows(journalRows({ trades: [...NVDA_TRADES].reverse() }))
    expect(rows.map((r) => r.closed.slice(0, 10))).toEqual(['2026-11-12', '2026-11-06', '2026-11-03', '2026-10-20', '2026-10-08'])
    expect(rows[0]).toMatchObject({
      isOption: false, side: 'Long', size: 40, sizeUnit: 'share', fractional: false, entry: 160, exit: 171, result: 440, r: null,
      rWhy: 'no-stop', setup: null, name: null, several: false, excluded: false,
    })
    expect(rows[4]).toMatchObject({ result: 1000, r: 2.0, rWhy: null, setup: 'Breakout', opened: '2026-10-01T16:00:00+00:00' })
    for (const [i, t] of [...NVDA_TRADES].entries()) {
      expect(rows[i].result).toBe(t.pnlDollar)
      expect(rows[i].r).toBe(t.rMultiple)
    }
    expect(NO_R_TEXT).toEqual({ 'no-stop': 'No stop logged', 'no-risk': 'No set risk' })
    expect(tradeRows(null)).toEqual([])
  })

  it('an option trade is named the way the Journal names it; several legs never show one leg\'s prices', () => {
    const one = tradeRows(journalRows({ closedStrategies: [CLOSED_CALL] }), [CLOSED_CALL])[0]
    expect(one).toMatchObject({
      isOption: true, name: optionClosedToRow(CLOSED_CALL).symbol, side: 'Long Call', size: 3, sizeUnit: 'contract', entry: 2.0, exit: 3.0,
      result: 297.4, r: 0.4957, rWhy: null, setup: 'Earnings gap', several: false,
    })
    const spread = { ...OPEN_SPREAD, id: 's-spread-closed', status: 'closed', closedAt: '2026-11-01T16:00:00+00:00', pnlDollar: 120.0, rMultiple: null, result: 'Win' }
    const row = tradeRows(journalRows({ closedStrategies: [spread] }), [spread])[0]
    expect(row).toMatchObject({ several: true, entry: null, exit: null, side: 'Short', result: 120, r: null, rWhy: 'no-risk' })
    expect(row.name).toMatch(/^NVDA 150\/155 Call Credit Spread/)
    // a fractional share count is flagged so it prints as the Journal prints it
    expect(tradeRows([trade('f', { shares: 0.5 })])[0]).toMatchObject({ size: 0.5, fractional: true })
  })
})

describe('MYH: what is held now', () => {
  it('a stock position: entry, the real stop, and the Journal\'s own unrealized result at the live price', () => {
    const p = position('p1')
    const [h] = holdingRows({ positions: [p], prices: { NVDA: { price: 131.2 } } })
    expect(h).toMatchObject({
      kind: 'stock', side: 'Long', shares: 100, fractional: false, entry: 120.5, stop: 115, opened: '2026-11-10T16:00:00+00:00',
      dateEstimated: false, price: 131.2, priceFrom: 'live', accountId: 'acc-1',
    })
    expect(h.result).toBe(positionPnlDollar(p, 131.2))
    expect(h.resultFraction).toBe(positionPnlPercent(p, 131.2))
    expect(h.result).toBeCloseTo(1070, 6)
  })

  it('⛔ a broker import: no fake stop, no fake date, and the broker\'s mark only where the Journal uses it', () => {
    const imported = position('b1', { source: 'broker', stopPrice: 120.5, entryEstimated: true, brokerPrice: 129.0 })
    const [quiet] = holdingRows({ positions: [imported], prices: {} })
    expect(quiet).toMatchObject({ stop: null, opened: null, dateEstimated: true, price: 129.0, priceFrom: 'broker' })
    expect(quiet.result).toBeCloseTo(850, 6)
    // the live price leads while the market trades; the broker's mark leads once the Journal says so
    expect(holdingRows({ positions: [imported], prices: { NVDA: { price: 131.2 } } })[0]).toMatchObject({ price: 131.2, priceFrom: 'live' })
    expect(holdingRows({ positions: [imported], prices: { NVDA: { price: 131.2 } }, preferBroker: true })[0]).toMatchObject({ price: 129.0, priceFrom: 'broker' })
    // a manual position saved with no stop stores 0: that is no stop either, never "stop $0.00"
    expect(holdingRows({ positions: [position('m1', { stopPrice: 0 })] })[0].stop).toBeNull()
    // a stop raised to breakeven is the stop in force
    expect(holdingRows({ positions: [position('m2', { raiseToBreakeven: true, breakevenStop: 120.5 })] })[0].stop).toBe(120.5)
  })

  it('with no price there is no unrealized result, never a zero', () => {
    const [h] = holdingRows({ positions: [position('p1')], prices: {} })
    expect(h).toMatchObject({ price: null, priceFrom: null, result: null, resultFraction: null })
    expect(holdingRows({ positions: [position('p1')] })[0].result).toBeNull()
  })

  it('an open option position shows contracts and entry, and never a result', () => {
    const [call, spread] = holdingRows({ openStrategies: [OPEN_CALL, OPEN_SPREAD] })
    expect(call).toMatchObject({ kind: 'option', name: optionClosedToRow(OPEN_CALL).symbol, side: 'Long Call', contracts: 2, entry: 4.2, net: null })
    expect(spread).toMatchObject({ kind: 'option', side: 'Short', contracts: 1, entry: null, net: { kind: 'credit', amount: 220 } })
    expect(spread.name).toMatch(/^NVDA 150\/155 Call Credit Spread/)
    for (const h of [call, spread]) expect(h).not.toHaveProperty('result')
    expect(holdingRows()).toEqual([])
  })
})

describe('MYH: the sentence above the sections', () => {
  it('says what was read, and leaves out a read that has not answered', () => {
    expect(historySentence('nvda', { held: 1, trades: 5, notes: 2 })).toBe('You hold NVDA now. 5 closed trades on it. 2 notes name it.')
    expect(historySentence('NVDA', { held: 0, trades: 1, notes: 1 })).toBe('You do not hold NVDA now. 1 closed trade on it. 1 note names it.')
    expect(historySentence('NVDA', { held: 0, trades: 0, notes: 0 })).toBe('You do not hold NVDA now. No closed trades on it. No note names it.')
    expect(historySentence('NVDA', { held: null, trades: 3, notes: null })).toBe('3 closed trades on it.')
    expect(historySentence('NVDA')).toBe('')
  })
})
