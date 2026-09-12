// app/src/lib/presentation/presentationPrimitives.js
//
// ─── S10 — PRESENTATION PRIMITIVES ──────────────────────────────────────────
//
// product-architecture.md's S10 block, built for the first time. Five pure
// functions — number, percent, currency, date/time-with-session, freshness —
// and nothing else. No React, no DOM, no clock, no locale detection, no
// network: every one is a total function from (value, options) to a string or
// a caller-chosen absent sentinel.
//
// ⭐ THIS RATIFIES A FORM THE CODEBASE ALREADY HAD; IT DOES NOT INVENT ONE.
// Three of the five are lifted VERBATIM — same arguments, same rounding, same
// sentinels — from helpers that already shipped:
//
//   formatNumber   <- `provenance/CoverageLine.jsx`'s `n()`
//   formatCurrency <- `provenance/presentationFormat.js`'s `formatPrice`
//   formatTimeEt   <- `presentationFormat.js`'s `formatEtTime` (seconds: true)
//                     AND `FreshnessBadge.jsx`'s `formatAsOf` (seconds: false),
//                     which were the SAME formatter differing by one field
//
// `presentationFormat.js`'s own header has said since 2026-09-02 that this is
// how it ends: "When S10 ships, <Provenance>/<FreshnessBadge> swap onto it
// (SPEC-S8 §19 Step 2's own stated migration)." This module is that swap.
//
// ⛔ AN EXPLICIT LOCALE, ALWAYS — never a bare `toLocaleString()`. The rule is
// `CoverageLine.jsx`'s, kept in its own words: a bare call formats to whatever
// the browser is set to, so the same screen reads `3,742` for one member and
// `3.742` for another, and the second one reads as a decimal.
// `presentationSingleFormatter.test.js` is the rail that holds the line.
//
// ⛔ THE ABSENT SENTINEL IS A PARAMETER, NOT A CONSTANT. The four S8 components
// do not agree today and must not be made to agree by this commit: `n()` and
// `formatPrice` return the em dash, `formatEtTime` and `formatAsOf` return
// `null` so their caller can omit a whole element. Both are correct for their
// call site, and hard-coding one would have been a member-visible change
// smuggled in under a refactor. `absent` carries the difference explicitly.
//
// ⚠️ WHAT THIS MODULE DELIBERATELY DOES NOT DECIDE: whether a value IS stale,
// what session the market is in, or what a freshness class MEANS. S11
// (`lib/marketClock/`) owns the session model and
// `provenance/freshnessContract.js` owns D1's FreshnessClass mapping. S10
// renders what it is handed.

/** The one absent-value glyph this app already uses, in the one place it is
 *  now declared. An em dash, not a hyphen: `CoverageLine.jsx` and
 *  `presentationFormat.js` both shipped the em dash and the tables align on it. */
export const ABSENT = '—'

/** The one locale tag. Named so a reader can see there is exactly one, and so
 *  the single-formatter rail can pin it by import rather than by grep. */
export const LOCALE = 'en-US'

/** The market's timezone. S11 owns the session MODEL; this is only the zone
 *  every S8 timestamp is already rendered in. */
export const MARKET_TIME_ZONE = 'America/New_York'

// --------------------------------------------------------------------------
// 1. NUMBER
// --------------------------------------------------------------------------

/**
 * Grouped decimal number.
 *
 * `formatNumber(v)` is byte-identical to `CoverageLine.jsx`'s retired `n(v)`.
 *
 * @param {*} value
 * @param {{decimals?: number|null, absent?: *}} [options]
 */
export function formatNumber(value, { decimals = null, absent = ABSENT } = {}) {
  if (!Number.isFinite(value)) return absent
  if (decimals == null) return Number(value).toLocaleString(LOCALE)
  return Number(value).toLocaleString(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

// --------------------------------------------------------------------------
// 2. PERCENT
// --------------------------------------------------------------------------

/**
 * A percentage, already expressed in percent units (1.5 renders "1.50%", NOT
 * "150.00%").
 *
 * ⛔ That choice is not arbitrary: every percent-shaped field this app carries
 * — `gap_pct`, `change_pct`, `todaysChangePerc`, `pct_above_50sma` — is already
 * in percent units, and a primitive that silently multiplied by 100 would be
 * wrong for all of them. A fraction-valued caller converts at its own boundary,
 * where the unit is known.
 *
 * @param {*} value               percent units
 * @param {{decimals?: number, signed?: boolean, absent?: *}} [options]
 */
export function formatPercent(value, { decimals = 2, signed = false, absent = ABSENT } = {}) {
  if (!Number.isFinite(value)) return absent
  const body = Number(value).toFixed(decimals)
  // `toFixed` already carries the minus sign; only the plus is ours to add,
  // and only when the caller asked for a signed render.
  const sign = signed && Number(value) >= 0 ? '+' : ''
  return `${sign}${body}%`
}

// --------------------------------------------------------------------------
// 3. CURRENCY
// --------------------------------------------------------------------------

/**
 * A US-dollar amount.
 *
 * `formatCurrency(v)` is byte-identical to `presentationFormat.js`'s
 * `formatPrice(v)`, including its `toFixed(2)` (NOT `toLocaleString`), so an
 * existing render cannot move by a thousands separator appearing where there
 * was none.
 *
 * @param {*} value
 * @param {{decimals?: number, absent?: *}} [options]
 */
export function formatCurrency(value, { decimals = 2, absent = ABSENT } = {}) {
  if (!Number.isFinite(value)) return absent
  return `$${Number(value).toFixed(decimals)}`
}

// --------------------------------------------------------------------------
// 4. DATE / TIME WITH SESSION
// --------------------------------------------------------------------------

/**
 * A clock time in the MARKET's timezone, optionally suffixed with the zone
 * label the surfaces already print.
 *
 * `formatTimeEt(v, {seconds: true})`  is byte-identical to the retired
 *   `presentationFormat.formatEtTime(v)`.
 * `formatTimeEt(v, {seconds: false})` is byte-identical to the retired
 *   `FreshnessBadge.formatAsOf(v)`.
 *
 * ⭐ Those two were ONE formatter differing by a single field, in two files,
 * inside one four-component family — the smallest possible instance of the
 * problem S10 exists to end.
 *
 * ⛔ A falsy input and an unparseable input both return `absent`, exactly as
 * both predecessors did. `new Date(undefined)` is Invalid Date, and an Invalid
 * Date formatted is the literal string "Invalid Date" — which is what would
 * have reached a member if the guard were dropped.
 *
 * @param {string|number|Date|null|undefined} value  anything `new Date()` accepts
 * @param {{seconds?: boolean, zoneSuffix?: string|null, absent?: *}} [options]
 */
export function formatTimeEt(value, { seconds = false, zoneSuffix = null, absent = null } = {}) {
  if (!value) return absent
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return absent
  const opts = {
    timeZone: MARKET_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }
  if (seconds) opts.second = '2-digit'
  const text = d.toLocaleTimeString(LOCALE, opts)
  return zoneSuffix ? `${text} ${zoneSuffix}` : text
}

/**
 * A full date-and-time in the VIEWER's own timezone.
 *
 * ⚠️⚠️ THIS IS NOT THE SAME ZONE AS `formatTimeEt`, AND THAT DIVERGENCE IS
 * PRESERVED HERE ON PURPOSE, NOT ENDORSED. `Cited.jsx` has always rendered its
 * `Validated:` timestamp with a bare `toLocaleString('en-US')` — viewer-local —
 * while `<Provenance>` and `<FreshnessBadge>` pin ET a few pixels away. So a
 * member outside ET reads one S8 surface in two timezones, with no zone label
 * on either to tell them.
 *
 * ⛔ THAT IS A REAL DEFECT AND FIXING IT IS NOT THIS COMMIT'S TO MAKE. S10's
 * approved scope is "no member-visible layout change; snapshot tests prove S8
 * renders byte-identical before and after adoption" — changing `Cited`'s zone
 * would move a rendered string for every member outside ET, which is precisely
 * the class of change the byte-identity condition exists to forbid. Recorded,
 * carried, and named so the next reader cannot mistake it for an oversight; the
 * fix needs its own line.
 *
 * @param {*} epochSeconds
 * @param {{absent?: *}} [options]
 */
export function formatDateTimeViewerLocal(epochSeconds, { absent = null } = {}) {
  if (!Number.isFinite(epochSeconds)) return absent
  return new Date(epochSeconds * 1000).toLocaleString(LOCALE)
}

// --------------------------------------------------------------------------
// 5. FRESHNESS
// --------------------------------------------------------------------------

/**
 * The "as of ..." clause beside a freshness tier, or `null` when there must not
 * be one.
 *
 * ⭐ THE PRESENTATION RULE IT CARRIES: a REAL-TIME value gets no as-of clause.
 * Printing "as of 9:32 AM ET" beside the word LIVE tells a member the value is
 * minutes old when it is not — the clause exists to say how far behind the
 * value is, and for a live value the answer is "it isn't".
 *
 * ⛔ THE TIER IS AN INPUT, NEVER DERIVED HERE. D1's FreshnessClass is mapped to
 * a tier by `components/provenance/freshnessContract.js::mapD1Freshness`, which
 * is S8's contract and stays S8's. A second mapping in S10 would be a second
 * authority over one value, and the two would disagree the day either moved.
 *
 * @param {{tier?: string|null, asOf?: *, seconds?: boolean}} args
 * @returns {string|null}
 */
export function formatFreshnessAsOf({ tier = null, asOf = null, seconds = false } = {}) {
  if (tier === 'real_time') return null
  const t = formatTimeEt(asOf, { seconds, zoneSuffix: 'ET' })
  return t ? `as of ${t}` : null
}
