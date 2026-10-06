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
// ⚰️⚰️ C29 (2026-09-30) — BOTH OF THE TWO PARAGRAPHS ABOVE ARE SETTLED BY CAPTURE.
// `vw-other-symbol-rddt-1d-2026-09-30.json`: on all 634 bars bare `"SPY"` read the
// SAME series as `"AMEX:SPY"`, and bare `"BRK.B"` the same as `"NYSE:BRK.B"`. So:
//
//   * a BARE ticker is served when our store holds exactly one listing of it (the
//     store is keyed by ticker: one listing) on an exchange with a WITNESSED Pine
//     spelling — the listing its confirmed-exchange spelling would read. A bare
//     ticker our store does not hold on a witnessed exchange (`"XAUUSD"`, `"ADVN"`,
//     `"EURUSD"`) is still refused BY NAME (`other-symbol:bare`).
//   * a CLASS SHARE written with TradingView's dot (`BRK.B`) is our store's hyphen
//     listing (`BRK-B`, the bars route's key — `storeTickerOf`); the alignment
//     and the exchange rule are the ordinary ones. Any other punctuated spelling
//     keeps its refusal (`other-symbol:class-share`).

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

/** ⭐ C29 — TradingView's class-share spelling (`BRK.B`) → our store's key
 *  (`BRK-B`); every other ticker is its own key. ONE authority: the fetch list,
 *  the exchange lookup and the bind all ask this. */
const CLASS_SHARE = /^([A-Z]{1,5})\.([A-Z])$/
export function storeTickerOf(ticker) {
  const t = String(ticker || '').trim().toUpperCase()
  const m = CLASS_SHARE.exec(t)
  return m ? `${m[1]}-${m[2]}` : t
}
/** ⛔ C29 — BARE SPELLINGS THAT ALSO NAME A TRADINGVIEW INDEX OR COMMODITY. The
 *  capture pinned bare `SPY` and `BRK.B` — spellings nothing else claims. A bare
 *  ticker our store happens to hold as an equity but which TradingView also lists
 *  as a market index or commodity (the corpus's own bare reads: NYSE breadth
 *  `ADVN`/`DECN`/`UVOL`/`DVOL`/`TICK`/`TRIN`, `VIX`, and `GOLD`/`SILVER`/`DXY`)
 *  may resolve to THAT instrument, which is unmeasured — so it keeps the bare
 *  refusal and the member is told to write the exchange. */
export const BARE_AMBIGUOUS = Object.freeze(new Set([
  'ADVN', 'DECN', 'UVOL', 'DVOL', 'TICK', 'TRIN', 'ADD', 'VIX', 'VXN', 'VVIX',
  'GOLD', 'SILVER', 'DXY', 'USOIL', 'UKOIL', 'NDX', 'SPX', 'RUT', 'DJI',
]))

/** A ticker no store listing can be (punctuation other than a class share's dot). */
const unservableSpelling = (ticker) => /[.\-]/.test(ticker) && !CLASS_SHARE.test(ticker)

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

// ─── ⭐⭐ P0 — A FORMULA THE MEMBER TYPED NAMES OUR STORE'S TICKER ──────────────
//
// Everything above is about a PINE spelling: which instrument TradingView means
// by `"AMEX:SPY"` or bare `"SPY"`, which is a fact about two outside worlds. A
// `sym('SPY', close)` a member typed in the FORMULA language has no such
// question — the grammar's `sym` names our bar store's ticker (`parse.js::
// TICKER_SHAPE`), the same key a `sym:` source, the bars route and the scan
// lane's benchmark roster use. So a document that is not a Pine translation is
// served exactly when that listing's bars for THIS chart's timeframe are in
// hand, and refused BY NAME otherwise — never left to starve.
//
// ⚰️ BEFORE (audit B/C, reproduced 2026-10-05 on a92b96de2): such a document
// saved, installed and computed ALL-NaN with no report — `otherSymbolsFor`
// returned null unless the document was a Pine translation, and
// `fetchableOtherSymbols` returned [] unless it carried the Pine spelling table,
// so the chart never even fetched SPY. The scan door's own refusal told members
// "charting against any symbol still works on the Formula tab"; it did not.

/** The declaration a Pine translation carries (`nativeRegistry.
 *  PINE_RECURRENCE_ORIGIN`; spelled here as `listingDeepen.js` does, because
 *  that module imports this one). */
const PINE_ORIGIN = 'pine'

/** Is this document a Pine translation (the member door's spelling rules apply)? */
export function isPineOriginDoc(def) {
  return !!(def && def.meta && def.meta.recurrenceOrigin === PINE_ORIGIN)
}

/** ⭐ P0 — the store tickers a FORMULA document (not a Pine translation) reads.
 *  [] for a Pine document: its tickers are decided by its spellings above. */
export function formulaOtherSymbols(def) {
  if (!def || isPineOriginDoc(def)) return []
  return [...new Set(symTickersOf(def).filter((t) => !BARE_AMBIGUOUS.has(t)).map(storeTickerOf))].sort()
}

/** Is a refusal row a bind that is still WAITING for its bars (the secondary
 *  fetch has not answered yet) rather than a settled "no"? A surface says
 *  nothing about a pending read; it names every other refusal. */
export function otherSymbolPending(row) {
  return !!(row && row.pending === true)
}

/**
 * ⭐ P0 — decide, for ONE binding, which of a FORMULA document's other symbols
 * are served. Same return shape and refusal codes as `resolveOtherSymbols`.
 *
 * @param {object} def  an installed definition that is not a Pine translation
 * @param {object} ctx  `secondary` (Map storeTicker → `{bars, status}`), `framed`
 */
export function resolveFormulaSymbols(def, ctx = {}) {
  const symbols = {}
  const served = []
  const refused = []
  const secondary = ctx.secondary && typeof ctx.secondary.get === 'function' ? ctx.secondary : null
  for (const ticker of symTickersOf(def)) {
    if (ctx.framed === true) {
      refused.push({ ticker, code: OTHER_SYMBOL_REFUSAL.FRAMED, reason: `This indicator reads \`${ticker}\` `
        + "on the chart's own timeframe, and it computes on a different calculation timeframe, so its "
        + `\`sym('${ticker}', …)\` is not computed here` })
      continue
    }
    // ⛔ A SPELLING THAT ALSO NAMES A MARKET INDEX OR COMMODITY ELSEWHERE
    // (`BARE_AMBIGUOUS`). The Builder sheet's Pine tab saves a translated script
    // as an ordinary formula and keeps no record that it was Pine (audit C-levels
    // finding 2), so `sym('ADVN', …)` here may be a TradingView `"ADVN"` — NYSE
    // breadth — and our store's listing under those letters would be the wrong
    // instrument under the right name. Refused by name, never fetched.
    if (BARE_AMBIGUOUS.has(ticker)) {
      refused.push({ ticker, code: OTHER_SYMBOL_REFUSAL.BARE, reason: `This indicator reads \`${ticker}\`, `
        + 'a spelling that also names a market index or commodity outside our bar store, so which instrument '
        + 'it means cannot be settled here; it is not computed' })
      continue
    }
    const key = storeTickerOf(ticker)
    const entry = secondary ? secondary.get(key) : null
    const bars = entry && Array.isArray(entry.bars) ? entry.bars : null
    if (!bars || !bars.length) {
      const status = entry && entry.status ? String(entry.status) : ''
      const pending = !entry || status === 'loading'
      refused.push({ ticker, code: OTHER_SYMBOL_REFUSAL.NO_BARS, pending,
        reason: `This indicator reads \`${ticker}\` (\`sym('${ticker}', …)\`), and \`${key}\`'s bars for this `
          + `timeframe are not in hand${status ? ` (${status})` : ''}, so every value that reads it is left blank` })
      continue
    }
    symbols[ticker] = bars
    served.push(ticker)
  }
  return { symbols, served, refused }
}

/** The tickers worth FETCHING for a document: those whose every recorded
 *  spelling could be served (a witnessed exchange, or the chart's own prefix) —
 *  so a chart never asks the bars route for `EURUSD` or `"SPY"` spelled bare,
 *  which the bind would refuse whatever arrived. Everything else is still
 *  decided (and named) by `resolveOtherSymbols`; this only saves the request. */
export function fetchableOtherSymbols(def) {
  // ⭐ P0 — a formula document reads our store's tickers: every one is fetched.
  if (def && !isPineOriginDoc(def)) return formulaOtherSymbols(def)
  if (!def || !def.meta || !Array.isArray(def.meta.otherSymbols)) return []
  const out = []
  for (const { ticker, spellings } of otherSymbolRequestsOf(def)) {
    if (!spellings.length || unservableSpelling(ticker)) continue
    // ⭐ C29 — a bare spelling (`''`) may be served too (when the store holds the
    // ticker on a witnessed exchange), so it is worth fetching; the bind decides.
    // A bare spelling is fetched only in a US listing's shape (1-5 letters, or a
    // class share) — `EURUSD`, `XAUUSD` and the like are never asked for.
    const bareOk = /^[A-Z]{1,5}(\.[A-Z])?$/.test(ticker) && !BARE_AMBIGUOUS.has(ticker)
    if (spellings.every((v) => (v === '' && bareOk) || v === CHART_PREFIX_VENUE || CONFIRMED_PINE.has(v))) {
      out.push(storeTickerOf(ticker))
    }
  }
  return [...new Set(out)]
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
    if (unservableSpelling(ticker)) {
      no(ticker, OTHER_SYMBOL_REFUSAL.CLASS_SHARE, `\`${ticker}\` is spelled with punctuation that `
        + 'names no listing our store holds (a class share is written with TradingView\'s dot, `BRK.B`)')
      continue
    }
    const key = storeTickerOf(ticker)
    const entry = secondary ? secondary.get(key) : null
    const stored = (entry && typeof entry.exchange === 'string' && entry.exchange) || exchangeOf(key)
    const pine = pineOf(stored, confirmed)
    let why = null
    for (const venue of spellings) {
      // ⭐⭐ C29 — A BARE TICKER IS THE LISTING ITS WITNESSED EXCHANGE SPELLING READS
      // (measured: bare "SPY" == "AMEX:SPY", bare "BRK.B" == "NYSE:BRK.B", all 634
      // bars) — served when our store holds it on a witnessed exchange; refused by
      // name otherwise, since then there is no witnessed listing it could be.
      if (venue === '') {
        if (stored && pine && !BARE_AMBIGUOUS.has(ticker)) continue
        why = [OTHER_SYMBOL_REFUSAL.BARE, `\`"${ticker}"\` names no exchange, and our store holds no `
          + 'listing of it on an exchange whose Pine spelling is witnessed, so which instrument '
          + 'TradingView resolves it to is not one this chart can read']
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
    const e = secondary && typeof secondary.get === 'function' ? secondary.get(storeTickerOf(t)) : null
    const bars = e && Array.isArray(e.bars) ? e.bars : null
    const last = bars && bars.length ? bars[bars.length - 1] : null
    return `${t}:${e ? e.status || '' : '-'}:${bars ? bars.length : 0}:${last ? `${last.t}/${last.c}` : ''}`
  }).join(',')
}
