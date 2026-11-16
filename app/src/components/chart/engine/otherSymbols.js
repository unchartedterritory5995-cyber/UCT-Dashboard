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
import { isoDay, SERIES_GAPS_READ_NA } from './ast/interpret'
import REQUEST_WITNESSES from './requestWitnesses.json'

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
  // ⭐ ENGINE 55 (review M1/L5) — an exchange outside the US listings our bar store holds
  // (`TSX:RY`, `XETR:SAP`), decided from the spelling alone (`spellingUnservable`).
  VENUE_FOREIGN: 'other-symbol:venue-foreign',
  // ⭐ RS RATING L1b — a spelling served only behind a capture witness (`requestWitnesses.json`)
  // whose capture has not landed, and one read on a timeframe its witness does not cover.
  WITNESS_PENDING: 'other-symbol:witness-pending',
  WITNESS_TIMEFRAME: 'other-symbol:witness-timeframe',
  // ⭐ RS RATING L6b — `request.seed(source, symbol, …)` naming a seed our store does not
  // register (`requestWitnesses.json`'s `seed` rows = `pine_seed_store.py::SEEDS`).
  SEED_UNREGISTERED: 'other-symbol:seed-unregistered',
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

/** A ticker no store listing can be (punctuation other than a class share's dot, or any
 *  character a listing is never spelled with — `BRK/B`). */
const unservableSpelling = (ticker) => (/[.\-]/.test(ticker) && !CLASS_SHARE.test(ticker))
  || /[^A-Z0-9.\-]/.test(ticker)

/** ⭐ The exchanges a Pine `EXCHANGE:TICKER` spelling may name for a US listing. ONE list:
 *  `pine.js` (which listing a spelling names) and `spellingUnservable` (which spellings
 *  no binding serves) both read it, so the host and the runtime lane cannot disagree. */
export const US_EQUITY_VENUES = Object.freeze(new Set([
  'NASDAQ', 'NYSE', 'AMEX', 'ARCA', 'NYSEARCA', 'BATS', 'CBOE', 'OTC', 'IEX',
]))

/** ⭐ ENGINE 55 — the shape of a US listing a BARE spelling can name: one to five
 *  letters, or a class share (`BRK.B`). The same shape `fetchableOtherSymbols` asks. */
const US_LISTING_SHAPE = /^[A-Z]{1,5}(\.[A-Z])?$/

/** ⭐ ENGINE 55 — the market-breadth spellings TradingView publishes (advancing /
 *  declining issues and volume, TICK, TRIN, …). Our own breadth data may serve them
 *  later (owner scope); until then a read of one is refused with "not available yet". */
// ⭐ ENGINE 55 (review L6) — ANCHORED: a whole breadth spelling (`ADVN`, `DECL.NY`,
// `TICK.NQ`, `TRIN`, `UVOL`), never any ticker that merely begins with those letters
// (`ADDYY`, `DECK`, `TICKS` are listings, and must not be told about breadth).
const BREADTH_SHAPE = /^(ADVDEC|ADVN|ADVQ|ADV|DECN|DECQ|DECL|DEC|UNCH[NQ]?|UVOL[NQ]?|DVOL[NQ]?|TICK[QI]?|TRINQ?|ADDQ?|VOLDQ?)(\.[A-Z]{2})?$/

// ─── ⭐⭐ RS RATING L1b — A SPELLING SERVED ONLY BEHIND ITS CAPTURE WITNESS ─────────────
//
// `requestWitnesses.json` holds the other-symbol spellings that are not a US listing
// (`SP:SPX`, the S&P 500 index): each names the key our bars route serves it under, the
// chart timeframes its witness covers, the capture that settles it and how that capture
// places the series' bars on a chart's (`alignment`). ⛔ A row SERVES only when it carries a
// `witness` and a `captured` date and its `alignment` is one this module knows; until then
// `staticallyUnservable` (the one gate both lanes ask) refuses the spelling by name, citing
// the queue row. So turning a spelling on is one data edit, and nothing else moves.

/** How a witness places a series' bars on a chart's, by name. ⛔ An unknown name serves nothing. */
export const WITNESS_ALIGNMENTS = Object.freeze({
  // the series' bar of a session date is read on the chart bar of the same date
  SAME_DATE: 'same-date',
  // each series bar is read on the chart's NEXT session (Q-RS3: TradingView's `SP:SPX` on a
  // stock's daily chart reads the previous session's SPX bar, as "D" and as timeframe.period)
  PREVIOUS_SESSION: 'previous-session',
  // ⭐ RS RATING L6b — each row on the chart bar of the same date, and a chart bar with no row
  // reads `na` (no carry-forward), as witnessed (Q-RS2: TradingView's `request.seed`)
  SAME_DATE_GAPS_NA: 'same-date-gaps-na',
})

function witnessRowsOf(rows) {
  const out = {}
  for (const [k, v] of Object.entries(rows || {})) {
    if (k.startsWith('_') || !v || typeof v !== 'object' || typeof v.store !== 'string') continue
    const spelling = k.trim().toUpperCase()
    out[spelling] = Object.freeze({ ...v, spelling,
      timeframes: Object.freeze(Array.isArray(v.timeframes) ? v.timeframes.map(String) : []) })
  }
  return Object.freeze(out)
}
let _witnessRows = witnessRowsOf(REQUEST_WITNESSES && REQUEST_WITNESSES.rows)

/** Every witness row, keyed by spelling. */
export function requestWitnessRows() { return _witnessRows }

/** ⛔ TEST SEAM — replace the rows (`null` restores the committed file). A rail injects the
 *  witnessed row exactly as the landed capture's one data edit writes it. */
export function setRequestWitnessRows(rows) {
  _witnessRows = witnessRowsOf(rows || (REQUEST_WITNESSES && REQUEST_WITNESSES.rows))
}

/** The witness row a `venue` + `ticker` spelling names, or null. */
export function witnessRowOf(venue, ticker) {
  const v = String(venue == null ? '' : venue).trim().toUpperCase()
  const t = String(ticker || '').trim().toUpperCase()
  if (!v || v === '?' || v.startsWith('@') || !t) return null
  return _witnessRows[`${v}:${t}`] || null
}

/** ⭐ RS RATING L6b — a Pine seed's spelling, `SEED_<SOURCE>:<SYMBOL>`. */
export const SEED_SPELLING = /^(SEED_[A-Z0-9_]+):([A-Z0-9_.]+)$/

/** Is this row's capture in, and does this module know how to place its bars? */
export function witnessRowServes(row) {
  return !!row && typeof row.witness === 'string' && row.witness.trim() !== ''
    && typeof row.captured === 'string' && row.captured.trim() !== ''
    && Object.values(WITNESS_ALIGNMENTS).includes(row.alignment)
}

function witnessPendingWhy(row) {
  return { code: OTHER_SYMBOL_REFUSAL.WITNESS_PENDING, reason: `\`${row.spelling}\` is served only once a `
    + `TradingView capture witnesses it (capture-queue row ${row.queue_row}, probe \`${row.probe}\`), and that `
    + 'capture has not been matched, so what this indicator draws from it is not computed.' }
}

/** ⭐ A witnessed series' bars keyed the way the chart keys its own: by SESSION DATE
 *  (`interpret.js::isoDay` reads unix seconds, a `YYYYMMDD` int or an ISO day — an index's
 *  daily bars carry unix seconds at the session's UTC midnight, a stock's an ISO date), then
 *  placed by the row's `alignment`. A bar whose day cannot be read is dropped, never guessed. */
function witnessedBarsOf(row, bars) {
  const keyed = []
  for (const b of bars) {
    const day = b && isoDay(b.t)
    if (day) keyed.push(typeof b.t === 'string' && b.t === day ? b : { ...b, t: day })
  }
  if (row.alignment === WITNESS_ALIGNMENTS.SAME_DATE_GAPS_NA) {
    Object.defineProperty(keyed, SERIES_GAPS_READ_NA, { value: true, enumerable: false })
    return keyed
  }
  if (row.alignment !== WITNESS_ALIGNMENTS.PREVIOUS_SESSION) return keyed
  // each bar is read on the NEXT session; the newest has none yet, so nothing reads it
  const out = []
  for (let j = 0; j + 1 < keyed.length; j += 1) out.push({ ...keyed[j], t: keyed[j + 1].t })
  return out
}

/**
 * ⭐⭐ ENGINE 55 — AN OTHER-SYMBOL SPELLING NO BINDING CAN EVER SERVE, decided from the
 * spelling alone: `{code, reason}`, or null when the bind must decide (a held listing,
 * a witnessed exchange, bars in hand). ONE helper, asked by the bind
 * (`resolveOtherSymbols`: ONLY the plots that read it are refused, `{guard: 'pine:request',
 * code, message}`, review M1), by the runtime lane (`pine.js::otherSymbolStaticDeclineOf`,
 * which refuses the program it cannot serve per plot, in the same sentence) and by
 * `staticOtherSymbolRefusalOf` (what a door will refuse), so none can disagree about
 * which spellings are hopeless:
 *   - punctuation other than a class share's dot (`ADVDEC.NY`, `ADVN.NY`) —
 *     `other-symbol:class-share`, whatever the venue;
 *   - a BARE ticker that also names an index or commodity (`BARE_AMBIGUOUS`) —
 *     `other-symbol:bare`;
 *   - a BARE ticker not shaped like a US listing (`XAUUSD`, `EURUSD`) —
 *     `other-symbol:bare`.
 * ⛔ A bare `SPY` or a venue-qualified `AMEX:SPY` is NOT decided here: C29 measured
 * bare `SPY` == `AMEX:SPY`, and the bind serves both when the listing is held.
 *
 * @param {string} ticker  the ticker as the script spelled it (upper-cased here)
 * @param {string} venue   `''` for a bare spelling, else the venue / `'?'` / the
 *                         chart-prefix marker (only `''` matters here)
 */
export function staticallyUnservable(ticker, venue) {
  const t = String(ticker || '').trim().toUpperCase()
  if (!t) return null
  // ⭐ RS RATING L1b — a spelling with a witness row is decided by its row alone
  const row = witnessRowOf(venue, t)
  if (row) return witnessRowServes(row) ? null : witnessPendingWhy(row)
  const breadth = BREADTH_SHAPE.test(t)
  const notYet = breadth
    ? ' It is a market breadth series (advancing / declining issues or volume), and this breadth symbol is not available yet.'
    : ''
  if (unservableSpelling(t)) {
    return { code: OTHER_SYMBOL_REFUSAL.CLASS_SHARE, reason: `\`${t}\` is spelled with punctuation that names no `
      + 'listing our store holds (a class share is written with TradingView’s dot, `BRK.B`), so what this '
      + `indicator draws from it is not computed.${notYet}` }
  }
  if (venue !== '') return null
  if (BARE_AMBIGUOUS.has(t)) {
    return { code: OTHER_SYMBOL_REFUSAL.BARE, reason: `\`"${t}"\` names no exchange, and those letters also name `
      + 'a market index or commodity outside our bar store, so which instrument TradingView resolves it to '
      + `cannot be settled here; what this indicator draws from it is not computed.${notYet}` }
  }
  if (!US_LISTING_SHAPE.test(t)) {
    return { code: OTHER_SYMBOL_REFUSAL.BARE, reason: `\`"${t}"\` names no exchange and is not shaped like a US `
      + 'stock listing (one to five letters), so it is a currency pair, a commodity, an index or a foreign '
      + `listing this chart cannot read; what this indicator draws from it is not computed.${notYet}` }
  }
  return null
}

/** ⭐⭐ ENGINE 55 (review L5) — A RAW SPELLING NO BINDING CAN SERVE, read from the string
 *  the script wrote (`"BRK/B"`, `"TSX:RY"`, `"XETR:SAP"`, `"XAUUSD"`): `{ticker, code,
 *  reason}` or null. A foreign exchange is `other-symbol:venue-foreign`; anything else
 *  goes to `staticallyUnservable` (punctuation, a bare index / pair / foreign spelling).
 *  ONE helper for the host translator (a spelling it cannot even turn into a listing)
 *  and the runtime lane (which would otherwise take any string), so both refuse by name. */
export function spellingUnservable(raw) {
  const s = String(raw == null ? '' : raw).trim().toUpperCase()
  if (!s) return null
  // ⭐ RS RATING L6b — a Pine seed (`request.seed` reads `<SOURCE>:<SYMBOL>`, the source
  // `SEED_…`): its row's decision, or `other-symbol:seed-unregistered`
  const seed = SEED_SPELLING.exec(s)
  if (seed) {
    if (witnessRowOf(seed[1], seed[2])) {
      const why = staticallyUnservable(seed[2], seed[1])
      return why ? { ticker: seed[2], ...why } : null
    }
    return { ticker: s, code: OTHER_SYMBOL_REFUSAL.SEED_UNREGISTERED, reason: `\`${s}\` is a Pine Seeds series our `
      + 'store does not hold (the seeds it serves are listed in `requestWitnesses.json`), so what this indicator draws '
      + 'from it is not computed.' }
  }
  const m = /^([A-Z][A-Z0-9_.]{0,15}):(.*)$/.exec(s)
  const venue = m ? m[1] : ''
  const ticker = m ? m[2].trim() : s
  // ⭐ RS RATING L1b — a witness row's spelling (`SP:SPX`) is the row's to decide
  if (m && witnessRowOf(venue, ticker)) {
    const why = staticallyUnservable(ticker, venue)
    return why ? { ticker, ...why } : null
  }
  if (m && !US_EQUITY_VENUES.has(venue)) {
    const notYet = BREADTH_SHAPE.test(ticker)
      ? ' It is a market breadth series (advancing / declining issues or volume), and this breadth symbol is not available yet.'
      : ''
    return { ticker: s, code: OTHER_SYMBOL_REFUSAL.VENUE_FOREIGN, reason: `\`${s}\` names the exchange \`${venue}\`, `
      + 'outside the US stock listings our bar store holds, so what this indicator draws from it is not computed.'
      + notYet }
  }
  const why = staticallyUnservable(ticker, venue)
  return why ? { ticker: ticker || s, ...why } : null
}

/** ⭐⭐ ENGINE 55 (review M1) — THE ONE SENTENCE for a read no binding can serve, said
 *  identically by the bind (`columnErrors`, the strip) and the runtime lane's refusal. */
export function staticOtherSymbolMessage(ticker, why) {
  return `This indicator reads \`${String(ticker).trim().toUpperCase()}\`: ${why.code} — ${why.reason}`
}

/** ⭐⭐ ENGINE 55 (review M1) — what ONE tree reading a spelling no binding can serve is
 *  refused with — `{guard: 'pine:request', code, message}` — from the spelling table a
 *  translation records (`otherSymbols`), or null. The bind refuses exactly this per plot
 *  (`otherSymbolRefusalOfTree` over `resolveOtherSymbols`), so a door can say which plots
 *  will be refused, and with what sentence, before any bar is bound. */
export function staticOtherSymbolRefusalOf(tree, otherSymbols) {
  if (!tree) return null
  const read = new Set(symTickersOf({ compute: { ast: tree } }))
  for (const row of otherSymbols || []) {
    const ticker = row && String(row.ticker || '').trim().toUpperCase()
    if (!ticker || !read.has(ticker)) continue
    const why = (row.spellings || []).map((v) => staticallyUnservable(ticker, v)).find(Boolean)
    if (why) return { guard: 'pine:request', code: why.code, message: staticOtherSymbolMessage(ticker, why) }
  }
  return null
}

/** ⭐⭐ ENGINE 55 (review F1) — IS THIS COLUMN ERROR AN OTHER-SYMBOL REFUSAL? The spelling-decided
 *  ones (`{guard: 'pine:request', code: 'other-symbol:…'}`) and the bind-decided ones
 *  (`{guard: 'other-symbol:…'}`). */
export function isOtherSymbolRefusal(err) {
  if (!err || typeof err !== 'object') return false
  if (err.guard === 'pine:request' && typeof err.code === 'string' && err.code.startsWith('other-symbol:')) return true
  return typeof err.guard === 'string' && err.guard.startsWith('other-symbol:')
}

/** ⭐⭐ ENGINE 55 (review F1) — THE ONE SENTENCE for something visible (a plot, a band, a paint)
 *  whose COLOUR is read from a value refused for another symbol: it names the visible thing
 *  and the symbol, never the hidden helper row that carried the colour. `message` is the
 *  refusal's own sentence ("This indicator reads `T`: …"). */
export function colourReaderMessage(name, message) {
  const why = String(message || '').replace(/^This indicator reads /, 'reads ')
  return `${name} is not drawn: its colour ${why}`
}

/** ⭐⭐ ENGINE 55 (review F1, narrowed) — A PLOT THAT CAN NEVER DRAW: its value tree IS the `na`
 *  literal (`0 / 0`, how the translator spells `na` — e.g. an input-folded
 *  `Indicator == 'MSI RSI' ? msirsi : na` whose branch the inputs did not choose). It draws
 *  nothing on any bar, and neither does TradingView, so its colour is never seen: a colour
 *  that reads a refused symbol is NOT a reason to refuse it (that only adds a strip sentence
 *  about a plot the member did not choose; McClellan's MSI RSI / MACD Histogram, CAP3). The ONE
 *  authority for the bind (`refuseColourReaders`) and the member door (`staticPlotRefusalsOf`),
 *  which share one translation. A member who chooses the branch retranslates, and the value
 *  then reads the symbol and is refused on its own.
 *  ⛔ The import screen never reaches this question: its translation folds every input to its
 *  default, and an output whose value is then `na` is offered as "hidden by the script itself"
 *  (`importOutcome`, pre-existing) — for a live input's branch too, which the bind refuses. */
export function plotValueIsNaLiteral(tree) {
  return !!tree && tree.type === 'op' && tree.name === '/' && Array.isArray(tree.args) && tree.args.length === 2
    && tree.args.every((a) => !!a && a.type === 'num' && a.value === 0)
}

/** ⭐⭐ ENGINE 55 (review F1) — the refusal a plot inherits when its colour reads a refused
 *  helper column: the helper's guard and code, the reader's sentence. */
export function colourReaderRefusal(name, helperErr) {
  return {
    guard: helperErr.guard,
    ...(typeof helperErr.code === 'string' ? { code: helperErr.code } : {}),
    message: colourReaderMessage(name, helperErr.message),
  }
}

/** ⭐⭐ ENGINE 55 (review F1) — WHAT THE BIND WILL REFUSE BY SPELLING ALONE, per plot key, before
 *  any bar is bound: `{key: {guard: 'pine:request', code, message}}`. A plot whose own tree
 *  reads a spelling no binding serves (`staticOtherSymbolRefusalOf`), then every plot whose
 *  colour (`colorMode`) or band colour (`fill.colorMode`) reads such a helper, in the reader's
 *  own words (`colourReaderRefusal`). The member door returns it (`staticRefusals`) so the
 *  preview can say it up front; the bind's `columnErrors` refuses exactly these (railed). */
export function staticPlotRefusalsOf(def) {
  const out = {}
  if (!def || !def.compute) return out
  const others = def.meta && Array.isArray(def.meta.otherSymbols) ? def.meta.otherSymbols : null
  if (!others || !others.length) return out
  const trees = def.compute.trees && typeof def.compute.trees === 'object' ? def.compute.trees : null
  const plots = Array.isArray(def.plots) ? def.plots : []
  const treeOf = (key) => (trees ? trees[key] : (plots.length === 1 && plots[0].key === key ? def.compute.ast : null))
  for (const p of plots) {
    if (!p || typeof p.key !== 'string') continue
    const r = staticOtherSymbolRefusalOf(treeOf(p.key), others)
    if (r) out[p.key] = r
  }
  const helperOf = (mode) => (typeof mode === 'string' && mode.startsWith('column:') ? mode.slice('column:'.length) : null)
  for (const p of plots) {
    if (!p || typeof p.key !== 'string' || out[p.key] || plotValueIsNaLiteral(treeOf(p.key))) continue
    const hit = [helperOf(p.colorMode), p.fill ? helperOf(p.fill.colorMode) : null]
      .filter((k) => k && k !== p.key).map((k) => out[k]).find(Boolean)
    if (hit) out[p.key] = colourReaderRefusal(`\`${p.label || p.title || p.key}\``, hit)
  }
  return out
}

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
    // ⭐ RS RATING L1b — a witnessed row is fetched under its store key, and only when every
    // spelling of the ticker is that one served row
    const rows = spellings.map((v) => witnessRowOf(v, ticker))
    if (rows.some(Boolean)) {
      if (rows.every((r) => r && r === rows[0] && witnessRowServes(r))) out.push(rows[0].store)
      continue
    }
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
    // ⭐ ENGINE 55 — the spellings no binding can serve, decided by the ONE helper the
    // translator asks too (`staticallyUnservable`): a document saved before the
    // translator refused them reaches here and is refused with the same code.
    const hopeless = spellings.map((v) => staticallyUnservable(ticker, v)).find(Boolean)
    if (hopeless) {
      // ⭐ `static`: decided by the spelling alone, so it is refused under the request
      // guard with the one sentence every door says (`staticOtherSymbolMessage`).
      refused.push({ ticker, code: hopeless.code, reason: hopeless.reason, static: true })
      continue
    }
    // ⭐⭐ RS RATING L1b — A WITNESSED SPELLING (`SP:SPX`) IS ITS ROW'S: no exchange to match,
    // served from the row's store key on the timeframes its witness covers, its bars keyed by
    // session date and placed as the witness places them (`witnessedBarsOf`). A pending row
    // never reaches here (`staticallyUnservable` refused it above).
    const rows = spellings.map((v) => witnessRowOf(v, ticker))
    if (rows.some(Boolean)) {
      const row = rows.find(Boolean)
      if (!rows.every((r) => r === row)) {
        no(ticker, OTHER_SYMBOL_REFUSAL.VENUE_MISMATCH, `\`${ticker}\` is spelled both as \`${row.spelling}\` and as `
          + 'another listing, which are different instruments under one name')
        continue
      }
      const tf = ctx.tf == null ? '' : String(ctx.tf)
      if (!row.timeframes.includes(tf)) {
        no(ticker, OTHER_SYMBOL_REFUSAL.WITNESS_TIMEFRAME, `\`${row.spelling}\` is witnessed on `
          + `${row.timeframes.join(', ') || 'no'} charts only (capture-queue row ${row.queue_row}), and this chart is `
          + `${tf ? `\`${tf}\`` : 'of no stated timeframe'}`)
        continue
      }
      const entry = secondary ? secondary.get(row.store) : null
      const held = entry && Array.isArray(entry.bars) ? entry.bars : null
      if (!held || !held.length) {
        no(ticker, OTHER_SYMBOL_REFUSAL.NO_BARS, `\`${row.spelling}\`'s bars for this timeframe are not in hand`
          + (entry && entry.status ? ` (${entry.status})` : ''))
        if (!entry || String(entry.status || '') === 'loading') refused[refused.length - 1].pending = true
        continue
      }
      symbols[ticker] = witnessedBarsOf(row, held)
      served.push(ticker)
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
      // ⭐ ENGINE 55 — a fetch that has not answered yet is WAITING, not a settled "no"
      // (`otherSymbolPending`, the formula lane's rule): the plot is refused by name only
      // once the answer is in (`otherSymbolRefusalOfTree`), never flashed while loading.
      if (!entry || String(entry.status || '') === 'loading') refused[refused.length - 1].pending = true
      continue
    }
    symbols[ticker] = bars
    served.push(ticker)
  }
  return { symbols, served, refused }
}

/** ⭐⭐ ENGINE 55 — THE SETTLED REFUSAL A TREE READS, or null. `{guard, message}`
 *  for the first ticker the tree reads through `sym` that this binding REFUSED (a
 *  settled "no" — never a read still waiting for its bars, `otherSymbolPending`).
 *  ⚰️ Such a plot used to compute as an all-`na` column with nothing said: the
 *  bind starved the ticker and `interpret` answered "not computable" on every bar.
 *  The chart now refuses the PLOT by name (`nativeRegistry.computeFor`'s
 *  `columnErrors`, the object lane's `refusals`), with the bind's own code and
 *  sentence. ONE reader for both lanes.
 *  @param {object} tree   one plot / object tree
 *  @param {object|null} decision  `resolveOtherSymbols` / `resolveFormulaSymbols`' answer */
export function otherSymbolRefusalOfTree(tree, decision) {
  const refused = ((decision && decision.refused) || []).filter((r) => r && !otherSymbolPending(r))
  if (!refused.length || !tree) return null
  const read = new Set(symTickersOf({ compute: { ast: tree } }))
  const hit = refused.find((r) => read.has(String(r.ticker).trim().toUpperCase()))
  if (!hit) return null
  if (hit.static === true) {
    return { guard: 'pine:request', code: hit.code, message: staticOtherSymbolMessage(hit.ticker, hit) }
  }
  return { guard: hit.code, message: `This indicator reads \`${hit.ticker}\`: ${hit.reason}` }
}

/** A stable signature of what `resolveOtherSymbols` would supply — for a
 *  compute memo that must recompute when a secondary series lands. */
export function otherSymbolsSignature(def, secondary) {
  const tickers = symTickersOf(def)
  if (!tickers.length) return ''
  // ⭐ RS RATING L6b — a witnessed spelling's series is held under its row's store key
  const recorded = new Map(otherSymbolRequestsOf(def).map((r) => [r.ticker, r.spellings]))
  const keyOf = (t) => {
    const row = (recorded.get(t) || []).map((v) => witnessRowOf(v, t)).find(Boolean)
    return row ? row.store : storeTickerOf(t)
  }
  return tickers.map((t) => {
    const e = secondary && typeof secondary.get === 'function' ? secondary.get(keyOf(t)) : null
    const bars = e && Array.isArray(e.bars) ? e.bars : null
    const last = bars && bars.length ? bars[bars.length - 1] : null
    return `${t}:${e ? e.status || '' : '-'}:${bars ? bars.length : 0}:${last ? `${last.t}/${last.c}` : ''}`
  }).join(',')
}
