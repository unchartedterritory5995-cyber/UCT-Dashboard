// A currency pair (Bitcoin, BTC/USD) in the terminal: the pure half of CurrencyPairPanel.jsx.
//
// A pair is not a company. Two one-security functions are true for it: GP (the chart) and DES
// (its price). Every other one-security function says, in one plain sentence, that it has
// nothing for a pair, and why where the reason is a fact about pairs.
import { PAIR_TFS, pairPrice } from '../../../lib/cryptoPairs'
import { barsUrl } from '../../../data/barStore/network'
import { keyOf } from '../../../data/barStore/types'

/** What each panel name draws for a pair. Anything not named here draws the sentence. */
export const PAIR_VIEWS = Object.freeze({ Chart: 'chart', Overview: 'quote' })
export const pairViewOf = (panel) => (Object.hasOwn(PAIR_VIEWS, panel ?? '') ? PAIR_VIEWS[panel] : 'none')

/** Things only a company has: `<name> is a currency pair, not a company, so it has no <these>.` */
export const COMPANY_ONLY = Object.freeze({
  Financials: 'financial statements',
  Estimates: 'earnings estimates',
  EstimateHistory: 'earnings estimates',
  Calendar: 'earnings reports',
  EarningsReaction: 'earnings reports',
  ExpectedMove: 'earnings reports',
  Calls: 'earnings calls',
  Ownership: 'ownership filings',
  People: 'executives or insiders',
  Filings: 'SEC filings',
  FilingsFeed: 'SEC filings',
  FilingChanges: 'SEC filings',
  FilingSearch: 'SEC filings',
  Dilution: 'share-issuance filings',
  ShortInterest: 'short interest reports',
  Ftd: 'fails-to-deliver reports',
  AnalystRatings: 'analyst ratings of a company',
  Peer: 'company peers',
  Etf: 'fund holdings',
})

/** Panels that read this site's options data, which carries no currency pair. */
export const OPTIONS_PANELS = Object.freeze(new Set([
  'OptionsChain', 'IvHistory', 'VolStats', 'Positioning', 'OptionsHistory', 'Backtest', 'Flow', 'Levels',
]))

/** Pure: the one sentence a panel shows for a pair it has nothing for. */
export function pairSentence(panel, pair) {
  const sym = pair?.symbol || 'This symbol'
  const name = pair?.name && pair.name !== sym ? `${pair.name} (${sym})` : sym
  if (Object.hasOwn(COMPANY_ONLY, panel ?? '')) return `${name} is a currency pair, not a company, so it has no ${COMPANY_ONLY[panel]}.`
  if (OPTIONS_PANELS.has(panel)) return `This site has no options data for a currency pair such as ${sym}.`
  return `This panel is not available for a currency pair such as ${sym}.`
}

/** Pure: the timeframe the pair chart draws, and whether the one typed was not carried. */
export function pairChartTf(tf) {
  const typed = typeof tf === 'string' && tf ? tf.toUpperCase() : 'D'
  const carried = PAIR_TFS.includes(typed)
  return { tf: carried ? typed : 'D', refused: carried ? null : typed }
}

export const PAIR_TF_NOTE = 'A currency pair is charted on daily, weekly and monthly bars only, so this is the daily chart.'
/** Pure: why this chart has weekend bars, and what one daily bar is. */
export const pairDayNote = (pair) => `${pair?.name || 'A currency pair'} trades every day, around the clock, so its chart has a bar for Saturdays and Sundays too. Each daily bar is one calendar day as ${pair?.source || 'FMP'} dates it.`

/** Where the chart panel reads its as-of date: the daily chart's own first-paint address, from
 *  the bar store's address builder (`barsUrl`), so the panel and the chart ask the same question
 *  and this file spells no bars address of its own. */
export const pairNewestBarUrl = (sym) => barsUrl(keyOf({ sym, tf: 'D' }))

/** Pure: the newest daily bar's own day (`2026-11-14`) from that answer, or null. */
export function newestBarDay(body) {
  const bars = body && typeof body === 'object' && Array.isArray(body.bars) ? body.bars : []
  const t = bars.length ? bars[bars.length - 1]?.t : null
  return typeof t === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null
}

/** Pure: the quote's facts as `[label, text]` rows. A field FMP did not send is left out,
 *  never drawn as 0. */
export function quoteFacts(quote) {
  if (!quote || typeof quote !== 'object') return []
  const rows = [
    ['Open', pairPrice(quote.open)],
    ['Day high', pairPrice(quote.day_high)],
    ['Day low', pairPrice(quote.day_low)],
    ['Previous close', pairPrice(quote.prev_close)],
    ['52-week high', pairPrice(quote.year_high)],
    ['52-week low', pairPrice(quote.year_low)],
  ]
  return rows.filter(([, v]) => v != null)
}
