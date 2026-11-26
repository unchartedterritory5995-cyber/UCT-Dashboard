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
import { isoDay, SERIES_GAPS_READ_NA, SERIES_UNKNOWN_BEFORE_FIRST, isoWeekDayOf, isoDayPlus, tfBucket, EVENT_BEFORE_RECORD_CODE,
  SERIES_EVENT_RECORD, BREADTH_BEFORE_RECORD_CODE } from './ast/interpret'
// ⭐ RS RATING L13 — the exchange's sessions (a month's first session, a row's next session)
import { isTradingDay, closeTime, isHalfDay } from '../../../lib/marketClock/sessionCalendar.js'
import REQUEST_WITNESSES from './requestWitnesses.json'
// ⭐⭐ e98 (the 4h grid follows the chart's spec) — the ONE authority for where a custom intraday chart's bars start
import { resampleSpec } from '../timeframes'
// ⭐⭐ T4 B2 — TradingView's `USI:` breadth spellings, served from UCT's own breadth (`pineBreadth.js`)
import { BREADTH_VENUE, BREADTH_SPELLINGS, BREADTH_COVERAGE_FROM, BREADTH_DATA_WORDS, breadthBaseOf, breadthStaticRefusal, isBreadthSpread,
  breadthSpreadRefusal, breadthIntradayReason, breadthNotAvailableReason } from './pineBreadth.js'
// ⭐⭐ T4 E2 — the chart's own corporate events (`request.earnings` / `request.dividends` / `request.splits`)
import { EVENT_VENUE, EVENTS_KEY, EVENT_TICKER, eventReadOf, eventStaticRefusal, eventSpellingReason, eventLabel,
  eventTimeframeCode, placeEvents, markEventSeries, EARNINGS_WINDOW_FROM, EVENT_DATE_KEY } from './pineEvents.js'
// ⭐⭐ T4 F1b — the chart's own financial figures (`request.financial`), as UCT data from company filings
import { FINANCIAL_KEY, FINANCIAL_UNKNOWN_CODE, financialReadOf, financialLabel, financialTimeframeCode, placeFinancial,
  markFinancialSeries } from './pineFinancial.js'

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
  // ⭐⭐ T4 E2 — a corporate-events read (`pineEvents.js`), each refused by its own name:
  EVENT_SPELLING: 'other-symbol:event-spelling',        // a script WROTE the engine's internal event name as a symbol
  EVENT_FIELD: 'other-symbol:event-field',              // a field UCT does not hold (standardized, net)
  EVENT_SYMBOL: 'other-symbol:event-symbol',            // another symbol's events
  EVENT_CURRENCY: 'other-symbol:event-currency',        // converted into another currency
  EVENT_ARGUMENT: 'other-symbol:event-argument',        // an argument the door cannot read before the run
  EVENT_TIMEFRAME: 'other-symbol:event-timeframe',      // a chart timeframe no capture witnesses the placement on
  EVENT_NOT_AVAILABLE: 'other-symbol:event-not-available', // the events door is dark or refused for this member
  EVENT_NONE: 'other-symbol:event-none',                // UCT holds no event of the family for this symbol
  EVENT_UNAVAILABLE: 'other-symbol:event-unavailable',  // the events could not be read just now
  EVENT_BEFORE_RECORD: EVENT_BEFORE_RECORD_CODE,         // PER BAR: a bar before UCT's record of the family
  // ⭐⭐ T4 F1b — a financial read (`pineFinancial.js`, UCT data from company filings), each refused by its own name:
  FINANCIAL_FIELD: 'other-symbol:financial-field',          // an id UCT does not serve (named, with its reason)
  FINANCIAL_PERIOD: 'other-symbol:financial-period',        // a period UCT does not serve for the id, or not readable
  FINANCIAL_SYMBOL: 'other-symbol:financial-symbol',        // another symbol's figures
  FINANCIAL_CURRENCY: 'other-symbol:financial-currency',    // converted into another currency
  FINANCIAL_ARGUMENT: 'other-symbol:financial-argument',    // an argument the door cannot read before the run
  FINANCIAL_TIMEFRAME: 'other-symbol:financial-timeframe',  // an intraday chart (a figure is dated by session)
  FINANCIAL_NOT_AVAILABLE: 'other-symbol:financial-not-available', // the door is dark or refused for this member
  FINANCIAL_NONE: 'other-symbol:financial-none',            // the company's filings do not yield the figure
  FINANCIAL_WITHHELD: 'other-symbol:financial-withheld',    // a per-share figure while the split history is unverified
  FINANCIAL_UNAVAILABLE: 'other-symbol:financial-unavailable', // the figures could not be read just now
  FINANCIAL_UNKNOWN: FINANCIAL_UNKNOWN_CODE,                // PER BAR: a bar UCT knows no current figure on
  // ⭐⭐ T4 B2 — a `USI:` breadth read (`pineBreadth.js`), each refused by its own name:
  BREADTH_NOT_HELD: 'other-symbol:breadth-not-held',    // volume breadth, TICK / TRIN: UCT holds none
  BREADTH_EXCHANGE: 'other-symbol:breadth-exchange',    // another exchange's counts (AMEX, Arca, the US composite, the Dow)
  BREADTH_UNKNOWN: 'other-symbol:breadth-unknown',      // any other `USI:` series
  BREADTH_SPREAD: 'other-symbol:breadth-spread',        // several breadth spellings in one string (the built-in ADL's)
  BREADTH_INTRADAY: 'other-symbol:breadth-intraday',    // an intraday chart: UCT holds one count per session
  BREADTH_NOT_AVAILABLE: 'other-symbol:breadth-not-available', // the breadth door is dark or refused for this member
  BREADTH_BEFORE_RECORD: BREADTH_BEFORE_RECORD_CODE,     // PER BAR: a bar before UCT's breadth counts begin
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
  // ⭐⭐ RS RATING L12 PR 2 (U-DAILY, `l12-is-2026-11-18`, the rs-spx probe's X01..X04) — a DAILY read ABOVE an
  // intraday chart: each chart bar reads the daily row its session had COMPLETED: a bar opening before the
  // session's close reads the previous session's row (pre-market and regular bars: every one, 1 / 5 / 15 / 30 /
  // 60m), a bar from the close on the session's own (post-market: 1m 2,258, 5m 4,015, 15m 5,056, 30m 4,959, 60m
  // 2,617; the first 1m / 5m post bars on some days still the previous one, the official print's own lag).
  SESSION_COMPLETED: 'session-completed',
  // ⭐⭐ RS RATING L12 PR 2 (Q-L12-2, `l12-now-2026-11-18`, the rs-seed probe) — a Pine SEED on an INTRADAY chart
  // (a read AT D, held at D: a seed is served daily only): each row, dated D, is stamped D 00:00 UTC and read on the
  // FIRST chart bar opening at or after that instant (in EST the previous session's 19:00 bar, 19:05 / 19:15 where
  // the 5m chart has no 19:00 bar; in EDT, 20:00 ET being past the extended session, the next session's 04:00 bar);
  // several rows on one bar (a weekend's), the NEWEST; every other bar `na`. RDDT 5m 20,681 of 20,681 and 60m
  // 10,353 of 10,353 bars, values and na, three fields; "the oldest wins" is off on the 2 weekend bars, a bar that
  // CONTAINS the instant on 21, ET midnight on 18. `utcMidnightAtOrAfterOf`.
  UTC_MIDNIGHT_AT_OR_AFTER: 'utc-midnight-at-or-after',
  // ⭐⭐ T4 B2 — FOLD (a `period` read), for a series whose DAILY read is `same-date` (`pineBreadth.js`, pending Q-T4-B2):
  // the held daily rows folded into Monday-to-Sunday weeks / calendar months exactly as `previous-week` /
  // `previous-month` fold them, each read on the chart bar of its OWN week / month (no shift)
  SAME_WEEK: 'same-week',
  SAME_MONTH: 'same-month',
})
/** ⭐ RS RATING L12 — the intraday chart timeframes a block may stand on, and their bar step in minutes. */
const INTRADAY_STEP_MIN = Object.freeze({ 1: 1, 5: 5, 15: 15, 30: 30, 60: 60 })
/** ⭐⭐ e98 (Q-FRED-4H, `fred-4h-2026-11-24`) — a CUSTOM intraday chart timeframe a block may stand on, and its bar step in
 *  minutes. The route serves no 240 (`api/index_bars.py`), so the chart builds its own 4h bars from 60m rows on the
 *  09:30-anchored session (`timeframes.js::resampleSpec`, `resampleBars.js::resampleIntradaySession`), and the index's
 *  entry under the plain key is built by the SAME rule (`secondaryBars.js`, e95: fetched at the native base, resampled
 *  by `resampleForSpec`). So a 240 block is held at ITSELF, as every native intraday one is, and this module never
 *  resamples: one rule builds both the chart's bars and the index's. Its grid is the chart's own 4h bars
 *  (`atOrBeforeGridOf`), anchored where the CHART's spec starts them (`resampleSpec(tf, { extended })`: 09:30 regular,
 *  04:00 extended), the chart's session carried in the secondary map (`CHART_SESSION_KEY`).
 *  ⭐ The INDEX's 4h bars are built on the index's own 09:30-anchored session whatever the chart's view (the witness:
 *  `/api/bars/SPX?tf=60` rows, [09:30, 13:30) and [13:30, 16:00); `useSecondarySources.js::ensureChartSources` fetches
 *  a held key on the regular session). */
const CUSTOM_INTRADAY_STEP_MIN = Object.freeze({ 240: 240 })
/** Every intraday chart timeframe the `latest-at-or-before` grid is laid on, and its step. */
const GRID_STEP_MIN = Object.freeze({ ...INTRADAY_STEP_MIN, ...CUSTOM_INTRADAY_STEP_MIN })

/** ⭐ PER CHART TIMEFRAME: the timeframe its blocks are held at, and the folds (a `period` read) and
 *  samples (a read below the chart) a block on it may name. A daily read on a weekly or a monthly chart
 *  are the witnessed shapes; a week's reads never stand on a month, nor the other way. */
const PERIOD_READS_OF = Object.freeze({
  W: Object.freeze({ held: 'D', folds: [WITNESS_PERIOD_READS.PREVIOUS_WEEK, WITNESS_PERIOD_READS.SAME_WEEK],
    samples: [WITNESS_PERIOD_READS.WEEK_LAST_ROW, WITNESS_PERIOD_READS.WEEK_FIRST_DAY] }),
  M: Object.freeze({ held: 'D', folds: [WITNESS_PERIOD_READS.PREVIOUS_MONTH, WITNESS_PERIOD_READS.SAME_MONTH],
    samples: [WITNESS_PERIOD_READS.MONTH_LAST_ROW, WITNESS_PERIOD_READS.MONTH_FIRST_SESSION] }),
  // ⭐ RS RATING L12 — each intraday timeframe is held at ITSELF (the index's own bars of the chart's period)
  // and ALSO at D (its official daily closes, for the extended-hours bars)
  ...Object.fromEntries(Object.keys(INTRADAY_STEP_MIN).map((tf) => [tf,
    Object.freeze({ held: tf, alsoHeld: 'D', folds: [WITNESS_PERIOD_READS.AT_OR_BEFORE], samples: [],
      // ⭐ RS RATING L12 PR 2 — the reads at the SECOND held timeframe (a daily read above the chart)
      above: [WITNESS_PERIOD_READS.SESSION_COMPLETED],
      // ⭐ RS RATING L12 PR 2 (Q-L12-2) — the OTHER shape a block on an intraday chart may take: a series that
      // exists only as daily rows (a Pine seed), held at D alone and read AT D (`request.seed` IS
      // `request.security(<seed>, "D", …)`, `pine.js::seedAsSecurity`), each row landed on one of the chart's bars
      daily: Object.freeze({ held: 'D', folds: [], samples: [WITNESS_PERIOD_READS.UTC_MIDNIGHT_AT_OR_AFTER] }) })])),
  // ⭐⭐ e98 (Q-FRED-4H) — a 4h chart: held at ITSELF (the index's 60m rows resampled to the chart's own 4h bars by the
  // chart's rule, `CUSTOM_INTRADAY_STEP_MIN`) and at D. ⛔ No `daily` shape: no capture witnesses a seed on a 4h chart.
  ...Object.fromEntries(Object.keys(CUSTOM_INTRADAY_STEP_MIN).map((tf) => [tf,
    Object.freeze({ held: tf, alsoHeld: 'D', folds: [WITNESS_PERIOD_READS.AT_OR_BEFORE], samples: [],
      above: [WITNESS_PERIOD_READS.SESSION_COMPLETED] })])),
})
/** The shape a block names on its chart timeframe: the timeframe's own, or (an intraday chart) its `daily` one. */
function blockShapeOf(block, chartTf) {
  const of = PERIOD_READS_OF[chartTf]
  if (!of || !block) return null
  if (block.held === of.held) return of
  return of.daily && block.held === of.daily.held ? of.daily : null
}
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
    // ⛔ T4 E2 — an `event` row is never a spelling: it names no bars a symbol string could fetch (`eventRowsOf`)
    if (k.startsWith('_') || !v || typeof v !== 'object' || typeof v.store !== 'string' || v.kind === 'event') continue
    const spelling = k.trim().toUpperCase()
    out[spelling] = Object.freeze({ ...v, spelling,
      timeframes: Object.freeze(Array.isArray(v.timeframes) ? v.timeframes.map(String) : []) })
  }
  return Object.freeze(out)
}
let _witnessRows = witnessRowsOf(REQUEST_WITNESSES && REQUEST_WITNESSES.rows)

/** ⭐⭐ T4 E2 — the `event` rows, by family (`earnings` / `dividends` / `splits`): the timeframes E0's captures
 *  witness the placement on, and the capture. ⛔ Read only for a read the parse rewrite made (`EVENT_VENUE`). */
function eventRowsOf(rows) {
  const out = {}
  for (const [k, v] of Object.entries(rows || {})) {
    if (k.startsWith('_') || !v || typeof v !== 'object' || v.kind !== 'event' || typeof v.family !== 'string') continue
    out[v.family] = Object.freeze({ ...v, spelling: k.trim().toUpperCase(),
      timeframes: Object.freeze(Array.isArray(v.timeframes) ? v.timeframes.map(String) : []) })
  }
  return Object.freeze(out)
}
let _eventRows = eventRowsOf(REQUEST_WITNESSES && REQUEST_WITNESSES.rows)
/** The placements an event row may name (`pineEvents.js::placeEvents`). ⛔ An unknown name serves nothing. */
export const EVENT_PLACEMENTS = Object.freeze({ SESSION_CLOSE_STAMP: 'session-close-stamp' })
/** Is this event row's capture in, and does it witness this chart timeframe with a placement this module knows? */
export function eventRowServes(row, tfCode) {
  return !!row && typeof row.witness === 'string' && row.witness.trim() !== ''
    && typeof row.captured === 'string' && row.captured.trim() !== ''
    && Object.values(EVENT_PLACEMENTS).includes(row.placement) && row.timeframes.includes(tfCode)
}
/** The event row of a family, or null. */
export function eventRowOf(family) { return _eventRows[family] || null }

/** Every witness row, keyed by spelling. */
export function requestWitnessRows() { return _witnessRows }

/** ⛔ TEST SEAM — replace the rows (`null` restores the committed file). A rail injects the
 *  witnessed row exactly as the landed capture's one data edit writes it. */
export function setRequestWitnessRows(rows) {
  _witnessRows = witnessRowsOf(rows || (REQUEST_WITNESSES && REQUEST_WITNESSES.rows))
  _eventRows = eventRowsOf(rows || (REQUEST_WITNESSES && REQUEST_WITNESSES.rows))
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
    + 'capture has not been matched, so what this indicator draws from it is not computed.'
    // ⭐ T4 B2 — and a breadth spelling says what it will be when it is served
    + (row.kind === 'breadth' ? ` It is a market breadth series, which UCT serves from ${BREADTH_DATA_WORDS} once that `
      + 'capture lands.' : '') }
}

/** ⭐ RS RATING L11 — is this chart timeframe's block in (`witness` + `captured`), held at the one
 *  witnessed timeframe, and does it name only reads this module knows? */
export function periodBlockServes(block, chartTf) {
  if (!block || typeof block !== 'object') return false
  if (!(typeof block.witness === 'string' && block.witness.trim() && typeof block.captured === 'string' && block.captured.trim())) return false
  const of = blockShapeOf(block, chartTf)
  if (!of) return false
  // ⭐ RS RATING L12 — a block held at a second timeframe too names exactly the one its chart timeframe holds
  if ((of.alsoHeld || null) !== (block.alsoHeld || null)) return false
  const reads = block.reads
  if (!reads || typeof reads !== 'object' || !Object.keys(reads).length) return false
  return Object.entries(reads).every(([code, how]) => (code === 'period' ? of.folds.includes(how)
    : code === of.held ? of.samples.includes(how)
      : !!of.alsoHeld && code === of.alsoHeld && Array.isArray(of.above) && of.above.includes(how)))
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
  } else if (block.alsoHeld && String(code) === block.alsoHeld && reads[block.alsoHeld]) {
    // ⭐ RS RATING L12 PR 2 — a daily read above an intraday chart: the SECOND held series, sampled per bar
    return { held: block.alsoHeld, key: heldSecondaryKey(row.store, block.alsoHeld, tf), fold: null,
      sample: reads[block.alsoHeld], alsoKey: null }
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
export function heldDepthOf(barCount, chartTf = 'W', heldSessions = 0) {
  const n = Number.isFinite(barCount) && barCount > 0 ? Math.floor(barCount) : 200
  const tf = String(chartTf == null ? '' : chartTf)
  // ⭐ RS RATING L12 — an INTRADAY chart's daily rows: one per session its bars span, counted at the regular
  // session's 390 minutes (an extended-hours day holds more bars, so this is the deeper answer), plus ten
  // ⭐⭐ (e91, the e88 in-session capture) — AND AT LEAST THE SESSIONS THE CHART'S BARS ACTUALLY SPAN (`heldSessions`,
  // `sessionsSpanned` rounded up a rung by the chart). ⚰️ A count at 78 bars a session is short for a symbol that trades in
  // fewer slots: RDDT's regular-hours 5m chart (18,749 rows, 273 sessions, ~69 a session) was held 267 daily rows, 7
  // sessions short of its first bar, and the run refused the chart for the bars it could not read.
  // ⭐ e98 — a 4h chart's too (`GRID_STEP_MIN`: 240 minutes a bar)
  if (Object.prototype.hasOwnProperty.call(GRID_STEP_MIN, tf)) {
    const byRows = Math.ceil((n * GRID_STEP_MIN[tf]) / 390) + 10
    const bySpan = Number.isFinite(heldSessions) && heldSessions > 0 ? Math.floor(heldSessions) + 10 : 0
    return Math.min(HELD_DAILY_DEPTH_CAP, Math.max(byRows, bySpan))
  }
  const monthly = tf.replace(/^1/, '') === 'M'
  return Math.min(HELD_DAILY_DEPTH_CAP, monthly ? n * 31 + 62 : n * 7 + 14)
}

const SPANNED_CACHE_MAX = 512
const _spannedMemo = new Map()
/** ⭐⭐ (e91) THE TRADING SESSIONS an intraday chart's bars span, from its first bar's session to its newest bar's, counted
 *  on the exchange calendar (`isTradingDay`), never estimated from its row count. Pure: two bar times (unix seconds), no
 *  wall clock (this module is in the run's host-neutral closure). 0 for anything else (a daily chart's ISO dates). */
export function sessionsSpanned(firstT, lastT) {
  if (typeof firstT !== 'number' || typeof lastT !== 'number' || !Number.isFinite(firstT) || !(lastT >= firstT)) return 0
  const a = etDayOf(firstT)
  const b = etDayOf(lastT)
  // ⭐ PERF (smoothness trace 2026-11-26): the count of a span of DAYS is kept (a pure function of the two days and the
  // static calendar), so a chart asking again for the same first and last session pays one lookup, not a walk over every
  // calendar day between them (a 60m chart's deep history spans thousands).
  const key = `${a}|${b}`
  const kept = _spannedMemo.get(key)
  if (kept !== undefined) return kept
  let count = 0
  for (let d = a, k = 0; d <= b && k < 40000; d = nextDayOf(d), k += 1) if (isTradingDay(d)) count += 1
  if (_spannedMemo.size >= SPANNED_CACHE_MAX) _spannedMemo.clear()
  _spannedMemo.set(key, count)
  return count
}
/** The held-session ladder: a chart's span rounded UP to a rung (`heldSessionsRung`), so a filling chart refetches its
 *  daily rows a few times, never once per fill step (the same discipline as `useSecondarySources.js::heldSpanFor`). */
export const HELD_SESSION_LADDER = Object.freeze([64, 128, 256, 512, 1024, 2048, 4096, 8192, HELD_DAILY_DEPTH_CAP])
export function heldSessionsRung(sessions) {
  if (!Number.isFinite(sessions) || sessions <= 0) return 0
  return HELD_SESSION_LADDER.find((r) => r >= sessions) ?? HELD_DAILY_DEPTH_CAP
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
  // ⭐ RS RATING L12 PR 2 (Q-L12-2) — and the chart's bars themselves, for the one fold that lands a row on the
  // first chart bar at or after its instant (`utcMidnightAtOrAfterOf`): the real bars, never a grid (a 5m chart
  // with no 19:00 bar reads the row at 19:05)
  return { ...(ctx || {}), chartNewestDay: day || null, chartBars: Array.isArray(bars) ? bars : null }
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
/** The calendar day after ISO `day`.
 *  ⭐ PERF (smoothness trace 2026-11-26, 5m+60m board): the day walks (`sessionsSpanned`, `atOrBeforeGridOf`) ask it once
 *  per calendar day an intraday chart spans, each a template string, a `Date.parse`, a `Date` and an ISO string: 3.1-4.7
 *  ms of one 23-28 ms task in the second after a two-chart switch. The day after a day never changes, so each is built
 *  once and kept (bounded: emptied, never trimmed, past `NEXT_DAY_CACHE_MAX` days). Same function, same answer; a string
 *  that is not a day throws as before (nothing is kept for it). */
const NEXT_DAY_CACHE_MAX = 40000
const _nextDayMemo = new Map()
const nextDayOf = (day) => {
  let next = _nextDayMemo.get(day)
  if (next === undefined) {
    next = new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)
    if (_nextDayMemo.size >= NEXT_DAY_CACHE_MAX) _nextDayMemo.clear()
    _nextDayMemo.set(day, next)
  }
  return next
}
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
 *  ⛔ A row whose `t` is not unix seconds is dropped, never guessed.
 *  ⭐⭐ e98 (Q-FRED-4H) — A 4H CHART (`CUSTOM_INTRADAY_STEP_MIN`): `bars` are the index's own 4h bars, built from its 60m
 *  rows on the 09:30-anchored session ([09:30, 13:30) and [13:30, 16:00), `secondaryBars.js`), and the grid is the
 *  chart's own 4h bars, anchored at the session open the same way (01:30, 05:30, 09:30, 13:30, 17:30 ET slots: a slot
 *  opening before 04:00 holds the 04:00-05:29 rows). The same three reads by the slot's OPEN. And an index bar that
 *  HOLDS the session's close carries the day's official close once it is held (TradingView's SP:SPX 4h bar is closed
 *  by the official print: on every half-day of the capture, 6 of 6 on three symbols, the 12:00 bar read the official
 *  close, not the 12:30 hourly row's last print); while the day's row is not held, its own last print.
 *  ⭐⭐ e98 (2026-11-26) THE SLOTS FOLLOW THE CHART'S SPEC: a custom timeframe's slots start where the chart's own resample
 *  starts its bars (`resampleSpec(tf, { extended }).anchorMin`, the authority the chart's bars are built by), stepped
 *  back by whole steps to the slot that holds 04:00: a REGULAR chart 01:30, 05:30, 09:30, 13:30, 17:30 (its bars 09:30
 *  and 13:30), an EXTENDED chart 04:00, 08:00, 12:00, 16:00 (TradingView's extended-hours 4h chart, Q-FRED-4H). The
 *  reads are unchanged: the index's own bars, by the slot's OPEN. `extended`: the CHART's session (`CHART_SESSION_KEY`);
 *  absent, `resampleSpec`'s own default (regular). */
export function atOrBeforeGridOf(bars, daily, tf, { dailyForming = false, extended = false } = {}) {
  const out = []
  Object.defineProperty(out, SERIES_UNKNOWN_BEFORE_FIRST, { value: true, enumerable: false })
  const step = GRID_STEP_MIN[String(tf)]
  // ⭐ e98 — a custom timeframe's slots start where the CHART's spec starts its bars (09:30 regular, 04:00 extended)
  const anchored = Object.prototype.hasOwnProperty.call(CUSTOM_INTRADAY_STEP_MIN, String(tf))
  const spec = anchored ? resampleSpec(String(tf), { extended: extended === true }) : null
  const anchorMin = spec && Number.isFinite(spec.anchorMin) ? spec.anchorMin : null
  if (anchored && anchorMin === null) return out
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
    const firstSlot = anchored ? mid + (anchorMin - Math.ceil((anchorMin - EXT_OPEN_MIN) / step) * step) * 60
      : mid + EXT_OPEN_MIN * 60
    for (let g = firstSlot; g < mid + EXT_END_MIN * 60; g += step * 60) {
      let row = null
      if (g < open) {
        if (prevClose !== null) row = { t: g, o: prevClose, h: prevClose, l: prevClose, c: prevClose, v: 0 }
      } else if (g >= close) {
        if (own !== null) row = { t: g, o: own, h: own, l: own, c: own, v: 0 }
      } else {
        while (j + 1 < intr.length && intr[j + 1].t <= g && intr[j + 1].t < close) j += 1
        const r = intr[j]
        if (r && r.t >= open && r.t <= g && r.t < close && (r !== newest || g < newestEnd)) {
          // ⭐ e98 — a 4h index bar holding the session's close is closed by the official print, once it is held
          const c = anchored && own !== null && r.t + step * 60 >= close ? own : r.c
          row = c === r.c ? { t: g, o: r.o, h: r.h, l: r.l, c, v: r.v }
            : { t: g, o: r.o, h: Math.max(r.h, c), l: Math.min(r.l, c), c, v: r.v }
        }
      }
      if (row) out.push(row)
    }
    if (own !== null) prevClose = own
    if (d > lastHeld) break
  }
  return out
}

/** ⭐⭐ RS RATING L12 PR 2 (Q-L12-2 / Q-L12-3, `l12-now-2026-11-18`, `l12-seed3-now-2026-11-18`) — a Pine SEED on an
 *  INTRADAY chart (`WITNESS_PERIOD_READS.UTC_MIDNIGHT_AT_OR_AFTER`): each held row, dated D, stamped D 00:00 UTC and
 *  read on the FIRST chart bar opening at or after that instant; several rows on one bar (a weekend's), the newest;
 *  every other bar `na` (`SERIES_GAPS_READ_NA`: known, never withheld). Keyed by that chart bar's own `t`, so the
 *  exact-time alignment places it (`interpret.js::requestAlignment`, the host's `sym`). Witnessed on NYSE:RDDT 1 / 5
 *  / 15 / 30 / 60m: 22,216 / 20,681 / 21,018 / 19,830 / 10,353 bars, values and na, three fields.
 *  ⭐ THE CHART'S FIRST BAR (inferred, not captured: every capture's history began before the seed's): TradingView
 *  lands a row there only if its instant falls after the bar BEFORE it, which this chart does not hold. Read as
 *  the extended-hours grid slot before it (`gridSlotBefore`): exact on a chart that trades in every slot; a row
 *  at or before that slot landed on an earlier bar and is not placed.
 *  ⛔ `chart.bars` not in hand, or not strictly increasing unix seconds: null (the bind refuses by name).
 *  ⛔ A row whose day cannot be read is dropped, never guessed. */
export function utcMidnightAtOrAfterOf(held, chart) {
  const bars = chart && Array.isArray(chart.bars) ? chart.bars : null
  const step = chart ? INTRADAY_STEP_MIN[String(chart.tf)] : undefined
  if (!bars || !step) return null
  const times = new Array(bars.length)
  for (let i = 0; i < bars.length; i += 1) {
    const t = bars[i] && bars[i].t
    if (typeof t !== 'number' || !Number.isFinite(t) || (i && t <= times[i - 1])) return null
    times[i] = t
  }
  const out = []
  Object.defineProperty(out, SERIES_GAPS_READ_NA, { value: true, enumerable: false })
  if (!times.length) return out
  const from = gridSlotBefore(times[0], step)
  const landed = new Map()
  let lastDay = ''
  for (const r of held || []) {
    const day = r && isoDay(r.t)
    if (!day || day <= lastDay) continue
    lastDay = day
    const inst = Date.parse(`${day}T00:00:00Z`) / 1000
    if (!(inst > from)) continue
    let lo = 0
    let hi = times.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (times[mid] < inst) lo = mid + 1
      else hi = mid
    }
    if (lo < times.length) landed.set(lo, r)               // rows arrive oldest first: the newest wins
  }
  for (const i of [...landed.keys()].sort((a, b) => a - b)) out.push({ ...landed.get(i), t: times[i] })
  return out
}

/** The extended-hours grid slot before the bar opening at `t` (unix seconds) on a `step`-minute chart: the slot
 *  `step` minutes earlier, or, for a session's first slot (04:00 ET), the previous session's last one. */
function gridSlotBefore(t, step) {
  const day = etDayOf(t)
  const mid = etMidnightOf(day)
  if (mid !== null && t - mid <= EXT_OPEN_MIN * 60) {
    let d = day
    for (let k = 0; k < 10; k += 1) {
      d = isoDayPlus(d, -1)
      if (d && isTradingDay(d)) {
        const pm = etMidnightOf(d)
        if (pm !== null) return pm + (EXT_END_MIN - step) * 60
        break
      }
    }
  }
  return t - step * 60
}

/** ⭐ RS RATING L12 PR 2 — daily rows keyed by their SESSION DATE (`isoDay`), in order, unplaced. */
export function sessionKeyedRowsOf(bars) {
  const out = []
  let last = ''
  for (const b of bars || []) {
    const day = b && isoDay(b.t)
    if (!day || day <= last) continue
    last = day
    out.push(b.t === day ? b : { ...b, t: day })
  }
  return out
}
/** ⭐ RS RATING L12 PR 2 — on a series of daily rows: whether its newest row is a session still in progress. */
export const SERIES_NEWEST_FORMING = Symbol('rs:newest-forming')
/** ⭐⭐ (e90, the e88 live capture) — on an intraday grid (`atOrBeforeGridOf`) whose held page FILLED its ask (as many
 *  rows as the fetch asked for, `secondaryBars.js::askedBars`, so the store may hold older ones): `{from, asked}`, the
 *  page's first row and that ask. Absent when the page holds fewer rows than it asked (the store's whole depth) or
 *  names no ask. The run decides from it, with the chart's own row count, whether a deeper page is coming
 *  (`runtime/requestSupply.js`); this fact alone never says so. */
export const SERIES_PAGE_FILLED = Symbol('rs:page-filled')
/** ⛔ The deepest window `/api/bars` answers (`bars: Query(le=60000)`, `api/routers/bars.py`): a deeper ask is a 422,
 *  never a deeper answer. The held-span ladder's top rung (`useSecondarySources.js::HELD_SPAN_MAX`) and the run's
 *  "a deeper page is coming" test (`runtime/requestSupply.js::pageEdgeOf`) both read it from here. ⛔ Here and not in
 *  the bars client (`secondaryBars.js`): the run's compute closure is host-neutral (`tools/pine_runtime_closure.mjs`),
 *  and the client's fetch, timers and wall clock may not enter it. */
export const BARS_ASK_MAX = 60000
/** The `{from, asked}` of a held intraday page that filled its ask, or null (`SERIES_PAGE_FILLED`). */
function filledPageOf(entry, held) {
  const asked = entry ? entry.askedBars : undefined
  if (!Number.isInteger(asked) || asked < 1 || !Array.isArray(held) || held.length < asked) return null
  const first = held.find((b) => b && typeof b.t === 'number' && Number.isFinite(b.t))
  return first ? Object.freeze({ from: first.t, asked }) : null
}
/** ⭐⭐ RS RATING L12 PR 2 (U-DAILY) — the chart's secondary key for THIS chart symbol's own daily rows, fetched
 *  when a run reads its own symbol at "D" above an intraday chart (`useSecondarySources`). ⛔ Not a held key's
 *  shape (`heldKeyParts` reads `<TICKER>@D`, and `SELF` is a listing): it can never be mistaken for a ticker. */
export const OWN_DAILY_KEY = 'OWN~D'
/** ⭐⭐ e98 (the 4h grid follows the chart's spec) — the chart's own SESSION, carried in its secondary map beside the
 *  entries (a custom intraday chart's map, `useSecondarySources.js::ensureChartSources`), so every lane that reads the
 *  map (the bind, the host worker, the run's supply and its worker) lays a custom timeframe's grid where the CHART's
 *  spec starts its bars (`atOrBeforeGridOf`). ⛔ Not a held key's shape and not a ticker. One of two frozen entries
 *  (`chartSessionEntryOf`), so a map that did not change keeps its identity. */
export const CHART_SESSION_KEY = 'CHART~SESSION'
const CHART_SESSION_RTH = Object.freeze({ status: 'available', extended: false })
const CHART_SESSION_ETH = Object.freeze({ status: 'available', extended: true })
export const chartSessionEntryOf = (extended) => (extended === true ? CHART_SESSION_ETH : CHART_SESSION_RTH)
/** Is the chart whose map this is drawn on its EXTENDED-hours session? (absent: no, `resampleSpec`'s default) */
function chartExtendedOf(secondary) {
  const e = secondary && typeof secondary.get === 'function' ? secondary.get(CHART_SESSION_KEY) : null
  return !!(e && e.extended === true)
}
/** ⭐ RS RATING L12 PR 2 — the ET session date of unix seconds (exported for the supply's per-bar placement). */
export const etSessionDayOf = (t) => etDayOf(t)
/** ⭐ RS RATING L12 PR 2 — unix seconds of `day`'s regular-session close (13:00 on a half-day), or null.
 *  ⭐ PERF (Fred RS 5m profile, 2026-11-19): a pure function of the ISO day (the exchange calendar is static data), and
 *  the supply asked it once PER CHART BAR — each a `Intl.DateTimeFormat` call (`sessionCalendar.js::_etParts`): 62 ms
 *  of the run half at 2,000 bars. Answered once per day from here on. Bounded: a run reads one entry per session it
 *  spans, and the memo is dropped whole past `SESSION_CLOSE_MEMO_CAP` days. */
const SESSION_CLOSE_MEMO_CAP = 20000
const _sessionCloseMemo = new Map()
export function sessionCloseOf(day) {
  const key = typeof day === 'string' ? day : null
  if (key !== null && _sessionCloseMemo.has(key)) return _sessionCloseMemo.get(key)
  const c = closeTime(day)
  const out = c ? c.getTime() / 1000 : null
  if (key !== null) {
    if (_sessionCloseMemo.size >= SESSION_CLOSE_MEMO_CAP) _sessionCloseMemo.clear()
    _sessionCloseMemo.set(key, out)
  }
  return out
}
/** Tests: how many days the session-close memo holds (and a way to drop it). */
export function __sessionCloseMemoSizeForTests(reset = false) {
  if (reset) _sessionCloseMemo.clear()
  return _sessionCloseMemo.size
}

/** The fold a `period` read names (`previous-week` / `previous-month` / `latest-at-or-before`) over the held
 *  rows, or null. `also` (L12): the second held series and the chart timeframe, for an intraday chart. */
export function periodFoldOf(fold, held, own = null, also = null) {
  if (fold === WITNESS_PERIOD_READS.PREVIOUS_WEEK) return previousWeekBarsOf(held, own)
  if (fold === WITNESS_PERIOD_READS.PREVIOUS_MONTH) return previousMonthBarsOf(held, own)
  // ⭐⭐ T4 B2 — the same folds, each period read on its OWN chart bar
  if (fold === WITNESS_PERIOD_READS.SAME_WEEK) return previousWeekBarsOf(held).map((w) => ({ ...w, t: isoDayPlus(w.t, -7) }))
  if (fold === WITNESS_PERIOD_READS.SAME_MONTH) return previousMonthBarsOf(held).map((m) => ({ ...m, t: previousMonthFirst(m.t) }))
  if (fold === WITNESS_PERIOD_READS.AT_OR_BEFORE) {
    return atOrBeforeGridOf(held, also && also.daily, also && also.tf, { dailyForming: !!(also && also.dailyForming),
      extended: !!(also && also.extended) })
  }
  return null
}

/** ⭐ T4 B2 — the 1st of the month before the month whose 1st is `first` (`YYYY-MM-01`). */
function previousMonthFirst(first) {
  const y = Number(first.slice(0, 4))
  const m = Number(first.slice(5, 7))
  return m === 1 ? `${String(y - 1).padStart(4, '0')}-12-01` : `${first.slice(0, 5)}${String(m - 1).padStart(2, '0')}-01`
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
  // ⭐⭐ T4 E2 — A CORPORATE-EVENTS READ: decided by its own ticker (the parse rewrite's `EVENT_VENUE` only). ⛔ The
  // engine's internal event name spelled by a SCRIPT (any other venue) is refused by name, before any fetch.
  if (venue === EVENT_VENUE) return eventStaticRefusal(t, OTHER_SYMBOL_REFUSAL)
  if (EVENT_TICKER.test(t)) return { code: OTHER_SYMBOL_REFUSAL.EVENT_SPELLING, reason: eventSpellingReason(t) }
  // ⭐ RS RATING L1b — a spelling with a witness row is decided by its row alone
  const row = witnessRowOf(venue, t)
  if (row) return witnessRowServes(row) ? null : witnessPendingWhy(row)
  // ⭐⭐ T4 B2 — any other `USI:` spelling: refused by its own name (`pineBreadth.js::breadthStaticRefusal`)
  const usi = String(venue || '').trim().toUpperCase() === BREADTH_VENUE ? breadthStaticRefusal(t, OTHER_SYMBOL_REFUSAL) : null
  if (usi) return usi
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
  // ⭐⭐ T4 E2 — the engine's internal event name, written by a script as a symbol (with or without a venue)
  const tail = s.slice(s.lastIndexOf(':') + 1).trim()
  if (EVENT_TICKER.test(tail)) return { ticker: tail, code: OTHER_SYMBOL_REFUSAL.EVENT_SPELLING, reason: eventSpellingReason(tail) }
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
  // ⭐⭐ T4 B2 — several breadth spellings combined in one string (TradingView's built-in Advance Decline Line):
  // refused by name (`pineBreadth.js::breadthSpreadRefusal`)
  if (isBreadthSpread(s)) return { ticker: s, ...breadthSpreadRefusal(raw, OTHER_SYMBOL_REFUSAL) }
  const m = /^([A-Z][A-Z0-9_.]{0,15}):(.*)$/.exec(s)
  const venue = m ? m[1] : ''
  const ticker = m ? m[2].trim() : s
  // ⭐ RS RATING L1b — a witness row's spelling (`SP:SPX`) is the row's to decide
  if (m && witnessRowOf(venue, ticker)) {
    const why = staticallyUnservable(ticker, venue)
    return why ? { ticker, ...why } : null
  }
  // ⭐⭐ T4 B2 — a `USI:` spelling with no row: refused by its own name, never as a foreign exchange
  const usi = m && venue === BREADTH_VENUE ? breadthStaticRefusal(ticker, OTHER_SYMBOL_REFUSAL) : null
  if (usi) return { ticker: s, ...usi }
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
  return `This indicator reads ${otherSymbolLabel(ticker)}: ${why.code} — ${why.reason}`
}

/** ⭐ T4 E2 — how a sentence names what a read reads: `\`TICKER\``, or an event read in the member's own words
 *  (`request.earnings` and its field), never the engine's internal event name. */
export function otherSymbolLabel(ticker) {
  const t = String(ticker).trim().toUpperCase()
  return eventReadOf(t) ? eventLabel(t) : `\`${t}\``
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
  // ⛔ T4 E2 — the engine's internal event name is never a ticker to fetch (`resolveFormulaSymbols` refuses it)
  return [...new Set(symTickersOf(def).filter((t) => !BARE_AMBIGUOUS.has(t) && !EVENT_TICKER.test(t)).map(storeTickerOf))].sort()
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
    if (EVENT_TICKER.test(ticker)) {
      refused.push({ ticker, code: OTHER_SYMBOL_REFUSAL.EVENT_SPELLING, reason: `This indicator reads \`${ticker}\`: `
        + eventSpellingReason(ticker) })
      continue
    }
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
    // ⛔⛔ T4 E2 (coordinator ruling 2026-11-22 (2)) — AN EVENT READ IS NEVER A BARS FETCH, nor an exchange lookup
    // (`useOtherSymbolExchanges` asks this list): the rewrite's reads come from `/api/pine/events/<chart symbol>`
    // (`eventsNeeded`, `eventSupply.js`), and the internal name written by a script is refused by name
    if (isEventRequest(ticker, spellings)) continue
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

/** ⭐⭐ T4 B2 — the `USI:` breadth spellings a Pine document reads (`{spellings: ['USI:ADVN.NY', ...], words}`), or null:
 *  what the grade tags a run with (a run that reads UCT breadth never grades MATCH, `compare.mjs`). Pending or served:
 *  either way what it draws is UCT's count, never TradingView's. */
export function breadthReadsOf(def) {
  if (!def || !isPineOriginDoc(def)) return null
  const spellings = otherSymbolRequestsOf(def)
    .filter(({ ticker, spellings }) => spellings.includes(BREADTH_VENUE) && breadthBaseOf(ticker))
    .map(({ ticker }) => `${BREADTH_VENUE}:${ticker}`)
  return spellings.length ? { spellings: [...new Set(spellings)].sort(), words: BREADTH_DATA_WORDS } : null
}

/** ⭐⭐ T4 E2 — is this request an event read (the rewrite's, or the internal name a script spelled)? */
export function isEventRequest(ticker, spellings) {
  return EVENT_TICKER.test(String(ticker || '').trim().toUpperCase())
    || (Array.isArray(spellings) && spellings.includes(EVENT_VENUE))
}

/** ⭐⭐ T4 E2 — does this document read the chart's own events (a rewrite's read the static gate does not refuse)? The
 *  chart then asks `/api/pine/events/<its symbol>` once (`useSecondarySources` → `eventSupply.js`), and nothing else. */
export function eventsNeeded(def) {
  return dataReadsNeeded(def, false)
}

/** ⭐⭐ T4 F1b — does this document read the chart's own financial figures (a rewrite's `request.financial` the static
 *  gate does not refuse)? The chart then asks `/api/pine/financial/<its symbol>` once (`financialSupply.js`), and nothing else. */
export function financialNeeded(def) {
  return dataReadsNeeded(def, true)
}

function dataReadsNeeded(def, financial) {
  if (!def || !isPineOriginDoc(def) || !def.meta || !Array.isArray(def.meta.otherSymbols)) return false
  return otherSymbolRequestsOf(def).some(({ ticker, spellings }) => spellings.length > 0
    && spellings.every((v) => v === EVENT_VENUE) && !!financialReadOf(ticker) === financial
    && !staticallyUnservable(ticker, EVENT_VENUE))
}

/** ⭐⭐ T4 B2 — mark a served breadth series with its record (`SERIES_EVENT_RECORD`, code `BREADTH_BEFORE_RECORD_CODE`): the
 *  chart bars before its first row are withheld (`SERIES_UNKNOWN_BEFORE_FIRST`) and NAMED per bar (`interpret.js::
 *  recordBeforeMask`), in the words `pineBreadth.js::breadthBeforeRecordSentence` says. `knownFrom` is the door's own
 *  (B1: the first session UCT counts), else the exchange's coverage start. */
export function markBreadthSeries(series, ticker, entry) {
  if (!Array.isArray(series)) return series
  const base = breadthBaseOf(ticker) || String(ticker).trim().toUpperCase()
  const spec = BREADTH_SPELLINGS[base] || null
  const exchange = spec ? spec.exchange : null
  const knownFrom = (entry && typeof entry.knownFrom === 'string' && entry.knownFrom)
    || (exchange ? BREADTH_COVERAGE_FROM[exchange] : null)
  const first = series.length ? isoDay(series[0].t) : null
  if (!series[SERIES_UNKNOWN_BEFORE_FIRST]) Object.defineProperty(series, SERIES_UNKNOWN_BEFORE_FIRST, { value: true, enumerable: false })
  Object.defineProperty(series, SERIES_EVENT_RECORD, { value: Object.freeze({ code: BREADTH_BEFORE_RECORD_CODE,
    family: 'breadth', ticker: String(ticker).trim().toUpperCase(), spelling: base, exchange, knownFrom, from: first }),
  enumerable: false, configurable: true })
  return series
}

/** The sentences the bind says for an event read on a chart timeframe its placement is not witnessed on. */
function eventTimeframeWhy(family, tf) {
  const s = String(tf == null ? '' : tf).trim().toUpperCase()
  // (a monthly chart is served since W-E2: `pineEvents.js::eventTimeframeCode`; the witness row gates it)
  return `\`request.${family}\` on a \`${s || '?'}\` chart: UCT holds the date of each ${family === 'earnings' ? 'report' : 'event'}, not `
    + 'its time of day, so the intraday bar it lands on is not known; it is served on daily and weekly charts'
}

/**
 * ⭐⭐ T4 E2 — THE BIND'S DECISION FOR ONE EVENT READ (the rewrite's, its static refusals already asked):
 * `{series}` (placed on the chart's bars, `pineEvents.js::placeEvents`) or `{code, reason, pending?}`. ONE function for
 * both lanes: the host bind (`resolveOtherSymbols`) and the run's supply (`requestSupply.js::decideOther`) ask it.
 * `ctx.secondary.get(EVENTS_KEY)` is the chart's events entry (`eventSupply.js`): `{status, events, symbol}`.
 */
export function eventDecision(ticker, ctx = {}) {
  // ⭐⭐ T4 F1b — a financial read is decided by its own supply and placement (`financialDecision`)
  if (financialReadOf(ticker)) return financialDecision(ticker, ctx)
  const read = eventReadOf(ticker)
  const R = OTHER_SYMBOL_REFUSAL
  if (!read || read.gaps === null) return { code: R.EVENT_ARGUMENT, reason: `${eventLabel(ticker)} is not a read UCT serves` }
  const family = read.family
  const tfCode = eventTimeframeCode(ctx.tf)
  if (!tfCode) return { code: R.EVENT_TIMEFRAME, reason: eventTimeframeWhy(family, ctx.tf) }
  const row = eventRowOf(family)
  if (!eventRowServes(row, tfCode)) {
    return { code: R.EVENT_TIMEFRAME, reason: `\`request.${family}\` on a \`${tfCode}\` chart is served only once a TradingView `
      + `capture witnesses where it places each event there${row && row.queue_row ? ` (capture-queue row ${row.queue_row})` : ''}, `
      + 'so what this indicator draws from it is not computed' }
  }
  const secondary = ctx.secondary && typeof ctx.secondary.get === 'function' ? ctx.secondary : null
  const entry = secondary ? secondary.get(EVENTS_KEY) : null
  const chart = ctx.symbol && typeof ctx.symbol.ticker === 'string' && ctx.symbol.ticker.trim() ? storeTickerOf(ctx.symbol.ticker) : null
  const loading = { code: R.EVENT_UNAVAILABLE, pending: true,
    reason: `UCT is gathering ${chart ? `${chart}'s ` : 'this symbol\'s '}${family}; it is drawn when it lands` }
  if (!entry || entry.status === 'loading' || entry.status === 'pending') return loading
  if (entry.status === 'dark') {
    return { code: R.EVENT_NOT_AVAILABLE, reason: `${family} data is not available on this chart yet, so what this indicator `
      + `draws from \`request.${family}\` is not computed` }
  }
  const doc = entry.status === 'available' && entry.events && typeof entry.events === 'object' ? entry.events : null
  if (!doc) {
    return { code: R.EVENT_UNAVAILABLE, reason: `UCT could not read ${chart ? `${chart}'s ` : 'this symbol\'s '}${family} just now `
      + `(${entry.status || 'no answer'}), so what this indicator draws from \`request.${family}\` is not computed` }
  }
  // ⛔ an answer for another symbol (a chart that switched while it was in flight) is no answer for this one
  if (chart && typeof doc.symbol === 'string' && storeTickerOf(doc.symbol) !== chart) return loading
  const who = chart || (typeof doc.symbol === 'string' ? doc.symbol : 'this symbol')
  const fam = doc.families && typeof doc.families === 'object' ? doc.families[family] : null
  const state = fam && typeof fam.state === 'string' ? fam.state : 'missing'
  if (state === 'refused') {
    const said = fam.refusal && typeof fam.refusal.sentence === 'string' ? ` (${fam.refusal.sentence})` : ''
    return { code: R.EVENT_NOT_AVAILABLE, reason: `${family} data is not available on this chart${said}, so what this `
      + `indicator draws from \`request.${family}\` is not computed` }
  }
  // ⭐⭐ (coordinator ruling 2026-11-22, E2 ruling 3) A FUND REPORTS NO EARNINGS: on a chart whose store class is ETF
  // (the bind's `symbol.securityType`) an earnings read is `na` on every bar, as TradingView draws it (AMEX:SPY 1D, the E0
  // probe: `na` on all 8,000+ bars), and any row the vendor holds for the fund is ignored (SPY's one, 2005-02-15)
  if (family === 'earnings' && ctx.symbol && String(ctx.symbol.securityType || '').toUpperCase() === 'ETF'
      && Array.isArray(ctx.chartBars)) {
    const series = ctx.chartBars.map((b) => ({ t: b.t, o: NaN, h: NaN, l: NaN, c: NaN, v: 0 }))
    return { series: markEventSeries(series, { ticker, family, symbol: who, knownFrom: null, fund: true }) }
  }
  if (state === 'empty' || state === 'missing') {
    const one = family === 'earnings' ? 'earnings report' : family === 'dividends' ? 'dividend' : 'split'
    return { code: R.EVENT_NONE, reason: `UCT holds no ${one} for ${who}, and whether that means it has none (TradingView then `
      + `draws \`na\`) is not settled here, so what this indicator draws from \`request.${family}\` is not computed` }
  }
  if (state !== 'ok' || !Array.isArray(fam.rows) || typeof fam.knownFrom !== 'string') {
    return { code: R.EVENT_UNAVAILABLE, reason: `UCT could not refresh ${who}'s ${family} just now, so what this indicator `
      + `draws from \`request.${family}\` is not computed` }
  }
  if (family === 'dividends') {
    const foreign = fam.rows.find((r) => r && typeof r.currency === 'string' && r.currency.trim()
      && r.currency.trim().toUpperCase() !== 'USD')
    if (foreign) {
      return { code: R.EVENT_CURRENCY, reason: `${who} declares dividends in ${foreign.currency.trim().toUpperCase()}, and UCT `
        + 'serves `request.dividends` in US dollars only, so what this indicator draws from it is not computed' }
    }
  }
  const bars = Array.isArray(ctx.chartBars) ? ctx.chartBars : null
  if (!bars) {
    return { code: R.EVENT_ARGUMENT, reason: `${eventLabel(ticker)} lands each event on one of the chart's own bars, and this `
      + 'read is not handed them, so what it reads is not computed' }
  }
  // ⭐⭐ (coordinator ruling 2026-11-22, E2 ruling 1) EARNINGS ARE DRAWN FROM TRADINGVIEW'S WINDOW ON
  // (`pineEvents.js::EARNINGS_WINDOW_FROM`): knownFrom = max(our first held report, the cut), and under `gaps_off` the
  // bars from the cut to the first report after it are withheld too (a cut is not a coverage start)
  const cut = family === 'earnings' && fam.knownFrom < EARNINGS_WINDOW_FROM ? EARNINGS_WINDOW_FROM : null
  const knownFrom = cut || fam.knownFrom
  // ⭐ ruling (1): a `knownFrom` BEFORE our first held event is a coverage start (nothing before it); E1's own `knownFrom`
  // is its first held event, which is not (an older event may exist), and neither is the window's cut
  const firstHeld = fam.rows.map((r) => r && r[EVENT_DATE_KEY[family]]).filter((d) => typeof d === 'string').sort()[0] || null
  const coverageStart = !cut && firstHeld !== null && fam.knownFrom < firstHeld.slice(0, 10)
  const placed = placeEvents(read, read.gaps, read.lookahead, fam.rows, knownFrom, bars, tfCode, { coverageStart })
  if (placed.why) return { code: R.EVENT_ARGUMENT, reason: `${eventLabel(ticker)} cannot be placed: ${placed.why}` }
  const first = placed.series.length ? isoDay(placed.series[0].t) : null
  return { series: markEventSeries(placed.series, { ticker, family, symbol: who, knownFrom, from: first,
    ...(cut ? { window: cut } : {}) }) }
}

/**
 * ⭐⭐ T4 F1b — THE BIND'S DECISION FOR ONE FINANCIAL READ (the rewrite's `request.financial`, its static refusals
 * already asked): `{series}` (placed on the chart's bars, `pineFinancial.js::placeFinancial`) or `{code, reason, pending?}`.
 * ONE function for both lanes (`eventDecision` hands it every financial read). `ctx.secondary.get(FINANCIAL_KEY)` is the
 * chart's financial entry (`financialSupply.js`): `{status, financial, symbol}`, F1a's answer under `financial`.
 * ⛔ The values are UCT data (company filings), never TradingView's figures: the plot's note says so, and no grade of it
 * counts MATCH.
 */
export function financialDecision(ticker, ctx = {}) {
  const read = financialReadOf(ticker)
  const R = OTHER_SYMBOL_REFUSAL
  const label = financialLabel(ticker)
  if (!read || read.gaps === null || !read.series) return { code: R.FINANCIAL_ARGUMENT, reason: `${label} is not a read UCT serves` }
  const tfCode = financialTimeframeCode(ctx.tf)
  const notComputed = `so what this indicator draws from ${label} is not computed`
  if (!tfCode) {
    return { code: R.FINANCIAL_TIMEFRAME, reason: `${label} on a \`${String(ctx.tf == null ? '?' : ctx.tf).trim().toUpperCase() || '?'}\` `
      + 'chart: UCT dates each figure by the session its company filing became public in, so it is served on daily, weekly '
      + `and monthly charts; ${notComputed}` }
  }
  const secondary = ctx.secondary && typeof ctx.secondary.get === 'function' ? ctx.secondary : null
  const entry = secondary ? secondary.get(FINANCIAL_KEY) : null
  const chart = ctx.symbol && typeof ctx.symbol.ticker === 'string' && ctx.symbol.ticker.trim() ? storeTickerOf(ctx.symbol.ticker) : null
  const loading = { code: R.FINANCIAL_UNAVAILABLE, pending: true,
    reason: `UCT is gathering ${chart ? `${chart}'s ` : 'this symbol\'s '}figures from company filings; they are drawn when they land` }
  if (!entry || entry.status === 'loading' || entry.status === 'pending') return loading
  if (entry.status === 'dark') {
    return { code: R.FINANCIAL_NOT_AVAILABLE, reason: `financial figures are not available on this chart yet, ${notComputed}` }
  }
  const doc = entry.status === 'available' && entry.financial && typeof entry.financial === 'object' ? entry.financial : null
  if (!doc) {
    return { code: R.FINANCIAL_UNAVAILABLE, reason: `UCT could not read ${chart ? `${chart}'s ` : 'this symbol\'s '}figures just now `
      + `(${entry.status || 'no answer'}), ${notComputed}` }
  }
  // ⛔ an answer for another symbol (a chart that switched while it was in flight) is no answer for this one
  if (chart && typeof doc.symbol === 'string' && storeTickerOf(doc.symbol) !== chart) return loading
  const who = chart || (typeof doc.symbol === 'string' ? doc.symbol : 'this symbol')
  const state = typeof doc.familyState === 'string' ? doc.familyState : 'missing'
  if (state === 'refused') {
    const said = doc.refusal && typeof doc.refusal.sentence === 'string' ? ` (${doc.refusal.sentence})` : ''
    return { code: R.FINANCIAL_NOT_AVAILABLE, reason: `financial figures are not available on this chart${said}, ${notComputed}` }
  }
  if (state === 'none') {
    return { code: R.FINANCIAL_NONE, reason: `UCT holds no figures from company filings for ${who} (it reads US company filings; `
      + `a fund or a company filing in another format has none there), ${notComputed}` }
  }
  const field = doc.fields && typeof doc.fields === 'object' ? doc.fields[`${read.field}:${read.period}`] : null
  if (!field || typeof field !== 'object') {
    return { code: R.FINANCIAL_UNAVAILABLE, reason: `UCT could not read ${who}'s \`${read.field}\` (\`${read.period}\`) just now, ${notComputed}` }
  }
  if (field.state === 'withheld') {
    return { code: R.FINANCIAL_WITHHELD, reason: `${who}'s split history could not be verified, so UCT withholds its per-share `
      + `figures and share counts, ${notComputed}` }
  }
  if (field.state === 'missing' || field.state === 'none') {
    return { code: R.FINANCIAL_NONE, reason: `${who}'s company filings do not yield \`${read.field}\` (\`${read.period}\`) in UCT's `
      + `store, ${notComputed}` }
  }
  if (field.state !== 'ok' || !Array.isArray(field.points)) {
    return { code: R.FINANCIAL_UNAVAILABLE, reason: `UCT could not refresh ${who}'s figures just now, ${notComputed}` }
  }
  const bars = Array.isArray(ctx.chartBars) ? ctx.chartBars : null
  if (!bars) {
    return { code: R.FINANCIAL_ARGUMENT, reason: `${label} lands each figure on one of the chart's own bars, and this read is `
      + 'not handed them, so what it reads is not computed' }
  }
  const placed = placeFinancial(read.gaps, field, bars, tfCode)
  if (placed.why) return { code: R.FINANCIAL_ARGUMENT, reason: `${label} cannot be placed: ${placed.why}` }
  const first = placed.series.length ? isoDay(placed.series[0].t) : null
  return { series: markFinancialSeries(placed.series, { ticker, symbol: who, field: read.field, period: read.period,
    knownFrom: typeof field.knownFrom === 'string' ? field.knownFrom : null, from: first, unknown: placed.unknown || null }) }
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
    // ⭐⭐ T4 E2 — A CORPORATE-EVENTS READ (the rewrite's): the chart's own events, placed on its bars
    // (`eventDecision`). Never a listing, never a witness row's bars.
    if (spellings.includes(EVENT_VENUE)) {
      const d = eventDecision(ticker, ctx)
      if (d.series) {
        symbols[ticker] = d.series
        served.push(ticker)
      } else {
        refused.push({ ticker, code: d.code, reason: d.reason, event: true, ...(d.pending ? { pending: true } : {}) })
      }
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
      // ⭐⭐ T4 B2 — a breadth spelling on an intraday chart: UCT holds one count per session, never intraday breadth
      if (row.kind === 'breadth' && /^\d+$/.test(tf)) {
        no(ticker, OTHER_SYMBOL_REFUSAL.BREADTH_INTRADAY, breadthIntradayReason(ticker, tf))
        continue
      }
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
      // ⭐⭐ T4 B2 — the breadth door dark for this member (B1's stage) or refusing it (the licence): named, never a wait
      if (row.kind === 'breadth' && entry && (entry.status === 'dark' || entry.status === 'refused')) {
        no(ticker, OTHER_SYMBOL_REFUSAL.BREADTH_NOT_AVAILABLE, breadthNotAvailableReason(ticker, entry.said || ''))
        continue
      }
      const held = entry && Array.isArray(entry.bars) ? entry.bars : null
      if (!held || !held.length) {
        no(ticker, OTHER_SYMBOL_REFUSAL.NO_BARS, `\`${row.spelling}\`'s bars for this timeframe are not in hand`
          + (entry && entry.status ? ` (${entry.status})` : ''))
        // ⭐ T4 B2 — and a breadth door still gathering (202 `pending`) is a wait, as a load is
        if (!entry || String(entry.status || '') === 'loading' || (row.kind === 'breadth' && entry.status === 'pending')) {
          refused[refused.length - 1].pending = true
        }
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
        also = { daily: rowsD, tf, dailyForming: second.newestBarIsForming === true,
          // ⭐⭐ e98 — a custom timeframe's grid is laid where the CHART's spec starts its bars (`CHART_SESSION_KEY`)
          ...(Object.prototype.hasOwnProperty.call(CUSTOM_INTRADAY_STEP_MIN, tf) ? { extended: chartExtendedOf(secondary) } : {}) }
      }
      const own = newestOwnPeriodOf(ctx, entry)
      // ⭐ RS RATING L12 PR 2 (Q-L12-2) — a seed on an intraday chart lands each row on one of the chart's own bars
      // (`utcMidnightAtOrAfterOf`): a read not handed them is refused by name, never placed on a guessed grid
      const landed = read.sample === WITNESS_PERIOD_READS.UTC_MIDNIGHT_AT_OR_AFTER
        ? utcMidnightAtOrAfterOf(held, { bars: ctx.chartBars, tf }) : null
      if (read.sample === WITNESS_PERIOD_READS.UTC_MIDNIGHT_AT_OR_AFTER && !landed) {
        no(ticker, OTHER_SYMBOL_REFUSAL.WITNESS_TIMEFRAME, `\`${row.spelling}\` on a \`${tf}\` chart lands each row on the `
          + 'first chart bar opening at or after its date\'s 00:00 UTC, and this read is not handed the chart\'s bars, so '
          + 'what it reads is not computed')
        continue
      }
      // ⭐ RS RATING L12 PR 2 — a daily read above an intraday chart is handed its daily rows as they are, keyed by
      // session date; the run places them per chart bar (`requestSupply.js::aboveChartRead`)
      symbols[ticker] = landed || (read.sample === WITNESS_PERIOD_READS.SESSION_COMPLETED ? sessionKeyedRowsOf(held)
        : read.fold ? periodFoldOf(read.fold, held, own, also) : witnessedBarsOf(row, held, own))
      if (read.sample === WITNESS_PERIOD_READS.SESSION_COMPLETED) {
        Object.defineProperty(symbols[ticker], SERIES_NEWEST_FORMING, { value: entry.newestBarIsForming === true, enumerable: false })
      }
      // ⭐⭐ (e90) an intraday grid whose page filled its ask carries that page (`SERIES_PAGE_FILLED`): the chart-timeframe
      // series, asked at the held span (`useSecondarySources.js::heldSpanFor`), never the daily rows beside it
      const page = !landed && read.fold === WITNESS_PERIOD_READS.AT_OR_BEFORE ? filledPageOf(entry, held) : null
      if (page) Object.defineProperty(symbols[ticker], SERIES_PAGE_FILLED, { value: page, enumerable: false })
      if (read.sample) samples[ticker] = read.sample
      // ⭐⭐ T4 B2 — a breadth series carries its record: the bars before UCT's counts begin are withheld BY NAME, per bar
      if (row.kind === 'breadth') markBreadthSeries(symbols[ticker], ticker, entry)
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
  return { guard: hit.code, message: `This indicator reads ${otherSymbolLabel(hit.ticker)}: ${hit.reason}` }
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
  // ⭐ RS RATING L12 PR 2 — this chart symbol's own daily rows (`OWN_DAILY_KEY`, a run's daily read above an
  // intraday chart) landing, moving or flipping its forming flag is a recompute too
  const ownE = secondary && typeof secondary.get === 'function' ? secondary.get(OWN_DAILY_KEY) : null
  const ownBars = ownE && Array.isArray(ownE.bars) ? ownE.bars : null
  const ownLast = ownBars && ownBars.length ? ownBars[ownBars.length - 1] : null
  const ownSig = ownE ? `|own:${ownE.status || ''}:${ownBars ? ownBars.length : 0}:${ownLast ? `${ownLast.t}/${ownLast.c}` : ''}`
    + `${ownE.newestBarIsForming === true ? ':forming' : ''}` : ''
  if (!requests.length) return ownSig
  // ⭐⭐ e98 — a custom intraday chart's session moves its grid (`atOrBeforeGridOf`): an EXT toggle is a recompute
  const sesSig = Object.prototype.hasOwnProperty.call(CUSTOM_INTRADAY_STEP_MIN, String(chartTf == null ? '' : chartTf))
    ? `|session:${chartExtendedOf(secondary) ? 'eth' : 'rth'}` : ''
  // ⭐⭐ T4 E2 — the chart's events entry landing, failing or refreshing is a recompute of every event read
  const evE = requests.some((r) => (r.spellings || []).includes(EVENT_VENUE)) && secondary && typeof secondary.get === 'function'
    ? secondary.get(EVENTS_KEY) : null
  const evSig = evE ? `|events:${evE.status || ''}:${evE.symbol || ''}:${evE.rev || ''}` : ''
  // ⭐⭐ T4 F1b — and the chart's financial entry, for a document that reads `request.financial`
  const finE = requests.some((r) => (r.spellings || []).includes(EVENT_VENUE) && financialReadOf(r.ticker)) && secondary
    && typeof secondary.get === 'function' ? secondary.get(FINANCIAL_KEY) : null
  const finSig = finE ? `|financial:${finE.status || ''}:${finE.symbol || ''}:${finE.rev || ''}` : ''
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
  }).join('+')).join(',') + ownSig + evSig + finSig + sesSig
}
