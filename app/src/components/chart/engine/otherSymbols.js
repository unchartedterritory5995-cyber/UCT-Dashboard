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
import { isoDay, SERIES_GAPS_READ_NA, SERIES_UNKNOWN_BEFORE_FIRST, isoWeekDayOf, isoDayPlus, tfBucket } from './ast/interpret'
// ⭐ RS RATING L13 — the exchange's sessions (a month's first session, a row's next session)
import { isTradingDay, closeTime, isHalfDay } from '../../../lib/marketClock/sessionCalendar.js'
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

// ─── ⭐⭐ RS RATING L11 (Q-RS7) — A WITNESSED SPELLING ON A CHART OF ANOTHER PERIOD ─────────
//
// A row's top-level `alignment` places its series on the chart timeframe(s) it lists with no
// block of their own (`D`). A chart timeframe with a block (`periods.W`) is served from the series
// HELD at another timeframe (`held`: our weekly SPX is ten years of yfinance keyed by Monday, and a
// seed is served daily only, so on a weekly chart both are fetched and held at `D`), read the way
// that block's capture witnessed, per request timeframe (`reads`):
//   `period` — the read at the chart's own timeframe (`timeframe.period`): a FOLD of the held rows;
//   `D`      — a daily read below the chart: the row's own DAILY read (its `alignment`), each chart
//              bar then reading one of its period's rows (a SAMPLE).
// ⛔ A read the block does not name, a block without `witness` + `captured`, an unknown fold or
// sample: refused by name (`other-symbol:witness-timeframe`), never guessed.

/** How a block reads its held rows, by name. ⛔ An unknown name serves nothing. */
export const WITNESS_PERIOD_READS = Object.freeze({
  // FOLD (a `period` read): the held daily rows folded into Monday-to-Sunday weeks (the weekly bar
  // `interpret.js::resampleTo` builds, `bars_fetch._resample_weekly_iso`'s rule), each week read on
  // the FOLLOWING calendar week's chart bar. Q-RS7 R1: TradingView's `SP:SPX` at `timeframe.period`
  // on a weekly stock chart reads the previous week's last daily close on every settled week.
  PREVIOUS_WEEK: 'previous-week',
  // SAMPLE (a `D` read): each chart week reads the LAST of its rows (as the row's daily read placed
  // them). Q-RS7 R2: `SP:SPX` at "D" on a weekly chart reads the previous-session value at the week's
  // last session (its Thursday close in a full week).
  WEEK_LAST_ROW: 'week-last-row',
  // SAMPLE (a `D` read): each chart week reads the row dated its FIRST calendar day (Monday), and a
  // week with no such row reads `na`. Q-RS7 R4: `request.seed` on a weekly chart.
  WEEK_FIRST_DAY: 'week-first-day',
  // ⭐⭐ RS RATING L13 (Q-RS-M, `rs-monthly-2026-11-18c`) — the same three reads on a MONTHLY chart.
  // FOLD: the held daily rows folded into calendar months, each read on the FOLLOWING month's chart
  // bar. R1: `SP:SPX` at `timeframe.period` on NYSE:RDDT 1M reads the previous month's last daily close
  // on every settled month (32 of 32).
  PREVIOUS_MONTH: 'previous-month',
  // SAMPLE: each chart month reads the LAST of its rows (as the row's daily read placed them). R2:
  // `SP:SPX` at "D" reads the previous-session value at the month's last session (32 of 32, o/h/l/c).
  MONTH_LAST_ROW: 'month-last-row',
  // SAMPLE: each chart month reads the row dated its FIRST SESSION, and a month with no such row reads
  // `na`. R4: `request.seed` on NYSE:RDDT 1M read the 2026-11-02 row (75), not Sunday 2026-11-01's (92.81),
  // and `na` for October (no 2026-10-01 row; the series begins 2026-10-13).
  MONTH_FIRST_SESSION: 'month-first-session',
  // ⭐⭐ RS RATING L12 (Q-L12-1, `l12-pm` / `l12-is-2026-11-18`) — an INTRADAY chart: each chart bar reads the
  // LATEST value of the index at or before its open (Pine's `gaps_off`): in the session, the index bar that
  // opened at or before it (the same bar on a 5m grid; the 09:30 bar for a 10:00 bar on the hour-aligned 60m
  // grid, 360 of 360); before the session's open, the PREVIOUS session's official close; from its close on,
  // the day's official close (5m: 1,988 / 1,678 of 1,988 / 1,678 extended bars). Held: the index's own bars at
  // the chart's timeframe AND its daily rows (the official closes: an intraday bar's last print is the 15:59
  // trade, never the closing auction, 0 of 59 days equal). `atOrBeforeGridOf`.
  AT_OR_BEFORE: 'latest-at-or-before',
})
/** ⭐ RS RATING L12 — the intraday chart timeframes a block may stand on, and their bar step in minutes. */
const INTRADAY_STEP_MIN = Object.freeze({ 1: 1, 5: 5, 15: 15, 30: 30, 60: 60 })

/** ⭐ PER CHART TIMEFRAME: the timeframe its blocks are held at, and the folds (a `period` read) and
 *  samples (a read below the chart) a block on it may name. A daily read on a weekly or a monthly chart
 *  are the witnessed shapes; a week's reads never stand on a month, nor the other way. */
const PERIOD_READS_OF = Object.freeze({
  W: Object.freeze({ held: 'D', folds: [WITNESS_PERIOD_READS.PREVIOUS_WEEK],
    samples: [WITNESS_PERIOD_READS.WEEK_LAST_ROW, WITNESS_PERIOD_READS.WEEK_FIRST_DAY] }),
  M: Object.freeze({ held: 'D', folds: [WITNESS_PERIOD_READS.PREVIOUS_MONTH],
    samples: [WITNESS_PERIOD_READS.MONTH_LAST_ROW, WITNESS_PERIOD_READS.MONTH_FIRST_SESSION] }),
  // ⭐ RS RATING L12 — each intraday timeframe is held at ITSELF (the index's own bars of the chart's period)
  // and ALSO at D (its official daily closes, for the extended-hours bars)
  ...Object.fromEntries(Object.keys(INTRADAY_STEP_MIN).map((tf) => [tf,
    Object.freeze({ held: tf, alsoHeld: 'D', folds: [WITNESS_PERIOD_READS.AT_OR_BEFORE], samples: [] })])),
})
const LAST_ROW_SAMPLES = Object.freeze([WITNESS_PERIOD_READS.WEEK_LAST_ROW, WITNESS_PERIOD_READS.MONTH_LAST_ROW])
/** The chart's period code a read belongs to (`'W'` / `'M'`), or null. */
function periodCodeOfRead(how) {
  for (const [code, r] of Object.entries(PERIOD_READS_OF)) if (r.folds.includes(how) || r.samples.includes(how)) return code
  return null
}

/** ⭐ RS RATING L11 — the key a series HELD at another timeframe rides the chart's secondary cache
 *  under (`SPX@D` on a weekly chart), so it never collides with the same store ticker fetched at the
 *  chart's own timeframe (a `sym:SPX` source). The store key itself where nothing is held. */
export function heldSecondaryKey(store, held, chartTf) {
  const s = String(store || '').trim().toUpperCase()
  return held && String(held) !== String(chartTf == null ? '' : chartTf) ? `${s}@${held}` : s
}

/** `{symbol, tf}` a held key names (`SPX@D` → SPX at D), or null for an ordinary key. */
export function heldKeyParts(key) {
  const m = /^(.+)@(D)$/.exec(String(key || ''))
  return m ? { symbol: m[1], tf: m[2] } : null
}

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

/** ⭐ RS RATING L11 — is this chart timeframe's block in (`witness` + `captured`), held at the one
 *  witnessed timeframe, and does it name only reads this module knows? */
export function periodBlockServes(block, chartTf) {
  if (!block || typeof block !== 'object') return false
  if (!(typeof block.witness === 'string' && block.witness.trim() && typeof block.captured === 'string' && block.captured.trim())) return false
  const of = PERIOD_READS_OF[chartTf]
  if (!of || block.held !== of.held) return false
  // ⭐ RS RATING L12 — a block held at a second timeframe too names exactly the one its chart timeframe holds
  if ((of.alsoHeld || null) !== (block.alsoHeld || null)) return false
  const reads = block.reads
  if (!reads || typeof reads !== 'object' || !Object.keys(reads).length) return false
  return Object.entries(reads).every(([code, how]) => (code === 'period' ? of.folds.includes(how)
    : code === of.held && of.samples.includes(how)))
}

/**
 * ⭐⭐ RS RATING L11 — HOW A WITNESS ROW IS READ ON THIS CHART, or null when it is not served here:
 * `{held, key, fold, sample}` — the timeframe its series is fetched and held at, the secondary-cache
 * key it rides (`heldSecondaryKey`), and the FOLD (a `period` read) or SAMPLE (a read below the chart)
 * its block witnessed. A chart timeframe with no block is the row's own (`alignment`, held as is).
 * @param {object} row
 * @param {string} chartTf
 * @param {string|null|undefined} code  the request's timeframe: `null` the chart's own
 *   (`timeframe.period`), `'D'` a daily read; `undefined` the HOST bind, which serves the chart's own
 *   read where the block declares one, else the daily read (every host tree reading such a spelling at
 *   another period carries the daily base gate, `interpret.js::requestBaseNode`, and is withheld whole on
 *   this chart, so only the run, which asks per request, reads it)
 */
export function witnessReadOf(row, chartTf, code) {
  const tf = chartTf == null ? '' : String(chartTf)
  if (!row || !row.timeframes.includes(tf)) return null
  const block = row.periods && typeof row.periods === 'object' ? row.periods[tf] : null
  if (!block) return { held: tf, key: heldSecondaryKey(row.store, tf, tf), fold: null, sample: null }
  if (!periodBlockServes(block, tf)) return null
  const reads = block.reads
  let fold = null
  let sample = null
  if (code === undefined) {
    if (reads.period) fold = reads.period
    else sample = reads[block.held] || null
  } else if (code === null) {
    fold = reads.period || null
  } else if (String(code) === block.held) {
    sample = reads[block.held] || null
  }
  if (!fold && !sample) return null
  return { held: block.held, key: heldSecondaryKey(row.store, block.held, tf), fold, sample,
    // ⭐ RS RATING L12 — the second held series (an intraday chart's daily rows: `SPX@D`), or null
    alsoKey: block.alsoHeld ? heldSecondaryKey(row.store, block.alsoHeld, tf) : null }
}

/** The sentence for a witness row that is not served on this chart, or at this request's timeframe. */
function witnessTimeframeWhy(row, chartTf, code) {
  const tf = chartTf == null ? '' : String(chartTf)
  const block = row.periods && typeof row.periods === 'object' && tf ? row.periods[tf] : null
  if (!row.timeframes.includes(tf) || !block) {
    const rows = [row.queue_row, ...Object.values(row.periods || {}).map((b) => b && b.queue_row)].filter(Boolean)
    return `\`${row.spelling}\` is witnessed on ${row.timeframes.join(', ') || 'no'} charts only (capture-queue `
      + `row${rows.length > 1 ? 's' : ''} ${rows.join(', ')}), and this chart is ${tf ? `\`${tf}\`` : 'of no stated timeframe'}`
  }
  if (!periodBlockServes(block, tf)) {
    return `\`${row.spelling}\` on a \`${tf}\` chart is served only once a TradingView capture witnesses it there `
      + `(capture-queue row ${block.queue_row}, probe \`${block.probe}\`), and that capture has not been matched`
  }
  const named = Object.keys(block.reads || {}).map((c) => (c === 'period' ? '`timeframe.period`' : `\`"${c}"\``))
  return `\`${row.spelling}\` on a \`${tf}\` chart is witnessed only as read at ${named.join(' and at ')} (capture-queue `
    + `row ${block.queue_row}), and this request reads it at \`"${code}"\``
}

/** ⭐ RS RATING L11 — the HELD timeframe and key a store ticker is fetched under on this chart (`SPX` on a
 *  weekly chart: at `D`, as `SPX@D`), or null when it is fetched at the chart's own timeframe as itself.
 *  One answer for the chart's fetch (`useSecondarySources`), the binder's memo and the harness. */
export function heldFetchOf(store, chartTf) {
  const s = String(store || '').trim().toUpperCase()
  const tf = chartTf == null ? '' : String(chartTf)
  for (const row of Object.values(_witnessRows)) {
    if (!row || String(row.store).toUpperCase() !== s) continue
    const block = row.periods && typeof row.periods === 'object' ? row.periods[tf] : null
    if (block && row.timeframes.includes(tf) && periodBlockServes(block, tf)) {
      return { symbol: s, tf: block.held, key: heldSecondaryKey(s, block.held, tf) }
    }
  }
  return null
}

/** ⭐⭐ RS RATING L12 — EVERY held fetch of a store ticker on this chart: `heldFetchOf`'s, then a block's second
 *  held series (an intraday chart holds SP:SPX at its own timeframe under the plain key AND at D as `SPX@D`).
 *  [] when nothing is held. The one list the chart's fetch, the binder's signature and the harness read. */
export function heldFetchesOf(store, chartTf) {
  const first = heldFetchOf(store, chartTf)
  if (!first) return []
  const s = String(store || '').trim().toUpperCase()
  const tf = chartTf == null ? '' : String(chartTf)
  const out = [first]
  for (const row of Object.values(_witnessRows)) {
    if (!row || String(row.store).toUpperCase() !== s) continue
    const block = row.periods && typeof row.periods === 'object' ? row.periods[tf] : null
    if (block && block.alsoHeld && periodBlockServes(block, tf)) {
      out.push({ symbol: s, tf: block.alsoHeld, key: heldSecondaryKey(s, block.alsoHeld, tf) })
      break
    }
  }
  return out
}

/** ⭐ RS RATING L11 — how many HELD daily rows a chart of `barCount` weekly bars needs: seven calendar
 *  days a week (a seed's rows are calendar days; an index's sessions are fewer) and two weeks before the
 *  first chart week (the previous week a fold reads, the previous session a daily read places), capped
 *  at what the index door answers (`api/index_bars.py`, 12,500 sessions; from 1990 that is all of it).
 *  ⭐ L13 — a MONTHLY chart: 31 calendar days a month and two months before the first chart month. */
export const HELD_DAILY_DEPTH_CAP = 12500
export function heldDepthOf(barCount, chartTf = 'W') {
  const n = Number.isFinite(barCount) && barCount > 0 ? Math.floor(barCount) : 200
  const tf = String(chartTf == null ? '' : chartTf)
  // ⭐ RS RATING L12 — an INTRADAY chart's daily rows: one per session its bars span, counted at the regular
  // session's 390 minutes (an extended-hours day holds more bars, so this is the deeper answer), plus ten
  if (Object.prototype.hasOwnProperty.call(INTRADAY_STEP_MIN, tf)) {
    return Math.min(HELD_DAILY_DEPTH_CAP, Math.ceil((n * INTRADAY_STEP_MIN[tf]) / 390) + 10)
  }
  const monthly = tf.replace(/^1/, '') === 'M'
  return Math.min(HELD_DAILY_DEPTH_CAP, monthly ? n * 31 + 62 : n * 7 + 14)
}

/** ⭐ A witnessed series' bars keyed the way the chart keys its own: by SESSION DATE
 *  (`interpret.js::isoDay` reads unix seconds, a `YYYYMMDD` int or an ISO day — an index's
 *  daily bars carry unix seconds at the session's UTC midnight, a stock's an ISO date), then
 *  placed by the row's `alignment`. A bar whose day cannot be read is dropped, never guessed. */
export function witnessedBarsOf(row, bars, own = null) {
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
  // ⭐⭐ RS RATING L11 PR 2 — EXCEPT ON THE CHART'S NEWEST BAR (`newestOwnPeriodOf`): there the newest
  // held row is read by the bar of its OWN session, in place of the previous session's row
  const newest = keyed[keyed.length - 1]
  const placed = ownPeriodPlaced(out, newest, own)
  // ⭐ RS RATING L13 — the newest row this read places on the NEXT session, kept for the one sample that
  // reads it (`belowChartSeriesOf`); not enumerable, so the series every bind reads is unchanged
  if (newest && placed[placed.length - 1] !== newest) {
    Object.defineProperty(placed, SERIES_NEWEST_UNPLACED, { value: newest, enumerable: false })
  }
  return placed
}

// ─── ⭐⭐ RS RATING L11 PR 2 — THE CHART'S NEWEST BAR READS ITS OWN PERIOD ─────────────────────────
//
// Witnessed (2026-11-17 captures, `docs/pine/RS-RATING-TRANSFER.md` L11 PR 2): every SETTLED bar of a
// stock chart reads `SP:SPX` one period back (`previous-session` daily, `previous-week` weekly), but
// TradingView's NEWEST bar reads the SAME period's value: the post-close RDDT / NVDA RS lines differ
// from ours only there (RDDT's rating 19 vs 18), the after-close probe read the same session's close
// (7340.53) on ALAB and RDDT from 21:13Z on, and the forming WEEK read the latest daily close (RDDT 1W,
// X05 7340.53 vs our previous week's 7561.67). One rule, decided once here, placed by the two
// placements above and below (`witnessedBarsOf`, `previousWeekBarsOf`) for every lane: the bind reads
// no bars, so each lane that asks it carries its chart's newest day in the context
// (`withChartNewestDay`).

/** ⭐⭐ WHEN THE NEWEST BAR READS ITS OWN PERIOD: while the held series' own session is IN PROGRESS
 *  (its `newestBarIsForming`, the index's own forming flag: in session, true; after the close, false).
 *  ⭐ Witnessed (2026-11-17/18): TradingView's newest bar reads its own session once the chart has had a
 *  REALTIME update since it loaded (Pine's `barstate.isrealtime`): every symbol ticks in session, so in
 *  session it always does; a FRESH load overnight read the previous session on all three probes (ALAB,
 *  RDDT, AGL 04:12Z, 7416.59), while a chart that ticked after the close read the same session (ALAB,
 *  RDDT 21:13Z-23:01Z, 7340.53) and one that had not, the previous (AGL 21:14Z). Session-level, so a daily
 *  and a weekly chart answer alike. ⏳ NOT YET MIRRORED: a chart that ticks AFTER the close (TradingView:
 *  own session until reloaded); here the index's session is over, so it reads the previous one. */
const NEWEST_BAR_READS_OWN_PERIOD = (entry) => !!(entry && entry.newestBarIsForming === true)

/** `ctx` with `chartNewestDay`: the session day of `bars`' newest bar (the bind reads no bars). */
export function withChartNewestDay(ctx, bars) {
  const n = Array.isArray(bars) ? bars.length : 0
  const day = n ? isoDay(bars[n - 1] && bars[n - 1].t) : null
  return { ...(ctx || {}), chartNewestDay: day || null }
}

/** The key of `day`'s period on a `tf` chart (a daily chart's day, a weekly chart's ISO week), or null. */
function periodKeyOf(day, tf) {
  if (!day) return null
  if (tf === 'D' || tf === '1D') return day
  if (tf === 'W' || tf === '1W') return tfBucket(day, 'W')
  if (tf === 'M' || tf === '1M') return tfBucket(day, 'M')
  return null
}

/** ⭐⭐ THE ONE AUTHORITY — which chart period reads its OWN period of a one-period-back witnessed series:
 *  `{tf, key}` (the chart's newest bar's period), or null (every bar reads one period back). `entry` is the
 *  held series' cache entry (its forming flag decides, `NEWEST_BAR_READS_OWN_PERIOD`). */
export function newestOwnPeriodOf(ctx, entry) {
  const c = ctx || {}
  const tf = c.tf == null ? '' : String(c.tf)
  const key = periodKeyOf(c.chartNewestDay, tf)
  if (!key || !NEWEST_BAR_READS_OWN_PERIOD(entry)) return null
  return { tf, key }
}

/** `out` (a one-period-back placement) with the chart's newest period reading `newest`, the newest held
 *  row, when that row belongs to it: the row placed on its own `t`, in place of the row one period back
 *  that the placement put there. Nothing changes when the newest held row is not the chart's newest
 *  period's (a held series that has not reached the chart's newest bar is never stretched to it). */
function ownPeriodPlaced(out, newest, own) {
  if (!own || !newest || periodKeyOf(isoDay(newest.t), own.tf) !== own.key) return out
  const placed = out.length && out[out.length - 1].t === newest.t ? out.slice(0, -1) : out.slice()
  placed.push(newest)
  return placed
}

/** ⭐⭐ RS RATING L11 (Q-RS7 R1) — `previous-week`: the held DAILY rows folded into Monday-to-Sunday
 *  weeks (the weekly bar `interpret.js::resampleTo` builds: the first open, the highest high, the lowest
 *  low, the last close, the summed volume), each week keyed as the product keys a weekly bar (its
 *  FRIDAY, `isoWeekDayOf(·, 5)`) one calendar week LATER: a weekly chart bar reads the week before its
 *  own. ⭐ Placed by the calendar, not by the next held week, so a chart week whose own daily rows have
 *  not arrived yet still reads the week before it (the newest held week lands on a key no chart bar has).
 *  ⛔ A row whose day cannot be read, or that is not after the row before it, is dropped, never merged
 *  into the wrong week. */
export function previousWeekBarsOf(bars, own = null) {
  const weeks = []
  let cur = null
  let lastDay = ''
  for (const b of bars) {
    const day = b && isoDay(b.t)
    if (!day || day <= lastDay) continue
    lastDay = day
    const friday = isoWeekDayOf(day, 5)
    if (!cur || cur.friday !== friday) {
      cur = { friday, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 }
      weeks.push(cur)
    } else {
      cur.h = Math.max(cur.h, b.h)
      cur.l = Math.min(cur.l, b.l)
      cur.c = b.c
      cur.v += (b.v || 0)
    }
  }
  const out = weeks.map((w) => ({ t: isoDayPlus(w.friday, 7), o: w.o, h: w.h, l: w.l, c: w.c, v: w.v }))
  // ⭐⭐ RS RATING L11 PR 2 — the chart's newest week reads its OWN week (`newestOwnPeriodOf`): the newest
  // held week, keyed on its own Friday, in place of the week before it (which the fold keyed there)
  const last = weeks[weeks.length - 1]
  if (!own || own.tf.replace('1', '') !== 'W' || !last || tfBucket(last.friday, 'W') !== own.key) return out
  const self = { t: last.friday, o: last.o, h: last.h, l: last.l, c: last.c, v: last.v }
  const i = out.findIndex((x) => x.t === last.friday)
  if (i >= 0) out[i] = self
  else out.splice(out.length - 1, 0, self)
  return out
}

/** ⭐⭐ RS RATING L13 (Q-RS-M R1) — `previous-month`: the held DAILY rows folded into calendar months (the
 *  monthly bar `bars_fetch._resample_monthly_iso` builds: the first open, the highest high, the lowest low,
 *  the last close, the summed volume), each month keyed as the product keys a monthly bar (its 1st) one
 *  calendar month LATER: a monthly chart bar reads the month before its own. ⭐ Placed by the calendar, as
 *  the weekly fold is, so a chart month whose own rows have not arrived still reads the month before it.
 *  ⭐ PR 2's rule: the chart's newest month reads its OWN month while the index session is on
 *  (`newestOwnPeriodOf`). ⛔ A row whose day cannot be read, or that is not after the row before it, is
 *  dropped, never merged into the wrong month. */
export function previousMonthBarsOf(bars, own = null) {
  const months = []
  let cur = null
  let lastDay = ''
  for (const b of bars) {
    const day = b && isoDay(b.t)
    if (!day || day <= lastDay) continue
    lastDay = day
    const first = `${day.slice(0, 8)}01`
    if (!cur || cur.first !== first) {
      cur = { first, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 }
      months.push(cur)
    } else {
      cur.h = Math.max(cur.h, b.h)
      cur.l = Math.min(cur.l, b.l)
      cur.c = b.c
      cur.v += (b.v || 0)
    }
  }
  const nextFirst = (first) => {
    const y = Number(first.slice(0, 4))
    const m = Number(first.slice(5, 7))
    return m === 12 ? `${String(y + 1).padStart(4, '0')}-01-01` : `${first.slice(0, 5)}${String(m + 1).padStart(2, '0')}-01`
  }
  const out = months.map((m) => ({ t: nextFirst(m.first), o: m.o, h: m.h, l: m.l, c: m.c, v: m.v }))
  const last = months[months.length - 1]
  if (!own || own.tf.replace('1', '') !== 'M' || !last || tfBucket(last.first, 'M') !== own.key) return out
  const self = { t: last.first, o: last.o, h: last.h, l: last.l, c: last.c, v: last.v }
  const i = out.findIndex((x) => x.t === last.first)
  if (i >= 0) out[i] = self
  else out.splice(out.length - 1, 0, self)
  return out
}

const ET_DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
/** The ET session date of unix seconds `t`. */
const etDayOf = (t) => ET_DAY_FMT.format(new Date(t * 1000))
/** Unix seconds of ET midnight on trading day `day` (from the calendar's own close instant: no DST transition
 *  falls on a trading day, every transition being a Sunday's 02:00), or null on a day that is not one. */
function etMidnightOf(day) {
  const close = closeTime(day)
  if (!close) return null
  return close.getTime() / 1000 - (isHalfDay(day) ? 13 * 60 : 16 * 60) * 60
}
/** The calendar day after ISO `day`. */
const nextDayOf = (day) => new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)
const EXT_OPEN_MIN = 4 * 60      // the extended session's first bar (04:00 ET), the product's and TradingView's grid
const EXT_END_MIN = 20 * 60      // and its end (20:00 ET)
const RTH_OPEN_MIN = 9 * 60 + 30

/** ⭐⭐ RS RATING L12 (Q-L12-1) — `latest-at-or-before`, laid out on the chart's OWN grid: a row at every
 *  `tf`-minute instant of the extended-hours clock (04:00..20:00 ET) of every NYSE session the held rows span,
 *  carrying what TradingView reads there (`WITNESS_PERIOD_READS.AT_OR_BEFORE`): in the regular session the index
 *  bar that opened at or before it (its own o/h/l/c/v); before the open the previous session's OFFICIAL close;
 *  from the close (16:00, 13:00 on a half-day) the day's official close (`daily`, the held daily rows; o = h = l
 *  = c there, only the close being witnessed). Keyed by the instant, so `interpret.js` `sym` (an exact `t` match)
 *  reads it on every chart bar of the grid, both lanes alike.
 *  ⛔ NEVER FILLED FORWARD PAST WHAT IS HELD: no row after the newest intraday bar's own period in the session
 *  (a stale copy must withhold, not repeat its last print), no regular-session row before a session's first held
 *  bar, no post-close row until that session's daily row is held and settled (`dailyForming`: the newest daily
 *  row of a session still in progress is not a close), no pre-market row without the previous close. A chart
 *  bar with no row is UNKNOWN, and so is every bar before the first row (`SERIES_UNKNOWN_BEFORE_FIRST`: our
 *  store's intraday depth, 7 days of 1m, 60 of 5/15/30m, 730 of 60m, is not the index's first bar).
 *  ⛔ A row whose `t` is not unix seconds is dropped, never guessed. */
export function atOrBeforeGridOf(bars, daily, tf, { dailyForming = false } = {}) {
  const out = []
  Object.defineProperty(out, SERIES_UNKNOWN_BEFORE_FIRST, { value: true, enumerable: false })
  const step = INTRADAY_STEP_MIN[String(tf)]
  const intr = []
  let last = -Infinity
  for (const b of bars || []) {
    if (!b || typeof b.t !== 'number' || !Number.isFinite(b.t) || b.t <= last) continue
    last = b.t
    intr.push(b)
  }
  if (!step || !intr.length) return out
  const closes = new Map()
  const dailyRows = (Array.isArray(daily) ? daily : []).filter((r) => r && isoDay(r.t) && Number.isFinite(r.c))
  dailyRows.forEach((r, j) => {
    if (dailyForming && j === dailyRows.length - 1) return
    closes.set(isoDay(r.t), r.c)
  })
  const firstDay = etDayOf(intr[0].t)
  const newest = intr[intr.length - 1]
  const newestEnd = newest.t + step * 60
  const lastHeld = [etDayOf(newest.t), ...closes.keys()].sort().pop()
  // the session before the first held one: its close is what that first session's pre-market reads
  let prevClose = null
  for (const [day, c] of closes) if (day < firstDay) prevClose = c
  let p = 0                                                  // the first held bar not before this session's open
  for (let d = firstDay, k = 0; k < 4000; d = nextDayOf(d), k += 1) {
    if (d > lastHeld && prevClose === null) break
    if (!isTradingDay(d)) continue
    const mid = etMidnightOf(d)
    if (mid === null) continue
    const open = mid + RTH_OPEN_MIN * 60
    const close = closeTime(d).getTime() / 1000
    const own = closes.has(d) ? closes.get(d) : null
    while (p < intr.length && intr[p].t < open) p += 1        // this session's first held bar
    let j = p
    for (let g = mid + EXT_OPEN_MIN * 60; g < mid + EXT_END_MIN * 60; g += step * 60) {
      let row = null
      if (g < open) {
        if (prevClose !== null) row = { t: g, o: prevClose, h: prevClose, l: prevClose, c: prevClose, v: 0 }
      } else if (g >= close) {
        if (own !== null) row = { t: g, o: own, h: own, l: own, c: own, v: 0 }
      } else {
        while (j + 1 < intr.length && intr[j + 1].t <= g && intr[j + 1].t < close) j += 1
        const r = intr[j]
        if (r && r.t >= open && r.t <= g && r.t < close && (r !== newest || g < newestEnd)) {
          row = { t: g, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }
        }
      }
      if (row) out.push(row)
    }
    if (own !== null) prevClose = own
    if (d > lastHeld) break
  }
  return out
}

/** The fold a `period` read names (`previous-week` / `previous-month` / `latest-at-or-before`) over the held
 *  rows, or null. `also` (L12): the second held series and the chart timeframe, for an intraday chart. */
export function periodFoldOf(fold, held, own = null, also = null) {
  if (fold === WITNESS_PERIOD_READS.PREVIOUS_WEEK) return previousWeekBarsOf(held, own)
  if (fold === WITNESS_PERIOD_READS.PREVIOUS_MONTH) return previousMonthBarsOf(held, own)
  if (fold === WITNESS_PERIOD_READS.AT_OR_BEFORE) {
    return atOrBeforeGridOf(held, also && also.daily, also && also.tf, { dailyForming: !!(also && also.dailyForming) })
  }
  return null
}

/** The first trading session on or after `day` (the exchange calendar, `sessionCalendar.js`), or null. */
function firstSessionFrom(day) {
  let d = day
  for (let k = 0; k < 10 && d; k += 1) {
    if (isTradingDay(d)) return d
    d = isoDayPlus(d, 1)
  }
  return null
}

/** ⭐⭐ RS RATING L13 — THE NEWEST HELD ROW OF A `previous-session` SERIES, which that read places on the NEXT
 *  session (`witnessedBarsOf` drops it: no chart bar of a daily chart is that session yet). Kept beside the
 *  placed series (not enumerable, so nothing that reads the series sees it) for the one read that does see
 *  it: a `*-last-row` sample below a weekly or monthly chart, whose FORMING period contains that next session.
 *  Witnessed twice: NYSE:RDDT 1W after the close (2026-11-17T21:18Z, X04 = 7340.53, the 2026-11-17 close
 *  placed on 2026-11-18) and NYSE:RDDT 1M pre-market (2026-11-18T12:4xZ, X04 = 7340.53 again). */
export const SERIES_NEWEST_UNPLACED = Symbol('otherSymbols.newestUnplaced')

/** `series` for a sample below the chart: for a `*-last-row` sample, with the newest unplaced row (if any)
 *  placed on its next session, the one row that read places there; every other sample reads `series`. */
export function belowChartSeriesOf(series, sample) {
  const newest = series && series[SERIES_NEWEST_UNPLACED]
  if (!LAST_ROW_SAMPLES.includes(sample) || !newest) return series
  const after = isoDayPlus(isoDay(newest.t), 1)
  const next = after ? firstSessionFrom(after) : null
  if (!next) return series
  const last = series.length ? isoDay(series[series.length - 1].t) : null
  if (last && last >= next) return series
  return [...series, { ...newest, t: next }]
}

/** ⭐⭐ RS RATING L11 (Q-RS7 R2 / R4) — WHICH ROW OF A DAILY SERIES EACH WEEKLY CHART BAR READS, by the
 *  block's SAMPLE: `{index, withheld}`, `index[i]` the row of `series` chart bar `i` reads (`-1`: none,
 *  Pine's `na`), `withheld` a 0/1 column. The chart bar's week is read off its own `t` (any day of the
 *  week names it: the product's Friday key, a capture's Monday), so nothing here depends on how the
 *  chart keys a week.
 *    `week-last-row`  — the week's LAST row of `series` (the row's daily read already placed each row:
 *                       `previous-session` puts each SPX bar on the next session, so the last row of a
 *                       week is the bar of the session before its last). A week with no row after the
 *                       series began is UNKNOWN (withheld); before it began, `na`.
 *    `week-first-day` — the row dated the week's Monday; none reads `na` (the seed's witnessed gaps,
 *                       `same-date-gaps-na`: known, never withheld).
 *  `series` is the row's daily read (`witnessedBarsOf`), so the request's expression runs on DAILY bars
 *  and only its value is sampled. */
export function periodSampleOf(series, chartBars, sample) {
  const n = Array.isArray(chartBars) ? chartBars.length : 0
  const index = new Array(n).fill(-1)
  const withheld = new Float64Array(n)
  // ⭐ L13 — the period the sample names: a week (`week-*`) or a month (`month-*`)
  const code = periodCodeOfRead(sample)
  if (!code || PERIOD_READS_OF[code].folds.includes(sample)) { withheld.fill(1); return { index, withheld } }
  const lastRow = LAST_ROW_SAMPLES.includes(sample)
  // the first-day rule: a week's Monday; a month's FIRST SESSION (`month-first-session`)
  const opensPeriod = code === 'W' ? (day) => isoWeekDayOf(day, 1) === day
    : (day) => day === firstSessionFrom(`${day.slice(0, 8)}01`)
  const byPeriod = new Map()
  let firstDay = null
  for (let j = 0; j < (series || []).length; j += 1) {
    const day = series[j] && isoDay(series[j].t)
    if (!day) continue
    if (firstDay === null || day < firstDay) firstDay = day
    const key = tfBucket(day, code)
    if (lastRow) byPeriod.set(key, j)
    else if (opensPeriod(day) && !byPeriod.has(key)) byPeriod.set(key, j)
  }
  for (let i = 0; i < n; i += 1) {
    const day = chartBars[i] && isoDay(chartBars[i].t)
    if (!day) { withheld[i] = 1; continue }
    const j = byPeriod.get(tfBucket(day, code))
    if (j !== undefined) index[i] = j
    else if (lastRow && firstDay !== null && day > firstDay) withheld[i] = 1
  }
  return { index, withheld }
}
/** The weekly name the L11 rails and callers spell (one function, `periodSampleOf`). */
export const weekSampleOf = periodSampleOf

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
  // ⭐ RS RATING L11 — a series served for a read BELOW the chart names how each chart bar samples it
  const samples = {}
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
      // ⭐⭐ RS RATING L11 — WHICH READ OF THE ROW THIS CHART IS (`witnessReadOf`): the row's own
      // timeframe as before, or a block's (a weekly chart: the series held at `D`, folded for a
      // `timeframe.period` read, sampled for a daily one). `ctx.requestCode` is the run's request
      // timeframe (`requestSupply.js`); the host bind states none.
      const read = witnessReadOf(row, tf, Object.prototype.hasOwnProperty.call(ctx, 'requestCode') ? ctx.requestCode : undefined)
      if (!read) {
        no(ticker, OTHER_SYMBOL_REFUSAL.WITNESS_TIMEFRAME, witnessTimeframeWhy(row, tf, ctx.requestCode))
        continue
      }
      const entry = secondary ? secondary.get(read.key) : null
      const held = entry && Array.isArray(entry.bars) ? entry.bars : null
      if (!held || !held.length) {
        no(ticker, OTHER_SYMBOL_REFUSAL.NO_BARS, `\`${row.spelling}\`'s bars for this timeframe are not in hand`
          + (entry && entry.status ? ` (${entry.status})` : ''))
        if (!entry || String(entry.status || '') === 'loading') refused[refused.length - 1].pending = true
        continue
      }
      // ⭐ RS RATING L12 — a block held at a second timeframe too (an intraday chart's daily rows)
      let also = null
      if (read.alsoKey) {
        const second = secondary ? secondary.get(read.alsoKey) : null
        const rowsD = second && Array.isArray(second.bars) ? second.bars : null
        if (!rowsD || !rowsD.length) {
          no(ticker, OTHER_SYMBOL_REFUSAL.NO_BARS, `\`${row.spelling}\`'s daily rows (its official closes, read on this `
            + 'chart\'s extended-hours bars) are not in hand' + (second && second.status ? ` (${second.status})` : ''))
          if (!second || String(second.status || '') === 'loading') refused[refused.length - 1].pending = true
          continue
        }
        also = { daily: rowsD, tf, dailyForming: second.newestBarIsForming === true }
      }
      const own = newestOwnPeriodOf(ctx, entry)
      symbols[ticker] = read.fold ? periodFoldOf(read.fold, held, own, also) : witnessedBarsOf(row, held, own)
      if (read.sample) samples[ticker] = read.sample
      served.push(ticker)
      continue
    }
    // ⭐ RS RATING L11 — a daily read of a LISTING below a weekly chart (the run's request, `ctx.below`):
    // no capture witnesses how TradingView samples one there, and this chart holds only its weekly bars
    if (ctx.below === true) {
      no(ticker, OTHER_SYMBOL_REFUSAL.WITNESS_TIMEFRAME, `\`${ticker}\` is read at \`"D"\` below this `
        + `${ctx.tf ? `\`${ctx.tf}\`` : ''} chart, and a daily read below the chart is witnessed only for the spellings `
        + '`requestWitnesses.json` names a weekly read for (`SP:SPX`, the RS Rating seed), not for a listing')
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
  // ⭐ RS RATING L11 — `samples` only where one is read (a daily chart's answer keeps its shape)
  return Object.keys(samples).length ? { symbols, served, refused, samples } : { symbols, served, refused }
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
 *  compute memo that must recompute when a secondary series lands.
 *
 *  ⭐⭐ RS RATING L10 — EVERY SERIES THE DOCUMENT READS, NOT ONLY THE ONES ITS PLOT TREES READ
 *  (`otherSymbolRequestsOf`: the trees' `sym` reads AND the translation's recorded
 *  `meta.otherSymbols`, which carry the run half's own reads). ⚰️ 2026-11-17, production, in
 *  session: RS Rating added from "Your indicators" stayed refused `runtime:request` for minutes on
 *  some loads. Its trees read only SPX; its rating label reads the seed (`request.seed` → RSRATING)
 *  in the run half alone, so the signature was `SPX:…` only. When SPX landed before the seed (whose
 *  fetch was waiting on a retry), the run refused, and the seed landing did not move the signature:
 *  the binder's memo never recomputed. When both landed together, or the door's preview had
 *  fetched both first, it drew. */
export function otherSymbolsSignature(def, secondary, chartTf) {
  const requests = otherSymbolRequestsOf(def)
  if (!requests.length) return ''
  // ⭐ RS RATING L6b — a witnessed spelling's series is held under its row's store key
  // ⭐ RS RATING L11 — and, on a chart that holds it at another timeframe, under its held key
  // (`SPX@D` on a weekly chart: `heldFetchOf`, the key the chart's fetch files it under)
  const recorded = new Map(requests.map((r) => [r.ticker, r.spellings]))
  const keyOf = (t) => {
    const row = (recorded.get(t) || []).map((v) => witnessRowOf(v, t)).find(Boolean)
    if (!row) return storeTickerOf(t)
    const held = heldFetchesOf(row.store, chartTf)
    return held.length ? held.map((h) => h.key) : [row.store]
  }
  return requests.map(({ ticker: t }) => [].concat(keyOf(t)).map((key) => {
    const e = secondary && typeof secondary.get === 'function' ? secondary.get(key) : null
    const bars = e && Array.isArray(e.bars) ? e.bars : null
    const last = bars && bars.length ? bars[bars.length - 1] : null
    // ⭐ RS RATING L11 PR 2 — and whether its session is in progress: the chart's newest bar reads its own
    // session only then (`newestOwnPeriodOf`), so the close (bars unchanged, the flag flipped) is a recompute
    // ⭐ RS RATING L12 — every held key of the ticker (an intraday chart's daily rows landing is a recompute)
    return `${t}:${e ? e.status || '' : '-'}:${bars ? bars.length : 0}:${last ? `${last.t}/${last.c}` : ''}`
      + `${e && e.newestBarIsForming === true ? ':forming' : ''}`
  }).join('+')).join(',')
}
