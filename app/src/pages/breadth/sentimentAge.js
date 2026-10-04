// app/src/pages/breadth/sentimentAge.js
//
// ─── TERM-059 (follow-ups 2-4) · AAII, CBOE P/C AND CNN F/G STATE THEIR AS-OF ─
//
// `naaimAge.js` did the NAAIM column. FB-A11-03's provenance is ledger H8, which
// names the other public sentiment scrapes too. This is the same question asked
// for each of them, with the same answerer:
//
//   ⛔ THIS FILE DECIDES NOTHING ABOUT HOW OLD IS TOO OLD. TERM-006 / CARD 33 §2
//   decides, through `freshnessAge.js::explainMustShowAge`. Each series only
//   supplies the two facts about itself: its OWN as-of (a field on the row, never
//   "today") and its data class (weekly or end_of_day).
//
// ⭐ "NOW" IS THE ROW'S OWN SESSION, exactly as in naaimAge.js; the live row uses
// the wall clock.
//
//   - AAII (bulls / neutral / bears / spread): a WEEKLY survey, dated by the
//     collector as `aaii_survey_date`. Same rule as NAAIM: an undated reading is
//     labelled "undated", because an unknown age is not a fresh one.
//   - CBOE put/call and CNN Fear & Greed: DAILY prints. The row is the session's
//     own print unless a heal CARRIED it from an earlier session, in which case
//     `breadth_self_heal` stamps `<key>_asof` with the session it came from. So an
//     undated daily value is the row's own print and renders bare (the control);
//     a carried one says "daily · as of <session>".
//     ⚠️ What this cannot see, stated: a reconstructed pre-collector row's daily
//     value forward-filled by `breadth_sentiment_history.values_asof` carries no
//     date at all, so it is indistinguishable here from the session's own print.

import { explainMustShowAge, freshnessClass } from '../../components/provenance/freshnessAge'
import { calendarDay, dayInstant } from './naaimAge'

/**
 * Build the `age` hook for one Monitor column.
 *
 * @param {{valueKey: string, dateKey: string, dataClass: string, labelUndated: boolean}} spec
 * @returns {(row: object, opts?: {now?: Date}) => object|null}
 */
export function makeSeriesAge({ valueKey, dateKey, dataClass, labelUndated }) {
  const cls = freshnessClass(dataClass) // throws on a misspelled class, where it is written
  return function seriesAge(row, { now = new Date() } = {}) {
    if (!row || row[valueKey] === null || row[valueKey] === undefined) return null
    const asOfDate = calendarDay(row[dateKey])
    if (!asOfDate && !labelUndated) return null
    const sessionNow = row._live ? now : (dayInstant(row.date) || now)
    const verdict = explainMustShowAge({
      asOf: asOfDate ? dayInstant(asOfDate) : null,
      dataClass,
      now: sessionNow,
    })
    const mustLabel = verdict.mustShow || (labelUndated && verdict.reason === 'no_timestamp')
    return Object.freeze({ ...verdict, asOfDate, dataClass, cadence: cls.cadence, mustLabel })
  }
}

export const AAII_DATE_KEY = 'aaii_survey_date'
export const AAII_KEYS = Object.freeze(['aaii_bulls', 'aaii_neutral', 'aaii_bears', 'aaii_spread'])
export const DAILY_CARRY_KEYS = Object.freeze(['cboe_putcall', 'cnn_fear_greed'])
/** Mirrors `api/services/breadth_self_heal.py::asof_key`. */
export const asofKey = (key) => `${key}_asof`

/** One age hook per AAII column — they share the survey date. */
export const aaiiAge = Object.freeze(Object.fromEntries(AAII_KEYS.map((k) => [
  k, makeSeriesAge({ valueKey: k, dateKey: AAII_DATE_KEY, dataClass: 'weekly', labelUndated: true }),
])))

/** CBOE P/C and CNN F/G: labelled only when a heal carried the print. */
export const dailyCarryAge = Object.freeze(Object.fromEntries(DAILY_CARRY_KEYS.map((k) => [
  k, makeSeriesAge({ valueKey: k, dateKey: asofKey(k), dataClass: 'end_of_day', labelUndated: false }),
])))
