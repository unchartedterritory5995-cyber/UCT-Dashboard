// app/src/components/chart/engine/otherSymbols.js
//
// ─── ⭐⭐ C26 — WHICH OTHER SYMBOLS A PINE DOCUMENT MAY READ ON THIS CHART ─────
//
// `request.security("AMEX:SPY", timeframe.period, close)` translates to a `sym`
// node (`pine.js::securityAsNode`), and `interpret` reads it off the series the
// CALLER supplies (`opts.symbols[ticker]`) — aligned on the bar's own `t`, exact
// match, never forward-filled. What neither of those can answer is WHICH
// INSTRUMENT the script means, because that is a fact about two outside worlds:
// the spelling TradingView resolves, and the listing our store holds. This module
// is the one place that joins them, at BIND time, per chart:
//
//   served  ⇔  the script spelled an EXCHANGE (`"AMEX:SPY"`, `ticker.new("AMEX",
//              "SPY")`, or `syminfo.prefix` — the chart's own, settled here)
//           ∧  our store holds a listing of that ticker whose exchange has a
//              WITNESSED Pine spelling (`symbolScope.json::confirmed`, read
//              through `bind.js::SYMBOL_EXCHANGE_CONFIRMED` — one authority)
//           ∧  that spelling IS the one the script wrote
//           ∧  the listing's bars for THIS chart's timeframe are in hand.
//
// Everything else is REFUSED BY NAME and the ticker is never supplied, so its
// `sym` column is not computable (plots) and unknown (objects) — never a guess.
//
// ⛔⛔ A BARE TICKER (`"SPY"`) IS REFUSED, AND THAT IS NOT CAUTION FOR ITS OWN
// SAKE. Which listing TradingView resolves an unprefixed string to inside
// `request.security` is unmeasured, and the corpus shows why it matters: bare
// `"ADVN"`, `"DECN"`, `"EURUSD"`, `"XAUUSD"`, `"BANKNIFTY"` are indices, pairs and
// foreign benchmarks, not US listings — a store that happened to hold an equity
// under one of those letters would draw the wrong instrument under the right
// name. The refusal names the spelling that WOULD be served when our store's
// listing is confirmed (`AMEX:SPY`), so the member's fix is one edit.
//
// ⛔ A CLASS SHARE (`BRK.B`) IS REFUSED: TradingView writes the dot, the store's
// bars route keys the hyphen, and no capture pins that the two are one series.

import { SYMBOL_EXCHANGE_CONFIRMED } from './ast/bind'

/** The venue spelling `pine.js::otherSymbolOf` records for the chart's own
 *  exchange (`ticker.new(syminfo.prefix, …)`). */
export const CHART_PREFIX_VENUE = '@syminfo.prefix'

/** Why an other-symbol read is not served — one code per sentence, so a rail and
 *  a surface can name the reason without matching prose. */
export const OTHER_SYMBOL_REFUSAL = Object.freeze({
  BARE: 'other-symbol:bare',
  VENUE_UNREADABLE: 'other-symbol:venue-unreadable',
  VENUE_UNCONFIRMED: 'other-symbol:venue-unconfirmed',
  VENUE_MISMATCH: 'other-symbol:venue-mismatch',
  CHART_PREFIX: 'other-symbol:chart-prefix-unconfirmed',
  CLASS_SHARE: 'other-symbol:class-share',
  NOT_HELD: 'other-symbol:not-held',
  EXCHANGE_UNCONFIRMED: 'other-symbol:exchange-unconfirmed',
  NO_BARS: 'other-symbol:no-bars',
  UNSPELLED: 'other-symbol:unspelled',
  FRAMED: 'other-symbol:framed',
})

const CONFIRMED_PINE = new Set(Object.values(SYMBOL_EXCHANGE_CONFIRMED))

/** Every ticker a document's trees read through a `sym` node — plots, object
 *  trees and graph nodes alike. Iterative (a deep tree must not overflow). */
export function symTickersOf(def) {
  const out = new Set()
  const stack = []
  const c = def && def.compute
  if (c) stack.push(c.ast, c.trees, c.graph && c.graph.nodes)
  const o = def && def.objects
  if (o) stack.push(o.trees)
  const seen = new Set()
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object' || seen.has(n)) continue
    seen.add(n)
    if (Array.isArray(n)) { for (const x of n) stack.push(x); continue }
    if (n.type === 'sym' && typeof n.value === 'string') out.add(n.value.trim().toUpperCase())
    for (const k of Object.keys(n)) {
      const v = n[k]
      if (v && typeof v === 'object') stack.push(v)
    }
  }
  return [...out].sort()
}

/** `{ticker, spellings}` for every ticker the document reads, from the spelling
 *  table the member door stamped (`meta.otherSymbols`). A ticker a tree reads
 *  with no recorded spelling (a document saved before C26) is listed with none —
 *  and refused, because its spelling cannot be checked. */
export function otherSymbolRequestsOf(def) {
  const recorded = new Map()
  for (const r of (def && def.meta && def.meta.otherSymbols) || []) {
    if (!r || typeof r.ticker !== 'string') continue
    recorded.set(r.ticker.trim().toUpperCase(), Array.isArray(r.spellings) ? r.spellings : [])
  }
  const tickers = new Set([...symTickersOf(def), ...recorded.keys()])
  return [...tickers].sort().map((ticker) => ({ ticker, spellings: recorded.get(ticker) || [] }))
}

/** The tickers worth FETCHING for a document: those whose every recorded
 *  spelling could be served (a witnessed exchange, or the chart's own prefix) —
 *  so a chart never asks the bars route for `EURUSD` or `"SPY"` spelled bare,
 *  which the bind would refuse whatever arrived. Everything else is still
 *  decided (and named) by `resolveOtherSymbols`; this only saves the request. */
export function fetchableOtherSymbols(def) {
  if (!def || !def.meta || !Array.isArray(def.meta.otherSymbols)) return []
  const out = []
  for (const { ticker, spellings } of otherSymbolRequestsOf(def)) {
    if (!spellings.length || /[.\-]/.test(ticker)) continue
    if (spellings.every((v) => v === CHART_PREFIX_VENUE || CONFIRMED_PINE.has(v))) out.push(ticker)
  }
  return out
}

/** The Pine prefix a STORE exchange spelling answers to, or null. */
function pineOf(exchange, confirmed) {
  const e = typeof exchange === 'string' ? exchange.trim() : ''
  return e && Object.prototype.hasOwnProperty.call(confirmed, e) ? confirmed[e] : null
}

/**
 * Decide, for ONE binding, which of a document's other symbols are served.
 *
 * @param {object} def  an installed definition
 * @param {object} ctx
 *   `secondary`  Map ticker → `{bars, status, exchange?}` — the chart's secondary
 *                bars (`useSecondarySources`), same timeframe as the chart;
 *   `exchangeOf` (ticker) → our store's exchange spelling, or null;
 *   `symbol`     the chart's own `{ticker, exchange}`;
 *   `framed`     true when the instance computes on a calculation-timeframe frame.
 * @param {object} [confirmed] store exchange → Pine prefix (test seam)
 * @returns {{symbols: object, served: string[], refused: {ticker, code, reason}[]}}
 */
export function resolveOtherSymbols(def, ctx = {}, confirmed = SYMBOL_EXCHANGE_CONFIRMED) {
  const symbols = {}
  const served = []
  const refused = []
  const requests = otherSymbolRequestsOf(def)
  if (!requests.length) return { symbols, served, refused }
  const confirmedPine = confirmed === SYMBOL_EXCHANGE_CONFIRMED
    ? CONFIRMED_PINE : new Set(Object.values(confirmed))
  const chartPine = pineOf(ctx.symbol && ctx.symbol.exchange, confirmed)
  const secondary = ctx.secondary && typeof ctx.secondary.get === 'function' ? ctx.secondary : null
  const exchangeOf = typeof ctx.exchangeOf === 'function' ? ctx.exchangeOf : () => null
  const no = (ticker, code, reason) => refused.push({ ticker, code, reason })

  for (const { ticker, spellings } of requests) {
    if (ctx.framed === true) {
      no(ticker, OTHER_SYMBOL_REFUSAL.FRAMED, `\`${ticker}\` is read on the chart's own timeframe, `
        + 'and this indicator computes on a different calculation timeframe')
      continue
    }
    if (!spellings.length) {
      no(ticker, OTHER_SYMBOL_REFUSAL.UNSPELLED, `the spelling this script used for \`${ticker}\` `
        + 'was not recorded (the indicator was saved before it was) — re-open the script to record it')
      continue
    }
    if (/[.\-]/.test(ticker)) {
      no(ticker, OTHER_SYMBOL_REFUSAL.CLASS_SHARE, `\`${ticker}\` is a class share, and which of our `
        + 'listings TradingView’s spelling of it names is unmeasured')
      continue
    }
    const entry = secondary ? secondary.get(ticker) : null
    const stored = (entry && typeof entry.exchange === 'string' && entry.exchange) || exchangeOf(ticker)
    const pine = pineOf(stored, confirmed)
    let why = null
    for (const venue of spellings) {
      if (venue === '') {
        why = [OTHER_SYMBOL_REFUSAL.BARE, `\`"${ticker}"\` names no exchange, and which listing `
          + 'TradingView resolves an unprefixed ticker to inside `request.security` is unmeasured'
          + (pine ? ` — write \`"${pine}:${ticker}"\`, the listing this chart would read` : '')]
        break
      }
      if (venue === '?') {
        why = [OTHER_SYMBOL_REFUSAL.VENUE_UNREADABLE, `the exchange this script names for \`${ticker}\` `
          + 'is computed, so which listing it means cannot be read before the chart runs']
        break
      }
      const want = venue === CHART_PREFIX_VENUE ? chartPine : venue
      if (venue === CHART_PREFIX_VENUE && !want) {
        why = [OTHER_SYMBOL_REFUSAL.CHART_PREFIX, `\`${ticker}\` is spelled with this chart's own `
          + 'exchange (`syminfo.prefix`), and this chart’s exchange has no witnessed Pine spelling']
        break
      }
      if (!confirmedPine.has(want)) {
        why = [OTHER_SYMBOL_REFUSAL.VENUE_UNCONFIRMED, `\`${want}:${ticker}\` uses an exchange spelling `
          + `TradingView has not been measured answering (witnessed: ${[...confirmedPine].sort().join(', ')})`]
        break
      }
      if (!stored) {
        why = [OTHER_SYMBOL_REFUSAL.NOT_HELD, `\`${want}:${ticker}\` is not a listing our bar store holds`]
        break
      }
      if (!pine) {
        why = [OTHER_SYMBOL_REFUSAL.EXCHANGE_UNCONFIRMED, `our listing of \`${ticker}\` trades on `
          + `${stored}, which has no witnessed Pine spelling, so it cannot be matched to \`${want}:${ticker}\``]
        break
      }
      if (pine !== want) {
        why = [OTHER_SYMBOL_REFUSAL.VENUE_MISMATCH, `\`${want}:${ticker}\` is not the listing our store `
          + `holds (\`${pine}:${ticker}\`)`]
        break
      }
    }
    if (why) { no(ticker, why[0], why[1]); continue }
    const bars = entry && Array.isArray(entry.bars) ? entry.bars : null
    if (!bars || !bars.length) {
      no(ticker, OTHER_SYMBOL_REFUSAL.NO_BARS, `\`${pine}:${ticker}\`'s bars for this timeframe are not in hand`
        + (entry && entry.status ? ` (${entry.status})` : ''))
      continue
    }
    symbols[ticker] = bars
    served.push(ticker)
  }
  return { symbols, served, refused }
}

/** A stable signature of what `resolveOtherSymbols` would supply — for a
 *  compute memo that must recompute when a secondary series lands. */
export function otherSymbolsSignature(def, secondary) {
  const tickers = symTickersOf(def)
  if (!tickers.length) return ''
  return tickers.map((t) => {
    const e = secondary && typeof secondary.get === 'function' ? secondary.get(t) : null
    const bars = e && Array.isArray(e.bars) ? e.bars : null
    const last = bars && bars.length ? bars[bars.length - 1] : null
    return `${t}:${e ? e.status || '' : '-'}:${bars ? bars.length : 0}:${last ? `${last.t}/${last.c}` : ''}`
  }).join(',')
}
