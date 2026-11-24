// app/src/components/chart/engine/pineBreadth.js
//
// ─── ⭐⭐ TRACK 4 B2 — TRADINGVIEW'S `USI:` BREADTH SPELLINGS, SERVED FROM UCT'S OWN BREADTH ─────────────────────
//
// A member's Pine script reads NYSE and Nasdaq breadth as `request.security("USI:ADVN.NY", "D", close)` (27 scripts in
// the whole-population census read a `USI:` spelling). This module is the ONE vocabulary both lanes ask about them:
//
//   * WHICH SPELLINGS UCT SERVES (`BREADTH_SPELLINGS`): NYSE and Nasdaq advancing, declining and unchanged issues and
//     ADD (advancing less declining), the counts B1 holds (`api/services/pine_breadth.py::SPELLINGS`, the Exchange
//     Breadth V1 authority: NYSE from 2009-06-11, Nasdaq from 2008-01-02). Each is a witness row of kind `breadth` in
//     `requestWitnesses.json` (`breadthWitnessRow`, railed equal), so it is served ONLY once a TradingView capture
//     witnesses its alignment (Q-T4-B1), exactly as `SP:SPX` was (RS RATING L1b). Until then it is refused by name.
//   * WHAT IS REFUSED BY NAME, from the spelling alone (`breadthStaticRefusal`): up / down / total volume (UCT holds no
//     volume breadth: unit B3), another exchange's counts (AMEX, Arca, the US composite, the Dow), TICK / TRIN, any other
//     `USI:` series, and a spread of several spellings in one string (TradingView's built-in Advance Decline Line).
//   * WHERE THE ROWS COME FROM: ONE door, `GET /api/pine/breadth/<spelling>` (B1, `breadthSupply.js`), under the chart's
//     secondary key `USI~<SPELLING>` (`breadthKeyOf`). ⛔ Never `/api/bars`, never the exchange lookup, never the symbol
//     resolver: the key cannot name a listing (`~` is no ticker character), and the chart's fetch routes every key of this
//     shape to the breadth door (`useSecondarySources.js::ensureChartSources`).
//   * WHAT A MEMBER IS TOLD: every read is labelled UCT breadth data (`BREADTH_DATA_WORDS`), never TradingView's series.
//     The exchanges' official counts also hold preferreds, funds and other issues, so our counts differ from `USI:` by
//     construction, and a grade of a script that reads one is MATCH_SUBSTITUTED or a named divergence, NEVER MATCH
//     (coordinator ruling 2026-11-22; `tools/vendor_harness/compare.mjs`, `breadthRead`).
//
// ⛔ This module imports nothing from `otherSymbols.js` (which imports it): the codes it names are passed in.

import { BREADTH_BEFORE_RECORD_CODE, beforeRecordCodeOf } from './ast/interpret'
import { eventBeforeRecordSentence, eventLabel } from './pineEvents.js'

/** The venue every served spelling is written under. */
export const BREADTH_VENUE = 'USI'
/** The chart's secondary-map key prefix for a breadth spelling's rows (`USI~ADVN.NY`): `~` is never a ticker character
 *  (`parse.js::TICKER_SHAPE`), so the key can never be mistaken for a listing, nor typed in a formula. */
export const BREADTH_KEY_PREFIX = 'USI~'
/** The words every read carries (the member's note, the grade's tag). */
export const BREADTH_DATA_WORDS = "UCT breadth data (our own counts), not the exchange's official figures"

/** ⭐⭐ THE ALIGNMENT, A NAMED CONSTANT, WITNESSED (W-B1, Q-T4-B1, 2026-11-22).
 *  How a session's count lands on a chart's daily bars: `same-date` (on the bar of its own session) or
 *  `previous-session` (on the next one, as TradingView's `SP:SPX` reads on a stock's daily chart, Q-RS3). Both are
 *  placements `otherSymbols.js::witnessedBarsOf` already knows. W-B1 (`vw-data-usi` on AMEX:SPY and NYSE:RDDT 1D,
 *  against production's B1 counts, same-date vs previous-session): SAME-DATE on every witnessed spelling (median
 *  |difference| ADVN.NY 549 vs 599, DECL.NY 438 vs 577, ADVN.NQ 448 vs 545, DECL.NQ 402 vs 552, ADD 241 vs 927);
 *  U01 (`"D"`) and U02 (`timeframe.period`) agree on every bar, and the two charts read the same series. */
export const BREADTH_DAILY_ALIGNMENT = 'same-date'
/** ⭐⭐ THE DAILY WITNESS (W-B1): the capture that serves a spelling, and the spellings it witnessed. `USI:UNCH.NQ` and
 *  `USI:ADDQ` are not in the probe (still pending, Q-T4-B1). ⛔ The four short spellings are NOT witnessed as aliases:
 *  TradingView's `USI:ADV` / `DECL` / `ADVQ` / `DECLQ` equal its long spellings on 21 / 32 / 31 / 40 of ~8,000 sessions
 *  (they are other series: TradingView's `USI:ADD` is `ADV` - `DECL` on 6,555 of 8,321 sessions, never
 *  `ADVN.NY` - `DECL.NY`), so they stay refused by name until a unit serves what they are. */
export const BREADTH_DAILY_WITNESS = Object.freeze({
  witness: 'vw-data-usi-{spy,rddt}-1d-2026-11-22-preopen (t4-wb1-2026-11-22 batch, local; UCT probe)',
  captured: '2026-11-22',
  spellings: Object.freeze(['ADVN.NY', 'DECL.NY', 'UNCH.NY', 'ADVN.NQ', 'DECL.NQ', 'ADD']),
})
/** ⭐⭐ HOW FAR OUR COUNTS ARE FROM TRADINGVIEW'S, per witnessed spelling (W-B1, same-date, AMEX:SPY 1D, every session
 *  both hold; derived counts only, the capture stays local): the median |difference| in issues and as a share of
 *  TradingView's value, and the share of sessions ours is the lower. Our universe is operating equity (common stock and
 *  ADRs); the exchange's count also holds preferreds, funds and other issues. Said in the member's note. */
export const BREADTH_DIVERGENCE = Object.freeze({
  'ADVN.NY': Object.freeze({ sessions: 4389, from: '2009-06-11', medianIssues: 549, medianPct: 36, oursLowerShare: 0.998 }),
  'DECL.NY': Object.freeze({ sessions: 4389, from: '2009-06-11', medianIssues: 438, medianPct: 32, oursLowerShare: 0.997 }),
  'UNCH.NY': Object.freeze({ sessions: 4389, from: '2009-06-11', medianIssues: 49, medianPct: 55, oursLowerShare: 0.998 }),
  'ADVN.NQ': Object.freeze({ sessions: 4752, from: '2008-01-02', medianIssues: 448, medianPct: 31, oursLowerShare: 0.996 }),
  'DECL.NQ': Object.freeze({ sessions: 4752, from: '2008-01-02', medianIssues: 402, medianPct: 27, oursLowerShare: 0.997 }),
  ADD: Object.freeze({ sessions: 4389, from: '2009-06-11', medianIssues: 241, medianPct: 29, oursLowerShare: 0.61 }),
})
/** The weekly and monthly reads each daily alignment implies (`otherSymbols.js::WITNESS_PERIOD_READS`): the held daily
 *  rows folded by our resampler for a `timeframe.period` read, the period's last row for a `"D"` read. Pending their own
 *  capture (Q-T4-B2, the same probe on a weekly and a monthly chart). */
export const BREADTH_PERIOD_READS = Object.freeze({
  'same-date': Object.freeze({ W: Object.freeze({ period: 'same-week', D: 'week-last-row' }),
    M: Object.freeze({ period: 'same-month', D: 'month-last-row' }) }),
  'previous-session': Object.freeze({ W: Object.freeze({ period: 'previous-week', D: 'week-last-row' }),
    M: Object.freeze({ period: 'previous-month', D: 'month-last-row' }) }),
})
/** The capture rows each witness waits on (`docs/pine/capture-queue-2026-11-22-t4-breadth.md`). */
export const BREADTH_QUEUE = Object.freeze({ daily: 'Q-T4-B1', period: 'Q-T4-B2' })
export const BREADTH_PROBE = 'tools/visual_conformance/probes/vw-data-usi.pine'

/** Every served spelling (the ticker as `USI:<ticker>` names it) and what UCT counts for it. `close` is the only field
 *  ADD holds (advancing less declining at the close: a difference of two intraday ranges is not a range), so its open,
 *  high and low read `na`. ⛔ The same list B1 serves (`pine_breadth.py::SPELLINGS`, railed equal). */
export const BREADTH_SPELLINGS = Object.freeze({
  'ADVN.NY': Object.freeze({ exchange: 'NYSE', universe: 'nyse', metric: 'advancing', what: 'advancing issues' }),
  'DECL.NY': Object.freeze({ exchange: 'NYSE', universe: 'nyse', metric: 'declining', what: 'declining issues' }),
  'UNCH.NY': Object.freeze({ exchange: 'NYSE', universe: 'nyse', metric: 'unchanged', what: 'unchanged issues' }),
  'ADVN.NQ': Object.freeze({ exchange: 'Nasdaq', universe: 'nasdaq', metric: 'advancing', what: 'advancing issues' }),
  'DECL.NQ': Object.freeze({ exchange: 'Nasdaq', universe: 'nasdaq', metric: 'declining', what: 'declining issues' }),
  'UNCH.NQ': Object.freeze({ exchange: 'Nasdaq', universe: 'nasdaq', metric: 'unchanged', what: 'unchanged issues' }),
  ADD: Object.freeze({ exchange: 'NYSE', universe: 'nyse', metric: 'add', what: 'advancing less declining issues', closeOnly: true }),
  ADDQ: Object.freeze({ exchange: 'Nasdaq', universe: 'nasdaq', metric: 'add', what: 'advancing less declining issues', closeOnly: true }),
})
/** The short spellings TradingView may answer as a long one (U05/U06, U09/U10 of the probe): each its own witness row,
 *  reading its long spelling's rows (one fetch), served only once the capture shows TradingView answers them alike. */
export const BREADTH_ALIASES = Object.freeze({ ADV: 'ADVN.NY', DECL: 'DECL.NY', ADVQ: 'ADVN.NQ', DECLQ: 'DECL.NQ' })
/** UCT's first session per exchange (Exchange Breadth V1). A bar before it is withheld by name, per bar. */
export const BREADTH_COVERAGE_FROM = Object.freeze({ NYSE: '2009-06-11', Nasdaq: '2008-01-02' })

// ─── the refusals, from the spelling alone ───────────────────────────────────────────────────────────────────────

const VOLUME = /^(?:[UDT]VOL[A-Z]{0,2}|VOL[A-Z]{0,3})(?:\.[A-Z]{2})?$|^(?:[UDT]VOL|VOLD)/
const TICK_TRIN = /^(?:TICK|TRIN|TIKI|TICKQ|TRINQ)/
/** Another exchange's counts: a two-letter suffix other than `.NY` / `.NQ`, or the A-suffixed (AMEX) short forms. */
const OTHER_EXCHANGE = /^(?:ADVN|DECL|DECN|UNCH|ADV|DEC|ADD)(?:\.(?!NY$|NQ$)[A-Z]{2}|A)$/
/** `USI:` inside a string that is more than one `USI:<ticker>` spelling: a spread. */
const SPREAD = /USI:/i

/** The spelling (`ADVN.NY`) a ticker reads: its own when served, the long one for an alias, else null. */
export function breadthBaseOf(ticker) {
  const t = String(ticker == null ? '' : ticker).trim().toUpperCase()
  if (BREADTH_SPELLINGS[t]) return t
  return BREADTH_ALIASES[t] || null
}
/** Is this ticker one UCT may serve under `USI:` (a served spelling or an alias)? */
export const isBreadthTicker = (ticker) => breadthBaseOf(ticker) !== null

/** The chart's secondary key for a ticker's rows (`USI~ADVN.NY`; an alias reads its long spelling's), or null. */
export function breadthKeyOf(ticker) {
  const base = breadthBaseOf(ticker)
  return base ? `${BREADTH_KEY_PREFIX}${base}` : null
}
/** Is this a breadth key, held or not (`USI~ADVN.NY`, `USI~ADVN.NY@D`)? */
export function isBreadthKey(key) {
  return typeof key === 'string' && key.startsWith(BREADTH_KEY_PREFIX)
}
/** The spelling a breadth key names (`USI~ADVN.NY@D` -> `ADVN.NY`), or null. */
export function breadthSpellingOfKey(key) {
  if (!isBreadthKey(key)) return null
  const base = key.slice(BREADTH_KEY_PREFIX.length).replace(/@D$/, '')
  return BREADTH_SPELLINGS[base] ? base : null
}

/**
 * ⭐ THE STATIC REFUSAL of a `USI:` spelling UCT does not serve: `{code, reason}`, or null for a spelling UCT serves (its
 * witness row decides). `codes` is `otherSymbols.js::OTHER_SYMBOL_REFUSAL` (passed in: no import cycle).
 */
export function breadthStaticRefusal(ticker, codes) {
  const t = String(ticker == null ? '' : ticker).trim().toUpperCase()
  if (isBreadthTicker(t)) return null
  const s = `\`USI:${t}\``
  if (VOLUME.test(t)) {
    return { code: codes.BREADTH_NOT_HELD, reason: `${s} is an up, down or total VOLUME breadth series, and UCT holds no `
      + 'volume breadth yet (it holds advancing, declining and unchanged issue counts), so what this indicator draws from '
      + 'it is not computed.' }
  }
  if (TICK_TRIN.test(t)) {
    return { code: codes.BREADTH_NOT_HELD, reason: `${s} is a TICK or TRIN series, which UCT does not hold (it holds `
      + 'daily advancing, declining and unchanged issue counts), so what this indicator draws from it is not computed.' }
  }
  if (OTHER_EXCHANGE.test(t)) {
    return { code: codes.BREADTH_EXCHANGE, reason: `${s} counts another exchange's issues; UCT's breadth counts cover NYSE `
      + 'and Nasdaq listings only (`USI:ADVN.NY`, `USI:ADVN.NQ` and their declining and unchanged spellings), so what '
      + 'this indicator draws from it is not computed.' }
  }
  return { code: codes.BREADTH_UNKNOWN, reason: `${s} is not a breadth series UCT serves (UCT serves NYSE and Nasdaq `
    + 'advancing, declining and unchanged issues, `USI:ADD` and `USI:ADDQ`), so what this indicator draws from it is not '
    + 'computed.' }
}

/** Is this raw symbol string a SPREAD of breadth spellings (`"(USI:ADVN.NY - USI:DECL.NY) / (USI:UNCH.NY + 1)"`)? */
export function isBreadthSpread(raw) {
  const s = String(raw == null ? '' : raw).trim().toUpperCase()
  if (!SPREAD.test(s)) return false
  return !/^USI:[A-Z0-9.]+$/.test(s)
}
/** ⛔ REFUSED BY NAME (coordinator 2026-11-22: "spread support if the built-in ADL needs it and it is small; otherwise
 *  refused by name, and say so"). TradingView's own Advance Decline Line reads one spread string; serving it needs an
 *  expression evaluator over several symbols' rows inside one request, which is not small. Refused, with the fix. */
export function breadthSpreadRefusal(raw, codes) {
  return { code: codes.BREADTH_SPREAD, reason: `\`${String(raw).trim()}\` combines several breadth symbols in one `
    + 'string (a spread), which UCT does not compute inside one request; read each with its own `request.security` and '
    + 'combine the values in the script, so what this indicator draws from it is not computed.' }
}

/** The sentence for a breadth spelling on an intraday chart: UCT holds one count per session. */
export function breadthIntradayReason(ticker, tf) {
  return `\`USI:${String(ticker).trim().toUpperCase()}\` on a \`${tf}\` chart: UCT holds one breadth count per session `
    + '(daily), not intraday breadth, so what this indicator draws from it is not computed'
}

/** The sentence for a breadth spelling the door does not open to this member (B1 dark, or refused by the licence). */
export function breadthNotAvailableReason(ticker, said) {
  return `UCT breadth data is not available on this chart yet${said ? ` (${said})` : ''}, so what this indicator draws `
    + `from \`USI:${String(ticker).trim().toUpperCase()}\` is not computed`
}

/** The per-bar words for a bar before UCT's breadth record (`BREADTH_BEFORE_RECORD_CODE`). */
export function breadthBeforeRecordSentence({ spelling, exchange, knownFrom, from }) {
  const at = from || knownFrom || 'the first session UCT counts'
  return `Not drawn before ${at}: UCT's ${exchange || ''}${exchange ? ' ' : ''}breadth counts start there, so what `
    + `\`USI:${spelling}\` reads on those bars is not known here.`
}

/** ⭐ ONE READING of a placed series' record (`SERIES_EVENT_RECORD`) for the lanes and the strip: its per-bar code, its
 *  words, and how a sentence names the read. An event family's record names no `code`; a breadth spelling's does.
 *  (train e95: the code is `interpret.js::beforeRecordCodeOf`'s, the one reading T4 F1b's financial records share:
 *  a `financial` family's is `FINANCIAL_UNKNOWN_CODE`, and its words and label are `pineEvents.js`'s.) */
export const recordCode = (r) => beforeRecordCodeOf(r)
export const recordBeforeSentence = (r) => (recordCode(r) === BREADTH_BEFORE_RECORD_CODE ? breadthBeforeRecordSentence(r)
  : eventBeforeRecordSentence(r))
export const recordLabel = (r) => (recordCode(r) === BREADTH_BEFORE_RECORD_CODE ? `\`USI:${r.spelling || r.ticker}\``
  : eventLabel(r.ticker))

/** The member's note for a script that reads a breadth spelling (one per spelling, `symbolSubstitution.js`). */
export function breadthSourceNote(ticker) {
  const t = String(ticker).trim().toUpperCase()
  const base = breadthBaseOf(t)
  const spec = base ? BREADTH_SPELLINGS[base] : null
  const what = spec ? `the session's count of ${spec.exchange}-listed operating companies (common stock and ADRs) `
    + `${spec.metric === 'add' ? 'that closed up, less the count that closed down' : `that closed ${spec.metric === 'advancing' ? 'up' : spec.metric === 'declining' ? 'down' : 'unchanged'}`}` : 'UCT\'s own breadth count'
  const gap = base && base === t ? BREADTH_DIVERGENCE[base] : null
  // ⭐ (coordinator, 2026-11-22) the size in plain words: operating companies only, against every listed issue
  const since = gap ? ` (the median over ${gap.sessions.toLocaleString('en-US')} sessions since ${gap.from}, measured against `
    + `TradingView's \`USI:${t}\`)` : ''
  const sized = !gap ? ''
    : gap.oursLowerShare >= 0.95 ? ' UCT counts operating companies only; the exchange counts every listed issue, so these '
      + `figures run about ${gap.medianPct}% lower${since}.`
    : ' UCT counts operating companies only; the exchange counts every listed issue, so this figure differs by about '
      + `${gap.medianIssues.toLocaleString('en-US')} issues (${gap.medianPct}%)${since}.`
  return `This script reads \`USI:${t}\`. It uses ${BREADTH_DATA_WORDS}: ${what}, where the exchange's count also holds `
    + `preferreds, funds and other issues, so the values differ from TradingView's on every bar.${sized}`
    + `${spec && spec.closeOnly ? ` \`USI:${t}\` holds each session's close only; its open, high and low read \`na\`.` : ''}`
}

// ─── the witness rows (railed equal to `requestWitnesses.json`) ───────────────────────────────────────────────────

/** The `requestWitnesses.json` row a breadth spelling must carry: kind, store key, timeframes, the alignment constant,
 *  the weekly / monthly blocks it implies, and the capture rows it waits on. `witness` and `captured` stay '' until the
 *  capture lands (the one data edit that serves it). */
export function breadthWitnessRow(ticker, alignment = BREADTH_DAILY_ALIGNMENT) {
  const t = String(ticker).trim().toUpperCase()
  const base = breadthBaseOf(t)
  if (!base) return null
  const reads = BREADTH_PERIOD_READS[alignment]
  const block = (code) => ({ held: 'D', reads: { ...reads[code] }, queue_row: BREADTH_QUEUE.period, probe: BREADTH_PROBE,
    witness: '', captured: '' })
  // ⭐ W-B1: a spelling the daily capture witnessed carries it (an alias never: the capture shows another series)
  const landed = base === t && BREADTH_DAILY_WITNESS.spellings.includes(t) && alignment === BREADTH_DAILY_ALIGNMENT
  return {
    kind: 'breadth', store: breadthKeyOf(t), ...(base !== t ? { aliasOf: `USI:${base}` } : {}),
    timeframes: ['D', 'W', 'M'], alignment, queue_row: BREADTH_QUEUE.daily, probe: BREADTH_PROBE,
    fetch: `/api/pine/breadth/USI:${base} (api/routers/pine_breadth.py, B1)`,
    witness: landed ? BREADTH_DAILY_WITNESS.witness : '', captured: landed ? BREADTH_DAILY_WITNESS.captured : '',
    periods: { W: block('W'), M: block('M') },
  }
}
