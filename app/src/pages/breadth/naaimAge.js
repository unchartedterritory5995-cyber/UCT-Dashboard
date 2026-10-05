// app/src/pages/breadth/naaimAge.js
//
// ─── TERM-059 · THE NAAIM COLUMN STATES ITS OWN AS-OF, AT THE VALUE ──────────
//
// FB-A11-03: "Sentiment and any proxied series carry their as-of ... where the
// number is, not in a FAQ." Ledger H8 names the defect this exists for: the
// NAAIM feed went 101 days stale and the Monitor's column carried the number
// with nothing beside it saying so (it once sat frozen at 75.00 for 93
// sessions).
//
// ⛔ THIS FILE DECIDES NOTHING ABOUT HOW OLD IS TOO OLD. That ruling is TERM-006
// / CARD 33 §2, and its one implementation is
// `components/provenance/freshnessAge.js::explainMustShowAge`. This module only
// supplies the two inputs that are facts about NAAIM, not about freshness:
//
//   - the value's OWN as-of — `row.naaim_date`, the survey date the collector
//     stamps beside the reading. It comes from the data, never from "today".
//   - the survey's CADENCE — NAAIM publishes once a week.
//
// ⭐ "NOW" IS THE ROW'S OWN SESSION, NOT THE WALL CLOCK. The Monitor is a table
// of dated sessions; each row already states its as-of in the date column. The
// question at the NAAIM cell is whether the NAAIM reading is older than the
// session it is displayed in. Measured against the wall clock, every historical
// row would badge for being history, and a badge that fires on everything says
// nothing. The live row is the exception: its session is today, so its "now"
// is the wall clock.
//
// ⚠️ A weekly series is slower than daily, so under the ruling it labels on
// every session after its survey (freshnessAge caps every cadence at one trading
// session — CARD 33 §2's carve-out: a slower-than-daily surface states its own
// cadence). That is the intended render, not noise: the column says "weekly ·
// as of <survey>", and a 101-day-old reading says so in the same words.
//
// ⚠️ An UNDATED reading (reconstructed pre-collector rows carry the value but not
// its survey date) comes back `reason: 'no_timestamp'`. That is NOT a claim of
// freshness — the caller renders it as undated rather than bare.

import { explainMustShowAge, freshnessClass } from '../../components/provenance/freshnessAge'

/** NAAIM publishes one survey a week: it is TERM-006's `weekly` class. The class, not this
 *  file, holds the cadence and its words (2026-10-02: the literal that stood here was the
 *  only second statement of a class cadence in the tree). */
export const NAAIM_DATA_CLASS = 'weekly'
export const NAAIM_CADENCE_MS = freshnessClass(NAAIM_DATA_CLASS).cadenceMs
export const NAAIM_CADENCE_LABEL = freshnessClass(NAAIM_DATA_CLASS).cadence

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/

/** `'YYYY-MM-DD…'` -> `'YYYY-MM-DD'`, or `null` for anything that is not a date. */
export function calendarDay(value) {
  if (typeof value !== 'string') return null
  const m = value.match(ISO_DAY)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/**
 * One calendar day as an instant — noon UTC, which is 7 or 8 AM ET: the SAME
 * ET calendar day in both daylight states. Both sides of the comparison (the
 * survey date and the row's session) go through this one function, so a
 * same-day reading measures an age of exactly zero and whole days measure whole
 * days. ⛔ `new Date('YYYY-MM-DD')` is the trap it replaces: that reads a bare
 * date as UTC MIDNIGHT, which is the previous evening in New York.
 */
export function dayInstant(day) {
  const d = calendarDay(day)
  return d ? new Date(`${d}T12:00:00Z`) : null
}

/**
 * Must this row's NAAIM value show its age? The whole derivation from
 * `explainMustShowAge`, plus `asOfDate` (the survey day, or `null` when the row
 * carries none) and `mustLabel` — the render decision: label when the authority
 * says the age must show, AND when the value is undated (an unknown age is not
 * permission to render the number bare). `null` when the row has no NAAIM value
 * — there is nothing to label, and an absent value renders as an absent value.
 *
 * @param {object} row  one Monitor row (`naaim`, `naaim_date`, `date`, `_live`)
 * @param {{now?: Date}} [opts]  the wall clock, used only for the live row
 */
export function naaimAge(row, { now = new Date() } = {}) {
  if (!row || row.naaim === null || row.naaim === undefined) return null
  const asOfDate = calendarDay(row.naaim_date)
  const sessionNow = row._live ? now : (dayInstant(row.date) || now)
  const verdict = explainMustShowAge({
    asOf: asOfDate ? dayInstant(asOfDate) : null,
    dataClass: NAAIM_DATA_CLASS,
    now: sessionNow,
  })
  const mustLabel = verdict.mustShow || verdict.reason === 'no_timestamp'
  return Object.freeze({ ...verdict, asOfDate, dataClass: NAAIM_DATA_CLASS, cadence: NAAIM_CADENCE_LABEL, mustLabel })
}
