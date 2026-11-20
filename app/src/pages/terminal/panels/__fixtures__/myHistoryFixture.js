// MYH test fixtures: the Journal routes' real shapes (api/services/journal_two: `_row_to_trade`,
// `_row_to_position`, `_row_to_strategy`, the notes list row), with made-up accounts, trades and
// notes. No member's data is in here.

export const account = (id, name, extra = {}) => ({
  id, userId: 'u-test', name, color: 'gold', broker: null, startingBalance: 100000.0, goals: {}, compassEnabled: true,
  balanceSource: 'manual', brokerTotalEquity: null, brokerCash: null, brokerBuyingPower: null, brokerMarketValue: null,
  brokerBalanceSyncedAt: null, createdAt: '2026-01-05T15:00:00+00:00', updatedAt: '2026-01-05T15:00:00+00:00', ...extra,
})
export const ONE_ACCOUNT = { accounts: [account('acc-1', 'Default')] }
export const TWO_ACCOUNTS = {
  accounts: [
    account('acc-1', 'Default'),
    account('acc-2', 'Broker account', { broker: 'Example Broker', balanceSource: 'broker', brokerTotalEquity: 52000.5, brokerBalanceSyncedAt: '2026-11-13T22:30:00+00:00' }),
  ],
}

/** A closed stock trade as GET /api/j2/trades sends it. */
export const trade = (id, over = {}) => ({
  id, userId: 'u-test', accountId: 'acc-1', positionId: null, symbol: 'NVDA', side: 'Long', shares: 100.0,
  entryPrice: 120.0, entryDate: '2026-10-01T16:00:00+00:00', exitPrice: 130.0, exitDate: '2026-10-08T16:00:00+00:00',
  originalStop: 115.0, setup: 'Breakout', notes: null, pnlDollar: 1000.0, pnlDollarGross: 1000.0, pnlDollarNet: 998.0, fees: 2.0,
  pnlPercent: 0.083333, rMultiple: 2.0, holdDays: 7, result: 'Win', contextAtEntry: {}, createdAt: '2026-10-08T20:05:00+00:00',
  mistakeTags: [], emotionTags: [], source: null, tradeRef: `id:${id}`, regime: null, analyticsExcluded: false,
  analyticsExcludedReason: null, ...over,
})

/** Five closed NVDA trades: three wins, one loss, one breakeven; the newest is a broker import with no stop. */
export const NVDA_TRADES = [
  trade('t5', {
    shares: 40.0, entryPrice: 160.0, entryDate: '2026-11-08T16:00:00+00:00', exitPrice: 171.0, exitDate: '2026-11-12T16:00:00+00:00',
    originalStop: 160.0, setup: null, pnlDollar: 440.0, pnlDollarGross: 440.0, pnlDollarNet: 440.0, fees: 0.0, pnlPercent: 0.06875,
    rMultiple: null, holdDays: 4, result: 'Win', source: 'broker', tradeRef: 'ext:example-1',
  }),
  trade('t4', {
    shares: 60.0, entryPrice: 150.0, entryDate: '2026-11-05T16:00:00+00:00', exitPrice: 150.0, exitDate: '2026-11-06T16:00:00+00:00',
    originalStop: 147.0, setup: null, pnlDollar: 0.0, pnlDollarGross: 0.0, pnlDollarNet: -1.0, fees: 1.0, pnlPercent: 0.0, rMultiple: 0.0,
    holdDays: 1, result: 'BE',
  }),
  trade('t3', {
    shares: 80.0, entryPrice: 125.0, entryDate: '2026-10-29T16:00:00+00:00', exitPrice: 131.25, exitDate: '2026-11-03T17:00:00+00:00',
    originalStop: 122.6, setup: 'Breakout', pnlDollar: 500.0, pnlDollarGross: 500.0, pnlDollarNet: 498.0, fees: 2.0, pnlPercent: 0.05,
    rMultiple: 2.6, holdDays: 5, result: 'Win',
  }),
  trade('t2', {
    shares: 50.0, entryPrice: 140.0, entryDate: '2026-10-17T16:00:00+00:00', exitPrice: 133.0, exitDate: '2026-10-20T16:00:00+00:00',
    originalStop: 135.0, setup: 'Pullback', pnlDollar: -350.0, pnlDollarGross: -350.0, pnlDollarNet: -352.0, fees: 2.0, pnlPercent: -0.05,
    rMultiple: -1.4, holdDays: 3, result: 'Loss',
  }),
  trade('t1'),
]
/** What the route answers for `symbol=NVDA`: a PREFIX match, so another ticker rides along. */
export const TRADES_BODY = {
  trades: [...NVDA_TRADES, trade('x1', { symbol: 'NVDAX', pnlDollar: 99999.0, pnlDollarNet: 99999.0, rMultiple: 50.0, result: 'Win' })],
  total: 6, limit: null, offset: null,
}

/** An open stock position as GET /api/j2/positions sends it. */
export const position = (id, over = {}) => ({
  id, userId: 'u-test', accountId: 'acc-1', symbol: 'NVDA', side: 'Long', entryDate: '2026-11-10T16:00:00+00:00', shares: 100.0,
  originalShares: 100.0, entryPrice: 120.5, stopPrice: 115.0, breakevenStop: null, raiseToBreakeven: false, setup: 'Breakout', notes: null,
  contextAtEntry: {}, createdAt: '2026-11-10T16:00:00+00:00', updatedAt: '2026-11-10T16:00:00+00:00', closedAt: null, source: null,
  entryEstimated: false, brokerPrice: null, brokerPricePrev: null, brokerPriceSession: null, brokerPrevSession: null, ...over,
})
export const POSITIONS_BODY = {
  positions: [position('p1'), position('p9', { symbol: 'AMD', shares: 20.0, entryPrice: 150.0, stopPrice: 144.0 })],
}

const leg = (over = {}) => ({
  id: 'leg-1', legIndex: 0, side: 'buy', contractType: 'call', strike: 140.0, expiration: '2026-12-18', qty: 2, entryPrice: 4.2,
  exitPrice: null, ...over,
})
/** An option strategy as GET /api/j2/options sends it. */
export const strategy = (id, over = {}) => ({
  id, userId: 'u-test', accountId: 'acc-1', underlying: 'NVDA', strategyType: 'long_call', direction: 'bullish', netEntry: 840.0, fees: 1.3,
  entryDate: '2026-11-11T16:00:00+00:00', setup: null, notes: null, contextAtEntry: {}, status: 'open', closedAt: null, netExit: null,
  exitFees: 0.0, pnlDollar: null, pnlPercent: null, rMultiple: null, result: null, linkedPlaybookId: null, parentStrategyId: null,
  createdAt: '2026-11-11T16:00:00+00:00', updatedAt: '2026-11-11T16:00:00+00:00', source: null, tradeRef: `id:${id}`,
  brokerCurrentValue: null, brokerCurrentValuePrev: null, brokerCurrentValuePrevSession: null, legs: [leg()], ...over,
})
export const OPEN_CALL = strategy('s-open')
export const CLOSED_CALL = strategy('s-closed', {
  status: 'closed', entryDate: '2026-09-02T16:00:00+00:00', closedAt: '2026-09-09T16:00:00+00:00', netEntry: 600.0, netExit: 900.0,
  exitFees: 1.3, pnlDollar: 297.4, pnlPercent: 0.4957, rMultiple: 0.4957, result: 'Win', setup: 'Earnings gap',
  legs: [leg({ id: 'leg-2', strike: 130.0, expiration: '2026-09-18', qty: 3, entryPrice: 2.0, exitPrice: 3.0 })],
})
export const EXPIRED_PUT = strategy('s-expired', {
  status: 'expired', strategyType: 'long_put', closedAt: '2026-08-21T16:00:00+00:00', netEntry: 150.0, netExit: 0.0, pnlDollar: -151.3,
  pnlPercent: -1.0, rMultiple: -1.0, result: 'Loss', legs: [leg({ id: 'leg-3', contractType: 'put', strike: 100.0, expiration: '2026-08-21', qty: 1, entryPrice: 1.5, exitPrice: 0.0 })],
})
export const OPEN_SPREAD = strategy('s-spread', {
  strategyType: 'vertical_credit_call', direction: 'bearish', netEntry: -220.0,
  legs: [
    leg({ id: 'leg-4', side: 'sell', strike: 150.0, qty: 1, entryPrice: 3.4 }),
    leg({ id: 'leg-5', legIndex: 1, side: 'buy', strike: 155.0, qty: 1, entryPrice: 1.2 }),
  ],
})
export const NO_OPTIONS_BODY = { strategies: [] }

/** A Notebook note as GET /api/j2/notes lists it (no body: the list never carries one). */
export const note = (id, title, updatedAt, over = {}) => ({
  id, userId: 'u-test', accountId: null, folderId: null, title, subtitle: null, bodyPlain: 'made-up preview text that is never drawn',
  heroImageUrl: null, firstImageUrl: null, ticker: 'NVDA', tags: [], createdAt: '2026-10-01T15:00:00+00:00', updatedAt, deletedAt: null,
  archivedAt: null, locked: false, propertiesJson: {}, ...over,
})
export const NOTES_BODY = {
  notes: [note('n2', 'NVDA plan into earnings', '2026-11-14T21:10:00+00:00'), note('n1', 'Why I sold NVDA too early', '2026-10-21T14:00:00+00:00')],
  total: 2, limit: 5, offset: 0,
}
